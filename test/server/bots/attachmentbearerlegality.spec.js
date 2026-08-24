/* global describe, it, expect, beforeEach, integration */
'use strict';

// WHICH BODIES CAN CARRY THIS CARD — read from the ENGINE, in a real game.
//
// The serialized player state a bot policy sees carries no card text and no
// attachment restrictions, so nothing in it says that Minami Kaze Regulars
// takes "no attachments except Weapon" or that Fushichō takes none at all. The
// bot therefore priced Seal of the Unicorn as +1 military on the best body in
// play, played it, and only discovered at the target prompt that its one legal
// home was a bowed body sitting at home (live game 2026-08-24, r3c3).
//
// `JigokuBotController.legalAttachmentTargetUuidsBySource` asks the engine's
// own target resolver instead. These tests pin that it is EXACT — not the
// superset `getAllLegalTargets` returns for some other actions — because the
// play gate now refuses a card on the strength of it.
//
// Nothing here is card-specific: `basecard` parses "no attachments except X"
// and "no attachments" into `allowedAttachmentTraits`, and `AttachAction`
// enforces it. Any future card with either keyword is covered by the same read.

const fs = require('fs');
const path = require('path');
const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const BaseCard = require('../../../build/server/game/basecard.js');

function bearerUuidsFor(game, player, card) {
    const controller = new JigokuBotController(game, {
        playerName: player.name, seed: 1, maxDecisionsPerTick: 1
    }, () => false);
    const map = controller.legalAttachmentTargetUuidsBySource(player);
    return new Set(map[String(card.uuid)] || []);
}

describe('attachment bearer legality (engine-exact)', function() {
    integration(function() {
        describe('a character that takes only Weapons', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        // "No attachments except Weapon" vs an unrestricted body.
                        inPlay: ['minami-kaze-regulars', 'young-warrior', 'miya-mystic'],
                        hand: ['seal-of-the-unicorn', 'curved-blade']
                    },
                    player2: { inPlay: ['border-rider'] }
                });
                this.regulars = this.player1.findCardByName('minami-kaze-regulars');
                this.warrior = this.player1.findCardByName('young-warrior');
                this.neutral = this.player1.findCardByName('miya-mystic');
                this.seal = this.player1.findCardByName('seal-of-the-unicorn');
                this.blade = this.player1.findCardByName('curved-blade');
                this.noMoreActions();
            });

            it('excludes the Weapon-only body from a non-Weapon attachment', function() {
                // Seal of the Unicorn's traits are item/seal. This is the exact
                // pair from the reported game.
                const bearers = bearerUuidsFor(this.game, this.player1Object, this.seal);
                expect(bearers.has(this.warrior.uuid)).toBe(true);
                expect(bearers.has(this.regulars.uuid)).toBe(false);
            });

            it('keeps it for a Weapon', function() {
                const bearers = bearerUuidsFor(this.game, this.player1Object, this.blade);
                expect(bearers.has(this.regulars.uuid)).toBe(true);
                expect(bearers.has(this.warrior.uuid)).toBe(true);
            });

            it('reports the attachment SIDE of the restriction too', function() {
                // Curved Blade reads "Attach to a Unicorn character", which is
                // an effect on the ATTACHMENT rather than a keyword on the
                // bearer. `attachmentConditions` registers it at
                // `Locations.Any`, so it is live while the card sits in hand
                // and this read sees it.
                const bearers = bearerUuidsFor(this.game, this.player1Object, this.blade);
                expect(bearers.has(this.neutral.uuid)).toBe(false);
            });
        });

        describe('a character that takes no attachments at all', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        // Fushichō and Aranat both read "No attachments.",
                        // parsed into allowedAttachmentTraits = ['none'].
                        inPlay: ['fushicho', 'aranat', 'young-warrior'],
                        hand: ['curved-blade', 'seal-of-the-unicorn']
                    },
                    player2: { inPlay: ['border-rider'] }
                });
                this.fushicho = this.player1.findCardByName('fushicho');
                this.aranat = this.player1.findCardByName('aranat');
                this.warrior = this.player1.findCardByName('young-warrior');
                this.noMoreActions();
            });

            it('excludes them from every attachment, Weapon or not', function() {
                for(const name of ['curved-blade', 'seal-of-the-unicorn']) {
                    const bearers = bearerUuidsFor(this.game, this.player1Object,
                        this.player1.findCardByName(name));
                    expect(bearers.has(this.fushicho.uuid)).withContext(`${name} on Fushicho`).toBe(false);
                    expect(bearers.has(this.aranat.uuid)).withContext(`${name} on Aranat`).toBe(false);
                    expect(bearers.has(this.warrior.uuid)).withContext(`${name} on Young Warrior`).toBe(true);
                }
            });
        });

        describe('a trait-restricted attachment', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        // Shinjo Saddle: "Cavalry character only."
                        inPlay: ['young-warrior', 'miya-mystic'],
                        hand: ['shinjo-saddle']
                    },
                    player2: { inPlay: ['border-rider'] }
                });
                this.warrior = this.player1.findCardByName('young-warrior');
                this.neutral = this.player1.findCardByName('miya-mystic');
                this.saddle = this.player1.findCardByName('shinjo-saddle');
                this.noMoreActions();
            });

            it('is limited to bodies carrying the trait', function() {
                const bearers = bearerUuidsFor(this.game, this.player1Object, this.saddle);
                // Young Warrior is Cavalry; Miya Mystic is a Shugenja.
                expect(bearers.has(this.warrior.uuid)).toBe(true);
                expect(bearers.has(this.neutral.uuid)).toBe(false);
            });
        });
    });
});

// EVERY card with an attachment restriction, not a maintained list of them.
//
// There are 42 in the card pool today across nine different wordings ("no
// attachments except Weapon", "... except Monk or Tattoo", "... except Spell or
// Spirit", "No attachments." and so on), and more arrive with every pack. The
// bot needs none of them by name: `BaseCard.parseKeywords` turns the printed
// text into `allowedAttachmentTraits`, `AttachAction.canAffect` enforces it,
// and the bot reads the engine's answer.
//
// This test walks the whole card pool and runs the ENGINE's own parser over
// every such card, so a future wording that escapes it fails here instead of
// silently letting the bot play a weapon onto a body that cannot hold it.
describe('attachment restrictions across the whole card pool', function() {
    const CARD_JSON = path.join(__dirname, '../../json/Card');
    const SENTENCE_SPLIT = new RegExp('[' + String.fromCharCode(10) + '.]');

    // Cards whose restriction is deliberately NOT keyword-parsed because it is
    // a condition rather than a trait list. Each one implements
    // `allowAttachment` itself, which is the same method `AttachAction` calls,
    // so the bot's read still sees it.
    const HAND_IMPLEMENTED = new Set(['kuro']);

    function parsedTraits(text) {
        // `parseKeywords` also registers a persistent effect per printed
        // keyword (Covert, Pride, ...). The stub swallows that: this test is
        // about the attachment-restriction branch only.
        const stub = {
            printedKeywords: [], disguisedKeywordTraits: [], allowedAttachmentTraits: [],
            persistentEffect: () => undefined
        };
        BaseCard.prototype.parseKeywords.call(stub, text.replace(/<[^>]*>/g, '').toLowerCase());
        return stub.allowedAttachmentTraits;
    }

    function restrictedCards() {
        return fs.readdirSync(CARD_JSON)
            .filter((file) => file.endsWith('.json'))
            .map((file) => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(CARD_JSON, file), 'utf8'))[0];
                } catch{
                    return null;
                }
            })
            // The parser only reads a keyword SENTENCE, so "...if there are no
            // attachments on it" in the middle of an ability is not one, and
            // only a character can carry the restriction at all.
            .filter((card) => card && card.type === 'character' &&
                String(card.text || '')
                    .replace(/<[^>]*>/g, '')
                    .toLowerCase()
                    .split(SENTENCE_SPLIT)
                    .some((sentence) => sentence.trim().startsWith('no attachments')));
    }

    it('parses every printed attachment restriction in the pool', function() {
        const missed = restrictedCards()
            .filter((card) => !HAND_IMPLEMENTED.has(card.id))
            .filter((card) => parsedTraits(String(card.text)).length === 0)
            .map((card) => `${card.id}: ${String(card.text).split(String.fromCharCode(10))[0]}`);
        expect(missed).withContext(
            'printed attachment restrictions the engine keyword parser does not read: ' +
            missed.join(' | ')
        ).toEqual([]);
    });

    it('covers the pool at the size it actually is, so an empty walk cannot pass', function() {
        // Both halves of the invariant: the "no attachments except X" cards
        // resolve to a trait list, the bare "No attachments." cards resolve to
        // the sentinel that matches nothing.
        const parsed = restrictedCards()
            .filter((card) => !HAND_IMPLEMENTED.has(card.id))
            .map((card) => parsedTraits(String(card.text)));
        expect(parsed.length).toBeGreaterThan(30);
        expect(parsed.filter((traits) => traits.length === 1 && traits[0] === 'none').length)
            .toBeGreaterThan(5);
        expect(parsed.filter((traits) => traits.includes('weapon')).length).toBeGreaterThan(5);
    });
});
