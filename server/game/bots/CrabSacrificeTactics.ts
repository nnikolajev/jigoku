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
//     `test/server/cards/CrabSacrificeIronMine.spec.js`. The saves answer the
//     OPPONENT's removal, and nothing else.
//
// Every knob is data. Nothing here is reachable unless `DeckProfile.crabSacrifice`
// is present, which only the `crab-sacrifice-castle-of-the-forgotten` override
// sets, so no other deck in the field moves.

// WIRED vs NOT WIRED — read this before tuning anything here.
//
// A knob nobody reads cannot change a win rate, and two full measurement arms
// were spent today on exactly that: `castleAlwaysAfterBreak` measured
// bit-identical to its control until the policy was taught to read it, and
// `additionalFateByCharacterId` still measures bit-identical because nothing
// reads it at all. Every field below is marked.
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

    // ---- fate placement ----------------------------------------------------
    // Extra fate placed at buy time, by printed id. DIRE characters must be
    // bought at exactly ZERO — Damned Hida is +3 military while dire (3 -> 6)
    // and Unleashed Experiment only sheds its downside abilities while dire —
    // so a fate placed on either is a strict downgrade, not insurance.
    // NOT WIRED. Nothing reads this map; an arm injecting it measures
    // bit-identical. Fate placement is owned by `fateAwareEconomy`, where
    // `bodyAdditionalFateForCostThree: 1` measured −5.4pp (Damned Hida is a
    // cost-3 body that must stay DIRE) and `durableAdditionalFate` 2/1 was
    // −0.6pp. Persistence is not this deck's problem; see the docs.
    additionalFateByCharacterId: Record<string, number>;

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

    // Dire bodies at zero, the two 5-cost payloads at one so they survive a
    // fate phase, everything else left to the generic economy.
    additionalFateByCharacterId: {
        'damned-hida': 0,
        'unleashed-experiment': 0,
        'silent-skirmisher': 0,
        'gallant-quartermaster': 0,
        'kaiu-envoy': 0,
        'one-of-the-forgotten': 0,
        'tainted-hero': 0,
        'repentant-legion': 1,
        'mercenary-company': 1
    },

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

    isBerserker(card: any): boolean {
        return hasTrait(card, 'berserker') ||
            (!!card?.id && this.profile.berserkerIds.includes(card.id));
    }

    isOutlet(card: any): boolean {
        return !!card?.id && this.profile.sacrificeOutletIds.includes(card.id);
    }

    isDoubler(card: any): boolean {
        return !!card?.id && this.profile.doublingCharacterIds.includes(card.id);
    }

    isButcher(card: any): boolean {
        return !!card?.id && this.profile.butcherIds.includes(card.id);
    }

    desiredAdditionalFate(cardId?: string): number | null {
        if(!cardId || !Object.prototype.hasOwnProperty.call(this.profile.additionalFateByCharacterId, cardId)) {
            return null;
        }
        return Math.max(0, numberOr(this.profile.additionalFateByCharacterId[cardId], 0));
    }

    isDire(card: any): boolean {
        return !!card?.id && this.profile.direCharacterIds.includes(card.id) &&
            (Number(card.fate) || 0) === 0;
    }

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

    outletPayoff(cardId: string): number {
        return numberOr(this.profile.pumpValueById[cardId], 0);
    }

    /**
     * Is spending a body here actually profitable? A live save does NOT make it
     * free — cancelling the leave-play cancels the whole ability, because every
     * outlet in this deck pays the body as a cost. See `saveInversion`.
     */
    sacrificeWorthIt(card: any, payoff: number, ctx: SacrificeContext): boolean {
        if(!card) {
            return false;
        }
        return this.sacrificeCost(card, ctx) <= payoff;
    }

    /**
     * Should a save (Iron Mine / Reprieve / Ceaseless Duty) be fired on THIS
     * leave-play? Never for a body we are ourselves spending as a sacrifice
     * cost: the save cancels the cost, the cost was then not paid, and the
     * ability we were paying for does not happen. The holding is spent for
     * nothing. Saves exist here to answer the OPPONENT's removal.
     */
    shouldSaveLeavingCard(card: any, ownSacrificeCostUuid?: string): boolean {
        if(!card) {
            return false;
        }
        return !ownSacrificeCostUuid || card.uuid !== ownSacrificeCostUuid;
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

    /**
     * We sacrifice a Crab; they must sacrifice a character of their choosing —
     * so they will pick their worst. It is only worth a card when their WORST
     * body is still worth more than our fodder, which is what makes it a tower
     * answer: against a board of one big character they have no cheap out.
     */
    wayOfTheCrabValue(opponentCharacters: any[], axis: Axis): number {
        const theirs = (opponentCharacters || []).filter(Boolean);
        if(theirs.length === 0) {
            return 0;
        }
        // They sacrifice their least valuable body.
        const worst = theirs
            .slice()
            .sort((left, right) => skillOf(left, axis) - skillOf(right, axis) || byUuid(left, right))[0];
        return skillOf(worst, axis) + (Number(worst.fate) || 0) * this.profile.sacrificeFateWeight;
    }

    // ---- buff steering -----------------------------------------------------

    /**
     * Where a pump is worth the most. Vengeful Berserker doubles its military,
     * so every point put on it counts twice once a friendly body has left play
     * during this conflict — which this deck arranges on purpose.
     */
    buffBonus(card: any): number {
        return this.isDoubler(card) ? this.profile.doublingBuffBonus : 0;
    }

    pickBuffTarget(participants: any[], axis: Axis): any {
        return (participants || [])
            .filter((card) => card && !card.bowed)
            .slice()
            .sort((left, right) =>
                (skillOf(right, axis) + this.buffBonus(right)) -
                (skillOf(left, axis) + this.buffBonus(left)) || byUuid(left, right))[0] || null;
    }

    // ---- Mercenary Company -------------------------------------------------

    /**
     * "Your opponent may move 1 fate from their pool to this character. If they
     * do, they gain control of it." Answered from EITHER side of the table: the
     * value is the body, the price is one fate.
     */
    shouldTakeMercenaryControl(card: any, myFate: number, axis: Axis): boolean {
        if(!card || !this.profile.mercenaryTakeoverIds.includes(card.id)) {
            return false;
        }
        if(myFate - 1 < this.profile.mercenaryMinimumFateAfterTakeover) {
            return false;
        }
        return skillOf(card, axis) >= this.profile.mercenaryTakeoverValue ||
            skillOf(card, 'military') >= this.profile.mercenaryTakeoverValue;
    }

    // ---- Tainted Hero ------------------------------------------------------

    /**
     * Tainted Hero cannot be declared at all until its own Action blanks its
     * text, and that Action costs a friendly body. 6 military for a Tier 1
     * body is the deck's best rate, but it must happen BEFORE declaration.
     */
    shouldBlankTaintedHero(spareBodies: any[], ctx: SacrificeContext): boolean {
        const usable = (spareBodies || []).filter(Boolean);
        if(usable.length < this.profile.taintedHeroMinimumSpareBodies) {
            return false;
        }
        const pick = this.pickSacrifice(usable, ctx);
        return !!pick;
    }
}
