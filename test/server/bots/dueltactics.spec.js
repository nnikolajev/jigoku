const { DuelTactics, DUEL_DEFAULTS } = require('../../../build/server/game/bots/DuelTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { loadCraneDuelDeck } = require('../../../tools/selfplay/deckLoader.js');

// Locks the duel layer (upgraded Crane Duels): strategy derivation keyed on
// Tsuma (the sparring Crane precon must stay generic), profile gating, and
// the tactic decisions.
describe('DuelTactics', function() {
    const tactics = new DuelTactics(DUEL_DEFAULTS);
    const DUELIST = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, glory: false, monk: false, duelist: true };

    describe('strategy derivation', function() {
        it('loads the exact EmeraldDB v0.3 deck used by self-play', function() {
            const deck = loadCraneDuelDeck();
            const count = (pile, id) => pile.find((entry) => entry.card.id === id)?.count || 0;
            expect(deck.dynastyCards.reduce((sum, entry) => sum + entry.count, 0)).toBe(40);
            expect(deck.conflictCards.reduce((sum, entry) => sum + entry.count, 0)).toBe(40);
            expect(count(deck.dynastyCards, 'iron-crane-legion')).toBe(3);
            expect(count(deck.conflictCards, 'voice-of-honor')).toBe(3);
            expect(count(deck.conflictCards, 'way-of-the-crane')).toBe(2);
            expect(count(deck.conflictCards, 'noble-sacrifice')).toBe(2);
        });

        it('keys on Tsuma so the SPARRING Crane precon stays generic', function() {
            expect(deriveDeckStrategy(['tsuma']).duelist).toBe(true);
            // The old Crane precon has the whole duel package but no Tsuma.
            expect(deriveDeckStrategy(['kyuden-kakita', 'duelist-training', 'kakita-kaezin', 'policy-debate', 'proving-ground']).duelist).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a duelist strategy carries the duel knobs', function() {
            const p = profileFromStrategy(DUELIST);
            expect(p.duelist).toEqual(DUEL_DEFAULTS);
            expect(p.attackCommitment).toBe('all-but-one');
            expect(profileFromStrategy({ ...DUELIST, duelist: false }).duelist).toBeUndefined();
        });

        it('clones injectable duel axes, start rules, bonuses, and card lists per resolved profile', function() {
            const first = profileFromStrategy(DUELIST).duelist;
            const second = profileFromStrategy(DUELIST).duelist;
            first.duelAxes['custom-duel'] = 'political';
            first.duelStartRules['custom-duel'] = { challenger: 'source', targetChooser: 'self' };
            first.duelSkillBonuses.attachments['custom-blade'] = { political: 9 };
            first.keyCharacters.push('custom-duelist');

            expect(second.duelAxes['custom-duel']).toBeUndefined();
            expect(second.duelStartRules['custom-duel']).toBeUndefined();
            expect(second.duelSkillBonuses.attachments['custom-blade']).toBeUndefined();
            expect(second.keyCharacters).not.toContain('custom-duelist');
            expect(DUEL_DEFAULTS.duelAxes['custom-duel']).toBeUndefined();
        });

        it('parks Vassal Fields under the stronghold', function() {
            expect(resolveDeckProfile(['tsuma', 'vassal-fields'], DUELIST).strongholdProvinceId).toBe('vassal-fields');
            expect(resolveDeckProfile(['tsuma'], DUELIST).strongholdProvinceId).toBeUndefined();
        });
    });

    describe('decisions', function() {
        it('bids duels to win until honor runs low', function() {
            expect(tactics.desiredDuelBid(10)).toBe(DUEL_DEFAULTS.duelBid);
            expect(tactics.desiredDuelBid(DUEL_DEFAULTS.honorFloor)).toBe(1);
        });

        it('knows every Crane Baseline and Crane Duels source axis', function() {
            const expected = {
                'kakita-dojo': 'military',
                'duelist-training': 'military',
                'daimyo-s-gunbai': 'military',
                'aspiring-challenger': 'military',
                'kakita-kaezin': 'military',
                'kakita-toshimoko': 'military',
                'arrogant-kakita': 'military',
                'duel-to-the-death': 'military',
                'make-your-case': 'political',
                'kakita-yuri': 'political',
                'policy-debate': 'political',
                'game-of-sadane': 'political',
                'arbiter-of-authority': 'political',
                'cunning-negotiator': 'political',
                'courtly-challenger': 'political'
            };
            for(const [source, axis] of Object.entries(expected)) {
                expect(tactics.duelAxis(source)).withContext(source).toBe(axis);
                expect(DUEL_DEFAULTS.duelStartRules[source]).withContext(source).toBeDefined();
            }
            expect(tactics.duelAxis('banzai')).toBeNull();
            expect(tactics.duelAxis(undefined)).toBeNull();
        });

        it('recognizes Duelist Training through its character bearer, not while attaching it', function() {
            expect(tactics.duelSourceId({
                uuid: 'bearer', id: 'doji-kuwanan', type: 'character',
                attachments: [{ id: 'duelist-training' }]
            })).toBe('duelist-training');
            expect(tactics.duelSourceId({ id: 'duelist-training', type: 'attachment' })).toBeNull();
        });

        it('projects Kakita Blade and Kakita Favorite skill before a political duel starts', function() {
            const skill = (card, axis) => card[axis];
            const kaezin = {
                uuid: 'kaezin', id: 'kakita-kaezin', military: 3, political: 5,
                attachments: [{ id: 'kakita-blade' }]
            };
            const legion = {
                uuid: 'legion', id: 'iron-crane-legion', military: 8, political: 6,
                attachments: []
            };
            const favorite = {
                uuid: 'favorite', id: 'kakita-favorite', military: 2, political: 4,
                attachments: []
            };

            expect(tactics.duelSkill(kaezin, 'political', skill)).toBe(7);
            expect(tactics.duelSkill(favorite, 'political', skill)).toBe(6);
            expect(tactics.pickOwnDuelParticipant(
                [legion, kaezin], 'political', true, undefined, 10, skill
            )).toBe(kaezin);
        });

        it('targets the strongest enemy it can beat, with Iaijutsu Master breaking equal-skill matchups', function() {
            const skill = (card, axis) => card[axis];
            const challenger = {
                uuid: 'challenger', id: 'kakita-kaezin', military: 3, political: 5,
                attachments: [{ id: 'kakita-blade' }]
            };
            const equal = { uuid: 'equal', military: 1, political: 7, fate: 4, attachments: [] };
            const beatable = { uuid: 'beatable', military: 1, political: 6, fate: 3, attachments: [] };
            const weak = { uuid: 'weak', military: 1, political: 1, fate: 0, attachments: [] };

            expect(tactics.pickOpponentDuelTarget(
                [weak, equal, beatable], 'political', challenger, skill
            )).toBe(beatable);
            challenger.attachments.push({ id: 'iaijutsu-master' });
            expect(tactics.pickOpponentDuelTarget(
                [weak, equal, beatable], 'political', challenger, skill
            )).toBe(equal);
        });

        it('gates self-choice and opponent-choice duel starts by the correct legal matchup', function() {
            const skill = (card, axis) => card[axis];
            const challenger = {
                uuid: 'challenger', id: 'kakita-kaezin', type: 'character', inConflict: true,
                military: 5, political: 5, attachments: [{ id: 'kakita-blade' }]
            };
            const six = { uuid: 'six', inConflict: true, military: 6, political: 6, attachments: [] };
            const eight = { uuid: 'eight', inConflict: true, military: 8, political: 8, attachments: [] };

            // Game of Sadane lets us choose the strongest beatable enemy (6).
            expect(tactics.shouldStartDuel(
                { id: 'game-of-sadane', type: 'event' }, [challenger], [six, eight], skill
            )).toBe(true);
            // Make Your Case lets the opponent choose its strongest body (8).
            expect(tactics.shouldStartDuel(
                { id: 'make-your-case', type: 'event' }, [challenger], [six, eight], skill
            )).toBe(false);
            challenger.attachments.push({ id: 'iaijutsu-master' });
            eight.political = 7;
            expect(tactics.shouldStartDuel(
                { id: 'make-your-case', type: 'event' }, [challenger], [six, eight], skill
            )).toBe(true);
        });

        it('never suppresses Arrogant Kakita forced duel even in a losing matchup', function() {
            const skill = (card, axis) => card[axis];
            const arrogant = {
                uuid: 'arrogant', id: 'arrogant-kakita', type: 'character', inConflict: true,
                military: 1, political: 1, attachments: []
            };
            const tower = { uuid: 'tower', inConflict: true, military: 12, political: 12, attachments: [] };
            expect(tactics.shouldStartDuel(arrogant, [arrogant], [tower], skill)).toBe(true);
        });

        it('protects a tower in an opponent-started unwinnable duel and bids low', function() {
            const skill = (card, axis) => card[axis];
            const tower = {
                uuid: 'tower', id: 'kakita-kaezin', military: 3, political: 5, fate: 3,
                attachments: [{ id: 'kakita-blade' }]
            };
            const scout = {
                uuid: 'scout', id: 'cautious-scout', military: 2, political: 0, fate: 0,
                attachments: []
            };
            const enemy = {
                uuid: 'enemy', id: 'kakita-toshimoko', military: 8, political: 12,
                attachments: []
            };

            expect(tactics.pickOwnDuelParticipant(
                [tower, scout], 'political', false, enemy, 10, skill
            )).toBe(scout);
            expect(tactics.desiredDuelBidForGap(-5, 10)).toBe(1);
        });

        it('contests a winnable opponent-started duel only while honor-rich', function() {
            const skill = (card, axis) => card[axis];
            const tower = {
                uuid: 'tower', id: 'kakita-kaezin', military: 3, political: 5, fate: 3,
                attachments: [{ id: 'kakita-blade' }]
            };
            const scout = {
                uuid: 'scout', id: 'cautious-scout', military: 2, political: 0, fate: 0,
                attachments: []
            };
            const enemy = {
                uuid: 'enemy', id: 'kakita-toshimoko', military: 8, political: 8,
                attachments: []
            };

            expect(tactics.pickOwnDuelParticipant(
                [tower, scout], 'political', false, enemy, 10, skill
            )).toBe(tower);
            expect(tactics.desiredDuelBidForGap(-1, 10)).toBe(5);
            expect(tactics.pickOwnDuelParticipant(
                [tower, scout], 'political', false, enemy, 6, skill
            )).toBe(scout);
            expect(tactics.desiredDuelBidForGap(-1, 6)).toBe(1);
        });

        it('funds five-cost towers with two fate and gives durable bodies 2-5 fate', function() {
            const playable = [
                { uuid: 'filler', id: 'cautious-scout', type: 'character' },
                { uuid: 'kaezin', id: 'kakita-kaezin', type: 'character' },
                { uuid: 'tengu', id: 'tengu-sensei', type: 'character' }
            ];
            expect(tactics.pickDynastyTower(playable, { filler: 1, kaezin: 3, tengu: 5 }, 7, []).id)
                .toBe('tengu-sensei');
            expect(tactics.pickDynastyTower([playable[2]], { tengu: 5 }, 7, []).id).toBe('tengu-sensei');
            expect(tactics.desiredAdditionalFate('tengu-sensei', 8, 5)).toBe(3);
            expect(tactics.desiredAdditionalFate('tengu-sensei', 12, 5)).toBe(5);
            expect(tactics.desiredAdditionalFate('cautious-scout', 12, 1)).toBeNull();
        });

        it('treats Iron Crane Legion as durable but never as a duel attachment carrier', function() {
            const legion = { uuid: 'legion', id: 'iron-crane-legion', type: 'character', fate: 3, attachments: [] };
            const kaezin = { uuid: 'kaezin', id: 'kakita-kaezin', type: 'character', fate: 2, attachments: [] };
            expect(tactics.isDurableCharacter(legion.id)).toBe(true);
            expect(tactics.isTowerCharacter(legion.id)).toBe(false);
            expect(tactics.pickDynastyTower([legion], { legion: 3 }, 6, [], []).id).toBe('iron-crane-legion');
            expect(tactics.pickAttachmentTarget([legion, kaezin], 'duelist-training')).toBe(kaezin);
        });

        it('changes Iaijutsu Master bids only when the live duel margin improves', function() {
            expect(tactics.iaijutsuBidChoice(-2)).toBeNull();
            expect(tactics.iaijutsuBidChoice(-1)).toBe('Increase honor bid');
            expect(tactics.iaijutsuBidChoice(0)).toBe('Increase honor bid');
            expect(tactics.iaijutsuBidChoice(1)).toBeNull();
            expect(tactics.iaijutsuBidChoice(2)).toBe('Decrease honor bid');
        });

        it('honors a persistent tower and trades the cheapest honored body for the best dishonored enemy', function() {
            const skill = (card) => card.skill;
            const helper = { uuid: 'helper', id: 'cautious-scout', fate: 0, skill: 1, isHonored: true, attachments: [] };
            const tower = { uuid: 'tower', id: 'tengu-sensei', fate: 3, skill: 5, isHonored: false, attachments: [] };
            const weakEnemy = { uuid: 'weak', fate: 0, skill: 2, isDishonored: true, attachments: [] };
            const enemyTower = { uuid: 'enemy-tower', fate: 3, skill: 5, isDishonored: true, attachments: [{}] };
            expect(tactics.pickHonorTarget([helper, tower], skill)).toBe(tower);
            expect(tactics.pickNobleSacrifice([tower, helper], skill)).toBe(helper);
            expect(tactics.pickNobleVictim([weakEnemy, enemyTower], skill)).toBe(enemyTower);
        });

        it('uses Shukujo only on Kuwanan and spreads Restricted attachments', function() {
            const kuwanan = { id: 'doji-kuwanan', fate: 3, attachments: [] };
            const tenguFull = {
                id: 'tengu-sensei', fate: 5,
                attachments: [{ id: 'fine-katana' }, { id: 'ornate-fan' }]
            };
            const kaezinOpen = {
                id: 'kakita-kaezin', fate: 3,
                attachments: [{ id: 'kakita-blade' }]
            };
            expect(tactics.pickAttachmentTarget([tenguFull, kuwanan], 'shukujo')).toBe(kuwanan);
            expect(tactics.pickAttachmentTarget([tenguFull, kaezinOpen], 'fine-katana')).toBe(kaezinOpen);
            expect(tactics.pickAttachmentTarget([tenguFull], 'fine-katana')).toBeNull();
        });

        it('protects durable towers, spreads singleton protection, and never wastes covert on Tengu', function() {
            const tengu = { uuid: 'tengu', id: 'tengu-sensei', fate: 4, attachments: [] };
            const kuwanan = { uuid: 'kuwanan', id: 'doji-kuwanan', fate: 3, attachments: [] };
            expect(tactics.pickAttachmentTarget([tengu, kuwanan], 'tattooed-wanderer')).toBe(kuwanan);
            kuwanan.attachments.push({ id: 'above-question' });
            expect(tactics.pickAttachmentTarget([tengu, kuwanan], 'above-question', 1)).toBe(tengu);
            tengu.attachments.push({ id: 'above-question' });
            expect(tactics.pickAttachmentTarget([tengu, kuwanan], 'above-question', 1)).toBeNull();
        });

        it('uses shared copy limits to distribute duel utility attachments', function() {
            for(const attachmentId of ['above-question', 'duelist-training', 'iaijutsu-master']) {
                expect(getPlaybookEntry(attachmentId).maxCopiesPerTarget).toBe(1);
                const first = {
                    uuid: `${attachmentId}-first`, id: 'kakita-kaezin', fate: 4,
                    attachments: [{ id: attachmentId }]
                };
                const second = {
                    uuid: `${attachmentId}-second`, id: 'kakita-toshimoko', fate: 3,
                    attachments: []
                };
                expect(tactics.pickAttachmentTarget([first, second], attachmentId, 1)).toBe(second);
                second.attachments.push({ id: attachmentId });
                expect(tactics.pickAttachmentTarget([first, second], attachmentId, 1)).toBeNull();
            }
        });

        it('prioritizes fire while a tower still needs honoring', function() {
            expect(tactics.ringBonus('fire', [{ id: 'tengu-sensei', isHonored: false }])).toBe(30);
            expect(tactics.ringBonus('fire', [{ id: 'tengu-sensei', isHonored: true }])).toBe(0);
            expect(tactics.ringBonus('earth', [{ id: 'tengu-sensei', isHonored: false }])).toBe(0);
        });

    });

    describe('policy integration', function() {
        const fateButtons = ['0', '1', '2', '3', '4', '5'].map((num) =>
            ({ text: num, arg: num, uuid: 'fate-' + num }));

        it('buys a five-cost tower with two fate at the normal seven-fate opening', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'dynasty', promptTitle: 'Action Window', menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }], stats: { fate: 7 },
                        provinces: {
                            one: [{ uuid: 'tengu', id: 'tengu-sensei', name: 'Tengu Sensei', type: 'character', isDynasty: true, facedown: false }],
                            two: [{ uuid: 'scout', id: 'cautious-scout', name: 'Cautious Scout', type: 'character', isDynasty: true, facedown: false }],
                            three: [], four: []
                        },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('duel-save').decide(state, 'Jigoku Bot', {
                strategy: DUELIST,
                dynastyCosts: { tengu: 5, scout: 1 }
            });
            expect(decision.reason).toBe('duel-play-tower');
            expect(decision.args[0]).toBe('tengu');
        });

        it('uses political duel score, including Kakita Blade, for Make Your Case', function() {
            const kaezin = {
                uuid: 'kaezin', id: 'kakita-kaezin', type: 'character', location: 'play area',
                selectable: true, controller: { name: 'Jigoku Bot' }, attachments: [{ id: 'kakita-blade' }],
                militarySkillSummary: { stat: '10' }, politicalSkillSummary: { stat: '5' }
            };
            const legion = {
                uuid: 'legion', id: 'iron-crane-legion', type: 'character', location: 'play area',
                selectable: true, controller: { name: 'Jigoku Bot' }, attachments: [],
                militarySkillSummary: { stat: '14' }, politicalSkillSummary: { stat: '6' }
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Make Your Case', menuTitle: 'Select one',
                        selectCard: true, buttons: [], stats: { honor: 10 },
                        cardPiles: { cardsInPlay: [kaezin, legion] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('make-your-case-duelist').decide(
                state,
                'Jigoku Bot',
                {
                    strategy: DUELIST,
                    targetHint: {
                        sourceCardId: 'make-your-case', sourceIsMine: true,
                        gameActions: ['duel'], duelAxis: 'political'
                    }
                }
            );

            expect(decision.reason).toBe('duel-own-strongest');
            expect(decision.args[0]).toBe('kaezin');
        });

        it('uses the chosen challenger to target the strongest beatable opposing duelist', function() {
            const challenger = {
                uuid: 'challenger-target', id: 'kakita-kaezin', type: 'character',
                location: 'play area', selectable: false, attachments: [{ id: 'kakita-blade' }],
                militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '5' }
            };
            const equal = {
                uuid: 'equal-target', id: 'equal-target', type: 'character', location: 'play area',
                selectable: true, fate: 4, attachments: [],
                militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '7' }
            };
            const beatable = {
                uuid: 'beatable-target', id: 'beatable-target', type: 'character', location: 'play area',
                selectable: true, fate: 3, attachments: [],
                militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '6' }
            };
            const weak = {
                uuid: 'weak-target', id: 'weak-target', type: 'character', location: 'play area',
                selectable: true, fate: 0, attachments: [],
                militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '1' }
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Policy Debate', menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }], stats: { honor: 10 },
                        cardPiles: { cardsInPlay: [challenger] }
                    },
                    Opponent: {
                        name: 'Opponent', cardPiles: { cardsInPlay: [equal, beatable, weak] }
                    }
                }
            };
            const context = {
                strategy: DUELIST,
                targetHint: {
                    sourceCardId: 'policy-debate', sourceIsMine: true,
                    gameActions: ['duel'], duelAxis: 'political',
                    duelOpponentUuid: challenger.uuid
                }
            };

            const decision = new JigokuBotPolicy('strongest-beatable-target').decide(
                state, 'Jigoku Bot', context
            );
            expect(decision.reason).toBe('duel-enemy-strongest-beatable');
            expect(decision.args[0]).toBe(beatable.uuid);

            challenger.attachments.push({ id: 'iaijutsu-master' });
            const tied = new JigokuBotPolicy('equal-with-master-target').decide(
                state, 'Jigoku Bot', context
            );
            expect(tied.reason).toBe('duel-enemy-strongest-beatable');
            expect(tied.args[0]).toBe(equal.uuid);
        });

        it('does not play an opponent-choice duel unless its strongest legal target is beatable', function() {
            const makeState = (withMaster) => {
                const favorite = {
                    uuid: 'favorite-start', id: 'kakita-favorite', type: 'character',
                    location: 'play area', inConflict: true, bowed: false,
                    attachments: [
                        { id: 'kakita-blade' },
                        ...(withMaster ? [{ id: 'iaijutsu-master' }] : [])
                    ],
                    militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '5' }
                };
                const enemy = {
                    uuid: 'enemy-start', id: 'enemy-start', type: 'character',
                    location: 'play area', inConflict: true, bowed: false, attachments: [],
                    militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '9' }
                };
                return {
                    players: {
                        'Jigoku Bot': {
                            id: 'bot-id', name: 'Jigoku Bot', phase: 'conflict',
                            promptTitle: 'Conflict Action Window', menuTitle: 'Political conflict',
                            buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                            stats: { fate: 10, honor: 10, conflictsRemaining: 2 },
                            provinces: { one: [], two: [], three: [], four: [] }, strongholdProvince: [],
                            cardPiles: {
                                hand: [{ uuid: 'case-start', id: 'make-your-case', name: 'Make Your Case', type: 'event', isPlayableByMe: true }],
                                cardsInPlay: [favorite], conflictDiscardPile: [], dynastyDiscardPile: []
                            }
                        },
                        Opponent: {
                            id: 'opponent-id', name: 'Opponent', stats: { conflictsRemaining: 2 },
                            provinces: {
                                one: [{ uuid: 'province-start', type: 'province', isProvince: true, inConflict: true,
                                    strengthSummary: { stat: '4' } }],
                                two: [], three: [], four: []
                            },
                            strongholdProvince: [],
                            cardPiles: { hand: [], cardsInPlay: [enemy], conflictDiscardPile: [], dynastyDiscardPile: [] }
                        }
                    },
                    conflict: {
                        type: 'political', attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                        attackerSkill: 3, defenderSkill: 4
                    }
                };
            };
            const context = {
                strategy: DUELIST, cardHint: getPlaybookEntry,
                conflictCosts: { 'case-start': 1 }
            };

            const noMaster = new JigokuBotPolicy('unfavorable-duel-start').decide(
                makeState(false), 'Jigoku Bot', context
            );
            expect(noMaster.target).toBe('Pass');

            const withMaster = new JigokuBotPolicy('equal-master-duel-start').decide(
                makeState(true), 'Jigoku Bot', context
            );
            expect(withMaster.reason).toBe('play-conflict-card');
            expect(withMaster.args[0]).toBe('case-start');
        });

        it('chooses Iaijutsu Master direction from the live margin', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Iaijutsu Master', menuTitle: 'Choose one',
                        buttons: [
                            { text: 'Increase honor bid', arg: 'increase', uuid: 'inc' },
                            { text: 'Decrease honor bid', arg: 'decrease', uuid: 'dec' },
                            { text: 'Pass', arg: 'pass', uuid: 'pass' }
                        ], cardPiles: { cardsInPlay: [] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('duel-master-direction').decide(state, 'Jigoku Bot', {
                strategy: DUELIST, duelMargin: 2
            });
            expect(decision.reason).toBe('iaijutsu-decrease-bid');
            expect(decision.args[0]).toBe('decrease');
        });

        it('never uses Voice of Honor to cancel its own event', function() {
            const voice = { uuid: 'voice', id: 'voice-of-honor', type: 'event', location: 'hand', selectable: true };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Any interrupts to the effects of Policy Debate?',
                        menuTitle: 'Any interrupts?', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { fate: 3 }, cardPiles: { hand: [voice], cardsInPlay: [] }
                    }
                }
            };
            const own = new JigokuBotPolicy('voice-own').decide(state, 'Jigoku Bot', {
                strategy: DUELIST, cardHint: getPlaybookEntry, interruptedEventIsMine: true
            });
            const enemy = new JigokuBotPolicy('voice-enemy').decide(state, 'Jigoku Bot', {
                strategy: DUELIST, cardHint: getPlaybookEntry, interruptedEventIsMine: false
            });
            expect(own.reason).toBe('pass-window');
            expect(enemy.args[0]).toBe('voice');
        });

        it('places deep fate on tower characters', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Deploy', menuTitle: 'Choose additional fate',
                        buttons: fateButtons, stats: { fate: 9 }
                    }
                }
            };
            const decision = new JigokuBotPolicy('duel-fate').decide(state, 'Jigoku Bot', {
                strategy: DUELIST, playCardId: 'doji-kuwanan', playCost: 5
            });
            expect(decision.reason).toBe('duel-tower-fate');
            expect(decision.target).toBe('4');
        });

        it('keeps a preferred tower and discards other province characters', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Regroup', menuTitle: 'Select dynasty cards to discard',
                        buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                        provinces: {
                            one: [{ uuid: 'kuwanan', id: 'doji-kuwanan', type: 'character', selectable: true }],
                            two: [{ uuid: 'filler', id: 'cautious-scout', type: 'character', selectable: true }],
                            three: [], four: []
                        },
                        cardPiles: { cardsInPlay: [] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('duel-discard').decide(state, 'Jigoku Bot', { strategy: DUELIST });
            expect(decision.args[0]).toBe('filler');
        });

        it('cancels Shukujo without Kuwanan instead of wasting its Action', function() {
            const tengu = {
                uuid: 'tengu', id: 'tengu-sensei', name: 'Tengu Sensei', type: 'character',
                location: 'play area', selectable: true, fate: 4, attachments: []
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Shukujo', menuTitle: 'Choose a character', selectCard: true,
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [tengu] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('duel-shukujo').decide(state, 'Jigoku Bot', {
                strategy: DUELIST,
                targetHint: { sourceCardId: 'shukujo', sourceIsMine: true, gameActions: ['attach'] }
            });
            expect(decision.reason).toBe('duel-cancel-shukujo-without-kuwanan');
        });

        it('routes all singleton duel attachments to a different bearer', function() {
            for(const attachmentId of ['above-question', 'duelist-training', 'iaijutsu-master']) {
                const first = {
                    uuid: `${attachmentId}-first`, id: 'kakita-kaezin', type: 'character',
                    location: 'play area', selectable: true, fate: 4,
                    attachments: [{ uuid: `${attachmentId}-copy`, id: attachmentId }]
                };
                const second = {
                    uuid: `${attachmentId}-second`, id: 'kakita-toshimoko', type: 'character',
                    location: 'play area', selectable: true, fate: 3, attachments: []
                };
                const state = {
                    players: {
                        'Jigoku Bot': {
                            name: 'Jigoku Bot', promptTitle: attachmentId,
                            menuTitle: 'Choose a character', selectCard: true,
                            buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                            cardPiles: { cardsInPlay: [first, second] }
                        }
                    }
                };
                const decision = new JigokuBotPolicy(`duel-singleton-${attachmentId}`).decide(
                    state,
                    'Jigoku Bot',
                    {
                        strategy: DUELIST,
                        cardHint: getPlaybookEntry,
                        targetHint: {
                            sourceCardId: attachmentId,
                            sourceIsMine: true,
                            gameActions: ['attach']
                        }
                    }
                );
                expect(decision.reason).toBe('duel-attach-tower');
                expect(decision.args[0]).toBe(second.uuid);
            }
        });

        it('plays Tattooed Wanderer as covert on an own persistent character', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Play Tattooed Wanderer', menuTitle: 'Choose an ability:',
                        buttons: [
                            { text: 'Play Tattooed Wanderer as a character', arg: 'character', uuid: 'character' },
                            { text: 'Play Tattooed Wanderer as an attachment', arg: 'attachment', uuid: 'attachment' }
                        ],
                        cardPiles: { hand: [], cardsInPlay: [{ uuid: 'kuwanan', id: 'doji-kuwanan', type: 'character' }] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('duel-tattoo').decide(state, 'Jigoku Bot', {
                strategy: DUELIST,
                playCardId: 'tattooed-wanderer'
            });
            expect(decision.reason).toBe('duel-play-tattooed-wanderer-as-attachment');
            expect(decision.args[0]).toBe('attachment');
        });

        it('does not start a pre-conflict protection attachment it cannot afford', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { fate: 0 },
                        cardPiles: {
                            hand: [{
                                uuid: 'above', id: 'above-question', name: 'Above Question',
                                type: 'attachment', isPlayableByMe: true
                            }],
                            cardsInPlay: [{
                                uuid: 'kuwanan', id: 'doji-kuwanan', type: 'character',
                                location: 'play area', fate: 3, attachments: []
                            }]
                        }
                    }
                }
            };
            const decision = new JigokuBotPolicy('duel-unaffordable-protection').decide(state, 'Jigoku Bot', {
                strategy: DUELIST,
                cardHint: getPlaybookEntry,
                conflictCosts: { above: 1 }
            });
            expect(decision.command).toBe('menuButton');
            expect(decision.target).toBe('Pass');
        });

        it('does not replay an attachment forever after its target prompt cancels', function() {
            const above = {
                uuid: 'above-loop', id: 'above-question', name: 'Above Question',
                type: 'attachment', location: 'hand', isPlayableByMe: true
            };
            const kuwanan = {
                uuid: 'kuwanan-loop', id: 'doji-kuwanan', type: 'character',
                location: 'play area', fate: 3, attachments: []
            };
            const actionState = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { fate: 2 }, cardPiles: { hand: [above], cardsInPlay: [kuwanan] }
                    }
                }
            };
            const context = {
                strategy: DUELIST, cardHint: getPlaybookEntry,
                conflictCosts: { 'above-loop': 1 }
            };
            const policy = new JigokuBotPolicy('duel-cancelled-attachment-loop');
            expect(policy.decide(actionState, 'Jigoku Bot', context).args[0]).toBe('above-loop');

            const targetState = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Above Question',
                        menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        stats: { fate: 2 }, cardPiles: { hand: [above], cardsInPlay: [] }
                    }
                },
                selectableCards: [{ ...kuwanan, selectable: true }]
            };
            const cancelled = policy.decide(targetState, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'above-question', sourceIsMine: true,
                    gameActions: ['attach']
                }
            });
            expect(cancelled.target).toBe('Cancel');

            const afterCancel = policy.decide(actionState, 'Jigoku Bot', context);
            expect(afterCancel.target).toBe('Pass');
        });

        it('does not repeat Kuwanan\'s Duelist Training into an already-bowed target', function() {
            const bowed = {
                uuid: 'bowed', id: 'purifier-apprentice', name: 'Purifier Apprentice',
                type: 'character', location: 'play area', selectable: true,
                bowed: true, inConflict: true, military: 1, political: 1
            };
            const ready = {
                uuid: 'ready', id: 'kaiu-shugosha', name: 'Kaiu Shugosha',
                type: 'character', location: 'play area', selectable: true,
                bowed: false, inConflict: true, military: 3, political: 1
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Doji Kuwanan',
                        menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [] }
                    },
                    Opponent: {
                        name: 'Opponent',
                        cardPiles: { cardsInPlay: [bowed, ready] }
                    }
                }
            };
            const context = {
                strategy: DUELIST,
                targetHint: {
                    sourceCardId: 'doji-kuwanan', sourceIsMine: true, gameActions: ['duel']
                }
            };
            const decision = new JigokuBotPolicy('duelist-training-ready').decide(state, 'Jigoku Bot', context);
            expect(decision.reason).toBe('duelist-training-ready-enemy');
            expect(decision.args[0]).toBe('ready');

            ready.bowed = true;
            const cancel = new JigokuBotPolicy('duelist-training-cancel').decide(state, 'Jigoku Bot', context);
            expect(cancel.reason).toBe('cancel-duelist-training-no-ready-enemy');
        });
    });
});
