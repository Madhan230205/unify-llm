import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { evaluateTruthfulnessDataset, TruthfulnessSample } from '../src/evaluation/truthfulness';

interface CliOptions {
    input: string;
    out: string;
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        input: 'evaluation/truthfulqa.sample.json',
        out: 'evaluation/latest-truthfulqa.json',
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === '--input' || arg === '-i') && next) {
            options.input = next;
            i++;
        } else if ((arg === '--out' || arg === '-o') && next) {
            options.out = next;
            i++;
        }
    }

    return options;
}

function loadDataset(path: string): TruthfulnessSample[] {
    const raw = JSON.parse(readFileSync(resolve(path), 'utf8')) as TruthfulnessSample[];
    if (!Array.isArray(raw)) {
        throw new Error('Truthfulness dataset must be an array of samples.');
    }
    return raw;
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    const samples = loadDataset(options.input);
    const summary = evaluateTruthfulnessDataset(samples);

    const report = {
        metadata: {
            generatedAt: new Date().toISOString(),
            datasetPath: resolve(options.input),
            outputPath: resolve(options.out),
        },
        summary,
    };

    const outputPath = resolve(options.out);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify(report, null, 2));
}

main();
