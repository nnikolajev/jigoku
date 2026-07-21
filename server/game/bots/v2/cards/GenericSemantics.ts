import type {
    CardSemanticModel,
    CostSemantic,
    SemanticTiming,
    StackingRule,
    SynergyEdge,
    TargetSemantic
} from './CardSemantics';
import { boundedDynamicEvaluator } from './CardSemantics';
import type { EffectDescriptor } from '../model/Effects';
import type { RingElement } from '../model/References';

export function semanticAction(cardId: string, effects: readonly EffectDescriptor[], options: {
    timings?: readonly SemanticTiming[];
    targets?: readonly TargetSemantic[];
    cost?: CostSemantic;
    stackingKey?: string;
    confidence?: number;
    condition?: string;
    delayed?: boolean;
    limits?: CardSemanticModel['actions'][number]['limits'];
    stacking?: readonly StackingRule[];
    synergies?: readonly SynergyEdge[];
    planningTags?: readonly string[];
} = {}): CardSemanticModel {
    const confidence = options.confidence ?? 0.9;
    return {
        cardId,
        actions: [{
            id: `${cardId}:primary`, timings: options.timings || ['conflict'], targets: options.targets || [],
            cost: options.cost || {}, effects, stackingKey: options.stackingKey, limits: options.limits || [],
            confidence, condition: options.condition, delayed: options.delayed
        }],
        stacking: options.stacking,
        synergies: options.synergies,
        planningTags: options.planningTags,
        source: 'v2-curated', confidence
    };
}

const ownCharacter: TargetSemantic = { kind: 'character', side: 'self' };
const enemyCharacter: TargetSemantic = { kind: 'character', side: 'opponent' };

export const skill = (cardId: string, military: number, political: number, cost = 0) =>
    semanticAction(cardId, [{ kind: 'skill', military, political, duration: 'conflict' }], { targets: [ownCharacter], cost: { fate: cost }, planningTags: ['skill'] });
export const bow = (cardId: string, cost = 0) => semanticAction(cardId, [{ kind: 'bow' }], { targets: [enemyCharacter], cost: { fate: cost }, planningTags: ['control'] });
export const ready = (cardId: string, cost = 0) => semanticAction(cardId, [{ kind: 'ready' }], { targets: [ownCharacter], cost: { fate: cost }, planningTags: ['ready'] });
export const movement = (cardId: string, destination: 'conflict' | 'home', cost = 0) =>
    semanticAction(cardId, [{ kind: 'move', destination }], { targets: [ownCharacter], cost: { fate: cost }, planningTags: ['movement'] });
export const status = (cardId: string, value: 'honored' | 'dishonored', side: 'self' | 'opponent', cost = 0) =>
    semanticAction(cardId, [{ kind: 'status', status: value }], { targets: [{ kind: 'character', side }], cost: { fate: cost }, planningTags: [value] });
export const removal = (cardId: string, method: 'discard' | 'sacrifice' | 'return' | 'remove-from-game', cost = 0) =>
    semanticAction(cardId, [{ kind: 'remove', method }], { targets: [enemyCharacter], cost: { fate: cost }, planningTags: ['removal'] });
export const resource = (cardId: string, fate: number, cards: number, honor: number, cost = 0) =>
    semanticAction(cardId, [{ kind: 'resource', fate, cards, honor }, ...(cards > 0 ? [{ kind: 'deck' as const, draw: cards }] : [])], { cost: { fate: cost }, planningTags: ['resource'] });
export const draw = (cardId: string, amount: number, cost = 0) =>
    semanticAction(cardId, [{ kind: 'deck', draw: amount }], { cost: { fate: cost }, planningTags: ['draw'] });
export const mill = (cardId: string, amount: number, side: 'self' | 'opponent' = 'opponent', cost = 0) =>
    semanticAction(cardId, [{ kind: 'deck', mill: amount, target: { kind: 'player', id: side } }], { cost: { fate: cost }, planningTags: ['mill'] });
export const search = (cardId: string, amount: number, cost = 0) =>
    semanticAction(cardId, [{ kind: 'deck', search: amount }], { cost: { fate: cost }, planningTags: ['search'] });
export const attachment = (cardId: string, military: number, political: number, cost = 0, nonStackingKey?: string) =>
    semanticAction(cardId, [{ kind: 'attachment', cardId, nonStackingKey }, { kind: 'skill', military, political, duration: 'while-attached' }], {
        targets: [ownCharacter], cost: { fate: cost }, stackingKey: nonStackingKey,
        stacking: nonStackingKey ? [{ key: nonStackingKey, maximumUsefulCopies: 1, perTarget: true }] : undefined,
        planningTags: ['attachment']
    });
export const prevention = (cardId: string, event: string, cost = 0) =>
    semanticAction(cardId, [{ kind: 'prevention', event }], { cost: { fate: cost }, timings: ['interrupt'], planningTags: ['protection'] });
export const cancel = (cardId: string, event = 'opponent-event', cost = 0) =>
    semanticAction(cardId, [{ kind: 'cancel', event }], { cost: { fate: cost }, timings: ['interrupt'], planningTags: ['cancel'] });
export const ring = (cardId: string, element: RingElement, resolve = true, cost = 0) =>
    semanticAction(cardId, [{ kind: 'ring', element, claim: true, resolve }], { targets: [{ kind: 'ring', side: 'none' }], cost: { fate: cost }, planningTags: ['ring'] });
export const province = (cardId: string, strength: number) =>
    semanticAction(cardId, [{ kind: 'province', location: 'province 1', strength }], { timings: ['any'], targets: [{ kind: 'province', side: 'self' }], planningTags: ['province'] });
export const duel = (cardId: string, duelType: string, swing: number, cost = 0) =>
    semanticAction(cardId, [{ kind: 'duel', duelType, skillDelta: swing }], { targets: [enemyCharacter], cost: { fate: cost }, planningTags: ['duel'] });
export const reducer = (cardId: string, amount: number, appliesTo?: string) =>
    semanticAction(cardId, [{ kind: 'reduction', amount, costType: 'fate', appliesTo }], { timings: ['any'], planningTags: ['reducer'] });

function displayOfPowerSemantic(): CardSemanticModel {
    const model = semanticAction('display-of-power', [], {
        timings: ['reaction'], cost: { fate: 2 }, delayed: true,
        limits: [{ key: 'display-of-power', scope: 'conflict', maximum: 1 }],
        planningTags: ['ring', 'delayed'],
        synergies: [{ id: 'display-of-power:ring-payoff', role: 'payoff', withTags: ['ring'], scoreDelta: 4 }]
    });
    return {
        ...model,
        actions: [{
            ...model.actions[0],
            dynamicEvaluator: boundedDynamicEvaluator('display-of-power:ring', (state) => ({
                effects: state.conflict?.ring
                    ? [{ kind: 'ring', element: state.conflict.ring, claim: true, resolve: true, duration: 'delayed' }]
                    : [],
                confidence: state.conflict?.ring ? 0.95 : 0.3,
                notes: state.conflict?.ring ? ['uses-current-conflict-ring'] : ['unknown-conflict-ring']
            })),
            confidence: 0.95
        }],
        confidence: 0.95
    };
}

export const REPRESENTATIVE_SEMANTICS: readonly CardSemanticModel[] = [
    semanticAction('banzai', [{ kind: 'skill', military: 2, political: 0, duration: 'conflict' }], {
        targets: [{ ...ownCharacter, participating: true }],
        timings: ['conflict'],
        limits: [{ key: 'banzai', scope: 'conflict', maximum: 1 }],
        planningTags: ['skill', 'payoff'],
        synergies: [{ id: 'banzai:military-payoff', role: 'payoff', withTags: ['military'], scoreDelta: 2 }]
    }),
    attachment('fine-katana', 2, 0, 0),
    attachment('ornate-fan', 0, 2, 0),
    {
        ...movement('ride-on', 'conflict'),
        actions: [
            movement('ride-on', 'conflict').actions[0],
            { ...movement('ride-on', 'home').actions[0], id: 'ride-on:home' }
        ],
        targetRules: [{ ...ownCharacter, traits: ['cavalry'] }],
        synergies: [{ id: 'ride-on:movement-trigger', role: 'enabler', withTags: ['movement-trigger'], scoreDelta: 2 }]
    },
    ready('i-am-ready'),
    status('way-of-the-crane', 'honored', 'self'),
    {
        ...status('court-games', 'honored', 'self'),
        actions: [
            { ...status('court-games', 'honored', 'self').actions[0], id: 'court-games:honor', timings: ['conflict'], targets: [{ ...ownCharacter, participating: true }] },
            { ...status('court-games', 'dishonored', 'opponent').actions[0], id: 'court-games:dishonor', timings: ['conflict'], targets: [{ ...enemyCharacter, participating: true }] }
        ]
    },
    semanticAction('assassination', [{ kind: 'remove', method: 'discard', conditional: 'printed-cost<=2' }], {
        timings: ['conflict'], targets: [{ kind: 'character', side: 'either' }], cost: { honor: 3 }, planningTags: ['removal']
    }),
    semanticAction('let-go', [{ kind: 'remove', method: 'discard', conditional: 'attachment' }], {
        timings: ['conflict-phase'], targets: [{ kind: 'attachment', side: 'either' }], planningTags: ['removal']
    }),
    {
        ...cancel('voice-of-honor'),
        actions: [{ ...cancel('voice-of-honor').actions[0], condition: 'more-honored-characters-than-opponent' }],
        synergies: [{ id: 'voice-of-honor:honor-setup', role: 'payoff', withTags: ['honored'], scoreDelta: 3 }]
    },
    {
        ...prevention('clarity-of-purpose', 'bow-after-conflict', 1),
        actions: [{ ...prevention('clarity-of-purpose', 'bow-after-conflict', 1).actions[0], delayed: true }]
    },
    displayOfPowerSemantic(),
    duel('game-of-sadane', 'political', 3, 1),
    resource('oracle-of-stone', 0, 2, 0),
    reducer('iron-mountain-castle', 1, 'attachment')
];
