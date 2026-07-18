const {
    PersonalHonorTactics,
    PERSONAL_HONOR_DEFAULTS
} = require('../../../build/server/game/bots/PersonalHonorTactics.js');

describe('Personal honor tactics', function() {
    const card = (uuid, glory, extra = {}) => ({
        uuid,
        type: 'character',
        bowed: false,
        inConflict: false,
        fate: 0,
        glorySummary: { stat: String(glory) },
        militarySkillSummary: { stat: '1' },
        politicalSkillSummary: { stat: '1' },
        ...extra
    });

    const tactics = (overrides = {}) => new PersonalHonorTactics({
        ...PERSONAL_HONOR_DEFAULTS,
        ...overrides
    });

    it('honors highest glory and accepts forced dishonor on lowest glory', function() {
        const cards = [
            card('zero', 0, { fate: 3 }),
            card('middle', 2),
            card('high', 4)
        ];

        expect(tactics().pickOwnHonor(cards).uuid).toBe('high');
        expect(tactics().pickForcedOwnDishonor(cards).uuid).toBe('zero');
    });

    it('minimizes a forced honor placed on the enemy', function() {
        expect(tactics().pickForcedEnemyHonor([
            card('high', 4),
            card('zero', 0)
        ]).uuid).toBe('zero');
    });

    it('uses a lower-glory participant when dishonor changes the winner', function() {
        const pick = tactics().pickEnemyDishonor([
            card('participant', 2, {
                inConflict: true,
                politicalSkillSummary: { stat: '2' }
            }),
            card('home', 4, {
                politicalSkillSummary: { stat: '7' }
            })
        ], {
            axis: 'political',
            mySkill: 4,
            opponentSkill: 5,
            amAttacker: true
        });

        expect(pick.uuid).toBe('participant');
    });

    it('uses a participant when dishonor creates a province break', function() {
        const pick = tactics().pickEnemyDishonor([
            card('participant', 2, {
                inConflict: true,
                politicalSkillSummary: { stat: '3' }
            }),
            card('home', 4)
        ], {
            axis: 'political',
            mySkill: 5,
            opponentSkill: 3,
            amAttacker: true,
            attackedProvinceStrength: 4
        });

        expect(pick.uuid).toBe('participant');
    });

    it('does not treat an attacking tie as a win', function() {
        const pick = tactics().pickEnemyDishonor([
            card('participant', 1, {
                inConflict: true,
                politicalSkillSummary: { stat: '1' }
            }),
            card('home', 4)
        ], {
            axis: 'political',
            mySkill: 4,
            opponentSkill: 5,
            amAttacker: true
        });

        expect(pick.uuid).toBe('home');
    });

    it('treats a defending tie as a win', function() {
        const pick = tactics().pickEnemyDishonor([
            card('participant', 1, {
                inConflict: true,
                politicalSkillSummary: { stat: '1' }
            }),
            card('home', 4)
        ], {
            axis: 'political',
            mySkill: 4,
            opponentSkill: 5,
            amAttacker: false
        });

        expect(pick.uuid).toBe('participant');
    });

    it('targets highest-glory home character when conflict result cannot change', function() {
        const pick = tactics().pickEnemyDishonor([
            card('participant', 2, {
                inConflict: true,
                politicalSkillSummary: { stat: '2' }
            }),
            card('home', 4)
        ], {
            axis: 'political',
            mySkill: 1,
            opponentSkill: 5,
            amAttacker: true
        });

        expect(pick.uuid).toBe('home');
    });

    it('treats zero glory as zero conflict impact', function() {
        const pick = tactics().pickEnemyDishonor([
            card('participant', 0, {
                inConflict: true,
                politicalSkillSummary: { stat: '5' }
            }),
            card('home', 2)
        ], {
            axis: 'political',
            mySkill: 4,
            opponentSkill: 5,
            amAttacker: true
        });

        expect(pick.uuid).toBe('home');
    });

    it('allows a deck profile to disable the home preference', function() {
        const cards = [
            card('participant', 4, { inConflict: true }),
            card('home', 2)
        ];
        const conflict = {
            axis: 'political',
            mySkill: 1,
            opponentSkill: 8,
            amAttacker: true
        };

        expect(tactics().pickEnemyDishonor(cards, conflict).uuid).toBe('home');
        expect(tactics({ preferHomeWhenConflictUnaffected: false })
            .pickEnemyDishonor(cards, conflict).uuid).toBe('participant');
    });

    it('reads both live glory summaries and normalized glory fields', function() {
        expect(tactics().gloryValue({ glorySummary: { stat: '3' } })).toBe(3);
        expect(tactics().gloryValue({ glory: 2 })).toBe(2);
    });
});
