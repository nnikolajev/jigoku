'use strict';

// The four polarity rules, each on a hand-built board where BOTH sides are
// legal targets and the bot has to pick. The self-play field suite
// (botpolarityfield.spec.js) proves the invariant holds across whole games;
// these are the deterministic cases that say exactly which rule broke when it
// does not.
//
// Every scenario drives the real engine to the real target prompt and then
// hands that one decision to a real JigokuBotController. Nothing is stubbed,
// so a deck overlay hijacking the prompt or a card whose targets were
// misconfigured fails here the same way it would in a game.

const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const { EffectPolarityMonitor, formatViolations } = require('../../helpers/effectpolarity.js');

describe('bot effect polarity (scripted boards)', function() {
    integration(function() {
        // The bot always pilots player1 here, so "own" is player1's side.
        function botFor(test) {
            return new JigokuBotController(
                test.game,
                { playerName: test.player1.player.name, seed: 1, maxDecisionsPerTick: 1 },
                (command, playerName, args) => test.game[command](playerName, ...args) !== false
            );
        }

        // A target prompt opened before costs are paid answers "Pay costs
        // first" before it answers the target, so one tick is never enough.
        function runBot(test, controller, ticks = 6) {
            for(let i = 0; i < ticks; i++) {
                if(controller.tick() === false) {
                    return;
                }
                test.game.continue();
            }
        }

        function watch(test, controller) {
            return new EffectPolarityMonitor(test.game, {
                label: 'scenario',
                controllers: controller ? [controller] : [],
                seats: { [test.player1.player.name]: { deck: 'scenario' } }
            });
        }

        function expectClean(monitor) {
            expect(monitor.violations.length)
                .withContext(`wrong-side effect landings:\n${formatViolations(monitor.violations)}`)
                .toBe(0);
        }

        describe('bow', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['lion-s-pride-brawler', 'adept-of-the-waves']
                    },
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });

                this.brawler = this.player1.findCardByName('lion-s-pride-brawler');
                this.adept = this.player1.findCardByName('adept-of-the-waves');
                this.whisperer = this.player2.findCardByName('doji-whisperer');

                this.noMoreActions();
                this.initiateConflict({
                    type: 'military',
                    attackers: [this.brawler, this.adept],
                    defenders: [this.whisperer]
                });
                this.player2.pass();
                // "Bow a character" — any character whose military skill is at
                // most the Brawler's, which is both of ours and theirs.
                this.player1.clickCard(this.brawler);
            });

            it('offers both sides', function() {
                expect(this.player1).toBeAbleToSelect(this.adept);
                expect(this.player1).toBeAbleToSelect(this.whisperer);
            });

            it('bows the enemy character, never its own', function() {
                const controller = botFor(this);
                const monitor = watch(this, controller);

                runBot(this, controller);
                monitor.detach();

                expect(this.whisperer.bowed).toBe(true);
                expect(this.adept.bowed).toBe(false);
                expectClean(monitor);
            });
        });

        describe('ready', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        stronghold: 'hayaken-no-shiro',
                        inPlay: ['matsu-berserker']
                    },
                    player2: {
                        inPlay: ['ashigaru-levy', 'matsu-berserker']
                    }
                });

                this.mine = this.player1.findCardByName('matsu-berserker');
                this.theirs = this.player2.findCardByName('matsu-berserker');
                this.mine.bow();
                this.theirs.bow();

                // Hayaken no Shiro: bow itself to ready a Bushi costing less
                // than 3 — the card names no controller, so both are legal.
                this.player1.clickCard(this.player1.player.stronghold);
            });

            it('offers both sides', function() {
                expect(this.player1).toBeAbleToSelect(this.mine);
                expect(this.player1).toBeAbleToSelect(this.theirs);
            });

            it('readies its own bowed character, never the enemy', function() {
                const controller = botFor(this);
                const monitor = watch(this, controller);

                runBot(this, controller);
                monitor.detach();

                expect(this.mine.bowed).toBe(false);
                expect(this.theirs.bowed).toBe(true);
                expectClean(monitor);
            });
        });

        describe('dishonor', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['doji-kuwanan'],
                        hand: ['way-of-the-scorpion']
                    },
                    player2: {
                        inPlay: ['midnight-builder']
                    }
                });

                this.kuwanan = this.player1.findCardByName('doji-kuwanan');
                this.builder = this.player2.findCardByName('midnight-builder');
                this.wayOfTheScorpion = this.player1.findCardByName('way-of-the-scorpion');

                this.noMoreActions();
                this.initiateConflict({
                    type: 'military',
                    attackers: [this.kuwanan],
                    defenders: [this.builder]
                });
                this.player2.pass();
                // "Dishonor a participating character" — any participant that
                // is not Scorpion, so both sides are legal.
                this.player1.clickCard(this.wayOfTheScorpion);
            });

            it('offers both sides', function() {
                expect(this.player1).toBeAbleToSelect(this.kuwanan);
                expect(this.player1).toBeAbleToSelect(this.builder);
            });

            it('dishonors the enemy character, never its own', function() {
                const controller = botFor(this);
                const monitor = watch(this, controller);

                runBot(this, controller);
                monitor.detach();

                expect(this.builder.isDishonored).toBe(true);
                expect(this.kuwanan.isDishonored).toBe(false);
                expectClean(monitor);
            });
        });

        describe('honor', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['doji-whisperer']
                    },
                    player2: {
                        inPlay: ['midnight-builder']
                    }
                });

                this.whisperer = this.player1.findCardByName('doji-whisperer');
                this.builder = this.player2.findCardByName('midnight-builder');
                this.shamefulDisplay = this.player1.findCardByName('shameful-display', 'province 1');

                // Player1 owns the province, so player1 resolves it — which
                // means player2 has to be the attacker.
                this.noMoreActions();
                this.player1.passConflict();
                this.noMoreActions();
                this.initiateConflict({
                    province: this.shamefulDisplay,
                    ring: 'air',
                    type: 'political',
                    attackers: [this.builder],
                    defenders: [this.whisperer]
                });
                // Player1 owns the province, so player1 resolves it: pick both
                // characters, then answer the honor half.
                this.player1.clickCard(this.shamefulDisplay);
                this.player1.clickCard(this.whisperer);
                this.player1.clickCard(this.builder);
                this.player1.clickPrompt('Done');
                this.player1.clickPrompt('Honor');
            });

            it('asks which character takes the honor', function() {
                expect(this.player1).toHavePrompt('Choose a character to honor');
            });

            it('honors its own character, never the enemy', function() {
                const controller = botFor(this);
                const monitor = watch(this, controller);

                runBot(this, controller);
                monitor.detach();

                expect(this.whisperer.isHonored).toBe(true);
                expect(this.builder.isHonored).toBe(false);
                expectClean(monitor);
            });
        });
    });
});
