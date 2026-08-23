/* global describe, it, expect, beforeEach */
'use strict';

const {
    ReadyMovePlanner,
    DEFAULT_READY_MOVE,
    MOVE_SOURCES,
    READY_SOURCES,
    MOVE_INTO_CONFLICT_SOURCE_IDS,
    moveSourceSpec,
    readySourceSpec,
    sequenceOptionsFrom
} = require('../../../build/server/game/bots/ReadyMovePlanner.js');
const { DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');
const { cards } = require('../../../build/server/game/cards/index.js');

const body = (uuid, overrides) => Object.assign({
    uuid, id: uuid, bowed: false, inConflict: false, fate: 1
}, overrides || {});

// A conflict we are LOSING by 3 and where the province needs 3 more skill.
const base = (overrides) => Object.assign({
    characters: [],
    conflictActive: true,
    fate: 5,
    winSkillNeeded: 3,
    strengthNeeded: 3,
    readyOptions: [],
    moveOptions: [],
    readyAfterMoveOptions: [],
    skillOf: (card) => Number(card.skill) || 0
}, overrides || {});

describe('ReadyMovePlanner', function() {
    let planner;

    beforeEach(function() {
        planner = new ReadyMovePlanner();
    });

    it('ships enabled', function() {
        expect(DEFAULT_READY_MOVE.enabled).toBe(true);
        expect(DEFAULT_PROFILE.readyMove.enabled).toBe(true);
        expect(planner.inert).toBe(false);
    });

    describe('the two-leg sequence', function() {
        it('plans READY first for a bowed body, naming both sources', function() {
            const bowed = body('tower', { bowed: true, skill: 4 });
            const plan = planner.plan(base({
                characters: [bowed],
                readyOptions: [{ sourceId: 'against-the-waves', cost: 1, uuid: 'tower' }],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }]
            }));
            expect(plan).not.toBeNull();
            expect(plan.stage).toBe('ready');
            expect(plan.readySourceId).toBe('against-the-waves');
            expect(plan.moveSourceId).toBe('favorable-ground');
            expect(plan.totalCost).toBe(1);
            expect(plan.projectedSkill).toBe(4);
            expect(plan.reason).toBe('ready-then-move-into-conflict');
        });

        it('plans MOVE for a body that is already ready', function() {
            const plan = planner.plan(base({
                characters: [body('ready', { skill: 4 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'ready' }]
            }));
            expect(plan.stage).toBe('move');
            expect(plan.readySourceId).toBeNull();
            expect(plan.reason).toBe('move-into-conflict');
        });

        it('re-derives the SAME body once the ready leg has resolved', function() {
            // This is what replaces cross-prompt state: after the ready the
            // board changed, and the plan naturally rolls to stage `move`.
            const input = {
                characters: [body('tower', { bowed: true, skill: 4 })],
                readyOptions: [{ sourceId: 'against-the-waves', cost: 1, uuid: 'tower' }],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }]
            };
            expect(planner.plan(base(input)).stage).toBe('ready');
            const afterReady = { ...input, characters: [body('tower', { bowed: false, skill: 4 })] };
            const second = planner.plan(base(afterReady));
            expect(second.stage).toBe('move');
            expect(second.uuid).toBe('tower');
        });
    });

    describe('affordability across BOTH legs', function() {
        it('refuses a sequence it cannot pay for in full', function() {
            // Ready costs 3, move costs 1, we hold 3. Paying only the ready is
            // exactly the half-finished sequence this planner exists to stop.
            const plan = planner.plan(base({
                fate: 3,
                characters: [body('tower', { bowed: true, skill: 5 })],
                readyOptions: [{ sourceId: 'right-hand-of-the-emperor', cost: 3, uuid: 'tower' }],
                moveOptions: [{ sourceId: 'hawk-tattoo', cost: 1, uuid: 'tower' }]
            }));
            expect(plan).toBeNull();
        });

        it('takes the sequence when the fate covers both', function() {
            const plan = planner.plan(base({
                fate: 4,
                characters: [body('tower', { bowed: true, skill: 5 })],
                readyOptions: [{ sourceId: 'right-hand-of-the-emperor', cost: 3, uuid: 'tower' }],
                moveOptions: [{ sourceId: 'hawk-tattoo', cost: 1, uuid: 'tower' }]
            }));
            expect(plan.totalCost).toBe(4);
        });

        it('prefers the cheaper source when several can do the same job', function() {
            const plan = planner.plan(base({
                characters: [body('tower', { bowed: true, skill: 4 })],
                readyOptions: [
                    { sourceId: 'right-hand-of-the-emperor', cost: 3, uuid: 'tower' },
                    { sourceId: 'in-service-to-my-lord', cost: 0, uuid: 'tower' }
                ],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }]
            }));
            expect(plan.readySourceId).toBe('in-service-to-my-lord');
            expect(plan.totalCost).toBe(0);
        });

        it('honours a fate-share cap', function() {
            const careful = new ReadyMovePlanner({ maxFateShare: 0.5 });
            const input = base({
                fate: 4,
                characters: [body('tower', { bowed: true, skill: 5 })],
                readyOptions: [{ sourceId: 'right-hand-of-the-emperor', cost: 3, uuid: 'tower' }],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }]
            });
            expect(planner.plan(input)).not.toBeNull();
            expect(careful.plan(input)).toBeNull();
        });
    });

    describe('it only commits when the arrival changes the result', function() {
        it('refuses when the conflict is already won and already breaking', function() {
            const plan = planner.plan(base({
                winSkillNeeded: 0,
                strengthNeeded: 0,
                characters: [body('ready', { skill: 9 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'ready' }]
            }));
            expect(plan).toBeNull();
        });

        it('refuses a body too small to close the gap', function() {
            const plan = planner.plan(base({
                winSkillNeeded: 5,
                strengthNeeded: 5,
                characters: [body('small', { skill: 2 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'small' }]
            }));
            expect(plan).toBeNull();
        });

        it('commits when the body wins a conflict we are losing', function() {
            const plan = planner.plan(base({
                winSkillNeeded: 3,
                strengthNeeded: 0,
                characters: [body('ready', { skill: 3 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'ready' }]
            }));
            expect(plan).not.toBeNull();
        });

        it('commits when the body converts a win into a BREAK', function() {
            // Already winning (winSkillNeeded 0) but 2 short of the province.
            const plan = planner.plan(base({
                winSkillNeeded: 0,
                strengthNeeded: 2,
                characters: [body('ready', { skill: 2 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'ready' }]
            }));
            expect(plan).not.toBeNull();
            expect(plan.projectedSkill).toBe(2);
        });

        it('never moves a body that will still be BOWED without a payoff', function() {
            // The generic case the owner named: a deck holding Favorable Ground
            // gets value from ready -> move and from nothing else.
            const plan = planner.plan(base({
                characters: [body('bowed', { bowed: true, skill: 9 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'bowed' }]
            }));
            expect(plan).toBeNull();
        });
    });

    describe('participation payoffs (Unicorn)', function() {
        const payoffInput = (payoff) => base({
            winSkillNeeded: 0,
            strengthNeeded: 0,
            characters: [body('minami', { bowed: true, skill: 0 })],
            moveOptions: [{ sourceId: 'ride-on', cost: 0, uuid: 'minami' }],
            participationPayoff: payoff
        });

        it('moves a BOWED body in when participating alone is worth something', function() {
            const plan = planner.plan(payoffInput(() => 3));
            expect(plan).not.toBeNull();
            expect(plan.stage).toBe('move');
            expect(plan.projectedSkill).toBe(0);
            expect(plan.payoff).toBe(3);
            expect(plan.reason).toBe('move-bowed-for-participation-payoff');
        });

        it('is inert for a deck that supplies no payoff', function() {
            expect(planner.plan(payoffInput(undefined))).toBeNull();
            expect(planner.plan(payoffInput(() => 0))).toBeNull();
        });

        it('can be switched off entirely', function() {
            const strict = new ReadyMovePlanner({ allowPayoffOnlyMoves: false });
            expect(strict.plan(payoffInput(() => 3))).toBeNull();
        });

        it('still lets a payoff justify a body that WILL be ready', function() {
            // Already winning and already breaking, so skill is worth nothing —
            // the after-win reaction is the entire reason to move.
            const plan = planner.plan(base({
                winSkillNeeded: 0,
                strengthNeeded: 0,
                characters: [body('minami', { skill: 2 })],
                moveOptions: [{ sourceId: 'ride-on', cost: 0, uuid: 'minami' }],
                participationPayoff: () => 3
            }));
            expect(plan).not.toBeNull();
            expect(plan.value).toBe(5);
        });
    });

    describe('move -> ready: the other order', function() {
        // Fan of Command readies a PARTICIPATING Bushi and The Pursuit of
        // Justice a participating character, so for those the move has to come
        // first. LionDuelist and Dragon are the field decks that run both a
        // move source and one of these.
        const bowedHome = () => body('tower', { bowed: true, skill: 4 });

        it('plans MOVE first when the ready source needs a participant', function() {
            const plan = planner.plan(base({
                characters: [bowedHome()],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }],
                readyAfterMoveOptions: [{ sourceId: 'fan-of-command', cost: 0, uuid: 'tower' }]
            }));
            expect(plan).not.toBeNull();
            expect(plan.order).toBe('move-first');
            expect(plan.stage).toBe('move');
            expect(plan.readySourceId).toBe('fan-of-command');
            expect(plan.moveSourceId).toBe('favorable-ground');
            expect(plan.reason).toBe('move-then-ready-into-conflict');
            expect(plan.projectedSkill).toBe(4);
        });

        it('rolls to stage READY once the body is a bowed PARTICIPANT', function() {
            const plan = planner.plan(base({
                characters: [body('tower', { bowed: true, inConflict: true, skill: 4 })],
                readyAfterMoveOptions: [{ sourceId: 'fan-of-command', cost: 0, uuid: 'tower' }]
            }));
            expect(plan).not.toBeNull();
            expect(plan.stage).toBe('ready');
            expect(plan.order).toBe('move-first');
            expect(plan.reason).toBe('ready-after-move');
            expect(plan.readySourceId).toBe('fan-of-command');
        });

        it('leaves every OTHER participant alone', function() {
            // A bowed participant with no participant-only source available is
            // not a half-finished sequence, so the planner does not claim it.
            expect(planner.plan(base({
                characters: [body('tower', { bowed: true, inConflict: true, skill: 9 })],
                readyOptions: [{ sourceId: 'against-the-waves', cost: 1, uuid: 'tower' }]
            }))).toBeNull();
            // Nor is a READY participant a candidate.
            expect(planner.plan(base({
                characters: [body('tower', { inConflict: true, skill: 9 })],
                readyAfterMoveOptions: [{ sourceId: 'fan-of-command', cost: 0, uuid: 'tower' }]
            }))).toBeNull();
        });

        it('prefers READY first when both orders cost the same', function() {
            // Same board either way, but ready-first never leaves the body in
            // the conflict contributing 0 while the opponent acts.
            const plan = planner.plan(base({
                characters: [bowedHome()],
                readyOptions: [{ sourceId: 'in-service-to-my-lord', cost: 0, uuid: 'tower' }],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }],
                readyAfterMoveOptions: [{ sourceId: 'fan-of-command', cost: 0, uuid: 'tower' }]
            }));
            expect(plan.order).toBe('ready-first');
            expect(plan.stage).toBe('ready');
        });

        it('takes MOVE first when it is strictly cheaper', function() {
            const plan = planner.plan(base({
                characters: [bowedHome()],
                readyOptions: [{ sourceId: 'right-hand-of-the-emperor', cost: 3, uuid: 'tower' }],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }],
                readyAfterMoveOptions: [{ sourceId: 'fan-of-command', cost: 0, uuid: 'tower' }]
            }));
            expect(plan.order).toBe('move-first');
            expect(plan.totalCost).toBe(0);
        });

        it('budgets BOTH legs of the move-first order too', function() {
            // Move is free, the post-move ready costs 3, we hold 2.
            expect(planner.plan(base({
                fate: 2,
                characters: [bowedHome()],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }],
                readyAfterMoveOptions: [{ sourceId: 'right-hand-of-the-emperor', cost: 3, uuid: 'tower' }]
            }))).toBeNull();
        });

        it('can be switched off, leaving only the ready-first order', function() {
            const readyFirstOnly = new ReadyMovePlanner({ allowMoveThenReady: false });
            expect(readyFirstOnly.plan(base({
                characters: [bowedHome()],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }],
                readyAfterMoveOptions: [{ sourceId: 'fan-of-command', cost: 0, uuid: 'tower' }]
            }))).toBeNull();
        });

        it('still refuses when the arrival changes nothing', function() {
            expect(planner.plan(base({
                winSkillNeeded: 0,
                strengthNeeded: 0,
                characters: [bowedHome()],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'tower' }],
                readyAfterMoveOptions: [{ sourceId: 'fan-of-command', cost: 0, uuid: 'tower' }]
            }))).toBeNull();
        });
    });

    describe('a source that readies AND moves', function() {
        it('needs no separate ready leg for a bowed body', function() {
            const plan = planner.plan(base({
                characters: [body('bowed', { bowed: true, skill: 4 })],
                moveOptions: [{
                    sourceId: 'hiruma-signaller', cost: 0, uuid: 'bowed', readiesAndMoves: true
                }]
            }));
            expect(plan).not.toBeNull();
            expect(plan.stage).toBe('move');
            expect(plan.readySourceId).toBeNull();
            expect(plan.projectedSkill).toBe(4);
        });
    });

    describe('choosing between candidates', function() {
        it('takes the highest-value body, then the cheapest sequence', function() {
            const plan = planner.plan(base({
                characters: [
                    body('small', { skill: 3 }),
                    body('big', { skill: 6 })
                ],
                moveOptions: [
                    { sourceId: 'favorable-ground', cost: 0, uuid: 'small' },
                    { sourceId: 'favorable-ground', cost: 0, uuid: 'big' }
                ]
            }));
            expect(plan.uuid).toBe('big');
        });

        it('never plans a body that is already in the conflict', function() {
            const plan = planner.plan(base({
                characters: [body('inside', { inConflict: true, skill: 9 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'inside' }]
            }));
            expect(plan).toBeNull();
        });

        it('is deterministic', function() {
            const input = base({
                characters: [body('a', { skill: 4 }), body('b', { skill: 4 })],
                moveOptions: [
                    { sourceId: 'favorable-ground', cost: 0, uuid: 'a' },
                    { sourceId: 'favorable-ground', cost: 0, uuid: 'b' }
                ]
            });
            expect(planner.plan(input)).toEqual(planner.plan(input));
        });
    });

    describe('the disabled arm', function() {
        it('never plans anything', function() {
            const off = new ReadyMovePlanner({ enabled: false });
            expect(off.inert).toBe(true);
            expect(off.plan(base({
                characters: [body('ready', { skill: 9 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'ready' }]
            }))).toBeNull();
        });

        it('never plans outside a conflict', function() {
            expect(planner.plan(base({
                conflictActive: false,
                characters: [body('ready', { skill: 9 })],
                moveOptions: [{ sourceId: 'favorable-ground', cost: 0, uuid: 'ready' }]
            }))).toBeNull();
        });
    });
});

describe('sequence source tables', function() {
    it('names only cards the engine actually ships', function() {
        const missing = MOVE_SOURCES.concat(READY_SOURCES)
            .map((spec) => spec.id)
            .filter((id) => !cards.has(id));
        expect(missing).withContext(
            `sequence source ids with no card class: ${missing.join(', ')}`
        ).toEqual([]);
    });

    it('exposes the move ids ReadyValuePolicy re-exports', function() {
        expect(MOVE_INTO_CONFLICT_SOURCE_IDS).toEqual(MOVE_SOURCES.map((spec) => spec.id));
        const { MOVE_INTO_CONFLICT_SOURCE_IDS: reexported } =
            require('../../../build/server/game/bots/ReadyValuePolicy.js');
        expect(reexported).toBe(MOVE_INTO_CONFLICT_SOURCE_IDS);
    });

    it('lists no card that moves somebody ELSE into the conflict', function() {
        // Doji Challenger and Kitsu Motso drag an ENEMY body in; Cavalry
        // Reserves and the recursion cards put a card from a pile into play.
        // None of them can be the second leg of OUR sequence.
        for(const id of ['doji-challenger', 'kitsu-motso', 'cavalry-reserves',
            'kitsu-spiritcaller', 'forebearer-s-echoes', 'diversionary-maneuver']) {
            expect(moveSourceSpec(id)).withContext(`${id} must not be a move source`).toBeUndefined();
        }
    });

    it('prices a sacrifice, a self-bow and an honor loss at zero FATE', function() {
        expect(moveSourceSpec('favorable-ground').cost).toBe(0);
        expect(moveSourceSpec('golden-plains-outpost').cost).toBe(0);
        expect(moveSourceSpec('moto-eviscerator').cost).toBe(0);
        expect(readySourceSpec('hayaken-no-shiro').cost).toBe(0);
    });

    it('marks the participant-only ready sources as second-leg only', function() {
            expect(readySourceSpec('fan-of-command').participantOnly).toBe(true);
            expect(readySourceSpec('the-pursuit-of-justice').participantOnly).toBe(true);
            expect(readySourceSpec('moto-outrider').selfOnly).toBe(true);
            // Everything usable at home stays usable in either order.
            expect(readySourceSpec('in-service-to-my-lord').participantOnly).toBeUndefined();
            expect(readySourceSpec('shiotome-encampment').participantOnly).toBeUndefined();
        });

    it('marks the one source that readies and moves in a single action', function() {
        expect(moveSourceSpec('hiruma-signaller').readiesAndMoves).toBe(true);
        expect(moveSourceSpec('favorable-ground').readiesAndMoves).toBeUndefined();
    });
});

describe('sequenceOptionsFrom', function() {
    it('turns the controller target map into priced options', function() {
        const { readyOptions, moveOptions } = sequenceOptionsFrom({
            ready: { 'against-the-waves': ['a', 'b'] },
            move: { 'favorable-ground': ['a'], 'hiruma-signaller': ['b'] },
            readyAfterMove: {}
        });
        expect(readyOptions).toEqual([
            { sourceId: 'against-the-waves', cost: 1, uuid: 'a', readiesAndMoves: undefined },
            { sourceId: 'against-the-waves', cost: 1, uuid: 'b', readiesAndMoves: undefined }
        ]);
        expect(moveOptions.find((option) => option.sourceId === 'hiruma-signaller').readiesAndMoves)
            .toBe(true);
    });

    it('drops a source id with no spec rather than pricing it at zero', function() {
        const { moveOptions } = sequenceOptionsFrom({
            ready: {}, move: { 'not-a-card': ['a'] }, readyAfterMove: {}
        });
        expect(moveOptions).toEqual([]);
    });

    it('tolerates an absent map', function() {
        expect(sequenceOptionsFrom(undefined))
            .toEqual({ readyOptions: [], moveOptions: [], readyAfterMoveOptions: [] });
    });
});
