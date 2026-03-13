import { describe, it, expect, beforeAll } from 'vitest';
import { GeminiProvider } from '../src/providers/gemini';
import { HallucinationInterceptionAlgorithm } from '../src/algorithms/hallucinationInterception';
import { CompletionRequest, UnifyAPIError } from '../src/types';

const RUN_GEMINI_REALTIME = process.env.RUN_GEMINI_REALTIME === '1';
const describeRealtime = RUN_GEMINI_REALTIME ? describe : describe.skip;

const TARGET_SAMPLES = Number.parseInt(process.env.GEMINI_REALTIME_TARGET_SAMPLES || '100', 10);
const REQUEST_PACE_MS = Number.parseInt(process.env.GEMINI_REALTIME_PACE_MS || '4000', 10);
const MAX_RATE_LIMIT_RETRIES = Number.parseInt(process.env.GEMINI_REALTIME_MAX_RETRIES || '6', 10);
const BASE_BACKOFF_MS = Number.parseInt(process.env.GEMINI_REALTIME_BACKOFF_MS || '1500', 10);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimited(error: unknown): boolean {
  if (error instanceof UnifyAPIError) {
    return error.status === 429 || error.status === 503;
  }

  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown> & {
      code?: unknown;
      error?: { code?: unknown; status?: unknown };
    };
    const maybeStatus = errObj.status;
    const maybeCode = errObj.code;
    const nestedCode = errObj.error?.code;
    const nestedStatus = errObj.error?.status;

    return (
      maybeStatus === 429 ||
      maybeStatus === 503 ||
      maybeCode === 429 ||
      maybeCode === 503 ||
      nestedCode === 429 ||
      nestedCode === 503 ||
      nestedStatus === 429 ||
      nestedStatus === 503 ||
      nestedStatus === 'RESOURCE_EXHAUSTED'
    );
  }

  return false;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withRateLimitRetry<T>(task: () => Promise<T>): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= MAX_RATE_LIMIT_RETRIES) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error) || attempt === MAX_RATE_LIMIT_RETRIES) {
        throw error;
      }

      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 200);
      await sleep(backoff + jitter);
      attempt++;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown retry failure');
}

describeRealtime('Gemini Real-Time sample test with signal validation', () => {
  let provider: GeminiProvider;
  const apiKey = process.env.GEMINI_API_KEY;
  const testPrompts = [
    // Technical questions
    'Explain the concept of closure in JavaScript',
    'What is the difference between let, const, and var?',
    'How does async/await work in JavaScript?',
    'Explain the event loop in JavaScript',
    'What is hoisting in JavaScript?',
    'Describe the purpose of middleware in Express.js',
    'What are higher-order functions?',
    'Explain prototype-based inheritance',
    'What is the this keyword in JavaScript?',
    'How do promises work?',
    // Data structure questions
    'What is a hash table and how does it work?',
    'Explain binary search trees',
    'What are the differences between arrays and linked lists?',
    'How does a queue data structure work?',
    'What is a stack and when would you use it?',
    'Explain graph traversal algorithms',
    'What is a heap in data structures?',
    'Describe the merge sort algorithm',
    'What is dynamic programming?',
    'Explain bubble sort and why it is inefficient',
    // Algorithm questions
    'How would you implement a binary search?',
    'What is the quicksort algorithm?',
    'How do you find the longest substring without repeating characters?',
    'Explain the traveling salesman problem',
    'What is the difference between DFS and BFS?',
    'How would you detect a cycle in a graph?',
    'Explain the knapsack problem',
    'What is memoization?',
    'How do you reverse a linked list?',
    'What is topological sorting?',
    // API and Database questions
    'What is REST API architecture?',
    'Explain ACID properties in databases',
    'What is database normalization?',
    'How do transactions work in databases?',
    'Explain the difference between SQL and NoSQL',
    'What is a foreign key constraint?',
    'How does authentication differ from authorization?',
    'Explain what OAuth 2.0 is',
    'What is API rate limiting and why is it important?',
    'Describe the CAP theorem',
    // Testing and DevOps
    'What is unit testing and why is it important?',
    'Explain test-driven development',
    'What are integration tests?',
    'Describe continuous integration and continuous deployment',
    'What is Docker and how does it work?',
    'Explain containerization benefits',
    'What is Kubernetes?',
    'Describe the difference between mocking and stubbing',
    'What is code coverage?',
    'Explain semantic versioning',
    // Design patterns
    'What is the singleton pattern?',
    'Explain the factory pattern',
    'What is the observer pattern?',
    'Describe the MVC architecture pattern',
    'What is dependency injection?',
    'Explain the decorator pattern',
    'What is the strategy pattern?',
    'Describe the adapter pattern',
    'What is the builder pattern?',
    'Explain the state pattern',
    // Mathematics and Theory
    'What is Big O notation?',
    'Explain time complexity analysis',
    'What is NP-completeness?',
    'Describe the Halting problem',
    'What is the Church-Turing thesis?',
    'Explain complexity classes P and NP',
    'What is a Turing machine?',
    'Describe recursive functions',
    'What is mathematical induction?',
    'Explain set theory basics',
    // Web technologies
    'How does HTTP work?',
    'Explain HTTPS and SSL/TLS',
    'What are HTTP status codes?',
    'Describe CORS and why it exists',
    'What is web caching?',
    'Explain content negotiation',
    'What is gzip compression?',
    'Describe DNS resolution process',
    'What is a CDN?',
    'Explain server-sent events',
    // Software Engineering
    'What is Software Engineering?',
    'Explain the Agile methodology',
    'What is the Waterfall model?',
    'Describe code review best practices',
    'What is technical debt?',
    'Explain refactoring',
    'What is version control?',
    'Describe the difference between git merge and rebase',
    'What are commits and what makes a good commit message?',
    'Explain the concept of clean code',
  ];

  beforeAll(async () => {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required when RUN_GEMINI_REALTIME=1');
    }
    provider = new GeminiProvider(apiKey);
  });

  it('should test 100 real Gemini responses with signal validation', async () => {
    const results = {
      total: 0,
      successful: 0,
      failed: 0,
      signalComplete: 0,
      signalIncomplete: 0,
      hallucinations: 0,
      reasons: {} as Record<string, number>,
      avgEntropy: 0,
      avgDrift: 0,
      avgCurvature: 0,
      processingTimes: [] as number[],
    };

    console.log(`\n🔍 Starting ${TARGET_SAMPLES} Real-Time Gemini API Tests`);
    console.log('━'.repeat(60));

    const prompts = [...testPrompts];
    while (prompts.length < TARGET_SAMPLES) {
      const n = prompts.length + 1;
      prompts.push(`Provide a concise, factual software engineering explanation for sample #${n}.`);
    }

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      results.total++;

      try {
        const startTime = Date.now();

        // Create request for Gemini
        const request: CompletionRequest = {
          messages: [{ role: 'user', content: prompt }],
          model: 'gemini-2.0-flash',
          temperature: 0.7,
          maxTokens: 500,
        };

        // Get response from Gemini
        const response = await withRateLimitRetry(() => provider.generateCompletion(request));
        const responseText = response.content;
        const processingTime = Date.now() - startTime;

        results.successful++;
        results.processingTimes.push(processingTime);

        // Create algorithm instance with the prompt
        const algorithm = new HallucinationInterceptionAlgorithm(prompt, {
          chunkSize: 25,
          tau: 2,
          minBaselineSamples: 3,
        });

        // Analyze response
        const signal = algorithm.analyzeResponse(responseText);

        // Validate signal completeness
        const requiredFields = [
          'shouldAbort',
          'curvature',
          'drift',
          'entropy',
          'entropySpike',
          'modalityShift',
          'retention',
          'instabilityLift',
          'topologicalDrift',
          'topologicalComponents',
          'loopSpectralRadius',
          'loopDivergent',
        ];

        const hasAllFields = requiredFields.every(
          field => signal.hasOwnProperty(field) && signal[field as keyof typeof signal] !== undefined
        );

        if (hasAllFields) {
          results.signalComplete++;
        } else {
          results.signalIncomplete++;
        }

        if (signal.shouldAbort) {
          results.hallucinations++;
          if (signal.reason) {
            results.reasons[signal.reason] = (results.reasons[signal.reason] || 0) + 1;
          }
        }

        // Accumulate metrics
        results.avgEntropy += signal.entropy;
        results.avgDrift += signal.drift;
        results.avgCurvature += signal.curvature;

        const progressNum = i + 1;
        if (progressNum % 10 === 0) {
          console.log(`[${progressNum}/${TARGET_SAMPLES}] Processed - Signal: ${signal.shouldAbort ? '🚨 ANOMALY' : '✅ NORMAL'}`);
        }

        // Validate signal structure
        expect(signal).toBeDefined();
        expect(signal.shouldAbort).toEqual(expect.any(Boolean));
        expect(signal.entropy).toEqual(expect.any(Number));
        expect(signal.drift).toEqual(expect.any(Number));
      } catch (error) {
        results.failed++;
        console.error(`❌ Test ${i + 1} failed: ${toErrorMessage(error)}`);
      }

      if (REQUEST_PACE_MS > 0) {
        await sleep(REQUEST_PACE_MS);
      }
    }

    // Calculate averages
    if (results.successful > 0) {
      results.avgEntropy /= results.successful;
      results.avgDrift /= results.successful;
      results.avgCurvature /= results.successful;
    }

    const avgProcessingTime =
      results.processingTimes.length > 0
        ? results.processingTimes.reduce((a, b) => a + b, 0) / results.processingTimes.length
        : 0;

    // Print comprehensive results
    console.log('\n' + '━'.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('━'.repeat(60));
    console.log(`Total Tests: ${results.total}`);
    console.log(`✅ Successful: ${results.successful} (${((results.successful / results.total) * 100).toFixed(1)}%)`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`\n🔍 Signal Quality:`);
    const completenessRate = results.successful > 0
      ? ((results.signalComplete / results.successful) * 100).toFixed(1)
      : '0.0';
    console.log(`✅ Complete Signals: ${results.signalComplete}/${results.successful}`);
    console.log(`⚠️  Incomplete Signals: ${results.signalIncomplete}/${results.successful}`);
    console.log(`Completeness Rate: ${completenessRate}%`);
    console.log(`\n⚠️  Anomalies Detected: ${results.hallucinations}`);
    const detectionRate = results.successful > 0
      ? ((results.hallucinations / results.successful) * 100).toFixed(1)
      : '0.0';
    console.log(`Detection Rate: ${detectionRate}%`);

    if (Object.keys(results.reasons).length > 0) {
      console.log(`\nAnomaly Reasons Breakdown:`);
      for (const [reason, count] of Object.entries(results.reasons)) {
        console.log(`  - ${reason}: ${count}`);
      }
    }

    console.log(`\n📈 Statistical Metrics:`);
    console.log(`Average Entropy: ${results.avgEntropy.toFixed(3)}`);
    console.log(`Average Drift: ${results.avgDrift.toFixed(3)}`);
    console.log(`Average Curvature: ${results.avgCurvature.toFixed(3)}`);
    console.log(`Average Processing Time: ${avgProcessingTime.toFixed(0)}ms`);
    console.log(`Min Processing Time: ${results.processingTimes.length > 0 ? Math.min(...results.processingTimes).toFixed(0) : '0'}ms`);
    console.log(`Max Processing Time: ${results.processingTimes.length > 0 ? Math.max(...results.processingTimes).toFixed(0) : '0'}ms`);
    console.log('━'.repeat(60));

    // Assertions
    expect(results.successful).toBeGreaterThan(0);
    expect(results.signalComplete).toBeGreaterThan(results.signalIncomplete);
    expect(results.total).toBe(TARGET_SAMPLES);
  }, 1800000); // 30 minute timeout for paced API calls
});
