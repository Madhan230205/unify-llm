# Contributing to Unify LLM

Thanks for contributing.

This project explores multi-provider LLM orchestration in TypeScript. The codebase includes both production-oriented APIs and some intentionally experimental math-heavy modules. This guide is here to make contribution paths clear and boring—in a good way.

## What to expect

The public goal of the library is straightforward:

- provide one `UnifyClient` interface across providers
- normalize tool calling and streaming behavior
- support middleware, routing, and safety controls
- keep advanced routing/safety primitives testable and optional

Some internal modules use stylized names. When contributing:

- prefer **plain-English descriptions** in docs, comments, PRs, and issues
- preserve backwards compatibility for exported APIs unless a breaking change is intentional
- when adding new APIs, prefer descriptive names over metaphorical ones
- if you touch an experimental subsystem, document what it does in practical terms

## Development setup

### Requirements

- Node.js 20+
- npm 10+

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

Run the full suite:

```bash
npm test
```

Run coverage:

```bash
npm run test:coverage
```

Run benchmarks:

```bash
npm run benchmark
```

Run the fast benchmark smoke test:

```bash
npm run benchmark:quick
```

## Project layout

- `src/providers/` — provider adapters
- `src/middlewares/` — request/response/stream middleware
- `src/routers/` — model routing strategies
- `src/algorithms/` — reusable decision and analysis primitives
- `src/analytics/` — lower-level math/statistics utilities
- `test/` — unit and integration tests
- `examples/` — runnable usage examples
- `benchmarks/` — synthetic and evaluation harnesses

## Contribution guidelines

### 1. Keep public APIs understandable

If a symbol is user-facing, optimize for clarity.

Good:
- `createHallucinationGuard`
- `inspectRouterHealth`
- `profilePrompt`

Less ideal for new APIs:
- names that require project lore to decode

Backward-compatible aliases are welcome when they improve usability.

### 2. Add or update tests with code changes

If you change:

- routing behavior
- middleware behavior
- provider normalization
- streaming behavior
- math/safety heuristics

please add or update tests in `test/`.

### 3. Document behavior changes

Update `README.md` when you:

- add a new public API
- change installation or setup
- change supported provider behavior
- add a new major router, middleware, or safety primitive

### 4. Keep changes focused

Prefer small PRs over broad refactors.

Examples:
- add one router improvement + tests
- improve one provider normalization edge case + docs
- add one contributor-facing doc improvement

### 5. Be careful with breaking changes

If you rename or remove exports:

- call out the breaking change clearly
- provide aliases or migration notes when possible
- update examples and README references

## Pull request checklist

Before opening a PR, please verify:

- [ ] `npm run build` succeeds
- [ ] `npm test` succeeds
- [ ] docs/examples were updated if needed
- [ ] new behavior is covered by tests
- [ ] user-facing names and descriptions are plain-English where possible

## Reporting issues

When filing an issue, please include:

- what you expected
- what happened instead
- provider/model involved, if relevant
- a minimal reproduction
- logs or screenshots if helpful

## Discussion of experimental modules

Some analytics and routing modules are intentionally exploratory. Contributions are still welcome—but please describe them by their practical role, for example:

- “semantic drift detector” instead of only the codename
- “tool-loop risk scoring” instead of only the metaphor
- “cost/latency/quality router” instead of only the internal research label

That makes the project easier to maintain and easier for new contributors to join.

## Code of collaboration

Be kind, specific, and evidence-driven.

Strong opinions are welcome. Vague drive-by cosmic prophecies are less helpful.
