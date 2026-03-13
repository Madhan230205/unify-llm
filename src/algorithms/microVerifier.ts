import {
    analyzeSemanticStability,
    computeRobustSemanticDistance,
    computeSemanticInstabilityRisk,
    getSemanticModalityDistance,
} from '../analytics/semanticFingerprintEngine';

export type ClaimBoundaryType = 'sentence' | 'entity-predicate' | 'number-unit' | 'date-reference' | 'location-fact';

export interface ClaimBoundaryEvent {
    type: ClaimBoundaryType;
    claimText: string;
    offsetStart: number;
    offsetEnd: number;
}

export interface MicroVerifierInput {
    promptText: string;
    claimText: string;
    anomalyScore?: number;
    signal?: AbortSignal;
}

export interface MicroVerifierResult {
    hallucinationConfidence: number;
    selfConsistencyScore: number;
    contradictionScore: number;
    instabilityScore: number;
    timedOut: boolean;
    reasons: string[];
}

const CJK_OR_HANGUL_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const FULL_WIDTH_SENTENCE_TERMINALS = new Set(['。', '！', '？']);
const NUMERIC_DATE_REFERENCE = /\b(?:\d{4}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)\b/u;
const CAPITALIZED_ENTITY_REFERENCE = /(?:^|[^\p{L}\p{N}])\p{Lu}[\p{L}\p{M}'’-]+(?:\s+\p{Lu}[\p{L}\p{M}'’-]+){0,3}(?=$|[^\p{L}\p{N}])/u;
const NUMBER_UNIT = /\b\d+(?:\.\d+)?\s?(%|km|m|cm|kg|g|lb|mi|ms|s|sec|min|h|hr|usd|eur|\$|€)\b/i;
const ENTITY_PREDICATE_CUES = [
    'is', 'was', 'are', 'were', 'has', 'have', 'contains', 'belongs', 'located', 'born', 'founded', 'created',
    'est', 'sont', 'etait', 'etaient', 'a', 'ont', 'contient', 'appartient', 'situe', 'nee', 'ne', 'fonde', 'cree',
    'es', 'son', 'fue', 'era', 'tiene', 'tienen', 'contiene', 'pertenece', 'ubicado', 'nacio', 'fundado', 'creado',
    'sao', 'foram', 'foi', 'tem', 'temos', 'contem', 'pertence', 'localizado', 'nasceu', 'fundado', 'criado',
    'ist', 'sind', 'war', 'waren', 'hat', 'haben', 'enthalt', 'enthaelt', 'gehort', 'liegt', 'geboren', 'gegrundet', 'erstellt',
    '是', '位于', '属于', '包含', '出生于', '成立于', '创建于',
    'です', 'である', '位置する', '属する', '含む', '生まれ', '設立',
    '이다', '입니다', '위치', '속한다', '포함', '태어났', '설립',
];
const DATE_REFERENCE_CUES = [
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'today', 'yesterday', 'tomorrow',
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
    'aujourd hui', 'aujourdhui', 'aujourd', 'hier', 'demain',
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    'hoy', 'ayer', 'manana',
    'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    'hoje', 'ontem', 'amanha',
    'januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember',
    'heute', 'gestern', 'morgen',
    '今天', '昨天', '明天', '今日', '昨日', '明日', '오늘', '어제', '내일',
];
const LOCATION_FACT_CUES = [
    'capital of', 'located in', 'in the city of', 'country of', 'state of', 'region of',
    'capitale de', 'situe a', 'situe en', 'ville de', 'pays de', 'etat de', 'region de',
    'capital de', 'ubicado en', 'ciudad de', 'pais de', 'estado de', 'region de',
    'capital do', 'capital da', 'localizado em', 'cidade de', 'pais de', 'estado de', 'regiao de',
    'hauptstadt von', 'liegt in', 'stadt von', 'land von', 'region von',
    '的首都', '首都是', '位于',
    'の首都', '首都は', '位置する',
    '수도', '위치',
];

function stripDiacritics(text: string): string {
    return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeBoundaryText(text: string): string {
    return stripDiacritics(text.toLowerCase())
        .replace(/[^\p{L}\p{N}\s./-]|_/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCue(cue: string): string {
    return normalizeBoundaryText(cue);
}

function containsCue(normalizedText: string, cue: string): boolean {
    const normalizedCue = normalizeCue(cue);
    if (!normalizedCue) return false;

    if (CJK_OR_HANGUL_REGEX.test(normalizedCue)) {
        return normalizedText.includes(normalizedCue);
    }

    return ` ${normalizedText} `.includes(` ${normalizedCue} `);
}

function containsAnyCue(normalizedText: string, cues: string[]): boolean {
    return cues.some(cue => containsCue(normalizedText, cue));
}

function hasEntityLikeSurface(text: string, normalizedText: string): boolean {
    if (CAPITALIZED_ENTITY_REFERENCE.test(text)) return true;
    if (CJK_OR_HANGUL_REGEX.test(text)) return true;
    return normalizedText.split(/\s+/).filter(Boolean).length >= 3;
}

function isEntityPredicate(text: string, normalizedText: string): boolean {
    return containsAnyCue(normalizedText, ENTITY_PREDICATE_CUES) && hasEntityLikeSurface(text, normalizedText);
}

function isDateReference(text: string, normalizedText: string): boolean {
    return NUMERIC_DATE_REFERENCE.test(text) || containsAnyCue(normalizedText, DATE_REFERENCE_CUES);
}

function isLocationFact(normalizedText: string): boolean {
    return containsAnyCue(normalizedText, LOCATION_FACT_CUES);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export function splitCompleteSentenceUnits(buffer: string): { completed: string[]; remainder: string } {
    if (!buffer) return { completed: [], remainder: '' };

    const completed: string[] = [];
    let cursor = 0;
    const sentenceTerminals = new Set(['.', '!', '?', ...FULL_WIDTH_SENTENCE_TERMINALS]);

    for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (!sentenceTerminals.has(ch)) continue;

        const next = i + 1 < buffer.length ? buffer[i + 1] : '';
        const boundary = next === '' || /\s|\n|\r|\t/.test(next) || FULL_WIDTH_SENTENCE_TERMINALS.has(ch);
        if (!boundary) continue;

        const unit = buffer.slice(cursor, i + 1).trim();
        if (unit.length > 0) completed.push(unit);
        cursor = i + 1;
        while (cursor < buffer.length && /\s/.test(buffer[cursor])) cursor++;
        i = cursor - 1;
    }

    const remainder = buffer.slice(cursor);
    return { completed, remainder };
}

export function detectClaimBoundaryEvents(unitText: string): ClaimBoundaryEvent[] {
    const text = unitText.trim();
    if (!text) return [];
    const normalizedText = normalizeBoundaryText(text);

    const events: ClaimBoundaryEvent[] = [];
    events.push({
        type: 'sentence',
        claimText: text,
        offsetStart: 0,
        offsetEnd: text.length,
    });

    if (isEntityPredicate(text, normalizedText)) {
        events.push({
            type: 'entity-predicate',
            claimText: text,
            offsetStart: 0,
            offsetEnd: text.length,
        });
    }
    if (NUMBER_UNIT.test(text)) {
        events.push({
            type: 'number-unit',
            claimText: text,
            offsetStart: 0,
            offsetEnd: text.length,
        });
    }
    if (isDateReference(text, normalizedText)) {
        events.push({
            type: 'date-reference',
            claimText: text,
            offsetStart: 0,
            offsetEnd: text.length,
        });
    }
    if (isLocationFact(normalizedText)) {
        events.push({
            type: 'location-fact',
            claimText: text,
            offsetStart: 0,
            offsetEnd: text.length,
        });
    }

    return events;
}

async function runVerifierCore(input: MicroVerifierInput): Promise<MicroVerifierResult> {
    if (input.signal?.aborted) {
        return {
            hallucinationConfidence: 0,
            selfConsistencyScore: 1,
            contradictionScore: 0,
            instabilityScore: 0,
            timedOut: true,
            reasons: ['aborted-before-verification'],
        };
    }

    const claim = input.claimText.trim();
    const prompt = input.promptText.trim();
    const anomalyScore = clamp01(input.anomalyScore ?? 0);

    const contradiction = clamp01(computeRobustSemanticDistance(prompt, claim));
    const modalityShift = clamp01(getSemanticModalityDistance(prompt, claim));
    const promptRisk = computeSemanticInstabilityRisk(analyzeSemanticStability(prompt));
    const claimRisk = computeSemanticInstabilityRisk(analyzeSemanticStability(claim));
    const instabilityLift = clamp01(Math.max(0, claimRisk - promptRisk));

    // Lightweight self-consistency approximation without extra model calls.
    const selfConsistency = clamp01(1 - ((contradiction * 0.55) + (modalityShift * 0.25) + (instabilityLift * 0.2)));

    const instabilityScore = clamp01((instabilityLift * 0.65) + (modalityShift * 0.35));
    const hallucinationConfidence = clamp01(
        (contradiction * 0.45)
        + ((1 - selfConsistency) * 0.25)
        + (instabilityScore * 0.2)
        + (anomalyScore * 0.1),
    );

    const reasons: string[] = [];
    if (contradiction > 0.5) reasons.push('prompt-claim-divergence');
    if (instabilityLift > 0.15) reasons.push('instability-lift');
    if (modalityShift > 0.2) reasons.push('modality-shift');
    if (anomalyScore > 0.45) reasons.push('upstream-anomaly');

    return {
        hallucinationConfidence,
        selfConsistencyScore: selfConsistency,
        contradictionScore: contradiction,
        instabilityScore,
        timedOut: false,
        reasons,
    };
}

export async function runMicroVerifier(
    input: MicroVerifierInput,
    timeoutMs = 150,
): Promise<MicroVerifierResult> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return runVerifierCore(input);
    }

    return await new Promise<MicroVerifierResult>((resolve) => {
        const timer = setTimeout(() => {
            resolve({
                hallucinationConfidence: 0,
                selfConsistencyScore: 1,
                contradictionScore: 0,
                instabilityScore: 0,
                timedOut: true,
                reasons: ['verification-timeout'],
            });
        }, timeoutMs);

        void runVerifierCore(input)
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(() => {
                clearTimeout(timer);
                resolve({
                    hallucinationConfidence: 0,
                    selfConsistencyScore: 1,
                    contradictionScore: 0,
                    instabilityScore: 0,
                    timedOut: true,
                    reasons: ['verification-error'],
                });
            });
    });
}
