// Per-deck tuning profiles for the heuristic bot.
//
// The policy used to branch directly on the three DeckStrategy booleans
// (aggressive / defensive / holdingEngine) with hard-coded constants scattered
// through the decision code. This module lifts those constants into a single
// DeckProfile of named knobs so a deck's playstyle is DATA, not `if` statements.
//
// `profileFromStrategy` reproduces the previous behavior EXACTLY for every deck
// (aggressive Unicorn, defensive Crab, generic everything-else) — it is a pure
// refactor with no behavior change. `resolveDeckProfile` then layers optional
// per-deck overrides on top, which is how a specific precon (e.g. Crab Defense)
// gets tuned without touching the shared code or the fine-tuned Unicorn default.
//
// IMPORTANT (user constraint): the DEFAULT / aggressive behavior is tuned for
// the Unicorn rush and must stay intact. Only add overrides for a deck that
// genuinely underperforms with the generic knobs, and gate them so no other
// deck is affected.

import type { DeckStrategy } from './CardPlaybook';

// How many attackers to commit at a conflict declaration.
//   'all'                  — commit every eligible body (rush: swarm payoffs).
//   'all-but-one'          — send all but a stay-home defender (generic).
//   'breakable-or-hold'    — attack only when the break is reachable; otherwise
//                            HOLD (pass) and keep bodies home. Pure turtle.
//   'breakable-or-pressure'— attack for the break when reachable; otherwise
//                            still commit (all but `attackKeepHome`) to apply
//                            pressure instead of conceding the whole conflict.
export type AttackCommitment = 'all' | 'all-but-one' | 'breakable-or-hold' | 'breakable-or-pressure';

// How much to spend on defense.
//   'win-only'      — defend only when the conflict can be won outright, else
//                     concede to keep bodies ready (rush).
//   'prevent-break' — defend to win when reachable, else defend just enough to
//                     stop the province breaking (generic / defensive).
export type DefenseCommitment = 'win-only' | 'prevent-break';

export interface DeckProfile {
    // ---- dynasty / economy ----
    mulliganForHoldings: boolean; // dig opening provinces toward holdings
    digWithActions: boolean; // fire dynasty Action diggers (Kyuden Hida, engineers)
    digMinBoardCharacters: number; // only dig once this many own characters are already in play
                                    // (0 = always dig; higher keeps a holding deck from starving
                                    // itself of defenders while it churns the engine)
    aggressiveFate: boolean; // pickFateButton flood-cheap-bodies mode (0-1 fate)

    // ---- offense ----
    forceMilitaryConflict: boolean; // always declare military while any military skill exists
    attackCommitment: AttackCommitment;
    attackKeepHome: number; // bodies kept home under the '*-pressure'/'all-but' modes

    // ---- defense ----
    defenseCommitment: DefenseCommitment;
    spendCardsOnDefense: boolean; // play conflict cards / fire abilities to defend
}

// Generic baseline = a deck with no strategy flags (e.g. Crane, unknown). These
// are the values the policy used for a flag-less deck before the refactor.
export const DEFAULT_PROFILE: DeckProfile = {
    mulliganForHoldings: false,
    digWithActions: false,
    digMinBoardCharacters: 0,
    aggressiveFate: false,
    forceMilitaryConflict: false,
    attackCommitment: 'all-but-one',
    attackKeepHome: 1,
    defenseCommitment: 'prevent-break',
    spendCardsOnDefense: true
};

// Exact reproduction of the old flag-driven behavior. Start from the generic
// baseline, then apply the aggressive and defensive/holding overlays the policy
// used to hard-code. Aggressive and defensive are mutually exclusive in
// practice (their marker sets do not overlap), but holdingEngine can combine
// with defensive (Crab).
export function profileFromStrategy(strategy?: DeckStrategy): DeckProfile {
    const profile: DeckProfile = { ...DEFAULT_PROFILE };
    if(!strategy) {
        return profile;
    }
    if(strategy.holdingEngine) {
        profile.mulliganForHoldings = true;
        profile.digWithActions = true;
    }
    if(strategy.defensive) {
        profile.attackCommitment = 'breakable-or-hold';
    }
    if(strategy.aggressive) {
        profile.aggressiveFate = true;
        profile.forceMilitaryConflict = true;
        profile.attackCommitment = 'all';
        profile.defenseCommitment = 'win-only';
        profile.spendCardsOnDefense = false;
    }
    return profile;
}

// A named per-deck override: when `match` is true for the bot's deck, `apply` is
// merged over the strategy-derived profile. Matched by card contents + derived
// strategy so it works in both live play and self-play (no deck-id needed).
interface ProfileOverride {
    name: string;
    match: (cardIds: Set<string>, strategy: DeckStrategy) => boolean;
    apply: Partial<DeckProfile>;
}

const OVERRIDES: ProfileOverride[] = [
    {
        // Crab "Kaiu Wall" defense precon. The strategy-derived defensive+holding
        // profile turtled itself to death: it HELD every attack it could not
        // guarantee (0 offense → no win condition) and over-churned its dynasty
        // engine (digging instead of playing bodies → thin board → provinces
        // fell anyway). Fix: keep the strong defense but (a) still attack for
        // pressure when a clean break is out of reach, keeping two wall bodies
        // home, and (b) only dig once there are already bodies on the board.
        name: 'crab-defense',
        match: (_ids, strategy) => strategy.defensive && strategy.holdingEngine,
        apply: {
            attackCommitment: 'breakable-or-pressure',
            attackKeepHome: 2,
            // Dig only once 3+ of its own characters are already in play. The
            // engine otherwise churns the dynasty deck every window (digging
            // instead of playing bodies), leaving too thin a board to defend.
            // Tuned by self-play vs the Crane precon: 10% -> ~45% win rate.
            digMinBoardCharacters: 3
        }
    }
];

export function resolveDeckProfile(cardIds: Iterable<string>, strategy?: DeckStrategy): DeckProfile {
    const profile = profileFromStrategy(strategy);
    if(!strategy) {
        return profile;
    }
    const ids = cardIds instanceof Set ? cardIds : new Set(cardIds);
    for(const override of OVERRIDES) {
        if(override.match(ids, strategy)) {
            Object.assign(profile, override.apply);
        }
    }
    return profile;
}
