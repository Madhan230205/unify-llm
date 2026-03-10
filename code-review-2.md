# Code Review — `unify-llm` (Pass 2)

**Verdict**: REQUEST CHANGES  
**Confidence**: HIGH

---

## Summary

The first-pass P1 fixes (Anthropic/Gemini streaming usage, `InMemoryCache` memory cap, Gemini key-in-URL, `readonly name`) are all cleanly applied. However, the new structured-output (`schema`) feature and the SSE parser refactor introduced two new critical bugs: one that silently returns wrong cached data when schemas differ, and one that causes prompt-token counts to be dropped for every Anthropic streaming call.

---

## What Was Fixed ✓

| Was | Status |
|-----|--------|
| Anthropic streaming usage (`amazonMessageStop` dead code) | Fixed — proper `message_start`/`message_delta` events |
| Gemini streaming drops `usageMetadata` | Fixed |
| `InMemoryCache` unbounded growth | Fixed — `maxSize=500` with LRU eviction |
| Gemini API key in URL query string | Fixed — `x-goog-api-key` header |
| `name` not `readonly` on providers | Fixed on all concrete providers |
| `afterResponse` result silently dropped in `stream()` | Fixed — final summary chunk now yielded |
| `TextDecoder` not flushed at end of stream | Fixed in `streamSSE` |

---

## Findings

| Priority | Issue | Location |
|----------|-------|----------|
| P0 | Cache key excludes `schema`/`schemaName` — requests with different schemas share the same key and receive wrong cached data | `src/middlewares/cache.ts:31-37` |
| P1 | Anthropic usage aggregation overwrites prompt token count — `finalUsage` is replaced by the `message_delta` chunk, zeroing out prompt tokens for every Anthropic stream call | `src/core/UnifyClient.ts:75-78` |
| P2 | `streamSSE` process loop is not cancelled on consumer abort — `processStream()` runs undetached to completion even if the caller breaks the `for await` early, holding the HTTP response body open | `src/utils/stream.ts:100-136` |
| P2 | `CompletionResponse.data` added to the type but never populated by any provider — dead surface area that misleads callers | `src/types/index.ts:38` |
| P2 | `dotenv` still missing from `devDependencies` — `examples/basic.ts` crashes on `npm run example` | `package.json` |
| P2 | Test env vars still set at module scope in `providers.test.ts` — not properly reset between tests | `test/providers.test.ts:24-26` |
| P3 | `readLines` is now dead code — all providers were migrated to `streamSSE` but `readLines` is still exported | `src/utils/stream.ts:1-30` |
| P3 | `Message` imported but unused in `gemini.ts` | `src/providers/gemini.ts:2` |
| P3 | `max_tokens: request.maxTokens \|\| 1024` in Anthropic uses `\|\|` instead of `??` — treats `maxTokens: 0` the same as `undefined` | `src/providers/anthropic.ts:32` |
| P3 | `calculateCostUsd` variable name is a misnomer (should be `calculatedCostUsd` or just `costUsd`) | `src/middlewares/costTracker.ts:33` |

---

## Details

### [P0] Cache key excludes `schema` and `schemaName`

**File:** `src/middlewares/cache.ts:31-37`

`CompletionRequest` now has `schema` and `schemaName` fields (added with the structured-output feature), but the cache key is still computed from only `model`, `messages`, `temperature`, and `maxTokens`:

```ts
const data = JSON.stringify({
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    // ← schema and schemaName are missing
});
```

Two requests that are identical except for their schemas will hash to the same key. The second request will receive a response shaped for the *first* schema — silently returning structurally wrong data with no error. This is a data-integrity P0.

**Suggested fix:**

```ts
const data = JSON.stringify({
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    schema: request.schema,
    schemaName: request.schemaName,
});
```

---

### [P1] Anthropic usage aggregation zeroes out prompt tokens in `UnifyClient.stream()`

**File:** `src/core/UnifyClient.ts:75-78`

`AnthropicProvider.streamCompletion` emits two usage chunks:

1. **`message_start`** → `{ promptTokens: N, completionTokens: 0, totalTokens: N }` (prompt token count)
2. **`message_delta`** → `{ promptTokens: 0, completionTokens: M, totalTokens: M }` (output token count)

`UnifyClient.stream()` aggregates usage with:

```ts
if (chunk.usage) finalUsage = chunk.usage;  // replaces, not merges
```

The `message_delta` chunk arrives last and **completely replaces** `finalUsage`. The final aggregated usage for every Anthropic streaming call is:

```ts
{ promptTokens: 0, completionTokens: M, totalTokens: M }
```

Prompt tokens are silently zeroed. `CostTrackerMiddleware` then calculates cost based only on completion tokens, **undercharging by the full prompt cost** (e.g., for `claude-3-5-sonnet`, $3.00/M prompt × N tokens is entirely missed).

**Suggested fix** — merge usage chunks instead of replacing:

```ts
// In UnifyClient.stream(), replace the assignment:
if (chunk.usage) finalUsage = chunk.usage;

// With a merge that accumulates all fields:
if (chunk.usage) {
    if (!finalUsage) {
        finalUsage = { ...chunk.usage };
    } else {
        finalUsage = {
            promptTokens: (finalUsage.promptTokens || 0) + (chunk.usage.promptTokens || 0),
            completionTokens: (finalUsage.completionTokens || 0) + (chunk.usage.completionTokens || 0),
            totalTokens: (finalUsage.totalTokens || 0) + (chunk.usage.totalTokens || 0),
        };
    }
}
```

---

### [P2] `streamSSE` — `processStream()` not cancelled on consumer abort

**File:** `src/utils/stream.ts:100`

`processStream()` is fired without `await` and runs concurrently with the generator yield loop. If the consumer breaks out of the `for await` loop early:

```ts
for await (const event of streamSSE(response.body)) {
    if (event.data.includes('stop')) break; // consumer exits early
}
```

The async generator's internal `while(true)` loop simply stops iterating, but `processStream()` continues running in the background until it has fully read the HTTP response body. The underlying `ReadableStream` is never cancelled. For large responses this holds the HTTP connection and TCP buffers open unnecessarily until the response body is fully consumed.

**Suggested fix** — use `AbortController` or expose a cancel hook, or use the `ReadableStream` cancellation mechanism:

```ts
const processStream = async () => {
    try { ... }
    catch (e) { ... }
    finally { reader.releaseLock(); }
};

// In the generator's cleanup (add a try/finally to the while loop):
try {
    while (true) { ... yield ... }
} finally {
    // Signal processStream to stop if still running
    reader.cancel().catch(() => {});
}
```

---

### [P2] `CompletionResponse.data` declared but never populated

**File:** `src/types/index.ts:38`

```ts
export interface CompletionResponse {
    content: string;
    data?: any;       // ← added, but never set by OpenAI, Anthropic, Gemini, or Ollama
    model: string;
    ...
}
```

No provider sets `response.data`. The Anthropic structured-output path serialises the tool-use result into `content` as a JSON string, and the OpenAI path returns JSON in `content` as well. Callers who discover the `data` field and rely on it will always get `undefined`. Either populate it with parsed JSON in the schema paths, or remove the field. Leaving it as dead surface area causes confusion.

---

### [P2] `dotenv` missing from `devDependencies` (unresolved from pass 1)

**File:** `package.json`

`examples/basic.ts` still imports `import * as dotenv from 'dotenv'`, but `dotenv` is not listed in `dependencies` or `devDependencies`. `npm install` in a fresh checkout gives no `dotenv`, and the example crashes immediately.

**Fix:** Add `"dotenv": "^16.0.0"` to `devDependencies`.

---

### [P2] Test env vars still at module scope (unresolved from pass 1)

**File:** `test/providers.test.ts:24-26`

```ts
process.env.OPENAI_API_KEY = 'test-key';    // module-level
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';
```

`vi.unstubAllEnvs()` in `beforeEach` only reverts keys set via `vi.stubEnv()`, not these direct assignments. The "should throw on missing API key" tests then `delete process.env.OPENAI_API_KEY`, leaving a permanent hole that depends on test ordering for recovery. Move all env-var setup into `beforeEach`:

```ts
beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
});
```

---

## Recommendation

Two must-fix issues before merging the structured-output feature:

1. **Add `schema`/`schemaName` to the cache key** — this is a one-line addition that prevents silent wrong-data returns.
2. **Merge, don't replace, usage chunks in `UnifyClient.stream()`** — Anthropic splits prompt and completion token counts across two separate events; overwriting loses prompt tokens and causes systematic cost undercounting.

The `streamSSE` consumer-abort resource leak and the dangling `data` field are lower urgency but should be tracked. The `dotenv` and test env-var issues from pass 1 are still open.
