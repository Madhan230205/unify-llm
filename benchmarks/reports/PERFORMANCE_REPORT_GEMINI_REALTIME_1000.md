# Gemini 1000 Real-Data Overall Kit Report

Generated: 2026-03-13  
Model: `gemini-2.0-flash`  
Environment: Windows + Node.js (`tsx`)  

This report combines two **live Gemini** benchmark tracks for 1000 samples:

1. **Realtime System Track** (`gemini-realtime-parallel.ts`): reliability, latency, signal completeness, trigger distribution.  
2. **Hallucination Quality Track** (`gemini-overengineering-proof.ts`): LLM-judge labeled hallucination detection, baseline vs advanced detector metrics.

## ✅ Feature Coverage (Real Data)

- Live API execution stability
- End-to-end response analysis through `ResponseAnomalyDetector` (`HallucinationInterceptionAlgorithm`)
- Signal-level telemetry (curvature, drift, entropy, topology, loop fields)
- 1000-sample hallucination labeling with LLM judge + policy override
- Baseline vs advanced detector calibration and confusion-matrix metrics

## Realtime System Track (1000 samples)

Source: `benchmarks/gemini-realtime-100.json`

| Metric | Value |
| --- | ---: |
| Success count | 1000 |
| Failure count | 0 |
| Avg latency | 2610.99 ms |
| Total duration | 284866.23 ms |
| Throughput | 3.51 samples/sec |
| Signal completeness | 1000/1000 |
| Anomaly count | 987 |
| Anomaly rate | 98.70% |

### Trigger reason histogram

- `entropy-spike`: 984 (98.40%)
- `none`: 13 (1.30%)
- `topological-drift`: 2 (0.20%)
- `low-retention`: 1 (0.10%)

## Hallucination Quality Track (1000 total, 800 eval)

Source: `benchmarks/gemini-overengineering-proof-1000.json`

### Dataset + calibration

- Total samples: 1000
- Calibration: 200
- Evaluation: 800
- Ground-truth hallucinations (full set): 192
- Labeling method counts: `llm-judge=811`, `keyword-fallback=0`, policy override applied on unanswerable non-disclosure

### Evaluation distribution details

- Evaluation factual count: **400**
- Evaluation unanswerable count: **400**
- Evaluation hallucination prevalence: **17.63%** (141/800)

### Baseline vs Advanced detector metrics

| Metric | Baseline | Advanced | Delta (Advanced - Baseline) |
| --- | ---: | ---: | ---: |
| Accuracy | 64.38% | 84.13% | **+19.75 pp** |
| Precision | 28.88% | 59.22% | **+30.34 pp** |
| Recall | 65.07% | 41.78% | **-23.29 pp** |
| F1 | 40.00% | 49.00% | **+9.00 pp** |
| False Positive Rate | 35.78% | 6.42% | **-29.36 pp** |

### Confusion matrix (evaluation set)

Baseline:

- TP: 95
- FP: 234
- TN: 420
- FN: 51

Advanced:

- TP: 61
- FP: 42
- TN: 612
- FN: 85

Interpretation: the advanced detector is **far more conservative and production-friendly** (massive FP reduction), at the tradeoff of lower recall.

### Derived quality diagnostics (evaluation set)

| Metric | Baseline | Advanced | Delta (Advanced - Baseline) |
| --- | ---: | ---: | ---: |
| Specificity (TNR) | 63.13% | 92.87% | **+29.74 pp** |
| False Negative Rate (FNR) | 35.46% | 58.16% | +22.70 pp |
| Negative Predictive Value (NPV) | 89.27% | 88.18% | -1.09 pp |
| Balanced Accuracy | 63.83% | 67.36% | **+3.53 pp** |
| MCC | 0.214 | 0.390 | **+0.176** |
| Abort Rate | 41.75% | 13.25% | **-28.50 pp** |

### Class-conditional behavior (evaluation set)

| Behavior metric | Baseline | Advanced |
| --- | ---: | ---: |
| Abort on hallucination cases | 64.54% | 41.84% |
| Abort on non-hallucination cases | 36.87% | 7.13% |
| Abort on factual prompts | 15.00% | 7.00% |
| Abort on unanswerable prompts | 68.50% | 19.50% |

This confirms the advanced detector is tuned toward **false-positive suppression** and restraint on factual prompts.

## Advanced detector setup snapshot

- Non-disclosure threshold: `0.26`
- Disclosure threshold: `0.54`
- Immediate threshold: `0.58`
- Calibrated fusion threshold: `0.50`

### Score and latency distribution diagnostics

#### Evaluation latency percentiles (ms)

| Percentile | Value |
| --- | ---: |
| p50 | 2186.15 |
| p90 | 2679.91 |
| p95 | 2897.48 |
| p99 | 5329.64 |
| min | 810.42 |
| max | 7857.53 |

#### Advanced fusion score percentiles

| Percentile | Value |
| --- | ---: |
| p50 | 0.184859 |
| p90 | 0.453444 |
| p95 | 0.538539 |
| p99 | 0.611157 |
| min | 0.000001 |
| max | 0.670067 |

Threshold placement implication:

- `disclosureThreshold=0.54` sits near the **p95** fusion region.
- `immediateThreshold=0.58` sits between **p95 and p99**, catching only high-risk tails.

## Practical verdict

1. **Runtime stability:** excellent (0 API failures at 1000/1000).  
2. **Hallucination quality:** strong net improvement in production-grade precision/FPR while improving F1.  
3. **Current risk profile:** aggressive entropy triggering remains visible in raw signal stream; decision-layer calibration successfully suppresses much of that noise in final advanced predictions.

## Methodology notes (for auditability)

1. **Live generation:** all 1000 prompts were generated using Gemini API calls (no synthetic model outputs).
2. **Ground truthing:** LLM-judge labeling was enabled; keyword fallback was not used in this run; policy override marked unanswerable + non-disclosure as hallucination.
3. **Calibration protocol:** 200-sample stratified calibration set, 800-sample evaluation set, seed `1337`.
4. **Detector comparison:**
   - Baseline: entropy spike OR curvature/drift thresholds.
   - Advanced: disclosure-aware dual-threshold fusion over anomaly/topology/instability energies.
5. **Interpretation caution:** advanced detector is optimized for production precision/FPR control, not maximum recall.

## Artifacts

- Realtime 100 baseline: `benchmarks/gemini-realtime-100-baseline.json`
- Realtime 1000: `benchmarks/gemini-realtime-100.json`
- Hallucination 1000: `benchmarks/gemini-overengineering-proof-1000.json`
- Overall report: `benchmarks/PERFORMANCE_REPORT_GEMINI_REALTIME_1000.md`

## Notes on “all features” scope

This run is comprehensive for **Gemini-backed runtime + hallucination stack** on real data.
Features that require multi-provider credentials (for true real-data Pareto cross-provider routing/cost savings) are not included in this Gemini-only run.
