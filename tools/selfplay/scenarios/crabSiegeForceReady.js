'use strict';

// Does reviving Kaiu Siege Force actually save the province?
//
// A second use of the lab, and a different KIND of variant: the board is fixed
// and the BOT CONFIGURATION changes. Kaiu Siege Force is structurally dead in
// both engines — its playbook priority is 5 and the triggered-ability window
// drops anything below 6 — so full self-play cannot measure it at all: the games
// where a 6-cost unique is in play, bowed, with a spare holding are a small and
// noisy minority. Here that situation is the fixture.
//
//   node tools/selfplay/cardLab.js tools/selfplay/scenarios/crabSiegeForceReady.js 8
//
// The Siege Force starts BOWED, as it would after attacking, with one wall it
// can afford to lose (Watchtower of Valor) and one it cannot (Northern Curtain
// Wall). A correct model bottoms the cheap one and readies a 7-military body
// into the defence; a naive one bottoms the wall that was holding the province.

const ALLOW_SIEGE_FORCE = {
    deckProfile: { conflictPlanning: { triggeredAbilityAllowIds: ['kaiu-siege-force'] } }
};

module.exports = {
    name: 'Kaiu Siege Force — is the ready worth the holding?',
    phase: 'conflict',
    rounds: 2,
    repeats: 8,
    defendingSeat: 'player2',
    targetProvinceId: 'defend-the-wall',
    control: 'V1 (ability structurally dead)',

    player1: {
        faction: 'lion',
        inPlay: ['Matsu Seventh Legion', 'Matsu Berserker'],
        hand: ['Ready for Battle', 'Fine Katana'],
        fate: 8,
        honor: 11
    },

    player2: {
        faction: 'crab',
        stronghold: 'Kyūden Hida',
        // Bowed, exactly as it would be after attacking. Its Action is the only
        // thing that can bring it back for the defence.
        inPlay: [{ card: 'Kaiu Siege Force', bowed: true }, 'Hida Guardian'],
        hand: ['Way of the Crab'],
        fate: 8,
        honor: 11,
        provinces: {
            'province 1': {
                provinceCard: 'Defend the Wall',
                dynastyCards: ['Watchtower of Valor']
            },
            'province 2': {
                provinceCard: 'Shameful Display',
                dynastyCards: ['Northern Curtain Wall']
            }
        }
    },

    variants: [
        { label: 'V1 (ability structurally dead)', seats: ['v1', 'v1'] },
        { label: 'V2 default (still dead)', seats: ['v1', 'v2'] },
        {
            label: 'V2 + siege force admitted',
            seats: ['v1', 'v2'],
            v2Profiles: [undefined, ALLOW_SIEGE_FORCE]
        }
    ]
};
