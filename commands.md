# Jigoku tool commands

Command reference for `tools/selfplay/`. Run examples from `jigoku/` after compiling TypeScript with `npx tsc`. Self-play uses cached fixtures and disables external LM Studio calls; seed `3` therefore behaves as heuristic fallback unless external planner support is supplied, while seed `4` needs evaluator weights.

## Common values

Deck labels used by label-based commands:

`Crab`, `Crane`, `CraneDuels`, `Dragon`, `DragonAttachments`, `Lion`, `Phoenix`, `PhoenixShugenja`, `Scorpion`, `Unicorn`

Bot seeds:

| Seed | Meaning |
|---:|---|
| `1` | Fate-aware heuristic; normal default. |
| `2` | Old/generic heuristic. |
| `3` | LLM planner; self-play normally measures heuristic fallback. |
| `4` | Learned evaluator; requires weights. |
| `5` | Omniscient heuristic. |

## Quick index

| Command | Purpose |
|---|---|
| `runGames.js` | Run basic headless games and optional game-level JSONL. |
| `runTrajectories.js` | Record per-decision ML trajectories. |
| `train.py` | Train and export learned evaluator. |
| `checkParity.js` | Compare exported model’s JS inference with Python parity samples. |
| `evalMatch.js` | Match learned evaluator against seed 1. |
| `generations.js` | Iterative self-play, replay-buffer training, and evaluation. |
| `botRoundRobin.js` | Full or subset deck round robin. |
| `winRates.js` | Every challenger deck against Crane baseline. |
| `match*.js`, `mirrorCrane.js` | Focused deck-vs-Crane matches. |
| `auditCards.js` | Per-card successful-click utilization audit. |
| `auditConflictBehavior.js` | Focused attack/defense policy audit. |
| `analyzePolicyGame.js` | Paired deterministic policy trace comparison. |
| `compareProfileVariants.js` | Paired deterministic A/B for injectable deck-profile knobs. |
| `analyzeDuelBids.js` | Run the shared duel bid matrix over curated, custom, or 1,200-position grids. |
| `validateBotInteractions.js` | Detect bot click loops, stalls, and budget pressure. |

## Basic self-play and training pipeline

### `runGames.js`

Runs seed-1 mirror games, aggregates outcomes, and optionally writes one full result object per game as JSONL.

```text
node tools/selfplay/runGames.js [count] [--out FILE.jsonl] [--rounds N] [--quiet]
```

| Parameter | Default | Description |
|---|---:|---|
| `count` | `10` | Number of games. Any decimal-digit positional argument sets it. |
| `--out FILE.jsonl` | none | Write one game result per line. Parent directory must already exist. |
| `--rounds N` | `25` | Maximum rounds per game. |
| `--quiet` | off | Suppress per-game progress; final summary still prints. |

```powershell
node tools/selfplay/runGames.js 40 --out tools/selfplay/out/batch.jsonl --rounds 30
node tools/selfplay/runGames.js 500 --quiet
```

### `runTrajectories.js`

Records one JSONL row per genuine decision with two or more options. Also writes sibling `.schema.json` containing state/option feature order. Creates output directory.

```text
node tools/selfplay/runTrajectories.js [count] [--out FILE.jsonl] [--rounds N]
```

| Parameter | Default | Description |
|---|---:|---|
| `count` | `50` | Number of self-play games. |
| `--out FILE.jsonl` | `tools/selfplay/out/trajectories.jsonl` | Training-data output. Schema uses same base name. |
| `--rounds N` | `25` | Maximum rounds per game. |

```powershell
node tools/selfplay/runTrajectories.js 400 --out tools/selfplay/out/trajectories.jsonl
```

### `train.py`

Loads decided trajectory rows, trains gradient-boosted model plus logistic fallback, exports plain JSON weights, and writes `<out>.parity.json` samples.

```text
python tools/selfplay/train.py [--data FILE.jsonl] [--schema FILE.json]
    [--out FILE.json] [--target {military,win}] [--estimators N]
    [--depth N] [--lr RATE]
```

| Parameter | Default | Description |
|---|---:|---|
| `--data FILE.jsonl` | `tools/selfplay/out/trajectories.jsonl` | Trajectory data. |
| `--schema FILE.json` | derived | Feature schema; default replaces data `.jsonl` with `.schema.json`. |
| `--out FILE.json` | `tools/selfplay/out/weights.json` | Exported evaluator weights. |
| `--target military` | `military` | Dense military-shaped reward-to-go regression. |
| `--target win` | — | Terminal win/loss classification. |
| `--estimators N` | `300` | Number of boosting stages/trees. |
| `--depth N` | `3` | Maximum tree depth. |
| `--lr RATE` | `0.08` | Boosting learning rate. |
| `-h`, `--help` | — | Show argparse help. |

Requires `numpy` and `scikit-learn`.

```powershell
python tools/selfplay/train.py --data tools/selfplay/out/trajectories.jsonl --out tools/selfplay/out/weights.json
python tools/selfplay/train.py --target win --estimators 500 --depth 4 --lr 0.05
```

### `checkParity.js`

Loads exported weights and sibling `.parity.json`, then verifies JS tree walking matches Python output within `1e-6`.

```text
node tools/selfplay/checkParity.js [weightsPath]
```

| Parameter | Default | Description |
|---|---:|---|
| `weightsPath` | `tools/selfplay/out/weights.json` | Exported model. Parity input is resolved by replacing `.json` with `.parity.json`. |

Returns `0` for parity OK, `1` for mismatch.

```powershell
node tools/selfplay/checkParity.js tools/selfplay/out/weights.json
```

### `evalMatch.js`

Plays seed-4 learned evaluator against seed-1 heuristic, alternating evaluator seat, then reports decided-game win rate.

```text
node tools/selfplay/evalMatch.js [count] [--weights FILE.json] [--rounds N]
```

| Parameter | Default | Description |
|---|---:|---|
| `count` | `40` | Number of games. |
| `--weights FILE.json` | `tools/selfplay/out/weights.json` | Learned evaluator weights. |
| `--rounds N` | `25` | Maximum rounds per game. |

```powershell
node tools/selfplay/evalMatch.js 100 --weights tools/selfplay/out/weights.json --rounds 30
```

### `generations.js`

Seeds replay buffer from existing trajectories, plays exploratory model-vs-heuristic games, retrains each generation, evaluates, decays exploration, and keeps best weights.

```text
node tools/selfplay/generations.js [--gens N] [--games N] [--eval N]
    [--epsilon RATE] [--buffer FILE.jsonl] [--seed-data FILE.jsonl]
    [--weights FILE.json] [--rounds N]
```

| Parameter | Default | Description |
|---|---:|---|
| `--gens N` | `6` | Training generations. |
| `--games N` | `80` | Data games per generation. |
| `--eval N` | `30` | Evaluation games per generation. |
| `--epsilon RATE` | `0.4` | Initial exploration probability. Internal decay is `0.75`, minimum `0.08`; neither has CLI flag. |
| `--buffer FILE.jsonl` | `tools/selfplay/out/buffer.jsonl` | Replay buffer, overwritten initially from seed data then appended/trimmed. |
| `--seed-data FILE.jsonl` | `tools/selfplay/out/trajectories.jsonl` | Initial trajectories and sibling schema. |
| `--weights FILE.json` | `tools/selfplay/out/weights.json` | Current/best model path. |
| `--rounds N` | `25` | Evaluation round cap. Data-game code currently uses fixed `25`. |

Replay buffer cap is fixed at `400000` rows; generation output directory is fixed at `tools/selfplay/out`.

```powershell
node tools/selfplay/generations.js --gens 6 --games 80 --eval 30 --epsilon 0.4 --buffer tools/selfplay/out/buffer.jsonl --seed-data tools/selfplay/out/trajectories.jsonl
```

## Benchmarks and focused matches

### `botRoundRobin.js`

Plays every unique pair among selected decks. Alternates seats, splits matchups into isolated child jobs, runs bounded parallel pool, and writes Markdown plus JSON report.

```text
node tools/selfplay/botRoundRobin.js [-n|--games N] [-w|--workers N]
    [--chunk-size N] [--seed 1..5] [--decks A,B,...]
    [--out PATH_PREFIX] [-h|--help]
```

| Parameter | Default | Description |
|---|---:|---|
| `-n`, `--games N` | `40` | Games per matchup. |
| `-w`, `--workers N` | `32` | Parallel child processes. |
| `--chunk-size N` | `10` | Games per isolated job, capped at games per matchup. |
| `--seed 1..5` | `1` | Bot mode for both seats. |
| `--decks A,B,...` | all | At least two unique case-sensitive deck labels. |
| `--out PATH_PREFIX` | `tools/selfplay/out/round-robin-latest` | Writes `.md` and `.json`. |
| `-h`, `--help` | — | Show built-in help and deck labels. |

A standard full 40-game same-seed run also updates `../jigoku-client/client/botBenchmarkResults.json`.

```powershell
node tools/selfplay/botRoundRobin.js
node tools/selfplay/botRoundRobin.js --decks Crane,Crab,Lion --games 20
node tools/selfplay/botRoundRobin.js --games 500 --workers 6 --chunk-size 20 --seed 2 --out tools/selfplay/out/seed2
```

### `winRates.js`

Runs every non-Crane registered deck against Crane in parallel child processes, alternates seats, and prints win-rate board.

```text
node tools/selfplay/winRates.js [gamesPerDeck] [botSeed] [craneSeed] [challengerPolicy]
```

| Parameter | Default | Description |
|---|---:|---|
| `gamesPerDeck` | `100` | Games for each challenger deck. |
| `botSeed` | `1` | Challenger seed `1..5`; invalid values fall back to `1`. |
| `craneSeed` | same as `botSeed` | Crane seed `1..5`; invalid values fall back to `1`. |
| `challengerPolicy` | none | Optional `generic` or `fate-aware` policy override for challenger only. Other values are ignored. |

Standard 100-game same-seed run without policy override updates client benchmark results.

```powershell
node tools/selfplay/winRates.js
node tools/selfplay/winRates.js 100 1
node tools/selfplay/winRates.js 100 1 2 fate-aware
```

### `analyzeDuelBids.js`

Runs no game. It executes the same `DuelBidTactics` class used by live bots,
so risk-weight tuning is fast and deterministic. With no position flags it
prints curated equal/behind/ahead, early/late, honor-cliff, honor-victory,
dishonor-pressure, and Iaijutsu cases. Output distinguishes forced-low,
ordinary modeled-utility, and close-duel mind-game decisions. `--grid` covers
1,200 combinations.

```text
node tools/selfplay/analyzeDuelBids.js [--my-skill N]
    [--opponent-skill N] [--my-honor N] [--opponent-honor N]
    [--round N] [--my-master] [--opponent-master]
    [--objective balanced|honor|dishonor] [--set K=V[,K=V...]]
    [--matrix] [--grid] [--json] [--out FILE.json] [-h|--help]
```

| Parameter | Default | Description |
|---|---:|---|
| position values | `5,5,11,11,1` | Exact bot/opponent duel skill, honor, and round for one custom scenario. Supplying any position flag selects custom mode. |
| `--my-master` | off | Bot participant has an attached, **unspent** Iaijutsu Master. |
| `--opponent-master` | off | Opponent participant has an attached, **unspent** Iaijutsu Master. |
| `--objective` | `balanced` | Select generic, honor-race, or dishonor risk weighting. |
| `--set K=V,...` | none | Override any numeric `DuelBidProfile` field; unknown/non-numeric fields fail. |
| `--matrix` | off | Print all 25 win/draw/loss cells and each bid's uniform/modeled win rate, expected honor, utility, and mixed share. |
| `--grid` | off | Analyze 4x4 skill, 5x5 honor, and 3-round combinations (1,200 positions). |
| `--json` | off | Print the complete report as JSON. |
| `--out FILE.json` | none | Also write complete JSON; parent directories are created. |

Read `bid` as the best pure action and `mix E` as the average bid produced by
the seeded mixed strategy. A close duel can intentionally recommend bid 5 but
have a lower `mix E`; that is the anti-exploitation behavior. In grid output,
`decision modes` shows how broadly the wider mind-game mix applies. It should
remain a minority of positions; hopeless, guaranteed, and honor-terminal
positions should remain forced-low or narrow modeled-utility decisions.

Useful mixing overrides are
`mindGameMinimumWinProbability`, `mindGameMaximumWinProbability`,
`mindGameStrategySharpness`, and `mindGameUtilityWindow`. They are numeric and
can be tested through `--set` before changing `DeckProfiles.ts`.

```powershell
node tools/selfplay/analyzeDuelBids.js
node tools/selfplay/analyzeDuelBids.js --my-skill 4 --opponent-skill 5 --my-honor 11 --opponent-honor 4 --round 2 --matrix
node tools/selfplay/analyzeDuelBids.js --grid --set mindGameUtilityWindow=3,mindGameStrategySharpness=0.7
node tools/selfplay/analyzeDuelBids.js --grid --objective dishonor --set duelWinUtility=3,honorSwingUtility=1.4 --out tools/selfplay/out/duel-grid.json
```

### Focused `match*.js` commands

Each command plays named deck against seed-1 Crane, alternating seats and reporting wins/reasons. Same parameter shape:

```text
node tools/selfplay/<command>.js [games] [challengerSeed] [--trace]
```

| Parameter | Default | Description |
|---|---:|---|
| `games` | `20` | Number of games. |
| `challengerSeed` | `1` | Seed `1..5`; invalid/missing value becomes `1`. Source comments emphasize `1`, `2`, and `5`, but parser accepts all five. |
| `--trace` | off | Print histogram of decision reasons and clicked cards. |

Commands:

| File | Challenger |
|---|---|
| `matchCraneDuel.js` | CraneDuels |
| `matchDragon.js` | Dragon |
| `matchLion.js` | Lion |
| `matchPhoenix.js` | Phoenix |
| `matchPhoenixShugenja.js` | PhoenixShugenja |
| `matchScorpion.js` | Scorpion |
| `matchUnicorn.js` | Unicorn |

```powershell
node tools/selfplay/matchDragon.js 100 5
node tools/selfplay/matchPhoenixShugenja.js 20 1 --trace
```

### `mirrorCrane.js`

True same-deck comparison: Crane precon seed `5` (“Omni”) versus Crane precon seed `1`, alternating seats.

```text
node tools/selfplay/mirrorCrane.js [games] [--trace]
```

| Parameter | Default | Description |
|---|---:|---|
| `games` | `20` | Number of games. |
| `--trace` | off | Print Omni decision-reason/card-click histogram. |

Source usage comment mentions `[omniSeed]`, but implementation hard-codes Omni seed `5`; a second positional seed has no effect.

```powershell
node tools/selfplay/mirrorCrane.js 100 --trace
```

## Audits and policy diagnostics

### `auditCards.js`

Runs selected fixture deck against Crane and reports successful clicks/reasons for every card, highlighting cards with zero clicks.

```text
node tools/selfplay/auditCards.js <deck> [games]
```

| Parameter | Default | Description |
|---|---:|---|
| `deck` | required | Fixture name: `unicorn`, `crab`, `scorpion`, `lion`, `phoenix`, `phoenix-shugenja`, `dragon`, `dragon-attachments`, or `craneduel`. Values are lowercase and differ from registry labels. |
| `games` | `20` | Number of games. |

```powershell
node tools/selfplay/auditCards.js dragon-attachments 40
```

### `auditConflictBehavior.js`

Runs real games and reports attack opportunities/passes, defender declarations, and card spending while stronghold is attacked.

```text
node tools/selfplay/auditConflictBehavior.js [--games N] [--seed 1..5]
    [--opponent LABEL] [--opponent-seed 1..5]
    [--decks A,B,...] [--rng-seed N]
```

| Parameter | Default | Description |
|---|---:|---|
| `--games N` | `5` | Games per target deck. |
| `--seed 1..5` | `1` | Target bot seed. |
| `--opponent LABEL` | `Crane` | Opponent deck label. |
| `--opponent-seed 1..5` | target seed | Opponent bot seed. |
| `--decks A,B,...` | all | Comma-separated target deck labels. |
| `--rng-seed N` | `20260717` | Deterministic base random seed. |

```powershell
node tools/selfplay/auditConflictBehavior.js --games 10 --seed 5
node tools/selfplay/auditConflictBehavior.js --decks Dragon,Lion --opponent Crane --rng-seed 42
```

### `analyzePolicyGame.js`

Runs control and candidate games using identical deterministic random stream, deck/seat order, and bot seeds. Writes full JSON trace plus Markdown diagnostics.

```text
node tools/selfplay/analyzePolicyGame.js [options]
```

| Parameter | Default | Description |
|---|---:|---|
| `--deck LABEL` | `PhoenixShugenja` | Challenger deck. |
| `--opponent LABEL` | `Crane` | Opponent deck; must differ from challenger. |
| `--control POLICY` | `generic` | Control challenger policy: `generic` or `fate-aware`. |
| `--candidate POLICY` | `fate-aware` | Candidate challenger policy. |
| `--opponent-policy POLICY` | `generic` | Opponent policy in both games. |
| `--bot-seed N` | `1` | Challenger seed. |
| `--opponent-seed N` | `1` | Opponent seed. |
| `--rng-seed N` | `20260715` | Shared deterministic shuffle seed. |
| `--challenger-second` | off | Put challenger in second seat in both games. |
| `--max-rounds N` | `25` | Per-game round cap. |
| `--max-game-ms N` | `30000` | Per-game wall-clock cap in milliseconds. |
| `--late-round N` | `3` | First round where board-size target diagnostics apply. |
| `--min-board N` | `3` | Minimum late-round conflict board target. |
| `--out PATH_PREFIX` | generated under `out/` | Write `PATH_PREFIX.json` and `.md`. |
| `-h`, `--help` | — | Show built-in help, deck labels, and policies. |

```powershell
node tools/selfplay/analyzePolicyGame.js --deck PhoenixShugenja --control generic --candidate fate-aware --rng-seed 20260715
node tools/selfplay/analyzePolicyGame.js --deck Lion --opponent Crane --challenger-second --out tools/selfplay/out/lion-policy
```

### `compareProfileVariants.js`

Runs the target deck repeatedly with identical shuffle, seat, and random stream
while changing only selected injectable profile knobs. The opponent always uses
the current profile. This is a diagnostic run and never updates client benchmark
results.

```text
node tools/selfplay/compareProfileVariants.js [--deck LABEL]
    [--opponent LABEL] [--seed 1..5] [--games N]
    [--variants CSV] [--rng-seed N] [--out PATH_PREFIX]
```

Built-in variants are `current`, `no-pre-defense`, `legacy-province`,
`legacy-both`, `no-eminent`, and `no-ability-priority`. Parameterized variants
are `ratio-N` and `public-forum-N`.

```powershell
node tools/selfplay/compareProfileVariants.js --deck PhoenixShugenja --opponent Unicorn --seed 5 --games 40 --variants current,ratio-1.5,no-pre-defense --out tools/selfplay/out/shugenja-profile-ab
```

### `validateBotInteractions.js`

Instruments both controllers and fails runs with repeated state/action cycles, unchanged-state click runs, repeated prompt/action bursts, unsupported prompts, forced progress, budget exhaustion, stalls, timeouts, step caps, or engine errors. Writes `.json` and `.md`.

```text
node tools/selfplay/validateBotInteractions.js [options]
```

| Parameter | Default | Description |
|---|---:|---|
| `--games N` | `1` | Games per deck/opponent/seed combination. |
| `--seeds CSV` | `1,2,5` | Comma-separated subset of `1..5`. |
| `--decks CSV|all` | `all` | Decks under audit. |
| `--opponents CSV|all` | `Crane` | Opponent decks. |
| `--rng-seed N` | `20260716` | Deterministic base random seed. |
| `--max-rounds N` | `25` | Per-game round cap. |
| `--max-game-ms N` | `30000` | Per-game wall cap in milliseconds. |
| `--click-cap N` | `35` | Maximum decisions in one controller tick. |
| `--rejected-cap N` | `3` | Allowed rejected probes per bot/game; may be zero. |
| `--no-progress-clicks N` | `4` | Unchanged-state run threshold. |
| `--repeated-action-clicks N` | `5` | Same prompt/action run threshold. |
| `--min-cycle-repeats N` | `3` | Periodic-cycle repeat threshold. |
| `--max-cycle-period N` | `8` | Longest detected cycle period. |
| `--out PATH_PREFIX` | `tools/selfplay/out/bot-interactions-latest` | Writes `.json` and `.md`. |
| `-h`, `--help` | — | Show built-in help and deck labels. |

```powershell
node tools/selfplay/validateBotInteractions.js
node tools/selfplay/validateBotInteractions.js --games 5 --seeds 1,2,5
node tools/selfplay/validateBotInteractions.js --opponents all --games 2 --out tools/selfplay/out/all-opponents
node tools/selfplay/validateBotInteractions.js --decks Lion --opponents all --games 1 --seeds 1,2,5 --out tools/selfplay/out/lion-attachments-all-opponents-click-audit
node tools/selfplay/validateBotInteractions.js --decks Unicorn --opponents all --games 1 --seeds 1,2,5 --out tools/selfplay/out/unicorn-all-opponents-click-audit
```

The Lion-specific example is the regression audit for Elegant Tessen and True
Strike Kenjutsu. It covers every registered opponent on seeds 1, 2, and 5;
inspect `topInteractions` in the JSON report to confirm setup card use, while
the policy specs prove the gained True Strike Action and exact base-skill gate
deterministically.

The Unicorn-specific audit covers Golden Plains Outpost, Ride On, and Adorned
Barcha movement across every registered opponent. Use the focused specs and a
25-game-per-matchup tuning matrix together:

```powershell
npm run jasmine -- --filter="Unicorn"
node tools/selfplay/matchUnicorn.js 50 1 --trace
node tools/selfplay/botRoundRobin.js --games 25 --workers 32 --seed 1 --out tools/selfplay/out/unicorn-round-robin
```

The 25-game round robin is a tuning run. Only the complete default 40-game run
updates `jigoku-client/client/botBenchmarkResults.json`.

## Internal modules and workers

These files live in `tools/selfplay/` but are not normal user-facing commands.

| File | Role / parameters |
|---|---|
| `_deckWorker.js` | Internal `winRates.js` child. Positional inputs: `deckLabel games botSeed craneSeed challengerPolicy`; emits one JSON object per game. Use parent command. |
| `_roundRobinWorker.js` | Internal `botRoundRobin.js` child. Positional inputs: `leftLabel rightLabel games botSeed startIndex`; emits one JSON object per game. Use parent command. |
| `deckLoader.js` | Library for loading cached deck/card fixtures; no CLI. |
| `deckRegistry.js` | Case-sensitive deck-label registry; no CLI. |
| `harness.js` | Exports headless `runGame`, game/controller builders, and evaluator loader; no CLI. |
| `interactionAudit.js` | Interaction instrumentation and cycle-analysis helpers; no CLI. |
| `reward.js` | Reward tracking and default reward weights; no CLI. |
| `standardBenchmark.js` | Read/merge/write helpers for client benchmark results; no CLI. |

`fixtures/` contains cached inputs. `out/` contains generated reports/models/data. Neither folder contains commands.
