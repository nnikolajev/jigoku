'use strict';

// OPEN READY/MOVE DEFECTS, listed rather than hidden.
//
// Same pattern as `polarityallowances.js`: the live suites
// (`botreadyvalue.spec.js`) fail on anything NEW, and the sources below are the
// ones already known to reach a pointless ready or a pointless move through a
// code path that has no gate yet. Every one of them predates
// `ReadyValuePolicy` / `ReadyMovePlanner` and was FOUND by those suites — none
// is a regression from them.
//
// Removing an entry from this list is how a fix gets locked in. Adding one is
// only ever correct for a defect that has been triaged and written down here;
// a fresh finding should be fixed, not listed.
//
// The generic gates already shipped cover the common paths:
//   * `CardPlaybook.readyIsWorthACard`      — every ready card's own play gate
//   * `READY_STRONGHOLD_IDS`                — stronghold ready Actions
//   * `READY_REACTION_IDS`                  — ready-only reaction windows
//   * the pure-ready target prompt guard    — declines when a Cancel/Done exists
//   * the move-source arrival guard         — filters 0-skill arrivals
//
// What is left below are prompts with NO way to decline (a mandatory target on
// an ability the bot already committed to) and deck-specific branches that
// choose their own target before any shared gate sees them.

// source card id -> why it is still open.
const KNOWN_READY_DEFECTS = Object.freeze({
    // Province Actions. `checkProvinceCondition` makes these legal only during
    // a conflict at that province, and the target prompt offers no Cancel, so
    // the fix has to be at ACTIVATION — the province-action path does not
    // consult the playbook `shouldUseAction` the way the in-play path does.
    'magistrate-station': 'province Action; activation path ignores shouldUseAction',
    'sacred-sanctuary': 'province Reaction on attack; no decline offered',
    // Deck branches that pick their own ready target before the shared guard.
    'asako-azunami': 'RebirthTactics ready branch has no ready-value gate',
    'kyuden-bayushi': 'BidWarTactics stronghold branch; glory-less target slips the favor exception',
    'steadfast-witch-hunter': 'CrabSacrificeTactics ready branch has no ready-value gate',
    // The Imperial Favor exception is a BOARD-level reading: it opens as soon
    // as any bowed body at home carries glory. Elegant Tessen readies the body
    // it attached to, which may carry none, so on the Scorpion bid-war profile
    // the exception can open the window for a target that cannot use it. The
    // fix is a per-candidate favor check, not a per-card gate.
    'elegant-tessen': 'favor-glory exception is board-level; Tessen readies its own bearer'
});

// source card id -> why it is still open.
const KNOWN_MOVE_DEFECTS = Object.freeze({
    // The bearer is chosen when the ATTACHMENT is played; the move happens in a
    // reaction afterwards, by which point the bearer may have bowed. Planning
    // it needs the attachment-target machinery, which is why `hawk-tattoo` is
    // deliberately absent from `MOVE_SOURCES`.
    'hawk-tattoo': 'move is an enter-play Reaction; bearer chosen before the move',
    // LionDuelist reaches Favorable Ground through its own branch, which ranks
    // by the deck axis rather than the contested one.
    'favorable-ground': 'LionDuelist branch ranks on the deck axis, not the contested axis',
    // The MIRROR of the ready -> move sequence, and the next thing to build.
    // `UnicornTactics` deliberately moves a bowed "supported" carrier in,
    // expecting to ready it afterwards (I Am Ready from hand, Shiotome
    // Encampment). `readyAfterMoveUuids` proves that ready is LEGAL, but
    // nothing budgets or commits it the way `ReadyMovePlanner` does for
    // ready -> move, so the bot can move and then not ready. Measured live as
    // `Golden Plains Outpost moved Young Warrior in (bowed, 0 skill on
    // arrival, 0 at resolution)`.
    'golden-plains-outpost': 'move -> ready follow-through is not planned; see ReadyMovePlanner',
    'ride-on': 'move -> ready follow-through is not planned; see ReadyMovePlanner'
});

function readyDefectIds() {
    return Object.keys(KNOWN_READY_DEFECTS);
}

function moveDefectIds() {
    return Object.keys(KNOWN_MOVE_DEFECTS);
}

module.exports = {
    KNOWN_READY_DEFECTS,
    KNOWN_MOVE_DEFECTS,
    readyDefectIds,
    moveDefectIds
};
