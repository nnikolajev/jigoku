const { RebirthTactics, REBIRTH_DEFAULTS } = require('../../../build/server/game/bots/RebirthTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const { loadPhoenixPhoenixDeck } = require('../../../tools/selfplay/deckLoader.js');

// Locks the Fushicho rotation layer (Phoenix "Phoenix", EmeraldDB 7b7f54b8):
// strategy derivation, profile gating, and the decisions whose legality the
// card text hides.
describe('RebirthTactics', function() {
    const tactics = new RebirthTactics(REBIRTH_DEFAULTS);
    const body = (id, extra = {}) => Object.assign({ uuid: id, id, type: 'character' }, extra);

    function deckIds() {
        const deck = loadPhoenixPhoenixDeck();
        return [
            ...deck.stronghold, ...deck.role, ...deck.provinceCards,
            ...deck.dynastyCards, ...deck.conflictCards
        ].map((entry) => entry.card.id);
    }

    describe('strategy derivation', function() {
        it('flips rebirth on for the Fushicho + Echoes pair', function() {
            expect(deriveDeckStrategy(['fushicho', 'forebearer-s-echoes']).rebirth).toBe(true);
        });

        it('stays off for a deck with only ONE half of the pair', function() {
            // The Phoenix Shugenja list runs Fushicho as a plain 6/6 tower and
            // the Lion Swarm list runs Forebearer's Echoes. Neither is this deck.
            expect(deriveDeckStrategy(['fushicho', 'kyuden-isawa']).rebirth).toBe(false);
            expect(deriveDeckStrategy(['forebearer-s-echoes', 'emperor-s-summons', 'a-season-of-war']).rebirth).toBe(false);
        });

        it('stays off for every other piloted archetype', function() {
            expect(deriveDeckStrategy(['cavalry-reserves', 'ride-on', 'spoils-of-war']).rebirth).toBe(false);
            expect(deriveDeckStrategy(['city-of-the-open-hand']).rebirth).toBe(false);
            expect(deriveDeckStrategy(['iron-mountain-castle']).rebirth).toBe(false);
            expect(deriveDeckStrategy([]).rebirth).toBe(false);
        });

        it('derives rebirth AND shugenja for the real decklist', function() {
            const strategy = deriveDeckStrategy(deckIds());
            expect(strategy.rebirth).toBe(true);
            // The deck runs Kyuden Isawa, so the spell package applies too.
            expect(strategy.shugenja).toBe(true);
            expect(strategy.glory).toBe(false);
            expect(strategy.aggressive).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a rebirth strategy carries the rebirth knobs', function() {
            expect(profileFromStrategy({ rebirth: true }).rebirth).toBeDefined();
            expect(profileFromStrategy({ shugenja: true }).rebirth).toBeUndefined();
            expect(profileFromStrategy({ aggressive: true }).rebirth).toBeUndefined();
            expect(profileFromStrategy(undefined).rebirth).toBeUndefined();
        });

        it('resolves the deck override and parks Entrenched Position under the stronghold', function() {
            const ids = deckIds();
            const profile = resolveDeckProfile(ids, deriveDeckStrategy(ids));
            expect(profile.overrideNames).toContain('phoenix-phoenix-fushicho-rotation');
            // Entrenched Position took the slot in the province revision:
            // +5.69pp (docs/bot-entrenched-position-province.md). Retire to
            // the Brotherhood stays in the deck as an outer province.
            expect(profile.strongholdProvinceId).toBe('entrenched-position');
            // Ring steering has exactly one owner here.
            expect(profile.shugenja.ringCardBonus).toBe(0);
        });

        it('never hands two resolved bots the same nested profile object', function() {
            const ids = deckIds();
            const strategy = deriveDeckStrategy(ids);
            const first = resolveDeckProfile(ids, strategy);
            const second = resolveDeckProfile(ids, strategy);
            expect(first.rebirth).not.toBe(second.rebirth);
            expect(first.rebirth.recursionValueById).not.toBe(second.rebirth.recursionValueById);
            first.rebirth.recursionValueById.fushicho = -999;
            expect(second.rebirth.recursionValueById.fushicho).toBe(REBIRTH_DEFAULTS.recursionValueById.fushicho);
        });
    });

    describe('Fushicho recursion', function() {
        it('excludes NEUTRAL characters — the interrupt is Phoenix-only', function() {
            // Kudaka and Miya Mystic are faction `neutral` even though both are
            // Shugenja in this deck, so neither is a legal target.
            const targets = tactics.recursionTargets([
                body('kudaka'), body('miya-mystic'), body('isawa-tsuke-2')
            ]);
            expect(targets.map((card) => card.id)).toEqual(['isawa-tsuke-2']);
        });

        it('excludes a unique whose copy is already on the board', function() {
            const discard = [body('isawa-tsuke-2'), body('solemn-scholar')];
            const targets = tactics.recursionTargets(discard, [body('isawa-tsuke-2')]);
            expect(targets.map((card) => card.id)).toEqual(['solemn-scholar']);
        });

        it('chains a second Fushicho ahead of every other body', function() {
            const pick = tactics.pickRecursionTarget([
                body('isawa-tsuke-2'), body('fushicho'), body('asako-azunami')
            ]);
            expect(pick.id).toBe('fushicho');
        });

        it('refuses to buy Fushicho with an empty discard, and buys it once fed', function() {
            expect(tactics.shouldPlayFushicho({ roundNumber: 1, dynastyDiscardBodies: [] })).toBe(false);
            // A Season of War fills the discard in round one, which legitimately
            // turns the gate on early.
            expect(tactics.shouldPlayFushicho({
                roundNumber: 1,
                dynastyDiscardBodies: [body('young-philosopher')]
            })).toBe(true);
            // A discard holding only neutral bodies is still no target.
            expect(tactics.shouldPlayFushicho({
                roundNumber: 3,
                dynastyDiscardBodies: [body('kudaka')]
            })).toBe(false);
        });

        it('passes over Fushicho in the dynasty buy when the gate fails', function() {
            const playable = [body('fushicho'), body('isawa-tsuke-2')];
            const costs = { fushicho: 6, 'isawa-tsuke-2': 5 };
            expect(tactics.pickDynastyCard(playable, costs, 7, [], []).id).toBe('isawa-tsuke-2');
            expect(tactics.pickDynastyCard(playable, costs, 7, [], [body('solemn-scholar')]).id).toBe('fushicho');
        });

        it('ranks Forebearer\'s Echoes on the contested axis, not on long-term value', function() {
            const discard = [body('isawa-heiko'), body('isawa-tsuke-2')];
            // Heiko is a 0/5 and Tsuke a 5/4: the axis decides.
            expect(tactics.pickConflictBody(discard, 'military').id).toBe('isawa-tsuke-2');
            expect(tactics.pickConflictBody(discard, 'political').id).toBe('isawa-heiko');
        });
    });

    describe('zero-fate rotation', function() {
        it('asks for no fate on anything, including Fushicho', function() {
            expect(tactics.desiredAdditionalFate('fushicho')).toBe(0);
            expect(tactics.desiredAdditionalFate('isawa-tsuke-2')).toBe(0);
            expect(tactics.desiredAdditionalFate(undefined)).toBe(null);
        });
    });

    describe('ring steering', function() {
        it('wants air with Kudaka out and earth with Solemn Scholar out', function() {
            expect(tactics.ringBonus('air', [body('kudaka')], [])).toBeGreaterThan(0);
            expect(tactics.ringBonus('earth', [body('solemn-scholar')], [])).toBeGreaterThan(0);
            expect(tactics.ringBonus('air', [], [])).toBe(0);
        });

        it('counts a Feral Ningyo in HAND toward water — it enters play free there', function() {
            expect(tactics.ringBonus('water', [], [body('feral-ningyo')])).toBeGreaterThan(0);
        });

        it('steers AWAY from fire while Isawa Tsuke needs it unclaimed', function() {
            expect(tactics.ringBonus('fire', [body('isawa-tsuke-2')], [])).toBeLessThan(0);
            expect(tactics.ringBonus('fire', [], [])).toBe(0);
        });
    });

    describe('Ancestral Shrine', function() {
        const claimed = (element) => ({ element, claimed: true });

        it('frees a claimed fire ring to re-arm Isawa Tsuke even at full honor', function() {
            const returned = tactics.shrineReturnRings(
                [claimed('fire'), claimed('earth')], [body('isawa-tsuke-2')], 20);
            expect(returned.map((ring) => ring.element)).toEqual(['fire']);
        });

        it('holds earth claimed for Solemn Scholar when only topping up honor', function() {
            const returned = tactics.shrineReturnRings(
                [claimed('earth'), claimed('void')], [body('solemn-scholar')], 4);
            expect(returned.map((ring) => ring.element)).toEqual(['void']);
        });

        it('does nothing while honor is comfortable and nothing is blocked', function() {
            expect(tactics.shrineReturnRings([claimed('void')], [], 20)).toEqual([]);
        });
    });

    describe('Isawa Tsuke', function() {
        const skill = (card) => Number(card.skill) || 0;

        it('only strips bodies worth the honor', function() {
            const chaff = body('x', { fate: 1, skill: 1 });
            const tower = body('y', { fate: 3, skill: 5 });
            expect(tactics.tsukeTargets([chaff, tower], skill).map((card) => card.uuid)).toEqual(['y']);
        });

        it('never bids more honor than there are targets — the selector demands exactly that many', function() {
            const tower = body('y', { fate: 3, skill: 5 });
            expect(tactics.tsukeHonorSpend([tower], 20, skill)).toBe(1);
            expect(tactics.tsukeHonorSpend([], 20, skill)).toBe(0);
        });

        it('respects the honor floor — reaching zero loses the game outright', function() {
            const tower = body('y', { fate: 3, skill: 5 });
            expect(tactics.tsukeHonorSpend([tower], REBIRTH_DEFAULTS.tsukeHonorFloor, skill)).toBe(0);
        });
    });

    describe('Isawa Heiko', function() {
        const skill = (card, axis) => Number(card[axis]) || 0;

        it('swaps our own lopsided body onto the contested axis', function() {
            const heiko = body('isawa-heiko', { inConflict: true, military: 0, political: 5 });
            const swap = tactics.heikoSwapTarget([heiko], [], 'military', skill);
            expect(swap.own).toBe(true);
            expect(swap.gain).toBe(5);
        });

        it('takes the contested axis away from an enemy participant instead', function() {
            const mine = body('solemn-scholar', { inConflict: true, military: 1, political: 1 });
            const theirs = body('enemy', { inConflict: true, military: 6, political: 1 });
            const swap = tactics.heikoSwapTarget([mine], [theirs], 'military', skill);
            expect(swap.own).toBe(false);
            expect(swap.card.uuid).toBe('enemy');
        });

        it('declines a swap that gains nothing', function() {
            const even = body('x', { inConflict: true, military: 3, political: 3 });
            expect(tactics.heikoSwapTarget([even], [], 'military', skill)).toBe(null);
        });
    });

    describe('My Ancestor\'s Strength', function() {
        it('copies Fushicho\'s printed 6/6 onto a small participating Shugenja', function() {
            const dreamer = body('ethereal-dreamer', { inConflict: true, traits: ['shugenja', 'void'] });
            const plan = tactics.ancestorPlan([dreamer], [body('fushicho')], 'military');
            expect(plan.shugenja.id).toBe('ethereal-dreamer');
            expect(plan.ancestor.id).toBe('fushicho');
            expect(plan.gain).toBe(5);
        });

        it('never copies a printed DASH onto a military participant', function() {
            // Young Philosopher has a military dash; copying it would remove the
            // participant from the conflict entirely.
            const dreamer = body('ethereal-dreamer', { inConflict: true, traits: ['shugenja'] });
            expect(tactics.ancestorPlan([dreamer], [body('young-philosopher')], 'military')).toBe(null);
            // On the political axis it is a legal 4, and a real gain.
            expect(tactics.ancestorPlan([dreamer], [body('young-philosopher')], 'political').gain).toBe(3);
        });

        it('requires a SHUGENJA participant — Fushicho itself is not one', function() {
            const fushicho = body('fushicho', { inConflict: true, traits: ['creature', 'fire', 'mythic', 'spirit'] });
            expect(tactics.ancestorPlan([fushicho], [body('isawa-tsuke-2')], 'military')).toBe(null);
        });
    });

    describe('Benten\'s Touch', function() {
        it('never bows a neutral Shugenja — the cost is PHOENIX Shugenja only', function() {
            expect(tactics.pickBentenBow([body('kudaka'), body('miya-mystic')])).toBe(null);
            expect(tactics.pickBentenBow([body('solemn-scholar')]).id).toBe('solemn-scholar');
        });

        it('prefers bowing a body sitting at home over one carrying the conflict', function() {
            const home = body('solemn-scholar');
            const fighting = body('ethereal-dreamer', { inConflict: true });
            expect(tactics.pickBentenBow([fighting, home]).uuid).toBe(home.uuid);
        });

        it('honors the highest-glory unhonored participant', function() {
            const low = body('a', { glory: 1, inConflict: true });
            const high = body('b', { glory: 4, inConflict: true });
            expect(tactics.pickBentenHonorTarget([low, high]).uuid).toBe('b');
            expect(tactics.pickBentenHonorTarget([{ ...high, isHonored: true }])).toBe(null);
        });
    });

    describe('Inferno Guard Invoker', function() {
        it('takes the biggest glory while defending', function() {
            const small = body('a', { glory: 1, inConflict: true });
            const big = body('b', { glory: 4, inConflict: true });
            expect(tactics.pickInfernoTarget([small, big], false).uuid).toBe('b');
        });

        it('while attacking, only spends a body cheap enough to lose to the sacrifice', function() {
            const invested = body('a', { glory: 4, inConflict: true, fate: 3 });
            const disposable = body('b', { glory: 2, inConflict: true, fate: 0 });
            expect(tactics.pickInfernoTarget([invested, disposable], true).uuid).toBe('b');
            expect(tactics.pickInfernoTarget([invested], true)).toBe(null);
        });
    });

    describe('searches', function() {
        it('digs for Fushicho first', function() {
            expect(tactics.pickSearchTarget([body('solemn-scholar'), body('fushicho')]).id).toBe('fushicho');
        });

        it('throws away the least valuable province card, never a holding', function() {
            const holding = { uuid: 'h', id: 'forgotten-library', type: 'holding' };
            const chaff = body('ethereal-dreamer');
            expect(tactics.pickProvinceDiscard([holding, chaff]).uuid).toBe(chaff.uuid);
            // With nothing but holdings it still has to answer the prompt.
            expect(tactics.pickProvinceDiscard([holding]).uuid).toBe('h');
        });
    });

    describe('playbook entries', function() {
        it('prices My Ancestor\'s Strength from the discard, and refuses it with no Shugenja', function() {
            const entry = getPlaybookEntry('my-ancestor-s-strength');
            const ctx = {
                conflictType: 'military',
                liveEventPricing: true,
                myCharacters: [{ inConflict: true, traits: ['shugenja'], militarySkillSummary: { stat: '1' } }],
                dynastyDiscardBodies: [{ id: 'fushicho', type: 'character', military: 6, political: 6 }],
                dynastyDiscard: []
            };
            expect(entry.shouldPlay(ctx)).toBe(true);
            expect(entry.conflictContribution(ctx)).toBe(5);
            expect(entry.shouldPlay({ ...ctx, myCharacters: [] })).toBe(false);
        });

        it('gates Isawa Tsuke on fire being unclaimed and on a fate target', function() {
            const entry = getPlaybookEntry('isawa-tsuke-2');
            const base = {
                honor: 10,
                rings: [{ element: 'fire', claimed: false }],
                opponentCharacters: [{ inConflict: true, fate: 2 }]
            };
            expect(entry.shouldUseAction(base)).toBe(true);
            expect(entry.shouldUseAction({ ...base, rings: [{ element: 'fire', claimed: true }] })).toBe(false);
            expect(entry.shouldUseAction({ ...base, opponentCharacters: [{ inConflict: true, fate: 0 }] })).toBe(false);
            expect(entry.shouldUseAction({ ...base, honor: 3 })).toBe(false);
        });

        it('keeps the two dig cards out of the in-conflict card economy', function() {
            // Both are played from a no-conflict window by a dedicated branch;
            // inside a conflict they add nothing.
            expect(getPlaybookEntry('walking-the-way').shouldPlay({})).toBe(false);
            expect(getPlaybookEntry('way-of-the-phoenix').shouldPlay({})).toBe(false);
        });
    });
});
