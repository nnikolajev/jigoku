import { createHash } from 'crypto';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export function stableValue(value: any): any {
    if(Array.isArray(value)) {
        return value.map(stableValue);
    }
    if(value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .filter((key) => value[key] !== undefined)
                .sort()
                .map((key) => [key, stableValue(value[key])])
        );
    }
    return value;
}

export function stableSerialize(value: any): string {
    return JSON.stringify(stableValue(value));
}

export function stableHash(value: any): string {
    return createHash('sha256').update(stableSerialize(value)).digest('hex').slice(0, 24);
}

export function deepFreeze<T>(value: T): Readonly<T> {
    if(value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for(const child of Object.values(value as Record<string, unknown>)) {
            deepFreeze(child);
        }
    }
    return value;
}

export function immutable<T>(value: T): Readonly<T> {
    return deepFreeze(stableValue(value) as T);
}
