'use strict';

// Standardized self-play results consumed by jigoku-client. Win rates use 100
// games per deck; the much larger round robin uses 40 games per matchup.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STANDARD_WIN_RATE_GAMES = 100;
const STANDARD_ROUND_ROBIN_GAMES = 40;
const STANDARD_OMNISCIENT_GAMES = 20;
// Backward-compatible win-rate name used by winRates.js.
const STANDARD_GAMES = STANDARD_WIN_RATE_GAMES;
const BENCHMARK_VERSION = 6;
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

function stableValue(value) {
    if(Array.isArray(value)) return value.map(stableValue);
    if(value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
}

function benchmarkIdentity(engineVersion, strategySeed, informationMode, extra = {}) {
    const identity = { engineVersion, strategySeed, informationMode, ...extra };
    return {
        engineVersion,
        strategySeed,
        informationMode,
        configurationHash: crypto.createHash('sha256').update(JSON.stringify(stableValue(identity))).digest('hex').slice(0, 16)
    };
}

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
        engines: {
            v1: { engineVersion: 'v1', status: 'default', seeds: {} },
            v2: { engineVersion: 'v2', status: 'experimental', seeds: {} }
        },
        // Legacy alias retained for older clients. It always mirrors V1.
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
        const rawSeeds = parsed.engines?.v1?.seeds || parsed.seeds || {};
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
        const v2Seeds = parsed.engines?.v2?.seeds || {};
        return {
            ...emptyBenchmark(),
            ...parsed,
            version: BENCHMARK_VERSION,
            // Code defines the current standard. Do not preserve obsolete game
            // counts from an older generated config.
            standard: { ...(parsed.standard || {}), ...emptyBenchmark().standard },
            engines: {
                v1: { engineVersion: 'v1', status: 'default', ...(parsed.engines?.v1 || {}), seeds },
                v2: { engineVersion: 'v2', status: 'experimental', ...(parsed.engines?.v2 || {}), seeds: v2Seeds }
            },
            seeds
        };
    } catch(error) {
        throw new Error(`Cannot read bot benchmark config ${filePath}: ${error.message}`);
    }
}

function mergeBenchmark(current, seed, section, payload) {
    const generatedAt = payload.generatedAt || new Date().toISOString();
    const key = String(seed);
    const engineVersion = payload.engineVersion === 'v2' ? 'v2' : 'v1';
    const currentEngine = current.engines?.[engineVersion] || {
        engineVersion,
        status: engineVersion === 'v1' ? 'default' : 'experimental',
        seeds: engineVersion === 'v1' ? current.seeds || {} : {}
    };
    const nextSeeds = {
        ...(currentEngine.seeds || {}),
        [key]: {
            ...((currentEngine.seeds || {})[key] || {}),
            seed,
            label: SEED_LABELS[seed] || `seed ${seed}`,
            [section]: payload
        }
    };
    const nextEngines = {
        ...(current.engines || emptyBenchmark().engines),
        [engineVersion]: { ...currentEngine, seeds: nextSeeds }
    };
    return {
        ...emptyBenchmark(),
        ...current,
        version: BENCHMARK_VERSION,
        updatedAt: generatedAt,
        engines: nextEngines,
        seeds: engineVersion === 'v1' ? nextSeeds : (current.engines?.v1?.seeds || current.seeds || {})
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
        ...benchmarkIdentity(options.challengerEngine || 'v1', options.botSeed, options.challengerOmniscient ? 'omniscient' : 'fair', {
            opponentEngineVersion: options.craneEngine || 'v1',
            opponentSeed: options.craneSeed,
            opponentInformationMode: options.craneOmniscient ? 'omniscient' : 'fair',
            drawBidPolicy: options.challengerDrawBidPolicy || 'adaptive'
        }),
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
        ...benchmarkIdentity(report.config.engineVersion || 'v1', report.config.botSeed, report.config.omniscient ? 'omniscient' : 'fair', {
            drawBidPolicy: report.config.drawBidPolicy || 'adaptive'
        }),
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
        ...benchmarkIdentity('v1', report.config.seed, 'omniscient', { opponentInformationMode: 'fair' }),
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
    benchmarkIdentity,
    emptyBenchmark,
    mergeBenchmark,
    omniscientPayload,
    readBenchmark,
    roundRobinPayload,
    winRatesPayload,
    writeBenchmarkSection
};
