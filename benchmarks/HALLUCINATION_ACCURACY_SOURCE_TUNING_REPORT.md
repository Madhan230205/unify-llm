# Hallucination Accuracy Source-Tuning Report (Live Gemini, 100 and 1000 Samples)

## Executive Summary

This report documents a **source-level accuracy tuning effort** for hallucination detection in `unify-llm`.

Key requirement from the user was explicit:

- **Do not tune benchmark samples**
- **Tune production source files** to improve real hallucination accuracy

This requirement was followed by:

1. Updating production logic in `src/algorithms/hallucinationInterception.ts`
2. Adding regression tests to lock in the new behavior
3. Running live Gemini benchmark passes on:
	- **100 real samples**
	- **1000 real samples**

Final outcome:

- 100-sample live run: advanced detector F1 improved from **27.91% → 64.00%**
- 1000-sample live run: advanced detector F1 improved from **34.07% → 69.26%**
- Full test suite remained green after source changes

---

## Scope and Constraints

### In Scope

- Production detector behavior in `src`
- Hallucination classification quality on live Gemini responses
- Regression safety via unit/integration tests

### Out of Scope

- Synthetic-only tuning
- Prompt/sample-only tuning as the primary optimization method

### Runtime Configuration Used for Live Benchmarks

- Provider model: `gemini-2.0-flash`
- API: live Gemini responses
- Benchmark script: `benchmarks/gemini-overengineering-proof.ts`
- Parallelism: conservative (`BENCH_PARALLEL=1`) for stability/quota friendliness
- Judge mode for these runs: `BENCH_USE_LLM_JUDGE=false` (keyword fallback), to reduce judge-call multiplier and avoid additional quota pressure during scaling checks

---

## Root Cause Identified Before Source Tuning

The benchmark pipeline already computed two highly relevant risk signals:

- `impossibilityPrior` (prompt-side impossibility signal)
- `epistemicDisclosure` (response-side uncertainty disclosure signal)

However, these signals were not sufficiently integrated into the **production detector decision boundary** in `src/algorithms/hallucinationInterception.ts`.

Practical failure mode:

- Confident fabricated answers to impossible prompts could escape with weak penalties
- Clear uncertainty disclosures for impossible prompts could still be penalized by generic drift/entropy heuristics

---

## Source Changes Implemented

### File Updated

- `src/algorithms/hallucinationInterception.ts`
- `src/algorithms/promptAnswerability.ts`
- `src/algorithms/index.ts`

### New Logic Added

1. **Prompt impossibility prior (source-side heuristic)**
	- Added `computePromptImpossibilityPrior(promptText)`
	- Scores inherently unanswerable/speculative/private/future-sensitive prompts

2. **Epistemic disclosure detection (source-side heuristic)**
	- Added `hasEpistemicDisclosure(text)`
	- Detects explicit uncertainty/refusal phrases

3. **Disclosure-aware anomaly scoring and gating**
	- Introduced `disclosureSafeResponse` concept
	- Reduced anomaly impact when prompt is impossible and response discloses uncertainty
	- Increased anomaly when prompt is impossible and response is confidently non-disclosing

4. **Risk-path integration into existing decision pipeline**
	- Added `impossibilityNonDisclosure` as an anomaly contributor
	- Added weighted anomaly score adjustments for this signal
	- Preserved existing topology/entropy/loop evidence pathways (no removal)

5. **Answerability classification layer (new module)**
	 - Added `classifyPromptAnswerability(prompt)` returning:
		 - `answerable`
		 - `unanswerable`
		 - `speculative`
	 - Added confidence and per-class scores
	 - Integrated into detector to prevent **refusal bias**:
		 - unanswerable/speculative + non-disclosure → risk increases
		 - answerable + evasive uncertainty/refusal → suspicious (risk increases)
		 - impossible + explicit uncertainty disclosure → risk reduced

### Behavior Intent

- Improve recall for high-risk fabricated content on impossible prompts
- Reduce false positives for responsible “cannot know / unknown” responses
- Preserve prior detector strengths for geometric/topological anomaly signals

---

## Regression and Safety Tests Added

### File Updated

- `test/hallucinationInterception.test.ts`
- `test/promptAnswerability.test.ts`

### New Test Coverage

1. **Disclosure risk reduction test**
	- Confirms a disclosed uncertainty response on impossible prompt has lower anomaly score than fabricated confident response

2. **Impossible prompt safe refusal test**
	- Confirms a clear refusal on private/impossible request does not force abort and keeps anomaly score below risk cutoff

3. **Answerable prompt refusal-bias test**
	- Confirms evasive refusal on answerable prompts scores riskier than a factual answer

4. **Prompt answerability classifier tests**
	- Verifies classification and disclosure detection for:
	  - answerable prompts
	  - unanswerable prompts
	  - speculative prompts

---

## Validation Runs Performed

## Local detector validation

- Focused tests:
	- `test/promptAnswerability.test.ts`
  - `test/hallucinationInterception.test.ts`
  - `test/hallucinationInterception.comprehensive.test.ts`
- Result:
  - **11/11 passed**

## Full suite regression

- `npm test`
- Result:
  - **32 passed | 1 skipped** test files
  - **225 passed | 1 skipped** tests

---

## Live Benchmark Results (Real Gemini Data)

## 100-sample run

Report file:

- `benchmarks/gemini-overengineering-proof-100.json`

Metrics:

| Metric | Baseline | Advanced | Delta |
|---|---:|---:|---:|
| Accuracy | 61.25% | **88.75%** | **+27.50 pp** |
| Precision | 20.00% | **66.67%** | **+46.67 pp** |
| Recall | 46.15% | **61.54%** | **+15.39 pp** |
| F1 | 27.91% | **64.00%** | **+36.09 pp** |
| False Positive Rate | 35.82% | **5.97%** | **-29.85 pp** |

Operational stats:

- Avg latency: `1059.73 ms`
- Duration: `105993.15 ms`
- Errors: `0`

## 1000-sample run

Report file:

- `benchmarks/gemini-overengineering-proof-1000.json`

Metrics:

| Metric | Baseline | Advanced | Delta |
|---|---:|---:|---:|
| Accuracy | 62.75% | **88.13%** | **+25.38 pp** |
| F1 | 34.07% | **69.26%** | **+35.19 pp** |

Operational stats:

- Avg latency: `1113.01 ms`
- Duration: `1113093.37 ms`
- Errors: `0`

---

## Interpretation

The source tuning produced a strong and consistent improvement under real API traffic:

- Large F1 gains on both 100 and 1000 samples
- Significant false-positive reduction in 100-sample run
- Improvement preserved at scale (1000-sample run)

This indicates the new production detector logic better aligns with a critical realism constraint:

- **Impossible question + no uncertainty disclosure** should be considered high hallucination risk
- **Impossible question + explicit uncertainty disclosure** should be treated as safer behavior

---

## Files Changed in This Tuning Cycle

- `src/algorithms/hallucinationInterception.ts`
  - Added impossibility/disclosure-aware scoring and anomaly gating

- `src/algorithms/promptAnswerability.ts`
	- Added explicit answerability classifier and disclosure detector

- `src/algorithms/index.ts`
	- Exported prompt answerability module

- `test/hallucinationInterception.test.ts`
  - Added regression tests for impossible-prompt behavior

- `test/promptAnswerability.test.ts`
	- Added classifier behavior tests

- `benchmarks/HALLUCINATION_ACCURACY_SOURCE_TUNING_REPORT.md`
  - This detailed report

---

## Reproducibility Notes

The benchmark script used for both live runs:

- `benchmarks/gemini-overengineering-proof.ts`

Output artifacts generated by runs:

- `benchmarks/gemini-overengineering-proof-100.json`
- `benchmarks/gemini-overengineering-proof-1000.json`

The measured improvements in this report are taken directly from those generated artifacts.

---

## Suggested Next Step (Optional)

If desired, run a secondary quality pass with `BENCH_USE_LLM_JUDGE=true` on a smaller sample count to compare keyword-fallback labeling vs judge-assisted labeling under the new source logic.

