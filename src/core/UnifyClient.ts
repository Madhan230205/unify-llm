import { CompletionRequest, CompletionResponse, UnifyMiddleware, Message, TokenUsage } from '../types';
import { BaseProvider } from '../providers/base';

export class UnifyClient {
    private providers: Map<string, BaseProvider> = new Map();
    private middlewares: UnifyMiddleware[] = [];

    constructor() { }

    registerProvider(provider: BaseProvider): this {
        this.providers.set(provider.name, provider);
        return this;
    }

    use(middleware: UnifyMiddleware): this {
        this.middlewares.push(middleware);
        return this;
    }

    async generate(providerName: string, request: CompletionRequest): Promise<CompletionResponse> {
        const provider = this.providers.get(providerName);
        if (!provider) {
            throw new Error(`Provider '${providerName}' not registered.`);
        }

        let currentRequest: CompletionRequest | CompletionResponse = request;

        for (const middleware of this.middlewares) {
            if (middleware.beforeRequest) {
                currentRequest = await middleware.beforeRequest(currentRequest as CompletionRequest);
                if ('content' in currentRequest) {
                    return currentRequest as CompletionResponse;
                }
            }
        }

        const executeChain = async (req: CompletionRequest, index: number): Promise<CompletionResponse> => {
            if (index >= this.middlewares.length) {
                let res = await provider.generateCompletion(req);
                if (req.schema && res.content) {
                    try {
                        res = { ...res, data: JSON.parse(res.content) };
                    } catch (e: unknown) {
                        res = {
                            ...res,
                            providerSpecific: {
                                ...res.providerSpecific,
                                _schemaParseError: e instanceof Error ? e.message : String(e)
                            }
                        };
                    }
                }
                return res;
            }
            const middleware = this.middlewares[index];
            const next = (modifiedReq?: CompletionRequest) => executeChain(modifiedReq || req, index + 1);
            if (middleware.wrapGenerate) {
                return middleware.wrapGenerate(req, next);
            }
            return next(req);
        };

        let response = await executeChain(currentRequest as CompletionRequest, 0);

        for (const middleware of this.middlewares) {
            if (middleware.afterResponse) {
                response = await middleware.afterResponse(currentRequest as CompletionRequest, response);
            }
        }

        if (request.autoExecute && response.toolCalls && response.toolCalls.length > 0 && request.tools) {
            const executedResults = await Promise.all(response.toolCalls.map(async (tc) => {
                const tool = request.tools!.find(t => t.name === tc.name);
                if (!tool || !tool.execute) {
                    return { toolCallId: tc.id, name: tc.name, result: `Tool ${tc.name} not found or not executable.` };
                }
                try {
                    const result = await tool.execute(tc.arguments as Record<string, unknown>);
                    return { toolCallId: tc.id, name: tc.name, result };
                } catch (e: unknown) {
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    return { toolCallId: tc.id, name: tc.name, result: `Error executing tool: ${errorMsg}` };
                }
            }));

            const nextRequest: CompletionRequest = {
                ...(currentRequest as CompletionRequest),
                messages: [
                    ...(currentRequest as CompletionRequest).messages,
                    { role: 'assistant', content: response.content || '', toolCalls: response.toolCalls as NonNullable<Message['toolCalls']> },
                    { role: 'tool', content: '', toolResults: executedResults as NonNullable<Message['toolResults']> }
                ]
            };

            const finalResponse = await this.generate(providerName, nextRequest);

            if (response.usage && finalResponse.usage) {
                finalResponse.usage = {
                    promptTokens: response.usage.promptTokens + finalResponse.usage.promptTokens,
                    completionTokens: response.usage.completionTokens + finalResponse.usage.completionTokens,
                    totalTokens: response.usage.totalTokens + finalResponse.usage.totalTokens,
                    cachedTokens: (response.usage.cachedTokens || 0) + (finalResponse.usage.cachedTokens || 0),
                    cacheCreationTokens: (response.usage.cacheCreationTokens || 0) + (finalResponse.usage.cacheCreationTokens || 0),
                    cacheReadTokens: (response.usage.cacheReadTokens || 0) + (finalResponse.usage.cacheReadTokens || 0)
                };
            }

            return finalResponse;
        }

        return response;
    }

    async *stream(providerName: string, request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        const provider = this.providers.get(providerName);
        if (!provider) {
            throw new Error(`Provider '${providerName}' not registered.`);
        }

        let currentRequest: CompletionRequest | CompletionResponse = { ...request, stream: true };

        // We run beforeRequest for stream as well
        for (const middleware of this.middlewares) {
            if (middleware.beforeRequest) {
                currentRequest = await middleware.beforeRequest(currentRequest as CompletionRequest);
                if ('content' in currentRequest) {
                    yield currentRequest as CompletionResponse;
                    return;
                }
            }
        }

        const executeStreamChain = async function* (this: UnifyClient, req: CompletionRequest, index: number): AsyncGenerator<CompletionResponse, void, unknown> {
            if (index >= this.middlewares.length) {
                yield* provider.streamCompletion(req);
                return;
            }
            const middleware = this.middlewares[index];
            const next = (modifiedReq?: CompletionRequest) => executeStreamChain(modifiedReq || req, index + 1);
            if (middleware.wrapStream) {
                yield* middleware.wrapStream(req, next);
            } else {
                yield* next(req);
            }
        }.bind(this);

        const generator = executeStreamChain(currentRequest as CompletionRequest, 0);

        let aggregatedContent = '';
        let finalModel = '';
        let finalUsage: TokenUsage | undefined = undefined;
        let finalProviderSpecific: Record<string, unknown> = {};
        let aggregatedToolCalls: { index?: number, id?: string, name?: string, arguments?: string }[] = [];

        for await (const chunk of generator) {
            aggregatedContent += chunk.content;
            if (chunk.model) finalModel = chunk.model;
            if (chunk.usage) {
                if (!finalUsage) {
                    finalUsage = { ...chunk.usage };
                } else {
                    finalUsage = {
                        promptTokens: (finalUsage.promptTokens || 0) + (chunk.usage.promptTokens || 0),
                        completionTokens: (finalUsage.completionTokens || 0) + (chunk.usage.completionTokens || 0),
                        totalTokens: (finalUsage.totalTokens || 0) + (chunk.usage.totalTokens || 0),
                        cachedTokens: (finalUsage.cachedTokens || 0) + (chunk.usage.cachedTokens || 0),
                        cacheCreationTokens: (finalUsage.cacheCreationTokens || 0) + (chunk.usage.cacheCreationTokens || 0),
                        cacheReadTokens: (finalUsage.cacheReadTokens || 0) + (chunk.usage.cacheReadTokens || 0),
                    };
                }
            }
            if (chunk.providerSpecific) {
                finalProviderSpecific = { ...finalProviderSpecific, ...chunk.providerSpecific };
            }
            if (chunk.toolCalls) {
                for (const tc of chunk.toolCalls) {
                    let existing = aggregatedToolCalls.find(t => t.index === tc.index || (tc.id && t.id === tc.id));
                    if (!existing) {
                        const newTc = { index: tc.index, id: tc.id, name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : '' };
                        aggregatedToolCalls.push(newTc);
                        existing = newTc;
                    } else {
                        if (tc.id && !existing.id) existing.id = tc.id;
                        if (tc.name) existing.name = tc.name;
                        if (tc.arguments) existing.arguments = (existing.arguments || '') + (typeof tc.arguments === 'string' ? tc.arguments : '');
                    }
                }
                chunk.toolCalls = JSON.parse(JSON.stringify(aggregatedToolCalls));
            }
            yield chunk;
        }

        // Run afterResponse once after the stream completes
        let finalResponse: CompletionResponse = {
            content: aggregatedContent,
            model: finalModel || currentRequest.model,
            usage: finalUsage,
            providerSpecific: finalProviderSpecific
        };

        if (aggregatedToolCalls.length > 0) {
            finalResponse.toolCalls = aggregatedToolCalls.map(tc => {
                try {
                    return { ...tc, arguments: JSON.parse(tc.arguments || '{}') };
                } catch {
                    return tc;
                }
            });
        }

        if (request.schema && aggregatedContent) {
            try {
                finalResponse.data = JSON.parse(aggregatedContent);
            } catch (e: unknown) {
                finalResponse.providerSpecific = {
                    ...finalResponse.providerSpecific,
                    _schemaParseError: e instanceof Error ? e.message : String(e)
                };
            }
        }

        for (const middleware of this.middlewares) {
            if (middleware.afterResponse) {
                finalResponse = await middleware.afterResponse(currentRequest as CompletionRequest, finalResponse);
            }
        }

        // Yield a final summary chunk with the post-middleware metadata (like cost)
        yield {
            content: '',
            data: finalResponse.data,
            toolCalls: finalResponse.toolCalls,
            model: finalResponse.model,
            usage: finalResponse.usage,
            providerSpecific: finalResponse.providerSpecific
        };
    }
}
