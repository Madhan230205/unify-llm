import { CompletionRequest } from '../types';
import { ManifoldExtractor, ManifoldState } from '../analytics/contextAnalyzer';
import { PrimRouter } from '../routers/primRouter';

export interface PromptProfile {
    manifold: ManifoldState;
    entropy: number;
    lexicalDensity: number;
    structuralAsymmetry: number;
    routeClass: 'chat' | 'code' | 'data';
}

export interface RouterHealthSnapshot {
    drifting: boolean;
    driftDistance: number;
    topologyKnown: boolean;
    status: 'stable' | 'watch' | 'recalibrating';
}

function aggregatePromptText(request: CompletionRequest): string {
    return request.messages
        .map(message => typeof message.content === 'string' ? message.content : '')
        .join(' ')
        .trim();
}

function classifyRouteClass(state: ManifoldState): PromptProfile['routeClass'] {
    const [entropy, density, asymmetry] = state;

    if (asymmetry >= 0.35 || (entropy >= 4.4 && asymmetry >= 0.2)) {
        return 'code';
    }

    if (density >= 0.7 && entropy >= 4.0) {
        return 'data';
    }

    return 'chat';
}

export function profilePrompt(request: CompletionRequest): PromptProfile {
    const text = aggregatePromptText(request);
    const manifold = ManifoldExtractor.extract(text);

    return {
        manifold,
        entropy: manifold[0],
        lexicalDensity: manifold[1],
        structuralAsymmetry: manifold[2],
        routeClass: classifyRouteClass(manifold),
    };
}

export function inspectRouterHealth(router: PrimRouter): RouterHealthSnapshot {
    const driftDistance = router.getDriftDistance();
    const drifting = router.isDrifting();
    const topologyKnown = router.getTopologicalState() !== null;

    const status: RouterHealthSnapshot['status'] = drifting
        ? 'recalibrating'
        : (driftDistance > 0.25 ? 'watch' : 'stable');

    return {
        drifting,
        driftDistance,
        topologyKnown,
        status,
    };
}
