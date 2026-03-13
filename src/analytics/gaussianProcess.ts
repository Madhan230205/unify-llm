/**
 * Gaussian Process Regression (Kriging) Engine
 *
 * A zero-dependency Pure Mathematics implementation of Gaussian Process Regression.
 * Calculates predictive mean and variance over a continuous topological surface
 * using a Radial Basis Function (RBF) Kernel. Evaluated under an O(N^3)
 * dense Gaussian-Jordan elimination matrix inversion.
 */

import { getMatrixRuntimeBackend } from './computeFabric';

const MAX_SAFE_SYNC_OBSERVATIONS = 64;

export class GaussianProcess {
    private observationsX: number[][] = [];
    private observationsY: number[] = [];
    private weights: number[] = [];
    private lengthScale: number;
    private signalVariance: number;
    private noiseVariance: number;
    private maxObservations: number;
    private cholFactor: number[][] | null = null;
    private alphaVector: number[] | null = null;
    private effectiveNoiseVariance: number;
    private conditionNumber = 1;
    private readonly requestedMaxObservations: number;
    private readonly syncSafetyCapApplied: boolean;

    private get math() {
        return getMatrixRuntimeBackend();
    }

    constructor(
        lengthScale: number = 1.0,
        signalVariance: number = 1.0,
        noiseVariance: number = 1e-6, // Strict positive-definite constraint (Tikhonov regularization / Nugget Effect)
        maxObservations: number = 40
    ) {
        this.lengthScale = lengthScale;
        this.signalVariance = signalVariance;
        this.noiseVariance = noiseVariance;
        this.effectiveNoiseVariance = noiseVariance;
        this.requestedMaxObservations = maxObservations;
        this.syncSafetyCapApplied = maxObservations > MAX_SAFE_SYNC_OBSERVATIONS;
        this.maxObservations = Math.min(maxObservations, MAX_SAFE_SYNC_OBSERVATIONS);
    }

    /**
     * Isotropic Squared Exponential (RBF) Kernel
     */
    private rbfKernel(x1: number[], x2: number[]): number {
        if (x1.length !== x2.length) throw new Error("Vector dimensions mismatch");
        let sqDist = 0;
        for (let i = 0; i < x1.length; i++) {
            const diff = x1[i] - x2[i];
            sqDist += diff * diff;
        }
        return this.signalVariance * Math.exp(-sqDist / (2 * this.lengthScale * this.lengthScale));
    }

    private choleskyDecompose(matrix: number[][]): number[][] | null {
        return this.math.choleskyDecompose(matrix);
    }

    private forwardSubstitute(L: number[][], b: number[]): number[] {
        return this.math.solveLowerTriangular(L, b);
    }

    private backSubstituteTranspose(L: number[][], y: number[]): number[] {
        return this.math.solveUpperTriangularFromLower(L, y);
    }

    private solveWithCholesky(L: number[][], b: number[]): number[] {
        return this.math.solveWithCholesky(L, b);
    }

    private matrixVectorMultiply(M: number[][], v: number[]): number[] {
        return this.math.matrixVectorMultiply(M, v);
    }

    private vectorNorm2(v: number[]): number {
        return this.math.vectorNorm2(v);
    }

    private computeFactorConditionNumber(L: number[][]): number {
        let minPivot = Number.POSITIVE_INFINITY;
        let maxPivot = 0;
        for (let i = 0; i < L.length; i++) {
            const pivot = L[i][i];
            if (pivot < minPivot) minPivot = pivot;
            if (pivot > maxPivot) maxPivot = pivot;
        }
        return (maxPivot / Math.max(minPivot, 1e-12)) ** 2;
    }

    private kernelMatrixVectorMultiply(v: number[], diagonalNoise: number): number[] {
        const n = this.observationsX.length;
        const out = new Array(n).fill(0);

        for (let i = 0; i < n; i++) {
            let sum = 0;
            for (let j = 0; j < n; j++) {
                sum += this.rbfKernel(this.observationsX[i], this.observationsX[j]) * v[j];
            }
            out[i] = sum + (diagonalNoise * v[i]);
        }

        return out;
    }

    private tryIncrementalAppendSolve(): boolean {
        const n = this.observationsX.length;
        const previousCount = n - 1;
        if (previousCount <= 0) return false;
        if (!this.cholFactor || this.cholFactor.length !== previousCount) return false;

        const xNew = this.observationsX[n - 1];
        const crossCovariance = this.observationsX
            .slice(0, previousCount)
            .map(xObs => this.rbfKernel(xObs, xNew));
        const diagonalNoise = Math.max(this.noiseVariance, this.effectiveNoiseVariance);
        const selfCovariance = this.rbfKernel(xNew, xNew) + diagonalNoise;

        const appended = this.math.appendCholeskyObservation(this.cholFactor, crossCovariance, selfCovariance);
        if (!appended) {
            return false;
        }

        const alpha = this.solveWithCholesky(appended.factor, this.observationsY);
        const fitted = this.kernelMatrixVectorMultiply(alpha, diagonalNoise);
        const residual = fitted.map((value, index) => value - this.observationsY[index]);
        const residualNorm = this.vectorNorm2(residual) / (this.vectorNorm2(this.observationsY) + 1e-12);
        const condition = this.computeFactorConditionNumber(appended.factor);

        if (!Number.isFinite(condition) || condition > 1e10 || residualNorm > 1e-4) {
            return false;
        }

        this.cholFactor = appended.factor;
        this.alphaVector = alpha;
        this.conditionNumber = condition;
        this.effectiveNoiseVariance = diagonalNoise;
        return true;
    }

    /**
     * Rebuild the dense covariance matrix and compute a numerically stable solve model.
     *
     * Innovation: Rank-Adaptive Stabilized Cholesky Envelope (RASCE)
     * - Escalates diagonal jitter when pivots/residuals indicate instability.
     * - Solves linear systems via triangular substitutions (no explicit inverse).
     * - Selects the best admissible candidate based on condition proxy + residual.
     */
    private computeKInverse() {
        const n = this.observationsX.length;
        if (n === 0) return;

        let acceptedL: number[][] | null = null;
        let acceptedAlpha: number[] | null = null;
        let acceptedCondition = Number.POSITIVE_INFINITY;
        let acceptedResidual = Number.POSITIVE_INFINITY;
        let acceptedNoiseVariance = this.noiseVariance;
        let bestScore = Number.POSITIVE_INFINITY;
        let hadAnyFactorization = false;

        for (let attempt = 0; attempt < 9; attempt++) {
            const diagonalJitter = this.noiseVariance * Math.pow(10, attempt);
            const K: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

            for (let i = 0; i < n; i++) {
                for (let j = 0; j <= i; j++) {
                    const value = this.rbfKernel(this.observationsX[i], this.observationsX[j]);
                    K[i][j] = value;
                    K[j][i] = value;
                    if (i === j) {
                        K[i][j] += diagonalJitter;
                    }
                }
            }

            const L = this.choleskyDecompose(K);
            if (!L) {
                continue;
            }
            hadAnyFactorization = true;

            const alpha = this.solveWithCholesky(L, this.observationsY);
            const fitted = this.matrixVectorMultiply(K, alpha);
            const residual = fitted.map((value, index) => value - this.observationsY[index]);
            const residualNorm = this.vectorNorm2(residual) / (this.vectorNorm2(this.observationsY) + 1e-12);

            const condition = this.computeFactorConditionNumber(L);
            const score = condition + (residualNorm * 1e6);

            if (score < bestScore) {
                acceptedL = L;
                acceptedAlpha = alpha;
                acceptedCondition = condition;
                acceptedResidual = residualNorm;
                acceptedNoiseVariance = diagonalJitter;
                bestScore = score;
            }

            if (Number.isFinite(condition) && condition <= 1e8 && residualNorm <= 1e-5) {
                break;
            }
        }

        if (!acceptedL || !acceptedAlpha) {
            if (!hadAnyFactorization) {
                throw new Error('GaussianProcess failed to construct a stable Cholesky factorization.');
            }
            throw new Error('GaussianProcess failed to construct a sufficiently accurate solve model.');
        }

        this.cholFactor = acceptedL;
        this.alphaVector = acceptedAlpha;
        this.conditionNumber = Number.isFinite(acceptedCondition) ? acceptedCondition : 1e12;
        this.effectiveNoiseVariance = acceptedNoiseVariance;
        if (!Number.isFinite(acceptedResidual)) {
            this.conditionNumber = 1e12;
        }
    }

    /**
     * Orthogonal Eigen-Memory Distillation (OEMD)
     * Replaces standard FIFO arrays with continuous spatial coordinate compression.
     */
    public addObservation(x: number[], y: number) {
        this.observationsX.push(x);
        this.observationsY.push(y);
        this.weights.push(1.0);

        if (this.observationsX.length > this.maxObservations) {
            this.distillOrthogonalMemory();
            this.computeKInverse();
            return;
        }

        if (!this.tryIncrementalAppendSolve()) {
            this.computeKInverse();
        }
    }

    /**
     * Instead of deleting the oldest LLM routing metrics (Catastrophic Forgetting), 
     * mathematically fuse the two statistically most similar vectors into a heavy Eigen-Prompt.
     */
    private distillOrthogonalMemory() {
        const n = this.observationsX.length;
        let maxSim = -Infinity;
        let p1 = -1;
        let p2 = -1;

        // Find the two vectors with maximum RBF kernel correlation
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const sim = this.rbfKernel(this.observationsX[i], this.observationsX[j]);
                if (sim > maxSim) {
                    maxSim = sim;
                    p1 = i;
                    p2 = j;
                }
            }
        }

        if (p1 === -1 || p2 === -1) return;

        const w1 = this.weights[p1];
        const w2 = this.weights[p2];
        const totalW = w1 + w2;

        // Synthesize the dominant Eigen-Prompt bounded by observation mass
        const blendedX = this.observationsX[p1].map((val, idx) =>
            ((val * w1) + (this.observationsX[p2][idx] * w2)) / totalW
        );

        // Blended localized utility
        const blendedY = ((this.observationsY[p1] * w1) + (this.observationsY[p2] * w2)) / totalW;

        // Insert new Eigen-Prompt mathematically decayed by 0.99 to force plasticity
        this.observationsX.push(blendedX);
        this.observationsY.push(blendedY);
        this.weights.push(totalW * 0.99);

        // Splice out the original pre-distilled vectors (remove higher index first)
        this.observationsX.splice(p2, 1);
        this.observationsY.splice(p2, 1);
        this.weights.splice(p2, 1);

        this.observationsX.splice(p1, 1);
        this.observationsY.splice(p1, 1);
        this.weights.splice(p1, 1);
    }

    public getObservationCount(): number {
        return this.observationsX.length;
    }

    public getState(): { observationsX: number[][], observationsY: number[], weights: number[] } {
        return {
            observationsX: this.observationsX,
            observationsY: this.observationsY,
            weights: this.weights
        };
    }

    public loadState(state: { observationsX: number[][], observationsY: number[], weights?: number[] }) {
        this.observationsX = state.observationsX;
        this.observationsY = state.observationsY;
        // Fallback for older persisted models
        this.weights = state.weights || new Array(this.observationsX.length).fill(1.0);
        this.computeKInverse();
    }

    public getDiagnostics(): {
        observationCount: number;
        conditionNumber: number;
        effectiveNoiseVariance: number;
        maxObservations: number;
        requestedMaxObservations: number;
        syncSafetyCapApplied: boolean;
    } {
        return {
            observationCount: this.observationsX.length,
            conditionNumber: this.conditionNumber,
            effectiveNoiseVariance: this.effectiveNoiseVariance,
            maxObservations: this.maxObservations,
            requestedMaxObservations: this.requestedMaxObservations,
            syncSafetyCapApplied: this.syncSafetyCapApplied,
        };
    }

    /**
     * Map arbitrary dimensions (x_*) into the predictive posterior to obtain 
     * exactly corresponding predictive expected value (mu) and uncertainty (sigma)
     */
    public predict(xStar: number[]): { mu: number; sigma: number } {
        const n = this.observationsX.length;
        if (n === 0) {
            // Pure prior baseline
            return { mu: 0, sigma: Math.sqrt(this.signalVariance) };
        }

        if (!this.cholFactor || !this.alphaVector) {
            throw new Error('GaussianProcess solve state is unavailable despite having observations.');
        }

        // k_* (Kernel distances from new point to all observed points)
        const kStar = this.observationsX.map(xObs => this.rbfKernel(xStar, xObs));

        // Mean equation: mu = k_*^T * alpha where alpha solves K alpha = y
        let mu = 0;
        for (let i = 0; i < n; i++) {
            mu += kStar[i] * this.alphaVector[i];
        }

        // Variance equation: sigma^2 = K(X_*, X_*) - v^T v where L v = k_*
        const kStarStar = this.rbfKernel(xStar, xStar);
        const v = this.forwardSubstitute(this.cholFactor, kStar);
        let varianceReduction = 0;
        for (let i = 0; i < v.length; i++) {
            varianceReduction += v[i] * v[i];
        }

        // Floating point truncation errors might trigger very tiny negatives
        let sigmaSq = kStarStar + this.effectiveNoiseVariance - varianceReduction;
        sigmaSq = Math.max(sigmaSq, 0.0000001);

        return { mu, sigma: Math.sqrt(sigmaSq) };
    }

    /**
     * Kinematic Gradient Auto-Tuning (KGAT)
     * Analytically differentiates the RBF kernel to find the mathematical gradient of the 
     * posterior mean with respect to a specific controllable dimension (e.g. temperature).
     */
    public optimizeKinematicGradient(xStar: number[], kinematicDimensionIndex: number): number {
        const n = this.observationsX.length;
        if (n === 0 || !this.alphaVector) return 0; // No historical gradients to trace

        // 2. Calculate partial derivative of mu w.r.t x_t (temperature)
        let gradient = 0;
        const l2 = this.lengthScale * this.lengthScale;

        for (let i = 0; i < n; i++) {
            const kStarI = this.rbfKernel(xStar, this.observationsX[i]);
            // partial derivative of RBF kernel w.r.t x_t
            // dK/dx_t = k(x*, xi) * ( -(x*_t - xi_t) / l^2 )
            const diffT = xStar[kinematicDimensionIndex] - this.observationsX[i][kinematicDimensionIndex];
            const dK = kStarI * (-diffT / l2);
            gradient += this.alphaVector[i] * dK;
        }

        return gradient;
    }
}
