export type RunnableFunc<Input, Output> = (input: Input) => Promise<Output> | Output;

export interface Runnable<Input, Output> {
    invoke(input: Input): Promise<Output> | Output;
}

export type RunnableLike<Input, Output> = RunnableFunc<Input, Output> | Runnable<Input, Output>;

function isRunnable<Input, Output>(value: RunnableLike<Input, Output>): value is Runnable<Input, Output> {
    return typeof value === 'object' && value !== null && 'invoke' in value && typeof value.invoke === 'function';
}

function toRunnableFunc<Input, Output>(step: RunnableLike<Input, Output>): RunnableFunc<Input, Output> {
    if (isRunnable(step)) {
        return (input: Input) => step.invoke(input);
    }

    return step;
}

/**
 * A minimal, zero-dependency runnable pipeline inspired by LCEL-style composition.
 *
 * It accepts plain async/sync functions or objects implementing `invoke()` and
 * composes them into a strongly-typed execution chain.
 */
export class Chain<Input, Output> implements Runnable<Input, Output> {
    private readonly step: RunnableFunc<Input, Output>;

    constructor(step: RunnableLike<Input, Output>) {
        this.step = toRunnableFunc(step);
    }

    public static from<Input, Output>(step: RunnableLike<Input, Output>): Chain<Input, Output> {
        return new Chain(step);
    }

    public pipe<NextOutput>(nextStep: RunnableLike<Output, NextOutput>): Chain<Input, NextOutput> {
        const currentStep = this.step;
        const next = toRunnableFunc(nextStep);

        return new Chain<Input, NextOutput>(async (input: Input) => {
            const currentOutput = await currentStep(input);
            return next(currentOutput);
        });
    }

    public async invoke(input: Input): Promise<Output> {
        return this.step(input);
    }
}