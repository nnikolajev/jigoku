const CardSemanticRegistry = require('../../../build/server/game/bots/v2/cards/CardSemantics.js').default;
const { REPRESENTATIVE_SEMANTICS } = require('../../../build/server/game/bots/v2/cards/GenericSemantics.js');
const { DECK_SEMANTICS } = require('../../../build/server/game/bots/v2/cards/DeckSemantics.js');
const DeckSynergyContributor = require('../../../build/server/game/bots/v2/cards/DeckSynergies.js').default;
const { DECK_SYNERGY_PROFILES } = require('../../../build/server/game/bots/v2/cards/DeckSynergies.js');
const CandidateRegistry = require('../../../build/server/game/bots/v2/CandidateRegistry.js').default;
const PerspectiveSnapshotBuilder = require('../../../build/server/game/bots/v2/PerspectiveSnapshotBuilder.js').default;
const V2BotEngine = require('../../../build/server/game/bots/v2/V2BotEngine.js').default;
const { emptyLedgers } = require('../../../build/server/game/bots/v2/model/Ledgers.js');
const { DECK_LOADERS } = require('../../../tools/selfplay/deckRegistry.js');
const { deckEntries, expectedAbility } = require('../../../tools/selfplay/cardUsageAudit.js');

describe('V2 deck synergy contributors', function() {
    const semantics = new CardSemanticRegistry([...REPRESENTATIVE_SEMANTICS, ...DECK_SEMANTICS]);
    const contributor = new DeckSynergyContributor(semantics);

    function character(id, options = {}) {
        return {
            instanceId: options.instanceId || `instance:${id}`, cardId: id,
            controllerId: options.controllerId || 'Bot', ownerId: options.controllerId || 'Bot',
            location: 'play area', military: options.military ?? 3, political: options.political ?? 2,
            glory: 1, fate: options.fate ?? 1, honored: !!options.honored,
            dishonored: !!options.dishonored, bowed: !!options.bowed, ready: !options.bowed,
            participating: !!options.participating, attacking: !!options.attacking,
            defending: !!options.defending, conflictType: options.conflictType,
            traits: options.traits || [], unique: !!options.unique,
            attachments: options.attachments || [], canMove: true, canReady: true,
            noBowAfterConflict: false, canAttackMilitary: true, canAttackPolitical: true,
            covert: false, attackRestrictions: []
        };
    }

    function state(options = {}) {
        const scopes = { gameId: 'g', roundId: '2', phaseId: 'conflict', conflictId: 'c' };
        const mine = options.characters || [];
        const enemy = options.enemyCharacters || [];
        return {
            schemaVersion: 1, perspectivePlayerId: 'Bot', informationMode: options.informationMode || 'fair',
            scopes, phase: 'conflict', prompt: { kind: 'prompt', identity: 'p', title: 'Conflict Action Window', menu: '' },
            promptControls: [], conflict: {
                id: 'c', attackerId: 'Bot', defenderId: 'Opponent', type: options.conflictType || 'military',
                ring: 'fire', provinceLocation: 'province 1', attackerSkill: options.attackerSkill ?? 6,
                defenderSkill: options.defenderSkill ?? 3, provinceStrength: 4, breakThreshold: 4
            },
            players: {
                Bot: { id: 'Bot', fate: options.fate ?? 5, honor: options.honor ?? 8,
                    conflictDeckSize: 20, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: true },
                Opponent: { id: 'Opponent', fate: 3, honor: options.enemyHonor ?? 5,
                    conflictDeckSize: options.enemyDeck ?? 8, dynastyDeckSize: 20, brokenProvinceCount: 0, firstPlayer: false }
            },
            characters: [...mine, ...enemy],
            provinces: options.provinces || [
                { controllerId: 'Bot', location: 'province 1', visible: true, broken: false, inConflict: false,
                    effectiveStrength: 4, holdingIds: options.holdings || [], attackEligible: false, stronghold: false },
                { controllerId: 'Opponent', location: 'province 1', visible: true, broken: false, inConflict: true,
                    effectiveStrength: 4, holdingIds: [], attackEligible: true, stronghold: false }
            ],
            rings: [{ element: 'fire', fate: 1, contested: true, selectable: true }],
            hands: [
                { playerId: 'Bot', size: (options.handIds || []).length, exact: true,
                    cards: (options.handIds || []).map((cardId) => ({ cardId, known: true })) },
                { playerId: 'Opponent', size: 4, exact: false, cards: [] }
            ],
            opportunities: { remainingByPlayer: { Bot: { military: 1, political: 1 }, Opponent: { military: 1, political: 1 } }, totalRemaining: 4 },
            resources: { fateByPlayer: { Bot: 5, Opponent: 3 }, honorByPlayer: { Bot: 8, Opponent: 5 },
                handSizeByPlayer: { Bot: 5, Opponent: 4 }, conflictDeckByPlayer: { Bot: 20, Opponent: options.enemyDeck ?? 8 } },
            board: { readySkillByPlayer: {}, participatingSkillByPlayer: {} },
            ledgers: emptyLedgers(scopes), materialStateSignature: 'synergy-fixture'
        };
    }

    function candidate(cardId, options = {}) {
        const base = {
            id: options.id || `candidate:${cardId}`, kind: options.kind || 'conflict-card',
            source: { kind: 'card', instanceId: options.sourceId || `source:${cardId}`, cardId,
                controllerId: 'Bot', location: options.location || 'hand' },
            targets: options.targets || [], commandPreview: { command: 'cardClicked', args: [cardId], target: cardId },
            costs: options.costs || {}, effects: options.effects || [], prerequisites: [], tags: options.tags || [],
            limits: [], uncertainty: 0, confidence: 1, proposer: 'fixture'
        };
        return semantics.enrich(state(options.state), base);
    }

    function annotations(result, cardId) {
        return result.candidates.find((entry) => entry.source?.cardId === cardId)?.annotations || [];
    }

    it('defines all six declarative relationship roles as immutable data without command submission', function() {
        const roles = new Set(Object.values(DECK_SYNERGY_PROFILES).flatMap((profile) =>
            profile.edges.map((entry) => entry.role)));
        expect([...roles].sort()).toEqual([
            'enabler', 'mutually-exclusive', 'payoff', 'protection', 'reducer', 'setup'
        ]);
        for(const profile of Object.values(DECK_SYNERGY_PROFILES)) {
            expect(Object.isFrozen(profile)).toBeTrue();
            expect(profile.edges.length).toBeGreaterThan(0);
            for(const entry of profile.edges) {
                expect(entry.rationale).toEqual(jasmine.any(String));
                expect(entry.command).toBeUndefined();
            }
        }
    });

    it('ports Dragon reducer, tower, weapon-ready, protection, and attachment distribution packages', function() {
        const niten = character('niten-master', {
            attachments: [{ instanceId: 'existing-finger', cardId: 'finger-of-jade', controllerId: 'Bot', fate: 0, nonStackingKeys: [] }]
        });
        const fixture = state({ characters: [niten], handIds: ['daimyo-s-favor', 'fine-katana', 'finger-of-jade'] });
        const original = [
            candidate('daimyo-s-favor'), candidate('fine-katana'),
            candidate('finger-of-jade', { targets: [{ kind: 'character', instanceId: niten.instanceId, cardId: niten.cardId, controllerId: 'Bot' }] })
        ];
        const before = JSON.stringify(fixture);
        const result = contributor.contribute(fixture, original, { profile: { attachmentTower: {} } });
        const edges = result.activations.map((entry) => entry.edgeId);
        expect(edges).toContain('dragon:reducer-before-attachment');
        expect(edges).toContain('dragon:tower-attachment');
        expect(edges).toContain('dragon:weapon-readies-niten');
        expect(edges).toContain('dragon:protect-tower');
        expect(edges).toContain('dragon:distribute-singleton');
        expect(annotations(result, 'finger-of-jade').some((entry) => entry.scoreDelta?.waste === -8)).toBeTrue();
        expect(result.resourceProfile.archetype).toBe('tower');
        expect(JSON.stringify(fixture)).toBe(before);
        expect(original.every((entry) => entry.annotations?.every((note) => !note.proposer.startsWith('deck-synergy:')) ?? true)).toBeTrue();
    });

    it('ports Phoenix Shugenja reserve, ring, recursion, expensive-event, and live dynamic spell value', function() {
        const tadaka = character('isawa-tadaka-2', { traits: ['shugenja'], participating: true });
        const adept = character('adept-of-the-waves', { traits: ['shugenja'] });
        const victim = character('enemy-tower', { controllerId: 'Opponent', fate: 4, dishonored: true });
        const fixture = state({ characters: [tadaka, adept], enemyCharacters: [victim],
            handIds: ['display-of-power', 'consumed-by-five-fires', 'supernatural-storm'] });
        const storm = candidate('supernatural-storm', { state: { characters: [tadaka, adept], enemyCharacters: [victim] },
            targets: [{ kind: 'character', instanceId: tadaka.instanceId, cardId: tadaka.cardId, controllerId: 'Bot' }] });
        const fires = candidate('consumed-by-five-fires', { state: { characters: [tadaka, adept], enemyCharacters: [victim] } });
        const result = contributor.contribute(fixture, [storm, fires, candidate('display-of-power')],
            { profile: { shugenja: {} } });
        expect(result.fateReserve).toBe(2);
        expect(result.conflictCardReserve).toBe(1);
        expect(result.resourceProfile.archetype).toBe('shugenja');
        expect(result.activations.map((entry) => entry.edgeId)).toEqual(jasmine.arrayContaining([
            'shugenja:reserve-expensive-spell', 'shugenja:ring-resolution'
        ]));
        expect(storm.effects).toContain(jasmine.objectContaining({ kind: 'skill', military: 2, political: 2 }));
        expect(fires.effects).toContain(jasmine.objectContaining({ kind: 'resource', fate: -4 }));
    });

    it('ports Unicorn movement chains, ready follow-up, virtual participants, and win payoffs', function() {
        const mover = character('moto-outrider', { bowed: true, traits: ['cavalry'] });
        const payoff = character('minami-kaze-regulars', { participating: true, bowed: true });
        const fixture = state({ characters: [mover, payoff], handIds: ['ride-on', 'i-am-ready'] });
        const move = candidate('ride-on', { effects: [{ kind: 'move', destination: 'conflict' }] });
        const result = contributor.contribute(fixture, [move, candidate('i-am-ready'), candidate('minami-kaze-regulars')],
            { profile: { unicorn: {} } });
        expect(result.activations.map((entry) => entry.edgeId)).toEqual(jasmine.arrayContaining([
            'unicorn:movement-source', 'unicorn:move-ready', 'unicorn:virtual-participant',
            'unicorn:conflict-win-payoff'
        ]));
        expect(annotations(result, 'ride-on').some((entry) => (entry.scoreDelta?.comboProgress || 0) > 0)).toBeTrue();
    });

    it('ports Crane duel, honor, Voice, Noble Sacrifice, Gossip, Let Go, and target packages', function() {
        const honored = character('kakita-kaezin', { honored: true, participating: true });
        const dishonored = character('enemy-duelist', { controllerId: 'Opponent', dishonored: true,
            attachments: [{ instanceId: 'enemy-weapon', cardId: 'fine-katana', controllerId: 'Opponent', fate: 0, nonStackingKeys: [] }] });
        const fixture = state({ characters: [honored], enemyCharacters: [dishonored],
            handIds: ['game-of-sadane', 'voice-of-honor', 'noble-sacrifice', 'gossip', 'let-go'] });
        const result = contributor.contribute(fixture, [
            candidate('game-of-sadane'), candidate('way-of-the-crane'), candidate('voice-of-honor'),
            candidate('noble-sacrifice'), candidate('gossip'), candidate('let-go'), candidate('fine-katana'),
            candidate('proving-ground')
        ], { profile: { duelist: {}, craneBaseline: {} } });
        expect(result.activations.map((entry) => entry.edgeId)).toEqual(jasmine.arrayContaining([
            'crane:duel-engine', 'crane:honor-setup', 'crane:noble-sacrifice',
            'crane:voice-protection', 'crane:gossip-control', 'crane:let-go-target'
        ]));
    });

    it('projects Iron Crane Legion and Ujik Tactics from live hand and non-unique board facts', function() {
        const legion = candidate('iron-crane-legion', { kind: 'in-play-ability', location: 'play area' });
        expect(legion.effects).toContain(jasmine.objectContaining({ kind: 'skill', military: 4, political: 0 }));

        const nonUniqueA = character('moto-youth');
        const nonUniqueB = character('border-rider');
        const unique = character('shinjo-altansarnai-2', { unique: true });
        const ujik = candidate('ujik-tactics', { state: { characters: [nonUniqueA, nonUniqueB, unique] } });
        expect(ujik.effects.filter((effect) => effect.kind === 'skill').length).toBe(2);
        expect(ujik.effects.every((effect) => effect.target?.instanceId !== unique.instanceId)).toBeTrue();
    });

    it('ports Lion swarm, honor persistence, duel, ready, and additional-conflict packages', function() {
        const bushi = character('akodo-toturi', { traits: ['bushi'], participating: true });
        const fixture = state({ characters: [bushi], handIds: ['for-greater-glory', 'ujiaki-s-offer'] });
        const glory = candidate('for-greater-glory', { state: { characters: [bushi] } });
        const result = contributor.contribute(fixture, [
            candidate('matsu-berserker'), glory, candidate('hayaken-no-shiro'),
            candidate('true-strike-kenjutsu'), candidate('ujiaki-s-offer')
        ], { profile: { lion: {} } });
        expect(result.activations.map((entry) => entry.edgeId)).toEqual(jasmine.arrayContaining([
            'lion:wide-board', 'lion:province-break-payoff', 'lion:ready',
            'lion:duel-safe-lead', 'lion:additional-conflict'
        ]));
        expect(glory.effects).toContain(jasmine.objectContaining({ kind: 'resource', fate: 1 }));
    });

    it('ports Scorpion dishonor/mill and Crab holding/defense packages independently', function() {
        const scorpion = contributor.contribute(state({ enemyHonor: 4, enemyDeck: 7 }), [
            candidate('city-of-the-open-hand'), candidate('court-games'), candidate('deserted-shrine')
        ], { profile: { dishonor: {} } });
        expect(scorpion.resourceProfile.archetype).toBe('dishonor');
        expect(scorpion.activations.map((entry) => entry.edgeId)).toEqual(jasmine.arrayContaining([
            'scorpion:dishonor-payoff', 'scorpion:mill-pressure', 'scorpion:low-honor-protection'
        ]));

        const crab = contributor.contribute(state({ holdings: ['kaiu-forges'] }), [
            candidate('kaiu-forges', { tags: ['holding'] }), candidate('rebuild'),
            candidate('raise-the-alarm', { tags: ['defense'] })
        ], { profile: { mulliganForHoldings: true, digWithActions: true } });
        expect(crab.resourceProfile.archetype).toBe('holding');
        expect(crab.activations.map((entry) => entry.edgeId)).toEqual(jasmine.arrayContaining([
            'crab:holding-setup', 'crab:holding-recursion', 'crab:defense-package'
        ]));
    });

    it('ports Phoenix glory and Dragon Monk semantics while preserving their separate deck gates', function() {
        const shugenja = character('asako-tsuki', { traits: ['shugenja'], honored: true });
        const phoenix = contributor.contribute(state({ characters: [shugenja] }), [
            candidate('isawa-mori-seido'), candidate('supernatural-storm'), candidate('against-the-waves'),
            candidate('court-games')
        ], { profile: { glory: {} } });
        expect(phoenix.profileIds).toEqual(['phoenix-glory']);
        expect(phoenix.activations.map((entry) => entry.edgeId)).toEqual(jasmine.arrayContaining([
            'phoenix:glory-honor', 'phoenix:storm-shugenja', 'phoenix:ready-shugenja'
        ]));

        const mitsu = character('togashi-mitsu-2', { traits: ['monk'], participating: true });
        const monk = contributor.contribute(state({ characters: [mitsu], handIds: ['void-fist'] }), [
            candidate('void-fist'), candidate('togashi-mitsu-2'), candidate('way-of-the-dragon'),
            candidate('high-house-of-light'), candidate('keeper-initiate'), candidate('banzai', { tags: ['ring'] })
        ], { profile: { dragon: {} } });
        expect(monk.profileIds).toEqual(['dragon-monk']);
        expect(monk.activations.map((entry) => entry.edgeId)).toEqual(jasmine.arrayContaining([
            'monk:cheap-card-setup', 'monk:card-count-payoff', 'monk:void-recursion',
            'monk:way-protection', 'monk:high-house-protection'
        ]));
    });

    it('activates the same deck semantics through every V2 seed and information combination', function() {
        for(const seed of [1, 2, 3]) {
            for(const omniscient of [false, true]) {
                const fallbackDecision = { command: 'menuButton', args: ['pass', 'pass'], target: 'Pass', reason: 'fixture-v1' };
                const engine = new V2BotEngine({ version: 'v1', seedState: seed, decide: () => fallbackDecision }, {
                    playerName: 'Bot', engineVersion: 'v2', seed, omniscient, v2Mode: 'shadow',
                    traceLevel: 'research', deckProfileId: 'dragon-attachments'
                });
                const input = {
                    botName: 'Bot', context: { roundNumber: 2, profile: { attachmentTower: {} },
                        omniscient: omniscient ? { oppHand: [], oppProvinces: [], oppFate: 0 } : undefined },
                    playerState: {
                        phase: 'conflict', players: {
                            Bot: { name: 'Bot', phase: 'conflict', promptTitle: 'Conflict Action Window', menuTitle: '',
                                buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }], stats: { fate: 3, honor: 8 },
                                cardPiles: { conflictDeck: [{}, {}], hand: [
                                    { uuid: 'favor', id: 'daimyo-s-favor', name: "Daimyo's Favor", type: 'attachment', location: 'hand', selectable: true },
                                    { uuid: 'katana', id: 'fine-katana', name: 'Fine Katana', type: 'attachment', location: 'hand', selectable: true }
                                ], cardsInPlay: [
                                    { uuid: 'niten', id: 'niten-master', name: 'Niten Master', type: 'character', location: 'play area',
                                        military: 3, political: 2, traits: ['bushi'], attachments: [] }
                                ] }, provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [] },
                            Opponent: { name: 'Opponent', stats: { fate: 0, honor: 8 },
                                cardPiles: { conflictDeck: [{}, {}], hand: [], cardsInPlay: [] },
                                provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [] }
                        }, rings: {}
                    }
                };
                expect(engine.decide(input)).withContext(`seed=${seed}/omni=${omniscient}`).toEqual(fallbackDecision);
                const trace = engine.lastDecisionTrace.planner;
                expect(trace.synergy.profileIds).toEqual(['dragon-attachments']);
                expect(trace.synergy.activations.some((entry) => entry.edgeId === 'dragon:reducer-before-attachment')).toBeTrue();
                expect(trace.information.mode).toBe(omniscient ? 'omniscient' : 'fair');
            }
        }
    });

    it('gives every standardized card and selectable persistent ability coverage in every V2 seed/information combination', function() {
        const builder = new PerspectiveSnapshotBuilder();
        const registry = new CandidateRegistry();
        for(const seed of [1, 2, 3]) {
            for(const informationMode of ['fair', 'omniscient']) {
                for(const [deckName, loadDeck] of Object.entries(DECK_LOADERS)) {
                    const cards = deckEntries(loadDeck()).map((entry) => entry.card);
                    const ids = cards.map((card) => card.id);
                    const coverage = semantics.coverage(ids);
                    const label = `seed=${seed}/${informationMode}/${deckName}`;
                    expect(coverage.length).withContext(`${label} semantic coverage`).toBe(new Set(ids).size);
                    expect(coverage.every((entry) => entry.v1Fallback === true))
                        .withContext(`${label} explicit V1 fallback`).toBeTrue();
                    for(const card of cards.filter(expectedAbility)) {
                        const live = { uuid: `live:${card.id}`, id: card.id, name: card.name, type: card.type,
                            side: card.side, location: 'play area', selectable: true, attachments: [] };
                        const input = { botName: 'Bot', context: { strategySeed: seed }, playerState: { phase: 'conflict', players: {
                            Bot: { name: 'Bot', phase: 'conflict', promptTitle: 'Conflict Action Window', menuTitle: '',
                                stats: { fate: 5, honor: 8 }, cardPiles: { hand: [], conflictDeck: [{}, {}], cardsInPlay: [live] },
                                provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [] },
                            Opponent: { name: 'Opponent', stats: { fate: 0, honor: 8 },
                                cardPiles: { hand: [], conflictDeck: [{}, {}], cardsInPlay: [] },
                                provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [] }
                        }, rings: {} } };
                        const snapshot = builder.build(input, { informationMode });
                        const collection = registry.collect({ input, state: snapshot, v1Decision: null });
                        expect(collection.candidates.some((entry) => entry.source?.cardId === card.id))
                            .withContext(`${label}/${card.id} persistent source candidate`).toBeTrue();
                    }
                }
            }
        }
    });

    it('keeps every declarative source edge live in the standardized deck matrix', function() {
        const standardized = new Set(Object.values(DECK_LOADERS).flatMap((loadDeck) =>
            deckEntries(loadDeck()).map((entry) => entry.card.id)));
        for(const profile of Object.values(DECK_SYNERGY_PROFILES)) {
            for(const synergy of profile.edges) {
                if(!synergy.source.cardIds) continue;
                expect(synergy.source.cardIds.some((id) => standardized.has(id)))
                    .withContext(`${profile.id}/${synergy.id}`).toBeTrue();
            }
        }
    });
});
