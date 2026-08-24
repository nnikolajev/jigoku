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

    it('injects draw-bid objectives by deck strategy without policy branches', function() {
        const glory = profileFromStrategy({ ...GENERIC, glory: true });
        const monk = profileFromStrategy({ ...GENERIC, monk: true });
        const duelist = profileFromStrategy({ ...GENERIC, duelist: true });
        const shugenja = profileFromStrategy({ ...GENERIC, shugenja: true });
        const attachmentTower = profileFromStrategy({ ...GENERIC, attachmentTower: true });
        const dishonor = profileFromStrategy({ ...GENERIC, dishonor: true });

        expect(glory.drawBidding.minimumRoutineBid).toBe(4);
        expect(monk.drawBidding.minimumRoutineBid).toBe(4);
        expect(monk.legacyDrawBidding.mode).toBe('fixed-after-opening');
        expect(duelist.drawBidding.objective).toBe('honor');
        expect(shugenja.drawBidding.ringFateConversion).toBeGreaterThan(0.6);
        expect(attachmentTower.drawBidding.minimumRoutineBid).toBe(4);
        expect(attachmentTower.drawBidding.dominantBoardPenalty).toBe(1);
        expect(dishonor.drawBidding.forceLowAfterOpening).toBe(true);
        expect(dishonor.legacyDrawBidding.mode).toBe('low-after-opening');
    });

    it('clones injectable conflict economy knobs per resolved profile', function() {
        const first = profileFromStrategy(GENERIC);
        const second = profileFromStrategy(GENERIC);
        first.conflictCardEconomy.priorityWeight = 99;
        first.strongholdDefense.skillBuffer = 99;
        first.personalHonor.persistentCharacterFate = 99;
        first.duelBidding.duelWinUtility = 99;
        first.drawBidding.baseBid = 99;
        first.legacyDrawBidding.laterBid = 99;
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
        expect(second.drawBidding.baseBid).toBe(DEFAULT_PROFILE.drawBidding.baseBid);
        expect(DEFAULT_PROFILE.drawBidding.baseBid).not.toBe(99);
        expect(second.legacyDrawBidding.laterBid).toBe(DEFAULT_PROFILE.legacyDrawBidding.laterBid);
        expect(DEFAULT_PROFILE.legacyDrawBidding.laterBid).not.toBe(99);
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

    it('matches and isolates the Unicorn Reveal profile', function() {
        const ids = ['shiro-shinjo', 'scouted-terrain', 'aranat'];
        const first = resolveDeckProfile(ids, GENERIC);
        const second = resolveDeckProfile(ids, GENERIC);

        expect(first.overrideNames).toContain('unicorn-reveal-shiro-shinjo');
        expect(first.strongholdProvinceId).toBe('massing-at-twilight');
        expect(first.forceMilitaryConflict).toBe(true);
        expect(first.provinceTargeting.preferFacedown).toBe(true);
        expect(first.provinceTargeting.effectiveStrengthById['ancestral-lands']).toBe(5);
        expect(first.provinceTargeting.effectiveStrengthById['appealing-to-the-fortunes']).toBe(5);
        expect(first.provinceTargeting.effectiveStrengthById['massing-at-twilight']).toBe(8);
        expect(first.unicornReveal.additionalFateByCharacterId['khanbulak-benefactor']).toBe(0);

        first.unicornReveal.additionalFateByCharacterId['moto-horde'] = 99;
        first.unicornReveal.unrevealedProvinceAttackerIds.push('mutated');
        first.provinceRevealResponse.onRevealValueById['khan-s-ordu'] = 99;
        expect(second.unicornReveal.additionalFateByCharacterId['moto-horde']).toBe(2);
        expect(second.unicornReveal.unrevealedProvinceAttackerIds).not.toContain('mutated');
        expect(second.provinceRevealResponse.onRevealValueById['khan-s-ordu']).toBe(5);
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

    it('gives the Imperial Favor ready exception to every deck holding Censure', function() {
        // The favor is awarded on a glory count that reads only UNBOWED
        // characters, so a deck that spends the favor gets real value from a
        // ready no conflict can use. Keyed on the card, not on the archetype:
        // both the Scorpion bid-war list and the Phoenix glory list run it.
        const { ReadyValuePolicy } = require('../../../build/server/game/bots/ReadyValuePolicy.js');

        expect(resolveDeckProfile(['censure'], GENERIC).readyValue.countFavorGlory).toBe(true);
        expect(resolveDeckProfile(['censure'], AGGRO).readyValue.countFavorGlory).toBe(true);
        expect(resolveDeckProfile([], GENERIC).readyValue.countFavorGlory).toBe(false);
        expect(resolveDeckProfile(['rally-to-the-cause'], GENERIC).readyValue.countFavorGlory)
            .toBe(false);

        // The override replaces the field wholesale, so the rest of the
        // configuration has to come back from the policy's own defaults.
        const policy = new ReadyValuePolicy(resolveDeckProfile(['censure'], GENERIC).readyValue);
        expect(policy.config.enabled).toBe(true);
        expect(policy.config.minFavorGlory).toBe(DEFAULT_PROFILE.readyValue.minFavorGlory);
        expect(policy.config.allowMoveIntoConflict)
            .toBe(DEFAULT_PROFILE.readyValue.allowMoveIntoConflict);
        expect(policy.evaluate({
            conflictsRemaining: 0, opponentConflictsRemaining: 0,
            favorContested: true, gloryOnReady: 2
        })).toEqual({ useful: true, reason: 'ready-for-imperial-favor-glory' });
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
