import { CompletionRequest, ParetoNavigatorRouter } from '../src';

async function main(): Promise<void> {
    const router = new ParetoNavigatorRouter(['budget-model', 'balanced-model', 'frontier-model']);

    const historicalRequests: CompletionRequest[] = [
        {
            model: 'auto',
            messages: [{ role: 'user', content: 'Summarize this support ticket in one sentence.' }],
            temperature: 0.2,
        },
        {
            model: 'auto',
            messages: [{ role: 'user', content: 'Convert this incident report into structured JSON with owners and next steps.' }],
            schema: {
                type: 'object',
                properties: {
                    owner: { type: 'string' },
                    steps: { type: 'array', items: { type: 'string' } },
                },
            },
            temperature: 0.4,
        },
    ];

    for (let round = 0; round < 4; round++) {
        router.recordFeedback('budget-model', historicalRequests[0], 220, true, 0.0021);
        router.recordFeedback('balanced-model', historicalRequests[0], 360, true, 0.0048);
        router.recordFeedback('frontier-model', historicalRequests[0], 960, true, 0.0132);

        router.recordFeedback('budget-model', historicalRequests[1], 280, round < 2, 0.0029);
        router.recordFeedback('balanced-model', historicalRequests[1], 430, true, 0.0054);
        router.recordFeedback('frontier-model', historicalRequests[1], 1080, true, 0.0168);
    }

    const request: CompletionRequest = {
        model: 'auto',
        messages: [{ role: 'user', content: 'Return a compact JSON summary of the latest billing incident and recommend next actions.' }],
        schema: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
                actions: { type: 'array', items: { type: 'string' } },
            },
        },
        temperature: 0.3,
    };

    const selected = await router.route(request, {
        minQuality: 0.8,
        maxLatencyMs: 700,
        maxCostUsd: 0.008,
    });

    console.log('Selected model:', selected);
    console.log('Current Pareto front:', router.getParetoFront());
}

void main();