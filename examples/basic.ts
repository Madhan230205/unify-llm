import { UnifyClient, OpenAIProvider, CacheMiddleware, CostTrackerMiddleware } from '../src';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    const client = new UnifyClient();
    const costTracker = new CostTrackerMiddleware();

    client.registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY));
    client.use(new CacheMiddleware());
    client.use(costTracker);

    console.log("Sending first request...");
    const res1 = await client.generate('openai', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'What is the speed of light?' }],
        temperature: 0.7
    });
    console.log("Response 1:", res1.content);
    console.log("Cached?", res1.providerSpecific?._cached ? "Yes" : "No");
    console.log("Running Cost:", costTracker.getTotalCost());

    console.log("\nSending exact same request...");
    const res2 = await client.generate('openai', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'What is the speed of light?' }],
        temperature: 0.7
    });
    console.log("Response 2:", res2.content);
    console.log("Cached?", res2.providerSpecific?._cached ? "Yes" : "No");
    console.log("Running Cost:", costTracker.getTotalCost());
}

main().catch(console.error);
