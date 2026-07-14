'use strict';

// One-stop win-rate board for every piloted bot deck vs the Crane precon.
// All decks run in parallel, each in its OWN child process (see _deckWorker.js),
// so a rare synchronous engine loop or out-of-memory game kills only that child; the
// parent keeps every game that already streamed and prints the board anyway,
// marking a deck whose child died before finishing. Usage:
//   node tools/selfplay/winRates.js [gamesPerDeck] [botSeed]
// gamesPerDeck default 30. botSeed 1 = heuristic (default), 4 = omniscient.
// A single deck swings ~13pts at N=40, so use higher N for steadier numbers.

const path = require('path');
const { spawn } = require('child_process');
const { DECK_LABELS } = require('./deckRegistry.js');

const BASELINE_DECK = 'Crane';
const DECKS = Object.freeze(DECK_LABELS.filter((label) => label !== BASELINE_DECK));
const WORKER = path.join(__dirname, '_deckWorker.js');

// Per-game wall budget; the deck child is killed if it exceeds games * this.
const PER_GAME_MS = 12000;

function runDeckChild(label, games, botSeed) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--max-old-space-size=1024', WORKER, label, String(games), String(botSeed)], {
            cwd: path.join(__dirname, '..', '..'),
            env: { ...process.env, LOG_LEVEL: 'error' }
        });

        const results = [];
        let buffer = '';
        let killedFor = null;

        const timer = setTimeout(() => {
            killedFor = 'timeout';
            child.kill('SIGKILL');
        }, games * PER_GAME_MS);

        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            let nl;
            while((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if(!line) {
                    continue;
                }
                try {
                    results.push(JSON.parse(line));
                    process.stderr.write('.');
                } catch{
                    /* ignore non-JSON noise */
                }
            }
        });
        // Swallow child stderr (logger noise); a crash is inferred from exit code.
        child.stderr.on('data', () => {});

        child.on('close', (code) => {
            clearTimeout(timer);
            process.stderr.write('\n');
            const died = killedFor || (code !== 0 ? `exit ${code}` : null);
            resolve({ label, results, died: results.length < games ? (died || 'incomplete') : null });
        });
    });
}

async function main() {
    const games = parseInt(process.argv[2], 10) || 30;
    const botSeed = process.argv[3] === '4' ? 4 : 1;

    process.stderr.write(`running ${DECKS.length} deck simulations in parallel (${games} games each)\n`);
    const deckRuns = await Promise.all(DECKS.map((label) => runDeckChild(label, games, botSeed)));
    const rows = [];
    for(const { label, results, died } of deckRuns) {
        let wins = 0;
        let losses = 0;
        let other = 0;
        const reasons = {};
        for(const r of results) {
            const key = `${r.winner || 'none'}:${r.reason || 'none'}`;
            reasons[key] = (reasons[key] || 0) + 1;
            if(r.winner === label) {
                wins++;
            } else if(r.winner === BASELINE_DECK) {
                losses++;
            } else {
                other++;
            }
        }
        rows.push({ label, wins, losses, other, played: results.length, reasons, died });
    }

    rows.sort((a, b) => (b.played ? b.wins / b.played : 0) - (a.played ? a.wins / a.played : 0));

    console.log(`\n=== Bot win rates vs Crane precon (seed ${botSeed}, N=${games}/deck, seats alternate) ===\n`);
    const deckWidth = Math.max('deck'.length, ...rows.map((row) => row.label.length));
    console.log(`${'deck'.padEnd(deckWidth)}  record     win%   played  top loss / note`);
    console.log(`${'-'.repeat(deckWidth)}  ---------  -----  ------  ------------------------`);
    for(const row of rows) {
        const pct = row.played ? ((row.wins / row.played) * 100).toFixed(0).padStart(3) : ' --';
        const record = `${row.wins}-${row.losses}${row.other ? ' (+' + row.other + ')' : ''}`;
        const craneReasons = Object.entries(row.reasons)
            .filter(([key]) => key.startsWith('Crane:'))
            .sort((a, b) => b[1] - a[1]);
        let note = craneReasons.length > 0 ? `${craneReasons[0][0]} x${craneReasons[0][1]}` : '-';
        if(row.died) {
            note = `child ${row.died} after ${row.played}/${games}`;
        }
        console.log(`${row.label.padEnd(deckWidth)}  ${record.padEnd(9)}  ${pct}%   ${String(row.played).padStart(3)}/${games}  ${note}`);
    }
    console.log('\n(all decks run in parallel in isolated processes; a deck marked "child ..." hit a hang/OOM and shows partial results.)');
}

if(require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { DECKS };
