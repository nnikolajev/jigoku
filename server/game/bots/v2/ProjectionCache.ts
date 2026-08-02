import { deepFreeze } from './model/Stable';

export type ProjectionCacheKind = 'card-semantics' | 'opponent-information';

export interface ProjectionCacheResult<T> {
    readonly value: T;
    readonly hit: boolean;
}

/** Per-engine bounded cache. Keys must include every material input to a projection. */
export default class ProjectionCache {
    private readonly values = new Map<string, unknown>();

    constructor(private readonly maximumEntries = 128) {}

    getOrCreate<T>(kind: ProjectionCacheKind, key: string, factory: () => T): ProjectionCacheResult<T> {
        const namespacedKey = `${kind}:${key}`;
        const existing = this.values.get(namespacedKey) as T | undefined;
        if(existing !== undefined) {
            this.values.delete(namespacedKey);
            this.values.set(namespacedKey, existing);
            return { value: existing, hit: true };
        }
        const value = deepFreeze(factory()) as T;
        this.values.set(namespacedKey, value);
        while(this.values.size > this.maximumEntries) {
            const oldest = this.values.keys().next().value;
            if(oldest === undefined) break;
            this.values.delete(oldest);
        }
        return { value, hit: false };
    }

    get size(): number {
        return this.values.size;
    }
}
