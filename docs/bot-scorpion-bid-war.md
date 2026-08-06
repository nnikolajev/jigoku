# Scorpion "Bid War" — Kyuden Bayushi honor-dial deck (V1 bot)

EmeraldDB `2bf73f61-6640-465c-8856-479eb611babc`. Registry label **`ScorpionBidWar`**.
Fixtures: `tools/selfplay/fixtures/scorpion-bidwar-{decklist,cards}.json`.

This is the thirteenth deck the V1 heuristic bot pilots, and the first whose
engine is the **honor dial** rather than the board.

---

## 1. What makes this deck different

Three payoffs hang off the dial and they pull in different directions:

| Payoff | Reads | Wants |
|---|---|---|
| Shadow Stalker (+2/+2), Alibi Artist (dig 2), Kyuden Bayushi's ready bonus (+1/+1) | own **honor total** ≤ 6 | own honor LOW |
| Forgery (cancel an event), Beautiful Entertainer (gain 2 on leaving play) | "less honorable than an opponent" | own honor LOW |
| I Can Swim (discard a dishonored participant), Make an Opening (−X/−X) | own **dial** vs theirs | own dial HIGH |
| Regal Bearing (set our dial to 1, draw the difference) | **their** dial | their dial HIGH |
| Duty | cancels the honor loss that would take our LAST honor | a floor to fall to |

Two engine facts drive everything below:

* `player.showBid` is the **visible dial**; `player.honorBid` is `showBid +
  honorBidModifier`. The transfer and the draw use `honorBid`; I Can Swim, Make
  an Opening, Regal Bearing and Social Puppeteer all read `showBid`.
  **Bayushi Manipulator moves the MODIFIER**, so it buys one extra card and pays
  one more honor without changing anything the dial-difference cards see.
* A duel bid overwrites `showBid` too (`honorbidprompt.ts` always calls
  `setHonorDial`), so those cards read whatever is on the dial *right now*. The
  bot reads it live rather than caching the draw bid.

---

## 2. Card-by-card evaluation and what was implemented

`+` = new logic, `=` = reused existing logic, `·` = passive, no bot code needed.

### Stronghold / role / provinces

| Card | Value | Implementation |
|---|---|---|
| `+` **Kyuden Bayushi** | High. Bow to ready a dishonored friendly; +1/+1 at ≤6 honor. The ready is the point — a bowed participant contributes 0 skill. | `BidWarTactics.shouldUseStronghold` / `pickStrongholdReadyTarget`, gated in `conflictAbilitySources`. **Requires a BOWED dishonored body** — an ungated click spent the once-per-round bow on a cancel (the shared ready selector cancels when nothing of ours is bowed). |
| `·` **Seeker of Earth** | Low-moderate. +1 fate per earth-province reveal, and +2 strength on Upholding Authority. | Existing generic role entry. |
| `+` **Secret Cache** (4) | High. Tutor from the top 5 when attacked — the answer arrives exactly when needed. | Generic province reaction path already fires it. Measured as an alternative stronghold province (below). |
| `+` **Honor's Reward** (5) | Moderate. +3 glory on a participant = **−3/−3 on a dishonored one**, +3/+3 on our own. | Custom target rule in `polarityTargetDecision` (`honors-reward-*`): the generic classifier reads `modifyGlory` as helpful and would always aim it at our own board. Prefers a dishonored enemy when the loss is the full 3. **Shipped as the stronghold province.** |
| `+` **Effective Deception** (4) | High when contested. Cancels any triggered ability at this province. | Generic province interrupt path. |
| `=` **Shameful Display** (3) | Moderate. | Existing Crab/Crane handler (`shameful-*` reasons) — exactly-2 select, own-strongest honored + enemy-strongest dishonored. |
| `+` **Upholding Authority** (3, →5 with the Earth role) | High. On break: see the attacker's hand and discard **every copy** of one card. | `BidWarTactics.pickHandDiscard` + `pickHandDiscardCount`, driven by a new `bidWarCardPower()` reading of the shared `DeckAnalysis` registry. See §3. |

### Dynasty characters

| Card | Value | Implementation |
|---|---|---|
| `+` **Alibi Artist** (1) | Moderate. Free dig-2-keep-1 at ≤6 honor, every round. | Playbook `inPlayAction` + `conflictPhaseAction` + `actionBeforePass`, gated on honor ≤ 6 and hand ≤ 9. |
| `·` **Court Novice** (1) | Low. +2 political while holding air/water. | Passive; `handStats` covers the printed 1/1. |
| `+` **Bayushi Manipulator** (1) | Moderate. +1 to our bid modifier after the reveal: one more card, one more honor paid. Both wanted. | Playbook priority 7 (reactions need ≥6) + `optionalDrawCards: 1`; gated in `triggeredWindowDecision` by `shouldModifyBid` (honor > 4, hand ≤ 10). |
| `=` **Beautiful Entertainer** (1) | Moderate. Gain 2 honor when she dies while less honorable — a real brake on the deck's own honor slide. | Existing entry, priority 7. |
| `+` **Yogo Asami** (2) | Moderate. Bow her (0 military!) for −2 military on a participant; protects Kachiko by name. | New entry, `conflictTypes: ['military']` — in a political conflict bowing her throws away 3 political. |
| `+` **Cursecatcher** (2) | Situational. Cancels a **province** ability while that province holds facedown cards. | New entry priority 8, **restricted to the opponent's provinces**: the printed condition matches both sides, so an ungated trigger cancels our own Secret Cache / Shameful Display / Upholding Authority. Needs the new `interruptedAbilityIsMine` context field, with an attacker-role fallback when the window does not expose the controller. |
| `=` **Shadow Stalker** (2) | High inside the band. +2/+2 at ≤6 honor. | Existing entry. |
| `=` **Blackmail Artist** (2) | Moderate. Political win → take 1 honor. | Existing entry. |
| `+` **Loyal Challenger** (2) | High. Political duel that **blanks the loser**, and forces another honor bid. | New `inPlayAction`, gated on a political conflict with a ready enemy participant. |
| `+` **Social Puppeteer** (3) | High. Swap dials; composure forces their events onto it. | New `inPlayAction`, gated by `shouldSwitchDials` — only when the swap turns something on (composure, or an I Can Swim that needs us higher). |
| `+` **Bayushi Kachiko** (Atonement, 5) | Very high. In a political conflict she participates in, the opponent's discarded **events** become playable from our side, 3/round. | See §4. |

### Conflict cards

| Card | Value | Implementation |
|---|---|---|
| `+` **Slovenly Scavenger** (1) | Low, situational. Sacrifice after a win to shuffle a discard pile back. | New entry priority 4; the sacrifice only fires when our own conflict deck is ≤6 cards (a reshuffle costs 5 honor). |
| `+` **Shosuro Sadako** (2) | Very high. Adds glory instead of subtracting it **while dishonored** — 4/4 the moment she is. | New entry, plus `PersonalHonorProfile.reverseHonorCardIds`: every own-dishonor cost this deck pays now lands on her first (`bid-war-dishonor-reverses-modifier`). |
| `+` **Bayushi Kachiko** (ItFC, 5) | High. Send a weaker participant home and bow it. | New `inPlayAction`, political only, requires a ready enemy participant. |
| `+` **Court Mask** (1) | Moderate. +1/+2; the Action returns it to hand and dishonors the bearer. | New entry. The Action is gated to a bearer that **wants** to be dishonored — on Sadako it is +2/+1 net and the mask comes back. |
| `=` **Elegant Tessen** (1) | High. +1/+1 and readies a cost-≤2 bearer. Nine of this deck's characters cost 1-2. | Existing entry carried `preConflict`, which only the dishonor/shugenja profiles consumed, so it never fired. New `pickTessenSetup` / `pickTessenTarget` install it from a conflict-**phase** window (`bid-war-tessen-ready-setup`) — the ready has to happen before the declaration. |
| `=` **Duty** (0) | Very high. The net that makes the low-honor band survivable. | Existing entry, priority 10. |
| `=` **Banzai!** / `=` **Censure** / `=` **Assassination** / `=` **Court Games** | Reused. | Existing entries. |
| `+` **For Shame!** (0) | High. Dishonor **or bow** an enemy participant. | Had no playbook entry and no card model anywhere; added a `DeckAnalysis` model (swing 3). |
| `+` **Make an Opening** (0) | Scales with the dial gap. | Existing entry **retightened**: X is the ABSOLUTE difference, so the card is dead on a tie. The live-dial reading is behind `bidWarAware`, so every other deck keeps its legacy behavior bit-identical. |
| `+` **Way of the Scorpion** (0) | Moderate. Dishonor a participating non-Scorpion. | New entry; priced by the target's glory capped by its live skill. |
| `=` **Forgery** (1) | High — almost always turned on for this deck. | Existing `lessHonorableThanOpponent` gate. |
| `+` **Regal Bearing** (1) | Very high. Set our dial to 1, draw `|1 − theirs|`. | New entry, political only, requires a participating Courtier and a draw of ≥2. Also flips `bidWarPlan` so the "already breaking / province safe" shortcuts cannot lock it out. |
| `+` **Calling in Favors** (1) | High. Dishonor a friendly, **take** an opposing attachment. Removal and a buff at once. | New entry. Its first prompt is the friendly-dishonor COST — see §5, this was cancelling 21 times per 6 games. |
| `+` **I Can Swim** (2) | Very high. Discard a dishonored enemy participant. | New entry priority 10, gated on a strictly higher dial **and** a dishonored participant, priced by the body it removes. Also flips `bidWarPlan`. |
| `+` **A Season of War** (1, dynasty) | Low-moderate. Reroll every province and restart the dynasty phase. | New `pickDynastyEvent` branch — only when our own province row has ≤1 character left worth buying. |
| `+` **Dispatch to Nowhere** (1, dynasty) | High. Discard **any** character with no fate. | New `pickDynastyEvent` branch, gated on a fateless enemy body worth ≥2 combined skill. Dynasty events are played from provinces like characters, but the fate-aware/board-aware economies only rank bodies, so an event sat in its province until the round ended. |
| `+` **Acclaimed Geisha House** (holding) | High. Dishonor a friendly participant to switch the contested ring. | New `inPlayAction`; the cost is only cheap with Sadako (or a glory-0 body) on the board. |
| `=` **Imperial Storehouse** (holding) | Moderate. Sacrifice to draw. | Existing entry. |

---

## 3. Enemy-hand card-power scoring (Upholding Authority)

The province's interrupt shows the attacker's hand and discards **every copy** of
one named card, so the decision is over **names**, not cards — "one strong card
can be weaker than two copies of a different card", which is exactly what the
scoring has to express.

The engine collapses copies into a single button whose text carries the count
(`"Assassination (2)"`, `arg` = card id), so the ranking works off buttons:

```
score(option) = perCopy + (copies − 1) × perCopy × handDiscardCopyWeight
perCopy       = base + (affordable ? handDiscardAffordableBonus : 0)
base          = max(model.swing, best printed body value)   // or
                handDiscardUnknownSwing for an unmodeled card
affordable    = model.fate ≤ opponent's live fate
```

`base` comes from the shared `DeckAnalysis` registry through a new
`JigokuBotPolicy.bidWarCardPower()`. Unmodeled cards report `known: false` so
the caller applies its own fallback rather than reading a silent zero. Copy
weight defaults to `0.7`: two copies of a swing-4 card (8.5) beat one copy of a
swing-4 card (5.0), while one copy of a swing-6 card still beats two copies of a
swing-2 one. The follow-up count menu always takes the maximum.

**32 new card models** were added to `DeckAnalysis` to feed this (and to satisfy
the existing "every event in every standardized deck is modeled" spec).

---

## 4. Bayushi Kachiko (Atonement) — playing out of the opponent's discard

Her text is a **persistent effect**, not a click: while she participates in a
political conflict, the opponent's discarded events become playable as if they
were in our hand, three per round.

The controller already exposed the opponent's conflict discard as a play pile,
and `normalConflictPlayCandidates` already included it, so the missing piece was
**which** of their cards to spend a replay on. `rankOpponentDiscardEvents`:

* refuses non-events and anything whose modeled swing is below
  `kachikoReplayMinSwing` (2) — Gossip and Rebuild do nothing on our side;
* sorts by swing, then by fate cost, then deterministically by uuid;
* returns nothing once `kachikoReplaysThisRound` reaches the engine's cap of 3.

The policy restricts the opponent-discard pool to that ranking (otherwise the
generic sort would spend a replay on whatever sat on top of their pile), keeps
the ranking's order within the pool, counts accepted replays, and resets the
counter at the Honor Bid — the same boundary the card itself uses.

Specs cover participation gating, ranking, the dead-card refusal, the
non-event filter, the three-per-round budget and an external playability filter.

---

## 5. Bugs found and fixed while wiring the deck

| Symptom | Cause | Fix |
|---|---|---|
| **21 cancels per 6 games** on Calling in Favors, 4 on Acclaimed Geisha House | Their dishonor prompt is a **cost paid on our own side**, but the shared rule classifies `dishonor` as harmful and aims it at the opponent. With only our characters legal it cancelled the whole ability. | New injectable `PersonalHonorProfile.ownDishonorCostSourceIds` (empty for every other deck) → `pay-own-dishonor-cost`. Also removed `requiresPreferredTarget` from Calling in Favors, which was making its cost prompt illegal by construction. |
| 4 cancels per 6 games on Kyuden Bayushi | The gate allowed firing for the +1/+1 alone, but the shared ready-target selector cancels when nothing of ours is bowed. | `strongholdBandBonusOnly` knob, default **off**: require a bowed dishonored body. |
| Elegant Tessen never played | Its `preConflict` flag is only consumed by the dishonor/shugenja pre-conflict block, which looks for **enemy** attachment targets. | Dedicated bid-war setup block, mirroring the Lion one. |
| Dispatch to Nowhere / A Season of War never played | Dynasty **events** are legal from provinces, but every dynasty economy path ranks characters only. | `pickDynastyEvent`, returned as a `FateAwareDynastyPreference` (the caller already bypasses character bookkeeping for non-characters). |
| Cursecatcher would cancel our own province abilities | Its printed condition matches provinces on **both** sides. | New `interruptedAbilityIsMine` context field + attacker-role fallback. |
| Two cards reported zero-use despite firing | The card-usage audit's `SOURCE_REASON` regex requires a recognizable token. | Renamed the reasons to `bid-war-play-*`. |

---

## 6. Injectable surface

Everything the deck does is data on a profile object; no `if(deckId)` anywhere.

* **`BidWarTactics.ts` / `BidWarProfile`** (~30 knobs): the honor band
  (`honorCeiling`, `honorFloor`, `lethalHonorFloor`, `bandFloor`), draw bidding
  (`openingBid`, `descendBid`, `inBandBid`, `recoveryBid`, `rescueBid`,
  `highDialPayoffBid`, `highDialPayoffMinHonorAboveFloor`,
  `opponentPressureHonor`, `opponentHonorVictoryGuard`), the Manipulator gate,
  the dial-difference thresholds, the stronghold ready rule, the Kachiko replay
  budget and minimum swing, the Upholding Authority weights, the reverse-honor
  card list, Elegant Tessen's cost ceiling and the dynasty-event gates.
* **`DeckProfile`** gained three deck-neutral knobs, all defaulting to the old
  behavior: `bidWar?`, `bidWarAware`, `firstPlayerChoice`, `imperialFavorChoice`.
* **`PersonalHonorProfile`** gained `reverseHonorCardIds` and
  `ownDishonorCostSourceIds`, both empty by default.
* `bidWar` was added to the controller's deep-merge list and archetype map, so
  an A/B arm is a JSON string: `SUBJECT_PROFILE='{"deckProfile":{"bidWar":{"inBandBid":2}}}'`.

`DeckStrategy.bidWar` derives from `kyuden-bayushi` (unique) or ≥8 of 18 markers.
The separate Scorpion Poison Mill list scores **5**, so it keeps its dishonor
profile — locked by a spec.

---

## 7. Measurements

Method: `.claude/skills/roundrobin/SKILL.md`. A new deck is measured with
`deckFieldWinRate.js` (one deck varies, twelve held fixed, every opponent, each
pairing played twice on the same shuffle with the subject on each seat, multiple
independent shuffle bases). This rig is **not centred on 50%**.

### The one large effect: the band needs a FLOOR

The first build bid 5 above the ceiling and 4 inside it, i.e. it paid honor
every single round. Over 432 games it lost **224 of its 282 games to dishonor
(79%)** and went **0-36 against the Poison Mill dishonor deck**.

| Configuration | Bases 91001-96001, 432 games |
|---|---:|
| initial (no band floor) | **34.72%** |
| band floor: bid low under the floor, hold level inside it | **43.52%** |

Dishonor losses 224 → 113; wins by dishonor 1 → 32.

### Knob sweep (each arm against its own injected null, same bases)

| Arm | Bases 91001-96001 | Bases 130001-135001 | Verdict |
|---|---:|---:|---|
| null (default knob injected) | 44.44% | 46.00% | rig baseline |
| `inBandBid: 1` | +1.16pp | — | ship (mechanism, see below) |
| `bandFloor: 5` | +1.16pp | — | noise |
| `imperialFavorChoice: 'political'` | +1.50pp | +0.00pp (fresh set) | **reject** |
| `firstPlayerChoice: 'second'` | **−4.63pp** | — | **reject** |
| `chumpBlock: true` | −1.38pp | — | reject |
| `defenseCommitment: 'win-only'` | −0.92pp | — | reject |
| `attackCommitment: 'breakable-or-pressure'` | 0.00pp | — | reject |
| `defenseSkillBuffer: 2` | — | **−2.13pp** | reject |
| `honorRaceAware: false` | — | +0.23pp | reject |
| `descendBid: 3` or `1` | — | **−1.90pp** | reject (validates the max bid above the ceiling) |
| `duelBidding: dishonor objective` | — | **+1.05pp** | ship (confirmed, below) |

`firstPlayerChoice: 'second'` is worth recording: the human deck guide says "go
second in all cases but aggressive Unicorn", and the bot measured **−4.6pp** for
it. The bot does not play the reactive game well enough to cash that in.

### The two shipped tunings

**`inBandBid: 1`** — inside the band, bid 1: a bid that can only *receive*
honor. +1.16pp (432 games) and +0.57pp (863 games) on two independent base sets.
Each is below the ±2.5pp noise floor on its own; the mechanism is not, and the
sign is the same on both sets. Bidding 2 into a low-bidding opponent buys one
card for one honor every round, and dishonor is still 46% of this deck's losses.

**`duelBidding: { objective: 'dishonor', opponentLowHonorUtility: 2 }`** —
duels move honor, and this deck starts them deliberately (Loyal Challenger).

| Base set | null | arm | delta |
|---|---:|---:|---:|
| 120001-125001 (863 games) | 47.62% | 49.59% | **+1.97pp** |
| 130001-135001 (863 games) | 46.00% | 47.05% | **+1.05pp** |
| pooled (1726 games/arm) | 46.81% | 48.32% | **+1.51pp** |

Positive on both independent base sets.

### Final result

Shipped configuration, V1, no injection, on a **fourth, unseen** base set
(140001-145001), 864 games, 0 draws, 0 stalls:

```
TOTAL 427-437 of 864   49.42%   95% CI [46.1, 52.8]
seat 0 45.60%   seat 1 53.24%
win reasons: win:conquest 328, win:dishonor 99, loss:conquest 249, loss:dishonor 188
avg rounds 5.3
```

Pooling every measurement of the final configuration (sets 2, 3 and 4;
2590 games): **48.69%** against the fixed twelve-deck field.

Per opponent (base set 4):

| Opponent | Win rate | | Opponent | Win rate |
|---|---:|---|---|---:|
| PhoenixPhoenix | 86.1% | | Lion | 45.8% |
| Unicorn | 66.7% | | PhoenixShugenja | 44.4% |
| Crab | 55.6% | | UnicornReveal | 37.5% |
| DragonAttachments | 54.2% | | Phoenix | 30.6% |
| Crane / CraneDuels | 52.8% | | **Scorpion (Poison Mill)** | **16.7%** |
| Dragon | 50.0% | | | |

---

## 8. Card utilization and stability

`node tools/selfplay/auditCards.js --decks ScorpionBidWar --seeds 1 --opponents all --games 2`

```
| Deck           | Plays covered | Zero-use | Abilities | Unreached | Failures |
| ScorpionBidWar | 30/30         | 0        | 17/17     | 0         | 0        |
```

Every card in the decklist is played and every non-forced ability is exercised,
against all twelve opponents. Across seeds 1-3 in both fair and omniscient
modes: **0 failed or stalled games**. Across ~3500 measured field games: 1 draw,
0 stalls, 0 `forceProgress` interventions.

Full suite: **11024 specs, 0 failures**. 47 of them are the new
`test/server/bots/bidwartactics.spec.js`. No new lint findings.

---

## 9. Known gaps and what to try next

1. **Scorpion Poison Mill, 16.7%.** A pure honor-drain deck against a deck that
   deliberately lives at 4-6 honor. The band is structurally lethal there and no
   bid knob fixes it — the bot has no signal for "my honor is falling from
   something other than my own dial". A `dishonorThreatDetected` input (their
   air-ring takes, their dishonor plays) that temporarily raises `bandFloor`
   would be the mechanism to try, and it is not reachable from today's context.
2. **Phoenix glory, 30.6%.** They build honored high-glory boards; our answers
   (Way of the Scorpion, For Shame!, Court Games) are priced but not
   prioritized against a glory engine specifically.
3. **UnicornReveal, 37.5%.** Fast military; our courtier bodies are 0-2 military.
4. **Imperial Favor.** The knob exists and measured null on fresh bases. A
   board-derived choice (which axis do we actually have participants on) is a
   better shape than either constant and was not tried.
5. **Seat asymmetry** on the final set (45.6 / 53.2) is larger than on set 3
   (46.5 / 48.7) — worth one more base set before reading anything into it.

## 10. One deliberate change outside this deck

`DeckAnalysis` gained models for **Beautiful Entertainer, Shadow Stalker and
Blackmail Artist**, which the Scorpion Poison Mill list also runs. Assassination's
play gate requires a *modeled* enemy character of cost ≤ 2 (the gate exists to
stop a cancel loop, not to model strategy), so the nine field decks that run
Assassination can now legally target those three when facing either Scorpion
deck. That is correct play — they really are legal cost-≤2 targets — but it is a
real, if small, change to the existing field and is recorded here rather than
buried.
