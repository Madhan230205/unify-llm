import { describe, it, expect } from 'vitest';
import { ComplexityThresholdRouter } from '../src/routers/complexityThresholdRouter';
import { OpenAIProvider } from '../src/providers/openai';
import { AnthropicProvider } from '../src/providers/anthropic';

describe('Complexity Threshold Router', () => {
    const cheapModel = new OpenAIProvider('sk-test');
    const expensiveModel = new AnthropicProvider('sk-test');

    const router = new ComplexityThresholdRouter({
        innerShell: cheapModel,
        outerShell: expensiveModel,
        zenithThreshold: 45.0
    });

    describe('Complexity score calculation', () => {
        it('should compute a low complexity score for simple conversational English', () => {
            const prompt = 'Hello! What is the capital of France? I am planning a nice trip there next summer.';
            const score = router.calculateComplexityScore(prompt);

            expect(score).toBeGreaterThan(0);
            expect(score).toBeLessThan(25.0);
        });

        it('should compute a high complexity score for dense coding logic', () => {
            const prompt = `
            Please write a complex React Native hook.
            It needs to handle AsyncStorage, and use a generic type T.

            function useCache<T>(key: string) {
                const [val, setVal] = useState<T | null>(null);

                useEffect(() => {
                    const load = async () => {
                        const data = await AsyncStorage.getItem(key);
                        if (data) setVal(JSON.parse(data));
                    }
                    load();
                }, [key]);

                return val;
            }
            `;
            const score = router.calculateComplexityScore(prompt);

            expect(score).toBeGreaterThan(45.0);
        });

        it('should handle empty strings gracefully', () => {
            expect(router.calculateComplexityScore('')).toBe(0.0);
        });
    });

    describe('Routing logic', () => {
        it('should route conversational prompts to the inner model', async () => {
            const score = router.calculateComplexityScore('Who was the 3rd US President?');
            // @ts-ignore - reaching into private for test assertion
            const selected = router.selectModel(score);

            expect(selected.name).toBe('openai');
        });

        it('should route dense syntactical structures to the outer model', async () => {
            const codePayload = "const parse = (json) => { return JSON.parse(json); }; await Promise.all([parse('{}')]);";
            const score = router.calculateComplexityScore(codePayload);
            // @ts-ignore - reaching into private for test assertion
            const selected = router.selectModel(score);

            expect(selected.name).toBe('anthropic');
        });
    });
});