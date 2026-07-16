const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const { getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');

// Regression boundary: seed 1 must not shadow deck-specific dynasty selectors,
// fate placement, reserves, or dynasty actions. Generic-policy integration
// tests already cover these branches; this suite proves the default seed can
// reach them too.
describe('fate-aware deck-specific dynasty reachability', function() {
    const playerName = 'Jigoku Bot';
    const passButton = { text: 'Pass', arg: 'pass', uuid: 'pass' };
    const fateButtons = [0, 1, 2, 3, 4, 5].map((amount) => ({
        text: String(amount), arg: String(amount), uuid: `fate-${amount}`
    }));

    const AGGRESSIVE = { holdingEngine: false, defensive: false, aggressive: true, dishonor: false };
    const MONK = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, monk: true };
    const DUELIST = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, duelist: true };
    const ATTACHMENT_TOWER = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, attachmentTower: true };
    const SHUGENJA = { holdingEngine: false, defensive: false, aggressive: false, dishonor: false, shugenja: true };
    const CRAB = { holdingEngine: true, defensive: true, aggressive: false, dishonor: false };

    const character = (uuid, id = uuid, extras = {}) => ({
        uuid, id, name: id, type: 'character', isDynasty: true,
        facedown: false, selectable: true, ...extras
    });

    function dynastyState(fate, provinceCards, options = {}) {
        return {
            players: {
                [playerName]: {
                    name: playerName,
                    phase: 'dynasty',
                    promptTitle: 'Action Window',
                    menuTitle: 'Initiate an action',
                    buttons: [passButton],
                    stats: { fate },
                    provinces: { one: provinceCards, two: [], three: [], four: [] },
                    strongholdProvince: options.strongholdProvince || [],
                    cardPiles: {
                        hand: options.hand || [],
                        cardsInPlay: options.board || []
                    }
                },
                Crane: {
                    name: 'Crane',
                    stats: { fate: 0 },
                    cardPiles: { hand: [], cardsInPlay: options.opponentBoard || [] }
                }
            }
        };
    }

    function additionalFateState(fate, options = {}) {
        return {
            players: {
                [playerName]: {
                    name: playerName,
                    promptTitle: 'Deploy',
                    menuTitle: 'Choose additional fate',
                    buttons: fateButtons,
                    stats: { fate },
                    cardPiles: { hand: options.hand || [], cardsInPlay: options.board || [] }
                },
                Crane: { name: 'Crane', stats: { fate: 0 }, cardPiles: { hand: [], cardsInPlay: [] } }
            }
        };
    }

    it('reaches Lion buyer and Lion fate placement under seed 1', function() {
        const profile = resolveDeckProfile(
            ['hayaken-no-shiro', 'ashigaru-levy', 'for-greater-glory'],
            AGGRESSIVE
        );
        const policy = new FateAwareJigokuBotPolicy('lion-reachability');
        const tower = character('toturi', 'akodo-toturi');

        const buy = policy.decide(dynastyState(7, [tower]), playerName, {
            roundNumber: 1,
            profile,
            dynastyCosts: { toturi: 5 }
        });
        expect(buy.reason).toBe('lion-play-dynasty-card');
        expect(buy.args[0]).toBe('toturi');

        const fate = policy.decide(additionalFateState(2), playerName, {
            roundNumber: 1,
            profile,
            playCardId: 'akodo-toturi',
            playCost: 5
        });
        expect(fate.reason).toBe('lion-character-fate');
        expect(fate.target).toBe('2');
    });

    it('copies Lion hybrid swarm economy to Unicorn', function() {
        const lion = resolveDeckProfile(['hayaken-no-shiro', 'ashigaru-levy'], AGGRESSIVE).fateAwareEconomy;
        const unicornProfile = resolveDeckProfile(['cavalry-reserves'], AGGRESSIVE);
        const unicorn = unicornProfile.fateAwareEconomy;
        for(const key of [
            'prioritizeBodies', 'passAfterDurable', 'durableAdditionalFateEarly',
            'durableAdditionalFateLate', 'bodySpendCapEarly', 'bodySpendCapLate',
            'bodySpendCapWithPersistent', 'bodyMaxCost',
            'bodyAdditionalFateForCostThree', 'bodyOrder',
            'bodyBudgetIncludesDurableSpend', 'bodyFateReserve'
        ]) {
            expect(unicorn[key]).toBe(lion[key]);
        }

        const policy = new FateAwareJigokuBotPolicy('unicorn-swarm-economy');
        const strong = character('shono', 'shinjo-shono');
        const body = character('scout', 'border-rider');
        const context = {
            roundNumber: 3,
            profile: unicornProfile,
            dynastyCosts: { shono: 5, scout: 2 }
        };
        expect(policy.decide(dynastyState(10, [strong, body]), playerName, context).args[0]).toBe('shono');
        expect(policy.decide(additionalFateState(5), playerName, {
            roundNumber: 3, profile: unicornProfile, playCost: 5
        }).target).toBe('2');
        expect(policy.decide(dynastyState(3, [body]), playerName, context).args[0]).toBe('scout');
    });

    it('reaches Dragon monk fate placement under seed 1', function() {
        const profile = profileFromStrategy(MONK);
        const policy = new FateAwareJigokuBotPolicy('dragon-reachability');
        const mitsu = character('mitsu', 'togashi-mitsu-2');
        policy.decide(dynastyState(10, [mitsu]), playerName, {
            roundNumber: 1, profile, dynastyCosts: { mitsu: 4 }
        });

        const fate = policy.decide(additionalFateState(6), playerName, {
            roundNumber: 1, profile, playCardId: 'togashi-mitsu-2', playCost: 4
        });
        expect(fate.reason).toBe('dragon-tower-fate');
        expect(fate.target).toBe('3');
    });

    it('reaches Duel tower, support, save, and fate branches under seed 1', function() {
        const profile = profileFromStrategy(DUELIST);
        const towerPolicy = new FateAwareJigokuBotPolicy('duel-tower-reachability');
        const kaezin = character('kaezin', 'kakita-kaezin');
        const towerBuy = towerPolicy.decide(dynastyState(8, [kaezin]), playerName, {
            roundNumber: 1, profile, dynastyCosts: { kaezin: 3 }
        });
        expect(towerBuy.reason).toBe('duel-play-tower');
        const towerFate = towerPolicy.decide(additionalFateState(8), playerName, {
            roundNumber: 1, profile, playCardId: 'kakita-kaezin', playCost: 3
        });
        expect(towerFate.reason).toBe('duel-tower-fate');
        expect(towerFate.target).toBe('3');

        const savePolicy = new FateAwareJigokuBotPolicy('duel-save-reachability');
        const tengu = character('tengu', 'tengu-sensei');
        const helper = character('scout', 'cautious-scout');
        const context = { roundNumber: 1, profile, dynastyCosts: { tengu: 5, scout: 1 } };
        const support = savePolicy.decide(dynastyState(6, [tengu, helper]), playerName, context);
        expect(support.reason).toBe('duel-play-support');
        savePolicy.decide(additionalFateState(6), playerName, {
            roundNumber: 1, profile, playCardId: 'cautious-scout', playCost: 1
        });
        expect(savePolicy.decide(dynastyState(6, [tengu]), playerName, context).reason)
            .toBe('duel-save-for-tower');
    });

    it('reaches Dragon attachment tower, support, save, and fate branches under seed 1', function() {
        const profile = profileFromStrategy(ATTACHMENT_TOWER);
        const towerPolicy = new FateAwareJigokuBotPolicy('attachment-tower-reachability');
        const raitsugu = character('raitsugu', 'mirumoto-raitsugu');
        const towerBuy = towerPolicy.decide(dynastyState(8, [raitsugu]), playerName, {
            roundNumber: 1, profile, dynastyCosts: { raitsugu: 3 }
        });
        expect(towerBuy.reason).toBe('attachment-tower-play-tower');
        const towerFate = towerPolicy.decide(additionalFateState(8), playerName, {
            roundNumber: 1, profile, playCardId: 'mirumoto-raitsugu', playCost: 3
        });
        expect(towerFate.reason).toBe('attachment-tower-fate');
        expect(towerFate.target).toBe('4');

        const savePolicy = new FateAwareJigokuBotPolicy('attachment-save-reachability');
        const yokuni = character('yokuni', 'togashi-yokuni');
        const helper = character('doomed', 'doomed-shugenja');
        const context = { roundNumber: 1, profile, dynastyCosts: { yokuni: 5, doomed: 1 } };
        expect(savePolicy.decide(dynastyState(7, [yokuni, helper]), playerName, context).reason)
            .toBe('attachment-tower-play-support');
        savePolicy.decide(additionalFateState(6), playerName, {
            roundNumber: 1, profile, playCardId: 'doomed-shugenja', playCost: 1
        });
        expect(savePolicy.decide(dynastyState(6, [yokuni]), playerName, context).reason)
            .toBe('attachment-tower-save-fate');
    });

    it('reaches Phoenix Tadaka setup selection, fate, and dynamic reserve under seed 1', function() {
        const profile = profileFromStrategy(SHUGENJA);
        const tadaka = { uuid: 'tadaka', id: 'isawa-tadaka-2', type: 'character', isPlayableByMe: true };
        const dreamer = character('dreamer', 'ethereal-dreamer');
        const policy = new FateAwareJigokuBotPolicy('shugenja-setup-reachability');
        const buy = policy.decide(dynastyState(7, [dreamer], { hand: [tadaka] }), playerName, {
            roundNumber: 1, profile, dynastyCosts: { dreamer: 1 }
        });
        expect(buy.reason).toBe('tadaka-setup-character');
        const fate = policy.decide(additionalFateState(7, { hand: [tadaka] }), playerName, {
            roundNumber: 1, profile, playCardId: 'ethereal-dreamer', playCost: 1
        });
        expect(fate.reason).toBe('tadaka-setup-fate');
        expect(fate.target).toBe('2');

        const reservePolicy = new FateAwareJigokuBotPolicy('shugenja-reserve-reachability');
        const ownShugenja = character('adept-board', 'adept-of-the-waves', { location: 'play area' });
        const target = character('enemy-tower', 'enemy-tower', { location: 'play area', fate: 5 });
        const fires = { uuid: 'fires', id: 'consumed-by-five-fires', type: 'event' };
        const ordinary = character('ordinary', 'shiba-yojimbo');
        const reserve = reservePolicy.decide(dynastyState(7, [ordinary], {
            hand: [fires], board: [ownShugenja], opponentBoard: [target]
        }), playerName, {
            roundNumber: 3, profile, dynastyCosts: { ordinary: 3 }
        });
        expect(reserve.reason).toBe('fate-aware-preserve-fate');
    });

    it('reaches Crab dynasty dig after a fate-aware character purchase', function() {
        const profile = resolveDeckProfile(['kyuden-hida'], CRAB);
        const board = [0, 1, 2].map((index) =>
            character(`board-${index}`, `board-${index}`, { location: 'play area' }));
        const recruit = character('recruit', 'hida-guardian');
        const stronghold = [{
            uuid: 'kh', id: 'kyuden-hida', name: 'Kyuden Hida', type: 'stronghold',
            facedown: false, bowed: false, location: 'stronghold province'
        }];
        const policy = new FateAwareJigokuBotPolicy('crab-dig-reachability');
        policy.decide(dynastyState(5, [recruit], { board, strongholdProvince: stronghold }), playerName, {
            roundNumber: 3, profile, dynastyCosts: { recruit: 1 }, cardHint: getPlaybookEntry
        });
        policy.decide(additionalFateState(4, { board }), playerName, {
            roundNumber: 3, profile, playCardId: 'hida-guardian', playCost: 1
        });

        const dig = policy.decide(dynastyState(4, [], { board, strongholdProvince: stronghold }), playerName, {
            roundNumber: 3, profile, dynastyCosts: {}, cardHint: getPlaybookEntry
        });
        expect(dig.reason).toBe('dynasty-dig-action');
        expect(dig.args[0]).toBe('kh');
    });
});
