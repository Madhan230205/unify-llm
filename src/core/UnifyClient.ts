import { CompletionRequest, CompletionResponse, UnifyMiddleware } from '../types';
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

        let response = await provider.generateCompletion(currentRequest as CompletionRequest);

        if (request.schema && response.content) {
            try {
                response = { ...response, data: JSON.parse(response.content) };
            } catch (e) {
                // Ignore parse errors, user can check response.data
            }
        }

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
                    const result = await tool.execute(tc.arguments);
                    return { toolCallId: tc.id, name: tc.name, result };
                } catch (e: any) {
                    return { toolCallId: tc.id, name: tc.name, result: `Error executing tool: ${e.message}` };
                }
            }));

            const nextRequest: CompletionRequest = {
                ...(currentRequest as CompletionRequest),
                messages: [
                    ...(currentRequest as CompletionRequest).messages,
                    { role: 'assistant', content: response.content || '', toolCalls: response.toolCalls },
                    { role: 'tool', content: '', toolResults: executedResults }
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

        const generator = provider.streamCompletion(currentRequest as CompletionRequest);

        let aggregatedContent = '';
        let finalModel = '';
        let finalUsage: any = undefined;
        let finalProviderSpecific: any = {};

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
            yield chunk;
        }

        // Run afterResponse once after the stream completes
        let finalResponse: CompletionResponse = {
            content: aggregatedContent,
            model: finalModel || currentRequest.model,
            usage: finalUsage,
            providerSpecific: finalProviderSpecific
        };

        if (request.schema && aggregatedContent) {
            try {
                finalResponse.data = JSON.parse(aggregatedContent);
            } catch (e) { }
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
            model: finalResponse.model,
            usage: finalResponse.usage,
            providerSpecific: finalResponse.providerSpecific
        };
    }
}
