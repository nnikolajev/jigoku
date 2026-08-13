const M = require('../../../build/server/game/bots/shared/CardValueModel.js');

function chr(overrides) {
    return Object.assign({
        uuid: 'u' + Math.random().toString(36).slice(2, 8),
        id: 'generic-body',
        inConflict: false, bowed: false, honored: false, dishonored: false,
        glory: 1, fate: 0, isUnique: false, traits: [],
        military: 2, political: 2, attachments: []
    }, overrides);
}

function ctx(overrides) {
    const base = Object.assign({
        conflictType: 'military', amAttacker: true, activeConflict: true,
        honor: 10, fate: 5, opponentHonor: 10,
        myCharacters: [], opponentCharacters: [], hand: []
    }, overrides);
    if(!base.printedCostByUuid) {
        base.printedCostByUuid = {};
        for(const c of base.myCharacters.concat(base.opponentCharacters)) {
            if(c.printedCost !== undefined) {
                base.printedCostByUuid[c.uuid] = c.printedCost;
            }
        }
    }
    return base;
}

describe('DuelValueModel', function() {
    describe('bidCeiling', function() {
        it('caps the bid a low-honor player can afford', function() {
            expect(M.bidCeiling(20)).toBe(5);
            expect(M.bidCeiling(8)).toBe(5);
            expect(M.bidCeiling(6)).toBe(4);
            expect(M.bidCeiling(2)).toBe(2);
            expect(M.bidCeiling(0)).toBe(1);
        });

        it('assumes a healthy honor total when the number is missing', function() {
            expect(M.bidCeiling(undefined)).toBe(5);
        });
    });

    describe('duelOdds', function() {
        it('is decisive once the skill gap exceeds the whole bid range', function() {
            expect(M.duelOdds(5).win).toBe(1);
            expect(M.duelOdds(-5).loss).toBe(1);
        });

        it('splits evenly at parity, with ties taken out of both sides', function() {
            const odds = M.duelOdds(0);
            expect(odds.win).toBeCloseTo(odds.loss, 10);
            expect(odds.draw).toBeGreaterThan(0);
            expect(odds.win + odds.draw + odds.loss).toBeCloseTo(1, 10);
        });

        it('punishes a player who cannot afford the big bids', function() {
            const rich = M.duelOdds(0, 5, 5).win;
            const poor = M.duelOdds(0, 2, 5).win;
            expect(poor).toBeLessThan(rich);
        });
    });

    describe('projectDuel', function() {
        it('sends our strongest and picks the best target we can beat', function() {
            const plan = M.projectDuel(ctx({
                myCharacters: [chr({ id: 'weak', inConflict: true, military: 1 }),
                    chr({ id: 'ace', inConflict: true, military: 8 })],
                opponentCharacters: [chr({ id: 'chaff', inConflict: true, military: 1 }),
                    chr({ id: 'prize', inConflict: true, military: 3 })]
            }), { type: 'military', minWinProbability: 0.5 });
            expect(plan.challenger.id).toBe('ace');
            expect(plan.target.id).toBe('prize');
        });

        it('refuses every target when none clears the win bar', function() {
            const plan = M.projectDuel(ctx({
                myCharacters: [chr({ inConflict: true, military: 1 })],
                opponentCharacters: [chr({ inConflict: true, military: 9 })]
            }), { type: 'military', minWinProbability: 0.5 });
            expect(plan.target).toBeUndefined();
            expect(plan.reason).toBe('no-winnable-target');
        });

        it('assumes their best duellist when the opponent picks', function() {
            const plan = M.projectDuel(ctx({
                myCharacters: [chr({ id: 'mine', inConflict: true, military: 4 })],
                opponentCharacters: [chr({ id: 'chaff', inConflict: true, military: 1 }),
                    chr({ id: 'ace', inConflict: true, military: 6 })]
            }), { type: 'military', theyPickTarget: true });
            expect(plan.target.id).toBe('ace');
            expect(plan.margin).toBe(-2);
        });

        it('risks the cheapest winning body when losing costs us a character', function() {
            const plan = M.projectDuel(ctx({
                myCharacters: [
                    chr({ id: 'tower', inConflict: true, military: 9, printedCost: 5, fate: 3 }),
                    chr({ id: 'cheap', inConflict: true, military: 6, printedCost: 1 })
                ],
                opponentCharacters: [chr({ id: 'them', inConflict: true, military: 1 })]
            }), { type: 'military', challengerPolicy: 'risk', minWinProbability: 0.5 });
            expect(plan.challenger.id).toBe('cheap');
        });

        it('counts an Iaijutsu Master as a point of duel margin', function() {
            const plan = M.projectDuel(ctx({
                myCharacters: [chr({
                    id: 'mine', inConflict: true, military: 3,
                    attachments: [{ id: 'iaijutsu-master' }]
                })],
                opponentCharacters: [chr({ id: 'them', inConflict: true, military: 3 })]
            }), { type: 'military' });
            expect(plan.margin).toBe(1);
        });
    });

    describe('dishonorValue', function() {
        it('is worth the glory of a standing participant', function() {
            const value = M.dishonorValue(ctx({}), chr({ inConflict: true, glory: 3 }));
            expect(value.skill).toBe(3);
            expect(value.blocked).toBeFalsy();
        });

        it('moves no skill against a character that is not contributing', function() {
            const value = M.dishonorValue(ctx({}), chr({ inConflict: true, bowed: true, glory: 3 }));
            expect(value.skill).toBe(0);
            expect(value.ability).toBeGreaterThan(0);
        });

        it('refuses a character that is already dishonored', function() {
            const value = M.dishonorValue(ctx({}), chr({ inConflict: true, dishonored: true }));
            expect(value.blocked).toBe(true);
            expect(value.reason).toBe('already-dishonored');
        });

        it('only strips the token off an honored character, opening no follow-up', function() {
            const board = ctx({
                hand: [{ id: 'noble-sacrifice' }],
                myCharacters: [chr({ honored: true })]
            });
            const honored = M.dishonorValue(board, chr({ inConflict: true, glory: 2, honored: true }));
            const neutral = M.dishonorValue(board, chr({ inConflict: true, glory: 2 }));
            expect(honored.reason).toContain('strip-honored');
            expect(neutral.ability).toBeGreaterThan(honored.ability);
        });
    });

    describe('dishonorFollowUpValue', function() {
        it('counts Noble Sacrifice only when we hold an honored body to pay it', function() {
            const target = chr({ inConflict: true, printedCost: 4, fate: 3 });
            const withFodder = M.dishonorFollowUpValue(ctx({
                hand: [{ id: 'noble-sacrifice' }], myCharacters: [chr({ honored: true })],
                opponentCharacters: [target]
            }), target);
            const withoutFodder = M.dishonorFollowUpValue(ctx({
                hand: [{ id: 'noble-sacrifice' }], myCharacters: [chr({})],
                opponentCharacters: [target]
            }), target);
            expect(withFodder.detail).toContain('noble-sacrifice');
            expect(withoutFodder.detail).toEqual([]);
        });

        it('counts Duel to the Death, because a dishonored target cannot refuse', function() {
            const target = chr({ inConflict: true, military: 5 });
            const value = M.dishonorFollowUpValue(ctx({
                hand: [{ id: 'duel-to-the-death' }], opponentCharacters: [target]
            }), target);
            expect(value.detail).toContain('duel-to-the-death');
            expect(value.value).toBe(5);
        });

        it('ignores a follow-up we cannot pay for', function() {
            const target = chr({ inConflict: true, military: 5 });
            const value = M.dishonorFollowUpValue(ctx({
                fate: 0,
                hand: [{ id: 'duel-to-the-death', uuid: 'dtd' }],
                handCostByUuid: { dtd: 1 },
                opponentCharacters: [target]
            }), target);
            expect(value.detail).toEqual([]);
        });
    });

    describe('gameOfSadaneValue', function() {
        it('is political only', function() {
            expect(M.gameOfSadaneValue(ctx({ conflictType: 'military' })).reason).toBe('political-only');
        });

        it('prices the honor and the dishonor together', function() {
            const value = M.gameOfSadaneValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ id: 'mine', inConflict: true, political: 9, glory: 3 })],
                opponentCharacters: [chr({ id: 'them', inConflict: true, political: 1, glory: 4 })]
            }));
            expect(value.blocked).toBeFalsy();
            // Certain win: +3 glory to ours, -4 glory off theirs.
            expect(value.selfSkill).toBe(3);
            expect(value.opponentSkill).toBe(-4);
        });

        it('skips a target that is already dishonored', function() {
            const value = M.gameOfSadaneValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, political: 9 })],
                opponentCharacters: [chr({ inConflict: true, political: 1, dishonored: true })]
            }));
            expect(value.blocked).toBe(true);
        });

        it('holds when we would lose the duel', function() {
            const value = M.gameOfSadaneValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, political: 1 })],
                opponentCharacters: [chr({ inConflict: true, political: 9 })]
            }));
            expect(value.blocked).toBe(true);
        });

        it('is worth more with a dishonor follow-up in hand', function() {
            const board = {
                conflictType: 'political',
                myCharacters: [chr({ id: 'mine', inConflict: true, political: 9, honored: true }),
                    chr({ id: 'fodder', honored: true })],
                opponentCharacters: [chr({ id: 'them', inConflict: true, political: 1, glory: 2, printedCost: 5, fate: 3 })]
            };
            const bare = M.gameOfSadaneValue(ctx(Object.assign({ hand: [] }, board)));
            const loaded = M.gameOfSadaneValue(ctx(Object.assign({ hand: [{ id: 'noble-sacrifice' }] }, board)));
            expect(loaded.abilityValue).toBeGreaterThan(bare.abilityValue);
        });
    });

    describe('policyDebateValue', function() {
        it('is worth the best card it can take out of a hand we can see', function() {
            const value = M.policyDebateValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, political: 9 })],
                opponentCharacters: [chr({ inConflict: true, political: 1 })],
                hand: [],
                opponentHand: [{ id: 'fine-katana' }, { id: 'duel-to-the-death' }]
            }));
            // duel-to-the-death carries the highest curated swing of the two.
            expect(value.abilityValue).toBeGreaterThanOrEqual(5);
            expect(value.reason).toContain('debate:');
        });

        it('falls back to hand size when the hand is hidden', function() {
            const value = M.policyDebateValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, political: 9 })],
                opponentCharacters: [chr({ inConflict: true, political: 1 })],
                opponentHandSize: 6
            }));
            expect(value.blocked).toBeFalsy();
            expect(value.abilityValue).toBeGreaterThan(0);
        });

        it('does not fire on an empty opposing hand', function() {
            expect(M.policyDebateValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, political: 9 })],
                opponentCharacters: [chr({ inConflict: true, political: 1 })],
                opponentHandSize: 0
            })).reason).toBe('their-hand-empty');
        });

        it('gets nothing from a dishonor follow-up, because it dishonors nobody', function() {
            const board = {
                conflictType: 'political',
                myCharacters: [chr({ id: 'mine', inConflict: true, political: 9 }), chr({ honored: true })],
                opponentCharacters: [chr({ id: 'them', inConflict: true, political: 1, printedCost: 5, fate: 3 })],
                opponentHandSize: 4
            };
            const bare = M.policyDebateValue(ctx(Object.assign({ hand: [] }, board)));
            const loaded = M.policyDebateValue(ctx(Object.assign({ hand: [{ id: 'noble-sacrifice' }] }, board)));
            expect(loaded.abilityValue).toBe(bare.abilityValue);
        });
    });

    describe('duelToTheDeathValue', function() {
        it('is military only', function() {
            expect(M.duelToTheDeathValue(ctx({ conflictType: 'political' })).reason).toBe('military-only');
        });

        it('forces the duel against an already dishonored target', function() {
            const value = M.duelToTheDeathValue(ctx({
                myCharacters: [chr({ id: 'mine', inConflict: true, military: 9 })],
                opponentCharacters: [chr({
                    id: 'them', inConflict: true, military: 4, dishonored: true, printedCost: 4, fate: 2
                })]
            }));
            expect(value.reason).toContain('forced:');
            expect(value.opponentSkill).toBe(-4);
            // Their whole investment comes off the board, not just the skill.
            expect(value.abilityValue).toBeGreaterThan(4);
        });

        it('settles for the dishonor when refusing is cheaper for them', function() {
            const value = M.duelToTheDeathValue(ctx({
                myCharacters: [chr({ id: 'mine', inConflict: true, military: 9 })],
                opponentCharacters: [chr({
                    id: 'them', inConflict: true, military: 1, glory: 1, printedCost: 5, fate: 4
                })]
            }));
            expect(value.reason).toContain('refused:');
            expect(value.opponentSkill).toBe(-1);
        });

        it('holds when we cannot win the duel', function() {
            expect(M.duelToTheDeathValue(ctx({
                myCharacters: [chr({ inConflict: true, military: 1 })],
                opponentCharacters: [chr({ inConflict: true, military: 9, dishonored: true })]
            })).blocked).toBe(true);
        });
    });

    describe('challengeOnTheFieldsValue', function() {
        it('turns a body advantage into duel margin', function() {
            const outnumbering = ctx({
                myCharacters: [chr({ id: 'a', inConflict: true, military: 5 }),
                    chr({ id: 'b', inConflict: true, military: 1 }),
                    chr({ id: 'c', inConflict: true, military: 1 })],
                opponentCharacters: [chr({ id: 'them', inConflict: true, military: 5 })]
            });
            const value = M.challengeOnTheFieldsValue(outnumbering);
            expect(value.blocked).toBeFalsy();
            expect(value.opponentSkill).toBeLessThan(0);
            expect(value.reason).toContain('+2/+0');
        });

        it('holds when the body advantage is theirs', function() {
            expect(M.challengeOnTheFieldsValue(ctx({
                myCharacters: [chr({ inConflict: true, military: 3 })],
                opponentCharacters: [chr({ inConflict: true, military: 5 }),
                    chr({ inConflict: true, military: 5 }),
                    chr({ inConflict: true, military: 5 })]
            })).blocked).toBe(true);
        });
    });

    describe('defendYourHonorValue', function() {
        it('holds a cancel that is not worth its card', function() {
            expect(M.defendYourHonorValue(ctx({
                myCharacters: [chr({ inConflict: true, military: 9 })],
                opponentCharacters: [chr({ inConflict: true, military: 1 })]
            }), 1, 4).reason).toBe('incoming-below-threshold');
        });

        it('holds when their best duellist beats ours', function() {
            const value = M.defendYourHonorValue(ctx({
                myCharacters: [chr({ inConflict: true, military: 1 })],
                opponentCharacters: [chr({ inConflict: true, military: 9 })]
            }), 6, 4);
            expect(value.blocked).toBe(true);
            expect(value.reason).toContain('duel-unwinnable');
        });

        it('cancels a real threat we can duel for', function() {
            const value = M.defendYourHonorValue(ctx({
                myCharacters: [chr({ inConflict: true, military: 9 })],
                opponentCharacters: [chr({ inConflict: true, military: 1 })]
            }), 6, 4);
            expect(value.blocked).toBeFalsy();
            expect(value.abilityValue).toBe(6);
        });

        it('needs a live conflict', function() {
            expect(M.defendYourHonorValue(ctx({ activeConflict: false }), 9, 4).reason)
                .toBe('not-during-conflict');
        });
    });

    describe('insultToInjuryValue', function() {
        it('dishonors the character that just lost the duel', function() {
            const loser = chr({ id: 'loser', inConflict: true, glory: 3 });
            const value = M.insultToInjuryValue(ctx({
                opponentCharacters: [loser], duelLoserUuids: [loser.uuid]
            }));
            expect(value.opponentSkill).toBe(-3);
        });

        it('holds when no duel loser of theirs is on the board', function() {
            expect(M.insultToInjuryValue(ctx({
                opponentCharacters: [chr({ inConflict: true })]
            })).reason).toBe('no-duel-loser');
        });

        it('holds against a loser that is already dishonored', function() {
            const loser = chr({ id: 'loser', inConflict: true, dishonored: true });
            expect(M.insultToInjuryValue(ctx({
                opponentCharacters: [loser], duelLoserUuids: [loser.uuid]
            })).reason).toBe('already-dishonored');
        });
    });

    describe('iaijutsuMasterValue', function() {
        it('needs a Duelist to attach to', function() {
            expect(M.iaijutsuMasterValue(ctx({
                myCharacters: [chr({ traits: ['bushi'] })]
            })).reason).toBe('no-duelist-bearer');
        });

        it('beats a bare +2 attachment even with no duel in hand', function() {
            const value = M.iaijutsuMasterValue(ctx({
                myCharacters: [chr({ traits: ['duelist'], inConflict: true })]
            }));
            expect(value.selfSkill).toBe(1);
            expect(value.selfSkill + value.abilityValue).toBeGreaterThan(2);
        });

        it('is worth more while we hold duels to fight', function() {
            const board = { myCharacters: [chr({ traits: ['duelist'], inConflict: true })] };
            const bare = M.iaijutsuMasterValue(ctx(Object.assign({ hand: [] }, board)));
            const loaded = M.iaijutsuMasterValue(ctx(Object.assign({
                hand: [{ id: 'game-of-sadane' }, { id: 'duel-to-the-death' }]
            }, board)));
            expect(loaded.abilityValue).toBeGreaterThan(bare.abilityValue);
        });

        it('does not stack a second copy on the same bearer', function() {
            expect(M.iaijutsuMasterValue(ctx({
                myCharacters: [chr({ traits: ['duelist'], attachments: [{ id: 'iaijutsu-master' }] })]
            })).reason).toBe('already-attached');
        });
    });

    describe('hold vs blocked', function() {
        // The distinction is load-bearing: the hand-play veto acts on `blocked`
        // and must ignore `hold`. Enforcing a preference as a veto measured
        // -22.2pp on PhoenixShugenja (363 refused Oracle of Stone plays).
        it('marks a legal-but-unattractive duel as a hold, not a block', function() {
            const value = M.gameOfSadaneValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, political: 1 })],
                opponentCharacters: [chr({ inConflict: true, political: 9 })]
            }));
            expect(value.hold).toBe(true);
        });

        it('marks a genuinely illegal play as blocked, with no hold', function() {
            const value = M.gameOfSadaneValue(ctx({ conflictType: 'military' }));
            expect(value.blocked).toBe(true);
            expect(value.hold).toBeFalsy();
        });

        it('holds Oracle of Stone on a live hand instead of vetoing it', function() {
            const value = M.oracleOfStoneValue(ctx({
                hand: [{ id: 'fine-katana' }, { id: 'fine-katana' }]
            }));
            expect(value.reason).toBe('hand-already-live');
            expect(value.hold).toBe(true);
        });

        it('still blocks Assassination outright when the honor cost would kill us', function() {
            const value = M.assassinationValue(ctx({
                honor: 3,
                opponentCharacters: [chr({ printedCost: 1, inConflict: true })]
            }));
            expect(value.reason).toBe('honor-too-low');
            expect(value.hold).toBeFalsy();
        });

        it('lets Assassination through at a survivable honor total', function() {
            const value = M.assassinationValue(ctx({
                honor: 5,
                opponentCharacters: [chr({ printedCost: 1, inConflict: true, military: 3 })]
            }));
            expect(value.blocked).toBeFalsy();
            expect(value.opponentSkill).toBe(-3);
        });
    });

    describe('registry', function() {
        it('models every duel card in this batch', function() {
            for(const id of ['game-of-sadane', 'policy-debate', 'duel-to-the-death',
                'challenge-on-the-fields', 'defend-your-honor', 'insult-to-injury',
                'iaijutsu-master']) {
                expect(M.hasCardValueModel(id)).withContext(id).toBe(true);
            }
        });

        it('keeps the reaction-only cards out of the hand-play veto', function() {
            for(const id of ['voice-of-honor', 'defend-your-honor', 'insult-to-injury']) {
                expect(M.REACTION_ONLY_CARDS.has(id)).withContext(id).toBe(true);
            }
            expect(M.REACTION_ONLY_CARDS.has('game-of-sadane')).toBe(false);
        });
    });
});
