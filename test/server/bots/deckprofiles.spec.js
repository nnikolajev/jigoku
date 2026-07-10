const { DEFAULT_PROFILE, profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the per-deck profile refactor: profileFromStrategy must reproduce the
// old flag-driven behavior exactly (so Unicorn/Crane are unchanged), and the
// Crab override must apply only to a defensive holding deck.
describe('DeckProfiles', function() {
    const AGGRO = { holdingEngine: false, defensive: false, aggressive: true };
    const GENERIC = { holdingEngine: false, defensive: false, aggressive: false };
    const CRAB = { holdingEngine: true, defensive: true, aggressive: false };

    it('generic deck = the default profile', function() {
        expect(profileFromStrategy(GENERIC)).toEqual(DEFAULT_PROFILE);
        expect(profileFromStrategy(undefined)).toEqual(DEFAULT_PROFILE);
    });

    it('aggressive (Unicorn) keeps the rush knobs', function() {
        const p = profileFromStrategy(AGGRO);
        expect(p.aggressiveFate).toBe(true);
        expect(p.forceMilitaryConflict).toBe(true);
        expect(p.attackCommitment).toBe('all');
        expect(p.defenseCommitment).toBe('win-only');
        expect(p.spendCardsOnDefense).toBe(false);
    });

    it('defensive + holding (Crab) derives turtle knobs before the override', function() {
        const p = profileFromStrategy(CRAB);
        expect(p.mulliganForHoldings).toBe(true);
        expect(p.digWithActions).toBe(true);
        expect(p.attackCommitment).toBe('breakable-or-hold');
        expect(p.defenseCommitment).toBe('prevent-break');
    });

    it('resolveDeckProfile applies the Crab override (pressure + dig gate)', function() {
        const p = resolveDeckProfile(['kaiu-shihei', 'kyuden-hida'], CRAB);
        expect(p.attackCommitment).toBe('breakable-or-pressure');
        expect(p.attackKeepHome).toBe(2);
        expect(p.digMinBoardCharacters).toBe(3);
        // still a holding deck
        expect(p.mulliganForHoldings).toBe(true);
    });

    it('does NOT apply the Crab override to aggressive or generic decks', function() {
        expect(resolveDeckProfile([], AGGRO).attackCommitment).toBe('all');
        expect(resolveDeckProfile([], GENERIC).attackCommitment).toBe('all-but-one');
    });

    it('Unicorn cavalry override keeps the pressure but adds defense and fate', function() {
        const p = resolveDeckProfile(['cavalry-reserves', 'ride-on'], AGGRO);
        expect(p.defenseCommitment).toBe('prevent-break');
        expect(p.spendCardsOnDefense).toBe(true);
        expect(p.attackCommitment).toBe('all-but-one');
        expect(p.aggressiveFate).toBe(false);
        // The rush attack identity stays.
        expect(p.forceMilitaryConflict).toBe(true);
    });

    it('does NOT apply the Unicorn override without the marker card or flag', function() {
        expect(resolveDeckProfile([], AGGRO).defenseCommitment).toBe('win-only');
        expect(resolveDeckProfile(['cavalry-reserves'], GENERIC).defenseCommitment).toBe('prevent-break');
        expect(resolveDeckProfile(['cavalry-reserves'], GENERIC).aggressiveFate).toBe(false);
    });
});
