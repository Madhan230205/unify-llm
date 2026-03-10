import { CompletionRequest, CompletionResponse, UnifyMiddleware, UnifyAPIError } from '../types';

export interface RetryMiddlewareOptions {
    /** Maximum number of retry attempts per request. Defaults to 3. */
    maxRetries?: number;
    /** Base delay in milliseconds for exponential backoff. Defaults to 1000. */
    baseDelayMs?: number;
}

export class RetryMiddleware implements UnifyMiddleware {
    private maxRetries: number;
    private baseDelayMs: number;

    constructor(options: RetryMiddlewareOptions = {}) {
        this.maxRetries = options.maxRetries ?? 3;
        this.baseDelayMs = options.baseDelayMs ?? 1000;
    }

    private isRetryable(error: unknown): boolean {
        if (error instanceof UnifyAPIError) {
            // 429: Too Many Requests
            // 529: Overloaded (common for Anthropic)
            // 500: Internal Server Error (transient)
            // 503: Service Unavailable
            // 502: Bad Gateway
            return [429, 529, 500, 502, 503].includes(error.status || 0);
        }
        // General network errors (like fetch failures) can potentially be retried
        if (error instanceof TypeError && /\bfetch\b/i.test(error.message)) {
            return true;
        }
        return false;
    }

    private calculateAHDJitterDelay(attempt: number, currentState: number): { delay: number, nextState: number } {
        // Exponential backoff base
        const maxDelay = this.baseDelayMs * Math.pow(2, attempt);

        // Aetherion Harmonic Dispersion (AHD) Math
        // Advance the chaotic logistical map dynamically per retry to weave through the temporal attractor
        const nextState = 3.99 * currentState * (1 - currentState);

        // Jitter scaling: push retries dynamically using the deterministic chaos output
        const jitteredDelay = maxDelay * nextState;
        return { delay: Math.floor(jitteredDelay), nextState };
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async wrapGenerate(request: CompletionRequest, next: (req?: CompletionRequest) => Promise<CompletionResponse>): Promise<CompletionResponse> {
        let attempt = 0;
        let localAhdState = Math.random() || 0.5;
        if (localAhdState === 1) localAhdState = 0.5;

        while (true) {
            try {
                return await next(request);
            } catch (error: unknown) {
                if (attempt >= this.maxRetries || !this.isRetryable(error)) {
                    throw error;
                }
                const { delay, nextState } = this.calculateAHDJitterDelay(attempt, localAhdState);
                localAhdState = nextState;
                await this.sleep(delay);
                attempt++;
            }
        }
    }

    async *wrapStream(request: CompletionRequest, next: (req?: CompletionRequest) => AsyncGenerator<CompletionResponse, void, unknown>): AsyncGenerator<CompletionResponse, void, unknown> {
        let attempt = 0;
        let localAhdState = Math.random() || 0.5;
        if (localAhdState === 1) localAhdState = 0.5;

        while (true) {
            let yieldedAnything = false;
            try {
                const generator: AsyncGenerator<CompletionResponse, void, unknown> = next(request);
                for await (const chunk of generator) {
                    yieldedAnything = true;
                    yield chunk;
                }
                return; // Iteration fully completed successfully
            } catch (error: unknown) {
                // We cannot seamlessly retry if the stream ALREADY sent partial data to the user.
                // It breaks the chunk sequence. That's AetherionProvider's job.
                // RetryMiddleware handles connection drops/429s *before* streaming begins.
                if (yieldedAnything || attempt >= this.maxRetries || !this.isRetryable(error)) {
                    throw error;
                }

                const { delay, nextState } = this.calculateAHDJitterDelay(attempt, localAhdState);
                localAhdState = nextState;
                await this.sleep(delay);
                attempt++;
            }
        }
    }
}
