const {
    BoardAwareDynastyTactics,
    DEFAULT_BOARD_AWARE_DYNASTY,
    RUSH_BOARD_AWARE_DYNASTY
} = require('../../../build/server/game/bots/BoardAwareDynastyTactics.js');

describe('BoardAwareDynastyTactics', function() {
    const card = (uuid, id = uuid) => ({ uuid, id, type: 'character' });
    const info = (cost, military, political, extras = {}) => ({
        cost, military, political, glory: 1, abilityValue: 0,
        honoredOnEntry: false, ...extras
    });
    const boardCard = (uuid, military, political, fate = 0) => ({
        uuid, type: 'character', fate, attachments: [],
        militarySkillSummary: { stat: String(military) },
        politicalSkillSummary: { stat: String(political) }
    });
    const context = (cards, infoByUuid, extras = {}) => ({
        cards,
        infoByUuid,
        ownBoard: [],
        opponentBoard: [],
        fate: 7,
        startFate: 7,
        spent: 0,
        boughtCount: 0,
        boughtDurable: false,
        roundNumber: 1,
        firstPlayer: true,
        ownBrokenProvinces: 0,
        opponentBrokenProvinces: 0,
        ownHonor: 11,
        opponentHonor: 11,
        hand: [],
        dynamicFateReserve: 0,
        ...extras
    });

    it('puts one fate on a strong two-cost character but not a weak one', function() {
        const tactics = new BoardAwareDynastyTactics(DEFAULT_BOARD_AWARE_DYNASTY);
        const strong = card('strong');
        const weak = card('weak');

        expect(tactics.choose(context([strong], { strong: info(2, 3, 2, { abilityValue: 1 }) }))
            .additionalFate).toBe(1);
        expect(tactics.choose(context([weak], { weak: info(2, 1, 0) }))
            .additionalFate).toBe(0);
    });

    it('keeps an honored cheap character for one extra round', function() {
        const tactics = new BoardAwareDynastyTactics(DEFAULT_BOARD_AWARE_DYNASTY);
        const honored = card('honored');
        const decision = tactics.choose(context([honored], {
            honored: info(1, 1, 1, { glory: 2, honoredOnEntry: true })
        }));

        expect(decision.card).toBe(honored);
        expect(decision.additionalFate).toBe(1);
    });

    it('chooses board power instead of mirroring enemy body count', function() {
        const tactics = new BoardAwareDynastyTactics(DEFAULT_BOARD_AWARE_DYNASTY);
        const tower = card('tower');
        const weak = card('weak');
        const decision = tactics.choose(context([weak, tower], {
            weak: info(1, 1, 0),
            tower: info(5, 6, 4, { abilityValue: 1 })
        }, {
            opponentBoard: [boardCard('enemy-a', 5, 4, 1), boardCard('enemy-b', 4, 3, 1)],
            fate: 8,
            startFate: 8
        }));

        expect(decision.card).toBe(tower);
        expect(decision.reason).toBe('board-aware-match-power');
    });

    it('passes first after a durable purchase but develops another body when second player', function() {
        const tactics = new BoardAwareDynastyTactics(DEFAULT_BOARD_AWARE_DYNASTY);
        const next = card('next');
        const shared = {
            ownBoard: [boardCard('tower', 5, 4, 2)],
            fate: 2,
            startFate: 7,
            spent: 5,
            boughtCount: 1,
            boughtDurable: true
        };

        expect(tactics.choose(context([next], { next: info(2, 2, 1) }, {
            ...shared, firstPlayer: true
        })).pass).toBe(true);
        expect(tactics.choose(context([next], { next: info(2, 2, 1) }, {
            ...shared, startFate: 9, spent: 7, firstPlayer: false
        })).card).toBe(next);
    });

    it('reserves fate for valuable paid hand cards, but releases it at exposed strongholds', function() {
        const tactics = new BoardAwareDynastyTactics(DEFAULT_BOARD_AWARE_DYNASTY);
        const body = card('body');
        const costly = [
            { cost: 2, priority: 9, playable: true },
            { cost: 2, priority: 8, playable: true },
            { cost: 0, priority: 9, playable: true }
        ];
        const normal = tactics.choose(context([body], { body: info(5, 5, 4) }, {
            hand: costly
        }));
        const urgent = tactics.choose(context([body], { body: info(5, 5, 4) }, {
            hand: costly,
            ownBrokenProvinces: 3
        }));

        expect(normal.analysis.conflictReserve).toBe(4);
        expect(normal.pass).toBe(true);
        expect(urgent.analysis.conflictReserve).toBe(0);
        expect(urgent.card).toBe(body);
        expect(urgent.additionalFate).toBe(1);
    });

    it('keeps Lion and Unicorn wide while adding one fate to three/four-cost rush bodies', function() {
        const tactics = new BoardAwareDynastyTactics(RUSH_BOARD_AWARE_DYNASTY);
        const body = card('rush-body');
        const decision = tactics.choose(context([body], { 'rush-body': info(4, 4, 2) }, {
            firstPlayer: false
        }));

        expect(decision.additionalFate).toBe(1);
        expect(decision.analysis.targetCharacters).toBe(3);
    });
});
