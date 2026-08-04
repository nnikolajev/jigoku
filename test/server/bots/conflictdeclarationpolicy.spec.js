const {
    ConflictDeclarationPolicy,
    DEFAULT_CONFLICT_DECLARATION
} = require('../../../build/server/game/bots/ConflictDeclarationPolicy.js');
const { DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');

// V1's fair axis choice reads only its OWN board. The omniscient variant next
// to it attacks where the real differential is largest — mine minus theirs
// minus their hand tricks — and only that last term is actually hidden. The
// opponent's ready board is public, and the fair RING choice already reads it.
// `opponentBoardWeight` is how much of that public term the fair bot uses.
describe('ConflictDeclarationPolicy', function() {
    const input = (over = {}) => Object.assign({
        myMilitary: 8,
        myPolitical: 6,
        theirMilitary: 9,
        theirPolitical: 1,
        forceMilitary: false
    }, over);

    describe('defaults reproduce V1 exactly', function() {
        const policy = new ConflictDeclarationPolicy();

        it('picks the axis its own board is strongest on', function() {
            expect(policy.chooseAxis(input()).axis).toBe('military');
            expect(policy.chooseAxis(input()).reason).toBe('own-board');
        });

        it('breaks a tie toward military, like the old expression', function() {
            expect(policy.chooseAxis(input({ myMilitary: 5, myPolitical: 5 })).axis).toBe('military');
        });

        it('picks political when political skill leads', function() {
            expect(policy.chooseAxis(input({ myMilitary: 2, myPolitical: 7 })).axis).toBe('political');
        });

        it('ignores the opponent board entirely', function() {
            const crushed = policy.chooseAxis(input({ theirMilitary: 99, theirPolitical: 0 }));
            expect(crushed.axis).toBe('military');
        });

        it('picks military for a zero-zero board, like the old expression', function() {
            expect(policy.chooseAxis(input({ myMilitary: 0, myPolitical: 0 })).axis).toBe('military');
        });
    });

    describe('forceMilitary', function() {
        it('stays military while any military skill exists', function() {
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 1 })
                .chooseAxis(input({ myMilitary: 1, myPolitical: 20, forceMilitary: true }));
            expect(result.axis).toBe('military');
            expect(result.reason).toBe('force-military');
        });

        it('falls through when the deck has no military skill at all', function() {
            const result = new ConflictDeclarationPolicy()
                .chooseAxis(input({ myMilitary: 0, myPolitical: 20, forceMilitary: true }));
            expect(result.axis).toBe('political');
        });
    });

    describe('opponentBoardWeight', function() {
        it('switches away from a contested axis toward an open one', function() {
            // 8 mil into a 9-mil wall vs 6 pol into a 1-pol board.
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 1 })
                .chooseAxis(input());
            expect(result.axis).toBe('political');
            expect(result.baseline).toBe('military');
            expect(result.reason).toBe('opponent-aware');
        });

        it('does not switch when the own-board pick is also the better trade', function() {
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 1 })
                .chooseAxis(input({ theirMilitary: 0, theirPolitical: 9 }));
            expect(result.axis).toBe('military');
            expect(result.reason).toBe('own-board');
        });

        it('scales: a partial weight keeps the own-board pick', function() {
            // 8 - 0.25*9 = 5.75 vs 6 - 0.25*1 = 5.75 -> tie -> military.
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 0.25 })
                .chooseAxis(input());
            expect(result.axis).toBe('military');
        });
    });

    describe('the zero-skill guards are load-bearing at every weight', function() {
        it('never steers onto an axis with no legal attacker', function() {
            // Political looks better after subtracting their empty political
            // board, but we have no political skill to attack with.
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 1 })
                .chooseAxis(input({ myMilitary: 4, myPolitical: 0, theirMilitary: 20, theirPolitical: 0 }));
            expect(result.axis).toBe('military');
            expect(result.reason).toBe('only-military');
        });

        it('and never onto an empty military axis', function() {
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 1 })
                .chooseAxis(input({ myMilitary: 0, myPolitical: 4, theirMilitary: 0, theirPolitical: 20 }));
            expect(result.axis).toBe('political');
            expect(result.reason).toBe('only-political');
        });
    });

    describe('switchMargin', function() {
        it('refuses to flip the declaration for a fractional gain', function() {
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 1, switchMargin: 3 })
                .chooseAxis(input({ myMilitary: 8, myPolitical: 6, theirMilitary: 3, theirPolitical: 0 }));
            // 8-3 = 5 vs 6-0 = 6: political wins by 1, below a margin of 3.
            expect(result.axis).toBe('military');
            expect(result.reason).toBe('below-margin');
        });

        it('allows a flip that clears the margin', function() {
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 1, switchMargin: 3 })
                .chooseAxis(input({ myMilitary: 8, myPolitical: 6, theirMilitary: 9, theirPolitical: 0 }));
            // 8-9 = -1 vs 6-0 = 6: political wins by 7.
            expect(result.axis).toBe('political');
            expect(result.reason).toBe('opponent-aware');
        });
    });

    describe('avoidExhaustedAxis', function() {
        const policy = () => new ConflictDeclarationPolicy({
            opponentBoardWeight: 1,
            avoidExhaustedAxis: true
        });

        it('refuses an axis we have no conflicts left to declare on', function() {
            // Opponent-aware would pick political; political is spent.
            const result = policy().chooseAxis(input({ politicalRemaining: 0, militaryRemaining: 1 }));
            expect(result.axis).toBe('military');
            expect(result.reason).toBe('axis-exhausted');
        });

        it('leaves the choice alone when both axes are available', function() {
            const result = policy().chooseAxis(input({ politicalRemaining: 1, militaryRemaining: 1 }));
            expect(result.reason).toBe('opponent-aware');
        });

        it('leaves the choice alone when the counts are unknown', function() {
            expect(policy().chooseAxis(input()).reason).toBe('opponent-aware');
        });

        it('does nothing when off, even with an axis exhausted', function() {
            const result = new ConflictDeclarationPolicy({ opponentBoardWeight: 1 })
                .chooseAxis(input({ politicalRemaining: 0 }));
            expect(result.axis).toBe('political');
        });
    });

    it('the CLASS default reproduces V1, so an unconfigured policy is inert', function() {
        expect(DEFAULT_CONFLICT_DECLARATION.opponentBoardWeight).toBe(0);
        expect(DEFAULT_CONFLICT_DECLARATION.switchMargin).toBe(0);
        expect(DEFAULT_CONFLICT_DECLARATION.avoidExhaustedAxis).toBe(false);
    });

    it('but the shipped DECK PROFILE turns the opponent board on', function() {
        // Measured +1.58pp head-to-head over 6468 games on 36 independent
        // bases (z=2.54, p=0.011). The split is deliberate: the class default
        // documents V1 so the policy can be constructed inert in a test, and
        // the profile carries what actually ships.
        expect(DEFAULT_PROFILE.conflictDeclaration.opponentBoardWeight).toBe(1);
    });
});
