import { generateHologram, getHammingDistance } from '../analytics/semanticFingerprintEngine';
import { Runnable, RunnableLike } from './chain';

type MaybePromise<T> = T | Promise<T>;

export interface ResonanceToolCandidate {
    name: string;
    description: string;
    resonance: number;
    uses: number;
}

export interface ResonanceToolResult<S extends Record<string, unknown>> {
    patch?: Partial<S>;
    artifact?: unknown;
    metadata?: Record<string, unknown>;
}

export interface ResonanceTool<S extends Record<string, unknown>> {
    name: string;
    description: string;
    profile?: string;
    maxUses?: number;
    enabled?: (state: Readonly<S>) => MaybePromise<boolean>;
    execute(state: Readonly<S>): MaybePromise<Partial<S> | ResonanceToolResult<S>>;
}

export interface ResonanceAgentPlannerInput<S extends Record<string, unknown>> {
    state: Readonly<S>;
    iteration: number;
    tools: ResonanceToolCandidate[];
    trace: ReadonlyArray<ResonanceAgentTraceEntry<S>>;
}

export interface ResonanceAgentPlan<S extends Record<string, unknown>> {
    thought?: string;
    tool?: string | null;
    answer?: string;
    done?: boolean;
    patch?: Partial<S>;
    metadata?: Record<string, unknown>;
}

export interface ResonanceAgentCriticInput<S extends Record<string, unknown>> {
    state: Readonly<S>;
    iteration: number;
    semanticDelta: number;
    selectedTool?: string;
    trace: ReadonlyArray<ResonanceAgentTraceEntry<S>>;
}

export interface ResonanceAgentCriticResult<S extends Record<string, unknown>> {
    approved?: boolean;
    answer?: string;
    patch?: Partial<S>;
    critique?: string;
    metadata?: Record<string, unknown>;
}

export interface ResonanceAgentTraceEntry<S extends Record<string, unknown>> {
    iteration: number;
    selectedTool?: string;
    candidateTools: ResonanceToolCandidate[];
    thought?: string;
    answer?: string;
    approved?: boolean;
    semanticDelta: number;
    state: S;
    metadata?: Record<string, unknown>;
}

export interface ResonanceAgentOptions<S extends Record<string, unknown>> {
    planner: RunnableLike<ResonanceAgentPlannerInput<S>, ResonanceAgentPlan<S>>;
    tools?: ReadonlyArray<ResonanceTool<S>>;
    critic?: RunnableLike<ResonanceAgentCriticInput<S>, ResonanceAgentCriticResult<S>>;
    maxIterations?: number;
    semanticTolerance?: number;
    stablePasses?: number;
    topKTools?: number;
    minToolResonance?: number;
    answerField?: keyof S & string;
    approvalField?: keyof S & string;
    critiqueField?: keyof S & string;
    stateProjector?: (state: Readonly<S>) => string;
    mergeState?: (state: S, patch: Partial<S>) => S;
}

export interface ResonanceAgentRunResult<S extends Record<string, unknown>> {
    state: S;
    trace: ResonanceAgentTraceEntry<S>[];
    finalAnswer?: string;
    approved: boolean;
    converged: boolean;
    iterations: number;
    semanticDelta: number;
    stablePassCount: number;
}

function isRunnable<Input, Output>(value: RunnableLike<Input, Output>): value is Runnable<Input, Output> {
    return typeof value === 'object' && value !== null && 'invoke' in value && typeof value.invoke === 'function';
}

function toRunnableFunc<Input, Output>(step: RunnableLike<Input, Output>): (input: Input) => Promise<Output> {
    if (isRunnable(step)) {
        return async (input: Input) => step.invoke(input);
    }

    return async (input: Input) => step(input);
}

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
            .join(',')}}`;
    }

    return JSON.stringify(String(value));
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3);
}

function lexicalOverlap(left: string, right: string): number {
    const leftTokens = new Set(tokenize(left));
    const rightTokens = new Set(tokenize(right));

    if (leftTokens.size === 0 || rightTokens.size === 0) {
        return 0;
    }

    let overlap = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token)) {
            overlap++;
        }
    }

    return overlap / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function arithmeticIntentBoost(stateProjection: string, profile: string): number {
    const hasArithmeticSurface = /\d/.test(stateProjection) || /[+\-*/=]/.test(stateProjection);
    const looksMathCapable = /math|arith|calcul|equation|numeric|algebra/i.test(profile);
    return hasArithmeticSurface && looksMathCapable ? 0.2 : 0;
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

function normalizeToolResult<S extends Record<string, unknown>>(result: Partial<S> | ResonanceToolResult<S>): ResonanceToolResult<S> {
    if (typeof result === 'object' && result !== null && ('patch' in result || 'artifact' in result || 'metadata' in result)) {
        return result as ResonanceToolResult<S>;
    }

    return { patch: result as Partial<S> };
}

function computeSemanticDelta(previousProjection: string, nextProjection: string): number {
    if (previousProjection === nextProjection) {
        return 0;
    }

    return getHammingDistance(
        generateHologram(previousProjection || ' '),
        generateHologram(nextProjection || ' '),
    );
}

/**
 * ResonanceAgent introduces a semantic tool market:
 * tools compete by resonance with the live state, and the planner only sees the most relevant ones.
 */
export class ResonanceAgent<S extends Record<string, unknown>> implements Runnable<S, ResonanceAgentRunResult<S>> {
    private readonly planner: (input: ResonanceAgentPlannerInput<S>) => Promise<ResonanceAgentPlan<S>>;
    private readonly critic?: (input: ResonanceAgentCriticInput<S>) => Promise<ResonanceAgentCriticResult<S>>;
    private readonly tools: ResonanceTool<S>[];
    private readonly maxIterations: number;
    private readonly semanticTolerance: number;
    private readonly stablePasses: number;
    private readonly topKTools: number;
    private readonly minToolResonance: number;
    private readonly answerField?: keyof S & string;
    private readonly approvalField?: keyof S & string;
    private readonly critiqueField?: keyof S & string;
    private readonly stateProjector: (state: Readonly<S>) => string;
    private readonly mergeState: (state: S, patch: Partial<S>) => S;

    constructor(options: ResonanceAgentOptions<S>) {
        this.planner = toRunnableFunc(options.planner);
        this.critic = options.critic ? toRunnableFunc(options.critic) : undefined;
        this.tools = [...(options.tools ?? [])];
        this.maxIterations = options.maxIterations ?? 10;
        this.semanticTolerance = options.semanticTolerance ?? 0.05;
        this.stablePasses = options.stablePasses ?? 2;
        this.topKTools = options.topKTools ?? 4;
        this.minToolResonance = options.minToolResonance ?? 0.5;
        this.answerField = options.answerField;
        this.approvalField = options.approvalField;
        this.critiqueField = options.critiqueField;
        this.stateProjector = options.stateProjector ?? ((state: Readonly<S>) => stableStringify(state));
        this.mergeState = options.mergeState ?? defaultMergeState;
    }

    public async rankTools(state: Readonly<S>, usageMap: ReadonlyMap<string, number> = new Map()): Promise<ResonanceToolCandidate[]> {
        const stateProjection = this.stateProjector(state);
        const stateHologram = generateHologram(stateProjection || ' ');
        const ranked: ResonanceToolCandidate[] = [];

        for (const tool of this.tools) {
            if (tool.enabled && !(await tool.enabled(state))) {
                continue;
            }

            const uses = usageMap.get(tool.name) ?? 0;
            const profile = tool.profile ?? `${tool.name} ${tool.description}`;
            const profileHologram = generateHologram(profile);
            const baseResonance = 1 - getHammingDistance(stateHologram, profileHologram);
            const overlapBonus = lexicalOverlap(stateProjection, profile) * 0.35;
            const intentBonus = arithmeticIntentBoost(stateProjection, profile);
            const fatiguePenalty = Math.min(0.4, uses * 0.12);
            const resonance = Math.max(0, Math.min(1, baseResonance + overlapBonus + intentBonus - fatiguePenalty));

            ranked.push({
                name: tool.name,
                description: tool.description,
                resonance,
                uses,
            });
        }

        return ranked
            .sort((left, right) => right.resonance - left.resonance || left.uses - right.uses)
            .slice(0, this.topKTools);
    }

    public async invoke(initialState: S): Promise<ResonanceAgentRunResult<S>> {
        let state = cloneValue(initialState);
        let previousProjection = this.stateProjector(state);
        let stablePassCount = 0;
        let semanticDelta = 0;
        let finalAnswer = this.answerField ? String(state[this.answerField] ?? '') : undefined;
        let approved = this.approvalField ? Boolean(state[this.approvalField]) : false;
        const usageMap = new Map<string, number>();
        const trace: ResonanceAgentTraceEntry<S>[] = [];

        for (let iteration = 0; iteration < this.maxIterations; iteration++) {
            const candidateTools = await this.rankTools(state, usageMap);
            const plan = await this.planner({
                state: cloneValue(state),
                iteration,
                tools: candidateTools,
                trace,
            });

            if (plan.patch && Object.keys(plan.patch).length > 0) {
                state = this.mergeState(state, plan.patch);
            }

            let selectedTool: string | undefined;
            let metadata: Record<string, unknown> | undefined = plan.metadata ? { ...plan.metadata } : undefined;

            if (plan.answer !== undefined) {
                finalAnswer = plan.answer;
                if (this.answerField) {
                    state = this.mergeState(state, { [this.answerField]: plan.answer } as Partial<S>);
                }
            }

            if (plan.tool) {
                const candidate = candidateTools.find((tool) => tool.name === plan.tool);
                const concreteTool = this.tools.find((tool) => tool.name === plan.tool);
                const uses = usageMap.get(plan.tool) ?? 0;
                const maxUses = concreteTool?.maxUses ?? 2;

                if (candidate && concreteTool && candidate.resonance >= this.minToolResonance && uses < maxUses) {
                    selectedTool = plan.tool;
                    usageMap.set(plan.tool, uses + 1);
                    const toolResult = normalizeToolResult(await concreteTool.execute(cloneValue(state)));
                    if (toolResult.patch && Object.keys(toolResult.patch).length > 0) {
                        state = this.mergeState(state, toolResult.patch);
                    }
                    metadata = {
                        ...metadata,
                        ...(toolResult.metadata ?? {}),
                        toolArtifact: toolResult.artifact,
                    };
                } else {
                    metadata = {
                        ...metadata,
                        toolRejected: plan.tool,
                    };
                }
            }

            if (this.critic) {
                const nextProjectionPreview = this.stateProjector(state);
                const previewDelta = computeSemanticDelta(previousProjection, nextProjectionPreview);
                const criticResult = await this.critic({
                    state: cloneValue(state),
                    iteration,
                    semanticDelta: previewDelta,
                    selectedTool,
                    trace,
                });

                if (criticResult.patch && Object.keys(criticResult.patch).length > 0) {
                    state = this.mergeState(state, criticResult.patch);
                }

                if (criticResult.answer !== undefined) {
                    finalAnswer = criticResult.answer;
                    if (this.answerField) {
                        state = this.mergeState(state, { [this.answerField]: criticResult.answer } as Partial<S>);
                    }
                }

                if (criticResult.critique !== undefined && this.critiqueField) {
                    state = this.mergeState(state, { [this.critiqueField]: criticResult.critique } as Partial<S>);
                }

                if (criticResult.approved !== undefined) {
                    approved = criticResult.approved;
                    if (this.approvalField) {
                        state = this.mergeState(state, { [this.approvalField]: criticResult.approved } as Partial<S>);
                    }
                }

                metadata = {
                    ...metadata,
                    ...(criticResult.metadata ?? {}),
                };
            }

            const nextProjection = this.stateProjector(state);
            semanticDelta = computeSemanticDelta(previousProjection, nextProjection);
            stablePassCount = semanticDelta <= this.semanticTolerance ? stablePassCount + 1 : 0;

            trace.push({
                iteration,
                selectedTool,
                candidateTools,
                thought: plan.thought,
                answer: finalAnswer,
                approved,
                semanticDelta,
                state: cloneValue(state),
                metadata,
            });

            if (approved || plan.done) {
                return {
                    state,
                    trace,
                    finalAnswer,
                    approved,
                    converged: stablePassCount >= this.stablePasses,
                    iterations: trace.length,
                    semanticDelta,
                    stablePassCount,
                };
            }

            if (stablePassCount >= this.stablePasses) {
                return {
                    state,
                    trace,
                    finalAnswer,
                    approved,
                    converged: true,
                    iterations: trace.length,
                    semanticDelta,
                    stablePassCount,
                };
            }

            previousProjection = nextProjection;
        }

        return {
            state,
            trace,
            finalAnswer,
            approved,
            converged: false,
            iterations: trace.length,
            semanticDelta,
            stablePassCount,
        };
    }
}