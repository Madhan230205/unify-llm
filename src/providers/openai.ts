import { BaseProvider } from './base';
import { CompletionRequest, CompletionResponse, UnifyAPIError } from '../types';
import { streamSSE } from '../utils/stream';

export class OpenAIProvider extends BaseProvider {
    readonly name = 'openai';
    private apiKey: string;
    private baseUrl: string;

    constructor(apiKey?: string, baseUrl?: string) {
        super();
        const envKey = typeof process !== 'undefined' && process.env ? process.env.OPENAI_API_KEY : undefined;
        this.apiKey = apiKey || envKey || '';
        this.baseUrl = baseUrl || 'https://api.openai.com/v1';

        if (!this.apiKey) {
            throw new UnifyAPIError("OpenAI API Key is required.", this.name);
        }
    }

    private buildPayload(request: CompletionRequest, stream: boolean) {
        const mappedMessages: any[] = [];
        for (const msg of request.messages) {
            if (msg.role === 'tool' && msg.toolResults) {
                for (const result of msg.toolResults) {
                    mappedMessages.push({
                        role: 'tool',
                        tool_call_id: result.toolCallId,
                        content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
                    });
                }
                continue;
            }

            const mapped: any = {
                role: msg.role,
                content: msg.content || ""
            };
            if (msg.toolCalls) {
                mapped.tool_calls = msg.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.name,
                        arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
                    }
                }));
            }
            mappedMessages.push(mapped);
        }

        const payload: any = {
            model: request.model,
            messages: mappedMessages,
            temperature: request.temperature,
            max_tokens: request.maxTokens,
            stream,
            ...request.providerOptions
        };

        if (request.tools && request.tools.length > 0) {
            payload.tools = request.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.schema
                }
            }));
        }

        if (request.schema) {
            payload.response_format = {
                type: "json_schema",
                json_schema: {
                    name: request.schemaName || "structured_output",
                    schema: request.schema,
                    strict: true
                }
            };
        }

        if (stream) {
            payload.stream_options = { include_usage: true };
        }

        return payload;
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(this.buildPayload(request, false)),
            signal: request.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let rawError;
            try { rawError = JSON.parse(errorText); } catch (e) { rawError = errorText; }
            throw new UnifyAPIError(`OpenAI API error: ${response.status} - ${errorText}`, this.name, response.status, rawError);
        }

        const data = await response.json();

        let toolCalls;
        if (data.choices[0]?.message?.tool_calls) {
            toolCalls = data.choices[0].message.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
            }));
        }

        return {
            content: data.choices[0]?.message?.content || '',
            toolCalls,
            model: data.model,
            usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
                cachedTokens: data.usage.prompt_tokens_details?.cached_tokens || 0
            } : undefined,
            providerSpecific: data
        };
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(this.buildPayload(request, true)),
            signal: request.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let rawError;
            try { rawError = JSON.parse(errorText); } catch (e) { rawError = errorText; }
            throw new UnifyAPIError(`OpenAI API error: ${response.status} - ${errorText}`, this.name, response.status, rawError);
        }

        if (!response.body) {
            throw new UnifyAPIError("No response body returned from OpenAI.", this.name);
        }

        for await (const event of streamSSE(response.body)) {
            if (event.data === '[DONE]') break;

            try {
                const data = JSON.parse(event.data);
                const contentDelta = data.choices[0]?.delta?.content || '';

                let toolCalls;
                if (data.choices[0]?.delta?.tool_calls) {
                    toolCalls = data.choices[0].delta.tool_calls.map((tc: any) => ({
                        index: tc.index,
                        id: tc.id,
                        name: tc.function?.name,
                        arguments: tc.function?.arguments
                    }));
                }

                yield {
                    content: contentDelta,
                    toolCalls,
                    model: data.model || request.model,
                    usage: data.usage ? {
                        promptTokens: data.usage.prompt_tokens,
                        completionTokens: data.usage.completion_tokens,
                        totalTokens: data.usage.total_tokens,
                        cachedTokens: data.usage.prompt_tokens_details?.cached_tokens || 0
                    } : undefined,
                    providerSpecific: data
                };
            } catch (e: unknown) {
                // Ignore parse errors on incomplete chunks
            }
        }
    }
}
