export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
    role: Role;
    content: string;
    toolCalls?: { id?: string, name: string, arguments: any }[];
    toolResults?: { toolCallId?: string, name: string, result: any }[];
    /**
     * When `true`, instructs Anthropic to apply prompt caching to this message
     * (`cache_control: { type: 'ephemeral' }`).  
     * **Only effective for `AnthropicProvider`. Silently ignored by all other providers.**
     * Requires the `anthropic-beta: prompt-caching-2024-07-31` header to be active.
     */
    cachePrompt?: boolean;
}

export interface UnifyTool {
    name: string;
    description: string;
    schema: Record<string, any>;
    execute?: (args: any) => Promise<any> | any;
}

export interface CompletionRequest {
    model: string;
    messages: Message[];
    tools?: UnifyTool[];
    autoExecute?: boolean;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    schema?: Record<string, any>;
    schemaName?: string;
    providerOptions?: Record<string, any>;
}

export class UnifyAPIError extends Error {
    public status?: number;
    public provider: string;

    constructor(message: string, provider: string, status?: number) {
        super(message);
        this.name = 'UnifyAPIError';
        this.provider = provider;
        this.status = status;
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
    data?: any;
    toolCalls?: { id?: string, name: string, arguments: any }[];
    model: string;
    usage?: TokenUsage;
    providerSpecific?: Record<string, any>;
}

export interface UnifyMiddleware {
    beforeRequest?: (request: CompletionRequest) => Promise<CompletionRequest | CompletionResponse>;
    afterResponse?: (request: CompletionRequest, response: CompletionResponse) => Promise<CompletionResponse>;
}
