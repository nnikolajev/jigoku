'use strict';

// Controlled card-evaluation lab.
//
// Full self-play answers "does this bot win more". It cannot answer "how much is
// THIS card worth", because every game differs in shuffle, board and tempo, and
// a card that appears in a fifth of games is buried under that noise.
//
// This runs the opposite experiment: fix the board, vary ONE thing, and replay
// the same situation many times. Both seats are driven by the real bot, so card
// ABILITIES fire through the bot's own logic instead of being scripted — which
// is the point, since a holding's text is usually worth more than its printed
// strength and no card-data field captures that.
//
// It is deliberately generic. A scenario names a board and a list of variants;
// nothing here knows about any particular deck or card.
//
//   node tools/selfplay/cardLab.js <scenario.js> [repeats]
//
// A scenario module exports:
//   {
//     name, phase,
//     rounds,                        // how many rounds to let the bots play
//     player1: {...}, player2: {...} // setupTest-shaped board, minus variants
//     variants: [ { label, player1?, player2? } ]  // deep-merged over the base
//     seats: ['v1'|'v2', 'v1'|'v2']  // engine per seat (default v1)
//     measure(result) -> Record<string, number>   // optional extra metrics
//   }

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

// GameFlowWrapper is a test helper and expects jasmine's spy factory. Provide a
// minimal stand-in so the lab can run outside the spec runner.
if(!global.jasmine) {
    global.jasmine = {
        createSpyObj: (_name, methods) => {
            const spy = {};
            for(const method of methods) {
                const fn = (...args) => {
                    fn.calls.push(args);
                    return fn.impl ? fn.impl(...args) : undefined;
                };
                fn.calls = [];
                fn.and = { callFake: (impl) => {
                    fn.impl = impl; return fn;
                } };
                spy[method] = fn;
            }
            return spy;
        }
    };
}

const path = require('path');
const _ = require('underscore');
const GameFlowWrapper = require('../../test/helpers/gameflowwrapper.js');
const DeckBuilder = require('../../test/helpers/deckbuilder.js');
const JigokuBotController = require('../../build/server/game/bots/JigokuBotController.js');
const ConflictFlow = require('../../build/server/game/gamesteps/conflict/conflictflow.js');
const CardValueModel = require('../../build/server/game/bots/shared/CardValueModel.js');
const { GameModes } = require('../../build/server/GameModes.js');

const deckBuilder = new DeckBuilder();
const BOT_COMMANDS = new Set([
    'cardClicked', 'facedownCardClicked', 'menuButton',
    'menuItemClick', 'ringClicked', 'ringMenuItemClick'
]);

/** Deterministic PRNG so a variant sees the same shuffles as its siblings. */
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

/**
 * Deep merge a variant over the base board.
 *
 * Arrays REPLACE rather than concatenate: a variant that names `inPlay` means
 * "this board", not "these extra bodies".
 */
function merge(base, override) {
    if(Array.isArray(override) || override === null || typeof override !== 'object') {
        return override === undefined ? base : override;
    }
    const result = Object.assign({}, base);
    for(const [key, value] of Object.entries(override)) {
        result[key] = merge(base ? base[key] : undefined, value);
    }
    return result;
}

/**
 * Stand up the board described by `options`, the same shape the integration
 * specs use. This is `setupTest` without its jasmine `this` binding.
 */
function buildBoard(options) {
    const flow = new GameFlowWrapper();
    const player1 = options.player1 || {};
    const player2 = options.player2 || {};
    flow.game.gameMode = GameModes.Stronghold;

    flow.player1.selectDeck(deckBuilder.customDeck(player1, flow.game.gameMode));
    flow.player2.selectDeck(deckBuilder.customDeck(player2, flow.game.gameMode));
    flow.startGame();
    flow.selectFirstPlayer(flow.player1);
    flow.selectStrongholdProvinces({
        player1: player1.strongholdProvince,
        player2: player2.strongholdProvince
    });

    flow.keepDynasty();
    flow.player1.dynastyDiscard = player1.dynastyDiscard;
    flow.player2.dynastyDiscard = player2.dynastyDiscard;
    flow.keepConflict();
    flow.advancePhases(options.phase || 'conflict');

    for(const [wrapper, spec] of [[flow.player1, player1], [flow.player2, player2]]) {
        _.each(spec.rings || [], (ring) => wrapper.claimRing(ring));
        wrapper.fate = spec.fate;
        wrapper.honor = spec.honor;
        wrapper.inPlay = spec.inPlay;
        wrapper.hand = spec.hand;
        wrapper.conflictDiscard = spec.conflictDiscard;
        // The `provinces` setter looks for each named dynasty card in the
        // DYNASTY DECK. Setup has already dealt one card into every province,
        // so whichever card we want may already be sitting in a slot — which
        // reads as "not found" and fails the whole run. Return them first so a
        // scenario's province contents are always placeable.
        for(const location of ['province 1', 'province 2', 'province 3', 'province 4']) {
            for(const card of wrapper.player.getDynastyCardsInProvince(location) || []) {
                wrapper.moveCard(card, 'dynasty deck');
            }
        }
        wrapper.provinces = spec.provinces;
    }
    for(const location of ['province 1', 'province 2', 'province 3', 'province 4']) {
        flow.player1.player.replaceDynastyCard(location);
        flow.player2.player.replaceDynastyCard(location);
    }
    flow.game.checkGameState(true);
    return flow;
}

/** Hand both seats to the real bot and let them play the situation out. */
async function playOut(flow, scenario) {
    const game = flow.game;
    const seats = scenario.seats || ['v1', 'v1'];
    const runCommand = (command, name, args) => {
        if(!BOT_COMMANDS.has(command)) {
            return false;
        }
        try {
            game.stopNonChessClocks();
            return game[command](name, ...args) !== false;
        } catch{
            return false;
        }
    };
    const controllers = ['player1', 'player2'].map((name, i) => new JigokuBotController(game, {
        playerName: name,
        seed: 1,
        trace: false,
        maxDecisionsPerTick: 40,
        omniscient: false,
        engineVersion: seats[i] || 'v1',
        v2Mode: seats[i] === 'v2' ? 'pass-through' : undefined,
        v2Profile: (scenario.v2Profiles || [])[i]
    }, runCommand));

    const stopAfterRound = (game.roundNumber || 1) + (scenario.rounds || 1) - 1;
    const sleep = () => new Promise((resolve) => setImmediate(resolve));
    let steps = 0;
    let stuck = 0;
    let lastSignature = '';
    const startedAt = Date.now();
    while(!game.winner && steps < 4000 && Date.now() - startedAt < 20000) {
        if((game.roundNumber || 1) > stopAfterRound) {
            break;
        }
        for(const controller of controllers) {
            controller.tick();
        }
        game.continue();
        steps++;
        const signature = [game.roundNumber, game.currentPhase,
            flow.player1.player.honor, flow.player2.player.honor,
            flow.player1.player.fate, flow.player2.player.fate].join('|');
        if(signature === lastSignature) {
            stuck++;
            await sleep();
            game.continue();
            if(stuck > 300) {
                break;
            }
        } else {
            stuck = 0;
            lastSignature = signature;
        }
    }
    return steps;
}

/**
 * Run one variant `repeats` times and total up what happened.
 *
 * `rung` is an optional second axis (typically attacker strength) merged over
 * the variant, so a scenario can sweep the pressure instead of hand-tuning a
 * single board to the knife edge where the answer is an artifact of the setup.
 *
 * A variant may also override `seats` and `v2Profiles`, which turns the same
 * fixture into a bot A/B: identical board, one knob different. That is the only
 * way to see a rare card's effect at all, since in full self-play the games
 * where it matters are a small and noisy minority.
 */
async function runVariant(scenario, variant, repeats, baseSeed, rung) {
    const totals = {
        runs: 0, attacks: 0, breaks: 0, saves: 0,
        strengthSum: 0, marginSum: 0, attackerSkillSum: 0, attackerCountSum: 0, defenderSkillSum: 0,
        honorDelta: 0, fateDelta: 0
    };
    const defendingSeat = scenario.defendingSeat || 'player2';
    for(let run = 0; run < repeats; run++) {
        let board = merge({ phase: scenario.phase, player1: scenario.player1, player2: scenario.player2 },
            { player1: variant.player1, player2: variant.player2 });
        if(rung) {
            board = merge(board, { player1: rung.player1, player2: rung.player2 });
        }
        Math.random = rng(baseSeed + run);
        let flow;
        try {
            flow = buildBoard(board);
        } catch(error) {
            process.stderr.write(`  setup failed for ${variant.label}: ${error.message}\n`);
            continue;
        }
        const defender = flow[defendingSeat].player;
        const before = { honor: defender.honor, fate: defender.fate };

        ConflictFlow.default.provinceDefenseProbe = (event) => {
            if(event.defender !== defendingSeat || event.alreadyBroken) {
                return;
            }
            // Only the province under test. Without this, attacks on the other
            // provinces dilute the signal the variant is supposed to isolate.
            if(scenario.targetProvinceId && event.provinceId !== scenario.targetProvinceId) {
                return;
            }
            totals.attacks++;
            totals.strengthSum += Number(event.strength) || 0;
            // A stronger province does not only save itself — it forces the
            // attacker to bring MORE, and every extra body it commits is bowed
            // and unavailable for the rest of the phase. That cost is real
            // defensive value even in a conflict the province still loses.
            totals.attackerSkillSum += Number(event.attackerSkill) || 0;
            totals.attackerCountSum += Number(event.attackerCount) || 0;
            totals.defenderSkillSum += Number(event.defenderSkill) || 0;
            // How much the province survived (or fell) by. Positive = held.
            totals.marginSum += (Number(event.strength) || 0) - (Number(event.skillDifference) || 0);
            if(event.broke) {
                totals.breaks++;
            } else {
                totals.saves++;
            }
        };
        const runScenario = (variant.seats || variant.v2Profiles || rung?.seats || rung?.v2Profiles)
            ? Object.assign({}, scenario, {
                seats: variant.seats || rung?.seats || scenario.seats,
                v2Profiles: variant.v2Profiles || rung?.v2Profiles || scenario.v2Profiles
            })
            : scenario;
        try {
            await playOut(flow, runScenario);
        } catch(error) {
            process.stderr.write(`  run failed for ${variant.label}: ${error.message}\n`);
        }
        ConflictFlow.default.provinceDefenseProbe = null;
        totals.runs++;
        totals.honorDelta += defender.honor - before.honor;
        totals.fateDelta += defender.fate - before.fate;
    }
    return totals;
}

async function main() {
    const scenarioPath = process.argv[2];
    if(!scenarioPath) {
        console.log('Usage: node tools/selfplay/cardLab.js <scenario.js> [repeats]');
        process.exit(1);
    }
    const scenario = require(path.resolve(scenarioPath));
    // `LAB_PROBE_CARD=<id>` prints every value-model evaluation of that card.
    // A variant that changes nothing is usually a card that was never reached,
    // and that is indistinguishable from "reached and correctly declined"
    // without this.
    const probeCard = process.env.LAB_PROBE_CARD;
    if(probeCard && typeof CardValueModel.setCardValueProbe === 'function') {
        const seen = new Map();
        CardValueModel.setCardValueProbe((id, value) => {
            if(id !== probeCard) {
                return;
            }
            const key = (value.blocked ? 'blocked' : value.hold ? 'hold' : 'fire') +
                ': ' + (value.reason || '');
            seen.set(key, (seen.get(key) || 0) + 1);
        });
        process.on('exit', () => {
            process.stderr.write(`\nvalue-model evaluations of ${probeCard}:\n`);
            if(seen.size === 0) {
                process.stderr.write('  (never evaluated — the card was not reached)\n');
            }
            for(const [key, count] of [...seen].sort((a, b) => b[1] - a[1])) {
                process.stderr.write(`  ${String(count).padStart(5)}  ${key}\n`);
            }
        });
    }
    const repeats = Number(process.argv[3] || scenario.repeats || 8);
    const baseSeed = Number(process.env.LAB_SEED || 70001);

    console.log(`# ${scenario.name}`);
    console.log(`repeats per variant: ${repeats}   rounds played: ${scenario.rounds || 1}` +
        `   seats: ${(scenario.seats || ['v1', 'v1']).join(' vs ')}\n`);
    // With a pressure ladder the interesting number is the RUNG at which each
    // variant starts losing the province — "how much extra attack does this
    // card force" — which no single fixed board can report.
    if(Array.isArray(scenario.ladder) && scenario.ladder.length > 0) {
        const header = 'variant'.padEnd(30) + scenario.ladder
            .map((rung) => rung.label.padStart(14)).join('');
        console.log(header);
        console.log('-'.repeat(header.length));
        for(const variant of scenario.variants) {
            const cells = [];
            for(const rung of scenario.ladder) {
                const totals = await runVariant(scenario, variant, repeats, baseSeed, rung);
                // The rate alone is not readable evidence — a 100% hold can mean
                // "the wall stopped it" or "the attacker never really came". The
                // skills make the difference visible.
                cells.push(totals.attacks === 0
                    ? 'no atk'
                    : (100 * totals.saves / totals.attacks).toFixed(0) + '% ' +
                      (totals.attackerSkillSum / totals.attacks).toFixed(0) + 'v' +
                      (totals.defenderSkillSum / totals.attacks).toFixed(0) + '/' +
                      (totals.strengthSum / totals.attacks).toFixed(0));
            }
            console.log(variant.label.padEnd(30) + cells.map((c) => c.padStart(14)).join(''));
        }
        console.log('\nCell = share of attacks on the target province the defence SAVED.');
        return;
    }

    console.log('variant                        attacks  broke  saved  hold%   avg str  avg margin  atk skill  atk bodies  honor  fate');
    console.log('-'.repeat(124));

    const rows = [];
    for(const variant of scenario.variants) {
        const totals = await runVariant(scenario, variant, repeats, baseSeed);
        const holdRate = totals.attacks > 0 ? 100 * totals.saves / totals.attacks : 0;
        rows.push({ label: variant.label, ...totals, holdRate });
        console.log(
            variant.label.padEnd(30) +
            String(totals.attacks).padStart(7) +
            String(totals.breaks).padStart(7) +
            String(totals.saves).padStart(7) +
            (totals.attacks > 0 ? holdRate.toFixed(0) + '%' : '  -').padStart(7) +
            (totals.attacks > 0 ? (totals.strengthSum / totals.attacks).toFixed(1) : '-').padStart(10) +
            (totals.attacks > 0 ? (totals.marginSum / totals.attacks).toFixed(1) : '-').padStart(12) +
            (totals.attacks > 0 ? (totals.attackerSkillSum / totals.attacks).toFixed(1) : '-').padStart(11) +
            (totals.attacks > 0 ? (totals.attackerCountSum / totals.attacks).toFixed(1) : '-').padStart(12) +
            (totals.runs > 0 ? (totals.honorDelta / totals.runs).toFixed(1) : '-').padStart(7) +
            (totals.runs > 0 ? (totals.fateDelta / totals.runs).toFixed(1) : '-').padStart(6));
    }

    // Rank against the control so the output states a VALUE, not just counts.
    const control = rows.find((row) => row.label === (scenario.control || rows[0].label));
    if(control && control.attacks > 0) {
        console.log('\nversus control "' + control.label + '" (hold rate, percentage points):');
        for(const row of rows.slice().sort((a, b) => b.holdRate - a.holdRate)) {
            if(row === control || row.attacks === 0) {
                continue;
            }
            const delta = row.holdRate - control.holdRate;
            console.log('  ' + row.label.padEnd(30) +
                (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'pp');
        }
    }
    if(typeof scenario.report === 'function') {
        scenario.report(rows);
    }
}

main().catch((error) => {
    console.error(error); process.exit(1);
});
