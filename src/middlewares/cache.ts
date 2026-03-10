import { CompletionRequest, CompletionResponse, UnifyMiddleware } from '../types';

export function safeJSONParse(str: string): any {
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
        return this.cache.get(key) || null;
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
        const cachedResponseStr = await this.store.get(key);

        if (cachedResponseStr) {
            try {
                // Prevent prototype pollution BEFORE parsing (CWE-1321, CWE-502)
                const parsed = safeJSONParse(cachedResponseStr);

                // Runtime shape validation (CWE-502)
                if (!parsed || typeof parsed !== 'object' || typeof parsed.content !== 'string' || typeof parsed.model !== 'string') {
                    return request; // Invalid shape, treat as cache miss
                }

                const response: CompletionResponse = parsed;
                return {
                    ...response,
                    providerSpecific: { ...response.providerSpecific, _cached: true }
                };
            } catch (e) {
                // On corrupt cache parse error, treat as cache miss
                return request;
            }
        }

        return request;
    }

    async afterResponse(request: CompletionRequest, response: CompletionResponse): Promise<CompletionResponse> {
        if (response.providerSpecific?._cached) {
            return response;
        }

        const key = await this.generateKey(request);
        await this.store.set(key, JSON.stringify(response));
        return response;
    }
}
