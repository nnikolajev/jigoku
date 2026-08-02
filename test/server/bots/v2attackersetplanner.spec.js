const AttackerSetPlanner = require('../../../build/server/game/bots/v2/allocation/AttackerSetPlanner.js').default;
const HighConfidenceOverridePolicy = require('../../../build/server/game/bots/v2/HighConfidenceOverridePolicy.js').default;

describe('V2 complete attacker-set planner', function() {
    function character(instanceId, military, options = {}) {
        return {
            instanceId, cardId: instanceId, controllerId: options.controllerId || 'Bot', location: 'play area',
            military, political: options.political ?? 0, glory: 0, fate: options.fate ?? 0,
            honored: false, dishonored: false, bowed: false, ready: options.ready ?? true,
            participating: false, attacking: false, defending: false, traits: [], unique: false,
            attachments: [], canMove: false, canReady: options.canReady ?? false,
            noBowAfterConflict: options.noBowAfterConflict ?? false,
            canAttackMilitary: options.canAttackMilitary ?? true,
            canAttackPolitical: options.canAttackPolitical ?? true,
            covert: options.covert ?? false, attackRestrictions: options.attackRestrictions || []
        };
    }

    function state(characters, overrides = {}) {
        const botOpportunities = overrides.botOpportunities || { military: 1, political: 0 };
        const opponentOpportunities = overrides.opponentOpportunities || { military: 1, political: 1 };
        const botTotal = overrides.botTotal ?? botOpportunities.military + botOpportunities.political;
        const opponentTotal = overrides.opponentTotal ??
            opponentOpportunities.military + opponentOpportunities.political;
        return {
            perspectivePlayerId: 'Bot', phase: 'conflict',
            scopes: { gameId: 'game', roundId: 'round', phaseId: 'conflict', conflictId: 'conflict-1' },
            materialStateSignature: 'state-1', characters,
            conflict: {
                id: 'conflict-1', attackerId: 'Bot', defenderId: 'Opponent', type: 'military',
                attackerSkill: 0, defenderSkill: 0, breakThreshold: 4,
                provinceStrength: 4, provinceLocation: 'province 1', ...overrides.conflict
            },
            players: {
                Bot: { id: 'Bot', fate: 3 },
                Opponent: { id: 'Opponent', fate: overrides.opponentFate ?? 0 }
            },
            hands: [
                { playerId: 'Bot', size: 2, cards: [], exact: true },
                { playerId: 'Opponent', size: overrides.opponentHand ?? 0, cards: [], exact: false }
            ],
            provinces: overrides.provinces || [{
                controllerId: 'Opponent', location: 'province 2', visible: false, broken: false,
                inConflict: false, effectiveStrength: overrides.futureProvinceStrength ?? 4,
                holdingIds: [], attackEligible: true, stronghold: false
            }],
            opportunities: {
                remainingByPlayer: {
                    Bot: botOpportunities,
                    Opponent: opponentOpportunities
                },
                remainingTotalByPlayer: { Bot: botTotal, Opponent: opponentTotal },
                totalRemaining: botTotal + opponentTotal
            }
        };
    }

    function attacker(character) {
        return {
            id: `attacker:${character.instanceId}`, kind: 'attacker-set',
            targets: [{ kind: 'character', instanceId: character.instanceId, cardId: character.cardId, controllerId: 'Bot' }],
            commandPreview: { command: 'cardClicked', args: [character.instanceId], target: character.cardId },
            costs: {}, effects: [], prerequisites: [], tags: ['offense'], limits: [],
            uncertainty: 0, confidence: 0.98, proposer: 'fixture'
        };
    }

    function done() {
        return {
            id: 'done', kind: 'pass', targets: [],
            commandPreview: { command: 'menuButton', args: ['done', 'done-button'], target: 'Done' },
            costs: {}, effects: [], prerequisites: [], tags: [], limits: [],
            uncertainty: 0, confidence: 1, proposer: 'fixture'
        };
    }

    function passConflict() {
        return {
            id: 'pass-conflict', kind: 'pass', targets: [],
            commandPreview: { command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass Conflict' },
            costs: {}, effects: [], prerequisites: [], tags: [], limits: [],
            uncertainty: 0, confidence: 1, proposer: 'fixture'
        };
    }

    it('selects the least costly exact break and emits every click followed by Done', function() {
        const chars = [character('durable-tower', 8, { fate: 3 }), character('cheap-breaker', 4)];
        const candidates = new AttackerSetPlanner().expand(state(chars), [...chars.map(attacker), done()]);
        const set = candidates.find((candidate) => candidate.kind === 'attacker-set');

        expect(set.proposer).toBe('attacker-set-planner');
        expect(set.mode).toBe('unopposed-last-break:4:4');
        expect(set.targets.map((target) => target.instanceId)).toEqual(['cheap-breaker']);
        expect(set.macro.steps.map((step) => [step.command, step.args])).toEqual([
            ['cardClicked', ['cheap-breaker']],
            ['menuButton', ['done', 'done-button']]
        ]);
    });

    it('resolves the future Initiate Conflict confirmation after the first attacker click', function() {
        const chars = [character('cheap-breaker', 4)];
        const planningState = state(chars);
        planningState.prompt = { identity: 'attackers', title: 'Military Fire Conflict', menu: 'Choose attackers' };
        const set = new AttackerSetPlanner().expand(planningState, [attacker(chars[0]), passConflict()])
            .find((candidate) => candidate.proposer === 'attacker-set-planner');

        expect(set.macro.steps).toEqual([
            jasmine.objectContaining({ kind: 'target', command: 'cardClicked', args: ['cheap-breaker'] }),
            jasmine.objectContaining({
                kind: 'confirmation', semanticValue: 'Initiate Conflict', command: 'menuButton', args: []
            })
        ]);
    });

    it('leaves future-conflict allocation on V1', function() {
        const chars = [character('one', 4), character('two', 4)];
        const original = [...chars.map(attacker), done()];

        expect(new AttackerSetPlanner().expand(state(chars, {
            botOpportunities: { military: 1, political: 1 }
        }), original)).toBe(original);
    });

    it('leaves any publicly available opposing defender on V1', function() {
        const chars = [character('attacker', 4), character('defender', 1, { controllerId: 'Opponent' })];
        const original = [attacker(chars[0]), done()];

        expect(new AttackerSetPlanner().expand(state(chars), original)).toBe(original);
    });

    it('coordinates a buffered minimum package for the final ordinary attack', function() {
        const chars = [
            character('alpha', 5), character('beta', 5), character('tower', 13, { fate: 3 }),
            character('public-defender', 2, { controllerId: 'Opponent' })
        ];
        const set = new AttackerSetPlanner().expand(state(chars, {
            opponentHand: 1, opponentFate: 1
        }), chars.slice(0, 3).map(attacker).concat(done()))
            .find((candidate) => candidate.kind === 'attacker-set');

        expect(set.mode).toBe('bounded-last-break:4:2:3:9:10');
        expect(set.targets.map((target) => target.instanceId)).toEqual(['alpha', 'beta']);
        expect(set.macro.steps.at(-1)).toEqual(jasmine.objectContaining({
            kind: 'confirmation', command: 'menuButton'
        }));

        const v1 = attacker(chars[2]);
        const proof = new HighConfidenceOverridePolicy().evaluate({
            state: state(chars, { opponentHand: 1, opponentFate: 1 }),
            preference: { candidate: set, score: { terminalRank: 1, scalar: 20 } },
            v1Candidate: v1,
            scoreGap: 10,
            v1Vetoes: [],
            search: { complete: true, exhausted: false, firstCandidate: set, principalLine: [] },
            candidates: [set, v1]
        });
        expect(proof).toEqual(jasmine.objectContaining({
            accepted: true,
            reason: 'resource-preservation',
            evidence: jasmine.arrayContaining([
                'minimum-inclusion-pessimistic-last-conflict-break',
                'public-defense-hand-fate-response-budgeted',
                'public-defense:2', 'response-reserve:3', 'required:9'
            ])
        }));
    });

    it('budgets every public ready defender for an exact final stronghold break', function() {
        const chars = [
            character('alpha', 4), character('beta', 4), character('expensive', 10, { fate: 3 }),
            character('public-defender', 3, { controllerId: 'Opponent' })
        ];
        const candidates = new AttackerSetPlanner().expand(state(chars, {
            conflict: { provinceLocation: 'stronghold province', provinceStrength: 5, breakThreshold: 5 }
        }), chars.slice(0, 3).map(attacker).concat(done()));
        const set = candidates.find((candidate) => candidate.kind === 'attacker-set');

        expect(set.mode).toBe('public-stronghold-break:5:3:8:8');
        expect(set.targets.map((target) => target.instanceId)).toEqual(['alpha', 'beta']);
        expect(set.macro.steps.map((step) => [step.command, step.args])).toEqual([
            ['cardClicked', ['alpha']],
            ['cardClicked', ['beta']],
            ['menuButton', ['done', 'done-button']]
        ]);
        expect(set.prerequisites).toEqual([jasmine.objectContaining({
            id: 'exact-public-stronghold-break', satisfied: true
        })]);
    });

    it('requires zero opponent hand and fate before treating the break as unopposed', function() {
        const chars = [character('attacker', 4)];
        const original = [attacker(chars[0]), done()];
        const planner = new AttackerSetPlanner();

        expect(planner.expand(state(chars, { opponentHand: 1 }), original)).toBe(original);
        expect(planner.expand(state(chars, { opponentFate: 1 }), original)).toBe(original);
    });

    it('uses a pessimistic public hand and fate reserve at the stronghold', function() {
        const chars = [
            character('attacker', 15),
            character('defender', 3, { controllerId: 'Opponent' })
        ];
        const original = [attacker(chars[0]), done()];
        const planner = new AttackerSetPlanner();
        const stronghold = { provinceLocation: 'stronghold province', provinceStrength: 5, breakThreshold: 5 };

        const handReserve = planner.expand(state(chars, {
            opponentHand: 1, conflict: stronghold
        }), original).find((candidate) => candidate.kind === 'attacker-set');
        const fateReserve = planner.expand(state(chars, {
            opponentFate: 1, conflict: stronghold
        }), original).find((candidate) => candidate.kind === 'attacker-set');

        expect(handReserve.mode).toBe('bounded-stronghold-break:5:3:3:11:15');
        expect(fateReserve.mode).toBe('bounded-stronghold-break:5:3:2:10:15');
    });

    it('is deterministic and excludes Covert or restricted bodies from the exact macro', function() {
        const chars = [
            character('alpha', 2), character('beta', 2),
            character('covert', 8, { covert: true }),
            character('restricted', 8, { attackRestrictions: ['cannot-attack'] })
        ];
        const planner = new AttackerSetPlanner();
        const first = planner.expand(state(chars), [...chars.map(attacker), done()])
            .find((candidate) => candidate.kind === 'attacker-set');
        const second = planner.expand(state([...chars].reverse()),
            [...chars].reverse().map(attacker).concat(done()))
            .find((candidate) => candidate.kind === 'attacker-set');

        expect(first.targets.map((target) => target.instanceId)).toEqual(['alpha', 'beta']);
        expect(second.id).toBe(first.id);
        expect(second.targets).toEqual(first.targets);
        expect(second.macro.steps).toEqual(first.macro.steps);
    });
});
