import { CompletionRequest, CompletionResponse } from '../types';

export abstract class BaseProvider {
    /**
     * The name of the provider, e.g., 'openai', 'anthropic'.
     */
    abstract readonly name: string;

    /**
     * Translates the unified CompletionRequest to the provider's specific API request.
     * Executes the API call and translates the response back to Unify's CompletionResponse.
     */
    abstract generateCompletion(request: CompletionRequest): Promise<CompletionResponse>;

    /**
     * Streams the completion response chunks as they arrive.
     */
    abstract streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown>;
}
