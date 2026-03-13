export type QVIPRiskState = 'SAFE' | 'SUSPECT' | 'UNSAFE';

export interface QVIPControllerOptions {
    /** Exponential decay memory for risk state. Higher = longer memory. */
    lambda?: number;
    /** Weight for abrupt instability jumps between adjacent observations. */
    gamma?: number;
    /** Risk threshold below which stream is considered safe. */
    thetaLow?: number;
    /** Risk threshold above which stream is considered unsafe. */
    thetaHigh?: number;
    /** Extra uplift when hard anomaly evidence appears. */
    strongSignalBoost?: number;
}

export interface QVIPUpdateInput {
    anomalyScore: number;
    instabilityJump?: number;
    strongSignal?: boolean;
    verificationConfidence?: number;
}

export interface QVIPSnapshot {
    state: QVIPRiskState;
    risk: number;
    anomalyScore: number;
    instabilityJump: number;
    verificationConfidence: number;
}

const DEFAULT_OPTIONS: Required<QVIPControllerOptions> = {
    lambda: 0.82,
    gamma: 0.22,
    thetaLow: 0.28,
    thetaHigh: 0.62,
    strongSignalBoost: 0.14,
};

function clamp01(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export class QVIPController {
    private readonly options: Required<QVIPControllerOptions>;
    private prevRisk = 0;
    private prevAnomalyScore = 0;

    constructor(options: QVIPControllerOptions = {}) {
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
        };
    }

    update(input: QVIPUpdateInput): QVIPSnapshot {
        const anomalyScore = clamp01(input.anomalyScore);
        const instabilityJump = clamp01(
            input.instabilityJump ?? Math.abs(anomalyScore - this.prevAnomalyScore),
        );
        const verificationConfidence = clamp01(input.verificationConfidence ?? 0);

        const riskBase = (this.options.lambda * this.prevRisk)
            + ((1 - this.options.lambda) * anomalyScore)
            + (this.options.gamma * instabilityJump);

        const strongBoost = input.strongSignal ? this.options.strongSignalBoost : 0;
        const verificationDiscount = verificationConfidence * 0.22;
        const risk = clamp01(riskBase + strongBoost - verificationDiscount);

        this.prevRisk = risk;
        this.prevAnomalyScore = anomalyScore;

        let state: QVIPRiskState = 'SAFE';
        if (risk >= this.options.thetaHigh) state = 'UNSAFE';
        else if (risk >= this.options.thetaLow) state = 'SUSPECT';

        return {
            state,
            risk,
            anomalyScore,
            instabilityJump,
            verificationConfidence,
        };
    }

    getRisk(): number {
        return this.prevRisk;
    }

    reset(): void {
        this.prevRisk = 0;
        this.prevAnomalyScore = 0;
    }
}
