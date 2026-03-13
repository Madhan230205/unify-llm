import { CompletionRequest, createSemanticMomentumGuardian } from '../src';

async function main(): Promise<void> {
    const guard = createSemanticMomentumGuardian({ alpha: 1.2, tau: 2, chunkSize: 6 });

    const request: CompletionRequest = {
        model: 'demo-model',
        messages: [{ role: 'user', content: 'Explain why prompt caching can reduce LLM cost in production systems.' }],
    };

    await guard.wrapGenerate!(request, async () => ({
        model: 'demo-model',
        content: 'Prompt caching reuses repeated context so the provider can skip reprocessing the same tokens every time. That reduces billable prompt work and usually lowers latency for large, repeated contexts.',
    }));

    const stream = guard.wrapStream!(
        { ...request, stream: true },
        async function* () {
            yield { model: 'demo-model', content: 'Prompt caching lowers cost by reusing repeated context across calls. ' };
            yield { model: 'demo-model', content: 'Repeated billing context can be served from cache instead of being fully re-embedded every time. ' };
            yield { model: 'demo-model', content: 'If the response suddenly drifts into gardening or medieval armor, the guard can stop the stream early. ' };
        },
    );

    for await (const chunk of stream) {
        console.log(chunk.content.trim(), chunk.providerSpecific ?? {});
        if (chunk.providerSpecific?.hallucinationAborted) {
            break;
        }
    }

    console.log('Running stats:', guard.getStats());
}

void main();
