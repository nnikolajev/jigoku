import type { CandidateVeto, BotActionCandidate } from './model/Candidate';
import type { PlanningState } from './model/PlanningState';
import type { CharacterRef } from './model/References';
import type { ScoredUtility } from './model/Utility';
import type { TacticalSearchResult } from './search/TacticalSearch';
import type { TerminalSolverResult } from './terminal/TerminalSolver';
import { immutable } from './model/Stable';
import type { DynastyPackageProof } from './resources/DynastyPackageLedger';
import {
    type BreakResponseReserveProfile,
    exactConflictContribution,
    pessimisticBreakResponseReserve,
    pessimisticStrongholdAttackReserve,
    requiredBreakPreventionContribution,
    requiredConflictContribution,
    requiredStrongholdContribution
} from './ConflictThresholds';
import { characterMaterialValue, conflictCommitmentCost, exactRemovalTradeAdvantage } from './BoardValue';

export type V2OverrideReason =
    | 'semantic-agreement'
    | 'terminal-play'
    | 'minimum-sufficient-response'
    | 'resource-preservation'
    | 'semantic-setup-payoff'
    | 'safety-correction'
    | 'autonomous-policy';

// Execution-safe single-command decision kinds. These are answered with one
// self-contained command (no cost/target/mode chain that can stall the click
// controller), so letting the utility policy diverge here cannot produce the
// participant-set / multi-prompt loops documented in the rejected experiments.
// Participant sets, card plays, and dynasty purchases are intentionally
// excluded; they keep their own dedicated proofs.
const DEFAULT_AUTONOMOUS_KINDS: ReadonlySet<string> = new Set([
    'pass', 'bid', 'confirmation', 'card-selection', 'target-selection',
    'mode-selection', 'ring-choice', 'conflict-type-choice', 'province-choice',
    'conflict-declaration'
]);

export interface OverrideCandidateScore {
    readonly candidate: BotActionCandidate;
    readonly score: ScoredUtility;
}

export interface OverrideProof {
    readonly accepted: boolean;
    readonly reason?: V2OverrideReason;
    readonly evidence: readonly string[];
}

export interface OverridePolicyInput {
    readonly state: PlanningState;
    readonly preference?: OverrideCandidateScore;
    readonly v1Candidate?: BotActionCandidate;
    readonly scoreGap?: number;
    readonly v1Vetoes: readonly CandidateVeto[];
    readonly terminal?: TerminalSolverResult;
    readonly search: TacticalSearchResult;
    readonly candidates: readonly BotActionCandidate[];
    readonly dynastyPackageProof?: DynastyPackageProof;
    readonly defenderResponseReserve?: BreakResponseReserveProfile;
    readonly profile?: {
        readonly confidence?: number;
        readonly scoreAdvantage?: number;
        /** Experimental opt-in: retained package execution still needs broad win-rate evidence. */
        readonly allowDynastyPackageOverride?: boolean;
        /** Experimental opt-in: exact defender macros have not shown broad paired uplift. */
        readonly allowExactDefenderSetOverride?: boolean;
        /** Narrow retained slice: only a positive exact break-prevention set. */
        readonly allowExactBreakPreventionSetOverride?: boolean;
        /** Experimental opt-in: exact unopposed last-conflict attacker macros need paired evidence. */
        readonly allowExactAttackerSetOverride?: boolean;
        /** Experimental opt-in: even the narrow empty-target attachment slice regressed paired play. */
        readonly allowDurableAttachmentOverride?: boolean;
        /** Experimental opt-in: a reserve veto alone does not prove the replacement action is better. */
        readonly allowResourceReserveSubstitution?: boolean;
        /** Experimental opt-in: let the utility policy diverge on execution-safe single-command kinds. */
        readonly allowAutonomousPolicy?: boolean;
        /** Optional override of the execution-safe kinds eligible for autonomous divergence. */
        readonly autonomousKinds?: readonly string[];
    };
}

function resourceCost(candidate?: BotActionCandidate): number {
    return (candidate?.costs.fate || 0) + (candidate?.costs.cards || 0) + (candidate?.costs.honor || 0);
}

function preservesFutureConflictAllocation(state: PlanningState, candidate: BotActionCandidate): boolean {
    const moved = candidate.effects.filter((effect) => effect.kind === 'move' &&
        effect.destination === 'conflict' && effect.target?.kind === 'character')
        .map((effect) => state.characters.find((character) =>
            character.instanceId === (effect.target as CharacterRef).instanceId))
        .filter((character): character is NonNullable<typeof character> => !!character &&
            character.controllerId === state.perspectivePlayerId && !character.participating);
    if(moved.length === 0 || state.conflict?.provinceLocation === 'stronghold province') return true;
    if(moved.every((character) => character.noBowAfterConflict || character.canReady)) return true;
    const futureOpportunities = state.opportunities.remainingTotalByPlayer
        ? Object.values(state.opportunities.remainingTotalByPlayer).reduce((sum, remaining) => sum + remaining, 0)
        : Object.values(state.opportunities.remainingByPlayer)
            .reduce((sum, remaining) => sum + (remaining?.military || 0) + (remaining?.political || 0), 0);
    return futureOpportunities <= 1;
}

const SOURCE_ACTION_KINDS = new Set(['conflict-card', 'in-play-ability', 'reaction', 'interrupt']);
const TARGETED_EFFECT_KINDS = new Set(['skill', 'bow', 'ready', 'move', 'status', 'remove', 'attachment']);
const INTENTIONAL_CONCESSION_MODES = new Set([
    'aggressive-concede-defense',
    'display-of-power-unopposed'
]);

function hasCoherentExecution(candidate: BotActionCandidate): boolean {
    if(!SOURCE_ACTION_KINDS.has(candidate.kind)) return true;
    if(candidate.macro) return true;
    return candidate.effects.length > 0 && candidate.effects.every((effect) =>
        !TARGETED_EFFECT_KINDS.has(effect.kind) || !!effect.target);
}

function sameCommand(left?: BotActionCandidate, right?: BotActionCandidate): boolean {
    return !!left && !!right && left.commandPreview.command === right.commandPreview.command &&
        JSON.stringify(left.commandPreview.args) === JSON.stringify(right.commandPreview.args);
}

function directParticipantCharacter(state: PlanningState,
    candidate?: BotActionCandidate): PlanningState['characters'][number] | undefined {
    if(candidate?.commandPreview.command !== 'cardClicked') return undefined;
    const instanceId = candidate.commandPreview.args[0];
    if(typeof instanceId !== 'string') return undefined;
    return state.characters.find((entry) => entry.instanceId === instanceId &&
        entry.controllerId === state.perspectivePlayerId && entry.ready && !entry.bowed && !entry.participating);
}

function directParticipantContribution(state: PlanningState, candidate?: BotActionCandidate): number {
    const character = directParticipantCharacter(state, candidate);
    if(!character) return 0;
    return Math.max(0, state.conflict?.type === 'political' ? character.political : character.military);
}

function conservativeV1Contribution(state: PlanningState, candidate?: BotActionCandidate): number {
    const exact = exactConflictContribution(state, candidate);
    const participant = directParticipantContribution(state, candidate);
    if(!candidate || !SOURCE_ACTION_KINDS.has(candidate.kind)) return Math.max(exact, participant);
    // V1 source actions often bind their target on the next prompt. An
    // unbound semantic descriptor is not proof that V1 contributes zero.
    // Credit its full positive skill here so V2 cannot spend another card to
    // replace an equivalent V1 pump merely because only V2's macro is bound.
    const sourceSkill = candidate.effects.reduce((sum, effect) => {
        if(effect.kind !== 'skill') return sum;
        const amount = state.conflict?.type === 'political' ? effect.political : effect.military;
        return sum + Math.max(0, amount || 0);
    }, 0);
    return Math.max(exact, participant, sourceSkill);
}

function concedesMaterialWaterRing(state: PlanningState, candidate: BotActionCandidate,
    v1Candidate?: BotActionCandidate): boolean {
    if(state.conflict?.ring !== 'water') return false;
    const winRequired = requiredConflictContribution(state);
    const selected = exactConflictContribution(state, candidate);
    const v1Selected = Math.max(exactConflictContribution(state, v1Candidate),
        directParticipantContribution(state, v1Candidate));
    if(winRequired <= 0 || selected >= winRequired || v1Selected < winRequired) return false;
    const selectedIds = new Set(candidate.targets.filter((target): target is CharacterRef =>
        target.kind === 'character').map((target) => target.instanceId));
    return state.characters.some((character) =>
        character.controllerId === state.perspectivePlayerId && character.ready && !character.bowed &&
        !character.participating && !selectedIds.has(character.instanceId) && character.fate === 0 &&
        characterMaterialValue(state, character) > 0);
}

function exactDefenderSetEvidence(state: PlanningState, candidate: BotActionCandidate,
    v1Candidate: BotActionCandidate | undefined, breakPreventionOnly = false,
    responseProfile: BreakResponseReserveProfile = {}): {
        readonly required: number; readonly evidence: readonly string[];
    } | undefined {
    if(candidate.kind !== 'defender-set' || candidate.proposer !== 'participant-set-planner' ||
        state.conflict?.defenderId !== state.perspectivePlayerId || !candidate.macro ||
        candidate.macro.currentStep !== 0 || sameCommand(candidate, v1Candidate)) return undefined;
    const targets = candidate.targets.filter((target): target is CharacterRef => target.kind === 'character');
    if(targets.length !== candidate.targets.length || new Set(targets.map((target) => target.instanceId)).size !== targets.length) {
        return undefined;
    }
    const steps = candidate.macro.steps;
    const selectionSteps = steps.slice(0, -1);
    const done = steps.at(-1);
    if(steps.length !== targets.length + 1 || selectionSteps.some((step) =>
        step.kind !== 'target' || step.command !== 'cardClicked' || typeof step.args?.[0] !== 'string') ||
        !done || done.kind !== 'confirmation' || done.command !== 'menuButton' ||
        !/done/i.test(done.semanticValue)) return undefined;
    const targetIds = targets.map((target) => target.instanceId);
    if(selectionSteps.some((step, index) => step.args![0] !== targetIds[index] ||
        step.semanticValue !== targetIds[index])) return undefined;
    const selectedCharacters = targets.map((target) => state.characters.find((character) =>
        character.instanceId === target.instanceId && character.controllerId === state.perspectivePlayerId));
    if(selectedCharacters.some((character) => !character || character.participating || character.bowed || !character.ready)) {
        return undefined;
    }
    const moveTargets = candidate.effects.filter((effect) => effect.kind === 'move' &&
        effect.destination === 'conflict' && !effect.conditional && (effect.confidence ?? 1) >= 0.9)
        .map((effect) => effect.target?.kind === 'character' ? effect.target.instanceId : undefined);
    if(candidate.effects.length !== targets.length || moveTargets.some((id, index) => id !== targetIds[index])) {
        return undefined;
    }
    const mode = /^(prevent-break|win-conflict):(\d+):(\d+):(\d+)$/.exec(candidate.mode || '');
    if(!mode) return undefined;
    const v1Character = directParticipantCharacter(state, v1Candidate);
    const costNeutralSingleWin = breakPreventionOnly && mode[1] === 'win-conflict' &&
        state.conflict.provinceLocation !== 'stronghold province' && targets.length === 1 &&
        !!v1Character && !!selectedCharacters[0] &&
        conflictCommitmentCost(state, selectedCharacters[0]) <= conflictCommitmentCost(state, v1Character);
    if(breakPreventionOnly && mode[1] !== 'prevent-break' && !costNeutralSingleWin) return undefined;
    if(mode[1] === 'win-conflict' && targets.length > 3) return undefined;
    const baseRequired = mode[1] === 'win-conflict'
        ? requiredConflictContribution(state)
        : requiredBreakPreventionContribution(state);
    const responseReserve = mode[1] === 'prevent-break'
        ? pessimisticBreakResponseReserve(state, responseProfile) : 0;
    const required = baseRequired + responseReserve;
    const selected = exactConflictContribution(state, candidate);
    if(Number(mode[2]) !== baseRequired || Number(mode[3]) !== responseReserve ||
        Number(mode[4]) !== selected || selected < required) return undefined;
    if(costNeutralSingleWin && directParticipantContribution(state, v1Candidate) >= required) return undefined;
    // A minimum break-prevention set may intentionally concede the conflict.
    // Do not call that exact when V1 would deny Water and the opponent can use
    // the ring to bow another ready, no-fate body that V2 claims to preserve.
    if(mode[1] === 'prevent-break' && concedesMaterialWaterRing(state, candidate, v1Candidate)) return undefined;
    // Committing several bodies to an ordinary province is an allocation
    // decision, not a local threshold proof. Keep that choice on V1 unless V1
    // has already committed a defender; stronghold defense and explicit
    // experimental all-defender-set runs retain their separate gates.
    if(breakPreventionOnly && state.conflict.provinceLocation !== 'stronghold province' &&
        targets.length > 1 && directParticipantContribution(state, v1Candidate) === 0) return undefined;
    if(breakPreventionOnly && baseRequired <= 0) return undefined;
    if(baseRequired === 0 && (mode[1] !== 'prevent-break' || targets.length !== 0)) return undefined;
    if(required > 0 && selectedCharacters.some((character) => {
        const skill = state.conflict?.type === 'political' ? character!.political : character!.military;
        return selected - Math.max(0, skill) >= required;
    })) return undefined;
    return {
        required,
        evidence: [
            'complete-participant-set-macro',
            required === 0 ? 'attack-not-breaking'
                : costNeutralSingleWin ? 'minimum-inclusion-cost-neutral-conflict-win'
                : mode[1] === 'win-conflict' ? 'minimum-inclusion-exact-conflict-win'
                    : 'minimum-inclusion-exact-break-prevention',
            `base-required:${baseRequired}`,
            `response-reserve:${responseReserve}`,
            `required:${required}`,
            `selected:${selected}`,
            `defenders:${targetIds.join(',') || 'none'}`,
            ...(costNeutralSingleWin ? [
                `selected-commitment-cost:${conflictCommitmentCost(state, selectedCharacters[0]!)}`,
                `v1-commitment-cost:${conflictCommitmentCost(state, v1Character!)}`,
                'cost-neutral-ring-denial'
            ] : []),
            'ring-consequence-safe',
            'replaces-v1-defender-commitment'
        ]
    };
}

function exactAttackerSetEvidence(state: PlanningState, candidate: BotActionCandidate,
    v1Candidate?: BotActionCandidate): { readonly required: number; readonly evidence: readonly string[] } | undefined {
    if(candidate.kind !== 'attacker-set' || candidate.proposer !== 'attacker-set-planner' ||
        state.conflict?.attackerId !== state.perspectivePlayerId || !candidate.macro ||
        candidate.macro.currentStep !== 0 || sameCommand(candidate, v1Candidate)) return undefined;
    const targets = candidate.targets.filter((target): target is CharacterRef => target.kind === 'character');
    if(targets.length === 0 || targets.length !== candidate.targets.length ||
        new Set(targets.map((target) => target.instanceId)).size !== targets.length) return undefined;
    const steps = candidate.macro.steps;
    const selectionSteps = steps.slice(0, -1);
    const done = steps.at(-1);
    if(steps.length !== targets.length + 1 || selectionSteps.some((step) =>
        step.kind !== 'target' || step.command !== 'cardClicked' || typeof step.args?.[0] !== 'string') ||
        !done || done.kind !== 'confirmation' || done.command !== 'menuButton' ||
        !/^(done|initiate conflict)$/i.test(done.semanticValue) ||
        /^initiate conflict$/i.test(done.semanticValue) && (done.args?.length || 0) !== 0) return undefined;
    const targetIds = targets.map((target) => target.instanceId);
    if(selectionSteps.some((step, index) => step.args![0] !== targetIds[index] ||
        step.semanticValue !== targetIds[index])) return undefined;
    const selectedCharacters = targets.map((target) => state.characters.find((character) =>
        character.instanceId === target.instanceId && character.controllerId === state.perspectivePlayerId));
    if(selectedCharacters.some((character) => !character || character.participating || character.bowed ||
        !character.ready || character.covert || character.attackRestrictions.length > 0 ||
        (state.conflict?.type === 'political' ? !character.canAttackPolitical : !character.canAttackMilitary))) {
        return undefined;
    }
    const moveTargets = candidate.effects.filter((effect) => effect.kind === 'move' &&
        effect.destination === 'conflict' && !effect.conditional && (effect.confidence ?? 1) >= 0.9)
        .map((effect) => effect.target?.kind === 'character' ? effect.target.instanceId : undefined);
    if(candidate.effects.length !== targets.length || moveTargets.some((id, index) => id !== targetIds[index])) {
        return undefined;
    }
    const unopposedMode = /^unopposed-last-break:(\d+):(\d+)$/.exec(candidate.mode || '');
    const strongholdMode = /^public-stronghold-break:(\d+):(\d+):(\d+):(\d+)$/.exec(candidate.mode || '');
    const boundedMode = /^bounded-(last|stronghold)-break:(\d+):(\d+):(\d+):(\d+):(\d+)$/.exec(candidate.mode || '');
    const baseRequired = Math.max(1, state.conflict.breakThreshold || state.conflict.provinceStrength);
    const selected = exactConflictContribution(state, candidate);
    const opponent = Object.values(state.players).find((player) => player.id !== state.perspectivePlayerId);
    const publicDefense = opponent ? state.characters
        .filter((character) => character.controllerId === opponent.id && character.ready &&
            !character.bowed && !character.participating)
        .reduce((sum, character) => sum + Math.max(0,
            state.conflict?.type === 'political' ? character.political : character.military), 0) : 0;
    const responseReserve = boundedMode ? pessimisticStrongholdAttackReserve(state) : 0;
    const required = baseRequired + publicDefense + responseReserve;
    const modeMatches = unopposedMode
        ? publicDefense === 0 && Number(unopposedMode[1]) === required && Number(unopposedMode[2]) === selected
        : strongholdMode ? state.conflict.provinceLocation === 'stronghold province' && publicDefense > 0 &&
            Number(strongholdMode[1]) === baseRequired && Number(strongholdMode[2]) === publicDefense &&
            Number(strongholdMode[3]) === required && Number(strongholdMode[4]) === selected
        : !!boundedMode && (responseReserve > 0 || publicDefense > 0) &&
            (boundedMode[1] === 'stronghold') === (state.conflict.provinceLocation === 'stronghold province') &&
            Number(boundedMode[2]) === baseRequired && Number(boundedMode[3]) === publicDefense &&
            Number(boundedMode[4]) === responseReserve && Number(boundedMode[5]) === required &&
            Number(boundedMode[6]) === selected;
    if(!modeMatches || selected < required || state.conflict.attackerSkill !== 0 ||
        state.conflict.defenderSkill !== 0) return undefined;
    if(selectedCharacters.some((character) => {
        const skill = state.conflict?.type === 'political' ? character!.political : character!.military;
        return selected - Math.max(0, skill) >= required;
    })) return undefined;
    const remaining = state.opportunities.remainingByPlayer[state.perspectivePlayerId];
    const remainingTotal = state.opportunities.remainingTotalByPlayer?.[state.perspectivePlayerId] ??
        (remaining?.military || 0) + (remaining?.political || 0);
    if(remainingTotal > 1) return undefined;
    const opponentHand = opponent && state.hands.find((hand) => hand.playerId === opponent.id);
    if(!opponent || !boundedMode && (opponent.fate !== 0 || opponentHand?.size !== 0)) return undefined;
    return {
        required,
        evidence: [
            'complete-participant-set-macro',
            boundedMode ? boundedMode[1] === 'stronghold'
                ? 'minimum-inclusion-pessimistic-stronghold-break'
                : 'minimum-inclusion-pessimistic-last-conflict-break'
                : strongholdMode ? 'minimum-inclusion-public-stronghold-break'
                : 'minimum-inclusion-unopposed-last-conflict-break',
            boundedMode ? 'public-defense-hand-fate-response-budgeted'
                : strongholdMode ? 'all-public-ready-defender-skill-budgeted'
                : 'opponent-zero-hand-fate-and-ready-characters',
            `base-required:${baseRequired}`,
            `public-defense:${publicDefense}`,
            `response-reserve:${responseReserve}`,
            `required:${required}`,
            `selected:${selected}`,
            `attackers:${targetIds.join(',')}`,
            'replaces-v1-attacker-commitment'
        ]
    };
}

/** Accepts live overrides only when a deterministic, inspectable proof clears fixed safety floors. */
export default class HighConfidenceOverridePolicy {
    evaluate(input: OverridePolicyInput): OverrideProof {
        const confidenceFloor = Math.max(0.9, Number(input.profile?.confidence) || 0.9);
        const scoreFloor = Math.max(3, Number(input.profile?.scoreAdvantage) || 3);
        const preference = input.preference;
        if(!preference) return immutable({ accepted: false, evidence: ['missing-preference'] });
        if(preference.candidate.confidence < confidenceFloor) {
            return immutable({ accepted: false, evidence: [`confidence:${preference.candidate.confidence}<${confidenceFloor}`] });
        }
        // Participant prompts build a set through repeated toggles followed by
        // Done. Atomic clicks stay on V1; only exact complete macros below may
        // clear their independent experimental gates.
        if((preference.candidate.kind === 'attacker-set' || preference.candidate.kind === 'defender-set') &&
            !preference.candidate.macro) {
            return immutable({ accepted: false, evidence: ['participant-set-macro-required'] });
        }
        if(!hasCoherentExecution(preference.candidate)) {
            return immutable({ accepted: false, evidence: ['unbound-action-source'] });
        }
        // Ownership-only slice: V2 may submit an exact native command when it
        // is byte-for-byte identical to V1 and has no continuation macro.
        // This reduces fallback accounting without changing the click or any
        // later target/mode choice. Disagreements still require score proof.
        if(preference.candidate.kind !== 'v1-fallback' && !preference.candidate.macro &&
            sameCommand(preference.candidate, input.v1Candidate)) {
            return immutable({
                accepted: true,
                reason: 'semantic-agreement',
                evidence: ['exact-v1-command-agreement', 'no-macro-continuation', 'no-behavior-change']
            });
        }
        if((input.scoreGap ?? -Infinity) < scoreFloor) {
            return immutable({ accepted: false, evidence: [`score-gap:${input.scoreGap ?? 'missing'}<${scoreFloor}`] });
        }

        // Experimental autonomous-policy slice (default off). When enabled, the
        // top-scored utility candidate is accepted for execution-safe,
        // single-command decision kinds only, once it clears the confidence and
        // score-advantage floors above and strictly diverges from V1 (an
        // identical command already returned `semantic-agreement`). Macros,
        // participant sets, and card/dynasty plays are excluded here and keep
        // their dedicated proofs. This measures whether the utility policy is
        // better than V1 where it can execute without stalling the controller.
        if(input.profile?.allowAutonomousPolicy === true && !preference.candidate.macro) {
            const autonomousKinds = input.profile.autonomousKinds && input.profile.autonomousKinds.length > 0
                ? new Set(input.profile.autonomousKinds)
                : DEFAULT_AUTONOMOUS_KINDS;
            if(autonomousKinds.has(preference.candidate.kind) && hasCoherentExecution(preference.candidate)) {
                return immutable({
                    accepted: true,
                    reason: 'autonomous-policy',
                    evidence: [
                        `autonomous:${preference.candidate.kind}`,
                        `score-gap:${input.scoreGap}`,
                        `confidence:${preference.candidate.confidence}`
                    ]
                });
            }
        }

        const exactOrBoundedAttack = preference.candidate.kind === 'attacker-set' &&
            preference.candidate.proposer === 'attacker-set-planner' &&
            /^(public-stronghold|bounded-(last|stronghold))-break:/.test(preference.candidate.mode || '');
        const attackerSetEvidence = exactOrBoundedAttack || input.profile?.allowExactAttackerSetOverride === true
            ? exactAttackerSetEvidence(input.state, preference.candidate, input.v1Candidate)
            : undefined;
        if(attackerSetEvidence) {
            return immutable({
                accepted: true,
                reason: input.state.conflict?.provinceLocation === 'stronghold province'
                    ? 'terminal-play'
                    : 'resource-preservation',
                evidence: attackerSetEvidence.evidence
            });
        }
        if(preference.candidate.kind === 'attacker-set') {
            return immutable({ accepted: false, evidence: ['incomplete-or-unproven-attacker-set'] });
        }

        const allowAllDefenderSets = input.profile?.allowExactDefenderSetOverride === true;
        const allowBreakPreventionSet = input.profile?.allowExactBreakPreventionSetOverride !== false;
        const intentionalOrdinaryConcession = preference.candidate.kind === 'defender-set' &&
            input.state.conflict?.provinceLocation !== 'stronghold province' &&
            INTENTIONAL_CONCESSION_MODES.has(input.v1Candidate?.mode || '');
        const defenderSetEvidence = !intentionalOrdinaryConcession && (allowAllDefenderSets || allowBreakPreventionSet)
            ? exactDefenderSetEvidence(input.state, preference.candidate, input.v1Candidate,
                !allowAllDefenderSets, input.defenderResponseReserve)
            : undefined;
        if(defenderSetEvidence) {
            return immutable({
                accepted: true,
                reason: defenderSetEvidence.required > 0
                    ? 'minimum-sufficient-response'
                    : 'resource-preservation',
                evidence: defenderSetEvidence.evidence
            });
        }
        if(preference.candidate.kind === 'defender-set') {
            return immutable({ accepted: false, evidence: [intentionalOrdinaryConcession
                ? `v1-intentional-concession:${input.v1Candidate?.mode}`
                : 'incomplete-or-unproven-defender-set'] });
        }

        const vetoCodes = new Set(input.v1Vetoes.map((entry) => entry.code));
        const resourceCodes = ['hard-fate-reserve', 'hard-card-reserve'].filter((code) => vetoCodes.has(code));
        if(input.profile?.allowResourceReserveSubstitution === true && resourceCodes.length > 0) {
            return immutable({
                accepted: true,
                reason: 'resource-preservation',
                evidence: resourceCodes.map((code) => `v1-veto:${code}`)
            });
        }
        if(input.profile?.allowDynastyPackageOverride === true && input.dynastyPackageProof &&
            input.state.phase === 'dynasty' &&
            preference.candidate.kind === 'dynasty-purchase' &&
            preference.candidate.macro && preference.candidate.annotations?.some((annotation) =>
                annotation.proposer === 'resource-package-planner') &&
            resourceCost(preference.candidate) <= input.state.players[input.state.perspectivePlayerId].fate) {
            return immutable({
                accepted: true,
                reason: 'resource-preservation',
                evidence: [
                    input.dynastyPackageProof.kind,
                    `package:${input.dynastyPackageProof.packageId}`,
                    `package-cost:${resourceCost(preference.candidate)}`
                ]
            });
        }

        if(input.terminal?.selected?.status === 'forced-win' ||
            input.terminal?.selected?.status === 'avoids-forced-loss') {
            return immutable({
                accepted: true,
                reason: 'terminal-play',
                evidence: [input.terminal?.selected?.status || `terminal-rank:${preference.score.terminalRank}`]
            });
        }

        // An ordinary defensive conflict win is not itself a material payoff:
        // spending a card merely to turn a safe loss into a win can be worse
        // than preserving that card for an attack.  Attackers must prove a
        // break; defenders must only prove that the current break is stopped.
        // Stronghold conflicts retain their stricter terminal proof below.
        const defending = input.state.conflict?.defenderId === input.state.perspectivePlayerId;
        const required = defending
            ? requiredBreakPreventionContribution(input.state)
            : requiredConflictContribution(input.state);
        const selectedContribution = exactConflictContribution(input.state, preference.candidate);
        const v1Contribution = conservativeV1Contribution(input.state, input.v1Candidate);
        const searchedFirst = input.search.complete && !input.search.exhausted &&
            input.search.firstCandidate?.id === preference.candidate.id;
        const exactTargetMacro = preference.candidate.targets.length > 0 && !!preference.candidate.macro;
        const exactImmediateProjection = preference.candidate.effects.length > 0 &&
            preference.candidate.effects.every((effect) => !effect.conditional &&
                (effect.confidence ?? 1) >= 0.9 && (!TARGETED_EFFECT_KINDS.has(effect.kind) || !!effect.target));
        const removalTradeAdvantage = exactRemovalTradeAdvantage(input.state, preference.candidate);
        const materialTradeAcceptable = removalTradeAdvantage === undefined || removalTradeAdvantage >= 0;
        const futureConflictAllocationSafe = preservesFutureConflictAllocation(input.state, preference.candidate);
        const strongholdRequired = requiredStrongholdContribution(input.state);
        if(strongholdRequired > 0 && selectedContribution >= strongholdRequired &&
            v1Contribution < strongholdRequired && exactTargetMacro && exactImmediateProjection && materialTradeAcceptable &&
            resourceCost(preference.candidate) <= 2) {
            return immutable({
                accepted: true,
                reason: 'minimum-sufficient-response',
                evidence: [
                    'immediate-stronghold-threshold',
                    `required:${strongholdRequired}`,
                    `selected:${selectedContribution}`,
                    `v1:${v1Contribution}`,
                    `selected-cost:${resourceCost(preference.candidate)}`,
                    'coherent-source-target-macro'
                ]
            });
        }
        const replacesOvercommit = v1Contribution > selectedContribution &&
            resourceCost(preference.candidate) <= resourceCost(input.v1Candidate);
        const replacesUndercommit = v1Contribution < required && resourceCost(preference.candidate) <= 2;
        if(required > 0 && selectedContribution >= required && searchedFirst && exactTargetMacro &&
            exactImmediateProjection && materialTradeAcceptable && futureConflictAllocationSafe &&
            (replacesOvercommit || replacesUndercommit)) {
            return immutable({
                accepted: true,
                reason: 'minimum-sufficient-response',
                evidence: [
                    defending ? 'material-threshold:prevent-break' : 'material-threshold:break',
                    `required:${required}`,
                    `selected:${selectedContribution}`,
                    `v1:${v1Contribution}`,
                    `v1-status:${v1Contribution < required ? 'undercommit' : 'overcommit'}`,
                    `selected-cost:${resourceCost(preference.candidate)}`,
                    ...(removalTradeAdvantage === undefined ? [] : [`material-trade:${removalTradeAdvantage}`]),
                    'future-conflict-allocation-safe',
                    'coherent-source-target-macro'
                ]
            });
        }

        const persistentAttachment = preference.candidate.effects.some((effect) => effect.kind === 'attachment') &&
            preference.candidate.effects.some((effect) => effect.kind === 'skill' &&
                effect.duration === 'while-attached' && ((effect.military || 0) > 0 || (effect.political || 0) > 0));
        const attachmentTargetRef = preference.candidate.targets.length === 1
            ? preference.candidate.targets[0] : undefined;
        const attachmentTarget = attachmentTargetRef?.kind === 'character'
            ? input.state.characters.find((character) => character.instanceId === attachmentTargetRef.instanceId)
            : undefined;
        if(input.profile?.allowDurableAttachmentOverride === true && attachmentTarget?.attachments.length === 0 &&
            searchedFirst && persistentAttachment && exactTargetMacro && exactImmediateProjection &&
            preference.candidate.kind === 'conflict-card' &&
            (preference.candidate.costs.fate || 0) === 0 &&
            (preference.candidate.costs.honor || 0) === 0 &&
            (preference.candidate.costs.cards || 0) <= 1 &&
            input.v1Candidate?.kind === 'pass' &&
            attachmentTarget?.controllerId === input.state.perspectivePlayerId && attachmentTarget.fate >= 2) {
            return immutable({
                accepted: true,
                reason: 'semantic-setup-payoff',
                evidence: [
                    'scenario-search-first',
                    'exact-free-persistent-attachment-on-empty-target',
                    `durable-target:${attachmentTarget.cardId || attachmentTarget.instanceId}`,
                    `target-fate:${attachmentTarget.fate}`,
                    'replaces-v1-pass'
                ]
            });
        }

        const lineIds = input.search.principalLine.map((step) => step.candidateId);
        const laterCandidates = lineIds.slice(1).map((id) => input.candidates.find((candidate) => candidate.id === id))
            .filter((candidate): candidate is BotActionCandidate => !!candidate);
        if(input.search.complete && !input.search.exhausted && lineIds[0] === preference.candidate.id &&
            preference.candidate.tags.includes('setup') && laterCandidates.some((candidate) =>
                candidate.tags.includes('payoff') && candidate.confidence >= confidenceFloor)) {
            return immutable({
                accepted: true,
                reason: 'semantic-setup-payoff',
                evidence: [`principal-line:${lineIds.join('>')}`]
            });
        }

        return immutable({ accepted: false, evidence: ['no-fixture-proven-override'] });
    }
}
