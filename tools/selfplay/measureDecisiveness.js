'use strict';
// DECISIVENESS: how often does the change decide a game at all?
//
// A head-to-head result sitting on 50% has two very different explanations, and
// the win rate alone cannot tell them apart:
//
//   (a) the change decides plenty of games and wins about half — a real lever
//       pointed in no useful direction;
//   (b) the change almost never decides a game — it is not wrong, it is inert,
//       and no amount of tuning its VALUES will move a win rate.
//
// Run the same shuffle twice, once with both seats on the control profile and
// once with the change on seat 0, and compare the winner. That flip rate also
// caps what the lever could ever be worth: a change that flips 2% of games
// cannot move a win rate by more than 1pp even if every flip went its way.
//
// USAGE
//   CHANGE='{"deckProfile":{"someKnob":1}}' node tools/selfplay/measureDecisiveness.js
//   CHANGE=<json>  BASE=<n>  LABEL=<name>
//
// Run this BEFORE a long head-to-head, not after. It costs 180 games and tells
// you the largest win-rate change the lever could possibly produce. If that
// ceiling is under the +/-2.5pp noise floor, no head-to-head can resolve the
// lever and no amount of tuning its values will help — the insertion point is
// wrong, not the numbers.
//
// Pooling the flip counts across bases is also far more powerful than a bigger
// head-to-head, because only decided games carry information. Resolving a
// +1.1pp effect needs ~7800 head-to-head games, or ~30 decided games.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const CHANGE = JSON.parse(process.env.CHANGE || '{}');
const BASE = Number(process.env.BASE || 91001);
const LABEL = process.env.LABEL || 'change';

(async () => {
    let games = 0;
    let winnerFlipped = 0;
    let flippedToTreated = 0;
    let pathChanged = 0;
    let treatedWins = 0;
    let controlWins = 0;

    for(let i = 0; i < DECK_LABELS.length; i++) {
        for(let j = 0; j < DECK_LABELS.length; j++) {
            if(i === j) {
                continue;
            }
            const shuffle = BASE + (i * 100 + j) * 97;
            const setup = (profiles) => ({
                names: ['Seat0', 'Seat1'],
                seeds: [1, 1],
                deckA: getDeckLoader(DECK_LABELS[i])(),
                deckB: getDeckLoader(DECK_LABELS[j])(),
                engineVersions: ['v2', 'v2'],
                v2Modes: ['pass-through', 'pass-through'],
                v2Profiles: profiles
            });
            Math.random = rng(shuffle);
            const control = await runGame(setup([undefined, undefined]));
            Math.random = rng(shuffle);
            const treated = await runGame(setup([CHANGE, undefined]));
            games++;
            if(control.winner === 'Seat0') {
                controlWins++;
            }
            if(treated.winner === 'Seat0') {
                treatedWins++;
            }
            if(control.winner !== treated.winner) {
                winnerFlipped++;
                if(treated.winner === 'Seat0') {
                    flippedToTreated++;
                }
            } else if(control.rounds !== treated.rounds ||
                String(control.reason || '') !== String(treated.reason || '')) {
                pathChanged++;
            }
        }
        process.stderr.write(`${DECK_LABELS[i]} done (flips ${winnerFlipped}/${games})\n`);
    }

    const pct = (n) => `${(100 * n / games).toFixed(1)}%`;
    console.log(`LABEL=${LABEL} BASE=${BASE} CHANGE=${JSON.stringify(CHANGE)}`);
    console.log(`games=${games}`);
    console.log(`  winner flipped              ${winnerFlipped} (${pct(winnerFlipped)})  ` +
        `-> to changed seat ${flippedToTreated}, away ${winnerFlipped - flippedToTreated}`);
    console.log(`  same winner, different path ${pathChanged} (${pct(pathChanged)})`);
    console.log(`  game completely unchanged   ${games - winnerFlipped - pathChanged} ` +
        `(${pct(games - winnerFlipped - pathChanged)})`);
    console.log(`  seat0 wins: control ${controlWins}, treated ${treatedWins} ` +
        `(net ${treatedWins - controlWins})`);
    console.log(`  CEILING: flipping ${pct(winnerFlipped)} of games caps the win-rate effect at ` +
        `${(50 * winnerFlipped / games).toFixed(2)}pp.`);
})().catch((e) => { console.error(e); process.exit(1); });
