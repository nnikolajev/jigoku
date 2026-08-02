const V2BotEngine = require('../../../build/server/game/bots/v2/V2BotEngine.js').default;
const CandidateRegistryModule = require('../../../build/server/game/bots/v2/CandidateRegistry.js');
const CandidateRegistry = CandidateRegistryModule.default;
const { V1FallbackContributor } = CandidateRegistryModule;
const { candidateId } = require('../../../build/server/game/bots/v2/model/Candidate.js');
const HighConfidenceOverridePolicy = require('../../../build/server/game/bots/v2/HighConfidenceOverridePolicy.js').default;
const fixtures = require('../../fixtures/bots/v2-tactical-overrides.json');

describe('V2 exact high-confidence tactical override fixtures', function() {
    function rawCard(uuid, controller, options = {}) {
        return {
            uuid, id: uuid, name: uuid, type: 'character', location: 'play area', controller,
            military: options.military ?? 3, political: options.political ?? 1,
            fate: options.fate ?? 0,
            bowed: false, inConflict: true, attacking: controller === 'Bot', defending: controller !== 'Bot',
            attachments: [], traits: []
        };
    }

    function inputFor(fixture) {
        const state = fixture.state;
        const phase = state.phase || 'conflict';
        const province = (location, broken = false) => ({
            uuid: `${location}:${broken}`, id: `${location}:${broken}`, type: 'province', location,
            facedown: false, visible: true, isBroken: broken, broken, inConflict: location === state.location,
            strength: location === 'stronghold province' ? 5 : 4
        });
        const opponentProvinces = {
            one: [province('province 1', state.opponentBroken >= 1)],
            two: [province('province 2', state.opponentBroken >= 2)],
            three: [province('province 3', state.opponentBroken >= 3)],
            four: [province('province 4', false)]
        };
        const botHand = fixture.candidates.filter((candidate) => candidate.kind === 'conflict-card')
            .map((candidate) => ({ uuid: candidate.name, id: candidate.name, name: candidate.target, type: 'event', location: 'hand' }));
        const opponentHand = Array.from({ length: state.opponentHand || 0 }, (_, index) => ({ uuid: `hidden:${index}` }));
        return {
            botName: 'Bot',
            context: {
                roundNumber: 3,
                conflictId: phase === 'conflict' ? `fixture:${fixture.id}` : undefined,
                opponentConflictDeck: fixture.liveSearch ? [{
                    id: 'opponent-pump', name: 'Opponent Pump', type: 'event', fate: 0, militaryBonus: 1
                }] : [],
                profile: { v2: {
                    ...(fixture.liveSearch ? {
                        liveTacticalSearch: true,
                        searchLimits: { depth: 3, beamWidth: 5, maxCandidates: 8, nodeBudget: 64 }
                    } : {}),
                    ...(state.packageValue ? { resources: { cards: {
                        'package-body': { type: 'character', printedCost: 1, value: state.packageValue }
                    } } } : {}),
                    highConfidenceGate: {
                        ...(state.packageValue ? { allowDynastyPackageOverride: true } : {}),
                        ...(fixture.id === 'resource-preservation'
                            ? { allowResourceReserveSubstitution: true } : {}),
                        ...(fixture.id === 'durable-free-attachment' ? { allowDurableAttachmentOverride: true } : {})
                    }
                } }
            },
            playerState: {
                phase,
                conflict: phase === 'conflict' ? {
                    id: `fixture:${fixture.id}`, attackerId: state.attackerId, defenderId: state.defenderId,
                    type: 'military', provinceLocation: state.location,
                    attackerSkill: state.attackerSkill, defenderSkill: state.defenderSkill,
                    provinceStrength: state.breakThreshold, breakThreshold: state.breakThreshold
                } : undefined,
                players: {
                    Bot: {
                        name: 'Bot', phase,
                        promptTitle: phase === 'dynasty' ? 'Play cards from provinces' : 'Conflict Action Window',
                        menuTitle: phase === 'dynasty' ? 'Click pass when done' : 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass-button' }],
                        stats: { fate: state.botFate, honor: 8 },
                        cardPiles: { hand: botHand, conflictDeck: [{}, {}, {}], dynastyDeck: [{}, {}], cardsInPlay: [rawCard('bot-char', 'Bot', { fate: state.botCharacterFate })] },
                        provinces: { one: [province('province 1')], two: [], three: [], four: [] },
                        strongholdProvince: [province('stronghold province')]
                    },
                    Opponent: {
                        name: 'Opponent', stats: { fate: 1, honor: 8 },
                        cardPiles: { hand: opponentHand, conflictDeck: [{}, {}, {}], dynastyDeck: [{}, {}], cardsInPlay: [rawCard('opponent-char', 'Opponent', { military: 4 })] },
                        provinces: opponentProvinces,
                        strongholdProvince: [province('stronghold province')]
                    }
                },
                rings: {}
            }
        };
    }

    function exactCandidate(spec) {
        const commandPreview = {
            command: spec.command || 'cardClicked',
            args: spec.args || [spec.name],
            target: spec.target || spec.name
        };
        const source = spec.kind === 'pass' ? undefined : {
            kind: 'card', instanceId: spec.name, cardId: spec.name, controllerId: 'Bot',
            location: spec.kind === 'in-play-ability' ? 'play area'
                : spec.kind === 'dynasty-purchase' ? 'province 1' : 'hand'
        };
        const effectTarget = spec.effects?.find((effect) =>
            ['skill', 'bow', 'ready', 'move', 'status', 'remove', 'attachment'].includes(effect.kind))?.target;
        const semanticTargets = spec.targets || (effectTarget ? [effectTarget] : []);
        const identity = {
            kind: spec.kind, source, targets: semanticTargets, commandPreview
        };
        const targetedEffect = effectTarget && semanticTargets[0]?.instanceId;
        const macro = spec.kind === 'dynasty-purchase' ? {
            id: `macro:fixture:${spec.name}`, currentStep: 0, abortPolicy: 'fallback-v1',
            startedAtSignature: 'fixture',
            steps: [
                { id: 'source', kind: 'source', semanticValue: spec.name, expected: {}, command: 'cardClicked', args: [spec.name] },
                { id: 'fate', kind: 'cost', semanticValue: String(spec.costs?.additionalFate || 0), expected: { promptTitle: 'Choose additional fate' }, command: 'menuButton', args: [String(spec.costs?.additionalFate || 0)] }
            ]
        } : targetedEffect ? {
            id: `macro:fixture:${spec.name}:${semanticTargets[0].instanceId}`,
            currentStep: 0, abortPolicy: 'fallback-v1', startedAtSignature: 'fixture',
            steps: [
                { id: 'source', kind: 'source', semanticValue: spec.name, expected: {}, command: 'cardClicked', args: [spec.name] },
                { id: 'target', kind: 'target', semanticValue: semanticTargets[0].instanceId, expected: {}, command: 'cardClicked', args: [semanticTargets[0].instanceId] }
            ]
        } : undefined;
        return {
            ...identity,
            id: candidateId(identity),
            macro,
            costs: spec.costs || {}, effects: spec.effects || [], prerequisites: [],
            tags: spec.tags || [], limits: [], uncertainty: 1 - spec.confidence,
            confidence: spec.confidence, proposer: `exact-fixture:${spec.name}`
        };
    }

    for(const fixture of fixtures) {
        it(`${fixture.id} executes a normal command with an inspectable proof`, function() {
            const candidates = fixture.candidates.map(exactCandidate);
            const contributor = { id: `fixture:${fixture.id}`, contribute: () => candidates };
            const registry = new CandidateRegistry([contributor, new V1FallbackContributor()]);
            const fallbackDecision = { ...fixture.v1, reason: `fixture-v1:${fixture.id}` };
            const fallback = { version: 'v1', seedState: 1, decide: () => fallbackDecision };
            const engine = new V2BotEngine(fallback, {
                playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
            }, { candidateRegistry: registry });

            const decision = engine.decide(inputFor(fixture));

            expect(decision).not.toEqual(fallbackDecision);
            expect(decision.command).toMatch(/^(cardClicked|menuButton|ringClicked|facedownCardClicked|menuItemClick)$/);
            expect(decision.args).toEqual(fixture.expectedArgs);
            expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
            expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
                reason: fixture.expectedReason,
                evidence: jasmine.any(Array)
            }));
            expect(engine.lastDecisionTrace.planner.confidence).toBeGreaterThanOrEqual(0.9);
            expect(engine.lastDecisionTrace.planner.scoreGap).toBeGreaterThanOrEqual(3);
            expect(engine.lastDecisionTrace.planner.budget.exhausted).toBeFalse();
        });
    }

    it('keeps the repeated dynasty-package experiment disabled by default', function() {
        const fixture = fixtures.find((entry) => entry.id === 'joint-dynasty-package');
        const candidates = fixture.candidates.map(exactCandidate);
        const registry = new CandidateRegistry([
            { id: 'fixture:disabled-dynasty-package', contribute: () => candidates },
            new V1FallbackContributor()
        ]);
        const fallbackDecision = { ...fixture.v1, reason: 'fixture-v1:disabled-dynasty-package' };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        }, { candidateRegistry: registry });
        const input = inputFor(fixture);
        input.context.profile.v2.highConfidenceGate.allowDynastyPackageOverride = false;

        expect(engine.decide(input)).toEqual(fallbackDecision);
        expect(engine.lastDecisionTrace.selectedBy).toBe('fallback');
        expect(engine.lastDecisionTrace.planner.overrideProof).toBeUndefined();
        expect(engine.lastDecisionTrace.fallbackReason).toBe('below-v2-confidence-gate');
    });

    it('keeps the empty-target durable attachment experiment disabled by default', function() {
        const fixture = fixtures.find((entry) => entry.id === 'durable-free-attachment');
        const candidates = fixture.candidates.map(exactCandidate);
        const registry = new CandidateRegistry([
            { id: 'fixture:disabled-durable-attachment', contribute: () => candidates },
            new V1FallbackContributor()
        ]);
        const fallbackDecision = { ...fixture.v1, reason: 'fixture-v1:disabled-durable-attachment' };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        }, { candidateRegistry: registry });
        const input = inputFor(fixture);
        delete input.context.profile.v2.highConfidenceGate.allowDurableAttachmentOverride;

        expect(engine.decide(input)).toEqual(fallbackDecision);
        expect(engine.lastDecisionTrace.selectedBy).toBe('fallback');
        expect(engine.lastDecisionTrace.planner.overrideProof).toBeUndefined();
        expect(engine.lastDecisionTrace.fallbackReason).toBe('below-v2-confidence-gate');
    });

    it('owns an exact no-macro V1 command agreement without changing the click', function() {
        const fixture = {
            id: 'exact-command-agreement', candidates: [],
            state: {
                phase: 'conflict', attackerId: 'Bot', defenderId: 'Opponent',
                location: 'province 1', attackerSkill: 5, defenderSkill: 0,
                breakThreshold: 4, botFate: 3
            }
        };
        const agreement = exactCandidate({
            name: 'pass-agreement', kind: 'pass', command: 'menuButton',
            args: ['pass', 'pass-button'], target: 'Pass', confidence: 1
        });
        const fallbackDecision = {
            command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'fixture-v1-pass'
        };
        const registry = new CandidateRegistry([
            { id: 'fixture:exact-command-agreement', contribute: () => [agreement] },
            new V1FallbackContributor()
        ]);
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        }, { candidateRegistry: registry });

        const decision = engine.decide(inputFor(fixture));
        expect(decision).toEqual(jasmine.objectContaining({
            command: fallbackDecision.command, args: fallbackDecision.args, target: fallbackDecision.target
        }));
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'semantic-agreement',
            evidence: jasmine.arrayContaining(['exact-v1-command-agreement', 'no-behavior-change'])
        }));
    });

    it('keeps incomplete participant-set clicks on V1 even under terminal pressure', function() {
        const fixture = {
            id: 'participant-set-loop-guard',
            candidates: [],
            state: {
                phase: 'conflict', attackerId: 'Opponent', defenderId: 'Bot',
                location: 'stronghold province', attackerSkill: 12, defenderSkill: 2,
                breakThreshold: 5, botFate: 3
            }
        };
        const target = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const defender = exactCandidate({
            name: 'bot-char', kind: 'defender-set', target: 'Bot Character',
            targets: [target], tags: ['terminal', 'defense'], confidence: 0.99
        });
        const fallbackDecision = {
            command: 'menuButton', args: ['done', 'pass-button'], target: 'Done', reason: 'fixture-v1-finish-defenders'
        };
        const registry = new CandidateRegistry([
            { id: 'fixture:participant-set-loop-guard', contribute: () => [defender] },
            new V1FallbackContributor()
        ]);
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        }, { candidateRegistry: registry });

        expect(engine.decide(inputFor(fixture))).toEqual(fallbackDecision);
        expect(engine.lastDecisionTrace.selectedBy).toBe('fallback');
        expect(engine.lastDecisionTrace.planner.overrideProof).toBeUndefined();
    });

    it('does not replace an unbound V1 pump with an equivalent bound card', function() {
        const target = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const bound = exactCandidate({
            name: 'banzai', kind: 'conflict-card', target: 'Banzai!', targets: [target],
            costs: { cards: 1 }, tags: ['offense'], confidence: 0.99,
            effects: [{ kind: 'skill', military: 2, target, confidence: 1 }]
        });
        const v1Pump = exactCandidate({
            name: 'hurricane-punch', kind: 'conflict-card', target: 'Hurricane Punch',
            costs: { cards: 1 }, tags: ['offense'], confidence: 0.6,
            effects: [{ kind: 'skill', military: 2, confidence: 0.6 }]
        });
        const state = {
            perspectivePlayerId: 'Bot',
            conflict: {
                attackerId: 'Bot', defenderId: 'Opponent', type: 'military',
                provinceLocation: 'stronghold province', attackerSkill: 16, defenderSkill: 12,
                breakThreshold: 5
            },
            characters: [{
                instanceId: 'bot-char', cardId: 'bot-char', controllerId: 'Bot',
                military: 8, political: 6, participating: true, bowed: false, ready: true
            }],
            opportunities: { remainingByPlayer: { Bot: { military: 1, political: 0 } } }
        };
        const proof = new HighConfidenceOverridePolicy().evaluate({
            state,
            preference: { candidate: bound, score: { terminalRank: 5, scalar: 4000 } },
            v1Candidate: v1Pump,
            scoreGap: 3994,
            v1Vetoes: [],
            search: {
                complete: true, exhausted: false, firstCandidate: bound,
                principalLine: [{ candidateId: bound.id }]
            },
            candidates: [bound, v1Pump]
        });

        expect(proof.accepted).toBeFalse();
        expect(proof.evidence).toContain('no-fixture-proven-override');
    });

    it('keeps an ordinary multi-body defense on V1 when V1 has not committed', function() {
        const target = (instanceId) => ({ kind: 'character', instanceId, cardId: instanceId, controllerId: 'Bot' });
        const targets = [target('first-defender'), target('second-defender')];
        const identity = {
            kind: 'defender-set', mode: 'prevent-break:4:0:4', targets,
            commandPreview: { command: 'cardClicked', args: ['first-defender'], target: 'first-defender' }
        };
        const candidate = {
            ...identity, id: candidateId(identity), proposer: 'participant-set-planner',
            macro: {
                id: 'macro:ordinary-multi-body', currentStep: 0, abortPolicy: 'fallback-v1',
                startedAtSignature: 'fixture', steps: [
                    { id: 'first', kind: 'target', semanticValue: 'first-defender', command: 'cardClicked', args: ['first-defender'] },
                    { id: 'second', kind: 'target', semanticValue: 'second-defender', command: 'cardClicked', args: ['second-defender'] },
                    { id: 'done', kind: 'confirmation', semanticValue: 'Done', command: 'menuButton', args: ['done'] }
                ]
            },
            costs: {},
            effects: targets.map((entry) => ({ kind: 'move', destination: 'conflict', target: entry, confidence: 1 })),
            prerequisites: [], tags: ['defense'], limits: [], uncertainty: 0.02, confidence: 0.98
        };
        const v1Done = {
            id: 'v1-done', kind: 'pass', targets: [], commandPreview: { command: 'menuButton', args: ['done'], target: 'Done' },
            costs: {}, effects: [], prerequisites: [], tags: [], limits: [], uncertainty: 0.5, confidence: 0.5,
            proposer: 'v1-fallback'
        };
        const state = {
            perspectivePlayerId: 'Bot',
            conflict: {
                attackerId: 'Opponent', defenderId: 'Bot', type: 'military', provinceLocation: 'province 1',
                attackerSkill: 7, defenderSkill: 0, breakThreshold: 4
            },
            characters: targets.map((entry) => ({
                ...entry, military: 2, political: 1, participating: false, bowed: false, ready: true,
                noBowAfterConflict: false, canReady: false
            })),
            players: { Bot: { id: 'Bot' }, Opponent: { id: 'Opponent' } },
            hands: [{ playerId: 'Opponent', size: 0 }],
            opportunities: { remainingByPlayer: { Bot: { military: 1, political: 1 } } }
        };
        const proof = new HighConfidenceOverridePolicy().evaluate({
            state,
            preference: { candidate, score: { terminalRank: 1, scalar: 10 } },
            v1Candidate: v1Done,
            scoreGap: 10,
            v1Vetoes: [],
            search: { complete: true, exhausted: false, firstCandidate: candidate, principalLine: [] },
            candidates: [candidate, v1Done]
        });

        expect(proof.accepted).toBeFalse();
        expect(proof.evidence).toContain('incomplete-or-unproven-defender-set');
    });

    it('preserves V1 intentional ordinary-conflict concessions', function() {
        const target = { kind: 'character', instanceId: 'defender', cardId: 'defender', controllerId: 'Bot' };
        const identity = {
            kind: 'defender-set', mode: 'prevent-break:2:0:2', targets: [target],
            commandPreview: { command: 'cardClicked', args: ['defender'], target: 'defender' }
        };
        const candidate = {
            ...identity, id: candidateId(identity), proposer: 'participant-set-planner',
            macro: {
                id: 'macro:intentional-concession', currentStep: 0, abortPolicy: 'fallback-v1',
                startedAtSignature: 'fixture', steps: [
                    { id: 'defender', kind: 'target', semanticValue: 'defender', command: 'cardClicked', args: ['defender'] },
                    { id: 'done', kind: 'confirmation', semanticValue: 'Done', command: 'menuButton', args: ['done'] }
                ]
            },
            costs: {}, effects: [{ kind: 'move', destination: 'conflict', target, confidence: 1 }],
            prerequisites: [], tags: ['defense'], limits: [], uncertainty: 0.02, confidence: 0.98
        };
        const v1Concede = {
            id: 'v1-concede', kind: 'pass', mode: 'aggressive-concede-defense', targets: [],
            commandPreview: { command: 'menuButton', args: ['done'], target: 'Done' },
            costs: {}, effects: [], prerequisites: [], tags: [], limits: [], uncertainty: 0.5, confidence: 0.5,
            proposer: 'v1-fallback'
        };
        const state = {
            perspectivePlayerId: 'Bot',
            conflict: {
                attackerId: 'Opponent', defenderId: 'Bot', type: 'military', provinceLocation: 'province 1',
                attackerSkill: 4, defenderSkill: 0, breakThreshold: 3
            },
            characters: [{
                ...target, military: 2, political: 1, participating: false, bowed: false, ready: true,
                noBowAfterConflict: false, canReady: false
            }],
            players: { Bot: { id: 'Bot' }, Opponent: { id: 'Opponent' } },
            hands: [{ playerId: 'Opponent', size: 0 }],
            opportunities: { remainingByPlayer: { Bot: { military: 1, political: 1 } } }
        };
        const proof = new HighConfidenceOverridePolicy().evaluate({
            state,
            preference: { candidate, score: { terminalRank: 1, scalar: 10 } },
            v1Candidate: v1Concede,
            scoreGap: 10,
            v1Vetoes: [],
            search: { complete: true, exhausted: false, firstCandidate: candidate, principalLine: [] },
            candidates: [candidate, v1Concede]
        });

        expect(proof.accepted).toBeFalse();
        expect(proof.evidence).toContain('v1-intentional-concession:aggressive-concede-defense');
    });

    it('keeps generic resource-reserve substitutions experimental', function() {
        const replacement = exactCandidate({
            name: 'replacement', kind: 'conflict-card', target: 'Replacement', confidence: 0.99,
            effects: [{ kind: 'fate', amount: 1, confidence: 1 }]
        });
        const v1 = exactCandidate({ name: 'v1-resource-action', kind: 'conflict-card', confidence: 0.6 });
        const input = {
            state: {
                perspectivePlayerId: 'Bot', conflict: undefined, characters: [],
                players: { Bot: { id: 'Bot' }, Opponent: { id: 'Opponent' } },
                opportunities: { remainingByPlayer: { Bot: { military: 1, political: 1 } } }
            },
            preference: { candidate: replacement, score: { terminalRank: 1, scalar: 10 } },
            v1Candidate: v1,
            scoreGap: 10,
            v1Vetoes: [{ candidateId: v1.id, code: 'hard-fate-reserve', reason: 'fixture' }],
            search: { complete: true, exhausted: false, firstCandidate: replacement, principalLine: [] },
            candidates: [replacement, v1]
        };
        const policy = new HighConfidenceOverridePolicy();

        const disabled = policy.evaluate(input);
        const experimental = policy.evaluate({
            ...input, profile: { allowResourceReserveSubstitution: true }
        });

        expect(disabled.accepted).toBeFalse();
        expect(disabled.evidence).toContain('no-fixture-proven-override');
        expect(experimental).toEqual(jasmine.objectContaining({
            accepted: true, reason: 'resource-preservation',
            evidence: ['v1-veto:hard-fate-reserve']
        }));
    });

    it('moves a fresh participant only when later conflict allocation is protected', function() {
        const fixture = {
            id: 'movement-allocation-safety', candidates: [],
            state: {
                phase: 'conflict', attackerId: 'Bot', defenderId: 'Opponent',
                location: 'province 1', attackerSkill: 2, defenderSkill: 4,
                breakThreshold: 4, botFate: 3
            }
        };
        const target = { kind: 'character', instanceId: 'bot-char', controllerId: 'Bot' };
        const move = exactCandidate({
            name: 'move-source', kind: 'in-play-ability', target: 'Move Source',
            targets: [target], tags: ['payoff'], confidence: 0.99,
            effects: [{ kind: 'move', destination: 'conflict', duration: 'conflict', target, confidence: 1 }]
        });
        const fallbackDecision = {
            command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'fixture-v1-pass'
        };
        const registry = new CandidateRegistry([
            { id: 'fixture:movement-allocation-safety', contribute: () => [move] },
            new V1FallbackContributor()
        ]);
        const input = inputFor(fixture);
        const character = input.playerState.players.Bot.cardPiles.cardsInPlay[0];
        character.military = 6;
        character.inConflict = false;
        character.attacking = false;
        character.fate = 1;
        character.canReady = false;
        input.context.conflictPlanningCharacters = {
            self: [{ uuid: 'bot-char', military: 6, political: 1, ready: true,
                inConflict: false, bowsAfterConflict: true }],
            opponent: [{ uuid: 'opponent-char', military: 4, political: 1, ready: true,
                inConflict: true }]
        };
        input.context.remainingConflictOpportunities = {
            Bot: { military: 1, political: 1 }, Opponent: { military: 1, political: 1 }
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        }, { candidateRegistry: registry });

        expect(engine.decide(input)).toEqual(fallbackDecision);
        expect(engine.lastDecisionTrace.selectedBy).toBe('fallback');
        expect(engine.lastDecisionTrace.planner.overrideProof).toBeUndefined();

        input.context.remainingConflictOpportunities = {
            Bot: { military: 1, political: 0 }, Opponent: { military: 0, political: 0 }
        };
        const finalConflictEngine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        }, { candidateRegistry: registry });
        const finalDecision = finalConflictEngine.decide(input);
        expect(finalDecision).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['move-source']
        }));
        expect(finalConflictEngine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'minimum-sufficient-response',
            evidence: jasmine.arrayContaining(['future-conflict-allocation-safe'])
        }));
    });

    it('replaces V1 overdefense with an exact minimum defender set and completes Done', function() {
        const selectableCharacter = (uuid, military, fate = 0) => ({
            uuid, id: uuid, name: uuid, type: 'character', location: 'play area', controller: 'Bot',
            military, political: 1, fate, bowed: false, inConflict: false, selectable: true,
            attachments: [], traits: []
        });
        const cheap = selectableCharacter('cheap-defender', 4);
        const exactWin = selectableCharacter('exact-win-defender', 8);
        const expensive = selectableCharacter('expensive-defender', 12, 3);
        const fixture = {
            id: 'complete-defender-set', candidates: [],
            state: {
                phase: 'conflict', attackerId: 'Opponent', defenderId: 'Bot',
                location: 'province 1', attackerSkill: 7, defenderSkill: 0,
                breakThreshold: 4, botFate: 3
            }
        };
        const input = inputFor(fixture);
        input.playerState.players.Bot.promptTitle = 'Choose defenders';
        input.playerState.players.Bot.menuTitle = '';
        input.playerState.players.Bot.buttons = [{ text: 'Done', arg: 'done', uuid: 'done-button' }];
        input.playerState.players.Bot.cardPiles.cardsInPlay = [cheap, exactWin, expensive];
        input.context.legalDirectCardUuids = {
            'cheap-defender': true, 'exact-win-defender': true, 'expensive-defender': true
        };
        input.context.conflictPlanningCharacters = {
            self: [
                { uuid: 'cheap-defender', military: 4, political: 1, ready: true, inConflict: false, bowsAfterConflict: true },
                { uuid: 'exact-win-defender', military: 8, political: 1, ready: true, inConflict: false, bowsAfterConflict: true },
                { uuid: 'expensive-defender', military: 12, political: 1, ready: true, inConflict: false, bowsAfterConflict: true }
            ],
            opponent: [{ uuid: 'opponent-char', military: 7, political: 1, ready: true, inConflict: true }]
        };
        input.context.profile.v2.highConfidenceGate = { allowExactDefenderSetOverride: true };
        const fallbackDecision = {
            command: 'cardClicked', args: ['expensive-defender'], target: 'expensive-defender', reason: 'fixture-v1-overdefense'
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });

        expect(engine.decide(input)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['exact-win-defender']
        }));
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'minimum-sufficient-response',
            evidence: jasmine.arrayContaining(['complete-participant-set-macro', 'minimum-inclusion-exact-conflict-win'])
        }));

        exactWin.inConflict = true;
        input.playerState.conflict.defenderSkill = 8;
        input.context.conflictPlanningCharacters.self[1].inConflict = true;
        const completion = engine.decide(input);
        expect(completion).toEqual(jasmine.objectContaining({
            command: 'menuButton', reason: 'v2-macro-confirmation'
        }));
        expect(completion.args.slice(0, 2)).toEqual(['done', 'done-button']);
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
    });

    it('defaults only to the exact minimum positive break-prevention defender set', function() {
        const selectableCharacter = (uuid, military, fate = 0) => ({
            uuid, id: uuid, name: uuid, type: 'character', location: 'play area', controller: 'Bot',
            military, political: 1, fate, bowed: false, inConflict: false, selectable: true,
            attachments: [], traits: []
        });
        const exactSave = selectableCharacter('exact-save-defender', 4);
        const exactWin = selectableCharacter('exact-win-defender', 8, 2);
        const fixture = {
            id: 'narrow-break-prevention-set', candidates: [],
            state: {
                phase: 'conflict', attackerId: 'Opponent', defenderId: 'Bot',
                location: 'province 1', attackerSkill: 7, defenderSkill: 0,
                breakThreshold: 4, botFate: 3
            }
        };
        const input = inputFor(fixture);
        input.playerState.players.Bot.promptTitle = 'Choose defenders';
        input.playerState.players.Bot.menuTitle = '';
        input.playerState.players.Bot.buttons = [{ text: 'Done', arg: 'done', uuid: 'done-button' }];
        input.playerState.players.Bot.cardPiles.cardsInPlay = [exactSave, exactWin];
        input.context.legalDirectCardUuids = { 'exact-save-defender': true, 'exact-win-defender': true };
        input.context.conflictPlanningCharacters = {
            self: [
                { uuid: 'exact-save-defender', military: 4, political: 1, ready: true,
                    inConflict: false, bowsAfterConflict: true },
                { uuid: 'exact-win-defender', military: 8, political: 1, ready: true,
                    inConflict: false, bowsAfterConflict: true }
            ],
            opponent: [{ uuid: 'opponent-char', military: 7, political: 1, ready: true, inConflict: true }]
        };
        const fallbackDecision = {
            command: 'cardClicked', args: ['exact-win-defender'], target: 'exact-win-defender',
            reason: 'fixture-v1-overdefense'
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });

        expect(engine.decide(input)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['exact-save-defender']
        }));
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'minimum-sufficient-response',
            evidence: jasmine.arrayContaining([
                'minimum-inclusion-exact-break-prevention', 'base-required:4',
                'response-reserve:0', 'required:4', 'selected:4'
            ])
        }));
        const modes = engine.lastDecisionTrace.planner.candidates
            .filter((candidate) => candidate.kind === 'defender-set')
            .map((candidate) => candidate.target);
        expect(modes).not.toContain('exact-win-defender');

        const waterInput = JSON.parse(JSON.stringify(input));
        const vulnerable = selectableCharacter('water-vulnerable', 0);
        vulnerable.political = 4;
        waterInput.playerState.conflict.ring = 'water';
        waterInput.playerState.players.Bot.cardPiles.cardsInPlay.push(vulnerable);
        waterInput.context.legalDirectCardUuids['water-vulnerable'] = true;
        waterInput.context.conflictPlanningCharacters.self.push({
            uuid: 'water-vulnerable', military: 0, political: 4, ready: true,
            inConflict: false, bowsAfterConflict: true
        });
        const waterEngine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        expect(waterEngine.decide(waterInput)).toEqual(fallbackDecision);
        expect(waterEngine.lastDecisionTrace.selectedBy).toBe('fallback');
    });

    it('uses a cheaper single defender to turn V1 break prevention into an exact conflict win', function() {
        const selectableCharacter = (uuid, military, fate = 0) => ({
            uuid, id: uuid, name: uuid, type: 'character', location: 'play area', controller: 'Bot',
            military, political: 0, fate, bowed: false, inConflict: false, selectable: true,
            attachments: [], traits: []
        });
        const v1Defender = selectableCharacter('v1-expiring-four', 4, 2);
        const ringDenier = selectableCharacter('ring-denier', 8);
        const fixture = {
            id: 'cost-neutral-conflict-win', candidates: [],
            state: {
                phase: 'conflict', attackerId: 'Opponent', defenderId: 'Bot',
                location: 'province 1', attackerSkill: 7, defenderSkill: 0,
                breakThreshold: 4, botFate: 3
            }
        };
        const input = inputFor(fixture);
        input.playerState.players.Bot.promptTitle = 'Choose defenders';
        input.playerState.players.Bot.menuTitle = '';
        input.playerState.players.Bot.buttons = [{ text: 'Done', arg: 'done', uuid: 'done-button' }];
        input.playerState.players.Bot.cardPiles.cardsInPlay = [v1Defender, ringDenier];
        input.context.legalDirectCardUuids = { 'v1-expiring-four': true, 'ring-denier': true };
        input.context.conflictPlanningCharacters = {
            self: [
                { uuid: 'v1-expiring-four', military: 4, political: 0, fate: 2, ready: true,
                    inConflict: false, bowsAfterConflict: true },
                { uuid: 'ring-denier', military: 8, political: 0, fate: 0, ready: true,
                    inConflict: false, bowsAfterConflict: true }
            ],
            opponent: [{ uuid: 'opponent-char', military: 7, political: 1, ready: true, inConflict: true }]
        };
        const fallbackDecision = {
            command: 'cardClicked', args: ['v1-expiring-four'], target: 'v1-expiring-four',
            reason: 'fixture-v1-break-prevention'
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });

        expect(engine.decide(input)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['ring-denier']
        }));
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'minimum-sufficient-response',
            evidence: jasmine.arrayContaining([
                'minimum-inclusion-cost-neutral-conflict-win',
                'cost-neutral-ring-denial',
                'selected-commitment-cost:8',
                'v1-commitment-cost:10'
            ])
        }));

        ringDenier.inConflict = true;
        input.playerState.conflict.defenderSkill = 8;
        input.context.conflictPlanningCharacters.self[1].inConflict = true;
        const completion = engine.decide(input);
        expect(completion).toEqual(jasmine.objectContaining({
            command: 'menuButton', reason: 'v2-macro-confirmation'
        }));
        expect(completion.args.slice(0, 2)).toEqual(['done', 'done-button']);
    });

    it('replaces a costly final unopposed attacker and resolves the later Initiate Conflict button', function() {
        const selectableCharacter = (uuid, military, fate = 0) => ({
            uuid, id: uuid, name: uuid, type: 'character', location: 'play area', controller: 'Bot',
            military, political: 1, fate, bowed: false, inConflict: false, attacking: false,
            defending: false, selectable: true, attachments: [], traits: []
        });
        const cheap = selectableCharacter('cheap-attacker', 4);
        const tower = selectableCharacter('tower-attacker', 8, 3);
        const fixture = {
            id: 'complete-attacker-set', candidates: [],
            state: {
                phase: 'conflict', attackerId: 'Bot', defenderId: 'Opponent',
                location: 'province 1', attackerSkill: 0, defenderSkill: 0,
                breakThreshold: 4, botFate: 3, opponentHand: 0
            }
        };
        const input = inputFor(fixture);
        input.playerState.players.Bot.promptTitle = 'Military Fire Conflict';
        input.playerState.players.Bot.menuTitle = 'Choose attackers';
        input.playerState.players.Bot.buttons = [{ text: 'Pass Conflict', arg: 'pass', uuid: 'pass-button' }];
        input.playerState.players.Bot.cardPiles.cardsInPlay = [cheap, tower];
        input.playerState.players.Opponent.stats.fate = 0;
        input.playerState.players.Opponent.cardPiles.hand = [];
        input.playerState.players.Opponent.cardPiles.cardsInPlay = [];
        input.context.legalDirectCardUuids = { 'cheap-attacker': true, 'tower-attacker': true };
        input.context.remainingConflictOpportunities = {
            Bot: { military: 1, political: 0 }, Opponent: { military: 1, political: 1 }
        };
        input.context.conflictPlanningCharacters = {
            self: [
                { uuid: 'cheap-attacker', military: 4, political: 1, ready: true, inConflict: false, bowsAfterConflict: true },
                { uuid: 'tower-attacker', military: 8, political: 1, ready: true, inConflict: false, bowsAfterConflict: true }
            ],
            opponent: []
        };
        input.context.profile.v2.highConfidenceGate = { allowExactAttackerSetOverride: true };
        const fallbackDecision = {
            command: 'cardClicked', args: ['tower-attacker'], target: 'tower-attacker', reason: 'fixture-v1-overattack'
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });

        expect(engine.decide(input)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['cheap-attacker']
        }));
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'resource-preservation',
            evidence: jasmine.arrayContaining([
                'complete-participant-set-macro',
                'minimum-inclusion-unopposed-last-conflict-break'
            ])
        }));

        cheap.inConflict = true;
        input.playerState.conflict.attackerSkill = 4;
        input.context.conflictPlanningCharacters.self[0].inConflict = true;
        input.playerState.players.Bot.menuTitle = 'Military skill: 4';
        input.playerState.players.Bot.buttons = [{
            text: 'Initiate Conflict', arg: 'done', uuid: 'initiate-button'
        }];
        const completion = engine.decide(input);
        expect(completion).toEqual(jasmine.objectContaining({
            command: 'menuButton', reason: 'v2-macro-confirmation'
        }));
        expect(completion.args.slice(0, 2)).toEqual(['done', 'initiate-button']);
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
    });

    it('attacks an exposed stronghold with enough skill for every public ready defender', function() {
        const selectableCharacter = (uuid, military, options = {}) => ({
            uuid, id: uuid, name: uuid, type: 'character', location: 'play area',
            controller: options.controller || 'Bot', military, political: 1, fate: options.fate || 0,
            bowed: false, inConflict: false, attacking: false, defending: false,
            selectable: options.selectable !== false, attachments: [], traits: []
        });
        const alpha = selectableCharacter('alpha-attacker', 7);
        const beta = selectableCharacter('beta-attacker', 6);
        const tower = selectableCharacter('tower-attacker', 16, { fate: 3 });
        const defender = selectableCharacter('public-defender', 3, {
            controller: 'Opponent', selectable: false
        });
        const fixture = {
            id: 'public-stronghold-attacker-set', candidates: [],
            state: {
                phase: 'conflict', attackerId: 'Bot', defenderId: 'Opponent',
                location: 'stronghold province', attackerSkill: 0, defenderSkill: 0,
                breakThreshold: 5, botFate: 3, opponentHand: 1
            }
        };
        const input = inputFor(fixture);
        input.playerState.players.Bot.promptTitle = 'Choose attackers';
        input.playerState.players.Bot.menuTitle = '';
        input.playerState.players.Bot.buttons = [{ text: 'Done', arg: 'done', uuid: 'done-button' }];
        input.playerState.players.Bot.cardPiles.cardsInPlay = [alpha, beta, tower];
        input.playerState.players.Opponent.stats.fate = 1;
        input.playerState.players.Opponent.cardPiles.hand = [{ uuid: 'hidden:stronghold-response' }];
        input.playerState.players.Opponent.cardPiles.cardsInPlay = [defender];
        input.context.legalDirectCardUuids = {
            'alpha-attacker': true, 'beta-attacker': true, 'tower-attacker': true
        };
        input.context.remainingConflictOpportunities = {
            Bot: { military: 1, political: 0 }, Opponent: { military: 1, political: 1 }
        };
        input.context.conflictPlanningCharacters = {
            self: [
                { uuid: 'alpha-attacker', military: 7, political: 1, ready: true, inConflict: false, bowsAfterConflict: true },
                { uuid: 'beta-attacker', military: 6, political: 1, ready: true, inConflict: false, bowsAfterConflict: true },
                { uuid: 'tower-attacker', military: 16, political: 1, ready: true, inConflict: false, bowsAfterConflict: true }
            ],
            opponent: [
                { uuid: 'public-defender', military: 3, political: 1, ready: true, inConflict: false, bowsAfterConflict: true }
            ]
        };
        const fallbackDecision = {
            command: 'cardClicked', args: ['tower-attacker'], target: 'tower-attacker', reason: 'fixture-v1-overattack'
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });

        expect(engine.decide(input)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['alpha-attacker']
        }));
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'terminal-play',
            evidence: jasmine.arrayContaining([
                'minimum-inclusion-pessimistic-stronghold-break',
                'public-defense-hand-fate-response-budgeted',
                'base-required:5', 'public-defense:3', 'response-reserve:5',
                'required:13', 'selected:13'
            ])
        }));

        alpha.inConflict = true;
        input.playerState.conflict.attackerSkill = 7;
        input.context.conflictPlanningCharacters.self[0].inConflict = true;
        expect(engine.decide(input)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['beta-attacker'], reason: 'v2-macro-target'
        }));

        beta.inConflict = true;
        input.playerState.conflict.attackerSkill = 13;
        input.context.conflictPlanningCharacters.self[1].inConflict = true;
        const completion = engine.decide(input);
        expect(completion).toEqual(jasmine.objectContaining({
            command: 'menuButton', reason: 'v2-macro-confirmation'
        }));
        expect(completion.args.slice(0, 2)).toEqual(['done', 'done-button']);
    });
});
