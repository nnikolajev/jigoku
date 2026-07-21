const {
    ConflictDeckSafetyTactics,
    DEFAULT_CONFLICT_DECK_SAFETY
} = require('../../../build/server/game/bots/ConflictDeckSafetyTactics.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
const BoardAwareJigokuBotPolicy = require('../../../build/server/game/bots/BoardAwareJigokuBotPolicy.js');
const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

describe('ConflictDeckSafetyTactics', function() {
    const tactics = new ConflictDeckSafetyTactics(DEFAULT_CONFLICT_DECK_SAFETY);

    it('preserves enough cards for the normal draw and visible Shoju forced draw', function() {
        const result = tactics.analyzeOptionalConsumption({
            remainingConflictCards: 4,
            optionalCardsConsumed: 2,
            ownHonor: 6,
            phase: 'conflict',
            visibleOpponentCards: [{ id: 'bayushi-shoju-2', fate: 2 }]
        });

        expect(result.shouldConsume).toBe(false);
        expect(result.remainingAfterConsumption).toBe(2);
        expect(result.reservedFutureDraws).toBe(3);
        expect(result.reason).toBe('conflict-deck-safety-skip-lethal-exhaustion');
    });

    it('takes the same optional draw when the conflict deck safely covers public future draws', function() {
        expect(tactics.shouldConsumeOptionalCards({
            remainingConflictCards: 16,
            optionalCardsConsumed: 2,
            ownHonor: 10,
            phase: 'conflict',
            visibleOpponentCards: [{ id: 'bayushi-shoju-2', fate: 2 }]
        })).toBe(true);
    });

    it('stops optional draws when a visible honor loss makes the next reshuffle lethal', function() {
        const result = tactics.analyzeOptionalConsumption({
            remainingConflictCards: 16,
            optionalCardsConsumed: 1,
            ownHonor: 6,
            phase: 'draw',
            visibleOpponentCards: [{ id: 'bayushi-shoju-2', fate: 1 }]
        });

        expect(result.shouldConsume).toBe(false);
        expect(result.reason).toBe('conflict-deck-safety-skip-under-lethal-honor-pressure');
    });

    it('does not reserve for a forced-draw character that will leave before next round', function() {
        const result = tactics.analyzeOptionalConsumption({
            remainingConflictCards: 3,
            optionalCardsConsumed: 2,
            ownHonor: 10,
            phase: 'conflict',
            visibleOpponentCards: [{ id: 'bayushi-shoju-2', fate: 1 }]
        });

        expect(result.reservedFutureDraws).toBe(1);
        expect(result.shouldConsume).toBe(true);
    });
});

describe('modern-seed conflict-deck safety integration', function() {
    const BOT = 'Jigoku Bot';
    const PASS = { text: 'Pass', arg: 'pass', uuid: 'pass' };
    const profile = resolveDeckProfile([]);
    const character = (uuid, id, extras = {}) => ({
        uuid, id, name: id, type: 'character', location: 'play area',
        militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '3' },
        ...extras
    });

    function drawReactionState(deckSize) {
        const library = {
            uuid: 'library', id: 'forgotten-library', name: 'Forgotten Library',
            type: 'holding', location: 'province 3', facedown: false, selectable: true
        };
        return {
            players: {
                [BOT]: {
                    id: 'bot', name: BOT, phase: 'draw', numConflictCards: deckSize,
                    promptTitle: 'Triggered Abilities', menuTitle: 'Any reactions to draw phase starting?',
                    buttons: [PASS], stats: { fate: 2, honor: 6, conflictsRemaining: 2 },
                    provinces: { one: [], two: [], three: [library], four: [] },
                    strongholdProvince: [],
                    cardPiles: { hand: [], cardsInPlay: [], conflictDiscardPile: [], dynastyDiscardPile: [] }
                },
                Human: {
                    id: 'human', name: 'Human', stats: { fate: 2, honor: 6, conflictsRemaining: 2 },
                    provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [],
                    cardPiles: {
                        hand: [], conflictDiscardPile: [], dynastyDiscardPile: [],
                        cardsInPlay: [character('shoju', 'bayushi-shoju-2', { fate: 1 })]
                    }
                }
            }
        };
    }

    it('lets seeds 1 and 3 decline unsafe Forgotten Library while seed 2 keeps legacy behavior', function() {
        const context = { profile, cardHint: getPlaybookEntry, roundNumber: 4 };
        const seedOne = new FateAwareJigokuBotPolicy(1).decide(drawReactionState(2), BOT, context);
        const seedTwo = new JigokuBotPolicy(2).decide(drawReactionState(2), BOT, context);
        const seedThree = new BoardAwareJigokuBotPolicy(3).decide(drawReactionState(2), BOT, context);

        expect(seedOne.reason).toBe('pass-window');
        expect(seedTwo.reason).toBe('trigger-province-ability');
        expect(seedTwo.target).toBe('Forgotten Library');
        expect(seedThree.reason).toBe('pass-window');
    });

    it('lets seeds 1 and 3 decline unsafe Oracle of Stone while seed 2 keeps legacy behavior', function() {
        const oracle = {
            uuid: 'oracle', id: 'oracle-of-stone', name: 'Oracle of Stone', type: 'event',
            location: 'hand', selectable: true, isPlayableByMe: true
        };
        const attacker = character('attacker', 'attacker', { inConflict: true, bowed: false });
        const state = {
            players: {
                [BOT]: {
                    id: 'bot', name: BOT, phase: 'conflict', numConflictCards: 4,
                    promptTitle: 'Conflict Action Window', menuTitle: 'Military Conflict', buttons: [PASS],
                    stats: { fate: 2, honor: 6, conflictsRemaining: 1 },
                    provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [],
                    cardPiles: {
                        hand: [oracle], cardsInPlay: [attacker], conflictDiscardPile: [], dynastyDiscardPile: []
                    }
                },
                Human: {
                    id: 'human', name: 'Human', stats: { fate: 2, honor: 6, conflictsRemaining: 1 },
                    provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [],
                    cardPiles: {
                        hand: [], conflictDiscardPile: [], dynastyDiscardPile: [],
                        cardsInPlay: [character('shoju', 'bayushi-shoju-2', { fate: 2 })]
                    }
                }
            },
            conflict: {
                type: 'military', attackingPlayerId: 'bot', defendingPlayerId: 'human',
                attackerSkill: 3, defenderSkill: 4
            }
        };
        const context = {
            profile, cardHint: getPlaybookEntry, roundNumber: 3,
            conflictCosts: { oracle: 0 },
            legalDirectCardUuids: { oracle: true }
        };
        const seedOne = new FateAwareJigokuBotPolicy(1).decide(state, BOT, context);
        const seedTwo = new JigokuBotPolicy(2).decide(state, BOT, context);
        const seedThree = new BoardAwareJigokuBotPolicy(3).decide(state, BOT, context);

        expect(seedOne.target).not.toBe('Oracle of Stone');
        expect(seedTwo.reason).toBe('play-conflict-card');
        expect(seedTwo.target).toBe('Oracle of Stone');
        expect(seedThree.target).not.toBe('Oracle of Stone');
    });

    it('declines Shrine Maiden deck consumption without rejecting the character body', function() {
        const maiden = character('maiden', 'shrine-maiden', {
            selectable: true, inConflict: true, fate: 0
        });
        const state = {
            players: {
                [BOT]: {
                    id: 'bot', name: BOT, phase: 'conflict', numConflictCards: 2,
                    promptTitle: 'Triggered Abilities', menuTitle: 'Any reactions to Shrine Maiden?',
                    buttons: [PASS], stats: { fate: 2, honor: 6, conflictsRemaining: 1 },
                    provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [],
                    cardPiles: { hand: [], cardsInPlay: [maiden], conflictDiscardPile: [], dynastyDiscardPile: [] }
                },
                Human: {
                    id: 'human', name: 'Human', stats: { fate: 2, honor: 6, conflictsRemaining: 1 },
                    provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [],
                    cardPiles: {
                        hand: [], conflictDiscardPile: [], dynastyDiscardPile: [],
                        cardsInPlay: [character('shoju', 'bayushi-shoju-2', { fate: 2 })]
                    }
                }
            }
        };
        const context = { profile, cardHint: getPlaybookEntry, roundNumber: 3 };
        const seedOne = new FateAwareJigokuBotPolicy(1).decide(state, BOT, context);
        const seedTwo = new JigokuBotPolicy(2).decide(state, BOT, context);
        const seedThree = new BoardAwareJigokuBotPolicy(3).decide(state, BOT, context);

        expect(seedOne.reason).toBe('pass-window');
        expect(seedTwo.reason).toBe('trigger-hinted-ability');
        expect(seedTwo.target).toBe('shrine-maiden');
        expect(seedThree.reason).toBe('pass-window');
    });
});
