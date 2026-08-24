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

    // ---------------------------------------------------------------
    // Movement is for bodies DECLARATION cannot reach. One case per card
    // the Unicorn rush actually runs; see docs/bot-move-into-conflict.md.
    // ---------------------------------------------------------------
    describe('spends a movement source only where declaring cannot', function() {
        const moveCtx = (characters, extra = {}) => ({
            conflictType: 'military',
            characters,
            skillOf: skill,
            requireCavalry: false,
            declarableUuids: Object.fromEntries(characters
                .filter((candidate) => !candidate.bowed && !candidate.inConflict)
                .map((candidate) => [candidate.uuid, true])),
            moveSourceCardId: 'ride-on',
            selfParticipantCount: characters.filter((candidate) => candidate.inConflict).length,
            opponentParticipantCount: 0,
            ...extra
        });

        // The live defect: r1c1 of the 2026-08-24 Dragon replay. Border Rider
        // was ready at home and legal to declare as a defender; the bot
        // declined to defend and then spent Ride On to put it in anyway.
        it('leaves a ready Border Rider for the declaration step', function() {
            const rider = card('border-rider', 'rider', { militarySkillSummary: { stat: '2' } });
            expect(tactics.pickMoveTarget(moveCtx([rider]))).toBeNull();
        });

        // Covert / Shinjo Yasamura / Butcher of the Fallen: the body was ready
        // but the declaration prompt would not take it, so it is absent from
        // the declarable set and movement is the only way in.
        it('moves a ready body that declaration was not allowed to take', function() {
            const rider = card('border-rider', 'rider', { militarySkillSummary: { stat: '2' } });
            expect(tactics.pickMoveTarget(moveCtx([rider], { declarableUuids: {} }))).toBe(rider);
        });

        // Outskirts Sentry honors a participating character after ANY move in.
        // A bowed body contributes no skill but leaves with an honor token.
        it('moves a bowed body to collect the Outskirts Sentry honor', function() {
            const sentry = card('outskirts-sentry', 'sentry', { inConflict: true });
            const bowed = card('young-warrior', 'bowed', { bowed: true });
            const ctx = moveCtx([sentry, bowed], { hasOutskirtsSentry: true });
            expect(tactics.arrivalPayoff(bowed, ctx)).toBeGreaterThan(0);
            expect(tactics.pickMoveTarget(ctx)).toBe(bowed);
            // The same Sentry is not a reason to move a READY body: declaring
            // it is free and puts it in the same conflict.
            const ready = card('young-warrior', 'ready');
            expect(tactics.pickMoveTarget(moveCtx([sentry, ready], { hasOutskirtsSentry: true })))
                .toBeNull();
        });

        // Utaku Infantry gets +1/+1 for each participating Unicorn character,
        // itself included, and `isParticipating()` is bow-agnostic.
        it('moves a bowed body to feed a participating Utaku Infantry', function() {
            const infantry = card('utaku-infantry', 'infantry', { inConflict: true });
            const bowed = card('young-warrior', 'bowed', { bowed: true });
            const ctx = moveCtx([infantry, bowed]);
            expect(tactics.arrivalPayoff(bowed, ctx))
                .toBe(UNICORN_DEFAULTS.utakuInfantryBonus);
            expect(tactics.pickMoveTarget(ctx)).toBe(bowed);
            const ready = card('young-warrior', 'ready');
            expect(tactics.pickMoveTarget(moveCtx([infantry, ready]))).toBeNull();
        });

        // Moto Outrider readies HIMSELF, but only "during a military conflict
        // in which this character is participating". On a political conflict he
        // arrives bowed and stays bowed.
        it('moves a bowed Moto Outrider on military only', function() {
            const outrider = card('moto-outrider', 'outrider', {
                bowed: true, militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' }
            });
            const military = moveCtx([outrider]);
            expect(tactics.projectedMoveSkill(outrider, military)).toBe(3);
            expect(tactics.pickMoveTarget(military)).toBe(outrider);
            const political = moveCtx([outrider], {
                conflictType: 'political',
                skillOf: (candidate) => Number(candidate.politicalSkillSummary?.stat) || 0
            });
            expect(tactics.projectedMoveSkill(outrider, political)).toBe(0);
            expect(tactics.pickMoveTarget(political)).toBeNull();
        });

        // Twilight Rider's reaction fires on MOVING, not on committing, so
        // declaring him forfeits it — but it only pays with a bowed body to
        // stand up.
        it('moves a ready Twilight Rider only when a bowed body can be readied', function() {
            const rider = card('twilight-rider', 'twilight', { militarySkillSummary: { stat: '3' } });
            const bowedFriend = card('young-warrior', 'friend', { bowed: true, inConflict: true });
            expect(tactics.pickMoveTarget(moveCtx([rider, bowedFriend], {
                hasBowedReadyTarget: true
            }))).toBe(rider);
            expect(tactics.pickMoveTarget(moveCtx([rider], { hasBowedReadyTarget: false })))
                .toBeNull();
            // Bowed he cannot be declared at all, and he readies himself.
            const bowedRider = card('twilight-rider', 'twilight', {
                bowed: true, militarySkillSummary: { stat: '3' }
            });
            expect(tactics.pickMoveTarget(moveCtx([bowedRider], { hasBowedReadyTarget: true })))
                .toBe(bowedRider);
        });

        // Shinjo Shono's Action needs the participant majority. The arrival is
        // only worth something when it is what CREATES that majority.
        it('moves a bowed body when the arrival unlocks Shinjo Shono', function() {
            const shono = card('shinjo-shono', 'shono', { inConflict: true });
            const bowed = card('young-warrior', 'bowed', { bowed: true });
            const unlocks = moveCtx([shono, bowed], {
                cavalryUuids: { shono: true, bowed: true },
                selfParticipantCount: 1, opponentParticipantCount: 1
            });
            expect(tactics.arrivalPayoff(bowed, unlocks)).toBeGreaterThan(0);
            // Already outnumbering: Shono's Action is live without the arrival.
            const already = moveCtx([shono, bowed], {
                cavalryUuids: { shono: true, bowed: true },
                selfParticipantCount: 2, opponentParticipantCount: 0
            });
            expect(tactics.arrivalPayoff(bowed, already)).toBe(0);
        });

        // Flank the Enemy's Action has the same majority condition.
        it('moves a bowed body to turn Flank the Enemy on', function() {
            const bowed = card('young-warrior', 'bowed', { bowed: true });
            const ally = card('border-rider', 'ally', { inConflict: true });
            const ctx = moveCtx([ally, bowed], {
                hasFlankTheEnemy: true, selfParticipantCount: 1, opponentParticipantCount: 1
            });
            expect(tactics.arrivalPayoff(bowed, ctx))
                .toBe(UNICORN_DEFAULTS.flankTheEnemyBonus);
            expect(tactics.arrivalPayoff(bowed, { ...ctx, hasFlankTheEnemy: false })).toBe(0);
        });

        // Adorned Barcha's Action bows an enemy participant and brings its
        // bearer along: the bow is the card, the move is the rider.
        it('still uses Adorned Barcha from a ready, declarable bearer', function() {
            const bearer = card('shinjo-yasamura', 'bearer', {
                militarySkillSummary: { stat: '3' }, attachments: [{ id: 'adorned-barcha' }]
            });
            const ctx = moveCtx([bearer], {
                barchaReadyBearerUuids: { bearer: true }, moveSourceCardId: undefined
            });
            expect(tactics.pickMoveTarget(ctx)).toBe(bearer);
            expect(tactics.orderDeclarationCandidates([bearer], ctx).mover).toBe(bearer);
        });

        // Spyglass draws on "commits to a conflict OR moves to a conflict", so
        // its bearer is worth no movement card while it can be declared.
        it('does not spend a movement card to trigger Spyglass', function() {
            const bearer = card('border-rider', 'spy', {
                militarySkillSummary: { stat: '2' }, attachments: [{ id: 'spyglass' }]
            });
            expect(tactics.pickMoveTarget(moveCtx([bearer]))).toBeNull();
        });

        // Golden Plains Outpost pays by bowing the STRONGHOLD, which
        // contributes no skill and has no other ability, so the move is free
        // and a ready body is a fine target for it. Ride On is a card in hand
        // and is not.
        it('still moves a ready body with the free stronghold action', function() {
            const rider = card('border-rider', 'rider', { militarySkillSummary: { stat: '3' } });
            const cavalry = { requireCavalry: true, cavalryUuids: { rider: true } };
            expect(tactics.pickMoveTarget(moveCtx([rider], {
                ...cavalry, moveSourceCardId: 'golden-plains-outpost'
            }))).toBe(rider);
            expect(tactics.shouldUseMove(moveCtx([rider], {
                ...cavalry, moveSourceCardId: 'golden-plains-outpost', strengthNeeded: 2
            }))).toBe(true);
            expect(tactics.pickMoveTarget(moveCtx([rider], {
                ...cavalry, moveSourceCardId: 'ride-on'
            }))).toBeNull();
        });

        // The attack-side reservation is the same decision: holding a READY
        // body out of the declaration to move it in later pays a card for a
        // free placement.
        it('stops reserving a ready cavalry mover at the declaration step', function() {
            const mover = card('border-rider', 'mover', { militarySkillSummary: { stat: '3' } });
            const other = card('moto-youth', 'other', { militarySkillSummary: { stat: '2' } });
            const ctx = moveCtx([mover, other], {
                requireCavalry: true, cavalryUuids: { mover: true, other: true }
            });
            expect(tactics.orderDeclarationCandidates([mover, other], ctx).mover).toBeNull();
            const blocked = { ...ctx, declarableUuids: { other: true } };
            expect(tactics.orderDeclarationCandidates([mover, other], blocked).mover).toBe(mover);
        });
    });
});
