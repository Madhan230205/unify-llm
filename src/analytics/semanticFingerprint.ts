export {
    analyzeSemanticModality,
    analyzeSemanticStability,
    computeRobustSemanticDistance as computeSemanticFingerprintDistance,
    computeSemanticInstabilityRisk,
    generateHologram as createSemanticFingerprint,
    getHammingDistance,
    getSemanticModalityDistance,
    projectEpistemic as projectSemanticFingerprint,
    resetHologramCaches,
    getHologramCacheMetrics,
    type SemanticModalityProfile,
    type SemanticStabilityEnvelope,
} from './semanticFingerprintEngine';
