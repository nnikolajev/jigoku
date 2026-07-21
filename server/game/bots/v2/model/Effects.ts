import type { ConflictType, ProvinceLocation, RingElement, TargetRef } from './References';

export type EffectDuration = 'immediate' | 'conflict' | 'phase' | 'round' | 'while-attached' | 'delayed';

export interface EffectBase {
    readonly target?: TargetRef;
    readonly duration?: EffectDuration;
    readonly conditional?: string;
    readonly confidence?: number;
}

export type EffectDescriptor =
    | (EffectBase & { readonly kind: 'skill'; readonly military?: number; readonly political?: number; readonly diminishingAfter?: number })
    | (EffectBase & { readonly kind: 'bow' | 'ready' })
    | (EffectBase & { readonly kind: 'move'; readonly destination: 'conflict' | 'home' })
    | (EffectBase & { readonly kind: 'status'; readonly status: 'honored' | 'dishonored' | 'ordinary' })
    | (EffectBase & { readonly kind: 'remove'; readonly method: 'discard' | 'sacrifice' | 'return' | 'remove-from-game' })
    | (EffectBase & { readonly kind: 'resource'; readonly fate?: number; readonly honor?: number; readonly cards?: number })
    | (EffectBase & { readonly kind: 'deck'; readonly draw?: number; readonly mill?: number; readonly search?: number })
    | (EffectBase & { readonly kind: 'attachment'; readonly cardId?: string; readonly nonStackingKey?: string })
    | (EffectBase & { readonly kind: 'prevention' | 'cancel'; readonly event: string })
    | (EffectBase & { readonly kind: 'ring'; readonly element: RingElement; readonly claim?: boolean; readonly resolve?: boolean; readonly fate?: number })
    | (EffectBase & { readonly kind: 'province'; readonly location: ProvinceLocation; readonly strength?: number; readonly break?: boolean; readonly reveal?: boolean })
    | (EffectBase & { readonly kind: 'duel'; readonly duelType: string; readonly skillDelta?: number; readonly honorDelta?: number })
    | (EffectBase & { readonly kind: 'reduction'; readonly amount: number; readonly costType: 'fate' | 'honor' | 'card'; readonly appliesTo?: string })
    | (EffectBase & { readonly kind: 'conflict'; readonly conflictType?: ConflictType; readonly extraOpportunity?: number; readonly winnerId?: string });

export interface ProjectedEffectResult {
    readonly effects: readonly EffectDescriptor[];
    readonly confidence: number;
    readonly notes: readonly string[];
}

export interface DynamicEffectEvaluator<TState = unknown, TCandidate = unknown> {
    readonly id: string;
    evaluate(state: Readonly<TState>, candidate: Readonly<TCandidate>): ProjectedEffectResult;
}
