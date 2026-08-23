const {
    CARD_ENGINE_DRAW_BID_PROFILE,
    DEFAULT_DRAW_BID_PROFILE,
    DEFAULT_LEGACY_DRAW_BID_PROFILE,
    DISHONOR_DRAW_BID_PROFILE,
    DISHONOR_LEGACY_DRAW_BID_PROFILE,
    DrawBidTactics,
    HONOR_DRAW_BID_PROFILE,
    LegacyDrawBidTactics,
    LION_LEGACY_DRAW_BID_PROFILE,
    TOWER_DRAW_BID_PROFILE
} = require('../../../build/server/game/bots/DrawBidTactics.js');
const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
const { DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');

const BASE_CONTEXT_FOR_POLICY = {
    roundNumber: 3,
    myHonor: 11,
    opponentHonor: 11,
    myHandCount: 4,
    opponentHandCount: 4,
    myFate: 5,
    opponentFate: 5,
    fateOnUnclaimedRings: 0,
    myBrokenProvinces: 0,
    opponentBrokenProvinces: 0,
    averageConflictCardCost: 1,
    handCardCosts: [],
    board: {
        characterCount: 0,
        readyCharacterCount: 0,
        persistentCharacterCount: 0,
        attachmentCount: 0,
        totalCharacterFate: 0,
        militarySkill: 0,
        politicalSkill: 0
    },
    legalBids: [1, 2, 3, 4, 5]
};

describe('DrawBidTactics', function() {
    function context(overrides = {}) {
        return {
            roundNumber: 3,
            myHonor: 11,
            opponentHonor: 11,
            myHandCount: 4,
            opponentHandCount: 4,
            myFate: 6,
            opponentFate: 6,
            fateOnUnclaimedRings: 0,
            myBrokenProvinces: 0,
            opponentBrokenProvinces: 0,
            averageConflictCardCost: 1,
            handCardCosts: [0, 1, 1, 2],
            board: {
                characterCount: 2,
                readyCharacterCount: 2,
                persistentCharacterCount: 1,
                attachmentCount: 1,
                totalCharacterFate: 1,
                militarySkill: 5,
                politicalSkill: 5
            },
            legalBids: [1, 2, 3, 4, 5],
            ...overrides
        };
    }

    it('bids 5 on round one for every strategic profile', function() {
        for(const profile of [
            DEFAULT_DRAW_BID_PROFILE,
            CARD_ENGINE_DRAW_BID_PROFILE,
            HONOR_DRAW_BID_PROFILE,
            DISHONOR_DRAW_BID_PROFILE,
            TOWER_DRAW_BID_PROFILE
        ]) {
            expect(new DrawBidTactics(profile).analyze(context({
                roundNumber: 1,
                myHonor: 3,
                opponentHonor: 3,
                myFate: 0
            })).selectedBid).toBe(5);
        }
    });

    // The original rail order, kept as the `cardsOverHonor: false` contract.
    // Every honor rail outranks conquest, including at honor totals where
    // nobody can actually win or lose on the honor track.
    it('uses honor win/loss rails before conquest emergencies without cardsOverHonor', function() {
        const tactics = new DrawBidTactics({
            ...DEFAULT_DRAW_BID_PROFILE, cardsOverHonor: false
        });
        expect(tactics.analyze(context({ myHonor: 6, myBrokenProvinces: 3 })).reason)
            .toBe('protect-low-honor');
        expect(tactics.analyze(context({ opponentHonor: 6, opponentBrokenProvinces: 3 })).reason)
            .toBe('pressure-opponent-dishonor');
        expect(tactics.analyze(context({ myHonor: 19, myBrokenProvinces: 3 })).reason)
            .toBe('pursue-honor-victory');
        expect(tactics.analyze(context({ opponentHonor: 21, opponentBrokenProvinces: 3 })).reason)
            .toBe('deny-opponent-honor-victory');
    });

    // Shipped default: conquest outranks the two rails where honor is only a
    // resource, and still yields to the two where it decides the game.
    it('spends honor for cards near conquest, but never a live honor race', function() {
        const tactics = new DrawBidTactics(DEFAULT_DRAW_BID_PROFILE);
        expect(tactics.analyze(context({ myHonor: 6, myBrokenProvinces: 3 })).reason)
            .toBe('defend-open-stronghold');
        expect(tactics.analyze(context({ opponentHonor: 6, opponentBrokenProvinces: 3 })).reason)
            .toBe('attack-open-stronghold');
        expect(tactics.analyze(context({ myHonor: 22, myBrokenProvinces: 3 })).reason)
            .toBe('pursue-honor-victory');
        expect(tactics.analyze(context({ opponentHonor: 22, opponentBrokenProvinces: 3 })).reason)
            .toBe('deny-opponent-honor-victory');
        // Still protects a total a maximum bid could zero out.
        expect(tactics.analyze(context({ myHonor: 4, myBrokenProvinces: 3 })).reason)
            .toBe('protect-low-honor');
    });

    it('draws maximum cards when either stronghold is open and honor is safe', function() {
        const tactics = new DrawBidTactics(DEFAULT_DRAW_BID_PROFILE);
        expect(tactics.analyze(context({ myBrokenProvinces: 3 })).selectedBid).toBe(5);
        expect(tactics.analyze(context({ opponentBrokenProvinces: 3 })).selectedBid).toBe(5);
    });

    it('turns fate, current hand costs, and deck average cost into a continuous deduction', function() {
        const tactics = new DrawBidTactics(DEFAULT_DRAW_BID_PROFILE);
        const expensive = tactics.analyze(context({
            myFate: 1,
            averageConflictCardCost: 2,
            handCardCosts: [2, 2, 2]
        }));
        const cheap = tactics.analyze(context({
            myFate: 1,
            averageConflictCardCost: 0.4,
            handCardCosts: [1, 1, 1]
        }));
        expect(expensive.selectedBid).toBe(1);
        expect(expensive.deductions.fate).toBe(4);
        expect(cheap.selectedBid).toBe(4);
        expect(cheap.deductions.fate).toBe(1);
    });

    it('credits ring fate as uncertain future spending power', function() {
        const tactics = new DrawBidTactics(DEFAULT_DRAW_BID_PROFILE);
        const dry = tactics.analyze(context({
            myFate: 1,
            averageConflictCardCost: 2,
            handCardCosts: [2, 2]
        }));
        const richRings = tactics.analyze(context({
            myFate: 1,
            fateOnUnclaimedRings: 5,
            averageConflictCardCost: 2,
            handCardCosts: [2, 2]
        }));
        expect(richRings.effectiveFate).toBeGreaterThan(dry.effectiveFate);
        expect(richRings.selectedBid).toBeGreaterThan(dry.selectedBid);
    });

    it('draws less with a crowded hand or an established persistent board', function() {
        const tactics = new DrawBidTactics(DEFAULT_DRAW_BID_PROFILE);
        const needsCards = tactics.analyze(context());
        const established = tactics.analyze(context({
            myHandCount: 10,
            myFate: 10,
            handCardCosts: [],
            board: {
                characterCount: 4,
                readyCharacterCount: 4,
                persistentCharacterCount: 4,
                attachmentCount: 5,
                totalCharacterFate: 7,
                militarySkill: 15,
                politicalSkill: 15
            }
        }));
        expect(established.deductions.hand).toBe(2);
        expect(established.deductions.board).toBe(2);
        expect(established.selectedBid).toBeLessThan(needsCards.selectedBid);
    });

    it('keeps card-engine decks aggressive despite expensive low-fate draws', function() {
        const analysis = new DrawBidTactics(CARD_ENGINE_DRAW_BID_PROFILE).analyze(context({
            myFate: 0,
            fateOnUnclaimedRings: 0,
            averageConflictCardCost: 2,
            handCardCosts: [2, 3, 4]
        }));
        expect(analysis.selectedBid).toBe(4);
    });

    it('keeps attachment towers drawing reducers and ready effects after setup', function() {
        const analysis = new DrawBidTactics(TOWER_DRAW_BID_PROFILE).analyze(context({
            myFate: 8,
            handCardCosts: [],
            board: {
                characterCount: 3,
                readyCharacterCount: 3,
                persistentCharacterCount: 3,
                attachmentCount: 7,
                totalCharacterFate: 8,
                militarySkill: 18,
                politicalSkill: 16
            }
        }));
        expect(analysis.deductions.board).toBe(1);
        expect(analysis.selectedBid).toBe(4);
    });

    it('lets honor decks underbid a predicted high draw when the honor plan is live', function() {
        const honor = new DrawBidTactics(HONOR_DRAW_BID_PROFILE).analyze(context({
            myHonor: 16,
            opponentHandCount: 1,
            opponentFate: 6,
            myFate: 10,
            handCardCosts: []
        }));
        const balanced = new DrawBidTactics(DEFAULT_DRAW_BID_PROFILE).analyze(context({
            myHonor: 16,
            opponentHandCount: 1,
            opponentFate: 6,
            myFate: 10,
            handCardCosts: []
        }));
        expect(honor.predictedOpponentBid).toBe(5);
        expect(honor.deductions.honorOpportunity).toBe(3);
        expect(honor.selectedBid).toBeLessThan(balanced.selectedBid);
    });

    it('keeps Scorpion at bid 1 after its opening draw', function() {
        const tactics = new DrawBidTactics(DISHONOR_DRAW_BID_PROFILE);
        expect(tactics.analyze(context({ roundNumber: 1 })).selectedBid).toBe(5);
        expect(tactics.analyze(context({ roundNumber: 2 })).selectedBid).toBe(1);
    });

    it('maps desired bids to the nearest legal prompt value', function() {
        const tactics = new DrawBidTactics(DEFAULT_DRAW_BID_PROFILE);
        expect(tactics.analyze(context({ roundNumber: 1, legalBids: [1, 3] })).selectedBid).toBe(3);
    });

    // Honor is a RESOURCE until it is a live win condition. The shipped rails
    // fire at 6 honor either way, where nobody is winning or losing on the
    // honor track, and the deck then bids 1 and starves itself of the cards
    // that convert a break. Measured over 17 games: 58 bids were made with a
    // stronghold already open and the honor rails took 35 of them.
    describe('cardsOverHonor', function() {
        const tuned = (extra = {}) => new DrawBidTactics({
            ...DEFAULT_DRAW_BID_PROFILE, cardsOverHonor: true, ...extra
        });
        const open = { myBrokenProvinces: 3, myHonor: 6, opponentHonor: 11 };

        it('reverts to protect-low-honor when switched off', function() {
            const result = new DrawBidTactics({
                ...DEFAULT_DRAW_BID_PROFILE, cardsOverHonor: false
            }).analyze(context(open));

            expect(result.reason).toBe('protect-low-honor');
            expect(result.selectedBid).toBe(1);
        });

        it('spends honor for cards once a stronghold is exposed', function() {
            const result = tuned().analyze(context(open));

            expect(result.reason).toBe('defend-open-stronghold');
            expect(result.selectedBid).toBe(5);
        });

        it('holds when OUR honor win is genuinely close', function() {
            expect(tuned().analyze(context({ ...open, myHonor: 22 })).reason)
                .toBe('pursue-honor-victory');
        });

        it('holds when THEIR honor win is genuinely close', function() {
            expect(tuned().analyze(context({ ...open, myHonor: 11, opponentHonor: 22 })).reason)
                .toBe('deny-opponent-honor-victory');
        });

        it('holds the dishonor squeeze only when they are one push from zero', function() {
            const squeeze = (honor) => context({ ...open, myHonor: 11, opponentHonor: honor });

            expect(tuned().analyze(squeeze(2)).reason).toBe('pressure-opponent-dishonor');
            // At 5 the shipped rail would still bid 1; they cannot be finished
            // this round, so the cards are worth more.
            expect(tuned().analyze(squeeze(5)).reason).toBe('defend-open-stronghold');
        });

        it('never bids into a lethal honor transfer', function() {
            expect(tuned().analyze(context({ ...open, myHonor: 4 })).reason)
                .toBe('protect-low-honor');
        });

        it('waits for an open stronghold unless told otherwise', function() {
            const quiet = context({ myBrokenProvinces: 1, myHonor: 6, opponentHonor: 11 });

            expect(tuned().analyze(quiet).reason).toBe('protect-low-honor');
            expect(tuned({ cardsOverHonorRequiresOpenStronghold: false })
                .analyze(quiet).reason).toBe('cards-over-honor');
        });
    });

    // Regression for the live loss of 2026-08-23. The bot held 8 honor with ONE
    // card left in its conflict deck, bid 5 into an opponent bid of 1, handed
    // over 4 honor and then lost 5 more when the draw reshuffled the discard —
    // 8 - 4 - 5, dead at 0. Every honor rail below reads `myHonor` as if the
    // bid only MOVED honor; past the deck size it also burns a flat 5.
    describe('deck exhaustion', function() {
        // The board this actually happened on: three of our provinces already
        // broken, which sends the shipped profile straight to the maximum bid.
        const nearlyDecked = {
            roundNumber: 7,
            myBrokenProvinces: 3,
            opponentBrokenProvinces: 2,
            myFate: 4,
            opponentHandCount: 13
        };
        // The rule SHIPS on, so `off()` is the arm that reverts it.
        const aware = () => new DrawBidTactics(DEFAULT_DRAW_BID_PROFILE);
        const off = () => new DrawBidTactics({
            ...DEFAULT_DRAW_BID_PROFILE, deckExhaustionAware: false
        });

        it('reproduces the losing bid with the rule off', function() {
            const analysis = off().analyze(context({
                ...nearlyDecked, myHonor: 8, opponentHonor: 8, conflictDeckSize: 1
            }));

            expect(analysis.selectedBid).toBe(5);
            expect(analysis.reason).toBe('defend-open-stronghold');
        });

        // 1-3 cards left x 6-8 honor. Every one of these outdraws the deck at
        // the bid the rails would otherwise pick, so every one is re-bid on the
        // honor left AFTER the five-honor reshuffle penalty — which is at or
        // under the low-honor rail in all nine cases.
        it('bids the floor whenever the deck cannot cover the draw', function() {
            for(const conflictDeckSize of [1, 2, 3]) {
                for(const myHonor of [6, 7, 8]) {
                    const analysis = aware().analyze(context({
                        ...nearlyDecked, myHonor, opponentHonor: 8, conflictDeckSize
                    }));

                    expect(analysis.selectedBid)
                        .withContext(`deck ${conflictDeckSize}, honor ${myHonor}`).toBe(1);
                    expect(analysis.reason)
                        .withContext(`deck ${conflictDeckSize}, honor ${myHonor}`)
                        .toBe('protect-low-honor-deck-exhaustion');
                }
            }
        });

        // The case the user named: one card, six honor. `drawCardsToHand` only
        // reshuffles when the draw is STRICTLY larger than the deck, so bidding
        // 1 into a 1-card deck does not even pay the penalty — and if something
        // else draws first and it does fire, 6 - 5 = 1 still leaves the bot
        // alive with no honor handed to the opponent on top.
        it('survives one card and six honor', function() {
            const analysis = aware().analyze(context({
                ...nearlyDecked, myHonor: 6, opponentHonor: 12, conflictDeckSize: 1
            }));

            expect(analysis.selectedBid).toBe(1);
            expect(analysis.selectedBid).not.toBeGreaterThan(1);
        });

        // A full deck must not notice the rule at all: same bid, same reason,
        // no `-deck-exhaustion` suffix. This is what keeps the change scoped to
        // an almost-empty deck instead of quietly re-tuning every draw phase.
        it('is inert while the deck can cover the bid', function() {
            for(const conflictDeckSize of [5, 12, 30]) {
                for(const myHonor of [6, 8, 11, 15]) {
                    const overrides = { ...nearlyDecked, myHonor, opponentHonor: 8 };
                    const reverted = off().analyze(context(overrides));
                    const on = aware().analyze(context({ ...overrides, conflictDeckSize }));

                    expect(on.selectedBid)
                        .withContext(`deck ${conflictDeckSize}, honor ${myHonor}`)
                        .toBe(reverted.selectedBid);
                    expect(on.reason)
                        .withContext(`deck ${conflictDeckSize}, honor ${myHonor}`)
                        .toBe(reverted.reason);
                }
            }
        });

        // An unknown deck size is the synthetic-caller path. It must behave
        // exactly like the rule being off rather than guessing at exhaustion.
        it('ignores an unknown deck size', function() {
            const overrides = { ...nearlyDecked, myHonor: 8, opponentHonor: 8 };

            expect(aware().analyze(context(overrides)).selectedBid)
                .toBe(off().analyze(context(overrides)).selectedBid);
        });

        it('ships on, so every deck overlay inherits it', function() {
            expect(DEFAULT_DRAW_BID_PROFILE.deckExhaustionAware).toBe(true);
            for(const profile of [
                CARD_ENGINE_DRAW_BID_PROFILE, HONOR_DRAW_BID_PROFILE,
                DISHONOR_DRAW_BID_PROFILE, TOWER_DRAW_BID_PROFILE
            ]) {
                expect(profile.deckExhaustionAware).toBe(true);
            }
        });

        // Honor well clear of the penalty still buys cards: the rule re-bids on
        // `myHonor - 5`, it does not clamp to the floor.
        it('still bids up when the penalty leaves plenty of honor', function() {
            const analysis = aware().analyze(context({
                ...nearlyDecked, myHonor: 18, opponentHonor: 11, conflictDeckSize: 2
            }));

            expect(analysis.selectedBid).toBeGreaterThan(1);
            expect(analysis.reason).toMatch(/-deck-exhaustion$/);
        });
    });

});

describe('LegacyDrawBidTactics', function() {
    const base = {
        roundNumber: 3,
        myHonor: 10,
        opponentHonor: 10,
        myHandCount: 0,
        opponentHandCount: 0,
        myFate: 0,
        opponentFate: 0,
        fateOnUnclaimedRings: 0,
        myBrokenProvinces: 0,
        opponentBrokenProvinces: 0,
        averageConflictCardCost: 0,
        handCardCosts: [],
        board: {
            characterCount: 0,
            readyCharacterCount: 0,
            persistentCharacterCount: 0,
            attachmentCount: 0,
            totalCharacterFate: 0,
            militarySkill: 0,
            politicalSkill: 0
        }
    };

    it('reproduces generic honor tiers and opponent honor caps', function() {
        const legacy = new LegacyDrawBidTactics(DEFAULT_LEGACY_DRAW_BID_PROFILE);
        expect(legacy.analyze({ ...base, myHonor: 10 }).selectedBid).toBe(5);
        expect(legacy.analyze({ ...base, myHonor: 6 }).selectedBid).toBe(3);
        expect(legacy.analyze({ ...base, myHonor: 3 }).selectedBid).toBe(1);
        expect(legacy.analyze({ ...base, opponentHonor: 15 }).selectedBid).toBe(2);
        expect(legacy.analyze({ ...base, opponentHonor: 18 }).selectedBid).toBe(1);
    });

    it('reproduces Lion and Scorpion specialized bids', function() {
        const lion = new LegacyDrawBidTactics(LION_LEGACY_DRAW_BID_PROFILE);
        const scorpion = new LegacyDrawBidTactics(DISHONOR_LEGACY_DRAW_BID_PROFILE);
        expect(lion.analyze({ ...base, roundNumber: 1 }).selectedBid).toBe(5);
        expect(lion.analyze(base).selectedBid).toBe(2);
        expect(lion.analyze({ ...base, myHonor: 4 }).selectedBid).toBe(1);
        expect(scorpion.analyze({ ...base, roundNumber: 1 }).selectedBid).toBe(5);
        expect(scorpion.analyze(base).selectedBid).toBe(1);
    });
});

describe('draw-bid live context', function() {
    const bidButtons = ['1', '2', '3', '4', '5'].map((value) => ({
        text: value, arg: value, uuid: `bid-${value}`
    }));

    it('routes generic, fate-aware, and omniscient policy instances through the selected module', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Honor Bid', menuTitle: 'Choose a bid',
                    buttons: bidButtons, stats: { honor: 11, fate: 0 }, cardPiles: { hand: [] }
                },
                Opponent: {
                    name: 'Opponent', stats: { honor: 11, fate: 5 }, cardPiles: { hand: [] }
                }
            }
        };
        const expensive = {
            ...BASE_CONTEXT_FOR_POLICY,
            myFate: 0,
            averageConflictCardCost: 2,
            handCardCosts: [2, 3, 4]
        };
        const factories = [
            (variant) => new JigokuBotPolicy('seed-2', variant),
            (variant) => new FateAwareJigokuBotPolicy('seed-1', variant),
            (variant) => new FateAwareJigokuBotPolicy('seed-3', variant)
        ];
        for(const factory of factories) {
            expect(factory('adaptive').decide(state, 'Jigoku Bot', {
                profile: DEFAULT_PROFILE,
                roundNumber: 3,
                drawBidContext: expensive
            }).target).toBe('1');
            expect(factory('legacy').decide(state, 'Jigoku Bot', {
                profile: DEFAULT_PROFILE,
                roundNumber: 3,
                drawBidContext: expensive
            }).target).toBe('5');
        }
    });

    it('reads exact deck/hand costs, public economy, ring fate, board, and province progress', function() {
        const character = {
            type: 'character',
            fate: 2,
            bowed: false,
            attachments: [{ id: 'fine-katana' }, { id: 'ornate-fan' }],
            getMilitarySkill: () => 5,
            getPoliticalSkill: () => 4
        };
        const handCards = [
            { printedCost: 0, cardData: { cost: 0 } },
            { printedCost: 3, cardData: { cost: 3 } }
        ];
        const opponent = {
            honor: 7,
            fate: 1,
            hand: { size: () => 3 },
            getProvinces: () => [
                { location: 'province 1', isBroken: true },
                { location: 'province 2', isBroken: false }
            ]
        };
        const player = {
            name: 'Jigoku Bot',
            honor: 12,
            fate: 4,
            opponent,
            hand: { toArray: () => handCards },
            cardsInPlay: { toArray: () => [character] },
            getProvinces: () => [
                { location: 'province 1', isBroken: true },
                { location: 'province 2', isBroken: true },
                { location: 'stronghold province', isBroken: false }
            ]
        };
        const game = {
            roundNumber: 4,
            allCards: [
                { owner: player, isConflict: true, cardData: { side: 'conflict', cost: 0 } },
                { owner: player, isConflict: true, cardData: { side: 'conflict', cost: 2 } },
                { owner: player, isConflict: true, cardData: { side: 'conflict', cost: 4 } }
            ],
            rings: {
                air: { fate: 2, isUnclaimed: () => true },
                earth: { fate: 3, isUnclaimed: () => true },
                fire: { fate: 4, isUnclaimed: () => false }
            }
        };
        const controller = new JigokuBotController(
            game,
            { playerName: player.name, seed: 1 },
            () => true
        );

        const live = controller.drawBidContext(player);
        expect(live.roundNumber).toBe(4);
        expect(live.averageConflictCardCost).toBe(2);
        expect(live.handCardCosts).toEqual([0, 3]);
        expect(live.myHandCount).toBe(2);
        expect(live.opponentHandCount).toBe(3);
        expect(live.fateOnUnclaimedRings).toBe(5);
        expect(live.myBrokenProvinces).toBe(2);
        expect(live.opponentBrokenProvinces).toBe(1);
        expect(live.board.persistentCharacterCount).toBe(1);
        expect(live.board.attachmentCount).toBe(2);
        expect(live.board.militarySkill).toBe(5);
        expect(live.board.politicalSkill).toBe(4);
    });

});
