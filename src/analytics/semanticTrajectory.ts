/**
 * Semantic trajectory utilities.
 *
 * Tracks how semantic vectors move over time and measures curvature so streaming
 * guards can distinguish smooth topical drift from abrupt jumps.
 */

export class SemanticTrajectoryTracker {
    private positions: number[][] = [];
    private dimensions: number;

    constructor(dimensions: number = 10000) {
        this.dimensions = dimensions;
    }

    public pushCoordinate(h: number[]) {
        if (h.length !== this.dimensions) {
            throw new Error(`Coordinate dimension mismatch. Expected ${this.dimensions}, got ${h.length}`);
        }
        this.positions.push(h);
    }

    private getVelocity(t: number): number[] {
        if (t < 1 || t >= this.positions.length) throw new Error('Invalid time boundary for velocity.');
        const p1 = this.positions[t - 1];
        const p2 = this.positions[t];
        const v = new Array(this.dimensions);
        for (let i = 0; i < this.dimensions; i++) {
            v[i] = p2[i] - p1[i];
        }
        return v;
    }

    private getMagnitude(v: number[]): number {
        let sum = 0;
        for (let i = 0; i < this.dimensions; i++) {
            sum += v[i] * v[i];
        }
        return Math.sqrt(sum);
    }

    public getInstantaneousCurvature(): number {
        const n = this.positions.length;
        if (n < 3) return 0.0;

        const vPrev = this.getVelocity(n - 2);
        const vCurr = this.getVelocity(n - 1);

        const speedPrev = this.getMagnitude(vPrev) || 1e-9;
        const speedCurr = this.getMagnitude(vCurr) || 1e-9;

        const tPrev = vPrev.map(val => val / speedPrev);
        const tCurr = vCurr.map(val => val / speedCurr);

        const tPrime = new Array(this.dimensions);
        for (let i = 0; i < this.dimensions; i++) {
            tPrime[i] = tCurr[i] - tPrev[i];
        }

        return this.getMagnitude(tPrime) / speedCurr;
    }

    public getTrajectoryLength(): number {
        return this.positions.length;
    }

    public reset(): void {
        this.positions = [];
    }

    public getWindowedCurvature(windowSize: number = 3): number {
        const n = this.positions.length;
        if (n < windowSize + 2) return this.getInstantaneousCurvature();

        let totalCurvature = 0;
        let count = 0;

        for (let t = n - 1; t >= n - windowSize && t >= 2; t--) {
            const vPrev = this.getVelocity(t - 1);
            const vCurr = this.getVelocity(t);

            const speedPrev = this.getMagnitude(vPrev) || 1e-9;
            const speedCurr = this.getMagnitude(vCurr) || 1e-9;

            const tPrev = vPrev.map(val => val / speedPrev);
            const tCurr = vCurr.map(val => val / speedCurr);

            const tPrime = new Array(this.dimensions);
            for (let i = 0; i < this.dimensions; i++) {
                tPrime[i] = tCurr[i] - tPrev[i];
            }

            totalCurvature += this.getMagnitude(tPrime) / speedCurr;
            count++;
        }

        return count > 0 ? totalCurvature / count : 0;
    }
}

export { SemanticTrajectoryTracker as KinematicTrajectory };
