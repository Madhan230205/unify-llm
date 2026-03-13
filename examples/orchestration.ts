import * as dotenv from 'dotenv';
import {
    Chain,
    JsonOutputParser,
    OpenAIProvider,
    PromptTemplate,
    RunnableModel,
    UnifyClient,
    HolographicVectorStore,
} from '../src';

dotenv.config();

async function main(): Promise<void> {
    const client = new UnifyClient();
    client.registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY));

    const store = new HolographicVectorStore<{ title: string }>();
    await store.addDocuments([
        {
            content: 'Gaussian processes help estimate uncertainty over routing decisions when observations are sparse.',
            metadata: { title: 'GP routing' },
        },
        {
            content: 'Prompt caching reduces repeated token processing cost for large, stable context windows.',
            metadata: { title: 'Prompt caching' },
        },
        {
            content: 'Retry middleware smooths over transient provider failures using bounded exponential backoff.',
            metadata: { title: 'Retries' },
        },
    ]);

    const retrieved = await store.similaritySearch('How do we reduce token cost with repeated context?', 2);
    const context = retrieved
        .map((doc, index) => `Context ${index + 1} (${doc.metadata?.title ?? 'Untitled'}): ${doc.content}`)
        .join('\n');

    const prompt = new PromptTemplate<{ topic: string; context: string }>(
        'You are a precise TypeScript orchestration assistant. Always respond with JSON.',
        'Use the context below to explain {topic}.\n\n{context}\n\nReturn JSON with a single `summary` field.',
    );

    const model = new RunnableModel(client, 'openai', 'gpt-4o-mini', {
        schema: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
            },
            required: ['summary'],
        },
        temperature: 0.2,
    });

    const parser = new JsonOutputParser<{ summary: string }>();

    const chain = Chain.from((variables: { topic: string; context: string }) => prompt.format(variables))
        .pipe(model)
        .pipe(parser);

    const result = await chain.invoke({
        topic: 'prompt caching in LLM systems',
        context,
    });

    console.log(result.summary);
}

void main().catch(console.error);
