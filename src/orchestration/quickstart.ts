import { UnifyClient } from '../core/UnifyClient';
import { CompletionRequest, Message, UnifyTool } from '../types';

type GenerateLikeClient = Pick<UnifyClient, 'generate'>;

export interface QuickstartSessionOptions {
    systemPrompt?: string;
    seedMessages?: Message[];
}

export interface QuickstartClientOptions {
    provider: string;
    model: string;
    systemPrompt?: string;
    defaults?: Omit<Partial<CompletionRequest>, 'messages' | 'model'>;
    tools?: UnifyTool[];
    autoExecute?: boolean;
}

export interface QuickstartAskOptions {
    schema?: Record<string, unknown>;
    tools?: UnifyTool[];
    autoExecute?: boolean;
    request?: Omit<Partial<CompletionRequest>, 'messages' | 'model' | 'schema' | 'tools' | 'autoExecute'>;
}

export class QuickstartSession {
    private readonly history: Message[];

    constructor(
        private readonly client: GenerateLikeClient,
        private readonly options: QuickstartClientOptions,
        sessionOptions: QuickstartSessionOptions = {},
    ) {
        const baseSystemPrompt = sessionOptions.systemPrompt ?? options.systemPrompt;
        const seed = sessionOptions.seedMessages ?? [];
        this.history = [
            ...(baseSystemPrompt ? [{ role: 'system' as const, content: baseSystemPrompt }] : []),
            ...seed,
        ];
    }

    public get messages(): Message[] {
        return [...this.history];
    }

    public async ask(input: string, options: QuickstartAskOptions = {}): Promise<string> {
        const response = await this.execute(input, options);
        return response.content;
    }

    public async askJSON<T>(input: string, schema: Record<string, unknown>, options: Omit<QuickstartAskOptions, 'schema'> = {}): Promise<T> {
        const response = await this.execute(input, { ...options, schema });
        return (response.data ?? null) as T;
    }

    public reset(): void {
        const system = this.history.find(message => message.role === 'system');
        this.history.length = 0;
        if (system) {
            this.history.push(system);
        }
    }

    private async execute(input: string, options: QuickstartAskOptions) {
        this.history.push({ role: 'user', content: input });

        const response = await this.client.generate(this.options.provider, {
            model: this.options.model,
            messages: [...this.history],
            ...this.options.defaults,
            ...options.request,
            schema: options.schema,
            tools: options.tools ?? this.options.tools,
            autoExecute: options.autoExecute ?? this.options.autoExecute,
        });

        this.history.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls as Message['toolCalls'] });
        return response;
    }
}

export class QuickstartClient {
    constructor(
        private readonly client: GenerateLikeClient,
        private readonly options: QuickstartClientOptions,
    ) { }

    public createSession(options: QuickstartSessionOptions = {}): QuickstartSession {
        return new QuickstartSession(this.client, this.options, options);
    }

    public async ask(input: string, options: QuickstartAskOptions = {}): Promise<string> {
        return this.createSession().ask(input, options);
    }

    public async askJSON<T>(input: string, schema: Record<string, unknown>, options: Omit<QuickstartAskOptions, 'schema'> = {}): Promise<T> {
        return this.createSession().askJSON<T>(input, schema, options);
    }
}

export function createQuickstartClient(client: GenerateLikeClient, options: QuickstartClientOptions): QuickstartClient {
    return new QuickstartClient(client, options);
}
