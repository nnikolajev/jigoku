const {
    PROVINCE_REVEAL_RESPONSE_DEFAULTS,
    UNICORN_REVEAL_DEFAULTS,
    ProvinceRevealResponseTactics,
    UnicornRevealTactics
} = require('../../../build/server/game/bots/UnicornRevealTactics.js');
const { FATE_ECONOMY_DRAW_BID_PROFILE } = require('../../../build/server/game/bots/DrawBidTactics.js');
const { loadUnicornRevealDeck } = require('../../../tools/selfplay/deckLoader.js');
const { DECK_LABELS } = require('../../../tools/selfplay/deckRegistry.js');

describe('UnicornRevealTactics', function() {
    const snapshot = (overrides = {}) => ({
        self: [],
        opponent: [
            { location: 'province 1', owner: 'opponent', faceup: true, broken: false, stronghold: false },
            { location: 'province 2', owner: 'opponent', faceup: true, broken: false, stronghold: false },
            { location: 'province 3', owner: 'opponent', faceup: true, broken: false, stronghold: false },
            { location: 'province 4', owner: 'opponent', faceup: true, broken: false, stronghold: false },
            { location: 'stronghold province', owner: 'opponent', faceup: false, broken: false, stronghold: true }
        ],
        opponentStrongholdAttackable: false,
        combinedConflictSkills: false,
        ...overrides
    });

    it('loads the exact EmeraldDB deck into every self-play registry consumer', function() {
        const deck = loadUnicornRevealDeck();
        const count = (entries) => entries.reduce((total, entry) => total + entry.count, 0);
        const ids = (entries) => entries.map((entry) => entry.card.id);

        expect(DECK_LABELS).toContain('UnicornReveal');
        expect(deck.name).toBe('Unicorn Reveal');
        expect(count(deck.stronghold)).toBe(1);
        expect(count(deck.role)).toBe(1);
        expect(count(deck.provinceCards)).toBe(5);
        expect(count(deck.dynastyCards)).toBe(40);
        expect(count(deck.conflictCards)).toBe(40);
        expect(ids(deck.stronghold)).toEqual(['shiro-shinjo']);
        expect(ids(deck.role)).toEqual(['seeker-of-void']);
        expect(ids(deck.conflictCards)).toContain('scouted-terrain');
    });

    it('turns four revealed outer provinces and four fate into a Scouted Terrain gate', function() {
        const tactics = new UnicornRevealTactics();

        expect(tactics.opponentFaceupNonStronghold(snapshot())).toBe(4);
        expect(tactics.allOpponentOuterRevealed(snapshot())).toBe(true);
        expect(tactics.shouldPlayScoutedTerrain(snapshot(), 4, 0)).toBe(false);
        expect(tactics.shouldPlayScoutedTerrain(snapshot(), 4, 1)).toBe(true);
        expect(tactics.shouldPlayScoutedTerrain(snapshot(), 3, 1)).toBe(false);
        expect(tactics.shouldPlayScoutedTerrain(snapshot({ opponentStrongholdAttackable: true }), 9, 1)).toBe(false);
    });

    it('reduces later-round bids only while Good Omen is held', function() {
        const tactics = new UnicornRevealTactics();
        const omen = [{ id: 'good-omen' }];

        expect(tactics.adjustDrawBid(5, 1, omen)).toBe(5);
        expect(tactics.adjustDrawBid(5, 2, omen)).toBe(4);
        expect(tactics.adjustDrawBid(1, 3, omen)).toBe(1);
        expect(tactics.adjustDrawBid(5, 3, [])).toBe(5);
    });

    it('keeps Khanbulak Benefactor dire and banks fate on durable threats', function() {
        const tactics = new UnicornRevealTactics();

        expect(tactics.desiredAdditionalFate('khanbulak-benefactor')).toBe(0);
        expect(tactics.desiredAdditionalFate('moto-horde')).toBe(2);
        expect(tactics.desiredAdditionalFate('not-in-the-profile')).toBeNull();
    });

    it('reveals a hidden stronghold before an outer province and disables the best exposed text', function() {
        const tactics = new UnicornRevealTactics();
        const hiddenOuter = { type: 'province', facedown: true, location: 'province 2' };
        const hiddenStronghold = { type: 'province', facedown: true, location: 'stronghold province' };
        const massing = { type: 'province', id: 'massing-at-twilight', facedown: false, location: 'province 3' };
        const ancestral = { type: 'province', id: 'ancestral-lands', facedown: false, location: 'province 4' };

        expect(tactics.pickRevealTarget([hiddenOuter, hiddenStronghold])).toBe(hiddenStronghold);
        expect(tactics.pickRevealTarget([ancestral, massing])).toBe(massing);
    });

    it('uses Outflank on the strongest ready non-unique defender', function() {
        const tactics = new UnicornRevealTactics();
        const weak = { type: 'character', uuid: 'a', military: 2, political: 1, bowed: false, isUnique: false };
        const strong = { type: 'character', uuid: 'b', military: 5, political: 2, bowed: false, isUnique: false };
        const unique = { type: 'character', uuid: 'c', military: 8, political: 8, bowed: false, isUnique: true };
        const bowed = { type: 'character', uuid: 'd', military: 9, political: 9, bowed: true, isUnique: false };

        expect(tactics.pickOutflankTarget([weak, strong, unique, bowed])).toBe(strong);
    });

    it('fires resource reactions only when they can produce value', function() {
        const tactics = new UnicornRevealTactics();

        expect(tactics.shouldTrigger('way-station-trader', 0, snapshot())).toBe(false);
        expect(tactics.shouldTrigger('way-station-trader', 1, snapshot())).toBe(true);
        expect(tactics.shouldTrigger('shiro-shinjo', 0, snapshot())).toBe(true);
        expect(tactics.shouldTrigger('shiro-shinjo', 0, snapshot({ opponent: [] }))).toBe(false);
    });

    it('answers Aranat by revealing only provinces worth more than the denied fate', function() {
        const tactics = new ProvinceRevealResponseTactics();
        const action = {
            id: 'ancestral-lands', location: 'province 1', provinceAbilityClass: 'action'
        };
        const blank = { id: 'blank-province', location: 'province 2', provinceAbilityClass: 'none' };
        const khan = { id: 'khan-s-ordu', location: 'province 3', provinceAbilityClass: 'reveal' };

        expect(tactics.pickAgainstAranat([action, blank])).toBeNull();
        expect(tactics.pickAgainstAranat([action, khan, blank])).toBe(khan);
    });

    it('keeps all reveal decisions injectable', function() {
        const revealProfile = {
            ...UNICORN_REVEAL_DEFAULTS,
            additionalFateByCharacterId: { custom: 3 },
            provinceTextPriorityById: { custom: 20 }
        };
        const responseProfile = {
            ...PROVINCE_REVEAL_RESPONSE_DEFAULTS,
            aranatFateDenialValue: 6,
            onRevealValueById: { custom: 7 }
        };

        expect(new UnicornRevealTactics(revealProfile).desiredAdditionalFate('custom')).toBe(3);
        expect(new ProvinceRevealResponseTactics(responseProfile).pickAgainstAranat([
            { id: 'custom', location: 'province 1' }
        ])?.id).toBe('custom');
    });

    it('applies reveal-attacker priority in every conflict, for all three reveal reactions', function() {
        // Their reactions need the character participating when a province
        // flips, and most flips happen in conflicts 2-3. Measured positive in
        // all four runs (+0.19 to +0.26pp); see docs/unicorn-reveal-bot.md.
        expect(UNICORN_REVEAL_DEFAULTS.revealAttackerPriorityAllConflicts).toBe(true);
        expect(UNICORN_REVEAL_DEFAULTS.unrevealedProvinceAttackerIds)
            .toEqual(['shinjo-trailblazer', 'way-station-trader', 'ganzu-warrior']);
        // White Horde Vanguard's protection really is first-conflict-only.
        expect(UNICORN_REVEAL_DEFAULTS.firstConflictCharacterIds).toEqual(['white-horde-vanguard']);
    });

    it('bids for honor rather than cards, because the stronghold pays in fate', function() {
        // The card-engine bid (minimumRoutineBid 4) handed the field 1-2 honor
        // per round and made 22% of all losses dishonor. Measured +4.58pp.
        expect(FATE_ECONOMY_DRAW_BID_PROFILE.minimumRoutineBid).toBe(1);
        expect(FATE_ECONOMY_DRAW_BID_PROFILE.lowHonorThreshold).toBe(20);
        expect(FATE_ECONOMY_DRAW_BID_PROFILE.objective).toBe('balanced');
    });

    it('keeps Yoritomo and Aranat additional fate at their measured values', function() {
        // Yoritomo reads the live fate pool for his own X, so paying fate onto
        // him looks self-defeating on card text. Measured, cutting it to 0 lost
        // 5.00pp: fate on a character buys rounds in play, which dominates.
        expect(UNICORN_REVEAL_DEFAULTS.additionalFateByCharacterId.yoritomo).toBe(2);
        expect(UNICORN_REVEAL_DEFAULTS.additionalFateByCharacterId.aranat).toBe(2);
        // Khanbulak Benefactor must stay at 0 to remain Dire.
        expect(UNICORN_REVEAL_DEFAULTS.additionalFateByCharacterId['khanbulak-benefactor']).toBe(0);
    });
});
