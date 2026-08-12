const {
    ConflictTempoPolicy,
    DEFAULT_CONFLICT_TEMPO
} = require('../../../build/server/game/bots/ConflictTempoPolicy.js');
const { DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');
const {
    DEFAULT_FATE_AWARE_ECONOMY,
    SWARM_FATE_AWARE_ECONOMY
} = require('../../../build/server/game/bots/FateAwareEconomy.js');

// The declaration-time board read taken from the owner's replays: my ready
// bodies against theirs, conflicts remaining on both sides, who holds the
// first-player token, and the best INDIVIDUAL body on each side. See
// docs/bot-conflict-rules-from-replays.md rules 13-15.
describe('ConflictTempoPolicy', function() {
    const body = (military, political = military) => ({ military, political });
    const input = (over = {}) => Object.assign({
        axis: 'military',
        myReady: [body(3), body(2)],
        myBowed: [],
        theirReady: [body(3), body(2)],
        myConflictsRemaining: 2,
        opponentConflictsRemaining: 2,
        isFirstPlayer: true,
        myBrokenProvinces: 0,
        opponentBrokenProvinces: 0
    }, over);

    describe('defaults reproduce V1 exactly', function() {
        const policy = new ConflictTempoPolicy();

        it('the class default is off, so an unconfigured deck is V1', function() {
            expect(DEFAULT_CONFLICT_TEMPO.enabled).toBe(false);
            expect(DEFAULT_CONFLICT_TEMPO.readyLoopEnabled).toBe(false);
        });

        // Ships field-wide at +0.32pp / p=0.009 over 4896 games and 9 bases.
        // The three levers that measured null or negative stay off, and this
        // pins that: re-enabling one is then a deliberate edit, not a drift.
        it('ships the ready loop and nothing else', function() {
            expect(DEFAULT_PROFILE.conflictTempo.enabled).toBe(true);
            expect(DEFAULT_PROFILE.conflictTempo.readyLoopEnabled).toBe(true);
            expect(DEFAULT_PROFILE.conflictTempo.readyRingBonusPerSkill).toBe(4);
            expect(DEFAULT_PROFILE.conflictTempo.tradeDefenseWinOnly).toBe(false);
            expect(DEFAULT_PROFILE.conflictTempo.tradeAttackSendAll).toBe(false);
            expect(DEFAULT_PROFILE.conflictTempo.controlAttackKeepHome).toBe(0);
        });

        it('derives no decision at all while disabled', function() {
            const read = policy.read(input({
                myReady: [body(1)],
                myBowed: [body(5)],
                theirReady: [body(9), body(9)],
                myBrokenProvinces: 0
            }));
            expect(read.defenseWinOnly).toBe(false);
            expect(read.readyRingBonus).toBe(0);
            expect(read.attackSendAll).toBe(false);
            expect(read.attackKeepHome).toBeUndefined();
            expect(read.reason).toBe('tempo-off');
        });

        it('still reports the read, so telemetry can measure the population', function() {
            const read = policy.read(input({ theirReady: [body(10)] }));
            expect(read.mySkill).toBe(5);
            expect(read.theirSkill).toBe(10);
            expect(read.stance).toBe('trade');
        });
    });

    describe('the board read', function() {
        const policy = new ConflictTempoPolicy({ enabled: true });

        it('reads a losing board as trade and a winning one as control', function() {
            expect(policy.read(input({ theirReady: [body(9)] })).stance).toBe('trade');
            expect(policy.read(input({ theirReady: [body(2)] })).stance).toBe('control');
            expect(policy.read(input()).stance).toBe('even');
        });

        it('ignores an empty early board, where the ratio is noise', function() {
            const read = policy.read(input({
                myReady: [body(1)],
                theirReady: [body(3)]
            }));
            expect(read.stance).toBe('even');
        });

        it('an empty enemy board is the strongest state, not a divide by zero', function() {
            const read = policy.read(input({ theirReady: [] }));
            expect(read.stance).toBe('control');
            expect(Number.isNaN(read.ratio)).toBe(false);
        });

        it('scores the axis it was asked about', function() {
            const lopsided = [{ military: 9, political: 0 }];
            expect(policy.read(input({ axis: 'political', theirReady: lopsided })).stance)
                .toBe('control');
            expect(policy.read(input({ axis: 'military', theirReady: lopsided })).stance)
                .toBe('trade');
        });

        it('bestBodyWeight separates two small bodies from one large one', function() {
            const board = { myReady: [body(3), body(3)], theirReady: [body(6)] };
            expect(policy.read(input(board)).stance).toBe('even');
            const weighted = new ConflictTempoPolicy({ enabled: true, bestBodyWeight: 1 });
            // 6 + 3 against 6 + 6: identical totals, a losing board on bodies.
            expect(weighted.read(input(board)).stance).toBe('trade');
        });
    });

    describe('trade stance', function() {
        const policy = new ConflictTempoPolicy({
            enabled: true,
            tradeDefenseWinOnly: true,
            tradeAttackSendAll: true
        });
        const losing = { theirReady: [body(9), body(9)] };

        it('concedes defenses it cannot win and sends everything at the attack', function() {
            const read = policy.read(input(losing));
            expect(read.stance).toBe('trade');
            expect(read.defenseWinOnly).toBe(true);
            expect(read.attackSendAll).toBe(true);
        });

        it('stops trading with no conflict of our own left to make', function() {
            const read = policy.read(input(Object.assign({ myConflictsRemaining: 0 }, losing)));
            expect(read.defenseWinOnly).toBe(false);
            expect(read.attackSendAll).toBe(false);
        });

        it('stops trading once the next break is the stronghold', function() {
            const read = policy.read(input(Object.assign({ myBrokenProvinces: 3 }, losing)));
            expect(read.defenseWinOnly).toBe(false);
        });

        it('never trades on a board that is not losing', function() {
            expect(policy.read(input()).defenseWinOnly).toBe(false);
        });
    });

    describe('the ready loop', function() {
        const policy = new ConflictTempoPolicy({
            enabled: true,
            readyLoopEnabled: true,
            readyRingBonusPerSkill: 4
        });

        it('prices the water ring from the body it would bring back', function() {
            const read = policy.read(input({ myBowed: [body(5), body(2)] }));
            expect(read.readyRingBonus).toBe(20);
        });

        it('caps the bonus', function() {
            const capped = new ConflictTempoPolicy({
                enabled: true, readyLoopEnabled: true, readyRingBonusPerSkill: 4, readyRingBonusCap: 12
            });
            expect(capped.read(input({ myBowed: [body(9)] })).readyRingBonus).toBe(12);
        });

        it('needs a spare body to attack with while the other is bowed', function() {
            const read = policy.read(input({ myReady: [body(3)], myBowed: [body(5)] }));
            expect(read.readyRingBonus).toBe(0);
        });

        it('fires for a readied DEFENDER, which V1 never counted', function() {
            const read = policy.read(input({
                myBowed: [body(5)],
                myConflictsRemaining: 0,
                opponentConflictsRemaining: 1
            }));
            expect(read.readyRingBonus).toBe(20);
        });

        it('does not fire with nothing bowed and nothing coming', function() {
            expect(policy.read(input({ myBowed: [] })).readyRingBonus).toBe(0);
            expect(policy.read(input({
                myBowed: [body(5)],
                myConflictsRemaining: 0,
                opponentConflictsRemaining: 0
            })).readyRingBonus).toBe(0);
        });

        it('keeps a body home on a winning board only when asked to', function() {
            const winning = { theirReady: [body(2)], myBowed: [body(4)] };
            expect(policy.read(input(winning)).attackKeepHome).toBeUndefined();
            const holding = new ConflictTempoPolicy({
                enabled: true, readyLoopEnabled: true, readyRingBonusPerSkill: 4,
                controlAttackKeepHome: 1
            });
            expect(holding.read(input(winning)).attackKeepHome).toBe(1);
            // Losing board: nothing to hold back for.
            expect(holding.read(input({ theirReady: [body(9), body(9)], myBowed: [body(4)] }))
                .attackKeepHome).toBeUndefined();
        });
    });

    describe('first player projection', function() {
        it('is the negation, because the token alternates unconditionally', function() {
            const policy = new ConflictTempoPolicy({ enabled: true });
            expect(policy.read(input({ isFirstPlayer: true })).firstPlayerNextRound).toBe(false);
            expect(policy.read(input({ isFirstPlayer: false })).firstPlayerNextRound).toBe(true);
        });

        // Shipped at 1 on the owner's call after measuring a clean null
        // (+0.01pp, p=1.00, 4896 games). Pinned here so a later profile edit
        // cannot silently drop it, and so the endgame half stays off.
        it('buys persistent bodies as second player, field-wide', function() {
            expect(DEFAULT_FATE_AWARE_ECONOMY.bodyAdditionalFateSecondPlayer).toBe(1);
            expect(DEFAULT_PROFILE.fateAwareEconomy.bodyAdditionalFateSecondPlayer).toBe(1);
            expect(SWARM_FATE_AWARE_ECONOMY.bodyAdditionalFateSecondPlayer).toBe(1);
        });

        it('leaves the endgame knob unset, which is V1', function() {
            expect(DEFAULT_FATE_AWARE_ECONOMY.bodyAdditionalFateEndgame).toBeUndefined();
            expect(DEFAULT_PROFILE.fateAwareEconomy.bodyAdditionalFateEndgame).toBeUndefined();
        });
    });
});
