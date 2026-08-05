# Jigoku self-play tools

These scripts run real headless Jigoku games with normal game commands. They
are for measuring a bot change, policy comparison, regression diagnosis,
benchmark publication, and click-cycle detection. No external model service is
needed.

If the question is **"is the changed bot better?"**, skip to
[Measuring a bot change](#measuring-a-bot-change-the-current-method) — that
rig, not the round robins below, is the one that answers it.

## Supported bot seeds

| Seed | Policy |
|---:|---|
| 1 | Fate-aware mixed heuristic (default) |
| 2 | Original dynasty-focused heuristic |
| 3 | Seed 1 plus fair board-aware dynasty development |

Adaptive mulligan is the default for all three seeds. Omniscience is an
independent capability that can be enabled for any seed.

Bot V1 is the stable default engine. Bot V2 is separately selected with
`engineVersion: v2` or `--engine-version v2`; `pass-through`, `shadow`, and
`enabled` are V2 experiment modes and do not alter seed or information mode.

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

# One deck pilots V2 against a V1 field, with a V2 profile override.
# `--engine-version v2` would put V2 on BOTH seats, which moves a deck's number
# for two reasons at once; `--v2-decks` keeps the field on V1 so the result is
# comparable to the all-V1 baselines in baselines/v1/.
node tools/selfplay/botRoundRobin.js --games 100 --v2-decks Crab --v2-mode pass-through \
  --v2-profile '{"deckProfile":{"conflictPlanning":{"hopelessAttackKeepHome":3}}}'

# Seed 3 planner-enabled decks against every seed-1/seed-2 deck
node tools/selfplay/botSeedRoundRobin.js --subject-seed 3 --opponent-seeds 1,2 --games 20 --decks Dragon,Lion,PhoenixShugenja --trace

# Same-deck adaptive mulligan versus explicit frozen legacy behavior
node tools/selfplay/compareMulliganPolicies.js
node tools/selfplay/compareMulliganPolicies.js --games 40 --seeds 1,2,3 --decks Crab,Phoenix

# Same-deck lookahead conflict declarations versus frozen legacy behavior
node tools/selfplay/compareConflictPlanning.js
node tools/selfplay/compareConflictPlanning.js --games 20 --seeds 1 --decks Dragon,Scorpion

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

## Measuring a bot change (the current method)

These are the scripts to reach for when the question is **"is the changed bot
better?"**. The full method, including the traps each rule was learned from, is
the `/roundrobin` skill (`.claude/skills/roundrobin/SKILL.md`); load it before
running or interpreting any bot win-rate comparison.

All of them inject the change as a **V2 profile on one seat** while both seats
run V2 pass-through (= V1 logic), so the only difference between the two
populations is the injected `deckProfile` knob. An arm is a JSON string, never a
source edit. They are configured by environment variable, not by flags.

The harness runs **compiled JS**: run `npx tsc` (not `--noEmit`) before any of
them or both arms measure the same stale build.

```powershell
# 0. prove a "behaviour-preserving" refactor preserved behaviour
node tools/selfplay/refactorIdentity.js > before.txt   # then refactor
node tools/selfplay/refactorIdentity.js > after.txt    # SHA lines must match

# 1. ceiling first: how often does the change decide a game at all? (180 games)
$env:CHANGE='{"deckProfile":{"someKnob":1}}'; node tools/selfplay/measureDecisiveness.js

# 1b. what did the bot DO differently, and which scope wants the lever?
$env:CHANGE='{"deckProfile":{"defenseBreakTie":true}}'; $env:KINDS='defense-size'
$env:BASES='91001,92001'; $env:OUT='probe.json'; node tools/selfplay/probePaired.js
node tools/selfplay/crossTabFlips.js probe.json readyCount marginalSkill ringElement

# 2. null arm (REQUIRED): inject the knob at its own default; must be exactly 50.00%
$env:LABEL='null'; $env:CHANGE='{"deckProfile":{"someKnob":0}}'
node tools/selfplay/parallelHeadToHead.js

# 3. the head-to-head itself, three bases to reject / six or more to accept
$env:LABEL='change'; $env:CHANGE='{"deckProfile":{"someKnob":1}}'
$env:BASES='91001,92001,93001'; node tools/selfplay/parallelHeadToHead.js
```

### `parallelHeadToHead.js` — the answer

Changed bots play unchanged bots across every ordered cross-deck pairing
(mirrors excluded), each pairing twice on the same shuffle with the change on
opposite sides, replayed across several independent bases. Deck strength and
first player cancel by construction and the baseline is a hard **50%**.

Same experiment as the serial `headToHeadRoundRobin.js`, sharded across worker
processes: **540 games in ~3.3 minutes instead of ~50**. A shard is a contiguous
slice of the same `(base, deckA, deckB)` list, so sharding cannot change which
games are played or their shuffles — the null arm still scores exactly 50.00%.

| var | meaning |
|---|---|
| `CHANGE` | treated seat's injected V2 profile (JSON) |
| `CONTROL` | untreated seat's profile; hold a second knob on both sides while A/B-ing a third |
| `BASES` | csv of independent shuffle bases (default `91001,92001,93001`) |
| `GPB` | extra games per pair per base; each unit adds 2 games |
| `WORKERS` | forked processes, default `cores - 4` |
| `LABEL` | name printed in the header |
| `OUT` | also write per-game rows as JSON |

Leave cores free. The harness has a wall-clock per-game backstop
(`HARNESS_MAX_GAME_MS`, defaulted to 180000 here), so oversubscribing turns slow
games into non-results. The report adds a binomial z/p on the total and a
`stopReason` census — a run containing timeouts is reporting fewer games than it
played, and those are not missing at random.

**Read the total, never the per-deck rows.** A validated null arm still swings
±28pp per deck at exactly 0.00pp overall; a deck row measures that deck's
strength against the field. `headToHeadRoundRobin.js` is kept as the serial
reference implementation and takes the same `CHANGE`/`BASES`/`GPB`/`LABEL`.

### `measureDecisiveness.js` — the ceiling

Replays each shuffle with and without the change and counts how often the
**winner** differs. That flip rate caps the largest win-rate effect the lever
could ever have: flipping 4% of games caps it at 2pp. If the ceiling is under
the ±2.5pp noise floor, stop — no head-to-head can resolve the lever, and tuning
its *values* will not help because the insertion point is wrong, not the
numbers. `CHANGE`, `BASE`, `LABEL`.

### `probePaired.js` — what the bot actually did

Plays every pairing twice on one shuffle (control, then the change on one seat)
with `BotTelemetry` attached, and dumps every decision event next to both
outcomes. Yields the decisiveness ceiling for free.

| var | meaning |
|---|---|
| `CHANGE` | injected profile |
| `KINDS` | csv of telemetry kinds to keep — empty keeps all, and there are thousands per game |
| `ARMS` | `treated` (default), `control`, or `both` |
| `SEAT` | `0` or `1` — which seat carries the change |
| `BASES`, `WORKERS`, `OUT` | as above; `OUT` writes `{games, events}` for the analysis scripts |

Two things only this rig gives: a **causal per-deck number** (only one seat is
treated, so a flip is that deck's effect — head-to-head per-deck rows cannot be
read that way), and the **scope** a lever wants.

**Its win-rate number is not a result.** It treats one seat and never swaps it,
so a seat / first-player interaction survives in it and cancels in the
head-to-head by construction. Measured: the same lever read **+4.07pp on
`SEAT=0`** and **+1.48pp on `SEAT=1`**; seat-averaged it matched the
head-to-head on the same bases to the decimal. Always run both seats.

### `crossTabFlips.js` — find the scope

```powershell
node tools/selfplay/crossTabFlips.js probe.json readyCount marginalSkill ringElement
```

Buckets the decided games from a `probePaired.js` dump by an attribute of the
windows that fired in them, and prints the flip direction per bucket plus a
cumulative `<= k` / `>= k` view — the number a capped knob would produce on
those bases. Numeric fields are reduced per game (min for `readyCount` and
`conflictsRemaining`, max otherwise); categorical fields bucket per window.
It reads seat 0 only, so dump with `SEAT=0`.

Slicing ~70 decided games several ways will always surface a good-looking
bucket. That bucket is a **hypothesis**; the bases it was found on are burned
and the scoped arm has to win its own head-to-head on fresh ones.

### `refactorIdentity.js` — identity check

Runs a fixed slate of games and prints a SHA of every outcome. A null arm
**cannot** catch a refactor that changed V1, because both seats moved together
and it still scores exactly 50.00%. Capture the hash before pulling a decision
into a class or renaming a knob, and again after. `BASE`, `ENGINE` (`v1`/`v2`).
An intentional behaviour change is expected to move the hash — that is also how
a shipped default is proven live.

### Telemetry and the per-lever analysers

`server/game/bots/BotTelemetry.ts` is a static opt-in decision sink: disabled
and free by default, `attach(sink)` in a worker to collect. Kinds currently
emitted:

| kind | emitted by | decision |
|---|---|---|
| `axis-choice` | `ConflictDeclarationPolicy` | military vs political declaration |
| `defense-size` | `DefenseCommitmentPolicy` | how much skill to commit on defense |
| `attack-size` | `JigokuBotPolicy` | attacker allocation / `applyAttackerPlan` reach |

Each analyser reads a `probePaired.js` dump:

```powershell
node tools/selfplay/analyzeDefenseTie.js probe.json    # KINDS=defense-size
node tools/selfplay/analyzeAxisChoice.js probe.json    # KINDS=axis-choice
node tools/selfplay/analyzeAttackSize.js probe.json    # KINDS=attack-size
```

- `analyzeDefenseTie.js` — where defense decisions land, what the tie-break
  spends (the marginal body, not one skill) and what it buys.
- `analyzeAxisChoice.js` — whether the decision is reached, at what
  `opponentBoardWeight` it diverges from V1, and which decks short-circuit
  before it. Replays the comparison offline at other weights from one dump.
- `analyzeAttackSize.js` — reachability: how many declaration decisions actually
  consult the attacker plan, per deck. "Enabled" is not "reaching"; two
  mechanisms here are inert for V1 with passing specs.

**Check reachability before improving a mechanism.** `BoardAwareDynastyTactics.choose`
and `ConflictPhasePlanner.planDefense` are both inert for V1 and passing specs
hid it — a full measurement cycle was spent on the first before that was noticed.

### `cardLab.js` — price one card

```powershell
node tools/selfplay/cardLab.js <scenario.js> [repeats]
```

Full self-play cannot answer "how much is THIS card worth" — a card appearing in
a fifth of games is buried under shuffle noise. This fixes the board, varies one
thing, and replays the same situation many times, with both seats driven by the
real bot so abilities fire through the bot's own logic instead of being
scripted. A scenario module exports `{ name, phase, rounds, player1, player2,
variants, seats, measure }`; `variants` are deep-merged over the base board.
Nothing in the script knows about any particular deck or card.

## Bot V2 evaluation

```powershell
# Pass-through proves routing equivalence; shadow evaluates without overriding V1
node tools/selfplay/compareBotVersions.js --v2-mode pass-through --seed 1 --mode fair --games 2 --require-equivalence
node tools/selfplay/compareBotVersions.js --v2-mode shadow --seed 1 --mode fair --games 20 --rng-seed 17101

# Enabled paired holdout and full research trace
node tools/selfplay/compareBotVersions.js --v2-mode enabled --seed 1 --mode omniscient --games 20 --rng-seed 27101 --include-traces
node tools/selfplay/auditBotRegret.js --input tools/selfplay/out/v2-vs-v1-seed1-omniscient-enabled.json --out tools/selfplay/out/v2-regret

# Engine-aware click and semantic/payoff gates
node tools/selfplay/validateBotInteractions.js --engine-version v2 --v2-mode enabled --seeds 1,2,3 --opponents all --games 2
node tools/selfplay/auditCards.js --engine-version v2 --v2-mode enabled --decks all --seeds 1,2,3 --opponents all --modes fair,omniscient --games 2

# Inject an experimental context.profile.v2 override for the V2 seat (gate flags,
# utility weights, search limits). Inline JSON or a JSON file path. Additive and
# off by default; used for offline coefficient tuning and gated research slices.
node tools/selfplay/compareBotVersions.js --v2-mode enabled --seed 1 --mode fair --games 6 --decks Crane,Lion \
  --v2-profile '{"highConfidenceGate":{"allowAutonomousPolicy":true}}' --out tools/selfplay/out/v2-autonomous-smoke
```

`--v2-profile` is the measurement path for weight/gate experiments: it flows
`config.v2Profile` -> controller -> `context.profile.v2`, so any `UtilityProfile`
(`weights`, `adjustments`, `searchLimits`) or `highConfidenceGate` field can be
tested against V1 without editing deck profiles or runtime defaults.
`highConfidenceGate.allowAutonomousPolicy` (default off, research only) lets the
top-scored utility candidate execute on execution-safe single-command kinds; it
currently loses badly to V1 (~6-8%) and stays disabled — see
`docs/bot-v2-rejected-experiments.md`.

`compareBotVersions.js` writes versioned JSON/Markdown with per-deck confidence
intervals, seats, paired RNG, victory types, runtime, searched nodes, fallback,
plan churn, tactical corrections, budget exhaustion, and planner errors. Add
`--include-traces` only for regret/replay work because research traces are large.

The fixed broad-league partitions are in `v2BenchmarkPartitions.json`.
`tuneBotV2.js` ranks bounded profiles from an input manifest, hashes the exact
configuration, penalizes stalls/runtime/fallback/variance/outliers, and writes
retained profiles only on request. A default recommendation is rejected until
repeated distinct-RNG holdout confirmation passes. It never edits runtime
defaults. See `docs/bot-v2.md`, `docs/bot-v2-architecture.md`, and
`docs/bot-v2-rejected-experiments.md`.

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

## Conflict-planning A/B

`compareConflictPlanning.js` holds deck and strategy seed constant, alternates
seats, gives each two-game seat pair the same starting RNG seed, and changes only the per-seat
`conflictPlanningPolicy` (`lookahead` versus `legacy`). The default covers every
registered deck on seeds 1-3 with 20 games per row. Reports include per-row and
aggregate records plus the number of applied lookahead decisions. They never
update client benchmark configuration. See
`docs/conflict-phase-lookahead-bot.md` for the model and intentionally disabled
integration layers.

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

A run with `--v2-decks` or `--v2-profile` is never treated as standardized, even
if everything else matches, so a V2 comparison can never overwrite the V1
baseline it is being compared against.

Custom counts, deck subsets, cross-seed opponents, legacy draw policy, and
profile overrides remain diagnostic and never replace client results.

The win-rate and round-robin tools default to Bot V1. V2 runs are version-tagged
diagnostics and cannot overwrite V1 standard data unless the separate V2
publication gate is explicitly implemented and passed.

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
`conflictPlanningPolicies`, `omniscient`, `trace`, and `onControllers`. Every deployed seed defaults to adaptive
mulligan; an explicit `mulliganPolicies` pair lets the A/B script compare it
with frozen legacy logic.

`deckRegistry.js` is the source of truth for registered labels. `deckLoader.js`
loads cached EmeraldDB fixtures. `reward.js` observes game events and terminal
state. `standardBenchmark.js` validates and writes standardized client results.

Every game carries a **wall-clock backstop** so one game cannot hang a batch:
`options.maxGameMs`, else `HARNESS_MAX_GAME_MS`, else 90000. Because it is wall
clock it also fires on games that are merely SLOW, so any script forking workers
must raise it — the parallel rigs default it to 180000. A run whose `stopReason`
census contains `timeout` is reporting fewer games than it played, and those are
not missing at random. Loops are caught by `stalled`/`maxSteps` well inside the
budget, so a longer backstop costs nothing.

The parallel rigs (`parallelHeadToHead.js`, `probePaired.js`) fork
`_h2hWorker.js` / `_probeWorker.js`, which return their payload on a single
`@@RESULT@@`-prefixed stdout line. Loop-guard logs land on stdout too, so the
driver looks for that marker rather than parsing the whole stream — a worker
change that prints before the marker is fine; one that breaks the marker line is
not.

## Output hygiene

Named reports belong in `tools/selfplay/out/`. These are diagnostics, not source
fixtures. Preserve useful reports with an explicit `--out` prefix; the default
`latest` reports may be overwritten.

## One deck against the fixed field

`deckFieldWinRate.js` measures a SINGLE deck's strength against the other ten,
held fixed. It exists because `headToHeadRoundRobin.js` compares a changed bot
to an unchanged one — there is no unchanged counterpart for a new deck — and a
field round robin that moves every seat is zero-sum. The number is NOT centred
on 50%.

```powershell
$env:SUBJECT="PhoenixPhoenix"; $env:BASES="91001,92001,93001"; $env:GPB="3"
node tools/selfplay/deckFieldWinRate.js
```

`SUBJECT_PROFILE` injects a V2 pass-through profile into the subject seat only,
so a deck-tuning arm is a JSON string rather than an edit:

```powershell
$env:SUBJECT_PROFILE='{"deckProfile":{"rebirth":{"zeroFateAdditionalFate":1}}}'
node tools/selfplay/deckFieldWinRate.js
```

Every rule from `.claude/skills/roundrobin/SKILL.md` still applies: validate the
rig with an arm injected at its own default, use several independent bases, and
read the TOTAL rather than the per-opponent rows.

