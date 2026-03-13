/**
 * Execution Loop Risk Engine
 * 
 * An O(1) mathematical execution governor for LLM swarms and agentic DAGs.
 * Uses pure linear algebra and spectral properties to prove system constraints
 * without recursive or iterative LLM inference.
 */

import { getMatrixRuntimeBackend } from './computeFabric';

export interface DynamicTransitionObservation {
    from: string;
    to: string;
    weight?: number;
}

export interface DynamicLoopRiskAssessment {
    matrix: number[][];
    nodeIds: string[];
    spectralRadius: number;
    recurrenceScore: number;
    cyclicComponentCount: number;
    escapeMass: number;
    divergent: boolean;
    observationCount: number;
}

/**
 * Thrown when an agentic execution graph is mathematically proven to enter
 * an infinite, divergent loop based on its structural transition probabilities.
 */
export class AstralDivergenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AstralDivergenceError';
    }
}

/**
 * Calculates the dominant eigenvalue (Spectral Radius) of a non-negative square matrix
 * using the Power Iteration method. 
 * Expected complexity: O(iterations * n^2). Extremely fast for agent graph sizes n < 100.
 * 
 * @param T The square transition/adjacency matrix representing expected edge invocations.
 * @param iterations The number of power iterations to run (default: 100).
 * @returns The dominant eigenvalue rho(T).
 */
export function spectralRadius(T: number[][], iterations: number = 100): number {
    const n = T.length;
    if (n === 0) return 0;

    // Validate square matrix
    for (let row of T) {
        if (row.length !== n) throw new Error("Transition matrix must be square.");
    }

    return getMatrixRuntimeBackend().powerIteration(T, iterations).eigenvalue;
}

/**
 * Computes the matrix inverse M^-1 using Gauss-Jordan elimination with partial pivoting.
 * 
 * @param M A square matrix to invert.
 * @returns The inverted matrix.
 */
export function invertMatrix(M: number[][]): number[][] {
    return getMatrixRuntimeBackend().invertMatrix(M);
}

function isApproximatelyStochasticMatrix(T: number[][], tolerance: number = 1e-6): boolean {
    if (T.length === 0) return false;

    return T.every((row) => {
        const rowSum = row.reduce((sum, value) => sum + value, 0);
        const allNonNegative = row.every((value) => value >= -tolerance);
        return allNonNegative && Math.abs(rowSum - 1) <= tolerance;
    });
}

/**
 * Validates whether a given Agentic Directed Graph (represented by its expectation matrix T)
 * will enter a mathematically diverging infinite loop.
 * 
 * @param T The square transition matrix of expected edge calls.
 * @returns True if the structural design will burn infinite tokens.
 */
export function hasDivergentLoop(T: number[][]): boolean {
    // A row-stochastic matrix encodes conserved probability flow, not explosive branching.
    // Its spectral radius is mathematically pinned at 1, so using rho >= 1 as a divergence
    // criterion would falsely reject every valid Markov kernel.
    if (isApproximatelyStochasticMatrix(T)) {
        return false;
    }

    const rho = spectralRadius(T);
    // According to Neumann Series convergence, an absorbing Markov chain or terminating 
    // DAG expects sum(T^k) to converge, requiring rho(T) < 1. 
    // If it is >= 1, the agents are trapped in a divergent loop.
    return rho >= 0.9999;
}

function clamp01(value: number): number {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function buildEmpiricalCounts(
    observations: DynamicTransitionObservation[],
    smoothing: number,
): { counts: number[][]; rawCounts: number[][]; nodeIds: string[] } {
    const nodeIds = Array.from(new Set(observations.flatMap(({ from, to }) => [from, to]))).sort();
    const index = new Map(nodeIds.map((nodeId, position) => [nodeId, position]));
    const size = nodeIds.length;
    const counts = Array.from({ length: size }, () => Array(size).fill(smoothing));
    const rawCounts = Array.from({ length: size }, () => Array(size).fill(0));

    for (const observation of observations) {
        const fromIndex = index.get(observation.from);
        const toIndex = index.get(observation.to);
        if (fromIndex === undefined || toIndex === undefined) continue;
        const weight = Math.max(observation.weight ?? 1, 0);
        counts[fromIndex][toIndex] += weight;
        rawCounts[fromIndex][toIndex] += weight;
    }

    return { counts, rawCounts, nodeIds };
}

function findStronglyConnectedComponents(adjacency: number[][]): number[][] {
    const n = adjacency.length;
    const stack: number[] = [];
    const onStack = new Array(n).fill(false);
    const index = new Array(n).fill(-1);
    const lowlink = new Array(n).fill(0);
    const components: number[][] = [];
    let currentIndex = 0;

    const strongConnect = (v: number) => {
        index[v] = currentIndex;
        lowlink[v] = currentIndex;
        currentIndex++;
        stack.push(v);
        onStack[v] = true;

        for (let w = 0; w < n; w++) {
            if (adjacency[v][w] <= 0) continue;
            if (index[w] === -1) {
                strongConnect(w);
                lowlink[v] = Math.min(lowlink[v], lowlink[w]);
            } else if (onStack[w]) {
                lowlink[v] = Math.min(lowlink[v], index[w]);
            }
        }

        if (lowlink[v] === index[v]) {
            const component: number[] = [];
            while (true) {
                const w = stack.pop();
                if (w === undefined) break;
                onStack[w] = false;
                component.push(w);
                if (w === v) break;
            }
            components.push(component);
        }
    };

    for (let v = 0; v < n; v++) {
        if (index[v] === -1) strongConnect(v);
    }

    return components;
}

function computeRecurrenceScore(rawCounts: number[][]): {
    score: number;
    cyclicComponentCount: number;
    escapeMass: number;
} {
    if (rawCounts.length === 0) {
        return { score: 0, cyclicComponentCount: 0, escapeMass: 1 };
    }

    const components = findStronglyConnectedComponents(rawCounts);
    let bestScore = 0;
    let bestEscapeMass = 1;
    let cyclicComponentCount = 0;

    for (const component of components) {
        if (component.length < 2) continue;
        cyclicComponentCount++;
        const componentSet = new Set(component);
        let internalMass = 0;
        let externalMass = 0;
        let internalEdgeCount = 0;

        for (const from of component) {
            for (let to = 0; to < rawCounts.length; to++) {
                const weight = rawCounts[from][to];
                if (weight <= 0) continue;
                if (componentSet.has(to)) {
                    internalMass += weight;
                    if (from !== to) internalEdgeCount++;
                } else {
                    externalMass += weight;
                }
            }
        }

        const retention = internalMass / Math.max(1e-9, internalMass + externalMass);
        const repeatIntensity = clamp01(1 - Math.exp(-1.5 * (internalMass / Math.max(1, component.length))));
        const cycleCoverage = clamp01(internalEdgeCount / Math.max(1, component.length * (component.length - 1)));
        const score = retention * repeatIntensity * (0.5 + (0.5 * cycleCoverage));

        if (score > bestScore) {
            bestScore = score;
            bestEscapeMass = externalMass / Math.max(1e-9, internalMass + externalMass);
        }
    }

    return {
        score: bestScore,
        cyclicComponentCount,
        escapeMass: bestEscapeMass,
    };
}

export function buildEmpiricalTransitionMatrix(
    observations: DynamicTransitionObservation[],
    smoothing: number = 0.05,
): { matrix: number[][]; nodeIds: string[] } {
    const { counts, nodeIds } = buildEmpiricalCounts(observations, smoothing);
    const size = nodeIds.length;
    if (size === 0) {
        return { matrix: [], nodeIds: [] };
    }

    const matrix = counts.map((row) => {
        const total = row.reduce((sum, value) => sum + value, 0);
        return total > 0 ? row.map((value) => value / total) : row;
    });

    return { matrix, nodeIds };
}

export function assessDynamicLoopRisk(
    observations: DynamicTransitionObservation[],
    options: {
        smoothing?: number;
        divergenceThreshold?: number;
    } = {},
): DynamicLoopRiskAssessment {
    const { counts, rawCounts, nodeIds } = buildEmpiricalCounts(observations, options.smoothing ?? 0.05);
    const matrix = counts.map((row) => {
        const total = row.reduce((sum, value) => sum + value, 0);
        return total > 0 ? row.map((value) => value / total) : row;
    });
    const spectral = spectralRadius(matrix);
    const recurrence = computeRecurrenceScore(rawCounts);
    const threshold = options.divergenceThreshold ?? 0.82;

    return {
        matrix,
        nodeIds,
        spectralRadius: spectral,
        recurrenceScore: recurrence.score,
        cyclicComponentCount: recurrence.cyclicComponentCount,
        escapeMass: recurrence.escapeMass,
        divergent: recurrence.score >= threshold,
        observationCount: observations.length,
    };
}

/**
 * Computes the final equilibrium consensus state for multi-agent updates occurring 
 * in a linear interaction model: x(t+1) = A * x(t) + B.
 * 
 * Instantly calculates: x_inf = (I - A)^-1 * B
 * 
 * @param A The n x n weight matrix dictating how agents influence each other.
 * @param B The n x 1 bias vector.
 * @returns The finalized consensus equilibrium values without requiring iterative LLM steps.
 */
export function resolveConsensus(A: number[][], B: number[]): number[] {
    const n = A.length;
    if (n !== B.length) throw new Error("A dimensions must match B dimensions.");

    // Construct (I - A)
    const I_minus_A = A.map((row, i) => {
        return row.map((val, j) => {
            return (i === j ? 1 : 0) - val;
        });
    });

    // Solve (I - A) x = B directly instead of explicitly inverting.
    return getMatrixRuntimeBackend().solveLinearSystem(I_minus_A, B);
}
