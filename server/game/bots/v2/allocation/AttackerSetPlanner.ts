// Chooses which characters attack a given conflict.
//
// NOTE: `applyAttackerPlan` is ALREADY SHIPPED IN V1 (2026-07-31, `true` in
// both planner profiles, live on 60.4% of attack-sizing decisions). Do not
// "port V2's attacker allocation" again — see CLAUDE.md.
import { characterMaterialValue } from '../BoardValue.js';
import { candidateId, type BotActionCandidate } from '../model/Candidate';
import type { EffectDescriptor } from '../model/Effects';
import type { ActionMacro, SemanticMacroStep } from '../model/Macro';
import type { CharacterProjection, PlanningState } from '../model/PlanningState';
import type { CharacterRef } from '../model/References';
import { immutable } from '../model/Stable';
import { pessimisticStrongholdAttackReserve } from '../ConflictThresholds.js';

const MAX_EXACT_ATTACKERS = 12;

interface AttackerOption {
    readonly candidate: BotActionCandidate;
    readonly character: CharacterProjection;
    readonly target: CharacterRef;
    readonly skill: number;
    readonly futureCost: number;
}

interface AttackerSubset {
    readonly options: readonly AttackerOption[];
    readonly skill: number;
    readonly futureCost: number;
}

interface ExactBreakOpportunity {
    readonly baseRequired: number;
    readonly publicDefense: number;
    readonly responseReserve: number;
    readonly required: number;
    readonly mode: 'unopposed-last-break' | 'public-stronghold-break' |
        'bounded-last-break' | 'bounded-stronghold-break';
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

function futureCost(state: PlanningState, character: CharacterProjection): number {
    const reusable = character.noBowAfterConflict || character.canReady;
    const alternate = state.conflict?.type === 'political' ? character.military : character.political;
    const material = characterMaterialValue(state, character);
    return (material + Math.max(0, alternate) * 1.5) * (reusable ? 0.2 : 1);
}

function compareSubsets(required: number, left: AttackerSubset, right: AttackerSubset): number {
    const leftWaste = Math.max(0, left.skill - required);
    const rightWaste = Math.max(0, right.skill - required);
    const leftValue = left.futureCost + leftWaste * 1.5 + left.options.length * 0.25;
    const rightValue = right.futureCost + rightWaste * 1.5 + right.options.length * 0.25;
    return leftValue - rightValue || leftWaste - rightWaste ||
        left.options.length - right.options.length ||
        left.options.map((option) => characterOrderKey(option.character)).join(':')
            .localeCompare(right.options.map((option) => characterOrderKey(option.character)).join(':'));
}

function bestSubset(options: readonly AttackerOption[], required: number): AttackerSubset | undefined {
    if(required <= 0 || options.length === 0 || options.length > MAX_EXACT_ATTACKERS) return undefined;
    const sufficient: AttackerSubset[] = [];
    const combinations = 1 << options.length;
    for(let mask = 1; mask < combinations; mask++) {
        const selected: AttackerOption[] = [];
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

function ownConflictOpportunities(state: PlanningState): number {
    const total = state.opportunities.remainingTotalByPlayer?.[state.perspectivePlayerId];
    if(total !== undefined) return total;
    const remaining = state.opportunities.remainingByPlayer[state.perspectivePlayerId];
    return (remaining?.military || 0) + (remaining?.political || 0);
}

function exactLastConflictBreak(state: PlanningState): ExactBreakOpportunity | undefined {
    if(state.conflict?.attackerId !== state.perspectivePlayerId ||
        state.conflict.attackerSkill !== 0 || state.conflict.defenderSkill !== 0 ||
        ownConflictOpportunities(state) > 1) return undefined;
    const opponent = Object.values(state.players).find((player) => player.id !== state.perspectivePlayerId);
    if(!opponent) return undefined;
    const stronghold = state.conflict.provinceLocation === 'stronghold province';
    const publicDefense = state.characters
        .filter((character) => character.controllerId === opponent.id && character.ready &&
            !character.bowed && !character.participating)
        .reduce((sum, character) => sum + relevantSkill(state, character), 0);
    const baseRequired = Math.max(1, state.conflict.breakThreshold || state.conflict.provinceStrength);
    const responseReserve = pessimisticStrongholdAttackReserve(state);
    return {
        baseRequired,
        publicDefense,
        responseReserve,
        required: baseRequired + publicDefense + responseReserve,
        mode: responseReserve > 0
            ? stronghold ? 'bounded-stronghold-break' : 'bounded-last-break'
            : publicDefense > 0
                ? stronghold ? 'public-stronghold-break' : 'bounded-last-break'
                : 'unopposed-last-break'
    };
}

function completeSetMacro(state: PlanningState, selected: AttackerSubset,
    done?: BotActionCandidate): ActionMacro {
    const expected = { phase: state.phase, conflictId: state.scopes.conflictId };
    const steps: SemanticMacroStep[] = selected.options.map((option, index) => ({
        id: `attacker:${index}:${option.character.instanceId}`,
        kind: 'target',
        semanticValue: option.character.instanceId,
        expected,
        command: option.candidate.commandPreview.command,
        args: option.candidate.commandPreview.args
    }));
    steps.push({
        id: 'attacker-set:done',
        kind: 'confirmation',
        semanticValue: done ? 'Done' : 'Initiate Conflict',
        expected,
        command: 'menuButton',
        // Before the first attacker is selected Jigoku exposes Pass Conflict.
        // It creates the legal Initiate Conflict button (and UUID) only after
        // that click, so continuation must resolve that future button by text.
        args: done ? done.commandPreview.args : []
    });
    return {
        id: `macro:attacker-set:${state.scopes.conflictId || 'conflict'}:${selected.options
            .map((option) => option.character.instanceId).join(':')}`,
        currentStep: 0,
        abortPolicy: 'fallback-v1',
        startedAtSignature: state.materialStateSignature,
        steps
    };
}

function setCandidate(state: PlanningState, options: readonly AttackerOption[], selected: AttackerSubset,
    done: BotActionCandidate | undefined, opportunity: ExactBreakOpportunity): BotActionCandidate {
    const macro = completeSetMacro(state, selected, done);
    const first = macro.steps[0];
    const targets = selected.options.map((option) => option.target);
    const identity = {
        kind: 'attacker-set' as const,
        mode: opportunity.mode === 'bounded-stronghold-break' || opportunity.mode === 'bounded-last-break'
            ? `${opportunity.mode}:${opportunity.baseRequired}:${opportunity.publicDefense}:` +
                `${opportunity.responseReserve}:${opportunity.required}:${selected.skill}`
            : opportunity.mode === 'public-stronghold-break'
            ? `public-stronghold-break:${opportunity.baseRequired}:${opportunity.publicDefense}:` +
                `${opportunity.required}:${selected.skill}`
            : `unopposed-last-break:${opportunity.required}:${selected.skill}`,
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
            id: opportunity.mode === 'bounded-stronghold-break' || opportunity.mode === 'bounded-last-break'
                ? `pessimistic-${opportunity.mode}`
                : opportunity.mode === 'public-stronghold-break'
                ? 'exact-public-stronghold-break'
                : 'exact-unopposed-last-conflict-break',
            description: `attackers provide ${selected.skill} for ${opportunity.required} ` +
                `(${opportunity.baseRequired} break plus ${opportunity.publicDefense} public defense and ` +
                `${opportunity.responseReserve} response reserve)`,
            satisfied: selected.skill >= opportunity.required
        }],
        tags: [
            'offense' as const,
            ...(state.conflict!.provinceLocation === 'stronghold province' ? ['terminal' as const] : [])
        ],
        limits: [],
        uncertainty: opportunity.responseReserve > 0 ? 0.05 : 0.02,
        confidence: opportunity.responseReserve > 0 ? 0.95 : 0.98,
        proposer: 'attacker-set-planner',
        annotations: [{
            proposer: 'attacker-set-planner',
            note: `attacker-set:${opportunity.mode}:base=${opportunity.baseRequired}:` +
                `public-defense=${opportunity.publicDefense}:response-reserve=${opportunity.responseReserve}:` +
                `required=${opportunity.required}:` +
                `selected=${selected.skill}:count=${selected.options.length}`,
            scoreDelta: {
                conflictOutcome: Math.min(opportunity.required, selected.skill),
                provinceTempo: state.conflict!.provinceLocation === 'stronghold province' ? 40 : 8,
                boardFuture: Math.min(8, preserved / 4),
                waste: -Math.max(0, selected.skill - opportunity.required)
            }
        }]
    }) as BotActionCandidate;
}

/** Builds a transactional attacker set only when public state proves a final break. */
export default class AttackerSetPlanner {
    expand(state: PlanningState, candidates: readonly BotActionCandidate[]): readonly BotActionCandidate[] {
        const attackerAtoms = candidates.filter((candidate) => candidate.kind === 'attacker-set');
        const opportunity = exactLastConflictBreak(state);
        if(attackerAtoms.length === 0 || !opportunity) return candidates;
        const done = candidates.find((candidate) => candidate.kind === 'pass' &&
            candidate.commandPreview.command === 'menuButton' &&
            /done/i.test(String(candidate.commandPreview.target || candidate.mode || '')));
        const futureInitiate = !done && /choose attackers/i.test(state.prompt?.menu || '') &&
            candidates.some((candidate) => candidate.kind === 'pass' &&
                candidate.commandPreview.command === 'menuButton' &&
                /pass conflict/i.test(String(candidate.commandPreview.target || candidate.mode || '')));
        if(!done && !futureInitiate) return candidates;

        const options = attackerAtoms.flatMap((candidate): AttackerOption[] => {
            const target = candidate.targets.length === 1 && candidate.targets[0].kind === 'character'
                ? candidate.targets[0] : undefined;
            const character = target ? state.characters.find((entry) =>
                entry.instanceId === target.instanceId && entry.controllerId === state.perspectivePlayerId)
                : undefined;
            if(!target || !character || character.participating || character.bowed || !character.ready ||
                character.covert || character.attackRestrictions.length > 0) return [];
            const legalType = state.conflict?.type === 'political'
                ? character.canAttackPolitical : character.canAttackMilitary;
            const skill = relevantSkill(state, character);
            if(!legalType || skill <= 0 || candidate.commandPreview.command !== 'cardClicked') return [];
            return [{ candidate, character, target: characterRef(character), skill,
                futureCost: futureCost(state, character) }];
        }).sort((left, right) => characterOrderKey(left.character).localeCompare(characterOrderKey(right.character)));
        const selected = bestSubset(options, opportunity.required);
        if(!selected) return candidates;
        return immutable([
            ...candidates.filter((candidate) => candidate.kind !== 'attacker-set' && candidate.id !== done?.id),
            setCandidate(state, options, selected, done, opportunity)
        ]) as readonly BotActionCandidate[];
    }
}
