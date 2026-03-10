import { describe, it, expect } from 'vitest';
import { AetherionProvider, BaseProvider, CompletionRequest, CompletionResponse } from '../src';

class FlakyProvider extends BaseProvider {
    name = 'flaky';
    constructor(private failAfterChunks: number, private chunkString: string) {
        super();
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        if (this.failAfterChunks === 0) throw new Error("Flaky provider failed upfront");
        return { content: this.chunkString, model: 'flaky-model' };
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        if (this.failAfterChunks === 0) throw new Error("Flaky provider failed upfront in stream");

        for (let i = 0; i < this.failAfterChunks; i++) {
            yield { content: this.chunkString, model: 'flaky-model' };
        }
        throw new Error("Flaky provider failed mid-stream!");
    }
}

class ReliableProvider extends BaseProvider {
    name = 'reliable';
    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        return { content: 'reliable string', model: 'reliable-model' };
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        // Assert that the Reliable provider receives the rewritten prompt via assistant role
        const lastMessage = request.messages[request.messages.length - 1];
        if (lastMessage.role === 'assistant') {
            yield { content: ` [resuming from: ${lastMessage.content}] reliable chunk`, model: 'reliable-model' };
        } else {
            yield { content: 'reliable stream chunk', model: 'reliable-model' };
        }
    }
}

describe('AetherionProvider (Mesh Network)', () => {
    it('should fallback upfront on generateCompletion', async () => {
        const mesh = new AetherionProvider({
            providers: [new FlakyProvider(0, 'fail'), new ReliableProvider()]
        });

        const res = await mesh.generateCompletion({ model: 'mesh', messages: [] });
        expect(res.content).toBe('reliable string');
    });

    it('should throw if all providers fail on generateCompletion', async () => {
        const mesh = new AetherionProvider({
            providers: [new FlakyProvider(0, 'fail'), new FlakyProvider(0, 'fail')]
        });

        await expect(mesh.generateCompletion({ model: 'mesh', messages: [] }))
            .rejects.toThrow('Aetherion Mesh exhausted all 2 providers.');
    });

    it('should seamlessly hot-swap providers mid-stream without breaking loop', async () => {
        const mesh = new AetherionProvider({
            providers: [
                new FlakyProvider(2, 'flaky1-'),
                new ReliableProvider()
            ]
        });

        const stream = mesh.streamCompletion({ model: 'mesh', messages: [{ role: 'user', content: 'hello' }] });
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk.content);

        // flaky gives 2 chunks 'flaky1-', 'flaky1-', then throws
        // reliable takes over. The rewritten prompt should have an assistant message with 'flaky1-flaky1-'
        expect(chunks.length).toBe(3);
        expect(chunks[0]).toBe('flaky1-');
        expect(chunks[1]).toBe('flaky1-');
        expect(chunks[2]).toBe(' [resuming from: flaky1-flaky1-] reliable chunk'); // Resumed!
    });

    it('should throw mid-stream if seamless fallback is disabled', async () => {
        const mesh = new AetherionProvider({
            providers: [new FlakyProvider(2, 'flaky1-'), new ReliableProvider()],
            seamlessMidStreamFallback: false
        });

        const stream = mesh.streamCompletion({ model: 'mesh', messages: [{ role: 'user', content: 'hello' }] });

        await expect(async () => {
            for await (const chunk of stream) { }
        }).rejects.toThrow(/Stream failed mid-way on flaky/);
    });
});
