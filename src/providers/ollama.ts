import { BaseProvider } from './base';
import { CompletionRequest, CompletionResponse, UnifyAPIError } from '../types';
import { streamNDJSON } from '../utils/stream';

export class OllamaProvider extends BaseProvider {
    readonly name = 'ollama';
    private baseUrl: string;

    constructor(baseUrl?: string) {
        super();
        const envUrl = typeof process !== 'undefined' && process.env ? process.env.OLLAMA_BASE_URL : undefined;
        this.baseUrl = baseUrl || envUrl || 'http://localhost:11434';
    }

    private buildPayload(request: CompletionRequest, stream: boolean) {
        const mappedMessages: any[] = [];
        for (const msg of request.messages) {
            if (msg.role === 'tool' && msg.toolResults) {
                for (const result of msg.toolResults) {
                    mappedMessages.push({
                        role: 'tool',
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
            options: {
                temperature: request.temperature,
                num_predict: request.maxTokens,
                ...request.providerOptions
            },
            stream
        };

        if (request.schema) {
            payload.format = request.schema;
        }

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

        return payload;
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.buildPayload(request, false)),
            signal: request.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new UnifyAPIError(`Ollama API error: ${response.status} - ${errorText}`, this.name, response.status);
        }

        const data = await response.json();

        let toolCalls;
        if (data.message?.tool_calls) {
            let i = 0;
            toolCalls = data.message.tool_calls.map((tc: any) => ({
                id: `call_${Date.now()}_${i++}`, // Ollama does not guarantee IDs
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments || {}
            }));
        }

        return {
            content: data.message?.content || '',
            toolCalls,
            model: data.model,
            usage: {
                promptTokens: data.prompt_eval_count || 0,
                completionTokens: data.eval_count || 0,
                totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
            },
            providerSpecific: data
        };
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.buildPayload(request, true)),
            signal: request.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new UnifyAPIError(`Ollama API error: ${response.status} - ${errorText}`, this.name, response.status);
        }

        if (!response.body) {
            throw new UnifyAPIError("No response body returned from Ollama.", this.name);
        }

        for await (const data of streamNDJSON(response.body)) {
            const contentDelta = data.message?.content || '';

            let toolCalls;
            if (data.message?.tool_calls) {
                let i = 0;
                toolCalls = data.message.tool_calls.map((tc: any) => ({
                    id: `call_${Date.now()}_${i++}`,
                    name: tc.function.name,
                    arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {})
                }));
            }

            yield {
                content: contentDelta,
                toolCalls,
                model: data.model || request.model,
                usage: data.done ? {
                    promptTokens: data.prompt_eval_count || 0,
                    completionTokens: data.eval_count || 0,
                    totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                } : undefined,
                providerSpecific: data
            };

            if (data.done) break;
        }
    }
}
