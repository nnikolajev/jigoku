'use strict';

// DECLARED EXCEPTIONS to the bot effect-polarity invariant.
//
// The invariant (see effectpolarity.js) is: ready/honor land on our own
// characters, bow/dishonor land on theirs. COSTS and SELF-SOURCED effects are
// already exempt inside the monitor and do NOT belong here.
//
// Nothing in this file excuses a bot DECISION. The monitor classifies every
// wrong-side landing as `avoidable` (a correct-side character the action could
// legally have hit was selectable at the click that chose the target) or
// `forced` (there was none). The specs fail on ANY avoidable landing, listed
// here or not. This file only covers the forced ones, which fall into two
// kinds:
//
//   printed text — the card names both sides. Honored Veterans honors a Bushi
//                  EACH PLAYER chose; Game of Sadane honors the duel's winner
//                  whoever that turns out to be. Nothing to fix, ever.
//   engine-forced — the card is one-sided but the board removed every legal
//                  target on the right side. Water Ring's "bow or ready a
//                  character" with our board all ready and theirs all bowed has
//                  no good answer left; the bot takes the cheapest bad one.
//
// Keys are card ids (rings report their name as the effect source). Values are
// `${action}:${side}` strings, where side is the side the effect LANDED on, so
// `honor:enemy` means "this card may honor an opponent's character".

const POLARITY_ALLOWANCES = Object.freeze({
    // ---- printed text hits both sides -------------------------------------
    // "Each player chooses up to one Bushi character they played this phase —
    // honor each of those characters." The opponent picks their own.
    'honored-veterans': ['honor:enemy'],
    // "Choose a participating character controlled by each player — honor each
    // of those characters."
    'kiku-matsuri': ['honor:enemy'],
    // "Honor each character."
    'festival-for-the-fortunes': ['honor:enemy'],
    // "...your character challenges the opponent's character to a political
    // duel. Honor the duel's winner and dishonor the duel's loser." Either
    // side can win, so either token can land on either side.
    'game-of-sadane': ['honor:enemy', 'dishonor:own'],
    // "Initiate a military duel — resolve the duel. Honor the duel's winner."
    'aspiring-challenger': ['honor:enemy'],
    // "...bow and move home each participating character." Ours are
    // participating too; the card names no side.
    'diversionary-maneuver': ['bow:own'],
    // "After this province is revealed — bow each attacking character."
    'flooded-waste': ['bow:own'],
    // "Return this attachment to your hand and dishonor attached character."
    // Court Mask attaches to a character you control.
    'court-mask': ['dishonor:own'],
    // "Bow a character or take an honor from your opponent" on an ATTACKING
    // character, with the OPPONENT choosing which half resolves.
    'the-eternal-watch': ['bow:own'],

    // ---- one-sided cards the board left no legal right-side target for ----
    // "Bow or ready a character." With our whole board ready and theirs whole
    // board bowed, every remaining option either readies one of theirs or bows
    // one of ours. `water-ring-forced-least-harm` takes the lowest-skill of
    // them; the alternative (returning nothing) dropped the prompt into the
    // generic card ranking, which bowed our best character instead.
    'Water Ring': ['ready:enemy', 'bow:own'],
    // Two prompts: pick a character, then honor or dishonor it. When the pick
    // turns out not to be able to take the token the follow-up offers only the
    // other half. The bot now takes "Don't resolve the fire ring" whenever that
    // button exists; this covers the resolutions where it does not.
    'Fire Ring': ['dishonor:own'],
    // "Choose two characters — honor one and dishonor the other." With no own
    // character able to take an honor and no enemy able to take a dishonor the
    // card inverts by construction. The bot cancels when the prompt still
    // offers Cancel; this covers the rest.
    'shameful-display': ['honor:enemy', 'dishonor:own']
});

// Open BOT defects — bugs the suite is knowingly tolerating so that it can
// still fail on something new. Empty: as of 2026-08-13 every wrong-side
// landing over 1088 cross-deck games (4 bases, 17 decks, both seats) is
// engine-forced. See docs/bot-effect-polarity.md for the eight that were
// fixed to get here. If one is ever added back, it must name the branch that
// produces it.
const KNOWN_POLARITY_DEFECTS = Object.freeze({});

// Deck-level allowances, keyed by the self-play deck label. Scorpion decks
// dishonor their own characters on purpose (Shosuro Sadako inverts the honor
// modifier while dishonored; Calling in Favors and Acclaimed Geisha House pay a
// friendly dishonor), which is why their DeckProfile carries
// `personalHonor.ownDishonorCostSourceIds`.
const DECK_ALLOWANCES = Object.freeze({
    Scorpion: ['dishonor:own'],
    ScorpionBidWar: ['dishonor:own']
});

function seatAllowancesFor(deckLabel) {
    return DECK_ALLOWANCES[deckLabel] || [];
}

// The allowance list the specs run with: printed-text and engine-forced
// exceptions plus any currently-open defect, so a run only fails on something
// new.
function allowancesWithKnownDefects() {
    const merged = {};
    for(const [id, rules] of Object.entries(POLARITY_ALLOWANCES)) {
        merged[id] = rules.slice();
    }
    for(const [id, rules] of Object.entries(KNOWN_POLARITY_DEFECTS)) {
        merged[id] = (merged[id] || []).concat(rules);
    }
    return merged;
}

module.exports = {
    POLARITY_ALLOWANCES,
    KNOWN_POLARITY_DEFECTS,
    DECK_ALLOWANCES,
    seatAllowancesFor,
    allowancesWithKnownDefects
};
