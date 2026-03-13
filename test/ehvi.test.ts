import { describe, it, expect } from 'vitest';
import {
    dominates,
    findParetoFront,
    computeHypervolume,
    computeEHVI,
    ParetoPoint,
    GPPrediction,
} from '../src/analytics/ehvi';

describe('EHVI Engine (Expected Hypervolume Improvement)', () => {
    describe('dominates()', () => {
        it('should detect strict domination', () => {
            expect(dominates([5, 5, 5], [3, 3, 3])).toBe(true);
        });

        it('should not dominate equal vectors', () => {
            expect(dominates([5, 5, 5], [5, 5, 5])).toBe(false);
        });

        it('should not dominate when any dimension is worse', () => {
            expect(dominates([5, 3, 5], [5, 4, 5])).toBe(false);
        });

        it('should handle partial domination (at least one strictly better)', () => {
            expect(dominates([5, 5, 6], [5, 5, 5])).toBe(true);
        });
    });

    describe('findParetoFront()', () => {
        it('should return all points when none dominate each other', () => {
            const points: ParetoPoint[] = [
                { objectives: [10, 1], modelId: 'a' },
                { objectives: [1, 10], modelId: 'b' },
            ];
            const front = findParetoFront(points);
            expect(front.length).toBe(2);
        });

        it('should filter dominated points', () => {
            const points: ParetoPoint[] = [
                { objectives: [10, 10], modelId: 'a' },
                { objectives: [5, 5], modelId: 'b' },
                { objectives: [12, 3], modelId: 'c' },
            ];
            const front = findParetoFront(points);
            expect(front.length).toBe(2); // 'a' dominates 'b', 'c' is non-dominated
            expect(front.find(p => p.modelId === 'b')).toBeUndefined();
        });

        it('should handle empty input', () => {
            expect(findParetoFront([])).toEqual([]);
        });

        it('should handle single point', () => {
            const front = findParetoFront([{ objectives: [1], modelId: 'a' }]);
            expect(front.length).toBe(1);
        });
    });

    describe('computeHypervolume()', () => {
        it('should compute 1D hypervolume correctly', () => {
            const hv = computeHypervolume([[5], [3]], [0]);
            expect(hv).toBe(5); // max(5,3) - 0 = 5
        });

        it('should compute 2D hypervolume correctly', () => {
            // Single point: rectangle from ref to point
            const hv = computeHypervolume([[4, 4]], [0, 0]);
            expect(hv).toBe(16); // 4 * 4
        });

        it('should compute 2D hypervolume with multiple points', () => {
            const hv = computeHypervolume([[4, 2], [2, 4]], [0, 0]);
            // Two rectangles with overlap handling via sweep line
            // Point (4,2): sweep adds (4-0)*(2-0) = 8
            // Point (2,4): sweep adds (2-0)*(4-2) = 4
            expect(hv).toBe(12);
        });

        it('should return 0 for empty points', () => {
            expect(computeHypervolume([], [0, 0])).toBe(0);
        });

        it('should return 0 when points are below reference', () => {
            expect(computeHypervolume([[-1, -1]], [0, 0])).toBe(0);
        });

        it('should compute 3D hypervolume', () => {
            const hv = computeHypervolume([[2, 2, 2]], [0, 0, 0]);
            expect(hv).toBe(8); // 2 * 2 * 2
        });
    });

    describe('computeEHVI()', () => {
        it('should return positive EHVI for predictions that improve on empty front', () => {
            const front: ParetoPoint[] = [];
            const predictions: GPPrediction[] = [
                { mu: [5, -1, -0.01], sigma: [0.5, 0.1, 0.001], modelId: 'model-a' },
            ];
            const ref = [0, -10, -10];
            const ehvi = computeEHVI(front, predictions, ref, 200, 42);

            expect(ehvi.get('model-a')).toBeGreaterThan(0);
        });

        it('should rank models by improvement potential', () => {
            const front: ParetoPoint[] = [
                { objectives: [0.5, -2, -0.05], modelId: 'baseline' },
            ];
            const predictions: GPPrediction[] = [
                { mu: [0.9, -1, -0.02], sigma: [0.1, 0.1, 0.01], modelId: 'strong' },
                { mu: [0.5, -2, -0.05], sigma: [0.1, 0.1, 0.01], modelId: 'same' },
            ];
            const ref = [0, -10, -10];
            const ehvi = computeEHVI(front, predictions, ref, 500, 42);

            // The 'strong' model should have higher EHVI than 'same'
            expect(ehvi.get('strong')!).toBeGreaterThan(ehvi.get('same')!);
        });

        it('should return results for all predicted models', () => {
            const predictions: GPPrediction[] = [
                { mu: [1, -1, -1], sigma: [0.1, 0.1, 0.1], modelId: 'a' },
                { mu: [2, -2, -2], sigma: [0.1, 0.1, 0.1], modelId: 'b' },
                { mu: [3, -3, -3], sigma: [0.1, 0.1, 0.1], modelId: 'c' },
            ];
            const ehvi = computeEHVI([], predictions, [0, -10, -10], 100, 42);
            expect(ehvi.size).toBe(3);
        });
    });
});
