/**
 * Context analyzer.
 *
 * Maps prompt text to a tiny feature vector using local information-theory
 * signals only, with no external embedding API calls.
 */

export type ContextFeatures = [number, number, number];
export type ManifoldState = ContextFeatures;

const INTENT_ACTIONS = new Set([
    'write', 'build', 'create', 'generate', 'optimize', 'analyze', 'debug', 'fix', 'sort', 'fetch', 'query', 'summarize',
]);

const INTENT_DOMAINS = new Set([
    'array', 'list', 'json', 'api', 'url', 'database', 'sql', 'http', 'function', 'class', 'typescript', 'python',
]);

export class ContextAnalyzer {
    public static calculateEntropy(text: string): number {
        if (!text) return 0;
        const charCounts = new Map<string, number>();
        for (const char of text) {
            charCounts.set(char, (charCounts.get(char) || 0) + 1);
        }
        const len = text.length;
        let entropy = 0;
        for (const count of charCounts.values()) {
            const p = count / len;
            entropy -= p * Math.log2(p);
        }
        return entropy;
    }

    public static calculateDensity(text: string): number {
        if (!text) return 0;
        const words = text.toLowerCase().match(/\b\w+\b/g) || [];
        if (words.length === 0) return 0;
        const uniqueWords = new Set(words);
        return uniqueWords.size / words.length;
    }

    public static calculateAsymmetry(text: string): number {
        if (!text) return 0;
        const alphanumericMatch = text.match(/[a-zA-Z0-9]/g);
        const symbolMatch = text.match(/[^a-zA-Z0-9\s]/g);

        const alphanumericCount = alphanumericMatch ? alphanumericMatch.length : 0;
        const symbolCount = symbolMatch ? symbolMatch.length : 0;

        if (alphanumericCount === 0) return symbolCount;
        return symbolCount / alphanumericCount;
    }

    public static calculateIntentSignal(text: string): number {
        if (!text) return 0;

        const tokens = text.toLowerCase().match(/\b[a-z0-9_]+\b/g) || [];
        if (tokens.length === 0) return 0;

        let actions = 0;
        let domains = 0;
        for (const token of tokens) {
            if (INTENT_ACTIONS.has(token)) actions++;
            if (INTENT_DOMAINS.has(token)) domains++;
        }

        const actionRatio = actions / tokens.length;
        const domainRatio = domains / tokens.length;
        const coupling = Math.min(actions, domains) / Math.max(1, Math.max(actions, domains));

        return Math.min(1, (actionRatio * 0.4) + (domainRatio * 0.4) + (coupling * 0.2));
    }

    public static extract(text: string): ContextFeatures {
        const entropy = this.calculateEntropy(text);
        const density = this.calculateDensity(text);
        const asymmetry = this.calculateAsymmetry(text);
        const intent = this.calculateIntentSignal(text);
        return [entropy, density, asymmetry + (intent * 0.35)];
    }

    public static distance(a: ContextFeatures, b: ContextFeatures): number {
        return Math.sqrt(
            Math.pow(a[0] - b[0], 2) +
            Math.pow(a[1] - b[1], 2) +
            Math.pow(a[2] - b[2], 2),
        );
    }
}

export { ContextAnalyzer as ManifoldExtractor };
