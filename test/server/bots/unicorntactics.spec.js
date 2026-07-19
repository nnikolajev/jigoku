const { UnicornTactics, UNICORN_DEFAULTS } = require('../../../build/server/game/bots/UnicornTactics.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');

describe('UnicornTactics', function() {
    const tactics = new UnicornTactics(UNICORN_DEFAULTS);
    const card = (id, uuid, extra = {}) => ({
        id, uuid, fate: 0, bowed: false, inConflict: false, attachments: [],
        militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '1' },
        ...extra
    });
    const skill = (candidate) => Number(candidate.militarySkillSummary?.stat) || 0;

    it('is enabled only by the Unicorn cavalry profile and cloned per deck', function() {
        const flags = { aggressive: true, defensive: false, holdingEngine: false, dishonor: false };
        const first = resolveDeckProfile(['cavalry-reserves', 'ride-on'], flags);
        const second = resolveDeckProfile(['cavalry-reserves', 'ride-on'], flags);
        expect(first.unicorn).toBeDefined();
        expect(resolveDeckProfile([], flags).unicorn).toBeUndefined();
        first.unicorn.gaijinCardIds.push('mutation');
        expect(second.unicorn.gaijinCardIds).not.toContain('mutation');
    });

    it('uses engine-exact participant counts and keeps a safe fallback', function() {
        expect(tactics.effectiveParticipantCount(4, [{ inConflict: true }])).toBe(4);
        expect(tactics.effectiveParticipantCount(undefined, [
            { inConflict: true }, { inConflict: false }, { inConflict: true }
        ])).toBe(2);
        expect(tactics.hasMoveSource([{ id: 'golden-plains-outpost', bowed: false }], [], [])).toBe(true);
        expect(tactics.hasMoveSource([], [{ id: 'ride-on', isPlayableByMe: true }], [])).toBe(true);
        const barcha = card('moto-youth', 'barcha', { attachments: [{ id: 'adorned-barcha' }] });
        expect(tactics.hasMoveSource([], [], [barcha], { barcha: true })).toBe(true);
        expect(tactics.hasMoveSource([], [], [barcha], {})).toBe(false);
        expect(tactics.hasMoveSource([], [], [])).toBe(false);
    });

    it('reserves the best legal cavalry mover and commits Outskirts Sentry first', function() {
        const sentry = card('outskirts-sentry', 'sentry');
        const spy = card('border-rider', 'spy', {
            militarySkillSummary: { stat: '3' }, attachments: [{ id: 'spyglass' }]
        });
        const plain = card('moto-youth', 'plain', { militarySkillSummary: { stat: '4' } });
        const plan = tactics.orderDeclarationCandidates([plain, spy, sentry], {
            conflictType: 'military', characters: [plain, spy, sentry], skillOf: skill,
            cavalryUuids: { spy: true, plain: true }, requireCavalry: true
        });
        expect(plan.mover).toBe(spy);
        expect(plan.ordered[0]).toBe(sentry);
        expect(plan.ordered[plan.ordered.length - 1]).toBe(spy);
    });

    it('compares ready movers with bowed movers that have an exact ready follow-up', function() {
        const ordinary = card('border-rider', 'ordinary', { bowed: true, militarySkillSummary: { stat: '10' } });
        const outrider = card('moto-outrider', 'outrider', { bowed: true, militarySkillSummary: { stat: '3' } });
        const ready = card('moto-youth', 'ready', { militarySkillSummary: { stat: '4' } });
        const barcha = card('moto-youth', 'barcha', {
            militarySkillSummary: { stat: '8' }, attachments: [{ id: 'adorned-barcha' }]
        });
        const context = {
            conflictType: 'military', characters: [ordinary, outrider, ready, barcha], skillOf: skill,
            cavalryUuids: { ordinary: true, outrider: true, ready: true, barcha: true }, requireCavalry: true,
            barchaReadyBearerUuids: { barcha: true }
        };
        expect(tactics.pickMoveTarget(context)).toBe(outrider);
        expect(tactics.pickMoveTarget({
            ...context, readyAfterMoveUuids: { ordinary: true }
        })).toBe(ordinary);
        expect(tactics.projectedMoveSkill(ordinary, {
            ...context, readyAfterMoveUuids: { ordinary: true }, hasMotoStables: true
        })).toBe(12);

        const lowerValue = card('border-rider', 'lower', {
            bowed: true, militarySkillSummary: { stat: '3' }
        });
        expect(tactics.pickMoveTarget({
            ...context, characters: [ready, lowerValue],
            cavalryUuids: { ready: true, lower: true }, readyAfterMoveUuids: { lower: true }
        })).toBe(ready);
    });

    it('reserves an unused Barcha action, including on a bowed carrier', function() {
        const sentry = card('outskirts-sentry', 'sentry');
        const bowedBarcha = card('moto-youth', 'barcha', {
            bowed: true, attachments: [{ id: 'adorned-barcha', uuid: 'barcha-attachment' }]
        });
        const plan = tactics.orderDeclarationCandidates([sentry], {
            conflictType: 'military', characters: [sentry, bowedBarcha], skillOf: skill,
            barchaReadyBearerUuids: { barcha: true }
        });
        expect(plan.mover).toBe(bowedBarcha);
        expect(plan.ordered).toEqual([sentry]);
        expect(tactics.projectedMoveSwing(bowedBarcha, {
            conflictType: 'military', characters: [sentry, bowedBarcha], skillOf: skill,
            barchaReadyBearerUuids: { barcha: true },
            opponentCharacters: [card('enemy', 'enemy', {
                inConflict: true, militarySkillSummary: { stat: '5' }
            })]
        })).toBe(5);
        const playbook = getPlaybookEntry('adorned-barcha');
        expect(playbook.oncePerRound).toBe(true);
        expect(playbook.shouldUseAction({
            conflictType: 'military',
            myCharacters: [bowedBarcha],
            opponentCharacters: [card('enemy', 'enemy', { inConflict: true })]
        })).toBe(true);
    });

    it('moves bowed Minami/Higashi for after-win payoff only when the win condition is live', function() {
        const minami = card('minami-kaze-regulars', 'minami', { bowed: true });
        const zeroFateWinner = card('moto-youth', 'winner', { inConflict: true, fate: 0 });
        const minamiCtx = {
            conflictType: 'military', characters: [minami], skillOf: skill,
            cavalryUuids: { minami: true }, requireCavalry: true,
            winSkillNeeded: 0, selfParticipantCount: 2, opponentParticipantCount: 2
        };
        expect(tactics.pickMoveTarget(minamiCtx)).toBe(minami);
        expect(tactics.pickMoveTarget({ ...minamiCtx, winSkillNeeded: 1 })).toBeNull();

        const higashi = card('higashi-kaze-company', 'higashi', { bowed: true });
        expect(tactics.pickMoveTarget({
            ...minamiCtx, characters: [higashi, zeroFateWinner], cavalryUuids: { higashi: true }
        })).toBe(higashi);
        expect(tactics.projectedMoveSkill(higashi, {
            ...minamiCtx, characters: [higashi, zeroFateWinner]
        })).toBe(0);
        const rideOn = getPlaybookEntry('ride-on');
        const rideCtx = {
            conflictType: 'military', losing: false, amAttacker: true, honor: 10,
            myCharacters: [minami], opponentCharacters: [], dynastyDiscard: [],
            cavalryCharacterUuids: { minami: true }, winSkillNeeded: 0,
            participatingCharacterCounts: { self: 2, opponent: 2 }
        };
        expect(rideOn.shouldPlay(rideCtx)).toBe(true);
        expect(rideOn.shouldPlay({ ...rideCtx, winSkillNeeded: 1 })).toBe(false);
    });

    it('honors highest glory and readies the strongest bowed character', function() {
        const low = card('low', 'low', { inConflict: true, glory: 1, bowed: true });
        const high = card('high', 'high', {
            inConflict: true, glory: 3, bowed: true, militarySkillSummary: { stat: '5' }
        });
        expect(tactics.pickOutskirtsHonorTarget([low, high], skill)).toBe(high);
        expect(tactics.pickTwilightReadyTarget([low, high], skill)).toBe(high);
    });

    it('spreads movement attachments and grants Cavalry before duplicating Battle Steed', function() {
        const cavalry = card('moto-youth', 'cavalry', { attachments: [{ id: 'utaku-battle-steed' }] });
        const infantry = card('outskirts-sentry', 'infantry', { militarySkillSummary: { stat: '3' } });
        expect(tactics.pickAttachmentTarget('utaku-battle-steed', [cavalry, infantry], skill,
            { cavalry: true })).toBe(infantry);
        const spyBearer = card('moto-youth', 'spy', { attachments: [{ id: 'spyglass' }] });
        expect(tactics.pickAttachmentTarget('spyglass', [spyBearer], skill)).toBeNull();
        const bowed = card('border-rider', 'bowed', { bowed: true });
        expect(tactics.pickAttachmentTarget('spyglass', [bowed], skill, undefined, undefined,
            { bowed: true })).toBe(bowed);
    });

    it('calculates Challenge on the Fields skill from exact effective participants', function() {
        expect(tactics.challengeSkill(card('duelist', 'duelist', {
            militarySkillSummary: { stat: '4' }
        }), 5, skill)).toBe(8);
    });
});
