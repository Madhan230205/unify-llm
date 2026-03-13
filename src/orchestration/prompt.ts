import { Message } from '../types';
import { Runnable } from './chain';

export type PromptVariableValue = string | number | boolean | bigint | null | undefined;
export type PromptVariables = Record<string, PromptVariableValue>;

const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

function interpolateTemplate<T extends PromptVariables>(template: string, variables: T): string {
    const missing = new Set<string>();

    const formatted = template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
        if (!Object.prototype.hasOwnProperty.call(variables, key)) {
            missing.add(key);
            return `{${key}}`;
        }

        return String(variables[key]);
    });

    if (missing.size > 0) {
        throw new Error(`Missing prompt template variables: ${Array.from(missing).sort().join(', ')}`);
    }

    return formatted;
}

/**
 * A type-safe prompt template that renders structured `Message[]` payloads.
 */
export class PromptTemplate<T extends PromptVariables> implements Runnable<T, Message[]> {
    constructor(
        private readonly systemTemplate: string,
        private readonly userTemplate: string,
    ) {}

    public format(variables: T): Message[] {
        const messages: Message[] = [];

        if (this.systemTemplate.trim().length > 0) {
            messages.push({
                role: 'system',
                content: interpolateTemplate(this.systemTemplate, variables),
            });
        }

        messages.push({
            role: 'user',
            content: interpolateTemplate(this.userTemplate, variables),
        });

        return messages;
    }

    public invoke(variables: T): Message[] {
        return this.format(variables);
    }
}