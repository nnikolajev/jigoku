# Crane "Courtier Honor" bot deck (Seven Fold Palace)

EmeraldDB `db118806-4e15-4d5c-ad6f-080eb90bdf81`. Registry label `CraneHonor`.
Strategy flag `craneHonor` (keyed on `seven-fold-palace` alone, so the Crane
Baseline and Crane Duels lists — which share Tsuma and most of the honor events
— are untouched). Tactics module `server/game/bots/CraneHonorTactics.ts`.

## The archetype

**This deck does not win by conquest. It wins at 25 honor**, and the engine rule
that makes that a plan rather than a hope is in `drawcard.ts:1026`:

> an **honored** character that leaves play gains its controller **1 honor**

So a wide board of cheap honored Courtiers is literally an income stream every
fate phase, and every other card is a second faucet on top of it:

| Faucet | Honor |
|---|---|
| Seven Fold Palace (stronghold) | bow: **2**, after an *honored* character wins a conflict as the **attacker** |
| Air ring | gain 2, or take 1 |
| Before the Throne (province) | **2** taken when it breaks |
| Doji Hotaru | 1 per opposing card played in her conflicts, **unlimited** |
| Kakita Asami | 1 **taken** per political conflict she is winning (a 2-point swing) |
| Bonsai Garden (holding) | 1 per air conflict |
| Honored Blade | 1 per conflict its bearer wins |
| Way of the Chrysanthemum | **doubles** honor received from an honor bid |
| any honored body dying | 1 |

Three of the five provinces are AIR (Before the Throne, Driven by Courage,
Tsuma), which is also what the Seeker of Air role converts into fate on reveal.

The consequences for the shared knobs all follow from "honor is the scoreboard,
not a resource":

- the draw dial bids the **floor** — the higher bidder pays the difference, and
  Way of the Chrysanthemum gains that difference *again*;
- the conflict axis is **political** (the board is Courtiers) and the Imperial
  Favor is claimed on the political side;
- `provinceConcede` is **empty** — every conceded province walks the opponent
  one step closer to the conquest win that is this deck's only loss condition;
- fate goes into **width plus exactly one tower**: a naked 1-cost Courtier that
  gets honored and dies is worth 1 honor and a card (through Asahina
  Storyteller's granted Sincerity), which a 4-cost body is not worth four times
  over — but refusing to buy **Doji Hotaru** measured −6.67pp, so the deck does
  want one persistent body. She is the only faucet that scales with the
  *opponent's* actions.

## Tsuma, and why the deck derives TWO profiles

`deriveDeckStrategy` keys `duelist` on Tsuma alone, and this deck runs Tsuma. So
it derives `duelist: true` **and** `craneHonor: true`, and the crane-honor
overlay is applied *after* the duel one in `profileFromStrategy`.

That ordering is load-bearing. The shared duel package banks fate on a single
tower (`durableCostThreshold: 0`, deep additional fate) and its dynasty picker
passes the window to save up for one. Measured live, that is what the first
build did: `duel-play-tower` / `duel-save-for-tower` / `duel-board-complete`
owned the whole dynasty phase and **Doji Hotaru was never bought in 24 games**.
`CraneHonorTactics.pickDynastyCharacter` is therefore checked *before* the duel
branch at both dispatch sites, and the profile restores
`durableCostThreshold: 4`.

The Tsuma logic itself is reused rather than rewritten: `MulliganTactics`
already carries `tsumaProvinceId` / `honorProvinceCharacters`, which scores a
CHARACTER sitting in Tsuma at +500 so the fate phase keeps it (it enters play
pre-honored) instead of discarding it for a holding. The profile just turns the
flag on.

## Reachability — everything that was dead, and why

The first build measured **0-8** against the Crane precon. `auditCards` then
found 26/27 plays, 15/17 abilities and **3 stalled games in 24**. Four distinct
causes, all of which are worth knowing generally:

1. **`Conflict.getSummary()` publishes `elements` (a LIST), never a scalar
   `element`.** A conflict can carry more than one element once a ring is added
   to it. Bonsai Garden reads "during an **air** conflict", and the gate written
   against `conflict.element` was reading `undefined` every time, so three
   copies of the holding never fired. `PlaybookContext.conflictRingElements` now
   carries the list. (`conflictProvinceElements` cannot answer this question — a
   fire ring can be contested at an air province.)
2. **Benevolent Host stalled the game.** Its target handler picked from the
   whole visible board instead of the candidate list the prompt supplied, so it
   clicked a province card the engine would not accept — 40+ rejected clicks in
   a row, twice in 24 games. Deck-specific target steering must filter `mine` /
   `theirs`, which arrive already legal.
3. **Hantei Sotorii's +3 glory does nothing on a plain body.** Glory is only
   skill on a character carrying a status token, so the Action needs an
   *honored* participant; without that gate it looked reachable and paid zero.
4. **Those Who Serve is a CONFLICT card played from HAND during the dynasty
   phase.** The dynasty window only ever scans provinces. The hook existed but
   was gated on `this.currentCrabSacrifice`; it is now the shared
   `DeckProfile.dynastyCostReducer` (same values for Crab, so that deck is
   bit-identical).

After the fixes: **27/27 plays, 17/17 abilities, 0 zero-use, 0 stalls.**

## What was made generic (and what was already generic)

The user's brief asked for the shared Crane cards to be reusable rather than
re-implemented. Most already were:

| Card | Status |
|---|---|
| Shameful Display | already generic in `JigokuBotPolicy` (exactly-2 select, own-strongest + enemy-strongest, then the Honor menu). Used here as the **stronghold province** — Before the Throne and Tsuma both forbid it by printed text |
| A Perfect Cut, Court Games, For Shame, Way of the Crane, Voice of Honor, Make Your Case | already generic playbook entries; only `for-shame` was missing one |
| Tsuma | already generic via `MulliganTactics.honorProvinceCharacters` |
| Esteemed Tea House | routes into the shared `AttachmentControlTactics` value policy |
| **Those Who Serve** | **lifted** out of `CrabSacrificeProfile` into `DeckProfile.dynastyCostReducer` |

Honor-token targeting is the one place the shared policy is deliberately
overridden: `PersonalHonorTactics` ranks by GLORY, which is right when the token
is only a stat swing. Here it is also an engine trigger, so
`CraneHonorTactics.pickHonorTarget` runs first with the deck's own ordering
(Asami → Hotaru → Storyteller → Sotorii → Savvy Politician → …) and glory only
breaks its ties.

## Measurement

Rig: `SUBJECT=CraneHonor node tools/selfplay/deckFieldWinRate.js`, per
`.claude/skills/roundrobin/SKILL.md`. Six independent bases (91001-96001),
GPB=2, 360 games per arm, `WORKERS=14` on 18 cores.

### A rig bug the null arm caught

The first null arm — the profile injected at its own default — **stalled all 360
games**. `JigokuBotController.decisionProfile` deep-merges a named list of
tactics sub-profiles, and `craneHonor` was not on it, so an arm naming one knob
produced a `craneHonor` object with every other field `undefined` and the
tactics module threw. Fixed by adding the key; this is exactly the failure the
null arm exists to catch.

### The null arm is not bit-identical to the no-profile control — and that is pre-existing

With the merge fixed, the null arm reads **58.89%** against the no-profile
control's **58.61%**: 11 differing games out of 360, **all against Phoenix**.

The cause is not this deck. `_fieldWorker.js` switches BOTH seats to
`engineVersion: 'v2'` / `v2Mode: 'pass-through'` as soon as any profile is
injected, and runs plain `v1` when none is. The shipped **CrabSacrifice** deck
shows the same signature (1 differing game in 90, also Phoenix-only). A
control-vs-control re-run was **0 differing games**, so the harness itself is
deterministic.

**Consequence for every number below: the injected null (58.89%) is the
control**, not the no-profile run. Every arm goes through the identical
pass-through path, so the comparison is clean.

### Baseline

| Build | Win rate |
|---|---|
| First reachable build vs the Crane precon | **0-8** |
| After the four reachability fixes, vs the Crane precon | 3-4 |
| Field, no profile injected, 360 games / 6 bases | 58.61% |
| Field, null arm on that build | 58.89% |
| \+ the two dynasty-buying bugs the SPECS caught | 61.39% |
| \+ the cross-deck model trim (see Cross-deck safety) | **62.78%** CI [57.7, 67.6] |
| the shipping build on six FRESH bases (120001-125001) | **63.23%** CI [58.1, 68.1] |
| **SHIPPED, pooled over 12 bases / 719 games** | **63.00%** |

Seat-balanced 66.11 / 59.44. `avg rounds 4.0`. **All 266 losses are
`loss:conquest`** — across both base sets, not one game was lost any other way.

`avg rounds 4.0`. 61.39% is the control for every arm below.

#### The two bugs, and why the knob sweep could not have found them

`tower5` (`towerMinimumTotalFate: 5` against a default of 7) measured
**212-148 — bit-identical to the null.** That is the broken-wire signature from
the Castle of the Forgotten result, and it was: the tower branch declined
correctly, and then the *general* value ranking picked Doji Hotaru anyway,
because her raw 6 political outscores everything else in the list. The knob
could never have been tuned, only fixed — the tower is now dropped from the
general sort whenever the tower branch declines.

The second was a `budget <= 0` guard in `pickDynastyCharacter`. Doji Diplomat
costs **0** and the deck runs three, so at zero fate — exactly when width is the
only thing left to buy — the deck passed instead of fielding free bodies.

Together: **+2.50pp**, and both were found by writing the unit spec, not by
spending games. Reachability stayed 27/27 and 17/17 across the fix, which is the
point: `auditCards` proves a card CAN fire, not that the ranking around it is
right.

### Every loss is a conquest loss

Of the shipping build's 266 losses across both base sets, **266 are
`loss:conquest`**. Not one game
was lost to dishonor, deck-out or the clock. The deck is in a race and the only
way it dies is being out-raced — which makes its per-opponent table read as a
single sorted statement about speed (24 games each):

| | | | |
|---|---:|---|---:|
| Unicorn | 83.3% | PhoenixShugenja | 54.2% |
| PhoenixPhoenix | 83.3% | CraneDuels | 54.2% |
| Crab | 75.0% | CrabSacrifice | 50.0% |
| DragonAttachments | 75.0% | Phoenix | 50.0% |
| Dragon | 70.8% | **ScorpionBidWar** | **41.7%** |
| LionDuelist | 70.8% | **UnicornReveal** | **33.3%** |
| Crane | 62.5% | | |
| Scorpion / Lion | 58.3% | | |

It beats decks that need time to assemble something and loses to the two decks
that break provinces fastest.

### The tuning conclusion: do NOT slow down

This is the most useful result in the deck, and it is counter-intuitive given
that every loss is a conquest loss. **Every defensive lever measured negative.**
Round 1, 360 games per arm, against the pre-fix null of 58.89%:

| Arm | Win rate | Δ |
|---|---:|---:|
| `craneHonor.airRingBonus: 60` | 60.28% | **+1.39pp** |
| `craneHonor.maximumBoardCharacters: 8` | 59.72% | +0.83pp |
| `craneHonor.towerMinimumTotalFate: 5` | 58.89% | **bit-identical — broken wire** |
| `imperialFavorChoice: 'military'` | 58.61% | −0.28pp |
| `attackCommitment: 'breakable-or-pressure'`, `attackKeepHome: 2` | 58.33% | −0.56pp |
| `defenseSkillBuffer: 2` | 56.67% | **−2.22pp** |
| `chumpBlock: true` | 56.39% | **−2.50pp** |
| `firstPlayerChoice: 'second'` | 56.11% | **−2.78pp** |

The win-reason histograms say why. `chumpBlock` looked obviously right — an
unopposed defensive loss costs 1 honor, and honor is the scoreboard — but it
bows a body to save that honor, and the body was going to attack. Conquest
losses went **148 → 157** and dishonor wins **39 → 30**: the deck stopped
draining the opponent faster than it saved itself. Same shape as the Crab
Sacrifice list's honor floors: a tempo problem wearing an honor costume.

`firstPlayerChoice: 'second'` at −2.78pp confirms the deck guide's "go first in
all cases" directly.

**The Imperial Favor question is answered NULL.** The deck guide asked whether
the political side beats the field-default military side for an all-Courtier
board; over 360 games it is worth **+0.28pp**, well inside the ±2.5pp noise
floor. Political is kept because it is the side this board can actually use, not
because it measured better.

The two positive arms both make the honor clock FASTER (more air rings, a wider
board), which is the same conclusion from the other direction.

### Round 2 — ablations and the combination

Against the fixed-build null of **61.39%**, same six bases, 360 games per arm.

| Arm | Win rate | Δ |
|---|---:|---:|
| `airRingBonus: 60` + `maximumBoardCharacters: 8` | 63.06% | **+1.67pp** |
| `airRingBonus: 90` | 62.50% | +1.11pp |
| `politicalAxisBonus: 0`, `asamiAxisBonus: 0` | 62.50% | +1.11pp |
| `provinceConcede` restored to the field default | 61.39% | **0.00pp — bit-identical** |
| `drawBidding.minimumRoutineBid: 3` | 60.56% | −0.83pp |
| **`airRingBonus: 0`, `airRingCloseBonus: 0`** | **54.72%** | **−6.67pp** |
| **`towerMinimumTotalFate: 99`** (never buy Doji Hotaru) | **54.72%** | **−6.67pp** |
| **`attackCommitment: 'all'`, `attackKeepHome: 0`** | **48.06%** | **−13.33pp** |

**Two mechanisms carry the deck, and both cost −6.67pp when removed** — the only
ablations here that clear the noise floor decisively. (The identical totals are
a coincidence: 245 of the 360 games differ between the two arms.)

*Air-ring steering.* The generic `ringScore` files air under its `default`
branch at 15, below earth (40) and void (50), because for every other deck air
is the weakest ring. For a deck whose win condition is the honor track it is the
strongest, and 30 is enough: 60 is worth another point and a half, 90 gives that
back.

*Doji Hotaru.* Refusing to buy her costs exactly as much. This is the answer to
the width-versus-tower question the deck poses: the plan is width, but it needs
**one** persistent body, and her unlimited "1 honor per opposing card played" is
the only faucet in the list that scales with the opponent's own actions. Note
this only became measurable after the general-ranking bug was fixed — before
that, `towerMinimumTotalFate` was inert in both directions.

The axis result is worth flagging honestly: **turning the political nudge OFF
measured +1.11pp**, the same as `airRingBonus: 90`. Both are inside the noise
floor, but nothing here supports the axis bonus being positive. It is kept at
its small default rather than removed, because the ablation is a single six-base
reading and `conflictDeclaration.opponentBoardWeight` already does the real
axis work.

#### What the ablations do to the game, not just the number

| Arm | honor wins | conquest wins | conquest losses | avg rounds |
|---|---:|---:|---:|---:|
| null | 157 | 22 | 139 | 3.96 |
| combo | 160 | 24 | 132 | 3.96 |
| `air0` | **132** | **36** | **163** | 4.23 |
| `notower` | **133** | 18 | **162** | 4.04 |

Both big ablations do the same thing: they take 25 games off the honor win and
hand them to the conquest race, which this deck then loses. `air0` in particular
does not make the deck passive — it makes it try to WIN BY CONQUEST (+14
conquest wins) and lose more games doing it, on a longer clock. The honor
faucets are not a bonus on top of a normal Crane deck; they are the deck.

#### The attack posture is a narrow ridge, and both sides of it fall off

`attackCommitment: 'all'` with no defender kept home is **−13.33pp**, the
largest measured effect in the deck by a factor of two. Put next to the round-1
defensive arms, the shape is clear:

| Posture | Δ |
|---|---:|
| over-attack (`all`, `attackKeepHome: 0`) | **−13.33pp** |
| slightly cautious (`breakable-or-pressure`, keep 2) | −0.56pp |
| **default (`all-but-one`, keep 1)** | **0** |
| over-defend (`defenseSkillBuffer: 2`) | −2.22pp |
| over-defend (`chumpBlock`) | −2.50pp |

The deck MUST attack — Seven Fold Palace only pays after an honored character
wins a conflict **as the attacker** — but it cannot afford to be raced back,
because conquest is the only way it ever loses. `all-but-one` is not a
compromise between two tunings; it is the only posture that measured well, and
the penalty for leaving it is severely asymmetric on the aggressive side.

The `all` arm does not even buy the breaks it spends the bodies on — conquest
WINS go 22 → 23 while conquest LOSSES go 139 → 186 and honor wins fall 157 →
124. The extra attacker contributes nothing the attack did not already have,
and its absence at home is a province.

<!-- ROUND2TAIL -->

### Confirmation on fresh bases

Six bases never used in the search (120001-125001), same 360 games per arm. Per
`SKILL.md`, a candidate found on the search bases is a HYPOTHESIS until it wins
on bases it was not found on — the two positive arms here were both inside the
±2.5pp noise floor on the search set, so this run is what decides them.

**The base sets alone are worth 1.84pp.** The identical null configuration reads
**61.39%** on 91001-96001 and **63.23%** on 120001-125001. That gap is as large
as the entire effect under test, which is the whole reason a candidate has to be
re-measured against a null run on ITS OWN bases rather than against the number
from the search set.

| Arm | Search bases (vs 61.39%) | Fresh bases (vs 63.23%) | Pooled |
|---|---:|---:|---:|
| `airRingBonus: 60` | +1.39pp | **−1.39pp** | **≈ 0.00pp** |
| `maximumBoardCharacters: 8` | +0.83pp | **−0.28pp** | **≈ +0.28pp** |
| both together | +1.67pp | **−1.67pp** | **≈ 0.00pp** |

**Both candidates failed confirmation, so nothing from the sweep ships.** The
deck goes out on the values it was built with. That is the correct outcome, not
a disappointing one: `airRingBonus: 60` reading **+1.39pp then −1.39pp** is the
textbook false positive the method exists to catch, and it would have been
shipped on the strength of the search-base number alone.

Note carefully what this does NOT say. The air-ring *mechanism* is still worth
**−6.67pp** when ablated to zero, on the same bases that found the false
positive. A load-bearing mechanism and a tunable constant are different things:
30 is enough, 60 and 90 are noise around it, and 0 is a different deck.

<!-- ROUND3REST -->

## Honor-token targeting fixes (2026-08-10)

Three live-play bugs reported from one session against this deck — Shameful
Display honoring AND dishonoring the bot's own characters, Soul Beyond Reproach
landing on a bowed character at home, and Elegance and Grace readying bodies
after the last conflict had resolved. Written up in full, with root causes and
the measurement, in **`docs/bot-honor-token-targeting.md`**.

Effect on this deck, `deckFieldWinRate.js`, six bases (91001-96001), 384 games
per arm, injected null as the control:

| Arm | Win rate |
|---|---:|
| pre-fix (`shamefulDisplaySplitSides` / `honorTargetLiveSwing` / `eleganceRequiresUse` all `false`) | 59.64% |
| **fixed (shipping default)** | **64.58%** |

**+4.94pp**, positive on both seats (61.46→64.58 and 57.81→64.58). Card audit
after the change: 27/27 plays, 0 zero-use, 17/17 abilities, 0 stalls.

The one that matters for `CraneHonorTactics`: **`pickHonorTarget` now ranks by
whether the token converts to skill RIGHT NOW before it consults
`honorTargetPriority`.** The printed list said `kakita-asami` first and got
obeyed even when she was bowed at home, for a zero swing. The list is unchanged
— it just no longer outranks a ready participant.

## Cross-deck safety

The list shares a lot of card ids with the two other Crane decks and with the
wider field, so every new behaviour is scoped:

- **`craneHonor` keys on `seven-fold-palace` alone.** Tsuma, Court Games, Way of
  the Crane, Voice of Honor, A Perfect Cut, For Shame and Make Your Case all
  appear in other lists; none of them can flip the flag.
- **Playbook entries and DeckAnalysis models are global by card id**, so either
  one silently changes every OTHER deck running the same card — and those decks
  were measured without it. Cross-checked against all 16 fixtures, four decks are
  exposed:

  | Shared id | Also in | Resolution |
  |---|---|---|
  | `for-shame` (entry) | ScorpionBidWar | **scoped** via `DECK_SCOPED_PLAYBOOK_ENTRIES` |
  | `before-the-throne` (entry + model) | Scorpion | **scoped** |
  | `tsuma`, `brash-samurai`, `savvy-politician` (models) | Crane, CraneDuels | **removed** |

  `DECK_SCOPED_PLAYBOOK_ENTRIES` (in `CardPlaybook.ts`) makes `getPlaybookEntry`
  return `undefined` for a deck that does not derive the owning strategy, so the
  lookup falls through to the cached LLM analysis exactly as it did before the
  entry existed. `JigokuBotController` passes the strategy at all three call
  sites. This is the entry-level twin of `inPlayActionScopedOut`.

  The three models were **removed** rather than scoped: a model describes what a
  card does for whoever faces it, so scoping one by the holder's own strategy is
  semantically wrong. All three are bodies/provinces whose skill and cost the
  live card object already supplies — `DeckAnalysis` exists for EVENTS — so the
  loss is negligible.

  **Verified, not assumed.** Deterministic 56-game fingerprints (14 opponents ×
  4 games, CraneHonor excluded so both builds see an identical field) for
  Scorpion, ScorpionBidWar, Crane and CraneDuels against a build with every
  CraneHonor entry and model stripped: **0 differing games for all four.**

  A methodology warning worth carrying forward: the FIRST version of that
  fingerprint passed `rngSeed` to `runGame`, which **has no such option** —
  `_fieldWorker.js` seeds a game by overriding the global `Math.random`. Every
  game therefore ran unseeded, and the tool reported ~50 of 56 games "changed"
  on an UNCHANGED build. It briefly looked like a −12.5pp regression. Always run
  the same build through a fingerprint twice and require zero before trusting it.

- **Those Who Serve** moved from a Crab-gated hook to a shared profile knob with
  the Crab's own measured values, so that deck is bit-identical.
- **`JigokuBotController.decisionProfile`** gained `craneHonor` in its
  deep-merge list. Inert for every other deck (no shipped override names it).

## Running it

```sh
# Diagnostic: 20 games vs the Crane precon, alternating seats
node tools/selfplay/matchCraneHonor.js 20 1 --trace

# Reachability: every card played, every ability fired, no stalls
node tools/selfplay/auditCards.js CraneHonor 24 1

# The measurement (per .claude/skills/roundrobin/SKILL.md)
SUBJECT=CraneHonor BASES=91001,92001,93001,94001,95001,96001 GPB=2 WORKERS=14 \
  node tools/selfplay/deckFieldWinRate.js
```

The deck is in `DECK_LABELS` (`tools/selfplay/deckRegistry.js`), which is what
`winRates.js`, `headToHeadRoundRobin.js`, `parallelHeadToHead.js`,
`botRoundRobin.js`, `probePaired.js`, `measureDecisiveness.js`,
`compareProfileVariants.js`, `validateBotInteractions.js` and
`compareBotVersions.js` all read — so it is wired into every one of them by that
single entry. It is also in the lobby dropdown
(`jigoku-client/client/NewGame.tsx`).

**Not regenerated:** `jigoku-client/client/botBenchmarkResults.json`. That file
is already stale independently of this deck (it records `version 6` /
`suiteId crane-baseline-4736f7c0` against a `standardBenchmark.js` now at
version 8 with a three-opponent suite id, so the client displays nothing from
it). Refreshing it is 16 decks x 100 games plus 120 matchups x 40 games and is a
separate job.

## Engine notes

- `doji-whisperer` needs **no implementation file** — it is a vanilla 0/3
  Courtier and `Deck.ts` falls back to a plain `DrawCard`.
- Every other card in the list already had an implementation; the only new
  engine-facing work was exposing `conflict.elements` to the bot.
- The role legally replaces one province with an extra AIR province, which is
  how the deck fields three of them.
