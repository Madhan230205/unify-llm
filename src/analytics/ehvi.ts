/**
 * Expected Hypervolume Improvement (EHVI) Engine
 * 
 * Computes exact hypervolume contributions and Monte Carlo EHVI for
 * multi-objective Bayesian optimization over LLM routing objectives:
 * quality, latency, and cost.
 * 
 * Mathematical Foundation:
 *   HV(P, r) = λ_d(⋃_{p∈P} [p, r])   — Lebesgue measure of dominated space
 *   EHVI = E_f[HV(P ∪ {f(x)}, r) - HV(P, r)]
 * 
 * Uses inclusion-exclusion for exact 2D hypervolume and Monte Carlo 
 * sampling with GP posteriors for EHVI approximation.
 * 
 * Zero dependencies. Pure TypeScript.
 */

export interface ParetoPoint {
    objectives: number[];  // [quality, -latency, -cost] (all maximized)
    modelId: string;
}

export interface GPPrediction {
    mu: number[];      // predicted means per objective
    sigma: number[];   // predicted std devs per objective
    modelId: string;
}

/**
 * Returns true if point `a` Pareto-dominates point `b`.
 * a dominates b iff a[i] >= b[i] for all i, and a[j] > b[j] for at least one j.
 */
export function dominates(a: number[], b: number[]): boolean {
    let strictlyBetter = false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) return false;
        if (a[i] > b[i]) strictlyBetter = true;
    }
    return strictlyBetter;
}

/**
 * Extracts the non-dominated (Pareto-optimal) subset from a set of observations.
 * O(N² · D) where N = number of points, D = objective dimensions.
 */
export function findParetoFront(points: ParetoPoint[]): ParetoPoint[] {
    const front: ParetoPoint[] = [];
    for (let i = 0; i < points.length; i++) {
        let isDominated = false;
        for (let j = 0; j < points.length; j++) {
            if (i !== j && dominates(points[j].objectives, points[i].objectives)) {
                isDominated = true;
                break;
            }
        }
        if (!isDominated) {
            front.push(points[i]);
        }
    }
    return front;
}

/**
 * Computes exact hypervolume indicator for a set of points against a reference point.
 * 
 * For D=2: Sweep-line algorithm O(N log N)
 * For D=3+: Inclusion-exclusion with slicing O(N^D) — acceptable for small fronts
 * 
 * All objectives are MAXIMIZED. The reference point is the anti-ideal (worst) corner.
 */
export function computeHypervolume(points: number[][], ref: number[]): number {
    if (points.length === 0) return 0;
    const d = ref.length;

    if (d === 1) {
        let maxVal = -Infinity;
        for (const p of points) {
            if (p[0] > maxVal) maxVal = p[0];
        }
        return Math.max(0, maxVal - ref[0]);
    }

    if (d === 2) {
        return computeHypervolume2D(points, ref);
    }

    // D >= 3: Inclusion-exclusion via recursive slicing
    return computeHypervolumeND(points, ref);
}

/**
 * Exact 2D hypervolume via sweep-line.
 * Sort points by first objective descending, sweep and accumulate rectangles.
 */
function computeHypervolume2D(points: number[][], ref: number[]): number {
    // Filter points that are above the reference in both objectives
    const valid = points.filter(p => p[0] > ref[0] && p[1] > ref[1]);
    if (valid.length === 0) return 0;

    // Sort by first objective descending
    valid.sort((a, b) => b[0] - a[0]);

    let volume = 0;
    let prevY = ref[1];  // sweep line position along second objective

    for (const p of valid) {
        if (p[1] > prevY) {
            volume += (p[0] - ref[0]) * (p[1] - prevY);
            prevY = p[1];
        }
    }

    return volume;
}

/**
 * N-dimensional hypervolume via inclusion-exclusion.
 * Slices along the last dimension and recurses.
 */
function computeHypervolumeND(points: number[][], ref: number[]): number {
    if (points.length === 0) return 0;
    const d = ref.length;
    if (d === 1) {
        let maxVal = -Infinity;
        for (const p of points) {
            if (p[0] > maxVal) maxVal = p[0];
        }
        return Math.max(0, maxVal - ref[0]);
    }

    // Sort by last dimension descending
    const sorted = [...points]
        .filter(p => {
            for (let i = 0; i < d; i++) {
                if (p[i] <= ref[i]) return false;
            }
            return true;
        })
        .sort((a, b) => b[d - 1] - a[d - 1]);

    if (sorted.length === 0) return 0;

    let volume = 0;
    let prevSlice = ref[d - 1];

    for (let k = sorted.length - 1; k >= 0; k--) {
        const height = sorted[k][d - 1] - prevSlice;
        if (height <= 0) continue;

        // Project active points onto (d-1) dimensions
        const activeProjected: number[][] = [];
        const subRef = ref.slice(0, d - 1);
        for (let j = 0; j <= k; j++) {
            activeProjected.push(sorted[j].slice(0, d - 1));
        }

        const baseArea = d - 1 === 2
            ? computeHypervolume2D(activeProjected, subRef)
            : computeHypervolumeND(activeProjected, subRef);

        volume += baseArea * height;
        prevSlice = sorted[k][d - 1];
    }

    return volume;
}

/**
 * Deterministic seeded PRNG (mulberry32) for reproducible Monte Carlo sampling.
 */
function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Box-Muller transform for generating normal samples from uniform samples.
 */
function normalSample(mu: number, sigma: number, rand: () => number): number {
    const u1 = rand();
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-15)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z;
}

/**
 * Computes Expected Hypervolume Improvement (EHVI) for each candidate model.
 * 
 * For each candidate, draws S samples from its GP posterior (one GP per objective),
 * computes the hypervolume gain over the current Pareto front, and averages.
 * 
 * @param paretoFront Current non-dominated set
 * @param gpPredictions GP posterior predictions for each candidate model
 * @param ref Reference point (anti-ideal). Default: [0, -10, -10] for [quality, -latency, -cost]
 * @param samples Number of Monte Carlo samples (default 200)
 * @param seed Random seed for reproducibility
 * @returns Map of modelId → expected hypervolume improvement
 */
export function computeEHVI(
    paretoFront: ParetoPoint[],
    gpPredictions: GPPrediction[],
    ref: number[] = [0, -10, -10],
    samples: number = 200,
    seed: number = 42
): Map<string, number> {
    const rand = mulberry32(seed);
    const d = ref.length;

    // Baseline hypervolume of current Pareto front
    const frontObjectives = paretoFront.map(p => p.objectives);
    const baseHV = computeHypervolume(frontObjectives, ref);

    const ehviMap = new Map<string, number>();

    for (const pred of gpPredictions) {
        let totalImprovement = 0;

        for (let s = 0; s < samples; s++) {
            // Sample from GP posterior for each objective
            const sample: number[] = [];
            for (let j = 0; j < d; j++) {
                sample.push(normalSample(pred.mu[j], pred.sigma[j], rand));
            }

            // Compute hypervolume with the sampled point added
            const augmented = [...frontObjectives, sample];
            const newHV = computeHypervolume(augmented, ref);
            totalImprovement += Math.max(0, newHV - baseHV);
        }

        ehviMap.set(pred.modelId, totalImprovement / samples);
    }

    return ehviMap;
}
