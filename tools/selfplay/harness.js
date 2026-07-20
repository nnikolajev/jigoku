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
    policy = undefined, drawBidPolicy = undefined, mulliganPolicy = undefined) {
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
    const controllers = names.map((name, i) => makeController(
        game,
        name,
        seeds[i],
        options.trace,
        policies[i],
        drawBidPolicies[i],
        mulliganPolicies[i]
    ));
    if(options.onControllers) {
        options.onControllers(controllers);
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

    let steps = 0;
    let lastSig = signature();
    let noProgress = 0;
    const startedAt = Date.now();
    const maxGameMs = options.maxGameMs || 30000;

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

    const summary = reward.summary();
    reward.detach();

    return {
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
