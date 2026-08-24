const {
    MoveIntoConflictPolicy,
    DEFAULT_MOVE_INTO_CONFLICT
} = require('../../../build/server/game/bots/MoveIntoConflictPolicy.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

describe('MoveIntoConflictPolicy', function() {
    const policy = new MoveIntoConflictPolicy();
    const input = (extra = {}) => ({
        uuid: 'body',
        cardId: 'border-rider',
        bowed: false,
        declarable: true,
        ...extra
    });

    it('ships enabled on every deck profile and clones its id lists', function() {
        expect(DEFAULT_MOVE_INTO_CONFLICT.enabled).toBe(true);
        const flags = { aggressive: true, defensive: false, holdingEngine: false, dishonor: false };
        const first = resolveDeckProfile(['cavalry-reserves', 'ride-on'], flags);
        const second = resolveDeckProfile(['cavalry-reserves', 'ride-on'], flags);
        expect(first.moveIntoConflict.enabled).toBe(true);
        first.moveIntoConflict.riderSourceIds.push('mutation');
        expect(second.moveIntoConflict.riderSourceIds).not.toContain('mutation');
    });

    // The 2026-08-24 replay: Ride On moved a READY Border Rider into a conflict
    // the bot had just declined to defend. Declaring it was free.
    it('refuses a movement card on a body the declaration step could have taken', function() {
        const verdict = policy.judge(input({ sourceCardId: 'ride-on' }));
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toBe('declarable-waste');
    });

    it('allows a bowed body, which cannot be declared at all', function() {
        expect(policy.judge(input({ bowed: true, sourceCardId: 'ride-on' })))
            .toEqual({ allowed: true, reason: 'bowed' });
    });

    // Covert, Shinjo Yasamura and Butcher of the Fallen all express themselves
    // the same way: the body is not clickable at the declaration prompt, so it
    // never enters the declarable set.
    it('allows a ready body that was blocked from declaring', function() {
        expect(policy.judge(input({ declarable: false, sourceCardId: 'ride-on' })))
            .toEqual({ allowed: true, reason: 'undeclarable' });
    });

    it('allows Adorned Barcha on a declarable bearer: the enemy bow is the card', function() {
        expect(policy.judge(input({ sourceCardId: 'adorned-barcha' })))
            .toEqual({ allowed: true, reason: 'source-rider' });
    });

    // A source that costs nothing to use wastes nothing. Golden Plains Outpost
    // pays by bowing the STRONGHOLD, which contributes no skill and has no
    // other ability, so the bow gives up only this same move for the rest of
    // the round (owner's call, 2026-08-24).
    it('allows the free move sources on a declarable body', function() {
        for(const sourceCardId of ['formal-invitation', 'matsu-mitsuko', 'golden-plains-outpost']) {
            expect(policy.judge(input({ sourceCardId })))
                .withContext(sourceCardId)
                .toEqual({ allowed: true, reason: 'free-source' });
        }
        // Ride On costs a card out of hand and is still refused.
        expect(policy.judge(input({ sourceCardId: 'ride-on' })).allowed).toBe(false);
    });

    it('allows a ready Twilight Rider only while a bowed body is there to ready', function() {
        const moving = input({ cardId: 'twilight-rider', sourceCardId: 'ride-on' });
        expect(policy.judge({ ...moving, moveReactionPays: true }))
            .toEqual({ allowed: true, reason: 'move-reaction' });
        expect(policy.judge({ ...moving, moveReactionPays: false }).allowed).toBe(false);
    });

    // Spyglass draws "after attached character commits to a conflict OR moves
    // to a conflict", so declaring the bearer collects the same card for free.
    it('does not treat Spyglass as a reason to move a declarable bearer', function() {
        expect(policy.judge(input({ cardId: 'spyglass-bearer', sourceCardId: 'ride-on' })).allowed)
            .toBe(false);
    });

    it('keeps the Moto Stables move bonus behind its own knob', function() {
        const stables = input({ sourceCardId: 'ride-on', moveBonusSkill: 2, skillStillNeeded: 2 });
        expect(policy.judge(stables).allowed).toBe(false);
        const opened = new MoveIntoConflictPolicy({ allowMoveBonusOnDeclarableBody: true });
        expect(opened.judge(stables)).toEqual({ allowed: true, reason: 'move-bonus' });
        // Still refused when the conflict does not need the skill.
        expect(opened.judge({ ...stables, skillStillNeeded: 0 }).allowed).toBe(false);
    });

    it('is inert when disabled, which is the pre-gate behaviour exactly', function() {
        const off = new MoveIntoConflictPolicy({ enabled: false });
        expect(off.inert).toBe(true);
        expect(off.judge(input({ sourceCardId: 'ride-on' })))
            .toEqual({ allowed: true, reason: 'off' });
    });
});
