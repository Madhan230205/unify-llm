import { describe, expect, it } from 'vitest';
import {
    detectClaimBoundaryEvents,
    runMicroVerifier,
    splitCompleteSentenceUnits,
} from '../src/algorithms/microVerifier';

describe('microVerifier utilities', () => {
    it('should split completed sentences and keep tail remainder', () => {
        const input = 'The capital of France is Paris. The capital of Australia is';
        const out = splitCompleteSentenceUnits(input);

        expect(out.completed.length).toBe(1);
        expect(out.completed[0]).toContain('France is Paris');
        expect(out.remainder).toContain('Australia is');
    });

    it('should split multilingual sentence endings that use full-width punctuation', () => {
        const input = '巴黎是法国的首都。东京是日本的首都';
        const out = splitCompleteSentenceUnits(input);

        expect(out.completed).toEqual(['巴黎是法国的首都。']);
        expect(out.remainder).toBe('东京是日本的首都');
    });

    it('should detect claim-bearing boundary events', () => {
        const events = detectClaimBoundaryEvents('The capital of Australia is Marseille.');
        const types = new Set(events.map(evt => evt.type));

        expect(types.has('sentence')).toBe(true);
        expect(types.has('location-fact')).toBe(true);
        expect(types.has('entity-predicate')).toBe(true);
    });

    it('should detect multilingual claim-bearing boundary events', () => {
        const frenchEvents = detectClaimBoundaryEvents('Paris est la capitale de la France.');
        const chineseEvents = detectClaimBoundaryEvents('巴黎是法国的首都。');

        const frenchTypes = new Set(frenchEvents.map(evt => evt.type));
        const chineseTypes = new Set(chineseEvents.map(evt => evt.type));

        expect(frenchTypes.has('sentence')).toBe(true);
        expect(frenchTypes.has('location-fact')).toBe(true);
        expect(frenchTypes.has('entity-predicate')).toBe(true);

        expect(chineseTypes.has('sentence')).toBe(true);
        expect(chineseTypes.has('location-fact')).toBe(true);
        expect(chineseTypes.has('entity-predicate')).toBe(true);
    });

    it('should detect multilingual date references', () => {
        const frenchEvents = detectClaimBoundaryEvents('La conférence a lieu aujourd’hui.');
        const japaneseEvents = detectClaimBoundaryEvents('会議は明日です。');

        expect(new Set(frenchEvents.map(evt => evt.type)).has('date-reference')).toBe(true);
        expect(new Set(japaneseEvents.map(evt => evt.type)).has('date-reference')).toBe(true);
    });

    it('should assign higher hallucination confidence for divergent claim', async () => {
        const likely = await runMicroVerifier({
            promptText: 'Answer only with known geography facts.',
            claimText: 'The capital of Australia is Marseille.',
            anomalyScore: 0.7,
        });

        const stable = await runMicroVerifier({
            promptText: 'Answer only with known geography facts.',
            claimText: 'The capital of Australia is Canberra.',
            anomalyScore: 0.1,
        });

        expect(likely.hallucinationConfidence).toBeGreaterThanOrEqual(0);
        expect(stable.hallucinationConfidence).toBeGreaterThanOrEqual(0);
        expect(likely.hallucinationConfidence).toBeGreaterThan(stable.hallucinationConfidence);
    });
});
