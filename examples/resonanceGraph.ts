import {
    Chain,
    JsonOutputParser,
    PromptTemplate,
    createFieldProjector,
    HolographicVectorStore,
    ResonanceGraph,
} from '../src';

interface ResearchState {
    question: string;
    context: string;
    draft: string;
    critique: string;
    approved: boolean;
}

async function main(): Promise<void> {
    const store = new HolographicVectorStore<{ title: string }>();
    await store.addDocuments([
        {
            content: 'Prompt caching lowers repeated-context cost by letting providers reuse stable prompt prefixes.',
            metadata: { title: 'Caching' },
        },
        {
            content: 'Semantic convergence can stop refinement loops once the answer stops changing in meaning, not just in tokens.',
            metadata: { title: 'Convergence' },
        },
        {
            content: 'Graph orchestration allows retrieval, drafting, critique, and routing to live inside one state machine.',
            metadata: { title: 'Graphs' },
        },
    ]);

    const plannerPrompt = new PromptTemplate<{ question: string; context: string }>(
        'You are a precise orchestration planner.',
        'Question: {question}\nContext:\n{context}\nReturn JSON with fields `draft` and `approved`.',
    );

    const planner = Chain.from((input: { question: string; context: string }) => plannerPrompt.format(input))
        .pipe((messages) => {
            const payload = String(messages[messages.length - 1]?.content ?? '');
            const draft = payload.includes('prompt caching')
                ? 'Prompt caching reduces repeated token work, and semantic convergence stops refinement once meaning stabilizes.'
                : 'Graph orchestration coordinates retrieval and refinement until the state reaches a stable answer.';

            return {
                content: JSON.stringify({ draft, approved: false }),
                model: 'local-simulator',
            };
        })
        .pipe(new JsonOutputParser<{ draft: string; approved: boolean }>());

    const critic = Chain.from((state: ResearchState) => ({
        content: JSON.stringify({
            critique: state.draft.includes('semantic convergence')
                ? 'Approved: the answer explains both cost reduction and fixed-point stopping.'
                : 'Add the semantic convergence insight so the answer explains why the loop can stop.',
            approved: state.draft.includes('semantic convergence'),
            revisedDraft: state.draft.includes('semantic convergence')
                ? state.draft
                : `${state.draft} This is powered by semantic convergence over graph state rather than fixed step counts.`,
        }),
        model: 'local-critic',
    }))
        .pipe(new JsonOutputParser<{ critique: string; approved: boolean; revisedDraft: string }>());

    const graph = new ResonanceGraph<ResearchState>({
        startNode: 'retrieve',
        stateProjector: createFieldProjector(['draft', 'approved']),
        semanticTolerance: 0.03,
        stablePasses: 2,
        maxIterations: 8,
    });

    graph
        .addNode('retrieve', async ({ question }) => {
            const retrieved = await store.similaritySearch(question, 2);
            return {
                patch: {
                    context: retrieved
                        .map((document) => document.content)
                        .join('\n'),
                },
                next: 'draft',
            };
        })
        .addNode('draft', async ({ question, context }) => {
            const result = await planner.invoke({ question, context });
            return {
                patch: {
                    draft: result.draft,
                    approved: result.approved,
                },
            };
        })
        .addNode('critique', async (state) => {
            const result = await critic.invoke(state);
            return {
                patch: {
                    critique: result.critique,
                    draft: result.revisedDraft,
                    approved: result.approved,
                },
            };
        })
        .addNode('finalize', ({ draft }) => ({
            patch: { draft },
            halt: true,
        }))
        .addEdge('draft', 'critique')
        .addEdge('critique', 'finalize', (state) => state.approved)
        .addEdge('critique', 'draft', (state) => !state.approved);

    const result = await graph.invoke({
        question: 'How does a next-generation LangChain alternative reduce cost without brittle loops?',
        context: '',
        draft: '',
        critique: '',
        approved: false,
    });

    console.log('Final draft:', result.state.draft);
    console.log('Critique:', result.state.critique);
    console.log('Halt reason:', result.haltReason);
    console.log('Trace length:', result.trace.length);
}

void main().catch(console.error);