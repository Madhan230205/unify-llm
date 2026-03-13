import { UnifyClient } from '../core/UnifyClient';
import { CompletionRequest, CompletionResponse } from '../types';
import { AdaptiveModelRouter } from '../routers/adaptiveModelRouter';
import { ParetoConstraints, ParetoNavigatorRouter } from '../routers/paretoRouter';

export interface GatewayModelEndpoint {
    id: string;
    provider: string;
    model: string;
    tier?: number;
}

export interface GatewayPlannerContext {
    request: CompletionRequest;
    endpoints: GatewayModelEndpoint[];
}

export type GatewayPlanner = (context: GatewayPlannerContext) => Promise<string[]> | string[];

export interface SelfHealingGatewayOptions {
    endpoints: GatewayModelEndpoint[];
    planner?: GatewayPlanner;
    maxFailovers?: number;
    enableHallucinationFailover?: boolean;
}

interface EndpointAttempt {
    endpointId: string;
    provider: string;
    model: string;
    reason: 'primary' | 'provider-error' | 'hallucination';
    error?: string;
}

function isHallucinationSignal(response: CompletionResponse): boolean {
    const providerSpecific = response.providerSpecific ?? {};
    return Boolean(providerSpecific.curvatureAnomaly || providerSpecific.hallucinationAborted);
}

function normalizeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function buildResumeRequest(request: CompletionRequest, partialContent: string, reason: string): CompletionRequest {
    return {
        ...request,
        messages: [
            ...request.messages,
            { role: 'assistant', content: partialContent },
            {
                role: 'user',
                content:
                    `<system_directive>\n` +
                    `The prior generation was interrupted (${reason}). Continue from the exact semantic boundary. ` +
                    `Do not repeat previous tokens and do not apologize. Output only the next valid continuation.\n` +
                    `</system_directive>`,
            },
        ],
    };
}

export class SelfHealingGateway {
    private readonly endpointsById = new Map<string, GatewayModelEndpoint>();
    private readonly maxFailovers: number;
    private readonly enableHallucinationFailover: boolean;

    constructor(
        private readonly client: UnifyClient,
        private readonly options: SelfHealingGatewayOptions,
    ) {
        if (!options.endpoints || options.endpoints.length === 0) {
            throw new Error('SelfHealingGateway requires at least one endpoint.');
        }

        for (const endpoint of options.endpoints) {
            this.endpointsById.set(endpoint.id, endpoint);
        }

        this.maxFailovers = Math.max(0, options.maxFailovers ?? 2);
        this.enableHallucinationFailover = options.enableHallucinationFailover ?? true;
    }

    public async generate(request: CompletionRequest): Promise<CompletionResponse> {
        const planned = await this.resolvePlan(request);
        let currentRequest = { ...request };
        const attempts: EndpointAttempt[] = [];

        const maxAttempts = Math.min(planned.length, this.maxFailovers + 1);
        for (let i = 0; i < maxAttempts; i++) {
            const endpoint = planned[i];
            const reason: EndpointAttempt['reason'] = i === 0 ? 'primary' : 'provider-error';
            try {
                const response = await this.client.generate(endpoint.provider, {
                    ...currentRequest,
                    model: endpoint.model,
                });

                if (this.enableHallucinationFailover && isHallucinationSignal(response) && i < maxAttempts - 1) {
                    attempts.push({ endpointId: endpoint.id, provider: endpoint.provider, model: endpoint.model, reason: 'hallucination' });
                    currentRequest = buildResumeRequest(request, response.content, 'hallucination-signal');
                    continue;
                }

                return {
                    ...response,
                    providerSpecific: {
                        ...response.providerSpecific,
                        _gateway: {
                            endpoint: endpoint.id,
                            provider: endpoint.provider,
                            model: endpoint.model,
                            attempts,
                        },
                    },
                };
            } catch (error) {
                attempts.push({
                    endpointId: endpoint.id,
                    provider: endpoint.provider,
                    model: endpoint.model,
                    reason,
                    error: normalizeError(error),
                });
                if (i >= maxAttempts - 1) {
                    break;
                }
                currentRequest = buildResumeRequest(request, '', 'provider-failure');
            }
        }

        const tail = attempts[attempts.length - 1];
        throw new Error(`SelfHealingGateway exhausted ${attempts.length} attempts. Last failure: ${tail?.error ?? 'unknown'}`);
    }

    public async *stream(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        const planned = await this.resolvePlan(request);
        let currentRequest = { ...request };
        let partial = '';
        const attempts: EndpointAttempt[] = [];
        const maxAttempts = Math.min(planned.length, this.maxFailovers + 1);

        for (let i = 0; i < maxAttempts; i++) {
            const endpoint = planned[i];
            let hasTerminalChunk = false;

            try {
                const stream = this.client.stream(endpoint.provider, {
                    ...currentRequest,
                    model: endpoint.model,
                });

                for await (const chunk of stream) {
                    if (chunk.content) {
                        partial += chunk.content;
                    }

                    const hallucination = this.enableHallucinationFailover && isHallucinationSignal(chunk);
                    if (hallucination && i < maxAttempts - 1) {
                        attempts.push({ endpointId: endpoint.id, provider: endpoint.provider, model: endpoint.model, reason: 'hallucination' });
                        currentRequest = buildResumeRequest(request, partial, 'hallucination-signal');
                        hasTerminalChunk = true;
                        break;
                    }

                    yield chunk;
                }

                if (!hasTerminalChunk) {
                    return;
                }
            } catch (error) {
                attempts.push({
                    endpointId: endpoint.id,
                    provider: endpoint.provider,
                    model: endpoint.model,
                    reason: i === 0 ? 'primary' : 'provider-error',
                    error: normalizeError(error),
                });

                if (i >= maxAttempts - 1) {
                    break;
                }

                currentRequest = buildResumeRequest(request, partial, 'provider-failure');
            }
        }

        const tail = attempts[attempts.length - 1];
        throw new Error(`SelfHealingGateway stream exhausted ${attempts.length} attempts. Last failure: ${tail?.error ?? 'unknown'}`);
    }

    private async resolvePlan(request: CompletionRequest): Promise<GatewayModelEndpoint[]> {
        if (!this.options.planner) {
            return [...this.options.endpoints];
        }

        const order = await this.options.planner({
            request,
            endpoints: [...this.options.endpoints],
        });

        const seen = new Set<string>();
        const planned: GatewayModelEndpoint[] = [];

        for (const endpointId of order) {
            const endpoint = this.endpointsById.get(endpointId);
            if (!endpoint || seen.has(endpoint.id)) continue;
            planned.push(endpoint);
            seen.add(endpoint.id);
        }

        for (const endpoint of this.options.endpoints) {
            if (seen.has(endpoint.id)) continue;
            planned.push(endpoint);
        }

        return planned;
    }
}

export function createOmniPlanner(
    router: AdaptiveModelRouter,
    endpointModelMap: Record<string, string>,
): GatewayPlanner {
    return async ({ request, endpoints }) => {
        const bestModel = await router.getModel(request);
        const bestEndpoint = endpointModelMap[bestModel];
        const remaining = endpoints
            .filter(endpoint => endpoint.id !== bestEndpoint)
            .sort((a, b) => (a.tier ?? Number.MAX_SAFE_INTEGER) - (b.tier ?? Number.MAX_SAFE_INTEGER))
            .map(endpoint => endpoint.id);

        return bestEndpoint ? [bestEndpoint, ...remaining] : remaining;
    };
}

export function createParetoPlanner(
    router: ParetoNavigatorRouter,
    endpointModelMap: Record<string, string>,
    constraints?: ParetoConstraints,
): GatewayPlanner {
    return async ({ request, endpoints }) => {
        const bestModel = await router.route(request, constraints);
        const bestEndpoint = endpointModelMap[bestModel];
        const remaining = endpoints
            .filter(endpoint => endpoint.id !== bestEndpoint)
            .sort((a, b) => (a.tier ?? Number.MAX_SAFE_INTEGER) - (b.tier ?? Number.MAX_SAFE_INTEGER))
            .map(endpoint => endpoint.id);

        return bestEndpoint ? [bestEndpoint, ...remaining] : remaining;
    };
}
