import type { BotActionCandidate } from '../model/Candidate';
import type { PlanningState } from '../model/PlanningState';
import type { ProvinceLocation } from '../model/References';

export interface OpponentCardModel {
    readonly id: string;
    readonly name?: string;
    readonly type: string;
    readonly fate: number;
    readonly military?: number;
    readonly political?: number;
    readonly militaryBonus?: number;
    readonly politicalBonus?: number;
    readonly swing?: number;
    readonly tag?: string;
    readonly conflictTypes?: readonly ('military' | 'political')[];
    readonly canDisableDefender?: boolean;
    readonly canBowOpponent?: boolean;
    readonly usageKey?: string;
}

export interface OpponentProvinceModel {
    readonly id: string;
    readonly name?: string;
    readonly strength: number;
    readonly location?: ProvinceLocation;
    readonly abilityClass?: string;
}

export interface PublicOpponentEvidence {
    readonly playedCardIds?: readonly string[];
    readonly discardedCardIds?: readonly string[];
    readonly revealedCardIds?: readonly string[];
    readonly searchedCardIds?: readonly string[];
    readonly publicDraws?: number;
    readonly bidHistory?: readonly number[];
    readonly usedLimits?: readonly string[];
    readonly revealedProvinces?: readonly OpponentProvinceModel[];
}

export interface HandHypothesis {
    readonly id: string;
    readonly cards: readonly OpponentCardModel[];
    readonly weight: number;
    readonly exact: boolean;
    readonly rationale: readonly string[];
}

export interface ProvinceHypothesis {
    readonly location: ProvinceLocation;
    readonly possibilities: readonly { readonly province: OpponentProvinceModel; readonly weight: number }[];
    readonly exact: boolean;
}

export interface OpponentResponsePackage {
    readonly id: string;
    readonly candidates: readonly BotActionCandidate[];
    readonly fateCost: number;
    readonly cardIds: readonly string[];
    readonly weight: number;
    readonly certainty: number;
    readonly rationale: readonly string[];
}

export interface OpponentInformationSnapshot {
    readonly mode: 'fair' | 'omniscient';
    readonly handHypotheses: readonly HandHypothesis[];
    readonly provinceHypotheses: readonly ProvinceHypothesis[];
    readonly responsePackages: readonly OpponentResponsePackage[];
    readonly certainty: number;
    readonly trace: Readonly<Record<string, unknown>>;
}

export interface OpponentInformationProvider<TInput = unknown> {
    readonly mode: 'fair' | 'omniscient';
    build(state: PlanningState, input: Readonly<TInput>): OpponentInformationSnapshot;
}
