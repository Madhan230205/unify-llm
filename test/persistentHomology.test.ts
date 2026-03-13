import { describe, it, expect } from 'vitest';
import {
    UnionFind,
    buildH0Persistence,
    computeSlicedWasserstein,
    computeTopologicalState,
} from '../src/analytics/topologyPersistence';

describe('Persistent Homology Engine', () => {
    describe('UnionFind', () => {
        it('should start with N components', () => {
            const uf = new UnionFind(5);
            expect(uf.getComponentCount()).toBe(5);
        });

        it('should merge components correctly', () => {
            const uf = new UnionFind(5);
            uf.union(0, 1);
            expect(uf.getComponentCount()).toBe(4);
            uf.union(2, 3);
            expect(uf.getComponentCount()).toBe(3);
            uf.union(1, 3);
            expect(uf.getComponentCount()).toBe(2);
        });

        it('should handle redundant unions', () => {
            const uf = new UnionFind(3);
            uf.union(0, 1);
            const merged = uf.union(0, 1); // Already in same set
            expect(merged).toBe(false);
            expect(uf.getComponentCount()).toBe(2);
        });

        it('should support path compression', () => {
            const uf = new UnionFind(5);
            uf.union(0, 1);
            uf.union(1, 2);
            uf.union(2, 3);
            // After path compression, find should be very fast
            const root = uf.find(3);
            expect(uf.find(0)).toBe(root);
            expect(uf.find(1)).toBe(root);
            expect(uf.find(2)).toBe(root);
        });

        it('should preserve the elder component when birth times differ', () => {
            const uf = new UnionFind(3, [5, 0, 3]);
            uf.union(0, 1);
            expect(uf.find(0)).toBe(uf.find(1));
            expect(uf.getBirth(0)).toBe(0);
        });
    });

    describe('buildH0Persistence()', () => {
        it('should return empty diagram for empty input', () => {
            expect(buildH0Persistence([])).toEqual([]);
        });

        it('should produce N-1 finite pairs + 1 infinite pair for N points', () => {
            const points = [[0, 0], [1, 0], [0, 1], [3, 3]];
            const diagram = buildH0Persistence(points);

            const finitePairs = diagram.filter(p => isFinite(p.death));
            const infinitePairs = diagram.filter(p => !isFinite(p.death));

            expect(finitePairs.length).toBe(3); // N-1
            expect(infinitePairs.length).toBe(1);
        });

        it('should have all births at 0 for H₀', () => {
            const points = [[0, 0], [5, 5], [10, 0]];
            const diagram = buildH0Persistence(points);
            for (const pair of diagram) {
                expect(pair.birth).toBe(0);
                expect(pair.dimension).toBe(0);
            }
        });

        it('should have death times in ascending order for finite pairs', () => {
            const points = [[0, 0], [1, 0], [5, 0], [10, 0]];
            const diagram = buildH0Persistence(points);
            const deaths = diagram
                .filter(p => isFinite(p.death))
                .map(p => p.death);
            for (let i = 1; i < deaths.length; i++) {
                expect(deaths[i]).toBeGreaterThanOrEqual(deaths[i - 1]);
            }
        });

        it('should produce correct death times for simple geometry', () => {
            // Two clusters: [0,0]-[1,0] and [10,0]-[11,0]
            const points = [[0, 0], [1, 0], [10, 0], [11, 0]];
            const diagram = buildH0Persistence(points);
            const finitePairs = diagram.filter(p => isFinite(p.death)).sort((a, b) => a.death - b.death);

            // First two merges at distance 1 (within clusters)
            expect(finitePairs[0].death).toBe(1);
            expect(finitePairs[1].death).toBe(1);
            // Last merge connects clusters at distance 9
            expect(finitePairs[2].death).toBe(9);
        });

        it('should respect elder rule when non-uniform birth times are provided', () => {
            const points = [[0, 0], [2, 0], [10, 0]];
            const diagram = buildH0Persistence(points, [0, 2, 1]);
            const finitePairs = diagram.filter(p => isFinite(p.death)).sort((a, b) => a.death - b.death);

            expect(finitePairs[0].birth).toBe(2);
            expect(finitePairs[0].death).toBe(2);
            expect(finitePairs[1].birth).toBe(1);
            expect(finitePairs[1].death).toBe(8);
        });
    });

    describe('computeSlicedWasserstein()', () => {
        it('should return 0 for identical diagrams', () => {
            const points = [[0, 0], [1, 0], [0, 1]];
            const diagram = buildH0Persistence(points);
            const sw = computeSlicedWasserstein(diagram, diagram);
            expect(sw).toBeCloseTo(0, 5);
        });

        it('should return 0 for two empty diagrams', () => {
            expect(computeSlicedWasserstein([], [])).toBe(0);
        });

        it('should detect differences between distinct topologies', () => {
            // Tight cluster
            const clusterA = buildH0Persistence([[0, 0], [0.1, 0], [0, 0.1]]);
            // Spread out
            const clusterB = buildH0Persistence([[0, 0], [10, 0], [0, 10]]);

            const sw = computeSlicedWasserstein(clusterA, clusterB);
            expect(sw).toBeGreaterThan(0);
        });

        it('should be symmetric', () => {
            const d1 = buildH0Persistence([[0, 0], [1, 1]]);
            const d2 = buildH0Persistence([[0, 0], [5, 5]]);
            const sw12 = computeSlicedWasserstein(d1, d2, 50, 42);
            const sw21 = computeSlicedWasserstein(d2, d1, 50, 42);
            // Approximately symmetric (PRNG seed makes it exact for same seed)
            expect(Math.abs(sw12 - sw21)).toBeLessThan(0.01);
        });
    });

    describe('computeTopologicalState()', () => {
        it('should compute a valid topological state', () => {
            const points = [[0, 0], [1, 0], [0, 1], [10, 10]];
            const state = computeTopologicalState(points);

            expect(state.diagram.length).toBeGreaterThan(0);
            expect(state.maxPersistence).toBeGreaterThan(0);
            expect(state.timestamp).toBeGreaterThan(0);
            expect(state.componentCount).toBeGreaterThanOrEqual(1);
        });

        it('should detect more components in spread-out data', () => {
            // Tight cluster - likely 1 component at median epsilon
            const tight = computeTopologicalState([
                [0, 0], [0.1, 0.1], [0.2, 0], [0, 0.2]
            ]);

            // Two separate clusters - likely 2 components
            const spread = computeTopologicalState([
                [0, 0], [0.1, 0], [100, 100], [100.1, 100]
            ]);

            expect(spread.componentCount).toBeGreaterThanOrEqual(tight.componentCount);
        });
    });
});
