// Shared draw-phase honor-dial policy.
//
// Draw bidding is an economy decision, not a prompt-local guess: the bid buys
// cards, but the higher bidder transfers the difference in honor to the lower
// bidder. This module keeps every input and tuning weight explicit so deck
// profiles can adjust priorities without adding branches to JigokuBotPolicy.

export type DrawBidObjective = 'cards' | 'balanced' | 'honor' | 'dishonor';
export type DrawBidPolicyVariant = 'adaptive' | 'legacy';

export interface DrawBidBoardState {
    characterCount: number;
    readyCharacterCount: number;
    persistentCharacterCount: number;
    attachmentCount: number;
    totalCharacterFate: number;
    militarySkill: number;
    politicalSkill: number;
}

export interface DrawBidContext {
    roundNumber?: number;
    myHonor: number;
    opponentHonor: number;
    myHandCount: number;
    opponentHandCount: number;
    myFate: number;
    opponentFate: number;
    fateOnUnclaimedRings: number;
    myBrokenProvinces: number;
    opponentBrokenProvinces: number;
    averageConflictCardCost: number;
    handCardCosts: number[];
    board: DrawBidBoardState;
    legalBids?: number[];
}

export interface DrawBidProfile {
    objective: DrawBidObjective;
    openingBid: number;
    baseBid: number;
    minimumRoutineBid: number;
    lowBid: number;
    lowHonorThreshold: number;
    opponentLowHonorThreshold: number;
    honorWinSetupThreshold: number;
    opponentHonorThreatThreshold: number;
    strongholdEmergencyBid: number;
    forceLowAfterOpening: boolean;
    ringFateConversion: number;
    ringFateCap: number;
    existingHandCostReservation: number;
    averageCostFloor: number;
    cheapDeckCostThreshold: number;
    cheapDeckCardAllowance: number;
    fatePressureWeight: number;
    comfortableHandSize: number;
    crowdedHandSize: number;
    comfortableHandPenalty: number;
    crowdedHandPenalty: number;
    strongBoardThreshold: number;
    dominantBoardThreshold: number;
    strongBoardPenalty: number;
    dominantBoardPenalty: number;
    persistentCharacterWeight: number;
    attachmentWeight: number;
    characterFateWeight: number;
    boardSkillWeight: number;
    honorPlanSelfThreshold: number;
    dishonorPlanOpponentThreshold: number;
    predictedHighBidThreshold: number;
    honorOpportunityPenalty: number;
}

export interface LegacyDrawBidProfile {
    mode: 'generic' | 'fixed-after-opening' | 'low-after-opening';
    openingBid: number;
    laterBid: number;
    lowBid: number;
    lowHonorThreshold: number;
    drawBidCap?: number;
}

export interface DrawBidAnalysis {
    selectedBid: number;
    rawBid: number;
    reason: string;
    effectiveFate: number;
    availableFateForNewCards: number;
    estimatedUsefulDraws: number;
    predictedOpponentBid: number;
    deductions: {
        fate: number;
        hand: number;
        board: number;
        honorOpportunity: number;
    };
}

export const DEFAULT_DRAW_BID_PROFILE: DrawBidProfile = {
    objective: 'balanced',
    openingBid: 5,
    baseBid: 5,
    minimumRoutineBid: 1,
    lowBid: 1,
    lowHonorThreshold: 6,
    opponentLowHonorThreshold: 6,
    honorWinSetupThreshold: 19,
    opponentHonorThreatThreshold: 21,
    strongholdEmergencyBid: 5,
    forceLowAfterOpening: false,
    // Ring fate is not guaranteed, so value only a fraction and cap how much
    // future income can excuse an aggressive draw.
    ringFateConversion: 0.6,
    ringFateCap: 5,
    // Existing hand cards compete with new cards for fate, but not every card
    // in hand will be useful. Reserve only part of their printed cost.
    existingHandCostReservation: 0.35,
    averageCostFloor: 0.5,
    cheapDeckCostThreshold: 1.5,
    cheapDeckCardAllowance: 5,
    fatePressureWeight: 1,
    comfortableHandSize: 7,
    crowdedHandSize: 10,
    comfortableHandPenalty: 1,
    crowdedHandPenalty: 2,
    strongBoardThreshold: 7,
    dominantBoardThreshold: 11,
    strongBoardPenalty: 1,
    dominantBoardPenalty: 2,
    persistentCharacterWeight: 1.25,
    attachmentWeight: 0.6,
    characterFateWeight: 0.25,
    boardSkillWeight: 0.1,
    honorPlanSelfThreshold: 16,
    dishonorPlanOpponentThreshold: 9,
    predictedHighBidThreshold: 4,
    honorOpportunityPenalty: 2
};

export const DEFAULT_LEGACY_DRAW_BID_PROFILE: LegacyDrawBidProfile = {
    mode: 'generic',
    openingBid: 5,
    laterBid: 3,
    lowBid: 1,
    lowHonorThreshold: 3
};

// Reusable profile overlays. Exact deck lists may merge additional values in
// DeckProfiles; these cover broad strategic families without card-id checks in
// the decision class.
export const CARD_ENGINE_DRAW_BID_PROFILE: DrawBidProfile = {
    ...DEFAULT_DRAW_BID_PROFILE,
    objective: 'cards',
    minimumRoutineBid: 4,
    fatePressureWeight: 0.4,
    strongBoardPenalty: 0,
    dominantBoardPenalty: 1
};

export const HONOR_DRAW_BID_PROFILE: DrawBidProfile = {
    ...DEFAULT_DRAW_BID_PROFILE,
    objective: 'honor',
    honorPlanSelfThreshold: 15,
    honorOpportunityPenalty: 3
};

export const DISHONOR_DRAW_BID_PROFILE: DrawBidProfile = {
    ...DEFAULT_DRAW_BID_PROFILE,
    objective: 'dishonor',
    forceLowAfterOpening: true
};

export const TOWER_DRAW_BID_PROFILE: DrawBidProfile = {
    ...DEFAULT_DRAW_BID_PROFILE,
    objective: 'cards',
    // The tower may be established, but this deck must keep drawing Weapons,
    // reducers, and ready effects. Shave only one card at true saturation.
    minimumRoutineBid: 4,
    fatePressureWeight: 0.5,
    strongBoardThreshold: 7,
    dominantBoardThreshold: 10,
    strongBoardPenalty: 0,
    dominantBoardPenalty: 1
};

export const LION_LEGACY_DRAW_BID_PROFILE: LegacyDrawBidProfile = {
    ...DEFAULT_LEGACY_DRAW_BID_PROFILE,
    mode: 'fixed-after-opening',
    laterBid: 2,
    lowHonorThreshold: 4
};

export const DRAGON_LEGACY_DRAW_BID_PROFILE: LegacyDrawBidProfile = {
    ...DEFAULT_LEGACY_DRAW_BID_PROFILE,
    mode: 'fixed-after-opening',
    laterBid: 2,
    lowHonorThreshold: 3
};

export const DISHONOR_LEGACY_DRAW_BID_PROFILE: LegacyDrawBidProfile = {
    ...DEFAULT_LEGACY_DRAW_BID_PROFILE,
    mode: 'low-after-opening',
    laterBid: 1,
    lowHonorThreshold: 3
};

function finite(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function emptyDeductions(): DrawBidAnalysis['deductions'] {
    return { fate: 0, hand: 0, board: 0, honorOpportunity: 0 };
}

abstract class BaseDrawBidTactics {
    protected legalBids(context: DrawBidContext): number[] {
        const legal = (context.legalBids || [1, 2, 3, 4, 5])
            .map((bid) => Math.trunc(finite(bid, NaN)))
            .filter((bid) => Number.isFinite(bid))
            .sort((a, b) => a - b);
        return legal.length > 0 ? [...new Set(legal)] : [1, 2, 3, 4, 5];
    }

    protected closestLegalBid(context: DrawBidContext, desired: number): number {
        const legal = this.legalBids(context);
        return legal.slice().sort((a, b) =>
            Math.abs(a - desired) - Math.abs(b - desired) || b - a)[0];
    }

    protected fixedAnalysis(context: DrawBidContext, desired: number, reason: string): DrawBidAnalysis {
        const bid = this.closestLegalBid(context, desired);
        return {
            selectedBid: bid,
            rawBid: desired,
            reason,
            effectiveFate: Math.max(0, finite(context.myFate)),
            availableFateForNewCards: Math.max(0, finite(context.myFate)),
            estimatedUsefulDraws: bid,
            predictedOpponentBid: bid,
            deductions: emptyDeductions()
        };
    }
}

export class DrawBidTactics extends BaseDrawBidTactics {
    constructor(private readonly profile: DrawBidProfile = DEFAULT_DRAW_BID_PROFILE) {
        super();
    }

    analyze(context: DrawBidContext): DrawBidAnalysis {
        const round = Math.max(1, Math.trunc(finite(context.roundNumber, 1)));
        if(round <= 1) {
            return this.fixedAnalysis(context, this.profile.openingBid, 'opening-max-cards');
        }

        // Honor rails outrank conquest urgency. Bidding low can win immediately
        // by honor/dishonor or prevent a single dial from losing that race.
        if(context.myHonor <= this.profile.lowHonorThreshold) {
            return this.fixedAnalysis(context, this.profile.lowBid, 'protect-low-honor');
        }
        if(context.opponentHonor <= this.profile.opponentLowHonorThreshold) {
            return this.fixedAnalysis(context, this.profile.lowBid, 'pressure-opponent-dishonor');
        }
        if(context.myHonor >= this.profile.honorWinSetupThreshold) {
            return this.fixedAnalysis(context, this.profile.lowBid, 'pursue-honor-victory');
        }
        if(context.opponentHonor >= this.profile.opponentHonorThreatThreshold) {
            return this.fixedAnalysis(context, this.profile.lowBid, 'deny-opponent-honor-victory');
        }
        if(this.profile.forceLowAfterOpening) {
            return this.fixedAnalysis(context, this.profile.lowBid, 'deck-forced-low-bid');
        }

        // Open stronghold on either side: card volume is immediate survival or
        // lethal pressure. This remains below the honor win/loss rails above.
        if(context.myBrokenProvinces >= 3) {
            return this.fixedAnalysis(context, this.profile.strongholdEmergencyBid, 'defend-open-stronghold');
        }
        if(context.opponentBrokenProvinces >= 3) {
            return this.fixedAnalysis(context, this.profile.strongholdEmergencyBid, 'attack-open-stronghold');
        }

        const effectiveFate = Math.max(0, finite(context.myFate)) +
            Math.min(Math.max(0, finite(context.fateOnUnclaimedRings)), this.profile.ringFateCap) *
                this.profile.ringFateConversion;
        const handCosts = (context.handCardCosts || [])
            .map((cost) => Math.max(0, finite(cost)))
            .filter((cost) => Number.isFinite(cost));
        const existingHandDemand = handCosts.reduce((sum, cost) => sum + cost, 0);
        const availableFateForNewCards = Math.max(0,
            effectiveFate - existingHandDemand * this.profile.existingHandCostReservation);
        const averageCost = Math.max(0, finite(context.averageConflictCardCost));
        const costDenominator = Math.max(averageCost, this.profile.averageCostFloor);
        const cheapDeckRatio = clamp(
            (this.profile.cheapDeckCostThreshold - averageCost) /
                Math.max(this.profile.cheapDeckCostThreshold, 0.01),
            0,
            1
        );
        const estimatedUsefulDraws = availableFateForNewCards / costDenominator +
            cheapDeckRatio * this.profile.cheapDeckCardAllowance;
        const usefulBid = clamp(Math.ceil(estimatedUsefulDraws), 1, this.profile.baseBid);
        const fateDeduction = Math.max(0,
            Math.round((this.profile.baseBid - usefulBid) * this.profile.fatePressureWeight));

        const handCount = Math.max(0, Math.trunc(finite(context.myHandCount)));
        const handDeduction = handCount >= this.profile.crowdedHandSize
            ? this.profile.crowdedHandPenalty
            : handCount >= this.profile.comfortableHandSize
                ? this.profile.comfortableHandPenalty
                : 0;

        const board = context.board || {} as DrawBidBoardState;
        const boardScore = Math.max(0, finite(board.characterCount)) +
            Math.max(0, finite(board.persistentCharacterCount)) * this.profile.persistentCharacterWeight +
            Math.max(0, finite(board.attachmentCount)) * this.profile.attachmentWeight +
            Math.max(0, finite(board.totalCharacterFate)) * this.profile.characterFateWeight +
            Math.max(finite(board.militarySkill), finite(board.politicalSkill), 0) *
                this.profile.boardSkillWeight;
        const boardDeduction = boardScore >= this.profile.dominantBoardThreshold
            ? this.profile.dominantBoardPenalty
            : boardScore >= this.profile.strongBoardThreshold
                ? this.profile.strongBoardPenalty
                : 0;

        const predictedOpponentBid = this.predictOpponentBid(context);
        const honorPlanLive = (this.profile.objective === 'honor' &&
            context.myHonor >= this.profile.honorPlanSelfThreshold) ||
            (this.profile.objective === 'dishonor' &&
                context.opponentHonor <= this.profile.dishonorPlanOpponentThreshold);
        const honorOpportunityDeduction = honorPlanLive &&
            predictedOpponentBid >= this.profile.predictedHighBidThreshold
            ? this.profile.honorOpportunityPenalty
            : 0;

        const deductions = {
            fate: fateDeduction,
            hand: handDeduction,
            board: boardDeduction,
            honorOpportunity: honorOpportunityDeduction
        };
        const totalDeduction = Object.values(deductions).reduce((sum, value) => sum + value, 0);
        const rawBid = clamp(
            this.profile.baseBid - totalDeduction,
            this.profile.minimumRoutineBid,
            this.profile.baseBid
        );
        const reason = this.primaryReason(deductions);
        return {
            selectedBid: this.closestLegalBid(context, rawBid),
            rawBid,
            reason,
            effectiveFate,
            availableFateForNewCards,
            estimatedUsefulDraws,
            predictedOpponentBid,
            deductions
        };
    }

    private predictOpponentBid(context: DrawBidContext): number {
        if(context.opponentHonor <= this.profile.lowHonorThreshold ||
            context.opponentHonor >= this.profile.honorWinSetupThreshold) {
            return this.profile.lowBid;
        }
        if(context.opponentBrokenProvinces >= 3 || context.myBrokenProvinces >= 3) {
            return this.profile.strongholdEmergencyBid;
        }
        let bid = this.profile.baseBid;
        if(context.opponentHandCount >= this.profile.crowdedHandSize) {
            bid -= this.profile.crowdedHandPenalty;
        } else if(context.opponentHandCount >= this.profile.comfortableHandSize) {
            bid -= this.profile.comfortableHandPenalty;
        }
        if(context.opponentFate <= 1 && context.opponentHandCount >= this.profile.comfortableHandSize) {
            bid--;
        }
        if(context.opponentHandCount <= 2) {
            bid++;
        }
        return clamp(bid, this.profile.lowBid, this.profile.baseBid);
    }

    private primaryReason(deductions: DrawBidAnalysis['deductions']): string {
        const ranked = Object.entries(deductions)
            .sort((left, right) => right[1] - left[1]);
        if(ranked[0][1] <= 0) {
            return 'maximize-card-volume';
        }
        return ({
            fate: 'fate-cost-pressure',
            hand: 'hand-already-stocked',
            board: 'board-already-established',
            honorOpportunity: 'honor-race-opportunity'
        } as Record<string, string>)[ranked[0][0]];
    }
}

// Frozen copy of draw behavior that preceded DrawBidTactics. Kept only for
// benchmarks/regression comparison; live bots default to adaptive.
export class LegacyDrawBidTactics extends BaseDrawBidTactics {
    constructor(private readonly profile: LegacyDrawBidProfile = DEFAULT_LEGACY_DRAW_BID_PROFILE) {
        super();
    }

    analyze(context: DrawBidContext): DrawBidAnalysis {
        const round = Math.max(1, Math.trunc(finite(context.roundNumber, 1)));
        const isKnownOpening = context.roundNumber !== undefined && round <= 1;
        if(this.profile.mode === 'low-after-opening') {
            const bid = isKnownOpening && context.myHonor > this.profile.lowHonorThreshold
                ? this.profile.openingBid
                : this.profile.lowBid;
            return this.fixedAnalysis(context, bid, isKnownOpening ? 'legacy-opening' : 'legacy-low');
        }
        if(this.profile.mode === 'fixed-after-opening') {
            const bid = context.myHonor <= this.profile.lowHonorThreshold
                ? this.profile.lowBid
                : isKnownOpening
                    ? this.profile.openingBid
                    : this.profile.laterBid;
            return this.fixedAnalysis(context, bid, 'legacy-fixed');
        }

        let bid = context.myHonor <= 3 ? 1 : context.myHonor >= 7 ? 5 : 3;
        if(context.opponentHonor >= 18) {
            bid = 1;
        } else if(context.opponentHonor >= 14) {
            bid = Math.min(bid, 2);
        }
        while(bid > 1 && context.myHonor - (bid - 1) < 2) {
            bid--;
        }
        if(this.profile.drawBidCap !== undefined) {
            bid = Math.min(bid, this.profile.drawBidCap);
        }
        return this.fixedAnalysis(context, bid, 'legacy-generic');
    }
}
