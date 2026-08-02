const ParticipantSetPlanner = require('../../../build/server/game/bots/v2/allocation/ParticipantSetPlanner.js').default;

describe('V2 complete participant-set planner', function() {
    function character(instanceId, military, options = {}) {
        return {
            instanceId, cardId: options.cardId ?? instanceId, controllerId: 'Bot', location: 'play area',
            military, political: options.political ?? 0, glory: 0, fate: options.fate ?? 0,
            honored: false, dishonored: false, bowed: false, ready: true,
            participating: false, attacking: false, defending: false, traits: [], unique: false,
            attachments: options.attachments || [], canMove: false, canReady: options.canReady ?? false,
            noBowAfterConflict: options.noBowAfterConflict ?? false,
            canAttackMilitary: true, canAttackPolitical: true, covert: false, attackRestrictions: []
        };
    }

    function state(characters, overrides = {}) {
        return {
            perspectivePlayerId: 'Bot', phase: 'conflict',
            scopes: { gameId: 'game', roundId: 'round', phaseId: 'conflict', conflictId: 'conflict-1' },
            materialStateSignature: 'state-1', characters,
            conflict: {
                id: 'conflict-1', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
                attackerSkill: 7, defenderSkill: 0, breakThreshold: 4,
                provinceStrength: 4, provinceLocation: 'province 1', ...overrides
            }
        };
    }

    function defender(character) {
        return {
            id: `defender:${character.instanceId}`, kind: 'defender-set',
            targets: [{ kind: 'character', instanceId: character.instanceId, cardId: character.cardId, controllerId: 'Bot' }],
            commandPreview: { command: 'cardClicked', args: [character.instanceId], target: character.cardId },
            costs: {}, effects: [], prerequisites: [], tags: ['defense'], limits: [],
            uncertainty: 0, confidence: 0.98, proposer: 'fixture'
        };
    }

    function done() {
        return {
            id: 'done', kind: 'pass', targets: [],
            commandPreview: { command: 'menuButton', args: ['done', 'done-button'], target: 'Done' },
            costs: {}, effects: [], prerequisites: [], tags: [], limits: [],
            uncertainty: 0, confidence: 1, proposer: 'fixture'
        };
    }

    function v1Fallback(character, mode = 'fixture-v1-defender') {
        return {
            id: `v1:${character.instanceId}`, kind: 'v1-fallback', mode, targets: [],
            commandPreview: { command: 'cardClicked', args: [character.instanceId], target: character.cardId },
            costs: {}, effects: [], prerequisites: [], tags: ['fallback'], limits: [],
            uncertainty: 0.5, confidence: 0.5, proposer: 'v1-fallback'
        };
    }

    it('uses a complete Done-only macro when the attack cannot break', function() {
        const chars = [character('tower', 8, { fate: 2 })];
        const candidates = new ParticipantSetPlanner().expand(state(chars, { attackerSkill: 3 }), [defender(chars[0]), done()]);
        const set = candidates.find((candidate) => candidate.kind === 'defender-set');

        expect(set.proposer).toBe('participant-set-planner');
        expect(set.targets).toEqual([]);
        expect(set.effects).toEqual([]);
        expect(set.macro.steps).toEqual([jasmine.objectContaining({
            kind: 'confirmation', semanticValue: 'Done', command: 'menuButton', args: ['done', 'done-button']
        })]);
    });

    it('selects the cheapest sufficient subset and emits every click followed by Done', function() {
        const chars = [
            character('expensive', 6, { fate: 3 }),
            character('cheap-two', 2, { noBowAfterConflict: true }),
            character('cheap-four', 4)
        ];
        const candidates = new ParticipantSetPlanner().expand(state(chars), [...chars.map(defender), done()]);
        const set = candidates.find((candidate) => candidate.kind === 'defender-set');

        expect(set.targets.map((target) => target.instanceId)).toEqual(['cheap-four']);
        expect(set.effects).toEqual([jasmine.objectContaining({
            kind: 'move', destination: 'conflict', target: jasmine.objectContaining({ instanceId: 'cheap-four' })
        })]);
        expect(set.macro.steps.map((step) => [step.command, step.args])).toEqual([
            ['cardClicked', ['cheap-four']],
            ['menuButton', ['done', 'done-button']]
        ]);
    });

    it('accepts injectable persistent-engine value when choosing a minimum defense', function() {
        const chars = [
            character('valuable-low-surplus', 3, {
                political: 5, fate: 1, attachments: [{ instanceId: 'kimono', cardId: 'magnificent-kimono' }]
            }),
            character('cheaper-high-surplus', 4, { political: 4, fate: 2 })
        ];
        const set = new ParticipantSetPlanner().expand(state(chars, { attackerSkill: 5 }),
            [...chars.map(defender), done()], { futureValueBonuses: { 'valuable-low-surplus': 4 } })
            .find((candidate) => candidate.kind === 'defender-set');

        expect(set.mode).toBe('prevent-break:2:0:4');
        expect(set.targets.map((target) => target.instanceId)).toEqual(['cheaper-high-surplus']);
    });

    it('offers a separate minimum set that wins the conflict when raw skill can do so', function() {
        const chars = [character('break-only', 4), character('exact-win', 8), character('wasteful', 12, { fate: 3 })];
        const sets = new ParticipantSetPlanner().expand(state(chars), [...chars.map(defender), done()])
            .filter((candidate) => candidate.kind === 'defender-set');
        const win = sets.find((candidate) => candidate.mode.startsWith('win-conflict:'));

        expect(sets.length).toBe(2);
        expect(win.targets.map((target) => target.instanceId)).toEqual(['exact-win']);
        expect(win.prerequisites).toContain(jasmine.objectContaining({ id: 'exact-conflict-win', satisfied: true }));
    });

    it('offers a single conflict-winning defender when it costs no more future board than V1 choice', function() {
        const v1Choice = character('v1-expiring-four', 4, { fate: 2 });
        const ringDenier = character('ring-denier', 8);
        const candidates = new ParticipantSetPlanner().expand(
            state([v1Choice, ringDenier]),
            [defender(v1Choice), defender(ringDenier), done(), v1Fallback(v1Choice)],
            { includeConflictWin: false, includeCostNeutralConflictWin: true }
        );
        const win = candidates.find((candidate) => candidate.kind === 'defender-set' &&
            candidate.mode.startsWith('win-conflict:'));

        expect(win.mode).toBe('win-conflict:8:0:8');
        expect(win.targets.map((target) => target.instanceId)).toEqual(['ring-denier']);
    });

    it('does not spend a more valuable single defender merely to win an ordinary conflict', function() {
        const v1Choice = character('v1-cheap-four', 4);
        const expensiveWinner = character('expensive-winner', 8, { fate: 2 });
        const candidates = new ParticipantSetPlanner().expand(
            state([v1Choice, expensiveWinner]),
            [defender(v1Choice), defender(expensiveWinner), done(), v1Fallback(v1Choice)],
            { includeConflictWin: false, includeCostNeutralConflictWin: true }
        );

        expect(candidates.some((candidate) => candidate.kind === 'defender-set' &&
            candidate.mode.startsWith('win-conflict:'))).toBeFalse();
    });

    it('does not combine several bodies for the cost-neutral conflict-win exception', function() {
        const v1Choice = character('v1-expiring-two', 2, { fate: 3 });
        const first = character('first-three', 3);
        const second = character('second-three', 3);
        const candidates = new ParticipantSetPlanner().expand(
            state([v1Choice, first, second], { attackerSkill: 5 }),
            [defender(v1Choice), defender(first), defender(second), done(), v1Fallback(v1Choice)],
            { includeConflictWin: false, includeCostNeutralConflictWin: true }
        );

        expect(candidates.some((candidate) => candidate.kind === 'defender-set' &&
            candidate.mode.startsWith('win-conflict:'))).toBeFalse();
    });

    it('does not turn a small break defense into a broad multi-body win overcommit', function() {
        const chars = [
            character('break', 4), character('one', 2), character('two', 2),
            character('three', 2), character('four', 2)
        ];
        const sets = new ParticipantSetPlanner().expand(state(chars), [...chars.map(defender), done()])
            .filter((candidate) => candidate.kind === 'defender-set');

        expect(sets.map((candidate) => candidate.mode)).toEqual(['prevent-break:4:0:4']);
    });

    it('adds one bounded response reserve when the opponent has hidden cards', function() {
        const chars = [character('exact-now', 4), character('buffered', 6)];
        const projected = state(chars);
        projected.players = { Bot: { id: 'Bot' }, Opponent: { id: 'Opponent' } };
        projected.hands = [
            { playerId: 'Bot', size: 0, cards: [], exact: true },
            { playerId: 'Opponent', size: 3, cards: [], exact: false }
        ];
        const set = new ParticipantSetPlanner().expand(projected, [...chars.map(defender), done()], {
            responseReserve: { ordinary: 2 }
        })
            .find((candidate) => candidate.kind === 'defender-set');

        expect(set.mode).toBe('prevent-break:4:2:6');
        expect(set.targets.map((target) => target.instanceId)).toEqual(['buffered']);
    });

    it('uses the stricter bounded reserve at an exposed stronghold', function() {
        const chars = [character('ordinary-buffer', 6), character('stronghold-buffer', 7)];
        const projected = state(chars, { provinceLocation: 'stronghold province' });
        projected.players = { Bot: { id: 'Bot' }, Opponent: { id: 'Opponent' } };
        projected.hands = [
            { playerId: 'Bot', size: 0, cards: [], exact: true },
            { playerId: 'Opponent', size: 1, cards: [], exact: false }
        ];
        const set = new ParticipantSetPlanner().expand(projected, [...chars.map(defender), done()])
            .find((candidate) => candidate.kind === 'defender-set');

        expect(set.mode).toBe('prevent-break:4:3:7');
        expect(set.targets.map((target) => target.instanceId)).toEqual(['stronghold-buffer']);
    });

    it('leaves impossible raw defenses on V1 for later pump and reaction planning', function() {
        const chars = [character('one', 2), character('two', 2)];
        const original = [...chars.map(defender), done()];
        const candidates = new ParticipantSetPlanner().expand(state(chars, { attackerSkill: 12 }), original);

        expect(candidates).toBe(original);
    });

    it('orders the exact set deterministically regardless of serialized card order', function() {
        const chars = [character('alpha', 2, { noBowAfterConflict: true }), character('beta', 2, { noBowAfterConflict: true })];
        const planner = new ParticipantSetPlanner();
        const first = planner.expand(state(chars, { attackerSkill: 5 }), [...chars.map(defender), done()])
            .find((candidate) => candidate.kind === 'defender-set');
        const second = planner.expand(state([...chars].reverse(), { attackerSkill: 5 }),
            [...chars].reverse().map(defender).concat(done()))
            .find((candidate) => candidate.kind === 'defender-set');

        expect(second.id).toBe(first.id);
        expect(second.targets).toEqual(first.targets);
        expect(second.macro.steps).toEqual(first.macro.steps);
    });

    it('breaks equal-value defender ties by card identity before runtime UUID', function() {
        const planner = new ParticipantSetPlanner();
        const selectedCardId = (prefix, alphaInstance, betaInstance) => {
            const chars = [
                character(`${prefix}-${alphaInstance}`, 2, { cardId: 'alpha-defender' }),
                character(`${prefix}-${betaInstance}`, 2, { cardId: 'beta-defender' })
            ];
            return planner.expand(state(chars, { attackerSkill: 5 }), [...chars.map(defender), done()])
                .find((candidate) => candidate.kind === 'defender-set').targets[0].cardId;
        };

        expect(selectedCardId('one', 'z-runtime', 'a-runtime')).toBe('alpha-defender');
        expect(selectedCardId('two', 'a-runtime', 'z-runtime')).toBe('alpha-defender');
    });
});
