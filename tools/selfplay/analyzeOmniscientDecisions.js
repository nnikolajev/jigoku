'use strict';
// What does the omniscient seat actually DO with the hidden hand?
//
// Reads a probeOmniscient.js dump and answers, per decision site and per deck:
//   - how often the site was reached at all (a gated site is not a lever, it is
//     dead code for that profile);
//   - how often the exact information DIVERGED from what fair information would
//     have chosen (this is the real population the win rate is drawn from);
//   - what the divergence bought — which axis it swapped to, how much province
//     strength the exact targeting saved, how much the break target moved.
//
// It also cross-tabs divergence against the paired outcome, which is the only
// way to see whether the games the cheat changed are the games it won.
//
// USAGE
//   node tools/selfplay/analyzeOmniscientDecisions.js probe.json
//   node tools/selfplay/analyzeOmniscientDecisions.js probe.json --game "91001|Crane|Lion"
//   node tools/selfplay/analyzeOmniscientDecisions.js probe.json --deck CraneHonor
process.env.LOG_LEVEL = 'error';
const fs = require('fs');

const file = process.argv[2];
if(!file) {
    console.error('usage: node tools/selfplay/analyzeOmniscientDecisions.js <probe.json> [--game <key>] [--deck <label>]');
    process.exit(1);
}
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const argOf = (flag) => {
    const idx = process.argv.indexOf(flag);
    return idx > 0 ? process.argv[idx + 1] : undefined;
};
const gameFilter = argOf('--game');
const deckFilter = argOf('--deck');

// The dump carries the treated seat explicitly because BotTelemetry is a global
// sink that records BOTH players. Attributing by seat first is what stops the
// opponent's firings being counted as the cheat's.
const seat = Number(dump.seat ?? 0);
const treatedSeatName = `Seat${seat}`;
const gameByKey = new Map(dump.games.map((game) => [game.game, game]));
const deckOf = (key) => gameByKey.get(key)?.treatedDeck ||
    (seat === 0 ? gameByKey.get(key)?.deckA : gameByKey.get(key)?.deckB) || '?';

const events = dump.events.filter((event) =>
    event.arm === 'treated' &&
    String(event.seat || '') === treatedSeatName &&
    (!gameFilter || event.game === gameFilter) &&
    (!deckFilter || deckOf(event.game) === deckFilter));

// ---------------------------------------------------------------- single game
if(gameFilter) {
    const game = gameByKey.get(gameFilter);
    if(!game) {
        console.error(`no such game in dump: ${gameFilter}`);
        process.exit(1);
    }
    console.log(`GAME ${gameFilter}   treated seat=${treatedSeatName} deck=${deckOf(gameFilter)}`);
    console.log(`  fair arm      winner=${game.control.winner} rounds=${game.control.rounds} reason=${game.control.reason}`);
    console.log(`  omniscient arm winner=${game.treated.winner} rounds=${game.treated.rounds} reason=${game.treated.reason}`);
    console.log(`  outcome: ${game.control.winner === game.treated.winner ? 'SAME winner' : 'FLIPPED'}\n`);
    console.log('omniscient decisions, in order:');
    for(const event of events) {
        if(event.kind !== 'omni-use') {
            continue;
        }
        const mark = event.diverged ? '  *DIVERGED*' : event.gated ? '  (gated off)' : '';
        if(event.site === 'axis') {
            console.log(`  r${event.round} axis          chose=${event.chosen} fair=${event.fair} ` +
                `theirThreat mil=${event.militaryThreat} pol=${event.politicalThreat} ` +
                `oppFate=${event.oppFate} oppHand=${event.oppHandSize}${mark}`);
        } else if(event.site === 'province-target') {
            console.log(`  r${event.round} province      chose=${event.chosen}(str ${event.chosenStrength}) ` +
                `fair=${event.fair}(str ${event.fairStrength}) facedownLeft=${event.facedownTargets}${mark}`);
        } else if(event.site === 'token-defense') {
            console.log(`  r${event.round} tokenDefense  axis=${event.axis} attacker=${event.attackerSkill} ` +
                `+handThreat=${event.handThreat} vs province=${event.provinceStrength}${mark}`);
        } else if(event.site === 'planner-threat') {
            console.log(`  r${event.round} plannerThreat rollout assumes they answer with ` +
                `mil=${event.military} pol=${event.political}; a fair bot assumes ${event.fair}${mark}`);
        }
    }
    console.log('\nattack sizing (omni province strength vs the fair guess):');
    for(const event of events) {
        if(event.kind !== 'attack-size' || !event.omni) {
            continue;
        }
        const delta = Number(event.provinceStrength) - Number(event.fairProvinceStrength);
        console.log(`  r${event.round} ${String(event.axis).padEnd(9)} ` +
            `break=${event.breakTarget} (province ${event.provinceStrength} vs guess ` +
            `${event.fairProvinceStrength}${delta === 0 ? '' : delta > 0 ? ` +${delta}` : ` ${delta}`}, ` +
            `defense ${event.defenseEstimate}, buffer ${event.omniResponseBuffer}) ` +
            `committed=${event.committedCount}/${event.totalEligible} skill=${event.committedSkill}`);
    }
    process.exit(0);
}

// ------------------------------------------------------------------- census
const omniUse = events.filter((event) => event.kind === 'omni-use');
const sites = [...new Set(omniUse.map((event) => event.site))].sort();

console.log(`OMNISCIENT DECISION CENSUS   dump=${file}`);
console.log(`treated seat=${treatedSeatName} bases=${(dump.bases || []).join(',')} ` +
    `games=${dump.games.length}${deckFilter ? ` deck=${deckFilter}` : ''}`);
console.log(`omni=${dump.omni} controlOmni=${dump.controlOmni} change=${dump.change}\n`);

console.log(`${'site'.padEnd(16)} ${'windows'.padStart(8)} ${'gated'.padStart(8)} ` +
    `${'live'.padStart(8)} ${'diverged'.padStart(9)} ${'div/live'.padStart(9)}  games touched`);
for(const site of sites) {
    const rows = omniUse.filter((event) => event.site === site);
    const gated = rows.filter((event) => event.gated).length;
    const live = rows.length - gated;
    const diverged = rows.filter((event) => event.diverged).length;
    const gamesTouched = new Set(rows.filter((event) => event.diverged).map((event) => event.game)).size;
    console.log(`${site.padEnd(16)} ${String(rows.length).padStart(8)} ${String(gated).padStart(8)} ` +
        `${String(live).padStart(8)} ${String(diverged).padStart(9)} ` +
        `${(live > 0 ? `${(100 * diverged / live).toFixed(1)}%` : '-').padStart(9)}  ` +
        `${gamesTouched}/${dump.games.length} (${(100 * gamesTouched / Math.max(1, dump.games.length)).toFixed(1)}%)`);
}

// A gated site is not a weak lever, it is an unreachable one. Say so loudly:
// a full measurement cycle has already been spent here on a mechanism that was
// never called.
const dead = sites.filter((site) => {
    const rows = omniUse.filter((event) => event.site === site);
    return rows.length > 0 && rows.every((event) => event.gated);
});
if(dead.length > 0) {
    console.log(`\nUNREACHABLE for every profile in this run: ${dead.join(', ')}`);
    console.log('  (the site is reached but the profile gate is off — tuning its values cannot move anything)');
}

// ------------------------------------------------------------ planner threat
const plannerThreat = omniUse.filter((event) => event.site === 'planner-threat' && !event.gated);
if(plannerThreat.length > 0) {
    const mean = (key) => (plannerThreat.reduce((sum, event) =>
        sum + (Number(event[key]) || 0), 0) / plannerThreat.length).toFixed(2);
    const zeroFair = plannerThreat.filter((event) => Number(event.fair) === 0).length;
    console.log(`\nplanner threat: ${plannerThreat.length} rollouts priced with the exact hand`);
    console.log(`  mean assumed answer  military ${mean('military')}  political ${mean('political')}`);
    console.log(`  a fair bot would have assumed ZERO in ${zeroFair} of them ` +
        `(${(100 * zeroFair / plannerThreat.length).toFixed(1)}%) — ` +
        'that gap is the caution omniscience adds for free');
}

// -------------------------------------------------------------- attack sizing
const attacks = events.filter((event) => event.kind === 'attack-size' && event.omni);
if(attacks.length > 0) {
    const moved = attacks.filter((event) =>
        Number(event.provinceStrength) !== Number(event.fairProvinceStrength));
    const buffered = attacks.filter((event) => Number(event.omniResponseBuffer) > 0);
    const totalDelta = moved.reduce((sum, event) =>
        sum + (Number(event.provinceStrength) - Number(event.fairProvinceStrength)), 0);
    console.log(`\nattack sizing: ${attacks.length} omniscient declarations`);
    console.log(`  exact province strength differed from the guess-4 fallback in ` +
        `${moved.length} (${(100 * moved.length / attacks.length).toFixed(1)}%), ` +
        `mean shift ${moved.length > 0 ? (totalDelta / moved.length).toFixed(2) : '0.00'} skill`);
    console.log(`  response buffer applied in ${buffered.length} ` +
        `(${(100 * buffered.length / attacks.length).toFixed(1)}%)`);
}

// -------------------------------------------------------------------- per deck
console.log('\nper deck piloted by the TREATED seat — divergence and the paired outcome.');
console.log('These ARE causal: only one seat is treated, so a flip is that deck\'s effect.');
console.log(`${'deck'.padEnd(20)} ${'games'.padStart(5)} ${'div.games'.padStart(9)} ` +
    `${'axis'.padStart(5)} ${'prov'.padStart(5)} ${'flip+'.padStart(5)} ${'flip-'.padStart(5)} ${'net'.padStart(5)}`);
const decks = [...new Set(dump.games.map((game) => game.treatedDeck ||
    (seat === 0 ? game.deckA : game.deckB)))].sort();
let netTotal = 0;
for(const deck of decks) {
    if(deckFilter && deck !== deckFilter) {
        continue;
    }
    const deckGames = dump.games.filter((game) =>
        (game.treatedDeck || (seat === 0 ? game.deckA : game.deckB)) === deck);
    const keys = new Set(deckGames.map((game) => game.game));
    const deckEvents = omniUse.filter((event) => keys.has(event.game));
    const divGames = new Set(deckEvents.filter((event) => event.diverged).map((event) => event.game)).size;
    const axisDiv = deckEvents.filter((event) => event.site === 'axis' && event.diverged).length;
    const provDiv = deckEvents.filter((event) => event.site === 'province-target' && event.diverged).length;
    let to = 0;
    let away = 0;
    for(const game of deckGames) {
        if(game.control.winner === game.treated.winner) {
            continue;
        }
        if(game.treated.winner === treatedSeatName) {
            to++;
        } else {
            away++;
        }
    }
    netTotal += to - away;
    console.log(`${deck.padEnd(20)} ${String(deckGames.length).padStart(5)} ${String(divGames).padStart(9)} ` +
        `${String(axisDiv).padStart(5)} ${String(provDiv).padStart(5)} ${String(to).padStart(5)} ` +
        `${String(away).padStart(5)} ${String(to - away).padStart(5)}`);
}
console.log(`${'TOTAL'.padEnd(20)} ${String(dump.games.length).padStart(5)} ` +
    `${' '.repeat(31)}${String(netTotal).padStart(5)}`);
console.log('\nNOTE: this rig treats ONE seat, so a seat / first-player interaction survives in it.');
console.log('Run SEAT=0 and SEAT=1 and average before believing the size of any number here.');
