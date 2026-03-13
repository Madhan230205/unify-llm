## SIGNAL DEBUGGING GUIDE

This guide helps fix the 3 broken signals to improve hallucination detection from 75% to 85%+.

---

## Signal 1: Curvature (Priority: HIGH)

**Problem:** Always returns 0.0
**Effect:** 0% detection effectiveness
**Location:** `src/analytics/semanticTrajectory.ts` + `hallucinationInterception.ts` line ~180

### Debugging Checklist

```typescript
// In hallucinationInterception.ts::evaluateChunk()
const curvature = this.trajectory.getWindowedCurvature(2);
// ^^ This always = 0.0
```

**Check:**
1. Is `trajectory.pushCoordinate()` being called? (Added at line ~175)
2. Are coordinates being stored? Log: `console.log(this.trajectory.coordinates.length)`
3. Does `getWindowedCurvature(2)` have enough points? Needs at least 3 points.

### Quick Fix
Replace this:
```typescript
const curvature = this.trajectory.getWindowedCurvature(2);
if (curvature > 0.6) { /* abort */ }
```

With this (temporary):
```typescript
// TEMPORARY: Disable curvature until fixed
const curvature = this.trajectory.getWindowedCurvature(2);
// const isCurvatureAnomaly = curvature > 0.6;
const isCurvatureAnomaly = false; // Disabled pending investigation
```

---

## Signal 2: Loop Divergence (Priority: CRITICAL)

**Problem:** Spectral radius is ALWAYS 0.9999..., providing zero discrimination
**Effect:** 0% detection effectiveness + misfires on all responses
**Root Cause:** Either spectral computation is wrong, or it's a fixed code path
**Location:** `src/analytics/loopRiskEngine.ts` function `assessDynamicLoopRisk()`

### Debugging Checklist

```typescript
// In loopRiskEngine.ts
export function assessDynamicLoopRisk(
    transitionWindow: DynamicTransitionObservation[],
    options?: LoopRiskOptions
): LoopDivergenceMetric {
    // The spectral radius computation
    // ...
    return {
        divergent: spectralRadius > options.divergenceThreshold,
        spectralRadius, // <-- THIS IS ALWAYS 0.9999...
        ...
    };
}
```

**Questions to investigate:**
1. Is the transition window actually being populated?
   - Log: `console.log('Transitions:', transitionWindow.length, transitionWindow)`
2. If empty, why isn't HIA tracking state transitions?
3. If populated, are you actually computing eigenvalues?
   - Check if `computeSpectralRadius()` is just returning a constant

### Minimal Reproduction Test

```typescript
import { assessDynamicLoopRisk } from '../src/analytics/loopRiskEngine';

const fakeTransitions = [
    { from: 'stable', to: 'drifting', changeRate: 0.1, timestamp: 0 },
    { from: 'drifting', to: 'anomalous', changeRate: 0.5, timestamp: 1 },
    { from: 'anomalous', to: 'stable', changeRate: 0.2, timestamp: 2 },
];

const result = assessDynamicLoopRisk(fakeTransitions);
console.log('Spectral radius:', result.spectralRadius);
console.log('Expected: NOT 0.9999');
```

### Quick Fix (Temporary)

```typescript
// In hallucinationInterception.ts::evaluateChunk()
const loopRiskAssessment = assessDynamicLoopRisk(this.transitions, {
    smoothing: 0.1,
    divergenceThreshold: 0.985,
});

// TEMPORARY: Disable loop divergence until fixed
// It currently misfires on all responses
// const loopDivergent = loopRiskAssessment.divergent;
const loopDivergent = false; // Disabled pending investigation
```

---

## Signal 3: Entropy Spike (Priority: MEDIUM)

**Problem:** `entropySpike` flag never gets set to true
**Effect:** 0% detection effectiveness
**Likely Cause:** Spike threshold is too high or entropy calculation is normalized incorrectly
**Location:** `src/algorithms/hallucinationInterception.ts` line ~200

### Debugging Checklist

```typescript
// In evaluateChunk()
const entropy = ManifoldExtractor.calculateEntropy(chunk);
this.entropyStats.add(entropy);

// Check spike logic
const entropyAnomalous = entropy > (this.entropyStats.mean + 2 * Math.sqrt(this.entropyStats.variance));
signal.entropySpike = entropyAnomalous;
```

**Log these values:**
- What are typical entropy values? (Seen: 3.9-4.3)
- What's the mean? (Likely 4.1)
- What's the variance? (Likely small: 0.01-0.1)
- What's the spike threshold? (mean + 2σ ≈ 4.1 + 0.2 = 4.3)

**Issue:** If all entropy values are 3.9-4.3, and threshold is 4.3, only ~2.5% will spike.

### Quick Fix

Lower the threshold:

```typescript
// OLD: entropy > (mean + 2σ)
const entropyAnomalous = entropy > (this.entropyStats.mean + 1.0 * Math.sqrt(this.entropyStats.variance));
signal.entropySpike = entropyAnomalous;
```

Or use absolute threshold:
```typescript
const entropyAnomalous = entropy > 4.5; // Hallucinations might be more verbose
signal.entropySpike = entropyAnomalous;
```

---

## Testing & Validation

### After fixing each signal, run:

```bash
npm run benchmark:validation
```

### Expected outcomes:

| Signal | Current | After Fix | Target |
|--------|---------|-----------|--------|
| Curvature | 0% | 20-30% | 40%+ |
| Entropy | 0% | 15-25% | 35%+ |
| Loop | 0% | 30-40% | 50%+ |
| **Overall** | **75%** | **→ 80%** | **→ 85%+** |

---

## Prevention Checklist

Before shipping, verify each signal:

- [ ] **Curvature:** Test with synthetic trajectory (flat vs curved)
- [ ] **Entropy:** Test with high-entropy text (gibberish) vs low (structured)
- [ ] **Loop Risk:** Test with DAG that has cycles vs acyclic
- [ ] **Drift:** Verify semantic distance increases for off-topic responses
- [ ] **Topology:** Verify topological metrics change for different concept manifolds

---

## Questions to Answer

1. **Why is loop spectral radius always 0.999?**
   - Is `assessDynamicLoopRisk` actually computing eigenvalues?
   - Or hardcoded somewhere?

2. **Why doesn't curvature ever exceed 0.0?**
   - Are trajectory points actually being added?
   - Is `getWindowedCurvature()` even implemented?

3. **Is there unit test coverage for these signals?**
   - If not: add tests to prevent regression

---

## Next Steps

1. **Pick one signal (start with Loop Divergence)**
2. **Add logging to understand actual values**
3. **Fix or disable until fixed**
4. **Re-run validation benchmark**
5. **Repeat for remaining signals**
6. **Target: 85% accuracy in < 4 hours**

Good luck! This is a solvable problem. The math is sound; the implementation just needs debugging.
