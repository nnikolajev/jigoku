'use strict';

// Headless self-play harness: runs a full bot-vs-bot Jigoku game with no
// sockets, no GUI, no network. Both seats are JigokuBotControllers (seed 1,
// LLM disabled => fully synchronous heuristic play) sharing the aggressive
// Unicorn deck. Returns the outcome and reward breakdown.

const Game = require('../../build/server/game/game.js');
const Settings = require('../../build/server/settings.js');
const { GameModes } = require('../../build/server/GameModes.js');
const JigokuBotController = require('../../build/server/game/bots/JigokuBotController.js');
const { RewardTracker } = require('./reward.js');
const { loadUnicornDeck } = require('./deckLoader.js');

// Bot commands the harness will forward to the engine — same set GameServer
// allows for bot seats.
const BOT_COMMANDS = new Set([
    'cardClicked', 'facedownCardClicked', 'menuButton',
    'menuItemClick', 'ringClicked', 'ringMenuItemClick'
]);

function makeRouter(state) {
    return {
        gameWon(game, reason, winner) {
            state.winReason = reason;
            state.winnerName = winner ? winner.name : null;
        },
        playerLeft() {},
        handleError(game, error) {
            state.error = error?.stack || String(error);
        }
    };
}

function buildGame(names) {
    const state = { winReason: null, winnerName: null, error: null };
    const details = {
        name: 'selfplay',
        id: `selfplay-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        owner: names[0],
        saveGameId: 0,
        allowSpectators: false,
        spectatorSquelch: true,
        gameType: 'casual',
        gameMode: 'stronghold',
        clocks: null,
        players: names.map((name, i) => ({
            id: String(100 + i),
            user: Settings.getUserWithDefaultsSet({ username: name })
        })),
        spectators: {}
    };
    const game = new Game(details, { router: makeRouter(state) });
    game.gameMode = GameModes.Stronghold;
    game.started = true;
    for(const player of Object.values(game.getPlayers())) {
        player.timerSettings.events = false;
    }
    return { game, state };
}

function makeController(game, playerName, seed, trace = false,
    policy = undefined, drawBidPolicy = undefined, mulliganPolicy = undefined,
    omniscient = false, conflictPlanningPolicy = undefined, engineOptions = {}) {
    const runCommand = (command, name, args) => {
        if(!BOT_COMMANDS.has(command)) {
            return false;
        }
        try {
            game.stopNonChessClocks();
            const result = game[command](name, ...args);
            return result !== false;
        } catch{
            return false;
        }
    };
    return new JigokuBotController(
        game,
        {
            playerName: playerName,
            seed: seed,
            trace: trace,
            maxDecisionsPerTick: 40,
            policy: policy,
            drawBidPolicy: drawBidPolicy,
            mulliganPolicy: mulliganPolicy,
            conflictPlanningPolicy: conflictPlanningPolicy,
            omniscient: omniscient === true,
            engineVersion: engineOptions.engineVersion || 'v1',
            v2Mode: engineOptions.v2Mode,
            deckProfileId: engineOptions.deckProfileId,
            traceLevel: engineOptions.traceLevel,
            experiments: engineOptions.experiments,
            v2Profile: engineOptions.v2Profile,
            llm: { enabled: false }
        },
        runCommand
    );
}

const sleep = () => new Promise((resolve) => setImmediate(resolve));

// Run one game to completion (or the round/step cap). Returns the outcome,
// reward summary, and metadata. Deterministic reward, non-deterministic play
// (deck shuffles + heuristic tie-breaks vary run to run).
async function runGame(options = {}) {
    const names = options.names || ['BotA', 'BotB'];
    const seeds = options.seeds || [1, 1];
    const maxRounds = options.maxRounds || 25;
    const maxSteps = options.maxSteps || 20000;
    const rewardWeights = options.rewardWeights || {};

    const { game, state } = buildGame(names);
    const deckA = options.deckA || loadUnicornDeck();
    const deckB = options.deckB || loadUnicornDeck();
    game.selectDeck(names[0], deckA);
    game.selectDeck(names[1], deckB);
    game.initialise();

    const reward = new RewardTracker(game, names, rewardWeights);
    const policies = options.policies || [];
    const drawBidPolicies = options.drawBidPolicies || [];
    const mulliganPolicies = options.mulliganPolicies || [];
    const omniscient = options.omniscient || [];
    const conflictPlanningPolicies = options.conflictPlanningPolicies || [];
    const engineVersions = options.engineVersions || [];
    const v2Modes = options.v2Modes || [];
    const deckProfileIds = options.deckProfileIds || [];
    const traceLevels = options.traceLevels || [];
    const experiments = options.experiments || [];
    const controllers = names.map((name, i) => makeController(
        game,
        name,
        seeds[i],
        options.trace,
        policies[i],
        drawBidPolicies[i],
        mulliganPolicies[i],
        omniscient[i],
        conflictPlanningPolicies[i],
        {
            engineVersion: engineVersions[i] || 'v1',
            v2Mode: v2Modes[i],
            deckProfileId: deckProfileIds[i],
            traceLevel: traceLevels[i],
            experiments: experiments[i],
            v2Profile: (options.v2Profiles || [])[i]
        }
    ));
    if(options.onControllers) {
        options.onControllers(controllers);
    }
    // Live-game hook for observers that must watch the engine itself rather
    // than the bot's decisions (see test/helpers/effectpolarity.js). Called
    // once the controllers exist and before the first tick.
    if(options.onGame) {
        options.onGame(game, names);
    }
    const noProgressCap = options.noProgressCap || 400;

    // A signature of everything that changes when the game actually advances.
    // A stuck bot (e.g. an attacker looping in its own action window without
    // passing) reports acted=true forever, so progress must be judged from
    // real state, not the controllers' return value.
    const sizeOf = (col) => {
        if(!col) {
            return '';
        }
        if(typeof col.size === 'function') {
            return col.size();
        }
        if(typeof col.size === 'number') {
            return col.size;
        }
        if(typeof col.length === 'number') {
            return col.length;
        }
        return '';
    };
    const signature = () => {
        const parts = [game.roundNumber || 0, game.currentPhase || ''];
        for(const name of names) {
            const p = game.getPlayerByName(name);
            const ev = reward.events[name];
            parts.push(
                p ? p.honor : '', p ? p.fate : '',
                sizeOf(p && p.hand), sizeOf(p && p.cardsInPlay),
                ev.conflictsWon, ev.provincesBroken,
                p ? String(p.currentPrompt()?.menuTitle || '').replace(/Attacker:\s*-?\d+\s*Defender:\s*-?\d+/gi, '') : ''
            );
        }
        return parts.join('|');
    };

    // Optional client-format replay capture. Off unless `options.record` is
    // set, because a full state snapshot per step is expensive and every
    // measurement script runs thousands of games. See `exportReplay.js`.
    const record = options.record ? { states: [], viewer: options.record.viewer || names[0] } : null;
    const snapshot = () => {
        if(!record) {
            return;
        }
        try {
            record.states.push({
                state: JSON.parse(JSON.stringify(game.getState(record.viewer))),
                timestamp: Date.now()
            });
            game.recordHiddenInfoIfChanged();
        } catch(error) {
            record.error = record.error || String(error);
        }
    };

    let steps = 0;
    let lastSig = signature();
    let noProgress = 0;
    const startedAt = Date.now();
    snapshot();
    // Wall-clock backstop. This is NOT the loop detector - real loops are caught
    // by the no-progress `stalled` check and by `maxSteps`. Its only job is to
    // stop one game hanging a batch. Because it is wall clock, it fires on games
    // that are merely SLOW when workers oversubscribe the CPU: measured, Crab vs
    // Lion at 24 workers on 18 cores lost 3 of 32 games to this cap and 0 of 40
    // at 4 workers. Callers running in parallel must scale it.
    // 30s was tuned before the attacker-allocation rollout and still cut 7 of
    // 1800 games even at one worker per core; the surviving cases are body-heavy
    // boards (DragonAttachments vs Lion) that are slow, not stuck. Loops are
    // caught by `stalled`/`maxSteps` in well under this budget, so a longer
    // backstop costs nothing but removes the false non-results.
    const maxGameMs = options.maxGameMs ||
        Number(process.env.HARNESS_MAX_GAME_MS) || 90000;

    while(!game.winner && !state.error && steps < maxSteps) {
        if((game.roundNumber || 0) > maxRounds) {
            state.stopReason = 'round-cap';
            break;
        }
        // Ultimate backstop: no single game may hang the batch, whatever loop
        // slips past the controller's stuck detector.
        if(Date.now() - startedAt > maxGameMs) {
            state.stopReason = 'timeout';
            break;
        }

        for(const controller of controllers) {
            controller.tick();
        }
        game.continue();
        steps++;

        const sig = signature();
        if(record && sig !== lastSig) {
            snapshot();
        }
        if(sig === lastSig) {
            noProgress++;
            // Let any budget-exhaustion setTimeout(resumeTick) fire before
            // concluding nothing can move the pipeline forward.
            await sleep();
            game.continue();
            if(noProgress > noProgressCap) {
                state.stopReason = 'stalled';
                state.stallSignature = sig;
                break;
            }
        } else {
            noProgress = 0;
            lastSig = sig;
        }
    }

    if(steps >= maxSteps && !game.winner) {
        state.stopReason = state.stopReason || 'step-cap';
    }

    // Neutralize the controllers: a stalled seat may have a pending
    // setTimeout(resumeTick) that would otherwise keep spinning on this
    // finished game across the next games in a batch. Overwriting the instance
    // tick makes those callbacks no-ops (resumeTick calls this.tick()).
    for(const controller of controllers) {
        controller.tick = () => false;
    }

    if(record) {
        snapshot();
        record.messages = (game.messages || []).slice();
        record.hiddenInfo = (game.hiddenInfoLog || []).slice();
        record.players = names.map((name) => {
            const player = game.getPlayerByName(name);
            return { name, faction: player?.faction?.name || player?.faction?.value || 'unknown' };
        });
    }

    const summary = reward.summary();
    reward.detach();

    return {
        record,
        gameId: game.id,
        winner: state.winnerName,
        winReason: state.winReason,
        stopReason: state.stopReason || (game.winner ? 'decided' : 'unknown'),
        stallSignature: state.stallSignature || null,
        error: state.error,
        rounds: game.roundNumber || 0,
        steps,
        elapsedMs: Date.now() - startedAt,
        reward: summary
    };
}

module.exports = { runGame, buildGame, makeController };
