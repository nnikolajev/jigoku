// Aggressive conflict-card spending.
//
// Measured motivation, not a hunch. Over 272 games the bot closed a conflict
// action window 9286 times; 4060 of those closes happened at the
// `no-card-passed-intent-filter` gate — meaning every budget gate above had
// ALLOWED spending, the hand held at least one card the engine reported as
// playable and affordable, and the bot played nothing because its own intent
// filter rejected every candidate. That is roughly fifteen declined windows per
// game. The most-declined cards were `assassination` (1889), `banzai` (783),
// `regal-bearing` (714), `court-games` (700) and `display-of-power` (689).
//
// The same census killed the idea this was built alongside: fate is NOT the
// binding constraint. At those closes the bot held 3.13 fate and 5.44 affordable
// playable cards on average, so banking more fate feeds a bot that already
// cannot spend what it has. This policy attacks the filter instead.
//
// It is deliberately a LAST-RESORT rule: it only runs after every ordinary
// path has declined, so it can never override a deliberate hold that the
// normal pipeline made — it only fills a window that would otherwise be passed.

export interface AggressiveSpendProfile {
    // Off unless an arm or a deck opts in.
    enabled: boolean;
    // Only force cards at or above this playbook priority. The playbook's
    // default for an unrated card is 5, so 5 means "anything rated at least
    // average", 7 means "only cards the playbook thinks are good".
    minPriority: number;
    // Fate kept back rather than committed to a forced play.
    fateReserve: number;
    // Cap on forced plays per ROUND, so the rule cannot dump a whole hand
    // into windows it was never going to win. Per round rather than per
    // conflict because the policy has a round reset hook and no conflict one.
    maxPerRound: number;
    // Restrict to windows where we are the attacker. Defensive spending has
    // measured negative repeatedly in this codebase (`defenseBreakTie` is
    // settled null, `spendCardsOnDefense` is per-deck), so an arm can ask for
    // the offensive half alone.
    attackOnly: boolean;
}

export const DEFAULT_AGGRESSIVE_SPEND: AggressiveSpendProfile = {
    enabled: false,
    minPriority: 5,
    fateReserve: 0,
    maxPerRound: 1,
    attackOnly: false
};

export interface AggressiveSpendCandidate {
    uuid: string;
    id?: string;
    cost: number;
    priority: number;
    contribution: number | null;
}

export interface AggressiveSpendContext {
    amAttacker: boolean;
    fate: number;
    forcedThisRound: number;
    candidates: readonly AggressiveSpendCandidate[];
}

export class AggressiveSpendPolicy {
    readonly profile: AggressiveSpendProfile;

    constructor(profile: Partial<AggressiveSpendProfile> = {}) {
        this.profile = { ...DEFAULT_AGGRESSIVE_SPEND, ...profile };
    }

    get inert(): boolean {
        return !this.profile.enabled || this.profile.maxPerRound <= 0;
    }

    // The uuid to force, or null to leave the window passed. Ordering matches
    // the normal pipeline's: priority first, then live skill contribution, then
    // uuid so the choice is deterministic across replays.
    choose(context: AggressiveSpendContext): AggressiveSpendCandidate | null {
        const profile = this.profile;
        if(this.inert) {
            return null;
        }
        if(profile.attackOnly && !context.amAttacker) {
            return null;
        }
        if(context.forcedThisRound >= profile.maxPerRound) {
            return null;
        }
        const budget = context.fate - profile.fateReserve;
        const affordable = context.candidates
            .filter((candidate) => candidate.priority >= profile.minPriority &&
                candidate.cost <= budget)
            .slice()
            .sort((a, b) => b.priority - a.priority ||
                (b.contribution ?? -1) - (a.contribution ?? -1) ||
                String(a.uuid).localeCompare(String(b.uuid)));
        return affordable[0] || null;
    }
}
