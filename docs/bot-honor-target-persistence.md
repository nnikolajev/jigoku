# Honoring a body that can still use the token

`DeckProfile.personalHonor.honorTargetPersistence` — field-wide policy, lives in
`PersonalHonorTactics.persistenceTier`.

## The defect

An honor token adds the character's **glory** to both of its skills for as long
as the token is on it. V1 ranked honor targets by glory alone, which prices the
token as if the body were going to be around to use it.

Seen live, 2026-08-25, Dragon vs Phoenix, round 2 conflict 1. The bot won the
fire ring while attacking with Togashi Mitsu (glory 3, **0 fate**) and Togashi
Ichi (glory 2, 2 fate). Both were participating, so both would bow out of the
conflict on resolution. The ring honored Mitsu — highest glory — and Mitsu was
discarded in that round's fate phase, having contributed the +3 to nothing. Ichi
had two more rounds of life in front of him.

## The rule

Rank by how much LATER use the token can have, then by glory inside each tier:

| tier | reading |
|---|---|
| 2 | `fate > 0` — the body survives the fate phase, so the token pays every round |
| 1 | still STANDING after this conflict resolves **and** a conflict opportunity remains on either side |
| 0 | bows out of this conflict and is discarded in the fate phase |

Tier 1 has two sources, and both are read rather than guessed:

- a `DoesNotBow` effect is on the body (Sacred Sanctuary, Iron Foundations
  Stance, Swell of Seafoam, Centipede Tattoo, Clarity of Purpose, ...). The
  serialized card summary publishes `bowed` and nothing about the coming
  resolution, so `JigokuBotController.noBowCharacterUuids` asks the ENGINE
  (`DrawCard.bowsOnReturnHome()`) and passes the uuid set down as
  `noBowCharacterUuids`. No hand-written card list is involved;
- the body is READY and is not in this conflict at all, so it was never going to
  bow — it can attack or defend a later conflict this round.

With **no** conflict left on either side, tier 1 collapses into tier 0: "still
standing" buys nothing once nothing can be declared, and only fate counts. This
is the same reading `ReadyValuePolicy` uses for a ready.

With every candidate in tier 0 the ordering is unchanged and the highest-glory
body takes the token, which is the user's "if no option available honor highest
glory character".

## Where it applies

Every own-honor pick routes through `PersonalHonorTactics.pickOwnHonor`, so one
change covers the fire ring, Court Games' honor half, Asako Diplomat, Shameful
Display and the generic `honor-own-highest-glory` path. Field-wide, not
deck-scoped: the rule is about the token, not the archetype.

## Measurement

`false` reproduces V1 exactly (`refactorIdentity` SHA `409b3d34aaa6bfad` with the
knob absent and with it injected at `false`).

| rig | games | result |
|---|---:|---|
| null arm, head-to-head | 1614 / 3 bases | **807-807, exactly 50.00%**, every base 269-269 |
| head-to-head, `true` | 1615 / 3 bases | 807-808, **49.97%**, z=-0.02, **p=0.980** |
| paired probe, seat 0 | 3264 / 6 bases | 27 winners flipped, 9 to / 18 away |
| paired probe, seat 1 | 3264 / 6 bases | 25 winners flipped (**1.5%**), 13 to / 12 away |
| **pooled flip sign test, both seats** | 6528 / 6 bases | **22 to / 30 away, 52 decided, p=0.27** |

The **ceiling is 1.10pp** — 94.1% of games are bit-identical — so no
head-to-head can resolve this lever, and the 49.97% above is a statement about
the noise floor, not about the rule.

The seat split is the usual one and it cancels when pooled: seat 0 read 9/27
(33%) and seat 1 read 13/25 (52%). Neither the head-to-head nor the pooled flip
test can separate this from zero, and both point at "no measurable effect".

This is a correctness class, the same standing as `polarityGuards`,
`attachmentTarget` and `moveIntoConflict`: the decision it changes is provably
the better one (a token on a body that is discarded three prompts later is worth
zero), it fires rarely, and it does not move a win rate. Do not re-measure it
hoping for a number.

## The optimization that was prepared and not needed

`honorTargetPersistenceMaxGloryGap` (default 99 = uncapped) caps how much GLORY
the rule may give up: a candidate more than that far below the best glory on the
board keeps tier 0 and is only reached by the ordinary glory ordering. It exists
because the obvious way for this rule to be WRONG is trading a large present
swing (a glory-4 body in the conflict being fought now) for a small future one
(a glory-1 body that survives). The pooled flip test came back at p=0.27 with no
directional signal, so there was nothing to tune toward; the knob ships uncapped
and is the first thing to try if a future replay shows the rule giving up too
much glory.
