import { CompletionResponse } from '../types';
import { Runnable } from './chain';

function stripJsonCodeFence(content: string): string {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parses structured model output into a typed value, preferring native `response.data`
 * when schema parsing already succeeded upstream.
 */
export class JsonOutputParser<T> implements Runnable<CompletionResponse, T> {
    public parse(response: CompletionResponse): T {
        if (response.data !== undefined) {
            return response.data as T;
        }

        const normalized = stripJsonCodeFence(response.content);

        try {
            return JSON.parse(normalized) as T;
        } catch (error: unknown) {
            const upstreamParseError = response.providerSpecific?._schemaParseError;
            const details = upstreamParseError ? ` Upstream schema parse error: ${String(upstreamParseError)}` : '';
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to parse JSON output: ${message}.${details}`);
        }
    }

    public invoke(response: CompletionResponse): T {
        return this.parse(response);
    }
}