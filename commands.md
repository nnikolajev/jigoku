# Jigoku bot and self-play commands

Run commands from `jigoku/`. The complete operational notes live in
`tools/selfplay/README.md`.

## Bot seeds

| Seed | Policy |
|---:|---|
| `1` | Fate-aware mixed heuristic; normal default |
| `2` | Original dynasty-focused heuristic |
| `3` | Seed 1 plus fair board-aware dynasty development |

Adaptive mulligan is the deployed default for all three seeds. Omniscience is
an independent checkbox/configuration flag available to every seed.

Bot V1 is the stable default. Bot V2 is an independent experimental engine;
selecting V2 does not change the strategy seed or information mode.

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

# Cross-seed audit: seed 3 planner decks versus all seed 1/2 decks
node tools/selfplay/botSeedRoundRobin.js --subject-seed 3 --opponent-seeds 1,2 --games 20 --decks Dragon,Lion,PhoenixShugenja --trace

# Omniscient capability versus the same normal seed
node tools/selfplay/botOmniscientRoundRobin.js --seed 1
node tools/selfplay/botOmniscientRoundRobin.js --seed 3 --games 40 --mirrors-only
```

## Bot V2 comparison, tracing, and tuning

```powershell
# Paired RNG, alternating seats, same seed/deck/information configuration
node tools/selfplay/compareBotVersions.js --candidate-engine v2 --control-engine v1 --v2-mode shadow --seed 1 --mode fair --games 2
node tools/selfplay/compareBotVersions.js --candidate-engine v2 --control-engine v1 --v2-mode enabled --seed 1 --mode omniscient --games 20 --rng-seed 27101 --include-traces

# Mine research traces and preserve deterministic replay fixtures
node tools/selfplay/auditBotRegret.js --input tools/selfplay/out/v2-vs-v1-seed1-fair-enabled.json --out tools/selfplay/out/v2-regret

# V2-aware interaction and semantic/payoff audits
node tools/selfplay/validateBotInteractions.js --engine-version v2 --v2-mode enabled --seeds 1,2,3 --opponents all --games 2
node tools/selfplay/auditCards.js --engine-version v2 --v2-mode enabled --decks all --seeds 1,2,3 --opponents all --modes fair,omniscient --games 2

# Rank bounded, pre-measured coefficient profiles; never edits runtime defaults
node tools/selfplay/tuneBotV2.js --manifest tools/selfplay/v2-tuning-manifest.json --out tools/selfplay/out/v2-tuning
```

`botRoundRobin.js` accepts `--engine-version v1|v2` and `--v2-mode`.
`winRates.js` accepts shared `--engine-version`/`--v2-mode` flags or independent
`--challenger-engine`, `--crane-engine`, `--challenger-v2-mode`, and
`--crane-v2-mode` flags. V1 remains the default, and V2 diagnostic runs cannot
overwrite standardized V1 results.

Only complete standard runs update
`../jigoku-client/client/botBenchmarkResults.json`:

- `winRates.js`: 100 games per deck, all registered decks, same bot/opponent
  seed, adaptive draw policy, no policy override;
- `botRoundRobin.js`: 40 games per matchup, all registered decks, adaptive
  draw policy.
- `botOmniscientRoundRobin.js`: 20 games per ordered matchup, all registered
  decks, same strategy seed, omniscience enabled only for the candidate seat.

Cross-seed, subset, custom-count, and legacy-policy runs remain diagnostics.

`botSeedRoundRobin.js` accepts independent subject/opponent deck subsets,
alternates seats, reuses paired shuffle streams, and writes JSON plus Markdown.
It never updates the client benchmark configuration.

## Mulligan policy comparison

```powershell
# Default: every deck, seeds 1/2/3, 20 games per deck and seed
node tools/selfplay/compareMulliganPolicies.js

# Full gate and focused deterministic stream
node tools/selfplay/compareMulliganPolicies.js --games 40 --seeds 1,2,3
node tools/selfplay/compareMulliganPolicies.js --games 20 --seeds 3 --decks Crab,Phoenix --rng-seed 20260721
```

The script alternates seats and puts adaptive and frozen legacy mulligan logic
on the same deck and bot seed. It writes Markdown and JSON reports but never
updates client benchmarks. Options:

```text
--games N       games per deck and seed (default 20)
--seeds CSV     subset of 1,2,3 (default all)
--decks CSV     registered deck labels (default all)
--rng-seed N    deterministic shuffle base
--out PREFIX    report path without extension
```

The report includes records plus frequent opening-dynasty, opening-conflict,
and regroup discard choices. See `docs/mulligan-bot.md`.

## Conflict planning comparison

```powershell
# Default: every deck, seeds 1/2/3, 20 games per deck and seed
node tools/selfplay/compareConflictPlanning.js

# Smoke and focused fresh-stream confirmation
node tools/selfplay/compareConflictPlanning.js --games 4 --seeds 1,2,3
node tools/selfplay/compareConflictPlanning.js --games 20 --seeds 1 --decks Dragon,Scorpion --rng-seed 20260731
```

This is a same-deck, same-seed, alternating-seat A/B of `lookahead` against
frozen `legacy` conflict declarations. Each two-game seat pair shares its
starting RNG seed. It writes diagnostics only. Options are
`--games`, `--seeds`, `--decks`, `--rng-seed`, and `--out`. See
`docs/conflict-phase-lookahead-bot.md`.

## Click-loop and stall gate

```powershell
node tools/selfplay/validateBotInteractions.js
node tools/selfplay/validateBotInteractions.js --seeds 1,2,3 --opponents all --games 2
node tools/selfplay/validateBotInteractions.js --decks Crab,Phoenix --seeds 3 --games 2 --out tools/selfplay/out/mulligan-interactions
```

The audit detects repeated/no-progress clicks, short action cycles, unsupported
prompts, decision-budget exhaustion, stalls, timeouts, and engine errors.

## Other comparisons and diagnostics

```powershell
# Adaptive versus frozen legacy draw bidding
node tools/selfplay/compareDrawBidPolicies.js
node tools/selfplay/drawBidMatrix.js

# Seed 3 versus seed 1 with paired shuffles and alternating seats
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
  `drawBidPolicies`, `mulliganPolicies`, and `conflictPlanningPolicies` per seat.
- `deckRegistry.js` owns registered deck labels.
- `standardBenchmark.js` validates and writes standard client results.
- `interactionAudit.js` implements click-cycle detection.
- `_deckWorker.js` and `_roundRobinWorker.js` are child workers; invoke
  their parent commands instead.
