'use strict';

// Deterministic draw-dial laboratory. It exercises representative honor,
// fate, hand, ring, board, and province states against every reusable profile,
// with the frozen legacy result beside the adaptive result.

const {
    CARD_ENGINE_DRAW_BID_PROFILE,
    DEFAULT_DRAW_BID_PROFILE,
    DEFAULT_LEGACY_DRAW_BID_PROFILE,
    DISHONOR_DRAW_BID_PROFILE,
    DISHONOR_LEGACY_DRAW_BID_PROFILE,
    DrawBidTactics,
    HONOR_DRAW_BID_PROFILE,
    LegacyDrawBidTactics,
    LION_LEGACY_DRAW_BID_PROFILE,
    TOWER_DRAW_BID_PROFILE
} = require('../../build/server/game/bots/DrawBidTactics.js');

const EMPTY_BOARD = Object.freeze({
    characterCount: 0,
    readyCharacterCount: 0,
    persistentCharacterCount: 0,
    attachmentCount: 0,
    totalCharacterFate: 0,
    militarySkill: 0,
    politicalSkill: 0
});

const BASE = Object.freeze({
    roundNumber: 3,
    myHonor: 11,
    opponentHonor: 11,
    myHandCount: 4,
    opponentHandCount: 4,
    myFate: 5,
    opponentFate: 5,
    fateOnUnclaimedRings: 0,
    myBrokenProvinces: 0,
    opponentBrokenProvinces: 0,
    averageConflictCardCost: 1,
    handCardCosts: [0, 1, 1, 2],
    board: EMPTY_BOARD,
    legalBids: [1, 2, 3, 4, 5]
});

const SCENARIOS = Object.freeze([
    ['opening', { roundNumber: 1 }],
    ['normal economy', {}],
    ['no fate / costly deck', { myFate: 0, averageConflictCardCost: 2, handCardCosts: [2, 3, 4] }],
    ['no fate / cheap deck', { myFate: 0, averageConflictCardCost: 0.4, handCardCosts: [0, 0, 1] }],
    ['ring fate available', { myFate: 1, fateOnUnclaimedRings: 5, averageConflictCardCost: 1.8 }],
    ['crowded hand', { myHandCount: 11, handCardCosts: [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4] }],
    ['tower established', {
        myFate: 8,
        board: {
            characterCount: 4,
            readyCharacterCount: 4,
            persistentCharacterCount: 4,
            attachmentCount: 6,
            totalCharacterFate: 8,
            militarySkill: 18,
            politicalSkill: 15
        }
    }],
    ['own honor danger', { myHonor: 6 }],
    ['opponent dishonor chance', { opponentHonor: 6 }],
    ['own honor win chance', { myHonor: 19 }],
    ['opponent honor danger', { opponentHonor: 21 }],
    ['defend stronghold', { myBrokenProvinces: 3 }],
    ['attack stronghold', { opponentBrokenProvinces: 3 }],
    ['honor bait', { myHonor: 16, opponentHandCount: 1, opponentFate: 7 }]
]);

const PROFILES = Object.freeze({
    generic: [DEFAULT_DRAW_BID_PROFILE, DEFAULT_LEGACY_DRAW_BID_PROFILE],
    'card-engine': [CARD_ENGINE_DRAW_BID_PROFILE, DEFAULT_LEGACY_DRAW_BID_PROFILE],
    honor: [HONOR_DRAW_BID_PROFILE, LION_LEGACY_DRAW_BID_PROFILE],
    dishonor: [DISHONOR_DRAW_BID_PROFILE, DISHONOR_LEGACY_DRAW_BID_PROFILE],
    tower: [TOWER_DRAW_BID_PROFILE, DEFAULT_LEGACY_DRAW_BID_PROFILE]
});

function rows() {
    const result = [];
    for(const [profileName, [adaptiveProfile, legacyProfile]] of Object.entries(PROFILES)) {
        const adaptive = new DrawBidTactics(adaptiveProfile);
        const legacy = new LegacyDrawBidTactics(legacyProfile);
        for(const [scenario, overrides] of SCENARIOS) {
            const state = { ...BASE, ...overrides };
            const next = adaptive.analyze(state);
            const old = legacy.analyze(state);
            result.push({
                profile: profileName,
                scenario,
                adaptive: next.selectedBid,
                legacy: old.selectedBid,
                delta: next.selectedBid - old.selectedBid,
                reason: next.reason,
                effectiveFate: Number(next.effectiveFate.toFixed(1)),
                usefulDraws: Number(next.estimatedUsefulDraws.toFixed(1))
            });
        }
    }
    return result;
}

function render(table) {
    const widths = {
        profile: Math.max(7, ...table.map((row) => row.profile.length)),
        scenario: Math.max(8, ...table.map((row) => row.scenario.length)),
        reason: Math.max(6, ...table.map((row) => row.reason.length))
    };
    console.log(`${'profile'.padEnd(widths.profile)}  ${'scenario'.padEnd(widths.scenario)}  new old delta  fate useful  ${'reason'.padEnd(widths.reason)}`);
    console.log(`${'-'.repeat(widths.profile)}  ${'-'.repeat(widths.scenario)}  --- --- -----  ---- ------  ${'-'.repeat(widths.reason)}`);
    for(const row of table) {
        console.log(`${row.profile.padEnd(widths.profile)}  ${row.scenario.padEnd(widths.scenario)}  ` +
            `${String(row.adaptive).padStart(3)} ${String(row.legacy).padStart(3)} ${String(row.delta).padStart(5)}  ` +
            `${String(row.effectiveFate).padStart(4)} ${String(row.usefulDraws).padStart(6)}  ${row.reason}`);
    }
}

if(require.main === module) {
    const table = rows();
    if(process.argv.includes('--json')) {
        console.log(JSON.stringify(table, null, 2));
    } else {
        render(table);
    }
}

module.exports = { BASE, PROFILES, SCENARIOS, rows };
