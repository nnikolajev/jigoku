const PlannerProfiler = require('../../../build/server/game/bots/v2/tracing/PlannerProfiler.js').default;
const { V2_PLANNER_STAGES } = require('../../../build/server/game/bots/v2/tracing/PlannerProfiler.js');

describe('V2 planner profiler', function() {
    it('records fixed-order, immutable stage timings without using them for control flow', function() {
        const ticks = [0n, 1_500_000n, 2_000_000n, 5_250_000n];
        const profiler = new PlannerProfiler(() => ticks.shift());

        expect(profiler.measure('snapshot', () => 'snapshot-result')).toBe('snapshot-result');
        expect(profiler.measure('utility-scoring', () => 7)).toBe(7);

        const trace = profiler.trace();
        expect(trace.stageOrder).toEqual(V2_PLANNER_STAGES);
        expect(trace.stageDurationsMs.snapshot).toBe(1.5);
        expect(trace.stageDurationsMs['utility-scoring']).toBe(3.25);
        expect(trace.stageCalls.snapshot).toBe(1);
        expect(trace.stageCalls['candidate-collection']).toBe(0);
        expect(trace.measuredMs).toBe(4.75);
        expect(Object.isFrozen(trace)).toBeTrue();
        expect(Object.isFrozen(trace.stageDurationsMs)).toBeTrue();
    });

    it('records failed stages before rethrowing planner errors', function() {
        const ticks = [10n, 2_000_010n];
        const profiler = new PlannerProfiler(() => ticks.shift());

        expect(() => profiler.measure('terminal-solver', () => { throw new Error('fixture failure'); }))
            .toThrowError('fixture failure');
        expect(profiler.trace().stageDurationsMs['terminal-solver']).toBe(2);
        expect(profiler.trace().stageCalls['terminal-solver']).toBe(1);
    });
});
