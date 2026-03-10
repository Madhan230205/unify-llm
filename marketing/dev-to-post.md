# What happens when Claude goes down mid-sentence? I built a 14KB library that catches the error, hot-swaps to GPT-4o, and finishes the sentence seamlessly.

1. **The Vercel AI SDK Wall:** It's fantastic... if you live in Next.js. But if you want to use it in a background worker, an Express server, or just a pure Node script, you're constantly fighting framework lock-in and weird edge runtime shims.
2. **The LangChain Wall:** You just want to send a string to OpenAI. Before you know it, you are importing `PromptTemplate`, `ChatOpenAI`, `StringOutputParser`, and chaining them together. It's an architecture astronaut's dream, but a nightmare for simple integrations.

Most importantly, both of these tools drag in *massive* dependency trees.

I wanted something different. I wanted an **"anti-framework."**

## Introducing `unify-llm`

[`unify-llm`](https://www.npmjs.com/package/unify-llm) is a zero-dependency, 100% type-safe, universal wrapper for OpenAI, Anthropic, Gemini, and Ollama.

It does exactly one thing: provides a unified `CompletionRequest` and `CompletionResponse` for all major providers using native `fetch`. No massive polyfills, no framework lock-in. 

But I didn't stop at just wrapping the APIs. I mapped out the biggest production failures in AI apps today and built native plug-and-play middleware to solve them—including **The Aetherion Mesh**.

### 1. The Aetherion Mesh (Mid-Stream Hot-Swapping)
Most wrappers can retry a failed request. But if a stream fails *mid-sentence* (e.g. Anthropic disconnects on chunk 50 out of 100), your app crashes or the user gets a broken sentence.
`unify-llm` features a Meta-Provider that intercepts the failure, grabs the partial generation, rewrites the prompt, and hot-swaps the connection to your fallback provider (like OpenAI). The developer's stream loop never breaks. It is 100% transparent.

### 2. Cost Tracking out of the box
Stop checking your OpenAI dashboard every 10 minutes to see if you're bankrupt. `unify-llm` reads the token usage from every response and accurately calculates the USD cost.

```typescript
const costTracker = new CostTrackerMiddleware();
client.use(costTracker);

// ... Run your prompts ...
console.log(`You just spent: $${costTracker.getTotalCost()}`);
```

### 2. Semantic/Exact-Key Caching
Why pay OpenAI twice for the exact same prompt? The built-in `CacheMiddleware` hashes your request and intercepts identical calls before they ever hit the provider. It defaults to an InMemory store, but you can pass a Redis instance in one line of code.

### 3. Rate Limiting
Prevent your backend from accidental infinite loops that spam Anthropic's API. A simple `RateLimiterMiddleware` protects your wallet and your API keys.

## Let's look at the code

To switch from GPT-4o to Claude 3.5 Sonnet, you don't need to rewrite your schema. You just change a string.

```typescript
import { UnifyClient, OpenAIProvider, AnthropicProvider, CacheMiddleware } from 'unify-llm';

const client = new UnifyClient();

// Add your keys (Zero other dependencies required)
client.registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY));
client.registerProvider(new AnthropicProvider(process.env.ANTHROPIC_API_KEY));

// Add caching so identical requests resolve instantly for free
client.use(new CacheMiddleware());

async function run() {
  const req = {
    // Want Gemini instead? Just register the provider and change this to 'gemini-1.5-pro'
    model: 'gpt-4o', 
    messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }]
  };

  // Switch providers simply by changing 'openai' to 'anthropic'
  const response = await client.generate('openai', req);
  console.log(response.content);
}

run();
```

## Built for Reliability
I know that replacing your LLM wrapper requires trust. That's why `unify-llm` is built with:
- **0 Production Dependencies**: We rely solely on native Node/browser APIs.
- **100% Test Coverage**: Every line of code, including error handling edge cases, is covered by Vitest.
- **Strict SemVer**: I will not break your production app.

If you are building Agentic workflows, CLI tools, or just tired of fighting heavy abstractions, give `unify-llm` a shot.

**Check it out on NPM:** [npmjs.com/package/unify-llm](https://www.npmjs.com/package/unify-llm)
**Star the repo:** [github.com/yourusername/unify-llm](https://github.com/yourusername/unify-llm)

I'd love to hear your thoughts or see PRs for new middlewares (telemetry routing, maybe?) let's build the leanest, meanest AI wrapper in TypeScript.
