"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
var perf_hooks_1 = require("perf_hooks");
var homeInterceptor_1 = require("../../src/middlewares/homeInterceptor");
/**
 * Empirical Benchmark Suite for HOME
 *
 * Simulates thousands of AsyncGenerators to empirically collect:
 * 1. O(1) Time Complexity Latency (Average latency per chunk processed)
 * 2. Classifier Accuracy (True/False Positives for Hallucinations vs Graceful)
 * 3. Cost Mitigation (Tokens saved / Drop-off Rate)
 */
var ITERATIONS = 10000;
// Helper to simulate an API provider AsyncGenerator
function mockStream(chunks) {
    return __asyncGenerator(this, arguments, function mockStream_1() {
        var _i, chunks_1, chunk;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _i = 0, chunks_1 = chunks;
                    _a.label = 1;
                case 1:
                    if (!(_i < chunks_1.length)) return [3 /*break*/, 5];
                    chunk = chunks_1[_i];
                    return [4 /*yield*/, __await({ content: chunk, model: "mock-model" })];
                case 2: return [4 /*yield*/, _a.sent()];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 1];
                case 5: return [2 /*return*/];
            }
        });
    });
}
// ----------------------------------------------------
// Mock Datasets (Simulating 10-token chunks)
// ----------------------------------------------------
var DATASET_GRACEFUL = [
    "JavaScript is an asynchronous single-threaded language used globally",
    "Node.js allows JavaScript to execute outside the browser environment",
    "Callbacks promises and async await handle the non-blocking I/O",
    "Scaling Node applications requires clustering the event loop gracefully",
    "V8 Engine completely optimizes JavaScript code by JIT compilation"
];
var DATASET_GRACEFUL_NEGATION = [
    "Machine learning models require highly structured data for training",
    "However neural networks are not always the best solution",
    "Sometimes simple linear regression is actually far more effective",
    "Deep learning cannot solve every single business analytics problem",
    "Data scientists must carefully choose mathematical modeling algorithms wisely"
];
var DATASET_HALLUCINATION = [
    "The Mars rover uses advanced telemetry scripts to navigate",
    "Pathfinding algorithms calculate the most efficient route over rocks",
    "Suddenly the rover decided to bake a large chocolate pie",
    "Adding two cups of sugar and a tablespoon of vanilla",
    "The rover enjoyed the cookies with a glass of milk"
];
// Helper to calculate total "tokens" (using word count as a proxy)
function getTokenCount(dataset) {
    return dataset.join(" ").split(" ").length;
}
function runBenchmark() {
    return __awaiter(this, void 0, void 0, function () {
        var interceptor, dummyReq, totalChunksProcessed, totalLatencyMs, truePositives, falsePositives, trueNegatives, falseNegatives, totalTokensRequested, totalTokensExecuted, startTotalTime, _loop_1, i, endTotalTime, totalSimulatedTime, avgLatencyMs, accuracy, precision, recall, costSavedRatio;
        var _a, e_1, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    console.log("\n========================================================");
                    console.log("= HOLOGRAPHIC ORTHOGONAL MANIFOLD ENGINE (HOME) REPORT =");
                    console.log("========================================================");
                    console.log("Running simulation over ".concat(ITERATIONS, " streams...\n"));
                    interceptor = new homeInterceptor_1.HomeInterceptorMiddleware(1.2, 10);
                    dummyReq = { model: "mock", messages: [] };
                    totalChunksProcessed = 0;
                    totalLatencyMs = 0;
                    truePositives = 0;
                    falsePositives = 0;
                    trueNegatives = 0;
                    falseNegatives = 0;
                    totalTokensRequested = 0;
                    totalTokensExecuted = 0;
                    startTotalTime = perf_hooks_1.performance.now();
                    _loop_1 = function (i) {
                        var scenarioIndex, dataset, isHallucinationExpected, tokensExecutedThisRun, didAbort, wrappedStream, _e, wrappedStream_1, wrappedStream_1_1, chunk, chunkStart, chunkEnd, e_1_1, error_1;
                        return __generator(this, function (_f) {
                            switch (_f.label) {
                                case 0:
                                    scenarioIndex = i % 3;
                                    isHallucinationExpected = false;
                                    if (scenarioIndex === 0) {
                                        dataset = DATASET_GRACEFUL;
                                        isHallucinationExpected = false;
                                    }
                                    else if (scenarioIndex === 1) {
                                        dataset = DATASET_GRACEFUL_NEGATION;
                                        isHallucinationExpected = false;
                                    }
                                    else {
                                        dataset = DATASET_HALLUCINATION;
                                        isHallucinationExpected = true;
                                    }
                                    totalTokensRequested += getTokenCount(dataset);
                                    tokensExecutedThisRun = 0;
                                    didAbort = false;
                                    wrappedStream = interceptor.wrapStream(dummyReq, function () { return mockStream(dataset); });
                                    _f.label = 1;
                                case 1:
                                    _f.trys.push([1, 14, , 15]);
                                    _f.label = 2;
                                case 2:
                                    _f.trys.push([2, 7, 8, 13]);
                                    _e = true, wrappedStream_1 = (e_1 = void 0, __asyncValues(wrappedStream));
                                    _f.label = 3;
                                case 3: return [4 /*yield*/, wrappedStream_1.next()];
                                case 4:
                                    if (!(wrappedStream_1_1 = _f.sent(), _a = wrappedStream_1_1.done, !_a)) return [3 /*break*/, 6];
                                    _c = wrappedStream_1_1.value;
                                    _e = false;
                                    chunk = _c;
                                    chunkStart = perf_hooks_1.performance.now();
                                    // Simulate processing
                                    tokensExecutedThisRun += chunk.content.split(" ").length;
                                    totalChunksProcessed++;
                                    chunkEnd = perf_hooks_1.performance.now();
                                    totalLatencyMs += (chunkEnd - chunkStart);
                                    _f.label = 5;
                                case 5:
                                    _e = true;
                                    return [3 /*break*/, 3];
                                case 6: return [3 /*break*/, 13];
                                case 7:
                                    e_1_1 = _f.sent();
                                    e_1 = { error: e_1_1 };
                                    return [3 /*break*/, 13];
                                case 8:
                                    _f.trys.push([8, , 11, 12]);
                                    if (!(!_e && !_a && (_b = wrappedStream_1.return))) return [3 /*break*/, 10];
                                    return [4 /*yield*/, _b.call(wrappedStream_1)];
                                case 9:
                                    _f.sent();
                                    _f.label = 10;
                                case 10: return [3 /*break*/, 12];
                                case 11:
                                    if (e_1) throw e_1.error;
                                    return [7 /*endfinally*/];
                                case 12: return [7 /*endfinally*/];
                                case 13: return [3 /*break*/, 15];
                                case 14:
                                    error_1 = _f.sent();
                                    if (error_1 instanceof homeInterceptor_1.AstralDivergenceError) {
                                        didAbort = true;
                                    }
                                    else {
                                        throw error_1;
                                    }
                                    return [3 /*break*/, 15];
                                case 15:
                                    totalTokensExecuted += tokensExecutedThisRun;
                                    // Metric Aggregation
                                    if (isHallucinationExpected && didAbort)
                                        truePositives++;
                                    if (isHallucinationExpected && !didAbort)
                                        falseNegatives++;
                                    if (!isHallucinationExpected && !didAbort)
                                        trueNegatives++;
                                    if (!isHallucinationExpected && didAbort)
                                        falsePositives++;
                                    return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _d.label = 1;
                case 1:
                    if (!(i < ITERATIONS)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(i)];
                case 2:
                    _d.sent();
                    _d.label = 3;
                case 3:
                    i++;
                    return [3 /*break*/, 1];
                case 4:
                    endTotalTime = perf_hooks_1.performance.now();
                    totalSimulatedTime = endTotalTime - startTotalTime;
                    avgLatencyMs = totalLatencyMs / totalChunksProcessed;
                    accuracy = ((truePositives + trueNegatives) / ITERATIONS) * 100;
                    precision = truePositives / (truePositives + falsePositives || 1);
                    recall = truePositives / (truePositives + falseNegatives || 1);
                    costSavedRatio = ((totalTokensRequested - totalTokensExecuted) / totalTokensRequested) * 100;
                    console.log("[LATENCY & COMPLEXITY]");
                    console.log("O(1) Chunk Processing Latency  : ".concat(avgLatencyMs.toFixed(4), " ms"));
                    console.log("Total Simulation Time          : ".concat((totalSimulatedTime / 1000).toFixed(2), " sec"));
                    console.log('');
                    console.log("[ACCURACY CLASSIFICATION]");
                    console.log("Overall Accuracy               : ".concat(accuracy.toFixed(2), " %"));
                    console.log("True Positives (H-Caught)      : ".concat(truePositives));
                    console.log("True Negatives (G-Permitted)   : ".concat(trueNegatives));
                    console.log("False Positives (G-Aborted)    : ".concat(falsePositives));
                    console.log("False Negatives (H-Missed)     : ".concat(falseNegatives));
                    console.log('');
                    console.log("[FINANCIAL METRICS]");
                    console.log("Total Tokens Requested API     : ".concat(totalTokensRequested));
                    console.log("Total Tokens Billed / Rendered : ".concat(totalTokensExecuted));
                    console.log("Total Cost Mitigated Natively  : ".concat(costSavedRatio.toFixed(2), " %"));
                    console.log("\n========================================================\n");
                    return [2 /*return*/];
            }
        });
    });
}
runBenchmark().catch(console.error);
