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

    // The 2026-08-22 replay: Scouted Terrain played three times, stronghold
    // attacked zero times. Once the phase had no ready character at all.
    it('refuses Scouted Terrain when the attack it unlocks cannot happen', function() {
        const tactics = new UnicornRevealTactics();
        const ready = { conflictsRemaining: 1, readyAttackers: 2, readyAttackSkill: 10 };

        expect(tactics.shouldPlayScoutedTerrain(snapshot(), 4, 1, ready)).toBe(true);
        expect(tactics.shouldPlayScoutedTerrain(snapshot(), 4, 1,
            { ...ready, readyAttackers: 0 })).toBe(false);
        expect(tactics.shouldPlayScoutedTerrain(snapshot(), 4, 1,
            { ...ready, conflictsRemaining: 0 })).toBe(false);
        expect(tactics.shouldPlayScoutedTerrain(snapshot(), 4, 1,
            { ...ready, readyAttackSkill: 4 })).toBe(false);
    });

    it('reads the stronghold province strength it has to reach, fair-view only', function() {
        const tactics = new UnicornRevealTactics();
        const faceup = (strength) => snapshot({
            opponent: snapshot().opponent.map((province) => province.stronghold
                ? { ...province, faceup: true, strength }
                : province)
        });

        // Facedown: the profile assumption, not zero.
        expect(tactics.strongholdBreakStrength(snapshot()))
            .toBe(UNICORN_REVEAL_DEFAULTS.scoutedUnknownStrongholdStrength);
        expect(tactics.strongholdBreakStrength(faceup(7))).toBe(7);
        expect(tactics.canBreakStrongholdNow(faceup(7), 7)).toBe(true);
        expect(tactics.canBreakStrongholdNow(faceup(7), 6)).toBe(false);
    });

    it('keeps both new gates switchable from a tuning arm', function() {
        const off = new UnicornRevealTactics({
            ...UNICORN_REVEAL_DEFAULTS,
            scoutedRequiresReadyAttacker: false,
            scoutedRequireBreakableStronghold: false
        });

        expect(off.shouldPlayScoutedTerrain(snapshot(), 4, 1,
            { conflictsRemaining: 0, readyAttackers: 0, readyAttackSkill: 0 })).toBe(true);
    });

    it('reduces later-round bids only while Good Omen is held', function() {
        const tactics = new UnicornRevealTactics();
        const omen = [{ id: 'good-omen' }];

        expect(tactics.adjustDrawBid(5, 1, omen)).toBe(5);
        expect(tactics.adjustDrawBid(5, 2, omen)).toBe(4);
        expect(tactics.adjustDrawBid(1, 3, omen)).toBe(1);
        expect(tactics.adjustDrawBid(5, 3, [])).toBe(5);
    });

    it('spends Good Omen on a body one fate phase from leaving play', function() {
        const tactics = new UnicornRevealTactics();
        const aranat = { uuid: 'a', type: 'character', id: 'aranat', fate: 5, military: 4, political: 4, printedCost: 4 };
        const empty = { uuid: 'b', type: 'character', id: 'moto-horde', fate: 0, military: 3, political: 1, printedCost: 3 };
        const nearlyEmpty = { uuid: 'c', type: 'character', id: 'utaku-yumino', fate: 1, military: 2, political: 1, printedCost: 3 };

        expect(tactics.isGoodOmenTarget(aranat)).toBe(false);
        expect(tactics.isGoodOmenTarget(empty)).toBe(true);
        expect(tactics.isGoodOmenTarget(nearlyEmpty)).toBe(true);

        // The fat body is the strongest by the generic ranking and is exactly
        // what the bot used to pick (live 2026-08-24 r2c0).
        expect(tactics.pickStrongestCharacter([aranat, empty, nearlyEmpty]).uuid).toBe('a');
        expect(tactics.pickGoodOmenTarget([aranat, empty, nearlyEmpty]).uuid).toBe('b');
        expect(tactics.pickGoodOmenTarget([aranat])).toBeNull();
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

    it('uses Outflank on the highest current-conflict skill among legal ready defenders', function() {
        const tactics = new UnicornRevealTactics();
        const military = { type: 'character', uuid: 'a', military: 5, political: 1, bowed: false, isUnique: false };
        const political = { type: 'character', uuid: 'b', military: 2, political: 6, bowed: false, isUnique: false };
        const expensive = {
            type: 'character', uuid: 'c', military: 3, political: 3, printedCost: 5, fate: 3,
            bowed: false, isUnique: false
        };
        const unique = { type: 'character', uuid: 'd', military: 8, political: 8, bowed: false, isUnique: true };
        const bowed = { type: 'character', uuid: 'e', military: 9, political: 9, bowed: true, isUnique: false };
        const cards = [military, political, expensive, unique, bowed];

        expect(tactics.pickOutflankTarget(cards, 'military')).toBe(military);
        expect(tactics.pickOutflankTarget(cards, 'political')).toBe(political);
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

    it('prefers a still-hidden province for every reveal source', function() {
        // Chasing the Sun, Diversionary Maneuver and Overrun all read "... and
        // reveal it, if able" and all three also offer FACEUP opposing
        // provinces. Only the faceup ones carry a uuid in the bot's view, so
        // without this flag the pick landed on one of those and the reveal half
        // of the card did nothing.
        expect(UNICORN_REVEAL_DEFAULTS.preferFacedownRevealTarget).toBe(true);
        expect(UNICORN_REVEAL_DEFAULTS.revealSourceIds).toEqual([
            'border-fortress', 'iuchi-farseer', 'chasing-the-sun',
            'diversionary-maneuver', 'overrun'
        ]);
        // pickRevealTarget already ranks hidden above faceup; it simply never
        // receives a hidden province, which is why the flag is needed at all.
        const tactics = new UnicornRevealTactics();
        const faceup = { type: 'province', facedown: false, location: 'province 1' };
        const hidden = { type: 'province', facedown: true, location: 'province 2' };
        expect(tactics.pickRevealTarget([faceup, hidden])).toBe(hidden);
    });

    describe('fate-scaling characters', function() {
        const snapshot = (faceupOuter) => ({
            self: [],
            opponent: Array.from({ length: 4 }, (unused, index) => ({
                location: `province ${index + 1}`,
                owner: 'them',
                faceup: index < faceupOuter,
                broken: false,
                stronghold: false
            })),
            opponentStrongholdAttackable: false,
            combinedConflictSkills: false
        });

        it('declines Yoritomo out of an opening pool that cannot survive the buy', function() {
            // Shiro Shinjo collects 6. Cost 5 plus the deck's 2 additional fate
            // leaves nothing, so Yoritomo arrives as a vanilla 3/3 alone on the
            // board — exactly what the reveal engine does not want early.
            const tactics = new UnicornRevealTactics();
            expect(tactics.shouldPlayFateScalingCharacter('yoritomo', 6, 5, snapshot(0))).toBe(false);
            expect(tactics.shouldPlayFateScalingCharacter('yoritomo', 8, 5, snapshot(0))).toBe(false);
            expect(tactics.shouldPlayFateScalingCharacter('yoritomo', 9, 5, snapshot(0))).toBe(true);
        });

        it('lifts the gate once enough of their provinces are already faceup', function() {
            const tactics = new UnicornRevealTactics();
            expect(tactics.shouldPlayFateScalingCharacter('yoritomo', 6, 5, snapshot(3))).toBe(true);
        });

        it('never gates a character that is not fate-scaling', function() {
            const tactics = new UnicornRevealTactics();
            expect(tactics.shouldPlayFateScalingCharacter('moto-horde', 6, 5, snapshot(0))).toBe(true);
            expect(tactics.shouldPlayFateScalingCharacter(undefined, 0, 0, snapshot(0))).toBe(true);
        });

        it('keeps the gate injectable', function() {
            const tactics = new UnicornRevealTactics({
                ...UNICORN_REVEAL_DEFAULTS,
                fateScalingCharacterIds: [],
                fateScalingMinimumPoolAfterPlay: 99
            });
            expect(tactics.shouldPlayFateScalingCharacter('yoritomo', 6, 5, snapshot(0))).toBe(true);
        });
    });
});
