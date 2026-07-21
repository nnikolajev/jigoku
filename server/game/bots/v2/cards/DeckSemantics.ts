import type { CardSemanticModel } from './CardSemantics';
import { boundedDynamicEvaluator } from './CardSemantics';
import {
    cancel,
    mill,
    movement,
    prevention,
    ready,
    semanticAction,
    status
} from './GenericSemantics';
import type { EffectDescriptor } from '../model/Effects';
import type { CharacterProjection, PlanningState } from '../model/PlanningState';
import type { BotActionCandidate } from '../model/Candidate';

function ownCharacters(state: PlanningState): readonly CharacterProjection[] {
    return state.characters.filter((character) => character.controllerId === state.perspectivePlayerId);
}

function enemyCharacters(state: PlanningState): readonly CharacterProjection[] {
    return state.characters.filter((character) => character.controllerId !== state.perspectivePlayerId);
}

function characterTarget(character: CharacterProjection) {
    return {
        kind: 'character' as const,
        instanceId: character.instanceId,
        cardId: character.cardId,
        controllerId: character.controllerId
    };
}

function withDynamic(model: CardSemanticModel, id: string,
    evaluate: (state: PlanningState, candidate: BotActionCandidate) => {
        effects: readonly EffectDescriptor[];
        confidence: number;
        notes: readonly string[];
    }, maximumEffects = 8): CardSemanticModel {
    return {
        ...model,
        actions: [{ ...model.actions[0], dynamicEvaluator: boundedDynamicEvaluator(id, evaluate, maximumEffects) }]
    };
}

const supernaturalStorm = withDynamic(
    semanticAction('supernatural-storm', [], {
        timings: ['conflict'],
        targets: [{ kind: 'character', side: 'self', participating: true }],
        planningTags: ['shugenja', 'skill', 'payoff'],
        synergies: [{ id: 'storm:shugenja-count', role: 'payoff', withTags: ['shugenja'], scoreDelta: 4 }]
    }),
    'supernatural-storm:live-shugenja',
    (state, candidate) => {
        const shugenja = ownCharacters(state).filter((character) =>
            character.traits.some((trait) => trait.toLowerCase() === 'shugenja')).length;
        const target = candidate.targets[0];
        return {
            effects: shugenja > 0 ? [{ kind: 'skill', military: shugenja, political: shugenja,
                duration: 'conflict', target }] : [],
            confidence: shugenja > 0 && target ? 0.98 : 0.65,
            notes: [`live-shugenja:${shugenja}`]
        };
    }
);

const ironCraneLegion = withDynamic(
    semanticAction('iron-crane-legion', [], {
        timings: ['conflict'], planningTags: ['duel-tower', 'hand-pressure', 'payoff']
    }),
    'iron-crane-legion:opponent-hand',
    (state, candidate) => {
        const opponent = Object.keys(state.players).find((id) => id !== state.perspectivePlayerId);
        const hand = state.hands.find((entry) => entry.playerId === opponent)?.size || 0;
        const source = candidate.source ? {
            kind: 'character' as const, instanceId: candidate.source.instanceId,
            cardId: candidate.source.cardId, controllerId: state.perspectivePlayerId
        } : undefined;
        return {
            effects: hand > 0 ? [{ kind: 'skill', military: hand, political: 0,
                duration: 'conflict', target: source }] : [],
            confidence: source ? 0.98 : 0.75,
            notes: [`opponent-hand:${hand}`]
        };
    }
);

const ujikTactics = withDynamic(
    semanticAction('ujik-tactics', [], {
        timings: ['conflict'], planningTags: ['military', 'swarm', 'payoff'],
        limits: [{ key: 'ujik-tactics', scope: 'conflict', maximum: 1 }]
    }),
    'ujik-tactics:non-unique-board',
    (state) => {
        const targets = ownCharacters(state).filter((character) => !character.unique);
        return {
            effects: targets.map((character) => ({
                kind: 'skill' as const, military: 1, political: 0, duration: 'conflict' as const,
                target: characterTarget(character)
            })),
            confidence: targets.length > 0 ? 0.98 : 0.7,
            notes: [`non-unique-characters:${targets.length}`]
        };
    }
);

const consumedByFiveFires = withDynamic(
    semanticAction('consumed-by-five-fires', [], {
        timings: ['conflict-phase'], cost: { fate: 5 },
        targets: [{ kind: 'character', side: 'opponent', maximum: 5 }],
        planningTags: ['shugenja', 'removal', 'expensive', 'payoff'],
        synergies: [{ id: 'five-fires:fate-package', role: 'payoff', withTags: ['fate-reserve'], scoreDelta: 6 }]
    }),
    'consumed-by-five-fires:remove-fate',
    (state) => {
        let remaining = 5;
        const effects: EffectDescriptor[] = [];
        const targets = [...enemyCharacters(state)].sort((left, right) =>
            right.fate - left.fate || right.military + right.political - left.military - left.political ||
            left.instanceId.localeCompare(right.instanceId));
        for(const target of targets) {
            const amount = Math.min(remaining, target.fate);
            if(amount <= 0) continue;
            effects.push({ kind: 'resource', fate: -amount, target: characterTarget(target),
                conditional: 'remove-fate-from-opposing-character' });
            remaining -= amount;
            if(remaining === 0) break;
        }
        return {
            effects,
            confidence: ownCharacters(state).some((character) => character.traits.some((trait) =>
                trait.toLowerCase() === 'shugenja')) ? 0.97 : 0.6,
            notes: [`projected-fate-removal:${5 - remaining}`]
        };
    },
    5
);

const forGreaterGlory = withDynamic(
    semanticAction('for-greater-glory', [], {
        timings: ['reaction'], cost: { fate: 1 }, delayed: true,
        planningTags: ['lion', 'bushi', 'province-break', 'payoff'],
        limits: [{ key: 'for-greater-glory', scope: 'conflict', maximum: 1 }]
    }),
    'for-greater-glory:participating-bushi',
    (state) => {
        const bushi = ownCharacters(state).filter((character) => character.participating &&
            character.traits.some((trait) => trait.toLowerCase() === 'bushi'));
        return {
            effects: bushi.map((character) => ({ kind: 'resource' as const, fate: 1,
                target: characterTarget(character), duration: 'immediate' as const })),
            confidence: state.conflict?.type === 'military' ? 0.98 : 0.75,
            notes: [`participating-bushi:${bushi.length}`]
        };
    }
);

const feedingAnArmy = withDynamic(
    semanticAction('feeding-an-army', [], {
        timings: ['conflict-phase'], delayed: true,
        planningTags: ['lion', 'swarm', 'province-cost', 'setup']
    }),
    'feeding-an-army:cheap-board',
    (state) => {
        const cheap = ownCharacters(state).filter((character) =>
            !character.cardId || character.military + character.political <= 7);
        return {
            effects: cheap.map((character) => ({ kind: 'resource' as const, fate: 1,
                target: characterTarget(character) })),
            confidence: 0.8,
            notes: [`projected-cheap-characters:${cheap.length}`, 'printed-cost-is-approximated']
        };
    }
);

const cavalryReserves = semanticAction('cavalry-reserves', [
    { kind: 'move', destination: 'conflict', conditional: 'cavalry-from-dynasty-discard-cost-total<=6' }
], {
    timings: ['conflict'], cost: { fate: 3 },
    targets: [{ kind: 'character', side: 'self', traits: ['cavalry'], maximum: 6 }],
    planningTags: ['movement', 'cavalry', 'virtual-participant', 'payoff'],
    confidence: 0.8
});

const nobleSacrifice = semanticAction('noble-sacrifice', [
    { kind: 'remove', method: 'discard', conditional: 'dishonored-opponent' }
], {
    timings: ['conflict-phase'], cost: { fate: 1, sacrificeSource: true },
    targets: [{ kind: 'character', side: 'opponent', traits: [] }],
    planningTags: ['honored', 'dishonored', 'removal', 'payoff'],
    synergies: [{ id: 'noble-sacrifice:honor-setup', role: 'payoff', withTags: ['honored'], scoreDelta: 7 }]
});

export const DECK_SEMANTICS: readonly CardSemanticModel[] = [
    supernaturalStorm,
    ironCraneLegion,
    ujikTactics,
    consumedByFiveFires,
    forGreaterGlory,
    feedingAnArmy,
    cavalryReserves,
    nobleSacrifice,

    semanticAction('daimyo-s-favor', [{ kind: 'reduction', amount: 1, costType: 'fate', appliesTo: 'attachment' }], {
        timings: ['conflict-phase'], planningTags: ['attachment', 'reducer', 'setup'],
        limits: [{ key: 'daimyo-s-favor', scope: 'round', maximum: 1 }]
    }),
    semanticAction('niten-master', [{ kind: 'ready', conditional: 'weapon-attachment-played' }], {
        timings: ['reaction'], targets: [{ kind: 'character', side: 'self' }],
        planningTags: ['dragon-tower', 'weapon', 'ready', 'payoff']
    }),
    prevention('finger-of-jade', 'targeted-opponent-effect'),

    movement('golden-plains-outpost', 'conflict'),
    movement('adorned-barcha', 'conflict'),
    ready('shiotome-encampment'),
    ready('moto-outrider'),
    ready('twilight-rider'),
    semanticAction('minami-kaze-regulars', [{ kind: 'ready', conditional: 'win-with-participant-majority' }], {
        timings: ['reaction'], planningTags: ['movement-trigger', 'conflict-win', 'ready', 'payoff']
    }),
    semanticAction('higashi-kaze-company', [{ kind: 'resource', cards: 1, conditional: 'win-with-participant-majority' }], {
        timings: ['reaction'], planningTags: ['movement-trigger', 'conflict-win', 'draw', 'payoff']
    }),

    cancel('gossip', 'named-card'),
    status('way-of-the-crane', 'honored', 'self'),
    semanticAction('kakita-blade', [{ kind: 'resource', honor: 1, conditional: 'win-duel' }], {
        timings: ['reaction'], planningTags: ['duel', 'honor', 'payoff']
    }),
    semanticAction('proving-ground', [{ kind: 'deck', draw: 1, conditional: 'duel-resolved' }], {
        timings: ['reaction'], planningTags: ['duel', 'draw', 'payoff']
    }),
    semanticAction('storied-defeat', [{ kind: 'bow', conditional: 'lost-duel' }], {
        timings: ['reaction'], targets: [{ kind: 'character', side: 'opponent' }],
        planningTags: ['duel', 'control', 'payoff']
    }),

    ready('hayaken-no-shiro'),
    ready('in-service-to-my-lord'),
    semanticAction('ujiaki-s-offer', [{ kind: 'conflict', extraOpportunity: 1,
        conditional: 'additional-military-conflict' }], {
        timings: ['conflict-phase'], cost: { fate: 1 }, planningTags: ['lion', 'swarm', 'additional-conflict', 'payoff']
    }),

    mill('deserted-shrine', 10),
    mill('licensed-quarter', 1),
    mill('midnight-prowler', 1),
    semanticAction('master-whisperer', [{ kind: 'deck', mill: 3 }, { kind: 'deck', draw: 3 }], {
        timings: ['conflict-phase'], planningTags: ['mill', 'hand-pressure', 'payoff'], confidence: 0.7
    }),
    semanticAction('city-of-the-open-hand', [{ kind: 'resource', honor: 1,
        conditional: 'while-less-honorable-than-opponent' }], {
        timings: ['conflict-phase'], planningTags: ['dishonor', 'honor-floor', 'protection']
    }),

    semanticAction('kyuden-hida', [{ kind: 'deck', search: 1, conditional: 'holding-engine-dig' }], {
        timings: ['dynasty'], planningTags: ['holding', 'search', 'setup']
    }),
    semanticAction('rebuild', [{ kind: 'attachment', conditional: 'return-holding-from-discard' }], {
        timings: ['dynasty'], planningTags: ['holding', 'recursion', 'payoff'], confidence: 0.7
    }),
    prevention('the-mountain-does-not-fall', 'bow-after-conflict', 1),
    semanticAction('raise-the-alarm', [{ kind: 'skill', military: 4, political: 0,
        conditional: 'defending-character-from-province' }], {
        timings: ['conflict'], planningTags: ['holding', 'defense', 'virtual-participant']
    }),

    semanticAction('isawa-mori-seido', [{ kind: 'skill', military: 0, political: 0,
        conditional: 'modify-glory+2-until-end-of-phase', duration: 'phase' }], {
        timings: ['conflict-phase'], planningTags: ['glory', 'status-payoff', 'setup'], confidence: 0.65
    }),
    ready('against-the-waves', 1),

    semanticAction('high-house-of-light', [
        { kind: 'prevention', event: 'opponent-event-targeting-monk' },
        { kind: 'resource', fate: 1, conditional: 'five-cards-played-ring-fate' }
    ], {
        timings: ['reaction'], planningTags: ['monk', 'cards-played', 'ring', 'payoff'], confidence: 0.75
    }),
    semanticAction('togashi-mitsu-2', [{ kind: 'ring', element: 'void', resolve: true,
        conditional: 'five-cards-played' }], {
        timings: ['conflict'], planningTags: ['monk', 'cards-played', 'ring', 'payoff'],
        limits: [{ key: 'togashi-mitsu-2', scope: 'round', maximum: 1 }], confidence: 0.7
    }),
    semanticAction('teacher-of-empty-thought', [{ kind: 'deck', draw: 1,
        conditional: 'three-cards-played' }], {
        timings: ['conflict'], planningTags: ['monk', 'cards-played', 'draw', 'payoff'],
        limits: [{ key: 'teacher-of-empty-thought', scope: 'round', maximum: 1 }]
    }),
    semanticAction('togashi-ichi', [{ kind: 'province', location: 'province 1', break: true,
        conditional: 'ten-cards-played' }], {
        timings: ['conflict'], planningTags: ['monk', 'cards-played', 'province', 'payoff'], confidence: 0.7
    })
];
