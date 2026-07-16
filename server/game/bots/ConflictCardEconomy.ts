// Shared conflict-card spending planner.
//
// The engine remains the authority on whether a card is currently playable.
// This module only sequences already-legal cards: it maximizes the combined
// value that fits in the bot's live fate pool, then plays the most efficient
// member of that plan first. Priority 9-10 cards receive an explicit premium
// so important, expensive answers are not crowded out by cheap filler.

export interface ConflictCardEconomyProfile {
    enabled: boolean;
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

/**
 * Return the whole planned purchase sequence, not merely its first card.
 * Unknown costs, and cards whose printed cost exceeds the live budget despite
 * being playable, preserve the caller's legacy order. Printed costs are
 * advisory and must never overrule engine legality.
 */
export function planConflictCards<T>(
    options: ConflictCardOption<T>[],
    availableFate: number,
    profile: ConflictCardEconomyProfile = DEFAULT_CONFLICT_CARD_ECONOMY
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
    if(!profile.enabled || legacy.length < 2 || !Number.isFinite(availableFate)) {
        return legacy;
    }

    const budget = Math.max(0, Math.floor(availableFate));
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
