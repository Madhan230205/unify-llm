import { InMemoryStore } from './inMemoryStore';
import { ManifoldState } from '../analytics/contextAnalyzer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A persistent filesystem-backed implementation of the metrics store.
 * Inherits the fast memory lookups of `InMemoryStore` but asynchronously
 * flushes state to disk. Ideal for long-running Node/Express backends.
 */
export class FsStore extends InMemoryStore {
    private filePath: string;
    private saveTimeout: NodeJS.Timeout | null = null;
    private readonly DEBOUNCE_MS = 2000;
    private bayesianState: Record<string, any> = {};

    constructor(filePath: string = path.join(process.cwd(), '.unify-metrics.json')) {
        super();
        this.filePath = filePath;
        this.loadState();
    }

    private loadState() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed.records)) {
                    this.records = parsed.records;
                    for (const r of this.records) {
                        this.knownModels.add(r.model);
                    }
                }
                if (parsed.bayesianState) {
                    this.bayesianState = parsed.bayesianState;
                }
            }
        } catch (e) {
            console.warn(`[Unify] FsStore failed to load learning history: ${(e as Error).message}`);
        }
    }

    private triggerSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        this.saveTimeout = setTimeout(() => {
            try {
                const payload = JSON.stringify({ records: this.records, bayesianState: this.bayesianState }, null, 2);
                const tmpPath = `${this.filePath}.tmp.${Date.now()}`;

                // Write to a temporary file first, then atomically rename to prevent corruption
                fs.writeFile(tmpPath, payload, 'utf-8', (err) => {
                    if (err) {
                        console.error(`[Unify] FsStore failed to write temporary file: ${err.message}`);
                        return;
                    }
                    fs.rename(tmpPath, this.filePath, (renameErr) => {
                        if (renameErr) console.error(`[Unify] FsStore failed to persist learning history (atomic rename): ${renameErr.message}`);
                    });
                });
            } catch (e) {
                // Suppress serialization errors
            }
        }, this.DEBOUNCE_MS);
    }

    public async record(state: ManifoldState, model: string, utility: number): Promise<void> {
        await super.record(state, model, utility);
        this.triggerSave();
    }

    public saveBayesianState(state: Record<string, any>) {
        this.bayesianState = state;
        this.triggerSave();
    }

    public getBayesianState(): Record<string, any> {
        return this.bayesianState;
    }
}
