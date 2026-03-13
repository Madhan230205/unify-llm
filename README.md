# 🌌 Unify LLM: TypeScript SDK for Multi-Provider LLM Orchestration

**A type-safe API for working with OpenAI, Anthropic, Gemini, and Ollama through one consistent interface.**

Includes tool calling, prompt caching, streaming, structured outputs, middleware, and experimental routing primitives for multi-model workflows.

[![npm version](https://img.shields.io/npm/v/@atom8ai/unify-llm.svg?style=flat-square)](https://www.npmjs.com/package/@atom8ai/unify-llm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg?style=flat-square)](https://www.typescriptlang.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/Madhan230205/unify-llm/ci.yml?branch=main&style=flat-square)](https://github.com/Madhan230205/unify-llm/actions/workflows/ci.yml)

---

> [!NOTE]
> **Unify LLM** provides a single `UnifyClient` interface that normalizes provider-specific payloads such as `tool_choice`, `functionCall`, and `tool_use`. It is a good fit when you want a smaller orchestration layer with direct TypeScript control over providers, middleware, and routing.

> [!TIP]
> Some internal modules use research-style or metaphorical names. For open-source readers, the simplest way to think about the project is: **provider adapters + middleware + routing + safety checks**. A plain-English terminology map is included below.

## 🚀 Why choose Unify LLM?

Switching between providers usually means adapting different wire formats for tool calling, streaming, and structured outputs. Unify LLM smooths over those differences so application code can stay focused on product logic.

Instead of writing separate adapters for Anthropic `tool_use`, OpenAI `tool_calls`, and Gemini `functionCall`, the SDK exposes a consistent TypeScript surface with middleware hooks and provider-specific escape hatches where needed.

### ✨ Core Features for Production Engineering

- 🔌 **Unified tool calling:** Define one tool shape and reuse it across supported providers.
- ⚡ **Prompt caching integration:** Supports native Anthropic and Gemini caching controls when the provider exposes them.
- 📐 **Structured outputs:** Pass JSON schema definitions and keep response parsing predictable.
- ✨ **Streaming helpers:** Stream responses and incrementally process partial output.
- 🛡️ **Retry middleware:** Retries transient upstream failures with bounded exponential backoff.
- 🔀 **Routing primitives:** Includes heuristic and experimental routers for multi-model selection.
- 💰 **Cost tracking middleware:** Tracks provider response usage and aggregates cost estimates.
- 🧭 **Semantic stability hardening:** Estimates a local condition number for prompt semantics under tiny perturbations and uses it to make routing and hallucination checks more conservative near unstable decision boundaries.
- 📈 **Adaptive GP regularization:** Automatically increases diagonal jitter when covariance matrices become ill-conditioned, reducing brittle posterior behavior in sparse or near-duplicate observation regimes.

---

## 🧾 Plain-English terminology guide

This project includes a few intentionally stylized module names. If you are evaluating the library for adoption or contribution, use the following mental model:

| Internal name | Preferred public name | Plain-English meaning |
| --- | --- |
| `UnifyClient` | `UnifyClient` | Multi-provider LLM client |
| `createSemanticMomentumGuardian` | `createHallucinationGuard` | Streaming hallucination / drift guard |
| `HallucinationInterceptionAlgorithm` | `ResponseAnomalyDetector` | Response and stream anomaly detector |
| `microVerifier` | `microVerifier` | Lightweight factual-claim verifier |
| `OmniCognitiveRouter` | `AdaptiveModelRouter` | Heuristic prompt-to-model router |
| `ParetoNavigatorRouter` | `CostLatencyQualityRouter` | Cost/latency/quality multi-objective router |
| `PrimRouter` | `TopologicalDriftRouter` | Topological drift-aware router |
| `VonNeumannRouter` | `BayesianUtilityRouter` | Gaussian-process utility router |
| `AstralDysonRouter` | `ComplexityThresholdRouter` | Prompt-complexity threshold router |
| `SelfHealingGateway` | `SelfHealingGateway` | Failover-capable orchestration gateway |
| `semanticFingerprintEngine.ts` | `semanticFingerprint.ts` | Semantic fingerprinting / text projection |
| `semanticTrajectory.ts` | `TokenTrajectoryAnalyzer` | Trajectory curvature math for streaming drift |
| `topologyPersistence.ts` | `topologyDrift.ts` | Topological drift analysis |
| `loopRiskEngine.ts` | `executionLoopRisk.ts` | Loop-risk / transition-matrix analysis |
| `contextAnalyzer.ts` | `SemanticFeatureExtractor` | Lightweight prompt feature extraction |

The public direction for the project is to keep compatibility while improving contributor-facing clarity in docs, aliases, and examples.

For new code, prefer the plain-English exports above. The research-style names remain available for backwards compatibility.

### Preferred imports for new code

```typescript
import {
  BayesianUtilityRouter,
  ComplexityThresholdRouter,
  CostLatencyQualityRouter,
  ResponseAnomalyDetector,
  TopologicalDriftRouter,
  createHallucinationGuard,
  createSemanticFingerprint,
  computeSemanticFingerprintDistance,
  assessExecutionLoopRisk,
} from '@atom8ai/unify-llm';
```

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
  model: 'claude-3-5-sonnet-20241022',
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

### 3. 🧠 Deep Prompt Caching

For workflows with large repeated context windows (for example RAG or code analysis), Unify LLM supports prompt caching controls on providers that expose them. Add `cachePrompt: true` to a message.

```typescript
const response = await client.generate('anthropic', {
  model: 'claude-3-5-sonnet-20241022',
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

### 4. 🔂 Resilient Retry Middleware

In production, upstream AI APIs can be bursty. Hook the `RetryMiddleware` to automatically catch retryable HTTP failures and back off with deterministic jitter.

```typescript
import { RetryMiddleware } from '@atom8ai/unify-llm';

// Automatically retry up to 3 times on 429 or 500 errors with a 1s base delay
client.use(new RetryMiddleware({ maxRetries: 3, baseDelayMs: 1000 }));
```

### 5. 📉 Middleware Integration: Exact Cost Tracking

Because Unify LLM intercepts data cleanly, tracking exact costs down to fractional cents—even across deeply recursive agent function calls—is effortless.

```typescript
import { CostTrackerMiddleware } from '@atom8ai/unify-llm';

const costTracker = new CostTrackerMiddleware();
// Attach the middleware safely to the execution pipeline
client.use(costTracker);

// Access the exact USD cost tracked globally across all registered providers
console.log(`Total System LLM Cost: $${costTracker.getTotalCost().toFixed(4)} USD`);
```

---

## 🔧 Supported LLM Providers & Matrix

| AI Provider | Typical Models | Tool Calling | Streaming | Multimodal Vision | Prompt Caching |
| --- | --- | --- | --- | --- | --- |
| **OpenAI** | `gpt-4o`, `o1`, `gpt-4o-mini` | ✅ Yes | ✅ Yes | ✅ Yes | N/A |
| **Anthropic** | `claude-3-7-sonnet`, `claude-3-opus` | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Google Gemini** | `gemini-2.0-flash`, `gemini-1.5-pro` | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Ollama** | `llama3.3`, `mistral`, `phi4` | ✅ Yes | ✅ Yes | ✅ Yes | N/A |

---

## 📊 Benchmarks

Unify LLM includes a reproducible benchmark harness at `benchmarks/run.ts` that measures, on **synthetic**, **local-machine**, **fixture-based** workloads:

- **Hallucination detection accuracy** for `createHallucinationGuard`
- **Average abort latency** for streaming anomaly shutdowns
- **Cost saved** by `CostLatencyQualityRouter` (`ParetoNavigatorRouter`) versus an always-frontier baseline
- **Scaling boundaries** using micro-batched async iterations so local `tsx` runs do not hang at 10,000 iterations

Run the full benchmark suite:

```bash
npm run benchmark
```

Run a fast local smoke benchmark:

```bash
npm run benchmark:quick
```

The benchmark runner writes machine-readable output to `benchmarks/latest.json` so results can be checked into CI artifacts, compared over time, or surfaced in release notes.

Current CI thresholds enforce the following floors/ceilings on the benchmark report:

- Guardian accuracy: **≥ 95%**
- Guardian p95 abort latency: **≤ 50 ms**
- Pareto cost savings: **≥ 20%**

These thresholds are intended as regression guards for the synthetic harness, not as universal production guarantees.

To avoid the local event-wrapper stall observed around large async loops, the harness executes work in **micro-batches** and yields back to the event loop after each batch. You can tune this with CLI flags:

```bash
tsx benchmarks/run.ts --iterations 400 --batch-size 50 --out benchmarks/latest.json
```

### Truthfulness evaluation (TruthfulQA-style)

In addition to synthetic harness metrics, Unify now includes a reproducible truthfulness scorer:

```bash
npm run benchmark:truthfulqa
```

By default this reads `evaluation/truthfulqa.sample.json` and writes `evaluation/latest-truthfulqa.json` with:

- baseline hallucination rate
- intercepted hallucination rate
- absolute reduction
- relative reduction

You can point it to your own dataset export:

```bash
tsx benchmarks/truthfulqa.ts --input evaluation/truthfulqa.sample.json --out evaluation/latest-truthfulqa.json
```

> [!IMPORTANT]
> The included file is a **sample format/template** for reproducibility. For publication-grade claims, replace it with your own model outputs on a full benchmark set (for example, TruthfulQA split + fixed prompts + fixed model versions).

### Current local synthetic snapshot

The checked-in `benchmarks/latest.json` currently reports, on a local Windows machine with fixture-driven inputs:

- `createHallucinationGuard` accuracy: **100%**
- Guardian p95 abort latency: **25.6 ms**
- `CostLatencyQualityRouter` (`ParetoNavigatorRouter`) cost savings versus an always-frontier baseline: **35.95%**
- Scaling boundary smoke test: **10,000** micro-batched iterations completed without the earlier local TSX event-loop stall

Treat these as development benchmarks for change detection, not as guarantees for all workloads or model/provider combinations.

## 🧪 Practical examples

- `examples/basic.ts` — base client with cache and cost tracking
- `examples/paretoNavigator.ts` — multi-objective routing with cost/latency/quality constraints
- `examples/primRouter.ts` — concept drift monitoring with `TopologicalDriftRouter`
- `examples/hallucinationGuard.ts` — non-streaming and streaming guardian usage

---

## 🧭 Product Narrative: Self-Healing, Cost-Aware LLM Gateway

If you prefer a simple linear mental model, think of Unify as:

### Prompt → Route → Model → Tools → Output

### Core algorithm (the project heart): Hallucination Interception Algorithm (HIA)

Unify now has an explicit core algorithm in `src/algorithms/hallucinationInterception.ts`.

Pipeline:

1. **Token stream ingestion**
2. **Hologram projection** (local hyperdimensional vector, no external embedding API)
3. **Semantic trajectory monitoring** (`KinematicTrajectory` curvature)
4. **Entropy spike detection** (online baseline + z-score threshold)
5. **Abort decision** (`shouldAbort`) + structured signal metadata

This algorithm powers real-time stream interception and is also usable directly for offline/response-level analysis.

### Analytics traceability map (where each module is used)

To make the math layer auditable for new contributors, here is the concrete mapping inside the hallucination detection pipeline:

- **`semanticFingerprintEngine.ts`** (`generateHologram`, robust distance, modality)
  - Projects text to semantic vectors
  - Computes prompt-relative drift and modality shifts

- **`semanticTrajectory.ts`** (`KinematicTrajectory`)
  - Computes windowed curvature of semantic trajectory

- **`contextAnalyzer.ts`**
  - Computes chunk entropy and manifold points

- **`topologyPersistence.ts`**
  - Computes topological state from manifold points
  - Computes sliced Wasserstein drift versus prompt topology

- **`loopRiskEngine.ts`**
  - Computes transition spectral radius on semantic state transitions (`stable -> drifting -> anomalous`)
  - Flags loop-like divergence in instability trajectories

All five now feed into the HIA signal payload (`InterceptionSignal`) and are surfaced in `providerSpecific` metadata.

### Descriptive naming aliases for adoption

If your team prefers descriptive APIs over sci-fi names, use the preferred alias surface:

- `createHallucinationGuard` (preferred; `createSemanticMomentumGuardian` kept for compatibility)
- `ResponseAnomalyDetector` (preferred; `HallucinationInterceptionAlgorithm` kept for compatibility)
- `ComplexityThresholdRouter` (preferred; `ComplexityThresholdEngine` / `AstralDysonRouter` kept for compatibility)
- `BayesianUtilityRouter` (preferred; `VonNeumannRouter` kept for compatibility)
- `CostLatencyQualityRouter` (preferred; `ParetoNavigatorRouter` kept for compatibility)
- `TopologicalDriftRouter` (preferred; `PrimRouter` kept for compatibility)
- `createSemanticFingerprint` (alias of `generateHologram`)
- `computeSemanticFingerprintDistance` (alias of `computeRobustSemanticDistance`)
- `computeTopologySnapshot` and `computeTopologyDriftDistance` (aliases around `topologyPersistence.ts`)
- `assessExecutionLoopRisk` and `computeTransitionSpectralRadius` (aliases around `loopRiskEngine.ts`)

The older metaphorical names still exist so existing integrations do not break, but new examples and new contributions should prefer the clearer names.

The advanced analytics are implementation details that remove latency and reduce failure rates:

- **Cost & Routing Layer (pre-stream)**
  - `ContextAnalyzer`: local prompt classification in ~sub-ms time (no external embedding call)
  - `GaussianProcess` + `CostLatencyQualityRouter` (`ParetoNavigatorRouter`): cost/latency/quality-aware model selection
  - `TopologicalDriftRouter` (`PrimRouter`) + persistent homology: concept-drift “check engine light” for router health

- **Safety & Interception Layer (mid-stream)**
  - `createHallucinationGuard`: tracks semantic trajectory curvature in memory
  - `semanticTrajectory` + `semanticFingerprintEngine`: detects drift and can abort hallucinating streams before runaway token spend

### Linear product API

Use `SelfHealingGateway` when you want one closed-loop runtime primitive that unifies route, execute, and failover:

```typescript
import {
  UnifyClient,
  OpenAIProvider,
  AnthropicProvider,
  createHallucinationShield,
  SelfHealingGateway,
} from '@atom8ai/unify-llm';

const client = new UnifyClient()
  .registerProvider(new OpenAIProvider(process.env.OPENAI_API_KEY))
  .registerProvider(new AnthropicProvider(process.env.ANTHROPIC_API_KEY))
  .use(createHallucinationShield({ alpha: 3, tau: 2 }));

const gateway = new SelfHealingGateway(client, {
  endpoints: [
    { id: 'cheap', provider: 'openai', model: 'gpt-4o-mini', tier: 0 },
    { id: 'strong', provider: 'anthropic', model: 'claude-3-7-sonnet-20250219', tier: 1 },
  ],
  planner: () => ['cheap', 'strong'],
  maxFailovers: 2,
});

const res = await gateway.generate({
  model: 'ignored-by-gateway',
  messages: [{ role: 'user', content: 'Answer safely and cost-efficiently.' }],
  tools: [],
  autoExecute: true,
});

console.log(res.content);
```

### Business-friendly wrappers

For teams who want product semantics instead of raw math primitives:

- `profilePrompt(request)` → prompt profile (`chat|code|data`) + entropy/density/asymmetry
- `inspectRouterHealth(topologicalDriftRouter)` → stable/watch/recalibrating health status
- `inspectSafetySignal(response)` → normalized safety signal from stream/generation metadata

## 📐 Safe operating bounds

The experimental routers and guardian work best when given enough signal to learn from without overfitting tiny samples.

| Component | Recommended operating range | Notes |
| --- | --- | --- |
| `CostLatencyQualityRouter` (`ParetoNavigatorRouter`) | 3–10 candidate models, at least 3 observations per model before trusting EHVI decisions | Below that, cold-start behavior dominates |
| `TopologicalDriftRouter` (`PrimRouter`) | 2–8 candidate models, at least 20–40 feedback records before drift conclusions | Topology updates are more stable with broader history |
| `createHallucinationGuard` | 20+ normal baseline observations, chunk sizes of 4–30 words | Too little baseline data increases false positives/negatives |
| Benchmark scaling harness | 10,000 async iterations using micro-batches of 20–250 | Larger single-batch runs can overwhelm the local event loop |

In short: start with small model pools, collect baseline observations, and treat these experimental components as data-driven routing aids rather than zero-tuning autopilots.

### Stability envelope notes

Recent hardening work adds an internal **semantic stability envelope** around prompt geometry:

- The hologram projection now estimates how far the semantic coordinates move under several deterministic micro-perturbations.
- This produces a local Lipschitz-style stability signal, an approximate semantic condition number, and an anchor-boundary margin.
- Routers use that signal together with Gaussian-process conditioning diagnostics to avoid overconfident choices when the request lies near a fragile routing boundary.
- `createHallucinationGuard` now annotates condition and instability metadata so prompt-relative drift can be interpreted in context instead of as a raw geometric spike alone.

This is still heuristic mathematics rather than a formal proof of semantic robustness, but it is designed to reduce sensitivity to small prompt edits and numerically fragile posterior states.

### Event-loop safety and compute offloading

The routing stack now includes explicit **event-loop safety rails** for CPU-heavy analytics:

- **Adaptive compute valve:** large EHVI evaluations and large topological drift updates can be executed in a Node worker thread instead of on the main event loop.
- **Bounded-anytime EHVI:** under extreme frontier × candidate × sample complexity, the router automatically applies a bounded Monte Carlo budget with variance-reduced antithetic sampling to preserve decision quality while preventing runaway compute spikes.
- **Topology coreset compression:** very large point clouds are reduced with deterministic farthest-point sampling before persistent-homology updates, keeping topological drift checks stable and bounded at high load.
- **Synchronous GP safety cap:** `GaussianProcess` now clamps `maxObservations` to a safe synchronous ceiling of `64` observations unless the implementation itself is redesigned for off-thread or native acceleration.
- **Graceful fallback:** if worker threads are unavailable, the library falls back to the original in-process computation path.

This means the default runtime remains lightweight for small workloads, while larger routing/topology workloads avoid monopolizing the V8 thread that is also responsible for network I/O and token streaming.

If you need even larger Bayesian state or frontier sizes than the current guarded runtime supports, the next step is native acceleration (for example Rust/WASM or a service-side compute worker), not simply raising the synchronous caps.

---

## 🎯 Frequently Asked Questions (FAQ)

**Is this a replacement for the Vercel AI SDK or LangChain.js?**  
It can be, depending on what you need. If you want a smaller TypeScript-focused abstraction with direct control over providers, middleware, and routing logic, Unify LLM is a reasonable alternative.

**How does Unify LLM handle security against LLM injection?**  
The library includes structured parsing helpers and validation-oriented middleware hooks, but you should still apply normal application-layer validation, tool allow-listing, and output sanitization in production.

**Can I run local models offline?**  
Absolutely. Unify LLM offers native support for the `OllamaProvider`. You can route traffic to `http://localhost:11434` seamlessly, achieving identical Tool Calling and Structured Output capabilities using local open-source weights.

---

## 🤝 Contributing & Community

We welcome contributions from the open-source TypeScript AI web development community!

- Found a bug or want a new provider integration? Please open an issue on our [GitHub repository](https://github.com/Madhan230205/unify-llm/issues).
- Please include tests and benchmark notes when changing routing, middleware, or cost logic.
- See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local setup, testing, and contributor expectations.

## 📄 License

Released under the [MIT License](./LICENSE). Build freely.
