'use strict';

// Nothing in the serialized player state names the SOURCE of a lasting effect.
// The client summary of a character carries `bowed`, its skills and its
// attachment ids — never "this body is already under Clarity of Purpose" — so
// a bot holding a second copy of a conflict-duration buff cannot see that the
// body it is about to buy protection for already has it.
//
// Live defect 2026-08-30 (Jigoku Bot Phoenix vs kingitus Crane, r3c1): Clarity
// of Purpose on Feral Ningyo, then Kyuden Isawa recurred a second Clarity out
// of the conflict discard and spent it on the SAME Feral Ningyo.
//
// `JigokuBotController.lastingEffectSourceIdsByUuid` answers it off the engine.
// Two properties matter and both are covered here:
//
//   - Clarity's two halves are registered separately and only ONE of them is
//     unconditional. `Effect.checkCondition` CANCELS a conditional effect's
//     targets while its condition is false, so the political-only `DoesNotBow`
//     half drops out during a military conflict — the unconditional
//     `cardCannot('bow')` half is what keeps the protection visible on both
//     axes.
//   - The ENGINE owns the lifetime. A conflict-duration effect is removed on
//     `OnConflictFinished`, so the report needs no conflict-scoping of its own.
//
// Nothing is stubbed: a real game, real registered Effects, a real controller.

const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');

describe('bot reading of lasting-effect sources', function() {
    integration(function() {
        beforeEach(function() {
            this.setupTest({
                phase: 'conflict',
                player1: {
                    inPlay: ['adept-of-the-waves', 'asako-diplomat'],
                    hand: ['clarity-of-purpose', 'clarity-of-purpose']
                },
                player2: {
                    inPlay: ['bayushi-manipulator']
                }
            });
            this.adept = this.player1.findCardByName('adept-of-the-waves');
            this.diplomat = this.player1.findCardByName('asako-diplomat');
            this.manipulator = this.player2.findCardByName('bayushi-manipulator');
            this.clarities = this.player1.player.hand.toArray()
                .filter((card) => card.id === 'clarity-of-purpose');

            this.bot = new JigokuBotController(
                this.game,
                { playerName: this.player1.player.name, seed: 1, maxDecisionsPerTick: 1 },
                (command, playerName, args) => this.game[command](playerName, ...args) !== false
            );
            this.sourcesFor = (card) =>
                this.bot.lastingEffectSourceIdsByUuid()[card.uuid] || [];
        });

        it('reports nothing before any lasting effect is applied', function() {
            expect(this.sourcesFor(this.adept)).toEqual([]);
            expect(this.sourcesFor(this.diplomat)).toEqual([]);
        });

        describe('during a political conflict', function() {
            beforeEach(function() {
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept, this.diplomat],
                    defenders: [this.manipulator],
                    type: 'political'
                });
                this.player2.pass();
            });

            it('names Clarity of Purpose on the character it resolved onto, and only that one', function() {
                this.player1.clickCard(this.clarities[0]);
                this.player1.clickCard(this.adept);

                expect(this.sourcesFor(this.adept)).toContain('clarity-of-purpose');
                expect(this.sourcesFor(this.diplomat)).not.toContain('clarity-of-purpose');
            });

            it('reports the second copy separately once it lands on another body', function() {
                this.player1.clickCard(this.clarities[0]);
                this.player1.clickCard(this.adept);
                this.player2.pass();
                this.player1.clickCard(this.clarities[1]);
                this.player1.clickCard(this.diplomat);

                expect(this.sourcesFor(this.adept)).toContain('clarity-of-purpose');
                expect(this.sourcesFor(this.diplomat)).toContain('clarity-of-purpose');
            });

            it('drops the report when the conflict ends', function() {
                this.player1.clickCard(this.clarities[0]);
                this.player1.clickCard(this.adept);
                expect(this.sourcesFor(this.adept)).toContain('clarity-of-purpose');

                // Run the conflict out. The effect is registered
                // `untilEndOfConflict`, so the engine removes it on
                // `OnConflictFinished` with nothing asked of the bot.
                this.player2.pass();
                this.player1.pass();
                // Walk the closing prompts out generically: the exact chain
                // (win reaction, province break, ring resolution) is not what
                // this spec is about, only that the conflict actually ends.
                for(let step = 0; step < 12 && this.game.currentConflict; step++) {
                    const prompt = this.player1.currentPrompt();
                    const button = (prompt.buttons || []).find((candidate) =>
                        ['Pass', 'No', "Don't resolve", 'Done'].includes(candidate.text));
                    if(button) {
                        this.player1.clickPrompt(button.text);
                        continue;
                    }
                    const theirs = this.player2.currentPrompt();
                    const theirButton = (theirs.buttons || []).find((candidate) =>
                        ['Pass', 'No', "Don't resolve", 'Done'].includes(candidate.text));
                    if(!theirButton) {
                        break;
                    }
                    this.player2.clickPrompt(theirButton.text);
                }

                expect(this.game.currentConflict).toBeFalsy();
                expect(this.sourcesFor(this.adept)).not.toContain('clarity-of-purpose');
            });
        });

        it('still reports it in a MILITARY conflict, where the DoesNotBow half is switched off', function() {
            this.noMoreActions();
            this.initiateConflict({
                attackers: [this.adept, this.diplomat],
                defenders: [this.manipulator],
                type: 'military'
            });
            this.player2.pass();
            this.player1.clickCard(this.clarities[0]);
            this.player1.clickCard(this.adept);

            // The engine correctly reports no DoesNotBow: that half is
            // conditional on a political conflict and its targets are cancelled.
            expect(this.adept.bowsOnReturnHome()).toBe(true);
            // The unconditional bow-protection half is still on the body, which
            // is what makes a second copy waste on both axes.
            expect(this.sourcesFor(this.adept)).toContain('clarity-of-purpose');
        });
    });
});
