import {
    JsonOutputParser,
    PromptTemplate,
    ResonanceAgent,
    ResonanceTool,
    createFieldProjector,
} from '../src';

interface TravelState {
    request: string;
    weather?: string;
    answer?: string;
    critique?: string;
    approved?: boolean;
}

async function main(): Promise<void> {
    const tools: ResonanceTool<TravelState>[] = [
        {
            name: 'weatherLookup',
            description: 'Find likely weather conditions for a destination',
            profile: 'weather climate forecast destination travel outdoor conditions',
            maxUses: 1,
            execute: async () => ({ weather: 'Cool and rainy' }),
        },
        {
            name: 'museumLookup',
            description: 'Find museums and gallery recommendations',
            profile: 'museum gallery art exhibitions indoor travel activities',
            maxUses: 1,
            execute: async () => ({ answer: 'Top museum options: Rijksmuseum and Van Gogh Museum.' }),
        },
    ];

    const plannerPrompt = new PromptTemplate<{ request: string; weather: string }>(
        'You are a travel strategist deciding which capability is most relevant.',
        'Request: {request}\nKnown weather: {weather}\nReturn JSON with fields `tool`, `answer`, and `done`.',
    );

    const plannerParser = new JsonOutputParser<{ tool?: string; answer?: string; done?: boolean }>();

    const agent = new ResonanceAgent<TravelState>({
        answerField: 'answer',
        approvalField: 'approved',
        critiqueField: 'critique',
        stateProjector: createFieldProjector(['request', 'weather', 'answer', 'approved']),
        tools,
        planner: async ({ state, tools: rankedTools }) => {
            const _messages = plannerPrompt.format({
                request: state.request,
                weather: state.weather ?? 'unknown',
            });

            const simulatedModelResponse = state.weather === undefined
                ? { content: JSON.stringify({ tool: rankedTools[0]?.name, done: false }), model: 'local-planner' }
                : {
                    content: JSON.stringify({
                        answer: `For this trip, pack a rain layer because the weather is ${state.weather}.`,
                        done: true,
                    }),
                    model: 'local-planner',
                };

            return plannerParser.parse(simulatedModelResponse);
        },
        critic: async ({ state }) => {
            const approved = Boolean(state.answer?.includes('rain layer'));
            return approved
                ? { approved: true, critique: 'Approved.' }
                : {
                    approved: false,
                    critique: 'Mention a concrete packing recommendation.',
                    answer: `${state.answer ?? ''} Pack a rain layer for variable weather.`.trim(),
                };
        },
    });

    const result = await agent.invoke({
        request: 'I am traveling to Amsterdam in spring. What should I pack?',
    });

    console.log('Answer:', result.finalAnswer);
    console.log('Approved:', result.approved);
    console.log('Trace:', result.trace.map((entry) => ({
        iteration: entry.iteration,
        selectedTool: entry.selectedTool,
        approved: entry.approved,
    })));
}

void main().catch(console.error);