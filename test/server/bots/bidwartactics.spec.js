const {
    BidWarTactics,
    BID_WAR_DEFAULTS,
    parseHandDiscardOptions
} = require('../../../build/server/game/bots/BidWarTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const {
    profileFromStrategy,
    resolveDeckProfile,
    DEFAULT_PROFILE
} = require('../../../build/server/game/bots/DeckProfiles.js');
const { PersonalHonorTactics, PERSONAL_HONOR_DEFAULTS } = require('../../../build/server/game/bots/PersonalHonorTactics.js');
const { getCardModel } = require('../../../build/server/game/bots/DeckAnalysis.js');
const { loadScorpionBidWarDeck, loadScorpionDeck, loadCraneDeck } = require('../../../tools/selfplay/deckLoader.js');

// Locks the honor-dial layer (Scorpion "Bid War", Kyuden Bayushi): strategy
// derivation, profile gating (no other deck gets the tactics), the dial
// readings that every deck card hangs off, and the two rankings that look at
// cards the bot does not own — Upholding Authority's hand strip and Bayushi
// Kachiko's replay of the opponent's discarded events.
describe('BidWarTactics', function() {
    const tactics = new BidWarTactics(BID_WAR_DEFAULTS);
    const deckIds = (deck) => [
        ...(deck.stronghold || []),
        ...(deck.role || []),
        ...(deck.provinceCards || []),
        ...(deck.dynastyCards || []),
        ...(deck.conflictCards || [])
    ].map((entry) => entry.card.id);

    const character = (overrides = {}) => Object.assign({
        uuid: overrides.id || 'uuid-1',
        type: 'character',
        inConflict: false,
        bowed: false,
        isDishonored: false,
        isHonored: false,
        fate: 0
    }, overrides);

    describe('strategy derivation', function() {
        it('flips bidWar on for the Kyuden Bayushi list', function() {
            expect(deriveDeckStrategy(deckIds(loadScorpionBidWarDeck())).bidWar).toBe(true);
        });

        it('stays off for the separate Scorpion Poison Mill list', function() {
            // Poison Mill shares five bid-war markers (Make an Opening, Duty,
            // Forgery, Shadow Stalker, Blackmail Artist). It must keep its own
            // dishonor profile, so the count threshold sits above that.
            const strategy = deriveDeckStrategy(deckIds(loadScorpionDeck()));
            expect(strategy.bidWar).toBe(false);
            expect(strategy.dishonor).toBe(true);
        });

        it('stays off for Crane and for an empty deck', function() {
            expect(deriveDeckStrategy(deckIds(loadCraneDeck())).bidWar).toBe(false);
            expect(deriveDeckStrategy([]).bidWar).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a bidWar strategy carries the bid-war knobs', function() {
            const profile = profileFromStrategy({ bidWar: true });
            expect(profile.bidWar).toEqual(BID_WAR_DEFAULTS);
            expect(profile.bidWarAware).toBe(true);
            expect(DEFAULT_PROFILE.bidWar).toBeUndefined();
            expect(DEFAULT_PROFILE.bidWarAware).toBe(false);
            expect(profileFromStrategy({ dishonor: true }).bidWar).toBeUndefined();
            expect(profileFromStrategy().bidWar).toBeUndefined();
        });

        it('never protects honor above genuine lethal range', function() {
            // The deck WANTS to be at 6 or fewer honor; the generic rail bids 1
            // there and turns off half the card pool.
            const profile = profileFromStrategy({ bidWar: true });
            expect(profile.drawBidding.lowHonorThreshold).toBe(BID_WAR_DEFAULTS.lethalHonorFloor);
            expect(DEFAULT_PROFILE.drawBidding.lowHonorThreshold).toBe(6);
        });

        it('resolves the deck override for the real decklist', function() {
            const ids = deckIds(loadScorpionBidWarDeck());
            const profile = resolveDeckProfile(ids, deriveDeckStrategy(ids));
            expect(profile.bidWar).toBeDefined();
            expect(profile.strongholdProvinceId).toBe('honor-s-reward');
            expect(profile.personalHonor.reverseHonorCardIds).toContain('shosuro-sadako');
            expect(profile.personalHonor.ownDishonorCostSourceIds).toContain('calling-in-favors');
        });

        it('gives each resolved deck its own nested bid-war object', function() {
            const ids = deckIds(loadScorpionBidWarDeck());
            const first = resolveDeckProfile(ids, deriveDeckStrategy(ids));
            const second = resolveDeckProfile(ids, deriveDeckStrategy(ids));
            first.bidWar.reverseHonorCardIds.push('leak');
            expect(second.bidWar.reverseHonorCardIds).not.toContain('leak');
        });
    });

    describe('draw bidding', function() {
        const context = (overrides = {}) => Object.assign({
            roundNumber: 3,
            myHonor: 10,
            opponentHonor: 11,
            myHandCount: 5,
            highDialPayoffCards: 0,
            opponentHighDialPayoffCards: 0
        }, overrides);

        it('bids the maximum on the opening round', function() {
            expect(tactics.adjustDrawBid(1, context({ roundNumber: 1 }))).toBe(BID_WAR_DEFAULTS.openingBid);
        });

        it('drops to the rescue bid in lethal range and recovers below the floor', function() {
            expect(tactics.adjustDrawBid(5, context({ myHonor: 2 }))).toBe(BID_WAR_DEFAULTS.rescueBid);
            expect(tactics.adjustDrawBid(5, context({ myHonor: 3 }))).toBe(BID_WAR_DEFAULTS.recoveryBid);
            // At the floor itself the deck is where it wants to be.
            expect(tactics.adjustDrawBid(5, context({ myHonor: BID_WAR_DEFAULTS.bandFloor })))
                .toBe(BID_WAR_DEFAULTS.inBandBid);
        });

        it('bids high above the band ceiling: cards, and honor it wants gone', function() {
            expect(tactics.adjustDrawBid(2, context({ myHonor: 10 }))).toBe(BID_WAR_DEFAULTS.descendBid);
        });

        it('bids LOW below the band floor so the opponent pays us back', function() {
            expect(tactics.adjustDrawBid(5, context({ myHonor: 3 }))).toBe(BID_WAR_DEFAULTS.recoveryBid);
        });

        it('holds level inside the band instead of paying honor every round', function() {
            expect(tactics.adjustDrawBid(5, context({ myHonor: 5 }))).toBe(BID_WAR_DEFAULTS.inBandBid);
        });

        it('raises inside the band for I Can Swim only with room above the floor', function() {
            expect(tactics.adjustDrawBid(1, context({ myHonor: 6, highDialPayoffCards: 1 })))
                .toBe(BID_WAR_DEFAULTS.highDialPayoffBid);
            expect(tactics.adjustDrawBid(1, context({ myHonor: 4, highDialPayoffCards: 1 })))
                .toBe(BID_WAR_DEFAULTS.inBandBid);
        });

        it('never feeds an opponent close to the dishonor loss or the honor win', function() {
            expect(tactics.adjustDrawBid(5, context({ myHonor: 10, opponentHonor: 5 })))
                .toBe(BID_WAR_DEFAULTS.inBandBid);
            expect(tactics.adjustDrawBid(5, context({ myHonor: 10, opponentHonor: 22 })))
                .toBe(BID_WAR_DEFAULTS.inBandBid);
        });
    });

    describe('Bayushi Manipulator', function() {
        it('takes the extra card and the extra honor paid while safe', function() {
            expect(tactics.shouldModifyBid(10, 5)).toBe(true);
        });

        it('declines near the honor floor or on a saturated hand', function() {
            expect(tactics.shouldModifyBid(3, 5)).toBe(false);
            expect(tactics.shouldModifyBid(10, 12)).toBe(false);
        });
    });

    describe('dial readings', function() {
        it('reads no gap before the dials are shown', function() {
            expect(tactics.dialDifference(0, 0)).toBe(0);
            expect(tactics.dialDifference(5, undefined)).toBe(0);
        });

        it('swaps dials to turn on I Can Swim when we bid low', function() {
            const hand = [{ id: 'i-can-swim' }];
            const dishonored = [character({ id: 'a', inConflict: true, isDishonored: true })];
            expect(tactics.shouldSwitchDials(1, 5, hand, dishonored)).toBe(true);
            // Nothing to turn on: no dishonored participant.
            expect(tactics.shouldSwitchDials(1, 5, hand, [])).toBe(false);
            // Equal dials cannot be swapped for value.
            expect(tactics.shouldSwitchDials(3, 3, hand, dishonored)).toBe(false);
        });
    });

    describe('Kyuden Bayushi', function() {
        it('readies a bowed dishonored body worth standing up', function() {
            const board = [character({ id: 'shadow-stalker', bowed: true, isDishonored: true, military: 2, political: 0 })];
            expect(tactics.shouldUseStronghold(board, 5, true)).toBe(true);
        });

        it('does not bow the stronghold with nothing dishonored, or nothing bowed', function() {
            expect(tactics.shouldUseStronghold([character({ id: 'a', bowed: true })], 5, true)).toBe(false);
            // Ready + dishonored buys only the +1/+1, and the shared ready
            // selector cancels an ability with no bowed own body.
            expect(tactics.shouldUseStronghold(
                [character({ id: 'a', inConflict: true, isDishonored: true, military: 3 })], 5, true
            )).toBe(false);
        });

    });

    describe('Upholding Authority hand strip', function() {
        const button = (cardId, text) => ({ arg: cardId, text, card: { id: cardId } });
        const power = (cardId) => {
            const model = getCardModel(cardId);
            if(!model) {
                return { swing: 0, fate: 0, type: 'unknown', known: false };
            }
            return {
                swing: Math.max(model.swing, Math.max(model.mil + model.milBonus, model.pol + model.polBonus)),
                fate: model.fate,
                type: model.type,
                known: true
            };
        };

        it('parses the copy count out of the collapsed button text', function() {
            const options = parseHandDiscardOptions([
                button('assassination', 'Assassination (2)'),
                button('banzai', 'Banzai!'),
                { arg: '0', text: 'Don\'t discard anything' }
            ]);
            expect(options.map((option) => [option.cardId, option.copies]))
                .toEqual([['assassination', 2], ['banzai', 1]]);
        });

        it('takes the single strongest card when copies are equal', function() {
            const pick = tactics.pickHandDiscard(
                [button('assassination', 'Assassination'), button('banzai', 'Banzai!')],
                power,
                5
            );
            expect(pick.cardId).toBe('assassination');
        });

        it('lets two copies of a weaker card beat one copy of a stronger one', function() {
            // Assassination swings 4; Banzai swings 4 as well but two copies
            // are worth strictly more than one, which is the whole point of a
            // "discard any number of copies" effect.
            const pick = tactics.pickHandDiscard(
                [button('assassination', 'Assassination'), button('banzai', 'Banzai! (2)')],
                power,
                5
            );
            expect(pick.cardId).toBe('banzai');
            expect(pick.copies).toBe(2);
        });

        it('always discards every copy at the follow-up count menu', function() {
            const chosen = tactics.pickHandDiscardCount([
                { text: '1', arg: '0' },
                { text: '2', arg: '1' },
                { text: '3', arg: '2' }
            ]);
            expect(chosen.text).toBe('3');
        });

        it('returns null when the menu has only choice buttons', function() {
            expect(tactics.pickHandDiscard([{ arg: '0', text: 'Don\'t discard anything' }], power, 5)).toBeNull();
        });
    });

    describe('Bayushi Kachiko replays', function() {
        const power = (cardId) => {
            const model = getCardModel(cardId);
            return model
                ? { swing: model.swing, fate: model.fate, type: model.type, known: true }
                : { swing: 0, fate: 0, type: 'unknown', known: false };
        };
        const event = (id) => ({ id, uuid: `uuid-${id}`, type: 'event' });

        it('only fires while she participates in a POLITICAL conflict', function() {
            const board = [character({ id: 'bayushi-kachiko-2', inConflict: true })];
            expect(tactics.kachikoParticipating(board, 'political')).toBe(true);
            expect(tactics.kachikoParticipating(board, 'military')).toBe(false);
            expect(tactics.kachikoParticipating(
                [character({ id: 'bayushi-kachiko-2' })], 'political'
            )).toBe(false);
        });

        it('ranks the opponent\'s discarded events by what they do for us', function() {
            const ranked = tactics.rankOpponentDiscardEvents(
                [event('let-go'), event('assassination'), event('banzai')],
                power
            );
            // Assassination (swing 4) and Banzai (4) outrank Let Go (2); the
            // tie breaks on fate cost then id, so both stay ahead of Let Go.
            expect(ranked.map((card) => card.id).slice(0, 2).sort())
                .toEqual(['assassination', 'banzai']);
            expect(ranked[ranked.length - 1].id).toBe('let-go');
        });

        it('refuses events that do nothing on our side of the table', function() {
            // Gossip and Rebuild are modeled at zero conflict swing.
            expect(tactics.rankOpponentDiscardEvents([event('gossip'), event('rebuild')], power)).toEqual([]);
        });

        it('ignores non-events in the pile', function() {
            const ranked = tactics.rankOpponentDiscardEvents(
                [{ id: 'fine-katana', uuid: 'u', type: 'attachment' }, event('assassination')],
                power
            );
            expect(ranked.map((card) => card.id)).toEqual(['assassination']);
        });

        it('stops offering replays once the three-per-round budget is spent', function() {
            expect(tactics.rankOpponentDiscardEvents([event('assassination')], power, { replaysUsed: 3 }))
                .toEqual([]);
            expect(tactics.rankOpponentDiscardEvents([event('assassination')], power, { replaysUsed: 2 }).length)
                .toBe(1);
        });

        it('honours an external playability filter', function() {
            const ranked = tactics.rankOpponentDiscardEvents(
                [event('assassination'), event('banzai')],
                power,
                { playable: (card) => card.id === 'banzai' }
            );
            expect(ranked.map((card) => card.id)).toEqual(['banzai']);
        });
    });

    describe('Shosuro Sadako (reverse honor modifier)', function() {
        it('is the preferred target for a forced own dishonor', function() {
            const honor = new PersonalHonorTactics({
                ...PERSONAL_HONOR_DEFAULTS,
                reverseHonorCardIds: ['shosuro-sadako']
            });
            const board = [
                character({ id: 'court-novice', uuid: 'u1', glory: 0 }),
                character({ id: 'shosuro-sadako', uuid: 'u2', glory: 3 })
            ];
            expect(honor.pickForcedOwnDishonor(board).id).toBe('shosuro-sadako');
        });

        it('keeps the lowest-glory rule for every other deck', function() {
            const honor = new PersonalHonorTactics(PERSONAL_HONOR_DEFAULTS);
            const board = [
                character({ id: 'court-novice', uuid: 'u1', glory: 0 }),
                character({ id: 'shosuro-sadako', uuid: 'u2', glory: 3 })
            ];
            expect(honor.pickForcedOwnDishonor(board).id).toBe('court-novice');
        });

        it('marks friendly-dishonor COST sources so they are not cancelled', function() {
            const honor = new PersonalHonorTactics({
                ...PERSONAL_HONOR_DEFAULTS,
                ownDishonorCostSourceIds: ['calling-in-favors', 'acclaimed-geisha-house']
            });
            expect(honor.isOwnDishonorCost('calling-in-favors')).toBe(true);
            expect(honor.isOwnDishonorCost('way-of-the-scorpion')).toBe(false);
            expect(new PersonalHonorTactics(PERSONAL_HONOR_DEFAULTS).isOwnDishonorCost('calling-in-favors'))
                .toBe(false);
        });
    });

    describe('Acclaimed Geisha House / Elegant Tessen / dynasty events', function() {
        it('pays the ring switch with a character that wants to be dishonored', function() {
            const sadako = character({ id: 'shosuro-sadako', inConflict: true, glory: 3 });
            expect(tactics.shouldUseGeishaHouse([sadako], true)).toBe(true);
            // A glory-3 courtier would really lose skill: refuse.
            const courtier = character({ id: 'social-puppeteer', inConflict: true, glorySummary: { stat: 1 } });
            expect(tactics.shouldUseGeishaHouse([courtier], true)).toBe(false);
            expect(tactics.shouldUseGeishaHouse([sadako], false)).toBe(false);
        });

        it('readies a bowed cheap courtier with Elegant Tessen', function() {
            const board = [
                character({ id: 'court-novice', uuid: 'u1', bowed: true, printedCost: 1, military: 1, political: 1 }),
                character({ id: 'bayushi-kachiko-2', uuid: 'u2', bowed: true, printedCost: 5, political: 6 })
            ];
            const target = tactics.pickTessenTarget(board, (card) => Number(card.political) || 0);
            expect(target.id).toBe('court-novice');
            expect(tactics.pickTessenSetup([{ id: 'elegant-tessen' }], board).id).toBe('elegant-tessen');
            // Nothing bowed and cheap: hold the card.
            expect(tactics.pickTessenSetup([{ id: 'elegant-tessen' }], [])).toBeNull();
        });

        it('spends Dispatch to Nowhere only on a real fateless body', function() {
            const dispatch = { id: 'dispatch-to-nowhere', uuid: 'd1', type: 'event' };
            const costs = { d1: 1 };
            const target = character({ id: 'doji-kuwanan', fate: 0, military: 5, political: 4 });
            expect(tactics.pickDynastyEvent([dispatch], costs, 3, [target], 3).card.id)
                .toBe('dispatch-to-nowhere');
            // Fate on the body: not a legal target.
            expect(tactics.pickDynastyEvent([dispatch], costs, 3, [character({ fate: 1, military: 5 })], 3))
                .toBeNull();
            // Cannot pay for it.
            expect(tactics.pickDynastyEvent([dispatch], costs, 0, [target], 3)).toBeNull();
        });

        it('rerolls with A Season of War only on a dead province row', function() {
            const season = { id: 'a-season-of-war', uuid: 's1', type: 'event' };
            expect(tactics.pickDynastyEvent([season], { s1: 1 }, 3, [], 0).reason)
                .toBe('bid-war-play-season-of-war-reroll');
            expect(tactics.pickDynastyEvent([season], { s1: 1 }, 3, [], 4)).toBeNull();
        });
    });

    describe('playbook entries', function() {
        const ctx = (overrides = {}) => Object.assign({
            conflictType: 'political',
            losing: false,
            amAttacker: true,
            honor: 5,
            myCharacters: [],
            opponentCharacters: [],
            dynastyDiscard: [],
            hand: [],
            myBid: 0,
            opponentBid: 0,
            bidWarAware: true
        }, overrides);

        it('holds I Can Swim until the dial gap and a dishonored body exist', function() {
            const entry = getPlaybookEntry('i-can-swim');
            const dishonored = [character({ id: 'a', inConflict: true, isDishonored: true, political: 4 })];
            expect(entry.shouldPlay(ctx({ myBid: 5, opponentBid: 1, opponentCharacters: dishonored }))).toBe(true);
            expect(entry.shouldPlay(ctx({ myBid: 1, opponentBid: 5, opponentCharacters: dishonored }))).toBe(false);
            expect(entry.shouldPlay(ctx({ myBid: 5, opponentBid: 1 }))).toBe(false);
            // Dials not shown yet.
            expect(entry.shouldPlay(ctx({ opponentCharacters: dishonored }))).toBe(false);
        });

        it('holds Regal Bearing without a participating courtier or a real draw', function() {
            const entry = getPlaybookEntry('regal-bearing');
            const courtier = character({ id: 'court-novice', inConflict: true, traits: ['courtier'] });
            expect(entry.shouldPlay(ctx({ opponentBid: 5, myCharacters: [courtier] }))).toBe(true);
            expect(entry.shouldPlay(ctx({ opponentBid: 2, myCharacters: [courtier] }))).toBe(false);
            expect(entry.shouldPlay(ctx({ opponentBid: 5 }))).toBe(false);
            expect(entry.shouldPlay(ctx({
                conflictType: 'military', opponentBid: 5, myCharacters: [courtier]
            }))).toBe(false);
        });

        it('reads Make an Opening off the live dials only for bid-war decks', function() {
            const entry = getPlaybookEntry('make-an-opening');
            const enemy = [character({ id: 'a', inConflict: true, political: 4 })];
            expect(entry.shouldPlay(ctx({ opponentCharacters: enemy, myBid: 5, opponentBid: 1 }))).toBe(true);
            expect(entry.shouldPlay(ctx({ opponentCharacters: enemy, myBid: 3, opponentBid: 3 }))).toBe(false);
            // Every other deck keeps the legacy reading bit-identical.
            expect(entry.shouldPlay(ctx({
                opponentCharacters: enemy, myBid: 3, opponentBid: 3, bidWarAware: false
            }))).toBe(true);
            expect(entry.conflictContribution(ctx({
                opponentCharacters: enemy, myBid: 3, opponentBid: 3, bidWarAware: false
            }))).toBeNull();
        });

        it('digs with Alibi Artist only inside the band and with room in hand', function() {
            const entry = getPlaybookEntry('alibi-artist');
            expect(entry.shouldUseAction(ctx({ honor: 6, hand: [] }))).toBe(true);
            expect(entry.shouldUseAction(ctx({ honor: 7, hand: [] }))).toBe(false);
            expect(entry.shouldUseAction(ctx({ honor: 6, hand: new Array(10).fill({}) }))).toBe(false);
        });

        it('bows Yogo Asami only in a military conflict with a target', function() {
            const entry = getPlaybookEntry('yogo-asami');
            const asami = character({ id: 'yogo-asami', inConflict: true });
            const enemy = [character({ id: 'e', inConflict: true, military: 3 })];
            expect(entry.shouldUseAction(ctx({
                conflictType: 'military', myCharacters: [asami], opponentCharacters: enemy
            }))).toBe(true);
            // Political: bowing her throws away 3 political skill.
            expect(entry.shouldUseAction(ctx({
                conflictType: 'political', myCharacters: [asami], opponentCharacters: enemy
            }))).toBe(false);
        });
    });
});
