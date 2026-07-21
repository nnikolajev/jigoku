export interface ConflictDeckSafetyProfile {
    enabled: boolean;
    mandatoryDrawCards: number;
    minimumConflictDeckBuffer: number;
    forcedDrawsByOpponentCardId: Record<string, number>;
    forcedHonorLossByOpponentCardId: Record<string, number>;
    conflictDeckExhaustionHonorLoss: number;
    avoidOptionalDrawAtLethalExhaustionHonor: boolean;
}

export interface VisibleOpponentCard {
    id?: string;
    fate?: number;
}

export interface OptionalDeckConsumptionContext {
    remainingConflictCards: number;
    optionalCardsConsumed: number;
    ownHonor: number;
    phase?: string;
    visibleOpponentCards?: VisibleOpponentCard[];
}

export interface OptionalDeckConsumptionAnalysis {
    shouldConsume: boolean;
    remainingAfterConsumption: number;
    reservedFutureDraws: number;
    projectedHonorAfterPublicLosses: number;
    reason: string;
}

/**
 * Public-state conflict-deck safety shared by the modern policies. The bot
 * knows its own remaining deck and visible forced effects; hidden information
 * is not required. Optional draws/reveals are declined when they would make a
 * mandatory draw or visible effect exhaust the deck for a five-honor loss.
 *
 * Card knowledge is profile data so deck-specific profiles can extend it
 * without branching in the policy.
 */
export const DEFAULT_CONFLICT_DECK_SAFETY: ConflictDeckSafetyProfile = {
    enabled: true,
    mandatoryDrawCards: 1,
    minimumConflictDeckBuffer: 0,
    forcedDrawsByOpponentCardId: {
        'bayushi-shoju-2': 2
    },
    forcedHonorLossByOpponentCardId: {
        'bayushi-shoju-2': 1
    },
    conflictDeckExhaustionHonorLoss: 5,
    avoidOptionalDrawAtLethalExhaustionHonor: true
};

export class ConflictDeckSafetyTactics {
    constructor(readonly profile: ConflictDeckSafetyProfile = DEFAULT_CONFLICT_DECK_SAFETY) {}

    analyzeOptionalConsumption(context: OptionalDeckConsumptionContext): OptionalDeckConsumptionAnalysis {
        const remaining = Math.max(0, Number(context.remainingConflictCards) || 0);
        const optionalConsumption = Math.max(0, Number(context.optionalCardsConsumed) || 0);
        const phase = String(context.phase || '').toLowerCase();
        const seen = new Set<string>();
        let forcedDraws = 0;
        let forcedHonorLoss = 0;

        for(const card of context.visibleOpponentCards || []) {
            const id = String(card?.id || '');
            if(!id || seen.has(id)) {
                continue;
            }
            // During the current draw phase the visible character will reach
            // the conflict phase. From conflict/fate onward it needs 2+ fate
            // to survive fate removal and force the same draw next round.
            const persistsToNextConflict = phase === 'draw' || (Number(card?.fate) || 0) >= 2;
            if(!persistsToNextConflict) {
                continue;
            }
            seen.add(id);
            forcedDraws += Math.max(0, Number(this.profile.forcedDrawsByOpponentCardId[id]) || 0);
            forcedHonorLoss += Math.max(0, Number(this.profile.forcedHonorLossByOpponentCardId[id]) || 0);
        }

        const reservedFutureDraws = Math.max(0, this.profile.mandatoryDrawCards) +
            forcedDraws + Math.max(0, this.profile.minimumConflictDeckBuffer);
        const remainingAfterConsumption = remaining - optionalConsumption;
        const projectedHonorAfterPublicLosses = (Number(context.ownHonor) || 0) - forcedHonorLoss;
        const wouldForceExhaustion = remainingAfterConsumption < reservedFutureDraws;
        const exhaustionWouldLose = projectedHonorAfterPublicLosses <=
            Math.max(0, this.profile.conflictDeckExhaustionHonorLoss);

        if(!this.profile.enabled || optionalConsumption === 0) {
            return {
                shouldConsume: true,
                remainingAfterConsumption,
                reservedFutureDraws,
                projectedHonorAfterPublicLosses,
                reason: 'conflict-deck-safety-disabled-or-empty'
            };
        }
        if(wouldForceExhaustion) {
            return {
                shouldConsume: false,
                remainingAfterConsumption,
                reservedFutureDraws,
                projectedHonorAfterPublicLosses,
                reason: exhaustionWouldLose
                    ? 'conflict-deck-safety-skip-lethal-exhaustion'
                    : 'conflict-deck-safety-skip-optional-exhaustion'
            };
        }
        // A visible effect that will put us at or below the five-honor deck
        // penalty makes any later reshuffle lethal. Stop accelerating our deck
        // even when the currently scheduled draws fit: public mill, Earth
        // effects, and later turns can consume the remaining margin.
        if(this.profile.avoidOptionalDrawAtLethalExhaustionHonor && forcedHonorLoss > 0 &&
            exhaustionWouldLose) {
            return {
                shouldConsume: false,
                remainingAfterConsumption,
                reservedFutureDraws,
                projectedHonorAfterPublicLosses,
                reason: 'conflict-deck-safety-skip-under-lethal-honor-pressure'
            };
        }
        return {
            shouldConsume: true,
            remainingAfterConsumption,
            reservedFutureDraws,
            projectedHonorAfterPublicLosses,
            reason: 'conflict-deck-safety-safe-consumption'
        };
    }

    shouldConsumeOptionalCards(context: OptionalDeckConsumptionContext): boolean {
        return this.analyzeOptionalConsumption(context).shouldConsume;
    }
}

export default ConflictDeckSafetyTactics;
