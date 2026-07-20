# Jigoku bot and self-play commands

Run commands from `jigoku/`. The complete operational notes live in
`tools/selfplay/README.md`.

## Bot seeds

| Seed | Policy |
|---:|---|
| `1` | Fate-aware mixed heuristic; normal default |
| `2` | Original dynasty-focused heuristic |
| `3` | Seed 1 plus omniscient hidden-state evaluation |
| `4` | Seed 1 plus fair board-aware dynasty development |

Adaptive mulligan is the deployed default for all four seeds.

## Build and tests

```powershell
npm run typecheck
npm test
```

## Standard benchmarks

```powershell
# 100 games per challenger deck; challenger seed; Crane seed
node tools/selfplay/winRates.js
node tools/selfplay/winRates.js 100 3 3
node tools/selfplay/winRates.js 40 3 1

# 40 games per deck matchup by default; both seats use the selected seed
node tools/selfplay/botRoundRobin.js
node tools/selfplay/botRoundRobin.js --seed 3 --games 25 --workers 32
```

Only complete standard runs update
`../jigoku-client/client/botBenchmarkResults.json`:

- `winRates.js`: 100 games per deck, all registered decks, same bot/opponent
  seed, adaptive draw policy, no policy override;
- `botRoundRobin.js`: 40 games per matchup, all registered decks, adaptive
  draw policy.

Cross-seed, subset, custom-count, and legacy-policy runs remain diagnostics.

## Mulligan policy comparison

```powershell
# Default: every deck, seeds 1/2/3/4, 20 games per deck and seed
node tools/selfplay/compareMulliganPolicies.js

# Full gate and focused deterministic stream
node tools/selfplay/compareMulliganPolicies.js --games 40 --seeds 1,2,3,4
node tools/selfplay/compareMulliganPolicies.js --games 20 --seeds 4 --decks Crab,Phoenix --rng-seed 20260721
```

The script alternates seats and puts adaptive and frozen legacy mulligan logic
on the same deck and bot seed. It writes Markdown and JSON reports but never
updates client benchmarks. Options:

```text
--games N       games per deck and seed (default 20)
--seeds CSV     subset of 1,2,3,4 (default all)
--decks CSV     registered deck labels (default all)
--rng-seed N    deterministic shuffle base
--out PREFIX    report path without extension
```

The report includes records plus frequent opening-dynasty, opening-conflict,
and regroup discard choices. See `docs/mulligan-bot.md`.

## Click-loop and stall gate

```powershell
node tools/selfplay/validateBotInteractions.js
node tools/selfplay/validateBotInteractions.js --seeds 1,2,3,4 --opponents all --games 2
node tools/selfplay/validateBotInteractions.js --decks Crab,Phoenix --seeds 3 --games 2 --out tools/selfplay/out/mulligan-interactions
```

The audit detects repeated/no-progress clicks, short action cycles, unsupported
prompts, decision-budget exhaustion, stalls, timeouts, and engine errors.

## Other comparisons and diagnostics

```powershell
# Adaptive versus frozen legacy draw bidding
node tools/selfplay/compareDrawBidPolicies.js
node tools/selfplay/drawBidMatrix.js

# Seed 4 versus seed 1 with paired shuffles and alternating seats
node tools/selfplay/compareDynastySeeds.js
node tools/selfplay/compareDynastySeeds.js --games 40 --decks Lion,Unicorn --rng-seed 20260720

# Duel matrix and policy traces
node tools/selfplay/analyzeDuelBids.js
node tools/selfplay/analyzeDuelBids.js --grid
node tools/selfplay/analyzePolicyGame.js --deck PhoenixShugenja --rng-seed 20260715

# Injectable profile A/B
node tools/selfplay/compareProfileVariants.js --deck PhoenixShugenja --opponent Unicorn --seed 3 --games 40 --variants current,ratio-1.5,no-pre-defense

# Card and conflict behavior audits
node tools/selfplay/auditCards.js dragon-attachments 40
node tools/selfplay/auditConflictBehavior.js --games 10 --seed 3
```

Use `--help` where supported for the full option list. Generated diagnostics
belong under `tools/selfplay/out/`.

## Focused deck matches

`matchCraneDuel.js`, `matchDragon.js`, `matchLion.js`,
`matchPhoenix.js`, `matchPhoenixShugenja.js`, `matchScorpion.js`, and
`matchUnicorn.js` use:

```text
node tools/selfplay/<script>.js [games] [challengerSeed] [--trace]
```

Example:

```powershell
node tools/selfplay/matchPhoenixShugenja.js 40 3 --trace
```

## Internal modules

- `harness.js` exposes `runGame(options)`, including
  `drawBidPolicies` and `mulliganPolicies` per seat.
- `deckRegistry.js` owns registered deck labels.
- `standardBenchmark.js` validates and writes standard client results.
- `interactionAudit.js` implements click-cycle detection.
- `_deckWorker.js` and `_roundRobinWorker.js` are child workers; invoke
  their parent commands instead.
