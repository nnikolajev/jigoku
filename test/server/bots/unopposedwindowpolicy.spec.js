const {
    UnopposedWindowPolicy,
    DEFAULT_UNOPPOSED_WINDOW
} = require('../../../build/server/game/bots/UnopposedWindowPolicy.js');
const { DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');
const { ShugenjaTactics, SHUGENJA_DEFAULTS } = require('../../../build/server/game/bots/ShugenjaTactics.js');

// The free-conflict window taken from the owner's replays: a conflict
// opportunity that would otherwise be passed for lack of a ready attacker,
// against an enemy board that is entirely bowed, is an unopposed break if a body
// can be played from hand FIRST. See docs/bot-unopposed-window.md.
describe('UnopposedWindowPolicy', function() {
    const candidate = (over = {}) => Object.assign({
        uuid: 'u1', id: 'feral-ningyo', military: 4, political: 0, cost: 1
    }, over);
    const input = (over = {}) => Object.assign({
        myConflictsRemaining: 1,
        opponentReady: 0,
        opponentInPlay: 3,
        myReady: 0,
        availableFate: 3,
        playsThisRound: 0,
        candidates: [candidate()]
    }, over);

    describe('defaults reproduce V1 exactly', function() {
        it('the class default is off', function() {
            expect(DEFAULT_UNOPPOSED_WINDOW.enabled).toBe(false);
        });

        // Ships field-wide at +0.53pp / p<0.0001 over 4896 games and 9 bases.
        // The gates stay at their measured values; loosening one is then a
        // deliberate edit rather than a drift.
        it('ships enabled, at the measured gates', function() {
            expect(DEFAULT_PROFILE.unopposedWindow.enabled).toBe(true);
            expect(DEFAULT_PROFILE.unopposedWindow.maxOpponentReady).toBe(0);
            expect(DEFAULT_PROFILE.unopposedWindow.maxOwnReadyAttackers).toBe(0);
            expect(DEFAULT_PROFILE.unopposedWindow.maxPlaysPerRound).toBe(1);
            expect(DEFAULT_PROFILE.unopposedWindow.overrideAttachmentPlans).toBe(true);
        });

        it('plays nothing while disabled, however good the window is', function() {
            const read = new UnopposedWindowPolicy().read(input());
            expect(read.play).toBe(null);
            expect(read.reason).toBe('unopposed-off');
        });
    });

    describe('the window', function() {
        const policy = new UnopposedWindowPolicy({ enabled: true });

        it('fires with a conflict left, an all-bowed enemy and a body in hand', function() {
            const read = policy.read(input());
            expect(read.play.id).toBe('feral-ningyo');
            expect(read.skill).toBe(4);
            expect(read.reason).toBe('unopposed-play');
        });

        // An empty enemy board is the same situation and satisfies the rule.
        it('fires against an empty enemy board too', function() {
            const read = policy.read(input({ opponentReady: 0, opponentInPlay: 0 }));
            expect(read.play).not.toBe(null);
        });

        it('does not fire without a conflict opportunity', function() {
            const read = policy.read(input({ myConflictsRemaining: 0 }));
            expect(read.play).toBe(null);
            expect(read.reason).toBe('no-conflict-opportunity');
        });

        it('does not fire while a single defender is ready', function() {
            const read = policy.read(input({ opponentReady: 1 }));
            expect(read.play).toBe(null);
            expect(read.reason).toBe('defenders-ready');
        });

        // The conservative reading, and self-limiting: after one play we have a
        // ready attacker and the window closes on its own.
        it('does not fire while we already have an attacker', function() {
            const read = policy.read(input({ myReady: 1 }));
            expect(read.play).toBe(null);
            expect(read.reason).toBe('attacker-available');
        });

        it('opens with a ready attacker once maxOwnReadyAttackers allows it', function() {
            const wide = new UnopposedWindowPolicy({ enabled: true, maxOwnReadyAttackers: 1 });
            expect(wide.read(input({ myReady: 1 })).play).not.toBe(null);
            expect(wide.read(input({ myReady: 2 })).play).toBe(null);
        });

        it('stops at the per-round play cap', function() {
            const read = policy.read(input({ playsThisRound: 1 }));
            expect(read.play).toBe(null);
            expect(read.reason).toBe('play-cap-reached');
        });
    });

    describe('choosing the body', function() {
        const policy = new UnopposedWindowPolicy({ enabled: true });

        it('takes the most skill, because the province still has to be covered', function() {
            const read = policy.read(input({
                candidates: [
                    candidate({ uuid: 'a', id: 'small', military: 2, cost: 1 }),
                    candidate({ uuid: 'b', id: 'big', military: 4, cost: 2 })
                ],
                availableFate: 3
            }));
            expect(read.play.id).toBe('big');
        });

        it('breaks a skill tie on cost, then uuid', function() {
            const read = policy.read(input({
                candidates: [
                    candidate({ uuid: 'z', id: 'dear', military: 3, cost: 3 }),
                    candidate({ uuid: 'a', id: 'cheap', military: 3, cost: 1 })
                ]
            }));
            expect(read.play.id).toBe('cheap');
        });

        it('refuses a body it cannot pay for', function() {
            const read = policy.read(input({ availableFate: 0, candidates: [candidate({ cost: 2 })] }));
            expect(read.play).toBe(null);
            expect(read.reason).toBe('no-affordable-body');
        });

        it('honours the fate reserve', function() {
            const saver = new UnopposedWindowPolicy({ enabled: true, fateReserve: 2 });
            expect(saver.read(input({ availableFate: 2, candidates: [candidate({ cost: 1 })] })).play).toBe(null);
            expect(saver.read(input({ availableFate: 3, candidates: [candidate({ cost: 1 })] })).play).not.toBe(null);
        });

        // A 0-skill attacker does not win an unopposed conflict: the attacker
        // needs MORE skill than the defender and both sit at 0.
        it('rejects a body with no skill on any open axis', function() {
            const read = policy.read(input({ candidates: [candidate({ military: 0, political: 0 })] }));
            expect(read.play).toBe(null);
            expect(read.reason).toBe('no-affordable-body');
        });

        it('ignores skill on an axis we can no longer declare on', function() {
            const read = policy.read(input({
                militaryRemaining: 0,
                politicalRemaining: 1,
                candidates: [candidate({ military: 5, political: 0 })]
            }));
            expect(read.play).toBe(null);
        });

        it('still scores both axes when the engine omits the split', function() {
            const read = policy.read(input({ candidates: [candidate({ military: 0, political: 3 })] }));
            expect(read.play).not.toBe(null);
            expect(read.skill).toBe(3);
        });

        it('reports an empty hand separately from an unaffordable one', function() {
            expect(policy.read(input({ candidates: [] })).reason).toBe('no-candidate');
        });
    });

    // Disguised replaces a non-unique Shugenja and pays the DIFFERENCE, so
    // Tadaka's printed 5 is the wrong price whenever a legal base is standing.
    // He enters READY either way, which is what makes him a legal attacker in
    // the conflict the window is about to declare.
    describe('ShugenjaTactics.disguisedCost', function() {
        const tactics = () => new ShugenjaTactics(SHUGENJA_DEFAULTS);

        it('prices Tadaka from the base he replaces', function() {
            const base = Object.keys(SHUGENJA_DEFAULTS.disguiseTargets)[0];
            const printed = SHUGENJA_DEFAULTS.disguiseTargets[base];
            const cost = tactics().disguisedCost([{ id: base, uuid: 'b1', fate: 0 }], 5);
            expect(cost).toBe(Math.max(5 - printed, 0));
        });

        it('asks nothing about the base\'s fate — it is a price, not a plan', function() {
            const base = Object.keys(SHUGENJA_DEFAULTS.disguiseTargets)[0];
            expect(tactics().disguisedCost([{ id: base, uuid: 'b1', fate: 0 }], 5)).not.toBe(null);
        });

        it('returns null with no legal base, so the printed cost stands', function() {
            expect(tactics().disguisedCost([{ id: 'not-a-shugenja', uuid: 'b1' }], 5)).toBe(null);
            expect(tactics().disguisedCost([], 5)).toBe(null);
        });

        it('returns null when the reduced cost is still unaffordable', function() {
            const base = Object.keys(SHUGENJA_DEFAULTS.disguiseTargets)[0];
            expect(tactics().disguisedCost([{ id: base, uuid: 'b1' }], 0)).toBe(null);
        });
    });
});
