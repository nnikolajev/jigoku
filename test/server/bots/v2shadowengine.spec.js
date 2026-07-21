const V1PolicyAdapter = require('../../../build/server/game/bots/V1PolicyAdapter.js').default;
const V2BotEngine = require('../../../build/server/game/bots/v2/V2BotEngine.js').default;
const golden = require('../../fixtures/bots/v1-golden-decisions.json');

describe('V2 shadow and confidence gating', function() {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const inputFor = (prompt, configuration) => ({
        playerState: clone(prompt.playerState), botName: golden.botName,
        context: { ...(prompt.context || {}), ...(configuration.context || {}) }
    });

    it('runs shadow candidates and scoring while executing the exact V1 golden commands', function() {
        for(const configuration of golden.configurations) {
            const direct = new V1PolicyAdapter(configuration.config);
            const shadow = new V2BotEngine(
                new V1PolicyAdapter(configuration.config),
                { playerName: golden.botName, ...configuration.config, engineVersion: 'v2', v2Mode: 'shadow', traceLevel: 'benchmark' }
            );
            for(const prompt of golden.prompts) {
                const input = inputFor(prompt, configuration);
                expect(shadow.decide(input)).withContext(`${configuration.id}/${prompt.id}`).toEqual(direct.decide(input));
                expect(shadow.lastDecisionTrace.selectedBy).toBe('fallback');
                expect(shadow.lastDecisionTrace.fallbackReason).toBe('shadow-mode');
                expect(shadow.lastDecisionTrace.planner).toEqual(jasmine.objectContaining({
                    mode: 'shadow', v1Action: shadow.lastDecisionTrace.decision,
                    candidateCount: jasmine.any(Number), disagreementType: jasmine.any(String)
                }));
                expect(shadow.lastDecisionTrace.planner.candidates).toEqual(jasmine.any(Array));
            }
        }
    });

    it('keeps decisions identical across production, benchmark, and research trace levels', function() {
        const configuration = golden.configurations[0];
        const prompt = golden.prompts.find((entry) => entry.class === 'conflict');
        const engines = ['production', 'benchmark', 'research'].map((traceLevel) => new V2BotEngine(
            new V1PolicyAdapter(configuration.config),
            { playerName: golden.botName, ...configuration.config, engineVersion: 'v2', v2Mode: 'shadow', traceLevel }
        ));
        const decisions = engines.map((engine) => engine.decide(inputFor(prompt, configuration)));
        expect(decisions[1]).toEqual(decisions[0]);
        expect(decisions[2]).toEqual(decisions[0]);
        expect(engines[0].lastDecisionTrace.planner.candidates).toBeUndefined();
        expect(engines[0].lastDecisionTrace.planner.searchNodes).toBeUndefined();
        expect(engines[0].lastDecisionTrace.planner.replay).toBeUndefined();
        expect(engines[1].lastDecisionTrace.planner.candidates[0].scoreVector).toBeUndefined();
        expect(engines[1].lastDecisionTrace.planner.searchNodes).toBeUndefined();
        expect(engines[1].lastDecisionTrace.planner.replay).toBeUndefined();
        expect(engines[2].lastDecisionTrace.planner.candidates[0]).toEqual(jasmine.objectContaining({
            scoreVector: jasmine.any(Object), explanation: jasmine.any(Array)
        }));
        expect(engines[2].lastDecisionTrace.planner.searchNodes).toEqual(jasmine.any(Array));
        expect(engines[2].lastDecisionTrace.planner.rootEvaluations).toEqual(jasmine.any(Array));
        expect(engines[2].lastDecisionTrace.planner.replay).toEqual(jasmine.objectContaining({
            planningState: jasmine.any(Object), candidateIds: jasmine.any(Array), configuration: jasmine.any(Object)
        }));
    });

    it('records V2 preference, V1 action, score gap, confidence, fallback, and acceptance', function() {
        const configuration = golden.configurations[0];
        const prompt = golden.prompts.find((entry) => entry.class === 'bid');
        const engine = new V2BotEngine(
            new V1PolicyAdapter(configuration.config),
            { playerName: golden.botName, ...configuration.config, engineVersion: 'v2', v2Mode: 'shadow', traceLevel: 'research' }
        );
        engine.decide(inputFor(prompt, configuration));
        expect(engine.lastDecisionTrace.planner).toEqual(jasmine.objectContaining({
            v2PreferenceId: jasmine.any(String), v2Preference: jasmine.any(Object),
            v1Action: jasmine.any(Object), scoreGap: jasmine.any(Number),
            confidence: jasmine.any(Number), fallbackReason: 'shadow-mode'
        }));
        engine.observeDecision('success', 'accepted-by-controller');
        expect(engine.lastDecisionTrace.acceptance).toBe('success');
        expect(engine.lastDecisionTrace.planner).toEqual(jasmine.objectContaining({
            acceptance: 'success', acceptanceReason: 'accepted-by-controller'
        }));
    });

    it('enables only a high-confidence semantic stronghold defense correction', function() {
        const fallback = {
            version: 'v1', seedState: 7,
            decide: () => ({ command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'synthetic-v1-pass' })
        };
        const engine = new V2BotEngine(fallback, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const input = {
            botName: 'Bot', context: { roundNumber: 3, conflictId: 'stronghold-conflict' },
            playerState: {
                phase: 'conflict',
                conflict: {
                    id: 'stronghold-conflict', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
                    provinceLocation: 'stronghold province', attackerSkill: 8, defenderSkill: 0,
                    provinceStrength: 5, breakThreshold: 5
                },
                players: {
                    Bot: {
                        name: 'Bot', phase: 'conflict', promptTitle: 'Military Fire Conflict: 8 vs 0', menuTitle: 'Choose defenders',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass-button' }],
                        stats: { fate: 1, honor: 7 },
                        cardPiles: { hand: [], conflictDeck: [{}, {}], cardsInPlay: [{
                            uuid: 'last-guard', id: 'last-guard', name: 'Last Guard', type: 'character', location: 'play area',
                            military: 3, political: 1, bowed: false, selectable: true, attachments: []
                        }] },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [{ uuid: 'own-sh', type: 'province', location: 'stronghold province', inConflict: true, strength: 5 }]
                    },
                    Opponent: {
                        name: 'Opponent', stats: { fate: 0, honor: 8 },
                        cardPiles: { hand: [], conflictDeck: [{}, {}], cardsInPlay: [] },
                        provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: []
                    }
                }, rings: {}
            }
        };

        const decision = engine.decide(input);

        expect(decision).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['last-guard'], target: 'Last Guard'
        }));
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
        expect(engine.lastDecisionTrace.fallbackReason).toBeUndefined();
        expect(engine.lastDecisionTrace.planner.disagreementType).toBe('proven-v2-improvement');
        expect(engine.lastDecisionTrace.planner.candidates.some((candidate) =>
            candidate.kind === 'v1-fallback' && candidate.vetoes.some((entry) => entry.code === 'terminal-loss'))).toBeTrue();
    });

    it('falls back on ordinary enabled decisions below the evidence gate', function() {
        const fallbackDecision = { command: 'menuButton', args: ['pass', 'p'], target: 'Pass', reason: 'safe-v1' };
        const fallback = { version: 'v1', seedState: 9, decide: () => fallbackDecision };
        const engine = new V2BotEngine(fallback, { playerName: golden.botName, engineVersion: 'v2', v2Mode: 'enabled' });
        const prompt = golden.prompts.find((entry) => entry.class === 'pass');
        expect(engine.decide({
            playerState: clone(prompt.playerState), botName: golden.botName,
            context: { profile: { v2: { highConfidenceGate: { confidence: 0.1, scoreAdvantage: -100 } } } }
        })).toBe(fallbackDecision);
        expect(engine.lastDecisionTrace.selectedBy).toBe('fallback');
        expect(engine.lastDecisionTrace.fallbackReason).toMatch(/confidence|candidate|mechanical/);
        expect(engine.lastDecisionTrace.planner.budget).toEqual(jasmine.objectContaining({
            scored: 0, searchedNodes: 0, exhausted: false
        }));
    });

    it('keeps broad tactical search disabled in live mode until a profile opts in', function() {
        const configuration = golden.configurations[0];
        const prompt = golden.prompts.find((entry) => entry.class === 'conflict');
        const engine = new V2BotEngine(new V1PolicyAdapter(configuration.config), {
            playerName: golden.botName, ...configuration.config,
            engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'benchmark'
        });
        engine.decide(inputFor(prompt, configuration));
        expect(engine.lastDecisionTrace.planner.budget).toEqual(jasmine.objectContaining({
            searchedNodes: 0, exhausted: false
        }));
        expect(engine.lastDecisionTrace.planner.fallbackReason).not.toBe('search-budget-exhausted');
    });

    it('executes a retained semantic macro step before the mechanical V1 fast path', function() {
        const configuration = golden.configurations[0];
        const fallback = new V1PolicyAdapter(configuration.config);
        const engine = new V2BotEngine(fallback, {
            playerName: golden.botName, ...configuration.config,
            engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'benchmark'
        });
        const passPrompt = golden.prompts.find((entry) => entry.class === 'pass');
        engine.decide(inputFor(passPrompt, configuration));
        engine.intentManager.setMacro({
            id: 'macro:engine-continuation', currentStep: 0, abortPolicy: 'fallback-v1',
            startedAtSignature: 'fixture',
            steps: [{
                id: 'target', kind: 'target', semanticValue: 'chosen-character',
                expected: { promptTitle: 'Choose a target' },
                command: 'cardClicked', args: ['target-uuid']
            }]
        });
        const next = inputFor(passPrompt, configuration);
        const player = next.playerState.players[golden.botName];
        player.promptTitle = 'Choose a target';
        player.menuTitle = '';
        player.buttons = [];

        expect(engine.decide(next)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['target-uuid'], target: 'chosen-character',
            reason: 'v2-macro-target'
        }));
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');
        expect(engine.lastDecisionTrace.fallbackReason).toBeUndefined();
        expect(engine.intentManager.hasActiveMacro).toBeFalse();
    });

    it('attaches acceptance and the next observed material-state outcome to the recorded planner object', function() {
        const configuration = golden.configurations[0];
        const engine = new V2BotEngine(new V1PolicyAdapter(configuration.config), {
            playerName: golden.botName, ...configuration.config,
            engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const passPrompt = golden.prompts.find((entry) => entry.class === 'pass');
        engine.decide(inputFor(passPrompt, configuration));
        engine.observeDecision('success', 'accepted-by-controller');
        const recordedPlanner = engine.lastDecisionTrace.planner;
        expect(recordedPlanner.acceptance).toBe('success');

        const changedInput = inputFor(passPrompt, configuration);
        changedInput.playerState.players[golden.botName].stats.honor -= 1;
        engine.decide(changedInput);

        expect(recordedPlanner.outcome).toEqual(jasmine.objectContaining({
            status: 'realized', materialStateChanged: true,
            previousStateSignature: jasmine.any(String), observedStateSignature: jasmine.any(String)
        }));
        expect(recordedPlanner.outcome.observedStateSignature).not.toBe(recordedPlanner.outcome.previousStateSignature);
    });
});
