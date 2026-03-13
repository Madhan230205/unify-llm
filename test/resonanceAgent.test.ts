import { describe, expect, it } from 'vitest';
import { ResonanceAgent, ResonanceTool, createFieldProjector } from '../src';

describe('ResonanceAgent', () => {
    it('should rank semantically relevant tools first', async () => {
        const tools: ResonanceTool<{ question: string }>[] = [
            {
                name: 'weather',
                description: 'Find weather conditions for a city',
                execute: async () => ({ question: 'weather done' }),
            },
            {
                name: 'calculator',
                description: 'Solve arithmetic and mathematical expressions',
                execute: async () => ({ question: 'math done' }),
            },
        ];

        const agent = new ResonanceAgent<{ question: string }>({
            planner: async () => ({ done: true }),
            tools,
            stateProjector: createFieldProjector(['question']),
        });

        const ranked = await agent.rankTools({ question: 'What is 12 * 13?' });
        expect(ranked[0].name).toBe('calculator');
    });

    it('should execute the chosen tool and synthesize a final answer', async () => {
        interface MathState {
            question: string;
            result?: number;
            answer?: string;
            approved?: boolean;
        }

        const agent = new ResonanceAgent<MathState>({
            answerField: 'answer',
            approvalField: 'approved',
            stateProjector: createFieldProjector(['question', 'result', 'answer']),
            tools: [
                {
                    name: 'calculator',
                    description: 'Solve arithmetic questions',
                    execute: async () => ({ result: 42 }),
                },
            ],
            planner: async ({ state }) => {
                if (state.result === undefined) {
                    return { tool: 'calculator', thought: 'Need a precise arithmetic result.' };
                }

                return {
                    answer: `The answer is ${state.result}.`,
                    done: true,
                };
            },
        });

        const result = await agent.invoke({ question: 'What is 6 * 7?' });
        expect(result.finalAnswer).toBe('The answer is 42.');
        expect(result.trace.some((entry) => entry.selectedTool === 'calculator')).toBe(true);
    });

    it('should cap repeated tool execution and converge safely', async () => {
        interface LoopState {
            question: string;
            notes: string[];
        }

        const agent = new ResonanceAgent<LoopState>({
            stateProjector: createFieldProjector(['question', 'notes']),
            semanticTolerance: 0.001,
            stablePasses: 1,
            tools: [
                {
                    name: 'search',
                    description: 'Search for documents',
                    maxUses: 1,
                    execute: async (state) => ({ notes: [...state.notes, 'document found'] }),
                },
            ],
            planner: async () => ({ tool: 'search', thought: 'Try searching again forever, what could go wrong?' }),
        });

        const result = await agent.invoke({ question: 'loop safely', notes: [] });
        const toolSelections = result.trace.filter((entry) => entry.selectedTool === 'search');

        expect(toolSelections).toHaveLength(1);
        expect(result.iterations).toBeGreaterThanOrEqual(2);
    });

    it('should support critic approval for iterative refinement', async () => {
        interface DraftState {
            question: string;
            answer?: string;
            critique?: string;
            approved?: boolean;
        }

        const agent = new ResonanceAgent<DraftState>({
            answerField: 'answer',
            approvalField: 'approved',
            critiqueField: 'critique',
            stateProjector: createFieldProjector(['question', 'answer', 'approved']),
            planner: async ({ state }) => ({
                answer: state.answer?.includes('semantic convergence')
                    ? state.answer
                    : 'This runtime uses graph orchestration.',
            }),
            critic: async ({ state }) => {
                const approved = Boolean(state.answer?.includes('semantic convergence'));
                return approved
                    ? { approved: true, critique: 'Approved.' }
                    : {
                        approved: false,
                        critique: 'Mention semantic convergence explicitly.',
                        answer: `${state.answer} It stops loops using semantic convergence.`,
                    };
            },
        });

        const result = await agent.invoke({ question: 'What is special about this runtime?' });

        expect(result.approved).toBe(true);
        expect(result.finalAnswer).toContain('semantic convergence');
        expect(result.state.critique).toBe('Approved.');
    });
});