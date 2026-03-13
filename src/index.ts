export * from './types';
export * from './core/UnifyClient';

// Preferred plain-English entry points for new integrations
export * from './middlewares/hallucinationGuard';
export * from './routers/complexityThresholdRouter';
export * from './routers/bayesianUtilityRouter';
export * from './routers/costLatencyQualityRouter';
export * from './routers/topologicalDriftRouter';
export * from './analytics/semanticFingerprint';
export * from './analytics/topologyDrift';
export * from './analytics/executionLoopRisk';

// Backwards-compatible aliases for existing users
export { AstralDivergenceError as LoopDivergenceError } from './analytics/loopRiskEngine';
export { createSemanticMomentumGuardian as createSemanticConvergenceGuard } from './middlewares/hallucinationGuard';
export { ComplexityThresholdRouter as EntropyThresholdRouter } from './routers/complexityThresholdRouter';
export { ParetoNavigatorRouter as MultiObjectiveRouter } from './routers/paretoRouter';
export { HallucinationInterceptionAlgorithm as SemanticDriftDetector } from './algorithms/hallucinationInterception';

// Providers
export * from './providers/base';
export * from './providers/openai';
export * from './providers/anthropic';
export * from './providers/gemini';
export * from './providers/ollama';
export * from './providers/aetherion';

// Middlewares
export * from './middlewares/cache';
export * from './middlewares/costTracker';
export * from './middlewares/hallucinationGuard';
export * from './middlewares/rateLimiter';
export * from './middlewares/retry';
export * from './middlewares/hallucinationGuard';

// Orchestration
export * from './orchestration';

// Gateway
export * from './gateway';

// Business layers
export * from './layers';

// Integrations
export * from './integrations';

// Routers
export * from './routers/complexityThresholdEngine';
export * from './routers/bayesianUtilityRouter';
export * from './routers/complexityThresholdRouter';
export * from './routers/costLatencyQualityRouter';
export * from './routers/bayesianUtilityRouter';
export * from './routers/paretoRouter';
export * from './routers/primRouter';
export * from './routers/topologicalDriftRouter';
export * from './routers/adaptiveModelRouter';

// Analytics
export * from './analytics/executionLoopRisk';
export * from './analytics/gaussianProcess';
export * from './analytics/ehvi';
export * from './analytics/topologyPersistence';
export * from './analytics/semanticTrajectory';
export * from './analytics/semanticFingerprintEngine';
export * from './analytics/loopRiskEngine';
export * from './analytics/computeAccelerator';
export * from './analytics/descriptiveAliases';
export * from './analytics/semanticFingerprint';
export * from './analytics/topologyDrift';
export * from './analytics/wasmMatrixRuntime';

// Core algorithms
export * from './algorithms';

// Evaluation helpers
export * from './evaluation';
