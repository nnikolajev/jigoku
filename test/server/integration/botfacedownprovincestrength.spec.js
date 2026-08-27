'use strict';

// A province's own persistent effects are switched OFF while it is facedown:
// `Effect.isEffectActive()` gates on `source.facedown`. Every province in the
// field until now printed a fixed strength, so that never mattered — but The
// Roar of the Lioness prints "Strength: X. X is equal to half the amount of
// honor in your honor pool, rounded up", and a facedown one reads as strength
// 0 from the engine.
//
// The bot plans against its OWN provinces, which are known information, and the
// number it needs is the one the province will have when the attack that
// reveals it arrives. A stronghold province is only attackable after three
// outer provinces break, so it is facedown for almost the whole game — the
// exact case this deck wants the card in.
//
// Nothing is stubbed: a real game, a real registered Effect, a real controller.

const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');

describe('bot reading of a facedown province whose strength is an effect', function() {
    integration(function() {
        beforeEach(function() {
            this.setupTest({
                phase: 'conflict',
                player1: {
                    inPlay: ['soshi-illusionist']
                },
                player2: {
                    role: 'seeker-of-air',
                    provinces: ['the-roar-of-the-lioness'],
                    honor: 15
                }
            });
            this.roar = this.player2.findCardByName('the-roar-of-the-lioness');
            this.bot = new JigokuBotController(
                this.game,
                { playerName: this.player2.player.name, seed: 1, maxDecisionsPerTick: 1 },
                (command, playerName, args) => this.game[command](playerName, ...args) !== false
            );
            this.setFacedown = (facedown) => {
                this.roar.facedown = facedown;
                this.game.checkGameState(true);
            };
        });

        it('reads the honor-derived strength once the province is faceup', function() {
            this.setFacedown(false);
            expect(this.roar.getStrength()).toBe(8);
            expect(this.bot.liveProvinceStrength(this.roar)).toBe(8);
        });

        it('reads the same strength while the province is still facedown', function() {
            this.setFacedown(true);
            // The engine deliberately reports 0: the card's ability is off.
            expect(this.roar.getStrength()).toBe(0);
            expect(this.bot.liveProvinceStrength(this.roar)).toBe(8);
        });

        it('tracks the honor total that defines the strength', function() {
            this.setFacedown(true);
            this.player2.player.honor = 21;
            expect(this.bot.liveProvinceStrength(this.roar)).toBe(11);
            this.player2.player.honor = 4;
            expect(this.bot.liveProvinceStrength(this.roar)).toBe(2);
        });

        it('leaves a facedown province with no strength effect alone', function() {
            const target = this.player2.player.getProvinces()
                .find((card) => card.isProvince && card !== this.roar);
            target.facedown = true;
            this.game.checkGameState(true);
            expect(this.bot.liveProvinceStrength(target)).toBe(target.getStrength());
        });
    });
});
