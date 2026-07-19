const {
    DuelBidTactics,
    DEFAULT_DUEL_BID_PROFILE
} = require('../../../build/server/game/bots/DuelBidTactics.js');

describe('DuelBidTactics', function() {
    const tactics = new DuelBidTactics(DEFAULT_DUEL_BID_PROFILE);

    function context(overrides = {}) {
        return {
            mySkill: 5,
            opponentSkill: 5,
            myHonor: 11,
            opponentHonor: 11,
            roundNumber: 1,
            ...overrides
        };
    }

    it('evaluates every 1..5 versus 1..5 bid pairing', function() {
        const analysis = tactics.analyze(context(), 0.5);
        expect(analysis.matrix.length).toBe(25);
        expect(analysis.bids.map((entry) => entry.bid)).toEqual([1, 2, 3, 4, 5]);
        expect(Object.keys(analysis.opponentBidProbabilities)).toEqual(['1', '2', '3', '4', '5']);
        expect(Object.values(analysis.opponentBidProbabilities)
            .reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 10);
    });

    it('reports exact uniform duel-win percentages for each bid', function() {
        const analysis = tactics.analyze(context({ mySkill: 4, opponentSkill: 5 }), 0.5);
        expect(analysis.bids.map((entry) => entry.uniformWinProbability)).toEqual([0, 0, 0.2, 0.4, 0.6]);
    });

    it('banks honor instead of always bidding 5 into a safe higher-skill opponent', function() {
        const analysis = tactics.analyze(context({
            mySkill: 4,
            opponentSkill: 5,
            myHonor: 11,
            opponentHonor: 11
        }), 0);
        expect(analysis.recommendedBid).toBe(1);
        expect(analysis.selectedBid).toBe(1);
        expect(analysis.bids.find((entry) => entry.bid === 1).expectedHonorDelta).toBeGreaterThan(0);
    });

    it('pressures a higher-skill opponent whose low honor makes a high answer dangerous', function() {
        const analysis = tactics.analyze(context({
            mySkill: 4,
            opponentSkill: 5,
            myHonor: 11,
            opponentHonor: 4
        }), 0.5);
        expect(analysis.recommendedBid).toBe(5);
        expect(analysis.bids.find((entry) => entry.bid === 5).modeledWinProbability).toBeGreaterThan(0.5);
    });

    it('forces the minimum bid when every duel-win probability is near zero', function() {
        const analysis = tactics.analyze(context({ mySkill: 1, opponentSkill: 7 }), 0.99);
        expect(analysis.reason).toBe('near-zero-win');
        expect(analysis.selectedBid).toBe(1);
        expect(analysis.bids.find((entry) => entry.bid === 1).strategyProbability).toBe(1);
    });

    it('uses the minimum when skill alone beats every legal opposing bid', function() {
        const analysis = tactics.analyze(context({ mySkill: 10, opponentSkill: 4 }), 0);
        expect(analysis.recommendedBid).toBe(1);
        expect(analysis.bids.find((entry) => entry.bid === 1).modeledWinProbability).toBeCloseTo(1, 10);
    });

    it('protects both dishonor and honor-victory cliffs', function() {
        expect(tactics.analyze(context({
            mySkill: 5, opponentSkill: 4, myHonor: 3, opponentHonor: 11
        }), 0.5).recommendedBid).toBe(1);
        expect(tactics.analyze(context({
            mySkill: 5, opponentSkill: 4, myHonor: 11, opponentHonor: 24
        }), 0.5).recommendedBid).toBe(1);
    });

    it('bids more conservatively later in the game', function() {
        const early = tactics.analyze(context({ roundNumber: 1 }), 0.5);
        const late = tactics.analyze(context({ roundNumber: 5 }), 0.5);
        const expectedBid = (analysis) => analysis.bids.reduce((sum, entry) =>
            sum + entry.bid * entry.strategyProbability, 0);
        expect(expectedBid(early)).toBeGreaterThan(expectedBid(late));
    });

    it('mixes genuinely contested bids without gambling in decided positions', function() {
        const contested = tactics.analyze(context(), 0.5);
        const assured = tactics.analyze(context({ mySkill: 10, opponentSkill: 4 }), 0.5);
        const endangered = tactics.analyze(context({
            mySkill: 5, opponentSkill: 4, myHonor: 3
        }), 0.5);
        const usedBids = (analysis) => analysis.bids
            .filter((entry) => entry.strategyProbability > 0)
            .map((entry) => entry.bid);

        expect(contested.reason).toBe('mind-game');
        expect(usedBids(contested).length).toBeGreaterThan(2);
        expect(assured.reason).toBe('modeled-utility');
        expect(usedBids(assured)).toEqual([1, 2]);
        expect(endangered.reason).toBe('modeled-utility');
        expect(usedBids(endangered)).toEqual([1]);
    });

    it('projects Iaijutsu Master as an advantage for us and a risk on the opponent', function() {
        const base = context({ mySkill: 4, opponentSkill: 5, roundNumber: 2 });
        const ordinary = tactics.analyze(base, 0.5);
        const spent = tactics.analyze({ ...base, myIaijutsuMasterReady: false }, 0.5);
        const mine = tactics.analyze({ ...base, myIaijutsuMasterReady: true }, 0.5);
        const theirs = tactics.analyze({ ...base, opponentIaijutsuMasterReady: true }, 0.5);
        const bestWin = (analysis) => Math.max(...analysis.bids.map((entry) => entry.modeledWinProbability));
        expect(bestWin(mine)).toBeGreaterThan(bestWin(ordinary));
        expect(bestWin(theirs)).toBeLessThan(bestWin(ordinary));
        expect(bestWin(spent)).toBeCloseTo(bestWin(ordinary), 10);
        expect(mine.matrix.some((outcome) => outcome.myEffectiveBid === 6)).toBe(true);
        expect(mine.matrix.some((outcome) => outcome.myEffectiveBid === 0)).toBe(true);
    });

    it('allows a deck profile to inject different risk priorities', function() {
        const position = context({
            mySkill: 2,
            opponentSkill: 2,
            myHonor: 4,
            opponentHonor: 3,
            roundNumber: 3
        });
        const dishonor = new DuelBidTactics({
            ...DEFAULT_DUEL_BID_PROFILE,
            objective: 'dishonor',
            duelWinUtility: 2,
            honorSwingUtility: 2,
            opponentLowHonorUtility: 3
        });
        expect(tactics.analyze(position).recommendedBid).toBe(2);
        expect(dishonor.analyze(position).recommendedBid).toBe(1);
    });

    it('models the opponent from its public deck risk profile', function() {
        const position = context({
            mySkill: 5,
            opponentSkill: 5,
            myHonor: 11,
            opponentHonor: 4,
            roundNumber: 3
        });
        const ordinary = tactics.analyze(position);
        const versusDishonor = tactics.analyze({
            ...position,
            opponentProfile: {
                ...DEFAULT_DUEL_BID_PROFILE,
                objective: 'dishonor',
                opponentLowHonorUtility: 3,
                honorSwingUtility: 1.5
            }
        });

        expect(ordinary.recommendedBid).toBe(4);
        expect(versusDishonor.recommendedBid).toBe(3);
        expect(versusDishonor.opponentBidProbabilities[1])
            .toBeGreaterThan(ordinary.opponentBidProbabilities[1]);
    });

    it('changes Iaijutsu bids only when result or honor efficiency improves', function() {
        expect(tactics.iaijutsuBidChoice(-1)).toBe('Increase honor bid');
        expect(tactics.iaijutsuBidChoice(0)).toBe('Increase honor bid');
        expect(tactics.iaijutsuBidChoice(1)).toBeNull();
        expect(tactics.iaijutsuBidChoice(2)).toBe('Decrease honor bid');
    });
});
