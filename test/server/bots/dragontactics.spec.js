const { DragonTactics, DRAGON_DEFAULTS } = require('../../../build/server/game/bots/DragonTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the monk/card-engine layer (Dragon Togashi Mitsu): strategy
// derivation, profile gating, and the tactic decisions.
describe('DragonTactics', function() {
    const tactics = new DragonTactics(DRAGON_DEFAULTS);
    const MONK = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, glory: false, monk: true };

    describe('strategy derivation', function() {
        it('flips monk on for the Dragon stronghold or the Kiho marker set', function() {
            expect(deriveDeckStrategy(['high-house-of-light']).monk).toBe(true);
            expect(deriveDeckStrategy(['togashi-mitsu-2', 'void-fist', 'hurricane-punch', 'swell-of-seafoam']).monk).toBe(true);
        });

        it('stays off for the other piloted decks', function() {
            expect(deriveDeckStrategy(['isawa-mori-seido']).monk).toBe(false);
            expect(deriveDeckStrategy(['cavalry-reserves', 'ride-on', 'spoils-of-war', 'curved-blade']).monk).toBe(false);
            expect(deriveDeckStrategy([]).monk).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a monk strategy carries the dragon knobs; generic attack/defense stays', function() {
            const p = profileFromStrategy(MONK);
            expect(p.dragon).toEqual(DRAGON_DEFAULTS);
            expect(p.attackCommitment).toBe('all-but-one');
            expect(p.defenseCommitment).toBe('prevent-break');
            expect(profileFromStrategy({ ...MONK, monk: false }).dragon).toBeUndefined();
        });

        it('parks Sacred Sanctuary under the stronghold', function() {
            const profile = resolveDeckProfile(['sacred-sanctuary', 'high-house-of-light'], MONK);
            expect(profile.strongholdProvinceId).toBe('sacred-sanctuary');
            expect(profile.defenseCommitment).toBe('prevent-break');
            expect(profile.spendCardsOnDefense).toBe(false);
            expect(profile.preventBreakAfterBrokenProvinces).toBe(2);
            expect(resolveDeckProfile(['high-house-of-light'], MONK).strongholdProvinceId).toBeUndefined();
        });
    });

    describe('decisions', function() {
        it('boosts the void ring per Keeper Initiate in the dynasty discard', function() {
            expect(tactics.ringBonus('void', [{ id: 'keeper-initiate' }, { id: 'keeper-initiate' }])).toBe(2 * DRAGON_DEFAULTS.voidRecursionBonus);
            expect(tactics.ringBonus('void', [])).toBe(0);
            expect(tactics.ringBonus('earth', [{ id: 'keeper-initiate' }])).toBe(0);
        });

        it('uses the exact live threshold and counts both players for Togashi Ichi', function() {
            expect(tactics.cardTargets([{ id: 'togashi-mitsu-2', inConflict: true }], true)).toEqual([5]);
            expect(tactics.cardTargets([{ id: 'teacher-of-empty-thought', inConflict: true }], true)).toEqual([3]);
            expect(tactics.cardTargets([{ id: 'togashi-ichi', inConflict: true }], true)).toEqual([10]);
            expect(tactics.cardTargets([{ id: 'togashi-ichi', inConflict: true }], true, 2, 3)).toEqual([7]);
            expect(tactics.cardTargets([{ id: 'togashi-ichi', inConflict: true }], false)).toEqual([]);
            expect(tactics.cardTargets([{ id: 'togashi-ichi', inConflict: false }], true)).toEqual([]);
            expect(tactics.cardTargets([{ id: 'togashi-initiate', inConflict: true }], true, 0, 0, true)).toEqual([5]);
            expect(tactics.cardTargets([{ id: 'togashi-ichi', inConflict: true }], true, 0, 0, false, true)).toEqual([]);
        });

        it('holds High House for five only while its fate bonus is worth chasing', function() {
            expect(tactics.allowsCardCountOvercommit()).toBe(true);
            expect(tactics.strongholdReady(5)).toBe(true);
            expect(tactics.strongholdReady(4)).toBe(false);
            expect(tactics.strongholdReady(1)).toBe(false);
            expect(tactics.strongholdReady(1, false)).toBe(true);
            // cardsPlayed includes Shintao Monastery's virtual card.
            expect(tactics.canReachTarget(1, 4, 5)).toBe(true);
            expect(tactics.canReachTarget(1, 3, 5)).toBe(false);
        });

        it('projects ring fate from a played producer or a Dreamer Kiho trigger', function() {
            const monkWithFate = { id: 'togashi-initiate', inConflict: true, fate: 1 };
            const dreamer = { id: 'togashi-dreamer', inConflict: true, fate: 0 };

            expect(tactics.canCreateRingFate([{ id: 'written-in-the-stars' }], [monkWithFate])).toBe(true);
            expect(tactics.canCreateRingFate([{ id: 'army-of-the-rising-wave' }], [monkWithFate])).toBe(true);
            expect(tactics.canCreateRingFate([{ id: 'hurricane-punch' }], [dreamer, monkWithFate])).toBe(true);
            expect(tactics.canCreateRingFate([{ id: 'hurricane-punch' }], [monkWithFate])).toBe(false);
            expect(tactics.canCreateRingFate([{ id: 'banzai' }], [dreamer, monkWithFate])).toBe(false);
        });

        it('build-around attachments go to Mitsu first', function() {
            const mine = [{ id: 'togashi-tadakatsu' }, { id: 'togashi-mitsu-2' }];
            expect(tactics.pickKeyCharacter(mine).id).toBe('togashi-mitsu-2');
            expect(tactics.pickKeyCharacter([{ id: 'togashi-initiate' }])).toBeNull();
        });

        it('puts Way of the Dragon only on repeatable high-value abilities', function() {
            const mine = [
                { id: 'togashi-ichi' },
                { id: 'teacher-of-empty-thought' },
                { id: 'togashi-mitsu-2', attachments: [{ id: 'way-of-the-dragon' }] },
                { id: 'tranquil-philosopher' }
            ];
            expect(tactics.pickWayCharacter(mine).id).toBe('tranquil-philosopher');
            expect(tactics.pickWayCharacter([{ id: 'togashi-ichi' }])).toBeNull();
            expect(tactics.pickWayCharacter([{ id: 'kitsuki-investigator' }])).toBeNull();
            expect(tactics.wayAbilityPeriod(mine[2])).toBe('round');
            expect(tactics.wayAbilityPeriod(mine[1])).toBeNull();
        });

        it('spreads Way copies instead of stacking them on one action character', function() {
            const mine = [
                { id: 'togashi-mitsu-2', attachments: [{ id: 'way-of-the-dragon' }] },
                { id: 'tranquil-philosopher', attachments: [{ id: 'way-of-the-dragon' }] },
                { id: 'teacher-of-empty-thought', attachments: [] }
            ];
            expect(tactics.pickWayCharacter(mine).id).toBe('teacher-of-empty-thought');
        });

        it('invests fate in towers and preserves them while Cycle digs', function() {
            expect(tactics.desiredAdditionalFate('togashi-mitsu-2', 4)).toBe(4);
            expect(tactics.desiredAdditionalFate('togashi-ichi', 4)).toBe(2);
            expect(tactics.desiredAdditionalFate('teacher-of-empty-thought', 3)).toBe(2);
            expect(tactics.desiredAdditionalFate('togashi-initiate', 1)).toBeNull();
            expect(tactics.shouldPreserveProvinceCharacter({ id: 'kitsuki-investigator' })).toBe(true);
            expect(tactics.shouldPreserveProvinceCharacter({ id: 'togashi-initiate' })).toBe(false);
        });

        it('orders Ancient Master finds for the card-count engine', function() {
            const pick = tactics.pickAncientMasterCard([
                { id: 'iron-foundations-stance' },
                { id: 'void-fist' },
                { id: 'togashi-acolyte' }
            ]);
            expect(pick.id).toBe('togashi-acolyte');
        });

        it('counts Keeper Initiates in PROVINCES toward the void ring, not only the discard', function() {
            const ring = (profile) => new DragonTactics({
                ...DRAGON_DEFAULTS,
                ringPriority: { ...DRAGON_DEFAULTS.ringPriority, ...profile }
            });
            const discard = [{ id: 'keeper-initiate' }];
            const provinces = [{ id: 'keeper-initiate' }, { id: 'togashi-ichi' }];

            // Shipped: the province copy counts too.
            expect(ring({}).ringBonus('void', discard, provinces))
                .toBe(2 * DRAGON_DEFAULTS.voidRecursionBonus);
            // Off: only the discard copy counts, exactly as V1 did.
            expect(ring({ countKeepersInProvinces: false }).ringBonus('void', discard, provinces))
                .toBe(DRAGON_DEFAULTS.voidRecursionBonus);
            expect(ring({}).ringBonus('fire', discard, provinces)).toBe(0);
        });

        it('ships the fate bar at the generic reading (raising it measured null)', function() {
            expect(tactics.ringFateDominanceThreshold()).toBeNull();
            expect(new DragonTactics({
                ...DRAGON_DEFAULTS,
                ringPriority: { ...DRAGON_DEFAULTS.ringPriority, fateDominanceThreshold: 2 }
            }).ringFateDominanceThreshold()).toBe(2);
        });

        it('ships the unhonored-tower fire bonus OFF (it measured negative)', function() {
            const ring = new DragonTactics({
                ...DRAGON_DEFAULTS,
                ringPriority: { ...DRAGON_DEFAULTS.ringPriority, unhonoredTowerFireBonus: 45 }
            });

            expect(tactics.ringElementPlanBonus('fire', [{ id: 'togashi-mitsu-2' }])).toBe(0);
            expect(ring.ringElementPlanBonus('fire', [{ id: 'togashi-mitsu-2' }])).toBe(45);
            expect(ring.ringElementPlanBonus('fire', [{ id: 'togashi-mitsu-2', isHonored: true }])).toBe(0);
            expect(ring.ringElementPlanBonus('fire', [{ id: 'keeper-initiate' }])).toBe(0);
            expect(ring.ringElementPlanBonus('void', [{ id: 'togashi-mitsu-2' }])).toBe(0);
        });

        describe('Tranquil Philosopher fate move', function() {
            const philosopher = new DragonTactics({
                ...DRAGON_DEFAULTS,
                ringPriority: { ...DRAGON_DEFAULTS.ringPriority, enabled: true }
            });
            const rings = (fateByElement) => ['air', 'earth', 'fire', 'water', 'void']
                .map((element) => ({ element, fate: fateByElement[element] || 0, claimed: false }));

            it('is off unless the ring plan is on', function() {
                const off = new DragonTactics({
                    ...DRAGON_DEFAULTS,
                    ringPriority: { ...DRAGON_DEFAULTS.ringPriority, philosopherFateMove: false }
                });
                expect(off.philosopherPlanActive()).toBe(false);
                expect(off.philosopherShouldMoveFate(rings({ air: 1 }), 'void')).toBe(false);
                expect(philosopher.philosopherPlanActive()).toBe(true);
            });

            it('names the emptiest other ring as donor when the move is not worth making', function() {
                // Every ring empty: nothing to carry, so the move no-ops and the
                // ability still collects its honor rider. The donor must never be
                // the ring we want.
                expect(philosopher.philosopherDonorRing(rings({}), 'void').fate).toBe(0);
                expect(philosopher.philosopherDonorRing(rings({}), 'void').element).not.toBe('void');
                // A pile too big to break up stays where it is.
                expect(philosopher.philosopherDonorRing(rings({ air: 3 }), 'void').fate).toBe(0);
            });

            it('carries a stray fate onto the ring the plan wants', function() {
                expect(philosopher.philosopherShouldMoveFate(rings({ air: 1 }), 'void')).toBe(true);
                expect(philosopher.philosopherDonorRing(rings({ air: 1 }), 'void').element).toBe('air');
            });

            it('breaks up a single 2-fate ring rather than attacking the wrong element', function() {
                expect(philosopher.philosopherShouldMoveFate(rings({ air: 2 }), 'void')).toBe(true);
                expect(philosopher.philosopherDonorRing(rings({ air: 2 }), 'void').element).toBe('air');
            });

            it('leaves a real pile alone', function() {
                // Two rich rings: a pile exists whichever way the choice goes.
                expect(philosopher.philosopherShouldMoveFate(rings({ air: 2, fire: 2 }), 'void')).toBe(false);
                // One pile too big to break up.
                expect(philosopher.philosopherShouldMoveFate(rings({ air: 3 }), 'void')).toBe(false);
            });

            it('does nothing with every ring empty, or with the fate already where we want it', function() {
                expect(philosopher.philosopherShouldMoveFate(rings({}), 'void')).toBe(false);
                expect(philosopher.philosopherShouldMoveFate(rings({ void: 1 }), 'void')).toBe(false);
            });

            it('never names a claimed ring as the donor', function() {
                const board = rings({ air: 2 }).map((ring) =>
                    ring.element === 'air' ? { ...ring, claimed: true } : ring);
                expect(philosopher.philosopherShouldMoveFate(board, 'void')).toBe(false);
                expect(philosopher.philosopherDonorRing(board, 'void').claimed).toBeFalsy();
            });
        });

        it('uses Void Fist only when an opposing participant is a legal military target', function() {
            const shouldPlay = require('../../../build/server/game/bots/CardPlaybook.js')
                .getPlaybookEntry('void-fist').shouldPlay;
            const monk = { id: 'togashi-ichi', inConflict: true, bowed: false,
                militarySkillSummary: { stat: '6' } };
            const enemy = (military) => ({ id: 'enemy', inConflict: true, bowed: false,
                militarySkillSummary: { stat: String(military) } });

            expect(shouldPlay({ cardsPlayed: 2, myCharacters: [monk], opponentCharacters: [enemy(9)] })).toBe(false);
            expect(shouldPlay({ cardsPlayed: 2, myCharacters: [monk], opponentCharacters: [enemy(6)] })).toBe(true);
            expect(shouldPlay({ cardsPlayed: 2, myCharacters: [{ ...monk, bowed: true }], opponentCharacters: [enemy(6)] })).toBe(true);
        });
    });
});
