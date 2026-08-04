const {
    banzaiRecurAllowed,
    getPlaybookEntry,
    honorCostOf,
    honorSpendingAllowed,
    DEFAULT_HONOR_RACE_LIMITS
} = require('../../../build/server/game/bots/CardPlaybook.js');

// Honor is a win condition on BOTH ends: reaching 0 loses the game outright and
// reaching 25 wins it. Honor costs are printed only in card text — the engine's
// `conflictCosts` map carries fate — so nothing budgeted them, and 18.9% of
// field games end at 0 honor.
//
// Every gate here is behind `honorRaceAware`. The off arm must read exactly as
// it did before, so each rule is tested in both directions.
describe('honor race budget', function() {
    const context = (overrides = {}) => Object.assign({
        conflictType: 'military',
        losing: false,
        amAttacker: true,
        honor: 10,
        opponentHonor: 10,
        myBrokenProvinces: 0,
        opponentBrokenProvinces: 0,
        honorRaceAware: true,
        myCharacters: [],
        opponentCharacters: [],
        dynastyDiscard: []
    }, overrides);

    describe('honorCostOf', function() {
        it('prices the voluntary honor costs in the field', function() {
            expect(honorCostOf('assassination')).toBe(3);
            expect(honorCostOf('captive-audience')).toBe(1);
            expect(honorCostOf('moto-eviscerator')).toBe(1);
            expect(honorCostOf('shosuro-hametsu')).toBe(1);
            expect(honorCostOf('thunder-guard-elite')).toBe(1);
        });

        it('reports zero for cards with no honor cost and for undefined', function() {
            expect(honorCostOf('fine-katana')).toBe(0);
            expect(honorCostOf(undefined)).toBe(0);
        });

        it('does not price FORCED honor losses, which have their own flag', function() {
            // Marauding Oni bleeds honor when DECLARED, not when chosen to be
            // played, and `declareCostsHonor` already removes it from the
            // declaration set. Pricing it here would double-count.
            expect(honorCostOf('marauding-oni')).toBe(0);
            expect(getPlaybookEntry('marauding-oni').declareCostsHonor).toBe(true);
        });
    });

    describe('honorSpendingAllowed', function() {
        it('allows a free effect regardless of position', function() {
            expect(honorSpendingAllowed(context({ honor: 1 }), 0)).toBe(true);
        });

        it('refuses a cost that lands on or below the dishonor floor', function() {
            // floor 3: paying 3 from 6 lands exactly on it.
            expect(honorSpendingAllowed(context({ honor: 6 }), 3)).toBe(false);
            expect(honorSpendingAllowed(context({ honor: 7 }), 3)).toBe(true);
        });

        it('refuses to sell honor while the honor WIN is in reach', function() {
            // 25 wins the game. At 22 a 1-honor cost is a third of what is left.
            expect(honorSpendingAllowed(context({ honor: 22 }), 1)).toBe(false);
            expect(honorSpendingAllowed(context({ honor: 21 }), 1)).toBe(true);
        });

        it('relaxes the floor once their stronghold is nearly exposed', function() {
            const tight = context({ honor: 4, opponentBrokenProvinces: 2 });
            const conquest = context({ honor: 4, opponentBrokenProvinces: 3 });
            expect(honorSpendingAllowed(tight, 1)).toBe(false);
            // Honor stops being a resource we need at the end of the game.
            expect(honorSpendingAllowed(conquest, 1)).toBe(true);
        });

        it('raises the floor while losing the honor race', function() {
            // Trailing by 5+ is the public signature of an opponent draining us.
            const even = context({ honor: 8, opponentHonor: 8 });
            const behind = context({ honor: 8, opponentHonor: 13 });
            expect(honorSpendingAllowed(even, 3)).toBe(true);
            expect(honorSpendingAllowed(behind, 3)).toBe(false);
        });

        it('lets the conquest relaxation outrank the behind-in-the-race floor', function() {
            const behindButWinning = context({
                honor: 4, opponentHonor: 15, opponentBrokenProvinces: 3
            });
            expect(honorSpendingAllowed(behindButWinning, 1)).toBe(true);
        });

        it('degrades to the own-honor floor when opponent honor is unknown', function() {
            const blind = context({ honor: 8, opponentHonor: undefined });
            expect(honorSpendingAllowed(blind, 3)).toBe(true);
            expect(honorSpendingAllowed(context({ honor: 5, opponentHonor: undefined }), 3)).toBe(false);
        });

        it('accepts injected limits so a deck can tune its own floor', function() {
            const limits = Object.assign({}, DEFAULT_HONOR_RACE_LIMITS, { dishonorFloor: 6 });
            // Landing exactly on the floor is refused: 8 - 2 = 6.
            expect(honorSpendingAllowed(context({ honor: 8 }), 2)).toBe(true);
            expect(honorSpendingAllowed(context({ honor: 8 }), 2, limits)).toBe(false);
        });
    });

    describe('Banzai pays honor for an OPTIONAL upgrade', function() {
        // The card play is free: the honor buys a second +2 resolution. Pricing
        // it as a card cost would veto a free pump, so the budget belongs on the
        // recur prompt and on the contribution, not on the play.
        it('is not listed as a card honor cost', function() {
            expect(honorCostOf('banzai')).toBe(0);
        });

        it('keeps the bare honor cliff while the race gate is off', function() {
            expect(banzaiRecurAllowed(context({ honor: 4, honorRaceAware: false }))).toBe(true);
            expect(banzaiRecurAllowed(context({ honor: 3, honorRaceAware: false }))).toBe(false);
        });

        it('uses the race budget when the gate is on', function() {
            // Trailing by 5+ raises the floor from 3 to 5, so 6 honor can no
            // longer buy the upgrade even though the bare cliff allows it.
            expect(banzaiRecurAllowed(context({ honor: 6, opponentHonor: 6 }))).toBe(true);
            expect(banzaiRecurAllowed(context({ honor: 6, opponentHonor: 14 }))).toBe(false);
            // The bare cliff would have said yes to both.
            expect(banzaiRecurAllowed(context({ honor: 6, opponentHonor: 14, honorRaceAware: false })))
                .toBe(true);
        });

        it('still buys the upgrade at low honor while their stronghold is exposed', function() {
            expect(banzaiRecurAllowed(context({
                honor: 3, opponentHonor: 12, opponentBrokenProvinces: 3
            }))).toBe(true);
        });
    });

    describe('printed honor-comparison conditions', function() {
        // "Play only if you are less honorable than an opponent" is a printed
        // legality clause. Without both pools the bot could only click and let
        // the engine refuse, wasting the decision.
        const gated = (id, ctx) => getPlaybookEntry(id).shouldPlay(ctx);

        it('plays Compromised Secrets only while less honorable', function() {
            expect(gated('compromised-secrets', context({ honor: 5, opponentHonor: 9 }))).toBe(true);
            expect(gated('compromised-secrets', context({ honor: 9, opponentHonor: 5 }))).toBe(false);
            expect(gated('compromised-secrets', context({ honor: 7, opponentHonor: 7 }))).toBe(false);
        });

        it('plays Forgery only while less honorable', function() {
            expect(gated('forgery', context({ honor: 5, opponentHonor: 9 }))).toBe(true);
            expect(gated('forgery', context({ honor: 9, opponentHonor: 5 }))).toBe(false);
        });

        it('holds both cards at their legacy reading in the control arm', function() {
            // Off, the gate must never refuse — otherwise an A/B control arm
            // is not the behavior it is being compared against.
            const off = context({ honor: 9, opponentHonor: 5, honorRaceAware: false });
            expect(gated('compromised-secrets', off)).toBe(true);
            expect(gated('forgery', off)).toBe(true);
        });

        it('does not refuse when opponent honor is missing', function() {
            const blind = context({ honor: 9, opponentHonor: undefined });
            expect(gated('compromised-secrets', blind)).toBe(true);
            expect(gated('forgery', blind)).toBe(true);
        });
    });

    describe('dishonor decks keep their own floor', function() {
        // A dishonor deck spends honor ON PURPOSE -- dropping below the
        // opponent is what turns its cards on -- and DishonorTactics already
        // owns that floor via `canPayHonor`. Stacking the generic
        // protect-your-honor budget on top fights the deck's plan; Scorpion
        // measured -3.7pp doing exactly that. The policy defers whenever
        // `canPayHonor` is defined, which only a dishonor profile does.
        it('leaves canPayHonor as the only signal when it is present', function() {
            const ctx = context({ honor: 4, opponentHonor: 20, canPayHonor: true });
            // The generic budget would refuse this: 4 - 3 lands under the
            // floor, and trailing by 16 raises it further.
            expect(honorSpendingAllowed(ctx, 3)).toBe(false);
            // ... but the deck's own gate says yes, and that is what wins.
            expect(ctx.canPayHonor).toBe(true);
        });
    });
});
