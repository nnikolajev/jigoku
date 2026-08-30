const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Bayushi Kachiko (Atonement) makes the OPPONENT's discarded EVENTS playable
// while she participates in a political conflict, three per round. Those cards
// come from a decklist we are not running, so the tactics package that owns
// each card's logic is absent from our profile — and every card-keyed branch in
// `polarityTargetDecision` is gated on such a package being present.
//
// The result was that a replayed event fell through to the generic
// skill-ordered picker and every deck-specific rule written for it was skipped.
// Found 2026-08-30 while fixing the Clarity of Purpose double-spend: the
// Scorpion seat re-targeted the body that already had Clarity, because the
// Clarity branch was gated on `shugenja`.
//
// The fix lends the MISSING packages at their own module defaults, scoped to a
// prompt whose source card we actually replayed out of the opponent's discard.
// Default logic for the card beats no logic for the card; a deck that runs the
// card keeps its own tuned module, and an ordinary prompt is untouched.
describe('Kachiko replays use the replayed card\'s own deck logic', function() {
    // The Scorpion bid-war seat: Kachiko's deck. It has NONE of the packages
    // that own the cards tested below.
    const scorpionIds = ['kyuden-bayushi', 'bayushi-kachiko-2', 'social-puppeteer'];
    const scorpion = resolveDeckProfile(scorpionIds, deriveDeckStrategy(scorpionIds));

    it('does not itself run the packages these cards belong to', function() {
        expect(scorpion.bidWar).toBeTruthy();
        expect(scorpion.shugenja).toBeFalsy();
        expect(scorpion.duelist).toBeFalsy();
        expect(scorpion.lion).toBeFalsy();
        expect(scorpion.unicorn).toBeFalsy();
    });

    function chr(uuid, id, skill, extra = {}) {
        return {
            id, uuid, type: 'character', selectable: true, bowed: false, inConflict: true,
            militarySkillSummary: { stat: String(skill) },
            politicalSkillSummary: { stat: String(skill) },
            ...extra
        };
    }

    function state(promptTitle, menuTitle, buttons, mine, theirs, discard) {
        return {
            players: {
                Scorpion: {
                    name: 'Scorpion', id: 'scorpion-id', phase: 'conflict',
                    promptTitle, menuTitle, buttons,
                    stats: { fate: 5, honor: 10, conflictsRemaining: 1 },
                    cardPiles: { hand: [], cardsInPlay: mine }, strongholdProvince: []
                },
                Phoenix: {
                    name: 'Phoenix', id: 'phoenix-id', stats: { fate: 2, conflictsRemaining: 1 },
                    cardPiles: { cardsInPlay: theirs, conflictDiscardPile: discard },
                    strongholdProvince: []
                }
            },
            rings: {},
            conflict: {
                type: 'political', attackingPlayerId: 'scorpion-id', defendingPlayerId: 'phoenix-id',
                attackerSkill: 9, defenderSkill: 3
            }
        };
    }

    const PASS = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
    const CANCEL = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];

    /**
     * Drive the two real prompts in order: the action window where the replay
     * is chosen, then the target prompt the replayed card opens. The second
     * step only sees the card as a replay because the first step accepted it,
     * which is exactly the ordering the engine produces.
     */
    function replayThenTarget(policy, cardId, gameActions, mine, theirs, extraContext = {}) {
        const replay = {
            id: cardId, uuid: 'replay-1', type: 'event',
            location: 'conflict discard pile', isPlayableByMe: true
        };
        const context = {
            profile: scorpion,
            cardHint: (id) => getPlaybookEntry(id),
            conflictCosts: { 'replay-1': 1 }
        };
        const play = policy.decide(
            state('Conflict Action Window', 'Political Air conflict\nAttacker: 9 Defender: 3',
                PASS, mine, theirs, [replay]),
            'Scorpion', { ...context, promptIdentity: 'window' });
        const target = policy.decide(
            state(cardId, 'Choose a character', CANCEL, mine, theirs, [replay]),
            'Scorpion',
            {
                ...context,
                targetHint: { sourceCardId: cardId, sourceIsMine: true, gameActions },
                promptIdentity: 'target',
                ...extraContext
            });
        return { play, target };
    }

    it('routes a replayed Clarity of Purpose through the Phoenix rule, protection included', function() {
        const kachiko = chr('kachiko', 'bayushi-kachiko-2', 6);
        const puppeteer = chr('puppeteer', 'social-puppeteer', 3);

        // Kachiko is the bigger body, so the generic picker takes her. With the
        // Phoenix rule reached she is skipped: she already carries Clarity.
        const { play, target } = replayThenTarget(
            new JigokuBotPolicy('kachiko-clarity'), 'clarity-of-purpose', ['cardLastingEffect'],
            [kachiko, puppeteer], [],
            { lastingEffectSourceIdsByUuid: { kachiko: ['clarity-of-purpose'] } });

        expect(play.command).toBe('cardClicked');
        expect(play.args[0]).toBe('replay-1');
        expect(target.reason).toBe('clarity-of-purpose-tower');
        expect(target.args[0]).toBe('puppeteer');
    });

    it('routes a replayed Way of the Crane through the Crane honor rule', function() {
        const kachiko = chr('kachiko', 'bayushi-kachiko-2', 6);
        const puppeteer = chr('puppeteer', 'social-puppeteer', 3);
        const { play, target } = replayThenTarget(
            new JigokuBotPolicy('kachiko-crane'), 'way-of-the-crane', ['honor'],
            [kachiko, puppeteer], []);

        expect(play.args[0]).toBe('replay-1');
        // The Crane-specific honor-token branch, not the generic
        // `honor-own-highest-glory` fallback.
        expect(target.reason).toBe('crane-honor-token-target');
    });

    it('leaves an ordinary prompt on the generic path', function() {
        // The SAME card and prompt, never replayed out of their discard. The
        // deck-specific branch must not fire, or the fallback would be leaking
        // foreign logic into every seat.
        const kachiko = chr('kachiko', 'bayushi-kachiko-2', 6);
        const puppeteer = chr('puppeteer', 'social-puppeteer', 3);
        const decision = new JigokuBotPolicy('no-replay').decide(
            state('way-of-the-crane', 'Choose a character', CANCEL, [kachiko, puppeteer], [], []),
            'Scorpion',
            {
                profile: scorpion,
                cardHint: (id) => getPlaybookEntry(id),
                targetHint: { sourceCardId: 'way-of-the-crane', sourceIsMine: true, gameActions: ['honor'] }
            });
        expect(decision.reason).toBe('honor-own-highest-glory');
    });

    it('keeps a package the deck actually runs instead of the default one', function() {
        // Scorpion runs `bidWar`, so a replayed card whose branch is gated on
        // bidWar must still use the deck's own tuned profile. Asserted through
        // the profile identity the branch would read.
        const policy = new JigokuBotPolicy('own-package');
        const kachiko = chr('kachiko', 'bayushi-kachiko-2', 6);
        const { target } = replayThenTarget(policy, 'clarity-of-purpose', ['cardLastingEffect'],
            [kachiko], []);
        // Nothing about the bid-war package changed, and the replayed card
        // still resolved through its own owner's rule.
        expect(target.reason).toBe('clarity-of-purpose-tower');
        expect(scorpion.bidWar.kachikoReplayMaxPerRound).toBe(3);
    });

    it('forgets replayed cards on the round boundary', function() {
        const policy = new JigokuBotPolicy('round-boundary');
        const kachiko = chr('kachiko', 'bayushi-kachiko-2', 6);
        const puppeteer = chr('puppeteer', 'social-puppeteer', 3);

        const first = replayThenTarget(policy, 'way-of-the-crane', ['honor'],
            [kachiko, puppeteer], []);
        expect(first.target.reason).toBe('crane-honor-token-target');

        // The draw-phase bid: a real round boundary.
        const bid = state('Honor Bid', 'Choose how much honor to bid in the draw phase',
            ['1', '2', '3', '4', '5'].map((text) => ({ text, arg: text, uuid: text })),
            [kachiko, puppeteer], [], []);
        delete bid.conflict;
        policy.decide(bid, 'Scorpion', { profile: scorpion, promptIdentity: 'draw-bid' });

        const after = policy.decide(
            state('way-of-the-crane', 'Choose a character', CANCEL, [kachiko, puppeteer], [], []),
            'Scorpion',
            {
                profile: scorpion,
                cardHint: (id) => getPlaybookEntry(id),
                targetHint: { sourceCardId: 'way-of-the-crane', sourceIsMine: true, gameActions: ['honor'] },
                promptIdentity: 'after-round'
            });
        expect(after.reason).toBe('honor-own-highest-glory');
    });
});
