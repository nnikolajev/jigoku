const { DuelTactics, DUEL_DEFAULTS } = require('../../../build/server/game/bots/DuelTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');

// Locks the duel layer (upgraded Crane Duels): strategy derivation keyed on
// Tsuma (the sparring Crane precon must stay generic), profile gating, and
// the tactic decisions.
describe('DuelTactics', function() {
    const tactics = new DuelTactics(DUEL_DEFAULTS);
    const DUELIST = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, glory: false, monk: false, duelist: true };

    describe('strategy derivation', function() {
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

        it('knows each duel source axis', function() {
            expect(tactics.duelAxis('policy-debate')).toBe('political');
            expect(tactics.duelAxis('kakita-dojo')).toBe('military');
            expect(tactics.duelAxis('banzai')).toBeNull();
            expect(tactics.duelAxis(undefined)).toBeNull();
        });

        it('duel attachments stack on the ranked key duelists', function() {
            const mine = [{ id: 'tengu-sensei' }, { id: 'kakita-toshimoko' }];
            expect(tactics.pickKeyCharacter(mine).id).toBe('tengu-sensei');
            expect(tactics.pickKeyCharacter([{ id: 'kakita-favorite' }])).toBeNull();
        });

        it('buys only a funded preferred tower and gives it 3-5 fate', function() {
            const playable = [
                { uuid: 'filler', id: 'cautious-scout', type: 'character' },
                { uuid: 'kaezin', id: 'kakita-kaezin', type: 'character' },
                { uuid: 'tengu', id: 'tengu-sensei', type: 'character' }
            ];
            expect(tactics.pickDynastyTower(playable, { filler: 1, kaezin: 3, tengu: 5 }, 7, []).id)
                .toBe('kakita-kaezin');
            expect(tactics.pickDynastyTower([playable[2]], { tengu: 5 }, 7, [])).toBeNull();
            expect(tactics.desiredAdditionalFate('tengu-sensei', 8, 5)).toBe(3);
            expect(tactics.desiredAdditionalFate('tengu-sensei', 12, 5)).toBe(5);
            expect(tactics.desiredAdditionalFate('cautious-scout', 12, 1)).toBeNull();
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

        it('prioritizes fire while a tower still needs honoring', function() {
            expect(tactics.ringBonus('fire', [{ id: 'tengu-sensei', isHonored: false }])).toBe(30);
            expect(tactics.ringBonus('fire', [{ id: 'tengu-sensei', isHonored: true }])).toBe(0);
            expect(tactics.ringBonus('earth', [{ id: 'tengu-sensei', isHonored: false }])).toBe(0);
        });

    });

    describe('policy integration', function() {
        const fateButtons = ['0', '1', '2', '3', '4', '5'].map((num) =>
            ({ text: num, arg: num, uuid: 'fate-' + num }));

        it('buys one cheap helper while preserving a visible unfunded tower', function() {
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
            expect(decision.reason).toBe('duel-play-support');
            expect(decision.args[0]).toBe('scout');
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
    });
});
