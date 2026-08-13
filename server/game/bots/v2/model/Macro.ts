// A multi-prompt sequence executed as one decision.
//
// Playing a card is rarely one click: source, mode, target, cost,
// confirmation. A macro records the intended whole sequence plus the state
// fingerprint it was planned against, so `MacroExecutor` can detect the board
// changing underneath it and abort per `MacroAbortPolicy` rather than
// blundering through the remaining steps.
import type { BotCommandName } from '../../BotEngine';

export type MacroStepKind = 'source' | 'mode' | 'target' | 'cost' | 'confirmation' | 'command';
export type MacroAbortPolicy = 'fallback-v1' | 'cancel' | 'replan' | 'pass';

export interface StateFingerprint {
    readonly promptIdentity?: string;
    readonly promptTitle?: string;
    readonly menuTitle?: string;
    readonly phase?: string;
    readonly conflictId?: string;
    readonly materialStateHash?: string;
}

export interface SemanticMacroStep {
    readonly id: string;
    readonly kind: MacroStepKind;
    readonly semanticValue: string;
    readonly expected: StateFingerprint;
    readonly command?: BotCommandName;
    readonly args?: readonly unknown[];
}

export interface ActionMacro {
    readonly id: string;
    readonly intentId?: string;
    readonly steps: readonly SemanticMacroStep[];
    readonly currentStep: number;
    readonly abortPolicy: MacroAbortPolicy;
    readonly startedAtSignature: string;
}

export interface MacroProgress {
    readonly macroId: string;
    readonly completedStepIds: readonly string[];
    readonly nextStepId?: string;
    readonly aborted?: boolean;
    readonly abortReason?: string;
}
