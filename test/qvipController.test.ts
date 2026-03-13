import { describe, expect, it } from 'vitest';
import { QVIPController } from '../src/algorithms/qvipController';

describe('QVIPController', () => {
    it('should classify low anomaly as SAFE', () => {
        const ctrl = new QVIPController({ thetaLow: 0.3, thetaHigh: 0.7 });
        const snapshot = ctrl.update({ anomalyScore: 0.05, instabilityJump: 0.01 });

        expect(snapshot.state).toBe('SAFE');
        expect(snapshot.risk).toBeGreaterThanOrEqual(0);
        expect(snapshot.risk).toBeLessThan(0.3);
    });

    it('should move to UNSAFE under strong sustained signal', () => {
        const ctrl = new QVIPController({ thetaLow: 0.2, thetaHigh: 0.45 });

        ctrl.update({ anomalyScore: 0.4, instabilityJump: 0.3, strongSignal: true });
        const snapshot = ctrl.update({ anomalyScore: 0.8, instabilityJump: 0.5, strongSignal: true });

        expect(snapshot.state).toBe('UNSAFE');
        expect(snapshot.risk).toBeGreaterThanOrEqual(0.45);
    });

    it('should discount risk with strong verification confidence', () => {
        const ctrl = new QVIPController({ thetaLow: 0.2, thetaHigh: 0.6 });

        const baseline = ctrl.update({ anomalyScore: 0.55, instabilityJump: 0.2, strongSignal: true });
        const verified = ctrl.update({
            anomalyScore: 0.55,
            instabilityJump: 0,
            strongSignal: false,
            verificationConfidence: 0.95,
        });

        expect(verified.risk).toBeLessThanOrEqual(baseline.risk);
    });
});
