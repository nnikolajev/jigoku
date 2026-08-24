'use strict';

// OPEN ATTACHMENT-PLACEMENT DEFECTS, listed rather than hidden.
//
// Same pattern as `polarityallowances.js` and `readymoveallowances.js`: the
// live suite (`botattachmentvalue.spec.js`) fails on anything NEW, and the
// cards below are the ones already known to reach an idle placement through a
// path with no gate yet.
//
// Removing an entry is how a fix gets locked in. Adding one is only ever
// correct for a defect that has been triaged and written down here; a fresh
// finding should be fixed, not listed.

// source card id -> why it is still open.
const KNOWN_ATTACHMENT_DEFECTS = Object.freeze({
    // ONE prompt chooses the body that is dishonored AND the body that
    // receives the stolen attachment, and the two halves want opposite
    // answers: a dishonor costs a participant its glory off both skills, while
    // the attachment is only worth anything on a participant. The bot answers
    // it as a pure dishonor cost (`pickForcedOwnDishonor`, lowest glory), which
    // is defensible — pricing it properly needs the stolen attachment's bonus,
    // and that is chosen in a different prompt.
    'calling-in-favors': 'dishonor cost and attachment bearer are the same prompt with opposite optima'
});

function attachmentDefectIds() {
    return Object.keys(KNOWN_ATTACHMENT_DEFECTS);
}

module.exports = { KNOWN_ATTACHMENT_DEFECTS, attachmentDefectIds };
