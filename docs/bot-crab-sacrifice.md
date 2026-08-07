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

**So the saves have exactly one use here: answering the OPPONENT's removal.**
`CrabSacrificeProfile.saveInversion` is therefore `false`, and the policy
actively refuses to fire a save on a body it is itself spending
(`pendingSacrificeCostUuid`). Turning the inversion on cost **6.5pp**
(30.65% → 24.11%) before the guard existed.

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
