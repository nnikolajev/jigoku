import type { ActionMacro, MacroProgress, SemanticMacroStep, StateFingerprint } from './model/Macro';
import type { PlanningState } from './model/PlanningState';
import { immutable } from './model/Stable';

export interface MacroContinuation {
    readonly status: 'continue' | 'complete' | 'abort';
    readonly step?: SemanticMacroStep;
    readonly progress: MacroProgress;
    readonly reason?: string;
}

function matches(expected: StateFingerprint, state: PlanningState): boolean {
    if(expected.promptIdentity && expected.promptIdentity !== state.prompt.identity) return false;
    if(expected.promptTitle && expected.promptTitle !== state.prompt.title) return false;
    if(expected.menuTitle && expected.menuTitle !== state.prompt.menu) return false;
    if(expected.phase && expected.phase !== state.phase) return false;
    if(expected.conflictId && expected.conflictId !== state.scopes.conflictId) return false;
    if(expected.materialStateHash && expected.materialStateHash !== state.materialStateSignature) return false;
    return true;
}

export default class MacroExecutor {
    continue(macro: ActionMacro, state: PlanningState, completedStepIds: readonly string[] = []): MacroContinuation {
        const completed = new Set(completedStepIds);
        let index = macro.currentStep;
        while(index < macro.steps.length && completed.has(macro.steps[index].id)) {
            index++;
        }
        if(index >= macro.steps.length) {
            return immutable({
                status: 'complete',
                progress: { macroId: macro.id, completedStepIds: [...completed] }
            }) as MacroContinuation;
        }
        const step = macro.steps[index];
        if(!matches(step.expected, state)) {
            return immutable({
                status: 'abort',
                reason: 'macro-continuation-mismatch',
                progress: {
                    macroId: macro.id,
                    completedStepIds: [...completed],
                    nextStepId: step.id,
                    aborted: true,
                    abortReason: 'macro-continuation-mismatch'
                }
            }) as MacroContinuation;
        }
        return immutable({
            status: 'continue',
            step,
            progress: { macroId: macro.id, completedStepIds: [...completed], nextStepId: step.id }
        }) as MacroContinuation;
    }

    completeStep(macro: ActionMacro, progress: MacroProgress, stepId: string): MacroProgress {
        const completed = [...new Set([...progress.completedStepIds, stepId])];
        const next = macro.steps.find((step) => !completed.includes(step.id));
        return immutable({
            macroId: macro.id,
            completedStepIds: completed,
            nextStepId: next?.id
        }) as MacroProgress;
    }
}
