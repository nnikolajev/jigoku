/* global describe, it, expect, beforeEach */
'use strict';

const {
    AttachmentTargetPolicy,
    DEFAULT_ATTACHMENT_TARGET,
    HOME_BEARER_ATTACHMENT_IDS,
    HOME_BEARER_NEEDS_READY_IDS
} = require('../../../build/server/game/bots/AttachmentTargetPolicy.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const { DEFAULT_PROFILE, profileFromStrategy } = require('../../../build/server/game/bots/DeckProfiles.js');
const { MOVE_SOURCES } = require('../../../build/server/game/bots/ReadyMovePlanner.js');
const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');

describe('AttachmentTargetPolicy', function() {
    let policy;

    beforeEach(function() {
        policy = new AttachmentTargetPolicy({ enabled: true });
    });

    it('ships ON field-wide, while the policy default stays the V1 revert', function() {
        // The class default is the revert switch (`enabled: false` is V1
        // exactly, proved by tools/selfplay/refactorIdentity.js); the shipped
        // value lives on the profile, same shape as `unopposedWindow`.
        expect(DEFAULT_ATTACHMENT_TARGET.enabled).toBe(false);
        expect(new AttachmentTargetPolicy().inert).toBe(true);
        expect(DEFAULT_PROFILE.attachmentTarget.enabled).toBe(true);
        expect(DEFAULT_PROFILE.attachmentTarget.requireUsableBearer).toBe(true);
        // The rules-ban gate ships on by default too; `false` is the revert arm.
        expect(DEFAULT_PROFILE.attachmentTarget.requireParticipableBearer).toBe(true);
        // The hold rule ships on; the CLASS default stays the revert arm.
        expect(DEFAULT_ATTACHMENT_TARGET.holdUntilBearerCanUseIt).toBe(false);
        expect(DEFAULT_PROFILE.attachmentTarget.holdUntilBearerCanUseIt).toBe(true);
    });

    // A stat attachment is only worth its fate while some legal bearer can
    // still get value out of it before the round ends. Live 2026-08-28: an
    // unopposed 2-0 attack that was not breaking sent Blade of 10,000 Battles
    // (2 fate), Fan of Command (1) and Formal Invitation (0) onto a BOWED
    // Akodo Toturi, who readies in the fate phase.
    describe('bearerCanUseAttachment', function() {
        const policy = new AttachmentTargetPolicy();
        const bearer = (extra) => Object.assign({
            bowed: false,
            participating: false,
            conflictNeedsSkill: false,
            staysReadyAfterConflict: false,
            conflictOpportunityRemains: true,
            readySourceAvailable: false,
            moveSourceAvailable: false,
            readyAfterMoveAvailable: false,
            payoffIgnoresBow: false,
            payoffIgnoresBearerState: false,
            payoffOnMoveIn: false,
            needsSkillOnArrival: false,
            payoffReadiesBearer: false
        }, extra);

        it('is off by default, so the class default is the revert arm', function() {
            expect(DEFAULT_ATTACHMENT_TARGET.holdUntilBearerCanUseIt).toBe(false);
            expect(policy.holdsUntilBearerCanUseIt).toBe(false);
        });

        // `enabled: false` is documented as "V1 exactly", so it has to switch
        // off every rule in this class, not just the participant preference.
        it('is switched off by the V1 revert switch even when asked for', function() {
            expect(new AttachmentTargetPolicy({
                enabled: false, holdUntilBearerCanUseIt: true
            }).holdsUntilBearerCanUseIt).toBe(false);
            expect(new AttachmentTargetPolicy({
                enabled: false, requireParticipableBearer: true
            }).gatesBearerParticipation).toBe(false);
            expect(new AttachmentTargetPolicy({
                enabled: true, holdUntilBearerCanUseIt: true
            }).holdsUntilBearerCanUseIt).toBe(true);
        });

        // Waterfall Tattoo READIES its bearer after a province we control is
        // revealed, so a BOWED bearer is the body the card exists for —
        // `DragonAttachmentTactics` picks exactly that one on purpose.
        it('accepts a bowed bearer for a card whose payoff readies it', function() {
            expect(policy.bearerCanUseAttachment(
                bearer({ bowed: true, payoffReadiesBearer: true }))).toBe(true);
            expect(policy.bearerCanUseAttachment(bearer({
                bowed: true, payoffReadiesBearer: true, conflictOpportunityRemains: false
            }))).toBe(true);
        });

        it('refuses a bowed body at HOME: it readies in the FATE phase, not this round', function() {
            expect(policy.bearerCanUseAttachment(bearer({ bowed: true }))).toBe(false);
        });

        // `isParticipating()` is bow-agnostic, and Blade of 10,000 Battles pays
        // after the bearer WINS a conflict while Fan of Command works while it
        // IS PARTICIPATING. Owner, 2026-08-28: "both are okay if toturi is
        // participating in conflict while he is bowed."
        it('accepts a BOWED PARTICIPANT for a card whose payoff ignores the bow', function() {
            expect(policy.bearerCanUseAttachment(bearer({
                bowed: true, participating: true, payoffIgnoresBow: true
            }))).toBe(true);
        });

        it('still refuses a bowed participant for a SKILL attachment', function() {
            expect(policy.bearerCanUseAttachment(bearer({
                bowed: true, participating: true
            }))).toBe(false);
        });

        // The flag says nothing about a body that is not in the conflict at all.
        it('does not let the flag rescue a bowed body sitting at home', function() {
            expect(policy.bearerCanUseAttachment(bearer({
                bowed: true, participating: false, payoffIgnoresBow: true
            }))).toBe(false);
        });

        it('accepts a bowed body a ready source can stand up right now', function() {
            expect(policy.bearerCanUseAttachment(
                bearer({ bowed: true, readySourceAvailable: true }))).toBe(true);
        });

        it('accepts a participant only while the conflict still needs skill', function() {
            expect(policy.bearerCanUseAttachment(
                bearer({ participating: true, conflictNeedsSkill: true }))).toBe(true);
            expect(policy.bearerCanUseAttachment(
                bearer({ participating: true, conflictNeedsSkill: false }))).toBe(false);
        });

        // A body with `DoesNotBow` comes home standing, so it fights again.
        it('accepts a participant that will not bow on the way home', function() {
            expect(policy.bearerCanUseAttachment(bearer({
                participating: true, conflictNeedsSkill: false, staysReadyAfterConflict: true
            }))).toBe(true);
        });

        // This is the case that keeps the ordinary "invest in the tower" play.
        it('accepts an unbowed body at home while a conflict is left this round', function() {
            expect(policy.bearerCanUseAttachment(bearer({}))).toBe(true);
            expect(policy.bearerCanUseAttachment(
                bearer({ conflictOpportunityRemains: false }))).toBe(false);
        });

        // Owner, 2026-08-28: "Adorned Barcha can be triggered to bow the chosen
        // participating character, even if the attached character cannot move
        // to the conflict (eg. Pacifism, or the attached character has a dash
        // Mil skill). The bowing is not dependent on the movement."
        it('accepts any bearer for a card whose payoff ignores the bearer entirely', function() {
            for(const state of [
                { bowed: true },
                { bowed: true, participating: true },
                { conflictOpportunityRemains: false },
                { participating: true, conflictNeedsSkill: false }
            ]) {
                expect(policy.bearerCanUseAttachment(
                    bearer(Object.assign({ payoffIgnoresBearerState: true }, state))))
                    .withContext(JSON.stringify(state)).toBe(true);
            }
        });

        // Spyglass draws on "commits to a conflict OR moves to a conflict", and
        // a bowed body can still be MOVED in.
        it('accepts a bowed home bearer for a move-in payoff when a move source exists', function() {
            expect(policy.bearerCanUseAttachment(
                bearer({ bowed: true, payoffOnMoveIn: true }))).toBe(false);
            expect(policy.bearerCanUseAttachment(bearer({
                bowed: true, payoffOnMoveIn: true, moveSourceAvailable: true
            }))).toBe(true);
            // Unbowed it can simply commit, so no move source is needed.
            expect(policy.bearerCanUseAttachment(
                bearer({ payoffOnMoveIn: true }))).toBe(true);
        });

        // Formal Invitation moves its own bearer; a bowed one arrives with 0
        // skill unless it can also be readied, in either order.
        it('accepts a bowed home bearer for a skill-on-arrival card only if it can be readied', function() {
            expect(policy.bearerCanUseAttachment(
                bearer({ bowed: true, needsSkillOnArrival: true }))).toBe(false);
            expect(policy.bearerCanUseAttachment(bearer({
                bowed: true, needsSkillOnArrival: true, readySourceAvailable: true
            }))).toBe(true);
            expect(policy.bearerCanUseAttachment(bearer({
                bowed: true, needsSkillOnArrival: true, readyAfterMoveAvailable: true
            }))).toBe(true);
            expect(policy.bearerCanUseAttachment(
                bearer({ needsSkillOnArrival: true }))).toBe(true);
        });
    });

    // The flag is a fact about the CARD's text, so it is pinned against the
    // printed text rather than trusted. A card whose ability keys on
    // `isParticipating()` or on WINNING a conflict pays for a bowed bearer;
    // a plain stat stick does not.
    it('marks exactly the attachments whose payoff ignores the bearers bow', function() {
        const pays = (id) => getPlaybookEntry(id)?.bowedParticipantPays === true;
        for(const id of [
            'blade-of-10-000-battles', 'fan-of-command', 'duelist-training',
            'honored-blade', 'jade-tetsubo', 'magnificent-kimono', 'ofushikai',
            'scarlet-sabre', 'self-understanding', 'setting-the-standard',
            'shukujo', 'utaku-battle-steed', 'watch-commander', 'iaijutsu-master',
            'true-strike-kenjutsu'
        ]) {
            expect(pays(id)).withContext(id).toBe(true);
        }
        // Plain stat lines, and the move-in cards whose payoff needs the bearer
        // to ARRIVE with skill, are not marked.
        for(const id of ['fine-katana', 'ornate-fan', 'curved-blade',
            'formal-invitation', 'adorned-barcha', 'spyglass']) {
            expect(pays(id)).withContext(id).toBe(false);
        }
    });

    it('every deck carries its own copy, so tuning one cannot leak to another', function() {
        const a = profileFromStrategy('unicorn');
        const b = profileFromStrategy('lion');
        expect(a.attachmentTarget).not.toBe(b.attachmentTarget);
        expect(a.attachmentTarget).not.toBe(DEFAULT_PROFILE.attachmentTarget);
    });

    it('keeps V1s rule whatever the config: a losing conflict always pulls it onto a participant', function() {
        for(const config of [{ enabled: false }, { enabled: true }, { preferParticipantWhenNeeded: false }]) {
            expect(new AttachmentTargetPolicy(config)
                .preferParticipant({ losing: true, skillNeeded: 0 })).toBe(true);
        }
    });

    it('with the lever off, a conflict that is merely SHORT of the break takes the tower', function() {
        expect(new AttachmentTargetPolicy({ enabled: false })
            .preferParticipant({ losing: false, skillNeeded: 3 })).toBe(false);
    });

    it('with the lever on, a conflict that still needs skill pulls it onto a participant', function() {
        // The live case: attacking 4 vs 2 into a strength-5 province is winning
        // and still three skill short of the break.
        expect(policy.preferParticipant({ losing: false, skillNeeded: 3 })).toBe(true);
    });

    it('a settled conflict, and no conflict at all, both take the tower', function() {
        expect(policy.preferParticipant({ losing: false, skillNeeded: 0 })).toBe(false);
        expect(policy.preferParticipant({ losing: false, skillNeeded: null })).toBe(false);
    });

    it('stops caring once the conflict needs more skill than an attachment supplies', function() {
        expect(policy.preferParticipant({ losing: false, skillNeeded: 6 })).toBe(true);
        expect(policy.preferParticipant({ losing: false, skillNeeded: 7 })).toBe(false);
        // 0 disables the cap.
        expect(new AttachmentTargetPolicy({ enabled: true, maxSkillNeeded: 0 })
            .preferParticipant({ losing: false, skillNeeded: 40 })).toBe(true);
    });

    it('exempts the cards whose value IS a bearer outside the conflict', function() {
        expect(policy.wantsHomeBearer('adorned-barcha')).toBe(true);
        expect(policy.wantsHomeBearer('formal-invitation')).toBe(true);
        expect(policy.wantsHomeBearer('spyglass')).toBe(true);
        expect(policy.wantsHomeBearer('fine-katana')).toBe(false);
        expect(policy.wantsHomeBearer(undefined)).toBe(false);
    });

    it('the two move-in exemptions are exactly the bearer-moving MOVE_SOURCES', function() {
        // Not a restatement of the list: `selfOrBearerOnly` is what makes a
        // participating bearer illegal for the card, and that is the reason the
        // narrowing has to skip it.
        const bearerMovers = MOVE_SOURCES
            .filter((spec) => spec.selfOrBearerOnly && HOME_BEARER_ATTACHMENT_IDS.has(spec.id))
            .map((spec) => spec.id);
        expect(bearerMovers.sort()).toEqual(['adorned-barcha', 'formal-invitation']);
    });

    it('a move-in card still wants an UNBOWED bearer, except the one that pays anyway', function() {
        // Formal Invitation's whole payoff is the bearer arriving with skill.
        expect(policy.wantsReadyHomeBearer('formal-invitation')).toBe(true);
        // Adorned Barcha bows an enemy participant whatever its bearer's skill,
        // which is the value `movevalue.js` credits it with.
        expect(policy.wantsReadyHomeBearer('adorned-barcha')).toBe(false);
        expect(HOME_BEARER_NEEDS_READY_IDS.has('spyglass')).toBe(false);
    });
});

describe('attachment bearer choice in the bot policy', function() {
    const char = (uuid, mil, options = {}) => ({
        uuid, name: uuid, id: uuid, type: 'character', selectable: true,
        bowed: !!options.bowed, inConflict: !!options.inConflict, fate: options.fate || 0,
        attachments: [],
        militarySkillSummary: { stat: String(mil) }, politicalSkillSummary: { stat: '0' }
    });

    // Attacking 4 vs 2 with a strength-5 province: winning, and still short of
    // the break. This is the board the live Unicorn game was on.
    const shortOfBreak = (cards) => ({
        conflict: {
            type: 'military', attackingPlayerId: 'bot', defendingPlayerId: 'human',
            attackerSkill: 4, defenderSkill: 2
        },
        players: {
            'Jigoku Bot': {
                name: 'Jigoku Bot', id: 'bot',
                promptTitle: 'Choose a character', menuTitle: 'Choose a character',
                buttons: [], stats: { fate: 2, honor: 8 },
                cardPiles: { cardsInPlay: cards, hand: [] }
            },
            Human: {
                name: 'Human', id: 'human', stats: { fate: 2, honor: 8 },
                cardPiles: { cardsInPlay: [] },
                provinceDeck: [{
                    id: 'sacred-sanctuary', name: 'Sacred Sanctuary', type: 'province',
                    isProvince: true, inConflict: true, isBroken: false,
                    strengthSummary: { stat: '5' }
                }]
            }
        }
    });

    const context = (profile) => ({
        targetHint: { gameActions: ['attach'], sourceCardId: 'fine-katana', sourceIsMine: true },
        cardHint: () => undefined,
        profile
    });

    function decide(profile) {
        const state = shortOfBreak([
            char('homeTower', 3, { fate: 3 }),
            char('attacker', 4, { inConflict: true })
        ]);
        return new JigokuBotPolicy('attach-bearer').decide(state, 'Jigoku Bot', context(profile));
    }

    it('V1 sends the weapon to the home tower while the attack is short of the break', function() {
        const v1 = profileFromStrategy();
        v1.attachmentTarget = { ...v1.attachmentTarget, enabled: false };
        const decision = decide(v1);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('homeTower');
    });

    it('with the lever on it goes on the attacker that can still reach the break', function() {
        const profile = profileFromStrategy();
        profile.attachmentTarget = { ...profile.attachmentTarget, enabled: true };
        const decision = decide(profile);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('attacker');
    });

    it('a card that moves its own bearer in is exempt and stays at home', function() {
        const profile = profileFromStrategy();
        profile.attachmentTarget = { ...profile.attachmentTarget, enabled: true };
        const state = shortOfBreak([
            char('homeReady', 3, { fate: 3 }),
            char('attacker', 4, { inConflict: true })
        ]);
        const decision = new JigokuBotPolicy('attach-move-in').decide(state, 'Jigoku Bot', {
            targetHint: { gameActions: ['attach'], sourceCardId: 'formal-invitation', sourceIsMine: true },
            cardHint: () => undefined,
            profile
        });
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('homeReady');
    });

    it('but a move-in card still refuses a BOWED bearer while the conflict needs skill', function() {
        const profile = profileFromStrategy();
        profile.attachmentTarget = { ...profile.attachmentTarget, enabled: true };
        const state = shortOfBreak([
            char('homeBowed', 6, { fate: 3, bowed: true }),
            char('homeReady', 2, { fate: 0 })
        ]);
        const decision = new JigokuBotPolicy('attach-move-in-bowed').decide(state, 'Jigoku Bot', {
            targetHint: { gameActions: ['attach'], sourceCardId: 'formal-invitation', sourceIsMine: true },
            cardHint: () => undefined,
            profile
        });
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('homeReady');
    });
});

describe('attachment PLAY gate reads the engine legal-bearer map', function() {
    // The board from the reported game: the only body fighting is the one that
    // takes "no attachments except Weapon", and the only legal home for the
    // non-Weapon attachment in hand is a bowed body sitting at home.
    const regulars = {
        uuid: 'regulars', id: 'minami-kaze-regulars', name: 'Minami Kaze Regulars',
        type: 'character', location: 'play area', bowed: false, inConflict: true,
        attachments: [], militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '1' }
    };
    const warrior = {
        uuid: 'warrior', id: 'young-warrior', name: 'Young Warrior',
        type: 'character', location: 'play area', bowed: true, inConflict: false, fate: 0,
        attachments: [], militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '5' }
    };
    const seal = {
        uuid: 'seal', id: 'seal-of-the-unicorn', name: 'Seal of the Unicorn',
        type: 'attachment', location: 'hand', isPlayableByMe: true
    };

    function state() {
        return {
            conflict: {
                type: 'military', attackingPlayerId: 'bot-id', defendingPlayerId: 'human-id',
                attackerSkill: 4, defenderSkill: 2
            },
            players: {
                'Jigoku Bot': {
                    name: 'Jigoku Bot', id: 'bot-id',
                    promptTitle: 'Conflict Action Window',
                    menuTitle: 'Military Void conflict Attacker: 4 Defender: 2',
                    buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                    stats: { fate: 2, honor: 8, conflictsRemaining: 1 },
                    cardsPlayedThisConflict: 0,
                    cardPiles: { hand: [seal], cardsInPlay: [regulars, warrior],
                        conflictDiscardPile: [], dynastyDiscardPile: [] },
                    strongholdProvince: [],
                    provinces: { one: [], two: [], three: [], four: [] }
                },
                Human: {
                    name: 'Human', id: 'human-id',
                    stats: { conflictsRemaining: 1 },
                    cardsPlayedThisConflict: 0,
                    cardPiles: { cardsInPlay: [], hand: [] },
                    provinces: {
                        one: [{
                            uuid: 'sanctuary', id: 'sacred-sanctuary', name: 'Sacred Sanctuary',
                            type: 'province', isProvince: true, inConflict: true, isBroken: false,
                            strengthSummary: { stat: '5' }
                        }],
                        two: [], three: [], four: []
                    }
                }
            }
        };
    }

    // Straight from `JigokuBotController.legalAttachmentTargetUuidsBySource`,
    // and pinned against the live engine by
    // `test/server/bots/attachmentbearerlegality.spec.js`.
    const bearers = { seal: ['warrior'] };

    function decide(profile) {
        return new JigokuBotPolicy('attach-play-gate').decide(state(), 'Jigoku Bot', {
            legalAttachmentTargetUuidsBySource: bearers,
            profile
        });
    }

    it('V1 plays it anyway: nothing in the board summary says where it may land', function() {
        const v1 = profileFromStrategy();
        v1.attachmentTarget = { ...v1.attachmentTarget, enabled: false };
        const decision = decide(v1);
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('seal');
    });

    it('with the gate on it holds the card, because no legal bearer is fighting', function() {
        const profile = profileFromStrategy();
        profile.attachmentTarget = { ...profile.attachmentTarget, enabled: true };
        const decision = decide(profile);
        expect(decision.args[0]).not.toBe('seal');
    });

    it('and still plays it once a legal bearer is the one in the conflict', function() {
        const profile = profileFromStrategy();
        profile.attachmentTarget = { ...profile.attachmentTarget, enabled: true };
        const board = state();
        board.players['Jigoku Bot'].cardPiles.cardsInPlay = [
            { ...regulars, uuid: 'regulars' },
            { ...warrior, uuid: 'warrior', bowed: false, inConflict: true }
        ];
        const decision = new JigokuBotPolicy('attach-play-gate-ok')
            .decide(board, 'Jigoku Bot', { legalAttachmentTargetUuidsBySource: bearers, profile });
        expect(decision.command).toBe('cardClicked');
        expect(decision.args[0]).toBe('seal');
    });
});
