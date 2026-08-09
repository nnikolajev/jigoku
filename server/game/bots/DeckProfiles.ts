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

import type { DeckStrategy, HonorRaceLimits } from './CardPlaybook';
import type { DefenseCommitmentConfig } from './DefenseCommitmentPolicy';
import type { ConflictDeclarationConfig } from './ConflictDeclarationPolicy';
import { DEFAULT_HONOR_RACE_LIMITS } from './CardPlaybook.js';
import { DISHONOR_DEFAULTS } from './DishonorTactics.js';
import type { DishonorProfile } from './DishonorTactics';
import { BID_WAR_DEFAULTS } from './BidWarTactics.js';
import type { BidWarProfile } from './BidWarTactics';
import { LION_DEFAULTS } from './LionTactics.js';
import type { LionProfile } from './LionTactics';
import { LION_DUELIST_DEFAULTS } from './LionDuelistTactics.js';
import type { LionDuelistProfile } from './LionDuelistTactics';
import { CRAB_SACRIFICE_DEFAULTS } from './CrabSacrificeTactics.js';
import type { CrabSacrificeProfile } from './CrabSacrificeTactics';
import { CRANE_HONOR_DEFAULTS } from './CraneHonorTactics.js';
import type { CraneHonorProfile } from './CraneHonorTactics';
import { LION_HONOR_DEFAULTS } from './LionHonorTactics.js';
import type { LionHonorProfile } from './LionHonorTactics';
import type {
    ConflictRecursionProfile,
    DynastyEventProfile,
    StrongholdBowProfile
} from './SharedCardTactics';
import { DEFAULT_FATE_AWARE_ECONOMY, SWARM_FATE_AWARE_ECONOMY } from './FateAwareEconomy.js';
import type { FateAwareEconomyProfile } from './FateAwareEconomy';
import { DEFAULT_SAVE_FATE_PASS } from './SaveFatePassPolicy.js';
import type { SaveFatePassProfile } from './SaveFatePassPolicy';
import { DEFAULT_AGGRESSIVE_SPEND } from './AggressiveSpendPolicy.js';
import type { AggressiveSpendProfile } from './AggressiveSpendPolicy';
import { DEFAULT_CONFLICT_CARD_ECONOMY, SWARM_CONFLICT_CARD_ECONOMY } from './ConflictCardEconomy.js';
import type { ConflictCardEconomyProfile } from './ConflictCardEconomy';
import { GLORY_DEFAULTS } from './GloryTactics.js';
import type { GloryProfile } from './GloryTactics';
import { DRAGON_DEFAULTS } from './DragonTactics.js';
import type { DragonProfile } from './DragonTactics';
import { DUEL_DEFAULTS } from './DuelTactics.js';
import type { DuelProfile } from './DuelTactics';
import { DEFAULT_DUEL_BID_PROFILE } from './DuelBidTactics.js';
import type { DuelBidProfile } from './DuelBidTactics';
import {
    CARD_ENGINE_DRAW_BID_PROFILE,
    FATE_ECONOMY_DRAW_BID_PROFILE,
    DEFAULT_DRAW_BID_PROFILE,
    DEFAULT_LEGACY_DRAW_BID_PROFILE,
    DISHONOR_DRAW_BID_PROFILE,
    DISHONOR_LEGACY_DRAW_BID_PROFILE,
    DRAGON_LEGACY_DRAW_BID_PROFILE,
    HONOR_DRAW_BID_PROFILE,
    LION_LEGACY_DRAW_BID_PROFILE,
    TOWER_DRAW_BID_PROFILE
} from './DrawBidTactics.js';
import type { DrawBidProfile, LegacyDrawBidProfile } from './DrawBidTactics';
import { SHUGENJA_DEFAULTS } from './ShugenjaTactics.js';
import type { ShugenjaProfile } from './ShugenjaTactics';
import { REBIRTH_DEFAULTS } from './RebirthTactics.js';
import type { RebirthProfile } from './RebirthTactics';
import { DRAGON_ATTACHMENT_DEFAULTS } from './DragonAttachmentTactics.js';
import type { DragonAttachmentProfile } from './DragonAttachmentTactics';
import { STRONGHOLD_DEFENSE_DEFAULTS } from './StrongholdDefenseTactics.js';
import type { StrongholdDefenseProfile } from './StrongholdDefenseTactics';
import { ATTACHMENT_CONTROL_DEFAULTS } from './AttachmentControlTactics.js';
import type { AttachmentControlProfile } from './AttachmentControlTactics';
import { CRANE_BASELINE_DEFAULTS } from './CraneBaselineTactics.js';
import type { CraneBaselineProfile } from './CraneBaselineTactics';
import { PERSONAL_HONOR_DEFAULTS } from './PersonalHonorTactics.js';
import type { PersonalHonorProfile } from './PersonalHonorTactics';
import { PROVINCE_TARGETING_DEFAULTS } from './ProvinceTargeting.js';
import type { ProvinceTargetingProfile } from './ProvinceTargeting';
import { UNICORN_DEFAULTS } from './UnicornTactics.js';
import type { UnicornProfile } from './UnicornTactics';
import {
    PROVINCE_REVEAL_RESPONSE_DEFAULTS,
    UNICORN_REVEAL_DEFAULTS
} from './UnicornRevealTactics.js';
import type {
    ProvinceRevealResponseProfile,
    UnicornRevealProfile
} from './UnicornRevealTactics';
import { DEFAULT_MULLIGAN_PROFILE, RUSH_MULLIGAN_PROFILE } from './MulliganTactics.js';
import type { MulliganProfile } from './MulliganTactics';
import {
    DEFAULT_BOARD_AWARE_DYNASTY,
    RUSH_BOARD_AWARE_DYNASTY
} from './BoardAwareDynastyTactics.js';
import type { BoardAwareDynastyProfile } from './BoardAwareDynastyTactics';
import { DEFAULT_CONFLICT_DECK_SAFETY } from './ConflictDeckSafetyTactics.js';
import type { ConflictDeckSafetyProfile } from './ConflictDeckSafetyTactics';
import {
    DEFAULT_CONFLICT_PHASE_PLANNER,
    RUSH_CONFLICT_PHASE_PLANNER
} from './ConflictPhasePlanner.js';
import type { ConflictPhasePlannerProfile } from './ConflictPhasePlanner';
import type { ConflictActionProfile } from './v2/ConflictActionPlanner';
import { DEFAULT_CONFLICT_INTENTS } from './DeckConflictIntents.js';
import type {
    ConflictIntentProfile,
    DeckConflictIntentRule,
    DeckDefenseIntentRule
} from './DeckConflictIntents';

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

// A dynasty-phase cost reducer played from hand (Those Who Serve). Kept generic
// because two shipped decks now run the card and a `PlaybookEntry` cannot see
// the deck profile.
export interface DynastyCostReducerProfile {
    cardId: string;
    // Only fire with this many characters still buyable, and this much fate to
    // buy them with — otherwise the discount is spent on nothing.
    minimumCharacters: number;
    minimumFate: number;
}

export interface DeckProfile {
    // ---- dynasty / economy ----
    fateAwareEconomy: FateAwareEconomyProfile; // conservative dynasty envelope used by seeds 1 and 3
    boardAwareDynasty: BoardAwareDynastyProfile; // seed-3 board/game-state dynasty planner
    conflictDeckSafety: ConflictDeckSafetyProfile; // seed-1/3 optional deck-consumption safety
    conflictCardEconomy: ConflictCardEconomyProfile; // shared injectable conflict-card value/fate planner for seeds 1-3
    conflictPlanning: ConflictPhasePlannerProfile; // shared bounded same-phase declaration rollout
    conflictIntents: ConflictIntentProfile; // per-deck declaration options the shared rollout ranks
    // V2-only outcome weights for in-conflict card sequencing. Undefined uses
    // the planner defaults; a deck overrides only the weights it cares about.
    conflictActionPlan?: Partial<ConflictActionProfile>;
    mulligan: MulliganProfile; // shared opening hand/province mulligan and fate-phase refresh policy
    strongholdDefense: StrongholdDefenseProfile; // shared injectable last-province reserve planner for every seed
    provinceTargeting: ProvinceTargetingProfile; // shared injectable Eminent/strength/ability target priority for every seed
    provinceRevealResponse: ProvinceRevealResponseProfile; // generic Aranat reveal/deny valuation for every opponent deck
    attachmentControl: AttachmentControlProfile; // shared Let Go / attachment-removal value policy
    personalHonor: PersonalHonorProfile; // shared glory-aware honor/dishonor target policy
    duelBidding: DuelBidProfile; // shared skill/honor/round/Iaijutsu bid matrix for every deck and seed
    drawBidding: DrawBidProfile; // shared adaptive draw-phase honor/card economy policy
    legacyDrawBidding: LegacyDrawBidProfile; // frozen pre-refactor behavior for A/B only
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
    reserveDynastyFate: boolean; // keep 1 fate through the dynasty phase for
                                 // conflict-phase hand cards. Good for most
                                 // decks; a pure body-flood rush wants every
                                 // fate on the board instead, so it opts out.
    useOmniscientConflictAxis: boolean; // exact-hand axis comparison; decks
                                        // with hard ring/type synergies may opt out
    useOmniscientProvinceKnowledge: boolean; // exact hidden province/stack targeting
    omniscientEarthRingThreatBonus: number; // deny a known playable hand threat
    omniscientAttackResponseBuffer: number; // bounded extra break margin when a
                                             // known affordable response exists
    useOmniscientTokenDefense: boolean; // use exact hand to chump only when the
                                         // attack still cannot break

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
    // The chump costs a body's readiness for the rest of the round — defenders
    // bow on return home (`conflictflow.ts:950`) — to save 1 honor. These scope
    // that trade instead of always taking it. Zero/false is the unscoped
    // behavior the flag has always had.
    chumpBlockHonorCeiling: number; // only chump at or below this own honor
    chumpBlockSurplusBodies: number; // require this many spare ready bodies
    defenseSkillBuffer: number; // extra skill committed past the minimal
                                // prevent-break target — a buffer against the
                                // opponent's post-commit pump cards

    // A defense sized on visible skill alone is a free flip for any held pump:
    // the attacker acts after the defenders are declared, so one card beats the
    // exact-threshold block every time. A human defender never blocks to the
    // exact number for that reason. These size a buffer from PUBLIC signals —
    // the attacker's hand count and fate — instead of the flat constant above,
    // which cannot tell a dumped hand from a full one.
    //
    // A rate of 0 disables the whole mechanism (legacy behavior). The cap is
    // what keeps this away from the measured-negative omniscient experiment at
    // `JigokuBotPolicy` "sizing the whole defense against effectiveAttack":
    // budgeting for the opponent's ENTIRE affordable threat bows bodies the
    // next conflict needed. Budgeting for one trick does not.
    defenseThreatBufferRate: number; // buffer skill per affordable opposing card
    defenseThreatBufferCap: number; // hard ceiling on the derived buffer
    // Restrict the buffer to conflicts after which we have no conflict
    // opportunity of our own left this round, so the extra bodies it bows have
    // no alternative use. Unscoped, the buffer measured -1.4pp with the entire
    // loss on Crane and Unicorn, both of which spend those bodies attacking.
    defenseThreatBufferIdleOnly: boolean;
    // Attackers win ties (`conflict.ts:517`), so a defense that lands exactly on
    // the attacker's skill LOSES the conflict while still saving the province.
    // The win-only path already adds this 1; the shared prevent-break path
    // never did.
    defenseBreakTie: boolean;
    // Scoping for the tie-break above, owned by `DefenseCommitmentPolicy`. The
    // flag pays whatever the next body costs; these price it. Empty = the flat
    // reading of `defenseBreakTie`, so this is additive and injectable per deck.
    defenseTuning: Partial<DefenseCommitmentConfig>;
    // Which conflict to declare, owned by `ConflictDeclarationPolicy`. V1 picks
    // the axis its own board is strongest on and never looks at what the
    // opponent has ready to meet it, although that board is public. Empty = the
    // old own-board rule.
    conflictDeclaration: Partial<ConflictDeclarationConfig>;

    // Honor is a win condition on both ends — 0 loses, 25 wins — and the bot
    // pays honor costs (Assassination is 3) with no budget at all outside the
    // dishonor decks. Off keeps the per-card constants that were there before.
    honorRaceAware: boolean;
    honorRace: HonorRaceLimits;

    // Turns on the live honor-DIAL readings in shared playbook entries (Make
    // an Opening's X is the absolute dial difference, so the card is dead on a
    // tie). Off holds those entries at their legacy reading, which is what
    // every non-bid-war deck keeps.
    bidWarAware: boolean;

    // Scale applied to `DYNASTY_ABILITY_VALUE`, the signed price list for
    // static printed text on dynasty characters. The live ability term is a
    // saturated constant (3.50-4.00 across all 117 field characters, 0.375
    // after its weight) and orders nothing; this restores a signed spread.
    // Zero disables the whole mechanism — every character contributes 0, which
    // is exactly what the ranking did before the list existed.
    dynastyAbilityScale: number;
    // The scale above only reaches a TIE-BREAK, and a tie-break is decided by
    // sign, not magnitude — scaling it by any positive constant produces a
    // bit-identical run. This weight lets the price move a card between cost
    // tiers instead, by shifting the cost the ORDERING sees. Affordability and
    // every budget check keep using the real printed cost. Zero disables it.
    dynastyAbilityCostWeight: number;

    // ---- decisions that used to be answered by the first available button ----
    // A prompt with no title-specific handler falls through to
    // `fallback-button`, which takes the first acceptable choice. Measured over
    // 180 games (`scratchpad/coverage.js`), that is 3.6% of all decisions, and
    // most of it turned out to be harmless or already optimal — see
    // `docs/bot-v2-rejected-experiments.md` for the Imperial Favor and dynasty
    // first-to-pass negatives. This is the slice that was worth fixing.
    //
    // Rank handler-menu choices that are CARDS (deck searches, look-at-top-N
    // plays, attachment searches) by printed power instead of taking the first
    // button, which is deck order.
    rankCardMenus?: boolean;

    // ---- live pricing for conflict events ----
    // Characters and attachments expose printed skill through controller hand
    // stats, so the policy knows what they add. EVENTS do not: `handContribution`
    // returns null for them unless the playbook entry carries a
    // `conflictContribution`, and only six of the sixty-one events in the bot
    // field carried one. Everything else was invisible to province-break
    // budgeting and to the `strength-already-sufficient` veto.
    //
    // On, the playbook's event models compute what the card is worth against
    // the live board instead of a flat constant — Banzai is +2, or +4 when we
    // can pay the honor, or 0 with no ready participant to pump. Off restores
    // the previous reading exactly (the old flat constant where there was one,
    // null everywhere else), which is what the A/B control arm runs.
    liveEventPricing?: boolean;
    // Card ids left at their legacy reading while `liveEventPricing` is on.
    // Pricing an event is not automatically an improvement: a number activates
    // the `zero-contribution` and `strength-already-sufficient` vetoes and
    // changes where the card sorts in `ConflictCardEconomy`, so a model that is
    // individually correct can still cost a deck games. This is how a single
    // card is ablated out of the set without rebuilding.
    liveEventPricingExclude?: readonly string[];

    // Own provinces whose printed text PAYS when they break (The Art of War
    // draws 3), and the number of already-broken own provinces past which that
    // trade stops being worth it. Conceding one is a real play for a deck that
    // races: it buys three cards for a province it was going to lose anyway.
    // It is a disaster for a deck that wants LONG games, because every conceded
    // province walks the opponent one step closer to conquest — and this is a
    // per-deck judgement, not a property of the card.
    //
    // `['the-art-of-war']` / 1 is exactly the behaviour this was before the
    // knob existed. An empty list never concedes.
    provinceConcede: { cardIds: readonly string[]; maxOwnBrokenProvinces: number };

    // ---- setup ----
    // Printed id of the province to place under the stronghold. The stronghold
    // province is only attackable after 3 others are broken, so an on-reveal
    // punisher there (Night Raid) blunts the opponent's final all-in push.
    // Unset = keep the generic placement (bot picks arbitrarily).
    strongholdProvinceId?: string;

    // Which side of the setup flip to take when we win it. Going first buys
    // tempo (first conflict, first province break); going SECOND buys the last
    // word in every conflict phase and, for a reactive/cancel deck, the chance
    // to see what the opponent commits before answering it. 'first' is the
    // behavior every deck had before this knob existed.
    firstPlayerChoice: 'first' | 'second';

    // Which side of the Imperial Favor to claim. The constant 'military' is
    // measured-optimal ACROSS THE FIELD (three per-round estimators all raised
    // the share of favor-holding conflicts that got +0), but the field is
    // roughly 65/35 military and a deck whose entire board is courtiers is on
    // the other side of that split. Injectable so a single-axis deck can say so
    // without moving the field default.
    imperialFavorChoice: 'military' | 'political';

    // ---- dishonor / mill playstyle (Scorpion Poison Mill) ----
    // Present only for decks whose strategy derives `dishonor`; every policy
    // branch that reads it is gated on its presence, so all other decks keep
    // the unchanged generic behavior. Knobs live in DishonorTactics.
    dishonor?: DishonorProfile;

    // ---- honor-dial playstyle (Scorpion "Bid War", Kyuden Bayushi) ----
    // Present only for decks whose strategy derives `bidWar`; every policy
    // branch that reads it is gated on its presence, so all other decks — the
    // separate Scorpion Poison Mill dishonor list included — keep the
    // unchanged generic behavior. Knobs live in BidWarTactics.
    bidWar?: BidWarProfile;

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

    // ---- Fushicho rotation playstyle (Phoenix "Phoenix") ----
    // Present only for decks whose strategy derives `rebirth`. It layers the
    // zero-fate body rotation and dynasty-discard recursion on top of the
    // Kyuden Isawa spell package, which the same deck also runs — every
    // rebirth branch in the policy is gated on this being present, so the
    // older Phoenix Shugenja list is untouched. Knobs in RebirthTactics.
    rebirth?: RebirthProfile;

    // ---- Dragon attachment-tower playstyle (Iron Mountain Castle) ----
    // Deep-fate tower buying, a three-slot Restricted cap, attachment search,
    // and Niten Master / Togashi Yokuni ability steering.
    attachmentTower?: DragonAttachmentProfile;

    // ---- Unicorn cavalry movement/rush playstyle ----
    // Exact participation, move-in sequencing and movement attachment targets.
    unicorn?: UnicornProfile;

    // ---- Lion Duelist honor-switch playstyle (Kyuden Ikoma) ----
    // Present only for decks whose strategy derives `lionDuelist`; every policy
    // branch that reads it is gated on its presence, so the older Lion bushi
    // swarm list (Hayaken no Shiro) is untouched. Knobs in LionDuelistTactics.
    lionDuelist?: LionDuelistProfile;

    // ---- Crab Berserker Sacrifice playstyle (Castle of the Forgotten) ----
    // Present only for decks whose strategy derives `crabSacrifice`; every
    // policy branch that reads it is gated on its presence, so the Kyuden Hida
    // Crab wall precon is untouched. Knobs in CrabSacrificeTactics.
    crabSacrifice?: CrabSacrificeProfile;

    // ---- Crane Courtier Honor playstyle (Seven Fold Palace) ----
    // Present only for decks whose strategy derives `craneHonor`; every policy
    // branch that reads it is gated on its presence, so the Crane Baseline and
    // Crane Duels lists — which share Tsuma and most of the honor events — are
    // untouched. Knobs in CraneHonorTactics.
    craneHonor?: CraneHonorProfile;

    // ---- Lion Honor 25-honor race (Kyuden Ikoma + Kenson no Gakka) ----
    // Present only for decks whose strategy derives `lionHonor`; every policy
    // branch that reads it is gated on its presence, so the Lion Duelist list —
    // same stronghold, opposite plan — is untouched. Knobs in LionHonorTactics.
    lionHonor?: LionHonorProfile;

    // ---- shared card packages (see SharedCardTactics) ----
    // Each of these was one deck's tactics method that a second deck running
    // the same card could not reach. All three are undefined by default, so a
    // deck that does not opt in keeps the previous behaviour exactly.
    //
    // Stronghold "bow a character" reaction — Kyuden Ikoma, both Lion lists.
    strongholdBow?: StrongholdBowProfile;
    // Put a body from a discard pile into the conflict — Kitsu Spiritcaller,
    // Forebearer's Echoes.
    conflictRecursion?: ConflictRecursionProfile;
    // Dynasty EVENTS, which no dynasty economy path ranks — Honored Veterans,
    // A Season of War, Procedural Interference.
    dynastyEvents?: DynastyEventProfile;
    // Skip a whole dynasty phase to bank the income (plus the first-passer
    // fate) when the board already stands. Undefined/off for every deck that
    // has not measured positive with it.
    saveFatePass?: SaveFatePassProfile;
    // Last-resort conflict spending: play the best legal affordable card when
    // the intent filter has rejected everything and the budget was open.
    // Undefined/off unless a deck measures positive with it.
    aggressiveSpend?: AggressiveSpendProfile;
    // Trait lists used by shared card steering where the serialized summary may
    // not carry the trait. Empty by default; the trait check runs first.
    commanderCharacterIds?: readonly string[];
    bushiCharacterIds?: readonly string[];

    // A CONFLICT event played from HAND during the DYNASTY phase that reduces
    // every character bought afterwards this phase (Those Who Serve). The
    // dynasty window only ever scans PROVINCES, so without an explicit hook the
    // copies sit in hand and cycle. Undefined for every deck that does not run
    // one, which keeps the hook inert.
    dynastyCostReducer?: DynastyCostReducerProfile;

    // ---- Unicorn Shiro Shinjo province-reveal/economy playstyle ----
    // Reveal-first attacks, Scouted Terrain finisher, faceup-province scaling,
    // and card-specific target/fate choices. Exact-list override only.
    unicornReveal?: UnicornRevealProfile;

    // Names of the per-deck overrides that matched, in application order. This
    // is the deck's identity for layers that tune per deck without re-deriving
    // it from the card list (Bot V2's conflict intents).
    overrideNames?: string[];
}

// Generic baseline = a deck with no strategy flags (e.g. Crane, unknown). These
// are the values the policy used for a flag-less deck before the refactor.
// Bodies bought in rounds one to three get a fate, so they survive the fate
// phase of the round that bought them. V1 otherwise answers ZERO to the
// additional-fate prompt almost every time, and a character with no fate is
// discarded at step 4.2 of that same round.
//
// Shipped in two measured steps, each on the head-to-head rig (baseline a hard
// 50%, null arm exactly 50.00%) and each on six shuffle bases never used to
// find it:
//   round 1 only          +2.22pp  z=2.54  p=0.011   (3263 games, 6/6 bases)
//   rounds 1-3, on top    +4.14pp  z=4.73  p<0.0001  (3264 games, 6/6 bases)
// The extension wins across all three win conditions, not just conquest.
//
// The AMOUNT is not the lever — raising the floor to 2 measured +0.69pp
// (p=0.45). The DURATION is, which fits the mechanism: the body that dies for
// want of one fate is bought every round, not only in round one.
//
// Disabling it per deck was tested and no deck qualified: the disable arm
// measured -1.93pp (p=0.022) overall and no deck read a resolvable gain from
// having it off. The SKIP half of this profile measured -4.64pp and stays off
// everywhere. See `docs/bot-save-fate-pass.md`.
const SHIPPED_SAVE_FATE_PASS: SaveFatePassProfile = {
    ...DEFAULT_SAVE_FATE_PASS,
    setupRounds: [1, 2, 3],
    setupAdditionalFate: 1
};

export const DEFAULT_PROFILE: DeckProfile = {
    fateAwareEconomy: { ...DEFAULT_FATE_AWARE_ECONOMY },
    boardAwareDynasty: {
        ...DEFAULT_BOARD_AWARE_DYNASTY,
        minimumCharactersByRound: [...DEFAULT_BOARD_AWARE_DYNASTY.minimumCharactersByRound],
        characterValueById: { ...DEFAULT_BOARD_AWARE_DYNASTY.characterValueById }
    },
    conflictDeckSafety: {
        ...DEFAULT_CONFLICT_DECK_SAFETY,
        forcedDrawsByOpponentCardId: { ...DEFAULT_CONFLICT_DECK_SAFETY.forcedDrawsByOpponentCardId },
        forcedHonorLossByOpponentCardId: { ...DEFAULT_CONFLICT_DECK_SAFETY.forcedHonorLossByOpponentCardId }
    },
    conflictCardEconomy: { ...DEFAULT_CONFLICT_CARD_ECONOMY },
    conflictPlanning: { ...DEFAULT_CONFLICT_PHASE_PLANNER },
    conflictIntents: { ...DEFAULT_CONFLICT_INTENTS, rules: [], defenseRules: [] },
    mulligan: {
        ...DEFAULT_MULLIGAN_PROFILE,
        openingKeepHoldingIds: [...DEFAULT_MULLIGAN_PROFILE.openingKeepHoldingIds],
        openingKeepConflictIds: [...DEFAULT_MULLIGAN_PROFILE.openingKeepConflictIds],
        openingDiscardCharacterIds: [...DEFAULT_MULLIGAN_PROFILE.openingDiscardCharacterIds],
        preferredCharacterIds: [...DEFAULT_MULLIGAN_PROFILE.preferredCharacterIds],
        endHoldingLimit: { ...DEFAULT_MULLIGAN_PROFILE.endHoldingLimit },
        holdingCopyLimitById: { ...DEFAULT_MULLIGAN_PROFILE.holdingCopyLimitById },
        keepHoldingIds: [...DEFAULT_MULLIGAN_PROFILE.keepHoldingIds],
        keepDynastyCardIds: [...DEFAULT_MULLIGAN_PROFILE.keepDynastyCardIds]
    },
    strongholdDefense: { ...STRONGHOLD_DEFENSE_DEFAULTS },
    provinceTargeting: {
        ...PROVINCE_TARGETING_DEFAULTS,
        abilityPriority: { ...PROVINCE_TARGETING_DEFAULTS.abilityPriority },
        effectiveStrengthById: { ...PROVINCE_TARGETING_DEFAULTS.effectiveStrengthById },
        priorityTierById: { ...PROVINCE_TARGETING_DEFAULTS.priorityTierById }
    },
    provinceRevealResponse: {
        ...PROVINCE_REVEAL_RESPONSE_DEFAULTS,
        onRevealValueById: { ...PROVINCE_REVEAL_RESPONSE_DEFAULTS.onRevealValueById },
        fallbackValueByAbility: { ...PROVINCE_REVEAL_RESPONSE_DEFAULTS.fallbackValueByAbility }
    },
    attachmentControl: {
        ...ATTACHMENT_CONTROL_DEFAULTS,
        ownDebuffScores: { ...ATTACHMENT_CONTROL_DEFAULTS.ownDebuffScores },
        enemyAttachmentScores: { ...ATTACHMENT_CONTROL_DEFAULTS.enemyAttachmentScores }
    },
    personalHonor: { ...PERSONAL_HONOR_DEFAULTS },
    duelBidding: { ...DEFAULT_DUEL_BID_PROFILE },
    drawBidding: { ...DEFAULT_DRAW_BID_PROFILE },
    legacyDrawBidding: { ...DEFAULT_LEGACY_DRAW_BID_PROFILE },
    mulliganForHoldings: false,
    digWithActions: false,
    digMinBoardCharacters: 0,
    aggressiveFate: false,
    // On for every deck. Measured over three independent shuffle bases
    // (n=540 paired), the win-rate effect is +0.19pp — inside the +/-2.5pp
    // noise floor — but taking Hida Kisada over a 1-cost body because Kisada
    // happened to be third in the list is simply wrong play, and this is what
    // a human opponent sees.
    rankCardMenus: true,
    // On for every deck. Measured +0.62pp against the paired `off` arm over
    // three independent shuffle bases (n=1620), positive on all three
    // (+1.11 / +0.56 / +0.19pp) but inside the +/-2.5pp noise floor. It ships on
    // the correctness underneath the number: Consumed by Five Fires was
    // unplayable behind a gate that could not pass, Banzai was budgeted at half
    // the skill the bot actually takes, and three models read a flat zero
    // because glory and discard-pile skill are not on the fields they looked at.
    //
    // Switching an event from "unknown contribution" to a number activates the
    // `zero-contribution` and `strength-already-sufficient` vetoes for it and
    // moves it in `ConflictCardEconomy`, so a model that is right in isolation
    // can still cost a deck games — `give-no-ground` did, at -4.3pp on Crab.
    liveEventPricing: true,
    forceMilitaryConflict: false,
    attackCommitment: 'all-but-one',
    attackKeepHome: 1,
    reserveDynastyFate: true,
    useOmniscientConflictAxis: false,
    useOmniscientProvinceKnowledge: true,
    omniscientEarthRingThreatBonus: 0,
    omniscientAttackResponseBuffer: 0,
    useOmniscientTokenDefense: false,
    defenseCommitment: 'prevent-break',
    spendCardsOnDefense: true,
    preventBreakAfterBrokenProvinces: 0,
    chumpBlock: false,
    defenseSkillBuffer: 0,
    defenseThreatBufferRate: 0,
    defenseThreatBufferCap: 0,
    defenseThreatBufferIdleOnly: false,
    defenseBreakTie: false,
    defenseTuning: {},
    // SHIPPED ON. V1 used to choose the conflict axis from its own ready board
    // alone, ignoring the opponent's board even though that board is public and
    // the fair `ringScore` already reads it. Weight 1 subtracts the opponent's
    // ready skill on each axis, which is the model the omniscient variant uses
    // minus its one genuinely hidden term (their hand).
    //
    // Measured head-to-head, changed bots against unchanged bots, 90 ordered
    // cross-deck pairings per base: **+1.58pp over 6468 games on 36 independent
    // bases (z=2.54, p=0.011)**, positive on all three base SETS (+2.78 / +0.46
    // / +1.92pp) and on 26 of 36 individual bases. Null arm exactly 50.00%.
    // Flat in the weight (0.5 -> +0.51pp, 1.5 -> +0.56pp on a shared 6 bases),
    // so this is not a tuned constant.
    //
    // Per deck, causal (paired probe, both seats pooled): eight of eight
    // non-rush decks positive, none negative. Lion and Unicorn record exactly
    // zero flips because `forceMilitaryConflict` returns before the policy runs.
    conflictDeclaration: { opponentBoardWeight: 1 },
    honorRaceAware: false,
    honorRace: { ...DEFAULT_HONOR_RACE_LIMITS },
    bidWarAware: false,
    firstPlayerChoice: 'first',
    imperialFavorChoice: 'military',
    chumpBlockHonorCeiling: 0,
    chumpBlockSurplusBodies: 0,
    dynastyAbilityScale: 0,
    dynastyAbilityCostWeight: 0,
    provinceConcede: { cardIds: ['the-art-of-war'], maxOwnBrokenProvinces: 1 },
    // Round-one bodies get a fate so they survive the round-one fate phase.
    // Shipped field-wide 2026-08-07: +2.22pp (z=2.54, p=0.011) over 3263
    // head-to-head games on six shuffle bases never used to find it, positive
    // on all six, against a null arm that scored exactly 50.00%. It fires only
    // where the deck's own answer was ZERO extra fate — i.e. on bodies that
    // were guaranteed to be discarded the same round. See
    // `docs/bot-save-fate-pass.md`; the SKIP half of that profile is measured
    // at -4.64pp and stays off.
    saveFatePass: SHIPPED_SAVE_FATE_PASS
};

// Exact reproduction of the old flag-driven behavior. Start from the generic
// baseline, then apply the aggressive and defensive/holding overlays the policy
// used to hard-code. Aggressive and defensive are mutually exclusive in
// practice (their marker sets do not overlap), but holdingEngine can combine
// with defensive (Crab).
export function profileFromStrategy(strategy?: DeckStrategy): DeckProfile {
    const profile: DeckProfile = {
        ...DEFAULT_PROFILE,
        // Cloned like every other nested profile: a bare spread would hand
        // every deck the SAME object, so one override would leak to all ten.
        defenseTuning: { ...DEFAULT_PROFILE.defenseTuning },
        conflictDeclaration: { ...DEFAULT_PROFILE.conflictDeclaration },
        fateAwareEconomy: { ...DEFAULT_PROFILE.fateAwareEconomy },
        boardAwareDynasty: {
            ...DEFAULT_PROFILE.boardAwareDynasty,
            minimumCharactersByRound: [...DEFAULT_PROFILE.boardAwareDynasty.minimumCharactersByRound],
            characterValueById: { ...DEFAULT_PROFILE.boardAwareDynasty.characterValueById }
        },
        conflictDeckSafety: {
            ...DEFAULT_PROFILE.conflictDeckSafety,
            forcedDrawsByOpponentCardId: { ...DEFAULT_PROFILE.conflictDeckSafety.forcedDrawsByOpponentCardId },
            forcedHonorLossByOpponentCardId: { ...DEFAULT_PROFILE.conflictDeckSafety.forcedHonorLossByOpponentCardId }
        },
        conflictCardEconomy: { ...DEFAULT_PROFILE.conflictCardEconomy },
        conflictPlanning: { ...DEFAULT_PROFILE.conflictPlanning },
        saveFatePass: {
            ...SHIPPED_SAVE_FATE_PASS,
            setupRounds: [...SHIPPED_SAVE_FATE_PASS.setupRounds]
        },
        conflictIntents: {
            ...DEFAULT_PROFILE.conflictIntents,
            rules: DEFAULT_PROFILE.conflictIntents.rules.map((rule) => ({ ...rule })),
            defenseRules: (DEFAULT_PROFILE.conflictIntents.defenseRules || [])
                .map((rule) => ({ ...rule }))
        },
        mulligan: {
            ...DEFAULT_PROFILE.mulligan,
            openingKeepHoldingIds: [...DEFAULT_PROFILE.mulligan.openingKeepHoldingIds],
            openingKeepConflictIds: [...DEFAULT_PROFILE.mulligan.openingKeepConflictIds],
            openingDiscardCharacterIds: [...DEFAULT_PROFILE.mulligan.openingDiscardCharacterIds],
            preferredCharacterIds: [...DEFAULT_PROFILE.mulligan.preferredCharacterIds],
            endHoldingLimit: { ...DEFAULT_PROFILE.mulligan.endHoldingLimit },
            holdingCopyLimitById: { ...DEFAULT_PROFILE.mulligan.holdingCopyLimitById },
            keepHoldingIds: [...DEFAULT_PROFILE.mulligan.keepHoldingIds],
            keepDynastyCardIds: [...DEFAULT_PROFILE.mulligan.keepDynastyCardIds]
        },
        strongholdDefense: { ...DEFAULT_PROFILE.strongholdDefense },
        provinceTargeting: {
            ...DEFAULT_PROFILE.provinceTargeting,
            abilityPriority: { ...DEFAULT_PROFILE.provinceTargeting.abilityPriority },
            effectiveStrengthById: { ...DEFAULT_PROFILE.provinceTargeting.effectiveStrengthById },
            priorityTierById: { ...DEFAULT_PROFILE.provinceTargeting.priorityTierById }
        },
        provinceRevealResponse: {
            ...DEFAULT_PROFILE.provinceRevealResponse,
            onRevealValueById: { ...DEFAULT_PROFILE.provinceRevealResponse.onRevealValueById },
            fallbackValueByAbility: { ...DEFAULT_PROFILE.provinceRevealResponse.fallbackValueByAbility }
        },
        attachmentControl: {
            ...DEFAULT_PROFILE.attachmentControl,
            ownDebuffScores: { ...DEFAULT_PROFILE.attachmentControl.ownDebuffScores },
            enemyAttachmentScores: { ...DEFAULT_PROFILE.attachmentControl.enemyAttachmentScores }
        },
        personalHonor: { ...DEFAULT_PROFILE.personalHonor },
        duelBidding: { ...DEFAULT_PROFILE.duelBidding },
        drawBidding: { ...DEFAULT_PROFILE.drawBidding },
        legacyDrawBidding: { ...DEFAULT_PROFILE.legacyDrawBidding }
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
        profile.conflictPlanning = { ...RUSH_CONFLICT_PHASE_PLANNER };
        profile.mulligan = {
            ...RUSH_MULLIGAN_PROFILE,
            openingKeepHoldingIds: [...RUSH_MULLIGAN_PROFILE.openingKeepHoldingIds],
            openingKeepConflictIds: [...RUSH_MULLIGAN_PROFILE.openingKeepConflictIds],
            openingDiscardCharacterIds: [...RUSH_MULLIGAN_PROFILE.openingDiscardCharacterIds],
            preferredCharacterIds: [...RUSH_MULLIGAN_PROFILE.preferredCharacterIds],
            endHoldingLimit: { ...RUSH_MULLIGAN_PROFILE.endHoldingLimit },
            holdingCopyLimitById: { ...RUSH_MULLIGAN_PROFILE.holdingCopyLimitById },
            keepHoldingIds: [...RUSH_MULLIGAN_PROFILE.keepHoldingIds],
            keepDynastyCardIds: [...RUSH_MULLIGAN_PROFILE.keepDynastyCardIds]
        };
        profile.aggressiveFate = true;
        profile.boardAwareDynasty = {
            ...RUSH_BOARD_AWARE_DYNASTY,
            minimumCharactersByRound: [...RUSH_BOARD_AWARE_DYNASTY.minimumCharactersByRound],
            characterValueById: { ...RUSH_BOARD_AWARE_DYNASTY.characterValueById }
        };
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
        profile.duelBidding = {
            ...profile.duelBidding,
            objective: 'honor',
            duelWinUtility: 6,
            duelLossUtility: 4,
            honorRaceUtility: 1.5
        };
        // Phoenix still wins primarily through conflicts and card tempo.
        profile.drawBidding = { ...CARD_ENGINE_DRAW_BID_PROFILE };
    }
    if(strategy.monk) {
        // Monk/card-engine deck: generic balanced attack/defense knobs stay;
        // the playstyle (play many cards, void recursion, Mitsu steering)
        // lives in the DragonTactics knobs.
        profile.dragon = { ...DRAGON_DEFAULTS };
        profile.drawBidding = { ...CARD_ENGINE_DRAW_BID_PROFILE };
        profile.legacyDrawBidding = { ...DRAGON_LEGACY_DRAW_BID_PROFILE };
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
        profile.duelBidding = {
            ...profile.duelBidding,
            objective: 'honor',
            duelWinUtility: 6.5,
            duelLossUtility: 4.5,
            honorRaceUtility: 1.5
        };
        profile.drawBidding = { ...HONOR_DRAW_BID_PROFILE };
        // Duel decks have balanced axes and can profitably avoid the exact
        // opposing duel/pump suite. Rush and card-count decks must keep their
        // specialized conflict type even when the hidden hand looks scary.
        profile.useOmniscientConflictAxis = true;
        profile.omniscientAttackResponseBuffer = 1;
        profile.useOmniscientTokenDefense = true;
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
        profile.drawBidding = {
            ...CARD_ENGINE_DRAW_BID_PROFILE,
            // Ring-control cards make ring fate unusually accessible.
            ringFateConversion: 0.85
        };
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true
        };
        profile.omniscientAttackResponseBuffer = 1;
    }
    if(strategy.rebirth) {
        // Applied AFTER the shugenja overlay above, because the Fushicho deck
        // runs Kyuden Isawa too and needs the spell package with different
        // economics on top: no fate banked on bodies, and no Tadaka tower to
        // save up for.
        profile.rebirth = {
            ...REBIRTH_DEFAULTS,
            recursionValueById: { ...REBIRTH_DEFAULTS.recursionValueById },
            phoenixCharacterIds: [...REBIRTH_DEFAULTS.phoenixCharacterIds],
            uniqueCharacterIds: [...REBIRTH_DEFAULTS.uniqueCharacterIds],
            persistentCharacterIds: [...REBIRTH_DEFAULTS.persistentCharacterIds],
            ringPayoffsByElement: { ...REBIRTH_DEFAULTS.ringPayoffsByElement },
            ringHandPayoffsByElement: { ...REBIRTH_DEFAULTS.ringHandPayoffsByElement },
            unclaimedGuardsByElement: { ...REBIRTH_DEFAULTS.unclaimedGuardsByElement },
            printedSkillsById: { ...REBIRTH_DEFAULTS.printedSkillsById },
            bentenBowPriority: [...REBIRTH_DEFAULTS.bentenBowPriority],
            searchValueById: { ...REBIRTH_DEFAULTS.searchValueById }
        };
        // Every body is meant to die at the end of the round, so banking fate on
        // one is the opposite of the plan; the rotation wants the fate spent on
        // the NEXT body instead. `preferDeckAdditionalFate` keeps the shared
        // economy asking the deck tactics for the amount, which RebirthTactics
        // answers with zero.
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true,
            // The default passes the window after one 4+ cost purchase, which
            // suits a deck saving up for a tower. This one has no tower: every
            // spare fate should become another zero-fate body, because a body
            // that reaches the discard is worth as much there as in play.
            passAfterDurable: false,
            // Fushicho's printed 6 must fit inside the early-round durable cap.
            durableSpendCapEarly: 9,
            // Nothing is ever decorated with fate, so the additional-fate caps
            // only exist to bound what RebirthTactics asks for (zero).
            durableAdditionalFateEarly: 0,
            durableAdditionalFateLate: 0,
            bodyAdditionalFateForCostThree: 0
        };
        // The engine burns through the dynasty deck rather than the conflict
        // deck, and Kyuden Isawa/Forebearer's Echoes both replay from discards,
        // so raw card volume is worth less here than honor is.
        profile.drawBidding = { ...CARD_ENGINE_DRAW_BID_PROFILE };
    }
    if(strategy.attachmentTower) {
        profile.attachmentTower = {
            ...DRAGON_ATTACHMENT_DEFAULTS,
            stackableAttachments: [...DRAGON_ATTACHMENT_DEFAULTS.stackableAttachments]
        };
        profile.drawBidding = { ...TOWER_DRAW_BID_PROFILE };
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
        profile.drawBidding = { ...DISHONOR_DRAW_BID_PROFILE };
        profile.legacyDrawBidding = { ...DISHONOR_LEGACY_DRAW_BID_PROFILE };
        profile.duelBidding = {
            ...profile.duelBidding,
            objective: 'dishonor',
            duelWinUtility: 3.5,
            duelLossUtility: 2.5,
            honorSwingUtility: 1.15,
            opponentLowHonorUtility: 2
        };
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true
        };
    }
    if(strategy.bidWar) {
        // Honor-dial deck: it BUYS its own honor loss. Bidding high pays the
        // opponent honor, and that is the point — 6 or fewer honor is where
        // Shadow Stalker, Alibi Artist and the Kyuden Bayushi ready bonus turn
        // on, and being less honorable is what switches on Forgery and
        // Beautiful Entertainer. Every knob that would "protect" honor
        // therefore has to be relaxed, not tightened.
        profile.bidWar = {
            ...BID_WAR_DEFAULTS,
            kachikoImportantCharacterIds: [...BID_WAR_DEFAULTS.kachikoImportantCharacterIds],
            reverseHonorCardIds: [...BID_WAR_DEFAULTS.reverseHonorCardIds]
        };
        // Cards are the resource this deck converts its honor into.
        profile.drawBidding = {
            ...CARD_ENGINE_DRAW_BID_PROFILE,
            // The generic rails bid 1 the moment honor drops under 6, which is
            // exactly the band this deck is trying to reach. Only genuine
            // lethal range should force the low bid; BidWarTactics.adjustDrawBid
            // owns everything above it.
            lowHonorThreshold: BID_WAR_DEFAULTS.lethalHonorFloor,
            // Chasing an honor victory is not this deck's plan and low-bidding
            // for it turns off half the card pool.
            honorWinSetupThreshold: 24
        };
        // Shosuro Sadako inverts the honor-status modifier, so a forced (or
        // deliberately paid) own-dishonor should land on her before anyone.
        profile.personalHonor = {
            ...profile.personalHonor,
            reverseHonorCardIds: [...BID_WAR_DEFAULTS.reverseHonorCardIds],
            // Both of these pay a friendly dishonor as their COST; the shared
            // enemy-first dishonor rule cancelled them otherwise.
            ownDishonorCostSourceIds: ['calling-in-favors', 'acclaimed-geisha-house']
        };
        // Turns on the live-dial readings in the shared playbook entries
        // (Make an Opening). Off for every other deck, so those entries keep
        // their legacy reading bit-identical.
        profile.bidWarAware = true;
        profile.honorRaceAware = true;
        // Duels move honor, and this deck starts them on purpose (Loyal
        // Challenger's Action, and Duty makes an opposing duel bid survivable).
        // Valuing the honor swing and the opponent's low honor instead of the
        // duel outcome alone measured +1.97pp and +1.05pp against its own null
        // on two independent six-base sets (1726 games per arm, +1.51pp
        // pooled), and dishonor is 46% of this deck's losses.
        profile.duelBidding = {
            ...profile.duelBidding,
            objective: 'dishonor',
            opponentLowHonorUtility: 2
        };
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true
        };
    }
    if(strategy.craneHonor) {
        // Applied AFTER the `duelist` overlay above, because Tsuma makes this
        // deck derive `duelist` too and the shared duel package's economy
        // (durable towers, deep fate) is the opposite of what an honor race
        // wants: width of cheap honored bodies, each of which pays 1 honor when
        // it dies.
        profile.craneHonor = {
            ...CRANE_HONOR_DEFAULTS,
            additionalFateByCharacterId: { ...CRANE_HONOR_DEFAULTS.additionalFateByCharacterId },
            honorTargetPriority: [...CRANE_HONOR_DEFAULTS.honorTargetPriority],
            hostTargetPriority: [...CRANE_HONOR_DEFAULTS.hostTargetPriority],
            hostTowerCardIds: [...CRANE_HONOR_DEFAULTS.hostTowerCardIds],
            saveCardIds: [...CRANE_HONOR_DEFAULTS.saveCardIds],
            airProvinceIds: [...CRANE_HONOR_DEFAULTS.airProvinceIds]
        };
        // Honor is the SCOREBOARD, not a resource: 25 wins outright, so the
        // race gates in the shared playbook have to be live.
        profile.honorRaceAware = true;
        // The higher bidder pays the difference to the lower one. For a deck
        // whose win condition IS honor that transfer is the game, and Way of
        // the Chrysanthemum doubles what we receive.
        profile.drawBidding = {
            ...HONOR_DRAW_BID_PROFILE,
            minimumRoutineBid: 1,
            // Effectively unconditional, the same shape as the fate-economy
            // profile: there is no honor total at which paying the opponent
            // honor is right for this deck.
            lowHonorThreshold: 20,
            honorPlanSelfThreshold: 12
        };
        // Duels here exist to force a NEW honor bid (Return the Offense, Make
        // Your Case), not to kill a body — losing one on a low bid is income.
        profile.duelBidding = {
            ...profile.duelBidding,
            objective: 'honor',
            duelWinUtility: 4,
            duelLossUtility: 3,
            honorRaceUtility: 3
        };
        // Tsuma plays its characters pre-honored, so a character sitting in it
        // is worth keeping through the fate phase over any holding.
        profile.mulligan = {
            ...profile.mulligan,
            honorProvinceCharacters: true
        };
        // Before the Throne and Tsuma cannot be the stronghold province by
        // printed text; Shameful Display's own Action is the one worth having
        // behind the last three breaks.
        profile.strongholdProvinceId = 'shameful-display';
        // The board is Courtiers; the Favor's political side is the one this
        // deck can actually hold and use.
        profile.imperialFavorChoice = 'political';
        // Conceding a province walks the opponent toward conquest, and this
        // deck needs the game to go LONG.
        profile.provinceConcede = { cardIds: [], maxOwnBrokenProvinces: 0 };
        profile.dynastyCostReducer = {
            cardId: 'those-who-serve',
            minimumCharacters: 2,
            minimumFate: 2
        };
        // Width over depth: the additional-fate answer comes from
        // CraneHonorTactics, which says 0 for every cheap Courtier.
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true,
            durableCharacterIds: ['doji-hotaru-2', 'hantei-sotorii', 'iron-crane-legion'],
            durableCostThreshold: 4,
            passAfterDurable: false,
            durableSpendCapEarly: Number.POSITIVE_INFINITY,
            durableSpendCapLate: Number.POSITIVE_INFINITY,
            durableAdditionalFateEarly: 3,
            durableAdditionalFateLate: 2,
            bodyMaxCost: 5,
            bodyAdditionalFateForCostThree: 0
        };
    }
    if(strategy.lionHonor) {
        profile.lionHonor = {
            ...LION_HONOR_DEFAULTS,
            additionalFateByCharacterId: { ...LION_HONOR_DEFAULTS.additionalFateByCharacterId },
            dynastyAbilityValueById: { ...LION_HONOR_DEFAULTS.dynastyAbilityValueById },
            toturiCardIds: [...LION_HONOR_DEFAULTS.toturiCardIds],
            toturiRingElements: [...LION_HONOR_DEFAULTS.toturiRingElements],
            towerCardIds: [...LION_HONOR_DEFAULTS.towerCardIds],
            honorTargetPriority: [...LION_HONOR_DEFAULTS.honorTargetPriority],
            magistrateCardIds: [...LION_HONOR_DEFAULTS.magistrateCardIds],
            battlefieldAttachmentCardIds: [...LION_HONOR_DEFAULTS.battlefieldAttachmentCardIds],
            battlefieldProvincePreference: [...LION_HONOR_DEFAULTS.battlefieldProvincePreference],
            battlefieldCardIds: [...LION_HONOR_DEFAULTS.battlefieldCardIds],
            proceduralInterferenceProvincePriority:
                [...LION_HONOR_DEFAULTS.proceduralInterferenceProvincePriority]
        };
        // Honor is the SCOREBOARD: 25 wins outright and 0 loses outright, so
        // the race gates in the shared playbook have to be live.
        profile.honorRaceAware = true;
        // The higher bidder pays the difference to the lower one, and Way of
        // the Chrysanthemum gains that difference AGAIN. Round 1 still bids for
        // a hand — this deck has to see its brakes early — and then lives at
        // the floor, which is also where Privileged Position turns on.
        profile.drawBidding = {
            ...HONOR_DRAW_BID_PROFILE,
            openingBid: 4,
            forceLowAfterOpening: true,
            lowBid: 1,
            minimumRoutineBid: 1,
            // Effectively unconditional: there is no honor total at which
            // paying the opponent honor is right for this deck.
            lowHonorThreshold: 20,
            honorPlanSelfThreshold: 12
        };
        // Duels are not this deck's plan, but a duel bid moves honor the same
        // way a draw dial does and losing one on a low bid is income.
        profile.duelBidding = {
            ...profile.duelBidding,
            objective: 'honor',
            duelWinUtility: 4,
            duelLossUtility: 3,
            honorRaceUtility: 3
        };
        // Kenson no Gakka: "after you LOSE a conflict at this province — honor
        // each defending character". Losing is the trigger, so the deck puts
        // its game-ending province behind the effect it most wants to fire, and
        // sizes the defense to stop the BREAK rather than to win.
        profile.strongholdProvinceId = LION_HONOR_DEFAULTS.honorProvinceId;
        profile.defenseCommitment = 'prevent-break';
        profile.spendCardsOnDefense = true;
        // "Go first in all cases" — the deck wants the first air ring and the
        // first Privileged Position.
        profile.firstPlayerChoice = 'first';
        // Conceding a province walks the opponent toward the conquest win that
        // is the only way this deck loses, and the game has to go LONG.
        profile.provinceConcede = { cardIds: [], maxOwnBrokenProvinces: 0 };
        // MEASURED, and against the board reading: the Favor's POLITICAL side
        // is worth +2.09pp on one six-base set and +2.60pp on a second,
        // independent one, even though the deck's raw skill is military
        // (Toturi 6, Bushido Adherent 4, Righteous Samurai 4). The reason is
        // that this deck DEFENDS: the opponent picks the axis, the Courtier
        // half of the board (Prodigy, Chronicler, Revered Ikoma, Ardent
        // Omoidasu, Steward of Law) is what meets a political attack, and the
        // field contests the political Favor less, so the deck holds it more.
        profile.imperialFavorChoice = 'political';
        // An unopposed defensive loss bleeds 1 honor, and honor is the
        // SCOREBOARD here, so a body thrown in front of a province that was
        // breaking anyway buys a point of the win condition. Measured +2.87pp
        // and +1.56pp on two independent six-base sets — and note this is the
        // OPPOSITE of the Crane honor race, where the same knob is -2.50pp
        // because that deck needs the body to attack with. Honor wins go
        // 151 -> 172 here.
        profile.chumpBlock = true;
        // Attack, but never at the cost of the stronghold province: Kyuden
        // Ikoma's own reaction only fires after an attack we LOSE, and every
        // loss this deck suffers is a conquest loss.
        profile.attackCommitment = 'all-but-one';
        profile.attackKeepHome = 1;
        profile.reserveDynastyFate = true;
        // Shared card packages. Both Kyuden Ikoma lists drive the same
        // stronghold reaction from here.
        profile.strongholdBow = {
            strongholdCardId: 'kyuden-ikoma',
            championCharacterIds: ['akodo-toturi'],
            towerCharacterIds: [...LION_HONOR_DEFAULTS.towerCardIds],
            requiresReadyTarget: true,
            skipsParticipants: true,
            minimumSkill: 1
        };
        profile.conflictRecursion = {
            sourceCardIds: ['kitsu-spiritcaller', 'forebearer-s-echoes'],
            minimumSkill: 2,
            gloryWeight: 0.5,
            fateWeight: 0
        };
        profile.dynastyEvents = {
            honorBushiCardIds: ['honored-veterans'],
            honorBushiMinimumGlory: 1,
            rerollCardIds: [],
            rerollMaxUsefulProvinceCards: 1,
            rerollMinimumFate: 2,
            alwaysPlayCardIds: ['procedural-interference'],
            alwaysPlayMaximumHonor: Number.POSITIVE_INFINITY
        };
        // Called to War asks the DEFENDER "give your opponent 1 honor for a fate
        // on one of your Bushi?". Honor is this deck's scoreboard AND the
        // trigger for the opposing Kyuden Ikoma list's "more honorable" gates,
        // so it never sells. Shared knob, not a Lion one.
        profile.personalHonor = {
            ...profile.personalHonor,
            honorGiftResponse: {
                ...profile.personalHonor.honorGiftResponse,
                enabled: false
            }
        };
        profile.commanderCharacterIds = ['honored-general'];
        profile.bushiCharacterIds = [
            'akodo-toturi', 'honored-general', 'bushido-adherent', 'righteous-samurai',
            'hero-of-three-trees', 'lion-s-pride-paragon', 'implacable-magistrate'
        ];
        // Width plus exactly one tower; the per-id amounts come from
        // LionHonorTactics and win through `preferDeckAdditionalFate`.
        profile.fateAwareEconomy = {
            ...profile.fateAwareEconomy,
            preferDeckCharacters: true,
            preferDeckAdditionalFate: true,
            passAfterDurable: false,
            durableCharacterIds: [...LION_HONOR_DEFAULTS.towerCardIds],
            durableCostThreshold: 4,
            durableAdditionalFateEarly: 2,
            durableAdditionalFateLate: 2,
            bodyMaxCost: 5,
            bodyAdditionalFateForCostThree: 0,
            bodyFateReserve: 1
        };
        // Tsuma-style pre-honored bodies do not exist here, but Kenson no Gakka
        // is worth keeping unbroken, and the two brakes must be in the opening
        // hand for the plan to work at all.
        profile.mulligan = {
            ...profile.mulligan,
            openingKeepConflictIds: [
                'privileged-position', 'way-of-the-chrysanthemum', 'voice-of-honor',
                'court-games', 'soul-beyond-reproach', 'command-respect'
            ],
            openingPaidConflictKeepLimit: 2,
            keepDynastyCardIds: ['honored-veterans', 'procedural-interference'],
            preferredCharacterIds: [
                'ikoma-prodigy', 'chronicler-of-conquests', 'revered-ikoma',
                'honored-general', 'bushido-adherent', 'hero-of-three-trees',
                'akodo-toturi'
            ]
        };
    }
    return profile;
}

// A named per-deck override: when `match` is true for the bot's deck, `apply` is
// merged over the strategy-derived profile. Matched by card contents + derived
// strategy so it works in both live play and self-play (no deck-id needed).
type DeckProfileOverride = Omit<Partial<DeckProfile>,
    'strongholdDefense' | 'provinceTargeting' | 'duelBidding' | 'drawBidding' | 'legacyDrawBidding' | 'mulligan' | 'boardAwareDynasty' | 'conflictDeckSafety' | 'conflictPlanning' | 'conflictIntents'> & {
    strongholdDefense?: Partial<StrongholdDefenseProfile>;
    provinceTargeting?: Omit<Partial<ProvinceTargetingProfile>, 'abilityPriority' | 'effectiveStrengthById' | 'priorityTierById'> & {
        abilityPriority?: Partial<ProvinceTargetingProfile['abilityPriority']>;
        effectiveStrengthById?: Record<string, number>;
        priorityTierById?: Record<string, number>;
    };
    duelBidding?: Partial<DuelBidProfile>;
    drawBidding?: Partial<DrawBidProfile>;
    legacyDrawBidding?: Partial<LegacyDrawBidProfile>;
    mulligan?: Omit<Partial<MulliganProfile>,
        'endHoldingLimit' | 'holdingCopyLimitById'> & {
        endHoldingLimit?: Partial<MulliganProfile['endHoldingLimit']>;
        holdingCopyLimitById?: Record<string, number>;
    };
    boardAwareDynasty?: Omit<Partial<BoardAwareDynastyProfile>,
        'characterValueById' | 'minimumCharactersByRound'> & {
        characterValueById?: Record<string, number>;
        minimumCharactersByRound?: number[];
    };
    conflictDeckSafety?: Omit<Partial<ConflictDeckSafetyProfile>,
        'forcedDrawsByOpponentCardId' | 'forcedHonorLossByOpponentCardId'> & {
        forcedDrawsByOpponentCardId?: Record<string, number>;
        forcedHonorLossByOpponentCardId?: Record<string, number>;
    };
    conflictPlanning?: Partial<ConflictPhasePlannerProfile>;
    conflictActionPlan?: Partial<ConflictActionProfile>;
    // Per-deck tuning of the shipped round-one fate floor. Merged field by
    // field, so an override naming only `setupAdditionalFate` keeps the
    // shipped rounds — and keeps the SKIP half off, which no deck may enable.
    saveFatePass?: Partial<SaveFatePassProfile>;
    // Last-resort conflict spending, per deck. Field-wide this is negative;
    // only decks that replicated on fresh bases carry it.
    aggressiveSpend?: Partial<AggressiveSpendProfile>;
    // `rules` replaces wholesale — a deck owns its declaration policy outright
    // rather than inheriting half of another deck's list.
    conflictIntents?: Omit<Partial<ConflictIntentProfile>, 'rules' | 'defenseRules'> & {
        rules?: DeckConflictIntentRule[];
        defenseRules?: DeckDefenseIntentRule[];
    };
};

interface ProfileOverride {
    name: string;
    match: (cardIds: Set<string>, strategy: DeckStrategy) => boolean;
    apply: DeckProfileOverride;
}

const OVERRIDES: ProfileOverride[] = [
    {
        // Unicorn Reveal (EmeraldDB 6057d28e): reveal all four outer
        // provinces (and the hidden stronghold province when an effect can),
        // turn those flips into Shiro Shinjo income, then either buy durable
        // military bodies or spend four on the Scouted Terrain surprise.
        name: 'unicorn-reveal-shiro-shinjo',
        match: (ids) => ids.has('shiro-shinjo') && ids.has('scouted-terrain') && ids.has('aranat'),
        apply: {
            strongholdProvinceId: 'massing-at-twilight',
            forceMilitaryConflict: true,
            attackCommitment: 'all-but-one',
            attackKeepHome: 1,
            reserveDynastyFate: true,
            provinceTargeting: {
                preferFacedown: true,
                // Printed/effective values used by defense/break planning. The
                // attack sorter still puts facedown targets first for this deck.
                effectiveStrengthById: {
                    // This profile forces military declarations, so use its
                    // printed 5 here; the live engine reports 10 only during a
                    // political conflict.
                    'ancestral-lands': 5,
                    'appealing-to-the-fortunes': 5,
                    'border-fortress': 4,
                    'khan-s-ordu': 4,
                    'massing-at-twilight': 8
                }
            },
            fateAwareEconomy: {
                ...DEFAULT_FATE_AWARE_ECONOMY,
                preferDeckCharacters: true,
                preferDeckAdditionalFate: true,
                durableCharacterIds: [
                    'aranat', 'yoritomo', 'moto-chagatai', 'higashi-kaze-company',
                    'moto-horde', 'white-horde-vanguard', 'kudaka',
                    'iuchi-daiyu', 'khanbulak-benefactor'
                ],
                passAfterDurable: false,
                durableSpendCapEarly: 10,
                bodySpendCapEarly: 7,
                bodySpendCapLate: 7,
                bodySpendCapWithPersistent: 6,
                bodyMaxCost: 6,
                bodyAdditionalFateForCostThree: 1,
                bodyFateReserve: 1
            },
            boardAwareDynasty: {
                characterValueById: {
                    aranat: 8,
                    yoritomo: 7,
                    'higashi-kaze-company': 7,
                    'moto-chagatai': 7,
                    'khanbulak-benefactor': 7,
                    'iuchi-daiyu': 6,
                    kudaka: 6,
                    'white-horde-vanguard': 6,
                    'moto-horde': 6,
                    'iuchi-farseer': 5,
                    'way-station-trader': 4,
                    'shinjo-trailblazer': 4,
                    'ganzu-warrior': 4
                }
            },
            // Shiro Shinjo pays this deck in FATE, not cards, so the card-engine
            // bid was buying draw it did not need at 1-2 honor per round.
            drawBidding: { ...FATE_ECONOMY_DRAW_BID_PROFILE },
            mulligan: {
                openingHoldingLimit: 1,
                openingKeepHoldingIds: ['audience-chamber'],
                keepHoldingIds: ['audience-chamber'],
                holdingCopyLimitById: { 'audience-chamber': 1 },
                preferredCharacterIds: [
                    'iuchi-farseer', 'shinjo-trailblazer', 'way-station-trader',
                    'ganzu-warrior', 'khanbulak-benefactor', 'iuchi-daiyu',
                    'white-horde-vanguard', 'yoritomo', 'aranat'
                ],
                openingKeepConflictIds: ['good-omen', 'scouted-terrain', 'i-am-ready'],
                openingPaidConflictKeepLimit: 1,
                endHoldingLimit: { weak: 1, developing: 1, strong: 1 },
                discardCheapOnDevelopingBoard: false,
                discardCheapOnStrongBoard: false
            },
            unicornReveal: {
                ...UNICORN_REVEAL_DEFAULTS,
                revealSourceIds: [...UNICORN_REVEAL_DEFAULTS.revealSourceIds],
                redirectSourceIds: [...UNICORN_REVEAL_DEFAULTS.redirectSourceIds],
                firstConflictCharacterIds: [...UNICORN_REVEAL_DEFAULTS.firstConflictCharacterIds],
                unrevealedProvinceAttackerIds: [...UNICORN_REVEAL_DEFAULTS.unrevealedProvinceAttackerIds],
                additionalFateByCharacterId: { ...UNICORN_REVEAL_DEFAULTS.additionalFateByCharacterId },
                provinceTextPriorityById: { ...UNICORN_REVEAL_DEFAULTS.provinceTextPriorityById }
            }
        }
    },
    {
        // Dragon Arsenal (EmeraldDB 46aaa220): the political +5 province is
        // the hardest final target; the rest of the playstyle is data-gated
        // by Iron Mountain Castle in DragonAttachmentTactics.
        name: 'dragon-attachments-ancestral-lands',
        match: (ids, strategy) => strategy.attachmentTower && ids.has('ancestral-lands'),
        apply: {
            strongholdProvinceId: 'ancestral-lands',
            boardAwareDynasty: {
                urgentTowerAdditionalFate: 2,
                fullPlannerAtUrgent: false,
                secondPlayerDeficitPlanner: false
            },
            reserveDynastyFate: true,
            attackCommitment: 'all-but-one',
            attackKeepHome: 1,
            chumpBlock: true,
            defenseSkillBuffer: 2,
            mulligan: {
                openingHoldingLimit: 0,
                preferredCharacterIds: [
                    'niten-master',
                    'togashi-yokuni',
                    'agasha-sumiko-2',
                    'mirumoto-raitsugu'
                ],
                endHoldingLimit: { weak: 0, developing: 1, strong: 2 }
            }
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
            strongholdProvinceId: 'vassal-fields',
            // This ring/spell deck needs conflict opportunities more than an
            // early one-body reserve. Require a 50% larger two-province threat
            // before preserving its attacker; final-stronghold defense is
            // unchanged. Historical omniscient A/B: +6.7 pp vs Unicorn, +2.5 pp vs
            // Crane/Lion, neutral vs Scorpion/Dragon Attachments.
            strongholdDefense: {
                preStrongholdThreatRatio: 1.5,
                // Complete event modeling made the old full-hand value turtle:
                // Display/Five Fires are powerful but not raw skill pumps.
                // Reserve a small margin while keeping the exact disable gate.
                omniscientHandThreatWeight: 0.25,
                omniscientDefenderDisables: true
            },
            mulligan: {
                openingHoldingLimit: 1,
                preferredCharacterIds: [
                    'asako-togama',
                    'kudaka',
                    'prodigy-of-the-waves',
                    'isawa-ujina',
                    'shiba-tsukune'
                ],
                endHoldingLimit: { weak: 1, developing: 2, strong: 2 }
            }
        }
    },
    {
        // Phoenix "Phoenix" (EmeraldDB 7b7f54b8): the Fushicho rotation. It runs
        // Kyuden Isawa too, so the shugenja overlay above already applied and
        // this retunes it for a deck whose bodies are meant to die:
        //
        //  * Retire to the Brotherhood goes under the stronghold. It is the one
        //    province here that is both legal there (Kakudaira, City of the Rich
        //    Frog and Kuroi Mori all forbid it) and a genuine punisher: its
        //    on-reveal wipes every FATELESS character on both boards. Ours are
        //    fateless on purpose and are replaced free from the top of the deck;
        //    the opponent's final all-in is usually paid for and is not.
        //  * The Tadaka disguise reserve is dropped to nothing. Banking two or
        //    three fate on a base contradicts the rotation, and the shared
        //    economy asks the deck tactics for the number.
        //  * Shugenja ring steering is switched off (`ringCardBonus: 0`) so the
        //    element preference has exactly one owner, RebirthTactics.ringBonus.
        //    The ring lists stay populated because `immediateRingScore` — which
        //    gates Display of Power — reads them through a different knob.
        name: 'phoenix-phoenix-fushicho-rotation',
        match: (ids, strategy) => strategy.rebirth && ids.has('retire-to-the-brotherhood'),
        apply: {
            strongholdProvinceId: 'retire-to-the-brotherhood',
            // Bodies rotate every round, so there is never a tower to preserve
            // and holding one back only shrinks the attack. Keep one home
            // defender; the recursion refills the board next round anyway.
            attackCommitment: 'all-but-one',
            attackKeepHome: 1,
            // MEASURED, and the opposite of what every other deck here wants.
            // `prevent-break` bows bodies to save a province; this deck would
            // rather keep them ready, because its bodies are disposable and its
            // only route back into a game is winning conflicts of its own.
            //
            // +3.93pp over 1437 games (20.86% -> 24.79%), positive on BOTH
            // independent base sets (+2.50pp on 91001-96001, +5.35pp on
            // 120001-125001), z=1.78. It concedes more unopposed conflicts and
            // therefore bleeds MORE honor — dishonor is 18.4% of its losses —
            // and still wins, because the conquest gain is larger.
            defenseCommitment: 'win-only',
            spendCardsOnDefense: true,
            // `chumpBlock` is deliberately absent: it lives on the prevent-break
            // path, so under win-only it measured bit-identical (718 games).
            // Same for `attackCommitment: 'breakable-or-pressure'`,
            // `attackKeepHome: 2` and `preventBreakAfterBrokenProvinces: 2`.
            boardAwareDynasty: {
                // The generic catch-up planner decorates its pick with
                // persistence (extra fate), which is exactly what the rotation
                // does not want.
                persistenceDecoratorEnabled: false,
                fullPlannerAtUrgent: false,
                secondPlayerDeficitPlanner: false
            },
            shugenja: {
                ...SHUGENJA_DEFAULTS,
                ringCardBonus: 0,
                towerIds: ['fushicho', 'isawa-tsuke-2', 'asako-azunami', 'isawa-tadaka-2', 'kudaka'],
                shugenjaIds: [
                    'asako-azunami', 'ethereal-dreamer', 'inferno-guard-invoker',
                    'isawa-heiko', 'isawa-tadaka-2', 'isawa-tsuke-2', 'kudaka',
                    'miya-mystic', 'solemn-scholar', 'young-philosopher'
                ],
                waterIds: ['asako-azunami', 'feral-ningyo'],
                airIds: ['kudaka'],
                voidIds: [],
                // Only these two remain legal Disguise bases here (non-unique
                // Shugenja). Adept/Prodigy of the Waves are not in this list.
                disguiseTargets: {
                    'young-philosopher': 2,
                    'ethereal-dreamer': 1,
                    'solemn-scholar': 1,
                    'miya-mystic': 2,
                    'inferno-guard-invoker': 4
                },
                spellPriority: [
                    'display-of-power', 'forebearer-s-echoes', 'my-ancestor-s-strength',
                    'walking-the-way', 'clarity-of-purpose', 'against-the-waves',
                    'supernatural-storm', 'benten-s-touch', 'assassination', 'banzai'
                ],
                // Kyuden's cost is a Spell discarded from HAND. Protect the two
                // recursion engines and the province trade; everything else is
                // cheap enough to throw.
                protectedDiscardIds: [
                    'display-of-power', 'forebearer-s-echoes', 'my-ancestor-s-strength'
                ],
                kyudenSpellIds: [
                    'against-the-waves', 'benten-s-touch', 'clarity-of-purpose',
                    'display-of-power', 'forebearer-s-echoes', 'my-ancestor-s-strength',
                    'supernatural-storm', 'walking-the-way'
                ],
                // Replay targets out of the conflict discard, priced at printed
                // cost. Walking the Way is absent on purpose: replaying a
                // province dig mid-conflict wins nothing.
                kyudenActionCosts: {
                    'against-the-waves': 1,
                    'benten-s-touch': 0,
                    'clarity-of-purpose': 1,
                    'forebearer-s-echoes': 2,
                    'my-ancestor-s-strength': 1,
                    'supernatural-storm': 0
                }
            },
            mulligan: {
                openingHoldingLimit: 1,
                openingKeepHoldingIds: ['forgotten-library', 'ancestral-shrine'],
                keepHoldingIds: ['forgotten-library', 'ancestral-shrine'],
                openingKeepConflictIds: [
                    'forebearer-s-echoes', 'my-ancestor-s-strength',
                    'walking-the-way', 'display-of-power'
                ],
                preferredCharacterIds: [
                    'fushicho',
                    'isawa-tsuke-2',
                    'asako-azunami',
                    'inferno-guard-invoker',
                    'kudaka',
                    'isawa-heiko'
                ],
                keepDynastyCardIds: ['a-season-of-war'],
                endHoldingLimit: { weak: 1, developing: 2, strong: 2 }
            }
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
            strongholdDefense: {
                omniscientHandThreatWeight: 0.25,
                omniscientDefenderDisables: true
            },
            omniscientAttackResponseBuffer: 1,
            boardAwareDynasty: {
                fullPlannerAtUrgent: false,
                secondPlayerDeficitPlanner: false
            },
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
            digMinBoardCharacters: 3,
            // Last-resort conflict spending, CRAB ONLY. The shared intent
            // filter closes ~15 windows a game holding a card the engine says
            // is legal and affordable; forcing the best of them is null across
            // the field (-1.07pp) but positive for this deck specifically.
            //
            //   six-base screen (200001-205001)   41.1% -> 45.8%   +4.7pp
            //   40 games/opponent, 20 FRESH bases 41.1% -> 45.0%   +3.91pp
            //                                     54 flips to / 29 away, p=0.008
            //                                     positive on 15 of 20 bases
            //
            // Broad rather than one matchup: Lion +10/-0, Unicorn +8/-3,
            // Crane +5/-0. `minPriority: 9` also replicates (+3.28pp, p=0.019)
            // and is the weaker of the two. Only `crab-defense` carries this —
            // CrabSacrifice measured -3.1pp and matches a different override.
            // See `docs/bot-fate-starvation.md`.
            aggressiveSpend: {
                enabled: true,
                minPriority: 5,
                fateReserve: 0,
                maxPerRound: 1,
                attackOnly: false
            },
            // Cheap-body ring raid: cap an attack that cannot break at ONE
            // body and send the WEAKEST contributing one. The ring's fate goes
            // to the attacker at declaration win or lose, so the cheap body
            // buys the same fate and the good bodies stay ready.
            //
            // SHIPPED ON A NULL CONFIRMATION, on top of the aggressiveSpend
            // above (which is what its control carried):
            //   six-base screen (270001-275001)  46.9% -> 52.6%   +5.7pp p=0.035
            //   40 games/opponent, 20 FRESH bases 46.7% -> 47.3%  +0.63pp,
            //                                     39 to / 35 away, p=0.73
            // The +5.7 did not survive. What IS established is the ordering:
            // the same cap sending the STRONGEST body measured -5.2pp p=0.031
            // for this deck, so `hopelessAttackWeakestFirst` is load-bearing —
            // never enable the cap without it.
            conflictPlanning: {
                hopelessAttackKeepHome: 99,
                hopelessAttackReach: 0,
                hopelessAttackWeakestFirst: true
            },
            mulligan: {
                openingHoldingLimit: 2,
                openingKeepHoldingIds: [
                    'seventh-tower',
                    'kaiu-forges',
                    'watchtower-of-valor',
                    'northern-curtain-wall',
                    'third-whisker-warrens',
                    'river-of-the-last-stand',
                    'watchtower-of-sun-s-shadow'
                ],
                preferredCharacterIds: [
                    'hida-kisada',
                    'frontline-engineer',
                    'kaiu-shuichi',
                    'kuni-ritsuko',
                    'midnight-builder'
                ],
                keepHoldingIds: [
                    'seventh-tower',
                    'kaiu-forges',
                    'watchtower-of-valor',
                    'northern-curtain-wall',
                    'third-whisker-warrens',
                    'river-of-the-last-stand',
                    'watchtower-of-sun-s-shadow'
                ],
                endHoldingLimit: { weak: 2, developing: 3, strong: 3 },
                discardCheapOnDevelopingBoard: false
            }
        }
    },
    {
        // Unicorn "Cavalry Rush" precon (EmeraldDB ef93bae2). The pure rush
        // (concede every defense, disposable 0-1-fate bodies, commit every
        // body) was tuned in a historical omniscient mirror and got rolled by the Crane
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
            // Cavalry can move/ready after declaration, so preserving its
            // historical one-point known-response margin and safe token block
            // costs less tempo than it does for Lion's committed swarm.
            omniscientAttackResponseBuffer: 1,
            useOmniscientTokenDefense: true,
            fateAwareEconomy: { ...SWARM_FATE_AWARE_ECONOMY },
            conflictCardEconomy: { ...SWARM_CONFLICT_CARD_ECONOMY },
            drawBidding: { ...CARD_ENGINE_DRAW_BID_PROFILE },
            mulligan: {
                openingHoldingLimit: 1,
                // This deck needs one movement engine more than four random
                // free cards. Extra paid cards still cycle normally.
                openingPaidConflictKeepLimit: 1,
                openingKeepConflictIds: [
                    'spyglass',
                    'shiksha-scout',
                    'adorned-barcha',
                    'utaku-battle-steed',
                    'shinomen-wayfinders'
                ],
                endHoldingLimit: { weak: 0, developing: 1, strong: 1 }
            },
            unicorn: {
                ...UNICORN_DEFAULTS,
                movementCardIds: [...UNICORN_DEFAULTS.movementCardIds],
                gaijinCardIds: [...UNICORN_DEFAULTS.gaijinCardIds],
                singletonAttachments: [...UNICORN_DEFAULTS.singletonAttachments]
            }
        }
    },
    {
        // Upgraded Crane Duels (EmeraldDB e2e443b5): Vassal Fields under the
        // stronghold — its action drains 1 of the attacker's fate in every
        // conflict fought there, exactly on the final push.
        name: 'crane-duel-vassal-fields',
        match: (ids, strategy) => strategy.duelist && ids.has('vassal-fields'),
        apply: {
            strongholdProvinceId: 'vassal-fields',
            // Last-resort conflict spending at the top priority band. SHIPPED
            // ON A NULL CONFIRMATION — read the numbers before trusting it:
            //   six-base screen (200001-205001)  39.1% -> 42.7%   +3.6pp
            //   40 games/opponent, 20 FRESH bases 41.7% -> 42.5%  +0.78pp,
            //                                     47 to / 42 away, p=0.67
            // The deep retest is indistinguishable from zero, so this is a
            // judgement call taken on the mildly positive point estimate, NOT
            // a measured win. Field-wide the same arm is -0.34pp. If this deck
            // is ever re-tuned, treat the slot as empty rather than as
            // established. See `docs/bot-fate-starvation.md`.
            aggressiveSpend: {
                enabled: true,
                minPriority: 9,
                fateReserve: 0,
                maxPerRound: 1,
                attackOnly: false
            },
            boardAwareDynasty: {
                fullPlannerAtUrgent: false,
                secondPlayerDeficitPlanner: false
            },
            mulligan: {
                honorProvinceCharacters: true,
                openingDiscardCharacterIds: ['iron-crane-legion'],
                preferredCharacterIds: [
                    'kakita-kaezin',
                    'kakita-yuri',
                    'doji-kuwanan',
                    'kakita-toshimoko'
                ],
                endHoldingLimit: { weak: 0, developing: 2, strong: 2 },
                holdingCopyLimitById: { 'kakita-dojo': 1, 'proving-ground': 1 }
            }
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
            preventBreakAfterBrokenProvinces: 2,
            mulligan: {
                openingHoldingLimit: 0,
                preferredCharacterIds: [
                    'togashi-mitsu-2',
                    'togashi-tadakatsu',
                    'togashi-ichi',
                    'teacher-of-empty-thought',
                    'tranquil-philosopher'
                ],
                endHoldingLimit: { weak: 0, developing: 1, strong: 2 }
            }
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
            strongholdProvinceId: 'rally-to-the-cause',
            useOmniscientConflictAxis: false,
            useOmniscientProvinceKnowledge: false,
            omniscientEarthRingThreatBonus: 35,
            // Phoenix's durable glory bodies and holdings already have a
            // specialized seed-1 buyer. The generic catch-up planner bought
            // too many disposable bodies (15-25 in the fresh paired gate), so
            // board-aware seed decorates its chosen body with persistence but does not
            // replace that buyer during deficit/stronghold states.
            boardAwareDynasty: {
                fullPlannerAtUrgent: false,
                secondPlayerDeficitPlanner: false
            },
            mulligan: {
                openingHoldingLimit: 1,
                openingKeepHoldingIds: [
                    'forgotten-library',
                    'the-imperial-palace',
                    'favorable-ground'
                ],
                preferredCharacterIds: [
                    'shiba-tsukune',
                    'isawa-kaede',
                    'isawa-ujina',
                    'isawa-atsuko',
                    'prodigy-of-the-waves',
                    'chikai-order-protector',
                    'solemn-scholar',
                    'asako-tsuki'
                ],
                keepHoldingIds: [
                    'forgotten-library',
                    'the-imperial-palace',
                    'favorable-ground'
                ],
                endHoldingLimit: { weak: 1, developing: 2, strong: 2 },
                discardCheapOnDevelopingBoard: false
            }
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
                durableCharacterIds: [...LION_DEFAULTS.towerCharacters]
            },
            conflictCardEconomy: { ...SWARM_CONFLICT_CARD_ECONOMY },
            duelBidding: {
                objective: 'honor',
                duelWinUtility: 5.5,
                honorRaceUtility: 1.5
            },
            drawBidding: { ...HONOR_DRAW_BID_PROFILE },
            legacyDrawBidding: { ...LION_LEGACY_DRAW_BID_PROFILE },
            mulligan: {
                openingHoldingLimit: 0,
                keepDynastyCardIds: ['honored-veterans', 'a-season-of-war'],
                endHoldingLimit: { weak: 0, developing: 1, strong: 1 }
            },
            lion: { ...LION_DEFAULTS }
        }
    },
    {
        // Lion Duelist (EmeraldDB a2058c37, Kyuden Ikoma). Honor is the SWITCH:
        // Matsu Tsuko's free break, Matsu Agetoki's conflict move, Matsu
        // Mitsuko's move-in and Blade of 10,000 Battles all require "more
        // honorable than your opponent", and the stronghold starts at 13 honor
        // to make that the default state. So the deck bids into the honor lead
        // rather than for cards (which also fires Tactician's Apprentice) and
        // buys its cards back with Regal Bearing, Setting the Standard, Blade,
        // Imperial Storehouse, Proving Ground and The Art of War.
        name: 'lion-duelist-kyuden-ikoma',
        match: (ids, strategy) => strategy.lionDuelist && ids.has('kyuden-ikoma'),
        apply: {
            // Deck-guide directive: Frostbitten Crossing sits under the
            // stronghold. Its 4 strength makes the game-deciding province the
            // joint-hardest to break, and its Action is a conflict-only effect
            // that a defended stronghold conflict can still cash in.
            strongholdProvinceId: 'frostbitten-crossing',
            // "Go first in all cases" — the deck wants the first break and the
            // first Regal Bearing.
            firstPlayerChoice: 'first',
            reserveDynastyFate: true,
            attackCommitment: 'all-but-one',
            attackKeepHome: 1,
            defenseCommitment: 'prevent-break',
            spendCardsOnDefense: true,
            // Honor is a live resource here in both directions: it turns five
            // cards on, and 25 is a real second win condition for a deck that
            // gains honor from every low dial and every Ikoma Prodigy.
            honorRaceAware: true,
            fateAwareEconomy: {
                ...DEFAULT_FATE_AWARE_ECONOMY,
                preferDeckCharacters: true,
                preferDeckAdditionalFate: true,
                passAfterDurable: false,
                durableCharacterIds: [...LION_DUELIST_DEFAULTS.towerCharacters],
                durableAdditionalFateEarly: 2,
                bodySpendCapEarly: 6,
                bodySpendCapLate: 5,
                bodySpendCapWithPersistent: 4,
                bodyMaxCost: 5,
                // Ikoma Prodigy is bought WITH a fate on purpose (its reaction
                // pays 1 honor for it), which this generic knob already covers
                // for cost-3 bodies; the per-id amounts live in the tactics
                // module and win through `preferDeckAdditionalFate`.
                bodyAdditionalFateForCostThree: 1,
                bodyOrder: 'highest-cost',
                bodyFateReserve: 1
            },
            boardAwareDynasty: {
                characterValueById: {
                    'matsu-tsuko-2': 9,
                    'akodo-toturi': 9,
                    'matsu-mitsuko': 7,
                    'matsu-agetoki': 7,
                    'kitsu-motso': 6,
                    'akodo-zentaro': 6,
                    'kitsu-spiritcaller': 5,
                    'keeper-initiate': 4,
                    'miya-mystic': 4,
                    'ikoma-prodigy': 3,
                    'tactician-s-apprentice': 3
                }
            },
            // Bid 5 in the opening round (the deck needs a hand), then live low:
            // a low dial gains honor from the higher bidder, fires Tactician's
            // Apprentice, and keeps the "more honorable" switch on.
            drawBidding: {
                ...HONOR_DRAW_BID_PROFILE,
                openingBid: 5,
                forceLowAfterOpening: true,
                lowBid: 1,
                minimumRoutineBid: 1,
                honorPlanSelfThreshold: 15
            },
            // Duels here are a bowing tool (Duelist Training, True Strike), not
            // an honor engine — the loser bows whatever the bid was, and honor
            // flows to the LOWER bidder, which is where this deck wants to be.
            duelBidding: {
                objective: 'honor',
                duelWinUtility: 5,
                honorRaceUtility: 1.5
            },
            mulligan: {
                openingHoldingLimit: 1,
                openingKeepHoldingIds: ['imperial-storehouse', 'proving-ground'],
                keepHoldingIds: ['imperial-storehouse', 'proving-ground'],
                keepDynastyCardIds: ['honored-veterans', 'a-season-of-war'],
                preferredCharacterIds: [
                    'ikoma-prodigy', 'matsu-agetoki', 'matsu-mitsuko',
                    'kitsu-motso', 'akodo-toturi', 'matsu-tsuko-2',
                    'tactician-s-apprentice'
                ],
                openingKeepConflictIds: [
                    'regal-bearing', 'fan-of-command', 'in-service-to-my-lord',
                    'even-the-odds', 'blade-of-10-000-battles'
                ],
                openingPaidConflictKeepLimit: 1,
                endHoldingLimit: { weak: 0, developing: 1, strong: 2 },
                // Keeper Initiate is worth strictly more in the dynasty discard
                // than in a province: its reaction puts it into play from there
                // with a free fate every time we claim the air ring, and the
                // Keeper of Air role makes that a routine event.
                endPhaseDiscardCardIds: ['keeper-initiate']
            },
            // Shared card packages, set to this deck's own previously
            // hard-coded values so the extraction into `SharedCardTactics` is
            // bit-identical. See `LionHonorTactics` for the second consumer.
            strongholdBow: {
                strongholdCardId: 'kyuden-ikoma',
                championCharacterIds: [...LION_DUELIST_DEFAULTS.championCharacters],
                towerCharacterIds: [...LION_DUELIST_DEFAULTS.towerCharacters],
                requiresReadyTarget: LION_DUELIST_DEFAULTS.strongholdBowRequiresReadyTarget,
                skipsParticipants: LION_DUELIST_DEFAULTS.strongholdBowSkipsParticipants,
                minimumSkill: LION_DUELIST_DEFAULTS.strongholdBowMinimumSkill
            },
            conflictRecursion: {
                sourceCardIds: ['kitsu-spiritcaller', 'forebearer-s-echoes'],
                minimumSkill: LION_DUELIST_DEFAULTS.recursionMinimumSkill,
                gloryWeight: LION_DUELIST_DEFAULTS.recursionGloryWeight,
                fateWeight: LION_DUELIST_DEFAULTS.recursionFateWeight
            },
            dynastyEvents: {
                honorBushiCardIds: ['honored-veterans'],
                honorBushiMinimumGlory: LION_DUELIST_DEFAULTS.honoredVeteransMinimumGlory,
                rerollCardIds: ['a-season-of-war'],
                rerollMaxUsefulProvinceCards: LION_DUELIST_DEFAULTS.seasonOfWarMaxUsefulProvinceCards,
                rerollMinimumFate: LION_DUELIST_DEFAULTS.seasonOfWarMinimumFate,
                alwaysPlayCardIds: [],
                alwaysPlayMaximumHonor: Number.POSITIVE_INFINITY
            },
            commanderCharacterIds: [...LION_DUELIST_DEFAULTS.commanderCharacters],
            bushiCharacterIds: [...LION_DUELIST_DEFAULTS.bushiCharacters],
            lionDuelist: { ...LION_DUELIST_DEFAULTS }
        }
    },
    {
        // Crab "Berserker Sacrifice" (EmeraldDB 59c4d29f, Castle of the
        // Forgotten). A rush deck whose resource is BODIES, not fate: it buys
        // the widest possible board of cheap high-military characters at zero
        // fate and then spends the surplus as a cost. Castle of the Forgotten
        // turns every conflict military after the first break, which is the
        // whole board, so the axis is never in question.
        //
        // The honor pool is a consumable here — Spreading the Darkness pays 2,
        // declaring Unleashed Experiment pays 2 — so the deck must race, and it
        // bids for CARDS early (bodies and pumps both come from the hand) then
        // drops to protect the honor total once the board is wide.
        name: 'crab-sacrifice-castle-of-the-forgotten',
        match: (ids, strategy) => strategy.crabSacrifice && ids.has('castle-of-the-forgotten'),
        apply: {
            // Deck-guide directive. The Eternal Watch's Action bows an attacker
            // (or takes an honor) and stays legal on the game-deciding
            // province; Fortified Assembly literally cannot go here.
            strongholdProvinceId: 'the-eternal-watch',
            // "Go first in all cases. This deck wants to try and break and get
            // advantage early."
            firstPlayerChoice: 'first',
            // Essentially every body is military-only, and the stronghold makes
            // all conflicts military after the first break anyway.
            forceMilitaryConflict: true,
            imperialFavorChoice: 'military',
            // MEASURED, 672 games over 12 bases. This deck's honor problem is a
            // TEMPO problem: every body held back is a conflict not ended, and
            // the game then runs long enough for the dial to bleed it out.
            // `all` + `win-only` together were worth +7.4pp, and they compound
            // with the low dial below (+16.1pp on the search bases, +10.1pp on
            // six fresh ones). Keeping a body home (`attackKeepHome: 2`)
            // measured BIT-IDENTICAL — the knob is inert under `all`.
            attackCommitment: 'all',
            attackKeepHome: 0,
            // Bowing bodies to save a province is the wrong trade for a deck
            // that has to close: +3.6pp on its own.
            defenseCommitment: 'win-only',
            // Still worth spending cards on a defence we can actually WIN;
            // switching this off cost 2.7pp.
            spendCardsOnDefense: true,
            // Zero-fate width is the plan; per-id amounts live in the tactics
            // module and win through `preferDeckAdditionalFate`.
            aggressiveFate: true,
            reserveDynastyFate: false,
            // Honor is spent on purpose here, and 0 honor is a loss, so the
            // race has to be tracked in both directions.
            honorRaceAware: true,
            // The shared veto refuses every non-character card while none of
            // our participants is ready, on the premise that a buff on a bowed
            // body is wasted. This deck EMPTIES its own board on purpose — it
            // sacrifices participants as a cost — and its saves, its recursion
            // attachment and Way of the Crab all still work from that state.
            // The default 'defense' scope is not enough because the deck spends
            // most of its windows attacking.
            conflictPlanning: { readyEffectIgnoresReadyParticipant: 'always' },
            // Those Who Serve. Previously read off `CrabSacrificeProfile`; now a
            // shared knob because the Crane Courtier Honor list runs the card
            // too. The values are the ones this deck was measured with, so the
            // move is bit-identical here.
            dynastyCostReducer: {
                cardId: 'those-who-serve',
                minimumCharacters: 2,
                minimumFate: 2
            },
            fateAwareEconomy: {
                ...DEFAULT_FATE_AWARE_ECONOMY,
                preferDeckCharacters: true,
                preferDeckAdditionalFate: true,
                prioritizeBodies: true,
                passAfterDurable: false,
                durableCharacterIds: ['repentant-legion', 'mercenary-company'],
                durableAdditionalFateEarly: 1,
                durableAdditionalFateLate: 0,
                bodySpendCapEarly: 8,
                bodySpendCapLate: 7,
                bodySpendCapWithPersistent: 6,
                bodyMaxCost: 5,
                // Damned Hida is cost 3 and must stay DIRE to be 6 military, so
                // the generic "put a fate on cost-3 bodies" rule is wrong here.
                bodyAdditionalFateForCostThree: 0,
                bodyOrder: 'highest-cost',
                bodyFateReserve: 0
            },
            boardAwareDynasty: {
                characterValueById: {
                    'repentant-legion': 9,
                    'mercenary-company': 8,
                    'butcher-of-the-fallen': 7,
                    'tainted-hero': 6,
                    'damned-hida': 6,
                    'fifth-tower-watch': 5,
                    'vengeful-berserker': 5,
                    'steadfast-witch-hunter': 5,
                    'one-of-the-forgotten': 4,
                    'unleashed-experiment': 4,
                    'gallant-quartermaster': 3,
                    'kaiu-envoy': 3,
                    'silent-skirmisher': 2
                }
            },
            // The deck needs CARDS — every pump, every save and every sacrifice
            // outlet is a conflict card — but it also spends honor freely, so
            // the dial drops off the opening once the board is built. A hard
            // floor keeps it out of the self-inflicted dishonor loss that the
            // Kyuden Bayushi list found the hard way.
            // THE deck's biggest single lever, +12.8pp on its own. The HIGHER
            // bidder pays the honor difference, and this list starts at 10 and
            // spends more on Spreading the Darkness and on every Unleashed
            // Experiment declaration. Bidding into the field was handing away
            // the honor it then lost on: dishonor losses fell 158 -> 66.
            //
            // Note the shape of the mistake this replaces. Capping the deck's
            // CARD honor costs instead (an honor floor on Unleashed Experiment
            // and Spreading the Darkness) measured −6.5pp and made dishonor
            // losses WORSE — it throttled the offence rather than the leak.
            // `forceLowAfterOpening: true` on top of this was also worse
            // (43.75% vs 46.43%): the opening hand still has to be bought.
            drawBidding: {
                ...DEFAULT_DRAW_BID_PROFILE,
                objective: 'cards',
                openingBid: 5,
                minimumRoutineBid: 1,
                lowBid: 1,
                lowHonorThreshold: 8
            },
            mulligan: {
                // "make sure it has characters on it and not holding during
                // mulligan and end phase" — Shinsei's Last Hope discounts
                // characters played from it by 2, so a holding sitting there is
                // the worst card in the deck.
                openingHoldingLimit: 1,
                keepDynastyCardIds: ['those-who-serve'],
                preferredCharacterIds: [
                    'repentant-legion', 'mercenary-company', 'butcher-of-the-fallen',
                    'tainted-hero', 'damned-hida', 'vengeful-berserker',
                    'one-of-the-forgotten', 'unleashed-experiment'
                ],
                openingKeepConflictIds: [
                    'banzai', 'spreading-the-darkness', 'way-of-the-crab',
                    'those-who-serve', 'battle-meditation', 'sharpened-tsuruhashi'
                ],
                openingPaidConflictKeepLimit: 1,
                endHoldingLimit: { weak: 0, developing: 1, strong: 1 }
            },
            crabSacrifice: { ...CRAB_SACRIFICE_DEFAULTS }
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
            boardAwareDynasty: {
                fullPlannerAtUrgent: false,
                secondPlayerDeficitPlanner: false
            },
            mulligan: {
                honorProvinceCharacters: true,
                openingDiscardCharacterIds: ['iron-crane-legion'],
                preferredCharacterIds: [
                    'kakita-kaezin',
                    'kakita-yuri',
                    'doji-kuwanan',
                    'kakita-toshimoko',
                    'kakita-yoshi-2'
                ],
                endHoldingLimit: { weak: 0, developing: 2, strong: 2 },
                holdingCopyLimitById: { 'kakita-dojo': 1, 'proving-ground': 1 }
            },
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
            boardAwareDynasty: {
                persistenceDecoratorEnabled: false,
                fullPlannerAtUrgent: false,
                secondPlayerDeficitPlanner: false
            },
            fateAwareEconomy: {
                ...SWARM_FATE_AWARE_ECONOMY,
                preferDeckCharacters: true,
                preferDeckAdditionalFate: true,
                deferPassForDynastyActions: true,
                durableCharacterIds: [...LION_DEFAULTS.towerCharacters]
            },
            conflictCardEconomy: { ...SWARM_CONFLICT_CARD_ECONOMY },
            duelBidding: {
                objective: 'honor',
                duelWinUtility: 5.5,
                honorRaceUtility: 1.5
            },
            drawBidding: { ...HONOR_DRAW_BID_PROFILE },
            legacyDrawBidding: { ...LION_LEGACY_DRAW_BID_PROFILE },
            mulligan: {
                openingHoldingLimit: 0,
                keepDynastyCardIds: ['honored-veterans', 'a-season-of-war'],
                endHoldingLimit: { weak: 0, developing: 1, strong: 1 }
            },
            lion: { ...LION_DEFAULTS }
        }
    },
    {
        // Scorpion "Poison Mill": Night Raid goes under the stronghold. The
        // stronghold province is only attackable after 3 others break, so the
        // opponent's final all-in push reveals it and discards X cards from
        // their hand (X = attackers) — exactly when they commit everything.
        // Scorpion "Bid War" (EmeraldDB 2bf73f61). Kyuden Bayushi identifies
        // the list uniquely; the strategy flag already installed the honor-dial
        // package, so this only carries the setup/mulligan facts that are
        // specific to these 40 cards.
        name: 'scorpion-bid-war',
        match: (ids, strategy) => strategy.bidWar && ids.has('kyuden-bayushi'),
        apply: {
            // Honor's Reward is the deck's strongest province (5 strength with
            // the Earth role's +2 landing on Upholding Authority instead) and
            // its Action needs a FIRE province, which it supplies itself. Under
            // the stronghold it is the last thing an opponent has to break.
            strongholdProvinceId: 'honor-s-reward',
            mulligan: {
                // Two holdings are real engines here (Imperial Storehouse
                // sacrifices for a card, Acclaimed Geisha House switches the
                // contested ring), but a turn-one hand wants COURTIERS: every
                // dial payoff in the deck needs one participating.
                openingHoldingLimit: 1,
                openingKeepHoldingIds: ['imperial-storehouse', 'acclaimed-geisha-house'],
                keepHoldingIds: ['imperial-storehouse', 'acclaimed-geisha-house'],
                holdingCopyLimitById: { 'imperial-storehouse': 1, 'acclaimed-geisha-house': 1 },
                preferredCharacterIds: [
                    'bayushi-manipulator', 'loyal-challenger', 'court-novice',
                    'alibi-artist', 'beautiful-entertainer', 'blackmail-artist',
                    'social-puppeteer', 'yogo-asami', 'bayushi-kachiko-2'
                ],
                // Regal Bearing is the card-advantage engine and Elegant Tessen
                // readies a cheap courtier for a second conflict; Forgery is the
                // cancel this deck almost always has turned on.
                openingKeepConflictIds: [
                    'regal-bearing', 'elegant-tessen', 'forgery', 'shosuro-sadako'
                ],
                openingPaidConflictKeepLimit: 2,
                endHoldingLimit: { weak: 1, developing: 1, strong: 2 }
            },
            boardAwareDynasty: {
                characterValueById: {
                    'bayushi-kachiko-2': 9,
                    'social-puppeteer': 7,
                    'loyal-challenger': 6,
                    'blackmail-artist': 6,
                    'yogo-asami': 6,
                    'shadow-stalker': 5,
                    cursecatcher: 5,
                    'bayushi-manipulator': 5,
                    'alibi-artist': 4,
                    'beautiful-entertainer': 4,
                    'court-novice': 3
                }
            }
        }
    },
    {
        name: 'scorpion-poison-mill',
        match: (ids, strategy) => strategy.dishonor && ids.has('night-raid'),
        apply: {
            strongholdProvinceId: 'night-raid',
            boardAwareDynasty: {
                persistenceDecoratorEnabled: false,
                fullPlannerAtUrgent: false,
                secondPlayerDeficitPlanner: false
            },
            mulligan: {
                openingHoldingLimit: 0,
                preferredCharacterIds: [
                    'bayushi-shoju-2',
                    'bayushi-manipulator',
                    'shosuro-actress'
                ],
                keepHoldingIds: ['licensed-quarter'],
                endHoldingLimit: { weak: 0, developing: 1, strong: 2 }
            }
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
            const {
                strongholdDefense,
                provinceTargeting,
                duelBidding,
                drawBidding,
                legacyDrawBidding,
                mulligan,
                boardAwareDynasty,
                conflictDeckSafety,
                conflictPlanning,
                conflictIntents,
                ...flatApply
            } = override.apply;
            const apply: Partial<DeckProfile> = { ...flatApply };
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
            if(override.apply.bidWar) {
                apply.bidWar = {
                    ...override.apply.bidWar,
                    kachikoImportantCharacterIds: [...override.apply.bidWar.kachikoImportantCharacterIds],
                    reverseHonorCardIds: [...override.apply.bidWar.reverseHonorCardIds]
                };
            }
            if(override.apply.lion) {
                apply.lion = {
                    ...override.apply.lion,
                    strongholdReadyTargets: [...override.apply.lion.strongholdReadyTargets],
                    towerCharacters: [...override.apply.lion.towerCharacters],
                    strongReadyTargets: [...override.apply.lion.strongReadyTargets],
                    cheapCharacters: [...override.apply.lion.cheapCharacters],
                    bushiCharacters: [...override.apply.lion.bushiCharacters],
                    forgeAttachmentRanking: [...override.apply.lion.forgeAttachmentRanking],
                    setupAttachmentPriority: [...override.apply.lion.setupAttachmentPriority]
                };
            }
            if(override.apply.unicorn) {
                apply.unicorn = {
                    ...override.apply.unicorn,
                    movementCardIds: [...override.apply.unicorn.movementCardIds],
                    gaijinCardIds: [...override.apply.unicorn.gaijinCardIds],
                    singletonAttachments: [...override.apply.unicorn.singletonAttachments]
                };
            }
            if(override.apply.unicornReveal) {
                apply.unicornReveal = {
                    ...override.apply.unicornReveal,
                    revealSourceIds: [...override.apply.unicornReveal.revealSourceIds],
                    redirectSourceIds: [...override.apply.unicornReveal.redirectSourceIds],
                    firstConflictCharacterIds: [...override.apply.unicornReveal.firstConflictCharacterIds],
                    unrevealedProvinceAttackerIds: [...override.apply.unicornReveal.unrevealedProvinceAttackerIds],
                    additionalFateByCharacterId: {
                        ...override.apply.unicornReveal.additionalFateByCharacterId
                    },
                    provinceTextPriorityById: {
                        ...override.apply.unicornReveal.provinceTextPriorityById
                    }
                };
            }
            if(override.apply.lionDuelist) {
                apply.lionDuelist = {
                    ...override.apply.lionDuelist,
                    towerCharacters: [...override.apply.lionDuelist.towerCharacters],
                    commanderCharacters: [...override.apply.lionDuelist.commanderCharacters],
                    championCharacters: [...override.apply.lionDuelist.championCharacters],
                    bushiCharacters: [...override.apply.lionDuelist.bushiCharacters],
                    winIsBreakCharacterIds: [...override.apply.lionDuelist.winIsBreakCharacterIds],
                    attachmentRanking: [...override.apply.lionDuelist.attachmentRanking],
                    keyCharacters: [...override.apply.lionDuelist.keyCharacters],
                    additionalFateByCharacterId: {
                        ...override.apply.lionDuelist.additionalFateByCharacterId
                    },
                    holdingValueById: { ...override.apply.lionDuelist.holdingValueById },
                    duelAxes: { ...override.apply.lionDuelist.duelAxes }
                };
            }
            if(override.apply.strongholdBow) {
                apply.strongholdBow = {
                    ...override.apply.strongholdBow,
                    championCharacterIds: [...override.apply.strongholdBow.championCharacterIds],
                    towerCharacterIds: [...override.apply.strongholdBow.towerCharacterIds]
                };
            }
            if(override.apply.conflictRecursion) {
                apply.conflictRecursion = {
                    ...override.apply.conflictRecursion,
                    sourceCardIds: [...override.apply.conflictRecursion.sourceCardIds]
                };
            }
            if(override.apply.dynastyEvents) {
                apply.dynastyEvents = {
                    ...override.apply.dynastyEvents,
                    honorBushiCardIds: [...override.apply.dynastyEvents.honorBushiCardIds],
                    rerollCardIds: [...override.apply.dynastyEvents.rerollCardIds],
                    alwaysPlayCardIds: [...override.apply.dynastyEvents.alwaysPlayCardIds]
                };
            }
            if(override.apply.commanderCharacterIds) {
                apply.commanderCharacterIds = [...override.apply.commanderCharacterIds];
            }
            if(override.apply.bushiCharacterIds) {
                apply.bushiCharacterIds = [...override.apply.bushiCharacterIds];
            }
            if(override.apply.crabSacrifice) {
                apply.crabSacrifice = {
                    ...override.apply.crabSacrifice,
                    sacrificeTier1: [...override.apply.crabSacrifice.sacrificeTier1],
                    sacrificeTier2: [...override.apply.crabSacrifice.sacrificeTier2],
                    tierPenalty: [...override.apply.crabSacrifice.tierPenalty],
                    sacrificeOutletIds: [...override.apply.crabSacrifice.sacrificeOutletIds],
                    saveHoldingIds: [...override.apply.crabSacrifice.saveHoldingIds],
                    saveAttachmentIds: [...override.apply.crabSacrifice.saveAttachmentIds],
                    saveEventIds: [...override.apply.crabSacrifice.saveEventIds],
                    taintedHeroIds: [...override.apply.crabSacrifice.taintedHeroIds],
                    direCharacterIds: [...override.apply.crabSacrifice.direCharacterIds],
                    declareCostsHonorIds: [...override.apply.crabSacrifice.declareCostsHonorIds],
                    passFateCharacterIds: [...override.apply.crabSacrifice.passFateCharacterIds],
                    mercenaryTakeoverIds: [...override.apply.crabSacrifice.mercenaryTakeoverIds],
                    doublingCharacterIds: [...override.apply.crabSacrifice.doublingCharacterIds],
                    berserkerIds: [...override.apply.crabSacrifice.berserkerIds],
                    skillOutletIds: [...override.apply.crabSacrifice.skillOutletIds],
                    butcherIds: [...override.apply.crabSacrifice.butcherIds],
                    pumpValueById: { ...override.apply.crabSacrifice.pumpValueById },
                    honorCostById: { ...override.apply.crabSacrifice.honorCostById },
                    additionalFateByCharacterId: {
                        ...override.apply.crabSacrifice.additionalFateByCharacterId
                    }
                };
            }
            if(strongholdDefense) {
                apply.strongholdDefense = {
                    ...profile.strongholdDefense,
                    ...strongholdDefense
                };
            }
            if(provinceTargeting) {
                apply.provinceTargeting = {
                    ...profile.provinceTargeting,
                    ...provinceTargeting,
                    abilityPriority: {
                        ...profile.provinceTargeting.abilityPriority,
                        ...provinceTargeting.abilityPriority
                    },
                    effectiveStrengthById: {
                        ...profile.provinceTargeting.effectiveStrengthById,
                        ...provinceTargeting.effectiveStrengthById
                    },
                    priorityTierById: {
                        ...profile.provinceTargeting.priorityTierById,
                        ...provinceTargeting.priorityTierById
                    }
                };
            }
            if(duelBidding) {
                apply.duelBidding = {
                    ...profile.duelBidding,
                    ...duelBidding
                };
            }
            if(drawBidding) {
                apply.drawBidding = {
                    ...profile.drawBidding,
                    ...drawBidding
                };
            }
            if(legacyDrawBidding) {
                apply.legacyDrawBidding = {
                    ...profile.legacyDrawBidding,
                    ...legacyDrawBidding
                };
            }
            if(mulligan) {
                apply.mulligan = {
                    ...profile.mulligan,
                    ...mulligan,
                    openingKeepHoldingIds: mulligan.openingKeepHoldingIds
                        ? [...mulligan.openingKeepHoldingIds]
                        : [...profile.mulligan.openingKeepHoldingIds],
                    openingKeepConflictIds: mulligan.openingKeepConflictIds
                        ? [...mulligan.openingKeepConflictIds]
                        : [...profile.mulligan.openingKeepConflictIds],
                    openingDiscardCharacterIds: mulligan.openingDiscardCharacterIds
                        ? [...mulligan.openingDiscardCharacterIds]
                        : [...profile.mulligan.openingDiscardCharacterIds],
                    preferredCharacterIds: mulligan.preferredCharacterIds
                        ? [...mulligan.preferredCharacterIds]
                        : [...profile.mulligan.preferredCharacterIds],
                    endHoldingLimit: {
                        ...profile.mulligan.endHoldingLimit,
                        ...mulligan.endHoldingLimit
                    },
                    holdingCopyLimitById: {
                        ...profile.mulligan.holdingCopyLimitById,
                        ...mulligan.holdingCopyLimitById
                    },
                    keepHoldingIds: mulligan.keepHoldingIds
                        ? [...mulligan.keepHoldingIds]
                        : [...profile.mulligan.keepHoldingIds],
                    keepDynastyCardIds: mulligan.keepDynastyCardIds
                        ? [...mulligan.keepDynastyCardIds]
                        : [...profile.mulligan.keepDynastyCardIds]
                };
            }
            if(boardAwareDynasty) {
                apply.boardAwareDynasty = {
                    ...profile.boardAwareDynasty,
                    ...boardAwareDynasty,
                    minimumCharactersByRound: boardAwareDynasty.minimumCharactersByRound
                        ? [...boardAwareDynasty.minimumCharactersByRound]
                        : [...profile.boardAwareDynasty.minimumCharactersByRound],
                    characterValueById: {
                        ...profile.boardAwareDynasty.characterValueById,
                        ...boardAwareDynasty.characterValueById
                    }
                };
            }
            if(conflictDeckSafety) {
                apply.conflictDeckSafety = {
                    ...profile.conflictDeckSafety,
                    ...conflictDeckSafety,
                    forcedDrawsByOpponentCardId: {
                        ...profile.conflictDeckSafety.forcedDrawsByOpponentCardId,
                        ...conflictDeckSafety.forcedDrawsByOpponentCardId
                    },
                    forcedHonorLossByOpponentCardId: {
                        ...profile.conflictDeckSafety.forcedHonorLossByOpponentCardId,
                        ...conflictDeckSafety.forcedHonorLossByOpponentCardId
                    }
                };
            }
            if(conflictPlanning) {
                apply.conflictPlanning = {
                    ...profile.conflictPlanning,
                    ...conflictPlanning
                };
            }
            if(conflictIntents) {
                apply.conflictIntents = {
                    ...profile.conflictIntents,
                    ...conflictIntents,
                    rules: (conflictIntents.rules || profile.conflictIntents.rules)
                        .map((rule) => ({ ...rule })),
                    defenseRules: (conflictIntents.defenseRules ||
                        profile.conflictIntents.defenseRules || []).map((rule) => ({ ...rule }))
                };
            }
            if(override.apply.attachmentControl) {
                apply.attachmentControl = {
                    ...override.apply.attachmentControl,
                    ownDebuffScores: { ...override.apply.attachmentControl.ownDebuffScores },
                    enemyAttachmentScores: { ...override.apply.attachmentControl.enemyAttachmentScores }
                };
            }
            if(override.apply.personalHonor) {
                apply.personalHonor = { ...override.apply.personalHonor };
            }
            if(override.apply.shugenja) {
                apply.shugenja = {
                    ...override.apply.shugenja,
                    towerIds: [...override.apply.shugenja.towerIds],
                    shugenjaIds: [...override.apply.shugenja.shugenjaIds],
                    waterIds: [...override.apply.shugenja.waterIds],
                    airIds: [...override.apply.shugenja.airIds],
                    voidIds: [...override.apply.shugenja.voidIds],
                    disguiseTargets: { ...override.apply.shugenja.disguiseTargets },
                    spellPriority: [...override.apply.shugenja.spellPriority],
                    protectedDiscardIds: [...override.apply.shugenja.protectedDiscardIds]
                };
            }
            if(override.apply.rebirth) {
                apply.rebirth = {
                    ...override.apply.rebirth,
                    recursionValueById: { ...override.apply.rebirth.recursionValueById },
                    phoenixCharacterIds: [...override.apply.rebirth.phoenixCharacterIds],
                    uniqueCharacterIds: [...override.apply.rebirth.uniqueCharacterIds],
                    persistentCharacterIds: [...override.apply.rebirth.persistentCharacterIds],
                    ringPayoffsByElement: { ...override.apply.rebirth.ringPayoffsByElement },
                    ringHandPayoffsByElement: { ...override.apply.rebirth.ringHandPayoffsByElement },
                    unclaimedGuardsByElement: { ...override.apply.rebirth.unclaimedGuardsByElement },
                    printedSkillsById: { ...override.apply.rebirth.printedSkillsById },
                    bentenBowPriority: [...override.apply.rebirth.bentenBowPriority],
                    searchValueById: { ...override.apply.rebirth.searchValueById }
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
            // Merged rather than replaced: `Object.assign` below would swap the
            // whole object, so an override tuning one field would silently drop
            // the shipped round-one floor from every deck that named it.
            if(override.apply.saveFatePass) {
                const base = profile.saveFatePass || SHIPPED_SAVE_FATE_PASS;
                apply.saveFatePass = {
                    ...base,
                    ...override.apply.saveFatePass,
                    setupRounds: [...(override.apply.saveFatePass.setupRounds || base.setupRounds)]
                };
            }
            // Filled from the defaults so an override naming a subset cannot
            // leave the rest undefined on a profile the policy will read.
            if(override.apply.aggressiveSpend) {
                apply.aggressiveSpend = {
                    ...DEFAULT_AGGRESSIVE_SPEND,
                    ...(profile.aggressiveSpend || {}),
                    ...override.apply.aggressiveSpend
                };
            }
            Object.assign(profile, apply);
            // Record which per-deck overrides matched. Bot V2 keys its own
            // deck-specific tuning off these names (docs/bot-v2-deck-tuning.md)
            // without having to re-derive the deck from its card list.
            profile.overrideNames = [...(profile.overrideNames || []), override.name];
        }
    }
    return profile;
}
