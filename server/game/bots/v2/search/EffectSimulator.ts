import type { BotActionCandidate } from '../model/Candidate';
import type { EffectDescriptor } from '../model/Effects';
import type {
    CharacterProjection,
    HandProjection,
    PlanningState,
    PlayerProjection
} from '../model/PlanningState';
import type { PlayerId } from '../model/References';
import { immutable, stableHash } from '../model/Stable';

export interface ProjectionResult {
    readonly state: PlanningState;
    readonly appliedEffectKinds: readonly string[];
    readonly pendingEffectKinds: readonly string[];
    readonly notes: readonly string[];
}

function targetId(effect: EffectDescriptor): string | undefined {
    const target: any = effect.target;
    return target?.instanceId || target?.id || target?.location || target?.element;
}

function controllerFor(effect: EffectDescriptor, fallback: PlayerId): PlayerId {
    const target: any = effect.target;
    return String(target?.controllerId || target?.id || fallback);
}

function statusDelta(character: CharacterProjection, next: 'honored' | 'dishonored' | 'ordinary'): number {
    const current = character.honored ? 1 : character.dishonored ? -1 : 0;
    const value = next === 'honored' ? 1 : next === 'dishonored' ? -1 : 0;
    return (value - current) * character.glory;
}

function updatePlayer(players: Record<PlayerId, PlayerProjection>, playerId: PlayerId,
    delta: Partial<Pick<PlayerProjection, 'fate' | 'honor' | 'conflictDeckSize' | 'dynastyDeckSize' | 'brokenProvinceCount'>>): void {
    const current = players[playerId];
    if(!current) return;
    players[playerId] = {
        ...current,
        fate: Math.max(0, current.fate + (delta.fate || 0)),
        honor: current.honor + (delta.honor || 0),
        conflictDeckSize: Math.max(0, current.conflictDeckSize + (delta.conflictDeckSize || 0)),
        dynastyDeckSize: Math.max(0, current.dynastyDeckSize + (delta.dynastyDeckSize || 0)),
        brokenProvinceCount: Math.max(0, current.brokenProvinceCount + (delta.brokenProvinceCount || 0))
    };
}

/** Applies descriptors to copied projections only. It has no game/controller dependency. */
export default class EffectSimulator {
    apply(state: PlanningState, candidate: BotActionCandidate, actorId: PlayerId = state.perspectivePlayerId): ProjectionResult {
        const players: Record<PlayerId, PlayerProjection> = Object.fromEntries(
            Object.entries(state.players).map(([id, player]) => [id, { ...player }])
        );
        let characters = state.characters.map((character) => ({
            ...character,
            traits: [...character.traits],
            attachments: character.attachments.map((attachment) => ({ ...attachment, nonStackingKeys: [...attachment.nonStackingKeys] }))
        }));
        let provinces = state.provinces.map((province) => ({ ...province, holdingIds: [...province.holdingIds] }));
        let rings = state.rings.map((ring) => ({ ...ring }));
        let conflictSeed = state.conflict ? { ...state.conflict } : undefined;
        let opportunities = {
            remainingByPlayer: Object.fromEntries(Object.entries(state.opportunities.remainingByPlayer).map(([id, value]) => [id, { ...value }])),
            totalRemaining: state.opportunities.totalRemaining
        };
        const hands: HandProjection[] = state.hands.map((hand) => ({ ...hand, cards: hand.cards.map((card) => ({ ...card })) }));
        let delayedEffects = state.ledgers.delayedEffects.map((effect) => ({ ...effect, targetIds: [...effect.targetIds] }));
        const matchingReducers = delayedEffects.filter((effect) => {
            if(!effect.id.startsWith('reduction:fate:')) return false;
            const appliesTo = effect.id.split(':').slice(3).join(':');
            return !appliesTo || candidate.tags.includes(appliesTo as any) || candidate.source?.cardId === appliesTo;
        });
        const reduction = matchingReducers.reduce((sum, effect) => sum + (Number(effect.id.split(':')[2]) || 0), 0);
        delayedEffects = delayedEffects.filter((effect) => !matchingReducers.includes(effect));
        let ledgers = {
            ...state.ledgers,
            usage: [...state.ledgers.usage],
            effectTargets: Object.fromEntries(Object.entries(state.ledgers.effectTargets).map(([key, ids]) => [key, [...ids]])),
            delayedEffects,
            reducersConsumed: [...state.ledgers.reducersConsumed],
            movementTriggers: [...state.ledgers.movementTriggers],
            duels: [...state.ledgers.duels]
        };
        const applied: string[] = [];
        const pending: string[] = [];
        const notes: string[] = [];

        updatePlayer(players, actorId, {
            fate: -Math.max(0, (candidate.costs.fate || 0) - reduction),
            honor: -Math.max(0, candidate.costs.honor || 0)
        });
        const actorHand = hands.find((hand) => hand.playerId === actorId);
        if(actorHand && candidate.costs.cards) {
            const sourceId = candidate.source?.instanceId;
            const remaining = sourceId ? actorHand.cards.filter((card) => card.instanceId !== sourceId) : actorHand.cards;
            const paid = Math.max(0, candidate.costs.cards);
            const nextCards = remaining.slice(0, Math.max(0, remaining.length - Math.max(0, paid - (sourceId ? 1 : 0))));
            Object.assign(actorHand, { size: Math.max(0, actorHand.size - paid), cards: nextCards });
        }

        for(const effect of candidate.effects) {
            const id = targetId(effect);
            const index = id ? characters.findIndex((character) => character.instanceId === id) : -1;
            const character = index >= 0 ? characters[index] : undefined;
            if(effect.duration === 'delayed' || effect.conditional) pending.push(effect.kind);
            if(effect.kind === 'skill' && character) {
                characters[index] = {
                    ...character,
                    military: character.military + (effect.military || 0),
                    political: character.political + (effect.political || 0)
                };
                applied.push(effect.kind);
            } else if(effect.kind === 'bow' && character) {
                characters[index] = { ...character, bowed: true, ready: false };
                applied.push(effect.kind);
            } else if(effect.kind === 'ready' && character) {
                characters[index] = { ...character, bowed: false, ready: true };
                applied.push(effect.kind);
            } else if(effect.kind === 'move' && character) {
                const participating = effect.destination === 'conflict';
                characters[index] = { ...character, participating, attacking: participating && actorId === state.conflict?.attackerId, defending: participating && actorId === state.conflict?.defenderId };
                applied.push(effect.kind);
            } else if(effect.kind === 'status' && character) {
                const delta = statusDelta(character, effect.status);
                characters[index] = {
                    ...character,
                    honored: effect.status === 'honored', dishonored: effect.status === 'dishonored',
                    military: character.military + delta, political: character.political + delta
                };
                applied.push(effect.kind);
            } else if(effect.kind === 'remove' && id) {
                const before = characters.length;
                characters = characters.filter((entry) => entry.instanceId !== id).map((entry) => ({
                    ...entry,
                    attachments: entry.attachments.filter((attachment) => attachment.instanceId !== id)
                }));
                if(characters.length !== before || character) applied.push(effect.kind);
            } else if(effect.kind === 'resource') {
                const playerId = controllerFor(effect, actorId);
                updatePlayer(players, playerId, { fate: effect.fate || 0, honor: effect.honor || 0 });
                const hand = hands.find((entry) => entry.playerId === playerId);
                if(hand && effect.cards) Object.assign(hand, { size: Math.max(0, hand.size + effect.cards) });
                applied.push(effect.kind);
            } else if(effect.kind === 'deck') {
                const playerId = controllerFor(effect, actorId);
                const draw = Math.max(0, effect.draw || 0);
                const mill = Math.max(0, effect.mill || 0);
                updatePlayer(players, playerId, { conflictDeckSize: -draw - mill });
                const hand = hands.find((entry) => entry.playerId === playerId);
                if(hand && draw) Object.assign(hand, { size: hand.size + draw });
                applied.push(effect.kind);
            } else if(effect.kind === 'attachment' && character) {
                characters[index] = {
                    ...character,
                    attachments: [...character.attachments, {
                        instanceId: candidate.source?.instanceId || `projected:${candidate.id}`,
                        cardId: effect.cardId || candidate.source?.cardId,
                        controllerId: actorId,
                        fate: 0,
                        nonStackingKeys: effect.nonStackingKey ? [effect.nonStackingKey] : []
                    }]
                };
                applied.push(effect.kind);
            } else if(effect.kind === 'ring') {
                rings = rings.map((ring) => ring.element === effect.element ? {
                    ...ring,
                    claimedBy: effect.claim ? actorId : ring.claimedBy,
                    fate: Math.max(0, ring.fate - (effect.fate || 0))
                } : ring);
                if(effect.fate) updatePlayer(players, actorId, { fate: effect.fate });
                applied.push(effect.kind);
            } else if(effect.kind === 'province') {
                const wasBroken = provinces.find((province) => province.location === effect.location)?.broken;
                provinces = provinces.map((province) => province.location === effect.location ? {
                    ...province,
                    effectiveStrength: effect.strength ?? province.effectiveStrength,
                    visible: effect.reveal === true || province.visible,
                    broken: effect.break === true || province.broken,
                    attackEligible: effect.break ? false : province.attackEligible
                } : province);
                if(effect.break && !wasBroken) {
                    const province = provinces.find((entry) => entry.location === effect.location);
                    if(province) updatePlayer(players, province.controllerId, { brokenProvinceCount: 1 });
                }
                applied.push(effect.kind);
            } else if(effect.kind === 'conflict') {
                if(conflictSeed) {
                    conflictSeed = {
                        ...conflictSeed,
                        type: effect.conflictType || conflictSeed.type,
                        winnerId: effect.winnerId || conflictSeed.winnerId
                    };
                }
                if(effect.extraOpportunity) {
                    const current = opportunities.remainingByPlayer[actorId] || { military: 0, political: 0 };
                    const type = effect.conflictType || conflictSeed?.type || 'military';
                    opportunities = {
                        remainingByPlayer: {
                            ...opportunities.remainingByPlayer,
                            [actorId]: { ...current, [type]: current[type] + effect.extraOpportunity }
                        },
                        totalRemaining: opportunities.totalRemaining + effect.extraOpportunity
                    };
                }
                applied.push(effect.kind);
            } else if(effect.kind === 'duel' && effect.honorDelta) {
                const playerId = controllerFor(effect, actorId);
                updatePlayer(players, playerId, { honor: effect.honorDelta });
                applied.push(effect.kind);
            } else if(effect.kind === 'reduction') {
                delayedEffects.push({
                    id: `reduction:${effect.costType}:${effect.amount}:${effect.appliesTo || ''}`,
                    resolvesAt: 'next-matching-cost', sourceId: candidate.source?.instanceId, targetIds: []
                });
                applied.push(effect.kind);
            } else {
                pending.push(effect.kind);
                notes.push(`not-materialized:${effect.kind}`);
            }
        }
        for(const limit of candidate.limits) {
            const scopeId = limit.scope === 'conflict' ? state.scopes.conflictId
                : limit.scope === 'phase' ? state.scopes.phaseId
                    : limit.scope === 'round' ? state.scopes.roundId : state.scopes.gameId;
            if(!scopeId) continue;
            const existing = ledgers.usage.find((entry) => entry.key === limit.key && entry.scope === limit.scope && entry.scopeId === scopeId);
            ledgers.usage = [
                ...ledgers.usage.filter((entry) => entry !== existing),
                { key: limit.key, scope: limit.scope, scopeId, count: (existing?.count || 0) + 1, targetIds: candidate.targets.map((target: any) => target.instanceId || target.id || target.location || target.element).filter(Boolean) }
            ];
        }
        ledgers = { ...ledgers, delayedEffects };

        const readySkillByPlayer: Record<PlayerId, { military: number; political: number }> = {};
        const participatingSkillByPlayer: Record<PlayerId, number> = {};
        for(const playerId of Object.keys(players)) {
            const mine = characters.filter((character) => character.controllerId === playerId);
            readySkillByPlayer[playerId] = {
                military: mine.filter((character) => character.ready).reduce((sum, character) => sum + character.military, 0),
                political: mine.filter((character) => character.ready).reduce((sum, character) => sum + character.political, 0)
            };
            participatingSkillByPlayer[playerId] = mine.filter((character) => character.participating && !character.bowed)
                .reduce((sum, character) => sum + (state.conflict?.type === 'political' ? character.political : character.military), 0);
        }
        const conflict = conflictSeed ? {
            ...conflictSeed,
            attackerSkill: conflictSeed.attackerId ? participatingSkillByPlayer[conflictSeed.attackerId] || 0 : conflictSeed.attackerSkill,
            defenderSkill: conflictSeed.defenderId ? participatingSkillByPlayer[conflictSeed.defenderId] || 0 : conflictSeed.defenderSkill
        } : undefined;
        const resources = {
            fateByPlayer: Object.fromEntries(Object.values(players).map((player) => [player.id, player.fate])),
            honorByPlayer: Object.fromEntries(Object.values(players).map((player) => [player.id, player.honor])),
            handSizeByPlayer: Object.fromEntries(hands.map((hand) => [hand.playerId, hand.size])),
            conflictDeckByPlayer: Object.fromEntries(Object.values(players).map((player) => [player.id, player.conflictDeckSize]))
        };
        const projected = {
            ...state,
            players, characters, provinces, rings, hands, conflict, resources, ledgers,
            board: { readySkillByPlayer, participatingSkillByPlayer },
            opportunities,
            materialStateSignature: stableHash({ players, characters, provinces, rings, hands, conflict, opportunities })
        };
        return immutable({ state: projected, appliedEffectKinds: applied, pendingEffectKinds: [...new Set(pending)], notes }) as ProjectionResult;
    }
}
