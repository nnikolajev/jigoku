# Conflict tempo: the declaration-time board read

`DeckProfile.conflictTempo` (`server/game/bots/ConflictTempoPolicy.ts`) plus two
knobs on `DeckProfile.fateAwareEconomy`. Built 2026-08-12 from the project
owner's own account of how he plays a conflict phase:

> I need my ready characters, enemy ready characters, conflicts remaining, who
> is first player, my character individual values, enemy character individual
> values. I value attack more for ring resolution and gaining fate. If my
> characters are weak I want to exchange provinces. If my characters are strong
> I want to try and defend with one, then attack water ring to ready my
> character again for another conflict... If I know defense is pointless I would
> rather lose 1 honor but make an attack myself... I evaluate who will be first
> player next turn. This is important for dynasty phase: if I am 2nd player I
> want to play characters with 1 fate.

V1 reads four of those six inputs somewhere, but never combines them. Whether to
trade provinces or hold the board is `defenseCommitment`, a per-deck CONSTANT
fixed when the profile was written: the same posture at 3-skill-against-9 as at
9-against-3.

**Of six levers built from that paragraph, one is a measured win, three are
measured negative or null, one is unmeasurable, and one turned out to be
something V1 already did.** The whole exercise is worth reading as an example of
how little of a strong player's conflict reasoning survives contact with
self-play — and which part did.

## The board read

`ConflictTempoPolicy.read()` is a pure function of one axis and the two boards.
It returns a `stance` plus four derived decisions, and is memoised per decide()
call in `JigokuBotPolicy.conflictTempoRead` — `ringElementBase` asks once per
ring, and the board cannot change inside one prompt.

```
myValue    = mySkill   + bestBodyWeight * myBestBody
theirValue = theirSkill + bestBodyWeight * theirBestBody
ratio      = myValue / theirValue
```

- `ratio < weakBoardRatio` -> **trade**
- `ratio > strongBoardRatio` -> **control**
- otherwise, or while both boards are under `minBoardSkill` -> **even**

Measured population over 816 games (seat 0, treated bot only — `BotTelemetry` is
a global sink and records BOTH players, so always filter by seat):

| decision site | share of reads | stance split |
|---|---|---|
| ring | 74.9% | control 40% / even 31% / trade 29% |
| attack | 13.4% | control 49% / even 33% / trade 18% |
| defense | 11.7% | **trade 48%** / even 33% / control 19% |

The bot is on a losing board at nearly half of its defense decisions and a
winning one at half of its attack decisions, which is the asymmetry the rule was
reaching for. Second player in 42-44% of windows.

## Every knob

All default to V1. `enabled: false` makes every derived decision inert while
still reporting the read for telemetry, so the field's presence alone is
bit-identical (verified: `refactorIdentity.js` held at `9dde5aec8cc80a74` across
the whole build-out).

### `conflictTempo`

| knob | default | shipped | what it does |
|---|---|---|---|
| `enabled` | false | **true** | master switch |
| `weakBoardRatio` | 0.8 | 0.8 | ratio below which the board reads `trade` |
| `strongBoardRatio` | 1.25 | 1.25 | ratio above which it reads `control` |
| `bestBodyWeight` | 0 | 0 | how much of the best SINGLE body on each side enters the ratio; 0 = totals only |
| `minBoardSkill` | 4 | 4 | skip the read while both boards are smaller than this (round one is noise) |
| `tradeDefenseWinOnly` | false | false | **measured null** — on a losing board, size defenses `win-only` |
| `tradeMinOwnConflicts` | 1 | 1 | only trade while we still have a conflict to declare |
| `tradeMaxOwnBrokenProvinces` | 2 | 2 | stop trading once the next break is the stronghold |
| `tradeAttackSendAll` | false | false | **measured negative** — send every body on a losing board |
| `readyLoopEnabled` | false | **true** | the water ready loop |
| `readyLoopMinReadyBodies` | 2 | 2 | bodies needed for a loop to exist: one attacks while the other is bowed |
| `readyLoopCountsDefense` | true | true | count an opponent conflict still to come as a reason to ready |
| `readyRingBonusPerSkill` | 0 | **4** | water score added per point of skill on the best bowed body |
| `readyRingBonusCap` | 40 | 40 | ceiling on that bonus |
| `controlAttackKeepHome` | 0 | 0 | **degenerate at 1** — bodies kept home on a winning board running the loop |

### `fateAwareEconomy` (dynasty half)

| knob | default | shipped | what it does |
|---|---|---|---|
| `bodyAdditionalFateSecondPlayer` | 1 | **1** | floor on a cheap body's fate while we do NOT hold the first-player token |
| `bodyAdditionalFateEndgame` | undefined | undefined | cap on it once a stronghold is exposed; 0 = never pay for persistence |
| `endgameBrokenProvinces` | 3 | 3 | own broken outer provinces at which that cap turns on |

An arm is a JSON string, never an edit:

```sh
CHANGE='{"deckProfile":{"conflictTempo":{"readyRingBonusPerSkill":8}}}' \
  KINDS=conflict-tempo BASES=... SEAT=0 WORKERS=14 OUT=probe.json \
  node tools/selfplay/probePaired.js
node tools/selfplay/analyzeTempo.js probe.json 0     # population + reach
node tools/selfplay/perDeckFlips.js probe.json ...   # causal per-deck table
```

`conflictTempo` is in `JigokuBotController.decisionProfile`'s merge-key list, so
an arm naming one knob keeps the rest.

## SHIPPED: the water ready loop, +0.32pp (p=0.009)

The rule is "defend with one, attack the water ring with another, ready the
first, use it again". V1 half-had it and the half it was missing was
**information, not weighting** — the same shape as every other real win on this
bot:

- `ringElementBase` scored a bowed body at a **flat 25** against earth's 40, so a
  5-skill body lying bowed lost the ring exactly as a 1-skill one did.
- It fired only while WE had two conflicts left
  (`conflictsRemaining >= 2`), so it never counted the readied body's OTHER use:
  **defending** a conflict the opponent still has coming.

`readyRingBonusPerSkill: 4` prices the ring from the body it actually brings
back, and `readyLoopCountsDefense` covers the defensive half.

| cell | bases | to | away | effect |
|---|---|---|---|---|
| search seat 0 | 500001-502001 | 18 | 7 | +0.67pp |
| search seat 1 | 500001-502001 | 15 | 10 | +0.31pp |
| confirm seat 0 | 510001-515001 | 27 | 19 | +0.25pp |
| confirm seat 1 | 510001-515001 | 22 | 15 | +0.21pp |
| **pooled** | **9 bases, 4896 games** | **82** | **51** | **+0.32pp, p=0.009** |

All four cells positive, and it WEAKENED on fresh bases (0.49 -> 0.23) instead
of inverting — the search bases were optimistic by the usual ~0.2pp. Ceiling
1.36pp, so a head-to-head could never have resolved this; pooling decided games
and sign-testing them is roughly an order of magnitude cheaper and is what
settled it.

Causal per-deck (the paired probe treats one seat and never swaps it, so these
rows ARE the lever, unlike head-to-head rows):

| deck | decided | to | away | effect | p |
|---|---|---|---|---|---|
| Unicorn | 17 | 13 | 4 | +1.56pp | 0.049 |
| Lion | 12 | 10 | 2 | +1.39pp | 0.039 |
| Crab | 17 | 12 | 5 | +1.22pp | 0.143 |
| Crane | 12 | 8 | 4 | +0.69pp | 0.388 |
| ScorpionBidWar | 18 | 7 | 11 | −0.69pp | 0.481 |

ScorpionBidWar is the only meaningfully negative deck and is inside noise at
n=18; it was NOT scoped out, on the same reasoning that found no deck qualifying
to disable `saveFatePass`. Revert the whole thing with `readyLoopEnabled: false`.

## NULL: `tradeDefenseWinOnly` — and what it costs the standing theory

On a losing board, concede a defense that cannot be won rather than bow bodies
into it. **−0.18pp, p=0.84**, and *not* for want of reach: it diverges in 11656
windows across **94% of games**, the widest reach of anything ever measured on
this bot, on a **5.82pp** ceiling. A genuinely decisive mechanism pointing
nowhere.

This is the sixth defensive lever to land flat or negative — after
`defenseBreakTie`, the defense threat buffer, `chumpBlock`, the 3-3 stronghold
safety gate and the dynasty-phase skip — and it is the **first one that defends
LESS**. The explanation that carried the other five was "a ready body is worth
less than the tempo spent keeping it". That predicts this lever is positive. It
is not.

So the honest conclusion is stronger and less comfortable than five rejections
were: **defense SIZING is close to a free parameter in this engine, in both
directions.** The province falls a conflict later either way, and the bodies
saved do not convert. Do not propose another defense-sizing lever of either
sign; a defensive idea now needs a mechanism that is not sizing.

The owner's rule is sound for HIS games — he converts the tempo he saves — and
does not transfer to self-play. Same conclusion as the 3-3 race (rule 7).

## NEGATIVE: `tradeAttackSendAll`

Send every eligible body on a losing board instead of V1's all-but-one.
**−0.49pp** (4 to / 12 away, p=0.077) on a 0.98pp ceiling. Small population,
wrong sign: the body V1 keeps home earns its keep even on a board that is
losing.

## NULL, SHIPPED ANYWAY: `bodyAdditionalFateSecondPlayer`

`RegroupPhase.passFirstPlayer` alternates the token unconditionally, so "am I
second player this round" IS "do I open the next conflict phase" — free public
information. V1 puts fate on a body from printed cost alone
(`bodyAdditionalFateForCostThree`), so every other cheap body is discarded in
the fate phase of the round it was bought in, and the second player's purchases
are gone before the round they were bought for.

**+0.01pp, p=1.00** over 4896 games and 9 bases:

| cell | bases | to | away | effect |
|---|---|---|---|---|
| search seat 0 | 500001-502001 | 16 | 9 | +0.43pp |
| search seat 1 | 500001-502001 | 14 | 12 | +0.12pp |
| confirm seat 0 | 510001-515001 | 30 | 25 | +0.15pp |
| confirm seat 1 | 510001-515001 | 19 | **32** | **−0.40pp** |
| **pooled** | **9 bases** | **79** | **78** | **+0.01pp, p=1.00** |

Three positive cells and the fourth cancelled all of them exactly — a textbook
demonstration of why three bases can reject a lever but never accept one. It
also reaches only **6 of 17 decks**; eleven show zero decided games, because
their economies never buy a bare cheap body at that moment.

**Shipped at 1 field-wide on 2026-08-12 at the owner's request**, on
`DEFAULT_FATE_AWARE_ECONOMY` so every deck inherits it (each per-deck override
spreads that object, or `SWARM_FATE_AWARE_ECONOMY` which spreads it in turn). A
null is not a negative, and he judges the games by hand in live play. **Do not
cite it as a measured win, and do not silently revert it.** Same standing as
`drawBidding.cardsOverHonor`.

## UNMEASURABLE: `bodyAdditionalFateEndgame`

The other half of the same rule — with a stronghold exposed the game rarely
reaches another round, so persistence is a tax on bodies that would fight for
this one. **−0.12pp on a 0.49pp ceiling**, flipping 1.0% of games. Correct
logic, no population. Left at its V1 default.

## The broken arm, and the check that caught it

`controlAttackKeepHome: 1` was supposed to keep a body home on a winning board
to defend and be readied. Its 816 games came back **bit-identical to the
adjacent arm** while telemetry showed the knob computing a keep-home in 822
attack windows.

Cause: V1's default `all-but-one` sizing already is
`Math.max(1, totalEligible - 1)`, so the new branch computed the same expression
it was meant to replace. The knob can only differ at 2+, which is a much more
conservative rule than the one the owner described — and the "defend with one,
attack with another" half of his rule turns out to be **V1's existing behaviour
for every deck on the default commitment mode**.

**A null arm cannot catch this**, because it moves both seats together and
scores exactly 50.00% either way. What caught it was diffing the arm's per-game
outcomes against the ADJACENT arm. Add that to the checklist next to "is the
mechanism reachable": an arm can be degenerate with V1 rather than inert, and it
looks exactly like a clean null.

## Tools added

- `tools/selfplay/perDeckFlips.js` — causal per-deck table from one or more
  probe dumps. Pool a `SEAT=0` and a `SEAT=1` dump and the probe's seat bias
  cancels, the way it does in the head-to-head. Effect convention is
  `50 * (to - away) / games`, matching `probePaired.js`'s ceiling.
- `tools/selfplay/analyzeTempo.js` — stance population per decision site, and
  how many windows actually DIVERGE from V1.

## Related

- `bot-conflict-rules-from-replays.md` — rules 13-15, and the eleven rules
  before them from the same replay set.
- `bot-v2-rejected-experiments.md` — the three negatives above, in the shared
  list.
- `.claude/skills/roundrobin/SKILL.md` — the measurement method all of this
  follows.
