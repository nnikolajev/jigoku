# Four fixes from one Phoenix Shugenja replay (2026-08-23)

Source: `game replays/debug/2026-08-23_kingitus_s_game_Jigoku_Bot-Phoenix_Clan_vs_kingitus-Phoenix_Clan.json.gz`
— Bot V1 on Phoenix Shugenja against the project owner on a Phoenix Fushichō
list. The bot lost in round 7 **on honor, at 0**, having reached that round with
a live board.

Every rule below is behind a `DeckProfile` knob whose class default reproduces
the shipped bot, so an arm is a JSON string and never an edit
(`.claude/skills/roundrobin/SKILL.md`). `refactorIdentity.js` hashes
`692b8ad320d634b9` with every knob off — identical to the pre-change build,
which is what proves the wiring itself changed nothing — and `e56f28af81270cb8`
with the shipped defaults below.

## 1. The bid that ended the game — `drawBidding.deckExhaustionAware`

Round 7 draw phase, from the replay state: **8 honor, ONE card left in the
conflict deck**, 30 in the discard.

```
Jigoku Bot reveals a bid of 5      kingitus reveals a bid of 1
Jigoku Bot gives kingitus 4 [honor]            -> 4
Jigoku Bot draws 5 [cards] for the draw phase
Jigoku Bot's conflict deck has run out of cards, so they lose 5 [honor]
kingitus has won the game
```

The bid is not only an honor TRANSFER. `player.ts drawCardsToHand` reshuffles
the discard whenever the draw is **strictly larger** than the deck, and
`deckRanOutOfCards` charges a flat 5 honor for it (3 in Skirmish). Every honor
rail in `DrawBidTactics` reads `myHonor` as though only the transfer existed, so
at 8 honor the open-stronghold rail bid the maximum into a penalty that was
already unavoidable.

**The rule.** Project the exhaustion (`selectedBid > conflictDeckSize`), subtract
the penalty from `myHonor`, and re-run the whole analysis on the honor the bot
will ACTUALLY hold. In this position 8 − 5 = 3 falls under
`lowHonorThreshold: 6`, the `protect-low-honor` rail takes it, and the bid drops
to 1 — which at a 1-card deck does not even trigger the reshuffle, because the
penalty starts one card later.

Deliberately narrow: with a deck that covers the bid the analysis is returned
untouched, and an unknown `conflictDeckSize` (synthetic callers) behaves exactly
like the knob being off. `JigokuBotController.drawBidContext` reads
`player.conflictDeck.size()`; the summary-state fallback reads
`numConflictCards`.

Regression matrix in `test/server/bots/drawbidtactics.spec.js` covers 1/2/3
cards remaining × 6/7/8 honor (all bid 1), a full deck at four honor totals
(bit-identical to the knob off), and a high-honor case where the rule re-bids
without clamping to the floor.

## 2. Declaring on the wrong axis — `conflictDeclaration.ownAxisDominanceMargin`

Round 1, conflict 1. The bot's whole board was **Asako Togama, 2 military / 5
political**. The opponent had a dashed-military Young Philosopher (0/4) and an
Inferno Guard Invoker (3/2). It declared MILITARY with 2 skill and was defended
at 3.

`ConflictDeclarationPolicy` subtracts the opponent's ready board at
`opponentBoardWeight: 1`:

```
military  = 2 - 3 = -1
political = 5 - 6 = -1
```

A dead tie — and the tie-break is `myMilitary >= myPolitical ? 'military'`,
which is the wrong half of a political board. `switchMargin: 0` does not catch
it either, because the guard is `gain < switchMargin` and the gain is exactly 0.

**The rule.** When our own board favours one axis by `ownAxisDominanceMargin`
(2) or more, the opponent-aware differential has to beat it by
`dominantAxisSwitchMargin` (2) before it may overrule it. A tie never clears a
positive margin. The opponent's board still steers the declaration when it says
something: a 12-political wall opposite our 5 political still sends the
declaration military, at `gain = 9`.

Both fields are 0 in `DEFAULT_CONFLICT_DECLARATION` — `|diff| >= 0` is always
true and `0 > 0` is false, so the class default is bit-identical to before — and
the shipped values live in `DEFAULT_PROFILE.conflictDeclaration`, the same split
`opponentBoardWeight` already uses. New telemetry reason:
`below-dominant-margin`.

## 3. Disguising onto a READY body — `shugenja.disguiseRequires*`

Round 3, first action of the conflict phase:

```
Jigoku Bot plays Isawa Tadaka using Disguised, choosing to replace Prodigy of the Waves
Jigoku Bot is initiating a [military] conflict ... with skill 6
```

Prodigy had been bought that same dynasty phase with 2 fate and was READY.
`PlayDisguisedCharacterAction.executeHandler` moves the base's fate,
attachments and status tokens onto Tadaka and then **discards the base**, so a
ready 3/3 plus a card in hand became a ready 5/3 and nothing else. Attacking
with Prodigy first and disguising the bowed body afterwards keeps both, because
the disguised character enters play ready — that is the half of the keyword
worth its discount.

**The rule**, in two knobs so the halves can be measured apart:

- `disguiseRequiresBowedBase` — only replace a bowed base. `pickDisguiseTarget`
  additionally PREFERS a bowed base at the replace prompt, but never returns
  null where the ungated pick found one: that prompt fires after the card is
  already committed.
- `disguiseRequiresConflictValue` — and only while the ready is worth
  something: a conflict of ours left to declare, or one of theirs with ready
  bodies behind it (`ShugenjaTactics.disguiseReadyIsUseful`, both counts
  public).

Both gates run on the two play paths — the prepared-disguise branch
(`pickTadakaPlay`) and the ordinary conflict evaluation (the `isawa-tadaka-2`
playbook entry via `tadakaRequiresBowedBase` / `tadakaReadyIsUseful`). Paying
Tadaka's full printed 5 from hand is a normal play and is not gated.

A third knob followed from the census below: with `disguiseRequiresBowedBase`
on and only a READY base standing, `prefersDisguisedPlay` takes the PLAIN play
button instead of Disguised whenever the printed five is affordable. V1 prefers
Disguised unconditionally (`tadaka-play-disguised`), which spends a body for a
discount it does not need.

`BotTelemetry` kind `tadaka-disguise` records one row per Disguised play
actually made, carrying `bowedBase`, `participatingBase`, `baseFate` and
`conflictsRemaining`. Census over 96 games (both Phoenix decks x 16 opponents x
3 bases), treated seat only:

| build | games | Disguised plays | onto a BOWED base | onto a ready base |
|---|---:|---:|---:|---:|
| control (V1 today) | 96 | 46 | 3 (6.5%) | 43 |
| two knobs | 96 | 39 | 28 (71.8%) | 11 |
| control (V1 today) | 384 | 201 | 16 (8.0%) | 185 |
| all three knobs | 384 | **74** | **74 (100%)** | 0 |

V1 disguises onto a ready body **92-94% of the time**, which is the whole
finding. With the two gates the keyword still fires almost as often and mostly
does what it is for; the leftover ready-base plays were the full-cost path, and
the third knob closes it — every remaining Disguised play converts a bowed body
into a ready 5/3. Total firings fall from 0.52 to 0.19 per game, the difference
being Tadaka played at his printed cost with the base kept.

## 4. Clarity of Purpose in military conflicts — `shugenja.clarityPoliticalOnly`

Twice in the same game:

```
R3c1  Jigoku Bot plays Clarity of Purpose ... (military conflict, losing 6-7)
R4c1  Jigoku Bot uses Kyuden Isawa, ... to play a spell event from discard
      Jigoku Bot plays Clarity of Purpose from their conflict discard pile
      (military conflict, ALREADY winning 11-7)
```

The card reads "opponents' card effects cannot bow that character **and it does
not bow as a result of conflict resolution during political conflicts**". Only
the second clause is unconditional value, and only on the political axis. V1's
playbook gate ends in `(ctx.omniscient ? ... : true)` — a blind hedge against a
hand it cannot see — which is what fired both times, the second one burning
Kyuden Isawa's once-per-round action and a hand card for nothing.

**The rule.** With `clarityPoliticalOnly`, a military conflict never plays it,
including through the `urgentClarityThreat` pre-emption and through Kyuden's
discard recursion — `pickKyudenSpell` filters on the same
`canPlayConflictCard` → `shouldPlay` gate, and `shouldUseKyuden` requires a
legal replay target, so the stronghold does not bow for a card that will be
refused.

## Measurements

Method: `.claude/skills/roundrobin/SKILL.md`. The two Phoenix knobs are
deck-scoped — only 2 of 17 decks carry them, so a field head-to-head dilutes
them ~8x — and are measured on the paired rig with `ONLY=` and both seats
pooled through `perDeckFlips.js`, which is what that rig is FOR (per-deck causal
effect). The two field-wide knobs are measured head-to-head.

### Phoenix arm — `{"deckProfileByArchetype":{"shugenja":{"shugenja":{"disguiseRequiresBowedBase":true,"disguiseRequiresConflictValue":true,"clarityPoliticalOnly":true}}}}`

Null arm (same knobs at their own defaults): **32/32 games bit-identical, 0.00%
flipped.** Rig validated.

| run | bases | games | decided | to | away | effect | p |
|---|---|---:|---:|---:|---:|---:|---:|
| discovery, seats 0+1 | 91001-93001 | 192 | 40 | 29 | 11 | +4.69pp | 0.0064 |
| confirmation, seats 0+1 | 210001-215001 (fresh) | 384 | 90 | 54 | 36 | +2.34pp | 0.0725 |
| **pooled** | 9 bases | **576** | **130** | **83** | **47** | **+3.13pp** | **0.0020** |

Same sign on both base sets and on both seats, on nine independent bases.
Per deck (causal — one treated seat): PhoenixPhoenix **+4.51pp** (p<0.001),
PhoenixShugenja +1.74pp (p=0.32). Ceiling 11.3pp, so the mechanism is nowhere
near the noise floor — 22.6% of games flip.

### Field arm — `{"deckProfile":{"conflictDeclaration":{"ownAxisDominanceMargin":2,"dominantAxisSwitchMargin":2},"drawBidding":{"deckExhaustionAware":true}}}`

Head-to-head round robin, 17 decks, every ordered cross-deck pairing played
twice on the same shuffle with the change on opposite sides, three bases.

| arm | games | changed side | effect | z | p |
|---|---:|---:|---:|---:|---:|
| null (both knobs at their own defaults) | 1632 | 816-816 | **0.00pp** | 0.00 | 1.000 |
| axis + deck-exhaustion | 1632 | 823-809 | +0.43pp | 0.35 | 0.729 |

Null arm exact on all three bases (272-272 each, 0 draws, 1632/1632 decided),
so the rig is clean and the +0.43pp is simply unresolvable — which the CEILING
said in advance:

| lever | replayed shuffles | winner flips | implied ceiling |
|---|---:|---:|---:|
| `ownAxisDominanceMargin` / `dominantAxisSwitchMargin` | 112 | **1** | ~0.45pp |
| `deckExhaustionAware` | 112 | **0** | 0.00pp |

**Both ship anyway, as correctness rather than as levers.** The axis guard only
fires when the differential ties on a board that is 2+ dominant the other way;
the bid rule only fires when a bid outdraws the conflict deck. Neither is
common in self-play — and both are exactly the situations that lost the game in
the replay. Same standing as `DeckProfile.polarityGuards` (+0.43pp / p=0.73,
ceiling 0.18pp): measured not-negative, kept because the behaviour they prevent
is wrong.

The Phoenix arm is the opposite shape — 22.6% of its games flip — and is a real
win-rate result.

## Status

| knob | where | default | measured |
|---|---|---|---|
| `drawBidding.deckExhaustionAware` | `DEFAULT_DRAW_BID_PROFILE` (every overlay spreads it) | **true** | ceiling 0.00pp; field arm +0.43pp / p=0.729 |
| `conflictDeclaration.ownAxisDominanceMargin` / `dominantAxisSwitchMargin` | `DEFAULT_PROFILE.conflictDeclaration` | **2 / 2** | 1 flip in 112; field arm +0.43pp / p=0.729 |
| `shugenja.disguiseRequiresBowedBase` | `SHUGENJA_DEFAULTS` | **true** | part of +3.13pp / p=0.0020 |
| `shugenja.disguiseRequiresConflictValue` | `SHUGENJA_DEFAULTS` | **true** | part of the same arm |
| `shugenja.clarityPoliticalOnly` | `SHUGENJA_DEFAULTS` | **true** | part of the same arm |

The three Phoenix knobs were measured together as one arm and are not resolved
against each other; the census above says the disguise half is by far the more
reachable of the two mechanisms.

## The injection trap this work found (FIXED)

Scoping the Phoenix arm surfaced a defect in the arm plumbing itself.
`JigokuBotController.decisionProfile` merged any `deckProfile` key an arm named
onto EVERY deck. For a deck-scoped tactics module that is not a no-op: the
module's gate is the presence of its key —

```ts
const shugenja = profile.shugenja ? new ShugenjaTactics(profile.shugenja) : null;
```

— so `CHANGE='{"deckProfile":{"shugenja":{...}}}'` handed Crab, Lion, Dragon and
everything else a **partial** `ShugenjaProfile` with `towerIds`, `shugenjaIds`,
`disguiseTargets` and `spellPriority` all undefined, switching Phoenix spell
logic on for a deck that runs none of it.

Measured before the fix, `ONLY=Crab`, one base: **16 of 16 games flipped AWAY
from the change — a 100% loss rate.** After: 16 of 16 bit-identical.

The guard is in `decisionProfile`: a key in `TACTICS_SUBPROFILE_KEYS` is applied
only when the base profile already carries it, the rest of the same arm still
applies, and a dropped key is logged once per controller naming the archetype.
Both routes now agree exactly — top-level and `deckProfileByArchetype` produce
the identical run on the owning deck (3 flips / 6 different-path / 7 unchanged
on the same probe), and neither touches a deck that does not own the module.

Note what makes this class of bug expensive: it is invisible to a null arm,
which injects the knob at its own default and therefore never creates a key
that was not there. It is only visible as an arm that does far too MUCH.
Specs in `test/server/bots/botenginerouting.spec.js`.
