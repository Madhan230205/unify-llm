import { BaseProvider } from '../providers/base';
import { CompletionRequest, CompletionResponse } from '../types';

export interface ComplexityThresholdConfig {
    innerShell: BaseProvider;
    outerShell: BaseProvider;
    zenithThreshold: number;
    debug?: boolean;
    logger?: (message: string) => void;
}

/**
 * Prompt-complexity threshold router.
 */
export class ComplexityThresholdEngine implements BaseProvider {
    public readonly name = 'complexity-threshold';
    private inner: BaseProvider;
    private outer: BaseProvider;
    private threshold: number;
    private debug: boolean;
    private logger?: (message: string) => void;

    constructor(config: ComplexityThresholdConfig) {
        this.inner = config.innerShell;
        this.outer = config.outerShell;
        this.threshold = config.zenithThreshold;
        this.debug = config.debug || false;
        this.logger = config.logger;
    }

    private emitDebug(message: string): void {
        if (this.debug && this.logger) {
            this.logger(message);
        }
    }

    public calculateComplexityScore(text: string): number {
        if (!text || text.length === 0) return 0.0;

        const charCounts: Record<string, number> = {};
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            charCounts[char] = (charCounts[char] || 0) + 1;
        }

        let entropy = 0;
        const totalChars = text.length;
        for (const char in charCounts) {
            const p = charCounts[char] / totalChars;
            entropy -= p * Math.log2(p);
        }

        let syntacticalWeight = 0;
        const syntaxMap: Record<string, number> = {
            '{': 2.5, '}': 2.5,
            '[': 2.5, ']': 2.5,
            '=': 1.5, '+': 1.5, '-': 1.5, '*': 1.5, '/': 1.5,
            '<': 2.0, '>': 2.0,
            '`': 3.0,
            '\\': 2.0,
            '_': 1.0,
            '(': 1.5, ')': 1.5,
        };

        const codeKeywords = ['function', 'const', 'let', 'import', 'class', 'interface', 'return', 'async', 'await'];

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (syntaxMap[char]) {
                syntacticalWeight += syntaxMap[char];
            }
        }

        let keywordHits = 0;
        const lowerText = text.toLowerCase();
        for (const kw of codeKeywords) {
            const regex = new RegExp(`\\b${kw}\\b`, 'g');
            const matches = lowerText.match(regex);
            if (matches) keywordHits += matches.length;
        }

        const normalizedSyntaxDepth = 1.0 + (syntacticalWeight * 1.5) + (keywordHits * 5.0);
        return entropy * normalizedSyntaxDepth;
    }

    public calculateAstralValue(text: string): number {
        return this.calculateComplexityScore(text);
    }

    private extractFullPrompt(request: CompletionRequest): string {
        return request.messages.map(m => {
            if (Array.isArray(m.content)) {
                return m.content.map(c => {
                    if (typeof c === 'string') return c;
                    if (typeof c === 'object' && c !== null && 'text' in c) {
                        return String((c as Record<string, unknown>).text || '');
                    }
                    return '';
                }).join('\n');
            }
            return typeof m.content === 'string' ? m.content : String(m.content || '');
        }).join('\n');
    }

    private selectModel(score: number): BaseProvider {
        if (score >= this.threshold) {
            this.emitDebug(`[Complexity Threshold] score=${score.toFixed(2)} (>= ${this.threshold}) -> outer (${this.outer.name})`);
            return this.outer;
        }
        this.emitDebug(`[Complexity Threshold] score=${score.toFixed(2)} (< ${this.threshold}) -> inner (${this.inner.name})`);
        return this.inner;
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        const fullPrompt = this.extractFullPrompt(request);
        const score = this.calculateComplexityScore(fullPrompt);
        const selectedProvider = this.selectModel(score);
        return selectedProvider.generateCompletion(request);
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        const fullPrompt = this.extractFullPrompt(request);
        const score = this.calculateComplexityScore(fullPrompt);
        const selectedProvider = this.selectModel(score);
        return yield* selectedProvider.streamCompletion(request);
    }
}

