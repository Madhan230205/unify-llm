import { BaseProvider } from './base';
import { CompletionRequest, CompletionResponse, Message, UnifyAPIError } from '../types';

export interface AetherionOptions {
    providers: BaseProvider[];
    /** 
     * If a stream fails midway, the Aetherion Mesh will intercept the failure, 
     * rewrite the prompt with the chunks generated so far, and hot-swap to the 
     * next registered provider without breaking the developer's stream.
     */
    seamlessMidStreamFallback?: boolean;
}

export class AetherionProvider extends BaseProvider {
    readonly name = 'aetherion';
    private providers: BaseProvider[];
    private seamlessMidStreamFallback: boolean;

    constructor(options: AetherionOptions) {
        super();
        if (!options.providers || options.providers.length === 0) {
            throw new UnifyAPIError("Aetherion Mesh requires at least one provider.", this.name);
        }
        this.providers = options.providers;
        this.seamlessMidStreamFallback = options.seamlessMidStreamFallback ?? true;
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        let lastError: any;
        for (const provider of this.providers) {
            try {
                return await provider.generateCompletion(request);
            } catch (error) {
                lastError = error;
                // Provider failed, Mesh automatically continues to the next one
            }
        }
        throw new UnifyAPIError(`Aetherion Mesh exhausted all ${this.providers.length} providers. Last error: ${lastError?.message || lastError}`, this.name);
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        let yieldedContent = '';
        let lastError: any;
        let currentRequest = { ...request };

        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[i];

            try {
                if (yieldedContent && this.seamlessMidStreamFallback) {
                    currentRequest = this.rewriteRequestForResume(request, yieldedContent);
                }

                const stream = provider.streamCompletion(currentRequest);

                for await (const chunk of stream) {
                    yieldedContent += chunk.content;
                    yield {
                        ...chunk,
                        // Override the model name to indicate the Mesh is handling it, but preserve the underlying model
                        model: `aetherion-mesh[${chunk.model}]`
                    };
                }

                // If stream fully completes without throwing, we exit the mesh loop
                return;
            } catch (error) {
                lastError = error;
                if (!this.seamlessMidStreamFallback && yieldedContent) {
                    throw new UnifyAPIError(`Stream failed mid-way on ${provider.name} and seamless fallback is disabled. Error: ${error}`, this.name);
                }
                // If we get an error (either upfront or mid-stream), the mesh suppresses it and hot-swaps!
            }
        }

        throw new UnifyAPIError(`Aetherion Mesh stream exhausted all providers. Yielded ${yieldedContent.length} chars before catastrophic failure. Last error: ${lastError?.message || lastError}`, this.name);
    }

    private rewriteRequestForResume(originalRequest: CompletionRequest, partialContent: string): CompletionRequest {
        const resumedMessages: Message[] = [
            ...originalRequest.messages,
            { role: 'assistant', content: partialContent },
            {
                role: 'user',
                content: '<system_directive>\nThe previous response was interrupted due to a network failure. Resume generation from the exact character where you stopped. Do not apologize, do not introduce your response, and do not repeat any previous text. Output only the immediate next sequential tokens.\n</system_directive>'
            }
        ];

        return {
            ...originalRequest,
            messages: resumedMessages,
        };
    }
}
