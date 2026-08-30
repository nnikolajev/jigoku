'use strict';

// `DrawCard.hasCovertKeyword()` answers "COVERT applies to this character right
// now", which the engine already knew (`hasKeyword('covert')`) but never
// published. It drives the covert badge in the client.
//
// It must not be confused with the `covert` FIELD on the same summary, which is
// the OPPOSITE reading: that card has BEEN chosen by an opposing covert
// character and may therefore not be declared as a defender.

describe('covert keyword published on the card summary', function() {
    integration(function() {
        function summaryOf(test, card) {
            return card.getSummary(test.player1Object, false);
        }

        describe('a printed covert character', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        // Kaiu Shuichi is a DYNASTY character, Political Rival
                        // a CONFLICT one. Both print Covert, which is what lets
                        // this cover the in-play and in-hand readings at once.
                        inPlay: ['kaiu-shuichi', 'young-rumormonger'],
                        hand: ['political-rival', 'fine-katana']
                    },
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });
                this.rival = this.player1.findCardByName('kaiu-shuichi');
                this.rumormonger = this.player1.findCardByName('young-rumormonger');
            });

            it('reports the keyword in play', function() {
                expect(this.rival.hasCovertKeyword()).toBe(true);
                expect(summaryOf(this, this.rival).hasCovert).toBe(true);
            });

            it('reports nothing for a character without it', function() {
                expect(this.rumormonger.hasCovertKeyword()).toBe(false);
                expect(summaryOf(this, this.rumormonger).hasCovert).toBe(false);
            });

            // `parseKeywords` registers a printed keyword as a persistent
            // effect whose location is the PLAY AREA, so `hasKeyword` answers
            // false everywhere else. The printed keyword is the only truth
            // available out of play, and the badge should still show there.
            it('reports the keyword for a card in HAND, off the printed text', function() {
                const inHand = this.player1.findCardByName('political-rival', 'hand');
                const katana = this.player1.findCardByName('fine-katana', 'hand');
                expect(inHand.hasKeyword('covert')).toBe(false);
                expect(inHand.hasCovertKeyword()).toBe(true);
                expect(summaryOf(this, inHand).hasCovert).toBe(true);
                expect(katana.hasCovertKeyword()).toBe(false);
            });
        });

        describe('covert GRANTED by an attachment', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['alibi-artist', 'young-rumormonger'],
                        hand: ['infiltrator-s-tools']
                    },
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });
                this.alibiArtist = this.player1.findCardByName('alibi-artist');
                this.rumormonger = this.player1.findCardByName('young-rumormonger');
            });

            it('appears on the bearer once the attachment lands', function() {
                expect(this.alibiArtist.hasCovertKeyword()).toBe(false);
                expect(summaryOf(this, this.alibiArtist).hasCovert).toBe(false);

                this.player1.playAttachment('infiltrator-s-tools', this.alibiArtist);

                expect(this.alibiArtist.hasCovertKeyword()).toBe(true);
                expect(summaryOf(this, this.alibiArtist).hasCovert).toBe(true);
                // ...and only on the bearer.
                expect(summaryOf(this, this.rumormonger).hasCovert).toBe(false);
            });
        });

        // Adept of the Waves grants covert with a CONDITION
        // (`isDuringConflict(element)`), and `Effect.checkCondition` cancels a
        // conditional effect's targets while its condition is false. So the
        // keyword — and the badge — comes and goes with the conflict, which is
        // exactly when covert can be used.
        describe('covert granted CONDITIONALLY', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['adept-of-the-waves', 'solemn-scholar']
                    },
                    player2: {
                        inPlay: ['kitsu-spiritcaller'],
                        provinces: ['entrenched-position']
                    }
                });
                this.adept = this.player1.findCardByName('adept-of-the-waves');
                this.scholar = this.player1.findCardByName('solemn-scholar');
                this.entrenchedPosition = this.player2.findCardByName('entrenched-position');
            });

            it('is not reported while the granting condition is false', function() {
                this.player1.clickCard(this.adept);
                this.player1.clickCard(this.scholar);
                // The grant is live but its condition (a water conflict) is not,
                // so nothing has covert yet.
                expect(this.scholar.hasCovertKeyword()).toBe(false);
                expect(summaryOf(this, this.scholar).hasCovert).toBe(false);
            });

            it('is reported once the matching conflict is running', function() {
                this.player1.clickCard(this.adept);
                this.player1.clickCard(this.scholar);
                this.noMoreActions();
                this.player1.clickRing('water');
                this.player1.clickCard(this.scholar);
                this.player1.clickCard(this.entrenchedPosition);

                expect(this.scholar.hasCovertKeyword()).toBe(true);
                expect(summaryOf(this, this.scholar).hasCovert).toBe(true);
            });
        });

        // The two fields are opposite readings of the same keyword, and the
        // client renders them differently. Pin that they never agree.
        describe('hasCovert vs the covert FIELD', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['togashi-mitsu']
                    },
                    player2: {
                        inPlay: ['hantei-sotorii', 'master-alchemist']
                    }
                });
                this.mitsu = this.player1.findCardByName('togashi-mitsu');
                this.sotorii = this.player2.findCardByName('hantei-sotorii');
                this.shameful = this.player2.findCardByName('shameful-display', 'province 1');
            });

            it('marks the covert ATTACKER, not the character it covert-ed', function() {
                this.noMoreActions();
                this.player1.clickRing('air');
                this.player1.clickCard(this.shameful);
                this.player1.clickCard(this.mitsu);
                this.player1.clickPrompt('Initiate Conflict');
                this.player1.clickCard(this.sotorii);

                // The target has BEEN covert-ed: it cannot defend, but it does
                // not have the keyword.
                expect(this.sotorii.covert).toBe(true);
                expect(this.sotorii.hasCovertKeyword()).toBe(false);
                const targetSummary = this.sotorii.getSummary(this.player2Object, false);
                expect(targetSummary.covert).toBe(true);
                expect(targetSummary.hasCovert).toBe(false);

                // The attacker has the keyword and has not been covert-ed.
                expect(this.mitsu.covert).toBe(false);
                expect(this.mitsu.hasCovertKeyword()).toBe(true);
                expect(summaryOf(this, this.mitsu).covert).toBe(false);
                expect(summaryOf(this, this.mitsu).hasCovert).toBe(true);
            });
        });

        // The badge is only real if the flag survives the WIRE format the
        // client actually receives, not just `getSummary` called directly.
        describe('the serialized player state the client receives', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['kaiu-shuichi', 'young-rumormonger']
                    },
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });
                this.rival = this.player1.findCardByName('kaiu-shuichi');
                this.rumormonger = this.player1.findCardByName('young-rumormonger');
            });

            it('carries hasCovert on the in-play cards of the game state', function() {
                const state = this.game.getState(this.player1Object.name);
                const inPlay = state.players[this.player1Object.name].cardPiles.cardsInPlay;
                const covert = inPlay.find((card) => card.uuid === this.rival.uuid);
                const plain = inPlay.find((card) => card.uuid === this.rumormonger.uuid);

                expect(covert).toBeDefined();
                expect(covert.hasCovert).toBe(true);
                expect(plain).toBeDefined();
                expect(plain.hasCovert).toBe(false);
            });

            it('shows the OPPONENT the same flag on our cards', function() {
                // Covert is printed on the card and public information.
                const state = this.game.getState(this.player2Object.name);
                const theirs = state.players[this.player1Object.name].cardPiles.cardsInPlay;
                const covert = theirs.find((card) => card.uuid === this.rival.uuid);
                expect(covert.hasCovert).toBe(true);
            });

            it('publishes nothing at all for a facedown card', function() {
                const province = this.player1.player.getProvinces()
                    .find((card) => card.isProvince && card.facedown);
                if(province) {
                    const summary = province.getSummary(this.player2Object, false);
                    expect(summary.hasCovert).toBeUndefined();
                }
            });
        });
    });
});
