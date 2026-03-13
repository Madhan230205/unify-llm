import { describe, expect, it } from 'vitest';
import {
    BayesianUtilityRouter,
    buildSemanticProjection,
    ComplexityThresholdRouter,
    computeSemanticFingerprintDistance,
    computeTransitionSpectralRadius,
    CostLatencyQualityRouter,
    createHallucinationGuard,
    createSemanticFingerprint,
    EntropyThresholdRouter,
    ExecutionLoopDivergenceError,
    LoopDivergenceError,
    MultiObjectiveRouter,
    ResponseAnomalyDetector,
    SemanticDriftDetector,
    TokenTrajectoryAnalyzer,
    TopologicalDriftRouter,
    createSemanticConvergenceGuard,
} from '../src';

describe('pragmatic aliases', () => {
    it('should expose clearer public aliases without removing the original APIs', () => {
        expect(typeof BayesianUtilityRouter).toBe('function');
        expect(typeof ComplexityThresholdRouter).toBe('function');
        expect(typeof CostLatencyQualityRouter).toBe('function');
        expect(typeof EntropyThresholdRouter).toBe('function');
        expect(typeof MultiObjectiveRouter).toBe('function');
        expect(typeof ResponseAnomalyDetector).toBe('function');
        expect(typeof TopologicalDriftRouter).toBe('function');
        expect(typeof createSemanticConvergenceGuard).toBe('function');
        expect(typeof createHallucinationGuard).toBe('function');
        expect(typeof createSemanticFingerprint).toBe('function');
        expect(typeof SemanticDriftDetector).toBe('function');
        expect(typeof TokenTrajectoryAnalyzer).toBe('function');
        expect(typeof buildSemanticProjection).toBe('function');
        expect(typeof computeSemanticFingerprintDistance).toBe('function');
        expect(typeof computeTransitionSpectralRadius).toBe('function');
        expect(new LoopDivergenceError('loop')).toBeInstanceOf(Error);
        expect(new ExecutionLoopDivergenceError('loop')).toBeInstanceOf(Error);
    });
});