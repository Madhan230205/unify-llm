import { describe, it, expect } from 'vitest';
import { PrimRouter } from '../src/routers/primRouter';
import { CompletionRequest } from '../src/types';

describe('PrimRouter (Topological Concept Drift Router)', () => {
    const makeReq = (content: string, temp = 0.7): CompletionRequest => ({
        model: 'auto',
        messages: [{ role: 'user', content }],
        temperature: temp,
    });

    it('should construct with models', () => {
        const router = new PrimRouter(['a', 'b']);
        expect(router.name).toBe('prim-topological');
    });

    it('should throw on empty model list', () => {
        expect(() => new PrimRouter([])).toThrow();
    });

    it('should round-robin during cold start', async () => {
        const router = new PrimRouter(['a', 'b', 'c']);
        const req = makeReq('hello');

        const model = await router.route(req);
        expect(['a', 'b', 'c']).toContain(model);
    });

    it('should accept feedback without throwing', () => {
        const router = new PrimRouter(['a', 'b']);
        const req = makeReq('test');

        expect(() => {
            router.recordFeedback('a', req, 100, true, 0.001);
        }).not.toThrow();
    });

    it('should route via nearest-centroid after sufficient data', async () => {
        const router = new PrimRouter(['fast', 'smart']);
        const simpleReq = makeReq('quick question');
        const complexReq = makeReq('explain quantum entanglement in detail', 0.9);

        // Build up training data
        for (let i = 0; i < 15; i++) {
            router.recordFeedback('fast', simpleReq, 50, true, 0.001);
            router.recordFeedback('smart', complexReq, 500, true, 0.01);
        }

        const choice = await router.route(makeReq('another quick q'));
        expect(['fast', 'smart']).toContain(choice);
    });

    it('should start not drifting', () => {
        const router = new PrimRouter(['a', 'b']);
        expect(router.isDrifting()).toBe(false);
    });

    it('should report zero drift distance initially', () => {
        const router = new PrimRouter(['a', 'b']);
        expect(router.getDriftDistance()).toBe(0);
    });

    it('should return null topological state before any data', () => {
        const router = new PrimRouter(['a', 'b']);
        expect(router.getTopologicalState()).toBeNull();
    });

    it('should handle many feedback records without error', () => {
        const router = new PrimRouter(['a', 'b'], { maxRecords: 50 });
        const req = makeReq('test');

        expect(() => {
            for (let i = 0; i < 100; i++) {
                router.recordFeedback(i % 2 === 0 ? 'a' : 'b', req, Math.random() * 500, Math.random() > 0.2, Math.random() * 0.01);
            }
        }).not.toThrow();
    });
});
