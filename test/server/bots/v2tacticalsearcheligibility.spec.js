const TacticalSearchEligibility = require('../../../build/server/game/bots/v2/search/TacticalSearchEligibility.js').default;

describe('V2 live tactical search eligibility', function() {
    const state = {
        perspectivePlayerId: 'Bot', phase: 'conflict',
        conflict: { id: 'c', attackerId: 'Bot', defenderId: 'Opponent', attackerSkill: 3, defenderSkill: 4, breakThreshold: 1 },
        players: { Bot: { fate: 2 }, Opponent: { fate: 2 } }
    };
    const planning = { eligible: true, reason: 'source-action-window', promptClass: 'conflict', terminalRisk: false };
    const candidate = (id, options = {}) => ({
        id, kind: options.kind || 'conflict-card', targets: options.targets || [{ kind: 'character', instanceId: 'bot', controllerId: 'Bot' }],
        commandPreview: { command: 'cardClicked', args: [id], target: id }, costs: {},
        effects: options.effects || [{ kind: 'skill', military: 2, confidence: 0.95,
            target: { kind: 'character', instanceId: 'bot', controllerId: 'Bot' } }],
        prerequisites: [], tags: [], limits: [], uncertainty: 0.05,
        confidence: options.confidence ?? 0.95, proposer: 'fixture'
    });

    it('enables only bounded high-confidence semantic conflict actions', function() {
        const eligibility = new TacticalSearchEligibility();
        const result = eligibility.evaluate(state, planning, [
            candidate('pass', { kind: 'pass', effects: [] }), candidate('semantic')
        ], [candidate('response')], 'enabled');
        expect(result).toEqual(jasmine.objectContaining({
            eligible: true, reason: 'bounded-semantic-response-search'
        }));
        expect(result.limits).toEqual(jasmine.objectContaining({ depth: 4, maxCandidates: 8, nodeBudget: 12288, elapsedMs: 10000 }));

        expect(eligibility.evaluate(state, planning, [candidate('uncertain', { confidence: 0.7 })], [], 'enabled'))
            .toEqual(jasmine.objectContaining({ eligible: false, reason: 'no-high-confidence-semantic-action' }));
        expect(eligibility.evaluate({ ...state, conflict: undefined }, planning, [candidate('semantic')], [], 'enabled'))
            .toEqual(jasmine.objectContaining({ eligible: false, reason: 'not-conflict-action-position' }));
        expect(eligibility.evaluate(state, { ...planning, reason: 'terminal-risk' }, [candidate('semantic')], [], 'enabled'))
            .toEqual(jasmine.objectContaining({ eligible: false, reason: 'not-conflict-action-position' }));
        expect(eligibility.evaluate(state, planning, [candidate('untargeted', { targets: [], effects: [{ kind: 'skill', military: 2 }] })], [], 'enabled'))
            .toEqual(jasmine.objectContaining({ eligible: false, reason: 'no-high-confidence-semantic-action' }));
    });

    it('deterministically narrows broad roots and leaves coherent response breadth to scenario search', function() {
        const eligibility = new TacticalSearchEligibility();
        const roots = Array.from({ length: 9 }, (_, index) => candidate(`root:${index}`));
        expect(eligibility.evaluate(state, planning, roots, [], 'enabled'))
            .toEqual(jasmine.objectContaining({
                eligible: true, reason: 'bounded-root-preselection',
                limits: jasmine.objectContaining({ maxCandidates: 8, nodeBudget: 12288 })
            }));
        const responses = Array.from({ length: 9 }, (_, index) => candidate(`response:${index}`));
        expect(eligibility.evaluate(state, planning, [candidate('semantic')], responses, 'enabled'))
            .toEqual(jasmine.objectContaining({ eligible: true, reason: 'bounded-semantic-response-search' }));
        expect(eligibility.evaluate(state, planning, [candidate('semantic')], [
            candidate('unknown-response', { effects: [] })
        ], 'enabled')).toEqual(jasmine.objectContaining({ eligible: false, reason: 'unprojectable-response' }));
    });

    it('treats a validated pass as an exact opponent response', function() {
        const eligibility = new TacticalSearchEligibility();
        const pass = candidate('response-pass', { kind: 'pass', effects: [], targets: [] });
        pass.commandPreview = { command: 'menuButton', args: ['pass', 'prompt'], target: 'Pass' };

        expect(eligibility.evaluate(state, planning, [candidate('semantic')], [pass], 'enabled'))
            .toEqual(jasmine.objectContaining({
                eligible: true,
                reason: 'bounded-semantic-response-search'
            }));
    });

    it('separates fair hypothesis weight from response effect reliability', function() {
        const eligibility = new TacticalSearchEligibility();
        const unlikelyExactPump = candidate('unlikely-exact-pump', { confidence: 0.2 });
        unlikelyExactPump.uncertainty = 0.8;
        expect(eligibility.evaluate(state, planning, [candidate('semantic')], [unlikelyExactPump], 'enabled'))
            .toEqual(jasmine.objectContaining({ eligible: true }));

        const approximateRemoval = candidate('approximate-removal', {
            confidence: 0.9,
            effects: [{ kind: 'remove', method: 'discard', confidence: 0.7,
                target: { kind: 'character', instanceId: 'bot', controllerId: 'Bot' } }]
        });
        expect(eligibility.evaluate(state, planning, [candidate('semantic')], [approximateRemoval], 'enabled'))
            .toEqual(jasmine.objectContaining({ eligible: false, reason: 'unprojectable-response' }));
    });
});
