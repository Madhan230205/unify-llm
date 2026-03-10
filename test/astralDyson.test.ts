import { describe, it, expect } from 'vitest';
import { AstralDysonRouter } from '../src/routers/astralDyson';
import { OpenAIProvider } from '../src/providers/openai';
import { AnthropicProvider } from '../src/providers/anthropic';

describe('Astral Dyson Router (ADA Matrix)', () => {

    // Simulate our Outer and Inner models
    const cheapModel = new OpenAIProvider('sk-test');
    const expensiveModel = new AnthropicProvider('sk-test');

    const router = new AstralDysonRouter({
        innerShell: cheapModel,
        outerShell: expensiveModel,
        zenithThreshold: 45.0
    });

    describe('Astral Singularity Value Calculus (Ψ)', () => {

        it('should compute a low Ψ for simple conversational English', () => {
            const prompt = "Hello! What is the capital of France? I am planning a nice trip there next summer.";
            const psi = router.calculateAstralValue(prompt);
            // Entropy should be relatively moderate, Syntactical depth should be ~1.0

            expect(psi).toBeGreaterThan(0);
            expect(psi).toBeLessThan(25.0); // Definitely below our 45.0 threshold
        });

        it('should compute a massively high Ψ for dense coding logic', () => {
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
            const psi = router.calculateAstralValue(prompt);
            // Entropy is high (many unique symbols), Syntactical depth is huge (brackets, keywords, generics)

            expect(psi).toBeGreaterThan(45.0); // Should trigger Outer Shell
        });

        it('should handle empty strings gracefully', () => {
            expect(router.calculateAstralValue('')).toBe(0.0);
        });
    });

    describe('Routing Logistics', () => {
        it('should route conversational prompts to the Inner Shell', async () => {
            // We use private introspection just for testing purposes
            const psi = router.calculateAstralValue("Who was the 3rd US President?");
            // @ts-ignore - reaching into private for test assertion
            const selected = router.selectModel(psi);

            expect(selected.name).toBe('openai');
        });

        it('should route dense syntactical structures to the Outer Shell', async () => {
            const codePayload = `const parse = (json) => { return JSON.parse(json); }; await Promise.all([parse('{}')]);`;
            const psi = router.calculateAstralValue(codePayload);
            // @ts-ignore
            const selected = router.selectModel(psi);

            expect(selected.name).toBe('anthropic');
        });
    });
});
