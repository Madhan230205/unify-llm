import { describe, it, expect } from 'vitest';
import { VonNeumannRouter } from '../src/routers/bayesianUtilityRouter';
import { CompletionRequest } from '../src/types';

describe('Bayesian utility router', () => {
    it('should correctly construct numeric dimensional bounds extracting prompt features', () => {
        const router = new VonNeumannRouter(['claude-3-haiku', 'gpt-4o']);

        const req: CompletionRequest = {
            model: 'auto',
            messages: [{ role: 'user', content: 'hello world' }],
            temperature: 0.5,
            tools: [{ name: 'calc', description: 'calculate', schema: { type: 'object' } }],
        };

        const featureVector = (router as any).extractFeatureVector(req);
        expect(featureVector).toEqual([
            0.1,
            11 / 5000,
            0.2,
            0,
            0.5,
            expect.closeTo(1.0114, 1),
            expect.closeTo(0.9054, 1),
            expect.closeTo(0.98, 1),
        ]);
    });

    it('should dynamically shift routing probabilities based on iterative utility feedback', async () => {
        const router = new VonNeumannRouter(['cheap-model', 'expensive-model'], 1.0, { latency: 1.0, cost: 5.0, success: 10.0 });

        const simpleReq: CompletionRequest = { model: 'auto', messages: [{ role: 'user', content: 'hi' }] };
        const complexReq: CompletionRequest = { model: 'auto', messages: [{ role: 'user', content: 'solve quantum gravity' }], temperature: 1.0 };

        for (let i = 0; i < 5; i++) {
            router.recordFeedback('cheap-model', simpleReq, 100, true, 0.001);
            router.recordFeedback('expensive-model', complexReq, 1000, true, 0.01);
            router.recordFeedback('cheap-model', complexReq, 50, false, 0.001);
            router.recordFeedback('expensive-model', simpleReq, 1000, true, 0.01);
        }

        const simpleChoice = await router.route(simpleReq);
        const complexChoice = await router.route(complexReq);

        expect(simpleChoice).toBe('cheap-model');
        expect(complexChoice).toBe('expensive-model');
    });

    it('should default to the first model identically if there are pure priors without routing history', async () => {
        const router = new VonNeumannRouter(['model-a', 'model-b']);
        const match = await router.route({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] });
        expect(match).toBe('model-a');
    });

    it('should strictly handle missing response formats when mapping structural depth', () => {
        const router = new VonNeumannRouter(['model']);
        const req: CompletionRequest = {
            model: 'auto',
            messages: [{ role: 'user', content: 'give me json' }],
            schema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    data: {
                        type: 'object',
                        properties: {
                            id: { type: 'number' },
                        },
                    },
                },
            },
        };

        const featureVector = (router as any).extractFeatureVector(req);
        expect(featureVector[3]).toBe(6 / 3.0);
    });

    it('should expose numerically stable GP diagnostics after near-duplicate observations', () => {
        const router = new VonNeumannRouter(['model-a']);
        const req: CompletionRequest = {
            model: 'auto',
            messages: [{ role: 'user', content: 'repeatable routing geometry prompt for stability analysis' }],
            temperature: 0.7,
        };

        for (let i = 0; i < 8; i++) {
            router.recordFeedback('model-a', req, 100 + i, true, 0.001);
        }

        const gp = (router as any).metrics.get('model-a');
        const diagnostics = gp.getDiagnostics();
        expect(diagnostics.observationCount).toBeGreaterThan(0);
        expect(diagnostics.effectiveNoiseVariance).toBeGreaterThanOrEqual(1e-6);
        expect(Number.isFinite(diagnostics.conditionNumber)).toBe(true);
    });
});
