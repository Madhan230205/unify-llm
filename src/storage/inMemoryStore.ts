import { MetricsStore, RecordEntry } from './metricsStore';
import { ManifoldState, ManifoldExtractor } from '../analytics/contextAnalyzer';

/**
 * A zero-dependency In-Memory implementation of the metrics store.
 * Performs brute-force kNN distance sorting on the continuous Space.
 * Ideal for short-lived serverless functions or local development.
 */
export class InMemoryStore implements MetricsStore {
    protected records: RecordEntry[] = [];
    protected knownModels = new Set<string>();

    public async record(state: ManifoldState, model: string, utility: number): Promise<void> {
        this.records.push({
            state,
            model,
            utility,
            timestamp: Date.now()
        });

        // Prevent OOM: Enforce a rolling window limit
        const MAX_RECORDS = 5000;
        if (this.records.length > MAX_RECORDS) {
            this.records.shift(); // Evict oldest
        }

        this.knownModels.add(model);
    }

    public async getNearest(target: ManifoldState, k: number): Promise<RecordEntry[]> {
        if (this.records.length === 0) return [];

        // Brute force distance sorting (very fast up to ~10,000s of points due to V8 JIT)
        const sorted = [...this.records].sort((a, b) => {
            const distA = ManifoldExtractor.distance(target, a.state);
            const distB = ManifoldExtractor.distance(target, b.state);
            return distA - distB;
        });

        return sorted.slice(0, k);
    }

    public async getKnownModels(): Promise<string[]> {
        return Array.from(this.knownModels);
    }
}
