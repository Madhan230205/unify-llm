import { BaseProvider } from './base';
import { CompletionRequest, CompletionResponse, UnifyAPIError } from '../types';
import { streamSSE } from '../utils/stream';

export class AnthropicProvider extends BaseProvider {
    readonly name = 'anthropic';
    private apiKey: string;
    private baseUrl = 'https://api.anthropic.com/v1';

    constructor(apiKey?: string) {
        super();
        const envKey = typeof process !== 'undefined' && process.env ? process.env.ANTHROPIC_API_KEY : undefined;
        this.apiKey = apiKey || envKey || '';

        if (!this.apiKey) {
            throw new UnifyAPIError("Anthropic API Key is required.", this.name);
        }
    }

    private buildPayload(request: CompletionRequest, stream: boolean) {
        const systemMsg = request.messages.find(m => m.role === 'system');
        const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

        const messages = [];
        for (const msg of nonSystemMessages) {
            if (msg.role === 'tool' && msg.toolResults) {
                messages.push({
                    role: 'user', // Anthropic expects tool results from 'user'
                    content: msg.toolResults.map(tr => ({
                        type: 'tool_result',
                        tool_use_id: tr.toolCallId,
                        content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
                    }))
                });
                continue;
            }

            const contentBlocks: any[] = [];
            if (msg.content) {
                contentBlocks.push({
                    type: 'text',
                    text: msg.content,
                    ...(msg.cachePrompt ? { cache_control: { type: 'ephemeral' } } : {})
                });
            }

            if (msg.toolCalls) {
                msg.toolCalls.forEach(tc => {
                    contentBlocks.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.name,
                        input: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments
                    });
                });
            }

            messages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: contentBlocks.length > 0 ? contentBlocks : msg.content || ""
            });
        }

        const payload: any = {
            model: request.model,
            messages: messages,
            max_tokens: request.maxTokens ?? 1024,
            stream,
            ...request.providerOptions
        };

        if (request.schema) {
            const toolName = request.schemaName || "extract_json";
            payload.tools = [
                {
                    name: toolName,
                    description: "Output the requested data in JSON format based on the schema.",
                    input_schema: request.schema
                }
            ];
            payload.tool_choice = { type: "tool", name: toolName };
        } else if (request.tools && request.tools.length > 0) {
            payload.tools = request.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.schema
            }));
        }

        if (systemMsg) {
            payload.system = systemMsg.cachePrompt
                ? [{ type: 'text', text: systemMsg.content, cache_control: { type: 'ephemeral' } }]
                : systemMsg.content;
        }
        if (request.temperature !== undefined) payload.temperature = request.temperature;

        return payload;
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        const response = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'prompt-caching-2024-07-31'
            },
            body: JSON.stringify(this.buildPayload(request, false)),
            signal: request.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let rawError;
            try { rawError = JSON.parse(errorText); } catch (e) { rawError = errorText; }
            throw new UnifyAPIError(`Anthropic API error: ${response.status} - ${errorText}`, this.name, response.status, rawError);
        }

        const data = await response.json();

        let content = '';
        let toolCalls;

        if (data.content) {
            const textBlock = data.content.find((block: any) => block.type === 'text');
            if (textBlock) content = textBlock.text;

            const toolUseBlocks = data.content.filter((block: any) => block.type === 'tool_use');
            if (toolUseBlocks.length > 0) {
                if (request.schema) {
                    // Backwards compat: if structured output is used, map tool directly back to content 
                    content = JSON.stringify(toolUseBlocks[0].input);
                } else {
                    toolCalls = toolUseBlocks.map((block: any) => ({
                        id: block.id,
                        name: block.name,
                        arguments: block.input
                    }));
                }
            }
        }

        return {
            content,
            toolCalls,
            model: data.model,
            usage: data.usage ? {
                promptTokens: data.usage.input_tokens || 0,
                completionTokens: data.usage.output_tokens || 0,
                totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
                cacheCreationTokens: data.usage.cache_creation_input_tokens || 0,
                cacheReadTokens: data.usage.cache_read_input_tokens || 0
            } : undefined,
            providerSpecific: data
        };
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        const response = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'prompt-caching-2024-07-31'
            },
            body: JSON.stringify(this.buildPayload(request, true)),
            signal: request.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let rawError;
            try { rawError = JSON.parse(errorText); } catch (e) { rawError = errorText; }
            throw new UnifyAPIError(`Anthropic API error: ${response.status} - ${errorText}`, this.name, response.status, rawError);
        }

        if (!response.body) {
            throw new UnifyAPIError("No response body returned from Anthropic.", this.name);
        }

        for await (const event of streamSSE(response.body)) {
            if (event.data === '[DONE]' || event.event === 'message_stop') continue;

            try {
                const data = JSON.parse(event.data);

                if (event.event === 'message_start' && data.message?.usage) {
                    yield {
                        content: '',
                        model: request.model,
                        usage: {
                            promptTokens: data.message.usage.input_tokens || 0,
                            completionTokens: 0,
                            totalTokens: data.message.usage.input_tokens || 0,
                            cacheCreationTokens: data.message.usage.cache_creation_input_tokens || 0,
                            cacheReadTokens: data.message.usage.cache_read_input_tokens || 0
                        },
                        providerSpecific: data
                    };
                } else if (event.event === 'content_block_start' && data.content_block?.type === 'tool_use') {
                    yield {
                        content: '',
                        model: request.model,
                        toolCalls: [{ index: data.index, id: data.content_block.id, name: data.content_block.name, arguments: '' }],
                        providerSpecific: data
                    };
                } else if (event.event === 'content_block_delta') {
                    if (data.delta?.type === 'text_delta') {
                        yield {
                            content: data.delta.text,
                            model: request.model,
                            providerSpecific: data
                        };
                    } else if (data.delta?.type === 'input_json_delta') {
                        yield {
                            content: request.schema ? data.delta.partial_json : '',
                            model: request.model,
                            toolCalls: request.schema ? undefined : [{ index: data.index, arguments: data.delta.partial_json }],
                            providerSpecific: data
                        };
                    }
                } else if (event.event === 'message_delta' && data.usage) {
                    yield { content: '', model: request.model, usage: { promptTokens: 0, completionTokens: data.usage.output_tokens || 0, totalTokens: data.usage.output_tokens || 0 }, providerSpecific: data };
                }
            } catch (e: unknown) {
                // Ignore parse errors on incomplete chunks
            }
        }
    }
}
