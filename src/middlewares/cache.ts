import { CompletionRequest, CompletionResponse, UnifyMiddleware } from '../types';

export function safeJSONParse(str: string): unknown {
    // CWE-1321, CWE-502: Reject payloads containing dangerous prototype pollution keys BEFORE executing the JS engine's JSON parser
    if (/"__proto__"\s*:|"(?:constructor|prototype)"\s*:/.test(str)) {
        throw new Error("Unsafe payload detected");
    }
    return JSON.parse(str);
}

export interface CacheStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
}

export class InMemoryCache implements CacheStore {
    private cache = new Map<string, string>();
    private maxSize: number;

    constructor(maxSize = 500) {
        this.maxSize = maxSize;
    }

    async get(key: string): Promise<string | null> {
        const value = this.cache.get(key);
        if (value === undefined) return null;
        // Refresh insertion order for True LRU behaviour instead of raw FIFO
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    async set(key: string, value: string): Promise<void> {
        if (this.cache.size >= this.maxSize) {
            // evict oldest entry (Map iterates in insertion order)
            this.cache.delete(this.cache.keys().next().value!);
        }
        this.cache.set(key, value);
    }
}

export class CacheMiddleware implements UnifyMiddleware {
    private store: CacheStore;
    private inFlightRequests = new Map<string, Promise<CompletionResponse>>();
    private inFlightResolvers = new Map<string, (res: CompletionResponse) => void>();

    constructor(store: CacheStore = new InMemoryCache()) {
        this.store = store;
    }

    private async generateKey(request: CompletionRequest): Promise<string> {
        const data = JSON.stringify({
            model: request.model,
            messages: request.messages,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            schema: request.schema,
            schemaName: request.schemaName,
        });

        const msgUint8 = new TextEncoder().encode(data);
        const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    async beforeRequest(request: CompletionRequest): Promise<CompletionRequest | CompletionResponse> {
        const key = await this.generateKey(request);

        if (this.inFlightRequests.has(key)) {
            // Cache Stampede Protection: Prevent identical concurrent requests
            const response = await this.inFlightRequests.get(key)!;
            return {
                ...response,
                providerSpecific: { ...response.providerSpecific, _cached: true }
            };
        }

        const cachedResponseStr = await this.store.get(key);

        if (cachedResponseStr) {
            try {
                // Prevent prototype pollution BEFORE parsing (CWE-1321, CWE-502)
                const parsed = safeJSONParse(cachedResponseStr) as any;

                // Runtime shape validation (CWE-502)
                if (!parsed || typeof parsed !== 'object' || typeof parsed.content !== 'string' || typeof parsed.model !== 'string') {
                    return request; // Invalid shape, treat as cache miss
                }

                const response: CompletionResponse = parsed;
                return {
                    ...response,
                    providerSpecific: { ...response.providerSpecific, _cached: true }
                };
            } catch (e: unknown) {
                // On corrupt cache parse error, treat as cache miss
            }
        }

        // Register in-flight request to protect against cache stampedes
        let resolver!: (res: CompletionResponse) => void;
        const promise = new Promise<CompletionResponse>((resolve) => {
            resolver = resolve;
        });
        this.inFlightRequests.set(key, promise);
        this.inFlightResolvers.set(key, resolver);

        return request;
    }

    async afterResponse(request: CompletionRequest, response: CompletionResponse): Promise<CompletionResponse> {
        if (response.providerSpecific?._cached) {
            return response;
        }

        const key = await this.generateKey(request);
        await this.store.set(key, JSON.stringify(response));

        if (this.inFlightResolvers.has(key)) {
            this.inFlightResolvers.get(key)!(response);
            this.inFlightResolvers.delete(key);
            this.inFlightRequests.delete(key);
        }

        return response;
    }
}
