# Code Review — `unify-llm` (Pass 2)

**Verdict**: REQUEST CHANGES  
**Confidence**: HIGH

---

## Summary

`unify-llm` is a well-structured TypeScript library that unifies multiple LLM provider APIs (OpenAI, Anthropic, Gemini, Ollama) behind a single `UnifyClient` with a composable middleware pipeline and an intelligent failover provider ("Aetherion Mesh"). The architecture is clean and the test coverage is solid, but there are three P1 bugs that cause silent data loss in streaming paths and a memory leak in the default cache.

---

## Findings

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | Anthropic streaming never captures token usage — `amazonMessageStop` is an AWS Bedrock field, not Anthropic | `src/providers/anthropic.ts:103` |
| P1 | Gemini streaming never captures `usageMetadata` — usage is silently dropped for all stream calls | `src/providers/gemini.ts:82–96` |
| P1 | `InMemoryCache` grows unboundedly — no TTL, no size cap, will exhaust memory in long-running servers | `src/middlewares/cache.ts:8–17` |
| P2 | Gemini API key exposed in URL query string — key appears in server logs and proxy traces | `src/providers/gemini.ts:44,79` |
| P2 | `name` not declared `readonly` in concrete providers — violates `abstract readonly name` contract | `src/providers/openai.ts:6`, `anthropic.ts:6`, `gemini.ts:6`, `ollama.ts:6` |
| P2 | `afterResponse` result silently dropped in `stream()` — cost/providerSpecific fields on the aggregated response are never yielded | `src/core/UnifyClient.ts:90–96` |
| P2 | `dotenv` missing from `devDependencies` — example in `examples/basic.ts` will crash | `package.json` |
| P2 | Test env vars set at module scope — can contaminate sibling test files across runs | `test/providers.test.ts:24–26` |
| P3 | `readLines` `TextDecoder` not flushed at end — can silently drop trailing multibyte characters | `src/utils/stream.ts:9` |
| P3 | Cache hits in stream mode yield one full-content chunk instead of the original multi-chunk sequence | `src/core/UnifyClient.ts:55–60`, `src/middlewares/cache.ts` |
| P3 | Global rate-limit `idKey` buckets all traffic together — no per-user bucketing by default | `src/middlewares/rateLimiter.ts:29` |

---

## Details

### [P1] Anthropic streaming usage — `amazonMessageStop` is an AWS Bedrock field

**File:** `src/providers/anthropic.ts:101–106`

The stream parser checks `data.amazonMessageStop` to capture token usage on stream end, but this field does not exist in the official Anthropic API — it belongs to the AWS Bedrock Messages API. The real Anthropic streaming protocol sends usage in the `message_delta` event under `usage.output_tokens` (before `message_stop`). As a result, usage is **never captured** for any Anthropic stream, so `CostTrackerMiddleware` silently tracks $0 for every Anthropic streaming call.

```ts
// Current (broken) — condition is always false on the real Anthropic API
} else if (data.type === 'message_stop' && data.amazonMessageStop) {
    // ...
}
```

**Suggested fix:**

```ts
} else if (data.type === 'message_delta' && data.usage) {
    // Anthropic sends output_token count here
    yield {
        content: data.delta?.text || '',
        model: request.model,
        usage: {
            promptTokens: 0, // not available per-delta, only in message_start
            completionTokens: data.usage.output_tokens || 0,
            totalTokens: data.usage.output_tokens || 0
        },
        providerSpecific: data
    };
} else if (data.type === 'message_start' && data.message?.usage) {
    // Anthropic sends input_token count here
    yield {
        content: '',
        model: request.model,
        usage: {
            promptTokens: data.message.usage.input_tokens || 0,
            completionTokens: 0,
            totalTokens: data.message.usage.input_tokens || 0
        },
        providerSpecific: data
    };
}
```

---

### [P1] Gemini streaming never captures `usageMetadata`

**File:** `src/providers/gemini.ts:82–96`

The `streamCompletion` method only extracts `content` from each chunk and never reads `usageMetadata`. The Gemini streaming API includes `usageMetadata` in the final chunk. Since usage is never captured, `CostTrackerMiddleware` always tracks $0 for Gemini streams — the same silent failure pattern as Anthropic above.

**Suggested fix:** In the chunk-processing loop, extract usage if present:

```ts
const usageMetadata = data.usageMetadata;
yield {
    content: contentDelta,
    model: request.model,
    usage: usageMetadata ? {
        promptTokens: usageMetadata.promptTokenCount,
        completionTokens: usageMetadata.candidatesTokenCount,
        totalTokens: usageMetadata.totalTokenCount
    } : undefined,
    providerSpecific: data
};
```

---

### [P1] `InMemoryCache` grows unboundedly

**File:** `src/middlewares/cache.ts:8–17`

`InMemoryCache` is backed by a `Map` with no eviction, no maximum size, and no TTL. Every unique request forever occupies memory. In any server running more than a handful of distinct prompts this is a memory leak.

**Suggested fix:** Add a size-capped LRU eviction (or at minimum a `maxSize` option):

```ts
export class InMemoryCache implements CacheStore {
    private cache = new Map<string, string>();
    private maxSize: number;

    constructor(maxSize = 500) {
        this.maxSize = maxSize;
    }

    async get(key: string): Promise<string | null> {
        return this.cache.get(key) ?? null;
    }

    async set(key: string, value: string): Promise<void> {
        if (this.cache.size >= this.maxSize) {
            // evict oldest entry (first inserted)
            this.cache.delete(this.cache.keys().next().value!);
        }
        this.cache.set(key, value);
    }
}
```

---

### [P2] Gemini API key exposed in URL query string

**File:** `src/providers/gemini.ts:44,79`

```ts
`${this.baseUrl}/${request.model}:generateContent?key=${this.apiKey}`
```

Passing the API key as a query parameter means it appears in server access logs, proxy logs, browser history, and any error messages that include the full URL. The Gemini REST API also accepts the `x-goog-api-key` header, which is not logged by default.

**Suggested fix:**

```ts
// generateContent — remove ?key=... from the URL
const response = await fetch(`${this.baseUrl}/${request.model}:generateContent`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
    },
    body: JSON.stringify(payload)
});

// streamGenerateContent — same
const response = await fetch(`${this.baseUrl}/${request.model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
    },
    body: JSON.stringify(payload)
});
```

---

### [P2] `name` not declared `readonly` in concrete providers

**File:** `src/providers/openai.ts:6`, `anthropic.ts:6`, `gemini.ts:6`, `ollama.ts:6`, `aetherion.ts:17`

`BaseProvider` declares `abstract readonly name: string`, but all concrete implementations omit `readonly`:

```ts
name = 'openai'; // mutable — should be readonly
```

This means `provider.name = 'other'` compiles without error, breaking the `UnifyClient.providers` map keying logic. All five concrete classes should use `readonly name = '...'`.

---

### [P2] `afterResponse` result dropped in `stream()` — per-call cost/providerSpecific never reaches the caller

**File:** `src/core/UnifyClient.ts:86–96`

```ts
// afterResponse middlewares are called on the aggregated final response...
for (const middleware of this.middlewares) {
    if (middleware.afterResponse) {
        finalResponse = await middleware.afterResponse(currentRequest as CompletionRequest, finalResponse);
    }
}
// ...but finalResponse is never yielded. The caller cannot read _costUsd via the stream.
```

`CostTrackerMiddleware.afterResponse` adds `_costUsd` to `providerSpecific` and updates `totalCostUsd` (state side-effect, which works). However, the enriched `finalResponse` is computed and discarded. If the caller wants `providerSpecific._costUsd` on a per-stream-call basis (e.g. to display cost in a UI), there is no way to get it from the stream. Consider yielding a final summary chunk, or documenting that `getTotalCost()` is the only supported way to observe stream costs.

---

### [P2] `dotenv` missing from `devDependencies`

**File:** `package.json`

`examples/basic.ts` imports `dotenv`, but `dotenv` is not listed in `dependencies` or `devDependencies`:

```ts
import * as dotenv from 'dotenv'; // will fail: Cannot find module 'dotenv'
```

**Fix:** Add `"dotenv": "^16.0.0"` to `devDependencies`.

---

### [P2] Test env vars set at module scope in `providers.test.ts`

**File:** `test/providers.test.ts:24–26`

```ts
process.env.OPENAI_API_KEY = 'test-key';    // module-level, not in beforeEach
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
```

These assignments run once when the module is first loaded and persist for the lifetime of the test process. The `vi.unstubAllEnvs()` in `beforeEach` only reverts keys set via `vi.stubEnv()` — not these manual assignments. The "should throw on missing API key" tests then do `delete process.env.OPENAI_API_KEY`, leaving a torn-down state that can affect test order. Move all env-var setup into `beforeEach` using `vi.stubEnv()`:

```ts
beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
});
```

---

### [P3] `readLines` `TextDecoder` not flushed at end

**File:** `src/utils/stream.ts:9`

The `TextDecoder` is constructed once and used with `{ stream: true }` throughout. At the end of the stream, the decoder may hold a partial multibyte character in its internal state. The decoder is never called with `{ stream: false }` (or called without `{ stream: true }`) to flush that state before the generator returns. For ASCII-only LLM output this is harmless, but for output containing Unicode characters at the exact end of a network chunk, the last character could be silently dropped.

**Suggested fix:** After the read loop breaks, flush the decoder:

```ts
// After 'if (done) break;' exits the while loop:
const remaining = decoder.decode(); // flush decoder state
if (remaining) buffer += remaining;
```

---

### [P3] Cache hit in stream mode yields one full-content chunk instead of streaming chunks

**File:** `src/core/UnifyClient.ts:55–60`

When `CacheMiddleware.beforeRequest` returns a cached `CompletionResponse`, the `stream()` method yields that single response and returns. A consumer iterating the stream receives one chunk with the complete content, which differs from the original streaming behavior of many small delta chunks. This is a surprising inconsistency. Consider documenting this limitation clearly, or have the cache return a flag that the client uses to skip calling `stream()` altogether and fall back to `generate()` behavior.

---

### [P3] Global rate-limit bucket buckets all traffic together

**File:** `src/middlewares/rateLimiter.ts:29`

The default `idKey = 'global'` means all requests across all users share a single rate-limit counter. In a multi-user application this will throttle users based on other users' activity. The constructor accepts a custom `idKey`, but nothing in the `beforeRequest` signature provides a per-user identity to key on. Consider accepting a key-extraction function `(request: CompletionRequest) => string` to enable per-user or per-model bucketing.

---

## Recommendation

Fix the three P1 issues before publishing: Anthropic stream usage is a dead code bug (the `amazonMessageStop` field), Gemini stream usage is an omission, and the `InMemoryCache` memory leak affects every user of the default setup. The P2 Gemini key-in-URL issue is a quick header swap. The `readonly name` and `dotenv` issues are trivial one-liners.
