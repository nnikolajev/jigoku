'use strict';

// Deck revision 0.5 of the Dragon attachment tower, driven through the REAL
// engine to the real prompt and answered by a real JigokuBotController.
//
// Every case here exists because the decision is invisible to a unit test:
// which prompt the engine actually opens, which card it presents as the
// ability source, and whether the bot's answer is accepted. Nothing is stubbed.

const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');

describe('bot Dragon attachments (scripted boards)', function() {
    integration(function() {
        function botFor(test) {
            return new JigokuBotController(
                test.game,
                { playerName: test.player1.player.name, seed: 1, maxDecisionsPerTick: 1 },
                (command, playerName, args) => test.game[command](playerName, ...args) !== false
            );
        }

        function runBot(test, controller, ticks = 20) {
            for(let i = 0; i < ticks; i++) {
                if(controller.tick() === false) {
                    return;
                }
                test.game.continue();
            }
        }

        // Iron Mountain Castle's cost-reduction INTERRUPT fires on every
        // attachment play and opens a prompt the scripted flow does not answer,
        // which desynchronises `noMoreActions`. These boards are about what
        // happens once the attachment is on, so attach it directly.
        function attachWithoutCost(test, target, attachmentName) {
            const attachment = test.player1.findCardByName(attachmentName, 'hand');
            const context = test.game.getFrameworkContext(test.player1Object);
            context.source = attachment;
            test.game.actions.attach({ attachment }).resolve(target, context);
            test.game.continue();
            return attachment;
        }

        // The deck profile is derived from the cards actually in the deck, so
        // the stronghold is what switches the attachment-tower playstyle on.
        function dragonTower(options = {}) {
            return Object.assign({
                faction: 'dragon',
                stronghold: 'iron-mountain-castle'
            }, options);
        }

        describe('Self-Understanding', function() {
            // The reaction is GRANTED to the bearer (`whileAttached` +
            // `gainAbility`), so the window offers the CHARACTER. Doomed
            // Shugenja has no printed triggered ability and therefore no
            // playbook entry — exactly the case that used to leave this card
            // unreachable, because the reaction filter keys on the bearer's own
            // hint.
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: dragonTower({
                        honor: 10,
                        fate: 10,
                        inPlay: ['doomed-shugenja'],
                        hand: ['self-understanding']
                    }),
                    player2: {
                        honor: 10,
                        inPlay: ['doji-whisperer']
                    }
                });
                this.shugenja = this.player1.findCardByName('doomed-shugenja');
                this.whisperer = this.player2.findCardByName('doji-whisperer');
            });

            it('resolves every claimed ring after its bearer wins', function() {
                this.player1.claimRing('air');
                attachWithoutCost(this, this.shugenja, 'self-understanding');
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.shugenja],
                    defenders: [],
                    type: 'political',
                    ring: 'water'
                });
                this.noMoreActions();

                const startingHonor = this.player1Object.getTotalHonor();
                expect(this.player1).toHavePrompt('Triggered Abilities');
                expect(this.player1).toBeAbleToSelect(this.shugenja);

                runBot(this, botFor(this));

                // The claimed Air ring resolves for its controller: +2 honor.
                expect(this.player1Object.getTotalHonor()).toBeGreaterThan(startingHonor);
            });
        });

        describe('Waterfall Tattoo', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: dragonTower({
                        fate: 10,
                        inPlay: ['niten-master'],
                        hand: ['waterfall-tattoo']
                    }),
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });
                this.niten = this.player1.findCardByName('niten-master');
                this.whisperer = this.player2.findCardByName('doji-whisperer');
            });

            it('readies its bowed bearer when the opponent reveals our province', function() {
                attachWithoutCost(this, this.niten, 'waterfall-tattoo');
                this.niten.bowed = true;
                this.game.checkGameState(true);
                this.noMoreActions();

                // Our own conflict opportunity comes first; pass it so the
                // opponent is the one who declares — their declaration REVEALS
                // the attacked province of ours, which is the trigger.
                this.player1.pass();
                this.game.continue();
                this.player2.clickPrompt('Pass');
                this.game.continue();
                this.initiateConflict({
                    attackers: [this.whisperer],
                    type: 'political',
                    ring: 'air'
                });
                this.game.continue();

                runBot(this, botFor(this));

                expect(this.niten.bowed).toBe(false);
            });
        });

        describe('Agasha Taiko', function() {
            it('protects one of our own provinces, never the opponent\'s', function() {
                this.setupTest({
                    phase: 'dynasty',
                    player1: dragonTower({
                        fate: 10,
                        dynastyDiscard: ['agasha-taiko'],
                        provinces: ['manicured-garden', 'pilgrimage',
                            'restoration-of-balance', 'city-of-the-rich-frog']
                    }),
                    player2: {
                        provinces: ['ancestral-lands', 'meditations-on-the-tao',
                            'shameful-display', 'elemental-fury']
                    }
                });
                const taiko = this.player1.placeCardInProvince('agasha-taiko', 'province 1');
                this.player1.clickCard(taiko);
                this.player1.clickPrompt('0');
                this.game.continue();

                // The bot answers both the reaction window and the province
                // pick that follows it.
                runBot(this, botFor(this));

                const protectedProvinces = this.player1Object.getProvinces()
                    .concat(this.player2Object.getProvinces())
                    .filter((province) => province.anyEffect &&
                        province.anyEffect('cannotBeAttacked'));
                expect(protectedProvinces.length).toBe(1);
                expect(protectedProvinces[0].controller).toBe(this.player1Object);
                // Pilgrimage is the top entry of the owner's list that this
                // deck actually runs (Public Forum is not in revision 0.5).
                expect(protectedProvinces[0].id).toBe('pilgrimage');
            });
        });

        describe('Agasha Shunsen', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: dragonTower({
                        fate: 10,
                        inPlay: ['agasha-shunsen', 'niten-master'],
                        conflictDeck: ['self-understanding', 'jade-tetsubo', 'ornate-fan',
                            'fine-katana', 'adopted-kin']
                    }),
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });
                this.shunsen = this.player1.findCardByName('agasha-shunsen');
                this.niten = this.player1.findCardByName('niten-master');
                this.whisperer = this.player2.findCardByName('doji-whisperer');
            });

            it('only ever attaches the tutored card to a body that keeps it', function() {
                this.player1.claimRing('air');
                this.player1.claimRing('fire');
                this.player1.claimRing('earth');
                this.niten.fate = 2;
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.shunsen, this.niten],
                    defenders: [],
                    type: 'military',
                    ring: 'water'
                });
                this.game.continue();

                runBot(this, botFor(this), 30);

                // A body with no fate is discarded in the fate phase and takes
                // the attachment with it, so a tutored card must never land on
                // one.
                const tutorable = ['self-understanding', 'jade-tetsubo', 'ornate-fan',
                    'fine-katana', 'adopted-kin'];
                for(const bearer of this.player1Object.cardsInPlay.toArray()) {
                    const tutored = (bearer.attachments || [])
                        .find((attachment) => tutorable.includes(attachment.id));
                    if(tutored) {
                        expect(bearer.fate).toBeGreaterThan(0);
                    }
                }
            });
        });
    });
});
