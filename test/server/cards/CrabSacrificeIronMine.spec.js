/**
 * Crab "Berserker Sacrifice": what actually survives when a SAVE cancels the
 * sacrifice.
 *
 * The deck runs three Iron Mine, three Reprieve and three Ceaseless Duty, all
 * of which replace a friendly character's leave-play. The open question for the
 * bot is which sacrifice payoffs still pay when the body does not actually
 * leave, because "sacrifice the big body, keep it, bank the payoff" is only a
 * plan for the payoffs that survive.
 *
 * Every sacrifice OUTLET in this deck spends the body as a COST
 * (`AbilityDsl.costs.sacrifice`), so the answers here are the rule for the
 * whole deck, not card trivia.
 */
describe('Crab Berserker Sacrifice - Iron Mine cancelling a sacrifice', function() {
    integration(function() {
        describe('a sacrifice paid as a COST (Silent Skirmisher)', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['silent-skirmisher', 'gallant-quartermaster'],
                        dynastyDiscard: ['iron-mine']
                    },
                    player2: {
                        inPlay: ['steward-of-cryptic-lore']
                    }
                });
                this.ironMine = this.player1.placeCardInProvince('iron-mine', 'province 1');
                this.silentSkirmisher = this.player1.findCardByName('silent-skirmisher');
                this.quartermaster = this.player1.findCardByName('gallant-quartermaster');
                this.steward = this.player2.findCardByName('steward-of-cryptic-lore');

                this.noMoreActions();
                this.initiateConflict({
                    type: 'military',
                    attackers: [this.silentSkirmisher, this.quartermaster],
                    defenders: [this.steward]
                });
                this.player2.pass();

                this.baseMilitary = this.silentSkirmisher.militarySkill;
                this.baseFate = this.player1.player.fate;

                this.player1.clickCard(this.silentSkirmisher);
                this.player1.clickCard(this.quartermaster);
            });

            it('offers Iron Mine on the cost sacrifice', function() {
                expect(this.player1).toBeAbleToSelect(this.ironMine);
            });

            describe('when Iron Mine cancels it', function() {
                beforeEach(function() {
                    this.player1.clickCard(this.ironMine);
                });

                it('keeps the sacrificed character in play', function() {
                    expect(this.quartermaster.location).toBe('play area');
                });

                it('sacrifices Iron Mine instead', function() {
                    expect(this.ironMine.location).toBe('dynasty discard pile');
                });

                // THE question. The official ruling is that a prevented
                // sacrifice means the cost was never paid, so the ability does
                // not initiate. This asserts what THIS engine actually does.
                it('does NOT apply the +2 military: the cost was never paid', function() {
                    expect(this.silentSkirmisher.militarySkill).toBe(this.baseMilitary);
                });

                it('does NOT pay Gallant Quartermaster: no sacrifice happened', function() {
                    expect(this.player1.player.fate).toBe(this.baseFate);
                });
            });

            describe('when Iron Mine is declined', function() {
                beforeEach(function() {
                    // The leave-play opens one interrupt window per interested
                    // ability (the save, then Gallant Quartermaster's own).
                    // Decline the SAVE, then take the Quartermaster payoff.
                    this.player1.clickPrompt('Pass');
                    this.player1.clickCard(this.quartermaster);
                });

                it('actually sacrifices the character', function() {
                    expect(this.quartermaster.location).not.toBe('play area');
                });

                it('applies the +2 military', function() {
                    expect(this.silentSkirmisher.militarySkill).toBe(this.baseMilitary + 2);
                });

                it('pays Gallant Quartermaster 2 fate', function() {
                    expect(this.player1.player.fate).toBe(this.baseFate + 2);
                });
            });
        });

        describe('Sharpened Tsuruhashi on the body being sacrificed', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['silent-skirmisher', 'kaiu-envoy'],
                        hand: ['sharpened-tsuruhashi'],
                        dynastyDiscard: ['iron-mine']
                    },
                    player2: {
                        inPlay: ['steward-of-cryptic-lore']
                    }
                });
                this.ironMine = this.player1.placeCardInProvince('iron-mine', 'province 1');
                this.silentSkirmisher = this.player1.findCardByName('silent-skirmisher');
                this.envoy = this.player1.findCardByName('kaiu-envoy');
                this.tsuruhashi = this.player1.findCardByName('sharpened-tsuruhashi');
                this.steward = this.player2.findCardByName('steward-of-cryptic-lore');

                this.player1.clickCard(this.tsuruhashi);
                this.player1.clickCard(this.envoy);

                this.noMoreActions();
                this.initiateConflict({
                    type: 'military',
                    attackers: [this.silentSkirmisher, this.envoy],
                    defenders: [this.steward]
                });
                this.player2.pass();

                this.player1.clickCard(this.silentSkirmisher);
                this.player1.clickCard(this.envoy);
            });

            it('returns to hand when the sacrifice is NOT prevented', function() {
                this.player1.clickPrompt('Pass');
                this.player1.clickCard(this.tsuruhashi);
                expect(this.tsuruhashi.location).toBe('hand');
            });

            it('stays attached when the sacrifice IS prevented', function() {
                this.player1.clickCard(this.ironMine);
                expect(this.envoy.location).toBe('play area');
                expect(this.tsuruhashi.location).toBe('play area');
            });
        });

        describe('Vengeful Berserker (a REACTION to the body leaving play)', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['vengeful-berserker', 'silent-skirmisher', 'gallant-quartermaster'],
                        dynastyDiscard: ['iron-mine']
                    },
                    player2: {
                        inPlay: ['steward-of-cryptic-lore']
                    }
                });
                this.ironMine = this.player1.placeCardInProvince('iron-mine', 'province 1');
                this.berserker = this.player1.findCardByName('vengeful-berserker');
                this.silentSkirmisher = this.player1.findCardByName('silent-skirmisher');
                this.quartermaster = this.player1.findCardByName('gallant-quartermaster');
                this.steward = this.player2.findCardByName('steward-of-cryptic-lore');

                this.noMoreActions();
                this.initiateConflict({
                    type: 'military',
                    attackers: [this.berserker, this.silentSkirmisher, this.quartermaster],
                    defenders: [this.steward]
                });
                this.player2.pass();

                this.baseBerserkerMilitary = this.berserker.militarySkill;
                this.player1.clickCard(this.silentSkirmisher);
                this.player1.clickCard(this.quartermaster);
            });

            it('does NOT double when the sacrifice IS prevented', function() {
                this.player1.clickCard(this.ironMine);
                expect(this.quartermaster.location).toBe('play area');
                expect(this.berserker.militarySkill).toBe(this.baseBerserkerMilitary);
            });
        });
    });
});
