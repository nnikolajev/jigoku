// Lion Duelist tactics for Kyuden Ikoma decks (EmeraldDB a2058c37).
//
// The playstyle is HONOR AS A SWITCH, not honor as a win condition. Five of the
// deck's best effects — Matsu Tsuko's free break, Matsu Agetoki's conflict move,
// Matsu Mitsuko's move-in, Blade of 10,000 Battles' card recursion, and (through
// the dial) Regal Bearing's draw — all read "if you are more honorable than your
// opponent". So the deck bids LOW after the opening round: a low dial gains
// honor from the higher bidder, turns those five cards on, and simultaneously
// fires Tactician's Apprentice. Card advantage comes from Regal Bearing, Setting
// the Standard, Blade, Imperial Storehouse and Proving Ground instead of the
// dial.
//
// On top of that it is a MOVE/READY deck: eight different cards put a body into
// a conflict it was not declared in (Mitsuko, Even the Odds, Formal Invitation,
// Kitsu Spiritcaller, Forebearer's Echoes, Keeper Initiate) or ready one that is
// already there (Fan of Command, In Service to My Lord). The value of every one
// of those is the same quantity — skill added to THIS conflict — so they share
// the pricing helpers below.
//
// Every knob is data. Nothing here is reachable unless `DeckProfile.lionDuelist`
// is present, which only the `lion-duelist-kyuden-ikoma` override sets.

export interface LionDuelistProfile {
    // ---- identity lists ----------------------------------------------------
    // Bodies worth extra dynasty fate and first claim on attachments.
    towerCharacters: string[];
    // Commander trait payoff (Even the Odds / Prepare for War honor rider).
    commanderCharacters: string[];
    // Champion trait — Kyuden Ikoma may NOT bow these.
    championCharacters: string[];
    bushiCharacters: string[];
    // Extra fate placed at buy time, by printed id. Ikoma Prodigy's reaction
    // pays 1 honor for the first fate, so it is never bought bare.
    additionalFateByCharacterId: Record<string, number>;

    // ---- Kyuden Ikoma ------------------------------------------------------
    // Reaction after we LOSE a conflict we attacked: bow the stronghold, bow a
    // non-Champion character. Bowing an already-bowed body is worth nothing, and
    // a body bows anyway when it returns home from a conflict it participated
    // in, so the only real targets are ready non-participants.
    strongholdBowRequiresReadyTarget: boolean;
    strongholdBowSkipsParticipants: boolean;
    strongholdBowMinimumSkill: number;

    // ---- Frostbitten Crossing (strip every attachment off one body) --------
    stripMinimumValue: number;

    // ---- Kitsu Motso -------------------------------------------------------
    // Drags an OPPONENT body into the conflict. That body bows when it returns
    // home, so this is tempo denial paid for with skill we hand them right now.
    // Only correct when the conflict's outcome cannot change.
    motsoAllowOnDefense: boolean;
    motsoMinimumTargetSkill: number;
    // The conflict is out of reach when we would still need more than this much
    // skill to win it; only then is their extra body free.
    motsoHopelessWinDeficit: number;
    // ...or already safe when our lead exceeds the target's skill by this much.
    motsoSafeLeadMargin: number;

    // ---- recursion (Kitsu Spiritcaller, Forebearer's Echoes) ---------------
    recursionMinimumSkill: number;
    recursionGloryWeight: number;
    recursionFateWeight: number;

    // ---- Matsu Agetoki ----------------------------------------------------
    // Move the contested ring to a weaker province. Only worth a whole card
    // Action when the new province saves at least this much strength.
    agetokiMinimumStrengthSaving: number;
    // How far out of reach the break must be before spending Agetoki's Action.
    // `strengthNeeded` is the extra skill still needed to break, and it is
    // positive at declaration for essentially every attack, so a bare "> 0"
    // gate moved the conflict before the deck had played a single pump.
    agetokiMinimumStrengthNeeded: number;
    // A facedown province is a gamble; price it at the field average so the
    // sorter neither always nor never picks one.
    facedownProvinceAssumedStrength: number;

    // ---- Matsu Tsuko ------------------------------------------------------
    // While one of these is attacking a non-stronghold province and we are more
    // honorable, WINNING the conflict breaks it — province strength stops being
    // the target number.
    winIsBreakCharacterIds: string[];

    // ---- Akodo Zentaro ----------------------------------------------------
    holdingValueById: Record<string, number>;
    holdingDefaultValue: number;
    zentaroMinimumHoldingValue: number;

    // ---- attachments ------------------------------------------------------
    // Illustrious Forge dig order and hand-play order. The card summaries at the
    // Forge menu carry no stats, so this list IS the ranking.
    attachmentRanking: string[];
    // Preferred attachment carriers, best first.
    keyCharacters: string[];
    formalInvitationMinimumGlory: number;

    // ---- duels ------------------------------------------------------------
    // Duel sources and the axis each one duels on, for the shared duel-target
    // steering (ours -> strongest on axis, theirs -> weakest).
    duelAxes: Record<string, 'military' | 'political'>;

    // ---- dynasty events ---------------------------------------------------
    // Dynasty EVENTS are legal from a province exactly like a character, but
    // every dynasty economy path in the bot ranks CHARACTERS only, so an event
    // sits face-up in its province until the round ends and is discarded. Three
    // copies of Honored Veterans measured ZERO uses per game before this.
    // Honored Veterans wants a Bushi bought THIS phase that is not yet honored
    // and has glory to gain; A Season of War is a reroll, so it is only worth a
    // card once the visible provinces have nothing left we want.
    honoredVeteransMinimumGlory: number;
    seasonOfWarMaxUsefulProvinceCards: number;
    seasonOfWarMinimumFate: number;

    // ---- axis payoff ------------------------------------------------------
    // Regal Bearing is this deck's card engine and it is legal ONLY during a
    // political conflict in which we control a participating Courtier. The
    // deck's board leans military, so the axis chooser — a pure board reading —
    // picked military every round and the card never fired. This is the
    // skill-equivalent value handed to `ConflictDeclarationPolicy` when the
    // engine is actually live: the card is in hand, a Courtier is ready, the
    // political conflict is still available, and the opponent's dial is high
    // enough to be worth drawing off. Zero disables the whole mechanism.
    politicalPayoffCardIds: string[];
    politicalPayoffCourtierIds: string[];
    politicalPayoffBonus: number;
    politicalPayoffMinimumOpponentBid: number;

    // ---- ring preference --------------------------------------------------
    // The generic ring score reads the board and the rings' fate; it has no
    // notion of a ROLE. This deck's role is Keeper of Air, which makes claiming
    // AIR put a Keeper Initiate into play from the dynasty discard with a free
    // fate — the reason three copies are force-discarded in the fate phase —
    // and makes a defensive air win pay a fate. Fire and water each give every
    // Ikoma Reservist +2 military while claimed. None of that was reachable.
    recursionRingElements: string[];
    recursionRingCardIds: string[];
    recursionRingBonus: number;
    skillRingElements: string[];
    skillRingCardIds: string[];
    skillRingBonus: number;
}

export const LION_DUELIST_DEFAULTS: LionDuelistProfile = {
    towerCharacters: ['akodo-toturi', 'matsu-tsuko-2', 'matsu-mitsuko', 'matsu-agetoki'],
    commanderCharacters: [
        'kitsu-motso', 'akodo-zentaro', 'matsu-agetoki', 'matsu-mitsuko', 'matsu-tsuko-2'
    ],
    championCharacters: ['akodo-toturi', 'matsu-tsuko-2'],
    bushiCharacters: [
        'tactician-s-apprentice', 'ikoma-reservist', 'kitsu-motso', 'akodo-zentaro',
        'matsu-agetoki', 'matsu-mitsuko', 'akodo-toturi', 'matsu-tsuko-2'
    ],
    // Prodigy's reaction is "after 1 or more fate is placed on this character —
    // gain 1 honor", and it also fires on entering play with fate. One fate buys
    // one honor and one extra round of life on a 1-cost body.
    additionalFateByCharacterId: {
        'ikoma-prodigy': 1,
        'akodo-toturi': 2,
        'matsu-tsuko-2': 2,
        'matsu-mitsuko': 1,
        'matsu-agetoki': 1
    },

    strongholdBowRequiresReadyTarget: true,
    strongholdBowSkipsParticipants: true,
    strongholdBowMinimumSkill: 1,

    stripMinimumValue: 8,

    motsoAllowOnDefense: false,
    motsoMinimumTargetSkill: 2,
    motsoHopelessWinDeficit: 4,
    motsoSafeLeadMargin: 2,

    recursionMinimumSkill: 2,
    recursionGloryWeight: 0.5,
    recursionFateWeight: 0,

    agetokiMinimumStrengthSaving: 2,
    agetokiMinimumStrengthNeeded: 3,
    facedownProvinceAssumedStrength: 4,

    winIsBreakCharacterIds: ['matsu-tsuko-2'],

    // Denying an income/draw engine is worth more than denying raw strength;
    // Favorable Ground and Proving Ground are also the field's own Lion cards.
    holdingValueById: {
        'imperial-storehouse': 7,
        'proving-ground': 7,
        'favorable-ground': 6,
        'shameful-display': 5,
        'kaiu-shiro': 8,
        'iron-mine': 6,
        'karada-district': 6,
        'reserve-tents': 5,
        'chikai-order-dojo': 6,
        'staging-ground': 6,
        'seventh-tower': 5
    },
    holdingDefaultValue: 4,
    zentaroMinimumHoldingValue: 4,

    // Blade and Setting the Standard both convert every conflict win into cards
    // and are the reason the deck can bid 1 without going card-starved. The duel
    // grants come next: they bow a body regardless of who wins the conflict.
    attachmentRanking: [
        'blade-of-10-000-battles', 'setting-the-standard', 'true-strike-kenjutsu',
        'duelist-training', 'fan-of-command', 'formal-invitation'
    ],
    keyCharacters: [
        'akodo-toturi', 'matsu-tsuko-2', 'matsu-mitsuko', 'matsu-agetoki',
        'kitsu-motso', 'akodo-zentaro'
    ],
    formalInvitationMinimumGlory: 2,

    duelAxes: {
        'duelist-training': 'military',
        'true-strike-kenjutsu': 'military'
    },

    honoredVeteransMinimumGlory: 1,
    seasonOfWarMaxUsefulProvinceCards: 1,
    seasonOfWarMinimumFate: 2,

    politicalPayoffCardIds: ['regal-bearing'],
    politicalPayoffCourtierIds: ['ikoma-prodigy'],
    // Regal Bearing draws |1 - theirDial|, so at a dial of 4 it is four cards.
    // Priced at roughly what four cards are worth in board skill.
    politicalPayoffBonus: 6,
    politicalPayoffMinimumOpponentBid: 3,

    recursionRingElements: ['air'],
    recursionRingCardIds: ['keeper-initiate'],
    recursionRingBonus: 20,
    skillRingElements: ['fire', 'water'],
    skillRingCardIds: ['ikoma-reservist'],
    skillRingBonus: 8
};

type Axis = 'military' | 'political';

const numberOr = (value: any, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

// Live skill where the engine filled a summary, printed skill otherwise. Cards
// in a discard pile and cards in hand only ever have the printed value.
const skillOf = (card: any, axis: Axis): number => {
    const summary = axis === 'military' ? card?.militarySkillSummary : card?.politicalSkillSummary;
    const live = Number(summary?.stat);
    return Math.max(0, Number.isFinite(live) ? live : numberOr(card?.[axis], 0));
};

const gloryOf = (card: any): number =>
    Math.max(0, numberOr(card?.glorySummary?.stat ?? card?.glory, 0));

const byUuid = (left: any, right: any): number =>
    String(left?.uuid || '').localeCompare(String(right?.uuid || ''));

export class LionDuelistTactics {
    constructor(public readonly profile: LionDuelistProfile = LION_DUELIST_DEFAULTS) {}

    // ---- identity ---------------------------------------------------------

    isTower(card: any): boolean {
        return !!card?.id && this.profile.towerCharacters.includes(card.id);
    }

    isCommander(card: any): boolean {
        return this.hasTrait(card, 'commander') ||
            (!!card?.id && this.profile.commanderCharacters.includes(card.id));
    }

    isChampion(card: any): boolean {
        return this.hasTrait(card, 'champion') ||
            (!!card?.id && this.profile.championCharacters.includes(card.id));
    }

    isBushi(card: any): boolean {
        return this.hasTrait(card, 'bushi') ||
            (!!card?.id && this.profile.bushiCharacters.includes(card.id));
    }

    desiredAdditionalFate(cardId?: string): number | null {
        if(!cardId || !Object.prototype.hasOwnProperty.call(this.profile.additionalFateByCharacterId, cardId)) {
            return null;
        }
        return Math.max(0, numberOr(this.profile.additionalFateByCharacterId[cardId], 0));
    }

    // ---- Kyuden Ikoma -----------------------------------------------------

    strongholdBowCandidates(opponentCharacters: any[], axis: Axis): any[] {
        return (opponentCharacters || [])
            .filter((card) => card && !this.isChampion(card))
            .filter((card) => !this.profile.strongholdBowRequiresReadyTarget || !card.bowed)
            // A participant bows on its own when it returns home; spending the
            // stronghold on one buys nothing.
            .filter((card) => !this.profile.strongholdBowSkipsParticipants || !card.inConflict)
            .filter((card) => this.bodyValue(card, axis) >= this.profile.strongholdBowMinimumSkill);
    }

    pickStrongholdBowTarget(opponentCharacters: any[], axis: Axis): any | null {
        const candidates = this.strongholdBowCandidates(opponentCharacters, axis);
        return candidates.slice().sort((left, right) =>
            this.bodyValue(right, axis) - this.bodyValue(left, axis) || byUuid(left, right))[0] || null;
    }

    shouldUseStronghold(opponentCharacters: any[], axis: Axis): boolean {
        return !!this.pickStrongholdBowTarget(opponentCharacters, axis);
    }

    // ---- Frostbitten Crossing --------------------------------------------

    // The province strips EVERY attachment off ONE participant, so the target is
    // chosen per character, not per attachment. Our own side scores the debuffs
    // we would shed; theirs scores the buffs we would take away. Positive-only:
    // stripping our own good weapons is never the play.
    stripValue(
        card: any,
        mine: boolean,
        ownDebuffScores: Record<string, number>,
        enemyAttachmentScores: Record<string, number>
    ): number {
        let total = 0;
        for(const attachment of card?.attachments || []) {
            if(mine) {
                total += Math.max(0, numberOr(ownDebuffScores[attachment?.id], 0));
                continue;
            }
            const liveStats = Math.max(
                0,
                numberOr(attachment?.militarySkillSummary?.stat, 0),
                numberOr(attachment?.politicalSkillSummary?.stat, 0)
            );
            total += numberOr(enemyAttachmentScores[attachment?.id], 6 + liveStats);
        }
        return total;
    }

    pickStripTarget(
        mine: any[],
        theirs: any[],
        ownDebuffScores: Record<string, number>,
        enemyAttachmentScores: Record<string, number>
    ): any | null {
        const scored = [
            ...(mine || []).map((card) => ({
                card,
                value: this.stripValue(card, true, ownDebuffScores, enemyAttachmentScores)
            })),
            ...(theirs || []).map((card) => ({
                card,
                value: this.stripValue(card, false, ownDebuffScores, enemyAttachmentScores)
            }))
        ].filter((entry) => entry.card?.inConflict && (entry.card.attachments || []).length > 0 &&
            entry.value >= this.profile.stripMinimumValue);
        return scored.sort((left, right) => right.value - left.value ||
            byUuid(left.card, right.card))[0]?.card || null;
    }

    // ---- Kitsu Motso ------------------------------------------------------

    // `winDeficit` is the extra skill we still need to WIN (0 or less = already
    // winning). Positive lead is `-winDeficit`.
    shouldDragOpponentIn(
        opponentCharacters: any[],
        axis: Axis,
        amAttacker: boolean,
        winDeficit: number,
        handSize: number,
        opponentHandSize: number
    ): boolean {
        if(!amAttacker && !this.profile.motsoAllowOnDefense) {
            return false;
        }
        // The printed condition. Without it the Action is not even offered.
        if(handSize >= opponentHandSize) {
            return false;
        }
        const target = this.pickDragTarget(opponentCharacters, axis);
        if(!target) {
            return false;
        }
        const skill = skillOf(target, axis);
        // Out of reach: their extra body changes nothing and still bows.
        if(winDeficit > this.profile.motsoHopelessWinDeficit) {
            return true;
        }
        // Or so far ahead that their body cannot take the conflict back.
        return -winDeficit >= skill + this.profile.motsoSafeLeadMargin;
    }

    pickDragTarget(opponentCharacters: any[], axis: Axis): any | null {
        return (opponentCharacters || [])
            .filter((card) => card && !card.bowed && !card.inConflict &&
                skillOf(card, axis) >= this.profile.motsoMinimumTargetSkill)
            .sort((left, right) => this.bodyValue(right, axis) - this.bodyValue(left, axis) ||
                byUuid(left, right))[0] || null;
    }

    // ---- recursion (Spiritcaller / Forebearer's Echoes) -------------------

    // Every recursion effect in this deck puts the chosen body into the conflict
    // READY, so its whole skill on the contested axis lands immediately. Glory
    // is a tiebreaker because an honored body carries it into the total.
    recursionScore(card: any, axis: Axis): number {
        return skillOf(card, axis) +
            gloryOf(card) * this.profile.recursionGloryWeight +
            numberOr(card?.fate, 0) * this.profile.recursionFateWeight;
    }

    pickRecursionTarget(bodies: any[], axis: Axis): any | null {
        return (bodies || [])
            .filter((card) => card?.type === 'character' || card?.type === undefined)
            .sort((left, right) => this.recursionScore(right, axis) - this.recursionScore(left, axis) ||
                byUuid(left, right))[0] || null;
    }

    // Skill this recursion would add, net of a bow-self cost when the source is
    // itself a ready participant (Kitsu Spiritcaller bows to pay).
    recursionGain(bodies: any[], axis: Axis, source?: any): number {
        const best = this.pickRecursionTarget(bodies, axis);
        if(!best) {
            return 0;
        }
        const paid = source?.inConflict && !source?.bowed ? skillOf(source, axis) : 0;
        return skillOf(best, axis) - paid;
    }

    shouldRecur(bodies: any[], axis: Axis, source?: any): boolean {
        return this.recursionGain(bodies, axis, source) >= this.profile.recursionMinimumSkill;
    }

    // ---- Matsu Agetoki ----------------------------------------------------

    provinceStrength(province: any, effectiveStrengthById: Record<string, number>): number {
        if(province?.facedown || province?.faceup === false) {
            return this.profile.facedownProvinceAssumedStrength;
        }
        const known = Number(effectiveStrengthById?.[String(province?.id || '')]);
        if(Number.isFinite(known)) {
            return known;
        }
        return numberOr(province?.strength ?? province?.provinceStrength, this.profile.facedownProvinceAssumedStrength);
    }

    // Only move when the new province is genuinely cheaper to break. `provinces`
    // are the opponent's eligible (unbroken, non-current) provinces.
    pickConflictMoveProvince(
        provinces: any[],
        currentStrength: number,
        effectiveStrengthById: Record<string, number>
    ): any | null {
        const ranked = (provinces || [])
            .filter((province) => province && !province.broken && !province.isBroken && !province.selected)
            .map((province) => ({
                province,
                strength: this.provinceStrength(province, effectiveStrengthById)
            }))
            .sort((left, right) => left.strength - right.strength ||
                String(left.province?.location || '').localeCompare(String(right.province?.location || '')));
        const best = ranked[0];
        if(!best || currentStrength - best.strength < this.profile.agetokiMinimumStrengthSaving) {
            return null;
        }
        return best.province;
    }

    // ---- Matsu Tsuko ------------------------------------------------------

    // True while a Tsuko-class body attacks a breakable non-stronghold province
    // and we hold the honor lead: the target number collapses from "province
    // strength" to "one more skill than the defenders".
    winIsBreak(
        myCharacters: any[],
        amAttacker: boolean,
        moreHonorable: boolean,
        strongholdProvinceAttacked: boolean
    ): boolean {
        if(!amAttacker || !moreHonorable || strongholdProvinceAttacked) {
            return false;
        }
        return (myCharacters || []).some((card) => card?.inConflict && !card.bowed &&
            this.profile.winIsBreakCharacterIds.includes(String(card?.id || '')));
    }

    // ---- Akodo Zentaro ----------------------------------------------------

    holdingValue(card: any): number {
        const known = Number(this.profile.holdingValueById[String(card?.id || '')]);
        return Number.isFinite(known) ? known : this.profile.holdingDefaultValue;
    }

    pickHoldingTarget(holdings: any[]): any | null {
        return (holdings || [])
            .filter((card) => this.holdingValue(card) >= this.profile.zentaroMinimumHoldingValue)
            .sort((left, right) => this.holdingValue(right) - this.holdingValue(left) ||
                byUuid(left, right))[0] || null;
    }

    // Zentaro DISCARDS every other card in the province it moves the stolen
    // holding into, so the destination must be the province we would miss least.
    pickHoldingDestination(provinces: any[], cardValueByLocation: Record<string, number>): any | null {
        return (provinces || [])
            .filter((province) => province && !province.broken && !province.isBroken &&
                province.location !== 'stronghold province')
            .sort((left, right) =>
                numberOr(cardValueByLocation[String(left?.location || '')], 0) -
                    numberOr(cardValueByLocation[String(right?.location || '')], 0) ||
                String(left?.location || '').localeCompare(String(right?.location || '')))[0] || null;
    }

    // ---- attachments ------------------------------------------------------

    attachmentRank(cardId: string | undefined): number {
        const index = this.profile.attachmentRanking.indexOf(String(cardId || ''));
        return index < 0 ? this.profile.attachmentRanking.length : index;
    }

    pickForgeAttachment(cards: any[]): any | null {
        const ranked = (cards || []).filter((card) => card?.id)
            .sort((left, right) => this.attachmentRank(left.id) - this.attachmentRank(right.id) ||
                byUuid(left, right));
        return ranked[0] || (cards || [])[0] || null;
    }

    keyRank(card: any): number {
        const index = this.profile.keyCharacters.indexOf(String(card?.id || ''));
        return index < 0 ? this.profile.keyCharacters.length : index;
    }

    // Attachment carriers: named key characters first, then whatever survives
    // longest (fate) and hits hardest.
    pickCarrier(mine: any[], axis: Axis, minimumGlory = 0): any | null {
        return (mine || [])
            .filter((card) => gloryOf(card) >= minimumGlory)
            .sort((left, right) => this.keyRank(left) - this.keyRank(right) ||
                this.bodyValue(right, axis) - this.bodyValue(left, axis) || byUuid(left, right))[0] || null;
    }

    // ---- duels ------------------------------------------------------------

    duelAxis(sourceCardId: string | undefined): Axis | null {
        const axis = this.profile.duelAxes[String(sourceCardId || '')];
        return axis === 'military' || axis === 'political' ? axis : null;
    }

    // ---- dynasty events ---------------------------------------------------

    // `board` is what we control in play; `card.new` marks a body bought this
    // phase, which is exactly Honored Veterans' printed condition.
    pickDynastyEvent(
        playable: any[],
        costs: Record<string, number>,
        fate: number,
        board: any[],
        ownProvinceCardCount: number
    ): { card: any; reason: string } | null {
        const affordable = (card: any) => numberOr(costs?.[card?.uuid], 0) <= fate;

        const veterans = (playable || []).find((card) =>
            card?.id === 'honored-veterans' && affordable(card));
        if(veterans && (board || []).some((card) => card?.new && this.isBushi(card) &&
            !card.isHonored && gloryOf(card) >= this.profile.honoredVeteransMinimumGlory)) {
            return { card: veterans, reason: 'lion-duelist-play-honored-veterans' };
        }

        const season = (playable || []).find((card) =>
            card?.id === 'a-season-of-war' && affordable(card));
        if(season && ownProvinceCardCount <= this.profile.seasonOfWarMaxUsefulProvinceCards &&
            fate >= this.profile.seasonOfWarMinimumFate) {
            return { card: season, reason: 'lion-duelist-play-season-of-war' };
        }
        return null;
    }

    // ---- axis payoff ------------------------------------------------------

    // Skill-equivalent bonus for declaring POLITICAL, or 0 when the engine is
    // not live. Every condition here mirrors a printed requirement of the card,
    // so this can never steer onto a conflict the payoff would not pay in.
    politicalAxisBonus(input: {
        hand: any[];
        board: any[];
        opponentBid: number;
        politicalRemaining: number;
    }): number {
        if(this.profile.politicalPayoffBonus <= 0 || input.politicalRemaining <= 0) {
            return 0;
        }
        if(numberOr(input.opponentBid, 0) < this.profile.politicalPayoffMinimumOpponentBid) {
            return 0;
        }
        const holdsPayoff = (input.hand || []).some((card) =>
            this.profile.politicalPayoffCardIds.includes(String(card?.id || '')));
        if(!holdsPayoff) {
            return 0;
        }
        const readyCourtier = (input.board || []).some((card) => card && !card.bowed &&
            (this.hasTrait(card, 'courtier') ||
                this.profile.politicalPayoffCourtierIds.includes(String(card?.id || ''))));
        return readyCourtier ? this.profile.politicalPayoffBonus : 0;
    }

    // ---- ring preference --------------------------------------------------

    // Added to the generic ring score. Both terms are conditional on the payoff
    // actually being live, so an empty discard pile and no Reservist leave the
    // ring choice exactly where the generic reading put it.
    ringBonus(element: string, dynastyDiscard: any[], myCards: any[], claimedElements: string[]): number {
        let bonus = 0;
        if(this.profile.recursionRingElements.includes(element) &&
            (dynastyDiscard || []).some((card) =>
                this.profile.recursionRingCardIds.includes(String(card?.id || '')))) {
            bonus += this.profile.recursionRingBonus;
        }
        if(this.profile.skillRingElements.includes(element) &&
            // Already holding one of the two is enough for the payoff; a second
            // claim adds nothing, so only bid for the first.
            !this.profile.skillRingElements.some((claimed) => (claimedElements || []).includes(claimed)) &&
            (myCards || []).some((card) =>
                this.profile.skillRingCardIds.includes(String(card?.id || '')))) {
            bonus += this.profile.skillRingBonus;
        }
        return bonus;
    }

    // ---- shared -----------------------------------------------------------

    // What a body is worth as a REMOVAL target: skill it would otherwise
    // contribute plus the investment sunk into keeping it around.
    bodyValue(card: any, axis: Axis): number {
        return skillOf(card, axis) + numberOr(card?.fate, 0) * 2 +
            (card?.attachments || []).length * 2 + (this.isTower(card) ? 2 : 0);
    }

    private hasTrait(card: any, trait: string): boolean {
        if(Array.isArray(card?.traits)) {
            return card.traits.some((value: any) => String(value).toLowerCase() === trait);
        }
        return typeof card?.traits === 'string' && new RegExp(`\\b${trait}\\b`, 'i').test(card.traits);
    }
}
