import { describe, expect, it } from 'vitest';
import {
    HallucinationInterceptionAlgorithm,
    annotateResponseWithInterception,
} from '../src';

describe('Hallucination Interception Algorithm (HIA)', () => {
    it('should emit stream signals after enough token chunks', () => {
        const algorithm = new HallucinationInterceptionAlgorithm(
            'explain how retry middleware reduces transient API failures in production systems',
            { chunkSize: 4, tau: 2, minBaselineSamples: 2 },
        );

        const parts = [
            'retry middleware reduces',
            'transient failures by',
            'adding bounded exponential',
            'backoff and jitter',
        ];

        const signals = parts
            .map(chunk => algorithm.ingestTokenChunk(chunk))
            .filter((value): value is NonNullable<typeof value> => value !== null);

        expect(signals.length).toBeGreaterThan(0);
        expect(typeof signals[0].curvature).toBe('number');
        expect(typeof signals[0].entropy).toBe('number');
    });

    it('should analyze full responses and return an interception signal', () => {
        const algorithm = new HallucinationInterceptionAlgorithm(
            'summarize this architecture with clear bullet points',
            { chunkSize: 5, minBaselineSamples: 1 },
        );

        const signal = algorithm.analyzeResponse(
            'This architecture uses a route execute guard loop with dynamic failover to maintain reliability under model variance and latency spikes.',
        );

        expect(signal.curvature).toBeGreaterThanOrEqual(0);
        expect(signal.drift).toBeGreaterThanOrEqual(0);
        expect(typeof signal.entropySpike).toBe('boolean');
    });

    it('should annotate response metadata with interception outcomes', () => {
        const response = annotateResponseWithInterception(
            { content: 'hello', model: 'demo' },
            {
                shouldAbort: true,
                curvature: 1.2,
                drift: 0.5,
                entropy: 4.8,
                entropySpike: true,
                modalityShift: 0.3,
                retention: 0.02,
                instabilityLift: 0.2,
                topologicalDrift: 0.4,
                topologicalComponents: 3,
                loopSpectralRadius: 1.01,
                loopDivergent: true,
                anomalyScore: 0.92,
                immediateAbort: true,
                reason: 'entropy-spike',
            },
        );

        expect(response.providerSpecific?.hallucinationAborted).toBe(true);
        expect(response.providerSpecific?.semanticEntropySpike).toBe(true);
        expect(response.providerSpecific?.interceptionReason).toBe('entropy-spike');
    });

    it('should reduce anomaly risk for impossible prompts when the response clearly discloses uncertainty', () => {
        const disclosed = new HallucinationInterceptionAlgorithm(
            'What exact stock price will AAPL close at tomorrow?',
            { chunkSize: 8, tau: 1, minBaselineSamples: 1 },
        );

        const fabricated = new HallucinationInterceptionAlgorithm(
            'What exact stock price will AAPL close at tomorrow?',
            { chunkSize: 8, tau: 1, minBaselineSamples: 1 },
        );

        const disclosedSignal = disclosed.analyzeResponse(
            'I cannot know tomorrow\'s exact closing price, and there is no reliable public data that can determine it in advance.',
        );

        const fabricatedSignal = fabricated.analyzeResponse(
            'AAPL will close at exactly 241.73 tomorrow after a late-session rally driven by undisclosed institutional flows.',
        );

        expect(disclosedSignal.anomalyScore).toBeLessThan(fabricatedSignal.anomalyScore);
        expect(fabricatedSignal.shouldAbort).toBe(true);
    });

    it('should avoid forcing an abort for a clear refusal on an impossible factual request', () => {
        const algorithm = new HallucinationInterceptionAlgorithm(
            'What is the private password of the Pentagon Wi-Fi?',
            { chunkSize: 8, tau: 2, minBaselineSamples: 1 },
        );

        const signal = algorithm.analyzeResponse(
            'I cannot provide that information because it is private, sensitive, and not publicly available.',
        );

        expect(signal.shouldAbort).toBe(false);
        expect(signal.anomalyScore).toBeLessThan(0.5);
    });

    it('should penalize evasive refusal on answerable prompts relative to factual answers', () => {
        const refusalAlgo = new HallucinationInterceptionAlgorithm(
            'Who discovered oxygen?',
            { chunkSize: 8, tau: 1, minBaselineSamples: 1 },
        );
        const factualAlgo = new HallucinationInterceptionAlgorithm(
            'Who discovered oxygen?',
            { chunkSize: 8, tau: 1, minBaselineSamples: 1 },
        );

        const refusalSignal = refusalAlgo.analyzeResponse(
            'It is difficult to determine who discovered oxygen with certainty, and this is unknown.',
        );
        const factualSignal = factualAlgo.analyzeResponse(
            'Joseph Priestley discovered oxygen in 1774, and Carl Wilhelm Scheele independently identified it around the same period.',
        );

        expect(refusalSignal.anomalyScore).toBeGreaterThan(factualSignal.anomalyScore);
    });
});
