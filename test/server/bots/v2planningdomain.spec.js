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
            military: 1, political: 3, fate: 1, ready: true, traits: ['courtier'],
            canMove: false, canReady: false
        }));
        const explicitState = playerState();
        explicitState.players.Bot.cardPiles.cardsInPlay[0].canMove = true;
        explicitState.players.Bot.cardPiles.cardsInPlay[0].canReady = true;
        const explicit = builder.build({ playerState: explicitState, botName: 'Bot', context: { roundNumber: 2 } },
            { informationMode: 'fair' });
        expect(explicit.characters.find((character) => character.instanceId === 'own-character')).toEqual(
            jasmine.objectContaining({ canMove: true, canReady: true }));
        expect(Object.isFrozen(first)).toBeTrue();
        expect(Object.isFrozen(first.characters)).toBeTrue();
    });

    it('does not turn an empty serialized conflict shell into a live tactical position', function() {
        const builder = new PerspectiveSnapshotBuilder();
        const shell = { ...playerState(), conflict: {
            id: 'conflict', attackerSkill: 0, defenderSkill: 0, provinceStrength: 0, breakThreshold: 0
        } };
        const inactive = builder.build({ playerState: shell, botName: 'Bot', context: { roundNumber: 2 } }, {
            informationMode: 'fair', conflictId: 'conflict'
        });
        const live = playerState();
        live.players.Bot.id = 'bot-id';
        live.players.Opponent.id = 'opponent-id';
        live.players.Opponent.provinces.one[0].inConflict = true;
        const active = builder.build({ playerState: { ...live, conflict: {
            id: 'conflict', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
            type: 'military', elements: ['fire'], attackerSkill: 3, defenderSkill: 2
        } }, botName: 'Bot', context: { roundNumber: 2 } }, { informationMode: 'fair' });

        expect(inactive.conflict).toBeUndefined();
        expect(inactive.scopes.conflictId).toBeUndefined();
        expect(active.conflict).toEqual(jasmine.objectContaining({
            attackerId: 'Bot', defenderId: 'Opponent', provinceLocation: 'province 1',
            ring: 'fire', attackerSkill: 3, defenderSkill: 2, provinceStrength: 4,
            breakThreshold: 4
        }));
    });

    it('merges exact public controller participant identities into the immutable snapshot', function() {
        const state = playerState();
        state.conflict = {
            id: 'c1', attackerId: 'Bot', defenderId: 'Opponent', type: 'military',
            provinceLocation: 'province 1', attackerSkill: 4, defenderSkill: 2,
            provinceStrength: 4, breakThreshold: 4
        };
        state.players.Opponent.cardPiles.cardsInPlay[0].attachments = [{
            uuid: 'enemy-attachment', id: 'fine-katana', type: 'attachment'
        }];
        const snapshot = new PerspectiveSnapshotBuilder().build({
            playerState: state, botName: 'Bot', context: {
                roundNumber: 2,
                legalAttachmentTargetUuidsBySource: { source: ['enemy-attachment'] },
                conflictPlanningCharacters: {
                    self: [{ uuid: 'own-character', military: 4, political: 5, ready: true, inConflict: true,
                        legalMilitary: true, legalPolitical: false, covert: true, bowsAfterConflict: false }],
                    opponent: [{ uuid: 'enemy-character', military: 2, political: 2, ready: false, inConflict: true,
                        legalMilitary: false, legalPolitical: false, covert: false, bowsAfterConflict: true,
                        attachments: [{ uuid: 'enemy-attachment', militaryBonus: 2, politicalBonus: 0, printedCost: 0 }] }]
                }
            }
        }, { informationMode: 'fair' });

        expect(snapshot.characters.find((character) => character.instanceId === 'own-character')).toEqual(jasmine.objectContaining({
            controllerId: 'Bot', military: 4, political: 5, participating: true, attacking: true,
            defending: false, ready: true, bowed: false, canAttackPolitical: false, covert: true,
            noBowAfterConflict: true
        }));
        expect(snapshot.characters.find((character) => character.instanceId === 'enemy-character')).toEqual(jasmine.objectContaining({
            controllerId: 'Opponent', participating: true, attacking: false, defending: true,
            ready: false, bowed: true,
            attachments: [jasmine.objectContaining({
                instanceId: 'enemy-attachment', militaryBonus: 2, politicalBonus: 0, printedCost: 0
            })]
        }));
        expect(snapshot.legalAttachmentTargetIdsBySource).toEqual({ source: ['enemy-attachment'] });
        expect(Object.isFrozen(snapshot.legalAttachmentTargetIdsBySource.source)).toBeTrue();
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
