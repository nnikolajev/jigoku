'use strict';

// Standardized self-play results consumed by jigoku-client. Only complete,
// comparable 100-game runs should call writeBenchmarkSection.

const fs = require('fs');
const path = require('path');

const STANDARD_GAMES = 100;
const BENCHMARK_VERSION = 2;
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
    3: 'LLM seed (heuristic fallback in self-play)',
    4: 'learned evaluator',
    5: 'omniscient'
});

function emptyBenchmark() {
    return {
        version: BENCHMARK_VERSION,
        standard: {
            suiteId: STANDARD_SUITE_ID,
            gamesPerDeck: STANDARD_GAMES,
            gamesPerMatchup: STANDARD_GAMES,
            sameSeedOpponents: true,
            seatsAlternate: true
        },
        updatedAt: null,
        seeds: {}
    };
}

function readBenchmark(filePath = process.env.JIGOKU_BOT_BENCHMARK_PATH || DEFAULT_RESULTS_PATH) {
    if(!fs.existsSync(filePath)) {
        return emptyBenchmark();
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            ...emptyBenchmark(),
            ...parsed,
            version: BENCHMARK_VERSION,
            standard: { ...emptyBenchmark().standard, ...(parsed.standard || {}) },
            seeds: parsed.seeds || {}
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
        seatsAlternate: true,
        decks
    };
}

module.exports = {
    DEFAULT_RESULTS_PATH,
    BENCHMARK_VERSION,
    SEED_LABELS,
    STANDARD_GAMES,
    STANDARD_SUITE_ID,
    emptyBenchmark,
    mergeBenchmark,
    readBenchmark,
    roundRobinPayload,
    winRatesPayload,
    writeBenchmarkSection
};
