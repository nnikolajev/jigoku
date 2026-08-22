# Crab "Berserker Sacrifice" bot deck (Castle of the Forgotten)

EmeraldDB `59c4d29f-6414-47d7-9009-a1feef5c7917`. Registry label `CrabSacrifice`.
Strategy flag `crabSacrifice` (keyed on `castle-of-the-forgotten` alone, so the
Kyuden Hida Crab wall precon is untouched). Override
`crab-sacrifice-castle-of-the-forgotten`. Tactics module
`server/game/bots/CrabSacrificeTactics.ts`.

## The archetype

**A body is a resource, not a board presence.** The deck buys the widest possible
board of cheap high-military characters at zero fate, then spends the surplus
bodies as a *cost*:

| Outlet | Cost | Payoff |
|---|---|---|
| Silent Skirmisher | sacrifice another character | +2 military |
| Stoic Gunso | sacrifice a character | +3 military |
| Steadfast Witch Hunter | sacrifice a character | ready a character |
| Weight of Duty (province) | sacrifice a **participant** | bow **and** dishonor an enemy |
| Way of the Crab | sacrifice a **Crab** | the opponent sacrifices a character |
| Fulfill Your Duty | sacrifice a character | attacked province +X strength |
| Tainted Hero | sacrifice a character | blanks its own text so it may fight |

Three bodies pay *when they die* — Gallant Quartermaster (2 fate), Kaiu Envoy
(Courtesy + Sincerity: a fate and a card), Sharpened Tsuruhashi (returns to
hand) — and two pay *when something else dies*: Vengeful Berserker doubles its
military, Fifth Tower Watch bows an enemy smaller than the sacrificed body.

Castle of the Forgotten turns every conflict military for the round after the
first break, which is the whole board, so the axis is never in question.

## THE IRON MINE TABLE (measured, not reasoned)

The obvious-looking combo is: sacrifice the biggest body to an outlet, cancel the
leave-play with Iron Mine / Reprieve / Ceaseless Duty, keep the body **and** the
payoff. **It does not work.** Every outlet in this deck spends the body as a
`AbilityDsl.costs.sacrifice` COST, and a prevented sacrifice is an unpaid cost,
so the ability never initiates. Pinned in
`test/server/cards/CrabSacrificeIronMine.spec.js` (11 specs):

| Effect | Sacrifice ALLOWED | Sacrifice PREVENTED by Iron Mine |
|---|---|---|
| Silent Skirmisher's +2 military | applied | **not applied** |
| Gallant Quartermaster | +2 fate | **+0 fate** |
| Sharpened Tsuruhashi | returns to hand | **stays attached** |
| Vengeful Berserker | doubles | **does not double** |
| The body | leaves play | stays in play |
| Iron Mine | untouched | **spent for nothing** |

This matches the printed ruling the deck guide quotes: *"If that occurs during
the payment of a cost, then that cost is not considered to have been paid."*

`CrabSacrificeProfile.saveInversion` is therefore `false`, and the policy
refuses to fire a save on a body it is itself spending
(`pendingSacrificeCostUuid`). Turning the inversion on cost **6.5pp**
(30.65% → 24.11%) before the guard existed.

### The guard leaked for Iron Mine — fixed 2026-08-22

The claim above ("the policy actively refuses") was true only for Reprieve and
Ceaseless Duty. **Iron Mine is a HOLDING, and a holding sits in a province**, so
it matched the province-location test in `triggeredWindowDecision` and was
selected by the `trigger-province-ability` branch — which returns *before* the
`pendingSacrificeCostUuid` guard, that guard living in the character/event
branch below it. A runtime probe confirmed the guard state was correct at the
window (`pending` set, `pendingName` matching, `seen: 1`); it was simply never
consulted on that path.

Cost, measured over 12 self-play games (3 bases × 4 opponents): **14 of 14**
`"attempted to use X, but did not successfully pay the required costs"` events
were this exact sequence, in 10 of the 12 games, twice in some:

```
Seat0 uses Iron Mine to prevent Kaiu Envoy from leaving play
Seat0 attempted to use Stoic Gunsō, but did not successfully pay the required costs
```

Iron Mine spent, cost unpaid, pump never applied, body still in play. The deck
runs three Iron Mine and its measured weakness is that it *has no board*, so
burning its persistence engine on its own costs is doubly expensive.

Fixed by `savesOwnSacrificeCost`, checked inside the province finder's
predicate. Same slate after: **0 of 12** games, and 4/12 wins against 2/12
(a diagnostic, not a measurement — three bases, no seat swap).

**So the saves have two uses here, and the smaller one is removal.** This deck
buys at zero fate on purpose, so its whole board is discarded in the FATE
PHASE, and that is the leave-play the saves mostly answer: across five recorded
human games, **10 of 11** save uses were fate-phase persistence (Tainted Hero
×4, Unleashed Experiment ×2, Damned Hida, Butcher of the Fallen, One of the
Forgotten) and exactly **one** answered opponent removal (Ceaseless Duty on an
Assassination). A save spent in the conflict phase is a save unavailable at the
fate phase.

## The setup-fate floor was overriding deliberate DIRE zeros

`saveFatePass.setupRounds` ships field-wide at `[1,2,3]` and `raiseSetupFate`
raises whatever a deck would naturally put on a body up to that floor. It was
raising the zeros that are the whole point of a **dire** character: Damned Hida
is +3 military only while it has no fate (6 → 3 with one on it), and Unleashed
Experiment only sheds `honorCostToDeclare(2)` while empty, so a floored copy
bleeds 2 honor on every declaration in the deck whose top loss reason is
dishonor. It hit UnicornReveal's Khanbulak Benefactor the same way.

Fixed by threading an `exactZero` flag into `raiseSetupFate`, set by any branch
that answers with a deliberate zero for a dire body
(`FateAwareAdditionalFateOverride.exact`, and the Benefactor branch). The floor
itself is unchanged for every other card.

Second defect on the same path: `fateAwareAdditionalFateButton` did
`Math.max(economy, override)` for board-aware decks, so a deck override of 0 was
a **floor and never a zero**. Same `exact` flag governs it.

## Two human-derived levers, both measured, both OFF

Read off five recorded human games (2026-08-22, human 4W-1L with this list).
Both are wired, both default off, both are a JSON string to switch on.

### `useDeckFatePlacement` — fate is two classes, not one rate

Payload (Tainted Hero 1.83 fate average, Butcher) is bought to PERSIST and fed a
fresh cheap body every round; fodder (Gallant Quartermaster 0.10, Kaiu Envoy
0.17) is bought to DIE, so fate on it is burnt with the body; dire is a hard
zero. The bot was applying a flat +1 to all three.

**Null over 384 games / 12 bases.** `+5.73pp` on 140001-145001, `−2.60pp` on
150001-155001, pooled `+1.56pp` (155/384 vs 161/384, z=0.44, p=0.66). The two
base sets disagree by 8.3pp about one lever — do not re-roll six bases and ship
the sign you like.

The *mechanism* replicates in both sets even though the win rate does not:
dishonor losses fall 45→27 and 49→37, and come back as conquest losses
(64→81 on the fresh set). Cheaper bodies, weaker board — this deck's standing
trade, priced again.

### `fodderReserve` — buy a body to SPEND before a second body to keep

Tainted Hero must eat a friendly character every round. With `bodyOrder:
'highest-cost'` the bot bought the payload first and then fed Tainted Hero to
Tainted Hero — 6 times in 12 games, plus Damned Hida 3 and Unleashed Experiment
2. The human did this **zero** times in five games: all 15 of his blanking costs
were Tier 1 or Tier 2.

**−4.17pp** (38.54% on, 42.71% off; 192 games, six bases). The rule works
exactly as designed — fodder-class sacrifices 26/44 → 32/44, Tainted-Hero-eats-
Tainted-Hero 7 → 3 — and still loses, because the pick spent on a body to spend
is a payload not bought. At 2.2 bodies a dynasty phase this deck cannot afford
both classes; the human affords the rule because he also buys 3.00 a phase.

Caveat on that run: the null arm reproduced its control to within one game of
192 rather than exactly, so the injection path is not perfectly transparent
here. Much smaller than the 8-game effect, but the size is not precise.

## The 3.00-vs-2.24 bodies/phase gap — diagnosed, and NOT closable by buying

The human buys **3.09** characters per dynasty phase, the bot **2.45**. Ten arms
were run at the gap. It is not fate, not budget and not card availability, and
forcing it open costs **8.3pp**.

### Where the gap is NOT

| suspected cause | measurement | verdict |
|---|---|---|
| fate income early | R1-R2 spend 5.60/6.00 human vs 5.58/5.83 bot | **identical** |
| body spend caps | caps -> 14: bodies 2.45 -> 2.45 | not binding |
| cards revealed | 3.59/phase human vs 3.43 bot | near-identical |
| Rally placements | 2.00/game human vs 2.33 bot | bot is HIGHER |

The gap opens at round 3+: human spends 9.08 fate a phase and ends on 1.25; the
bot spends 6.19 and ends on 2.81.

### Where the gap actually is

**The bot runs out of CARDS, not fate.** Seat-attributed probe over 18 games:
**57% of its dynasty phases end in `fate-aware-pass-after-buying`** — the branch
taken when `characters.length === 0` — and most of those at 0-1 fate left. Only
24% end in `preserve-fate` with cards still on the table.

Of what IS revealed, the human buys **93%** of characters and the bot **81%**
(after discounting revealed Iron Mines, which are 0.40/phase for the bot against
0.26 for the human).

The human's extra fate is one loop: **Gallant Quartermaster costs 1 and refunds
2 when sacrificed**, so feeding it is +1 fate AND a fired outlet, and the fate
lands in the next round's dynasty phase.

| | GQ bought/round | GQ fed/round | fed:bought |
|---|---|---|---|
| human | 0.43 | 0.43 | **100%** |
| bot | 0.15 | 0.08 | 50% |

### Every arm that installs the loop makes it worse

`fodderReserve` fixed the FEEDING half (50% -> 88%) and measured **−4.17pp**.
Fixing the BUYING half needs cheap-first ordering, and that is worse still:

| arm | bodies/phase | fate LEFT | note |
|---|---|---|---|
| control | 2.45 | 2.20 | |
| caps raised | 2.45 | 1.84 | inert |
| `bodyOrder: lowest-cost` | 2.60 | **4.34** | |
| lowest-cost + fodder + caps | **2.80** | 3.69 | best width |
| `fodderReserveMinimum` 1/2/3 | 2.33/2.33/2.43 | 3.07/3.18/3.21 | |
| `durableCharacterIds: []` | 2.28 | 1.81 | fewer, bigger |

Note the signature: **every arm that raises bodies raises UNSPENT fate.** That is
the tell that province throughput, not fate, is the binding constraint — cheaper
bodies do not create more dynasty cards to buy.

The best width arm was measured properly, `deckFieldWinRate`, 384 games over the
same twelve bases as the control:

```
control  155/384  40.36%
width    123/384  32.03%   CI [27.6, 36.9]     -8.33pp
```

and the reason is in the win reasons: `loss:dishonor` **131** against the
control's 94. A wider board of cheaper bodies loses more conflicts, and this
deck pays for lost conflicts in honor.

**Conclusion: 2.45 bodies a phase is this deck's equilibrium at bot skill, not a
misconfiguration.** The human sustains 3.09 because he closes the GQ loop 100%
of the time AND wins the conflicts that keep his honor, which is a play-quality
difference, not an allocation one. Do not re-open this by tuning `bodyOrder`,
`bodySpendCap*`, `durableCharacterIds` or `fodderReserve*`; all six are measured
above.

## Sacrifice ranking

`CrabSacrificeTactics.sacrificeCost()` prices what losing a body costs; the
cheapest is fed. Tiers are data (`sacrificeTier1` / `sacrificeTier2`, everything
else is Tier 3):

- **Tier 1 — feed eagerly, death is the payoff:** `gallant-quartermaster`,
  `kaiu-envoy`.
- **Tier 2 — feed once it cannot win the conflict:** `silent-skirmisher`,
  `promising-youth`, `one-of-the-forgotten`, `unleashed-experiment`.
- **Tier 3 — the payload, never fed:** the 6-9 military bodies, plus the outlets
  and death-payoffs themselves (`outletPenalty`).

A **bowed** participant and a body **at home** both contribute 0 skill, so both
are discounted heavily — they are the correct fodder.

### Fulfill Your Duty is break-NEUTRAL on a ready participant

The break test is `attackerSkill - defenderSkill >= provinceStrength`.
Sacrificing a ready defender drops defender skill by X and raises province
strength by the same X: they cancel exactly. The card only gains when it eats a
body contributing **zero** — one at home, or a bowed participant. Its playbook
gate and `conflictContribution` both encode that.

## Reachability — what was dead and why

The first build played the deck at 3-3 vs Crane with **9 of 15 abilities never
fired**: the entire sacrifice engine. Fixes, in the order they mattered:

1. **`no-ready-participant`** — the shared veto refuses non-character cards while
   no participant is ready, on the premise a buff on a bowed body is wasted. This
   deck *empties its own board on purpose*. `worksWithoutReadyParticipant` on the
   saves, Way of the Crab, Tsuruhashi and Fulfill Your Duty, plus
   `conflictPlanning.readyEffectIgnoresReadyParticipant: 'always'` (the default
   `'defense'` is not enough — the deck spends most windows attacking).
2. **Those Who Serve is a CONFLICT card played from HAND during the dynasty
   phase.** The dynasty window only ever looks at provinces, so three copies
   cycled unused. Fired by an explicit policy hook *before* any character is
   bought, or the discount is wasted. (Same trap as Lion's Honored Veterans.)
3. **`zero-contribution`** — Tsuruhashi's worth is the recursion, not its +1.
4. Fulfill Your Duty needed a `conflictContribution` or the break budgeter could
   not see it at all.

Result: `auditCards` **28/28 plays, 15/15 abilities, 0 zero-use, 0 stalls**.

## Measurement

Rig: `SUBJECT=CrabSacrifice node tools/selfplay/deckFieldWinRate.js`, per
`.claude/skills/roundrobin/SKILL.md`. Every arm ran 336 games over six bases;
the shipped build was re-measured over **twelve**.

### Client benchmark, 2026-08-22: 37.3% -> 47.0% in the field round robin

The standard client benchmark (`botRoundRobin.js`, 40 games per matchup, every
deck against every other) was rerun after the Iron Mine fix, the dire-zero
fixes, `useDeckFatePlacement` and the stronghold surplus cap:

| | before | after | |
|---|---|---|---|
| CrabSacrifice | 37.3% | **47.0%** | **+9.7pp** |

It was the largest mover in the field by a factor of 1.5, against sixteen other
decks that drifted between +6.4pp and -5.0pp. Treat the SIZE with the usual
caution — a field round robin is zero-sum (these deltas sum to ~0), so it
reports standing, not proof that a change is good, and this was not a controlled
arm. But the deck-specific fixes it followed (Iron Mine no longer cancelling the
bot's own sacrifice cost, 14 occurrences -> 0) are the obvious candidate, and
nothing else in the field gained anything like as much.

### SHIPPED: 44.64%, 672 games, 12 bases, CI [40.9, 48.4]

Seat-balanced 43.75 / 45.54. `avg rounds 5.0`.

| Build | Win rate |
|---|---|
| First reachable build (save inversion ON) | 21.43% |
| Save inversion OFF + never save own cost | 30.65% |
| \+ honor floors on the deck's card costs | 24.11% (**rejected, −6.5pp**) |
| \+ `attackCommitment:'all'` + `defenseCommitment:'win-only'` | 37.80% |
| \+ low honor dial (`minimumRoutineBid`/`lowBid` = 1) | **44.64%** |

Per-arm deltas against a null arm that reproduced the control **exactly**
(30.65%, identical win reasons):

| Arm | Δ |
|---|---|
| low dial alone | **+12.8pp** |
| `attackCommitment:'all'` | +4.5pp |
| `defenseCommitment:'win-only'` | +3.6pp |
| `spendCardsOnDefense:false` | −2.7pp |
| `chumpBlock` | −0.3pp |
| `attackKeepHome:2` | **bit-identical — inert under `all`** |
| `forceLowAfterOpening` | −2.7pp |

The combined lever was found on bases `91001-96001` (+16.1pp) and **confirmed on
six bases never used in the search**, `120001-125001` (+10.1pp). Both base sets
positive; pooled ≈ +13pp. The two base sets differ by 6pp on the same lever,
which is the usual warning against trusting one set.

### The honor story, and the wrong turn

70% of losses were `loss:dishonor`, so gating the deck's own honor COSTS looked
obvious. It measured **−6.5pp and made dishonor losses WORSE** (164 → 182): the
conflicts given up by holding Unleashed Experiment back are the ones the deck
needed to end the game before its honor ran out. `declareHonorFloor` and
`honorSpendFloor` survive as knobs but default to `0` (inert).

The honor was leaving through the **dial**, not the cards. The higher bidder pays
the difference, and bidding into the field handed away exactly the resource the
deck then lost on. Dropping the routine bid to 1 took dishonor losses from
158 to 66 and is the single biggest lever in the deck.

### The knob sweep — everything measured, nothing beat the defaults

Second tuning round, 6 bases per arm against a null that reproduced 46.43%
exactly. **No arm survived.** The shipped values were already at a local
optimum, and the round's real product was two broken wires and one big number.

| Arm | Result |
|---|---|
| `sacrificeSkillWeight: 3` | +1.49pp on the search bases, **exactly 0.00 on six fresh ones** — noise |
| `sacrificeSkillWeight: 5` | identical to 3 (the ranking saturates) |
| `sacrificeSkillWeight: 0` | −3.87pp — the skill term is load-bearing |
| `sacrificeNonParticipantDiscount: 1` | −2.08pp |
| `tierPenalty: [0,0,0]` | −1.19pp |
| `tierPenalty: [0,3,12]` | −0.30pp |
| `outletPenalty` 0 / 25 | −0.30pp / bit-identical |
| `outletRequireDecisiveSwing` | +0.30pp — null |
| `firstPlayerChoice: 'second'` | −3.28pp (going first is right) |
| `preventBreakAfterBrokenProvinces: 2` | bit-identical (inert under `win-only`) |
| `aggressiveFate: false` | bit-identical (the fate-aware economy owns this) |
| `fateAwareEconomy.bodyAdditionalFateForCostThree: 1` | −5.36pp (Damned Hida must stay DIRE) |
| `fateAwareEconomy.durableAdditionalFate` 2/1 | −0.60pp |

`tierPenalty` steeper and **Tier‑2 re-ordering were rejected without spending a
game**: a census over 330 live `pickSacrifice` calls showed both produce **zero**
different picks. Tier 3 only ever gets fed when nothing cheaper is legal, and
the Tier‑2 list is a SET — order never reaches the sort, which ranks on skill,
fate and attachments.

### Castle of the Forgotten is worth +14.0pp — and the knob was dead

`castleAlwaysAfterBreak` / `castleMinimumConflictsRemaining` were declared but
never read: `provinceReactionWorthIt` returned `true` for every stronghold. Both
selectivity arms measured bit-identical, and so did an arm that turned Castle
**off entirely** — the tell that the wire, not the lever, was broken.

The cause is a general one worth knowing: when the province/stronghold finder
DECLINES a card, the character/event "hinted" reaction filter directly below it
re-offers the same card on priority alone, silently overriding the decline. The
guard added here is scoped to this profile, because fixing it globally would
move decks that were tuned with the override in place.

With the wire live, `castle-OFF` measures **32.44% against 46.43%**: forcing
every conflict military after the first break is worth **+14.0pp**, the largest
single contributor in the deck. Selectivity remains inert — always is correct.

### Why it loses to the rush decks: it has no board

Per-round sampling vs UnicornReveal / Lion / Unicorn (32 games):

| Round | bodies (mine v theirs), UnicornReveal | vs Lion |
|---|---|---|
| R3 | 0.4 v 1.4 | 0.8 v 1.8 |
| R4 | 0.4 v 2.1 | 0.1 v 3.1 |
| R5 | 0.1 v 2.6 | 0.0 v 3.0 |

Its military decays toward 0 while theirs climbs to 12-15. Everything is bought
at zero fate, so the whole board dies every fate phase — copied from the Phoenix
rotation deck, where the dynasty discard is a resource, which here it is not.

**Both obvious fixes measured neutral or negative.** Buying persistence costs
board width (`bodyAdditionalFateForCostThree` −5.4pp, `durableAdditionalFate`
−0.6pp), and gating the sacrifice outlets so they only fire when decisive was
null (+0.3pp) — the outlets are not the leak either. This is an archetype
property, the same conclusion the Fushicho deck reached about persistent honored
boards: the deck trades its board for tempo and loses to opponents who keep one.

### Matchups (12 bases, 48 games each)

Strong: CraneDuels 77%, PhoenixPhoenix 77%, ScorpionBidWar 67%,
DragonAttachments 58%, Scorpion 56%, Crane 52%.
Weak: UnicornReveal 8%, Lion 17%, Unicorn 25%, Phoenix 27%, Crab 31%.

The pattern is that it beats decks that need time to assemble something and
loses to decks that race it or out-body it early.

## Cross-deck safety

Only one card overlaps another shipped list: **Weight of Duty**, which the Lion
swarm precon also runs as a province. It shipped with no playbook entry, so
adding `inPlayAction` for this deck would have silently changed Lion. The Action
is scoped in `JigokuBotPolicy.inPlayActionScopedOut()` — the layer that can see
the profile, per the Lion Duelist lesson that a `PlaybookEntry` cannot.

No other new entry appears in any other deck fixture.

## Engine notes

- `seeker-of-void`, `ancestral-daisho`, `kitsuki-s-method` and `kaiu-envoy` need
  **no implementation files**. The seeker/keeper roles are already built
  generically by element in `cards/01-Core/_createRoles.ts`; the other three are
  pure keyword cards (`ancestral`, `restricted`, `courtesy`, `sincerity`) that
  `basecard.parseKeywords` registers, with the skill bonuses coming from card
  data and `Deck.ts` falling back to a vanilla `DrawCard`.
- The role legally gives the deck **two void provinces** (Weight of Duty and
  Shrug Off Despair), which is the Shrug Off Despair → Weight of Duty combo.
