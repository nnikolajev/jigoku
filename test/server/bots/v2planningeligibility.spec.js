const PlanningEligibility = require('../../../build/server/game/bots/v2/PlanningEligibility.js').default;
const ProjectionCache = require('../../../build/server/game/bots/v2/ProjectionCache.js').default;

describe('V2 planning eligibility and immutable projection cache', function() {
    const input = (title, menu = '', phase = 'conflict') => ({
        botName: 'Bot',
        playerState: {
            phase,
            players: {
                Bot: { phase, promptTitle: title, menuTitle: menu, stats: { honor: 8 }, cardPiles: { conflictDeck: [{}, {}] } },
                Opponent: { stats: { honor: 8 }, cardPiles: { conflictDeck: [{}, {}] } }
            }
        }
    });

    it('skips mechanical prompts but keeps conflict, dynasty, shadow, terminal, and macro decisions eligible', function() {
        const eligibility = new PlanningEligibility();
        expect(eligibility.evaluate(input('Honor Bid', 'Choose a bid'), 'enabled', false)).toEqual(jasmine.objectContaining({
            eligible: false, reason: 'mechanical-prompt'
        }));
        expect(eligibility.evaluate(input('Choose a character', 'Choose a target'), 'enabled', false)).toEqual(jasmine.objectContaining({
            eligible: false, reason: 'unowned-prompt-continuation'
        }));
        expect(eligibility.evaluate(input('Conflict Action Window', 'Initiate an action'), 'enabled', false)).toEqual(jasmine.objectContaining({
            eligible: true, reason: 'source-action-window'
        }));
        for(const title of ['Triggered Abilities', 'Any Reactions?', 'Any Interrupts?', 'Action Window']) {
            expect(eligibility.evaluate(input(title, 'Choose an ability'), 'enabled', false)).toEqual(jasmine.objectContaining({
                eligible: true, reason: 'source-action-window'
            }));
        }
        expect(eligibility.evaluate(input('Triggered Abilities', 'Choose an ability', 'dynasty'), 'enabled', false)).toEqual(jasmine.objectContaining({
            eligible: true, reason: 'source-action-window', promptClass: 'dynasty'
        }));
        expect(eligibility.evaluate(input('Play cards from provinces', 'Click pass when done', 'dynasty'), 'enabled', false)).toEqual(jasmine.objectContaining({
            eligible: true, reason: 'dynasty-resource-decision'
        }));
        expect(eligibility.evaluate(input('Honor Bid', 'Choose a bid'), 'shadow', false).eligible).toBeTrue();
        expect(eligibility.evaluate(input('Choose a character', 'Choose a target'), 'enabled', true)).toEqual(jasmine.objectContaining({
            eligible: true, reason: 'macro-continuation'
        }));

        const terminal = input('Military Conflict', 'Choose defenders');
        terminal.playerState.conflict = { provinceLocation: 'stronghold province' };
        expect(eligibility.evaluate(terminal, 'enabled', false)).toEqual(jasmine.objectContaining({
            eligible: true, reason: 'terminal-conflict', terminalRisk: true
        }));
    });

    it('reuses only exact namespaced keys and freezes cached projections', function() {
        const cache = new ProjectionCache(2);
        let builds = 0;
        const first = cache.getOrCreate('card-semantics', 'state-a', () => ({ nested: { value: ++builds } }));
        const second = cache.getOrCreate('card-semantics', 'state-a', () => ({ nested: { value: ++builds } }));
        const otherNamespace = cache.getOrCreate('opponent-information', 'state-a', () => ({ nested: { value: ++builds } }));

        expect(first.hit).toBeFalse();
        expect(second.hit).toBeTrue();
        expect(second.value).toBe(first.value);
        expect(otherNamespace.hit).toBeFalse();
        expect(builds).toBe(2);
        expect(Object.isFrozen(first.value)).toBeTrue();
        expect(Object.isFrozen(first.value.nested)).toBeTrue();
    });
});
