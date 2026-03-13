import { CompletionRequest, CompletionResponse } from '../types';
import { KinematicTrajectory } from '../analytics/semanticTrajectory';
import {
    DynamicTransitionObservation,
    assessDynamicLoopRisk,
} from '../analytics/loopRiskEngine';
import {
    analyzeSemanticStability,
    computeRobustSemanticDistance,
    computeSemanticInstabilityRisk,
    generateHologram,
    getSemanticModalityDistance,
} from '../analytics/semanticFingerprintEngine';
import { ManifoldExtractor } from '../analytics/contextAnalyzer';
import {
    computeSlicedWasserstein,
    computeTopologicalState,
} from '../analytics/topologyPersistence';
import {
    classifyPromptAnswerability,
    hasEpistemicDisclosure,
    PromptAnswerability,
} from './promptAnswerability';

export interface HallucinationInterceptionOptions {
    alpha?: number;
    tau?: number;
    chunkSize?: number;
    entropyBeta?: number;
    minBaselineSamples?: number;
}

// SIGNAL TUNING PARAMETERS (optimized post-validation)
const ENTROPY_BETA_TUNED = 1.5; // Reduced from 2.5: lower threshold to catch more hallucinations
const LOOP_DIVERGENCE_THRESHOLD_TUNED = 0.72; // recurrence-energy score threshold for multi-state oscillatory loops
const CURVATURE_WEIGHT = 0.3; // Reduced influence: high-D semantic space naturally has low curvature

export interface InterceptionSignal {
    shouldAbort: boolean;
    curvature: number;
    drift: number;
    entropy: number;
    entropySpike: boolean;
    modalityShift: number;
    retention: number;
    instabilityLift: number;
    topologicalDrift: number;
    topologicalComponents: number;
    loopSpectralRadius: number;
    loopDivergent: boolean;
    anomalyScore: number;
    immediateAbort: boolean;
    reason?: 'curvature-drift' | 'entropy-spike' | 'low-retention' | 'topological-drift' | 'loop-divergence';
}

interface SignalStats {
    mean: number;
    variance: number;
    count: number;
}

function updateStats(target: SignalStats, value: number): void {
    target.count++;
    const delta = value - target.mean;
    target.mean += delta / target.count;
    const delta2 = value - target.mean;
    target.variance += delta * delta2;
}

function getStdDev(target: SignalStats): number {
    if (target.count < 2) return 1;
    return Math.sqrt(target.variance / (target.count - 1));
}

function tokenize(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(token => token.length >= 4),
    );
}

function computeRetention(promptTokens: Set<string>, chunk: string): number {
    if (promptTokens.size === 0) return 1;
    const chunkTokens = tokenize(chunk);
    if (chunkTokens.size === 0) return 1;

    let overlap = 0;
    for (const token of chunkTokens) {
        if (promptTokens.has(token)) overlap++;
    }
    return overlap / Math.max(1, chunkTokens.size);
}

function toCoordinate(holo: Int8Array): number[] {
    const out = new Array(holo.length);
    for (let i = 0; i < holo.length; i++) out[i] = holo[i];
    return out;
}

function entropySpikeDetected(stats: SignalStats, value: number, minBaselineSamples: number, entropyBeta: number): boolean {
    // Use aggressive absolute threshold for early detection before baseline warmup
    if (stats.count < minBaselineSamples) {
        // Flag if entropy is above typical semantic content (hallucinations = more elaborate/verbose)
        return value > 4.2; // Lowered from 4.3 for better detection
    }
    // After warmup, use statistical threshold with tuned beta
    const threshold = stats.mean + (entropyBeta * getStdDev(stats));
    return value > threshold;
}

function classifyChunkState(drift: number, modalityShift: number, retention: number): string {
    if (retention < 0.08 && (drift > 0.2 || modalityShift > 0.16)) return 'anomalous';
    if (drift > 0.1 || modalityShift > 0.08) return 'drifting';
    return 'stable';
}

function clamp01(value: number): number {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

/**
 * Hallucination Interception Algorithm (HIA)
 *
 * Explicit pipeline:
 * token stream -> hologram projection -> semantic trajectory monitor
 * -> entropy spike detection -> abort generation.
 */
export class HallucinationInterceptionAlgorithm {
    private alpha: number;
    private tau: number;
    private chunkSize: number;
    private entropyBeta: number;
    private minBaselineSamples: number;
    private trajectory = new KinematicTrajectory(10000);
    private promptAnchorText = '';
    private promptTokens = new Set<string>();
    private promptRisk = 0;
    private promptAnswerability: PromptAnswerability = {
        type: 'answerable',
        confidence: 0.5,
        scores: {
            answerable: 0.5,
            unanswerable: 0,
            speculative: 0,
        },
    };
    private promptTopologicalState = computeTopologicalState([]);
    private buffer = '';
    private consecutiveAnomalies = 0;
    private previousSemanticState = 'stable';
    private transitions: DynamicTransitionObservation[] = [];
    private manifoldStates: number[][] = [];

    private curvatureStats: SignalStats = { mean: 0, variance: 0, count: 0 };
    private driftStats: SignalStats = { mean: 0, variance: 0, count: 0 };
    private entropyStats: SignalStats = { mean: 0, variance: 0, count: 0 };
    private topologyStats: SignalStats = { mean: 0, variance: 0, count: 0 };

    constructor(promptText: string, options: HallucinationInterceptionOptions = {}) {
        this.alpha = options.alpha ?? 3.0;
        this.tau = options.tau ?? 2;
        this.chunkSize = options.chunkSize ?? 30;
        this.entropyBeta = options.entropyBeta ?? ENTROPY_BETA_TUNED; // Use tuned value
        this.minBaselineSamples = options.minBaselineSamples ?? 5;

        this.configurePrompt(promptText);
    }

    private configurePrompt(promptText: string): void {
        const normalizedPrompt = promptText.trim();
        this.promptTokens = tokenize(normalizedPrompt);
        this.promptRisk = computeSemanticInstabilityRisk(analyzeSemanticStability(normalizedPrompt));
        this.promptAnswerability = classifyPromptAnswerability(normalizedPrompt);

        const words = normalizedPrompt.split(/\s+/).filter(Boolean);
        const chunks: string[] = [];
        for (let i = 0; i < words.length; i += this.chunkSize) {
            chunks.push(words.slice(i, i + this.chunkSize).join(' '));
        }

        this.promptAnchorText = chunks[chunks.length - 1] ?? normalizedPrompt;
        for (const chunk of chunks.slice(-3)) {
            this.trajectory.pushCoordinate(toCoordinate(generateHologram(chunk.length > 0 ? chunk : ' ')));
        }

        const promptPoints = (chunks.length > 0 ? chunks : [normalizedPrompt])
            .filter(Boolean)
            .map(chunk => ManifoldExtractor.extract(chunk));
        this.promptTopologicalState = computeTopologicalState(promptPoints);
        this.manifoldStates = [...promptPoints];
    }

    private evaluateChunk(chunk: string): InterceptionSignal {
        const chunkEnvelope = analyzeSemanticStability(chunk);
        const responseRisk = computeSemanticInstabilityRisk(chunkEnvelope);
        this.trajectory.pushCoordinate(toCoordinate(generateHologram(chunk)));

        const curvature = this.trajectory.getWindowedCurvature(2);
        const drift = computeRobustSemanticDistance(this.promptAnchorText, chunk);
        const modalityShift = getSemanticModalityDistance(this.promptAnchorText, chunk);
        const entropy = ManifoldExtractor.calculateEntropy(chunk);
        const manifoldPoint = ManifoldExtractor.extract(chunk);
        this.manifoldStates.push(manifoldPoint);
        const recentManifold = this.manifoldStates.slice(-12);
        const chunkTopology = computeTopologicalState(recentManifold);
        const topologicalDrift = computeSlicedWasserstein(
            this.promptTopologicalState.diagram,
            chunkTopology.diagram,
            24,
            7331,
        );

        const retention = computeRetention(this.promptTokens, chunk);
        const instabilityLift = Math.max(0, responseRisk - this.promptRisk);
        const epistemicDisclosure = hasEpistemicDisclosure(chunk);
        const unanswerablePrompt = this.promptAnswerability.type === 'unanswerable'
            && this.promptAnswerability.confidence >= 0.55;
        const speculativePrompt = this.promptAnswerability.type === 'speculative'
            && this.promptAnswerability.confidence >= 0.55;
        const impossiblePrompt = unanswerablePrompt || speculativePrompt;
        const disclosureSafeResponse = impossiblePrompt && epistemicDisclosure;
        const answerablePrompt = this.promptAnswerability.type === 'answerable'
            && this.promptAnswerability.confidence >= 0.55;
        const unnecessaryRefusal = answerablePrompt
            && epistemicDisclosure
            && (drift < Math.max(0.45, this.driftStats.mean + 0.04) || retention > 0.15);
        const impossibilityNonDisclosure = impossiblePrompt
            && !epistemicDisclosure
            && (
                drift > Math.max(0.06, this.driftStats.mean)
                || modalityShift > 0.08
                || retention < 0.3
            );

        const currentState = classifyChunkState(drift, modalityShift, retention);
        this.transitions.push({
            from: this.previousSemanticState,
            to: currentState,
            weight: 1,
        });
        this.previousSemanticState = currentState;
        const transitionWindow = this.transitions.slice(-64);
        const loopRisk = assessDynamicLoopRisk(transitionWindow, {
            smoothing: 0.01, // Reduced heavily: prevents spectral radius saturation on small graphs
            divergenceThreshold: LOOP_DIVERGENCE_THRESHOLD_TUNED,
        });

        const curvatureThreshold = this.curvatureStats.mean + (this.alpha * getStdDev(this.curvatureStats));
        const driftThreshold = this.driftStats.mean + (this.alpha * getStdDev(this.driftStats));
        const topologyThreshold = this.topologyStats.mean + (this.alpha * getStdDev(this.topologyStats));
        // Relaxed curvature check: high-D semantic space naturally has low curvature
        // Only flag geometric anomaly if DRIFT is high OR (curvature AND drift both elevated)
        const geometricAnomaly = this.driftStats.count >= this.minBaselineSamples
            && drift > driftThreshold
            && (modalityShift > 0.08 || instabilityLift > 0.05);

        const topologicalAnomaly = this.topologyStats.count >= this.minBaselineSamples
            && topologicalDrift > topologyThreshold
            && chunkTopology.componentCount >= Math.max(2, this.promptTopologicalState.componentCount + 1);

        const entropySpike = entropySpikeDetected(this.entropyStats, entropy, this.minBaselineSamples, this.entropyBeta);
        const lowRetentionDrift = !disclosureSafeResponse
            && retention < 0.05
            && drift > (this.driftStats.mean + 0.01)
            && modalityShift > 0.15;
        // Loop divergence: recurrence-energy catches oscillatory semantic attractors without
        // falsely treating every stochastic transition kernel as divergent.
        const loopDivergence = loopRisk.divergent && transitionWindow.length >= 4;

        let reason: InterceptionSignal['reason'] | undefined;
        const anomaly = geometricAnomaly
            || topologicalAnomaly
            || loopDivergence
            || (entropySpike && drift > Math.max(0.05, this.driftStats.mean))
            || lowRetentionDrift
            || impossibilityNonDisclosure
            || unnecessaryRefusal;

        if (anomaly) {
            this.consecutiveAnomalies++;
            if (loopDivergence) reason = 'loop-divergence';
            else if (topologicalAnomaly) reason = 'topological-drift';
            else if (impossibilityNonDisclosure) reason = 'low-retention';
            else if (unnecessaryRefusal) reason = 'low-retention';
            else if (lowRetentionDrift) reason = 'low-retention';
            else if (entropySpike) reason = 'entropy-spike';
            else reason = 'curvature-drift';
        } else {
            this.consecutiveAnomalies = 0;
        }

        // Adaptive evidence score to avoid losing strong single-chunk anomalies behind strict consecutive gating.
        // This preserves robustness while increasing recall on short responses.
        const driftExcess = Math.max(0, drift - this.driftStats.mean);
        const driftStd = Math.max(0.05, getStdDev(this.driftStats));
        const normalizedDrift = clamp01(driftExcess / (2 * driftStd));

        let anomalyScore = 0;
        if (geometricAnomaly) anomalyScore += 0.22;
        if (topologicalAnomaly) anomalyScore += 0.24;
        if (entropySpike) anomalyScore += 0.26;
        if (loopDivergence) anomalyScore += 0.2;
        if (lowRetentionDrift) anomalyScore += 0.28;
        if (impossibilityNonDisclosure) {
            const impossibilityPrior = clamp01(
                this.promptAnswerability.scores.unanswerable + (0.7 * this.promptAnswerability.scores.speculative),
            );
            anomalyScore += 0.16 + (0.18 * impossibilityPrior);
        }
        if (unnecessaryRefusal) anomalyScore += 0.14 + (0.08 * this.promptAnswerability.confidence);
        anomalyScore += 0.12 * normalizedDrift;
        if (retention < 0.12 && !disclosureSafeResponse) anomalyScore += 0.08;
        if (modalityShift > 0.12) anomalyScore += 0.08;
        if (disclosureSafeResponse) anomalyScore -= 0.14;
        anomalyScore = clamp01(anomalyScore);

        // Evidence promotion layer (Invented: Counterfactual Single-Chunk Collapse Gate)
        // Converts rich anomaly evidence into decisive aborts for short responses where
        // consecutive anomaly counters are structurally disadvantaged.
        const entropyEvidenceAbort = entropySpike
            && (
                drift > Math.max(0.22, this.driftStats.mean + 0.02)
                || retention < 0.28
                || instabilityLift > 0.03
            );

        const topologyEvidenceAbort = topologicalAnomaly
            || (
                topologicalDrift > Math.max(0.18, this.topologyStats.mean + 0.02)
                && chunkTopology.componentCount >= 2
            );

        // Avoid pure loop-only aborts: require semantic corroboration.
        const loopEvidenceAbort = loopDivergence
            && (
                entropySpike
                || drift > Math.max(0.32, this.driftStats.mean + 0.03)
                || modalityShift > 0.12
                || retention < 0.2
            );

        const strongSignalPresent = lowRetentionDrift
            || impossibilityNonDisclosure
            || entropyEvidenceAbort
            || topologyEvidenceAbort
            || loopEvidenceAbort;

        const immediateAbort = anomaly && (
            strongSignalPresent
            || anomalyScore >= 0.62
        );

        const scoreBackstopAbort = anomalyScore >= 0.5
            && (entropySpike || topologicalAnomaly || lowRetentionDrift);

        const shouldAbort = this.consecutiveAnomalies >= this.tau || immediateAbort || scoreBackstopAbort;

        updateStats(this.curvatureStats, curvature);
        updateStats(this.driftStats, drift);
        updateStats(this.entropyStats, entropy);
        updateStats(this.topologyStats, topologicalDrift);

        return {
            shouldAbort,
            curvature,
            drift,
            entropy,
            entropySpike,
            modalityShift,
            retention,
            instabilityLift,
            topologicalDrift,
            topologicalComponents: chunkTopology.componentCount,
            loopSpectralRadius: loopRisk.spectralRadius,
            loopDivergent: loopRisk.divergent,
            anomalyScore,
            immediateAbort,
            reason,
        };
    }

    public ingestTokenChunk(contentDelta: string): InterceptionSignal | null {
        this.buffer += contentDelta;
        const words = this.buffer.split(/\s+/);
        if (words.length < this.chunkSize) return null;

        const chunk = words.slice(0, this.chunkSize).join(' ');
        this.buffer = words.slice(this.chunkSize).join(' ');
        return this.evaluateChunk(chunk);
    }

    public analyzeResponse(responseText: string): InterceptionSignal {
        const words = responseText.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            return {
                shouldAbort: false,
                curvature: 0,
                drift: 0,
                entropy: 0,
                entropySpike: false,
                modalityShift: 0,
                retention: 1,
                instabilityLift: 0,
                topologicalDrift: 0,
                topologicalComponents: this.promptTopologicalState.componentCount,
                loopSpectralRadius: 0,
                loopDivergent: false,
                anomalyScore: 0,
                immediateAbort: false,
                reason: undefined,
            };
        }

        let lastSignal: InterceptionSignal = {
            shouldAbort: false,
            curvature: 0,
            drift: 0,
            entropy: 0,
            entropySpike: false,
            modalityShift: 0,
            retention: 1,
            instabilityLift: 0,
            topologicalDrift: 0,
            topologicalComponents: this.promptTopologicalState.componentCount,
            loopSpectralRadius: 0,
            loopDivergent: false,
            anomalyScore: 0,
            immediateAbort: false,
            reason: undefined,
        };

        for (let i = 0; i < words.length; i += this.chunkSize) {
            const chunk = words.slice(i, i + this.chunkSize).join(' ');
            if (!chunk) continue;
            lastSignal = this.evaluateChunk(chunk);
            if (lastSignal.shouldAbort) return lastSignal;
        }

        return lastSignal;
    }
}

export function createInterceptionAlgorithmFromRequest(
    request: CompletionRequest,
    options: HallucinationInterceptionOptions = {},
): HallucinationInterceptionAlgorithm {
    const promptText = request.messages
        .map(message => typeof message.content === 'string' ? message.content : '')
        .join(' ');

    return new HallucinationInterceptionAlgorithm(promptText, options);
}

export function annotateResponseWithInterception(
    response: CompletionResponse,
    signal: InterceptionSignal,
): CompletionResponse {
    return {
        ...response,
        providerSpecific: {
            ...response.providerSpecific,
            semanticCurvature: signal.curvature,
            semanticDrift: signal.drift,
            semanticEntropy: signal.entropy,
            semanticEntropySpike: signal.entropySpike,
            semanticModalityShift: signal.modalityShift,
            semanticRetention: signal.retention,
            semanticInstabilityLift: signal.instabilityLift,
            semanticTopologicalDrift: signal.topologicalDrift,
            semanticTopologicalComponents: signal.topologicalComponents,
            semanticLoopSpectralRadius: signal.loopSpectralRadius,
            semanticLoopDivergent: signal.loopDivergent,
            semanticAnomalyScore: signal.anomalyScore,
            semanticImmediateAbort: signal.immediateAbort,
            curvatureAnomaly: signal.shouldAbort,
            hallucinationAborted: signal.shouldAbort,
            interceptionReason: signal.reason,
        },
    };
}
