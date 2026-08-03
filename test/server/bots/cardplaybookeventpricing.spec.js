const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');

// Live pricing for conflict EVENTS. Characters and attachments reach the policy
// with printed skill attached; events do not, so `handContribution` read them as
// "unknown contribution" and they were invisible to province-break budgeting.
//
// Two things make these models load-bearing rather than cosmetic. A number that
// comes out ZERO now denies the play outright (`zero-contribution`), where an
// unknown was always allowed; and a positive number activates the
// `strength-already-sufficient` veto. So each model is tested for the value it
// produces AND for the control arm still reporting exactly what it used to.
describe('CardPlaybook live event pricing', function() {
    const character = (overrides = {}) => Object.assign({
        uuid: overrides.uuid || 'u-' + Math.random(),
        inConflict: false,
        bowed: false,
        isUnique: false,
        isHonored: false,
        isDishonored: false,
        fate: 0,
        glory: 0,
        military: 0,
        political: 0,
        traits: [],
        attachments: []
    }, overrides);

    const context = (overrides = {}) => Object.assign({
        conflictType: 'military',
        losing: false,
        amAttacker: true,
        honor: 10,
        fate: 5,
        myCharacters: [],
        opponentCharacters: [],
        dynastyDiscard: [],
        liveEventPricing: true
    }, overrides);

    const value = (cardId, ctx) => {
        const contribution = getPlaybookEntry(cardId).conflictContribution;
        return typeof contribution === 'function' ? contribution(ctx) : contribution;
    };
    const gate = (cardId, ctx) => getPlaybookEntry(cardId).shouldPlay(ctx);

    describe('the A/B control arm', function() {
        // If `off` is not the previous build exactly, the arm is measuring two
        // changes at once and the whole comparison is void.
        it('restores the old flat constants when pricing is off', function() {
            const ctx = context({ liveEventPricing: false });
            expect(value('banzai', ctx)).toBe(2);
            expect(value('a-perfect-cut', ctx)).toBe(2);
            expect(value('hurricane-punch', ctx)).toBe(2);
            expect(value('compelling-testimony', ctx)).toBe(4);
        });

        it('restores the unknown reading for events that never carried one', function() {
            const ctx = context({ liveEventPricing: false });
            for(const cardId of ['deceptive-offer', 'against-the-waves',
                'forebearer-s-echoes', 'way-of-the-crane', 'benten-s-touch',
                'captive-audience', 'ride-on', 'i-am-ready']) {
                expect(value(cardId, ctx)).toBeNull();
            }
        });

        it('holds an excluded card at its legacy reading with pricing on', function() {
            // Pricing a card is not automatically an improvement — a number also
            // activates the zero/strength vetoes and moves the card in the play
            // ordering — so any single model can be ablated back out.
            const ctx = context({
                myCharacters: [character({ inConflict: true, military: 3 })],
                liveEventPricingExclude: ['banzai']
            });
            expect(value('banzai', ctx)).toBe(2);
            // Everything not named stays priced.
            expect(value('a-perfect-cut', context({
                myCharacters: [character({ inConflict: true, traits: ['courtier'] })],
                liveEventPricingExclude: ['banzai']
            }))).toBe(0);
        });

        it('keeps the old Shugenja count for Supernatural Storm', function() {
            // The legacy reading counted a hard-coded list of Phoenix ids, so a
            // Shugenja by trait alone was worth nothing to it.
            const ctx = context({
                liveEventPricing: false,
                myCharacters: [
                    character({ id: 'isawa-tadaka-2', inConflict: true }),
                    character({ id: 'not-on-the-list', traits: ['shugenja'] })
                ]
            });
            expect(value('supernatural-storm', ctx)).toBe(1);
        });
    });

    describe('pumps that need a body that actually contributes', function() {
        // conflict.ts:474 drops a bowed participant's skill from the total, so
        // pumping one adds nothing and the card should be kept instead.
        it('prices Banzai at zero when every participant is bowed', function() {
            expect(value('banzai', context({
                myCharacters: [character({ inConflict: true, bowed: true, military: 4 })]
            }))).toBe(0);
        });

        it('prices Banzai at +4, which is what the policy actually takes', function() {
            // The second resolution costs 1 honor and grants another +2, and the
            // `banzai-recur-for-honor` handler pays it whenever honor is above 3.
            // The budget has to match the behaviour, or the bot commits to a
            // break believing it bought half the skill it actually did.
            expect(value('banzai', context({
                honor: 10,
                myCharacters: [character({ inConflict: true, military: 4 })]
            }))).toBe(4);
        });

        it('drops Banzai to +2 at the honor floor, where the policy declines', function() {
            expect(value('banzai', context({
                honor: 3,
                myCharacters: [character({ inConflict: true, military: 4 })]
            }))).toBe(2);
        });

        it('prices A Perfect Cut at zero without a Bushi in the conflict', function() {
            const courtier = character({ inConflict: true, traits: ['courtier'] });
            expect(value('a-perfect-cut', context({ myCharacters: [courtier] }))).toBe(0);
            const bushi = character({ inConflict: true, traits: ['bushi'] });
            expect(value('a-perfect-cut', context({ myCharacters: [bushi] }))).toBe(2);
        });

        it('prices Hurricane Punch at zero without a Monk in the conflict', function() {
            expect(value('hurricane-punch', context({
                myCharacters: [character({ inConflict: true, traits: ['bushi'] })]
            }))).toBe(0);
            expect(value('hurricane-punch', context({
                myCharacters: [character({ inConflict: true, traits: ['monk'] })]
            }))).toBe(2);
        });

        it('counts Supernatural Storm Shugenja by trait, not by a fixed id list', function() {
            expect(value('supernatural-storm', context({
                myCharacters: [
                    character({ inConflict: true, traits: ['shugenja'] }),
                    character({ traits: ['shugenja'] })
                ]
            }))).toBe(2);
        });

        it('leaves Give No Ground unpriced, which measured better than pricing it', function() {
            // The +2-while-defending model is correct and still cost Crab 4.3pp,
            // because a known number moves the card in the economy planner and
            // exposes it to the strength veto. Kept unpriced on purpose.
            // No `conflictContribution` on the entry at all, which reads the same
            // as null to `handContribution`: unknown, and therefore playable.
            const mine = [character({ inConflict: true, military: 3 })];
            expect(value('give-no-ground', context({ myCharacters: mine, amAttacker: false }))).toBeUndefined();
        });
    });

    describe('removal priced by what it can actually remove', function() {
        it('caps Compelling Testimony at the target\'s political skill', function() {
            // -4 is a ceiling, not a payout.
            expect(value('compelling-testimony', context({
                conflictType: 'political',
                opponentCharacters: [character({ inConflict: true, political: 2 })]
            }))).toBe(2);
            expect(value('compelling-testimony', context({
                conflictType: 'political',
                opponentCharacters: [character({ inConflict: true, political: 7 })]
            }))).toBe(4);
        });
    });

    describe('cards whose worth depends on the live board', function() {
        it('does not budget Deceptive Offer when the pump alone would win it', function() {
            // The opponent picks, and pays the honor instead of handing over a
            // swing that flips the conflict. Unpriced rather than zero: a free
            // honor is still worth the card, and zero would veto the play.
            const mine = [character({ inConflict: true, military: 3 })];
            expect(value('deceptive-offer', context({ myCharacters: mine, winSkillNeeded: 2 }))).toBeNull();
            expect(value('deceptive-offer', context({ myCharacters: mine, winSkillNeeded: 5 }))).toBe(2);
        });

        it('prices Forebearer\'s Echoes at the best body in the dynasty discard', function() {
            expect(value('forebearer-s-echoes', context({
                dynastyDiscardBodies: [{ military: 3 }, { military: 6 }]
            }))).toBe(6);
        });

        it('prices Way of the Crane at the target\'s glory', function() {
            expect(value('way-of-the-crane', context({
                myCharacters: [
                    character({ inConflict: true, glory: 1 }),
                    character({ inConflict: true, glory: 3 }),
                    character({ glory: 5 })
                ]
            }))).toBe(3);
        });

        it('reads glory from glorySummary, which is where the engine puts it', function() {
            // An in-play character has no `glory` field at all — the value lives
            // in `glorySummary.stat` alongside the skill summaries. Reading the
            // wrong one priced every glory card at a flat zero, which would have
            // vetoed them all.
            expect(value('way-of-the-crane', context({
                myCharacters: [character({ inConflict: true, glory: undefined, glorySummary: { stat: '4' } })]
            }))).toBe(4);
        });

        it('ignores the serialized discard pile, whose skill summaries are empty', function() {
            // The engine only fills skill summaries for cards IN PLAY. A body in
            // the dynasty discard arrives with `militarySkillSummary: {}` and no
            // printed skill anywhere on it, so pricing off that pile returned
            // zero on all 60 of its calls in a 90-game probe — which, with no
            // `abilityValue` on the entry, would have vetoed the card entirely.
            const rawPile = [{
                id: 'matsu-berserker',
                type: 'character',
                militarySkillSummary: {},
                politicalSkillSummary: {}
            }];
            expect(value('forebearer-s-echoes', context({ dynastyDiscard: rawPile }))).toBe(0);
            expect(value('forebearer-s-echoes', context({
                dynastyDiscard: rawPile,
                dynastyDiscardBodies: [{ id: 'matsu-berserker', military: 3 }]
            }))).toBe(3);
        });

        it('prices Way of the Crane at zero when every participant is honored', function() {
            expect(value('way-of-the-crane', context({
                myCharacters: [character({ inConflict: true, glory: 3, isHonored: true })]
            }))).toBe(0);
        });

        it('prices Captive Audience at the swing from flipping the axis', function() {
            // Ours: 8 military against 2 political = +6. Theirs: 1 against 5 = -4.
            const ctx = context({
                conflictType: 'political',
                myCharacters: [character({ inConflict: true, military: 8, political: 2 })],
                opponentCharacters: [character({ inConflict: true, military: 1, political: 5 })]
            });
            expect(value('captive-audience', ctx)).toBe(10);
        });

        it('prices Captive Audience at zero when the flip favours the opponent', function() {
            expect(value('captive-audience', context({
                conflictType: 'political',
                myCharacters: [character({ inConflict: true, military: 1, political: 6 })],
                opponentCharacters: [character({ inConflict: true, military: 7, political: 1 })]
            }))).toBe(0);
        });

        it('prices Ride On at the skill of the body it moves in', function() {
            expect(value('ride-on', context({
                myCharacters: [
                    character({ traits: ['cavalry'], military: 4 }),
                    character({ traits: ['cavalry'], military: 6, bowed: true }),
                    character({ inConflict: true, traits: ['cavalry'], military: 9 })
                ]
            }))).toBe(4);
        });

        it('prices readying a bowed participant at its full skill', function() {
            // Against the Waves and I Am Ready both hand back skill the bowed
            // body was not contributing.
            expect(value('against-the-waves', context({
                myCharacters: [character({ inConflict: true, bowed: true, traits: ['shugenja'], military: 5 })]
            }))).toBe(5);
            expect(value('i-am-ready', context({
                myCharacters: [character({ inConflict: true, bowed: true, fate: 2, military: 4 })]
            }))).toBe(4);
        });

        it('leaves readying a body at home unpriced rather than zero', function() {
            // The tempo is real — it is how the Unicorn rush closes games — it is
            // just not skill in THIS conflict. Zero would deny the play outright,
            // and `abilityValue` cannot be used to rescue it because that field
            // also reorders cards in the control arm.
            expect(value('i-am-ready', context({
                myCharacters: [character({ bowed: true, fate: 2, military: 4 })]
            }))).toBeNull();
        });
    });

    describe('Consumed by Five Fires', function() {
        const tower = character({ id: 'their-tower', fate: 3, military: 5, attachments: [{ id: 'a' }, { id: 'b' }] });
        const shugenja = character({ traits: ['shugenja'] });

        it('fires on a tower it can empty even when the board holds under 5 fate', function() {
            // The old gate wanted 5 removable fate across the whole board. Over
            // 90 games that passed 4 times in 491 windows and never alongside
            // the 5 own fate the card costs, so the card was never played.
            const ctx = context({ fate: 5, myCharacters: [shugenja], opponentCharacters: [tower] });
            expect(gate('consumed-by-five-fires', ctx)).toBe(true);
            expect(gate('consumed-by-five-fires', Object.assign({}, ctx, { liveEventPricing: false }))).toBe(false);
        });

        it('still refuses without the fate to pay for it', function() {
            expect(gate('consumed-by-five-fires', context({
                fate: 4, myCharacters: [shugenja], opponentCharacters: [tower]
            }))).toBe(false);
        });

        it('refuses without a Shugenja of ours', function() {
            // The Seeker role is a deck-building restriction and correctly plays
            // no part here, but the Shugenja is a real play requirement.
            expect(gate('consumed-by-five-fires', context({
                fate: 5,
                myCharacters: [character({ traits: ['bushi'] })],
                opponentCharacters: [tower]
            }))).toBe(false);
        });

        it('refuses a token body that is not worth five fate and a card', function() {
            expect(gate('consumed-by-five-fires', context({
                fate: 5,
                myCharacters: [shugenja],
                opponentCharacters: [character({ fate: 1, military: 1 })]
            }))).toBe(false);
        });

        it('refuses a target already neutralised by Pacifism', function() {
            expect(gate('consumed-by-five-fires', context({
                fate: 5,
                myCharacters: [shugenja],
                opponentCharacters: [character({
                    fate: 3, military: 5, attachments: [{ id: 'pacifism' }]
                })]
            }))).toBe(false);
        });
    });
});
