import { describe, it, expect, vi } from 'vitest';
import { UnifyClient, OpenAIProvider, InMemoryCache, CacheMiddleware, CostTrackerMiddleware, RateLimiterMiddleware, CompletionRequest, CompletionResponse, UnifyMiddleware } from '../src';

// Mock Provider for testing
class MockProvider extends OpenAIProvider {
    // @ts-expect-error Mocking the provider name specifically for core router test validation boundaries
    readonly name = 'mock';
    public callCount = 0;

    constructor() {
        super('mock-key');
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        this.callCount++;
        return {
            content: `Mock response to: ${request.messages[0]?.content || ''}`,
            model: request.model,
            usage: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30
            }
        };
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        this.callCount++;
        yield { content: 'chunk1', model: request.model };
        yield { content: 'chunk2', model: request.model };
        yield {
            content: 'chunk3',
            model: request.model,
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
        };
    }
}

describe('UnifyClient & Middlewares', () => {
    it('should stream requests correctly', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        client.registerProvider(mockProvider);

        const stream = client.stream('mock', {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Stream' }]
        });

        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        expect(chunks.length).toBe(4);
        expect(chunks[0].content).toBe('chunk1');
        expect(chunks[3].usage?.totalTokens).toBe(30);
    });

    it('should stream with middlewares', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        const costTracker = new CostTrackerMiddleware();
        client.registerProvider(mockProvider);
        client.use(costTracker);

        const stream = client.stream('mock', {
            model: 'gpt-4o', // $5/M prompt, $15/M completion
            messages: [{ role: 'user', content: 'Stream Cost' }]
        });

        for await (const chunk of stream) { }

        // Should have picked up cost from chunk3
        const expectedCost = (10 / 1000000 * 5.0) + (20 / 1000000 * 15.0);
        expect(costTracker.getTotalCost()).toBeCloseTo(expectedCost, 6);
    });

    it('should short circuit stream if beforeRequest returns a response', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        client.registerProvider(mockProvider);

        const interceptorObj: UnifyMiddleware = {
            beforeRequest: async (req) => ({ content: 'Intercepted Stream', model: req.model })
        };
        client.use(interceptorObj);

        const stream = client.stream('mock', { model: 'gpt-4o', messages: [] });
        let output = '';
        for await (const chunk of stream) {
            output += chunk.content;
        }
        expect(output).toBe('Intercepted Stream');
    });

    it('should route request to correct provider', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        client.registerProvider(mockProvider);

        const res = await client.generate('mock', {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Hello' }]
        });

        expect(res.content).toBe('Mock response to: Hello');
        expect(mockProvider.callCount).toBe(1);
    });

    it('should cache identical requests', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        client.registerProvider(mockProvider);
        client.use(new CacheMiddleware());

        const req: CompletionRequest = {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Cache me' }]
        };

        const res1 = await client.generate('mock', req);
        const res2 = await client.generate('mock', req);

        expect(mockProvider.callCount).toBe(1); // Provider only called once
        expect(res2.content).toBe(res1.content);
        expect(res2.providerSpecific?._cached).toBe(true);
    });

    it('should track costs correctly', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        const costTracker = new CostTrackerMiddleware();

        client.registerProvider(mockProvider);
        client.use(costTracker);

        await client.generate('mock', {
            model: 'gpt-4o', // $5/M prompt, $15/M completion
            messages: [{ role: 'user', content: 'Cost me' }]
        });

        // 10 prompt tokens * $5/M = $0.00005
        // 20 completion tokens * $15/M = $0.0003
        // Total: $0.00035

        const expectedCost = (10 / 1000000 * 5.0) + (20 / 1000000 * 15.0);
        expect(costTracker.getTotalCost()).toBeCloseTo(expectedCost, 6);
    });

    it('should enforce rate limits', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();

        // Only 1 request per minute
        const rateLimiter = new RateLimiterMiddleware(1);
        client.use(rateLimiter);
        client.registerProvider(mockProvider);

        const req: CompletionRequest = {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Rate limit me' }]
        };

        await client.generate('mock', req); // Should pass

        await expect(client.generate('mock', req)).rejects.toThrow('Rate limit exceeded');

        // Fast-forward time to next minute (61s) to test resetting logic
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 61000);

        await expect(client.generate('mock', req)).resolves.toBeDefined();

        vi.useRealTimers();
    });

    it('should throw an error if provider is not registered', async () => {
        const client = new UnifyClient();
        await expect(client.generate('unknown', { model: 'gpt-4o', messages: [] })).rejects.toThrow("Provider 'unknown' not registered.");
        await expect(async () => {
            for await (const chunk of client.stream('unknown', { model: 'gpt-4o', messages: [] })) { }
        }).rejects.toThrow("Provider 'unknown' not registered.");
    });

    it('CostTracker should ignore responses without usage or if cached', async () => {
        const tracker = new CostTrackerMiddleware();
        const req: CompletionRequest = { model: 'gpt-4o', messages: [] };

        const res1 = await tracker.afterResponse(req, { content: 'test', model: 'gpt-4o' });
        expect(res1.providerSpecific?._costUsd).toBeUndefined();

        const res2 = await tracker.afterResponse(req, {
            content: 'test',
            model: 'gpt-4o',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            providerSpecific: { _cached: true }
        });
        expect(res2.providerSpecific?._costUsd).toBeUndefined();

        const res3 = await tracker.afterResponse({ model: 'unknown-model', messages: [] }, {
            content: 'test',
            model: 'unknown-model',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        });
        expect(res3.providerSpecific?._costUsd).toBe(0);
    });

    it('CacheMiddleware should not re-cache a cached response', async () => {
        const cache = new CacheMiddleware();
        const req: CompletionRequest = { model: 'gpt-4o', messages: [] };
        const res: CompletionResponse = { content: 'test', model: 'gpt-4o', providerSpecific: { _cached: true } };

        const afterRes = await cache.afterResponse(req, res);
        expect(afterRes).toBe(res);
    });

    it('should attach parsed JSON to response.data if schema is provided', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        mockProvider.generateCompletion = async (req) => ({
            content: '{"user": "Alice", "age": 30}',
            model: req.model
        });
        client.registerProvider(mockProvider);

        const res = await client.generate('mock', {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Give me JSON' }],
            schema: { type: 'object', properties: { user: { type: 'string' } } }
        });

        const data = res.data as Record<string, unknown>;
        expect(data).toBeDefined();
        expect(data.user).toBe('Alice');
        expect(data.age).toBe(30);
    });

    it('should attach parsed JSON to final stream chunk data if schema is provided', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        mockProvider.streamCompletion = async function* (req) {
            yield { content: '{"user": ', model: req.model };
            yield { content: '"Bob", "age"', model: req.model };
            yield { content: ': 40}', model: req.model };
        };
        client.registerProvider(mockProvider);

        const stream = client.stream('mock', {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Stream JSON' }],
            schema: { type: 'object' }
        });

        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);

        const finalChunk = chunks[chunks.length - 1]; // Metadata chunk
        expect(finalChunk.content).toBe(''); // Stream summary yields empty content
        const data = finalChunk.data as Record<string, unknown>;
        expect(data).toBeDefined();
        expect(data.user).toBe('Bob');
        expect(data.age).toBe(40);
    });

    it('should calculate cached token discounts correctly for OpenAI/Gemini (implicit)', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        const costTracker = new CostTrackerMiddleware({
            'test-model': { prompt: 10.0, completion: 20.0, cachedPrompt: 5.0 }
        });

        // 100 total prompt tokens, 80 were cached. 20 regular.
        mockProvider.generateCompletion = async (req) => ({
            content: 'discount',
            model: 'test-model',
            usage: {
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
                cachedTokens: 80
            }
        });
        client.registerProvider(mockProvider);
        client.use(costTracker);

        await client.generate('mock', { model: 'test-model', messages: [] });

        // Cost logic:
        // regularPrompt: 20 * (10 / 1M) = 0.0002
        // cachedPrompt: 80 * (5 / 1M) = 0.0004
        // completion: 50 * (20 / 1M) = 0.001
        // Total: 0.0016
        expect(costTracker.getTotalCost()).toBeCloseTo(0.0016, 6);
    });

    it('should calculate cache creation and read token costs correctly for Anthropic (explicit)', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        const costTracker = new CostTrackerMiddleware({
            'claude-test': { prompt: 15.0, completion: 75.0, cachedPrompt: 1.5, cacheCreation: 18.75 }
        });

        mockProvider.generateCompletion = async (req) => ({
            content: 'anthropic discount',
            model: 'claude-test',
            usage: {
                promptTokens: 50,    // Regular tokens
                completionTokens: 10,  // Output tokens
                totalTokens: 3060,
                cacheCreationTokens: 1000,
                cacheReadTokens: 2000
            }
        });
        client.registerProvider(mockProvider);
        client.use(costTracker);

        await client.generate('mock', { model: 'claude-test', messages: [] });

        // Cost logic:
        // regularPrompt: 50 * 15 / 1M = 0.00075
        // cachedPrompt: 2000 * 1.5 / 1M = 0.003
        // cacheCreation: 1000 * 18.75 / 1M = 0.01875
        // completion: 10 * 75 / 1M = 0.00075
        // Total: 0.02325

        expect(costTracker.getTotalCost()).toBeCloseTo(0.02325, 6);
    });

    it('should automatically execute tools recursively if autoExecute is true', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        let callIndex = 0;

        mockProvider.generateCompletion = async (req) => {
            if (callIndex === 0) {
                callIndex++;
                return {
                    content: '',
                    model: req.model,
                    toolCalls: [{ id: 'call_1', name: 'getWeather', arguments: { city: 'Chennai' } }],
                    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
                };
            } else {
                const toolResult = req.messages[req.messages.length - 1]?.toolResults?.[0]?.result as Record<string, unknown>;
                return {
                    content: `The weather in ${toolResult?.city} is ${toolResult?.temp} degrees.`,
                    model: req.model,
                    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 }
                };
            }
        };
        client.registerProvider(mockProvider);

        const mockTool = {
            name: 'getWeather',
            description: 'Gets weather',
            schema: { type: 'object' },
            execute: async (args: Record<string, unknown>) => ({ temp: 32, city: args.city })
        };

        const res = await client.generate('mock', {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Weather in Chennai?' }],
            tools: [mockTool],
            autoExecute: true
        });

        expect(res.usage?.totalTokens).toBe(45);
        expect(res.content).toBe('The weather in Chennai is 32 degrees.');
    });
    it('should automatically execute tools recursively across multiple depth levels (depth-3 test)', async () => {
        const client = new UnifyClient();
        const mockProvider = new MockProvider();
        let callIndex = 0;

        mockProvider.generateCompletion = async (req) => {
            if (callIndex === 0) {
                // Return call 1 (depth 1)
                callIndex++;
                return {
                    content: '',
                    model: req.model,
                    toolCalls: [{ id: 'call_1', name: 'searchHotel', arguments: { city: 'Paris' } }],
                    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
                };
            } else if (callIndex === 1) {
                // Return call 2 (depth 2)
                callIndex++;
                return {
                    content: '',
                    model: req.model,
                    toolCalls: [{ id: 'call_2', name: 'checkAvailability', arguments: { hotelId: 'paris_1' } }],
                    usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 }
                };
            } else if (callIndex === 2) {
                // Return call 3 (depth 3)
                callIndex++;
                return {
                    content: '',
                    model: req.model,
                    toolCalls: [{ id: 'call_3', name: 'bookRoom', arguments: { hotelId: 'paris_1', room: '101' } }],
                    usage: { promptTokens: 30, completionTokens: 5, totalTokens: 35 }
                };
            } else {
                // Final answer (depth 4 terminal)
                return {
                    content: `Room 101 booked in Paris.`,
                    model: req.model,
                    usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 }
                };
            }
        };

        client.registerProvider(mockProvider);

        const tools = [
            {
                name: 'searchHotel',
                description: 'Search hotels',
                schema: { type: 'object' },
                execute: async (args: Record<string, unknown>) => ({ hotelId: 'paris_1' })
            },
            {
                name: 'checkAvailability',
                description: 'Check hotel rooms',
                schema: { type: 'object' },
                execute: async (args: Record<string, unknown>) => ({ available: ['101'] })
            },
            {
                name: 'bookRoom',
                description: 'Book a room',
                schema: { type: 'object' },
                execute: async (args: Record<string, unknown>) => ({ success: true })
            }
        ];

        const res = await client.generate('mock', {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'Book me a hotel in Paris.' }],
            tools: tools,
            autoExecute: true
        });

        // Sum of aggregations: 15 + 25 + 35 + 50 = 125 total tokens
        expect(res.usage?.totalTokens).toBe(125);
        expect(res.content).toBe('Room 101 booked in Paris.');
    });
});
