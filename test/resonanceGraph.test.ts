import { describe, expect, it } from 'vitest';
import { createFieldProjector, ResonanceGraph } from '../src';

describe('ResonanceGraph', () => {
    it('should converge when semantic state stops meaningfully changing', async () => {
        const graph = new ResonanceGraph<{ draft: string; revisions: number }>({
            startNode: 'refine',
            stateProjector: createFieldProjector(['draft']),
            semanticTolerance: 0.02,
            stablePasses: 2,
            maxIterations: 6,
        });

        graph
            .addNode('refine', ({ draft, revisions }) => ({
                patch: {
                    draft: draft.endsWith('!') ? draft : `${draft}!`,
                    revisions: revisions + 1,
                },
            }))
            .addEdge('refine', 'refine');

        const result = await graph.invoke({ draft: 'hello world', revisions: 0 });

        expect(result.converged).toBe(true);
        expect(result.haltReason).toBe('converged');
        expect(result.state.draft).toBe('hello world!');
        expect(result.iterations).toBeGreaterThanOrEqual(2);
    });

    it('should follow conditional graph edges', async () => {
        const graph = new ResonanceGraph<{ intent: string; answer: string }>({
            startNode: 'route',
            maxIterations: 4,
            stateProjector: createFieldProjector(['answer']),
        });

        graph
            .addNode('route', ({ intent }) => ({ patch: { intent } }))
            .addNode('code', () => ({ patch: { answer: 'Use TypeScript generics for composable tool wrappers.' }, halt: true }))
            .addNode('chat', () => ({ patch: { answer: 'Hello from the conversational branch.' }, halt: true }))
            .addEdge('route', 'code', (state) => state.intent === 'code')
            .addEdge('route', 'chat', (state) => state.intent !== 'code');

        const codeResult = await graph.invoke({ intent: 'code', answer: '' });
        const chatResult = await graph.invoke({ intent: 'chat', answer: '' });

        expect(codeResult.state.answer).toContain('TypeScript');
        expect(chatResult.state.answer).toContain('conversational');
    });

    it('should expose trace metadata and visit counts', async () => {
        const graph = new ResonanceGraph<{ counter: number; done: boolean }>({
            startNode: 'tick',
            maxIterations: 5,
            stateProjector: createFieldProjector(['counter', 'done']),
            semanticTolerance: 0.001,
            stablePasses: 1,
        });

        graph
            .addNode('tick', ({ counter }) => ({
                patch: { counter: counter + 1, done: counter >= 1 },
                metadata: { phase: 'tick' },
            }))
            .addEdge('tick', 'tick', (state, context) => !state.done && context.getVisitCount('tick') < 3);

        const result = await graph.invoke({ counter: 0, done: false });

        expect(result.trace[0].metadata?.phase).toBe('tick');
        expect(result.trace[0].nodeId).toBe('tick');
        expect(result.state.counter).toBeGreaterThanOrEqual(2);
    });

    it('should stop on max iterations for oscillating states', async () => {
        const graph = new ResonanceGraph<{ draft: string }>({
            startNode: 'flip',
            stateProjector: createFieldProjector(['draft']),
            semanticTolerance: 0.001,
            stablePasses: 2,
            maxIterations: 4,
        });

        graph
            .addNode('flip', ({ draft }) => ({
                patch: {
                    draft: draft === 'alpha' ? 'beta' : 'alpha',
                },
            }))
            .addEdge('flip', 'flip');

        const result = await graph.invoke({ draft: 'alpha' });

        expect(result.converged).toBe(false);
        expect(result.haltReason).toBe('max-iterations');
        expect(result.iterations).toBe(4);
    });

    it('should halt on empirical loop risk before burning the full budget', async () => {
        const graph = new ResonanceGraph<{ counter: number }>({
            startNode: 'a',
            maxIterations: 10,
            semanticTolerance: 0,
            stablePasses: 10,
            stateProjector: createFieldProjector(['counter']),
            dynamicLoopGuard: {
                windowSize: 4,
                divergenceThreshold: 0.95,
            },
        });

        graph
            .addNode('a', ({ counter }) => ({ patch: { counter: counter + 1 } }))
            .addNode('b', ({ counter }) => ({ patch: { counter: counter + 1 } }))
            .addEdge('a', 'b')
            .addEdge('b', 'a');

        const result = await graph.invoke({ counter: 0 });

        expect(result.halted).toBe(true);
        expect(result.haltReason).toBe('loop-risk');
        expect(result.iterations).toBeLessThan(10);
    });
});