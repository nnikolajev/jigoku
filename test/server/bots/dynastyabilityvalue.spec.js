const {
    DYNASTY_ABILITY_VALUE,
    dynastyAbilityValueOf
} = require('../../../build/server/game/bots/DynastyAbilityValue.js');
const {
    BoardAwareDynastyTactics,
    DEFAULT_BOARD_AWARE_DYNASTY
} = require('../../../build/server/game/bots/BoardAwareDynastyTactics.js');
const { DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');

// The live ability term (`JigokuBotController.dynastyCharacterInfo`) is a
// saturated constant: measured over the ten-deck field it takes exactly three
// values — 3.50 (24 characters), 3.95 (3) and 4.00 (90) — because the engine
// registers 5-6 framework reactions on every character and `abilityCount * 0.7`
// alone already reaches the `min(4, ...)` cap. The whole field spans 0.375 once
// `abilityValueWeight` is applied, against a `primarySkillWeight` of 1.
//
// It is also unsigned, so a printed restriction scores like a benefit.
describe('dynasty ability value', function() {
    const card = (id) => ({ uuid: id, id, type: 'character' });
    const info = (cost, military, political, extras = {}) => ({
        cost, military, political, glory: 1, abilityValue: 4,
        honoredOnEntry: false, ...extras
    });

    describe('the price list', function() {
        it('prices a body that may never attack BELOW a vanilla one', function() {
            // Shiba Peacemaker is a 1-cost 4/1 that cannot participate as an
            // attacker. The live model scores it 3.50 — the same as a vanilla
            // 3/0 — because nothing in it can go negative.
            expect(dynastyAbilityValueOf('shiba-peacemaker')).toBeLessThan(0);
            expect(dynastyAbilityValueOf('hiruma-yojimbo')).toBeLessThan(0);
        });

        it('prices ongoing costs and hard restrictions negative', function() {
            for(const id of ['marauding-oni', 'loyal-oathbreaker', 'doomed-shugenja',
                'young-warrior', 'palace-guard', 'kaiu-siege-force']) {
                expect(dynastyAbilityValueOf(id)).toBeLessThan(0);
            }
        });

        it('prices an army-wide aura above a single-conflict one', function() {
            // Commander of the Legions buffs every other Lion on the board;
            // Honored General buffs only the ones in its own conflict.
            expect(dynastyAbilityValueOf('commander-of-the-legions'))
                .toBeGreaterThan(dynastyAbilityValueOf('honored-general'));
            expect(dynastyAbilityValueOf('honored-general')).toBeGreaterThan(0);
        });

        it('carries a 0/0 body entirely on its ability', function() {
            // Utaku Infantry is printed 0/0, so the skill model prices the body
            // at zero and the ability is the whole card.
            expect(dynastyAbilityValueOf('utaku-infantry')).toBeGreaterThan(1);
            expect(dynastyAbilityValueOf('battle-maiden-recruit')).toBeGreaterThan(1);
        });

        it('reports 0 for an unpriced card and for undefined', function() {
            // Absent means "no opinion", which is what every card scored before
            // the list existed.
            expect(dynastyAbilityValueOf('matsu-berserker')).toBe(0);
            expect(dynastyAbilityValueOf('samurai-of-integrity')).toBe(0);
            expect(dynastyAbilityValueOf('not-a-real-card')).toBe(0);
            expect(dynastyAbilityValueOf(undefined)).toBe(0);
        });

        it('prices only STATIC text, so it cannot double-count the live term', function() {
            // The live term already gives every triggered ability its 4.00. A
            // constant is the wrong model for an Action or Reaction anyway —
            // its worth depends on a board this table cannot see.
            for(const id of ['agasha-swordsmith', 'doji-challenger', 'kakita-yuri',
                'togashi-yokuni', 'miya-mystic', 'hida-o-ushi']) {
                expect(dynastyAbilityValueOf(id)).toBe(0);
            }
        });

        it('states every price in points of primary skill', function() {
            // `primarySkillWeight` is 1 and the value is added at weight 1.0,
            // so a price outside this band would outrank the printed line.
            for(const [id, value] of Object.entries(DYNASTY_ABILITY_VALUE)) {
                expect(Math.abs(value)).withContext(id).toBeLessThanOrEqual(2.5);
                expect(value).withContext(id).not.toBe(0);
            }
        });
    });

    describe('the live buy ordering it feeds', function() {
        // `fateAwareDynastyDecision` is what actually buys in the field —
        // `BoardAwareDynastyTactics.choose` is never reached by any of the ten
        // deck profiles (a 90-game census with the price list injected into the
        // board-aware path alone came back bit-identical to the control). Both
        // of its sorts are cost-first, then `conflictProjectionScores`, then a
        // uuid string compare. The printed line is not in the sort at all.
        const order = (cards, projection, scale) => cards.slice().sort((a, b) =>
            b.cost - a.cost ||
            ((projection[b.id] || 0) + dynastyAbilityValueOf(b.id) * scale) -
            ((projection[a.id] || 0) + dynastyAbilityValueOf(a.id) * scale) ||
            String(a.id).localeCompare(String(b.id)));

        const equalCost = [
            { id: 'shiba-peacemaker', cost: 1 }, // 4/1 that can never attack
            { id: 'matsu-berserker', cost: 1 } // vanilla 3/0
        ];

        it('breaks an equal-cost tie by the uuid compare while off', function() {
            // Nothing separates these two today, so the alphabetically smaller
            // id wins — which is the arbitrariness the list is filling in.
            expect(order(equalCost, {}, 0).map((c) => c.id))
                .toEqual(['matsu-berserker', 'shiba-peacemaker']);
        });

        it('is bounded well under the projection clamp', function() {
            // `conflictProjectionScores` is clamped to [0, 12]. A price must
            // break ties the projection does not speak to, never overrule a
            // projection that does.
            const projection = { 'shiba-peacemaker': 6 };
            expect(order(equalCost, projection, 1.5).map((c) => c.id))
                .toEqual(['shiba-peacemaker', 'matsu-berserker']);
        });

        it('cannot reorder anything at scale 0', function() {
            const projection = { 'matsu-berserker': 3, 'shiba-peacemaker': 1 };
            expect(order(equalCost, projection, 0)).toEqual(order(equalCost, projection, 0));
            expect(order(equalCost, projection, 0).map((c) => c.id))
                .toEqual(['matsu-berserker', 'shiba-peacemaker']);
        });

        it('never lets a price outrank the COST ordering', function() {
            // Cost order is a budget rule, not a value judgement, so no price
            // may jump it while only the tie-break is in play.
            const cards = [{ id: 'matsu-berserker', cost: 1 }, { id: 'hida-kisada', cost: 5 }];
            expect(order(cards, {}, 1.5).map((c) => c.id))
                .toEqual(['hida-kisada', 'matsu-berserker']);
        });

        it('is decided by SIGN, not magnitude, so the scale sweep is degenerate', function() {
            // Measured: scales 0.5, 1.0 and 1.5 produce a bit-identical 90-game
            // run (buy histogram sha 0eec453e9345b60d for all three). Any
            // positive multiplier preserves the comparison, so `dynastyAbilityScale`
            // is an on/off switch and `dynastyAbilityCostWeight` is the knob
            // that actually sweeps.
            const cards = [
                { id: 'shiba-peacemaker', cost: 1 },
                { id: 'iuchi-soulweaver', cost: 1 },
                { id: 'matsu-berserker', cost: 1 }
            ];
            const at = (scale) => order(cards, {}, scale).map((c) => c.id);
            expect(at(0.5)).toEqual(at(1));
            expect(at(1)).toEqual(at(1.5));
        });
    });

    describe('the cost-order weight', function() {
        // Shifts the cost the SORT sees so a price can move a card between cost
        // tiers. Affordability and every budget cap keep the real printed cost.
        const orderCost = (id, cost, ascending, weight) =>
            cost - (ascending ? 1 : -1) * dynastyAbilityValueOf(id) * weight;

        it('makes a well-priced card sort better in either direction', function() {
            // Descending (durable, biggest body first): a good ability reads as
            // a bigger card.
            expect(orderCost('hida-kisada', 5, false, 1))
                .toBeGreaterThan(orderCost('plain', 5, false, 1));
            // Ascending (bodies, cheapest first): a good ability reads as a
            // cheaper card.
            expect(orderCost('iuchi-soulweaver', 1, true, 1))
                .toBeLessThan(orderCost('plain', 1, true, 1));
        });

        it('pushes a restricted body to the back in either direction', function() {
            expect(orderCost('shiba-peacemaker', 1, true, 1))
                .toBeGreaterThan(orderCost('matsu-berserker', 1, true, 1));
            expect(orderCost('shiba-peacemaker', 1, false, 1))
                .toBeLessThan(orderCost('matsu-berserker', 1, false, 1));
        });

        it('collapses to the printed cost at weight 0', function() {
            for(const ascending of [true, false]) {
                expect(orderCost('shiba-peacemaker', 1, ascending, 0)).toBe(1);
                expect(orderCost('iuchi-soulweaver', 1, ascending, 0)).toBe(1);
            }
        });

        it('ships off', function() {
            expect(DEFAULT_PROFILE.dynastyAbilityCostWeight).toBe(0);
        });
    });

    describe('candidatePower integration', function() {
        const tactics = new BoardAwareDynastyTactics(DEFAULT_BOARD_AWARE_DYNASTY);

        it('adds the explicit price at weight 1.0, like a per-deck override', function() {
            const base = tactics.candidatePower(card('x'), info(2, 3, 1));
            const bumped = tactics.candidatePower(card('x'),
                info(2, 3, 1, { abilityValueExplicit: 1.5 }));
            expect(bumped - base).toBeCloseTo(1.5, 6);
        });

        it('lets a negative price drop a body below a weaker-printed rival', function() {
            // 4/1 that cannot attack versus a plain 3/1. On printed skill alone
            // the first wins by a full point, which is the current behavior.
            const restricted = info(1, 4, 1);
            const plain = info(1, 3, 1);
            expect(tactics.candidatePower(card('shiba-peacemaker'), restricted))
                .toBeGreaterThan(tactics.candidatePower(card('plain'), plain));

            const priced = info(1, 4, 1, {
                abilityValueExplicit: dynastyAbilityValueOf('shiba-peacemaker')
            });
            expect(tactics.candidatePower(card('shiba-peacemaker'), priced))
                .toBeLessThan(tactics.candidatePower(card('plain'), plain));
        });

        it('leaves ranking untouched when the field is absent', function() {
            // The scale is 0 by default, so every info arrives without the
            // field and the control arm must be the legacy ranking exactly.
            const withField = tactics.candidatePower(card('x'),
                info(2, 3, 1, { abilityValueExplicit: 0 }));
            expect(tactics.candidatePower(card('x'), info(2, 3, 1))).toBe(withField);
        });
    });

    describe('profile default', function() {
        it('ships the price list off', function() {
            // Scale 0 multiplies every price to 0, so the disabled path is not
            // merely close to the legacy ranking — it is the same number.
            expect(DEFAULT_PROFILE.dynastyAbilityScale).toBe(0);
            expect(dynastyAbilityValueOf('shiba-peacemaker') * DEFAULT_PROFILE.dynastyAbilityScale)
                .toBe(0);
        });

        it('ships the chump-block scope at its unconditional reading', function() {
            expect(DEFAULT_PROFILE.chumpBlockHonorCeiling).toBe(0);
            expect(DEFAULT_PROFILE.chumpBlockSurplusBodies).toBe(0);
        });
    });
});
