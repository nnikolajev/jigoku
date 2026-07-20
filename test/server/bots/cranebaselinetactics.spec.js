const { CraneBaselineTactics, CRANE_BASELINE_DEFAULTS } = require('../../../build/server/game/bots/CraneBaselineTactics.js');
const { AttachmentControlTactics, ATTACHMENT_CONTROL_DEFAULTS } = require('../../../build/server/game/bots/AttachmentControlTactics.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
const { loadCraneDeck, loadPhoenixShugenjaDeck } = require('../../../tools/selfplay/deckLoader.js');

describe('CraneBaselineTactics', function() {
    const tactics = new CraneBaselineTactics(CRANE_BASELINE_DEFAULTS);
    const known = (id, overrides = {}) => ({
        id,
        name: overrides.name || id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '),
        type: 'event',
        side: 'conflict',
        fate: 0,
        mil: 0,
        pol: 0,
        milBonus: 0,
        polBonus: 0,
        swing: 0,
        tag: 'utility',
        ...overrides
    });

    describe('deck and profile', function() {
        it('loads the exact 40/40 Crane Baseline and activates its injectable profile', function() {
            const deck = loadCraneDeck();
            const ids = [
                ...deck.stronghold.map((entry) => entry.card.id),
                ...deck.role.map((entry) => entry.card.id),
                ...deck.provinceCards.map((entry) => entry.card.id),
                ...deck.dynastyCards.map((entry) => entry.card.id),
                ...deck.conflictCards.map((entry) => entry.card.id)
            ];
            const count = (pile, id) => pile.find((entry) => entry.card.id === id)?.count || 0;
            expect(deck.dynastyCards.reduce((sum, entry) => sum + entry.count, 0)).toBe(40);
            expect(deck.conflictCards.reduce((sum, entry) => sum + entry.count, 0)).toBe(40);
            expect(count(deck.conflictCards, 'gossip')).toBe(3);
            expect(count(deck.dynastyCards, 'kakita-yoshi-2')).toBe(3);
            expect(count(deck.conflictCards, 'noble-sacrifice')).toBe(2);
            const strategy = deriveDeckStrategy(ids);
            const profile = resolveDeckProfile(ids, strategy);
            expect(strategy.duelist).toBe(true);
            expect(profile.craneBaseline).toEqual(CRANE_BASELINE_DEFAULTS);
            expect(profile.strongholdProvinceId).toBe('meditations-on-the-tao');
        });
    });

    describe('Gossip public deck knowledge', function() {
        it('names an important card actually present in the opponent conflict deck', function() {
            const deck = [
                known('ornate-fan', { name: 'Ornate Fan', type: 'attachment', copies: 3 }),
                known('cavalry-reserves', { name: 'Cavalry Reserves', fate: 3 }),
                known('fine-katana', { name: 'Fine Katana', type: 'attachment' })
            ];
            const pick = tactics.pickGossipCard({ opponentDeck: deck, omniscient: false });
            expect(pick.id).toBe('cavalry-reserves');
            expect(deck).toContain(pick);
        });

        it('cannot name a high-weight card absent from the submitted deck', function() {
            const deck = [known('ornate-fan', { name: 'Ornate Fan', type: 'attachment' })];
            const pick = tactics.pickGossipCard({ opponentDeck: deck, omniscient: false });
            expect(pick).toBeNull();
        });

        it('identifies Consumed by Five Fires as the public Phoenix Shugenja build-around threat', function() {
            const deck = loadPhoenixShugenjaDeck().conflictCards.flatMap((entry) =>
                Array.from({ length: entry.count }, () => known(entry.card.id, {
                    name: entry.card.name,
                    type: entry.card.type,
                    fate: Number(entry.card.cost) || 0
                }))
            );
            const pick = tactics.pickGossipCard({ opponentDeck: deck, omniscient: false });
            expect(pick.id).toBe('consumed-by-five-fires');
            expect(deck).toContain(pick);
        });

        it('lets seed 3 prefer an affordable exact hand threat but never a card outside the deck', function() {
            const storm = known('supernatural-storm', { name: 'Supernatural Storm', fate: 0, swing: 5, tag: 'pump' });
            const fiveFires = known('consumed-by-five-fires', { name: 'Consumed by Five Fires', fate: 5, swing: 8, tag: 'control' });
            const deck = [storm, storm, storm, fiveFires, fiveFires];
            const pick = tactics.pickGossipCard({
                opponentDeck: deck,
                opponentHand: [storm, known('cavalry-reserves', { name: 'Cavalry Reserves' })],
                opponentFate: 1,
                omniscient: true,
                conflictType: 'military'
            });
            expect(pick.id).toBe('supernatural-storm');
            expect(deck.some((card) => card.id === pick.id)).toBe(true);
        });

        for(const seed of [1, 2, 3]) {
            it(`submits a legal typed card-name control from the known deck on seed ${seed}`, function() {
                const state = {
                    players: {
                        'Jigoku Bot': {
                            name: 'Jigoku Bot', promptTitle: 'Gossip', menuTitle: 'Name a card',
                            controls: [{ type: 'card-name', command: 'menuButton', method: 'selectCardName', uuid: 'gossip-control' }],
                            buttons: [], cardPiles: { hand: [], cardsInPlay: [] }
                        }
                    }
                };
                const deck = [known('cavalry-reserves', { name: 'Cavalry Reserves', fate: 3 })];
                const context = {
                    strategy: { duelist: true },
                    profile: { ...resolveDeckProfile(['tsuma', 'gossip', 'kakita-yoshi-2', 'noble-sacrifice'], { duelist: true }) },
                    promptControls: state.players['Jigoku Bot'].controls,
                    opponentConflictDeck: deck
                };
                if(seed === 3) {
                    context.omniscient = { oppHand: deck, oppFate: 3, oppProvinces: [], oppName: 'Opponent' };
                }
                const decision = new JigokuBotPolicy(seed).decide(state, 'Jigoku Bot', context);
                expect(decision.command).toBe('menuButton');
                expect(decision.args).toEqual(['Cavalry Reserves', 'gossip-control', 'selectCardName']);
                expect(decision.reason).toBe('crane-gossip-known-deck-card');
            });
        }
    });

    describe('Crane sequencing', function() {
        it('scouts a face-down province alone before using Brash Samurai alone', function() {
            const scout = { uuid: 'scout', id: 'cautious-scout', bowed: false };
            const brash = { uuid: 'brash', id: 'brash-samurai', bowed: false, isHonored: false };
            expect(tactics.pickSoloAttacker([brash, scout], true)).toBe(scout);
            expect(tactics.pickSoloAttacker([brash, scout], false)).toBe(brash);
            expect(tactics.shouldUseBrashSamurai({ myCharacters: [{ ...brash, inConflict: true }] })).toBe(true);
        });

        it('repairs a two-character board after round two before preserving dynasty fate', function() {
            const yoshi = { uuid: 'yoshi', id: 'kakita-yoshi-2', type: 'character' };
            const scout = { uuid: 'scout', id: 'cautious-scout', type: 'character' };
            const costs = { yoshi: 5, scout: 1 };
            const durable = (id) => id === 'kakita-yoshi-2';
            expect(tactics.pickBoardFloorCharacter([scout, yoshi], costs, 7, [{}, {}], 2, durable)).toBeNull();
            expect(tactics.pickBoardFloorCharacter([scout, yoshi], costs, 7, [{}, {}], 3, durable)).toBe(yoshi);
            expect(tactics.pickBoardFloorCharacter([scout, yoshi], costs, 7, [{}, {}, {}], 3, durable)).toBeNull();
            expect(tactics.desiredDynastyFateReserve(1)).toBe(0);
            expect(tactics.desiredDynastyFateReserve(3)).toBe(1);
        });

        it('chains Savvy Politician honor onto the highest-glory target', function() {
            const persistentLowGlory = {
                uuid: 'persistent', fate: 4, glorySummary: { stat: '1' }, isHonored: false
            };
            const highGlory = {
                uuid: 'high-glory', fate: 0, glorySummary: { stat: '3' }, isHonored: false
            };
            expect(tactics.pickHonorChainTarget([persistentLowGlory, highGlory])).toBe(highGlory);
        });

        it('can buy a second durable character in one late dynasty phase to reach the board floor', function() {
            const player = 'Jigoku Bot';
            const pass = { text: 'Pass', arg: 'pass', uuid: 'pass' };
            const character = (uuid, id, location = 'province 1') => ({
                uuid, id, name: id, type: 'character', isDynasty: true,
                facedown: false, selectable: true, location
            });
            const state = (fate, provinces, board) => ({
                players: {
                    [player]: {
                        name: player, phase: 'dynasty', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [pass], stats: { fate },
                        provinces: { one: provinces, two: [], three: [], four: [] },
                        cardPiles: { hand: [], cardsInPlay: board }
                    },
                    Opponent: { name: 'Opponent', stats: { fate: 0 }, cardPiles: { hand: [], cardsInPlay: [] } }
                }
            });
            const profile = resolveDeckProfile(
                ['tsuma', 'gossip', 'kakita-yoshi-2', 'noble-sacrifice'],
                { duelist: true }
            );
            const policy = new FateAwareJigokuBotPolicy('crane-late-board-floor');
            const existing = character('kuwanan', 'doji-kuwanan', 'play area');
            const yoshi = character('yoshi', 'kakita-yoshi-2');
            const first = policy.decide(state(13, [yoshi], [existing]), player, {
                roundNumber: 5, profile, dynastyCosts: { yoshi: 5 }
            });
            expect(first.reason).toBe('crane-refill-board-floor');

            policy.decide({ players: { [player]: {
                name: player, promptTitle: 'Deploy', menuTitle: 'Choose additional fate', stats: { fate: 8 },
                buttons: [0, 1, 2].map((amount) => ({ text: String(amount), arg: String(amount), uuid: `fate-${amount}` }))
            } } }, player, { roundNumber: 5, profile, playCardId: 'kakita-yoshi-2', playCost: 5 });

            const kaezin = character('kaezin', 'kakita-kaezin');
            const second = policy.decide(state(7, [kaezin], [existing, yoshi]), player, {
                roundNumber: 5, profile, dynastyCosts: { kaezin: 3 }
            });
            expect(second.reason).toBe('crane-refill-board-floor');
            expect(second.args[0]).toBe('kaezin');
        });

        it('uses Challenger only after securing this attack and switches Shukujo only for a better axis', function() {
            const challengerContext = {
                amAttacker: true, conflictsRemaining: 1, losing: false, strengthNeeded: 0,
                myCharacters: [{ id: 'doji-challenger', inConflict: true, bowed: false }],
                opponentCharacters: [{ id: 'enemy', inConflict: false, bowed: false }]
            };
            expect(tactics.shouldUseDojiChallenger(challengerContext)).toBe(true);
            expect(tactics.shouldUseDojiChallenger({ ...challengerContext, strengthNeeded: 1 })).toBe(false);
            expect(tactics.shouldSwitchConflictType({
                conflictType: 'military',
                myCharacters: [{ id: 'doji-kuwanan', inConflict: true, military: 3, political: 7 }],
                opponentCharacters: [{ id: 'enemy', inConflict: true, military: 5, political: 2 }]
            })).toBe(true);
        });
    });

    describe('shared attachment control', function() {
        it('compares clearing an own debuff with removing an enemy tower attachment', function() {
            const control = new AttachmentControlTactics(ATTACHMENT_CONTROL_DEFAULTS);
            const pacifism = { uuid: 'pacifism', id: 'pacifism' };
            const katana = { uuid: 'katana', id: 'fine-katana', militarySkillSummary: { stat: 2 } };
            const mine = [{ uuid: 'mine', fate: 4, skill: 7, attachments: [pacifism] }];
            const enemy = [{ uuid: 'enemy', fate: 0, skill: 2, attachments: [katana] }];
            expect(control.pickTarget(mine, enemy, (card) => card.skill)).toBe(pacifism);
            enemy[0].fate = 6;
            enemy[0].attachments = [{ uuid: 'tetsubo', id: 'tetsubo-of-blood' }];
            expect(control.pickTarget(mine, enemy, (card) => card.skill).id).toBe('tetsubo-of-blood');
        });
    });
});
