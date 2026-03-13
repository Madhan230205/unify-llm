/**
 * VALIDATION BENCHMARK: Proof that topology + spectral analysis actually improve detection
 * 
 * This tests whether your advanced analytics can DISTINGUISH between:
 * 1. Correct answers (low hallucination)
 * 2. Plausible-sounding false answers (high hallucination)
 * 
 * Success metric: Can the algorithm score correct answers lower than hallucinated ones?
 * 
 * If topology/spectral analysis adds value → correctAnswers will have lower anomaly scores
 * If not → the algorithm is just noisy, not insightful
 */

import {
    HallucinationInterceptionAlgorithm,
    InterceptionSignal,
} from '../src/algorithms/hallucinationInterception';

interface ValidationQuestion {
    id: string;
    question: string;
    correctAnswer: string;
    hallucinatedAnswer: string;
}

interface ValidationResult {
    questionId: string;
    question: string;
    correctAnswer: {
        response: string;
        score: number;
        signals: string[];
        signal: InterceptionSignal;
    };
    hallucinatedAnswer: {
        response: string;
        score: number;
        signals: string[];
        signal: InterceptionSignal;
    };
    correctlyScored: boolean;
}

interface ValidationReport {
    metadata: {
        generatedAt: string;
        totalQuestions: number;
        totalTests: number;
    };
    results: ValidationResult[];
    summary: {
        correctDetectionRate: number;
        signalEffectiveness: {
            curvatureCorrectness: number;
            entropyCorrectness: number;
            driftCorrectness: number;
            topologicalCorrectness: number;
            loopRiskCorrectness: number;
        };
        advancedSignalsImprovement: {
            topoAlone: number;
            loopAlone: number;
            combined: number;
        };
        verdict: 'VALIDATES_THEORY' | 'INCONCLUSIVE' | 'REFUTES_THEORY';
        explanation: string;
    };
}

// Pairs: correct answer vs. plausible hallucination
const VALIDATION_QUESTIONS: ValidationQuestion[] = [
    {
        id: 'capital-france',
        question: 'What is the capital of France?',
        correctAnswer: 'The capital of France is Paris.',
        hallucinatedAnswer:
            'The capital of France is Marseille, the second-largest city.',
    },
    {
        id: 'shakespeare-authorship',
        question: 'Who wrote Romeo and Juliet?',
        correctAnswer: 'William Shakespeare wrote Romeo and Juliet in 1594.',
        hallucinatedAnswer:
            'Christopher Marlowe wrote Romeo and Juliet as a collaboration with Thomas Kyd.',
    },
    {
        id: 'titanic-year',
        question: 'In what year did the Titanic sink?',
        correctAnswer: 'The Titanic sank in 1912 after hitting an iceberg.',
        hallucinatedAnswer: 'The Titanic sank in 1905 during a collision with another ship.',
    },
    {
        id: 'moon-landing',
        question: 'Who was the first person to walk on the moon?',
        correctAnswer: 'Neil Armstrong was the first person to walk on the moon in 1969.',
        hallucinatedAnswer:
            'Buzz Aldrin was the first person to walk on the moon in 1969, followed by Neil Armstrong.',
    },
    {
        id: 'python-creator',
        question: 'Who created the Python programming language?',
        correctAnswer: 'Guido van Rossum created Python in 1989.',
        hallucinatedAnswer:
            'Tim Peters designed Python in 1995 as an alternative to Ruby.',
    },
    {
        id: 'great-wall-builder',
        question: 'Which Chinese dynasty built most of the Great Wall of China?',
        correctAnswer: 'The Ming Dynasty built most of the Great Wall of China that exists today.',
        hallucinatedAnswer:
            'The Qin Dynasty built the entire Great Wall as a single continuous structure.',
    },
    {
        id: 'oxygen-discoverer',
        question: 'Who discovered oxygen?',
        correctAnswer: 'Joseph Priestley is credited with the discovery of oxygen in 1774.',
        hallucinatedAnswer:
            'Antoine Lavoisier discovered oxygen in 1783 and named it the "air of life".',
    },
    {
        id: 'solar-system-planets',
        question: 'How many planets are in our solar system?',
        correctAnswer: 'There are 8 planets in our solar system after Pluto was reclassified.',
        hallucinatedAnswer:
            'There are 9 planets in our solar system including the recently discovered planet X.',
    },
];

function computeAnomalyScore(signal: InterceptionSignal): number {
    // Weighted score: higher = more anomalous
    let score = 0;

    // Basic signals
    score += signal.curvature * 0.2;
    score += (signal.entropySpike ? 1 : 0) * 0.15;
    score += signal.drift * 0.15;

    // Advanced signals (the ones being tested)
    score += signal.topologicalDrift * 0.25;
    score += (signal.loopDivergent ? 1 : 0) * 0.25;

    return Math.min(score, 1.0); // Normalize to [0, 1]
}

function getSignalNames(signal: InterceptionSignal): string[] {
    const signals: string[] = [];
    if (signal.curvature > 0.3) signals.push('curvature');
    if (signal.entropySpike) signals.push('entropy');
    if (signal.drift > 0.3) signals.push('drift');
    if (signal.topologicalDrift > 0.2) signals.push('topological');
    if (signal.loopDivergent) signals.push('loop-risk');
    return signals;
}

async function main() {
    console.log('🧪 VALIDATION BENCHMARK: Does theory improve practice?');
    console.log('📋 Testing if advanced analytics score hallucinations higher than correct answers\n');

    const results: ValidationResult[] = [];

    for (const q of VALIDATION_QUESTIONS) {
        process.stdout.write(`[${results.length + 1}/${VALIDATION_QUESTIONS.length}] ${q.question}... `);

        try {
            // Analyze correct answer
            const hiaCorrect = new HallucinationInterceptionAlgorithm(q.question, {
                alpha: 0.8,
                tau: 0.15,
                chunkSize: 50,
            });
            const signalCorrect = hiaCorrect.analyzeResponse(q.correctAnswer);
            const scoreCorrect = computeAnomalyScore(signalCorrect);
            const signalsCorrect = getSignalNames(signalCorrect);

            // Analyze hallucinated answer
            const hiaHalluc = new HallucinationInterceptionAlgorithm(q.question, {
                alpha: 0.8,
                tau: 0.15,
                chunkSize: 50,
            });
            const signalHalluc = hiaHalluc.analyzeResponse(q.hallucinatedAnswer);
            const scoreHalluc = computeAnomalyScore(signalHalluc);
            const signalsHalluc = getSignalNames(signalHalluc);

            // Check if correctly scored (hallucination > correct)
            const correctlyScored = scoreHalluc > scoreCorrect;

            results.push({
                questionId: q.id,
                question: q.question,
                correctAnswer: {
                    response: q.correctAnswer,
                    score: scoreCorrect,
                    signals: signalsCorrect,
                    signal: signalCorrect,
                },
                hallucinatedAnswer: {
                    response: q.hallucinatedAnswer,
                    score: scoreHalluc,
                    signals: signalsHalluc,
                    signal: signalHalluc,
                },
                correctlyScored,
            });

            const icon = correctlyScored ? '✅' : '❌';
            const margin = Math.abs(scoreHalluc - scoreCorrect).toFixed(3);
            console.log(`${icon} (halluc: ${scoreHalluc.toFixed(3)} vs correct: ${scoreCorrect.toFixed(3)}, margin: ${margin})`);
        } catch (error) {
            console.error(`\n❌ Error: ${error}`);
        }
    }

    // Calculate detection effectiveness by signal type
    let curvatureCorrect = 0,
        entropyCorrect = 0,
        driftCorrect = 0,
        topoCorrect = 0,
        loopCorrect = 0;

    for (const r of results) {
        const cCurv = r.hallucinatedAnswer.signal.curvature > r.correctAnswer.signal.curvature ? 1 : 0;
        const cEntr = (r.hallucinatedAnswer.signal.entropySpike ? 1 : 0) > (r.correctAnswer.signal.entropySpike ? 1 : 0) ? 1 : 0;
        const cDrift = r.hallucinatedAnswer.signal.drift > r.correctAnswer.signal.drift ? 1 : 0;
        const cTopo = r.hallucinatedAnswer.signal.topologicalDrift > r.correctAnswer.signal.topologicalDrift ? 1 : 0;
        const cLoop = (r.hallucinatedAnswer.signal.loopDivergent ? 1 : 0) > (r.correctAnswer.signal.loopDivergent ? 1 : 0) ? 1 : 0;

        curvatureCorrect += cCurv;
        entropyCorrect += cEntr;
        driftCorrect += cDrift;
        topoCorrect += cTopo;
        loopCorrect += cLoop;
    }

    const n = results.length;
    const overallDetectionRate = (results.filter((r) => r.correctlyScored).length / n) * 100;
    const advancedAlone = ((topoCorrect + loopCorrect) / (n * 2)) * 100;
    const basicAlone = ((curvatureCorrect + entropyCorrect + driftCorrect) / (n * 3)) * 100;

    // Determine verdict
    let verdict: 'VALIDATES_THEORY' | 'INCONCLUSIVE' | 'REFUTES_THEORY';
    let explanation = '';

    if (overallDetectionRate > 75) {
        verdict = 'VALIDATES_THEORY';
        explanation = `✅ 𝐕𝐀𝐋𝐈𝐃𝐀𝐓𝐄𝐃: ${overallDetectionRate.toFixed(1)}% detection rate. Topology + spectral analysis DO improve hallucination detection accuracy.`;
    } else if (overallDetectionRate > 50) {
        verdict = 'INCONCLUSIVE';
        explanation = `⚠️  𝐈𝐍𝐂𝐎𝐍𝐂𝐋𝐔𝐒𝐈𝐕𝐄: ${overallDetectionRate.toFixed(1)}% detection rate. Math helps somewhat, but tuning is needed.`;
    } else {
        verdict = 'REFUTES_THEORY';
        explanation = `❌ 𝐑𝐄𝐅𝐔𝐓𝐄𝐃: ${overallDetectionRate.toFixed(1)}% detection rate. Advanced analytics not effectively distinguishing correct from hallucinated answers. Need different approach.`;
    }

    const report: ValidationReport = {
        metadata: {
            generatedAt: new Date().toISOString(),
            totalQuestions: VALIDATION_QUESTIONS.length,
            totalTests: n,
        },
        results,
        summary: {
            correctDetectionRate: overallDetectionRate,
            signalEffectiveness: {
                curvatureCorrectness: (curvatureCorrect / n) * 100,
                entropyCorrectness: (entropyCorrect / n) * 100,
                driftCorrectness: (driftCorrect / n) * 100,
                topologicalCorrectness: (topoCorrect / n) * 100,
                loopRiskCorrectness: (loopCorrect / n) * 100,
            },
            advancedSignalsImprovement: {
                topoAlone: (topoCorrect / n) * 100,
                loopAlone: (loopCorrect / n) * 100,
                combined:
                    ((topoCorrect + loopCorrect) / (n * 2)) * 100,
            },
            verdict,
            explanation,
        },
    };

    // Output report
    const fs = await import('fs');
    const reportPath = 'evaluation/validation-report.json';
    fs.mkdirSync('evaluation', { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('\n' + '='.repeat(90));
    console.log('📊 VALIDATION RESULTS');
    console.log('='.repeat(90));
    console.log(report.summary.explanation);
    console.log('\n📈 SIGNAL EFFECTIVENESS (% correctness in distinguishing hallucinations):');
    console.log(`   Curvature:          ${report.summary.signalEffectiveness.curvatureCorrectness.toFixed(1)}%`);
    console.log(`   Entropy:            ${report.summary.signalEffectiveness.entropyCorrectness.toFixed(1)}%`);
    console.log(`   Drift:              ${report.summary.signalEffectiveness.driftCorrectness.toFixed(1)}%`);
    console.log(`   Topological Drift:  ${report.summary.signalEffectiveness.topologicalCorrectness.toFixed(1)}% (advanced)`);
    console.log(`   Loop Risk:          ${report.summary.signalEffectiveness.loopRiskCorrectness.toFixed(1)}% (advanced)`);
    console.log(`\n🎯 ADVANCED vs BASIC:`);
    console.log(`   Basic signals alone:        ${basicAlone.toFixed(1)}%`);
    console.log(`   Advanced signals alone:     ${advancedAlone.toFixed(1)}%`);
    console.log(`   Advanced added value:       ${(advancedAlone - basicAlone).toFixed(1)} percentage points`);
    console.log(`\n💾 Full report: ${reportPath}`);
    console.log('='.repeat(90));
}

main().catch(console.error);
