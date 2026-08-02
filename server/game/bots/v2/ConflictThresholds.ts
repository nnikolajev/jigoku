import type { BotActionCandidate } from './model/Candidate';
import type { PlanningState } from './model/PlanningState';

/**
 * Returns only deterministic skill that the candidate's declared effects add
 * to the perspective player's side of the current conflict. Approximate or
 * untargeted semantics deliberately contribute nothing to threshold proofs.
 */
export function exactConflictContribution(state: PlanningState, candidate?: BotActionCandidate): number {
    const type = state.conflict?.type || 'military';
    return candidate?.effects.reduce((sum, effect) => {
        if(effect.conditional || (effect.confidence ?? 1) < 0.9) return sum;
        const target: any = effect.target;
        const character = target?.instanceId
            ? state.characters.find((entry) => entry.instanceId === target.instanceId)
            : undefined;
        const attachmentParent = target?.instanceId
            ? state.characters.find((entry) => entry.attachments?.some((attachment) =>
                attachment.instanceId === target.instanceId))
            : undefined;
        const attachment = attachmentParent?.attachments.find((entry) => entry.instanceId === target.instanceId);
        if(effect.kind === 'remove' && attachmentParent && attachment &&
            attachmentParent.controllerId !== state.perspectivePlayerId && attachmentParent.participating &&
            !attachmentParent.bowed) {
            return sum + Math.max(0, type === 'political'
                ? attachment.politicalBonus : attachment.militaryBonus);
        }
        if(!character) return sum;
        if(effect.kind === 'status' && character.participating) {
            if(effect.status === 'dishonored' && character.controllerId !== state.perspectivePlayerId &&
                !character.dishonored) return sum + Math.max(0, character.glory);
            if(effect.status === 'honored' && character.controllerId === state.perspectivePlayerId &&
                !character.honored) return sum + Math.max(0, character.glory);
        }
        const relevantSkill = Math.max(0, type === 'political' ? character.political : character.military);
        if(character.controllerId !== state.perspectivePlayerId) {
            if((effect.kind === 'remove' || effect.kind === 'bow' && !character.bowed) &&
                character.participating) return sum + relevantSkill;
            return sum;
        }
        if(effect.kind === 'remove' && effect.cost === true && character.participating) {
            return sum - relevantSkill;
        }
        if(effect.kind === 'skill' && character.participating && !character.bowed) {
            return sum + Math.max(0, type === 'political' ? effect.political || 0 : effect.military || 0);
        }
        if(effect.kind === 'move' && effect.destination === 'conflict' && !character.participating &&
            character.ready && !character.bowed) return sum + relevantSkill;
        if(effect.kind === 'ready' && character.participating && character.bowed) return sum + relevantSkill;
        return sum;
    }, 0) || 0;
}

/** Skill required to turn the current conflict into a win/break for this side. */
export function requiredConflictContribution(state: PlanningState): number {
    const conflict = state.conflict;
    if(!conflict) return 0;
    if(conflict.attackerId === state.perspectivePlayerId) {
        return Math.max(0, conflict.defenderSkill - conflict.attackerSkill + Math.max(1, conflict.breakThreshold));
    }
    if(conflict.defenderId === state.perspectivePlayerId) {
        return Math.max(0, conflict.attackerSkill - conflict.defenderSkill + 1);
    }
    return 0;
}

/** Skill required for the defender to stop the current province from breaking. */
export function requiredBreakPreventionContribution(state: PlanningState): number {
    const conflict = state.conflict;
    if(!conflict || conflict.defenderId !== state.perspectivePlayerId) return 0;
    return Math.max(0, conflict.attackerSkill - conflict.defenderSkill -
        Math.max(1, conflict.breakThreshold) + 1);
}

/**
 * A defender set is chosen before either player receives the first conflict
 * action. In fair mode an unknown opposing hand can contain a zero-cost +2
 * pump, so an otherwise exact set needs one bounded response margin. The
 * stronghold gets one extra point because a one-point miss ends the game and
 * the opponent may chain a second small effect. Empty hands remain exact.
 * This deliberately models one likely answer rather than escalating into
 * speculative all-in defense.
 */
export interface BreakResponseReserveProfile {
    readonly ordinary?: number;
    readonly stronghold?: number;
}

export function pessimisticBreakResponseReserve(state: PlanningState,
    profile: BreakResponseReserveProfile = {}): number {
    const opponent = Object.values(state.players || {}).find((player) =>
        player.id !== state.perspectivePlayerId);
    if(!opponent) return 0;
    const hand = (state.hands || []).find((entry) => entry.playerId === opponent.id);
    if((hand?.size || 0) <= 0) return 0;
    const configured = state.conflict?.provinceLocation === 'stronghold province'
        ? profile.stronghold ?? 3
        : profile.ordinary ?? 0;
    return Math.max(0, Math.min(3, Math.floor(configured)));
}

/**
 * Public-information reserve for a final attack. Ordinary conflicts budget
 * one common +2 hand response and one +1 fate-backed response. Exposed-stronghold
 * attacks budget +3 from hand and one +2 fate-backed response. This is a bounded
 * credible response package, not a claim that every hidden card is known.
 */
export function pessimisticStrongholdAttackReserve(state: PlanningState): number {
    const opponent = Object.values(state.players || {}).find((player) =>
        player.id !== state.perspectivePlayerId);
    if(!opponent) return 0;
    const hand = (state.hands || []).find((entry) => entry.playerId === opponent.id);
    const stronghold = state.conflict?.provinceLocation === 'stronghold province';
    const hiddenCardReserve = (hand?.size || 0) > 0 ? stronghold ? 3 : 2 : 0;
    const fateReserve = Math.max(0, opponent.fate || 0) > 0 ? stronghold ? 2 : 1 : 0;
    return hiddenCardReserve + fateReserve;
}

/** Skill required to cause, or prevent, an immediate stronghold break. */
export function requiredStrongholdContribution(state: PlanningState): number {
    const conflict = state.conflict;
    if(!conflict || conflict.provinceLocation !== 'stronghold province') return 0;
    if(conflict.attackerId === state.perspectivePlayerId) {
        return Math.max(0, conflict.defenderSkill - conflict.attackerSkill + Math.max(1, conflict.breakThreshold));
    }
    if(conflict.defenderId === state.perspectivePlayerId) {
        return Math.max(0, conflict.attackerSkill - conflict.defenderSkill -
            Math.max(1, conflict.breakThreshold) + 1);
    }
    return 0;
}

export function hasDirectStrongholdBreak(candidate: BotActionCandidate): boolean {
    return candidate.effects.some((effect) => effect.kind === 'province' &&
        effect.location === 'stronghold province' && effect.break === true && !effect.conditional &&
        (effect.confidence ?? 1) >= 0.9);
}
