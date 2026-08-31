'use strict';

// Massing at Twilight: "While resolving conflicts at this province, each
// character counts its combined [conflict-military] and [conflict-political]
// skill." A +2 military pump therefore raises the total of a POLITICAL
// conflict, and the same sentence is printed on Shiba Ryuu, a character.
//
// `CardPlaybook.conflictTypes` carries two different rules under one field: an
// ENGINE gate ("during a [conflict-military] conflict" — A Perfect Cut, Captive
// Audience) and a VALUE heuristic ("the bonus is military" — Banzai!, Hurricane
// Punch, Scarlet Sabre). Combined skill deletes the heuristic and leaves the
// gate, and only the engine can tell them apart.
//
// Live defect 2026-08-31 (Jigoku Bot Unicorn vs kingitus Dragon, r4c2): the bot
// defended its own Massing at Twilight in a political conflict, lost it 41-32,
// and held Banzai! and Scarlet Sabre in hand the whole time.
//
// Nothing is stubbed: a real game, real registered Effects, a real controller.

const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');

describe('bot reading of combined military+political conflict skill', function() {
    integration(function() {
        beforeEach(function() {
            this.setupTest({
                phase: 'conflict',
                player1: {
                    inPlay: ['asako-diplomat']
                },
                player2: {
                    role: 'seeker-of-void',
                    provinces: ['massing-at-twilight'],
                    inPlay: ['bayushi-manipulator'],
                    hand: ['banzai', 'a-perfect-cut']
                }
            });
            this.diplomat = this.player1.findCardByName('asako-diplomat');
            this.manipulator = this.player2.findCardByName('bayushi-manipulator');
            this.massing = this.player2.findCardByName('massing-at-twilight');

            this.bot = new JigokuBotController(
                this.game,
                { playerName: this.player2.player.name, seed: 1, maxDecisionsPerTick: 1 },
                (command, playerName, args) => this.game[command](playerName, ...args) !== false
            );
            this.combined = () => this.bot.combinedConflictSkillsActive(
                this.game.currentConflict
                    ? this.game.currentConflict.getConflictProvinces() || []
                    : []
            );
            this.legalIds = () => this.bot.combinedSkillLegalCardIds(this.player2.player);
        });

        it('reports nothing outside a conflict', function() {
            expect(this.combined()).toBe(false);
            expect(this.legalIds()).toBeUndefined();
        });

        describe('during a political conflict at Massing at Twilight', function() {
            beforeEach(function() {
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.diplomat],
                    defenders: [this.manipulator],
                    type: 'political',
                    province: this.massing
                });
            });

            it('sees the combined-skill province', function() {
                expect(this.combined()).toBe(true);
            });

            // The engine's own split. Banzai's condition is a bare
            // `isDuringConflict()`; A Perfect Cut's names the type.
            it('separates an off-axis BONUS from an off-axis engine gate', function() {
                const ids = this.legalIds();
                expect(ids).toContain('banzai');
                expect(ids).not.toContain('a-perfect-cut');
            });
        });

        describe('during a conflict at an ordinary province', function() {
            beforeEach(function() {
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.diplomat],
                    defenders: [this.manipulator],
                    type: 'political',
                    province: this.player2.player.getProvinces()
                        .find((card) => card.isProvince && card !== this.massing &&
                            card.location !== 'stronghold province')
                });
            });

            // Nothing is published, so every `conflictTypes` gate stays shut
            // exactly as it was before this rule existed.
            it('publishes no off-axis exemption at all', function() {
                expect(this.combined()).toBe(false);
                expect(this.legalIds()).toBeUndefined();
            });
        });
    });
});
