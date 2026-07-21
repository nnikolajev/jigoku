const CardSemanticRegistry = require('../../../build/server/game/bots/v2/cards/CardSemantics.js').default;
const { boundedDynamicEvaluator } = require('../../../build/server/game/bots/v2/cards/CardSemantics.js');
const {
    REPRESENTATIVE_SEMANTICS,
    attachment,
    bow,
    draw,
    duel,
    mill,
    movement,
    prevention,
    province,
    ready,
    reducer,
    removal,
    ring,
    search,
    semanticAction,
    skill,
    status
} = require('../../../build/server/game/bots/v2/cards/GenericSemantics.js');

describe('V2 card semantics', function() {
    const state = Object.freeze({
        perspectivePlayerId: 'Bot',
        conflict: { ring: 'earth' }
    });
    const candidate = (cardId, mode, target) => Object.freeze({
        id: `candidate:${cardId}:${mode || 'primary'}`,
        kind: 'conflict-card',
        source: { kind: 'card', instanceId: `instance:${cardId}`, cardId, controllerId: 'Bot', location: 'hand' },
        mode,
        targets: target ? [target] : [],
        commandPreview: { command: 'cardClicked', args: [`instance:${cardId}`], target: cardId },
        costs: { cards: 1 }, effects: [], prerequisites: [], tags: [], limits: [],
        uncertainty: 0.1, confidence: 1, proposer: 'fixture'
    });

    it('composes every common effect family from typed factories', function() {
        const models = [
            skill('skill', 2, 1), bow('bow'), ready('ready'), movement('move', 'home'),
            status('status', 'honored', 'self'), removal('discard', 'discard'), removal('sacrifice', 'sacrifice'),
            draw('draw', 2), mill('mill', 3), search('search', 5), attachment('attachment', 2, 0),
            prevention('prevent', 'bow'), ring('ring', 'void'), province('province', 5), duel('duel', 'military', 3),
            reducer('reducer', 1, 'attachment')
        ];
        const kinds = models.flatMap((model) => model.actions.flatMap((action) => action.effects.map((effect) => effect.kind)));
        expect(new Set(kinds)).toEqual(new Set([
            'skill', 'bow', 'ready', 'move', 'status', 'remove', 'deck', 'attachment',
            'prevention', 'ring', 'province', 'duel', 'reduction'
        ]));
        const composite = semanticAction('bow-and-send-home', [{ kind: 'bow' }, { kind: 'move', destination: 'home' }]);
        expect(composite.actions[0].effects.map((effect) => effect.kind)).toEqual(['bow', 'move']);
    });

    it('adapts existing V1 analysis conservatively and reports explicit fallback coverage', function() {
        const registry = new CardSemanticRegistry();
        expect(registry.get('fine-katana')).toEqual(jasmine.objectContaining({ cardId: 'fine-katana', source: 'deck-analysis', confidence: 0.45 }));
        expect(registry.coverage(['fine-katana', 'unmodeled-card'])).toEqual([
            jasmine.objectContaining({ cardId: 'fine-katana', status: 'low-confidence', v1Fallback: true }),
            { cardId: 'unmodeled-card', status: 'unknown', confidence: 0, source: undefined, v1Fallback: true }
        ]);
    });

    it('enriches candidates with immutable effects, costs, limits, stacking, and provenance', function() {
        const registry = new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS);
        const original = candidate('assassination', undefined, { kind: 'character', instanceId: 'victim', controllerId: 'Opponent' });
        const enriched = registry.enrich(state, original);
        expect(enriched).not.toBe(original);
        expect(enriched.costs).toEqual({ cards: 1, honor: 3 });
        expect(enriched.effects).toEqual([jasmine.objectContaining({ kind: 'remove', method: 'discard', target: original.targets[0] })]);
        expect(enriched.annotations[0].proposer).toBe('semantics:v2-curated');
        expect(Object.isFrozen(enriched)).toBeTrue();
        expect(original.effects).toEqual([]);
        expect(registry.get('fine-katana').stacking).toBeUndefined();
    });

    it('selects semantic modes and binds their effects to semantic targets', function() {
        const registry = new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS);
        const target = { kind: 'character', instanceId: 'enemy', controllerId: 'Opponent' };
        const projection = registry.project('court-games', state, candidate('court-games', 'Dishonor an opposing character', target));
        expect(projection.actionId).toBe('court-games:dishonor');
        expect(projection.effects).toEqual([jasmine.objectContaining({ kind: 'status', status: 'dishonored', target })]);
        expect(registry.get('court-games').actions.every((action) => action.timings.includes('conflict'))).toBeTrue();
    });

    it('bounds dynamic projections and carries their confidence without commands', function() {
        const evaluator = boundedDynamicEvaluator('fixture', () => ({
            effects: [{ kind: 'bow' }, { kind: 'ready' }, { kind: 'move', destination: 'home' }],
            confidence: 7,
            notes: []
        }), 2);
        const result = evaluator.evaluate(state, candidate('fixture'));
        expect(result.effects.map((effect) => effect.kind)).toEqual(['bow', 'ready']);
        expect(result.confidence).toBe(1);
        expect(result.notes).toContain('effect-bound:2');
        expect(result.command).toBeUndefined();

        const registry = new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS);
        const display = registry.project('display-of-power', state, candidate('display-of-power'));
        expect(display).toEqual(jasmine.objectContaining({ confidence: 0.95 }));
        expect(display.effects).toEqual([jasmine.objectContaining({ kind: 'ring', element: 'earth', claim: true, resolve: true })]);
    });
});
