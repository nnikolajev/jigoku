// Dynasty-phase spending knobs for FateAwareJigokuBotPolicy.
//
// Keep these values in the resolved deck profile so a deck can change how it
// buys characters without branching on clan/card ids inside the shared bot.
// The default reproduces the original fate-aware behavior exactly.

export type FateAwareBodyOrder = 'highest-cost' | 'lowest-cost';

export interface FateAwareEconomyProfile {
    // Let a deck tactics module choose the specific character inside the
    // spending envelope below (Lion swarm ordering, duel/attachment towers,
    // Tadaka setup). False keeps the generic cost ordering.
    preferDeckCharacters: boolean;
    // Let a deck tactics module choose the additional-fate amount, capped by
    // this economy's spend limit for the pending purchase.
    preferDeckAdditionalFate: boolean;
    // A holding/dynasty-action deck may continue past the buyer when it has no
    // more legal purchase so its dig action can execute before passing.
    deferPassForDynastyActions: boolean;
    prioritizeBodies: boolean;
    passAfterDurable: boolean;
    durableCostThreshold: number;
    durableCharacterIds?: string[];
    durableSpendCapEarly: number;
    durableSpendCapLate: number;
    durableAdditionalFateEarly: number;
    durableAdditionalFateLate: number;
    bodySpendCapEarly: number;
    bodySpendCapLate: number;
    bodySpendCapWithPersistent: number;
    persistentCharacterThreshold: number;
    bodyMaxCost: number;
    bodyAdditionalFateForCostThree: number;
    bodyOrder: FateAwareBodyOrder;
    bodyBudgetIncludesDurableSpend: boolean;
    bodyFateReserve: number;
}

export const DEFAULT_FATE_AWARE_ECONOMY: FateAwareEconomyProfile = {
    preferDeckCharacters: false,
    preferDeckAdditionalFate: false,
    deferPassForDynastyActions: false,
    prioritizeBodies: false,
    passAfterDurable: true,
    durableCostThreshold: 4,
    durableSpendCapEarly: 9,
    durableSpendCapLate: Number.POSITIVE_INFINITY,
    durableAdditionalFateEarly: 3,
    durableAdditionalFateLate: 2,
    bodySpendCapEarly: 6,
    bodySpendCapLate: 4,
    bodySpendCapWithPersistent: 3,
    persistentCharacterThreshold: 2,
    bodyMaxCost: 3,
    bodyAdditionalFateForCostThree: 1,
    bodyOrder: 'highest-cost',
    bodyBudgetIncludesDurableSpend: true,
    bodyFateReserve: 0
};

// Wide-board decks establish one durable character, then buy cheap
// replacements around it. Lion adds its explicit tower ids; Unicorn uses the
// normal printed-cost >= 4 durable definition.
export const SWARM_FATE_AWARE_ECONOMY: FateAwareEconomyProfile = {
    ...DEFAULT_FATE_AWARE_ECONOMY,
    prioritizeBodies: false,
    passAfterDurable: false,
    durableAdditionalFateEarly: 2,
    bodySpendCapEarly: 6,
    bodySpendCapLate: 5,
    bodySpendCapWithPersistent: 5,
    bodyMaxCost: 5,
    bodyAdditionalFateForCostThree: 0,
    bodyOrder: 'lowest-cost',
    bodyBudgetIncludesDurableSpend: false,
    bodyFateReserve: 1
};
