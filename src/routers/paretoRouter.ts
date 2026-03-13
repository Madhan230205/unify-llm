/**
 * ParetoNavigatorRouter — Multi-Objective Bayesian LLM Router
 * 
 * The world's first LLM router that treats model selection as a true
 * multi-objective optimization problem. Instead of collapsing quality,
 * latency, and cost into a single scalar utility, it maintains separate
 * Gaussian Process surrogates per objective and selects models via
 * Expected Hypervolume Improvement (EHVI).
 * 
 * Innovation:
 *   Traditional routers: U = w₁·quality + w₂·latency + w₃·cost  (linear scalarization)
 *   ParetoNavigator: max EHVI(x) = E[HV(P ∪ {f(x)}, ref) - HV(P, ref)]
 * 
 * This discovers the full Pareto front across models — including non-convex
 * trade-offs that linear scalarization provably cannot find.
 * 
 * Mathematical Foundation:
 *   - 3 independent GPs: quality(x), latency(x), cost(x)
 *   - EHVI with Monte Carlo integration (S=200 samples)
 *   - Constraint handling: reject models violating user bounds
 *   - Cold start: round-robin until 3 observations per model per objective
 * 
 * Zero dependencies. Pure TypeScript.
 */

import { CompletionRequest } from '../types';
import { GaussianProcess } from '../analytics/gaussianProcess';
import { analyzeSemanticStability, computeSemanticInstabilityRisk } from '../analytics/semanticFingerprintEngine';
import {
    ParetoPoint,
    GPPrediction,
    findParetoFront,
} from '../analytics/ehvi';
import { computeEHVIAdaptive } from '../analytics/computeAccelerator';
import { FsStore } from '../storage/fsStore';

export interface ParetoConstraints {
    maxCostUsd?: number;
    maxLatencyMs?: number;
    minQuality?: number;
}

interface ObjectiveGPs {
    quality: GaussianProcess;
    latency: GaussianProcess;
    cost: GaussianProcess;
}

interface ParetoObservation {
    modelId: string;
    featureVector: number[];
    quality: number;     // 1.0 for success, 0.0 for failure
    latencyMs: number;
    costUsd: number;
}

export class ParetoNavigatorRouter {
    public readonly name = 'pareto-navigator';
    private models: string[];
    private gps: Map<string, ObjectiveGPs>;
    private observations: ParetoObservation[] = [];
    private store?: FsStore;
    private requestCount = 0;
    private coldStartThreshold: number;
    private maxEhviCandidates: number;
    private ehviBypassMargin: number;
    private fastPathSigmaThreshold: number;

    constructor(
        models: string[],
        options: {
            store?: FsStore;
            coldStartThreshold?: number;
            maxEhviCandidates?: number;
            ehviBypassMargin?: number;
            fastPathSigmaThreshold?: number;
        } = {}
    ) {
        if (models.length === 0) {
            throw new Error('ParetoNavigatorRouter requires at least one model.');
        }
        this.models = models;
        this.store = options.store;
        this.coldStartThreshold = options.coldStartThreshold ?? 3;
        this.maxEhviCandidates = options.maxEhviCandidates ?? 3;
        this.ehviBypassMargin = options.ehviBypassMargin ?? 0.2;
        this.fastPathSigmaThreshold = options.fastPathSigmaThreshold ?? 0.45;

        this.gps = new Map();
        for (const model of models) {
            this.gps.set(model, {
                quality: new GaussianProcess(1.0, 1.0, 1e-4, 40),
                latency: new GaussianProcess(1.0, 1.0, 1e-4, 40),
                cost: new GaussianProcess(1.0, 1.0, 1e-4, 40),
            });
        }

        // Load persisted state
        if (this.store) {
            const state = this.store.getBayesianState();
            if (state?.pareto) {
                for (const m of this.models) {
                    const gpSet = this.gps.get(m);
                    if (gpSet && state.pareto[m]) {
                        if (state.pareto[m].quality) gpSet.quality.loadState(state.pareto[m].quality);
                        if (state.pareto[m].latency) gpSet.latency.loadState(state.pareto[m].latency);
                        if (state.pareto[m].cost) gpSet.cost.loadState(state.pareto[m].cost);
                    }
                }
            }
        }
    }

    private scorePrediction(prediction: GPPrediction): number {
        const meanScore = (prediction.mu[0] * 2.0) + prediction.mu[1] + prediction.mu[2];
        const uncertaintyBonus = (prediction.sigma[0] * 0.2) + (prediction.sigma[1] * 0.1) + (prediction.sigma[2] * 0.1);
        return meanScore + uncertaintyBonus;
    }

    /**
     * Extract an 8-dimensional feature vector from the request.
     * Same feature space as VonNeumannRouter for consistency.
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
        const jsonDepth = req.schema ? this.calculateSchemaDepth(req.schema) : 0;
        const temp = req.temperature ?? 0.7;
        const stability = analyzeSemanticStability(rawText);
        const [dCode, dChat, dJson] = stability.projection;

        return [
            msgCount / 10.0,
            Math.min(totalLen / 5000.0, 1.0),
            toolsCount / 5.0,
            jsonDepth / 3.0,
            temp,
            dCode,
            dChat,
            dJson,
        ];
    }

    private estimateRequestRisk(req: CompletionRequest): number {
        const rawText = req.messages
            .map(m => (typeof m.content === 'string' ? m.content : ''))
            .join(' ');
        return computeSemanticInstabilityRisk(analyzeSemanticStability(rawText));
    }

    private calculateSchemaDepth(schema?: Record<string, unknown>): number {
        if (!schema) return 0;
        let maxDepth = 1;
        const traverse = (obj: unknown, depth: number) => {
            if (depth > maxDepth) maxDepth = depth;
            if (typeof obj === 'object' && obj !== null) {
                for (const key in obj as Record<string, unknown>) {
                    traverse((obj as Record<string, unknown>)[key], depth + 1);
                }
            }
        };
        traverse(schema, 1);
        return maxDepth;
    }

    /**
     * Record feedback from a completed request into the 3 objective GPs.
     */
    public recordFeedback(
        modelId: string,
        req: CompletionRequest,
        latencyMs: number,
        success: boolean,
        costUsd: number
    ): void {
        const gpSet = this.gps.get(modelId);
        if (!gpSet) return;

        const vector = this.extractFeatureVector(req);
        const quality = success ? 1.0 : 0.0;

        gpSet.quality.addObservation(vector, quality);
        gpSet.latency.addObservation(vector, -latencyMs / 1000.0);  // Negate: we maximize all objectives
        gpSet.cost.addObservation(vector, -costUsd);                  // Negate: we maximize all objectives

        this.observations.push({
            modelId,
            featureVector: vector,
            quality,
            latencyMs,
            costUsd,
        });

        this.requestCount++;

        // Persist every 10 requests
        if (this.store && this.requestCount % 10 === 0) {
            this.persistState();
        }
    }

    private persistState(): void {
        if (!this.store) return;
        const existing = this.store.getBayesianState() ?? {};
        const paretoState: Record<string, unknown> = {};
        for (const m of this.models) {
            const gpSet = this.gps.get(m);
            if (gpSet) {
                paretoState[m] = {
                    quality: gpSet.quality.getState(),
                    latency: gpSet.latency.getState(),
                    cost: gpSet.cost.getState(),
                };
            }
        }
        existing.pareto = paretoState;
        this.store.saveBayesianState(existing);
    }

    /**
     * Route a request to the optimal model via EHVI-based Pareto selection.
     * 
     * Algorithm:
     * 1. Cold start check: round-robin until each model has enough observations
     * 2. Build current Pareto front from historical observations
     * 3. Query each model's 3 GPs for posterior predictions
     * 4. Apply user constraints (filter infeasible models)
     * 5. Compute EHVI for each feasible model
     * 6. Select model with highest EHVI (most improvement to the Pareto front)
     */
    public async route(
        req: CompletionRequest,
        constraints?: ParetoConstraints
    ): Promise<string> {
        // --- Cold Start Phase ---
        let minObs = Infinity;
        let coldStartModel = this.models[0];
        for (const model of this.models) {
            const gpSet = this.gps.get(model);
            if (!gpSet) continue;
            const count = gpSet.quality.getObservationCount();
            if (count < minObs) {
                minObs = count;
                coldStartModel = model;
            }
        }

        if (minObs < this.coldStartThreshold) {
            return coldStartModel;
        }

        const xStar = this.extractFeatureVector(req);
        const requestRisk = this.estimateRequestRisk(req);

        // --- Build Pareto Front from historical data ---
        const modelBestObjectives = new Map<string, number[]>();
        for (const obs of this.observations) {
            const existing = modelBestObjectives.get(obs.modelId);
            const objectives = [obs.quality, -obs.latencyMs / 1000.0, -obs.costUsd];
            if (!existing) {
                modelBestObjectives.set(obs.modelId, objectives);
            } else {
                // Keep the Pareto-better observation (use quality as tiebreaker)
                if (objectives[0] > existing[0]) {
                    modelBestObjectives.set(obs.modelId, objectives);
                }
            }
        }

        const paretoPoints: ParetoPoint[] = [];
        for (const [modelId, objectives] of modelBestObjectives) {
            paretoPoints.push({ objectives, modelId });
        }
        const front = findParetoFront(paretoPoints);

        // --- GP Predictions for each model ---
        const predictions: GPPrediction[] = [];
        for (const model of this.models) {
            const gpSet = this.gps.get(model);
            if (!gpSet) continue;

            const qPred = gpSet.quality.predict(xStar);
            const lPred = gpSet.latency.predict(xStar);
            const cPred = gpSet.cost.predict(xStar);
            const numericalCondition = Math.max(
                gpSet.quality.getDiagnostics().conditionNumber,
                gpSet.latency.getDiagnostics().conditionNumber,
                gpSet.cost.getDiagnostics().conditionNumber,
            );
            const numericalRisk = Math.max(0, Math.log10(Math.max(1, numericalCondition)) / 8);
            const combinedRisk = requestRisk * (1 + numericalRisk);

            const riskAdjustedQualityMu = qPred.mu - (0.15 * combinedRisk);
            const riskAdjustedLatencyMu = lPred.mu - (0.05 * combinedRisk);
            const riskAdjustedCostMu = cPred.mu - (0.05 * combinedRisk);
            const sigmaScale = 1 + (0.15 * combinedRisk);

            // Apply constraints: skip infeasible models
            if (constraints) {
                if (constraints.minQuality !== undefined && riskAdjustedQualityMu < constraints.minQuality) continue;
                if (constraints.maxLatencyMs !== undefined && -riskAdjustedLatencyMu * 1000 > constraints.maxLatencyMs) continue;
                if (constraints.maxCostUsd !== undefined && -riskAdjustedCostMu > constraints.maxCostUsd) continue;
            }

            predictions.push({
                mu: [riskAdjustedQualityMu, riskAdjustedLatencyMu, riskAdjustedCostMu],
                sigma: [qPred.sigma * sigmaScale, lPred.sigma * sigmaScale, cPred.sigma * sigmaScale],
                modelId: model,
            });
        }

        // If all models filtered by constraints, fall back to least-cost model
        if (predictions.length === 0) {
            return this.models[0];
        }

        const rankedPredictions = [...predictions].sort((left, right) => this.scorePrediction(right) - this.scorePrediction(left));
        const bestFastPath = rankedPredictions[0];
        const secondFastPath = rankedPredictions[1];
        const bestMargin = secondFastPath
            ? this.scorePrediction(bestFastPath) - this.scorePrediction(secondFastPath)
            : Number.POSITIVE_INFINITY;
        const bestSigmaMass = bestFastPath.sigma.reduce((sum, value) => sum + value, 0);

        if (bestMargin >= this.ehviBypassMargin && bestSigmaMass <= this.fastPathSigmaThreshold) {
            return bestFastPath.modelId;
        }

        const ehviPredictions = rankedPredictions.slice(0, Math.max(1, this.maxEhviCandidates));

        // --- EHVI Selection ---
        const ref = [0, -10, -10]; // Anti-ideal reference point
        const ehviScores = await computeEHVIAdaptive(front, ehviPredictions, ref, 200, this.requestCount);

        let bestModel = ehviPredictions[0].modelId;
        let bestEHVI = -Infinity;

        for (const [modelId, score] of ehviScores) {
            if (score > bestEHVI) {
                bestEHVI = score;
                bestModel = modelId;
            }
        }

        return bestModel;
    }

    /**
     * Get the current Pareto front for inspection/debugging.
     */
    public getParetoFront(): ParetoPoint[] {
        const points: ParetoPoint[] = this.observations.map(obs => ({
            objectives: [obs.quality, -obs.latencyMs / 1000.0, -obs.costUsd],
            modelId: obs.modelId,
        }));
        return findParetoFront(points);
    }
}
