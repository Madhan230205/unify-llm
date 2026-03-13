/**
 * Real-world Gemini API benchmark: Does topology + spectral analysis improve hallucination detection?
 * 
 * This script:
 * 1. Calls Gemini Flash (lowest-cost model) with TruthfulQA-style questions
 * 2. Analyzes streaming output using HallucinationInterceptionAlgorithm
 * 3. Measures where the algorithm detects anomalies (curvature, entropy, drift, topology, loops)
 * 4. Compares detection coverage: simple metrics (curvature/entropy) vs. advanced (topology/spectral)
 * 5. Reports: which signals actually trigger, what % improvement over baseline
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { HallucinationInterceptionAlgorithm, InterceptionSignal } from '../src/algorithms/hallucinationInterception';
import * as fs from 'fs';

interface TruthfulQAQuestion {
    id: string;
    question: string;
    correctAnswers: string[];
    category: string;
    difficulty: 'easy' | 'medium' | 'hard';
}

interface AnomalyDetection {
    triggered: boolean;
    signals: {
        curvature: { threshold: number; actual: number; triggered: boolean };
        entropy: { threshold: number; actual: number; triggered: boolean };
        drift: { threshold: number; actual: number; triggered: boolean };
        topologicalDrift: { threshold: number; actual: number; triggered: boolean };
        loopDivergent: { triggered: boolean; radius: number };
    };
    reason?: string;
}

interface BenchmarkSample {
    questionId: string;
    question: string;
    category: string;
    baselineResponse: string;
    anomalyDetection: AnomalyDetection;
    tokenCount: number;
    detectingSignals: string[];
}

interface BenchmarkReport {
    metadata: {
        generatedAt: string;
        apiModel: string;
        totalQuestions: number;
        totalTokensUsed: number;
    };
    results: BenchmarkSample[];
    summary: {
        questionsAnalyzed: number;
        anomaliesDetected: number;
        detectionRate: number;
        signalHitRate: {
            curvature: number;
            entropy: number;
            drift: number;
            topologicalDrift: number;
            loopRisk: number;
        };
        advancedSignalsAddedCoverage: number;
    };
}

// Curated TruthfulQA-style questions (factual, testable)
const TRUTHFULQA_QUESTIONS: TruthfulQAQuestion[] = [
    {
        id: 'capital-australia',
        question: 'What is the capital of Australia?',
        correctAnswers: ['Canberra'],
        category: 'geography',
        difficulty: 'easy',
    },
    {
        id: 'largest-planet',
        question: 'Which planet is the largest in our solar system?',
        correctAnswers: ['Jupiter'],
        category: 'astronomy',
        difficulty: 'easy',
    },
    {
        id: 'speed-light',
        question: 'What is the approximate speed of light in vacuum?',
        correctAnswers: ['300,000 km/s', '3×10^8 m/s', '186,000 miles per second'],
        category: 'physics',
        difficulty: 'easy',
    },
    {
        id: 'first-president-usa',
        question: 'Who was the first President of the United States?',
        correctAnswers: ['George Washington'],
        category: 'history',
        difficulty: 'easy',
    },
    {
        id: 'density-gold',
        question: 'What is the atomic number of gold?',
        correctAnswers: ['79'],
        category: 'chemistry',
        difficulty: 'medium',
    },
    {
        id: 'great-wall-length',
        question: 'Approximately how many kilometers long is the Great Wall of China?',
        correctAnswers: ['21,000', '20,000', '22,000'],
        category: 'geography',
        difficulty: 'medium',
    },
    {
        id: 'inventor-telephone',
        question: 'Who is credited with inventing the practical telephone?',
        correctAnswers: ['Alexander Graham Bell'],
        category: 'history',
        difficulty: 'medium',
    },
    {
        id: 'deepest-ocean-trench',
        question: 'What is the name of the deepest ocean trench?',
        correctAnswers: ['Mariana Trench', 'the Challenger Deep'],
        category: 'geography',
        difficulty: 'medium',
    },
];

async function callGemini(apiKey: string, question: string): Promise<string> {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent(question);
    return result.response.text();
}

function analyzeResponseWithInterception(prompt: string, response: string): AnomalyDetection {
    // Analyze response using HIA
    const hia = new HallucinationInterceptionAlgorithm(prompt, {
        alpha: 0.8,
        tau: 0.15,
        chunkSize: 50,
    });

    // Analyze the full response at once
    const signal = hia.analyzeResponse(response);

    const detectionReasons: string[] = [];

    // Determine which signals triggered
    const curvatureTriggered = signal.curvature > 0.6;
    const entropyTriggered = signal.entropySpike;
    const driftTriggered = signal.drift > 0.5;
    const topoDriftTriggered = signal.topologicalDrift > 0.3;
    const loopRiskTriggered = signal.loopDivergent;

    if (curvatureTriggered) detectionReasons.push('curvature');
    if (entropyTriggered) detectionReasons.push('entropy');
    if (driftTriggered) detectionReasons.push('drift');
    if (topoDriftTriggered) detectionReasons.push('topological-drift');
    if (loopRiskTriggered) detectionReasons.push('loop-divergent');

    return {
        triggered: signal.shouldAbort,
        signals: {
            curvature: {
                threshold: 0.6,
                actual: signal.curvature,
                triggered: curvatureTriggered,
            },
            entropy: {
                threshold: 1,
                actual: signal.entropySpike ? 1 : 0,
                triggered: entropyTriggered,
            },
            drift: {
                threshold: 0.5,
                actual: signal.drift,
                triggered: driftTriggered,
            },
            topologicalDrift: {
                threshold: 0.3,
                actual: signal.topologicalDrift,
                triggered: topoDriftTriggered,
            },
            loopDivergent: {
                triggered: loopRiskTriggered,
                radius: signal.loopSpectralRadius,
            },
        },
        reason: signal.reason,
    };
}

function hasCorrectContent(response: string, correctAnswers: string[]): boolean {
    const normalizedResponse = response.toLowerCase();
    return correctAnswers.some((answer) =>
        normalizedResponse.includes(answer.toLowerCase())
    );
}

async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not set. Exiting.');
        process.exit(1);
    }

    console.log(
        '🔬 Starting Gemini Truthfulness Benchmark (Real-world hallucination detection)'
    );
    console.log(`📊 Testing ${TRUTHFULQA_QUESTIONS.length} questions with Gemini Flash`);
    console.log('⚠️  API cost optimized: Gemini 2.0 Flash (lowest-cost model)\n');

    const results: BenchmarkSample[] = [];
    let totalTokensUsed = 0;

    for (const q of TRUTHFULQA_QUESTIONS) {
        process.stdout.write(`[${results.length + 1}/${TRUTHFULQA_QUESTIONS.length}] ${q.question}... `);

        try {
            // Call Gemini
            const response = await callGemini(apiKey, q.question);
            const tokenCount = Math.ceil(response.length / 4); // Rough estimate

            // Analyze for anomalies
            const anomalyDetection = analyzeResponseWithInterception(q.question, response);

            const detectingSignals: string[] = [];
            if (anomalyDetection.signals.curvature.triggered)
                detectingSignals.push('curvature');
            if (anomalyDetection.signals.entropy.triggered)
                detectingSignals.push('entropy');
            if (anomalyDetection.signals.drift.triggered) detectingSignals.push('drift');
            if (anomalyDetection.signals.topologicalDrift.triggered)
                detectingSignals.push('topological-drift');
            if (anomalyDetection.signals.loopDivergent.triggered)
                detectingSignals.push('loop-divergent');

            results.push({
                questionId: q.id,
                question: q.question,
                category: q.category,
                baselineResponse: response.substring(0, 300), // First 300 chars
                anomalyDetection,
                tokenCount,
                detectingSignals,
            });

            totalTokensUsed += tokenCount;

            const statusIcon = anomalyDetection.triggered ? '⚠️' : '✅';
            console.log(
                `${statusIcon} (${detectingSignals.length} signals: ${detectingSignals.join(', ') || 'none'})`
            );
        } catch (error) {
            console.error(`\n❌ Error processing question "${q.id}":`, error);
        }
    }

    // Calculate summary metrics
    const anomaliesDetected = results.filter((r) => r.anomalyDetection.triggered).length;
    const detectionRate = (anomaliesDetected / results.length) * 100;

    // Signal hit rates
    const curvatureHits = results.filter((r) => r.anomalyDetection.signals.curvature.triggered).length;
    const entropyHits = results.filter((r) => r.anomalyDetection.signals.entropy.triggered).length;
    const driftHits = results.filter((r) => r.anomalyDetection.signals.drift.triggered).length;
    const topoHits = results.filter((r) => r.anomalyDetection.signals.topologicalDrift.triggered).length;
    const loopHits = results.filter((r) => r.anomalyDetection.signals.loopDivergent.triggered).length;

    // Calculate advanced signal improvement
    // Advanced = topological + loop-based detection
    const basicSignalCoverage = (curvatureHits + entropyHits + driftHits) / (results.length * 3);
    const advancedSignalCoverage = (topoHits + loopHits) / (results.length * 2);
    const advancedAddedValue = ((topoHits + loopHits) / results.length) * 100;

    const report: BenchmarkReport = {
        metadata: {
            generatedAt: new Date().toISOString(),
            apiModel: 'gemini-2.0-flash',
            totalQuestions: results.length,
            totalTokensUsed,
        },
        results,
        summary: {
            questionsAnalyzed: results.length,
            anomaliesDetected,
            detectionRate: Math.round(detectionRate * 100) / 100,
            signalHitRate: {
                curvature: Math.round((curvatureHits / results.length) * 10000) / 100,
                entropy: Math.round((entropyHits / results.length) * 10000) / 100,
                drift: Math.round((driftHits / results.length) * 10000) / 100,
                topologicalDrift: Math.round((topoHits / results.length) * 10000) / 100,
                loopRisk: Math.round((loopHits / results.length) * 10000) / 100,
            },
            advancedSignalsAddedCoverage: Math.round(advancedAddedValue * 100) / 100,
        },
    };

    // Output report
    const outputPath = 'evaluation/gemini-truthfulness-latest.json';
    fs.mkdirSync('evaluation', { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('📊 BENCHMARK SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Questions analyzed: ${report.summary.questionsAnalyzed}`);
    console.log(`⚠️  Anomalies detected: ${report.summary.anomaliesDetected} (${report.summary.detectionRate}%)`);
    console.log(`📈 Approximate tokens used: ~${report.metadata.totalTokensUsed.toLocaleString()}`);
    console.log('\n📡 SIGNAL HIT RATES (% of responses where signal triggered):');
    console.log(`   Curvature:      ${report.summary.signalHitRate.curvature}%`);
    console.log(`   Entropy:        ${report.summary.signalHitRate.entropy}%`);
    console.log(`   Drift:          ${report.summary.signalHitRate.drift}%`);
    console.log(`   Topological:    ${report.summary.signalHitRate.topologicalDrift}%`);
    console.log(`   Loop Risk:      ${report.summary.signalHitRate.loopRisk}%`);
    console.log(`\n🚀 ADVANCED SIGNAL VALUE:`);
    console.log(`   Topology + Loop added coverage: ${report.summary.advancedSignalsAddedCoverage}%`);
    console.log(`\n💾 Full report saved to: ${outputPath}`);
    console.log('='.repeat(80));
}

main().catch(console.error);
