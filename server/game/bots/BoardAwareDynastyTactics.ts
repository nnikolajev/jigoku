// Seed-4 dynasty planner. Seed 1's FateAwareEconomy remains unchanged; this
// module adds board/game-state analysis and returns one purchase at a time.
// All values live in DeckProfiles so archetypes can tune behavior without
// branching on clan or card ids here.

export interface BoardAwareDynastyProfile {
    enabled: boolean;
    persistenceDecoratorEnabled: boolean;
    primarySkillWeight: number;
    secondarySkillWeight: number;
    fatePersistencePower: number;
    attachmentPower: number;
    abilityValueWeight: number;
    honoredGloryWeight: number;
    preferredCharacterBonus: number;
    efficiencyWeight: number;
    absolutePowerWeight: number;
    durableCostThreshold: number;
    durablePriorityBonus: number;
    boardMatchRatio: number;
    boardPowerTolerance: number;
    severeBoardDeficitRatio: number;
    severeBoardDeficitMinimumPower: number;
    secondPlayerDeficitPlanner: boolean;
    minimumCharactersByRound: number[];
    secondPlayerExtraCharacters: number;
    firstPlayerTowerCost: number;
    firstPlayerPassPowerRatio: number;
    firstPlayerPassAfterTower: boolean;
    openingSpendCap: number;
    midgameSpendCap: number;
    lateSpendCap: number;
    secondPlayerSpendBonus: number;
    boardDeficitSpendRate: number;
    twoBrokenUrgency: number;
    threeBrokenUrgency: number;
    fullPlannerAtUrgent: boolean;
    honorRaceUrgency: number;
    lowHonorThreshold: number;
    highHonorThreshold: number;
    urgentReserveMultiplier: number;
    maxConflictReserve: number;
    conflictReservePriority: number;
    conflictReserveCards: number;
    lowHandSize: number;
    highHandSize: number;
    highHandReserveBonus: number;
    strongTwoCostValue: number;
    honoredCheapAdditionalFate: number;
    twoCostAdditionalFate: number;
    midCostAdditionalFate: number;
    towerAdditionalFateEarly: number;
    towerAdditionalFateMid: number;
    towerAdditionalFateLate: number;
    urgentCheapAdditionalFate: number;
    urgentTowerAdditionalFate: number;
    rush: boolean;
    rushThreeFourCostAdditionalFate: number;
    playConflictCharactersAtHome: boolean;
    conflictCharacterSafetyMargin: number;
    conflictCharacterMustBreak: boolean;
    conflictCharacterBreakBonus: number;
    characterValueById: Record<string, number>;
}

export const DEFAULT_BOARD_AWARE_DYNASTY: BoardAwareDynastyProfile = {
    enabled: true,
    persistenceDecoratorEnabled: true,
    primarySkillWeight: 1,
    secondarySkillWeight: 0.35,
    fatePersistencePower: 1.25,
    attachmentPower: 1,
    abilityValueWeight: 0.75,
    honoredGloryWeight: 0.8,
    // Deck playbooks are an injected expert recommendation. Make them win
    // normal efficiency ties while the common affordability/reserve gate still
    // prevents an unsafe purchase.
    preferredCharacterBonus: 12,
    efficiencyWeight: 1.5,
    absolutePowerWeight: 1.25,
    durableCostThreshold: 4,
    durablePriorityBonus: 6,
    boardMatchRatio: 0.82,
    boardPowerTolerance: 2,
    severeBoardDeficitRatio: 0.3,
    severeBoardDeficitMinimumPower: 8,
    secondPlayerDeficitPlanner: true,
    minimumCharactersByRound: [1, 2, 3, 3, 3, 3],
    secondPlayerExtraCharacters: 1,
    firstPlayerTowerCost: 4,
    firstPlayerPassPowerRatio: 0.9,
    firstPlayerPassAfterTower: true,
    openingSpendCap: 7,
    midgameSpendCap: 6,
    lateSpendCap: 5,
    secondPlayerSpendBonus: 2,
    boardDeficitSpendRate: 0.4,
    twoBrokenUrgency: 0.22,
    threeBrokenUrgency: 1,
    fullPlannerAtUrgent: true,
    honorRaceUrgency: 0.6,
    lowHonorThreshold: 4,
    highHonorThreshold: 22,
    urgentReserveMultiplier: 0.2,
    maxConflictReserve: 4,
    conflictReservePriority: 7,
    conflictReserveCards: 2,
    lowHandSize: 2,
    highHandSize: 6,
    highHandReserveBonus: 1,
    strongTwoCostValue: 3.25,
    honoredCheapAdditionalFate: 1,
    twoCostAdditionalFate: 1,
    midCostAdditionalFate: 1,
    towerAdditionalFateEarly: 2,
    towerAdditionalFateMid: 2,
    towerAdditionalFateLate: 1,
    urgentCheapAdditionalFate: 0,
    urgentTowerAdditionalFate: 1,
    rush: false,
    rushThreeFourCostAdditionalFate: 1,
    playConflictCharactersAtHome: true,
    conflictCharacterSafetyMargin: 1,
    conflictCharacterMustBreak: true,
    conflictCharacterBreakBonus: 3,
    characterValueById: {}
};

export const RUSH_BOARD_AWARE_DYNASTY: BoardAwareDynastyProfile = {
    ...DEFAULT_BOARD_AWARE_DYNASTY,
    minimumCharactersByRound: [2, 3, 4, 4, 4, 4],
    secondPlayerExtraCharacters: 1,
    openingSpendCap: 8,
    midgameSpendCap: 7,
    lateSpendCap: 7,
    secondPlayerSpendBonus: 1,
    boardMatchRatio: 1,
    firstPlayerPassAfterTower: false,
    maxConflictReserve: 2,
    conflictReserveCards: 1,
    twoCostAdditionalFate: 0,
    secondPlayerDeficitPlanner: false,
    rush: true,
    characterValueById: {}
};

export interface DynastyCharacterInfo {
    cost: number;
    military: number;
    political: number;
    glory: number;
    abilityValue: number;
    honoredOnEntry: boolean;
}

export interface DynastyHandCard {
    cost: number;
    priority: number;
    playable: boolean;
    type?: string;
}

export interface BoardAwareDynastyContext<T = any> {
    cards: T[];
    infoByUuid: Record<string, DynastyCharacterInfo>;
    ownBoard: any[];
    opponentBoard: any[];
    fate: number;
    startFate: number;
    spent: number;
    boughtCount: number;
    boughtDurable: boolean;
    roundNumber: number;
    firstPlayer: boolean;
    ownBrokenProvinces: number;
    opponentBrokenProvinces: number;
    ownHonor: number;
    opponentHonor: number;
    hand: DynastyHandCard[];
    dynamicFateReserve: number;
    preferredUuid?: string;
}

export interface BoardAwareDynastyAnalysis {
    ownPower: number;
    opponentPower: number;
    targetPower: number;
    targetCharacters: number;
    urgency: number;
    conflictReserve: number;
    spendCap: number;
    needsBody: boolean;
    needsPower: boolean;
    stage: 'develop' | 'midgame' | 'late' | 'urgent';
}

export interface BoardAwareDynastyDecision<T = any> {
    card?: T;
    additionalFate: number;
    durable: boolean;
    pass: boolean;
    reason: string;
    analysis: BoardAwareDynastyAnalysis;
}

const number = (value: any): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const liveSkill = (card: any, axis: 'military' | 'political'): number => {
    const value = number(card?.[`${axis}SkillSummary`]?.stat ?? card?.[axis]);
    return Math.max(0, value);
};

export class BoardAwareDynastyTactics {
    constructor(readonly profile: BoardAwareDynastyProfile = DEFAULT_BOARD_AWARE_DYNASTY) {}

    characterPower(card: any): number {
        const military = liveSkill(card, 'military');
        const political = liveSkill(card, 'political');
        return Math.max(military, political) * this.profile.primarySkillWeight +
            Math.min(military, political) * this.profile.secondarySkillWeight +
            number(card?.fate) * this.profile.fatePersistencePower +
            (card?.attachments || []).length * this.profile.attachmentPower;
    }

    boardPower(cards: any[]): number {
        return (cards || []).filter((card) => card?.type === 'character')
            .reduce((sum, card) => sum + this.characterPower(card), 0);
    }

    candidatePower(card: any, info: DynastyCharacterInfo, preferred = false): number {
        const primary = Math.max(info.military, info.political);
        const secondary = Math.min(info.military, info.political);
        const honored = info.honoredOnEntry ? info.glory * this.profile.honoredGloryWeight : 0;
        return primary * this.profile.primarySkillWeight +
            secondary * this.profile.secondarySkillWeight +
            info.abilityValue * this.profile.abilityValueWeight + honored +
            (preferred ? this.profile.preferredCharacterBonus : 0) +
            (this.profile.characterValueById[card?.id] || 0);
    }

    analyze(context: BoardAwareDynastyContext): BoardAwareDynastyAnalysis {
        const ownPower = this.boardPower(context.ownBoard);
        const opponentPower = this.boardPower(context.opponentBoard);
        const ownBroken = Math.max(0, context.ownBrokenProvinces);
        const opponentBroken = Math.max(0, context.opponentBrokenProvinces);
        const provinceUrgency = Math.max(
            ownBroken >= 3 || opponentBroken >= 3 ? this.profile.threeBrokenUrgency : 0,
            ownBroken >= 2 || opponentBroken >= 2 ? this.profile.twoBrokenUrgency : 0
        );
        const honorUrgency = context.ownHonor <= this.profile.lowHonorThreshold ||
            context.opponentHonor <= this.profile.lowHonorThreshold ||
            context.ownHonor >= this.profile.highHonorThreshold ||
            context.opponentHonor >= this.profile.highHonorThreshold
            ? this.profile.honorRaceUrgency
            : 0;
        const urgency = Math.max(0, Math.min(1, provinceUrgency), Math.min(1, honorUrgency));
        const roundIndex = Math.max(0, Math.min(
            this.profile.minimumCharactersByRound.length - 1,
            Math.max(1, context.roundNumber) - 1
        ));
        let targetCharacters = this.profile.minimumCharactersByRound[roundIndex] || 1;
        if(!context.firstPlayer && context.roundNumber <= 3) {
            targetCharacters += this.profile.secondPlayerExtraCharacters;
        }
        if(urgency >= this.profile.threeBrokenUrgency) {
            const ownCharacters = (context.ownBoard || []).filter((card) => card?.type === 'character').length;
            targetCharacters = Math.max(targetCharacters, ownCharacters + context.cards.length);
        }
        const targetPower = Math.max(
            targetCharacters * 2.25,
            opponentPower * this.profile.boardMatchRatio
        );
        const importantCosts = context.hand
            .filter((card) => card.playable && card.cost > 0 && card.priority >= this.profile.conflictReservePriority)
            .sort((left, right) => right.priority - left.priority || right.cost - left.cost)
            .slice(0, this.profile.conflictReserveCards)
            .map((card) => card.cost);
        let conflictReserve = Math.min(
            this.profile.maxConflictReserve,
            importantCosts.reduce((sum, cost) => sum + cost, 0)
        );
        if(context.hand.length <= this.profile.lowHandSize) {
            conflictReserve = Math.min(conflictReserve, 1);
        } else if(context.hand.length >= this.profile.highHandSize && importantCosts.length > 0) {
            conflictReserve = Math.min(this.profile.maxConflictReserve,
                conflictReserve + this.profile.highHandReserveBonus);
        }
        conflictReserve = Math.max(conflictReserve, context.dynamicFateReserve);
        if(urgency >= this.profile.threeBrokenUrgency) {
            conflictReserve = Math.max(
                context.dynamicFateReserve > 1 ? 1 : 0,
                Math.floor(conflictReserve * this.profile.urgentReserveMultiplier)
            );
        }
        const stage: BoardAwareDynastyAnalysis['stage'] = urgency >= this.profile.threeBrokenUrgency
            ? 'urgent'
            : context.roundNumber <= 2
                ? 'develop'
                : context.roundNumber >= 5
                    ? 'late'
                    : 'midgame';
        const baseSpendCap = stage === 'develop'
            ? this.profile.openingSpendCap
            : stage === 'late'
                ? this.profile.lateSpendCap
                : this.profile.midgameSpendCap;
        const deficit = Math.max(0, targetPower - ownPower);
        let spendCap = baseSpendCap + Math.ceil(deficit * this.profile.boardDeficitSpendRate);
        if(!context.firstPlayer && context.roundNumber <= 3) {
            spendCap += this.profile.secondPlayerSpendBonus;
        }
        if(provinceUrgency >= this.profile.threeBrokenUrgency) {
            spendCap = context.startFate;
        } else if(provinceUrgency > 0) {
            spendCap += 1;
        }
        spendCap = Math.max(0, Math.min(context.startFate - conflictReserve, spendCap));
        const ownCharacters = (context.ownBoard || []).filter((card) => card?.type === 'character').length;
        return {
            ownPower,
            opponentPower,
            targetPower,
            targetCharacters,
            urgency,
            conflictReserve,
            spendCap,
            needsBody: ownCharacters < targetCharacters,
            needsPower: ownPower + this.profile.boardPowerTolerance < targetPower,
            stage
        };
    }

    desiredAdditionalFate(card: any, info: DynastyCharacterInfo,
        analysis: BoardAwareDynastyAnalysis): number {
        const cost = info.cost;
        if(analysis.stage === 'urgent') {
            return cost >= this.profile.firstPlayerTowerCost
                ? this.profile.urgentTowerAdditionalFate
                : this.profile.urgentCheapAdditionalFate;
        }
        if(info.honoredOnEntry && cost <= 2) {
            return this.profile.honoredCheapAdditionalFate;
        }
        if(cost <= 1) {
            return 0;
        }
        const value = this.candidatePower(card, info, false);
        if(cost === 2) {
            return value >= this.profile.strongTwoCostValue
                ? this.profile.twoCostAdditionalFate
                : 0;
        }
        if(this.profile.rush && cost <= 4) {
            return cost >= 4 || !analysis.needsBody
                ? this.profile.rushThreeFourCostAdditionalFate
                : 0;
        }
        if(cost <= 4) {
            return this.profile.midCostAdditionalFate;
        }
        return analysis.stage === 'develop'
            ? this.profile.towerAdditionalFateEarly
            : analysis.stage === 'midgame'
                ? this.profile.towerAdditionalFateMid
                : this.profile.towerAdditionalFateLate;
    }

    choose<T extends { uuid?: string; id?: string }>(context: BoardAwareDynastyContext<T>): BoardAwareDynastyDecision<T> {
        const analysis = this.analyze(context);
        const pass = (reason: string): BoardAwareDynastyDecision<T> => ({
            additionalFate: 0,
            durable: false,
            pass: true,
            reason,
            analysis
        });
        if(!this.profile.enabled || context.cards.length === 0) {
            return pass('board-aware-no-character');
        }
        const hasEnoughPower = analysis.ownPower >=
            analysis.targetPower * this.profile.firstPlayerPassPowerRatio;
        if(context.firstPlayer && context.boughtCount > 0 &&
            this.profile.firstPlayerPassAfterTower && analysis.urgency < this.profile.threeBrokenUrgency &&
            (context.boughtDurable || hasEnoughPower) && !analysis.needsBody) {
            return pass('board-aware-first-player-pass');
        }
        if(context.boughtCount > 0 && !analysis.needsBody && !analysis.needsPower &&
            analysis.urgency < this.profile.threeBrokenUrgency) {
            return pass('board-aware-board-matched');
        }

        const remainingBudget = Math.max(0, analysis.spendCap - context.spent);
        const available = Math.max(0, context.fate - analysis.conflictReserve);
        const ranked = context.cards.map((card) => {
            const info = context.infoByUuid[String(card.uuid)];
            if(!info) {
                return null;
            }
            let additionalFate = this.desiredAdditionalFate(card, info, analysis);
            const maximumAdditional = Math.max(0, Math.min(
                context.fate - analysis.conflictReserve - info.cost,
                remainingBudget - info.cost
            ));
            additionalFate = Math.max(0, Math.min(additionalFate, maximumAdditional));
            const totalCost = info.cost + additionalFate;
            if(info.cost > available || info.cost > remainingBudget || totalCost > available || totalCost > remainingBudget) {
                return null;
            }
            const preferred = card.uuid === context.preferredUuid;
            const power = this.candidatePower(card, info, preferred);
            const immediateWeight = analysis.needsPower || analysis.urgency >= this.profile.threeBrokenUrgency
                ? this.profile.absolutePowerWeight * 1.75
                : this.profile.absolutePowerWeight;
            const bodyWeight = analysis.needsBody ? 1.5 : 1;
            const score = power * immediateWeight +
                power / Math.max(1, info.cost) * this.profile.efficiencyWeight * bodyWeight +
                additionalFate * this.profile.fatePersistencePower +
                (info.cost >= this.profile.durableCostThreshold
                    ? this.profile.durablePriorityBonus
                    : 0);
            return { card, info, additionalFate, score, power };
        }).filter(Boolean) as Array<{
            card: T;
            info: DynastyCharacterInfo;
            additionalFate: number;
            score: number;
            power: number;
        }>;
        ranked.sort((left, right) => right.score - left.score ||
            right.power - left.power || right.info.cost - left.info.cost ||
            String(left.card.uuid).localeCompare(String(right.card.uuid)));
        const selected = ranked[0];
        if(!selected) {
            return pass('board-aware-preserve-fate');
        }
        return {
            card: selected.card,
            additionalFate: selected.additionalFate,
            durable: selected.info.cost >= this.profile.firstPlayerTowerCost,
            pass: false,
            reason: analysis.stage === 'urgent'
                ? 'board-aware-all-in-character'
                : analysis.needsPower
                    ? 'board-aware-match-power'
                    : analysis.needsBody
                        ? 'board-aware-build-board'
                        : 'board-aware-efficient-character',
            analysis
        };
    }
}

export default BoardAwareDynastyTactics;
