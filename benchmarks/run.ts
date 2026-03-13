// @ts-nocheck
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

import { createSemanticMomentumGuardian } from '../src/middlewares/hallucinationGuard';
import { ParetoNavigatorRouter } from '../src/routers/paretoRouter';
import { CompletionRequest, CompletionResponse } from '../src/types';

interface BenchmarkOptions {
    iterations: number;
    batchSize: number;
    out: string;
    chunkDelayMs: number;
}

interface AccuracyMetrics {
    accuracyPct: number;
    precisionPct: number;
    recallPct: number;
    falsePositiveRatePct: number;
    averageNormalCurvature: number;
    averageAnomalousCurvature: number;
    sampleCount: number;
    primeCount: number;
}

interface AbortLatencyMetrics {
    averageAbortLatencyMs: number;
    p95AbortLatencyMs: number;
    abortRatePct: number;
    sampleCount: number;
    chunkDelayMs: number;
}

interface CostSavingsMetrics {
    costSavedPct: number;
    selectedSuccessRatePct: number;
    frontierSuccessRatePct: number;
    budgetSelectionRatePct: number;
    sampleCount: number;
    trainingSamples: number;
}

interface ScalingMetrics {
    requestedIterations: number;
    microbatchSize: number;
    batchCount: number;
    wallTimeMs: number;
    yieldedToEventLoop: boolean;
}

interface BenchmarkReport {
    metadata: {
        generatedAt: string;
        nodeVersion: string;
        platform: NodeJS.Platform;
        iterations: number;
        batchSize: number;
        chunkDelayMs: number;
    };
    benchmarks: {
        guardianAccuracy: AccuracyMetrics;
        guardianAbortLatency: AbortLatencyMetrics;
        paretoCostSavings: CostSavingsMetrics;
        scalingBoundaries: ScalingMetrics;
    };
}

function parseArgs(argv: string[]): BenchmarkOptions {
    const options: BenchmarkOptions = {
        iterations: 80,
        batchSize: 20,
        out: 'benchmarks/latest.json',
        chunkDelayMs: 8,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if ((arg === '--iterations' || arg === '-n') && next) {
            options.iterations = Math.max(20, Number.parseInt(next, 10) || options.iterations);
            i++;
        } else if ((arg === '--batch-size' || arg === '-b') && next) {
            options.batchSize = Math.max(1, Number.parseInt(next, 10) || options.batchSize);
            i++;
        } else if ((arg === '--out' || arg === '-o') && next) {
            options.out = next;
            i++;
        } else if (arg === '--chunk-delay-ms' && next) {
            options.chunkDelayMs = Math.max(0, Number.parseInt(next, 10) || options.chunkDelayMs);
            i++;
        }
    }

    return options;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
}

async function runMicrobatched(totalIterations: number, batchSize: number, worker: (index: number) => Promise<void>): Promise<ScalingMetrics> {
    const startedAt = performance.now();
    let batchCount = 0;

    for (let offset = 0; offset < totalIterations; offset += batchSize) {
        const batch: Promise<void>[] = [];
        const end = Math.min(totalIterations, offset + batchSize);
        for (let index = offset; index < end; index++) {
            batch.push(worker(index));
        }
        await Promise.all(batch);
        batchCount++;
        await yieldToLoop();
    }

    return {
        requestedIterations: totalIterations,
        microbatchSize: batchSize,
        batchCount,
        wallTimeMs: Number((performance.now() - startedAt).toFixed(2)),
        yieldedToEventLoop: true,
    };
}

function buildNormalCase(index: number): { prompt: string; response: string } {
    const prompts = [
        'Explain TypeScript interfaces and generics for API clients.',
        'Explain how prompt caching reduces token cost in AI systems.',
        'Explain how rate limiting protects an API gateway during traffic bursts.',
        'Explain why structured JSON schemas help agent workflows stay deterministic.',
    ];
    const responses = [
        'TypeScript interfaces define stable shapes for API messages, while generics let one client function stay reusable across many typed payloads. Together they improve safety, autocomplete, and long-term maintainability for API clients.',
        'Prompt caching reuses repeated context so the model does not bill full prompt tokens every time. That lowers token cost, improves latency, and makes large AI workflows cheaper to run in production.',
        'Rate limiting protects an API gateway by smoothing bursts before providers become overloaded. It preserves reliability, controls retry storms, and keeps latency more predictable under traffic pressure.',
        'Structured JSON schemas make agent workflows deterministic because every field has an expected shape and validation rule. That makes tool calling, parsing, and downstream automation much safer than free-form text.',
    ];

    return {
        prompt: prompts[index % prompts.length],
        response: responses[index % responses.length],
    };
}

function buildAnomalousCase(index: number): { prompt: string; response: string } {
    const anomalies = [
        'Chocolate cookies need butter, sugar, flour, and a hot oven until the edges turn golden and crisp. The baking tray rests beside cinnamon, vanilla, and melted chocolate in a busy kitchen.',
        'Garden roses need sunlight, mulch, watering, and patient pruning before spring flowers arrive in the yard. The soil stays loose while bees move across petals and leaves near the fence.',
        'A telescope tracks cold stars, spiral galaxies, and dim nebula clouds across the night sky above the observatory. Astronomers log moonlight, red shift, and orbital dust through midnight.',
        'Ancient shields, horse saddles, and castle walls filled the medieval courtyard while trumpets echoed at dawn. The blacksmith hammered iron beside armor racks and stone towers before battle.',
    ];

    return {
        prompt: buildNormalCase(index).prompt,
        response: anomalies[index % anomalies.length],
    };
}

async function executeWrapGenerate(
    guardian: ReturnType<typeof createSemanticMomentumGuardian>,
    prompt: string,
    response: string
): Promise<CompletionResponse> {
    const request: CompletionRequest = {
        model: 'benchmark-model',
        messages: [{ role: 'user', content: prompt }],
    };

    return guardian.wrapGenerate!(request, async () => ({
        content: response,
        model: 'benchmark-model',
    }));
}

async function primeGuardian(
    guardian: ReturnType<typeof createSemanticMomentumGuardian>,
    count: number
): Promise<void> {
    for (let index = 0; index < count; index++) {
        const sample = buildNormalCase(index);
        await executeWrapGenerate(guardian, sample.prompt, sample.response);
    }
}

async function benchmarkGuardianAccuracy(iterations: number, batchSize: number): Promise<AccuracyMetrics> {
    const primeCount = Math.max(20, Math.floor(iterations * 0.2));

    let truePositive = 0;
    let trueNegative = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    const normalCurvatures: number[] = [];
    const anomalousCurvatures: number[] = [];

    await runMicrobatched(iterations, batchSize, async (index) => {
        const guardian = createSemanticMomentumGuardian({ alpha: 1.25, tau: 2, chunkSize: 6 });
        await primeGuardian(guardian, primeCount);
        const isAnomalous = index % 2 === 1;
        const sample = isAnomalous ? buildAnomalousCase(index) : buildNormalCase(index);
        const response = await executeWrapGenerate(guardian, sample.prompt, sample.response);
        const predicted = Boolean(response.providerSpecific?.curvatureAnomaly);
        const curvature = Number(response.providerSpecific?.semanticCurvature ?? 0);

        if (isAnomalous) {
            anomalousCurvatures.push(curvature);
            if (predicted) {
                truePositive++;
            } else {
                falseNegative++;
            }
        } else {
            normalCurvatures.push(curvature);
            if (predicted) {
                falsePositive++;
            } else {
                trueNegative++;
            }
        }
    });

    const accuracy = (truePositive + trueNegative) / iterations;
    const precision = truePositive / Math.max(1, truePositive + falsePositive);
    const recall = truePositive / Math.max(1, truePositive + falseNegative);
    const falsePositiveRate = falsePositive / Math.max(1, falsePositive + trueNegative);

    return {
        accuracyPct: Number((accuracy * 100).toFixed(2)),
        precisionPct: Number((precision * 100).toFixed(2)),
        recallPct: Number((recall * 100).toFixed(2)),
        falsePositiveRatePct: Number((falsePositiveRate * 100).toFixed(2)),
        averageNormalCurvature: Number(mean(normalCurvatures).toFixed(6)),
        averageAnomalousCurvature: Number(mean(anomalousCurvatures).toFixed(6)),
        sampleCount: iterations,
        primeCount,
    };
}

async function benchmarkGuardianAbortLatency(iterations: number, chunkDelayMs: number): Promise<AbortLatencyMetrics> {
    const latencies: number[] = [];
    let abortedCount = 0;

    for (let iteration = 0; iteration < iterations; iteration++) {
        const guardian = createSemanticMomentumGuardian({ alpha: 1.1, tau: 2, chunkSize: 4 });
        await primeGuardian(guardian, 24);
        const normalCase = buildNormalCase(iteration);
        const anomalousCase = buildAnomalousCase(iteration);
        const request: CompletionRequest = {
            model: 'benchmark-model',
            messages: [{ role: 'user', content: normalCase.prompt }],
            stream: true,
        };

        const calmChunks = normalCase.response
            .split(/\s+/)
            .reduce<string[]>((chunks, word, index) => {
                const bucket = Math.floor(index / 4);
                chunks[bucket] = `${chunks[bucket] ?? ''}${word} `;
                return chunks;
            }, [])
            .slice(0, 3);
        const anomalousChunks = anomalousCase.response
            .split(/\s+/)
            .reduce<string[]>((chunks, word, index) => {
                const bucket = Math.floor(index / 4);
                chunks[bucket] = `${chunks[bucket] ?? ''}${word} `;
                return chunks;
            }, [])
            .slice(0, 3);

        let anomalyStartedAt = 0;
        const stream = guardian.wrapStream!(request, async function* () {
            const allChunks = [...calmChunks, ...anomalousChunks];
            for (let index = 0; index < allChunks.length; index++) {
                await new Promise(resolve => setTimeout(resolve, chunkDelayMs));
                if (index === calmChunks.length) {
                    anomalyStartedAt = performance.now();
                }
                yield {
                    content: allChunks[index],
                    model: 'benchmark-model',
                };
            }
        });

        for await (const chunk of stream) {
            if (chunk.providerSpecific?.hallucinationAborted) {
                if (anomalyStartedAt > 0) {
                    abortedCount++;
                    latencies.push(performance.now() - anomalyStartedAt);
                }
                break;
            }
        }
    }

    return {
        averageAbortLatencyMs: Number(mean(latencies).toFixed(2)),
        p95AbortLatencyMs: Number(percentile(latencies, 95).toFixed(2)),
        abortRatePct: Number(((abortedCount / Math.max(1, iterations)) * 100).toFixed(2)),
        sampleCount: iterations,
        chunkDelayMs,
    };
}

type RequestProfile = 'simple' | 'medium' | 'complex';

function buildRoutingRequest(index: number, rng: () => number): { request: CompletionRequest; profile: RequestProfile } {
    const bucket = rng();
    const profile: RequestProfile = bucket < 0.45 ? 'simple' : bucket < 0.75 ? 'medium' : 'complex';

    if (profile === 'simple') {
        return {
            profile,
            request: {
                model: 'auto',
                messages: [{ role: 'user', content: `Write a concise product summary for release note ${index}.` }],
                temperature: 0.3,
            },
        };
    }

    if (profile === 'medium') {
        return {
            profile,
            request: {
                model: 'auto',
                messages: [{ role: 'user', content: `Transform this support note ${index} into structured JSON with key actions and owner fields.` }],
                schema: {
                    type: 'object',
                    properties: {
                        actions: { type: 'array', items: { type: 'string' } },
                        owner: { type: 'string' },
                    },
                },
                temperature: 0.4,
            },
        };
    }

    return {
        profile,
        request: {
            model: 'auto',
            messages: [{ role: 'user', content: `Use tool calling to analyze codebase incident ${index}, classify risk, and propose a patch plan.` }],
            tools: [{ name: 'analyzeRisk', description: 'Analyze incident risk', schema: { type: 'object' } }],
            schema: {
                type: 'object',
                properties: {
                    summary: { type: 'string' },
                    risk: { type: 'string' },
                    steps: { type: 'array', items: { type: 'string' } },
                },
            },
            temperature: 0.6,
        },
    };
}

function evaluateModel(modelId: string, profile: RequestProfile, rng: () => number): { success: boolean; latencyMs: number; costUsd: number } {
    const frontier = modelId === 'frontier-model';

    const successThresholds: Record<RequestProfile, { frontier: number; budget: number }> = {
        simple: { frontier: 0.985, budget: 0.96 },
        medium: { frontier: 0.96, budget: 0.78 },
        complex: { frontier: 0.93, budget: 0.46 },
    };
    const latencies: Record<RequestProfile, { frontier: number; budget: number }> = {
        simple: { frontier: 980, budget: 240 },
        medium: { frontier: 1120, budget: 310 },
        complex: { frontier: 1380, budget: 420 },
    };
    const costs: Record<RequestProfile, { frontier: number; budget: number }> = {
        simple: { frontier: 0.012, budget: 0.0024 },
        medium: { frontier: 0.015, budget: 0.0032 },
        complex: { frontier: 0.021, budget: 0.0041 },
    };

    const threshold = frontier ? successThresholds[profile].frontier : successThresholds[profile].budget;
    const latencyBase = frontier ? latencies[profile].frontier : latencies[profile].budget;
    const cost = frontier ? costs[profile].frontier : costs[profile].budget;

    return {
        success: rng() < threshold,
        latencyMs: latencyBase + Math.floor(rng() * 40),
        costUsd: cost,
    };
}

async function benchmarkParetoCostSavings(iterations: number): Promise<CostSavingsMetrics> {
    const router = new ParetoNavigatorRouter(['budget-model', 'frontier-model'], { coldStartThreshold: 1 });
    const trainingSamples = Math.max(120, iterations * 3);

    for (let index = 0; index < trainingSamples; index++) {
        const rng = mulberry32(10_000 + index);
        const { request, profile } = buildRoutingRequest(index, rng);
        for (const modelId of ['budget-model', 'frontier-model']) {
            const outcome = evaluateModel(modelId, profile, rng);
            router.recordFeedback(modelId, request, outcome.latencyMs, outcome.success, outcome.costUsd);
        }
    }

    let selectedTotalCost = 0;
    let frontierTotalCost = 0;
    let selectedSuccesses = 0;
    let frontierSuccesses = 0;
    let budgetSelections = 0;

    for (let index = 0; index < iterations; index++) {
        const rng = mulberry32(20_000 + index);
        const { request, profile } = buildRoutingRequest(index + trainingSamples, rng);
        const selectedModel = await router.route(request, { minQuality: 0.7 });
        const selectedOutcome = evaluateModel(selectedModel, profile, rng);
        const frontierOutcome = evaluateModel('frontier-model', profile, rng);

        selectedTotalCost += selectedOutcome.costUsd;
        frontierTotalCost += frontierOutcome.costUsd;
        selectedSuccesses += selectedOutcome.success ? 1 : 0;
        frontierSuccesses += frontierOutcome.success ? 1 : 0;
        budgetSelections += selectedModel === 'budget-model' ? 1 : 0;
    }

    return {
        costSavedPct: Number(((1 - (selectedTotalCost / Math.max(frontierTotalCost, 1e-9))) * 100).toFixed(2)),
        selectedSuccessRatePct: Number(((selectedSuccesses / Math.max(1, iterations)) * 100).toFixed(2)),
        frontierSuccessRatePct: Number(((frontierSuccesses / Math.max(1, iterations)) * 100).toFixed(2)),
        budgetSelectionRatePct: Number(((budgetSelections / Math.max(1, iterations)) * 100).toFixed(2)),
        sampleCount: iterations,
        trainingSamples,
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));

    const guardianAccuracy = await benchmarkGuardianAccuracy(options.iterations, options.batchSize);
    const guardianAbortLatency = await benchmarkGuardianAbortLatency(Math.max(20, Math.floor(options.iterations / 2)), options.chunkDelayMs);
    const paretoCostSavings = await benchmarkParetoCostSavings(options.iterations);
    const scalingBoundaries = await runMicrobatched(10_000, Math.max(10, Math.min(options.batchSize * 2, 250)), async (index) => {
        const rng = mulberry32(30_000 + index);
        const value = Math.sin(rng()) + Math.cos(rng()) + Math.sqrt(index + 1);
        void value;
    });

    const report: BenchmarkReport = {
        metadata: {
            generatedAt: new Date().toISOString(),
            nodeVersion: process.version,
            platform: process.platform,
            iterations: options.iterations,
            batchSize: options.batchSize,
            chunkDelayMs: options.chunkDelayMs,
        },
        benchmarks: {
            guardianAccuracy,
            guardianAbortLatency,
            paretoCostSavings,
            scalingBoundaries,
        },
    };

    const outputPath = resolve(options.out);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
