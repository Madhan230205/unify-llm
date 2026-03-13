import { describe, it, expect } from 'vitest';
import { KinematicTrajectory } from '../src/analytics/semanticTrajectory';
import {
    analyzeSemanticStability,
    analyzeSemanticModality,
    computeRobustSemanticDistance,
    computeSemanticInstabilityRisk,
    getHologramCacheMetrics,
    generateHologram,
    getSemanticModalityDistance,
    resetHologramCaches,
} from '../src/analytics/semanticFingerprintEngine';

describe('Semantic trajectory analysis', () => {
    it('should compute low curvature for a graceful, topically continuous semantic stream', () => {
        const trajectory = new KinematicTrajectory(10000);
        trajectory.pushCoordinate(Array.from(generateHologram('python is a great programming language for data science')));
        trajectory.pushCoordinate(Array.from(generateHologram('using python for machine learning models and neural networks')));
        trajectory.pushCoordinate(Array.from(generateHologram('tensorflow and pytorch make deep learning very easy in python')));

        const kappa = trajectory.getInstantaneousCurvature();
        expect(kappa).toBeGreaterThan(0);
        expect(kappa).toBeLessThan(1.5);
    });

    it('should compute non-zero curvature for an erratic semantic jump', () => {
        const trajectoryErratic = new KinematicTrajectory(10000);
        trajectoryErratic.pushCoordinate(Array.from(generateHologram('python is a great programming language')));
        trajectoryErratic.pushCoordinate(Array.from(generateHologram('using python for machine learning')));
        trajectoryErratic.pushCoordinate(Array.from(generateHologram('chocolate chip cookies oven bake')));

        const kappaErratic = trajectoryErratic.getInstantaneousCurvature();
        expect(kappaErratic).toBeGreaterThan(0);
    });

    it('should generate orthogonal holograms when logical negation is mapped', () => {
        const h1 = generateHologram('the plaintiff is guilty');
        const h2 = generateHologram('the plaintiff is not guilty');

        let diff = 0;
        for (let i = 0; i < 10000; i++) {
            if (h1[i] !== h2[i]) diff++;
        }
        const distance = diff / 10000;
        expect(distance).toBeGreaterThan(0.35);
    });

    it('should compute a deterministic semantic stability envelope', () => {
        const first = analyzeSemanticStability('please explain recursion in javascript with a simple example');
        const second = analyzeSemanticStability('please explain recursion in javascript with a simple example');

        expect(first.projection).toEqual(second.projection);
        expect(first.perturbationCount).toBeGreaterThan(0);
        expect(first.localConditionNumber).toBeGreaterThanOrEqual(0);
        expect(first.semanticJitter).toBeGreaterThanOrEqual(0);
        expect(computeSemanticInstabilityRisk(first)).toBeGreaterThanOrEqual(0);
    });

    it('should keep robust semantic distance lower for paraphrases than topic shifts', () => {
        const paraphraseDistance = computeRobustSemanticDistance(
            'Explain prompt caching for repeated large context windows.',
            'Describe how prompt caching reduces repeated work for large context windows.',
        );
        const topicShiftDistance = computeRobustSemanticDistance(
            'Explain prompt caching for repeated large context windows.',
            'Bake a chocolate cake with buttercream frosting and vanilla.',
        );

        expect(paraphraseDistance).toBeLessThan(topicShiftDistance);
    });

    it('should preserve cross-lingual semantic proximity for shared intent', () => {
        const englishToFrenchWeather = computeRobustSemanticDistance(
            'What is the weather today in Paris?',
            "Quel temps fait-il aujourd'hui à Paris ?",
        );
        const englishToUnrelated = computeRobustSemanticDistance(
            'What is the weather today in Paris?',
            'Bake chocolate cookies at 180 degrees for 12 minutes.',
        );

        expect(englishToFrenchWeather).toBeLessThan(englishToUnrelated);
    });

    it('should expose modality profiles and modality distance', () => {
        const prose = analyzeSemanticModality('Tell me a story about a knight and a dragon.');
        const code = analyzeSemanticModality('function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }');
        const distance = getSemanticModalityDistance(
            'Tell me a story about a knight and a dragon.',
            'function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }',
        );

        expect(prose.prose).toBeGreaterThan(0);
        expect(code.code).toBeGreaterThan(0);
        expect(distance).toBeGreaterThan(0);
    });

    it('should reuse cached trigram and token resonance vectors across repeated generations', () => {
        resetHologramCaches();

        generateHologram('the the weather weather');
        const first = getHologramCacheMetrics();

        generateHologram('the the weather weather');
        const second = getHologramCacheMetrics();

        expect(first.trigramMisses).toBeGreaterThan(0);
        expect(second.tokenHits).toBeGreaterThan(first.tokenHits);
        expect(second.trigramMisses).toBe(first.trigramMisses);
        expect(second.tokenCacheSize).toBeGreaterThan(0);
    });
});
