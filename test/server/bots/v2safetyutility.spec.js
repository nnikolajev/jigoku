const PerspectiveSnapshotBuilder = require('../../../build/server/game/bots/v2/PerspectiveSnapshotBuilder.js').default;
const SafetyVetoPipeline = require('../../../build/server/game/bots/v2/SafetyVetoPipeline.js').default;
const { candidateActionKey } = require('../../../build/server/game/bots/v2/SafetyVetoPipeline.js');
const UtilityEvaluator = require('../../../build/server/game/bots/v2/UtilityEvaluator.js').default;
const { compareScored } = require('../../../build/server/game/bots/v2/UtilityEvaluator.js');

describe('V2 safety vetoes and utility', function() {
    function planningState(options = {}) {
        const conflict = options.strongholdThreat ? {
            id: 'c1', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
            provinceLocation: 'stronghold province', attackerSkill: 8, defenderSkill: 1,
            provinceStrength: 5, breakThreshold: 5
        } : options.conflict;
        const input = {
            botName: 'Bot', context: { roundNumber: 2, conflictId: conflict?.id },
            playerState: {
                phase: options.phase || 'conflict', conflict,
                players: {
                    Bot: {
                        name: 'Bot', phase: options.phase || 'conflict', promptTitle: 'Conflict Action Window', menuTitle: 'Initiate an action',
                        stats: { fate: options.fate ?? 4, honor: options.honor ?? 5 },
                        cardPiles: { hand: new Array(options.handSize ?? 3).fill({}), conflictDeck: new Array(options.deckSize ?? 5).fill({}), cardsInPlay: [{
                            uuid: 'own', id: 'own', type: 'character', location: 'play area', military: 3, political: 2,
                            bowed: false, inConflict: !!options.ownParticipating,
                            attachments: [{ uuid: 'existing', id: 'existing', type: 'attachment', nonStackingKeys: ['clarity'] }]
                        }] },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [{ uuid: 'own-sh', type: 'province', location: 'stronghold province', inConflict: !!options.strongholdThreat, strength: 5 }]
                    },
                    Opponent: {
                        name: 'Opponent', stats: { fate: 3, honor: 8 },
                        cardPiles: { hand: [], conflictDeck: [{}, {}], cardsInPlay: [{ uuid: 'enemy', id: 'enemy', type: 'character', location: 'play area', military: 2, political: 3, bowed: false, attachments: [] }] },
                        provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [{ uuid: 'enemy-sh', type: 'province', location: 'stronghold province', strength: 5 }]
                    }
                }, rings: {}
            }
        };
        return new PerspectiveSnapshotBuilder().build(input, { informationMode: 'fair' });
    }
    function candidate(overrides = {}) {
        return {
            id: overrides.id || `candidate:${overrides.kind || 'mode-selection'}`,
            kind: overrides.kind || 'mode-selection',
            source: overrides.source,
            mode: overrides.mode,
            targets: overrides.targets || [],
            commandPreview: Object.prototype.hasOwnProperty.call(overrides, 'commandPreview')
                ? overrides.commandPreview
                : { command: 'menuButton', args: ['x', 'uuid'], target: 'X' },
            costs: overrides.costs || {}, effects: overrides.effects || [],
            prerequisites: overrides.prerequisites || [], tags: overrides.tags || [], limits: [],
            uncertainty: overrides.uncertainty || 0, confidence: overrides.confidence ?? 1,
            proposer: 'test'
        };
    }

    it('vetoes illegal, stale, attempted, and no-progress candidates above contributors', function() {
        const state = planningState();
        const illegal = candidate({ id: 'illegal', commandPreview: null });
        const stale = candidate({ id: 'stale', targets: [{ kind: 'character', instanceId: 'gone', controllerId: 'Opponent' }] });
        const repeated = candidate({ id: 'repeated' });
        const noProgress = candidate({ id: 'no-progress', commandPreview: { command: 'menuButton', args: ['y', 'uuid'], target: 'Y' } });
        const result = new SafetyVetoPipeline().evaluate(state, [illegal, stale, repeated, noProgress], {
            attemptedActionKeys: [candidateActionKey(repeated)],
            noProgressActionKeys: [candidateActionKey(noProgress)]
        });
        expect(result.allowed).toEqual([]);
        expect(new Set(result.vetoed.map((entry) => entry.code))).toEqual(new Set([
            'illegal-command-preview', 'stale-target', 'attempted-click', 'no-progress'
        ]));
    });

    it('protects terminal, stronghold, honor, deck, and mandatory-defense invariants', function() {
        const state = planningState({ strongholdThreat: true, honor: 1, deckSize: 1 });
        const pass = candidate({ id: 'pass', kind: 'pass' });
        const attack = candidate({ id: 'attack', tags: ['offense'] });
        const honorSpend = candidate({ id: 'honor', costs: { honor: 1 } });
        const lethalDraw = candidate({ id: 'draw', effects: [{ kind: 'deck', draw: 2 }] });
        const result = new SafetyVetoPipeline().evaluate(state, [pass, attack, honorSpend, lethalDraw], {
            honorFloor: 0, mandatoryDefenderCount: 2
        });
        const codes = new Set(result.vetoed.map((entry) => entry.code));
        expect(codes).toEqual(new Set([
            'terminal-loss', 'mandatory-defense', 'exposed-stronghold', 'honor-floor', 'conflict-deck-exhaustion'
        ]));
    });

    it('does not treat every stronghold conflict as an immediate terminal loss', function() {
        const safe = planningState({
            conflict: {
                id: 'safe-stronghold', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
                provinceLocation: 'stronghold province', attackerSkill: 4, defenderSkill: 9,
                provinceStrength: 5, breakThreshold: 5
            }
        });
        const pass = candidate({ id: 'safe-pass', kind: 'pass' });
        const ordinaryAction = candidate({ id: 'safe-action', tags: ['offense'] });
        const result = new SafetyVetoPipeline().evaluate(safe, [pass, ordinaryAction]);

        expect(result.allowed.map((entry) => entry.id)).toEqual(['safe-pass', 'safe-action']);
        expect(result.vetoed).toEqual([]);
    });

    it('vetoes wrong-side targets, duplicate effects, attachment copies, consumed reducers, and impossible payoff', function() {
        const state = planningState();
        const wrongSide = candidate({ id: 'wrong-side', targets: [{ kind: 'character', instanceId: 'own', controllerId: 'Bot' }], effects: [{ kind: 'bow', target: { kind: 'character', instanceId: 'own', controllerId: 'Bot' } }] });
        const duplicateAttachment = candidate({ id: 'duplicate', targets: [{ kind: 'character', instanceId: 'own', controllerId: 'Bot' }], effects: [{ kind: 'attachment', target: { kind: 'character', instanceId: 'own', controllerId: 'Bot' }, nonStackingKey: 'clarity' }] });
        const impossibleReducer = candidate({ id: 'reducer', costs: { fate: 0 }, effects: [{ kind: 'reduction', amount: 1, costType: 'fate' }] });
        const impossible = candidate({ id: 'impossible', prerequisites: [{ id: 'payoff', description: 'needs target', satisfied: false }] });
        const result = new SafetyVetoPipeline().evaluate(state, [wrongSide, duplicateAttachment, impossibleReducer, impossible]);
        expect(new Set(result.vetoed.map((entry) => entry.code))).toEqual(new Set([
            'target-polarity', 'duplicate-non-stacking-effect', 'impossible-payoff', 'prerequisite-failed'
        ]));
    });

    it('scores terminal wins and loss prevention lexicographically above ordinary profile value', function() {
        const evaluator = new UtilityEvaluator();
        const state = planningState({ strongholdThreat: true, ownParticipating: true });
        const win = candidate({
            id: 'forced-win', tags: ['terminal', 'offense'],
            targets: [{ kind: 'province', controllerId: 'Opponent', location: 'stronghold province' }],
            effects: [{ kind: 'province', location: 'stronghold province', break: true }]
        });
        const ownTarget = { kind: 'character', instanceId: 'own', controllerId: 'Bot' };
        const survive = candidate({
            id: 'survive', kind: 'conflict-card', tags: ['terminal', 'defense'], targets: [ownTarget],
            effects: [{ kind: 'skill', target: ownTarget, military: 3, confidence: 1 }]
        });
        const economy = candidate({ id: 'economy', effects: [{ kind: 'resource', fate: 100, cards: 100 }] });
        const scored = [win, survive, economy].map((entry) => ({
            candidate: entry,
            score: evaluator.evaluate(state, entry, {
                adjustments: [{ candidateId: 'economy', delta: { fate: 10000 }, reason: 'extreme-test-profile' }]
            })
        })).sort(compareScored);
        expect(scored.map((entry) => entry.candidate.id)).toEqual(['forced-win', 'survive', 'economy']);
        expect(scored[0].score.explanation).toContain('terminal-rank:5');
    });

    it('breaks equal-score ties by exact cost and semantic identity before runtime UUIDs', function() {
        const score = { terminalRank: 1, scalar: 10 };
        const banzai = candidate({
            id: 'candidate:000-runtime-first', kind: 'conflict-card', costs: { cards: 1 },
            source: { kind: 'card', instanceId: 'runtime-banzai', cardId: 'banzai', controllerId: 'Bot', location: 'hand' },
            commandPreview: { command: 'cardClicked', args: ['runtime-banzai'], target: 'Banzai!' }
        });
        const courtGames = candidate({
            id: 'candidate:zzz-runtime-last', kind: 'in-play-ability', costs: {},
            source: { kind: 'card', instanceId: 'runtime-court', cardId: 'court-games', controllerId: 'Bot', location: 'play area' },
            commandPreview: { command: 'cardClicked', args: ['runtime-court'], target: 'Court Games' }
        });
        expect([{ candidate: banzai, score }, { candidate: courtGames, score }]
            .sort(compareScored).map((entry) => entry.candidate.id))
            .toEqual(['candidate:zzz-runtime-last', 'candidate:000-runtime-first']);

        const semanticA = candidate({
            id: 'candidate:zzz', kind: 'conflict-card',
            source: { kind: 'card', instanceId: 'runtime-a', cardId: 'banzai', controllerId: 'Bot', location: 'hand' }
        });
        const semanticB = candidate({
            id: 'candidate:aaa', kind: 'conflict-card',
            source: { kind: 'card', instanceId: 'runtime-b', cardId: 'court-games', controllerId: 'Bot', location: 'hand' }
        });
        expect([{ candidate: semanticB, score }, { candidate: semanticA, score }]
            .sort(compareScored).map((entry) => entry.source?.cardId || entry.candidate.source?.cardId))
            .toEqual(['banzai', 'court-games']);
    });

    it('assigns terminal rank only when an exact effect causally crosses the threshold', function() {
        const evaluator = new UtilityEvaluator();
        const safe = planningState({
            ownParticipating: true,
            conflict: {
                id: 'safe-stronghold', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
                provinceLocation: 'stronghold province', attackerSkill: 4, defenderSkill: 9,
                provinceStrength: 5, breakThreshold: 5
            }
        });
        const threatened = planningState({ strongholdThreat: true, ownParticipating: true });
        const ownTarget = { kind: 'character', instanceId: 'own', controllerId: 'Bot' };
        const broadTag = candidate({ id: 'broad-tag', tags: ['terminal', 'defense'] });
        const insufficient = candidate({
            id: 'insufficient', tags: ['terminal', 'defense'], targets: [ownTarget],
            effects: [{ kind: 'skill', target: ownTarget, military: 2, confidence: 1 }]
        });
        const exactSave = candidate({
            id: 'exact-save', tags: ['terminal', 'defense'], targets: [ownTarget],
            effects: [{ kind: 'skill', target: ownTarget, military: 3, confidence: 1 }]
        });
        const uncertainSave = candidate({
            id: 'uncertain-save', tags: ['terminal', 'defense'], targets: [ownTarget],
            effects: [{ kind: 'skill', target: ownTarget, military: 3, confidence: 0.8 }]
        });

        const safeBroadScore = evaluator.evaluate(safe, broadTag);
        const threatenedBroadScore = evaluator.evaluate(threatened, broadTag);
        const insufficientScore = evaluator.evaluate(threatened, insufficient);
        const uncertainScore = evaluator.evaluate(threatened, uncertainSave);
        const exactScore = evaluator.evaluate(threatened, exactSave);
        expect(safeBroadScore.terminalRank).toBe(1);
        expect(threatenedBroadScore.terminalRank).toBe(1);
        expect(insufficientScore.terminalRank).toBe(1);
        expect(uncertainScore.terminalRank).toBe(1);
        expect(exactScore.terminalRank).toBe(4);
        expect(threatenedBroadScore.vector.strongholdSafety).toBe(2);
        expect(insufficientScore.vector.strongholdSafety).toBe(2);
        expect(uncertainScore.vector.strongholdSafety).toBe(2);
        expect(exactScore.vector.strongholdSafety).toBe(50);
        expect(exactScore.explanation).toContain('stronghold-save:exact-threshold');
    });

    it('applies diminishing surplus, duplicate, unusable-card, and unspendable-fate value with traceable components', function() {
        const evaluator = new UtilityEvaluator();
        const state = planningState({
            conflict: { id: 'c', attackerId: 'Bot', defenderId: 'Opponent', type: 'military', attackerSkill: 4, defenderSkill: 3, provinceStrength: 3, breakThreshold: 3 },
            handSize: 8, fate: 8
        });
        const excess = candidate({ id: 'excess', effects: [{ kind: 'skill', military: 10 }] });
        const duplicate = candidate({ id: 'duplicate', effects: [{ kind: 'attachment', target: { kind: 'character', instanceId: 'own', controllerId: 'Bot' }, nonStackingKey: 'clarity' }] });
        const draw = candidate({ id: 'draw', effects: [{ kind: 'deck', draw: 4 }] });
        const pass = candidate({ id: 'pass', kind: 'pass' });
        const scores = Object.fromEntries([excess, duplicate, draw, pass].map((entry) => [entry.id, evaluator.evaluate(state, entry)]));
        expect(scores.excess.vector.waste).toBeLessThan(0);
        expect(scores.duplicate.vector.waste).toBeLessThan(0);
        expect(scores.draw.vector.cards).toBe(0);
        expect(scores.draw.vector.waste).toBe(-4);
        expect(scores.pass.vector.waste).toBeLessThan(0);
        expect(scores.excess.explanation.some((line) => line.startsWith('skill:useful='))).toBeTrue();
    });

    it('values only relevant conflict skill and uses the perspective player conflict role', function() {
        const evaluator = new UtilityEvaluator();
        const defending = planningState({
            ownParticipating: true,
            conflict: { id: 'c', attackerId: 'Opponent', defenderId: 'Bot', type: 'political', attackerSkill: 7, defenderSkill: 4, provinceStrength: 4, breakThreshold: 4 }
        });
        const exactTarget = { kind: 'character', instanceId: 'own', controllerId: 'Bot' };
        const enough = candidate({ id: 'enough', targets: [exactTarget], effects: [{ kind: 'skill', target: exactTarget, military: 9, political: 4 }] });
        const wrongType = candidate({ id: 'wrong-type', targets: [exactTarget], effects: [{ kind: 'skill', target: exactTarget, military: 9, political: 0 }] });
        const nonParticipant = { kind: 'character', instanceId: 'enemy', controllerId: 'Opponent' };
        const wrongTarget = candidate({ id: 'wrong-target', targets: [nonParticipant], effects: [{ kind: 'skill', target: nonParticipant, political: 9 }] });

        const enoughScore = evaluator.evaluate(defending, enough);
        expect(enoughScore.vector.conflictOutcome).toBe(4);
        expect(enoughScore.vector.waste).toBe(0);
        expect(enoughScore.explanation).toContain('skill:useful=4,surplus=0,required=4');
        expect(evaluator.evaluate(defending, wrongType).vector.conflictOutcome).toBe(0);
        expect(evaluator.evaluate(defending, wrongTarget).vector.conflictOutcome).toBe(0);
    });
});
