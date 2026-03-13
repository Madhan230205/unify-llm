import {
    MatrixRuntimeBackend,
    PowerIterationResult,
    getMatrixRuntimeBackend,
    registerMatrixRuntimeBackend,
} from './computeFabric';

export interface WasmMatrixKernelExports {
    readonly name?: string;
    powerIteration?: (matrix: number[][], iterations?: number, tolerance?: number) => PowerIterationResult;
    invertMatrix?: (matrix: number[][]) => number[][];
    solveLinearSystem?: (matrix: number[][], rhs: number[]) => number[];
    choleskyDecompose?: (matrix: number[][]) => number[][] | null;
    solveLowerTriangular?: (L: number[][], b: number[]) => number[];
    solveUpperTriangularFromLower?: (L: number[][], y: number[]) => number[];
    solveWithCholesky?: (L: number[][], b: number[]) => number[];
    appendCholeskyObservation?: (L: number[][], crossCovariance: number[], selfCovariance: number) => {
        factor: number[][];
        schurComplement: number;
    } | null;
    matrixVectorMultiply?: (M: number[][], v: number[]) => number[];
    vectorNorm2?: (v: number[]) => number;
}

export interface WasmRuntimeInitializationResult {
    enabled: boolean;
    backendName: string;
    reason?: string;
}

export function createHybridMatrixRuntimeBackend(
    kernels: WasmMatrixKernelExports,
    fallback: MatrixRuntimeBackend = getMatrixRuntimeBackend(),
): MatrixRuntimeBackend {
    const backendName = kernels.name ?? 'wasm-hybrid-matrix-runtime';

    return {
        name: backendName,

        choleskyDecompose(matrix: number[][]): number[][] | null {
            return kernels.choleskyDecompose?.(matrix) ?? fallback.choleskyDecompose(matrix);
        },

        solveLowerTriangular(L: number[][], b: number[]): number[] {
            return kernels.solveLowerTriangular?.(L, b) ?? fallback.solveLowerTriangular(L, b);
        },

        solveUpperTriangularFromLower(L: number[][], y: number[]): number[] {
            return kernels.solveUpperTriangularFromLower?.(L, y) ?? fallback.solveUpperTriangularFromLower(L, y);
        },

        solveWithCholesky(L: number[][], b: number[]): number[] {
            return kernels.solveWithCholesky?.(L, b) ?? fallback.solveWithCholesky(L, b);
        },

        appendCholeskyObservation(L: number[][], crossCovariance: number[], selfCovariance: number) {
            return kernels.appendCholeskyObservation?.(L, crossCovariance, selfCovariance)
                ?? fallback.appendCholeskyObservation(L, crossCovariance, selfCovariance);
        },

        matrixVectorMultiply(M: number[][], v: number[]): number[] {
            return kernels.matrixVectorMultiply?.(M, v) ?? fallback.matrixVectorMultiply(M, v);
        },

        vectorNorm2(v: number[]): number {
            return kernels.vectorNorm2?.(v) ?? fallback.vectorNorm2(v);
        },

        powerIteration(matrix: number[][], iterations?: number, tolerance?: number): PowerIterationResult {
            return kernels.powerIteration?.(matrix, iterations, tolerance)
                ?? fallback.powerIteration(matrix, iterations, tolerance);
        },

        solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
            return kernels.solveLinearSystem?.(matrix, rhs) ?? fallback.solveLinearSystem(matrix, rhs);
        },

        invertMatrix(matrix: number[][]): number[][] {
            return kernels.invertMatrix?.(matrix) ?? fallback.invertMatrix(matrix);
        },
    };
}

export function registerWasmMatrixRuntime(kernels: WasmMatrixKernelExports): MatrixRuntimeBackend {
    const fallback = getMatrixRuntimeBackend();
    const hybrid = createHybridMatrixRuntimeBackend(kernels, fallback);
    registerMatrixRuntimeBackend(hybrid);
    return hybrid;
}

export async function initializeWasmMatrixRuntime(
    loader: () => Promise<WasmMatrixKernelExports>,
): Promise<WasmRuntimeInitializationResult> {
    const fallback = getMatrixRuntimeBackend();

    try {
        const kernels = await loader();
        const hasAnyKernel = Boolean(
            kernels.powerIteration
            || kernels.invertMatrix
            || kernels.solveLinearSystem
            || kernels.choleskyDecompose,
        );

        if (!hasAnyKernel) {
            return {
                enabled: false,
                backendName: fallback.name,
                reason: 'No compatible Wasm matrix kernels were exported by the loader.',
            };
        }

        const backend = createHybridMatrixRuntimeBackend(kernels, fallback);
        registerMatrixRuntimeBackend(backend);

        return {
            enabled: true,
            backendName: backend.name,
        };
    } catch (error) {
        return {
            enabled: false,
            backendName: fallback.name,
            reason: error instanceof Error ? error.message : 'Unknown Wasm initialization failure.',
        };
    }
}
