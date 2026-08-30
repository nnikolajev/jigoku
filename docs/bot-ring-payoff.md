# Generic card → element ring steering (`RingPayoffPolicy`)

**Shipped field-wide 2026-08-30.** Correctness class — do not re-measure it
hoping for a win-rate number.

## The defect

Live replay, 2026-08-30, `Jigoku Bot` (Unicorn Reveal) vs `kingitus` (Phoenix),
round 1 conflict 1:

```
Jigoku Bot plays Kudaka with 2 additional [fate]
...
Jigoku Bot is initiating a [military] conflict at province 1, contesting the void ring
```

`Kudaka` reads *"after you claim a ring — if the conflict or the ring has the
air element, gain 1 fate and draw 1 card"* (limit twice per round). It was the
bot's **only character in play**, no ring carried any fate, and the bot
contested **void**.

Nothing was broken in the ring code. `JigokuBotPolicy.ringElementBase` ranks
elements by their printed effect:

| element | base | why |
|---|---:|---|
| void | 50 / 10 | 50 while the opponent has a fated body to strip |
| earth | 40 (+35 omniscient) | draw + random discard |
| water | 8 – 75 | bow targets, plus a ready bonus priced from the bowed body |
| fire | 30 | honor / dishonor |
| air | **15** | `default` |

The opponent had a 3-fate Prodigy of the Waves standing, so void scored 50 and
air scored 15. Correct for a board with no element payoff on it, wrong for this
one.

## Why no existing mechanism covered it

Two decks in the field already steer air with Kudaka, and **each does it inside
its own archetype's tactics module**:

- Phoenix Shugenja — `ShugenjaTactics.ringPlanScore`, via
  `ringPlanKudakaAirValue: 1.5` fate-equivalents.
- Phoenix "Phoenix" (Fushichō rotation) — `RebirthTactics.ringBonus`, via
  `ringPayoffsByElement.air: ['kudaka']`.

Neither is reachable from any other deck. Unicorn Reveal runs **2 copies** of
the same card and had no owner for the preference at all.

## The rule

`RingPayoffPolicy` (`DeckProfile.ringPayoff`) is the generic half: an
element → card-id map applied field-wide inside `ringScore`, keyed on the
**card standing on the board** rather than on the archetype. A deck that runs
none of the cards is bit-identical.

```ts
payoffsByElement: { air: ['kudaka'] }
bonusPerCard: 80
fateDominanceThreshold: 1
```

**80 is not arbitrary.** The sub-fate band tops out at 75 — water with a full
`readyRingBonus` (cap 40 on top of 35), earth with
`omniscientEarthRingThreatBonus: 35`. Air's base is 15, so a bonus below 60
would silently do nothing on a live board. The fate tier starts at 1000, so the
bonus can never outrank a fate pile.

### Subordinate to fate, on every seed

The attacker banks a ring's fate at **declaration**, whether or not the conflict
is won; Kudaka only pays once the ring is **claimed**. So a ring carrying fate
wins.

`ringScore`'s own fate threshold is **1 for a fate-aware policy and 2
otherwise**, and between them a bonus this size would take a bare air ring over
a ring carrying one fate on half the seeds. While a payoff is live on the board
the threshold drops to `fateDominanceThreshold: 1`, so *"steer to air, unless
there is fate on another ring"* holds everywhere. The lowering is scoped to a
board that actually carries a payoff card — nothing else moves.

`normalizedRingEffectValue` subtracts the fate tier back out to get a fate-free
0-50 effect score, so it reads the threshold from the same place. Reading a
different one would leave a `1000` behind and clamp every ring to 50.

### One owner per deck

`ringPayoff: { enabled: false }` on `phoenix-shugenja-ring-plan` and
`phoenix-phoenix-fushicho-rotation`. Their own models already price Kudaka —
the Rebirth one against a *fire guard* (Isawa Tsuke wants fire left unclaimed)
that steers **away** from an element, a balance the flat bonus is not part of.
Same doctrine already written into the Fushichō override: the element
preference has exactly one owner.

### Keyed on the card, so the inversion works for free

`DefenderRingChoicePolicy.scoreForAttacker` calls `ringScore` with the players
swapped and **no deck tactics module**, precisely because every module models
*our* deck. This policy reads the `me` argument's board, so when Togashi
Tadakatsu hands us the element choice against a Kudaka player, the air ring is
exactly the one we refuse to give away.

### No per-round counter is needed

Kudaka's limit is twice per round, but a claimed ring leaves the unclaimed pool
until the fate phase returns it, so the steering can only apply once a round
anyway.

## Measurement

Deck-scoped, so measured with `probePaired.js ONLY=UnicornReveal`, arm inverted
(`ringPayoff.enabled: false`), **both seats, 12 bases, 384 games** on the deck
slice:

| seat | games | flipped | to OFF | to shipped |
|---|---:|---:|---:|---:|
| 0 | 192 | 8 (4.2%) | 3 | 5 |
| 1 | 192 | 4 (2.1%) | 2 | 2 |
| **pooled** | **384** | **12 (3.1%)** | **5** | **7** |

Sign test on 12 decided games: p = 0.77. **Ceiling 1.0-2.1pp on the deck's own
games**, and Unicorn Reveal is one of seventeen decks, so the field-wide effect
is ~0.03pp — no head-to-head can resolve it, and none was run. 87.5-88.5% of
that deck's games are bit-identical; the rest change path without changing the
winner.

This is the same shape as `polarityGuards`, `readyValue`, `attachmentTarget`
and `moveIntoConflict`: the value is that the bot stops throwing away a printed
payoff, not a win rate.

## Tests

`test/server/bots/ringpayoffpolicy.spec.js`:

- reproduces the live defect with the policy disabled (lone Kudaka → void);
- takes air with it enabled;
- inert on a board without the card, both against a fated and an empty enemy
  board;
- defers to a ring carrying one fate, and takes air again once it is gone —
  plus the negative control that the lowered threshold does **not** apply to a
  board with no payoff card;
- beats each of void / earth / fire / water head-on, which is what pins
  `bonusPerCard` against the 75-point band;
- prices the **opponent's** Kudaka at the inverted defender-ring prompt;
- resolves the three real field decklists and asserts exactly one of them —
  `UnicornReveal` — takes the generic steering, so the wiring cannot rot if a
  deck list changes.

## Adding a card

Extend `DEFAULT_RING_PAYOFF.payoffsByElement`. The entry belongs here when the
payoff is *"claiming this element pays something the printed ring effect does
not cover"* and the card is not already priced by an archetype module. If it is
priced by one, that module keeps the ownership and the deck sets
`ringPayoff: { enabled: false }`.
