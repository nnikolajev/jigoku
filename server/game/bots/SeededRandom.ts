/**
 * A tiny deterministic LCG, so a bot's tie-breaks are reproducible.
 *
 * The bot must never call `Math.random` directly: self-play seeds the SHUFFLE
 * through `Math.random` and the POLICY through this, and the two have to stay
 * separable — `refactorIdentity.js` replays a fixed shuffle and expects the
 * same decisions out. `getState` is recorded in every trace entry so a diverged
 * game can be traced back to the decision where the streams parted.
 */
class SeededRandom {
    private state: number;

    constructor(seed: string | number = 1) {
        this.state = this.hashSeed(seed);
    }

    next(): number {
        this.state = (1664525 * this.state + 1013904223) >>> 0;
        return this.state / 0x100000000;
    }

    nextInt(maxExclusive: number): number {
        if(maxExclusive <= 0) {
            return 0;
        }

        return Math.floor(this.next() * maxExclusive);
    }

    getState(): number {
        return this.state >>> 0;
    }

    private hashSeed(seed: string | number): number {
        const text = String(seed || 1);
        let hash = 2166136261;
        for(let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return hash >>> 0 || 1;
    }
}

export = SeededRandom;
