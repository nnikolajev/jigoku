import {
    MoveIntoConflictPolicy
} from './MoveIntoConflictPolicy.js';

/**
 * Unicorn: cavalry movement, Gaijin attachments and ready effects.
 *
 * The clan's edge is putting a body where it was not when the conflict was
 * declared, so most of this profile prices MOVEMENT — whether moving in is
 * worth the card, which bodies benefit from a move bonus, and when a
 * ready effect beats holding the trigger.
 *
 * A movement source is spent only on a body DECLARATION cannot reach.
 * `MoveIntoConflictPolicy` owns that half of the decision; everything here
 * prices what the arrival is worth once the gate has allowed it.
 *
 * `UNICORN_DEFAULTS` is also imported by V2's `DeckSynergies`, which is why
 * this module counts as shared surface even though it is V1 tactics.
 */
export interface UnicornProfile {
    movementCardIds: string[];
    gaijinCardIds: string[];
    singletonAttachments: string[];
    movementNeededThreshold: number;
    spyglassMoveBonus: number;
    twilightReadyBonus: number;
    outriderReadyBonus: number;
    stablesMoveBonus: number;
    outskirtsGloryWeight: number;
    supportedReadyCost: number;
    barchaBowBonus: number;
    minamiWinBonus: number;
    higashiWinBonus: number;
    /** Worth of +1/+1 on each participating Utaku Infantry the arrival feeds. */
    utakuInfantryBonus: number;
    /** Worth of turning Flank the Enemy's outnumbering condition on. */
    flankTheEnemyBonus: number;
    /** Worth, per participating Cavalry, of unlocking Shinjo Shono's Action. */
    shonoUnlockBonus: number;
}

export const UNICORN_DEFAULTS: UnicornProfile = {
    movementCardIds: ['golden-plains-outpost', 'ride-on', 'adorned-barcha'],
    gaijinCardIds: ['spyglass', 'curved-blade', 'ujik-tactics', 'adorned-barcha'],
    singletonAttachments: ['spyglass', 'adorned-barcha', 'utaku-battle-steed'],
    movementNeededThreshold: 1,
    spyglassMoveBonus: 3,
    twilightReadyBonus: 4,
    outriderReadyBonus: 4,
    stablesMoveBonus: 2,
    outskirtsGloryWeight: 2,
    supportedReadyCost: 1.5,
    barchaBowBonus: 4,
    minamiWinBonus: 3,
    higashiWinBonus: 2,
    utakuInfantryBonus: 1,
    flankTheEnemyBonus: 2,
    shonoUnlockBonus: 1
};

export interface UnicornMoveContext {
    conflictType: 'military' | 'political';
    characters: any[];
    opponentCharacters?: any[];
    cavalryUuids?: Record<string, true>;
    skillOf: (card: any) => number;
    strengthNeeded?: number | null;
    requireCavalry?: boolean;
    hasMotoStables?: boolean;
    hasOutskirtsSentry?: boolean;
    /** Exact live support: this bowed character can be readied after moving
     * (self action/reaction, I Am Ready, or Shiotome Encampment). */
    readyAfterMoveUuids?: Record<string, true>;
    /** Barcha bearer -> its attachment action has not been spent this round. */
    barchaReadyBearerUuids?: Record<string, true>;
    /** Skill still needed to win, not merely to prevent/break a province. */
    winSkillNeeded?: number | null;
    selfParticipantCount?: number;
    opponentParticipantCount?: number;
    /**
     * Bodies that were READY and legal to DECLARE into this conflict. Moving
     * one of them spends a card for what the declaration step would have done
     * for free, so `MoveIntoConflictPolicy` refuses them unless the move
     * itself carries something declaration cannot.
     */
    declarableUuids?: Record<string, true>;
    /** The move source about to be spent, when the call site knows it. */
    moveSourceCardId?: string;
    /** A friendly bowed body a move reaction could stand up (Twilight Rider). */
    hasBowedReadyTarget?: boolean;
    /** Unicorn-faction uuids, for Utaku Infantry's participant count. */
    unicornFactionUuids?: Record<string, true>;
    /** Flank the Enemy is in hand and playable right now. */
    hasFlankTheEnemy?: boolean;
}

/** Deck-local movement planner. It contains no prompt plumbing, so profiles can
 * tune scores without copying controller logic. */
export class UnicornTactics {
    constructor(
        public readonly profile: UnicornProfile = UNICORN_DEFAULTS,
        public readonly moveGate: MoveIntoConflictPolicy = new MoveIntoConflictPolicy()
    ) {}

    // Participant count, preferring the exact value the controller supplies
    // and falling back to counting the serialized board.
    effectiveParticipantCount(exact: number | undefined, characters: any[]): number {
        return Number.isFinite(exact) ? Math.max(Number(exact), 0) :
            characters.filter((card) => card.inConflict).length;
    }

    // Is any movement effect actually available right now? Everything else
    // here is worthless without one.
    hasMoveSource(strongholdCards: any[], hand: any[], characters: any[],
        barchaReadyBearerUuids?: Record<string, true>): boolean {
        const enabled = new Set(this.profile.movementCardIds);
        return enabled.has('golden-plains-outpost') &&
                strongholdCards.some((card) => card.id === 'golden-plains-outpost' && !card.bowed) ||
            enabled.has('ride-on') && hand.some((card) => card.id === 'ride-on' && card.isPlayableByMe) ||
            enabled.has('adorned-barcha') &&
            characters.some((card) => !!barchaReadyBearerUuids?.[card.uuid] &&
                (card.attachments || []).some((attachment: any) => attachment.id === 'adorned-barcha'));
    }

    // Cavalry by the controller-supplied uuid set or by trait.
    isCavalry(card: any, cavalryUuids?: Record<string, true>): boolean {
        return !!card?.uuid && (!!cavalryUuids?.[card.uuid] || (card.traits || []).includes('cavalry'));
    }

    private attachmentIds(card: any): string[] {
        return (card?.attachments || []).map((attachment: any) => String(attachment.id || ''));
    }

    private glory(card: any): number {
        return Math.max(Number(card?.glorySummary?.stat ?? card?.glory) || 0, 0);
    }

    /**
     * Moving a body in and READYING it afterwards is one plan, so the ready
     * source has to be live for THIS conflict. Moto Outrider's Action reads
     * "During a military conflict in which this character is participating",
     * so on a political conflict he arrives bowed and stays bowed — the case
     * that used to be scored as a full-skill arrival.
     */
    private hasReadyFollowUp(card: any, ctx: UnicornMoveContext): boolean {
        if(!card?.uuid) {
            return false;
        }
        if(ctx.readyAfterMoveUuids?.[card.uuid]) {
            return true;
        }
        if(card.id === 'moto-outrider') {
            return ctx.conflictType === 'military';
        }
        // Twilight Rider's reaction fires on its own move and may target
        // itself, so it stands up in either conflict type.
        return card.id === 'twilight-rider';
    }

    /** Participants on our side once this body arrives, against theirs. */
    private outnumbersAfterArrival(ctx: UnicornMoveContext): boolean {
        const self = this.effectiveParticipantCount(ctx.selfParticipantCount, ctx.characters);
        const opponent = this.effectiveParticipantCount(ctx.opponentParticipantCount,
            ctx.opponentCharacters || []);
        return self + 1 > opponent;
    }

    /** We do NOT already hold the participant majority, so the arrival is what
     *  unlocks anything gated on holding it. */
    private arrivalUnlocksMajority(ctx: UnicornMoveContext): boolean {
        const self = this.effectiveParticipantCount(ctx.selfParticipantCount, ctx.characters);
        const opponent = this.effectiveParticipantCount(ctx.opponentParticipantCount,
            ctx.opponentCharacters || []);
        return self <= opponent && self + 1 > opponent;
    }

    private participating(ctx: UnicornMoveContext, cardId: string): boolean {
        return ctx.characters.some((card) => card.id === cardId && card.inConflict);
    }

    /**
     * What a BOWED body is worth purely for ARRIVING, on top of the zero skill
     * it contributes. Every entry reads `isParticipating()`, which is
     * bow-agnostic, so all of them pay for a body that cannot be declared:
     *
     *   Minami Kaze Regulars  after-win reaction, needs the participant majority
     *   Higashi Kaze Company  after-win reaction, needs a 0-fate participant
     *   Shinjo Shono          +1/+1 to participating Cavalry while outnumbering
     *   Utaku Infantry        +1/+1 per participating Unicorn character
     *   Outskirts Sentry      honors a participant whenever anything moves in
     *   Flank the Enemy       its Action needs the participant majority
     *
     * A READY body collects all of these by being DECLARED, which costs no
     * card, so none of them is a reason to spend a move source on one — that
     * is `MoveIntoConflictPolicy`'s half of the decision, not this one's.
     */
    arrivalPayoff(card: any, ctx: UnicornMoveContext): number {
        if(!card?.bowed) {
            return 0;
        }
        let payoff = 0;
        const winning = !(Number(ctx.winSkillNeeded) > 0);
        if(winning && card.id === 'minami-kaze-regulars' && this.outnumbersAfterArrival(ctx)) {
            payoff += this.profile.minamiWinBonus;
        }
        if(winning && card.id === 'higashi-kaze-company' &&
            ctx.characters.some((other) => other !== card && other.inConflict &&
                !other.bowed && (Number(other.fate) || 0) === 0)) {
            payoff += this.profile.higashiWinBonus;
        }
        // Shinjo Shono's Action is legal only while we hold the participant
        // majority. If the arrival is what creates it, every participating
        // Cavalry gets +1/+1.
        if(this.participating(ctx, 'shinjo-shono') && this.arrivalUnlocksMajority(ctx)) {
            payoff += this.profile.shonoUnlockBonus * ctx.characters.filter((other) =>
                (other.inConflict || other === card) &&
                this.isCavalry(other, ctx.cavalryUuids)).length;
        }
        // Utaku Infantry counts participating UNICORN characters, itself
        // included, so one more body is +1/+1 on each copy in the conflict.
        const isUnicorn = !ctx.unicornFactionUuids || !!ctx.unicornFactionUuids[card.uuid];
        if(isUnicorn) {
            payoff += this.profile.utakuInfantryBonus * ctx.characters.filter((other) =>
                other.id === 'utaku-infantry' && other.inConflict).length;
        }
        // Outskirts Sentry honors a participant whenever anything moves in,
        // whatever moved and whatever its state.
        if(ctx.hasOutskirtsSentry || this.participating(ctx, 'outskirts-sentry')) {
            payoff += this.profile.outskirtsGloryWeight;
        }
        if(ctx.hasFlankTheEnemy && this.arrivalUnlocksMajority(ctx)) {
            payoff += this.profile.flankTheEnemyBonus;
        }
        return payoff;
    }

    /** Kept for the two after-win reactions specifically; `arrivalPayoff` is
     *  the full list. */
    private hasWinningPayoff(card: any, ctx: UnicornMoveContext): boolean {
        return this.arrivalPayoff(card, ctx) > 0;
    }

    // A bowed body contributes 0 skill, so moving it in is pointless unless
    // something will ready it.
    canContributeAfterMove(card: any, ctx: UnicornMoveContext): boolean {
        return !card?.bowed || this.hasReadyFollowUp(card, ctx);
    }

    // Skill this character would add if moved in, after that bowed check.
    projectedMoveSkill(card: any, ctx: UnicornMoveContext): number {
        if(!card || !this.canContributeAfterMove(card, ctx)) {
            return 0;
        }
        return Math.max(ctx.skillOf(card), 0) + (ctx.hasMotoStables ? this.profile.stablesMoveBonus : 0);
    }

    // Full swing including any Barcha bow on the opposing side — moving in
    // can subtract from them as well as add to us.
    projectedMoveSwing(card: any, ctx: UnicornMoveContext): number {
        const moveSkill = this.projectedMoveSkill(card, ctx);
        if(!card || !ctx.barchaReadyBearerUuids?.[card.uuid]) {
            return moveSkill;
        }
        const bowedEnemySkill = (ctx.opponentCharacters || [])
            .filter((enemy) => enemy.inConflict && !enemy.bowed)
            .reduce((maximum, enemy) => Math.max(maximum, Math.max(ctx.skillOf(enemy), 0)), 0);
        return moveSkill + bowedEnemySkill;
    }

    private moveScore(card: any, ctx: UnicornMoveContext): number {
        const attachments = this.attachmentIds(card);
        let score = (this.canContributeAfterMove(card, ctx) ? Math.max(ctx.skillOf(card), 0) : 0) +
            (Number(card.fate) || 0) * 0.2;
        if(attachments.includes('spyglass')) {
            score += this.profile.spyglassMoveBonus;
        }
        if(card.id === 'twilight-rider') {
            score += this.profile.twilightReadyBonus;
        }
        if(card.id === 'moto-outrider' && this.hasReadyFollowUp(card, ctx)) {
            score += this.profile.outriderReadyBonus;
        }
        if(ctx.hasMotoStables) {
            score += this.profile.stablesMoveBonus;
        }
        if(ctx.hasOutskirtsSentry) {
            score += this.glory(card) * this.profile.outskirtsGloryWeight;
        }
        if(attachments.includes('adorned-barcha') && ctx.barchaReadyBearerUuids?.[card.uuid]) {
            score += this.profile.barchaBowBonus;
        }
        if(card.bowed && this.hasReadyFollowUp(card, ctx) &&
            !['moto-outrider', 'twilight-rider'].includes(card.id)) {
            score -= this.profile.supportedReadyCost;
        }
        return score + this.arrivalPayoff(card, ctx);
    }

    /**
     * Does spending a movement source on this body beat DECLARING it?
     *
     * A ready body that the declaration step could legally have taken is not a
     * move target: declaring costs no card and puts it in exactly the same
     * place. The exceptions are the two effects declaration cannot reproduce —
     * Adorned Barcha's enemy bow, and Twilight Rider's on-move ready with a
     * live bowed body to stand up.
     */
    moveBeatsDeclaring(card: any, ctx: UnicornMoveContext): boolean {
        return this.moveGate.allows({
            uuid: String(card?.uuid || ''),
            cardId: String(card?.id || ''),
            bowed: !!card?.bowed,
            declarable: !!card?.uuid && !!ctx.declarableUuids?.[card.uuid],
            sourceCardId: ctx.moveSourceCardId ||
                (ctx.barchaReadyBearerUuids?.[card?.uuid] ? 'adorned-barcha' : undefined),
            traits: card?.traits || [],
            honored: !!card?.isHonored,
            moveReactionPays: !!ctx.hasBowedReadyTarget,
            moveBonusSkill: ctx.hasMotoStables ? this.profile.stablesMoveBonus : 0,
            skillStillNeeded: Math.max(Number(ctx.strengthNeeded) || 0,
                Number(ctx.winSkillNeeded) || 0)
        });
    }

    // Does moving this body in bring anything at all? Skill on the contested
    // axis, or one of the payoffs that pays for the ARRIVAL rather than for the
    // skill. Without either, the move spends the source for nothing — measured
    // live at `Ride On moved Battle Maiden Recruit in (0 skill)`.
    private arrivalBringsSomething(card: any, ctx: UnicornMoveContext): boolean {
        // `projectedMoveSkill` is 0 for a bowed body with no ready follow-up,
        // which is the case this filter exists for: a body that arrives bowed
        // and stays bowed contributes nothing and spends the source for free
        // (`Ride On moved Battle Maiden Recruit in (0 skill)`, measured live).
        //
        // A SUPPORTED bowed carrier — one `readyAfterMoveUuids` says can be
        // stood up after the move — still qualifies. That is the deck's
        // deliberate move -> ready sequence; see the follow-through note in
        // `test/helpers/readymoveallowances.js`.
        return this.projectedMoveSkill(card, ctx) > 0 ||
            this.hasWinningPayoff(card, ctx) ||
            !!ctx.barchaReadyBearerUuids?.[card.uuid];
    }

    // Best legal body to move into the conflict.
    pickMoveTarget(ctx: UnicornMoveContext): any | null {
        const legal = ctx.characters.filter((card) => !card.inConflict &&
            (!ctx.requireCavalry || this.isCavalry(card, ctx.cavalryUuids)) &&
            // Preserve an unused Barcha for its own stronger bow+move action.
            (!ctx.requireCavalry || !ctx.barchaReadyBearerUuids?.[card.uuid]) &&
            (!card.bowed || this.hasReadyFollowUp(card, ctx) || this.hasWinningPayoff(card, ctx)) &&
            this.moveBeatsDeclaring(card, ctx) &&
            this.arrivalBringsSomething(card, ctx));
        return legal.sort((a, b) => this.moveScore(b, ctx) - this.moveScore(a, ctx) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    // Is the resulting swing worth the movement card?
    shouldUseMove(ctx: UnicornMoveContext): boolean {
        const target = this.pickMoveTarget(ctx);
        if(!target) {
            return false;
        }
        const needed = Number(ctx.strengthNeeded);
        return !Number.isFinite(needed) || needed >= this.profile.movementNeededThreshold ||
            target.bowed || this.attachmentIds(target).includes('spyglass') ||
            target.id === 'twilight-rider';
    }

    // Order attackers for declaration and name the one being held back to move
    // in later — the deck's edge is arriving after the defenders commit.
    //
    // With the move gate on, a READY body is never a legal mover (declaring it
    // is free), so `mover` is null unless the reserved body is one the gate
    // still allows: an unused Barcha bearer, or a bowed body with a follow-up.
    orderDeclarationCandidates(cards: any[], ctx: UnicornMoveContext): { ordered: any[]; mover: any | null } {
        const barchaBearer = ctx.characters.filter((card) =>
            !!ctx.barchaReadyBearerUuids?.[card.uuid] && this.moveBeatsDeclaring(card, ctx))
            .sort((a, b) => this.moveScore(b, ctx) - this.moveScore(a, ctx))[0] || null;
        const cavalryMover = this.pickMoveTarget({ ...ctx, requireCavalry: true });
        const mover = ctx.conflictType === 'military'
            ? [barchaBearer, cavalryMover].filter(Boolean)
                .sort((a, b) => this.moveScore(b, ctx) - this.moveScore(a, ctx))[0] || null
            : null;
        const ordered = cards.slice().sort((a, b) => {
            // Sentry must already participate when the planned move occurs.
            const sentry = Number(b.id === 'outskirts-sentry') - Number(a.id === 'outskirts-sentry');
            if(sentry !== 0) {
                return sentry;
            }
            if(a === mover) {
                return 1;
            }
            if(b === mover) {
                return -1;
            }
            return ctx.skillOf(b) - ctx.skillOf(a);
        });
        return { ordered, mover };
    }

    // Honor a participating character, highest glory first.
    pickOutskirtsHonorTarget(characters: any[], skillOf: (card: any) => number): any | null {
        return characters.filter((card) => card.inConflict && !card.honored)
            .sort((a, b) => this.glory(b) - this.glory(a) ||
                skillOf(b) - skillOf(a))[0] || null;
    }

    // Ready the most valuable bowed body. A bowed PARTICIPANT first: it is
    // contributing 0 skill to the conflict being fought right now, while a body
    // at home is only tempo for a conflict that may never come. Twilight Rider
    // fires this reaction as it arrives, so it is usually readying ITSELF.
    pickTwilightReadyTarget(characters: any[], skillOf: (card: any) => number): any | null {
        const bowed = characters.filter((card) => card.bowed);
        const participants = bowed.filter((card) => card.inConflict);
        return (participants.length > 0 ? participants : bowed)
            .sort((a, b) => skillOf(b) - skillOf(a))[0] || null;
    }

    // Bearer for an attachment, aware of cavalry, the strength still needed to
    // break, and who will be ready after moving.
    pickAttachmentTarget(cardId: string, characters: any[], skillOf: (card: any) => number,
        cavalryUuids?: Record<string, true>, strengthNeeded?: number | null,
        readyAfterMoveUuids?: Record<string, true>): any | null {
        const copyCount = (card: any) => this.attachmentIds(card).filter((id) => id === cardId).length;
        let legal = characters.filter((card) => copyCount(card) === 0);
        if(cardId === 'utaku-battle-steed') {
            const nonCavalry = legal.filter((card) => !this.isCavalry(card, cavalryUuids));
            if(nonCavalry.length > 0) {
                legal = nonCavalry;
            } else if(Number(strengthNeeded) === 1) {
                legal = characters;
            }
        }
        if(cardId === 'spyglass' || cardId === 'adorned-barcha') {
            const home = legal.filter((card) => !card.inConflict &&
                (!card.bowed || cardId === 'adorned-barcha' || !!readyAfterMoveUuids?.[card.uuid]));
            if(home.length > 0) {
                legal = home;
            }
        }
        return legal.sort((a, b) => skillOf(b) - skillOf(a) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0))[0] || null;
    }

    // Skill a card contributes to a challenge, which scales with the number of
    // other participants.
    challengeSkill(card: any, participantCount: number, skillOf: (card: any) => number): number {
        return Math.max(skillOf(card), 0) + Math.max(participantCount - 1, 0);
    }
}
