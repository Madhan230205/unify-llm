import { BaseProvider } from './base';
import { CompletionRequest, CompletionResponse, UnifyAPIError } from '../types';
import { streamSSE } from '../utils/stream';

export class GeminiProvider extends BaseProvider {
    readonly name = 'gemini';
    private apiKey: string;
    private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

    constructor(apiKey?: string) {
        super();
        const envKey = typeof process !== 'undefined' && process.env ? process.env.GEMINI_API_KEY : undefined;
        this.apiKey = apiKey || envKey || '';

        if (!this.apiKey) {
            throw new UnifyAPIError("Gemini API Key is required.", this.name);
        }
    }

    private buildPayload(request: CompletionRequest) {
        const systemInstruction = request.messages.find(m => m.role === 'system')?.content;
        const contents = [];
        for (const msg of request.messages) {
            if (msg.role === 'system') continue;

            if (msg.role === 'tool' && msg.toolResults) {
                contents.push({
                    role: 'user', // Gemini expects functionResponses to come from the 'user'
                    parts: msg.toolResults.map(tr => ({
                        functionResponse: {
                            name: tr.name,
                            response: { result: tr.result }
                        }
                    }))
                });
                continue;
            }

            const parts: any[] = [];
            if (msg.content) {
                parts.push({ text: msg.content });
            }
            if (msg.files && msg.files.length > 0) {
                for (const file of msg.files) {
                    const cleanData = file.data.replace(/^data:[^;]+;base64,/, '');
                    parts.push({
                        inlineData: {
                            mimeType: file.mimeType,
                            data: cleanData
                        }
                    });
                }
            }
            if (msg.toolCalls) {
                msg.toolCalls.forEach(tc => {
                    parts.push({
                        functionCall: {
                            name: tc.name,
                            args: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments
                        }
                    });
                });
            }

            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts
            });
        }

        const payload: any = {
            contents,
            systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
            generationConfig: {
                temperature: request.temperature,
                maxOutputTokens: request.maxTokens,
            },
            ...request.providerOptions
        };

        if (request.schema) {
            payload.generationConfig.responseMimeType = "application/json";
            payload.generationConfig.responseSchema = request.schema;
        }

        if (request.tools && request.tools.length > 0) {
            payload.tools = [{
                functionDeclarations: request.tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: {
                        type: "OBJECT",
                        properties: tool.schema.properties || {},
                        required: tool.schema.required || []
                    }
                }))
            }];
        }

        return payload;
    }

    async generateCompletion(request: CompletionRequest): Promise<CompletionResponse> {
        const payload = this.buildPayload(request);

        const response = await fetch(`${this.baseUrl}/${request.model}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': this.apiKey
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let rawError;
            try { rawError = JSON.parse(errorText); } catch (e) { rawError = errorText; }
            throw new UnifyAPIError(`Gemini API error: ${response.status} - ${errorText}`, this.name, response.status, rawError);
        }

        const data = await response.json();

        let content = '';
        let toolCalls;

        if (data.candidates?.[0]?.content?.parts) {
            const parts = data.candidates[0].content.parts;
            const textPart = parts.find((p: any) => p.text);
            if (textPart) content = textPart.text;

            const functionCallParts = parts.filter((p: any) => p.functionCall);
            if (functionCallParts.length > 0) {
                let i = 0;
                toolCalls = functionCallParts.map((p: any) => ({
                    id: `call_${Date.now()}_${i++}`, // Gemini lacks native call IDs
                    name: p.functionCall.name,
                    arguments: p.functionCall.args
                }));
            }
        }

        const usage = data.usageMetadata ? {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
            totalTokens: data.usageMetadata.totalTokenCount,
            cachedTokens: data.usageMetadata.cachedContentTokenCount || 0
        } : undefined;

        return {
            content,
            toolCalls,
            model: request.model,
            usage,
            providerSpecific: data
        };
    }

    async * streamCompletion(request: CompletionRequest): AsyncGenerator<CompletionResponse, void, unknown> {
        const payload = this.buildPayload(request);

        const response = await fetch(`${this.baseUrl}/${request.model}:streamGenerateContent?alt=sse`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': this.apiKey
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let rawError;
            try { rawError = JSON.parse(errorText); } catch (e) { rawError = errorText; }
            throw new UnifyAPIError(`Gemini API error: ${response.status} - ${errorText}`, this.name, response.status, rawError);
        }

        if (!response.body) {
            throw new UnifyAPIError("No response body returned from Gemini.", this.name);
        }

        for await (const event of streamSSE(response.body)) {
            const dataStr = event.data;
            if (dataStr === '[DONE]') break;

            try {
                const data = JSON.parse(dataStr);
                const contentDelta = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                const usageMetadata = data.usageMetadata;

                let toolCalls;
                const functionCallParts = data.candidates?.[0]?.content?.parts?.filter((p: any) => p.functionCall) || [];
                if (functionCallParts.length > 0) {
                    let i = 0;
                    toolCalls = functionCallParts.map((p: any) => ({
                        id: `call_${Date.now()}_${i++}`, // Gemini lacks native call IDs
                        name: p.functionCall.name,
                        arguments: typeof p.functionCall.args === 'string' ? p.functionCall.args : JSON.stringify(p.functionCall.args || {})
                    }));
                }

                yield {
                    content: contentDelta,
                    toolCalls,
                    model: request.model,
                    usage: usageMetadata ? {
                        promptTokens: usageMetadata.promptTokenCount,
                        completionTokens: usageMetadata.candidatesTokenCount,
                        totalTokens: usageMetadata.totalTokenCount,
                        cachedTokens: usageMetadata.cachedContentTokenCount || 0
                    } : undefined,
                    providerSpecific: data
                };
            } catch (e: unknown) {
                // Ignore parse errors on incomplete chunks
            }
        }
    }
}
