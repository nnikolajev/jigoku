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

    it('removes an exact attachment and its printed skill without mutating the live projection', function() {
        const original = state();
        original.characters[1] = {
            ...original.characters[1],
            military: 6,
            attachments: [{
                instanceId: 'enemy-katana', cardId: 'fine-katana', controllerId: 'Opponent', fate: 0,
                militaryBonus: 2, politicalBonus: 0, printedCost: 0, nonStackingKeys: []
            }]
        };
        original.conflict = { ...original.conflict, defenderSkill: 6 };
        const target = {
            kind: 'card', instanceId: 'enemy-katana', cardId: 'fine-katana',
            controllerId: 'Opponent', location: 'play area'
        };
        const action = candidate('let-go', {
            targets: [target], costs: { cards: 1 },
            effects: [{ kind: 'remove', method: 'discard', target, confidence: 1 }]
        });

        const result = new EffectSimulator().apply(original, action);
        const enemy = result.state.characters.find((entry) => entry.instanceId === 'enemy-char');

        expect(enemy.military).toBe(4);
        expect(enemy.attachments).toEqual([]);
        expect(result.state.conflict.defenderSkill).toBe(4);
        expect(result.appliedEffectKinds).toContain('remove');
        expect(original.characters[1].military).toBe(6);
        expect(original.characters[1].attachments.length).toBe(1);
    });

    it('applies a province effect only to its exact controller target', function() {
        const original = state();
        const target = { kind: 'province', controllerId: 'Opponent', location: 'stronghold province' };
        const action = candidate('break-opponent-stronghold', {
            targets: [target],
            effects: [{ kind: 'province', location: 'stronghold province', break: true }]
        });

        const result = new EffectSimulator().apply(original, action);

        expect(result.state.provinces.find((entry) => entry.controllerId === 'Opponent' && entry.stronghold).broken).toBeTrue();
        expect(result.state.provinces.find((entry) => entry.controllerId === 'Bot' && entry.stronghold).broken).toBeFalse();
        expect(result.state.players.Opponent.brokenProvinceCount).toBe(1);
        expect(result.state.players.Bot.brokenProvinceCount).toBe(0);
    });

    it('prunes dominated actions while retaining deterministic strategic diversity', function() {
        const search = new TacticalSearch();
        const target = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const cheap = candidate('cheap', { targets: [target], costs: { fate: 0 }, effects: [{ kind: 'skill', military: 2, target }] });
        const expensive = candidate('expensive', { targets: [target], costs: { fate: 2 }, effects: [{ kind: 'skill', military: 2, target }] });
        const enemy = { kind: 'character', instanceId: 'enemy-char', controllerId: 'Opponent' };
        const ready = candidate('control', { tags: ['control'], targets: [enemy], effects: [{ kind: 'bow', target: enemy }] });
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

    it('does not replay another semantic variant of a consumed physical hand card', function() {
        const search = new TacticalSearch();
        const source = { kind: 'card', instanceId: 'court-games-copy', cardId: 'court-games', controllerId: 'Bot', location: 'hand' };
        const enemy = { kind: 'character', instanceId: 'enemy-char', controllerId: 'Opponent' };
        const own = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const dishonor = candidate('court-games-dishonor', {
            source, targets: [enemy], costs: { cards: 1 }, tags: ['payoff'],
            effects: [{ kind: 'status', status: 'dishonored', target: enemy }]
        });
        const honor = candidate('court-games-honor', {
            source, targets: [own], costs: { cards: 1 }, tags: ['payoff'],
            effects: [{ kind: 'status', status: 'honored', target: own }]
        });
        const result = search.search(state(), [dishonor, honor], {}, {
            limits: { depth: 3, nodeBudget: 30 }, responseProvider: () => [pass()]
        });

        expect(result.principalLine.filter((step) =>
            step.candidateId === dishonor.id || step.candidateId === honor.id).length).toBe(1);
    });

    it('does not project a duplicate status payoff from a second physical copy', function() {
        const search = new TacticalSearch();
        const enemy = { kind: 'character', instanceId: 'enemy-char', controllerId: 'Opponent' };
        const courtGames = (copy) => candidate(`court-games:${copy}`, {
            source: { kind: 'card', instanceId: copy, cardId: 'court-games', controllerId: 'Bot', location: 'hand' },
            targets: [enemy], costs: { cards: 1 }, tags: ['payoff'],
            effects: [{ kind: 'status', status: 'dishonored', target: enemy }]
        });
        const copies = [courtGames('copy-1'), courtGames('copy-2')];
        const result = search.search(state(), copies, {}, {
            limits: { depth: 3, nodeBudget: 30 }, responseProvider: () => [pass()]
        });

        expect(result.principalLine.filter((step) => copies.some((entry) => entry.id === step.candidateId)).length).toBe(1);
    });

    it('does not reuse an exhausted semantic usage limit in projected search', function() {
        const search = new TacticalSearch();
        const limited = candidate('round-limited-ready', {
            effects: [{ kind: 'resource', fate: 1 }],
            limits: [{ key: 'round-limited-ready', scope: 'round', maximum: 1 }]
        });
        const secondSource = candidate('round-limited-ready:copy', {
            effects: [{ kind: 'resource', fate: 1 }],
            limits: [{ key: 'round-limited-ready', scope: 'round', maximum: 1 }]
        });
        const result = search.search(state(), [limited, secondSource], {}, {
            limits: { depth: 3, nodeBudget: 30 }, responseProvider: () => [pass()]
        });

        expect(result.principalLine.filter((step) =>
            step.candidateId === limited.id || step.candidateId === secondSource.id).length).toBe(1);
    });

    it('uses semantic root ordering when runtime card UUIDs change', function() {
        const search = new TacticalSearch();
        const run = (prefix) => {
            const alpha = candidate(`${prefix}-alpha-runtime`, {
                target: 'Alpha Action', tags: ['offense'],
                source: { kind: 'card', instanceId: `${prefix}-alpha-runtime`, cardId: 'alpha-action', controllerId: 'Bot', location: 'hand' }
            });
            const beta = candidate(`${prefix}-beta-runtime`, {
                target: 'Beta Action', tags: ['defense'],
                source: { kind: 'card', instanceId: `${prefix}-beta-runtime`, cardId: 'beta-action', controllerId: 'Bot', location: 'hand' }
            });
            return search.search(state(), [beta, alpha], {}, { limits: { depth: 1, nodeBudget: 10 } });
        };

        const first = run('uuid-z').firstCandidate.source.cardId;
        expect(run('uuid-a').firstCandidate.source.cardId).toBe(first);
        expect(['alpha-action', 'beta-action']).toContain(first);
    });

    it('evaluates coherent response scenarios separately and keeps the pessimistic root result', function() {
        const search = new TacticalSearch();
        const target = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const enough = candidate('enough', { targets: [target], effects: [{ kind: 'skill', military: 2, target }] });
        const excess = candidate('excess', { targets: [target], effects: [{ kind: 'skill', military: 6, target }] });
        const threat = candidate('opponent-bow', { targets: [target], effects: [{ kind: 'bow', target }] });
        const result = search.searchScenarios(state(), [excess, enough], [
            { id: 'hand:pass', candidates: [pass()] },
            { id: 'hand:bow', candidates: [pass(), threat] }
        ], {}, { limits: { depth: 2, beamWidth: 4, maxCandidates: 4, nodeBudget: 100 } });

        expect(result.complete).toBeTrue();
        expect(result.firstCandidate.id).toBe(enough.id);
        expect(result.rootEvaluations.every((entry) => entry.responseScenarioId)).toBeTrue();
        expect(result.searchedNodes).toBeGreaterThan(0);
        expect(result.reason).toBe('complete');
    });
});
