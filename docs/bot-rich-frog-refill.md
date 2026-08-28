# City of the Rich Frog: an all-or-nothing refill province

## The engine fact

`City of the Rich Frog` prints:

> **Eminent.** After setup, fill this province to 3 cards. When you would refill
> this province, refill it to 3 cards instead of 1.

The second sentence is a persistent effect (`AbilityDsl.effects.refillProvinceTo(3)`),
and the refill it modifies is `Player.replaceDynastyCard`:

```ts
replaceDynastyCard(location: string): boolean {
    const province = this.getProvinceCardInProvince(location);
    if(!province || this.getSourceList(location).size() > 1) {
        return false;                       // <-- the whole story
    }
    ...
    const amount = (province as any).mostRecentEffect(EffectNames.RefillProvinceTo);
    this.refillProvince(location, amount || 1);
}
```

`getSourceList(location)` holds the province card **plus** its dynasty cards, so
`size() > 1` means "any dynasty card is still there". Every other province holds
exactly one card, so buying or discarding it always empties the province and the
refill follows automatically. Rich Frog holds three, which makes it
**all-or-nothing**:

| left on the province at the end of the fate phase | next dynasty phase |
|---|---|
| 0 | **3 fresh cards** |
| 1 | 1 card — and it stays at 1 until it empties again |
| 2 | 2 cards |

A partial discard is therefore strictly worse than either extreme: it throws
cards away *and* gets nothing back.

## What the bot used to do

The end-phase rules (`MulliganTactics.endPhaseKeepSet`) are per CARD and applied
across every province at once: keep 1-2 desirable characters, keep up to
`endHoldingLimit[band]` holdings, keep `keepDynastyCardIds`. Nothing in that set
knows a province exists.

So a single keep landing on Rich Frog silently capped it for the rest of the
game. Measured on six games of Dragon Attachments, the province held a mean of
**2.31** cards when the dynasty phase opened (`1=5 2=1 3=10` over the unbroken
rounds) instead of the 3 it prints.

## The rule

`MulliganProfile.refillProvinceIds` (default `['city-of-the-rich-frog']`) marks a
province as all-or-nothing. For each such province the fate-phase decision is
made **once, for the whole province**:

* count the deck's Rich Frog priority characters sitting on it;
* at or above `refillProvinceMinPriorityCharacters` (default 2), discard
  **nothing** there — the contents beat a fresh three;
* below it, discard **everything** there, holdings included, so the fate phase
  refills to 3.

Applied last, after `applyForcedDiscards`, because a forced id on such a province
would otherwise discard one card and block the refill for the other two — the
worst of both rules rather than either of them.

### The priority list is deliberately NOT `preferredCharacterIds`

`refillProvincePriorityCharacterIds` is its own field. `preferredCharacterIds` is
the opening-mulligan and end-phase character RANKING and runs 4-9 ids deep, which
is most of a deck's curve; a province is worth blocking a refill for only for the
two or three cards the deck actually plays to hit.

| deck | list |
|---|---|
| Dragon (monks) | `togashi-mitsu-2`, `togashi-tadakatsu`, `togashi-ichi` |
| Dragon Attachments | `niten-master`, `togashi-yokuni` |
| Lion (ashigaru swarm) | `akodo-toturi`, `honored-general` |
| Lion Honor | `akodo-toturi`, `honored-general` |
| Lion Duelist | `matsu-tsuko-2`, `akodo-toturi`, `matsu-mitsuko` |
| Phoenix Phoenix | `fushicho` |

Empty means nothing qualifies, so the province is emptied every fate phase. That
is the right default for a deck that just wants three fresh cards, and it is the
`off` arm for one that does not.

## Three reads that MUST come from the engine

The serialized board a policy sees cannot answer any of these, and each one was
wrong before `JigokuBotController.provinceRefillState` was added.

**1. A BROKEN province refills to 1.** `ProvinceCard.isBlank()` returns
`this.isBroken || dishonored || super.isBlank()`, so a broken province loses its
own persistent effects — including `refillProvinceTo(3)`. A broken Rich Frog is
an ordinary one-card province for the rest of the game, and no card-id list can
say that. The controller publishes `refillTo` by reading
`mostRecentEffect(EffectNames.RefillProvinceTo)` — the same accessor the refill
itself uses — so the rule cannot disagree with the engine, and the broken case
drops out of the gate for free.

This is not a rare corner. Over six Dragon Attachments games, **11 of 26**
dynasty phases opened on a broken Rich Frog. Once it breaks the province is out
of the rule's reach, which is why the census reports broken rounds separately:
counting them drags the mean toward 1 whatever the rule does.

**2. A facedown dynasty card blocks the refill.** Cards that refill mid-round
enter facedown and are flipped at the start of the next dynasty phase. The fate
phase's discard prompt only offers `card.isDynasty && card.isFaceup()`, so a
facedown card cannot be removed — the province can never reach empty that round
and no refill is coming. Emptying the faceup half would give up cards for
nothing, so the rule stands down. A facedown card also publishes neither id nor
type, so a policy reading the board cannot even see it.

**3. The prompt's card list shrinks as the bot clicks.** `JigokuBotPolicy` drops
already-attempted uuids so the prompt can reach `Done`. A plan recomputed on that
shrinking list can flip from wipe to keep halfway through and strand cards on the
province — exactly the state the refill needs empty.

## Telemetry

Three kinds, all off unless a sink is attached:

| kind | recorded by | says |
|---|---|---|
| `province-play` | `JigokuBotController` on `OnCardPlayed` with `playType === playFromProvince` | which province each dynasty buy came out of |
| `province-stock` | `JigokuBotController` on `OnPhaseStarted` (`dynasty`) | how full each own province actually is, and whether it is broken |
| `refill-province-plan` | `MulliganTactics.pickDynastyDiscard`, on the `Done` tick | keep vs wipe, and how many priority characters were there |

`BotTelemetry` is a global static sink shared by BOTH controllers in a game, so
`province-play` and `province-stock` carry a `player` field and must be filtered
by seat. `refill-province-plan` is recorded inside the policy and has no seat;
filter it by province id instead.

```sh
# after
SUBJECT=DragonAttachments GAMES=2 node tools/selfplay/analyzeRichFrog.js
# before
SUBJECT=DragonAttachments GAMES=2 \
  ARM='{"deckProfile":{"mulligan":{"refillProvinceIds":[]}}}' \
  node tools/selfplay/analyzeRichFrog.js
```

Pass `ARM='{}'` for the after arm when comparing, so both run through the same
V2 pass-through injection path.

## Results

### The mechanic (32 games per deck per arm, base 91001, both seats)

Cards on the province when the dynasty phase opens — the number the rule exists
to move. Broken rounds are excluded: a broken province refills to 1 whatever the
rule does, and counting those drags every mean toward 1.

| deck | before | after | before histogram | Rich Frog share of dynasty buys |
|---|---:|---:|---|---|
| Dragon | 2.49 | **3.00** | `1=12 2=4 3=39` | 30.4% -> 29.5% |
| Dragon Attachments | 2.84 | **3.00** | `1=3 2=7 3=42 4=4` | 30.2% -> 31.0% |
| Lion | 2.66 | **3.00** | `1=7 2=3 3=40` | 32.4% -> 33.3% |
| Lion Duelist | 2.45 | **2.98** | `1=17 2=9 3=52` | 37.4% -> **42.0%** |
| Lion Honor | 2.61 | **2.98** | `1=6 2=10 3=41` | 38.5% -> 39.8% |
| Phoenix Phoenix | 2.53 | **3.00** | `1=11 2=14 3=51` | 36.6% -> **43.1%** |

Every deck reaches 3.00 (the two 2.98s are the deliberate keeps). The share of
dynasty buys coming off the province rises on five of six decks.

### The keep branch is near-inert at a bar of 2

Counted over the same games, `priorityCount` almost never reaches
`refillProvinceMinPriorityCharacters`:

| deck | keep | wipe | priority characters present |
|---|---:|---:|---|
| Dragon | 0 | 29 | `0=22 1=7` |
| Dragon Attachments | 1 | 27 | `0=18 1=9 2=1` |
| Lion | 0 | 12 | `0=6 1=6` |
| Lion Duelist | 2 | 41 | `0=34 1=7 2=2` |
| Lion Honor | 1 | 27 | `0=21 1=6 2=1` |
| Phoenix Phoenix | 2 | 30 | `0=24 1=6 2=2` |

So essentially all of the value above comes from the WIPE — "empty it every fate
phase so it refills to three". The keep is a safety valve that fires 0-6% of the
time. **`refillProvinceMinPriorityCharacters: 1` is the prepared lever** if the
keep should ever do real work: one priority character is present in roughly a
third of these decisions.

### Lion: the proposed list vs always-wipe

The owner asked for both arms. Measured with `probePaired`, `ONLY=Lion`,
`SEAT=0`, six bases, 96 paired games, `ARMS=both` so the control's own decisions
are visible:

| arm | KEEP | wipe |
|---|---:|---:|
| proposed list (`akodo-toturi`, `honored-general`) | **2** (prio=2) | 47 (`prio=0` x27, `prio=1` x20) |
| always wipe (`refillProvincePriorityCharacterIds: []`) | 0 | 49 |

The list changes 2 of 49 decisions and flips **1 of 96 games** (decided 1-1,
97.9% bit-identical, **ceiling 0.52pp**). The two options are not
distinguishable, and no affordable run can separate them. Shipped with the list
because it is correct when it fires and costs nothing when it does not — not
because it measured better.

Note the `prio=1` row: exactly one tower sits on the province in 20 of 49
decisions. The bar of 2 is what makes the keep rare here, not the list.

### Win rate

| measurement | result |
|---|---|
| null arm (knob at its own default, 3 bases, 1614 games) | **807-807, exactly 50.00%**, every base exactly n/2 |
| ceiling, field-wide (272 paired games, base 91001) | 2.9% of games flip -> cap **1.47pp**; 90.4% bit-identical |
| ceiling, within the six Rich Frog decks | 8 flips / 96 games = **8.3%** -> deck-scoped cap ~4.2pp |

All 8 flips came from the six decks that play the card; the other eleven decks
were bit-identical, which is the scoping check. On that base the decided games
split 7 for the rule, 1 against.

### Pooled flip sign test — the verdict

The ceiling sits near the noise floor for a head-to-head, so the instrument is
the pooled flip sign test the `/roundrobin` skill prescribes: only games the
change actually flips carry information. `probePaired` with the rule turned OFF
on the treated seat, `ONLY=` the six Rich Frog decks, **both seats**, 12
independent bases:

| | games | unchanged | flips | to OFF | to SHIPPED |
|---|---:|---:|---:|---:|---:|
| seat 0 | 1152 | 66.5% | 146 (12.7%) | 71 | 75 |
| seat 1 | 1152 | 68.4% | 162 (14.1%) | 76 | 86 |
| **pooled** | **2304** | 67.4% | **308 (13.4%)** | **147** | **161** |

**p = 0.46 (two-sided), implied +0.30pp for the shipped rule, SE ~0.38pp.**

That is a NULL with a positive sign. Note what it is not: the rule is not inert
— it changes the outcome of 13.4% of these decks' games and the path of another
19%. It simply does not win more of them than it loses. This is the same class
as `polarityGuards`, `attachmentTarget` and `moveIntoConflict`: shipped for
correctness, with a bounded and measured cost of approximately zero. **Do not
re-measure it hoping for a number.**

Per-deck causal rows (only the treated seat is changed, so unlike a head-to-head
these ARE that deck's effect — but they are slices of the same search bases and
are hypotheses, not results):

| deck | to OFF | to SHIPPED |
|---|---:|---:|
| Dragon | 20 | **34** |
| Lion Duelist | 30 | 36 |
| Phoenix Phoenix | 20 | 24 |
| Lion | 31 | 30 |
| Dragon Attachments | 23 | 21 |
| Lion Honor | **23** | 16 |

Dragon is the only row worth a follow-up (p~0.07 on its own), and Lion Honor is
the only negative one. Neither survives the six-way comparison; confirm on fresh
bases before acting on either.

## Where to look next

* `refillProvinceMinPriorityCharacters: 1` — the keep branch fires 0-6% of the
  time at a bar of 2, while exactly one priority character is present in roughly
  a third of decisions. Lowering the bar is the one untried knob with real
  population behind it.
* The province is BROKEN in 45-65% of the dynasty phases measured here, and the
  rule cannot reach those rounds at all. Anything that keeps City of the Rich
  Frog unbroken longer is worth more than tuning this rule.
