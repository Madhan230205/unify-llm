/**
 * Topology Persistence Engine (H₀ Connected Components)
 * 
 * Detects topological concept drift in LLM performance manifolds
 * using persistent homology. Tracks when the performance landscape
 * fractures into disconnected basins, signaling regime change.
 * 
 * Mathematical Foundation:
 *   - Vietoris-Rips filtration: Build simplicial complex as ε grows
 *   - H₀ persistence: Track birth/death of connected components
 *   - Sliced Wasserstein-2 distance: Compare persistence diagrams
 *     SW₂(P,Q) = (1/K) Σ_k W₂(π_k(P), π_k(Q))
 * 
 * Uses Union-Find (Disjoint Set) with path compression + union by rank
 * for O(N · α(N)) amortized component tracking.
 * 
 * Zero dependencies. Pure TypeScript.
 */

export interface PersistencePair {
    birth: number;   // ε at which component was born
    death: number;   // ε at which component merged (Infinity if still alive)
    dimension: number; // Always 0 for H₀
}

export interface TopologicalState {
    diagram: PersistencePair[];
    componentCount: number;
    maxPersistence: number;
    timestamp: number;
}

/**
 * Union-Find (Disjoint Set Union) with path compression and union by rank.
 * Amortized O(α(N)) per operation where α is the inverse Ackermann function.
 */
export class UnionFind {
    private parent: number[];
    private size: number[];
    private birth: number[];
    private componentCount: number;

    constructor(n: number, birthTimes?: number[]) {
        this.parent = new Array(n);
        this.size = new Array(n).fill(1);
        this.birth = birthTimes ? [...birthTimes] : new Array(n).fill(0);
        this.componentCount = n;
        for (let i = 0; i < n; i++) {
            this.parent[i] = i;
        }
    }

    public find(x: number): number {
        if (this.parent[x] !== x) {
            this.parent[x] = this.find(this.parent[x]); // Path compression
        }
        return this.parent[x];
    }

    private compareRoots(rootX: number, rootY: number): number {
        if (this.birth[rootX] !== this.birth[rootY]) {
            return this.birth[rootX] < this.birth[rootY] ? rootX : rootY;
        }
        if (this.size[rootX] !== this.size[rootY]) {
            return this.size[rootX] >= this.size[rootY] ? rootX : rootY;
        }
        return rootX < rootY ? rootX : rootY;
    }

    public unionWithElder(x: number, y: number): { merged: boolean; survivingRoot: number; dyingRoot: number } {
        const rootX = this.find(x);
        const rootY = this.find(y);
        if (rootX === rootY) {
            return { merged: false, survivingRoot: rootX, dyingRoot: rootY };
        }

        const survivingRoot = this.compareRoots(rootX, rootY);
        const dyingRoot = survivingRoot === rootX ? rootY : rootX;
        this.parent[dyingRoot] = survivingRoot;
        this.size[survivingRoot] += this.size[dyingRoot];
        this.componentCount--;
        return { merged: true, survivingRoot, dyingRoot };
    }

    public union(x: number, y: number): boolean {
        return this.unionWithElder(x, y).merged;
    }

    public getBirth(x: number): number {
        return this.birth[this.find(x)];
    }

    public getComponentCount(): number {
        return this.componentCount;
    }
}

/**
 * Euclidean distance between two points.
 */
function euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}

interface Edge {
    i: number;
    j: number;
    dist: number;
}

/**
 * Build H₀ persistence diagram via Vietoris-Rips filtration.
 * 
 * Algorithm:
 * 1. Compute all pairwise distances → edge list
 * 2. Sort edges by distance (ascending)
 * 3. Process edges via Union-Find, recording birth/death of components
 * 
 * Every point is born at ε=0. When two components merge at distance ε,
 * the younger component (higher index representative) dies.
 * 
 * @param points Array of D-dimensional points
 * @returns Persistence diagram (array of birth/death pairs)
 */
export function buildH0Persistence(points: number[][], birthTimes?: number[]): PersistencePair[] {
    const n = points.length;
    if (n === 0) return [];
    if (birthTimes && birthTimes.length !== n) {
        throw new Error('birthTimes must match number of points');
    }

    // Build all pairwise edges
    const edges: Edge[] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            edges.push({ i, j, dist: euclideanDistance(points[i], points[j]) });
        }
    }

    // Sort by distance (Vietoris-Rips filtration order)
    edges.sort((a, b) => a.dist - b.dist);

    const componentBirths = birthTimes ? [...birthTimes] : new Array(n).fill(0);
    const uf = new UnionFind(n, componentBirths);
    const diagram: PersistencePair[] = [];

    for (const edge of edges) {
        const rootI = uf.find(edge.i);
        const rootJ = uf.find(edge.j);
        if (rootI !== rootJ) {
            const merge = uf.unionWithElder(rootI, rootJ);
            diagram.push({
                birth: componentBirths[merge.dyingRoot],
                death: edge.dist,
                dimension: 0,
            });
        }
    }

    // The one surviving component has infinite persistence
    diagram.push({
        birth: Math.min(...componentBirths),
        death: Infinity,
        dimension: 0,
    });

    return diagram;
}

/**
 * Compute the Sliced Wasserstein-2 distance between two persistence diagrams.
 * 
 * Projects both diagrams onto random 1D lines and computes the average
 * 1D Wasserstein-2 distance across K projections.
 * 
 * For H₀ diagrams, finite-persistence pairs are used. Points are represented
 * in birth-death coordinates, and diagonal projections handle unmatched points.
 * 
 * @param P First persistence diagram
 * @param Q Second persistence diagram
 * @param projections Number of random 1D projections (default 50)
 * @param seed Random seed for reproducibility
 */
export function computeSlicedWasserstein(
    P: PersistencePair[],
    Q: PersistencePair[],
    projections: number = 50,
    seed: number = 12345
): number {
    // Filter to finite pairs only (exclude the infinite-persistence component)
    const pFinite = P.filter(p => isFinite(p.death));
    const qFinite = Q.filter(p => isFinite(p.death));

    if (pFinite.length === 0 && qFinite.length === 0) return 0;

    // Convert to birth-death 2D coordinates
    const pCoords = pFinite.map(p => [p.birth, p.death]);
    const qCoords = qFinite.map(p => [p.birth, p.death]);

    // Add diagonal projections for unmatched points (standard TDA padding)
    // Each point projects to its closest point on the diagonal: ((b+d)/2, (b+d)/2)
    const pAugmented = [...pCoords];
    const qAugmented = [...qCoords];

    for (const c of pCoords) {
        const mid = (c[0] + c[1]) / 2;
        qAugmented.push([mid, mid]); // Match to diagonal
    }
    for (const c of qCoords) {
        const mid = (c[0] + c[1]) / 2;
        pAugmented.push([mid, mid]); // Match to diagonal
    }

    // Seeded PRNG
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
        // Random unit direction on the unit circle
        const theta = rand() * 2 * Math.PI;
        const dx = Math.cos(theta);
        const dy = Math.sin(theta);

        // Project all points onto this direction
        const pProjected = pAugmented.map(c => c[0] * dx + c[1] * dy);
        const qProjected = qAugmented.map(c => c[0] * dx + c[1] * dy);

        // Sort projections
        pProjected.sort((a, b) => a - b);
        qProjected.sort((a, b) => a - b);

        // 1D Wasserstein-2: sum of squared differences between sorted projections
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

/**
 * Compute a complete topological state snapshot from a collection of points.
 * Used by PrimRouter to track concept drift in the performance manifold.
 */
export function computeTopologicalState(points: number[][]): TopologicalState {
    const diagram = buildH0Persistence(points);
    const finitePairs = diagram.filter(p => isFinite(p.death));
    const maxPersistence = finitePairs.reduce(
        (max, p) => Math.max(max, p.death - p.birth),
        0
    );

    // Count components alive at the median filtration value
    let medianEpsilon = 0;
    if (finitePairs.length > 0) {
        const deaths = finitePairs.map(p => p.death).sort((a, b) => a - b);
        medianEpsilon = deaths[Math.floor(deaths.length / 2)];
    }

    let alive = 0;
    for (const p of diagram) {
        if (p.birth <= medianEpsilon && p.death > medianEpsilon) alive++;
    }

    return {
        diagram,
        componentCount: alive,
        maxPersistence,
        timestamp: Date.now(),
    };
}
