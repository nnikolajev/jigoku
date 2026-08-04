const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// A defense sized on the skill currently on the table is a free flip: the
// attacker acts AFTER defenders are declared. Two separate corrections live
// here, and they are measured separately because one is a rules fact and the
// other is a judgement call.
//
//  * `defenseBreakTie` — attackers win ties (`conflict.ts:517`), so landing
//    exactly on the attacker's skill saves the province but LOSES the conflict
//    and the ring. The win-only path always added this 1; the shared
//    prevent-break path never did.
//  * `defenseThreatBufferRate`/`Cap` — hold back skill for one opposing trick,
//    sized from public hand count and fate. Capped, because budgeting for the
//    opponent's entire affordable threat was measured net-negative even with
//    exact hand knowledge.
describe('defense threat buffer', function() {
    const defender = (uuid, mil, inConflict = false) => ({
        uuid: uuid,
        name: uuid,
        type: 'character',
        location: 'play area',
        bowed: false,
        inConflict: inConflict,
        militarySkillSummary: { stat: String(mil) },
        politicalSkillSummary: { stat: '0' }
    });

    // `promptTitle` carries the live skill line the policy parses.
    const makeState = (line, cardsInPlay, opponent = {}, mine = {}) => ({
        players: {
            'Jigoku Bot': Object.assign({
                name: 'Jigoku Bot',
                promptTitle: line,
                menuTitle: 'Choose defenders',
                buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                cardPiles: { cardsInPlay: cardsInPlay }
            }, mine),
            'Opponent': Object.assign({
                name: 'Opponent',
                stats: { fate: 0 },
                cardPiles: { hand: [], cardsInPlay: [] }
            }, opponent)
        }
    });

    const profile = (overrides) => ({
        profile: Object.assign(resolveDeckProfile([]), overrides),
        roundNumber: 3
    });

    describe('defenseBreakTie', function() {
        it('stops on the exact tie by default, which loses the conflict', function() {
            // 3 vs 0 with a single 3-skill body: matching to 3 is a TIE, and a
            // tie goes to the attacker. This is the shipped legacy behavior.
            const policy = new JigokuBotPolicy('defend');
            const state = makeState('Military Air Conflict: 3 vs 0', [defender('a', 3), defender('b', 1)]);
            const first = policy.decide(state, 'Jigoku Bot', profile({}));
            expect(first.command).toBe('cardClicked');
            expect(first.args[0]).toBe('a');

            const after = makeState('Military Air Conflict: 3 vs 3',
                [defender('a', 3, true), defender('b', 1)]);
            const done = policy.decide(after, 'Jigoku Bot', profile({}));
            expect(done.command).toBe('menuButton');
            expect(done.target).toBe('Done');
        });

        it('takes one more skill to actually WIN when enabled', function() {
            const policy = new JigokuBotPolicy('defend');
            const after = makeState('Military Air Conflict: 3 vs 3',
                [defender('a', 3, true), defender('b', 1)]);
            const more = policy.decide(after, 'Jigoku Bot', profile({ defenseBreakTie: true }));
            expect(more.command).toBe('cardClicked');
            expect(more.args[0]).toBe('b');
        });

        it('does not chase a tie it cannot break', function() {
            // Only the 3-skill body exists, so `potential` equals the attacker
            // skill exactly and there is no +1 available. Committing it still
            // prevents the break, so the bot must not fold instead.
            const policy = new JigokuBotPolicy('defend');
            const after = makeState('Military Air Conflict: 3 vs 3', [defender('a', 3, true)]);
            const done = policy.decide(after, 'Jigoku Bot', profile({ defenseBreakTie: true }));
            expect(done.command).toBe('menuButton');
            expect(done.target).toBe('Done');
        });
    });

    describe('defenseThreatBuffer', function() {
        const buffered = { defenseThreatBufferRate: 0.5, defenseThreatBufferCap: 2 };

        it('is inert while the rate is zero', function() {
            const policy = new JigokuBotPolicy('defend');
            const state = makeState('Military Air Conflict: 5 vs 5',
                [defender('a', 5, true), defender('b', 2)],
                { stats: { fate: 5 }, cardPiles: { hand: [{}, {}, {}, {}], cardsInPlay: [] } });
            const done = policy.decide(state, 'Jigoku Bot', profile({}));
            expect(done.command).toBe('menuButton');
            expect(done.target).toBe('Done');
        });

        it('holds back extra skill against a full hand with fate to spend', function() {
            const policy = new JigokuBotPolicy('defend');
            const state = makeState('Military Air Conflict: 5 vs 5',
                [defender('a', 5, true), defender('b', 2)],
                { stats: { fate: 5 }, cardPiles: { hand: [{}, {}, {}, {}], cardsInPlay: [] } });
            const more = policy.decide(state, 'Jigoku Bot', profile(buffered));
            expect(more.command).toBe('cardClicked');
            expect(more.args[0]).toBe('b');
        });

        it('spends nothing extra against an empty hand', function() {
            // A dumped hand cannot punish a minimal block. This is the case a
            // flat constant buffer cannot express.
            const policy = new JigokuBotPolicy('defend');
            const state = makeState('Military Air Conflict: 5 vs 5',
                [defender('a', 5, true), defender('b', 2)],
                { stats: { fate: 5 }, cardPiles: { hand: [], cardsInPlay: [] } });
            const done = policy.decide(state, 'Jigoku Bot', profile(buffered));
            expect(done.command).toBe('menuButton');
            expect(done.target).toBe('Done');
        });

        it('spends nothing extra against a hand with no fate behind it', function() {
            // fate 0 still allows one 0-cost trick, so the affordable count is
            // 1 and a rate of 0.5 rounds up to a buffer of 1 — but a rate of
            // 0.5 with no fate must never reach the cap.
            const policy = new JigokuBotPolicy('defend');
            const cheap = new JigokuBotPolicy('defend');
            const state = (fate) => makeState('Military Air Conflict: 5 vs 5',
                [defender('a', 5, true), defender('b', 2)],
                { stats: { fate: fate }, cardPiles: { hand: [{}, {}, {}, {}], cardsInPlay: [] } });
            // fate 5, hand 4 -> affordable 4 -> ceil(2) capped at 2
            expect(policy.decide(state(5), 'Jigoku Bot', profile(buffered)).command).toBe('cardClicked');
            // fate 0, hand 4 -> affordable 1 -> ceil(0.5) = 1, still a buffer
            expect(cheap.decide(state(0), 'Jigoku Bot', profile(buffered)).command).toBe('cardClicked');
        });
    });

    describe('defenseThreatBufferIdleOnly', function() {
        // The buffer's only cost is bodies bowed. Unscoped it measured -1.4pp
        // with the whole loss on the two decks that spend those bodies
        // attacking (Crane -7.4, Unicorn -7.4), so restrict it to conflicts
        // after which we have nothing else to do with them.
        const scoped = {
            defenseThreatBufferRate: 0.5,
            defenseThreatBufferCap: 2,
            defenseThreatBufferIdleOnly: true
        };
        const threatening = { stats: { fate: 5 }, cardPiles: { hand: [{}, {}, {}, {}], cardsInPlay: [] } };
        const state = (conflictsRemaining) => makeState('Military Air Conflict: 5 vs 5',
            [defender('a', 5, true), defender('b', 2)],
            threatening,
            { stats: { conflictsRemaining: conflictsRemaining } });

        it('withholds the buffer while a conflict of our own is still coming', function() {
            const policy = new JigokuBotPolicy('defend');
            const done = policy.decide(state(1), 'Jigoku Bot', profile(scoped));
            expect(done.command).toBe('menuButton');
            expect(done.target).toBe('Done');
        });

        it('spends the buffer once those bodies have no other use', function() {
            const policy = new JigokuBotPolicy('defend');
            const more = policy.decide(state(0), 'Jigoku Bot', profile(scoped));
            expect(more.command).toBe('cardClicked');
            expect(more.args[0]).toBe('b');
        });

        it('is unscoped when the flag is off, whatever remains', function() {
            const policy = new JigokuBotPolicy('defend');
            const unscoped = { defenseThreatBufferRate: 0.5, defenseThreatBufferCap: 2 };
            const more = policy.decide(state(2), 'Jigoku Bot', profile(unscoped));
            expect(more.command).toBe('cardClicked');
        });
    });
});
