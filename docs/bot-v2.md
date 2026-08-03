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
  and `v2/CardValueModel` price cards that V1 only sees as a flat constant,
  which is how "is this card dead?" questions get answered.

A V2 run with no injected profile now measures **bit-identical to V1 on 9 of 10
decks** (Phoenix differs only by its retained `applyIntentPlan` entry). That
equivalence is the rig's calibration: if an `off` arm ever stops matching its V1
control, the rig is broken, not the lever.

## How to use it

- `tools/selfplay/botRoundRobin.js --v2-decks <deck> --subject <deck>
  --v2-profile '{"deckProfile":{"conflictPlanning":{...}}}'` — one deck piloting
  an injected profile against the V1 field.
- `tools/selfplay/compareBotVersions.js` — paired candidate/control comparison.
- `tools/selfplay/auditCards.js --engine-version v1` — which cards and abilities
  never fire.
- `tools/selfplay/cardLab.js` — price a single card in a controlled scenario.

**Method rules that are not optional** (each was learned by getting it wrong):

1. The harness runs **compiled JS**. Run `npx tsc`, not `tsc --noEmit`, or every
   edit is inert and both arms measure the same stale build.
2. `seed` selects the V1 **policy class**, not the shuffle. The shuffle is
   `base`. To replicate, hold seed at 1 and vary `base`.
3. The noise floor of this methodology is about **+/-2.5pp**. Fix the decision
   rule before the run, and require replication on independent shuffle bases.
4. Round robin is **zero-sum**: ten deck win rates average 50% and deltas sum to
   zero. A field-wide change cannot lift every deck.

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
