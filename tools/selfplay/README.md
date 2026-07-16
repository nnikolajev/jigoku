# Self-Play Harness (seed 4 — learned evaluator)

Headless bot-vs-bot Jigoku games for reinforcement-style training of a
**learned evaluator** (seed 4). The evaluator scores every legal move the bot
already enumerates and the bot picks the argmax — trained from self-play, not a
per-click LLM call (that is seed 3, too slow). See `docs/heuristic-bot.md` for
how the seeds relate.

> **Full record — `docs/seed3-selfplay.md`:** complete design, every attempt,
> why each failed, and the definitive verdict (the evaluator does NOT beat the
> heuristic; structural limit of a per-click value picker). Read that before
> reviving this.

## Pipeline

```
TS harness  ──trajectories.jsonl──▶  python train.py  ──weights.json──▶  TS seed-4 evaluator
 (this dir)       (contract)            (offline, phase 3)                (in-process, phase 4)
```

The game engine only runs in Node, so self-play is always TS. Training may live
in Python (better ML libs); **inference must stay in-process TS** (a dot product
for a linear model, a shallow tree walk for a GBM) so seed 4 never pays a
per-click round trip.

## Files

- `deckLoader.js` — builds the Jigoku deck object (the shape `game.selectDeck`
  consumes) from an EmeraldDB decklist + card data. Offline: reads cached
  fixtures. `loadUnicornDeck()` returns the aggressive Unicorn Cavalry precon.
- `reward.js` — `RewardTracker` attaches to the game's EventEmitter
  (`onConflictFinished`, `onBreakProvince`) and reads honor / terminal outcome
  off final state. Weights (`DEFAULT_WEIGHTS`) are the single tuning board:
  conflicts won, provinces broken, stronghold = goal, opponent honor driven
  toward 0, own honor toward 20.
- `harness.js` — `runGame(options)` runs one full game with two
  `JigokuBotController` seats (seed 1, LLM disabled ⇒ synchronous). Progress-
  based stall detection ends broken games gracefully.
- `runGames.js` — CLI: run N games, aggregate outcomes, write per-game JSONL.
- `runTrajectories.js` — CLI: run N games and stream **per-decision** training
  data (the real Phase-2 output). One JSONL line per genuine (≥2-option)
  decision + a sibling `<out>.schema.json` naming the feature columns.
- `../../server/game/bots/ml/features.ts` — **shipped** feature extraction
  (`stateFeatures` / `optionFeatures`), used by both the recorder here and
  seed-4 inference so training and inference features never drift. The
  controller emits records via an injected `recorder` (gated — zero cost when
  absent).
- `train.py` — Python trainer (numpy + scikit-learn). Loads the trajectory
  JSONL, trains a gradient-boosted tree ensemble scoring `(state ⊕ option)` →
  P(win), and exports it (plus a logistic fallback) to `weights.json`. Trees
  serialize to plain JSON; no Python at runtime. Writes a `.parity.json` of
  sample rows + sklearn probs for verification.
- `../../server/game/bots/ml/evaluator.ts` — **shipped** seed-4 inference:
  loads `weights.json`, walks the tree ensemble (or the logistic fallback)
  in-process, scores every option, argmax. No native deps.
- `checkParity.js` — verifies the TS tree walk reproduces sklearn's probability
  exactly (`max|TS-sklearn| < 1e-6`).
- `evalMatch.js` — plays the trained bot (seed 4) vs fate-aware seed 1,
  alternating seats; reports the evaluator's win rate. The real quality gate.
- `generations.js` — iterative self-play RL. Each generation plays with the
  current model (model-vs-model with ε-exploration for coverage + model-vs-
  heuristic for grounding), appends to a replay buffer, retrains, evals vs the
  heuristic, decays ε, and keeps the best weights. This is what lifts the bot
  from "imitates heuristic" toward "beats heuristic".

- `botRoundRobin.js` compares every available deck against every other deck,
  alternating seats and writing a matchup matrix plus per-deck averages to
  Markdown and JSON. Small isolated jobs run through a bounded parallel pool.
  The `DragonAttachments` label loads the cached EmeraldDB 46aaa220 Arsenal
  fixture and its dedicated Iron Mountain Castle tower profile.

### Seed-3 controller design (why it does not just argmax raw options)

A win-probability model is a good *ranker* but a poor *controller* — it has no
notion of game flow, so on its own it re-picks non-advancing moves and stalls.
Two guards in `evaluatorPick` make it usable:
- **Strategic-phase gating** — the evaluator only steers `conflict` / `dynasty`
  decisions; setup, mulligan, bidding and end-of-round phases defer wholly to
  the heuristic (they carry no strategic weight and their prompts are shaped in
  ways the evaluator cannot satisfy).
- **Bounded override + heuristic deferral** — per prompt the evaluator gets at
  most 3 tries (anti-loop, keyed on the normalized prompt signature); after that
  it defers to the heuristic option (always appended as the fall-back), so the
  turn always advances. Seed 4 is thus "heuristic flow + evaluator refinement",
  never a raw argmax that can livelock.
- `fixtures/` — cached EmeraldDB decklist + trimmed card data (no network at
  run time). Refresh with the EmeraldDB API (`/api/decklists/<uuid>`,
  `/api/cards`).

## Usage

```bash
# from jigoku/, after `npx tsc`
# game-level outcomes (fast, ~256ms/game)
node tools/selfplay/runGames.js 40 --out tools/selfplay/out/batch.jsonl

# per-decision training data for the evaluator (slower — features per move)
node tools/selfplay/runTrajectories.js 400 --out tools/selfplay/out/trajectories.jsonl

# train the evaluator (Python), verify TS parity, test vs the heuristic
python tools/selfplay/train.py --data tools/selfplay/out/trajectories.jsonl --out tools/selfplay/out/weights.json
node tools/selfplay/checkParity.js tools/selfplay/out/weights.json
node tools/selfplay/evalMatch.js 40 --weights tools/selfplay/out/weights.json

# all deck pairs, 100 games per matchup (default), parallel workers auto-sized
node tools/selfplay/botRoundRobin.js

# old heuristic on both seats (seed 1 fate-aware is the default)
node tools/selfplay/botRoundRobin.js --seed 2

# larger sample or explicit concurrency
node tools/selfplay/botRoundRobin.js --games 500 --workers 6

# compare deck win rates; defaults are 100 games and same-seed Crane
node tools/selfplay/winRates.js 100 1    # fate-aware vs fate-aware
node tools/selfplay/winRates.js 100 2    # old heuristic vs old heuristic
node tools/selfplay/winRates.js 100 1 2  # fate-aware vs old heuristic Crane

# paired deterministic deep trace: same shuffle/seat, generic vs fate-aware
node tools/selfplay/analyzePolicyGame.js --deck PhoenixShugenja --rng-seed 20260715

# all-deck interaction-cycle audit for deployed offline bot seeds
node tools/selfplay/validateBotInteractions.js

# broader repeat coverage or every opposing deck
node tools/selfplay/validateBotInteractions.js --games 5 --seeds 1,2,5
node tools/selfplay/validateBotInteractions.js --opponents all --games 2
```

`analyzePolicyGame.js` runs one control game and one candidate game with the
same deterministic random stream, deck order, seat order, and bot seeds. It
writes a Markdown comparison and full JSON trace under `tools/selfplay/out/`.
The trace includes every challenger decision with pre-decision fate, hand,
board, provinces, rings, and conflict state, plus conflict/break events and
game messages. The Markdown report automatically flags missing dynasty-cost
hints, zero-funded strong characters, and rounds that miss the expected board
size; `--late-round` and `--min-board` configure that board target. Use `--help`
to select any registered deck, opponent, policies, seat, seed, caps, or output
prefix.

Round-robin reports default to `tools/selfplay/out/round-robin-latest.md` and
`.json`. Use `--out <path-prefix>` to preserve named runs, `--decks A,B,C` for a
subset, and `--help` for all options. Win rates exclude undecided games;
`average vs opponents` gives each opposing deck equal weight.

A complete standard run also updates
`../jigoku-client/client/botBenchmarkResults.json`, which the bot deck/seed
selector reads. Standard means 100 games, alternating seats, same bot seed on
both sides, and the full registered deck set for round robin. `winRates.js`
requires no policy override and defaults the Crane seed to the challenger seed;
its third argument remains available for cross-seed experiments. Custom game
counts, cross-seed opponents, policy overrides, deck subsets, and incomplete
runs never replace the client baseline. Worker count, chunk size, and report
output path do not change gameplay and may be customized during a standard run.
Self-play disables external LM Studio calls, so seed 3 measurements describe its
heuristic fallback and are labeled that way in the generated config.

`validateBotInteractions.js` audits every configured deck independently from
win rate and instruments both bot seats in every game. It fingerprints pre-click
game state and fails on repeated state/action cycles, unchanged-state click runs,
identical prompt/action bursts, unsupported
prompts, forced-progress recovery, controller decision-budget exhaustion,
stalls, timeouts, step caps, or engine errors. Isolated rejected probes are
warnings until `--rejected-cap`; all thresholds and output paths are CLI
options. Default seeds are 1, 2, and 5 because they run fully offline. Seed 3
needs a live LLM planner and seed 4 needs evaluator weights, so selecting those
without their external services validates only their heuristic fallback.

Full loop: `runTrajectories` → `train.py` → `checkParity` → `evalMatch`. Iterate
by regenerating data, retraining, and re-matching; optionally record seed-4
self-play (the controller records any seat) to bootstrap the next generation.

`runGames` JSONL line = one game: `{winner, winReason, stopReason, rounds,
steps, decisions, elapsedMs, reward:{<name>:{counts, ownHonor, oppHonor, parts,
total, won}}}`. `stopReason` is `decided` for a real win; `stalled` /
`round-cap` / `step-cap` flag games to drop from training data.

`runTrajectories` JSONL line = one decision:
`{gameId, player, round, promptTitle, menuTitle, state:number[],
options:number[][], optionLabels:[], chosenIndex, chosenReason, won, return,
decided}`. `state` follows `stateSchema` (39 features), each `options[i]`
follows `optionSchema` (19 features) — both in the sibling `.schema.json`.
`return` = the player's terminal reward (Monte-Carlo credit; v1). Train on
`decided` games; the state feature `isConflictPhase` filters to conflict
decisions (~70% of records) where the deck's play lives.

## Notes

- ~250 ms/game single-threaded (seed 1, no LLM). ~14k games/hour.
- Both seats share the Unicorn deck by default (mirror match). Pass
  `options.deckA` / `deckB` to vary.
- Reward is deterministic given the final state; play is not (deck shuffle +
  heuristic tie-breaks vary per run).
- A stuck seat now force-passes (controller safety valve) instead of freezing —
  see `JigokuBotController.forceProgress` / `stableSignature`.
