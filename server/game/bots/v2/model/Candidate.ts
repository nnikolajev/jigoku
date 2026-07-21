import type { BotCommandName, BotDecision } from '../../BotEngine';
import type { ActionMacro } from './Macro';
import type { EffectDescriptor } from './Effects';
import type { CardRef, TargetRef } from './References';
import type { UtilityVector } from './Utility';
import { stableHash } from './Stable';

export type BotActionKind =
    | 'pass' | 'confirmation' | 'bid' | 'mulligan' | 'discard'
    | 'card-selection' | 'target-selection' | 'mode-selection'
    | 'dynasty-purchase' | 'dynasty-ability' | 'conflict-declaration'
    | 'province-choice' | 'ring-choice' | 'conflict-type-choice'
    | 'attacker-set' | 'defender-set' | 'conflict-card' | 'in-play-ability'
    | 'reaction' | 'interrupt' | 'macro-continuation' | 'v1-fallback';

export type ActionTag =
    | 'terminal' | 'defense' | 'offense' | 'economy' | 'setup' | 'payoff'
    | 'movement' | 'ready' | 'control' | 'cancel' | 'reducer' | 'attachment'
    | 'ring' | 'province' | 'duel' | 'uncertain' | 'fallback';

export interface CommandDescriptor {
    readonly command: BotCommandName;
    readonly args: readonly unknown[];
    readonly target?: string;
}

export interface ResourceDelta {
    readonly fate?: number;
    readonly honor?: number;
    readonly cards?: number;
    readonly conflictOpportunities?: number;
    readonly additionalFate?: number;
}

export interface CandidatePrerequisite {
    readonly id: string;
    readonly description: string;
    readonly satisfied: boolean;
}

export interface UsageLimit {
    readonly key: string;
    readonly scope: 'conflict' | 'phase' | 'round' | 'game';
    readonly maximum: number;
}

export interface CandidateAnnotation {
    readonly proposer: string;
    readonly note?: string;
    readonly scoreDelta?: Partial<UtilityVector>;
}

export interface BotActionCandidate {
    readonly id: string;
    readonly kind: BotActionKind;
    readonly source?: CardRef;
    readonly mode?: string;
    readonly targets: readonly TargetRef[];
    readonly commandPreview: CommandDescriptor;
    readonly macro?: ActionMacro;
    readonly costs: ResourceDelta;
    readonly effects: readonly EffectDescriptor[];
    readonly prerequisites: readonly CandidatePrerequisite[];
    readonly tags: readonly ActionTag[];
    readonly limits: readonly UsageLimit[];
    readonly uncertainty: number;
    readonly confidence: number;
    readonly proposer: string;
    readonly annotations?: readonly CandidateAnnotation[];
    readonly fallbackDecision?: BotDecision;
}

export interface CandidateIdentityInput {
    readonly kind: BotActionKind;
    readonly source?: CardRef;
    readonly mode?: string;
    readonly targets?: readonly TargetRef[];
    readonly commandPreview: CommandDescriptor;
}

export function candidateId(input: CandidateIdentityInput): string {
    return `candidate:${input.kind}:${stableHash(input)}`;
}

export interface CandidateVeto {
    readonly candidateId: string;
    readonly vetoed: boolean;
    readonly code: string;
    readonly reason: string;
    readonly safety: boolean;
}
