import { CompletionRequest, PrimRouter } from '../src';

async function main(): Promise<void> {
    const router = new PrimRouter(['budget-model', 'frontier-model'], {
        driftThreshold: 0.4,
        maxRecords: 200,
    });

    const faqRequest: CompletionRequest = {
        model: 'auto',
        messages: [{ role: 'user', content: 'Answer this customer FAQ about API rate limits.' }],
        temperature: 0.2,
    };

    const codeRequest: CompletionRequest = {
        model: 'auto',
        messages: [{ role: 'user', content: 'Review this TypeScript middleware patch and suggest fixes.' }],
        tools: [{ name: 'diffInspector', description: 'Inspect a patch', schema: { type: 'object' } }],
        temperature: 0.4,
    };

    for (let i = 0; i < 12; i++) {
        router.recordFeedback('budget-model', faqRequest, 180, true, 0.0015);
        router.recordFeedback('frontier-model', faqRequest, 820, true, 0.011);
    }

    for (let i = 0; i < 12; i++) {
        router.recordFeedback('budget-model', codeRequest, 260, i < 4, 0.0024);
        router.recordFeedback('frontier-model', codeRequest, 1010, true, 0.0154);
    }

    const selected = await router.route(codeRequest);

    console.log('Selected model after topology update:', selected);
    console.log('Drift detected:', router.isDrifting());
    console.log('Current drift distance:', router.getDriftDistance());
}

void main();