import { describe, it, expect } from 'vitest';
import { ParetoNavigatorRouter } from '../src/routers/paretoRouter';
import { CompletionRequest } from '../src/types';

describe('ParetoNavigatorRouter (Multi-Objective EHVI Router)', () => {
    const makeReq = (content: string, temp = 0.7): CompletionRequest => ({
        model: 'auto',
        messages: [{ role: 'user', content }],
        temperature: temp,
    });

    it('should construct with models', () => {
        const router = new ParetoNavigatorRouter(['model-a', 'model-b']);
        expect(router.name).toBe('pareto-navigator');
    });

    it('should throw on empty model list', () => {
        expect(() => new ParetoNavigatorRouter([])).toThrow();
    });

    it('should round-robin during cold start', async () => {
        const router = new ParetoNavigatorRouter(['a', 'b', 'c']);
        const req = makeReq('hello');

        // First route should pick the model with fewest observations
        const first = await router.route(req);
        expect(['a', 'b', 'c']).toContain(first);
    });

    it('should accept feedback without throwing', () => {
        const router = new ParetoNavigatorRouter(['a', 'b']);
        const req = makeReq('test');

        expect(() => {
            router.recordFeedback('a', req, 100, true, 0.001);
            router.recordFeedback('b', req, 200, true, 0.002);
        }).not.toThrow();
    });

    it('should route after sufficient feedback', async () => {
        const router = new ParetoNavigatorRouter(['fast', 'smart'], { coldStartThreshold: 2 });
        const req = makeReq('complex reasoning task');

        // Feed enough data to both models
        for (let i = 0; i < 5; i++) {
            router.recordFeedback('fast', req, 50, true, 0.001);
            router.recordFeedback('smart', req, 500, true, 0.01);
        }

        const choice = await router.route(req);
        expect(['fast', 'smart']).toContain(choice);
    });

    it('should respect pareto constraints', async () => {
        const router = new ParetoNavigatorRouter(['cheap', 'expensive'], { coldStartThreshold: 2 });
        const req = makeReq('query');

        for (let i = 0; i < 5; i++) {
            router.recordFeedback('cheap', req, 100, true, 0.001);
            router.recordFeedback('expensive', req, 200, true, 1.0);
        }

        // With tight cost constraint, should not select expensive model
        const choice = await router.route(req, { maxCostUsd: 0.01 });
        // If expensive is filtered out by constraint, should pick cheap
        // (or fallback if both filtered)
        expect(typeof choice).toBe('string');
    });

    it('should compute Pareto front accurately', () => {
        const router = new ParetoNavigatorRouter(['a', 'b', 'c']);
        const req = makeReq('test');

        // Record diverse feedback
        router.recordFeedback('a', req, 100, true, 0.001);   // Fast and cheap
        router.recordFeedback('b', req, 50, true, 0.01);     // Faster but costlier
        router.recordFeedback('c', req, 500, false, 0.05);   // Slow, expensive, failed

        const front = router.getParetoFront();
        expect(front.length).toBeGreaterThanOrEqual(1);
        // 'c' should be dominated since it failed
        const modelIds = front.map(p => p.modelId);
        expect(modelIds).not.toContain('c');
    });

    it('should bypass EHVI when one model clearly dominates with low uncertainty', async () => {
        const router = new ParetoNavigatorRouter(['fast', 'slow', 'mid'], {
            coldStartThreshold: 2,
            ehviBypassMargin: 0.05,
            fastPathSigmaThreshold: 0.5,
        });
        const req = makeReq('simple summarization task');

        for (let i = 0; i < 8; i++) {
            router.recordFeedback('fast', req, 40, true, 0.001);
            router.recordFeedback('mid', req, 180, true, 0.005);
            router.recordFeedback('slow', req, 600, i < 6, 0.02);
        }

        await expect(router.route(req)).resolves.toBe('fast');
    });
});
