import { CompletionResponse } from '../types';
import { createSemanticMomentumGuardian, GuardianOptions } from '../middlewares/hallucinationGuard';

export interface SafetySignalStats {
    mean: number;
    variance: number;
    count: number;
}

export interface HallucinationShield {
    getStats: () => {
        mean: number;
        variance: number;
        count: number;
        driftMean: number;
        driftVariance: number;
        driftCount: number;
        curvature: SafetySignalStats;
        drift: SafetySignalStats;
    };
}

export interface SafetySignal {
    hallucinationAborted: boolean;
    curvatureAnomaly: boolean;
    semanticCurvature: number;
    semanticDrift: number;
    semanticModalityShift: number;
    semanticRetention: number;
    semanticInstability: number;
    safe: boolean;
}

function asNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createHallucinationShield(options: GuardianOptions = {}) {
    return createSemanticMomentumGuardian(options) as HallucinationShield;
}

export function inspectSafetySignal(response: CompletionResponse): SafetySignal {
    const meta = response.providerSpecific ?? {};
    const hallucinationAborted = Boolean(meta.hallucinationAborted);
    const curvatureAnomaly = Boolean(meta.curvatureAnomaly);

    const signal: SafetySignal = {
        hallucinationAborted,
        curvatureAnomaly,
        semanticCurvature: asNumber(meta.semanticCurvature),
        semanticDrift: asNumber(meta.semanticDrift),
        semanticModalityShift: asNumber(meta.semanticModalityShift),
        semanticRetention: asNumber(meta.semanticRetention, 1),
        semanticInstability: asNumber(meta.semanticInstability),
        safe: !(hallucinationAborted || curvatureAnomaly),
    };

    return signal;
}
