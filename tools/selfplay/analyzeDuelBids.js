'use strict';

// Duel bid laboratory. Runs no game: it exercises the same shared 5x5
// skill/honor/Iaijutsu policy used by live bots, making profile tuning cheap.

const fs = require('fs');
const path = require('path');
const {
    DuelBidTactics,
    DEFAULT_DUEL_BID_PROFILE
} = require('../../build/server/game/bots/DuelBidTactics.js');

function usage() {
    return `Usage: node tools/selfplay/analyzeDuelBids.js [options]

No position flags: run curated skill/honor/round scenarios.

Options:
  --my-skill N          Bot duel skill (single custom scenario)
  --opponent-skill N    Opponent duel skill
  --my-honor N          Bot honor
  --opponent-honor N    Opponent honor
  --round N             Current round
  --my-master           Bot participant has an unspent Iaijutsu Master
  --opponent-master     Opponent has an unspent Iaijutsu Master
  --objective NAME      balanced, honor, or dishonor
  --set K=V[,K=V...]    Override numeric DuelBidProfile knobs
  --matrix              Print each 5x5 W/D/L matrix and per-bid probabilities
  --grid                Analyze 1,200 default skill/honor/round combinations
  --json                Print JSON instead of tables
  --out FILE.json       Also write complete JSON report
  -h, --help            Show help

Examples:
  node tools/selfplay/analyzeDuelBids.js
  node tools/selfplay/analyzeDuelBids.js --my-skill 4 --opponent-skill 5 --my-honor 11 --opponent-honor 4 --round 2 --matrix
  node tools/selfplay/analyzeDuelBids.js --grid --objective dishonor --set duelWinUtility=3,honorSwingUtility=1.4 --out tools/selfplay/out/duel-grid.json`;
}

function numberValue(value, flag) {
    const parsed = Number(value);
    if(!Number.isFinite(parsed)) {
        throw new Error(`${flag} must be a finite number`);
    }
    return parsed;
}

function parseArgs(argv) {
    const options = {
        objective: 'balanced',
        overrides: {},
        matrix: false,
        grid: false,
        json: false,
        out: null,
        help: false,
        myMaster: false,
        opponentMaster: false
    };
    const numeric = new Map([
        ['--my-skill', 'mySkill'],
        ['--opponent-skill', 'opponentSkill'],
        ['--my-honor', 'myHonor'],
        ['--opponent-honor', 'opponentHonor'],
        ['--round', 'roundNumber']
    ]);
    for(let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if(arg === '--help' || arg === '-h') {
            options.help = true;
        } else if(arg === '--matrix') {
            options.matrix = true;
        } else if(arg === '--grid') {
            options.grid = true;
        } else if(arg === '--json') {
            options.json = true;
        } else if(arg === '--my-master') {
            options.myMaster = true;
        } else if(arg === '--opponent-master') {
            options.opponentMaster = true;
        } else if(numeric.has(arg)) {
            options[numeric.get(arg)] = numberValue(argv[++index], arg);
        } else if(arg === '--objective') {
            options.objective = String(argv[++index] || '');
            if(!['balanced', 'honor', 'dishonor'].includes(options.objective)) {
                throw new Error('--objective must be balanced, honor, or dishonor');
            }
        } else if(arg === '--set') {
            const pairs = String(argv[++index] || '').split(',').filter(Boolean);
            for(const pair of pairs) {
                const separator = pair.indexOf('=');
                if(separator <= 0) {
                    throw new Error(`invalid --set pair '${pair}'`);
                }
                const key = pair.slice(0, separator);
                if(!Object.prototype.hasOwnProperty.call(DEFAULT_DUEL_BID_PROFILE, key) ||
                    typeof DEFAULT_DUEL_BID_PROFILE[key] !== 'number') {
                    throw new Error(`--set '${key}' is not a numeric DuelBidProfile knob`);
                }
                options.overrides[key] = numberValue(pair.slice(separator + 1), `--set ${key}`);
            }
        } else if(arg === '--out') {
            options.out = argv[++index];
            if(!options.out) {
                throw new Error('--out needs a path');
            }
        } else {
            throw new Error(`unknown argument '${arg}'`);
        }
    }
    return options;
}

function curatedScenarios(options) {
    const customKeys = ['mySkill', 'opponentSkill', 'myHonor', 'opponentHonor', 'roundNumber'];
    const custom = customKeys.some((key) => options[key] !== undefined);
    if(custom) {
        return [{
            name: 'custom',
            mySkill: options.mySkill ?? 5,
            opponentSkill: options.opponentSkill ?? 5,
            myHonor: options.myHonor ?? 11,
            opponentHonor: options.opponentHonor ?? 11,
            roundNumber: options.roundNumber ?? 1,
            myIaijutsuMasterReady: options.myMaster,
            opponentIaijutsuMasterReady: options.opponentMaster
        }];
    }
    return [
        ['equal early', 5, 5, 11, 11, 1],
        ['equal late', 5, 5, 11, 11, 5],
        ['behind 1 / safe enemy', 4, 5, 11, 11, 1],
        ['behind 1 / enemy cliff', 4, 5, 11, 4, 1],
        ['ahead 1 / own cliff', 5, 4, 3, 11, 2],
        ['far ahead', 10, 4, 11, 11, 2],
        ['hopeless', 1, 7, 11, 11, 2],
        ['own Iaijutsu', 4, 5, 11, 11, 2, true, false],
        ['enemy Iaijutsu', 4, 5, 11, 11, 2, false, true],
        ['own honor victory', 5, 5, 24, 11, 3],
        ['enemy honor victory', 5, 4, 11, 24, 3],
        ['enemy dishonor threat', 4, 5, 11, 3, 3]
    ].map(([name, mySkill, opponentSkill, myHonor, opponentHonor, roundNumber,
        myIaijutsuMasterReady = false, opponentIaijutsuMasterReady = false]) => ({
        name,
        mySkill,
        opponentSkill,
        myHonor,
        opponentHonor,
        roundNumber,
        myIaijutsuMasterReady,
        opponentIaijutsuMasterReady
    }));
}

function gridScenarios() {
    const scenarios = [];
    for(const mySkill of [2, 4, 5, 7]) {
        for(const opponentSkill of [2, 4, 5, 7]) {
            for(const myHonor of [3, 5, 11, 20, 24]) {
                for(const opponentHonor of [3, 5, 11, 20, 24]) {
                    for(const roundNumber of [1, 3, 5]) {
                        scenarios.push({
                            name: `S${mySkill}-${opponentSkill} H${myHonor}-${opponentHonor} R${roundNumber}`,
                            mySkill,
                            opponentSkill,
                            myHonor,
                            opponentHonor,
                            roundNumber,
                            myIaijutsuMasterReady: false,
                            opponentIaijutsuMasterReady: false
                        });
                    }
                }
            }
        }
    }
    return scenarios;
}

function analyzeScenario(tactics, scenario) {
    const analysis = tactics.analyze(scenario, 0.5);
    const recommendation = analysis.bids.find((entry) => entry.bid === analysis.recommendedBid);
    const expectedMixedBid = analysis.bids.reduce((sum, entry) =>
        sum + entry.bid * entry.strategyProbability, 0);
    return {
        scenario,
        recommendedBid: analysis.recommendedBid,
        selectedAtMedian: analysis.selectedBid,
        expectedMixedBid,
        reason: analysis.reason,
        modeledWinProbability: recommendation.modeledWinProbability,
        uniformWinProbability: recommendation.uniformWinProbability,
        expectedHonorDelta: recommendation.expectedHonorDelta,
        opponentBidProbabilities: analysis.opponentBidProbabilities,
        bids: analysis.bids,
        matrix: analysis.matrix
    };
}

const percent = (value) => `${(100 * value).toFixed(1)}%`;
const number = (value) => value.toFixed(2);

function printSummary(results) {
    const headers = [
        'scenario', 'skill', 'honor', 'rnd', 'masters', 'mode', 'bid', 'mix E',
        'win(model)', 'win(5x5)', 'honor delta'
    ];
    const rows = results.map((result) => {
        const scenario = result.scenario;
        return [
            scenario.name,
            `${scenario.mySkill}-${scenario.opponentSkill}`,
            `${scenario.myHonor}-${scenario.opponentHonor}`,
            String(scenario.roundNumber),
            `${scenario.myIaijutsuMasterReady ? 'M' : '-'}${scenario.opponentIaijutsuMasterReady ? 'M' : '-'}`,
            result.reason,
            String(result.recommendedBid),
            number(result.expectedMixedBid),
            percent(result.modeledWinProbability),
            percent(result.uniformWinProbability),
            number(result.expectedHonorDelta)
        ];
    });
    const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
    const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join('  ');
    console.log(line(headers));
    console.log(widths.map((width) => '-'.repeat(width)).join('  '));
    for(const row of rows) {
        console.log(line(row));
    }
}

function printMatrix(result) {
    console.log(`\n${result.scenario.name}: skill ${result.scenario.mySkill}-${result.scenario.opponentSkill}, honor ${result.scenario.myHonor}-${result.scenario.opponentHonor}, round ${result.scenario.roundNumber}`);
    console.log('cell = duel W/D/L; ! = projected immediate game result');
    console.log('bot\\opp  1   2   3   4   5');
    for(const bid of [1, 2, 3, 4, 5]) {
        const cells = result.matrix.filter((entry) => entry.myBid === bid)
            .sort((left, right) => left.opponentBid - right.opponentBid)
            .map((entry) => `${entry.duelResult[0].toUpperCase()}${entry.gameResult ? '!' : ' '}`);
        console.log(`${String(bid).padEnd(8)} ${cells.join('  ')}`);
    }
    console.log('bid  uniformW  modeledW  draw    loss    E[honor]  E[utility]  mix');
    for(const entry of result.bids) {
        console.log([
            String(entry.bid).padEnd(3),
            percent(entry.uniformWinProbability).padEnd(9),
            percent(entry.modeledWinProbability).padEnd(9),
            percent(entry.modeledDrawProbability).padEnd(7),
            percent(entry.modeledLossProbability).padEnd(7),
            number(entry.expectedHonorDelta).padEnd(9),
            number(entry.expectedUtility).padEnd(11),
            percent(entry.strategyProbability)
        ].join('  '));
    }
}

function printGridSummary(results) {
    const counts = Object.fromEntries([1, 2, 3, 4, 5].map((bid) => [bid, 0]));
    for(const result of results) {
        counts[result.recommendedBid]++;
    }
    console.log(`grid scenarios: ${results.length}`);
    console.log('recommended bids: ' + Object.entries(counts)
        .map(([bid, count]) => `${bid}=${count} (${percent(count / results.length)})`).join(', '));
    const modes = results.reduce((countsByMode, result) => {
        countsByMode[result.reason] = (countsByMode[result.reason] || 0) + 1;
        return countsByMode;
    }, {});
    console.log('decision modes: ' + Object.entries(modes)
        .map(([mode, count]) => `${mode}=${count} (${percent(count / results.length)})`).join(', '));
    console.log(`average modeled win: ${percent(results.reduce((sum, result) => sum + result.modeledWinProbability, 0) / results.length)}`);
    console.log(`average expected honor delta: ${number(results.reduce((sum, result) => sum + result.expectedHonorDelta, 0) / results.length)}`);

    const printGroups = (title, keyOf) => {
        const groups = new Map();
        for(const result of results) {
            const key = keyOf(result);
            groups.set(key, (groups.get(key) || []).concat(result));
        }
        console.log(`\n${title}`);
        console.log('group  n   rec bid  mix E  modeled wins/100  uniform wins/100  honor delta');
        for(const [key, group] of groups) {
            const average = (selector) => group.reduce((sum, result) =>
                sum + selector(result), 0) / group.length;
            console.log([
                String(key).padEnd(6),
                String(group.length).padEnd(3),
                number(average((result) => result.recommendedBid)).padEnd(7),
                number(average((result) => result.expectedMixedBid)).padEnd(5),
                number(100 * average((result) => result.modeledWinProbability)).padEnd(17),
                number(100 * average((result) => result.uniformWinProbability)).padEnd(17),
                number(average((result) => result.expectedHonorDelta))
            ].join('  '));
        }
    };
    printGroups('by skill (bot-opponent)', (result) =>
        `${result.scenario.mySkill}-${result.scenario.opponentSkill}`);
    printGroups('by round', (result) => `R${result.scenario.roundNumber}`);
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if(options.help) {
        console.log(usage());
        return;
    }
    const profile = {
        ...DEFAULT_DUEL_BID_PROFILE,
        objective: options.objective,
        ...options.overrides
    };
    const tactics = new DuelBidTactics(profile);
    const scenarios = options.grid ? gridScenarios() : curatedScenarios(options);
    const results = scenarios.map((scenario) => analyzeScenario(tactics, scenario));
    const report = {
        generatedAt: new Date().toISOString(),
        profile,
        scenarioCount: results.length,
        results
    };

    if(options.out) {
        const outputPath = path.resolve(options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
        console.error(`wrote ${outputPath}`);
    }
    if(options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    if(options.grid) {
        printGridSummary(results);
    } else {
        printSummary(results);
    }
    if(options.matrix) {
        for(const result of results) {
            printMatrix(result);
        }
    }
}

try {
    main();
} catch(error) {
    console.error(error.message || error);
    console.error(usage());
    process.exitCode = 1;
}
