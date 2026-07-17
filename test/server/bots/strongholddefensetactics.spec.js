const {
    StrongholdDefenseTactics,
    STRONGHOLD_DEFENSE_DEFAULTS
} = require('../../../build/server/game/bots/StrongholdDefenseTactics.js');

describe('StrongholdDefenseTactics', function() {
    const card = (uuid, military, political, covert = false) => ({ uuid, military, political, covert });
    const plan = (overrides = {}, profile = {}) => new StrongholdDefenseTactics({
        ...STRONGHOLD_DEFENSE_DEFAULTS,
        ...profile
    }).plan({
        active: true,
        strongholdProvinceStrength: 7,
        myReady: [card('mil', 6, 1), card('pol', 1, 6), card('support', 2, 2)],
        opponentReady: [card('enemy', 6, 6)],
        opponentConflictsRemaining: 1,
        opponentMilitaryRemaining: 1,
        opponentPoliticalRemaining: 0,
        ...overrides
    });

    it('does nothing before the third outer province breaks', function() {
        expect(plan({ active: false }).mode).toBe('inactive');
    });

    it('keeps the strongest relevant character and lets the rest attack', function() {
        const result = plan({
            strongholdProvinceStrength: 4,
            opponentReady: [card('enemy', 9, 0)]
        });
        expect(result.mode).toBe('reserve');
        expect(result.reserveUuids).toEqual(['mil']);
    });

    it('uses the live combined province + stronghold strength without adding it twice', function() {
        const safe = plan({ strongholdProvinceStrength: 7, opponentReady: [card('enemy', 6, 0)] });
        const needsBody = plan({ strongholdProvinceStrength: 6, opponentReady: [card('enemy', 6, 0)] });
        expect(safe.reserveUuids).toEqual([]);
        // Equality at the break threshold breaks the province, so strict safety
        // reserves a defender in the second case.
        expect(needsBody.reserveUuids).toEqual(['mil']);
    });

    it('holds every character when one fair-bot defender cannot cover both axes', function() {
        const result = plan({
            strongholdProvinceStrength: 4,
            opponentReady: [card('enemy-mil', 9, 0), card('enemy-pol', 0, 9)],
            opponentMilitaryRemaining: 1,
            opponentPoliticalRemaining: 1
        });
        expect(result.mode).toBe('hold-all');
    });

    it('attacks when every enemy character is bowed or no enemy conflict remains', function() {
        expect(plan({ opponentReady: [] }).mode).toBe('open-attack');
        const last = plan({ opponentConflictsRemaining: 0 });
        expect(last.mode).toBe('last-conflict-all-in');
        expect(last.forceAllAttackers).toBe(true);
    });

    it('races all-in when both strongholds are exposed', function() {
        const result = plan({ opponentStrongholdExposed: true });
        expect(result.mode).toBe('last-conflict-all-in');
        expect(result.reason).toBe('stronghold-race-all-in');
        expect(result.forceAllAttackers).toBe(true);
    });

    it('does not trust a single stay-home defender against covert', function() {
        const result = plan({ opponentReady: [card('covert', 2, 2, true)] });
        expect(result.mode).toBe('hold-all');
        expect(result.reason).toBe('stronghold-covert-risk');
    });

    it('lets omniscient mode reserve the minimum larger set for known boosts and bow effects', function() {
        const result = plan({
            strongholdProvinceStrength: 5,
            myReady: [card('one', 5, 5), card('two', 4, 4), card('attack', 2, 2)],
            opponentReady: [card('enemy', 6, 6)],
            opponentMilitaryRemaining: 1,
            opponentPoliticalRemaining: 1,
            handThreat: { military: 2, political: 2 },
            defenderDisables: 1,
            omniscient: true
        });
        expect(result.mode).toBe('reserve');
        expect(result.reserveUuids).toEqual(['one', 'two']);
    });

    it('keeps all when omniscient known control makes every smaller reserve unsafe', function() {
        const result = plan({
            strongholdProvinceStrength: 3,
            myReady: [card('one', 3, 3), card('two', 2, 2)],
            opponentReady: [card('enemy', 7, 7)],
            opponentMilitaryRemaining: 1,
            opponentPoliticalRemaining: 1,
            defenderDisables: 1,
            omniscient: true
        });
        expect(result.mode).toBe('hold-all');
    });
});

