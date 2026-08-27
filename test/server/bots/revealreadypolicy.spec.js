const {
    RevealReadyPolicy,
    DEFAULT_REVEAL_READY
} = require('../../../build/server/game/bots/RevealReadyPolicy.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

describe('RevealReadyPolicy', function() {
    const TATTOO = { enabled: true, attachmentIds: ['waterfall-tattoo'], requireAllProvincesFacedown: false };
    const bearer = { uuid: 'bearer', id: 'mirumoto-raitsugu', attachments: [{ id: 'waterfall-tattoo' }] };
    const plain = { uuid: 'plain', id: 'niten-master', attachments: [{ id: 'fine-katana' }] };
    const board = [bearer, plain];

    it('is inert by default, which is V1 exactly', function() {
        const policy = new RevealReadyPolicy();
        expect(policy.inert).toBe(true);
        expect(policy.freeAttackerUuids({
            myCharacters: board, provinces: { facedown: 3, faceup: 1 }
        })).toEqual([]);
        expect(DEFAULT_REVEAL_READY.enabled).toBe(false);
    });

    it('is inert with the flag on but no attachment named', function() {
        expect(new RevealReadyPolicy({ enabled: true, attachmentIds: [] }).inert).toBe(true);
    });

    it('frees only the bodies carrying the named attachment', function() {
        expect(new RevealReadyPolicy(TATTOO).freeAttackerUuids({
            myCharacters: board, provinces: { facedown: 3, faceup: 1 }
        })).toEqual(['bearer']);
    });

    it('frees nothing when no province is left to reveal', function() {
        expect(new RevealReadyPolicy(TATTOO).freeAttackerUuids({
            myCharacters: board, provinces: { facedown: 0, faceup: 4 }
        })).toEqual([]);
    });

    it('can demand every province be facedown before trusting the reveal', function() {
        const strict = new RevealReadyPolicy({ ...TATTOO, requireAllProvincesFacedown: true });
        // One faceup province gives the opponent a target that reveals nothing.
        expect(strict.freeAttackerUuids({
            myCharacters: board, provinces: { facedown: 3, faceup: 1 }
        })).toEqual([]);
        expect(strict.freeAttackerUuids({
            myCharacters: board, provinces: { facedown: 4, faceup: 0 }
        })).toEqual(['bearer']);
    });

    it('counts every free body, not just the first', function() {
        const second = { uuid: 'second', id: 'niten-master', attachments: [{ id: 'waterfall-tattoo' }] };
        expect(new RevealReadyPolicy(TATTOO).freeAttackerCount({
            myCharacters: [bearer, second, plain], provinces: { facedown: 1, faceup: 0 }
        })).toBe(2);
    });

    it('tolerates a body with no attachment list', function() {
        expect(new RevealReadyPolicy(TATTOO).carriesRevealReady({ uuid: 'bare' })).toBe(false);
    });

    it('ships on for the Dragon attachment tower and off everywhere else', function() {
        const strategy = {
            holdingEngine: false, defensive: false, aggressive: false, dishonor: false,
            glory: false, monk: false, duelist: false, shugenja: false, attachmentTower: true
        };
        const dragon = resolveDeckProfile(['iron-mountain-castle', 'illustrious-forge'], strategy);
        expect(new RevealReadyPolicy(dragon.revealReady).inert).toBe(false);

        const crane = resolveDeckProfile(['seven-fold-palace'], { ...strategy, attachmentTower: false });
        expect(new RevealReadyPolicy(crane.revealReady).inert).toBe(true);
    });
});
