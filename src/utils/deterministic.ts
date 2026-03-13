import { CompletionRequest } from '../types';

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'function') return '[Function]';

    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
        return `{${entries.join(',')}}`;
    }

    return JSON.stringify(String(value));
}

export function hashString(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function deterministicUnitInterval(seed: string): number {
    const hash = hashString(seed);
    return (hash + 1) / 4294967297;
}

export function deterministicIndex(length: number, seed: string): number {
    if (length <= 0) return 0;
    return hashString(seed) % length;
}

export function buildDeterministicRequestSeed(request: CompletionRequest): string {
    const messageSeed = request.messages
        .map(message => `${message.role}:${stableStringify(message.content)}`)
        .join('|');
    const toolSeed = request.tools?.map(tool => tool.name).join('|') ?? '';
    const schemaSeed = request.schema ? stableStringify(request.schema) : '';

    return [
        request.model,
        messageSeed,
        toolSeed,
        schemaSeed,
        String(request.temperature ?? ''),
        String(request.maxTokens ?? ''),
        String(request.stream ?? false),
    ].join('||');
}