import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AnthropicProvider,
    GeminiProvider,
    OllamaProvider,
    OpenAIProvider,
    CompletionRequest
} from '../src';

const fetchMock = vi.fn();
global.fetch = fetchMock;

// Helper to create a mock ReadableStream for testing SSE
function createMockStream(chunks: string[]): ReadableStream {
    return new ReadableStream({
        start(controller) {
            chunks.forEach(chunk => controller.enqueue(new TextEncoder().encode(chunk)));
            controller.close();
        }
    });
}

describe('Providers', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        vi.unstubAllEnvs();
        vi.stubEnv('OPENAI_API_KEY', 'test-key');
        vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
        vi.stubEnv('GEMINI_API_KEY', 'test-key');
    });

    const req: CompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'test message' }],
        temperature: 0.5,
        maxTokens: 100
    };

    it('OpenAIProvider should format request, response, and stream', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                model: 'test-model',
                choices: [{ message: { content: 'openai response' } }],
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
            })
        });

        const provider = new OpenAIProvider('key');
        const res = await provider.generateCompletion(req);

        expect(res.content).toBe('openai response');

        // STREAMING TEST
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: createMockStream([
                'data: {"choices":[{"delta":{"content":"chunk1"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":"chunk2"}}]}\n\n',
                'data: [DONE]\n\n'
            ])
        });

        const stream = provider.streamCompletion(req);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);

        expect(chunks.length).toBe(2);
        expect(chunks[0].content).toBe('chunk1');
    });

    it('AnthropicProvider should format request, response, and stream', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                model: 'test-model',
                content: [{ type: 'text', text: 'anthropic response' }],
                usage: { input_tokens: 15, output_tokens: 25 }
            })
        });

        const provider = new AnthropicProvider('key');
        const res = await provider.generateCompletion(req);

        expect(res.content).toBe('anthropic response');

        // STREAMING TEST
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: createMockStream([
                'event: content_block_delta\ndata: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "chunk1"}}\n\n',
                'event: message_stop\ndata: [DONE]\n\n'
            ])
        });

        const stream = provider.streamCompletion(req);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);

        expect(chunks.length).toBe(1);
        expect(chunks[0].content).toBe('chunk1');
    });

    it('AnthropicProvider should format user and system cachePrompt correctly', async () => {
        const provider = new AnthropicProvider('key');

        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ model: 'test-model', content: [{ text: 'response' }] })
        });

        const reqWithCache: CompletionRequest = {
            model: 'test-model',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.', cachePrompt: true },
                { role: 'user', content: 'Analyze this huge document.', cachePrompt: true }
            ]
        };

        await provider.generateCompletion(reqWithCache);

        expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
            headers: expect.objectContaining({
                'anthropic-beta': 'prompt-caching-2024-07-31'
            }),
            body: expect.stringContaining('"cache_control":{"type":"ephemeral"}')
        }));

        const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);

        // System message caching
        expect(Array.isArray(callBody.system)).toBe(true);
        expect(callBody.system[0].cache_control).toEqual({ type: 'ephemeral' });

        // User message caching
        expect(callBody.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('AnthropicProvider should send anthropic-beta header in streamCompletion', async () => {
        const provider = new AnthropicProvider('key');
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: createMockStream(['event: message_stop\ndata: [DONE]\n\n'])
        });

        const req: CompletionRequest = {
            model: 'test-model',
            messages: [{ role: 'user', content: 'test', cachePrompt: true }]
        };
        const stream = provider.streamCompletion(req);
        for await (const _ of stream) { }

        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({ 'anthropic-beta': 'prompt-caching-2024-07-31' })
            })
        );
    });

    it('GeminiProvider should format request, response, and stream', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: 'gemini response' }] } }],
                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 }
            })
        });

        const provider = new GeminiProvider('key');
        const res = await provider.generateCompletion(req);

        expect(res.content).toBe('gemini response');

        // STREAMING TEST
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: createMockStream([
                'data: {"candidates":[{"content":{"parts":[{"text":"chunk1"}]}}]}\n\n',
                'data: [DONE]\n\n'
            ])
        });

        const stream = provider.streamCompletion(req);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);

        expect(chunks.length).toBe(1);
        expect(chunks[0].content).toBe('chunk1');
    });

    it('OllamaProvider should format request, response, and stream', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                model: 'test-model',
                message: { content: 'ollama response' },
                prompt_eval_count: 50,
                eval_count: 50
            })
        });

        const provider = new OllamaProvider('http://localhost:11434');
        const res = await provider.generateCompletion(req);

        expect(res.content).toBe('ollama response');

        // STREAMING TEST
        fetchMock.mockResolvedValueOnce({
            ok: true,
            body: createMockStream([
                '{"model":"test-model","message":{"content":"chunk1"},"done":false}\n',
                '{"model":"test-model","message":{"content":"chunk2"},"done":true,"prompt_eval_count":50,"eval_count":50}\n'
            ])
        });

        const stream = provider.streamCompletion(req);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);

        expect(chunks.length).toBe(2);
        expect(chunks[0].content).toBe('chunk1');
        expect(chunks[1].usage).toEqual({ promptTokens: 50, completionTokens: 50, totalTokens: 100 });
    });

    describe('Error Handling', () => {
        it('OpenAIProvider should throw on missing API key', () => {
            vi.stubEnv('OPENAI_API_KEY', '');
            expect(() => new OpenAIProvider()).toThrow('OpenAI API Key is required');
        });

        it('AnthropicProvider should throw on missing API key', () => {
            vi.stubEnv('ANTHROPIC_API_KEY', '');
            expect(() => new AnthropicProvider()).toThrow('Anthropic API Key is required');
        });

        it('GeminiProvider should throw on missing API key', () => {
            vi.stubEnv('GEMINI_API_KEY', '');
            expect(() => new GeminiProvider()).toThrow('Gemini API Key is required');
        });

        it('OpenAIProvider should throw on API error', async () => {
            vi.stubEnv('OPENAI_API_KEY', 'key');
            fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Error' });
            const p = new OpenAIProvider();
            await expect(p.generateCompletion(req)).rejects.toThrow('OpenAI API error: 500 - Internal Error');
            await expect(async () => { for await (const c of p.streamCompletion(req)) { } }).rejects.toThrow('OpenAI API error: 500 - Internal Error');
        });

        it('AnthropicProvider should throw on API error', async () => {
            vi.stubEnv('ANTHROPIC_API_KEY', 'key');
            fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Error' });
            const p = new AnthropicProvider();
            await expect(p.generateCompletion(req)).rejects.toThrow('Anthropic API error: 500 - Internal Error');
            await expect(async () => { for await (const c of p.streamCompletion(req)) { } }).rejects.toThrow('Anthropic API error: 500 - Internal Error');
        });

        it('GeminiProvider should throw on API error', async () => {
            vi.stubEnv('GEMINI_API_KEY', 'key');
            fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Error' });
            const p = new GeminiProvider();
            await expect(p.generateCompletion(req)).rejects.toThrow('Gemini API error: 500 - Internal Error');
            await expect(async () => { for await (const c of p.streamCompletion(req)) { } }).rejects.toThrow('Gemini API error: 500 - Internal Error');
        });

        it('OllamaProvider should throw on API error', async () => {
            fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Error' });
            const p = new OllamaProvider();
            await expect(p.generateCompletion(req)).rejects.toThrow('Ollama API error: 500 - Internal Error');
            await expect(async () => { for await (const c of p.streamCompletion(req)) { } }).rejects.toThrow('Ollama API error: 500 - Internal Error');
        });
    });
});
