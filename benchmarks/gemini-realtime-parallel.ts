import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { HallucinationInterceptionAlgorithm } from '../src/algorithms/hallucinationInterception';

interface SampleResult {
    id: number;
    prompt: string;
    ok: boolean;
    latencyMs: number;
    responseChars: number;
    signal: {
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
        reason?: 'curvature-drift' | 'entropy-spike' | 'low-retention' | 'topological-drift' | 'loop-divergence';
    } | null;
    error?: string;
}

function parseArg(name: string, fallback: number): number {
    const idx = process.argv.indexOf(name);
    if (idx === -1 || !process.argv[idx + 1]) return fallback;
    const parsed = Number.parseInt(process.argv[idx + 1], 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPrompts(total: number): string[] {
    const categories = [
        'history',
        'physics',
        'biology',
        'software engineering',
        'mathematics',
        'geography',
        'economics',
        'medicine',
        'cybersecurity',
        'climate science',
    ];

    const templates = [
        'Give a concise factual explanation of {topic} concept #{n} with one concrete real-world example.',
        'State two verifiable facts about {topic} topic #{n} and briefly explain why each is true.',
        'Answer this as a mini reference note for {topic} item #{n}: definition, key mechanism, and common misconception.',
        'Provide a short, accurate summary for {topic} question #{n} using plain language and no speculation.',
        'Explain {topic} principle #{n} in 4-6 sentences with at least one measurable detail.',
    ];

    const prompts: string[] = [];
    for (let i = 0; i < total; i++) {
        const topic = categories[i % categories.length];
        const template = templates[i % templates.length];
        prompts.push(template.replace('{topic}', topic).replace('{n}', String(i + 1)));
    }
    return prompts;
}

async function runMicrobatched<T, R>(items: T[], batchSize: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    for (let offset = 0; offset < items.length; offset += batchSize) {
        const end = Math.min(items.length, offset + batchSize);
        const batch = items.slice(offset, end).map((item, i) => worker(item, offset + i));
        const batchResults = await Promise.all(batch);
        for (let i = 0; i < batchResults.length; i++) {
            out[offset + i] = batchResults[i];
        }
    }
    return out;
}

async function main(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY is not set.');
        process.exit(1);
    }

    const total = Math.max(1, parseArg('--samples', 100));
    const parallel = Math.max(1, parseArg('--parallel', 20));
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    const client = new GoogleGenerativeAI(apiKey);
    const gemini = client.getGenerativeModel({ model });

    const prompts = buildPrompts(total);
    const started = performance.now();

    console.log(`🚀 Running Gemini real-time benchmark`);
    console.log(`   model=${model}`);
    console.log(`   samples=${total}`);
    console.log(`   parallel=${parallel}\n`);

    const results = await runMicrobatched(prompts, parallel, async (prompt, index): Promise<SampleResult> => {
        const t0 = performance.now();

        try {
            const response = await gemini.generateContent(prompt);
            const text = response.response.text() ?? '';
            const hia = new HallucinationInterceptionAlgorithm(prompt, {
                chunkSize: 25,
                tau: 2,
                minBaselineSamples: 3,
            });
            const signal = hia.analyzeResponse(text);

            return {
                id: index + 1,
                prompt,
                ok: true,
                latencyMs: Number((performance.now() - t0).toFixed(2)),
                responseChars: text.length,
                signal,
            };
        } catch (error) {
            return {
                id: index + 1,
                prompt,
                ok: false,
                latencyMs: Number((performance.now() - t0).toFixed(2)),
                responseChars: 0,
                signal: null,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    });

    const totalMs = Number((performance.now() - started).toFixed(2));
    const success = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);

    const avgLatency = success.length > 0
        ? Number((success.reduce((sum, x) => sum + x.latencyMs, 0) / success.length).toFixed(2))
        : 0;

    const signalCompleteCount = success.filter((r) => {
        const s = r.signal;
        if (!s) return false;
        return [
            typeof s.shouldAbort === 'boolean',
            typeof s.curvature === 'number',
            typeof s.drift === 'number',
            typeof s.entropy === 'number',
            typeof s.entropySpike === 'boolean',
            typeof s.modalityShift === 'number',
            typeof s.retention === 'number',
            typeof s.instabilityLift === 'number',
            typeof s.topologicalDrift === 'number',
            typeof s.topologicalComponents === 'number',
            typeof s.loopSpectralRadius === 'number',
            typeof s.loopDivergent === 'boolean',
            (s.reason === undefined || typeof s.reason === 'string'),
        ].every(Boolean);
    }).length;

    const anomalies = success.filter(r => r.signal?.shouldAbort).length;
    const reasonHistogram = success.reduce<Record<string, number>>((acc, r) => {
        const reason = r.signal?.reason ?? 'none';
        acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
    }, {});

    const report = {
        metadata: {
            generatedAt: new Date().toISOString(),
            model,
            samples: total,
            parallel,
            durationMs: totalMs,
            avgLatencyMs: avgLatency,
        },
        summary: {
            successCount: success.length,
            failureCount: failed.length,
            anomalyCount: anomalies,
            signalCompleteness: `${signalCompleteCount}/${success.length}`,
            reasonHistogram,
        },
        failures: failed.slice(0, 20),
    };

    const outPath = resolve(process.cwd(), 'benchmarks', 'gemini-realtime-100.json');
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

    console.log('✅ Completed Gemini parallel run');
    console.log(`   success=${success.length}, failed=${failed.length}`);
    console.log(`   signalCompleteness=${signalCompleteCount}/${success.length}`);
    console.log(`   anomalies=${anomalies}`);
    console.log(`   avgLatencyMs=${avgLatency}`);
    console.log(`   totalDurationMs=${totalMs}`);
    console.log(`   report=${outPath}`);

    if (failed.length > 0) {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error('❌ Fatal benchmark error:', error);
    process.exit(1);
});
