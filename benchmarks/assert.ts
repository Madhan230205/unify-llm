import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface BenchmarkReport {
    benchmarks: {
        guardianAccuracy: {
            accuracyPct: number;
        };
        guardianAbortLatency: {
            p95AbortLatencyMs: number;
        };
        paretoCostSavings: {
            costSavedPct: number;
        };
    };
}

interface Thresholds {
    minGuardianAccuracyPct: number;
    maxGuardianP95AbortLatencyMs: number;
    minParetoCostSavedPct: number;
}

function parseThresholds(argv: string[]): { reportPath: string; thresholds: Thresholds } {
    const thresholds: Thresholds = {
        minGuardianAccuracyPct: 95,
        maxGuardianP95AbortLatencyMs: 50,
        minParetoCostSavedPct: 20,
    };

    let reportPath = 'benchmarks/latest.json';

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (!arg.startsWith('--') && reportPath === 'benchmarks/latest.json') {
            reportPath = arg;
            continue;
        }

        if (arg === '--min-guardian-accuracy' && next) {
            thresholds.minGuardianAccuracyPct = Number(next);
            i++;
        } else if (arg === '--max-guardian-p95-latency' && next) {
            thresholds.maxGuardianP95AbortLatencyMs = Number(next);
            i++;
        } else if (arg === '--min-pareto-cost-saved' && next) {
            thresholds.minParetoCostSavedPct = Number(next);
            i++;
        }
    }

    return { reportPath, thresholds };
}

function main(): void {
    const { reportPath, thresholds } = parseThresholds(process.argv.slice(2));
    const resolvedPath = resolve(reportPath);
    const report = JSON.parse(readFileSync(resolvedPath, 'utf8')) as BenchmarkReport;
    const failures: string[] = [];

    if (report.benchmarks.guardianAccuracy.accuracyPct < thresholds.minGuardianAccuracyPct) {
        failures.push(
            `Guardian accuracy ${report.benchmarks.guardianAccuracy.accuracyPct}% is below the floor ${thresholds.minGuardianAccuracyPct}%`
        );
    }

    if (report.benchmarks.guardianAbortLatency.p95AbortLatencyMs > thresholds.maxGuardianP95AbortLatencyMs) {
        failures.push(
            `Guardian p95 abort latency ${report.benchmarks.guardianAbortLatency.p95AbortLatencyMs}ms exceeds the ceiling ${thresholds.maxGuardianP95AbortLatencyMs}ms`
        );
    }

    if (report.benchmarks.paretoCostSavings.costSavedPct < thresholds.minParetoCostSavedPct) {
        failures.push(
            `Pareto cost savings ${report.benchmarks.paretoCostSavings.costSavedPct}% is below the floor ${thresholds.minParetoCostSavedPct}%`
        );
    }

    if (failures.length > 0) {
        console.error('Benchmark threshold check failed:');
        for (const failure of failures) {
            console.error(`- ${failure}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('Benchmark thresholds satisfied.');
}

main();