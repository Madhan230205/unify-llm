import { CompletionRequest, CompletionResponse, UnifyMiddleware } from '../types';
import { KinematicTrajectory } from '../analytics/semanticTrajectory';
import { generateHologram } from '../analytics/semanticFingerprintEngine';

export class AstralDivergenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AstralDivergenceError';
    }
}

/**
 * Holographic Orthogonal Manifold Engine (HOME) Interceptor
 * 
 * Intercepts LLM streaming outputs and calculates the Frenet-Serret Curvature (\kappa)
 * of the semantic trajectory using Hyperdimensional Computing. If the LLM veers into
 * an erratic hallucination, \kappa spikes, the interceptor throws an AstralDivergenceError,
 * and the router immediately triggers its native failover mechanisms.
 */
export class HomeInterceptorMiddleware implements UnifyMiddleware {
    private curvatureThreshold: number;
    private windowTokenSize: number;

    /**
     * @param curvatureThreshold The threshold for \kappa representing a mathematical hallucination.
     * @param windowTokenSize How many tokens to aggregate into a semantic window before yielding a tensor.
     */
    constructor(curvatureThreshold: number = 0.8, windowTokenSize: number = 10) {
        this.curvatureThreshold = curvatureThreshold;
        this.windowTokenSize = windowTokenSize;
    }

    async *wrapStream(
        request: CompletionRequest, 
        next: (req?: CompletionRequest) => AsyncGenerator<CompletionResponse, void, unknown>
    ): AsyncGenerator<CompletionResponse, void, unknown> {
        
        const trajectory = new KinematicTrajectory(10000);
        let currentWindow = "";
        let wordCount = 0;

        for await (const chunk of next(request)) {
            // Aggregate output
            currentWindow += chunk.content;
            
            // Track spaces as a rough proxy for word count boundaries
            const spaces = chunk.content.match(/\s+/g);
            if (spaces) {
                wordCount += spaces.length;
            }

            // Once the window boundary is reached, evaluate the manifold
            if (wordCount >= this.windowTokenSize) {
                // Generate hologram using Permutation-Based Logical Negation (PLN) natively
                const semanticVector = generateHologram(currentWindow);
                trajectory.pushCoordinate(Array.from(semanticVector));

                // Evaluate geometry if we have a valid path curve (n >= 3)
                if (trajectory.getTrajectoryLength() >= 3) {
                    const kappa = trajectory.getInstantaneousCurvature();
                    
                    // If curvature exceeds threshold, it's a massive erratic logical leap out of domain
                    if (kappa > this.curvatureThreshold) {
                        throw new AstralDivergenceError(`[HOME Circuit Breaker] Mid-stream hallucination caught natively. Semantic Curvature (\kappa=${kappa.toFixed(4)}) geometrically escaped threshold (${this.curvatureThreshold}).`);
                    }
                }

                // Smooth overlap? Or hard reset?
                // Let's do a sliding window by keeping the second half of the previous window for 
                // semantic continuity smoothing.
                const words = currentWindow.split(/\s+/);
                const overlap = words.slice(Math.floor(words.length / 2)).join(" ");
                currentWindow = overlap + " ";
                wordCount = Math.floor(this.windowTokenSize / 2);
            }

            yield chunk;
        }
    }
}
