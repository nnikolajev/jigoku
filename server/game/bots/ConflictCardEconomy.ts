// Shared conflict-card spending planner.
//
// The engine remains the authority on whether a card is currently playable.
// This module only sequences already-legal cards: it maximizes the combined
// value that fits in the bot's live fate pool, then plays the most efficient
// member of that plan first. Priority 9-10 cards receive an explicit premium
// so important, expensive answers are not crowded out by cheap filler.

export interface ConflictCardEconomyProfile {
    enabled: boolean;
    // Independent from `enabled`: Lion/Unicorn keep their proven legacy card
    // order, but every deck still needs exact province-break budgeting.
    strengthBudgetEnabled: boolean;
    priorityWeight: number;
    contributionWeight: number;
    abilityValueBonus: number;
    protectedPriority: number;
    protectedBonus: number;
    efficiencyCostFloor: number;
}

export interface ConflictCardOption<T = any> {
    card: T;
    key: string;
    priority: number;
    contribution: number | null;
    abilityValue: boolean;
    cost: number | undefined;
    legacyIndex: number;
}

export const DEFAULT_CONFLICT_CARD_ECONOMY: ConflictCardEconomyProfile = {
    enabled: true,
    strengthBudgetEnabled: true,
    priorityWeight: 4,
    contributionWeight: 2,
    abilityValueBonus: 8,
    protectedPriority: 9,
    protectedBonus: 50,
    efficiencyCostFloor: 1
};

// Swarm playbooks are tightly sequenced combo/volume decks. The first shared
// planner baseline regressed Lion in 8/9 and Unicorn in 7/9 round-robin
// matchups, so their profile deliberately retains the proven priority order.
export const SWARM_CONFLICT_CARD_ECONOMY: ConflictCardEconomyProfile = {
    ...DEFAULT_CONFLICT_CARD_ECONOMY,
    enabled: false
};

interface PlannedOption<T> {
    option: ConflictCardOption<T>;
    value: number;
    cost: number;
}

interface Plan<T> {
    options: PlannedOption<T>[];
    value: number;
    cost: number;
}

interface StrengthPlan<T> extends Plan<T> {
    contribution: number;
    priority: number;
}

function optionValue<T>(option: ConflictCardOption<T>, profile: ConflictCardEconomyProfile): number {
    const priority = Number.isFinite(option.priority) ? Math.max(0, option.priority) : 5;
    const contribution = option.contribution === null || !Number.isFinite(option.contribution)
        ? 0
        : Math.max(0, option.contribution);
    return priority * profile.priorityWeight +
        contribution * profile.contributionWeight +
        (option.abilityValue ? profile.abilityValueBonus : 0) +
        (priority >= profile.protectedPriority ? profile.protectedBonus : 0);
}

function deterministicKeys<T>(options: PlannedOption<T>[]): string {
    return options.map((entry) => entry.option.key).slice().sort().join('|');
}

function betterPlan<T>(candidate: Plan<T>, current: Plan<T> | undefined): boolean {
    if(!current || candidate.value !== current.value) {
        return !current || candidate.value > current.value;
    }
    if(candidate.cost !== current.cost) {
        return candidate.cost < current.cost;
    }
    if(candidate.options.length !== current.options.length) {
        return candidate.options.length > current.options.length;
    }
    return deterministicKeys(candidate.options).localeCompare(deterministicKeys(current.options)) < 0;
}

// A break plan is not a value-maximization plan. First avoid excess skill,
// then spend the fewest cards, then the least fate. Lower summed priority is a
// final tie-breaker so an equally-good plan preserves more important tricks.
function betterStrengthPlan<T>(candidate: StrengthPlan<T>, current: StrengthPlan<T> | undefined, target: number): boolean {
    if(!current) {
        return true;
    }
    const excessDiff = Math.max(candidate.contribution - target, 0) -
        Math.max(current.contribution - target, 0);
    if(excessDiff !== 0) {
        return excessDiff < 0;
    }
    if(candidate.options.length !== current.options.length) {
        return candidate.options.length < current.options.length;
    }
    if(candidate.cost !== current.cost) {
        return candidate.cost < current.cost;
    }
    if(candidate.priority !== current.priority) {
        return candidate.priority < current.priority;
    }
    return deterministicKeys(candidate.options).localeCompare(deterministicKeys(current.options)) < 0;
}

function strengthPlan<T>(
    legacy: ConflictCardOption<T>[],
    budget: number,
    requiredContribution: number,
    profile: ConflictCardEconomyProfile
): ConflictCardOption<T>[] | null {
    if(!profile.strengthBudgetEnabled || !Number.isFinite(requiredContribution)) {
        return null;
    }

    const target = Math.max(0, Math.ceil(requiredContribution));
    if(target === 0) {
        // A deck-specific strategic plan may keep an already-won action window
        // open. Preserve pure pumps there; utility/ability cards may continue.
        return legacy.filter((option) =>
            option.contribution === null || option.contribution <= 0 || option.abilityValue);
    }

    const candidates = legacy
        .filter((option) => option.contribution !== null && option.contribution > 0 &&
            option.cost !== undefined && Number.isFinite(option.cost) && option.cost >= 0)
        .map((option) => ({
            option,
            cost: Math.floor(option.cost!),
            contribution: Math.max(0, Math.floor(option.contribution!))
        }))
        .filter((entry) => entry.cost <= budget && entry.contribution > 0);
    if(candidates.reduce((total, entry) => total + entry.contribution, 0) < target) {
        return null;
    }

    let states = new Map<string, StrengthPlan<T>>();
    states.set('0|0', { options: [], value: 0, cost: 0, contribution: 0, priority: 0 });
    for(const candidate of candidates) {
        const next = new Map(states);
        for(const base of states.values()) {
            const cost = base.cost + candidate.cost;
            if(cost > budget) {
                continue;
            }
            const contribution = base.contribution + candidate.contribution;
            const plan: StrengthPlan<T> = {
                options: base.options.concat({
                    option: candidate.option,
                    value: 0,
                    cost: candidate.cost
                }),
                value: 0,
                cost,
                contribution,
                priority: base.priority + candidate.option.priority
            };
            const key = `${cost}|${contribution}`;
            const current = next.get(key);
            if(!current || betterStrengthPlan(plan, current, target)) {
                next.set(key, plan);
            }
        }
        states = next;
    }

    let best: StrengthPlan<T> | undefined;
    for(const plan of states.values()) {
        if(plan.contribution >= target && betterStrengthPlan(plan, best, target)) {
            best = plan;
        }
    }
    if(!best) {
        return null;
    }

    return best.options.map((entry) => entry.option).sort((a, b) => {
        const contributionDiff = (b.contribution || 0) - (a.contribution || 0);
        if(contributionDiff !== 0) {
            return contributionDiff;
        }
        const costDiff = (a.cost || 0) - (b.cost || 0);
        return costDiff !== 0 ? costDiff : a.legacyIndex - b.legacyIndex;
    });
}

/**
 * Return the whole planned purchase sequence, not merely its first card.
 * Unknown costs, and cards whose printed cost exceeds the live budget despite
 * being playable, preserve the caller's legacy order. Printed costs are
 * advisory and must never overrule engine legality.
 */
export function planConflictCards<T>(
    options: ConflictCardOption<T>[],
    availableFate: number,
    profile: ConflictCardEconomyProfile = DEFAULT_CONFLICT_CARD_ECONOMY,
    requiredContribution?: number | null
): ConflictCardOption<T>[] {
    const seen = new Set<string>();
    const legacy = options.slice()
        .sort((a, b) => a.legacyIndex - b.legacyIndex)
        // A recursively summarized card can occasionally appear through more
        // than one visible pile. Never let one UUID buy value twice.
        .filter((option) => {
            if(seen.has(option.key)) {
                return false;
            }
            seen.add(option.key);
            return true;
        });
    const budget = Math.max(0, Math.floor(availableFate));
    if(requiredContribution !== undefined && requiredContribution !== null && Number.isFinite(availableFate)) {
        const plannedStrength = strengthPlan(legacy, budget, requiredContribution, profile);
        if(plannedStrength) {
            return plannedStrength;
        }
    }
    if(!profile.enabled || legacy.length < 2 || !Number.isFinite(availableFate)) {
        return legacy;
    }

    const planned: PlannedOption<T>[] = [];
    for(const option of legacy) {
        if(option.cost === undefined || !Number.isFinite(option.cost) || option.cost < 0) {
            return legacy;
        }
        const cost = Math.floor(option.cost);
        // A card reported playable despite a printed cost above live fate is
        // using a reducer or alternate cost. Preserve its specialized order.
        if(cost > budget) {
            return legacy;
        }
        planned.push({ option, cost, value: optionValue(option, profile) });
    }

    const bestByBudget: Array<Plan<T> | undefined> = new Array(budget + 1);
    bestByBudget[0] = { options: [], value: 0, cost: 0 };
    for(const candidate of planned) {
        const previous = bestByBudget.slice();
        for(let spent = 0; spent <= budget; spent++) {
            const base = previous[spent];
            if(!base || spent + candidate.cost > budget) {
                continue;
            }
            const next: Plan<T> = {
                options: base.options.concat(candidate),
                value: base.value + candidate.value,
                cost: base.cost + candidate.cost
            };
            const target = spent + candidate.cost;
            if(betterPlan(next, bestByBudget[target])) {
                bestByBudget[target] = next;
            }
        }
    }

    let best: Plan<T> | undefined;
    for(const plan of bestByBudget) {
        if(plan && betterPlan(plan, best)) {
            best = plan;
        }
    }
    if(!best || best.options.length === 0) {
        return legacy;
    }

    const efficiency = (option: ConflictCardOption<T>) => {
        const cost = Math.max(option.cost || 0, profile.efficiencyCostFloor);
        return optionValue(option, profile) / cost;
    };
    return best.options.map((entry) => entry.option).sort((a, b) => {
        const efficiencyDiff = efficiency(b) - efficiency(a);
        if(efficiencyDiff !== 0) {
            return efficiencyDiff;
        }
        const valueDiff = optionValue(b, profile) - optionValue(a, profile);
        if(valueDiff !== 0) {
            return valueDiff;
        }
        const costDiff = (a.cost || 0) - (b.cost || 0);
        return costDiff !== 0 ? costDiff : a.legacyIndex - b.legacyIndex;
    });
}
