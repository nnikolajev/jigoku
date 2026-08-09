# Fate starvation and the conflict-window census

Two questions this answers, both raised by the "save fate to cast a strong
hand" idea, and both measurable rather than arguable:

1. Does V1 close conflict windows holding fate it could have spent?
2. Does V1 hold cards it WANTS but cannot pay for?

The answers are different, and the second is the one that matters.

## The measurement

`conflictWindowDecision` already wrapped every window close in a `pass(gate)`
helper that names the gate which closed it. Telemetry hangs off that wrapper,
so the census covers EVERY close with no new decision points:

```
CHANGE='{"deckProfile":{"saveFatePass":{"setupRounds":[1,2,3]}}}' \
  KINDS=conflict-window-pass BASES=91001 node tools/selfplay/probePaired.js
```

Injecting the shipped values means the arm is bit-identical to the control, so
the run measures the LIVE bot rather than a variant. 272 games, 9286 closes.

## Question 1: fate held at close — real, but mostly correct

```
mean fate held at close        3.13
mean affordable playable cards 5.44
closes holding BOTH            69.0%
```

Sounds damning until the gates are read:

| gate | count | is the bot wrong? |
|---|---:|---|
| `no-card-passed-intent-filter` | 2519 | maybe |
| `attack-already-breaking` | 1486 | no — conflict already won |
| `defense-already-winning` | 1230 | no — already won |
| `defense-province-safe` | 411 | no |
| `attack-deficit-too-large` | 382 | no — already lost |
| `defense-deficit-too-large` | 183 | no — already lost |

About 3100 of those closes are the bot declining to spend on a conflict that is
already decided. Extra fate buys nothing there.

The remaining gate is real: **4060 closes had at least one card the engine
reported playable and affordable, and zero had "all candidates unplayable".**
Most declined: `assassination` 1889, `banzai` 783, `regal-bearing` 714,
`court-games` 700, `display-of-power` 689.

## Question 2: fate STARVATION — the measurement that was missing

**`isPlayableByMe` already folds in cost.** A card priced above the pool reports
false, so it never appeared in the "affordable" count above. Measuring
"affordable and declined" is structurally blind to the cards the bot cannot
pay for — which are exactly the ones a banked-fate policy would buy.

Counting hand cards with `cost > 0 && cost > fate` instead:

```
closes holding >=1 UNAFFORDABLE card   4493 / 9286 = 48.4%
mean unaffordable cards per close      1.57
fate held at close: 0 fate x2533, 1 fate x1799  -> ~47% of closes on <=1 fate
```

High-priority (>=7) cards the bot could not afford:

| card | closes | | card | closes |
|---|---:|---|---|---:|
| display-of-power | 836 | | consumed-by-five-fires | 449 |
| feral-ningyo | 719 | | against-the-waves | 370 |
| forebearer-s-echoes | 673 | | regal-bearing | 341 |
| isawa-tadaka-2 | 620 | | elegant-tessen | 307 |
| stolen-breath | 471 | | pit-trap | 220 |

Cost distribution of those starved cards: **4895 at cost 1, 4288 at cost 2**,
2219 at 3, 1285 at 5. The bot is not short five fate for Five Fires. It is
chronically short ONE OR TWO.

## What was built on it, and what happened

Two levers, both off by default, both measured against the shipped V1.

**`aggressiveSpend`** (`AggressiveSpendPolicy.ts`) — force the best legal
affordable card at the `no-card-passed-intent-filter` gate instead of passing.
Runs last, after every ordinary path has declined, so it can only fill a window
that was going to be passed. Census of what it forces: 3.65 plays per game,
**722 of 992 costing ZERO fate**, at playbook priority 8-10.

| arm | field total |
|---|---:|
| priority >=5, one per round | -0.92pp (p=0.23) |
| priority >=9, one per round | +0.14pp (p=0.88) |

Null field-wide. Both arms produce the same per-deck outlier: Lion, at +7 net
with **7 wins and 0 losses among decided games** (p=0.016), on both seats and
four bases. On six bases never used to find it:

```
control 60.42%   treated 60.42%   delta 0.00pp
flips 9 to / 9 away   sign-p 1.0000
```

Exactly zero. A 7-0 record on 4 bases became 9-9 on 6 fresh ones.

**`saveFatePass.handReserve`** — hold back the cheapest wanted card's cost
(capped) from the dynasty budget, feeding the existing `dynamicFateReserve` by
`Math.max`. Decks with a larger reserve of their own are untouched by
construction, which the census confirms: PhoenixPhoenix and PhoenixShugenja
show exactly 0 flips.

| arm | field total | ScorpionBidWar |
|---|---:|---:|
| reserve <=1 fate | **-1.98pp** (p=0.0095) | +11 net, +8.59pp, p=0.007 |
| reserve <=2 fate | -4.14pp seat 0 (p=0.0008) | +4 |

Field-wide negative, and the damage scales with the reserve — the same
dose-response as every other member of this family.

### The ScorpionBidWar row did NOT replicate

It was the obvious per-deck ship: the deck whose own strategy guide says
"saving fate is huge", positive on both seats, p=0.007. On six bases never used
to find it (`deckFieldWinRate`, 192 paired games):

```
control 54.69%   treated 49.48%   delta -5.21pp
flips 12 to / 22 away   sign-p 0.12
per base +5/-2  +0/-3  +1/-5  +1/-4  +1/-6  +4/-2   negative on 4 of 6
```

**A complete sign inversion.** The screen tested 17 decks x 3 arms = 51 per-deck
rows, so two or three rows at p<0.05 are expected from noise alone; this was
one of them, and its p-value came from n=128 on the very bases that selected
it. Nothing here ships.

## Both per-deck candidates failed the same way

| candidate | on the SEARCH bases | on FRESH bases |
|---|---:|---:|
| ScorpionBidWar, hand reserve <=1 | +8.59pp, p=0.007 | **-5.21pp** |
| Lion, aggressive spend | +7 net, 7-0 decided, p=0.016 | **0.00pp**, 9-9 |

Neither survived. Between the two screens this work tested roughly 100 per-deck
rows; at p<0.05 that yields five false positives by construction, and the two
that looked most compelling — one of them the very deck whose strategy guide
motivated the whole investigation — were exactly that.

**Nothing from this work ships.** `aggressiveSpend` and
`saveFatePass.handReserve*` are off by default and inert; the shipped V1 is
unchanged (`refactorIdentity` SHA `8be2f841e93307cf` throughout).

## The reusable lesson

`isPlayableByMe` folds cost into playability. Any census of "what could the bot
have played" that filters on it is blind to fate starvation by construction,
and will conclude that fate is not the constraint no matter how starved the bot
is. Measure `cost > fate` separately — it is a different population and, at
48.4% of window closes, a much larger one.

## Redo with the reserve ON: skip turn 1, 2 or 3, then protect the proceeds

The earlier skip arms all ran with the reserve OFF, so a skipped phase banked
fate that went straight back into the next dynasty purchase. The obvious
objection — "the bot never actually kept the fate" — is testable, and it is
wrong. All arms 2176 paired games, both seats, four bases, against shipped V1.

| skipped turn (+ hand reserve) | result |
|---|---:|
| turn 1 | **-24.08pp** (190 to / 714 away, p<0.0001) |
| turn 2 | **-16.77pp** (197 to / 562 away, p<0.0001) |
| turn 3 | **-10.94pp** (190 to / 428 away, p<0.0001) |

**The earlier the skipped turn, the more it costs** — the inverse of the human
intuition that early turns are cheap to give up. In this bot the first dynasty
phase is the most valuable one: board advantage compounds from it, and round 1
is also where the shipped fate floor does its work, so skipping it forfeits
that too. No deck was positive in the turn-1 arm.

### The mechanism WORKED. That is the point.

Conflict-phase state, shipped baseline versus skip-turn-2 + reserve:

| | baseline | skip + reserve |
|---|---:|---:|
| mean fate at window close | 3.13 | **4.49** |
| mean unaffordable cards | 1.57 | **1.27** |
| closes on <=1 fate | 46.7% | **38.0%** |

The bot carries 43% more fate into conflicts, is starved 19% less often, and
goes broke at the decisive moment far less. Every intermediate step of the
theory is confirmed. It still loses by 17pp, because the dynasty phase the fate
came from was worth more than the cards the fate unlocked.

### Isolated: the reserve makes the skip WORSE, not better

Same board-gated round-2 skip, reserve as the only delta:

| | pooled |
|---|---:|
| round-2 skip, reserve off | -3.26pp |
| round-2 skip, reserve on | **-5.38pp** (130 to / 247 away, p<0.0001) |

Both levers withhold resources from the board and their costs ADD. The failure
was never "the banked fate got spent badly".

### The unconditional floor is negative on its own

`flatReserve: 4` in rounds 3-4, no skip at all — the "don't dump 14 fate into
bodies just because the hand is weak" rule:

```
2176 games   124 to / 198 away   -3.40pp   sign-p < 0.0001
```

ScorpionBidWar +7 and Lion +4 lean positive; neither is significant, and both
decks have already produced inverted false positives in this work.

### A near-miss worth recording

The first run of the flat-floor arm reported **0 flips, 1088/1088
bit-identical** — which would have been written up as "the floor is null". The
feature had been written but never compiled; the harness runs compiled JS. The
reachability check caught it. `npx tsc` before every arm, and treat a 0.00pp
result as a build question before a behaviour one.

### The costs are ADDITIVE, which is the cleanest summary of the whole family

| configuration | pooled |
|---|---:|
| round-2 skip alone | -3.26pp |
| flat floor alone (4 fate, rounds 3-4) | -3.40pp |
| round-2 skip + hand reserve | -5.38pp |
| round-2 skip + flat floor | **-7.26pp** |

Every lever in this family withholds a resource from the board, and stacking
two of them costs about what the two cost separately. There is no configuration
in which the pieces rescue each other — the resource each one saves is worth
less than the board presence it gives up, so combining them only compounds the
loss.

## SHIPPED: `aggressiveSpend` for Crab

The per-deck round robin — each deck carrying an arm against the 16 OTHER decks
without it, paired against the same deck unarmed on identical shuffles — found
one row that survived confirmation.

### Why the field total hid it

Field averages for these arms are ~zero while individual decks move 9-11pp:

| arm | field | best deck | worst deck |
|---|---:|---|---|
| reserve <=1 | -1.53pp (p=0.014) | DragonAttachments +2.6 | ScorpionBidWar -5.7 |
| force >=5 | -1.07pp (p=0.065) | **Crab +4.7** | ScorpionBidWar -6.8 (p=0.024) |
| force >=9 | -0.34pp (p=0.53) | Crab +3.6, CraneDuels +3.6 | Dragon -4.7 (p=0.035) |

These changes are not generic. Reading only the field total would have
discarded a real per-deck gain and hidden a real per-deck harm.

### The confirmation

Three rows cleared the pre-registered +3pp bar on the six-base screen and were
retested at 40 games per opponent (20 bases, 640 games) on bases never used:

| candidate | screen | deep retest, FRESH bases |
|---|---:|---:|
| **Crab + force >=5** | +4.7pp | **+3.91pp**, 54 to / 29 away, **p=0.008**, positive on 15 of 20 bases |
| Crab + force >=9 | +3.6pp | +3.28pp, 47 / 26, p=0.019 |
| CraneDuels + force >=9 | +3.6pp | +0.78pp, p=0.67 — did NOT replicate |

Crab's gain is broad rather than one matchup: Lion +10/-0, Unicorn +8/-3,
Crane +5/-0, LionHonor +5/-2, PhoenixShugenja +5/-3.

**Shipped** on the `crab-defense` override as
`aggressiveSpend: { enabled: true, minPriority: 5, maxPerRound: 1 }`. Verified
live: Crab's control re-run on the same 20 bases post-ship scores **45.00%**,
exactly the arm's number and up from 41.09%. A profile scan confirms
`crab-defense` is the only override matching any deck in the registry, so
CrabSacrifice (-3.1pp on this arm) is untouched.

### Scoreboard for the whole investigation

Rows that looked significant on their search bases and then failed on fresh
ones: ScorpionBidWar + reserve (+8.59 -> -5.21 -> -5.7 across two independent
confirmations), Lion + aggressive spend (7-0 decided -> 9-9), CraneDuels +
force9 (+3.6 -> +0.78). One row replicated: Crab. That is roughly the rate
expected when ~100 deck/arm rows are screened, which is why the fresh-base
retest is the step that decides a per-deck ship.

## Ring fate: already fully exploited, and the raid variants fail

### The census: zero leakage

Ring fate goes to the ATTACKER at declaration (`conflictflow.ts`,
`OnConflictDeclaredBeforeProvinceReveal` -> `takeFateFromRing`), win or lose —
it only requires that at least one attacker was declared. So a declared
conflict is free, immediately spendable fate. Census over 544 games:

```
ring declarations            5667  (10.42 per game)
took the MAX-fate ring       5667 / 5667 = 100.0%
took 0 while fate available  0 = 0.0%
mean fate taken              0.817
mean best available          0.817   (identical to three decimals)
```

V1 (`FateAwareJigokuBotPolicy`) scores any fate-bearing ring at `1000 + fate*100`
against a best base score of ~65, so fate dominates ring effect entirely. **The
bot never once left fate on a ring.** There is no headroom in ring CHOICE.

Piles are also small — 3161 of 3861 fate-bearing declarations carry exactly 1
fate, and only 8 in 544 games carry 4+ — precisely because the bot always takes
them.

### The raid: cap an unbreakable attack at one body

The only remaining lever is how many bodies are spent collecting the fate.
Expressible with the existing `hopelessAttackKeepHome` (cap = max(1, eligible -
keepHome), so 99 forces one) plus `hopelessAttackReach: 0` to apply it to any
attack that cannot break.

```
17 decks, 3264 games   FIELD -0.34pp   sign-p 0.46
LionHonor +4.7 (p=0.093)   Scorpion +2.1  ...  CraneHonor -4.7   Crab -5.2 (p=0.031)
```

**Half the field cannot reach it**: zero flips for CrabSacrifice, Dragon and
Lion, and <=5 flips for Crane, LionDuelist, DragonAttachments, PhoenixPhoenix.
Those rows are unmeasurable, not neutral. Only 183 flips in 3264 games.

LionHonor was the sole candidate and did not replicate:

```
screen (240001-245001)     52.6% -> 57.3%   +4.7pp
deep, 20 FRESH bases       54.8% -> 54.2%   -0.63pp, 38 to / 42 away, p=0.74
```

### Raid + hand reserve: clearly negative

```
17 decks, 3264 games   FIELD -3.32pp   sign-p < 0.0001
Crab -9.4 (p=0.013)   Unicorn -6.3 (p=0.043)   LionDuelist -6.2 (p=0.043)
```

The reserve dominates, as on every rig it has been measured on.

### Known implementation limitation

Attack candidates are ordered `sortBySkillDesc`, so a one-body raid sends the
bot's STRONGEST attacker, not a cheap one. That is the opposite of the idea's
intent ("one cheap character just to collect the fate") and bows the best body
for ~0.8 fate. A cheap-body variant would need a reversed pick for raid
commits and has NOT been measured. The result above is therefore a verdict on
the raid as implemented, not on the cheapest possible version of it.

### The cheap-body raid: the ordering fix removed the harm but created no value

`hopelessAttackWeakestFirst` walks the (strongest-first) candidate list from the
weak end, so a capped hopeless attack sends the cheapest CONTRIBUTING body —
candidates are already filtered to skill > 0 — instead of the best one. The
ring's fate transfers at declaration either way, so the cheap body buys the
same fate and keeps the good one ready.

Per deck, 17 decks, 3263 games, fresh bases:

```
FIELD -0.12pp (p=0.85)
Crab +5.7 (p=0.035)   UnicornReveal +3.1   LionDuelist +2.6
PhoenixShugenja -4.7 (p=0.049)   Scorpion -3.6
inert (0 flips): CrabSacrifice, Dragon, Lion
```

The fix did what it was predicted to do — same decks, strongest-body versus
weakest-body:

| deck | strongest | weakest | swing |
|---|---:|---:|---:|
| Crab | -5.2 (p=0.031) | +5.7 (p=0.035) | +10.9 |
| UnicornReveal | -1.0 | +3.1 | +4.1 |
| CraneHonor | -4.7 | -1.0 | +3.7 |

Reach improved too (11.4% of games flipped versus 8.5%). But the candidate did
not survive:

```
Crab, screen (270001-275001)      46.9% -> 52.6%   +5.7pp
Crab, deep 20 FRESH bases         46.7% -> 47.3%   +0.63pp, 39 to / 35 away, p=0.73
```

**Verdict:** sending the strongest body on a doomed attack is genuinely bad
(-5.2pp for Crab on its own bases). Sending the cheapest is merely neutral.
The ordering was a real implementation flaw and fixing it removed real harm,
but the raid itself buys nothing — a ring holds 0.817 fate on average, and one
bowed body is not worth less than that. Nothing ships.

### Candidate survival rate for this whole line of work

Six deck/arm rows reached a fresh-base confirmation; one survived.

| candidate | search | fresh bases |
|---|---:|---:|
| Crab + aggressiveSpend >=5 | +4.7 | **+3.91, p=0.008 — SHIPPED** |
| ScorpionBidWar + reserve | +8.59, p=0.007 | -5.21, then -5.7 |
| Lion + aggressiveSpend | 7-0 decided, p=0.016 | 0.00, 9-9 |
| CraneDuels + aggressiveSpend >=9 | +3.6 | +0.78 |
| LionHonor + raid (strongest body) | +4.7 | -0.63 |
| Crab + raid (cheapest body) | +5.7, p=0.035 | +0.63 |

Roughly 120 deck/arm rows were screened across this work, so five or six rows
at p<0.05 arise by chance alone. The fresh-base retest is the only step that
separates them, and a screen p-value — however small — is not evidence.

## Shipped on a null confirmation (user decision)

Two further per-deck configs were shipped by explicit request despite their
deep retests being indistinguishable from zero. They are recorded here so
nobody later mistakes them for measured wins.

| config | screen | 40 games/opponent, FRESH bases |
|---|---:|---:|
| CraneDuels + `aggressiveSpend minPriority 9` | +3.6pp | +0.78pp, 47 to / 42 away, **p=0.67** |
| Crab + cheap-body raid (on top of its shipped `aggressiveSpend`) | +5.7pp, p=0.035 | +0.63pp, 39 to / 35 away, **p=0.73** |

Post-ship verification on the same deep bases:

- CraneDuels: shipped-vs-old-control shows **94 flips and a delta of exactly
  0.00pp** — the config is live and changes games, and its net effect over 640
  games is zero.
- Crab: 46.72% (pre-ship) -> 47.03% (post-ship), i.e. +0.3pp, consistent with
  its null.

**What IS established for Crab's raid** is the ordering, not the gain: the same
cap sending the STRONGEST body measured -5.2pp (p=0.031) for this deck. So
`hopelessAttackWeakestFirst` is load-bearing — the cap must never be enabled
without it.

### Measurement note: injected arm != shipped override

The shipped configs are not bit-identical to the injected arms that measured
them (CraneDuels differs on 15 of 640 games, Crab on 2), despite identical knob
values. The likely cause is `applyV2DeckProfile`, which runs over the resolved
deck profile on the v2 path and now sees `aggressiveSpend` already present in
the base profile rather than arriving only as an injection. It does not change
either verdict — both measure ~0 by either route — but the two paths are not
perfectly interchangeable, so a future ship should be verified by re-running
the deck post-ship rather than assuming the arm's number carries over.
