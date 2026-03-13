import { ManifoldState } from '../analytics/contextAnalyzer';

/**
 * An exact entry recorded in the router's history.
 */
export interface RecordEntry {
    state: ManifoldState;     // The 3D Topology
    model: string;            // The model that fulfilled the request
    utility: number;          // The calculated utility score (Accuracy - Cost - Latency)
    timestamp: number;
}

/**
 * The standard interface for storing and retrieving topological metric data
 * without forcing specific dependencies like SQLite or Redis on the consumer.
 */
export interface MetricsStore {
    /**
     * Record a completed generation event onto the manifold.
     */
    record(state: ManifoldState, model: string, utility: number): Promise<void>;

    /**
     * Retrieve the `k` nearest historical records to a target state vector
     * to calculate localized expected utility.
     */
    getNearest(target: ManifoldState, k: number): Promise<RecordEntry[]>;

    /**
     * Retrieve all recorded models over time.
     */
    getKnownModels(): Promise<string[]>;
}
