/**
 * Streaming and non-streaming hallucination guard middleware.
 */

import { CompletionRequest, CompletionResponse, UnifyMiddleware } from '../types';
import {
    analyzeSemanticStability,
    computeSemanticInstabilityRisk,
    computeRobustSemanticDistance,
    generateHologram,
    getSemanticModalityDistance,
} from '../analytics/semanticFingerprintEngine';
import { SemanticTrajectoryTracker } from '../analytics/semanticTrajectory';
import {
    annotateResponseWithInterception,
    createInterceptionAlgorithmFromRequest,
} from '../algorithms/hallucinationInterception';
import { QVIPController } from '../algorithms/qvipController';
import {
    detectClaimBoundaryEvents,
    runMicroVerifier,
    splitCompleteSentenceUnits,
} from '../algorithms/microVerifier';

export interface HallucinationGuardOptions {
    alpha?: number;
    tau?: number;
    chunkSize?: number;
    qvipEnabled?: boolean;
    verificationTimeoutMs?: number;
    qvipThetaLow?: number;
    qvipThetaHigh?: number;
}

interface SignalStats {
    mean: number;
    variance: number;
    count: number;
}

export function createHallucinationGuard(
    options: HallucinationGuardOptions = {},
): UnifyMiddleware & {
    getStats: () => {
        mean: number;
        variance: number;
        count: number;
        driftMean: number;
        driftVariance: number;
        driftCount: number;
        curvature: SignalStats;
        drift: SignalStats;
    };
} {
    const alpha = options.alpha ?? 3.0;
    const tau = options.tau ?? 2;
    const chunkSize = options.chunkSize ?? 30;
    const qvipEnabled = options.qvipEnabled ?? true;
    const verificationTimeoutMs = options.verificationTimeoutMs ?? 150;

    const curvatureStats: SignalStats = { mean: 0, variance: 0, count: 0 };
    const driftStats: SignalStats = { mean: 0, variance: 0, count: 0 };

    function updateStats(target: SignalStats, value: number): void {
        target.count++;
        const delta = value - target.mean;
        target.mean += delta / target.count;
        const delta2 = value - target.mean;
        target.variance += delta * delta2;
    }

    function getStdDev(target: SignalStats): number {
        if (target.count < 2) return 1.0;
        return Math.sqrt(target.variance / (target.count - 1));
    }

    function isAnomaly(
        kappa: number,
        drift: number,
        modalityShift: number,
        retention: number,
        promptRisk: number,
        responseRisk: number,
    ): boolean {
        if (curvatureStats.count < 5 || driftStats.count < 5) return false;
        const curvatureThreshold = curvatureStats.mean + alpha * getStdDev(curvatureStats);
        const driftThreshold = driftStats.mean + alpha * getStdDev(driftStats);
        const instabilityLift = Math.max(0, responseRisk - promptRisk);
        const geometricAnomaly = kappa > curvatureThreshold && drift > driftThreshold;
        const lowRetentionDrift = retention < 0.05 && drift > (driftStats.mean + 0.01) && modalityShift > 0.15;
        const unstableBurst = geometricAnomaly && instabilityLift > 0.05 && modalityShift > 0.08;
        return unstableBurst || lowRetentionDrift;
    }

    function hologramToCoordinate(holo: Int8Array): number[] {
        const coord = new Array(holo.length);
        for (let i = 0; i < holo.length; i++) {
            coord[i] = holo[i];
        }
        return coord;
    }

    function textToHologram(text: string): Int8Array {
        return generateHologram(text.length > 0 ? text : ' ');
    }

    function chunkText(text: string): string[] {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const chunks: string[] = [];
        for (let i = 0; i < words.length; i += chunkSize) {
            chunks.push(words.slice(i, i + chunkSize).join(' '));
        }
        return chunks;
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
            if (promptTokens.has(token)) {
                overlap++;
            }
        }

        return overlap / chunkTokens.size;
    }

    function mergeProviderSpecific(
        base: CompletionResponse,
        patch: Record<string, unknown>,
    ): CompletionResponse {
        return {
            ...base,
            providerSpecific: {
                ...base.providerSpecific,
                ...patch,
            },
        };
    }

    function createSyntheticChunk(base: CompletionResponse, content: string): CompletionResponse {
        return {
            ...base,
            content,
        };
    }

    const middleware: UnifyMiddleware & {
        getStats: () => {
            mean: number;
            variance: number;
            count: number;
            driftMean: number;
            driftVariance: number;
            driftCount: number;
            curvature: SignalStats;
            drift: SignalStats;
        };
    } = {
        getStats: () => ({
            mean: curvatureStats.mean,
            variance: curvatureStats.count > 1 ? curvatureStats.variance / (curvatureStats.count - 1) : 0,
            count: curvatureStats.count,
            driftMean: driftStats.mean,
            driftVariance: driftStats.count > 1 ? driftStats.variance / (driftStats.count - 1) : 0,
            driftCount: driftStats.count,
            curvature: {
                mean: curvatureStats.mean,
                variance: curvatureStats.count > 1 ? curvatureStats.variance / (curvatureStats.count - 1) : 0,
                count: curvatureStats.count,
            },
            drift: {
                mean: driftStats.mean,
                variance: driftStats.count > 1 ? driftStats.variance / (driftStats.count - 1) : 0,
                count: driftStats.count,
            },
        }),

        wrapGenerate: async (
            request: CompletionRequest,
            next: (req?: CompletionRequest) => Promise<CompletionResponse>,
        ): Promise<CompletionResponse> => {
            const response = await next(request);

            const algorithm = createInterceptionAlgorithmFromRequest(request, {
                alpha,
                tau,
                chunkSize,
            });
            const coreSignal = algorithm.analyzeResponse(response.content);

            const trajectory = new SemanticTrajectoryTracker(10000);
            const promptText = request.messages
                .map(m => (typeof m.content === 'string' ? m.content : ''))
                .join(' ');
            const promptChunks = chunkText(promptText);
            const promptAnchorText = promptChunks[promptChunks.length - 1] ?? promptText;
            const promptTokens = tokenize(promptText);
            const promptEnvelope = analyzeSemanticStability(promptText);
            const promptRisk = computeSemanticInstabilityRisk(promptEnvelope);
            for (const chunk of promptChunks.slice(-3)) {
                trajectory.pushCoordinate(hologramToCoordinate(textToHologram(chunk)));
            }

            const responseChunks = chunkText(response.content);
            let maxCurvature = 0;
            let maxDrift = 0;
            let maxModalityShift = 0;
            let retentionSum = 0;

            for (const chunk of responseChunks) {
                const chunkHologram = textToHologram(chunk);
                const chunkEnvelope = analyzeSemanticStability(chunk);
                const responseRisk = computeSemanticInstabilityRisk(chunkEnvelope);
                trajectory.pushCoordinate(hologramToCoordinate(chunkHologram));
                const kappa = trajectory.getWindowedCurvature(2);
                const drift = computeRobustSemanticDistance(promptAnchorText, chunk);
                const modalityShift = getSemanticModalityDistance(promptAnchorText, chunk);
                const retention = computeRetention(promptTokens, chunk);
                if (kappa > maxCurvature) maxCurvature = kappa;
                if (drift > maxDrift) maxDrift = drift;
                if (modalityShift > maxModalityShift) maxModalityShift = modalityShift;
                retentionSum += retention;
                updateStats(curvatureStats, kappa);
                updateStats(driftStats, drift);
                void responseRisk;
            }

            const averageRetention = responseChunks.length > 0 ? retentionSum / responseChunks.length : 1;

            response.providerSpecific = {
                ...response.providerSpecific,
                semanticCurvature: maxCurvature,
                semanticDrift: maxDrift,
                semanticModalityShift: maxModalityShift,
                semanticRetention: averageRetention,
                semanticConditionNumber: promptEnvelope.localConditionNumber,
                semanticInstability: promptRisk,
                curvatureAnomaly: isAnomaly(maxCurvature, maxDrift, maxModalityShift, averageRetention, promptRisk, promptRisk),
            };

            const merged = annotateResponseWithInterception(response, coreSignal);
            merged.providerSpecific = {
                ...merged.providerSpecific,
                curvatureAnomaly: Boolean(response.providerSpecific?.curvatureAnomaly || coreSignal.shouldAbort),
                hallucinationAborted: Boolean(response.providerSpecific?.hallucinationAborted || coreSignal.shouldAbort),
            };

            return merged;
        },

        wrapStream: async function* (
            request: CompletionRequest,
            next: (req?: CompletionRequest) => AsyncGenerator<CompletionResponse, void, unknown>,
        ): AsyncGenerator<CompletionResponse, void, unknown> {
            const trajectory = new SemanticTrajectoryTracker(10000);
            const promptText = request.messages
                .map(m => (typeof m.content === 'string' ? m.content : ''))
                .join(' ');
            const promptChunks = chunkText(promptText);
            const promptAnchorText = promptChunks[promptChunks.length - 1] ?? promptText;
            const promptTokens = tokenize(promptText);
            const promptEnvelope = analyzeSemanticStability(promptText);
            const promptRisk = computeSemanticInstabilityRisk(promptEnvelope);
            for (const chunk of promptChunks.slice(-3)) {
                trajectory.pushCoordinate(hologramToCoordinate(textToHologram(chunk)));
            }

            let buffer = '';
            let consecutiveAnomalies = 0;
            let aborted = false;
            let streamTailBuffer = '';
            let lastAnomalyScore = 0;

            const qvipController = new QVIPController({
                thetaLow: options.qvipThetaLow,
                thetaHigh: options.qvipThetaHigh,
            });

            const stream = next(request);
            const algorithm = createInterceptionAlgorithmFromRequest(request, {
                alpha,
                tau,
                chunkSize,
            });

            for await (const chunk of stream) {
                if (aborted) break;

                const coreSignal = chunk.content ? algorithm.ingestTokenChunk(chunk.content) : null;
                if (coreSignal && coreSignal.shouldAbort) {
                    aborted = true;
                    yield annotateResponseWithInterception(chunk, coreSignal);
                    return;
                }

                const anomalyScore = coreSignal?.anomalyScore ?? 0;
                const instabilityJump = Math.abs(anomalyScore - lastAnomalyScore);
                lastAnomalyScore = anomalyScore;
                const riskSnapshot = qvipController.update({
                    anomalyScore,
                    instabilityJump,
                    strongSignal: Boolean(coreSignal?.immediateAbort || coreSignal?.entropySpike || coreSignal?.loopDivergent),
                });

                buffer += chunk.content;
                streamTailBuffer += chunk.content;

                const sentenceSplit = splitCompleteSentenceUnits(streamTailBuffer);
                streamTailBuffer = sentenceSplit.remainder;
                let emitContent = '';

                if (qvipEnabled && sentenceSplit.completed.length > 0) {
                    for (const unit of sentenceSplit.completed) {
                        const boundaryEvents = detectClaimBoundaryEvents(unit);
                        const isClaimBearing = boundaryEvents.some(evt => evt.type !== 'sentence');

                        if (riskSnapshot.state === 'SAFE' || !isClaimBearing) {
                            emitContent += `${unit} `;
                            continue;
                        }

                        const verification = await runMicroVerifier(
                            {
                                promptText,
                                claimText: unit,
                                anomalyScore,
                                signal: request.signal,
                            },
                            verificationTimeoutMs,
                        );

                        const verifiedRisk = qvipController.update({
                            anomalyScore,
                            instabilityJump,
                            strongSignal: Boolean(coreSignal?.immediateAbort || coreSignal?.entropySpike),
                            verificationConfidence: 1 - verification.hallucinationConfidence,
                        });

                        if (verifiedRisk.state === 'UNSAFE' && !verification.timedOut && verification.hallucinationConfidence >= 0.62) {
                            aborted = true;
                            const blocked = createSyntheticChunk(chunk, '');
                            yield mergeProviderSpecific(blocked, {
                                qvipRiskState: verifiedRisk.state,
                                qvipRisk: verifiedRisk.risk,
                                qvipVerificationConfidence: 1 - verification.hallucinationConfidence,
                                qvipVerificationTimedOut: verification.timedOut,
                                qvipClaimBoundaryType: boundaryEvents.map(evt => evt.type).join(','),
                                qvipInterceptionMode: 'abort',
                                qvipReasons: verification.reasons,
                                curvatureAnomaly: true,
                                hallucinationAborted: true,
                            });
                            return;
                        }

                        if (verification.timedOut) {
                            emitContent += `${unit} `;
                        } else if (verification.hallucinationConfidence >= 0.62) {
                            emitContent += 'I may be uncertain about that specific factual claim. ';
                        } else {
                            emitContent += `${unit} `;
                        }

                        const synthetic = createSyntheticChunk(chunk, '');
                        yield mergeProviderSpecific(synthetic, {
                            qvipRiskState: verifiedRisk.state,
                            qvipRisk: verifiedRisk.risk,
                            qvipVerificationConfidence: 1 - verification.hallucinationConfidence,
                            qvipVerificationTimedOut: verification.timedOut,
                            qvipClaimBoundaryType: boundaryEvents.map(evt => evt.type).join(','),
                            qvipInterceptionMode: verification.hallucinationConfidence >= 0.62 ? 'rewrite' : 'pass',
                            qvipReasons: verification.reasons,
                        });
                    }
                }

                const words = buffer.split(/\s+/);
                if (words.length >= chunkSize) {
                    const chunkTextValue = words.slice(0, chunkSize).join(' ');
                    buffer = words.slice(chunkSize).join(' ');

                    const chunkHologram = textToHologram(chunkTextValue);
                    const chunkEnvelope = analyzeSemanticStability(chunkTextValue);
                    const responseRisk = computeSemanticInstabilityRisk(chunkEnvelope);
                    trajectory.pushCoordinate(hologramToCoordinate(chunkHologram));
                    const kappa = trajectory.getWindowedCurvature(2);
                    const drift = computeRobustSemanticDistance(promptAnchorText, chunkTextValue);
                    const modalityShift = getSemanticModalityDistance(promptAnchorText, chunkTextValue);
                    const retention = computeRetention(promptTokens, chunkTextValue);
                    updateStats(curvatureStats, kappa);
                    updateStats(driftStats, drift);

                    if (isAnomaly(kappa, drift, modalityShift, retention, promptRisk, responseRisk)) {
                        consecutiveAnomalies++;
                        if (consecutiveAnomalies >= tau) {
                            aborted = true;
                            yield {
                                ...chunk,
                                providerSpecific: {
                                    ...chunk.providerSpecific,
                                    semanticCurvature: kappa,
                                    semanticDrift: drift,
                                    semanticModalityShift: modalityShift,
                                    semanticRetention: retention,
                                    semanticConditionNumber: chunkEnvelope.localConditionNumber,
                                    semanticInstability: responseRisk,
                                    curvatureAnomaly: true,
                                    hallucinationAborted: true,
                                },
                            };
                            return;
                        }
                    } else {
                        consecutiveAnomalies = 0;
                    }
                }

                if (qvipEnabled) {
                    if (emitContent.length > 0) {
                        yield createSyntheticChunk(chunk, emitContent);
                    }
                } else {
                    yield chunk;
                }
            }

            if (qvipEnabled && streamTailBuffer.trim().length > 0 && !aborted) {
                yield {
                    content: streamTailBuffer,
                    model: request.model,
                    providerSpecific: {
                        qvipInterceptionMode: 'pass',
                        qvipTailFlush: true,
                    },
                };
            }
        },
    };

    return middleware;
}

export { createHallucinationGuard as createSemanticMomentumGuardian };
export type GuardianOptions = HallucinationGuardOptions;
