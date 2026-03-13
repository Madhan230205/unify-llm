# Unify LLM: TypeScript SDK for Multi-Provider LLM Orchestration

**Unify LLM is a TypeScript SDK for building AI applications across OpenAI, Anthropic, Gemini, and Ollama with one consistent API.** Use it when you need provider-agnostic text generation, tool calling, structured outputs, prompt caching, streaming, middleware, cost tracking, routing, and hallucination interception without rewriting your app for every model vendor.

[![npm version](https://img.shields.io/npm/v/@atom8ai/unify-llm.svg?style=flat-square)](https://www.npmjs.com/package/@atom8ai/unify-llm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg?style=flat-square)](https://www.typescriptlang.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/Madhan230205/unify-llm/ci.yml?branch=main&style=flat-square)](https://github.com/Madhan230205/unify-llm/actions/workflows/ci.yml)

Unify LLM is designed for developers who want a **TypeScript-first LLM SDK** with direct control over providers, middleware, and runtime behavior. It normalizes provider differences such as OpenAI `tool_calls`, Anthropic `tool_use`, and Gemini `functionCall`, while still leaving room for provider-specific options when you need them.

## Table of contents

- [Why use Unify LLM?](#why-use-unify-llm)
- [Core features](#core-features)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [Tool calling example](#tool-calling-example)
- [Middleware, routing, and safety](#middleware-routing-and-safety)
- [Supported providers](#supported-providers)
- [Benchmarks and quality signals](#benchmarks-and-quality-signals)
- [Use cases](#use-cases)
- [Unify LLM vs other TypeScript AI SDKs](#unify-llm-vs-other-typescript-ai-sdks)
- [Plain-English naming guide](#plain-english-naming-guide)
- [Examples and repository guide](#examples-and-repository-guide)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Why use Unify LLM?

Most multi-provider AI projects hit the same friction points:

- different request and response shapes for each provider
- inconsistent tool calling formats
- one-off streaming adapters scattered across the codebase
- duplicate cost tracking and retry logic
- growing need for routing, safety, and local-model support

Unify LLM gives you a single client and middleware pipeline so your application logic stays stable while you switch models, add failover, or experiment with routing.

### Best fit for

- **TypeScript AI apps** that need OpenAI, Anthropic, Gemini, and Ollama behind one SDK
- **AI agents** that rely on tool calling and structured outputs
- **LLM gateways** that need retries, rate limiting, routing, or cost controls
- **safety-aware systems** that want response anomaly detection or stream interception
- **teams comparing providers** without rewriting business logic for each API

## Core features

- **Unified multi-provider API** for OpenAI, Anthropic, Gemini, Ollama, and related integrations
- **Universal tool calling** with a single schema shape across supported providers
- **Structured outputs** using JSON schema-style contracts
- **Streaming support** for incremental generation and stream middleware
- **Prompt caching support** where providers expose native caching controls
- **Middleware pipeline** for retry, caching, rate limiting, cost tracking, and safety
- **Routing primitives** for cost/latency/quality-aware or drift-aware model selection
- **Hallucination interception** for response anomaly detection and early stream aborts
- **TypeScript-first developer experience** with exported types, examples, and benchmark utilities

## Installation

```bash
npm install @atom8ai/unify-llm
```

Requires **Node.js 20+**.

If you want to run examples locally, configure the provider API keys you actually use. For local-only workflows with Ollama, point your runtime at `http://localhost:11434`.

## Quickstart

This is the fastest way to send one prompt through a unified TypeScript interface.

```ts
import { UnifyClient, OpenAIProvider } from '@atom8ai/unify-llm';

const client = new UnifyClient()
  .registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY!));

const response = await client.generate('openai', {
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Explain prompt caching in one sentence.' },
  ],
});

console.log(response.content);
```

If you later switch from OpenAI to Anthropic or Gemini, your app can keep the same high-level flow while only changing provider registration and model selection.

## Tool calling example

Unify LLM is especially useful when you want one tool definition that works across multiple LLM providers.

```ts
import { UnifyClient, OpenAIProvider } from '@atom8ai/unify-llm';

const client = new UnifyClient()
  .registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY!));

const getWeatherTool = {
  name: 'getWeather',
  description: 'Get the current weather for a city.',
  schema: {
    type: 'object',
    properties: {
      city: { type: 'string' },
    },
    required: ['city'],
  },
  execute: async ({ city }: { city: string }) => {
    return { city, forecast: 'Rain', temperatureF: 52 };
  },
};

const result = await client.generate('openai', {
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Should I bring an umbrella in Seattle today?' },
  ],
  tools: [getWeatherTool],
  autoExecute: true,
});

console.log(result.content);
```

## Middleware, routing, and safety

The middleware layer is where Unify LLM becomes more than a thin API wrapper.

```ts
import {
  CacheMiddleware,
  CostTrackerMiddleware,
  RetryMiddleware,
  UnifyClient,
  OpenAIProvider,
  createHallucinationGuard,
} from '@atom8ai/unify-llm';

const costTracker = new CostTrackerMiddleware();

const client = new UnifyClient()
  .registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY!))
  .use(new CacheMiddleware())
  .use(new RetryMiddleware({ maxRetries: 3, baseDelayMs: 1000 }))
  .use(costTracker)
  .use(createHallucinationGuard({ alpha: 1.2, tau: 2, chunkSize: 6 }));

const response = await client.generate('openai', {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Summarize the benefits of JSON schema.' }],
});

console.log(response.content);
console.log('Total cost:', costTracker.getTotalCost());
```

### Routing and orchestration highlights

Unify LLM includes advanced and experimental routing primitives for teams exploring:

- **cost/latency/quality tradeoffs** with `CostLatencyQualityRouter`
- **Gaussian-process utility routing** with `BayesianUtilityRouter`
- **topological drift monitoring** with `TopologicalDriftRouter`
- **complexity-threshold routing** with `ComplexityThresholdRouter`
- **failover-capable orchestration** with `SelfHealingGateway`

These are useful when you want a single TypeScript SDK to act like a lightweight **LLM gateway**, **multi-model router**, or **AI orchestration layer**.

## Supported providers

| Provider | Typical models | Tool calling | Streaming | Vision | Prompt caching |
| --- | --- | --- | --- | --- | --- |
| OpenAI | `gpt-4o`, `gpt-4o-mini`, `o1` | ✅ | ✅ | ✅ | N/A |
| Anthropic | `claude-3-7-sonnet`, `claude-3-opus` | ✅ | ✅ | ✅ | ✅ |
| Google Gemini | `gemini-2.0-flash`, `gemini-1.5-pro` | ✅ | ✅ | ✅ | ✅ |
| Ollama | `llama3.3`, `mistral`, `phi4` | ✅ | ✅ | ✅ | N/A |

## Benchmarks and quality signals

Unify LLM ships with a reproducible benchmark harness in `benchmarks/run.ts` and evaluation helpers in `evaluation/`.

### What the benchmark covers

- hallucination guard accuracy
- stream abort latency
- cost savings from model routing
- scaling behavior for micro-batched async workloads

### Current checked-in synthetic snapshot

From the current local benchmark artifact in `benchmarks/latest.json`:

- **hallucination guard accuracy:** `100%`
- **guardian p95 abort latency:** `19.23 ms`
- **cost savings vs always-frontier baseline:** `43.69%`
- **scaling smoke test:** `10,000` micro-batched iterations completed

### CI regression thresholds

The benchmark assertion step currently enforces these regression guards:

- guardian accuracy **≥ 95%**
- guardian p95 abort latency **≤ 50 ms**
- pareto cost savings **≥ 20%**

These are **synthetic benchmark thresholds**, not universal production guarantees. They are most useful for catching regressions in routing and safety logic over time.

### Test coverage signal

The latest local test run completed with **33 passing test files**, **230 passing tests**, and **1 skipped file**, which helps keep README claims grounded in code that is actually exercised.

## Use cases

Developers usually land on Unify LLM through one of these intents:

### Build one app across multiple LLM providers

Use one TypeScript client to talk to OpenAI, Anthropic, Gemini, and Ollama while keeping your application code stable.

### Add tool calling to AI agents

Define tools once, keep schemas predictable, and avoid provider-specific tool payload drift.

### Create a lightweight TypeScript LLM gateway

Combine middleware, routing, and failover so your app can make model decisions without adopting a heavier agent framework.

### Add safety checks to streaming AI output

Use `createHallucinationGuard` to monitor semantic drift, annotate provider metadata, and stop unstable streams early.

### Run local and hosted models side by side

Use Ollama for local experimentation and hosted providers for production paths or fallbacks.

## Unify LLM vs other TypeScript AI SDKs

This section exists for real developer intent: many users are actively searching for a **Vercel AI SDK alternative**, **LangChain.js alternative**, or a more focused **multi-provider LLM SDK for TypeScript**.

| Tool | Best when you want | Tradeoff |
| --- | --- | --- |
| **Unify LLM** | One API for multiple providers, middleware, routing, tool calling, and safety primitives | Smaller ecosystem than the largest framework players |
| **Vercel AI SDK** | Tight UI integration for web apps, especially React/Next.js streaming experiences | Less centered on experimental routing and safety middleware primitives |
| **LangChain.js** | Large ecosystem of chains, integrations, and agent abstractions | Heavier abstraction layer if you mainly want direct provider control |

### When Unify LLM is a strong choice

- you want a **TypeScript SDK for OpenAI, Anthropic, Gemini, and Ollama**
- you care about **middleware**, **tool calling**, and **provider normalization**
- you want **routing** and **safety controls** without building them all from scratch
- you prefer direct programmatic control over a large framework stack

## Plain-English naming guide

Some modules still keep research-style or legacy names for backward compatibility. For new code, prefer the clearer aliases below.

| Internal name | Preferred public name | Meaning |
| --- | --- | --- |
| `createSemanticMomentumGuardian` | `createHallucinationGuard` | Hallucination and drift guard |
| `HallucinationInterceptionAlgorithm` | `ResponseAnomalyDetector` | Response anomaly detector |
| `ParetoNavigatorRouter` | `CostLatencyQualityRouter` | Cost/latency/quality router |
| `PrimRouter` | `TopologicalDriftRouter` | Topological drift router |
| `VonNeumannRouter` | `BayesianUtilityRouter` | Bayesian utility router |
| `AstralDysonRouter` | `ComplexityThresholdRouter` | Prompt complexity router |
| `semanticFingerprintEngine.ts` | `semanticFingerprint.ts` | Semantic fingerprint helpers |
| `topologyPersistence.ts` | `topologyDrift.ts` | Topology drift helpers |
| `loopRiskEngine.ts` | `executionLoopRisk.ts` | Execution loop risk helpers |

## Examples and repository guide

Useful starting points in this repository:

- [`examples/basic.ts`](./examples/basic.ts) - base client with cache and cost tracking
- [`examples/orchestration.ts`](./examples/orchestration.ts) - retrieval, prompt templates, and structured parsing
- [`examples/paretoNavigator.ts`](./examples/paretoNavigator.ts) - multi-objective routing example
- [`examples/primRouter.ts`](./examples/primRouter.ts) - topological drift routing example
- [`examples/hallucinationGuard.ts`](./examples/hallucinationGuard.ts) - non-streaming and streaming guard usage
- [`benchmarks/run.ts`](./benchmarks/run.ts) - local benchmark harness
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - contributor setup and expectations

## FAQ

### What is Unify LLM in one sentence?

Unify LLM is a TypeScript SDK that lets you build AI applications across multiple LLM providers with one API for generation, tool calling, middleware, routing, and safety.

### Is Unify LLM a LangChain.js replacement?

It can be, depending on your goals. If you want a lighter TypeScript abstraction with direct provider control, middleware, and routing primitives, Unify LLM is a strong option.

### Is Unify LLM a Vercel AI SDK alternative?

Yes. If your priority is provider normalization, routing, and middleware rather than UI-focused web framework helpers, Unify LLM is a reasonable alternative.

### Can I use local models?

Yes. Unify LLM includes an `OllamaProvider`, which is useful for local inference, offline experiments, and hybrid local/hosted setups.

### Does Unify LLM support structured outputs?

Yes. You can define JSON schema-style response shapes and use them for more predictable parsing and downstream automation.

### Does Unify LLM include hallucination protection?

It includes `createHallucinationGuard`, which monitors semantic drift and can annotate or abort unstable response streams. You should still add normal application-level validation and domain-specific safety checks in production.

## Contributing

Contributions are welcome.

- Open an issue for bugs, provider support requests, or documentation gaps
- Include tests when you change routing, middleware, or core request handling
- Include benchmark notes when your change affects performance, safety, or routing behavior
- Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## License

Released under the [MIT License](./LICENSE).
