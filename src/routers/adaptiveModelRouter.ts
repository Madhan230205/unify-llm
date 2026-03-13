import { Message, CompletionRequest } from '../types';
import { ManifoldExtractor } from '../analytics/contextAnalyzer';
import { MetricsStore } from '../storage/metricsStore';
import { InMemoryStore } from '../storage/inMemoryStore';
import { deterministicIndex } from '../utils/deterministic';

export interface AdaptiveModelRouterConfig {
    store?: MetricsStore;
    allowedModels?: string[];
    explorationConstant?: number;
    nearestNeighbors?: number;
}

export class AdaptiveModelRouter {
    public store: MetricsStore;
    private c: number;
    private k: number;
    private allowedModels: string[];

    constructor(config: AdaptiveModelRouterConfig = {}) {
        this.store = config.store || new InMemoryStore();
        this.c = config.explorationConstant ?? 1.414;
        this.k = config.nearestNeighbors ?? 5;
        this.allowedModels = config.allowedModels || [];
    }

    protected extractFullPrompt(messages: Message[]): string {
        return messages.map(m => {
            if (Array.isArray(m.content)) {
                return m.content.map(c => {
                    if (typeof c === 'string') return c;
                    if (typeof c === 'object' && c !== null && 'text' in c) {
                        return String((c as Record<string, unknown>).text || '');
                    }
                    return '';
                }).join('\n');
            }
            return typeof m.content === 'string' ? m.content : String(m.content || '');
        }).join('\n');
    }

    public async getModel(request: CompletionRequest): Promise<string> {
        const prompt = this.extractFullPrompt(request.messages);
        const state = ManifoldExtractor.extract(prompt);

        const candidates = this.allowedModels.length > 0
            ? this.allowedModels
            : await this.store.getKnownModels();

        if (candidates.length === 0) {
            return 'openai/gpt-4o-mini';
        }

        const neighbors = await this.store.getNearest(state, this.k);

        if (neighbors.length === 0) {
            const seed = `${prompt}|${candidates.join('|')}`;
            return candidates[deterministicIndex(candidates.length, seed)];
        }

        let bestModel = candidates[0];
        let maxUCB = -Infinity;

        for (const model of candidates) {
            const modelNeighbors = neighbors.filter(n => n.model === model);

            let expectedUtility = 0;
            let weightSum = 0;

            for (const n of modelNeighbors) {
                const d = ManifoldExtractor.distance(state, n.state);
                const weight = 1 / (d + 1e-6);
                expectedUtility += n.utility * weight;
                weightSum += weight;
            }

            if (weightSum > 0) {
                expectedUtility /= weightSum;
            }

            const nVisits = modelNeighbors.length;
            let ucb = expectedUtility;

            if (nVisits === 0) {
                ucb = Infinity;
            } else {
                ucb = expectedUtility + this.c * Math.sqrt(Math.log(this.k) / nVisits);
            }

            if (ucb > maxUCB) {
                maxUCB = ucb;
                bestModel = model;
            }
        }

        return bestModel;
    }
}

