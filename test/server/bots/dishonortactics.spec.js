const { DishonorTactics, DISHONOR_DEFAULTS } = require('../../../build/server/game/bots/DishonorTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile, DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the dishonor/mill layer (Scorpion Poison Mill): strategy derivation,
// profile gating (no other deck gets the tactics), and the tactic decisions.
describe('DishonorTactics', function() {
    const tactics = new DishonorTactics(DISHONOR_DEFAULTS);

    describe('strategy derivation', function() {
        it('flips dishonor on for the Scorpion mill cards', function() {
            const strategy = deriveDeckStrategy(['city-of-the-open-hand', 'ornate-fan']);
            expect(strategy.dishonor).toBe(true);
        });

        it('stays off for Unicorn / Crab / Crane style decks', function() {
            expect(deriveDeckStrategy(['cavalry-reserves', 'ride-on', 'spoils-of-war', 'curved-blade']).dishonor).toBe(false);
            expect(deriveDeckStrategy(['kyuden-hida', 'kaiu-forges', 'hida-kotoe', 'staunch-hida', 'hida-o-ushi']).dishonor).toBe(false);
            expect(deriveDeckStrategy([]).dishonor).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a dishonor strategy carries the dishonor knobs', function() {
            const dishonorProfile = profileFromStrategy({ holdingEngine: false, defensive: false, aggressive: false, dishonor: true });
            expect(dishonorProfile.dishonor).toEqual(DISHONOR_DEFAULTS);
            // Generic attack/defense knobs stay at the default (defend to
            // prevent breaks, spend cards on defense).
            expect(dishonorProfile.attackCommitment).toBe(DEFAULT_PROFILE.attackCommitment);
            expect(dishonorProfile.spendCardsOnDefense).toBe(true);

            expect(profileFromStrategy({ holdingEngine: false, defensive: false, aggressive: true, dishonor: false }).dishonor).toBeUndefined();
            expect(profileFromStrategy(undefined).dishonor).toBeUndefined();
        });

        it('Scorpion override parks Night Raid under the stronghold', function() {
            const DISHONOR = { holdingEngine: false, defensive: false, aggressive: false, dishonor: true };
            expect(resolveDeckProfile(['night-raid', 'city-of-the-open-hand'], DISHONOR).strongholdProvinceId).toBe('night-raid');
            // Not without the card, not for other strategies.
            expect(resolveDeckProfile(['city-of-the-open-hand'], DISHONOR).strongholdProvinceId).toBeUndefined();
            expect(resolveDeckProfile(['night-raid'], { holdingEngine: false, defensive: false, aggressive: true, dishonor: false }).strongholdProvinceId).toBeUndefined();
        });
    });

    describe('honor dial', function() {
        it('bids high on the first round, low afterwards (draw phase and duels)', function() {
            expect(tactics.desiredBid(1, 10)).toBe(5);
            expect(tactics.desiredBid(2, 10)).toBe(1);
            expect(tactics.desiredBid(7, 4)).toBe(1);
            expect(tactics.desiredBid(undefined, 10)).toBe(1);
        });

        it('never bids high while at the honor floor', function() {
            expect(tactics.desiredBid(1, 3)).toBe(1);
        });
    });

    describe('honor band', function() {
        it('takes honor with the air ring unless own honor needs the rescue', function() {
            expect(tactics.preferTakeHonor(6)).toBe(true);
            expect(tactics.preferTakeHonor(3)).toBe(false);
        });

        it('climbs with the stronghold only inside the band', function() {
            expect(tactics.shouldGainStrongholdHonor(4)).toBe(true);
            expect(tactics.shouldGainStrongholdHonor(6)).toBe(false);
        });

        it('stops paying honor costs at the floor', function() {
            expect(tactics.canPayHonor(4)).toBe(true);
            expect(tactics.canPayHonor(3)).toBe(false);
        });
    });

    describe('important dynasty characters', function() {
        it('prioritizes Bayushi Shoju when he can receive two fate unless one is already in play', function() {
            const shoju = { uuid: 'shoju', id: 'bayushi-shoju-2' };
            const cheap = { uuid: 'cheap', id: 'palace-guard' };
            const costs = { shoju: 5, cheap: 1 };

            expect(tactics.pickImportantDynastyCharacter([cheap, shoju], costs, 7, [])).toBe(shoju);
            expect(tactics.pickImportantDynastyCharacter([cheap, shoju], costs, 5, [])).toBeNull();
            expect(tactics.pickImportantDynastyCharacter([cheap, shoju], costs, 4, [])).toBeNull();
            expect(tactics.pickImportantDynastyCharacter(
                [cheap, shoju], costs, 7, [{ id: 'bayushi-shoju-2' }]
            )).toBeNull();
        });

        it('keeps Bayushi Shoju for two extra rounds without treating him as a tower', function() {
            expect(tactics.desiredAdditionalFate('bayushi-shoju-2')).toBe(2);
            expect(tactics.desiredAdditionalFate('shosuro-hametsu')).toBeNull();
        });
    });

    describe('select prompts', function() {
        it('mills the opponent conflict deck with Deserted Shrine', function() {
            const buttons = [
                { text: 'Bot\'s Dynasty' }, { text: 'Bot\'s Conflict' },
                { text: 'Human\'s Dynasty' }, { text: 'Human\'s Conflict' }
            ];
            expect(tactics.pickDeckButton(buttons, 'Bot').text).toBe('Human\'s Conflict');
        });

        it('aims Master Whisperer at the opponent', function() {
            const buttons = [{ text: 'Bot' }, { text: 'Human' }];
            expect(tactics.pickOpponentButton(buttons, 'Human').text).toBe('Human');
            expect(tactics.pickOpponentButton(buttons, undefined)).toBeNull();
        });
    });
});
