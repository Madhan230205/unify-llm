import { describe, expect, it, vi } from 'vitest';
import {
    Chain,
    HolographicVectorStore,
    JsonOutputParser,
    PromptTemplate,
    RunnableModel,
} from '../src';
import { CompletionResponse, Message } from '../src/types';

describe('Orchestration layer', () => {
    it('should compose sync and async runnables through Chain', async () => {
        const chain = Chain.from((input: number) => input + 2)
            .pipe(async (value: number) => value * 3)
            .pipe({
                invoke(value: number) {
                    return `result:${value}`;
                },
            });

        await expect(chain.invoke(4)).resolves.toBe('result:18');
    });

    it('should format prompt templates with typed variables', () => {
        const prompt = new PromptTemplate<{ topic: string; depth: number }>(
            'You are a helpful assistant for {topic}.',
            'Explain {topic} at depth {depth}.',
        );

        const messages = prompt.format({ topic: 'quantum computing', depth: 2 });

        expect(messages).toEqual<Message[]>([
            { role: 'system', content: 'You are a helpful assistant for quantum computing.' },
            { role: 'user', content: 'Explain quantum computing at depth 2.' },
        ]);
    });

    it('should reject missing prompt variables', () => {
        const prompt = new PromptTemplate<{ topic: string }>('System {topic}', 'User {topic} {missing}');

        expect(() => prompt.format({ topic: 'routing' } as { topic: string })).toThrow('missing');
    });

    it('should wrap UnifyClient.generate as a runnable model', async () => {
        const response: CompletionResponse = {
            content: '{"summary":"Bayesian routing"}',
            model: 'demo-model',
        };
        const client = {
            generate: vi.fn().mockResolvedValue(response),
        };

        const runnableModel = new RunnableModel(client as never, 'demo-provider', 'demo-model', {
            temperature: 0.2,
        });

        const messages: Message[] = [{ role: 'user', content: 'Explain routing.' }];
        await expect(runnableModel.invoke(messages)).resolves.toEqual(response);
        expect(client.generate).toHaveBeenCalledWith('demo-provider', {
            model: 'demo-model',
            messages,
            temperature: 0.2,
        });
    });

    it('should parse structured responses from response.data or JSON content', () => {
        const parser = new JsonOutputParser<{ summary: string }>();

        expect(parser.parse({ content: '', data: { summary: 'from-data' }, model: 'demo' })).toEqual({ summary: 'from-data' });
        expect(parser.parse({ content: '```json\n{"summary":"from-json"}\n```', model: 'demo' })).toEqual({ summary: 'from-json' });
    });

    it('should build a complete prompt-model-parser chain', async () => {
        const prompt = new PromptTemplate<{ topic: string }>(
            'You are precise.',
            'Explain {topic} and respond with JSON.',
        );
        const client = {
            generate: vi.fn().mockResolvedValue({
                content: '{"summary":"Quantum computing uses qubits."}',
                model: 'demo-model',
            }),
        };
        const model = new RunnableModel(client as never, 'demo-provider', 'demo-model');
        const parser = new JsonOutputParser<{ summary: string }>();

        const chain = Chain.from((variables: { topic: string }) => prompt.format(variables))
            .pipe(model)
            .pipe(parser);

        await expect(chain.invoke({ topic: 'quantum computing' })).resolves.toEqual({
            summary: 'Quantum computing uses qubits.',
        });
    });

    it('should retrieve similar documents from the holographic vector store', async () => {
        const store = new HolographicVectorStore<{ source: string }>();
        await store.addDocuments([
            { content: 'TypeScript retry middleware with exponential backoff for API calls', metadata: { source: 'retry' } },
            { content: 'Chocolate cake recipe with vanilla frosting and buttercream', metadata: { source: 'cake' } },
            { content: 'Gaussian process routing for model selection under latency constraints', metadata: { source: 'gp' } },
        ]);

        const results = await store.similaritySearch('TypeScript middleware for retrying failed API calls', 2);

        expect(store.size).toBe(3);
        expect(results).toHaveLength(2);
        expect(results[0].metadata?.source).toBe('retry');
    });
});
