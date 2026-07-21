'use strict';

const {
    TYPES,
    analyzeRegret,
    extractTraceEntries,
    parseArgs,
    renderMarkdown
} = require('../../../tools/selfplay/auditBotRegret.js');

describe('V2 regret audit', function() {
    function replay(stateSignature) {
        return {
            planningState: { schemaVersion: 1, materialStateSignature: stateSignature },
            candidateIds: ['pass', 'impact'],
            configuration: { engineVersion: 'v2', strategySeed: 1, informationMode: 'fair' }
        };
    }

    it('parses repeatable inputs and bounded replay output', function() {
        const options = parseArgs([
            '--input', 'one.json', '--input', 'two.json', '--minimum-cost', '2', '--replay-limit', '4'
        ]);
        expect(options.inputs.length).toBe(2);
        expect(options.minimumCost).toBe(2);
        expect(options.replayLimit).toBe(4);
        expect(() => parseArgs([])).toThrowError(/input/);
    });

    it('extracts nested controller and comparison trace entries once', function() {
        const entry = { command: 'menuButton', selectedBy: 'fallback', planner: { stateSignature: 's' } };
        expect(extractTraceEntries({ samples: [{ v2Overrides: [entry] }], also: entry })).toEqual([entry]);
    });

    it('groups tactical regret patterns with confidence, limitations, cost, and deterministic replays', function() {
        const first = {
            player: 'Bot', promptTitle: 'Conflict Action Window', target: 'Pass', selectedBy: 'fallback',
            informationMode: 'fair', fallbackReason: 'below-v2-confidence-gate', planner: {
                stateSignature: 's1', promptFingerprint: 'p1', intentId: 'intent:win', chosenCandidateId: 'pass',
                disagreementType: 'uncertain', scoreGap: 5,
                information: { certainty: 0.4, handHypotheses: 3, responsePackages: 2 },
                terminal: { active: true, status: 'forced-win', selectedCandidateId: 'impact' },
                candidates: [
                    { id: 'pass', kind: 'pass', score: 0, tags: [], costs: {}, effectKinds: [], vetoes: [] },
                    { id: 'impact', kind: 'conflict-card', score: 5, tags: ['offense', 'payoff'], costs: { fate: 1 }, effectKinds: ['skill'], vetoes: [] },
                    { id: 'duplicate', kind: 'conflict-card', score: 2, tags: [], costs: {}, effectKinds: ['prevention'], vetoes: [{ code: 'duplicate-effect-target', reason: 'already applied' }] }
                ],
                replay: replay('s1')
            }
        };
        const second = {
            player: 'Bot', promptTitle: 'Next action', selectedBy: 'v2', informationMode: 'omniscient', planner: {
                stateSignature: 's2', promptFingerprint: 'p2', intentId: 'intent:new', chosenCandidateId: 'expensive',
                intentInvalidation: 'opponent-disruption', runnerUpCandidateId: 'cheap', runnerUpGap: 0.5,
                candidates: [
                    { id: 'expensive', kind: 'conflict-card', score: 4, tags: ['offense'], costs: { fate: 3 }, effectKinds: ['skill'], vetoes: [{ code: 'honor-floor', reason: 'fixture reserve' }] },
                    { id: 'cheap', kind: 'conflict-card', score: 3.5, tags: ['offense'], costs: {}, effectKinds: ['skill'], vetoes: [] }
                ],
                replay: replay('s2')
            }
        };

        const report = analyzeRegret([first, second], { replayLimit: 10 });
        const foundTypes = new Set(report.findings.map((entry) => entry.type));
        for(const expected of ['undercommit', 'overcommit', 'missed-terminal', 'unused-impact',
            'duplicate-effect', 'broken-reserve', 'plan-churn', 'threat-estimation']) {
            expect(foundTypes).withContext(expected).toContain(expected);
        }
        expect(report.groups.map((entry) => entry.type).sort()).toEqual([...TYPES].sort());
        expect(report.findings.every((entry) => entry.confidence.label && entry.limitations.length > 0)).toBeTrue();
        expect(report.replays.length).toBe(2);
        expect(analyzeRegret([first, second], { replayLimit: 10 }).replays).toEqual(report.replays);
        expect(renderMarkdown(report)).toContain('Priorities');
    });
});
