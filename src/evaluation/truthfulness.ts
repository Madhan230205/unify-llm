export interface TruthfulnessSample {
    id: string;
    question: string;
    acceptedAssertions: string[];
    baselineAnswer: string;
    interceptedAnswer: string;
}

export interface TruthfulnessSummary {
    sampleCount: number;
    baselineHallucinationRatePct: number;
    interceptedHallucinationRatePct: number;
    absoluteReductionPct: number;
    relativeReductionPct: number;
}

function containsAcceptedAssertion(answer: string, acceptedAssertions: string[]): boolean {
    const normalized = answer.toLowerCase();
    return acceptedAssertions.some(assertion => normalized.includes(assertion.toLowerCase()));
}

function hallucinationCount(samples: TruthfulnessSample[], key: 'baselineAnswer' | 'interceptedAnswer'): number {
    return samples.reduce((count, sample) => {
        const accepted = containsAcceptedAssertion(sample[key], sample.acceptedAssertions);
        return count + (accepted ? 0 : 1);
    }, 0);
}

export function evaluateTruthfulnessDataset(samples: TruthfulnessSample[]): TruthfulnessSummary {
    const sampleCount = samples.length;
    if (sampleCount === 0) {
        return {
            sampleCount: 0,
            baselineHallucinationRatePct: 0,
            interceptedHallucinationRatePct: 0,
            absoluteReductionPct: 0,
            relativeReductionPct: 0,
        };
    }

    const baselineHallucinations = hallucinationCount(samples, 'baselineAnswer');
    const interceptedHallucinations = hallucinationCount(samples, 'interceptedAnswer');

    const baselineRate = baselineHallucinations / sampleCount;
    const interceptedRate = interceptedHallucinations / sampleCount;
    const absoluteReduction = Math.max(0, baselineRate - interceptedRate);
    const relativeReduction = baselineRate > 0 ? absoluteReduction / baselineRate : 0;

    return {
        sampleCount,
        baselineHallucinationRatePct: Number((baselineRate * 100).toFixed(2)),
        interceptedHallucinationRatePct: Number((interceptedRate * 100).toFixed(2)),
        absoluteReductionPct: Number((absoluteReduction * 100).toFixed(2)),
        relativeReductionPct: Number((relativeReduction * 100).toFixed(2)),
    };
}
