# Save fate: the round-one fate-up and the dynasty-phase skip

Two levers that come from the same piece of human deck advice, measured
together and landing in opposite directions. The Kyuden Bayushi bid-war primer
puts it this way:

> Turn two — if you fated your characters and you have two left standing I
> often pass turn two to save fate. [...] saving fate is huge for controlling
> the game later.

That sentence has two halves. **Fate your characters** (round one), then **pass
turn two** (skip the dynasty phase). Both are implemented behind one injectable
profile, `DeckProfile.saveFatePass` (`server/game/bots/SaveFatePassPolicy.ts`),
off for every deck by default.

The measured result is that the two halves do not go together: the setup half
is worth about **+2pp across the field and +14pp for Crane**, and the skip half
is worth about **−4.6pp** and is negative for every deck that reaches it.

## Why the trade looked good on paper

Both halves are paid for by real engine rules, verified rather than assumed:

- **Unspent fate carries over.** Nothing in `FatePhase` empties the fate pool.
- **The first player to pass during the dynasty phase gains 1 fate** —
  `DynastyActionWindow.#handlePassingFate`, gated on
  `GameMode.dynastyPhasePassingFate`, which `stronghold` (Imperial) sets `true`.

So skipping a dynasty phase banks the whole round's income plus one.

## Why the skip half loses anyway

**V1 buys almost every body with zero extra fate, and a body with zero fate is
discarded in the same round's fate phase** (step 4.2, before 4.3 removes a
fate). Censused across the field at the round-two dynasty window:

| own characters in play, round 2 | share |
|---|---|
| 0 | 33% |
| 1 | 57% |
| 2 or more | 10% |

The board the guide describes — two bodies still standing at the start of round
two — is a board V1 essentially never has. Skipping that phase does not bank
tempo; it forfeits the only development the deck gets.

This also killed the first version of the gate. Requiring two characters still
**carrying fate** fired on 3.5% of round-two windows and capped the whole lever
at 0.18pp — under the noise floor, unresolvable by any number of games. The
gate counts characters **in play** instead: reaching the round-two dynasty
phase already means the body survived step 4.2, so being in play *is* the
guide's "left standing".

## Results

Rig: `tools/selfplay/probePaired.js`, which treats exactly one seat, so a
flipped game is that deck's own causal effect. Every arm run on `SEAT=0` and
`SEAT=1` and pooled, four independent shuffle bases (91001-94001), 2176 paired
games per arm. Null arm (`saveFatePass` named but inert) measured **272/272
games bit-identical, zero telemetry events**. The IIFE that wraps the
additional-fate prompt was checked with `refactorIdentity.js`: SHA
`d69d03efce14df76` before and after.

### Skip only — REJECTED, do not retry

`{"earlyRounds":[2,3],"minBoardCharacters":2}`

```
TOTAL 2176 games   54 flips to / 155 away   -4.64pp   sign-p < 0.0001
```

No deck positive. The worst decks are the ones that skip most, and across the
17 decks **fire rate correlates with damage at r = -0.652** — a dose-response,
not noise. `PhoenixPhoenix` never fires and measures exactly 0.00pp, which is
the internal control.

| deck | pp | | deck | pp |
|---|---:|---|---|---:|
| PhoenixPhoenix | 0.00 | | CrabSacrifice | -4.69 |
| Unicorn | -0.78 | | UnicornReveal | -4.69 |
| ScorpionBidWar | -1.56 | | Scorpion | -6.25 |
| CraneDuels | -2.34 | | CraneHonor | -7.03 |
| Dragon | -2.34 | | Crab | -7.03 |
| PhoenixShugenja | -2.34 | | Phoenix | -9.38 |
| Crane / DragonAttachments / Lion / LionHonor | -3.91 | | LionDuelist | -14.84 |

### Setup only — the lever that works

`{"setupRounds":[1],"setupAdditionalFate":1}`

```
TOTAL 2176 games   186 flips to / 142 away   +2.02pp   sign-p 0.0174
seat 0 +1.93pp     seat 1 +2.11pp   (no seat bias)
decisiveness 15.1%
```

It fires 1011 times per 1088 games and **every single time the deck's own
answer was 0 extra fate**; 877 are raised to 1 and 134 cannot afford it. So the
change is precisely "stop buying bodies that are guaranteed to die this round".

| deck | pp | flips |
|---|---:|---|
| Crane | **+14.06** | 22 to / 4 away, p=0.001 |
| CraneDuels | +7.03 | 20 / 11 |
| CraneHonor | +6.25 | 21 / 13 |
| CrabSacrifice | +3.91 | 22 / 17 |
| Dragon | +3.13 | 4 / 0 |
| LionDuelist | +3.13 | 7 / 3 |
| everything else | between +1.56 and -1.56 | — |

Crane read **+14.06pp on each seat independently**. Note the gain is not
proportional to how often the floor fires: Crane fires 0.86 times per game and
gains 14pp, while Lion fires 2.56 times per game for -0.78pp. This is not "more
fate is better" — it is deck-specific, and a deck whose round-one body is worth
keeping alive is the one that gains.

Positive on 4 of 4 bases (+2.57, +0.18, +2.94, +2.39pp).

#### Confirmation, and what shipped

Four bases that FOUND a hypothesis cannot also confirm it, and the paired probe
treats one seat so it cannot rule out a seat interaction. Both were settled on
`tools/selfplay/parallelHeadToHead.js` — changed bots against unchanged bots,
every ordered cross-deck pairing, each played twice on the same shuffle with
the change on opposite sides, baseline a hard 50% — on six bases never used
above:

```
null arm    816-816   of 1632  exactly 50.00%   (every base exactly 272-272)
setup arm  1704-1559  of 3263  52.22%  +2.22pp  z=2.54  p=0.011
per base   +3.49  +1.93  +1.29  +1.47  +4.04  +1.10   positive on 6 of 6
```

The head-to-head (+2.22pp) and the paired probe (+2.02pp) agree to within a
fifth of a point across ten independent shuffle bases.

**Shipped field-wide in `DEFAULT_PROFILE` on 2026-08-07** as
`saveFatePass: { setupRounds: [1], setupAdditionalFate: 1 }`. Verified live
rather than assumed: with the default in place, injecting the same arm on top
of it runs **272/272 games bit-identical while still emitting the telemetry**
(473 events on base 91001, 492 on base 93001), so the shipped default is doing
the work and is exactly the thing that was measured. Bit-identical alone would
not prove that — it is also what a silently-dead default looks like; the
telemetry count is the half that rules it out.

`refactorIdentity.js` baseline moves from `d69d03efce14df76` (pre-ship) to
**`5d788aa561144321`**.

### Per-deck tuning: the DURATION is the lever, not the amount

Three arms against the shipped round-one floor as control, `SEAT=0` and
`SEAT=1` pooled, 2176 paired games each, bases 91001-94001:

| arm | field total | decks clearing the +6 net-flip bar |
|---|---:|---|
| `setupAdditionalFate: 2` | +0.69pp (p=0.45) | Crab +6, LionDuelist +6 |
| `setupRounds: [1,2]` | +0.78pp (p=0.37) | Lion +9, ScorpionBidWar +8 |
| `setupRounds: [1,2,3]` | **+2.80pp (p=0.0030)** | Crab +16 (p=0.002), CraneDuels +9, DragonAttachments +7, Lion +7 |

Raising the AMOUNT does nothing. Extending the DURATION does, which fits the
mechanism exactly: the body that dies for want of one fate is bought every
round, not only in round one.

Confirmed on the head-to-head rig, six bases never used to find it:

```
rounds 1-3  1767-1497 of 3264  54.14%  +4.14pp  z=4.73  p<0.0001
per base    +8.09  +2.94  +2.94  +3.86  +1.47  +5.51   positive on 6 of 6
```

It wins across every win condition, not just conquest: conquest 1282-1098,
honor 184-149, dishonor 301-250. **Shipped 2026-08-08** as
`setupRounds: [1, 2, 3]`.

### Extending past round three: REJECTED

The duration paid twice, so it was natural to ask whether it keeps paying.
Measured against the shipped `[1,2,3]`, both seats, 2176 games each, on the
search bases 91001-94001:

| arm | probe result |
|---|---:|
| `setupRounds: [1..5]` | +1.65pp, sign-p 0.0078 |
| `setupRounds`: every round | +1.79pp, sign-p 0.0039 |

Both look significant. Neither survived:

```
every round, six FRESH bases   1657-1605 of 3262   50.80%  +0.80pp  z=0.91  p=0.363
per base   0.00  +1.66  +2.02  -0.74  +0.74  +1.10
```

**The two probe arms were never independent replications** — they ran on the
same base set, so agreeing with each other told us nothing that one of them
had not already told us. The head-to-head on bases that had no part in finding
the effect puts it at null.

Note the ceiling had already dropped from 18.9% of games flipping (the [1,2,3]
step) to 8.0% here: the marginal rounds touch half as many decisions, and by
round four the bot has fate problems the floor cannot fix. `setupRounds` stays
at `[1, 2, 3]`.

### Retested after the floor shipped — the skip got WORSE, not better

The skip's original failure had a specific cause: V1 reached the round-two
dynasty window with no characters 33% of the time and one 57% of the time, so
there was no standing board to protect. The fate floor fixed exactly that, which
made the skip worth re-measuring rather than inheriting its verdict. It was, on
the current shipped baseline (floor rounds 1-3, skip off), both seats, four
bases, 2176 games per arm:

| arm | passes fired | result |
|---|---:|---:|
| rounds 2+3, two bodies standing | 1805 | **-8.64pp** (137 to / 325 away, p<0.0001) |
| rounds 2+3, three bodies standing | 656 | **-3.31pp** (44 to / 116 away, p<0.0001) |
| board strength ONLY, from round 2, 1.25x | 679 | **-2.99pp** (27 to / 92 away, p<0.0001) |
| board strength ONLY, from round 2, 1.75x | 181 | -0.23pp (6 to / 11 away), **CEILING 0.46pp** |

**It nearly doubled in cost** — the original measurement was -4.64pp. Persistent
boards made the skip MORE expensive, not less, and the reason is the same
mechanism that made the floor work: the bodies V1 buys in rounds two and three
now survive, so they are worth more than they used to be, and the skip is a
decision not to buy them. The floor and the skip are not complements. They are
the same question answered in opposite directions, and the buy side wins.

**The board-strength rule is negative on its own.** Isolated — no round list, the
only question asked being "is this board strong enough to skip" — it fired 679
times on a board that was genuinely ahead (>=1.25x the opponent's skill, three or
more bodies) and won 27 of 119 decided games. Skipping loses even while winning.

**And tightening it to the point where it stops losing removes it.** At 1.75x
the gate fires 181 times in 2176 games for a ceiling of 0.46pp — under the noise
floor, unresolvable, exactly where the round-4 variant landed.

### One turn off, not two

The arms above skip rounds two AND three every time the board allows, which is
not what the advice says — it says skip turn two OR turn three depending on the
board. `maxSkipsPerGame` exists to express that (default 0 = uncapped, so it is
inert unless an arm names it). Measured on the same baseline:

| arm | skips taken | result |
|---|---:|---:|
| round 2 only | 674 | **-3.26pp** (51 to / 122 away, p<0.0001) |
| round 3 only | 1342 | **-6.11pp** (114 to / 247 away, p<0.0001) |
| round 2 OR 3, `maxSkipsPerGame: 1` | 1571 | **-7.26pp** (138 to / 296 away, p<0.0001) |

**Round two is not special.** It looks less bad than round three only because
fewer boards qualify that early — 674 skips against 1342. Per skip actually
taken the two rounds cost the same (-0.48 vs -0.46pp per hundred). Capping to a
single turn off likewise buys only what it declines to spend.

### The whole family is one line

Plotting net flips against skips TAKEN across every scoping measured — round
choice, body bar, per-game cap, strength ratio:

```
arm                        skips  netFlips     pp   pp/100 skips
rounds 2+3 always           1805      -188  -8.64         -0.479
round 2 or 3, cap 1         1571      -158  -7.26         -0.462
round 3 only                1342      -133  -6.11         -0.455
strength only 1.25x          679       -65  -2.99         -0.440
round 2 only                 674       -71  -3.26         -0.484
rounds 2+3, 3-body bar       656       -72  -3.31         -0.504
strength only 1.75x          181        -5  -0.23         -0.127

r = -0.996,  slope = -0.107 net flips per skip taken
```

A skipped dynasty phase costs about **0.107 games** no matter which round it is
taken in, what the board looked like, or how the gate was scoped. That is a
lever with the wrong SIGN, not the wrong scope. Every scoping exercise buys
exactly one thing — fewer skips — and the only scoping that stops losing is the
one that stops firing.

### Per-deck disable: no deck qualifies

The disable arm (`setupRounds: []` against the shipped floor) on a third base
set, 130001-133001, both seats, 2176 games:

```
TOTAL  140 flips to / 182 away   -1.93pp   sign-p 0.0222
```

Turning it off is worse. No deck reads a resolvable gain from having it off:
the only positive row is ScorpionBidWar at +6 (p=0.36), and pooling that with
its earlier run gives -3.1pp over 256 games at p=0.37 — inside the +-2.5pp
noise floor. Every other deck is at or below +2 net flips. So the floor ships
for all seventeen decks and `DeckProfileOverride.saveFatePass` stays unused.

### Telemetry gotcha

`BotTelemetry` is a global static sink: it records BOTH players, not the
treated seat. While the default was off, only the treated seat carried the
profile and the per-deck fire rates above are clean. Now that it ships, a
`save-fate-setup` census counts both bots — round-one raises read 1011 in the
original arm and 1988 in the tuning arms for exactly this reason. Attribute by
seat before reading a per-deck fire rate again.

### Setup + skip round two

`{"setupRounds":[1],"setupAdditionalFate":1,"earlyRounds":[2],"minBoardCharacters":2}`

```
TOTAL 2176 games   164 flips to / 187 away   -1.06pp   sign-p 0.24
```

Against setup-only's +2.02pp on the *same* bases, adding the round-two skip
costs about 3.1pp. Crane keeps +12.50pp there — down from +14.06pp without the
skip — and its skip gate fires on only 2.6% of windows, so even Crane's number
is the setup half paying for a skip that takes some of it back.

### Late rounds only — UNRESOLVABLE, do not tune

`{"lateFromRound":4,"lateSkillRatio":1.25,"minBoardCharacters":2}`

The "skip further turns while the board is strong enough" half of the advice,
measured on its own rather than stacked on the early skip:

```
1088 games   2 flips to / 3 away   -0.09pp   CEILING 0.23pp
```

**Stop here rather than tune it.** A ceiling of 0.23pp is under the noise floor,
so no head-to-head can resolve it and changing `lateSkillRatio` cannot help —
the insertion point is wrong, not the number. The census says why: of 1088
games' worth of round-4+ windows, only 129 reach "board ahead". The rest are
refused because our own provinces are already falling (`losing-race`, 1056) or
the board is too thin (1505). By round four V1 is essentially never in the
position the advice describes.

## Relationship to the already-rejected lever

`dynastyPassFirstForFate` measured **-1.7pp** and was rejected on the
arithmetic: +1 fate *is* a 1-cost body, so passing to collect it is a wash.
This work does not overturn that; it reproduces it at four times the size and
explains it. The claim that the scoped version banks a whole round's income
instead of one fate is true, and still loses, because the income was never the
constraint — board persistence was.

## Knobs

**Only the first two still exist.** The skip half was rejected twice and its
code was deleted with it: `SaveFatePassProfile` now carries `setupRounds` and
`setupAdditionalFate` and nothing else, and the shipped value in
`DEFAULT_PROFILE.saveFatePass` is `{ setupRounds: [1, 2, 3], setupAdditionalFate: 1 }`.
The rest of the table is kept as the record of what was measured — an arm
naming any of those fields today is inert, not a fresh test. Rebuild
instructions are in [bot-fate-experiments-recovery.md](bot-fate-experiments-recovery.md).

| field | status | meaning |
|---|---|---|
| `setupRounds` | **live** | rounds where every body bought gets a fate floor (empty = off) |
| `setupAdditionalFate` | **live** | the floor. Raises the deck's own answer, never lowers it |
| `earlyRounds` | removed | rounds skipped on the round number alone (empty = off) |
| `minBoardCharacters` | removed | own characters in play required before a skip |
| `minPersistentCharacters` | removed | stricter: own characters still carrying fate (0 = off) |
| `lateFromRound` | removed | from this round the skip is gated on the board, not the round (0 = off) |
| `lateSkillRatio` | removed | own board skill / opponent board skill required to skip late |
| `lateMinCharacters` | removed | bodies required before any late skip |
| `minFate` | removed | never skip holding less than this much fate |
| `maxBrokenProvinces` | removed | stop skipping once this many own provinces are broken |

The setup floor deliberately overrides the economy's *budget* cap — spending
one more fate now is the whole claim — but affordability still binds, because
the engine offers only legal amounts and `closestBidButton` picks among them.

---

## STATUS: the skip and reserve code has been REMOVED

Everything in this document about skipping a dynasty phase, the hand-aware
reserve, and the flat reserve describes code that no longer exists. Only the
early-round fate FLOOR survived and shipped
(`saveFatePass.setupRounds: [1,2,3]`, floor 1).

The measurements here remain the record of why those levers were rejected. For
the mechanical recipe to rebuild any of them — field names, call sites, the
consumed base sets, and the reachability checks to run first — see
**`bot-fate-experiments-recovery.md`**.
