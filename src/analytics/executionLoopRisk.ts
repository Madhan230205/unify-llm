export {
    AstralDivergenceError as ExecutionLoopDivergenceError,
    assessDynamicLoopRisk as assessExecutionLoopRisk,
    buildEmpiricalTransitionMatrix,
    hasDivergentLoop as hasDivergentExecutionLoop,
    resolveConsensus as solveExecutionConsensus,
    spectralRadius as computeTransitionSpectralRadius,
    type DynamicLoopRiskAssessment,
    type DynamicTransitionObservation,
} from './loopRiskEngine';
