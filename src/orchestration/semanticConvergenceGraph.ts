import { generateHologram, getHammingDistance } from '../analytics/semanticFingerprintEngine';
import { assessDynamicLoopRisk, DynamicTransitionObservation } from '../analytics/loopRiskEngine';
import { Runnable } from './chain';

type MaybePromise<T> = T | Promise<T>;

export interface ResonanceTraceEntry<S> {
    iteration: number;
    nodeId: string;
    state: S;
    semanticDelta: number;
    stablePassCount: number;
    metadata?: Record<string, unknown>;
}

export interface ResonanceGraphContext<S> {
    iteration: number;
    currentNodeId: string;
    visitCount: number;
    trace: ReadonlyArray<ResonanceTraceEntry<S>>;
    getVisitCount(nodeId: string): number;
}

export interface ResonanceNodeOutput<S extends Record<string, unknown>> {
    patch?: Partial<S>;
    next?: string | null;
    halt?: boolean;
    metadata?: Record<string, unknown>;
}

export type ResonanceNodeHandler<S extends Record<string, unknown>> = (
    state: Readonly<S>,
    context: ResonanceGraphContext<S>,
) => MaybePromise<ResonanceNodeOutput<S> | void>;

export interface ResonanceEdge<S extends Record<string, unknown>> {
    from: string;
    to: string;
    condition?: (state: Readonly<S>, context: ResonanceGraphContext<S>) => MaybePromise<boolean>;
}

export interface ResonanceGraphOptions<S extends Record<string, unknown>> {
    startNode: string;
    maxIterations?: number;
    semanticTolerance?: number;
    stablePasses?: number;
    stateProjector?: (state: Readonly<S>) => string;
    mergeState?: (state: S, patch: Partial<S>) => S;
    dynamicLoopGuard?: {
        windowSize?: number;
        divergenceThreshold?: number;
        smoothing?: number;
    };
}

export type ResonanceHaltReason = 'converged' | 'halted' | 'max-iterations' | 'loop-risk';

export interface ResonanceGraphRunResult<S extends Record<string, unknown>> {
    state: S;
    trace: ResonanceTraceEntry<S>[];
    converged: boolean;
    halted: boolean;
    haltReason: ResonanceHaltReason;
    iterations: number;
    lastNodeId: string;
    semanticDelta: number;
    stablePassCount: number;
}

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
            .join(',')}}`;
    }

    return JSON.stringify(String(value));
}

function cloneValue<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
}

function defaultMergeState<S extends Record<string, unknown>>(state: S, patch: Partial<S>): S {
    return {
        ...state,
        ...patch,
    };
}

function computeSemanticDelta(previousProjection: string, nextProjection: string): number {
    if (previousProjection === nextProjection) {
        return 0;
    }

    const previousHologram = generateHologram(previousProjection || ' ');
    const nextHologram = generateHologram(nextProjection || ' ');
    return getHammingDistance(previousHologram, nextHologram);
}

export function createFieldProjector<S extends Record<string, unknown>>(fields: Array<keyof S>): (state: Readonly<S>) => string {
    return (state: Readonly<S>) => fields
        .map((field) => `${String(field)}:${stableStringify(state[field])}`)
        .join('\n');
}

export class SemanticConvergenceGraph<S extends Record<string, unknown>> implements Runnable<S, ResonanceGraphRunResult<S>> {
    private readonly nodes = new Map<string, ResonanceNodeHandler<S>>();
    private readonly edges: ResonanceEdge<S>[] = [];
    private readonly startNode: string;
    private readonly maxIterations: number;
    private readonly semanticTolerance: number;
    private readonly stablePasses: number;
    private readonly stateProjector: (state: Readonly<S>) => string;
    private readonly mergeState: (state: S, patch: Partial<S>) => S;
    private readonly dynamicLoopGuard?: {
        windowSize: number;
        divergenceThreshold: number;
        smoothing: number;
    };

    constructor(options: ResonanceGraphOptions<S>) {
        this.startNode = options.startNode;
        this.maxIterations = options.maxIterations ?? 12;
        this.semanticTolerance = options.semanticTolerance ?? 0.08;
        this.stablePasses = options.stablePasses ?? 2;
        this.stateProjector = options.stateProjector ?? ((state: Readonly<S>) => stableStringify(state));
        this.mergeState = options.mergeState ?? defaultMergeState;
        this.dynamicLoopGuard = options.dynamicLoopGuard
            ? {
                windowSize: options.dynamicLoopGuard.windowSize ?? 6,
                divergenceThreshold: options.dynamicLoopGuard.divergenceThreshold ?? 0.985,
                smoothing: options.dynamicLoopGuard.smoothing ?? 0.05,
            }
            : undefined;
    }

    public addNode(nodeId: string, handler: ResonanceNodeHandler<S>): this {
        this.nodes.set(nodeId, handler);
        return this;
    }

    public addEdge(from: string, to: string, condition?: ResonanceEdge<S>['condition']): this {
        this.edges.push({ from, to, condition });
        return this;
    }

    private createContext(
        iteration: number,
        currentNodeId: string,
        visitCount: number,
        trace: ResonanceTraceEntry<S>[],
        visits: Map<string, number>,
    ): ResonanceGraphContext<S> {
        return {
            iteration,
            currentNodeId,
            visitCount,
            trace,
            getVisitCount(nodeId: string): number {
                return visits.get(nodeId) ?? 0;
            },
        };
    }

    private async resolveNextNode(
        currentNodeId: string,
        state: S,
        context: ResonanceGraphContext<S>,
    ): Promise<string | null> {
        for (const edge of this.edges) {
            if (edge.from !== currentNodeId) {
                continue;
            }

            if (!edge.condition || await edge.condition(state, context)) {
                return edge.to;
            }
        }

        return null;
    }

    public async invoke(initialState: S): Promise<ResonanceGraphRunResult<S>> {
        if (!this.nodes.has(this.startNode)) {
            throw new Error(`SemanticConvergenceGraph start node "${this.startNode}" is not registered.`);
        }

        let state = cloneValue(initialState);
        let currentNodeId = this.startNode;
        let previousProjection = this.stateProjector(state);
        let stablePassCount = 0;
        let semanticDelta = 0;
        const trace: ResonanceTraceEntry<S>[] = [];
        const visits = new Map<string, number>();
        const transitions: DynamicTransitionObservation[] = [];

        for (let iteration = 0; iteration < this.maxIterations; iteration++) {
            const handler = this.nodes.get(currentNodeId);
            if (!handler) {
                throw new Error(`SemanticConvergenceGraph node "${currentNodeId}" is not registered.`);
            }

            const visitCount = (visits.get(currentNodeId) ?? 0) + 1;
            visits.set(currentNodeId, visitCount);

            const context = this.createContext(iteration, currentNodeId, visitCount, trace, visits);
            const output = (await handler(cloneValue(state), context)) ?? {};

            if (output.patch && Object.keys(output.patch).length > 0) {
                state = this.mergeState(state, output.patch);
            }

            const nextProjection = this.stateProjector(state);
            semanticDelta = computeSemanticDelta(previousProjection, nextProjection);
            stablePassCount = semanticDelta <= this.semanticTolerance
                ? stablePassCount + 1
                : 0;

            trace.push({
                iteration,
                nodeId: currentNodeId,
                state: cloneValue(state),
                semanticDelta,
                stablePassCount,
                metadata: output.metadata,
            });

            if (stablePassCount >= this.stablePasses) {
                return {
                    state,
                    trace,
                    converged: true,
                    halted: false,
                    haltReason: 'converged',
                    iterations: trace.length,
                    lastNodeId: currentNodeId,
                    semanticDelta,
                    stablePassCount,
                };
            }

            if (output.halt) {
                return {
                    state,
                    trace,
                    converged: false,
                    halted: true,
                    haltReason: 'halted',
                    iterations: trace.length,
                    lastNodeId: currentNodeId,
                    semanticDelta,
                    stablePassCount,
                };
            }

            const nextContext = this.createContext(iteration, currentNodeId, visitCount, trace, visits);
            const nextNodeId = output.next !== undefined
                ? output.next
                : await this.resolveNextNode(currentNodeId, state, nextContext);

            if (!nextNodeId) {
                return {
                    state,
                    trace,
                    converged: false,
                    halted: true,
                    haltReason: 'halted',
                    iterations: trace.length,
                    lastNodeId: currentNodeId,
                    semanticDelta,
                    stablePassCount,
                };
            }

            if (this.dynamicLoopGuard) {
                transitions.push({ from: currentNodeId, to: nextNodeId });
                const recentTransitions = transitions.slice(-this.dynamicLoopGuard.windowSize);
                const loopRisk = assessDynamicLoopRisk(recentTransitions, {
                    smoothing: this.dynamicLoopGuard.smoothing,
                    divergenceThreshold: this.dynamicLoopGuard.divergenceThreshold,
                });

                if (recentTransitions.length >= this.dynamicLoopGuard.windowSize && loopRisk.divergent && stablePassCount === 0) {
                    return {
                        state,
                        trace,
                        converged: false,
                        halted: true,
                        haltReason: 'loop-risk',
                        iterations: trace.length,
                        lastNodeId: currentNodeId,
                        semanticDelta,
                        stablePassCount,
                    };
                }
            }

            previousProjection = nextProjection;
            currentNodeId = nextNodeId;
        }

        return {
            state,
            trace,
            converged: false,
            halted: false,
            haltReason: 'max-iterations',
            iterations: trace.length,
            lastNodeId: currentNodeId,
            semanticDelta,
            stablePassCount,
        };
    }
}

// Backwards compatibility
export { SemanticConvergenceGraph as ResonanceGraph };
