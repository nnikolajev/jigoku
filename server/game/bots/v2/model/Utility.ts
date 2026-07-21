export const UTILITY_COMPONENTS = [
    'terminal', 'strongholdSafety', 'provinceTempo', 'conflictOutcome', 'ringValue',
    'boardNow', 'boardFuture', 'fate', 'cards', 'honor', 'conflictDeckSafety',
    'information', 'initiative', 'comboProgress', 'flexibility', 'waste',
    'uncertainty', 'risk'
] as const;

export type UtilityComponent = typeof UTILITY_COMPONENTS[number];
export type UtilityVector = Readonly<Record<UtilityComponent, number>>;
export type UtilityWeights = Readonly<Partial<Record<UtilityComponent, number>>>;

export function emptyUtility(): UtilityVector {
    return Object.freeze(Object.fromEntries(UTILITY_COMPONENTS.map((component) => [component, 0]))) as UtilityVector;
}

export function addUtility(left: UtilityVector, right: Partial<UtilityVector>): UtilityVector {
    return Object.freeze(Object.fromEntries(UTILITY_COMPONENTS.map((component) => [
        component,
        left[component] + (right[component] || 0)
    ]))) as UtilityVector;
}

export function scalarUtility(vector: UtilityVector, weights: UtilityWeights = {}): number {
    return UTILITY_COMPONENTS.reduce((total, component) =>
        total + vector[component] * (weights[component] ?? 1), 0);
}

export interface ScoredUtility {
    readonly vector: UtilityVector;
    readonly scalar: number;
    readonly explanation: readonly string[];
    readonly terminalRank: number;
}
