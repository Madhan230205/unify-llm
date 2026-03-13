import { describe, expect, it, vi } from 'vitest';
import {
    CompletionRequest,
    CompletionResponse,
    SelfHealingGateway,
    createOmniPlanner,
    createParetoPlanner,
} from '../src';

function makeRequest(): CompletionRequest {
    return {
        model: 'placeholder',
        messages: [{ role: 'user', content: 'Solve this robustly.' }],
    };
}

describe('SelfHealingGateway', () => {
    it('should route by planner and execute through selected endpoint', async () => {
        const client = {
            generate: vi.fn().mockResolvedValue({ content: 'ok', model: 'gpt-4o-mini' } as CompletionResponse),
            stream: vi.fn(),
        };

        const gateway = new SelfHealingGateway(client as never, {
            endpoints: [
                { id: 'cheap', provider: 'openai', model: 'gpt-4o-mini', tier: 0 },
                { id: 'strong', provider: 'anthropic', model: 'claude-3-7-sonnet-20250219', tier: 1 },
            ],
            planner: () => ['cheap', 'strong'],
        });

        const response = await gateway.generate(makeRequest());

        expect(response.content).toBe('ok');
        expect(client.generate).toHaveBeenCalledWith('openai', expect.objectContaining({ model: 'gpt-4o-mini' }));
    });

    it('should fail over on provider error', async () => {
        const client = {
            generate: vi
                .fn()
                .mockRejectedValueOnce(new Error('primary down'))
                .mockResolvedValueOnce({ content: 'fallback-success', model: 'claude-3-7-sonnet-20250219' } as CompletionResponse),
            stream: vi.fn(),
        };

        const gateway = new SelfHealingGateway(client as never, {
            endpoints: [
                { id: 'cheap', provider: 'openai', model: 'gpt-4o-mini', tier: 0 },
                { id: 'strong', provider: 'anthropic', model: 'claude-3-7-sonnet-20250219', tier: 1 },
            ],
            planner: () => ['cheap', 'strong'],
            maxFailovers: 2,
        });

        const response = await gateway.generate(makeRequest());
        expect(response.content).toBe('fallback-success');
        expect(client.generate).toHaveBeenCalledTimes(2);
    });

    it('should fail over when hallucination signal is detected', async () => {
        const client = {
            generate: vi
                .fn()
                .mockResolvedValueOnce({
                    content: 'unsafe draft',
                    model: 'gpt-4o-mini',
                    providerSpecific: { curvatureAnomaly: true },
                } as CompletionResponse)
                .mockResolvedValueOnce({ content: 'safe final', model: 'claude-3-7-sonnet-20250219' } as CompletionResponse),
            stream: vi.fn(),
        };

        const gateway = new SelfHealingGateway(client as never, {
            endpoints: [
                { id: 'cheap', provider: 'openai', model: 'gpt-4o-mini', tier: 0 },
                { id: 'strong', provider: 'anthropic', model: 'claude-3-7-sonnet-20250219', tier: 1 },
            ],
            planner: () => ['cheap', 'strong'],
            enableHallucinationFailover: true,
        });

        const response = await gateway.generate(makeRequest());
        expect(response.content).toBe('safe final');
        expect(client.generate).toHaveBeenCalledTimes(2);
    });

    it('should provide Omni/Pareto planner adapters', async () => {
        const omniRouter = {
            getModel: vi.fn().mockResolvedValue('openai/gpt-4o-mini'),
        };
        const paretoRouter = {
            route: vi.fn().mockResolvedValue('openai/gpt-4o-mini'),
        };

        const endpoints = [
            { id: 'cheap', provider: 'openai', model: 'gpt-4o-mini', tier: 0 },
            { id: 'strong', provider: 'anthropic', model: 'claude-3-7-sonnet-20250219', tier: 1 },
        ];

        const omniPlanner = createOmniPlanner(omniRouter as never, {
            'openai/gpt-4o-mini': 'cheap',
        });

        const paretoPlanner = createParetoPlanner(paretoRouter as never, {
            'openai/gpt-4o-mini': 'cheap',
        });

        const omniOrder = await omniPlanner({ request: makeRequest(), endpoints });
        const paretoOrder = await paretoPlanner({ request: makeRequest(), endpoints });

        expect(omniOrder[0]).toBe('cheap');
        expect(paretoOrder[0]).toBe('cheap');
    });
});
