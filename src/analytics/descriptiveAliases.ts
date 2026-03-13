export { KinematicTrajectory as TokenTrajectoryAnalyzer } from './semanticTrajectory';
export { ManifoldExtractor as SemanticFeatureExtractor } from './contextAnalyzer';
export {
    buildH0Persistence as buildTopologyPersistenceDiagram,
    computeTopologicalState as computeSemanticTopologySnapshot,
    computeSlicedWasserstein as computeTopologyDriftDistance,
} from './topologyPersistence';
export {
    assessDynamicLoopRisk as assessExecutionLoopRisk,
    hasDivergentLoop as hasDivergentExecutionLoop,
    AstralDivergenceError as ExecutionLoopDivergenceError,
} from './loopRiskEngine';
export {
    generateHologram as buildSemanticProjection,
    computeRobustSemanticDistance as computeSemanticDriftDistance,
} from './semanticFingerprintEngine';
