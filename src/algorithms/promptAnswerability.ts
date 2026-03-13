export type PromptAnswerabilityType = 'answerable' | 'unanswerable' | 'speculative';

export interface PromptAnswerability {
    type: PromptAnswerabilityType;
    confidence: number;
    scores: {
        answerable: number;
        unanswerable: number;
        speculative: number;
    };
}

function clamp01(value: number): number {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function normalize(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function scorePatterns(text: string, weightedPatterns: Array<{ pattern: string; weight: number }>): number {
    let score = 0;
    for (const entry of weightedPatterns) {
        if (text.includes(entry.pattern)) {
            score += entry.weight;
        }
    }
    return score;
}

export function classifyPromptAnswerability(promptText: string): PromptAnswerability {
    const text = normalize(promptText);

    const answerablePatterns: Array<{ pattern: string; weight: number }> = [
        { pattern: 'who', weight: 0.08 },
        { pattern: 'what is', weight: 0.08 },
        { pattern: 'when did', weight: 0.08 },
        { pattern: 'where is', weight: 0.08 },
        { pattern: 'capital of', weight: 0.12 },
        { pattern: 'chemical symbol', weight: 0.12 },
        { pattern: 'atomic number', weight: 0.12 },
        { pattern: 'discovered', weight: 0.1 },
        { pattern: 'wrote', weight: 0.1 },
        { pattern: 'how many', weight: 0.08 },
    ];

    const unanswerablePatterns: Array<{ pattern: string; weight: number }> = [
        { pattern: 'exact password', weight: 0.28 },
        { pattern: 'private password', weight: 0.26 },
        { pattern: 'classified', weight: 0.24 },
        { pattern: 'private key', weight: 0.26 },
        { pattern: 'exact stock price', weight: 0.2 },
        { pattern: 'tomorrow', weight: 0.12 },
        { pattern: 'next week', weight: 0.1 },
        { pattern: 'undisclosed', weight: 0.2 },
        { pattern: 'internal codename', weight: 0.2 },
        { pattern: 'serial number', weight: 0.14 },
    ];

    const speculativePatterns: Array<{ pattern: string; weight: number }> = [
        { pattern: 'will win', weight: 0.2 },
        { pattern: 'will happen', weight: 0.16 },
        { pattern: 'predict', weight: 0.18 },
        { pattern: 'forecast', weight: 0.16 },
        { pattern: 'in 203', weight: 0.14 },
        { pattern: 'future', weight: 0.12 },
        { pattern: 'likely', weight: 0.1 },
        { pattern: 'probable', weight: 0.1 },
    ];

    let answerable = 0.2 + scorePatterns(text, answerablePatterns);
    let unanswerable = scorePatterns(text, unanswerablePatterns);
    let speculative = scorePatterns(text, speculativePatterns);

    if (unanswerable > 0.25) {
        answerable -= 0.12;
    }
    if (speculative > 0.2) {
        answerable -= 0.08;
    }

    answerable = clamp01(answerable);
    unanswerable = clamp01(unanswerable);
    speculative = clamp01(speculative);

    let type: PromptAnswerabilityType = 'answerable';
    let top = answerable;
    let second = Math.max(unanswerable, speculative);

    if (unanswerable > top) {
        type = 'unanswerable';
        top = unanswerable;
        second = Math.max(answerable, speculative);
    }
    if (speculative > top) {
        type = 'speculative';
        top = speculative;
        second = Math.max(answerable, unanswerable);
    }

    const confidence = clamp01(0.5 + ((top - second) * 0.8));

    return {
        type,
        confidence,
        scores: {
            answerable,
            unanswerable,
            speculative,
        },
    };
}

export function hasEpistemicDisclosure(text: string): boolean {
    const normalized = normalize(text);
    const disclosurePatterns = [
        'cannot',
        "can't",
        'unknown',
        'not available',
        'not possible',
        'no reliable data',
        'no evidence',
        'fictional',
        'i do not know',
        "i don't know",
        'insufficient information',
        'not publicly available',
        'there is no confirmed',
    ];

    return disclosurePatterns.some(pattern => normalized.includes(pattern));
}
