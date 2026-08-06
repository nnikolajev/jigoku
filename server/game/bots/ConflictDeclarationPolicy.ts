import { BotTelemetry } from './BotTelemetry.js';

/**
 * Which conflict to declare, as an injectable policy object.
 *
 * ## The gap this exists to close
 *
 * V1's fair axis choice (`JigokuBotPolicy.preferredConflictType`) compares
 * ONLY its own ready board: whichever of military/political carries more of my
 * skill is the axis I attack on. It never looks at what the opponent can put in
 * front of it.
 *
 * That is not a hidden-information limit. The omniscient variant right next to
 * it (`omniPreferredConflictType`) attacks on the axis with the largest REAL
 * advantage — mine minus theirs minus the tricks it can see in their hand — and
 * only the last of those three terms is actually hidden. The opponent's ready
 * board is public; the fair RING choice one function away already reads it
 * (`ringScore` counts their fateless bodies for water and their fated ones for
 * void). So the fair axis choice is leaving public information on the table,
 * and the cheating bot is the existence proof of what to do with it.
 *
 * `opponentBoardWeight: 0` reproduces V1 exactly, including its tie-break
 * toward military.
 *
 * ## The guard that is not optional
 *
 * Subtracting the opponent's board can make an axis where we have NO skill
 * look better than a contested axis where we have plenty — a zero-skill axis
 * subtracts a zero-skill defense. The omniscient path learned this the
 * expensive way: the bot toggled the conflict type, failed to commit, and lost
 * the conflict outright. Both zero-skill guards below are load-bearing and are
 * applied before the comparison at every weight.
 */
export interface ConflictDeclarationConfig {
    /**
     * How much of the opponent's ready skill on an axis to subtract when
     * choosing between axes. 0 = V1 (own board only). 1 = the full differential
     * the omniscient bot uses.
     *
     * Unlike a tie-break constant this genuinely sweeps: it changes which axis
     * wins, not merely the sign of a comparison, so distinct values produce
     * distinct games.
     */
    opponentBoardWeight: number;
    /**
     * Require the opponent-aware pick to beat the own-board pick by at least
     * this much before switching. Guards against flipping the declaration on a
     * fraction of a point, which costs the deck's own axis synergies for
     * nothing. 0 = switch on any improvement.
     */
    switchMargin: number;
    /**
     * Do not pick an axis we have no conflicts left to declare on.
     *
     * Each player gets one military and one political conflict per round, and
     * the call site only toggles the conflict type when the preferred axis
     * still has one remaining (`militaryRemaining` / `politicalRemaining`).
     * Naming an exhausted axis therefore does not stay put — it silently
     * declines to toggle and leaves the RING's default type in place, which is
     * neither of the two axes the policy was reasoning about.
     *
     * Off by default because applying it at `opponentBoardWeight: 0` would
     * change V1 rather than reproduce it.
     */
    avoidExhaustedAxis: boolean;
}

export const DEFAULT_CONFLICT_DECLARATION: ConflictDeclarationConfig = {
    opponentBoardWeight: 0,
    switchMargin: 0,
    avoidExhaustedAxis: false
};

export interface AxisChoiceInput {
    myMilitary: number;
    myPolitical: number;
    /** Opponent's READY board skill. Public information. */
    theirMilitary: number;
    theirPolitical: number;
    /** Deck-level rush flag: stay military while any military skill exists. */
    forceMilitary: boolean;
    /** Conflicts of each type we may still declare this round. */
    militaryRemaining?: number;
    politicalRemaining?: number;
    /**
     * Skill-equivalent value of a card payoff that only turns on for one axis,
     * added to that axis before the comparison. The axis choice is otherwise a
     * pure board reading, so a deck whose CARD ENGINE lives on one axis never
     * declares there once its board leans the other way — measured on the Lion
     * Duelist list, whose Regal Bearing needs a political conflict with a
     * participating Courtier and fired **zero times in six games** behind a
     * military-leaning board.
     *
     * The zero-skill guards above run on the RAW board, so a bonus can never
     * steer onto an axis we cannot legally attack on. Zero (the default) is
     * bit-identical to not having the field.
     */
    axisBonusMilitary?: number;
    axisBonusPolitical?: number;
}

export type ConflictAxisChoice = 'military' | 'political';

export interface AxisChoiceResult {
    axis: ConflictAxisChoice;
    /**
     * What the pure own-board comparison picks — NOT what V1 picks. V1 also
     * applies `forceMilitary` and the zero-skill guards, so a rush deck holding
     * more political skill legitimately reads `axis !== baseline` at weight 0.
     * For "did this differ from V1", use `reason === 'opponent-aware'`.
     */
    baseline: ConflictAxisChoice;
    reason: 'force-military' | 'only-military' | 'only-political' | 'own-board' |
        'opponent-aware' | 'below-margin' | 'axis-exhausted';
}

export class ConflictDeclarationPolicy {
    private readonly config: ConflictDeclarationConfig;

    public constructor(config?: Partial<ConflictDeclarationConfig>) {
        this.config = Object.assign({}, DEFAULT_CONFLICT_DECLARATION, config || {});
    }

    public chooseAxis(input: AxisChoiceInput): AxisChoiceResult {
        // Card-payoff bonuses ride along with our own skill from here on. The
        // legality guards below deliberately keep reading the RAW board.
        const myMilitary = input.myMilitary + (Number(input.axisBonusMilitary) || 0);
        const myPolitical = input.myPolitical + (Number(input.axisBonusPolitical) || 0);
        const baseline: ConflictAxisChoice =
            myMilitary >= myPolitical ? 'military' : 'political';

        // A military-rush deck forces every conflict military as long as it has
        // any military skill: its payoffs and pumps are all military, and
        // staying on one axis lets Captive Audience turn the political conflict
        // into a second military one.
        if(input.forceMilitary && input.myMilitary > 0) {
            return { axis: 'military', baseline: baseline, reason: 'force-military' };
        }
        // Never steer onto an axis we cannot legally attack on.
        if(input.myMilitary <= 0 && input.myPolitical > 0) {
            return { axis: 'political', baseline: baseline, reason: 'only-political' };
        }
        if(input.myPolitical <= 0 && input.myMilitary > 0) {
            return { axis: 'military', baseline: baseline, reason: 'only-military' };
        }

        const weight = this.config.opponentBoardWeight;
        if(weight <= 0) {
            return { axis: baseline, baseline: baseline, reason: 'own-board' };
        }
        // An axis with no conflicts left cannot be declared on, and naming it
        // does not keep the status quo — the call site simply declines to
        // toggle, leaving the ring's own default type.
        if(this.config.avoidExhaustedAxis) {
            const exhausted = (axis: ConflictAxisChoice) => {
                const left = axis === 'military'
                    ? input.militaryRemaining : input.politicalRemaining;
                return Number.isFinite(left) && (left as number) <= 0;
            };
            if(exhausted('military') && !exhausted('political')) {
                return { axis: 'political', baseline: baseline, reason: 'axis-exhausted' };
            }
            if(exhausted('political') && !exhausted('military')) {
                return { axis: 'military', baseline: baseline, reason: 'axis-exhausted' };
            }
        }
        const military = myMilitary - weight * input.theirMilitary;
        const political = myPolitical - weight * input.theirPolitical;
        const preferred: ConflictAxisChoice = military >= political ? 'military' : 'political';
        if(preferred === baseline) {
            return { axis: baseline, baseline: baseline, reason: 'own-board' };
        }
        // Switching costs the deck whatever axis synergy its own board implies,
        // so make the differential earn it.
        const gain = Math.abs(military - political);
        if(gain < this.config.switchMargin) {
            return { axis: baseline, baseline: baseline, reason: 'below-margin' };
        }
        return { axis: preferred, baseline: baseline, reason: 'opponent-aware' };
    }
}

export function recordAxisChoice(
    input: AxisChoiceInput,
    result: AxisChoiceResult,
    context: { seat?: string; round?: number }
): void {
    if(!BotTelemetry.enabled) {
        return;
    }
    BotTelemetry.record('axis-choice', () => ({
        seat: context.seat,
        round: context.round,
        myMilitary: input.myMilitary,
        myPolitical: input.myPolitical,
        theirMilitary: input.theirMilitary,
        theirPolitical: input.theirPolitical,
        forceMilitary: input.forceMilitary,
        axis: result.axis,
        baseline: result.baseline,
        reason: result.reason,
        // Divergence from V1, which is what a measurement wants. `axis !==
        // baseline` also fires for `force-military` overriding a
        // political-heavy board, and V1 does that too.
        divergent: result.reason === 'opponent-aware'
    }));
}
