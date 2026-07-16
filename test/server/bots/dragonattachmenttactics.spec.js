const {
    DRAGON_ATTACHMENT_DEFAULTS,
    DragonAttachmentTactics
} = require('../../../build/server/game/bots/DragonAttachmentTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');

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
            expect(tactics.shouldHoldWeapon('fine-katana', [yokuni, niten])).toBe(false);
            niten.bowed = false;
            expect(tactics.shouldHoldWeapon('fine-katana', [yokuni, niten])).toBe(true);
            expect(tactics.shouldHoldWeapon('adopted-kin', [yokuni, niten])).toBe(false);
            yokuni.bowed = true;
            expect(tactics.shouldHoldWeapon('fine-katana', [yokuni, niten], true)).toBe(false);
            expect(tactics.pickAttachmentTarget([yokuni, niten], 'fine-katana', undefined, true)).toBe(yokuni);
            yokuni.bowed = false;
            expect(tactics.shouldHoldWeapon('fine-katana', [yokuni, niten], true)).toBe(true);
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

        it('distributes every non-stacking attachment before adding a duplicate', function() {
            const stackable = new Set([
                'fine-katana', 'ornate-fan', 'ancestral-daisho', 'kitsuki-s-method'
            ]);
            const singletonAttachments = DRAGON_ATTACHMENT_DEFAULTS.attachments
                .filter((id) => !stackable.has(id));

            for(const id of singletonAttachments) {
                const occupied = {
                    id: 'togashi-yokuni', fate: 5, bowed: false,
                    attachments: [{ id }]
                };
                const open = {
                    id: 'niten-master', fate: 3, bowed: false,
                    attachments: []
                };
                expect(tactics.pickAttachmentTarget([occupied, open], id))
                    .withContext(id)
                    .toBe(open);
                open.attachments.push({ id });
                expect(tactics.pickAttachmentTarget([occupied, open], id))
                    .withContext(`${id} saturated`)
                    .toBeNull();
            }
        });

        it('allows stat attachments to stack through the third Restricted slot', function() {
            for(const id of ['fine-katana', 'ornate-fan', 'ancestral-daisho', 'kitsuki-s-method']) {
                const tower = {
                    id: 'togashi-yokuni', fate: 5, bowed: false,
                    attachments: [{ id }, { id: 'elegant-tessen' }]
                };
                const fallback = {
                    id: 'niten-master', fate: 3, bowed: false,
                    attachments: []
                };
                expect(tactics.pickAttachmentTarget([tower, fallback], id))
                    .withContext(id)
                    .toBe(tower);
                tower.attachments.push({ id: 'jade-tetsubo' });
                expect(tactics.pickAttachmentTarget([tower, fallback], id))
                    .withContext(`${id} at Restricted cap`)
                    .toBe(fallback);
            }
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
                hand: [{ id: 'tetsubo-of-blood', uuid: 'blood', cost: '1', isPlayableByMe: true }]
            })).toBe(false);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                stronghold: { id: 'iron-mountain-castle', bowed: true },
                hand: [{ id: 'tetsubo-of-blood', uuid: 'blood', cost: '1', isPlayableByMe: true }]
            })).toBe(true);
            const readyNiten = {
                id: 'niten-master', uuid: 'niten', type: 'character', bowed: false,
                attachments: [favor]
            };
            const activeTetsubo = { id: 'tetsubo-of-blood', uuid: 'active-blood', isPlayableByMe: true };
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [readyNiten],
                stronghold: { id: 'iron-mountain-castle', bowed: true },
                hand: [activeTetsubo], conflictCosts: { 'active-blood': 1 }
            })).toBe(false);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [readyNiten],
                stronghold: { id: 'iron-mountain-castle', bowed: true },
                hand: [activeTetsubo], conflictCosts: { 'active-blood': 1 },
                activeConflict: true
            })).toBe(true);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                stronghold: { id: 'iron-mountain-castle', bowed: false },
                hand: [{ id: 'jade-tetsubo', uuid: 'paid-two', isPlayableByMe: true }],
                conflictCosts: { 'paid-two': 2 }
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

        it('applies normal attachment target limits to Inventive Mirumoto replay', function() {
            const inventive = {
                id: 'inventive-mirumoto', uuid: 'inventive', type: 'character',
                location: 'play area',
                attachments: [
                    { id: 'ancestral-daisho' },
                    { id: 'elegant-tessen' },
                    { id: 'ornate-fan' }
                ]
            };
            const blockedTetsubo = {
                id: 'tetsubo-of-blood', uuid: 'aaa-tetsubo', type: 'attachment',
                location: 'conflict discard pile', selectable: true
            };
            const legalJade = {
                id: 'finger-of-jade', uuid: 'zzz-jade', type: 'attachment',
                location: 'conflict discard pile', selectable: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Inventive Mirumoto',
                        menuTitle: 'Choose an attachment',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        stats: { fate: 3 },
                        cardPiles: {
                            cardsInPlay: [inventive], hand: [],
                            conflictDiscardPile: [blockedTetsubo, legalJade]
                        }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };

            const decision = new JigokuBotPolicy('inventive-shared-target-gate').decide(
                state,
                'Jigoku Bot',
                {
                    strategy: ATTACHMENTS,
                    cardHint: getPlaybookEntry,
                    targetHint: {
                        sourceCardId: 'inventive-mirumoto', sourceUuid: 'inventive',
                        sourceIsMine: true, gameActions: ['playCard']
                    },
                    conflictCosts: { 'aaa-tetsubo': 2, 'zzz-jade': 0 }
                }
            );

            expect(decision.reason).toBe('replay-card-shared-play-intent');
            expect(decision.args[0]).toBe('zzz-jade');
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

        it('builds Daimyo\'s Favor before either paid Tetsubo', function() {
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 4, attachments: []
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: {
                            cardsInPlay: [tower],
                            hand: [
                                { uuid: 'blood', id: 'tetsubo-of-blood', type: 'attachment', cost: '1', isPlayableByMe: true },
                                { uuid: 'jade', id: 'jade-tetsubo', type: 'attachment', cost: '2', isPlayableByMe: true },
                                { uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment', cost: '0', isPlayableByMe: true }
                            ]
                        }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('favor-first').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('attachment-tower-preconflict');
            expect(decision.target).toBe('favor');
            expect(tactics.attachmentPriority('daimyo-s-favor'))
                .toBeGreaterThan(tactics.attachmentPriority('tetsubo-of-blood'));
            expect(tactics.attachmentPriority('daimyo-s-favor'))
                .toBeGreaterThan(tactics.attachmentPriority('jade-tetsubo'));
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

        it('uses Daimyo\'s Favor for Tetsubo during an active conflict when Castle is bowed', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: false, inConflict: true,
                attachments: [favor, { uuid: 'fan', id: 'ornate-fan', type: 'attachment', location: 'play area' }]
            };
            // Live hand summaries omit conflict-card costs. Controller supplies
            // the real printed cost separately through conflictCosts.
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                conflict: {
                    attackingPlayerId: 'OPP', defendingPlayerId: 'BOT',
                    attackerSkill: 4, defenderSkill: 3, type: 'military'
                },
                players: {
                    'Jigoku Bot': {
                        id: 'BOT', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Conflict Action Window', menuTitle: '',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 1, conflictsRemaining: 2 },
                        stronghold: {
                            uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                            location: 'stronghold province', bowed: true
                        },
                        cardPiles: { cardsInPlay: [tower], hand: [tetsubo] }
                    },
                    Opponent: {
                        id: 'OPP', name: 'Opponent', stats: { conflictsRemaining: 1 },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const policy = new FateAwareJigokuBotPolicy(1);
            const context = {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                conflictCosts: { tetsubo: 1 },
                legalDirectCardUuids: { favor: true, tetsubo: true }
            };
            const decision = policy.decide(state, 'Jigoku Bot', context);

            expect(decision.reason).toBe('use-board-ability');
            expect(decision.target).toBe('favor');

            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('play-conflict-card');
            expect(play.target).toBe('tetsubo');

            tower.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Tetsubo of Blood';
            state.players['Jigoku Bot'].menuTitle = 'Choose a character';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const target = policy.decide(state, 'Jigoku Bot', {
                ...context,
                legalDirectCardUuids: undefined,
                targetHint: {
                    sourceCardId: 'tetsubo-of-blood', sourceIsMine: true, gameActions: ['attach']
                }
            });
            expect(target.reason).toBe('daimyo-favor-reduced-attachment-target');
            expect(target.target).toBe('tower');
        });

        it('uses ready Iron Mountain Castle instead of Daimyo\'s Favor for active-conflict Tetsubo', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: false, inConflict: true,
                // Iron Mountain Castle gives Dragon characters a third
                // Restricted slot; Tetsubo must remain playable in that slot.
                attachments: [
                    favor,
                    { uuid: 'daisho', id: 'ancestral-daisho', type: 'attachment', location: 'play area' },
                    { uuid: 'method', id: 'kitsuki-s-method', type: 'attachment', location: 'play area' }
                ]
            };
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const castle = {
                uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                location: 'stronghold province', bowed: false
            };
            const state = {
                conflict: {
                    attackingPlayerId: 'OPP', defendingPlayerId: 'BOT',
                    attackerSkill: 4, defenderSkill: 3, type: 'military'
                },
                players: {
                    'Jigoku Bot': {
                        id: 'BOT', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Conflict Action Window', menuTitle: '',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 1, conflictsRemaining: 2 },
                        stronghold: castle,
                        cardPiles: { cardsInPlay: [tower], hand: [tetsubo] }
                    },
                    Opponent: {
                        id: 'OPP', name: 'Opponent', stats: { conflictsRemaining: 1 },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const policy = new FateAwareJigokuBotPolicy(1);
            const context = {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                conflictCosts: { tetsubo: 1 }
            };

            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(tactics.restrictedCount(tower)).toBe(2);
            expect(tactics.restrictedCap(tower)).toBe(3);
            expect(play.reason).toBe('play-conflict-card');
            expect(play.target).toBe('tetsubo');

            castle.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any interrupts to Tetsubo of Blood being played?';
            const reduce = policy.decide(state, 'Jigoku Bot', {
                ...context,
                playCardId: 'tetsubo-of-blood',
                playCost: 1
            });
            expect(reduce.reason).toBe('iron-mountain-castle-reduce-attachment');
            expect(reduce.target).toBe('castle');
        });

        it('falls back to normal conflict play when Daimyo\'s Favor has no paid attachment to reduce', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: false, inConflict: true,
                attachments: [favor]
            };
            const katana = {
                uuid: 'katana', id: 'fine-katana', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                conflict: {
                    attackingPlayerId: 'OPP', defendingPlayerId: 'BOT',
                    attackerSkill: 4, defenderSkill: 3, type: 'military'
                },
                players: {
                    'Jigoku Bot': {
                        id: 'BOT', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Conflict Action Window', menuTitle: '',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 1, conflictsRemaining: 2 },
                        stronghold: {
                            uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                            location: 'stronghold province', bowed: true
                        },
                        cardPiles: { cardsInPlay: [tower], hand: [katana] }
                    },
                    Opponent: {
                        id: 'OPP', name: 'Opponent', stats: { conflictsRemaining: 1 },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const decision = new FateAwareJigokuBotPolicy(1).decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                conflictCosts: { katana: 0 },
                handStats: { katana: { military: 2, political: 0 } }
            });

            expect(decision.reason).toBe('play-conflict-card');
            expect(decision.target).toBe('katana');
        });

        it('saves Daimyo\'s Favor and uses ready Iron Mountain Castle for Tetsubo of Blood', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, attachments: [favor]
            };
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment',
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
                cardHint: getPlaybookEntry,
                conflictCosts: { tetsubo: 1 }
            };
            const decision = policy.decide(state, 'Jigoku Bot', context);
            expect(decision.reason).toBe('pass-window');

            tower.bowed = true;
            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('tetsubo');

            state.players['Jigoku Bot'].stronghold.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any interrupts to Tetsubo of Blood being played?';
            const reduce = policy.decide(state, 'Jigoku Bot', {
                ...context,
                playCardId: 'tetsubo-of-blood',
                playCost: 1
            });
            expect(reduce.reason).toBe('iron-mountain-castle-reduce-attachment');
            expect(reduce.target).toBe('castle');
        });

        it('uses ready Iron Mountain Castle on a cost-one fallback when Tetsubo is absent', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: true, attachments: [favor]
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

        it('distinguishes playing Jade Tetsubo from using its fate-removal action', function() {
            const ownTower = {
                uuid: 'own-tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, attachments: [], selectable: true
            };
            const enemyTower = {
                uuid: 'enemy-tower', id: 'enemy-tower', type: 'character',
                location: 'play area', fate: 4, military: 6, selectable: false
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Jade Tetsubo', menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [ownTower], hand: [] }
                    },
                    Opponent: {
                        name: 'Opponent',
                        cardPiles: { cardsInPlay: [enemyTower], hand: [] }
                    }
                }
            };
            const policy = new JigokuBotPolicy('jade-tetsubo-routing');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };

            const attach = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'jade-tetsubo', sourceIsMine: true, gameActions: ['attach']
                }
            });
            expect(attach.reason).toBe('attachment-tower-target');
            expect(attach.target).toBe('own-tower');

            ownTower.selectable = false;
            enemyTower.selectable = true;
            const stripFate = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'jade-tetsubo', sourceIsMine: true, gameActions: ['removeFate']
                }
            });
            expect(stripFate.reason).toBe('jade-tetsubo-strip-fate');
            expect(stripFate.target).toBe('enemy-tower');
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

        it('holds Weapons until Niten or a Niten-copying Yokuni bows', function() {
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character',
                location: 'play area', fate: 4, bowed: false, attachments: []
            };
            const niten = {
                uuid: 'niten', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: false, attachments: []
            };
            const weapon = {
                uuid: 'weapon', id: 'fine-katana', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [yokuni, niten], hand: [weapon] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('niten-weapon-timing');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };

            const activate = policy.decide(state, 'Jigoku Bot', context);
            expect(activate.reason).toBe('use-conflict-phase-ability');
            expect(activate.target).toBe('yokuni');

            niten.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Togashi Yokuni';
            state.players['Jigoku Bot'].menuTitle = 'Select a character to copy from';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const copy = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'togashi-yokuni', sourceIsMine: true, gameActions: ['cardLastingEffect']
                }
            });
            expect(copy.reason).toBe('yokuni-copy-best-ability');
            expect(copy.target).toBe('niten');

            niten.selectable = false;
            state.players['Jigoku Bot'].promptTitle = 'Action Window';
            state.players['Jigoku Bot'].menuTitle = 'Initiate an action';
            state.players['Jigoku Bot'].buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            const held = policy.decide(state, 'Jigoku Bot', context);
            expect(held.reason).toBe('pass-window');

            yokuni.bowed = true;
            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('weapon');

            yokuni.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Fine Katana';
            state.players['Jigoku Bot'].menuTitle = 'Choose a character';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const target = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: { sourceCardId: 'fine-katana', sourceIsMine: true, gameActions: ['attach'] }
            });
            expect(target.reason).toBe('attachment-tower-target');
            expect(target.target).toBe('yokuni');
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

        it('uses the shared singleton rule in attachment target prompts', function() {
            const occupied = {
                uuid: 'occupied', id: 'togashi-yokuni', type: 'character',
                location: 'play area', selectable: true, fate: 5,
                attachments: [{ id: 'jade-tetsubo' }]
            };
            const open = {
                uuid: 'open', id: 'niten-master', type: 'character',
                location: 'play area', selectable: true, fate: 3, attachments: []
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Jade Tetsubo',
                        menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [occupied, open] }
                    }
                }
            };
            const decision = new FateAwareJigokuBotPolicy(1).decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                targetHint: {
                    sourceCardId: 'jade-tetsubo', sourceIsMine: true, gameActions: ['attach']
                }
            });

            expect(decision.reason).toBe('attachment-tower-target');
            expect(decision.target).toBe('open');
        });

        it('vetoes a targeted attachment that returns to hand instead of retrying it', function() {
            const tower = {
                uuid: 'tower', id: 'kitsuki-yuikimi', type: 'character',
                location: 'play area', selectable: false, fate: 3, attachments: []
            };
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment', cost: '1',
                location: 'hand', isPlayableByMe: true
            };
            const bot = {
                name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                menuTitle: 'Initiate an action',
                buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                stats: { honor: 10, fate: 3 },
                cardPiles: { cardsInPlay: [tower], hand: [tetsubo] }
            };
            const state = {
                players: {
                    'Jigoku Bot': bot,
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('returned-attachment');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };

            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('tetsubo');

            tower.selectable = true;
            bot.promptTitle = 'Tetsubo of Blood';
            bot.menuTitle = 'Choose a character';
            bot.buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const target = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'tetsubo-of-blood', sourceIsMine: true, gameActions: ['attach']
                }
            });
            expect(target.reason).toBe('attachment-tower-target');
            expect(target.target).toBe('tower');

            // Simulate a later play restriction rejecting the attachment: the
            // prompt returns to the action window while the same UUID is still
            // playable in hand. It must be ignored for the rest of the round.
            tower.selectable = false;
            bot.promptTitle = 'Action Window';
            bot.menuTitle = 'Initiate an action';
            bot.buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            const afterRejection = policy.decide(state, 'Jigoku Bot', context);
            expect(afterRejection.reason).toBe('pass-window');
        });
    });
});
