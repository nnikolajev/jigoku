/* global describe, it, expect, beforeEach, integration */
'use strict';

// CAN THIS BODY STILL JOIN A CONFLICT — read from the ENGINE, in a real game.
//
// The serialized board a bot policy sees publishes `bowed`, `inConflict` and
// the skills. It does not publish that Stolen Breath and Pacifism switch off a
// whole conflict TYPE for as long as they sit there, that Shiba Peacemaker and
// Otomo Courtier switch off only the ATTACKING side, or that a printed dash
// does the same without an attachment.
//
// That blind spot costs a card whenever the payoff of the card IS the body
// joining the conflict. Measured live (2026-08-28, LionDuelist vs
// PhoenixShugenja, r3): a Matsu Tsuko wearing Stolen Breath stood at home
// through a political conflict, the bot hung a SECOND Formal Invitation on her
// — a card whose only ability is "move attached character to the conflict",
// legal only in a political conflict — and then passed the window, because the
// engine refuses the Action for a bearer that cannot participate.
//
// `JigokuBotController.participationBlockedUuids` asks
// `canParticipateAs{Attacker,Defender}(axis)` instead, so the dash, the
// attachments and any future effect are all folded in. Nothing here is
// card-specific.

const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const {
    bodyCanJoinConflict
} = require('../../../build/server/game/bots/MoveIntoConflictPolicy.js');

function blockedFor(game, player) {
    const controller = new JigokuBotController(game, {
        playerName: player.name, seed: 1, maxDecisionsPerTick: 1
    }, () => false);
    return controller.participationBlockedUuids(player);
}

describe('bodyCanJoinConflict', function() {
    const map = {
        military: { attacker: [], defender: [] },
        political: { attacker: ['both-sides', 'attacker-only'], defender: ['both-sides'] }
    };

    it('has no opinion without a published map', function() {
        expect(bodyCanJoinConflict(undefined, 'both-sides', 'political')).toBe(true);
    });

    // An axis-agnostic card (Spyglass pays on "commits OR moves", either type)
    // says nothing about the body's whole life, so it never refuses.
    it('has no opinion without an axis', function() {
        expect(bodyCanJoinConflict(map, 'both-sides', undefined)).toBe(true);
    });

    it('refuses a body banned from both sides of that axis', function() {
        expect(bodyCanJoinConflict(map, 'both-sides', 'political')).toBe(false);
    });

    // With the side unknown — a pre-conflict placement — a one-sided ban must
    // not refuse a placement that would have been legal on the other side.
    it('allows a one-sided ban when the side is not yet known', function() {
        expect(bodyCanJoinConflict(map, 'attacker-only', 'political')).toBe(true);
    });

    it('refuses a one-sided ban on the side that is actually banned', function() {
        expect(bodyCanJoinConflict(map, 'attacker-only', 'political', 'attacker')).toBe(false);
        expect(bodyCanJoinConflict(map, 'attacker-only', 'political', 'defender')).toBe(true);
    });

    it('leaves the other axis alone', function() {
        expect(bodyCanJoinConflict(map, 'both-sides', 'military')).toBe(true);
    });

    it('allows an unlisted body', function() {
        expect(bodyCanJoinConflict(map, 'unlisted', 'political')).toBe(true);
    });
});

describe('participation bans (engine-exact)', function() {
    integration(function() {
        describe('a whole conflict type switched off by an attachment', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: { inPlay: ['matsu-tsuko-2', 'akodo-toturi', 'ikoma-prodigy'] },
                    // Both are the OPPONENT's debuffs, played the way a real
                    // game plays them.
                    player2: { hand: ['stolen-breath', 'pacifism'], inPlay: ['border-rider'] }
                });
                this.tsuko = this.player1.findCardByName('matsu-tsuko-2');
                this.toturi = this.player1.findCardByName('akodo-toturi');
                this.free = this.player1.findCardByName('ikoma-prodigy');
                this.player1.pass();
                // Stolen Breath: cannot participate in POLITICAL conflicts,
                // either side. Pacifism: the same for MILITARY conflicts.
                this.player2.playAttachment('stolen-breath', this.tsuko);
                this.player1.pass();
                this.player2.playAttachment('pacifism', this.toturi);
                this.blocked = blockedFor(this.game, this.player1.player);
            });

            it('reports the political ban on both sides, and only on that axis', function() {
                expect(this.blocked.political.attacker).toContain(this.tsuko.uuid);
                expect(this.blocked.political.defender).toContain(this.tsuko.uuid);
                expect(this.blocked.military.attacker).not.toContain(this.tsuko.uuid);
                expect(this.blocked.military.defender).not.toContain(this.tsuko.uuid);
            });

            it('reports the military ban on the other body', function() {
                expect(this.blocked.military.attacker).toContain(this.toturi.uuid);
                expect(this.blocked.military.defender).toContain(this.toturi.uuid);
                expect(this.blocked.political.attacker).not.toContain(this.toturi.uuid);
            });

            it('leaves an unrestricted body out of every list', function() {
                for(const axis of ['military', 'political']) {
                    expect(this.blocked[axis].attacker).not.toContain(this.free.uuid);
                    expect(this.blocked[axis].defender).not.toContain(this.free.uuid);
                }
            });

            // The whole point of reading the engine: the answer already agrees
            // with the Action the bot is about to click.
            it('agrees with the engine predicate the move action itself uses', function() {
                expect(this.tsuko.canParticipateAsDefender('political')).toBe(false);
                expect(this.tsuko.canParticipateAsAttacker('military')).toBe(true);
            });
        });

        describe('one side only', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    // Shiba Peacemaker carries a permanent
                    // `cannotParticipateAsAttacker()` with no conflict type, so
                    // it is banned as an attacker on BOTH axes and free to
                    // defend on either.
                    player1: { inPlay: ['shiba-peacemaker', 'ikoma-prodigy'] },
                    player2: { inPlay: ['border-rider'] }
                });
                this.peacemaker = this.player1.findCardByName('shiba-peacemaker');
                this.blocked = blockedFor(this.game, this.player1.player);
            });

            it('lists the attacker side on both axes and neither defender side', function() {
                for(const axis of ['military', 'political']) {
                    expect(this.blocked[axis].attacker)
                        .withContext(axis)
                        .toContain(this.peacemaker.uuid);
                    expect(this.blocked[axis].defender)
                        .withContext(axis)
                        .not.toContain(this.peacemaker.uuid);
                }
            });

            it('is read as usable while defending and unusable while attacking', function() {
                expect(bodyCanJoinConflict(this.blocked, this.peacemaker.uuid, 'political', 'defender'))
                    .toBe(true);
                expect(bodyCanJoinConflict(this.blocked, this.peacemaker.uuid, 'political', 'attacker'))
                    .toBe(false);
                // Side unknown: a one-sided ban must not refuse the placement.
                expect(bodyCanJoinConflict(this.blocked, this.peacemaker.uuid, 'political'))
                    .toBe(true);
            });
        });
    });
});
