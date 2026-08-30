const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const { clarityOfPurposeValue } = require('../../../build/server/game/bots/shared/CardValueModel.js');

// Clarity of Purpose lasts until the conflict ends, so a second copy on the
// body that already carries it buys nothing.
//
// Live defect 2026-08-30 (Jigoku Bot Phoenix vs kingitus Crane, r3c1): the bot
// played Clarity on Feral Ningyo, a Disparaging Challenge duel resolved, then
// Kyuden Isawa recurred a second Clarity out of the conflict discard and spent
// it on the SAME Feral Ningyo -- while a just-arrived Ethereal Dreamer stood
// unprotected.
//
// Two independent holes produced that, and both are covered here:
//   1. Nothing in the serialized player state names the SOURCE of a lasting
//      effect, so a resolved Clarity was invisible to the bot. The controller
//      now publishes `lastingEffectSourceIdsByUuid` off the engine.
//   2. `HonorBidPrompt` uses one `promptTitle` ('Honor Bid') for the draw-phase
//      bid and for a DUEL bid, and the per-round latch reset keyed on that
//      title -- so a duel wiped the bot's accepted-target memory in the middle
//      of a conflict, which is the window a recursion effect reuses.
describe('Clarity of Purpose target selection', function() {
    const strategy = deriveDeckStrategy(['kyuden-isawa']);
    const profile = resolveDeckProfile(['kyuden-isawa', 'offerings-to-the-kami'], strategy);
    const CLARITY_HINT = {
        sourceCardId: 'clarity-of-purpose', sourceIsMine: true,
        gameActions: ['cardLastingEffect']
    };

    function stateFor(me, opponent = {}) {
        return {
            players: {
                Phoenix: { name: 'Phoenix', cardPiles: {}, stats: {}, strongholdProvince: [], ...me },
                Crane: { name: 'Crane', cardPiles: {}, stats: {}, strongholdProvince: [], ...opponent }
            },
            rings: {}
        };
    }

    function participant(uuid, id, skill, extra = {}) {
        return {
            id, uuid, type: 'character', selectable: true,
            bowed: false, inConflict: true,
            militarySkillSummary: { stat: String(skill) },
            politicalSkillSummary: { stat: String(skill) },
            ...extra
        };
    }

    // The "Choose a character" prompt Clarity opens once it is on the stack.
    function targetState(cardsInPlay) {
        const state = stateFor({
            id: 'phoenix-id', phase: 'conflict',
            promptTitle: 'Clarity of Purpose', menuTitle: 'Choose a character',
            buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
            stats: { fate: 1, honor: 10, conflictsRemaining: 1 },
            cardPiles: { cardsInPlay }
        }, {
            id: 'crane-id', stats: { conflictsRemaining: 1 }, cardPiles: { cardsInPlay: [] }
        });
        state.conflict = {
            type: 'political', attackingPlayerId: 'crane-id', defendingPlayerId: 'phoenix-id',
            attackerSkill: 9, defenderSkill: 3
        };
        return state;
    }

    it('reads the ENGINE for bodies that already carry it and targets a different one', function() {
        // Ningyo is the bigger body, so without the engine read the tower pick
        // takes it a second time -- exactly what the replay shows.
        const ningyo = participant('ningyo', 'feral-ningyo', 4);
        const dreamer = participant('dreamer', 'ethereal-dreamer', 1);
        const state = targetState([ningyo, dreamer]);

        const naive = new JigokuBotPolicy('clarity-no-hint')
            .decide(state, 'Phoenix', { profile, targetHint: CLARITY_HINT });
        expect(naive.reason).toBe('clarity-of-purpose-tower');
        expect(naive.args[0]).toBe('ningyo');

        const informed = new JigokuBotPolicy('clarity-engine-hint').decide(state, 'Phoenix', {
            profile,
            targetHint: CLARITY_HINT,
            lastingEffectSourceIdsByUuid: { ningyo: ['clarity-of-purpose'] }
        });
        expect(informed.reason).toBe('clarity-of-purpose-tower');
        expect(informed.args[0]).toBe('dreamer');
    });

    it('cancels rather than re-protecting when every participant already has it', function() {
        const ningyo = participant('ningyo', 'feral-ningyo', 4);
        const decision = new JigokuBotPolicy('clarity-all-protected')
            .decide(targetState([ningyo]), 'Phoenix', {
                profile,
                targetHint: CLARITY_HINT,
                lastingEffectSourceIdsByUuid: { ningyo: ['clarity-of-purpose'] }
            });
        expect(decision.reason).toBe('clarity-of-purpose-no-participant');
    });

    it('ignores a lasting effect that came from a DIFFERENT source card', function() {
        const ningyo = participant('ningyo', 'feral-ningyo', 4);
        const dreamer = participant('dreamer', 'ethereal-dreamer', 1);
        const decision = new JigokuBotPolicy('clarity-other-source')
            .decide(targetState([ningyo, dreamer]), 'Phoenix', {
                profile,
                targetHint: CLARITY_HINT,
                lastingEffectSourceIdsByUuid: { ningyo: ['supernatural-storm'] }
            });
        expect(decision.args[0]).toBe('ningyo');
    });

    it('keeps the accepted target across a DUEL honor bid, which shares the draw-phase prompt title', function() {
        // Covers the window BEFORE the engine has applied the effect, where the
        // bot's own accepted-target memory is the only record.
        const ningyo = participant('ningyo', 'feral-ningyo', 4);
        const dreamer = participant('dreamer', 'ethereal-dreamer', 1);
        const policy = new JigokuBotPolicy('clarity-duel-bid');

        const first = policy.decide(targetState([ningyo, dreamer]), 'Phoenix', {
            profile, targetHint: CLARITY_HINT, promptIdentity: 'clarity-1'
        });
        expect(first.args[0]).toBe('ningyo');

        // The duel bid, mid-conflict. Same promptTitle as the draw-phase bid.
        const bidState = targetState([ningyo, dreamer]);
        bidState.players.Phoenix.promptTitle = 'Honor Bid';
        bidState.players.Phoenix.menuTitle =
            'Choose your bid for the duel\nDoji Kuwanan: 12 vs 2: Ethereal Dreamer';
        bidState.players.Phoenix.buttons = ['1', '2', '3', '4', '5']
            .map((text) => ({ text, arg: text, uuid: text }));
        policy.decide(bidState, 'Phoenix', { profile, promptIdentity: 'duel-bid' });

        // Kyuden Isawa recurs a second Clarity: it must reach the OTHER body.
        const second = policy.decide(targetState([ningyo, dreamer]), 'Phoenix', {
            profile, targetHint: CLARITY_HINT, promptIdentity: 'clarity-2'
        });
        expect(second.args[0]).toBe('dreamer');
    });

    it('still clears the accepted target when the conflict itself ends', function() {
        // The memory is conflict-scoped, not permanent: the next conflict must
        // be free to protect the same body again.
        const ningyo = participant('ningyo', 'feral-ningyo', 4);
        const dreamer = participant('dreamer', 'ethereal-dreamer', 1);
        const policy = new JigokuBotPolicy('clarity-next-conflict');

        expect(policy.decide(targetState([ningyo, dreamer]), 'Phoenix', {
            profile, targetHint: CLARITY_HINT, promptIdentity: 'clarity-1'
        }).args[0]).toBe('ningyo');

        // A prompt with no running conflict at all (the fate/dynasty phase).
        const between = targetState([ningyo, dreamer]);
        delete between.conflict;
        policy.decide(between, 'Phoenix', { profile, promptIdentity: 'between-conflicts' });

        expect(policy.decide(targetState([ningyo, dreamer]), 'Phoenix', {
            profile, targetHint: CLARITY_HINT, promptIdentity: 'clarity-next'
        }).args[0]).toBe('ningyo');
    });

    describe('the play gate', function() {
        const clarity = {
            id: 'clarity-of-purpose', uuid: 'clarity', type: 'event',
            location: 'hand', isPlayableByMe: true
        };

        function handState(cardsInPlay, opponentInPlay = [], menuTitle = 'Political Air conflict\nAttacker: 5 Defender: 0') {
            const state = stateFor({
                id: 'phoenix-id', phase: 'conflict',
                promptTitle: 'Conflict Action Window', menuTitle,
                buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                stats: { fate: 1, honor: 10, conflictsRemaining: 1 },
                cardPiles: { hand: [clarity], cardsInPlay }
            }, {
                id: 'crane-id', stats: { fate: 3, conflictsRemaining: 1 },
                cardPiles: { cardsInPlay: opponentInPlay }
            });
            state.conflict = {
                type: 'political', attackingPlayerId: 'phoenix-id', defendingPlayerId: 'crane-id',
                attackerSkill: 5, defenderSkill: 0
            };
            return state;
        }

        it('holds the card in hand when the only ready participant is already protected', function() {
            const ningyo = participant('ningyo', 'feral-ningyo', 4, { selectable: false });
            const context = {
                profile,
                cardHint: (cardId) => getPlaybookEntry(cardId),
                conflictCosts: { clarity: 1 }
            };

            // Control: unprotected, the card is worth playing.
            expect(new JigokuBotPolicy('clarity-open')
                .decide(handState([ningyo]), 'Phoenix', context).args[0]).toBe('clarity');

            const held = new JigokuBotPolicy('clarity-held').decide(handState([ningyo]), 'Phoenix', {
                ...context,
                lastingEffectSourceIdsByUuid: { ningyo: ['clarity-of-purpose'] }
            });
            expect(held.target).toBe('Pass');
        });

        it('holds it against a live bow threat too, which bypasses the playbook gate', function() {
            // A participating enemy that can bow one of ours is what makes
            // `clarity-urgent-bow-protection` fire ahead of every value play.
            const ningyo = participant('ningyo', 'feral-ningyo', 4, { selectable: false });
            const bower = participant('bower', 'kakita-kaezin', 3, { selectable: false });
            const menuTitle = 'Political Air conflict\nAttacker: 9 Defender: 4';
            const context = {
                profile,
                cardHint: (cardId) => getPlaybookEntry(cardId),
                conflictCosts: { clarity: 1 },
                opponentParticipantCanBow: true
            };

            const control = new JigokuBotPolicy('clarity-urgent-open')
                .decide(handState([ningyo], [bower], menuTitle), 'Phoenix', context);
            expect(control.reason).toBe('clarity-urgent-bow-protection');

            const held = new JigokuBotPolicy('clarity-urgent-held')
                .decide(handState([ningyo], [bower], menuTitle), 'Phoenix', {
                    ...context,
                    lastingEffectSourceIdsByUuid: { ningyo: ['clarity-of-purpose'] }
                });
            expect(held.reason).not.toBe('clarity-urgent-bow-protection');
        });
    });

    describe('the value model', function() {
        // The value model reads plain `military`/`political`/`glory` numbers,
        // not the client's skill summaries.
        function valued(uuid, id, skill) {
            return {
                uuid, id, type: 'character',
                inConflict: true, bowed: false, honored: false, dishonored: false,
                glory: 1, fate: 1, isUnique: false,
                military: skill, political: skill, attachments: []
            };
        }

        function valueContext(overrides = {}) {
            return {
                conflictType: 'political',
                amAttacker: false,
                activeConflict: true,
                honor: 10,
                fate: 1,
                conflictsRemaining: 1,
                myCharacters: [valued('ningyo', 'feral-ningyo', 4)],
                opponentCharacters: [],
                hand: [],
                ...overrides
            };
        }

        it('prices a second copy on an already-protected board as no target at all', function() {
            const open = clarityOfPurposeValue(valueContext());
            expect(open.abilityValue).toBeGreaterThan(0);

            const protectedBoard = clarityOfPurposeValue(valueContext({
                clarityProtectedUuids: ['ningyo']
            }));
            expect(protectedBoard.reason).toBe('no-standing-participant');
            expect(protectedBoard.abilityValue || 0).toBe(0);
        });

        it('falls through to the next unprotected participant', function() {
            const value = clarityOfPurposeValue(valueContext({
                myCharacters: [
                    valued('ningyo', 'feral-ningyo', 4),
                    valued('dreamer', 'ethereal-dreamer', 1)
                ],
                clarityProtectedUuids: ['ningyo']
            }));
            expect(value.reason).toContain('ethereal-dreamer');
        });
    });
});
