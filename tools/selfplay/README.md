# Jigoku self-play tools

These scripts run real headless Jigoku games with normal game commands. They
are for policy comparison, regression diagnosis, benchmark publication, and
click-cycle detection. No external model service is needed.

## Supported bot seeds

| Seed | Policy |
|---:|---|
| 1 | Fate-aware mixed heuristic (default) |
| 2 | Original dynasty-focused heuristic |
| 3 | Seed 1 plus omniscient hidden-state logic |
| 4 | Seed 1 plus fair board-aware dynasty development |

Adaptive mulligan is the default for all four seeds. The former omniscient
seed 5 was renumbered to 3; old LLM/evaluator experiments were removed.

## Main commands

Run commands from `jigoku/`.

```powershell
# TypeScript and full server tests
npm run typecheck
npm test

# Win rates versus Crane Baseline: games, challenger seed, Crane seed
node tools/selfplay/winRates.js
node tools/selfplay/winRates.js 100 3 3
node tools/selfplay/winRates.js 40 3 1

# All deck pairs; 40 games per matchup by default
node tools/selfplay/botRoundRobin.js
node tools/selfplay/botRoundRobin.js --seed 3 --games 25 --workers 32

# Same-deck adaptive mulligan versus explicit frozen legacy behavior
node tools/selfplay/compareMulliganPolicies.js
node tools/selfplay/compareMulliganPolicies.js --games 40 --seeds 1,2,3,4 --decks Crab,Phoenix

# Same-deck paired seed-4 dynasty planner versus seed 1
node tools/selfplay/compareDynastySeeds.js
node tools/selfplay/compareDynastySeeds.js --games 40 --decks Lion,Unicorn

# Adaptive draw bidding versus frozen legacy behavior
node tools/selfplay/compareDrawBidPolicies.js

# Detect repeated/no-progress clicks, budget exhaustion, and stalls
node tools/selfplay/validateBotInteractions.js
node tools/selfplay/validateBotInteractions.js --seeds 1,2,3,4 --opponents all --games 2

# Deterministic deep comparison and focused diagnostics
node tools/selfplay/analyzePolicyGame.js --deck PhoenixShugenja --rng-seed 20260715
node tools/selfplay/compareProfileVariants.js --deck PhoenixShugenja --opponent Unicorn --seed 3 --games 40 --variants current,ratio-1.5,no-pre-defense
node tools/selfplay/auditCards.js Crane 20 3 PhoenixShugenja
node tools/selfplay/auditConflictBehavior.js --seed 3
node tools/selfplay/analyzeDuelBids.js
node tools/selfplay/drawBidMatrix.js
```

Use `--help` on a script for its complete option list.

## Mulligan A/B

`compareMulliganPolicies.js` is the quality gate for `MulliganTactics`.
Adaptive and legacy seats use the same deck and same bot seed, with seats
alternating. The default covers every registered deck on seeds 1, 2, 3, and 4.
It writes Markdown and JSON under `tools/selfplay/out/` and never updates the
client benchmark configuration.

The report includes:

- adaptive/legacy record per seed and deck;
- aggregate record;
- the most frequent adaptive mulligan/discard selections, grouped by policy
  reason and card name.

Use a small all-seed run for smoke coverage, then a larger focused run. Use
`--rng-seed` to confirm a tuned outlier on a fresh shuffle stream.

## Seed-4 dynasty A/B

`compareDynastySeeds.js` holds deck and shuffle pair constant, alternates
seats, and compares seed 4 directly with seed 1. Reports include records and
traced generic/board-aware purchase and additional-fate reasons. It never
updates client benchmark configuration.

## Standard client benchmarks

`winRates.js` defaults to 100 games per deck. Its positional arguments are:

```text
node tools/selfplay/winRates.js number_of_games seed_for_bots seed_for_crane_opponent
```

The Crane seed defaults to the challenger seed. `botRoundRobin.js` defaults to
40 games per matchup and makes both bots use its selected seed.

Only standardized runs update
`../jigoku-client/client/botBenchmarkResults.json`:

- win rates: 100 games, complete registered deck set, same seed, adaptive draw
  policy, no policy override;
- round robin: 40 games per matchup, complete registered deck set, adaptive
  draw policy;
- current standardized suite id and no failed/incomplete jobs.

Custom counts, deck subsets, cross-seed opponents, legacy draw policy, and
profile overrides remain diagnostic and never replace client results.

## Interaction audit

`validateBotInteractions.js` instruments both bot seats and fails on:

- periodic state/action cycles;
- unchanged-state click runs;
- repeated identical prompt/action bursts;
- unsupported prompts or forced-progress recovery;
- controller decision-budget exhaustion;
- stalls, timeouts, step caps, or engine errors.

Defaults cover all registered decks, seeds 1–4, and Crane as opponent. Reports
are written as JSON and Markdown. Use `--opponents all` for the broadest gate.

## Harness

`harness.js` exports `runGame(options)`. Important options include `names`,
`seeds`, `policies`, `drawBidPolicies`, `mulliganPolicies`, `deckA`, `deckB`,
`trace`, and `onControllers`. Every deployed seed defaults to adaptive
mulligan; an explicit `mulliganPolicies` pair lets the A/B script compare it
with frozen legacy logic.

`deckRegistry.js` is the source of truth for registered labels. `deckLoader.js`
loads cached EmeraldDB fixtures. `reward.js` observes game events and terminal
state. `standardBenchmark.js` validates and writes standardized client results.

## Output hygiene

Named reports belong in `tools/selfplay/out/`. These are diagnostics, not source
fixtures. Preserve useful reports with an explicit `--out` prefix; the default
`latest` reports may be overwritten.
