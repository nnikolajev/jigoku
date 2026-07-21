const IntentManager = require('../../../build/server/game/bots/v2/IntentManager.js').default;
const PerspectiveSnapshotBuilder = require('../../../build/server/game/bots/v2/PerspectiveSnapshotBuilder.js').default;

describe('V2 intent management', function() {
    const builder = new PerspectiveSnapshotBuilder();
    function state(overrides = {}) {
        const phase = overrides.phase || 'conflict';
        const promptTitle = overrides.promptTitle || 'Conflict Action Window';
        const conflict = overrides.conflict;
        return builder.build({
            botName: 'Bot',
            context: { roundNumber: overrides.round || 1, phaseId: overrides.phaseId || phase, conflictId: conflict?.id },
            playerState: {
                roundNumber: overrides.round || 1,
                phase,
                conflict,
                players: {
                    Bot: {
                        name: 'Bot', phase, promptTitle, menuTitle: overrides.menuTitle || 'Initiate an action',
                        stats: { fate: overrides.fate ?? 3, honor: overrides.honor ?? 8 },
                        cardPiles: {
                            hand: overrides.hand || [], conflictDeck: new Array(overrides.deckSize ?? 10).fill({}),
                            cardsInPlay: [{ uuid: 'guard', id: 'guard', type: 'character', location: 'play area', military: 3, political: 2, fate: 1 }]
                        },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [{ uuid: 'own-sh', type: 'province', location: 'stronghold province', inConflict: overrides.strongholdInConflict === true, strength: 5 }]
                    },
                    Opponent: {
                        name: 'Opponent', stats: { fate: 2, honor: overrides.opponentHonor ?? 10 },
                        cardPiles: { hand: [], conflictDeck: new Array(10).fill({}), cardsInPlay: [] },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [{ uuid: 'enemy-sh', type: 'province', location: 'stronghold province', strength: 5 }]
                    }
                },
                rings: {}
            }
        }, { informationMode: 'fair' });
    }

    it('persists the same objective while refreshing reservations after material changes', function() {
        const manager = new IntentManager();
        const first = manager.update(state(), { fateReserve: 2, strongholdDefenderCount: 1 });
        const same = manager.update(state(), { fateReserve: 2, strongholdDefenderCount: 1 });
        const changed = manager.update(state({ fate: 2 }), { fateReserve: 1, strongholdDefenderCount: 1 });

        expect(first.intent.objective).toBe('CLAIM_RING');
        expect(same.retained).toBeTrue();
        expect(same.invalidationReason).toBeUndefined();
        expect(changed.retained).toBeTrue();
        expect(changed.invalidationReason).toBe('material-state-change');
        expect(changed.intent.reservations.map((entry) => entry.resource)).toEqual(['fate', 'defender']);
    });

    it('promotes terminal defense above ordinary value after opponent disruption', function() {
        const manager = new IntentManager();
        manager.update(state());
        const conflict = {
            id: 'conflict-stronghold', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
            provinceLocation: 'stronghold province', attackerSkill: 8, defenderSkill: 2, provinceStrength: 5, breakThreshold: 5
        };
        const disrupted = manager.update(state({ conflict, strongholdInConflict: true }));
        expect(disrupted.intent.objective).toBe('SURVIVE_STRONGHOLD');
        expect(disrupted.retained).toBeFalse();
        expect(disrupted.invalidationReason).toBe('opponent-disruption');
        expect(disrupted.intent.reservations.find((entry) => entry.resource === 'defender').hard).toBeTrue();
    });

    it('keeps macro intent through source, mode, target, cost, and confirmation prompts', function() {
        const manager = new IntentManager();
        const initial = state({ promptTitle: 'Conflict Action Window' });
        const intent = manager.update(initial).intent;
        const macro = {
            id: 'macro:test', intentId: intent.id, currentStep: 0, abortPolicy: 'fallback-v1',
            startedAtSignature: initial.materialStateSignature,
            steps: [
                { id: 'source', kind: 'source', semanticValue: 'card', expected: { promptTitle: 'Conflict Action Window' } },
                { id: 'mode', kind: 'mode', semanticValue: 'ready', expected: { promptTitle: 'Choose a mode' } },
                { id: 'target', kind: 'target', semanticValue: 'guard', expected: { promptTitle: 'Choose a target' } },
                { id: 'cost', kind: 'cost', semanticValue: 'pay', expected: { promptTitle: 'Pay costs' } },
                { id: 'confirm', kind: 'confirmation', semanticValue: 'yes', expected: { promptTitle: 'Are you sure?' } }
            ]
        };
        manager.setMacro(macro);
        for(const [stepId, promptTitle] of [
            ['source', 'Conflict Action Window'], ['mode', 'Choose a mode'], ['target', 'Choose a target'],
            ['cost', 'Pay costs'], ['confirm', 'Are you sure?']
        ]) {
            const transition = manager.update(state({ promptTitle }));
            expect(transition.intent.id).toBe(intent.id);
            expect(transition.retained).toBeTrue();
            expect(transition.macro.step.id).toBe(stepId);
            manager.completeMacroStep(stepId);
        }
        expect(manager.activeIntent.id).toBe(intent.id);
    });

    it('expires intents on phase transitions and invalidates rejected or mismatched macros', function() {
        const phaseManager = new IntentManager();
        phaseManager.update(state({ phase: 'dynasty', phaseId: 'dynasty' }));
        const expired = phaseManager.update(state({ phase: 'conflict', phaseId: 'conflict' }));
        expect(expired.retained).toBeFalse();
        expect(expired.invalidationReason).toBe('phase-expired');

        const macroManager = new IntentManager();
        const initial = state();
        macroManager.update(initial);
        macroManager.setMacro({
            id: 'macro:mismatch', currentStep: 0, abortPolicy: 'fallback-v1', startedAtSignature: initial.materialStateSignature,
            steps: [{ id: 'target', kind: 'target', semanticValue: 'guard', expected: { promptTitle: 'Choose a target' } }]
        });
        const mismatch = macroManager.update(state({ promptTitle: 'Different prompt' }));
        expect(mismatch.retained).toBeFalse();
        expect(mismatch.invalidationReason).toBe('macro-mismatch');
        expect(macroManager.invalidate('command-rejected')).toBe('command-rejected');
        expect(macroManager.activeIntent).toBeUndefined();
    });
});
