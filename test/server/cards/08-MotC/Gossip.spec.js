describe('Gossip', function() {
    integration(function() {
        describe('Gossip\'s ability', function () {
            beforeEach(function () {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        hand: ['gossip']
                    },
                    player2: {
                        inPlay: ['adept-of-the-waves'],
                        hand: ['against-the-waves', 'fine-katana', 'kami-unleashed'],
                        dynastyDiscard: ['hidden-moon-dojo', 'solemn-scholar']
                    }
                });

                this.adept = this.player2.findCardByName('adept-of-the-waves');
                this.againstTheWaves = this.player2.findCardByName('against-the-waves');
                this.fineKatana = this.player2.findCardByName('fine-katana');
                this.kamiUnleashed = this.player2.findCardByName('kami-unleashed');
            });

            it('should stop your opponent from playing events', function() {
                this.player1.clickCard('gossip');
                this.player1.chooseCardInPrompt(this.againstTheWaves.name, 'card-name');
                expect(this.player2).toHavePrompt('Action Window');
                this.player2.clickCard(this.againstTheWaves);
                expect(this.player2).toHavePrompt('Action Window');
            });

            it('opponent should not be able to play copies of attachments', function() {
                this.player1.clickCard('gossip');
                this.player1.chooseCardInPrompt(this.fineKatana.name, 'card-name');
                expect(this.player2).toHavePrompt('Action Window');
                this.player2.clickCard(this.fineKatana);
                expect(this.player2).toHavePrompt('Action Window');
            });

            it('opponent should not be able to play copies of characters', function() {
                this.player1.clickCard('gossip');
                this.player1.chooseCardInPrompt(this.kamiUnleashed.name, 'card-name');
                expect(this.player2).toHavePrompt('Action Window');
                this.player2.clickCard(this.kamiUnleashed);
                expect(this.player2).toHavePrompt('Action Window');
            });

            // The client draws the blocked card beside the player who cannot play it, so
            // the restricted player's own state has to carry the name.
            it('should publish the named card on the restricted player state', function() {
                this.player1.clickCard('gossip');
                this.player1.chooseCardInPrompt(this.fineKatana.name, 'card-name');

                const player2State = this.player2.player.getState(this.player2.player);
                expect(player2State.cannotPlayNamed).toBeDefined();
                expect(player2State.cannotPlayNamed.length).toBe(1);
                expect(player2State.cannotPlayNamed[0].name).toBe(this.fineKatana.name);
                expect(player2State.cannotPlayNamed[0].sourceId).toBe('gossip');
                expect(player2State.cannotPlayNamed[0].id).toBe('fine-katana');
                expect(player2State.cannotPlayNamed[0].packId).toBeDefined();

                const player1State = this.player1.player.getState(this.player1.player);
                expect(player1State.cannotPlayNamed).toBeUndefined();
            });

            it('should stop publishing the named card once the phase ends', function() {
                this.player1.clickCard('gossip');
                this.player1.chooseCardInPrompt(this.fineKatana.name, 'card-name');
                expect(this.player2.player.getState(this.player2.player).cannotPlayNamed.length).toBe(1);

                this.nextPhase();
                this.game.checkGameState(true);

                expect(this.player2.player.getState(this.player2.player).cannotPlayNamed).toBeUndefined();
            });

            it('should stop your opponent from playing characters of HMD', function() {
                this.solemnScholar = this.player2.placeCardInProvince('solemn-scholar', 'province 1');
                this.hiddenMoonDojo = this.player2.placeCardInProvince('hidden-moon-dojo', 'province 2');
                this.player1.clickCard('gossip');
                this.player1.chooseCardInPrompt(this.solemnScholar.name, 'card-name');
                expect(this.player2).toHavePrompt('Action Window');
                this.player2.clickCard(this.solemnScholar);
                expect(this.player2).toHavePrompt('Action Window');
            });
        });
    });
});

