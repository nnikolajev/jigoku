'use strict';

// The exhaustion badge is only as right as the ENGINE's limit model, so these
// pin that model for the limit shapes that actually appear on cards.
//
// `CardAbility` defaults `limit` to `perRound(1)` and `TriggeredAbility extends
// CardAbility`, so a REACTION with no explicit limit is also once per round.

describe('ability limit shapes behind the exhaustion badge', function() {
    integration(function() {
        describe('Spyglass: an explicit "2 times per round"', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['border-rider', 'doji-whisperer'],
                        hand: ['spyglass']
                    },
                    player2: {
                        inPlay: ['bayushi-manipulator']
                    }
                });
                this.rider = this.player1.findCardByName('border-rider');
                this.whisperer = this.player1.findCardByName('doji-whisperer');
                this.manipulator = this.player2.findCardByName('bayushi-manipulator');
                this.spyglass = this.player1.findCardByName('spyglass', 'hand');
                this.player1.clickCard(this.spyglass);
                this.player1.clickCard(this.rider);
            });

            it('reports the limit as perRound(2), not the perRound(1) default', function() {
                const reaction = this.spyglass.abilities.reactions[0];
                expect(reaction.limit.max).toBe(2);
            });

            it('is not exhausted after ONE use, and is after the second', function() {
                const player = this.player1Object;
                const limit = this.spyglass.abilities.reactions[0].limit;

                expect(this.spyglass.abilitiesExhausted()).toBe(false);

                limit.increment(player);
                expect(limit.isAtMax(player)).toBe(false);
                expect(this.spyglass.abilitiesExhausted()).toBe(false);

                limit.increment(player);
                expect(limit.isAtMax(player)).toBe(true);
                expect(this.spyglass.abilitiesExhausted()).toBe(true);

                this.game.emit('onRoundEnded');
                expect(this.spyglass.abilitiesExhausted()).toBe(false);
            });
        });

        describe('Forgotten Library: a holding that stays in its province', function() {
            beforeEach(function() {
                // DYNASTY phase deliberately. This card's reaction triggers on
                // the DRAW phase starting, and `setupTest({ phase: 'conflict' })`
                // advances THROUGH the draw phase — which fires the reaction
                // mid-setup and desynchronises the harness's honor bid.
                this.setupTest({
                    phase: 'dynasty',
                    player1: {
                        inPlay: ['border-rider'],
                        // Extra bodies so the setup province fill never runs
                        // the dynasty deck dry, which intermittently produced
                        // "1 is not a valid selection" during setup.
                        dynastyDeck: ['forgotten-library', 'adept-of-the-waves',
                            'asako-diplomat', 'doji-whisperer', 'border-rider']
                    },
                    player2: {
                        inPlay: ['doji-whisperer']
                    }
                });
                this.library = this.player1.placeCardInProvince('forgotten-library', 'province 1');
                this.game.continue();
            });

            it('is a once-per-round reaction and reports exhaustion in place', function() {
                const reaction = this.library.abilities.reactions[0];
                // No explicit limit on the card, so it takes the default.
                expect(reaction.limit.max).toBe(1);

                expect(this.library.abilitiesExhausted()).toBe(false);
                reaction.limit.increment(this.player1Object);
                expect(this.library.abilitiesExhausted()).toBe(true);

                // The holding is still in its province — unlike Imperial
                // Storehouse, which sacrifices itself and leaves play (a card
                // out of play is never exhausted).
                expect(this.library.location).toBe('province 1');
                expect(this.library.getSummary(this.player1Object, false).abilitiesExhausted).toBe(true);

                this.game.emit('onRoundEnded');
                expect(this.library.abilitiesExhausted()).toBe(false);
            });
        });

        describe('Honored Blade: printed with NO limit', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['border-rider'],
                        hand: ['honored-blade']
                    },
                    player2: {
                        inPlay: ['bayushi-manipulator']
                    }
                });
                this.rider = this.player1.findCardByName('border-rider');
                this.blade = this.player1.findCardByName('honored-blade', 'hand');
                this.player1.clickCard(this.blade);
                this.player1.clickCard(this.rider);
            });

            // The printed card reads "Reaction: After you win a conflict in
            // which attached character is participating - gain 1 honor", with no
            // limit clause. This engine gives every unlimited-looking ability the
            // `perRound(1)` default, so it fires once a round here. Pinned as
            // ENGINE BEHAVIOUR, not endorsed as correct: see the note in
            // docs/bot-card-ability-exhausted.md.
            it('is given the perRound(1) DEFAULT by this engine', function() {
                const reaction = this.blade.abilities.reactions[0];
                expect(reaction.limit.max).toBe(1);
                expect(reaction.limit.isRepeatable()).toBe(true);

                expect(this.blade.abilitiesExhausted()).toBe(false);
                reaction.limit.increment(this.player1Object);
                expect(this.blade.abilitiesExhausted()).toBe(true);

                // The badge therefore appears after ONE won conflict, which is
                // exactly what the engine will enforce on the next click.
                expect(this.blade.getSummary(this.player1Object, false).abilitiesExhausted).toBe(true);
            });
        });

        describe('an ability with no ceiling never shows the badge', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: { inPlay: ['border-rider'] },
                    player2: {}
                });
                this.rider = this.player1.findCardByName('border-rider');
            });

            it('an unlimited-per-conflict limit is never at max however often it fires', function() {
                const { unlimitedPerConflict, unlimited } = require('../../../build/server/game/AbilityLimit.js');
                for(const limit of [unlimitedPerConflict(), unlimited()]) {
                    for(let i = 0; i < 25; i++) {
                        limit.increment(this.player1Object);
                    }
                    expect(limit.isAtMax(this.player1Object)).toBe(false);
                }
            });
        });
    });
});
