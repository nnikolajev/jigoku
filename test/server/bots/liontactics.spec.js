const { LionTactics, LION_DEFAULTS } = require('../../../build/server/game/bots/LionTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the bushi-swarm layer (Lion precon): strategy derivation, profile
// gating (no other deck gets the tactics), and the tactic decisions.
describe('LionTactics', function() {
    const tactics = new LionTactics(LION_DEFAULTS);
    const AGGRO = { holdingEngine: false, defensive: false, aggressive: true, dishonor: false };

    describe('strategy derivation', function() {
        it('derives aggressive from the Lion swarm markers', function() {
            const strategy = deriveDeckStrategy(['way-of-the-lion', 'for-greater-glory', 'in-service-to-my-lord', 'hayaken-no-shiro']);
            expect(strategy.aggressive).toBe(true);
            expect(strategy.dishonor).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('the Lion override needs aggressive + the Lion stronghold', function() {
            const p = resolveDeckProfile(['hayaken-no-shiro', 'way-of-the-lion'], AGGRO);
            expect(p.lion).toEqual(LION_DEFAULTS);
            // Unicorn-proven defensive fixes ride along.
            expect(p.defenseCommitment).toBe('prevent-break');
            expect(p.spendCardsOnDefense).toBe(true);
            // The swarm's buffs want every body in the conflict.
            expect(p.attackCommitment).toBe('all');
            expect(p.aggressiveFate).toBe(false);
            expect(p.forceMilitaryConflict).toBe(true);
            expect(p.conflictCardEconomy.enabled).toBe(false);
            expect(p.fateAwareEconomy).toEqual(jasmine.objectContaining({
                prioritizeBodies: false,
                passAfterDurable: false,
                bodySpendCapEarly: 6,
                bodySpendCapLate: 5,
                bodyAdditionalFateForCostThree: 0,
                bodyBudgetIncludesDurableSpend: false,
                bodyFateReserve: 1
            }));
        });

        it('does NOT apply to Unicorn or generic decks', function() {
            expect(resolveDeckProfile(['cavalry-reserves'], AGGRO).lion).toBeUndefined();
            expect(resolveDeckProfile(['hayaken-no-shiro'], { holdingEngine: false, defensive: false, aggressive: false, dishonor: false }).lion).toBeUndefined();
        });

        it('gives the Ashigaru list its province-trading rush profile', function() {
            const p = resolveDeckProfile(['hayaken-no-shiro', 'ashigaru-levy', 'for-greater-glory', 'in-service-to-my-lord'], AGGRO);
            expect(p.lion).toEqual(LION_DEFAULTS);
            expect(p.defenseCommitment).toBe('prevent-break');
            expect(p.spendCardsOnDefense).toBe(true);
            expect(p.reserveDynastyFate).toBe(false);
            expect(p.digWithActions).toBe(true);
            expect(p.strongholdProvinceId).toBe('weight-of-duty');
            expect(p.conflictCardEconomy.enabled).toBe(false);
        });
    });

    describe('honor dial', function() {
        it('bids 5 on the first round, then the draw bid', function() {
            expect(tactics.desiredBid(1, 10, false)).toBe(LION_DEFAULTS.firstRoundBid);
            expect(tactics.desiredBid(3, 10, false)).toBe(LION_DEFAULTS.drawBid);
        });

        it('bids high in duels (the deck duels bow the loser)', function() {
            expect(tactics.desiredBid(3, 10, true)).toBe(LION_DEFAULTS.duelBid);
        });

        it('collapses to 1 at the honor floor', function() {
            expect(tactics.desiredBid(3, LION_DEFAULTS.honorFloor, false)).toBe(1);
            expect(tactics.desiredBid(3, LION_DEFAULTS.honorFloor, true)).toBe(1);
        });
    });

    describe('stronghold ready', function() {
        it('clicks Hayaken no Shiro only when a known cheap Bushi sits bowed', function() {
            expect(tactics.shouldReadyWithStronghold([{ id: 'matsu-berserker', bowed: true }])).toBe(true);
            expect(tactics.shouldReadyWithStronghold([{ id: 'matsu-berserker', bowed: false }])).toBe(false);
            // Akodo Toturi costs 5 — not a legal stronghold target.
            expect(tactics.shouldReadyWithStronghold([{ id: 'akodo-toturi', bowed: true }])).toBe(false);
            expect(tactics.shouldReadyWithStronghold([])).toBe(false);
        });
    });

    describe('swarm economy', function() {
        const card = (id, uuid = id) => ({ id, uuid, type: id === 'a-season-of-war' || id === 'honored-veterans' ? 'event' : 'character' });

        it('places exactly 2 fate only on the three selected towers', function() {
            expect(tactics.desiredAdditionalFate('akodo-toturi')).toBe(2);
            expect(tactics.desiredAdditionalFate('commander-of-the-legions')).toBe(2);
            expect(tactics.desiredAdditionalFate('honored-general')).toBe(2);
            expect(tactics.desiredAdditionalFate('matsu-beiona')).toBe(0);
            expect(tactics.desiredAdditionalFate('matsu-berserker')).toBe(0);
        });

        it('buys cheap bodies before towers and waits for Beiona rules legality', function() {
            const costs = { cheap: 1, beiona: 3, tower: 5 };
            expect(tactics.pickDynastyCard([
                card('akodo-toturi', 'tower'), card('matsu-berserker', 'cheap')
            ], costs, 7, []).id).toBe('matsu-berserker');

            const beiona = card('matsu-beiona', 'beiona');
            expect(tactics.pickDynastyCard([beiona], costs, 3, [
                { id: 'matsu-berserker' }, { id: 'akodo-gunso' }
            ])).toBeNull();
            expect(tactics.pickDynastyCard([beiona], costs, 3, [
                { id: 'matsu-berserker' }, { id: 'akodo-gunso' }, { id: 'matsu-gohei' }
            ])).toBe(beiona);
        });

        it('uses Feeding an Army only with five eligible cheap bodies', function() {
            const four = ['matsu-berserker', 'akodo-gunso', 'matsu-gohei', 'matsu-beiona'].map((id) => ({ id }));
            expect(tactics.shouldUseFeedingArmy(four)).toBe(false);
            expect(tactics.shouldUseFeedingArmy(four.concat([{ id: 'ashigaru-levy' }]))).toBe(true);
        });

        it('uses A Season of War only with fate left for the extra phase', function() {
            const season = card('a-season-of-war', 'season');
            expect(tactics.pickDynastyCard([season], { season: 1 }, 1, [])).toBeNull();
            expect(tactics.pickDynastyCard([season], { season: 1 }, 2, [])).toBe(season);
        });
    });

    describe('targeting', function() {
        it('sacrifices cheap bodies and retrieves listed towers first', function() {
            const bodies = [
                { id: 'honored-general', uuid: 'tower', fate: 2, militarySkillSummary: { stat: '4' } },
                { id: 'ashigaru-levy', uuid: 'levy', fate: 0, militarySkillSummary: { stat: '0' } }
            ];
            expect(tactics.pickCheapSacrifice(bodies, (card) => Number(card.militarySkillSummary.stat)).uuid).toBe('levy');
            expect(tactics.pickTower(bodies, (card) => Number(card.militarySkillSummary.stat)).uuid).toBe('tower');
        });

        it('requires three participating Bushi for Ikoma Tsanuri', function() {
            const gate = getPlaybookEntry('ikoma-tsanuri').shouldUseAction;
            const context = (traits) => ({
                myCharacters: [
                    { id: 'ikoma-tsanuri', inConflict: true, traits: ['bushi'] },
                    ...traits.map((cardTraits) => ({ inConflict: true, traits: cardTraits }))
                ]
            });
            expect(gate(context([['bushi'], ['courtier']]))).toBe(false);
            expect(gate(context([['bushi'], ['bushi']]))).toBe(true);
        });

        it('starts In Service only with a ready non-unique cost and bowed unique target', function() {
            const gate = getPlaybookEntry('in-service-to-my-lord').shouldPlay;
            const base = { opponentCharacters: [], dynastyDiscard: [], honor: 10, conflictType: 'military' };
            expect(gate({ ...base, myCharacters: [
                { bowed: false, isUnique: false }, { bowed: true, isUnique: true }
            ] })).toBe(true);
            expect(gate({ ...base, myCharacters: [
                { bowed: false, isUnique: false }, { bowed: true, isUnique: false }
            ] })).toBe(false);
            expect(gate({ ...base, myCharacters: [
                { bowed: false, isUnique: true }, { bowed: true, isUnique: true }
            ] })).toBe(false);
        });

        it('keeps phase-start and break reactions out of ordinary Action selection', function() {
            expect(getPlaybookEntry('feeding-an-army').shouldPlay({})).toBe(false);
            expect(getPlaybookEntry('for-greater-glory').shouldPlay({})).toBe(false);
        });
    });
});
