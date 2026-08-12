'use strict';
// Export a bot-vs-bot game as a client-format replay (.json.gz), so a human can
// open it in the web client's replay viewer and step the board.
//
// The file is byte-compatible with what the "download game log" button
// produces: version 3, `metadata`, `plainText`, `messages`, `replayData` and
// `hiddenInfo`. The client hides both players' hands and facedown provinces
// behind `hiddenInfo`, which the replay viewer merges back in — so a downloaded
// bot game shows BOTH hands, which is exactly what reviewing bot decisions
// needs.
//
// USAGE
//   node tools/selfplay/exportReplay.js --a PhoenixShugenja --b Crane \
//     --base 91001 [--out "game replays/bot"] [--change '<json>'] [--seat 0]
//
//   --a/--b     deck labels from deckRegistry (default Crane vs Crab)
//   --base      shuffle base; the same number reproduces the same game
//   --change    v2Profile JSON injected into --seat only, so a replay can show
//               what an experimental arm actually does
//   --games     export several consecutive bases in one run (default 1)
process.env.LOG_LEVEL = 'error';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');

const ICONS = new Set([
    'military', 'political',
    'air', 'earth', 'fire', 'water', 'void',
    'crab', 'crane', 'dragon', 'lion', 'phoenix', 'scorpion', 'unicorn',
    'fate', 'honor', 'card', 'cards'
]);

// Mirrors jigoku-client/client/GameComponents/gameLogSerializer.ts so the
// exported `plainText` reads exactly like a downloaded log.
function fragmentToText(fragment) {
    if(fragment === null || fragment === undefined) {
        return '';
    }
    if(typeof fragment === 'string') {
        return ICONS.has(fragment) ? `[${fragment}]` : fragment;
    }
    if(typeof fragment === 'number') {
        return String(fragment);
    }
    if(Array.isArray(fragment)) {
        return fragment.map(fragmentToText).join('');
    }
    if(fragment.alert) {
        const text = fragmentToText(fragment.alert.message);
        return fragment.alert.type === 'endofround'
            ? `--- ${text} ---`
            : `[${String(fragment.alert.type).toUpperCase()}] ${text}`;
    }
    if(fragment.message) {
        return fragmentToText(fragment.message);
    }
    if(fragment.emailHash) {
        return fragment.name;
    }
    if(fragment.id) {
        if(fragment.type === 'ring') {
            return `the ${fragment.element} ring`;
        }
        if(fragment.type === 'player') {
            return fragment.name;
        }
        if(fragment.facedown) {
            return 'a facedown card';
        }
        return fragment.name || fragment.label || '';
    }
    return fragment.name || fragment.label || '';
}

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function parseArgs(argv) {
    const options = {
        a: 'Crane', b: 'Crab', base: 91001, games: 1, seat: 0,
        out: path.join('game replays', 'bot'), change: undefined
    };
    for(let i = 2; i < argv.length; i++) {
        const key = String(argv[i]).replace(/^--/, '');
        const value = argv[i + 1];
        if(key === 'a' || key === 'b' || key === 'out' || key === 'change') {
            options[key] = value;
            i++;
        } else if(key === 'base' || key === 'games' || key === 'seat') {
            options[key] = Number(value);
            i++;
        }
    }
    for(const label of [options.a, options.b]) {
        if(!DECK_LABELS.includes(label)) {
            throw new Error(`unknown deck '${label}'. Known: ${DECK_LABELS.join(', ')}`);
        }
    }
    return options;
}

// `game.getState()` returns the CUMULATIVE message list, but the client records
// what the socket pushed that tick, which is the delta. Converting keeps one
// format, so the replay viewer and the log-analysis scripts read exported bot
// games and downloaded human games the same way.
// `newMessages` matters: `parseGameLog` only ACCUMULATES when it is set, and
// otherwise resets the log to that snapshot's own messages — a delta-encoded
// file without it shows one or two lines per step instead of the game so far.
function messagesToDeltas(states) {
    let seen = 0;
    for(const entry of states) {
        const all = entry.state?.messages || [];
        entry.state.messages = all.slice(seen);
        entry.state.newMessages = true;
        seen = all.length;
    }
    return states;
}

function buildLog(result, options, names) {
    const record = result.record;
    const lines = (record.messages || [])
        .map((entry) => fragmentToText(entry.message))
        .filter((line) => line.length > 0);
    return {
        version: 3,
        metadata: {
            gameName: `${options.a} vs ${options.b} (base ${options.base})`,
            gameMode: 'stronghold',
            winner: result.winner,
            date: new Date().toISOString(),
            players: record.players,
            // MUST be a player name. `GameReplay` passes it to the board as the
            // viewing user, and a name that matches no player puts the board in
            // spectator mode, where `getPlayerHand` renders nothing — leaving
            // only the opponent's hand panel on screen.
            downloadedBy: record.viewer,
            // Not part of the client's format; harmless extra the viewer
            // ignores, and it is what makes an exported game reproducible.
            selfplay: {
                base: options.base,
                decks: { [names[0]]: options.a, [names[1]]: options.b },
                change: options.change || null,
                changeSeat: options.change ? options.seat : null,
                winReason: result.winReason,
                stopReason: result.stopReason,
                rounds: result.rounds
            }
        },
        plainText: lines.join('\n'),
        messages: record.messages,
        replayData: messagesToDeltas(record.states),
        hiddenInfo: record.hiddenInfo
    };
}

(async () => {
    const options = parseArgs(process.argv);
    const change = options.change ? JSON.parse(options.change) : undefined;
    const names = ['Seat0', 'Seat1'];
    fs.mkdirSync(options.out, { recursive: true });

    for(let n = 0; n < Math.max(1, options.games); n++) {
        const base = options.base + n * 1000;
        Math.random = rng(base);
        const result = await runGame({
            names,
            seeds: [1, 1],
            deckA: getDeckLoader(options.a)(),
            deckB: getDeckLoader(options.b)(),
            engineVersions: ['v2', 'v2'],
            v2Modes: ['pass-through', 'pass-through'],
            v2Profiles: [
                change && options.seat === 0 ? change : undefined,
                change && options.seat === 1 ? change : undefined
            ],
            record: { viewer: names[0] }
        });
        if(!result.record) {
            throw new Error('harness returned no record — is options.record wired?');
        }
        const log = buildLog(result, { ...options, base }, names);
        const file = path.join(options.out,
            `selfplay_${base}_${options.a}-vs-${options.b}.json.gz`);
        fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(log), 'utf8')));
        console.log(`${file}  winner=${result.winner} (${result.winReason}) ` +
            `rounds=${result.rounds} snapshots=${log.replayData.length} ` +
            `hidden=${log.hiddenInfo.length} stop=${result.stopReason}`);
    }
})();
