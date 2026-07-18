'use strict';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

// Paired deck-profile debugger. Each variant receives identical deck order,
// seat order, and Math.random stream; only target deck's resolved profile is
// changed. Useful for proving which injectable tactic caused a matchup shift.

const fs = require('fs');
const path = require('path');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

const DEFAULT_VARIANTS = ['current', 'no-pre-defense', 'legacy-province', 'legacy-both'];

function usage() {
    return `Usage: node tools/selfplay/compareProfileVariants.js [options]

Options:
  --deck <label>       Target deck (default Scorpion)
  --opponent <label>   Opponent deck, unchanged profile (default Lion)
  --seed <n>           Bot seed on both seats (default 5)
  --games <n>          Paired games per variant (default 40)
  --variants <csv>     current,no-pre-defense,legacy-province,legacy-both,
                       no-eminent,no-ability-priority,ratio-<number>,
                       or public-forum-<strength> (default all first four)
  --rng-seed <n>       Deterministic base RNG seed (default 20260718)
  --out <prefix>       Optional JSON and Markdown report prefix
  --help               Show help

Deck labels: ${DECK_LABELS.join(', ')}`;
}

function positiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if(!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

function parseArgs(argv) {
    const options = {
        deck: 'Scorpion',
        opponent: 'Lion',
        seed: 5,
        games: 40,
        variants: [...DEFAULT_VARIANTS],
        rngSeed: 20260718,
        out: null,
        help: false
    };
    const fields = new Map([
        ['--deck', 'deck'], ['--opponent', 'opponent'], ['--seed', 'seed'],
        ['--games', 'games'], ['--variants', 'variants'], ['--rng-seed', 'rngSeed'],
        ['--out', 'out']
    ]);
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        const field = fields.get(arg);
        if(!field || index + 1 >= argv.length) {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
        const raw = argv[++index];
        if(field === 'seed' || field === 'games' || field === 'rngSeed') {
            options[field] = positiveInteger(raw, arg);
        } else if(field === 'variants') {
            options.variants = String(raw).split(',').map((value) => value.trim()).filter(Boolean);
        } else {
            options[field] = raw;
        }
    }
    if(!getDeckLoader(options.deck) || !getDeckLoader(options.opponent)) {
        throw new Error(`Unknown deck. Valid: ${DECK_LABELS.join(', ')}`);
    }
    if(options.seed > 5) {
        throw new Error('--seed must be 1..5');
    }
    for(const variant of options.variants) {
        const parameterized = /^(?:ratio|public-forum)-\d+(?:\.\d+)?$/.test(variant);
        if(!DEFAULT_VARIANTS.includes(variant) &&
            !['no-eminent', 'no-ability-priority'].includes(variant) && !parameterized) {
            throw new Error(`Unknown variant '${variant}'`);
        }
    }
    return options;
}

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}

function applyVariant(controller, variant) {
    if(variant === 'current') {
        return;
    }
    // TypeScript private methods compile to ordinary properties. Analysis tool
    // resolves profile before first tick, then changes only documented knobs.
    const profile = controller.currentDeckProfile(controller.player);
    if(!profile) {
        throw new Error('Target deck profile unavailable');
    }
    if(variant === 'no-pre-defense' || variant === 'legacy-both') {
        profile.strongholdDefense.preStrongholdDefenseEnabled = false;
    }
    if(variant === 'legacy-province' || variant === 'legacy-both') {
        profile.provinceTargeting.preferEminent = false;
        profile.provinceTargeting.effectiveStrengthById = {};
        profile.provinceTargeting.priorityTierById = {};
        for(const key of Object.keys(profile.provinceTargeting.abilityPriority)) {
            profile.provinceTargeting.abilityPriority[key] = 0;
        }
    }
    if(variant === 'no-eminent') {
        profile.provinceTargeting.preferEminent = false;
    }
    if(variant === 'no-ability-priority') {
        for(const key of Object.keys(profile.provinceTargeting.abilityPriority)) {
            profile.provinceTargeting.abilityPriority[key] = 0;
        }
    }
    if(variant.startsWith('ratio-')) {
        profile.strongholdDefense.preStrongholdThreatRatio = Number(variant.slice('ratio-'.length));
    }
    if(variant.startsWith('public-forum-')) {
        profile.provinceTargeting.effectiveStrengthById['public-forum'] =
            Number(variant.slice('public-forum-'.length));
    }
}

function markdown(report) {
    const lines = [
        '# Paired deck-profile comparison', '',
        `Target: ${report.config.deck} seed ${report.config.seed} vs ${report.config.opponent} seed ${report.config.seed}`,
        `Games: ${report.config.games}/variant; RNG seed: ${report.config.rngSeed}`, '',
        '| Variant | Record | Win rate | Delta vs current |',
        '|---|---:|---:|---:|'
    ];
    const current = report.variants.find((row) => row.variant === 'current')?.winRate;
    for(const row of report.variants) {
        const delta = Number.isFinite(current) ? row.winRate - current : 0;
        lines.push(`| ${row.variant} | ${row.wins}-${row.losses} (+${row.other}) | ${(row.winRate * 100).toFixed(1)}% | ${(delta * 100).toFixed(1)} pp |`);
    }
    return `${lines.join('\n')}\n`;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        console.log(usage());
        return;
    }
    const loadTarget = getDeckLoader(options.deck);
    const loadOpponent = getDeckLoader(options.opponent);
    const rows = new Map(options.variants.map((variant) => [variant, { variant, wins: 0, losses: 0, other: 0 }]));
    const originalRandom = Math.random;
    try {
        for(let gameIndex = 0; gameIndex < options.games; gameIndex++) {
            const targetFirst = gameIndex % 2 === 0;
            for(const variant of options.variants) {
                Math.random = seededRandom(options.rngSeed + gameIndex);
                const targetName = `Target-${options.deck}`;
                const opponentName = `Opponent-${options.opponent}`;
                const names = targetFirst ? [targetName, opponentName] : [opponentName, targetName];
                const decks = targetFirst
                    ? { deckA: loadTarget(), deckB: loadOpponent() }
                    : { deckA: loadOpponent(), deckB: loadTarget() };
                const result = await runGame({
                    names,
                    seeds: [options.seed, options.seed],
                    ...decks,
                    trace: false,
                    onControllers: (controllers) => {
                        const controller = controllers.find((item) => item.player?.name === targetName);
                        applyVariant(controller, variant);
                    }
                });
                const row = rows.get(variant);
                if(result.winner === targetName) {
                    row.wins++;
                } else if(result.winner === opponentName) {
                    row.losses++;
                } else {
                    row.other++;
                }
            }
            process.stderr.write(`\rpaired games ${gameIndex + 1}/${options.games}`);
        }
    } finally {
        Math.random = originalRandom;
        process.stderr.write('\n');
    }
    const report = {
        generatedAt: new Date().toISOString(),
        config: options,
        variants: [...rows.values()].map((row) => ({
            ...row,
            winRate: row.wins / Math.max(1, row.wins + row.losses)
        }))
    };
    console.log(markdown(report));
    if(options.out) {
        const prefix = path.resolve(options.out);
        fs.mkdirSync(path.dirname(prefix), { recursive: true });
        fs.writeFileSync(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(`${prefix}.md`, markdown(report));
        console.log(`Reports: ${prefix}.md`);
    }
}

if(require.main === module) {
    main().catch((error) => {
        console.error(error && error.stack || error);
        process.exit(1);
    });
}

module.exports = { applyVariant, parseArgs, seededRandom };
