const {
    ProvinceTargetingTactics,
    PROVINCE_TARGETING_DEFAULTS
} = require('../../../build/server/game/bots/ProvinceTargeting.js');

describe('ProvinceTargetingTactics', function() {
    it('trades modest strength for denying a valuable hidden dynasty stack', function() {
        const one = [{ facedown: true, location: 'province 1' }];
        const two = [{ facedown: true, location: 'province 2' }];
        const ranked = new ProvinceTargetingTactics().rank([one, two], [
            { location: 'province 1', strength: 4, dynastyValue: 8 },
            { location: 'province 2', strength: 3, dynastyValue: 0 }
        ]);
        expect(ranked[0]).toBe(one);
    });

    const list = (id, location, strength, abilityClass = 'none', eminent = false) => [{
        uuid: id, id, name: id, isProvince: true, type: 'province', location,
        isBroken: false, facedown: false, eminent, provinceAbilityClass: abilityClass,
        strengthSummary: { stat: String(strength) }
    }];
    const ids = (ranked) => ranked.map((cards) => cards[0].id || cards[0].location);

    it('orders Eminent first, then strength, then none/reveal/reaction/action', function() {
        const tactics = new ProvinceTargetingTactics();
        const ranked = tactics.rank([
            list('action', 'province 1', 3, 'action'),
            list('reaction', 'province 2', 3, 'reaction'),
            list('reveal', 'province 3', 3, 'reveal'),
            list('none', 'province 4', 3, 'none'),
            list('eminent', 'province 5', 5, 'action', true),
            list('weak', 'province 6', 2, 'action')
        ]);

        expect(ids(ranked)).toEqual(['eminent', 'weak', 'none', 'reveal', 'reaction', 'action']);
    });

    it('treats Public Forum as effective strength 6 without changing its live card strength', function() {
        const forum = list('public-forum', 'province 1', 3, 'reaction');
        const ordinary = list('ordinary', 'province 2', 5, 'action');
        const ranked = new ProvinceTargetingTactics().rank([forum, ordinary]);

        expect(ids(ranked)).toEqual(['ordinary', 'public-forum']);
        expect(forum[0].strengthSummary.stat).toBe('3');
    });

    it('keeps stable board order when every province remains unknown to a fair bot', function() {
        const hiddenOne = [{ facedown: true, location: 'province 1' }];
        const hiddenTwo = [{ facedown: true, location: 'province 2' }];

        expect(new ProvinceTargetingTactics().rank([hiddenOne, hiddenTwo]))
            .toEqual([hiddenOne, hiddenTwo]);
    });

    it('uses exact hidden metadata supplied only to the omniscient bot', function() {
        const hiddenOne = [{ facedown: true, location: 'province 1' }];
        const hiddenTwo = [{ facedown: true, location: 'province 2' }];
        const known = [
            {
                id: 'shameful-display', name: 'Shameful Display', location: 'province 1',
                strength: 3, abilityClass: 'action', eminent: false
            },
            {
                id: 'tsuma', name: 'Tsuma', location: 'province 2',
                strength: 3, abilityClass: 'none', eminent: false
            }
        ];

        expect(new ProvinceTargetingTactics().rank([hiddenOne, hiddenTwo], known))
            .toEqual([hiddenTwo, hiddenOne]);
    });

    it('allows a deck profile to override exceptional province priority', function() {
        const profile = {
            ...PROVINCE_TARGETING_DEFAULTS,
            abilityPriority: { ...PROVINCE_TARGETING_DEFAULTS.abilityPriority },
            effectiveStrengthById: { ...PROVINCE_TARGETING_DEFAULTS.effectiveStrengthById },
            priorityTierById: { 'must-break-first': -1, 'leave-for-last': 1 }
        };
        const ranked = new ProvinceTargetingTactics(profile).rank([
            list('leave-for-last', 'province 1', 1, 'none'),
            list('ordinary', 'province 2', 3, 'none'),
            list('must-break-first', 'province 3', 9, 'action')
        ]);

        expect(ids(ranked)).toEqual(['must-break-first', 'ordinary', 'leave-for-last']);
    });

    it('lets reveal decks prefer unknown provinces over easier exposed provinces', function() {
        const profile = {
            ...PROVINCE_TARGETING_DEFAULTS,
            preferFacedown: true,
            abilityPriority: { ...PROVINCE_TARGETING_DEFAULTS.abilityPriority },
            effectiveStrengthById: { ...PROVINCE_TARGETING_DEFAULTS.effectiveStrengthById },
            priorityTierById: { ...PROVINCE_TARGETING_DEFAULTS.priorityTierById }
        };
        const hidden = [{ facedown: true, location: 'province 1' }];
        const exposed = list('exposed', 'province 2', 1, 'none');

        expect(new ProvinceTargetingTactics(profile).rank([exposed, hidden])[0]).toBe(hidden);
    });

    // Public-information targeting. Every input below is visible to both
    // players, so these apply to the fair bot, unlike the `known` metadata.
    describe('public information', function() {
        const tuned = (overrides) => new ProvinceTargetingTactics({
            ...PROVINCE_TARGETING_DEFAULTS,
            abilityPriority: { ...PROVINCE_TARGETING_DEFAULTS.abilityPriority },
            effectiveStrengthById: { ...PROVINCE_TARGETING_DEFAULTS.effectiveStrengthById },
            priorityTierById: { ...PROVINCE_TARGETING_DEFAULTS.priorityTierById },
            ...overrides
        });

        it('is inert at its defaults, so V1 ordering is unchanged', function() {
            const hidden = [{ facedown: true, location: 'province 1' }];
            const exposed = list('exposed', 'province 2', 4, 'none');
            const denial = { 'province 1': { denial: 9, holdingStrength: 3 } };

            expect(ids(new ProvinceTargetingTactics().rank([hidden, exposed], [], denial)))
                .toEqual(ids(new ProvinceTargetingTactics().rank([hidden, exposed])));
        });

        it('prefers a revealed province: its reveal effect cannot spring', function() {
            const hidden = [{ facedown: true, location: 'province 1' }];
            const exposed = list('exposed', 'province 2', 5, 'none');

            expect(tuned({ faceupProvinceDiscount: 99 }).rank([hidden, exposed])[0]).toBe(exposed);

            // A small discount only breaks near-ties. A revealed 6 stays behind
            // an unknown 4 at discount 1, and passes it at discount 3.
            const tough = list('tough', 'province 2', 6, 'none');
            expect(tuned({ faceupProvinceDiscount: 1 }).rank([hidden, tough])[0]).toBe(hidden);
            expect(tuned({ faceupProvinceDiscount: 3 }).rank([hidden, tough])[0]).toBe(tough);
        });

        it('attacks the province holding an unbought character to discard it', function() {
            const plain = [{ facedown: true, location: 'province 1' }];
            const stacked = [{ facedown: true, location: 'province 2' }];
            const denial = { 'province 2': { denial: 2.5, holdingStrength: 0 } };

            expect(tuned({ faceupDynastyDenialWeight: 1 })
                .rank([plain, stacked], [], denial)[0]).toBe(stacked);
        });

        it('reads a faceup holding bonus as strength on a province still facedown', function() {
            const bare = [{ facedown: true, location: 'province 1' }];
            const fortified = [{ facedown: true, location: 'province 2' }];
            const denial = { 'province 2': { denial: 0, holdingStrength: 2 } };

            expect(tuned({ faceupHoldingStrengthWeight: 1 })
                .rank([bare, fortified], [], denial)[0]).toBe(bare);
        });

        it('does not double-count a holding already inside a revealed strength', function() {
            const revealed = list('revealed', 'province 1', 4, 'none');
            const bare = [{ facedown: true, location: 'province 2' }];
            const denial = { 'province 1': { denial: 0, holdingStrength: 5 } };

            // `strengthSummary` already carries the holding, so the revealed
            // province stays at 4 and ties the unknown 4 on board order.
            expect(ids(tuned({ faceupHoldingStrengthWeight: 1 })
                .rank([revealed, bare], [], denial))).toEqual(['revealed', 'province 2']);
        });
    });
});
