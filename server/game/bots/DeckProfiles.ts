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
import { DISHONOR_DEFAULTS } from './DishonorTactics.js';
import type { DishonorProfile } from './DishonorTactics';
import { LION_DEFAULTS } from './LionTactics.js';
import type { LionProfile } from './LionTactics';
import { DEFAULT_FATE_AWARE_ECONOMY, SWARM_FATE_AWARE_ECONOMY } from './FateAwareEconomy.js';
import type { FateAwareEconomyProfile } from './FateAwareEconomy';
import { DEFAULT_CONFLICT_CARD_ECONOMY, SWARM_CONFLICT_CARD_ECONOMY } from './ConflictCardEconomy.js';
import type { ConflictCardEconomyProfile } from './ConflictCardEconomy';
import { GLORY_DEFAULTS } from './GloryTactics.js';
import type { GloryProfile } from './GloryTactics';
import { DRAGON_DEFAULTS } from './DragonTactics.js';
import type { DragonProfile } from './DragonTactics';
import { DUEL_DEFAULTS } from './DuelTactics.js';
import type { DuelProfile } from './DuelTactics';
import { SHUGENJA_DEFAULTS } from './ShugenjaTactics.js';
import type { ShugenjaProfile } from './ShugenjaTactics';
import { DRAGON_ATTACHMENT_DEFAULTS } from './DragonAttachmentTactics.js';
import type { DragonAttachmentProfile } from './DragonAttachmentTactics';
import { STRONGHOLD_DEFENSE_DEFAULTS } from './StrongholdDefenseTactics.js';
import type { StrongholdDefenseProfile } from './StrongholdDefenseTactics';
import { ATTACHMENT_CONTROL_DEFAULTS } from './AttachmentControlTactics.js';
import type { AttachmentControlProfile } from './AttachmentControlTactics';
import { CRANE_BASELINE_DEFAULTS } from './CraneBaselineTactics.js';
import type { CraneBaselineProfile } from './CraneBaselineTactics';

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
    fateAwareEconomy: FateAwareEconomyProfile; // injectable dynasty spending policy used by seeds 1 and 5
    conflictCardEconomy: ConflictCardEconomyProfile; // shared injectable conflict-card value/fate planner for seeds 1, 2, and 5
    strongholdDefense: StrongholdDefenseProfile; // shared injectable last-province reserve planner for every seed
    attachmentControl: AttachmentControlProfile; // shared Let Go / attachment-removal value policy
    mulliganForHoldings: boolean; // dig opening provinces toward holdings
    digWithActions: boolean; // fire dynasty Action diggers (Kyuden Hida, engineers)
    digMinBoardCharacters: number; // only dig once this many own characters are already in play
                                    // (0 = always dig; higher keeps a holding deck from starving
                                    // itself of defenders while it churns the engine)
    aggressiveFate: boolean; // pickFateButton flood-cheap-bodies mode (0-1 fate)
    drawBidCap?: number; // cap the draw-phase honor bid. The higher bidder PAYS
                         // the difference in honor to the lower bidder, so a
                         // grind deck facing an honor-climbing opponent (Crab vs
                         // Crane) bleeds itself toward the dishonor loss AND fuels
                         // the opponent's honor win by bidding high for cards.
                         // Cap it low to protect honor over card volume. Unset =
                         // the generic honor-scaled bid.

    // ---- offense ----
    forceMilitaryConflict: boolean; // always declare military while any military skill exists
    attackCommitment: AttackCommitment;
    attackKeepHome: number; // bodies kept home under the '*-pressure'/'all-but' modes
    reserveDynastyFate: boolean; // keep 1 fate through the dynasty phase for
                                 // conflict-phase hand cards. Good for most
                                 // decks; a pure body-flood rush wants every
                                 // fate on the board instead, so it opts out.

    // ---- defense ----
    defenseCommitment: DefenseCommitment;
    spendCardsOnDefense: boolean; // play conflict cards / fire abilities to defend
    // Before this many outer provinces are broken, use win-only defense even
    // when defenseCommitment is prevent-break. Zero enables prevent-break from
    // round one. Lets province-trading decks protect the third break without
    // bowing their whole attack engine early.
    preventBreakAfterBrokenProvinces: number;
    chumpBlock: boolean; // when a defense is hopeless, still declare ONE cheap
                         // defender instead of conceding: an unopposed loss
                         // costs 1 honor, and honor attrition is how slow
                         // decks lose the long game
    defenseSkillBuffer: number; // extra skill committed past the minimal
                                // prevent-break target — a buffer against the
                                // opponent's post-commit pump cards

    // ---- setup ----
    // Printed id of the province to place under the stronghold. The stronghold
    // province is only attackable after 3 others are broken, so an on-reveal
    // punisher there (Night Raid) blunts the opponent's final all-in push.
    // Unset = keep the generic placement (bot picks arbitrarily).
    strongholdProvinceId?: string;

    // ---- dishonor / mill playstyle (Scorpion Poison Mill) ----
    // Present only for decks whose strategy derives `dishonor`; every policy
    // branch that reads it is gated on its presence, so all other decks keep
    // the unchanged generic behavior. Knobs live in DishonorTactics.
    dishonor?: DishonorProfile;

    // ---- bushi-swarm playstyle (Lion precon) ----
    // Present only via the lion-bushi-swarm override; every policy branch
    // that reads it is gated on its presence. Knobs live in LionTactics.
    lion?: LionProfile;

    // ---- glory/honor playstyle (Phoenix For Honor and Glory) ----
    // Present only for decks whose strategy derives `glory`; every policy
    // branch that reads it is gated on its presence. Knobs in GloryTactics.
    glory?: GloryProfile;

    // ---- monk/card-engine playstyle (Dragon Togashi Mitsu) ----
    // Present only for decks whose strategy derives `monk`; every policy
    // branch that reads it is gated on its presence. Knobs in DragonTactics.
    dragon?: DragonProfile;

    // ---- duel-centric playstyle (Crane Duels / Crane Baseline) ----
    // Present only for decks whose strategy derives `duelist`, currently
    // keyed on Tsuma. Knobs live in DuelTactics.
    duelist?: DuelProfile;

    // ---- mixed Crane baseline ----
    // Adds public deck-list-aware Gossip naming and the solo/honor sequencing
    // unique to the new baseline without duplicating the shared duel policy.
    craneBaseline?: CraneBaselineProfile;

    // ---- spell/ring-control playstyle (Phoenix Shugenja Spells) ----
    // Present only for Kyuden Isawa decks. It steers ring manipulation,
    // Display-of-Power province trades, spell recursion, and practical-tower
    // targets without changing the older Phoenix glory deck.
    shugenja?: ShugenjaProfile;

    // ---- Dragon attachment-tower playstyle (Iron Mountain Castle) ----
    // Deep-fate tower buying, a three-slot Restricted cap, attachment search,
    // and Niten Master / Togashi Yokuni ability steering.
    attachmentTower?: DragonAttachmentProfile;
}

// Generic baseline = a deck with no strategy flags (e.g. Crane, unknown). These
// are the values the policy used for a flag-less deck before the refactor.
export const DEFAULT_PROFILE: DeckProfile = {
    fateAwareEconomy: { ...DEFAULT_FATE_AWARE_ECONOMY },
    conflictCardEconomy: { ...DEFAULT_CONFLICT_CARD_ECONOMY },
    strongholdDefense: { ...STRONGHOLD_DEFENSE_DEFAULTS },
    attachmentControl: {
        ...ATTACHMENT_CONTROL_DEFAULTS,
        ownDebuffScores: { ...ATTACHMENT_CONTROL_DEFAULTS.ownDebuffScores },
        enemyAttachmentScores: { ...ATTACHMENT_CONTROL_DEFAULTS.enemyAttachmentScores }
    },
    mulliganForHoldings: false,
    digWithActions: false,
    digMinBoardCharacters: 0,
    aggressiveFate: false,
    forceMilitaryConflict: false,
    attackCommitment: 'all-but-one',
    attackKeepHome: 1,
    reserveDynastyFate: true,
    defenseCommitment: 'prevent-break',
    spendCardsOnDefense: true,
    preventBreakAfterBrokenProvinces: 0,
    chumpBlock: false,
    defenseSkillBuffer: 0
};

// Exact reproduction of the old flag-driven behavior. Start from the generic
// baseline, then apply the aggressive and defensive/holding overlays the policy
// used to hard-code. Aggressive and defensive are mutually exclusive in
// practice (their marker sets do not overlap), but holdingEngine can combine
// with defensive (Crab).
export function profileFromStrategy(strategy?: DeckStrategy): DeckProfile {
    const profile: DeckProfile = {
        ...DEFAULT_PROFILE,
        fateAwareEconomy: { ...DEFAULT_PROFILE.fateAwareEconomy },
        conflictCardEconomy: { ...DEFAULT_PROFILE.conflictCardEconomy },
        strongholdDefense: { ...DEFAULT_PROFILE.strongholdDefense },
        attachmentControl: {
            ...DEFAULT_PROFILE.attachmentControl,
            ownDebuffScores: { ...DEFAULT_PROFILE.attachmentControl.ownDebuffScores },
            enemyAttachmentScores: { ...DEFAULT_PROFILE.attachmentControl.enemyAttachmentScores }
        }
    };
    if(!strategy) {
        return profile;
    }
    if(strategy.holdingEngine) {
        profile.mulliganForHoldings = true;
        profile.digWithActions = true;
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            deferPassForDynastyActions: true
        };
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
    if(strategy.glory) {
        // Glory deck: the generic balanced attack/defense knobs stay — the
        // deck is mid/late-game and picks its spots; the playstyle lives in
        // the GloryTactics knobs (ring preference by board, glory pumps,
        // duel bids).
        profile.glory = { ...GLORY_DEFAULTS };
    }
    if(strategy.monk) {
        // Monk/card-engine deck: generic balanced attack/defense knobs stay;
        // the playstyle (play many cards, void recursion, Mitsu steering)
        // lives in the DragonTactics knobs.
        profile.dragon = { ...DRAGON_DEFAULTS };
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckAdditionalFate: true,
            durableAdditionalFateEarly: 3,
            durableAdditionalFateLate: 2
        };
    }
    if(strategy.duelist) {
        // Duel deck: few durable bodies, balanced generic attack/defense;
        // the playstyle (duel bids, duel target axes, attachment stacking)
        // lives in the DuelTactics knobs.
        profile.duelist = {
            ...DUEL_DEFAULTS,
            duelAxes: { ...DUEL_DEFAULTS.duelAxes },
            duelStartRules: Object.fromEntries(Object.entries(DUEL_DEFAULTS.duelStartRules)
                .map(([id, rule]) => [id, { ...rule }])),
            duelSkillBonuses: {
                characters: Object.fromEntries(Object.entries(DUEL_DEFAULTS.duelSkillBonuses.characters)
                    .map(([id, bonuses]) => [id, { ...bonuses }])),
                attachments: Object.fromEntries(Object.entries(DUEL_DEFAULTS.duelSkillBonuses.attachments)
                    .map(([id, bonuses]) => [id, { ...bonuses }]))
            },
            keyCharacters: [...DUEL_DEFAULTS.keyCharacters],
            durableCharacters: [...DUEL_DEFAULTS.durableCharacters],
            towerAttachments: [...DUEL_DEFAULTS.towerAttachments],
            restrictedAttachments: [...DUEL_DEFAULTS.restrictedAttachments]
        };
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true,
            durableCostThreshold: 0,
            durableCharacterIds: [...DUEL_DEFAULTS.durableCharacters],
            // Continue buying cheap support after establishing a tower; the
            // DuelTactics support cap stops once the board is complete.
            passAfterDurable: false,
            durableSpendCapEarly: Number.POSITIVE_INFINITY,
            durableSpendCapLate: Number.POSITIVE_INFINITY,
            durableAdditionalFateEarly: 3,
            durableAdditionalFateLate: 2,
            bodySpendCapLate: 6,
            bodySpendCapWithPersistent: 5,
            bodyMaxCost: 5,
            bodyAdditionalFateForCostThree: 0
        };
    }
    if(strategy.shugenja) {
        profile.shugenja = { ...SHUGENJA_DEFAULTS };
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true
        };
    }
    if(strategy.attachmentTower) {
        profile.attachmentTower = {
            ...DRAGON_ATTACHMENT_DEFAULTS,
            stackableAttachments: [...DRAGON_ATTACHMENT_DEFAULTS.stackableAttachments]
        };
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true,
            durableCostThreshold: 0,
            durableCharacterIds: [...DRAGON_ATTACHMENT_DEFAULTS.towerCharacters],
            durableSpendCapEarly: Number.POSITIVE_INFINITY,
            durableSpendCapLate: Number.POSITIVE_INFINITY,
            durableAdditionalFateEarly: DRAGON_ATTACHMENT_DEFAULTS.towerFateMax,
            durableAdditionalFateLate: DRAGON_ATTACHMENT_DEFAULTS.towerFateMax,
            bodyAdditionalFateForCostThree: 0
        };
    }
    if(strategy.dishonor) {
        // Dishonor/mill deck: generic attack/defense knobs stay — measured:
        // keeping bodies home ('breakable-or-pressure' + attackKeepHome 2)
        // DROPPED the win rate vs Crane from ~67% to 60%; the honor engine
        // feeds on won conflicts (Licensed Quarter mill, unopposed drains),
        // so full pressure beats turtling. The playstyle difference lives in
        // the DishonorTactics knobs (low bids, air ring, honor band).
        profile.dishonor = {
            ...DISHONOR_DEFAULTS,
            importantCharacterIds: [...DISHONOR_DEFAULTS.importantCharacterIds]
        };
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true
        };
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
        // Dragon Arsenal (EmeraldDB 46aaa220): the political +5 province is
        // the hardest final target; the rest of the playstyle is data-gated
        // by Iron Mountain Castle in DragonAttachmentTactics.
        name: 'dragon-attachments-ancestral-lands',
        match: (ids, strategy) => strategy.attachmentTower && ids.has('ancestral-lands'),
        apply: {
            strongholdProvinceId: 'ancestral-lands',
            reserveDynastyFate: true,
            attackCommitment: 'all-but-one',
            attackKeepHome: 1,
            chumpBlock: true,
            defenseSkillBuffer: 2
        }
    },
    {
        // Phoenix Shugenja Spells (EmeraldDB b260d778): keep Offerings to the
        // Kami in an outer province so its free ring accelerates the Water/
        // Void plan early. Vassal Fields is persistent value on the final
        // province and drains the attacker during the game-deciding conflict.
        name: 'phoenix-shugenja-vassal-fields',
        match: (ids, strategy) => strategy.shugenja && ids.has('vassal-fields'),
        apply: {
            strongholdProvinceId: 'vassal-fields'
        }
    },
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
            // A hopeless defense still throws one cheap body in the way:
            // each unopposed loss bleeds 1 honor, and Crane's honor engine
            // was winning the long games (dishonor wins ~40% of Crab games).
            chumpBlock: true,
            // Overshoot the minimal block: Crane flips exact-size defenses
            // with conflict cards after the commit.
            defenseSkillBuffer: 2,
            // Dig only once 3+ of its own characters are already in play. The
            // engine otherwise churns the dynasty deck every window (digging
            // instead of playing bodies), leaving too thin a board to defend.
            // Tuned by self-play vs the Crane precon: 10% -> ~45% win rate.
            digMinBoardCharacters: 3
            // NOTE: a low drawBidCap was tried to stop the honor bleed (dishonor
            // losses 17→4 at N=100) but conquest EXPLODED 39→63 (net 44%→33%):
            // Crab needs the cards the high bid buys to have defenders in hand.
            // Card volume dominates honor for this grind deck — keep the generic
            // bid. Left the drawBidCap knob in place for other decks.
        }
    },
    {
        // Unicorn "Cavalry Rush" precon (EmeraldDB ef93bae2). The pure rush
        // (concede every defense, disposable 0-1-fate bodies, commit every
        // body) was tuned in the former seed-4 (now seed-5) mirror and got rolled by the Crane
        // precon (~23%): Crane defends to prevent breaks, so the all-in
        // attacks bounced, while every Crane counterattack was conceded.
        // Keep the military pressure (forced military conflicts, cheap-body
        // flood) but defend provinces, spend cards defending, keep one body
        // home, and put real fate on characters so the board persists.
        // Self-play swept vs Crane: ~23% -> ~68% (pooled N=60).
        name: 'unicorn-cavalry-rush',
        match: (ids, strategy) => strategy.aggressive && ids.has('cavalry-reserves'),
        apply: {
            defenseCommitment: 'prevent-break',
            spendCardsOnDefense: true,
            attackCommitment: 'all-but-one',
            aggressiveFate: false,
            // Body-flood rush: every fate belongs on the board, not reserved.
            reserveDynastyFate: false,
            fateAwareEconomy: { ...SWARM_FATE_AWARE_ECONOMY },
            conflictCardEconomy: { ...SWARM_CONFLICT_CARD_ECONOMY }
        }
    },
    {
        // Upgraded Crane Duels (EmeraldDB e2e443b5): Vassal Fields under the
        // stronghold — its action drains 1 of the attacker's fate in every
        // conflict fought there, exactly on the final push.
        name: 'crane-duel-vassal-fields',
        match: (ids, strategy) => strategy.duelist && ids.has('vassal-fields'),
        apply: {
            strongholdProvinceId: 'vassal-fields'
        }
    },
    {
        // Dragon monk deck (EmeraldDB 4fb91e58): Sacred Sanctuary under the
        // stronghold — its on-reveal readies a Monk who then cannot be
        // bowed for the conflict, exactly when the final push arrives.
        name: 'dragon-sacred-sanctuary',
        match: (ids, strategy) => strategy.monk && ids.has('sacred-sanctuary'),
        apply: {
            strongholdProvinceId: 'sacred-sanctuary',
            // The monks are cheap and the payoffs count PARTICIPANTS' cards:
            // commit everything (measured vs all-but-one below).
            attackCommitment: 'all',
            // Earlier tuning conceded every defense the board could not win.
            // That let modest attacks break three outer provinces almost
            // uncontested, leaving no time for the card-count engine. Commit
            // bodies when they can prevent a break, but keep hand cards for
            // the deck's own five-card conflict engine. The generic stronghold
            // override still spends every useful card on game-ending defense.
            defenseCommitment: 'prevent-break',
            spendCardsOnDefense: false,
            preventBreakAfterBrokenProvinces: 2
        }
    },
    {
        // Phoenix glory deck (EmeraldDB 7c5b9776): Rally to the Cause under
        // the stronghold — its on-reveal switches the conflict type, so the
        // final push on the game-deciding province flips into the type the
        // attacker sized wrong. (Kuroi Mori cannot be a stronghold province.)
        name: 'phoenix-rally-stronghold',
        match: (ids, strategy) => strategy.glory && ids.has('rally-to-the-cause'),
        apply: {
            strongholdProvinceId: 'rally-to-the-cause'
        }
    },
    {
        // Lion list with Manicured Garden (EmeraldDB c99f60e2): the +1-fate
        // Conflict Action province goes under the stronghold — it fires in
        // every conflict fought there and cannot be sniped early.
        name: 'lion-manicured-garden',
        match: (ids, strategy) => strategy.aggressive && ids.has('hayaken-no-shiro') && ids.has('manicured-garden'),
        apply: {
            strongholdProvinceId: 'manicured-garden'
        }
    },
    {
        // Unicorn list with Temple of the Dragons (EmeraldDB 52b78858): it
        // goes under the stronghold. Its on-reveal reaction resolves the
        // contested ring as if WE were the attacker — on the opponent's
        // final all-in push that means bowing/dishonoring their attacker or
        // stripping their fate at the worst moment for them. (Public Forum
        // cannot be a stronghold province by its own text.)
        name: 'unicorn-temple-of-the-dragons',
        match: (ids, strategy) => strategy.aggressive && ids.has('temple-of-the-dragons'),
        apply: {
            strongholdProvinceId: 'temple-of-the-dragons'
        }
    },
    {
        // Crab list with Flooded Waste (EmeraldDB c9381e02): it goes under
        // the stronghold. Its on-reveal reaction bows EVERY attacking
        // character — parked on the game-deciding province it blunts the
        // opponent's final all-in push. Beats the generic Ancestral Lands
        // default for this deck.
        name: 'crab-flooded-waste',
        match: (ids, strategy) => strategy.defensive && strategy.holdingEngine && ids.has('flooded-waste'),
        apply: {
            strongholdProvinceId: 'flooded-waste'
        }
    },
    {
        // Lion "Bushi swarm" precon (EmeraldDB e3feb31b). Same shape as the
        // Unicorn rush — the deck derives `aggressive` from its swarm
        // markers — and it starts from the Unicorn-proven fixes vs Crane's
        // prevent-break defense (defend provinces, spend cards defending,
        // keep one body home, real fate on characters). On top it gets the
        // LionTactics sub-profile: bid-4 draw dials (Tactician's
        // Apprentice), high duel bids (its duels bow the loser), and the
        // Hayaken no Shiro ready-a-cheap-Bushi stronghold click. Matched on
        // the stronghold id so no other aggressive deck picks it up.
        name: 'lion-bushi-swarm',
        match: (ids, strategy) => strategy.aggressive && ids.has('hayaken-no-shiro'),
        apply: {
            defenseCommitment: 'prevent-break',
            spendCardsOnDefense: true,
            attackCommitment: 'all',
            aggressiveFate: false,
            // Lion is not a pure body-flood: it plays a couple of mid-cost
            // tower bushi (Toturi, Unified Company, Master Tactician — cost 5,
            // deployed with 2 fate) supported by cheap ones. Keep a 1-fate
            // dynasty reserve so the conflict phase can arm and ready that tower
            // (attachments, Right Hand of the Emperor) BEFORE it commits.
            reserveDynastyFate: true,
            fateAwareEconomy: {
                ...SWARM_FATE_AWARE_ECONOMY,
                preferDeckCharacters: true,
                preferDeckAdditionalFate: true,
                durableCharacterIds: [...LION_DEFAULTS.towerCharacters],
            },
            conflictCardEconomy: { ...SWARM_CONFLICT_CARD_ECONOMY },
            lion: { ...LION_DEFAULTS }
        }
    },
    {
        // Crane Baseline (EmeraldDB 4736f7c0): mixed duels/honor/control. Tsuma
        // activates the shared duel package; these additional knobs cover the
        // cards that distinguish this exact list. Meditations strips fate from
        // the final attacker and remains legal under the stronghold.
        name: 'crane-baseline-mixed-duels',
        match: (ids, strategy) => strategy.duelist &&
            CRANE_BASELINE_DEFAULTS.markerCards.every((id) => ids.has(id)),
        apply: {
            strongholdProvinceId: 'meditations-on-the-tao',
            craneBaseline: {
                ...CRANE_BASELINE_DEFAULTS,
                markerCards: [...CRANE_BASELINE_DEFAULTS.markerCards],
                gossipImportance: { ...CRANE_BASELINE_DEFAULTS.gossipImportance },
                gossipTagWeights: { ...CRANE_BASELINE_DEFAULTS.gossipTagWeights }
            }
        }
    },
    {
        // Lion Swarm v0.3 (EmeraldDB 27a913d1): a true province-trading rush.
        // Flood 0-2 cost bodies, but protect provinces that are actually at
        // risk of breaking. Feeding an Army / For Greater Glory preserve the
        // wide board; throwing every defense left too many free breaks and
        // made those persistence tools arrive too late. The Ashigaru Levy
        // marker makes this override exclusive to the new list.
        name: 'lion-ashigaru-rush',
        match: (ids, strategy) => strategy.aggressive && ids.has('hayaken-no-shiro') && ids.has('ashigaru-levy'),
        apply: {
            defenseCommitment: 'prevent-break',
            spendCardsOnDefense: true,
            attackCommitment: 'all',
            aggressiveFate: false,
            reserveDynastyFate: false,
            digWithActions: true,
            digMinBoardCharacters: 0,
            strongholdProvinceId: 'weight-of-duty',
            fateAwareEconomy: {
                ...SWARM_FATE_AWARE_ECONOMY,
                preferDeckCharacters: true,
                preferDeckAdditionalFate: true,
                deferPassForDynastyActions: true,
                durableCharacterIds: [...LION_DEFAULTS.towerCharacters]
            },
            conflictCardEconomy: { ...SWARM_CONFLICT_CARD_ECONOMY },
            lion: { ...LION_DEFAULTS }
        }
    },
    {
        // Scorpion "Poison Mill": Night Raid goes under the stronghold. The
        // stronghold province is only attackable after 3 others break, so the
        // opponent's final all-in push reveals it and discards X cards from
        // their hand (X = attackers) — exactly when they commit everything.
        name: 'scorpion-poison-mill',
        match: (ids, strategy) => strategy.dishonor && ids.has('night-raid'),
        apply: {
            strongholdProvinceId: 'night-raid'
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
            const apply: Partial<DeckProfile> = { ...override.apply };
            // Overrides are module-level constants. Clone injectable nested
            // profiles so tuning one resolved bot can never mutate another.
            if(override.apply.conflictCardEconomy) {
                apply.conflictCardEconomy = { ...override.apply.conflictCardEconomy };
            }
            if(override.apply.fateAwareEconomy) {
                apply.fateAwareEconomy = {
                    ...override.apply.fateAwareEconomy,
                    ...(Array.isArray(override.apply.fateAwareEconomy.durableCharacterIds)
                        ? { durableCharacterIds: [...override.apply.fateAwareEconomy.durableCharacterIds] }
                        : {})
                };
            }
            if(override.apply.strongholdDefense) {
                apply.strongholdDefense = { ...override.apply.strongholdDefense };
            }
            if(override.apply.attachmentControl) {
                apply.attachmentControl = {
                    ...override.apply.attachmentControl,
                    ownDebuffScores: { ...override.apply.attachmentControl.ownDebuffScores },
                    enemyAttachmentScores: { ...override.apply.attachmentControl.enemyAttachmentScores }
                };
            }
            if(override.apply.craneBaseline) {
                apply.craneBaseline = {
                    ...override.apply.craneBaseline,
                    markerCards: [...override.apply.craneBaseline.markerCards],
                    gossipImportance: { ...override.apply.craneBaseline.gossipImportance },
                    gossipTagWeights: { ...override.apply.craneBaseline.gossipTagWeights }
                };
            }
            Object.assign(profile, apply);
        }
    }
    return profile;
}
