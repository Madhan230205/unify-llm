# Hacker News Launch (Title: Show HN)

**Title:** Show HN: unify-llm – A zero-dependency, 15KB alternative to LangChain/Vercel AI SDK

**Body:**

Hey HN,

I noticed a common fatigue among TS/JS developers building LLM features. We're often forced to choose between the vendor lock-in of Vercel AI SDK (if you aren't using Next.js, it's a pain) or the extreme over-abstraction of LangChain (`PromptTemplate.fromMessages(...)`). Furthermore, both of these pull in massive dependency trees.

I built `unify-llm` to be an "anti-framework". It does exactly three things:
1. Provides a single, unified `CompletionRequest/Response` interface mapping for OpenAI, Anthropic, Gemini, and Ollama using native `fetch`. 
2. Has 0 production dependencies.
3. Has a simple middleware pipeline. I built native Cost Tracking (calculates exact USD spend based on tokens), Exact-Key Caching (stop paying twice for the same prompt), and Rate-limiting out of the box.

It has 100% test coverage and is incredibly lightweight. If you're building CLI tools, background workers, or just want a clean TS wrapper without the bloat, give it a look.

Repo: https://github.com/yourusername/unify-llm
NPM: https://www.npmjs.com/package/unify-llm

Would love any feedback on the middleware design.

---

# Reddit (r/typescript or r/javascript)

**Title:** I got tired of 14MB AI wrappers. So I built one with 0 dependencies in ~14KB.

**Body:**

If you are trying to talk to LLMs in a node script, an Express app, or a CLI tool, you've probably noticed that Vercel AI SDK and LangChain feel incredibly heavy. Vercel assumes you are using React/Edge, and Langchain assumes you want architecture-astronaut levels of abstraction. 

I just wanted a type-safe `fetch` wrapper that normalizes the schemas for OpenAI, Anthropic, Gemini, and Ollama, without dragging in 50 sub-dependencies.

So I built `unify-llm`. 

You just register providers, and construct a standard `{ model, messages }` object. 

The fun part is the middleware: it ships with `CostTrackerMiddleware` (computes exact USD cost from the token usage response) and `CacheMiddleware` (hashes requests to intercept identical prompts, saving you money). 

It has 100% test coverage using Vitest. Check it out and let me know if it solves the "heavy SDK" problem for you!

[Link to Github / NPM]

---

# X (Twitter) Thread

**Tweet 1:**
I got tired of 14MB AI packages. So I built a 14KB alternative with 0 dependencies. 

Introducing `unify-llm` ⚡

A 100% type-safe, universal wrapper for OpenAI, Anthropic, Gemini, & Ollama.

Say goodbye to LangChain abstraction and Vercel lock-in. 👇🧵

**Tweet 2:**
The problem:
❌ Vercel AI SDK is incredible... if you use Next.js. Try using it in a background worker and it's a headache.
❌ LangChain is too abstract. You shouldn't need 4 chained classes just to send a string.

`unify-llm` just uses native fetch and a unified `CompletionRequest` type.

**Tweet 3:**
But standardizing the API isn't enough. We need to respect the wallet. 💰

`unify-llm` ships with pure plug-and-play middleware.

✨ `CostTrackerMiddleware`: Reads token usage in real-time and calculates exact USD costs so you don't go bankrupt.

**Tweet 4:**
✨ `CacheMiddleware`: Hashes your prompt. If you send the exact same request twice, it short-circuits and resolves instantly. You pay $0 to OpenAI on the second hit.

It defaults to InMemory, but easily accepts a Redis adapter.

**Tweet 5:**
It's built with 0 production dependencies, ships CJS/ESM via tsup, and boasts 100% test coverage.

Ready to rip out your bloated AI dependencies? Try it out now: 
`npm i unify-llm`

📦 NPM: [Link]
🐙 Github: [Link]
