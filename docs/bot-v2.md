# Bot V2: measurement infrastructure

**Bot V2 is not a player-facing opponent and is not a candidate to replace Bot
V1.** It is the experimentation rig used to measure changes to Bot V1. This was
decided on 2026-08-02 after the V2-as-a-better-bot program was measured to
completion; the history and evidence are below.

Bot V1 is the only engine players ever get. The lobby has no engine selector,
and `server/lobby.js` pins `engineVersion: 'v1'` regardless of what a client
sends.

## What V2 is for

V2 wraps the same `V1PolicyAdapter` that V1 runs directly, and delegates any
decision it does not override. That property is the whole point: it makes V2 a
**seat-scoped, profile-injectable copy of V1**, which is what the paired A/B
method needs.

- **Per-seat profile injection.** `--v2-profile` / `V2PROFILE` deep-merges into
  `deckProfile.conflictPlanning` for one seat only, so a flag can be toggled for
  a single deck against an otherwise untouched V1 field.
- **Paired controls on identical shuffles.** Every arm runs against a V1 control
  seat piloting the same deck on the same shuffle, so the control is a constant
  and arm-vs-arm deltas are attributable to the injected profile alone.
- **Instrumentation.** Typed card semantics, the value models, the shadow
  engine, and the trace levels are all retained as analysis tools. `v2/cards`
  and `shared/CardValueModel` price cards that V1 only sees as a flat constant,
  which is how "is this card dead?" questions get answered.

## Directory boundary (2026-08-13)

`v2/` used to hold modules V1 imported at runtime, which made "is this
experimental?" a judgement call on every file. Those modules were misfiled, not
experimental, and now live in `shared/`:

| Zone | Files | LOC | Rule |
|---|---|---|---|
| `bots/*.ts` (V1) | 52 | ~36k | ships; may import `shared/`, never `v2/` |
| `bots/shared/` | 8 | ~3.1k | **used by both engines — editing it changes the shipping bot** |
| `bots/v2/` | 42 | ~8.6k | measurement only; may import `shared/` and V1 |

`shared/` is `CardValueModel`, `CardValueTypes`, `ConflictActionPlanner`,
`V2DeckProfiles` and the Duel / Economy / Holding / Support value models.
Despite its name `applyV2DeckProfile` runs on **every** seat, V1 included — it
is what merges an injected `--v2-profile` arm into a resolved deck profile.

The one permitted V1→`v2/` import is `BotEngineRouter.ts`, which constructs the
engine. Anything else is a boundary violation and `npx fallow dead-code` fails
on it — the rule is encoded in `.fallowrc.json` under `boundaries`, so this
cannot silently regress.

Because `shared/` is load-bearing for live play, prove any edit to it
behaviour-neutral with `tools/selfplay/refactorIdentity.js` on several bases
before assuming it is safe.

A V2 run with no injected profile now measures **bit-identical to V1 on 9 of 10
decks** (Phoenix differs only by its retained `applyIntentPlan` entry). That
equivalence is the rig's calibration: if an `off` arm ever stops matching its V1
control, the rig is broken, not the lever.

## How to use it

- `tools/selfplay/botRoundRobin.js --v2-decks <deck> --subject <deck>
  --v2-profile '{"deckProfile":{"conflictPlanning":{...}}}'` — one deck piloting
  an injected profile against the V1 field.
- `tools/selfplay/parallelHeadToHead.js` — **changed bots vs unchanged bots**,
  every ordered cross-deck pairing, both orientations per shuffle, several
  bases. Use this for "is the changed bot stronger". Always run its null arm
  first. Sharded across workers: 540 games in ~3.3 minutes instead of ~50, and
  the sharding cannot change which games are played, so the null arm still
  scores exactly 50.00%. `headToHeadRoundRobin.js` is the serial reference
  implementation of the same experiment.
- `tools/selfplay/measureDecisiveness.js` — how often the change decides a game
  at all, which caps the largest win-rate effect it could ever produce. Run this
  BEFORE a long comparison, not after.
- `tools/selfplay/probePaired.js` — the same pairing played twice on one shuffle
  with `BotTelemetry` attached, dumping every decision event next to both
  outcomes. The only rig that yields a **causal per-deck** number, because just
  one seat is treated. Its win-rate number is a hypothesis about size, not the
  answer: it does not cancel a seat interaction, so run `SEAT=0` and `SEAT=1`.
- `tools/selfplay/crossTabFlips.js` — buckets the decided games from that dump
  by an attribute of the windows that fired, to find the SCOPE a lever wants.
  Hypothesis generation only; the scoped arm must win on fresh bases.
- `tools/selfplay/refactorIdentity.js` — hashes a fixed slate of outcomes to
  prove a behaviour-preserving refactor preserved behaviour. A null arm cannot
  do this: it moves both seats together and still reads exactly 50.00%.
- `tools/selfplay/analyzeAxisChoice.js`, `analyzeDefenseTie.js`,
  `analyzeAttackSize.js` — per-lever readers of a `probePaired.js` dump
  (`axis-choice`, `defense-size`, `attack-size` telemetry kinds). Use
  `analyzeAttackSize.js` to confirm a mechanism is REACHED, not merely enabled.
- `tools/selfplay/compareBotVersions.js` — paired candidate/control comparison.
- `tools/selfplay/auditCards.js --engine-version v1` — which cards and abilities
  never fire.
- `tools/selfplay/cardLab.js` — price a single card in a controlled scenario.

Decision knobs live in **injectable policy classes** (`DefenseCommitmentPolicy`,
`ConflictDeclarationPolicy`) configured from a `DeckProfile` field, so an arm is
a JSON string and never a source edit. Every class default reproduces V1.
`server/game/bots/BotTelemetry.ts` is the matching decision sink: static, opt-in,
free when detached.

### Two rigs, two different questions

The paired A/B above asks *"does this change move the subject deck's win rate
against an unchanged field?"* It is the right tool for tuning one deck, and it
is the only one of the two that isolates a per-deck effect.

It is **not** the right tool for "is the changed bot a harder opponent?", and a
field round robin cannot answer that either — a change applied to every seat is
zero-sum, so ten deck win rates still average 50% and the deltas still sum to
zero no matter how good the change is. That measurement can only report game
*shape* (round counts, win reasons).

The direct challenge answers it by putting the two populations across the table
from each other — `tools/selfplay/parallelHeadToHead.js` (or its serial twin
`headToHeadRoundRobin.js`), with `tools/selfplay/measureDecisiveness.js` for the
ceiling and `probePaired.js` for what the bot did. The full method is the
`/roundrobin` skill (`.claude/skills/roundrobin/SKILL.md`), which should be
loaded before running or interpreting any bot win-rate comparison:

- Every **ordered cross-deck pairing**, mirrors excluded (90 of them for ten
  decks). A mirror is uninformative — both sides are the same deck AND the same
  bot on one side of the change, so it measures the change against itself.
- Each pairing is played **twice on the same shuffle**, once with the change on
  deck A and once on deck B, so each side pilots every deck and occupies each
  seat equally often. Deck strength and first-player cancel by construction
  rather than by assumption.
- **Both seats run the same engine path** (V2 pass-through, i.e. V1 logic), so
  the only difference between them is the injected profile and any pass-through
  quirk applies to both sides.
- The baseline is a hard **50%**, not another arm's number.

Its built-in calibration is a **null arm**: inject a knob set to its own default
(`{"deckProfile":{"dynastyAbilityScale":0}}`), which exercises the whole
injection path while changing no behavior. Both seats then play identically, so
the same shuffle produces the same game in both orientations and the changed
side must score **exactly 50.00%** — and each deck block exactly `n/2`. Any
other number means the rig is broken, not the lever.

**Method rules that are not optional** (each was learned by getting it wrong):

1. The harness runs **compiled JS**. Run `npx tsc`, not `tsc --noEmit`, or every
   edit is inert and both arms measure the same stale build.
2. `seed` selects the V1 **policy class**, not the shuffle. The shuffle is
   `base`. To replicate, hold seed at 1 and vary `base`.
3. The noise floor of this methodology is about **+/-2.5pp**. Fix the decision
   rule before the run, and require replication on independent shuffle bases.
4. Round robin is **zero-sum**: ten deck win rates average 50% and deltas sum to
   zero. A field-wide change cannot lift every deck. Use the direct challenge
   above when the question is whether the changed bot is stronger overall.
5. **Check that the mechanism is reachable before improving it.** Two
   sophisticated ones are inert for V1 and a passing spec hid both:
   `BoardAwareDynastyTactics.choose` is never called by any field deck profile,
   and `ConflictPhasePlanner.planDefense` never runs because `applyDefensePlan`
   defaults to `false`. A price list wired into the first measured
   bit-identical to its control across 90 games. Instrument the call site, or
   confirm the arm's census differs from `off`, before spending games on it.

## Why the "better bot" program ended

Every V2-native mechanism was built, measured, and rejected. Full evidence in
`bot-v2-rejected-experiments.md`.

| mechanism | result |
| --- | --- |
| autonomous linear evaluator | 5-8% win rate vs V1 |
| `liveTacticalSearch` | zero accepted corrections, 678 exhausted budgets, 2.6x runtime |
| high-confidence override gate | 95-100% fallback; every attempt to lower it lost games |
| live dynasty package override | 2-6 with a retained ledger |
| exact defender-set macro | 8-12 aggregate |
| `useCardValueModel` / `vetoDeadCards` | monotone negative, 121-59 down to 114-66 |
| `applyActionPlan` | -17 games across independent shuffle sets |
| `applyPassPlan` / `applyRingPlan` / `applyTypePlan` | -13pp / -5.8pp / -3.9pp |
| **`applyAttackerPlan`** | **the one win — and it was a V1-shaped feature** |

The pattern is consistent: the only lever that ever paid was a flag inside V1's
own `ConflictPhasePlanner`, tuned per deck. It was ported into V1 on 2026-07-31
(all ten decks positive, mean +4.67pp, sign test p ~ 0.002), which left V2's
base override a no-op and its edge over V1 exactly zero by construction.

The 2026-07-26 "V2 is tuned per-deck, exactly like V1" direction was the correct
diagnosis and is what produced that win. Its conclusion has now been taken to
the end of the line: if V2's only viable form is "V1 with per-deck knobs", the
knobs belong in V1, and V2 keeps the job it is genuinely good at — proving
whether a knob is worth shipping.

## What would reopen it

Not more overrides, and not coefficient tuning. The measured ceiling is the
evaluator itself: a hand-written linear evaluator is weaker than V1's tuned
heuristics, so every increase in autonomous divergence loses games. Reopening
this needs a **learned value function** (self-play trained, holdout confirmed),
which is a different program from anything in this tree.

## Related

- `bot-v2-architecture.md` — the decision pipeline and how to add a contributor
- `bot-v2-rejected-experiments.md` — read before proposing any bot idea
- `bot-v2-deck-tuning.md` — the per-deck rule surface and measurement protocol
- `bot-v2-per-deck-plan.md` — per-deck diagnostics and their results
- `heuristic-bot.md` — Bot V1, the engine that actually ships
