// "Bid War" playstyle for the heuristic bot (Scorpion Kyuden Bayushi,
// EmeraldDB 2bf73f61).
//
// The deck's engine is the HONOR DIAL, not the board. Three separate payoffs
// hang off it and they pull in different directions, which is why this needs a
// module instead of a knob:
//
//   * OWN HONOR TOTAL. Shadow Stalker (+2/+2), Alibi Artist (dig 2) and the
//     Kyuden Bayushi ready bonus (+1/+1) all read "6 or fewer honor", and
//     Forgery/Beautiful Entertainer read "less honorable than an opponent".
//     The deck therefore WANTS to sit in a low honor band — the opposite of
//     every other deck the bot pilots — and Duty is the net that keeps 0 from
//     being lethal.
//   * OWN DIAL vs THEIR DIAL. I Can Swim needs ours strictly higher; Make an
//     Opening scales with |difference|; Social Puppeteer can swap the two.
//   * CARD VOLUME. Regal Bearing sets our dial to 1 and draws the difference,
//     so it pays most against a HIGH opposing bid, and the honor we pay for
//     bidding high is honor we wanted to lose anyway.
//
// `showBid` (the visible dial) drives I Can Swim / Make an Opening / Regal
// Bearing / Social Puppeteer. `honorBid` (dial + modifier) drives the transfer
// and the draw. Bayushi Manipulator moves the MODIFIER, so it buys a card and
// pays honor without changing anything the dial-difference cards read.
//
// Everything here is DATA-gated: the tactics object only exists when the deck
// profile carries a BidWarProfile (derived from the Kyuden Bayushi marker), so
// every other deck — including the fine-tuned Unicorn default and the separate
// Scorpion Poison Mill dishonor list — keeps unchanged generic behavior.

export interface BidWarCardPower {
    // Skill-equivalent worth of one copy of a card sitting in a hand we are
    // about to strip. Supplied by the caller from the shared DeckAnalysis
    // registry so this module stays free of card tables.
    swing: number;
    // Cost in fate. A card the opponent cannot pay for this round is worth
    // less to take away right now.
    fate: number;
    type: string;
    known: boolean;
}

export interface BidWarDrawBidContext {
    roundNumber: number;
    myHonor: number;
    opponentHonor: number;
    myHandCount: number;
    // Cards in hand that only pay while our dial is ABOVE theirs.
    highDialPayoffCards: number;
    // Cards in hand that only pay while THEIR dial is high (Regal Bearing).
    opponentHighDialPayoffCards: number;
}

export interface BidWarProfile {
    // ---- the honor band ----
    // Cards that read "6 or fewer honor". Above it the deck is running at
    // half power, so a high bid is a FEATURE, not a cost.
    honorCeiling: number;
    // Optional honor costs stop here. Duty only cancels a loss that would take
    // the LAST honor, so it does not make every honor cost free.
    honorFloor: number;
    // At or below this the deck is one effect from losing; bid to receive.
    lethalHonorFloor: number;

    // ---- draw bidding ----
    //
    // The band has a FLOOR as well as a ceiling, and the first measured build
    // did not have one: it bid 5 while above the ceiling and 4 inside it, so it
    // paid honor every round and died at 0. Over 432 field games, 224 of its
    // 282 losses (79%) were dishonor, and the Poison Mill dishonor deck beat it
    // 36-0. "6 or fewer honor" is a place to LIVE, not a place to fall through.
    openingBid: number; // round 1: maximum cards, and the honor drop is wanted
    descendBid: number; // above the ceiling: buy cards AND drop into the band
    inBandBid: number; // inside the band: hold roughly level
    recoveryBid: number; // below the floor: bid low so THEY pay US
    rescueBid: number; // at/below lethalHonorFloor
    bandFloor: number; // below this the deck is bleeding out, not "playing risky"
    // Bid high enough to beat a value bidder while any I Can Swim / Make an
    // Opening sits in hand: those cards are dead when the dials tie. Only
    // affordable with honor to spare above the floor.
    highDialPayoffBid: number;
    highDialPayoffMinHonorAboveFloor: number;
    // Two situations where a high bid is a gift and the generic rails are
    // right: the opponent is close to the dishonor loss (every point we hand
    // over buys them another round), or close to the honor VICTORY at 25.
    opponentPressureHonor: number;
    opponentHonorVictoryGuard: number;

    // ---- Bayushi Manipulator (+1 to our bid AFTER the dials are shown) ----
    manipulatorMinHonor: number; // never buy the card if the honor could be lethal
    // Do not spend the reaction when our hand is already saturated.
    manipulatorMaxHandCount: number;

    // ---- dial-difference cards ----
    makeAnOpeningMinDifference: number; // -X/-X below this is not worth a card
    regalBearingMinDraw: number; // |1 - theirBid| below this is not worth a card
    // Social Puppeteer swaps dials. Worth the once-per-round Action when the
    // swap turns on a payoff: composure for us, or an I Can Swim we could not
    // otherwise fire.
    puppeteerEnabled: boolean;

    // ---- Kyuden Bayushi ----
    // Bow the stronghold to ready a dishonored friendly character. Only worth
    // it for a body whose readied skill clears this, or for the band bonus.
    strongholdReadyMinSkill: number;
    strongholdReadyRequiresConflict: boolean;
    // Also fire when the only dishonored friendly is already READY, buying the
    // +1/+1 alone. Off by default: the shared ready-target selector cancels an
    // ability whose `ready` action has no bowed own body, so an ungated click
    // spends the once-per-round bow on a cancel.
    strongholdBandBonusOnly: boolean;

    // ---- Bayushi Kachiko (Atonement): replay opponent discard events ----
    kachikoReplayMaxPerRound: number;
    kachikoReplayMinSwing: number;
    kachikoImportantCharacterIds: string[];
    kachikoAdditionalFate: number;

    // ---- Upholding Authority: strip the attacker's hand on the break ----
    // A second copy of the same card is worth less than the first (the first
    // already answers the situation), but two copies of a medium card can
    // still beat one copy of a strong one — which is exactly the choice this
    // province presents.
    handDiscardCopyWeight: number;
    handDiscardUnknownSwing: number; // an unmodeled card is not worthless
    handDiscardAffordableBonus: number; // they can actually cast it this round
    handDiscardMinPower: number; // below this, decline and keep the information

    // ---- personal honor ----
    // Characters that GAIN skill while dishonored (Shosuro Sadako reverses the
    // glory modifier). Forced own-dishonor costs should land here, and so
    // should the deliberate ones (Court Mask, Calling in Favors, Geisha House).
    reverseHonorCardIds: string[];

    // ---- Acclaimed Geisha House ----
    // Dishonor a friendly participant to switch the contested ring. Only worth
    // it when the ring actually changes hands in our favour.
    geishaHouseEnabled: boolean;

    // ---- Elegant Tessen ----
    // The ready, not the +1/+1, is the card: nine of this deck's characters
    // cost 1-2, and a bowed courtier that stands up defends or joins another
    // conflict. It has to enter play BEFORE a declaration to do that, so it is
    // played from a conflict-phase action window.
    tessenAttachmentId: string;
    tessenMaxPrintedCost: number; // the printed condition ("cost 2 or less")

    // ---- dynasty events ----
    dispatchMinTargetSkill: number; // do not spend removal on a 0/1 body
    seasonOfWarMaxUsefulProvinceCards: number; // reroll only a dead province row

    // ---- Alibi Artist ----
    alibiMaxHandCount: number; // stop digging into a full hand
}

export const BID_WAR_DEFAULTS: BidWarProfile = {
    honorCeiling: 6,
    honorFloor: 3,
    lethalHonorFloor: 2,

    openingBid: 5,
    descendBid: 5,
    // Inside the band, bid 1: a bid that can only RECEIVE honor. Measured
    // against inBandBid 2 on two independent six-base sets (432 and 863 games):
    // +1.16pp and +0.57pp. Both below the noise floor on their own, but the
    // mechanism is not — a 2 into a low-bidding opponent buys one card for one
    // honor every round, and dishonor is how this deck loses (46% of its
    // losses even after the band fix).
    inBandBid: 1,
    recoveryBid: 1,
    rescueBid: 1,
    bandFloor: 4,
    highDialPayoffBid: 4,
    highDialPayoffMinHonorAboveFloor: 2,
    opponentPressureHonor: 6,
    opponentHonorVictoryGuard: 20,

    manipulatorMinHonor: 4,
    manipulatorMaxHandCount: 10,

    makeAnOpeningMinDifference: 2,
    regalBearingMinDraw: 2,
    puppeteerEnabled: true,

    strongholdReadyMinSkill: 2,
    strongholdReadyRequiresConflict: false,
    strongholdBandBonusOnly: false,

    kachikoReplayMaxPerRound: 3,
    kachikoReplayMinSwing: 2,
    kachikoImportantCharacterIds: ['bayushi-kachiko-2', 'social-puppeteer'],
    kachikoAdditionalFate: 1,

    handDiscardCopyWeight: 0.7,
    handDiscardUnknownSwing: 2,
    handDiscardAffordableBonus: 1,
    handDiscardMinPower: 0,

    reverseHonorCardIds: ['shosuro-sadako'],

    geishaHouseEnabled: true,

    tessenAttachmentId: 'elegant-tessen',
    tessenMaxPrintedCost: 2,

    dispatchMinTargetSkill: 2,
    seasonOfWarMaxUsefulProvinceCards: 1,

    alibiMaxHandCount: 9
};

// One entry of an Upholding Authority hand menu: the engine collapses copies
// into a single button whose text carries the count ("Assassination (2)").
export interface HandDiscardOption {
    cardId: string;
    copies: number;
    button: any;
}

const HAND_COUNT_SUFFIX = /\s\((\d+)\)\s*$/;

export function parseHandDiscardOptions(buttons: any[]): HandDiscardOption[] {
    const options: HandDiscardOption[] = [];
    for(const button of buttons || []) {
        const cardId = String(button?.arg ?? '');
        // Choice buttons ("Don't discard anything") carry a numeric index arg
        // and no card, so they never look like a card id.
        if(!cardId || !button?.card || /^\d+$/.test(cardId)) {
            continue;
        }
        const match = HAND_COUNT_SUFFIX.exec(String(button.text || ''));
        options.push({
            cardId,
            copies: match ? Math.max(1, parseInt(match[1], 10)) : 1,
            button
        });
    }
    return options;
}

export class BidWarTactics {
    constructor(private profile: BidWarProfile) {}

    get honorCeiling(): number {
        return this.profile.honorCeiling;
    }

    // Gate for every ability that PAYS honor. Duty saves the LAST honor, not
    // every point of it, so the floor still exists.
    canPayHonor(myHonor: number): boolean {
        return myHonor > this.profile.honorFloor;
    }

    inBand(myHonor: number): boolean {
        return myHonor <= this.profile.honorCeiling;
    }

    // ---- draw bidding -----------------------------------------------------

    // Applied on top of the shared DrawBidTactics analysis, the same way
    // UnicornRevealTactics.adjustDrawBid layers on the generic answer. Bidding
    // HIGH does three things at once for this deck (cards, honor into the
    // band, and a dial above theirs), so the generic "protect my honor"
    // instinct has to be overruled everywhere except genuine lethal range.
    adjustDrawBid(baseBid: number, context: BidWarDrawBidContext): number {
        const { myHonor, roundNumber } = context;
        if(myHonor <= this.profile.lethalHonorFloor) {
            return this.profile.rescueBid;
        }
        if(roundNumber <= 1) {
            return this.profile.openingBid;
        }
        // Handing honor to an opponent who is one effect from the dishonor
        // loss, or one round from the honor victory, is a gift no card in this
        // deck pays for. Never raise the bid in either case.
        if(context.opponentHonor <= this.profile.opponentPressureHonor ||
            context.opponentHonor >= this.profile.opponentHonorVictoryGuard) {
            return Math.min(baseBid, this.profile.inBandBid);
        }
        // Below the band floor the deck is not "playing risky", it is dying.
        // A low bid makes the OPPONENT pay us the difference, which is the only
        // repeatable way back up.
        if(myHonor < this.profile.bandFloor) {
            return this.profile.recoveryBid;
        }
        // Above the ceiling a max bid does two wanted things at once: it buys
        // cards, and the honor it pays is honor the deck wants gone (Shadow
        // Stalker, Alibi Artist and the stronghold bonus all read "6 or fewer").
        if(myHonor > this.profile.honorCeiling) {
            return Math.max(baseBid, this.profile.descendBid);
        }
        // Inside the band. I Can Swim and Make an Opening are dead on a tie and
        // weak on a small gap, so a raised bid can still be worth its honor —
        // but only with room above the floor to pay for it.
        if(context.highDialPayoffCards > 0 &&
            myHonor >= this.profile.bandFloor + this.profile.highDialPayoffMinHonorAboveFloor) {
            return Math.max(baseBid, this.profile.highDialPayoffBid);
        }
        // Regal Bearing zeroes our own dial when it resolves, so it never wants
        // us to bid high — it wants THEIR dial high, which we do not control.
        return this.profile.inBandBid;
    }

    // Bayushi Manipulator's reaction raises the MODIFIER: one extra card, and
    // one more honor across the table when we are the higher bidder. Both are
    // wanted while the honor is not lethal and the hand is not already full.
    shouldModifyBid(myHonor: number, myHandCount: number): boolean {
        return myHonor > this.profile.manipulatorMinHonor &&
            myHandCount <= this.profile.manipulatorMaxHandCount;
    }

    // ---- dial-difference cards -------------------------------------------

    dialDifference(myBid?: number, opponentBid?: number): number {
        const mine = Number(myBid);
        const theirs = Number(opponentBid);
        if(!Number.isFinite(mine) || !Number.isFinite(theirs) || mine <= 0 || theirs <= 0) {
            return 0;
        }
        return Math.abs(mine - theirs);
    }

    // Make an Opening applies -X/-X where X is the absolute difference, so it
    // is a debuff on THEIR participant and it is dead at X = 0.
    makeAnOpeningValue(myBid?: number, opponentBid?: number): number {
        const difference = this.dialDifference(myBid, opponentBid);
        return difference >= this.profile.makeAnOpeningMinDifference ? difference : 0;
    }

    // I Can Swim needs our dial strictly higher AND a dishonored enemy
    // participant. Unknown dials keep the card in hand rather than burning it
    // on a cancel.
    canSwim(myBid: number | undefined, opponentBid: number | undefined, opponentCharacters: any[]): boolean {
        const mine = Number(myBid);
        const theirs = Number(opponentBid);
        if(!Number.isFinite(mine) || !Number.isFinite(theirs) || mine <= theirs) {
            return false;
        }
        return (opponentCharacters || []).some((card) => card?.inConflict && card?.isDishonored);
    }

    // Regal Bearing sets our dial to 1 and draws |1 - theirBid|. It needs a
    // participating Courtier and a political conflict; both are checked by the
    // engine, so this only prices the draw.
    regalBearingDraw(opponentBid?: number): number {
        const theirs = Number(opponentBid);
        if(!Number.isFinite(theirs) || theirs <= 0) {
            return 0;
        }
        const draw = Math.abs(1 - theirs);
        return draw >= this.profile.regalBearingMinDraw ? draw : 0;
    }

    // Social Puppeteer swaps the dials for the rest of the round. Worth the
    // Action when the swap turns something on that is off now: composure (our
    // bid becomes the lower one) or an I Can Swim that needs us higher.
    shouldSwitchDials(
        myBid: number | undefined,
        opponentBid: number | undefined,
        hand: any[],
        opponentCharacters: any[]
    ): boolean {
        if(!this.profile.puppeteerEnabled) {
            return false;
        }
        const mine = Number(myBid);
        const theirs = Number(opponentBid);
        if(!Number.isFinite(mine) || !Number.isFinite(theirs) || mine === theirs) {
            return false;
        }
        const holds = (id: string) => (hand || []).some((card) => card?.id === id);
        // We bid high, they bid low: swapping makes us the LOWER bidder, which
        // is composure — and Regal Bearing already used our high dial.
        if(mine > theirs) {
            return holds('social-puppeteer') ? false : this.hasComposurePayoff(hand);
        }
        // We bid low, they bid high: swapping puts us above them and switches
        // on I Can Swim.
        return holds('i-can-swim') &&
            (opponentCharacters || []).some((card) => card?.inConflict && card?.isDishonored);
    }

    private hasComposurePayoff(hand: any[]): boolean {
        // Composure on Social Puppeteer forces the opponent to aim their events
        // at it. That is only a payoff when we still hold characters worth
        // protecting; a bare swap is a wasted Action.
        return (hand || []).length > 0;
    }

    // ---- Kyuden Bayushi ---------------------------------------------------

    // Bow the stronghold, ready a dishonored friendly character, and while at
    // 6 or fewer honor give it +1/+1 for the phase. The ready is the point:
    // a bowed participant contributes 0 skill, and a readied home body can be
    // declared into another conflict.
    shouldUseStronghold(myCharacters: any[], myHonor: number, activeConflict: boolean): boolean {
        if(this.profile.strongholdReadyRequiresConflict && !activeConflict) {
            return false;
        }
        const targets = (myCharacters || []).filter((card) => card?.isDishonored);
        if(targets.length === 0) {
            return false;
        }
        const bandBonus = myHonor <= this.profile.honorCeiling;
        return targets.some((card) => {
            if(card?.bowed) {
                return this.combinedSkill(card) >= this.profile.strongholdReadyMinSkill;
            }
            // Already ready: the click only buys the +1/+1, so it needs the
            // band and a participant for the skill to matter — and the shared
            // ready-target selector cancels when nothing of ours is bowed.
            return this.profile.strongholdBandBonusOnly && bandBonus && !!card?.inConflict;
        });
    }

    // Ready the bowed dishonored body with the most skill to recover; fall back
    // to a ready participant for the band bonus.
    pickStrongholdReadyTarget(cards: any[], myHonor: number): any | null {
        const dishonored = (cards || []).filter((card) => card?.isDishonored);
        const bowed = dishonored.filter((card) => card?.bowed)
            .filter((card) => this.combinedSkill(card) >= this.profile.strongholdReadyMinSkill)
            .sort((a, b) => this.combinedSkill(b) - this.combinedSkill(a) ||
                this.uuid(a).localeCompare(this.uuid(b)));
        if(bowed.length > 0) {
            return bowed[0];
        }
        if(myHonor > this.profile.honorCeiling) {
            return null;
        }
        return dishonored.filter((card) => card?.inConflict)
            .sort((a, b) => this.combinedSkill(b) - this.combinedSkill(a) ||
                this.uuid(a).localeCompare(this.uuid(b)))[0] || null;
    }

    // ---- Bayushi Kachiko: playing out of the opponent's discard -----------

    kachikoParticipating(myCharacters: any[], conflictType: string): boolean {
        return conflictType === 'political' && (myCharacters || []).some((card) =>
            card?.id === 'bayushi-kachiko-2' && card?.inConflict);
    }

    // Rank the opponent's discarded EVENTS by what they would do for us. The
    // engine already restricts the pool (their events, political conflict,
    // Kachiko participating, three per round); this decides which of them is
    // worth a play, and refuses the ones that do nothing on our side of the
    // table. `power` is supplied by the caller from the shared card registry.
    rankOpponentDiscardEvents(
        cards: any[],
        power: (cardId: string) => BidWarCardPower | undefined,
        options: { replaysUsed?: number; playable?: (card: any) => boolean } = {}
    ): any[] {
        const used = Math.max(0, Number(options.replaysUsed) || 0);
        if(used >= this.profile.kachikoReplayMaxPerRound) {
            return [];
        }
        return (cards || [])
            .filter((card) => {
                if(!card?.id || card?.type !== 'event') {
                    return false;
                }
                if(options.playable && !options.playable(card)) {
                    return false;
                }
                const model = power(card.id);
                const swing = model?.known ? model.swing : this.profile.handDiscardUnknownSwing;
                return swing >= this.profile.kachikoReplayMinSwing;
            })
            .sort((a, b) => {
                const swingOf = (card: any) => {
                    const model = power(card.id);
                    return model?.known ? model.swing : this.profile.handDiscardUnknownSwing;
                };
                const costOf = (card: any) => power(card.id)?.fate ?? 0;
                return swingOf(b) - swingOf(a) || costOf(a) - costOf(b) ||
                    this.uuid(a).localeCompare(this.uuid(b));
            });
    }

    kachikoDesiredAdditionalFate(cardId?: string): number | null {
        return !!cardId && this.profile.kachikoImportantCharacterIds.includes(cardId)
            ? this.profile.kachikoAdditionalFate
            : null;
    }

    // ---- Upholding Authority ---------------------------------------------

    // "Discard any number of copies of that card" — so the real question is
    // which NAME costs the attacker the most, counting every copy at once. One
    // strong card can lose to two copies of a medium one, which is why this is
    // a sum over copies and not a max over cards.
    scoreHandDiscardOption(
        option: HandDiscardOption,
        power: (cardId: string) => BidWarCardPower | undefined,
        opponentFate: number
    ): number {
        const model = power(option.cardId);
        const base = model?.known
            ? Math.max(model.swing, this.bodyValue(model))
            : this.profile.handDiscardUnknownSwing;
        const affordable = !model?.known || model.fate <= Math.max(0, Number(opponentFate) || 0);
        const perCopy = base + (affordable ? this.profile.handDiscardAffordableBonus : 0);
        const extraCopies = Math.max(0, option.copies - 1);
        return perCopy + extraCopies * perCopy * this.profile.handDiscardCopyWeight;
    }

    pickHandDiscard(
        buttons: any[],
        power: (cardId: string) => BidWarCardPower | undefined,
        opponentFate: number
    ): HandDiscardOption | null {
        const options = parseHandDiscardOptions(buttons);
        if(options.length === 0) {
            return null;
        }
        const scored = options
            .map((option) => ({ option, score: this.scoreHandDiscardOption(option, power, opponentFate) }))
            .sort((a, b) => b.score - a.score || a.option.cardId.localeCompare(b.option.cardId));
        return scored[0].score >= this.profile.handDiscardMinPower ? scored[0].option : null;
    }

    // The follow-up menu asks how many copies. Always every copy: the ability
    // costs nothing extra and the whole point is removing the answer, not one
    // instance of it.
    pickHandDiscardCount(buttons: any[]): any | null {
        const numeric = (buttons || [])
            .map((button) => ({ button, value: parseInt(String(button?.text ?? ''), 10) }))
            .filter((entry) => Number.isFinite(entry.value));
        if(numeric.length === 0) {
            return null;
        }
        return numeric.sort((a, b) => b.value - a.value)[0].button;
    }

    // ---- personal honor ---------------------------------------------------

    // Shosuro Sadako adds her glory instead of subtracting it while
    // dishonored, so she is the CHEAPEST target for every dishonor cost this
    // deck pays (Court Mask, Calling in Favors, Acclaimed Geisha House,
    // Shameful Display) and the best one for a forced own-dishonor.
    prefersDishonor(card: any): boolean {
        return !!card?.id && this.profile.reverseHonorCardIds.includes(card.id);
    }

    get reverseHonorCardIds(): readonly string[] {
        return this.profile.reverseHonorCardIds;
    }

    // ---- Acclaimed Geisha House ------------------------------------------

    // Cost: dishonor a friendly participant. That is nearly free with Sadako
    // on the board and a real cost otherwise, so require either her or a
    // participant whose glory loss does not flip the conflict.
    shouldUseGeishaHouse(myCharacters: any[], activeConflict: boolean): boolean {
        if(!this.profile.geishaHouseEnabled || !activeConflict) {
            return false;
        }
        const participants = (myCharacters || []).filter((card) => card?.inConflict && !card?.isDishonored);
        if(participants.length === 0) {
            return false;
        }
        return participants.some((card) => this.prefersDishonor(card)) ||
            participants.some((card) => this.gloryOf(card) === 0);
    }

    // ---- Elegant Tessen ---------------------------------------------------

    // +1/+1, and on entering play it READIES a bearer of printed cost 2 or
    // less. Nine of this deck's characters cost 1 or 2, so the ready is the
    // real card: a bowed courtier stands back up and defends, or joins another
    // conflict. It cannot be played mid-conflict for that purpose (the ready
    // has to happen before the declaration), so it belongs in a conflict-PHASE
    // action window — the same slot the Lion list uses it from.
    pickTessenTarget(
        cards: any[],
        skill: (card: any) => number,
        printedCostsByUuid?: Record<string, number>
    ): any | null {
        return (cards || [])
            .filter((card) => card?.bowed &&
                this.printedCost(card, printedCostsByUuid) <= this.profile.tessenMaxPrintedCost)
            .sort((a, b) => skill(b) - skill(a) || this.uuid(a).localeCompare(this.uuid(b)))[0] || null;
    }

    pickTessenSetup(
        hand: any[],
        myCharacters: any[],
        printedCostsByUuid?: Record<string, number>
    ): any | null {
        if(!this.pickTessenTarget(myCharacters, () => 0, printedCostsByUuid)) {
            return null;
        }
        return (hand || []).find((card) => card?.id === this.profile.tessenAttachmentId) || null;
    }

    private printedCost(card: any, printedCostsByUuid?: Record<string, number>): number {
        const live = card?.uuid ? printedCostsByUuid?.[card.uuid] : undefined;
        const value = Number(live ?? card?.printedCost ?? card?.cost);
        return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    }

    // ---- dynasty events ---------------------------------------------------

    // Dispatch to Nowhere discards ANY character with no fate. Bodies bought
    // without additional fate are the field norm, so this is the deck's only
    // unconditional removal — but it must see a target on the opponent's side,
    // or the targeting step offers only ours.
    pickDynastyEvent(
        playable: any[],
        costs: Record<string, number>,
        fate: number,
        opponentCharacters: any[],
        ownProvinceCardCount: number
    ): { card: any; reason: string } | null {
        const affordable = (card: any) => (Number(costs?.[card?.uuid]) || 0) <= fate;
        const dispatch = (playable || []).find((card) => card?.id === 'dispatch-to-nowhere' && affordable(card));
        if(dispatch && (opponentCharacters || []).some((card) =>
            (Number(card?.fate) || 0) === 0 &&
            this.combinedSkill(card) >= this.profile.dispatchMinTargetSkill)) {
            return { card: dispatch, reason: 'bid-war-play-dispatch-fateless-body' };
        }
        // A Season of War discards every province card on BOTH sides, refills
        // them faceup and restarts the dynasty phase. It is a reroll, so it is
        // only worth a card when our own faceup provinces have nothing left we
        // want to buy.
        const season = (playable || []).find((card) => card?.id === 'a-season-of-war' && affordable(card));
        if(season && ownProvinceCardCount <= this.profile.seasonOfWarMaxUsefulProvinceCards) {
            return { card: season, reason: 'bid-war-play-season-of-war-reroll' };
        }
        return null;
    }

    // ---- Alibi Artist -----------------------------------------------------

    shouldDig(myHonor: number, myHandCount: number): boolean {
        return myHonor <= this.profile.honorCeiling &&
            myHandCount <= this.profile.alibiMaxHandCount;
    }

    // ---- shared helpers ---------------------------------------------------

    private bodyValue(model: BidWarCardPower): number {
        // A character or attachment in hand is worth roughly what it puts on
        // the board; the registry stores that as skill, not swing.
        return model.type === 'character' || model.type === 'attachment' ? model.swing : 0;
    }

    private gloryOf(card: any): number {
        const summary = Number(card?.glorySummary?.stat);
        return Math.max(0, Number.isFinite(summary) ? summary : Number(card?.glory) || 0);
    }

    private combinedSkill(card: any): number {
        return this.skillOf(card, 'military') + this.skillOf(card, 'political');
    }

    private skillOf(card: any, axis: 'military' | 'political'): number {
        const summary = axis === 'military' ? card?.militarySkillSummary : card?.politicalSkillSummary;
        const raw = summary?.stat ?? card?.[axis];
        const value = Number(raw);
        return Number.isFinite(value) ? Math.max(value, 0) : 0;
    }

    private uuid(card: any): string {
        return String(card?.uuid || card?.id || '');
    }
}
