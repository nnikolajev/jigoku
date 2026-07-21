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
