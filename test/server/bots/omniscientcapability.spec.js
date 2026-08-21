const OmniscientBotCapability = require('../../../build/server/game/bots/OmniscientBotCapability.js').default;
const { DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');

// The omniscient capability builds the hand-threat matrix ONCE per decide tick,
// and every gated consumer (axis, response buffer, token defense, stronghold
// defense) reads that one number. It was built honor-blind and board-blind
// while the fair estimate beside it is neither, so it systematically OVER-priced
// the opponent's hand — which is the exact failure mode every rejected broad
// omniscient lever showed. These lock both halves of the fix and, just as
// importantly, lock the default: `realism` off must reproduce the honor-blind,
// board-blind matrix the shipped profiles were measured with.
describe('OmniscientBotCapability hand-threat realism', function() {
    function card(overrides) {
        return Object.assign({
            id: 'plain-body',
            name: 'Plain Body',
            type: 'character',
            isConflict: true,
            cardData: { side: 'conflict', type: 'character' },
            printedCost: 1,
            getMilitarySkill: () => 2,
            getPoliticalSkill: () => 0,
            bowed: false
        }, overrides);
    }

    function pile(cards) {
        return { toArray: () => cards, size: () => cards.length };
    }

    function player(overrides) {
        return Object.assign({
            name: 'Opponent',
            fate: 5,
            honor: 10,
            hand: pile([]),
            cardsInPlay: pile([]),
            getProvinces: () => [],
            getDynastyCardsInProvince: () => []
        }, overrides);
    }

    function build(options) {
        const opponent = player(options.opponent || {});
        const me = player(Object.assign({ name: 'Bot' }, options.me || {}));
        me.opponent = opponent;
        const capability = new OmniscientBotCapability({ allCards: [], addMessage: () => {} }, 'Bot', true);
        return capability.build(me, options.realism === true);
    }

    // Assassination is `swing: 4, honorCost: 3` in the registry. At 2 honor the
    // opponent cannot pay for it, so it is not a threat — but the honor-blind
    // matrix prices it as four free skill.
    const assassination = () => ({
        id: 'assassination',
        name: 'Assassination',
        type: 'event',
        isConflict: true,
        cardData: { side: 'conflict', type: 'event' },
        printedCost: 0
    });

    it('prices an unaffordable honor cost as free when realism is off (the shipped default)', function() {
        const omni = build({ opponent: { honor: 2, hand: pile([assassination()]) } });
        const plan = omni.handThreatMatrix.military[omni.handThreatMatrix.military.length - 1];
        expect(plan.skill).toBe(4);
    });

    it('drops a trick the opponent cannot pay the honor for when realism is on', function() {
        const omni = build({ realism: true, opponent: { honor: 2, hand: pile([assassination()]) } });
        const plan = omni.handThreatMatrix.military[omni.handThreatMatrix.military.length - 1];
        expect(plan.skill).toBe(0);
    });

    it('keeps the same trick when the opponent can actually pay for it', function() {
        const omni = build({
            realism: true,
            opponent: {
                honor: 6,
                hand: pile([assassination()]),
                cardsInPlay: pile([card({ id: 'their-body' })])
            },
            me: { cardsInPlay: pile([card({ id: 'my-body' })]) }
        });
        const plan = omni.handThreatMatrix.military[omni.handThreatMatrix.military.length - 1];
        expect(plan.skill).toBe(4);
    });

    // `assassination` is tagged `removal`, so it needs one of OUR bodies to
    // point at. With an empty board on our side it can do nothing.
    it('drops removal with no target on our board when realism is on', function() {
        const omni = build({
            realism: true,
            opponent: { honor: 10, hand: pile([assassination()]) },
            me: { cardsInPlay: pile([]) }
        });
        const plan = omni.handThreatMatrix.military[omni.handThreatMatrix.military.length - 1];
        expect(plan.skill).toBe(0);
    });

    it('still counts a conflict BODY they can play with no board at all', function() {
        const omni = build({
            realism: true,
            opponent: { honor: 10, fate: 3, hand: pile([card({ id: 'their-conflict-body' })]) },
            me: { cardsInPlay: pile([]) }
        });
        const plan = omni.handThreatMatrix.military[omni.handThreatMatrix.military.length - 1];
        expect(plan.skill).toBe(2);
    });

    it('is disabled entirely when the capability is off, for every seat', function() {
        const opponent = player({});
        const me = player({ name: 'Bot' });
        me.opponent = opponent;
        const capability = new OmniscientBotCapability({ allCards: [], addMessage: () => {} }, 'Bot', false);
        expect(capability.build(me, true)).toBeUndefined();
    });

    it('defaults the two unmeasured gates off so V1 behaviour is unchanged', function() {
        expect(DEFAULT_PROFILE.omniscientThreatRealism).toBe(false);
        expect(DEFAULT_PROFILE.omniscientCheapestBreakAxis).toBe(false);
    });

    // Measured 2026-08-21: feeding the rollout the EXACT opponent hand threat
    // is worth -1.55pp (p=0.0016, 3264 paired games, six bases). It made the
    // omniscient seat assume ~4 skill of answer in 74% of declaration windows
    // where a fair bot assumes zero, so it declared more cautiously for free.
    // The default is now off. Flipping it back is a deliberate regression.
    it('keeps the rollout off the exact opponent hand threat by default', function() {
        expect(DEFAULT_PROFILE.omniscientPlannerHandThreat).toBe(false);
    });
});
