import { CompletionRequest, CompletionResponse, UnifyMiddleware, UnifyAPIError } from '../types';

export interface RateLimiterStore {
    increment(key: string, windowMs: number): Promise<number>;
}

export class InMemoryRateLimiterStore implements RateLimiterStore {
    private counts = new Map<string, { count: number, resetAt: number }>();

    async increment(key: string, windowMs: number): Promise<number> {
        const now = Date.now();
        const record = this.counts.get(key);
        if (!record || record.resetAt < now) {
            this.counts.set(key, { count: 1, resetAt: now + windowMs });
            return 1;
        }
        record.count++;
        return record.count;
    }
}

export class RateLimiterMiddleware implements UnifyMiddleware {
    private requestsPerMinute: number;
    private store: RateLimiterStore;
    private idExtractor: (request: CompletionRequest) => string;

    constructor(requestsPerMinute: number = 60, store: RateLimiterStore = new InMemoryRateLimiterStore(), idExtractor?: (request: CompletionRequest) => string) {
        this.requestsPerMinute = requestsPerMinute;
        this.store = store;
        this.idExtractor = idExtractor || (() => 'global');
    }

    async beforeRequest(request: CompletionRequest): Promise<CompletionRequest | CompletionResponse> {
        const key = this.idExtractor(request);
        const count = await this.store.increment(key, 60000); // 1 minute window

        if (count > this.requestsPerMinute) {
            throw new UnifyAPIError(`Rate limit exceeded: ${this.requestsPerMinute} requests per minute limit reached.`, 'RateLimiterMiddleware');
        }

        return request;
    }
}
