# Seed 3 — Self-Play Learned Evaluator (full record)

> **Renumbering note (2026-07-15):** this historical record uses the original
> seed numbers. The learned evaluator is now seed 4, the LLM is seed 3, the old
> generic heuristic is seed 2, and fate-aware is the default seed 1.

> **Status: experimental, NOT competitive.** Seed 3 does **not** beat the seed-1
> heuristic. It is gated (opt-in) and does not affect live play. This document
> records the complete design, every attempt, why each failed, and how to run
> the whole pipeline so a future effort does not repeat the dead ends.

The seeds:

| Seed | Bot | Runtime cost | Verdict |
|------|-----|-------------|---------|
| 1 | Hand-written heuristic policy | in-process, synchronous | **strongest bot; ship this** |
| 2 | LLM picks every click (LM Studio) | per-click round trip | slow + weak decisions (rejected) |
| 3 | Learned evaluator (self-play ML) | in-process tree walk | built + validated infra, but **loses to seed 1** |

---

## 1. Concept

Seed 3 is a **learned evaluator**, not a policy network. Self-play trains a model
that scores a `(state ⊕ option)` feature vector; at inference the bot enumerates
every legal move it already knows (`JigokuBotController.enumerateOptions`), scores
each, and takes the **argmax**. Inference is a shallow gradient-boosted-tree walk
in-process — no Python at runtime, no per-click round trip (that was seed 2's
fatal slowness).

Chosen over the alternatives on purpose:
- **Deep RL (policy gradient / actor-critic)** — rejected up front as too costly /
  risky for a hidden-information, variable-action game with a strong hand-written
  baseline. (This is, ironically, what the failure analysis now says would be
  *required* — see §7.)
- **Pure weight-tuning of the heuristic** — ceiling too low.

Deck under training: aggressive **Unicorn Cavalry** precon
(EmeraldDB uuid `ef93bae2-79c4-42b7-aa8c-bba55097c230`). A rush deck: it wins by
breaking provinces fast, so "commit attackers and initiate conflicts" is the
whole game plan.

## 2. Reward design

User's metric (from the original request): every won conflict = points, every
broken province = points, broken stronghold = the goal, drive opponent honor
toward 0, drive own honor toward 20.

`reward.js` `RewardTracker` attaches to the game EventEmitter and reads terminal
state. `DEFAULT_WEIGHTS`:

| Signal | Weight |
|--------|--------|
| conflict won | +1 |
| province broken | +3 |
| stronghold broken | +10 |
| game won | +25 |
| game lost | −25 |
| own honor above 10 (baseline) | +0.5 each |
| opponent honor below 5 | +1.5 each |

Two training targets were built in `train.py`:
- `--target win` — classification, label = did that player win. Monte-Carlo
  terminal credit assigned to every decision.
- `--target military` — **dense reward-to-go** (§6). Per-decision reward =
  `milDiff/6` (own military lead read off the state feature) + terminal `±10` win
  bonus, discounted γ=0.95, accumulated backwards per (game, player). Regression.

## 3. Architecture / pipeline

```
TS harness ──trajectories.jsonl──▶ python train.py ──weights.json──▶ TS seed-3 evaluator
 (tools/selfplay, Node)              (offline)                        (in-process, shipped)
```

Engine only runs in Node → self-play is always TS. Training is Python (better ML
libs). **Inference must stay in-process TS** or it recreates seed-2 slowness.

**Tooling — `jigoku/tools/selfplay/`** (plain JS, needs `build/` from `npx tsc`):

| File | Role |
|------|------|
| `deckLoader.js` | offline EmeraldDB → Jigoku deck object from `fixtures/`. `loadUnicornDeck()`. jigoku has no local card DB, so card data is cached fixtures. |
| `reward.js` | `RewardTracker` — event listeners + terminal-state reward. |
| `harness.js` | `runGame(options)` — one full game, two `JigokuBotController` seats, progress-based stall detection, `loadEvaluator(weightsPath)`. Caps records/game (3000) to avoid heap OOM on degenerate games. |
| `runGames.js` | CLI: N games → per-game outcome JSONL. ~256 ms/game. |
| `runTrajectories.js` | CLI: N games → per-decision JSONL + `.schema.json`. ~345 decisions/game. |
| `train.py` | numpy+sklearn trainer. GBDT (classifier for `win`, regressor for `military`) → `weights.json` + `.parity.json`. |
| `checkParity.js` | verifies TS tree walk == sklearn (`max|TS−sklearn| < 1e-6`). |
| `evalMatch.js` | seed 3 vs seed 1, alternating seats, win rate. The quality gate. |
| `generations.js` | iterative self-play RL (buffer → train → eval → decay ε → keep best). |
| `fixtures/` | cached decklist + trimmed cards (no network at run time). |

**Shipped (in `server/game/bots/ml/`, used by both training and inference so
features never drift):**
- `features.ts` — `stateFeatures(state, meName, round)` = 39 features (honor/fate/
  hand/char counts, mil/pol totals, province standing, conflict skill, `milDiff`/
  `myMil`/`oppMil`, all mine/opp/diff); `optionFeatures(state, meName, option)` =
  19 features (command one-hot, isPass/Done/Initiate, target side + stats). Reads
  `game.getState(meName)` — perspective-correct, no hidden info.
- `evaluator.ts` — `MoveEvaluator.score/pick`, `loadEvaluator`. GBDT `gbdtRaw`
  tree walk or `linearRaw` fallback; argmax over options. Handles both targets
  (`raw = base + learningRate·Σ leaves`; argmax(raw)==argmax(sigmoid(raw)) so the
  pick is sigmoid-invariant).

**Controller integration — `JigokuBotController.ts`:**
- `isEvaluatorDriven()` — seed 3 + evaluator injected.
- `isStrategicPrompt(prompt)` — WHITELIST. Evaluator engages only on real
  strategic prompts (elemental ring / choose province / choose attackers / choose
  defenders / dynasty character plays). Defers everything else (confirms,
  additional-fate costs, imperial favor, targets, setup, mulligan, bids).
- `evaluatorPick(player, prompt, options)` — bounded override: ≤3 tries per prompt
  (keyed on `stableSignature`), optional ε-exploration (`config.explore`), then
  defers to the heuristic option (always appended as enumerate fallback) so the
  turn always advances. **Seed 3 = "heuristic flow + evaluator refinement", never
  a raw argmax that can livelock.**
- `recorder?: (DecisionRecord)=>void` — gated; zero cost when absent. `DecisionRecord`
  is non-exported (clashes with `export = JigokuBotController`, TS2309).

## 4. How to run

From `jigoku/`, after `npx tsc`:

```bash
# 1. per-decision training data (heuristic self-play, grounding)
node tools/selfplay/runTrajectories.js 400 --out tools/selfplay/out/trajectories.jsonl

# 2. train the evaluator (Python)  — pip install numpy scikit-learn
python tools/selfplay/train.py --data tools/selfplay/out/trajectories.jsonl \
    --out tools/selfplay/out/weights.json --target military   # or --target win

# 3. verify TS reproduces sklearn exactly
node tools/selfplay/checkParity.js tools/selfplay/out/weights.json

# 4. the real gate — seed 3 vs seed 1
node tools/selfplay/evalMatch.js 40 --weights tools/selfplay/out/weights.json

# iterative self-play (policy iteration over generations)  — needs big heap
NODE_OPTIONS=--max-old-space-size=8192 node tools/selfplay/generations.js \
    --gens 6 --games 80 --eval 30 \
    --buffer tools/selfplay/out/buffer.jsonl \
    --seed-data tools/selfplay/out/trajectories.jsonl
```

`train.py` flags: `--target win|military` (default `military`), `--estimators 300`,
`--depth 3`, `--lr 0.08`. `generations.js` flags: `--gens --games --eval --epsilon
--buffer --seed-data --weights --rounds`.

**Gotchas:**
- `cwd` drifts to repo root after `python tools/build_project_graph.py`; prefix
  `cd /g/git/legend-of-five-rings/jigoku &&` when chaining.
- Windows Node can't resolve `/tmp`; use scratchpad absolute paths.
- `require` resolves relative to the script file, not cwd — use absolute base path.
- Refresh fixtures from EmeraldDB `/api/decklists/<uuid>` + `/api/cards`.

## 5. Attempts & failures (chronological)

Every scoping produced the same result vs seed 1: **seed 3 breaks 0.00 provinces,
wins 0 conflicts, wins 0 games**; seed 1 breaks ~4.75–5.00 provinces/game and wins
all.

1. **Raw argmax over all options (win-label GBDT).** Model plays WORSE than
   heuristic (lost 0-6, ~420 force-passes/10 games). Agrees with heuristic only
   22%; under-picks the ADVANCE buttons (Initiate/Done/Pass = 22% vs heuristic's
   52%), over-picks card/ring clicks → same prompt recurs → loops → force-pass.
   GBDT AUC 0.855 (honest; the 0.96 on 60 games was overfit). Root: pointwise
   MC-value on off-policy (heuristic-only) data has no notion of "advances vs
   stalls" and never sees the model's own move distribution.
2. **Phase-gated (conflict/dynasty only).** Still 0 provinces / 0 wins. Stalled at
   province SETUP + confirm prompts (evaluator-vs-heuristic oscillation).
3. **Narrow whitelist (ring/province/defenders only; heuristic all-ins attackers)**
   — the user's chosen "targeted fix". Still 0 provinces / 0 wins. Evaluator
   destroys the deck's aggression wherever it touches the conflict flow
   (under-commits, loops at Choose defenders / action window).
4. **Gen-1 self-play iteration** (`generations.js`). Left it at 0%.
5. **Dense military reward-to-go** (`--target military`, user's idea — §6). Model
   learns the target well (R²=0.74, parity 4e-14) but STILL 0 provinces / 0 wins.

## 6. Military reward shaping — user idea, definitive negative

Idea: link reward to military strength — reward growing own military and shrinking
enemy military, so the bot learns aggression the sparse win-only signal never
instilled. Implemented as dense reward-to-go over the `milDiff` state feature
(§2). Model fit was good. Play was not.

**TRACE root cause (structural, not reward):** seed-3's decision-reason histogram
shows `eval:llm-ring` clicked **25×/game** but **zero** `initiate-conflict` /
`declare-attacker`. It never completes the multi-step conflict-declaration
sequence — **ring → province → commit attackers → initiate** — so it passes 8
conflicts and defers 8 to the heuristic per game.

A per-click **value picker** scores each click in isolation; it cannot drive a
**procedural multi-step sequence**. Re-picking a ring scores fine locally, so it
never advances to committing attackers. No reward shaping fixes that — the reward
was learned correctly and the bot still can't act on it.

## 7. Definitive verdict

Falsified from every angle: **4 whitelist scopings × 2 targets (win-label +
military reward-to-go) + self-play iteration** — all give 0 provinces / 0 wins.
There is no evaluator scope that improves on the heuristic: engage it in
declaration → it breaks the sequence; restrict it to defense/targets → it adds
nothing on a rush deck.

**A per-click move-scoring evaluator cannot beat seed 1 in this engine's
multi-step decision flow. Structural, not tunable.**

Recommendation: **ship seed 1** (the heuristic — ~5 provinces/game, wins the
mirror decisively, 89/0 specs). Keep the seed-3 infra parked. A competitive
learned bot needs **deep RL that models the sequence/policy directly** (actor-
critic or a hierarchical action model), not a pointwise value scorer — weeks of
research-grade work, uncertain payoff. The built infra (harness, features, reward,
GBDT training, parity-exact inference, generation loop, eval harness) is the
foundation if that project is ever scoped.

## 8. Byproduct: shipped loop-stall fixes (net win for seed 1)

The seed-3 work surfaced two live-play freeze bugs in the aggressive mirror,
now fixed (bot spec stayed 89/0):
1. Attacker re-firing reversible conflict abilities + re-selecting no-target
   Assassination in its own Conflict Action Window.
2. Cycling illegal ring-clicks at conflict declaration.

Root: the policy's `attempted` dedup set (keyed `promptTitle|menuTitle`) was wiped
by VOLATILE prompt parts — live skill totals `Attacker: N Defender: N` and the
ring element/type `Political Fire Conflict` — so it never exhausted options to
reach its pass fallback. Fix = normalize both out of the signature (regex) in BOTH
`JigokuBotPolicy.decide` AND controller `stableSignature`; plus a controller
safety valve `forceProgress()` (clicks Pass/Done/Pass Conflict/Yes) armed when the
same normalized prompt survives ≥5 full budgets (`if(exhaustedBudget)`, was
`acted && exhaustedBudget`); plus an oscillation-resistant `recentExhaustSignatures`
window (cap 4). Force-pass fires rarely (~4/40 games).
