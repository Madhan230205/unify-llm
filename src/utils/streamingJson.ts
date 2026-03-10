/**
 * Chronosyntactic Harmonic Parsing (CHP) Matrix
 * 
 * An advanced state-machine stream tokenizer capable of extracting fully-formed 
 * objects from incomplete LLM JSON arrays in real-time, and auto-closing 
 * truncated multi-level AST AST ASTs dynamically.
 */

export function parsePartialJSON(jsonString: string): unknown {
    if (!jsonString || jsonString.trim() === '') return undefined;

    let inString = false;
    let escapeLevel = 0;
    const stack: string[] = [];

    // 1. Traverse the chronosyntactic stream and collapse the state tensor
    for (let i = 0; i < jsonString.length; i++) {
        const char = jsonString[i];

        if (char === '\\') {
            escapeLevel++;
            continue;
        }

        if (char === '"' && escapeLevel % 2 === 0) {
            inString = !inString;
        } else if (!inString) {
            if (char === '{') {
                stack.push('}');
            } else if (char === '[') {
                stack.push(']');
            } else if (char === '}' || char === ']') {
                stack.pop();
            }
        }

        escapeLevel = 0; // reset
    }

    // 2. Harmonic Closure Projection (H)
    let safeString = jsonString;

    // Neutralize string polarity
    if (inString) {
        safeString += '"';
    }

    // Pad dangling values
    const trimmed = safeString.trimEnd();
    if (trimmed.endsWith(':') || trimmed.endsWith(',')) {
        safeString += 'null';
    }

    const closeStack = (str: string) => {
        let closed = str;
        for (let i = stack.length - 1; i >= 0; i--) {
            closed += stack[i];
        }
        return closed;
    };

    safeString = closeStack(safeString);

    // 3. Final Parse Execution
    try {
        return JSON.parse(safeString);
    } catch (e) {
        // Fallback 1: Unfinished Object Key. `{"key": "value", "partial` -> `{"key": "value", "partial": null}`
        try {
            const fallback1 = closeStack(jsonString + (inString ? '"' : '') + ':null');
            return JSON.parse(fallback1);
        } catch (e1) { }

        // Fallback 2: Trailing comma in an object. `{"key": "value",` -> `{"key": "value"}`
        try {
            let stripped = jsonString.trimEnd();
            if (stripped.endsWith(',')) stripped = stripped.slice(0, -1);
            const fallback2 = closeStack(stripped + (inString ? '"' : ''));
            return JSON.parse(fallback2);
        } catch (e2) { }

        // Fallback 3: Trailing colon in an object without quotes `{"key":` -> `{"key":null}`
        try {
            let stripped = jsonString.trimEnd();
            if (stripped.endsWith(':')) {
                const fallback3 = closeStack(stripped + 'null');
                return JSON.parse(fallback3);
            }
        } catch (e3) { }

        // Absolute worst case fallback if LLM wrote entirely malformed syntax
        return undefined;
    }
}

/**
 * Plucks completed Array items from a raw string stream in real-time.
 * As the LLM types `[{ "a": 1 }, { "a": 2`, it will yield the `{ "a": 1 }` object fully parsed
 * immediately without waiting for the array to close.
 */
export async function* extractStreamItems<T = unknown>(
    stream: AsyncGenerator<{ content: string }, void, unknown>
): AsyncGenerator<T, void, unknown> {

    let buffer = '';
    let inString = false;
    let escapeLevel = 0;
    let depth = 0;
    let itemStartIndex = -1;

    for await (const chunk of stream) {
        const delta = chunk.content;
        if (!delta) continue;

        for (let i = 0; i < delta.length; i++) {
            const char = delta[i];
            buffer += char; // We append strictly the current char, keeping buffer completely chronosyntactically aligned

            if (char === '\\') {
                escapeLevel++;
                continue;
            }

            if (char === '"' && escapeLevel % 2 === 0) {
                inString = !inString;
            } else if (!inString) {
                if (char === '{' || char === '[') {
                    depth++;
                    // If we just hit depth 2 (e.g., inside an array, starting an object), mark the start!
                    if (depth === 2 && itemStartIndex === -1) {
                        itemStartIndex = buffer.length - 1;
                    }
                } else if (char === '}' || char === ']') {
                    depth--;
                    // If we just completed a depth-2 object, extract it!
                    if (depth === 1 && itemStartIndex !== -1) {
                        const itemString = buffer.slice(itemStartIndex);
                        try {
                            const parsed = JSON.parse(itemString);
                            yield parsed as T;
                        } catch (e) {
                            // Theoretically impossible due to exact bracket alignment, unless internal JSON syntax is malformed.
                        }

                        // We reset start index. We delete the parsed substring from buffer to prevent memory bloat, 
                        // preserving just the depth-1 structure (like '[') implicitly handled by the matrix tracker.
                        buffer = buffer.slice(0, itemStartIndex);
                        itemStartIndex = -1;
                    }
                }
            }

            escapeLevel = 0;
        }
    }
}
