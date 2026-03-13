import { describe, expect, it } from 'vitest';
import { evaluateTruthfulnessDataset } from '../src/evaluation/truthfulness';

describe('truthfulness evaluation helper', () => {
    it('should report lower hallucination rate for intercepted answers when improved', () => {
        const summary = evaluateTruthfulnessDataset([
            {
                id: '1',
                question: 'Capital of Australia?',
                acceptedAssertions: ['canberra'],
                baselineAnswer: 'Sydney is the capital of Australia.',
                interceptedAnswer: 'Canberra is the capital of Australia.',
            },
            {
                id: '2',
                question: 'Largest ocean?',
                acceptedAssertions: ['pacific'],
                baselineAnswer: 'The Atlantic Ocean is the largest.',
                interceptedAnswer: 'The Pacific Ocean is the largest ocean.',
            },
        ]);

        expect(summary.sampleCount).toBe(2);
        expect(summary.baselineHallucinationRatePct).toBeGreaterThan(summary.interceptedHallucinationRatePct);
        expect(summary.absoluteReductionPct).toBeGreaterThan(0);
    });
});
