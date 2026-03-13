import { describe, expect, it, vi } from 'vitest';
import { createQuickstartClient } from '../src';

describe('Quickstart orchestration API', () => {
    it('should provide a minimal ask API for one-shot prompts', async () => {
        const client = {
            generate: vi.fn().mockResolvedValue({
                content: 'hello from quickstart',
                model: 'demo-model',
            }),
        };

        const quick = createQuickstartClient(client as never, {
            provider: 'demo-provider',
            model: 'demo-model',
            systemPrompt: 'You are concise.',
            defaults: { temperature: 0.2 },
        });

        const answer = await quick.ask('hello');

        expect(answer).toBe('hello from quickstart');
        expect(client.generate).toHaveBeenCalledTimes(1);
        expect(client.generate).toHaveBeenCalledWith('demo-provider', expect.objectContaining({
            model: 'demo-model',
            temperature: 0.2,
            messages: [
                { role: 'system', content: 'You are concise.' },
                { role: 'user', content: 'hello' },
            ],
        }));
    });

    it('should preserve conversational state in sessions', async () => {
        const client = {
            generate: vi.fn()
                .mockResolvedValueOnce({ content: 'turn-1', model: 'demo-model' })
                .mockResolvedValueOnce({ content: 'turn-2', model: 'demo-model' }),
        };

        const quick = createQuickstartClient(client as never, {
            provider: 'demo-provider',
            model: 'demo-model',
        });

        const session = quick.createSession({ systemPrompt: 'Track context.' });
        await session.ask('first');
        await session.ask('second');

        const secondCallRequest = client.generate.mock.calls[1][1] as { messages: Array<{ role: string; content: string }> };
        expect(secondCallRequest.messages).toEqual([
            { role: 'system', content: 'Track context.' },
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'turn-1' },
            { role: 'user', content: 'second' },
        ]);
    });
});
