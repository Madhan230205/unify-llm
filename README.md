<div align="center">
  <h1>🌌 Unify LLM: The Universal TypeScript SDK for Building AI Agents</h1>
  <p><strong>A single, unified, 100% type-safe API to orchestrate OpenAI, Anthropic Claude, Google Gemini, and Ollama.</strong></p>
  <p>Engineered for production. Featuring built-in <b>Universal Tool Calling</b>, Deep Prompt Caching, streaming responses, reliable Structured Outputs, and precise multi-model cost tracking.</p>

  [![npm version](https://img.shields.io/npm/v/@atom8ai/unify-llm.svg?style=flat-square)](https://www.npmjs.com/package/@atom8ai/unify-llm)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg?style=flat-square)](https://www.typescriptlang.org/)
  [![Coverage](https://img.shields.io/badge/Coverage-100%25-brightgreen.svg?style=flat-square)]()
</div>

---

## 🚀 Why Use Unify LLM? (The Problem with AI SDKs Today)

Building robust AI agents and LLM-powered applications is currently chaotic. If you want to switch between an **OpenAI (`gpt-4o`)** and an **Anthropic (`claude-3-5-sonnet`)** model, you are forced to rewrite your core application logic because every LLM provider uses entirely different wire formats for Tool Calling, Streaming, and Structured Data.

**Unify LLM** solves the enterprise fragmentation problem. It acts as a lightweight, highly-optimized alternative to bloated frameworks like LangChain or the Vercel AI SDK. Instead of writing custom adapters for Anthropic's `tool_use`, OpenAI's `tool_calls`, and Gemini's `functionCall`, Unify LLM abstracts everything into one elegant, developer-friendly experience.

### ✨ Core Capabilities at a Glance:
- 🔌 **Universal Tool Calling (Agentic Workflows):** Hand standard native TypeScript functions to the SDK. Unify LLM handles the complex bridging, JSON schema generation, and recursive task execution (`autoExecute`) automatically across all supported providers.
- ⚡ **Native Prompt Caching Integration:** Dramatically lower API costs by up to 90% by utilizing native Anthropic Ephemeral Caching and Gemini Context Caching out-of-the-box.
- 💰 **Precision Cost Tracking Middleware:** Calculate exact fractional USD costs across disparate pricing permutations (e.g., cached vs. uncached tokens) in real-time.
- 🧩 **Reliable Structured Outputs:** Force models to return guaranteed JSON formats using standard JSON schema integration without complex prompt engineering.
- 🛡️ **Extensible Enterprise Architecture:** Inject exact-match Redis caching, Rate Limiting, PII sanitization, and robust security middleware via a standard `.use()` plugin architecture.

---

## 📦 Installation

Install Unify LLM via your preferred package manager:

```bash
npm install @atom8ai/unify-llm
# or
yarn add @atom8ai/unify-llm
# or
pnpm add @atom8ai/unify-llm
```

---

## 💻 Technical Implementation Guide

### 1. Standardized Text Generation & Streaming
Generate static responses or stream Server-Sent Events (SSE) and NDJSON natively. You can swap providers dynamically without changing a single line of your business logic.

```typescript
import { 
  UnifyClient, 
  OpenAIProvider, 
  AnthropicProvider, 
  GeminiProvider 
} from '@atom8ai/unify-llm';

// Initialize the client and register your preferred LLM providers
const client = new UnifyClient()
  .registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY))
  .registerProvider(new AnthropicProvider(process.env.ANTHROPIC_API_KEY))
  .registerProvider(new GeminiProvider(process.env.GEMINI_API_KEY));

// Seamlessly orchestrate Anthropic Claude 3.5 Sonnet
const response = await client.generate('anthropic', {
  model: 'claude-3-5-sonnet-20240620',
  messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }]
});

console.log(response.content);
```

### 2. 🦾 Universal Tool Calling (Building Autonomous Agents)
Unify LLM's crown jewel. You no longer need to write provider-specific function calling schemas. Define a standard TypeScript `UnifyTool`, set `autoExecute: true`, and watch the SDK autonomously loop, execute, and feed results back to the LLM agent.

```typescript
// Define a universal tool once. Unify LLM maps it to OpenAI, Claude, and Gemini formats automatically.
const getWeatherTool = {
  name: 'getWeather',
  description: 'Fetches the current real-time weather for a specific city location.',
  schema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"]
  },
  // The SDK runs this function automatically when the LLM requests it!
  execute: async (args: { city: string }) => {
    return await fetchWeatherApi(args.city); 
  }
};

// Execute an Agentic Workflow using OpenAI GPT-4o
const agentResponse = await client.generate('openai', {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Should I pack an umbrella for my trip to Seattle today?' }],
  tools: [getWeatherTool],
  autoExecute: true // Unify LLM evaluates, executes the API fetch, and loops back automatically.
});

console.log(agentResponse.content);
// Output: "Yes, you should definitely pack an umbrella! It is currently raining in Seattle with a temperature of 52°F."
```

### 3. 🧠 Deep Prompt Caching (Reduce API Costs by 90%)
For architectures dealing with massive context windows (RAG, Codebase Analysis), Unify LLM supports advanced Prompt Caching. Simply add `cachePrompt: true` to a message.

```typescript
const response = await client.generate('anthropic', {
  model: 'claude-3-5-sonnet-20240620',
  messages: [
    { 
      role: 'system', 
      content: 'You are an expert code reviewer analyzing the following 100,000 line Linux kernel source file...', 
      cachePrompt: true // Tells Anthropic to cache this block ephemerally
    },
    { role: 'user', content: 'Find the race condition in the memory allocation module.' }
  ]
});

console.log(`Cache Read Tokens: ${response.usage.cacheReadTokens}`); // Observe massive cost savings!
```

### 4. 📈 Middleware Integration: Exact Cost Tracking
Because Unify LLM intercepts data cleanly, tracking exact costs down to fractional cents—even across deeply recursive agent function calls—is effortless.

```typescript
import { CostTrackerMiddleware } from '@atom8ai/unify-llm';

const costTracker = new CostTrackerMiddleware();
// Attach the middleware safely to the execution pipeline
client.use(costTracker);

// Trigger complex tasks, streams, and parallel AI agent executions...

// Access the exact USD cost tracked globally across all registered providers
console.log(`Total System LLM Cost: $${costTracker.getTotalCost().toFixed(4)} USD`);
```

### 5. 🚦 Serverless & Distributed Rate Limiting
The `RateLimiterMiddleware` is fully extensible for multi-threaded or cloud VPS architectures. While it defaults to an in-memory store, you can pass any implementation matching the `RateLimiterStore` interface (e.g., an `ioredis` driver):

```typescript
import { RateLimiterMiddleware, RateLimiterStore } from '@atom8ai/unify-llm';
import Redis from 'ioredis';

const redis = new Redis();

class RedisRateLimiterStore implements RateLimiterStore {
    async increment(key: string, windowMs: number): Promise<number> {
        const current = await redis.incr(key);
        if (current === 1) await redis.pexpire(key, windowMs);
        return current;
    }
}

// Example: 60 requests per minute, backed by Redis, keyed by User ID
client.use(new RateLimiterMiddleware(
    60, 
    new RedisRateLimiterStore(),
    (req) => req.providerOptions?.userId ?? 'global'
));
```

---

## 🔧 Supported LLM Providers & Matrix

| AI Provider | Example Supported Models | Tool Calling | Streaming | Caching |
|---|---|---|---|---|
| **OpenAI** | `gpt-4o`, `gpt-4-turbo`, `gpt-4o-mini`, `gpt-3.5` | ✅ Supported | ✅ Supported | N/A |
| **Anthropic** | `claude-3-5-sonnet`, `claude-3-opus`, `haiku` | ✅ Supported | ✅ Supported | ✅ Supported |
| **Google Gemini** | `gemini-1.5-pro`, `gemini-1.5-flash` | ✅ Supported | ✅ Supported | ✅ Supported |
| **Ollama** | `llama3`, `mistral`, `phi3`, custom local models | ✅ Supported | ✅ Supported | N/A |

---

## 🎯 Frequently Asked Questions (FAQ)

**Is this a replacement for the Vercel AI SDK or LangChain?**  
Yes. For developers who find LangChain too heavy, too opinionated, or too difficult to debug, Unify LLM serves as a remarkably lightweight (zero-dependency core), highly transparent orchestration alternative. It provides the exact fundamental primitives—Universal Routing, Tool Calling, and Streaming—needed for production AI applications without the architectural bloat.

**How does Unify LLM handle security against LLM Injection?**  
The library utilizes an advanced `safeJSONParse` algorithm at the middleware level that strictly validates Abstract Syntax Trees before parsing to intercept critical vulnerabilities like Deserialization Prototype Pollution (CWE-502 / CWE-1321) common when caching raw LLM outputs.

**Can I run local models offline?**  
Absolutely. Unify LLM offers native support for the `OllamaProvider`. You can route traffic to `http://localhost:11434` seamlessly, achieving identical Tool Calling and Structured Output capabilities using local open-source models like Meta's Llama-3.

---

## 🤝 Contributing & Community
We welcome contributions from the open-source AI developer community! 
- Found a bug or want a new provider integration? Please open an issue on our [GitHub repository](https://github.com/atom8ai/unify-llm/issues).
- We actively merge PRs that follow our strict 100% test coverage threshold.

## 📄 License
Released under the [MIT License](https://opensource.org/licenses/MIT). Build freely.
