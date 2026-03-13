/**
 * PrimRouter — Topological Concept Drift Router
 * 
 * The first LLM router to detect concept drift using persistent homology.
 * Tracks H₀ connected components in the performance manifold and triggers
 * model re-evaluation when the topology fractures.
 * 
 * Innovation:
 *   Traditional routers: Fixed routing table, retrained periodically
 *   PrimRouter: Continuous topological monitoring via Sliced Wasserstein-2
 *     distance between persistence diagrams. When SW₂(D_current, D_baseline) > τ,
 *     the router detects that the performance landscape has undergone regime change
 *     and initiates exploration.
 * 
 * Named after Prim's algorithm — just as Prim builds minimum spanning trees
 * to connect components, PrimRouter watches components in the persistence
 * diagram to understand the connectivity of the performance landscape.
 * 
 * Mathematical Foundation:
 *   - H₀ persistence via Vietoris-Rips filtration on [quality, latency, cost] space
 *   - Sliced Wasserstein-2 for diagram comparison (K=50 projections)
 *   - Nearest-centroid routing within topological basins
 * 
 * Zero dependencies. Pure TypeScript.
 */

import { CompletionRequest } from '../types';
import { analyzeSemanticStability, computeSemanticInstabilityRisk } from '../analytics/semanticFingerprintEngine';
import {
    TopologicalState,
    computeSlicedWasserstein,
} from '../analytics/topologyPersistence';
import { computeTopologyDriftAdaptive } from '../analytics/computeAccelerator';
import { FsStore } from '../storage/fsStore';

interface PerformanceRecord {
    modelId: string;
    featureVector: number[];
    objectivePoint: number[]; // [quality, -latency, -cost] in objective space
    stabilityRisk: number;
    timestamp: number;
}

export class PrimRouter {
    public readonly name = 'prim-topological';
    private models: string[];
    private records: PerformanceRecord[] = [];
    private baselineTopology: TopologicalState | null = null;
    private currentTopology: TopologicalState | null = null;
    private driftThreshold: number;
    private explorationBoost: number;
    private isExploring = false;
    private maxRecords: number;
    private store?: FsStore;
    private requestCount = 0;
    private topologyUpdatePromise: Promise<void> | null = null;
    private topologyRevision = 0;

    constructor(
        models: string[],
        options: {
            driftThreshold?: number;
            explorationBoost?: number;
            maxRecords?: number;
            store?: FsStore;
        } = {}
    ) {
        if (models.length === 0) {
            throw new Error('PrimRouter requires at least one model.');
        }
        this.models = models;
        this.driftThreshold = options.driftThreshold ?? 0.5;
        this.explorationBoost = options.explorationBoost ?? 3.0;
        this.maxRecords = options.maxRecords ?? 500;
        this.store = options.store;
    }

    /**
     * Extract feature vector from request (same space as other routers).
     */
    private extractFeatureVector(req: CompletionRequest): number[] {
        const msgCount = req.messages.length;
        let rawText = '';
        const totalLen = req.messages.reduce((sum: number, m) => {
            const content = typeof m.content === 'string' ? m.content : '';
            rawText += content + ' ';
            return sum + content.length;
        }, 0);
        const toolsCount = req.tools ? req.tools.length : 0;
        const temp = req.temperature ?? 0.7;
        const stability = analyzeSemanticStability(rawText);
        const [dCode, dChat, dJson] = stability.projection;

        return [
            msgCount / 10.0,
            Math.min(totalLen / 5000.0, 1.0),
            toolsCount / 5.0,
            temp,
            dCode,
            dChat,
            dJson,
        ];
    }

    private extractStabilityRisk(req: CompletionRequest): number {
        const rawText = req.messages
            .map(m => (typeof m.content === 'string' ? m.content : ''))
            .join(' ');
        return computeSemanticInstabilityRisk(analyzeSemanticStability(rawText));
    }

    /**
     * Record feedback and update topological state.
     */
    public recordFeedback(
        modelId: string,
        req: CompletionRequest,
        latencyMs: number,
        success: boolean,
        costUsd: number
    ): void {
        const featureVector = this.extractFeatureVector(req);
        const stabilityRisk = this.extractStabilityRisk(req);
        const quality = success ? 1.0 : 0.0;

        this.records.push({
            modelId,
            featureVector,
            objectivePoint: [quality, -latencyMs / 1000.0, -costUsd],
            stabilityRisk,
            timestamp: Date.now(),
        });

        // Evict oldest records if over capacity
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }

        this.requestCount++;

        // Recompute topology every 20 records
        if (this.records.length >= 5 && this.requestCount % 20 === 0) {
            this.topologyRevision++;
            const revision = this.topologyRevision;
            const objectivePoints = this.records.map(r => r.objectivePoint);
            const baselineDiagram = this.baselineTopology?.diagram ?? null;
            this.topologyUpdatePromise = this.updateTopologyAsync(objectivePoints, baselineDiagram, revision);
        }
    }

    /**
     * Recompute persistence diagram and check for drift.
     */
    private async updateTopologyAsync(
        objectivePoints: number[][],
        baselineDiagram: TopologicalState['diagram'] | null,
        revision: number,
    ): Promise<void> {
        const { state: newTopology, driftDistance } = await computeTopologyDriftAdaptive(
            objectivePoints,
            baselineDiagram,
            50,
            revision,
        );

        if (revision !== this.topologyRevision) {
            return;
        }

        if (this.baselineTopology === null) {
            // First topology computation — set as baseline
            this.baselineTopology = newTopology;
            this.currentTopology = newTopology;
            this.isExploring = false;
            return;
        }

        this.currentTopology = newTopology;

        if (driftDistance > this.driftThreshold) {
            // Topology has shifted — enter exploration mode
            this.isExploring = true;
            // Reset baseline after exploration settles (next topology update)
        } else if (this.isExploring) {
            // Drift resolved — update baseline and exit exploration
            this.baselineTopology = newTopology;
            this.isExploring = false;
        }
    }

    /**
     * Route a request using nearest-centroid matching within topological basins.
     * 
     * Algorithm:
     * 1. Cold start: round-robin until enough data
     * 2. If exploring (drift detected): select least-sampled model (forced exploration)
     * 3. Normal mode: compute centroid of each model's feature vectors,
     *    select model whose centroid is nearest to the current request
     */
    public async route(req: CompletionRequest): Promise<string> {
        if (this.topologyUpdatePromise) {
            await this.topologyUpdatePromise.catch(() => undefined);
            this.topologyUpdatePromise = null;
        }

        // Cold start: round-robin
        if (this.records.length < this.models.length * 3) {
            const counts = new Map<string, number>();
            for (const m of this.models) counts.set(m, 0);
            for (const r of this.records) {
                counts.set(r.modelId, (counts.get(r.modelId) ?? 0) + 1);
            }
            let minModel = this.models[0];
            let minCount = Infinity;
            for (const [model, count] of counts) {
                if (count < minCount) {
                    minCount = count;
                    minModel = model;
                }
            }
            return minModel;
        }

        // Exploration mode: select least-sampled model to gather diverse data
        if (this.isExploring) {
            const counts = new Map<string, number>();
            for (const m of this.models) counts.set(m, 0);
            // Only count recent records (last 50)
            const recent = this.records.slice(-50);
            for (const r of recent) {
                counts.set(r.modelId, (counts.get(r.modelId) ?? 0) + 1);
            }
            let minModel = this.models[0];
            let minCount = Infinity;
            for (const [model, count] of counts) {
                if (count < minCount) {
                    minCount = count;
                    minModel = model;
                }
            }
            return minModel;
        }

        // Normal mode: nearest-centroid routing
        const xStar = this.extractFeatureVector(req);
        const requestRisk = this.extractStabilityRisk(req);

        // Compute centroid of successful observations per model
        const centroids = new Map<string, { sum: number[]; count: number; avgQuality: number; avgStabilityRisk: number }>();

        for (const record of this.records) {
            let entry = centroids.get(record.modelId);
            if (!entry) {
                entry = {
                    sum: new Array(xStar.length).fill(0),
                    count: 0,
                    avgQuality: 0,
                    avgStabilityRisk: 0,
                };
                centroids.set(record.modelId, entry);
            }
            for (let i = 0; i < xStar.length; i++) {
                entry.sum[i] += record.featureVector[i];
            }
            entry.count++;
            entry.avgQuality += record.objectivePoint[0]; // quality
            entry.avgStabilityRisk += record.stabilityRisk;
        }

        let bestModel = this.models[0];
        let bestScore = -Infinity;

        for (const model of this.models) {
            const entry = centroids.get(model);
            if (!entry || entry.count === 0) continue;

            // Compute centroid
            const centroid = entry.sum.map(s => s / entry.count);
            const avgQuality = entry.avgQuality / entry.count;
            const avgStabilityRisk = entry.avgStabilityRisk / entry.count;

            // Distance from request to centroid (lower is better → negate)
            let dist = 0;
            for (let i = 0; i < xStar.length; i++) {
                const d = xStar[i] - centroid[i];
                dist += d * d;
            }
            dist = Math.sqrt(dist);

            // Score: quality-weighted inverse distance
            // Models with high quality AND proximity to the request score highest
            const stabilityMismatch = Math.abs(requestRisk - avgStabilityRisk);
            const score = avgQuality / ((dist + 0.01) * (1 + stabilityMismatch));

            if (score > bestScore) {
                bestScore = score;
                bestModel = model;
            }
        }

        return bestModel;
    }

    /**
     * Check if the router has detected concept drift.
     */
    public isDrifting(): boolean {
        return this.isExploring;
    }

    /**
     * Get the current topological state for inspection.
     */
    public getTopologicalState(): TopologicalState | null {
        return this.currentTopology;
    }

    /**
     * Get the Sliced Wasserstein distance between baseline and current topology.
     * Returns 0 if no baseline exists yet.
     */
    public getDriftDistance(): number {
        if (!this.baselineTopology || !this.currentTopology) return 0;
        return computeSlicedWasserstein(this.baselineTopology.diagram, this.currentTopology.diagram, 50);
    }
}
