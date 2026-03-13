import { describe, expect, it } from 'vitest';
import { GaussianProcess } from '../src/analytics/gaussianProcess';

describe('GaussianProcess numerical hardening', () => {
    it('should remain stable for near-duplicate observations', () => {
        const gp = new GaussianProcess(1.0, 1.0, 1e-12, 64);
        const x = [0.25, 0.5, 0.75];

        for (let i = 0; i < 10; i++) {
            // Extremely close points that would usually stress covariance conditioning
            gp.addObservation([
                x[0] + (i * 1e-12),
                x[1] - (i * 1e-12),
                x[2] + ((i % 2) * 1e-12),
            ], 1 + (i * 1e-6));
        }

        const diagnostics = gp.getDiagnostics();
        expect(diagnostics.observationCount).toBeGreaterThan(0);
        expect(Number.isFinite(diagnostics.conditionNumber)).toBe(true);
        expect(diagnostics.effectiveNoiseVariance).toBeGreaterThanOrEqual(1e-12);
    });

    it('should produce finite posterior mean and variance', () => {
        const gp = new GaussianProcess(0.8, 1.2, 1e-8, 64);

        for (let i = 0; i < 20; i++) {
            const t = i / 19;
            gp.addObservation([t, t * t, Math.sin(t)], Math.cos(t));
        }

        const prediction = gp.predict([0.42, 0.42 * 0.42, Math.sin(0.42)]);
        expect(Number.isFinite(prediction.mu)).toBe(true);
        expect(Number.isFinite(prediction.sigma)).toBe(true);
        expect(prediction.sigma).toBeGreaterThan(0);
    });

    it('should provide finite kinematic gradient estimates', () => {
        const gp = new GaussianProcess(1.0, 1.0, 1e-6, 64);

        for (let i = 0; i < 12; i++) {
            const temp = i / 11;
            gp.addObservation([0.2, 0.4, 0.6, temp], 0.5 + (0.1 * Math.sin(temp * Math.PI)));
        }

        const gradient = gp.optimizeKinematicGradient([0.2, 0.4, 0.6, 0.5], 3);
        expect(Number.isFinite(gradient)).toBe(true);
    });

    it('should remain finite through long sequential append growth', () => {
        const gp = new GaussianProcess(0.6, 1.0, 1e-7, 64);

        for (let i = 0; i < 48; i++) {
            const t = i / 47;
            gp.addObservation([
                Math.sin(t * Math.PI),
                Math.cos(t * Math.PI * 0.5),
                t,
                t * t,
            ], Math.sin(t * Math.PI * 2));
        }

        const prediction = gp.predict([0.72, Math.cos(0.72 * Math.PI * 0.5), 0.72, 0.72 * 0.72]);
        const diagnostics = gp.getDiagnostics();

        expect(Number.isFinite(prediction.mu)).toBe(true);
        expect(Number.isFinite(prediction.sigma)).toBe(true);
        expect(Number.isFinite(diagnostics.conditionNumber)).toBe(true);
        expect(diagnostics.observationCount).toBe(48);
    });
});
