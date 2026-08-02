import type { BotActionCandidate } from './model/Candidate';
import type { CharacterProjection, PlanningState } from './model/PlanningState';

/** Conservative, deterministic value used to compare exact character trades. */
export function characterMaterialValue(state: PlanningState, character: CharacterProjection): number {
    const relevant = state.conflict?.type === 'political' ? character.political : character.military;
    const current = character.participating && !character.bowed ? Math.max(0, relevant) : 0;
    const future = Math.max(0, character.military, character.political) +
        Math.max(0, character.fate) * 3 + character.attachments.length * 2;
    return current * 2 + future;
}

/** Future board value actually consumed by committing this character now. */
export function conflictCommitmentCost(state: PlanningState, character: CharacterProjection,
    valueBonus = 0): number {
    const reusable = character.noBowAfterConflict || character.canReady;
    const alternate = state.conflict?.type === 'political' ? character.military : character.political;
    const material = characterMaterialValue(state, character) + Math.max(0, valueBonus);
    return (material + Math.max(0, alternate) * 1.5) * (reusable ? 0.25 : 1);
}

/** Undefined means the candidate has no explicit friendly-material cost. */
export function exactRemovalTradeAdvantage(state: PlanningState,
    candidate: BotActionCandidate): number | undefined {
    const ownCosts = candidate.effects.filter((effect) => effect.kind === 'remove' && effect.cost === true)
        .map((effect) => state.characters.find((character) =>
            character.instanceId === (effect.target as any)?.instanceId))
        .filter((character): character is CharacterProjection => !!character &&
            character.controllerId === state.perspectivePlayerId);
    if(ownCosts.length === 0) return undefined;
    const opponentVictims = candidate.effects.filter((effect) => effect.kind === 'remove' && effect.cost !== true)
        .map((effect) => state.characters.find((character) =>
            character.instanceId === (effect.target as any)?.instanceId))
        .filter((character): character is CharacterProjection => !!character &&
            character.controllerId !== state.perspectivePlayerId);
    const gained = opponentVictims.reduce((sum, character) => sum + characterMaterialValue(state, character), 0);
    const paid = ownCosts.reduce((sum, character) => sum + characterMaterialValue(state, character), 0);
    return gained - paid;
}
