const HighConfidenceOverridePolicy =
    require('../../../build/server/game/bots/v2/HighConfidenceOverridePolicy.js').default;

// Contract tests for the experimental autonomous-policy gate flag
// (highConfidenceGate.allowAutonomousPolicy). Default off; when on it accepts
// the top-scored candidate for execution-safe single-command kinds only, after
// the fixed confidence and score-advantage floors, and never for macros or
// participant sets. Keeps the slice from being silently re-enabled or widened.
describe('V2 autonomous-policy override gate', function() {
    const policy = new HighConfidenceOverridePolicy();

    function candidate(overrides = {}) {
        return {
            id: 'candidate:bid:x', kind: 'bid', targets: [],
            commandPreview: { command: 'menuButton', args: ['3'], target: '3' },
            costs: {}, effects: [], prerequisites: [], tags: [], limits: [],
            uncertainty: 0, confidence: 1, proposer: 'generic', ...overrides
        };
    }

    function input(overrides = {}) {
        return {
            state: { characters: [], players: {}, perspectivePlayerId: 'Bot', hands: [],
                opportunities: { remainingByPlayer: {} }, conflict: undefined },
            preference: { candidate: candidate(overrides.candidate), score: { scalar: 12, terminalRank: 1 } },
            v1Candidate: { ...candidate(), id: 'candidate:bid:v1',
                commandPreview: { command: 'menuButton', args: ['5'], target: '5' } },
            scoreGap: 5,
            v1Vetoes: [],
            terminal: undefined,
            search: { complete: false, exhausted: false, firstCandidate: undefined, principalLine: [] },
            candidates: [],
            profile: { allowAutonomousPolicy: true },
            ...overrides
        };
    }

    it('accepts a divergent single-command candidate when the flag is on', function() {
        const proof = policy.evaluate(input());
        expect(proof.accepted).toBe(true);
        expect(proof.reason).toBe('autonomous-policy');
    });

    it('falls back when the flag is off (default behavior unchanged)', function() {
        const proof = policy.evaluate(input({ profile: {} }));
        expect(proof.accepted).toBe(false);
        expect(proof.evidence).toContain('no-fixture-proven-override');
    });

    it('never applies to macro candidates', function() {
        const proof = policy.evaluate(input({
            candidate: { macro: { currentStep: 0, steps: [
                { id: 's', kind: 'confirmation', command: 'menuButton', args: [], semanticValue: 'done' }
            ] } }
        }));
        expect(proof.reason).not.toBe('autonomous-policy');
    });

    it('never applies to kinds outside the execution-safe set', function() {
        const proof = policy.evaluate(input({
            candidate: { kind: 'dynasty-purchase', id: 'candidate:dynasty-purchase:x' }
        }));
        expect(proof.accepted).toBe(false);
        expect(proof.reason).not.toBe('autonomous-policy');
    });

    it('respects the score-advantage floor before diverging', function() {
        const proof = policy.evaluate(input({ scoreGap: 2 }));
        expect(proof.accepted).toBe(false);
        expect(proof.evidence[0]).toContain('score-gap');
    });

    it('respects the confidence floor before diverging', function() {
        const proof = policy.evaluate(input({ candidate: { confidence: 0.5 } }));
        expect(proof.accepted).toBe(false);
        expect(proof.evidence[0]).toContain('confidence');
    });

    it('does not override a byte-identical command with autonomous divergence', function() {
        const proof = policy.evaluate(input({
            v1Candidate: { ...candidate(), id: 'candidate:bid:v1' }
        }));
        expect(proof.accepted).toBe(true);
        expect(proof.reason).toBe('semantic-agreement');
    });

    it('honors an explicit autonomousKinds allow-list', function() {
        const proof = policy.evaluate(input({
            candidate: { kind: 'ring-choice', id: 'candidate:ring-choice:x' },
            profile: { allowAutonomousPolicy: true, autonomousKinds: ['bid'] }
        }));
        expect(proof.reason).not.toBe('autonomous-policy');
    });
});
