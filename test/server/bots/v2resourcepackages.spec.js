const { emptyLedgers } = require('../../../build/server/game/bots/v2/model/Ledgers.js');
const ResourcePackagePlanner = require('../../../build/server/game/bots/v2/resources/ResourcePackagePlanner.js').default;
const { ARCHETYPE_RESOURCE_PROFILES } = require('../../../build/server/game/bots/v2/resources/ResourcePackagePlanner.js');
const SafetyVetoPipeline = require('../../../build/server/game/bots/v2/SafetyVetoPipeline.js').default;

describe('V2 joint resource package planning', function() {
    function state(options = {}) {
        const scopes = { gameId: 'g', roundId: '2', phaseId: options.phase || 'dynasty', conflictId: options.conflict ? 'c' : undefined };
        return {
            schemaVersion: 1, perspectivePlayerId: 'Bot', informationMode: 'fair', scopes,
            phase: options.phase || 'dynasty', prompt: { kind: 'prompt', identity: 'p', title: '', menu: '' }, promptControls: [],
            conflict: options.conflict ? {
                id: 'c', attackerId: options.attackerId || 'Opponent', defenderId: options.defenderId || 'Bot',
                type: 'military', provinceLocation: options.stronghold ? 'stronghold province' : 'province 1',
                attackerSkill: 6, defenderSkill: 2, provinceStrength: options.stronghold ? 7 : 4, breakThreshold: options.stronghold ? 7 : 4
            } : undefined,
            players: {
                Bot: { id: 'Bot', fate: options.fate ?? 5, honor: options.honor ?? 8, conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: options.firstPlayer ?? false },
                Opponent: { id: 'Opponent', fate: 3, honor: 8, conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: !options.firstPlayer }
            },
            characters: options.characters || [],
            provinces: [
                { controllerId: 'Bot', location: 'stronghold province', visible: false, broken: false, inConflict: options.stronghold || false, effectiveStrength: 7, holdingIds: [], attackEligible: false, stronghold: true },
                { controllerId: 'Opponent', location: 'province 1', visible: true, broken: false, inConflict: false, effectiveStrength: 4, holdingIds: [], attackEligible: true, stronghold: false }
            ],
            rings: [{ element: 'earth', fate: options.ringFate || 0, contested: false, selectable: true }],
            hands: [{ playerId: 'Bot', size: options.handSize || 5, exact: true, cards: [] }, { playerId: 'Opponent', size: 4, exact: false, cards: [] }],
            opportunities: { remainingByPlayer: { Bot: { military: 1, political: 1 }, Opponent: { military: 1, political: 1 } }, totalRemaining: 4 },
            resources: { fateByPlayer: { Bot: options.fate ?? 5, Opponent: 3 }, honorByPlayer: { Bot: options.honor ?? 8, Opponent: 8 }, handSizeByPlayer: { Bot: options.handSize || 5, Opponent: 4 }, conflictDeckByPlayer: { Bot: 20, Opponent: 20 } },
            board: { readySkillByPlayer: {}, participatingSkillByPlayer: {} }, ledgers: emptyLedgers(scopes), materialStateSignature: 'resources'
        };
    }

    function candidate(id, kind, options = {}) {
        return {
            id, kind,
            source: { kind: 'card', instanceId: options.instanceId || `instance:${id}`, cardId: options.cardId || id, controllerId: 'Bot', location: options.location || (kind === 'dynasty-purchase' ? 'province 1' : 'hand') },
            mode: options.mode, targets: [], commandPreview: { command: 'cardClicked', args: [id], target: id },
            costs: options.costs || {}, effects: options.effects || [], prerequisites: [], tags: options.tags || [],
            limits: [], uncertainty: 0, confidence: 1, proposer: 'fixture'
        };
    }

    it('enumerates affordable dynasty character/holding combinations and legal fate allocations', function() {
        const planner = new ResourcePackagePlanner();
        const cheap0 = candidate('cheap:0', 'dynasty-purchase', { instanceId: 'cheap', cardId: 'cheap-body', costs: { fate: 1, additionalFate: 0 } });
        const cheap1 = candidate('cheap:1', 'dynasty-purchase', { instanceId: 'cheap', cardId: 'cheap-body', costs: { fate: 2, additionalFate: 1 } });
        const holding = candidate('holding', 'dynasty-purchase', { cardId: 'wall-holding', costs: { fate: 1 } });
        const plan = planner.plan(state({ fate: 3 }), [cheap0, cheap1, holding], {
            archetype: 'holding', cards: {
                'cheap-body': { type: 'character', printedCost: 1, value: 1 },
                'wall-holding': { type: 'holding', value: 4 }
            }
        });
        expect(plan.dynastyPackages.every((pkg) => pkg.fateCost <= 3)).toBeTrue();
        expect(plan.dynastyPackages.some((pkg) => pkg.candidateIds.includes(cheap0.id) && pkg.candidateIds.includes(holding.id))).toBeTrue();
        expect(plan.dynastyPackages.some((pkg) => pkg.candidateIds.includes(cheap0.id) && pkg.candidateIds.includes(cheap1.id))).toBeFalse();
        expect(plan.selectedDynasty.rationale.some((reason) => reason.startsWith('holding:'))).toBeTrue();
    });

    it('estimates persistent participation from cost, fate, ready/no-bow, urgency, round, and horizon', function() {
        const planner = new ResourcePackagePlanner();
        const plain = planner.expectedFutureParticipations({ printedCost: 2, fate: 0, currentRound: 2, gameHorizon: 3 });
        const persistent = planner.expectedFutureParticipations({ printedCost: 2, fate: 2, readyValue: 2, noBow: true, boardUrgency: 1, currentRound: 2, gameHorizon: 4 });
        expect(persistent).toBeGreaterThan(plain * 3);
        expect(planner.expectedFutureParticipations({ printedCost: 2, fate: 10, gameHorizon: 2 })).toBeLessThanOrEqual(2);
    });

    it('builds Display of Power/Five Fires/reducer packages with ring fate and alternative costs', function() {
        const display = candidate('display', 'reaction', { cardId: 'display-of-power', costs: { fate: 2, cards: 1 }, effects: [{ kind: 'ring', element: 'earth', claim: true, resolve: true }] });
        const fiveFires = candidate('fires', 'conflict-card', { cardId: 'consumed-by-five-fires', costs: { fate: 4, cards: 1 }, effects: [{ kind: 'remove', method: 'discard' }] });
        const tetsubo = candidate('tetsubo-reducer', 'in-play-ability', { cardId: 'iron-mountain-castle', tags: ['reducer'], effects: [{ kind: 'reduction', amount: 1, costType: 'fate', appliesTo: 'attachment' }] });
        const tower = candidate('tower', 'conflict-card', { cardId: 'sturdy-tetsubo', costs: { fate: 2, cards: 1 }, tags: ['attachment'], effects: [{ kind: 'attachment', cardId: 'sturdy-tetsubo' }] });
        const plan = new ResourcePackagePlanner().plan(state({ phase: 'conflict', conflict: true, fate: 3, ringFate: 2 }), [display, fiveFires, tetsubo, tower], {
            archetype: 'shugenja', expectedRingFateWeight: 1,
            cards: { 'consumed-by-five-fires': { alternativeFateCost: 3, value: 9 }, 'sturdy-tetsubo': { value: 6 } }
        });
        expect(plan.conflictPackages.some((pkg) => pkg.candidateIds.includes(fiveFires.id))).toBeTrue();
        const reducerPackage = plan.conflictPackages.find((pkg) => pkg.candidateIds.length === 2 && pkg.candidateIds.includes(tetsubo.id) && pkg.candidateIds.includes(tower.id));
        expect(reducerPackage.fateCost).toBe(1);
        expect(reducerPackage.reducerIds).toEqual(['instance:tetsubo-reducer']);
        expect(plan.selectedConflict).toBeDefined();
    });

    it('compares cheap persistent development, second-player fate, conflict cleanup, and exact conflict reserve value', function() {
        const body = candidate('body', 'dynasty-purchase', { cardId: 'cheap-persistent-body', costs: { fate: 2, additionalFate: 1 } });
        const cleanup = candidate('cleanup', 'conflict-card', { cardId: 'conflict-character', costs: { fate: 1, cards: 1 }, effects: [{ kind: 'skill', military: 3 }] });
        const plan = new ResourcePackagePlanner().plan(state({ fate: 3, firstPlayer: false }), [body, cleanup], {
            archetype: 'rush', cards: {
                'cheap-persistent-body': { type: 'character', printedCost: 1, value: 2 },
                'conflict-character': { type: 'character', conflictCharacter: true, value: 4 }
            }
        });
        expect(plan.selectedDynasty.expectedParticipations).toBeGreaterThan(1);
        expect(plan.selectedConflict.expectedParticipations).toBe(1);
        expect(Math.max(plan.marginalDynastyValue, plan.marginalConflictValue)).toBeGreaterThan(0);
    });

    it('creates hard exposed-stronghold reservations, releases stale packages, and enforces them in safety', function() {
        const defense = candidate('defense', 'conflict-card', { costs: { fate: 2, cards: 1 }, tags: ['terminal', 'defense'], effects: [{ kind: 'skill', military: 5 }] });
        const diversion = candidate('diversion', 'conflict-card', { costs: { fate: 2, cards: 1 }, effects: [{ kind: 'skill', military: 2 }] });
        const threatened = state({ phase: 'conflict', conflict: true, stronghold: true, fate: 3, handSize: 3 });
        const planner = new ResourcePackagePlanner();
        const plan = planner.plan(threatened, [defense, diversion], { candidateValues: { defense: 20 } });
        expect(plan.reservations.some((reservation) => reservation.resource === 'fate' && reservation.hard)).toBeTrue();
        const safety = new SafetyVetoPipeline().evaluate(threatened, [defense, diversion], {
            hardFateReserve: 2, hardCardReserve: 1, reservedCandidateIds: [defense.id]
        });
        expect(safety.allowed.map((item) => item.id)).toContain(defense.id);
        expect(safety.vetoed).toContain(jasmine.objectContaining({ candidateId: diversion.id, code: 'hard-fate-reserve' }));

        const released = planner.plan(state({ phase: 'dynasty' }), [], {});
        expect(released.reservations).toEqual([]);
    });

    it('keeps all archetype resource policies injectable and annotates only selected packages', function() {
        expect(Object.keys(ARCHETYPE_RESOURCE_PROFILES).sort()).toEqual([
            'dishonor', 'duel', 'generic', 'holding', 'monk', 'movement', 'rush', 'shugenja', 'tower'
        ]);
        const action = candidate('payoff', 'conflict-card', { effects: [{ kind: 'skill', military: 3 }] });
        const planner = new ResourcePackagePlanner();
        const plan = planner.plan(state({ phase: 'conflict', conflict: true }), [action], { archetype: 'duel' });
        const annotated = planner.annotate([action], plan)[0];
        expect(annotated.annotations).toContain(jasmine.objectContaining({ proposer: 'resource-package-planner' }));
        expect(action.annotations).toBeUndefined();
    });
});
