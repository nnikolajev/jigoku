const { candidateId } = require('../../../build/server/game/bots/v2/model/Candidate.js');
const { emptyLedgers } = require('../../../build/server/game/bots/v2/model/Ledgers.js');
const EffectSimulator = require('../../../build/server/game/bots/v2/search/EffectSimulator.js').default;
const TacticalSearch = require('../../../build/server/game/bots/v2/search/TacticalSearch.js').default;

describe('V2 tactical effect search', function() {
    function state(overrides = {}) {
        const scopes = { gameId: 'g', roundId: 'r1', phaseId: 'conflict', conflictId: 'c1' };
        const base = {
            schemaVersion: 1, perspectivePlayerId: 'Bot', informationMode: 'fair', scopes,
            phase: 'conflict', prompt: { kind: 'prompt', identity: 'action', title: 'Conflict Action Window', menu: 'Initiate an action' },
            promptControls: [],
            conflict: { id: 'c1', attackerId: 'Bot', defenderId: 'Opponent', type: 'military', ring: 'earth', provinceLocation: 'province 1', attackerSkill: 3, defenderSkill: 4, provinceStrength: 4, breakThreshold: 0 },
            players: {
                Bot: { id: 'Bot', fate: 3, honor: 8, conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: true },
                Opponent: { id: 'Opponent', fate: 3, honor: 8, conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: false }
            },
            characters: [
                { instanceId: 'bot-char', cardId: 'bot-char', controllerId: 'Bot', ownerId: 'Bot', location: 'play area', military: 3, political: 1, glory: 1, fate: 1, honored: false, dishonored: false, bowed: false, ready: true, participating: true, attacking: true, defending: false, conflictType: 'military', traits: [], attachments: [], canMove: true, canReady: true, noBowAfterConflict: false, canAttackMilitary: true, canAttackPolitical: true, attackRestrictions: [] },
                { instanceId: 'enemy-char', cardId: 'enemy-char', controllerId: 'Opponent', ownerId: 'Opponent', location: 'play area', military: 4, political: 2, glory: 1, fate: 1, honored: false, dishonored: false, bowed: false, ready: true, participating: true, attacking: false, defending: true, conflictType: 'military', traits: [], attachments: [], canMove: true, canReady: true, noBowAfterConflict: false, canAttackMilitary: true, canAttackPolitical: true, attackRestrictions: [] }
            ],
            provinces: [
                { controllerId: 'Opponent', location: 'province 1', visible: true, broken: false, inConflict: true, effectiveStrength: 4, holdingIds: [], attackEligible: true, stronghold: false },
                { controllerId: 'Opponent', location: 'stronghold province', visible: false, broken: false, inConflict: false, effectiveStrength: 7, holdingIds: [], attackEligible: false, stronghold: true },
                { controllerId: 'Bot', location: 'stronghold province', visible: false, broken: false, inConflict: false, effectiveStrength: 7, holdingIds: [], attackEligible: false, stronghold: true }
            ],
            rings: ['air', 'earth', 'fire', 'void', 'water'].map((element) => ({ element, fate: 0, contested: element === 'earth', selectable: true })),
            hands: [
                { playerId: 'Bot', size: 4, exact: true, cards: [] },
                { playerId: 'Opponent', size: 4, exact: false, cards: [] }
            ],
            opportunities: { remainingByPlayer: { Bot: { military: 1, political: 1 }, Opponent: { military: 1, political: 1 } }, totalRemaining: 4 },
            resources: { fateByPlayer: { Bot: 3, Opponent: 3 }, honorByPlayer: { Bot: 8, Opponent: 8 }, handSizeByPlayer: { Bot: 4, Opponent: 4 }, conflictDeckByPlayer: { Bot: 20, Opponent: 20 } },
            board: { readySkillByPlayer: { Bot: { military: 3, political: 1 }, Opponent: { military: 4, political: 2 } }, participatingSkillByPlayer: { Bot: 3, Opponent: 4 } },
            ledgers: emptyLedgers(scopes), materialStateSignature: 'root'
        };
        return { ...base, ...overrides };
    }

    function candidate(name, options = {}) {
        const commandPreview = { command: options.command || 'cardClicked', args: [name], target: options.target || name };
        const value = {
            kind: options.kind || 'conflict-card', source: options.source,
            mode: options.mode, targets: options.targets || [], commandPreview,
            costs: options.costs || {}, effects: options.effects || [], prerequisites: [],
            tags: options.tags || [], limits: options.limits || [], uncertainty: options.uncertainty || 0,
            confidence: options.confidence ?? 1, proposer: options.proposer || 'fixture'
        };
        return { ...value, id: candidateId(value) };
    }

    const pass = (actor = 'Opponent') => candidate(`pass:${actor}`, { kind: 'pass', command: 'menuButton', target: 'Pass' });

    it('applies effects and costs to immutable copied state only', function() {
        const original = state();
        const action = candidate('pump', {
            costs: { fate: 1, cards: 1 }, targets: [{ kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' }],
            effects: [{ kind: 'skill', military: 2, duration: 'conflict', target: { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' } }]
        });
        const result = new EffectSimulator().apply(original, action);
        expect(result.state).not.toBe(original);
        expect(result.state.players.Bot.fate).toBe(2);
        expect(result.state.hands[0].size).toBe(3);
        expect(result.state.characters.find((entry) => entry.instanceId === 'bot-char').military).toBe(5);
        expect(result.state.conflict.attackerSkill).toBe(5);
        expect(original.players.Bot.fate).toBe(3);
        expect(original.characters[0].military).toBe(3);
        expect(Object.isFrozen(result.state)).toBeTrue();
    });

    it('prunes dominated actions while retaining deterministic strategic diversity', function() {
        const search = new TacticalSearch();
        const target = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const cheap = candidate('cheap', { targets: [target], costs: { fate: 0 }, effects: [{ kind: 'skill', military: 2, target }] });
        const expensive = candidate('expensive', { targets: [target], costs: { fate: 2 }, effects: [{ kind: 'skill', military: 2, target }] });
        const ready = candidate('ready', { tags: ['ready'], effects: [{ kind: 'ready', target }] });
        const first = search.prescore(state(), [expensive, ready, cheap], {}, { beamWidth: 1, maxCandidates: 3 });
        const second = search.prescore(state(), [cheap, expensive, ready], {}, { beamWidth: 1, maxCandidates: 3 });
        expect(first.map((entry) => entry.candidate.id)).toEqual(second.map((entry) => entry.candidate.id));
        expect(first.map((entry) => entry.candidate.id)).toContain(cheap.id);
        expect(first.map((entry) => entry.candidate.id)).toContain(ready.id);
        expect(first.map((entry) => entry.candidate.id)).not.toContain(expensive.id);
    });

    it('finds setup/payoff and reducer/attachment lines that are not initially affordable', function() {
        const search = new TacticalSearch();
        const lowFate = state({
            players: { ...state().players, Bot: { ...state().players.Bot, fate: 1 } },
            resources: { ...state().resources, fateByPlayer: { Bot: 1, Opponent: 3 } }
        });
        const setup = candidate('gain-fate', { tags: ['setup'], effects: [{ kind: 'resource', fate: 2 }] });
        const payoff = candidate('large-payoff', { costs: { fate: 3 }, tags: ['payoff'], effects: [{ kind: 'skill', military: 6 }] });
        const setupResult = search.search(lowFate, [setup, payoff], {}, {
            limits: { depth: 3, nodeBudget: 30 }, responseProvider: () => [pass()]
        });
        expect(setupResult.complete).toBeTrue();
        expect(setupResult.principalLine.map((step) => step.candidateId)).toContain(payoff.id);

        const reducer = candidate('reducer', { tags: ['setup', 'reducer'], effects: [{ kind: 'reduction', amount: 1, costType: 'fate', appliesTo: 'attachment' }] });
        const attachment = candidate('tower-attachment', { costs: { fate: 2 }, tags: ['attachment', 'payoff'], effects: [{ kind: 'attachment', cardId: 'tower-attachment' }, { kind: 'skill', military: 5, duration: 'while-attached' }] });
        const reducerResult = search.search(lowFate, [reducer, attachment], {}, {
            limits: { depth: 3, nodeBudget: 30 }, responseProvider: () => [pass()]
        });
        expect(reducerResult.complete).toBeTrue();
        expect(reducerResult.principalLine[0].candidateId).toBe(reducer.id);
        expect(reducerResult.principalLine.map((step) => step.candidateId)).toContain(attachment.id);
    });

    it('chooses the minimum sufficient stable response and accounts for pass pressure', function() {
        const search = new TacticalSearch();
        const target = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const enough = candidate('enough', { targets: [target], effects: [{ kind: 'skill', military: 2, target }] });
        const excess = candidate('excess', { targets: [target], effects: [{ kind: 'skill', military: 6, target }] });
        const risky = candidate('risky', { targets: [target], uncertainty: 0.8, effects: [{ kind: 'skill', military: 2, target }] });
        const threatTarget = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const threat = candidate('opponent-bow', { targets: [threatTarget], effects: [{ kind: 'bow', target: threatTarget }] });
        const result = search.search(state(), [risky, excess, enough], {}, {
            limits: { depth: 2, nodeBudget: 30 }, responseProvider: () => [pass(), threat]
        });
        expect(result.firstCandidate.id).toBe(enough.id);
        expect(result.principalLine[1].candidateId).toBe(threat.id);
        expect(result.searchNodes.length).toBe(result.searchedNodes);
        expect(result.rootEvaluations[0].candidateId).toBe(result.firstCandidate.id);
        expect(result.rootEvaluations.every((entry, index, rows) =>
            index === 0 || rows[index - 1].utility >= entry.utility)).toBeTrue();
    });

    it('falls back on deterministic node-budget exhaustion instead of executing an incomplete line', function() {
        const search = new TacticalSearch();
        const actions = [1, 2, 3].map((amount) => candidate(`pump:${amount}`, { effects: [{ kind: 'skill', military: amount }] }));
        const result = search.search(state(), actions, {}, {
            limits: { depth: 4, beamWidth: 3, nodeBudget: 1 }, responseProvider: () => [pass(), pass('Opponent:2')]
        });
        expect(result.complete).toBeFalse();
        expect(result.exhausted).toBeTrue();
        expect(result.reason).toBe('budget-exhausted');
        expect(result.searchedNodes).toBe(1);
        expect(result.searchNodes.length).toBe(1);
    });

    it('prefers a stable sufficient line when the larger play exposes a cancel response', function() {
        const search = new TacticalSearch();
        const target = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const stable = candidate('stable-pump', { targets: [target], effects: [{ kind: 'skill', military: 2, target }] });
        const exposed = candidate('large-event', { targets: [target], effects: [{ kind: 'skill', military: 4, target }] });
        const cancel = candidate('known-cancel', { kind: 'interrupt', tags: ['cancel'], effects: [{ kind: 'cancel', event: 'large-event' }] });
        const result = search.search(state(), [exposed, stable], {}, {
            limits: { depth: 2, nodeBudget: 20 },
            responseProvider: (projected) => projected.conflict.attackerSkill > 5 ? [cancel] : [pass()]
        });
        expect(result.firstCandidate.id).toBe(stable.id);
        expect(result.principalLine[1].candidateKind).toBe('pass');
    });

    it('uses stable principal-line ordering for identical tactical inputs', function() {
        const search = new TacticalSearch();
        const actions = [candidate('alpha', { effects: [{ kind: 'skill', military: 2 }] }), candidate('beta', { effects: [{ kind: 'ready' }] })];
        const options = { limits: { depth: 3, nodeBudget: 30 }, responseProvider: () => [pass()] };
        const first = search.search(state(), actions, {}, options);
        const second = search.search(state(), [...actions].reverse(), {}, options);
        expect(first.firstCandidate.id).toBe(second.firstCandidate.id);
        expect(first.principalLine).toEqual(second.principalLine);
    });
});
