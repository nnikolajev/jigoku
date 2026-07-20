const {
    semanticActionKey,
    findPeriodicCycles,
    findNoProgressRuns,
    findRepeatedActionRuns,
    analyzeInteractionAudit
} = require('../../../tools/selfplay/interactionAudit.js');
const { parseArgs, aggregateRuns } = require('../../../tools/selfplay/validateBotInteractions.js');

function event(index, state, action = 'cardClicked|["card"]|Card', result = 'success', prompt = 'Action Window') {
    return {
        index,
        actionKey: action,
        semanticActionKey: action,
        promptKey: prompt,
        result,
        command: action.split('|')[0],
        target: action.split('|').at(-1),
        reason: 'test',
        before: { exact: state, structural: state, round: 1, phase: 'conflict' },
        afterSettled: { exact: state, structural: state },
        promptTitle: prompt,
        menuTitle: prompt
    };
}

describe('bot interaction-cycle validator', function() {
    it('parses all-deck defaults and configurable gates', function() {
        const options = parseArgs(['--games', '2', '--seeds', '1,3', '--click-cap', '24']);
        expect(options.games).toBe(2);
        expect(options.seeds).toEqual([1, 3]);
        expect(options.decks).toContain('PhoenixShugenja');
        expect(options.clickCap).toBe(24);
    });

    it('detects a repeated A-B state and click cycle', function() {
        const events = [];
        for(let i = 0; i < 8; i++) {
            const even = i % 2 === 0;
            events.push(event(i, even ? 'state-a' : 'state-b', even ? 'ringClicked|["fire"]|fire' : 'ringClicked|["air"]|air'));
        }
        const cycles = findPeriodicCycles(events, { minCycleRepeats: 3, maxCyclePeriod: 4 });
        expect(cycles.filter((cycle) => cycle.mode === 'exact').length).toBe(1);
        expect(cycles.some((cycle) => cycle.period === 2 && cycle.repeats >= 3)).toBeTrue();
    });

    it('does not call recurring prompts a cycle when game state advances', function() {
        const events = Array.from({ length: 12 }, (_, index) => event(index, `state-${index}`, 'menuButton|["pass"]|Pass'));
        events.forEach((entry, index) => {
            entry.afterSettled = { exact: `state-${index + 1}`, structural: `state-${index + 1}` };
        });
        expect(findPeriodicCycles(events, { minCycleRepeats: 3, maxCyclePeriod: 4 })).toEqual([]);
        expect(findNoProgressRuns(events, 4)).toEqual([]);
    });

    it('detects unchanged-state clicks and identical action bursts', function() {
        const events = Array.from({ length: 6 }, (_, index) => event(index, 'same'));
        expect(findNoProgressRuns(events, 4)[0].length).toBe(6);
        expect(findRepeatedActionRuns(events, 5)[0].length).toBe(6);
    });

    it('does not treat distinct cards in a multi-select as no-progress retries', function() {
        const events = Array.from({ length: 6 }, (_, index) =>
            event(index, 'same', `cardClicked|["card-${index}"]|Card ${index}`, 'success', 'Choose 6 cards to discard'));
        expect(findNoProgressRuns(events, 4)).toEqual([]);
    });

    it('preserves physical card identity while normalizing regenerated button identity', function() {
        const firstCard = semanticActionKey({ command: 'cardClicked', args: ['11111111-1111-4111-8111-111111111111'], target: 'Ashigaru Levy' });
        const secondCard = semanticActionKey({ command: 'cardClicked', args: ['22222222-2222-4222-8222-222222222222'], target: 'Ashigaru Levy' });
        const firstButton = semanticActionKey({ command: 'menuButton', args: ['cancel', '11111111-1111-4111-8111-111111111111'], target: 'Cancel' });
        const secondButton = semanticActionKey({ command: 'menuButton', args: ['cancel', '22222222-2222-4222-8222-222222222222'], target: 'Cancel' });

        expect(firstCard).not.toBe(secondCard);
        expect(firstButton).toBe(secondButton);
    });

    it('does not treat repeated pass responses as identical-action loops', function() {
        const events = Array.from({ length: 8 }, (_, index) =>
            event(index, `state-${index}`, 'menuButton|["pass"]|Pass', 'success', 'Conflict Action Window'));
        expect(findRepeatedActionRuns(events, 5)).toEqual([]);
    });

    it('allows short priority-pass handoffs but catches an endless pass loop', function() {
        const short = Array.from({ length: 3 }, (_, index) =>
            event(index, 'same', 'menuButton|["pass","button"]|Pass', 'success', 'Conflict Action Window'));
        const endless = Array.from({ length: 6 }, (_, index) =>
            event(index, 'same', 'menuButton|["pass","button"]|Pass', 'success', 'Conflict Action Window'));

        expect(findPeriodicCycles(short, { minCycleRepeats: 3, repeatedActionClicks: 5 })).toEqual([]);
        expect(findPeriodicCycles(endless, { minCycleRepeats: 3, repeatedActionClicks: 5 }).length).toBeGreaterThan(0);
    });

    it('fails diagnostics on unsupported prompts and full decision budgets', function() {
        const unsupported = event(0, 'a', 'unsupported', 'unsupported');
        unsupported.command = null;
        const result = analyzeInteractionAudit({
            events: [unsupported],
            tickBursts: [{ decisions: 40 }],
            maxDecisionsPerTick: 40
        }, { clickCap: 35 });
        expect(result.status).toBe('FAIL');
        expect(result.unsupported).toBe(1);
        expect(result.budgetExhaustions.length).toBe(1);
    });

    it('aggregates failures by audited deck and seed', function() {
        const run = {
            deck: 'Lion', opponent: 'Crane', seed: 1, status: 'FAIL',
            result: { stopReason: 'stalled' },
            target: {
                decisions: 10, rejected: 1, unsupported: 0, forcedProgress: 0,
                cycles: [{}], noProgressRuns: [], repeatedActionRuns: [],
                budgetExhaustions: [], maxTickClicks: 8,
                uniqueCardsClicked: 2, uniqueRingsClicked: 1
            },
            opponentAudit: {
                decisions: 7, rejected: 2, unsupported: 0, forcedProgress: 0,
                cycles: [], noProgressRuns: [], repeatedActionRuns: [],
                budgetExhaustions: [], maxTickClicks: 4,
                uniqueCardsClicked: 1, uniqueRingsClicked: 2
            }
        };
        const summary = aggregateRuns([run]);
        expect(summary[0].status).toBe('FAIL');
        expect(summary[0].cycles).toBe(1);
        expect(summary[0].stalls).toBe(1);
        expect(summary[0].decisions).toBe(17);
        expect(summary[0].rejected).toBe(3);
    });
});
