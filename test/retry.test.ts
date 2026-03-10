import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnifyClient, RetryMiddleware, BaseProvider, CompletionRequest, CompletionResponse, UnifyAPIError } from '../src';

class MockFailingProvider extends BaseProvider {
    readonly name = 'mock-failing';

    public constructor(public failCount: number, public errorMsg: string, public statusCode: number) {
        super();
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        if (this.failCount > 0) {
            this.failCount--;
            throw new UnifyAPIError(this.errorMsg, this.name, this.statusCode);
        }
        return {
            content: 'Success!',
            model: request.model
        };
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        if (this.failCount > 0) {
            this.failCount--;
            throw new UnifyAPIError(this.errorMsg, this.name, this.statusCode);
        }
        yield { content: 'Stream ', model: request.model };
        yield { content: 'Success!', model: request.model };
    }
}

describe('RetryMiddleware & AHD Jitter', () => {

    it('should retry successfully on 429 errors within maxRetries limit', async () => {
        const client = new UnifyClient();
        const provider = new MockFailingProvider(2, 'Too Many Requests', 429);
        client.registerProvider(provider);
        client.use(new RetryMiddleware({ maxRetries: 3, baseDelayMs: 0 }));

        const response = await client.generate('mock-failing', {
            model: 'mock',
            messages: [{ role: 'user', content: 'test' }]
        });

        expect(response.content).toBe('Success!');
        expect(provider.failCount).toBe(0);
    });

    it('should throw immediately on non-retryable 400 Bad Request error', async () => {
        const client = new UnifyClient();
        const provider = new MockFailingProvider(1, 'Bad Request', 400);
        client.registerProvider(provider);
        client.use(new RetryMiddleware({ maxRetries: 3, baseDelayMs: 0 }));

        await expect(client.generate('mock-failing', {
            model: 'mock',
            messages: [{ role: 'user', content: 'test' }]
        })).rejects.toThrow('Bad Request');
    });

    it('should throw if maxRetries limit is exceeded', async () => {
        const client = new UnifyClient();
        const provider = new MockFailingProvider(4, 'Overloaded', 529); // Fails 4 times
        client.registerProvider(provider);
        client.use(new RetryMiddleware({ maxRetries: 3, baseDelayMs: 0 })); // Only retries 3 times

        await expect(client.generate('mock-failing', {
            model: 'mock',
            messages: [{ role: 'user', content: 'test' }]
        })).rejects.toThrow('Overloaded');
    });

    it('should retry streams gracefully if failure occurs before yielding any chunks', async () => {
        const client = new UnifyClient();
        const provider = new MockFailingProvider(1, 'Internal Error', 500);
        client.registerProvider(provider);
        client.use(new RetryMiddleware({ maxRetries: 3, baseDelayMs: 0 }));

        const generator = client.stream('mock-failing', {
            model: 'mock',
            messages: [{ role: 'user', content: 'test' }]
        });

        let res = '';
        for await (const chunk of generator) {
            res += chunk.content;
        }

        expect(res).toBe('Stream Success!');
    });

    it('should implement Aetherion Harmonic Dispersion mathematically properly', () => {
        const middleware = new RetryMiddleware({ baseDelayMs: 1000, maxRetries: 1 });

        // Calculate max limit for attempt 0 -> 1000 * 2^0 = 1000
        const maxLimit = 1000;

        // Let's sample 100 AHD operations
        const samples = [];
        let currentState = 0.5;
        for (let i = 0; i < 100; i++) {
            // we have to access the private method to unit test the math
            const { delay, nextState } = (middleware as any).calculateAHDJitterDelay(0, currentState);
            samples.push(delay);
            currentState = nextState;
            expect(delay).toBeGreaterThanOrEqual(0);
            expect(delay).toBeLessThanOrEqual(maxLimit);
        }

        // Because AHD is a chaotic logistic map pushed to the U-shaped boundaries,
        // we anticipate more values near 0 and maxLimit than in the dead center.
        // We just assert that it produces variable values, unlike constant math.
        const uniqueValues = new Set(samples);
        expect(uniqueValues.size).toBeGreaterThan(1); // proves non-constant jitter dispersion
    });

});
