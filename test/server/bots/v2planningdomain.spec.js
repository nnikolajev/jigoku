const PerspectiveSnapshotBuilder = require('../../../build/server/game/bots/v2/PerspectiveSnapshotBuilder.js').default;
const { candidateId } = require('../../../build/server/game/bots/v2/model/Candidate.js');
const { emptyLedgers, recordUsage, resetLedgers } = require('../../../build/server/game/bots/v2/model/Ledgers.js');
const { objectiveRank } = require('../../../build/server/game/bots/v2/model/Intent.js');
const { addUtility, emptyUtility, scalarUtility } = require('../../../build/server/game/bots/v2/model/Utility.js');
const { immutable, stableHash, stableSerialize } = require('../../../build/server/game/bots/v2/model/Stable.js');

describe('V2 planning domain', function() {
    const playerState = (hiddenOpponentId = 'secret-a') => ({
        gameId: 'game-1', roundNumber: 2, phase: 'conflict',
        players: {
            Bot: {
                name: 'Bot', phase: 'conflict', promptTitle: 'Conflict Action Window', menuTitle: 'Initiate an action',
                stats: { fate: 3, honor: 8 }, firstPlayer: true,
                cardPiles: {
                    hand: [{ uuid: 'own-hand', id: 'banzai', type: 'event', cost: 0 }],
                    cardsInPlay: [{
                        uuid: 'own-character', id: 'doji-whisperer', type: 'character', location: 'play area',
                        militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '3' },
                        fate: 1, bowed: false, traits: ['courtier'], attachments: []
                    }], conflictDeck: [{}, {}, {}], dynastyDeck: [{}, {}]
                },
                provinces: {
                    one: [{ uuid: 'own-province', id: 'fertile-fields', type: 'province', location: 'province 1', strengthSummary: { stat: '4' } }],
                    two: [], three: [], four: []
                },
                strongholdProvince: [{ uuid: 'own-stronghold-province', facedown: true, type: 'province', location: 'stronghold province' }]
            },
            Opponent: {
                name: 'Opponent', stats: { fate: 2, honor: 10 },
                cardPiles: {
                    hand: [{ uuid: 'hidden-instance', id: hiddenOpponentId, type: 'event', cost: 2 }],
                    cardsInPlay: [{
                        uuid: 'enemy-character', id: 'bayushi-liar', type: 'character', location: 'play area',
                        militarySkillSummary: { stat: '0' }, politicalSkillSummary: { stat: '2' },
                        fate: 0, bowed: true, attachments: []
                    }], conflictDeck: [{}, {}], dynastyDeck: [{}]
                },
                provinces: {
                    one: [{ uuid: 'enemy-hidden-province', id: 'hidden-province-id', facedown: true, type: 'province', location: 'province 1' }],
                    two: [], three: [], four: []
                },
                strongholdProvince: []
            }
        },
        rings: {
            air: { element: 'air', fate: 1, unselectable: false },
            earth: { element: 'earth', fate: 0, unselectable: true }
        }
    });

    it('serializes and hashes references, intents, candidates, effects, utilities, macros, and ledgers stably', function() {
        const commandPreview = { command: 'cardClicked', args: ['own-hand'], target: 'Banzai!' };
        const reference = { kind: 'card', instanceId: 'own-hand', cardId: 'banzai', controllerId: 'Bot', location: 'hand' };
        const effect = { kind: 'skill', target: { kind: 'character', instanceId: 'own-character', cardId: 'doji-whisperer', controllerId: 'Bot' }, military: 2, political: 2, duration: 'conflict' };
        const macro = {
            id: 'macro:play-banzai', steps: [{ id: 'source', kind: 'source', semanticValue: 'banzai', expected: { promptTitle: 'Conflict Action Window' }, command: 'cardClicked', args: ['own-hand'] }],
            currentStep: 0, abortPolicy: 'fallback-v1', startedAtSignature: 'state-a'
        };
        const intent = {
            id: 'intent:win-conflict', scope: 'conflict', objective: 'WIN_CONFLICT', stateSignature: 'state-a',
            success: [{ kind: 'conflict-margin', operator: 'gt', value: 0 }], failure: [], constraints: [],
            reservations: [{ id: 'reserve-fate', resource: 'fate', amount: 1, hard: true }],
            preferredLines: [], confidence: 0.9, expiresAt: { conflictId: 'conflict-1' }
        };
        const candidate = {
            id: candidateId({ kind: 'conflict-card', source: reference, targets: [effect.target], commandPreview }),
            kind: 'conflict-card', source: reference, targets: [effect.target], commandPreview, macro,
            costs: { cards: 1 }, effects: [effect], prerequisites: [], tags: ['offense'], limits: [],
            uncertainty: 0, confidence: 1, proposer: 'fixture'
        };
        const fixture = {
            refs: { player: { kind: 'player', id: 'Bot' }, card: reference, ring: { kind: 'ring', element: 'earth' } },
            intent, candidate, effect, utility: addUtility(emptyUtility(), { conflictOutcome: 4, fate: -1 }), macro,
            ledgers: emptyLedgers({ gameId: 'game-1', roundId: 'round-2', phaseId: 'conflict', conflictId: 'conflict-1' })
        };
        const reordered = { ...fixture, refs: { ring: fixture.refs.ring, card: fixture.refs.card, player: fixture.refs.player } };
        expect(JSON.parse(stableSerialize(fixture))).toEqual(JSON.parse(stableSerialize(reordered)));
        expect(stableHash(fixture)).toBe(stableHash(reordered));
        expect(candidate.id).toBe(candidateId({ commandPreview, targets: [effect.target], source: reference, kind: 'conflict-card' }));
    });

    it('deep-freezes normalized state and excludes inaccessible hidden identities in fair mode', function() {
        const builder = new PerspectiveSnapshotBuilder();
        const first = builder.build({ playerState: playerState('secret-a'), botName: 'Bot', context: { roundNumber: 2, omniscient: { oppHand: [{ id: 'leak-a' }] } } }, { informationMode: 'fair' });
        const second = builder.build({ playerState: playerState('secret-b'), botName: 'Bot', context: { roundNumber: 2, omniscient: { oppHand: [{ id: 'leak-b' }] } } }, { informationMode: 'fair' });

        expect(first.materialStateSignature).toBe(second.materialStateSignature);
        expect(first.hands.find((hand) => hand.playerId === 'Opponent')).toEqual({ playerId: 'Opponent', size: 1, exact: false, cards: [] });
        expect(first.hands.find((hand) => hand.playerId === 'Bot').cards[0].cardId).toBe('banzai');
        expect(first.provinces.find((province) => province.controllerId === 'Opponent' && province.location === 'province 1').cardId).toBeUndefined();
        expect(first.characters.find((character) => character.instanceId === 'own-character')).toEqual(jasmine.objectContaining({
            military: 1, political: 3, fate: 1, ready: true, traits: ['courtier']
        }));
        expect(Object.isFrozen(first)).toBeTrue();
        expect(Object.isFrozen(first.characters)).toBeTrue();
    });

    it('resets conflict, phase, and round ledger scopes explicitly', function() {
        const scope = { gameId: 'g', roundId: 'r1', phaseId: 'p1', conflictId: 'c1' };
        let ledgers = emptyLedgers(scope);
        ledgers = recordUsage(ledgers, { key: 'conflict-action', scope: 'conflict', scopeId: 'c1', count: 1, targetIds: [] });
        ledgers = recordUsage(ledgers, { key: 'phase-action', scope: 'phase', scopeId: 'p1', count: 1, targetIds: [] });
        ledgers = recordUsage(ledgers, { key: 'round-action', scope: 'round', scopeId: 'r1', count: 1, targetIds: [] });
        ledgers = recordUsage(ledgers, { key: 'game-action', scope: 'game', scopeId: 'g', count: 1, targetIds: [] });

        const nextConflict = resetLedgers(ledgers, { ...scope, conflictId: 'c2' });
        expect(nextConflict.usage.map((entry) => entry.key)).toEqual(['phase-action', 'round-action', 'game-action']);
        const nextPhase = resetLedgers(nextConflict, { ...scope, phaseId: 'p2', conflictId: undefined });
        expect(nextPhase.usage.map((entry) => entry.key)).toEqual(['round-action', 'game-action']);
        const nextRound = resetLedgers(nextPhase, { gameId: 'g', roundId: 'r2', phaseId: 'p1' });
        expect(nextRound.usage.map((entry) => entry.key)).toEqual(['game-action']);
    });

    it('keeps terminal objectives lexicographic and utility components decomposed', function() {
        expect(objectiveRank('WIN_GAME')).toBeLessThan(objectiveRank('PREVENT_GAME_LOSS'));
        expect(objectiveRank('PREVENT_GAME_LOSS')).toBeLessThan(objectiveRank('BUILD_BOARD'));
        const utility = addUtility(emptyUtility(), { terminal: 1000, fate: -4, waste: -2 });
        expect(scalarUtility(utility, { terminal: 1, fate: 2, waste: 1 })).toBe(990);
        expect(Object.keys(utility)).toContain('conflictDeckSafety');
    });

    it('provides immutable helpers for all domain fixtures', function() {
        const value = immutable({ b: [{ z: 2 }], a: 1 });
        expect(Object.isFrozen(value)).toBeTrue();
        expect(Object.isFrozen(value.b[0])).toBeTrue();
        expect(stableSerialize(value)).toBe('{"a":1,"b":[{"z":2}]}');
    });
});
