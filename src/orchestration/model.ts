import { UnifyClient } from '../core/UnifyClient';
import { CompletionRequest, CompletionResponse, Message } from '../types';
import { Runnable, RunnableFunc } from './chain';

export type RunnableModelOptions = Omit<Partial<CompletionRequest>, 'messages' | 'model'>;

/**
 * Wraps `UnifyClient.generate()` as a runnable pipeline stage.
 */
export class RunnableModel implements Runnable<Message[], CompletionResponse> {
    constructor(
        private readonly client: Pick<UnifyClient, 'generate'>,
        private readonly provider: string,
        private readonly modelName: string,
        private readonly options: RunnableModelOptions = {},
    ) {}

    public async invoke(messages: Message[]): Promise<CompletionResponse> {
        return this.client.generate(this.provider, {
            ...this.options,
            model: this.modelName,
            messages,
        });
    }

    public asRunnable(): RunnableFunc<Message[], CompletionResponse> {
        return (messages: Message[]) => this.invoke(messages);
    }
}