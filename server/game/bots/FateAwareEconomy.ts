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

    // ---- first-player projection (docs/bot-conflict-rules-from-replays.md #14) ----
    // `RegroupPhase.passFirstPlayer` alternates the token unconditionally, so
    // "am I second player this round" IS "do I open the next conflict phase".
    // A cheap body bought with no fate is discarded in the fate phase, so the
    // second player's board does not survive to the round it was bought for.
    // The owner's rule: "if I am 2nd player I want to play characters with 1
    // fate on them". 0 = V1 (bodies persist only when they cost 3).
    //
    // SHIPPED AT 1 (2026-08-12) at the owner's request after seeing it measure
    // a clean NULL — +0.01pp, p=1.00 over 4896 games and 9 bases, 79 flips
    // toward it against 78 away. Three of the four cells were positive and the
    // fourth cancelled them exactly. It is shipped for live play, not because
    // the self-play field wanted it; see docs/bot-conflict-rules-from-replays.md
    // rule 14 for the full table. Revert by setting this back to 0.
    bodyAdditionalFateSecondPlayer: number;
    // The other half of the same rule: "if the stronghold is exposed I play
    // characters with 0 fate for immediate attack or defense". With a
    // stronghold already attackable the game is unlikely to reach another
    // round, so fate spent on persistence buys nothing and one more body buys
    // a conflict. Undefined = unchanged; 0 = never pay for persistence.
    bodyAdditionalFateEndgame?: number;
    // Own broken outer provinces at which the endgame override turns on. Three
    // is "my stronghold is the next target"; the opponent's exposed stronghold
    // is read separately from live province knowledge.
    endgameBrokenProvinces: number;
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
    bodyFateReserve: 0,
    // Reaches every deck: each per-deck override spreads either this object or
    // SWARM_FATE_AWARE_ECONOMY, which itself spreads this one.
    bodyAdditionalFateSecondPlayer: 1,
    endgameBrokenProvinces: 3
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
