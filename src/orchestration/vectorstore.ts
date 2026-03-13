import { generateHologram, getHammingDistance } from '../analytics/semanticFingerprintEngine';

export interface Document<TMetadata = Record<string, unknown>> {
    content: string;
    metadata?: TMetadata;
    vector?: Int8Array;
}

export interface ScoredDocument<TMetadata = Record<string, unknown>> {
    document: Document<TMetadata>;
    distance: number;
}

/**
 * A zero-dependency retrieval store backed by holographic semantic fingerprints.
 */
export class HolographicVectorStore<TMetadata = Record<string, unknown>> {
    private readonly documents: Document<TMetadata>[] = [];

    public async addDocuments(docs: ReadonlyArray<Document<TMetadata>>): Promise<void> {
        for (const doc of docs) {
            this.documents.push({
                ...doc,
                vector: doc.vector ?? generateHologram(doc.content),
            });
        }
    }

    public async similaritySearch(query: string, k: number = 4): Promise<Document<TMetadata>[]> {
        const scored = await this.similaritySearchWithScore(query, k);
        return scored.map(entry => entry.document);
    }

    public async similaritySearchWithScore(query: string, k: number = 4): Promise<ScoredDocument<TMetadata>[]> {
        const queryVector = generateHologram(query);

        return this.documents
            .map((document) => ({
                document,
                distance: getHammingDistance(queryVector, document.vector ?? generateHologram(document.content)),
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, Math.max(0, k));
    }

    public get size(): number {
        return this.documents.length;
    }
}