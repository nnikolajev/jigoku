'use strict';

const { DECK_LABELS } = require('../../../tools/selfplay/deckRegistry.js');
const {
    DECKS,
    isStandardBenchmarkRun,
    parseArgs,
    parseBotSeed,
    parseDrawBidPolicy,
    parsePolicyOverride,
    seatSeeds,
    seedLabel
} = require('../../../tools/selfplay/winRates.js');

describe('self-play win-rate deck selection', function() {
    it('runs every registered deck except the Crane baseline', function() {
        expect(DECKS).toEqual(DECK_LABELS.filter((label) => label !== 'Crane'));
        expect(DECKS).toContain('DragonAttachments');
        expect(DECKS.length).toBe(9);
    });

    it('accepts the renumbered seed modes and defaults to fate-aware seed 1', function() {
        expect(parseBotSeed(undefined)).toBe(1);
        expect(parseBotSeed('1')).toBe(1);
        expect(parseBotSeed('2')).toBe(2);
        expect(parseBotSeed('3')).toBe(3);
        expect(parseBotSeed('4')).toBe(1);
        expect(parseBotSeed('5')).toBe(1);
        expect(seedLabel(1)).toBe('fate-aware');
        expect(seedLabel(3)).toBe('board-aware dynasty');
        expect(parsePolicyOverride('generic')).toBe('generic');
        expect(parsePolicyOverride('fate-aware')).toBe('fate-aware');
        expect(parsePolicyOverride('board-aware')).toBe('board-aware');
        expect(parsePolicyOverride(undefined)).toBeUndefined();
        expect(parseDrawBidPolicy('legacy')).toBe('legacy');
        expect(parseDrawBidPolicy('adaptive')).toBe('adaptive');
        expect(() => parseDrawBidPolicy('random')).toThrowError('draw bid policy must be adaptive or legacy');
        expect(parseDrawBidPolicy(undefined)).toBe('adaptive');
    });

    it('parses challenger and Crane seeds independently', function() {
        expect(parseArgs([])).toEqual(jasmine.objectContaining({
            games: 100,
            botSeed: 1,
            craneSeed: 1,
            challengerPolicy: undefined,
            challengerDrawBidPolicy: 'adaptive',
            craneDrawBidPolicy: 'adaptive',
            challengerEngine: 'v1',
            craneEngine: 'v1',
            challengerV2Mode: 'enabled',
            craneV2Mode: 'enabled'
        }));
        expect(parseArgs(['100', '2'])).toEqual(jasmine.objectContaining({
            games: 100,
            botSeed: 2,
            craneSeed: 2
        }));
        expect(parseArgs(['100', '3', '2'])).toEqual(jasmine.objectContaining({
            games: 100,
            botSeed: 3,
            craneSeed: 2
        }));
        expect(parseArgs(['40', '1', '2', 'generic']).challengerPolicy).toBe('generic');
        expect(parseArgs(['40', '1', '2', '', 'adaptive', 'legacy']).craneDrawBidPolicy).toBe('legacy');
        expect(parseArgs(['40', '1', '2', '--challenger-omniscient'])).toEqual(jasmine.objectContaining({
            challengerOmniscient: true,
            craneOmniscient: false
        }));
        expect(parseArgs(['40', '1', '2', '--engine-version', 'v2', '--v2-mode', 'shadow'])).toEqual(jasmine.objectContaining({
            challengerEngine: 'v2', craneEngine: 'v2',
            challengerV2Mode: 'shadow', craneV2Mode: 'shadow'
        }));
        expect(parseArgs(['40', '1', '2', '--challenger-engine', 'v2', '--challenger-v2-mode', 'pass-through']))
            .toEqual(jasmine.objectContaining({
                challengerEngine: 'v2', craneEngine: 'v1',
                challengerV2Mode: 'pass-through', craneV2Mode: 'enabled'
            }));
    });

    it('keeps each bot seed attached to its deck when seats alternate', function() {
        expect(seatSeeds(true, 3, 2)).toEqual([3, 2]);
        expect(seatSeeds(false, 3, 2)).toEqual([2, 3]);
    });

    it('only treats complete 100-game same-seed results as a standard client benchmark', function() {
        const rows = DECKS.map((label) => ({ label, played: 100, died: null }));
        expect(isStandardBenchmarkRun(parseArgs(['100', '2']), rows)).toBe(true);
        expect(isStandardBenchmarkRun(parseArgs(['40', '2']), rows)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['100', '2', '1']), rows)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['100', '2', '2', 'generic']), rows)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['100', '2', '2', '', 'legacy']), rows)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['100', '2', '2', '--challenger-omniscient']), rows)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['100', '2', '2', '--engine-version', 'v2']), rows)).toBe(false);
        expect(isStandardBenchmarkRun(parseArgs(['100', '2']), [
            ...rows.slice(0, -1),
            { ...rows[rows.length - 1], played: 99, died: 'incomplete' }
        ])).toBe(false);
    });
});
