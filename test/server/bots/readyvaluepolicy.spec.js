/* global describe, it, expect, beforeEach */
'use strict';

const {
    ReadyValuePolicy,
    DEFAULT_READY_VALUE,
    MOVE_INTO_CONFLICT_SOURCE_IDS
} = require('../../../build/server/game/bots/ReadyValuePolicy.js');
const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { DEFAULT_PROFILE, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const { cards } = require('../../../build/server/game/cards/index.js');

// The board with nothing left to use a ready: no conflicts on either side, no
// move effect, nothing in a conflict.
const SPENT = Object.freeze({
    inConflict: false,
    conflictActive: true,
    conflictsRemaining: 0,
    opponentConflictsRemaining: 0,
    canMoveIntoConflict: false,
    gloryOnReady: 0,
    favorContested: true
});

describe('ReadyValuePolicy', function() {
    let policy;

    beforeEach(function() {
        policy = new ReadyValuePolicy();
    });

    it('ships enabled, with the mover branch and without the Imperial Favor exception', function() {
        expect(DEFAULT_READY_VALUE.enabled).toBe(true);
        expect(DEFAULT_READY_VALUE.countFavorGlory).toBe(false);
        // On since `ReadyMovePlanner` gave the branch its follow-through: the
        // plan commits to one body and one move source and budgets both legs.
        expect(DEFAULT_READY_VALUE.allowMoveIntoConflict).toBe(true);
        expect(policy.inert).toBe(false);
    });

    describe('the three things that can use a ready', function() {
        it('readies a bowed PARTICIPANT even with nothing else left', function() {
            const verdict = policy.evaluate({ ...SPENT, inConflict: true });
            expect(verdict.useful).toBe(true);
            expect(verdict.reason).toBe('ready-bowed-participant');
        });

        it('readies a home body for one of OUR remaining conflicts', function() {
            const verdict = policy.evaluate({ ...SPENT, conflictsRemaining: 1 });
            expect(verdict.useful).toBe(true);
            expect(verdict.reason).toBe('ready-for-own-conflict');
        });

        it('readies a home body to DEFEND one of theirs', function() {
            const verdict = policy.evaluate({ ...SPENT, opponentConflictsRemaining: 1 });
            expect(verdict.useful).toBe(true);
            expect(verdict.reason).toBe('ready-to-defend-their-conflict');
        });

        it('readies a home body a committed plan will MOVE in', function() {
            const verdict = policy.evaluate({ ...SPENT, canMoveIntoConflict: true });
            expect(verdict.useful).toBe(true);
            expect(verdict.reason).toBe('ready-then-move-into-conflict');
        });

        it('does not count a move effect with no conflict to move into', function() {
            expect(policy.evaluate({
                ...SPENT, canMoveIntoConflict: true, conflictActive: false
            }).useful).toBe(false);
        });

        it('can be switched off per deck', function() {
            const noMover = new ReadyValuePolicy({ allowMoveIntoConflict: false });
            expect(noMover.evaluate({ ...SPENT, canMoveIntoConflict: true }).useful).toBe(false);
        });
    });

    it('refuses the ready that has nothing left to use it', function() {
        // The live case: Phoenix vs Dragon 2026-08-23, round 2 conflict 4.
        // Against the Waves readied Kudaka at home with both players out of
        // conflict opportunities.
        const verdict = policy.evaluate(SPENT);
        expect(verdict.useful).toBe(false);
        expect(verdict.reason).toBe('ready-no-conflict-left');
    });

    describe('the Imperial Favor exception', function() {
        it('is off by default: glory does not rescue a dead ready', function() {
            expect(policy.evaluate({ ...SPENT, gloryOnReady: 3 }).useful).toBe(false);
        });

        it('pays for a glory body when the deck races the favor', function() {
            const scorpion = new ReadyValuePolicy({ countFavorGlory: true });
            const verdict = scorpion.evaluate({ ...SPENT, gloryOnReady: 1 });
            expect(verdict.useful).toBe(true);
            expect(verdict.reason).toBe('ready-for-imperial-favor-glory');
        });

        it('still refuses a 0-glory body, which contributes nothing to the count', function() {
            const scorpion = new ReadyValuePolicy({ countFavorGlory: true });
            expect(scorpion.evaluate({ ...SPENT, gloryOnReady: 0 }).useful).toBe(false);
        });

        it('needs the favor to actually be contestable', function() {
            const scorpion = new ReadyValuePolicy({ countFavorGlory: true });
            expect(scorpion.evaluate({
                ...SPENT, gloryOnReady: 3, favorContested: false
            }).useful).toBe(false);
        });
    });

    describe('the disabled arm', function() {
        it('reproduces the pre-gate behaviour exactly', function() {
            const legacy = new ReadyValuePolicy({ enabled: false });
            expect(legacy.inert).toBe(true);
            expect(legacy.evaluate(SPENT).useful).toBe(true);
            expect(legacy.evaluate({}).useful).toBe(true);
        });
    });

    describe('move-into-conflict sources', function() {
        it('re-exports the list ReadyMovePlanner owns', function() {
            // One list, not two: the local copy this file used to check carried
            // `talisman-of-the-sun` (moves the RING) and
            // `into-the-forbidden-city` (discards an attachment), and the old
            // spec only proved the ids were real cards.
            expect(MOVE_INTO_CONFLICT_SOURCE_IDS).toContain('favorable-ground');
            expect(MOVE_INTO_CONFLICT_SOURCE_IDS).toContain('golden-plains-outpost');
            expect(MOVE_INTO_CONFLICT_SOURCE_IDS).not.toContain('talisman-of-the-sun');
            expect(MOVE_INTO_CONFLICT_SOURCE_IDS).not.toContain('into-the-forbidden-city');
        });

        it('lists only ids the engine actually ships', function() {
            // A typo here is silent: the id simply never matches, and the
            // ready-then-move branch stays dark forever. Check every id
            // against the engine's own card registry.
            const missing = MOVE_INTO_CONFLICT_SOURCE_IDS.filter((id) => !cards.has(id));
            expect(missing).withContext(
                `move-into-conflict ids with no card class: ${missing.join(', ')}`
            ).toEqual([]);
            expect(MOVE_INTO_CONFLICT_SOURCE_IDS.length).toBeGreaterThan(5);
        });
    });
});

describe('ready-effect playbook gates', function() {
    // Every card below can land its ready on a body at HOME, which is the only
    // case the policy withholds. Cards that already require a participant
    // (Fan of Command, The Pursuit of Justice) are unaffected by design.
    const HOME_READY_CARDS = [
        ['against-the-waves', { id: 'kudaka', bowed: true, inConflict: false, traits: ['shugenja'] }, 'shouldPlay'],
        ['i-am-ready', { bowed: true, inConflict: false, fate: 3 }, 'shouldPlay'],
        ['in-service-to-my-lord', { bowed: true, inConflict: false, isUnique: true }, 'shouldPlay'],
        ['elegance-and-grace', { bowed: true, inConflict: false, isHonored: true }, 'shouldPlay'],
        ['shiotome-encampment', { bowed: true, inConflict: false, traits: ['cavalry'] }, 'shouldUseAction'],
        ['magistrate-station', { bowed: true, inConflict: false, isHonored: true }, 'shouldUseAction'],
        ['steadfast-witch-hunter', { bowed: true, inConflict: false }, 'shouldUseAction']
    ];

    const baseCtx = (myCharacters, extra) => Object.assign({
        conflictType: 'military',
        losing: false,
        amAttacker: true,
        honor: 10,
        fate: 5,
        myCharacters,
        opponentCharacters: [],
        dynastyDiscard: [],
        conflictsRemaining: 0,
        opponentConflictsRemaining: 0
    }, extra || {});

    HOME_READY_CARDS.forEach(function([id, target, gateName]) {
        it(`${id}: refuses a home-only ready with nothing left to use it`, function() {
            const gate = getPlaybookEntry(id)[gateName];
            expect(gate).toEqual(jasmine.any(Function));
            // Some gates need extra bodies on the board (a non-unique to bow,
            // a third character to sacrifice); give them a READY spare so the
            // ready-value question is the only thing being answered.
            const spare = [{ bowed: false, inConflict: false, isUnique: false }, { bowed: false, inConflict: false }];
            const board = [target].concat(spare);
            expect(gate(baseCtx(board, { homeReadyIsUseful: false }))).toBe(false);
            expect(gate(baseCtx(board, { homeReadyIsUseful: true, conflictsRemaining: 1 }))).toBe(true);
        });

        it(`${id}: still fires for a bowed PARTICIPANT`, function() {
            const gate = getPlaybookEntry(id)[gateName];
            const participant = Object.assign({}, target, { inConflict: true });
            const spare = [{ bowed: false, inConflict: false, isUnique: false }, { bowed: false, inConflict: false }];
            expect(gate(baseCtx([participant].concat(spare), { homeReadyIsUseful: false })))
                .toBe(true);
        });
    });
});

describe('DeckProfile.readyValue', function() {
    it('ships enabled on the shared default', function() {
        expect(DEFAULT_PROFILE.readyValue.enabled).toBe(true);
        expect(DEFAULT_PROFILE.readyValue.countFavorGlory).toBe(false);
    });

    it('turns the Imperial Favor exception on for the Scorpion bid-war deck only', function() {
        const scorpion = resolveDeckProfile(
            ['kyuden-bayushi', 'censure', 'regal-bearing'],
            { bidWar: true }
        );
        expect(new ReadyValuePolicy(scorpion.readyValue).config.countFavorGlory).toBe(true);
        const generic = resolveDeckProfile(['banzai'], {});
        expect(new ReadyValuePolicy(generic.readyValue).config.countFavorGlory).toBe(false);
    });
});
