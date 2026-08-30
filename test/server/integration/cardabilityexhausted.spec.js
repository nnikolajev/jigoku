'use strict';

// `BaseCard.abilitiesExhausted()` answers "every limited ability on this card is
// spent for its period", which the engine already knew (`CardAbility`'s
// `limit.isAtMax` refusal) but never published. It drives the "card used" badge
// in the client and the bot's board-ability gate.
//
// `CardAbility` defaults to `perRound(1)`, so most board abilities are once per
// round without saying so.

describe('card ability exhaustion published on the card summary', function() {
    integration(function() {
        function summaryOf(test, card) {
            return card.getSummary(test.player1Object, false);
        }

        // Bonsai Garden: "Action: During an air conflict - gain 1 honor."
        // It stays in its province, so the limit is what stops a second use --
        // unlike Imperial Storehouse, which sacrifices ITSELF and therefore
        // correctly reports nothing (a card out of play is never exhausted).
        describe('a holding with a once-per-round action', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['adept-of-the-waves'],
                        dynastyDeck: ['bonsai-garden']
                    },
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });
                this.garden = this.player1.placeCardInProvince('bonsai-garden', 'province 1');
                this.adept = this.player1.findCardByName('adept-of-the-waves');
                this.whisperer = this.player2.findCardByName('doji-whisperer');
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept],
                    defenders: [this.whisperer],
                    type: 'military',
                    ring: 'air'
                });
                this.player2.pass();
            });

            it('is not exhausted before the ability is used', function() {
                expect(this.garden.abilitiesExhausted()).toBe(false);
                expect(summaryOf(this, this.garden).abilitiesExhausted).toBe(false);
            });

            it('is exhausted once the ability has been used', function() {
                const before = this.player1.player.honor;
                this.player1.clickCard(this.garden);
                expect(this.player1.player.honor).toBe(before + 1);

                expect(this.garden.abilitiesExhausted()).toBe(true);
                expect(summaryOf(this, this.garden).abilitiesExhausted).toBe(true);

                // ...and the engine agrees the card can no longer be used, which
                // is the whole point of showing it.
                const action = this.garden.abilities.actions[0];
                expect(action.meetsRequirements(action.createContext(this.player1Object)))
                    .not.toBe('');
            });

            it('clears when the round ends and the limit resets', function() {
                this.player1.clickCard(this.garden);
                expect(this.garden.abilitiesExhausted()).toBe(true);

                this.game.emit('onRoundEnded');
                expect(this.garden.abilitiesExhausted()).toBe(false);
            });
        });

        describe('a character whose ability is spent', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['adept-of-the-waves', 'asako-diplomat']
                    },
                    player2: {
                        inPlay: ['bayushi-manipulator']
                    }
                });
                this.adept = this.player1.findCardByName('adept-of-the-waves');
                this.diplomat = this.player1.findCardByName('asako-diplomat');
                this.manipulator = this.player2.findCardByName('bayushi-manipulator');
            });

            it('reports exhausted after the character Action is used, and survives bowing', function() {
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept, this.diplomat],
                    defenders: [this.manipulator],
                    type: 'military'
                });
                this.player2.pass();

                expect(this.adept.abilitiesExhausted()).toBe(false);
                this.player1.clickCard(this.adept);
                this.player1.clickCard(this.adept);
                expect(this.adept.abilitiesExhausted()).toBe(true);

                // Bowing is an independent axis: a bowed card can still have an
                // unspent ability, and a ready card can be spent. The badge must
                // not be confused with the bowed state.
                this.adept.bowed = true;
                this.game.checkGameState(true);
                expect(this.adept.abilitiesExhausted()).toBe(true);
                expect(summaryOf(this, this.adept).bowed).toBe(true);
                expect(summaryOf(this, this.adept).abilitiesExhausted).toBe(true);

                this.diplomat.bowed = true;
                this.game.checkGameState(true);
                expect(this.diplomat.abilitiesExhausted()).toBe(false);
            });
        });

        // The badge has to reach every card type that can carry a board
        // ability. Provinces, strongholds and roles all build their summary
        // with `super.getSummary()`, so they inherit the field — pinned here so
        // a future override that forgets to chain up is caught.
        describe('every card type that can hold an ability', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        faction: 'phoenix',
                        stronghold: 'kyuden-isawa',
                        inPlay: ['adept-of-the-waves'],
                        hand: ['jade-tetsubo']
                    },
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });
                this.adept = this.player1.findCardByName('adept-of-the-waves');
                this.stronghold = this.player1.player.strongholdProvince.value()
                    .find((card) => card.type === 'stronghold');
            });

            it('publishes the field on a STRONGHOLD summary', function() {
                expect(this.stronghold).toBeDefined();
                const summary = this.stronghold.getSummary(this.player1Object, false);
                expect(summary.abilitiesExhausted).toBe(false);

                for(const ability of [...this.stronghold.actions, ...this.stronghold.reactions]) {
                    ability.limit.increment(this.player1Object);
                }
                expect(this.stronghold.getSummary(this.player1Object, false).abilitiesExhausted)
                    .toBe(this.stronghold.abilitiesExhausted());
            });

            it('publishes the field on an ATTACHMENT summary', function() {
                const tetsubo = this.player1.findCardByName('jade-tetsubo', 'hand');
                this.player1.clickCard(tetsubo);
                this.player1.clickCard(this.adept);

                expect(tetsubo.location).toBe('play area');
                const summary = tetsubo.getSummary(this.player1Object, false);
                expect(summary.abilitiesExhausted).toBe(false);

                for(const ability of [...tetsubo.actions, ...tetsubo.reactions]) {
                    ability.limit.increment(this.player1Object);
                }
                expect(tetsubo.abilitiesExhausted()).toBe(true);
                expect(tetsubo.getSummary(this.player1Object, false).abilitiesExhausted).toBe(true);
            });

            it('publishes the field on a faceup PROVINCE summary', function() {
                const province = this.player1.player.getProvinces()
                    .find((card) => card.isProvince && !card.facedown);
                if(!province) {
                    return;
                }
                const summary = province.getSummary(this.player1Object, false);
                // A boolean either way — the point is that the field is PRESENT
                // on a province summary, not which way it reads.
                expect([true, false]).toContain(summary.abilitiesExhausted);
            });
        });

        // The badge is only real if the flag survives the WIRE format the
        // client actually receives, not just `getSummary` called directly.
        describe('the serialized player state the client receives', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['adept-of-the-waves', 'asako-diplomat']
                    },
                    player2: {
                        inPlay: ['bayushi-manipulator']
                    }
                });
                this.adept = this.player1.findCardByName('adept-of-the-waves');
                this.diplomat = this.player1.findCardByName('asako-diplomat');
                this.manipulator = this.player2.findCardByName('bayushi-manipulator');
            });

            it('carries abilitiesExhausted on the in-play cards of the game state', function() {
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept, this.diplomat],
                    defenders: [this.manipulator],
                    type: 'military'
                });
                this.player2.pass();
                this.player1.clickCard(this.adept);
                this.player1.clickCard(this.adept);
                expect(this.adept.abilitiesExhausted()).toBe(true);

                const state = this.game.getState(this.player1Object.name);
                const mine = state.players[this.player1Object.name];
                const inPlay = mine.cardPiles.cardsInPlay;
                const spent = inPlay.find((card) => card.uuid === this.adept.uuid);
                const fresh = inPlay.find((card) => card.uuid === this.diplomat.uuid);

                expect(spent).toBeDefined();
                expect(spent.abilitiesExhausted).toBe(true);
                expect(fresh).toBeDefined();
                expect(fresh.abilitiesExhausted).toBe(false);
            });

            it('shows the OPPONENT the same flag on our cards', function() {
                // The badge is public information: the limit is a fact about the
                // board, and hiding it would leak nothing anyway.
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept, this.diplomat],
                    defenders: [this.manipulator],
                    type: 'military'
                });
                this.player2.pass();
                this.player1.clickCard(this.adept);
                this.player1.clickCard(this.adept);

                const state = this.game.getState(this.player2Object.name);
                const theirs = state.players[this.player1Object.name];
                const spent = theirs.cardPiles.cardsInPlay
                    .find((card) => card.uuid === this.adept.uuid);
                expect(spent.abilitiesExhausted).toBe(true);
            });
        });

        describe('cards that must never show the badge', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['border-rider'],
                        hand: ['fine-katana', 'against-the-waves']
                    },
                    player2: {}
                });
            });

            it('a card with no limited ability is never exhausted', function() {
                const rider = this.player1.findCardByName('border-rider');
                expect(rider.abilitiesExhausted()).toBe(false);
            });

            it('a card in HAND is never exhausted', function() {
                const katana = this.player1.findCardByName('fine-katana', 'hand');
                const event = this.player1.findCardByName('against-the-waves', 'hand');
                expect(katana.abilitiesExhausted()).toBe(false);
                expect(event.abilitiesExhausted()).toBe(false);
            });

            it('a facedown card publishes no exhaustion field at all', function() {
                const province = this.player1.player.getProvinces()
                    .find((card) => card.isProvince && card.facedown);
                if(province) {
                    const summary = province.getSummary(this.player2Object, false);
                    expect(summary.abilitiesExhausted).toBeUndefined();
                }
            });
        });
    });
});
