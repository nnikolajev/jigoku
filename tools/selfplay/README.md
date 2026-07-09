# Self-Play Harness (seed 3 — learned evaluator)

Headless bot-vs-bot Jigoku games for reinforcement-style training of a
**learned evaluator** (seed 3). The evaluator scores every legal move the bot
already enumerates and the bot picks the argmax — trained from self-play, not a
per-click LLM call (that was seed 2, too slow). See `docs/heuristic-bot.md` for
how the seeds relate.

> **Full record — `docs/seed3-selfplay.md`:** complete design, every attempt,
> why each failed, and the definitive verdict (seed 3 does NOT beat seed 1;
> structural limit of a per-click value picker). Read that before reviving this.

## Pipeline

```
TS harness  ──trajectories.jsonl──▶  python train.py  ──weights.json──▶  TS seed-3 evaluator
 (this dir)       (contract)            (offline, phase 3)                (in-process, phase 4)
```

The game engine only runs in Node, so self-play is always TS. Training may live
in Python (better ML libs); **inference must stay in-process TS** (a dot product
for a linear model, a shallow tree walk for a GBM) so seed 3 never pays a
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
  seed-3 inference so training and inference features never drift. The
  controller emits records via an injected `recorder` (gated — zero cost when
  absent).
- `train.py` — Python trainer (numpy + scikit-learn). Loads the trajectory
  JSONL, trains a gradient-boosted tree ensemble scoring `(state ⊕ option)` →
  P(win), and exports it (plus a logistic fallback) to `weights.json`. Trees
  serialize to plain JSON; no Python at runtime. Writes a `.parity.json` of
  sample rows + sklearn probs for verification.
- `../../server/game/bots/ml/evaluator.ts` — **shipped** seed-3 inference:
  loads `weights.json`, walks the tree ensemble (or the logistic fallback)
  in-process, scores every option, argmax. No native deps.
- `checkParity.js` — verifies the TS tree walk reproduces sklearn's probability
  exactly (`max|TS-sklearn| < 1e-6`).
- `evalMatch.js` — plays the trained bot (seed 3) vs the heuristic (seed 1),
  alternating seats; reports the evaluator's win rate. The real quality gate.
- `generations.js` — iterative self-play RL. Each generation plays with the
  current model (model-vs-model with ε-exploration for coverage + model-vs-
  heuristic for grounding), appends to a replay buffer, retrains, evals vs the
  heuristic, decays ε, and keeps the best weights. This is what lifts the bot
  from "imitates heuristic" toward "beats heuristic".

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
  turn always advances. Seed 3 is thus "heuristic flow + evaluator refinement",
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
```

Full loop: `runTrajectories` → `train.py` → `checkParity` → `evalMatch`. Iterate
by regenerating data, retraining, and re-matching; optionally record seed-3
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
