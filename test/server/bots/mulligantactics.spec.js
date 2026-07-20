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

    it('provides injectable mulligan profiles for every supported deck family', function() {
        const cases = [
            {
                ids: ['ancestral-lands'], strategy: { attachmentTower: true },
                check: (profile) => profile.mulligan.preferredCharacterIds.includes('niten-master')
            },
            {
                ids: ['vassal-fields'], strategy: { shugenja: true },
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
