
const M = require('../../../build/server/game/bots/shared/CardValueModel.js');

function chr(overrides) {
    return Object.assign({
        uuid: 'u' + Math.random().toString(36).slice(2, 8),
        id: 'generic-body',
        inConflict: false, bowed: false, honored: false, dishonored: false,
        glory: 1, fate: 0, isUnique: false,
        military: 2, political: 2, attachments: []
    }, overrides);
}

function ctx(overrides) {
    const base = Object.assign({
        conflictType: 'military', amAttacker: true, activeConflict: true,
        honor: 10, fate: 5, myCharacters: [], opponentCharacters: [], hand: []
    }, overrides);
    // Printed cost comes from the live controller map, not the curated model.
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

describe('CardValueModel', function() {
    describe('contributesToConflict', function() {
        it('requires the character to be in the conflict and unbowed', function() {
            expect(M.contributesToConflict(chr({ inConflict: true, bowed: false }))).toBe(true);
            expect(M.contributesToConflict(chr({ inConflict: true, bowed: true }))).toBe(false);
            expect(M.contributesToConflict(chr({ inConflict: false, bowed: false }))).toBe(false);
            expect(M.contributesToConflict(undefined)).toBe(false);
        });
    });

    describe('assassination', function() {
        it('is worth the skill of the participating body it removes', function() {
            // shosuro-actress is printed cost 2.
            const value = M.assassinationValue(ctx({
                opponentCharacters: [chr({ id: 'shosuro-actress', printedCost: 2, inConflict: true, military: 3 })]
            }));
            expect(value.opponentSkill).toBe(-3);
            expect(value.honorCost).toBe(3);
        });

        it('still values the kill when the target is not participating', function() {
            const value = M.assassinationValue(ctx({
                opponentCharacters: [chr({ id: 'shosuro-actress', printedCost: 2, inConflict: false, military: 3 })]
            }));
            expect(value.opponentSkill).toBe(0);
            expect(value.abilityValue).toBeGreaterThan(0);
        });

        it('prefers the biggest live contributor', function() {
            const value = M.assassinationValue(ctx({
                opponentCharacters: [
                    chr({ id: 'shosuro-actress', printedCost: 2, inConflict: true, military: 1 }),
                    chr({ id: 'shosuro-actress', printedCost: 2, inConflict: true, military: 4 })
                ]
            }));
            expect(value.opponentSkill).toBe(-4);
        });

        it('refuses to pay 3 honor near the floor', function() {
            const value = M.assassinationValue(ctx({
                honor: 6, honorFloor: 5,
                opponentCharacters: [chr({ id: 'shosuro-actress', printedCost: 2, inConflict: true, military: 5 })]
            }));
            expect(value.blocked).toBe(true);
            expect(value.reason).toBe('honor-too-low');
        });

        it('is blocked with no cost-2-or-lower target', function() {
            const value = M.assassinationValue(ctx({
                opponentCharacters: [chr({ id: 'hida-kisada', printedCost: 7, inConflict: true, military: 7 })]
            }));
            expect(value.blocked).toBe(true);
        });
    });

    describe('let go', function() {
        it('gives back the skill a debuff was taking from a participant', function() {
            const value = M.letGoValue(ctx({
                myCharacters: [chr({
                    id: 'tower', inConflict: true, fate: 3,
                    attachments: [{ id: 'pacifism', militaryBonus: -3 }]
                })]
            }));
            expect(value.selfSkill).toBe(3);
            expect(value.reason).toContain('unblock');
        });

        it('strips a live enemy buff', function() {
            const value = M.letGoValue(ctx({
                opponentCharacters: [chr({
                    id: 'enemy', inConflict: true,
                    attachments: [{ id: 'tetsubo-of-blood', militaryBonus: 4 }]
                })]
            }));
            expect(value.opponentSkill).toBe(-4);
            expect(value.reason).toContain('strip');
        });

        it('prefers the larger swing over the preferred tier', function() {
            // A 1-point debuff on our tower vs a 4-point enemy weapon.
            const value = M.letGoValue(ctx({
                myCharacters: [chr({ id: 'tower', inConflict: true, fate: 5, attachments: [{ id: 'pacifism', militaryBonus: -1 }] })],
                opponentCharacters: [chr({ id: 'enemy', inConflict: true, attachments: [{ id: 'tetsubo-of-blood', militaryBonus: 4 }] })]
            }));
            expect(value.opponentSkill).toBe(-4);
        });

        it('is blocked when no attachment is in play', function() {
            expect(M.letGoValue(ctx({ myCharacters: [chr({})] })).blocked).toBe(true);
        });
    });

    describe('court games', function() {
        it('honors a participant for its glory', function() {
            const value = M.courtGamesValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, glory: 3 })]
            }));
            expect(value.selfSkill).toBe(3);
        });

        it('dishonors the opponent when that is the bigger swing', function() {
            const value = M.courtGamesValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, glory: 1 })],
                opponentCharacters: [chr({ inConflict: true, glory: 4 })]
            }));
            expect(value.opponentSkill).toBe(-4);
        });

        it('ignores characters that already carry the status', function() {
            const value = M.courtGamesValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, glory: 3, honored: true })]
            }));
            expect(value.blocked).toBe(true);
        });

        it('ignores a bowed participant, whose skill does not reach the conflict', function() {
            const value = M.courtGamesValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ inConflict: true, bowed: true, glory: 3 })]
            }));
            expect(value.blocked).toBe(true);
        });

        it('is worth nothing in a military conflict', function() {
            const value = M.courtGamesValue(ctx({
                conflictType: 'military',
                myCharacters: [chr({ inConflict: true, glory: 3 })]
            }));
            expect(value.reason).toBe('political-only');
        });
    });

    describe('voice of honor', function() {
        it('needs strictly more honored characters than the opponent', function() {
            const base = {
                myCharacters: [chr({ honored: true })],
                opponentCharacters: [chr({ honored: true })]
            };
            expect(M.voiceOfHonorValue(ctx(base), 10).blocked).toBe(true);
            base.myCharacters.push(chr({ honored: true }));
            expect(M.voiceOfHonorValue(ctx(base), 10).abilityValue).toBe(10);
        });

        it('saves the cancel for something above the threshold', function() {
            const value = M.voiceOfHonorValue(ctx({
                myCharacters: [chr({ honored: true })]
            }), 2, 4);
            expect(value.blocked).toBe(true);
        });
    });

    describe('make your case', function() {
        it('values fate landing on a committed body', function() {
            const value = M.makeYourCaseValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ id: 'tower', inConflict: true, political: 5, fate: 3 })],
                opponentCharacters: [chr({ political: 2 })]
            }));
            expect(value.abilityValue).toBeGreaterThan(4);
            expect(value.reason).toContain('tower');
        });

        it('declines a duel our best body loses', function() {
            const value = M.makeYourCaseValue(ctx({
                myCharacters: [chr({ inConflict: true, political: 1 })],
                opponentCharacters: [chr({ political: 6 })]
            }));
            expect(value.reason).toBe('duel-unfavourable');
        });
    });

    describe('noble sacrifice', function() {
        it('nets the removed skill against the sacrificed skill', function() {
            const value = M.nobleSacrificeValue(ctx({
                myCharacters: [chr({ id: 'ours', honored: true, inConflict: true, military: 1 })],
                opponentCharacters: [chr({ id: 'theirs', dishonored: true, inConflict: true, military: 5 })]
            }));
            expect(value.selfSkill).toBe(-1);
            expect(value.opponentSkill).toBe(-5);
        });

        it('gives up the least useful honored body', function() {
            const value = M.nobleSacrificeValue(ctx({
                myCharacters: [
                    chr({ id: 'big', honored: true, inConflict: true, military: 6 }),
                    chr({ id: 'small', honored: true, inConflict: false, military: 1 })
                ],
                opponentCharacters: [chr({ id: 'theirs', dishonored: true, inConflict: true, military: 4 })]
            }));
            expect(value.selfSkill).toBe(0);
            expect(value.reason).toContain('small');
        });

        it('is blocked without both an honored and a dishonored target', function() {
            expect(M.nobleSacrificeValue(ctx({
                myCharacters: [chr({ honored: true })]
            })).blocked).toBe(true);
        });
    });

    describe('oracle of stone', function() {
        it('cycles a hand of dead cards', function() {
            const value = M.oracleOfStoneValue(ctx({
                hand: [{ id: 'unknown-a' }, { id: 'unknown-b' }, { id: 'unknown-c' }]
            }));
            expect(value.abilityValue).toBeGreaterThan(0);
        });

        it('keeps a live hand', function() {
            const value = M.oracleOfStoneValue(ctx({
                hand: [{ id: 'fine-katana' }, { id: 'assassination' }]
            }));
            expect(value.blocked).toBe(true);
            expect(value.reason).toBe('hand-already-live');
        });
    });

    describe('kirei-ko', function() {
        it('is worth the skill of the body it bows', function() {
            const value = M.kireiKoValue(ctx({
                opponentCharacters: [chr({ id: 'togashi-yokuni', inConflict: true, military: 4 })]
            }), undefined, 3);
            expect(value.opponentSkill).toBe(-4);
        });

        it('takes the forced trigger when only one holder exists', function() {
            const value = M.kireiKoValue(ctx({
                opponentCharacters: [chr({ id: 'togashi-yokuni', inConflict: true, military: 1 })]
            }), undefined, 3);
            expect(value.blocked).toBeFalsy();
        });

        it('holds out for a worthwhile target when several holders exist', function() {
            const small = chr({ id: 'togashi-yokuni', inConflict: true, military: 1 });
            const value = M.kireiKoValue(ctx({
                opponentCharacters: [small, chr({ id: 'doji-challenger', inConflict: true, military: 1 })]
            }), small, 3);
            expect(value.blocked).toBe(true);
        });
    });

    describe('in service to my lord', function() {
        it('nets the readied skill against what the bowed body was giving', function() {
            const value = M.inServiceValue(ctx({
                myCharacters: [
                    chr({ id: 'fodder', isUnique: false, inConflict: false, military: 1 }),
                    chr({ id: 'lord', isUnique: true, bowed: true, inConflict: true, military: 5 })
                ]
            }));
            expect(value.selfSkill).toBe(5);
        });

        it('treats readying a body outside the conflict as standing value', function() {
            const value = M.inServiceValue(ctx({
                myCharacters: [
                    chr({ id: 'fodder', isUnique: false, inConflict: false, military: 1 }),
                    chr({ id: 'lord', isUnique: true, bowed: true, inConflict: false, military: 5 })
                ]
            }));
            expect(value.selfSkill).toBe(0);
            expect(value.abilityValue).toBe(5);
        });

        it('is blocked without a bowed unique to ready', function() {
            expect(M.inServiceValue(ctx({
                myCharacters: [chr({ isUnique: false })]
            })).blocked).toBe(true);
        });
    });

    describe('investment pricing', function() {
        it('prices a fate-loaded tower far above a cheap body', function() {
            const cheap = chr({ id: 'cheap', printedCost: 1, fate: 0 });
            const tower = chr({ id: 'tower', printedCost: 4, fate: 3, isUnique: true, attachments: [{ id: 'a' }, { id: 'b' }] });
            const c = ctx({ myCharacters: [cheap], opponentCharacters: [tower] });
            expect(M.investedValue(tower, c)).toBeGreaterThan(M.investedValue(cheap, c) * 3);
        });

        it('trades a cheap honored body for their invested tower', function() {
            const value = M.nobleSacrificeValue(ctx({
                myCharacters: [chr({ id: 'cheap', printedCost: 1, honored: true, inConflict: false, military: 1 })],
                opponentCharacters: [chr({ id: 'tower', printedCost: 4, fate: 4, dishonored: true, inConflict: false, military: 6 })]
            }));
            // Neither is participating, so the whole case rests on investment.
            expect(value.selfSkill).toBe(0);
            expect(value.opponentSkill).toBe(0);
            expect(value.abilityValue).toBeGreaterThan(10);
        });

        it('reports which half of the combo is missing', function() {
            expect(M.nobleSacrificeValue(ctx({
                myCharacters: [chr({ honored: true })]
            })).reason).toBe('no-dishonored-victim');
            expect(M.nobleSacrificeValue(ctx({
                opponentCharacters: [chr({ dishonored: true })]
            })).reason).toBe('no-honored-fodder');
        });
    });

    describe('cancel pricing', function() {
        it('reads a known event out of the interrupt window title', function() {
            expect(M.incomingEventValue('Any interrupts to Assassination?')).toBe(4);
        });

        it('returns null for a title naming nothing we know', function() {
            expect(M.incomingEventValue('Any interrupts to the framework step?')).toBeNull();
        });

        it('fires the cancel above the threshold and holds below it', function() {
            const base = { myCharacters: [chr({ honored: true })] };
            expect(M.voiceOfHonorValue(ctx(base), 6, 4).blocked).toBeFalsy();
            expect(M.voiceOfHonorValue(ctx(base), 2, 4).blocked).toBe(true);
        });
    });

    describe('removal / skill swing', function() {
        it('make an opening scales off the honor dial gap', function() {
            const base = {
                myCharacters: [chr({ inConflict: true })],
                opponentCharacters: [chr({ id: 'them', inConflict: true, military: 5 })]
            };
            expect(M.makeAnOpeningValue(ctx(Object.assign({ myBid: 5, opponentBid: 2 }, base))).opponentSkill).toBe(-3);
            // Bidding LOWER is an equally large difference, and is the whole
            // reason a low-bidding deck plays this card.
            expect(M.makeAnOpeningValue(ctx(Object.assign({ myBid: 2, opponentBid: 5 }, base))).opponentSkill).toBe(-3);
            expect(M.makeAnOpeningValue(ctx(Object.assign({ myBid: 3, opponentBid: 3 }, base))).blocked).toBe(true);
        });

        it('make an opening cannot remove more skill than the target has', function() {
            const value = M.makeAnOpeningValue(ctx({
                myBid: 5, opponentBid: 0,
                myCharacters: [chr({ inConflict: true })],
                opponentCharacters: [chr({ inConflict: true, military: 2 })]
            }));
            expect(value.opponentSkill).toBe(-2);
        });

        it('rout needs a participating Bushi and hits a weaker live body', function() {
            const withBushi = {
                myCharacters: [chr({ traits: ['bushi'], inConflict: true, bowed: true, military: 5 })],
                opponentCharacters: [chr({ id: 'weak', inConflict: true, military: 3 })]
            };
            expect(M.routValue(ctx(withBushi)).opponentSkill).toBe(-3);
            expect(M.routValue(ctx({
                myCharacters: [chr({ traits: ['courtier'], inConflict: true, military: 5 })],
                opponentCharacters: [chr({ inConflict: true, military: 3 })]
            })).reason).toBe('no-participating-bushi');
        });

        it('rout ignores a target at or above our Bushi military', function() {
            expect(M.routValue(ctx({
                myCharacters: [chr({ traits: ['bushi'], inConflict: true, military: 3 })],
                opponentCharacters: [chr({ inConflict: true, military: 3 })]
            })).blocked).toBe(true);
        });

        it('void fist stays off until two cards are played', function() {
            const board = {
                myCharacters: [chr({ traits: ['monk'], inConflict: true, military: 4 })],
                opponentCharacters: [chr({ id: 'them', inConflict: true, military: 4 })]
            };
            expect(M.voidFistValue(ctx(Object.assign({ cardsPlayed: 1 }, board))).reason).toBe('needs-2-cards-played');
            expect(M.voidFistValue(ctx(Object.assign({ cardsPlayed: 2 }, board))).opponentSkill).toBe(-4);
        });

        it('flank the enemy is priced at their WEAKEST participant', function() {
            const value = M.flankTheEnemyValue(ctx({
                myCharacters: [chr({ inConflict: true }), chr({ inConflict: true }), chr({ inConflict: true })],
                opponentCharacters: [
                    chr({ id: 'weak', inConflict: true, military: 1 }),
                    chr({ id: 'strong', inConflict: true, military: 7 })
                ]
            }));
            expect(value.opponentSkill).toBe(-1);
            expect(value.reason).toContain('weak');
        });

        it('flank the enemy needs us to outnumber them', function() {
            expect(M.flankTheEnemyValue(ctx({
                myCharacters: [chr({ inConflict: true })],
                opponentCharacters: [chr({ inConflict: true }), chr({ inConflict: true })]
            })).reason).toBe('not-outnumbering');
        });

        it('earth becomes sky holds below its threshold', function() {
            const board = { opponentCharacters: [chr({ id: 'them', inConflict: true, military: 2 })] };
            expect(M.earthBecomesSkyValue(ctx(board), undefined, 3).blocked).toBe(true);
            expect(M.earthBecomesSkyValue(ctx(board), undefined, 2).opponentSkill).toBe(-2);
        });

        it('ujiaki\'s offer only targets at or below our best printed cost', function() {
            const value = M.ujiakisOfferValue(ctx({
                conflictType: 'political',
                myCharacters: [chr({ id: 'mine', printedCost: 3, inConflict: true })],
                opponentCharacters: [
                    chr({ id: 'cheap', printedCost: 3, inConflict: true, political: 4 }),
                    chr({ id: 'dear', printedCost: 5, inConflict: true, political: 9 })
                ]
            }));
            expect(value.opponentSkill).toBe(-4);
            expect(value.reason).toContain('cheap');
        });

        it('ujiaki\'s offer is military-blind', function() {
            expect(M.ujiakisOfferValue(ctx({
                conflictType: 'military',
                myCharacters: [chr({ inConflict: true })],
                opponentCharacters: [chr({ inConflict: true })]
            })).reason).toBe('political-only');
        });

        it('storied defeat needs a known duel loser', function() {
            expect(M.storiedDefeatValue(ctx({
                opponentCharacters: [chr({ inConflict: true, military: 5 })]
            })).reason).toBe('no-duel-loser');
        });

        it('storied defeat bows the loser and prices the dishonor by glory plus fate', function() {
            const loser = chr({ id: 'loser', inConflict: true, military: 4, glory: 3, fate: 2 });
            const value = M.storiedDefeatValue(ctx({
                opponentCharacters: [loser], duelLoserUuids: [loser.uuid]
            }), 4);
            expect(value.opponentSkill).toBe(-4);
            // 2 base + half the target's investment + glory(3) + fate(2).
            expect(value.abilityValue).toBeGreaterThan(2 + 5);
        });
    });

    describe('registry', function() {
        it('routes every modelled id and leaves others alone', function() {
            for(const id of ['assassination', 'let-go', 'court-games', 'make-your-case',
                'noble-sacrifice', 'oracle-of-stone', 'kirei-ko', 'in-service-to-my-lord', 'voice-of-honor',
                'make-an-opening', 'rout', 'void-fist', 'flank-the-enemy', 'earth-becomes-sky',
                'ujiaki-s-offer', 'storied-defeat']) {
                expect(M.hasCardValueModel(id)).withContext(id).toBe(true);
                expect(M.valueCard(id, ctx({}))).withContext(id).not.toBeNull();
            }
            expect(M.hasCardValueModel('fine-katana')).toBe(false);
            expect(M.valueCard('fine-katana', ctx({}))).toBeNull();
        });
    });
});
