const { DEFAULT_PROFILE, profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the per-deck profile refactor: profileFromStrategy must reproduce the
// old flag-driven behavior exactly (so Unicorn/Crane are unchanged), and the
// Crab override must apply only to a defensive holding deck.
describe('DeckProfiles', function() {
    const AGGRO = { holdingEngine: false, defensive: false, aggressive: true };
    const GENERIC = { holdingEngine: false, defensive: false, aggressive: false };
    const CRAB = { holdingEngine: true, defensive: true, aggressive: false };
    const SHUGENJA = { holdingEngine: false, defensive: false, aggressive: false, shugenja: true };

    it('generic deck = the default profile', function() {
        expect(profileFromStrategy(GENERIC)).toEqual(DEFAULT_PROFILE);
        expect(profileFromStrategy(undefined)).toEqual(DEFAULT_PROFILE);
    });

    it('clones injectable conflict economy knobs per resolved profile', function() {
        const first = profileFromStrategy(GENERIC);
        const second = profileFromStrategy(GENERIC);
        first.conflictCardEconomy.priorityWeight = 99;
        first.strongholdDefense.skillBuffer = 99;
        first.personalHonor.persistentCharacterFate = 99;
        first.duelBidding.duelWinUtility = 99;
        first.provinceTargeting.effectiveStrengthById['public-forum'] = 99;
        first.provinceTargeting.priorityTierById.tsuma = -99;

        expect(second.conflictCardEconomy.priorityWeight).toBe(DEFAULT_PROFILE.conflictCardEconomy.priorityWeight);
        expect(DEFAULT_PROFILE.conflictCardEconomy.priorityWeight).not.toBe(99);
        expect(second.strongholdDefense.skillBuffer).toBe(DEFAULT_PROFILE.strongholdDefense.skillBuffer);
        expect(DEFAULT_PROFILE.strongholdDefense.skillBuffer).not.toBe(99);
        expect(second.personalHonor.persistentCharacterFate).toBe(DEFAULT_PROFILE.personalHonor.persistentCharacterFate);
        expect(DEFAULT_PROFILE.personalHonor.persistentCharacterFate).not.toBe(99);
        expect(second.duelBidding.duelWinUtility).toBe(DEFAULT_PROFILE.duelBidding.duelWinUtility);
        expect(DEFAULT_PROFILE.duelBidding.duelWinUtility).not.toBe(99);
        expect(second.provinceTargeting.effectiveStrengthById['public-forum']).toBe(6);
        expect(second.provinceTargeting.priorityTierById.tsuma).toBeUndefined();
        expect(DEFAULT_PROFILE.provinceTargeting.effectiveStrengthById['public-forum']).toBe(6);
    });

    it('injects different shared duel risk objectives without replacing duel flow', function() {
        const honor = profileFromStrategy({ ...GENERIC, duelist: true });
        const dishonor = profileFromStrategy({ ...GENERIC, dishonor: true });
        const lion = resolveDeckProfile(['hayaken-no-shiro', 'way-of-the-lion'], AGGRO);

        expect(honor.duelBidding.objective).toBe('honor');
        expect(dishonor.duelBidding.objective).toBe('dishonor');
        expect(lion.duelBidding.objective).toBe('honor');
        expect(honor.duelBidding.duelWinUtility).toBeGreaterThan(DEFAULT_PROFILE.duelBidding.duelWinUtility);
        expect(dishonor.duelBidding.opponentLowHonorUtility)
            .toBeGreaterThan(DEFAULT_PROFILE.duelBidding.opponentLowHonorUtility);
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
        expect(p.fateAwareEconomy.deferPassForDynastyActions).toBe(true);
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
        expect(p.conflictCardEconomy.enabled).toBe(false);
        expect(p.unicorn).toBeDefined();
        // The rush attack identity stays.
        expect(p.forceMilitaryConflict).toBe(true);
    });

    it('clones injectable economy objects from matched deck overrides', function() {
        const first = resolveDeckProfile(['cavalry-reserves', 'ride-on'], AGGRO);
        const second = resolveDeckProfile(['cavalry-reserves', 'ride-on'], AGGRO);
        first.conflictCardEconomy.priorityWeight = 99;

        expect(second.conflictCardEconomy.priorityWeight).toBe(DEFAULT_PROFILE.conflictCardEconomy.priorityWeight);
    });

    it('clones Lion attachment tactics per resolved profile', function() {
        const first = resolveDeckProfile(['hayaken-no-shiro', 'way-of-the-lion'], AGGRO);
        const second = resolveDeckProfile(['hayaken-no-shiro', 'way-of-the-lion'], AGGRO);
        first.lion.trueStrikeMinimumBaseLead = 99;
        first.lion.setupAttachmentPriority.push('mutated');

        expect(second.lion.trueStrikeMinimumBaseLead).toBe(1);
        expect(second.lion.setupAttachmentPriority).not.toContain('mutated');
    });

    it('does NOT apply the Unicorn override without the marker card or flag', function() {
        expect(resolveDeckProfile([], AGGRO).defenseCommitment).toBe('win-only');
        expect(resolveDeckProfile(['cavalry-reserves'], GENERIC).defenseCommitment).toBe('prevent-break');
        expect(resolveDeckProfile(['cavalry-reserves'], GENERIC).aggressiveFate).toBe(false);
    });

    it('Phoenix Shugenja raises only the injectable pre-stronghold threat ratio', function() {
        const first = resolveDeckProfile(['vassal-fields'], SHUGENJA);
        const second = resolveDeckProfile(['vassal-fields'], SHUGENJA);

        expect(first.strongholdProvinceId).toBe('vassal-fields');
        expect(first.strongholdDefense.preStrongholdThreatRatio).toBe(1.5);
        expect(first.strongholdDefense.preStrongholdDefenseEnabled).toBe(true);
        expect(first.strongholdDefense.preStrongholdMinOpponentConflicts)
            .toBe(DEFAULT_PROFILE.strongholdDefense.preStrongholdMinOpponentConflicts);

        first.strongholdDefense.preStrongholdThreatRatio = 99;
        expect(second.strongholdDefense.preStrongholdThreatRatio).toBe(1.5);
        expect(DEFAULT_PROFILE.strongholdDefense.preStrongholdThreatRatio).toBe(1);
    });
});
