# Entrenched Position under the stronghold (13-deck field trial)

**Status: MEASURED, partially shipped.** One province swap, tried on thirteen
decks one at a time, each against the fixed sixteen-deck field.

## The card

`entrenched-position` (Core, neutral, **earth**, deck limit 1):

> **Strength: 5.** This province gets +5 strength during [conflict-military]
> conflicts.

Already implemented (`server/game/cards/01-Core/EntrenchedPosition.ts`) as a
persistent `modifyProvinceStrength(5)` under
`condition: () => this.game.isDuringConflict('military')`. No engine work was
needed.

## The hypothesis

`ProvinceCard.canBeAttacked` gates the stronghold province on
`getProvinces(isBroken).length > 2`, so it is the province the opponent reaches
LAST. That is the slot where a WALL is worth most and an on-reveal payoff is
worth least — the rule that put The Roar of the Lioness under both Lion
strongholds (`bot-lion-roar-province.md`) and moved Illustrious Forge OUT of the
Dragon one (`dragon-attachments-bot.md`).

Most conflicts in this field are military, so a province that is 10 against
military and 5 against political should be the best available wall for that
slot in most decks.

## The bot work this needed

Two separate blind spots, both about our OWN province, which is known
information.

**1. A facedown province's own effects are switched off.** `Effect.isEffectActive()`
gates on `source.facedown`, and the stronghold province is facedown for almost
the whole game. `facedownOwnBaseStrengthDelta` already handled the BASE-strength
case (added for The Roar of the Lioness); Entrenched Position modifies strength,
not base strength, so it fell through.

**2. The engine cannot answer the counterfactual.** The condition closes over the
live game, so there is no way to ask "what would this province be worth if a
MILITARY conflict arrived". `StrongholdDefenseTactics` also carried a single
scalar strength and tested it against both axes, so an axis-conditional province
could not be represented at all.

`JigokuBotController.provinceStrengthByAxis` settles every registered
non-base strength effect against each axis: one that is currently suppressed
(facedown, or its conflict-type condition false) is ADDED to the axes it applies
to, and one that is currently applied is SUBTRACTED from the axes it does not.
Which axes those are is read from the printed text on the card record
(`[conflict-military]` / `[conflict-political]`), the same source
`BaseCard.parseKeywords` parses for attachment restrictions — nothing else in
the serialized state names the conflict type, and a card-id list would go stale.
Text naming neither or both leaves the province exactly where it was.

`StrongholdDefenseInput.strongholdProvinceStrengthByAxis` carries the result;
`survives` and `isPreStrongholdRisk` both price the province per axis. The
controller publishes the map only when the two axes DIFFER, so every deck whose
stronghold province prints a flat number keeps the scalar path.

Verified live: `entrenched-position facedown=true live=7 mil=12 pol=7` (5
printed + 2 stronghold, +5 military). `refactorIdentity.js` is bit-identical
before and after (SHA `561276201d13dcf0`), which is the proof the change is
inert for the shipped field.

## Putting the card in the slot

`DeckProfiles.OVERRIDES` gained a generic entry keyed on the CARD, not an
archetype:

```ts
name: 'entrenched-position-stronghold',
match: (ids) => ids.has('entrenched-position'),
apply: { strongholdProvinceId: 'entrenched-position' }
```

Listed LAST on purpose: a deck holding the card has swapped a province out for
it, so this pick must win over the id its own override named.

## Measurement

A deck-CONTENT arm cannot be injected as a `SUBJECT_PROFILE` — that path is not
bit-clean (`jigoku-subject-profile-rig-fault`). The arms are two BUILDS, selected
by `EP_DECKS=<registry label>` in `tools/selfplay/deckLoader.js`, compared with
`deckFieldWinRate.js` (one deck against the fixed field, both seats on the same
shuffle) and paired game-for-game by `pairDeckFieldArms.js`.

Card fixtures were re-imported from EmeraldDB and diffed against the old ones:
**zero drift** on every rules field across all thirteen decks, so each arm
differs by exactly the province change.

Bases: **6 search** (61001-66001) + **18 fresh** (71001-76001, 81001-86001,
101001-106001), ~765 paired games per deck. The hypothesis was fixed in advance
and identical for all thirteen decks, so no base set was burned by a search;
both halves are reported because agreement between them is the stability check.
Five borderline decks were then replayed on a **third independent 12-base set**
(111001-116001, 121001-126001).

## Results

Each deck's own control is the SAME deck without the swap, against the same
sixteen-deck field on the same shuffles. The number is that deck's win rate
against a stationary field, so it is not centred on 50%.

| deck | displaced from the slot | control | +EP | delta | p | bases |
|---|---|---:|---:|---:|---:|---:|
| Scorpion Mill | night-raid (fire 4) | 50.20% | 56.60% | **+6.41pp** | **0.0000** | 24 |
| Phoenix Phoenix | retire-to-the-brotherhood (water 4) | 31.08% | 36.77% | **+5.69pp** | **0.0050** | 24 |
| Crab Defense | flooded-waste (water 2) | 41.32% | 46.45% | **+5.13pp** | **0.0310** | 24 |
| Dragon Attachments | pilgrimage (void 5) | 56.99% | 59.18% | **+2.19pp** | **0.0088** | 36 |
| Scorpion Bid War | honor-s-reward (fire 5) | 48.69% | 51.18% | +2.49pp | 0.0662 | 48 |*
| Phoenix Glory | rally-to-the-cause (water 4) | 62.43% | 64.89% | +2.45pp | 0.1083 | 36 |
| Unicorn Rush | temple-of-the-dragons (void 4) | 42.99% | 45.61% | +2.62pp | 0.2402 | 24 |
| Lion Rush | weight-of-duty (void 4) | 52.73% | 53.48% | +0.76pp | 0.7717 | 24 |
| Unicorn Reveal | massing-at-twilight (void 8) | 67.59% | 67.72% | +0.13pp | 0.9397 | 24 |
| Dragon Monks | sacred-sanctuary (air 2) | 56.91% | 56.73% | -0.17pp | 0.9049 | 36 |
| Crane Duels | vassal-fields (earth 4) | 37.30% | 36.52% | -0.79pp | 0.7470 | 24 |
| Crab Berserk | the-eternal-watch (earth 5) | 43.34% | 41.12% | **-2.22pp** | **0.0195** | 24 |

Phoenix Shugenja's first arm was confounded (see the trap below) and was
re-measured with the deck override restored on BOTH sides:

| deck | displaced from the slot | control | +EP | delta | p | bases |
|---|---|---:|---:|---:|---:|---:|
| Phoenix Shugenja | vassal-fields (earth 4) | 51.69% | 56.38% | **+4.69pp** | **0.0000** | 24 |

That is the cleanest result in the trial — 46 paired flips toward the change
against 10 away, positive on 18 of 24 bases and negative on 1 — and it is also
the most CONSTRAINED: with the deck's own tuning no longer switching itself off,
82.8% of games are bit-identical and the ceiling is only 3.65pp, so the province
is taking nearly everything available to it. The confounded first reading was
+3.85pp against a 16pp ceiling.

**Shipped**: Scorpion Mill, Phoenix Phoenix, Crab Defense, Dragon Attachments,
Phoenix Shugenja. The rule was fixed before the runs: pooled **p < 0.05** and
both halves of the base set agreeing in sign.

**\* Scorpion Bid War SHIPS on the owner's call, not on the rule.** It is
**positive in all four independent base sets and never significant** (+2.65,
+3.14, +3.14, +0.79; pooled +2.49pp, p=0.0662 over 1524 games). Four sets
landing the same way is a one-in-sixteen coincidence and the estimate is stable,
but it did not clear the bar that was fixed before the runs, so do not quote it
as a measured win — same standing as `conflictTempo.tradeDefenseWinOnly` and
`drawBidding.cardsOverHonor`. Its deck override does not match on the displaced
province, so there is no confound of the kind Phoenix Shugenja had.

**Rejected**: Crab Berserk (negative), and Unicorn Rush / Unicorn Reveal / Crane
Duels / Lion Rush / Dragon Monks / Phoenix Glory (null).

## What predicts the gain

The delta tracks the STRENGTH of the province Entrenched Position pushed out of
the stronghold slot, which is what "a wall is worth most in the slot reached
last" predicts:

| displaced strength | decks | mean delta |
|---:|---|---:|
| 2 | Crab, Dragon Monks | +3.88pp (before Dragon's third base set) |
| 4 | Scorpion, Phoenix, Phoenix Phoenix, Unicorn, Crane Duels, Lion | +3.22pp |
| 5 | Dragon Attachments, Scorpion Bid War, Crab Berserk | +1.01pp |
| 8 | Unicorn Reveal | +0.13pp |

The win-reason census confirms the mechanism on every deck that gained — the
swap does not win more games elsewhere, it **stops losing the last province**:

| deck | conquest LOSSES, control -> +EP |
|---|---|
| Scorpion Mill | 311 -> 251 |
| Crab Defense | 313 -> 240 |
| Phoenix Phoenix | 301 -> 249 |
| Crab Berserk (negative) | 251 -> **274** |

Two decks should not take the card, and both for a reason visible in the card
it displaces:

- **Crab Berserk** gave up `the-eternal-watch`, whose Action reads "during a
  conflict at this province" — it fires precisely on the final push, which is
  the only attack the stronghold province ever sees. Trading an active defense
  at that slot for +5 passive on one axis lost 2.22pp, and its conquest losses
  went UP.
- **Unicorn Reveal** gave up `massing-at-twilight`, already an 8-strength wall.
  Entrenched Position is 10 against military and 5 against political, so the
  trade is a wash and the deck measured +0.13pp — the closest thing to an exact
  null in the trial.

## Trap: a deck override that matched on the province being swapped

`phoenix-shugenja-vassal-fields` matched `strategy.shugenja && ids.has('vassal-fields')`,
and the new list swaps Vassal Fields out for Entrenched Position. The whole
override — the stronghold-defense thresholds, the mulligan, the entire shugenja
ring plan — therefore switched itself OFF in the treated arm, and the first
measurement was reading that as well as the province.

Nothing failed and no spec broke; the deck simply resolved one fewer override.
It was found by diffing `profile.overrideNames` between the two arms, which is
worth doing for ANY deck-content arm:

```sh
# for each deck, resolveDeckProfile(ids) on both lists and diff overrideNames
```

The override is now `phoenix-shugenja-ring-plan`, keyed on
`offerings-to-the-kami` — unique to this list in the field, and a card the deck
is not trading away. **A profile override must never match on the card the
experiment is changing.**


## Rebuilding an arm

The `-ep` fixtures and the `EP_DECKS` build switch were temporary and are gone.
To re-measure any of these decks, re-import the list by its EmeraldDB id and
compare BUILD vs BUILD:

```sh
node tools/selfplay/importEmeraldDeckFixture.js <deck-id> <slug>-ep
# add an EP_DECKS-style switch to tools/selfplay/deckLoader.js, then:
SUBJECT=<label> BASES=<csv> WORKERS=14 OUT=off.json node tools/selfplay/deckFieldWinRate.js
EP_DECKS=<label> SUBJECT=<label> BASES=<csv> WORKERS=14 OUT=on.json node tools/selfplay/deckFieldWinRate.js
node tools/selfplay/pairDeckFieldArms.js off.json on.json
```

The thirteen lists tried here (EmeraldDB deck ids): Unicorn `412d48dc`, Crab
`aad8a64b`, Crab Berserk `5abbef57`, Scorpion `a347d3ef`, Scorpion Bid War
`bc20a876`, Phoenix Shugenja `e26823e8`, Dragon Attachments `ce8df8ae`, Phoenix
Phoenix `a1ea233a`, Unicorn Reveal `547dd9b8`, Crane Duels `bc962ab4`, Lion
`78894123`, Dragon Monks `805b45d3`, Phoenix Glory `24b814e6`.

## Notes on the shipped lists

- **Dragon Attachments** loses **Pilgrimage** outright (it was the stronghold
  province). `DRAGON_ATTACHMENT_DEFAULTS.agashaTaiko.provincePriority` still
  names it; that entry can never match now and is inert, and it was already
  inert before, because the province under the stronghold is not targetable.
- **Phoenix Phoenix** loses **Kuroi Mori**. `JigokuBotPolicy`'s
  `rebirth-kuroi-mori-ring` branch is gated on the button existing, so it goes
  dormant rather than misfiring.
- **Scorpion Mill** keeps Night Raid, which moves from the stronghold slot to an
  outer province — its on-reveal discard now actually fires. Same shape as
  moving Illustrious Forge out of the Dragon stronghold slot.
- **Scorpion Bid War** keeps Honor's Reward, which likewise moves out to an
  outer province; Effective Deception leaves the deck. List revision 0.6 -> 0.7.
