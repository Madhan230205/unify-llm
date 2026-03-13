import { UnifyTool } from '../types';

export interface ConnectorExecuteContext<TArgs extends Record<string, unknown> = Record<string, unknown>> {
    args: TArgs;
    signal?: AbortSignal;
}

export interface ConnectorDefinition<TArgs extends Record<string, unknown> = Record<string, unknown>, TResult = unknown> {
    name: string;
    description: string;
    schema: Record<string, unknown>;
    execute: (context: ConnectorExecuteContext<TArgs>) => Promise<TResult> | TResult;
}

export class ConnectorRegistry {
    private readonly connectors = new Map<string, ConnectorDefinition>();

    public register<TArgs extends Record<string, unknown>, TResult>(connector: ConnectorDefinition<TArgs, TResult>): this {
        this.connectors.set(connector.name, connector as ConnectorDefinition);
        return this;
    }

    public unregister(name: string): boolean {
        return this.connectors.delete(name);
    }

    public clear(): void {
        this.connectors.clear();
    }

    public list(): string[] {
        return Array.from(this.connectors.keys());
    }

    public toTools(): UnifyTool[] {
        return Array.from(this.connectors.values()).map(connector => ({
            name: connector.name,
            description: connector.description,
            schema: connector.schema,
            execute: async (args) => connector.execute({ args }),
        }));
    }
}

export interface RestConnectorOptions {
    name: string;
    description: string;
    schema: Record<string, unknown>;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    endpoint: string;
    headers?: Record<string, string>;
    buildBody?: (args: Record<string, unknown>) => unknown;
    responseSelector?: (response: unknown) => unknown;
}

function applyTemplate(template: string, args: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
        const value = args[key];
        return value === undefined || value === null ? '' : encodeURIComponent(String(value));
    });
}

export function createRestConnector(options: RestConnectorOptions): ConnectorDefinition {
    const method = options.method ?? 'GET';

    return {
        name: options.name,
        description: options.description,
        schema: options.schema,
        execute: async ({ args, signal }) => {
            const endpoint = applyTemplate(options.endpoint, args);
            const payload = options.buildBody ? options.buildBody(args) : (method === 'GET' ? undefined : args);

            const response = await fetch(endpoint, {
                method,
                signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
                body: payload === undefined ? undefined : JSON.stringify(payload),
            });

            const raw = await response.json().catch(() => ({ ok: response.ok, status: response.status }));
            if (!response.ok) {
                throw new Error(`Connector ${options.name} failed with status ${response.status}`);
            }

            return options.responseSelector ? options.responseSelector(raw) : raw;
        },
    };
}

export interface ConnectorQueryExecutor<TResult = unknown> {
    run: (query: string, params?: Record<string, unknown>) => Promise<TResult> | TResult;
}

export function createQueryConnector<TResult = unknown>(
    name: string,
    description: string,
    executor: ConnectorQueryExecutor<TResult>,
): ConnectorDefinition<{ query: string; params?: Record<string, unknown> }, TResult> {
    return {
        name,
        description,
        schema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                params: { type: 'object' },
            },
            required: ['query'],
        },
        execute: ({ args }) => executor.run(String(args.query), args.params),
    };
}
