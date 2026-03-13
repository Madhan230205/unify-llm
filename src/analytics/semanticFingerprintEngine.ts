/**
 * Semantic Fingerprint Engine
 * 
 * Hyperdimensional computing arrays that map natural language semantics
 * into deterministic, bounded continuous scalar features in O(N).
 */

const DIMENSIONS = 10000;
const TRIGRAM_VECTOR_CACHE_LIMIT = 4096;
const TOKEN_RESONANCE_CACHE_LIMIT = 2048;

const CJK_OR_HANGUL_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function stripDiacritics(text: string): string {
    return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

const TRIGRAM_VECTOR_CACHE = new Map<string, Int8Array>();
const TOKEN_RESONANCE_CACHE = new Map<string, Int16Array>();

const hologramCacheMetrics = {
    trigramHits: 0,
    trigramMisses: 0,
    tokenHits: 0,
    tokenMisses: 0,
};

function setLruValue<T>(cache: Map<string, T>, key: string, value: T, limit: number): void {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    if (cache.size > limit) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
    }
}

export function resetHologramCaches(): void {
    TRIGRAM_VECTOR_CACHE.clear();
    TOKEN_RESONANCE_CACHE.clear();
    hologramCacheMetrics.trigramHits = 0;
    hologramCacheMetrics.trigramMisses = 0;
    hologramCacheMetrics.tokenHits = 0;
    hologramCacheMetrics.tokenMisses = 0;
}

export function getHologramCacheMetrics(): {
    trigramHits: number;
    trigramMisses: number;
    tokenHits: number;
    tokenMisses: number;
    trigramCacheSize: number;
    tokenCacheSize: number;
} {
    return {
        ...hologramCacheMetrics,
        trigramCacheSize: TRIGRAM_VECTOR_CACHE.size,
        tokenCacheSize: TOKEN_RESONANCE_CACHE.size,
    };
}

function normalizeSemanticText(text: string): string {
    return stripDiacritics(
        text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
    );
}

function tokenizeSemanticText(text: string): string[] {
    const normalized = normalizeSemanticText(text);
    if (!normalized) return [];

    const splitTokens = normalized.split(' ').filter(token => token.length > 0);
    if (splitTokens.length > 1) return splitTokens;

    if (!CJK_OR_HANGUL_REGEX.test(normalized)) return splitTokens;

    const chars = Array.from(normalized).filter(char => !/\s/.test(char));
    if (chars.length <= 1) return chars;

    const bigrams: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) {
        bigrams.push(chars[i] + chars[i + 1]);
    }
    return bigrams;
}

// Pseudo-random deterministic bipolar generator (maps a seed to a -1 or 1 uniformly)
function mulberry32(a: number) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

/**
 * Maps any string token into a permanent deterministic 10,000-dimensional bipolar vector.
 */
function getTrigramVector(trigram: string): Int8Array {
    const cached = TRIGRAM_VECTOR_CACHE.get(trigram);
    if (cached) {
        hologramCacheMetrics.trigramHits++;
        return cached;
    }

    hologramCacheMetrics.trigramMisses++;
    let hash = 0;
    for (let i = 0; i < trigram.length; i++) {
        hash = ((hash << 5) - hash) + trigram.charCodeAt(i);
        hash |= 0;
    }

    const random = mulberry32(hash);
    const vec = new Int8Array(DIMENSIONS);
    for (let i = 0; i < DIMENSIONS; i++) {
        vec[i] = random() > 0.5 ? 1 : -1;
    }
    setLruValue(TRIGRAM_VECTOR_CACHE, trigram, vec, TRIGRAM_VECTOR_CACHE_LIMIT);
    return vec;
}

function getTokenResonanceVector(token: string): Int16Array {
    const cached = TOKEN_RESONANCE_CACHE.get(token);
    if (cached) {
        hologramCacheMetrics.tokenHits++;
        return cached;
    }

    hologramCacheMetrics.tokenMisses++;
    const resonance = new Int16Array(DIMENSIONS);

    if (token.length < 3) {
        const vec = getTrigramVector(token.padEnd(3, '_'));
        for (let d = 0; d < DIMENSIONS; d++) {
            resonance[d] += vec[d];
        }
    } else {
        for (let i = 0; i < token.length - 2; i++) {
            const trigram = token.slice(i, i + 3);
            const vec = getTrigramVector(trigram);
            for (let d = 0; d < DIMENSIONS; d++) {
                resonance[d] += vec[d];
            }
        }
    }

    setLruValue(TOKEN_RESONANCE_CACHE, token, resonance, TOKEN_RESONANCE_CACHE_LIMIT);
    return resonance;
}

const NEGATION_OPS = new Set([
    'not', 'never', 'no', 'cannot', 'none', 'false', 'without',
    'pas', 'jamais', 'aucun', 'non',
    'nunca', 'ningun', 'ninguno',
    'nicht', 'kein', 'keine',
    'nao', 'não', 'sem',
    'не', 'нет',
    '没有', '沒有', '不是', '不', '没',
    'ない', '無',
    '아니', '없', '않',
]);

const NEGATION_SUBSTRINGS = [
    '没有', '沒有', '不是', 'ない', '無', '없', '않', '不', '没',
];

const MULTILINGUAL_CONCEPTS: Record<string, string[]> = {
    weather: ['weather', 'meteo', 'météo', 'temps', 'clima', 'wetter', 'tempo', '天気', '天气', '날씨'],
    code: ['code', 'codigo', 'código', 'programmation', 'programmierung', 'programacao', 'programação', '代码', 'コード'],
    sort: ['sort', 'ordenar', 'trier', 'sortieren', 'ordenacao', 'ordenação', '排序', '並べ替え'],
    fetch: ['fetch', 'get', 'request', 'obtener', 'obtenir', 'holen', 'buscar', 'récupérer', '获取', '取得'],
    url: ['url', 'uri', 'lien', 'enlace', '链接', 'リンク'],
    database: ['database', 'base', 'datos', 'donnes', 'données', 'datenbank', 'banco', '数据库', 'データベース'],
};

const CONCEPT_ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(MULTILINGUAL_CONCEPTS)) {
    CONCEPT_ALIAS_TO_CANONICAL.set(canonical, canonical);
    for (const alias of aliases) {
        CONCEPT_ALIAS_TO_CANONICAL.set(stripDiacritics(alias.toLowerCase()), canonical);
    }
}

function collectCanonicalConceptTokens(normalizedText: string, tokens: string[]): string[] {
    const concepts = new Set<string>();

    for (const token of tokens) {
        const mapped = CONCEPT_ALIAS_TO_CANONICAL.get(stripDiacritics(token));
        if (mapped) concepts.add(mapped);
    }

    for (const [alias, canonical] of CONCEPT_ALIAS_TO_CANONICAL.entries()) {
        if (alias.length >= 2 && normalizedText.includes(alias)) {
            concepts.add(canonical);
        }
    }

    return Array.from(concepts);
}

/**
 * Constructs a single fingerprint vector representing the entire semantic mass of the text.
 * Integrates Permutation-Based Logical Negation (PLN) by rotating negated word vectors.
 */
export function generateHologram(text: string): Int8Array {
    const normalizedText = normalizeSemanticText(text);
    const tokens = tokenizeSemanticText(normalizedText);
    const canonicalConceptTokens = collectCanonicalConceptTokens(normalizedText, tokens);
    const bundle = new Int32Array(DIMENSIONS);

    let hasNegation = NEGATION_SUBSTRINGS.some(fragment => normalizedText.includes(fragment));

    // Process token by token to support syntactical state machines
    for (const token of [...tokens, ...canonicalConceptTokens]) {
        if (NEGATION_OPS.has(token)) {
            hasNegation = true;
            continue; // The operator itself is not hashed, it transforms the space globally.
        }
        const wordBundle = getTokenResonanceVector(token);
        for (let d = 0; d < DIMENSIONS; d++) {
            bundle[d] += wordBundle[d];
        }
    }

    // Threshold back into bipolar structure (Majority Rule)
    const hologram = new Int8Array(DIMENSIONS);
    const shift = hasNegation ? Math.floor(DIMENSIONS / 2) : 0;
    
    for (let d = 0; d < DIMENSIONS; d++) {
        const thresholdedValue = bundle[d] >= 0 ? 1 : -1;
        // Apply Topological Rotation (cyclic shift D/2) to the ENTIRE manifold if logically negated
        hologram[(d + shift) % DIMENSIONS] = thresholdedValue;
    }
    
    return hologram;
}

/**
 * Calculates normalized Hamming distance between two 10k-D vectors.
 * Returns exactly 0 for identical concepts, ~0.5 for orthogonal independent concepts.
 */
export function getHammingDistance(v1: Int8Array, v2: Int8Array): number {
    let diff = 0;
    for (let i = 0; i < DIMENSIONS; i++) {
        if (v1[i] !== v2[i]) diff++;
    }
    return diff / DIMENSIONS;
}

// ----------------------------------------------------
// Epistemic Anchor Projection
// ----------------------------------------------------

const ANCHOR_CODE = generateHologram("python function javascript recursive map loop string algorithm class type matrix inverse typescript node react typescript backend database frontend boolean number promise");
const ANCHOR_CHAT = generateHologram("hello how are you feeling today write poem tell story sad happy angry marketing copy email letter conversational funny creative fiction character plot");
const ANCHOR_JSON = generateHologram("extract schema structure fields json true false specific exact map array format required output payload attributes metadata keys structure parse");

export interface SemanticModalityProfile {
    code: number;
    prose: number;
    structured: number;
}

export interface SemanticStabilityEnvelope {
    projection: [number, number, number];
    localConditionNumber: number;
    localLipschitz: number;
    semanticJitter: number;
    anchorMargin: number;
    perturbationCount: number;
}

const STABILITY_CACHE = new Map<string, SemanticStabilityEnvelope>();
const STABILITY_CACHE_LIMIT = 256;

function normalizeText(text: string): string {
    return normalizeSemanticText(text);
}

function tokenizeText(text: string): string[] {
    return tokenizeSemanticText(text);
}

function computeTokenJaccard(a: string[], b: string[]): number {
    const isSignificant = (token: string): boolean => {
        if (CJK_OR_HANGUL_REGEX.test(token)) return token.length >= 1;
        return token.length >= 3;
    };

    const left = new Set(a.filter(isSignificant));
    const right = new Set(b.filter(isSignificant));
    if (left.size === 0 && right.size === 0) return 0;

    let intersection = 0;
    for (const token of left) {
        if (right.has(token)) intersection++;
    }

    const union = new Set([...left, ...right]).size;
    return 1 - (intersection / Math.max(1, union));
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

export function analyzeSemanticModality(text: string): SemanticModalityProfile {
    const normalized = normalizeText(text);
    if (!normalized) {
        return { code: 0, prose: 1, structured: 0 };
    }

    const codeTokenHits = (normalized.match(/\b(function|const|let|return|class|import|export|json|schema|array|object|async|await|sql|select)\b/g) || []).length;
    const proseTokenHits = (normalized.match(/\b(the|and|because|should|would|could|story|explain|travel|weather|customer|system)\b/g) || []).length;
    const structuredHits = (normalized.match(/[{}\[\]:",]/g) || []).length;
    const symbolHits = (text.match(/[{}()[\];:=><+\-/*]/g) || []).length;
    const tokenCount = Math.max(1, tokenizeText(normalized).length);
    const length = Math.max(1, text.length);

    const code = clamp01(((codeTokenHits / tokenCount) * 0.55) + ((symbolHits / length) * 8));
    const structured = clamp01(((structuredHits / length) * 10) + ((normalized.includes('json') || normalized.includes('schema')) ? 0.25 : 0));
    const prose = clamp01(1 - Math.min(1, (code * 0.55) + (structured * 0.35)) + ((proseTokenHits / tokenCount) * 0.2));

    return { code, prose, structured };
}

export function getSemanticModalityDistance(a: string, b: string): number {
    const left = analyzeSemanticModality(a);
    const right = analyzeSemanticModality(b);
    const dx = left.code - right.code;
    const dy = left.prose - right.prose;
    const dz = left.structured - right.structured;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.sqrt(3);
}

export function computeRobustSemanticDistance(a: string, b: string): number {
    const normalizedA = normalizeText(a);
    const normalizedB = normalizeText(b);
    if (normalizedA === normalizedB) return 0;

    const hologramDistance = getHammingDistance(generateHologram(normalizedA || ' '), generateHologram(normalizedB || ' '));
    const projectionA = projectEpistemic(normalizedA);
    const projectionB = projectEpistemic(normalizedB);
    const projectionDistance = euclidean3(projectionA, projectionB) / Math.sqrt(12);
    const lexicalDistance = computeTokenJaccard(tokenizeText(normalizedA), tokenizeText(normalizedB));
    const modalityDistance = getSemanticModalityDistance(normalizedA, normalizedB);

    return clamp01((hologramDistance * 0.35) + (projectionDistance * 0.25) + (lexicalDistance * 0.25) + (modalityDistance * 0.15));
}

function projectFromHologram(targetHologram: Int8Array): [number, number, number] {
    const dCode = getHammingDistance(targetHologram, ANCHOR_CODE);
    const dChat = getHammingDistance(targetHologram, ANCHOR_CHAT);
    const dJson = getHammingDistance(targetHologram, ANCHOR_JSON);
    return [dCode * 2, dChat * 2, dJson * 2];
}

function euclidean3(a: [number, number, number], b: [number, number, number]): number {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function tokenEditDistance(a: string[], b: string[]): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let i = 0; i < rows; i++) dp[i][0] = i;
    for (let j = 0; j < cols; j++) dp[0][j] = j;

    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + substitutionCost,
            );
        }
    }

    return dp[a.length][b.length];
}

function buildPerturbations(tokens: string[]): string[] {
    if (tokens.length === 0) return [];

    const variants = new Set<string>();
    variants.add([...tokens, 'please'].join(' '));

    if (tokens.length >= 1) {
        variants.add(tokens.slice(0, -1).join(' '));
        variants.add(tokens.slice(1).join(' '));
        variants.add([...tokens, tokens[tokens.length - 1]].join(' '));
    }

    if (tokens.length >= 2) {
        const swapped = [...tokens];
        const pivot = Math.floor((tokens.length - 1) / 2);
        const nextIndex = Math.min(pivot + 1, tokens.length - 1);
        [swapped[pivot], swapped[nextIndex]] = [swapped[nextIndex], swapped[pivot]];
        variants.add(swapped.join(' '));
    }

    if (tokens.length >= 3) {
        const compressed = [tokens[0], tokens[Math.floor(tokens.length / 2)], tokens[tokens.length - 1]];
        variants.add(compressed.join(' '));
    }

    return Array.from(variants).filter(variant => variant.length > 0 && variant !== tokens.join(' '));
}

export function analyzeSemanticStability(text: string): SemanticStabilityEnvelope {
    const normalized = normalizeText(text);
    const cached = STABILITY_CACHE.get(normalized);
    if (cached) return cached;

    if (!normalized || normalized.length < 3) {
        const baseline: SemanticStabilityEnvelope = {
            projection: [0.5, 0.5, 0.5],
            localConditionNumber: 0,
            localLipschitz: 0,
            semanticJitter: 0,
            anchorMargin: 0,
            perturbationCount: 0,
        };
        STABILITY_CACHE.set(normalized, baseline);
        return baseline;
    }

    const baseTokens = tokenizeText(normalized);
    const baseHologram = generateHologram(normalized);
    const projection = projectFromHologram(baseHologram);
    const sortedProjection = [...projection].sort((a, b) => a - b);
    const anchorMargin = sortedProjection[1] - sortedProjection[0];

    let jitterSum = 0;
    let ratioSum = 0;
    let maxRatio = 0;
    let perturbationCount = 0;

    for (const variant of buildPerturbations(baseTokens)) {
        const variantTokens = tokenizeText(variant);
        const inputShift = tokenEditDistance(baseTokens, variantTokens) / Math.max(baseTokens.length, variantTokens.length, 1);
        if (inputShift <= 0) continue;

        const variantHologram = generateHologram(variant);
        const variantProjection = projectFromHologram(variantHologram);
        const projectionShift = euclidean3(projection, variantProjection) / Math.sqrt(3);
        const hologramShift = getHammingDistance(baseHologram, variantHologram) * 2;
        const totalShift = (projectionShift + hologramShift) / 2;
        const ratio = totalShift / inputShift;

        jitterSum += totalShift;
        ratioSum += ratio;
        if (ratio > maxRatio) maxRatio = ratio;
        perturbationCount++;
    }

    const envelope: SemanticStabilityEnvelope = {
        projection,
        localConditionNumber: perturbationCount > 0 ? maxRatio : 0,
        localLipschitz: perturbationCount > 0 ? ratioSum / perturbationCount : 0,
        semanticJitter: perturbationCount > 0 ? jitterSum / perturbationCount : 0,
        anchorMargin,
        perturbationCount,
    };

    if (STABILITY_CACHE.size >= STABILITY_CACHE_LIMIT) {
        const oldestKey = STABILITY_CACHE.keys().next().value;
        if (oldestKey) STABILITY_CACHE.delete(oldestKey);
    }
    STABILITY_CACHE.set(normalized, envelope);

    return envelope;
}

export function computeSemanticInstabilityRisk(envelope: SemanticStabilityEnvelope): number {
    const conditionComponent = Math.min(envelope.localConditionNumber, 6) / 6;
    const jitterComponent = Math.min(envelope.semanticJitter, 1);
    const boundaryComponent = Math.max(0, 0.2 - envelope.anchorMargin) / 0.2;
    return Math.max(0, Math.min(1, (conditionComponent * 0.45) + (jitterComponent * 0.35) + (boundaryComponent * 0.2)));
}

/**
 * Projects an arbitrary text blob against orthogonal Semantic Anchors.
 * Results in a constant 3-dimensional Float spatial coordinate representing true meaning topology.
 */
export function projectEpistemic(text: string): [number, number, number] {
    if (!text || text.length < 3) return [0.5, 0.5, 0.5]; // Default orthogonal uncertainty if too short

    return analyzeSemanticStability(text).projection;
}
