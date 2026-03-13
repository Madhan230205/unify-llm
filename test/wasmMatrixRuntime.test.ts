import { afterEach, describe, expect, it } from 'vitest';
import {
    clearMatrixRuntimeBackend,
    getDefaultMatrixRuntimeBackendName,
    getMatrixRuntimeBackend,
} from '../src/analytics/computeFabric';
import {
    createHybridMatrixRuntimeBackend,
    initializeWasmMatrixRuntime,
    registerWasmMatrixRuntime,
} from '../src/analytics/wasmMatrixRuntime';

describe('wasmMatrixRuntime', () => {
    afterEach(() => {
        clearMatrixRuntimeBackend();
    });

    it('should use Wasm kernels when available and fallback otherwise', () => {
        const fallback = getMatrixRuntimeBackend();

        const hybrid = createHybridMatrixRuntimeBackend(
            {
                name: 'test-wasm-kernel',
                powerIteration: () => ({ eigenvalue: 42, eigenvector: [1, 0] }),
            },
            fallback,
        );

        const matrix = [
            [4, 7],
            [2, 6],
        ];

        const power = hybrid.powerIteration(matrix, 12, 1e-6);
        expect(power.eigenvalue).toBe(42);

        const inverse = hybrid.invertMatrix(matrix);
        expect(inverse[0][0]).toBeCloseTo(0.6, 5);
        expect(inverse[1][1]).toBeCloseTo(0.4, 5);
    });

    it('should register a Wasm runtime backend through direct registration', () => {
        const backend = registerWasmMatrixRuntime({
            name: 'registered-wasm-kernel',
            powerIteration: () => ({ eigenvalue: 7, eigenvector: [1] }),
        });

        expect(backend.name).toBe('registered-wasm-kernel');
        expect(getMatrixRuntimeBackend().name).toBe('registered-wasm-kernel');
    });

    it('should initialize Wasm runtime from async loader and keep fallback on failure', async () => {
        const ok = await initializeWasmMatrixRuntime(async () => ({
            name: 'async-wasm-kernel',
            solveLinearSystem: (_m, rhs) => rhs.map(v => v + 1),
        }));

        expect(ok.enabled).toBe(true);
        expect(ok.backendName).toBe('async-wasm-kernel');
        expect(getMatrixRuntimeBackend().name).toBe('async-wasm-kernel');

        clearMatrixRuntimeBackend();

        const fail = await initializeWasmMatrixRuntime(async () => {
            throw new Error('network unavailable');
        });

        expect(fail.enabled).toBe(false);
        expect(fail.backendName).toBe(getDefaultMatrixRuntimeBackendName());
        expect(fail.reason).toContain('network unavailable');
    });

    it('should reject empty kernel payloads and preserve fallback backend', async () => {
        const result = await initializeWasmMatrixRuntime(async () => ({
            name: 'empty-kernel',
        }));

        expect(result.enabled).toBe(false);
        expect(result.backendName).toBe(getDefaultMatrixRuntimeBackendName());
        expect(result.reason).toContain('No compatible Wasm matrix kernels');
    });
});
