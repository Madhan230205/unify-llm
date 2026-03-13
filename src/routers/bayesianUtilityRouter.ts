import { CompletionRequest } from '../types';
import { GaussianProcess } from '../analytics/gaussianProcess';
import { analyzeSemanticStability, computeSemanticInstabilityRisk } from '../analytics/semanticFingerprintEngine';
import { spectralRadius, hasDivergentLoop, AstralDivergenceError } from '../analytics/loopRiskEngine';
import { FsStore } from '../storage/fsStore';

interface ModelObservation {
    modelId: string;
    request: CompletionRequest;
    latencyMs: number;
    success: boolean;
    costUsd: number;
}

export class BayesianUtilityRouter {
    public readonly name = 'bayesian-utility-router';
    private models: string[];
    private beta: number;
    private metrics: Map<string, GaussianProcess>;
    private store?: FsStore;
    private requestCount = 0;
    private latencyWeight: number;
    private costWeight: number;
    private successWeight: number;
    private spectralLambda: number;

    constructor(
        models: string[],
        explorationBeta: number = 2.0,
        weights = { latency: 1.0, cost: 1.0, success: 10.0 },
        store?: FsStore,
        spectralLambda: number = 5.0,
    ) {
        if (models.length === 0) {
            throw new Error('BayesianUtilityRouter requires at least one model.');
        }
        this.models = models;
        this.beta = explorationBeta;
        this.latencyWeight = weights.latency;
        this.costWeight = weights.cost;
        this.successWeight = weights.success;
        this.spectralLambda = spectralLambda;

        this.metrics = new Map();
        for (const model of this.models) {
            this.metrics.set(model, new GaussianProcess(1.0, 1.0, 1e-6, 40));
        }

        this.store = store;
        if (this.store) {
            const state = this.store.getBayesianState();
            if (state) {
                for (const m of this.models) {
                    if (state[m]) {
                        this.metrics.get(m)?.loadState(state[m]);
                    }
                }
            }
        }
    }

    private calculateSchemaDepth(schema?: Record<string, any>): number {
        if (!schema) return 0;
        let maxDepth = 1;

        const traverse = (obj: any, depth: number) => {
            if (depth > maxDepth) maxDepth = depth;
            if (typeof obj === 'object' && obj !== null) {
                for (const key in obj) {
                    traverse(obj[key], depth + 1);
                }
            }
        };
        traverse(schema, 1);
        return maxDepth;
    }

    private extractFeatureVector(req: CompletionRequest): number[] {
        const msgCount = req.messages.length;
        let rawTextString = '';
        const totalLen = req.messages.reduce((sum: number, m: any) => {
            const content = typeof m.content === 'string' ? m.content : '';
            rawTextString += `${content} `;
            return sum + content.length;
        }, 0);

        const toolsCount = req.tools ? req.tools.length : 0;
        const jsonDepth = req.schema ? this.calculateSchemaDepth(req.schema) : 0;
        const temp = req.temperature ?? 0.7;
        const stability = analyzeSemanticStability(rawTextString);
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

    private calculateUtility(obs: ModelObservation): number {
        let utility = 0;
        if (obs.success) {
            utility += this.successWeight;
        } else {
            utility -= this.successWeight * 2;
        }

        utility -= (obs.latencyMs / 1000.0) * this.latencyWeight;
        utility -= (obs.costUsd * 100.0) * this.costWeight;
        return utility;
    }

    public recordFeedback(modelId: string, req: CompletionRequest, latencyMs: number, success: boolean, costUsd: number) {
        const gp = this.metrics.get(modelId);
        if (!gp) return;

        const vector = this.extractFeatureVector(req);
        const utility = this.calculateUtility({ modelId, request: req, latencyMs, success, costUsd });

        gp.addObservation(vector, utility);
        this.requestCount++;

        if (this.store && this.requestCount % 10 === 0) {
            const bayesianState: Record<string, any> = {};
            for (const m of this.models) {
                const state = this.metrics.get(m)?.getState();
                if (state) bayesianState[m] = state;
            }
            this.store.saveBayesianState(bayesianState);
        }
    }

    public async route(req: CompletionRequest): Promise<string> {
        let minObs = Infinity;
        let coldStartModel = this.models[0];
        for (const model of this.models) {
            const gp = this.metrics.get(model);
            if (!gp) continue;
            const obsCount = gp.getObservationCount();
            if (obsCount < minObs) {
                minObs = obsCount;
                coldStartModel = model;
            }
        }

        if (minObs < 5) {
            return coldStartModel;
        }

        const xStar = this.extractFeatureVector(req);
        const requestRisk = this.estimateRequestRisk(req);
        let bestScore = -Infinity;
        let bestModel = this.models[0];

        for (const model of this.models) {
            const gp = this.metrics.get(model);
            if (!gp) continue;

            const { mu, sigma } = gp.predict(xStar);
            const diagnostics = gp.getDiagnostics();
            const numericalPenalty = Math.max(0, Math.log10(Math.max(1, diagnostics.conditionNumber)) / 8);
            const combinedRisk = requestRisk * (1 + numericalPenalty);
            let ucbScore = mu + this.beta * sigma - (combinedRisk * this.successWeight * 0.15) - numericalPenalty;

            if (req.tools && req.tools.length > 1) {
                const n = req.tools.length;
                const T: number[][] = [];
                for (let i = 0; i < n; i++) {
                    T.push(new Array(n).fill(1.0 / n));
                }

                if (hasDivergentLoop(T)) {
                    throw new AstralDivergenceError(
                        `Model ${model}: Agentic tool graph has divergent spectral radius (ρ ≥ 0.9999). Refusing to route.`,
                    );
                }

                const rho = spectralRadius(T);
                const penalty = this.spectralLambda * Math.max(0, rho - 0.8);
                ucbScore -= penalty;
            }

            if (ucbScore > bestScore) {
                bestScore = ucbScore;
                bestModel = model;
            }
        }

        const gpOptimal = this.metrics.get(bestModel);
        if (gpOptimal && gpOptimal.getObservationCount() >= 5) {
            let optimalTemp = req.temperature ?? 0.7;
            const learningRate = 0.5;

            for (let step = 0; step < 5; step++) {
                xStar[4] = optimalTemp;
                const grad = gpOptimal.optimizeKinematicGradient(xStar, 4);
                optimalTemp += learningRate * grad;
                if (optimalTemp < 0.0) optimalTemp = 0.0;
                if (optimalTemp > 2.0) optimalTemp = 2.0;
            }
            req.temperature = Number(optimalTemp.toFixed(2));
        }

        return bestModel;
    }
}

export { BayesianUtilityRouter as VonNeumannRouter };
