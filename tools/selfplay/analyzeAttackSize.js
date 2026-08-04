'use strict';
// Reachability + shape check for ATTACKER ALLOCATION.
//
// `applyAttackerPlan` — the phase rollout that commits the smallest set of
// bodies that wins the whole phase, rather than sizing each attack against the
// conflict in front of it — was V2's one measured win (+6.9pp, McNemar
// p=0.00087) and SHIPPED INTO V1 on 2026-07-31. It is `true` in both
// `DEFAULT_CONFLICT_PHASE_PLANNER` and `RUSH_CONFLICT_PHASE_PLANNER`.
//
// "Enabled" is not "reaching". Two sophisticated mechanisms in this codebase
// are inert for V1 with passing specs, so a flag being true in a profile proves
// nothing. This reads `attack-size` telemetry and reports how many declaration
// decisions actually consult the plan, per deck.
//
//   node tools/selfplay/analyzeAttackSize.js probe.json
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const events = data.events.filter((e) => e.kind === 'attack-size' && e.seat === 'Seat0');
if(events.length === 0) {
    console.log('no attack-size events — run probePaired.js with KINDS including attack-size');
    process.exit(0);
}
const num = (v) => Number(v) || 0;
const pct = (a, b) => b > 0 ? `${(100 * a / b).toFixed(1)}%` : '—';

const planned = events.filter((e) => e.usePlannedAttackers);
console.log(`attack-size decisions: ${events.length}`);
console.log(`  rollout consulted (usePlannedAttackers) ${planned.length}  ${pct(planned.length, events.length)}`);
console.log(`  rollout named a next attacker           ${events.filter((e) => e.plannedNext).length}`);
console.log(`  rollout's set already complete          ${events.filter((e) => e.plannedComplete).length}`);
console.log(`  final stronghold push (rollout bypassed) ${events.filter((e) => e.finalStrongholdPush).length}`);
console.log('');

// The over-commitment the rollout exists to remove: skill sent past what the
// break needed, and skill sent into attacks that could not break at all.
const overshoot = events.filter((e) => num(e.committedSkill) > num(e.breakTarget));
const hopeless = events.filter((e) => num(e.potentialSkill) < num(e.breakTarget));
console.log(`  declarations already past the break target ${overshoot.length}  ${pct(overshoot.length, events.length)}`);
console.log(`  declarations that CANNOT reach the break   ${hopeless.length}  ${pct(hopeless.length, events.length)}`);
console.log('');

console.log(`per deck (seat0 pilots deckA)`);
console.log(`  ${'deck'.padEnd(20)} decisions  rollout-used  commitment`);
for(const deck of [...new Set(events.map((e) => e.deckA))].sort()) {
    const own = events.filter((e) => e.deckA === deck);
    const used = own.filter((e) => e.usePlannedAttackers).length;
    const modes = [...new Set(own.map((e) => e.attackCommitment))].join('/');
    console.log(`  ${deck.padEnd(20)} ${String(own.length).padStart(9)}  ` +
        `${String(used).padStart(6)} ${pct(used, own.length).padStart(6)}  ${modes}`);
}
