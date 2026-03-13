import { describe, it, expect } from 'vitest';
import { createSemanticMomentumGuardian } from '../src/middlewares/hallucinationGuard';
import { CompletionRequest, CompletionResponse } from '../src/types';

describe('Hallucination guard middleware', () => {
    const makeReq = (content: string): CompletionRequest => ({
        model: 'gpt-4',
        messages: [{ role: 'user', content }],
    });

    const makeResponse = (content: string): CompletionResponse => ({
        content,
        model: 'gpt-4',
    });

    it('should create middleware with default options', () => {
        const guard = createSemanticMomentumGuardian();
        expect(guard.wrapGenerate).toBeDefined();
        expect(guard.wrapStream).toBeDefined();
        expect(guard.getStats).toBeDefined();
    });

    it('should pass through coherent responses without annotation as anomaly', async () => {
        const guard = createSemanticMomentumGuardian();
        const req = makeReq('What is the capital of France?');
        const expectedResponse = makeResponse('The capital of France is Paris. It is located in northern France and is known for landmarks like the Eiffel Tower and the Louvre Museum.');

        const next = async () => expectedResponse;
        const result = await guard.wrapGenerate!(req, next);

        expect(result.content).toBe(expectedResponse.content);
        expect(result.providerSpecific?.semanticCurvature).toBeDefined();
        expect(result.providerSpecific?.semanticConditionNumber).toBeDefined();
        expect(result.providerSpecific?.semanticInstability).toBeDefined();
    });

    it('should accumulate curvature statistics over multiple requests', async () => {
        const guard = createSemanticMomentumGuardian();
        const next = async () => makeResponse('This is a coherent answer about programming in TypeScript and JavaScript which are popular languages used in web development.');

        for (let i = 0; i < 5; i++) {
            await guard.wrapGenerate!(makeReq('Tell me about programming'), next);
        }

        const stats = guard.getStats();
        expect(stats.count).toBeGreaterThan(0);
        expect(typeof stats.mean).toBe('number');
        expect(typeof stats.variance).toBe('number');
    });

    it('should not flag anomaly with insufficient baseline data', async () => {
        const guard = createSemanticMomentumGuardian({ alpha: 1.0 });
        const req = makeReq('Hello world');
        const response = makeResponse('Random completely different text about astrophysics and the formation of neutron stars');

        const next = async () => response;
        const result = await guard.wrapGenerate!(req, next);
        expect(result.providerSpecific?.curvatureAnomaly).toBe(false);
    });

    it('should handle empty response content gracefully', async () => {
        const guard = createSemanticMomentumGuardian();
        const req = makeReq('Test');
        const response = makeResponse('');

        const next = async () => response;
        const result = await guard.wrapGenerate!(req, next);
        expect(result.content).toBe('');
    });

    it('should create middleware with custom options', () => {
        const guard = createSemanticMomentumGuardian({
            alpha: 2.0,
            tau: 3,
            chunkSize: 50,
        });

        expect(guard.wrapGenerate).toBeDefined();
        expect(guard.wrapStream).toBeDefined();
    });

    it('should compute valid curvature values', async () => {
        const guard = createSemanticMomentumGuardian();
        const req = makeReq('Tell me a long story about a knight who goes on a quest to find a magical sword in a distant land beyond the mountains. The knight must face many challenges including dragons and riddles.');
        const response = makeResponse('Once upon a time there was a brave knight named Sir Galahad who set out on a great quest to find the legendary sword Excalibur which was said to be hidden in a cave beyond the Crystal Mountains far to the north where few had ever ventured before. The journey was long and full of peril as the knight faced many obstacles along winding forest paths.');

        const next = async () => response;
        const result = await guard.wrapGenerate!(req, next);

        expect(typeof result.providerSpecific?.semanticCurvature).toBe('number');
        expect(result.providerSpecific!.semanticCurvature).toBeGreaterThanOrEqual(0);
        expect(typeof result.providerSpecific?.semanticConditionNumber).toBe('number');
        expect(typeof result.providerSpecific?.semanticModalityShift).toBe('number');
    });
});

describe('Semantic trajectory helper extensions', () => {
    it('should support reset() method', async () => {
        const { KinematicTrajectory } = await import('../src/analytics/semanticTrajectory');
        const traj = new KinematicTrajectory(3);

        traj.pushCoordinate([1, 0, 0]);
        traj.pushCoordinate([0, 1, 0]);
        expect(traj.getTrajectoryLength()).toBe(2);

        traj.reset();
        expect(traj.getTrajectoryLength()).toBe(0);
    });

    it('should support getWindowedCurvature()', async () => {
        const { KinematicTrajectory } = await import('../src/analytics/semanticTrajectory');
        const traj = new KinematicTrajectory(3);

        traj.pushCoordinate([1, 0, 0]);
        traj.pushCoordinate([0, 1, 0]);
        traj.pushCoordinate([0, 0, 1]);
        traj.pushCoordinate([1, 1, 0]);
        traj.pushCoordinate([0, 1, 1]);

        const windowedK = traj.getWindowedCurvature(2);
        expect(typeof windowedK).toBe('number');
        expect(windowedK).toBeGreaterThanOrEqual(0);
    });

    it('should fall back to instantaneous curvature when insufficient data for window', async () => {
        const { KinematicTrajectory } = await import('../src/analytics/semanticTrajectory');
        const traj = new KinematicTrajectory(3);

        traj.pushCoordinate([1, 0, 0]);
        traj.pushCoordinate([0, 1, 0]);
        traj.pushCoordinate([0, 0, 1]);

        const windowedK = traj.getWindowedCurvature(5);
        const instantK = traj.getInstantaneousCurvature();
        expect(windowedK).toBe(instantK);
    });
});
