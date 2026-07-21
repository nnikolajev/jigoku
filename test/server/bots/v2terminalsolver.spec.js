const { emptyLedgers } = require('../../../build/server/game/bots/v2/model/Ledgers.js');
const TerminalSolver = require('../../../build/server/game/bots/v2/terminal/TerminalSolver.js').default;
const { resolveTerminalConflict } = require('../../../build/server/game/bots/v2/terminal/TerminalSolver.js');

describe('V2 narrow terminal solver', function() {
    function character(id, controllerId, military, options = {}) {
        return {
            instanceId: id, cardId: id, controllerId, ownerId: controllerId, location: 'play area',
            military, political: options.political ?? military, glory: 0, fate: 1,
            honored: false, dishonored: false, bowed: false, ready: options.ready ?? true,
            participating: options.participating ?? false,
            attacking: options.attacking ?? false, defending: options.defending ?? false,
            conflictType: options.conflictType, traits: [], attachments: [],
            canMove: true, canReady: false, noBowAfterConflict: options.noBow ?? false,
            canAttackMilitary: options.canAttackMilitary ?? true,
            canAttackPolitical: options.canAttackPolitical ?? true,
            covert: options.covert ?? false, attackRestrictions: options.attackRestrictions || []
        };
    }

    function state(options = {}) {
        const scopes = { gameId: 'g', roundId: 'r', phaseId: 'conflict', conflictId: options.conflict ? 'c' : undefined };
        const characters = options.characters || [];
        const conflict = options.conflict ? {
            id: 'c', attackerId: options.attackerId || 'Opponent', defenderId: options.defenderId || 'Bot',
            type: options.type || 'military', ring: 'fire', provinceLocation: options.location || 'stronghold province',
            attackerSkill: options.attackerSkill ?? 4, defenderSkill: options.defenderSkill ?? 0,
            provinceStrength: options.conflictProvinceStrength ?? 4, breakThreshold: options.conflictProvinceStrength ?? 4
        } : undefined;
        const botBroken = options.botBroken ?? 0;
        const opponentBroken = options.opponentBroken ?? 0;
        const outer = (controllerId, count) => [1, 2, 3, 4].map((index) => ({
            controllerId, location: `province ${index}`, visible: true,
            broken: index <= count, inConflict: options.location === `province ${index}`,
            effectiveStrength: options.outerStrength ?? 3, holdingIds: [], attackEligible: index > count, stronghold: false
        }));
        const provinces = [
            ...outer('Bot', botBroken),
            { controllerId: 'Bot', location: 'stronghold province', visible: true, broken: false, inConflict: options.conflict && options.defenderId !== 'Opponent' && (options.location || 'stronghold province') === 'stronghold province', effectiveStrength: options.botStrongholdStrength ?? 4, holdingIds: [], attackEligible: botBroken >= 3, stronghold: true },
            ...outer('Opponent', opponentBroken),
            { controllerId: 'Opponent', location: 'stronghold province', visible: true, broken: false, inConflict: options.conflict && options.defenderId === 'Opponent' && options.location === 'stronghold province', effectiveStrength: options.opponentStrongholdStrength ?? 4, holdingIds: [], attackEligible: opponentBroken >= 3, stronghold: true }
        ];
        const opportunities = options.opportunities || {
            Bot: { military: 0, political: 0 }, Opponent: { military: 0, political: 0 }
        };
        return {
            schemaVersion: 1, perspectivePlayerId: 'Bot', informationMode: options.mode || 'fair', scopes,
            phase: 'conflict', prompt: { kind: 'prompt', identity: 'p', title: '', menu: '' }, promptControls: [], conflict,
            players: {
                Bot: { id: 'Bot', fate: 3, honor: options.botHonor ?? 8, conflictDeckSize: options.botDeck ?? 20, dynastyDeckSize: 20, brokenProvinceCount: botBroken, firstPlayer: options.firstPlayer ?? true },
                Opponent: { id: 'Opponent', fate: 3, honor: options.opponentHonor ?? 8, conflictDeckSize: options.opponentDeck ?? 20, dynastyDeckSize: 20, brokenProvinceCount: opponentBroken, firstPlayer: !(options.firstPlayer ?? true) }
            },
            characters, provinces, rings: [],
            hands: [{ playerId: 'Bot', size: 3, exact: true, cards: [] }, { playerId: 'Opponent', size: 3, exact: false, cards: [] }],
            opportunities: { remainingByPlayer: opportunities, totalRemaining: Object.values(opportunities).reduce((sum, value) => sum + value.military + value.political, 0) },
            resources: { fateByPlayer: { Bot: 3, Opponent: 3 }, honorByPlayer: { Bot: options.botHonor ?? 8, Opponent: options.opponentHonor ?? 8 }, handSizeByPlayer: { Bot: 3, Opponent: 3 }, conflictDeckByPlayer: { Bot: options.botDeck ?? 20, Opponent: options.opponentDeck ?? 20 } },
            board: { readySkillByPlayer: {}, participatingSkillByPlayer: {} },
            ledgers: emptyLedgers(scopes), materialStateSignature: options.signature || 'terminal'
        };
    }

    function candidate(id, options = {}) {
        return {
            id, kind: options.kind || 'conflict-card', source: options.source,
            targets: options.targets || [], commandPreview: { command: options.command || 'cardClicked', args: [id], target: id },
            costs: options.costs || {}, effects: options.effects || [], prerequisites: [], tags: options.tags || [], limits: [],
            uncertainty: options.uncertainty || 0, confidence: options.confidence ?? 1, proposer: 'terminal-fixture'
        };
    }

    const pass = candidate('pass', { kind: 'pass', command: 'menuButton' });
    const fair = (packages = []) => ({ mode: 'fair', handHypotheses: [], provinceHypotheses: [], responsePackages: packages, certainty: 0.5, trace: {} });
    const exact = (packages = []) => ({ mode: 'omniscient', handHypotheses: [], provinceHypotheses: [], responsePackages: packages, certainty: 1, trace: {} });

    it('activates independently for every configured terminal threshold', function() {
        const solver = new TerminalSolver();
        expect(solver.activationReasons(state({ opponentBroken: 3 }))).toContain('stronghold-exposed');
        expect(solver.activationReasons(state({ botHonor: 4 }))).toContain('honor-terminal');
        expect(solver.activationReasons(state({ botDeck: 2 }))).toContain('deck-exhaustion');
        expect(solver.activationReasons(state())).toContain('short-conflict-sequence');
        const duel = candidate('duel', { effects: [{ kind: 'duel', duelType: 'honor', honorDelta: -2 }] });
        expect(solver.activationReasons(state({ opportunities: { Bot: { military: 1, political: 1 }, Opponent: { military: 1, political: 1 } } }), [duel])).toContain('forced-honor-transfer');
    });

    it('uses positive attacker ties, rejects 0-0 winners, and reads live effective strength', function() {
        const positiveTie = resolveTerminalConflict(state({ conflict: true, attackerSkill: 4, defenderSkill: 4 }));
        expect(positiveTie.winnerId).toBe('Opponent');
        expect(positiveTie.ringAwarded).toBeTrue();
        expect(positiveTie.provinceBroken).toBeFalse();

        const zeroTie = resolveTerminalConflict(state({ conflict: true, attackerSkill: 0, defenderSkill: 0 }));
        expect(zeroTie.winnerId).toBeUndefined();
        expect(zeroTie.ringAwarded).toBeFalse();

        const buffed = resolveTerminalConflict(state({
            conflict: true, attackerId: 'Bot', defenderId: 'Opponent', location: 'province 1',
            attackerSkill: 4, defenderSkill: 0, conflictProvinceStrength: 2, outerStrength: 5
        }));
        expect(buffed.provinceStrength).toBe(5);
        expect(buffed.provinceBroken).toBeFalse();
    });

    it('solves a two-step outer-province/stronghold race using live opportunity counts', function() {
        const reusable = character('reusable', 'Bot', 5, { political: 5, noBow: true });
        const result = new TerminalSolver().solve(state({
            opponentBroken: 2, outerStrength: 3, opponentStrongholdStrength: 4,
            characters: [reusable],
            opportunities: { Bot: { military: 1, political: 1 }, Opponent: { military: 0, political: 0 } }
        }), [pass], fair());
        expect(result.active).toBeTrue();
        expect(result.selected.status).toBe('forced-win');
        expect(result.selected.branches[0].projectedConflicts.map((conflict) => conflict.provinceBroken)).toEqual([true, true]);
        expect(result.selected.branches[0].terminalReason).toBe('stronghold');
    });

    it('accounts for Covert when deciding a last-conflict terminal break', function() {
        const opportunities = { Bot: { military: 1, political: 0 }, Opponent: { military: 0, political: 0 } };
        const defenders = [character('large-defender', 'Opponent', 5), character('small-defender', 'Opponent', 1)];
        const covert = new TerminalSolver().solve(state({
            opponentBroken: 3, opponentStrongholdStrength: 3, opportunities,
            characters: [character('covert', 'Bot', 4, { covert: true }), ...defenders]
        }), [pass], fair());
        const ordinary = new TerminalSolver().solve(state({
            opponentBroken: 3, opponentStrongholdStrength: 3, opportunities,
            characters: [character('ordinary', 'Bot', 4), ...defenders]
        }), [pass], fair());
        expect(covert.selected.status).toBe('forced-win');
        expect(ordinary.selected.status).not.toBe('forced-win');
    });

    it('handles terminal honor transfer and conflict-deck reshuffle honor loss', function() {
        const opponent = { kind: 'player', id: 'Opponent' };
        const duel = candidate('duel', {
            targets: [opponent], effects: [{ kind: 'duel', duelType: 'honor-transfer', honorDelta: -2, target: opponent }]
        });
        const honor = new TerminalSolver().solve(state({ opponentHonor: 2 }), [pass, duel], fair());
        expect(honor.firstCandidate.id).toBe('duel');
        expect(honor.selected.status).toBe('forced-win');

        const draw = candidate('draw', {
            effects: [{ kind: 'deck', draw: 2, target: { kind: 'player', id: 'Bot' } }]
        });
        const exhaustion = new TerminalSolver().solve(state({ botHonor: 5, botDeck: 1 }), [pass, draw], fair());
        expect(exhaustion.evaluations.find((entry) => entry.candidateId === 'draw').status).toBe('forced-loss');
        expect(exhaustion.firstCandidate.id).toBe('pass');
    });

    it('aggregates fair branches three ways, uses exact pessimism, and preserves a V1 forced save', function() {
        const attacker = character('attacker', 'Opponent', 4, { participating: true, attacking: true, conflictType: 'military' });
        const guard = character('guard', 'Bot', 4);
        const target = { kind: 'character', instanceId: 'guard', controllerId: 'Bot' };
        const defend = candidate('defend', {
            targets: [target], tags: ['defense', 'terminal'],
            effects: [{ kind: 'move', destination: 'conflict', target }]
        });
        const threatened = state({ conflict: true, characters: [attacker, guard] });
        const saved = new TerminalSolver().solve(threatened, [pass, defend], fair());
        expect(saved.firstCandidate.id).toBe('defend');
        expect(saved.selected.status).toBe('avoids-forced-loss');

        const bow = candidate('opponent-bow', {
            targets: [target], effects: [{ kind: 'bow', target }]
        });
        const response = { id: 'known-bow', candidates: [bow], fateCost: 0, cardIds: ['bow'], weight: 0.25, certainty: 0.25, rationale: [] };
        const risky = new TerminalSolver().solve(threatened, [defend], fair([response]), { fairAggregation: 'expected' });
        expect(risky.selected.expected).toBeGreaterThanOrEqual(risky.selected.pessimistic);
        expect(risky.selected.optimistic).toBeGreaterThanOrEqual(risky.selected.expected);
        const exactRisk = new TerminalSolver().solve(threatened, [defend], exact([response]), { fairAggregation: 'optimistic' });
        expect(exactRisk.aggregation).toBe('pessimistic');
        expect(exactRisk.selected.aggregate).toBe(exactRisk.selected.pessimistic);
    });
});
