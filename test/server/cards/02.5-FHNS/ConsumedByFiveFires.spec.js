describe('Consumed by Five Fires', function() {
    integration(function() {
        beforeEach(function() {
            this.setupTest({
                phase: 'conflict',
                player1: {
                    fate: 5,
                    inPlay: ['solemn-scholar'],
                    hand: ['consumed-by-five-fires']
                },
                player2: {
                    inPlay: ['tengu-sensei', 'iron-crane-legion']
                }
            });

            this.fires = this.player1.findCardByName('consumed-by-five-fires');
            this.tengu = this.player2.findCardByName('tengu-sensei');
            this.legion = this.player2.findCardByName('iron-crane-legion');
            this.tengu.fate = 1;
            this.legion.fate = 4;
        });

        it('can remove all five fate split 1 and 4 between two characters', function() {
            this.player1.clickCard(this.fires);
            this.player1.clickCard(this.tengu);
            this.player1.clickPrompt('1');
            this.player1.clickCard(this.legion);

            expect(this.player1).toHavePrompt('How much fate do you want to remove?');
            expect(this.player1).toHavePromptButton('4');
            this.player1.clickPrompt('4');

            expect(this.tengu.fate).toBe(0);
            expect(this.legion.fate).toBe(0);
            expect(this.getChatLogs(1)).toContain(
                'player1 chooses to: take 1 fate from Tengu Sensei and take 4 fate from Iron Crane Legion'
            );
        });
    });
});
