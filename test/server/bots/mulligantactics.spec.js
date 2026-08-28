const MulliganTactics = require('../../../build/server/game/bots/MulliganTactics.js').default;
const {
    DEFAULT_MULLIGAN_PROFILE
} = require('../../../build/server/game/bots/MulliganTactics.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

describe('MulliganTactics', function() {
    const card = (uuid, id, type, location = 'province 1', selectable = true) => ({
        uuid, id, name: id, type, location, selectable, selected: false
    });
    const input = (cards, costsByUuid = {}, overrides = {}) => ({
        cards,
        board: [],
        currentFate: 0,
        income: 7,
        roundNumber: 1,
        costsByUuid,
        ...overrides
    });

    it('mulligans every paid opening conflict card and keeps zero-cost cards', function() {
        const tactics = new MulliganTactics(DEFAULT_MULLIGAN_PROFILE);
        const free = card('free', 'fine-katana', 'attachment', 'hand');
        const paid = card('paid', 'display-of-power', 'event', 'hand');
        const broken = card('broken', 'paid-on-broken-province', 'event', 'province 1', false);

        expect(tactics.pickOpeningConflict(input(
            [free, paid, broken],
            { free: 0, paid: 2, broken: 3 }
        )).card).toBe(paid);

        paid.selected = true;
        expect(tactics.pickOpeningConflict(input(
            [free, paid, broken],
            { free: 0, paid: 2, broken: 3 }
        )).card).toBeUndefined();
    });

    it('can keep a bounded priority list of paid opening conflict cards', function() {
        const tactics = new MulliganTactics({
            ...DEFAULT_MULLIGAN_PROFILE,
            openingKeepConflictIds: ['spyglass', 'shiksha-scout'],
            openingPaidConflictKeepLimit: 1
        });
        const scout = card('scout', 'shiksha-scout', 'character', 'hand');
        const glass = card('glass', 'spyglass', 'attachment', 'hand');
        const other = card('other', 'ride-on', 'event', 'hand');
        const cards = [scout, glass, other];
        const costs = { scout: 2, glass: 1, other: 1 };

        // Priority order keeps Spyglass. Other paid cards still cycle.
        expect(tactics.pickOpeningConflict(input(cards, costs)).card).toBe(scout);
        scout.selected = true;
        expect(tactics.pickOpeningConflict(input(cards, costs)).card).toBe(other);
        other.selected = true;
        expect(tactics.pickOpeningConflict(input(cards, costs)).card).toBeUndefined();
    });

    it('uses projected next-turn fate and keeps a strong body plus cheap bodies', function() {
        const tactics = new MulliganTactics(DEFAULT_MULLIGAN_PROFILE);
        const extraHolding = card('holding-z', 'forgotten-library', 'holding');
        const palace = card('holding-a', 'the-imperial-palace', 'holding');
        const strong = card('strong', 'strong-character', 'character');
        const cheapOne = card('cheap-1', 'cheap-one', 'character');
        const cheapTwo = card('cheap-2', 'cheap-two', 'character');
        const unaffordable = card('cost-8', 'too-expensive', 'character');
        const cards = [extraHolding, palace, strong, cheapOne, cheapTwo, unaffordable];
        const costs = { strong: 5, 'cheap-1': 1, 'cheap-2': 2, 'cost-8': 8 };

        const discarded = [];
        for(let guard = 0; guard < 10; guard++) {
            const pick = tactics.pickOpeningDynasty(input(cards, costs, { currentFate: 0, income: 7 }));
            if(!pick.card) {
                break;
            }
            discarded.push(pick.card.uuid);
            pick.card.selected = true;
        }

        expect(discarded).toEqual(['holding-z', 'cost-8']);
    });

    it('evaluates every character in a Rally stack by its own uuid cost', function() {
        const tactics = new MulliganTactics(DEFAULT_MULLIGAN_PROFILE);
        const unaffordable = card('stack-high', 'high-card', 'character', 'province 2');
        const affordable = card('stack-good', 'good-card', 'character', 'province 2');

        const pick = tactics.pickOpeningDynasty(input(
            [unaffordable, affordable],
            { 'stack-high': 9, 'stack-good': 5 },
            { currentFate: 0, income: 7 }
        ));

        expect(pick.card).toBe(unaffordable);
    });

    it('ignores broken-province cards and removes holdings from a weak board', function() {
        const tactics = new MulliganTactics(DEFAULT_MULLIGAN_PROFILE);
        const autoDiscard = card('broken', 'broken-holding', 'holding', 'province 1', false);
        const holding = card('holding', 'ordinary-holding', 'holding', 'province 2');
        const body = card('body', 'body', 'character', 'province 3');

        const pick = tactics.pickDynastyDiscard(input(
            [autoDiscard, holding, body],
            { body: 3 },
            { board: [], currentFate: 0, income: 7, roundNumber: 2 }
        ));

        expect(pick.card).toBe(holding);
        expect(pick.band).toBe('weak');
    });

    it('caps duplicate holdings and searches for a preferred body on a strong board', function() {
        const profile = {
            ...DEFAULT_MULLIGAN_PROFILE,
            preferredCharacterIds: ['togashi-mitsu-2'],
            endHoldingLimit: { weak: 0, developing: 1, strong: 3 },
            holdingCopyLimitById: { 'kakita-dojo': 1 }
        };
        const tactics = new MulliganTactics(profile);
        const dojoTwo = card('dojo-2', 'kakita-dojo', 'holding');
        const dojoOne = card('dojo-1', 'kakita-dojo', 'holding');
        const proving = card('proving', 'proving-ground', 'holding');
        const cheap = card('cheap', 'cheap-body', 'character');
        const mitsu = card('mitsu', 'togashi-mitsu-2', 'character');
        const board = [
            { type: 'character', fate: 1 },
            { type: 'character', fate: 1 },
            { type: 'character', fate: 1 }
        ];

        const pick = tactics.pickDynastyDiscard(input(
            [dojoTwo, dojoOne, proving, cheap, mitsu],
            { cheap: 1, mitsu: 4 },
            { board, currentFate: 1, income: 7, roundNumber: 3 }
        ));

        expect(pick.card).toBe(dojoTwo);
        expect(pick.band).toBe('strong');
    });

    it('applies injectable holding copy caps during the opening mulligan too', function() {
        const tactics = new MulliganTactics({
            ...DEFAULT_MULLIGAN_PROFILE,
            openingHoldingLimit: 2,
            holdingCopyLimitById: { 'kakita-dojo': 1 }
        });
        const dojoOne = card('dojo-1', 'kakita-dojo', 'holding');
        const dojoTwo = card('dojo-2', 'kakita-dojo', 'holding');
        const proving = card('proving', 'proving-ground', 'holding');
        const body = card('body', 'body', 'character');

        expect(tactics.pickOpeningDynasty(input(
            [dojoOne, dojoTwo, proving, body], { body: 4 }
        )).card).toBe(dojoTwo);
    });

    it('keeps and buys a Tsuma character while opening-mulliganing Iron Crane Legion', function() {
        const profile = resolveDeckProfile(
            ['gossip', 'kakita-yoshi-2', 'noble-sacrifice'],
            { duelist: true }
        );
        const tactics = new MulliganTactics(profile.mulligan);
        const legion = card('legion', 'iron-crane-legion', 'character', 'province 2');
        const kaezin = card('kaezin', 'kakita-kaezin', 'character', 'province 1');
        const costs = { legion: 5, kaezin: 3 };
        const provinces = { 'province 1': 'tsuma', 'province 2': 'shameful-display' };

        expect(tactics.pickOpeningDynasty(input(
            [legion, kaezin], costs, { provinceIdsByLocation: provinces }
        )).card).toBe(legion);
        expect(tactics.pickHonoredProvinceCharacter(
            [legion, kaezin], 7, costs, provinces
        )).toBe(kaezin);
    });

    describe('all-or-nothing refill provinces (City of the Rich Frog)', function() {
        // `Player.replaceDynastyCard` refuses to refill a province that still
        // holds ANY dynasty card, and City of the Rich Frog refills to THREE.
        // So the fate-phase answer there is per PROVINCE and binary: keep the
        // lot, or empty the lot. A partial discard throws cards away AND gets
        // nothing back.
        const frogProfile = (ids, min = 2) => ({
            ...DEFAULT_MULLIGAN_PROFILE,
            refillProvincePriorityCharacterIds: ids,
            refillProvinceMinPriorityCharacters: min
        });
        const state = (faceupCards, overrides = {}) => ({
            'province 1': {
                provinceId: 'city-of-the-rich-frog',
                broken: false,
                refillTo: 3,
                faceupCards,
                facedownCards: 0,
                ...overrides
            }
        });
        const frogCard = (uuid, id, type = 'character') => ({ uuid, id, type });

        it('empties the province, holdings included, below the priority bar', function() {
            const tactics = new MulliganTactics(frogProfile(['togashi-mitsu-2']));
            const plan = tactics.refillProvincePlan(input([], {}, {
                provinceRefill: state([
                    frogCard('a', 'togashi-mitsu-2'),
                    frogCard('b', 'filler-body'),
                    frogCard('c', 'shintao-monastery', 'holding')
                ])
            }));

            expect(plan.length).toBe(1);
            expect(plan[0].keep).toBe(false);
            expect(plan[0].priorityCount).toBe(1);
            expect(plan[0].uuids).toEqual(['a', 'b', 'c']);
        });

        it('keeps the whole province once the priority bar is met', function() {
            const tactics = new MulliganTactics(frogProfile(['togashi-mitsu-2', 'togashi-ichi']));
            const plan = tactics.refillProvincePlan(input([], {}, {
                provinceRefill: state([
                    frogCard('a', 'togashi-mitsu-2'),
                    frogCard('b', 'togashi-ichi'),
                    frogCard('c', 'filler-body')
                ])
            }));

            expect(plan[0].keep).toBe(true);
            expect(plan[0].priorityCount).toBe(2);
        });

        it('discards a kept holding off the province and keeps holdings elsewhere', function() {
            const tactics = new MulliganTactics({
                ...frogProfile([]),
                endHoldingLimit: { weak: 3, developing: 3, strong: 3 },
                keepHoldingIds: ['forgotten-library']
            });
            const onFrog = card('frog-holding', 'forgotten-library', 'holding', 'province 1');
            const elsewhere = card('other-holding', 'forgotten-library', 'holding', 'province 2');

            const pick = tactics.pickDynastyDiscard(input([onFrog, elsewhere], {}, {
                provinceRefill: state([frogCard('frog-holding', 'forgotten-library', 'holding')])
            }));

            expect(pick.card).toBe(onFrog);
        });

        it('leaves a BROKEN province alone: it is blank, so it refills to 1', function() {
            // `ProvinceCard.isBlank()` is true while broken, which switches the
            // card's own `refillProvinceTo(3)` off. The controller reads the
            // live effect, so a broken Rich Frog arrives here as refillTo 1 and
            // is an ordinary one-card province.
            const tactics = new MulliganTactics(frogProfile([]));
            const plan = tactics.refillProvincePlan(input([], {}, {
                provinceRefill: state([frogCard('a', 'filler-body')], { broken: true, refillTo: 1 })
            }));

            expect(plan).toEqual([]);
        });

        it('leaves the province alone while a facedown card blocks the refill', function() {
            // A facedown dynasty card is not offered by the fate phase's discard
            // prompt, so the province cannot reach empty and no refill is
            // coming. Emptying the faceup half gives up cards for nothing.
            const tactics = new MulliganTactics(frogProfile([]));
            const plan = tactics.refillProvincePlan(input([], {}, {
                provinceRefill: state([frogCard('a', 'filler-body')], { facedownCards: 2 })
            }));

            expect(plan).toEqual([]);
        });

        it('is inert on a one-card province and off with an empty id list', function() {
            const tactics = new MulliganTactics(frogProfile([]));
            expect(tactics.refillProvincePlan(input([], {}, {
                provinceRefill: {
                    'province 2': {
                        provinceId: 'manicured-garden',
                        broken: false,
                        refillTo: 1,
                        faceupCards: [frogCard('a', 'filler-body')],
                        facedownCards: 0
                    }
                }
            }))).toEqual([]);

            const off = new MulliganTactics({ ...frogProfile([]), refillProvinceIds: [] });
            expect(off.refillProvincePlan(input([], {}, {
                provinceRefill: state([frogCard('a', 'filler-body')])
            }))).toEqual([]);
        });

        it('gives every Rich Frog deck a short priority list', function() {
            const cases = [
                {
                    ids: ['illustrious-forge'], strategy: { attachmentTower: true },
                    expected: ['niten-master', 'togashi-yokuni']
                },
                {
                    ids: ['sacred-sanctuary'], strategy: { monk: true },
                    expected: ['togashi-mitsu-2', 'togashi-tadakatsu', 'togashi-ichi']
                },
                {
                    ids: [], strategy: { lionHonor: true },
                    expected: ['akodo-toturi', 'honored-general']
                },
                {
                    ids: ['hayaken-no-shiro', 'ashigaru-levy'], strategy: { aggressive: true },
                    expected: ['akodo-toturi', 'honored-general']
                }
            ];
            for(const item of cases) {
                const profile = resolveDeckProfile(item.ids, item.strategy);
                expect(profile.mulligan.refillProvincePriorityCharacterIds).toEqual(item.expected);
            }
        });
    });

    it('provides injectable mulligan profiles for every supported deck family', function() {
        const cases = [
            {
                ids: ['illustrious-forge'], strategy: { attachmentTower: true },
                check: (profile) => profile.mulligan.preferredCharacterIds.includes('niten-master')
            },
            {
                ids: ['offerings-to-the-kami'], strategy: { shugenja: true },
                check: (profile) => profile.mulligan.preferredCharacterIds.includes('asako-togama')
            },
            {
                ids: [], strategy: { defensive: true, holdingEngine: true },
                check: (profile) => profile.mulligan.endHoldingLimit.developing === 3
            },
            {
                ids: ['cavalry-reserves'], strategy: { aggressive: true },
                check: (profile) => profile.mulligan.openingHoldingLimit === 1
            },
            {
                ids: ['sacred-sanctuary'], strategy: { monk: true },
                check: (profile) => profile.mulligan.preferredCharacterIds.includes('togashi-mitsu-2')
            },
            {
                ids: ['rally-to-the-cause'], strategy: { glory: true },
                check: (profile) => profile.mulligan.endHoldingLimit.weak === 1 &&
                    profile.mulligan.preferredCharacterIds.includes('isawa-kaede')
            },
            {
                ids: ['hayaken-no-shiro'], strategy: { aggressive: true },
                check: (profile) => profile.mulligan.keepDynastyCardIds.includes('a-season-of-war')
            },
            {
                ids: ['night-raid'], strategy: { dishonor: true },
                check: (profile) => profile.mulligan.preferredCharacterIds.includes('bayushi-shoju-2')
            }
        ];

        for(const item of cases) {
            expect(item.check(resolveDeckProfile(item.ids, item.strategy))).toBe(true);
        }
    });
});
