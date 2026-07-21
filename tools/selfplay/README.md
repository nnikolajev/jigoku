# Jigoku self-play tools

These scripts run real headless Jigoku games with normal game commands. They
are for policy comparison, regression diagnosis, benchmark publication, and
click-cycle detection. No external model service is needed.

## Supported bot seeds

| Seed | Policy |
|---:|---|
| 1 | Fate-aware mixed heuristic (default) |
| 2 | Original dynasty-focused heuristic |
| 3 | Seed 1 plus fair board-aware dynasty development |

Adaptive mulligan is the default for all three seeds. Omniscience is an
independent capability that can be enabled for any seed.

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

# Seed 3 planner-enabled decks against every seed-1/seed-2 deck
node tools/selfplay/botSeedRoundRobin.js --subject-seed 3 --opponent-seeds 1,2 --games 20 --decks Dragon,Lion,PhoenixShugenja --trace

# Same-deck adaptive mulligan versus explicit frozen legacy behavior
node tools/selfplay/compareMulliganPolicies.js
node tools/selfplay/compareMulliganPolicies.js --games 40 --seeds 1,2,3 --decks Crab,Phoenix

# Same-deck paired seed-3 dynasty planner versus seed 1
node tools/selfplay/compareDynastySeeds.js
node tools/selfplay/compareDynastySeeds.js --games 40 --decks Lion,Unicorn

# Optional omniscience versus the same normal strategy
node tools/selfplay/botOmniscientRoundRobin.js --seed 1
node tools/selfplay/botOmniscientRoundRobin.js --seed 3 --games 40 --mirrors-only

# Adaptive draw bidding versus frozen legacy behavior
node tools/selfplay/compareDrawBidPolicies.js

# Detect repeated/no-progress clicks, budget exhaustion, and stalls
node tools/selfplay/validateBotInteractions.js
node tools/selfplay/validateBotInteractions.js --seeds 1,2,3 --opponents all --games 2

# Deterministic deep comparison and focused diagnostics
node tools/selfplay/analyzePolicyGame.js --deck PhoenixShugenja --rng-seed 20260715
node tools/selfplay/compareProfileVariants.js --deck PhoenixShugenja --opponent Unicorn --seed 3 --games 40 --variants current,ratio-1.5,no-pre-defense
node tools/selfplay/auditCards.js Crane 20 3 PhoenixShugenja
node tools/selfplay/auditCards.js --decks all --seeds 1,2,3 --opponents all --modes fair,omniscient --games 2
node tools/selfplay/auditConflictBehavior.js --seed 3
node tools/selfplay/analyzeDuelBids.js
node tools/selfplay/drawBidMatrix.js
```

Use `--help` on a script for its complete option list.

`auditCards.js` has two interfaces. The positional command is the quick legacy
single-deck check. The option form is the all-card quality gate. It records
deck-card availability separately from semantic source activations, so a
mulligan, attacker/defender selection, or effect-target click cannot falsely
prove that a card was played. The generated JSON and Markdown contain plays,
non-forced abilities, raw clicks, availability, zero-use candidates, failures,
and stalls. Reports first aggregate every selected seed/information mode by
deck (the durable "dead everywhere" result), then retain per-row sampling
detail. An in-play card with no activation is an investigation candidate, not
proof that a conditional Reaction's trigger occurred. Use
`--fail-on-candidates` in CI after choosing a suitable `--minimum-seen` sample
threshold.

## Mulligan A/B

`compareMulliganPolicies.js` is the quality gate for `MulliganTactics`.
Adaptive and legacy seats use the same deck and same bot seed, with seats
alternating. The default covers every registered deck on seeds 1, 2, and 3.
It writes Markdown and JSON under `tools/selfplay/out/` and never updates the
client benchmark configuration.

The report includes:

- adaptive/legacy record per seed and deck;
- aggregate record;
- the most frequent adaptive mulligan/discard selections, grouped by policy
  reason and card name.

Use a small all-seed run for smoke coverage, then a larger focused run. Use
`--rng-seed` to confirm a tuned outlier on a fresh shuffle stream.

## Seed-3 dynasty A/B

`compareDynastySeeds.js` holds deck and shuffle pair constant, alternates
seats, and compares seed 3 directly with seed 1. Reports include records and
traced generic/board-aware purchase and additional-fate reasons. It never
updates client benchmark configuration.

## Cross-seed deck pool

`botSeedRoundRobin.js` makes every selected subject deck play every selected
opponent deck on each requested opponent seed. Seats alternate and each pair
reuses a deterministic shuffle stream. It reports per-deck, per-opponent-seed,
and aggregate records, with an optional successful-decision trace. These runs
are diagnostics and never update client benchmark results.

```powershell
node tools/selfplay/botSeedRoundRobin.js --subject-seed 3 --opponent-seeds 1,2 --games 20 --decks Dragon,Lion,PhoenixShugenja --trace
node tools/selfplay/botSeedRoundRobin.js --subject-seed 3 --opponents Phoenix,Scorpion --decks PhoenixShugenja --games 40
```

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
- omniscient: 20 games per ordered deck matchup, complete registered deck set,
  same strategy seed on both seats, only one seat omniscient;
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

Defaults cover all registered decks, seeds 1-3, and Crane as opponent. Reports
are written as JSON and Markdown. Use `--opponents all` for the broadest gate.

## Harness

`harness.js` exports `runGame(options)`. Important options include `names`,
`seeds`, `policies`, `drawBidPolicies`, `mulliganPolicies`, `deckA`, `deckB`,
`omniscient`, `trace`, and `onControllers`. Every deployed seed defaults to adaptive
mulligan; an explicit `mulliganPolicies` pair lets the A/B script compare it
with frozen legacy logic.

`deckRegistry.js` is the source of truth for registered labels. `deckLoader.js`
loads cached EmeraldDB fixtures. `reward.js` observes game events and terminal
state. `standardBenchmark.js` validates and writes standardized client results.

## Output hygiene

Named reports belong in `tools/selfplay/out/`. These are diagnostics, not source
fixtures. Preserve useful reports with an explicit `--out` prefix; the default
`latest` reports may be overwritten.
