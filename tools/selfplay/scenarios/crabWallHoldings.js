'use strict';

// How much is each Crab wall holding actually worth on defence?
//
// Every variant is the SAME attack against the SAME province with the SAME
// bodies, fate and conflict cards on both sides — only the holding sitting in
// the defended province changes. Both seats are the real bot, so a holding's
// Action or Reaction fires when the bot judges it worth firing, which is the
// whole reason printed strength alone cannot price these.
//
//   node tools/selfplay/cardLab.js tools/selfplay/scenarios/crabWallHoldings.js 12
//
// The control variant has NO holding in the province, so every row reads as
// "what this holding bought over an empty province slot".

const holdingVariant = (label, holding) => ({
    label,
    player2: {
        provinces: {
            'province 1': {
                provinceCard: 'Defend the Wall',
                dynastyCards: holding ? [holding] : []
            }
        }
    }
});

module.exports = {
    name: 'Crab wall holdings — controlled defence of one province',
    phase: 'conflict',
    rounds: 2,
    repeats: 12,
    defendingSeat: 'player2',
    targetProvinceId: 'defend-the-wall',
    control: 'no holding',

    // The attack has to be genuinely dangerous or every variant saves the
    // province and the measurement saturates at 100%. This board breaks a bare
    // strength-4 province roughly half the time, which is where the holdings
    // can actually separate.
    player1: {
        faction: 'lion',
        inPlay: ['Matsu Berserker'],
        hand: ['Ready for Battle', 'Fine Katana', 'Charge!'],
        fate: 8,
        honor: 11
    },

    // Pressure ladder. Sweeping the attack instead of hand-tuning one board to
    // the knife edge: the answer becomes "at what attack size does this holding
    // stop saving the province", which is a property of the card rather than of
    // the fixture.
    // Defender board is 1+4+4 = 9 military, so the rungs step the attack from
    // well under that to well over it.
    ladder: [
        { label: 'atk 7', player1: { inPlay: ['Matsu Seventh Legion'] } },
        { label: 'atk 10', player1: { inPlay: ['Matsu Seventh Legion', 'Matsu Berserker'] } },
        { label: 'atk 13', player1: { inPlay: ['Matsu Seventh Legion', 'Unified Company'] } },
        {
            label: 'atk 16',
            player1: { inPlay: ['Matsu Seventh Legion', 'Unified Company', 'Matsu Berserker'] }
        },
        {
            label: 'atk 19',
            player1: {
                inPlay: ['Matsu Seventh Legion', 'Unified Company', 'Matsu Berserker',
                    'Matsu Berserker']
            }
        }
    ],

    // Defender: enough board to make a real decision, not enough to make the
    // holding irrelevant. Fate is present so holding ACTIONS are affordable.
    player2: {
        faction: 'crab',
        stronghold: 'Kyūden Hida',
        inPlay: ['Hida Guardian', 'Intimidating Hida', 'Hiruma Yōjimbō'],
        hand: ['Way of the Crab', 'Ornate Fan'],
        fate: 8,
        honor: 11,
        provinces: {
            'province 1': { provinceCard: 'Defend the Wall' },
            'province 2': { provinceCard: 'Shameful Display' }
        }
    },

    variants: [
        holdingVariant('no holding', null),
        holdingVariant('northern-curtain-wall (+4)', 'Northern Curtain Wall'),
        holdingVariant('kaiu-forges (+3)', 'Kaiu Forges'),
        holdingVariant('seventh-tower (+2)', 'Seventh Tower'),
        holdingVariant('watchtower-of-valor (+1)', 'Watchtower of Valor'),
        holdingVariant('watchtower-suns-shadow (+1)', 'Watchtower of Sun\'s Shadow'),
        holdingVariant('third-whisker-warrens (+1)', 'Third Whisker Warrens'),
        holdingVariant('river-of-last-stand (+0)', 'River of the Last Stand'),

        // Three of the Crab holdings above only do anything "at a province you
        // control with a Kaiu Wall holding". A one-holding swap therefore
        // disables them by construction, and their rows above measure their
        // printed strength and nothing else. These pair them with a wall so the
        // text can actually turn on.
        {
            label: 'pair: curtain+suns-shadow',
            player2: {
                provinces: {
                    'province 1': {
                        provinceCard: 'Defend the Wall',
                        dynastyCards: ['Watchtower of Sun\'s Shadow']
                    },
                    'province 2': {
                        provinceCard: 'Shameful Display',
                        dynastyCards: ['Northern Curtain Wall']
                    }
                }
            }
        },
        {
            label: 'pair: curtain+whisker',
            player2: {
                provinces: {
                    'province 1': {
                        provinceCard: 'Defend the Wall',
                        dynastyCards: ['Third Whisker Warrens']
                    },
                    'province 2': {
                        provinceCard: 'Shameful Display',
                        dynastyCards: ['Northern Curtain Wall']
                    }
                }
            }
        },
        {
            label: 'pair: curtain+river',
            player2: {
                provinces: {
                    'province 1': {
                        provinceCard: 'Defend the Wall',
                        dynastyCards: ['River of the Last Stand']
                    },
                    'province 2': {
                        provinceCard: 'Shameful Display',
                        dynastyCards: ['Northern Curtain Wall']
                    }
                }
            }
        }
    ]
};
