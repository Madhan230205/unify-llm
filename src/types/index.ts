export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
    role: Role;
    content: string;
    toolCalls?: { id?: string, name: string, arguments: Record<string, unknown> | unknown }[];
    toolResults?: { toolCallId?: string, name: string, result: unknown }[];
    /**
     * When `true`, instructs Anthropic to apply prompt caching to this message
     * (`cache_control: { type: 'ephemeral' }`).  
     * **Only effective for `AnthropicProvider`. Silently ignored by all other providers.**
     * Requires the `anthropic-beta: prompt-caching-2024-07-31` header to be active.
     */
    cachePrompt?: boolean;
}

export interface UnifyTool<TArgs = Record<string, unknown>, TResult = unknown> {
    name: string;
    description: string;
    schema: Record<string, unknown>;
    execute?: (args: TArgs) => Promise<TResult> | TResult;
}

export interface CompletionRequest {
    model: string;
    messages: Message[];
    tools?: UnifyTool[];
    autoExecute?: boolean;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    schema?: Record<string, unknown>;
    schemaName?: string;
    providerOptions?: Record<string, unknown>;
    signal?: AbortSignal;
}

export class UnifyAPIError extends Error {
    public status?: number;
    public provider: string;
    public rawError?: Record<string, unknown> | unknown;

    constructor(message: string, provider: string, status?: number, rawError?: Record<string, unknown> | unknown) {
        super(message);
        this.name = 'UnifyAPIError';
        this.provider = provider;
        this.status = status;
        this.rawError = rawError;
    }
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
}

export interface CompletionResponse {
    content: string;
    data?: unknown;
    toolCalls?: { index?: number, id?: string, name?: string, arguments?: Record<string, unknown> | unknown }[];
    model: string;
    usage?: TokenUsage;
    providerSpecific?: Record<string, unknown>;
}

export interface UnifyMiddleware {
    beforeRequest?: (request: CompletionRequest) => Promise<CompletionRequest | CompletionResponse>;
    afterResponse?: (request: CompletionRequest, response: CompletionResponse) => Promise<CompletionResponse>;
}
