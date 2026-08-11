const JigokuBotController = require('../../../../build/server/game/bots/JigokuBotController.js');

/**
 * Ceaseless Duty is the one leave-play save whose printed text has NO "a
 * character you control" clause, so the engine legally offers it on the
 * OPPONENT's departing body (see CeaselessDuty.spec.js). Iron Mine and Reprieve
 * both carry that clause and are never offered there.
 *
 * Live game: during the opponent's fate-phase discard the bot answered with
 * Ceaseless Duty and kept an enemy Meddling Mediator in play, spending a card
 * to improve the opponent's board. The bot must decline a save it cannot own
 * the payoff of, while still firing it on its own bodies.
 */
describe('Ceaseless Duty - bot save targeting', function() {
    integration(function() {
        beforeEach(function() {
            this.setupTest({
                phase: 'conflict',
                player1: {
                    inPlay: ['doji-whisperer'],
                    hand: ['ceaseless-duty', 'assassination']
                },
                player2: {
                    inPlay: ['dazzling-duelist'],
                    hand: ['i-can-swim']
                }
            });

            this.whisperer = this.player1.findCardByName('doji-whisperer');
            this.duty = this.player1.findCardByName('ceaseless-duty');
            this.assassination = this.player1.findCardByName('assassination');
            this.dazzling = this.player2.findCardByName('dazzling-duelist');
            this.swim = this.player2.findCardByName('i-can-swim');

            // I Can Swim only reaches a dishonored character, and only while
            // its controller bid higher.
            this.whisperer.dishonor();
            this.player1.player.showBid = 1;
            this.player2.player.showBid = 5;

            this.noMoreActions();
            this.initiateConflict({
                attackers: [this.whisperer],
                defenders: [this.dazzling],
                type: 'military'
            });

            this.bot = () => new JigokuBotController(
                this.game,
                { playerName: this.player1.player.name, seed: 1, maxDecisionsPerTick: 1 },
                (command, playerName, args) => this.game[command](playerName, ...args) !== false
            );
        });

        describe('when the OPPONENT\'s character would leave play', function() {
            beforeEach(function() {
                this.player2.pass();
                this.player1.clickCard(this.assassination);
                this.player1.clickCard(this.dazzling);
            });

            it('offers the save (the card has no controller clause)', function() {
                expect(this.player1).toBeAbleToSelect(this.duty);
            });

            it('does not spend Ceaseless Duty to keep an enemy body alive', function() {
                this.bot().tick();

                expect(this.dazzling.location).toBe('dynasty discard pile');
                expect(this.duty.location).toBe('hand');
            });
        });

        describe('when OUR OWN character would leave play', function() {
            beforeEach(function() {
                this.player2.clickCard(this.swim);
                this.player2.clickCard(this.whisperer);
            });

            it('offers the save', function() {
                expect(this.player1).toBeAbleToSelect(this.duty);
            });

            it('still fires Ceaseless Duty to keep the body', function() {
                this.bot().tick();

                expect(this.whisperer.location).toBe('play area');
                expect(this.duty.location).toBe('conflict discard pile');
            });
        });
    });
});
