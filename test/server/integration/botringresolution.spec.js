'use strict';

const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');

describe('bot ring resolution', function() {
    integration(function() {
        function botFor(test) {
            return new JigokuBotController(
                test.game,
                { playerName: test.player1.player.name, seed: 1, maxDecisionsPerTick: 1 },
                (command, playerName, args) => test.game[command](playerName, ...args) !== false
            );
        }

        function resolveRing(test, element, ticks = 8) {
            const controller = botFor(test);
            test.player1Object.resolveRingEffects(element);
            test.game.continue();
            for(let i = 0; i < ticks; i++) {
                if(controller.tick() === false) {
                    break;
                }
                test.game.continue();
            }
            return controller;
        }

        function dragonPlayer(options = {}) {
            return Object.assign({
                faction: 'dragon',
                stronghold: 'mountain-s-anvil-castle'
            }, options);
        }

        function attachWithoutCost(test, target, attachmentName) {
            const attachment = test.player1.findCardByName(attachmentName, 'hand');
            const context = test.game.getFrameworkContext(test.player1Object);
            context.source = attachment;
            test.game.actions.attach({ attachment }).resolve(target, context);
            test.game.continue();
            return attachment;
        }

        it('gains 2 honor with Air', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({ honor: 10 }),
                player2: { honor: 10 }
            });

            resolveRing(this, 'air');

            expect(this.player1Object.getTotalHonor()).toBe(12);
            expect(this.player2Object.getTotalHonor()).toBe(10);
        });

        it('takes 1 honor from a low-honor opponent with Air', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({ honor: 10 }),
                player2: { honor: 4 }
            });

            resolveRing(this, 'air');

            expect(this.player1Object.getTotalHonor()).toBe(11);
            expect(this.player2Object.getTotalHonor()).toBe(3);
        });

        it('draws a card and makes the opponent discard with Earth', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({ hand: [] }),
                player2: { hand: ['banzai'] }
            });
            const ownHandSize = this.player1Object.hand.size();
            const opponentHandSize = this.player2Object.hand.size();

            resolveRing(this, 'earth');

            expect(this.player1Object.hand.size()).toBe(ownHandSize + 1);
            expect(this.player2Object.hand.size()).toBe(opponentHandSize - 1);
        });

        it('honors its own character with Fire', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({ inPlay: ['togashi-mitsu'] }),
                player2: { inPlay: [] }
            });
            const togashiMitsu = this.player1.findCardByName('togashi-mitsu');

            resolveRing(this, 'fire');

            expect(togashiMitsu.isHonored).toBe(true);
        });

        it('dishonors an opponent character with Fire when it has no own target', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({ inPlay: [] }),
                player2: { inPlay: ['togashi-mitsu'] }
            });
            const togashiMitsu = this.player2.findCardByName('togashi-mitsu');

            resolveRing(this, 'fire');

            expect(togashiMitsu.isDishonored).toBe(true);
        });

        it('dishonors higher-glory Mitsu on the reported Tetsubo Fire board', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({
                    inPlay: [{ card: 'solitary-hero', fate: 2 }],
                    hand: ['tetsubo-of-blood']
                }),
                player2: {
                    inPlay: [{ card: 'togashi-mitsu', fate: 2 }]
                }
            });
            const solitaryHero = this.player1.findCardByName('solitary-hero');
            const togashiMitsu = this.player2.findCardByName('togashi-mitsu');
            attachWithoutCost(this, solitaryHero, 'tetsubo-of-blood');

            const controller = resolveRing(this, 'fire');

            expect(solitaryHero.isDishonored).toBe(false);
            expect(solitaryHero.isHonored).toBe(false);
            expect(togashiMitsu.isDishonored).toBe(true);
            expect(controller.trace.filter((entry) => entry.command === 'cardClicked')
                .map((entry) => entry.cardId)).toEqual(['togashi-mitsu']);
        });

        it('retries every unhonorable own character before dishonoring the enemy with Fire', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({
                    inPlay: ['togashi-mitsu', 'solitary-hero'],
                    hand: ['tetsubo-of-blood', 'tetsubo-of-blood']
                }),
                player2: { inPlay: ['doji-whisperer'] }
            });
            const ownMitsu = this.player1.findCardByName('togashi-mitsu');
            const solitaryHero = this.player1.findCardByName('solitary-hero');
            const enemyWhisperer = this.player2.findCardByName('doji-whisperer');
            attachWithoutCost(this, ownMitsu, 'tetsubo-of-blood');
            attachWithoutCost(this, solitaryHero, 'tetsubo-of-blood');

            const controller = resolveRing(this, 'fire', 12);

            expect(ownMitsu.isHonored).toBe(false);
            expect(ownMitsu.isDishonored).toBe(false);
            expect(solitaryHero.isHonored).toBe(false);
            expect(solitaryHero.isDishonored).toBe(false);
            expect(enemyWhisperer.isDishonored).toBe(true);
            expect(controller.trace.filter((entry) => entry.command === 'cardClicked')
                .map((entry) => entry.cardId)).toEqual([
                    'togashi-mitsu',
                    'solitary-hero',
                    'doji-whisperer'
                ]);
            expect(controller.trace.filter((entry) => entry.reason === 'fire-ring-retry-target').length).toBe(2);
        });

        it('honors another own character after rejecting an unhonorable Fire target', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({
                    inPlay: ['togashi-mitsu', 'doji-whisperer'],
                    hand: ['tetsubo-of-blood']
                }),
                player2: { inPlay: ['solitary-hero'] }
            });
            const ownMitsu = this.player1.findCardByName('togashi-mitsu');
            const ownWhisperer = this.player1.findCardByName('doji-whisperer');
            const enemyHero = this.player2.findCardByName('solitary-hero');
            attachWithoutCost(this, ownMitsu, 'tetsubo-of-blood');

            const controller = resolveRing(this, 'fire', 10);

            expect(ownMitsu.isHonored).toBe(false);
            expect(ownWhisperer.isHonored).toBe(true);
            expect(enemyHero.isDishonored).toBe(false);
            expect(controller.trace.filter((entry) => entry.command === 'cardClicked')
                .map((entry) => entry.cardId)).toEqual(['togashi-mitsu', 'doji-whisperer']);
            expect(controller.trace.filter((entry) => entry.reason === 'fire-ring-retry-target').length).toBe(1);
        });

        it('removes fate from an opponent character with Void', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({ inPlay: [{ card: 'solitary-hero', fate: 3 }] }),
                player2: { inPlay: [{ card: 'togashi-mitsu', fate: 1 }] }
            });
            const ownHero = this.player1.findCardByName('solitary-hero');
            const enemyMitsu = this.player2.findCardByName('togashi-mitsu');

            resolveRing(this, 'void');

            expect(ownHero.fate).toBe(3);
            expect(enemyMitsu.fate).toBe(0);
        });

        it('readies its own bowed character with Water', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({ inPlay: [{ card: 'togashi-mitsu', bowed: true, fate: 2 }] }),
                player2: { inPlay: [] }
            });
            const togashiMitsu = this.player1.findCardByName('togashi-mitsu');

            resolveRing(this, 'water');

            expect(togashiMitsu.bowed).toBe(false);
        });

        it('bows an opponent character with no fate using Water', function() {
            this.setupTest({
                phase: 'conflict',
                player1: dragonPlayer({ inPlay: [] }),
                player2: { inPlay: ['togashi-mitsu'] }
            });
            const togashiMitsu = this.player2.findCardByName('togashi-mitsu');

            resolveRing(this, 'water');

            expect(togashiMitsu.bowed).toBe(true);
        });
    });
});
