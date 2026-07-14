const {
    DRAGON_ATTACHMENT_DEFAULTS,
    DragonAttachmentTactics
} = require('../../../build/server/game/bots/DragonAttachmentTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');

describe('DragonAttachmentTactics', function() {
    const tactics = new DragonAttachmentTactics(DRAGON_ATTACHMENT_DEFAULTS);
    const ATTACHMENTS = {
        holdingEngine: false,
        defensive: false,
        aggressive: false,
        dishonor: false,
        glory: false,
        monk: false,
        duelist: false,
        shugenja: false,
        attachmentTower: true
    };

    describe('strategy and profile gating', function() {
        it('keys only on Iron Mountain Castle', function() {
            expect(deriveDeckStrategy(['iron-mountain-castle']).attachmentTower).toBe(true);
            expect(deriveDeckStrategy(['high-house-of-light']).attachmentTower).toBe(false);
        });

        it('adds the attachment profile without changing the monk profile', function() {
            const profile = profileFromStrategy(ATTACHMENTS);
            expect(profile.attachmentTower).toEqual(DRAGON_ATTACHMENT_DEFAULTS);
            expect(profile.dragon).toBeUndefined();
            expect(profile.attackCommitment).toBe('all-but-one');
        });

        it('parks Ancestral Lands under the stronghold', function() {
            const profile = resolveDeckProfile(
                ['iron-mountain-castle', 'ancestral-lands'],
                ATTACHMENTS
            );
            expect(profile.strongholdProvinceId).toBe('ancestral-lands');
            expect(profile.attackCommitment).toBe('all-but-one');
            expect(profile.attackKeepHome).toBe(1);
        });
    });

    describe('tower construction', function() {
        it('buys a preferred tower only with three fate available', function() {
            const cards = [
                { uuid: 'yokuni', id: 'togashi-yokuni', type: 'character' },
                { uuid: 'raitsugu', id: 'mirumoto-raitsugu', type: 'character' }
            ];
            expect(tactics.pickDynastyTower(cards, { yokuni: 5, raitsugu: 3 }, 6, []).id)
                .toBe('mirumoto-raitsugu');
            expect(tactics.pickDynastyTower([cards[0]], { yokuni: 5 }, 7, [])).toBeNull();
            expect(tactics.desiredAdditionalFate('togashi-yokuni', 9, 5)).toBe(4);
            expect(tactics.desiredAdditionalFate('doomed-shugenja', 9, 1)).toBeNull();
        });

        it('mulligans support cards but keeps tower candidates', function() {
            expect(tactics.shouldMulliganDynasty({ id: 'agasha-swordsmith' })).toBe(true);
            expect(tactics.shouldMulliganDynasty({ id: 'togashi-yokuni' })).toBe(false);
        });

        it('permits a third Restricted attachment only on Dragon characters', function() {
            const yokuni = {
                id: 'togashi-yokuni', fate: 4,
                attachments: [{ id: 'fine-katana' }, { id: 'ornate-fan' }]
            };
            const hiruma = {
                id: 'hiruma-skirmisher', fate: 2,
                attachments: [{ id: 'fine-katana' }, { id: 'ornate-fan' }]
            };
            expect(tactics.pickAttachmentTarget([yokuni], 'ancestral-daisho')).toBe(yokuni);
            expect(tactics.pickAttachmentTarget([hiruma], 'ancestral-daisho')).toBeNull();
            yokuni.attachments.push({ id: 'kitsuki-s-method' });
            expect(tactics.pickAttachmentTarget([yokuni], 'jade-tetsubo')).toBeNull();
        });

        it('uses a Weapon to ready bowed Niten Master first', function() {
            const yokuni = { id: 'togashi-yokuni', fate: 5, bowed: false, attachments: [] };
            const niten = { id: 'niten-master', fate: 3, bowed: true, attachments: [] };
            expect(tactics.pickAttachmentTarget([yokuni, niten], 'fine-katana')).toBe(niten);
        });

        it('keeps Adopted Kin and Tetsubo of Blood to one copy per tower', function() {
            const occupied = {
                id: 'togashi-yokuni', fate: 5,
                attachments: [{ id: 'adopted-kin' }, { id: 'tetsubo-of-blood' }]
            };
            const open = { id: 'niten-master', fate: 3, attachments: [] };
            expect(tactics.pickAttachmentTarget([occupied, open], 'adopted-kin')).toBe(open);
            expect(tactics.pickAttachmentTarget([occupied, open], 'tetsubo-of-blood')).toBe(open);
        });

        it('copies the requested Yokuni ability order', function() {
            const cards = [
                { id: 'solitary-hero', uuid: 'solitary' },
                { id: 'mirumoto-raitsugu', uuid: 'raitsugu' },
                { id: 'niten-master', uuid: 'niten' }
            ];
            expect(tactics.pickYokuniCopy(cards).id).toBe('niten-master');
        });

        it('falls back to the best legal enemy ability for Yokuni', function() {
            const enemies = [
                { id: 'doji-whisperer', uuid: 'whisperer', fate: 2 },
                { id: 'tengu-sensei', uuid: 'tengu', fate: 1 }
            ];
            const pick = tactics.pickYokuniCopy([], enemies, (card) =>
                card.id === 'tengu-sensei' ? 9 : 4);
            expect(pick.id).toBe('tengu-sensei');
        });

        it('only prepares Daimyo\'s Favor for a paid attachment on its bearer', function() {
            const favor = { id: 'daimyo-s-favor', uuid: 'favor', type: 'attachment', bowed: false };
            const yokuni = {
                id: 'togashi-yokuni', uuid: 'yokuni', type: 'character',
                attachments: [favor]
            };
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                hand: [{ id: 'adopted-kin', uuid: 'free', cost: '0', isPlayableByMe: true }]
            })).toBe(false);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                hand: [
                    { id: 'adopted-kin', uuid: 'free', cost: '0', isPlayableByMe: true },
                    { id: 'ancestral-daisho', uuid: 'paid', cost: '1', isPlayableByMe: true }
                ]
            })).toBe(true);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                stronghold: { id: 'iron-mountain-castle', bowed: false },
                hand: [{ id: 'ancestral-daisho', uuid: 'paid', cost: '1', isPlayableByMe: true }]
            })).toBe(false);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                stronghold: { id: 'iron-mountain-castle', bowed: false },
                hand: [{ id: 'jade-tetsubo', uuid: 'paid-two', cost: '2', isPlayableByMe: true }]
            })).toBe(true);
            expect(tactics.pickDaimyoReducedAttachment([
                { id: 'adopted-kin', uuid: 'free', cost: '0', isPlayableByMe: true },
                { id: 'ancestral-daisho', uuid: 'paid', cost: '1', isPlayableByMe: true }
            ], [yokuni], 'yokuni').id).toBe('ancestral-daisho');
        });

        it('steers Water to Inventive Mirumoto recursion', function() {
            const board = [{ id: 'inventive-mirumoto' }];
            const discard = [{ id: 'fine-katana' }];
            expect(tactics.ringBonus('water', board, discard)).toBeGreaterThan(0);
            expect(tactics.ringBonus('earth', board, discard)).toBe(0);
        });
    });

    describe('policy integration', function() {
        const fateButtons = ['0', '1', '2', '3', '4'].map((value) =>
            ({ text: value, arg: value, uuid: `fate-${value}` }));
        const bidButtons = ['1', '2', '3', '4', '5'].map((value) =>
            ({ text: value, arg: value, uuid: `bid-${value}` }));

        it('uses the generic draw bid instead of forcing one after round one', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Honor Bid', menuTitle: '',
                        buttons: bidButtons, stats: { honor: 10 },
                        cardPiles: { hand: [{}] }
                    },
                    Opponent: {
                        name: 'Opponent', stats: { honor: 10 },
                        cardPiles: { hand: [{}, {}, {}] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('attachment-bid').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                roundNumber: 2
            });
            expect(decision.reason).toBe('draw-bid-honor');
            expect(decision.target).toBe('5');
        });

        it('does not bow Daimyo\'s Favor for a free attachment', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character',
                location: 'play area', fate: 4, attachments: [favor]
            };
            const free = {
                uuid: 'free', id: 'adopted-kin', type: 'attachment', cost: '0',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [yokuni], hand: [free] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('favor-free').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('attachment-tower-preconflict');
            expect(decision.target).toBe('free');
        });

        it('spends Daimyo\'s Favor on a paid attachment on the same bearer', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character',
                location: 'play area', fate: 4, attachments: [favor]
            };
            const free = {
                uuid: 'free', id: 'adopted-kin', type: 'attachment', cost: '0',
                location: 'hand', isPlayableByMe: true
            };
            const paid = {
                uuid: 'paid', id: 'ancestral-daisho', type: 'attachment', cost: '1',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [yokuni], hand: [free, paid] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('favor-paid');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };
            const prepare = policy.decide(state, 'Jigoku Bot', context);
            expect(prepare.reason).toBe('use-conflict-phase-ability');
            expect(prepare.target).toBe('favor');

            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('paid');

            yokuni.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Ancestral Daisho';
            state.players['Jigoku Bot'].menuTitle = 'Choose a character';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const target = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'ancestral-daisho',
                    sourceIsMine: true,
                    gameActions: ['attach']
                }
            });
            expect(target.reason).toBe('daimyo-favor-reduced-attachment-target');
            expect(target.target).toBe('yokuni');
        });

        it('saves Daimyo\'s Favor so ready Iron Mountain Castle reduces Tetsubo of Blood', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, attachments: [favor]
            };
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment', cost: '1',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        stronghold: {
                            uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                            location: 'stronghold province', bowed: false
                        },
                        cardPiles: { cardsInPlay: [tower], hand: [tetsubo] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('castle-tetsubo');
            const context = {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry
            };
            const decision = policy.decide(state, 'Jigoku Bot', context);
            expect(decision.reason).toBe('attachment-tower-preconflict');
            expect(decision.target).toBe('tetsubo');

            state.players['Jigoku Bot'].stronghold.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any interrupts to Tetsubo of Blood being played?';
            const interrupt = policy.decide(state, 'Jigoku Bot', context);
            expect(interrupt.reason).toBe('iron-mountain-castle-reduce-attachment');
            expect(interrupt.target).toBe('castle');
        });

        it('uses ready Iron Mountain Castle on a cost-one fallback when Tetsubo is absent', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, attachments: [favor]
            };
            const fallback = {
                uuid: 'fallback', id: 'ancestral-daisho', type: 'attachment', cost: '1',
                location: 'hand', isPlayableByMe: true
            };
            const castle = {
                uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                location: 'stronghold province', bowed: false
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 }, stronghold: castle,
                        cardPiles: { cardsInPlay: [tower], hand: [fallback] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('castle-fallback');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };
            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('fallback');

            castle.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any interrupts to Ancestral Daisho being played?';
            const interrupt = policy.decide(state, 'Jigoku Bot', context);
            expect(interrupt.reason).toBe('iron-mountain-castle-reduce-attachment');
            expect(interrupt.target).toBe('castle');
        });

        it('saves Iron Mountain Castle when a printed cost-zero attachment is being played', function() {
            const castle = {
                uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                location: 'stronghold province', bowed: false, selectable: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Triggered Abilities',
                        menuTitle: 'Any interrupts to Fine Katana being played?',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stronghold: castle,
                        cardPiles: { cardsInPlay: [], hand: [] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('castle-free').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                playCardId: 'fine-katana',
                playCost: 0,
                cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('save-iron-mountain-castle-free-attachment');
            expect(decision.target).toBe('Pass');
        });

        it('never lets a Let Go prompt fall through to an own attachment', function() {
            const ownTetsubo = {
                uuid: 'own-tetsubo', id: 'tetsubo-of-blood', name: 'Tetsubo of Blood',
                type: 'attachment', location: 'play area', selectable: true
            };
            const ownTower = {
                uuid: 'own-tower', id: 'niten-master', type: 'character',
                location: 'play area', attachments: [ownTetsubo]
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Let Go', menuTitle: 'Choose a card',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [ownTower], hand: [] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('let-go-own-guard').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('cancel-wrong-side-target');
            expect(decision.target).toBe('Cancel');
        });

        it('does not play Let Go unless the opponent has an attachment', function() {
            const shouldPlay = getPlaybookEntry('let-go').shouldPlay;
            expect(shouldPlay({ opponentCharacters: [] })).toBe(false);
            expect(shouldPlay({
                opponentCharacters: [{ id: 'enemy', attachments: [{ id: 'fine-katana' }] }]
            })).toBe(true);
        });

        it('copies and triggers an enemy Tengu Sensei ability with Yokuni', function() {
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character',
                location: 'play area', fate: 4, attachments: []
            };
            const tengu = {
                uuid: 'tengu', id: 'tengu-sensei', type: 'character',
                location: 'play area', fate: 2
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [yokuni], hand: [] }
                    },
                    Opponent: {
                        name: 'Opponent', stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [tengu], hand: [] }
                    }
                }
            };
            const policy = new JigokuBotPolicy('yokuni-enemy-copy');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };
            const activate = policy.decide(state, 'Jigoku Bot', context);
            expect(activate.reason).toBe('use-conflict-phase-ability');
            expect(activate.target).toBe('yokuni');

            tengu.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Togashi Yokuni';
            state.players['Jigoku Bot'].menuTitle = 'Select a character to copy from';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const copy = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'togashi-yokuni',
                    sourceIsMine: true,
                    gameActions: ['cardLastingEffect']
                }
            });
            expect(copy.reason).toBe('yokuni-copy-enemy-ability');
            expect(copy.target).toBe('tengu');

            tengu.selectable = false;
            yokuni.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any reactions to Covert being resolved?';
            state.players['Jigoku Bot'].buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            const use = policy.decide(state, 'Jigoku Bot', context);
            expect(use.reason).toBe('trigger-hinted-ability');
            expect(use.target).toBe('yokuni');
        });

        it('places four fate on a funded tower', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Deploy', menuTitle: 'Choose additional fate',
                        buttons: fateButtons, stats: { fate: 9 }
                    }
                }
            };
            const decision = new JigokuBotPolicy('attachment-fate').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                playCardId: 'togashi-yokuni',
                playCost: 5
            });
            expect(decision.reason).toBe('attachment-tower-fate');
            expect(decision.target).toBe('4');
        });

        it('selects a funded tower in the dynasty window', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'dynasty', promptTitle: 'Action Window', menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }], stats: { fate: 8 },
                        provinces: {
                            one: [{ uuid: 'yokuni', id: 'togashi-yokuni', type: 'character', isDynasty: true, facedown: false }],
                            two: [{ uuid: 'doomed', id: 'doomed-shugenja', type: 'character', isDynasty: true, facedown: false }],
                            three: [], four: []
                        },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('attachment-dynasty').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                dynastyCosts: { yokuni: 5, doomed: 1 }
            });
            expect(decision.reason).toBe('attachment-tower-play-tower');
            expect(decision.args[0]).toBe('yokuni');
        });

        it('targets the third Restricted slot on a Dragon tower', function() {
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character', location: 'play area',
                selectable: true, fate: 4,
                attachments: [{ id: 'fine-katana' }, { id: 'ornate-fan' }]
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Ancestral Daisho', menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [yokuni] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('attachment-target').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                targetHint: {
                    sourceCardId: 'ancestral-daisho',
                    sourceIsMine: true,
                    gameActions: ['attach']
                }
            });
            expect(decision.reason).toBe('attachment-tower-target');
            expect(decision.args[0]).toBe('yokuni');
        });
    });
});
