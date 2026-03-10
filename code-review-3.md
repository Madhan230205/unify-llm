# Code Review — Pass 3
**Project:** `unify-llm`  
**Verdict:** ✋ REQUEST CHANGES  
**Reviewer pass:** 3 of 3  

---

## Progress Since Pass 2

Every issue surfaced in Pass 2 has been addressed. The codebase has also grown substantially with two new features: **structured-output schema parsing** and **Anthropic prompt-caching support** (with cascading cost-tracking updates). The regression rate is trending down strongly.

| Pass 2 Finding | Status |
|---|---|
| P0 — Cache key excludes `schema`/`schemaName` | ✅ FIXED — both fields now included in `generateKey()` |
| P1 — `stream()` usage accumulation replaced entire object | ✅ FIXED — proper merge across all six token fields |
| P2 — `dotenv` missing from devDependencies | ✅ FIXED — `"dotenv": "^16.4.5"` in devDeps |
| P2 — Test env vars set at module scope | ✅ FIXED — all keys now stubbed via `vi.stubEnv()` in `beforeEach()` |
| P2 — `CompletionResponse.data` was a dead field | ✅ FIXED — `UnifyClient` now parses `content → data` for schema requests |
| P2 — `streamSSE` consumer-abort resource leak | ✅ FIXED — `reader.cancel()` in generator's `finally` block |
| P3 — `readLines` dead code | ✅ FIXED — renamed `streamNDJSON`, actively used by `OllamaProvider` |

---

## New Findings

### P1 — Anthropic Prompt Caching Feature Is Silently Non-Functional

**File:** [src/providers/anthropic.ts](src/providers/anthropic.ts)  
**Affected methods:** `generateCompletion`, `streamCompletion` (both call `buildPayload` which emits `cache_control` blocks)

The `cachePrompt` feature adds `cache_control: { type: 'ephemeral' }` to message content blocks and expects `cache_creation_input_tokens` / `cache_read_input_tokens` back in the usage response. **None of this will work** because Anthropic's prompt-caching API requires the `anthropic-beta: prompt-caching-2024-07-31` request header, which is absent from both `generateCompletion` and `streamCompletion`:

```typescript
// current — both methods
headers: {
    'Content-Type': 'application/json',
    'x-api-key': this.apiKey,
    'anthropic-version': '2023-06-01'
    // ← 'anthropic-beta' header missing entirely
}
```

Without this header the Anthropic API silently discards all `cache_control` fields, never writes to the prompt cache, and never returns the caching-specific token counts. The entire feature appears to work (no exceptions thrown) but produces zero actual cache hits. `cacheCreationTokens` and `cacheReadTokens` will always be 0, and users will pay full input token prices.

**Fix:** Add the beta header conditionally — only when the request contains at least one message with `cachePrompt: true`, or unconditionally since the header has no effect when no `cache_control` blocks are present:

```typescript
headers: {
    'Content-Type': 'application/json',
    'x-api-key': this.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'prompt-caching-2024-07-31'
}
```

---

### P2 — `cachePrompt: true` on `system` Role Messages Is Silently Ignored

**File:** [src/providers/anthropic.ts](src/providers/anthropic.ts)  
**Method:** `buildPayload`

System message caching is one of the most common and highest-value use cases for Anthropic prompt caching (system prompts are often large and repeated across every request). The current implementation strips system messages before the `cachePrompt` mapping loop:

```typescript
// Line ~25 in buildPayload
const systemMessage = request.messages.find(m => m.role === 'system')?.content;
const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

const messages = nonSystemMessages.map((msg) => {
    if (msg.cachePrompt) {
        return { ..., cache_control: { type: 'ephemeral' } };
        //          ↑ system messages never reach this branch
    }
```

The system message is later assigned as a plain string: `payload.system = systemMessage`. The Anthropic API requires the array format to apply caching to a system prompt:

```typescript
// Anthropic API format for a cacheable system prompt
"system": [
    { "type": "text", "text": "...", "cache_control": { "type": "ephemeral" } }
]
```

**Fix:**

```typescript
const systemMsg = request.messages.find(m => m.role === 'system');
if (systemMsg) {
    payload.system = systemMsg.cachePrompt
        ? [{ type: 'text', text: systemMsg.content, cache_control: { type: 'ephemeral' } }]
        : systemMsg.content;
}
```

---

### P3 — `Message.cachePrompt` Silently Ignored by All Non-Anthropic Providers

**File:** [src/types/index.ts](src/types/index.ts)

`cachePrompt` is a field on the shared `Message` type, implying it is a first-class library concept. However it is:
- Silently ignored by `OpenAIProvider` (OpenAI caches automatically from a certain context length; there is no per-message hint)
- Silently ignored by `GeminiProvider` (Gemini context caching is a different pre-creation API, not per-message)
- Silently ignored by `OllamaProvider` (no caching concept at all)

A developer who sets `cachePrompt: true` and switches providers will observe confusing behavior — the field changes cost outcomes on Anthropic but has no effect elsewhere with no warning.

**Fix:** Add a JSDoc comment on the field clarifying the scope:

```typescript
/**
 * When `true`, instructs Anthropic to apply prompt caching to this message
 * (`cache_control: { type: 'ephemeral' }`).  
 * **Only effective for `AnthropicProvider`. Silently ignored by all other providers.**
 * Requires the `anthropic-beta: prompt-caching-2024-07-31` header to be active.
 */
cachePrompt?: boolean;
```

---

### P3 — `UnifyClient.generate()` Mutates Provider Response In-Place

**File:** [src/core/UnifyClient.ts](src/core/UnifyClient.ts)

```typescript
let response = await provider.generateCompletion(currentRequest as CompletionRequest);

if (request.schema && response.content) {
    try {
        response.data = JSON.parse(response.content);  // ← in-place mutation
    } catch (e) { }
}
```

The object reference returned by `provider.generateCompletion()` is mutated before being passed to the `afterResponse` middleware chain. While this is safe in the current codebase (providers return fresh objects), it makes future refactoring hazardous — e.g., if a provider ever returns a cached or pooled response object, this mutation would have side effects. It also means the `data` field is visible to `afterResponse` middlewares, which is inconsistent with the streaming path where `data` is only present on the final summary chunk after `afterResponse` runs.

**Fix:** Use a shallow clone to avoid mutating the provider response:

```typescript
let response = await provider.generateCompletion(currentRequest as CompletionRequest);

if (request.schema && response.content) {
    try {
        response = { ...response, data: JSON.parse(response.content) };
    } catch (e) { }
}
```

---

### P3 — Ollama Streaming Does Not Surface `usage` Statistics

**File:** [src/providers/ollama.ts](src/providers/ollama.ts)

`generateCompletion` correctly maps `prompt_eval_count` / `eval_count` to `usage`. `streamCompletion` does not:

```typescript
for await (const data of streamNDJSON(response.body)) {
    yield {
        content: data.message?.content || '',
        model: data.model || request.model,
        providerSpecific: data    // ← usage data is only reachable via providerSpecific
    };
    if (data.done) break;
}
```

The Ollama stream's final message (`done: true`) contains both the last content token and the token counts. The current code drops the counts from the structured `usage` field, so `UnifyClient.stream()` will always yield a final summary chunk with `usage: undefined` for Ollama. This was present before the current feature additions but remains unfixed.

**Fix:** Map usage on the final chunk:

```typescript
yield {
    content: data.message?.content || '',
    model: data.model || request.model,
    usage: data.done ? {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
    } : undefined,
    providerSpecific: data
};
```

---

## What Is Working Well

- **`streamSSE` correctness** — The `createParser` + `processStream` + generator pattern is well-structured. The `reader.cancel()` in the generator's `finally` block correctly terminates the background `processStream` task when consumers exit early.
- **Cost tracker cache-discount logic** — The split between OpenAI/Gemini's implicit `cachedTokens` (subtracted from `promptTokens`) and Anthropic's explicit `cacheCreationTokens`/`cacheReadTokens` is handled correctly. The unit tests validate the math for both patterns.
- **Cache correctness with structured output** — The cache key now includes `schema` + `schemaName`. Cached responses carry the pre-parsed `data` field, so the cache hit path and the live path are behaviorally identical.
- **Aetherion mid-stream fallback** — `rewriteRequestForResume` appending a partial `assistant` message is a clean design. The `seamlessMidStreamFallback: false` guard is correct.
- **Test coverage** — All new features (schema parsing in generate and stream, both cache discount models) have dedicated tests. `providers.test.ts` now uses proper `vi.stubEnv()` isolation.
- **`InMemoryCache` LRU eviction** — Correctly uses Map insertion order to approximate LRU with `O(1)` eviction.

---

## Test Coverage Gap

There is no test that verifies `cachePrompt` behaviour — neither that the API payload includes `cache_control` blocks, nor that the resulting usage fields map correctly. Given the P1 bug above (missing beta header), any test written before the header is added would pass vacuously because the API silently ignores the field.

After the beta header is added, add a test in `providers.test.ts` for:
1. A request with `cachePrompt: true` on a user message → assert the request body contains the array content format with `cache_control`
2. A request with `cachePrompt: true` on a system message (once P2 is fixed) → assert `payload.system` is an array

---

## Summary

| Priority | Count | Items |
|---|---|---|
| P1 | 1 | Missing `anthropic-beta` header renders prompt caching non-functional |
| P2 | 1 | System message `cachePrompt` silently discarded |
| P3 | 3 | `cachePrompt` undocumented cross-provider behavior; in-place response mutation; Ollama streaming drops usage |

The prompt-caching feature is well-designed architecturally and the cost-tracker integration is solid — it just needs the one-line header fix to go live. Resolve the P1, address the P2 system-message case, and add tests before shipping the caching feature.
