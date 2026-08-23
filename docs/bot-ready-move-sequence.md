# Ready → move: the two-action sequence — `ReadyMovePlanner`

`bot-ready-value.md` shipped `ReadyValuePolicy` with one of its three uses held
OFF: "we can MOVE it into the conflict". The reason was follow-through, not the
idea. The bot decided the ready and the move at separate prompts with nothing
tying them together, so it readied a body because a mover existed somewhere and
then never used the mover — measured live on Unicorn, which readied Minami Kaze
Regulars at home purely because Golden Plains Outpost *could* have moved a body
in.

This module is the missing link.

## How the sequence survives two prompts without state

It is not stored. The plan is a **pure function of the board**, re-derived at
every prompt:

* the chosen body is **bowed** and at home → stage `ready`. Do the ready now.
* the chosen body is **ready** and at home → stage `move`. Do the move now.

After the ready resolves, the board has changed and the same body is now the
cheapest candidate (no ready leg left to pay for), so the second prompt
re-derives the same plan at stage `move`. Nothing can go stale between prompts
because nothing is carried between them.

What the plan MUST do at stage `ready` is **budget for the move as well**.
Readying with only enough fate for the ready is precisely how the sequence
breaks in half, so `plan()` rejects any pairing whose `readyCost + moveCost`
exceeds the fate pool (scaled by `maxFateShare`).

## When it commits

Not "whenever it can". The owner's rule: the body arriving has to change the
result.

| justification | source |
|---|---|
| wins a conflict we are losing | `winSkillNeeded` |
| breaks the province, or stops ours breaking | `strengthNeeded` (`conflictStrengthNeeded` folds both roles into one number) |
| a participation payoff that needs no skill | `participationPayoff`, deck-supplied |

A conflict that is already won **and** already breaking gets nothing, so no
plan is made. A body too small to close the gap is refused.

### The generic case vs the Unicorn case

For a deck holding Favorable Ground, **only ready → move brings value**: a body
that arrives still bowed adds 0 skill and does nothing. That deck supplies no
payoff function, so `move-bowed-for-participation-payoff` can never fire for it.

Unicorn is different, and the difference is mechanical: `isParticipating()` is
**bow-agnostic**, and so is `Conflict.hasMoreParticipants`. A bowed body in the
conflict still counts for

* **Minami Kaze Regulars** — after-win reaction, needs the participant majority
* **Higashi Kaze Company** — after-win reaction, needs a 0-fate participant
* **Shinjo Shono** — his Action is legal only while we hold the participant
  majority, and gives +1/+1 to every participating Cavalry
* **Outskirts Sentry** — honors a participant whenever anything moves in

`JigokuBotPolicy.unicornParticipationPayoff` prices those, and only for a deck
running `UnicornTactics`.

## Where legality comes from

`JigokuBotController.sequenceSourceTargets` reads it from the **engine**, not
from a hand-written table:

```js
action.meetsRequirements(action.createContext(player)) === ''
target.getAllLegalTargets(context)
```

That one call already enforces the conflict type, the phase, the card's own
condition (Matsu Mitsuko's honor lead, Shiotome Encampment's claimed military
ring, Even the Odds' participant count) and once-per-round limits. `MOVE_SOURCES`
and `READY_SOURCES` therefore carry only what the action cannot report: the
**fate cost**, and the shape of the move.

The moved uuid is not always the action's target — `selfOrBearerOnly` sources
(Adorned Barcha, Formal Invitation, Moto Eviscerator) move the character they
are attached to or are, while the action targets somebody else entirely.

`hawk-tattoo` is deliberately absent: it moves its bearer through a **reaction**
fired when the attachment enters play, so the bearer is not chosen until the
attachment is already paid for.

## What the live suites found

The two monitors were written for this work and immediately turned up a seam of
pre-existing defects in the deck-specific move and ready pickers — none of them
regressions, all of them the same shape:

| defect | fix |
|---|---|
| `Ride On moved Battle Maiden Recruit in (0 skill)` | `UnicornTactics.arrivalBringsSomething` |
| `Matsu Mitsuko moved Keeper Initiate in (0 skill)` | skill requirement on the gate, plus a generic arrival filter in `cardDecision` |
| `Moto Eviscerator moved itself in (0 skill)` for an honor | skill requirement on its gate |
| `Even the Odds moved Akodo Zentarō in (0 skill)` | the arrival filter reads the **contested** axis, not the deck's preferred one |
| `Hawk Tattoo moved a BOWED bearer in` | bearer must be ready and have skill |
| `Twilight Rider moved in bowed and readied a body AT HOME` | `pickTwilightReadyTarget` prefers a participant |
| `Elegant Tessen readied a body with 0 conflicts left` | `READY_REACTION_IDS` gate on the reaction window; the Lion setup branch asks the verdict directly |
| `Prodigy of the Waves readied itself with 0 conflicts left` | `readyIsWorthACard` on its gate |

The generic guards that came out of it:

* `usefulMoveArrivals` — a move-into-conflict selector never offers a body with
  no skill on the contested axis and no arrival payoff;
* the pure-ready target guard — a ready prompt whose candidates are all home
  bodies is DECLINED when no conflict can use them;
* `READY_REACTION_IDS` — a reaction whose whole payoff is a ready asks the same
  question before firing.

What is still open is listed in `test/helpers/readymoveallowances.js`, with the
reason for each. The suites fail on anything **new**.

(The mirror sequence, `move → ready`, was the biggest open item here and is now
built — see the next section.)

## Tests

* `test/server/bots/readymoveplanner.spec.js` — the planner in isolation: both
  stages, the re-derivation after the ready leg, affordability across both legs,
  the value gate in each of its three forms, the payoff-only move, the
  single-action `hiruma-signaller` case, and the source tables checked against
  the engine's own card registry.
* `test/server/integration/botreadyvalue.spec.js` — the live field. It now
  carries `MoveValueMonitor` as well, which settles every `onMoveToConflict` by
  **counterfactual**: recompute the conflict with that body's skill removed and
  see whether the winner, the break, or the defence changes.

Full cross-deck field, base 91001, both seats (`READY_FULL=1`):

```
ready -> move planner: 164 decisions at stage READY (a bowed body, both legs
                       budgeted), 782 at stage MOVE.
move value: 354 bodies moved into a conflict - 106 won the conflict,
            50 produced the break, 36 stopped one, 72 paid off by
            participating, 86 redundant, 4 wasted (all allowance-listed).
```

## Measured

**Null arm.** `readyMove` and `readyValue.allowMoveIntoConflict` injected at
their own defaults, base 91001: **272 of 272 games bit-identical**, 0 flips,
seat 0 wins 143 vs 143.

**Scope of the arm.** Only the SEQUENCER is behind the knob
(`readyMove.enabled` + `readyValue.allowMoveIntoConflict`). Every picker fix in
the table above ships unconditionally — they are correctness, validated by the
live monitors, and no win-rate arm covers them.

**Ceiling.** `measureDecisiveness.js` on the revert arm flips **0.0%-0.7% of
games**, capping the win-rate effect at **0.18pp-0.37pp**. Far below the ±2.5pp
noise floor, so a head-to-head round robin cannot resolve it and was not run.

**Pooled flip sign test**, 11 independent bases, 2992 games:

| | |
|---|---:|
| decided games | 5 (0.17%) |
| toward the change | 2 |
| toward the old behaviour | 3 |
| two-sided sign test | **p = 1.000** |
| implied effect on the treated seat | −0.017pp |

**A clean null, and an expected one.** The sequencer commits often — 164
stage-`ready` and 782 stage-`move` decisions over one pass of the field — but
almost all of the stage-`move` commitments agree with what the deck pickers
already did, so the game outcome rarely changes. What the planner buys is that
the ready leg is now only taken when the move is affordable and committed, which
is a correctness property, not a win rate.

**Read this the same way as `polarityGuards` and `readyValue`:** the value is in
`botreadyvalue.spec.js` reading 0 wasted readies and 0 unexplained wasted moves
across the full cross-deck field, not in a win-rate number.

---

# The other order: move → ready

Some ready sources can only ever reach a body that is **already participating**:

| source | who runs it | reaches |
|---|---|---|
| `fan-of-command` | LionDuelist | a participating **Bushi**, while its bearer participates |
| `the-pursuit-of-justice` | Dragon | a participating character, at a water conflict province |
| `moto-outrider` | Unicorn | itself, once participating in a military conflict |

For those the move HAS to come first, so `ReadyMovePlan` carries an `order`:

* `ready-first` — bowed at home → ready → move. Preferred on a cost tie, because
  the body then never spends a window in the conflict contributing 0 while the
  opponent acts.
* `move-first` — bowed at home → move → ready. Chosen when it is strictly
  cheaper, or when it is the only order available.

The stage still comes from the board: a bowed body at home under a `move-first`
plan is at stage `move`, and the same body becomes stage `ready` again once it is
a **bowed participant**. That is the one case where a participant is a plan
candidate at all; every other in-conflict body is somebody else's decision.

Both legs are budgeted in either order.

## Which decks this is for

Intersecting the move and ready source lists against the field decks:

| deck | move sources | ready sources |
|---|---|---|
| **LionDuelist** | Even the Odds, Favorable Ground, Formal Invitation, Matsu Mitsuko | **Fan of Command**, In Service to My Lord |
| **Dragon** | Favorable Ground | **The Pursuit of Justice**, Sacred Sanctuary, In Service to My Lord |
| Phoenix | Favorable Ground | Against the Waves (works in either order) |
| Unicorn | Adorned Barcha, Golden Plains Outpost, Ride On | I Am Ready, Moto Outrider, Shiotome Encampment, Twilight Rider |

LionDuelist is the clearest case and produced most of the live firings.

## Two things the engine does NOT tell you

**1. `getAllLegalTargets` is a SUPERSET.** It did not apply the target's
`cardCondition` for these abilities — Fan of Command returned every friendly
character rather than the participating Bushi it can actually ready, which put
it in the *home* ready map and made every move-first plan misclassify as
`ready-first`. The controller now narrows by type, controller and participation
itself, and never records a `participantOnly` source as a first leg.

**2. `meetsRequirements` returns `'target'` when no legal target exists** — which
is exactly the state a move-first plan is trying to create. The projection for
participant-only sources therefore asks with `ignoredRequirements: ['target']`,
so the source's own condition, phase, costs and once-per-round limit are all
still enforced while the missing participant is not held against it.

## The planner is blind at the target prompt

`sequenceSourceTargets` asks the engine whether each source is usable. A source
that is **mid-resolution is not usable**, so at the target prompt that follows
an activation the move options come back empty and the plan disappears exactly
when the target has to be chosen. Measured: the planner answered **0 of 237**
Unicorn move-target prompts.

`readyMoveCommittedMove` fixes it — the body and source a stage-`move` plan
committed to are remembered for the duration of that conflict and reused at the
target prompt. Same class of bug as the ready leg's `preferUuid`, same fix.

## Unicorn: the deck model vs the generic planner, measured

The owner's question was which logic Unicorn should use, so it is a knob
(`readyMove.deferToDeckMovePlanner`, default `true` = the deck model) and not an
assumption.

**Do they even disagree?** Over 64 Unicorn games on two bases, 244 move windows:

```
both answered : 82  (agree 73, DISAGREE 9)
planner only  : 7
deck only     : 155
```

The nine disagreements all have the same shape — the deck model takes the body
whose MOVEMENT triggers something, the generic planner takes raw skill:

```
golden-plains-outpost: planner=warrior-poet          deck=moto-outrider
golden-plains-outpost: planner=minami-kaze-regulars  deck=twilight-rider
golden-plains-outpost: planner=moto-youth            deck=iuchi-soulweaver
ride-on:               planner=minami-kaze-regulars  deck=border-rider
```

**Win rate**, `probePaired` with `ONLY=Unicorn`, both seats, 8 bases, 256 games:

| | |
|---|---:|
| decided games | 10 (3.9%) |
| toward the generic planner | 2 |
| toward the deck model | 8 |
| two-sided sign test | p = 0.109 |
| implied | **−1.17pp** for handing the pick to the planner |

Not significant at n=10, but directionally consistent with the disagreement
analysis: `UnicornTactics` prices Moto Outrider's self-ready, Twilight Rider's
on-move ready, Spyglass, Moto Stables and Outskirts Sentry, and the generic
planner models none of them.

**Decision: `deferToDeckMovePlanner` stays `true`.** The deck keeps its own
movement model; the generic planner supplies the ready legs and the gating.

## Measured (move → ready in isolation)

`readyMove.allowMoveThenReady` isolates this order from the rest of the planner.

**Null arm.** Every `readyMove` knob injected at its own default, base 91001:
**272 of 272 games bit-identical**, 0 flips, seat 0 wins 144 vs 144.

**Firing**, LionDuelist + Dragon, 86 games over three bases:

```
  190  ready-first / ready: ready-then-move-into-conflict
   82  move-first  / ready: ready-after-move
   50  move-first  / move:  move-then-ready-into-conflict
   23  move-first  / move:  move-bowed-for-participation-payoff
  ...
   26  fan-of-command -> even-the-odds
   15  fan-of-command -> matsu-mitsuko
    9  fan-of-command -> formal-invitation
```

Full field, both seats: **16 second legs** of the move → ready order resolved.

**Ceiling.** The revert arm flips 0.0%–0.4% of games, capping the effect at
**0.18pp**. Far under the noise floor, so the pooled flip sign test is again the
instrument.

**Pooled flip sign test**, 10 independent bases, 2720 games:

| | |
|---|---:|
| decided games | 3 (0.11%) |
| toward the change | 3 |
| toward no move → ready | 0 |
| two-sided sign test | p = 0.250 |
| implied | +0.055pp |

Three for three is the right direction and nowhere near enough games to call it.
Treat it as a **null with a correctness payoff**: the order exists so a deck
holding Fan of Command or The Pursuit of Justice can use them at all, and so a
body moved in bowed is actually stood up rather than left contributing nothing.
That is what `botreadyvalue.spec.js` measures; the win rate is not.
