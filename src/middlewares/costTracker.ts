import { CompletionRequest, CompletionResponse, UnifyMiddleware } from '../types';

export type TokenCosts = {
    prompt: number;
    completion: number;
    cachedPrompt?: number;
    cacheCreation?: number;
};

export interface CostTrackerOptions {
    costs?: Record<string, TokenCosts>;
    fetchCostsUrl?: string;
    fetcher?: () => Promise<Record<string, TokenCosts>>;
    refreshIntervalMs?: number;
    now?: () => number;
    onRefreshError?: (error: unknown) => void;
}

export const ModelCosts: Record<string, TokenCosts> = {
    // Costs per 1M tokens (in USD)
    'gpt-4o': { prompt: 5.0, completion: 15.0, cachedPrompt: 2.50 },
    'gpt-4-turbo': { prompt: 10.0, completion: 30.0 },
    'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
    'claude-3-opus-20240229': { prompt: 15.0, completion: 75.0, cachedPrompt: 1.50, cacheCreation: 18.75 },
    'claude-3-sonnet-20240229': { prompt: 3.0, completion: 15.0, cachedPrompt: 0.30, cacheCreation: 3.75 },
    'claude-3-haiku-20240307': { prompt: 0.25, completion: 1.25, cachedPrompt: 0.03, cacheCreation: 0.30 },
    'claude-3-5-sonnet-20240620': { prompt: 3.0, completion: 15.0, cachedPrompt: 0.30, cacheCreation: 3.75 },
    'gemini-1.5-pro': { prompt: 3.5, completion: 10.5, cachedPrompt: 0.875 },
    'gemini-1.5-flash': { prompt: 0.35, completion: 1.05, cachedPrompt: 0.0875 },
    'gpt-4o-mini': { prompt: 0.15, completion: 0.60, cachedPrompt: 0.075 },
    'gpt-4.5-turbo': { prompt: 75.0, completion: 150.0 }, // [WARNING] Estimates as of March 2025. Verify & inject dynamically for production scale.
    'o1': { prompt: 15.0, completion: 60.0 },
    'o3-mini': { prompt: 1.10, completion: 4.40 },
    'claude-3-5-haiku-20241022': { prompt: 0.80, completion: 4.0, cachedPrompt: 0.08, cacheCreation: 1.0 },
    'claude-3-7-sonnet-20250219': { prompt: 3.0, completion: 15.0, cachedPrompt: 0.30, cacheCreation: 3.75 },
    'gemini-2.0-flash': { prompt: 0.10, completion: 0.40 },
};

const DEFAULT_COST_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function isCostTrackerOptions(value: unknown): value is CostTrackerOptions {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return 'costs' in value
        || 'fetchCostsUrl' in value
        || 'fetcher' in value
        || 'refreshIntervalMs' in value
        || 'now' in value
        || 'onRefreshError' in value;
}

export class CostTrackerMiddleware implements UnifyMiddleware {
    private totalCostUsd: number = 0;
    private customCosts: Record<string, TokenCosts>;
    private fetchCostsUrl?: string;
    private customCostsFetcher?: () => Promise<Record<string, TokenCosts>>;
    private hasDynamicSource: boolean = false;
    private hasFetchedDynamicCosts: boolean = false;
    private lastFetchedAt: number = 0;
    private lastAttemptedAt: number = 0;
    private refreshIntervalMs: number = DEFAULT_COST_REFRESH_INTERVAL_MS;
    private now: () => number = () => Date.now();
    private onRefreshError?: (error: unknown) => void;
    private refreshPromise: Promise<void> | null = null;

    constructor(customCosts?: Record<string, TokenCosts> | string | (() => Promise<Record<string, TokenCosts>>) | CostTrackerOptions) {
        this.customCosts = {};
        if (typeof customCosts === 'string') {
            this.fetchCostsUrl = customCosts;
            this.hasDynamicSource = true;
        } else if (typeof customCosts === 'function') {
            this.customCostsFetcher = customCosts;
            this.hasDynamicSource = true;
        } else if (isCostTrackerOptions(customCosts)) {
            this.customCosts = customCosts.costs || {};
            this.fetchCostsUrl = customCosts.fetchCostsUrl;
            this.customCostsFetcher = customCosts.fetcher;
            this.hasDynamicSource = Boolean(this.fetchCostsUrl || this.customCostsFetcher);
            this.refreshIntervalMs = customCosts.refreshIntervalMs ?? DEFAULT_COST_REFRESH_INTERVAL_MS;
            this.now = customCosts.now ?? this.now;
            this.onRefreshError = customCosts.onRefreshError;
        } else {
            this.customCosts = customCosts || {};
        }

        if (!this.hasDynamicSource) {
            this.hasFetchedDynamicCosts = true;
            this.lastFetchedAt = this.now();
            this.lastAttemptedAt = this.lastFetchedAt;
        }
    }

    private async resolveCosts(): Promise<void> {
        if (!this.hasDynamicSource) return;

        const now = this.now();
        const referenceTime = this.hasFetchedDynamicCosts ? this.lastFetchedAt : this.lastAttemptedAt;
        const hasReference = this.hasFetchedDynamicCosts || this.lastAttemptedAt > 0;
        const isFresh = hasReference && (now - referenceTime) < this.refreshIntervalMs;
        if (isFresh) {
            return;
        }

        if (this.refreshPromise) {
            await this.refreshPromise;
            return;
        }

        this.refreshPromise = (async () => {
            this.lastAttemptedAt = this.now();

            try {
                let incomingCosts: Record<string, TokenCosts> | undefined;
                if (this.fetchCostsUrl) {
                    const res = await fetch(this.fetchCostsUrl);
                    if (res.ok) {
                        incomingCosts = await res.json() as Record<string, TokenCosts>;
                    }
                } else if (this.customCostsFetcher) {
                    incomingCosts = await this.customCostsFetcher();
                }

                if (incomingCosts && Object.keys(incomingCosts).length > 0) {
                    this.customCosts = {
                        ...this.customCosts,
                        ...incomingCosts,
                    };
                    this.hasFetchedDynamicCosts = true;
                    this.lastFetchedAt = this.now();
                }
            } catch (e) {
                if (this.onRefreshError) {
                    this.onRefreshError(e);
                } else {
                    console.warn("CostTrackerMiddleware failed to refresh dynamic prices.", e);
                }
            } finally {
                this.refreshPromise = null;
            }
        })();

        await this.refreshPromise;
    }

    async afterResponse(request: CompletionRequest, response: CompletionResponse): Promise<CompletionResponse> {
        if (!response.usage || response.providerSpecific?._cached) {
            return response;
        }

        await this.resolveCosts();

        const model = request.model || response.model;
        const costs = this.customCosts[model] || ModelCosts[model];
        let calculatedCostUsd = 0;

        if (costs) {
            // OpenAI and Gemini include cached within promptTokens, so we subtract
            const regularPromptTokens = response.usage.promptTokens - (response.usage.cachedTokens || 0);
            const promptCost = (regularPromptTokens / 1_000_000) * costs.prompt;

            // Anthropic separates cacheReadTokens from promptTokens
            const readTokens = (response.usage.cachedTokens || 0) + (response.usage.cacheReadTokens || 0);
            const cachedCost = (readTokens / 1_000_000) * (costs.cachedPrompt ?? (costs.prompt * 0.5));

            const cacheCreationCost = (response.usage.cacheCreationTokens || 0) / 1_000_000 * (costs.cacheCreation ?? (costs.prompt * 1.25));
            const completionCost = (response.usage.completionTokens / 1_000_000) * costs.completion;

            calculatedCostUsd = promptCost + cachedCost + cacheCreationCost + completionCost;
        }

        this.totalCostUsd += calculatedCostUsd;

        return {
            ...response,
            providerSpecific: {
                ...response.providerSpecific,
                _costUsd: calculatedCostUsd
            }
        };
    }

    getTotalCost(): number {
        return this.totalCostUsd;
    }
}
