'use strict';

// Standardized self-play results consumed by jigoku-client. Win rates use 100
// games per deck; the much larger round robin uses 40 games per matchup.

const fs = require('fs');
const path = require('path');

const STANDARD_WIN_RATE_GAMES = 100;
const STANDARD_ROUND_ROBIN_GAMES = 40;
const STANDARD_OMNISCIENT_GAMES = 20;
// Backward-compatible win-rate name used by winRates.js.
const STANDARD_GAMES = STANDARD_WIN_RATE_GAMES;
const BENCHMARK_VERSION = 5;
// Changing the standard opponent or the round-robin deck roster invalidates
// previously recorded numbers. The client only displays matching sections.
const STANDARD_SUITE_ID = 'crane-baseline-4736f7c0';
const DEFAULT_RESULTS_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'jigoku-client',
    'client',
    'botBenchmarkResults.json'
);

const SEED_LABELS = Object.freeze({
    1: 'fate-aware',
    2: 'old heuristic',
    3: 'board-aware dynasty'
});

function emptyBenchmark() {
    return {
        version: BENCHMARK_VERSION,
        standard: {
            suiteId: STANDARD_SUITE_ID,
            gamesPerDeck: STANDARD_WIN_RATE_GAMES,
            gamesPerMatchup: STANDARD_ROUND_ROBIN_GAMES,
            gamesPerOmniscientMatchup: STANDARD_OMNISCIENT_GAMES,
            sameSeedOpponents: true,
            seatsAlternate: true
        },
        updatedAt: null,
        seeds: {}
    };
}

function migrateBoardAwareSeed(entry) {
    if(!entry) {
        return entry;
    }
    const remap = (section) => section ? {
        ...section,
        ...(section.challengerSeed === 4 ? { challengerSeed: 3 } : {}),
        ...(section.opponentSeed === 4 ? { opponentSeed: 3 } : {}),
        ...(section.botSeed === 4 ? { botSeed: 3 } : {})
    } : section;
    return {
        ...entry,
        seed: 3,
        label: SEED_LABELS[3],
        winRates: remap(entry.winRates),
        roundRobin: remap(entry.roundRobin),
        omniscient: remap(entry.omniscient)
    };
}

function readBenchmark(filePath = process.env.JIGOKU_BOT_BENCHMARK_PATH || DEFAULT_RESULTS_PATH) {
    if(!fs.existsSync(filePath)) {
        return emptyBenchmark();
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const rawSeeds = parsed.seeds || {};
        // Version 4 used seed 3 for omniscience and seed 4 for board-aware.
        // Preserve board-aware standard results while renumbering it to 3.
        const migratedSeedThree = migrateBoardAwareSeed(
            Number(parsed.version) < BENCHMARK_VERSION && rawSeeds['4']
                ? rawSeeds['4']
                : rawSeeds['3']
        );
        const seeds = {
            ...Object.fromEntries(Object.entries(rawSeeds).filter(([key]) => ['1', '2'].includes(key))),
            ...(migratedSeedThree ? { '3': migratedSeedThree } : {})
        };
        return {
            ...emptyBenchmark(),
            ...parsed,
            version: BENCHMARK_VERSION,
            // Code defines the current standard. Do not preserve obsolete game
            // counts from an older generated config.
            standard: { ...(parsed.standard || {}), ...emptyBenchmark().standard },
            seeds
        };
    } catch(error) {
        throw new Error(`Cannot read bot benchmark config ${filePath}: ${error.message}`);
    }
}

function mergeBenchmark(current, seed, section, payload) {
    const generatedAt = payload.generatedAt || new Date().toISOString();
    const key = String(seed);
    return {
        ...emptyBenchmark(),
        ...current,
        version: BENCHMARK_VERSION,
        updatedAt: generatedAt,
        seeds: {
            ...(current.seeds || {}),
            [key]: {
                ...((current.seeds || {})[key] || {}),
                seed,
                label: SEED_LABELS[seed] || `seed ${seed}`,
                [section]: payload
            }
        }
    };
}

function writeBenchmarkSection(seed, section, payload, filePath = process.env.JIGOKU_BOT_BENCHMARK_PATH || DEFAULT_RESULTS_PATH) {
    const next = mergeBenchmark(readBenchmark(filePath), seed, section, payload);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
    return filePath;
}

function winRatesPayload(options, rows, generatedAt = new Date().toISOString()) {
    const decks = {};
    let wins = 0;
    let losses = 0;
    let other = 0;
    let played = 0;
    for(const row of rows) {
        decks[row.label] = {
            wins: row.wins,
            losses: row.losses,
            other: row.other,
            played: row.played,
            winRate: row.played > 0 ? row.wins / row.played : null
        };
        wins += row.wins;
        losses += row.losses;
        other += row.other;
        played += row.played;
    }
    return {
        suiteId: STANDARD_SUITE_ID,
        generatedAt,
        gamesPerDeck: options.games,
        challengerSeed: options.botSeed,
        opponent: 'Crane',
        opponentSeed: options.craneSeed,
        challengerDrawBidPolicy: options.challengerDrawBidPolicy || 'adaptive',
        opponentDrawBidPolicy: options.craneDrawBidPolicy || 'adaptive',
        seatsAlternate: true,
        totals: {
            wins,
            losses,
            other,
            played,
            winRate: played > 0 ? wins / played : null
        },
        decks
    };
}

function roundRobinPayload(report) {
    const decks = {};
    for(const row of report.deckSummaries) {
        decks[row.deck] = {
            wins: row.wins,
            losses: row.losses,
            other: row.other,
            played: row.played,
            overallWinRate: row.overallWinRate,
            averageOpponentWinRate: row.averageOpponentWinRate,
            opponentsCompleted: row.opponentsCompleted
        };
    }
    return {
        suiteId: STANDARD_SUITE_ID,
        generatedAt: report.generatedAt,
        gamesPerMatchup: report.config.games,
        botSeed: report.config.botSeed,
        drawBidPolicy: report.config.drawBidPolicy || 'adaptive',
        seatsAlternate: true,
        decks
    };
}

function omniscientPayload(report) {
    const decks = {};
    for(const row of report.deckSummaries) {
        decks[row.deck] = {
            wins: row.wins,
            losses: row.losses,
            other: row.other,
            played: row.played,
            winRate: row.winRate,
            defaultPool: row.defaultPool,
            uplift: row.uplift,
            mirror: row.mirror
        };
    }
    return {
        suiteId: STANDARD_SUITE_ID,
        generatedAt: report.generatedAt,
        gamesPerMatchup: report.config.games,
        botSeed: report.config.seed,
        opponentSeed: report.config.seed,
        omniscientSide: true,
        seatsAlternate: true,
        totals: report.totals,
        decks
    };
}

module.exports = {
    DEFAULT_RESULTS_PATH,
    BENCHMARK_VERSION,
    SEED_LABELS,
    STANDARD_GAMES,
    STANDARD_WIN_RATE_GAMES,
    STANDARD_ROUND_ROBIN_GAMES,
    STANDARD_OMNISCIENT_GAMES,
    STANDARD_SUITE_ID,
    emptyBenchmark,
    mergeBenchmark,
    omniscientPayload,
    readBenchmark,
    roundRobinPayload,
    winRatesPayload,
    writeBenchmarkSection
};
