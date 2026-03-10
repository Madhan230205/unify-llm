export async function* streamNDJSON(stream: ReadableStream<Uint8Array>): AsyncGenerator<any, void, unknown> {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let newlineIndex = buffer.indexOf('\n');

            while (newlineIndex !== -1) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);

                if (line) {
                    try {
                        yield JSON.parse(line);
                    } catch (e) {
                        // ignore 
                    }
                }
                newlineIndex = buffer.indexOf('\n');
            }
        }

        if (buffer.trim()) {
            try {
                yield JSON.parse(buffer.trim());
            } catch (e) { }
        }
    } finally {
        reader.cancel().catch(() => { });
    }
}

export interface ParsedEvent {
    type: 'event';
    id?: string;
    event?: string;
    data: string;
}

export function createParser(onParse: (event: ParsedEvent) => void) {
    let buffer = '';
    let eventId: string | undefined;
    let eventName: string | undefined;
    let dataBuffer = '';

    function feed(chunk: string) {
        buffer += chunk;
        let newlineIndex = -1;

        while ((newlineIndex = buffer.search(/\r?\n/)) !== -1) {
            const line = buffer.slice(0, newlineIndex);
            const step = buffer[newlineIndex] === '\r' ? 2 : 1;
            buffer = buffer.slice(newlineIndex + step);

            if (line === '') {
                // Dispatch event when empty line is encountered
                if (dataBuffer.length > 0) {
                    onParse({
                        type: 'event',
                        id: eventId,
                        event: eventName,
                        data: dataBuffer.endsWith('\n') ? dataBuffer.slice(0, -1) : dataBuffer
                    });
                    dataBuffer = '';
                    eventId = undefined;
                    eventName = undefined;
                }
            } else if (line.startsWith(':')) {
                // Comment, ignore
            } else {
                const colonIndex = line.indexOf(':');
                let field = '';
                let value = '';
                if (colonIndex === -1) {
                    field = line;
                    value = '';
                } else {
                    field = line.slice(0, colonIndex);
                    value = line.slice(colonIndex + 1);
                    if (value.startsWith(' ')) {
                        value = value.slice(1);
                    }
                }

                if (field === 'data') {
                    dataBuffer += value + '\n';
                } else if (field === 'event') {
                    eventName = value;
                } else if (field === 'id') {
                    eventId = value;
                }
            }
        }
    }

    return { feed };
}

export async function* streamSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<ParsedEvent, void, unknown> {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');

    let eventQueue: ParsedEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let isDone = false;
    let streamError: any = null;

    const parser = createParser((event: ParsedEvent) => {
        eventQueue.push(event);
        if (resolveNext) {
            resolveNext();
            resolveNext = null;
        }
    });

    const processStream = async () => {
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    const finalChunkStr = decoder.decode();
                    if (finalChunkStr) {
                        parser.feed(finalChunkStr);
                    }
                    isDone = true;
                    if (resolveNext) resolveNext();
                    break;
                }
                const chunkStr = decoder.decode(value, { stream: true });
                parser.feed(chunkStr);
            }
        } catch (e) {
            streamError = e;
            if (resolveNext) resolveNext();
        } finally {
            reader.releaseLock();
        }
    };

    processStream();

    try {
        while (true) {
            if (eventQueue.length > 0) {
                yield eventQueue.shift()!;
            } else if (isDone) {
                break;
            } else if (streamError) {
                throw streamError;
            } else {
                await new Promise<void>(resolve => { resolveNext = resolve; });
            }
        }
    } finally {
        reader.cancel().catch(() => { });
    }
}
