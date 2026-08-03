# Bot V2: the per-deck tuning program

> **SUPERSEDED 2026-08-02 — read `bot-v2.md` first.** V2 is measurement
> infrastructure now, not a candidate engine, so "the per-deck tuning program"
> is finished as a *V2* program. The **diagnostics and measured results below
> are still valid and still the reference** for per-deck work; what changed is
> that a proven knob now ships into V1 rather than into a V2 profile.
>
> One conclusion in this file has been **retired outright** — see "What actually
> decides breaks" below and the near-miss defense section in
> `bot-v2-rejected-experiments.md`.

V1 took weeks of per-deck craft. V2 is the same kind of bot with more inputs and
more knobs, so it needs the same treatment — deck by deck, measured, documented.
This file is the running order and the record of decisions.

The point of V2 is **not** to reach different conclusions from V1. It is to reach
them from parameters (card value, fate cost, bearer lifetime, province strength,
conflicts remaining) instead of hardcoded ordering, so that:

- values can be swapped without touching flow,
- each deck injects its own logic instead of the shared class growing `if(dragon)`
  branches,
- and multi-stage plans become possible, because a parameterised bot can look past
  the conflict in front of it.

Arriving at V1's play through parameters is a success, not a redundancy.

## What generic changes have already been tried, and failed

All measured cross-deck, n=180 per shuffle base, paired against a V1 control seat.
Read `bot-v2-deck-tuning.md` for the full tables. Summary, so none of these get
retried by accident:

| generic lever | result |
| --- | --- |
| value model as a play GATE (`vetoDeadCards`) | −19 games |
| action planner at default pricing | −19 games |
| action planner + `cardWeight` retune | +1 / −4 (noise) |
| action planner + `persistentValue` | −11 games, agreement 74% → 67% |
| conflict-phase declaration planning (`applyIntentPlan`) | neutral except Phoenix |
| defense planning (`applyDefensePlan`) | negative (tail optimism) |
| dynasty projection (`applyDynastyProjection`) | inert |
| attacker allocation (`applyAttackerPlan`) | **+6.7 / +10.0 / +8.9pp — the one win** |

The pattern is that **the only generic lever that ever paid changes declarations,
not card play.** Everything that reorders or refuses card plays lands at or below
baseline. This is why the program now goes deck by deck.

## What actually decides breaks (measured, and it corrects an earlier claim)

`scratchpad/gapdist.js`, base 93001, 90 games — the skill still needed to break,
sampled at the moment the bot gets its conflict-card window:

| attacking (945 windows) | share | defending (549 windows) | share |
| --- | --- | --- | --- |
| already breaking | 7.2% | province safe | 45.4% |
| **1-2 skill short** | **29.7%** | **losing by 0-2** | **38.8%** |
| **3-4 skill short** | **23.5%** | losing by 3-4 | 10.6% |
| 5-6 skill short | 22.4% | losing by 5-6 | 3.6% |
| 7+ short | 17.1% | losing by 7+ | 1.6% |

**53% of attacking windows sit within 4 skill of a break — one or two cards. 38.8%
of defending windows sit within 2 skill of the province falling — one card.**

This **corrects** the conclusion recorded earlier in `bot-v2-deck-tuning.md`, that
"breaks are insensitive to card play." That was inferred from the break count
staying flat (45/46/46) as the planner's `cardWeight` was swept. The correct
reading is the opposite: the reachable windows are abundant, and the planner is
simply not converting them. 281 attacking windows were 1-2 skill from a break and
it produced roughly 45.

So the leverage on breaks is **converting near-miss windows**, and the numbers say
defense is the cheaper half: a 0-2 gap is one card, and it is worth exactly as much
as making a break. Two archetypes never even look — `spendCardsOnDefense: false`
is set by the rush strategy override (`DeckProfiles.ts:376`) and by the Dragon
five-card-engine deck (`DeckProfiles.ts:794`), and the gate at
`JigokuBotPolicy.ts:3235` returns before the planner is ever called.

The per-deck diagnostic that follows from this, to run for each deck in turn:
**in windows where the gap is 1-2, does the deck have an affordable play that
crosses the threshold, and does it make it?** That is a precise question with a
per-deck answer, unlike the generic pricing sweeps that all failed.

### RETRACTION (2026-08-02): the defense half of that claim is wrong

The diagnostic above was run, and it answers **yes, V1 already makes the play**.
`scratchpad/defgap.js` over 180 games of stock V1: the bot plays a card in
**55.9%** of near-miss defense windows (676 of 1210). The "two archetypes never
even look" line is a rounding error — `spendCardsOnDefense: false` closes only
**50 of 534** near-miss passes (9%). 87% close on
`no-card-passed-intent-filter`.

`scratchpad/defwhy.js` attributes those rejections, and the filter is mostly
**right**: 51% are `no-ready-participant`, whose premise holds because
`conflict.ts:474` makes a bowed participant contribute 0 skill, so buffing one
is wasted. The duel/dragon target rejections are decks correctly refusing to
misplace a tower attachment.

Both levers built from this hypothesis failed. `defenseCheapWinMaxGap` is
single-peaked at V1's hardcoded 3 (−11 games at 0, −3 at 6), and the one
genuinely wrong slice — cards that never touch a friendly body — moves only
+1.30pp over n=540, below the noise floor. Full tables and the mechanical reason
the ceiling is ~10 changed decisions are in
`bot-v2-rejected-experiments.md`.

**Defense is not the cheap half. Do not re-derive this.** The attacking half of
the table was never disproved, but note that Crab's `secureReachableBreak` arm
(topping up near-miss attacks) replicated at −9.3pp and −10.7pp, so the
attacking reading has its own contrary evidence below.

## The measurement harnesses

- `scratchpad/rr2.js <seed> <games> <base> [decks]` — cross-deck round robin, V2
  paired against a V1 control on identical shuffles. **`seed` selects the POLICY
  CLASS, not the shuffle** — the shuffle is `base`. See the methodology correction
  in `bot-v2-deck-tuning.md`.
- `scratchpad/divergence.js <base>` — agreement with V1's card choice per deck,
  split into revived-card versus same-vocabulary divergences.
- `scratchpad/gapdist.js <base>` — distribution of skill-still-needed-to-break at
  each conflict window.
- `scratchpad/reach.js <base> <deck>` — planner override rate and break/win/neither
  outcomes.
- `tools/selfplay/auditCards.js --engine-version v1` — which cards a bot never
  plays, and which Action/Reaction/Interrupt never fires.
- `tools/selfplay/cardLab.js <scenario> [repeats]` — **controlled card lab**. See
  below; this is the tool for "how much is THIS card worth", which round-robin
  cannot answer.

## The controlled card lab

Round-robin measures a whole bot. It cannot price a single card: a card that
turns up in a fifth of games is buried under shuffle and tempo noise, and 54
games is not enough to dig it out.

`cardLab.js` runs the opposite experiment — **fix the board, vary one thing,
replay it.** Both seats are the real `JigokuBotController`, so a card's Action or
Reaction fires through the bot's own judgement instead of being scripted. A
scenario is a `setupTest`-shaped board plus a list of variants; an optional
`ladder` sweeps a second axis (usually attacker strength) so the answer is "at
what pressure does this card stop mattering" rather than one hand-tuned board.

Nothing in the tool knows about any deck. `scenarios/crabWallHoldings.js` is the
first scenario; add others beside it.

**First result — Crab wall holdings, one province defence, 5 attack sizes:**

| holding | province strength | under a 15-skill attack |
| --- | --- | --- |
| no holding | 4 | defender does not defend at all |
| `river-of-the-last-stand` (+0) | 4 | defender does not defend at all |
| `watchtower-of-valor` (+1) | 5 | breaks |
| `watchtower-of-sun-s-shadow` (+1) | 5 | breaks |
| `third-whisker-warrens` (+1) | 5 | breaks |
| `seventh-tower` (+2) | 6 | breaks |
| `kaiu-forges` (+3) | 7 | breaks by exactly 0 |
| `northern-curtain-wall` (+4) | 8 | **HELD** |

Three findings, all of which changed `HoldingValueModel.ts`:

1. **Outcomes tracked STRENGTH and nothing else.** Every +1 holding behaved
   identically to every other +1, abilities included. The wide ability-value
   spread that was written from card text has no support and was flattened to a
   1-3 band.
2. **It is a threshold, not a slope.** +3 lost by one point, +4 won. Strength is
   therefore multiplied (`PROVINCE_STRENGTH_SCORE`), not added.
3. **A holding also buys the DECISION to defend.** With no holding, or a +0 one,
   the defender committed zero skill — it conceded the province. This is why the
   ability term is not zero.

Fixture limitation, recorded so the table is not over-trusted: three Crab
holdings only act "at a province you control with a *Kaiu Wall* holding", so a
one-holding swap disables them by construction. The `pair:` variants add a second
wall; the cross-buff is confirmed (an adjacent +1 becomes +3) but still did not
change an outcome. And the lab measures DEFENCE, so economy abilities such as
Kaiu Forges' dig are invisible to it by design.

## Baseline per deck

Shipped V2 (`applyAttackerPlan` only) versus its paired V1 control, base 90001,
n=18 per deck; agreement measured at base 93001 with the planner on.

| deck | V2 | V1 | delta | agreement | headroom |
| --- | --- | --- | --- | --- | --- |
| Crab | 44% | 44% | 0.0 | 84% | largest — weakest deck, V2 adds nothing |
| CraneDuels | 50% | 39% | +11.1 | 59% | low absolute, V2 already gaining |
| Lion | 56% | 56% | 0.0 | 81% | large — V2 adds nothing |
| Unicorn | 61% | 61% | 0.0 | 77% | large — opted out of attacker plan |
| DragonAttachments | 67% | 67% | 0.0 | 55% | bypasses economy ordering entirely |
| PhoenixShugenja | 67% | 72% | −5.6 | 92% | only deck where V2 trails |
| Crane | 72% | 50% | +22.2 | 69% | small |
| Dragon | 83% | 72% | +11.1 | 74% | small, but biggest divergence volume |
| Phoenix | 83% | 61% | +22.2 | 65% | small |
| Scorpion | 89% | 83% | +5.6 | 76% | smallest |

**A per-deck row is n=18, where one game is 5.6pp.** Use rows to choose which
games to read, never to decide. Only the pooled number decides.

## Running order

Ordered by headroom: lowest absolute win rate with no V2 gain yet comes first.

1. **Crab** — 44%, +0.0. Weakest in the field. Holds 4 of the 9 unpriced cards
   (`levy`, `rebuild`, `fruitful-respite`, `guardians-of-rokugan`). Wall/siege deck
   where province strength and defense are the whole plan, so `siege-warfare`'s
   `provinceStrengthDelta` and stay-ready defense have a real mechanism here.
2. **Lion** — 56%, +0.0. Holds `feeding-an-army`, `for-greater-glory` unpriced.
   Bushi swarm: many bodies, so declaration sizing and `a-perfect-cut` /
   `fine-katana` ordering matter.
3. **Unicorn** — 61%, +0.0. The one deck that opts OUT of `applyAttackerPlan`,
   because its cavalry mover joins a conflict *after* declaration and the rollout
   cannot see it. Needs a movement hook before any declaration planning helps.
   `spoils-of-war` unpriced.
4. **DragonAttachments** — 67%, +0.0, 55% agreement. Bypasses
   `conflictCardEconomyOrder` (`JigokuBotPolicy.ts:3665`), so V1's hardcoded
   sequence *is* its value model. Needs an injected `sequence()` hook; pricing
   alone cannot reach it.
5. **PhoenixShugenja** — 67%, −5.6, 92% agreement. The only deck V2 trails on, yet
   the highest agreement, so the loss is not card choice. `the-path-of-man`
   unpriced.
6. **CraneDuels** — 50% absolute but +11.1 already. Duel value models are built;
   59% agreement is the lowest among gaining decks.
7. **Dragon** — 83%, +11.1. Biggest divergence volume (127 substitutions), almost
   all `togashi-acolyte -> {kiho, event}`: V1 plays the acolyte first on purpose to
   advance its card count. Needs the card-count target as an injected var.
8. **Crane** — 72%, +22.2. Small headroom.
9. **Phoenix** — 83%, +22.2. Small headroom.
10. **Scorpion** — 89%, +5.6. Least room.

## Cards with no value signal at all

Nine conflict events across the field have no value model, no curated `swing`, and
no `conflictContribution`, so any planner sees `null` and skips them:

| deck | cards |
| --- | --- |
| Crab | `fruitful-respite`, `guardians-of-rokugan`, `levy`, `rebuild` |
| Lion | `feeding-an-army`, `for-greater-glory` |
| Crane | `gossip` |
| PhoenixShugenja | `the-path-of-man` |
| Unicorn | `spoils-of-war` |

Note this is *unpriced*, not *unplayed* — V1 still plays them off playbook
priority. Separately, `auditCards.js --engine-version v1` says the only cards V1
genuinely never plays are `iron-crane-legion`, `cunning-negotiator`,
`make-your-case`, `a-season-of-war`, `blackmail-artist` — and of the 32 cards the
value model prices, the overlap is exactly one: `make-your-case`.

## Dead plays and dead abilities under V2 (measured)

`auditCards.js --engine-version v2 --v2-mode pass-through`, all ten decks, seed 1,
all opponents, 20 games each. A "play" is a source-card activation; an "ability"
is a non-forced Action/Reaction/Interrupt firing. Both are live evidence —
mulligans, effect targets, attackers and defenders do not count.

**Plays. V2 is strictly better than V1 here**: V1 left five cards never played
(`iron-crane-legion`, `cunning-negotiator`, `make-your-case`, `a-season-of-war`,
`blackmail-artist`); V2 leaves three (`cunning-negotiator`, `a-season-of-war`,
`blackmail-artist`). Crab, Lion, Phoenix, PhoenixShugenja, DragonAttachments and
Unicorn play every card in their deck at least once.

**Abilities. V2 is slightly worse**: 15 unreached versus V1's 13. V2 fixed
CraneDuels outright (18/18, reviving `graceful-guardian` and `doji-challenger`)
but regressed Crab from 20/22 to 18/22. Every Crab ability it lost is a
DEFENDER trigger (`yasuki-oguri`, `hida-tomonatsu`, `hiruma-signaller`), which is
consistent with `applyAttackerPlan` sending different bodies forward and leaving
different ones home. It is a side effect of the declaration change, not a gate.

### Why they are unreached — and a correction

The first diagnosis here was that `kaiu-siege-force` was blocked by its playbook
priority of 5 against the `priority < 6` gate at `JigokuBotPolicy.ts:5829`. **That
was wrong, and the measurement caught it**: admitting the id was bit-identical to
baseline over 54 paired games, and a value-model probe showed the card was never
evaluated at all.

The real cause is structural and more general. **An in-play character's ACTION
has no generic path in the bot.**

- The triggered-ability window (where the `priority < 6` gate lives) is entered
  only for prompts titled "any reaction" / "any interrupt"
  (`JigokuBotPolicy.ts:1140`). It never sees an Action.
- The board-Action path at `JigokuBotPolicy.ts:4689` is gated on
  `(shugenja || attachmentTower)` — tactics modules most decks do not have.
- Provinces and holdings have their own path (`provinceReactionWorthIt`), which
  defaults to true and needs no playbook entry.

The evidence lines up: of the 15 unreached abilities, **6 are in-play character
Actions**, and both of Crab's permanently dead ones (`kaiu-siege-force`,
`hiruma-signaller`) are Actions while its Reactions do fire. `hiruma-signaller`
is dead under V1 too, so this is not a V2 regression — it is a gap both engines
share.

The remaining unreached abilities are reactions/interrupts whose trigger simply
did not arise in 20 games.

Reviving the Actions therefore needs the board-Action path opened beyond the two
tactics modules — a real change, not yet attempted or measured. `kaiu-siege-force`
is priced in `HoldingValueModel.ts` and ready for it.

One rules note that also corrected the model: `ready()` only unbows. It does NOT
move the character into a conflict already declared, so Kaiu Siege Force never
rescues the conflict in front of it — it buys the next one.

`conflictPlanning.triggeredAbilityAllowIds` was added for this and is retained,
but scoped honestly: it admits a sub-6 **reaction or interrupt** to the triggered
window, which is a real capability, and it is **not enabled for any deck** because
the case it was built for turned out not to be one. An admitted id is gated by
the value model, and for these a `hold` DOES veto — the standing rule against that
exists because refusing a free card worth nothing unplayed loses value, whereas an
ability with a recurring price is the opposite case.

The three plays still never made — `cunning-negotiator`, `a-season-of-war`,
`blackmail-artist` — are NOT structurally blocked: all three sit at priority 7-8
with `useWhen: 'always'` and no `shouldPlay` gate. They are situational, and
`iron-crane-legion` proves the hand-play path needs no playbook entry at all
(it has none, and V2 plays it).

## Per-deck record

Append one section per deck as it is worked: hypothesis, the deck-specific rule or
var added, the measurement, and the decision. Nothing lands on plausibility.

---

## Deck 1: Crab (`crab-defense`) — diagnosis

Baseline: **44% (8/18), +0.0pp over its V1 control**, agreement 84%. Profile at
`DeckProfiles.ts:643`, matched on `defensive && holdingEngine`:
`attackCommitment: 'breakable-or-pressure'`, `chumpBlock: true`,
`defenseSkillBuffer: 2`, `digMinBoardCharacters: 3`, `attackKeepHome: 2`.

### How Crab actually loses — it is conquest, not honor

`scratchpad/crabloss.js`, base 93001, 18 paired games, avg 6.2 rounds:

| outcome | V2 | V1 |
| --- | --- | --- |
| LOSS conquest | 11 | 12 |
| WIN conquest | 6 | 4 |
| WIN dishonor | 0 | 1 |
| LOSS dishonor | 1 | 1 |

**11 of 12 losses are conquest.** The profile comment claims "Crane's honor engine
was winning the long games (dishonor wins ~40% of Crab games)" — that is not true
of this field. Crab loses because its provinces fall. Any plan built on honor
defence is aimed at the wrong loss condition.

### Where the conflicts sit

`scratchpad/crab.js`, base 93001:

| attacking (92 windows) | share | defending (102 windows) | share |
| --- | --- | --- | --- |
| already breaking | **0.0%** | province safe | 33.3% |
| 1-2 short | 22.8% | attacker ahead 0-2 | **49.0%** |
| 3-4 short | 29.3% | ahead 3-4 | 11.8% |
| 5-6 short | 22.8% | ahead 5-6 | 4.9% |
| 7+ short | **25.0%** | ahead 7+ | 1.0% |

Near-miss conversion (1-2 from flipping the province):
**attacking 15 of 21 broke; defending 48 of 50 saved.**

Two facts follow, and they point away from card play:

1. **Defence is already near-optimal.** 96% of savable defences are saved. The
   provinces that fall are the 17.7% of windows where the attacker is already 3+
   ahead — unreachable with one card. Crab does not lose because it misplays
   defensive cards.
2. **Half of Crab's attacks are hopeless.** 0.0% of its attacking windows are
   already breaking (field average 7.2%) and 47.8% are five or more short. It is
   declaring attacks it cannot win, which is `breakable-or-pressure` doing exactly
   what it says.

### Card availability in near-miss attack windows

`hida-kotoe` 10, `levy` 10, `apprentice-engineer` 7, `subterranean-guile` 5,
**`siege-warfare` 4**, `watch-commander` 3, `ornate-fan` 2. Six near-miss attack
windows ended with no play at all.

`siege-warfare` is the interesting one: −2 province strength converts a 1-2 gap
directly, and Crab is the deck that always has a holding in play to enable it.

### Value-model reach in Crab games

`levy` 65 evals / 65 usable, `rebuild` 49/13, `the-mountain-does-not-fall` 34/32,
`siege-warfare` 29/29, `raise-the-alarm` 9/9.

`fruitful-respite` and `guardians-of-rokugan` show **zero** evaluations: they are
in `REACTION_ONLY_CARDS`, and `reactionCardHeld` only handles the cancels
(voice-of-honor, defend-your-honor, insult-to-injury, censure, forgery, duty). The
six economy reactions are priced but **nothing consumes those values** — V1's
playbook priority still decides them. Same for `levy`/`rebuild`/`gossip` unless
`applyActionPlan` is on.

### Hypotheses to test, in order

1. ~~**Stop declaring hopeless attacks.**~~ **TESTED AND WRONG — see results
   below.** Both directions were measured: commit more to reach a break (lever
   A, −10pp) and commit less / pass outright (levers B and D, inert and −15pp).
   The 47.8% figure is real but is not a leak. It is what a deck with a weak
   offence pays for having a win condition.
2. **Convert near-miss attacks with Siege Warfare.** 21 near-miss windows, 6 with
   no play, `siege-warfare` available in 4. Small but clean.
3. **Wire the economy reactions** so `guardians-of-rokugan` (scales with defensive
   win margin — Crab wins defences constantly) and `fruitful-respite` are chosen
   by value rather than playbook order.

Measure each with `rr2.js 1 2 <base> Crab` on at least two shuffle bases, and read
the pooled number, never the per-deck row.

### Crab — results on RANDOM shuffles (the deciding measurement)

`botRoundRobin.js --games 100 --subject Crab --v2-decks Crab`, 900 games per arm,
V2 on Crab's seat only, everyone else V1. This supersedes the fixed-shuffle table
below for judging deck performance.

| arm | record | rate | vs V1 | vs shipped V2 |
| --- | --- | --- | --- | --- |
| V1 control | 343-535 | 39.1% | — | — |
| shipped V2 (`applyAttackerPlan`) | 386-489 | 44.1% | **+5.0pp** | — |
| **B′ hopeless-attack trim** | **405-461** | **46.8%** | **+7.7pp** | +2.7pp |
| C `triggeredAbilityAllowIds` | 359-504 | 41.6% | +2.5pp | −2.5pp |
| A `secureReachableBreak` | 335-533 | 38.6% | −0.5pp | −5.5pp |
| D `applyPassPlan` | 246-611 | 28.7% | −10.4pp | −15.4pp |

**Two corrections to what was recorded earlier.**

1. **The stored V1 baseline was not a valid comparator.** `baselines/v1/` records
   Crab at 31.9%, but a same-code V1 control run under identical conditions
   measures **39.1%**. Comparing the V2 arm against the stored figure would have
   claimed +14.9pp — roughly double the real +7.7pp. Always run the control when
   a delta looks large, even though V1 is frozen; 900 games is about seven
   minutes.
2. **"Crab V2 adds nothing" was wrong.** Shipped V2 is +5.0pp over V1 on random
   shuffles. The old "+0.0pp" came from an n=18 fixed-shuffle row.

**Arm C is the noise gauge, and it is the most useful row in the table.** C is
*proven* to change zero decisions — bit-identical on two fixed-shuffle bases, and
its target card is never evaluated at all. It still moved −2.5pp. So the noise
floor of this methodology at n≈870 unpaired is about ±2.5pp, which matches the
analytic SE for a difference of two independent proportions (~2.4pp).

Read against that floor:

- shipped V2 vs V1 (+5.0pp, ~2.1 SE) and B′ vs V1 (+7.7pp, ~3.2 SE) are real.
- **B′ vs shipped V2 (+2.7pp, ~1.1 SE) is NOT distinguishable from C's −2.5pp
  no-op swing** — so it was re-run at n≈2600, below.
- A (−5.5pp) and D (−15.4pp) are confirmed negative, agreeing with the paired
  fixed-shuffle result. Those two rejections stand under both methodologies.

#### The decisive run: B′ does not beat shipped V2

300 games per matchup, 2700 per arm:

| arm | record | rate |
| --- | --- | --- |
| shipped V2 | 1137-1462 | 43.7% |
| B′ hopeless trim | 1152-1459 | 44.1% |

**+0.4pp, ~0.3 SE. Null.** The +2.7pp at n=900 was noise, precisely as arm C
warned. Note the replication: shipped V2 measured 44.1% at n=900 and 43.7% at
n=2600, while B′ fell 46.8% → 44.1%. The lucky arm regressed; the stable one did
not. **B′ is not enabled for any deck.**

So Crab's real, replicated position is **shipped V2 ≈ 43.7-44.1% versus V1 39.1%,
about +5pp**, and no lever tested improves on it.

**Stalls — and a retraction.** Incomplete jobs at n=900 were V1 8, shipped V2 9,
A 8, C 8, B′ 13, D 16, and this file previously read that as "arms that attack
less leave games running longer". At n=2700 the same two arms are **31 (base) vs
29 (B′)** — no difference. The n=900 gap was noise, the same error arm C exists
to catch. What does hold: undecided games cluster in Crab-vs-Lion for every arm
including V1, at roughly 10-14% of jobs, so this is a slow-matchup property of
the harness caps and **V1 is not stall-free either**.

### Crab — results on FIXED shuffles (`rr2.js`, paired)

First, a **baseline correction**. At n=54 per base instead of n=18, Crab V2 is
not level with its V1 control:

| arm | base 91001 | base 93001 |
| --- | --- | --- |
| shipped V2 (`applyAttackerPlan`) | 29-25, **+7.4pp** | 19-35, **+3.7pp** |
| A: `secureReachableBreak` | 24-30, −1.9pp | 13-40, −7.0pp |
| B: `hopelessAttackKeepHome: 3` | 29-25, *bit-identical* | 19-34, +4.4pp |
| C: `triggeredAbilityAllowIds` | 29-25, *bit-identical* | 19-35, *bit-identical* |
| D: `applyPassPlan` | 22-32, −5.6pp | 10-44, −13.0pp |

The "+0.0pp" in the baseline table above was n=18 noise. Crab V2 is already
ahead; the V1 control is identical across arms, which confirms the pairing.

**Hypothesis 1 is dead in both of its forms, and the reason matters.**

`scratchpad/crabdecl.js` samples the break arithmetic at the moment attackers are
chosen (`declarationProbe`), which the earlier conflict-card-window analysis
could not do. Over 18 games, 100 declarations:

| reach at declaration (`potentialSkill − breakTarget`) | share |
| --- | --- |
| reachable | 37.0% |
| 1-2 short | 19.0% |
| 3-4 short | 16.0% |
| 5-6 short | 7.0% |
| 7+ short | 21.0% |

and 28 declarations had no reachable break at all, costing 35 committed bodies.
Seven declarations initiated SHORT of a break they could have reached — and
**all seven were owned by the attacker plan, none by the break heuristic.**

- Lever A made the bot top those seven up. It replicated **negative on both
  bases** (−9.3pp and −10.7pp against the paired baseline). The rollout benches
  those bodies deliberately, and it is right to: the reserve is worth more than
  the province.
- Lever B was **bit-identical** at base 91001 — same wins, same losses, same
  discordant split. It never changed one decision, because with
  `applyAttackerPlan` on, `plannedNext`/`plannedComplete` return before
  `unbreakableCommit` is ever evaluated. **`attackCommitment` is effectively dead
  code under V2.** Any future attempt to change how much V2 commits has to change
  the rollout, not the commitment mode.
  - **Lever B′ (the adjustment).** `hopelessAttackKeepHome` now also caps the
    ROLLOUT's planned attacker set, which is what made B inert. This finally
    tests the option neither A nor D covered: A committed *more* into a hopeless
    attack (−10pp), D declined the conflict outright (−13 to −17pp), and
    "still attack, but send fewer" had never actually run. First check at base
    91001: **28-26 (+5.6pp)** with 11/8 discordant — decisions genuinely change
    now, and it sits within one game of the baseline's 29-25.
- Lever D turned the rollout's own pass plan on, which is the V2-native way to
  decline a hopeless conflict. It is the worst result in the whole program:
  **−13.0pp and −5.6pp against the V1 control, i.e. −16.7pp and −13.0pp against
  the paired baseline**, replicated on both bases. This independently reproduces
  V1's recorded finding that turtling costs far more than the wasted bodies are
  worth. Crab must keep attacking; the hopeless attacks are the price of having
  a win condition at all, not a leak to be plugged.
- Lever C is covered in the dead-ability section above. It was bit-identical on
  BOTH bases — same wins, same losses, same discordant split — which is the
  cleanest possible evidence that it changed no decision at all.

**Crab verdict, after re-testing on random shuffles.** Shipped V2 is **about
+5pp over V1** (43.7-44.1% versus 39.1%, replicated at n=900 and n=2600), not the
"+0.0" the n=18 fixed-shuffle row suggested. **No lever improves on shipped V2**:
A −5.5pp, D −15.4pp, C a measured no-op, and B′ +0.4pp at n=2600 — null.

The original diagnosis ("half of Crab's attacks are hopeless") is a true
description that has now been attacked from all three directions and yielded
nothing. Committing MORE to reach a break (A) loses. Declining the conflict (D)
loses badly. Committing FEWER while still attacking (B′) does nothing. The
hopeless attacks are not a leak that declaration sizing can plug.

Also produced: two reusable instruments (`crabdecl.js`, `cardLab.js`), the
`--subject`/`--v2-decks` round-robin protocol, a corrected V1 baseline, and the
finding that in-play character Actions have no generic path.
