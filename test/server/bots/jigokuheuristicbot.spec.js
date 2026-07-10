const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const LmStudioClient = require('../../../build/server/game/bots/llm/LmStudioClient.js').default;
const DeckHintService = require('../../../build/server/game/bots/llm/DeckHintService.js').default;
const LlmActionPlanner = require('../../../build/server/game/bots/llm/LlmActionPlanner.js').default;
const { validateCardHint } = require('../../../build/server/game/bots/llm/CardHints.js');
const { getPlaybookEntry, deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');

describe('Jigoku heuristic bot', function() {
    function makePlayer(prompt, selectableCards = [], selectableRings = []) {
        return {
            name: 'Jigoku Bot',
            left: false,
            disconnected: false,
            promptState: {
                selectableCards: selectableCards,
                selectableRings: selectableRings
            },
            currentPrompt: () => prompt
        };
    }

    function makeGame(player, state) {
        return {
            getPlayerByName: () => player,
            getState: () => state,
            stopNonChessClocks: jasmine.createSpy('stopNonChessClocks'),
            continue: jasmine.createSpy('continue')
        };
    }

    it('rejects illegal menu commands before calling the game runner', function() {
        const prompt = {
            promptTitle: 'Test Prompt',
            menuTitle: 'Choose',
            buttons: [{ text: 'Done', arg: 'done', uuid: 'legal', command: 'menuButton' }]
        };
        const player = makePlayer(prompt);
        const runner = jasmine.createSpy('runner').and.returnValue(true);
        const controller = new JigokuBotController(makeGame(player, {}), { playerName: player.name, seed: 'x' }, runner);

        const accepted = controller.executeDecision({
            command: 'menuButton',
            args: ['done', 'wrong-uuid', undefined],
            target: 'Done',
            reason: 'test'
        });

        expect(accepted).toBe(false);
        expect(runner).not.toHaveBeenCalled();
        expect(controller.trace[0].result).toBe('rejected');
    });

    it('produces the same ordered decisions for the same seed and state', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    promptTitle: 'Choose Ring',
                    menuTitle: 'Choose a ring',
                    selectRing: true,
                    buttons: []
                }
            },
            rings: {
                air: { element: 'air', unselectable: false },
                earth: { element: 'earth', unselectable: false },
                fire: { element: 'fire', unselectable: false }
            }
        };
        const first = new JigokuBotPolicy('same-seed');
        const second = new JigokuBotPolicy('same-seed');

        expect(first.decide(state)).toEqual(second.decide(state));
        expect(first.decide(state)).toEqual(second.decide(state));
    });

    it('handles button, card, and ring prompt primitives', function() {
        const buttonPrompt = {
            promptTitle: 'Honor Bid',
            menuTitle: 'Choose a bid',
            buttons: [{ text: '1', arg: '1', uuid: 'bid', command: 'menuButton' }]
        };
        const card = { uuid: 'card-1', name: 'Target', selectable: true, type: 'character' };
        const cardPromptState = {
            players: { 'Jigoku Bot': { promptTitle: 'Target', menuTitle: 'Choose target', selectCard: true, buttons: [] } },
            cards: [card]
        };
        const ringPromptState = {
            players: { 'Jigoku Bot': { promptTitle: 'Ring', menuTitle: 'Choose ring', selectRing: true, buttons: [] } },
            rings: { air: { element: 'air', unselectable: false } }
        };
        const policy = new JigokuBotPolicy('coverage');

        expect(policy.decide({ players: { 'Jigoku Bot': buttonPrompt } }).command).toBe('menuButton');
        expect(policy.decide(cardPromptState).command).toBe('cardClicked');
        expect(policy.decide(ringPromptState).command).toBe('ringClicked');
    });

    it('scores generic ring prompts instead of picking at random', function() {
        // A card ability asking for a ring gets the same value ordering as
        // conflict declaration: earth over air.
        const state = {
            players: {
                'Jigoku Bot': { name: 'Jigoku Bot', promptTitle: 'Ring', menuTitle: 'Choose a ring', selectRing: true, buttons: [] }
            },
            rings: {
                air: { element: 'air', unselectable: false },
                earth: { element: 'earth', unselectable: false }
            }
        };
        const policy = new JigokuBotPolicy('ring-generic');
        expect(policy.decide(state, 'Jigoku Bot').args[0]).toBe('earth');
    });

    it('validates card menu items from player-perspective state', function() {
        const prompt = {
            promptTitle: 'Menu',
            menuTitle: 'Menu',
            buttons: []
        };
        const player = makePlayer(prompt);
        const game = makeGame(player, {
            cards: [{
                uuid: 'card-menu',
                type: 'character',
                menu: [{ command: 'click', text: 'Select Card' }]
            }]
        });
        const runner = jasmine.createSpy('runner').and.returnValue(true);
        const controller = new JigokuBotController(game, { playerName: player.name, seed: 'x' }, runner);

        expect(controller.executeDecision({
            command: 'menuItemClick',
            args: ['card-menu', { command: 'click', text: 'Select Card' }],
            target: 'Select Card',
            reason: 'menu-test'
        })).toBe(true);
        expect(runner).toHaveBeenCalled();
    });


    it('traces unsupported prompts without advancing silently', function() {
        const prompt = { promptTitle: 'Unknown', menuTitle: 'Choose somehow', selectCard: true, buttons: [] };
        const player = makePlayer(prompt);
        const game = makeGame(player, { players: { 'Jigoku Bot': prompt } });
        const runner = jasmine.createSpy('runner').and.returnValue(true);
        const controller = new JigokuBotController(game, { playerName: player.name, seed: 'x' }, runner);

        controller.tick();

        expect(runner).not.toHaveBeenCalled();
        expect(game.continue).not.toHaveBeenCalled();
    });

    const bidButtons = ['1', '2', '3', '4', '5'].map((num) => ({ text: num, arg: num, uuid: 'bid-' + num }));

    function makeBidState(handSize, honor, opponent) {
        const players = {
            'Jigoku Bot': {
                name: 'Jigoku Bot',
                promptTitle: 'Honor Bid',
                menuTitle: 'Choose a bid',
                buttons: bidButtons,
                stats: { honor: honor },
                cardPiles: { hand: new Array(handSize).fill({}) }
            }
        };
        if(opponent) {
            players['Human'] = {
                name: 'Human',
                stats: { honor: opponent.honor },
                cardPiles: { hand: new Array(opponent.handSize).fill({}) }
            };
        }
        return { players: players };
    }

    it('bids high with an empty hand and low with a full hand', function() {
        const policy = new JigokuBotPolicy('bid');
        expect(policy.decide(makeBidState(0, 10), 'Jigoku Bot').target).toBe('5');
        expect(policy.decide(makeBidState(4, 10), 'Jigoku Bot').target).toBe('3');
        expect(policy.decide(makeBidState(7, 10), 'Jigoku Bot').target).toBe('1');
        expect(policy.decide(makeBidState(0, 2), 'Jigoku Bot').target).toBe('1');
    });

    it('always bids 5 on the first round', function() {
        const policy = new JigokuBotPolicy('bid-r1');
        const decision = policy.decide(
            makeBidState(5, 10, { handSize: 5, honor: 10 }),
            'Jigoku Bot',
            { roundNumber: 1 }
        );
        expect(decision.target).toBe('5');
    });

    it('weighs its bid against the predicted opponent bid', function() {
        const policy = new JigokuBotPolicy('bid-matrix');

        // Low honor: opponent with a full hand will bid low, so do not bid
        // above them and bleed honor.
        expect(policy.decide(
            makeBidState(2, 5, { handSize: 7, honor: 10 }),
            'Jigoku Bot',
            { roundNumber: 3 }
        ).target).toBe('1');

        // Opponent near the honor victory: stay at or below their predicted
        // bid even when hungry for cards.
        expect(policy.decide(
            makeBidState(0, 10, { handSize: 6, honor: 18 }),
            'Jigoku Bot',
            { roundNumber: 3 }
        ).target).toBe('2');

        // High honor but behind on cards: honor is there to spend — buy the
        // whole gap back even at 18 honor.
        expect(policy.decide(
            makeBidState(0, 18, { handSize: 4, honor: 10 }),
            'Jigoku Bot',
            { roundNumber: 3 }
        ).target).toBe('5');

        // At 20+ honor the 25-honor win is the plan: bid under the predicted
        // opponent bid to farm the difference.
        expect(policy.decide(
            makeBidState(0, 20, { handSize: 4, honor: 10 }),
            'Jigoku Bot',
            { roundNumber: 3 }
        ).target).toBe('2');
    });

    it('spends spare honor to close a hand-size deficit', function() {
        const policy = new JigokuBotPolicy('bid-deficit');

        // 8 cards vs 13, 16 honor vs 4: the opponent is 5 cards ahead and the
        // bot has plenty of honor to spend — bid 5, not 1.
        expect(policy.decide(
            makeBidState(8, 16, { handSize: 13, honor: 4 }),
            'Jigoku Bot',
            { roundNumber: 4 }
        ).target).toBe('5');

        // Equal full hands, healthy honor: still worth 3 — cards beat honor.
        expect(policy.decide(
            makeBidState(7, 10, { handSize: 7, honor: 10 }),
            'Jigoku Bot',
            { roundNumber: 4 }
        ).target).toBe('3');

        // Ahead on cards with a full hand: conserve honor.
        expect(policy.decide(
            makeBidState(8, 10, { handSize: 5, honor: 10 }),
            'Jigoku Bot',
            { roundNumber: 4 }
        ).target).toBe('1');

        // Honor floor: 7 honor cannot afford a 5-bid against a predicted low
        // bidder — shrink until the worst case keeps 6 honor.
        expect(policy.decide(
            makeBidState(2, 7, { handSize: 9, honor: 10 }),
            'Jigoku Bot',
            { roundNumber: 4 }
        ).target).toBe('2');
    });

    it('reads its own prompt instead of the opponent waiting prompt', function() {
        const state = {
            players: {
                'Human': {
                    name: 'Human',
                    promptTitle: 'Action Window',
                    menuTitle: 'Initiate an action',
                    buttons: [{ text: 'Pass', arg: 'pass', uuid: 'human-pass' }]
                },
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    menuTitle: 'Waiting for opponent to take an action or pass',
                    buttons: []
                }
            }
        };
        const policy = new JigokuBotPolicy('own-prompt');

        expect(policy.decide(state, 'Jigoku Bot')).toBe(null);
    });

    it('declares strong attackers and initiates the conflict', function() {
        const character = (uuid, mil, bowed = false, inConflict = false) => ({
            uuid: uuid,
            name: uuid,
            type: 'character',
            location: 'play area',
            bowed: bowed,
            inConflict: inConflict,
            militarySkillSummary: { stat: String(mil) },
            politicalSkillSummary: { stat: '0' }
        });
        const makeState = (cardsInPlay, menuTitle, buttons) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Military Air Conflict',
                    menuTitle: menuTitle,
                    buttons: buttons,
                    cardPiles: { cardsInPlay: cardsInPlay }
                }
            }
        });

        const policy = new JigokuBotPolicy('attack');
        const pick = policy.decide(makeState(
            [character('weak', 1), character('strong', 4)],
            'Choose attackers',
            []
        ), 'Jigoku Bot');
        expect(pick.command).toBe('cardClicked');
        expect(pick.args[0]).toBe('strong');

        const initiate = policy.decide(makeState(
            [character('weak', 1), character('strong', 4, false, true)],
            'Military skill: 4',
            [{ text: 'Initiate Conflict', arg: 'done', uuid: 'init' }]
        ), 'Jigoku Bot');
        expect(initiate.command).toBe('menuButton');
        expect(initiate.target).toBe('Initiate Conflict');
    });

    it('commits enough attackers to break through the expected defense', function() {
        const character = (uuid, mil, inConflict = false) => ({
            uuid: uuid,
            name: uuid,
            type: 'character',
            location: 'play area',
            bowed: false,
            inConflict: inConflict,
            militarySkillSummary: { stat: String(mil) },
            politicalSkillSummary: { stat: '0' }
        });
        // Province strength 4 plus a ready 1-skill defender: 4 committed
        // skill cannot break, so the weakest attacker joins instead of
        // staying home.
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Military Air Conflict',
                    menuTitle: 'Choose attackers',
                    buttons: [],
                    cardPiles: { cardsInPlay: [character('weak', 1), character('strong', 4, true)] }
                },
                'Human': {
                    name: 'Human',
                    cardPiles: { cardsInPlay: [character('sentry', 1)] },
                    provinces: {
                        one: [{ isProvince: true, inConflict: true, uuid: 'prov', strengthSummary: { stat: '4' } }],
                        two: [], three: [], four: []
                    }
                }
            }
        };

        const policy = new JigokuBotPolicy('attack-break');
        const pick = policy.decide(state, 'Jigoku Bot');
        expect(pick.command).toBe('cardClicked');
        expect(pick.args[0]).toBe('weak');
    });

    it('passes the conflict when no ready character can attack', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Initiate Conflict',
                    menuTitle: 'Choose an elemental ring\n(click the ring again to change conflict type)',
                    buttons: [{ text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }],
                    cardPiles: { cardsInPlay: [] }
                }
            },
            rings: { air: { element: 'air', conflictType: 'military', unselectable: false } }
        };
        const policy = new JigokuBotPolicy('pass');

        const decision = policy.decide(state, 'Jigoku Bot');
        expect(decision.command).toBe('menuButton');
        expect(decision.target).toBe('Pass Conflict');
    });

    it('picks conflict rings by value: fate piles, then void/earth/fire', function() {
        const makeRingState = (rings, opponentCards) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Initiate Conflict',
                    menuTitle: 'Choose an elemental ring\n(click the ring again to change conflict type)',
                    buttons: [{ text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }],
                    cardPiles: {
                        cardsInPlay: [{
                            uuid: 'attacker', name: 'attacker', type: 'character', location: 'play area',
                            bowed: false, inConflict: false,
                            militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '0' }
                        }]
                    }
                },
                'Human': {
                    name: 'Human',
                    cardPiles: { cardsInPlay: opponentCards || [] }
                }
            },
            rings: rings
        });
        const ring = (element, fate = 0) => ({ element: element, conflictType: 'military', unselectable: false, fate: fate });
        const allRings = (overrides = {}) => Object.assign({
            air: ring('air'), earth: ring('earth'), fire: ring('fire'), water: ring('water'), void: ring('void')
        }, overrides);
        const fatCharacter = { uuid: 'fat', name: 'fat', type: 'character', location: 'play area', fate: 2 };

        // No fate anywhere, opponent has no fate on characters: earth (card
        // advantage) beats a useless void.
        const earthPick = new JigokuBotPolicy('ring-earth');
        expect(earthPick.decide(makeRingState(allRings()), 'Jigoku Bot').args[0]).toBe('earth');

        // Opponent has a character with fate: void becomes the top ring.
        const voidPick = new JigokuBotPolicy('ring-void');
        expect(voidPick.decide(makeRingState(allRings(), [fatCharacter]), 'Jigoku Bot').args[0]).toBe('void');

        // A ring with 2+ fate on it is a fate boost worth taking over any
        // effect; the biggest pile wins.
        const fatePick = new JigokuBotPolicy('ring-fate');
        expect(fatePick.decide(
            makeRingState(allRings({ air: ring('air', 3), water: ring('water', 2) }), [fatCharacter]),
            'Jigoku Bot'
        ).args[0]).toBe('air');

        // Water beats fire when the opponent has multiple ready no-fate
        // characters to bow (earth/void claimed, opponent characters are
        // fate-less so void is dead anyway).
        const readyEnemy = (uuid) => ({ uuid: uuid, name: uuid, type: 'character', location: 'play area', bowed: false, fate: 0 });
        const claimed = { earth: Object.assign(ring('earth'), { claimed: true }), void: Object.assign(ring('void'), { claimed: true }) };
        const waterPick = new JigokuBotPolicy('ring-water');
        expect(waterPick.decide(
            makeRingState(allRings(claimed), [readyEnemy('e1'), readyEnemy('e2')]),
            'Jigoku Bot'
        ).args[0]).toBe('water');

        // Nothing worth bowing: fire wins over a dead water.
        const firePick = new JigokuBotPolicy('ring-fire');
        expect(firePick.decide(
            makeRingState(allRings(claimed), [Object.assign(readyEnemy('e1'), { bowed: true })]),
            'Jigoku Bot'
        ).args[0]).toBe('fire');
    });

    describe('ring effect resolution', function() {
        const character = (uuid, extra = {}) => Object.assign({
            uuid: uuid, name: uuid, type: 'character', location: 'play area',
            selectable: true, bowed: false, inConflict: false, fate: 0,
            militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '0' }
        }, extra);

        function makeRingResolutionState(menuTitle, myCards, theirCards, buttons, stats) {
            return {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Void Ring',
                        menuTitle: menuTitle,
                        selectCard: true,
                        buttons: buttons || [],
                        stats: stats || {},
                        cardPiles: { cardsInPlay: myCards }
                    },
                    'Human': { name: 'Human', cardPiles: { cardsInPlay: theirCards } }
                }
            };
        }
        const dontResolve = { text: 'Don\'t resolve', arg: 'dontResolve', uuid: 'skip' };

        it('void ring strips fate from the opponent, never its own character', function() {
            const policy = new JigokuBotPolicy('void-enemy');
            const decision = policy.decide(makeRingResolutionState(
                'Choose character to remove fate from',
                [character('own-fat', { fate: 3 })],
                [character('enemy-1', { fate: 1 }), character('enemy-2', { fate: 2 })],
                [dontResolve]
            ), 'Jigoku Bot');
            expect(decision.args[0]).toBe('enemy-2');

            // Only own characters legal: skip the ring instead of self-harm.
            const skip = new JigokuBotPolicy('void-skip');
            expect(skip.decide(makeRingResolutionState(
                'Choose character to remove fate from',
                [character('own-fat', { fate: 3 })],
                [],
                [dontResolve]
            ), 'Jigoku Bot').target).toBe('Don\'t resolve');
        });

        it('fire ring honors own character, then the menu confirms it', function() {
            const policy = new JigokuBotPolicy('fire-own');
            const decision = policy.decide(makeRingResolutionState(
                'Choose character to honor or dishonor',
                [character('own-hero')],
                [character('enemy-6', { militarySkillSummary: { stat: '6' } })],
                [dontResolve]
            ), 'Jigoku Bot');
            expect(decision.args[0]).toBe('own-hero');

            const menuState = makeRingResolutionState('', [character('own-hero')], [], [
                { text: 'Honor own-hero', arg: 0, uuid: 'honor' },
                { text: 'Dishonor own-hero', arg: 1, uuid: 'dishonor' },
                { text: 'Back', arg: 2, uuid: 'back' }
            ]);
            expect(policy.decide(menuState, 'Jigoku Bot').target).toBe('Honor own-hero');
        });

        it('water ring bows the enemy or readies its own only when conflicts remain', function() {
            const policy = new JigokuBotPolicy('water-bow');
            expect(policy.decide(makeRingResolutionState(
                'Choose character to bow or unbow',
                [character('own-bowed', { bowed: true })],
                [character('enemy-ready')],
                [dontResolve]
            ), 'Jigoku Bot').args[0]).toBe('enemy-ready');

            // Own bowed character, no conflicts left: skip.
            const noConflicts = new JigokuBotPolicy('water-skip');
            expect(noConflicts.decide(makeRingResolutionState(
                'Choose character to bow or unbow',
                [character('own-bowed', { bowed: true })],
                [],
                [dontResolve],
                { conflictsRemaining: 0 }
            ), 'Jigoku Bot').target).toBe('Don\'t resolve');

            // Conflicts remaining: ready the bowed character.
            const readyUp = new JigokuBotPolicy('water-ready');
            expect(readyUp.decide(makeRingResolutionState(
                'Choose character to bow or unbow',
                [character('own-bowed', { bowed: true })],
                [],
                [dontResolve],
                { conflictsRemaining: 1 }
            ), 'Jigoku Bot').args[0]).toBe('own-bowed');
        });

        it('air ring takes honor from an opponent near a win or loss, else gains 2', function() {
            const airButtons = [
                { text: 'Gain 2 Honor', arg: 0, uuid: 'gain' },
                { text: 'Take 1 Honor from opponent', arg: 1, uuid: 'take' }
            ];
            const makeAirState = (opponentHonor) => ({
                players: {
                    'Jigoku Bot': { name: 'Jigoku Bot', promptTitle: 'Air Ring', menuTitle: '', buttons: airButtons, cardPiles: {} },
                    'Human': { name: 'Human', stats: { honor: opponentHonor } }
                }
            });
            const policy = new JigokuBotPolicy('air');
            expect(policy.decide(makeAirState(18), 'Jigoku Bot').target).toBe('Take 1 Honor from opponent');
            expect(policy.decide(makeAirState(10), 'Jigoku Bot').target).toBe('Gain 2 Honor');
        });
    });

    it('switches the conflict type when the ring defaults to its weak side', function() {
        const makeState = (promptTitle) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: promptTitle,
                    menuTitle: 'Choose province to attack',
                    buttons: [],
                    cardPiles: {
                        cardsInPlay: [{
                            uuid: 'kaze', name: 'Higashi Kaze Company', type: 'character', location: 'play area',
                            bowed: false, inConflict: false,
                            militarySkillSummary: { stat: '6' }, politicalSkillSummary: { stat: '3' }
                        }]
                    }
                },
                'Human': {
                    name: 'Human',
                    provinces: { one: [{ facedown: true, location: 'province 1' }], two: [], three: [], four: [] }
                }
            }
        });
        const policy = new JigokuBotPolicy('type-switch');

        // Political conflict declared but the board is military-heavy: click
        // the ring again to flip the type.
        const flip = policy.decide(makeState('Political Earth Conflict'), 'Jigoku Bot');
        expect(flip.command).toBe('ringClicked');
        expect(flip.args[0]).toBe('earth');
        expect(flip.reason).toBe('switch-conflict-type');

        // Type now matches (new prompt title = new signature): attack the
        // province instead of toggling forever.
        const attack = policy.decide(makeState('Military Earth Conflict'), 'Jigoku Bot');
        expect(attack.command).toBe('facedownCardClicked');
    });

    it('attacks a facedown province through facedownCardClicked', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Military Air Conflict',
                    menuTitle: 'Choose province to attack',
                    buttons: [],
                    cardPiles: { cardsInPlay: [] }
                },
                'Human': {
                    name: 'Human',
                    provinces: {
                        one: [{ facedown: true, location: 'province 1' }],
                        two: [], three: [], four: []
                    }
                }
            }
        };
        const policy = new JigokuBotPolicy('province');

        const decision = policy.decide(state, 'Jigoku Bot');
        expect(decision.command).toBe('facedownCardClicked');
        expect(decision.args).toEqual(['province 1', 'Human', true]);
    });

    it('declares defenders until skill is matched, then clicks done', function() {
        const defender = (uuid, mil, inConflict = false) => ({
            uuid: uuid,
            name: uuid,
            type: 'character',
            location: 'play area',
            bowed: false,
            inConflict: inConflict,
            militarySkillSummary: { stat: String(mil) },
            politicalSkillSummary: { stat: '0' }
        });
        const makeState = (promptTitle, cardsInPlay) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: promptTitle,
                    menuTitle: 'Choose defenders',
                    buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                    cardPiles: { cardsInPlay: cardsInPlay }
                }
            }
        });
        const policy = new JigokuBotPolicy('defend');

        const pick = policy.decide(makeState('Military Air Conflict: 3 vs 0', [defender('guard', 3)]), 'Jigoku Bot');
        expect(pick.command).toBe('cardClicked');
        expect(pick.args[0]).toBe('guard');

        const done = policy.decide(makeState('Military Air Conflict: 3 vs 3', [defender('guard', 3, true)]), 'Jigoku Bot');
        expect(done.command).toBe('menuButton');
        expect(done.target).toBe('Done');
    });

    it('plays a faceup dynasty character during the dynasty action window', function() {
        // Real dynasty window prompt shape from DynastyActionWindow.activePrompt().
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    phase: 'dynasty',
                    promptTitle: 'Play cards from provinces',
                    menuTitle: 'Click pass when done',
                    buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                    provinces: {
                        one: [{ uuid: 'char-1', name: 'Recruit', type: 'character', isDynasty: true, facedown: false, location: 'province 1' }],
                        two: [], three: [], four: []
                    }
                }
            }
        };
        const policy = new JigokuBotPolicy('dynasty');

        const decision = policy.decide(state, 'Jigoku Bot');
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('char-1');

        // Same unchanged prompt again: the card was already attempted, so pass
        // instead of looping on the same click.
        const second = policy.decide(state, 'Jigoku Bot');
        expect(second.command).toBe('menuButton');
        expect(second.target).toBe('Pass');
    });

    it('discards leftover dynasty cards in the fate phase and clicks done', function() {
        const dynastyCard = (uuid, selected = false) => ({
            uuid: uuid,
            name: uuid,
            type: 'character',
            isDynasty: true,
            location: 'province 1',
            selectable: true,
            selected: selected
        });
        const makeState = (cards) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Discard Dynasty Cards',
                    menuTitle: 'Select dynasty cards to discard',
                    selectCard: true,
                    buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                    provinces: { one: cards, two: [], three: [], four: [] }
                }
            },
            rings: {
                air: { element: 'air', conflictType: 'military', unselectable: null }
            }
        });
        const policy = new JigokuBotPolicy('fate-discard');

        // Must not click rings here even though unselectable is not true.
        const first = policy.decide(makeState([dynastyCard('leftover-1')]), 'Jigoku Bot');
        expect(first.command).toBe('cardClicked');
        expect(first.args[0]).toBe('leftover-1');

        const done = policy.decide(makeState([dynastyCard('leftover-1', true)]), 'Jigoku Bot');
        expect(done.command).toBe('menuButton');
        expect(done.target).toBe('Done');
    });

    it('continues past rejected click decisions instead of stalling', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Discard Dynasty Cards',
                    menuTitle: 'Select dynasty cards to discard',
                    selectCard: true,
                    buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                    provinces: {
                        one: [{ uuid: 'stale', name: 'stale', type: 'character', isDynasty: true, location: 'province 1', selectable: true, selected: false }],
                        two: [], three: [], four: []
                    }
                }
            }
        };
        const prompt = state.players['Jigoku Bot'];
        const player = makePlayer(prompt);
        const game = makeGame(player, state);
        const runner = jasmine.createSpy('runner').and.returnValue(true);
        const controller = new JigokuBotController(game, { playerName: player.name, seed: 'x' }, runner);

        controller.tick();

        // 'stale' is not in selectableCards and this is not a direct-click
        // prompt, so the click is rejected — the bot must fall through to the
        // Done button in the same tick instead of stalling.
        expect(controller.trace.some((entry) => entry.result === 'rejected')).toBe(true);
        expect(runner).toHaveBeenCalledWith('menuButton', 'Jigoku Bot', ['done', 'done', undefined]);
    });

    describe('conflict action window', function() {
        function makeConflictWindowState(options) {
            return {
                conflict: {
                    type: options.type || 'military',
                    attackingPlayerId: options.amAttacker ? 'bot-id' : 'human-id',
                    defendingPlayerId: options.amAttacker ? 'human-id' : 'bot-id',
                    attackerSkill: options.attackerSkill,
                    defenderSkill: options.defenderSkill
                },
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        id: 'bot-id',
                        promptTitle: 'Conflict Action Window',
                        menuTitle: 'Military Air conflict\nAttacker: ' + options.attackerSkill + ' Defender: ' + options.defenderSkill,
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: {
                            fate: options.fate !== undefined ? options.fate : 3,
                            honor: options.honor !== undefined ? options.honor : 10
                        },
                        cardPiles: {
                            hand: options.hand || [],
                            dynastyDiscardPile: options.dynastyDiscard || [],
                            // Events/attachments are only played while a ready
                            // participant can benefit; give states one unless
                            // the test overrides.
                            cardsInPlay: options.cardsInPlay || [{
                                uuid: 'fighter', name: 'fighter', type: 'character', location: 'play area',
                                bowed: false, inConflict: true,
                                militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '1' }
                            }]
                        },
                        strongholdProvince: options.strongholdProvince || [],
                        provinces: {
                            one: options.ownProvince ? [options.ownProvince] : [],
                            two: [], three: [], four: []
                        }
                    },
                    'Human': {
                        name: 'Human',
                        id: 'human-id',
                        cardPiles: { cardsInPlay: options.opponentCardsInPlay || [] },
                        provinces: {
                            one: options.opponentProvince ? [options.opponentProvince] : [],
                            two: [], three: [], four: []
                        }
                    }
                }
            };
        }
        const playableCard = { uuid: 'event-1', name: 'Pump Event', type: 'event', location: 'hand', isPlayableByMe: true };

        it('plays a hand card when losing a recoverable conflict', function() {
            const policy = new JigokuBotPolicy('window-play');
            const decision = policy.decide(makeConflictWindowState({
                amAttacker: false, attackerSkill: 4, defenderSkill: 2, hand: [playableCard]
            }), 'Jigoku Bot');
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('event-1');
        });

        it('passes when already winning', function() {
            const policy = new JigokuBotPolicy('window-win');
            const decision = policy.decide(makeConflictWindowState({
                amAttacker: false, attackerSkill: 2, defenderSkill: 5, hand: [playableCard]
            }), 'Jigoku Bot');
            expect(decision.target).toBe('Pass');
        });

        it('keeps attacking until the province actually breaks', function() {
            const attackedProvince = { isProvince: true, inConflict: true, uuid: 'their-prov', strengthSummary: { stat: '5' } };
            // Winning 3 vs 0 breaks nothing against a 5-strength province:
            // keep playing cards to reach the break threshold.
            const push = new JigokuBotPolicy('window-push');
            const decision = push.decide(makeConflictWindowState({
                amAttacker: true, attackerSkill: 3, defenderSkill: 0, hand: [playableCard], opponentProvince: attackedProvince
            }), 'Jigoku Bot');
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('event-1');

            // 5 vs 0 already breaks it: stop spending.
            const enough = new JigokuBotPolicy('window-enough');
            expect(enough.decide(makeConflictWindowState({
                amAttacker: true, attackerSkill: 5, defenderSkill: 0, hand: [playableCard], opponentProvince: attackedProvince
            }), 'Jigoku Bot').target).toBe('Pass');
        });

        it('saves its cards when a lost defense cannot break the province anyway', function() {
            // Losing 5 vs 0, but the 8-strength province survives the loss and
            // the win is out of cheap reach: keep the hand for our own attack.
            const ownProvince = { isProvince: true, inConflict: true, uuid: 'my-prov', strengthSummary: { stat: '8' } };
            const policy = new JigokuBotPolicy('window-safe-loss');
            expect(policy.decide(makeConflictWindowState({
                amAttacker: false, attackerSkill: 5, defenderSkill: 0, hand: [playableCard], ownProvince: ownProvince
            }), 'Jigoku Bot').target).toBe('Pass');
        });

        it('passes when hopelessly behind or out of fate', function() {
            const policy = new JigokuBotPolicy('window-hopeless');
            expect(policy.decide(makeConflictWindowState({
                amAttacker: false, attackerSkill: 12, defenderSkill: 1, hand: [playableCard]
            }), 'Jigoku Bot').target).toBe('Pass');

            const broke = new JigokuBotPolicy('window-broke');
            expect(broke.decide(makeConflictWindowState({
                amAttacker: false, attackerSkill: 4, defenderSkill: 2, hand: [playableCard], fate: 0
            }), 'Jigoku Bot').target).toBe('Pass');
        });

        it('uses stronghold and province powers before spending fate from hand', function() {
            const policy = new JigokuBotPolicy('window-board');
            const state = makeConflictWindowState({
                amAttacker: false,
                attackerSkill: 4,
                defenderSkill: 2,
                hand: [playableCard],
                strongholdProvince: [
                    { uuid: 'sh', name: 'Stronghold', type: 'stronghold', bowed: false, location: 'stronghold province' }
                ]
            });

            const first = policy.decide(state, 'Jigoku Bot');
            expect(first.command).toBe('cardClicked');
            expect(first.args[0]).toBe('sh');

            // Stronghold already attempted in this window: fall through to the
            // hand card.
            const second = policy.decide(state, 'Jigoku Bot');
            expect(second.args[0]).toBe('event-1');
        });

        it('skips hand cards that add nothing to the conflict type', function() {
            const attachment = (uuid) => ({ uuid: uuid, name: uuid, type: 'attachment', location: 'hand', isPlayableByMe: true });
            const handStats = {
                katana: { military: 1, political: 0 },
                scroll: { military: 0, political: 1 }
            };
            const policy = new JigokuBotPolicy('window-type');
            const state = makeConflictWindowState({
                type: 'political',
                amAttacker: false,
                attackerSkill: 4,
                defenderSkill: 2,
                hand: [attachment('katana'), attachment('scroll')]
            });

            const first = policy.decide(state, 'Jigoku Bot', { handStats: handStats });
            expect(first.command).toBe('cardClicked');
            expect(first.args[0]).toBe('scroll');

            // Only the military attachment is left: dead weight in a political
            // conflict, so pass instead of wasting fate.
            const second = policy.decide(state, 'Jigoku Bot', { handStats: handStats });
            expect(second.target).toBe('Pass');
        });

        it('does not waste events when every participant is bowed', function() {
            const policy = new JigokuBotPolicy('window-all-bowed');
            const decision = policy.decide(makeConflictWindowState({
                amAttacker: false,
                attackerSkill: 4,
                defenderSkill: 0,
                hand: [playableCard],
                cardsInPlay: [{
                    uuid: 'bowed-fighter', name: 'bowed-fighter', type: 'character', location: 'play area',
                    bowed: true, inConflict: true,
                    militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '0' }
                }]
            }), 'Jigoku Bot');
            // An event cannot swing a conflict with no ready participant.
            expect(decision.target).toBe('Pass');

            // A character from hand can still enter the conflict: play it.
            const characterCard = { uuid: 'reinforcement', name: 'Reinforcement', type: 'character', location: 'hand', isPlayableByMe: true };
            const reinforce = new JigokuBotPolicy('window-reinforce');
            const pick = reinforce.decide(makeConflictWindowState({
                amAttacker: false,
                attackerSkill: 4,
                defenderSkill: 0,
                hand: [playableCard, characterCard],
                cardsInPlay: []
            }), 'Jigoku Bot');
            expect(pick.command).toBe('cardClicked');
            expect(pick.args[0]).toBe('reinforcement');
        });

        describe('card playbook', function() {
            const playbookHint = (cardId) => getPlaybookEntry(cardId);

            it('gates Assassination behind spare honor AND a known cheap enemy participant', function() {
                const assassination = { uuid: 'assassin-1', id: 'assassination', name: 'Assassination', type: 'event', location: 'hand', isPlayableByMe: true };
                // A Crane card modeled in DeckAnalysis with cost 2 — the gate
                // needs a KNOWN cost-2-or-less participating enemy, otherwise
                // playing it blind loops on the cancel (no valid target).
                const cheapEnemy = { uuid: 'challenger-1', id: 'aspiring-challenger', name: 'Aspiring Challenger', type: 'character', location: 'play area', inConflict: true, bowed: false };

                const rich = new JigokuBotPolicy('playbook-assassin');
                const play = rich.decide(makeConflictWindowState({
                    amAttacker: false, attackerSkill: 4, defenderSkill: 2, hand: [assassination], honor: 10,
                    opponentCardsInPlay: [cheapEnemy]
                }), 'Jigoku Bot', { cardHint: playbookHint });
                expect(play.command).toBe('cardClicked');
                expect(play.args[0]).toBe('assassin-1');

                const poor = new JigokuBotPolicy('playbook-assassin-poor');
                expect(poor.decide(makeConflictWindowState({
                    amAttacker: false, attackerSkill: 4, defenderSkill: 2, hand: [assassination], honor: 4,
                    opponentCardsInPlay: [cheapEnemy]
                }), 'Jigoku Bot', { cardHint: playbookHint }).target).toBe('Pass');

                // No known cheap enemy participant: hold it (avoids the loop).
                const blind = new JigokuBotPolicy('playbook-assassin-blind');
                expect(blind.decide(makeConflictWindowState({
                    amAttacker: false, attackerSkill: 4, defenderSkill: 2, hand: [assassination], honor: 10
                }), 'Jigoku Bot', { cardHint: playbookHint }).target).toBe('Pass');
            });

            it('plays Cavalry Reserves only with a stocked dynasty discard', function() {
                const reserves = { uuid: 'reserves-1', id: 'cavalry-reserves', name: 'Cavalry Reserves', type: 'event', location: 'hand', isPlayableByMe: true };
                const discarded = (uuid) => ({ uuid: uuid, name: uuid, type: 'character', location: 'dynasty discard pile' });

                const stocked = new JigokuBotPolicy('playbook-reserves');
                const play = stocked.decide(makeConflictWindowState({
                    amAttacker: true, attackerSkill: 2, defenderSkill: 4, hand: [reserves],
                    dynastyDiscard: [discarded('dead-1'), discarded('dead-2')]
                }), 'Jigoku Bot', { cardHint: playbookHint });
                expect(play.command).toBe('cardClicked');
                expect(play.args[0]).toBe('reserves-1');

                const empty = new JigokuBotPolicy('playbook-reserves-empty');
                expect(empty.decide(makeConflictWindowState({
                    amAttacker: true, attackerSkill: 2, defenderSkill: 4, hand: [reserves], dynastyDiscard: []
                }), 'Jigoku Bot', { cardHint: playbookHint }).target).toBe('Pass');
            });

            it('clicks a playbook holding action before spending fate from hand', function() {
                const holding = { uuid: 'camp-1', id: 'shiotome-encampment', name: 'Shiotome Encampment', type: 'holding', location: 'province 1', facedown: false };
                const state = makeConflictWindowState({
                    amAttacker: false, attackerSkill: 4, defenderSkill: 2,
                    hand: [playableCard],
                    ownProvince: holding,
                    cardsInPlay: [
                        {
                            uuid: 'fighter', name: 'fighter', type: 'character', location: 'play area',
                            bowed: false, inConflict: true,
                            militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '1' }
                        },
                        {
                            uuid: 'tired', name: 'tired', type: 'character', location: 'play area',
                            bowed: true, inConflict: true,
                            militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '0' }
                        }
                    ]
                });

                const policy = new JigokuBotPolicy('playbook-holding');
                const first = policy.decide(state, 'Jigoku Bot', { cardHint: playbookHint });
                expect(first.command).toBe('cardClicked');
                expect(first.args[0]).toBe('camp-1');

                // Holding attempted: fall through to the hand card.
                const second = policy.decide(state, 'Jigoku Bot', { cardHint: playbookHint });
                expect(second.args[0]).toBe('event-1');
            });

            it('moves Shinjo Saddle off a bowed bearer, and leaves a fighting one alone', function() {
                const saddle = { uuid: 'saddle-1', id: 'shinjo-saddle', name: 'Shinjo Saddle', type: 'attachment', location: 'play area' };
                const cardsInPlay = (bearerBowed) => [
                    {
                        uuid: 'bearer', name: 'bearer', type: 'character', location: 'play area',
                        bowed: bearerBowed, inConflict: true, attachments: [saddle],
                        militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '0' }
                    },
                    {
                        uuid: 'fresh', name: 'fresh', type: 'character', location: 'play area',
                        bowed: false, inConflict: true,
                        militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '1' }
                    }
                ];

                const move = new JigokuBotPolicy('playbook-saddle');
                const decision = move.decide(makeConflictWindowState({
                    amAttacker: false, attackerSkill: 6, defenderSkill: 2, cardsInPlay: cardsInPlay(true)
                }), 'Jigoku Bot', { cardHint: playbookHint });
                expect(decision.command).toBe('cardClicked');
                expect(decision.args[0]).toBe('saddle-1');

                const keep = new JigokuBotPolicy('playbook-saddle-keep');
                expect(keep.decide(makeConflictWindowState({
                    amAttacker: false, attackerSkill: 6, defenderSkill: 2, cardsInPlay: cardsInPlay(false)
                }), 'Jigoku Bot', { cardHint: playbookHint }).target).toBe('Pass');
            });

            it('fires a Crab defending in-play action before spending fate from hand', function() {
                // Frontline Engineer fetches a holding into the attacked
                // province mid-defense — click its Action before playing a
                // hand card.
                const engineer = {
                    uuid: 'eng', id: 'frontline-engineer', name: 'Frontline Engineer', type: 'character',
                    location: 'play area', bowed: false, inConflict: true,
                    militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '2' }
                };
                const state = makeConflictWindowState({
                    amAttacker: false, attackerSkill: 5, defenderSkill: 2, hand: [playableCard],
                    cardsInPlay: [engineer]
                });

                const policy = new JigokuBotPolicy('playbook-engineer');
                const first = policy.decide(state, 'Jigoku Bot', { cardHint: playbookHint });
                expect(first.command).toBe('cardClicked');
                expect(first.args[0]).toBe('eng');

                // Action attempted: fall through to the hand card.
                const second = policy.decide(state, 'Jigoku Bot', { cardHint: playbookHint });
                expect(second.args[0]).toBe('event-1');
            });
        });

        it('sends a played character into the conflict', function() {
            const state = {
                conflict: { type: 'military', attackerSkill: 3, defenderSkill: 2 },
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Wandering Ronin',
                        menuTitle: 'Where do you wish to play this character?',
                        buttons: [
                            { text: 'Conflict', arg: 0, uuid: 'b-conflict' },
                            { text: 'Home', arg: 1, uuid: 'b-home' }
                        ]
                    }
                }
            };
            const policy = new JigokuBotPolicy('placement');
            expect(policy.decide(state, 'Jigoku Bot').target).toBe('Conflict');
        });
    });

    it('defends to prevent a break and gives up hopeless defenses', function() {
        const defender = (uuid, mil) => ({
            uuid: uuid,
            name: uuid,
            type: 'character',
            location: 'play area',
            bowed: false,
            inConflict: false,
            militarySkillSummary: { stat: String(mil) },
            politicalSkillSummary: { stat: '0' }
        });
        const makeState = (promptTitle, cardsInPlay, provinceStrength) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: promptTitle,
                    menuTitle: 'Choose defenders',
                    buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                    cardPiles: { cardsInPlay: cardsInPlay },
                    provinces: {
                        one: [{ isProvince: true, inConflict: true, uuid: 'prov', strengthSummary: { stat: String(provinceStrength) } }],
                        two: [], three: [], four: []
                    }
                }
            }
        });

        // Break is prevented only when defender skill exceeds attacker skill
        // minus province strength (7 - 4 = 3, so 4+ needed). A single 2-skill
        // defender cannot reach that: hopeless, keep the board.
        const hopeless = new JigokuBotPolicy('def-hopeless');
        expect(hopeless.decide(makeState('Military Air Conflict: 7 vs 0', [defender('guard', 2)], 4), 'Jigoku Bot').target).toBe('Done');

        // potential 4 > attackerSkill - strength = 3 → defend to prevent break
        // (target 4), so commit the character.
        const prevent = new JigokuBotPolicy('def-prevent');
        const decision = prevent.decide(makeState('Military Air Conflict: 7 vs 0', [defender('guard', 4)], 4), 'Jigoku Bot');
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('guard');
    });

    describe('ability target polarity', function() {
        const character = (uuid, mil, extra = {}) => Object.assign({
            uuid: uuid,
            name: uuid,
            type: 'character',
            location: 'play area',
            selectable: true,
            bowed: false,
            inConflict: false,
            militarySkillSummary: { stat: String(mil) },
            politicalSkillSummary: { stat: '0' }
        }, extra);

        function makeTargetState(myCards, theirCards) {
            return {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Some Card',
                        menuTitle: 'Choose a character',
                        selectCard: true,
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: myCards }
                    },
                    'Human': {
                        name: 'Human',
                        cardPiles: { cardsInPlay: theirCards }
                    }
                }
            };
        }

        it('aims harmful effects at the opponent strongest character', function() {
            const policy = new JigokuBotPolicy('polarity-harm');
            const decision = policy.decide(
                makeTargetState([character('own-2', 2)], [character('enemy-5', 5), character('enemy-3', 3)]),
                'Jigoku Bot',
                { targetHint: { gameActions: ['dishonor'], sourceIsMine: true } }
            );
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('enemy-5');
        });

        it('gives up its own weakest character when a harmful effect can only hit its side', function() {
            const policy = new JigokuBotPolicy('polarity-forced');
            const decision = policy.decide(
                makeTargetState(
                    [character('own-4', 4), character('own-1', 1)],
                    [character('enemy-5', 5, { selectable: false })]
                ),
                'Jigoku Bot',
                { targetHint: { gameActions: ['discardFromPlay'], sourceIsMine: false } }
            );
            expect(decision.args[0]).toBe('own-1');
        });

        it('never buffs a bowed character while a ready one exists', function() {
            // Classified helpful effect: the bowed in-conflict character has
            // more skill but contributes nothing — buff the ready one.
            const policy = new JigokuBotPolicy('polarity-bowed');
            const decision = policy.decide(
                makeTargetState(
                    [character('bowed-6', 6, { bowed: true, inConflict: true }), character('ready-2', 2)],
                    []
                ),
                'Jigoku Bot',
                { targetHint: { gameActions: ['honor'], sourceIsMine: true } }
            );
            expect(decision.args[0]).toBe('ready-2');

            // Hinted self-target: same rule.
            const hint = { cardId: 'banzai', useWhen: 'losing', conflictTypes: [], targetSide: 'self', targetPreference: 'strongest', priority: 8, summary: '' };
            const hinted = new JigokuBotPolicy('hinted-bowed');
            const pick = hinted.decide(
                makeTargetState(
                    [character('bowed-6', 6, { bowed: true, inConflict: true }), character('ready-2', 2)],
                    []
                ),
                'Jigoku Bot',
                {
                    targetHint: { gameActions: ['applyLastingEffect'], sourceIsMine: true, sourceCardId: 'banzai' },
                    cardHint: () => hint
                }
            );
            expect(pick.args[0]).toBe('ready-2');
        });

        it('sends helpful effects to its own in-conflict character', function() {
            const policy = new JigokuBotPolicy('polarity-help');
            const decision = policy.decide(
                makeTargetState(
                    [character('own-2', 2, { inConflict: true }), character('own-5', 5)],
                    [character('enemy-6', 6)]
                ),
                'Jigoku Bot',
                { targetHint: { gameActions: ['honor'], sourceIsMine: true } }
            );
            expect(decision.args[0]).toBe('own-2');
        });

        it('cancels its own ability instead of hitting the wrong side', function() {
            // Assassination: hinted enemy/weakest, but the only legal target
            // is the bot's own cheap character — cancel, do not self-kill.
            const hint = { cardId: 'assassination', useWhen: 'losing', conflictTypes: [], targetSide: 'enemy', targetPreference: 'weakest', priority: 7, summary: '' };
            const policy = new JigokuBotPolicy('polarity-cancel');
            const decision = policy.decide(
                makeTargetState(
                    [character('own-cheap', 1)],
                    [character('enemy-5', 5, { selectable: false })]
                ),
                'Jigoku Bot',
                {
                    targetHint: { gameActions: ['discardFromPlay'], sourceIsMine: true, sourceCardId: 'assassination' },
                    cardHint: () => hint
                }
            );
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Cancel');

            // Same situation without a hint: classified harmful from the
            // bot's own card still cancels.
            const noHint = new JigokuBotPolicy('polarity-cancel-nohint');
            const fallback = noHint.decide(
                makeTargetState([character('own-cheap', 1)], []),
                'Jigoku Bot',
                { targetHint: { gameActions: ['discardFromPlay'], sourceIsMine: true } }
            );
            expect(fallback.target).toBe('Cancel');
        });

        it('assumes an unclassified effect from its own card is a buff', function() {
            const policy = new JigokuBotPolicy('polarity-unknown');
            const decision = policy.decide(
                makeTargetState([character('own-3', 3)], [character('enemy-6', 6)]),
                'Jigoku Bot',
                { targetHint: { gameActions: ['applyLastingEffect'], sourceIsMine: true } }
            );
            expect(decision.args[0]).toBe('own-3');
        });

        it('assumes an unclassified province effect punishes the attacker', function() {
            const policy = new JigokuBotPolicy('polarity-province');
            const decision = policy.decide(
                makeTargetState([character('own-3', 3)], [character('enemy-6', 6), character('enemy-2', 2)]),
                'Jigoku Bot',
                { targetHint: { gameActions: ['applyLastingEffect'], sourceIsMine: true, sourceType: 'province' } }
            );
            expect(decision.args[0]).toBe('enemy-6');
        });
    });

    describe('attachment targeting', function() {
        const character = (uuid, mil, extra = {}) => Object.assign({
            uuid: uuid,
            name: uuid,
            type: 'character',
            location: 'play area',
            selectable: true,
            bowed: false,
            inConflict: false,
            fate: 0,
            militarySkillSummary: { stat: String(mil) },
            politicalSkillSummary: { stat: '0' }
        }, extra);

        function makeAttachState(myCards, theirCards, conflict) {
            return {
                conflict: conflict,
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        id: 'bot-id',
                        promptTitle: 'Fine Katana',
                        menuTitle: 'Choose a card',
                        selectCard: true,
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: myCards }
                    },
                    'Human': {
                        name: 'Human',
                        cardPiles: { cardsInPlay: theirCards }
                    }
                }
            };
        }
        const attachHint = { targetHint: { gameActions: ['attach'], sourceIsMine: true } };

        it('attaches to its own high-fate character, never the opponent', function() {
            const policy = new JigokuBotPolicy('attach-own');
            const decision = policy.decide(
                makeAttachState(
                    [character('own-skill-5', 5), character('own-fate-2', 2, { fate: 2 })],
                    [character('enemy-6', 6)]
                ),
                'Jigoku Bot',
                attachHint
            );
            // fate 2 outweighs 3 extra skill: the fate keeps the character
            // (and the attachment) alive across fate phases.
            expect(decision.args[0]).toBe('own-fate-2');
        });

        it('never attaches to a bowed character while a ready one exists', function() {
            const policy = new JigokuBotPolicy('attach-bowed');
            const decision = policy.decide(
                makeAttachState(
                    [
                        character('bowed-fighter', 5, { inConflict: true, bowed: true, fate: 2 }),
                        character('ready-home', 2)
                    ],
                    [],
                    { type: 'military', attackingPlayerId: 'human-id', attackerSkill: 5, defenderSkill: 2 }
                ),
                'Jigoku Bot',
                attachHint
            );
            // The bowed participant contributes no skill; pump the ready body.
            expect(decision.args[0]).toBe('ready-home');
        });

        it('attaches to a conflict participant when losing the conflict', function() {
            const policy = new JigokuBotPolicy('attach-conflict');
            const decision = policy.decide(
                makeAttachState(
                    [character('home-strong', 4, { fate: 2 }), character('fighting', 1, { inConflict: true })],
                    [],
                    { type: 'military', attackingPlayerId: 'human-id', attackerSkill: 5, defenderSkill: 2 }
                ),
                'Jigoku Bot',
                attachHint
            );
            expect(decision.args[0]).toBe('fighting');
        });
    });

    describe('additional fate placement', function() {
        const fateButtons = ['0', '1', '2', '3'].map((num) => ({ text: num, arg: num, uuid: 'fate-' + num }));

        function makeFateState(fate) {
            return {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Shrine Maiden',
                        menuTitle: 'Choose additional fate',
                        buttons: fateButtons,
                        stats: { fate: fate }
                    }
                }
            };
        }

        it('scales placed fate with the character cost', function() {
            const policy = new JigokuBotPolicy('fate-curve');
            // Cheap bodies are disposable.
            expect(policy.decide(makeFateState(10), 'Jigoku Bot', { playCost: 1 }).target).toBe('0');
            // Mid-cost gets 1 (7 - 4 - 1 = 2 spare, not rich enough to bump).
            expect(policy.decide(makeFateState(7), 'Jigoku Bot', { playCost: 4 }).target).toBe('1');
            // Expensive gets 2.
            expect(policy.decide(makeFateState(8), 'Jigoku Bot', { playCost: 5 }).target).toBe('2');
            // Rich (12 - 5 - 2 = 5 spare): bump the investment to 3.
            expect(policy.decide(makeFateState(12), 'Jigoku Bot', { playCost: 5 }).target).toBe('3');
        });

        it('keeps a fate reserve when nearly broke', function() {
            const policy = new JigokuBotPolicy('fate-reserve');
            // 5 - 4 - 1 leaves nothing for conflict cards: place 0 instead.
            expect(policy.decide(makeFateState(5), 'Jigoku Bot', { playCost: 4 }).target).toBe('0');
        });

        it('spends the reserve rather than starve an expensive character', function() {
            const policy = new JigokuBotPolicy('fate-powerhouse');
            // Cost 5 with 6 fate: the reserve rule would place 0, but a
            // powerhouse with no fate dies in the next fate phase.
            expect(policy.decide(makeFateState(6), 'Jigoku Bot', { playCost: 5 }).target).toBe('1');
        });
    });

    it('triggers its own province ability in a reaction window and passes otherwise', function() {
        const makeState = (provinceSelectable) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Triggered Abilities',
                    menuTitle: 'Any reactions?',
                    selectCard: true,
                    buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                    provinces: {
                        one: [{ uuid: 'prov-1', name: 'Meditations on the Tao', isProvince: true, selectable: provinceSelectable, location: 'province 1' }],
                        two: [], three: [], four: []
                    }
                }
            }
        });

        const policy = new JigokuBotPolicy('reaction');
        const trigger = policy.decide(makeState(true), 'Jigoku Bot');
        expect(trigger.command).toBe('cardClicked');
        expect(trigger.args[0]).toBe('prov-1');

        const fresh = new JigokuBotPolicy('reaction-pass');
        expect(fresh.decide(makeState(false), 'Jigoku Bot').target).toBe('Pass');
    });

    it('picks a triggered ability instead of the Back button', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Triggered Abilities',
                    menuTitle: 'Which ability would you like to use?',
                    buttons: [
                        { text: 'Back', arg: 1, uuid: 'b-back' },
                        { text: 'Meditate', arg: 0, uuid: 'b-ability' }
                    ]
                }
            }
        };
        const policy = new JigokuBotPolicy('ability-menu');
        expect(policy.decide(state, 'Jigoku Bot').target).toBe('Meditate');
    });

    it('passes gameAction target hints from the current prompt step to the policy', function() {
        const target = (uuid, mil) => ({
            uuid: uuid,
            name: uuid,
            type: 'character',
            location: 'play area',
            selectable: true,
            bowed: false,
            militarySkillSummary: { stat: String(mil) },
            politicalSkillSummary: { stat: '0' }
        });
        let prompt = {
            promptTitle: 'Some Card',
            menuTitle: 'Choose a character',
            selectCard: true,
            buttons: []
        };
        const state = {
            players: {
                'Jigoku Bot': Object.assign({
                    name: 'Jigoku Bot',
                    cardPiles: { cardsInPlay: [target('own-6', 6)] }
                }, prompt),
                'Human': {
                    name: 'Human',
                    cardPiles: { cardsInPlay: [target('enemy-3', 3)] }
                }
            }
        };
        const player = makePlayer(prompt, [{ uuid: 'own-6' }, { uuid: 'enemy-3' }]);
        const game = makeGame(player, state);
        game.pipeline = {
            length: 1,
            getCurrentStep: () => ({
                properties: { gameAction: [{ name: 'bow' }] },
                context: { player: { name: 'Jigoku Bot' } },
                activeCondition: () => true
            })
        };
        const runner = jasmine.createSpy('runner').and.callFake(() => {
            prompt = { buttons: [] };
            player.currentPrompt = () => prompt;
            game.getState = () => ({ players: { 'Jigoku Bot': prompt } });
            return true;
        });
        const controller = new JigokuBotController(game, { playerName: player.name, seed: 'x' }, runner);

        controller.tick();

        // The bow action is harmful, so the bot targets the opponent's
        // character; without the hint the fallback would pick its own
        // higher-skill character.
        expect(runner).toHaveBeenCalledWith('cardClicked', 'Jigoku Bot', ['enemy-3']);
    });

    describe('LLM harness', function() {
        it('extracts JSON from model output with think blocks and prose', function() {
            const parsed = LmStudioClient.extractJson('<think>\nhmm, removal...\n</think>\nSure! Here is the analysis:\n{"targetSide": "enemy", "priority": 8}');
            expect(parsed.targetSide).toBe('enemy');
            expect(parsed.priority).toBe(8);
            expect(() => LmStudioClient.extractJson('no json here')).toThrow();
        });

        it('validates and defaults malformed card hints', function() {
            const hint = validateCardHint({ useWhen: 'nonsense', conflictTypes: ['military', 'bogus'], priority: 42 }, 'card-1');
            expect(hint.useWhen).toBe('always');
            expect(hint.conflictTypes).toEqual(['military']);
            expect(hint.priority).toBe(10);
            expect(hint.targetSide).toBe('either');
            expect(validateCardHint(null, 'card-1')).toBe(null);
        });

        it('analyzes a deck through the client and reuses the disk cache', async function() {
            const cacheDir = require('path').join(require('os').tmpdir(), 'jigoku-bot-hints-spec-' + Date.now());
            const client = {
                model: 'stub',
                chatJson: jasmine.createSpy('chatJson').and.returnValue(Promise.resolve({
                    useWhen: 'attacked', targetSide: 'enemy', targetPreference: 'most-fate', priority: 7, conflictTypes: [], summary: 'strip fate'
                }))
            };
            const service = new DeckHintService(client, { cacheDir: cacheDir });
            await service.analyzeCards([{ id: 'meditations-on-the-tao', name: 'Meditations on the Tao', type: 'province', text: '...' }]);
            expect(service.getHint('meditations-on-the-tao').targetSide).toBe('enemy');
            expect(client.chatJson).toHaveBeenCalledTimes(1);

            // Second service with a dead client must load from cache only.
            const deadClient = { model: 'stub', chatJson: () => Promise.reject(new Error('down')) };
            const cachedService = new DeckHintService(deadClient, { cacheDir: cacheDir });
            await cachedService.analyzeCards([{ id: 'meditations-on-the-tao', name: 'Meditations on the Tao', type: 'province' }]);
            expect(cachedService.getHint('meditations-on-the-tao').priority).toBe(7);

            require('fs').rmSync(cacheDir, { recursive: true, force: true });
        });

        it('marks a fully analyzed deck by deck key and skips it next game', async function() {
            const cacheDir = require('path').join(require('os').tmpdir(), 'jigoku-bot-deck-spec-' + Date.now());
            const deckKey = 'https://www.emeralddb.org/api/decklists/e3feb31b';
            const cards = [{ id: 'card-a', name: 'A', type: 'event' }, { id: 'card-b', name: 'B', type: 'event' }];
            const client = {
                model: 'stub',
                chatJson: () => Promise.resolve({ useWhen: 'always', targetSide: 'self', targetPreference: 'any', priority: 5, conflictTypes: [], summary: '' })
            };
            const service = new DeckHintService(client, { cacheDir: cacheDir });
            expect(service.hasCompleteDeck(deckKey, cards)).toBe(false);
            await service.analyzeCards(cards, deckKey);

            // Fresh service (new game): manifest + per-card cache cover the
            // whole deck without touching the model.
            const deadClient = { model: 'stub', chatJson: () => Promise.reject(new Error('down')) };
            const nextGame = new DeckHintService(deadClient, { cacheDir: cacheDir });
            expect(nextGame.hasCompleteDeck(deckKey, cards)).toBe(true);
            expect(nextGame.getHint('card-a').priority).toBe(5);

            // A changed deck (extra card) is not considered complete.
            expect(nextGame.hasCompleteDeck(deckKey, cards.concat({ id: 'card-c', name: 'C', type: 'event' }))).toBe(false);

            require('fs').rmSync(cacheDir, { recursive: true, force: true });
        });

        it('warns once and stops analysis when LM Studio is down', async function() {
            const warnings = [];
            const deadClient = { model: 'stub', chatJson: () => Promise.reject(new Error('fetch failed')) };
            const service = new DeckHintService(deadClient, {
                cacheDir: require('path').join(require('os').tmpdir(), 'jigoku-bot-hints-void-' + Date.now()),
                onWarn: (message) => warnings.push(message)
            });
            await service.analyzeCards([{ id: 'a', name: 'A', type: 'event' }, { id: 'b', name: 'B', type: 'event' }]);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain('LM Studio unavailable');
            expect(service.hintCount).toBe(0);
        });

        it('gates and orders conflict-window hand plays by card hints', function() {
            const handCard = (uuid, id) => ({ uuid: uuid, id: id, name: uuid, type: 'event', location: 'hand', isPlayableByMe: true });
            const hints = {
                'never-card': { cardId: 'never-card', useWhen: 'never', conflictTypes: [], targetSide: 'none', targetPreference: 'any', priority: 0, summary: '' },
                'good-card': { cardId: 'good-card', useWhen: 'losing', conflictTypes: ['military'], targetSide: 'self', targetPreference: 'any', priority: 9, summary: '' }
            };
            const state = {
                conflict: { type: 'military', attackingPlayerId: 'human-id', attackerSkill: 4, defenderSkill: 2 },
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        id: 'bot-id',
                        promptTitle: 'Conflict Action Window',
                        menuTitle: 'Military Air conflict\nAttacker: 4 Defender: 2',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { fate: 3 },
                        cardPiles: {
                            hand: [handCard('never-card', 'never-card'), handCard('good-card', 'good-card')],
                            cardsInPlay: [{
                                uuid: 'fighter', name: 'fighter', type: 'character', location: 'play area',
                                bowed: false, inConflict: true,
                                militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '1' }
                            }]
                        }
                    }
                }
            };
            const policy = new JigokuBotPolicy('hint-window');
            const decision = policy.decide(state, 'Jigoku Bot', { cardHint: (id) => hints[id] });
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('good-card');

            const second = policy.decide(state, 'Jigoku Bot', { cardHint: (id) => hints[id] });
            expect(second.target).toBe('Pass');
        });

        it('fires a hinted character reaction in a triggered window', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Triggered Abilities',
                        menuTitle: 'Any reactions?',
                        selectCard: true,
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        cardPiles: {
                            cardsInPlay: [{ uuid: 'hero-1', id: 'doji-whisperer', name: 'Doji Whisperer', type: 'character', location: 'play area', selectable: true }]
                        }
                    }
                }
            };
            const hint = { cardId: 'doji-whisperer', useWhen: 'always', conflictTypes: [], targetSide: 'self', targetPreference: 'any', priority: 8, summary: '' };
            const policy = new JigokuBotPolicy('hint-reaction');
            const decision = policy.decide(state, 'Jigoku Bot', { cardHint: () => hint });
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('hero-1');

            // Without a hint the same window is passed.
            const cautious = new JigokuBotPolicy('no-hint-reaction');
            expect(cautious.decide(state, 'Jigoku Bot').target).toBe('Pass');
        });

        it('overrides target polarity with the source card hint', function() {
            const character = (uuid, mil, fate) => ({
                uuid: uuid, name: uuid, type: 'character', location: 'play area',
                selectable: true, bowed: false, inConflict: false, fate: fate,
                militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
            });
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Meditations on the Tao',
                        menuTitle: 'Choose a character',
                        selectCard: true,
                        buttons: [],
                        cardPiles: { cardsInPlay: [character('own-5', 5, 0)] }
                    },
                    'Human': {
                        name: 'Human',
                        cardPiles: { cardsInPlay: [character('enemy-strong', 6, 0), character('enemy-fat', 2, 3)] }
                    }
                }
            };
            const hint = { cardId: 'meditations-on-the-tao', useWhen: 'attacked', conflictTypes: [], targetSide: 'enemy', targetPreference: 'most-fate', priority: 7, summary: '' };
            const policy = new JigokuBotPolicy('hint-target');
            const decision = policy.decide(state, 'Jigoku Bot', {
                targetHint: { gameActions: ['removeFate'], sourceIsMine: true, sourceCardId: 'meditations-on-the-tao' },
                cardHint: () => hint
            });
            // most-fate preference beats the harmful-strongest default.
            expect(decision.args[0]).toBe('enemy-fat');
        });

        it('consults the LLM on ambiguous target prompts and falls back on timeout', async function() {
            const makeConsultSetup = (consultant, llmConfig) => {
                const prompt = {
                    promptTitle: 'Mystery Prompt',
                    menuTitle: 'Choose a card somehow',
                    selectCard: true,
                    buttons: []
                };
                const card = (uuid) => ({ uuid: uuid, name: uuid, type: 'character', location: 'play area', selectable: true });
                const state = {
                    players: {
                        'Jigoku Bot': Object.assign({ name: 'Jigoku Bot', cardPiles: { cardsInPlay: [card('pick-a'), card('pick-b')] } }, prompt)
                    }
                };
                const player = makePlayer(prompt, [{ uuid: 'pick-a' }, { uuid: 'pick-b' }]);
                const game = makeGame(player, state);
                // Consults only fire on ability-target prompts (a target hint
                // exists) whose effect no heuristic could classify.
                game.pipeline = {
                    length: 1,
                    getCurrentStep: () => ({
                        properties: { gameAction: [{ name: 'applyLastingEffect' }] },
                        context: { player: { name: 'Human' } },
                        activeCondition: () => true
                    })
                };
                const calls = [];
                const runner = jasmine.createSpy('runner').and.callFake((command, name, args) => {
                    calls.push(args[0]);
                    const done = { buttons: [] };
                    player.currentPrompt = () => done;
                    game.getState = () => ({ players: { 'Jigoku Bot': done } });
                    return true;
                });
                const controller = new JigokuBotController(
                    game,
                    { playerName: 'Jigoku Bot', seed: 'x', llm: llmConfig },
                    runner,
                    { consultant: consultant }
                );
                return { controller, runner, calls };
            };

            // Consultant answers: its pick is used.
            const answering = { chooseTarget: () => Promise.resolve('pick-b') };
            const okSetup = makeConsultSetup(answering, { enabled: false, consultTimeoutMs: 200 });
            okSetup.controller.tick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(okSetup.calls).toEqual(['pick-b']);

            // Consultant hangs: heuristic fallback fires after the timeout.
            const hanging = { chooseTarget: () => new Promise(() => {}) };
            const timeoutSetup = makeConsultSetup(hanging, { enabled: false, consultTimeoutMs: 30 });
            timeoutSetup.controller.tick();
            await new Promise((resolve) => setTimeout(resolve, 700));
            expect(timeoutSetup.calls.length).toBe(1);
        });

        it('consults the LLM on guessed target polarity but not on classified actions', async function() {
            const makeSetup = (gameActionName, sourcePlayerName, consultant) => {
                const prompt = { promptTitle: 'Banzai!', menuTitle: 'Choose a character', selectCard: true, buttons: [] };
                const card = (uuid, mil) => ({
                    uuid: uuid, name: uuid, type: 'character', location: 'play area', selectable: true,
                    militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
                });
                const state = {
                    players: {
                        'Jigoku Bot': Object.assign({ name: 'Jigoku Bot', cardPiles: { cardsInPlay: [card('own-2', 2)] } }, prompt),
                        'Human': { name: 'Human', cardPiles: { cardsInPlay: [card('enemy-5', 5)] } }
                    }
                };
                const player = makePlayer(prompt, [{ uuid: 'own-2' }, { uuid: 'enemy-5' }]);
                const game = makeGame(player, state);
                game.pipeline = {
                    length: 1,
                    getCurrentStep: () => ({
                        properties: { gameAction: [{ name: gameActionName }] },
                        context: { player: { name: sourcePlayerName } },
                        activeCondition: () => true
                    })
                };
                const calls = [];
                const runner = jasmine.createSpy('runner').and.callFake((command, name, args) => {
                    calls.push(args[0]);
                    const done = { buttons: [] };
                    player.currentPrompt = () => done;
                    game.getState = () => ({ players: { 'Jigoku Bot': done } });
                    return true;
                });
                const controller = new JigokuBotController(
                    game,
                    { playerName: 'Jigoku Bot', seed: 'x', llm: { enabled: false, consultTimeoutMs: 200 } },
                    runner,
                    { consultant: consultant }
                );
                return { controller, calls };
            };

            // Unclassified lasting effect from the bot's own card: the guessed
            // buff pick is overridden by the consult answer.
            const consultant = { chooseTarget: jasmine.createSpy('chooseTarget').and.returnValue(Promise.resolve('enemy-5')) };
            const guessedSetup = makeSetup('applyLastingEffect', 'Jigoku Bot', consultant);
            guessedSetup.controller.tick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(consultant.chooseTarget).toHaveBeenCalled();
            expect(guessedSetup.calls).toEqual(['enemy-5']);

            // Classified harmful action: heuristics know the answer, no consult.
            const idleConsultant = { chooseTarget: jasmine.createSpy('chooseTarget') };
            const classifiedSetup = makeSetup('bow', 'Jigoku Bot', idleConsultant);
            classifiedSetup.controller.tick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(idleConsultant.chooseTarget).not.toHaveBeenCalled();
            expect(classifiedSetup.calls).toEqual(['enemy-5']);
        });
    });

    it('clicks a selectable facedown opponent province in a card ability prompt', function() {
        // Doji Diplomat-style prompt: the bot must pick one of the opponent's
        // facedown provinces, which carry no uuid in its state view.
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Doji Diplomat',
                    menuTitle: 'Choose a province',
                    selectCard: true,
                    buttons: []
                },
                'Human': {
                    name: 'Human',
                    provinces: {
                        one: [{ facedown: true, location: 'province 1', selectable: true }],
                        two: [], three: [], four: []
                    }
                }
            }
        };
        const policy = new JigokuBotPolicy('facedown-choice');
        const decision = policy.decide(state, 'Jigoku Bot');
        expect(decision.command).toBe('facedownCardClicked');
        expect(decision.args).toEqual(['province 1', 'Human', true]);
    });

    it('accepts facedown clicks backed by the selectable card set', function() {
        const prompt = { promptTitle: 'Doji Diplomat', menuTitle: 'Choose a province', selectCard: true, buttons: [] };
        const provinceCard = { location: 'province 1', controller: { name: 'Human' } };
        const player = makePlayer(prompt, [provinceCard]);
        const game = makeGame(player, {});
        game.getPlayerByName = (name) => name === 'Human' ? { name: 'Human' } : player;
        const runner = jasmine.createSpy('runner').and.returnValue(true);
        const controller = new JigokuBotController(game, { playerName: 'Jigoku Bot', seed: 'x' }, runner);

        expect(controller.executeDecision({
            command: 'facedownCardClicked',
            args: ['province 1', 'Human', true],
            target: 'province 1',
            reason: 'test'
        })).toBe(true);
        expect(runner).toHaveBeenCalledWith('facedownCardClicked', 'Jigoku Bot', ['province 1', 'Human', true]);
    });

    it('re-ticks itself when the per-tick decision budget runs out', async function() {
        let clicks = 0;
        let prompt = { promptTitle: 'Chain', menuTitle: 'Keep going', buttons: [{ text: 'Done', arg: 'done', uuid: 'd1' }] };
        const player = makePlayer(prompt);
        const game = makeGame(player, { players: { 'Jigoku Bot': prompt } });
        const runner = jasmine.createSpy('runner').and.callFake(() => {
            clicks++;
            if(clicks >= 2) {
                prompt = { buttons: [] };
                player.currentPrompt = () => prompt;
                game.getState = () => ({ players: { 'Jigoku Bot': prompt } });
            }
            return true;
        });
        const controller = new JigokuBotController(game, { playerName: 'Jigoku Bot', seed: 'x', maxDecisionsPerTick: 1 }, runner);

        controller.tick();
        expect(clicks).toBe(1);

        // The budget ran out with the prompt still active: the follow-up tick
        // must fire on its own, without a human command.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(clicks).toBe(2);
    });

    describe('seed 2 LLM-driven policy', function() {
        it('rejects a hallucinated option id and accepts a real one', async function() {
            const options = [{ id: 'opt0', label: 'a' }, { id: 'opt1', label: 'b' }];
            const request = { question: 'q', state: {}, hand: [], board: {}, options: options };

            const bogus = new LlmActionPlanner({ chatJson: () => Promise.resolve({ option: 'opt9' }) });
            expect(await bogus.chooseAction(request, 100)).toBe(null);

            const good = new LlmActionPlanner({ chatJson: () => Promise.resolve({ option: 'opt1', reason: 'why' }) });
            const picked = await good.chooseAction(request, 100);
            expect(picked.optionId).toBe('opt1');
            expect(picked.reason).toBe('why');
        });

        const makeSeed2Setup = (planner) => {
            const prompt = {
                promptTitle: 'Choice',
                menuTitle: 'Choose a card',
                selectCard: true,
                buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }]
            };
            const card = (uuid) => ({ uuid: uuid, name: uuid, type: 'character', location: 'play area', selectable: true });
            const state = {
                players: {
                    'Jigoku Bot': Object.assign({ name: 'Jigoku Bot', cardPiles: { cardsInPlay: [card('pick-a'), card('pick-b')] } }, prompt)
                }
            };
            const player = makePlayer(prompt, [{ uuid: 'pick-a' }, { uuid: 'pick-b' }]);
            const game = makeGame(player, state);
            const calls = [];
            const runner = jasmine.createSpy('runner').and.callFake((command, name, args) => {
                calls.push(args[0]);
                const done = { buttons: [] };
                player.currentPrompt = () => done;
                game.getState = () => ({ players: { 'Jigoku Bot': done } });
                return true;
            });
            const onStateChange = jasmine.createSpy('onStateChange');
            const controller = new JigokuBotController(
                game,
                { playerName: 'Jigoku Bot', seed: 2, llm: { enabled: false, consultTimeoutMs: 200 } },
                runner,
                { planner: planner, onStateChange: onStateChange }
            );
            return { controller, calls, onStateChange };
        };

        it('executes the move the planner chooses and broadcasts the new state', async function() {
            // Planner picks the option whose label mentions pick-b.
            const planner = {
                chooseAction: (request) => {
                    const option = request.options.find((candidate) => candidate.label.includes('pick-b'));
                    return Promise.resolve({ optionId: option.id, reason: 'test' });
                }
            };
            const setup = makeSeed2Setup(planner);
            setup.controller.tick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(setup.calls).toEqual(['pick-b']);
            // The async consult path must push state itself or the human freezes.
            expect(setup.onStateChange).toHaveBeenCalled();
        });

        it('falls back to the heuristic pick when the planner returns nothing', async function() {
            const planner = { chooseAction: () => Promise.resolve(null) };
            const setup = makeSeed2Setup(planner);
            setup.controller.tick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            // Heuristic choose-card picks the first selectable card.
            expect(setup.calls).toEqual(['pick-a']);
        });

        it('clicks a legal option when the heuristic fallback is itself illegal', async function() {
            // Province-setup-shaped prompt: selectRing steers the heuristic into
            // an illegal ring click, but a legal card option exists. The bot
            // must click the card instead of looping on the rejected ring.
            const prompt = {
                promptTitle: 'Place Provinces',
                menuTitle: 'Select stronghold province',
                selectCard: true,
                selectRing: true,
                buttons: []
            };
            const card = (uuid) => ({ uuid: uuid, name: uuid, type: 'province', location: 'province 1', selectable: true });
            const state = {
                rings: { air: { element: 'air', unselectable: null } },
                players: {
                    'Jigoku Bot': Object.assign({ name: 'Jigoku Bot', cardPiles: { cardsInPlay: [card('prov-a'), card('prov-b')] } }, prompt)
                }
            };
            // No selectable rings: the heuristic's ring click is illegal here.
            const player = makePlayer(prompt, [{ uuid: 'prov-a' }, { uuid: 'prov-b' }], []);
            const game = makeGame(player, state);
            const calls = [];
            const runner = jasmine.createSpy('runner').and.callFake((command, name, args) => {
                calls.push({ command: command, arg: args[0] });
                const done = { buttons: [] };
                player.currentPrompt = () => done;
                game.getState = () => ({ players: { 'Jigoku Bot': done } });
                return true;
            });
            const controller = new JigokuBotController(
                game,
                { playerName: 'Jigoku Bot', seed: 2, llm: { enabled: false, consultTimeoutMs: 200 } },
                runner,
                { planner: { chooseAction: () => Promise.resolve(null) } }
            );
            controller.tick();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(calls.length).toBe(1);
            expect(calls[0].command).toBe('cardClicked');
            expect(calls[0].arg).toBe('prov-a');
        });
    });

    describe('Crab wall deck strategy', function() {
        const holdingEngine = { holdingEngine: true, defensive: true };

        it('flags the Crab wall deck as a defensive holding engine', function() {
            const crab = deriveDeckStrategy([
                'kyuden-hida', 'kaiu-forges', 'seventh-tower', 'hida-kotoe', 'staunch-hida',
                'guardians-of-rokugan', 'hiruma-yojimbo'
            ]);
            expect(crab.holdingEngine).toBe(true);
            expect(crab.defensive).toBe(true);
        });

        it('leaves an aggressive deck on the generic behavior', function() {
            const unicorn = deriveDeckStrategy(['banzai', 'cavalry-reserves', 'shinjo-saddle', 'moto-stables', 'a-perfect-cut']);
            expect(unicorn.holdingEngine).toBe(false);
            expect(unicorn.defensive).toBe(false);
        });

        it('covers the Crab action, reaction, and dynasty cards', function() {
            expect(getPlaybookEntry('watch-commander').priority).toBe(8);
            expect(getPlaybookEntry('guardians-of-rokugan').targetSide).toBe('self');
            expect(getPlaybookEntry('frontline-engineer').inPlayAction).toBe(true);
            expect(getPlaybookEntry('kyuden-hida').dynastyAction).toBe(true);
            expect(getPlaybookEntry('kaiu-forges').dynastyAction).toBe(true);
            // Pure stat sticks stay passive — no entry needed.
            expect(getPlaybookEntry('ornate-fan')).toBeUndefined();
        });

        it('mulligans non-holding provinces toward holdings for a wall deck', function() {
            const provinceCard = (uuid, type) => ({ uuid: uuid, name: uuid, type: type, location: 'province 1', isDynasty: true, selectable: true, selected: false });
            const makeState = (cards) => ({
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Dynasty Mulligan',
                        menuTitle: 'Select dynasty cards to mulligan',
                        selectCard: true,
                        buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                        provinces: { one: cards, two: [], three: [], four: [] }
                    }
                }
            });

            const policy = new JigokuBotPolicy('crab-mulligan');
            const state = makeState([provinceCard('recruit', 'character'), provinceCard('wall', 'holding')]);
            const first = policy.decide(state, 'Jigoku Bot', { strategy: holdingEngine });
            expect(first.command).toBe('cardClicked');
            expect(first.args[0]).toBe('recruit');

            // Character already flagged for mulligan; the holding is kept — Done.
            const done = policy.decide(state, 'Jigoku Bot', { strategy: holdingEngine });
            expect(done.target).toBe('Done');

            // Aggressive decks keep their opening provinces.
            const generic = new JigokuBotPolicy('crab-mulligan-generic');
            expect(generic.decide(makeState([provinceCard('recruit', 'character')]), 'Jigoku Bot').target).toBe('Done');
        });

        it('never discards holdings from provinces in the fate phase', function() {
            const card = (uuid, type, selected = false) => ({ uuid: uuid, name: uuid, type: type, isDynasty: true, location: 'province 1', selectable: true, selected: selected });
            const makeState = (cards) => ({
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Discard Dynasty Cards',
                        menuTitle: 'Select dynasty cards to discard',
                        selectCard: true,
                        buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                        provinces: { one: cards, two: [], three: [], four: [] }
                    }
                },
                rings: { air: { element: 'air', unselectable: null } }
            });

            const policy = new JigokuBotPolicy('crab-fate-discard');
            const first = policy.decide(makeState([card('wall', 'holding'), card('leftover', 'character')]), 'Jigoku Bot');
            expect(first.command).toBe('cardClicked');
            expect(first.args[0]).toBe('leftover');

            // Only the holding is left selectable: keep it, click Done.
            const done = policy.decide(makeState([card('wall', 'holding'), card('leftover', 'character', true)]), 'Jigoku Bot');
            expect(done.target).toBe('Done');
        });

        it('digs with a stronghold dynasty action for a holding-engine deck', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        phase: 'dynasty',
                        promptTitle: 'Play cards from provinces',
                        menuTitle: 'Click pass when done',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { fate: 5 },
                        strongholdProvince: [{ uuid: 'kh', id: 'kyuden-hida', name: 'Kyuden Hida', type: 'stronghold', facedown: false, bowed: false, location: 'stronghold province' }],
                        provinces: { one: [], two: [], three: [], four: [] }
                    }
                }
            };

            const policy = new JigokuBotPolicy('crab-dig');
            const decision = policy.decide(state, 'Jigoku Bot', { strategy: holdingEngine, cardHint: getPlaybookEntry });
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('kh');

            // Aggressive deck: no dynasty digging, just pass.
            const generic = new JigokuBotPolicy('crab-dig-generic');
            expect(generic.decide(state, 'Jigoku Bot', { cardHint: getPlaybookEntry }).target).toBe('Pass');
        });

        it('holds back an unwinnable attack for a defensive deck', function() {
            const character = (uuid, mil) => ({
                uuid: uuid, name: uuid, type: 'character', location: 'play area', bowed: false, inConflict: false,
                militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
            });
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Military Air Conflict',
                        menuTitle: 'Choose attackers',
                        buttons: [{ text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }],
                        cardPiles: { cardsInPlay: [character('weak', 2)] }
                    },
                    'Human': {
                        name: 'Human',
                        cardPiles: { cardsInPlay: [character('big', 6)] },
                        provinces: {
                            one: [{ isProvince: true, inConflict: true, uuid: 'p', strengthSummary: { stat: '5' } }],
                            two: [], three: [], four: []
                        }
                    }
                }
            };

            // breakTarget = province 5 + defense 6 = 11, only 2 skill available.
            const defensive = new JigokuBotPolicy('crab-hold');
            expect(defensive.decide(state, 'Jigoku Bot', { strategy: holdingEngine }).target).toBe('Pass Conflict');

            // The aggressive deck still probes with its body.
            const aggressive = new JigokuBotPolicy('crab-hold-generic');
            const pick = aggressive.decide(state, 'Jigoku Bot');
            expect(pick.command).toBe('cardClicked');
            expect(pick.args[0]).toBe('weak');
        });
    });

    describe('Unicorn military-rush deck strategy', function() {
        const rush = { holdingEngine: false, defensive: false, aggressive: true };
        const char = (uuid, mil, pol, inConflict) => ({
            uuid: uuid, name: uuid, type: 'character', location: 'play area', bowed: false,
            inConflict: !!inConflict, militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: String(pol) }
        });

        it('flags a Unicorn military-rush deck as aggressive', function() {
            const unicorn = deriveDeckStrategy([
                'cavalry-reserves', 'shiotome-encampment', 'ujik-tactics', 'captive-audience',
                'challenge-on-the-fields', 'golden-plains-outpost', 'ride-on', 'spoils-of-war',
                'curved-blade', 'born-in-war'
            ]);
            expect(unicorn.aggressive).toBe(true);
            expect(unicorn.holdingEngine).toBe(false);
            expect(unicorn.defensive).toBe(false);
        });

        it('leaves defensive and thin decks non-aggressive', function() {
            expect(deriveDeckStrategy([
                'kyuden-hida', 'kaiu-forges', 'seventh-tower', 'hida-kotoe', 'staunch-hida', 'guardians-of-rokugan'
            ]).aggressive).toBe(false);
            // One or two rush markers is not a rush deck.
            expect(deriveDeckStrategy(['cavalry-reserves', 'banzai']).aggressive).toBe(false);
        });

        it('covers the rush conflict cards', function() {
            expect(getPlaybookEntry('spoils-of-war').priority).toBe(9);
            expect(getPlaybookEntry('captive-audience').conflictTypes).toContain('political');
            expect(getPlaybookEntry('curved-blade').targetSide).toBe('self');
            expect(getPlaybookEntry('spyglass').targetSide).toBe('self');
            expect(typeof getPlaybookEntry('challenge-on-the-fields').shouldPlay).toBe('function');
            expect(typeof getPlaybookEntry('ride-on').shouldPlay).toBe('function');
        });

        it('deploys characters with at most 1 fate when aggressive', function() {
            const fateButtons = ['0', '1', '2', '3'].map((num) => ({ text: num, arg: num, uuid: 'fate-' + num }));
            const fateState = (fate) => ({
                players: {
                    'Jigoku Bot': { name: 'Jigoku Bot', promptTitle: 'Deploy', menuTitle: 'Choose additional fate', buttons: fateButtons, stats: { fate: fate } }
                }
            });
            const policy = new JigokuBotPolicy('rush-fate');
            // Cheap body: still 0.
            expect(policy.decide(fateState(10), 'Jigoku Bot', { playCost: 1, strategy: rush }).target).toBe('0');
            // Powerhouse that would normally get 2 is capped at 1.
            expect(policy.decide(fateState(10), 'Jigoku Bot', { playCost: 5, strategy: rush }).target).toBe('1');
        });

        it('commits every body when the break is out of reach', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Military Air Conflict',
                        menuTitle: 'Choose attackers',
                        buttons: [{ text: 'Initiate Conflict', arg: 'initiate', uuid: 'init' }, { text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }],
                        cardPiles: { cardsInPlay: [char('a', 3, 0, true), char('b', 3, 0, true), char('weak', 2, 0, false)] }
                    },
                    'Human': {
                        name: 'Human',
                        cardPiles: { cardsInPlay: [char('big', 9, 0, false)] },
                        provinces: { one: [{ isProvince: true, inConflict: true, uuid: 'p', strengthSummary: { stat: '5' } }], two: [], three: [], four: [] }
                    }
                }
            };
            // breakTarget = 5 + 9 = 14 > 8 available: unreachable.
            const rushPolicy = new JigokuBotPolicy('rush-allin');
            const pick = rushPolicy.decide(state, 'Jigoku Bot', { strategy: rush });
            expect(pick.command).toBe('cardClicked');
            expect(pick.args[0]).toBe('weak');

            // A generic deck keeps the weakest body home and just initiates.
            const generic = new JigokuBotPolicy('rush-allin-generic');
            expect(generic.decide(state, 'Jigoku Bot').target).toBe('Initiate Conflict');
        });

        it('forces conflicts to military even when politically stronger', function() {
            const makeState = (title) => ({
                players: {
                    'Jigoku Bot': { name: 'Jigoku Bot', promptTitle: title, menuTitle: 'Choose province to attack', buttons: [], cardPiles: { cardsInPlay: [char('c', 2, 3, false)] } },
                    'Human': { name: 'Human', provinces: { one: [{ isProvince: true, uuid: 'p' }], two: [], three: [], four: [] } }
                }
            });
            const rushPolicy = new JigokuBotPolicy('rush-mil');
            const flip = rushPolicy.decide(makeState('Political Earth Conflict'), 'Jigoku Bot', { strategy: rush });
            expect(flip.command).toBe('ringClicked');
            expect(flip.reason).toBe('switch-conflict-type');

            // Generic deck is politically stronger here, so it stays political.
            const generic = new JigokuBotPolicy('rush-mil-generic');
            expect(generic.decide(makeState('Political Earth Conflict'), 'Jigoku Bot').reason).toBe('attack-province');
        });

        it('concedes a defense it cannot win to keep bodies ready', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Military Air Conflict: 7 vs 0',
                        menuTitle: 'Choose defenders',
                        buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                        cardPiles: { cardsInPlay: [char('d', 4, 0, false)] },
                        provinces: { one: [{ isProvince: true, inConflict: true, uuid: 'p', strengthSummary: { stat: '4' } }], two: [], three: [], four: [] }
                    }
                }
            };
            const rushPolicy = new JigokuBotPolicy('rush-defend');
            expect(rushPolicy.decide(state, 'Jigoku Bot', { strategy: rush }).target).toBe('Done');

            // A generic deck chump-blocks to prevent the break.
            const generic = new JigokuBotPolicy('rush-defend-generic');
            const commit = generic.decide(state, 'Jigoku Bot');
            expect(commit.command).toBe('cardClicked');
            expect(commit.args[0]).toBe('d');
        });

        it('rides a character into the conflict rather than home', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot',
                        promptTitle: 'Ride On',
                        menuTitle: '',
                        buttons: [{ text: 'Move Iuchi to the conflict', arg: 'in', uuid: 'in' }, { text: 'Move Iuchi home', arg: 'home', uuid: 'home' }]
                    }
                }
            };
            const decision = new JigokuBotPolicy('ride-on').decide(state, 'Jigoku Bot');
            expect(decision.reason).toBe('ride-move-in');
            expect(decision.target).toBe('Move Iuchi to the conflict');
        });
    });

    it('runs a smoke prompt through the normal command runner', function() {
        let prompt = {
            promptTitle: 'Honor Bid',
            menuTitle: 'Choose a bid',
            buttons: [{ text: '1', arg: '1', uuid: 'bid', command: 'menuButton' }]
        };
        const player = makePlayer(prompt);
        const game = makeGame(player, {
            players: { 'Jigoku Bot': prompt }
        });
        const runner = jasmine.createSpy('runner').and.callFake(() => {
            prompt = { buttons: [] };
            player.currentPrompt = () => prompt;
            game.getState = () => ({ players: { 'Jigoku Bot': prompt } });
            return true;
        });
        const controller = new JigokuBotController(game, { playerName: player.name, seed: 'x' }, runner);

        controller.tick();

        expect(runner).toHaveBeenCalledWith('menuButton', 'Jigoku Bot', ['1', 'bid', undefined]);
        expect(game.continue).toHaveBeenCalled();
        expect(controller.trace[0].result).toBe('success');
    });
});
