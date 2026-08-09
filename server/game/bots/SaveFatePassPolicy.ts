// Early-round fate floor.
//
// NAME: the file is called `SaveFatePassPolicy` for history — it began as an
// attempt at the Kyuden Bayushi primer's "pass turn two to save fate" advice.
// Every PASS/RESERVE variant of that idea measured negative and has been
// removed; what survived is the opposite instinct, spending one MORE fate
// early. `docs/bot-fate-starvation.md` has the full record and the exact
// configurations, for anyone reviving the experiment.
//
// WHAT IT DOES
// In `setupRounds`, every character bought is given at least
// `setupAdditionalFate` extra fate. The floor RAISES the deck's own answer and
// never lowers it, so a Dragon tower that wants two keeps two.
//
// WHY
// `FatePhase` discards characters with NO fate at step 4.2, before step 4.3
// removes a fate — so a body bought with zero extra fate dies in the same
// round it was bought. Censused across the field, V1 answered ZERO to the
// additional-fate prompt on essentially every early buy: 1011 raises over 1088
// games, every one from a natural answer of 0. It was paying for bodies that
// were guaranteed to be discarded minutes later, which is why V1 reached the
// round-two dynasty window with no characters 33% of the time and exactly one
// 57% of the time.
//
// MEASURED (head-to-head rig, hard 50% baseline, null arm exactly 50.00%,
// every number on six shuffle bases never used to find it):
//   round 1 only            +2.22pp  z=2.54  p=0.011    6/6 bases positive
//   extended to rounds 1-3  +4.14pp  z=4.73  p<0.0001   6/6 bases positive
// Rejected extensions: past round 3 (+0.80pp, p=0.36) and raising the amount
// to 2 (+0.69pp, p=0.45). DURATION paid, AMOUNT did not — which fits the
// mechanism, since the body that dies for want of one fate is bought every
// round, not only in round one.

export interface SaveFatePassProfile {
    // Rounds in which every character bought gets the fate floor. Empty
    // disables the feature entirely.
    setupRounds: readonly number[];
    // The floor, in extra fate. It raises the deck's own answer and never
    // lowers it, and it deliberately overrides the dynasty economy's BUDGET
    // cap — spending one more fate now is the whole claim. Affordability still
    // binds: the engine only offers legal amounts, and 134 of 1011 measured
    // raises could not reach 1 and stayed at 0.
    setupAdditionalFate: number;
}

export const DEFAULT_SAVE_FATE_PASS: SaveFatePassProfile = {
    setupRounds: [],
    setupAdditionalFate: 1
};

export class SaveFatePassPolicy {
    readonly profile: SaveFatePassProfile;

    constructor(profile: Partial<SaveFatePassProfile> = {}) {
        this.profile = { ...DEFAULT_SAVE_FATE_PASS, ...profile };
    }

    // True when this profile can never fire, so the call site stays out of the
    // way entirely and an unopted deck runs the untouched code path.
    get inert(): boolean {
        return this.profile.setupRounds.length === 0 || this.profile.setupAdditionalFate <= 0;
    }

    // Extra fate floor for a body bought this round, 0 when the floor is off
    // or the round is not one of its own.
    setupFateFloor(roundNumber: number): number {
        return !this.inert && this.profile.setupRounds.includes(roundNumber)
            ? this.profile.setupAdditionalFate
            : 0;
    }
}
