export interface PowerIterationResult {
    eigenvalue: number;
    eigenvector: number[];
}

export interface CholeskyAppendResult {
    factor: number[][];
    schurComplement: number;
}

export interface MatrixRuntimeBackend {
    readonly name: string;
    choleskyDecompose(matrix: number[][]): number[][] | null;
    solveLowerTriangular(L: number[][], b: number[]): number[];
    solveUpperTriangularFromLower(L: number[][], y: number[]): number[];
    solveWithCholesky(L: number[][], b: number[]): number[];
    appendCholeskyObservation(L: number[][], crossCovariance: number[], selfCovariance: number): CholeskyAppendResult | null;
    matrixVectorMultiply(M: number[][], v: number[]): number[];
    vectorNorm2(v: number[]): number;
    powerIteration(matrix: number[][], iterations?: number, tolerance?: number): PowerIterationResult;
    solveLinearSystem(matrix: number[][], rhs: number[]): number[];
    invertMatrix(matrix: number[][]): number[][];
}

function cloneMatrix(matrix: number[][]): number[][] {
    return matrix.map(row => [...row]);
}

function dot(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}

const pureTsMatrixRuntime: MatrixRuntimeBackend = {
    name: 'pure-ts-matrix-runtime',

    choleskyDecompose(matrix: number[][]): number[][] | null {
        const n = matrix.length;
        const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                let sum = matrix[i][j];
                for (let k = 0; k < j; k++) {
                    sum -= L[i][k] * L[j][k];
                }

                if (i === j) {
                    if (!(sum > 1e-14) || !Number.isFinite(sum)) {
                        return null;
                    }
                    L[i][j] = Math.sqrt(sum);
                } else {
                    const pivot = L[j][j];
                    if (!(pivot > 1e-14) || !Number.isFinite(pivot)) {
                        return null;
                    }
                    L[i][j] = sum / pivot;
                }
            }
        }

        return L;
    },

    solveLowerTriangular(L: number[][], b: number[]): number[] {
        const n = L.length;
        const y = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            let sum = b[i];
            for (let j = 0; j < i; j++) {
                sum -= L[i][j] * y[j];
            }
            y[i] = sum / L[i][i];
        }
        return y;
    },

    solveUpperTriangularFromLower(L: number[][], y: number[]): number[] {
        const n = L.length;
        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            let sum = y[i];
            for (let j = i + 1; j < n; j++) {
                sum -= L[j][i] * x[j];
            }
            x[i] = sum / L[i][i];
        }
        return x;
    },

    solveWithCholesky(L: number[][], b: number[]): number[] {
        const y = this.solveLowerTriangular(L, b);
        return this.solveUpperTriangularFromLower(L, y);
    },

    appendCholeskyObservation(L: number[][], crossCovariance: number[], selfCovariance: number): CholeskyAppendResult | null {
        if (L.length !== crossCovariance.length) {
            return null;
        }

        const n = L.length;
        const projection = this.solveLowerTriangular(L, crossCovariance);
        let schurComplement = selfCovariance - dot(projection, projection);

        if (!Number.isFinite(schurComplement)) {
            return null;
        }

        const stabilityFloor = Math.max(1e-12, Math.abs(selfCovariance) * 1e-12);
        if (schurComplement < -stabilityFloor) {
            return null;
        }
        schurComplement = Math.max(schurComplement, stabilityFloor);

        const nextFactor = L.map(row => [...row, 0]);
        const appendedRow = Array(n + 1).fill(0);
        for (let i = 0; i < n; i++) {
            appendedRow[i] = projection[i];
        }
        appendedRow[n] = Math.sqrt(schurComplement);
        nextFactor.push(appendedRow);

        return {
            factor: nextFactor,
            schurComplement,
        };
    },

    matrixVectorMultiply(M: number[][], v: number[]): number[] {
        const n = M.length;
        const out = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            let sum = 0;
            for (let j = 0; j < n; j++) {
                sum += M[i][j] * v[j];
            }
            out[i] = sum;
        }
        return out;
    },

    vectorNorm2(v: number[]): number {
        let sum = 0;
        for (const value of v) {
            sum += value * value;
        }
        return Math.sqrt(sum);
    },

    powerIteration(matrix: number[][], iterations: number = 100, tolerance: number = 1e-10): PowerIterationResult {
        const n = matrix.length;
        if (n === 0) {
            return { eigenvalue: 0, eigenvector: [] };
        }

        let v = Array.from({ length: n }, (_, index) => index + 1);
        const initialNorm = this.vectorNorm2(v);
        if (initialNorm > 0) {
            v = v.map(value => value / initialNorm);
        }

        let eigenvalue = 0;

        for (let i = 0; i < iterations; i++) {
            const w = this.matrixVectorMultiply(matrix, v);
            const norm = this.vectorNorm2(w);
            if (norm < 1e-20) {
                return { eigenvalue: 0, eigenvector: new Array(n).fill(0) };
            }

            const nextV = w.map(value => value / norm);
            const nextW = this.matrixVectorMultiply(matrix, nextV);
            const nextEigenvalue = dot(nextV, nextW) / Math.max(dot(nextV, nextV), 1e-20);
            const residual = nextW.map((value, index) => value - (nextEigenvalue * nextV[index]));
            const residualNorm = this.vectorNorm2(residual);

            v = nextV;
            if (Math.abs(nextEigenvalue - eigenvalue) <= tolerance && residualNorm <= Math.max(tolerance, Math.abs(nextEigenvalue) * tolerance)) {
                eigenvalue = nextEigenvalue;
                break;
            }
            eigenvalue = nextEigenvalue;
        }

        return {
            eigenvalue: Math.abs(eigenvalue),
            eigenvector: v,
        };
    },

    solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
        const n = matrix.length;
        if (rhs.length !== n) {
            throw new Error('Linear system dimensions do not align.');
        }

        const A = cloneMatrix(matrix);
        const b = [...rhs];

        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
                    maxRow = k;
                }
            }

            if (Math.abs(A[maxRow][i]) < 1e-12) {
                throw new Error('Matrix is singular and cannot be solved.');
            }

            if (maxRow !== i) {
                [A[i], A[maxRow]] = [A[maxRow], A[i]];
                [b[i], b[maxRow]] = [b[maxRow], b[i]];
            }

            for (let k = i + 1; k < n; k++) {
                const factor = A[k][i] / A[i][i];
                A[k][i] = 0;
                for (let j = i + 1; j < n; j++) {
                    A[k][j] -= factor * A[i][j];
                }
                b[k] -= factor * b[i];
            }
        }

        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            let sum = b[i];
            for (let j = i + 1; j < n; j++) {
                sum -= A[i][j] * x[j];
            }
            x[i] = sum / A[i][i];
        }

        return x;
    },

    invertMatrix(matrix: number[][]): number[][] {
        const n = matrix.length;
        if (n === 0) return [];

        const augmented = matrix.map((row, i) => {
            if (row.length !== n) throw new Error('Matrix must be square.');
            const identity = Array(n).fill(0);
            identity[i] = 1;
            return [...row, ...identity];
        });

        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
                    maxRow = k;
                }
            }

            [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

            const pivot = augmented[i][i];
            if (Math.abs(pivot) < 1e-12) {
                throw new Error('Matrix is singular and cannot be inverted.');
            }

            for (let j = 0; j < 2 * n; j++) {
                augmented[i][j] /= pivot;
            }

            for (let k = 0; k < n; k++) {
                if (k === i) continue;
                const factor = augmented[k][i];
                for (let j = 0; j < 2 * n; j++) {
                    augmented[k][j] -= factor * augmented[i][j];
                }
            }
        }

        return augmented.map(row => row.slice(n));
    },
};

let activeMatrixRuntimeBackend: MatrixRuntimeBackend | null = null;

export function registerMatrixRuntimeBackend(backend: MatrixRuntimeBackend): void {
    activeMatrixRuntimeBackend = backend;
}

export function getMatrixRuntimeBackend(): MatrixRuntimeBackend {
    return activeMatrixRuntimeBackend ?? pureTsMatrixRuntime;
}

export function clearMatrixRuntimeBackend(): void {
    activeMatrixRuntimeBackend = null;
}

export function getDefaultMatrixRuntimeBackendName(): string {
    return pureTsMatrixRuntime.name;
}