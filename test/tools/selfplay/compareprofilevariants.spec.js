const {
    applyVariant,
    parseArgs,
    seededRandom
} = require('../../../tools/selfplay/compareProfileVariants.js');

describe('paired deck-profile comparison', function() {
    function controller() {
        return {
            player: {},
            currentDeckProfile() {
                return {
                    strongholdDefense: {
                        preStrongholdDefenseEnabled: true,
                        preStrongholdThreatRatio: 1
                    },
                    provinceTargeting: {
                        preferEminent: true,
                        abilityPriority: { none: 0, reveal: 1, reaction: 2, action: 3, unknown: 4 },
                        effectiveStrengthById: { 'public-forum': 6 },
                        priorityTierById: {}
                    }
                };
            }
        };
    }

    it('parses parameterized injectable variants', function() {
        const options = parseArgs([
            '--deck', 'PhoenixShugenja', '--opponent', 'Unicorn',
            '--variants', 'current,ratio-1.5,public-forum-4,no-ability-priority'
        ]);

        expect(options.variants).toEqual([
            'current', 'ratio-1.5', 'public-forum-4', 'no-ability-priority'
        ]);
    });

    it('changes only the requested profile knob', function() {
        const target = controller();
        const profile = target.currentDeckProfile();
        target.currentDeckProfile = () => profile;

        applyVariant(target, 'ratio-1.5');
        expect(profile.strongholdDefense.preStrongholdThreatRatio).toBe(1.5);
        expect(profile.provinceTargeting.effectiveStrengthById['public-forum']).toBe(6);

        applyVariant(target, 'public-forum-4');
        expect(profile.provinceTargeting.effectiveStrengthById['public-forum']).toBe(4);
        expect(profile.provinceTargeting.preferEminent).toBe(true);
    });

    it('uses a reproducible random stream', function() {
        const first = seededRandom(123);
        const second = seededRandom(123);
        expect([first(), first(), first()]).toEqual([second(), second(), second()]);
    });
});
