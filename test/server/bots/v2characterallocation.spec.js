const { emptyLedgers } = require('../../../build/server/game/bots/v2/model/Ledgers.js');
const CharacterAllocator = require('../../../build/server/game/bots/v2/allocation/CharacterAllocator.js').default;
const ActionTimingEvaluator = require('../../../build/server/game/bots/v2/allocation/ActionTimingEvaluator.js').default;

describe('V2 character allocation and action timing', function() {
    function character(id, military, political, options = {}) {
        return {
            instanceId: id, cardId: options.cardId || id, controllerId: options.controllerId || 'Bot', ownerId: options.controllerId || 'Bot',
            location: 'play area', military, political, glory: options.glory || 0, fate: options.fate || 0,
            honored: false, dishonored: false, bowed: options.bowed || false, ready: !options.bowed,
            participating: options.participating || false, attacking: options.attacking || false, defending: options.defending || false,
            conflictType: options.conflictType, traits: options.traits || [], attachments: options.attachments || [],
            canMove: options.canMove !== false, canReady: options.canReady !== false,
            noBowAfterConflict: options.noBowAfterConflict || false,
            canAttackMilitary: options.canAttackMilitary !== false, canAttackPolitical: options.canAttackPolitical !== false,
            covert: options.covert || false, attackRestrictions: options.attackRestrictions || []
        };
    }

    function state(characters, options = {}) {
        const scopes = { gameId: 'g', roundId: 'r', phaseId: 'conflict', conflictId: 'c' };
        const opportunities = options.opportunities || { Bot: { military: 1, political: 2 }, Opponent: { military: 1, political: 1 } };
        return {
            schemaVersion: 1, perspectivePlayerId: 'Bot', informationMode: 'fair', scopes,
            phase: 'conflict', prompt: { kind: 'prompt', identity: 'p', title: '', menu: '' }, promptControls: [],
            conflict: options.conflict === null ? undefined : (options.conflict || {
                id: 'c', attackerId: 'Bot', defenderId: 'Opponent', type: 'military', provinceLocation: 'province 1',
                attackerSkill: 0, defenderSkill: 0, provinceStrength: 4, breakThreshold: 4
            }),
            players: {
                Bot: { id: 'Bot', fate: 3, honor: 8, conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: true },
                Opponent: { id: 'Opponent', fate: 3, honor: 8, conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: false }
            },
            characters,
            provinces: [
                { controllerId: 'Bot', location: 'stronghold province', visible: false, broken: false, inConflict: options.strongholdInConflict || false, effectiveStrength: 7, holdingIds: [], attackEligible: false, stronghold: true },
                { controllerId: 'Opponent', location: 'province 1', visible: true, broken: false, inConflict: true, effectiveStrength: 4, holdingIds: [], attackEligible: true, stronghold: false }
            ],
            rings: [], hands: [{ playerId: 'Bot', size: options.handSize || 3, exact: true, cards: [] }, { playerId: 'Opponent', size: 3, exact: false, cards: [] }],
            opportunities: { remainingByPlayer: opportunities, totalRemaining: options.totalRemaining ?? Object.values(opportunities).reduce((sum, row) => sum + row.military + row.political, 0) },
            resources: { fateByPlayer: { Bot: 3, Opponent: 3 }, honorByPlayer: { Bot: 8, Opponent: 8 }, handSizeByPlayer: { Bot: options.handSize || 3, Opponent: 3 }, conflictDeckByPlayer: { Bot: 20, Opponent: 20 } },
            board: { readySkillByPlayer: {}, participatingSkillByPlayer: {} }, ledgers: emptyLedgers(scopes), materialStateSignature: 'allocation'
        };
    }

    it('allocates two attacks plus a stronghold defense as constraints and reserves', function() {
        const allocation = new CharacterAllocator().allocate(state([
            character('military', 5, 1), character('political', 1, 5), character('defender', 3, 3)
        ]), { strongholdReserveCount: 1 });
        expect(allocation.assignments.some((assignment) => assignment.primary === 'current-attack')).toBeTrue();
        expect(allocation.assignments.some((assignment) => assignment.primary === 'later-political')).toBeTrue();
        expect(allocation.strongholdReserveCount).toBe(1);
        expect(allocation.constraints).toContain(jasmine.objectContaining({ id: 'allocation:stronghold-reserve', kind: 'hard' }));
        expect(allocation.reservations.length).toBe(1);
        expect(allocation.exhaustive).toBeTrue();
    });

    it('releases stronghold reserve on the last conflict but enforces it when exposed', function() {
        const chars = [character('a', 4, 2), character('b', 3, 3)];
        const last = new CharacterAllocator().allocate(state(chars, {
            totalRemaining: 1, opportunities: { Bot: { military: 1, political: 0 }, Opponent: { military: 0, political: 0 } }
        }), { strongholdReserveCount: 1 });
        expect(last.strongholdReserveCount).toBe(0);

        const exposed = new CharacterAllocator().allocate(state(chars, {
            strongholdInConflict: true,
            conflict: { id: 'c', attackerId: 'Opponent', defenderId: 'Bot', type: 'military', provinceLocation: 'stronghold province', attackerSkill: 6, defenderSkill: 0, provinceStrength: 7, breakThreshold: 7 }
        }));
        expect(exposed.strongholdReserveCount).toBeGreaterThanOrEqual(1);
        expect(exposed.constraints[0].predicate.kind).toBe('ready-defenders');
    });

    it('handles aggressive race, Covert, restrictions, and large-board pruning deterministically', function() {
        const chars = [
            character('covert', 4, 1, { covert: true }),
            character('restricted', 7, 7, { attackRestrictions: ['cannot attack'] }),
            ...Array.from({ length: 5 }, (_, index) => character(`body-${index}`, 2 + index, 1))
        ];
        const allocator = new CharacterAllocator();
        const first = allocator.allocate(state(chars), { aggression: 1, exhaustiveCharacterLimit: 3, largeBoardBeamWidth: 32 });
        const second = allocator.allocate(state([...chars].reverse()), { aggression: 1, exhaustiveCharacterLimit: 3, largeBoardBeamWidth: 32 });
        expect(first.exhaustive).toBeFalse();
        expect(first.assignments).toEqual(second.assignments);
        expect(first.assignments.some((assignment) => assignment.primary === 'current-attack')).toBeTrue();
        expect(first.assignments.find((assignment) => assignment.characterId === 'restricted').primary).not.toBe('current-attack');
        expect(first.explored).toBeLessThan(2000);
    });

    it('models reusable towers, Unicorn movement, and Dragon card-count/no-bow exceptions', function() {
        const tower = character('dragon-payoff', 3, 3, { noBowAfterConflict: true, fate: 2 });
        const cavalry = character('border-rider', 2, 2, { bowed: true, traits: ['Cavalry'] });
        const allocation = new CharacterAllocator().allocate(state([tower, cavalry], { handSize: 5 }), {
            towerIds: ['dragon-payoff'], cardCountPayoffIds: ['dragon-payoff'], minimumCardsForPayoff: 5,
            movementSourceIds: ['border-rider'], readySourceIds: ['dragon-payoff']
        });
        const towerAssignment = allocation.assignments.find((assignment) => assignment.characterId === 'dragon-payoff');
        const cavalryAssignment = allocation.assignments.find((assignment) => assignment.characterId === 'border-rider');
        expect(['tower', 'current-attack']).toContain(towerAssignment.primary);
        if(towerAssignment.primary === 'current-attack') expect(towerAssignment.secondary.length).toBeGreaterThan(0);
        expect(['movement-source', 'ready-source']).toContain(cavalryAssignment.primary);
    });

    it('values opponent commitment, prevention, pass initiative, and minimum sufficient actions', function() {
        const allocation = new CharacterAllocator().allocate(state([character('a', 4, 2), character('b', 2, 4)]));
        const candidate = (id, kind, effects) => ({
            id, kind, targets: [], commandPreview: { command: 'menuButton', args: [id], target: id }, costs: {}, effects,
            prerequisites: [], tags: [], limits: [], uncertainty: 0, confidence: 1, proposer: 'fixture'
        });
        const pass = candidate('pass', 'pass', []);
        const exact = candidate('exact', 'conflict-card', [{ kind: 'skill', military: 2 }]);
        const excess = candidate('excess', 'conflict-card', [{ kind: 'skill', military: 6 }]);
        const prevention = candidate('prevent', 'interrupt', [{ kind: 'prevention', event: 'bow' }]);
        const timing = new ActionTimingEvaluator();
        const timingState = state([character('a', 4, 2)]);
        timingState.conflict = { ...timingState.conflict, attackerSkill: 4 };
        const pressured = timing.rank(timingState, [pass, excess, exact, prevention], allocation, 5);
        expect(pressured.findIndex((entry) => entry.candidate.id === 'exact')).toBeLessThan(pressured.findIndex((entry) => entry.candidate.id === 'excess'));
        expect(pressured.find((entry) => entry.candidate.id === 'prevent').timingScore).toBe(4);
        const uncommitted = timing.rank(state([character('a', 4, 2)]), [pass], allocation, 0);
        expect(uncommitted[0].reasons).toContain('pressure-opponent-to-commit');
    });
});
