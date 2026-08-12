import type { CardHint } from './llm/CardHints';
import { getCardModel } from './DeckAnalysis.js';
import { isNegativeAttachmentId } from './AttachmentControlTactics.js';

/**
 * Hand-written per-card knowledge for the bot, keyed by printed card id.
 *
 * Entries share the CardHint shape (the policy consumes both through the same
 * lookup), so a playbook entry simply outranks whatever the LLM analysis
 * cached for the same card. On top of the hint fields it can carry:
 *
 * - `shouldPlay(ctx)`  — zone-neutral gate for normally playing the card,
 *   including paid plays from discard (e.g. Assassination only with honor to
 *   spare). Free put-into-play effects remain source-specific.
 * - `inPlayAction`     — the card has an Action ability worth clicking while
 *   it is on the board (holdings, attachments, characters). The policy
 *   clicks these during conflict windows after stronghold/province powers.
 * - `shouldUseAction(ctx)` — gate for that in-play click; illegal clicks are
 *   rejected by the engine without mutation, so gates only exist to avoid
 *   wasted clicks, not for legality.
 * - `actionBeforePass` — this utility Action must be considered before the
 *   conflict planner's "already breaking/safe, pass" shortcut.
 * - `dynastyAction`     — the card has an Action worth clicking during the
 *   dynasty action window (stronghold/holding/engineer digging). Only fired
 *   for decks whose derived strategy has `holdingEngine`.
 *
 * Curated for the decks the bot pilots (Unicorn cavalry precon, Crab Kaiu
 * Wall defense precon); grows per-deck as new decks get adopted.
 */

export interface PlaybookContext {
    conflictType: 'military' | 'political';
    losing: boolean;
    amAttacker: boolean;
    honor: number;
    myCharacters: any[];
    opponentCharacters: any[];
    dynastyDiscard: any[];
    // Optional extras (older callers omit them; gates must tolerate undefined).
    fate?: number;
    canPayHonor?: boolean; // dishonor decks: own honor is above the profile floor
    conflictDiscard?: any[]; // own conflict discard pile (weapon recursion gates)
    hand?: any[]; // own conflict hand (spell-recursion and setup gates)
    rings?: any[]; // live rings (ring-manipulation action gates)
    conflictProvinceElements?: string[]; // elements of the current conflict province(s), both sides
    // The elements of the RING the current conflict is being fought over. A
    // handful of cards read the conflict's element rather than the province's
    // (Bonsai Garden gains an honor "during an air conflict"), and the province
    // elements above cannot answer that — a fire ring can be contested at an
    // air province. It is a LIST because `Conflict.getSummary()` publishes one:
    // a ring added to a conflict contributes its element too, and the conflict
    // then counts as every element it carries. Empty outside a conflict.
    conflictRingElements?: string[];
    opponentHandSize?: number; // public hidden-card count for Tadaka's discard gate
    cardsPlayed?: number; // cards played this conflict (Dragon count-payoff gates)
    opponentCardsPlayed?: number; // Ichi counts cards played by both players
    moreCardsPlayable?: boolean; // a playable hand card remains (diagnostics/compatibility)
    conflictsRemaining?: number; // own future conflicts after the current one
    // Their future conflicts. "Is a ready body still worth anything?" cannot be
    // answered from our own count alone — a body readied with none of our own
    // conflicts left is still a DEFENDER for one of theirs.
    opponentConflictsRemaining?: number;
    // DeckProfile A/B switch, carried the same way `honorRaceAware` is because
    // a `PlaybookEntry` cannot see the profile. Off holds Elegance and Grace at
    // its legacy gate (any bowed honored body, whether or not anything can use
    // the ready).
    eleganceRequiresUse?: boolean;
    strongholdConflict?: boolean; // do not retreat from the game-ending defense
    preferFavorableRetreat?: boolean; // Dragon preserves its tower for another conflict
    conflictCosts?: Record<string, number>; // live printed costs for hand/discard cards
    canPlayConflictCard?: (card: any) => boolean; // shared normal-play intent gate for replay sources
    strengthNeeded?: number; // exact extra skill needed to break/save the attacked province
    winSkillNeeded?: number; // exact extra skill needed to win the current conflict
    allowStrengthOvercommit?: boolean; // Dragon card-count payoff exception
    clarityProtectedUuids?: string[]; // characters already protected by Clarity this conflict
    opponentParticipantCanBow?: boolean; // public board threat from a participating defender
    omniscient?: boolean; // optional capability has exact opposing-hand information
    opponentHasAffordableBowEffect?: boolean; // exact omniscient hand threat after fate check
    characterPrintedCosts?: Record<string, number>; // exact live printed cost by in-play character UUID
    liveCharacterCosts?: boolean; // false restores the curated-model-only targeting checks
    characterBaseMilitary?: Record<string, number>; // exact live base military by in-play character UUID
    participatingCharacterCounts?: { self: number; opponent: number }; // exact live count, including virtual participants
    cavalryCharacterUuids?: Record<string, true>; // live traits, including Utaku Battle Steed
    readyAfterMoveCharacterUuids?: Record<string, true>; // exact move-then-ready support
    conflictDeckConsumptionAllowed?: (amount: number) => boolean; // seed-1/3 own-deck/public-effect safety rail
    liveEventPricing?: boolean; // DeckProfile A/B: price events against the live board (see `priced`)
    liveEventPricingExclude?: readonly string[]; // card ids held at their legacy reading
    // The honor RACE. `honor` alone cannot answer "can I afford this cost?" —
    // reaching 0 loses immediately and reaching 25 wins immediately, and how
    // much honor is safe to burn depends on where the opponent sits and on how
    // close the conquest win is. Cards that compare the two pools ("while you
    // are less honorable than an opponent") cannot be gated at all without it.
    opponentHonor?: number;
    myBrokenProvinces?: number; // own broken outer provinces (4 = stronghold exposed)
    opponentBrokenProvinces?: number; // their broken outer provinces (conquest proximity)
    // DeckProfile A/B switch, carried on the context the same way
    // `liveEventPricing` is: `PlaybookEntry` is a static registry with no view
    // of the profile. Off holds every honor-race gate at its legacy reading so
    // a control arm stays bit-identical.
    honorRaceAware?: boolean;
    // Dynasty-discard characters carrying PRINTED stats. The serialized discard
    // pile in `dynastyDiscard` has empty skill summaries — the engine only fills
    // those for cards in play — so recursion cards cannot be priced from it.
    dynastyDiscardBodies?: any[];
    opponentFaceupNonStrongholdProvinces?: number;
    opponentFacedownNonStrongholdProvinces?: number;
    opponentStrongholdAttackable?: boolean;
    combinedConflictSkills?: boolean;
    // The VISIBLE honor dials (`player.showBid`), both sides. A whole deck
    // family reads the difference between them — I Can Swim needs ours
    // strictly higher, Make an Opening scales with |difference|, Regal Bearing
    // draws |1 - theirs| — and none of it was reachable from the playbook
    // before. Zero/undefined means "no dial shown yet" and every gate below
    // treats that as "do not spend the card".
    myBid?: number;
    opponentBid?: number;
    // The opponent's conflict discard pile. Bayushi Kachiko (Atonement) makes
    // the EVENTS in it playable as if they were in our hand during a political
    // conflict she participates in.
    opponentConflictDiscard?: any[];
    // Deck-profile switch, carried the same way `honorRaceAware` is: on for
    // the Kyuden Bayushi list, off (and therefore inert) everywhere else, so a
    // shared entry can gate a bid-war reading without touching other decks.
    bidWarAware?: boolean;
    // A conflict is live. Board Actions are offered in dynasty and draw
    // windows too, where "participating" gates cannot hold.
    activeConflict?: boolean;
    // Elements of the rings WE currently hold claimed. The serialized ring
    // carries `claimedBy` as a player NAME, which a playbook gate cannot
    // resolve, so the policy folds the comparison down to this list. Ikoma
    // Reservist is +2 military while we hold fire or water.
    myClaimedRingElements?: string[];
    // Whether an eligible unbroken province other than the contested one is
    // still available (Matsu Agetoki has somewhere to move the conflict TO).
    alternateProvincesAvailable?: number;
    // "if there is a Battlefield in play" (Chronicler of Conquests). Every
    // Battlefield in the field is either a HOLDING sitting in a province or an
    // ATTACHMENT hung on one, so neither `myCharacters` nor `hand` can answer
    // it — the same class of blind spot `conflictRingElements` fixed.
    battlefieldInPlay?: boolean;
}

export interface PlaybookEntry extends CardHint {
    inPlayAction?: boolean;
    actionBeforePass?: boolean;
    // Fire this board Action in a conflict-PHASE action window even when no
    // conflict is active (Adept grants Water-conflict Covert for the phase;
    // Meddling Mediator collects after the opponent declares two conflicts).
    conflictPhaseAction?: boolean;
    dynastyAction?: boolean;
    // Fire this in-play/dynasty action at most once per round — for unlimited
    // actions that reverse their own effect and would otherwise loop.
    oncePerRound?: boolean;
    // The card cannot (or should not) be played during a conflict — play it
    // from hand in a conflict-phase action window instead (Pacifism's
    // "Peaceful", Stolen Breath). Only fired for dishonor-profile decks.
    preConflict?: boolean;
    // Declaring this character as attacker/defender costs the controller
    // honor (Marauding Oni's forced reaction). Dishonor decks skip declaring
    // it while their honor sits at the floor.
    declareCostsHonor?: boolean;
    // The card's printed skill contribution is 0 but its granted ability is
    // the point (True Strike Kenjutsu's duel, Sashimono's no-bow) — play it
    // despite a zero stat contribution.
    abilityValue?: boolean;
    // The intent filter refuses every non-character card while none of our
    // participants is ready, because a bowed body contributes 0 skill
    // (`conflict.ts:474`) so a buff on it is wasted. That premise holds for
    // buffs and is exactly backwards for cards that ANSWER a bowed board:
    // effects that ready one of our participants, and effects that put a new
    // ready body into the conflict. "All my defenders are bowed" is the
    // situation Against the Waves exists for, and the veto refused it 105 times
    // per 90 games. Gated by
    // `ConflictPhasePlannerProfile.readyEffectIgnoresReadyParticipant`.
    worksWithoutReadyParticipant?: boolean;
    // Printed characters/attachments expose stats through controller hints.
    // Events do not, so pure/dynamic pumps inject their contribution here for
    // shared province-break budgeting.
    conflictContribution?: number | ((ctx: PlaybookContext) => number | null);
    // Number of cards this optional play/ability draws for its controller.
    // Modern conflict-deck safety uses this data to avoid a known five-honor
    // deck-exhaustion loss. Seed 2 preserves legacy behavior as an A/B control.
    optionalDrawCards?: number;
    // Cards removed from our conflict deck only when this card's optional
    // triggered ability is accepted. This gates the ability, not playing the
    // body itself (Shrine Maiden should still enter play on a thin deck).
    optionalAbilityConflictDeckCardsConsumed?: number;
    // For attachments whose ABILITY targets the enemy (targetSide 'enemy')
    // but which must be attached to an OWN character (True Strike Kenjutsu:
    // attach to our duelist, duel the enemy).
    attachSide?: 'self';
    // Some attachments replace an existing copy when attached to the same
    // bearer (Watch Commander is limit one per character). Keep this policy
    // metadata injectable instead of hard-coding the card in target selection.
    maxCopiesPerTarget?: number;
    // Engine legality may expose only a strategically harmful target. Require
    // the live action selector to expose a target on this entry's preferred
    // side before the bot clicks the source.
    requiresPreferredTarget?: boolean;
    shouldPlay?: (ctx: PlaybookContext) => boolean;
    shouldUseAction?: (ctx: PlaybookContext) => boolean;
}

// Deck-level strategy flags derived from the printed cards actually in the
// bot's deck. They gate deck-specific behaviors in the policy (mulligan,
// dynasty digging, cautious attacking) so that decks WITHOUT these cards —
// e.g. the aggressive Unicorn precon — keep the exact generic behavior.
export interface DeckStrategy {
    // Wall/holding engine: mulligan provinces toward holdings, dig with the
    // stronghold and holding actions, never discard holdings from provinces.
    holdingEngine: boolean;
    // Defensive: keep bodies home to defend and only commit an attack that can
    // actually break the province.
    defensive: boolean;
    // Aggressive military rush: deploy characters with 0-1 fate, commit every
    // body to the attack, force conflicts to military, and concede defenses to
    // keep bodies ready for the next attack. The whole plan is to break
    // provinces faster than the opponent, racing the game to 2-3 turns.
    aggressive: boolean;
    // Dishonor/mill: win by driving the opponent to 0 honor — bid low on draw
    // dials, use the shared duel matrix, take honor with the air ring, dishonor
    // enemy characters, mill their deck, and keep own honor low-but-alive.
    dishonor: boolean;
    // Glory/honor engine: build a persistent honored board (honored adds
    // glory to both skills), hold the Imperial Favor through glory counts,
    // and choose the contested ring from the cards in play.
    glory: boolean;
    // Monk/card-engine (Dragon): play many cheap cards per conflict to turn
    // on the cards-played payoffs around Togashi Mitsu.
    monk: boolean;
    // Duel-centric (upgraded Crane Duels): few durable honored duelists,
    // context-aware duel bids, payoffs on every resolved duel.
    duelist: boolean;
    // Phoenix spell/ring control: Kyuden Isawa recursion, Display of Power
    // province trades, ring manipulation, and Disguised Isawa Tadaka.
    shugenja: boolean;
    // Dragon attachment tower: Iron Mountain Castle, three Restricted slots,
    // deep-fate towers, attachment search, and Niten/Yokuni ready loops.
    attachmentTower: boolean;
    // Phoenix Fushicho rotation: buy big Phoenix bodies at ZERO fate, let them
    // die in the fate phase, and recur them out of the dynasty discard with
    // Fushicho's interrupt, Forebearer's Echoes and My Ancestor's Strength.
    // Combines with `shugenja` — the deck runs Kyuden Isawa as well.
    rebirth: boolean;
    // Kyuden Bayushi honor-dial control: bid into the low-honor band where the
    // deck's cards turn on, then convert the dial GAP into cards (Regal
    // Bearing), removal (I Can Swim) and debuffs (Make an Opening). Distinct
    // from `dishonor`, which drains the OPPONENT's honor; this deck spends its
    // own and lives on Duty.
    bidWar: boolean;
    // Kyuden Ikoma Lion: honor as a SWITCH. Five of its best effects read "if
    // you are more honorable than your opponent", so it bids low to accumulate
    // the lead, then converts conflict wins into free province breaks (Matsu
    // Tsuko), bowed enemies (the stronghold and two duel grants) and cards
    // (Blade of 10,000 Battles, Setting the Standard). Distinct from `duelist`,
    // which is the Crane Tsuma package, and from `aggressive`, which this deck
    // deliberately is not.
    lionDuelist: boolean;
    // Castle of the Forgotten Crab: a BODY IS A RESOURCE. Buys a wide board of
    // cheap high-military characters at zero fate, then spends the surplus as a
    // cost — Silent Skirmisher and Stoic Gunso turn one into skill, Weight of
    // Duty into a bowed+dishonored enemy, Way of the Crab into an enemy body,
    // Fulfill Your Duty into province strength — while Iron Mine, Reprieve and
    // Ceaseless Duty cancel the leave-play so the payoff comes for free.
    // Distinct from `aggressive` (which has no sacrifice economy) and from the
    // Kyuden Hida `defensive`/`holdingEngine` Crab precon.
    crabSacrifice: boolean;
    // Seven Fold Palace Crane: the HONOR RACE. It does not plan to break four
    // provinces — it plans to reach 25 honor, off a wide board of cheap honored
    // Courtiers (an honored character that leaves play pays 1 honor), the air
    // ring, the stronghold's 2-honor attacker reaction, and a set of per-card
    // faucets (Doji Hotaru, Honored Blade, Kakita Asami, Bonsai Garden, Way of
    // the Chrysanthemum). Distinct from `duelist`, which this deck also derives
    // through Tsuma, and from `glory`, which pumps skill rather than the track.
    craneHonor: boolean;
    // Kyuden Ikoma Lion, second list: the HONOR RACE. Same stronghold as
    // `lionDuelist` and the opposite plan — the duel list treats the honor lead
    // as a SWITCH that turns five other cards on, this one is racing to 25 off
    // air rings (doubled by Akodo Toturi), Before the Throne, Kenson no Gakka
    // honoring every defender, and a per-conflict faucet on almost every body,
    // while Privileged Position / Command Respect / Under Amaterasu's Gaze slow
    // the opponent down. Keyed on Kenson no Gakka, which the duel list does not
    // run, so the two are mutually exclusive.
    lionHonor: boolean;
}

const entry = (cardId: string, overrides: Partial<PlaybookEntry>): PlaybookEntry => Object.assign({
    cardId,
    useWhen: 'always' as const,
    conflictTypes: [],
    targetSide: 'none' as const,
    targetPreference: 'any' as const,
    priority: 5,
    summary: ''
}, overrides);

const participating = (cards: any[]) => cards.filter((card) => card.inConflict);
const readyParticipants = (cards: any[]) => cards.filter((card) => card.inConflict && !card.bowed);
const DRAGON_MONK_IDS = new Set([
    'ancient-master', 'teacher-of-empty-thought', 'togashi-acolyte',
    'togashi-ichi', 'togashi-initiate', 'togashi-mitsu-2',
    'togashi-tadakatsu', 'tranquil-philosopher', 'tattooed-wanderer'
]);
const hasMonkTrait = (card: any): boolean => DRAGON_MONK_IDS.has(card?.id) ||
    (Array.isArray(card?.traits) && card.traits.some((trait: string) => trait.toLowerCase() === 'monk')) ||
    (typeof card?.traits === 'string' && /\bmonk\b/i.test(card.traits));
const liveSkill = (card: any, axis: 'military' | 'political'): number => {
    const summary = axis === 'military' ? card?.militarySkillSummary : card?.politicalSkillSummary;
    const live = Number(summary?.stat);
    if(Number.isFinite(live)) {
        return live;
    }
    const printed = Number(card?.[axis]);
    return Number.isFinite(printed) ? printed : 0;
};
const characterValue = (card: any): number =>
    Math.max(liveSkill(card, 'military'), liveSkill(card, 'political')) +
    (Number(card?.fate) || 0) * 3 +
    (card?.attachments || []).length * 2;
const fiveFiresTarget = (card: any) => (Number(card.fate) || 0) > 0 &&
    !(card.attachments || []).some((attachment: any) =>
        attachment.id === 'pacifism' || attachment.id === 'stolen-breath');

// ---- live event pricing (DeckProfile.liveEventPricing) --------------------
//
// Characters and attachments reach the policy with printed skill attached, so
// `handContribution` knows what they add to a conflict. Events arrive with
// nothing, and only six of the sixty-one events in the bot field carried a
// `conflictContribution`, so the rest read as "unknown" and were invisible to
// province-break budgeting.
//
// `priced` wraps each model in the A/B switch. `legacy` is what the entry
// reported before — the old flat constant where there was one, null everywhere
// else — so the control arm is bit-identical to the previous build.
// A model returning `null` means "this card does something I am not pricing" —
// the reading every event had before — and leaves the card playable. That is the
// right answer for a branch whose payoff is not skill in THIS conflict: readying
// a body at home, taking the honor instead of the pump. Returning 0 instead
// would deny the play outright via `zero-contribution`.
const pricingOn = (ctx: PlaybookContext, cardId: string): boolean =>
    ctx.liveEventPricing === true && !ctx.liveEventPricingExclude?.includes(cardId);

const priced = (
    cardId: string,
    live: (ctx: PlaybookContext) => number | null,
    legacy: number | null | ((ctx: PlaybookContext) => number | null) = null
) => (ctx: PlaybookContext): number | null =>
    pricingOn(ctx, cardId)
        ? live(ctx)
        : (typeof legacy === 'function' ? legacy(ctx) : legacy);

// The same switch for a play gate that live pricing tightens.
const gated = (
    cardId: string,
    live: (ctx: PlaybookContext) => boolean,
    legacy: (ctx: PlaybookContext) => boolean
) => (ctx: PlaybookContext): boolean =>
    pricingOn(ctx, cardId) ? live(ctx) : legacy(ctx);

// Traits are present on every character the playbook sees (measured: 242,992 of
// 242,992 over a 90-game round robin) and arrive lowercased.
const hasTraitNamed = (card: any, trait: string): boolean =>
    Array.isArray(card?.traits)
        ? card.traits.some((value: any) => String(value).toLowerCase() === trait)
        : typeof card?.traits === 'string' && new RegExp(`\\b${trait}\\b`, 'i').test(card.traits);
// Glory arrives as `glorySummary.stat`, matching the live-skill summaries; the
// bare `glory` field is not populated on an in-play character.
const gloryOf = (card: any): number =>
    Math.max(0, Number(card?.glorySummary?.stat ?? card?.glory) || 0);
// A card sitting in the dynasty discard has EMPTY skill summaries — the engine
// only fills those for cards in play — and the serialized pile carries no
// printed skill at all, so every recursion target priced at zero. The
// controller's `dynastyDiscardBodies` does carry printed stats; prefer it and
// fall back to whatever the pile exposes.
const discardBodies = (ctx: PlaybookContext): any[] =>
    (ctx.dynastyDiscardBodies && ctx.dynastyDiscardBodies.length > 0)
        ? ctx.dynastyDiscardBodies
        : (ctx.dynastyDiscard || []).filter((card) => card?.type === 'character');
const printedSkillOf = (card: any, axis: 'military' | 'political'): number => {
    const summary = Number(axis === 'military'
        ? card?.militarySkillSummary?.stat
        : card?.politicalSkillSummary?.stat);
    return Math.max(0, Number.isFinite(summary) ? summary : Number(card?.[axis]) || 0);
};
const isShugenja = (card: any): boolean =>
    hasTraitNamed(card, 'shugenja') || PHOENIX_SHUGENJA.includes(card?.id);
const isCavalry = (ctx: PlaybookContext, card: any): boolean =>
    !!ctx.cavalryCharacterUuids?.[card?.uuid] || hasTraitNamed(card, 'cavalry');

// `conflict.ts:474` drops a BOWED participant's skill from the total unless an
// effect says otherwise. Every pump, every removal, and every "what is this
// worth" reading below is therefore measured over ready participants only —
// pumping a bowed body adds exactly zero.
const totalSkill = (cards: any[], axis: 'military' | 'political'): number =>
    readyParticipants(cards).reduce((sum, card) => sum + liveSkill(card, axis), 0);
const bestReadyParticipantSkill = (cards: any[], axis: 'military' | 'political'): number =>
    readyParticipants(cards).reduce((best, card) => Math.max(best, liveSkill(card, axis)), 0);

// Consumed by Five Fires removes UP TO five fate, and a character that loses
// its last fate is discarded in the fate phase. So the card is priced by the
// single best body it can empty, counting what the opponent sank into it —
// attachments and an honored token die with the character. The old gate
// demanded five removable fate ACROSS the board, which measured 4 hits in 491
// windows (and never once alongside the five own fate the card costs), because
// the opponent's whole board rarely holds five fate at conflict time.
// `characterValue` is skill + 3 per fate + 2 per attachment, so this threshold
// is about "a two-fate body with real skill on it" — enough that spending the
// card and five fate buys a body the opponent cannot simply replay.
const FIVE_FIRES_MIN_KILL_VALUE = 8;
const fiveFiresBestKill = (ctx: PlaybookContext): number => ctx.opponentCharacters
    .filter((card) => fiveFiresTarget(card) && (Number(card.fate) || 0) <= 5)
    .reduce((best, card) => Math.max(best, characterValue(card)), 0);
const fiveFiresBoardFate = (ctx: PlaybookContext): number => ctx.opponentCharacters
    .filter(fiveFiresTarget)
    .reduce((total, card) => total + (Number(card.fate) || 0), 0);

// Printed HONOR costs. Fate costs arrive from the engine as `conflictCosts`,
// but honor costs exist only in card text, so the bot has never been able to
// price them. Reaching 0 honor loses the game outright, so an unbudgeted honor
// cost is a real way to lose: 18.9% of field games end by dishonor.
//
// Only costs the bot pays VOLUNTARILY belong here. Forced losses (Marauding
// Oni's declaration cost) are handled by `declareCostsHonor`.
// Only MANDATORY costs belong here. Banzai is deliberately absent: its honor
// goes to an OPTIONAL second resolution, so vetoing the card would refuse a
// free +2. Its budget is applied where the choice is actually made — the
// `banzai-recur-for-honor` prompt — and reflected in its contribution below.
const HONOR_COST: Record<string, number> = {
    'assassination': 3,
    'captive-audience': 1,
    'moto-eviscerator': 1,
    'shosuro-hametsu': 1,
    'thunder-guard-elite': 1
};

export function honorCostOf(cardId: string | undefined): number {
    return cardId ? (HONOR_COST[cardId] || 0) : 0;
}

// How much honor a card play may take us down to. Own honor alone is not the
// answer: the same 4 honor is unspendable while an opponent grinds us toward 0
// and nearly free the round we can break their stronghold.
export interface HonorRaceLimits {
    dishonorFloor: number; // never end a voluntary payment at or below this
    honorWinGuard: number; // at or above this own honor, stop selling the win
    conquestCloseBroken: number; // their broken outer provinces that cheapen honor
    conquestFloor: number; // relaxed floor while that conquest win is live
    behindRaceMargin: number; // opponent honor lead that signals honor pressure
    behindFloorBonus: number; // extra floor while under that pressure
}

export const DEFAULT_HONOR_RACE_LIMITS: HonorRaceLimits = {
    dishonorFloor: 3,
    honorWinGuard: 22,
    conquestCloseBroken: 3,
    conquestFloor: 1,
    behindRaceMargin: 5,
    behindFloorBonus: 2
};

// True when paying `cost` honor is affordable in the RACE, not just on the
// dial. Undefined opponent honor (older callers) degrades to the own-honor
// floor, which is still stricter than the previous no-check-at-all behavior.
export function honorSpendingAllowed(
    ctx: PlaybookContext,
    cost: number,
    limits: HonorRaceLimits = DEFAULT_HONOR_RACE_LIMITS
): boolean {
    if(cost <= 0) {
        return true;
    }
    const honor = Number(ctx.honor) || 0;
    // Three honor from the win, a 1-honor cost is a third of the remaining
    // distance. Nothing a conflict card buys is worth selling that.
    if(honor >= limits.honorWinGuard) {
        return false;
    }
    let floor = limits.dishonorFloor;
    if((ctx.opponentBrokenProvinces ?? 0) >= limits.conquestCloseBroken) {
        // Their stronghold is one or two conflicts away. Honor stops being a
        // resource we need to still have at the end of the game.
        floor = limits.conquestFloor;
    } else if(typeof ctx.opponentHonor === 'number' &&
        ctx.opponentHonor - honor >= limits.behindRaceMargin) {
        // Losing the honor race is the public signature of an opponent who is
        // actively draining us. Keep a bigger reserve against their next hit.
        floor += limits.behindFloorBonus;
    }
    return honor - cost > floor;
}

// Banzai's second +2 costs 1 honor and is optional, so it is a spending
// decision rather than a play decision. The legacy reading is the bare
// `honor > 3` cliff the policy has always used.
export function banzaiRecurAllowed(
    ctx: PlaybookContext,
    limits: HonorRaceLimits = DEFAULT_HONOR_RACE_LIMITS
): boolean {
    const honor = Number(ctx.honor) || 0;
    return ctx.honorRaceAware === true
        ? honorSpendingAllowed(ctx, 1, limits)
        : honor > 3;
}

// Cards that read "while you are less honorable than an opponent" are dead
// text until the bot can see both pools. Unknown opponent honor keeps the old
// permissive behavior rather than silently benching the card.
const lessHonorableThanOpponent = (ctx: PlaybookContext): boolean =>
    ctx.honorRaceAware !== true || typeof ctx.opponentHonor !== 'number' ||
    (Number(ctx.honor) || 0) < ctx.opponentHonor;

// ---- honor-dial readings (Scorpion "Bid War") -----------------------------
//
// `myBid`/`opponentBid` are the VISIBLE dials. Both are 0/undefined before the
// draw-phase reveal and in every prompt that never plumbed them, and each
// reading below treats that as "no gap", which closes the gate rather than
// spending a card into a cancel.

// The absolute difference — Make an Opening's X, and always a MINUS on the
// enemy participant regardless of which side bid higher.
const dialGap = (ctx: PlaybookContext): number => {
    const mine = Number(ctx.myBid);
    const theirs = Number(ctx.opponentBid);
    if(!Number.isFinite(mine) || !Number.isFinite(theirs) || mine <= 0 || theirs <= 0) {
        return 0;
    }
    return Math.abs(mine - theirs);
};

// Regal Bearing sets OUR dial to 1 and draws |1 - theirs|, so only the
// opponent's visible dial matters.
const regalBearingDraw = (ctx: PlaybookContext): number => {
    const theirs = Number(ctx.opponentBid);
    return Number.isFinite(theirs) && theirs > 0 ? Math.abs(1 - theirs) : 0;
};

// I Can Swim needs BOTH a strictly higher visible dial and a dishonored enemy
// participant. Returns the body it would remove so the card can be priced by
// what it actually takes off the table.
const canSwimTarget = (ctx: PlaybookContext): any | null => {
    const mine = Number(ctx.myBid);
    const theirs = Number(ctx.opponentBid);
    if(!Number.isFinite(mine) || !Number.isFinite(theirs) || theirs <= 0 || mine <= theirs) {
        return null;
    }
    return participating(ctx.opponentCharacters)
        .filter((card) => card.isDishonored)
        .sort((a, b) => liveSkill(b, ctx.conflictType) - liveSkill(a, ctx.conflictType))[0] || null;
};

// "If you are more honorable than your opponent" is the printed condition on
// Matsu Tsuko, Matsu Agetoki, Matsu Mitsuko and Blade of 10,000 Battles. The
// engine refuses the ability outright when it is false, so every gate below
// checks it rather than paying for a click the engine will reject.
const moreHonorable = (ctx: PlaybookContext): boolean =>
    Number(ctx.honor ?? 10) > Number(ctx.opponentHonor ?? 10);

// Bodies that are ready and NOT already in the conflict — the pool every
// move-in effect in the Lion Duelist list draws from, and the only pool the
// stronghold's bow can actually cost the opponent anything from.
const readyAtHome = (cards: any[]): any[] =>
    (cards || []).filter((card) => card && !card.bowed && !card.inConflict);

const holdsRing = (ctx: PlaybookContext, elements: string[]): boolean =>
    (ctx.myClaimedRingElements || []).some((element) => elements.includes(String(element)));

// Net attachment weight the Frostbitten Crossing strip would take off one body.
// Theirs counts everything, because every attachment they paid for is something
// we would rather they did not have. Ours is debuffs MINUS everything else: the
// province discards EVERY attachment on the chosen character, so a body of ours
// only qualifies when it is carrying more affliction than kit.
const stripWeight = (card: any, mine: boolean): number =>
    (card?.attachments || []).reduce((total: number, attachment: any) => {
        if(mine) {
            return total + (isNegativeAttachmentId(attachment?.id) ? 1 : -1);
        }
        return total + 1;
    }, 0);

const PLAYBOOK: Record<string, PlaybookEntry> = {
    // +2 military to a participating character, optionally twice for 1 honor.
    'banzai': entry('banzai', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        // Paying 1 honor resolves the ability a SECOND time for another +2 (the
        // engine's own spec asserts military 5 on a base-1 body), and the policy
        // already takes that branch whenever honor is above 3 —
        // `banzai-recur-for-honor`. So the real contribution is +4, and the flat
        // +2 was budgeting the most-played event in the field at half its worth.
        // The third trigger is 'lose 1 honor for no effect' and is always
        // declined; it is only useful to a Scorpion deliberately dropping below
        // the opponent's honor, which is not modelled here.
        conflictContribution: priced('banzai', (ctx) => {
            if(readyParticipants(ctx.myCharacters).length === 0) {
                return 0;
            }
            return banzaiRecurAllowed(ctx) ? 4 : 2;
        }, 2),
        summary: '+2 military pump on a participating character'
    }),

    // +2 military to a participating Bushi; honors it if the conflict is won.
    'a-perfect-cut': entry('a-perfect-cut', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        // Needs a Bushi, and a bowed one contributes nothing to pump.
        conflictContribution: priced('a-perfect-cut',
            (ctx) => readyParticipants(ctx.myCharacters).some((card) => hasTraitNamed(card, 'bushi'))
                ? 2
                : 0, 2),
        abilityValue: true,
        summary: '+2 military on a Bushi, honors it on a win'
    }),

    // Lose 3 honor, discard an enemy character of printed cost 2 or lower.
    // The engine offers only legal targets; if just our own cheap characters
    // qualify, the targeting stage cancels (targetSide enemy).
    // Legal against any in-play cost-2-or-less enemy. Playing it blind put
    // the bot in a cancel loop (click -> only own characters legal -> cancel
    // -> click again, 200+ times per match, eating every conflict window), so
    // gate on a KNOWN cheap enemy character via the DeckAnalysis card
    // models. An unmodeled opponent card keeps Assassination in hand — better
    // than the loop.
    'assassination': entry('assassination', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'discard an enemy cost-2-or-less character for 3 honor',
        // `characterPrintedCosts` is the exact live cost by UUID; the curated
        // model is only the fallback. Requiring a model entry hid 74 of the 99
        // legal targets in the deck pool from this check — the registry covers
        // 22% of dynasty characters, so Brash Samurai, Kaiu Envoy, Silent
        // Skirmisher and most other cheap bodies read as untargetable and the
        // card was refused with a legal kill on the board.
        // Honor floor relaxes on a stronghold conflict. Three honor is a real
        // price mid-game, but on the conflict that decides conquest the honor
        // has no later use — the deck owner plays it down to 4 there and keeps
        // 6 everywhere else. `strongholdConflict` is the existing flag for
        // "this conflict is at a stronghold, attacking or defending".
        shouldPlay: (ctx) => ctx.honor >= (ctx.liveCharacterCosts && ctx.strongholdConflict ? 4 : 6) &&
            ctx.opponentCharacters.some((card) => {
            const live = card.uuid ? Number(ctx.characterPrintedCosts?.[card.uuid]) : NaN;
            const cost = Number.isFinite(live)
                ? live
                : (card.id ? getCardModel(card.id)?.fate : undefined);
            return Number.isFinite(cost as number) && (cost as number) <= 2;
        })
    }),

    // Put up to 6 printed cost of Cavalry characters from the dynasty discard
    // into the conflict — a huge military swing when the discard is stocked.
    'cavalry-reserves': entry('cavalry-reserves', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        // Works with every participant bowed: puts Cavalry from the dynasty discard into the conflict.
        worksWithoutReadyParticipant: true,
        summary: 'puts discarded Cavalry characters into the conflict',
        shouldPlay: (ctx) => ctx.dynastyDiscard.filter((card) => card.type === 'character').length >= 2
    }),

    // Remove 1 fate from a friendly Unicorn character to ready it. Worth it
    // for a bowed conflict participant whose skill comes back online, AND to
    // stand a bowed "tower" character back up at home so it can be committed
    // or declared into the next conflict — but only one carrying SPARE fate
    // (>1) at home, so readying it does not strip its last fate and doom it.
    // In-conflict readies keep the original fate>0 threshold.
    'i-am-ready': entry('i-am-ready', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        // Works with every participant bowed: readies a friendly character.
        worksWithoutReadyParticipant: true,
        // Readying a bowed participant restores its full skill to this conflict.
        // The other use — readying a home body so it can fight the NEXT conflict
        // this phase, which is how the Unicorn rush closes games — adds nothing
        // to this total, so it stays unpriced rather than being called zero and
        // vetoed.
        conflictContribution: priced('i-am-ready', (ctx) => {
            const best = ctx.myCharacters
                .filter((card) => card.bowed && card.inConflict && (Number(card.fate) || 0) > 0)
                .reduce((top, card) => Math.max(top, liveSkill(card, ctx.conflictType)), 0);
            return best > 0 ? best : null;
        }),
        summary: 'ready a friendly character by removing 1 of its fate',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) =>
            card.bowed && (Number(card.fate) || 0) > (card.inConflict ? 0 : 1))
    }),

    // +1 military to every non-unique character we control: needs bodies.
    'ujik-tactics': entry('ujik-tactics', {
        conflictTypes: ['military'],
        priority: 6,
        conflictContribution: (ctx) => readyParticipants(ctx.myCharacters)
            .filter((card) => !card.isUnique).length,
        summary: '+1 military to each non-unique character',
        shouldPlay: (ctx) => readyParticipants(ctx.myCharacters).length >= 2
    }),

    // Attachment: +X military where X = unclaimed rings (early conflicts big).
    'born-in-war': entry('born-in-war', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 6,
        summary: '+X military attachment, X = unclaimed rings'
    }),

    // Attachment with an in-play Action: re-attach to another Cavalry
    // character — rescue it from a bowed or stay-at-home bearer.
    'shinjo-saddle': entry('shinjo-saddle', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 5,
        summary: 'attachment that can move itself to another Cavalry character',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const bearer = ctx.myCharacters.find((card) =>
                (card.attachments || []).some((attachment: any) => attachment.id === 'shinjo-saddle'));
            if(!bearer || (!bearer.bowed && bearer.inConflict)) {
                return false;
            }
            return ctx.myCharacters.some((card) => card !== bearer && card.inConflict && !card.bowed);
        }
    }),

    // Holding: ready a Cavalry character while we have a claimed military
    // ring. Legality (the claimed ring) is checked by the engine.
    'shiotome-encampment': entry('shiotome-encampment', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'holding: ready a Cavalry character',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) => card.bowed &&
            (!!ctx.cavalryCharacterUuids?.[card.uuid] || (card.traits || []).includes('cavalry')))
    }),

    // Holding reaction: +2 military after a character moves to a conflict.
    'moto-stables': entry('moto-stables', {
        priority: 8,
        summary: 'holding reaction: +2 military after a move to the conflict'
    }),

    // Character Action while participating: +1/+1 to every participating
    // Cavalry when we outnumber the opponent in the conflict.
    'shinjo-shono': entry('shinjo-shono', {
        priority: 7,
        summary: 'pumps all participating Cavalry when outnumbering',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const shono = ctx.myCharacters.find((card) => card.id === 'shinjo-shono');
            return !!shono && shono.inConflict &&
                participating(ctx.myCharacters).length > participating(ctx.opponentCharacters).length;
        }
    }),

    // Character Action during a military conflict she fights in: fetch a
    // cost-3-or-lower character from the dynasty deck into the conflict.
    'shinjo-altansarnai-2': entry('shinjo-altansarnai-2', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'fetches a cheap character into her military conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            if(ctx.conflictType !== 'military') {
                return false;
            }
            const altansarnai = ctx.myCharacters.find((card) => card.id === 'shinjo-altansarnai-2');
            return !!altansarnai && altansarnai.inConflict;
        }
    }),

    // Reaction after being played from a province: dig the top 5 dynasty
    // cards for a cheap character to put into play. Always worth it.
    'shinjo-gunso': entry('shinjo-gunso', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'on-play: put a cheap character from the dynasty deck into play'
    }),

    // Reaction: honor the attached character after it wins a military
    // conflict. Free honor.
    'utaku-battle-steed': entry('utaku-battle-steed', {
        targetSide: 'self',
        priority: 7,
        summary: 'honors its bearer after a military win'
    }),

    // Reaction: honored after we play a Gaijin card. Free honor.
    'worldly-shiotome': entry('worldly-shiotome', {
        priority: 7,
        summary: 'honors herself after a Gaijin card is played'
    }),

    // Covert-evade reaction: the evaded character cannot defend this phase.
    'shinjo-yasamura': entry('shinjo-yasamura', {
        priority: 7,
        summary: 'locks the coverted character out of defending this phase'
    }),

    // Character Action: ready itself — free skill recovery for a bowed
    // participant.
    'border-rider': entry('border-rider', {
        priority: 7,
        summary: 'readies itself',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) => card.id === 'border-rider' && card.bowed && card.inConflict)
    }),

    // Character Action: ready itself while participating in a military
    // conflict.
    'moto-outrider': entry('moto-outrider', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'readies itself during its military conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.conflictType === 'military' &&
            ctx.myCharacters.some((card) => card.id === 'moto-outrider' && card.bowed && card.inConflict)
    }),

    // Character Action while participating: -1/-1 to every opposing
    // participant — scales with their body count.
    'warrior-poet': entry('warrior-poet', {
        priority: 7,
        summary: 'debuffs every opposing participant by 1/1',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const poet = ctx.myCharacters.find((card) => card.id === 'warrior-poet');
            if(!poet || !poet.inConflict) {
                return false;
            }
            const enemies = participating(ctx.opponentCharacters).length;
            return enemies >= 2 || (enemies >= 1 && ctx.losing);
        }
    }),

    // Attachment Action during a military conflict the bearer sits out of:
    // bow a participating character (aim at the enemy) and move the bearer
    // into the conflict — a two-way swing.
    'adorned-barcha': entry('adorned-barcha', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'bows an enemy participant and rides the bearer in',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => {
            if(ctx.conflictType !== 'military') {
                return false;
            }
            const bearer = ctx.myCharacters.find((card) =>
                (card.attachments || []).some((attachment: any) => attachment.id === 'adorned-barcha'));
            return !!bearer && !bearer.inConflict &&
                participating(ctx.opponentCharacters).some((card) => !card.bowed);
        }
    }),

    // Reaction after moving to a conflict: ready a character.
    'twilight-rider': entry('twilight-rider', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'on-move reaction: ready a character'
    }),

    // Reaction after winning: a no-fate participant does not bow out.
    'higashi-kaze-company': entry('higashi-kaze-company', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'win reaction: keeps a no-fate participant unbowed'
    }),

    // Reaction after winning while outnumbering: gain 1 fate, draw 1. Free.
    'minami-kaze-regulars': entry('minami-kaze-regulars', {
        priority: 8,
        summary: 'win reaction: gain 1 fate and draw 1 card'
    }),

    // Reaction after a move into its conflict: honor a participant.
    'outskirts-sentry': entry('outskirts-sentry', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'honors a participant after a move-in'
    }),

    // Granted reaction while first player: opponent loses 1 fate on a win.
    'scarlet-sabre': entry('scarlet-sabre', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'win reaction: opponent loses 1 fate'
    }),

    // Seeker role reactions: gain 1 fate after an own province of the role's
    // element is revealed. Free fate, always fire. All five elements get an
    // entry so any deck's role works (Unicorn/Crab/Crane run air, Scorpion
    // runs earth).
    'seeker-of-air': entry('seeker-of-air', {
        priority: 8,
        summary: 'gain 1 fate when an own air province is revealed'
    }),
    'seeker-of-earth': entry('seeker-of-earth', {
        priority: 8,
        summary: 'gain 1 fate when an own earth province is revealed'
    }),
    'seeker-of-fire': entry('seeker-of-fire', {
        priority: 8,
        summary: 'gain 1 fate when an own fire province is revealed'
    }),
    'seeker-of-water': entry('seeker-of-water', {
        priority: 8,
        summary: 'gain 1 fate when an own water province is revealed'
    }),
    'seeker-of-void': entry('seeker-of-void', {
        priority: 8,
        summary: 'gain 1 fate when an own void province is revealed'
    }),

    // ---- Shiro Shinjo province-reveal / fate-economy deck ----

    'shiro-shinjo': entry('shiro-shinjo', {
        priority: 10,
        summary: 'bow after collection: gain fate for each faceup opposing outer province'
    }),
    'appealing-to-the-fortunes': entry('appealing-to-the-fortunes', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'Void-role strength 5; on break put the strongest available character into play'
    }),
    'border-fortress': entry('border-fortress', {
        targetSide: 'enemy',
        priority: 9,
        inPlayAction: true,
        actionBeforePass: true,
        summary: 'during its conflict reveal another facedown province'
    }),
    'khan-s-ordu': entry('khan-s-ordu', {
        priority: 10,
        summary: 'on reveal switch political to military and make later declarations military'
    }),
    'massing-at-twilight': entry('massing-at-twilight', {
        priority: 9,
        summary: 'strength 8; participating characters count combined military and political'
    }),
    'ganzu-warrior': entry('ganzu-warrior', {
        priority: 10,
        summary: 'after a conflict reveal resolve a matching normal ring effect'
    }),
    'shinjo-trailblazer': entry('shinjo-trailblazer', {
        priority: 9,
        summary: 'gains +2/+2 after an opposing province is revealed during a conflict'
    }),
    'way-station-trader': entry('way-station-trader', {
        priority: 9,
        summary: 'after a participating reveal take 1 fate from an opponent'
    }),
    'iuchi-farseer': entry('iuchi-farseer', {
        targetSide: 'enemy',
        priority: 10,
        summary: 'on entry reveal an opposing facedown province'
    }),
    'iuchi-daiyu': entry('iuchi-daiyu', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        inPlayAction: true,
        actionBeforePass: true,
        summary: '+1 military per faceup opposing outer province',
        shouldUseAction: (ctx) => ctx.conflictType === 'military' &&
            (ctx.opponentFaceupNonStrongholdProvinces || 0) > 0 &&
            readyParticipants(ctx.myCharacters).length > 0
    }),
    'khanbulak-benefactor': entry('khanbulak-benefactor', {
        priority: 10,
        summary: 'enter with no fate for Dire hand discounts; always draw 2 on entry'
    }),
    'moto-horde': entry('moto-horde', {
        conflictTypes: ['military'],
        priority: 6,
        summary: 'efficient 6-military body'
    }),
    'white-horde-vanguard': entry('white-horde-vanguard', {
        conflictTypes: ['military'],
        priority: 8,
        summary: 'first-conflict protection from opposing bow and move effects'
    }),
    'moto-chagatai': entry('moto-chagatai', {
        conflictTypes: ['military'],
        priority: 8,
        summary: 'does not bow after a conflict that breaks an opposing province'
    }),
    'yoritomo': entry('yoritomo', {
        priority: 8,
        summary: 'gets +X/+X where X is the controller fate pool'
    }),
    'aranat': entry('aranat', {
        priority: 10,
        summary: 'on play gains fate for each opposing province left facedown'
    }),
    'audience-chamber': entry('audience-chamber', {
        priority: 10,
        summary: 'after a printed cost 4+ character is played place 1 fate on it'
    }),
    'good-omen': entry('good-omen', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 8,
        abilityValue: true,
        summary: 'with composure place 1 fate on a printed cost 3+ character',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) =>
            (Number(ctx.characterPrintedCosts?.[card.uuid]) || 0) >= 3)
    }),
    'outflank': entry('outflank', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        abilityValue: true,
        summary: 'reveal reaction: strongest ready non-unique cannot defend',
        shouldPlay: () => false
    }),
    'speak-to-the-heart': entry('speak-to-the-heart', {
        conflictTypes: ['political'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        conflictContribution: (ctx) => ctx.opponentFaceupNonStrongholdProvinces || 0,
        summary: '+1 political per faceup opposing outer province'
    }),
    'chasing-the-sun': entry('chasing-the-sun', {
        targetSide: 'enemy',
        priority: 9,
        abilityValue: true,
        actionBeforePass: true,
        summary: 'move an attack to another province and reveal it',
        shouldPlay: (ctx) => ctx.amAttacker &&
            (ctx.opponentFacedownNonStrongholdProvinces || 0) > 0
    }),
    'overrun': entry('overrun', {
        targetSide: 'enemy',
        priority: 10,
        abilityValue: true,
        summary: 'after a break reveal and blank another opposing province',
        shouldPlay: () => false
    }),
    'diversionary-maneuver': entry('diversionary-maneuver', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        priority: 9,
        abilityValue: true,
        actionBeforePass: true,
        summary: 'reset participants, move the military conflict, and reveal its new province',
        shouldPlay: (ctx) => ctx.amAttacker && ctx.conflictType === 'military' &&
            (ctx.opponentFacedownNonStrongholdProvinces || 0) > 0
    }),
    'scouted-terrain': entry('scouted-terrain', {
        targetSide: 'enemy',
        priority: 10,
        abilityValue: true,
        summary: 'with four faceup provinces enable a surprise stronghold attack this phase',
        shouldPlay: () => false
    }),
    'fine-katana': entry('fine-katana', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 7,
        summary: 'free Restricted +2 military attachment'
    }),

    // Province Conflict Action: strip 1 fate from an attacker — take it from
    // the attacker that would live longest.
    'meditations-on-the-tao': entry('meditations-on-the-tao', {
        targetSide: 'enemy',
        targetPreference: 'most-fate',
        priority: 8,
        summary: 'province: removes 1 fate from an attacker'
    }),

    // Stronghold: bow to move a Cavalry character into a military conflict.
    'golden-plains-outpost': entry('golden-plains-outpost', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'stronghold: moves a Cavalry character into the conflict'
    }),

    // ---- aggressive military-rush conflict cards ----

    // Draw-engine attachment: attach to a durable attacker so its commit/move
    // into conflicts refills the hand (twice per round). +0 military, so it
    // needs abilityValue to pass the zero-contribution filter. Measured
    // slightly NEGATIVE in the Crane mirror (47-33, 59%, pooled N=80 vs the
    // ~65% band) but kept ON by user decision: the draw engine is worth more
    // against a human than against the predictable Crane bot.
    'spyglass': entry('spyglass', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'attach to an attacker; draws a card when it commits/moves in',
        abilityValue: true
    }),

    // Restricted +2 military weapon while attacking — a cheap, permanent pump
    // on the deck's main threat.
    'curved-blade': entry('curved-blade', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: '+2 military attachment while the bearer is attacking'
    }),

    // Win reaction: draw 3 and discard 1 after winning a military attack — the
    // deck's biggest card-advantage swing. Fires through the priority>=6
    // reaction path.
    'spoils-of-war': entry('spoils-of-war', {
        conflictTypes: ['military'],
        priority: 9,
        summary: 'win reaction: draw 3 and discard 1 after a military attack'
    }),

    // Action while outnumbering: the opponent bows one of their participants —
    // strips a defender once we already have the bodies on the table.
    'flank-the-enemy': entry('flank-the-enemy', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'while outnumbering, the opponent bows a participant',
        shouldPlay: (ctx) => (ctx.participatingCharacterCounts?.self ?? participating(ctx.myCharacters).length) >
            (ctx.participatingCharacterCounts?.opponent ?? participating(ctx.opponentCharacters).length)
    }),

    // Convert a political conflict to military (lose 1 honor) so the deck's
    // military board applies — the trick that turns a political conflict into
    // a second military attack.
    'captive-audience': entry('captive-audience', {
        conflictTypes: ['political'],
        priority: 8,
        // Flipping the axis re-totals BOTH sides. The swing is how much more
        // military than political we field, less the same figure for them, so
        // the card is huge for a Cavalry board against courtiers and actively
        // harmful the other way round. A flat constant could not express that.
        conflictContribution: priced('captive-audience', (ctx) => ctx.conflictType === 'political'
            ? Math.max(0,
                (totalSkill(ctx.myCharacters, 'military') - totalSkill(ctx.myCharacters, 'political')) -
                (totalSkill(ctx.opponentCharacters, 'military') - totalSkill(ctx.opponentCharacters, 'political')))
            : 0),
        summary: 'change a political conflict to military for 1 honor',
        shouldPlay: (ctx) => ctx.amAttacker && ctx.conflictType === 'political' && ctx.honor >= 3
    }),

    // Military duel that gives each duelist +1 per other participant its
    // controller has, then moves the loser home — a swarm removes a defender.
    'challenge-on-the-fields': entry('challenge-on-the-fields', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'military duel (+1 per participant), move the loser home',
        shouldPlay: (ctx) => ctx.amAttacker &&
            (ctx.participatingCharacterCounts?.self ?? participating(ctx.myCharacters).length) >= 2 &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Move a Cavalry body in. A bowed target is valid with an exact ready
    // follow-up, or when Minami/Higashi can collect a projected win payoff.
    'ride-on': entry('ride-on', {
        conflictTypes: [],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 5,
        // Works with every participant bowed: moves a ready Cavalry body into the conflict.
        worksWithoutReadyParticipant: true,
        // Moving a ready Cavalry body in adds its whole skill. A bowed one only
        // counts when something readies it after the move, which is exactly the
        // set the gate below already tracks. The card's other mode — pulling a
        // body OUT of a conflict we have conceded — is not skill here, so it
        // stays unpriced.
        conflictContribution: priced('ride-on', (ctx) => {
            const best = ctx.myCharacters
                .filter((card) => !card.inConflict && isCavalry(ctx, card) &&
                    (!card.bowed || ctx.readyAfterMoveCharacterUuids?.[card.uuid]))
                .reduce((top, card) => Math.max(top, liveSkill(card, ctx.conflictType)), 0);
            return best > 0 ? best : null;
        }),
        summary: 'move a home Cavalry character into the conflict',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => {
            if(card.inConflict ||
                (!ctx.cavalryCharacterUuids?.[card.uuid] && !(card.traits || []).includes('cavalry'))) {
                return false;
            }
            if(!card.bowed || ctx.readyAfterMoveCharacterUuids?.[card.uuid]) {
                return true;
            }
            if(Number(ctx.winSkillNeeded) > 0) {
                return false;
            }
            if(card.id === 'minami-kaze-regulars') {
                return (ctx.participatingCharacterCounts?.self ?? participating(ctx.myCharacters).length) + 1 >
                    (ctx.participatingCharacterCounts?.opponent ?? participating(ctx.opponentCharacters).length);
            }
            return card.id === 'higashi-kaze-company' && ctx.myCharacters.some((other) =>
                other !== card && other.inConflict && !other.bowed && (Number(other.fate) || 0) === 0);
        })
    }),

    // ==================================================================
    // Crab "Kaiu Wall" defensive holding engine.
    // ==================================================================

    // Economy event: an opponent gives you 1 fate or 1 honor. Cheap value.
    'levy': entry('levy', {
        priority: 3,
        summary: 'gain 1 fate or 1 honor from an opponent'
    }),

    // Rebuild the wall: swap a province card for a holding from the discard.
    'rebuild': entry('rebuild', {
        priority: 6,
        summary: 'put a discarded holding into one of your provinces',
        shouldPlay: (ctx) => ctx.dynastyDiscard.some((card) => card.type === 'holding')
    }),

    // Control attachment onto an attacking character: -1/-1 and it will not
    // ready. Only enemy attackers are legal targets.
    'pit-trap': entry('pit-trap', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: '-1/-1 debuff attachment on the strongest attacker',
        shouldPlay: (ctx) => !ctx.amAttacker && ctx.opponentCharacters.some((card) => card.inConflict)
    }),

    // Attacking with a holding: knock 2 strength off the attacked province —
    // how the wall deck finally breaks through once it turns the corner.
    'siege-warfare': entry('siege-warfare', {
        priority: 7,
        summary: 'weaken the attacked province by 2 while attacking',
        shouldPlay: (ctx) => ctx.amAttacker
    }),

    // Defensive military pump that cannot be reduced.
    'give-no-ground': entry('give-no-ground', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        // DELIBERATELY UNPRICED. The model is trivial and correct — 2 while
        // defending with a ready participant, 0 while attacking — and it was
        // measured at -4.3pp on Crab, the only deck that runs the card, and the
        // entire loss in the live-event-pricing set (n=1620 paired). A known
        // number makes the card eligible for the strength-already-sufficient
        // veto and moves it in `ConflictCardEconomy`, which is worth more to a
        // wall deck than the number is. See `docs/bot-v2-rejected-experiments.md`.
        summary: '+2 military on a defender, unreducible',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // Free extra defender straight out of the attacked province.
    'raise-the-alarm': entry('raise-the-alarm', {
        conflictTypes: ['military'],
        priority: 8,
        // Works with every participant bowed: puts a defender into play from the attacked province.
        worksWithoutReadyParticipant: true,
        summary: 'reveal/put a defender into play from the attacked province',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // Keeps a defender ready for the opponent's later conflicts this phase.
    'the-mountain-does-not-fall': entry('the-mountain-does-not-fall', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'a defender does not bow from conflict resolution',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // Team-wide defensive lock.
    'the-strength-of-the-mountain': entry('the-strength-of-the-mountain', {
        priority: 7,
        summary: 'defenders cannot be bowed/moved and do not bow on resolution',
        shouldPlay: (ctx) => !ctx.amAttacker && readyParticipants(ctx.myCharacters).length >= 1
    }),

    // Follower that bleeds opponent honor whenever they play a card while the
    // bearer participates — huge on a durable defender. The unlimited reaction
    // fires through the priority>=6 hinted-trigger path.
    'watch-commander': entry('watch-commander', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        maxCopiesPerTarget: 1,
        summary: 'attach to a defender; opponent loses honor for each card they play'
    }),

    // Covert enabler for the occasional attack.
    'subterranean-guile': entry('subterranean-guile', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 4,
        summary: 'grants covert while you control a wall holding'
    }),

    // Province fortification: +3 military strength on one of your provinces.
    'inventive-buttressing': entry('inventive-buttressing', {
        conflictTypes: ['military'],
        targetSide: 'self',
        priority: 5,
        summary: '+3 military strength on one of your provinces'
    }),

    // ---- win-as-defender reactions (fire via the hinted-trigger path) ----

    'hida-kotoe': entry('hida-kotoe', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'defense win: discard an attachment'
    }),
    'hida-o-ushi': entry('hida-o-ushi', {
        priority: 8,
        summary: 'defense win: declare an extra military conflict this phase'
    }),
    'kuni-ritsuko': entry('kuni-ritsuko', {
        targetSide: 'enemy',
        targetPreference: 'most-fate',
        priority: 7,
        summary: 'defense win: remove 1 fate from an attacker'
    }),
    'staunch-hida': entry('staunch-hida', {
        priority: 8,
        summary: 'defense win: resolve the ring effect as the attacker'
    }),
    'yasuki-oguri': entry('yasuki-oguri', {
        priority: 6,
        summary: 'defending: +1/+1 when the opponent plays an event'
    }),
    'hida-tomonatsu': entry('hida-tomonatsu', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'defense win: sacrifice to bounce a non-unique attacker'
    }),
    'purifier-apprentice': entry('purifier-apprentice', {
        priority: 7,
        summary: 'defense win: opponent loses 1 honor'
    }),

    // On-defend reaction: lock a chosen character out of abilities this
    // conflict — aim at the biggest enemy threat.
    'hiruma-ambusher': entry('hiruma-ambusher', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'on-defend: lock a character out of abilities this conflict'
    }),

    // On-play reaction: recur a holding from the discard into a province.
    'apprentice-engineer': entry('apprentice-engineer', {
        priority: 8,
        summary: 'on-play: put a holding from the discard into a province'
    }),

    // On-play reaction banks holdings under the stronghold; the manual
    // wall-build Action is also a dynasty-phase dig.
    'kaiu-shihobu': entry('kaiu-shihobu', {
        priority: 8,
        summary: 'on-play: bank holdings; Action builds the wall',
        dynastyAction: true
    }),

    'seventh-tower': entry('seventh-tower', {
        priority: 8,
        summary: 'defense win at a wall province: resolve the ring as the attacker'
    }),
    'watchtower-of-valor': entry('watchtower-of-valor', {
        priority: 7,
        summary: 'defense win at a wall province: draw 1'
    }),

    // Event reactions.
    'guardians-of-rokugan': entry('guardians-of-rokugan', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'defense win: put a character from the deck into play'
    }),
    'withstand-the-darkness': entry('withstand-the-darkness', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 7,
        summary: 'protect a targeted Crab character with a fate — bank it on the tower'
    }),
    'fruitful-respite': entry('fruitful-respite', {
        priority: 7,
        summary: 'gain 2 fate when the opponent passes on a conflict'
    }),

    // ---- in-play Actions during conflicts (defending) ----

    // Gain 1 fate while participating with a holding in play — free value.
    'kaiu-shuichi': entry('kaiu-shuichi', {
        priority: 6,
        summary: 'gain 1 fate while participating with a holding in play',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'kaiu-shuichi');
            return !!card && card.inConflict;
        }
    }),

    // Loot (draw 1, discard 1) while defending.
    'hida-sukune': entry('hida-sukune', {
        priority: 6,
        summary: 'defending: draw 1 and discard 1',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'hida-sukune');
            return !ctx.amAttacker && !!card && card.inConflict;
        }
    }),

    // Defending: move a stronger attacker home — sheds attacker skill and can
    // save the province from breaking.
    'yasuki-hikaru': entry('yasuki-hikaru', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'defending: move a stronger attacker home',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'yasuki-hikaru');
            return !ctx.amAttacker && !!card && card.inConflict &&
                participating(ctx.opponentCharacters).length > 0;
        }
    }),

    // Defending and losing: sacrifice to ready and pull another character in.
    'hiruma-signaller': entry('hiruma-signaller', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'defending: sacrifice to ready and move a character into the conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'hiruma-signaller');
            return !ctx.amAttacker && ctx.losing && !!card && card.inConflict;
        }
    }),

    // Defending: fetch a holding into the attacked province — raises its
    // strength mid-conflict to deny the break.
    'frontline-engineer': entry('frontline-engineer', {
        priority: 8,
        summary: 'defending: fetch a holding into the attacked province',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'frontline-engineer');
            return !ctx.amAttacker && !!card && card.inConflict;
        }
    }),

    // Ready itself by ditching a friendly holding — only when bowed out of a
    // defense it still needs to win.
    // Utilization audit 2026-07-10: the old gate (bowed && inConflict &&
    // losing) never fired in 40 traced games — a participant rarely sits
    // bowed mid-conflict while losing. Any bowed-in-conflict state is worth
    // the ready (a bowed participant contributes no skill).
    'kaiu-siege-force': entry('kaiu-siege-force', {
        priority: 5,
        summary: 'ready itself by discarding a friendly holding',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'kaiu-siege-force');
            return !!card && card.bowed && card.inConflict;
        }
    }),

    // Wall holding: strip 2 random cards from the opponent's hand while
    // defending a wall province.
    'river-of-the-last-stand': entry('river-of-the-last-stand', {
        priority: 7,
        summary: 'wall holding: opponent discards 2 random cards',
        inPlayAction: true,
        shouldUseAction: (ctx) => !ctx.amAttacker
    }),

    // ---- dynasty board actions (holding-engine digging) ----

    // Stronghold: bow to look at the top 3 and play a character — the deck's
    // main way to deploy characters past a wall of holdings.
    'kyuden-hida': entry('kyuden-hida', {
        priority: 7,
        summary: 'stronghold: dig the top 3 for a character to play',
        dynastyAction: true
    }),

    // Dig a character into a province that already holds a holding.
    'unyielding-sensei': entry('unyielding-sensei', {
        priority: 6,
        summary: 'dig a character into a province that has a holding',
        dynastyAction: true
    }),

    // Wall tutor: swap in a holding from the top 10 of the dynasty deck.
    'kaiu-forges': entry('kaiu-forges', {
        priority: 6,
        summary: 'wall tutor: swap in a holding from the top 10',
        dynastyAction: true
    }),

    // ==================================================================
    // Scorpion "Poison Mill" dishonor deck (EmeraldDB 914dc4d4).
    // Win condition: opponent at 0 honor. Disrupt, debuff, mill their
    // conflict deck, farm honor off every dial and the air ring.
    // ==================================================================

    // ---- control attachments onto ENEMY characters ----

    // Peaceful: cannot be played during a conflict — the pre-conflict path
    // plays it. Locks the bearer out of military conflicts entirely; aim at
    // their best military body.
    'pacifism': entry('pacifism', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'enemy character cannot join military conflicts',
        preConflict: true,
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) =>
            !(card.attachments || []).some((attachment: any) => attachment.id === 'pacifism'))
    }),

    // Pre-conflict only: the bearer cannot join political conflicts.
    'stolen-breath': entry('stolen-breath', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'enemy character cannot join political conflicts',
        preConflict: true,
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) =>
            !(card.attachments || []).some((attachment: any) => attachment.id === 'stolen-breath'))
    }),

    // Poison: -2/-2 on the strongest enemy — the deck's tutorable answer.
    'fiery-madness': entry('fiery-madness', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: '-2/-2 poison attachment on the strongest enemy',
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => card.inConflict && !card.bowed)
    }),

    // The bearer cannot ready unless its controller mills their own conflict
    // deck 3 — either outcome (a stuck body or self-mill) feeds the plan.
    // 0/0 stats: abilityValue lets it past the zero-contribution filter.
    // Only bites a BOWED body (it blocks readying), so hold it until the
    // opponent has a bowed character to lock down; the target steering in
    // JigokuBotPolicy then pins the strongest bowed enemy.
    'softskin': entry('softskin', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'enemy character cannot ready without milling 3',
        abilityValue: true,
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => card.bowed &&
            !(card.attachments || []).some((attachment: any) => attachment.id === 'softskin'))
    }),

    // Sticky -1/-1 that re-homes itself when the bearer leaves play.
    'tainted-koku': entry('tainted-koku', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'sticky debuff that moves to another enemy when the bearer dies'
    }),

    // Taxes the bearer's abilities: 1 honor to us per trigger. Best on an
    // ability-heavy character, but any strong body is fine. 0/0 stats:
    // abilityValue lets it past the zero-contribution filter.
    'compromised-secrets': entry('compromised-secrets', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'enemy pays us 1 honor to use the bearer\'s abilities',
        abilityValue: true,
        // "Play only if you are less honorable than an opponent" is a printed
        // legality condition, not advice. Without both honor pools the bot
        // could only click and let the engine refuse.
        shouldPlay: lessHonorableThanOpponent
    }),

    // ---- conflict events ----

    // -X/-X where X = |our dial - their dial|; our low bids vs a value bidder
    // make X large most rounds. Needs both sides participating and dials shown.
    'make-an-opening': entry('make-an-opening', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: '-X/-X on an enemy participant, X = honor dial difference',
        // X is the ABSOLUTE dial difference, so the card is dead on a tie and
        // worth 1 skill on a gap of 1 — the old reading spent it whenever any
        // enemy participant stood there. Bid-war decks read the live dials;
        // every other deck keeps the legacy gate bit-identical.
        conflictContribution: (ctx) => ctx.bidWarAware === true
            ? Math.min(dialGap(ctx), bestReadyParticipantSkill(ctx.opponentCharacters, ctx.conflictType))
            : null,
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => card.inConflict && !card.bowed) &&
            (ctx.bidWarAware !== true || dialGap(ctx) >= 2)
    }),

    // -4 political on a participant during a political conflict.
    'compelling-testimony': entry('compelling-testimony', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        // -4 is a ceiling, not a payout: against a 2-political defender the card
        // removes 2. Budgeting the full 4 made the bot believe it had bought a
        // break it had not.
        conflictContribution: priced('compelling-testimony',
            (ctx) => Math.min(4, bestReadyParticipantSkill(ctx.opponentCharacters, 'political')), 4),
        summary: '-4 political on an enemy participant',
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => card.inConflict && !card.bowed)
    }),

    // Opponent's choice: +2/+2 on our participant or they give us 1 honor.
    // Both outcomes serve the plan; costs 0.
    'deceptive-offer': entry('deceptive-offer', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        // The OPPONENT chooses. They hand over the skill when it cannot change
        // the result and pay the honor when it can, so the +2 is only bankable
        // while we need MORE than it gives. Either way the card is never dead,
        // which is what `abilityValue` records.
        conflictContribution: priced('deceptive-offer', (ctx) => {
            if(readyParticipants(ctx.myCharacters).length === 0) {
                return 0;
            }
            const needed = Number(ctx.winSkillNeeded);
            // They will pay the honor rather than hand over a swing that flips
            // the conflict, so there is no skill to budget — but a free honor is
            // still worth the card, which is what the null records.
            return Number.isFinite(needed) && needed > 0 && needed <= 2 ? null : 2;
        }),
        summary: 'opponent picks: +2/+2 for us or gives us 1 honor',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => card.inConflict && !card.bowed)
    }),

    // Each player draws 2 then discards 2: cycles our hand and burns 2 of the
    // opponent's conflict deck — cheap mill.
    'oracle-of-stone': entry('oracle-of-stone', {
        priority: 4,
        optionalDrawCards: 2,
        summary: 'both players draw 2 discard 2 (mills their conflict deck)'
    }),

    // Bow an enemy character after it triggers an ability — fires through the
    // hinted reaction path whenever the window is offered.
    'kirei-ko': entry('kirei-ko', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'bow an enemy character after it uses an ability'
    }),

    // Cancel an enemy event while less honorable — the deck is nearly always
    // less honorable, and canceling their trick mid-conflict is a swing.
    'forgery': entry('forgery', {
        priority: 7,
        summary: 'cancel an enemy event while less honorable',
        // Same printed condition as Compromised Secrets.
        shouldPlay: lessHonorableThanOpponent
    }),

    // Cancel the effect that would take our LAST honor, then gain 1. The
    // safety net that lets the deck live at low honor. Always fire.
    'duty': entry('duty', {
        priority: 10,
        summary: 'cancel losing our last honor, gain 1 back'
    }),

    // ---- characters with honor-drain / mill triggers ----

    // 4-military body whose forced reaction bleeds 1 of OUR honor every time
    // it is declared. Fine while honor is a resource, banned at the floor.
    'marauding-oni': entry('marauding-oni', {
        conflictTypes: ['military'],
        priority: 5,
        summary: 'big body; declaring it costs us 1 honor',
        declareCostsHonor: true
    }),


    // Political win: take 1 honor from the opponent.
    'blackmail-artist': entry('blackmail-artist', {
        conflictTypes: ['political'],
        priority: 8,
        summary: 'political win: take 1 honor from the opponent'
    }),

    // Military win: peek at the top 2 of their conflict deck, discard 1.
    'midnight-prowler': entry('midnight-prowler', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'military win: mill 1 from the top 2 of their conflict deck'
    }),

    // Interrupt on leaving play while less honorable: gain 2 honor.
    'beautiful-entertainer': entry('beautiful-entertainer', {
        priority: 7,
        summary: 'gain 2 honor when she leaves play while less honorable'
    }),

    // Action (no cost, once per round): a player discards 3 and draws 3 —
    // aimed at the opponent it burns 3 conflict cards and scrambles their hand.
    'master-whisperer': entry('master-whisperer', {
        priority: 7,
        summary: 'opponent discards 3 and draws 3 (burns their conflict deck)',
        inPlayAction: true
    }),

    // Action while participating, pay 1 honor: opponent discards a random card.
    'thunder-guard-elite': entry('thunder-guard-elite', {
        priority: 7,
        summary: 'pay 1 honor: opponent discards a random card',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.canPayHonor !== false &&
            ctx.myCharacters.some((card) => card.id === 'thunder-guard-elite' && card.inConflict)
    }),

    // Action, pay 1 honor: tutor a Poison card (Fiery Madness) from the
    // conflict deck. Also nudges our honor down toward the band.
    'shosuro-hametsu': entry('shosuro-hametsu', {
        priority: 5,
        summary: 'pay 1 honor: fetch a Poison card from the conflict deck',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.canPayHonor !== false && (ctx.fate ?? 0) >= 1 &&
            ctx.myCharacters.some((card) => card.id === 'shosuro-hametsu')
    }),

    // Action during a conflict, lose 1 honor: move into the conflict — extra
    // skill when it matters, and honor down toward the band.
    'moto-eviscerator': entry('moto-eviscerator', {
        conflictTypes: ['military'],
        priority: 6,
        summary: 'lose 1 honor: move into the conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.canPayHonor !== false && ctx.losing &&
            ctx.myCharacters.some((card) => card.id === 'moto-eviscerator' && !card.inConflict && !card.bowed)
    }),

    // Military duel that dishonors the loser. Shared bid tactics weigh the
    // skill matchup against both honor pools; start only with a useful body.
    'insolent-rival': entry('insolent-rival', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 5,
        summary: 'military duel: dishonor the loser',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.canPayHonor !== false &&
            ctx.myCharacters.some((card) => card.id === 'insolent-rival' && card.inConflict && !card.bowed) &&
            ctx.opponentCharacters.some((card) => card.inConflict)
    }),

    // ---- holdings ----

    // Unlimited reaction: every conflict WE win mills the top of their
    // conflict deck.
    'licensed-quarter': entry('licensed-quarter', {
        priority: 8,
        summary: 'every conflict we win mills their conflict deck'
    }),

    // ==================================================================
    // Lion "Bushi swarm" precon (EmeraldDB e3feb31b).
    // Flood cheap Bushi, attack every window, profit from every won
    // conflict (draws, fate, readies), force conflicts to military.
    // ==================================================================

    // ---- conflict events ----

    // Double a Lion character's base military — the deck's biggest single
    // swing; aim it at the strongest participant.
    'way-of-the-lion': entry('way-of-the-lion', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        // Doubling BASE military adds exactly the base value again, so the card
        // is worth the largest base military among our ready participants — the
        // biggest single pump either Lion list owns, and it read as "unknown
        // contribution" to province-break budgeting before.
        // `characterBaseMilitary` is the exact live map; the summary stat is the
        // fallback for synthetic callers.
        conflictContribution: priced('way-of-the-lion', (ctx) => ctx.conflictType !== 'military'
            ? 0
            : readyParticipants(ctx.myCharacters).reduce((best: number, card: any) => {
                const base = Number(ctx.characterBaseMilitary?.[card?.uuid] ?? liveSkill(card, 'military'));
                return Math.max(best, Number.isFinite(base) ? Math.max(0, base) : 0);
            }, 0)),
        summary: 'double a Lion character\'s base military'
    }),

    // +3 military to a character ALONE on our side; can resolve twice for a
    // fate off the target. Only correct when exactly one body fights.
    'a-legion-of-one': entry('a-legion-of-one', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        conflictContribution: 3,
        summary: '+3 (or +6) military on a character fighting alone',
        shouldPlay: (ctx) => participating(ctx.myCharacters).length === 1
    }),

    // Move a defender home while attacking — sheds defense skill; X (max
    // glory) scales with our swarm, so the engine legality rarely blocks it.
    'strength-in-numbers': entry('strength-in-numbers', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'attacking: move a defending character home',
        shouldPlay: (ctx) => ctx.amAttacker &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Bow a weak non-unique to ready a unique. Printed uniqueness is public in
    // card summaries, so require both halves before paying the first cost.
    'in-service-to-my-lord': entry('in-service-to-my-lord', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        // Works with every participant bowed: readies a unique (bows a non-unique that may be at home).
        worksWithoutReadyParticipant: true,
        summary: 'bow a cheap non-unique to ready a unique character',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => card.bowed && card.isUnique) &&
            ctx.myCharacters.some((card) => !card.bowed && !card.isUnique)
    }),

    // Ready up to 6 printed cost of Bushi — the follow-up attack enabler.
    // Playable from the discard while more honorable.
    'right-hand-of-the-emperor': entry('right-hand-of-the-emperor', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        // Works with every participant bowed: readies up to 6 printed cost of Bushi.
        worksWithoutReadyParticipant: true,
        summary: 'ready up to 6 cost worth of Bushi characters',
        shouldPlay: (ctx) => ctx.myCharacters.filter((card) => card.bowed).length >= 2
    }),

    // Reaction after we break a province in a military conflict: 1 fate on
    // every Bushi on our side — the swarm's whole board persists.
    'for-greater-glory': entry('for-greater-glory', {
        conflictTypes: ['military'],
        priority: 9,
        summary: 'break reaction: 1 fate on each of our Bushi',
        // This is a Reaction, not a conflict Action. It is still selected by
        // the triggered-window path; keep the normal hand-play path from
        // repeatedly clicking it as a no-op.
        shouldPlay: () => false
    }),

    // Conflict-phase opener: trade one faceup province for a fate on every
    // printed-cost-3-or-lower body. LionTactics gates the reaction at 5 bodies.
    'feeding-an-army': entry('feeding-an-army', {
        priority: 9,
        summary: 'break a friendly province; fate on each cheap character',
        // Phase-start Reaction; triggeredWindowDecision owns its timing.
        shouldPlay: () => false
    }),

    // Two fate buys the strongest character in the dynasty discard for this
    // military conflict. Targeting is tower-first in LionTactics.
    'forebearer-s-echoes': entry('forebearer-s-echoes', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        // Works with every participant bowed: puts a body from the dynasty discard into the conflict.
        worksWithoutReadyParticipant: true,
        // The body arrives IN the conflict and ready, so its whole military is
        // added. This is the largest single number any event in the field can
        // produce, and it read as "unknown" to break budgeting before.
        conflictContribution: priced('forebearer-s-echoes', (ctx) => discardBodies(ctx)
            .reduce((best, card) => Math.max(best, printedSkillOf(card, 'military')), 0)),
        summary: 'put the strongest dynasty-discard character into this conflict',
        shouldPlay: (ctx) => ctx.dynastyDiscard.some((card) => card.type === 'character')
    }),

    // Political tempo: only spend it while behind and an opposing participant
    // can be bowed, dishonored, and sent home to reverse the conflict.
    'ujiaki-s-offer': entry('ujiaki-s-offer', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'bow, dishonor, and send home an enemy political participant',
        shouldPlay: (ctx) => ctx.losing &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Reaction after losing a political conflict: free Weapon from hand or
    // discard onto a Bushi. Turns every conceded political into tempo.
    'time-for-war': entry('time-for-war', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'lost political: put a Weapon into play on a Bushi'
    }),

    // ---- weapons and banners ----

    // +4/+1 weapon; on the Champion (Toturi) grants an extra military
    // conflict every conflict phase.
    'shori': entry('shori', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: '+4 military; on the Champion, an extra military conflict'
    }),

    // Weapon reaction: bow an enemy character whenever anyone triggers an
    // ability during the bearer's conflict — fires via the hinted path.
    'kamayari': entry('kamayari', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'weapon: bow an enemy after an ability triggers in our conflict'
    }),

    // Bearer does not bow out of military conflicts — keeps a big attacker
    // ready to defend.
    'sashimono': entry('sashimono', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'bearer does not bow from military conflict resolution',
        abilityValue: true
    }),

    // Grants the Lion symbol and Commander trait — turns on Tactical
    // Ingenuity and keeps Akodo Toshiro in play.
    'seal-of-the-lion': entry('seal-of-the-lion', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 5,
        summary: 'grants the Commander trait (+1 military)'
    }),

    // Commander attachment Action: dig the top 4 of the conflict deck for an
    // event — use it every conflict the bearer fights in ("every time
    // possible" — the card engine of the deck).
    'tactical-ingenuity': entry('tactical-ingenuity', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'commander attachment: dig the conflict deck for an event',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.inConflict &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'tactical-ingenuity'))
    }),

    // Technique Action: initiate a military duel on BASE skill, bow the
    // loser. On a high-base bearer (Way of the Lion doubles base) it removes
    // a defender nearly every time. Use whenever the bearer participates.
    'true-strike-kenjutsu': entry('true-strike-kenjutsu', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'duel on base military: bow the loser',
        abilityValue: true,
        attachSide: 'self',
        maxCopiesPerTarget: 1,
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.inConflict &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'true-strike-kenjutsu')) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // ---- battlefield attachments (play onto OWN provinces while defending) ----

    // During a conflict at the attached province, play characters from the
    // provinces straight into the conflict — surprise defenders.
    'prepared-ambush': entry('prepared-ambush', {
        targetSide: 'self',
        priority: 7,
        summary: 'battlefield: play province characters into conflicts here',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // +2 military to every defender at the attached province.
    'makeshift-war-camp': entry('makeshift-war-camp', {
        conflictTypes: ['military'],
        targetSide: 'self',
        priority: 7,
        summary: 'battlefield: +2 military to each defender here',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // ---- characters: in-play Actions during conflicts ----

    // +5 military while attacking but provinces cannot break this conflict —
    // fire it to STEAL a losing conflict (ring + win reactions), never when
    // the break is already on. Needs a Commander (or it discards itself).
    'akodo-toshiro': entry('akodo-toshiro', {
        conflictTypes: ['military'],
        priority: 7,
        summary: '+5 military, no breaks: steal a losing conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.losing &&
            ctx.myCharacters.some((card) => card.id === 'akodo-toshiro' && card.inConflict && !card.bowed) &&
            ctx.myCharacters.some((card) =>
                ['gifted-tactician', 'honored-general', 'ikoma-tsanuri', 'master-tactician'].includes(card.id) ||
                (card.attachments || []).some((attachment: any) => attachment.id === 'seal-of-the-lion'))
    }),

    // +1/+1 to every participant we control while 3+ of our Bushi fight.
    'ikoma-tsanuri': entry('ikoma-tsanuri', {
        priority: 7,
        summary: '+1/+1 to all our participants with 3+ Bushi in',
        inPlayAction: true,
        shouldUseAction: (ctx) =>
            ctx.myCharacters.some((card) => card.id === 'ikoma-tsanuri' && card.inConflict) &&
            participating(ctx.myCharacters)
                .filter((card) => (card.traits || []).includes('bushi')).length >= 3
    }),

    // While attacking: bow an enemy character with military skill at or
    // under the brawler's — buffed, it bows almost anything.
    'lion-s-pride-brawler': entry('lion-s-pride-brawler', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'attacking: bow an enemy with equal or lower military',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.amAttacker &&
            ctx.myCharacters.some((card) => card.id === 'lion-s-pride-brawler' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Every participant loses military equal to its printed POLITICAL — our
    // Bushi print low political, courtier defenders print high: a one-sided
    // sweep against Crane-style boards.
    'matsu-koso': entry('matsu-koso', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'all participants lose military equal to printed political',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.losing &&
            ctx.myCharacters.some((card) => card.id === 'matsu-koso' && card.inConflict) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Duelist Action: military duel, the winner does not bow from this
    // conflict's resolution. Shared duel tactics choose the risk-aware bid.
    'honorable-challenger': entry('honorable-challenger', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'military duel: winner does not bow from resolution',
        inPlayAction: true,
        shouldUseAction: (ctx) =>
            ctx.myCharacters.some((card) => card.id === 'honorable-challenger' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Lose 2 honor: switch the conflict type — turns a political conflict
    // (theirs or ours) into a military one where the swarm's skill applies.
    'ikoma-ujiaki-2': entry('ikoma-ujiaki-2', {
        priority: 8,
        summary: 'lose 2 honor: switch the conflict to military',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.conflictType === 'political' && ctx.honor >= 6 &&
            ctx.myCharacters.some((card) => card.id === 'ikoma-ujiaki-2' && card.inConflict)
    }),

    // ---- characters: reactions (fire via the hinted priority>=6 path) ----

    // Win reaction vs a participating Courtier: strip a fate or kill it.
    'akodo-makoto': entry('akodo-makoto', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'win reaction: strip fate from (or kill) a Courtier'
    }),

    // On-play from a province: refill that province faceup. Free tempo.
    'akodo-gunso': entry('akodo-gunso', {
        priority: 7,
        summary: 'on-play: refill the province faceup'
    }),

    // Free body multiplication: always pull another copy from a province or
    // dynasty discard when its enter-play reaction is legal.
    'ashigaru-levy': entry('ashigaru-levy', {
        targetSide: 'self',
        priority: 9,
        summary: 'on-enter: put another Ashigaru Levy into play'
    }),

    // Reaction after claiming a ring in his military conflict: resolve the
    // ring effect AGAIN.
    'akodo-toturi': entry('akodo-toturi', {
        priority: 8,
        summary: 'ring claim reaction: resolve the ring effect twice'
    }),

    // Win reaction (military): draw 1.
    'gifted-tactician': entry('gifted-tactician', {
        priority: 8,
        summary: 'military win reaction: draw 1 card'
    }),

    // On-enter reaction: honor him (3 military + honored status).
    'honored-general': entry('honored-general', {
        priority: 7,
        summary: 'on-enter reaction: honor him'
    }),

    // On-enter with 3+ other Bushi: 2 free fate on her.
    'matsu-beiona': entry('matsu-beiona', {
        priority: 7,
        summary: 'on-enter reaction: 2 fate with 3+ other Bushi'
    }),

    // Conflict character whose printed defense jumps from 3 to 6 political.
    'political-rival': entry('political-rival', {
        conflictTypes: ['political'],
        targetSide: 'self',
        priority: 8,
        summary: '3 political conflict body; gains +3 political while defending'
    }),

    // After dials reveal with our (lower) bid: draw 1 — pairs with the
    // deck's bid-4 dial policy.
    'tactician-s-apprentice': entry('tactician-s-apprentice', {
        priority: 7,
        summary: 'lower honor bid: draw 1 card'
    }),

    // Win reaction while behind on cards: put a cheap Bushi from the dynasty
    // discard into play.
    'unified-company': entry('unified-company', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'win reaction: put a cheap Bushi from the discard into play'
    }),

    // ---- holdings ----

    // Sacrifice: return a Weapon from the conflict discard to hand.
    'ancestral-armory': entry('ancestral-armory', {
        priority: 5,
        summary: 'sacrifice: return a discarded Weapon to hand',
        inPlayAction: true,
        shouldUseAction: (ctx) => (ctx.conflictDiscard || []).some((card: any) =>
            ['shori', 'kamayari', 'fine-katana'].includes(card.id))
    }),

    // ==================================================================
    // Phoenix "For Honor and Glory" (EmeraldDB 7c5b9776).
    // Build a persistent honored high-glory board, hold the Imperial
    // Favor, and contest the ring the board exploits (see GloryTactics).
    // ==================================================================

    // ---- interrupts / cancels (fire via the hinted priority>=6 path) ----

    // Cancel an enemy event while holding the Imperial Favor.
    'censure': entry('censure', {
        priority: 8,
        summary: 'with the Favor: cancel an enemy event'
    }),

    // Cancel an enemy event while we have more honored characters.
    'voice-of-honor': entry('voice-of-honor', {
        priority: 8,
        summary: 'more honored characters: cancel an enemy event',
        // Interrupt-only. It remains available to the hinted interrupt path,
        // but must never be attempted as an ordinary conflict Action.
        shouldPlay: () => false
    }),

    // ---- reactions ----

    // Draw-phase reaction holding: draw 1 every round. Free.
    'forgotten-library': entry('forgotten-library', {
        priority: 8,
        optionalDrawCards: 1,
        summary: 'draw phase reaction: draw 1 card'
    }),

    // Win reaction: honor a character (ours) or dishonor one (theirs). The
    // policy steers the target and the follow-up menu together.
    'asako-diplomat': entry('asako-diplomat', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'win reaction: honor own character (or dishonor theirs)'
    }),

    // After the water ring is claimed (by anyone): honor a Scholar.
    'asako-tsuki': entry('asako-tsuki', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'water claimed: honor a Scholar character'
    }),

    // Forced reaction after the void ring is claimed: remove a no-fate
    // character from the game — aim at their strongest.
    'isawa-ujina': entry('isawa-ujina', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'void claimed: remove a no-fate character from the game'
    }),

    // End of conflict phase: resolve up to 2 unclaimed rings as attacker.
    'shiba-tsukune': entry('shiba-tsukune', {
        priority: 10,
        summary: 'phase end: resolve 2 unclaimed rings as the attacker'
    }),

    // Conflict phase begins: pick a ring; +2/+2 while it is contested.
    'ethereal-dreamer': entry('ethereal-dreamer', {
        priority: 7,
        summary: 'phase start: +2/+2 while the chosen ring is contested'
    }),

    // Reaction after the opponent declares their SECOND conflict this phase:
    // honor a character. Honored adds the character's glory to BOTH skills, so
    // the policy aims it at our highest-glory unhonored body.
    'shiba-pureheart': entry('shiba-pureheart', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'their second conflict: honor an own high-glory character'
    }),

    // Reaction after WE play a Water card: switch one character's base
    // military and political skill for the phase. Symmetric and free — it can
    // hand our lopsided body (Isawa Heiko is a 0/5) the contested axis, or take
    // that axis away from an enemy participant. Target chosen by the policy.
    'isawa-heiko': entry('isawa-heiko', {
        priority: 8,
        summary: 'after a Water card: switch a character\'s base skills'
    }),

    // Interrupt that REPLACES the water ring effect with "bow any character and
    // ready a different one". The printed effect does one of those, so this is
    // strictly better whenever either half has a target.
    'asako-azunami': entry('asako-azunami', {
        priority: 9,
        summary: 'water ring: bow one character and ready another instead'
    }),

    // Restricted +1/+1. Its on-enter ready is the point: attach only when a
    // bowed printed-cost-2-or-lower Lion body is available.
    'elegant-tessen': entry('elegant-tessen', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: '+1/+1 and ready a cheap attached character',
        abilityValue: true,
        preConflict: true,
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => {
            if(!card.bowed) {
                return false;
            }
            const cost = card.uuid ? ctx.characterPrintedCosts?.[card.uuid] : undefined;
            const visibleCost = Number(cost ?? card.printedCost ?? card.cost);
            return Number.isFinite(visibleCost) && visibleCost <= 2;
        })
    }),

    // Kyuden Isawa recasts a high-impact Spell event from the conflict
    // discard by discarding a lower-value Spell from hand.
    'kyuden-isawa': entry('kyuden-isawa', {
        priority: 10,
        summary: 'discard a Spell to play a Spell event from conflict discard'
    }),

    // Reveal reaction: resolve and claim a free ring as the attacker.
    'offerings-to-the-kami': entry('offerings-to-the-kami', {
        priority: 10,
        summary: 'reveal: resolve and claim an unclaimed ring for free'
    }),

    // Spell-play reaction: Shiba Tetsu grows for every Spell played while he
    // participates. No target and no cost, so always take it.
    'shiba-tetsu': entry('shiba-tetsu', {
        priority: 9,
        summary: 'after a Spell is played while participating: gain +1/+1'
    }),

    // Protect an own Shugenja from an opponent-triggered ability.
    'shiba-yojimbo': entry('shiba-yojimbo', {
        priority: 10,
        summary: 'cancel an opponent ability that targets an own Shugenja'
    }),

    // Air-claim economy reaction, up to twice each round.
    'kudaka': entry('kudaka', {
        priority: 9,
        summary: 'claim air: gain 1 fate and draw 1 card'
    }),

    // Enters-play tutor: keep the best Spell/Kiho from the top three.
    'shrine-maiden': entry('shrine-maiden', {
        priority: 9,
        optionalAbilityConflictDeckCardsConsumed: 3,
        summary: 'enter play: take a Spell or Kiho from the top three'
    }),

    // Leaving-play recursion: put the strongest Phoenix dynasty character in
    // the discard into play with 1 fate.
    'fushicho': entry('fushicho', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'leaves play: return strongest Phoenix dynasty character with 1 fate'
    }),

    // ---- in-play Actions ----

    // Bow an attacking character while earth is in our claimed pool. Works
    // even from home; the engine rejects the click without earth claimed.
    'solemn-scholar': entry('solemn-scholar', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'earth claimed: bow an attacking character',
        inPlayAction: true,
        shouldUseAction: (ctx) => !ctx.amAttacker &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Military-conflict Action: honor a participant we control, adding its
    // glory to BOTH skills. The honored body is sacrificed if a province breaks
    // this conflict — a real cost for most decks, and the Fushicho rotation's
    // engine, because a sacrificed body lands in the dynasty discard where the
    // recursion cards read it. Target side is chosen in the policy (defence
    // takes the biggest glory, attack takes a body cheap enough to lose).
    'inferno-guard-invoker': entry('inferno-guard-invoker', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        inPlayAction: true,
        // Honoring adds glory to both skills, so the swing is the target's
        // glory — the same arithmetic as Way of the Crane and Benten's Touch.
        conflictContribution: priced('inferno-guard-invoker', (ctx) => {
            const best = readyParticipants(ctx.myCharacters)
                .filter((card) => !card.isHonored)
                .reduce((top, card) => Math.max(top, gloryOf(card)), 0);
            return best > 0 ? best : null;
        }),
        summary: 'military: honor a participant (+glory to both skills)',
        shouldUseAction: (ctx) => ctx.conflictType === 'military' &&
            readyParticipants(ctx.myCharacters).some((card) => !card.isHonored && gloryOf(card) > 0)
    }),

    // Action while FIRE sits in the unclaimed pool: lose N honor, strip 1 fate
    // from each of N participating characters. A body that loses its last fate
    // is discarded in the fate phase, so this answers a tower the deck has no
    // other removal for.
    //
    // The honor budget itself lives in `RebirthTactics.tsukeHonorSpend`, which
    // owns the floor and the cap; this static gate only avoids a wasted click.
    // The selector demands EXACTLY as many targets as honor paid, so the policy
    // must never bid past the number of enemy bodies worth hitting.
    'isawa-tsuke-2': entry('isawa-tsuke-2', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        inPlayAction: true,
        summary: 'fire unclaimed: pay honor to strip fate from enemy participants',
        shouldUseAction: (ctx) => (ctx.honor ?? 10) > 6 &&
            (!ctx.rings || ctx.rings.some((ring: any) =>
                ring?.element === 'fire' && !ring?.claimed)) &&
            participating(ctx.opponentCharacters).some((card) => (Number(card.fate) || 0) > 0)
    }),

    // Holding Action: return one or more rings from our claimed pool to the
    // unclaimed pool, gaining 1 honor each. Freeing FIRE re-arms Isawa Tsuke,
    // which is worth more than the honor. Capped to one activation per round
    // because the ability is unlimited and reverses its own precondition.
    'ancestral-shrine': entry('ancestral-shrine', {
        priority: 6,
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true,
        abilityValue: true,
        summary: 'return claimed rings for 1 honor each'
    }),

    // Ready itself while the water ring is claimed.
    'prodigy-of-the-waves': entry('prodigy-of-the-waves', {
        priority: 7,
        summary: 'water claimed: readies itself',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'prodigy-of-the-waves' && card.bowed)
    }),

    // Grant Covert during Water conflicts. It is useful before a conflict is
    // declared and targets the deck's practical large-body towers.
    'adept-of-the-waves': entry('adept-of-the-waves', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'grant an own tower Covert during Water conflicts this phase',
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true
    }),

    // Once the opponent has declared two conflicts, repeatedly take fate; if
    // none remains, take honor. The card implementation has no printed limit.
    'meddling-mediator': entry('meddling-mediator', {
        priority: 10,
        summary: 'after opponent declares two conflicts: take fate, else honor',
        inPlayAction: true,
        conflictPhaseAction: true
    }),

    // Participating ring swap: take fate from an unclaimed ring and move Water
    // into the claimed pool for the deck's Water payoffs.
    'asako-togama': entry('asako-togama', {
        priority: 9,
        summary: 'participating: swap a claimed ring for an unclaimed ring and take its fate',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) => card.id === 'asako-togama' && card.inConflict)
    }),

    // Conflict character with Disguised Shugenja. Its board action removes one
    // weak dynasty-discard character to discard one random opponent hand card.
    'isawa-tadaka-2': entry('isawa-tadaka-2', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'Disguised Shugenja; trade one weak dynasty-discard character for one enemy hand card',
        inPlayAction: true,
        shouldUseAction: (ctx) => (ctx.opponentHandSize ?? 1) > 0 &&
            ctx.dynastyDiscard.some((card) => card.type === 'character'),
        shouldPlay: (ctx) => {
            if(ctx.myCharacters.some((card) => card.id === 'isawa-tadaka-2')) {
                return false;
            }
            const fate = ctx.fate ?? 0;
            if(fate >= 5) {
                return true;
            }
            return ctx.myCharacters.some((card) => card.id && TADAKA_DISGUISE_COSTS[card.id] !== undefined &&
                fate >= Math.max(5 - TADAKA_DISGUISE_COSTS[card.id], 1));
        }
    }),

    // Void conflict: +1/+1 to all our participants, -1/-1 to all theirs.
    'isawa-atsuko': entry('isawa-atsuko', {
        priority: 8,
        summary: 'void conflict: +1/+1 ours, -1/-1 theirs',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'isawa-atsuko' && card.inConflict) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Holding: sacrifice to move an own character to (or from) the conflict.
    // Reinforce a losing defense with the strongest home body.
    'favorable-ground': entry('favorable-ground', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'sacrifice: reinforce a defense or rescue a tower for the next conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.losing && (
            (!ctx.amAttacker && ctx.myCharacters.some((card) => !card.bowed && !card.inConflict)) ||
            (ctx.preferFavorableRetreat && !ctx.strongholdConflict && (ctx.conflictsRemaining ?? 0) >= 1 &&
                ctx.myCharacters.some((card) => !card.bowed && card.inConflict))
        )
    }),

    // ---- conflict events ----

    // Free body during a water conflict (recurs into the deck afterwards).
    'feral-ningyo': entry('feral-ningyo', {
        priority: 8,
        summary: 'water conflict: free 3/2 body from hand'
    }),

    // Ready (or bow) an own Shugenja — the policy steers it to READY an own
    // bowed Shugenja.
    'against-the-waves': entry('against-the-waves', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        // Works with every participant bowed: readies a bowed Shugenja — the answer to a bowed board.
        worksWithoutReadyParticipant: true,
        // Readying a bowed PARTICIPANT hands its whole skill back to the current
        // conflict, because a bowed body contributes nothing (`conflict.ts:474`).
        // Readying one at home is real tempo but adds nothing to this total, so
        // it stays unpriced rather than being called zero.
        conflictContribution: priced('against-the-waves', (ctx) => {
            const best = ctx.myCharacters
                .filter((card) => card.bowed && card.inConflict && isShugenja(card))
                .reduce((top, card) => Math.max(top, liveSkill(card, ctx.conflictType)), 0);
            return best > 0 ? best : null;
        }),
        summary: 'ready an own bowed Shugenja',
        shouldPlay: gated('against-the-waves',
            (ctx) => ctx.myCharacters.some((card) => card.bowed && isShugenja(card)),
            (ctx) => ctx.myCharacters.some((card) => card.bowed &&
                PHOENIX_SHUGENJA.includes(card.id)))
    }),

    // Win an unopposed conflict by 5+ to gain 2 fate. The policy extends the
    // attack margin while this is in hand, then always fires the reaction.
    'the-path-of-man': entry('the-path-of-man', {
        priority: 10,
        summary: 'win an unopposed conflict by 5 or more: gain 2 fate',
        shouldPlay: () => false
    }),

    // Tower protection: the target cannot be bowed by the opponent and does
    // not bow after a political conflict.
    'clarity-of-purpose': entry('clarity-of-purpose', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'protect an own tower from bowing and political resolution',
        shouldPlay: (ctx) => {
            const protectedUuids = new Set(ctx.clarityProtectedUuids || []);
            const hasUnprotectedReadyParticipant = participating(ctx.myCharacters)
                .some((card) => !card.bowed && !protectedUuids.has(String(card.uuid || '')));
            if(!hasUnprotectedReadyParticipant) {
                return false;
            }
            // Political resolution supplies value even without a known bow
            // card. During military, use Clarity only for an actual visible
            // defender threat, an exact affordable seed-3 hand threat, or the
            // ordinary fair-bot hedge against its hidden hand.
            return ctx.conflictType === 'political' ||
                !!ctx.opponentParticipantCanBow ||
                (ctx.omniscient ? !!ctx.opponentHasAffordableBowEffect : true);
        }
    }),

    // Reaction after an enemy character readies: bow that same enemy again.
    'earth-becomes-sky': entry('earth-becomes-sky', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'after an enemy character readies: bow it again',
        shouldPlay: () => false
    }),

    // Main province-trade card: cancel an unopposed ring effect, resolve it as
    // attacker, then claim the ring.
    'display-of-power': entry('display-of-power', {
        priority: 10,
        summary: 'lose unopposed: cancel, resolve, and claim the contested ring',
        shouldPlay: () => false
    }),

    // Five-fate tower answer: remove up to five fate from enemy characters.
    'consumed-by-five-fires': entry('consumed-by-five-fires', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        abilityValue: true,
        summary: 'remove up to 5 fate from the opponent\'s tower',
        // The card says "up to 5", but the old gate demanded five removable fate
        // spread across the board. Measured over 90 games: that clause passed in
        // 4 of 491 windows and never once in the same window as the five own
        // fate the card costs, so it was played ZERO times. The opponent's whole
        // board rarely holds five fate — their TOWER holds three, and emptying
        // it discards the character along with every attachment and the honored
        // token they spent on it. It also needs a Shugenja of ours, which the
        // old gate never checked; the role restriction is deck-building only and
        // is correctly absent here.
        shouldPlay: gated('consumed-by-five-fires',
            (ctx) => (ctx.fate ?? 0) >= 5 && ctx.myCharacters.some(isShugenja) &&
                (fiveFiresBestKill(ctx) >= FIVE_FIRES_MIN_KILL_VALUE ||
                    fiveFiresBoardFate(ctx) >= 5),
            (ctx) => (ctx.fate ?? 0) >= 5 && fiveFiresBoardFate(ctx) >= 5)
    }),

    // Bow an own home Shugenja to honor a participant.
    'benten-s-touch': entry('benten-s-touch', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        // Same arithmetic as Way of the Crane: honored adds glory to both
        // skills. The Shugenja it bows is required to be at home by the gate
        // below, so nothing is subtracted from the live total.
        conflictContribution: priced('benten-s-touch', (ctx) => {
            const best = readyParticipants(ctx.myCharacters)
                .filter((card) => !card.isHonored)
                .reduce((top, card) => Math.max(top, gloryOf(card)), 0);
            return best > 0 ? best : null;
        }),
        summary: 'bow a home Shugenja: honor a participant',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => !card.bowed && !card.inConflict &&
            PHOENIX_SHUGENJA.includes(card.id)) &&
            participating(ctx.myCharacters).some((card) => !card.isHonored)
    }),

    // Political conflict: honor an own participant (or the opponent
    // dishonors one of theirs — both outcomes fine, we pick honor).
    'court-games': entry('court-games', {
        conflictTypes: ['political'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'political: honor an own participant',
        shouldPlay: (ctx) => participating(ctx.myCharacters).some((card) => !card.isHonored) ||
            participating(ctx.opponentCharacters).some((card) => !card.isDishonored)
    }),

    // Political duel: honor the winner, dishonor the loser. Steered by the
    // policy (our best political vs their strongest beatable target) and bid
    // via DuelTactics.
    'game-of-sadane': entry('game-of-sadane', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'political duel: honor the winner, dishonor the loser',
        shouldPlay: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Move an enemy participant home (must be weaker than an own Bushi).
    'rout': entry('rout', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'move an enemy participant home',
        shouldPlay: (ctx) => participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // +X/+X where X = own Shugenja in play — the swarm pump.
    'supernatural-storm': entry('supernatural-storm', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        // X counts every Shugenja we CONTROL, participating or not. The old
        // reading counted only the hand-listed Phoenix ids, so an allied or
        // splashed Shugenja was worth nothing; the trait is the printed rule.
        conflictContribution: priced('supernatural-storm',
            (ctx) => readyParticipants(ctx.myCharacters).length > 0
                ? ctx.myCharacters.filter(isShugenja).length
                : 0,
            (ctx) => ctx.myCharacters.filter((card) => PHOENIX_SHUGENJA.includes(card.id)).length),
        summary: '+X/+X on a participant, X = own Shugenja count',
        shouldPlay: gated('supernatural-storm',
            (ctx) => ctx.myCharacters.filter(isShugenja).length >= 2 &&
                readyParticipants(ctx.myCharacters).length > 0,
            (ctx) => ctx.myCharacters.filter((card) =>
                PHOENIX_SHUGENJA.includes(card.id)).length >= 2)
    }),

    // Set a participating Shugenja's BASE skills to a dynasty-discard
    // character's printed skills. With Fushicho (6/6) in the discard this turns
    // a 1/1 Ethereal Dreamer into the biggest body on the table for one
    // conflict, which is the whole reason the deck feeds its discard.
    //
    // The controller's discard copy flattens a printed DASH to zero, so the
    // number below can only UNDER-state the swing. The real pair is chosen by
    // `RebirthTactics.ancestorPlan`, which has the dash-aware printed table and
    // refuses an ancestor that would copy a dash onto a live participant.
    'my-ancestor-s-strength': entry('my-ancestor-s-strength', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        conflictContribution: priced('my-ancestor-s-strength', (ctx) => {
            const best = discardBodies(ctx)
                .reduce((top, card) => Math.max(top, printedSkillOf(card, ctx.conflictType)), 0);
            if(best <= 0) {
                return null;
            }
            const gain = readyParticipants(ctx.myCharacters)
                .filter(isShugenja)
                .reduce((top, card) => Math.max(top, best - liveSkill(card, ctx.conflictType)), 0);
            return gain > 0 ? gain : null;
        }),
        summary: 'copy a discarded character\'s printed skills onto a participating Shugenja',
        shouldPlay: (ctx) => discardBodies(ctx).length > 0 &&
            readyParticipants(ctx.myCharacters).some(isShugenja)
    }),

    // Dig the top three dynasty cards for Fushicho and swap one into a
    // province, discarding what was there — which is itself recursion fuel.
    // It adds nothing to a running conflict, so the policy plays it from a
    // conflict-phase window with no conflict active rather than mid-fight.
    'walking-the-way': entry('walking-the-way', {
        priority: 7,
        abilityValue: true,
        summary: 'dig the top three dynasty cards into a province',
        shouldPlay: () => false
    }),

    // Lock the opponent out of one ring's element for the rest of the phase.
    // Free, max one per phase, and worth nothing once their conflicts are
    // spent — so the policy fires it before their first declaration.
    'way-of-the-phoenix': entry('way-of-the-phoenix', {
        priority: 7,
        abilityValue: true,
        summary: 'phase: the opponent cannot declare conflicts with one element',
        shouldPlay: () => false
    }),

    // ---- attachments ----

    // Pride: the bearer honors itself every time it wins a conflict.
    'magnificent-kimono': entry('magnificent-kimono', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'pride: bearer honors itself on wins',
        abilityValue: true
    }),

    // Ancestral champion weapon: on Shiba Tsukune it grants "move a
    // participating character home". Attach steered by GloryTactics; the
    // Action aims at their strongest participant.
    'ofushikai': entry('ofushikai', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        attachSide: 'self',
        priority: 7,
        summary: 'champion weapon: move an enemy participant home',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'shiba-tsukune' && card.inConflict &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'ofushikai')) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // ---- stronghold ----

    // Bow: +2 glory on a character for the phase. Target steered by
    // GloryTactics (honored participant for stats, else the biggest ready
    // body for the favor's glory count).
    'isawa-mori-seido': entry('isawa-mori-seido', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'stronghold: +2 glory on a character this phase'
    }),

    // ==================================================================
    // Dragon "Attachments" / Arsenal (EmeraldDB 46aaa220).
    // Build two deep-fate towers, search and recycle attachments, and use
    // Weapon plays to ready Niten Master repeatedly. Target selection and
    // three-slot Restricted handling live in DragonAttachmentTactics.
    // ==================================================================

    'iron-mountain-castle': entry('iron-mountain-castle', {
        priority: 10,
        summary: 'three Restricted slots; reduce an attachment cost by 1'
    }),

    // ---- tower actions and reactions ----

    'togashi-yokuni': entry('togashi-yokuni', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'copy the best printed triggered ability on another character',
        inPlayAction: true,
        conflictPhaseAction: true
    }),

    'niten-master': entry('niten-master', {
        priority: 10,
        summary: 'after a Weapon attaches: ready this tower, twice per round'
    }),

    'mirumoto-raitsugu': entry('mirumoto-raitsugu', {
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 9,
        summary: 'military duel: discard the loser or remove one fate',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) => card.id === 'mirumoto-raitsugu') &&
            participating(ctx.opponentCharacters).length > 0
    }),

    'niten-adept': entry('niten-adept', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'bow an attachment to bow an unattached enemy participant',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) =>
            card.id === 'niten-adept' && (card.attachments || []).length > 0) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed && (card.attachments || []).length === 0)
    }),

    'stoic-rival': entry('stoic-rival', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'dishonor an enemy participant with fewer attachments',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) => card.id === 'stoic-rival') &&
            participating(ctx.opponentCharacters).some((card) => !card.isDishonored)
    }),

    'solitary-hero': entry('solitary-hero', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'while alone, remove fate from other weaker participants',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).filter((card) => card.id === 'solitary-hero').length === 1 &&
            participating(ctx.myCharacters).length === 1 && participating(ctx.opponentCharacters).length > 0
    }),

    // Province Action, usable at ANY water conflict province - our own or the
    // opponent's - because `CardAction.checkProvinceCondition` tests the element
    // of the conflict province, not identity with this card (see the "should
    // work at your opponents water provinces" case in its spec). Attacking
    // bows our own declared characters, so the free ready is most often
    // available on offense.
    'the-pursuit-of-justice': entry('the-pursuit-of-justice', {
        targetSide: 'self',
        targetPreference: 'strongest-bowed',
        priority: 7,
        summary: 'water conflict province: ready our strongest bowed participant',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => (ctx.conflictProvinceElements || []).includes('water') &&
            participating(ctx.myCharacters).some((card) => card.bowed)
    }),

    'agasha-sumiko-2': entry('agasha-sumiko-2', {
        priority: 10,
        summary: 'leaves play: strip enemy honor, fate, and cards where ahead'
    }),

    'kitsuki-yuikimi': entry('kitsuki-yuikimi', {
        priority: 8,
        summary: 'ring fate gained: become immune to enemy triggered targeting'
    }),

    'keen-warrior': entry('keen-warrior', {
        priority: 9,
        summary: 'after seeing enemy hand: draw two, bottom one card'
    }),

    'hiruma-skirmisher': entry('hiruma-skirmisher', {
        priority: 9,
        summary: 'after play: gain covert for the phase'
    }),

    // ---- attachment search / recursion ----

    'agasha-swordsmith': entry('agasha-swordsmith', {
        priority: 9,
        summary: 'search the top five conflict cards for an attachment',
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true
    }),

    'inventive-mirumoto': entry('inventive-mirumoto', {
        priority: 9,
        summary: 'with Water claimed: play an attachment from discard on itself',
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => (ctx.conflictDiscard || []).some((card) => card.type === 'attachment')
    }),

    'illustrious-forge': entry('illustrious-forge', {
        priority: 10,
        summary: 'reveal: put the best top-five attachment into play'
    }),

    // ---- attachments ----

    'tetsubo-of-blood': entry('tetsubo-of-blood', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 10,
        summary: '+4 military tower Weapon; use cost reduction',
        abilityValue: true,
        preConflict: true
    }),

    'jade-tetsubo': entry('jade-tetsubo', {
        targetSide: 'enemy',
        attachSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: '+3 military; bow it to return all fate from a weaker participant',
        abilityValue: true,
        preConflict: true,
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) =>
            (card.attachments || []).some((attachment: any) => attachment.id === 'jade-tetsubo')) &&
            participating(ctx.opponentCharacters).some((card) => (Number(card.fate) || 0) > 0)
    }),

    'adopted-kin': entry('adopted-kin', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 10,
        summary: 'other attachments on the tower gain ancestral',
        abilityValue: true,
        preConflict: true
    }),

    'daimyo-s-favor': entry('daimyo-s-favor', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 10,
        summary: 'bow: next attachment on this character costs 1 less',
        abilityValue: true,
        preConflict: true,
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => (ctx.hand || []).some((card: any) =>
            card.type === 'attachment' && card.id !== 'daimyo-s-favor' &&
            Number(card.cost ?? card.printedCost) > 0)
    }),

    'ancestral-daisho': entry('ancestral-daisho', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 8,
        summary: 'ancestral Restricted +2 military Weapon',
        preConflict: true
    }),

    'kitsuki-s-method': entry('kitsuki-s-method', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 7,
        summary: 'ancestral Restricted +2 political attachment',
        preConflict: true
    }),

    'inscribed-tanto': entry('inscribed-tanto', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 7,
        summary: '+1 military Weapon; Void ring grants ring-effect immunity',
        abilityValue: true,
        preConflict: true
    }),

    'two-heavens-technique': entry('two-heavens-technique', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 8,
        summary: '+1 military; exactly two Weapons grant covert',
        abilityValue: true,
        preConflict: true
    }),

    'pathfinder-s-blade': entry('pathfinder-s-blade', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 9,
        summary: 'cancel the attacked province ability',
        abilityValue: true,
        preConflict: true
    }),

    // Holding moved onto the stronghold province: sacrifice to send home a
    // cheap attacker on the final defense.
    'mountaintop-statuary': entry('mountaintop-statuary', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'at the stronghold: send a cost-2-or-less attacker home',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => !ctx.amAttacker && ctx.strongholdConflict &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // ==================================================================
    // Dragon "Monks In Da High House" (EmeraldDB 4fb91e58, Lion splash).
    // Play many cheap cards per conflict; Togashi Mitsu converts the card
    // volume into extra ring resolutions. See DragonTactics.
    // ==================================================================

    // ---- the build-around ----

    // 5+ cards played in his conflict: resolve any ring as the attacker.
    // Clicked every window — the engine rejects it until the count is
    // reached, and the prompt signature changes as cards are played.
    'togashi-mitsu-2': entry('togashi-mitsu-2', {
        priority: 9,
        summary: '5+ cards played: resolve a ring as the attacker',
        inPlayAction: true,
        // Only offer the action once 5 cards are played — clicking it earlier
        // is rejected by the engine AND blocks the retry for the rest of the
        // window (the attempted-set keeps the stale click), so gate it.
        shouldUseAction: (ctx) => (ctx.cardsPlayed ?? 0) >= 5 &&
            ctx.myCharacters.some((card) => card.id === 'togashi-mitsu-2' && card.inConflict)
    }),

    // 10+ cards played while attacking: break the province outright.
    'togashi-ichi': entry('togashi-ichi', {
        priority: 7,
        summary: '10+ cards played attacking: break the province',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.amAttacker &&
            (ctx.cardsPlayed ?? 0) + (ctx.opponentCardsPlayed ?? 0) >= 10 &&
            ctx.myCharacters.some((card) => card.id === 'togashi-ichi' && card.inConflict)
    }),

    // 3+ cards played in his conflict: draw 1.
    'teacher-of-empty-thought': entry('teacher-of-empty-thought', {
        priority: 7,
        summary: '3+ cards played: draw 1',
        inPlayAction: true,
        shouldUseAction: (ctx) => (ctx.cardsPlayed ?? 0) >= 3 &&
            ctx.myCharacters.some((card) => card.id === 'teacher-of-empty-thought' && card.inConflict)
    }),

    // Honor itself for 1 fate — a 1-cost body that fights above its cost.
    'togashi-initiate': entry('togashi-initiate', {
        priority: 6,
        summary: 'pay 1 fate: honor itself',
        inPlayAction: true,
        shouldUseAction: (ctx) => (ctx.fate ?? 0) >= 2 && ctx.myCharacters.some((card) =>
            card.id === 'togashi-initiate' && card.inConflict && !card.isHonored)
    }),

    // Reaction: returns from the dynasty discard when VOID is claimed.
    'keeper-initiate': entry('keeper-initiate', {
        priority: 8,
        summary: 'void claimed: return from the dynasty discard to play'
    }),

    // Action: discard an attachment (their buff or a debuff on ours).
    'miya-mystic': entry('miya-mystic', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'discard an attachment',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.opponentCharacters.some((card) =>
            (card.attachments || []).length > 0)
    }),

    // Action: opponent discards a random card.
    'kitsuki-investigator': entry('kitsuki-investigator', {
        priority: 7,
        summary: 'opponent discards a card',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'kitsuki-investigator' && card.inConflict)
    }),

    // Action before attacking: stack fate onto a ring, then attack it.
    'tranquil-philosopher': entry('tranquil-philosopher', {
        priority: 6,
        summary: 'move fate onto a ring before attacking it',
        inPlayAction: true,
        dynastyAction: true,
        // Its "move 1 fate between two rings" action has no per-use limit and
        // reverses itself, so cap it at once per round to stop a fate ping-pong.
        oncePerRound: true
    }),

    // ---- Kiho / conflict events ----

    // +2 military on a Monk and draw 1 — pure value.
    'hurricane-punch': entry('hurricane-punch', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        // No ready Monk in the conflict means the pump has nowhere to land; the
        // card still draws, which `abilityValue` keeps playable as a cantrip.
        conflictContribution: priced('hurricane-punch',
            (ctx) => readyParticipants(ctx.myCharacters).some(hasMonkTrait) ? 2 : 0, 2),
        abilityValue: true,
        summary: '+2 military on a Monk, draw 1'
    }),

    // 2+ cards played: bow an enemy (military <= our monk) and send it home.
    'void-fist': entry('void-fist', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: '2+ cards played: bow and send home an enemy',
        shouldPlay: (ctx) => {
            if((ctx.cardsPlayed ?? 0) < 2) {
                return false;
            }
            // Void Fist only requires a participating Monk; that Monk may
            // already be bowed and can still enable a profitable enemy target.
            const strongestMonk = participating(ctx.myCharacters)
                .filter(hasMonkTrait)
                .reduce((maximum, card) => Math.max(maximum, liveSkill(card, 'military')), -1);
            return strongestMonk >= 0 && readyParticipants(ctx.opponentCharacters)
                .some((card) => liveSkill(card, 'military') <= strongestMonk);
        }
    }),

    // Own monk will not bow out of the conflict; honors him after a Kiho.
    'swell-of-seafoam': entry('swell-of-seafoam', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'monk does not bow from resolution (+honor after a Kiho)',
        abilityValue: true
    }),

    // Cannot be bowed by enemy effects; draws if a Kiho was played first.
    'iron-foundations-stance': entry('iron-foundations-stance', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'monk cannot be bowed by effects; draw after a Kiho',
        abilityValue: true
    }),

    // Remove an attachment.
    'let-go': entry('let-go', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'discard an attachment',
        abilityValue: true,
        shouldPlay: (ctx) => (ctx.opponentCharacters || []).some((card) =>
            (card.attachments || []).length > 0) ||
            (ctx.myCharacters || []).some((card) => (card.attachments || [])
                .some((attachment: any) => isNegativeAttachmentId(attachment.id)))
    }),

    // Interrupt: cancel an enemy event by winning a military duel. It is an
    // INTERRUPT — never a proactive play. Without the shouldPlay block the
    // bot clicked it 722 times in 40 games from the conflict window, and the
    // resulting bid-3 duels bled the deck into dishonor losses. The hinted
    // interrupt path ignores shouldPlay, so it still fires when an enemy
    // event actually triggers.
    'defend-your-honor': entry('defend-your-honor', {
        priority: 8,
        summary: 'duel interrupt: cancel an enemy event',
        shouldPlay: () => false
    }),

    // ---- dynasty events (played from provinces in the dynasty phase) ----

    // Shuffle a low-value province card away, refill faceup — digs for Mitsu.
    'cycle-of-rebirth': entry('cycle-of-rebirth', {
        priority: 6,
        summary: 'shuffle a province card away, refill faceup'
    }),

    // Reset every province faceup and take an extra (fateless) dynasty
    // phase — a full re-dig for Mitsu.
    'a-season-of-war': entry('a-season-of-war', {
        priority: 7,
        summary: 'refill all provinces faceup; extra dynasty phase'
    }),

    // Dynasty-phase card flow. Reveal up to two facedown province cards once
    // each round so the rush can keep buying bodies.
    'staging-ground': entry('staging-ground', {
        priority: 8,
        summary: 'turn up to two facedown province cards faceup',
        dynastyAction: true,
        oncePerRound: true
    }),

    // Rally event played directly from a province. LionTactics waits until a
    // newly played positive-glory Bushi exists; generic honor targeting then
    // chooses tower first and highest glory next.
    'honored-veterans': entry('honored-veterans', {
        priority: 8,
        targetSide: 'self',
        targetPreference: 'strongest',
        summary: 'honor a Bushi played during this dynasty phase'
    }),

    // ---- attachments ----

    // Free +1/+1-per-card engine (played as an attachment by preference).
    'togashi-acolyte': entry('togashi-acolyte', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'attachment mode: +1/+1 per card played in its conflict'
    }),

    // Kiho/Tattoo tutor on declare (attachment mode).
    'ancient-master': entry('ancient-master', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'attachment mode: tutor a Kiho/Tattoo on declare'
    }),

    // Covert (attachment mode) — locks a defender out.
    'tattooed-wanderer': entry('tattooed-wanderer', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'attachment mode: bearer gains covert',
        abilityValue: true,
        preConflict: true,
        maxCopiesPerTarget: 1
    }),

    // Move the bearer to the conflict (or home) + stats.
    'hawk-tattoo': entry('hawk-tattoo', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: '+1/+1; move the bearer into conflicts',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            !card.inConflict && !card.bowed &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'hawk-tattoo'))
    }),

    // Bearer does not bow when losing a conflict.
    'centipede-tattoo': entry('centipede-tattoo', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'bearer does not bow when losing',
        abilityValue: true
    }),

    // Sacrifice-interrupt: cancels a debuff landing on the bearer. Attach to
    // the key character (steered to Mitsu).
    'finger-of-jade': entry('finger-of-jade', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 6,
        summary: 'cancels a debuff on the bearer (sacrifice)',
        abilityValue: true,
        preConflict: true
    }),

    // Trigger the bearer's ability a second time — Mitsu resolves two rings.
    'way-of-the-dragon': entry('way-of-the-dragon', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'bearer triggers its ability twice (Mitsu!)',
        abilityValue: true
    }),

    // ---- holdings ----

    // Sacrifice: draw 1. The card engine always wants cards.
    'imperial-storehouse': entry('imperial-storehouse', {
        priority: 6,
        summary: 'sacrifice: draw 1',
        inPlayAction: true
    }),

    // ---- keeper roles (mirror the seeker entries: free fate reactions) ----
    'keeper-of-air': entry('keeper-of-air', {
        priority: 8,
        summary: 'gain 1 fate after winning an air conflict on defense'
    }),
    'keeper-of-earth': entry('keeper-of-earth', {
        priority: 8,
        summary: 'gain 1 fate after winning an earth conflict on defense'
    }),
    'keeper-of-fire': entry('keeper-of-fire', {
        priority: 8,
        summary: 'gain 1 fate after winning a fire conflict on defense'
    }),
    'keeper-of-water': entry('keeper-of-water', {
        priority: 8,
        summary: 'gain 1 fate after winning a water conflict on defense'
    }),
    'keeper-of-void': entry('keeper-of-void', {
        priority: 8,
        summary: 'gain 1 fate after winning a void conflict on defense'
    }),

    // ==================================================================
    // Upgraded Crane Duels (EmeraldDB e2e443b5). Few durable honored
    // duelists; every duel is value. See DuelTactics.
    // ==================================================================

    // ---- duel initiators: characters ----

    // Forced military duel after defenders are declared. The engine triggers
    // it automatically; do not expose it as a clickable Action.
    'arrogant-kakita': entry('arrogant-kakita', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'forced military duel after defenders are declared'
    }),

    // Military duel action.
    'aspiring-challenger': entry('aspiring-challenger', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'military duel action',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'aspiring-challenger' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Political duel action.
    'courtly-challenger': entry('courtly-challenger', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'political duel action',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'courtly-challenger' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Political duel; the WINNER's controller triggers the attacked
    // province's action (even the enemy's) — pure value, use every time.
    'cunning-negotiator': entry('cunning-negotiator', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'political duel: winner triggers the attacked province',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'cunning-negotiator' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Conflict-deck character: political duel, then bow/send home the loser.
    'arbiter-of-authority': entry('arbiter-of-authority', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'political duel: bow and send home the loser',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'arbiter-of-authority' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Military duelist who can move enemy characters home.
    'kakita-kaezin': entry('kakita-kaezin', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'military duel: move the loser home',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'kakita-kaezin' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Political duelist: winner locks the enemy out of declaring military.
    'kakita-yuri': entry('kakita-yuri', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'political duel: enemy cannot declare military',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'kakita-yuri' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // ---- other character actions/reactions ----

    'brash-samurai': entry('brash-samurai', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'honor itself while it is the only friendly participant',
        inPlayAction: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).length === 1 &&
            participating(ctx.myCharacters)[0].id === 'brash-samurai' &&
            !participating(ctx.myCharacters)[0].isHonored
    }),

    'savvy-politician': entry('savvy-politician', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'after being honored, honor another valuable character'
    }),

    'kakita-yoshi-2': entry('kakita-yoshi-2', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'political attack win: dishonor enemy characters'
    }),

    // While attacking: drag a ready home defender into an attack which is
    // already breaking. It cannot then defend the Crane player's next
    // conflict, so this utility action must happen before the normal
    // "already breaking, pass" shortcut.
    'doji-challenger': entry('doji-challenger', {
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'attacking: move an enemy character into the conflict',
        inPlayAction: true,
        actionBeforePass: true,
        shouldUseAction: (ctx) => ctx.amAttacker && !ctx.losing &&
            (ctx.conflictsRemaining || 0) >= 1 && (ctx.strengthNeeded ?? 0) <= 0 &&
            ctx.opponentCharacters.some((card) => !card.bowed && !card.inConflict)
    }),

    // Participating Action: tax the opponent's immediate card play after our
    // attack/defense is already safe. The bot then passes instead of paying
    // its own tax. The printed Action is unlimited, but one use per round is
    // enough and prevents two Guardians from creating an action loop.
    'graceful-guardian': entry('graceful-guardian', {
        priority: 7,
        summary: 'while participating and secure, tax the opponent next card play',
        inPlayAction: true,
        actionBeforePass: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => !ctx.losing && (ctx.strengthNeeded ?? 0) <= 0 &&
            (ctx.opponentHandSize ?? 0) > 0 && ctx.myCharacters.some((card) =>
                card.id === 'graceful-guardian' && card.inConflict)
    }),

    // Bow an enemy with lower military — aim at their strongest legal.
    'doji-kuwanan': entry('doji-kuwanan', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'bow an enemy with lower military',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'doji-kuwanan' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Turn a facedown own province faceup (dig out Magistrate Station).
    'daidoji-nerishma': entry('daidoji-nerishma', {
        priority: 5,
        summary: 'turn an own facedown province faceup',
        inPlayAction: true,
        dynastyAction: true
    }),

    // Military win reaction: discard an enemy card. Always.
    'daidoji-harrier': entry('daidoji-harrier', {
        conflictTypes: ['military'],
        priority: 8,
        summary: 'military win: discard an enemy card'
    }),

    // Win reaction: both players discard down — we keep fewer, they lose more.
    'daidoji-iron-warrior': entry('daidoji-iron-warrior', {
        priority: 6,
        summary: 'win reaction: both players discard down'
    }),

    // Interrupt on losing a conflict: duel — a win nullifies the conflict.
    'kakita-toshimoko': entry('kakita-toshimoko', {
        priority: 10,
        summary: 'losing interrupt: duel to nullify the conflict'
    }),

    // Covert (steered to their strongest) + reaction: the coverted character
    // cannot attack this phase. Both halves matter.
    'tengu-sensei': entry('tengu-sensei', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'covert their strongest; reaction locks it out of attacking'
    }),

    // ---- events ----

    'gossip': entry('gossip', {
        priority: 10,
        summary: 'name an important card from the known opponent conflict deck',
        abilityValue: true,
        // The Crane profile plays this before a conflict, where its phase-long
        // restriction covers every following conflict window.
        shouldPlay: () => false
    }),

    // Dishonor a character involved in a duel.
    'insult-to-injury': entry('insult-to-injury', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'dishonor a duel participant'
    }),

    // Military duel through Issue a Challenge.
    'issue-a-challenge': entry('issue-a-challenge', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 7,
        summary: 'military duel event'
    }),

    // Political duel; our duelist gains 1 fate — durability.
    'make-your-case': entry('make-your-case', {
        conflictTypes: ['political'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'political duel: our character gains 1 fate',
        shouldPlay: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed)
    }),

    // Political duel; the loser's controller discards a card.
    'policy-debate': entry('policy-debate', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'political duel: loser discards',
        shouldPlay: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Bow (and for 1 fate dishonor) a character that lost a duel.
    'storied-defeat': entry('storied-defeat', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        requiresPreferredTarget: true,
        summary: 'bow (+dishonor) a duel loser'
    }),

    // Political duel; the loser moves INTO the conflict (drag a weak body in).
    'disparaging-challenge': entry('disparaging-challenge', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'political duel: loser moves into the conflict'
    }),

    // Military duel: discards the loser outright if it is dishonored.
    'duel-to-the-death': entry('duel-to-the-death', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'duel: a dishonored loser is discarded from play',
        shouldPlay: (ctx) => participating(ctx.opponentCharacters).some((card) => card.isDishonored)
    }),

    // Honor the highest-glory unhonored Crane, enabling the duel deck's
    // stronghold stats, Voice of Honor, and Noble Sacrifice setup.
    'way-of-the-crane': entry('way-of-the-crane', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        // An honored character adds its glory to BOTH skills, so the swing on
        // the live conflict is exactly the target's glory — and only if that
        // target is contributing. Honoring a home body is still worth doing,
        // hence `abilityValue`.
        conflictContribution: priced('way-of-the-crane', (ctx) => readyParticipants(ctx.myCharacters)
            .filter((card) => !card.isHonored)
            .reduce((best, card) => Math.max(best, gloryOf(card)), 0)),
        summary: 'honor our best unhonored Crane character',
        abilityValue: true,
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => !card.isHonored)
    }),

    // Trade the least valuable honored body for a materially better
    // dishonored enemy. Target sequencing is specialized in the policy:
    // first its own sacrifice cost, then the opposing discard effect.
    'noble-sacrifice': entry('noble-sacrifice', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'trade a cheap honored body for a valuable dishonored enemy',
        abilityValue: true,
        shouldPlay: (ctx) => {
            const sacrifices = ctx.myCharacters.filter((card) => card.isHonored)
                .sort((a, b) => characterValue(a) - characterValue(b));
            const victims = ctx.opponentCharacters.filter((card) => card.isDishonored)
                .sort((a, b) => characterValue(b) - characterValue(a));
            return sacrifices.length > 0 && victims.length > 0 &&
                characterValue(victims[0]) > characterValue(sacrifices[0]);
        }
    }),

    // Duelist in a military conflict does not bow at resolution.
    'kakita-s-final-stance': entry('kakita-s-final-stance', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'dueling character does not bow from resolution',
        abilityValue: true
    }),

    // ---- attachments (land on key duelists; singleton utility spreads) ----

    'daimyo-s-gunbai': entry('daimyo-s-gunbai', {
        targetSide: 'enemy',
        targetPreference: 'weakest',
        attachSide: 'self',
        priority: 7,
        summary: 'duel action attachment; +2 to duel winners',
        abilityValue: true,
        // Gunbai's Action exists only while it is in hand. The opponent picks
        // its duel target and the attachment goes to the winner, so reveal it
        // only when our best participant beats every target they can choose.
        shouldPlay: (ctx) => {
            const mine = readyParticipants(ctx.myCharacters);
            const theirs = participating(ctx.opponentCharacters).filter((card) => !card.bowed);
            if(mine.length === 0 || theirs.length === 0) {
                return false;
            }
            return Math.max(...mine.map((card) => liveSkill(card, 'military'))) >
                Math.max(...theirs.map((card) => liveSkill(card, 'military')));
        }
    }),

    'duelist-training': entry('duelist-training', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        attachSide: 'self',
        priority: 9,
        summary: 'grants a military duel action',
        abilityValue: true,
        maxCopiesPerTarget: 1,
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.inConflict && !card.bowed &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'duelist-training')) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Champion weapon: switch the conflict type.
    'shukujo': entry('shukujo', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'champion weapon: switch the conflict type',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const own = participating(ctx.myCharacters);
            const enemy = participating(ctx.opponentCharacters);
            const current = ctx.conflictType;
            const other = current === 'military' ? 'political' : 'military';
            const margin = (axis: 'military' | 'political') =>
                own.reduce((sum, card) => sum + liveSkill(card, axis), 0) -
                enemy.reduce((sum, card) => sum + liveSkill(card, axis), 0);
            return own.some((card) => card.id === 'doji-kuwanan') && margin(other) > margin(current);
        }
    }),

    'above-question': entry('above-question', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 9,
        summary: 'protect a persistent character from opponent events',
        abilityValue: true,
        maxCopiesPerTarget: 1
    }),

    // +2 political in duels; reaction: +1 honor on duel wins. Always fire.
    'kakita-blade': entry('kakita-blade', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'duel weapon; +1 honor on duel wins'
    }),

    // Post-reveal bid nudge. DuelBidTactics gates the reaction on the actual
    // post-reveal margin and chooses increase/decrease without wasting honor;
    // the controller also reports whether its once-per-round use remains.
    'iaijutsu-master': entry('iaijutsu-master', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'after dials: nudge our duel bid by 1',
        abilityValue: true,
        maxCopiesPerTarget: 1
    }),

    // ---- holdings / provinces ----

    // Duel action for characters without one.
    'kakita-dojo': entry('kakita-dojo', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'holding: military duel; a Duelist winner bows the loser',
        inPlayAction: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Draw after duels resolve.
    'proving-ground': entry('proving-ground', {
        priority: 8,
        summary: 'draw after a duel resolves'
    }),

    // Ready an honored character.
    'magistrate-station': entry('magistrate-station', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'province: ready an honored character'
    }),

    // Stronghold reaction: honor our character after every resolved duel.
    'kyuden-kakita': entry('kyuden-kakita', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'stronghold: honor our duelist after a duel'
    }),

    // ---- Scorpion "Bid War" (Kyuden Bayushi, EmeraldDB 2bf73f61) ----------
    //
    // Every gate below reads the VISIBLE dials (`myBid`/`opponentBid`,
    // i.e. `player.showBid`). An unknown dial reads as 0 and closes the gate,
    // which keeps the card in hand instead of burning it on a cancel.

    // Bow the stronghold, ready a dishonored friendly character, and at 6 or
    // fewer honor give it +1/+1 for the phase. Gated in the policy through
    // BidWarTactics so the deck knobs stay injectable; the entry only names it.
    'kyuden-bayushi': entry('kyuden-bayushi', {
        targetSide: 'self',
        targetPreference: 'strongest-bowed',
        priority: 8,
        summary: 'stronghold: ready a dishonored friendly character (+1/+1 at 6 or fewer honor)'
    }),

    // Reaction after the honor dials are shown: +1 to our BID MODIFIER. That
    // buys one more card and moves one more honor across the table without
    // touching the visible dial the difference cards read. Both halves are
    // wanted here — the honor is what puts the deck in its band.
    'bayushi-manipulator': entry('bayushi-manipulator', {
        priority: 7,
        optionalDrawCards: 1,
        summary: 'after dials revealed: increase our bid by 1 (one more card, one more honor paid)'
    }),

    // Action at 6 or fewer honor: look at the top 2, keep 1, bottom the other.
    // Pure card selection with no cost, so it is worth firing every round the
    // band is live and the hand is not already saturated.
    'alibi-artist': entry('alibi-artist', {
        priority: 7,
        inPlayAction: true,
        conflictPhaseAction: true,
        actionBeforePass: true,
        optionalDrawCards: 1,
        abilityValue: true,
        summary: 'at 6 or fewer honor: dig 2, keep the better one',
        shouldUseAction: (ctx) => (Number(ctx.honor) || 0) <= 6 && (ctx.hand || []).length <= 9
    }),

    // Interrupt: cancel a PROVINCE's triggered ability while that province
    // still holds a facedown dynasty card. It reads both sides' provinces, so
    // the policy restricts it to the opponent's — cancelling our own province
    // reaction is a pure loss.
    'cursecatcher': entry('cursecatcher', {
        priority: 8,
        summary: 'cancel an opposing province ability (province must hold a facedown card)'
    }),

    // Action: bow this character, give a participating character -2 military.
    // She is 0 military, so bowing her in a MILITARY conflict costs nothing;
    // in a political one it throws away 3 political skill.
    'yogo-asami': entry('yogo-asami', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        abilityValue: true,
        inPlayAction: true,
        requiresPreferredTarget: true,
        conflictContribution: 2,
        summary: 'bow her (0 military) to take 2 military off an enemy participant',
        shouldUseAction: (ctx) => ctx.conflictType === 'military' &&
            ctx.myCharacters.some((card) => card.id === 'yogo-asami' && card.inConflict && !card.bowed) &&
            readyParticipants(ctx.opponentCharacters).some((card) => liveSkill(card, 'military') > 0)
    }),

    // Action: initiate a political duel and BLANK the loser for the conflict.
    // Two payoffs beyond the duel itself — it strips an opposing ability, and
    // the duel forces another honor bid, which is where this deck lives.
    'loyal-challenger': entry('loyal-challenger', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        abilityValue: true,
        inPlayAction: true,
        summary: 'political duel; the loser is blanked for the conflict',
        shouldUseAction: (ctx) => ctx.conflictType === 'political' &&
            ctx.myCharacters.some((card) => card.id === 'loyal-challenger' && card.inConflict && !card.bowed) &&
            readyParticipants(ctx.opponentCharacters).length > 0
    }),

    // Action while participating: swap honor dials with the opponent for the
    // rest of the round. Gated in the policy through BidWarTactics because the
    // decision is entirely about which dial payoff the swap turns on.
    'social-puppeteer': entry('social-puppeteer', {
        priority: 7,
        abilityValue: true,
        inPlayAction: true,
        actionBeforePass: true,
        summary: 'swap honor dials with the opponent (composure, or turn on I Can Swim)'
    }),

    // Action during a political conflict: send a lower-political participant
    // home, then optionally bow it. Removing a defender outright is a bigger
    // swing than any pump this deck holds.
    'bayushi-kachiko': entry('bayushi-kachiko', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        inPlayAction: true,
        requiresPreferredTarget: true,
        summary: 'political: send a weaker participant home and bow it',
        shouldUseAction: (ctx) => ctx.conflictType === 'political' &&
            ctx.myCharacters.some((card) => card.id === 'bayushi-kachiko' && card.inConflict) &&
            readyParticipants(ctx.opponentCharacters).length > 0
    }),

    // The Atonement Kachiko. Her text is a PERSISTENT effect, not a click: in
    // a political conflict she participates in, the opponent's discarded
    // EVENTS become playable from our side, three per round. Everything about
    // her is "buy her, put her in political conflicts".
    'bayushi-kachiko-2': entry('bayushi-kachiko-2', {
        conflictTypes: ['political'],
        priority: 9,
        summary: 'political: play up to 3 events out of the opponent\'s conflict discard'
    }),

    // She adds glory instead of subtracting it while DISHONORED, so every
    // dishonor cost this deck pays wants to land on her and she is 4/4 the
    // moment it does.
    'shosuro-sadako': entry('shosuro-sadako', {
        priority: 8,
        summary: 'wants to be dishonored: adds glory instead of subtracting it'
    }),

    // Action, no cost: discard any character with no fate. The deck's only
    // unconditional removal, and every zero-fate body is a legal target.
    'dispatch-to-nowhere': entry('dispatch-to-nowhere', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        requiresPreferredTarget: true,
        summary: 'discard a character with no fate',
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => (Number(card.fate) || 0) === 0)
    }),

    // Holding Action: dishonor a friendly participant to switch the contested
    // ring with an unclaimed one. Denies the opponent the ring they declared
    // for; the dishonor is nearly free with Shosuro Sadako on the board.
    'acclaimed-geisha-house': entry('acclaimed-geisha-house', {
        priority: 7,
        abilityValue: true,
        inPlayAction: true,
        actionBeforePass: true,
        summary: 'dishonor a friendly participant to switch the contested ring'
    }),

    // Attachment Action: return it to hand and dishonor the bearer. Only worth
    // it on a character that WANTS to be dishonored — Sadako nets +2/+1 and
    // the attachment comes back for reuse.
    'court-mask': entry('court-mask', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        inPlayAction: true,
        actionBeforePass: true,
        summary: '+1/+2; return it to hand to dishonor its bearer'
    }),

    // Cost: dishonor one of our characters. Effect: TAKE an opposing
    // attachment and move it onto that character — removal and a buff at once.
    'calling-in-favors': entry('calling-in-favors', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        // NOT `requiresPreferredTarget`: the FIRST prompt is the cost, which
        // must select one of OUR characters to dishonor, and an enemy-side
        // legality filter rejects every option there.
        summary: 'dishonor a friendly character to steal an opposing attachment',
        shouldPlay: (ctx) => ctx.myCharacters.length > 0 &&
            ctx.opponentCharacters.some((card) => (card.attachments || []).length > 0)
    }),

    // Action in a political conflict with a participating Courtier: set OUR
    // dial to 1 and draw the difference. It pays against a HIGH opposing bid
    // and is dead against a low one, so it is priced off their visible dial.
    'regal-bearing': entry('regal-bearing', {
        conflictTypes: ['political'],
        priority: 9,
        optionalDrawCards: 4,
        abilityValue: true,
        worksWithoutReadyParticipant: true,
        summary: 'political: set our dial to 1 and draw the dial difference',
        shouldPlay: (ctx) => ctx.conflictType === 'political' &&
            regalBearingDraw(ctx) >= 2 &&
            participating(ctx.myCharacters).some((card) => hasTraitNamed(card, 'courtier'))
    }),

    // Action while our dial is strictly HIGHER: discard a dishonored enemy
    // participant outright. The deck's answer to a tower the opponent has sunk
    // fate and attachments into, and the reason it bids high.
    'i-can-swim': entry('i-can-swim', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        requiresPreferredTarget: true,
        conflictContribution: (ctx) => canSwimTarget(ctx)
            ? Math.max(liveSkill(canSwimTarget(ctx), ctx.conflictType), 1)
            : 0,
        summary: 'our dial higher: discard a dishonored enemy participant',
        shouldPlay: (ctx) => !!canSwimTarget(ctx)
    }),

    // Action: -X/-X on an enemy participant where X is the dial difference.
    // Always a MINUS regardless of which side bid higher, and dead on a tie —
    // the generic entry above priced it as if X were always worth having.
    'way-of-the-scorpion': entry('way-of-the-scorpion', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        requiresPreferredTarget: true,
        // A dishonored character loses its glory from both skills, so the
        // swing is the target's glory — capped by the skill it actually has.
        conflictContribution: (ctx) => {
            const target = readyParticipants(ctx.opponentCharacters)
                .filter((card) => !card.isDishonored)
                .sort((a, b) => gloryOf(b) - gloryOf(a))[0];
            return target ? Math.min(gloryOf(target), liveSkill(target, ctx.conflictType)) : 0;
        },
        summary: 'dishonor a participating non-Scorpion character',
        shouldPlay: (ctx) => readyParticipants(ctx.opponentCharacters)
            .some((card) => !card.isDishonored)
    }),

    // Province Action at a FIRE province: +3 glory on a participant. On a
    // DISHONORED character that is -3/-3, which is how this deck uses it; on
    // our own honored body it is +3/+3. The policy picks the side.
    'honor-s-reward': entry('honor-s-reward', {
        targetSide: 'either',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'fire province: +3 glory (i.e. -3/-3 on a dishonored character)'
    }),

    // Interrupt on the break: look at the attacking player's hand and discard
    // EVERY copy of one card. Ranked in the policy through BidWarTactics —
    // two copies of a medium card can beat one copy of a strong one.
    'upholding-authority': entry('upholding-authority', {
        priority: 8,
        summary: 'on break: strip every copy of one card from the attacker\'s hand'
    }),

    // Reaction: after this character wins a conflict, sacrifice it to shuffle a
    // discard pile back into its deck. Against a deck with no discard payoff it
    // is a 1-cost body, so the sacrifice only fires to refill OUR conflict deck.
    'slovenly-scavenger': entry('slovenly-scavenger', {
        priority: 4,
        summary: 'sacrifice after a win to shuffle a discard pile into its deck'
    }),

    // ---- Lion Honor (Kyuden Ikoma + Kenson no Gakka) ---------------------
    //
    // A 25-HONOR RACE, not a conquest deck. Every entry below is a faucet or a
    // brake, and none of these ids appears in any other shipped list, so the
    // entries are globally safe without `DECK_SCOPED_PLAYBOOK_ENTRIES`.

    // Province reaction: after we LOSE a conflict here, honor EVERY defending
    // character. Losing is the trigger, so this is the one province the deck
    // wants attacked — it is also the stronghold province, which is why the
    // defense is sized to prevent the BREAK rather than to win.
    'kenson-no-gakka': entry('kenson-no-gakka', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'lost conflict here: honor every defending character'
    }),

    // Reaction after an opponent's ability or ring effect dishonors one of
    // ours: TAKE 2 honor. A 4-point swing, entirely on their clock, so the
    // body only has to be on the table.
    'ardent-omoidasu': entry('ardent-omoidasu', {
        priority: 9,
        summary: 'they dishonor one of ours: take 2 honor from them'
    }),

    // Reaction after an opponent's card or ring effect costs us honor: honor a
    // character. Turns their honor removal into our honor income.
    'righteous-samurai': entry('righteous-samurai', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'we lose honor to their effect: honor one of our characters'
    }),

    // Action while participating: honor a participating character; the
    // opponent draws 1. For a deck whose scoreboard is honor, a card is the
    // cheap half of that trade — but only while there is somebody to honor.
    'bushido-adherent': entry('bushido-adherent', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        inPlayAction: true,
        summary: 'honor a participating character (opponent draws 1)',
        shouldUseAction: (ctx) => ctx.activeConflict !== false &&
            participating(ctx.myCharacters).some((card) => !card.isHonored)
    }),

    // Action while participating, if a Battlefield is in play: gain 1 honor.
    // The deck runs six Battlefields (three Exposed Courtyard holdings, three
    // Under Amaterasu's Gaze), so the condition is normally live — but it is
    // NOT free to check: neither holdings nor province attachments appear in
    // `myCharacters`, which is why `battlefieldInPlay` exists.
    'chronicler-of-conquests': entry('chronicler-of-conquests', {
        priority: 8,
        inPlayAction: true,
        abilityValue: true,
        summary: 'conflict + a Battlefield in play: gain 1 honor',
        shouldUseAction: (ctx) => ctx.activeConflict !== false && ctx.battlefieldInPlay === true
    }),

    // Action while participating and behind on cards: gain 1 honor, or take a
    // point of strength off the attacked province. The honor is the win
    // condition; `LionHonorTactics.heroPrefersHonorOverStrength` owns the one
    // case that flips it (exactly one point short of a break).
    'hero-of-three-trees': entry('hero-of-three-trees', {
        priority: 8,
        inPlayAction: true,
        abilityValue: true,
        summary: 'fewer cards than opponent: gain 1 honor, or -1 province strength',
        shouldUseAction: (ctx) => ctx.activeConflict !== false &&
            (ctx.hand?.length ?? 0) < (ctx.opponentHandSize ?? 0)
    }),

    // Action: if we have gained 2+ honor this phase, gain 1 fate. The engine
    // owns the "this phase" bookkeeping, so the gate here only avoids a click
    // in a phase where nothing could have moved the track; `oncePerRound`
    // stops the unlimited Action from looping.
    'revered-ikoma': entry('revered-ikoma', {
        priority: 7,
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true,
        abilityValue: true,
        summary: 'gained 2+ honor this phase: gain 1 fate'
    }),

    // Action while ATTACKING: sacrifice it to resolve the contested ring's
    // effect as though we had won as the attacker. On air that is 2 honor we
    // do not have to win the conflict for — and it stacks with actually
    // winning it. The body is a 1/1, so the sacrifice is nearly free.
    'kami-unleashed': entry('kami-unleashed', {
        priority: 8,
        inPlayAction: true,
        abilityValue: true,
        summary: 'sacrifice while attacking: resolve the contested ring effect',
        shouldUseAction: (ctx) => ctx.activeConflict !== false && !!ctx.amAttacker &&
            participating(ctx.myCharacters).some((card) => card.id === 'kami-unleashed')
    }),

    // Holding Action during a MILITARY conflict: mill 2 and play an event out
    // of our own conflict discard as if it were in hand. A free card every
    // military conflict, and this deck's discard fills with cheap honor events.
    'exposed-courtyard': entry('exposed-courtyard', {
        conflictTypes: ['military'],
        priority: 8,
        inPlayAction: true,
        abilityValue: true,
        optionalAbilityConflictDeckCardsConsumed: 2,
        summary: 'military conflict: play an event from our conflict discard free',
        shouldUseAction: (ctx) => ctx.activeConflict !== false &&
            ctx.conflictType === 'military' &&
            (ctx.conflictDeckConsumptionAllowed ? ctx.conflictDeckConsumptionAllowed(2) : true)
    }),

    // Action during a conflict while behind on cards: their events cost 1
    // honor each for the rest of it. Pure brake, and the honor lands on our
    // side of the track. Cheap enough to fire on the condition alone.
    'command-respect': entry('command-respect', {
        priority: 8,
        abilityValue: true,
        // No skill: the payoff is a tax on their hand, not a pump.
        conflictContribution: () => null,
        worksWithoutReadyParticipant: true,
        summary: 'fewer cards than opponent: tax their events 1 honor each',
        shouldPlay: (ctx) => (ctx.hand?.length ?? 0) < (ctx.opponentHandSize ?? 0) &&
            (ctx.opponentHandSize ?? 0) > 0
    }),

    // Reaction after honor dials are revealed: every opponent who bid HIGHER
    // than us is capped at one conflict against us this round. The deck's main
    // brake, and the reason it lives at the bid floor. Reaction-only.
    'privileged-position': entry('privileged-position', {
        priority: 9,
        abilityValue: true,
        summary: 'they out-bid us: cap them at one conflict this round',
        shouldPlay: () => false
    }),

    // Reaction after their effect bows one of ours: ready it. Answers the
    // whole bow package (Kyuden Ikoma mirrors included) for free.
    'ready-for-battle': entry('ready-for-battle', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        summary: 'their effect bowed one of ours: ready it',
        shouldPlay: () => false
    }),

    // Dynasty event. "Choose an opponent's province. That opponent selects one
    // - either discard each card in that province, or you gain 2 honor." BOTH
    // branches pay us, so it is played on sight; the target ranking lives in
    // `LionHonorTactics.pickInterferenceProvince`.
    'procedural-interference': entry('procedural-interference', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        summary: 'their province: they discard its cards or give us 2 honor'
    }),

    // Reaction after we declare a MILITARY conflict while more honorable:
    // reveal a second province and fight at both. Two breaks off one attack.
    'a-war-on-two-fronts': entry('a-war-on-two-fronts', {
        conflictTypes: ['military'],
        priority: 8,
        abilityValue: true,
        summary: 'more honorable: the military conflict is at a second province too',
        // Declaration reaction, never an ordinary conflict Action.
        shouldPlay: () => false
    }),

    // Battlefield attachment on an unbroken PROVINCE: every card played from
    // hand at that province costs 1 more, unless that player leads by 5 honor.
    // So it is our card while we hold the lead — and it is also the cheapest
    // way to guarantee Chronicler of Conquests' condition. Zero printed stats.
    'under-amaterasu-s-gaze': entry('under-amaterasu-s-gaze', {
        priority: 7,
        abilityValue: true,
        maxCopiesPerTarget: 1,
        summary: 'province Battlefield: +1 cost to play cards there without a 5-honor lead',
        shouldPlay: (ctx) => (ctx.honor ?? 0) - (ctx.opponentHonor ?? 0) >= 5 ||
            ctx.myCharacters.some((card) => card.id === 'chronicler-of-conquests')
    }),

    // ---- Lion Duelist (Kyuden Ikoma) -------------------------------------
    //
    // Five of these read "if you are more honorable than your opponent", which
    // is why the deck bids into the honor lead rather than for cards.

    // Stronghold reaction: after a character we control LOSES a conflict it
    // attacked, bow the stronghold to bow a non-Champion character. Free — the
    // stronghold has no other ability to spend its ready state on — but only
    // worth a click against a body that is ready and NOT in the conflict, since
    // participants bow on their own when they return home.
    'kyuden-ikoma': entry('kyuden-ikoma', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'lost attack reaction: bow a non-Champion enemy character'
    }),

    // Province Action during a conflict at this province: discard EVERY
    // attachment on one participant. Attachment control that costs no card.
    'frostbitten-crossing': entry('frostbitten-crossing', {
        targetSide: 'either',
        targetPreference: 'strongest',
        priority: 8,
        inPlayAction: true,
        actionBeforePass: true,
        summary: 'strip every attachment off one participating character',
        shouldUseAction: (ctx) => participating(ctx.opponentCharacters)
            .some((card) => stripWeight(card, false) > 0) ||
            participating(ctx.myCharacters).some((card) => stripWeight(card, true) > 0)
    }),

    // Interrupt when this province breaks: draw 3. Losing the province is
    // already priced in by then, so the draw is pure profit.
    'the-art-of-war': entry('the-art-of-war', {
        priority: 9,
        optionalDrawCards: 3,
        summary: 'on break: draw 3 cards'
    }),

    // Reaction after 1+ fate is placed on it (including entering play with
    // fate): gain 1 honor. The deck buys it with exactly one fate — see
    // `LionDuelistProfile.additionalFateByCharacterId`.
    'ikoma-prodigy': entry('ikoma-prodigy', {
        priority: 8,
        summary: 'fate placed: gain 1 honor'
    }),

    // Action while participating and behind on cards: move an OPPONENT
    // character into the conflict. It bows when it returns home, so this is
    // tempo denial — but it also hands them its skill right now, so the gate is
    // "the conflict's outcome can no longer change". Steered by
    // LionDuelistTactics.shouldDragOpponentIn.
    'kitsu-motso': entry('kitsu-motso', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        inPlayAction: true,
        requiresPreferredTarget: true,
        summary: 'drag a ready enemy body into a decided conflict so it bows',
        shouldUseAction: (ctx) => ctx.activeConflict !== false &&
            (ctx.hand?.length ?? 0) < (ctx.opponentHandSize ?? 0) &&
            readyAtHome(ctx.opponentCharacters).length > 0 &&
            // Out of reach, or so far ahead their extra body cannot matter.
            ((ctx.winSkillNeeded ?? 0) > 4 || (ctx.amAttacker && !ctx.losing))
    }),

    // Action while attacking: steal a non-unique holding out of the attacked
    // province. Denies an engine piece permanently and is the reason the deck
    // wants this body against holding decks.
    'akodo-zentaro': entry('akodo-zentaro', {
        priority: 8,
        inPlayAction: true,
        actionBeforePass: true,
        summary: 'attacking: take control of a non-unique holding in the province',
        shouldUseAction: (ctx) => ctx.amAttacker && ctx.activeConflict !== false
    }),

    // Action: bow this character to put ANY character from either discard pile
    // into the conflict, ready. The largest single skill swing the deck has,
    // and it works with every participant bowed.
    'kitsu-spiritcaller': entry('kitsu-spiritcaller', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        inPlayAction: true,
        worksWithoutReadyParticipant: true,
        summary: 'bow: put the best discard-pile character into the conflict',
        shouldUseAction: (ctx) => ctx.activeConflict !== false &&
            (discardBodies(ctx).length > 0 ||
                (ctx.conflictDiscard || []).some((card) => card?.type === 'character')) &&
            ((ctx.winSkillNeeded ?? 0) > 0 || (ctx.strengthNeeded ?? 0) > 0)
    }),

    // Action while attacking and more honorable: move the contested ring to a
    // different province and reveal it. The escape hatch for an attack that
    // cannot break what it is pointed at.
    'matsu-agetoki': entry('matsu-agetoki', {
        priority: 7,
        inPlayAction: true,
        actionBeforePass: true,
        summary: 'attacking: move the conflict to a weaker province',
        shouldUseAction: (ctx) => ctx.amAttacker && moreHonorable(ctx) &&
            ctx.activeConflict !== false && !ctx.strongholdConflict &&
            (ctx.alternateProvincesAvailable ?? 0) > 0 &&
            // Only when the break is genuinely out of reach where we are now.
            // `strengthNeeded` is positive at declaration for nearly every
            // attack, so a bare "> 0" spends the Action before the deck has
            // played anything. The threshold lives in the tactics profile;
            // this constant mirrors its default.
            (ctx.strengthNeeded ?? 0) >= 3
    }),

    // Action during a military conflict while more honorable: move one of OUR
    // characters into the conflict. Pure added skill when a ready body is home.
    'matsu-mitsuko': entry('matsu-mitsuko', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        inPlayAction: true,
        worksWithoutReadyParticipant: true,
        summary: 'military: move a ready character at home into the conflict',
        shouldUseAction: (ctx) => ctx.conflictType === 'military' && moreHonorable(ctx) &&
            ctx.activeConflict !== false && readyAtHome(ctx.myCharacters).length > 0 &&
            ((ctx.winSkillNeeded ?? 0) > 0 || (ctx.strengthNeeded ?? 0) > 0)
    }),

    // Reaction after winning a conflict it attacked, while more honorable:
    // BREAK the attacked province regardless of strength. This is why the
    // deck's attacks are sized to win rather than to out-strength the province
    // — see `LionDuelistProfile.winIsBreakCharacterIds`.
    'matsu-tsuko-2': entry('matsu-tsuko-2', {
        priority: 10,
        summary: 'win as attacker while more honorable: break the province outright'
    }),

    // Conflict character, +2 military while WE hold the fire or water ring.
    // Printed 1/1, so the ring state doubles or triples what it is worth.
    'ikoma-reservist': entry('ikoma-reservist', {
        conflictTypes: ['military'],
        priority: 6,
        summary: 'body: 1 military, 3 while we hold fire or water',
        conflictContribution: priced('ikoma-reservist',
            (ctx) => ctx.conflictType === 'military'
                ? 1 + (holdsRing(ctx, ['fire', 'water']) ? 2 : 0)
                : 1)
    }),

    // Action: put 1 fate on one of our Bushi; the opponent MAY pay us 1 honor
    // to put 1 fate on one of theirs. Keeps a body that would otherwise die in
    // the fate phase. Worthless with no Bushi that needs the fate.
    'called-to-war': entry('called-to-war', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        // No skill this conflict: the payoff is one more round of life.
        conflictContribution: () => null,
        worksWithoutReadyParticipant: true,
        summary: 'place 1 fate on a Bushi (opponent may buy in for 1 honor)',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) =>
            hasTraitNamed(card, 'bushi') && (Number(card.fate) || 0) <= 1)
    }),

    // Action while outnumbered in the conflict: move one of our characters in;
    // honor it if it is a Commander. Both halves are real value, so it is worth
    // playing for the honor alone on a Commander already at home.
    'even-the-odds': entry('even-the-odds', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        worksWithoutReadyParticipant: true,
        conflictContribution: priced('even-the-odds', (ctx) => {
            const best = readyAtHome(ctx.myCharacters)
                .reduce((top, card) => Math.max(top, liveSkill(card, ctx.conflictType)), 0);
            return best > 0 ? best : null;
        }),
        summary: 'outnumbered: move a character in, honor it if a Commander',
        shouldPlay: (ctx) => {
            const counts = ctx.participatingCharacterCounts;
            if(counts && counts.self >= counts.opponent) {
                return false;
            }
            return readyAtHome(ctx.myCharacters).length > 0;
        }
    }),

    // Action: discard any number of attachments and/or status tokens from one
    // of our characters, then honor it if it is a Commander. Three separate
    // payoffs — debuff removal, dishonor removal, and a free honor token.
    'prepare-for-war': entry('prepare-for-war', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        worksWithoutReadyParticipant: true,
        // The gain is glory-scaled (honor) or a removed debuff, neither of
        // which is a flat skill number; leave it unpriced so the play is legal.
        conflictContribution: () => null,
        summary: 'strip debuffs/dishonor from a character and honor a Commander',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) =>
            card.isDishonored ||
            (card.attachments || []).some((attachment: any) => isNegativeAttachmentId(attachment?.id)) ||
            (hasTraitNamed(card, 'commander') && !card.isHonored && gloryOf(card) > 0))
    }),

    // Attachment (glory 2+ bearer). Action during a political conflict: move
    // the bearer into it. Zero printed stats, so it needs `abilityValue`.
    'formal-invitation': entry('formal-invitation', {
        conflictTypes: ['political'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        abilityValue: true,
        maxCopiesPerTarget: 1,
        inPlayAction: true,
        worksWithoutReadyParticipant: true,
        summary: 'political: move the attached character into the conflict',
        shouldUseAction: (ctx) => ctx.conflictType === 'political' &&
            ctx.activeConflict !== false &&
            ctx.myCharacters.some((card) => !card.bowed && !card.inConflict &&
                (card.attachments || []).some((attachment: any) => attachment?.id === 'formal-invitation'))
    }),

    // Attachment. Action while the bearer participates: ready a participating
    // Bushi — usually the bearer's own bowed neighbour, restoring its skill.
    'fan-of-command': entry('fan-of-command', {
        targetSide: 'self',
        targetPreference: 'strongest-bowed',
        priority: 8,
        abilityValue: true,
        maxCopiesPerTarget: 1,
        inPlayAction: true,
        worksWithoutReadyParticipant: true,
        summary: 'ready a participating Bushi',
        shouldUseAction: (ctx) => ctx.activeConflict !== false &&
            ctx.myCharacters.some((card) => card.inConflict &&
                (card.attachments || []).some((attachment: any) => attachment?.id === 'fan-of-command')) &&
            participating(ctx.myCharacters).some((card) => card.bowed && hasTraitNamed(card, 'bushi'))
    }),

    // Attachment. Reaction on every conflict the bearer wins: draw 2, discard
    // 1. Card advantage that does not cost the honor dial anything, which is
    // exactly what a deck that bids 1 needs.
    'setting-the-standard': entry('setting-the-standard', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        maxCopiesPerTarget: 1,
        optionalDrawCards: 2,
        summary: 'bearer wins a conflict: draw 2, discard 1'
    }),

    // Attachment (unique bearer, Restricted). Reaction on a win while more
    // honorable: return any card from our conflict discard to hand. Recurs
    // Regal Bearing and the free events indefinitely.
    'blade-of-10-000-battles': entry('blade-of-10-000-battles', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        abilityValue: true,
        maxCopiesPerTarget: 1,
        summary: 'bearer wins while more honorable: recur a conflict discard card',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => card.isUnique)
    }),

    // ---- Crab "Berserker Sacrifice" (Castle of the Forgotten) -------------
    //
    // A body is a RESOURCE here. Every entry below either spends one, pays for
    // one dying, or keeps one alive through its own death. The ranking of WHICH
    // body is spent lives in `CrabSacrificeTactics`, not here — a PlaybookEntry
    // cannot see the DeckProfile, and hard-coding a per-deck threshold in one is
    // the exact mistake that made the Lion Duelist's Agetoki gate unreachable.

    // ---- sacrifice OUTLETS (each converts a body into something) ----------

    // Action during a conflict: sacrifice ANOTHER character, this one gets +2
    // military. It is also the cheapest body in the deck (cost 0), so it is
    // both an outlet and Tier 2 fodder depending on what else is on the table.
    'silent-skirmisher': entry('silent-skirmisher', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        inPlayAction: true,
        abilityValue: true,
        conflictContribution: 2,
        summary: 'sacrifice another character: +2 military',
        shouldUseAction: (ctx) => {
            const self = ctx.myCharacters.find((card) => card.id === 'silent-skirmisher');
            return !!self && self.inConflict && !self.bowed &&
                readyParticipants(ctx.myCharacters).length >= 2;
        }
    }),

    // Action during a conflict: sacrifice a friendly character, this one gets
    // +3 military. Strictly better rate than Silent Skirmisher, so it fires
    // first when both are live.
    'stoic-gunso': entry('stoic-gunso', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        inPlayAction: true,
        abilityValue: true,
        conflictContribution: 3,
        summary: 'sacrifice a character: +3 military',
        shouldUseAction: (ctx) => {
            const self = ctx.myCharacters.find((card) => card.id === 'stoic-gunso');
            return !!self && self.inConflict && !self.bowed &&
                readyParticipants(ctx.myCharacters).length >= 2;
        }
    }),

    // Action: sacrifice a friendly character, ready any character. Readying a
    // bowed participant lets it fight a second conflict this round, which is
    // the whole plan of a deck that declares three.
    'steadfast-witch-hunter': entry('steadfast-witch-hunter', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        inPlayAction: true,
        abilityValue: true,
        worksWithoutReadyParticipant: true,
        summary: 'sacrifice a character: ready a character',
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) => card.bowed) &&
            ctx.myCharacters.length >= 3
    }),

    // Event: sacrifice a friendly Crab, the opponent must sacrifice a character
    // of their choosing. They pick their worst, so this is a TOWER answer —
    // against a board of one big body they have no cheap out — and dead weight
    // against a wide one.
    'way-of-the-crab': entry('way-of-the-crab', {
        priority: 7,
        abilityValue: true,
        // The cost is a Crab anywhere on our side and the effect hits THEIR
        // board, so a bowed/empty conflict does not make it worse. The shared
        // "no ready participant" veto refused it 25 times per 8 games.
        worksWithoutReadyParticipant: true,
        summary: 'sacrifice a Crab: the opponent sacrifices a character',
        shouldPlay: (ctx) => {
            const theirs = ctx.opponentCharacters || [];
            if(theirs.length === 0 || ctx.myCharacters.length < 2) {
                return false;
            }
            // Only worth a card while their CHEAPEST body is still expensive —
            // that is what "they cannot chump the sacrifice" means.
            const worst = theirs
                .slice()
                .sort((left, right) => liveSkill(left, 'military') - liveSkill(right, 'military'))[0];
            return liveSkill(worst, 'military') >= 3 || theirs.length <= 2;
        }
    }),

    // Event during a military conflict: sacrifice a friendly character, the
    // ATTACKED province gets +X strength where X is that body's military. A
    // defensive outlet — it saves a province rather than winning a conflict —
    // so it only fires while defending and only when it actually saves the
    // break.
    'fulfill-your-duty': entry('fulfill-your-duty', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        abilityValue: true,
        // The break test is `attackerSkill - defenderSkill >= provinceStrength`,
        // so sacrificing a READY PARTICIPANT is exactly neutral: defender skill
        // drops by X and province strength rises by the same X, and the two
        // cancel. The card only gains when the body it eats is contributing
        // ZERO skill right now — a character at home, or a bowed participant
        // (a bowed body adds nothing, `conflict.ts:474`). Those convert dead
        // weight into province strength at full rate.
        //
        // The engine's cost is a bare `sacrifice({ cardType: Character })` with
        // no participation restriction, so a body at home is a legal choice.
        conflictContribution: (ctx) => {
            if(ctx.amAttacker) {
                return null;
            }
            const idle = ctx.myCharacters
                .filter((card) => !card.inConflict || card.bowed)
                .map((card) => liveSkill(card, 'military'))
                .sort((left, right) => right - left);
            return idle.length > 0 ? idle[0] : null;
        },
        // It deliberately eats a body that is contributing nothing, so "none
        // of our participants is ready" is the state it exists for.
        worksWithoutReadyParticipant: true,
        summary: 'sacrifice an idle character: attacked province gets +X strength',
        // Boosting the ATTACKED province while we are the attacker is
        // self-harm, so this is a defence-only card.
        shouldPlay: (ctx) => !ctx.amAttacker &&
            (ctx.strengthNeeded ?? 1) > 0 &&
            ctx.myCharacters.some((card) =>
                (!card.inConflict || card.bowed) && liveSkill(card, 'military') > 0)
    }),

    // ---- sacrifice PAYOFFS (these get paid when a body dies) --------------

    // Interrupt when this character is sacrificed: gain 2 fate. Cost 1 for 2
    // fate is the best rate in the deck, so it is Tier 1 fodder. The interrupt
    // itself is free and always correct.
    'gallant-quartermaster': entry('gallant-quartermaster', {
        priority: 8,
        abilityValue: true,
        summary: 'sacrificed: gain 2 fate'
    }),

    // Courtesy + Sincerity: a fate AND a card when it leaves play, by ANY
    // route. Both keyword reactions are engine-generic; the entry exists so the
    // 1-cost 1-military body is not filtered out as a zero-value buy.
    'kaiu-envoy': entry('kaiu-envoy', {
        priority: 7,
        abilityValue: true,
        optionalDrawCards: 1,
        summary: 'leaves play: gain 1 fate and draw 1 card'
    }),

    // Interrupt when WE sacrifice a character: the opponent bows a character
    // with LOWER military than the sacrificed one. If nothing they control is
    // smaller the ability does nothing, so the target list is computed against
    // the body we actually fed (`CrabSacrificeTactics.fifthTowerBowable`).
    'fifth-tower-watch': entry('fifth-tower-watch', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        summary: 'we sacrifice a character: bow a weaker enemy'
    }),

    // Reaction after another friendly character leaves play during a conflict:
    // DOUBLE this character's military until the end of it. Doubling applies
    // after modifiers, so every pump on this body counts twice — the buff
    // steering in the tactics module aims here first.
    'vengeful-berserker': entry('vengeful-berserker', {
        conflictTypes: ['military'],
        priority: 9,
        abilityValue: true,
        summary: 'a friendly character leaves play: double this military'
    }),

    // Reaction after we break a province during a conflict this character is in:
    // refill every non-stronghold province with a facedown dynasty card. On top
    // of 9 military for 5, which is the real reason it is in the deck.
    'repentant-legion': entry('repentant-legion', {
        priority: 8,
        abilityValue: true,
        summary: 'break while participating: refill all provinces'
    }),

    // Attachment, cost 0, +1 military. Interrupt when the bearer is SACRIFICED:
    // return this to hand. A free permanent buff on a body we intend to feed,
    // so it never actually costs a card.
    'sharpened-tsuruhashi': entry('sharpened-tsuruhashi', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        maxCopiesPerTarget: 1,
        // Cost 0 and it comes back when the bearer is sacrificed, so its worth
        // is the recursion rather than the +1 military the contribution
        // filter can see.
        abilityValue: true,
        worksWithoutReadyParticipant: true,
        summary: 'bearer sacrificed: return this to hand (free +1 military)'
    }),

    // Playable as a character OR as an attachment granting +2/+2 that turns
    // back into a character when the bearer leaves play. As an attachment it is
    // a buff that survives the sacrifice, which is strictly better here.
    'promising-youth': entry('promising-youth', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        abilityValue: true,
        summary: 'attachment +2/+2 that becomes a character when the bearer dies'
    }),

    // ---- bodies -----------------------------------------------------------

    // Dire (+3 military at zero fate) makes this a 6-military body for 3. The
    // profile's `additionalFateByCharacterId` pins it at 0 fate; a fate here is
    // a strict DOWNGRADE, not insurance.
    'damned-hida': entry('damned-hida', {
        priority: 6,
        summary: 'dire: 6 military while it has no fate'
    }),

    // Cannot be declared as attacker or defender at all until its own Action
    // blanks its text box, and that Action costs a friendly body. 6 military
    // for 3 fate afterwards. The blanking must happen BEFORE declaration, so
    // the action is offered in the conflict-phase window as well.
    'tainted-hero': entry('tainted-hero', {
        priority: 8,
        inPlayAction: true,
        conflictPhaseAction: true,
        actionBeforePass: true,
        abilityValue: true,
        summary: 'sacrifice a character: blank own text so it can fight (6 military)',
        shouldUseAction: (ctx) => {
            const self = ctx.myCharacters.find((card) => card.id === 'tainted-hero');
            return !!self && !self.bowed && ctx.myCharacters.length >= 2;
        }
    }),

    // Dire: loses its other non-keyword abilities at zero fate, which is what
    // we want. Declaring it as attacker/defender costs 2 honor on top.
    'unleashed-experiment': entry('unleashed-experiment', {
        priority: 6,
        declareCostsHonor: true,
        summary: 'dire 4 military; declaring it costs 2 honor'
    }),

    // Reaction after the opponent PASSES on declaring a conflict while they
    // control ready characters: put 1 fate on this character. Fate cannot be
    // placed on it any other way, so the reaction is its only growth.
    'one-of-the-forgotten': entry('one-of-the-forgotten', {
        priority: 7,
        abilityValue: true,
        summary: 'opponent passes with ready characters: +1 fate on this'
    }),

    // While attacking, characters with less military than our unbroken province
    // count cannot be declared as defenders. Early — four unbroken provinces —
    // that locks out most of a field board.
    'butcher-of-the-fallen': entry('butcher-of-the-fallen', {
        priority: 7,
        abilityValue: true,
        summary: 'attacking: small characters cannot defend'
    }),

    // 7 military for 4 is the best raw rate in the deck. Forced reaction after
    // it LOSES a conflict: the opponent may pay 1 fate to take control of it.
    // That trade is priced from both sides in `CrabSacrificeTactics` so every
    // deck in the field answers the prompt instead of stalling on it.
    'mercenary-company': entry('mercenary-company', {
        priority: 7,
        summary: '7 military; loses a conflict -> opponent may buy it for 1 fate'
    }),

    // ---- saves (cancel a leave-play, keep the payoff) ---------------------

    // Holding. Interrupt when a friendly character WOULD leave play: sacrifice
    // this holding instead. Used offensively here — sacrifice the biggest body
    // to an outlet, cancel the loss, bank the payoff for free.
    'iron-mine': entry('iron-mine', {
        priority: 8,
        abilityValue: true,
        summary: 'a character would leave play: sacrifice this holding instead'
    }),

    // Attachment doing the same for its bearer. Worth putting on the body we
    // intend to feed repeatedly.
    'reprieve': entry('reprieve', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        abilityValue: true,
        maxCopiesPerTarget: 1,
        worksWithoutReadyParticipant: true,
        summary: 'bearer would leave play: discard this instead',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => !card.bowed)
    }),

    // Event doing the same, but only for a character whose PRINTED cost is at
    // most our unbroken province count — so it is a wide net early and narrows
    // as provinces break.
    'ceaseless-duty': entry('ceaseless-duty', {
        priority: 8,
        abilityValue: true,
        worksWithoutReadyParticipant: true,
        summary: 'a cheap character would leave play: it stays instead',
        shouldPlay: (ctx) => {
            const unbroken = 5 - (ctx.myBrokenProvinces ?? 0);
            const costs = ctx.characterPrintedCosts || {};
            return ctx.myCharacters.some((card) =>
                (Number(costs[card.uuid]) || 0) <= unbroken);
        }
    }),

    // ---- pumps and card draw ---------------------------------------------

    // Action: lose 2 honor, a participating character gets +4 military and
    // cannot be targeted by opponents' abilities. Bigger than Banzai and it
    // dodges removal, but the honor is a real cost in a deck that already
    // bleeds it, so it is gated on the pool.
    'spreading-the-darkness': entry('spreading-the-darkness', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        conflictContribution: 4,
        summary: 'lose 2 honor: +4 military and untargetable',
        // The honor floor is a DECK property, not a card property — this list
        // pays 2 here and 2 more for every Unleashed Experiment declaration out
        // of a starting 10, and lost 70% of its games to dishonor before the
        // floor existed. `canPayHonor` carries the profile's floor; undefined
        // means "no floor", which keeps the legacy reading for other decks.
        shouldPlay: (ctx) => ctx.honor > 6 && ctx.canPayHonor !== false &&
            readyParticipants(ctx.myCharacters).length > 0
    }),

    // Reaction after we break a province with a participating Berserker: draw
    // 3, max 1 per conflict. The deck's only real card engine and almost every
    // body is a Berserker.
    'battle-meditation': entry('battle-meditation', {
        priority: 9,
        abilityValue: true,
        optionalDrawCards: 3,
        summary: 'break with a Berserker participating: draw 3'
    }),

    // Action during a POLITICAL conflict: bow a participating character whose
    // political skill is at most its controller's honor bid. This deck has
    // almost no political skill, so it is used to hollow out THEIR political
    // conflicts rather than to win one.
    'exposed-secrets': entry('exposed-secrets', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        summary: 'political: bow a character with political <= its owner\'s bid',
        shouldPlay: (ctx) => {
            const bid = ctx.opponentBid ?? 0;
            return bid > 0 && participating(ctx.opponentCharacters)
                .some((card) => liveSkill(card, 'political') <= bid);
        }
    }),

    // Dynasty EVENT: during the dynasty phase, every character we play this
    // phase costs 1 less. Dynasty events have no economy path in the shared bot
    // — every dynasty ranker sorts characters only — so without `dynastyAction`
    // three copies sit face-up in their provinces and rot, exactly as three
    // Honored Veterans did for the Lion Duelist list.
    // A CONFLICT event (Limited) whose Action is legal only during the DYNASTY
    // phase, played from hand. The dynasty window looks at provinces only, so
    // it is fired by an explicit hook in the policy before any character is
    // bought — `crab-those-who-serve-discount`. It is never a conflict play.
    'those-who-serve': entry('those-who-serve', {
        priority: 9,
        abilityValue: true,
        summary: 'dynasty phase, from hand: every character costs 1 less this phase',
        shouldPlay: () => false
    }),

    // ---- provinces --------------------------------------------------------

    // Action during a conflict at ANOTHER province we control: move the
    // contested ring here, making this the attacked province. It is a VOID
    // province, so the move also turns Weight of Duty on — that pairing is the
    // deck's removal engine.
    'shrug-off-despair': entry('shrug-off-despair', {
        priority: 8,
        inPlayAction: true,
        actionBeforePass: true,
        abilityValue: true,
        summary: 'move the conflict to this (void) province, enabling Weight of Duty',
        shouldUseAction: (ctx) => !ctx.amAttacker
    }),

    // Action during a conflict at a void province: sacrifice a participating
    // character, then bow AND dishonor an opposing character. Non-unique
    // sacrifice reaches only a non-unique target.
    'weight-of-duty': entry('weight-of-duty', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        inPlayAction: true,
        actionBeforePass: true,
        abilityValue: true,
        summary: 'void province: sacrifice a participant to bow+dishonor an enemy',
        shouldUseAction: (ctx) => participating(ctx.myCharacters).length >= 1 &&
            (ctx.opponentCharacters || []).length > 0
    }),

    // Action during a conflict here: choose an attacker; the opponent either
    // bows it or gives us an honor. Both branches are good, so it fires on the
    // biggest attacker every time. Used as the stronghold province.
    'the-eternal-watch': entry('the-eternal-watch', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        inPlayAction: true,
        actionBeforePass: true,
        abilityValue: true,
        summary: 'bow the strongest attacker, or take 1 honor',
        shouldUseAction: (ctx) => !ctx.amAttacker &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Reaction when attacked: place an honor token, and the province gets +2
    // strength per token. Defending it compounds, so the reaction is free value
    // and always taken.
    'fortified-assembly': entry('fortified-assembly', {
        priority: 8,
        abilityValue: true,
        summary: 'attacked: +1 honor token (province gets +2 strength each)'
    }),

    // Stronghold. Reaction after WE break a province: bow this, every conflict
    // declared this round becomes military. The whole board is military, so
    // this is close to unconditional — but it is worth nothing with no conflict
    // left this round.
    'castle-of-the-forgotten': entry('castle-of-the-forgotten', {
        priority: 9,
        abilityValue: true,
        // A stronghold REACTION fires through `provinceReactionWorthIt`, which
        // never consults `shouldUseAction` — a gate here would be dead code.
        // The real gate is `CrabSacrificeProfile.castleAlwaysAfterBreak` /
        // `castleMinimumConflictsRemaining`, enforced in the policy.
        summary: 'after a break: all conflicts this round are military'
    }),

    // ---- Crane "Courtier Honor" (Seven Fold Palace) -------------------------
    //
    // The whole list is an honor faucet. Two rules make the entries below make
    // sense: an HONORED character that leaves play gains its controller 1 honor
    // (`drawcard.ts:1026`), and an honored character adds its GLORY to both
    // skills. So honoring a body is simultaneously a stat pump, a card (through
    // Asahina Storyteller's granted Sincerity) and a point on the track.

    // Conflict Action needing an own participating Courtier: the opponent
    // chooses whether the target is dishonored or bowed. Both answers help —
    // bowed is the full skill, dishonored is its glory — so the value is the
    // SMALLER of the two, which is what the opponent will pick.
    'for-shame': entry('for-shame', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        conflictContribution: priced('for-shame', (ctx) => {
            if(!participating(ctx.myCharacters).some((card) => hasTraitNamed(card, 'courtier'))) {
                return 0;
            }
            const axis = ctx.conflictType === 'political' ? 'political' : 'military';
            return readyParticipants(ctx.opponentCharacters).reduce((best, card) => {
                // Bowing removes the body's whole skill; dishonoring removes its
                // glory. The opponent picks, so budget for the cheaper of the two.
                const skill = liveSkill(card, axis);
                return Math.max(best, Math.min(skill, gloryOf(card)));
            }, 0);
        }, 2),
        summary: 'Courtier: the opponent must bow or dishonor a participant',
        shouldPlay: (ctx) => participating(ctx.myCharacters)
            .some((card) => hasTraitNamed(card, 'courtier')) &&
            readyParticipants(ctx.opponentCharacters).length > 0
    }),

    // Action while participating in a POLITICAL conflict we are winning on
    // political skill: take 1 honor from the opponent. Two points of honor
    // swing (they lose one, we gain one) for a click, every political conflict
    // she is in — the single best repeatable faucet in the deck.
    'kakita-asami': entry('kakita-asami', {
        conflictTypes: ['political'],
        priority: 10,
        inPlayAction: true,
        actionBeforePass: true,
        abilityValue: true,
        summary: 'political: take 1 honor while we lead the political count',
        shouldUseAction: (ctx) => {
            if(ctx.conflictType !== 'political') {
                return false;
            }
            const asami = participating(ctx.myCharacters)
                .find((card) => card.id === 'kakita-asami');
            if(!asami) {
                return false;
            }
            // The printed condition is a live comparison of the conflict's
            // political totals; the engine re-checks it, so this only avoids a
            // wasted click while we are visibly behind.
            const mine = readyParticipants(ctx.myCharacters)
                .reduce((total, card) => total + liveSkill(card, 'political'), 0);
            const theirs = readyParticipants(ctx.opponentCharacters)
                .reduce((total, card) => total + liveSkill(card, 'political'), 0);
            return mine > theirs;
        }
    }),

    // Holding. Action during an AIR conflict: gain 1 honor. Free, repeatable,
    // and the reason the deck steers every ring choice toward air.
    'bonsai-garden': entry('bonsai-garden', {
        priority: 9,
        inPlayAction: true,
        actionBeforePass: true,
        abilityValue: true,
        summary: 'air conflict: gain 1 honor',
        shouldUseAction: (ctx) => (ctx.conflictRingElements || []).includes('air')
    }),

    // Holding. Action with an own participating Courtier: bounce an attachment
    // off a participant, and lock further copies for the phase. Value is the
    // shared attachment-control policy's — strip our own debuffs, or their
    // best buff.
    'esteemed-tea-house': entry('esteemed-tea-house', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        inPlayAction: true,
        actionBeforePass: true,
        abilityValue: true,
        requiresPreferredTarget: true,
        summary: 'Courtier: return an attachment on a participant to hand',
        shouldUseAction: (ctx) => participating(ctx.myCharacters)
            .some((card) => hasTraitNamed(card, 'courtier')) &&
            participating(ctx.myCharacters).concat(participating(ctx.opponentCharacters))
                .some((card) => (card.attachments || []).length > 0)
    }),

    // 0-cost body. Reaction on entering play: each player reveals a facedown
    // province they do NOT control — so the opponent flips one of OURS, which
    // is how Driven by Courage and Pledge of Loyalty become usable, and we get
    // to see one of theirs. Free both ways; always fire.
    'doji-diplomat': entry('doji-diplomat', {
        targetSide: 'enemy',
        priority: 8,
        abilityValue: true,
        summary: 'entering play: both players reveal an opposing facedown province'
    }),

    // The tower. Unlimited: 1 honor for every card the opponent plays in a
    // conflict she is in, which also taxes their whole answer suite.
    'doji-hotaru-2': entry('doji-hotaru-2', {
        priority: 10,
        abilityValue: true,
        summary: 'gain 1 honor per opposing card played in her conflicts (unlimited)'
    }),

    // Restricted weapon with NO printed stats: the whole card is the 1 honor
    // per conflict its bearer wins, so it needs `abilityValue` or the
    // zero-contribution filter refuses to play it at all.
    'honored-blade': entry('honored-blade', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        abilityValue: true,
        maxCopiesPerTarget: 1,
        summary: 'attached character wins a conflict: gain 1 honor',
        shouldPlay: (ctx) => ctx.myCharacters.length > 0
    }),

    // Action in a MILITARY conflict: +3 glory to a participant. Glory is only
    // skill on a character with a status token, so this is aimed at an HONORED
    // participant (+3 to both skills) and is worth nothing on a plain body.
    'hantei-sotorii': entry('hantei-sotorii', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        inPlayAction: true,
        abilityValue: true,
        summary: 'military: +3 glory to an honored participant (= +3/+3)',
        shouldUseAction: (ctx) => ctx.conflictType === 'military' &&
            participating(ctx.myCharacters).some((card) => card.id === 'hantei-sotorii') &&
            readyParticipants(ctx.myCharacters).some((card) => card.isHonored)
    }),

    // Reaction after playing it: a free Courtier out of the provinces, plus a
    // fate if that Courtier costs 2 or less. Effectively a 4-cost that buys two
    // bodies — and out of Tsuma the second one arrives honored.
    'benevolent-host': entry('benevolent-host', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        abilityValue: true,
        summary: 'entering play: put a Courtier from our provinces into play free'
    }),

    // Interrupt when it leaves play: honor a character we control. Pointed at
    // itself, it is 1 honor on the way out for free (the honored leave-play
    // rule); pointed at a survivor it is a permanent pump.
    'callow-delegate': entry('callow-delegate', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        abilityValue: true,
        summary: 'leaving play: honor one of our characters'
    }),

    // Interrupt when it leaves play: the opponent either hands us an honor or
    // both players discard a card. On an empty-ish hand the discard is the
    // better half; either way it is free, so it always fires.
    'chancellor-s-aide': entry('chancellor-s-aide', {
        priority: 9,
        abilityValue: true,
        summary: 'leaving play: 1 honor from the opponent, or a forced discard'
    }),

    // Interrupt: keep an honored character by discarding its honored TOKEN.
    // That forgoes the 1 honor the leave-play would have paid, so it is only
    // right on a body worth more than one honor — gated in the policy through
    // `CraneHonorTactics.shouldSaveHonoredCharacter`, which can see the profile.
    'stand-your-ground': entry('stand-your-ground', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        worksWithoutReadyParticipant: true,
        summary: 'save an honored character by discarding its honored token',
        // Interrupt-only; it must never be attempted as an ordinary Action.
        shouldPlay: () => false
    }),

    // Ready up to 2 honored characters totalling 6 printed cost or less. A
    // second conflict out of the same bodies, or a ready board for the Favor's
    // glory count. It READIES, so the no-ready-participant veto must not apply.
    'elegance-and-grace': entry('elegance-and-grace', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        worksWithoutReadyParticipant: true,
        conflictContribution: priced('elegance-and-grace', (ctx) => {
            const axis = ctx.conflictType === 'political' ? 'political' : 'military';
            return (ctx.myCharacters || [])
                .filter((card) => card.bowed && card.isHonored && card.inConflict)
                .map((card) => liveSkill(card, axis))
                .sort((left, right) => right - left)
                .slice(0, 2)
                .reduce((total, skill) => total + skill, 0);
        }),
        summary: 'ready up to 2 honored characters (6 printed cost or less)',
        // A ready body is only worth a card if something can still USE it. A
        // bowed PARTICIPANT contributes no skill until it readies, so readying
        // one swings the conflict being fought; a bowed body at home is an
        // attacker for a conflict of ours still to come or a defender for one
        // of theirs. With none of the three the ready is cosmetic — the
        // Imperial Favor counts glory, not ready characters — and the card is
        // spent for nothing. Seen live: two characters readied after the last
        // conflict of the round was already resolved.
        shouldPlay: (ctx) => {
            const targets = (ctx.myCharacters || []).filter((card) => card.bowed && card.isHonored);
            if(targets.length === 0) {
                return false;
            }
            if(ctx.eleganceRequiresUse === false) {
                return true;
            }
            if(targets.some((card) => card.inConflict)) {
                return true;
            }
            return (Number(ctx.conflictsRemaining) || 0) > 0 ||
                (Number(ctx.opponentConflictsRemaining) || 0) > 0;
        }
    }),

    // Starts a political duel between ANY two characters on opposite sides.
    // The point is not the duel: it is the fresh honor bid, which pays the
    // lower bidder — and this deck always bids the floor.
    'return-the-offense': entry('return-the-offense', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        abilityValue: true,
        summary: 'political duel between any two characters: forces a new honor bid',
        shouldPlay: (ctx) => participating(ctx.myCharacters).length > 0 &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Needs an own participating HONORED Courtier; moves an ATTACKING character
    // home. Defence only, and it is the deck's answer to a body it cannot
    // out-skill.
    'try-again-tomorrow': entry('try-again-tomorrow', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        abilityValue: true,
        worksWithoutReadyParticipant: true,
        conflictContribution: priced('try-again-tomorrow', (ctx) => {
            if(ctx.amAttacker) {
                return 0;
            }
            if(!participating(ctx.myCharacters)
                .some((card) => card.isHonored && hasTraitNamed(card, 'courtier'))) {
                return 0;
            }
            const axis = ctx.conflictType === 'political' ? 'political' : 'military';
            return readyParticipants(ctx.opponentCharacters)
                .reduce((best, card) => Math.max(best, liveSkill(card, axis)), 0);
        }),
        summary: 'defence: move the biggest attacker home',
        shouldPlay: (ctx) => !ctx.amAttacker &&
            participating(ctx.myCharacters)
                .some((card) => card.isHonored && hasTraitNamed(card, 'courtier')) &&
            readyParticipants(ctx.opponentCharacters).length > 0
    }),

    // Honor a character we control TWICE. On a dishonored body that is
    // dishonored -> plain -> honored, a double glory swing; on a plain body it
    // is one honor token plus a wasted half.
    'soul-beyond-reproach': entry('soul-beyond-reproach', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        conflictContribution: priced('soul-beyond-reproach', (ctx) => {
            const dishonored = readyParticipants(ctx.myCharacters).filter((card) => card.isDishonored);
            if(dishonored.length > 0) {
                return dishonored.reduce((best, card) => Math.max(best, gloryOf(card) * 2), 0);
            }
            return readyParticipants(ctx.myCharacters)
                .filter((card) => !card.isHonored)
                .reduce((best, card) => Math.max(best, gloryOf(card)), 0);
        }),
        summary: 'honor an own character twice (clears a dishonor, then honors)',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => card.isDishonored || !card.isHonored)
    }),

    // Reaction after an honor bid GIVES us honor: gain that much again. The
    // deck bids the floor on purpose so that this doubles a real number.
    'way-of-the-chrysanthemum': entry('way-of-the-chrysanthemum', {
        priority: 10,
        abilityValue: true,
        summary: 'double the honor received from an honor bid (max 1 per round)',
        // Reaction-only; never an ordinary conflict Action.
        shouldPlay: () => false
    }),

    // Honors EVERY character, both sides. Only pays while we field more
    // unhonored bodies than they do — otherwise it is a 3-cost gift.
    'festival-for-the-fortunes': entry('festival-for-the-fortunes', {
        targetSide: 'self',
        priority: 7,
        abilityValue: true,
        worksWithoutReadyParticipant: true,
        conflictContribution: priced('festival-for-the-fortunes', (ctx) => {
            const mine = readyParticipants(ctx.myCharacters).filter((card) => !card.isHonored);
            const theirs = readyParticipants(ctx.opponentCharacters).filter((card) => !card.isHonored);
            const sum = (cards: any[]) => cards.reduce((total, card) => total + gloryOf(card), 0);
            return Math.max(0, sum(mine) - sum(theirs));
        }),
        summary: 'honor every character — only with a wide own board',
        shouldPlay: (ctx) => {
            const mine = ctx.myCharacters.filter((card) => !card.isHonored);
            const theirs = ctx.opponentCharacters.filter((card) => !card.isHonored);
            return mine.length >= 3 && mine.length - theirs.length >= 1;
        }
    }),

    // Province Action at an AIR province: +2/+2 to a participant. Three of the
    // deck's five provinces are air, and the Seeker of Air role adds a fourth
    // reveal payoff on top.
    'driven-by-courage': entry('driven-by-courage', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        inPlayAction: true,
        actionBeforePass: true,
        abilityValue: true,
        conflictContribution: priced('driven-by-courage',
            (ctx) => readyParticipants(ctx.myCharacters).length > 0 ? 2 : 0, 2),
        summary: 'air province: +2 military and +2 political to a participant',
        shouldUseAction: (ctx) => readyParticipants(ctx.myCharacters).length > 0
    }),

    // Province interrupt when it breaks: take 2 honor from the opponent. A
    // 4-point swing on the track for a province that was breaking anyway, so
    // it is unconditional.
    'before-the-throne': entry('before-the-throne', {
        priority: 9,
        abilityValue: true,
        summary: 'broken: take 2 honor from the opponent'
    }),

    // Province interrupt: keep an honored character by discarding its honored
    // token. Same trade as Stand Your Ground and gated the same way.
    'pledge-of-loyalty': entry('pledge-of-loyalty', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        abilityValue: true,
        summary: 'save an honored character by discarding its honored token'
    }),

    // Stronghold. Reaction after an HONORED character of ours wins a conflict
    // as the ATTACKER: bow this, gain 2 honor. Two honor a round is a quarter
    // of the way to the win every four rounds, and the bow costs nothing the
    // deck uses — this is why the honor list still has to attack.
    'seven-fold-palace': entry('seven-fold-palace', {
        priority: 10,
        abilityValue: true,
        // Stronghold REACTIONS fire through `provinceReactionWorthIt`, which
        // never consults `shouldUseAction`; the printed condition is checked by
        // the engine, so there is nothing left to gate here.
        summary: 'honored attacker won: bow the stronghold for 2 honor'
    })
};

// Own Shugenja printed ids for the Phoenix glory deck — card summaries carry
// no traits, so gates count by id (kept in sync with GLORY_DEFAULTS).
const PHOENIX_SHUGENJA = [
    'adept-of-the-waves', 'asako-tsuki', 'ethereal-dreamer', 'isawa-atsuko',
    'isawa-kaede', 'isawa-tadaka-2', 'isawa-ujina', 'kudaka',
    'prodigy-of-the-waves', 'solemn-scholar', 'young-philosopher'
];

const TADAKA_DISGUISE_COSTS: Record<string, number> = {
    'prodigy-of-the-waves': 4,
    'adept-of-the-waves': 2,
    'young-philosopher': 2,
    'ethereal-dreamer': 1
};

// Cards that mark a wall/holding engine: the Kaiu Wall holdings plus the
// stronghold that digs for characters. Two or more (or the stronghold) flips
// the holdingEngine strategy on.
const HOLDING_ENGINE_MARKERS = [
    'kaiu-forges', 'seventh-tower', 'watchtower-of-valor', 'northern-curtain-wall',
    'third-whisker-warrens', 'river-of-the-last-stand', 'watchtower-of-sun-s-shadow',
    'kyuden-hida'
];

// Win-as-defender payoffs and dedicated blockers that mark a defensive deck.
const DEFENSIVE_MARKERS = [
    'hida-kotoe', 'hida-o-ushi', 'kuni-ritsuko', 'staunch-hida', 'hida-tomonatsu',
    'purifier-apprentice', 'seventh-tower', 'watchtower-of-valor', 'guardians-of-rokugan',
    'hiruma-yojimbo', 'borderlands-defender'
];

// Cards that mark an all-out military-rush deck: extra-conflict / swarm /
// ready / draw payoffs that only make sense when the plan is to attack with
// everything, every window. Three or more flips the aggressive strategy on.
// A generic or defensive deck trips none of these and keeps generic behavior.
const AGGRESSIVE_MARKERS = [
    'cavalry-reserves', 'shiotome-encampment', 'ujik-tactics', 'captive-audience',
    'challenge-on-the-fields', 'golden-plains-outpost', 'ride-on', 'spoils-of-war',
    'curved-blade', 'flank-the-enemy', 'born-in-war',
    // Lion bushi-swarm: won-conflict payoffs and all-in military tools that
    // only pay when the plan is to attack every window.
    'way-of-the-lion', 'for-greater-glory', 'in-service-to-my-lord',
    'right-hand-of-the-emperor', 'a-legion-of-one', 'strength-in-numbers',
    'shori', 'unified-company', 'hayaken-no-shiro'
];

// Cards that mark a dishonor/mill deck: honor-drain payoffs, conflict-deck
// mill, and low-honor enablers. Four or more (or the City of the Open Hand
// stronghold, whose whole point is balancing a low honor total) flips the
// dishonor strategy on. No other piloted deck runs any of these.
const DISHONOR_MARKERS = [
    'city-of-the-open-hand', 'blackmail-artist', 'loyal-oathbreaker', 'shadow-stalker',
    'yogo-outcast', 'compromised-secrets', 'kirei-ko', 'licensed-quarter',
    'master-whisperer', 'midnight-prowler', 'shosuro-hametsu', 'thunder-guard-elite',
    'deserted-shrine', 'silent-ones-monastery'
];

// Cards that mark a glory/honor-engine deck: honoring effects, Imperial
// Favor payoffs, and the glory stronghold. The stronghold (whose whole point
// is pumping glory) or four markers flip the glory strategy on. No other
// piloted deck runs any of these.
const GLORY_MARKERS = [
    'isawa-mori-seido', 'kiku-matsuri', 'magnificent-kimono', 'court-games',
    'benten-s-touch', 'game-of-sadane', 'censure', 'voice-of-honor',
    'asako-diplomat', 'asako-tsuki', 'the-imperial-palace'
];

// Cards that mark the monk/card-engine deck: Kiho volume payoffs, tattoo
// attachments, and the High House of Light stronghold (whose whole point is
// the 5-cards-played bonus).
const MONK_MARKERS = [
    'high-house-of-light', 'togashi-mitsu-2', 'hurricane-punch', 'void-fist',
    'iron-foundations-stance', 'swell-of-seafoam', 'hawk-tattoo',
    'centipede-tattoo', 'way-of-the-dragon', 'shintao-monastery',
    'teacher-of-empty-thought'
];

// Cards that mark the Fushicho rotation deck: the recursion engine itself
// plus the fateless-body payoffs it feeds. Fushicho alone is not enough (the
// Phoenix Shugenja list runs two copies as a plain 6/6 tower) and Forebearer's
// Echoes alone is not either (the Lion Swarm list runs three). The PAIR is
// unique to this deck, and a five-marker count is the fallback for a variant.
const REBIRTH_MARKERS = [
    'fushicho', 'forebearer-s-echoes', 'my-ancestor-s-strength', 'walking-the-way',
    'retire-to-the-brotherhood', 'asako-azunami', 'isawa-tsuke-2', 'isawa-heiko',
    'way-of-the-phoenix', 'inferno-guard-invoker', 'shiba-pureheart'
];

// Cards that mark the Kyuden Bayushi "Bid War" list: honor-dial payoffs, the
// low-honor band enablers, and the attachment/ring control package that hangs
// off deliberately dishonoring our own characters. The stronghold alone
// identifies the deck; the count threshold is the fallback for a variant and
// is deliberately high because the separate Scorpion Poison Mill list shares
// five of these (make-an-opening, duty, forgery, shadow-stalker,
// blackmail-artist) and must keep its own dishonor profile.
const BID_WAR_MARKERS = [
    'kyuden-bayushi', 'regal-bearing', 'make-an-opening', 'i-can-swim',
    'social-puppeteer', 'bayushi-manipulator', 'duty', 'forgery',
    'loyal-challenger', 'alibi-artist', 'shosuro-sadako', 'calling-in-favors',
    'court-mask', 'acclaimed-geisha-house', 'bayushi-kachiko-2',
    'way-of-the-scorpion', 'shadow-stalker', 'blackmail-artist'
];

// Derive the deck's strategy flags from the printed card ids it contains.
// A deck with none of a group's markers gets that flag false and thus the
// unchanged generic behavior; the flags are mutually independent.
export function deriveDeckStrategy(cardIds: Iterable<string>): DeckStrategy {
    const ids = new Set(cardIds);
    const wallCount = HOLDING_ENGINE_MARKERS.filter((id) => ids.has(id)).length;
    const defenderCount = DEFENSIVE_MARKERS.filter((id) => ids.has(id)).length;
    const aggroCount = AGGRESSIVE_MARKERS.filter((id) => ids.has(id)).length;
    const dishonorCount = DISHONOR_MARKERS.filter((id) => ids.has(id)).length;
    const gloryCount = GLORY_MARKERS.filter((id) => ids.has(id)).length;
    const monkCount = MONK_MARKERS.filter((id) => ids.has(id)).length;
    const rebirthCount = REBIRTH_MARKERS.filter((id) => ids.has(id)).length;
    const bidWarCount = BID_WAR_MARKERS.filter((id) => ids.has(id)).length;
    return {
        holdingEngine: ids.has('kyuden-hida') || wallCount >= 2,
        defensive: defenderCount >= 3,
        aggressive: aggroCount >= 3,
        dishonor: ids.has('city-of-the-open-hand') || dishonorCount >= 4,
        glory: ids.has('isawa-mori-seido') || gloryCount >= 4,
        monk: ids.has('high-house-of-light') || monkCount >= 4,
        // Tsuma marks both supported duel lists. The current Crane Baseline
        // intentionally combines this shared package with its own profile.
        duelist: ids.has('tsuma'),
        // Kyuden Isawa uniquely identifies the Spell recursion/ring-control
        // deck without changing the older Phoenix glory strategy.
        shugenja: ids.has('kyuden-isawa'),
        // Iron Mountain Castle uniquely identifies the attachment-tower list
        // without changing the separate High House monk deck.
        attachmentTower: ids.has('iron-mountain-castle'),
        rebirth: (ids.has('fushicho') && ids.has('forebearer-s-echoes')) || rebirthCount >= 5,
        // Kyuden Bayushi uniquely identifies the bid-war list. The Poison Mill
        // list scores 5 markers, so the fallback threshold sits well above it.
        bidWar: ids.has('kyuden-bayushi') || bidWarCount >= 8,
        // Kyuden Ikoma marks BOTH supported Kyuden Ikoma lists, so the duel
        // package additionally requires that this is not the honor list. Kenson
        // no Gakka appears in no other shipped deck, and the duel list does not
        // run it, so this exclusion is bit-identical for Lion Duelist. The
        // older Lion swarm precon runs Hayaken no Shiro / Manicured Garden and
        // was never in scope for either.
        lionDuelist: ids.has('kyuden-ikoma') && !ids.has('kenson-no-gakka'),
        // Castle of the Forgotten uniquely identifies the Berserker Sacrifice
        // list. The Crab Kaiu Wall defense precon runs Kyuden Hida and keeps
        // its holdingEngine/defensive derivation untouched.
        crabSacrifice: ids.has('castle-of-the-forgotten'),
        // Seven Fold Palace uniquely identifies the Courtier Honor list. It
        // shares Tsuma (and therefore the `duelist` package) with both other
        // Crane lists, so the stronghold is the only safe key.
        craneHonor: ids.has('seven-fold-palace'),
        // Kenson no Gakka uniquely identifies the Lion Honor list. It shares
        // Kyuden Ikoma with the Lion Duelist list, so the province — not the
        // stronghold — has to be the key, and `lionDuelist` above excludes it.
        lionHonor: ids.has('kenson-no-gakka')
    };
}

/**
 * Entries written for ONE deck whose card also appears in another shipped list.
 *
 * A `PlaybookEntry` is a static registry keyed by printed card id, so adding one
 * for a new deck silently changes every OTHER deck that runs the same card — and
 * those decks were measured without it. `JigokuBotPolicy.inPlayActionScopedOut`
 * solves this for board Actions; this solves it for the entry itself, which is
 * the only thing that restores the previous behaviour EXACTLY (falling through
 * to the cached LLM analysis, which is what "no entry" meant).
 *
 * Measured, which is why this exists: `for-shame` (also in Scorpion Bid War) and
 * `before-the-throne` (also in Scorpion Poison Mill) changed ~50 of 56 paired
 * games for those decks and moved them −12.5pp and −7.1pp on one base. Scoping
 * them returns both to bit-identical.
 *
 * The value is a LIST of owning strategies, so a second deck that genuinely
 * wants the same entry opts in by name rather than by re-implementing it —
 * which is what "make the logic generic" means for a scoped entry. Adding a
 * strategy here widens the entry to that deck ONLY; every deck that derives
 * none of the listed flags still falls through to the cached LLM analysis,
 * exactly as "no entry" did.
 */
export const DECK_SCOPED_PLAYBOOK_ENTRIES: Readonly<Record<string, readonly (keyof DeckStrategy)[]>> = Object.freeze({
    'for-shame': ['craneHonor'],
    // Both honor-race decks want it; Scorpion Poison Mill (which also runs the
    // province) measured −7.1pp with it and keeps the fall-through.
    'before-the-throne': ['craneHonor', 'lionHonor']
});

export function getPlaybookEntry(
    cardId: string | undefined,
    strategy?: DeckStrategy
): PlaybookEntry | undefined {
    if(!cardId) {
        return undefined;
    }
    const scope = DECK_SCOPED_PLAYBOOK_ENTRIES[cardId];
    // No strategy supplied (specs, older callers) keeps the unscoped lookup.
    if(scope && strategy && !scope.some((flag) => strategy[flag])) {
        return undefined;
    }
    return PLAYBOOK[cardId];
}
