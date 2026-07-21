const { emptyLedgers } = require('../../../build/server/game/bots/v2/model/Ledgers.js');
const FairInformationProvider = require('../../../build/server/game/bots/v2/information/FairInformationProvider.js').default;
const ExactInformationProvider = require('../../../build/server/game/bots/v2/information/ExactInformationProvider.js').default;
const { publicEvidenceFromPlayerState } = require('../../../build/server/game/bots/v2/information/PublicEvidence.js');
const V2BotEngine = require('../../../build/server/game/bots/v2/V2BotEngine.js').default;

describe('V2 opponent information providers', function() {
    function state(options = {}) {
        const scopes = { gameId: 'g', roundId: 'r', phaseId: 'conflict', conflictId: 'c' };
        return {
            schemaVersion: 1, perspectivePlayerId: 'Bot', informationMode: options.mode || 'fair', scopes,
            phase: 'conflict', prompt: { kind: 'prompt', identity: 'action', title: '', menu: '' }, promptControls: [],
            conflict: { id: 'c', attackerId: 'Bot', defenderId: 'Opponent', type: options.conflictType || 'military', provinceLocation: 'province 1', attackerSkill: 3, defenderSkill: 3, provinceStrength: 4, breakThreshold: 1 },
            players: {
                Bot: { id: 'Bot', fate: 3, honor: 8, conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: true },
                Opponent: { id: 'Opponent', fate: options.fate ?? 2, honor: 8, conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: false }
            },
            characters: [
                { instanceId: 'bot-char', cardId: 'bot-char', controllerId: 'Bot', location: 'play area', military: 3, political: 2, glory: 1, fate: 1, honored: false, dishonored: false, bowed: false, ready: true, participating: true, attacking: true, defending: false, traits: [], attachments: [], canMove: true, canReady: true, noBowAfterConflict: false, canAttackMilitary: true, canAttackPolitical: true, covert: false, attackRestrictions: [] },
                { instanceId: 'opp-char', cardId: 'opp-char', controllerId: 'Opponent', location: 'play area', military: 3, political: 3, glory: 1, fate: 1, honored: false, dishonored: false, bowed: false, ready: true, participating: true, attacking: false, defending: true, traits: [], attachments: [], canMove: true, canReady: true, noBowAfterConflict: false, canAttackMilitary: true, canAttackPolitical: true, covert: false, attackRestrictions: [] }
            ],
            provinces: [
                { controllerId: 'Opponent', location: 'province 1', cardId: 'public-province', visible: true, broken: false, inConflict: true, effectiveStrength: 4, holdingIds: [], attackEligible: true, stronghold: false },
                { controllerId: 'Opponent', location: 'province 2', visible: false, broken: false, inConflict: false, effectiveStrength: 4, holdingIds: [], attackEligible: true, stronghold: false }
            ],
            rings: [],
            hands: [{ playerId: 'Bot', size: 4, exact: true, cards: [] }, { playerId: 'Opponent', size: options.handSize ?? 2, exact: false, cards: [] }],
            opportunities: { remainingByPlayer: { Bot: { military: 1, political: 1 }, Opponent: { military: 1, political: 1 } }, totalRemaining: 4 },
            resources: { fateByPlayer: { Bot: 3, Opponent: options.fate ?? 2 }, honorByPlayer: { Bot: 8, Opponent: 8 }, handSizeByPlayer: { Bot: 4, Opponent: options.handSize ?? 2 }, conflictDeckByPlayer: { Bot: 20, Opponent: 20 } },
            board: { readySkillByPlayer: {}, participatingSkillByPlayer: {} },
            ledgers: emptyLedgers(scopes), materialStateSignature: 'information'
        };
    }

    const conflictDeck = [
        { id: 'pump', type: 'event', fate: 1, militaryBonus: 2, conflictTypes: ['military'] },
        { id: 'pump', type: 'event', fate: 1, militaryBonus: 2, conflictTypes: ['military'] },
        { id: 'bow', type: 'event', fate: 1, canBowOpponent: true, usageKey: 'bow/round' },
        { id: 'expensive', type: 'event', fate: 3, swing: 5 },
        { id: 'political-only', type: 'event', fate: 0, politicalBonus: 2, conflictTypes: ['political'] }
    ];

    it('subtracts public copies and builds deterministic weighted fair hand hypotheses', function() {
        const provider = new FairInformationProvider();
        const input = {
            conflictDeck,
            evidence: { playedCardIds: ['pump'], searchedCardIds: ['bow'], publicDraws: 2, bidHistory: [1, 5] }
        };
        const first = provider.build(state(), input);
        const second = provider.build(state(), input);
        expect(first).toEqual(second);
        expect(first.mode).toBe('fair');
        expect(first.handHypotheses.every((hypothesis) => hypothesis.exact === false)).toBeTrue();
        expect(first.handHypotheses.every((hypothesis) => hypothesis.cards.some((card) => card.id === 'bow'))).toBeTrue();
        expect(first.trace.remainingCopies).toBe(3);
        expect(first.trace.publicDraws).toBe(2);
        expect(first.handHypotheses.reduce((sum, hypothesis) => sum + hypothesis.weight, 0)).toBeCloseTo(1, 5);
    });

    it('does not inspect hands or facedown province identities while extracting public evidence', function() {
        function playerState(secretCard, secretProvince) {
            return { players: {
                Bot: { cardPiles: { hand: [{ id: 'own' }] } },
                Opponent: {
                    cardPiles: {
                        hand: [{ id: secretCard }],
                        conflictDiscardPile: [{ id: 'discarded' }],
                        dynastyDiscardPile: [], cardsInPlay: [{ id: 'in-play' }]
                    },
                    provinces: {
                        province1: [{ id: 'revealed', location: 'province 1', facedown: false, strength: 4 }],
                        province2: [{ id: secretProvince, location: 'province 2', facedown: true, strength: 4 }]
                    }
                }
            } };
        }
        const first = publicEvidenceFromPlayerState(playerState('secret-a', 'hidden-a'), 'Bot');
        const second = publicEvidenceFromPlayerState(playerState('secret-b', 'hidden-b'), 'Bot');
        expect(first).toEqual(second);
        expect(JSON.stringify(first)).not.toContain('secret-');
        expect(JSON.stringify(first)).not.toContain('hidden-');
        expect(first.revealedProvinces.map((province) => province.id)).toEqual(['revealed']);
    });

    it('returns identical fair decisions when only inaccessible hidden identities change', function() {
        function rawState(secretCard, secretProvince) {
            return {
                gameId: 'g', phase: 'conflict',
                players: {
                    Bot: {
                        name: 'Bot', phase: 'conflict', promptTitle: 'Conflict Action Window', menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }], stats: { fate: 2, honor: 8 },
                        cardPiles: {
                            hand: [{ uuid: 'own-card', id: 'banzai', name: 'Banzai!', type: 'event', cost: 0, selectable: true }],
                            cardsInPlay: [{ uuid: 'own-char', id: 'own-char', type: 'character', location: 'play area', military: 2, political: 1, bowed: false, attachments: [] }],
                            conflictDeck: [{}, {}], dynastyDeck: [{}]
                        },
                        provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: []
                    },
                    Opponent: {
                        name: 'Opponent', stats: { fate: 2, honor: 8 },
                        cardPiles: { hand: [{ uuid: 'secret', id: secretCard }], cardsInPlay: [], conflictDeck: [{}, {}], dynastyDeck: [{}] },
                        provinces: { one: [{ uuid: 'hidden-province', id: secretProvince, facedown: true, location: 'province 1' }], two: [], three: [], four: [] },
                        strongholdProvince: []
                    }
                }, rings: {}
            };
        }
        const fallbackDecision = { command: 'menuButton', args: ['pass', 'pass'], target: 'Pass' };
        const decide = (playerState) => {
            const fallback = { version: 'v1', seedState: 1, decide: () => fallbackDecision };
            const engine = new V2BotEngine(fallback, { playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research' });
            const decision = engine.decide({
                playerState, botName: 'Bot', context: {
                    opponentConflictDeck: conflictDeck,
                    opponentProvinceDeck: [{ id: 'hidden-a', strength: 3 }, { id: 'hidden-b', strength: 5 }]
                }
            });
            return { decision, planner: engine.lastDecisionTrace.planner };
        };
        const first = decide(rawState('secret-hand-a', 'secret-province-a'));
        const second = decide(rawState('secret-hand-b', 'secret-province-b'));
        expect(first.decision).toEqual(second.decision);
        expect(first.planner.stateSignature).toBe(second.planner.stateSignature);
        expect(first.planner.information).toEqual(second.planner.information);
        expect(first.planner.v2Preference).toEqual(second.planner.v2Preference);
    });

    it('uses exact revealed provinces and remaining-copy weights for hidden fair provinces', function() {
        const result = new FairInformationProvider().build(state(), {
            conflictDeck: [],
            provinceDeck: [
                { id: 'public-province', strength: 4 },
                { id: 'hidden-a', strength: 3 },
                { id: 'hidden-b', strength: 5 }
            ],
            evidence: { revealedProvinces: [{ id: 'public-province', strength: 4, location: 'province 1' }] }
        });
        const visible = result.provinceHypotheses.find((hypothesis) => hypothesis.location === 'province 1');
        const hidden = result.provinceHypotheses.find((hypothesis) => hypothesis.location === 'province 2');
        expect(visible.exact).toBeTrue();
        expect(visible.possibilities.map((entry) => entry.province.id)).toEqual(['public-province']);
        expect(hidden.exact).toBeFalse();
        expect(hidden.possibilities.map((entry) => entry.province.id)).toEqual(['hidden-a', 'hidden-b']);
        expect(hidden.possibilities.map((entry) => entry.weight)).toEqual([0.5, 0.5]);
    });

    it('shares fate and usage limits across fair response packages and respects timing', function() {
        const result = new FairInformationProvider().build(state({ fate: 1, handSize: 2 }), {
            conflictDeck,
            evidence: { searchedCardIds: ['bow'], usedLimits: ['bow/round'] }
        });
        expect(result.responsePackages.every((pkg) => pkg.fateCost <= 1)).toBeTrue();
        expect(result.responsePackages.flatMap((pkg) => pkg.cardIds)).not.toContain('bow');
        expect(result.responsePackages.flatMap((pkg) => pkg.cardIds)).not.toContain('political-only');
        expect(result.responsePackages.flatMap((pkg) => pkg.cardIds)).not.toContain('expensive');
    });

    it('returns exact authorized hand/province hypotheses but filters illegal or unaffordable responses', function() {
        const result = new ExactInformationProvider().build(state({ mode: 'omniscient', fate: 5 }), {
            hand: [
                { id: 'legal-pump', type: 'event', fate: 1, militaryBonus: 2, conflictTypes: ['military'] },
                { id: 'wrong-window', type: 'event', fate: 0, politicalBonus: 4, conflictTypes: ['political'] },
                { id: 'too-expensive', type: 'event', fate: 2, canBowOpponent: true }
            ],
            provinces: [
                { id: 'exact-one', strength: 4, location: 'province 1' },
                { id: 'broken', strength: 5, location: 'province 2', broken: true }
            ],
            fate: 1
        });
        expect(result.mode).toBe('omniscient');
        expect(result.certainty).toBe(1);
        expect(result.handHypotheses).toEqual([jasmine.objectContaining({ exact: true, weight: 1 })]);
        expect(result.provinceHypotheses.map((hypothesis) => hypothesis.location)).toEqual(['province 1']);
        expect(result.responsePackages.flatMap((pkg) => pkg.cardIds)).toEqual(['legal-pump']);
        const response = result.responsePackages[0].candidates[0];
        expect(response.commandPreview.command).toBe('cardClicked');
        expect(response.effects[0].target.instanceId).toBe('opp-char');
    });

    it('never combines two copies that share a once-per-scope usage key', function() {
        const result = new ExactInformationProvider().build(state({ mode: 'omniscient', fate: 2 }), {
            hand: [
                { id: 'limited', type: 'event', fate: 1, militaryBonus: 2, usageKey: 'limited/conflict' },
                { id: 'limited', type: 'event', fate: 1, militaryBonus: 2, usageKey: 'limited/conflict' }
            ],
            provinces: []
        });
        expect(result.responsePackages.every((pkg) => pkg.cardIds.length === 1)).toBeTrue();
    });
});
