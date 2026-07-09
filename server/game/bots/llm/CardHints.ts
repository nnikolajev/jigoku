export type UseWhen = 'always' | 'losing' | 'winning' | 'attacked' | 'never';
export type TargetSide = 'self' | 'enemy' | 'either' | 'none';
export type TargetPreference = 'strongest' | 'weakest' | 'most-fate' | 'any';

/**
 * The standardized "data out" contract for LLM card analysis. One hint per
 * printed card id; every field has a safe default so a partially valid model
 * answer still produces a usable hint.
 */
export interface CardHint {
    cardId: string;
    useWhen: UseWhen;
    conflictTypes: Array<'military' | 'political'>;
    targetSide: TargetSide;
    targetPreference: TargetPreference;
    priority: number;
    summary: string;
}

const USE_WHEN = new Set<UseWhen>(['always', 'losing', 'winning', 'attacked', 'never']);
const TARGET_SIDE = new Set<TargetSide>(['self', 'enemy', 'either', 'none']);
const TARGET_PREFERENCE = new Set<TargetPreference>(['strongest', 'weakest', 'most-fate', 'any']);

export function validateCardHint(raw: any, cardId: string): CardHint | null {
    if(!raw || typeof raw !== 'object') {
        return null;
    }

    const conflictTypes = Array.isArray(raw.conflictTypes)
        ? raw.conflictTypes.filter((type: any) => type === 'military' || type === 'political')
        : [];
    const priority = Number(raw.priority);

    return {
        cardId: cardId,
        useWhen: USE_WHEN.has(raw.useWhen) ? raw.useWhen : 'always',
        conflictTypes: conflictTypes,
        targetSide: TARGET_SIDE.has(raw.targetSide) ? raw.targetSide : 'either',
        targetPreference: TARGET_PREFERENCE.has(raw.targetPreference) ? raw.targetPreference : 'any',
        priority: isNaN(priority) ? 5 : Math.max(0, Math.min(10, Math.round(priority))),
        summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 300) : ''
    };
}
