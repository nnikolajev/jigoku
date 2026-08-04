'use strict';
// DIRECT HEAD-TO-HEAD: bots WITH the change play bots WITHOUT it.
//
// The paired-arms rig (`rr2.js`) measures a change against an unchanged FIELD
// on identical shuffles. This one puts the two populations across the table
// from each other, which is the question "is the changed bot a harder
// opponent?" asked literally.
//
// Both seats run the same engine path — V2 pass-through, i.e. V1 logic — so the
// ONLY difference between them is the injected DeckProfile knob. Anything the
// pass-through seat does differently from a pure V1 seat is applied to BOTH
// sides and cancels.
//
// Confounds removed by construction, not by trusting one seed:
//   * DECK STRENGTH — every (A,B) pairing is played twice on the SAME shuffle,
//     once with the change on A and once with it on B. Over the full ordered
//     sweep each side pilots every deck exactly as often.
//   * SEAT / FIRST PLAYER — the change sits in seat 0 for one of that pair and
//     seat 1 for the other.
//   * SHUFFLE LUCK — every pairing is replayed across several independent
//     bases, and the per-base spread is reported next to the total so a
//     single-base result can never masquerade as the answer.
//
// USAGE
//   CHANGE='{"deckProfile":{"someKnob":1}}' node tools/selfplay/headToHeadRoundRobin.js
//   CHANGE=<json>  BASES=91001,92001,93001  GPB=<games per pair per base>  LABEL=<name>
//
// ALWAYS run the null arm first. Inject the knob at its own DEFAULT value —
// same injection path, no behavior change — and confirm the result is exactly
// 50.00%, with every deck row at exactly n/2:
//
//   LABEL=null CHANGE='{"deckProfile":{"someKnob":0}}' node tools/selfplay/headToHeadRoundRobin.js
//
// Anything other than 50.00% means the rig is broken, not the lever.
//
// Read the TOTAL, never the per-deck rows. A validated null arm still produces
// per-deck swings of +/-28pp at exactly 0.00pp overall, because a deck row here
// measures that deck's strength against the field, not the change.
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const CHANGE = JSON.parse(process.env.CHANGE || '{}');
const BASES = String(process.env.BASES || '91001,92001,93001').split(',').map(Number);
const GPB = Number(process.env.GPB || 1);
const LABEL = process.env.LABEL || 'change';

const byBase = new Map();
const byDeck = new Map();
let changedWins = 0;
let controlWins = 0;
let draws = 0;

const bumpDeck = (deck, won) => {
    const row = byDeck.get(deck) || { w: 0, n: 0 };
    row.w += won ? 1 : 0;
    row.n += 1;
    byDeck.set(deck, row);
};

(async () => {
    for(const base of BASES) {
        let baseChanged = 0;
        let baseControl = 0;
        for(let i = 0; i < DECK_LABELS.length; i++) {
            for(let j = 0; j < DECK_LABELS.length; j++) {
                if(i === j) {
                    continue;
                }
                const A = DECK_LABELS[i];
                const B = DECK_LABELS[j];
                for(let g = 0; g < GPB; g++) {
                    const shuffle = base + (i * 100 + j) * 97 + g;
                    // Orientation 1: the change pilots A in seat 0.
                    // Orientation 2: SAME shuffle, the change pilots B in seat 1.
                    for(const changedSeat of [0, 1]) {
                        Math.random = rng(shuffle);
                        const result = await runGame({
                            names: ['Seat0', 'Seat1'],
                            seeds: [1, 1],
                            deckA: getDeckLoader(A)(),
                            deckB: getDeckLoader(B)(),
                            engineVersions: ['v2', 'v2'],
                            v2Modes: ['pass-through', 'pass-through'],
                            v2Profiles: [
                                changedSeat === 0 ? CHANGE : undefined,
                                changedSeat === 1 ? CHANGE : undefined
                            ]
                        });
                        const winnerSeat = result?.winner === 'Seat0' ? 0
                            : result?.winner === 'Seat1' ? 1 : -1;
                        if(winnerSeat === -1) {
                            draws++;
                            continue;
                        }
                        const changedWon = winnerSeat === changedSeat;
                        if(changedWon) {
                            changedWins++;
                            baseChanged++;
                        } else {
                            controlWins++;
                            baseControl++;
                        }
                        bumpDeck(changedSeat === 0 ? A : B, changedWon);
                    }
                }
            }
            process.stderr.write(`base ${base} ${DECK_LABELS[i]} done ` +
                `(changed ${baseChanged}-${baseControl})\n`);
        }
        byBase.set(base, { w: baseChanged, l: baseControl });
    }

    const n = changedWins + controlWins;
    const pct = n > 0 ? 100 * changedWins / n : 0;
    console.log(`LABEL=${LABEL} CHANGE=${JSON.stringify(CHANGE)}`);
    console.log(`bases=${BASES.join(',')} gamesPerPairPerBase=${GPB * 2} draws=${draws}`);
    console.log(`CHANGED ${changedWins}-${controlWins} of ${n}  ${pct.toFixed(2)}%  ` +
        `(${(pct - 50).toFixed(2)}pp vs the 50% a no-op must score)`);
    console.log('');
    console.log('per base');
    for(const [base, row] of byBase) {
        const bn = row.w + row.l;
        console.log(`  ${base}  ${row.w}-${row.l}  ${(100 * row.w / bn).toFixed(2)}%  ` +
            `${(100 * row.w / bn - 50).toFixed(2)}pp`);
    }
    console.log('');
    console.log('per deck piloted by the CHANGED side');
    for(const deck of DECK_LABELS) {
        const row = byDeck.get(deck);
        if(!row) {
            continue;
        }
        console.log(`  ${deck.padEnd(20)} ${String(row.w).padStart(3)}/${String(row.n).padStart(3)}  ` +
            `${(100 * row.w / row.n).toFixed(1)}%  ${(100 * row.w / row.n - 50).toFixed(1)}pp`);
    }
})().catch((e) => { console.error(e); process.exit(1); });
