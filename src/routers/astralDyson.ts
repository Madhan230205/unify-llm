import { BaseProvider } from '../providers/base';
import { CompletionRequest, CompletionResponse } from '../types';

export interface AstralDysonConfig {
    innerShell: BaseProvider;
    outerShell: BaseProvider;
    zenithThreshold: number; // The τ bounds for routing (e.g. 45.0)
    debug?: boolean; // Control whether ADA logs routing decisions
}

/**
 * The Astral Dyson Router (Humanity Peak)
 * 
 * An O(N) zero-latency mathematical cost-arbitration engine.
 * Computes Lexical Shannon Entropy and Syntactical Depth Force to route
 * prompts to cheap/fast models vs expensive/heavy models without an external ML hop.
 */
export class AstralDysonRouter implements BaseProvider {
    public readonly name = 'astral-dyson';
    private inner: BaseProvider;
    private outer: BaseProvider;
    private threshold: number;
    private debug: boolean;

    constructor(config: AstralDysonConfig) {
        this.inner = config.innerShell;
        this.outer = config.outerShell;
        this.threshold = config.zenithThreshold;
        this.debug = config.debug || false;
    }

    /**
     * Astral Dyson Arbitration (ADA) Matrix
     * Calculates the Astral Singularity Value (Ψ) for the given prompt context.
     * Ψ = H * F_Δ
     * (Shannon Entropy * Syntactical Depth Force)
     */
    public calculateAstralValue(text: string): number {
        if (!text || text.length === 0) return 0.0;

        // 1. Calculate Lexical Shannon Entropy (H)
        const charCounts: Record<string, number> = {};
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            charCounts[char] = (charCounts[char] || 0) + 1;
        }

        let entropyH = 0;
        const totalChars = text.length;
        for (const char in charCounts) {
            const p_i = charCounts[char] / totalChars;
            entropyH -= p_i * Math.log2(p_i);
        }

        // 2. Calculate Syntactical Depth Force (F_Δ)
        let syntacticalWeight = 0;
        const syntaxMap: Record<string, number> = {
            '{': 2.5, '}': 2.5,
            '[': 2.5, ']': 2.5,
            '=': 1.5, '+': 1.5, '-': 1.5, '*': 1.5, '/': 1.5,
            '<': 2.0, '>': 2.0,
            '`': 3.0, // Backticks heavily imply code formatting
            '\\': 2.0,
            '_': 1.0,
            '(': 1.5, ')': 1.5
        };

        // Keyword checking (O(N) window sliding approximate)
        const codeKeywords = ['function', 'const', 'let', 'import', 'class', 'interface', 'return', 'async', 'await'];

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (syntaxMap[char]) {
                syntacticalWeight += syntaxMap[char];
            }
        }

        // Add weight for explicit coding keywords
        let keywordHits = 0;
        const lowerText = text.toLowerCase();
        for (const kw of codeKeywords) {
            // Strict match boundary mapping
            const regex = new RegExp(`\\b${kw}\\b`, 'g');
            const matches = lowerText.match(regex);
            if (matches) {
                keywordHits += matches.length;
            }
        }

        // F_Δ = 1.0 + (Raw Syntax * 2.0) + (Keywords * 5.0)
        // We avoid logging it down heavily so complexity can properly spike for actual code.
        const normalizedSyntaxDepth = 1.0 + (syntacticalWeight * 1.5) + (keywordHits * 5.0);

        // 3. The Singularity Value
        const psi = entropyH * normalizedSyntaxDepth;
        return psi;
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

    private selectModel(psi: number): BaseProvider {
        // If the complexity pushes past the zenith threshold, route to the Outer Shell (Heavy/Smart)
        if (psi >= this.threshold) {
            if (this.debug) console.log(`[Astral Dyson] Ψ=${psi.toFixed(2)} (>= ${this.threshold}) -> Routing to Outer Shell (${this.outer.name})`);
            return this.outer;
        }
        // Otherwise, standard logic routes to Inner Shell (Cheap/Fast)
        if (this.debug) console.log(`[Astral Dyson] Ψ=${psi.toFixed(2)} (< ${this.threshold}) -> Routing to Inner Shell (${this.inner.name})`);
        return this.inner;
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        const fullPrompt = this.extractFullPrompt(request);
        const psi = this.calculateAstralValue(fullPrompt);
        const selectedProvider = this.selectModel(psi);
        return selectedProvider.generateCompletion(request);
    }

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        const fullPrompt = this.extractFullPrompt(request);
        const psi = this.calculateAstralValue(fullPrompt);
        const selectedProvider = this.selectModel(psi);
        return yield* selectedProvider.streamCompletion(request);
    }
}
