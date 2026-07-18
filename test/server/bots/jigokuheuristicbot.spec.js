const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
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

    it('builds a target hint when a selector exposes one gameAction object', function() {
        const controller = Object.create(JigokuBotController.prototype);
        controller.currentPromptStep = () => ({
            properties: { gameAction: { name: 'discardFromPlay' } },
            context: {
                player: { name: 'Jigoku Bot' },
                source: { uuid: 'let-go-source', type: 'event', cardData: { id: 'let-go' } }
            }
        });
        expect(controller.currentTargetHint({ name: 'Jigoku Bot' })).toEqual({
            gameActions: ['discardFromPlay'],
            sourceIsMine: true,
            sourceType: 'event',
            sourceCardId: 'let-go',
            sourceUuid: 'let-go-source'
        });
    });

    it('recognizes the actionless first selector of an event-started duel', function() {
        const controller = Object.create(JigokuBotController.prototype);
        controller.currentPromptStep = () => ({
            properties: { gameAction: [] },
            context: {
                player: { name: 'Jigoku Bot' },
                source: {
                    uuid: 'make-your-case-source', type: 'event',
                    cardData: { id: 'make-your-case' }
                },
                ability: { properties: { initiateDuel: { type: 'political' } } },
                targets: {}
            }
        });

        expect(controller.currentTargetHint({ name: 'Jigoku Bot' })).toEqual({
            gameActions: ['duel'],
            sourceIsMine: true,
            sourceType: 'event',
            sourceCardId: 'make-your-case',
            sourceUuid: 'make-your-case-source',
            duelAxis: 'political'
        });
    });

    it('exposes the chosen challenger when an opponent makes us select our duel target', function() {
        const controller = Object.create(JigokuBotController.prototype);
        controller.currentPromptStep = () => ({
            properties: { gameAction: [{ name: 'duel' }], dependsOn: 'challenger' },
            context: {
                player: { name: 'Opponent' },
                source: { uuid: 'case', type: 'event', cardData: { id: 'make-your-case' } },
                ability: { properties: { initiateDuel: { type: 'political' } } },
                targets: { challenger: { uuid: 'enemy-challenger' } }
            }
        });

        expect(controller.currentTargetHint({ name: 'Jigoku Bot' })).toEqual({
            gameActions: ['duel'],
            sourceIsMine: false,
            sourceType: 'event',
            sourceCardId: 'make-your-case',
            sourceUuid: 'case',
            duelAxis: 'political',
            duelOpponentUuid: 'enemy-challenger'
        });
    });

    it('reads duel axis from a direct DuelAction used by character abilities', function() {
        const controller = Object.create(JigokuBotController.prototype);
        controller.currentPromptStep = () => ({
            properties: {
                gameAction: [{
                    name: 'duel',
                    getProperties: () => ({ type: 'military' })
                }]
            },
            context: {
                player: { name: 'Opponent' },
                source: {
                    uuid: 'kaezin', type: 'character', cardData: { id: 'kakita-kaezin' }
                },
                ability: { properties: {} },
                targets: {}
            }
        });

        expect(controller.currentTargetHint({ name: 'Jigoku Bot' })).toEqual({
            gameActions: ['duel'],
            sourceIsMine: false,
            sourceType: 'character',
            sourceCardId: 'kakita-kaezin',
            sourceUuid: 'kaezin',
            duelAxis: 'military',
            duelOpponentUuid: 'kaezin'
        });
    });

    it('reads political axis from a manually-defined dependent duel target', function() {
        const controller = Object.create(JigokuBotController.prototype);
        const duelAction = {
            name: 'duel',
            getProperties: () => ({ type: 'political' })
        };
        controller.currentPromptStep = () => ({
            properties: { gameAction: [] },
            context: {
                player: { name: 'Jigoku Bot' },
                source: {
                    uuid: 'policy-source', type: 'event',
                    cardData: { id: 'policy-debate' }
                },
                ability: {
                    properties: {
                        targets: {
                            challenger: { gameAction: [] },
                            duelTarget: { gameAction: duelAction }
                        }
                    }
                },
                targets: {}
            }
        });

        expect(controller.currentTargetHint({ name: 'Jigoku Bot' })).toEqual({
            gameActions: ['duel'],
            sourceIsMine: true,
            sourceType: 'event',
            sourceCardId: 'policy-debate',
            sourceUuid: 'policy-source',
            duelAxis: 'political'
        });
    });

    it('expands composite target actions into their named leaf actions', function() {
        const controller = Object.create(JigokuBotController.prototype);
        controller.currentPromptStep = () => ({
            properties: {
                gameAction: {
                    name: '',
                    properties: {
                        gameActions: [
                            { name: 'ready' },
                            { name: 'move' }
                        ]
                    }
                }
            },
            context: {
                player: { name: 'Jigoku Bot' },
                source: { type: 'event', cardData: { id: 'in-service-to-my-lord' } }
            }
        });

        expect(controller.currentTargetHint({ name: 'Jigoku Bot' })).toEqual({
            gameActions: ['ready', 'move'],
            sourceIsMine: true,
            sourceType: 'event',
            sourceCardId: 'in-service-to-my-lord'
        });
    });

    it('exposes free-fate metadata from a nested playCard action', function() {
        const controller = Object.create(JigokuBotController.prototype);
        controller.currentPromptStep = () => ({
            properties: {
                gameAction: {
                    name: '',
                    properties: {
                        gameActions: [{
                            name: 'playCard',
                            properties: { ignoreFateCost: true }
                        }]
                    }
                }
            },
            context: {
                player: { name: 'Jigoku Bot' },
                source: { type: 'attachment', cardData: { id: 'kunshu' } }
            }
        });

        expect(controller.currentTargetHint({ name: 'Jigoku Bot' })).toEqual({
            gameActions: ['playCard'],
            sourceIsMine: true,
            sourceType: 'attachment',
            sourceCardId: 'kunshu',
            playCardFateCostIgnored: true
        });
    });

    it('reads played card metadata from an active interrupt window', function() {
        const controller = Object.create(JigokuBotController.prototype);
        controller.currentPromptStep = () => ({ properties: {} });
        controller.game = {
            currentAbilityWindow: {
                events: [
                    {
                        name: 'onAbilityResolverInitiated',
                        context: {
                            source: {
                                printedCost: 0,
                                cardData: { id: 'fine-katana', cost: '0' }
                            }
                        }
                    }
                ]
            }
        };
        expect(controller.currentPlayCost({ name: 'Jigoku Bot' })).toBe(0);
        expect(controller.currentPlayCardId({ name: 'Jigoku Bot' })).toBe('fine-katana');
    });

    it('reads ownership from the event being interrupted', function() {
        const controller = Object.create(JigokuBotController.prototype);
        const bot = { name: 'Jigoku Bot' };
        controller.currentPromptStep = () => ({
            events: [{
                name: 'onInitiateAbilityEffects',
                card: { getType: () => 'event' },
                context: { player: bot }
            }]
        });
        expect(controller.currentInterruptedEventIsMine(bot)).toBe(true);
        expect(controller.currentInterruptedEventIsMine({ name: 'Opponent' })).toBe(false);
    });

    it('builds a live legal direct-click set instead of trusting card visibility', function() {
        const prompt = { promptTitle: 'Military Earth Conflict', menuTitle: 'Choose attackers', buttons: [] };
        const player = makePlayer(prompt);
        const legal = { uuid: 'legal', type: 'character' };
        const illegal = { uuid: 'illegal', type: 'character' };
        const game = makeGame(player, { cards: [legal, illegal] });
        game.findAnyCardInAnyList = (uuid) => uuid === 'legal' ? legal : illegal;
        const controller = new JigokuBotController(game, { playerName: player.name, seed: 1 }, jasmine.createSpy('runner'));
        controller.currentPromptStep = () => ({ checkCardCondition: (card) => card === legal });

        expect(controller.currentLegalDirectCardUuids(player)).toEqual({ legal: true });
        expect(controller.isLegalCard(player, 'legal')).toBe(true);
        expect(controller.isLegalCard(player, 'illegal')).toBe(false);
    });

    it('omits Storied Defeat when its only legal duel loser is friendly', function() {
        const prompt = { promptTitle: 'Conflict Action Window', menuTitle: 'Initiate an action', buttons: [] };
        const player = makePlayer(prompt);
        const summary = { uuid: 'storied', id: 'storied-defeat', type: 'event', location: 'hand' };
        const liveCard = { uuid: 'storied', cardData: { id: 'storied-defeat' } };
        const game = makeGame(player, { cards: [summary] });
        game.findAnyCardInAnyList = () => liveCard;
        const controller = new JigokuBotController(game, { playerName: player.name, seed: 1 }, jasmine.createSpy('runner'));
        const preferredTargetLegal = jasmine.createSpy('preferredTargetLegal').and.returnValue(false);
        controller.currentPromptStep = () => ({
            canClickCard: () => true,
            canClickCardForTargetSide: preferredTargetLegal
        });

        expect(controller.currentLegalDirectCardUuids(player)).toEqual({});
        expect(preferredTargetLegal).toHaveBeenCalledWith(player, liveCard, 'enemy');

        preferredTargetLegal.and.returnValue(true);
        expect(controller.currentLegalDirectCardUuids(player)).toEqual({ storied: true });
    });

    it('rejects stale selectable-card state on an explicit menu-only prompt', function() {
        const prompt = {
            promptTitle: 'Shosuro Hametsu', menuTitle: 'Select a card to reveal',
            selectCard: false, buttons: [{ text: 'Take nothing', arg: 'take-nothing' }]
        };
        const stale = { uuid: 'stale', type: 'event' };
        const player = makePlayer(prompt, [stale]);
        const controller = new JigokuBotController(makeGame(player, { cards: [stale] }), { playerName: player.name, seed: 1 }, jasmine.createSpy('runner'));

        expect(controller.isLegalCard(player, 'stale')).toBe(false);
    });

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

    it('draw-phase bid scales with honor to draw cards, ignoring hand size', function() {
        const policy = new JigokuBotPolicy('bid');
        // Hand size no longer matters — cards win games, so bid to draw them.
        expect(policy.decide(makeBidState(0, 10), 'Jigoku Bot').target).toBe('5'); // honor 10: max draw
        expect(policy.decide(makeBidState(7, 8), 'Jigoku Bot').target).toBe('5'); // honor 8: still max
        expect(policy.decide(makeBidState(0, 6), 'Jigoku Bot').target).toBe('3'); // honor 6: safe middle
        expect(policy.decide(makeBidState(7, 4), 'Jigoku Bot').target).toBe('3'); // honor 4: safe middle
        expect(policy.decide(makeBidState(0, 3), 'Jigoku Bot').target).toBe('1'); // honor 3: cliff, minimum
        expect(policy.decide(makeBidState(0, 2), 'Jigoku Bot').target).toBe('1');
    });

    it('bids a duel on the skill gap: max when ahead/even, 1 when hopeless, honor-gated when close', function() {
        const duelBidState = (gap, honor) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Honor Bid',
                    menuTitle: 'Choose your bid for the duel with Kakita Toshimoko',
                    buttons: bidButtons,
                    stats: { honor: honor },
                    cardPiles: { hand: [] }
                }
            }
        });
        const bid = (gap, honor) => new JigokuBotPolicy('duel-bid').decide(duelBidState(gap, honor), 'Jigoku Bot', { duelGap: gap }).target;
        // Comfortably ahead: bid only the MINIMUM that beats their max bid of 5.
        expect(bid(5, 10)).toBe('1'); // lead >=5 wins on any bid
        expect(bid(4, 10)).toBe('2'); // 6-gap
        expect(bid(2, 10)).toBe('4');
        expect(bid(1, 10)).toBe('5'); // gap 0-1 needs the full 5
        expect(bid(0, 10)).toBe('5'); // even: bid to equalize
        expect(bid(-4, 15)).toBe('1'); // unwinnable even at max: bank honor
        expect(bid(-6, 15)).toBe('1');
        expect(bid(-2, 15)).toBe('5'); // close + honor-rich: commit
        expect(bid(-2, 5)).toBe('1'); // close + honor-poor: bank honor
        expect(bid(2, 3)).toBe('1'); // near the cliff: never bleed honor
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

    it('caps the draw bid as the opponent climbs toward an honor victory', function() {
        const policy = new JigokuBotPolicy('bid-oppwin');
        // Opponent at 18+: bid the minimum so WE are the low bidder and DRAIN
        // them, denying the 25-honor win rather than feeding it.
        expect(policy.decide(
            makeBidState(0, 12, { handSize: 6, honor: 22 }),
            'Jigoku Bot',
            { roundNumber: 3 }
        ).target).toBe('1');

        // Opponent honor building (14-17): cap the feed at 2.
        expect(policy.decide(
            makeBidState(0, 12, { handSize: 6, honor: 15 }),
            'Jigoku Bot',
            { roundNumber: 3 }
        ).target).toBe('2');

        // Opponent NOT near the win: bid the full draw.
        expect(policy.decide(
            makeBidState(0, 12, { handSize: 6, honor: 12 }),
            'Jigoku Bot',
            { roundNumber: 3 }
        ).target).toBe('5');
    });

    it('keeps a 1-fate reserve in the dynasty phase, all-in only on the last play', function() {
        const char = (uuid) => ({
            uuid: uuid, id: uuid, name: uuid, type: 'character', isDynasty: true, facedown: false, selectable: true
        });
        const dynState = (fate, provCards) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', phase: 'dynasty', promptTitle: 'Action Window', menuTitle: 'Initiate an action',
                    buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                    stats: { fate: fate },
                    provinces: { one: provCards, two: [], three: [], four: [] },
                    cardPiles: { hand: [] }
                }
            }
        });
        // fate 2, a 1-cost and a 2-cost: play the 1-cost to keep a fate.
        const keep = new JigokuBotPolicy('dyn-keep').decide(
            dynState(2, [char('cheap'), char('pricey')]), 'Jigoku Bot', { dynastyCosts: { cheap: 1, pricey: 2 } });
        expect(keep.reason).toBe('play-dynasty-character');
        expect(keep.args[0]).toBe('cheap');

        // fate 1, two 1-cost characters: neither keeps the reserve, so pass.
        const reserve = new JigokuBotPolicy('dyn-reserve').decide(
            dynState(1, [char('a'), char('b')]), 'Jigoku Bot', { dynastyCosts: { a: 1, b: 1 } });
        expect(reserve.reason).toBe('dynasty-reserve-fate');

        // fate 1, a single 1-cost character: commit it (first-passer all-in).
        const allin = new JigokuBotPolicy('dyn-allin').decide(
            dynState(1, [char('only')]), 'Jigoku Bot', { dynastyCosts: { only: 1 } });
        expect(allin.reason).toBe('play-dynasty-character-allin');
        expect(allin.args[0]).toBe('only');
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

    it('Shameful Display honor menu: honors own when an own participant is unhonored', function() {
        // Bot defends its attacked Shameful Display province. Its own
        // participant can still be honored, so the follow-up menu chooses
        // Honor (own gains skill; the enemy gets the dishonor).
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Political Water Conflict',
                    menuTitle: 'Choose a character to:',
                    buttons: [
                        { text: 'Honor', arg: 'honor', uuid: 'h' },
                        { text: 'Dishonor', arg: 'dishonor', uuid: 'd' }
                    ],
                    cardPiles: {
                        cardsInPlay: [
                            { uuid: 'mine', name: 'Doji Challenger', type: 'character',
                                inConflict: true, isHonored: false,
                                militarySkillSummary: { stat: '0' }, politicalSkillSummary: { stat: '3' } }
                        ]
                    }
                }
            }
        };
        const decision = new JigokuBotPolicy('shameful-honor').decide(state, 'Jigoku Bot');
        expect(decision.command).toBe('menuButton');
        expect(decision.target).toBe('Honor');
    });

    it('Shameful Display honor menu: dishonors enemy when every own participant is already honored', function() {
        // No own participant can take the honor, so honoring would land on
        // the ENEMY. Choose Dishonor instead — the leftover dishonor hits the
        // opponent, and the honor no-ops on our already-honored character.
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Political Water Conflict',
                    menuTitle: 'Choose a character to:',
                    buttons: [
                        { text: 'Honor', arg: 'honor', uuid: 'h' },
                        { text: 'Dishonor', arg: 'dishonor', uuid: 'd' }
                    ],
                    cardPiles: {
                        cardsInPlay: [
                            { uuid: 'mine', name: 'Doji Challenger', type: 'character',
                                inConflict: true, isHonored: true,
                                militarySkillSummary: { stat: '0' }, politicalSkillSummary: { stat: '3' } }
                        ]
                    }
                }
            }
        };
        const decision = new JigokuBotPolicy('shameful-dishonor').decide(state, 'Jigoku Bot');
        expect(decision.command).toBe('menuButton');
        expect(decision.target).toBe('Dishonor');
    });

    it('Court Games (non-glory deck): honors own participant, else dishonors enemy', function() {
        const makeState = (isHonored) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Political Water Conflict',
                    menuTitle: 'Choose one',
                    buttons: [
                        { text: 'Honor a friendly character', arg: 'honor', uuid: 'h' },
                        { text: 'Dishonor an opposing character', arg: 'dishonor', uuid: 'd' }
                    ],
                    cardPiles: {
                        cardsInPlay: [
                            { uuid: 'mine', name: 'Togashi Mitsu', type: 'character',
                                inConflict: true, isHonored: isHonored,
                                militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' } }
                        ]
                    }
                }
            }
        });
        // Own participant can still be honored -> Honor a friendly.
        const honor = new JigokuBotPolicy('court-honor').decide(makeState(false), 'Jigoku Bot');
        expect(honor.target).toBe('Honor a friendly character');
        // Own participant already honored -> Dishonor an opposing.
        const dishonor = new JigokuBotPolicy('court-dishonor').decide(makeState(true), 'Jigoku Bot');
        expect(dishonor.target).toBe('Dishonor an opposing character');
    });

    it('Court Games dishonors the enemy when its eligible glory is higher', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Political Water Conflict', menuTitle: 'Choose one',
                    buttons: [
                        { text: 'Honor a friendly character', arg: 'honor', uuid: 'h' },
                        { text: 'Dishonor an opposing character', arg: 'dishonor', uuid: 'd' }
                    ],
                    cardPiles: { cardsInPlay: [{
                        uuid: 'mine', type: 'character', inConflict: true, isHonored: false,
                        glorySummary: { stat: '1' }
                    }] }
                },
                'Human': {
                    name: 'Human', cardPiles: { cardsInPlay: [{
                        uuid: 'enemy', type: 'character', inConflict: true, isDishonored: false,
                        glorySummary: { stat: '3' }
                    }] }
                }
            }
        };
        expect(new JigokuBotPolicy('court-high-glory').decide(state, 'Jigoku Bot').target)
            .toBe('Dishonor an opposing character');
    });

    it('Court Games glory profile dishonors when every own participant is already honored', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Political Water Conflict', menuTitle: 'Choose one',
                    buttons: [
                        { text: 'Honor a friendly character', arg: 'honor', uuid: 'h' },
                        { text: 'Dishonor an opposing character', arg: 'dishonor', uuid: 'd' }
                    ],
                    cardPiles: { cardsInPlay: [{
                        uuid: 'mine', type: 'character', inConflict: true, isHonored: true,
                        glorySummary: { stat: '3' }
                    }] }
                },
                Human: {
                    name: 'Human', cardPiles: { cardsInPlay: [{
                        uuid: 'enemy', type: 'character', inConflict: true, isDishonored: false,
                        glorySummary: { stat: '1' }
                    }] }
                }
            }
        };
        const profile = require('../../../build/server/game/bots/DeckProfiles.js')
            .profileFromStrategy({ glory: true });

        expect(new JigokuBotPolicy('glory-court-saturated').decide(
            state,
            'Jigoku Bot',
            { profile }
        ).target).toBe('Dishonor an opposing character');
    });

    it('declines a self fate-removal follow-up (A Legion of One recur/no-effect)', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Military Air Conflict',
                    menuTitle: 'Choose one',
                    buttons: [
                        { text: 'Remove 1 fate for no effect', arg: 'remove', uuid: 'r' },
                        { text: 'Done', arg: 'done', uuid: 'done' }
                    ],
                    cardPiles: { cardsInPlay: [] }
                }
            }
        };
        const decision = new JigokuBotPolicy('legion').decide(state, 'Jigoku Bot');
        expect(decision.command).toBe('menuButton');
        expect(decision.target).toBe('Done');
    });

    it('ready effects aim at an own BOWED character, never a ready own or the enemy', function() {
        const char = (uuid, mil, bowed) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: false,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [char('ownReady', 5, false), char('ownBowed', 3, true)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [char('enemyBowed', 9, true)] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['ready'], sourceIsMine: true, sourceCardId: 'hayaken-no-shiro' } };
        const decision = new JigokuBotPolicy('ready').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('ownBowed');
    });

    it('bow effects aim at a READY enemy, never one already bowed', function() {
        const char = (uuid, mil, bowed) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: false,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [char('ownReady', 4, false)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [char('enemyReady', 6, false), char('enemyBowedStrong', 9, true)] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['bow'], sourceIsMine: true, sourceCardId: 'kakita-dojo' } };
        const decision = new JigokuBotPolicy('bow').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('enemyReady');
    });

    it('Softskin attaches to the strongest BOWED enemy, not a ready one', function() {
        const char = (uuid, mil, bowed) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: false,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [char('own', 4, false)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [char('enemyReady', 9, false), char('enemyBowed', 5, true)] } }
            }
        };
        const ctx = {
            targetHint: { gameActions: ['attach'], sourceCardId: 'softskin', sourceIsMine: true },
            cardHint: (id) => id === 'softskin' ? { targetSide: 'enemy', conflictTypes: [], targetPreference: 'strongest' } : undefined
        };
        const decision = new JigokuBotPolicy('softskin').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('enemyBowed');
    });

    it('Pit Trap locks the strongest BOWED enemy so it stays bowed through regroup', function() {
        const char = (uuid, mil, bowed) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: false,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Water Conflict', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [char('own', 4, false)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [char('enemyReady', 9, false), char('enemyBowed', 5, true)] } }
            }
        };
        const ctx = {
            targetHint: { gameActions: ['attach'], sourceCardId: 'pit-trap', sourceIsMine: true },
            cardHint: (id) => id === 'pit-trap' ? { targetSide: 'enemy', conflictTypes: ['military'], targetPreference: 'strongest' } : undefined
        };
        const decision = new JigokuBotPolicy('pit-trap').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('enemyBowed');
    });

    it('does not attach to Kaiu Siege Force while another own body can carry it (tower)', function() {
        const char = (uuid, id, mil, fate) => ({
            uuid: uuid, name: uuid, id: id, type: 'character', selectable: true, bowed: false, inConflict: false,
            fate: fate, militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'BOT', promptTitle: 'Choose a character', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [char('siege', 'kaiu-siege-force', 7, 2), char('kisada', 'hida-kisada', 7, 2)] }
                },
                'Human': { name: 'Human', id: 'HUMAN', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['attach'], sourceCardId: 'fine-katana', sourceIsMine: true } };
        const decision = new JigokuBotPolicy('siege').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('kisada');
    });

    it('cancels an enemy-side debuff attachment when the opponent has no character', function() {
        const own = {
            uuid: 'own', name: 'own', type: 'character', selectable: true, bowed: false, inConflict: false,
            militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '0' }
        };
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'c' }],
                    cardPiles: { cardsInPlay: [own] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = {
            targetHint: { gameActions: ['attach'], sourceCardId: 'pacifism', sourceIsMine: true },
            cardHint: (id) => id === 'pacifism' ? { targetSide: 'enemy', conflictTypes: ['military'], targetPreference: 'strongest' } : undefined
        };
        const decision = new JigokuBotPolicy('pacifism-noenemy').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('menuButton');
        expect(decision.target).toBe('Cancel');
    });

    it('Golden Plains Outpost moves the strongest BOWED cavalry into the conflict', function() {
        const char = (uuid, mil, bowed, inConflict) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: !!inConflict,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [],
                    // ready home body (declarable normally, useless to move), plus
                    // two bowed home bodies — pick the strongest bowed one.
                    cardPiles: { cardsInPlay: [char('ownReady', 8, false), char('bowedWeak', 3, true), char('bowedStrong', 6, true)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['moveToConflict'], sourceCardId: 'golden-plains-outpost', sourceIsMine: true } };
        const decision = new JigokuBotPolicy('gpo').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('bowedStrong');
    });

    it('Golden Plains Outpost cancels rather than move a READY body into the conflict', function() {
        const char = (uuid, mil, bowed) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: false,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'c' }],
                    cardPiles: { cardsInPlay: [char('ownReady', 8, false)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['moveToConflict'], sourceCardId: 'golden-plains-outpost', sourceIsMine: true } };
        const decision = new JigokuBotPolicy('gpo-ready').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('menuButton');
        expect(decision.target).toBe('Cancel');
    });

    it('I Am Ready readies the strongest bowed CONFLICT participant with fate', function() {
        const char = (uuid, mil, bowed, inConflict, fate) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: !!inConflict, fate: fate,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [],
                    cardPiles: { cardsInPlay: [
                        char('homeTower', 9, true, false, 3),      // stronger but at home
                        char('fightWeak', 4, true, true, 1),       // participant, low fate ok
                        char('fightStrong', 7, true, true, 1)       // participant, strongest in fight
                    ] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['removeFate', 'ready'], sourceCardId: 'i-am-ready', sourceIsMine: true } };
        const decision = new JigokuBotPolicy('iar').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('fightStrong');
    });

    it('I Am Ready stands up a bowed HOME tower with spare fate when none fight', function() {
        const char = (uuid, mil, bowed, fate) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: false, fate: fate,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'c' }],
                    cardPiles: { cardsInPlay: [
                        char('cheapBody', 8, true, 1),   // strongest but only 1 fate — readying strips it
                        char('tower', 6, true, 2)         // spare fate (>1) — the safe tower pick
                    ] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['removeFate', 'ready'], sourceCardId: 'i-am-ready', sourceIsMine: true } };
        const decision = new JigokuBotPolicy('iar-home').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('tower');
    });

    it('attaches to a multi-fate TOWER over a ready non-tower body when not in a losing fight', function() {
        const char = (uuid, mil, bowed, fate) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: false, fate: fate,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [],
                    // ready 0-fate body out-skills the bowed 2-fate tower, but the
                    // permanent attachment should build the durable tower.
                    cardPiles: { cardsInPlay: [char('readyBody', 8, false, 0), char('tower', 4, true, 2)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = {
            targetHint: { gameActions: ['attach'], sourceCardId: 'spyglass', sourceIsMine: true },
            cardHint: (id) => id === 'spyglass' ? { targetSide: 'self', conflictTypes: [], targetPreference: 'strongest' } : undefined
        };
        const decision = new JigokuBotPolicy('tower-attach').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('tower');
    });

    it('keeps a pump on a READY participant (not a home tower) when losing the current conflict', function() {
        const char = (uuid, mil, bowed, inConflict, fate) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: !!inConflict, fate: fate,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            // Losing attack: the ready participant is the only body that can
            // swing THIS conflict — the home tower must not steal the pump.
            conflict: { type: 'military', attackingPlayerId: 'bot', attackerSkill: 3, defenderSkill: 7 },
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [],
                    cardPiles: { cardsInPlay: [char('participant', 5, false, true, 0), char('homeTower', 6, false, false, 3)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = {
            targetHint: { gameActions: ['attach'], sourceCardId: 'spyglass', sourceIsMine: true },
            cardHint: (id) => id === 'spyglass' ? { targetSide: 'self', conflictTypes: [], targetPreference: 'strongest' } : undefined
        };
        const decision = new JigokuBotPolicy('losing-attach').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('participant');
    });

    it('a ready effect stands up a bowed TOWER over a bowed non-tower home body', function() {
        const char = (uuid, mil, bowed, fate) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: bowed, inConflict: false, fate: fate,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [],
                    // bowed non-tower out-skills the bowed 2-fate tower, but the
                    // ready effect should stand up the tower (it fights again).
                    cardPiles: { cardsInPlay: [char('bowedBody', 9, true, 1), char('bowedTower', 5, true, 2)] }
                },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['ready'], sourceCardId: 'water-ring', sourceIsMine: true } };
        const decision = new JigokuBotPolicy('tower-ready').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('bowedTower');
    });

    it('plays free (0-cost) buffs to defend the stronghold even at 0 fate', function() {
        // Regression: an old `if(fate < 1) return pass` gate threw away the
        // whole conflict window at 0 fate, so the bot let its stronghold break
        // with Banzai!/Supernatural Storm (both cost 0) sitting in hand.
        const shugenja = (uuid, id, inConflict, bowed) => ({
            uuid: uuid, id: id, name: id, type: 'character', selectable: false,
            inConflict: inConflict, bowed: bowed,
            militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            conflict: {
                type: 'military', attackingPlayerId: 'HUMAN', defendingPlayerId: 'BOT',
                attackerSkill: 9, defenderSkill: 3
            },
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'BOT', promptTitle: 'Conflict Action Window',
                    buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                    stats: { fate: 0, honor: 14 },
                    // The stronghold's guarding province is under attack (no uuid
                    // so it is not itself a click candidate — isolates the buff).
                    strongholdProvince: [{ isProvince: true, type: 'province', inConflict: true, isBroken: false }],
                    provinces: { one: [], two: [], three: [], four: [] },
                    cardPiles: {
                        cardsInPlay: [
                            shugenja('c1', 'ethereal-dreamer', true, false),
                            shugenja('c2', 'isawa-kaede', false, true)
                        ],
                        hand: [
                            { uuid: 'aaa', id: 'banzai', name: 'Banzai!', type: 'event', isPlayableByMe: true,
                                militarySkillSummary: {}, politicalSkillSummary: {} },
                            { uuid: 'zzz', id: 'supernatural-storm', name: 'Supernatural Storm', type: 'event', isPlayableByMe: true,
                                militarySkillSummary: {}, politicalSkillSummary: {} }
                        ]
                    }
                },
                'HUMAN': { name: 'HUMAN', id: 'HUMAN', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { cardHint: (id) => getPlaybookEntry(id) };
        const decision = new JigokuBotPolicy('stronghold-buff').decide(state, 'Jigoku Bot', ctx);
        expect(decision.reason).toBe('play-conflict-card');
        expect(decision.target).toBe('Banzai!');
    });

    it('Cycle of Rebirth shuffles our OWN weakest province card, never the enemy or Mitsu', function() {
        const card = (uuid, id, mil) => ({
            uuid: uuid, id: id, name: uuid, type: 'character', selectable: true, bowed: false, inConflict: false,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'BOT', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a card',
                    buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'c' }],
                    cardPiles: { cardsInPlay: [card('weakOwn', 'togashi-initiate', 2), card('strongOwn', 'kitsuki-investigator', 6), card('mitsu', 'togashi-mitsu-2', 5)] }
                },
                'Human': { name: 'Human', id: 'HUMAN', cardPiles: { cardsInPlay: [card('enemy', 'crane', 3)] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['moveCard'], sourceCardId: 'cycle-of-rebirth', sourceIsMine: true } };
        const decision = new JigokuBotPolicy('cycle').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('weakOwn');
    });

    it('Way of the Dragon targets repeatable Dragon abilities, Mitsu first', function() {
        const card = (uuid, id) => ({
            uuid: uuid, id: id, name: id, type: 'character', selectable: true,
            militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '3' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'c' }],
                    cardPiles: { cardsInPlay: [card('ichi', 'togashi-ichi'), card('teacher', 'teacher-of-empty-thought'), card('mitsu', 'togashi-mitsu-2')] }
                }
            }
        };
        const decision = new JigokuBotPolicy('dragon-way-target').decide(state, 'Jigoku Bot', {
            strategy: deriveDeckStrategy(['high-house-of-light']),
            targetHint: { gameActions: ['attach'], sourceCardId: 'way-of-the-dragon', sourceIsMine: true }
        });
        expect(decision.args[0]).toBe('mitsu');
    });

    it('Let Go removes an attachment from the strongest enemy character', function() {
        const attachment = (uuid) => ({ uuid: uuid, id: uuid, name: uuid, type: 'attachment', selectable: true });
        const enemy = (uuid, skill, attached) => ({
            uuid: uuid, id: uuid, name: uuid, type: 'character', selectable: false,
            militarySkillSummary: { stat: String(skill) }, politicalSkillSummary: { stat: '0' },
            attachments: [attached]
        });
        const weakAttachment = attachment('weak-attachment');
        const strongAttachment = attachment('strong-attachment');
        const state = {
            players: {
                'Jigoku Bot': { name: 'Jigoku Bot', buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'c' }], cardPiles: { cardsInPlay: [] } },
                'Human': { name: 'Human', cardPiles: { cardsInPlay: [enemy('weak', 2, weakAttachment), enemy('strong', 6, strongAttachment)] } }
            }
        };
        const decision = new JigokuBotPolicy('let-go-enemy').decide(state, 'Jigoku Bot', {
            targetHint: { gameActions: ['discardFromPlay'], sourceCardId: 'let-go', sourceIsMine: true }
        });
        expect(decision.args[0]).toBe('strong-attachment');
    });

    it('Favorable Ground rescues a strong character from a losing non-stronghold conflict', function() {
        const character = (uuid, skill, inConflict) => ({
            uuid: uuid, id: uuid, name: uuid, type: 'character', selectable: true,
            bowed: false, inConflict: inConflict,
            militarySkillSummary: { stat: String(skill) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            conflict: { type: 'military', attackingPlayerId: 'human', defendingPlayerId: 'bot', attackerSkill: 8, defenderSkill: 3 },
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'c' }], stats: { conflictsRemaining: 1 },
                    cardPiles: { cardsInPlay: [character('tower', 6, true), character('home', 2, false)] },
                    strongholdProvince: [], provinces: { one: [], two: [], three: [], four: [] }
                },
                'Human': { name: 'Human', id: 'human', cardPiles: { cardsInPlay: [] }, strongholdProvince: [], provinces: { one: [], two: [], three: [], four: [] } }
            }
        };
        const policy = new JigokuBotPolicy('favorable-rescue');
        const target = policy.decide(state, 'Jigoku Bot', {
            strategy: deriveDeckStrategy(['high-house-of-light']),
            targetHint: { gameActions: ['sendHome', 'moveToConflict'], sourceCardId: 'favorable-ground', sourceIsMine: true }
        });
        expect(target.args[0]).toBe('tower');

        state.players['Jigoku Bot'].promptTitle = 'Military Air Conflict';
        state.players['Jigoku Bot'].menuTitle = 'Choose where to move Togashi Mitsu';
        state.players['Jigoku Bot'].buttons = [
            { text: 'Move Togashi Mitsu to the conflict', arg: 'in', uuid: 'in' },
            { text: 'Move Togashi Mitsu home', arg: 'home', uuid: 'home' }
        ];
        expect(policy.decide(state, 'Jigoku Bot').target).toBe('Move Togashi Mitsu home');
    });

    it('puts four fate on Mitsu and two on other cost-three/four Dragon characters', function() {
        const state = (cardId, cost) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Choose additional fate', menuTitle: '',
                    buttons: [0, 1, 2, 3, 4].map((amount) => ({ text: String(amount), arg: String(amount), uuid: String(amount) })),
                    stats: { fate: 10 }, cardPiles: { cardsInPlay: [] }
                }
            },
            context: { playCardId: cardId, playCost: cost, strategy: deriveDeckStrategy(['high-house-of-light']) }
        });
        const mitsu = state('togashi-mitsu-2', 4);
        expect(new JigokuBotPolicy('mitsu-fate').decide(mitsu, 'Jigoku Bot', mitsu.context).target).toBe('4');
        const teacher = state('teacher-of-empty-thought', 3);
        expect(new JigokuBotPolicy('teacher-fate').decide(teacher, 'Jigoku Bot', teacher.context).target).toBe('2');
    });

    it('Banzai! resolves twice for an honor when honor allows, declines near the cliff and the no-effect trap', function() {
        const menuState = (honor, choices) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose one',
                    buttons: choices.map((text, i) => ({ text: text, arg: 'a' + i, uuid: 'b' + i })),
                    stats: { honor: honor }, cardPiles: { cardsInPlay: [] }
                }
            }
        });
        const recur = ['Lose 1 honor to resolve this ability again', 'Done'];
        const trap = ['Lose 1 honor for no effect', 'Done'];
        expect(new JigokuBotPolicy('bz1').decide(menuState(10, recur), 'Jigoku Bot').target).toBe('Lose 1 honor to resolve this ability again');
        expect(new JigokuBotPolicy('bz2').decide(menuState(3, recur), 'Jigoku Bot').target).toBe('Done');
        expect(new JigokuBotPolicy('bz3').decide(menuState(10, trap), 'Jigoku Bot').target).toBe('Done');
    });

    it('A Legion of One removes a fate to resolve twice (+6), but declines the no-effect follow-up', function() {
        const menuState = (choices) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose one',
                    buttons: choices.map((text, i) => ({ text: text, arg: 'a' + i, uuid: 'b' + i })),
                    stats: { honor: 10 }, cardPiles: { cardsInPlay: [] }
                }
            }
        });
        const again = ['Remove 1 fate to resolve this ability again', 'Done'];
        const noEffect = ['Remove 1 fate for no effect', 'Done'];
        expect(new JigokuBotPolicy('leg1').decide(menuState(again), 'Jigoku Bot').target).toBe('Remove 1 fate to resolve this ability again');
        expect(new JigokuBotPolicy('leg2').decide(menuState(noEffect), 'Jigoku Bot').target).toBe('Done');
    });

    it('Time for War puts its weapon on the multi-fate tower, not the higher-skill throwaway', function() {
        const char = (uuid, mil, fate) => ({
            uuid: uuid, name: uuid, id: uuid, type: 'character', selectable: true, bowed: false, inConflict: false,
            fate: fate, militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'BOT', promptTitle: 'Choose a character', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [char('tower', 4, 2), char('throwaway', 8, 0)] }
                },
                'Human': { name: 'Human', id: 'HUMAN', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['selectCard'], sourceCardId: 'time-for-war', sourceIsMine: true } };
        const decision = new JigokuBotPolicy('tfw').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('tower');
    });

    it('sends our STRONGEST character into a duel the opponent initiated', function() {
        // The opponent initiates the duel, so the source is their card (not in
        // any duelAxes map). The `duel` action is HARMFUL and the old generic
        // path picked our WEAKEST; the general duel rule must send our strongest
        // on the duel axis instead.
        const char = (uuid, mil) => ({
            uuid: uuid, name: uuid, type: 'character', selectable: true, bowed: false, inConflict: true,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'BOT', promptTitle: 'Military Air Conflict', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [char('weak', 2), char('strong', 6)] }
                },
                'Human': { name: 'Human', id: 'HUMAN', cardPiles: { cardsInPlay: [] } }
            }
        };
        const ctx = { targetHint: { gameActions: ['duel'], sourceCardId: 'issue-a-challenge', sourceIsMine: false } };
        const decision = new JigokuBotPolicy('duel-defend').decide(state, 'Jigoku Bot', ctx);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('strong');
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

        it('water ring bows a ready enemy or readies a bowed friendly', function() {
            const policy = new JigokuBotPolicy('water-bow');
            expect(policy.decide(makeRingResolutionState(
                'Choose character to bow or unbow',
                [character('own-bowed', { bowed: true })],
                [character('enemy-ready')],
                [dontResolve]
            ), 'Jigoku Bot').args[0]).toBe('enemy-ready');

            // Ready is always positive for the bot, even with no conflicts left.
            const noConflicts = new JigokuBotPolicy('water-ready-no-conflicts');
            expect(noConflicts.decide(makeRingResolutionState(
                'Choose character to bow or unbow',
                [character('own-bowed', { bowed: true })],
                [],
                [dontResolve],
                { conflictsRemaining: 0 }
            ), 'Jigoku Bot').args[0]).toBe('own-bowed');

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

        it('water ring recognizes generic Offerings prompt and ranks combined skill', function() {
            const policy = new JigokuBotPolicy('water-combined-skill');
            const state = makeRingResolutionState(
                'Choose a character',
                [character('own-ready', { militarySkillSummary: { stat: '8' }, politicalSkillSummary: { stat: '8' } }),
                    character('own-bowed', { bowed: true, militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '3' } })],
                [character('enemy-strong', { militarySkillSummary: { stat: '5' }, politicalSkillSummary: { stat: '6' } }),
                    character('enemy-weak', { militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '1' } })],
                [dontResolve]
            );
            state.players['Jigoku Bot'].promptTitle = 'Water Ring';

            expect(policy.decide(state, 'Jigoku Bot').args[0]).toBe('enemy-strong');
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

    it('does not click a selected ring when the live prompt cannot legally toggle its conflict type', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Political Earth Conflict',
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
        };
        const policy = new JigokuBotPolicy('illegal-type-switch');
        const decision = policy.decide(state, 'Jigoku Bot', { legalRingElements: {} });

        expect(decision.command).toBe('facedownCardClicked');
        expect(decision.reason).toBe('attack-facedown-province');
    });

    describe('province attack priority', function() {
        const character = (uuid, mil = 4, pol = 4) => ({
            uuid: uuid, type: 'character', location: 'play area', bowed: false, inConflict: false,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: String(pol) }
        });
        const province = (uuid, id, location, strength, abilityClass = 'none', eminent = false) => ({
            uuid: uuid, id: id, name: id, isProvince: true, type: 'province', location: location,
            isBroken: false, facedown: false, eminent: eminent, provinceAbilityClass: abilityClass,
            strengthSummary: { stat: String(strength) }
        });
        const state = (provinces) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Military Air Conflict', menuTitle: 'Choose province to attack',
                    buttons: [], cardPiles: { cardsInPlay: [character('attacker')] }
                },
                Human: {
                    name: 'Human', cardPiles: { cardsInPlay: [] },
                    provinces: { one: [provinces[0]], two: [provinces[1]], three: [], four: [] }
                }
            }
        });

        it('prefers a same-strength province with no triggered ability over an action province', function() {
            const shameful = province('shameful', 'shameful-display', 'province 1', 3, 'action');
            const tsuma = province('tsuma', 'tsuma', 'province 2', 3, 'none');
            const decision = new JigokuBotPolicy('province-ability-priority').decide(
                state([shameful, tsuma]), 'Jigoku Bot');

            expect(decision.args[0]).toBe('tsuma');
        });

        it('prefers an eminent province before a weaker ordinary province', function() {
            const tsuma = province('tsuma', 'tsuma', 'province 1', 3, 'none');
            const eminent = province('watch', 'the-eternal-watch', 'province 2', 4, 'action', true);
            const decision = new JigokuBotPolicy('province-eminent-priority').decide(
                state([tsuma, eminent]), 'Jigoku Bot');

            expect(decision.args[0]).toBe('watch');
        });

        it('makes seed 5 treat hidden Public Forum as strength 6 for target priority', function() {
            const hiddenState = state([
                { facedown: true, location: 'province 1', isBroken: false },
                { facedown: true, location: 'province 2', isBroken: false }
            ]);
            const decision = new JigokuBotPolicy('province-public-forum-priority').decide(
                hiddenState,
                'Jigoku Bot',
                {
                    omniscient: {
                        oppName: 'Human', oppFate: 0, oppHand: [], unmodeledEvents: [],
                        oppProvinces: [
                            {
                                id: 'public-forum', name: 'Public Forum', location: 'province 1',
                                strength: 3, broken: false, facedown: true,
                                eminent: false, abilityClass: 'reaction'
                            },
                            {
                                id: 'shameful-display', name: 'Shameful Display', location: 'province 2',
                                strength: 4, broken: false, facedown: true,
                                eminent: false, abilityClass: 'action'
                            }
                        ]
                    }
                }
            );

            expect(decision.args[0]).toBe('province 2');
        });
    });

    it('uses a selectable card controller when the player summary omits that own card', function() {
        const ownTarget = {
            uuid: 'own-global-target', id: 'togashi-ichi', name: 'Togashi Ichi',
            type: 'character', location: 'play area', selectable: true,
            controller: { name: 'Jigoku Bot' },
            militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '4' }
        };
        const state = {
            selectableCards: [ownTarget],
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Court Games', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [] }
                },
                Human: { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const decision = new JigokuBotPolicy('controller-owned-target').decide(state, 'Jigoku Bot', {
            targetHint: {
                gameActions: ['dishonor'], sourceIsMine: false,
                sourceType: 'event', sourceCardId: 'court-games'
            },
            cardHint: (id) => getPlaybookEntry(id)
        });

        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('own-global-target');
    });

    it('resets attempted targets for a new prompt with the same Court Games title', function() {
        const ownTarget = {
            uuid: 'same-court-target', id: 'ethereal-dreamer', name: 'Ethereal Dreamer',
            type: 'character', location: 'play area', selectable: true,
            controller: { name: 'Jigoku Bot' },
            militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '3' }
        };
        const state = {
            selectableCards: [ownTarget],
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Court Games', menuTitle: 'Choose a character',
                    buttons: [], cardPiles: { cardsInPlay: [] }
                },
                Human: { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };
        const targetHint = {
            gameActions: ['dishonor'], sourceIsMine: false,
            sourceType: 'event', sourceCardId: 'court-games'
        };
        const policy = new JigokuBotPolicy('court-prompt-identity');

        expect(policy.decide(state, 'Jigoku Bot', { promptIdentity: 'court-one', targetHint }).args[0]).toBe('same-court-target');
        expect(policy.decide(state, 'Jigoku Bot', { promptIdentity: 'court-one', targetHint })).toBe(null);
        expect(policy.decide(state, 'Jigoku Bot', { promptIdentity: 'court-two', targetHint }).args[0]).toBe('same-court-target');
    });

    it('finishes a multi-card prompt after the live selector reaches its limit', function() {
        const state = {
            selectableCards: [{
                uuid: 'extra-card', id: 'banzai', name: 'Banzai!', type: 'event',
                location: 'hand', selectable: true
            }],
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Daidoji Harrier',
                    menuTitle: 'Choose two cards to reveal', selectCard: true,
                    buttons: [{ text: 'Done', arg: 'done', uuid: 'done-prompt' }],
                    cardPiles: { cardsInPlay: [] }
                },
                Human: { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };

        const decision = new JigokuBotPolicy('selection-limit').decide(state, 'Jigoku Bot', {
            promptIdentity: 'restoration-prompt', selectionReachedLimit: true
        });

        expect(decision.command).toBe('menuButton');
        expect(decision.target).toBe('Done');
        expect(decision.reason).toBe('finish-card-selection-limit');
    });

    it('ignores stale selectable cards on a button-only prompt', function() {
        const state = {
            selectableCards: [{
                uuid: 'stale-card', id: 'togashi-ichi', name: 'Togashi Ichi',
                type: 'character', location: 'play area', selectable: true
            }],
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Declare Conflict',
                    menuTitle: 'Do you wish to declare a conflict?', selectCard: false,
                    buttons: [
                        { text: 'Declare a conflict', arg: 0, uuid: 'declare-prompt' },
                        { text: 'Pass conflict opportunity', arg: 1, uuid: 'pass-prompt' }
                    ],
                    cardPiles: { cardsInPlay: [{
                        uuid: 'ready-attacker', id: 'togashi-ichi', name: 'Togashi Ichi',
                        type: 'character', location: 'play area', bowed: false,
                        militarySkillSummary: { stat: '3' },
                        politicalSkillSummary: { stat: '2' }
                    }] }
                },
                Human: { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };

        const decision = new JigokuBotPolicy('stale-selectable').decide(state, 'Jigoku Bot');

        expect(decision.command).toBe('menuButton');
        expect(decision.target).toBe('Declare a conflict');
        expect(decision.reason).toBe('declare-conflict-opportunity');
    });

    it('passes Tadakatsu\'s declaration menu when no ready character can attack', function() {
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Declare Conflict',
                    menuTitle: 'Do you wish to declare a conflict?', selectCard: false,
                    buttons: [
                        { text: 'Declare a conflict', arg: 0, uuid: 'declare-prompt' },
                        { text: 'Pass conflict opportunity', arg: 1, uuid: 'pass-prompt' }
                    ],
                    cardPiles: { cardsInPlay: [] }
                },
                Human: { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };

        const decision = new JigokuBotPolicy('tadakatsu-no-attacker').decide(state, 'Jigoku Bot');

        expect(decision.target).toBe('Pass conflict opportunity');
        expect(decision.reason).toBe('pass-no-attackers');
    });

    it('uses an engine-legal zero-skill attacker when it is the only way to finish declaration', function() {
        const zeroSkill = {
            uuid: 'zero-political', id: 'graceful-guardian', name: 'Graceful Guardian',
            type: 'character', location: 'play area', bowed: false, inConflict: false,
            militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '0' }
        };
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Political Water Conflict',
                    menuTitle: 'Choose attackers', buttons: [],
                    cardPiles: { cardsInPlay: [zeroSkill] }
                },
                Human: { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };

        const decision = new JigokuBotPolicy('zero-skill-attacker').decide(
            state,
            'Jigoku Bot',
            { legalDirectCardUuids: { 'zero-political': true } }
        );

        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('zero-political');
        expect(decision.reason).toBe('declare-zero-skill-attacker');
    });

    it('does not use reveal-card handling on Shosuro Hametsu menu choices', function() {
        const state = {
            selectableCards: [{
                uuid: 'stale-hand-card', id: 'fiery-madness', name: 'Fiery Madness',
                type: 'attachment', location: 'hand', selectable: true
            }],
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: 'Shosuro Hametsu',
                    menuTitle: 'Select a card to reveal', selectCard: false,
                    buttons: [
                        { text: 'Fiery Madness (3)', arg: 'fiery-madness', uuid: 'hametsu-prompt' },
                        { text: 'Take nothing', arg: 'take-nothing', uuid: 'hametsu-prompt' }
                    ],
                    cardPiles: { cardsInPlay: [] }
                },
                Human: { name: 'Human', cardPiles: { cardsInPlay: [] } }
            }
        };

        const decision = new JigokuBotPolicy('hametsu-menu').decide(state, 'Jigoku Bot');

        expect(decision.command).toBe('menuButton');
        expect(decision.command).not.toBe('cardClicked');
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

    it('attacks the stronghold instead of the fourth outer province after 3 breaks', function() {
        const brokenProvince = (location) => ({
            isProvince: true, type: 'province', location: location, isBroken: true
        });
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
                        one: [brokenProvince('province 1')],
                        two: [brokenProvince('province 2')],
                        three: [brokenProvince('province 3')],
                        four: [{ facedown: true, location: 'province 4', isBroken: false }]
                    },
                    strongholdProvince: [{ facedown: true, location: 'stronghold province', isBroken: false }]
                }
            }
        };

        const decision = new JigokuBotPolicy('stronghold-target').decide(state, 'Jigoku Bot');

        expect(decision.command).toBe('facedownCardClicked');
        expect(decision.args).toEqual(['stronghold province', 'Human', true]);
        expect(decision.reason).toBe('attack-facedown-stronghold');
    });

    it('commits every available attacker to an unreachable stronghold break', function() {
        const attacker = (uuid, inConflict = false) => ({
            uuid: uuid, name: uuid, type: 'character', location: 'play area',
            bowed: false, inConflict: inConflict,
            militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '0' }
        });
        const first = attacker('first');
        const second = attacker('second');
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Military Air Conflict',
                    menuTitle: 'Choose attackers - Attacker: 0 Defender: 0',
                    buttons: [
                        { text: 'Initiate Conflict', arg: 'done', uuid: 'done' },
                        { text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }
                    ],
                    stats: { honor: 10 },
                    cardPiles: { cardsInPlay: [first, second] }
                },
                'Human': {
                    name: 'Human',
                    cardPiles: {
                        cardsInPlay: [{
                            uuid: 'defender', type: 'character', bowed: false,
                            militarySkillSummary: { stat: '5' }, politicalSkillSummary: { stat: '0' }
                        }]
                    },
                    strongholdProvince: [{
                        isProvince: true, type: 'province', location: 'stronghold province',
                        inConflict: true, isBroken: false, strengthSummary: { stat: '5' }
                    }]
                }
            }
        };
        const profile = { attackCommitment: 'breakable-or-hold', attackKeepHome: 2 };
        const policy = new JigokuBotPolicy('stronghold-all-in');

        const firstDecision = policy.decide(state, 'Jigoku Bot', { profile: profile });
        expect(firstDecision.args[0]).toBe('first');
        expect(firstDecision.reason).toBe('declare-attacker');

        first.inConflict = true;
        state.players['Jigoku Bot'].menuTitle = 'Choose attackers - Attacker: 2 Defender: 0';
        const secondDecision = policy.decide(state, 'Jigoku Bot', { profile: profile });
        expect(secondDecision.args[0]).toBe('second');
        expect(secondDecision.reason).toBe('declare-attacker');
    });

    describe('two-broken-province conflict safety', function() {
        const broken = (location) => ({ isProvince: true, type: 'province', location: location, isBroken: true });
        const open = (location) => ({ isProvince: true, type: 'province', location: location, isBroken: false });
        const character = (uuid, mil, pol = 0) => ({
            uuid: uuid, name: uuid, type: 'character', location: 'play area', bowed: false, inConflict: false,
            militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: String(pol) }
        });
        const makeState = (conflictsRemaining = 2, opponentConflictsRemaining = 2) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', firstPlayer: true,
                    promptTitle: 'Military Air Conflict', menuTitle: 'Choose attackers',
                    buttons: [
                        { text: 'Initiate Conflict', arg: 'done', uuid: 'done' },
                        { text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }
                    ],
                    stats: {
                        honor: 10, conflictsRemaining: conflictsRemaining,
                        militaryRemaining: 1, politicalRemaining: conflictsRemaining > 1 ? 1 : 0
                    },
                    cardPiles: {
                        cardsInPlay: [character('tower', 10), character('body-a', 1), character('body-b', 1)]
                    },
                    provinces: {
                        one: [broken('province 1')], two: [broken('province 2')],
                        three: [open('province 3')], four: [open('province 4')]
                    },
                    strongholdProvince: [{
                        uuid: 'own-last', isProvince: true, type: 'province', location: 'stronghold province',
                        isBroken: false, strengthSummary: { stat: '4' }
                    }]
                },
                Human: {
                    name: 'Human', firstPlayer: false,
                    stats: {
                        conflictsRemaining: opponentConflictsRemaining,
                        militaryRemaining: 1,
                        politicalRemaining: opponentConflictsRemaining > 1 ? 1 : 0
                    },
                    cardPiles: { cardsInPlay: [character('enemy-a', 6), character('enemy-b', 6)] },
                    provinces: {
                        one: [open('province 1')], two: [open('province 2')],
                        three: [open('province 3')], four: [open('province 4')]
                    },
                    strongholdProvince: []
                }
            }
        });

        it('does not consume the sole safe defender on the first conflict opportunity', function() {
            const decision = new JigokuBotPolicy('two-broken-first-opportunity').decide(
                makeState(), 'Jigoku Bot', { profile: { attackCommitment: 'all', attackKeepHome: 0 } });

            expect(decision.args[0]).toBe('body-a');
            expect(decision.reason).toBe('declare-attacker');
        });

        it('releases the temporary reserve on the second conflict opportunity', function() {
            const decision = new JigokuBotPolicy('two-broken-second-opportunity').decide(
                makeState(1, 1), 'Jigoku Bot', { profile: { attackCommitment: 'all', attackKeepHome: 0 } });

            expect(decision.args[0]).toBe('tower');
            expect(decision.reason).toBe('declare-attacker');
        });

        it('may pass an unsafe first opportunity but still declares its second conflict', function() {
            const state = makeState();
            const me = state.players['Jigoku Bot'];
            me.promptTitle = 'Initiate Conflict';
            me.menuTitle = 'Choose an elemental ring';
            me.cardPiles.cardsInPlay = [character('only-defender', 10)];
            state.rings = { air: { element: 'air', claimed: false, unselectable: false, fate: 0 } };
            const policy = new JigokuBotPolicy('two-broken-delay-conflict');

            const delay = policy.decide(state, 'Jigoku Bot', {
                profile: { attackCommitment: 'all', attackKeepHome: 0 }
            });
            expect(delay.target).toBe('Pass Conflict');
            expect(delay.reason).toBe('two-broken-all-needed');

            me.stats.conflictsRemaining = 1;
            me.stats.politicalRemaining = 0;
            state.players.Human.stats.conflictsRemaining = 1;
            state.players.Human.stats.politicalRemaining = 0;
            const second = policy.decide(state, 'Jigoku Bot', {
                profile: { attackCommitment: 'all', attackKeepHome: 0 }
            });
            expect(second.command).toBe('ringClicked');
            expect(second.args[0]).toBe('air');
        });
    });

    describe('last-province attack defense', function() {
        const broken = (location) => ({
            isProvince: true, type: 'province', location: location, isBroken: true
        });
        const character = (uuid, mil, pol, overrides = {}) => ({
            uuid: uuid, name: uuid, type: 'character', location: 'play area',
            bowed: false, inConflict: false, covert: false,
            militarySkillSummary: { stat: String(mil) },
            politicalSkillSummary: { stat: String(pol) },
            ...overrides
        });
        const exposed = () => ({
            one: [broken('province 1')],
            two: [broken('province 2')],
            three: [broken('province 3')],
            four: [{ isProvince: true, type: 'province', location: 'province 4', isBroken: false }]
        });
        const makeState = (menuTitle, opponentCards, opponentStats = {}, opponentExposed = false) => ({
            rings: { air: { element: 'air', claimed: false, unselectable: false, fate: 0 } },
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', promptTitle: menuTitle.includes('elemental ring') ? 'Initiate Conflict' : 'Military Air Conflict',
                    menuTitle: menuTitle,
                    buttons: [
                        { text: 'Initiate Conflict', arg: 'done', uuid: 'done' },
                        { text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }
                    ],
                    stats: { honor: 10, conflictsRemaining: 1, militaryRemaining: 1, politicalRemaining: 1 },
                    cardPiles: { cardsInPlay: [character('strong', 6, 4), character('weak', 2, 2)] },
                    provinces: exposed(),
                    strongholdProvince: [{
                        uuid: 'last', isProvince: true, type: 'province', location: 'stronghold province',
                        isBroken: false, strengthSummary: { stat: '4' }
                    }]
                },
                Human: {
                    name: 'Human',
                    stats: {
                        conflictsRemaining: 1, militaryRemaining: 1, politicalRemaining: 0,
                        ...opponentStats
                    },
                    cardPiles: { cardsInPlay: opponentCards },
                    provinces: opponentExposed ? exposed() : { one: [], two: [], three: [], four: [] },
                    strongholdProvince: opponentExposed ? [{
                        facedown: true, location: 'stronghold province', isBroken: false
                    }] : []
                }
            }
        });

        it('passes the conflict and keeps every body when one defender cannot save the stronghold', function() {
            const state = makeState('Choose an elemental ring', [character('army', 12, 0)]);
            const decision = new JigokuBotPolicy('last-province-hold').decide(
                state, 'Jigoku Bot', { strongholdProvinceStrength: 4 });
            expect(decision.target).toBe('Pass Conflict');
            expect(decision.reason).toBe('stronghold-defense-uncertain');
        });

        it('uses the same stronghold plan on Tadakatsu\'s button-only declaration prompt', function() {
            const makeDeclarationPrompt = (opponentStats = {}) => {
                const state = makeState('Choose an elemental ring', [character('army', 12, 0)], opponentStats);
                const me = state.players['Jigoku Bot'];
                me.promptTitle = 'Declare Conflict';
                me.menuTitle = 'Do you wish to declare a conflict?';
                me.selectCard = false;
                me.buttons = [
                    { text: 'Declare a conflict', arg: 0, uuid: 'declare' },
                    { text: 'Pass conflict opportunity', arg: 1, uuid: 'pass' }
                ];
                return state;
            };

            const hold = new JigokuBotPolicy('tadakatsu-hold').decide(
                makeDeclarationPrompt(), 'Jigoku Bot', { strongholdProvinceStrength: 4 });
            expect(hold.target).toBe('Pass conflict opportunity');
            expect(hold.reason).toBe('stronghold-defense-uncertain');

            const finalOpportunity = new JigokuBotPolicy('tadakatsu-final').decide(
                makeDeclarationPrompt({ conflictsRemaining: 0, militaryRemaining: 0, politicalRemaining: 0 }),
                'Jigoku Bot',
                { strongholdProvinceStrength: 4 }
            );
            expect(finalOpportunity.target).toBe('Declare a conflict');
            expect(finalOpportunity.reason).toBe('declare-conflict-opportunity');
        });

        it('keeps the strongest defender and attacks with the remaining body', function() {
            const state = makeState('Choose attackers', [character('army', 9, 0)]);
            const decision = new JigokuBotPolicy('last-province-reserve').decide(
                state, 'Jigoku Bot', { strongholdProvinceStrength: 4 });
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('weak');
        });

        it('holds against covert even when visible skill would otherwise be safe', function() {
            const state = makeState('Choose an elemental ring', [character('scout', 2, 0, { covert: true })]);
            const decision = new JigokuBotPolicy('last-province-covert').decide(
                state, 'Jigoku Bot', { strongholdProvinceStrength: 8 });
            expect(decision.target).toBe('Pass Conflict');
            expect(decision.reason).toBe('stronghold-covert-risk');
        });

        it('commits all bodies on the final conflict opportunity', function() {
            const state = makeState('Choose attackers', [character('army', 20, 0)], {
                conflictsRemaining: 0, militaryRemaining: 0, politicalRemaining: 0
            });
            const policy = new JigokuBotPolicy('last-province-final-conflict');
            const first = policy.decide(state, 'Jigoku Bot', { strongholdProvinceStrength: 4 });
            expect(first.args[0]).toBe('strong');
            state.players['Jigoku Bot'].cardPiles.cardsInPlay[0].inConflict = true;
            const second = policy.decide(state, 'Jigoku Bot', { strongholdProvinceStrength: 4 });
            expect(second.args[0]).toBe('weak');
        });

        it('commits all bodies when both players have exposed strongholds', function() {
            const state = makeState('Choose attackers', [character('army', 20, 0)], {}, true);
            const policy = new JigokuBotPolicy('stronghold-race');
            const first = policy.decide(state, 'Jigoku Bot', { strongholdProvinceStrength: 4 });
            expect(first.args[0]).toBe('strong');
            state.players['Jigoku Bot'].cardPiles.cardsInPlay[0].inConflict = true;
            const second = policy.decide(state, 'Jigoku Bot', { strongholdProvinceStrength: 4 });
            expect(second.args[0]).toBe('weak');
        });

        it('seed 5 accounts for exact affordable boost and defender control', function() {
            const state = makeState('Choose an elemental ring', [character('army', 5, 5)]);
            const decision = new JigokuBotPolicy('last-province-omni').decide(state, 'Jigoku Bot', {
                strongholdProvinceStrength: 4,
                omniscient: {
                    oppName: 'Human', oppFate: 1, oppHand: [], oppProvinces: [], unmodeledEvents: [],
                    affordableDefenderDisables: 1,
                    handThreatMatrix: {
                        military: [{ budget: 1, skill: 2, spentFate: 1, cards: [], detail: '+2' }],
                        political: [{ budget: 1, skill: 2, spentFate: 1, cards: [], detail: '+2' }]
                    }
                }
            });
            expect(decision.target).toBe('Pass Conflict');
        });
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

    it('defends the stronghold province with every body, even when hopeless', function() {
        // Breaking the stronghold loses the game: the hopeless-fold and
        // sufficient-skill caps do not apply — every ready character defends.
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
        const state = {
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Military Air Conflict: 20 vs 0',
                    menuTitle: 'Choose defenders',
                    buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                    cardPiles: { cardsInPlay: [defender('guard-1', 3), defender('guard-2', 1)] },
                    strongholdProvince: [
                        { uuid: 'sh', type: 'stronghold', bowed: false },
                        { uuid: 'sh-prov', isProvince: true, inConflict: true, strengthSummary: { stat: '4' } }
                    ]
                }
            }
        };
        const policy = new JigokuBotPolicy('stronghold-defense');
        const first = policy.decide(state, 'Jigoku Bot');
        expect(first.command).toBe('cardClicked');
        expect(first.reason).toBe('stronghold-defense-all');
        expect(first.args[0]).toBe('guard-1');
        // Second body follows — no defense-sufficient cap at the stronghold.
        const second = policy.decide(state, 'Jigoku Bot');
        expect(second.command).toBe('cardClicked');
        expect(second.args[0]).toBe('guard-2');
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
                rings: options.rings || {
                    air: { element: 'air', fate: 0 },
                    earth: { element: 'earth', fate: 0 },
                    fire: { element: 'fire', fate: 0 },
                    void: { element: 'void', fate: 0 },
                    water: { element: 'water', fate: 0 }
                },
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
                            honor: options.honor !== undefined ? options.honor : 10,
                            conflictsRemaining: options.conflictsRemaining
                        },
                        cardsPlayedThisConflict: options.cardsPlayed || 0,
                        cardPiles: {
                            hand: options.hand || [],
                            dynastyDiscardPile: options.dynastyDiscard || [],
                            conflictDiscardPile: options.conflictDiscard || [],
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
                        stats: { conflictsRemaining: options.opponentConflictsRemaining },
                        cardsPlayedThisConflict: options.opponentCardsPlayed || 0,
                        cardPiles: { cardsInPlay: options.opponentCardsInPlay || [], hand: options.opponentHand || [] },
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

        [
            { name: 'heuristic', Policy: JigokuBotPolicy },
            { name: 'fate-aware', Policy: FateAwareJigokuBotPolicy }
        ].forEach(({ name, Policy }) => {
            const conflictCard = (uuid, id) => ({
                uuid: uuid,
                id: id,
                name: id,
                type: 'event',
                location: 'hand',
                isPlayableByMe: true
            });
            const hint = (priority) => (cardId) => ({
                cardId: cardId,
                useWhen: 'always',
                conflictTypes: [],
                targetSide: 'self',
                targetPreference: 'any',
                priority: priority,
                summary: ''
            });

            it(`cancels Storied Defeat before paying when only its own duel loser is legal (${name})`, function() {
                const ownLoser = {
                    uuid: 'own-loser', id: 'kakita-kaezin', name: 'Kakita Kaezin',
                    type: 'character', location: 'play area', selectable: true,
                    controller: { name: 'Jigoku Bot' }, bowed: false, inConflict: true,
                    militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' }
                };
                const state = {
                    players: {
                        'Jigoku Bot': {
                            name: 'Jigoku Bot',
                            promptTitle: 'Storied Defeat',
                            menuTitle: 'Choose a character',
                            selectCard: true,
                            buttons: [
                                { text: 'Pay costs first', arg: 'costsFirst', uuid: 'pay' },
                                { text: 'Cancel', arg: 'cancel', uuid: 'cancel' }
                            ],
                            cardPiles: { cardsInPlay: [ownLoser], hand: [] },
                            stats: { fate: 3, honor: 10 }
                        },
                        Opponent: {
                            name: 'Opponent',
                            cardPiles: { cardsInPlay: [] },
                            stats: { fate: 0, honor: 10 }
                        }
                    }
                };
                const decision = new Policy(`storied-pre-cost-${name}`).decide(
                    state,
                    'Jigoku Bot',
                    {
                        targetHint: {
                            gameActions: ['bow'],
                            sourceIsMine: true,
                            sourceType: 'event',
                            sourceCardId: 'storied-defeat'
                        },
                        cardHint: (cardId) => getPlaybookEntry(cardId)
                    }
                );

                expect(decision.target).toBe('Cancel');
                expect(decision.reason).toBe('cancel-wrong-side-target');
            });

            it(`prefers an equal-value free conflict card over a cost-2 card (${name})`, function() {
                const paid = conflictCard('aaa-paid', 'paid-pump');
                const free = conflictCard('zzz-free', 'free-pump');
                const decision = new Policy(`window-cost-efficiency-${name}`).decide(
                    makeConflictWindowState({
                        amAttacker: false,
                        attackerSkill: 4,
                        defenderSkill: 2,
                        fate: 2,
                        hand: [paid, free]
                    }),
                    'Jigoku Bot',
                    {
                        cardHint: hint(7),
                        conflictCosts: { 'aaa-paid': 2, 'zzz-free': 0 },
                        handStats: {
                            'aaa-paid': { military: 2, political: 2 },
                            'zzz-free': { military: 2, political: 2 }
                        }
                    }
                );

                expect(decision.command).toBe('cardClicked');
                expect(decision.args[0]).toBe('zzz-free');
            });

            it(`plans two efficient conflict cards instead of exhausting fate on one lower-total-value card (${name})`, function() {
                const expensive = conflictCard('aaa-expensive', 'expensive-pump');
                const cheapOne = conflictCard('bbb-cheap-one', 'cheap-pump-one');
                const cheapTwo = conflictCard('ccc-cheap-two', 'cheap-pump-two');
                const priorities = {
                    'expensive-pump': 8,
                    'cheap-pump-one': 7,
                    'cheap-pump-two': 7
                };
                const decision = new Policy(`window-multi-card-budget-${name}`).decide(
                    makeConflictWindowState({
                        amAttacker: false,
                        attackerSkill: 5,
                        defenderSkill: 1,
                        fate: 4,
                        hand: [expensive, cheapOne, cheapTwo]
                    }),
                    'Jigoku Bot',
                    {
                        cardHint: (cardId) => hint(priorities[cardId])(cardId),
                        conflictCosts: {
                            'aaa-expensive': 4,
                            'bbb-cheap-one': 2,
                            'ccc-cheap-two': 2
                        },
                        handStats: {
                            'aaa-expensive': { military: 2, political: 2 },
                            'bbb-cheap-one': { military: 2, political: 2 },
                            'ccc-cheap-two': { military: 2, political: 2 }
                        }
                    }
                );

                expect(decision.command).toBe('cardClicked');
                expect(decision.args[0]).toBe('bbb-cheap-one');
            });

            it(`keeps a priority-9 cost-2 answer ahead of weak free filler (${name})`, function() {
                const strategic = conflictCard('zzz-strategic', 'strategic-answer');
                const filler = conflictCard('aaa-filler', 'free-filler');
                const priorities = { 'strategic-answer': 9, 'free-filler': 5 };
                const decision = new Policy(`window-protect-value-${name}`).decide(
                    makeConflictWindowState({
                        amAttacker: false,
                        attackerSkill: 4,
                        defenderSkill: 2,
                        fate: 2,
                        hand: [filler, strategic]
                    }),
                    'Jigoku Bot',
                    {
                        cardHint: (cardId) => hint(priorities[cardId])(cardId),
                        conflictCosts: { 'zzz-strategic': 2, 'aaa-filler': 0 },
                        handStats: {
                            'zzz-strategic': { military: 2, political: 2 },
                            'aaa-filler': { military: 1, political: 1 }
                        }
                    }
                );

                expect(decision.command).toBe('cardClicked');
                expect(decision.args[0]).toBe('zzz-strategic');
            });

            it(`values an enemy skill debuff by its beneficial magnitude (${name})`, function() {
                const pump = { ...conflictCard('aaa-pump', 'small-pump'), type: 'attachment' };
                const debuff = { ...conflictCard('zzz-debuff', 'enemy-debuff'), type: 'attachment' };
                const decision = new Policy(`window-enemy-debuff-value-${name}`).decide(
                    makeConflictWindowState({
                        amAttacker: false,
                        attackerSkill: 4,
                        defenderSkill: 2,
                        fate: 1,
                        hand: [pump, debuff]
                    }),
                    'Jigoku Bot',
                    {
                        cardHint: (cardId) => ({
                            ...hint(8)(cardId),
                            targetSide: cardId === 'enemy-debuff' ? 'enemy' : 'self'
                        }),
                        conflictCosts: { 'aaa-pump': 1, 'zzz-debuff': 1 },
                        handStats: {
                            'aaa-pump': { military: 1, political: 1 },
                            'zzz-debuff': { military: -2, political: -2 }
                        }
                    }
                );

                expect(decision.command).toBe('cardClicked');
                expect(decision.args[0]).toBe('zzz-debuff');
            });

            it(`preserves the five-fate Consumed by Five Fires tower answer (${name})`, function() {
                const fiveFires = conflictCard('zzz-five-fires', 'consumed-by-five-fires');
                const free = conflictCard('aaa-free', 'banzai');
                const decision = new Policy(`window-five-fires-${name}`).decide(
                    makeConflictWindowState({
                        amAttacker: true,
                        attackerSkill: 1,
                        defenderSkill: 6,
                        fate: 5,
                        hand: [free, fiveFires],
                        strongholdProvince: [{
                            uuid: 'kyuden', id: 'kyuden-isawa', type: 'stronghold',
                            location: 'stronghold province', bowed: false
                        }],
                        conflictDiscard: [{
                            uuid: 'clarity-discard', id: 'clarity-of-purpose', type: 'event',
                            location: 'conflict discard pile', isPlayableByMe: true
                        }],
                        cardsInPlay: [{
                            uuid: 'adept', id: 'adept-of-the-waves', type: 'character',
                            bowed: false, inConflict: true,
                            militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '2' }
                        }],
                        opponentCardsInPlay: [{
                            uuid: 'enemy-tower', id: 'enemy-tower', type: 'character',
                            fate: 5, inConflict: true,
                            militarySkillSummary: { stat: '6' }, politicalSkillSummary: { stat: '6' }
                        }]
                    }),
                    'Jigoku Bot',
                    {
                        strategy: {
                            holdingEngine: false, defensive: false, aggressive: false,
                            dishonor: false, glory: false, monk: false, duelist: false,
                            shugenja: true, attachmentTower: false
                        },
                        cardHint: (cardId) => getPlaybookEntry(cardId),
                        conflictCosts: { 'zzz-five-fires': 5, 'aaa-free': 0 }
                    }
                );

                expect(decision.reason).toBe('five-fires-tower-removal');
                expect(decision.args[0]).toBe('zzz-five-fires');
            });

            it(`triggers priority-10 Display of Power before a lower-priority reaction (${name})`, function() {
                const lowerPriorityReaction = {
                    uuid: 'aaa-reaction',
                    id: 'minor-reaction',
                    name: 'Minor Reaction',
                    type: 'event',
                    location: 'hand',
                    selectable: true
                };
                const displayOfPower = {
                    uuid: 'zzz-display',
                    id: 'display-of-power',
                    name: 'Display of Power',
                    type: 'event',
                    location: 'hand',
                    selectable: true
                };
                const state = {
                    players: {
                        'Jigoku Bot': {
                            name: 'Jigoku Bot',
                            promptTitle: 'Triggered Abilities',
                            menuTitle: 'Any reactions?',
                            selectCard: true,
                            buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                            stats: { fate: 2 },
                            cardPiles: { hand: [lowerPriorityReaction, displayOfPower] }
                        }
                    }
                };
                const hints = {
                    'minor-reaction': hint(6)('minor-reaction'),
                    'display-of-power': hint(10)('display-of-power')
                };
                const decision = new Policy(`trigger-display-first-${name}`).decide(
                    state,
                    'Jigoku Bot',
                    {
                        cardHint: (cardId) => hints[cardId],
                        conflictCosts: { 'aaa-reaction': 0, 'zzz-display': 2 }
                    }
                );

                expect(decision.command).toBe('cardClicked');
                expect(decision.args[0]).toBe('zzz-display');
            });

            it(`does not pretend an in-play reaction has zero fate cost (${name})`, function() {
                const boardReaction = {
                    uuid: 'aaa-board-reaction',
                    id: 'board-reaction',
                    name: 'Board Reaction',
                    type: 'character',
                    location: 'play area',
                    selectable: true
                };
                const displayOfPower = {
                    uuid: 'zzz-display',
                    id: 'display-of-power',
                    name: 'Display of Power',
                    type: 'event',
                    location: 'hand',
                    selectable: true
                };
                const state = {
                    players: {
                        'Jigoku Bot': {
                            name: 'Jigoku Bot',
                            promptTitle: 'Triggered Abilities',
                            menuTitle: 'Any reactions?',
                            selectCard: true,
                            buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                            stats: { fate: 2 },
                            cardPiles: { hand: [displayOfPower], cardsInPlay: [boardReaction] }
                        }
                    }
                };
                const hints = {
                    'board-reaction': hint(9)('board-reaction'),
                    'display-of-power': hint(10)('display-of-power')
                };
                const decision = new Policy(`trigger-unknown-board-cost-${name}`).decide(
                    state,
                    'Jigoku Bot',
                    {
                        cardHint: (cardId) => hints[cardId],
                        conflictCosts: { 'zzz-display': 2 }
                    }
                );

                expect(decision.command).toBe('cardClicked');
                expect(decision.args[0]).toBe('zzz-display');
            });
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
            // The attacked province's own Conflict Action is still free value
            // (Fertile Fields draws, Meditations strips fate), so the FIRST
            // window click is the province; once attempted, Pass.
            const ownProvince = { isProvince: true, inConflict: true, uuid: 'my-prov', strengthSummary: { stat: '8' } };
            const policy = new JigokuBotPolicy('window-safe-loss');
            const state = makeConflictWindowState({
                amAttacker: false, attackerSkill: 5, defenderSkill: 0, hand: [playableCard], ownProvince: ownProvince
            });
            const first = policy.decide(state, 'Jigoku Bot');
            expect(first.command).toBe('cardClicked');
            expect(first.args[0]).toBe('my-prov');
            expect(policy.decide(state, 'Jigoku Bot').target).toBe('Pass');
        });

        it('spends cards on a hopeless defense when the STRONGHOLD is attacked', function() {
            // 12 vs 1 is normally a fold, but the stronghold breaking loses
            // the game — throw the hand at it.
            const policy = new JigokuBotPolicy('window-stronghold');
            const state = makeConflictWindowState({
                amAttacker: false, attackerSkill: 12, defenderSkill: 1, hand: [playableCard],
                strongholdProvince: [
                    { uuid: 'sh', type: 'stronghold', bowed: true },
                    { uuid: 'sh-prov', isProvince: true, inConflict: true, strengthSummary: { stat: '4' } }
                ]
            });
            // First click: the attacked province's free Conflict Action.
            expect(policy.decide(state, 'Jigoku Bot').args[0]).toBe('sh-prov');
            // Then the hand card — no hopeless fold at the stronghold.
            const play = policy.decide(state, 'Jigoku Bot');
            expect(play.command).toBe('cardClicked');
            expect(play.args[0]).toBe('event-1');
        });

        it('passes when hopelessly behind, or when no card is affordable', function() {
            const policy = new JigokuBotPolicy('window-hopeless');
            expect(policy.decide(makeConflictWindowState({
                amAttacker: false, attackerSkill: 12, defenderSkill: 1, hand: [playableCard]
            }), 'Jigoku Bot').target).toBe('Pass');

            // Affordability is the engine's call via isPlayableByMe: a card the
            // bot cannot pay for is marked unplayable and the window passes.
            // A 0-cost card stays isPlayableByMe and IS played even at 0 fate —
            // see the 'plays free (0-cost) buffs ...' spec.
            const broke = new JigokuBotPolicy('window-broke');
            const unaffordable = { uuid: 'event-1', name: 'Pump Event', type: 'event', location: 'hand', isPlayableByMe: false };
            expect(broke.decide(makeConflictWindowState({
                amAttacker: false, attackerSkill: 4, defenderSkill: 2, hand: [unaffordable], fate: 0
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

        it('starts a reachable Dragon threshold with Acolyte first and saves an unreachable hand', function() {
            const handCard = (id, type = 'event') => ({
                uuid: id + '-uuid', id: id, name: id, type: type, location: 'hand', isPlayableByMe: true
            });
            const monk = {
                uuid: 'monk', id: 'togashi-initiate', name: 'Togashi Initiate', type: 'character',
                location: 'play area', bowed: false, inConflict: true,
                militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '2' }
            };
            const stronghold = { uuid: 'high-house', id: 'high-house-of-light', name: 'High House of Light', type: 'stronghold', bowed: false };
            const context = {
                strategy: deriveDeckStrategy(['high-house-of-light']),
                cardHint: (id) => getPlaybookEntry(id)
            };
            // One Shintao virtual card plus four real playable cards reaches five.
            const reachable = makeConflictWindowState({
                amAttacker: true, attackerSkill: 2, defenderSkill: 3, cardsPlayed: 1,
                rings: { air: { element: 'air', fate: 1 } },
                cardsInPlay: [monk], strongholdProvince: [stronghold],
                opponentCardsInPlay: [{
                    uuid: 'enemy', id: 'enemy', type: 'character', bowed: false, inConflict: true,
                    militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '1' }
                }],
                hand: [
                    handCard('iron-foundations-stance'), handCard('swell-of-seafoam'),
                    handCard('void-fist'), handCard('hurricane-punch'), handCard('togashi-acolyte', 'character')
                ]
            });
            const reachablePolicy = new JigokuBotPolicy('dragon-reachable');
            expect(reachablePolicy.decide(reachable, 'Jigoku Bot', context).args[0]).toBe('monk');
            const first = reachablePolicy.decide(reachable, 'Jigoku Bot', context);
            expect(first.args[0]).toBe('togashi-acolyte-uuid');
            reachable.players['Jigoku Bot'].cardPiles.hand = reachable.players['Jigoku Bot'].cardPiles.hand
                .filter((card) => card.id !== 'togashi-acolyte');
            reachable.players['Jigoku Bot'].cardsPlayedThisConflict = 2;
            expect(reachablePolicy.decide(reachable, 'Jigoku Bot', context).args[0]).toBe('hurricane-punch-uuid');
            reachable.players['Jigoku Bot'].cardPiles.hand = reachable.players['Jigoku Bot'].cardPiles.hand
                .filter((card) => card.id !== 'hurricane-punch');
            reachable.players['Jigoku Bot'].cardsPlayedThisConflict = 3;
            expect(reachablePolicy.decide(reachable, 'Jigoku Bot', context).args[0]).toBe('void-fist-uuid');
            reachable.players['Jigoku Bot'].cardPiles.hand = reachable.players['Jigoku Bot'].cardPiles.hand
                .filter((card) => card.id !== 'void-fist');
            reachable.players['Jigoku Bot'].cardsPlayedThisConflict = 4;
            expect(reachablePolicy.decide(reachable, 'Jigoku Bot', context).args[0]).toBe('swell-of-seafoam-uuid');
            reachable.players['Jigoku Bot'].cardPiles.hand = reachable.players['Jigoku Bot'].cardPiles.hand
                .filter((card) => card.id !== 'swell-of-seafoam');
            reachable.players['Jigoku Bot'].cardsPlayedThisConflict = 5;
            expect(reachablePolicy.decide(reachable, 'Jigoku Bot', context).args[0]).toBe('high-house');
            expect(reachablePolicy.decide(reachable, 'Jigoku Bot', context).target).toBe('Pass');

            // Only three real cards remain: do not begin a five-card plan.
            const unreachable = makeConflictWindowState({
                amAttacker: true, attackerSkill: 2, defenderSkill: 3, cardsPlayed: 1,
                rings: { air: { element: 'air', fate: 1 } },
                cardsInPlay: [monk], strongholdProvince: [stronghold],
                hand: [
                    handCard('iron-foundations-stance'), handCard('swell-of-seafoam'),
                    handCard('hurricane-punch')
                ]
            });
            const savePolicy = new JigokuBotPolicy('dragon-save');
            expect(savePolicy.decide(unreachable, 'Jigoku Bot', context).args[0]).toBe('high-house');
            expect(savePolicy.decide(unreachable, 'Jigoku Bot', context).args[0]).toBe('monk');
            expect(savePolicy.decide(unreachable, 'Jigoku Bot', context).target).toBe('Pass');
        });

        it('uses High House protection without chasing five cards when rings have no fate', function() {
            const handCard = (id, type = 'event') => ({
                uuid: id + '-uuid', id: id, name: id, type: type, location: 'hand', isPlayableByMe: true
            });
            const monk = {
                uuid: 'plain-monk', id: 'plain-monk', name: 'Plain Monk', type: 'character',
                traits: ['monk'], location: 'play area', bowed: false, inConflict: true,
                militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '2' }
            };
            const stronghold = {
                uuid: 'high-house', id: 'high-house-of-light', name: 'High House of Light',
                type: 'stronghold', bowed: false
            };
            const state = makeConflictWindowState({
                amAttacker: true, attackerSkill: 2, defenderSkill: 3, cardsPlayed: 1,
                cardsInPlay: [monk], strongholdProvince: [stronghold],
                hand: [
                    handCard('iron-foundations-stance'), handCard('swell-of-seafoam'),
                    handCard('hurricane-punch'), handCard('togashi-acolyte', 'character')
                ]
            });
            const context = {
                strategy: deriveDeckStrategy(['high-house-of-light']),
                cardHint: (id) => getPlaybookEntry(id)
            };

            const decision = new JigokuBotPolicy('dragon-no-ring-fate').decide(state, 'Jigoku Bot', context);
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('high-house');
        });

        it('chases five and leads with a ring-fate producer when rings start empty', function() {
            const handCard = (id, type = 'event') => ({
                uuid: id + '-uuid', id: id, name: id, type: type, location: 'hand', isPlayableByMe: true
            });
            const monk = {
                uuid: 'plain-monk', id: 'plain-monk', name: 'Plain Monk', type: 'character',
                traits: ['monk'], location: 'play area', bowed: false, inConflict: true,
                militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '2' }
            };
            const state = makeConflictWindowState({
                amAttacker: true, attackerSkill: 2, defenderSkill: 3, cardsPlayed: 1,
                cardsInPlay: [monk],
                strongholdProvince: [{
                    uuid: 'high-house', id: 'high-house-of-light', name: 'High House of Light',
                    type: 'stronghold', bowed: false
                }],
                hand: [
                    handCard('written-in-the-stars'), handCard('iron-foundations-stance'),
                    handCard('hurricane-punch'), handCard('togashi-acolyte', 'character')
                ]
            });
            const context = {
                strategy: deriveDeckStrategy(['high-house-of-light']),
                cardHint: (id) => getPlaybookEntry(id)
            };

            const decision = new JigokuBotPolicy('dragon-project-ring-fate').decide(state, 'Jigoku Bot', context);
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('written-in-the-stars-uuid');
        });

        it('activates Dragon payoffs at threshold, then stops instead of playing extra cards', function() {
            const mitsu = {
                uuid: 'mitsu', id: 'togashi-mitsu-2', name: 'Togashi Mitsu', type: 'character',
                location: 'play area', bowed: false, inConflict: true,
                militarySkillSummary: { stat: '5' }, politicalSkillSummary: { stat: '5' }
            };
            const extra = { uuid: 'extra', id: 'banzai', name: 'Banzai!', type: 'event', location: 'hand', isPlayableByMe: true };
            const state = makeConflictWindowState({
                amAttacker: true, attackerSkill: 5, defenderSkill: 0,
                cardsPlayed: 5, cardsInPlay: [mitsu], hand: [extra]
            });
            const context = {
                strategy: deriveDeckStrategy(['high-house-of-light']),
                cardHint: (id) => getPlaybookEntry(id)
            };
            const policy = new JigokuBotPolicy('dragon-exact-stop');
            expect(policy.decide(state, 'Jigoku Bot', context).args[0]).toBe('mitsu');
            expect(policy.decide(state, 'Jigoku Bot', context).target).toBe('Pass');
        });

        it('keeps playing useful Kiho after the threshold while defending its stronghold', function() {
            const mitsu = {
                uuid: 'mitsu', id: 'togashi-mitsu-2', name: 'Togashi Mitsu', type: 'character',
                traits: ['monk'], location: 'play area', bowed: false, inConflict: true,
                militarySkillSummary: { stat: '5' }, politicalSkillSummary: { stat: '5' }
            };
            const handCard = (id, name) => ({
                uuid: id + '-uuid', id, name, type: 'event', location: 'hand', isPlayableByMe: true
            });
            const state = makeConflictWindowState({
                amAttacker: false,
                attackerSkill: 11,
                defenderSkill: 5,
                cardsPlayed: 5,
                cardsInPlay: [mitsu],
                strongholdProvince: [
                    { uuid: 'high-house', id: 'high-house-of-light', type: 'stronghold', bowed: true },
                    {
                        uuid: 'last-province', isProvince: true, type: 'province',
                        location: 'stronghold province', inConflict: true, isBroken: false,
                        strengthSummary: { stat: '4' }
                    }
                ],
                hand: [
                    handCard('swell-of-seafoam', 'Swell of Seafoam'),
                    handCard('iron-foundations-stance', 'Iron Foundations Stance')
                ]
            });
            const context = {
                strategy: deriveDeckStrategy(['high-house-of-light']),
                cardHint: (id) => getPlaybookEntry(id),
                legalDirectCardUuids: {
                    mitsu: true,
                    'swell-of-seafoam-uuid': true,
                    'iron-foundations-stance-uuid': true
                }
            };
            const policy = new JigokuBotPolicy('dragon-stronghold-kiho');

            // Threshold payoff ability first, then useful hand cards continue.
            expect(policy.decide(state, 'Jigoku Bot', context).args[0]).toBe('mitsu');
            const swell = policy.decide(state, 'Jigoku Bot', context);
            expect(swell.args[0]).toBe('swell-of-seafoam-uuid');
            state.players['Jigoku Bot'].cardPiles.hand.shift();
            const stance = policy.decide(state, 'Jigoku Bot', context);
            expect(stance.args[0]).toBe('iron-foundations-stance-uuid');
        });

        it('activates Togashi Ichi when both players have played ten cards total', function() {
            const ichi = {
                uuid: 'ichi', id: 'togashi-ichi', name: 'Togashi Ichi', type: 'character',
                location: 'play area', bowed: false, inConflict: true,
                militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '4' }
            };
            const state = makeConflictWindowState({
                amAttacker: true, attackerSkill: 4, defenderSkill: 2,
                cardsPlayed: 4, opponentCardsPlayed: 6, cardsInPlay: [ichi]
            });
            const decision = new JigokuBotPolicy('dragon-ichi-total').decide(state, 'Jigoku Bot', {
                strategy: deriveDeckStrategy(['high-house-of-light']),
                cardHint: (id) => getPlaybookEntry(id)
            });
            expect(decision.args[0]).toBe('ichi');
        });

        it('uses Teacher of Empty Thought twice when Way of the Dragon raises its limit', function() {
            const teacher = {
                uuid: 'teacher', id: 'teacher-of-empty-thought', name: 'Teacher of Empty Thought', type: 'character',
                location: 'play area', bowed: false, inConflict: true,
                attachments: [{ uuid: 'way', id: 'way-of-the-dragon', type: 'attachment' }],
                militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '3' }
            };
            const state = makeConflictWindowState({
                amAttacker: true, attackerSkill: 5, defenderSkill: 0,
                cardsPlayed: 3, cardsInPlay: [teacher]
            });
            const context = {
                strategy: deriveDeckStrategy(['high-house-of-light']),
                cardHint: (id) => getPlaybookEntry(id)
            };
            const policy = new JigokuBotPolicy('dragon-teacher-way');
            expect(policy.decide(state, 'Jigoku Bot', context).args[0]).toBe('teacher');
            expect(policy.decide(state, 'Jigoku Bot', context).args[0]).toBe('teacher');
            expect(policy.decide(state, 'Jigoku Bot', context).target).toBe('Pass');
        });

        it('uses Togashi Mitsu twice when Way of the Dragon raises its round limit', function() {
            const mitsu = {
                uuid: 'mitsu', id: 'togashi-mitsu-2', name: 'Togashi Mitsu', type: 'character',
                location: 'play area', bowed: false, inConflict: true,
                attachments: [{ uuid: 'way', id: 'way-of-the-dragon', type: 'attachment' }],
                militarySkillSummary: { stat: '5' }, politicalSkillSummary: { stat: '5' }
            };
            const state = makeConflictWindowState({
                amAttacker: true, attackerSkill: 5, defenderSkill: 0,
                cardsPlayed: 5, cardsInPlay: [mitsu]
            });
            const context = {
                strategy: deriveDeckStrategy(['high-house-of-light']),
                cardHint: (id) => getPlaybookEntry(id)
            };
            const policy = new JigokuBotPolicy('dragon-mitsu-way');
            expect(policy.decide(state, 'Jigoku Bot', context).args[0]).toBe('mitsu');
            expect(policy.decide(state, 'Jigoku Bot', context).args[0]).toBe('mitsu');
            expect(policy.decide(state, 'Jigoku Bot', context).target).toBe('Pass');
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

        it('honors highest-glory own characters and dishonors highest-glory enemies', function() {
            const own = new JigokuBotPolicy('honor-glory').decide(
                makeTargetState([
                    character('skill-6', 6, { glorySummary: { stat: '0' } }),
                    character('glory-3', 2, { glorySummary: { stat: '3' } }),
                    character('tower', 1, { fate: 2, glorySummary: { stat: '1' } })
                ], []),
                'Jigoku Bot',
                { targetHint: { gameActions: ['honor'], sourceIsMine: true } }
            );
            expect(own.args[0]).toBe('glory-3');

            const enemy = new JigokuBotPolicy('dishonor-glory').decide(
                makeTargetState([], [
                    character('skill-6', 6, { glorySummary: { stat: '0' } }),
                    character('glory-3', 2, { glorySummary: { stat: '3' } })
                ]),
                'Jigoku Bot',
                { targetHint: { gameActions: ['dishonor'], sourceIsMine: true } }
            );
            expect(enemy.args[0]).toBe('glory-3');
        });

        it('accepts a forced Court Games dishonor on its lowest-glory character', function() {
            const policy = new JigokuBotPolicy('court-games-forced-low-glory');
            const decision = policy.decide(
                makeTargetState([
                    character('prodigy', 3, {
                        inConflict: true,
                        politicalSkillSummary: { stat: '3' },
                        glorySummary: { stat: '2' }
                    }),
                    character('tsukune', 4, {
                        inConflict: true,
                        politicalSkillSummary: { stat: '4' },
                        glorySummary: { stat: '4' }
                    }),
                    character('dreamer', 3, {
                        inConflict: true,
                        politicalSkillSummary: { stat: '3' },
                        glorySummary: { stat: '0' }
                    })
                ], []),
                'Jigoku Bot',
                {
                    targetHint: {
                        gameActions: ['dishonor'], sourceIsMine: false,
                        sourceType: 'event', sourceCardId: 'court-games'
                    },
                    cardHint: (id) => getPlaybookEntry(id)
                }
            );

            expect(decision.args[0]).toBe('dreamer');
            expect(decision.reason).toBe('forced-dishonor-own-lowest-glory');
        });

        it('minimizes a forced honor placed on an enemy character', function() {
            const decision = new JigokuBotPolicy('forced-enemy-honor').decide(
                makeTargetState([], [
                    character('enemy-high', 5, { glorySummary: { stat: '4' } }),
                    character('enemy-zero', 1, { glorySummary: { stat: '0' } })
                ]),
                'Jigoku Bot',
                { targetHint: { gameActions: ['honor'], sourceIsMine: false } }
            );

            expect(decision.args[0]).toBe('enemy-zero');
            expect(decision.reason).toBe('forced-honor-enemy-lowest-glory');
        });

        it('resolves Ujina forced self-removal for the Phoenix glory profile instead of looping Cancel', function() {
            const state = makeTargetState([
                character('own-strong', 5),
                character('own-weak', 1)
            ], []);
            const profile = require('../../../build/server/game/bots/DeckProfiles.js')
                .profileFromStrategy({ glory: true });
            const decision = new JigokuBotPolicy('glory-ujina-forced').decide(
                state,
                'Jigoku Bot',
                {
                    profile,
                    targetHint: {
                        sourceCardId: 'isawa-ujina',
                        sourceIsMine: true,
                        gameActions: ['removeFromGame']
                    }
                }
            );

            expect(decision.args[0]).toBe('own-weak');
            expect(decision.reason).toBe('ujina-forced-own-weakest');
        });

        it('dishonors a participating enemy when the glory loss flips the conflict', function() {
            const state = makeTargetState(
                [character('own', 4, { politicalSkillSummary: { stat: '4' } })],
                [
                    character('participant', 2, {
                        inConflict: true,
                        politicalSkillSummary: { stat: '2' },
                        glorySummary: { stat: '2' }
                    }),
                    character('home-tower', 7, {
                        politicalSkillSummary: { stat: '7' },
                        glorySummary: { stat: '4' }
                    })
                ]
            );
            state.players['Jigoku Bot'].id = 'BOT';
            state.players.Human.id = 'HUMAN';
            state.conflict = {
                type: 'political',
                attackingPlayerId: 'BOT',
                attackerSkill: 4,
                defenderSkill: 5
            };

            const decision = new JigokuBotPolicy('dishonor-conflict-swing').decide(
                state,
                'Jigoku Bot',
                { targetHint: { gameActions: ['dishonor'], sourceIsMine: true } }
            );

            expect(decision.args[0]).toBe('participant');
            expect(decision.reason).toBe('dishonor-enemy-best-status-impact');
        });

        it('dishonors the highest-glory enemy at home when a participant cannot change the conflict', function() {
            const state = makeTargetState(
                [character('own', 1, { politicalSkillSummary: { stat: '1' } })],
                [
                    character('participant', 2, {
                        inConflict: true,
                        politicalSkillSummary: { stat: '2' },
                        glorySummary: { stat: '2' }
                    }),
                    character('home-tower', 7, {
                        politicalSkillSummary: { stat: '7' },
                        glorySummary: { stat: '4' }
                    })
                ]
            );
            state.players['Jigoku Bot'].id = 'BOT';
            state.players.Human.id = 'HUMAN';
            state.conflict = {
                type: 'political',
                attackingPlayerId: 'BOT',
                attackerSkill: 1,
                defenderSkill: 5
            };

            const decision = new JigokuBotPolicy('dishonor-home-value').decide(
                state,
                'Jigoku Bot',
                { targetHint: { gameActions: ['dishonor'], sourceIsMine: true } }
            );

            expect(decision.args[0]).toBe('home-tower');
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

        it('spreads Pacifism, Stolen Breath, and Softskin instead of stacking a duplicate', function() {
            [
                { id: 'pacifism', conflictTypes: ['military'] },
                { id: 'stolen-breath', conflictTypes: ['political'] },
                { id: 'softskin', conflictTypes: [] }
            ].forEach(({ id, conflictTypes }) => {
                const policy = new JigokuBotPolicy(`spread-${id}`);
                const decision = policy.decide(
                    makeAttachState([], [
                        character('strong-with-copy', 7, {
                            bowed: id === 'softskin',
                            politicalSkillSummary: { stat: id === 'stolen-breath' ? '7' : '0' },
                            attachments: [{ id: id }]
                        }),
                        character('weaker-without-copy', 3, {
                            bowed: id === 'softskin',
                            politicalSkillSummary: { stat: id === 'stolen-breath' ? '3' : '0' },
                            attachments: []
                        })
                    ]),
                    'Jigoku Bot',
                    {
                        targetHint: { gameActions: ['attach'], sourceIsMine: true, sourceCardId: id },
                        cardHint: (cardId) => cardId === id ? {
                            targetSide: 'enemy', conflictTypes: conflictTypes,
                            targetPreference: 'strongest'
                        } : undefined
                    }
                );
                expect(decision.args[0]).toBe('weaker-without-copy');
            });
        });

        it('aims conflict locks at matching specialists while treating progressively close stats as balanced', function() {
            const cases = [
                {
                    id: 'pacifism',
                    axis: 'military',
                    balanced: character('balanced-4-3', 4, {
                        politicalSkillSummary: { stat: '3' },
                        attachments: [{ id: 'stolen-breath' }]
                    }),
                    wrongSpecialist: character('political-6-10', 6, {
                        politicalSkillSummary: { stat: '10' }
                    })
                },
                {
                    id: 'stolen-breath',
                    axis: 'political',
                    balanced: character('balanced-10-7', 10, {
                        politicalSkillSummary: { stat: '7' },
                        attachments: [{ id: 'pacifism' }]
                    }),
                    wrongSpecialist: character('military-12-8', 12, {
                        politicalSkillSummary: { stat: '8' }
                    })
                }
            ];

            cases.forEach(({ id, axis, balanced, wrongSpecialist }) => {
                const decision = new JigokuBotPolicy(`focused-${id}`).decide(
                    makeAttachState([], [wrongSpecialist, balanced]),
                    'Jigoku Bot',
                    {
                        targetHint: { gameActions: ['attach'], sourceIsMine: true, sourceCardId: id },
                        cardHint: (cardId) => cardId === id ? {
                            targetSide: 'enemy', conflictTypes: [axis], targetPreference: 'strongest'
                        } : undefined
                    }
                );
                expect(decision.args[0]).toBe(balanced.uuid);
            });
        });

        it('cancels Stolen Breath rather than attaching it to military-focused Tengu Sensei', function() {
            const decision = new JigokuBotPolicy('stolen-breath-wrong-focus').decide(
                makeAttachState([], [
                    character('tengu-sensei', 4, {
                        politicalSkillSummary: { stat: '2' }, fate: 2
                    })
                ]),
                'Jigoku Bot',
                {
                    targetHint: { gameActions: ['attach'], sourceIsMine: true, sourceCardId: 'stolen-breath' },
                    cardHint: (id) => id === 'stolen-breath' ? {
                        targetSide: 'enemy', conflictTypes: ['political'], targetPreference: 'strongest'
                    } : undefined
                }
            );
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Cancel');
            expect(decision.reason).toBe('cancel-wrong-side-target');
        });

        it('holds a pre-conflict lock when every enemy has the opposite focus', function() {
            const tengu = character('tengu-sensei', 4, {
                politicalSkillSummary: { stat: '2' }, fate: 2
            });
            const state = makeAttachState([], [tengu]);
            state.players['Jigoku Bot'].phase = 'conflict';
            state.players['Jigoku Bot'].promptTitle = 'Action Window';
            state.players['Jigoku Bot'].menuTitle = 'Initiate an action';
            state.players['Jigoku Bot'].stats = { fate: 4 };
            state.players['Jigoku Bot'].buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            state.players['Jigoku Bot'].cardPiles.hand = [
                { uuid: 'stolen-breath-hand', id: 'stolen-breath', isPlayableByMe: true }
            ];

            const decision = new JigokuBotPolicy('hold-stolen-breath-wrong-focus').decide(
                state,
                'Jigoku Bot',
                {
                    strategy: deriveDeckStrategy(['kyuden-isawa']),
                    cardHint: (id) => getPlaybookEntry(id)
                }
            );
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Pass');
        });

        it('cancels a redundant debuff when every legal enemy already has that attachment', function() {
            ['pacifism', 'stolen-breath', 'softskin'].forEach((id) => {
                const policy = new JigokuBotPolicy(`saturated-${id}`);
                const decision = policy.decide(
                    makeAttachState([], [character('already-debuffed', 5, {
                        bowed: id === 'softskin',
                        attachments: [{ id: id }]
                    })]),
                    'Jigoku Bot',
                    {
                        targetHint: { gameActions: ['attach'], sourceIsMine: true, sourceCardId: id },
                        cardHint: (cardId) => cardId === id ? {
                            targetSide: 'enemy', conflictTypes: [], targetPreference: 'strongest'
                        } : undefined
                    }
                );
                expect(decision.command).toBe('menuButton');
                expect(decision.target).toBe('Cancel');
            });
        });

        it('does not start a saturated pre-conflict debuff from hand', function() {
            const enemy = character('enemy', 5, {
                politicalSkillSummary: { stat: '5' },
                attachments: [{ id: 'pacifism' }]
            });
            const state = makeAttachState([], [enemy]);
            state.players['Jigoku Bot'].phase = 'conflict';
            state.players['Jigoku Bot'].promptTitle = 'Action Window';
            state.players['Jigoku Bot'].menuTitle = 'Initiate an action';
            state.players['Jigoku Bot'].stats = { fate: 4 };
            state.players['Jigoku Bot'].buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            state.players['Jigoku Bot'].cardPiles.hand = [
                { uuid: 'pacifism-hand', id: 'pacifism', isPlayableByMe: true },
                { uuid: 'stolen-breath-hand', id: 'stolen-breath', isPlayableByMe: true }
            ];
            const decision = new JigokuBotPolicy('preconflict-spread').decide(
                state,
                'Jigoku Bot',
                {
                    strategy: deriveDeckStrategy(['city-of-the-open-hand']),
                    cardHint: (id) => getPlaybookEntry(id)
                }
            );
            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('stolen-breath-hand');
        });

        it('vetoes a pre-conflict debuff after its narrower legal target prompt cancels twice', function() {
            const policy = new JigokuBotPolicy('preconflict-cancel-veto');
            const parent = makeAttachState([], [character('apparently-open', 5)]);
            parent.players['Jigoku Bot'].phase = 'conflict';
            parent.players['Jigoku Bot'].promptTitle = 'Action Window';
            parent.players['Jigoku Bot'].menuTitle = 'Initiate an action';
            parent.players['Jigoku Bot'].stats = { fate: 4 };
            parent.players['Jigoku Bot'].buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            parent.players['Jigoku Bot'].cardPiles.hand = [
                { uuid: 'pacifism-hand', id: 'pacifism', name: 'Pacifism', isPlayableByMe: true }
            ];
            const playContext = {
                strategy: deriveDeckStrategy(['city-of-the-open-hand']),
                cardHint: (id) => getPlaybookEntry(id)
            };
            const saturatedTarget = makeAttachState([], [character('only-legal-target', 5, {
                attachments: [{ id: 'pacifism' }]
            })]);
            const targetContext = {
                targetHint: { gameActions: ['attach'], sourceIsMine: true, sourceCardId: 'pacifism' },
                cardHint: (id) => getPlaybookEntry(id)
            };

            expect(policy.decide(parent, 'Jigoku Bot', playContext).target).toBe('Pacifism');
            expect(policy.decide(saturatedTarget, 'Jigoku Bot', targetContext).reason).toBe('cancel-redundant-debuff-attachment');
            expect(policy.decide(parent, 'Jigoku Bot', playContext).target).toBe('Pacifism');
            expect(policy.decide(saturatedTarget, 'Jigoku Bot', targetContext).reason).toBe('cancel-redundant-debuff-attachment');

            const finalDecision = policy.decide(parent, 'Jigoku Bot', playContext);
            expect(finalDecision.command).toBe('menuButton');
            expect(finalDecision.target).toBe('Pass');
        });

        it('keeps paid Pacifism ahead of a weak free pre-conflict attachment', function() {
            const state = makeAttachState([], [character('enemy', 5)]);
            state.players['Jigoku Bot'].phase = 'conflict';
            state.players['Jigoku Bot'].promptTitle = 'Action Window';
            state.players['Jigoku Bot'].menuTitle = 'Initiate an action';
            state.players['Jigoku Bot'].stats = { fate: 3 };
            state.players['Jigoku Bot'].buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            state.players['Jigoku Bot'].cardPiles.hand = [
                { uuid: 'free-filler', id: 'free-filler', isPlayableByMe: true },
                { uuid: 'pacifism', id: 'pacifism', isPlayableByMe: true }
            ];
            const decision = new JigokuBotPolicy('preconflict-protect-pacifism').decide(
                state,
                'Jigoku Bot',
                {
                    strategy: deriveDeckStrategy(['city-of-the-open-hand']),
                    cardHint: (id) => id === 'free-filler' ? {
                        cardId: id, useWhen: 'always', conflictTypes: [], targetSide: 'enemy',
                        targetPreference: 'strongest', priority: 5, summary: '', preConflict: true
                    } : getPlaybookEntry(id),
                    conflictCosts: { 'free-filler': 0, pacifism: 2 }
                }
            );

            expect(decision.command).toBe('cardClicked');
            expect(decision.args[0]).toBe('pacifism');
        });

        it('spreads Restricted attachments across characters', function() {
            const policy = new JigokuBotPolicy('attach-restricted-spread');
            const decision = policy.decide(
                makeAttachState([
                    character('stacked-tower', 5, {
                        fate: 2,
                        attachments: [{ id: 'fine-katana' }]
                    }),
                    character('empty-body', 1, { attachments: [] })
                ], []),
                'Jigoku Bot',
                { targetHint: { gameActions: ['attach'], sourceIsMine: true, sourceCardId: 'daidoji-yari' } }
            );
            expect(decision.args[0]).toBe('empty-body');
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

    it('trades Endless Plains only against a real threat', function() {
        // Endless Plains breaks ITSELF as the cost of discarding an attacker
        // (of the opponent's choice) — firing it against a chump attack gives
        // away a province for nothing.
        const attacker = (fate, mil) => ({
            uuid: `attacker-${fate}-${mil}`, type: 'character', inConflict: true,
            fate: fate, militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
        });
        const makeState = (attackers, myCharacters = []) => ({
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot',
                    promptTitle: 'Triggered Abilities',
                    menuTitle: 'Any reactions?',
                    selectCard: true,
                    buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                    cardPiles: { cardsInPlay: myCharacters },
                    provinces: {
                        one: [{ uuid: 'plains', id: 'endless-plains', name: 'Endless Plains', isProvince: true, selectable: true, location: 'province 1' }],
                        two: [], three: [], four: []
                    }
                },
                'Human': {
                    name: 'Human',
                    cardPiles: { cardsInPlay: attackers }
                }
            }
        });
        const bigDefender = { uuid: 'wall', type: 'character', bowed: false, militarySkillSummary: { stat: '9' }, politicalSkillSummary: { stat: '0' } };

        // Chump attack the defense can stop: keep the province.
        const hold = new JigokuBotPolicy('plains-hold');
        expect(hold.decide(makeState([attacker(0, 2)], [bigDefender]), 'Jigoku Bot').target).toBe('Pass');

        // 2+ fate attacker: worth the trade.
        const fated = new JigokuBotPolicy('plains-fate');
        expect(fated.decide(makeState([attacker(2, 2)], [bigDefender]), 'Jigoku Bot').args[0]).toBe('plains');

        // 5+ military attacker: worth the trade.
        const big = new JigokuBotPolicy('plains-big');
        expect(big.decide(makeState([attacker(0, 5)], [bigDefender]), 'Jigoku Bot').args[0]).toBe('plains');

        // Hopeless defense: the province is lost anyway, take a body with it.
        const hopeless = new JigokuBotPolicy('plains-hopeless');
        expect(hopeless.decide(makeState([attacker(0, 4)], []), 'Jigoku Bot').args[0]).toBe('plains');
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

    describe('seed 3 LLM-driven policy', function() {
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
                { playerName: 'Jigoku Bot', seed: 3, llm: { enabled: false, consultTimeoutMs: 200 } },
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
                { playerName: 'Jigoku Bot', seed: 3, llm: { enabled: false, consultTimeoutMs: 200 } },
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

    it('forces every driven bot seed onto the stronghold after 3 outer breaks', function() {
        const runDrivenSeed = (seed) => {
            const attackPrompt = {
                promptTitle: 'Military Air Conflict',
                menuTitle: 'Choose province to attack',
                selectCard: true,
                buttons: []
            };
            let currentPrompt = attackPrompt;
            const player = {
                name: 'Jigoku Bot', left: false, disconnected: false,
                promptState: { selectableCards: [], selectableRings: [] },
                currentPrompt: () => currentPrompt
            };
            const broken = (location) => ({
                isProvince: true, type: 'province', location: location, isBroken: true
            });
            const state = {
                players: {
                    'Jigoku Bot': Object.assign({
                        name: 'Jigoku Bot', cardPiles: { cardsInPlay: [] }
                    }, attackPrompt),
                    'Human': {
                        name: 'Human',
                        provinces: {
                            one: [broken('province 1')],
                            two: [broken('province 2')],
                            three: [broken('province 3')],
                            four: [{ facedown: true, location: 'province 4', isBroken: false }]
                        },
                        strongholdProvince: [{ facedown: true, location: 'stronghold province', isBroken: false }]
                    }
                }
            };
            const game = makeGame(player, state);
            const planner = { chooseAction: jasmine.createSpy('chooseAction') };
            const evaluator = { pick: jasmine.createSpy('pick').and.returnValue(0) };
            const calls = [];
            const runner = (command, name, args) => {
                calls.push({ command: command, name: name, args: args });
                currentPrompt = { buttons: [] };
                state.players['Jigoku Bot'] = { name: 'Jigoku Bot', buttons: [] };
                return true;
            };
            const controller = new JigokuBotController(
                game,
                { playerName: 'Jigoku Bot', seed: seed, llm: { enabled: false } },
                runner,
                { planner: planner, evaluator: evaluator }
            );

            controller.tick();

            expect(calls.length).toBe(1);
            expect(calls[0].command).toBe('facedownCardClicked');
            expect(calls[0].args).toEqual(['stronghold province', 'Human', true]);
            expect(planner.chooseAction).not.toHaveBeenCalled();
            expect(evaluator.pick).not.toHaveBeenCalled();
        };

        runDrivenSeed(2);
        runDrivenSeed(3);
    });

    it('keeps seed 3 and seed 4 drivers out of exposed-stronghold defense decisions', function() {
        const runDrivenSeed = (seed) => {
            const prompt = {
                promptTitle: 'Initiate Conflict',
                menuTitle: 'Choose an elemental ring',
                buttons: [{ text: 'Pass Conflict', arg: 'pass', uuid: 'pass' }]
            };
            let currentPrompt = prompt;
            const player = {
                name: 'Jigoku Bot', left: false, disconnected: false,
                promptState: { selectableCards: [], selectableRings: [{ element: 'air' }] },
                currentPrompt: () => currentPrompt
            };
            const broken = (location) => ({
                isProvince: true, type: 'province', location: location, isBroken: true
            });
            const character = (uuid, military) => ({
                uuid: uuid, name: uuid, type: 'character', location: 'play area', bowed: false,
                militarySkillSummary: { stat: String(military) }, politicalSkillSummary: { stat: '0' }
            });
            const state = {
                rings: { air: { element: 'air', claimed: false, unselectable: false } },
                players: {
                    'Jigoku Bot': Object.assign({
                        name: 'Jigoku Bot',
                        stats: { conflictsRemaining: 1, militaryRemaining: 1, politicalRemaining: 1 },
                        cardPiles: { cardsInPlay: [character('defender', 5)] },
                        provinces: {
                            one: [broken('province 1')],
                            two: [broken('province 2')],
                            three: [broken('province 3')],
                            four: [{ isProvince: true, location: 'province 4', isBroken: false }]
                        },
                        strongholdProvince: [{
                            isProvince: true, type: 'province', location: 'stronghold province',
                            isBroken: false, strengthSummary: { stat: '4' }
                        }]
                    }, prompt),
                    Human: {
                        name: 'Human',
                        stats: { conflictsRemaining: 1, militaryRemaining: 1, politicalRemaining: 0 },
                        cardPiles: { cardsInPlay: [character('army', 12)] },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: []
                    }
                }
            };
            const game = makeGame(player, state);
            const planner = { chooseAction: jasmine.createSpy('chooseAction') };
            const evaluator = { pick: jasmine.createSpy('pick').and.returnValue(0) };
            const calls = [];
            const runner = (command, name, args) => {
                calls.push({ command: command, name: name, args: args });
                currentPrompt = { buttons: [] };
                state.players['Jigoku Bot'] = { name: 'Jigoku Bot', buttons: [] };
                return true;
            };
            const controller = new JigokuBotController(
                game,
                { playerName: 'Jigoku Bot', seed: seed, llm: { enabled: false } },
                runner,
                { planner: planner, evaluator: evaluator }
            );

            controller.tick();

            expect(calls.length).toBe(1);
            expect(calls[0].command).toBe('menuButton');
            expect(calls[0].args[0]).toBe('pass');
            expect(planner.chooseAction).not.toHaveBeenCalled();
            expect(evaluator.pick).not.toHaveBeenCalled();
        };

        runDrivenSeed(3);
        runDrivenSeed(4);
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
