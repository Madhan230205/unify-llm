import { Worker } from 'node:worker_threads';
import { computeEHVI, GPPrediction, ParetoPoint } from './ehvi';
import { PersistencePair, TopologicalState, computeSlicedWasserstein, computeTopologicalState } from './topologyPersistence';

type ValveTask =
    | {
        type: 'ehvi';
        paretoFront: ParetoPoint[];
        gpPredictions: GPPrediction[];
        ref: number[];
        samples: number;
        seed: number;
    }
    | {
        type: 'topology';
        points: number[][];
        baselineDiagram: PersistencePair[] | null;
        projections: number;
        seed: number;
    };

export interface ElasticComputeAccelerator {
    name: string;
    computeEHVI?: (task: {
        paretoFront: ParetoPoint[];
        gpPredictions: GPPrediction[];
        ref: number[];
        samples: number;
        seed: number;
    }) => Promise<[string, number][]> | [string, number][];
    computeTopology?: (task: {
        points: number[][];
        baselineDiagram: PersistencePair[] | null;
        projections: number;
        seed: number;
    }) => Promise<TopologyDriftSnapshot> | TopologyDriftSnapshot;
}

export type ComputeAcceleratorBackend = ElasticComputeAccelerator;

type SerializedEhviTask = {
    type: 'ehvi';
    transport: 'binary';
    objectiveBuffer: ArrayBuffer;
    frontCount: number;
    candidateCount: number;
    objectiveDimensions: number;
    modelIds: string[];
    muBuffer: ArrayBuffer;
    sigmaBuffer: ArrayBuffer;
    ref: number[];
    samples: number;
    seed: number;
};

type SerializedTopologyTask = {
    type: 'topology';
    transport: 'binary';
    pointBuffer: ArrayBuffer;
    pointCount: number;
    pointDimensions: number;
    baselineBuffer: ArrayBuffer | null;
    baselineCount: number;
    projections: number;
    seed: number;
};

type WorkerValveTask = ValveTask | SerializedEhviTask | SerializedTopologyTask;

export interface ValveTaskEnvelope {
    task: WorkerValveTask;
    transferList: ArrayBuffer[];
}

interface PendingTask {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}

interface WorkerResponse<T> {
    id: number;
    result?: T;
    error?: string;
}

export interface TopologyDriftSnapshot {
    state: TopologicalState;
    driftDistance: number;
}

const TOPOLOGY_OFFLOAD_POINT_THRESHOLD = 128;
const EHVI_OFFLOAD_COMPLEXITY_THRESHOLD = 2000;
const TOPOLOGY_CORESET_MAX_POINTS = 192;
const EHVI_MIN_SAMPLES = 64;
const EHVI_TARGET_COMPLEXITY = 4000;
const DISABLE_WORKERS = process.env.UNIFY_DISABLE_WORKERS === '1';
let activeAccelerator: ElasticComputeAccelerator | null = null;

export function registerElasticComputeAccelerator(accelerator: ElasticComputeAccelerator | null): void {
    activeAccelerator = accelerator;
}

export const registerComputeAccelerator = registerElasticComputeAccelerator;

export function getElasticComputeAccelerator(): ElasticComputeAccelerator | null {
    return activeAccelerator;
}

export const getComputeAccelerator = getElasticComputeAccelerator;

function flattenMatrix(matrix: number[][]): Float64Array {
    if (matrix.length === 0) {
        return new Float64Array(0);
    }

    const columns = matrix[0]?.length ?? 0;
    const flattened = new Float64Array(matrix.length * columns);
    let offset = 0;

    for (const row of matrix) {
        for (let i = 0; i < columns; i++) {
            flattened[offset++] = row[i] ?? 0;
        }
    }

    return flattened;
}

function flattenDiagram(diagram: PersistencePair[]): Float64Array {
    const flattened = new Float64Array(diagram.length * 3);
    let offset = 0;

    for (const pair of diagram) {
        flattened[offset++] = pair.birth;
        flattened[offset++] = pair.death;
        flattened[offset++] = pair.dimension;
    }

    return flattened;
}

function toOwnedArrayBuffer(view: Float64Array): ArrayBuffer {
    const owned = new ArrayBuffer(view.byteLength);
    new Uint8Array(owned).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return owned;
}

export function createValveTaskEnvelope(task: ValveTask): ValveTaskEnvelope {
    if (task.type === 'ehvi') {
        const objectiveDimensions = task.ref.length;
        const frontObjectives = flattenMatrix(task.paretoFront.map(point => point.objectives));
        const muMatrix = flattenMatrix(task.gpPredictions.map(prediction => prediction.mu));
        const sigmaMatrix = flattenMatrix(task.gpPredictions.map(prediction => prediction.sigma));
        const objectiveBuffer = toOwnedArrayBuffer(frontObjectives);
        const muBuffer = toOwnedArrayBuffer(muMatrix);
        const sigmaBuffer = toOwnedArrayBuffer(sigmaMatrix);

        return {
            task: {
                type: 'ehvi',
                transport: 'binary',
                objectiveBuffer,
                frontCount: task.paretoFront.length,
                candidateCount: task.gpPredictions.length,
                objectiveDimensions,
                modelIds: task.gpPredictions.map(prediction => prediction.modelId),
                muBuffer,
                sigmaBuffer,
                ref: task.ref,
                samples: task.samples,
                seed: task.seed,
            },
            transferList: [objectiveBuffer, muBuffer, sigmaBuffer],
        };
    }

    const pointDimensions = task.points[0]?.length ?? 0;
    const points = flattenMatrix(task.points);
    const baseline = task.baselineDiagram ? flattenDiagram(task.baselineDiagram) : null;
    const pointBuffer = toOwnedArrayBuffer(points);
    const baselineBuffer = baseline ? toOwnedArrayBuffer(baseline) : null;

    return {
        task: {
            type: 'topology',
            transport: 'binary',
            pointBuffer,
            pointCount: task.points.length,
            pointDimensions,
            baselineBuffer,
            baselineCount: task.baselineDiagram?.length ?? 0,
            projections: task.projections,
            seed: task.seed,
        },
        transferList: baselineBuffer ? [pointBuffer, baselineBuffer] : [pointBuffer],
    };
}

const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');

function dominates(a, b) {
  let strictlyBetter = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false;
    if (a[i] > b[i]) strictlyBetter = true;
  }
  return strictlyBetter;
}

function findParetoFront(points) {
  const front = [];
  for (let i = 0; i < points.length; i++) {
    let isDominated = false;
    for (let j = 0; j < points.length; j++) {
      if (i !== j && dominates(points[j].objectives, points[i].objectives)) {
        isDominated = true;
        break;
      }
    }
    if (!isDominated) front.push(points[i]);
  }
  return front;
}

function computeHypervolume2D(points, ref) {
  const valid = points.filter(p => p[0] > ref[0] && p[1] > ref[1]);
  if (valid.length === 0) return 0;
  valid.sort((a, b) => b[0] - a[0]);
  let volume = 0;
  let prevY = ref[1];
  for (const p of valid) {
    if (p[1] > prevY) {
      volume += (p[0] - ref[0]) * (p[1] - prevY);
      prevY = p[1];
    }
  }
  return volume;
}

function computeHypervolumeND(points, ref) {
  if (points.length === 0) return 0;
  const d = ref.length;
  if (d === 1) {
    let maxVal = -Infinity;
    for (const p of points) if (p[0] > maxVal) maxVal = p[0];
    return Math.max(0, maxVal - ref[0]);
  }

  const sorted = [...points]
    .filter(p => p.every((value, index) => value > ref[index]))
    .sort((a, b) => b[d - 1] - a[d - 1]);

  if (sorted.length === 0) return 0;

  let volume = 0;
  let prevSlice = ref[d - 1];
  for (let k = sorted.length - 1; k >= 0; k--) {
    const height = sorted[k][d - 1] - prevSlice;
    if (height <= 0) continue;
    const activeProjected = [];
    const subRef = ref.slice(0, d - 1);
    for (let j = 0; j <= k; j++) activeProjected.push(sorted[j].slice(0, d - 1));
    const baseArea = d - 1 === 2 ? computeHypervolume2D(activeProjected, subRef) : computeHypervolumeND(activeProjected, subRef);
    volume += baseArea * height;
    prevSlice = sorted[k][d - 1];
  }
  return volume;
}

function computeHypervolume(points, ref) {
  if (points.length === 0) return 0;
  const d = ref.length;
  if (d === 1) {
    let maxVal = -Infinity;
    for (const p of points) if (p[0] > maxVal) maxVal = p[0];
    return Math.max(0, maxVal - ref[0]);
  }
  if (d === 2) return computeHypervolume2D(points, ref);
  return computeHypervolumeND(points, ref);
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(mu, sigma, rand) {
  const u1 = rand();
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-15)) * Math.cos(2 * Math.PI * u2);
  return mu + sigma * z;
}

function standardNormal(rand) {
  const u1 = rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1 + 1e-15)) * Math.cos(2 * Math.PI * u2);
}

function computeEHVI(task) {
  const rand = mulberry32(task.seed);
  const front = findParetoFront(task.paretoFront);
  const frontObjectives = front.map(p => p.objectives);
  const baseHV = computeHypervolume(frontObjectives, task.ref);
  const entries = [];
  for (const pred of task.gpPredictions) {
    let totalImprovement = 0;
    const pairedSamples = Math.floor(task.samples / 2);
    for (let s = 0; s < pairedSamples; s++) {
      const sampleA = [];
      const sampleB = [];
      for (let j = 0; j < task.ref.length; j++) {
        const z = standardNormal(rand);
        sampleA.push(pred.mu[j] + pred.sigma[j] * z);
        sampleB.push(pred.mu[j] - pred.sigma[j] * z);
      }

      const hvA = computeHypervolume([...frontObjectives, sampleA], task.ref);
      const hvB = computeHypervolume([...frontObjectives, sampleB], task.ref);
      totalImprovement += Math.max(0, hvA - baseHV);
      totalImprovement += Math.max(0, hvB - baseHV);
    }

    if (task.samples % 2 === 1) {
      const sample = [];
      for (let j = 0; j < task.ref.length; j++) {
        sample.push(normalSample(pred.mu[j], pred.sigma[j], rand));
      }
      const hv = computeHypervolume([...frontObjectives, sample], task.ref);
      totalImprovement += Math.max(0, hv - baseHV);
    }

    entries.push([pred.modelId, totalImprovement / task.samples]);
  }
  return entries;
}

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

class UnionFind {
  constructor(n) {
    this.parent = new Array(n);
    this.rank = new Array(n).fill(0);
    this.componentCount = n;
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(x, y) {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return false;
    if (this.rank[rootX] < this.rank[rootY]) this.parent[rootX] = rootY;
    else if (this.rank[rootX] > this.rank[rootY]) this.parent[rootY] = rootX;
    else {
      this.parent[rootY] = rootX;
      this.rank[rootX]++;
    }
    this.componentCount--;
    return true;
  }
}

function buildH0Persistence(points) {
  const n = points.length;
  if (n === 0) return [];
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({ i, j, dist: euclideanDistance(points[i], points[j]) });
    }
  }
  edges.sort((a, b) => a.dist - b.dist);
  const uf = new UnionFind(n);
  const birthTime = new Array(n).fill(0);
  const diagram = [];
  for (const edge of edges) {
    const rootI = uf.find(edge.i);
    const rootJ = uf.find(edge.j);
    if (rootI !== rootJ) {
      const dying = Math.max(rootI, rootJ);
      const surviving = Math.min(rootI, rootJ);
      diagram.push({ birth: birthTime[dying], death: edge.dist, dimension: 0 });
      uf.union(surviving, dying);
    }
  }
  diagram.push({ birth: 0, death: Infinity, dimension: 0 });
  return diagram;
}

function computeSlicedWasserstein(P, Q, projections, seed) {
  const pFinite = P.filter(p => Number.isFinite(p.death));
  const qFinite = Q.filter(p => Number.isFinite(p.death));
  if (pFinite.length === 0 && qFinite.length === 0) return 0;
  const pCoords = pFinite.map(p => [p.birth, p.death]);
  const qCoords = qFinite.map(p => [p.birth, p.death]);
  const pAugmented = [...pCoords];
  const qAugmented = [...qCoords];
  for (const c of pCoords) {
    const mid = (c[0] + c[1]) / 2;
    qAugmented.push([mid, mid]);
  }
  for (const c of qCoords) {
    const mid = (c[0] + c[1]) / 2;
    pAugmented.push([mid, mid]);
  }
  let s = seed;
  const rand = () => {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let totalDistance = 0;
  for (let k = 0; k < projections; k++) {
    const theta = rand() * 2 * Math.PI;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const pProjected = pAugmented.map(c => c[0] * dx + c[1] * dy).sort((a, b) => a - b);
    const qProjected = qAugmented.map(c => c[0] * dx + c[1] * dy).sort((a, b) => a - b);
    const len = Math.min(pProjected.length, qProjected.length);
    let w2Squared = 0;
    for (let i = 0; i < len; i++) {
      const diff = pProjected[i] - qProjected[i];
      w2Squared += diff * diff;
    }
    totalDistance += Math.sqrt(w2Squared / (len || 1));
  }
  return totalDistance / projections;
}

function computeTopologicalState(points) {
  const diagram = buildH0Persistence(points);
  const finitePairs = diagram.filter(p => Number.isFinite(p.death));
  const maxPersistence = finitePairs.reduce((max, p) => Math.max(max, p.death - p.birth), 0);
  let medianEpsilon = 0;
  if (finitePairs.length > 0) {
    const deaths = finitePairs.map(p => p.death).sort((a, b) => a - b);
    medianEpsilon = deaths[Math.floor(deaths.length / 2)];
  }
  let alive = 0;
  for (const p of diagram) {
    if (p.birth <= medianEpsilon && p.death > medianEpsilon) alive++;
  }
  return { diagram, componentCount: alive, maxPersistence, timestamp: Date.now() };
}

function rehydrateMatrix(buffer, rowCount, columnCount) {
  const raw = new Float64Array(buffer);
  const matrix = [];
  for (let row = 0; row < rowCount; row++) {
    const start = row * columnCount;
    const values = [];
    for (let column = 0; column < columnCount; column++) {
      values.push(raw[start + column]);
    }
    matrix.push(values);
  }
  return matrix;
}

function rehydrateDiagram(buffer, pairCount) {
  if (!buffer) return null;
  const raw = new Float64Array(buffer);
  const diagram = [];
  for (let index = 0; index < pairCount; index++) {
    const offset = index * 3;
    diagram.push({
      birth: raw[offset],
      death: raw[offset + 1],
      dimension: raw[offset + 2],
    });
  }
  return diagram;
}

function rehydrateEhviTask(task) {
  const paretoObjectives = rehydrateMatrix(task.objectiveBuffer, task.frontCount, task.objectiveDimensions);
  const paretoFront = paretoObjectives.map((objectives, index) => ({
    modelId: 'front-' + index,
    objectives,
  }));
  const muMatrix = rehydrateMatrix(task.muBuffer, task.candidateCount, task.objectiveDimensions);
  const sigmaMatrix = rehydrateMatrix(task.sigmaBuffer, task.candidateCount, task.objectiveDimensions);
  const gpPredictions = muMatrix.map((mu, index) => ({
    modelId: task.modelIds[index],
    mu,
    sigma: sigmaMatrix[index],
  }));
  return {
    type: 'ehvi',
    paretoFront,
    gpPredictions,
    ref: task.ref,
    samples: task.samples,
    seed: task.seed,
  };
}

function rehydrateTopologyTask(task) {
  return {
    type: 'topology',
    points: rehydrateMatrix(task.pointBuffer, task.pointCount, task.pointDimensions),
    baselineDiagram: rehydrateDiagram(task.baselineBuffer, task.baselineCount),
    projections: task.projections,
    seed: task.seed,
  };
}

parentPort.on('message', (message) => {
  const { id, task } = message;
  try {
    if (task.type === 'ehvi') {
      const hydrated = task.transport === 'binary' ? rehydrateEhviTask(task) : task;
      const result = computeEHVI(hydrated);
      parentPort.postMessage({ id, result });
      return;
    }
    if (task.type === 'topology') {
      const hydrated = task.transport === 'binary' ? rehydrateTopologyTask(task) : task;
      const state = computeTopologicalState(hydrated.points);
      const driftDistance = hydrated.baselineDiagram ? computeSlicedWasserstein(hydrated.baselineDiagram, state.diagram, hydrated.projections, hydrated.seed) : 0;
      parentPort.postMessage({ id, result: { state, driftDistance } });
      return;
    }
    throw new Error('Unknown valve task type');
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
`;

class ElasticComputeValve {
    private worker: Worker | null = null;
    private pending = new Map<number, PendingTask>();
    private nextId = 1;
    private workerDisabled = DISABLE_WORKERS;

    private ensureWorker(): Worker | null {
        if (this.workerDisabled) return null;
        if (this.worker) return this.worker;

        try {
            this.worker = new Worker(WORKER_SOURCE, { eval: true });
            this.worker.on('message', (message: WorkerResponse<unknown>) => {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) {
                    pending.reject(new Error(message.error));
                    return;
                }
                pending.resolve(message.result);
            });
            this.worker.on('error', (error) => {
                for (const pending of this.pending.values()) {
                    pending.reject(error);
                }
                this.pending.clear();
                this.worker = null;
                this.workerDisabled = true;
            });
            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    for (const pending of this.pending.values()) {
                        pending.reject(new Error(`ElasticComputeValve worker exited with code ${code}`));
                    }
                    this.pending.clear();
                }
                this.worker = null;
            });
        } catch {
            this.workerDisabled = true;
            this.worker = null;
        }

        return this.worker;
    }

    public async execute<T>(task: ValveTask, fallback: () => T): Promise<T> {
        const worker = this.ensureWorker();
        if (!worker) {
            return fallback();
        }

        const envelope = createValveTaskEnvelope(task);

        return new Promise<T>((resolve, reject) => {
            const id = this.nextId++;
            this.pending.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
            });
            worker.postMessage({ id, task: envelope.task }, envelope.transferList);
        }).catch(() => fallback());
    }
}

const valve = new ElasticComputeValve();

function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function squaredDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return sum;
}

export function compressTopologyPoints(points: number[][], maxPoints: number = TOPOLOGY_CORESET_MAX_POINTS, seed: number = 12345): number[][] {
    if (points.length <= maxPoints) {
        return points;
    }

    const rand = mulberry32(seed);
    const n = points.length;
    const selected: number[] = [];
    const used = new Array(n).fill(false);
    const minDistSq = new Array(n).fill(Number.POSITIVE_INFINITY);

    let firstIndex = Math.floor(rand() * n);
    if (firstIndex < 0 || firstIndex >= n) {
        firstIndex = 0;
    }

    selected.push(firstIndex);
    used[firstIndex] = true;

    for (let i = 0; i < n; i++) {
        if (i === firstIndex) continue;
        minDistSq[i] = squaredDistance(points[i], points[firstIndex]);
    }

    while (selected.length < maxPoints) {
        let bestIndex = -1;
        let bestDistance = -Infinity;

        for (let i = 0; i < n; i++) {
            if (!used[i] && minDistSq[i] > bestDistance) {
                bestDistance = minDistSq[i];
                bestIndex = i;
            }
        }

        if (bestIndex === -1) {
            break;
        }

        selected.push(bestIndex);
        used[bestIndex] = true;

        for (let i = 0; i < n; i++) {
            if (used[i]) continue;
            const d = squaredDistance(points[i], points[bestIndex]);
            if (d < minDistSq[i]) {
                minDistSq[i] = d;
            }
        }
    }

    return selected.map(index => points[index]);
}

export function shouldOffloadTopology(points: number[][]): boolean {
    return points.length >= TOPOLOGY_OFFLOAD_POINT_THRESHOLD;
}

export function shouldOffloadEHVI(paretoFront: ParetoPoint[], gpPredictions: GPPrediction[], samples: number): boolean {
    const effectiveFrontSize = Math.max(1, paretoFront.length);
    return effectiveFrontSize * Math.max(1, gpPredictions.length) * Math.max(1, samples) >= EHVI_OFFLOAD_COMPLEXITY_THRESHOLD;
}

export function computeAdaptiveEHVISamples(paretoFront: ParetoPoint[], gpPredictions: GPPrediction[], requestedSamples: number): number {
    const front = Math.max(1, paretoFront.length);
    const candidates = Math.max(1, gpPredictions.length);
    const requested = Math.max(1, requestedSamples);
    const complexity = front * candidates * requested;

    if (complexity <= EHVI_TARGET_COMPLEXITY) {
        return requested;
    }

    const scale = Math.sqrt(EHVI_TARGET_COMPLEXITY / complexity);
    const budgeted = Math.floor(requested * scale);
    return Math.min(requested, Math.max(EHVI_MIN_SAMPLES, budgeted));
}

export async function computeEHVIAdaptive(
    paretoFront: ParetoPoint[],
    gpPredictions: GPPrediction[],
    ref: number[] = [0, -10, -10],
    samples: number = 200,
    seed: number = 42,
): Promise<Map<string, number>> {
    const adaptiveSamples = computeAdaptiveEHVISamples(paretoFront, gpPredictions, samples);
    const fallback = () => computeEHVI(paretoFront, gpPredictions, ref, adaptiveSamples, seed);

    if (activeAccelerator?.computeEHVI) {
        try {
            const entries = await activeAccelerator.computeEHVI({
                paretoFront,
                gpPredictions,
                ref,
                samples: adaptiveSamples,
                seed,
            });
            return new Map(entries);
        } catch {
            // Fall through to valve/worker/local fallback.
        }
    }

    if (!shouldOffloadEHVI(paretoFront, gpPredictions, samples)) {
        return fallback();
    }

    const entries = await valve.execute<[string, number][]>(
        {
            type: 'ehvi',
            paretoFront,
            gpPredictions,
            ref,
            samples: adaptiveSamples,
            seed,
        },
        () => Array.from(fallback().entries()),
    );

    return new Map(entries);
}

export async function computeTopologyDriftAdaptive(
    points: number[][],
    baselineDiagram: PersistencePair[] | null,
    projections: number = 50,
    seed: number = 12345,
): Promise<TopologyDriftSnapshot> {
    const compressedPoints = compressTopologyPoints(points, TOPOLOGY_CORESET_MAX_POINTS, seed);

    const fallback = (): TopologyDriftSnapshot => {
        const state = computeTopologicalState(compressedPoints);
        const driftDistance = baselineDiagram
            ? computeSlicedWasserstein(baselineDiagram, state.diagram, projections, seed)
            : 0;
        return { state, driftDistance };
    };

    if (activeAccelerator?.computeTopology) {
        try {
            return await activeAccelerator.computeTopology({
                points: compressedPoints,
                baselineDiagram,
                projections,
                seed,
            });
        } catch {
            // Fall through to valve/worker/local fallback.
        }
    }

    if (!shouldOffloadTopology(points)) {
        return fallback();
    }

    return valve.execute<TopologyDriftSnapshot>(
        {
            type: 'topology',
            points: compressedPoints,
            baselineDiagram,
            projections,
            seed,
        },
        fallback,
    );
}
