import { describe, it, expect } from 'vitest';
import {
    spectralRadius,
    invertMatrix,
    hasDivergentLoop,
    resolveConsensus,
    buildEmpiricalTransitionMatrix,
    assessDynamicLoopRisk,
} from '../src/analytics/loopRiskEngine';

describe('Loop Risk Engine', () => {
    describe('spectralRadius(T)', () => {
        it('should return 0 for an empty matrix', () => {
            expect(spectralRadius([])).toBe(0);
        });

        it('should accurately calculate the dominant eigenvalue for a convergent DAG (rho < 1)', () => {
            const T = [
                [0.1, 0.2, 0.0],
                [0.4, 0.0, 0.3],
                [0.1, 0.1, 0.2]
            ];
            const rho = spectralRadius(T);

            expect(rho).toBeGreaterThan(0.3);
            expect(rho).toBeLessThan(1);
        });

        it('should mathematically identify a diverging infinite loop (rho > 1)', () => {
            const T = [
                [1.0, 2.0],
                [2.0, 1.0]
            ];
            const rho = spectralRadius(T);
            expect(rho).toBeCloseTo(3.0, 3);
        });

        it('should correctly handle a nilpotent matrix (straight line DAG)', () => {
            const T = [
                [0, 1, 0],
                [0, 0, 1],
                [0, 0, 0]
            ];
            const rho = spectralRadius(T);

            expect(rho).toBeCloseTo(0, 3);
        });
    });

    describe('hasDivergentLoop(T)', () => {
        it('should return true for an explosive matrix requiring a circuit breaker', () => {
            const T = [
                [1.5, 0.5],
                [0.5, 1.5]
            ];
            expect(hasDivergentLoop(T)).toBe(true);
        });

        it('should return false for a safe terminating agentic workflow', () => {
            const T = [
                [0.0, 0.9, 0.9],
                [0.0, 0.0, 0.9],
                [0.0, 0.0, 0.0]
            ];
            expect(hasDivergentLoop(T)).toBe(false);
        });

        it('should not flag a normalized stochastic matrix as divergent just because rho = 1', () => {
            const T = [
                [0.5, 0.5],
                [0.25, 0.75],
            ];

            expect(spectralRadius(T)).toBeCloseTo(1, 3);
            expect(hasDivergentLoop(T)).toBe(false);
        });
    });

    describe('empirical recurrence-risk assessment', () => {
        it('should not misclassify a valid stochastic progression as divergent', () => {
            const observations = [
                { from: 'draft', to: 'review' },
                { from: 'review', to: 'approve' },
                { from: 'approve', to: 'complete' },
                { from: 'draft', to: 'review' },
                { from: 'review', to: 'approve' },
            ];

            const { matrix } = buildEmpiricalTransitionMatrix(observations, 0.01);
            const rowSums = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
            for (const sum of rowSums) {
                expect(sum).toBeCloseTo(1, 6);
            }

            const risk = assessDynamicLoopRisk(observations, { smoothing: 0.01 });
            expect(risk.spectralRadius).toBeGreaterThan(0.99);
            expect(risk.recurrenceScore).toBeLessThan(0.2);
            expect(risk.divergent).toBe(false);
        });

        it('should flag a sustained oscillatory attractor as divergent', () => {
            const observations = Array.from({ length: 24 }, (_, index) => {
                return index % 2 === 0
                    ? { from: 'planner', to: 'critic' }
                    : { from: 'critic', to: 'planner' };
            });

            const risk = assessDynamicLoopRisk(observations, { smoothing: 0.01, divergenceThreshold: 0.7 });
            expect(risk.cyclicComponentCount).toBeGreaterThan(0);
            expect(risk.recurrenceScore).toBeGreaterThan(0.7);
            expect(risk.divergent).toBe(true);
        });
    });

    describe('invertMatrix(M)', () => {
        it('should invert a 2x2 matrix perfectly via Gauss-Jordan elimination', () => {
            const M = [
                [4, 7],
                [2, 6]
            ];
            const inv = invertMatrix(M);
            expect(inv[0][0]).toBeCloseTo(0.6, 5);
            expect(inv[0][1]).toBeCloseTo(-0.7, 5);
            expect(inv[1][0]).toBeCloseTo(-0.2, 5);
            expect(inv[1][1]).toBeCloseTo(0.4, 5);
        });

        it('should throw on a mathematically singular matrix', () => {
            const M = [
                [1, 2],
                [2, 4]
            ];
            expect(() => invertMatrix(M)).toThrow('Matrix is singular');
        });
    });

    describe('resolveConsensus(A, B)', () => {
        it('should find the exact O(1) stationary state for multi-agent consensus', () => {
            const converging_A = [
                [0.4, 0.3],
                [0.2, 0.5]
            ];
            const B = [3, 1];

            const state = resolveConsensus(converging_A, B);
            expect(state[0]).toBeCloseTo(7.5, 4);
            expect(state[1]).toBeCloseTo(5.0, 4);
        });

        it('should stay finite for tightly conditioned but convergent systems', () => {
            const A = [
                [0.999, 0.0004],
                [0.0003, 0.9985],
            ];
            const B = [0.5, -0.25];

            const state = resolveConsensus(A, B);
            expect(Number.isFinite(state[0])).toBe(true);
            expect(Number.isFinite(state[1])).toBe(true);
        });
    });
});