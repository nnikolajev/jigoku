// Shared duel honor-bid policy.
//
// A duel bid has two coupled results:
//   1. skill + bid decides the duel;
//   2. the higher bidder transfers the bid difference to the lower bidder.
//
// Treating only the skill gap as the old policy did makes a one-skill deficit
// trivial to exploit: it always bids 5 even when the opponent can safely bid
// 5 too. This module instead evaluates every 1..5 by 1..5 pairing, projects
// honor transfer/game-ending risk, models the opponent's likely bids, then
// returns a mixed recommendation. All weights live in DuelBidProfile so a
// deck can inject different honor/duel priorities without replacing flow.

export type DuelBidObjective = 'balanced' | 'honor' | 'dishonor';
export type DuelResult = 'win' | 'draw' | 'loss';
export type DuelGameResult = 'win' | 'loss' | null;

export interface DuelBidProfile {
    minimumBid: number;
    maximumBid: number;
    honorVictoryThreshold: number;
    dishonorDefeatThreshold: number;
    lowHonorReserve: number;
    honorDangerWindow: number;
    duelWinUtility: number;
    duelLossUtility: number;
    duelDrawUtility: number;
    earlyRoundWinBonus: number;
    roundWinDecay: number;
    minimumRoundWinMultiplier: number;
    honorSwingUtility: number;
    roundHonorRiskGrowth: number;
    lowHonorRiskUtility: number;
    honorRaceUtility: number;
    opponentLowHonorUtility: number;
    terminalUtility: number;
    opponentModelSharpness: number;
    strategySharpness: number;
    mixedUtilityWindow: number;
    mindGameMinimumWinProbability: number;
    mindGameMaximumWinProbability: number;
    mindGameStrategySharpness: number;
    mindGameUtilityWindow: number;
    nearZeroWinProbability: number;
    participantContestWinProbability: number;
    iaijutsuAdjustment: number;
    objective: DuelBidObjective;
}

export interface DuelBidContext {
    mySkill: number;
    opponentSkill: number;
    myHonor: number;
    opponentHonor: number;
    roundNumber?: number;
    myIaijutsuMasterReady?: boolean;
    opponentIaijutsuMasterReady?: boolean;
    myWinsTies?: boolean;
    opponentWinsTies?: boolean;
    // Deck lists are public in L5R. Supplying the opponent's resolved profile
    // lets the response model understand honor/dishonor deck incentives.
    opponentProfile?: DuelBidProfile;
    legalBids?: number[];
}

export interface DuelBidOutcome {
    myBid: number;
    opponentBid: number;
    myEffectiveBid: number;
    opponentEffectiveBid: number;
    mySkillTotal: number;
    opponentSkillTotal: number;
    myHonorAfter: number;
    opponentHonorAfter: number;
    myHonorDelta: number;
    opponentHonorDelta: number;
    duelResult: DuelResult;
    gameResult: DuelGameResult;
    utility: number;
}

export interface DuelBidStat {
    bid: number;
    uniformWinProbability: number;
    modeledWinProbability: number;
    modeledDrawProbability: number;
    modeledLossProbability: number;
    gameWinProbability: number;
    gameLossProbability: number;
    expectedHonorDelta: number;
    expectedUtility: number;
    strategyProbability: number;
}

export interface DuelBidAnalysis {
    matrix: DuelBidOutcome[];
    opponentBidProbabilities: Record<number, number>;
    bids: DuelBidStat[];
    recommendedBid: number;
    selectedBid: number;
    reason: 'near-zero-win' | 'mind-game' | 'modeled-utility';
}

export const DEFAULT_DUEL_BID_PROFILE: DuelBidProfile = {
    minimumBid: 1,
    maximumBid: 5,
    honorVictoryThreshold: 25,
    dishonorDefeatThreshold: 0,
    lowHonorReserve: 4,
    honorDangerWindow: 6,
    duelWinUtility: 5,
    duelLossUtility: 3,
    duelDrawUtility: 0,
    earlyRoundWinBonus: 0.45,
    roundWinDecay: 0.12,
    minimumRoundWinMultiplier: 0.7,
    honorSwingUtility: 0.8,
    roundHonorRiskGrowth: 0.18,
    lowHonorRiskUtility: 1.8,
    honorRaceUtility: 1.25,
    opponentLowHonorUtility: 1.25,
    terminalUtility: 1000,
    opponentModelSharpness: 0.8,
    strategySharpness: 1.2,
    mixedUtilityWindow: 1.25,
    mindGameMinimumWinProbability: 0.05,
    mindGameMaximumWinProbability: 0.95,
    mindGameStrategySharpness: 0.5,
    mindGameUtilityWindow: 4,
    nearZeroWinProbability: 0.03,
    participantContestWinProbability: 0.25,
    iaijutsuAdjustment: 1,
    objective: 'balanced'
};

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.max(minimum, Math.min(maximum, value));

const finite = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export class DuelBidTactics {
    constructor(private profile: DuelBidProfile = DEFAULT_DUEL_BID_PROFILE) {}

    analyze(context: DuelBidContext, roll = 0.5): DuelBidAnalysis {
        const bids = this.legalBids(context);
        const opponentBids = this.bidRange();
        const matrix = bids.flatMap((myBid) => opponentBids.map((opponentBid) =>
            this.resolvePair(context, myBid, opponentBid)));
        const opponentBidProbabilities = this.modelOpponentBids(context, bids, opponentBids);
        const stats = bids.map((bid) => this.statForBid(
            bid,
            matrix.filter((outcome) => outcome.myBid === bid),
            opponentBidProbabilities
        ));

        const bestWinProbability = Math.max(...stats.map((stat) => stat.modeledWinProbability));
        if(bestWinProbability <= this.profile.nearZeroWinProbability) {
            const selectedBid = bids.reduce((lowest, bid) => Math.min(lowest, bid), bids[0]);
            const selected = stats.find((stat) => stat.bid === selectedBid) || stats[0];
            for(const stat of stats) {
                stat.strategyProbability = stat === selected ? 1 : 0;
            }
            return {
                matrix,
                opponentBidProbabilities,
                bids: stats,
                recommendedBid: selectedBid,
                selectedBid,
                reason: 'near-zero-win'
            };
        }

        const mindGame = bestWinProbability >= this.profile.mindGameMinimumWinProbability &&
            bestWinProbability <= this.profile.mindGameMaximumWinProbability;
        const utilityWindow = mindGame
            ? this.profile.mindGameUtilityWindow
            : this.profile.mixedUtilityWindow;
        const strategySharpness = mindGame
            ? this.profile.mindGameStrategySharpness
            : this.profile.strategySharpness;
        const bestUtility = Math.max(...stats.map((stat) => stat.expectedUtility));
        const viable = stats.filter((stat) =>
            stat.expectedUtility >= bestUtility - utilityWindow);
        const probabilities = this.softmax(
            viable.map((stat) => stat.expectedUtility),
            strategySharpness
        );
        for(const stat of stats) {
            const index = viable.indexOf(stat);
            stat.strategyProbability = index >= 0 ? probabilities[index] : 0;
        }

        const recommendedBid = stats.slice().sort((left, right) =>
            right.expectedUtility - left.expectedUtility ||
            right.modeledWinProbability - left.modeledWinProbability ||
            left.bid - right.bid)[0].bid;
        const selectedBid = this.sample(stats, clamp(roll, 0, 0.999999999));
        return {
            matrix,
            opponentBidProbabilities,
            bids: stats,
            recommendedBid,
            selectedBid,
            reason: mindGame ? 'mind-game' : 'modeled-utility'
        };
    }

    chooseBid(context: DuelBidContext, roll = 0.5): number {
        return this.analyze(context, roll).selectedBid;
    }

    shouldContest(context: DuelBidContext): boolean {
        const analysis = this.analyze(context, 0.5);
        return Math.max(...analysis.bids.map((bid) => bid.modeledWinProbability)) >=
            this.profile.participantContestWinProbability;
    }

    // Post-reveal Iaijutsu Master choice. A +1 converts a one-point loss into
    // a draw or a tie into a win. A -1 keeps a two-point win while improving
    // honor transfer. Other changes either lose a win or cannot change result.
    iaijutsuBidChoice(duelMargin: number | undefined): 'Increase honor bid' | 'Decrease honor bid' | null {
        if(duelMargin === -1 || duelMargin === 0) {
            return 'Increase honor bid';
        }
        if(duelMargin !== undefined && duelMargin >= 2) {
            return 'Decrease honor bid';
        }
        return null;
    }

    shouldUseIaijutsuMaster(duelMargin: number | undefined): boolean {
        return this.iaijutsuBidChoice(duelMargin) !== null;
    }

    private legalBids(context: DuelBidContext): number[] {
        const supplied = (context.legalBids || [])
            .map((bid) => Math.trunc(bid))
            .filter((bid) => Number.isFinite(bid));
        const legal = supplied.length > 0 ? supplied : this.bidRange();
        return [...new Set(legal)].sort((left, right) => left - right);
    }

    private bidRange(): number[] {
        const minimum = Math.trunc(this.profile.minimumBid);
        const maximum = Math.trunc(this.profile.maximumBid);
        return Array.from({ length: Math.max(maximum - minimum + 1, 1) }, (_, index) => minimum + index);
    }

    private resolvePair(context: DuelBidContext, myBid: number, opponentBid: number): DuelBidOutcome {
        const myAdjustments = context.myIaijutsuMasterReady
            ? [0, -this.profile.iaijutsuAdjustment, this.profile.iaijutsuAdjustment] : [0];
        const opponentAdjustments = context.opponentIaijutsuMasterReady
            ? [0, -this.profile.iaijutsuAdjustment, this.profile.iaijutsuAdjustment] : [0];

        // Iaijutsu reactions happen after reveal. Model opponent as hostile:
        // choose our adjustment whose worst opponent reply has best utility.
        let chosen: DuelBidOutcome | null = null;
        for(const myAdjustment of myAdjustments) {
            let worstReply: DuelBidOutcome | null = null;
            for(const opponentAdjustment of opponentAdjustments) {
                const outcome = this.rawOutcome(
                    context,
                    myBid,
                    opponentBid,
                    clamp(myBid + myAdjustment, 0, this.profile.maximumBid + this.profile.iaijutsuAdjustment),
                    clamp(opponentBid + opponentAdjustment, 0, this.profile.maximumBid + this.profile.iaijutsuAdjustment)
                );
                if(!worstReply || outcome.utility < worstReply.utility) {
                    worstReply = outcome;
                }
            }
            if(worstReply && (!chosen || worstReply.utility > chosen.utility)) {
                chosen = worstReply;
            }
        }
        return chosen || this.rawOutcome(context, myBid, opponentBid, myBid, opponentBid);
    }

    private rawOutcome(
        context: DuelBidContext,
        myBid: number,
        opponentBid: number,
        myEffectiveBid: number,
        opponentEffectiveBid: number
    ): DuelBidOutcome {
        const mySkill = finite(context.mySkill, 0);
        const opponentSkill = finite(context.opponentSkill, 0);
        const myHonor = finite(context.myHonor, 10);
        const opponentHonor = finite(context.opponentHonor, 10);
        const difference = Math.abs(myEffectiveBid - opponentEffectiveBid);
        const myHonorDelta = myEffectiveBid < opponentEffectiveBid
            ? difference : myEffectiveBid > opponentEffectiveBid ? -difference : 0;
        const opponentHonorDelta = -myHonorDelta;
        const myHonorAfter = myHonor + myHonorDelta;
        const opponentHonorAfter = opponentHonor + opponentHonorDelta;
        const mySkillTotal = mySkill + myEffectiveBid;
        const opponentSkillTotal = opponentSkill + opponentEffectiveBid;
        let duelResult: DuelResult;
        if(mySkillTotal > opponentSkillTotal) {
            duelResult = 'win';
        } else if(mySkillTotal < opponentSkillTotal) {
            duelResult = 'loss';
        } else if(context.myWinsTies && !context.opponentWinsTies) {
            duelResult = 'win';
        } else if(context.opponentWinsTies && !context.myWinsTies) {
            duelResult = 'loss';
        } else {
            duelResult = 'draw';
        }

        let gameResult: DuelGameResult = null;
        if(myHonorAfter <= this.profile.dishonorDefeatThreshold ||
            opponentHonorAfter >= this.profile.honorVictoryThreshold) {
            gameResult = 'loss';
        } else if(opponentHonorAfter <= this.profile.dishonorDefeatThreshold ||
            myHonorAfter >= this.profile.honorVictoryThreshold) {
            gameResult = 'win';
        }

        const outcome: DuelBidOutcome = {
            myBid,
            opponentBid,
            myEffectiveBid,
            opponentEffectiveBid,
            mySkillTotal,
            opponentSkillTotal,
            myHonorAfter,
            opponentHonorAfter,
            myHonorDelta,
            opponentHonorDelta,
            duelResult,
            gameResult,
            utility: 0
        };
        outcome.utility = this.utility(context, outcome);
        return outcome;
    }

    private utility(context: DuelBidContext, outcome: DuelBidOutcome): number {
        if(outcome.gameResult === 'win') {
            return this.profile.terminalUtility;
        }
        if(outcome.gameResult === 'loss') {
            return -this.profile.terminalUtility;
        }

        const round = Math.max(1, Math.trunc(context.roundNumber || 1));
        const roundMultiplier = Math.max(
            this.profile.minimumRoundWinMultiplier,
            1 + this.profile.earlyRoundWinBonus - (round - 1) * this.profile.roundWinDecay
        );
        let utility = outcome.duelResult === 'win'
            ? this.profile.duelWinUtility * roundMultiplier
            : outcome.duelResult === 'loss'
                ? -this.profile.duelLossUtility * roundMultiplier
                : this.profile.duelDrawUtility;

        const objectiveHonorScale = this.profile.objective === 'dishonor' ? 1.35 :
            this.profile.objective === 'honor' ? 1.15 : 1;
        const roundHonorScale = 1 + (round - 1) * this.profile.roundHonorRiskGrowth;
        utility += outcome.myHonorDelta * this.profile.honorSwingUtility * objectiveHonorScale * roundHonorScale;

        if(outcome.myHonorAfter <= this.profile.lowHonorReserve) {
            utility -= (this.profile.lowHonorReserve - outcome.myHonorAfter + 1) *
                this.profile.lowHonorRiskUtility;
        }
        if(outcome.opponentHonorAfter <= this.profile.lowHonorReserve) {
            const objectiveScale = this.profile.objective === 'dishonor' ? 1.7 : 1;
            utility += (this.profile.lowHonorReserve - outcome.opponentHonorAfter + 1) *
                this.profile.opponentLowHonorUtility * objectiveScale;
        }

        const myHonorDistance = this.profile.honorVictoryThreshold - outcome.myHonorAfter;
        const opponentHonorDistance = this.profile.honorVictoryThreshold - outcome.opponentHonorAfter;
        if(myHonorDistance <= this.profile.honorDangerWindow) {
            const objectiveScale = this.profile.objective === 'honor' ? 1.7 : 1;
            utility += (this.profile.honorDangerWindow - myHonorDistance + 1) *
                this.profile.honorRaceUtility * objectiveScale;
        }
        if(opponentHonorDistance <= this.profile.honorDangerWindow) {
            utility -= (this.profile.honorDangerWindow - opponentHonorDistance + 1) *
                this.profile.honorRaceUtility;
        }
        return utility;
    }

    private modelOpponentBids(
        context: DuelBidContext,
        myBids: number[],
        opponentBids: number[]
    ): Record<number, number> {
        const mirrored: DuelBidContext = {
            mySkill: context.opponentSkill,
            opponentSkill: context.mySkill,
            myHonor: context.opponentHonor,
            opponentHonor: context.myHonor,
            roundNumber: context.roundNumber,
            myIaijutsuMasterReady: context.opponentIaijutsuMasterReady,
            opponentIaijutsuMasterReady: context.myIaijutsuMasterReady,
            myWinsTies: context.opponentWinsTies,
            opponentWinsTies: context.myWinsTies
        };
        const opponentTactics = new DuelBidTactics(context.opponentProfile || DEFAULT_DUEL_BID_PROFILE);
        const utilities = opponentBids.map((opponentBid) =>
            myBids.reduce((total, myBid) =>
                total + opponentTactics.resolvePair(mirrored, opponentBid, myBid).utility, 0) / myBids.length);
        const probabilities = this.softmax(utilities, this.profile.opponentModelSharpness);
        return Object.fromEntries(opponentBids.map((bid, index) => [bid, probabilities[index]]));
    }

    private statForBid(
        bid: number,
        outcomes: DuelBidOutcome[],
        opponentProbabilities: Record<number, number>
    ): DuelBidStat {
        const probabilityOf = (outcome: DuelBidOutcome): number =>
            opponentProbabilities[outcome.opponentBid] || 0;
        return {
            bid,
            uniformWinProbability: outcomes.filter((outcome) => outcome.duelResult === 'win').length /
                Math.max(outcomes.length, 1),
            modeledWinProbability: outcomes.filter((outcome) => outcome.duelResult === 'win')
                .reduce((total, outcome) => total + probabilityOf(outcome), 0),
            modeledDrawProbability: outcomes.filter((outcome) => outcome.duelResult === 'draw')
                .reduce((total, outcome) => total + probabilityOf(outcome), 0),
            modeledLossProbability: outcomes.filter((outcome) => outcome.duelResult === 'loss')
                .reduce((total, outcome) => total + probabilityOf(outcome), 0),
            gameWinProbability: outcomes.filter((outcome) => outcome.gameResult === 'win')
                .reduce((total, outcome) => total + probabilityOf(outcome), 0),
            gameLossProbability: outcomes.filter((outcome) => outcome.gameResult === 'loss')
                .reduce((total, outcome) => total + probabilityOf(outcome), 0),
            expectedHonorDelta: outcomes.reduce((total, outcome) =>
                total + outcome.myHonorDelta * probabilityOf(outcome), 0),
            expectedUtility: outcomes.reduce((total, outcome) =>
                total + outcome.utility * probabilityOf(outcome), 0),
            strategyProbability: 0
        };
    }

    private softmax(values: number[], sharpness: number): number[] {
        const safeSharpness = Math.max(sharpness, 0.0001);
        const scaled = values.map((value) => value * safeSharpness);
        const maximum = Math.max(...scaled);
        const exponents = scaled.map((value) => Math.exp(clamp(value - maximum, -700, 700)));
        const total = exponents.reduce((sum, value) => sum + value, 0);
        return exponents.map((value) => value / total);
    }

    private sample(stats: DuelBidStat[], roll: number): number {
        let cumulative = 0;
        for(const stat of stats) {
            cumulative += stat.strategyProbability;
            if(roll < cumulative) {
                return stat.bid;
            }
        }
        return stats[stats.length - 1].bid;
    }
}

export default DuelBidTactics;
