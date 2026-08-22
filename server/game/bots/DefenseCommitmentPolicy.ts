import { BotTelemetry } from './BotTelemetry.js';

/**
 * How much skill a defense commits, as an injectable policy object.
 *
 * This was inline arithmetic in `JigokuBotPolicy.declareDefenders`. It is
 * pulled out here because it is the single most re-measured decision in the
 * bot (five independent experiments, all rejected) and every one of those
 * experiments had to edit the same expression in place, which made "is the
 * disabled path still bit-identical to the old code?" a question of reading
 * diffs rather than of running a unit test.
 *
 * `DEFAULT_DEFENSE_COMMITMENT` reproduces V1 exactly. Every knob below is
 * additive and off at its default.
 *
 * ## The trade this class prices
 *
 * A province breaks when attacker skill beats defender skill by at least the
 * province strength, so a defense that merely MATCHES the attacker already
 * saves the province. But attackers win ties (`conflict.ts:517`), so matching
 * hands over the conflict and the ring. Going one point further takes both.
 *
 * The extra point is never free and is rarely worth exactly one point: skills
 * are integers, so the marginal defender is whatever body is next in the sorted
 * candidate list, and it bows on return home (`conflictflow.ts:950`) whether it
 * contributed 1 skill or 5. `breakTieMaxMarginalSkill` and
 * `breakTieSurplusBodies` price that body instead of assuming it is spare.
 */
export type DefenseCommitmentMode = 'win-only' | 'prevent-break';

/** No cap: declare every ready body. What the stronghold branch has always done. */
export const UNCAPPED = Number.POSITIVE_INFINITY;

export interface DefenseCommitmentConfig {
    /**
     * Commit one skill past the attacker when a tie is already reachable, so
     * the defense WINS the conflict instead of merely saving the province.
     * V1 ships `false`: the shared path lands exactly on the attacker's skill.
     */
    breakTie: boolean;
    /**
     * Refuse the extra point when the body that would supply it is worth more
     * than this much skill. 0 = no cap (pay any price). The window only ever
     * needs +1, so a 5-skill body spends four points of readiness for nothing.
     */
    breakTieMaxMarginalSkill: number;
    /**
     * Refuse the extra point unless this many ready bodies remain AFTER it, on
     * top of the conflicts we still have to open ourselves. 0 = no requirement.
     */
    breakTieSurplusBodies: number;
    /**
     * Refuse the extra point unless at least this many ready bodies are
     * available to supply it. 0 = no requirement.
     *
     * This is the knob the telemetry actually pointed at, and it is NOT the
     * same cut as `breakTieSurplusBodies`. Measured over 1080 paired games
     * (16483 sizing calls, 238 games where the lever changed a declaration):
     * with only ONE spare body the tie-break flips 13 games toward the changed
     * seat and 22 away — the whole of the lever's loss — while at two or more
     * it flips 11 toward and 7 away. Conflicts-remaining does NOT separate
     * them (1 and 2 remaining are both negative), so the cost is the LAST BODY
     * itself, not its relation to our own conflict schedule.
     */
    breakTieMinReadyCount: number;
    /**
     * Restrict the extra point to conflicts over these ring elements (lowercase).
     * Empty = every ring. The ring is the entire prize here, and they are not
     * worth the same.
     */
    breakTieRingElements: string[];
    /** Extra skill committed past the minimal break-prevention target. */
    skillBuffer: number;
    /** Reserve sized from what the attacker can still pay after declaration. */
    threatBuffer: number;
    /**
     * Cap on how much skill a defense may commit, measured from the
     * BREAK-PREVENTION line rather than from the attacker's total:
     *
     *     cap = max(attackerSkill - provinceStrength, 0) + margin
     *
     * 0 = uncapped (V1).
     *
     * The province absorbs its own strength — a province breaks only when the
     * attacker beats the defender by at least `provinceStrength` — so the
     * skill that actually has to come off our board is
     * `attackerSkill - provinceStrength`, and the margin is the safety buffer
     * on top of THAT. Measuring the margin from the attacker's raw total
     * instead makes every strong province over-defended by exactly its own
     * strength, which is the case this knob exists to stop.
     *
     * This is NOT the sizing family that `defenseBreakTie`, `skillBuffer`,
     * `threatBuffer` and `chumpBlock` belong to. Those all decide whether to
     * defend at all, or how hard on a board that is losing, and all six of
     * them are measured and settled. This one leaves every such decision
     * alone and only trims SURPLUS on a defense that is already decided — the
     * mirror of `attackKeepHome`, whose payoff is bodies still ready for the
     * next conflict of the same phase.
     *
     * The general branches are already close to minimal, so this mostly bites
     * where a buffer pushed the target out; the branch it exists for is the
     * stronghold, which commits everything unconditionally.
     */
    maxSurplusMargin: number;
    /**
     * The cap for the stronghold-under-attack branch, which otherwise declares
     * every ready body no matter how small the attack. 0 = uncapped (V1).
     *
     * STATIC, unlike the outer-province cap above: this one is measured from
     * the attacker's RAW skill (`attackerSkill + margin`), not from the
     * break-prevention line. Discounting the buffer by the stronghold's own
     * strength would shrink it on the one province whose break ENDS THE GAME,
     * and a strong stronghold province is exactly where an opponent spends
     * their tricks. Owner's call: outer provinces relative, stronghold flat.
     *
     * Breaking the stronghold loses the GAME, so the surplus here is real
     * insurance against a post-declaration pump rather than pure waste — but
     * it is bought with the whole board, and a second stronghold attack in the
     * same phase then walks in against nothing. A larger margin than the outer
     * provinces is the point: it covers a stacked answer (Banzai +2/+4,
     * Spreading the Darkness +4, a body played from hand) and still leaves
     * bodies ready for the follow-up.
     */
    strongholdMaxSurplusMargin: number;
    /**
     * Only cap the stronghold defense while the attacker still has ready
     * bodies at home — i.e. a second attack this phase is actually possible.
     * With their board fully committed there is no follow-up to save for, so
     * the surplus costs nothing and V1's all-in is correct.
     */
    strongholdCapRequiresEnemyReserve: boolean;
}

export const DEFAULT_DEFENSE_COMMITMENT: DefenseCommitmentConfig = {
    breakTie: false,
    breakTieMaxMarginalSkill: 0,
    breakTieSurplusBodies: 0,
    breakTieMinReadyCount: 0,
    breakTieRingElements: [],
    skillBuffer: 0,
    threatBuffer: 0,
    maxSurplusMargin: 0,
    strongholdMaxSurplusMargin: 0,
    strongholdCapRequiresEnemyReserve: false
};

export interface DefenseSizingInput {
    /** `win-only` concedes anything it cannot win outright. */
    mode: DefenseCommitmentMode;
    attackerSkill: number;
    /** Skill already committed to the defense. */
    defenderSkill: number;
    /** `defenderSkill` plus every body we could still declare. */
    potential: number;
    provinceStrength: number;
    /** Skill of the next body we would declare, or 0 if none is left. */
    marginalSkill: number;
    /** Ready bodies not yet in this conflict. */
    readyCount: number;
    /** Conflicts we still get to initiate this round. */
    conflictsRemaining: number;
    /** Lowercased contested ring element. */
    ringElement: string;
    /** Our STRONGHOLD province is the one being attacked: a break loses the game. */
    strongholdUnderAttack?: boolean;
    /** Enemy ready bodies NOT in this conflict — their follow-up attack. */
    opponentReadyAtHome?: number;
}

export type DefenseBranch = 'win-only' | 'concede' | 'tie-or-better' | 'prevent-break' | 'hopeless' | 'stronghold';

export interface DefenseSizingResult {
    /** Skill to defend up to. Undefined on `concede` / `hopeless`. */
    target?: number;
    branch: DefenseBranch;
    /** The tie-break window was open — the defense can reach a win. */
    tieBreakEligible: boolean;
    /** The extra point was actually taken. */
    tieBreakApplied: boolean;
    /** Why an eligible window was declined, for telemetry. */
    tieBreakDeclined?: 'off' | 'marginal-cost' | 'last-body' | 'no-surplus' | 'ring';
    /** A surplus cap actually lowered the target below what V1 would commit. */
    surplusCapped: boolean;
}

export class DefenseCommitmentPolicy {
    private readonly config: DefenseCommitmentConfig;

    public constructor(config?: Partial<DefenseCommitmentConfig>) {
        this.config = Object.assign({}, DEFAULT_DEFENSE_COMMITMENT, config || {});
    }

    public size(input: DefenseSizingInput): DefenseSizingResult {
        const { attackerSkill, potential, provinceStrength } = input;

        // The stronghold: a break loses the game, so every other cap is
        // overridden and V1 declares the whole board. `UNCAPPED` reproduces
        // that exactly; a configured margin trims only the surplus.
        if(input.strongholdUnderAttack) {
            const target = this.strongholdTarget(input);
            return {
                target,
                branch: 'stronghold',
                tieBreakEligible: false,
                tieBreakApplied: false,
                surplusCapped: Number.isFinite(target)
            };
        }

        if(input.mode === 'win-only') {
            // The rush would rather lose a province than bow bodies it needs to
            // attack again, so it only defends when it can win outright. This
            // path has ALWAYS added the tie-breaking point; the shared path
            // below never did.
            if(potential <= attackerSkill) {
                return { branch: 'concede', tieBreakEligible: false, tieBreakApplied: false, surplusCapped: false };
            }
            const raw = attackerSkill + 1;
            const target = this.capTarget(raw, input);
            return { target, branch: 'win-only', tieBreakEligible: false, tieBreakApplied: false, surplusCapped: target < raw };
        }

        if(potential >= attackerSkill) {
            const eligible = potential > attackerSkill;
            const declined = eligible ? this.declineReason(input) : undefined;
            const applied = eligible && !declined;
            const raw = Math.min(attackerSkill + (applied ? 1 : 0) + this.config.threatBuffer, potential);
            const target = this.capTarget(raw, input);
            return {
                target,
                branch: 'tie-or-better',
                tieBreakEligible: eligible,
                tieBreakApplied: applied,
                tieBreakDeclined: declined,
                surplusCapped: target < raw
            };
        }

        if(potential > attackerSkill - provinceStrength) {
            const raw = Math.min(
                attackerSkill - provinceStrength + 1 + this.config.skillBuffer + this.config.threatBuffer,
                potential);
            const target = this.capTarget(raw, input);
            return {
                target,
                branch: 'prevent-break',
                tieBreakEligible: false,
                tieBreakApplied: false,
                surplusCapped: target < raw
            };
        }

        return { branch: 'hopeless', tieBreakEligible: false, tieBreakApplied: false, surplusCapped: false };
    }

    /**
     * How far the stronghold defense may commit past the attacker.
     *
     * `UNCAPPED` is V1: every ready body, however small the attack. A margin
     * caps the target at `attackerSkill + margin`, which still beats the
     * attacker by that margin — it can never concede a stronghold V1 would
     * have held, only stop stacking bodies onto one already held.
     */
    private strongholdTarget(input: DefenseSizingInput): number {
        const margin = this.config.strongholdMaxSurplusMargin;
        if(margin <= 0) {
            return UNCAPPED;
        }
        // With their board fully committed there is no second attack to save
        // bodies for, so the surplus is free insurance and V1 is right.
        if(this.config.strongholdCapRequiresEnemyReserve &&
            !((input.opponentReadyAtHome ?? 0) > 0)) {
            return UNCAPPED;
        }
        return input.attackerSkill + margin;
    }

    /**
     * `max(attackerSkill - provinceStrength, 0) + margin` — the skill that has
     * to come off our board to stop the break, plus the safety buffer.
     */
    private marginTarget(input: DefenseSizingInput, margin: number): number {
        return Math.max(input.attackerSkill - input.provinceStrength, 0) + margin;
    }

    /**
     * Trim surplus off an already-sized target. The general branches are
     * margin-minimal already (`win-only` asks for `attackerSkill + 1`), so
     * this only ever bites when a buffer pushed the target out.
     */
    private capTarget(target: number, input: DefenseSizingInput): number {
        const margin = this.config.maxSurplusMargin;
        if(margin <= 0) {
            return target;
        }
        // Never cap BELOW the point that wins the conflict. At province
        // strength 6+ the relative formula lands under `attackerSkill + 1`,
        // and a defense that bows bodies and still loses is strictly worse
        // than not defending at all — it pays the bodies AND hands over the
        // ring. The cap exists to trim surplus, never to convert a won
        // defense into a lost one.
        const winFloor = input.attackerSkill + 1;
        return Math.min(target, Math.max(this.marginTarget(input, margin), winFloor));
    }

    private declineReason(input: DefenseSizingInput): DefenseSizingResult['tieBreakDeclined'] {
        if(!this.config.breakTie) {
            return 'off';
        }
        const cap = this.config.breakTieMaxMarginalSkill;
        if(cap > 0 && input.marginalSkill > cap) {
            return 'marginal-cost';
        }
        const minReady = this.config.breakTieMinReadyCount;
        if(minReady > 0 && input.readyCount < minReady) {
            return 'last-body';
        }
        const surplus = this.config.breakTieSurplusBodies;
        if(surplus > 0) {
            // One body goes into this conflict, so `readyCount - 1` survive it.
            const readyAfter = Math.max(0, input.readyCount - 1);
            if(readyAfter < Math.max(0, input.conflictsRemaining) + surplus) {
                return 'no-surplus';
            }
        }
        const rings = this.config.breakTieRingElements;
        if(rings.length > 0 && !rings.includes(input.ringElement)) {
            return 'ring';
        }
        return undefined;
    }
}

/**
 * Record one defense-sizing decision. Separate from `size` so the pure policy
 * stays a pure function and the probe can be attached from a harness without
 * the engine knowing.
 */
export function recordDefenseSizing(
    input: DefenseSizingInput,
    result: DefenseSizingResult,
    context: { seat?: string; round?: number; axis?: string; honor?: number }
): void {
    if(!BotTelemetry.enabled) {
        return;
    }
    BotTelemetry.record('defense-size', () => ({
        seat: context.seat,
        round: context.round,
        axis: context.axis,
        honor: context.honor,
        mode: input.mode,
        attackerSkill: input.attackerSkill,
        defenderSkill: input.defenderSkill,
        potential: input.potential,
        provinceStrength: input.provinceStrength,
        marginalSkill: input.marginalSkill,
        readyCount: input.readyCount,
        conflictsRemaining: input.conflictsRemaining,
        ringElement: input.ringElement,
        strongholdUnderAttack: input.strongholdUnderAttack,
        opponentReadyAtHome: input.opponentReadyAtHome,
        branch: result.branch,
        target: result.target,
        surplusCapped: result.surplusCapped,
        tieBreakEligible: result.tieBreakEligible,
        tieBreakApplied: result.tieBreakApplied,
        tieBreakDeclined: result.tieBreakDeclined,
        // The decision only DIVERGES from V1 when the extra point is actually
        // TAKEN and the committed skill is already exactly the attacker's:
        // below that both arms declare another body, above it both stop, and a
        // window the scope DECLINED lands on V1's own choice.
        //
        // Keying this on `tieBreakEligible` instead silently over-counts for
        // every scoped arm, because a declined window still reports eligible.
        divergent: result.tieBreakApplied && input.defenderSkill === input.attackerSkill,
        // Kept separately: the size of the window the scope is choosing within.
        windowOpen: result.tieBreakEligible && input.defenderSkill === input.attackerSkill,
        // The surplus cap diverges on a different condition entirely: it bites
        // only where V1 would have declared ANOTHER body and the cap stops.
        // `capWindowOpen` is every call the cap could have reached, so the
        // fire rate is readable without a second run.
        capDivergent: result.surplusCapped && input.defenderSkill >= (result.target ?? UNCAPPED),
        capWindowOpen: !!input.strongholdUnderAttack
    }));
}
