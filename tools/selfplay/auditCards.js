'use strict';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

// Live card-usage gate. It records source-card plays/activations, not merely
// clicks, and tracks whether each card was available in hand/provinces/play.
// This prevents mulligans, attacker declarations, and effect targets from
// producing false "used" evidence.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DECK_LABELS, DECK_LOADERS } = require('./deckRegistry.js');
const { deckEntries, expectedAbility, expectedPlay } = require('./cardUsageAudit.js');

const WORKER = path.join(__dirname, '_cardUsageWorker.js');
const DEFAULT_RNG_SEED = 20260721;
const PER_GAME_MS = 15000;
const SEMANTIC_STAGES = ['visible', 'selectable', 'eligible', 'candidate', 'chosen', 'resolved', 'payoffRealized'];
const ALIASES = Object.freeze({
    crane: 'Crane', 'crane-baseline': 'Crane', craneduel: 'CraneDuels', 'crane-duels': 'CraneDuels',
    crab: 'Crab', dragon: 'Dragon', 'dragon-attachments': 'DragonAttachments', dragonattachments: 'DragonAttachments',
    lion: 'Lion', phoenix: 'Phoenix', 'phoenix-shugenja': 'PhoenixShugenja', phoenixshugenja: 'PhoenixShugenja',
    scorpion: 'Scorpion', unicorn: 'Unicorn'
});

function usage() {
    return `Usage:
  node tools/selfplay/auditCards.js <deck> [games=20] [seed=1] [opponent=Crane]
  node tools/selfplay/auditCards.js [options]

Options:
  --decks <csv|all>       Subject decks (default all)
  --seeds <csv>           Strategy seeds (default 1,2,3)
  --opponents <csv|all>   Opponent decks (default all)
  --modes <csv>           fair,omniscient (default both)
  --games <n>             Games per subject/opponent/seed/mode (default 2)
  --workers <n>           Parallel workers (default 24)
  --rng-seed <n>          Deterministic base shuffle seed (default ${DEFAULT_RNG_SEED})
  --minimum-seen <n>      Availability games before flagging a candidate (default 1)
  --engine-version <v1|v2> Subject engine (default v1)
  --v2-mode <mode>        pass-through, shadow, or enabled (default shadow)
  --out <prefix>          JSON/Markdown report prefix
  --fail-on-candidates    Exit nonzero for a reachable zero-use card
  --help                  Show help

Legacy positional mode remains a single fair configuration.`;
}

function positiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if(!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

function deckLabel(value) {
    return DECK_LABELS.find((label) => label.toLowerCase() === String(value).toLowerCase()) ||
        ALIASES[String(value).toLowerCase()];
}

function parseDecks(value, flag) {
    if(String(value).toLowerCase() === 'all') {
        return [...DECK_LABELS];
    }
    const raw = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    const decks = raw.map(deckLabel);
    if(decks.length === 0 || decks.some((deck) => !deck)) {
        throw new Error(`${flag} contains unknown deck(s). Valid: ${DECK_LABELS.join(', ')}`);
    }
    return [...new Set(decks)];
}

function parseArgs(argv) {
    if(argv[0] && !argv[0].startsWith('--')) {
        const subject = deckLabel(argv[0]);
        const games = positiveInteger(argv[1] || 20, 'games');
        const seed = positiveInteger(argv[2] || 1, 'seed');
        const opponent = deckLabel(argv[3]) || (subject === 'Crane' ? 'PhoenixShugenja' : 'Crane');
        if(!subject || !opponent || seed > 3) {
            throw new Error(usage());
        }
        return {
            decks: [subject], opponents: [opponent], seeds: [seed], modes: ['fair'], games,
            workers: 1, rngSeed: DEFAULT_RNG_SEED, minimumSeen: 1, out: null,
            engineVersion: 'v1', v2Mode: undefined,
            failOnCandidates: false, help: false, legacy: true
        };
    }
    const options = {
        decks: [...DECK_LABELS], opponents: [...DECK_LABELS], seeds: [1, 2, 3],
        modes: ['fair', 'omniscient'], games: 2, workers: 24,
        rngSeed: DEFAULT_RNG_SEED, minimumSeen: 1,
        engineVersion: 'v1', v2Mode: undefined,
        out: path.join(__dirname, 'out', 'card-usage-all-seeds'),
        failOnCandidates: false, help: false, legacy: false
    };
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
        } else if(arg === '--fail-on-candidates') {
            options.failOnCandidates = true;
        } else if(arg === '--decks') {
            options.decks = parseDecks(argv[++index], arg);
        } else if(arg === '--opponents') {
            options.opponents = parseDecks(argv[++index], arg);
        } else if(arg === '--seeds') {
            options.seeds = String(argv[++index] || '').split(',').map((seed) => positiveInteger(seed, arg));
        } else if(arg === '--modes') {
            options.modes = String(argv[++index] || '').split(',').map((mode) => mode.trim()).filter(Boolean);
        } else if(arg === '--games') {
            options.games = positiveInteger(argv[++index], arg);
        } else if(arg === '--workers') {
            options.workers = Math.min(32, positiveInteger(argv[++index], arg));
        } else if(arg === '--rng-seed') {
            options.rngSeed = positiveInteger(argv[++index], arg);
        } else if(arg === '--minimum-seen') {
            options.minimumSeen = positiveInteger(argv[++index], arg);
        } else if(arg === '--engine-version') {
            options.engineVersion = String(argv[++index] || '').toLowerCase();
        } else if(arg === '--v2-mode') {
            options.v2Mode = String(argv[++index] || '').toLowerCase();
        } else if(arg === '--out') {
            options.out = path.resolve(argv[++index]);
        } else {
            throw new Error(`unknown or incomplete option: ${arg}`);
        }
    }
    if(options.seeds.length === 0 || options.seeds.some((seed) => seed > 3)) {
        throw new Error('--seeds must be a comma-separated subset of 1,2,3');
    }
    if(options.modes.length === 0 || options.modes.some((mode) => !['fair', 'omniscient'].includes(mode))) {
        throw new Error('--modes must contain fair and/or omniscient');
    }
    if(!['v1', 'v2'].includes(options.engineVersion)) {
        throw new Error('--engine-version must be v1 or v2');
    }
    if(options.v2Mode && !['pass-through', 'shadow', 'enabled'].includes(options.v2Mode)) {
        throw new Error('--v2-mode must be pass-through, shadow, or enabled');
    }
    if(options.engineVersion === 'v2' && !options.v2Mode) options.v2Mode = 'shadow';
    return options;
}

function buildJobs(options) {
    const jobs = [];
    for(const [deckIndex, deck] of options.decks.entries()) {
        for(const [seedIndex, seed] of options.seeds.entries()) {
            for(const mode of options.modes) {
                for(const [opponentIndex, opponent] of options.opponents.entries()) {
                    jobs.push({
                        deck, opponent, seed, mode, games: options.games,
                        engineVersion: options.engineVersion, v2Mode: options.v2Mode,
                        rngSeed: options.rngSeed + deckIndex * 1000000 + seedIndex * 100000 + opponentIndex * 1000
                    });
                }
            }
        }
    }
    return jobs;
}

function runJob(job) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [
            '--max-old-space-size=1024', WORKER, job.deck, job.opponent, String(job.games),
            String(job.seed), job.mode, '0', String(job.rngSeed),
            job.engineVersion, job.v2Mode || ''
        ], {
            cwd: path.join(__dirname, '..', '..'),
            env: { ...process.env, LOG_LEVEL: 'error' }
        });
        let stdout = '';
        let stderr = '';
        let killedFor = null;
        const timer = setTimeout(() => {
            killedFor = 'timeout';
            child.kill('SIGKILL');
        }, job.games * PER_GAME_MS + 10000);
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
        child.on('close', (code) => {
            clearTimeout(timer);
            let result;
            for(const line of stdout.trim().split(/\r?\n/).reverse()) {
                try {
                    result = JSON.parse(line);
                    break;
                } catch{
                    // Ignore logger noise.
                }
            }
            resolve({
                ...job,
                result,
                died: !result ? (killedFor || `exit ${code}`) : null,
                error: !result ? stderr.trim() || null : null
            });
        });
    });
}

async function runPool(jobs, workers, onComplete) {
    let next = 0;
    async function consume() {
        while(next < jobs.length) {
            const index = next++;
            const result = await runJob(jobs[index]);
            onComplete(result, index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, consume));
}

function addCounts(target, source) {
    for(const [key, value] of Object.entries(source || {})) {
        target[key] = (target[key] || 0) + value;
    }
}

function addReasons(target, source) {
    for(const [cardId, reasons] of Object.entries(source || {})) {
        const row = target[cardId] || (target[cardId] = {});
        addCounts(row, reasons);
    }
}

function analyzeRow(row, minimumSeen) {
    row.cards = row.cardList.map((card) => {
        const available = {
            hand: row.availableGames.hand[card.id] || 0,
            province: row.availableGames.province[card.id] || 0,
            play: row.availableGames.play[card.id] || 0,
            selectable: row.availableGames.selectable[card.id] || 0,
            sourceSelectable: row.availableGames.sourceSelectable[card.id] || 0
        };
        const playExpected = expectedPlay(card);
        // Conflict events express their ability by being played, and gained
        // attachment actions are clicked through their bearer. Keep the
        // separate ability gate for persistent dynasty/province sources; the
        // play gate already covers every conflict card.
        const abilityExpected = expectedAbility(card) && card.side !== 'conflict' && card.type !== 'event';
        const playUses = row.plays[card.id] || 0;
        const abilityUses = row.abilities[card.id] || 0;
        const playAvailability = available.hand + available.province + available.selectable;
        const abilityAvailability = available.play + available.selectable;
        return {
            id: card.id, name: card.name, type: card.type, side: card.side,
            playExpected, abilityExpected, available, playUses, abilityUses,
            clicks: row.clicks[card.id] || 0, reasons: row.reasons[card.id] || {},
            semanticStages: Object.fromEntries(SEMANTIC_STAGES.map((stage) => [stage, row.semanticStages[stage][card.id] || 0])),
            playStatus: !playExpected ? 'not-required' : playUses > 0 ? 'covered' :
                playAvailability >= minimumSeen ? 'candidate' : 'unseen',
            abilityStatus: !abilityExpected ? 'not-required' : abilityUses > 0 ? 'covered' :
                abilityAvailability >= minimumSeen ? 'unreached' : 'unseen'
        };
    });
    row.playExpected = row.cards.filter((card) => card.playExpected).length;
    row.playCovered = row.cards.filter((card) => card.playStatus === 'covered').length;
    row.playCandidates = row.cards.filter((card) => card.playStatus === 'candidate').map((card) => card.id);
    row.playUnseen = row.cards.filter((card) => card.playStatus === 'unseen').map((card) => card.id);
    row.abilityExpected = row.cards.filter((card) => card.abilityExpected).length;
    row.abilityCovered = row.cards.filter((card) => card.abilityStatus === 'covered').length;
    row.abilityUnreached = row.cards.filter((card) => card.abilityStatus === 'unreached').map((card) => card.id);
    row.semanticCandidateGaps = row.engineVersion === 'v2'
        ? row.cards.filter((card) => card.semanticStages.eligible > 0 && card.semanticStages.candidate === 0).map((card) => card.id)
        : [];
    row.semanticPayoffGaps = row.engineVersion === 'v2'
        ? row.cards.filter((card) => card.semanticStages.chosen > 0 && card.semanticStages.resolved > 0 && card.semanticStages.payoffRealized === 0).map((card) => card.id)
        : [];
    delete row.cardList;
    return row;
}

function summarize(options, jobResults) {
    const rows = new Map();
    for(const deck of options.decks) {
        const cardList = deckEntries(DECK_LOADERS[deck]()).map((entry) => entry.card);
        for(const seed of options.seeds) {
            for(const mode of options.modes) {
                rows.set(`${seed}|${mode}|${deck}`, {
                    seed, mode, deck, engineVersion: options.engineVersion, v2Mode: options.v2Mode,
                    games: 0, wins: 0, losses: 0, other: 0,
                    failedJobs: [], clicks: {}, plays: {}, abilities: {}, reasons: {},
                    semanticStages: Object.fromEntries(SEMANTIC_STAGES.map((stage) => [stage, {}])),
                    availableGames: { hand: {}, province: {}, play: {}, selectable: {}, sourceSelectable: {} },
                    cardList
                });
            }
        }
    }
    for(const job of jobResults) {
        const row = rows.get(`${job.seed}|${job.mode}|${job.deck}`);
        if(!job.result) {
            row.failedJobs.push({ opponent: job.opponent, cause: job.died, error: job.error });
            continue;
        }
        for(const key of ['games', 'wins', 'losses', 'other']) {
            row[key] += job.result[key] || 0;
        }
        row.failedJobs.push(...(job.result.failed || []).map((failure) => ({ opponent: job.opponent, ...failure })));
        for(const key of ['clicks', 'plays', 'abilities']) {
            addCounts(row[key], job.result[key]);
        }
        addReasons(row.reasons, job.result.reasons);
        for(const stage of SEMANTIC_STAGES) {
            addCounts(row.semanticStages[stage], job.result.semanticStages?.[stage]);
        }
        for(const zone of Object.keys(row.availableGames)) {
            addCounts(row.availableGames[zone], job.result.availableGames?.[zone]);
        }
    }
    return [...rows.values()].map((row) => analyzeRow(row, options.minimumSeen));
}

// A card absent in one seed/mode row can still be demonstrably reachable in
// another. Aggregate by deck so the durable finding is "dead everywhere",
// while retaining row-level sampling detail for tuning.
function summarizeDeckCoverage(rows, minimumSeen) {
    const decks = new Map();
    for(const row of rows) {
        let deck = decks.get(row.deck);
        if(!deck) {
            deck = { deck: row.deck, games: 0, failedJobs: 0, cards: new Map() };
            decks.set(row.deck, deck);
        }
        deck.games += row.games;
        deck.failedJobs += row.failedJobs.length;
        for(const card of row.cards) {
            let total = deck.cards.get(card.id);
            if(!total) {
                total = {
                    id: card.id, name: card.name, type: card.type, side: card.side,
                    playExpected: card.playExpected, abilityExpected: card.abilityExpected,
                    available: { hand: 0, province: 0, play: 0, selectable: 0, sourceSelectable: 0 },
                    playUses: 0, abilityUses: 0, clicks: 0,
                    semanticStages: Object.fromEntries(SEMANTIC_STAGES.map((stage) => [stage, 0]))
                };
                deck.cards.set(card.id, total);
            }
            for(const zone of Object.keys(total.available)) {
                total.available[zone] += card.available[zone] || 0;
            }
            total.playUses += card.playUses;
            total.abilityUses += card.abilityUses;
            total.clicks += card.clicks;
            for(const stage of SEMANTIC_STAGES) total.semanticStages[stage] += card.semanticStages?.[stage] || 0;
        }
    }
    return [...decks.values()].map((deck) => {
        const cards = [...deck.cards.values()].map((card) => {
            const playAvailability = card.available.hand + card.available.province + card.available.selectable;
            const abilityAvailability = card.available.play + card.available.selectable;
            return {
                ...card,
                playStatus: !card.playExpected ? 'not-required' : card.playUses > 0 ? 'covered' :
                    playAvailability >= minimumSeen ? 'candidate' : 'unseen',
                abilityStatus: !card.abilityExpected ? 'not-required' : card.abilityUses > 0 ? 'covered' :
                    abilityAvailability >= minimumSeen ? 'unreached' : 'unseen'
            };
        });
        return {
            deck: deck.deck, games: deck.games, failedJobs: deck.failedJobs, cards,
            playExpected: cards.filter((card) => card.playExpected).length,
            playCovered: cards.filter((card) => card.playStatus === 'covered').length,
            playCandidates: cards.filter((card) => card.playStatus === 'candidate').map((card) => card.id),
            playUnseen: cards.filter((card) => card.playStatus === 'unseen').map((card) => card.id),
            abilityExpected: cards.filter((card) => card.abilityExpected).length,
            abilityCovered: cards.filter((card) => card.abilityStatus === 'covered').length,
            abilityUnreached: cards.filter((card) => card.abilityStatus === 'unreached').map((card) => card.id),
            semanticCandidateGaps: rows[0]?.engineVersion === 'v2'
                ? cards.filter((card) => card.semanticStages.eligible > 0 && card.semanticStages.candidate === 0).map((card) => card.id)
                : [],
            semanticPayoffGaps: rows[0]?.engineVersion === 'v2'
                ? cards.filter((card) => card.semanticStages.chosen > 0 && card.semanticStages.resolved > 0 && card.semanticStages.payoffRealized === 0).map((card) => card.id)
                : []
        };
    });
}

function renderMarkdown(report) {
    const lines = [
        '# Bot live card-usage audit', '',
        `Engine: ${report.config.engineVersion}${report.config.v2Mode ? ` (${report.config.v2Mode})` : ''}. Games per subject/opponent/seed/mode: ${report.config.games}; opponents: ${report.config.opponents.join(', ')}; minimum seen: ${report.config.minimumSeen}.`,
        'A play is a successful source-card activation. Mulligan selections, effect targets, attackers, and defenders do not count.', '',
        '## Deck-wide reachability across all selected seeds/modes', '',
        '| Deck | Plays covered | Zero-use | Never seen | Abilities | Unreached | Semantic candidate gaps | Payoff gaps | Games | Failures |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
    ];
    for(const deck of report.deckCoverage || []) {
        lines.push(`| ${deck.deck} | ${deck.playCovered}/${deck.playExpected} | ${deck.playCandidates.length} | ` +
            `${deck.playUnseen.length} | ${deck.abilityCovered}/${deck.abilityExpected} | ` +
            `${deck.abilityUnreached.length} | ${deck.semanticCandidateGaps.length} | ${deck.semanticPayoffGaps.length} | ${deck.games} | ${deck.failedJobs} |`);
    }
    for(const deck of report.deckCoverage || []) {
        if(deck.playCandidates.length > 0 || deck.playUnseen.length > 0 || deck.abilityUnreached.length > 0 ||
            deck.semanticCandidateGaps.length > 0 || deck.semanticPayoffGaps.length > 0) {
            lines.push('', `### ${deck.deck}`, '');
            if(deck.playCandidates.length > 0) {
                lines.push(`- Globally reachable zero-use play candidates: ${deck.playCandidates.join(', ')}`);
            }
            if(deck.playUnseen.length > 0) {
                lines.push(`- Never available anywhere in the selected matrix: ${deck.playUnseen.join(', ')}`);
            }
            if(deck.abilityUnreached.length > 0) {
                lines.push(`- Entered play but no live trigger/action activation observed: ${deck.abilityUnreached.join(', ')}`);
            }
            if(deck.semanticCandidateGaps.length > 0) lines.push(`- Source-eligible without semantic candidate: ${deck.semanticCandidateGaps.join(', ')}`);
            if(deck.semanticPayoffGaps.length > 0) lines.push(`- Resolved without observed semantic payoff: ${deck.semanticPayoffGaps.join(', ')}`);
        }
    }
    lines.push('', '## Per-seed and information-mode detail', '',
        '| Seed | Mode | Deck | Plays covered | Reachable zero-use | Not seen | Abilities exercised | Unreached abilities | Games |',
        '|---:|---|---|---:|---:|---:|---:|---:|---:|'
    );
    for(const row of report.rows) {
        lines.push(`| ${row.seed} | ${row.mode} | ${row.deck} | ${row.playCovered}/${row.playExpected} | ` +
            `${row.playCandidates.length} | ${row.playUnseen.length} | ${row.abilityCovered}/${row.abilityExpected} | ` +
            `${row.abilityUnreached.length} | ${row.games} |`);
    }
    for(const row of report.rows) {
        if(row.playCandidates.length > 0 || row.playUnseen.length > 0 || row.abilityUnreached.length > 0 ||
            row.semanticCandidateGaps.length > 0 || row.semanticPayoffGaps.length > 0 || row.failedJobs.length > 0) {
            lines.push('', `## Seed ${row.seed} ${row.mode} ${row.deck}`, '');
            if(row.playCandidates.length > 0) {
                lines.push(`- Reachable zero-use play candidates: ${row.playCandidates.join(', ')}`);
            }
            if(row.playUnseen.length > 0) {
                lines.push(`- Never available in this sample: ${row.playUnseen.join(', ')}`);
            }
            if(row.abilityUnreached.length > 0) {
                lines.push(`- In-play/selectable but no source activation: ${row.abilityUnreached.join(', ')}`);
            }
            if(row.failedJobs.length > 0) {
                lines.push(`- Failed/stalled games: ${row.failedJobs.length}`);
            }
            if(row.semanticCandidateGaps.length > 0) lines.push(`- Source-eligible without semantic candidate: ${row.semanticCandidateGaps.join(', ')}`);
            if(row.semanticPayoffGaps.length > 0) lines.push(`- Resolved without observed semantic payoff: ${row.semanticPayoffGaps.join(', ')}`);
        }
    }
    const candidates = report.rows.reduce((sum, row) => sum + row.playCandidates.length, 0);
    const failures = report.rows.reduce((sum, row) => sum + row.failedJobs.length, 0);
    lines.push('', `Total reachable zero-use findings: ${candidates}. Failed/stalled games: ${failures}.`, '');
    return lines.join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        console.log(usage());
        return;
    }
    const jobs = buildJobs(options);
    const results = new Array(jobs.length);
    let complete = 0;
    let games = 0;
    const totalGames = jobs.reduce((sum, job) => sum + job.games, 0);
    process.stderr.write(`card usage audit: ${totalGames} games, ${options.workers} workers\n`);
    await runPool(jobs, options.workers, (result, index) => {
        results[index] = result;
        complete++;
        games += result.result?.games || 0;
        process.stderr.write(`\rjobs ${complete}/${jobs.length}; games ${games}/${totalGames}`);
    });
    process.stderr.write('\n');
    const rows = summarize(options, results);
    const report = {
        generatedAt: new Date().toISOString(),
        config: {
            decks: options.decks, opponents: options.opponents, seeds: options.seeds,
            modes: options.modes, games: options.games, workers: options.workers,
            rngSeed: options.rngSeed, minimumSeen: options.minimumSeen,
            engineVersion: options.engineVersion, v2Mode: options.v2Mode
        },
        rows,
        deckCoverage: summarizeDeckCoverage(rows, options.minimumSeen)
    };
    const markdown = renderMarkdown(report);
    console.log(markdown);
    if(options.out) {
        const prefix = path.resolve(options.out);
        fs.mkdirSync(path.dirname(prefix), { recursive: true });
        fs.writeFileSync(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(`${prefix}.md`, markdown);
        console.log(`Reports: ${prefix}.md\n         ${prefix}.json`);
    }
    if(options.failOnCandidates && report.rows.some((row) => row.playCandidates.length > 0 || row.failedJobs.length > 0)) {
        process.exitCode = 1;
    }
}

if(require.main === module) {
    main().catch((error) => {
        console.error(error?.stack || error);
        process.exit(1);
    });
}

module.exports = { analyzeRow, buildJobs, parseArgs, renderMarkdown, summarize, summarizeDeckCoverage };
