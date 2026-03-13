import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveModelRouter } from '../src/routers/adaptiveModelRouter';
import { ManifoldExtractor } from '../src/analytics/contextAnalyzer';
import { InMemoryStore } from '../src/storage/inMemoryStore';
import { Message } from '../src/types';

describe('Adaptive Model Router', () => {
    let store: InMemoryStore;
    let router: AdaptiveModelRouter;

    beforeEach(() => {
        store = new InMemoryStore();
        router = new AdaptiveModelRouter({
            store,
            allowedModels: ['gpt-4o-mini', 'claude-3-opus', 'gemini-1.5-pro']
        });
    });

    describe('Manifold extractor', () => {
        it('should correctly measure entropy', () => {
            const e1 = ManifoldExtractor.calculateEntropy('a');
            const e2 = ManifoldExtractor.calculateEntropy('ab');
            expect(e1).toBe(0);
            expect(e2).toBe(1);
        });

        it('should correctly measure lexical density', () => {
            const d1 = ManifoldExtractor.calculateDensity('hello hello hello');
            expect(d1).toBeCloseTo(0.333, 2);
            const d2 = ManifoldExtractor.calculateDensity('hello dark world');
            expect(d2).toBe(1);
        });

        it('should correctly measure structural asymmetry', () => {
            const v1 = ManifoldExtractor.calculateAsymmetry('Hello world');
            expect(v1).toBe(0);
            const v2 = ManifoldExtractor.calculateAsymmetry('while(true) { x++; }');
            expect(v2).toBeGreaterThan(0.5);
        });

        it('should distinguish intent for structurally similar prompts', () => {
            const pSort = 'Write a Python script to sort an array.';
            const pFetch = 'Write a Python script to fetch a URL.';

            const sortIntent = ManifoldExtractor.calculateIntentSignal(pSort);
            const fetchIntent = ManifoldExtractor.calculateIntentSignal(pFetch);
            const sSort = ManifoldExtractor.extract(pSort);
            const sFetch = ManifoldExtractor.extract(pFetch);

            expect(sortIntent).toBeGreaterThan(0);
            expect(fetchIntent).toBeGreaterThan(0);
            expect(sSort).not.toEqual(sFetch);
        });
    });

    describe('kNN-UCB routing logic', () => {
        it('should default to exploration on cold start', async () => {
            const req = { model: '', messages: [{ role: 'user', content: 'hello' } as Message] };
            const model = await router.getModel(req);
            expect(['gpt-4o-mini', 'claude-3-opus', 'gemini-1.5-pro']).toContain(model);
        });

        it('should make deterministic cold-start choices for the same prompt', async () => {
            const req = { model: '', messages: [{ role: 'user', content: 'hello deterministic world' } as Message] };
            const first = await router.getModel(req);
            const second = await router.getModel(req);

            expect(first).toBe(second);
        });

        it('should converge towards high utility models for a specific prompt type', async () => {
            const codePrompt = 'function bubbleSort(arr: number[]): number[] { // ...';
            const state = ManifoldExtractor.extract(codePrompt);

            await store.record(state, 'claude-3-opus', 0.95);
            await store.record(state, 'gpt-4o-mini', 0.2);
            await store.record(state, 'gemini-1.5-pro', 0.8);

            const tempRouter = new AdaptiveModelRouter({
                store,
                allowedModels: ['gpt-4o-mini', 'claude-3-opus', 'gemini-1.5-pro'],
                explorationConstant: 0
            });

            const model = await tempRouter.getModel({ model: '', messages: [{ role: 'user', content: codePrompt }] });

            expect(model).toBe('claude-3-opus');
        });

        it('should cleanly differentiate domains', async () => {
            const codePrompt = 'function bubbleSort(arr: number[]): number[] { }';
            const chatPrompt = 'Hi, how are you today? I am fine.';

            const sCode = ManifoldExtractor.extract(codePrompt);
            const sChat = ManifoldExtractor.extract(chatPrompt);

            await store.record(sCode, 'claude-3-opus', 1.0);
            await store.record(sCode, 'gpt-4o-mini', 0.1);
            await store.record(sChat, 'gpt-4o-mini', 1.0);
            await store.record(sChat, 'claude-3-opus', 0.1);

            const exploitRouter = new AdaptiveModelRouter({ store, explorationConstant: 0, allowedModels: ['gpt-4o-mini', 'claude-3-opus'] });

            const m1 = await exploitRouter.getModel({ model: '', messages: [{ role: 'user', content: codePrompt }] });
            const m2 = await exploitRouter.getModel({ model: '', messages: [{ role: 'user', content: chatPrompt }] });

            expect(m1).toBe('claude-3-opus');
            expect(m2).toBe('gpt-4o-mini');
        });
    });
});