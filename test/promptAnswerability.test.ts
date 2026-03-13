import { describe, expect, it } from 'vitest';
import { classifyPromptAnswerability, hasEpistemicDisclosure } from '../src/algorithms/promptAnswerability';

describe('Prompt Answerability Classifier', () => {
    it('should classify straightforward factual prompts as answerable', () => {
        const result = classifyPromptAnswerability('Who discovered oxygen?');
        expect(result.type).toBe('answerable');
        expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should classify private/secret prompts as unanswerable', () => {
        const result = classifyPromptAnswerability('What is the exact password of the Pentagon Wi-Fi?');
        expect(result.type).toBe('unanswerable');
        expect(result.scores.unanswerable).toBeGreaterThan(result.scores.answerable);
    });

    it('should classify future prediction prompts as speculative', () => {
        const result = classifyPromptAnswerability('Who will win the election in 2032?');
        expect(result.type).toBe('speculative');
        expect(result.scores.speculative).toBeGreaterThan(0.1);
    });

    it('should detect epistemic disclosure language', () => {
        expect(hasEpistemicDisclosure('I cannot know this with certainty and there is no reliable data.')).toBe(true);
        expect(hasEpistemicDisclosure('Joseph Priestley discovered oxygen in 1774.')).toBe(false);
    });
});
