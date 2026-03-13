import { describe, expect, it } from 'vitest';
import {
    compressTopologyPoints,
    computeAdaptiveEHVISamples,
    computeEHVIAdaptive,
    computeTopologyDriftAdaptive,
    createValveTaskEnvelope,
    registerElasticComputeAccelerator,
    shouldOffloadEHVI,
    shouldOffloadTopology,
} from '../src/analytics/computeAccelerator';
import { ParetoPoint, GPPrediction } from '../src/analytics/ehvi';
import { GaussianProcess } from '../src/analytics/gaussianProcess';

describe('Compute accelerator', () => {
    it('should offload topology workloads above the safe point threshold', () => {
        const densePoints = Array.from({ length: 128 }, (_, i) => [i / 10, (i % 7) / 10, (i % 11) / 10]);
        const tinyPoints = Array.from({ length: 12 }, (_, i) => [i / 10, (i % 3) / 10, (i % 5) / 10]);

        expect(shouldOffloadTopology(densePoints)).toBe(true);
        expect(shouldOffloadTopology(tinyPoints)).toBe(false);
    });

    it('should offload EHVI workloads once sample complexity crosses the threshold', () => {
        const front: ParetoPoint[] = Array.from({ length: 5 }, (_, index) => ({
            modelId: `front-${index}`,
            objectives: [0.9 - (index * 0.05), -1 - index, -0.01 - (index * 0.005)],
        }));
        const predictions: GPPrediction[] = Array.from({ length: 4 }, (_, index) => ({
            modelId: `candidate-${index}`,
            mu: [0.8 - (index * 0.05), -1.2 - index, -0.015 - (index * 0.002)],
            sigma: [0.1, 0.1, 0.01],
        }));

        expect(shouldOffloadEHVI(front, predictions, 200)).toBe(true);
        expect(shouldOffloadEHVI(front.slice(0, 1), predictions.slice(0, 1), 20)).toBe(false);
    });

    it('should adapt EHVI samples downward for extreme complexity while preserving a floor', () => {
        const heavyFront: ParetoPoint[] = Array.from({ length: 20 }, (_, index) => ({
            modelId: `front-${index}`,
            objectives: [0.95 - (index * 0.01), -1.2 - index, -0.02 - (index * 0.001)],
        }));
        const heavyPredictions: GPPrediction[] = Array.from({ length: 12 }, (_, index) => ({
            modelId: `candidate-${index}`,
            mu: [0.8 - (index * 0.01), -1.5 - index, -0.025 - (index * 0.001)],
            sigma: [0.07, 0.1, 0.01],
        }));

        const adaptedHeavy = computeAdaptiveEHVISamples(heavyFront, heavyPredictions, 400);
        const adaptedLight = computeAdaptiveEHVISamples(heavyFront.slice(0, 1), heavyPredictions.slice(0, 1), 40);

        expect(adaptedHeavy).toBeLessThan(400);
        expect(adaptedHeavy).toBeGreaterThanOrEqual(64);
        expect(adaptedLight).toBe(40);
    });

    it('should compute topology drift snapshots asynchronously-compatible', async () => {
        const baseline = Array.from({ length: 130 }, (_, index) => [index / 100, (index % 9) / 10, (index % 13) / 10]);
        const shifted = baseline.map((point, index) => [point[0] + 0.5, point[1] + ((index % 5) * 0.01), point[2]]);

        const first = await computeTopologyDriftAdaptive(baseline, null, 20, 7);
        const second = await computeTopologyDriftAdaptive(shifted, first.state.diagram, 20, 8);

        expect(first.state.diagram.length).toBeGreaterThan(0);
        expect(second.driftDistance).toBeGreaterThanOrEqual(0);
    });

    it('should preserve EHVI results through the adaptive layer', async () => {
        const front: ParetoPoint[] = Array.from({ length: 6 }, (_, index) => ({
            modelId: `front-${index}`,
            objectives: [0.95 - (index * 0.03), -1 - index, -0.01 - (index * 0.003)],
        }));
        const predictions: GPPrediction[] = Array.from({ length: 5 }, (_, index) => ({
            modelId: `candidate-${index}`,
            mu: [0.85 - (index * 0.02), -1.1 - index, -0.011 - (index * 0.002)],
            sigma: [0.08, 0.09, 0.01],
        }));

        const scores = await computeEHVIAdaptive(front, predictions, [0, -10, -10], 200, 123);
        expect(scores.size).toBe(predictions.length);
    });

    it('should compress topology points deterministically for heavy clouds', () => {
        const points = Array.from({ length: 500 }, (_, i) => [Math.sin(i / 17), Math.cos(i / 19), (i % 37) / 37]);

        const compressedA = compressTopologyPoints(points, 192, 11);
        const compressedB = compressTopologyPoints(points, 192, 11);

        expect(compressedA.length).toBe(192);
        expect(compressedA).toEqual(compressedB);
    });

    it('should encode workloads into transferable binary envelopes', () => {
        const ehviEnvelope = createValveTaskEnvelope({
            type: 'ehvi',
            paretoFront: [{ modelId: 'front-0', objectives: [0.9, -1.1, -0.01] }],
            gpPredictions: [{ modelId: 'candidate-0', mu: [0.8, -1.2, -0.02], sigma: [0.1, 0.2, 0.01] }],
            ref: [0, -10, -10],
            samples: 128,
            seed: 42,
        });

        expect(ehviEnvelope.task.type).toBe('ehvi');
        expect((ehviEnvelope.task as { transport?: string }).transport).toBe('binary');
        expect(ehviEnvelope.transferList).toHaveLength(3);

        const topologyEnvelope = createValveTaskEnvelope({
            type: 'topology',
            points: [[0, 1, 2], [3, 4, 5]],
            baselineDiagram: [{ birth: 0, death: 1, dimension: 0 }],
            projections: 20,
            seed: 7,
        });

        expect(topologyEnvelope.task.type).toBe('topology');
        expect((topologyEnvelope.task as { transport?: string }).transport).toBe('binary');
        expect(topologyEnvelope.transferList).toHaveLength(2);
    });

    it('should clamp unsafe synchronous GP observation counts', () => {
        const gp = new GaussianProcess(1.0, 1.0, 1e-6, 500);
        const diagnostics = gp.getDiagnostics();

        expect(diagnostics.requestedMaxObservations).toBe(500);
        expect(diagnostics.maxObservations).toBe(64);
        expect(diagnostics.syncSafetyCapApplied).toBe(true);
    });

    it('should prefer registered accelerators before worker offload', async () => {
        registerElasticComputeAccelerator({
            name: 'mock-accelerator',
            computeEHVI: async ({ gpPredictions }) => gpPredictions.map((prediction, index) => [prediction.modelId, 1 - (index * 0.1)]),
            computeTopology: async () => ({
                state: {
                    diagram: [{ birth: 0, death: 1, dimension: 0 }],
                    componentCount: 1,
                    maxPersistence: 1,
                    timestamp: 0,
                },
                driftDistance: 0.123,
            }),
        });

        const scores = await computeEHVIAdaptive(
            [{ modelId: 'front', objectives: [1, -1, -0.01] }],
            [{ modelId: 'candidate-a', mu: [0.8, -1.2, -0.02], sigma: [0.1, 0.1, 0.01] }],
            [0, -10, -10],
            200,
            3,
        );

        const drift = await computeTopologyDriftAdaptive([[0, 0, 0], [1, 1, 1]], null, 20, 11);

        expect(scores.get('candidate-a')).toBe(1);
        expect(drift.driftDistance).toBeCloseTo(0.123, 6);

        registerElasticComputeAccelerator(null);
    });
});
