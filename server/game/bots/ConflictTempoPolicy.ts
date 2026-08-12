import { BotTelemetry } from './BotTelemetry.js';

/**
 * The declaration-time board read, as an injectable policy object.
 *
 * ## What this exists to model
 *
 * Taken from the project owner's own account of how he decides a conflict
 * phase (`docs/bot-conflict-rules-from-replays.md`, rules 13-15). He reads six
 * things before declaring: his ready bodies, their ready bodies, conflicts
 * remaining on both sides, who holds the first-player token, and the
 * INDIVIDUAL value of the best body on each side — not just the totals.
 *
 * Out of that read come three decisions V1 currently makes from constants:
 *
 * 1. **Trade or control.** "If my characters are weak I want to exchange
 *    provinces" — a weaker board races, because a defensive war it cannot win
 *    only bows the bodies it needs to attack with. "If my characters are
 *    strong I want to defend with one, then attack the water ring to ready it
 *    again." V1 picks between those two postures with `defenseCommitment`,
 *    a per-deck CONSTANT that never looks at the board in front of it.
 *
 * 2. **The ready loop.** Defend with one body, attack with a second on the
 *    water ring, ready the first, attack or defend with it again. V1's water
 *    score notices a bowed body (`ringElementBase`) but prices it at 25
 *    against earth's 40, and only when we still have two conflicts of our own
 *    — never when the readied body would be a DEFENDER against a conflict the
 *    opponent still has coming.
 *
 * 3. **First player next round.** `RegroupPhase.passFirstPlayer` alternates
 *    the token unconditionally, so "am I first player now" IS "will I open the
 *    next conflict phase". Second player buys bodies that persist (1 fate) so
 *    they are there to open with; with a stronghold already exposed the game
 *    is unlikely to reach that round, so persistence buys nothing.
 *
 * ## Reproducing V1
 *
 * `enabled: false` (the default) makes every output inert: `stance` is still
 * reported for telemetry, but `defenseWinOnly`, `readyRingBonus`,
 * `attackSendAll` and `attackKeepHome` all read as "unchanged". Every knob
 * below is additive and off at its default, so an arm is a JSON string.
 */
export type ConflictStance = 'trade' | 'even' | 'control';

export interface ConflictTempoConfig {
    /** Master switch. False = V1 exactly, whatever the other knobs say. */
    enabled: boolean;

    // ---- the board read ----
    /**
     * `myValue / theirValue` below this reads as a losing board (`trade`).
     * Ratio rather than difference: two 3-skill bodies against one 6 is an even
     * board on totals and a losing one on bodies, which is what `bestBodyWeight`
     * is for.
     */
    weakBoardRatio: number;
    /** Above this the board is winning (`control`). */
    strongBoardRatio: number;
    /**
     * How much of the best SINGLE body on each side to add to that side's
     * total before the ratio. The owner reads individual values because a
     * 5-skill body that survives a conflict is worth more than the two 2s that
     * trade with it — they lose their whole contribution to one removal, and
     * only one body can carry an attachment or a buff. 0 = totals only.
     */
    bestBodyWeight: number;
    /**
     * Skip the read entirely while both boards are below this much skill. Round
     * one is one body against one body, where the ratio is noise and the deck's
     * own opening is a better guide than a board read.
     */
    minBoardSkill: number;

    // ---- trade stance ----
    /**
     * On a losing board, defend only what can be WON outright — the `win-only`
     * mode the rush profiles already use — instead of bowing bodies into a
     * prevent-break defense. The province still falls later; the bodies are
     * gone now.
     *
     * This is the first DEFENSIVE lever in this project that points at
     * defending LESS. The five that measured negative (`defenseBreakTie`, the
     * defense buffer, `chumpBlock`, the 3-3 safety gate, the dynasty skip) all
     * pointed the other way, and their common cause was that a ready body is
     * worth less than the tempo spent keeping it. That reasoning predicts this
     * one is positive.
     */
    tradeDefenseWinOnly: boolean;
    /** Only trade while we still have this many conflicts to declare ourselves. */
    tradeMinOwnConflicts: number;
    /**
     * Stop trading once this many of our own outer provinces are broken.
     * Exchanging provinces is only a race while there is something left to
     * race with; at three broken the next break is the stronghold.
     */
    tradeMaxOwnBrokenProvinces: number;
    /**
     * On a losing board send every eligible body at the attack instead of V1's
     * all-but-one. The body kept home defends nothing we are choosing to
     * defend.
     */
    tradeAttackSendAll: boolean;

    // ---- ready loop ----
    readyLoopEnabled: boolean;
    /**
     * Bodies that must be ready for the loop to exist: one attacks on water,
     * one is already bowed and gets readied. Below this there is no loop, only
     * a ring choice.
     */
    readyLoopMinReadyBodies: number;
    /**
     * Count an opponent conflict still to come as a reason to ready. V1 only
     * asks whether WE have another conflict, which misses the half of the rule
     * that readies a DEFENDER.
     */
    readyLoopCountsDefense: boolean;
    /**
     * Water-ring score added per point of skill on the best bowed body we
     * would ready. Scored against `ringElementBase`, where earth is 40 and
     * void 50, so 4 per skill point makes a 5-skill body decisive and 1 makes
     * it a tie-break.
     */
    readyRingBonusPerSkill: number;
    /** Hard ceiling on that bonus. */
    readyRingBonusCap: number;
    /**
     * Bodies to keep home on a winning board when the loop is available, so
     * there is something to defend with and ready. 0 = V1's sizing.
     */
    controlAttackKeepHome: number;
}

export const DEFAULT_CONFLICT_TEMPO: ConflictTempoConfig = {
    enabled: false,
    weakBoardRatio: 0.8,
    strongBoardRatio: 1.25,
    bestBodyWeight: 0,
    minBoardSkill: 4,
    tradeDefenseWinOnly: false,
    tradeMinOwnConflicts: 1,
    tradeMaxOwnBrokenProvinces: 2,
    tradeAttackSendAll: false,
    readyLoopEnabled: false,
    readyLoopMinReadyBodies: 2,
    readyLoopCountsDefense: true,
    readyRingBonusPerSkill: 0,
    readyRingBonusCap: 40,
    controlAttackKeepHome: 0
};

export interface TempoCharacter {
    military: number;
    political: number;
    bowed?: boolean;
}

export interface ConflictTempoInput {
    /** The axis the read is about. Skill is not comparable across axes. */
    axis: 'military' | 'political';
    myReady: TempoCharacter[];
    myBowed: TempoCharacter[];
    theirReady: TempoCharacter[];
    /** Conflicts we may still declare this round. */
    myConflictsRemaining: number;
    /** Conflicts they may still declare this round. Public information. */
    opponentConflictsRemaining: number;
    /** Holding the token now means the opponent holds it next round. */
    isFirstPlayer: boolean;
    myBrokenProvinces: number;
    opponentBrokenProvinces: number;
}

export interface ConflictTempoRead {
    stance: ConflictStance;
    mySkill: number;
    theirSkill: number;
    myBestBody: number;
    theirBestBody: number;
    ratio: number;
    /** Size defenses `win-only` instead of `prevent-break`. */
    defenseWinOnly: boolean;
    /** Score to add to the WATER ring, on `ringElementBase`'s scale. */
    readyRingBonus: number;
    /** Send every eligible body at this attack. */
    attackSendAll: boolean;
    /** Bodies to keep home, or undefined for V1's sizing. */
    attackKeepHome?: number;
    /** The token alternates unconditionally, so this is simply the negation. */
    firstPlayerNextRound: boolean;
    reason: string;
}

const INERT_REASON = 'tempo-off';

export class ConflictTempoPolicy {
    private readonly config: ConflictTempoConfig;

    public constructor(config?: Partial<ConflictTempoConfig>) {
        this.config = Object.assign({}, DEFAULT_CONFLICT_TEMPO, config || {});
    }

    public read(input: ConflictTempoInput): ConflictTempoRead {
        const axis = input.axis;
        const mySkill = this.total(input.myReady, axis);
        const theirSkill = this.total(input.theirReady, axis);
        const myBestBody = this.best(input.myReady, axis);
        const theirBestBody = this.best(input.theirReady, axis);
        const firstPlayerNextRound = !input.isFirstPlayer;

        const weight = Math.max(0, Number(this.config.bestBodyWeight) || 0);
        const myValue = mySkill + weight * myBestBody;
        const theirValue = theirSkill + weight * theirBestBody;
        // A zero denominator is a board with nothing ready on it, which is the
        // strongest board state there is — not a division by zero.
        const ratio = theirValue > 0 ? myValue / theirValue : (myValue > 0 ? Infinity : 1);

        const belowFloor = mySkill < this.config.minBoardSkill && theirSkill < this.config.minBoardSkill;
        const stance: ConflictStance = belowFloor
            ? 'even'
            : ratio < this.config.weakBoardRatio
                ? 'trade'
                : ratio > this.config.strongBoardRatio
                    ? 'control'
                    : 'even';

        const base: ConflictTempoRead = {
            stance,
            mySkill,
            theirSkill,
            myBestBody,
            theirBestBody,
            ratio,
            defenseWinOnly: false,
            readyRingBonus: 0,
            attackSendAll: false,
            attackKeepHome: undefined,
            firstPlayerNextRound,
            reason: INERT_REASON
        };
        if(!this.config.enabled) {
            return base;
        }

        const trading = stance === 'trade' &&
            input.myConflictsRemaining >= this.config.tradeMinOwnConflicts &&
            input.myBrokenProvinces <= this.config.tradeMaxOwnBrokenProvinces;

        base.defenseWinOnly = trading && this.config.tradeDefenseWinOnly;
        base.attackSendAll = trading && this.config.tradeAttackSendAll;

        // The loop needs a bowed body worth readying, a spare body to attack
        // with while it is bowed, and somewhere for the readied body to go.
        const bestBowed = this.best(input.myBowed, axis);
        const readyBodies = input.myReady.length;
        const hasUse = input.myConflictsRemaining >= 1 ||
            (this.config.readyLoopCountsDefense && input.opponentConflictsRemaining >= 1);
        const loop = this.config.readyLoopEnabled && bestBowed > 0 && hasUse &&
            readyBodies >= this.config.readyLoopMinReadyBodies;
        if(loop) {
            base.readyRingBonus = Math.min(
                this.config.readyRingBonusCap,
                bestBowed * this.config.readyRingBonusPerSkill
            );
        }
        if(stance === 'control' && loop && this.config.controlAttackKeepHome > 0) {
            base.attackKeepHome = Math.floor(this.config.controlAttackKeepHome);
        }

        base.reason = trading ? 'tempo-trade' : loop ? 'tempo-ready-loop' : `tempo-${stance}`;
        return base;
    }

    private total(cards: TempoCharacter[], axis: 'military' | 'political'): number {
        return (cards || []).reduce((sum, card) =>
            sum + Math.max(0, Number(card?.[axis]) || 0), 0);
    }

    private best(cards: TempoCharacter[], axis: 'military' | 'political'): number {
        return (cards || []).reduce((top, card) =>
            Math.max(top, Math.max(0, Number(card?.[axis]) || 0)), 0);
    }
}

/**
 * Record one tempo read. Kept out of the class so `read` stays a pure function
 * a spec can call without a telemetry sink.
 */
export function recordTempoRead(
    input: ConflictTempoInput,
    result: ConflictTempoRead,
    context: { seat?: string; round?: number; site?: string }
): void {
    if(!BotTelemetry.enabled) {
        return;
    }
    BotTelemetry.record('conflict-tempo', () => ({
        seat: context.seat,
        round: context.round,
        site: context.site,
        axis: input.axis,
        mySkill: result.mySkill,
        theirSkill: result.theirSkill,
        myBestBody: result.myBestBody,
        theirBestBody: result.theirBestBody,
        ratio: Number.isFinite(result.ratio) ? Math.round(result.ratio * 100) / 100 : 999,
        myReady: input.myReady.length,
        theirReady: input.theirReady.length,
        myBowed: input.myBowed.length,
        myConflictsRemaining: input.myConflictsRemaining,
        opponentConflictsRemaining: input.opponentConflictsRemaining,
        isFirstPlayer: input.isFirstPlayer,
        stance: result.stance,
        defenseWinOnly: result.defenseWinOnly,
        readyRingBonus: result.readyRingBonus,
        attackSendAll: result.attackSendAll,
        attackKeepHome: result.attackKeepHome ?? -1,
        reason: result.reason,
        // Divergence from V1: only these three change a decision. `stance`
        // alone does not — it is reported at every weight, including off.
        divergent: result.defenseWinOnly || result.readyRingBonus > 0 ||
            result.attackSendAll || result.attackKeepHome !== undefined
    }));
}
