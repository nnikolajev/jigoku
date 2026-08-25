// IS READYING THIS BODY WORTH THE CARD?
//
// Readying a character is only ever worth a card when a conflict can still use
// the ready. Three things can use it:
//
//   1. the character is a bowed PARTICIPANT of the conflict running right now —
//      a bowed body contributes 0 skill (`conflict.ts`), so readying it hands
//      its whole skill back to the total being compared;
//   2. the character is at HOME and a conflict opportunity remains for either
//      player — ours to attack with it, or theirs for it to defend against;
//   3. the character is at home, a conflict is running, and we hold a way to
//      MOVE it into that conflict (ready -> move).
//
// With none of the three the ready is cosmetic and the card is spent for
// nothing. Seen live (2026-08-23, Phoenix vs Dragon, round 2 conflict 4):
// `Against the Waves` readied Kudaka at home with zero conflict opportunities
// left on either side, purely because a bowed Shugenja existed.
//
// THE ONE EXCEPTION is the Imperial Favor. `DrawCard.getContributionToImperialFavor`
// counts glory only from a character that is NOT bowed, so readying a glory
// body before the end of the conflict phase is real value for a deck that
// races the favor (Scorpion wants it for Censure). That is off by default and
// turned on per deck with `countFavorGlory`.
//
// The policy is generic: it takes a board reading, not a card id. Every ready
// effect in the playbook asks it the same question.

export interface ReadyValueConfig {
    // False reproduces the pre-2026-08-23 behaviour exactly: every ready is
    // considered useful, whatever the board looks like.
    enabled: boolean;
    // Count the Imperial Favor glory a ready returns as a use for the ready.
    // Only for decks that actually race the favor.
    countFavorGlory: boolean;
    // Minimum glory on the readied body before `countFavorGlory` applies. A
    // 0-glory character contributes nothing to the count no matter what.
    minFavorGlory: number;
    // Treat "we can move it in" as a use, i.e. allow the ready -> move sequence
    // to justify readying a body at home during a conflict.
    //
    // This is NOT "we hold a mover somewhere". That reading shipped OFF because
    // it had no follow-through: the Unicorn deck readied a body at home purely
    // because Golden Plains Outpost COULD have moved one in, then never used
    // it. `ReadyMovePlanner` is the follow-through — it commits to one body and
    // one move source, budgets the fate for BOTH legs, and only commits when
    // the arrival changes the conflict. `JigokuBotPolicy` therefore passes
    // `canMoveIntoConflict: false` at board level and routes the plan to the
    // exact body through `readyMoveTargetUuid`.
    allowMoveIntoConflict: boolean;
}

export const DEFAULT_READY_VALUE: ReadyValueConfig = {
    enabled: true,
    countFavorGlory: false,
    minFavorGlory: 1,
    allowMoveIntoConflict: true
};

/**
 * The move-into-conflict sources live in `ReadyMovePlanner`, which owns the
 * whole ready -> move sequence. Re-exported here because this policy's
 * `canMoveIntoConflict` input is derived from the same list, and two lists
 * would drift.
 *
 * The earlier local copy carried `talisman-of-the-sun` (moves the contested
 * RING, not a character) and `into-the-forbidden-city` (discards an
 * attachment). Both were wrong; the spec only checked the ids existed as
 * cards, not that they moved anybody.
 */
export { MOVE_INTO_CONFLICT_SOURCE_IDS } from './ReadyMovePlanner.js';

/**
 * Glory as the bot actually receives it. An in-play character publishes its
 * live glory as `glorySummary.stat`; the bare `glory` field is only populated
 * for cards outside play, so reading it alone prices every board character at
 * zero. Same rule as `CardPlaybook.gloryOf`.
 */
export function gloryOf(card: any): number {
    return Math.max(0, Number(card?.glorySummary?.stat ?? card?.glory) || 0);
}

export interface ReadyValueInput {
    // The ready target is a participant of the conflict currently running.
    inConflict: boolean;
    // A conflict is running right now.
    conflictActive: boolean;
    // Conflict opportunities left AFTER the current one, both sides. Public.
    conflictsRemaining: number;
    opponentConflictsRemaining: number;
    // We control or hold an effect that can move a character at home into the
    // conflict currently running.
    canMoveIntoConflict: boolean;
    // Glory this body would return to our Imperial Favor count by un-bowing.
    gloryOnReady: number;
    // The favor is still up for grabs this phase (nobody has claimed it, or it
    // is claimed by the opponent and the count is contestable).
    favorContested: boolean;
}

export interface ReadyValueVerdict {
    useful: boolean;
    reason: string;
}

const NOT_USEFUL: ReadyValueVerdict = Object.freeze({ useful: false, reason: 'ready-no-conflict-left' });

export class ReadyValuePolicy {
    readonly config: ReadyValueConfig;

    constructor(config: Partial<ReadyValueConfig> = {}) {
        this.config = { ...DEFAULT_READY_VALUE, ...config };
    }

    /** True when this configuration can never withhold a ready, so the call
     * site can stay entirely out of the way and run the untouched path. */
    get inert(): boolean {
        return !this.config.enabled;
    }

    evaluate(input: Partial<ReadyValueInput>): ReadyValueVerdict {
        if(!this.config.enabled) {
            return { useful: true, reason: 'ready-gate-disabled' };
        }
        if(input.inConflict) {
            return { useful: true, reason: 'ready-bowed-participant' };
        }
        if(this.config.allowMoveIntoConflict && input.conflictActive && input.canMoveIntoConflict) {
            return { useful: true, reason: 'ready-then-move-into-conflict' };
        }
        if((Number(input.conflictsRemaining) || 0) > 0) {
            return { useful: true, reason: 'ready-for-own-conflict' };
        }
        if((Number(input.opponentConflictsRemaining) || 0) > 0) {
            return { useful: true, reason: 'ready-to-defend-their-conflict' };
        }
        if(this.config.countFavorGlory && input.favorContested &&
            (Number(input.gloryOnReady) || 0) >= this.config.minFavorGlory) {
            return { useful: true, reason: 'ready-for-imperial-favor-glory' };
        }
        return NOT_USEFUL;
    }

}
