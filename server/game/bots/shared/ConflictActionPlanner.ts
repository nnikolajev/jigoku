// SHARED (V1 + V2). Lived under `v2/` until 2026-08-13; moved to `shared/`
// once measurement showed V1 imports it at RUNTIME, so it was never
// experimental. Changing it changes the shipping bot — prove any edit
// bit-identical with `tools/selfplay/refactorIdentity.js`.
//
// Conflict action sequencing, shared by Bot V1 and Bot V2.
//
// V1 answers "which card do I play next?" with a fixed pipeline: fire every
// board ability, then sort the hand by deck comparators and playbook priority,
// then take the first card that survives a per-card intent filter. Two
// consequences show up in live games:
//
//  1. Deck-specific target pickers VETO cards outright. A Crane holding Fine
//     Katana and Shukujo while three skill short of breaking a province plays
//     neither, because the duel profile only attaches them to a "tower"
//     character and no tower is in play. The deck's preference silently
//     outranks the conflict math.
//  2. Cards are judged one at a time. Nothing asks whether some COMBINATION
//     inside the fate budget reaches the break threshold.
//
// This planner replaces that with: deck logic proposes options and prices its
// preferences, and the planner picks the whole sequence that maximizes the
// conflict outcome. A deck preference becomes a weight, not a veto, so it can
// still lose to breaking a province — which is the point of the exercise.
//
// The engine remains the authority on legality. Every candidate handed to the
// planner is already playable; the planner only chooses among legal plays.

export interface ConflictActionProfile {
    enabled: boolean;
    /** Reaching the break threshold (attacker) or denying it (defender). */
    breakValue: number;
    /** Winning the conflict without breaking: ring, and denial of the ring. */
    winValue: number;
    /** Penalty per fate spent, so equal plans keep the cheaper one. */
    fateWeight: number;
    /** Penalty per card spent — hand size is a real resource. */
    cardWeight: number;
    /** Penalty per honor spent, scaled up as own honor approaches the floor. */
    honorWeight: number;
    /** Honor at or below which honor costs are treated as near-fatal. */
    honorFloor: number;
    /**
     * How much of a deck's stated preference survives. 1 keeps the deck's own
     * pricing; 0 ignores deck opinion entirely. Values below 1 let a strong
     * outcome overrule a deck rule, which is the whole reason this exists.
     */
    preferenceWeight: number;
    /**
     * How much a card's post-conflict worth counts. 1 = an attachment's bonus is
     * worth its face value in each conflict its bearer survives into.
     *
     * DEFAULTS TO 0 (off), because it measured worse at every weight tried:
     * agreement with V1's card choices went 74% (off) -> 73% (0.25) -> 67% (1.0),
     * and win rate -11 games over three shuffle bases. The hypothesis was that
     * V1 prefers attachments because they persist; the data says V1's
     * attachment-vs-event ordering encodes something else, because correcting
     * persistence in EITHER direction increases divergence. Kept as a per-deck
     * opt-in rather than deleted - a single deck may still want it.
     */
    persistentWeight: number;
    /** Candidates considered per window. Guards the subset search. */
    maxCandidates: number;
    /**
     * Minimum value an opposing event must carry before a cancel (Voice of
     * Honor, Censure, Forgery) is spent on it.
     */
    cancelThreshold?: number;
}

export const DEFAULT_CONFLICT_ACTION_PROFILE: ConflictActionProfile = {
    enabled: true,
    breakValue: 100,
    winValue: 25,
    fateWeight: 1.5,
    cardWeight: 2,
    honorWeight: 3,
    honorFloor: 6,
    preferenceWeight: 1,
    persistentWeight: 0,
    maxCandidates: 10,
    cancelThreshold: 4
};

export interface ConflictAction {
    /** Stable identity for deterministic tie-breaks. */
    readonly key: string;
    readonly cardId?: string;
    readonly uuid?: string;
    /** Fate paid. Cards whose live cost is unknown are excluded by the caller. */
    readonly cost: number;
    /** Honor paid on play. */
    readonly honorCost?: number;
    /** Skill this adds to our side of the current conflict. */
    readonly selfSkill: number;
    /** Skill this removes from the opposing side (bow, destroy, debuff). */
    readonly opponentSkill?: number;
    /** Worth that is not skill (draw, honor swing, board control). */
    readonly abilityValue?: number;
    /**
     * Worth that outlives this conflict - an attachment's bonus applies again in
     * every conflict it survives into. Scored like `abilityValue` (it is not
     * skill and must not decide the current conflict), weighted by
     * `persistentWeight`.
     */
    readonly persistentValue?: number;
    /**
     * Province strength this action removes (negative). Breaking needs
     * `lead >= strength`, so -2 strength is worth exactly as much as +2 skill —
     * but it is NOT skill, and pretending otherwise would also change who wins
     * the conflict. Applied to the threshold instead. Siege Warfare.
     */
    readonly provinceStrengthDelta?: number;
    /**
     * The deck's own opinion, in score units. Positive promotes, negative
     * demotes. A deck target picker that would have vetoed the card prices it
     * negative here instead of removing it.
     */
    readonly deckPreference?: number;
    /** Set when the deck vetoed this card and the planner may still take it. */
    readonly relaxed?: boolean;
    /** Caller-facing note for traces. */
    readonly reason?: string;
}

export interface ConflictActionInput {
    readonly amAttacker: boolean;
    readonly attackerSkill: number;
    readonly defenderSkill: number;
    /** Province strength (plus holdings) the attacker must exceed to break. */
    readonly provinceStrength: number;
    readonly fate: number;
    readonly honor: number;
    /** Losing the stronghold loses the game — spend everything. */
    readonly strongholdConflict?: boolean;
    readonly actions: ConflictAction[];
}

export interface ConflictActionPlan {
    readonly actions: ConflictAction[];
    readonly score: number;
    readonly baselineScore: number;
    /** Score gained over playing nothing. Zero means "pass" is as good. */
    readonly gain: number;
    readonly breaks: boolean;
    readonly wins: boolean;
}

function honorPenalty(honor: number, spent: number, profile: ConflictActionProfile): number {
    if(spent <= 0) {
        return 0;
    }
    // Honor only matters near the floor: with honor to spare a player can bid
    // low and recover it, so an ordinary honor cost is close to free.
    const remaining = honor - spent;
    const pressure = remaining <= 0
        ? 12
        : remaining >= profile.honorFloor
            ? 1
            : 1 + (profile.honorFloor - remaining);
    return spent * profile.honorWeight * pressure;
}

/**
 * Score the state a set of actions produces. Attacker and defender share one
 * objective expressed from our own seat: reach the break threshold, else win
 * the conflict, else spend as little as possible.
 */
function scoreOutcome(
    input: ConflictActionInput,
    selfSkill: number,
    opponentSkill: number,
    fateSpent: number,
    honorSpent: number,
    cards: number,
    extra: number,
    profile: ConflictActionProfile,
    provinceStrengthDelta = 0
): { score: number; breaks: boolean; wins: boolean } {
    const ourSkill = Math.max(0, selfSkill);
    const theirSkill = Math.max(0, opponentSkill);
    const attackerTotal = input.amAttacker ? ourSkill : theirSkill;
    const defenderTotal = input.amAttacker ? theirSkill : ourSkill;
    const lead = attackerTotal - defenderTotal;
    // A tie goes to the attacker provided they have at least 1 skill; 0-0
    // returns the ring unclaimed and breaks nothing.
    const attackerWins = attackerTotal >= 1 && lead >= 0;
    const wins = input.amAttacker ? attackerWins : !attackerWins;
    // A province cannot go below 0 strength, and only the attacker can lower it.
    const provinceStrength = input.amAttacker
        ? Math.max(0, input.provinceStrength + Math.min(0, provinceStrengthDelta))
        : input.provinceStrength;
    const breaks = attackerWins && lead >= provinceStrength;

    const breakSwing = input.strongholdConflict ? profile.breakValue * 4 : profile.breakValue;
    let score = extra;
    // The attacker gains by breaking; the defender gains by preventing it.
    score += (input.amAttacker ? (breaks ? breakSwing : 0) : (breaks ? -breakSwing : 0));
    score += wins ? profile.winValue : 0;
    // Partial credit for closing the gap keeps the search from treating every
    // unreachable plan as identical, and stops it discarding a play that sets
    // up the next window.
    score += Math.min(lead, provinceStrength) * (input.amAttacker ? 1 : -1);
    score -= fateSpent * profile.fateWeight;
    score -= cards * profile.cardWeight;
    score -= honorPenalty(input.honor, honorSpent, profile);
    return { score, breaks, wins };
}

function totals(actions: ConflictAction[], profile: ConflictActionProfile) {
    let self = 0, opponent = 0, fate = 0, honor = 0, extra = 0, provinceDelta = 0;
    for(const action of actions) {
        self += Number(action.selfSkill) || 0;
        opponent += Number(action.opponentSkill) || 0;
        fate += Math.max(0, Number(action.cost) || 0);
        honor += Math.max(0, Number(action.honorCost) || 0);
        provinceDelta += Math.min(0, Number(action.provinceStrengthDelta) || 0);
        extra += Math.max(0, Number(action.persistentValue) || 0) * profile.persistentWeight;
        // Clamped: `abilityValue` comes from hand-written per-card models, and a
        // single mis-scaled one must not be able to outweigh a province break
        // (worth `breakValue`, 100 by default). Duty legitimately returns 1000
        // in its own reaction path; it must never dominate a plan here.
        const ability = Math.max(-profile.breakValue, Math.min(profile.breakValue,
            Number(action.abilityValue) || 0));
        extra += ability + (Number(action.deckPreference) || 0) * profile.preferenceWeight;
    }
    return { self, opponent, fate, honor, extra, provinceDelta };
}

/**
 * Choose the best sequence of already-legal conflict actions.
 *
 * Returns null when passing is at least as good, so the caller keeps V1's
 * behavior instead of spending cards for nothing.
 */
export function planConflictActions(
    input: ConflictActionInput,
    profile: ConflictActionProfile = DEFAULT_CONFLICT_ACTION_PROFILE
): ConflictActionPlan | null {
    if(!profile.enabled) {
        return null;
    }
    const budget = Math.max(0, Math.floor(Number(input.fate) || 0));
    const candidates = input.actions
        .filter((action) => Number.isFinite(action.cost) && action.cost >= 0 && action.cost <= budget)
        .slice()
        .sort((a, b) => {
            // Rank by raw usefulness so the cap keeps the most relevant plays.
            const impact = (action: ConflictAction) =>
                (Number(action.selfSkill) || 0) + Math.abs(Number(action.opponentSkill) || 0) +
                Math.abs(Number(action.provinceStrengthDelta) || 0) +
                Math.max(0, Number(action.persistentValue) || 0) +
                Math.min(profile.breakValue, Number(action.abilityValue) || 0);
            return impact(b) - impact(a) || a.key.localeCompare(b.key);
        })
        .slice(0, Math.max(1, profile.maxCandidates));

    const empty = totals([], profile);
    const base = scoreOutcome(input, input.amAttacker ? input.attackerSkill : input.defenderSkill,
        input.amAttacker ? input.defenderSkill : input.attackerSkill,
        empty.fate, empty.honor, 0, empty.extra, profile);

    let best: { actions: ConflictAction[]; score: number; breaks: boolean; wins: boolean } | null = null;
    const total = candidates.length;
    if(total === 0 || total > 20) {
        return null;
    }
    // Exhaustive over subsets: the candidate cap keeps this small and, unlike a
    // greedy pass, it finds combinations that only clear the break threshold
    // together (two +2 attachments against a 3-skill deficit).
    for(let mask = 1; mask < (1 << total); mask++) {
        const chosen: ConflictAction[] = [];
        for(let index = 0; index < total; index++) {
            if(mask & (1 << index)) {
                chosen.push(candidates[index]);
            }
        }
        const sum = totals(chosen, profile);
        if(sum.fate > budget) {
            continue;
        }
        const selfBase = input.amAttacker ? input.attackerSkill : input.defenderSkill;
        const oppBase = input.amAttacker ? input.defenderSkill : input.attackerSkill;
        const outcome = scoreOutcome(input, selfBase + sum.self, oppBase + sum.opponent,
            sum.fate, sum.honor, chosen.length, sum.extra, profile, sum.provinceDelta);
        if(!best || outcome.score > best.score ||
            (outcome.score === best.score && chosen.length < best.actions.length)) {
            best = { actions: chosen, score: outcome.score, breaks: outcome.breaks, wins: outcome.wins };
        }
    }

    if(!best || best.score <= base.score) {
        return null;
    }
    // Order the chosen set: biggest committed swing first, so that if a later
    // step is answered or becomes illegal the conflict has already moved.
    const ordered = best.actions.slice().sort((a, b) => {
        const swing = (action: ConflictAction) =>
            (Number(action.selfSkill) || 0) + Math.abs(Number(action.opponentSkill) || 0);
        return swing(b) - swing(a) ||
            (Number(a.cost) || 0) - (Number(b.cost) || 0) ||
            a.key.localeCompare(b.key);
    });
    return {
        actions: ordered,
        score: best.score,
        baselineScore: base.score,
        gain: best.score - base.score,
        breaks: best.breaks,
        wins: best.wins
    };
}
