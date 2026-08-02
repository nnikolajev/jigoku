export const V2_PLANNER_STAGES = [
    'v1-fallback',
    'eligibility',
    'snapshot',
    'candidate-collection',
    'card-semantics',
    'deck-synergy',
    'intent',
    'resource-planning',
    'safety',
    'utility-scoring',
    'information',
    'terminal-solver',
    'tactical-search',
    'selection'
] as const;

export type V2PlannerStage = typeof V2_PLANNER_STAGES[number];

export interface V2PlannerProfilingTrace {
    readonly clock: 'monotonic';
    readonly stageOrder: readonly V2PlannerStage[];
    readonly stageDurationsMs: Readonly<Record<V2PlannerStage, number>>;
    readonly stageCalls: Readonly<Record<V2PlannerStage, number>>;
    readonly measuredMs: number;
    readonly cache: Readonly<Record<string, { readonly hits: number; readonly misses: number }>>;
}

type MonotonicClock = () => bigint;

function zeroRecord(): Record<V2PlannerStage, number> {
    return Object.fromEntries(V2_PLANNER_STAGES.map((stage) => [stage, 0])) as Record<V2PlannerStage, number>;
}

function milliseconds(nanoseconds: bigint): number {
    return Math.round(Number(nanoseconds) / 1_000) / 1_000;
}

/** Observational only: measurements never participate in selection or budgets. */
export default class PlannerProfiler {
    private readonly durations = zeroRecord();
    private readonly calls = zeroRecord();
    private readonly cache = new Map<string, { hits: number; misses: number }>();

    constructor(private readonly clock: MonotonicClock = () => process.hrtime.bigint()) {}

    measure<T>(stage: V2PlannerStage, operation: () => T): T {
        const startedAt = this.clock();
        try {
            return operation();
        } finally {
            this.calls[stage]++;
            this.durations[stage] += milliseconds(this.clock() - startedAt);
        }
    }

    recordCache(kind: string, hit: boolean): void {
        const counters = this.cache.get(kind) || { hits: 0, misses: 0 };
        if(hit) counters.hits++;
        else counters.misses++;
        this.cache.set(kind, counters);
    }

    trace(): V2PlannerProfilingTrace {
        const stageDurationsMs = Object.freeze({ ...this.durations });
        const stageCalls = Object.freeze({ ...this.calls });
        return Object.freeze({
            clock: 'monotonic' as const,
            stageOrder: V2_PLANNER_STAGES,
            stageDurationsMs,
            stageCalls,
            measuredMs: Math.round(Object.values(stageDurationsMs).reduce((sum, value) => sum + value, 0) * 1_000) / 1_000,
            cache: Object.freeze(Object.fromEntries([...this.cache.entries()].sort(([left], [right]) => left.localeCompare(right))
                .map(([kind, counters]) => [kind, Object.freeze({ ...counters })])))
        });
    }
}
