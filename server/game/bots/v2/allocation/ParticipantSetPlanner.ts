import { conflictCommitmentCost } from '../BoardValue.js';
import { candidateId, type BotActionCandidate } from '../model/Candidate';
import type { EffectDescriptor } from '../model/Effects';
import type { ActionMacro, SemanticMacroStep } from '../model/Macro';
import type { CharacterProjection, PlanningState } from '../model/PlanningState';
import type { CharacterRef } from '../model/References';
import { immutable } from '../model/Stable';
import {
    type BreakResponseReserveProfile,
    pessimisticBreakResponseReserve,
    requiredBreakPreventionContribution,
    requiredConflictContribution
} from '../ConflictThresholds.js';

const MAX_EXACT_DEFENDERS = 12;

interface DefenderOption {
    readonly candidate: BotActionCandidate;
    readonly character: CharacterProjection;
    readonly target: CharacterRef;
    readonly skill: number;
    readonly futureCost: number;
}

interface DefenderSubset {
    readonly options: readonly DefenderOption[];
    readonly skill: number;
    readonly futureCost: number;
}

function characterOrderKey(character: CharacterProjection): string {
    return [character.cardId || '', character.controllerId, character.instanceId].join('|');
}

function characterRef(character: CharacterProjection): CharacterRef {
    return {
        kind: 'character',
        instanceId: character.instanceId,
        cardId: character.cardId,
        controllerId: character.controllerId
    };
}

function relevantSkill(state: PlanningState, character: CharacterProjection): number {
    return Math.max(0, state.conflict?.type === 'political' ? character.political : character.military);
}

function futureCost(state: PlanningState, character: CharacterProjection,
    valueBonuses: Readonly<Record<string, number>> = {}): number {
    return conflictCommitmentCost(state, character, valueBonuses[character.cardId || ''] || 0);
}

function compareSubsets(required: number, left: DefenderSubset, right: DefenderSubset): number {
    const leftWaste = Math.max(0, left.skill - required);
    const rightWaste = Math.max(0, right.skill - required);
    const leftValue = left.futureCost + leftWaste * 1.5 + left.options.length * 0.25;
    const rightValue = right.futureCost + rightWaste * 1.5 + right.options.length * 0.25;
    return leftValue - rightValue || leftWaste - rightWaste ||
        left.options.length - right.options.length ||
        left.options.map((option) => characterOrderKey(option.character)).join(':')
            .localeCompare(right.options.map((option) => characterOrderKey(option.character)).join(':'));
}

function bestDefenderSubset(options: readonly DefenderOption[], required: number): DefenderSubset | undefined {
    if(required <= 0) return { options: [], skill: 0, futureCost: 0 };
    if(options.length > MAX_EXACT_DEFENDERS) return undefined;
    const sufficient: DefenderSubset[] = [];
    const combinations = 1 << options.length;
    for(let mask = 1; mask < combinations; mask++) {
        const selected: DefenderOption[] = [];
        let skill = 0;
        let cost = 0;
        for(let index = 0; index < options.length; index++) {
            if((mask & (1 << index)) === 0) continue;
            selected.push(options[index]);
            skill += options[index].skill;
            cost += options[index].futureCost;
        }
        if(skill >= required) sufficient.push({ options: selected, skill, futureCost: cost });
    }
    return sufficient.sort((left, right) => compareSubsets(required, left, right))[0];
}

function completeSetMacro(state: PlanningState, selected: DefenderSubset,
    done: BotActionCandidate): ActionMacro {
    const expected = { phase: state.phase, conflictId: state.scopes.conflictId };
    const steps: SemanticMacroStep[] = selected.options.map((option, index) => ({
        id: `defender:${index}:${option.character.instanceId}`,
        kind: 'target',
        semanticValue: option.character.instanceId,
        expected,
        command: option.candidate.commandPreview.command,
        args: option.candidate.commandPreview.args
    }));
    steps.push({
        id: 'defender-set:done',
        kind: 'confirmation',
        semanticValue: 'Done',
        expected,
        command: done.commandPreview.command,
        args: done.commandPreview.args
    });
    return {
        id: `macro:defender-set:${state.scopes.conflictId || 'conflict'}:${selected.options
            .map((option) => option.character.instanceId).join(':') || 'none'}`,
        currentStep: 0,
        abortPolicy: 'fallback-v1',
        startedAtSignature: state.materialStateSignature,
        steps
    };
}

function setCandidate(state: PlanningState, options: readonly DefenderOption[], selected: DefenderSubset,
    done: BotActionCandidate, goal: 'prevent-break' | 'win-conflict', baseRequired: number,
    responseReserve = 0): BotActionCandidate {
    const macro = completeSetMacro(state, selected, done);
    const first = macro.steps[0];
    const targets = selected.options.map((option) => option.target);
    const identity = {
        kind: 'defender-set' as const,
        mode: `${goal}:${baseRequired}:${responseReserve}:${selected.skill}`,
        targets,
        commandPreview: {
            command: first.command!,
            args: first.args || [],
            target: first.semanticValue
        }
    };
    const effects: EffectDescriptor[] = selected.options.map((option) => ({
        kind: 'move',
        destination: 'conflict',
        target: option.target,
        duration: 'conflict',
        confidence: 1
    }));
    const preserved = options.filter((option) => !selected.options.includes(option))
        .reduce((sum, option) => sum + option.futureCost, 0);
    return immutable({
        ...identity,
        id: candidateId(identity),
        macro,
        costs: {},
        effects,
        prerequisites: [{
            id: goal === 'win-conflict' ? 'exact-conflict-win' : 'exact-break-prevention',
            description: baseRequired > 0
                ? `${goal} defenders provide ${selected.skill} for required ${baseRequired + responseReserve}`
                : 'attack is not currently breaking the province',
            satisfied: selected.skill >= baseRequired + responseReserve
        }],
        tags: [
            'defense' as const,
            ...(state.conflict!.provinceLocation === 'stronghold province' ? ['terminal' as const] : [])
        ],
        limits: [],
        uncertainty: 0.02,
        confidence: 0.98,
        proposer: 'participant-set-planner',
        annotations: [{
            proposer: 'participant-set-planner',
            note: `defense-set:${goal}:base=${baseRequired}:reserve=${responseReserve}:required=${baseRequired + responseReserve}:selected=${selected.skill}:count=${selected.options.length}`,
            scoreDelta: {
                conflictOutcome: Math.min(baseRequired + responseReserve, selected.skill),
                boardFuture: Math.min(8, preserved / 4),
                flexibility: selected.options.length === 0 ? 4 : 1,
                waste: -Math.max(0, selected.skill - baseRequired - responseReserve)
            }
        }]
    }) as BotActionCandidate;
}

/**
 * Converts repeated defender toggles plus Done into one semantic set action.
 * It intentionally leaves attacker selection and impossible raw defenses on
 * V1 until their future-response contracts are equally exact.
 */
export default class ParticipantSetPlanner {
    expand(state: PlanningState, candidates: readonly BotActionCandidate[], configuration: {
        readonly includeConflictWin?: boolean;
        readonly includeCostNeutralConflictWin?: boolean;
        readonly includeNoDefense?: boolean;
        readonly responseReserve?: BreakResponseReserveProfile;
        readonly futureValueBonuses?: Readonly<Record<string, number>>;
    } = {}): readonly BotActionCandidate[] {
        const defenderAtoms = candidates.filter((candidate) => candidate.kind === 'defender-set');
        if(defenderAtoms.length === 0 || state.conflict?.defenderId !== state.perspectivePlayerId) return candidates;
        const done = candidates.find((candidate) => candidate.kind === 'pass' &&
            candidate.commandPreview.command === 'menuButton' &&
            /done/i.test(String(candidate.commandPreview.target || candidate.mode || '')));
        if(!done) return candidates;

        const options = defenderAtoms.flatMap((candidate): DefenderOption[] => {
            const target = candidate.targets.length === 1 && candidate.targets[0].kind === 'character'
                ? candidate.targets[0] : undefined;
            const character = target ? state.characters.find((entry) =>
                entry.instanceId === target.instanceId && entry.controllerId === state.perspectivePlayerId)
                : undefined;
            if(!target || !character || character.participating || character.bowed || !character.ready) return [];
            const skill = relevantSkill(state, character);
            if(skill <= 0 || candidate.commandPreview.command !== 'cardClicked') return [];
            return [{ candidate, character, target: characterRef(character), skill,
                futureCost: futureCost(state, character, configuration.futureValueBonuses) }];
        }).sort((left, right) => characterOrderKey(left.character).localeCompare(characterOrderKey(right.character)));

        const breakRequired = requiredBreakPreventionContribution(state);
        if(breakRequired === 0 && configuration.includeNoDefense === false) return candidates;
        const responseReserve = breakRequired > 0
            ? pessimisticBreakResponseReserve(state, configuration.responseReserve) : 0;
        const breakSet = bestDefenderSubset(options, breakRequired + responseReserve);
        // If selectable characters cannot prevent the break, V1 may still need
        // to establish a participant for a later pump, move, or reaction.
        if(!breakSet) return candidates;
        const sets = [setCandidate(state, options, breakSet, done, 'prevent-break', breakRequired, responseReserve)];
        const winRequired = requiredConflictContribution(state);
        const v1 = candidates.find((candidate) => candidate.kind === 'v1-fallback');
        const v1InstanceId = v1?.commandPreview.command === 'cardClicked'
            ? v1.commandPreview.args[0] : undefined;
        const v1Option = typeof v1InstanceId === 'string'
            ? options.find((option) => option.character.instanceId === v1InstanceId) : undefined;
        const proposedWinSet = configuration.includeConflictWin === false && !configuration.includeCostNeutralConflictWin
            ? undefined : bestDefenderSubset(options, winRequired);
        const costNeutralSingleWin = configuration.includeCostNeutralConflictWin === true &&
            state.conflict.provinceLocation !== 'stronghold province' &&
            !!v1Option && !['aggressive-concede-defense', 'display-of-power-unopposed'].includes(v1?.mode || '') &&
            !!proposedWinSet && proposedWinSet.options.length === 1 && v1Option.skill < winRequired &&
            proposedWinSet.futureCost <= v1Option.futureCost;
        const winSet = configuration.includeConflictWin !== false || costNeutralSingleWin
            ? proposedWinSet : undefined;
        const boundedWinUpgrade = !!winSet && winSet.options.length <= 3 &&
            winSet.options.length <= breakSet.options.length + 1;
        if(boundedWinUpgrade && winSet!.options.map((option) => option.character.instanceId).join(':') !==
            breakSet.options.map((option) => option.character.instanceId).join(':')) {
            sets.push(setCandidate(state, options, winSet!, done, 'win-conflict', winRequired));
        }

        return immutable([
            ...candidates.filter((candidate) => candidate.kind !== 'defender-set' && candidate.id !== done.id),
            ...sets
        ]) as readonly BotActionCandidate[];
    }
}
