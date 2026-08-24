import { BotTelemetry } from './BotTelemetry.js';

/**
 * Is spending a MOVE source on this body worth the card?
 *
 * The question this class exists for is not "does the body help in the
 * conflict" — `UnicornTactics` and `ReadyMovePlanner` already answer that — it
 * is the one the owner put after a live game:
 *
 *   Ride On moved a READY Border Rider into a conflict the bot had just
 *   declined to defend. Border Rider could have been DECLARED as a defender
 *   for free at the declaration step. The card bought a body placement that
 *   costs nothing, and the body bowed on return home either way.
 *
 * Every model in the bot prices the ARRIVAL (`conflictStrengthNeeded`,
 * `winSkillNeeded`, the participation payoffs). None of them prices the
 * ALTERNATIVE, because the serialized board a policy reads says only where a
 * body is now, never where it could have been put for free a moment ago.
 *
 * ## The rule
 *
 * A movement effect exists to put a body where declaration CANNOT:
 *
 *   * the body is BOWED — a bowed character cannot be declared, and
 *     `isParticipating()` is bow-agnostic, so it still pays every
 *     participation reaction (Minami/Higashi's after-win, Shinjo Shono's
 *     majority, Utaku Infantry's count, Outskirts Sentry's on-move honor,
 *     Flank the Enemy's outnumbering condition);
 *   * the body was BLOCKED from declaring — covert, Shinjo Yasamura, Butcher
 *     of the Fallen. The engine's own legality answers this: a blocked body is
 *     not in `legalDirectCardUuids` at the declaration prompt;
 *   * the body was not THERE yet — it entered play or was readied after
 *     declaration closed.
 *
 * Anything else is a body the bot could have declared and chose not to, and
 * moving it is the card spent for nothing.
 *
 * ## The exceptions, and why they are only these
 *
 * Two effects pay for a move that declaration cannot reproduce at all:
 *
 *   * `adorned-barcha` — the Action bows an ENEMY participant and brings its
 *     bearer along. The bow is the card; the move is the rider.
 *   * `twilight-rider` — its reaction fires on MOVING to a conflict, not on
 *     committing, so declaring it forfeits the ready outright. It needs a live
 *     bowed body to stand up, or the reaction pays nothing.
 *
 * `spyglass` is deliberately NOT one: it draws "after attached character
 * commits to a conflict OR moves to a conflict", so declaring the bearer
 * collects the same card for free. Neither is `outskirts-sentry`: its honor
 * pays for the arrival of a body that could not be declared, which the bowed
 * branch above already allows, and buying an honor token with a card on a body
 * that was declarable is the same waste in a smaller wrapper.
 *
 * `moto-stables` (+2 military to anything that MOVES in, twice per round) is a
 * genuine move-only bonus, which is why it has its own knob — but it is OFF,
 * because +2 military is not obviously worth a conflict card and the owner's
 * rule is to declare whenever declaring is legal. Flip
 * `allowMoveBonusOnDeclarableBody` to measure it.
 *
 * ## What "spent" means
 *
 * The waste is the RESOURCE, so a source that costs nothing to use wastes
 * nothing. `freeSourceIds` names those:
 *
 *   * `formal-invitation`, `matsu-mitsuko` — board abilities with no cost, no
 *     sacrifice and no per-round limit.
 *   * `golden-plains-outpost` — its cost is bowing the STRONGHOLD, and a
 *     stronghold contributes no skill and has no other ability, so the only
 *     thing the bow gives up is this same move for the rest of the round.
 *     Owner's call (2026-08-24): treat it as free. The residual cost is real
 *     but small — an early use on a ready body forfeits a later one on a bowed
 *     body — and it is bounded by `oncePerRound` in `MOVE_SOURCES`, not by
 *     this gate.
 *
 * Moving a declarable body with one of these gives up nothing and still
 * arrives after the opponent has acted. Every other source pays something real
 * — a card out of hand (Ride On, Even the Odds), a sacrifice (Favorable Ground,
 * Hiruma Signaller), or honor (Moto Eviscerator).
 */
export interface MoveIntoConflictConfig {
    /** `false` restores the pre-2026-08-24 behaviour exactly: every legal move
     *  target is allowed and only the arrival is priced. */
    enabled: boolean;
    /** Move sources whose OWN effect pays, whoever is carried along. */
    riderSourceIds: string[];
    /** Move sources that cost nothing at all to use, so nothing is wasted. */
    freeSourceIds: string[];
    /** Move sources that also HONOR the body when it is a Commander. */
    commanderHonorSourceIds: string[];
    /** Bodies whose on-MOVE reaction is forfeited by declaring instead. */
    moveReactionCardIds: string[];
    /** Allow a declarable body to be moved for a move-triggered skill bonus
     *  (Moto Stables) when the conflict still needs that skill. */
    allowMoveBonusOnDeclarableBody: boolean;
}

export const DEFAULT_MOVE_INTO_CONFLICT: MoveIntoConflictConfig = {
    enabled: true,
    riderSourceIds: ['adorned-barcha'],
    freeSourceIds: ['formal-invitation', 'matsu-mitsuko', 'golden-plains-outpost'],
    commanderHonorSourceIds: ['even-the-odds'],
    moveReactionCardIds: ['twilight-rider'],
    allowMoveBonusOnDeclarableBody: false
};

export interface MoveIntoConflictInput {
    /** Body being considered for the move. */
    uuid: string;
    cardId: string;
    bowed: boolean;
    /**
     * The body was READY and legal to declare into THIS conflict at its
     * declaration step. Recorded from the engine's own prompt legality, so
     * covert and "cannot be declared" effects make it false without this
     * module knowing any card text.
     */
    declarable: boolean;
    /** The move source about to be spent, when the call site knows it. */
    sourceCardId?: string;
    /** Printed traits, for the Commander riders. */
    traits?: readonly string[];
    /** Already honored, so a Commander honor rider pays nothing. */
    honored?: boolean;
    /** This body's own on-move reaction has a live target right now. */
    moveReactionPays?: boolean;
    /** Skill the MOVE itself adds on top of the body (Moto Stables). */
    moveBonusSkill?: number;
    /** Skill the conflict still needs, so a bonus is not bought for nothing. */
    skillStillNeeded?: number;
}

export type MoveIntoConflictReason =
    'off' | 'bowed' | 'undeclarable' | 'source-rider' | 'free-source' |
    'commander-honor' | 'move-reaction' | 'move-bonus' | 'declarable-waste';

export interface MoveIntoConflictVerdict {
    allowed: boolean;
    reason: MoveIntoConflictReason;
}

export class MoveIntoConflictPolicy {
    public readonly config: MoveIntoConflictConfig;

    public constructor(config?: Partial<MoveIntoConflictConfig>) {
        this.config = Object.assign({}, DEFAULT_MOVE_INTO_CONFLICT, config || {});
    }

    /** True when this configuration can never refuse anything. */
    public get inert(): boolean {
        return !this.config.enabled;
    }

    public judge(input: MoveIntoConflictInput): MoveIntoConflictVerdict {
        if(!this.config.enabled) {
            return { allowed: true, reason: 'off' };
        }
        if(input.bowed) {
            return { allowed: true, reason: 'bowed' };
        }
        if(!input.declarable) {
            return { allowed: true, reason: 'undeclarable' };
        }
        const sourceCardId = String(input.sourceCardId || '');
        if(sourceCardId && this.config.riderSourceIds.includes(sourceCardId)) {
            return { allowed: true, reason: 'source-rider' };
        }
        if(sourceCardId && this.config.freeSourceIds.includes(sourceCardId)) {
            return { allowed: true, reason: 'free-source' };
        }
        if(sourceCardId && this.config.commanderHonorSourceIds.includes(sourceCardId) &&
            !input.honored && (input.traits || []).includes('commander')) {
            return { allowed: true, reason: 'commander-honor' };
        }
        if(input.moveReactionPays &&
            this.config.moveReactionCardIds.includes(String(input.cardId))) {
            return { allowed: true, reason: 'move-reaction' };
        }
        if(this.config.allowMoveBonusOnDeclarableBody &&
            (Number(input.moveBonusSkill) || 0) > 0 &&
            (Number(input.skillStillNeeded) || 0) > 0) {
            return { allowed: true, reason: 'move-bonus' };
        }
        return { allowed: false, reason: 'declarable-waste' };
    }

    public allows(input: MoveIntoConflictInput): boolean {
        return this.judge(input).allowed;
    }
}

/**
 * Record one move-target verdict. Kept out of `judge` so the policy stays a
 * pure function and a harness can attach the probe without the engine knowing.
 */
export function recordMoveIntoConflict(
    input: MoveIntoConflictInput,
    verdict: MoveIntoConflictVerdict,
    context: { seat?: string; round?: number; axis?: string; site?: string }
): void {
    if(!BotTelemetry.enabled) {
        return;
    }
    BotTelemetry.record('move-into-conflict', () => ({
        seat: context.seat,
        round: context.round,
        axis: context.axis,
        site: context.site,
        cardId: input.cardId,
        sourceCardId: input.sourceCardId,
        bowed: input.bowed,
        declarable: input.declarable,
        moveReactionPays: !!input.moveReactionPays,
        allowed: verdict.allowed,
        reason: verdict.reason,
        // The gate only DIVERGES from the old behaviour where it refuses: an
        // allowed verdict is what every previous build did anyway.
        divergent: !verdict.allowed
    }));
}
