const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
const { ShugenjaTactics, SHUGENJA_DEFAULTS } = require('../../../build/server/game/bots/ShugenjaTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

describe('Phoenix Shugenja tactics', function() {
    const tactics = new ShugenjaTactics(SHUGENJA_DEFAULTS);
    const strategy = deriveDeckStrategy(['kyuden-isawa']);
    const profile = resolveDeckProfile(['kyuden-isawa', 'vassal-fields'], strategy);

    function stateFor(me, opponent = {}) {
        return {
            players: {
                Phoenix: { name: 'Phoenix', cardPiles: {}, stats: {}, strongholdProvince: [], ...me },
                Crane: { name: 'Crane', cardPiles: {}, stats: {}, strongholdProvince: [], ...opponent }
            },
            rings: {}
        };
    }

    it('is derived only from Kyuden Isawa and carries its own profile', function() {
        expect(strategy.shugenja).toBe(true);
        expect(deriveDeckStrategy(['isawa-mori-seido', 'asako-tsuki']).shugenja).toBe(false);
        expect(profileFromStrategy(strategy).shugenja).toEqual(SHUGENJA_DEFAULTS);
        expect(profile.strongholdProvinceId).toBe('vassal-fields');
    });

    it('has playbook knowledge for every deck-specific active card', function() {
        const active = [
            'adept-of-the-waves', 'against-the-waves', 'asako-togama', 'asako-tsuki',
            'clarity-of-purpose', 'consumed-by-five-fires', 'display-of-power',
            'earth-becomes-sky', 'ethereal-dreamer', 'fushicho', 'isawa-tadaka-2',
            'isawa-ujina', 'kudaka', 'kyuden-isawa', 'meddling-mediator',
            'offerings-to-the-kami', 'prodigy-of-the-waves', 'shiba-tetsu',
            'shiba-tsukune', 'shiba-yojimbo', 'shrine-maiden', 'supernatural-storm',
            'the-path-of-man'
        ];
        for(const id of active) {
            expect(getPlaybookEntry(id)).withContext(id).toBeDefined();
        }
    });

    it('steers rings from live Water, Air, and Void payoffs', function() {
        const board = [{ id: 'prodigy-of-the-waves' }, { id: 'asako-tsuki' }, { id: 'kudaka' }, { id: 'isawa-ujina' }];
        expect(tactics.ringBonus('water', board, [{ id: 'feral-ningyo' }])).toBe(3 * SHUGENJA_DEFAULTS.ringCardBonus);
        expect(tactics.ringBonus('air', board, [])).toBe(SHUGENJA_DEFAULTS.ringCardBonus);
        expect(tactics.ringBonus('void', board, [])).toBe(SHUGENJA_DEFAULTS.ringCardBonus);
        expect(tactics.ringBonus('earth', board, [])).toBe(0);
    });

    it('aims ready and boost effects at the practical large-body towers', function() {
        const cheap = { id: 'adept-of-the-waves', uuid: 'cheap', fate: 3, inConflict: true };
        const tadaka = { id: 'isawa-tadaka-2', uuid: 'tadaka', fate: 1 };
        expect(tactics.pickTower([cheap, tadaka], () => 2)).toBe(tadaka);
    });

    it('disguises Tadaka over the cheap Shugenja carrying the most fate', function() {
        const prodigy = { id: 'prodigy-of-the-waves', uuid: 'prodigy', fate: 2, bowed: true, inConflict: true };
        const adept = { id: 'adept-of-the-waves', uuid: 'adept', fate: 3, bowed: false };
        const philosopher = { id: 'young-philosopher', uuid: 'philosopher', fate: 2, attachments: [{ id: 'clarity' }] };
        expect(tactics.pickDisguiseTarget([adept, prodigy])).toBe(adept);
        expect(tactics.pickDisguiseTarget([prodigy, philosopher])).toBe(philosopher);
        expect(tactics.pickDisguiseTarget([adept, prodigy], 1)).toBe(prodigy);
        expect(tactics.pickDisguiseTarget([{ id: 'asako-tsuki', uuid: 'unique', fate: 4 }])).toBeNull();
    });

    it('prepares a cheap two-fate base and proactively disguises Tadaka onto it', function() {
        const dreamer = { id: 'ethereal-dreamer', uuid: 'dreamer', type: 'character', fate: 2 };
        const tadaka = { id: 'isawa-tadaka-2', uuid: 'tadaka', type: 'character', isPlayableByMe: true };
        expect(tactics.pickTadakaSetupCharacter(
            [dreamer, { id: 'adept-of-the-waves', uuid: 'adept' }],
            [tadaka],
            { dreamer: 1, adept: 2 },
            7
        )).toBe(dreamer);
        expect(tactics.desiredAdditionalFate('ethereal-dreamer', [tadaka], 7, 1)).toBe(2);
        expect(tactics.pickTadakaPlay([tadaka], [dreamer], 4)).toBe(tadaka);

        const state = stateFor({
            phase: 'conflict',
            promptTitle: 'Action Window',
            menuTitle: 'Initiate an action',
            buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
            stats: { fate: 4 },
            cardPiles: { hand: [tadaka], cardsInPlay: [dreamer] }
        });
        const decision = new JigokuBotPolicy('tadaka-phase-window').decide(state, 'Phoenix', { profile });
        expect(decision.reason).toBe('tadaka-prepared-disguise');
        expect(decision.args[0]).toBe('tadaka');
    });

    it('buys Fushicho only with a five-cost dynasty-discard target', function() {
        const fushicho = {
            id: 'fushicho', uuid: 'fushicho', name: 'Fushicho', type: 'character',
            isDynasty: true, facedown: false
        };
        const makeState = (discard) => stateFor({
            phase: 'dynasty',
            promptTitle: 'Play cards from provinces',
            menuTitle: 'Initiate an action',
            buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
            stats: { fate: 7 },
            provinces: { one: [fushicho], two: [], three: [], four: [] },
            cardPiles: { hand: [], cardsInPlay: [], dynastyDiscardPile: discard }
        });
        const noTarget = new JigokuBotPolicy('fushicho-no-target').decide(
            makeState([{ id: 'isawa-ujina', uuid: 'ujina', type: 'character' }]),
            'Phoenix',
            { profile, dynastyCosts: { fushicho: 6 } }
        );
        expect(noTarget.reason).toBe('pass-window');

        const withTarget = new JigokuBotPolicy('fushicho-with-target').decide(
            makeState([{ id: 'shiba-tsukune', uuid: 'tsukune', type: 'character' }]),
            'Phoenix',
            { profile, dynastyCosts: { fushicho: 6 } }
        );
        expect(withTarget.args[0]).toBe('fushicho');
    });

    it('resurrects the five-cost character with Fushicho', function() {
        const tsukune = {
            id: 'shiba-tsukune', uuid: 'tsukune', type: 'character', selectable: true,
            militarySkillSummary: { stat: '4' }
        };
        const ujina = {
            id: 'isawa-ujina', uuid: 'ujina', type: 'character', selectable: true,
            militarySkillSummary: { stat: '9' }
        };
        const state = stateFor({
            promptTitle: 'Fushicho', menuTitle: 'Choose a character', buttons: [],
            cardPiles: { dynastyDiscardPile: [ujina, tsukune] }
        });
        const decision = new JigokuBotPolicy('fushicho-target').decide(state, 'Phoenix', {
            profile,
            targetHint: { sourceCardId: 'fushicho', sourceIsMine: true, gameActions: ['putIntoPlay'] }
        });
        expect(decision.reason).toBe('fushicho-five-cost-character');
        expect(decision.args[0]).toBe('tsukune');
    });

    it('protects build-around spells when paying Kyuden Isawa costs', function() {
        const display = { id: 'display-of-power', uuid: 'display', cost: 2 };
        const oracle = { id: 'oracle-of-stone', uuid: 'oracle', cost: 0 };
        expect(tactics.pickKyudenDiscard([display, oracle])).toBe(oracle);
        expect(tactics.pickSpell([oracle, display])).toBe(display);
        expect(tactics.pickWeakest([{ id: 'fushicho' }, { id: 'ethereal-dreamer' }]).id).toBe('ethereal-dreamer');
    });

    it('recasts only Spell Actions that can resolve in the current Kyuden window', function() {
        const spell = (id, cost) => ({ id, cost, type: 'event', traits: ['spell'] });
        const context = {
            fate: 5,
            myCharacters: [{ id: 'isawa-ujina', bowed: false, inConflict: true }],
            opponentCharacters: [{ id: 'doji-challenger', type: 'character', fate: 5 }]
        };
        expect(tactics.pickKyudenSpell([
            spell('display-of-power', 2),
            spell('consumed-by-five-fires', 5),
            spell('oracle-of-stone', 0)
        ], context).id).toBe('consumed-by-five-fires');
        expect(tactics.pickKyudenSpell([spell('display-of-power', 2)], context)).toBeNull();
    });

    it('uses the normal hand playbook gate when Kyuden selects a spell from discard', function() {
        const storm = {
            id: 'supernatural-storm', uuid: 'storm-discard', type: 'event',
            location: 'conflict discard pile', selectable: true
        };
        const shugenja = {
            id: 'adept-of-the-waves', uuid: 'adept', type: 'character',
            bowed: false, inConflict: true
        };
        const state = stateFor({
            id: 'phoenix-id', promptTitle: 'Kyuden Isawa',
            menuTitle: 'Choose a Spell event',
            buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
            stats: { fate: 1 },
            cardPiles: {
                hand: [], cardsInPlay: [shugenja], conflictDiscardPile: [storm]
            }
        }, { id: 'crane-id', cardPiles: { cardsInPlay: [] } });
        state.conflict = {
            type: 'military', attackingPlayerId: 'phoenix-id', defendingPlayerId: 'crane-id',
            attackerSkill: 1, defenderSkill: 3
        };
        const context = {
            profile,
            cardHint: (cardId) => getPlaybookEntry(cardId),
            targetHint: {
                sourceCardId: 'kyuden-isawa', sourceUuid: 'kyuden',
                sourceIsMine: true, gameActions: ['playCard']
            },
            conflictCosts: { 'storm-discard': 0 }
        };

        const oneShugenja = new JigokuBotPolicy('kyuden-shared-storm-gate-one')
            .decide(state, 'Phoenix', context);
        expect(oneShugenja.command).toBe('menuButton');
        expect(oneShugenja.target).toBe('Cancel');

        state.players.Phoenix.cardPiles.cardsInPlay.push({
            id: 'ethereal-dreamer', uuid: 'dreamer', type: 'character',
            bowed: false, inConflict: false
        });
        const twoShugenja = new JigokuBotPolicy('kyuden-shared-storm-gate-two')
            .decide(state, 'Phoenix', context);
        expect(twoShugenja.reason).toBe('replay-card-shared-play-intent');
        expect(twoShugenja.args[0]).toBe('storm-discard');
    });

    it('uses normal hand play intent for generic paid replay prompts', function() {
        const deadFiveFires = {
            id: 'consumed-by-five-fires', uuid: 'aaa-dead-five-fires', type: 'event',
            location: 'conflict discard pile', selectable: true
        };
        const oracle = {
            id: 'oracle-of-stone', uuid: 'zzz-oracle', type: 'event',
            location: 'conflict discard pile', selectable: true
        };
        const state = stateFor({
            id: 'phoenix-id', promptTitle: 'Warm Welcome',
            menuTitle: 'Choose a conflict card',
            buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
            stats: { fate: 2 },
            cardPiles: {
                hand: [],
                cardsInPlay: [{
                    id: 'adept-of-the-waves', uuid: 'adept', type: 'character',
                    bowed: false, inConflict: true
                }],
                conflictDiscardPile: [deadFiveFires, oracle]
            }
        }, { id: 'crane-id', cardPiles: { cardsInPlay: [] } });
        state.conflict = {
            type: 'military', attackingPlayerId: 'phoenix-id', defendingPlayerId: 'crane-id',
            attackerSkill: 0, defenderSkill: 2
        };

        const decision = new JigokuBotPolicy('generic-paid-replay')
            .decide(state, 'Phoenix', {
                cardHint: (cardId) => getPlaybookEntry(cardId),
                targetHint: {
                    sourceCardId: 'warm-welcome', sourceUuid: 'welcome',
                    sourceIsMine: true, gameActions: ['playCard']
                },
                conflictCosts: { 'aaa-dead-five-fires': 5, 'zzz-oracle': 0 }
            });

        expect(decision.reason).toBe('replay-card-shared-play-intent');
        expect(decision.args[0]).toBe('zzz-oracle');
    });

    it('uses Clarity of Purpose hand intent for Kyuden instead of a replay-only duplicate', function() {
        const clarity = { id: 'clarity-of-purpose', cost: 1, type: 'event', traits: ['spell'] };
        const context = {
            fate: 1,
            conflictType: 'military',
            myCharacters: [
                { id: 'isawa-tadaka-2', uuid: 'tadaka', bowed: false, inConflict: false },
                { id: 'shiba-tsukune', uuid: 'tsukune', bowed: false, inConflict: false }
            ],
            opponentCharacters: []
        };
        context.canPlayConflictCard = (card) => {
            const gate = getPlaybookEntry(card.id).shouldPlay;
            return !gate || gate(context);
        };

        expect(tactics.pickKyudenSpell([clarity], context)).toBeNull();
        context.myCharacters[0].inConflict = true;
        expect(tactics.pickKyudenSpell([clarity], context)).toBe(clarity);
        context.conflictType = 'political';
        expect(tactics.pickKyudenSpell([clarity], context)).toBe(clarity);
    });

    it('plays Clarity of Purpose in an already-won political conflict to preserve its participant', function() {
        const clarity = {
            id: 'clarity-of-purpose', uuid: 'clarity', type: 'event',
            location: 'hand', isPlayableByMe: true
        };
        const participant = {
            id: 'isawa-tadaka-2', uuid: 'tadaka', type: 'character',
            bowed: false, inConflict: true,
            militarySkillSummary: { stat: '5' }, politicalSkillSummary: { stat: '5' }
        };
        const state = stateFor({
            id: 'phoenix-id', phase: 'conflict',
            promptTitle: 'Conflict Action Window',
            menuTitle: 'Political Air conflict\nAttacker: 5 Defender: 0',
            buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
            stats: { fate: 1, honor: 10, conflictsRemaining: 1 },
            cardPiles: { hand: [clarity], cardsInPlay: [participant] }
        }, {
            id: 'crane-id', stats: { conflictsRemaining: 1 },
            cardPiles: { cardsInPlay: [] }
        });
        state.conflict = {
            type: 'political', attackingPlayerId: 'phoenix-id', defendingPlayerId: 'crane-id',
            attackerSkill: 5, defenderSkill: 0
        };

        const decision = new JigokuBotPolicy('clarity-political-resolution').decide(state, 'Phoenix', {
            profile,
            cardHint: (cardId) => getPlaybookEntry(cardId),
            conflictCosts: { clarity: 1 }
        });
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('clarity');
    });

    it('selects Clarity of Purpose from Kyuden with the same participant gate as hand', function() {
        const clarity = {
            id: 'clarity-of-purpose', uuid: 'clarity-discard', type: 'event',
            location: 'conflict discard pile', selectable: true
        };
        const participant = {
            id: 'isawa-tadaka-2', uuid: 'tadaka', type: 'character',
            bowed: false, inConflict: true
        };
        const state = stateFor({
            id: 'phoenix-id', promptTitle: 'Kyuden Isawa',
            menuTitle: 'Choose a Spell event',
            buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
            stats: { fate: 1 },
            cardPiles: {
                hand: [], cardsInPlay: [participant], conflictDiscardPile: [clarity]
            }
        }, { id: 'crane-id', cardPiles: { cardsInPlay: [] } });
        state.conflict = {
            type: 'political', attackingPlayerId: 'phoenix-id', defendingPlayerId: 'crane-id',
            attackerSkill: 5, defenderSkill: 0
        };
        const context = {
            profile,
            cardHint: (cardId) => getPlaybookEntry(cardId),
            conflictCosts: { 'clarity-discard': 1 },
            targetHint: { sourceCardId: 'kyuden-isawa', sourceIsMine: true, gameActions: ['playCard'] }
        };

        const political = new JigokuBotPolicy('kyuden-clarity-political').decide(state, 'Phoenix', context);
        expect(political.reason).toBe('replay-card-shared-play-intent');
        expect(political.args[0]).toBe('clarity-discard');

        state.conflict.type = 'military';
        const military = new JigokuBotPolicy('kyuden-clarity-military').decide(state, 'Phoenix', context);
        expect(military.reason).toBe('replay-card-shared-play-intent');
        expect(military.args[0]).toBe('clarity-discard');
    });

    it('cancels a Clarity of Purpose target prompt rather than protecting a home character', function() {
        const homeTower = {
            id: 'isawa-tadaka-2', uuid: 'tadaka', type: 'character', selectable: true,
            bowed: false, inConflict: false, militarySkillSummary: { stat: '5' }
        };
        const state = stateFor({
            promptTitle: 'Clarity of Purpose', menuTitle: 'Choose a character',
            buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
            cardPiles: { cardsInPlay: [homeTower] }
        });
        const context = {
            profile,
            targetHint: {
                sourceCardId: 'clarity-of-purpose', sourceIsMine: true,
                gameActions: ['cardLastingEffect']
            }
        };

        const cancel = new JigokuBotPolicy('clarity-home-cancel').decide(state, 'Phoenix', context);
        expect(cancel.command).toBe('menuButton');
        expect(cancel.target).toBe('Cancel');

        homeTower.inConflict = true;
        const protect = new JigokuBotPolicy('clarity-participant').decide(state, 'Phoenix', context);
        expect(protect.command).toBe('cardClicked');
        expect(protect.args[0]).toBe('tadaka');
    });

    it('finishes an Against the Waves target when the adapter omits owner metadata', function() {
        const bowedShugenja = {
            id: 'isawa-ujina', uuid: 'ujina', type: 'character', selectable: true,
            bowed: true, militarySkillSummary: { stat: '3' }
        };
        const state = stateFor({
            promptTitle: 'Against the Waves', menuTitle: 'Choose a character',
            buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
            cardPiles: { cardsInPlay: [] }
        });
        // Some live target adapters expose legal cards outside the owning
        // player's public pile. The rules target is still self-only Shugenja.
        state.selectableCards = [bowedShugenja];
        const decision = new JigokuBotPolicy('waves-ownerless-target').decide(state, 'Phoenix', {
            profile,
            cardHint: (cardId) => getPlaybookEntry(cardId),
            targetHint: {
                sourceCardId: 'against-the-waves', sourceIsMine: true,
                gameActions: ['bow', 'ready']
            }
        });
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('ujina');
        expect(decision.reason).toBe('waves-ready-bowed');
    });

    it('reserves five fate when Five Fires can remove an enemy tower', function() {
        const me = {
            cardPiles: {
                cardsInPlay: [{ id: 'isawa-ujina' }],
                hand: [{ id: 'consumed-by-five-fires', type: 'event' }],
                conflictDiscardPile: []
            },
            strongholdProvince: [{ id: 'kyuden-isawa', bowed: false }]
        };
        const opponent = { cardPiles: { cardsInPlay: [{ type: 'character', fate: 5 }] } };
        expect(tactics.desiredFateReserve(me, opponent)).toBe(5);
        opponent.cardPiles.cardsInPlay[0].attachments = [{ id: 'pacifism' }];
        expect(tactics.desiredFateReserve(me, opponent)).toBe(1);
        opponent.cardPiles.cardsInPlay.push({ type: 'character', fate: 5 });
        expect(tactics.desiredFateReserve(me, opponent)).toBe(5);
    });

    it('preserves the remaining Tadaka disguise payment after preparing a base', function() {
        const me = {
            cardPiles: {
                cardsInPlay: [{ id: 'ethereal-dreamer', fate: 2 }],
                hand: [{ id: 'isawa-tadaka-2', type: 'character' }],
                conflictDiscardPile: []
            },
            strongholdProvince: [{ id: 'kyuden-isawa', bowed: false }]
        };
        const opponent = { cardPiles: { cardsInPlay: [] } };

        expect(tactics.desiredFateReserve(me, opponent)).toBe(4);
        me.cardPiles.cardsInPlay.push({ id: 'isawa-tadaka-2', fate: 2 });
        expect(tactics.desiredFateReserve(me, opponent)).toBe(1);
    });

    it('plays Five Fires proactively and ignores neutralized fate stacks', function() {
        const fires = {
            id: 'consumed-by-five-fires', uuid: 'fires', type: 'event', isPlayableByMe: true
        };
        const shugenja = { id: 'isawa-ujina', uuid: 'ujina', type: 'character' };
        const neutralized = {
            id: 'doji-challenger', uuid: 'neutralized', type: 'character', fate: 7,
            attachments: [{ id: 'stolen-breath' }]
        };
        const liveTower = { id: 'doji-whisperer', uuid: 'live', type: 'character', fate: 5 };
        const makeState = (opponentCharacters) => stateFor({
            phase: 'conflict',
            promptTitle: 'Action Window',
            menuTitle: 'Initiate an action',
            buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
            stats: { fate: 5 },
            cardPiles: { hand: [fires], cardsInPlay: [shugenja] }
        }, { cardPiles: { cardsInPlay: opponentCharacters } });

        expect(tactics.pickFiveFiresTarget([neutralized, liveTower])).toBe(liveTower);
        const play = new JigokuBotPolicy('five-fires-phase').decide(
            makeState([neutralized, liveTower]), 'Phoenix', { profile }
        );
        expect(play.reason).toBe('five-fires-tower-removal');
        expect(play.args[0]).toBe('fires');

        const pass = new JigokuBotPolicy('five-fires-disabled').decide(
            makeState([neutralized]), 'Phoenix', { profile }
        );
        expect(pass.reason).toBe('pass-window');
    });

    it('Offerings balances ring fate against live Air and Water payoffs', function() {
        const offeringsState = (characters) => stateFor({
            promptTitle: 'Choose a ring to claim and resolve',
            menuTitle: 'Choose a ring to claim and resolve',
            selectRing: true,
            buttons: [],
            cardPiles: { cardsInPlay: characters }
        }, {
            cardPiles: { cardsInPlay: [{ type: 'character', fate: 3 }] }
        });
        const kudakaOnly = offeringsState([{ id: 'kudaka', uuid: 'kudaka', type: 'character' }]);
        kudakaOnly.rings = {
            air: { element: 'air', fate: 0, unselectable: false },
            earth: { element: 'earth', fate: 2, unselectable: false },
            void: { element: 'void', fate: 0, unselectable: false },
            water: { element: 'water', fate: 0, unselectable: false }
        };
        expect(new JigokuBotPolicy('offerings-fate').decide(kudakaOnly, 'Phoenix', { profile }).args[0]).toBe('earth');

        const withWater = offeringsState([
            { id: 'prodigy-of-the-waves', uuid: 'prodigy', type: 'character', bowed: true }
        ]);
        withWater.rings = {
            air: { element: 'air', fate: 1, unselectable: false },
            earth: { element: 'earth', fate: 0, unselectable: false },
            void: { element: 'void', fate: 0, unselectable: false },
            water: { element: 'water', fate: 0, unselectable: false }
        };
        expect(new JigokuBotPolicy('offerings-water').decide(withWater, 'Phoenix', { profile }).args[0]).toBe('water');
    });

    it('Asako Togama takes the highest-fate ring and uses live payoffs to break fate ties', function() {
        const togamaState = stateFor({
            promptTitle: 'Asako Togama',
            menuTitle: 'Choose a ring to take',
            selectRing: true,
            buttons: [],
            cardPiles: {
                cardsInPlay: [
                    { id: 'asako-togama', uuid: 'togama', type: 'character', inConflict: true },
                    { id: 'kudaka', uuid: 'kudaka', type: 'character' }
                ]
            }
        });
        togamaState.rings = {
            air: { element: 'air', fate: 2, unselectable: false },
            earth: { element: 'earth', fate: 2, unselectable: false },
            water: { element: 'water', fate: 1, unselectable: false }
        };
        expect(new JigokuBotPolicy('togama-tie').decide(togamaState, 'Phoenix', { profile }).args[0]).toBe('air');

        togamaState.rings.earth.fate = 3;
        expect(new JigokuBotPolicy('togama-max-fate').decide(togamaState, 'Phoenix', { profile }).args[0]).toBe('earth');
    });

    it('counts Asako Togama as a strategic conflict action only while participating', function() {
        const togama = { id: 'asako-togama', uuid: 'togama', type: 'character', inConflict: false };
        const me = {
            stats: { fate: 1 },
            cardPiles: { hand: [], conflictDiscardPile: [], cardsInPlay: [togama] },
            strongholdProvince: []
        };
        const opponent = { cardPiles: { cardsInPlay: [] } };

        expect(tactics.hasStrategicAction(me, opponent)).toBe(false);
        togama.inConflict = true;
        expect(tactics.hasStrategicAction(me, opponent)).toBe(true);
    });

    it('ignores stale selectRing state while Kyuden Isawa is choosing a discard', function() {
        const state = stateFor({
            promptTitle: 'Kyuden Isawa',
            menuTitle: 'Select card to discard',
            selectRing: true,
            buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
            cardPiles: {
                hand: [{ id: 'oracle-of-stone', uuid: 'oracle', type: 'event', selectable: true }]
            }
        });
        state.rings = {
            air: { element: 'air', fate: 2, unselectable: false },
            water: { element: 'water', fate: 0, unselectable: false }
        };
        const decision = new JigokuBotPolicy('stale-ring-state').decide(state, 'Phoenix', {
            profile,
            targetHint: { sourceCardId: 'kyuden-isawa', sourceIsMine: true, gameActions: ['discardCard'] }
        });
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('oracle');
    });

    it('Meddling Mediator takes fate before honor', function() {
        const buttons = [
            { text: 'Take 1 fate', arg: 'fate', uuid: 'fate' },
            { text: 'Take 1 honor', arg: 'honor', uuid: 'honor' }
        ];
        const withFate = stateFor({ promptTitle: 'Choose', menuTitle: 'Take 1 fate or 1 honor', buttons }, { stats: { fate: 2 } });
        const withoutFate = stateFor({ promptTitle: 'Choose', menuTitle: 'Take 1 fate or 1 honor', buttons }, { stats: { fate: 0 } });
        expect(new JigokuBotPolicy('mediator-1').decide(withFate, 'Phoenix', { profile }).args[0]).toBe('fate');
        expect(new JigokuBotPolicy('mediator-2').decide(withoutFate, 'Phoenix', { profile }).args[0]).toBe('honor');
    });

    it('uses Display for character-payoff rings but defends a winnable irrelevant ring', function() {
        const makeState = (element) => stateFor({
            promptTitle: `Military ${element} Conflict: 5 vs 0`,
            menuTitle: 'Choose defenders',
            buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
            stats: { fate: 2 },
            cardPiles: {
                hand: [{ id: 'display-of-power', type: 'event' }],
                cardsInPlay: [{
                    id: 'kudaka', uuid: 'kudaka', type: 'character', bowed: false, inConflict: false,
                    militarySkillSummary: { stat: '6' }, politicalSkillSummary: { stat: '3' }
                }]
            }
        });

        const air = new JigokuBotPolicy('display-air').decide(makeState('Air'), 'Phoenix', { profile });
        expect(air.reason).toBe('display-of-power-unopposed');
        expect(air.args[0]).toBe('done');

        const fire = new JigokuBotPolicy('display-fire').decide(makeState('Fire'), 'Phoenix', { profile });
        expect(fire.command).toBe('cardClicked');
        expect(fire.args[0]).toBe('kudaka');

        expect(tactics.hasDisplayPlan({
            stats: { fate: 2 },
            cardPiles: { hand: [], conflictDiscardPile: [{ id: 'display-of-power' }] },
            strongholdProvince: [{ id: 'kyuden-isawa', bowed: false }]
        })).toBe(false);
    });

    it('uses the maximum Five Fires amount for the saved 1 plus 4 split', function() {
        // HandlerMenuPrompt does not expose gameAction metadata, so this is the
        // exact prompt shape the live controller sends to the policy.
        const amountState = (amounts) => stateFor({
            promptTitle: 'Consumed by Five Fires',
            menuTitle: 'How much fate do you want to remove?',
            buttons: [...amounts, 'Redo'].map((value) => ({ text: value, arg: value, uuid: value }))
        });
        const policies = [
            new FateAwareJigokuBotPolicy('1'),
            new JigokuBotPolicy('2'),
            new FateAwareJigokuBotPolicy('5')
        ];
        for(const policy of policies) {
            const tenguDecision = policy.decide(amountState(['1']), 'Phoenix');
            const legionDecision = policy.decide(amountState(['1', '2', '3', '4']), 'Phoenix');
            expect(tenguDecision.reason).toBe('five-fires-max-fate');
            expect(legionDecision.reason).toBe('five-fires-max-fate');
            expect(Number(tenguDecision.args[0]) + Number(legionDecision.args[0])).toBe(5);
        }
    });

    it('spends Five Fires on the largest live enemy fate stack', function() {
        const neutralized = {
            id: 'doji-challenger', uuid: 'neutralized', type: 'character', selectable: true, fate: 7,
            attachments: [{ id: 'pacifism' }]
        };
        const live = {
            id: 'doji-whisperer', uuid: 'live', type: 'character', selectable: true, fate: 5,
            militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '5' }
        };
        const state = stateFor({
            promptTitle: 'Consumed by Five Fires', menuTitle: 'Choose a character', buttons: [],
            cardPiles: { cardsInPlay: [] }
        }, { cardPiles: { cardsInPlay: [neutralized, live] } });
        const decision = new JigokuBotPolicy('five-fires-target').decide(state, 'Phoenix', {
            profile,
            targetHint: {
                sourceCardId: 'consumed-by-five-fires', sourceIsMine: true, gameActions: ['removeFate']
            }
        });
        expect(decision.reason).toBe('five-fires-enemy-tower');
        expect(decision.args[0]).toBe('live');
    });

    it('uses forced Ujina on an enemy, falling back to the weakest own legal target', function() {
        const own = { id: 'young-philosopher', uuid: 'own', type: 'character', selectable: true, cost: 2 };
        const enemy = { id: 'doji-challenger', uuid: 'enemy', type: 'character', selectable: true, cost: 4 };
        const hint = { sourceCardId: 'isawa-ujina', sourceIsMine: true, gameActions: ['removeFromGame'] };
        const withEnemy = stateFor({
            promptTitle: 'Isawa Ujina', menuTitle: 'Choose a character', buttons: [],
            cardPiles: { cardsInPlay: [own] }
        }, { cardPiles: { cardsInPlay: [enemy] } });
        expect(new JigokuBotPolicy('ujina-enemy').decide(withEnemy, 'Phoenix', { profile, targetHint: hint }).args[0]).toBe('enemy');

        const forcedOwn = stateFor({
            promptTitle: 'Isawa Ujina', menuTitle: 'Choose a character', buttons: [],
            cardPiles: { cardsInPlay: [own] }
        });
        const decision = new JigokuBotPolicy('ujina-own').decide(forcedOwn, 'Phoenix', { profile, targetHint: hint });
        expect(decision.reason).toBe('ujina-forced-own-weakest');
        expect(decision.args[0]).toBe('own');
    });
});
