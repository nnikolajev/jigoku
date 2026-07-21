const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
const BoardAwareJigokuBotPolicy = require('../../../build/server/game/bots/BoardAwareJigokuBotPolicy.js');
const { estimateHandThreat } = require('../../../build/server/game/bots/DeckAnalysis.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

describe('fate-aware Jigoku bot policy', function() {
    const playerName = 'Jigoku Bot';
    const passButton = { text: 'Pass', arg: 'pass', uuid: 'pass' };
    const fateButtons = [0, 1, 2, 3].map((amount) => ({
        text: String(amount), arg: String(amount), uuid: `fate-${amount}`
    }));

    const character = (uuid, extras = {}) => ({
        uuid, id: uuid, name: uuid, type: 'character', isDynasty: true,
        facedown: false, selectable: true, ...extras
    });

    function dynastyState(fate, provinceCards, board = []) {
        return {
            players: {
                [playerName]: {
                    name: playerName,
                    phase: 'dynasty',
                    promptTitle: 'Action Window',
                    menuTitle: 'Initiate an action',
                    buttons: [passButton],
                    stats: { fate },
                    provinces: { one: provinceCards, two: [], three: [], four: [] },
                    cardPiles: { hand: [], cardsInPlay: board }
                }
            }
        };
    }

    function additionalFateState(fate) {
        return {
            players: {
                [playerName]: {
                    name: playerName,
                    promptTitle: 'Deploy',
                    menuTitle: 'Choose additional fate',
                    buttons: fateButtons,
                    stats: { fate }
                }
            }
        };
    }

    function conflictState(airFate) {
        const ring = (element, fate = 0) => ({
            element, fate, conflictType: 'military', unselectable: false
        });
        return {
            players: {
                [playerName]: {
                    name: playerName,
                    promptTitle: 'Initiate Conflict',
                    menuTitle: 'Choose an elemental ring\n(click the ring again to change conflict type)',
                    buttons: [{ text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }],
                    cardPiles: {
                        cardsInPlay: [{
                            uuid: 'attacker', type: 'character', location: 'play area', bowed: false,
                            militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '0' }
                        }]
                    }
                },
                Human: { name: 'Human', cardPiles: { cardsInPlay: [] } }
            },
            rings: {
                air: ring('air', airFate),
                earth: ring('earth'),
                fire: ring('fire'),
                water: ring('water'),
                void: ring('void')
            }
        };
    }

    it('maps all three strategy seeds, shares adaptive mulligans, and injects omniscience independently', function() {
        const defaultBot = new JigokuBotController({}, { playerName }, () => true);
        const seedOne = new JigokuBotController({}, { playerName, seed: '1' }, () => true);
        const seedTwo = new JigokuBotController({}, { playerName, seed: 2 }, () => true);
        const seedThree = new JigokuBotController({}, { playerName, seed: '3' }, () => true);
        const omniscientSeedTwo = new JigokuBotController(
            {}, { playerName, seed: 2, omniscient: true }, () => true
        );
        const analysisOverride = new JigokuBotController({}, { playerName, seed: 2, policy: 'fate-aware' }, () => true);
        const adaptiveSeedOne = new JigokuBotController(
            {}, { playerName, seed: 1, mulliganPolicy: 'adaptive' }, () => true
        );
        const legacySeedThree = new JigokuBotController(
            {}, { playerName, seed: 3, mulliganPolicy: 'legacy' }, () => true
        );
        expect(defaultBot.policy.constructor.name).toBe('FateAwareJigokuBotPolicy');
        expect(seedOne.policy.constructor.name).toBe('FateAwareJigokuBotPolicy');
        expect(seedTwo.policy.constructor.name).toBe('JigokuBotPolicy');
        expect(seedThree.policy.constructor.name).toBe('BoardAwareJigokuBotPolicy');
        expect(omniscientSeedTwo.policy.constructor.name).toBe('JigokuBotPolicy');
        expect(omniscientSeedTwo.isOmniscient()).toBe(true);
        expect(seedTwo.isOmniscient()).toBe(false);
        expect(analysisOverride.policy.constructor.name).toBe('FateAwareJigokuBotPolicy');
        expect(seedOne.policy.mulliganPolicy).toBe('adaptive');
        expect(seedTwo.policy.mulliganPolicy).toBe('adaptive');
        expect(seedThree.policy.mulliganPolicy).toBe('adaptive');
        expect(adaptiveSeedOne.policy.mulliganPolicy).toBe('adaptive');
        expect(legacySeedThree.policy.mulliganPolicy).toBe('legacy');
    });

    it('seed 3 can play a safe conflict character at home for its remaining conflict', function() {
        const policy = new BoardAwareJigokuBotPolicy(3);
        const ambusher = {
            uuid: 'ambusher', id: 'ambusher', name: 'Ambusher', type: 'character',
            isConflict: true, isPlayableByMe: true, selectable: true
        };
        const province = {
            uuid: 'province', id: 'plain-province', type: 'province', isProvince: true,
            isBroken: false, facedown: false, strengthSummary: { stat: '3' }
        };
        const state = {
            players: {
                [playerName]: {
                    id: 'bot', name: playerName, phase: 'conflict',
                    promptTitle: 'Conflict Action Window', menuTitle: 'Initiate an action',
                    buttons: [passButton], stats: {
                        fate: 2, conflictsRemaining: 1, militaryRemaining: true, politicalRemaining: false
                    },
                    provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [],
                    cardPiles: { hand: [ambusher], cardsInPlay: [] }
                },
                Human: {
                    id: 'human', name: 'Human', stats: { fate: 0, conflictsRemaining: 1 },
                    provinces: { one: [province], two: [], three: [], four: [] }, strongholdProvince: [],
                    cardPiles: { hand: [], cardsInPlay: [] }
                }
            }
        };
        const decision = policy.decide(state, playerName, {
            profile: resolveDeckProfile([]),
            conflictCosts: { ambusher: 2 },
            handStats: { ambusher: { military: 4, political: 1 } }
        });

        expect(decision.reason).toBe('board-aware-play-home-conflict-character');
        expect(decision.target).toBe('Ambusher');

        const mode = policy.decide({
            players: {
                [playerName]: {
                    id: 'bot', name: playerName, phase: 'conflict', promptTitle: 'Ambusher',
                    menuTitle: 'Play Ambusher:', buttons: [
                        { text: 'Play Ambusher as an attachment', arg: 'attachment', uuid: 'attachment' },
                        { text: 'Play Ambusher', arg: 'character', uuid: 'character' }
                    ], stats: { fate: 2 }, cardPiles: { hand: [{ ...ambusher, selectable: false }], cardsInPlay: [] }
                },
                Human: { id: 'human', name: 'Human', stats: {}, cardPiles: { hand: [], cardsInPlay: [] } }
            }
        }, playerName, { profile: resolveDeckProfile([]), playCardId: 'ambusher' });
        expect(mode.reason).toBe('board-aware-play-at-home-as-character');
        expect(mode.target).toBe('Play Ambusher');
    });

    it('maps real hidden hand boosts and live face-down province strength for any enabled seed', function() {
        const hiddenAttachment = {
            id: 'unmodeled-war-banner',
            type: 'attachment',
            isConflict: true,
            cardData: { cost: '1', military_bonus: '+3', political_bonus: '+1' },
            getCost: () => 1
        };
        const hiddenCharacter = {
            id: 'unmodeled-ambusher',
            type: 'character',
            isConflict: true,
            cardData: { cost: '1' },
            getCost: () => 1,
            getMilitarySkill: () => 3,
            getPoliticalSkill: () => 1
        };
        const militaryEvent = {
            id: 'duel-to-the-death',
            type: 'event',
            isConflict: true,
            cardData: { cost: '1' },
            getCost: () => 1
        };
        const hiddenProvince = {
            id: 'hidden-fortress',
            name: 'Hidden Fortress',
            location: 'province 1',
            isProvince: true,
            isBroken: false,
            facedown: true,
            strengthSummary: {},
            getStrength: jasmine.createSpy('getStrength').and.returnValue(8),
            hasEminent: () => false,
            getProvinceAbilityClass: () => 'action'
        };
        const weakProvince = {
            id: 'hidden-garden',
            name: 'Hidden Garden',
            location: 'province 2',
            isProvince: true,
            isBroken: false,
            facedown: true,
            strengthSummary: {},
            getStrength: jasmine.createSpy('getStrength').and.returnValue(3)
        };
        const opponent = {
            name: 'Human',
            fate: 2,
            hand: { toArray: () => [hiddenAttachment, hiddenCharacter, militaryEvent] },
            getProvinces: () => [hiddenProvince, weakProvince],
            getDynastyCardsInProvince: (location) => location === 'province 1' ? [{
                id: 'hidden-tower', type: 'character', isDynasty: true,
                cardData: { cost: '5' }, getCost: () => 5,
                getMilitarySkill: () => 6, getPoliticalSkill: () => 3
            }, {
                id: 'hidden-holding', type: 'holding', isDynasty: true,
                cardData: { cost: '0' }, getCost: () => 0
            }] : []
        };
        const controller = new JigokuBotController({}, { playerName, seed: 2, omniscient: true }, () => true);
        const omniscient = controller.buildOmniscient({ opponent });

        expect(omniscient.oppHand[0]).toEqual(jasmine.objectContaining({
            id: 'unmodeled-war-banner',
            fate: 1,
            milBonus: 3,
            polBonus: 1
        }));
        expect(omniscient.oppHand[2]).toEqual(jasmine.objectContaining({
            id: 'duel-to-the-death',
            fate: 1,
            swing: 5,
            conflictTypes: []
        }));
        expect(estimateHandThreat(omniscient.oppHand, omniscient.oppFate, 'military').skill).toBe(8);
        expect(estimateHandThreat(omniscient.oppHand, omniscient.oppFate, 'political').skill).toBe(6);
        expect(omniscient.handThreatMatrix.military.map((plan) => plan.skill)).toEqual([0, 5, 8]);
        expect(omniscient.handThreatMatrix.political.map((plan) => plan.skill)).toEqual([0, 5, 6]);
        expect(omniscient.oppProvinces[0]).toEqual(jasmine.objectContaining({
            id: 'hidden-fortress',
            location: 'province 1',
            strength: 8,
            facedown: true,
            eminent: false,
            abilityClass: 'action',
            dynastyCardIds: ['hidden-tower', 'hidden-holding'],
            dynastyValue: 9.25
        }));
        expect(hiddenProvince.getStrength).toHaveBeenCalled();
        expect(weakProvince.getStrength).toHaveBeenCalled();

        const conflictState = (type) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: `${type} Air Conflict`,
                    menuTitle: 'Choose province to attack',
                    buttons: [],
                    cardPiles: { cardsInPlay: [{
                        uuid: 'balanced', type: 'character', bowed: false, inConflict: false,
                        militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '4' }
                    }] }
                },
                Human: {
                    name: 'Human',
                    cardPiles: { cardsInPlay: [] },
                    provinces: {
                        one: [{ facedown: true, location: 'province 1' }],
                        two: [{ facedown: true, location: 'province 2' }],
                        three: [], four: []
                    }
                }
            }
        });

        // The real +3 military hand boost makes political the safer axis.
        const omniscientDuelProfile = {
            ...resolveDeckProfile([], undefined),
            useOmniscientConflictAxis: true
        };
        const switchType = controller.policy.decide(conflictState('Military'), playerName, {
            omniscient,
            profile: omniscientDuelProfile
        });
        expect(switchType.reason).toBe('switch-conflict-type');

        // Once on that axis, the real strength values make province 2 the target.
        const attack = controller.policy.decide(conflictState('Political'), playerName, {
            omniscient,
            profile: omniscientDuelProfile
        });
        // Province 1 is much stronger, but breaking it also discards a hidden
        // 5-cost tower plus holding. Exact stack denial makes it best target.
        expect(attack.args).toEqual(['province 1', 'Human', true]);

        const oneAxisState = conflictState('Military');
        oneAxisState.players['Jigoku Bot'].promptTitle = 'Military Fire Conflict';
        oneAxisState.players['Jigoku Bot'].cardPiles.cardsInPlay[0].politicalSkillSummary.stat = '0';
        const oneAxisAttack = controller.policy.decide(oneAxisState, playerName, {
            omniscient,
            profile: omniscientDuelProfile
        });
        expect(oneAxisAttack.reason).not.toBe('switch-conflict-type');
    });

    it('detects affordable hidden-hand defender control and exact own stronghold strength', function() {
        const bowEvent = {
            id: 'nested-bow-event', type: 'event', isConflict: true,
            cardData: { cost: '1', text: 'Choose an opponent character - bow that character.' },
            getCost: () => 1,
            abilities: {
                actions: [{
                    targets: [{ properties: { controller: 'opponent' } }],
                    properties: {
                        targets: {
                            choice: { choices: { 'Bow it': { name: 'bow' } } }
                        }
                    }
                }],
                reactions: [], playActions: []
            }
        };
        const ownOnlyBow = {
            id: 'own-bow-cost', type: 'event', isConflict: true,
            cardData: { cost: '0', text: 'Bow a character you control.' },
            getCost: () => 0,
            abilities: { actions: [], reactions: [], playActions: [] }
        };
        const controller = new JigokuBotController({}, { playerName, seed: 3, omniscient: true }, () => true);
        expect(controller.knownCard(bowEvent).canDisableDefender).toBe(true);
        expect(controller.knownCard(bowEvent).canBowOpponent).toBe(true);
        expect(controller.knownCard(ownOnlyBow).canDisableDefender).toBe(false);
        expect(controller.knownCard(ownOnlyBow).canBowOpponent).toBe(false);

        const sendHomeEvent = {
            id: 'send-home-event', type: 'event', isConflict: true,
            cardData: { cost: '0', text: 'Send an opponent character home.' },
            getCost: () => 0,
            abilities: {
                actions: [{
                    targets: [{ properties: { controller: 'opponent' } }],
                    properties: { gameAction: { name: 'sendHome' } }
                }],
                reactions: [], playActions: []
            }
        };
        expect(controller.knownCard(sendHomeEvent).canDisableDefender).toBe(true);
        expect(controller.knownCard(sendHomeEvent).canBowOpponent).toBe(false);

        const bowingParticipant = {
            ...bowEvent, type: 'character', inConflict: true, bowed: false,
            attachments: []
        };
        expect(controller.opponentParticipantCanBow({
            opponent: { cardsInPlay: { toArray: () => [bowingParticipant] } }
        })).toBe(true);
        bowingParticipant.inConflict = false;
        expect(controller.opponentParticipantCanBow({
            opponent: { cardsInPlay: { toArray: () => [bowingParticipant] } }
        })).toBe(false);

        const secondBowEvent = {
            ...bowEvent,
            id: 'second-bow-event'
        };
        const expensiveBowEvent = {
            ...bowEvent,
            id: 'expensive-bow-event',
            cardData: { ...bowEvent.cardData, cost: '3' },
            getCost: () => 3
        };
        const opponent = {
            name: 'Human', fate: 2,
            hand: { toArray: () => [bowEvent, secondBowEvent, expensiveBowEvent] },
            getProvinces: () => []
        };
        expect(controller.buildOmniscient({ opponent }).affordableDefenderDisables).toBe(2);

        const liveStrongholdProvince = {
            isProvince: true, location: 'stronghold province', facedown: true,
            strengthSummary: {}, getStrength: () => 9
        };
        expect(controller.strongholdProvinceStrength({
            getProvinces: () => [liveStrongholdProvince]
        })).toBe(9);
        expect(controller.weakestOuterProvinceStrength({
            getProvinces: () => [
                { isProvince: true, location: 'province 1', isBroken: false, getStrength: () => 6 },
                { isProvince: true, location: 'province 2', isBroken: false, getStrength: () => 4 },
                { isProvince: true, location: 'province 3', isBroken: true, getStrength: () => 1 },
                liveStrongholdProvince
            ]
        })).toBe(4);
    });

    it('allows an explicit generic policy override for paired analysis', function() {
        const generic = new JigokuBotController({}, { playerName, seed: 1, policy: 'generic' }, () => true);
        const fateAware = new JigokuBotController({}, { playerName, seed: 2, policy: 'fate-aware' }, () => true);
        expect(generic.policy.constructor.name).toBe('JigokuBotPolicy');
        expect(fateAware.policy.constructor.name).toBe('FateAwareJigokuBotPolicy');
    });

    it('reads costs for every face-up card in stacked provinces and can choose any character in the stack', function() {
        const liveCard = (uuid, cost, faceup = true) => ({
            uuid,
            cardData: { cost: String(cost) },
            isFaceup: () => faceup
        });
        const stacks = {
            one: [liveCard('cheap', 2), liveCard('holding', 1), liveCard('strong', 5)],
            two: [liveCard('hidden', 6, false)]
        };
        const game = { getProvinceArray: () => ['one', 'two'] };
        const player = {
            getDynastyCardsInProvince: jasmine.createSpy('getDynastyCardsInProvince')
                .and.callFake((location) => stacks[location])
        };
        const controller = new JigokuBotController(game, { playerName, seed: 1 }, () => true);
        const costs = controller.dynastyCostsHint(player);

        expect(costs).toEqual({ cheap: 2, holding: 1, strong: 5 });
        expect(player.getDynastyCardsInProvince.calls.allArgs()).toEqual([['one'], ['two']]);

        const holding = {
            uuid: 'holding', id: 'holding', name: 'holding', type: 'holding',
            isDynasty: true, facedown: false, selectable: true
        };
        const policy = new FateAwareJigokuBotPolicy('stacked-province');
        const buy = policy.decide(
            dynastyState(7, [character('cheap'), holding, character('strong')]),
            playerName,
            { roundNumber: 1, dynastyCosts: costs }
        );
        expect(buy.reason).toBe('fate-aware-play-strong-character');
        expect(buy.args[0]).toBe('strong');
    });

    it('reads exact seed-3 stats and honored-on-entry state from every stacked character', function() {
        const liveCharacter = (uuid, cost, military, political, glory, honored) => ({
            uuid,
            type: 'character',
            printedCost: cost,
            cardData: {
                cost: String(cost), military: String(military),
                political: String(political), glory: String(glory),
                text: 'Reaction: After this character enters play, draw 1 card.'
            },
            abilities: { reactions: [{}] },
            getType: () => 'character',
            getEffects: () => honored ? ['honored'] : [],
            isFaceup: () => true
        });
        const game = { getProvinceArray: () => ['one'] };
        const player = {
            getDynastyCardsInProvince: () => [
                liveCharacter('tsuma-body', 2, 2, 3, 2, true),
                liveCharacter('plain-body', 5, 6, 1, 1, false)
            ]
        };
        const controller = new JigokuBotController(game, { playerName, seed: 3 }, () => true);

        expect(controller.dynastyCharacterInfo(player)).toEqual({
            'tsuma-body': jasmine.objectContaining({
                cost: 2, military: 2, political: 3, glory: 2,
                honoredOnEntry: true
            }),
            'plain-body': jasmine.objectContaining({
                cost: 5, military: 6, political: 1, glory: 1,
                honoredOnEntry: false
            })
        });
    });

    it('reads UUID-specific printed costs from hand and conflict discard', function() {
        const controller = new JigokuBotController({}, { playerName, seed: 1 }, () => true);
        const costs = controller.conflictCostsHint({
            hand: [
                { uuid: 'free', printedCost: 0, cardData: { cost: '9' } },
                { uuid: 'paid', cardData: { cost: '2' } }
            ],
            conflictDiscardPile: [
                { uuid: 'discard-paid', printedCost: 3, cardData: { cost: '8' } },
                { uuid: 'invalid', cardData: { cost: 'X' } }
            ],
            opponent: {
                conflictDiscardPile: [
                    { uuid: 'opponent-paid', printedCost: 1, cardData: { cost: '7' } }
                ]
            }
        });

        expect(costs).toEqual({ free: 0, paid: 2, 'discard-paid': 3, 'opponent-paid': 1 });
    });

    it('reads UUID-specific printed skill from hand and conflict discard', function() {
        const controller = new JigokuBotController({}, { playerName, seed: 1 }, () => true);
        const stats = controller.handStatsHint({
            hand: [{
                uuid: 'hand-attachment',
                cardData: { military_bonus: '2', political_bonus: '0' },
                getType: () => 'attachment'
            }],
            conflictDiscardPile: [{
                uuid: 'discard-attachment',
                cardData: { military_bonus: '0', political_bonus: '3' },
                getType: () => 'attachment'
            }],
            opponent: {
                conflictDiscardPile: [{
                    uuid: 'opponent-attachment',
                    cardData: { military_bonus: '-1', political_bonus: '-2' },
                    getType: () => 'attachment'
                }]
            }
        });

        expect(stats).toEqual({
            'hand-attachment': { military: 2, political: 0 },
            'discard-attachment': { military: 0, political: 3 },
            'opponent-attachment': { military: -1, political: -2 }
        });
    });

    it('buys one visible strong character, funds it, then passes', function() {
        const policy = new FateAwareJigokuBotPolicy('strong-opening');
        const strong = character('strong');
        const cheap = character('cheap');

        const buy = policy.decide(
            dynastyState(7, [cheap, strong]),
            playerName,
            { roundNumber: 1, dynastyCosts: { cheap: 2, strong: 5 } }
        );
        expect(buy.reason).toBe('fate-aware-play-strong-character');
        expect(buy.args[0]).toBe('strong');

        const fund = policy.decide(additionalFateState(7), playerName, { roundNumber: 1, playCost: 5 });
        expect(fund.target).toBe('2');

        const pass = policy.decide(
            dynastyState(0, [cheap]),
            playerName,
            { roundNumber: 1, dynastyCosts: { cheap: 2 } }
        );
        expect(pass.reason).toBe('fate-aware-pass-after-strong-character');
    });

    it('caps strong-character fate at three early and two from round three', function() {
        const early = new FateAwareJigokuBotPolicy('strong-early');
        early.decide(dynastyState(10, [character('six')]), playerName, {
            roundNumber: 2, dynastyCosts: { six: 6 }
        });
        expect(early.decide(additionalFateState(10), playerName, {
            roundNumber: 2, playCost: 6
        }).target).toBe('3');

        const late = new FateAwareJigokuBotPolicy('strong-late');
        late.decide(dynastyState(10, [character('six')]), playerName, {
            roundNumber: 3, dynastyCosts: { six: 6 }
        });
        expect(late.decide(additionalFateState(10), playerName, {
            roundNumber: 3, playCost: 6
        }).target).toBe('2');
    });

    it('spends at most six on cheap openings and tightens later with two persistent characters', function() {
        const opening = new FateAwareJigokuBotPolicy('cheap-opening');
        const three = character('three');
        const two = character('two');
        const one = character('one');
        expect(opening.decide(dynastyState(7, [three, two]), playerName, {
            roundNumber: 1, dynastyCosts: { three: 3, two: 2 }
        }).args[0]).toBe('three');
        expect(opening.decide(additionalFateState(7), playerName, {
            roundNumber: 1, playCost: 3
        }).target).toBe('1');
        expect(opening.decide(dynastyState(3, [two]), playerName, {
            roundNumber: 1, dynastyCosts: { two: 2 }
        }).args[0]).toBe('two');
        expect(opening.decide(additionalFateState(3), playerName, {
            roundNumber: 1, playCost: 2
        }).target).toBe('0');
        expect(opening.decide(dynastyState(1, [one]), playerName, {
            roundNumber: 1, dynastyCosts: { one: 1 }
        }).reason).toBe('fate-aware-preserve-fate');

        const persistent = [character('old-a', { fate: 1 }), character('old-b', { fate: 2 })];
        const late = new FateAwareJigokuBotPolicy('cheap-late');
        late.decide(dynastyState(10, [three], persistent), playerName, {
            roundNumber: 4, dynastyCosts: { three: 3 }
        });
        expect(late.decide(additionalFateState(10), playerName, {
            roundNumber: 4, playCost: 3
        }).target).toBe('0');
        expect(late.decide(dynastyState(7, [one], persistent), playerName, {
            roundNumber: 4, dynastyCosts: { one: 1 }
        }).reason).toBe('fate-aware-preserve-fate');
    });

    it('allows Lion economy knobs to inject a durable-plus-bodies swarm budget independently of its buyer', function() {
        const resolvedLionProfile = resolveDeckProfile(
            ['hayaken-no-shiro', 'ashigaru-levy', 'for-greater-glory'],
            { holdingEngine: false, defensive: false, aggressive: true, dishonor: false }
        );
        const lionProfile = {
            ...resolvedLionProfile,
            fateAwareEconomy: {
                ...resolvedLionProfile.fateAwareEconomy,
                preferDeckCharacters: false,
                preferDeckAdditionalFate: false,
                deferPassForDynastyActions: false,
                prioritizeBodies: false
            }
        };
        const policy = new FateAwareJigokuBotPolicy('lion-profile-economy');
        const one = character('ashigaru-levy');
        const two = character('matsu-berserker');
        const three = character('matsu-beiona');
        const tower = character('akodo-toturi');
        const spare = character('akodo-gunso');
        const costs = {
            'ashigaru-levy': 1,
            'matsu-berserker': 2,
            'matsu-beiona': 3,
            'akodo-toturi': 5,
            'akodo-gunso': 1
        };
        const context = { roundNumber: 1, dynastyCosts: costs, profile: lionProfile };

        expect(policy.decide(dynastyState(7, [three, two, one]), playerName, context).args[0])
            .toBe('ashigaru-levy');
        expect(policy.decide(additionalFateState(6), playerName, {
            roundNumber: 1, playCost: 1, profile: lionProfile
        }).target).toBe('0');

        expect(policy.decide(dynastyState(6, [three, two]), playerName, context).args[0])
            .toBe('matsu-berserker');
        policy.decide(additionalFateState(4), playerName, {
            roundNumber: 1, playCost: 2, profile: lionProfile
        });

        expect(policy.decide(dynastyState(4, [three]), playerName, context).args[0])
            .toBe('matsu-beiona');
        expect(policy.decide(additionalFateState(1), playerName, {
            roundNumber: 1, playCost: 3, profile: lionProfile
        }).target).toBe('0');

        expect(policy.decide(dynastyState(1, [spare]), playerName, context).reason)
            .toBe('fate-aware-preserve-fate');

        const rich = new FateAwareJigokuBotPolicy('lion-rich-economy');
        const lateContext = { roundNumber: 3, dynastyCosts: costs, profile: lionProfile };
        expect(rich.decide(dynastyState(10, [tower, two]), playerName, lateContext).args[0])
            .toBe('akodo-toturi');
        expect(rich.decide(additionalFateState(5), playerName, {
            roundNumber: 3, playCost: 5, profile: lionProfile
        }).target).toBe('2');
        expect(rich.decide(dynastyState(3, [two]), playerName, lateContext).args[0])
            .toBe('matsu-berserker');
        rich.decide(additionalFateState(1), playerName, {
            roundNumber: 3, playCost: 2, profile: lionProfile
        });
        expect(rich.decide(dynastyState(1, [spare]), playerName, lateContext).reason)
            .toBe('fate-aware-preserve-fate');
    });

    it('prioritizes a ring with one fate without changing generic ring logic', function() {
        expect(new JigokuBotPolicy('generic-ring').decide(conflictState(1), playerName).args[0]).toBe('earth');
        expect(new FateAwareJigokuBotPolicy('fate-ring').decide(conflictState(1), playerName).args[0]).toBe('air');
    });
});
