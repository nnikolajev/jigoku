# Lion "Honor" bot deck (Kyūden Ikoma, 25-honor race)

EmeraldDB `65b10e6f-afd3-4938-933a-4350ae9ce405`. Registry label `LionHonor`.
Strategy flag `lionHonor`, tactics module `server/game/bots/LionHonorTactics.ts`,
shared card packages `server/game/bots/SharedCardTactics.ts`.

**Shipped at 52.99% against the fixed field over 12 independent bases / 768
games** (55.99% on 91001-96001, 50.00% on 120001-125001). That is the second
strongest deck onboarded, behind Crane Courtier Honor (63.00%) and well ahead of
Crab Sacrifice (44.64%) and Lion Duelist (34.51%).

## The archetype

Two decks in the field now run **Kyūden Ikoma**, and they are opposites.
[Lion Duelist](bot-lion-duelist.md) treats the honor lead as a **switch** that
turns five other cards on. This deck treats honor as the **scoreboard**: it
plans to reach 25, and almost every card is either a faucet or a brake.

| Faucet | Honor |
|---|---|
| any **honored** character leaving play (`drawcard.ts:1026`) | 1 |
| Air ring | gain 2, or take 1 |
| **Akodo Toturi** — resolve the claimed ring's effect AGAIN in a military conflict he is in | doubles the above |
| Before the Throne (province) breaking | **2 taken** (a 4-point swing) |
| **Kenson no Gakka** — after you *lose* a conflict there, honor **every** defender | 1 each, later |
| Ikoma Prodigy, after fate is placed on it | 1 |
| Chronicler of Conquests, per conflict with a Battlefield in play | 1 |
| Hero of Three Trees, per conflict while behind on cards | 1 |
| Honored Blade, per conflict its bearer wins | 1 |
| Ardent Omoidasu, whenever they dishonor one of ours | **2 taken** |
| Procedural Interference — they discard a province or hand us 2 | 2 |
| Command Respect / Called to War — they pay to play events / to buy in | 1 |
| Way of the Chrysanthemum | **doubles** honor received from an honor bid |
| Revered Ikoma, after 2 honor gained this phase | (1 **fate**) |

And the brakes, which are what make the faucets add up: **Privileged Position**
(anyone who out-bids us may declare only one conflict this round), **Command
Respect** (their events cost 1 honor each), **Under Amaterasu's Gaze** (+1 to
every card played at a province unless that player leads by 5 honor) and
**Steward of Law** (characters cannot be dishonored while it participates).

The consequences for the shared knobs all follow from "honor is the scoreboard":

- the draw dial bids **4 in the opening round** (the deck must see its brakes)
  and then the **floor** — the higher bidder pays the difference, Chrysanthemum
  gains that difference again, and Privileged Position turns on;
- the AIR ring is the best ring on the board, and the generic `ringScore` files
  it dead last;
- `provinceConcede` is **empty** and `firstPlayerChoice` is **first**;
- **Kenson no Gakka is the stronghold province.** It is the only province in the
  deck that pays for *losing*, and the generic stronghold rule already commits
  every ready body there, so the honor payoff is maximised for free;
- honor is **never sold**: `personalHonor.honorGiftResponse.enabled = false`.

## Why the two Kyūden Ikoma decks are MUTUALLY EXCLUSIVE

`craneHonor` layers over `duelist` because Tsuma keys the duel package and both
belong to the same deck. That pattern does not work here: the two Lion lists
share the **stronghold**, and the duel override names a province
(`frostbitten-crossing`) the honor list does not own. Loading it produced a bot
that tried to put its stronghold behind a card that was not in the deck.

So the derivation is exclusive instead:

```
lionDuelist: ids.has('kyuden-ikoma') && !ids.has('kenson-no-gakka')
lionHonor:   ids.has('kenson-no-gakka')
```

Kenson no Gakka appears in no other shipped list and the duel list does not run
it, so the exclusion is bit-identical for Lion Duelist — **verified**, see
Cross-deck safety.

## What was made generic

The brief asked for the cards shared with other lists to be reused rather than
re-implemented. Three of them were one deck's tactics method that the second
deck could not reach at all, and those moved to `SharedCardTactics.ts` as
optional `DeckProfile` fields:

| Package | Cards | Was |
|---|---|---|
| `strongholdBow?: StrongholdBowProfile` | **Kyūden Ikoma** ("bow a non-Champion") | `LionDuelistTactics.pickStrongholdBowTarget`, dispatched inside `if(lionDuelist)` |
| `conflictRecursion?: ConflictRecursionProfile` | **Kitsu Spiritcaller**, **Forebearer's Echoes** | `LionDuelistTactics.pickRecursionTarget` |
| `dynastyEvents?: DynastyEventProfile` | **Honored Veterans**, A Season of War, **Procedural Interference** | `LionDuelistTactics.pickDynastyEvent` |
| `commanderCharacterIds` / `bushiCharacterIds` | **Prepare for War**, **Called to War** target steering | `LionDuelistTactics.isCommander/isBushi` |

All five are `undefined` by default, so a deck that does not opt in keeps its
previous behaviour exactly. The Lion Duelist override sets them to its own
previously hard-coded values.

Everything else the brief listed was **already** generic and is simply reused:

| Card | Status |
|---|---|
| The Art of War, City of the Rich Frog, Akodo Toturi, Honored General, Ikoma Prodigy | already generic playbook entries |
| Court Games, Voice of Honor, Way of the Lion, Soul Beyond Reproach, Way of the Chrysanthemum, Honored Blade, Shameful Display | already generic (entries + policy steering) |
| Called to War's **defender** side | already `PersonalHonorProfile.honorGiftResponse` — field-wide policy, so this deck sets `enabled: false` instead of adding a Lion knob |
| Before the Throne | entry existed but was **scoped** to `craneHonor` |

`DECK_SCOPED_PLAYBOOK_ENTRIES` now maps a card id to a **list** of owning
strategies, so `before-the-throne` is live for both honor decks and still falls
through for Scorpion Poison Mill, which measured −7.1pp with it. That list *is*
the reuse mechanism for a scoped entry: a second deck opts in by name.

## New card logic

Eighteen cards had no entry. All eighteen ids are unique to this list, so the
entries are globally safe without scoping. Four needed more than an entry:

1. **Chronicler of Conquests** reads "if there is a **Battlefield** in play", and
   every Battlefield in the field is a *holding* in a province (Exposed
   Courtyard) or an *attachment* on one (Under Amaterasu's Gaze). Neither
   appears in `myCharacters`, so the gate could never see one. Added
   `PlaybookContext.battlefieldInPlay` — the same class of blind spot
   `conflictRingElements` fixed for the Crane list.
2. **Under Amaterasu's Gaze** attaches to a *province*, so it needed its own
   target steering (`pickBattlefieldProvince`): the stronghold province first,
   never one that already carries a Battlefield, never a broken one.
3. **Procedural Interference** is a dynasty EVENT — no dynasty economy path in
   the bot ranks events — plus a province target ranking. Both branches of it
   pay us, so it plays on sight; the target is whichever province makes the
   opponent's choice hurt most (City of the Rich Frog refills to three).
4. **Hero of Three Trees** offers "gain 1 honor" or "-1 province strength". The
   honor is the win condition, so it is the default and only an attack that is
   *exactly one point* short of a break flips it.

### A reachability trap worth knowing

`auditCards.js` counts a click as a source activation only when the trace reason
matches its `SOURCE_REASON` regex (`play|ability|trigger|…`). The first version
of the dynasty-event hook reported reason `dynasty-event-<id>`, and **Honored
Veterans and Procedural Interference read as ZERO USE for cards that were in
fact being played every game** — a live probe showed 8 and 6 successful plays in
the same 8 games. Renaming the reason to `play-dynasty-event-<id>` took the
audit from 27/30 to 30/30. A spec now pins the reason against that regex.

Final audit, 51 games against all 16 opponents:
**30/30 plays, 0 zero-use, 17/17 abilities, 0 stalls, 0 failures.**
(Righteous Samurai's reaction needs the *opponent* to cost us honor, so it shows
as unreached in samples where no opponent does; it fires in the wider set.)

## Measurement

Rig: `SUBJECT=LionHonor node tools/selfplay/deckFieldWinRate.js`, per
`.claude/skills/roundrobin/SKILL.md`. Sixteen opponents, mirrors excluded, each
pairing played twice on the same shuffle with the subject on each seat.
384 games per arm, `WORKERS=14` on 18 cores, ~1.5 min per arm.

### The null arm

`{"lionHonor":{"airRingBonus":30}}` — the knob at its own default — reads
**51.04%** against the no-profile run's **51.56%**: 2 differing games in 384.
That is the documented `_fieldWorker.js` pass-through delta (it switches both
seats to `engineVersion: v2` / `v2Mode: pass-through` as soon as any profile is
injected). **The injected null is the control for every arm below**, never the
no-profile run.

### Baseline

| Build | Search bases (91001-96001) | Fresh bases (120001-125001) |
|---|---:|---:|
| First reachable build, no profile | 51.56% | — |
| Injected null | 51.04% | 47.14% |
| **Shipping build** | **55.99%** | **50.00%** |

Pooled over 12 bases / 768 games: **52.99%**. Seat-balanced (56.8/55.2 and
48.96/51.04). `avg rounds 4.2`.

**The base sets alone are worth ~4pp on an unchanged configuration** (51.04 vs
47.14 on the null). That is larger than every effect measured here, and is the
whole reason each arm is compared against a null run on *its own* bases.

### Round 1 — ablations (vs the 51.04% null)

| Arm | Win rate | Δ |
|---|---:|---:|
| `airRingBonus: 60` | 52.86% | +1.82pp |
| `toturiRingBonus: 0` | 53.91% | +2.87pp |
| `maximumBoardCharacters: 9` | 51.04% | **bit-identical** |
| `honorProvinceDefenseBuffer: 0` / `: 4` | 51.04% | **bit-identical** |
| `magistrateMinimumHonoredShare: 0` | 51.04% | **bit-identical** |
| `politicalAxisBonus: 3` | 48.96% | −2.09pp |
| **`towerMinimumTotalFate: 99`** (never buy Toturi) | **46.09%** | **−4.95pp** |
| **`airRingBonus: 15`** (the generic value) | **44.53%** | **−6.51pp** |
| **`airRingBonus: 0, airRingCloseBonus: 0`** | **40.63%** | **−10.42pp** |

**Two mechanisms carry this deck.** Air-ring steering is worth **10.4pp** —
larger than the equivalent Crane Honor ablation (−6.67pp) — and it is not a
tunable constant: 15 is −6.51pp, 30 is the default, 60 and 90 are noise.
Refusing to buy **Akodo Toturi** costs 5pp: he is a 6/3 Champion whose reaction
resolves the claimed ring a second time, which on air is four honor from one
claim, and the win-reason histogram shows the ablation losing 9 honor wins and
15 more games to conquest.

### Round 2 — posture (vs the same null)

| Arm | Win rate | Δ |
|---|---:|---:|
| `chumpBlock: true` | 53.91% | **+2.87pp** |
| `imperialFavorChoice: 'political'` | 53.13% | **+2.09pp** |
| `drawBidding.openingBid: 5` | 52.08% | +1.04pp |
| `attackCommitment: 'breakable-or-pressure'`, keep 2 | 51.82% | +0.78pp |
| `defenseSkillBuffer: 2` | 51.82% | +0.78pp |
| `dynastyGloryWeight: 1.5` | 51.04% | bit-identical |
| `drawBidding.forceLowAfterOpening: false` | 51.04% | **bit-identical** |
| `magistrateCardIds: []` | 51.04% | **bit-identical** |
| `firstPlayerChoice: 'second'` | 50.26% | −0.78pp |
| `dynastyEfficiencyWeight: 3` | 50.00% | −1.04pp |
| **`attackCommitment: 'all'`, `attackKeepHome: 0`** | **44.53%** | **−6.51pp** |

Over-attacking is the largest posture penalty, the same shape as the Crane honor
race: the deck must attack (Kyūden Ikoma's own reaction only fires after an
attack it **loses**, and 96% of its losses are conquest losses) but it cannot
afford to be raced back. `all-but-one` with one defender home is the ridge.

### Round 3 — confirmation on six FRESH bases

Per `SKILL.md`, a candidate found on the search bases is a hypothesis until it
wins on bases it was not found on. Against the fresh-base null of **47.14%**:

| Arm | Search bases | Fresh bases | Verdict |
|---|---:|---:|---|
| `chumpBlock: true` | +2.87pp | **+1.56pp** | **SHIPPED** |
| `imperialFavorChoice: 'political'` | +2.09pp | **+2.60pp** | **SHIPPED** |
| `toturiRingBonus: 0` | +2.87pp | **0.00pp** | rejected |
| `airRingBonus: 60` | +1.82pp | **0.00pp** | rejected |
| `toturiRingBonus: 0` + `chumpBlock` | — | −0.26pp | rejected |
| **`chumpBlock` + `political`** | **+4.95pp** | **+2.34pp** | **SHIPPED** |

`airRingBonus: 60` reading +1.82pp then exactly 0.00pp is the same false
positive the Crane list produced with the identical knob. Two of four candidates
died in confirmation; the two that survived did so on both sets and compose.

#### The two shipped knobs, and why they are counter-intuitive

**`chumpBlock: true` is +2.87pp / +1.56pp here and −2.50pp on the Crane honor
race.** Same knob, same archetype, opposite sign. An unopposed defensive loss
bleeds 1 honor, and honor is the scoreboard for both decks — but the Crane list
needs that body to *attack* with (its stronghold only pays for an attacking
win), while this one is a stalling deck whose brakes already cap how much the
opponent can do with the tempo. The histogram is unambiguous: honor wins
**151 → 172**, conquest losses **180 → 169**.

**`imperialFavorChoice: 'political'` wins on a military board.** The raw skill is
military (Toturi 6, Bushido Adherent 4, Righteous Samurai 4), which is what the
board reading says. But this deck **defends** — the opponent picks the axis, the
Courtier half of the list (Ikoma Prodigy, Chronicler, Revered Ikoma, Ardent
Omoidasu, Steward of Law) is what meets a political attack, and the field
contests the political Favor less, so the deck simply holds it more often.

### Two knobs that were built and then REMOVED

Both measured **bit-identical**, which is the broken-wire signature, not a null:

- **`honorProvinceDefenseBuffer`** was meant to over-commit the defense at Kenson
  no Gakka so more defenders get honored. It is unreachable *because the deck is
  already doing it*: Kenson is the stronghold province, and
  `JigokuBotPolicy.declareDefenders` commits **every** ready body when the
  stronghold is attacked, before any sizing runs. The knob was deleted and the
  reason recorded in the module header so nobody re-adds one.
- **The Implacable Magistrate attacker ordering is MEASURED INERT.** Both
  `magistrateMinimumHonoredShare: 0` and `magistrateCardIds: []` read
  bit-identical over 384 games, and a direct instrument confirmed why:
  `orderAttackers` is called **160 times per 16 games and the Magistrate was in
  the candidate or committed set ZERO of those times.** The rule ("only attack
  with it alongside honored characters, because it blanks our own unhonored
  attackers too") is the correct reading of the card and is kept and specced,
  but it is labelled `MEASURED INERT` in the module header. Do not spend a
  measurement cycle on it without first making the body get bought.

### What the deck actually does

Shipping build, 768 games:

| | Search bases | Fresh bases |
|---|---:|---:|
| `win:honor` | 177 | 150 |
| `win:dishonor` | 23 | 29 |
| `win:conquest` | 15 | 13 |
| `loss:conquest` | 159 | 185 |
| `loss:honor` | 10 | 7 |

**93% of its wins are on the honor track and 95% of its losses are conquest
losses.** It is a race, and the only way it dies is being out-raced.

Per-opponent (24 games each, search / fresh bases):

| Opponent | Search | Fresh | | Opponent | Search | Fresh |
|---|---:|---:|---|---|---:|---:|
| PhoenixPhoenix | 79.2% | 83.3% | | PhoenixShugenja | 66.7% | 50.0% |
| Dragon | 79.2% | 62.5% | | Phoenix | 62.5% | 50.0% |
| Crane | 70.8% | 41.7% | | DragonAttachments | 54.2% | 41.7% |
| CraneDuels | 70.8% | 75.0% | | Crab | 50.0% | 45.8% |
| Lion | 70.8% | 70.8% | | ScorpionBidWar | 45.8% | 58.3% |
| CrabSacrifice | 66.7% | 58.3% | | UnicornReveal | 45.8% | 16.7% |
| Unicorn | 66.7% | 50.0% | | **LionDuelist** | **29.2%** | **41.7%** |
| | | | | **Scorpion** | **20.8%** | **37.5%** |
| | | | | **CraneHonor** | **16.7%** | **16.7%** |

The three bad matchups are exactly the three decks that attack the honor track
directly: **Crane Courtier Honor** races it and is faster (16.7% on both base
sets — the most stable row in the table), **Scorpion Poison Mill** drains it,
and **Lion Duelist** contests the same "more honorable" space from a faster
board. Everything that has to assemble a board loses to the clock.

## Cross-deck safety

Every new behaviour is scoped, and the extraction was **verified, not argued**:

- `lionHonor` keys on `kenson-no-gakka`, unique to this list.
- All 18 new playbook entries and all 4 new `DeckAnalysis` models use ids that
  appear in no other shipped list.
- `before-the-throne` widened from one owning strategy to two; Scorpion still
  falls through.
- The three shared packages carry the Lion Duelist list its own previously
  hard-coded values.

`tools/selfplay/deckFingerprint.js` (added with this deck) plays a fixed, fully
seeded list of games for one deck against the field and prints a hash. The
extraction was compared by temporarily re-inserting the old branches behind an
env switch in the same working tree — which avoids the mistake of diffing
against a commit that also lacks the *previous* deck's work:

| Deck | Games | Result |
|---|---:|---|
| LionDuelist | 48 | **identical** (`205e52b3ce1bdddd`) |
| Lion | 48 | **identical** (`dabaf2b434138629`) |
| Scorpion | 48 | identical |
| ScorpionBidWar | 48 | identical |
| Dragon | 48 | identical |
| PhoenixPhoenix | 48 | identical |

The tool was validated by running the same build through it twice and requiring
zero difference first — the failure mode recorded in
[bot-crane-honor.md](bot-crane-honor.md), where a fingerprint that passed a
non-existent `rngSeed` option ran every game unseeded and reported a −12.5pp
regression on an unchanged build.

`npm run jasmine`: **11144 specs, 0 failures** (45 of them new).

## Running it

```sh
# Diagnostic: 20 games vs the Crane precon, alternating seats
node tools/selfplay/matchLionHonor.js 20 1 --trace

# Reachability: every card played, every ability fired, no stalls
node tools/selfplay/auditCards.js --decks LionHonor --seeds 1 --opponents all \
  --modes fair --games 3 --workers 12

# The measurement (per .claude/skills/roundrobin/SKILL.md)
SUBJECT=LionHonor BASES=91001,92001,93001,94001,95001,96001 GPB=2 WORKERS=14 \
  node tools/selfplay/deckFieldWinRate.js

# Cross-deck regression after touching a shared card
SUBJECT=LionDuelist GAMES=4 node tools/selfplay/deckFingerprint.js > after.txt
```

The deck is in `DECK_LABELS` (`tools/selfplay/deckRegistry.js`), which is what
`winRates.js`, `headToHeadRoundRobin.js`, `parallelHeadToHead.js`,
`botRoundRobin.js`, `probePaired.js`, `measureDecisiveness.js`,
`compareProfileVariants.js`, `validateBotInteractions.js`,
`deckFieldWinRate.js`, `auditCards.js` and `compareBotVersions.js` all read — so
it is wired into every one of them by that single entry. It is also in
`v2BenchmarkPartitions.json` (training + holdout leagues) and in the lobby
dropdown (`jigoku-client/client/NewGame.tsx`).

**Not regenerated:** `jigoku-client/client/botBenchmarkResults.json`, which is
already stale independently of this deck (see `bot-crane-honor.md`).

## Engine notes

- **All 38 cards already had engine implementations.** The only engine-facing
  work was exposing `battlefieldInPlay` to the bot.
- The Seeker of Air role legally replaces one province with an extra AIR
  province, which is how the deck fields two of them (Before the Throne, Kenson
  no Gakka) and turns each reveal into a fate.
