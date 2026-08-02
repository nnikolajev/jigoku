const V2BotEngine = require('../../../build/server/game/bots/v2/V2BotEngine.js').default;
const CandidateRegistry = require('../../../build/server/game/bots/v2/CandidateRegistry.js').default;
const PerspectiveSnapshotBuilder = require('../../../build/server/game/bots/v2/PerspectiveSnapshotBuilder.js').default;
const CardSemanticRegistry = require('../../../build/server/game/bots/v2/cards/CardSemantics.js').default;
const SemanticActionPlanner = require('../../../build/server/game/bots/v2/cards/SemanticActionPlanner.js').default;
const UtilityEvaluator = require('../../../build/server/game/bots/v2/UtilityEvaluator.js').default;
const { REPRESENTATIVE_SEMANTICS } = require('../../../build/server/game/bots/v2/cards/GenericSemantics.js');
const { DECK_SEMANTICS } = require('../../../build/server/game/bots/v2/cards/DeckSemantics.js');

describe('V2 semantic action planning', function() {
    function character(uuid, controller, military, options = {}) {
        return {
            uuid, id: uuid, name: uuid, type: 'character', location: 'play area', controller,
            military, political: options.political ?? 1, bowed: options.bowed === true,
            glory: options.glory ?? 0, fate: options.fate ?? 0,
            honored: options.honored === true, dishonored: options.dishonored === true,
            inConflict: options.inConflict === true, attacking: controller === 'Bot' && options.inConflict === true,
            defending: controller === 'Opponent' && options.inConflict === true,
            selectable: options.selectable, attachments: options.attachments || [], traits: options.traits || [],
            unique: options.unique === true
        };
    }

    function input(prompt = {}) {
        return {
            botName: 'Bot',
            context: {
                roundNumber: 2, conflictId: 'conflict:semantic',
                legalDirectCardUuids: prompt.legalDirectCardUuids,
                opponentConflictDeck: []
            },
            playerState: {
                phase: 'conflict',
                conflict: {
                    id: 'conflict:semantic', attackerId: 'Bot', defenderId: 'Opponent', type: 'military',
                    provinceLocation: 'province 1', attackerSkill: 3, defenderSkill: 4,
                    provinceStrength: 1, breakThreshold: 1
                },
                players: {
                    Bot: {
                        name: 'Bot', phase: 'conflict', promptTitle: prompt.promptTitle || 'Conflict Action Window',
                        menuTitle: prompt.menuTitle || 'Initiate an action', selectCard: prompt.selectCard,
                        buttons: prompt.buttons || [{ text: 'Pass', arg: 'pass', uuid: 'pass-button' }],
                        stats: { fate: 3, honor: 8 },
                        cardPiles: {
                            hand: prompt.hand || [{ uuid: 'banzai-source', id: 'banzai', name: 'Banzai!', type: 'event', location: 'hand' }],
                            conflictDeck: [{}, {}, {}], dynastyDeck: [{}, {}],
                            cardsInPlay: prompt.cardsInPlay || [
                                character('participant', 'Bot', 3, { inConflict: true, selectable: prompt.targetSelectable }),
                                character('reserve', 'Bot', 5, { selectable: prompt.reserveSelectable })
                            ]
                        },
                        provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: []
                    },
                    Opponent: {
                        name: 'Opponent', stats: { fate: 0, honor: 8 },
                        cardPiles: {
                            hand: [], conflictDeck: [{}, {}, {}], dynastyDeck: [{}, {}],
                            cardsInPlay: [character('opponent', 'Opponent', 4, { inConflict: true })]
                        },
                        provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: []
                    }
                },
                rings: {}
            }
        };
    }

    it('binds an exact-legal action source to the best semantic target and a stable macro', function() {
        const raw = input({ legalDirectCardUuids: { 'banzai-source': true } });
        const state = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const collected = new CandidateRegistry().collect({
            input: raw, state,
            v1Decision: { command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'v1-pass' }
        });
        const planner = new SemanticActionPlanner(new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS));
        const candidates = planner.expand(state, collected.candidates);
        const banzai = candidates.find((candidate) => candidate.source?.cardId === 'banzai');

        expect(banzai.targets).toEqual([jasmine.objectContaining({ instanceId: 'participant', controllerId: 'Bot' })]);
        expect(banzai.effects).toEqual([jasmine.objectContaining({ kind: 'skill', military: 2,
            target: jasmine.objectContaining({ instanceId: 'participant' }) })]);
        expect(banzai.macro.steps.map((step) => step.kind)).toEqual(['source', 'target']);
        expect(banzai.macro.steps[1].args).toEqual(['participant']);
        expect(banzai.confidence).toBe(0.9);
    });

    it('uses the authoritative source-specific attachment target set before starting a macro', function() {
        const raw = input({
            legalDirectCardUuids: { 'fan-source': true },
            hand: [{ uuid: 'fan-source', id: 'ornate-fan', name: 'Ornate Fan', type: 'attachment', location: 'hand' }]
        });
        raw.context.legalAttachmentTargetUuidsBySource = { 'fan-source': ['reserve'] };
        const state = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const collected = new CandidateRegistry().collect({ input: raw, state, v1Decision: null });
        const fan = new SemanticActionPlanner(new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS))
            .expand(state, collected.candidates)
            .find((candidate) => candidate.source?.cardId === 'ornate-fan');

        expect(fan.targets).toEqual([jasmine.objectContaining({ instanceId: 'reserve' })]);
        expect(fan.macro.steps[1].args).toEqual(['reserve']);

        raw.context.legalAttachmentTargetUuidsBySource = { 'fan-source': [] };
        const noTargetState = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const noTargetCollected = new CandidateRegistry().collect({ input: raw, state: noTargetState, v1Decision: null });
        const unavailable = new SemanticActionPlanner(new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS))
            .expand(noTargetState, noTargetCollected.candidates)
            .find((candidate) => candidate.source?.cardId === 'ornate-fan');
        expect(unavailable.targets).toEqual([]);
        expect(unavailable.macro).toBeUndefined();
    });

    it('binds Let Go to the highest-impact public opposing attachment with exact projected modifiers', function() {
        const raw = input({
            legalDirectCardUuids: { 'let-go-source': true },
            hand: [{ uuid: 'let-go-source', id: 'let-go', name: 'Let Go', type: 'event', location: 'hand' }]
        });
        raw.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('attached-enemy', 'Opponent', 7, {
                inConflict: true,
                attachments: [
                    { uuid: 'fine-katana-target', id: 'fine-katana', type: 'attachment',
                        cardData: { military_bonus: '2', political_bonus: '0', cost: '0' } },
                    { uuid: 'ornate-fan-target', id: 'ornate-fan', type: 'attachment',
                        cardData: { military_bonus: '0', political_bonus: '2', cost: '0' } }
                ]
            })
        ];
        const state = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const collected = new CandidateRegistry().collect({ input: raw, state, v1Decision: null });
        const candidates = new SemanticActionPlanner(new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS))
            .expand(state, collected.candidates)
            .filter((candidate) => candidate.source?.cardId === 'let-go');

        expect(candidates.map((candidate) => candidate.targets[0].instanceId)).toEqual(['fine-katana-target']);
        expect(candidates[0].effects).toEqual([jasmine.objectContaining({
            kind: 'remove', method: 'discard',
            target: jasmine.objectContaining({ kind: 'card', instanceId: 'fine-katana-target' })
        })]);
        expect(candidates[0].effects[0].conditional).toBeUndefined();
        expect(candidates[0].macro.steps.map((step) => step.kind)).toEqual(['source', 'target']);
        expect(candidates[0].macro.steps[1].args).toEqual(['fine-katana-target']);
        expect(candidates[0].tags).toContain('offense');
        expect(state.characters.find((entry) => entry.instanceId === 'attached-enemy').attachments[0])
            .toEqual(jasmine.objectContaining({ militaryBonus: 2, politicalBonus: 0, printedCost: 0 }));
    });

    it('binds Golden Plains Outpost only to a ready non-participating cavalry character', function() {
        const raw = input({
            legalDirectCardUuids: { 'golden-plains': true },
            hand: [],
            cardsInPlay: [
                { ...character('golden-plains', 'Bot', 0), id: 'golden-plains-outpost', name: 'Golden Plains Outpost', type: 'stronghold', location: 'stronghold province' },
                character('already-there', 'Bot', 8, { inConflict: true, traits: ['cavalry'] }),
                character('non-cavalry', 'Bot', 9),
                character('reserve-cavalry', 'Bot', 5, { traits: ['cavalry'] })
            ]
        });
        const state = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const collected = new CandidateRegistry().collect({ input: raw, state, v1Decision: null });
        const planner = new SemanticActionPlanner(new CardSemanticRegistry([...REPRESENTATIVE_SEMANTICS, ...DECK_SEMANTICS]));
        const outpost = planner.expand(state, collected.candidates)
            .find((candidate) => candidate.source?.cardId === 'golden-plains-outpost');

        expect(outpost.targets).toEqual([jasmine.objectContaining({ instanceId: 'reserve-cavalry' })]);
        expect(outpost.effects).toEqual([jasmine.objectContaining({
            kind: 'move', destination: 'conflict', target: jasmine.objectContaining({ instanceId: 'reserve-cavalry' })
        })]);
        expect(outpost.macro.steps.map((step) => step.kind)).toEqual(['source', 'target']);
        expect(outpost.confidence).toBe(0.95);
        expect(outpost.tags).toContain('offense');
    });

    it('builds exact Court Games source-mode-target macros for both legal modes', function() {
        const raw = input({
            legalDirectCardUuids: { 'court-games-source': true },
            hand: [{ uuid: 'court-games-source', id: 'court-games', name: 'Court Games', type: 'event', location: 'hand' }],
            cardsInPlay: [character('courtier', 'Bot', 1, { political: 3, glory: 2, inConflict: true })]
        });
        raw.playerState.conflict.type = 'political';
        raw.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('enemy-courtier', 'Opponent', 1, { political: 4, glory: 1, inConflict: true })
        ];
        const state = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const collected = new CandidateRegistry().collect({ input: raw, state, v1Decision: null });
        const planner = new SemanticActionPlanner(new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS));
        const courtGames = planner.expand(state, collected.candidates)
            .filter((candidate) => candidate.source?.cardId === 'court-games');

        expect(courtGames.map((candidate) => candidate.mode).sort()).toEqual(['dishonor', 'honor']);
        const honor = courtGames.find((candidate) => candidate.mode === 'honor');
        const dishonor = courtGames.find((candidate) => candidate.mode === 'dishonor');
        expect(honor.targets[0].instanceId).toBe('courtier');
        expect(honor.effects[0]).toEqual(jasmine.objectContaining({ kind: 'status', status: 'honored',
            target: jasmine.objectContaining({ instanceId: 'courtier' }) }));
        expect(dishonor.targets[0].instanceId).toBe('enemy-courtier');
        expect(dishonor.effects[0]).toEqual(jasmine.objectContaining({ kind: 'status', status: 'dishonored',
            target: jasmine.objectContaining({ instanceId: 'enemy-courtier' }) }));
        expect(honor.macro.steps.map((step) => step.kind)).toEqual(['source', 'mode', 'target']);
        expect(honor.macro.steps[1]).toEqual(jasmine.objectContaining({
            semanticValue: 'Honor a friendly character', command: 'menuButton', args: []
        }));
    });

    it('resolves Court Games mode buttons by semantic text and preserves their live transport identity', function() {
        const fallbackDecision = { command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'v1-pass' };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const sourceInput = input({
            legalDirectCardUuids: { 'court-games-source': true },
            hand: [{ uuid: 'court-games-source', id: 'court-games', name: 'Court Games', type: 'event', location: 'hand' }],
            cardsInPlay: [character('courtier', 'Bot', 1, { political: 3, glory: 2, inConflict: true })]
        });
        sourceInput.playerState.conflict.type = 'political';
        sourceInput.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('enemy-courtier', 'Opponent', 1, { political: 4, glory: 1, inConflict: true })
        ];
        expect(engine.decide(sourceInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['court-games-source'], cardId: 'court-games'
        }));

        const modeInput = input({
            promptTitle: 'Court Games', menuTitle: 'Select one', hand: [],
            cardsInPlay: [character('courtier', 'Bot', 1, { political: 3, glory: 2, inConflict: true })],
            buttons: [
                { text: 'Honor a friendly character', arg: '0', uuid: 'live-mode-uuid' },
                { text: 'Dishonor an opposing character', arg: '1', uuid: 'other-mode-uuid' }
            ]
        });
        modeInput.playerState.conflict.type = 'political';
        modeInput.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('enemy-courtier', 'Opponent', 1, { political: 4, glory: 1, inConflict: true })
        ];
        expect(engine.decide(modeInput)).toEqual(jasmine.objectContaining({
            command: 'menuButton', args: ['0', 'live-mode-uuid', undefined],
            target: 'Honor a friendly character', reason: 'v2-macro-mode'
        }));

        const targetInput = input({
            promptTitle: 'Court Games', menuTitle: 'Choose a character', selectCard: true,
            hand: [], buttons: [], targetSelectable: true,
            cardsInPlay: [character('courtier', 'Bot', 1, {
                political: 3, glory: 2, inConflict: true, selectable: true
            })]
        });
        targetInput.playerState.conflict.type = 'political';
        targetInput.context.legalDirectCardUuids = undefined;
        targetInput.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('enemy-courtier', 'Opponent', 1, { political: 4, glory: 1, inConflict: true })
        ];
        expect(engine.decide(targetInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['courtier'], reason: 'v2-macro-target'
        }));
    });

    it('models Noble Sacrifice as an exact favorable source-cost-victim trade', function() {
        const raw = input({
            legalDirectCardUuids: { 'noble-source': true },
            hand: [{ uuid: 'noble-source', id: 'noble-sacrifice', name: 'Noble Sacrifice', type: 'event', location: 'hand' }],
            cardsInPlay: [
                character('cheap-honored', 'Bot', 0, { political: 0, honored: true }),
                character('tower-honored', 'Bot', 6, { political: 5, honored: true, fate: 2,
                    attachments: [{ uuid: 'tower-attachment', id: 'fine-katana', type: 'attachment' }] })
            ]
        });
        raw.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('weak-dishonored', 'Opponent', 1, { dishonored: true }),
            character('valuable-dishonored', 'Opponent', 4, {
                political: 4, dishonored: true, fate: 2, inConflict: true,
                attachments: [{ uuid: 'victim-attachment', id: 'ornate-fan', type: 'attachment' }]
            })
        ];
        const state = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const collected = new CandidateRegistry().collect({ input: raw, state, v1Decision: null });
        const planner = new SemanticActionPlanner(new CardSemanticRegistry([...REPRESENTATIVE_SEMANTICS, ...DECK_SEMANTICS]));
        const noble = planner.expand(state, collected.candidates)
            .find((candidate) => candidate.source?.cardId === 'noble-sacrifice');

        expect(noble.targets.map((target) => target.instanceId)).toEqual(['cheap-honored', 'valuable-dishonored']);
        expect(noble.effects).toEqual([
            jasmine.objectContaining({ kind: 'remove', method: 'sacrifice', cost: true,
                target: jasmine.objectContaining({ instanceId: 'cheap-honored' }) }),
            jasmine.objectContaining({ kind: 'remove', method: 'discard',
                target: jasmine.objectContaining({ instanceId: 'valuable-dishonored' }) })
        ]);
        expect(noble.macro.steps.map((step) => step.kind)).toEqual(['source', 'cost', 'target']);
        expect(noble.confidence).toBe(0.95);
        expect(new UtilityEvaluator().evaluate(state, noble).scalar).toBeGreaterThan(
            new UtilityEvaluator().evaluate(state, collected.candidates.find((candidate) => candidate.kind === 'pass')).scalar
        );
    });

    it('executes only a favorable Noble Sacrifice threshold line through both target prompts', function() {
        const fallbackDecision = { command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'v1-pass' };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const sourceInput = input({
            legalDirectCardUuids: { 'noble-source': true },
            hand: [{ uuid: 'noble-source', id: 'noble-sacrifice', name: 'Noble Sacrifice', type: 'event', location: 'hand' }],
            cardsInPlay: [character('cheap-honored', 'Bot', 0, { political: 0, honored: true })]
        });
        sourceInput.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('valuable-dishonored', 'Opponent', 4, { dishonored: true, fate: 2, inConflict: true })
        ];
        expect(engine.decide(sourceInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['noble-source'], cardId: 'noble-sacrifice'
        }));
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'minimum-sufficient-response',
            evidence: jasmine.arrayContaining(['material-trade:18'])
        }));

        const costInput = input({
            promptTitle: 'Select character to sacrifice', menuTitle: 'Select character to sacrifice',
            hand: [], buttons: [], selectCard: true,
            legalDirectCardUuids: { 'cheap-honored': true },
            cardsInPlay: [character('cheap-honored', 'Bot', 0, {
                political: 0, honored: true, selectable: true
            })]
        });
        costInput.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('valuable-dishonored', 'Opponent', 4, { dishonored: true, fate: 2, inConflict: true })
        ];
        expect(engine.decide(costInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['cheap-honored'], reason: 'v2-macro-cost'
        }));

        const targetInput = input({
            promptTitle: 'Choose a character', menuTitle: 'Choose a character',
            hand: [], buttons: [], selectCard: true, cardsInPlay: []
        });
        targetInput.context.legalDirectCardUuids = { 'valuable-dishonored': true };
        targetInput.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('valuable-dishonored', 'Opponent', 4, {
                dishonored: true, fate: 2, inConflict: true, selectable: true
            })
        ];
        expect(engine.decide(targetInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['valuable-dishonored'], reason: 'v2-macro-target'
        }));
    });

    it('keeps incomplete multi-prompt card semantics on deterministic V1 fallback', function() {
        const raw = input({
            legalDirectCardUuids: { 'in-service-source': true },
            hand: [{
                uuid: 'in-service-source', id: 'in-service-to-my-lord', name: 'In Service to My Lord',
                type: 'event', location: 'hand'
            }],
            cardsInPlay: [
                character('bow-cost', 'Bot', 2),
                character('ready-target', 'Bot', 8, { bowed: true, unique: true, inConflict: true })
            ]
        });
        const state = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const collected = new CandidateRegistry().collect({ input: raw, state, v1Decision: null });
        const planner = new SemanticActionPlanner(new CardSemanticRegistry([...REPRESENTATIVE_SEMANTICS, ...DECK_SEMANTICS]));
        const candidate = planner.expand(state, collected.candidates)
            .find((entry) => entry.source?.cardId === 'in-service-to-my-lord');

        expect(candidate.macro).toBeUndefined();
        expect(candidate.targets).toEqual([]);
        expect(candidate.confidence).toBe(0.65);

        const fallbackDecision = {
            command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'v1-pass'
        };
        const fallback = { version: 'v1', seedState: 1, decide: () => fallbackDecision };
        const engine = new V2BotEngine(fallback, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        expect(engine.decide(raw)).toEqual(fallbackDecision);
        expect(engine.lastDecisionTrace.selectedBy).toBe('fallback');
        expect(engine.lastDecisionTrace.planner.overrideProof).toBeUndefined();
    });

    it('does not manufacture target macros for source-only or unprojected-condition actions', function() {
        const raw = input({
            legalDirectCardUuids: { 'moto-source': true, 'crane-event': true },
            hand: [{
                uuid: 'crane-event', id: 'way-of-the-crane', name: 'Way of the Crane',
                type: 'event', location: 'hand'
            }],
            cardsInPlay: [
                { ...character('moto-source', 'Bot', 5, { bowed: true, inConflict: true }),
                    id: 'moto-outrider', name: 'Moto Outrider' },
                character('not-known-crane', 'Bot', 8)
            ]
        });
        const state = new PerspectiveSnapshotBuilder().build(raw, {
            informationMode: 'fair', conflictId: 'conflict:semantic', roundId: '2'
        });
        const collected = new CandidateRegistry().collect({ input: raw, state, v1Decision: null });
        const planner = new SemanticActionPlanner(new CardSemanticRegistry([...REPRESENTATIVE_SEMANTICS, ...DECK_SEMANTICS]));
        const candidates = planner.expand(state, collected.candidates);

        for(const cardId of ['moto-outrider', 'way-of-the-crane']) {
            const candidate = candidates.find((entry) => entry.source?.cardId === cardId);
            expect(candidate.macro).toBeUndefined();
            expect(candidate.targets).toEqual([]);
            expect(candidate.confidence).toBe(0.75);
        }
    });

    it('executes a proven source-to-target response and falls back before an unavailable target click', function() {
        const fallback = {
            version: 'v1', seedState: 1,
            decide: (raw) => raw.playerState.players.Bot.selectCard
                ? { command: 'cardClicked', args: ['reserve'], target: 'reserve', reason: 'v1-target' }
                : { command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'v1-pass' }
        };
        const engine = new V2BotEngine(fallback, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const source = engine.decide(input({ legalDirectCardUuids: { 'banzai-source': true } }));
        expect(source).toEqual(jasmine.objectContaining({ command: 'cardClicked', args: ['banzai-source'] }));
        expect(engine.lastDecisionTrace.planner.overrideProof.reason).toBe('minimum-sufficient-response');

        const targetInput = input({
            promptTitle: 'Choose a character', menuTitle: 'Choose a character', selectCard: true,
            buttons: [], hand: [], targetSelectable: true, reserveSelectable: true
        });
        targetInput.context.legalDirectCardUuids = undefined;
        const target = engine.decide(targetInput);
        expect(target).toEqual(jasmine.objectContaining({ command: 'cardClicked', args: ['participant'], reason: 'v2-macro-target' }));
        expect(engine.lastDecisionTrace.selectedBy).toBe('v2');

        const aborting = new V2BotEngine(fallback, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        expect(aborting.decide(input({ legalDirectCardUuids: { 'banzai-source': true } })).args).toEqual(['banzai-source']);
        const unavailableInput = input({
            promptTitle: 'Choose a character', menuTitle: 'Choose a character', selectCard: true,
            buttons: [], hand: [], targetSelectable: false, reserveSelectable: true
        });
        unavailableInput.context.legalDirectCardUuids = undefined;
        expect(aborting.decide(unavailableInput)).toEqual(jasmine.objectContaining({ args: ['reserve'], reason: 'v1-target' }));
        expect(aborting.lastDecisionTrace.fallbackReason).toBe('macro-continuation-not-live');

        const sameRoot = input({ legalDirectCardUuids: { 'banzai-source': true } });
        expect(aborting.decide(sameRoot)).toEqual(jasmine.objectContaining({ args: ['pass', 'pass-button'], reason: 'v1-pass' }));
        expect(aborting.lastDecisionTrace.planner.candidates.find((candidate) =>
            candidate.cardId === 'banzai').vetoes.map((veto) => veto.code)).toContain('failed-macro-at-state');
    });

    it('does not spend an exact pump merely to win an ordinary defense that is not breaking', function() {
        const fallbackDecision = {
            command: 'cardClicked', args: ['economy-source'], target: 'Economy Source', reason: 'v1-economy'
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const raw = input({ legalDirectCardUuids: { 'banzai-source': true } });
        raw.playerState.conflict = {
            id: 'conflict:semantic', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
            provinceLocation: 'province 1', attackerSkill: 3, defenderSkill: 2,
            provinceStrength: 4, breakThreshold: 4
        };
        raw.playerState.players.Bot.cardPiles.cardsInPlay = [
            character('participant', 'Bot', 2, { inConflict: true })
        ];
        raw.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('opponent', 'Opponent', 3, { inConflict: true })
        ];

        expect(engine.decide(raw)).toEqual(fallbackDecision);
        expect(engine.lastDecisionTrace.selectedBy).toBe('fallback');
        expect(engine.lastDecisionTrace.planner.overrideProof).toBeUndefined();
        expect(engine.lastDecisionTrace.planner.overrideRejectionEvidence).toContain('no-fixture-proven-override');
    });

    it('allows an exact defensive pump when it is the minimum needed to prevent a province break', function() {
        const fallbackDecision = {
            command: 'cardClicked', args: ['economy-source'], target: 'Economy Source', reason: 'v1-economy'
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const raw = input({ legalDirectCardUuids: { 'banzai-source': true } });
        raw.playerState.conflict = {
            id: 'conflict:semantic', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
            provinceLocation: 'province 1', attackerSkill: 7, defenderSkill: 2,
            provinceStrength: 4, breakThreshold: 4
        };
        raw.playerState.players.Bot.cardPiles.cardsInPlay = [
            character('participant', 'Bot', 2, { inConflict: true })
        ];
        raw.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('opponent', 'Opponent', 7, { inConflict: true })
        ];

        expect(engine.decide(raw)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['banzai-source']
        }));
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'minimum-sufficient-response',
            evidence: jasmine.arrayContaining([
                'material-threshold:prevent-break', 'required:2', 'selected:2'
            ])
        }));
    });

    it('uses exact Let Go attachment removal to prevent a province break through its target prompt', function() {
        const fallbackDecision = {
            command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'v1-pass'
        };
        const engine = new V2BotEngine({ version: 'v1', seedState: 1, decide: () => fallbackDecision }, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const sourceInput = input({
            legalDirectCardUuids: { 'let-go-source': true },
            hand: [{ uuid: 'let-go-source', id: 'let-go', name: 'Let Go', type: 'event', location: 'hand' }],
            cardsInPlay: [character('bot-defender', 'Bot', 3, { inConflict: true })]
        });
        sourceInput.playerState.conflict = {
            id: 'conflict:semantic', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
            provinceLocation: 'province 1', attackerSkill: 7, defenderSkill: 3,
            provinceStrength: 4, breakThreshold: 4
        };
        sourceInput.playerState.players.Opponent.cardPiles.cardsInPlay = [
            character('enemy-attacker', 'Opponent', 7, {
                inConflict: true,
                attachments: [{
                    uuid: 'fine-katana-target', id: 'fine-katana', type: 'attachment',
                    cardData: { military_bonus: '2', political_bonus: '0', cost: '0' }
                }]
            })
        ];

        expect(engine.decide(sourceInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['let-go-source'], cardId: 'let-go'
        }));
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'minimum-sufficient-response',
            evidence: jasmine.arrayContaining([
                'material-threshold:prevent-break', 'required:1', 'selected:2'
            ])
        }));

        const targetInput = JSON.parse(JSON.stringify(sourceInput));
        targetInput.context.legalDirectCardUuids = { 'fine-katana-target': true };
        targetInput.playerState.players.Bot.promptTitle = 'Choose an attachment';
        targetInput.playerState.players.Bot.menuTitle = 'Choose an attachment';
        targetInput.playerState.players.Bot.selectCard = true;
        targetInput.playerState.players.Bot.cardPiles.hand = [];
        targetInput.playerState.players.Bot.buttons = [];
        expect(engine.decide(targetInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['fine-katana-target'], reason: 'v2-macro-target'
        }));
    });

    it('moves exact cavalry to prevent an immediate stronghold break before V1 passes', function() {
        const fallbackDecision = { command: 'menuButton', args: ['pass', 'pass-button'], target: 'Pass', reason: 'v1-pass' };
        const fallback = { version: 'v1', seedState: 1, decide: () => fallbackDecision };
        const engine = new V2BotEngine(fallback, {
            playerName: 'Bot', engineVersion: 'v2', v2Mode: 'enabled', traceLevel: 'research'
        });
        const sourceInput = input({
            legalDirectCardUuids: { 'golden-plains': true },
            hand: [],
            cardsInPlay: [
                { ...character('golden-plains', 'Bot', 0), id: 'golden-plains-outpost', name: 'Golden Plains Outpost', type: 'stronghold', location: 'stronghold province' },
                character('cavalry-defender', 'Bot', 4, { traits: ['cavalry'] })
            ]
        });
        sourceInput.playerState.conflict = {
            id: 'conflict:semantic', attackerId: 'Opponent', defenderId: 'Bot', type: 'military',
            provinceLocation: 'stronghold province', attackerSkill: 7, defenderSkill: 0,
            provinceStrength: 4, breakThreshold: 4
        };
        sourceInput.playerState.players.Opponent.cardPiles.cardsInPlay = [
            { ...character('opponent', 'Opponent', 7, { inConflict: true }), attacking: true, defending: false }
        ];

        expect(engine.decide(sourceInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['golden-plains'], cardId: 'golden-plains-outpost'
        }));
        expect(engine.lastDecisionTrace.planner.overrideProof).toEqual(jasmine.objectContaining({
            reason: 'minimum-sufficient-response',
            evidence: jasmine.arrayContaining([
                'immediate-stronghold-threshold', 'required:4', 'selected:4', 'coherent-source-target-macro'
            ])
        }));
        expect(engine.lastDecisionTrace.planner.candidates.find((candidate) =>
            candidate.cardId === 'golden-plains-outpost').tags).toContain('defense');
        expect(engine.lastDecisionTrace.planner.searchReason).toBe('complete');

        const targetInput = JSON.parse(JSON.stringify(sourceInput));
        targetInput.context.legalDirectCardUuids = { 'cavalry-defender': true };
        targetInput.playerState.players.Bot.promptTitle = 'Choose a cavalry character';
        targetInput.playerState.players.Bot.menuTitle = 'Choose a cavalry character';
        targetInput.playerState.players.Bot.buttons = [];
        expect(engine.decide(targetInput)).toEqual(jasmine.objectContaining({
            command: 'cardClicked', args: ['cavalry-defender'], reason: 'v2-macro-target'
        }));
    });
});
