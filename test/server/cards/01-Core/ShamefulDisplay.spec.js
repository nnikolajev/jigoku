const JigokuBotController = require('../../../../build/server/game/bots/JigokuBotController.js');

describe('Shameful Display', function() {
    integration(function() {
        describe('nested honor selection metadata', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['doji-kuwanan']
                    },
                    player2: {
                        inPlay: ['midnight-builder']
                    }
                });
                this.kuwanan = this.player1.findCardByName('doji-kuwanan');
                this.midnightBuilder = this.player2.findCardByName('midnight-builder');
                this.shamefulDisplay = this.player2.findCardByName('shameful-display', 'province 1');
                this.midnightBuilder.dishonor();
                this.noMoreActions();
                this.initiateConflict({
                    province: this.shamefulDisplay,
                    ring: 'air',
                    type: 'military',
                    attackers: [this.kuwanan],
                    defenders: [this.midnightBuilder]
                });
                this.player2.clickCard(this.shamefulDisplay);
                this.player2.clickCard(this.midnightBuilder);
                this.player2.clickCard(this.kuwanan);
                this.player2.clickPrompt('Done');
                this.player2.clickPrompt('Honor');
            });

            it('lets the bot honor its dishonored character instead of a stronger enemy', function() {
                expect(this.player2).toHavePrompt('Choose a character to honor');
                const controller = new JigokuBotController(
                    this.game,
                    { playerName: this.player2.player.name, seed: 1, maxDecisionsPerTick: 1 },
                    (command, playerName, args) => this.game[command](playerName, ...args) !== false
                );

                expect(controller.currentTargetHint(this.player2.player)).toEqual(jasmine.objectContaining({
                    gameActions: ['honor'],
                    sourceCardId: 'shameful-display',
                    sourceIsMine: true
                }));
                expect(controller.tick()).toBe(true);
                expect(this.midnightBuilder.isDishonored).toBe(false);
                expect(this.kuwanan.isDishonored).toBe(true);
                expect(this.kuwanan.isHonored).toBe(false);
            });
        });
    });
});
