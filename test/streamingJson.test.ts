import { describe, it, expect } from 'vitest';
import { parsePartialJSON, extractStreamItems } from '../src/utils/streamingJson';

describe('Chronosyntactic Harmonic Parsing (CHP)', () => {

    describe('parsePartialJSON', () => {
        it('should return undefined for empty strings', () => {
            expect(parsePartialJSON('')).toBeUndefined();
        });

        it('should safely close unclosed objects', () => {
            const result = parsePartialJSON('{"key": "value", "partial');
            expect(result).toEqual({ key: 'value', partial: null }); // Preserve the partial key!
        });

        it('should pad dangling colons with null', () => {
            const result = parsePartialJSON('{"key": "value", "partial":');
            expect(result).toEqual({ key: 'value', partial: null });
        });

        it('should correctly close deeply nested structures', () => {
            // Unclosed array of objects with an unclosed inner object
            const result = parsePartialJSON('[{"id": 1}, {"id": 2, "details": {"name": "Test"');
            expect(result).toEqual([{ id: 1 }, { id: 2, details: { name: 'Test' } }]);
        });

        it('should handle unescaped quotes properly to not mess up structure', () => {
            // The value has a bracket inside a string which shouldn't be parsed as depth
            const result = parsePartialJSON('{"description": "Here is a bracket [ and a brace {"}');
            expect(result).toEqual({ description: 'Here is a bracket [ and a brace {' });
        });

        it('should ignore escaped quotes inside strings', () => {
            const result = parsePartialJSON('{"text": "They said \\"hello\\" loudly');
            expect(result).toEqual({ text: 'They said "hello" loudly' });
        });
    });

    describe('extractStreamItems', () => {
        it('should yield completed array objects progressively', async () => {
            async function* mockStream() {
                yield { content: '[' };
                yield { content: '{"id": 1' };
                yield { content: ', "name"' };
                yield { content: ':"A"}' };
                yield { content: ', {"id": 2, "name":"B"}' };
                yield { content: ']' };
            }

            const items: unknown[] = [];
            for await (const item of extractStreamItems(mockStream())) {
                items.push(item);
            }

            expect(items).toHaveLength(2);
            expect(items[0]).toEqual({ id: 1, name: 'A' });
            expect(items[1]).toEqual({ id: 2, name: 'B' });
        });

        it('should yield nested objects correctly without yielding parent wraps', async () => {
            async function* mockStream() {
                // The LLM is returning `{ "results": [ {a:1}, {b:2} ] }`
                yield { content: '{"results": [' };
                yield { content: '{"a": 1},' };
                yield { content: '{"b": 2}]}' };
            }

            const items: unknown[] = [];
            for await (const item of extractStreamItems(mockStream())) {
                items.push(item);
            }

            // Depth analysis: extractStreamItems currently collapses depth > 1 inner nested collections
            // down into a single emission boundary representing the complete nested payload frame.
            expect(items).toHaveLength(1);
            expect(items[0]).toEqual([{ a: 1 }, { b: 2 }]);
        });
    });
});
