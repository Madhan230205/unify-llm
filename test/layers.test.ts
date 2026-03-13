import { describe, expect, it } from 'vitest';
import {
    inspectRouterHealth,
    inspectSafetySignal,
    profilePrompt,
} from '../src';
import { CompletionRequest } from '../src/types';
import { PrimRouter } from '../src/routers/primRouter';

describe('Business layers', () => {
    it('should profile prompts into route classes and manifold metrics', () => {
        const request: CompletionRequest = {
            model: 'demo',
            messages: [{ role: 'user', content: 'Write a TypeScript function foo(x: number) { return x * 2; }' }],
        };

        const profile = profilePrompt(request);

        expect(profile.manifold).toHaveLength(3);
        expect(['chat', 'code', 'data']).toContain(profile.routeClass);
        expect(profile.entropy).toBeGreaterThanOrEqual(0);
    });

    it('should normalize safety signals from response metadata', () => {
        const signal = inspectSafetySignal({
            content: 'partial',
            model: 'demo',
            providerSpecific: {
                curvatureAnomaly: true,
                semanticCurvature: 0.92,
                semanticDrift: 0.31,
            },
        });

        expect(signal.curvatureAnomaly).toBe(true);
        expect(signal.safe).toBe(false);
        expect(signal.semanticCurvature).toBeCloseTo(0.92, 6);
    });

    it('should expose router check-engine style health summary', () => {
        const router = new PrimRouter(['openai/gpt-4o-mini']);
        const health = inspectRouterHealth(router);

        expect(health.topologyKnown).toBe(false);
        expect(['stable', 'watch', 'recalibrating']).toContain(health.status);
        expect(health.driftDistance).toBeGreaterThanOrEqual(0);
    });
});
