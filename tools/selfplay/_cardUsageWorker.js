'use strict';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { runGame } = require('./harness.js');
const { getDeckLoader } = require('./deckRegistry.js');
const {
    deckEntries,
    emptyAvailability,
    emptySemanticStages,
    scanAvailability,
    summarizeSemanticTrace,
    summarizeTrace
} = require('./cardUsageAudit.js');

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

function mergeCounts(target, source) {
    for(const [key, value] of Object.entries(source || {})) {
        target[key] = (target[key] || 0) + value;
    }
}

function mergeReasons(target, source) {
    for(const [cardId, reasons] of Object.entries(source || {})) {
        const row = target[cardId] || (target[cardId] = {});
        mergeCounts(row, reasons);
    }
}

async function main() {
    const subject = process.argv[2];
    const opponent = process.argv[3];
    const games = Number.parseInt(process.argv[4], 10);
    const seed = Number.parseInt(process.argv[5], 10);
    const omniscient = process.argv[6] === 'omniscient';
    const startIndex = Number.parseInt(process.argv[7], 10) || 0;
    const rngSeed = Number.parseInt(process.argv[8], 10);
    const engineVersion = process.argv[9] || 'v1';
    const v2Mode = process.argv[10] || (engineVersion === 'v2' ? 'shadow' : undefined);
    const loadSubject = getDeckLoader(subject);
    const loadOpponent = getDeckLoader(opponent);
    if(!loadSubject || !loadOpponent || !Number.isInteger(games) || games < 1 ||
        !Number.isInteger(seed) || seed < 1 || seed > 3 || !Number.isInteger(rngSeed) ||
        !['v1', 'v2'].includes(engineVersion) || (v2Mode && !['pass-through', 'shadow', 'enabled'].includes(v2Mode))) {
        throw new Error('invalid card-usage worker arguments');
    }

    const deckIds = new Set(deckEntries(loadSubject()).map((entry) => entry.card.id));
    const result = {
        subject, opponent, seed, omniscient, games: 0, wins: 0, losses: 0, other: 0,
        failed: [], clicks: {}, plays: {}, abilities: {}, reasons: {},
        availableGames: { hand: {}, province: {}, play: {}, selectable: {}, sourceSelectable: {} },
        semanticStages: emptySemanticStages()
    };
    const originalRandom = Math.random;
    try {
        for(let offset = 0; offset < games; offset++) {
            const gameIndex = startIndex + offset;
            Math.random = seededRandom(rngSeed + Math.floor(gameIndex / 2));
            const subjectFirst = gameIndex % 2 === 0;
            const subjectName = `Subject ${subject}`;
            const opponentName = `Opponent ${opponent}`;
            const names = subjectFirst ? [subjectName, opponentName] : [opponentName, subjectName];
            const decks = subjectFirst
                ? { deckA: loadSubject(), deckB: loadOpponent() }
                : { deckA: loadOpponent(), deckB: loadSubject() };
            const available = emptyAvailability();
            let controller;
            let controllers = [];
            const gameResult = await runGame({
                names,
                seeds: [seed, seed],
                omniscient: subjectFirst ? [omniscient, false] : [false, omniscient],
                engineVersions: subjectFirst ? [engineVersion, 'v1'] : ['v1', engineVersion],
                v2Modes: subjectFirst ? [v2Mode, undefined] : [undefined, v2Mode],
                traceLevels: subjectFirst ? ['benchmark', 'production'] : ['production', 'benchmark'],
                ...decks,
                trace: true,
                onControllers: (createdControllers) => {
                    controllers = createdControllers;
                    controller = createdControllers[subjectFirst ? 0 : 1];
                    const tick = controller.tick.bind(controller);
                    controller.tick = () => {
                        scanAvailability(controller.game, subjectName, deckIds, available);
                        const acted = tick();
                        scanAvailability(controller.game, subjectName, deckIds, available);
                        return acted;
                    };
                }
            });
            result.games++;
            if(gameResult.winner === subjectName) {
                result.wins++;
            } else if(gameResult.winner === opponentName) {
                result.losses++;
            } else {
                result.other++;
            }
            if(gameResult.error || gameResult.stopReason !== 'decided') {
                result.failed.push({
                    gameIndex,
                    stopReason: gameResult.stopReason,
                    error: gameResult.error || null,
                    rounds: gameResult.rounds,
                    steps: gameResult.steps,
                    stallSignature: gameResult.stallSignature || null,
                    conflict: controller?.game?.getState?.(subjectName)?.conflict || null,
                    boards: names.map((name, index) => {
                        const summary = controllers[index]?.game?.getState?.(name)?.players?.[name];
                        return {
                            player: name,
                            stats: summary?.stats,
                            characters: (summary?.cardPiles?.cardsInPlay || [])
                                .filter((card) => card.type === 'character')
                                .map((card) => ({
                                    uuid: card.uuid,
                                    id: card.id,
                                    name: card.name,
                                    bowed: card.bowed,
                                    inConflict: card.inConflict,
                                    military: card.militarySkillSummary,
                                    political: card.politicalSkillSummary
                                }))
                        };
                    }),
                    prompts: controllers.map((entry, index) => {
                        const livePlayer = entry.game.getPlayerByName(names[index]);
                        const prompt = livePlayer?.currentPrompt?.() || {};
                        return {
                            player: names[index],
                            promptTitle: prompt.promptTitle,
                            menuTitle: prompt.menuTitle,
                            selectCard: prompt.selectCard,
                            buttons: (prompt.buttons || []).map((button) => ({
                                text: button.text,
                                arg: button.arg,
                                disabled: button.disabled,
                                command: button.command
                            })),
                            selectableCards: (livePlayer?.promptState?.selectableCards || []).map((card) => ({
                                uuid: card.uuid,
                                id: card.id || card.cardData?.id,
                                name: card.name,
                                bowed: card.bowed
                            })),
                            legalDirectCards: Object.keys(
                                entry.currentLegalDirectCardUuids?.(livePlayer) || {}
                            )
                        };
                    }),
                    recentTrace: controllers.map((entry, index) => ({
                        player: names[index],
                        decisions: (entry.trace || []).slice(-20)
                    }))
                });
            }
            for(const [zone, ids] of Object.entries(available)) {
                for(const id of ids) {
                    result.availableGames[zone][id] = (result.availableGames[zone][id] || 0) + 1;
                }
            }
            const visible = new Set([...available.hand, ...available.province, ...available.play]);
            for(const id of visible) {
                result.semanticStages.visible[id] = (result.semanticStages.visible[id] || 0) + 1;
            }
            for(const id of available.selectable) {
                result.semanticStages.selectable[id] = (result.semanticStages.selectable[id] || 0) + 1;
            }
            for(const id of available.sourceSelectable) {
                result.semanticStages.eligible[id] = (result.semanticStages.eligible[id] || 0) + 1;
            }
            const usage = summarizeTrace(controller?.trace, deckIds);
            mergeCounts(result.clicks, usage.clicks);
            mergeCounts(result.plays, usage.plays);
            mergeCounts(result.abilities, usage.abilities);
            mergeReasons(result.reasons, usage.reasons);
            const semantic = summarizeSemanticTrace(controller?.trace, deckIds);
            for(const stage of ['candidate', 'chosen', 'resolved', 'payoffRealized']) {
                mergeCounts(result.semanticStages[stage], semantic[stage]);
            }
        }
    } finally {
        Math.random = originalRandom;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
});
