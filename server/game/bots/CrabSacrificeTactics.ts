// Crab "Berserker Sacrifice" tactics for Castle of the Forgotten decks
// (EmeraldDB 59c4d29f).
//
// The archetype is A BODY IS A RESOURCE, NOT A BOARD PRESENCE. The deck buys a
// wide board of cheap high-military characters at zero fate, then spends the
// surplus bodies as a COST: Silent Skirmisher and Stoic Gunso convert one into
// skill, Weight of Duty converts one into a bowed+dishonored enemy, Way of the
// Crab converts one into an enemy body, Fulfill Your Duty converts one into
// province strength, and Tainted Hero must eat one before it may fight at all.
//
// Three things make that trade profitable rather than merely even:
//
//  1. Some bodies PAY when they die. Gallant Quartermaster returns 2 fate,
//     Kaiu Envoy returns a fate and a card (Courtesy + Sincerity), Sharpened
//     Tsuruhashi returns itself to hand, Promising Youth turns back into a
//     character. Sacrificing those is pure profit, so they are Tier 1.
//  2. Some bodies PAY WHEN SOMETHING ELSE dies. Vengeful Berserker doubles its
//     military after another friendly character leaves play during a conflict,
//     and Fifth Tower Watch bows an enemy with less military than whatever was
//     sacrificed. These are payoffs, never fodder.
//  3. What the saves do NOT do. Iron Mine, Reprieve and Ceaseless Duty replace
//     a friendly character's leave-play, and the obvious-looking combo is to
//     sacrifice the biggest body, cancel the loss and keep the payoff. It does
//     not work: every outlet here spends the body as a COST, and a prevented
//     cost is an unpaid cost, so the ability never initiates and none of the
//     death payoffs fire either. Measured in full in
//     `test/server/cards/CrabSacrificeIronMine.spec.js`.
//     What the saves ARE for is the leave-play the deck cannot dodge any other
//     way. Two of them, and the bigger one is not removal at all: this deck
//     buys at zero fate on purpose, so its whole board is discarded in the FATE
//     PHASE. Across five recorded human games 10 of 11 save uses were exactly
//     that — Tainted Hero x4, Unleashed Experiment x2, Damned Hida, Butcher of
//     the Fallen, One of the Forgotten — and only ONE answered opponent removal
//     (Ceaseless Duty on an Assassination). A save spent during the conflict
//     phase is a save not available at the fate phase, which is why firing one
//     on our OWN sacrifice cost is doubly expensive.
//     They also do not all read the same. Iron Mine and Reprieve carry "a
//     character you control" in their printed condition; CEASELESS DUTY DOES
//     NOT, so the engine legally offers it on the opponent's departing body and
//     the bot spent it keeping an enemy character alive during the opponent's
//     fate-phase discard. The controller gate lives in `JigokuBotPolicy`'s
//     triggered-ability filter (`LEAVE_PLAY_SAVE_CARD_IDS`), pinned in
//     `test/server/cards/14.5-AHD/CeaselessDutyBot.spec.js`.
//
// Every knob is data. Nothing here is reachable unless `DeckProfile.crabSacrifice`
// is present, which only the `crab-sacrifice-castle-of-the-forgotten` override
// sets, so no other deck in the field moves.

// WIRED vs NOT WIRED — read this before tuning anything here.
//
// A knob nobody reads cannot change a win rate, and three full measurement arms
// were spent on exactly that: `castleAlwaysAfterBreak` measured bit-identical
// to its control until the policy was taught to read it, and
// `additionalFateByCharacterId` did the same until it was wired on 2026-08-22.
// Every field below is marked.
//
// WIRED (a change here changes play):
//   sacrificeTier1/2, tierPenalty, sacrificeOutletIds, outletPenalty,
//   sacrificeSkillWeight/FateWeight/AttachmentWeight, sacrificeBowedDiscount,
//   sacrificeNonParticipantDiscount   -> pickSacrifice/sacrificeCost
//   saveInversion, saveHoldingIds, saveAttachmentIds, saveEventIds,
//   ceaselessDutyUsesUnbrokenProvinces -> saveAvailableFor + the save guard
//   castleAlwaysAfterBreak, castleMinimumConflictsRemaining
//                                     -> JigokuBotPolicy.provinceReactionWorthIt
//   outletRequireDecisiveSwing, skillOutletIds, pumpValueById -> outletDecisive
//   doublingCharacterIds, doublingBuffBonus -> pickBuffTarget
//   weightOfDutyMinimumTargetSkill    -> pickWeightOfDutyTarget
//   declareHonorFloor                 -> withoutHonorCostDeclares
//   honorSpendFloor                   -> canPayHonorCost
//   additionalFateByCharacterId, endgameZeroFate -> desiredAdditionalFate
//   fodderReserve, fodderReserveMinimum -> pickFodderBody
//
// NOT WIRED — descriptive only, marked individually below. Do not A/B these
// without wiring them first; they will read bit-identical every time.
export interface CrabSacrificeProfile {
    // ---- sacrifice ranking -------------------------------------------------
    // Tier 1: the body's DEATH is the payoff. Feed these first, always.
    sacrificeTier1: string[];
    // Tier 2: cheap filler. Feed these once they cannot win the conflict.
    sacrificeTier2: string[];
    // Tier 3 (everything not listed): the payload. Only ever sacrificed when a
    // save is live, or when a forced prompt leaves no other legal body.
    // Additive penalty applied to the sacrifice score, by tier index.
    tierPenalty: number[];
    // Bodies that are themselves sacrifice OUTLETS or payoffs. Feeding one of
    // these costs the deck the outlet, so they sit at the back of Tier 3.
    sacrificeOutletIds: string[];
    outletPenalty: number;
    // What losing a body actually costs, per unit.
    sacrificeSkillWeight: number;
    sacrificeFateWeight: number;
    sacrificeAttachmentWeight: number;
    // A bowed body contributes 0 skill for the rest of the conflict, so it is
    // cheaper to spend than a ready one of the same size.
    sacrificeBowedDiscount: number;
    // A body that is not in the conflict cannot be spent by most outlets, but
    // when it can (Way of the Crab) it is cheaper than a participant.
    sacrificeNonParticipantDiscount: number;

    // ---- save inversion (Iron Mine / Reprieve / Ceaseless Duty) ------------
    //
    // MEASURED FALSE. The intuition — "sacrifice the biggest body to an outlet,
    // cancel the leave-play, bank the payoff for free" — does not work in this
    // engine, and `test/server/cards/CrabSacrificeIronMine.spec.js` pins every
    // branch of it:
    //
    //   * every sacrifice OUTLET in the deck spends the body as a COST
    //     (`AbilityDsl.costs.sacrifice`), and cancelling the leave-play means
    //     the cost was never paid, so the ability does not initiate at all —
    //     Silent Skirmisher's +2 military does NOT apply;
    //   * Gallant Quartermaster gains 0 fate, not 2;
    //   * Sharpened Tsuruhashi stays attached instead of returning to hand;
    //   * Vengeful Berserker does not double (its reaction needs the body to
    //     have actually left play).
    //
    // That matches the printed ruling: a sacrifice prevented during the payment
    // of a cost means the cost is not paid and the effect never initiates. So
    // the saves have exactly ONE use in this deck — protecting a body from the
    // OPPONENT's removal — and the bot must never fire one on its own cost.
    // The knob is retained so the inversion can be re-measured, not because it
    // is a good idea; leave it off.
    saveInversion: boolean;
    // Holdings in play that replace a friendly character's leave-play.
    saveHoldingIds: string[];
    // Attachments on the body itself that do the same.
    saveAttachmentIds: string[];
    // Conflict events in hand that do the same.
    saveEventIds: string[];
    // Ceaseless Duty only saves a character whose PRINTED cost is at most the
    // number of unbroken provinces we control, so the save is conditional.
    ceaselessDutyUsesUnbrokenProvinces: boolean;

    // ---- Castle of the Forgotten ------------------------------------------
    // Reaction after we break a province: bow the stronghold, every conflict
    // declared this round becomes military. The whole board is military, so
    // this is close to unconditional — but it costs the stronghold's bow, and
    // it is worth nothing once no conflict remains this round.
    castleAlwaysAfterBreak: boolean;
    castleMinimumConflictsRemaining: number;

    // ---- Tainted Hero ------------------------------------------------------
    // Cannot be declared as attacker or defender until its text box is blanked,
    // which costs a sacrifice. 6 military for 3 fate is worth a Tier 1 body, so
    // the blanking Action must fire BEFORE conflict declaration, not during.
    // NOT WIRED (descriptive). Tainted Hero's blanking Action fires from its
    // playbook entry, which cannot read this list.
    taintedHeroIds: string[];
    taintedHeroMinimumSpareBodies: number;

    // ---- fodder reserve ----------------------------------------------------
    // Buy a body to SPEND before buying a second body to keep.
    //
    // Tainted Hero must eat a friendly character before it may be declared at
    // all, and the blanking lasts one phase, so it needs a fresh body EVERY
    // round. Way of the Crab, Silent Skirmisher, Stoic Gunso, Steadfast Witch
    // Hunter and Weight of Duty all spend one too. `bodyOrder: 'highest-cost'`
    // buys the most expensive body first, which is the PAYLOAD, so the bot
    // reached the conflict phase holding two Tainted Heroes and no fodder and
    // fed one to the other — six times in twelve measured games, plus Damned
    // Hida three times and Unleashed Experiment twice. The human never did
    // this once in five games: all 15 of his blanking costs were Tier 1 or
    // Tier 2, and his stated priority was "to have a sacrifice body each
    // round to activate Tainted Hero or some other ability such as Way of the
    // Crab."
    //
    // With an outlet live and fewer than `fodderReserveMinimum` expendable
    // bodies on board, the next body bought is the best fodder available
    // (Tier 1 first — its death pays — then cheapest), instead of whatever
    // `bodyOrder` wanted. It does not add a buy or raise the budget; it
    // reorders one pick.
    //
    // MEASURED NEGATIVE, and it ships OFF. 192 games over six fresh bases
    // (140001-145001), `deckFieldWinRate` with the SUBJECT seat injected:
    //
    //   fodderReserve true   38.54%   CI [31.9, 45.6]
    //   fodderReserve false  42.71%   CI [35.9, 49.8]
    //
    // -4.17pp for the rule. The mechanism is reachable and does exactly what
    // it says — fodder-class sacrifices went 26/44 -> 32/44 and Tainted Hero
    // eating another Tainted Hero went 7 -> 3 — so this is not a dead knob.
    // It is the same trade the deck keeps losing: the pick spent on a body to
    // SPEND is a payload not bought, and at 2.2 bodies a dynasty phase this
    // deck cannot afford both. The human's rule works for the human because he
    // also buys 3.00 bodies a phase.
    //
    // Note the honest caveat on the rig: the null arm reproduced the control
    // to within ONE game of 192 rather than exactly, so the injection path is
    // not perfectly transparent here. That is far smaller than the 8-game
    // effect, but a confirmation on three more fresh bases is owed before
    // anyone calls the size of it precise.
    fodderReserve: boolean;
    fodderReserveMinimum: number;

    // ---- fate placement ----------------------------------------------------
    // Extra fate placed at buy time, by printed id. DIRE characters must be
    // bought at exactly ZERO — Damned Hida is +3 military while dire (3 -> 6)
    // and Unleashed Experiment only sheds its downside abilities while dire —
    // so a fate placed on either is a strict downgrade, not insurance.
    //
    // WIRED (2026-08-22) -> `desiredAdditionalFate`, read by the policy's
    // additional-fate prompt ahead of the generic `fateAwareEconomy`. An id
    // absent from the map falls through to that economy unchanged.
    //
    // The values are the human's, read off five recorded games. The rule is
    // NOT "spend less fate" — it is TWO CLASSES:
    //
    //   * PAYLOAD (Tainted Hero, Butcher of the Fallen) is bought to PERSIST
    //     across rounds and is fed a fresh cheap body every round. The human
    //     paid Tainted Hero 1.83 fate on average, never 0;
    //   * FODDER (Gallant Quartermaster, Kaiu Envoy, Silent Skirmisher, One of
    //     the Forgotten) is bought to DIE this round, so a fate on it is burnt
    //     with the body — the human paid 0.10-0.20 average;
    //   * DIRE is a hard zero, for the printed reason above.
    //
    // The bot was doing close to the opposite: a flat +1 on nearly everything,
    // which both broke dire (Damned Hida at 1 fate is 3 military, not 6;
    // Unleashed Experiment at 1 fate still costs 2 honor to declare) and left
    // it buying 2.24 bodies a dynasty phase against the human's 3.00. That
    // width gap is the deck's measured weakness ("it has no board"), and the
    // earlier persistence experiments — `bodyAdditionalFateForCostThree: 1`
    // (−5.4pp) and `durableAdditionalFate` 2/1 (−0.6pp) — both bought
    // persistence with the flat rule, i.e. on the fodder too.
    additionalFateByCharacterId: Record<string, number>;
    // MEASURED NULL, SHIPS ON at the owner's explicit request (2026-08-22) —
    // same standing as `conflictTempo.tradeDefenseWinOnly` and
    // `drawBidding.cardsOverHonor`. Do not cite it as a measured win, and do
    // not silently revert it. The measurement below is the honest record.
    //
    // `deckFieldWinRate`, SUBJECT seat injected,
    // 384 games over TWELVE bases:
    //
    //   bases 140001-145001   control 42.19%   fate-on 47.92%   +5.73pp
    //   bases 150001-155001   control 38.54%   fate-on 35.94%   -2.60pp
    //   POOLED                155/384 40.36%   161/384 41.93%   +1.56pp
    //                                                    z=0.44, p=0.66
    //
    // The two base SETS disagree by 8.3pp about the same lever, which is the
    // standard warning against believing either one. Do not re-run six bases
    // and ship whichever sign comes up.
    //
    // What IS repeatable is the mechanism, and it is worth knowing because it
    // was the whole hypothesis: dishonor losses fall in BOTH sets (45 -> 27,
    // then 49 -> 37), because Unleashed Experiment bought with fate keeps its
    // `honorCostToDeclare(2)` and bleeds 2 honor per declaration, and this
    // deck's top loss reason is dishonor. The saving is real and it does not
    // convert — the same games come back as conquest losses instead
    // (64 -> 81 on the fresh set). Cheaper bodies mean a weaker board; it is
    // the deck's standing trade, priced yet again.
    //
    // Before believing an earlier reading of this knob: it FIRST measured
    // negative because the shipped `saveFatePass` setup-fate floor was raising
    // the deliberate dire zeros straight back up. That is fixed (see
    // `raiseSetupFate`'s `exactZero`); the numbers above are post-fix.
    useDeckFatePlacement: boolean;
    // Q5 from the human: "if I put 0 fate it means the game is close to the
    // end, one of the strongholds can be attacked or I expect I will be able
    // to attack it that round." Persistence is only worth buying while the
    // game lasts long enough to use it; in the closing round the same fate
    // buys another body instead. When a stronghold is live for either side,
    // every id in the map above is bought at zero.
    endgameZeroFate: boolean;

    // ---- Unleashed Experiment ---------------------------------------------
    // Dire (no fate) is the point: it loses its other abilities, which is
    // exactly what we want, and keeps 4 military. Declaring it costs 2 honor,
    // so it is not free to swing with while the honor pool is short.
    // NOT WIRED (descriptive).
    direCharacterIds: string[];
    // NOT WIRED — the policy reads the playbook's `declareCostsHonor` flag.
    declareCostsHonorIds: string[];
    declareHonorFloor: number;

    // ---- One of the Forgotten ---------------------------------------------
    // Reaction after the opponent PASSES on declaring a conflict while they
    // control ready characters: put 1 fate on this character. Worth taking
    // every time; the card cannot be bought with fate any other way.
    // NOT WIRED (descriptive) — the reaction fires from its playbook priority.
    passFateCharacterIds: string[];

    // ---- Mercenary Company -------------------------------------------------
    // Forced reaction after it LOSES a conflict: the opponent may pay 1 fate
    // from their pool to take control of it. 7 military for 4 is worth paying
    // for, and worth taking back the same way. Both sides of that trade are
    // priced here so any deck in the field answers the prompt sanely.
    // NOT WIRED (descriptive) — the control-transfer prompt is answered by the
    // shared polarity logic, not by these.
    mercenaryTakeoverIds: string[];
    mercenaryTakeoverValue: number;
    mercenaryMinimumFateAfterTakeover: number;

    // ---- provinces ---------------------------------------------------------
    // Fortified Assembly gains +2 strength per honor token and takes one every
    // time it is attacked, so defending it compounds. It cannot be the
    // stronghold province.
    fortifiedAssemblyId: string;
    fortifiedAssemblyDefendBonus: number;
    // Shrug Off Despair moves the contested ring to itself, making it the
    // attacked province. It is a void province, so moving a conflict there also
    // turns on Weight of Duty — the deck's removal — at the same time.
    shrugOffDespairId: string;
    shrugOffDespairMinimumStrengthSaving: number;
    shrugOffDespairEnablesWeightOfDuty: boolean;
    // Weight of Duty is legal only during a conflict at a VOID province.
    weightOfDutyId: string;
    weightOfDutyMinimumTargetSkill: number;
    // Shinsei's Last Hope discounts every character played from it by 2 and
    // they enter dishonored. Bodies are the deck's currency, so a character
    // there is worth strictly more than the same character elsewhere and must
    // never be discarded in the fate phase or mulliganed away.
    shinseiLastHopeId: string;
    shinseiLastHopeDiscount: number;

    // ---- conflict buffs ----------------------------------------------------
    // Skill added by each pump, for province-break budgeting. Silent Skirmisher
    // and Stoic Gunso both cost a body on top of the card.
    pumpValueById: Record<string, number>;
    // Spreading the Darkness costs 2 honor on top of the card.
    honorCostById: Record<string, number>;
    // The skill outlets (Silent Skirmisher, Stoic Gunso) buy conflict skill with
    // a PERMANENT body. Un-gated they fire whenever the engine allows, which is
    // how a deck that already dies to an empty board spends the rest of it on
    // conflicts that were already won or already lost. When true, an outlet only
    // fires when its payoff actually decides something: it completes a break, or
    // it flips the conflict. False reproduces the un-gated behaviour exactly.
    outletRequireDecisiveSwing: boolean;
    // Ids treated as skill-for-a-body outlets by that gate.
    skillOutletIds: string[];
    // Never spend honor on a pump below this pool.
    honorSpendFloor: number;
    // Vengeful Berserker DOUBLES its military, so every point of buff on it is
    // worth two. Buffs steer to it while a friendly leave-play is planned.
    doublingCharacterIds: string[];
    doublingBuffBonus: number;

    // ---- Battle Meditation -------------------------------------------------
    // Reaction after we break a province while a Berserker participates: draw
    // 3. Max 1 per conflict. This is the deck's only real card engine.
    // NOT WIRED (descriptive) — Battle Meditation's reaction needs no gate.
    berserkerIds: string[];

    // ---- Butcher of the Fallen --------------------------------------------
    // While attacking, characters with less military than our unbroken province
    // count cannot defend. Buffing it raises nothing — the threshold is the
    // PROVINCE count — but it is still the best attacker to buff because the
    // defenders who can block it are the few big ones.
    // NOT WIRED (descriptive) — Butcher's lockout is a passive.
    butcherIds: string[];

    // Those Who Serve moved to the shared `DeckProfile.dynastyCostReducer` when
    // a second deck (Crane Courtier Honor) adopted the card. Same values, same
    // call site.
}

export const CRAB_SACRIFICE_DEFAULTS: CrabSacrificeProfile = {
    // Their death IS the payoff: 2 fate, and a fate plus a card.
    sacrificeTier1: ['gallant-quartermaster', 'kaiu-envoy'],
    // Cheap bodies whose skill we can spare once the conflict is decided.
    sacrificeTier2: [
        'silent-skirmisher', 'promising-youth', 'one-of-the-forgotten', 'unleashed-experiment'
    ],
    tierPenalty: [0, 6, 24],
    // Outlets and death-payoffs. Spending these throws away the engine.
    sacrificeOutletIds: [
        'stoic-gunso', 'steadfast-witch-hunter', 'fifth-tower-watch', 'vengeful-berserker'
    ],
    outletPenalty: 10,
    sacrificeSkillWeight: 1,
    sacrificeFateWeight: 3,
    sacrificeAttachmentWeight: 2,
    sacrificeBowedDiscount: 0.6,
    sacrificeNonParticipantDiscount: 0.25,

    saveInversion: false,
    saveHoldingIds: ['iron-mine'],
    saveAttachmentIds: ['reprieve'],
    saveEventIds: ['ceaseless-duty'],
    ceaselessDutyUsesUnbrokenProvinces: true,

    castleAlwaysAfterBreak: true,
    castleMinimumConflictsRemaining: 1,

    taintedHeroIds: ['tainted-hero'],
    taintedHeroMinimumSpareBodies: 1,

    fodderReserve: false,
    fodderReserveMinimum: 1,

    // Human averages over five recorded games, rounded; dire hard-pinned at 0.
    // Fifth Tower Watch is deliberately ABSENT — the human never bought one,
    // so there is no observation to copy and it falls through to the generic
    // economy rather than being guessed at.
    additionalFateByCharacterId: {
        // dire: a fate here is a strict downgrade, not insurance
        'damned-hida': 0,
        'unleashed-experiment': 0,
        // fodder: bought to die this round, so a fate is burnt with the body
        'silent-skirmisher': 0,
        'gallant-quartermaster': 0,
        'kaiu-envoy': 0,
        'one-of-the-forgotten': 0,
        'vengeful-berserker': 0,
        // payload: bought to persist and be fed a fresh body each round
        'tainted-hero': 2,
        'butcher-of-the-fallen': 2,
        'steadfast-witch-hunter': 1,
        'repentant-legion': 1,
        'mercenary-company': 1
    },
    useDeckFatePlacement: true,
    endgameZeroFate: true,

    direCharacterIds: ['unleashed-experiment', 'damned-hida'],
    declareCostsHonorIds: ['unleashed-experiment'],
    // MEASURED INERT-IS-BETTER. Gating the declaration on an honor floor cost
    // 6.5pp (30.65% -> 24.11%) and made dishonor losses WORSE, not better: the
    // conflicts the deck gives up by holding Unleashed Experiment back are the
    // ones it needed to end the game before the honor ran out. 0 disables it.
    declareHonorFloor: 0,

    passFateCharacterIds: ['one-of-the-forgotten'],

    mercenaryTakeoverIds: ['mercenary-company'],
    // 7 military for 1 fate is the best rate in the deck, from either side.
    mercenaryTakeoverValue: 7,
    mercenaryMinimumFateAfterTakeover: 0,

    fortifiedAssemblyId: 'fortified-assembly',
    fortifiedAssemblyDefendBonus: 3,
    shrugOffDespairId: 'shrug-off-despair',
    shrugOffDespairMinimumStrengthSaving: 2,
    shrugOffDespairEnablesWeightOfDuty: true,
    weightOfDutyId: 'weight-of-duty',
    weightOfDutyMinimumTargetSkill: 2,
    shinseiLastHopeId: 'shinsei-s-last-hope',
    shinseiLastHopeDiscount: 2,

    pumpValueById: {
        banzai: 3,
        'spreading-the-darkness': 4,
        'silent-skirmisher': 2,
        'stoic-gunso': 3,
        'fulfill-your-duty': 0
    },
    honorCostById: {
        'spreading-the-darkness': 2
    },
    outletRequireDecisiveSwing: false,
    skillOutletIds: ['silent-skirmisher', 'stoic-gunso'],
    // Same measurement, same answer: 0 disables the floor. This deck's honor is
    // spent to WIN FAST, and slowing it down loses the race it was protecting.
    honorSpendFloor: 0,

    doublingCharacterIds: ['vengeful-berserker'],
    doublingBuffBonus: 4,

    berserkerIds: [
        'silent-skirmisher', 'one-of-the-forgotten', 'damned-hida', 'tainted-hero',
        'vengeful-berserker', 'butcher-of-the-fallen', 'repentant-legion'
    ],

    butcherIds: ['butcher-of-the-fallen']
};

type Axis = 'military' | 'political';

const numberOr = (value: any, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

// Live skill where the engine filled a summary, printed skill otherwise.
const skillOf = (card: any, axis: Axis): number => {
    const summary = axis === 'military' ? card?.militarySkillSummary : card?.politicalSkillSummary;
    const live = Number(summary?.stat);
    return Math.max(0, Number.isFinite(live) ? live : numberOr(card?.[axis], 0));
};

const hasTrait = (card: any, trait: string): boolean => {
    const traits = card?.traits;
    if(Array.isArray(traits)) {
        return traits.some((value: string) => String(value).toLowerCase() === trait);
    }
    return typeof traits === 'string' && new RegExp(`\\b${trait}\\b`, 'i').test(traits);
};

// Stable ordering so equal scores never depend on engine array order.
const byUuid = (left: any, right: any): number =>
    String(left?.uuid || '').localeCompare(String(right?.uuid || ''));

export interface SacrificeContext {
    axis: Axis;
    // Holdings currently in play on our side (Iron Mine).
    myHoldings?: any[];
    // Our conflict hand (Ceaseless Duty).
    hand?: any[];
    // Unbroken provinces we control — Ceaseless Duty's cost ceiling.
    unbrokenProvinces?: number;
    // Printed cost by in-play character uuid, for the Ceaseless Duty gate.
    printedCosts?: Record<string, number>;
    // Only bodies that can still swing the current conflict are expensive.
    conflictDecided?: boolean;
}

export class CrabSacrificeTactics {
    constructor(public readonly profile: CrabSacrificeProfile = CRAB_SACRIFICE_DEFAULTS) {}

    // ---- identity ---------------------------------------------------------

    // Is this a card that can SPEND a body as a cost? The deck's whole engine
    // is matching fodder to outlets.
    isOutlet(card: any): boolean {
        return !!card?.id && this.profile.sacrificeOutletIds.includes(card.id);
    }

    // A character that multiplies a sacrifice's payoff.
    isDoubler(card: any): boolean {
        return !!card?.id && this.profile.doublingCharacterIds.includes(card.id);
    }

    // Fodder tier: lower is more expendable. Tier decides which body pays.
    tierOf(card: any): number {
        const id = card?.id;
        if(id && this.profile.sacrificeTier1.includes(id)) {
            return 0;
        }
        if(id && this.profile.sacrificeTier2.includes(id)) {
            return 1;
        }
        return 2;
    }

    // ---- the save (Iron Mine / Reprieve / Ceaseless Duty) ------------------

    /**
     * Is this specific body's leave-play replaceable right now? Only then does
     * "sacrifice" stop costing the board a body.
     *
     * Iron Mine is a holding in play and covers any friendly character.
     * Reprieve must already be attached to THIS body.
     * Ceaseless Duty is an event in hand and only covers a character whose
     * printed cost is at most our unbroken province count.
     */
    saveAvailableFor(card: any, ctx: SacrificeContext): boolean {
        if(!this.profile.saveInversion || !card) {
            return false;
        }
        const holdings = ctx.myHoldings || [];
        if(holdings.some((holding: any) => this.profile.saveHoldingIds.includes(holding?.id))) {
            return true;
        }
        const attachments = card.attachments || [];
        if(attachments.some((attachment: any) => this.profile.saveAttachmentIds.includes(attachment?.id))) {
            return true;
        }
        const hand = ctx.hand || [];
        if(hand.some((handCard: any) => this.profile.saveEventIds.includes(handCard?.id))) {
            if(!this.profile.ceaselessDutyUsesUnbrokenProvinces) {
                return true;
            }
            const cost = numberOr(ctx.printedCosts?.[card.uuid] ?? card.cost, 99);
            return cost <= numberOr(ctx.unbrokenProvinces, 0);
        }
        return false;
    }

    /**
     * What losing this body would cost us. LOWER is a better thing to feed to a
     * sacrifice. A save flips the sign of the whole ranking: see `pickSacrifice`.
     */
    sacrificeCost(card: any, ctx: SacrificeContext): number {
        if(!card) {
            return Number.POSITIVE_INFINITY;
        }
        const profile = this.profile;
        let skill = skillOf(card, ctx.axis) * profile.sacrificeSkillWeight;
        // A bowed body already contributes nothing to this conflict.
        if(card.bowed) {
            skill *= profile.sacrificeBowedDiscount;
        }
        if(!card.inConflict) {
            skill *= profile.sacrificeNonParticipantDiscount;
        }
        // Once the conflict cannot change hands, the skill on the table is
        // worth nothing and only the body's future matters.
        if(ctx.conflictDecided) {
            skill *= profile.sacrificeBowedDiscount;
        }
        const fate = (Number(card.fate) || 0) * profile.sacrificeFateWeight;
        const attachments = (card.attachments || [])
            // An attachment that returns to hand when the bearer leaves play is
            // not lost with the body, so it does not raise the price.
            .filter((attachment: any) => !this.returnsOnLeavePlay(attachment))
            .length * profile.sacrificeAttachmentWeight;
        const tier = profile.tierPenalty[this.tierOf(card)] ?? 0;
        const outlet = this.isOutlet(card) ? profile.outletPenalty : 0;
        return skill + fate + attachments + tier + outlet;
    }

    // Ancestral and Sharpened Tsuruhashi both come back rather than dying with
    // the bearer, so they are free to carry into a sacrifice.
    returnsOnLeavePlay(attachment: any): boolean {
        if(!attachment) {
            return false;
        }
        if(attachment.id === 'sharpened-tsuruhashi' || attachment.id === 'promising-youth') {
            return true;
        }
        const keywords = attachment.printedKeywords;
        if(Array.isArray(keywords)) {
            return keywords.includes('ancestral');
        }
        return false;
    }

    /**
     * Choose the body to feed to a sacrifice cost.
     *
     * Normally: the cheapest thing to lose. With a save live for some candidate:
     * the MOST expensive, because we keep it and the payoff scales with it —
     * this is the Iron Mine trick and it is the reason the deck runs three.
     */
    pickSacrifice(candidates: any[], ctx: SacrificeContext): any {
        const legal = (candidates || []).filter(Boolean);
        if(legal.length === 0) {
            return null;
        }
        const saved = legal.filter((card) => this.saveAvailableFor(card, ctx));
        if(saved.length > 0) {
            return saved
                .slice()
                .sort((left, right) =>
                    this.sacrificeCost(right, ctx) - this.sacrificeCost(left, ctx) || byUuid(left, right))[0];
        }
        return legal
            .slice()
            .sort((left, right) =>
                this.sacrificeCost(left, ctx) - this.sacrificeCost(right, ctx) || byUuid(left, right))[0];
    }

    /**
     * Should a skill-for-a-body outlet fire at all?
     *
     * `strengthNeeded` is the extra skill still needed to break (attacking) or
     * to prevent a break (defending); `winSkillNeeded` is what it takes to win
     * the conflict outright. A pump that neither completes a break nor flips the
     * conflict has bought nothing and cost a permanent body.
     *
     * With `outletRequireDecisiveSwing` false this returns true always, which is
     * exactly the un-gated behaviour, so a null arm is bit-identical.
     */
    outletDecisive(cardId: string, payoff: number, strengthNeeded?: number, winSkillNeeded?: number): boolean {
        if(!this.profile.outletRequireDecisiveSwing ||
            !this.profile.skillOutletIds.includes(cardId)) {
            return true;
        }
        const breaks = Number.isFinite(strengthNeeded as number) &&
            (strengthNeeded as number) > 0 && (strengthNeeded as number) <= payoff;
        const flips = Number.isFinite(winSkillNeeded as number) &&
            (winSkillNeeded as number) > 0 && (winSkillNeeded as number) <= payoff;
        return breaks || flips;
    }

    // Skill this outlet returns for one body.
    outletPayoff(cardId: string): number {
        return numberOr(this.profile.pumpValueById[cardId], 0);
    }

    // ---- fodder reserve ----------------------------------------------------

    /**
     * Is this body cheap enough to be spent as a COST rather than kept?
     * Tier 1 and Tier 2 are exactly the deck's fodder classes.
     */
    isFodder(card: any): boolean {
        return this.tierOf(card) <= 1;
    }

    /**
     * Does anything we control need a body to eat this round?
     *
     * Tainted Hero cannot be declared at all until it eats one, and it must
     * eat again every round because the blanking lasts one phase. Way of the
     * Crab, the skill outlets and Steadfast Witch Hunter all convert a body
     * too. A board with an outlet and no fodder is an outlet that will eat
     * the PAYLOAD instead — measured: the bot fed Tainted Hero to Tainted
     * Hero six times in twelve games.
     */
    outletNeedsFodder(myCharacters: any[], hand: any[]): boolean {
        const outletInPlay = (myCharacters || []).some((card) =>
            card && (this.profile.taintedHeroIds.includes(card.id) ||
                this.profile.skillOutletIds.includes(card.id) ||
                this.profile.sacrificeOutletIds.includes(card.id)));
        const outletInHand = (hand || []).some((card) => card && card.id === 'way-of-the-crab');
        return outletInPlay || outletInHand;
    }

    /**
     * Which body to buy when the board has an outlet but nothing to feed it.
     *
     * The human's stated priority: "I also prioritised to have a sacrifice
     * body each round to activate Tainted Hero or some other ability such as
     * Way of the Crab." That is not the same as buying cheap — it is buying
     * the body whose DEATH pays (Tier 1: Gallant Quartermaster returns 2 fate,
     * Kaiu Envoy a fate and a card), then the cheapest expendable one.
     *
     * Returns null when the rule does not apply, leaving `bodyOrder` alone.
     */
    pickFodderBody(bodies: any[], myCharacters: any[], hand: any[],
        costOf: (card: any) => number): any {
        if(!this.profile.fodderReserve) {
            return null;
        }
        if(!this.outletNeedsFodder(myCharacters, hand)) {
            return null;
        }
        // Already holding a spare body the outlet can eat: buy normally.
        const spare = (myCharacters || []).filter((card) => card && this.isFodder(card)).length;
        if(spare >= this.profile.fodderReserveMinimum) {
            return null;
        }
        const candidates = (bodies || []).filter((card) => card && this.isFodder(card));
        if(candidates.length === 0) {
            return null;
        }
        return candidates
            .slice()
            .sort((left, right) =>
                this.tierOf(left) - this.tierOf(right) ||
                costOf(left) - costOf(right) ||
                byUuid(left, right))[0];
    }

    // ---- fate placement ----------------------------------------------------

    /**
     * Extra fate to place when buying this character, or `null` to leave the
     * decision to the generic fate-aware economy.
     *
     * `strongholdLive` is the human's endgame read (Q5): with a stronghold
     * attackable by either side the game ends this round or next, so fate
     * spent on persistence never pays and the same fate buys another body.
     */
    desiredAdditionalFate(cardId?: string, strongholdLive = false): number | null {
        if(!this.profile.useDeckFatePlacement) {
            return null;
        }
        if(!cardId || !Object.prototype.hasOwnProperty.call(this.profile.additionalFateByCharacterId, cardId)) {
            return null;
        }
        if(strongholdLive && this.profile.endgameZeroFate) {
            return 0;
        }
        return Math.max(0, numberOr(this.profile.additionalFateByCharacterId[cardId], 0));
    }

    // ---- Fifth Tower Watch -------------------------------------------------

    /**
     * Interrupt when we sacrifice a character: the opponent bows a character
     * with LOWER military than the sacrificed one. If nothing they control is
     * smaller, the ability does nothing, so the sacrifice must be sized to it.
     */
    fifthTowerBowable(sacrificed: any, opponentCharacters: any[], axis: Axis): any[] {
        const threshold = skillOf(sacrificed, axis);
        return (opponentCharacters || [])
            .filter((card) => card && !card.bowed && skillOf(card, axis) < threshold)
            .sort((left, right) => skillOf(right, axis) - skillOf(left, axis) || byUuid(left, right));
    }

    // ---- Weight of Duty ----------------------------------------------------

    /**
     * Bow AND dishonor one enemy for one participating body. A unique sacrifice
     * unlocks any target; a non-unique sacrifice may only hit a non-unique.
     * Prefer the biggest ready body we are allowed to touch.
     */
    pickWeightOfDutyTarget(opponentCharacters: any[], sacrificed: any, axis: Axis): any {
        const sacrificedUnique = !!(sacrificed?.isUnique ?? sacrificed?.is_unique);
        const legal = (opponentCharacters || [])
            .filter(Boolean)
            .filter((card) => sacrificedUnique || !(card.isUnique ?? card.is_unique))
            .filter((card) => skillOf(card, axis) >= this.profile.weightOfDutyMinimumTargetSkill ||
                card.isDishonored === false);
        const ready = legal.filter((card) => !card.bowed);
        const pool = ready.length > 0 ? ready : legal;
        return pool
            .slice()
            .sort((left, right) => skillOf(right, axis) - skillOf(left, axis) || byUuid(left, right))[0] || null;
    }

    // ---- Way of the Crab ---------------------------------------------------

    // ---- buff steering -----------------------------------------------------

    /**
     * Where a pump is worth the most. Vengeful Berserker doubles its military,
     * so every point put on it counts twice once a friendly body has left play
     * during this conflict — which this deck arranges on purpose.
     */
    buffBonus(card: any): number {
        return this.isDoubler(card) ? this.profile.doublingBuffBonus : 0;
    }

    // Which ready participant receives the pump.
    pickBuffTarget(participants: any[], axis: Axis): any {
        return (participants || [])
            .filter((card) => card && !card.bowed)
            .slice()
            .sort((left, right) =>
                (skillOf(right, axis) + this.buffBonus(right)) -
                (skillOf(left, axis) + this.buffBonus(left)) || byUuid(left, right))[0] || null;
    }

    // ---- Mercenary Company -------------------------------------------------

    // ---- Tainted Hero ------------------------------------------------------

}
