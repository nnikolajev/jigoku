// Cross-seed integration coverage for every specialized heuristic profile.
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { DishonorTactics } = require('../../../build/server/game/bots/DishonorTactics.js');
const { GloryTactics } = require('../../../build/server/game/bots/GloryTactics.js');
const { DragonTactics } = require('../../../build/server/game/bots/DragonTactics.js');
const { DuelTactics } = require('../../../build/server/game/bots/DuelTactics.js');
const { LionTactics } = require('../../../build/server/game/bots/LionTactics.js');
const { ShugenjaTactics } = require('../../../build/server/game/bots/ShugenjaTactics.js');
const { DragonAttachmentTactics } = require('../../../build/server/game/bots/DragonAttachmentTactics.js');

// These are policy-execution tests, not tactic unit tests. Every scenario enters
// through the real policy class for seeds 1, 2, and 5 with a predefined public
// game state. Prototype spies record coverage per seed, so a newly-added tactic
// method fails this suite until every shipped heuristic seed reaches it through
// a real policy path. Seed 5 also receives its omniscient context.
describe('seed 1, 2, and 5 specialized policy execution coverage', function() {
    const BOT = 'Jigoku Bot';
    const PASS = { text: 'Pass', arg: 'pass', uuid: 'pass' };
    const DONE = { text: 'Done', arg: 'done', uuid: 'done' };
    const CANCEL = { text: 'Cancel', arg: 'cancel', uuid: 'cancel' };
    const FATE = [0, 1, 2, 3, 4, 5].map((amount) => ({
        text: String(amount), arg: String(amount), uuid: `fate-${amount}`
    }));
    const bids = () => FATE.slice(1);
    const POLICY_CASES = [
        { label: 'seed 1 fate-aware', seed: 1, Policy: FateAwareJigokuBotPolicy, omniscient: false },
        { label: 'seed 2 generic', seed: 2, Policy: JigokuBotPolicy, omniscient: false },
        { label: 'seed 5 omniscient', seed: 5, Policy: FateAwareJigokuBotPolicy, omniscient: true }
    ];
    let sequence = 0;
    let activePolicyLabel = null;

    const flags = (extras = {}) => ({
        holdingEngine: false,
        defensive: false,
        aggressive: false,
        dishonor: false,
        glory: false,
        monk: false,
        duelist: false,
        shugenja: false,
        attachmentTower: false,
        ...extras
    });

    const character = (uuid, id = uuid, extras = {}) => ({
        uuid, id, name: id, type: 'character', selectable: true,
        militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '3' },
        glorySummary: { stat: '2' }, attachments: [], ...extras
    });
    const event = (uuid, id = uuid, extras = {}) => ({
        uuid, id, name: id, type: 'event', selectable: true, isPlayableByMe: true, ...extras
    });
    const attachment = (uuid, id = uuid, extras = {}) => ({
        uuid, id, name: id, type: 'attachment', selectable: true, isPlayableByMe: true, ...extras
    });

    function makeState(meOverrides = {}, opponentOverrides = {}, root = {}) {
        const mePiles = meOverrides.cardPiles || {};
        const opponentPiles = opponentOverrides.cardPiles || {};
        const me = {
            id: 'bot-id', name: BOT, phase: 'conflict',
            promptTitle: 'Action Window', menuTitle: 'Initiate an action',
            buttons: [PASS], stats: { fate: 10, honor: 10, conflictsRemaining: 2 },
            provinces: { one: [], two: [], three: [], four: [] },
            strongholdProvince: [],
            cardPiles: { hand: [], cardsInPlay: [], conflictDiscardPile: [], dynastyDiscardPile: [] },
            ...meOverrides,
            stats: { fate: 10, honor: 10, conflictsRemaining: 2, ...(meOverrides.stats || {}) },
            cardPiles: {
                hand: [], cardsInPlay: [], conflictDiscardPile: [], dynastyDiscardPile: [],
                ...mePiles
            }
        };
        const opponent = {
            id: 'opponent-id', name: 'Opponent',
            stats: { fate: 5, honor: 10, conflictsRemaining: 2 },
            provinces: { one: [], two: [], three: [], four: [] },
            strongholdProvince: [],
            cardPiles: { hand: [], cardsInPlay: [], conflictDiscardPile: [], dynastyDiscardPile: [] },
            ...opponentOverrides,
            stats: { fate: 5, honor: 10, conflictsRemaining: 2, ...(opponentOverrides.stats || {}) },
            cardPiles: {
                hand: [], cardsInPlay: [], conflictDiscardPile: [], dynastyDiscardPile: [],
                ...opponentPiles
            }
        };
        return { players: { [BOT]: me, Opponent: opponent }, ...root };
    }

    function policyGroup(name) {
        const policies = POLICY_CASES.map((policyCase) => ({
            ...policyCase,
            policy: new policyCase.Policy(policyCase.seed)
        }));
        return {
            decide(state, botName, context = {}) {
                let seedOneDecision = null;
                for(const entry of policies) {
                    activePolicyLabel = entry.label;
                    try {
                        const omniscient = entry.omniscient ? {
                            oppName: 'Opponent', oppFate: 5, oppHand: [], oppProvinces: [], unmodeledEvents: []
                        } : undefined;
                        const decision = entry.policy.decide(state, botName, {
                            ...(omniscient ? { omniscient } : {}),
                            ...context
                        });
                        if(entry.seed === 1) {
                            seedOneDecision = decision;
                        }
                    } finally {
                        activePolicyLabel = null;
                    }
                }
                return seedOneDecision;
            },
            name
        };
    }

    function run(profile, state, context = {}) {
        sequence += 1;
        return policyGroup(`specialized-coverage-${sequence}`)
            .decide(state, BOT, { profile, roundNumber: 2, cardHint: getPlaybookEntry, ...context });
    }

    function decideWithEveryPolicy(profile, state, context = {}) {
        const decisions = new Map();
        for(const policyCase of POLICY_CASES) {
            activePolicyLabel = policyCase.label;
            try {
                const omniscient = policyCase.omniscient ? {
                    oppName: 'Opponent', oppFate: 5, oppHand: [], oppProvinces: [], unmodeledEvents: []
                } : undefined;
                decisions.set(policyCase.label, new policyCase.Policy(policyCase.seed).decide(state, BOT, {
                    ...(omniscient ? { omniscient } : {}),
                    profile,
                    roundNumber: 2,
                    cardHint: getPlaybookEntry,
                    ...context
                }));
            } finally {
                activePolicyLabel = null;
            }
        }
        return decisions;
    }

    function expectEveryPolicy(decisions, assertion) {
        for(const policyCase of POLICY_CASES) {
            assertion(decisions.get(policyCase.label), policyCase);
        }
    }

    function spyTactic(Tactic) {
        const spies = new Map();
        for(const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(Tactic.prototype))) {
            if(name === 'constructor') {
                continue;
            }
            if(typeof descriptor.value === 'function') {
                const reachedBy = new Set();
                const original = descriptor.value;
                const spy = spyOn(Tactic.prototype, name).and.callFake(function(...args) {
                    if(activePolicyLabel) {
                        reachedBy.add(activePolicyLabel);
                    }
                    return original.apply(this, args);
                });
                spies.set(name, { spy, reachedBy });
            } else if(typeof descriptor.get === 'function') {
                const reachedBy = new Set();
                const original = descriptor.get;
                const spy = spyOnProperty(Tactic.prototype, name, 'get').and.callFake(function() {
                    if(activePolicyLabel) {
                        reachedBy.add(activePolicyLabel);
                    }
                    return original.call(this);
                });
                spies.set(`get ${name}`, { spy, reachedBy });
            }
        }
        return spies;
    }

    function expectComplete(spies) {
        for(const policyCase of POLICY_CASES) {
            const missing = [...spies.entries()]
                .filter(([, coverage]) => !coverage.reachedBy.has(policyCase.label))
                .map(([name]) => name);
            expect(missing)
                .withContext(`specialized methods not reached through ${policyCase.label} policy execution`)
                .toEqual([]);
        }
    }

    function ringState(board = [], hand = [], discard = []) {
        return makeState({
            promptTitle: 'Initiate Conflict', menuTitle: 'Choose an elemental ring', buttons: [PASS],
            cardPiles: { cardsInPlay: board, hand, dynastyDiscardPile: discard }
        }, {}, {
            rings: {
                air: { element: 'air', fate: 0 }, earth: { element: 'earth', fate: 0 },
                fire: { element: 'fire', fate: 0 }, water: { element: 'water', fate: 0 },
                void: { element: 'void', fate: 0 }
            }
        });
    }

    function targetState(sourceCardId, gameActions, mine, theirs, promptTitle = 'Choose a character') {
        return makeState({
            promptTitle, menuTitle: promptTitle, buttons: [CANCEL],
            cardPiles: { cardsInPlay: mine }
        }, { cardPiles: { cardsInPlay: theirs } });
    }

    it('executes shared conflict-card economy through seeds 1, 2, and 5', function() {
        const paid = event('paid', 'paid-pump');
        const free = event('free', 'free-pump');
        const state = makeState({
            promptTitle: 'Conflict Action Window',
            menuTitle: 'Conflict',
            stats: { fate: 2 },
            cardPiles: {
                hand: [paid, free],
                cardsInPlay: [character('defender', 'defender', { inConflict: true, bowed: false })]
            }
        }, {
            cardPiles: {
                cardsInPlay: [character('attacker', 'attacker', { inConflict: true, bowed: false })]
            }
        }, {
            conflict: {
                type: 'military', attackingPlayerId: 'opponent-id', attackerSkill: 4, defenderSkill: 2
            }
        });
        const hint = (cardId) => ({
            cardId,
            useWhen: 'always',
            conflictTypes: [],
            targetSide: 'self',
            targetPreference: 'any',
            priority: 7,
            summary: ''
        });
        const decisions = decideWithEveryPolicy(profileFromStrategy(flags()), state, {
            cardHint: hint,
            conflictCosts: { paid: 2, free: 0 },
            handStats: {
                paid: { military: 2, political: 2 },
                free: { military: 2, political: 2 }
            }
        });

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('free');
        });
    });

    it('shares exact province-break budgeting through seeds 1, 2, and 5', function() {
        const lionProfile = resolveDeckProfile(
            ['hayaken-no-shiro', 'manicured-garden'],
            flags({ aggressive: true })
        );
        const rival = character('rival', 'political-rival', {
            location: 'hand', isPlayableByMe: true,
            militarySkillSummary: {}, politicalSkillSummary: {}
        });
        const lionState = makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Political Earth Conflict',
            stats: { fate: 3 },
            cardPiles: {
                hand: [rival],
                cardsInPlay: [character('lion-attacker', 'lion-attacker', { inConflict: true })]
            }
        }, {
            provinces: {
                one: [{ uuid: 'lion-province', isProvince: true, type: 'province', inConflict: true,
                    strengthSummary: { stat: '4' } }],
                two: [], three: [], four: []
            }
        }, {
            conflict: {
                type: 'political', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                attackerSkill: 1, defenderSkill: 0
            }
        });
        const rivalDecisions = decideWithEveryPolicy(lionProfile, lionState, {
            handStats: { rival: { military: 0, political: 3 } },
            conflictCosts: { rival: 3 }
        });
        expectEveryPolicy(rivalDecisions, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('play-conflict-card');
            expect(decision.args[0]).withContext(policyCase.label).toBe('rival');
        });

        const shugenjaProfile = profileFromStrategy(flags({ shugenja: true }));
        const storm = event('storm-budget', 'supernatural-storm');
        const shugenjaCards = [
            character('dreamer-budget', 'ethereal-dreamer', { inConflict: true }),
            character('kaede-budget', 'isawa-kaede', { inConflict: false }),
            character('adept-budget', 'adept-of-the-waves', { inConflict: false }),
            // Keep Shugenja's strategic plan open without exposing a clickable
            // board action; isolates pure-pump preservation.
            { id: 'meddling-mediator', type: 'character', bowed: false, inConflict: false }
        ];
        const phoenixState = (attackerSkill) => makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Political Earth Conflict',
            stats: { fate: 3 },
            cardPiles: { hand: [storm], cardsInPlay: shugenjaCards }
        }, {
            provinces: {
                one: [{ uuid: 'phoenix-province', isProvince: true, type: 'province', inConflict: true,
                    strengthSummary: { stat: '4' } }],
                two: [], three: [], four: []
            }
        }, {
            conflict: {
                type: 'political', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                attackerSkill, defenderSkill: 0
            }
        });

        // Three live Shugenja make Storm +3. Starting at 1 vs 0 leaves an
        // exact three-skill break deficit against the strength-4 province.
        const needed = decideWithEveryPolicy(shugenjaProfile, phoenixState(1), {
            conflictCosts: { 'storm-budget': 0 }
        });
        expectEveryPolicy(needed, (decision, policyCase) => {
            expect(decision.args[0]).withContext(policyCase.label).toBe('storm-budget');
        });

        const alreadyBreaking = decideWithEveryPolicy(shugenjaProfile, phoenixState(4), {
            conflictCosts: { 'storm-budget': 0 }
        });
        expectEveryPolicy(alreadyBreaking, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('pass-window');
        });
    });

    it('targets Pacifism and Stolen Breath by conflict focus through seeds 1, 2, and 5', function() {
        const profile = profileFromStrategy(flags());
        const scenarios = [
            {
                id: 'pacifism',
                axis: 'military',
                target: character('balanced-4-3', 'balanced-4-3', {
                    militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '3' },
                    attachments: [attachment('breath-copy', 'stolen-breath')]
                }),
                wrongFocus: character('political-6-10', 'political-6-10', {
                    militarySkillSummary: { stat: '6' }, politicalSkillSummary: { stat: '10' }
                })
            },
            {
                id: 'stolen-breath',
                axis: 'political',
                target: character('balanced-10-7', 'balanced-10-7', {
                    militarySkillSummary: { stat: '10' }, politicalSkillSummary: { stat: '7' },
                    attachments: [attachment('pacifism-copy', 'pacifism')]
                }),
                wrongFocus: character('military-12-8', 'military-12-8', {
                    militarySkillSummary: { stat: '12' }, politicalSkillSummary: { stat: '8' }
                })
            }
        ];

        for(const scenario of scenarios) {
            const state = targetState(scenario.id, ['attach'], [], [scenario.wrongFocus, scenario.target]);
            expectEveryPolicy(decideWithEveryPolicy(profile, state, {
                targetHint: {
                    sourceCardId: scenario.id,
                    sourceIsMine: true,
                    gameActions: ['attach']
                },
                cardHint: getPlaybookEntry
            }), (decision) => {
                expect(decision.reason).toBe('attach-debuff-enemy');
                expect(decision.args[0]).toBe(scenario.target.uuid);
            });
        }

        const tengu = character('tengu', 'tengu-sensei', {
            fate: 2,
            militarySkillSummary: { stat: '4' },
            politicalSkillSummary: { stat: '2' }
        });
        const wrongFocusTarget = targetState('stolen-breath', ['attach'], [], [tengu]);
        expectEveryPolicy(decideWithEveryPolicy(profile, wrongFocusTarget, {
            targetHint: {
                sourceCardId: 'stolen-breath',
                sourceIsMine: true,
                gameActions: ['attach']
            },
            cardHint: getPlaybookEntry
        }), (decision) => {
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Cancel');
            expect(decision.reason).toBe('cancel-wrong-side-target');
        });

        const actionWindow = makeState({
            promptTitle: 'Action Window', menuTitle: 'Initiate an action', buttons: [PASS],
            stats: { fate: 4 },
            cardPiles: { hand: [attachment('stolen-breath-hand', 'stolen-breath')] }
        }, {
            cardPiles: { cardsInPlay: [tengu] }
        });
        const shugenjaProfile = profileFromStrategy(flags({ shugenja: true }));
        expectEveryPolicy(decideWithEveryPolicy(shugenjaProfile, actionWindow, {
            cardHint: getPlaybookEntry
        }), (decision) => {
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Pass');
        });
    });

    it('executes tacticless Crab profile branches through every shipped heuristic seed', function() {
        const profile = resolveDeckProfile(
            ['kyuden-hida', 'kaiu-shihei'],
            flags({ holdingEngine: true, defensive: true })
        );
        const board = [0, 1, 2].map((index) => character(`crab-${index}`, `crab-${index}`, {
            location: 'play area'
        }));
        const stronghold = {
            uuid: 'kyuden', id: 'kyuden-hida', name: 'Kyuden Hida', type: 'stronghold',
            location: 'stronghold province', facedown: false, bowed: false
        };

        const mulligan = decideWithEveryPolicy(profile, makeState({
            phase: 'dynasty', promptTitle: 'Dynasty Mulligan', menuTitle: 'Select dynasty cards to mulligan',
            selectCard: true, buttons: [DONE],
            provinces: {
                one: [
                    character('recruit', 'hida-guardian', { isDynasty: true, location: 'province 1' }),
                    { uuid: 'holding', id: 'kaiu-forges', type: 'holding', isDynasty: true, location: 'province 1' }
                ],
                two: [], three: [], four: []
            }
        }));
        expectEveryPolicy(mulligan, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('mulligan-for-holdings');
            expect(decision.args[0]).withContext(policyCase.label).toBe('recruit');
        });

        const dig = decideWithEveryPolicy(profile, makeState({
            phase: 'dynasty', promptTitle: 'Action Window', menuTitle: 'Initiate an action', buttons: [PASS],
            stats: { fate: 5 }, strongholdProvince: [stronghold],
            cardPiles: { cardsInPlay: board },
            provinces: { one: [], two: [], three: [], four: [] }
        }));
        expectEveryPolicy(dig, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('dynasty-dig-action');
            expect(decision.args[0]).withContext(policyCase.label).toBe('kyuden');
        });

        const pressure = decideWithEveryPolicy(profile, makeState({
            promptTitle: 'Military Air Conflict', menuTitle: 'Choose attackers',
            buttons: [{ text: 'Initiate Conflict', arg: 'done', uuid: 'init' }, { text: 'Pass Conflict', arg: 'pass', uuid: 'pass-conflict' }],
            cardPiles: { cardsInPlay: board }
        }, {
            cardPiles: { cardsInPlay: [character('wall', 'wall', { militarySkillSummary: { stat: '8' } })] },
            provinces: {
                one: [{ uuid: 'province', type: 'province', isProvince: true, inConflict: true, strengthSummary: { stat: '5' } }],
                two: [], three: [], four: []
            }
        }));
        expectEveryPolicy(pressure, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('declare-attacker');
        });
    });

    it('executes tacticless Unicorn profile branches through every shipped heuristic seed', function() {
        const profile = resolveDeckProfile(
            ['cavalry-reserves', 'ride-on'],
            flags({ aggressive: true })
        );
        const cavalry = [
            character('a', 'border-rider', { location: 'play area', inConflict: true }),
            character('b', 'moto-youth', { location: 'play area', inConflict: true }),
            character('c', 'shinjo-scout', { location: 'play area' })
        ];

        const military = decideWithEveryPolicy(profile, makeState({
            promptTitle: 'Political Earth Conflict', menuTitle: 'Choose province to attack', buttons: [],
            cardPiles: { cardsInPlay: [character('cavalry', 'cavalry', {
                location: 'play area', militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '4' }
            })] }
        }, {
            provinces: {
                one: [{ uuid: 'target', type: 'province', isProvince: true, strengthSummary: { stat: '4' } }],
                two: [], three: [], four: []
            }
        }));
        expectEveryPolicy(military, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('switch-conflict-type');
        });

        const keepOneHome = decideWithEveryPolicy(profile, makeState({
            promptTitle: 'Military Earth Conflict', menuTitle: 'Choose attackers',
            buttons: [{ text: 'Initiate Conflict', arg: 'done', uuid: 'init' }, { text: 'Pass Conflict', arg: 'pass', uuid: 'pass-conflict' }],
            cardPiles: { cardsInPlay: cavalry }
        }, {
            cardPiles: { cardsInPlay: [character('defender', 'defender', { militarySkillSummary: { stat: '12' } })] },
            provinces: {
                one: [{ uuid: 'target', type: 'province', isProvince: true, inConflict: true, strengthSummary: { stat: '5' } }],
                two: [], three: [], four: []
            }
        }));
        expectEveryPolicy(keepOneHome, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('initiate-conflict');
        });

        const fate = decideWithEveryPolicy(profile, makeState({
            promptTitle: 'Deploy', menuTitle: 'Choose additional fate', buttons: FATE,
            stats: { fate: 10 }
        }), { roundNumber: 1, playCost: 5 });
        expectEveryPolicy(fate, (decision, policyCase) => {
            expect(decision.target).withContext(policyCase.label).toBe('2');
        });
    });

    it('executes every Scorpion dishonor tactic method', function() {
        const spies = spyTactic(DishonorTactics);
        const profile = profileFromStrategy(flags({ dishonor: true }));

        run(profile, ringState([character('liar', 'bayushi-liar')]));
        run(profile, makeState({ promptTitle: 'Honor Bid', menuTitle: 'Choose your bid', buttons: bids() }), { roundNumber: 2 });
        run(profile, makeState({ buttons: [
            { text: `${BOT}'s Conflict` }, { text: "Opponent's Conflict" }
        ] }));
        run(profile, makeState({ buttons: [{ text: BOT }, { text: 'Opponent' }] }));
        run(profile, makeState({
            promptTitle: 'Resolve Air Ring', menuTitle: 'Choose an effect',
            buttons: [{ text: 'Take 1 Honor from opponent' }, { text: 'Gain 2 Honor' }], stats: { honor: 6 }
        }));
        run(profile, makeState({
            promptTitle: 'Resolve Fire Ring', menuTitle: 'Choose character to honor or dishonor', buttons: [],
            cardPiles: { cardsInPlay: [character('mine')] }
        }, { cardPiles: { cardsInPlay: [character('enemy')] } }));
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS], stats: { honor: 4 },
            strongholdProvince: [{
                uuid: 'city', id: 'city-of-the-open-hand', type: 'stronghold', location: 'stronghold province', bowed: false
            }],
            cardPiles: { cardsInPlay: [character('mine', 'bayushi-liar', { inConflict: true })] }
        }, { cardPiles: { cardsInPlay: [character('enemy', 'enemy', { inConflict: true })] } }, {
            conflict: { type: 'military', attackingPlayerId: 'bot-id', attackerSkill: 3, defenderSkill: 5 }
        }));
        run(profile, makeState({
            phase: 'conflict', cardPiles: { hand: [attachment('pacifism')] }
        }, { cardPiles: { cardsInPlay: [character('enemy')] } }));

        const shoju = character('shoju', 'bayushi-shoju-2', {
            isDynasty: true, facedown: false, location: 'province 1'
        });
        const cheap = character('cheap', 'palace-guard', {
            isDynasty: true, facedown: false, location: 'province 1'
        });
        const dynasty = decideWithEveryPolicy(profile, makeState({
            phase: 'dynasty', stats: { fate: 7 },
            provinces: { one: [cheap, shoju], two: [], three: [], four: [] }
        }), { dynastyCosts: { cheap: 1, shoju: 5 }, roundNumber: 1 });
        expectEveryPolicy(dynasty, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('scorpion-play-important-character');
            expect(decision.target).withContext(policyCase.label).toBe('bayushi-shoju-2');
        });

        const shojuFate = decideWithEveryPolicy(profile, makeState({
            phase: 'dynasty', promptTitle: 'Deploy', menuTitle: 'Choose additional fate',
            buttons: FATE, stats: { fate: 7 }
        }), { playCardId: 'bayushi-shoju-2', playCost: 5, roundNumber: 1 });
        expectEveryPolicy(shojuFate, (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('scorpion-important-character-fate');
            expect(decision.target).withContext(policyCase.label).toBe('2');
        });

        expectComplete(spies);
    });

    it('executes every Phoenix glory tactic method', function() {
        const spies = spyTactic(GloryTactics);
        const profile = profileFromStrategy(flags({ glory: true }));
        const tsukune = character('tsukune', 'shiba-tsukune', { inConflict: true, isHonored: true });
        const kaede = character('kaede', 'isawa-kaede');

        run(profile, ringState([tsukune, character('scholar', 'solemn-scholar')], [character('ningyo', 'feral-ningyo')]));
        run(profile, makeState({
            promptTitle: 'Honor Bid', menuTitle: 'Choose your bid for the duel', buttons: bids()
        }));
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS],
            strongholdProvince: [{
                uuid: 'seido', id: 'isawa-mori-seido', type: 'stronghold', location: 'stronghold province', bowed: false
            }],
            cardPiles: {
                cardsInPlay: [tsukune, kaede],
                hand: [event('storm', 'supernatural-storm')]
            }
        }, { cardPiles: { cardsInPlay: [character('enemy', 'enemy', { inConflict: true })] } }, {
            conflict: { type: 'political', attackingPlayerId: 'bot-id', attackerSkill: 3, defenderSkill: 5 }
        }));
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS],
            cardPiles: {
                cardsInPlay: [tsukune, kaede],
                hand: [event('storm-2', 'supernatural-storm')]
            }
        }, { cardPiles: { cardsInPlay: [character('enemy-2', 'enemy', { inConflict: true })] } }, {
            conflict: { type: 'political', attackingPlayerId: 'bot-id', attackerSkill: 3, defenderSkill: 5 }
        }));
        run(profile, targetState('isawa-mori-seido', ['honor'], [tsukune, kaede], []), {
            targetHint: { sourceCardId: 'isawa-mori-seido', sourceIsMine: true, gameActions: ['honor'] }
        });
        run(profile, targetState('ofushikai', ['attach'], [tsukune, kaede], []), {
            targetHint: { sourceCardId: 'ofushikai', sourceIsMine: true, gameActions: ['attach'] }
        });

        expectComplete(spies);
    });

    it('executes every Dragon monk tactic method', function() {
        const spies = spyTactic(DragonTactics);
        const profile = profileFromStrategy(flags({ monk: true }));
        const mitsu = character('mitsu', 'togashi-mitsu-2', { inConflict: true, fate: 3 });

        run(profile, ringState([mitsu], [], [character('keeper', 'keeper-initiate')]));
        run(profile, makeState({ promptTitle: 'Honor Bid', menuTitle: 'Choose your bid', buttons: bids() }), { roundNumber: 2 });
        run(profile, makeState({ promptTitle: 'Honor Bid', menuTitle: 'Choose your bid for the duel', buttons: bids() }));
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS], cardsPlayedThisConflict: 5,
            strongholdProvince: [{
                uuid: 'high-house', id: 'high-house-of-light', type: 'stronghold', location: 'stronghold province', bowed: false
            }],
            cardPiles: { cardsInPlay: [mitsu], hand: [attachment('way', 'way-of-the-dragon')] }
        }, { cardPiles: { cardsInPlay: [character('enemy', 'enemy', { inConflict: true })] } }, {
            conflict: { type: 'military', attackingPlayerId: 'bot-id', attackerSkill: 1, defenderSkill: 5 }
        }));
        run(profile, targetState('way-of-the-dragon', ['attach'], [mitsu, character('philosopher', 'tranquil-philosopher')], []), {
            targetHint: { sourceCardId: 'way-of-the-dragon', sourceIsMine: true, gameActions: ['attach'] }
        });
        run(profile, targetState('finger-of-jade', ['attach'], [mitsu], []), {
            targetHint: { sourceCardId: 'finger-of-jade', sourceIsMine: true, gameActions: ['attach'] }
        });
        run(profile, targetState('cycle-of-rebirth', ['returnToDeck'], [
            character('weak', 'togashi-initiate'), character('tower', 'kitsuki-investigator')
        ], []), {
            targetHint: { sourceCardId: 'cycle-of-rebirth', sourceIsMine: true, gameActions: ['returnToDeck'] }
        });
        run(profile, makeState({
            promptTitle: 'Ancient Master', menuTitle: 'Choose a card', buttons: [CANCEL],
            cardPiles: { hand: [event('void', 'void-fist'), character('acolyte', 'togashi-acolyte')] }
        }), { targetHint: { sourceCardId: 'ancient-master', sourceIsMine: true, gameActions: [] } });

        const buyer = policyGroup('dragon-fate-coverage');
        buyer.decide(makeState({
            phase: 'dynasty', promptTitle: 'Action Window', menuTitle: 'Initiate an action', buttons: [PASS],
            stats: { fate: 10 },
            provinces: { one: [{ ...mitsu, isDynasty: true, facedown: false }], two: [], three: [], four: [] }
        }), BOT, { profile, roundNumber: 1, dynastyCosts: { mitsu: 4 } });
        buyer.decide(makeState({ promptTitle: 'Deploy', menuTitle: 'Choose additional fate', buttons: FATE }), BOT, {
            profile, roundNumber: 1, playCardId: 'togashi-mitsu-2', playCost: 4
        });

        expectComplete(spies);
    });

    it('keeps Dragon dual-mode Monk attachments off enemy characters through seeds 1, 2, and 5', function() {
        const profile = resolveDeckProfile(
            ['high-house-of-light', 'sacred-sanctuary'],
            flags({ monk: true })
        );
        const enemy = character('enemy', 'doji-kuwanan', { selectable: true });
        const noOwnBearer = targetState('ancient-master', ['attach'], [], [enemy]);
        const decisions = decideWithEveryPolicy(profile, noOwnBearer, {
            targetHint: {
                sourceCardId: 'ancient-master', sourceIsMine: true,
                sourceType: 'attachment', gameActions: ['attach']
            }
        });

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Cancel');
            expect(decision.reason).toBe('cancel-wrong-side-target');
        });
    });

    it('spreads Way onto a different useful Action character through seeds 1, 2, and 5', function() {
        const profile = resolveDeckProfile(['high-house-of-light'], flags({ monk: true }));
        const mitsu = character('mitsu', 'togashi-mitsu-2', {
            attachments: [attachment('existing-way', 'way-of-the-dragon')]
        });
        const teacher = character('teacher', 'teacher-of-empty-thought');
        const investigator = character('investigator', 'kitsuki-investigator');
        const state = targetState('way-of-the-dragon', ['attach'], [mitsu, teacher, investigator], []);
        const decisions = decideWithEveryPolicy(profile, state, {
            targetHint: {
                sourceCardId: 'way-of-the-dragon', sourceIsMine: true,
                sourceType: 'attachment', gameActions: ['attach']
            }
        });

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('teacher');
            expect(decision.reason).toBe('dragon-way-repeatable-character');
        });
    });

    it('uses a Way-enabled Togashi Mitsu exactly twice through seeds 1, 2, and 5', function() {
        const profile = resolveDeckProfile(['high-house-of-light'], flags({ monk: true }));
        const mitsu = character('mitsu', 'togashi-mitsu-2', {
            inConflict: true, location: 'play area',
            attachments: [attachment('way', 'way-of-the-dragon')]
        });
        const state = makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS],
            cardsPlayedThisConflict: 5,
            cardPiles: { cardsInPlay: [mitsu] }
        }, {}, {
            conflict: {
                type: 'military', attackingPlayerId: 'bot-id',
                defendingPlayerId: 'opponent-id', attackerSkill: 5, defenderSkill: 0
            }
        });

        for(const policyCase of POLICY_CASES) {
            const omniscient = policyCase.omniscient ? {
                oppName: 'Opponent', oppFate: 5, oppHand: [], oppProvinces: [], unmodeledEvents: []
            } : undefined;
            const context = {
                ...(omniscient ? { omniscient } : {}),
                profile, roundNumber: 2, cardHint: getPlaybookEntry
            };
            const policy = new policyCase.Policy(policyCase.seed);
            expect(policy.decide(state, BOT, context).args[0]).toBe('mitsu');
            expect(policy.decide(state, BOT, context).args[0]).toBe('mitsu');
            expect(policy.decide(state, BOT, context).target).toBe('Pass');
        }
    });

    it('uses High House immediately on empty rings through seeds 1, 2, and 5', function() {
        const profile = resolveDeckProfile(
            ['high-house-of-light', 'sacred-sanctuary'],
            flags({ monk: true })
        );
        const monk = character('monk', 'plain-monk', {
            inConflict: true, location: 'play area', traits: ['monk']
        });
        const state = makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS],
            cardsPlayedThisConflict: 1,
            strongholdProvince: [{
                uuid: 'high-house', id: 'high-house-of-light', name: 'High House of Light',
                type: 'stronghold', location: 'stronghold province', bowed: false
            }],
            cardPiles: {
                cardsInPlay: [monk],
                hand: [
                    event('stance', 'iron-foundations-stance'),
                    event('seafoam', 'swell-of-seafoam'),
                    event('punch', 'hurricane-punch'),
                    character('acolyte', 'togashi-acolyte', { location: 'hand', isPlayableByMe: true })
                ]
            }
        }, { cardPiles: { cardsInPlay: [character('enemy', 'enemy', { inConflict: true })] } }, {
            rings: {
                air: { element: 'air', fate: 0 }, earth: { element: 'earth', fate: 0 },
                fire: { element: 'fire', fate: 0 }, water: { element: 'water', fate: 0 },
                void: { element: 'void', fate: 0 }
            },
            conflict: {
                type: 'military', attackingPlayerId: 'bot-id',
                defendingPlayerId: 'opponent-id', attackerSkill: 2, defenderSkill: 3
            }
        });
        const decisions = decideWithEveryPolicy(profile, state);

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('high-house');
        });
    });

    it('plays a dual-mode Dragon Monk as a character when no friendly bearer exists', function() {
        const profile = resolveDeckProfile(
            ['high-house-of-light', 'sacred-sanctuary'],
            flags({ monk: true })
        );
        const state = makeState({
            promptTitle: 'Play Ancient Master', menuTitle: 'Choose how to play Ancient Master',
            buttons: [
                { text: 'Play Ancient Master as an attachment', arg: 'attachment', uuid: 'attachment' },
                { text: 'Play Ancient Master as a character', arg: 'character', uuid: 'character' },
                CANCEL
            ],
            cardPiles: { cardsInPlay: [] }
        });
        const decisions = decideWithEveryPolicy(profile, state, { playCardId: 'ancient-master' });

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Play Ancient Master as a character');
            expect(decision.reason).toBe('dragon-play-as-character-no-bearer');
        });
    });

    it('commits Dragon Monk defenders when their combined skill can prevent a break', function() {
        const profile = resolveDeckProfile(
            ['high-house-of-light', 'sacred-sanctuary'],
            flags({ monk: true })
        );
        const state = makeState({
            promptTitle: 'Military Water Conflict: 9 vs 0',
            menuTitle: 'Choose defenders', buttons: [DONE],
            provinces: {
                one: [{ uuid: 'frog', id: 'city-of-the-rich-frog', type: 'province',
                    isProvince: true, inConflict: true, strengthSummary: { stat: '3' } }],
                two: [{ id: 'broken-two', isProvince: true, isBroken: true }],
                three: [{ id: 'broken-three', isProvince: true, isBroken: true }],
                four: []
            },
            cardPiles: {
                cardsInPlay: [
                    character('ichi', 'togashi-ichi', { militarySkillSummary: { stat: '6' } }),
                    character('keeper', 'keeper-initiate', { militarySkillSummary: { stat: '1' } })
                ]
            }
        }, {}, {
            conflict: {
                type: 'military', attackingPlayerId: 'opponent-id',
                defendingPlayerId: 'bot-id', attackerSkill: 9, defenderSkill: 0
            }
        });
        const decisions = decideWithEveryPolicy(profile, state);

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('cardClicked');
            expect(decision.target).toBe('togashi-ichi');
            expect(decision.reason).toBe('declare-defender');
        });
    });

    it('defends an outer province when Dragon can tie the attacker', function() {
        const profile = resolveDeckProfile(
            ['high-house-of-light', 'sacred-sanctuary'],
            flags({ monk: true })
        );
        const state = makeState({
            promptTitle: 'Military Water Conflict: 7 vs 0',
            menuTitle: 'Choose defenders', buttons: [DONE],
            provinces: {
                one: [{ uuid: 'frog', id: 'city-of-the-rich-frog', type: 'province',
                    isProvince: true, inConflict: true, strengthSummary: { stat: '3' } }],
                two: [{ id: 'broken-two', isProvince: true, isBroken: true }],
                three: [{ id: 'broken-three', isProvince: true, isBroken: true }],
                four: []
            },
            cardPiles: {
                cardsInPlay: [
                    character('ichi', 'togashi-ichi', { militarySkillSummary: { stat: '6' } }),
                    character('keeper', 'keeper-initiate', { militarySkillSummary: { stat: '1' } })
                ]
            }
        }, {}, {
            conflict: {
                type: 'military', attackingPlayerId: 'opponent-id',
                defendingPlayerId: 'bot-id', attackerSkill: 7, defenderSkill: 0
            }
        });
        const decisions = decideWithEveryPolicy(profile, state);

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('cardClicked');
            expect(decision.target).toBe('togashi-ichi');
            expect(decision.reason).toBe('declare-defender');
        });
    });

    it('preserves the Dragon attack engine before two outer provinces are broken', function() {
        const profile = resolveDeckProfile(
            ['high-house-of-light', 'sacred-sanctuary'],
            flags({ monk: true })
        );
        const state = makeState({
            promptTitle: 'Military Water Conflict: 7 vs 0',
            menuTitle: 'Choose defenders', buttons: [DONE],
            provinces: {
                one: [{ uuid: 'frog', id: 'city-of-the-rich-frog', type: 'province',
                    isProvince: true, inConflict: true, strengthSummary: { stat: '3' } }],
                two: [], three: [], four: []
            },
            cardPiles: {
                cardsInPlay: [
                    character('ichi', 'togashi-ichi', { militarySkillSummary: { stat: '6' } }),
                    character('keeper', 'keeper-initiate', { militarySkillSummary: { stat: '1' } })
                ]
            }
        }, {}, {
            conflict: {
                type: 'military', attackingPlayerId: 'opponent-id',
                defendingPlayerId: 'bot-id', attackerSkill: 7, defenderSkill: 0
            }
        });
        const decisions = decideWithEveryPolicy(profile, state);

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Done');
            expect(decision.reason).toBe('aggressive-concede-defense');
        });
    });

    it('does not start Way of the Dragon when no valuable friendly bearer exists', function() {
        const profile = resolveDeckProfile(
            ['high-house-of-light', 'sacred-sanctuary'],
            flags({ monk: true })
        );
        const state = makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS],
            cardPiles: {
                cardsInPlay: [character('initiate', 'togashi-initiate', { inConflict: true })],
                hand: [attachment('way', 'way-of-the-dragon')]
            }
        }, {
            provinces: {
                one: [{ uuid: 'enemy-province', id: 'manicured-garden', type: 'province',
                    isProvince: true, inConflict: true, strengthSummary: { stat: '4' } }],
                two: [], three: [], four: []
            },
            cardPiles: { cardsInPlay: [character('enemy', 'enemy', { inConflict: true })] }
        }, {
            conflict: {
                type: 'military', attackingPlayerId: 'bot-id',
                defendingPlayerId: 'opponent-id', attackerSkill: 1, defenderSkill: 3
            }
        });
        const decisions = decideWithEveryPolicy(profile, state);

        expectEveryPolicy(decisions, (decision) => {
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Pass');
        });
    });

    it('executes every Crane duel tactic method', function() {
        const spies = spyTactic(DuelTactics);
        const profile = profileFromStrategy(flags({ duelist: true }));
        const tower = character('kaezin', 'kakita-kaezin', { isDynasty: true, facedown: false });
        const helper = character('scout', 'cautious-scout', { isDynasty: true, facedown: false });
        const buyer = policyGroup('duel-coverage');

        buyer.decide(makeState({
            phase: 'dynasty', stats: { fate: 8 },
            provinces: { one: [tower, helper], two: [], three: [], four: [] }
        }), BOT, { profile, roundNumber: 1, dynastyCosts: { kaezin: 3, scout: 1 } });
        run(profile, makeState({
            phase: 'dynasty', stats: { fate: 4 },
            provinces: { one: [tower, helper], two: [], three: [], four: [] }
        }), { dynastyCosts: { kaezin: 3, scout: 1 } });
        buyer.decide(makeState({ promptTitle: 'Deploy', menuTitle: 'Choose additional fate', buttons: FATE, stats: { fate: 8 } }), BOT, {
            profile, roundNumber: 1, playCardId: 'kakita-kaezin', playCost: 3
        });
        run(profile, ringState([tower]));
        run(profile, makeState({ promptTitle: 'Honor Bid', menuTitle: 'Choose your bid for the duel', buttons: bids() }));
        run(profile, makeState({ promptTitle: 'Honor Bid', menuTitle: 'Choose your bid for the duel', buttons: bids() }), {
            duelGap: 0
        });
        run(profile, makeState({
            phase: 'regroup', promptTitle: 'Regroup', menuTitle: 'Select dynasty cards to discard', buttons: [DONE],
            provinces: { one: [tower, helper], two: [], three: [], four: [] }
        }));
        run(profile, targetState('policy-debate', ['duel'], [tower], [character('enemy')]), {
            targetHint: { sourceCardId: 'policy-debate', sourceIsMine: true, gameActions: ['duel'] }
        });
        // Favorable Make Your Case execution reaches the shared injectable
        // start gate: projected duel skill, opponent-choice strongest target,
        // and Iaijutsu Master's equal-skill allowance.
        const favorite = character('favorite-duel', 'kakita-favorite', {
            inConflict: true, bowed: false,
            politicalSkillSummary: { stat: '5' },
            attachments: [
                attachment('blade-duel', 'kakita-blade'),
                attachment('master-duel', 'iaijutsu-master')
            ]
        });
        const makeCase = event('make-case-coverage', 'make-your-case');
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Political conflict',
            cardPiles: { hand: [makeCase], cardsInPlay: [favorite] }
        }, {
            provinces: {
                one: [{ uuid: 'duel-province', isProvince: true, type: 'province', inConflict: true,
                    strengthSummary: { stat: '4' } }],
                two: [], three: [], four: []
            },
            cardPiles: { cardsInPlay: [character('enemy-duelist', 'enemy-duelist', {
                inConflict: true, bowed: false, politicalSkillSummary: { stat: '9' }
            })] }
        }, {
            conflict: {
                type: 'political', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                attackerSkill: 3, defenderSkill: 4
            }
        }));
        run(profile, targetState('kakita-blade', ['attach'], [
            { ...tower, attachments: [attachment('fan', 'ornate-fan')] },
            character('toshimoko', 'kakita-toshimoko')
        ], []), {
            targetHint: { sourceCardId: 'kakita-blade', sourceIsMine: true, gameActions: ['attach'] }
        });
        run(profile, makeState({
            promptTitle: 'Iaijutsu Master', menuTitle: 'Choose one',
            buttons: [
                { text: 'Increase honor bid', arg: 'increase', uuid: 'increase' },
                { text: 'Decrease honor bid', arg: 'decrease', uuid: 'decrease' },
                PASS
            ]
        }), { duelMargin: 2 });
        run(profile, makeState({
            promptTitle: 'Any reactions to a duel?', menuTitle: 'Any reactions?', buttons: [PASS],
            cardPiles: { cardsInPlay: [character('master', 'iaijutsu-master')] }
        }), { duelMargin: 0 });
        run(profile, targetState('way-of-the-crane', ['honor'], [tower, helper], []), {
            targetHint: { sourceCardId: 'way-of-the-crane', sourceIsMine: true, gameActions: ['honor'] }
        });
        run(profile, targetState('noble-sacrifice', ['sacrifice'], [
            { ...helper, isHonored: true }, { ...tower, isHonored: true, fate: 3 }
        ], []), {
            targetHint: { sourceCardId: 'noble-sacrifice', sourceIsMine: true, gameActions: ['sacrifice'] }
        });
        run(profile, targetState('noble-sacrifice', ['discardFromPlay'], [], [
            character('weak-enemy', 'weak-enemy', { isDishonored: true }),
            character('enemy-tower', 'enemy-tower', { isDishonored: true, fate: 3 })
        ]), {
            targetHint: { sourceCardId: 'noble-sacrifice', sourceIsMine: true, gameActions: ['discardFromPlay'] }
        });

        expectComplete(spies);
    });

    it('executes every Lion tactic method', function() {
        const spies = spyTactic(LionTactics);
        const strategy = flags({ aggressive: true });
        const profile = resolveDeckProfile(['hayaken-no-shiro', 'ashigaru-levy', 'for-greater-glory'], strategy);
        const cheap = character('cheap', 'matsu-berserker', { inConflict: true, bowed: true, isDynasty: true, facedown: false });
        const tower = character('toturi', 'akodo-toturi', { fate: 2, isDynasty: true, facedown: false });
        const buyer = policyGroup('lion-coverage');

        run(profile, makeState({ promptTitle: 'Honor Bid', menuTitle: 'Choose your bid', buttons: bids() }), { roundNumber: 2 });
        run(profile, makeState({ promptTitle: 'Honor Bid', menuTitle: 'Choose your bid for the duel', buttons: bids() }));
        buyer.decide(makeState({
            phase: 'dynasty', stats: { fate: 7 },
            provinces: { one: [cheap, tower], two: [], three: [], four: [] }
        }), BOT, { profile, roundNumber: 1, dynastyCosts: { cheap: 2, toturi: 5 } });
        run(profile, makeState({
            phase: 'dynasty', stats: { fate: 7 },
            cardPiles: { cardsInPlay: [character('new-bushi', 'akodo-gunso', { new: true, isHonored: false })] },
            provinces: {
                one: [event('veterans', 'honored-veterans', { isDynasty: true, facedown: false })],
                two: [character('toturi-a', 'akodo-toturi', { isDynasty: true, facedown: false })],
                three: [character('tsanuri', 'matsu-tsanuri-2', { isDynasty: true, facedown: false })],
                four: []
            }
        }), { dynastyCosts: { veterans: 1, 'toturi-a': 5, tsanuri: 5 } });
        run(profile, makeState({
            phase: 'dynasty', stats: { fate: 9 },
            provinces: {
                one: [character('toturi-b', 'akodo-toturi', { isDynasty: true, facedown: false })],
                two: [character('general-b', 'honored-general', { isDynasty: true, facedown: false })],
                three: [], four: []
            }
        }), { dynastyCosts: { 'toturi-b': 5, 'general-b': 5 } });
        buyer.decide(makeState({ promptTitle: 'Deploy', menuTitle: 'Choose additional fate', buttons: FATE, stats: { fate: 7 } }), BOT, {
            profile, roundNumber: 1, playCardId: 'matsu-berserker', playCost: 2
        });
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS],
            strongholdProvince: [{
                uuid: 'hayaken', id: 'hayaken-no-shiro', type: 'stronghold', location: 'stronghold province', bowed: false
            }],
            cardPiles: { cardsInPlay: [cheap, tower] }
        }, { cardPiles: { cardsInPlay: [character('enemy', 'enemy', { inConflict: true })] } }, {
            conflict: { type: 'military', attackingPlayerId: 'bot-id', attackerSkill: 3, defenderSkill: 5 }
        }));
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS],
            provinces: {
                one: [{
                    uuid: 'weight', id: 'weight-of-duty', type: 'province', isProvince: true,
                    location: 'province 1', inConflict: true, isBroken: false
                }],
                two: [], three: [], four: []
            },
            cardPiles: { cardsInPlay: [cheap], hand: [event('hand-card')] }
        }, { cardPiles: { cardsInPlay: [character('enemy-province', 'enemy', { inConflict: true })] } }, {
            conflict: { type: 'military', attackingPlayerId: 'bot-id', attackerSkill: 3, defenderSkill: 5 }
        }));
        run(profile, makeState({
            promptTitle: 'Any reactions?', menuTitle: 'Any reactions?', buttons: [PASS],
            cardPiles: {
                cardsInPlay: [cheap, character('b2', 'akodo-gunso'), character('b3', 'matsu-gohei'),
                    character('b4', 'matsu-beiona'), character('b5', 'ashigaru-levy')],
                hand: [event('feeding', 'feeding-an-army')]
            }
        }));
        run(profile, makeState({
            promptTitle: 'Illustrious Forge', menuTitle: 'Choose an attachment', buttons: [CANCEL],
            cardPiles: { hand: [attachment('tessen', 'elegant-tessen'), attachment('katana', 'fine-katana')] }
        }), { targetHint: { sourceCardId: 'illustrious-forge', sourceIsMine: true, gameActions: [] } });
        for(const scenario of [
            ['emperor-s-summons', ['putIntoPlay']],
            ['forebearer-s-echoes', ['putIntoPlay']],
            ['weight-of-duty', ['sacrifice']],
            ['elegant-tessen', ['attach']],
            ['true-strike-kenjutsu', ['attach']],
            ['in-service-to-my-lord', ['bow']],
            ['in-service-to-my-lord', ['ready']]
        ]) {
            run(profile, targetState(scenario[0], scenario[1], [cheap, tower], [character('enemy')]), {
                targetHint: { sourceCardId: scenario[0], sourceIsMine: true, gameActions: scenario[1] }
            });
        }
        run(profile, targetState('in-service-to-my-lord', ['ready'], [
            character('toturi-ready', 'akodo-toturi', { bowed: true, isUnique: true }),
            character('general-ready', 'honored-general', { bowed: true, isUnique: false })
        ], []), {
            targetHint: { sourceCardId: 'in-service-to-my-lord', sourceIsMine: true, gameActions: ['ready'] }
        });

        expectComplete(spies);
    });

    it('executes Lion reaction, target, and conflict hooks through seeds 1, 2, and 5', function() {
        const profile = resolveDeckProfile(
            ['hayaken-no-shiro', 'ashigaru-levy', 'for-greater-glory', 'feeding-an-army'],
            flags({ aggressive: true })
        );
        const bushi = ['matsu-berserker', 'akodo-gunso', 'matsu-gohei', 'matsu-beiona', 'ashigaru-levy']
            .map((id, index) => character(`bushi-${index}`, id, { traits: ['bushi'], selectable: false }));

        const feedingState = makeState({
            promptTitle: 'Any reactions to conflict phase starting?', menuTitle: 'Any reactions?', buttons: [PASS],
            cardPiles: { cardsInPlay: bushi, hand: [event('feeding', 'feeding-an-army')] }
        });
        expectEveryPolicy(decideWithEveryPolicy(profile, feedingState), (decision) => {
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('feeding');
        });

        const art = {
            uuid: 'art', id: 'the-art-of-war', type: 'province', isProvince: true,
            location: 'province 1', selectable: true, strengthSummary: { stat: '4' }
        };
        const stronghold = {
            uuid: 'stronghold-province', id: 'ancestral-lands', type: 'province', isProvince: true,
            location: 'stronghold province', selectable: true, strengthSummary: { stat: '8' }
        };
        const feedingTarget = makeState({
            promptTitle: 'Feeding an Army', menuTitle: 'Choose a province', buttons: [CANCEL],
            provinces: { one: [art], two: [], three: [], four: [] }, strongholdProvince: [stronghold]
        });
        expectEveryPolicy(decideWithEveryPolicy(profile, feedingTarget, {
            targetHint: { sourceCardId: 'feeding-an-army', sourceIsMine: true, gameActions: ['break'] }
        }), (decision) => {
            expect(decision.reason).toBe('lion-feeding-break-own-province');
            expect(decision.args[0]).toBe('art');
        });

        const gloryState = makeState({
            promptTitle: 'Any reactions to a province breaking?', menuTitle: 'Any reactions?', buttons: [PASS],
            stats: { fate: 2 }, cardPiles: { cardsInPlay: bushi, hand: [event('glory', 'for-greater-glory')] }
        });
        expectEveryPolicy(decideWithEveryPolicy(profile, gloryState, { conflictCosts: { glory: 1 } }), (decision) => {
            expect(decision.args[0]).toBe('glory');
        });

        const committed = character('committed', 'akodo-toturi', {
            inConflict: true, fate: 2, traits: ['bushi'], militarySkillSummary: { stat: '5' }
        });
        const payoff = character('payoff', 'matsu-berserker', {
            fate: 0, traits: ['bushi'], militarySkillSummary: { stat: '1' }
        });
        const declaration = makeState({
            promptTitle: 'Military Earth Conflict', menuTitle: 'Choose attackers',
            buttons: [{ text: 'Initiate Conflict', arg: 'done', uuid: 'done' }],
            stats: { fate: 2, militaryRemaining: 1, politicalRemaining: 1 },
            cardPiles: { cardsInPlay: [committed, payoff], hand: [event('glory-hand', 'for-greater-glory')] }
        }, { cardPiles: { cardsInPlay: [] } });
        expectEveryPolicy(decideWithEveryPolicy(profile, declaration, {
            legalDirectCardUuids: { payoff: true }
        }), (decision) => {
            expect(decision.reason).toBe('declare-attacker');
            expect(decision.args[0]).toBe('payoff');
        });

        const ownUnique = character('own-unique', 'akodo-toturi', { bowed: true, isUnique: true });
        const enemyUnique = character('enemy-unique', 'enemy-champion', { bowed: true, isUnique: true });
        const readyTarget = targetState('in-service-to-my-lord', ['ready'], [ownUnique], [enemyUnique]);
        expectEveryPolicy(decideWithEveryPolicy(profile, readyTarget, {
            targetHint: { sourceCardId: 'in-service-to-my-lord', sourceIsMine: true, gameActions: ['ready'] }
        }), (decision) => {
            expect(decision.reason).toBe('lion-in-service-ready-strong');
            expect(decision.args[0]).toBe('own-unique');
        });
        expectEveryPolicy(decideWithEveryPolicy(profile, readyTarget, {
            targetHint: { sourceCardId: 'in-service-to-my-lord', sourceIsMine: true, gameActions: [] }
        }), (decision) => {
            expect(decision.reason).toBe('lion-in-service-ready-strong');
            expect(decision.args[0]).toBe('own-unique');
        });
    });

    it('filters illegal direct-click cards and copy-limited attachments through seeds 1, 2, and 5', function() {
        const generic = profileFromStrategy(flags());
        const illegal = character('yojimbo', 'hiruma-yojimbo', { militarySkillSummary: { stat: '9' } });
        const legal = character('legal-attacker', 'legal-attacker', { militarySkillSummary: { stat: '3' } });
        const declaration = makeState({
            promptTitle: 'Military Earth Conflict', menuTitle: 'Choose attackers',
            buttons: [{ text: 'Initiate Conflict', arg: 'done', uuid: 'done' }],
            stats: { militaryRemaining: 1, politicalRemaining: 1 },
            cardPiles: { cardsInPlay: [illegal, legal] }
        });
        expectEveryPolicy(decideWithEveryPolicy(generic, declaration, {
            legalDirectCardUuids: { 'legal-attacker': true }
        }), (decision) => {
            expect(decision.args[0]).toBe('legal-attacker');
        });

        const covertState = makeState({
            promptTitle: 'Military Earth Conflict', menuTitle: 'Choose covert targets'
        }, {
            cardPiles: { cardsInPlay: [
                character('illegal-covert', 'illegal-covert', { militarySkillSummary: { stat: '9' } }),
                character('legal-covert', 'legal-covert', { militarySkillSummary: { stat: '2' } })
            ] }
        });
        expectEveryPolicy(decideWithEveryPolicy(generic, covertState, {
            legalDirectCardUuids: { 'legal-covert': true }
        }), (decision) => {
            expect(decision.args[0]).toBe('legal-covert');
        });

        const firstProvince = {
            uuid: 'illegal-province', id: 'illegal-province', type: 'province', isProvince: true,
            location: 'province 1', facedown: false, strengthSummary: { stat: '3' }
        };
        const secondProvince = {
            uuid: 'legal-province', id: 'legal-province', type: 'province', isProvince: true,
            location: 'province 2', facedown: false, strengthSummary: { stat: '3' }
        };
        const provinceChoice = makeState({
            promptTitle: 'Military Earth Conflict', menuTitle: 'Choose province',
            stats: { militaryRemaining: 1, politicalRemaining: 1 },
            cardPiles: { cardsInPlay: [character('province-attacker', 'province-attacker', {
                militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '0' }
            })] }
        }, {
            provinces: { one: [firstProvince], two: [secondProvince], three: [], four: [] }
        });
        expectEveryPolicy(decideWithEveryPolicy(generic, provinceChoice, {
            legalDirectCardUuids: { 'legal-province': true }
        }), (decision) => {
            expect(decision.args[0]).toBe('legal-province');
        });

        const deadProvince = {
            uuid: 'dead-province', id: 'ancestral-lands', type: 'province', isProvince: true,
            location: 'province 1', inConflict: true, isBroken: false, strengthSummary: { stat: '8' }
        };
        const defensiveWindow = makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS],
            provinces: { one: [deadProvince], two: [], three: [], four: [] }
        }, {}, {
            conflict: { type: 'military', attackingPlayerId: 'opponent-id', attackerSkill: 5, defenderSkill: 0 }
        });
        expectEveryPolicy(decideWithEveryPolicy(generic, defensiveWindow, {
            legalDirectCardUuids: {}
        }), (decision) => {
            expect(decision.args[0]).not.toBe('dead-province');
            expect(decision.target).toBe('Pass');
        });

        const crab = resolveDeckProfile(['kaiu-shihei', 'kyuden-hida'], flags({ holdingEngine: true, defensive: true }));
        const kyuden = {
            uuid: 'illegal-kyuden', id: 'kyuden-hida', name: 'Kyuden Hida', type: 'stronghold',
            location: 'stronghold province', facedown: false, bowed: false
        };
        const digWindow = makeState({
            phase: 'dynasty', promptTitle: 'Action Window', menuTitle: 'Initiate an action', buttons: [PASS],
            stats: { fate: 5 }, strongholdProvince: [kyuden],
            cardPiles: { cardsInPlay: [
                character('crab-1'), character('crab-2'), character('crab-3')
            ] }
        });
        expectEveryPolicy(decideWithEveryPolicy(crab, digWindow, {
            legalDirectCardUuids: {}
        }), (decision) => {
            expect(decision.args[0]).not.toBe('illegal-kyuden');
            expect(decision.target).toBe('Pass');
        });

        const commander = attachment('commander', 'watch-commander');
        const occupied = character('occupied', 'hida-kisada', { attachments: [commander] });
        const open = character('open', 'kuni-ritsuko', { attachments: [] });
        const target = targetState('watch-commander', ['attach'], [occupied, open], []);
        expectEveryPolicy(decideWithEveryPolicy(generic, target, {
            targetHint: { sourceCardId: 'watch-commander', sourceIsMine: true, gameActions: ['attach'] }
        }), (decision) => {
            expect(decision.args[0]).toBe('open');
        });
    });

    it('does not toggle into an exhausted conflict type through seeds 1, 2, and 5', function() {
        const profile = resolveDeckProfile(['hayaken-no-shiro', 'for-greater-glory'], flags({ aggressive: true }));
        const enemyProvince = {
            uuid: 'enemy-province', id: 'enemy-province', type: 'province', isProvince: true,
            location: 'province 1', facedown: false, selectable: true, strengthSummary: { stat: '3' }
        };
        const state = makeState({
            promptTitle: 'Political Air Conflict', menuTitle: 'Choose province',
            stats: { militaryRemaining: 0, politicalRemaining: 1 },
            cardPiles: { cardsInPlay: [character('attacker', 'matsu-berserker')] }
        }, { provinces: { one: [enemyProvince], two: [], three: [], four: [] } });
        expectEveryPolicy(decideWithEveryPolicy(profile, state), (decision) => {
            expect(decision.command).not.toBe('ringClicked');
        });
    });

    it('executes every Phoenix Shugenja tactic method', function() {
        const spies = spyTactic(ShugenjaTactics);
        const profile = profileFromStrategy(flags({ shugenja: true }));
        const tadaka = character('tadaka', 'isawa-tadaka-2', { isPlayableByMe: true });
        const dreamer = character('dreamer', 'ethereal-dreamer', { fate: 2, isDynasty: true, facedown: false });
        const adept = character('adept', 'adept-of-the-waves', { inConflict: true, bowed: true });
        const enemyTower = character('enemy-tower', 'enemy-tower', { inConflict: true, fate: 5 });

        run(profile, ringState([adept], [character('ningyo', 'feral-ningyo')]));
        run(profile, makeState({
            promptTitle: 'Offerings', menuTitle: 'Choose a ring to claim and resolve', buttons: [] ,
            selectRing: true,
            cardPiles: { cardsInPlay: [adept] }
        }, { cardPiles: { cardsInPlay: [enemyTower] } }, {
            rings: { water: { element: 'water' }, void: { element: 'void' }, earth: { element: 'earth' } }
        }));
        run(profile, makeState({
            promptTitle: 'Asako Togama', menuTitle: 'Choose a ring to take', buttons: [],
            selectRing: true,
            cardPiles: { cardsInPlay: [character('togama', 'asako-togama', { inConflict: true }), adept] }
        }, { cardPiles: { cardsInPlay: [enemyTower] } }, {
            rings: {
                water: { element: 'water', fate: 1 },
                air: { element: 'air', fate: 2 },
                earth: { element: 'earth', fate: 0 }
            }
        }));

        const buyer = policyGroup('shugenja-coverage');
        buyer.decide(makeState({
            phase: 'dynasty', stats: { fate: 7 }, cardPiles: { hand: [tadaka] },
            provinces: { one: [dreamer], two: [], three: [], four: [] }
        }), BOT, { profile, roundNumber: 1, dynastyCosts: { dreamer: 1 } });
        buyer.decide(makeState({
            promptTitle: 'Deploy', menuTitle: 'Choose additional fate', buttons: FATE, stats: { fate: 7 },
            cardPiles: { hand: [tadaka] }
        }), BOT, { profile, roundNumber: 1, playCardId: 'ethereal-dreamer', playCost: 1 });

        run(profile, makeState({
            phase: 'dynasty', stats: { fate: 7 },
            provinces: { one: [character('bird', 'fushicho', { isDynasty: true, facedown: false })], two: [], three: [], four: [] },
            cardPiles: { dynastyDiscardPile: [character('champion', 'shiba-tsukune', { cost: 5 })] }
        }), { dynastyCosts: { bird: 5 } });
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS], stats: { fate: 5 },
            strongholdProvince: [{
                uuid: 'kyuden', id: 'kyuden-isawa', type: 'stronghold', location: 'stronghold province', bowed: false
            }],
            cardPiles: {
                cardsInPlay: [adept],
                hand: [event('fires', 'consumed-by-five-fires'), event('oracle-hand', 'oracle-of-stone')],
                conflictDiscardPile: [event('waves-discard', 'against-the-waves')]
            }
        }, { cardPiles: { cardsInPlay: [enemyTower] } }, {
            conflict: { type: 'military', attackingPlayerId: 'bot-id', attackerSkill: 1, defenderSkill: 6 }
        }));
        // Five Fires correctly precedes Kyuden when both are live. Use a
        // separate state without Fires to prove the Kyuden recast branch is
        // still executable through every seed policy.
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS], stats: { fate: 5 },
            strongholdProvince: [{
                uuid: 'kyuden-only', id: 'kyuden-isawa', type: 'stronghold', location: 'stronghold province', bowed: false
            }],
            cardPiles: {
                cardsInPlay: [adept],
                hand: [event('oracle-only', 'oracle-of-stone')],
                conflictDiscardPile: [event('waves-only', 'against-the-waves')]
            }
        }, { cardPiles: { cardsInPlay: [enemyTower] } }, {
            conflict: { type: 'military', attackingPlayerId: 'bot-id', attackerSkill: 1, defenderSkill: 6 }
        }));
        run(profile, makeState({
            promptTitle: 'Military Fire Conflict: 5 vs 0', menuTitle: 'Choose defenders', buttons: [DONE], stats: { fate: 2 },
            cardPiles: { cardsInPlay: [adept], hand: [event('display', 'display-of-power')] }
        }));
        run(profile, makeState({
            promptTitle: 'Conflict Action Window', menuTitle: 'Conflict', buttons: [PASS], stats: { fate: 2 },
            cardPiles: { cardsInPlay: [character('mediator', 'meddling-mediator', { inConflict: true })] }
        }, { cardPiles: { cardsInPlay: [character('enemy-plan', 'enemy', { inConflict: true })] } }, {
            conflict: { type: 'political', attackingPlayerId: 'bot-id', attackerSkill: 3, defenderSkill: 5 }
        }));
        run(profile, makeState({
            phase: 'conflict', stats: { fate: 2 }, cardPiles: { hand: [attachment('stolen', 'stolen-breath')] }
        }, { cardPiles: { cardsInPlay: [enemyTower] } }));

        for(const scenario of [
            ['isawa-tadaka-2', ['removeFromGame'], [dreamer]],
            ['fushicho', ['putIntoPlay'], [character('champion2', 'shiba-tsukune', { cost: 5 })]],
            ['isawa-ujina', ['removeFromGame'], [dreamer]],
            ['kyuden-isawa', ['discardCard'], [event('oracle', 'oracle-of-stone')]],
            ['shrine-maiden', ['putIntoPlay'], [event('waves', 'against-the-waves')]],
            ['oracle-of-stone', ['discardCard'], [event('cheap', 'banzai', { cost: 0 })]],
            ['consumed-by-five-fires', ['removeFate'], []],
            ['supernatural-storm', ['modifySkill'], [adept, dreamer]]
        ]) {
            run(profile, targetState(scenario[0], scenario[1], scenario[2], [enemyTower]), {
                targetHint: { sourceCardId: scenario[0], sourceIsMine: true, gameActions: scenario[1] }
            });
        }
        run(profile, targetState('isawa-tadaka-2', [], [dreamer], [], 'Choose a character to replace'), {
            targetHint: { sourceCardId: 'isawa-tadaka-2', sourceIsMine: true, gameActions: [] }
        });

        expectComplete(spies);
    });

    it('holds Clarity of Purpose when no ready character participates through seeds 1, 2, and 5', function() {
        const profile = profileFromStrategy(flags({ shugenja: true }));
        const homeTower = character('home-tadaka', 'isawa-tadaka-2', {
            bowed: false, inConflict: false
        });
        const state = makeState({
            promptTitle: 'Conflict Action Window',
            menuTitle: 'Military Water conflict\nAttacker: 0 Defender: 0',
            buttons: [PASS],
            stats: { fate: 1 },
            strongholdProvince: [{
                uuid: 'kyuden', id: 'kyuden-isawa', type: 'stronghold',
                location: 'stronghold province', bowed: false
            }],
            cardPiles: {
                cardsInPlay: [homeTower],
                hand: [event('oracle-hand', 'oracle-of-stone')],
                conflictDiscardPile: [event('clarity-discard', 'clarity-of-purpose')]
            }
        }, { cardPiles: { cardsInPlay: [] } }, {
            conflict: {
                type: 'military', attackingPlayerId: 'opponent-id',
                defendingPlayerId: 'bot-id', attackerSkill: 0, defenderSkill: 0
            }
        });

        expectEveryPolicy(decideWithEveryPolicy(profile, state), (decision, policyCase) => {
            expect(decision.target).withContext(policyCase.label).toBe('Pass');
        });

        const targetPrompt = targetState(
            'clarity-of-purpose', ['cardLastingEffect'], [homeTower], [], 'Choose a character'
        );
        expectEveryPolicy(decideWithEveryPolicy(profile, targetPrompt, {
            targetHint: {
                sourceCardId: 'clarity-of-purpose', sourceIsMine: true,
                gameActions: ['cardLastingEffect']
            }
        }), (decision, policyCase) => {
            expect(decision.command).withContext(policyCase.label).toBe('menuButton');
            expect(decision.target).withContext(policyCase.label).toBe('Cancel');
        });

        const kyudenSpellPrompt = makeState({
            promptTitle: 'Kyuden Isawa', menuTitle: 'Choose a Spell event',
            buttons: [CANCEL], stats: { fate: 1 },
            cardPiles: {
                cardsInPlay: [homeTower],
                conflictDiscardPile: [event('clarity-choice', 'clarity-of-purpose')]
            }
        }, {}, {
            conflict: {
                type: 'military', attackingPlayerId: 'opponent-id',
                defendingPlayerId: 'bot-id', attackerSkill: 0, defenderSkill: 0
            }
        });
        const kyudenContext = {
            targetHint: { sourceCardId: 'kyuden-isawa', sourceIsMine: true, gameActions: [] }
        };
        expectEveryPolicy(decideWithEveryPolicy(profile, kyudenSpellPrompt, kyudenContext),
            (decision, policyCase) => {
                expect(decision.command).withContext(policyCase.label).toBe('menuButton');
                expect(decision.target).withContext(policyCase.label).toBe('Cancel');
            });

        homeTower.inConflict = true;
        kyudenSpellPrompt.conflict.type = 'political';
        expectEveryPolicy(decideWithEveryPolicy(profile, kyudenSpellPrompt, kyudenContext),
            (decision, policyCase) => {
                expect(decision.reason).withContext(policyCase.label).toBe('replay-card-shared-play-intent');
                expect(decision.args[0]).withContext(policyCase.label).toBe('clarity-choice');
            });
    });

    it('uses identical direct-play intent for hand and inherently playable discard cards in every seed', function() {
        const profile = profileFromStrategy(flags());
        const readyCost = character('ready-cost', 'matsu-berserker', {
            isUnique: false, bowed: false, inConflict: true
        });
        const bowedUnique = character('bowed-unique', 'akodo-toturi', {
            isUnique: true, bowed: true, inConflict: false
        });
        const makeWindow = (pile) => makeState({
            promptTitle: 'Conflict Action Window',
            menuTitle: 'Military conflict', buttons: [PASS], stats: { fate: 0 },
            cardPiles: {
                hand: pile === 'hand' ? [event('service-hand', 'in-service-to-my-lord', {
                    location: 'hand', isPlayableByMe: true
                })] : [],
                conflictDiscardPile: pile === 'discard' ? [event('service-discard', 'in-service-to-my-lord', {
                    location: 'conflict discard pile', isPlayableByMe: true
                })] : [],
                cardsInPlay: [readyCost, bowedUnique]
            }
        }, {}, {
            conflict: {
                type: 'military', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                attackerSkill: 2, defenderSkill: 4
            }
        });

        for(const pile of ['hand', 'discard']) {
            expectEveryPolicy(decideWithEveryPolicy(profile, makeWindow(pile)),
                (decision, policyCase) => {
                    expect(decision.reason).withContext(`${policyCase.label} ${pile}`).toBe('play-conflict-card');
                    expect(decision.args[0]).withContext(`${policyCase.label} ${pile}`)
                        .toBe(pile === 'hand' ? 'service-hand' : 'service-discard');
                });
        }
    });

    it('uses normal play intent for Bayushi Kachiko cards in the opponent discard in every seed', function() {
        const profile = profileFromStrategy(flags({ dishonor: true }));
        const participant = character('kachiko', 'bayushi-kachiko-2', {
            bowed: false, inConflict: true
        });
        const discardedEvent = event('opponent-oracle', 'oracle-of-stone', {
            location: 'conflict discard pile', isPlayableByMe: true
        });
        const state = makeState({
            promptTitle: 'Conflict Action Window',
            menuTitle: 'Political conflict', buttons: [PASS], stats: { fate: 1 },
            cardPiles: { cardsInPlay: [participant], hand: [], conflictDiscardPile: [] }
        }, {
            cardPiles: { cardsInPlay: [], conflictDiscardPile: [discardedEvent] }
        }, {
            conflict: {
                type: 'political', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                attackerSkill: 3, defenderSkill: 3
            }
        });

        expectEveryPolicy(decideWithEveryPolicy(profile, state, {
            conflictCosts: { 'opponent-oracle': 0 }
        }), (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('play-conflict-card');
            expect(decision.args[0]).withContext(policyCase.label).toBe('opponent-oracle');
        });
    });

    it('uses shared intent for generic paid replay but leaves free put-into-play effects specialized', function() {
        const genericProfile = profileFromStrategy(flags());
        const participant = character('participant', 'adept-of-the-waves', {
            bowed: false, inConflict: true
        });
        const paidReplay = makeState({
            promptTitle: 'Warm Welcome', menuTitle: 'Choose a conflict card',
            buttons: [CANCEL], stats: { fate: 2 },
            cardPiles: {
                cardsInPlay: [participant],
                conflictDiscardPile: [
                    event('dead-fires', 'consumed-by-five-fires', { location: 'conflict discard pile' }),
                    event('useful-oracle', 'oracle-of-stone', { location: 'conflict discard pile' })
                ]
            }
        }, {}, {
            conflict: {
                type: 'military', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                attackerSkill: 1, defenderSkill: 3
            }
        });
        expectEveryPolicy(decideWithEveryPolicy(genericProfile, paidReplay, {
            targetHint: {
                sourceCardId: 'warm-welcome', sourceIsMine: true, gameActions: ['playCard']
            },
            conflictCosts: { 'dead-fires': 5, 'useful-oracle': 0 }
        }), (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('replay-card-shared-play-intent');
            expect(decision.args[0]).withContext(policyCase.label).toBe('useful-oracle');
        });

        const freeReplay = makeState({
            promptTitle: 'Kunshu', menuTitle: 'Choose an opponent conflict card',
            buttons: [], stats: { fate: 0 },
            cardPiles: { cardsInPlay: [participant] }
        }, {
            cardPiles: {
                cardsInPlay: [character('fated-enemy', 'enemy-tower', { fate: 5 })],
                conflictDiscardPile: [
                    event('free-fires', 'consumed-by-five-fires', { location: 'conflict discard pile' }),
                    event('free-oracle', 'oracle-of-stone', { location: 'conflict discard pile' })
                ]
            }
        }, {
            conflict: {
                type: 'military', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                attackerSkill: 1, defenderSkill: 3
            }
        });
        expectEveryPolicy(decideWithEveryPolicy(genericProfile, freeReplay, {
            targetHint: {
                sourceCardId: 'kunshu', sourceIsMine: true, gameActions: ['playCard'],
                playCardFateCostIgnored: true
            },
            conflictCosts: { 'free-fires': 5, 'free-oracle': 0 }
        }), (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('replay-card-shared-play-intent');
            expect(decision.args[0]).withContext(policyCase.label).toBe('free-fires');
        });

        const shugenjaProfile = profileFromStrategy(flags({ shugenja: true }));
        const freeResurrection = makeState({
            promptTitle: 'Fushicho', menuTitle: 'Choose a character', buttons: [CANCEL],
            cardPiles: {
                dynastyDiscardPile: [character('tsukune', 'shiba-tsukune', {
                    cost: 5, location: 'dynasty discard pile'
                })]
            }
        });
        expectEveryPolicy(decideWithEveryPolicy(shugenjaProfile, freeResurrection, {
            targetHint: {
                sourceCardId: 'fushicho', sourceIsMine: true, gameActions: ['putIntoPlay']
            }
        }), (decision, policyCase) => {
            expect(decision.reason).withContext(policyCase.label).toBe('fushicho-five-cost-character');
            expect(decision.args[0]).withContext(policyCase.label).toBe('tsukune');
        });
    });

    it('executes every Dragon attachment tactic method', function() {
        const spies = spyTactic(DragonAttachmentTactics);
        const profile = profileFromStrategy(flags({ attachmentTower: true }));
        const raitsugu = character('raitsugu', 'mirumoto-raitsugu', { isDynasty: true, facedown: false, fate: 4 });
        const niten = character('niten', 'niten-master', { bowed: true, fate: 3, attachments: [
            attachment('w1', 'fine-katana'), attachment('w2', 'tetsubo-of-blood')
        ] });

        const buyer = policyGroup('attachment-coverage');
        buyer.decide(makeState({
            phase: 'dynasty', stats: { fate: 8 },
            provinces: { one: [raitsugu, character('helper', 'doomed-shugenja', { isDynasty: true, facedown: false })], two: [], three: [], four: [] }
        }), BOT, { profile, roundNumber: 1, dynastyCosts: { raitsugu: 3, helper: 1 } });
        run(profile, makeState({
            phase: 'dynasty', stats: { fate: 4 },
            provinces: {
                one: [raitsugu, character('helper-2', 'doomed-shugenja', { isDynasty: true, facedown: false })],
                two: [], three: [], four: []
            }
        }), { dynastyCosts: { raitsugu: 3, 'helper-2': 1 } });
        buyer.decide(makeState({ promptTitle: 'Deploy', menuTitle: 'Choose additional fate', buttons: FATE, stats: { fate: 8 } }), BOT, {
            profile, roundNumber: 1, playCardId: 'mirumoto-raitsugu', playCost: 3
        });
        run(profile, makeState({
            promptTitle: 'Dynasty Mulligan', menuTitle: 'Dynasty Mulligan', buttons: [DONE],
            provinces: { one: [character('mulligan', 'doomed-shugenja')], two: [], three: [], four: [] }
        }));
        run(profile, makeState({
            phase: 'regroup', promptTitle: 'Regroup', menuTitle: 'Select dynasty cards to discard', buttons: [DONE],
            provinces: { one: [raitsugu, character('discard', 'doomed-shugenja')], two: [], three: [], four: [] }
        }));
        run(profile, ringState([
            { ...raitsugu, attachments: [attachment('tanto', 'inscribed-tanto')] },
            character('inventive', 'inventive-mirumoto')
        ], [], [attachment('discarded', 'fine-katana')]));

        run(profile, makeState({
            phase: 'conflict', promptTitle: 'Action Window', menuTitle: 'Initiate an action', buttons: [PASS],
            stronghold: { id: 'iron-mountain-castle', bowed: true },
            cardPiles: {
                cardsInPlay: [{ ...raitsugu, attachments: [attachment('favor', 'daimyo-s-favor', {
                    location: 'play area'
                })] }],
                hand: [attachment('blood', 'tetsubo-of-blood', { cost: 2 })]
            }
        }));
        run(profile, makeState({
            promptTitle: 'Search', menuTitle: 'Choose an attachment', buttons: [CANCEL],
            cardPiles: { hand: [attachment('low', 'ornate-fan'), attachment('high', 'tetsubo-of-blood')] }
        }), { targetHint: { sourceCardId: 'agasha-swordsmith', sourceIsMine: true, gameActions: [] } });
        run(profile, makeState({
            promptTitle: 'Keen Warrior', menuTitle: 'Choose a card to put on the bottom', buttons: [CANCEL],
            cardPiles: { hand: [attachment('low2', 'ornate-fan'), attachment('high2', 'tetsubo-of-blood')] }
        }), { targetHint: { sourceCardId: 'keen-warrior', sourceIsMine: true, gameActions: [] } });
        run(profile, targetState('togashi-yokuni', ['copy'], [
            character('yokuni', 'togashi-yokuni'), character('niten2', 'niten-master')
        ], [character('enemy-ability', 'tengu-sensei')]), {
            targetHint: { sourceCardId: 'togashi-yokuni', sourceIsMine: true, gameActions: ['copy'] }
        });
        for(const id of ['fine-katana', 'two-heavens-technique', 'adopted-kin', 'elegant-tessen']) {
            run(profile, targetState(id, ['attach'], [niten, raitsugu], []), {
                targetHint: { sourceCardId: id, sourceIsMine: true, gameActions: ['attach'] }
            });
        }

        expectComplete(spies);
    });
});
