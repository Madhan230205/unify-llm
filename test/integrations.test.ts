import { describe, expect, it, vi } from 'vitest';
import {
    ConnectorRegistry,
    createQueryConnector,
    createRestConnector,
} from '../src';

describe('Integration connector substrate', () => {
    it('should register connectors and expose them as Unify tools', async () => {
        const registry = new ConnectorRegistry();
        const dbConnector = createQueryConnector('sql.query', 'Execute SQL queries', {
            run: vi.fn().mockResolvedValue([{ id: 1, name: 'Ada' }]),
        });

        registry.register(dbConnector);

        const tools = registry.toTools();
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('sql.query');

        const result = await tools[0].execute?.({ query: 'select * from users' });
        expect(result).toEqual([{ id: 1, name: 'Ada' }]);
    });

    it('should support template-driven REST connectors', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ open_issues_count: 42 }),
        });

        vi.stubGlobal('fetch', fetchMock);

        const connector = createRestConnector({
            name: 'github.repo.stats',
            description: 'Fetch repository metadata from GitHub.',
            schema: {
                type: 'object',
                properties: {
                    owner: { type: 'string' },
                    repo: { type: 'string' },
                },
                required: ['owner', 'repo'],
            },
            endpoint: 'https://api.github.com/repos/{{owner}}/{{repo}}',
            method: 'GET',
            responseSelector: (payload) => ({ openIssues: (payload as { open_issues_count: number }).open_issues_count }),
        });

        const result = await connector.execute({ args: { owner: 'Madhan230205', repo: 'unify-llm' } });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.github.com/repos/Madhan230205/unify-llm',
            expect.objectContaining({ method: 'GET' }),
        );
        expect(result).toEqual({ openIssues: 42 });

        vi.unstubAllGlobals();
    });
});
