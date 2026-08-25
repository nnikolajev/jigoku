const {
    AttachmentControlTactics,
    ATTACHMENT_CONTROL_DEFAULTS,
    isNegativeAttachmentId
} = require('../../../build/server/game/bots/AttachmentControlTactics.js');
const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');

// Removal polarity for Let Go and Miya Mystic, both directions.
//
// A DEBUFF (Pacifism, Stolen Breath, Pit Trap, ...) is only worth removing from
// OUR character: the same card sitting on one of THEIRS is working for us, and
// taking it off hands them the body back. A BUFF is the mirror — only worth
// removing from theirs, never from ours.
//
// This was reachable before the fix: `attachmentWorth` prices an unknown enemy
// attachment at `6 + granted skill`, a debuff grants none, and the carrier
// weighting (fate * 2 + skill * 0.5) then lifts an enemy-carried Pacifism above
// the same Pacifism on one of our own bodies.
describe('attachment removal polarity (Let Go / Miya Mystic)', function() {
    const control = (overrides = {}) => new AttachmentControlTactics({
        ...ATTACHMENT_CONTROL_DEFAULTS,
        ...overrides
    });
    const skillOf = (card) => card.skill || 0;
    const carrier = (uuid, attachments, fate = 0, skill = 0) => ({ uuid, fate, skill, attachments });
    const pacifism = { uuid: 'pacifism', id: 'pacifism' };
    const stolenBreath = { uuid: 'stolen-breath', id: 'stolen-breath' };
    const katana = { uuid: 'katana', id: 'fine-katana', militarySkillSummary: { stat: 2 } };
    const tetsubo = { uuid: 'tetsubo', id: 'tetsubo-of-blood' };

    it('knows which ids are debuffs', function() {
        expect(isNegativeAttachmentId('pacifism')).toBe(true);
        expect(isNegativeAttachmentId('stolen-breath')).toBe(true);
        expect(isNegativeAttachmentId('fine-katana')).toBe(false);
        expect(isNegativeAttachmentId(undefined)).toBe(false);
    });

    it('clears a debuff from OUR character', function() {
        const mine = [carrier('mine', [pacifism], 2, 4)];
        expect(control().pickTarget(mine, [], skillOf)).toBe(pacifism);
    });

    it('never takes a debuff off THEIR character, however fat the carrier', function() {
        // Their body is deliberately huge: 6 fate and 9 skill scores 16.5 of
        // carrier weight on top of the 6-point floor, which beat our own
        // Pacifism (18 + a small carrier) before the fix.
        const theirs = [carrier('theirs', [pacifism, stolenBreath], 6, 9)];
        expect(control().pickTarget([], theirs, skillOf)).toBeNull();

        const mine = [carrier('mine', [{ ...pacifism, uuid: 'own-pacifism' }], 0, 1)];
        expect(control().pickTarget(mine, theirs, skillOf).uuid).toBe('own-pacifism');
    });

    it('still removes a BUFF from their character, and never one of ours', function() {
        const mine = [carrier('mine', [katana], 4, 7)];
        const theirs = [carrier('theirs', [tetsubo], 1, 3)];
        // Our own weapon is not a candidate at all; theirs is.
        expect(control().pickTarget(mine, theirs, skillOf).id).toBe('tetsubo-of-blood');
        expect(control().pickTarget(mine, [], skillOf)).toBeNull();
    });

    it('`removeOwnDebuffsOnly: false` restores the pre-fix ordering', function() {
        const theirs = [carrier('theirs', [pacifism], 6, 9)];
        expect(control({ removeOwnDebuffsOnly: false }).pickTarget([], theirs, skillOf)).toBe(pacifism);
    });

    describe('play gates', function() {
        const letGo = getPlaybookEntry('let-go').shouldPlay;
        const miya = getPlaybookEntry('miya-mystic').shouldUseAction;
        const ctx = (mine, theirs, extra = {}) => ({
            myCharacters: mine,
            opponentCharacters: theirs,
            hand: [],
            removeOwnDebuffsOnly: true,
            ...extra
        });

        it('Let Go fires for an own debuff or an enemy BUFF, never for an enemy debuff', function() {
            expect(letGo(ctx([carrier('mine', [pacifism])], []))).toBe(true);
            expect(letGo(ctx([], [carrier('theirs', [katana])]))).toBe(true);
            expect(letGo(ctx([], [carrier('theirs', [pacifism])]))).toBe(false);
            expect(letGo(ctx([carrier('mine', [katana])], []))).toBe(false);
        });

        it('Miya Mystic answers an own debuff only with the urgency knob on', function() {
            const own = [carrier('mine', [pacifism])];
            expect(miya(ctx(own, []))).toBe(false);
            expect(miya(ctx(own, [], { debuffRemovalUrgency: true }))).toBe(true);
        });

        it('Miya Mystic stands down while a Let Go is in hand', function() {
            const own = [carrier('mine', [pacifism])];
            expect(miya(ctx(own, [], {
                debuffRemovalUrgency: true,
                hand: [{ id: 'let-go' }]
            }))).toBe(false);
        });

        it('`removeOwnDebuffsOnly: false` restores the pre-fix gates', function() {
            expect(letGo(ctx([], [carrier('theirs', [pacifism])], {
                removeOwnDebuffsOnly: false
            }))).toBe(true);
        });

        it('Miya Mystic never fires for a debuff on THEIR character', function() {
            expect(miya(ctx([], [carrier('theirs', [pacifism])], {
                debuffRemovalUrgency: true
            }))).toBe(false);
            expect(miya(ctx([], [carrier('theirs', [katana])]))).toBe(true);
        });
    });
});
