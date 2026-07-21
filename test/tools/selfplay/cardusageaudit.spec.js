'use strict';

const {
    activationKind,
    emptyAvailability,
    expectedAbility,
    expectedPlay,
    scanAvailability,
    summarizeTrace
} = require('../../../tools/selfplay/cardUsageAudit.js');
const { summarizeDeckCoverage } = require('../../../tools/selfplay/auditCards.js');

describe('card usage audit', function() {
    it('counts source plays but rejects mulligans and character targets', function() {
        expect(activationKind({
            result: 'success', command: 'cardClicked', cardId: 'banzai', cardType: 'event',
            cardSide: 'conflict', cardLocation: 'hand', reason: 'play-conflict-card'
        })).toBe('play');
        expect(activationKind({
            result: 'success', command: 'cardClicked', cardId: 'banzai', cardType: 'event',
            cardSide: 'conflict', cardLocation: 'hand', reason: 'adaptive-mulligan-paid-conflict-card'
        })).toBeNull();
        expect(activationKind({
            result: 'success', command: 'cardClicked', cardId: 'kudaka', cardType: 'character',
            cardSide: 'dynasty', cardLocation: 'play area', reason: 'declare-attacker'
        })).toBeNull();
    });

    it('separates a dynasty purchase from an in-play ability', function() {
        expect(activationKind({
            result: 'success', command: 'cardClicked', cardId: 'kudaka', cardType: 'character',
            cardSide: 'dynasty', cardLocation: 'province 1', reason: 'fate-aware-play-strong-character'
        })).toBe('play');
        expect(activationKind({
            result: 'success', command: 'cardClicked', cardId: 'asako-togama', cardType: 'character',
            cardSide: 'dynasty', cardLocation: 'play area', reason: 'use-board-ability'
        })).toBe('ability');
        expect(activationKind({
            result: 'success', command: 'cardClicked', cardId: 'kyuden-isawa',
            cardLocation: 'stronghold', reason: 'use-board-ability'
        })).toBe('ability');
        expect(activationKind({
            result: 'success', command: 'cardClicked', cardId: 'manicured-garden',
            cardLocation: 'province 2', reason: 'province-conflict-action'
        })).toBe('ability');
    });

    it('classifies cards that require play and cards with clickable abilities', function() {
        expect(expectedPlay({ side: 'conflict', type: 'attachment' })).toBeTrue();
        expect(expectedPlay({ side: 'dynasty', type: 'character' })).toBeTrue();
        expect(expectedPlay({ side: 'dynasty', type: 'holding' })).toBeFalse();
        expect(expectedAbility({ text: '<b>Reaction:</b> After a duel resolves, honor a character.' })).toBeTrue();
        expect(expectedAbility({ text: '<b>Forced Reaction:</b> Lose 1 honor.' })).toBeFalse();
        expect(expectedAbility({ text: 'Covert. This character gets +2 military.' })).toBeFalse();
    });

    it('tracks only matching own available zones and selectable discard cards', function() {
        const availability = emptyAvailability();
        const state = {
            players: {
                Bot: {
                    cardPiles: {
                        hand: [{ id: 'event', uuid: 'h', type: 'event' }],
                        cardsInPlay: [{ id: 'body', uuid: 'b', type: 'character', attachments: [
                            { id: 'attachment', uuid: 'a', type: 'attachment', selectable: true }
                        ] }],
                        conflictDiscardPile: [
                            { id: 'dead-discard', uuid: 'd1', type: 'event' },
                            { id: 'live-discard', uuid: 'd2', type: 'event', selectable: true }
                        ]
                    },
                    provinces: { one: [{ id: 'dynasty', uuid: 'p', type: 'character' }] },
                    strongholdProvince: [], stronghold: {}, role: {}
                }
            }
        };
        scanAvailability({ getState: () => state }, 'Bot', new Set([
            'event', 'body', 'attachment', 'dynasty', 'dead-discard', 'live-discard'
        ]), availability);
        expect([...availability.hand]).toEqual(['event']);
        expect([...availability.play].sort()).toEqual(['attachment', 'body']);
        expect([...availability.province]).toEqual(['dynasty']);
        expect([...availability.selectable].sort()).toEqual(['attachment', 'live-discard']);
    });

    it('aggregates only semantic source evidence by card id', function() {
        const result = summarizeTrace([
            { result: 'success', command: 'cardClicked', cardId: 'banzai', cardLocation: 'hand', reason: 'play-conflict-card' },
            { result: 'success', command: 'cardClicked', cardId: 'banzai', cardLocation: 'hand', reason: 'adaptive-mulligan-paid-conflict-card' },
            { result: 'success', command: 'cardClicked', cardId: 'enemy', cardLocation: 'play area', reason: 'bow-enemy-ready' }
        ], new Set(['banzai']));
        expect(result.clicks).toEqual({ banzai: 2 });
        expect(result.plays).toEqual({ banzai: 1 });
        expect(result.abilities).toEqual({});
    });

    it('reports deck-wide reachability across seed rows instead of treating a sampled row as globally dead', function() {
        const card = (playUses, abilityUses) => ({
            id: 'test-card', name: 'Test Card', type: 'character', side: 'dynasty',
            playExpected: true, abilityExpected: true,
            available: { hand: 0, province: 1, play: 1, selectable: 0 },
            playUses, abilityUses, clicks: playUses + abilityUses
        });
        const coverage = summarizeDeckCoverage([
            { deck: 'Test', games: 2, failedJobs: [], cards: [card(0, 0)] },
            { deck: 'Test', games: 2, failedJobs: [], cards: [card(1, 1)] }
        ], 1)[0];

        expect(coverage.playCandidates).toEqual([]);
        expect(coverage.abilityUnreached).toEqual([]);
        expect(coverage.playCovered).toBe(1);
        expect(coverage.abilityCovered).toBe(1);
        expect(coverage.games).toBe(4);
    });
});
