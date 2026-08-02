# Bot V2 is tuned per-deck, exactly like Bot V1

**Decision (2026-07-26).** Bot V2 is *not* a different kind of bot. It is the same
heuristic bot as V1 with more inputs and more tunable parameters. Therefore it
gets the **same treatment V1 gets**: every deck may carry its own deck-specific
logic and knobs, and we optimize V2 deck by deck.

This supersedes the earlier framing of V2 as "a planner that will out-think the
deck knowledge". That framing was measured and failed:

- A generic linear evaluator trusted with its own judgement plays at **5-8%**
  win rate against V1 (`docs/bot-v2-rejected-experiments.md`).
- Generic, deck-blind conflict-declaration planning has a **±1pp ceiling** and
  actively regresses cross-deck (`applyTypePlan` measured **-3.9pp**) because a
  deck-blind rollout pushes an aggressive military deck into political conflicts
  it cannot win.

The lesson both results share: **the deck knowledge is the strength, and V2's
extra machinery is only worth anything when a deck drives it.**

---

## The division of labour

| Layer | Owns | Lives in |
|---|---|---|
| **Deck** | *What it wants*: which conflict type, which ring, which bodies must be in the conflict, which bodies stay home, how confident it is | `DeckProfile.conflictIntents.rules`, per deck in `DeckProfiles.ts` `OVERRIDES` |
| **Base** | *What to actually do*: score every deck proposal inside the same-phase rollout, compare whole-phase sequences, pick the best, execute it | `ConflictPhasePlanner`, `DeckConflictIntents` |

A deck **proposes options**. It does not issue orders. The base planner ranks
every proposal against every other proposal *and* against the generic lines, and
runs the best **sequence** for the whole conflict phase — because "attack
political now and keep the cavalry for the military conflict" can only be judged
against the alternative orderings of the same options.

## Writing a deck's conflict intent

Rules are data. Add them to that deck's entry in `OVERRIDES`:

```ts
conflictIntents: {
    enabled: true,
    rules: [
        {
            id: 'lion-military-swarm',
            axis: 'military',
            requiredTraits: ['bushi'],
            requiredTraitCount: 2,
            minAxisSkill: 6,
            bonus: 2.5,
            reason: 'lion-swarm-military'
        },
        {
            id: 'lion-glory-payoff',
            axis: 'military',
            requireHandCardIds: ['for-greater-glory'],
            requiredTraits: ['bushi'],
            requiredTraitCount: 3,
            bonus: 4,
            reason: 'lion-for-greater-glory'
        }
    ]
}
```

and switch the layer on for that deck:

```ts
conflictPlanning: { applyIntentPlan: true }
```

### The rule surface (`DeckConflictIntentRule`)

**What to declare** — `axis`, `ringElements` (best first, one option each,
decayed by `ringBonusStep`), `requiredCardIds`, `requiredTraits` +
`requiredTraitCount`, `reserveCardIds`, `reserveTraits` + `reserveCount`,
`exactAttackers`.

**How much the deck wants it** — `bonus` (added to that branch's rollout score),
`minScore` (retire the rule if the phase it produces is bad anyway),
`declarationIndex` (restrict to one declaration slot, counted from the decision
being made **now** — 0 is the next declaration. It is *not* an index from the
start of the round: the planner is only ever handed the opportunities that
remain, so a player's second conflict is index 0 again when it is declared).

**When it is offered** — `minRound`/`maxRound`, `requireCardIdsInPlay`,
`requireHandCardIds`, `requireReadyCount`, `minAxisSkill`,
`requireOpponentBrokenAtLeast`, `requireSelfBrokenAtMost`, `minHonor`/`maxHonor`,
`minOpponentHonor`/`maxOpponentHonor`.

### What a deck can actually choose (read this before writing a rule)

A player gets **one military and one political conflict opportunity per round**
— separate budgets (`player.getRemainingConflictOpportunitiesForType`). Both
conflicts normally get declared, one of each type.

**Therefore `axis` is not a choice of *which* conflicts to fight. It only
changes their ORDER** (or skips the weak one). Measured: a pure `axis` rule for
Lion produced **zero discordant games** against V1 — V1 already declared
military first, so the rule was a no-op. Do not expect a win rate from `axis`
alone.

The levers that carry real degrees of freedom, in rough order of headroom:

1. **Attacker allocation across the phase** — which bodies go to the military
   conflict and which are held for the political one. V1 commits greedily to
   the conflict in front of it; only the rollout sees both.
2. **Reserve** — bodies deliberately kept out (movement engines, walls).
3. **Ring** — but note V1 already scores rings per deck via `ringScore` and the
   deck tactics modules. The V2-only lever is ring *sequencing* across the two
   conflicts, not a static preference list.
4. **Province target** — already applied by default (`applyTargetPlan`).
5. **Order** — express with `axis` + `declarationIndex`.

Ring win-rate correlations from a declaration scan are **not** a good source of
rules: a deck wins on the air ring partly because it declares air when it is
already ahead. Prefer a mechanical reason (a glory deck wants the Air ring
because Air gains honor) over a percentage.

### Rules of thumb

- **A named body that is bowed or dead retires the rule**, it does not silently
  attack without it. If a deck wants a fallback, that is a second rule.
- **Reserve holds back the weakest bodies on the attacking axis**, never the
  best attacker, and never everything — there is always someone left to declare.
  A final stronghold push overrides every reserve.
- **`bonus` is confidence, not an order.** A large bonus on a line the rollout
  shows losing the phase still loses to a better sequence. That is deliberate:
  it is how an aggressive deck stays aggressive without walking into a wall.
- **Keep the generic lines available** (`optionsExclusive: false`, the default)
  unless the deck genuinely owns every declaration it should ever make.

## Why a deck-authored plan bypasses the generic apply flags

`applyTypePlan` / `applyRingPlan` / `applyAttackerPlan` stay **off** globally:
the deck-blind rollout over-declares in fair mode. But when the winning plan
carries an `optionId`, a deck asked for that specific play and the rollout
already ranked it against every alternative — so it executes on its own
authority. That is the whole point of the split.

## Measuring a deck change

Cross-deck against the V1 field, never mirror. Mirror tuning overfits to a deck
that shares your own blind spots.

### Primary: `botRoundRobin.js` — random shuffles, full games

**This is the number that decides.** Full games, random shuffles, the deck under
test against all nine opponents, reported as an absolute win rate:

```
node tools/selfplay/botRoundRobin.js --games 100 --subject Crab \
  --v2-decks Crab --v2-mode pass-through --v2-profile '{"deckProfile":{...}}'
```

- `--subject Crab` runs only Crab's 9 matchups — 900 games, not the full field's
  4500, of which 3600 would be V1-vs-V1 and answer nothing.
- `--v2-decks Crab` pilots V2 on Crab's seat ONLY. `--engine-version v2` puts V2
  on both seats, which moves the number for two reasons at once.
- The worker echoes its live config once (`[worker] v2Decks=... v2Profile=...`).
  Check that line. A silently-dropped override looks exactly like a clean run,
  and that failure mode has cost this project real time more than once.

Compare against the stored V1 numbers in
`tools/selfplay/baselines/v1/standardized-benchmark.json` (seed 1). V1 is frozen,
so that baseline does not need re-running — but see the caution below about
re-measuring a same-code V1 control when a delta looks too large. A run using
`--v2-decks`, `--v2-profile` or `--subject` can never be published as the
standard benchmark, so a comparison cannot overwrite the baseline it uses.

### Secondary: `rr2.js` — fixed shuffles, paired control

```
node scratchpad/rr2.js <policySeed> <gamesPerPair> <shuffleBase> [decks]
```

Paired shuffles cancel deck-draw variance, so a small real effect shows up in
far fewer games, and a bit-identical result proves a flag changed *nothing*.
Keep it for controlled A/Bs and for reachability checks.

But it does **not** answer "how good is this deck". Every pair is replayed on one
shuffle, so the result is conditional on that shuffle set — the same lever
measured −1.9pp on base 91001 and −7.0pp on 93001, and Crab's own V1 control
ranged from 31.5% to 46.3% depending only on which base was chosen. Treat rr2 as
a sensitive instrument for *whether a change does something*, and the round robin
as the measure of *whether the deck got better*.

Compare against the stored V1 numbers in
`tools/selfplay/baselines/v1/standardized-benchmark.json` (seed 1, 40 games per
matchup). V1 is frozen, so that baseline stays valid without re-running a control.
A run using `--v2-decks` or `--v2-profile` can never be published as the standard
benchmark, so a comparison cannot overwrite the baseline it is compared against.

Stored V1 seed-1 round robin, for reference (360 games per deck):

| deck | record | win rate |
| --- | --- | --- |
| Scorpion | 255-105 | 70.8% |
| Lion | 212-148 | 58.9% |
| Dragon | 205-153 | 57.3% |
| PhoenixShugenja | 205-155 | 56.9% |
| Unicorn | 187-173 | 51.9% |
| Phoenix | 178-182 | 49.4% |
| Crane | 163-196 | 45.4% |
| DragonAttachments | 152-208 | 42.2% |
| CraneDuels | 126-233 | 35.1% |
| Crab | 115-245 | 31.9% |

## Measured results

Cross-deck round-robin, seed 1, every deck against the other nine, each result
paired against a V1 control seat on identical shuffles.

### Axis rules (36 paired games per deck)

| Deck | V2 | V1 control | delta | kept |
|---|---|---|---|---|
| Phoenix (political) | 27/36 | 23/36 | **+11.1pp** | yes |
| Lion (military) | 20/36 | 20/36 | 0.0pp | no — no-op |
| Crab (military) | 14/36 | 14/36 | 0.0pp | no — no-op |
| Scorpion (political) | 26/36 | 28/36 | −5.6pp | no |

Lion and Crab produced **zero discordant games**: V1 already declared their
military conflict first, so the rule never fired. This is the axis-is-only-an-
ordering-lever result described above.

### Attacker allocation (`applyAttackerPlan`) — the V2 base default

The declaration layer that had never been measured, and the one with real
headroom. V1 sizes an attack by "commit skill until it clears the province plus
the opponent's whole possible defense", conflict by conflict. The rollout
instead commits the smallest set that wins the **phase**, so bodies survive for
the second conflict and for defense.

Three independent seeds, 180 paired games each (18 per deck per seed):

| Seed | V2 | V1 control | delta | discordant |
|---|---|---|---|---|
| 1 | 118-62 (65.6%) | 109-71 (60.6%) | +5.0pp | 22-13 |
| 2 | 98-82 (54.4%) | 81-99 (45.0%) | +9.4pp | 31-14 |
| 3 | 92-88 (51.1%) | 81-99 (45.0%) | +6.1pp | 24-13 |
| **pooled** | **308/540 (57.0%)** | **271/540 (50.2%)** | **+6.9pp** | **77-40** |

**Pooled McNemar: z = 3.33, two-sided p = 0.00087.** Every seed is positive and
the pooled result is significant, so this is a real improvement rather than a
seed artifact.

Per-deck, pooled over 54 paired games each:

| Deck | V2 | V1 control | delta |
|---|---|---|---|
| Phoenix | 42/54 | 30/54 | **+22.2pp** |
| Crane | 31/54 | 22/54 | **+16.7pp** |
| Scorpion | 41/54 | 34/54 | **+13.0pp** |
| Crab | 22/54 | 17/54 | +9.3pp |
| CraneDuels | 24/54 | 21/54 | +5.6pp |
| DragonAttachments | 32/54 | 30/54 | +3.7pp |
| PhoenixShugenja | 30/54 | 28/54 | +3.7pp |
| Dragon | 33/54 | 33/54 | 0.0pp |
| Lion | 33/54 | 33/54 | 0.0pp |
| Unicorn | 20/54 | 23/54 | −5.6pp |

Crane and CraneDuels carried the worst measured loss margins in the declaration
scan (183 and 92 skill lost across declarations they lost), which is exactly the
over-commitment this layer removes.

**Unicorn is the one deck that regresses, and it opts out**: its declaration
order is already owned by the cavalry movement engine, which sequences
candidates around a mover that JOINS the conflict *after* declaration. The
rollout cannot see that body, so its "smallest set that wins the phase" benches
exactly the character the move engine was counting on. Deck knowledge beats the
planner there, which is the whole reason per-deck overrides exist. Its trend
across the three seeds tracks the fix: −11.1pp, −5.6pp, then 0.0pp once the
opt-out shipped (seed 3 is the only seed run on the final config).

**Read individual deck rows as direction, not proof.** At 54 paired games a
single deck's delta is still noisy — Lion swung +16.7pp then −16.7pp on
consecutive seeds. Only the pooled figure is significant.

## Defense (`applyDefensePlan`) — built, and it does not pay

Defending is a trade, not a duty: every defender bows, so a province saved on
their conflict can cost us our own. V1 cannot express that — it sizes each
defense against the conflict in front of it (win outright if reachable, else
prevent the break, else concede) with no idea whether a conflict opportunity of
our own still needs those bodies.

`ConflictPhasePlanner.planDefense()` scores each candidate defense as its
immediate outcome plus the rest of the phase played out with those defenders
bowed. It models the engine rules exactly: attacker takes nonzero ties, 0-0
returns the ring unclaimed, break when `attackerSkill − defenderSkill ≥ province
strength`, attacker resolves the ring on a win while the **defender claims it
without resolving**. An unopposed loss costs 1 honor, which is close to free in
a normal game (a low bid recovers it) and only bites near a dishonor loss, so it
is scaled by `honorPressure` rather than applied flat.

Decks inject `conflictIntents.defenseRules` (`DeckDefenseIntentRule`): bodies
that must defend, bodies reserved for our own conflict, `exactDefenders`,
`concede`, and `bonus` — gated on `axis`, `ringElements`, `strongholdProvince`,
`min`/`maxAttackerSkill`, `minOwnConflictsRemaining`, `whenBreakInevitable`,
round, honor, and broken provinces.

### The tail-optimism trap (read before re-enabling this)

First measurement was **−1.7pp** cross-deck versus V1, with DragonAttachments at
**−33.3pp**. The diagnostic (`scratchpad/defdiag.js`, 18 games) showed why:

| | V1 | V2 defense plan |
|---|---|---|
| defenses conceded | 40% | **81%** |
| average defense skill | 5.5 | **2.0** |
| conflicts held | 34% | **10%** |
| offense declared / won / broke | 77 / 78% / 49 | 77 / 79% / **49** |

The offense line is identical, so conceding bought nothing at all. A live trace
caught the mechanism: attacker skill 6 against a strength-4 province while
holding a **10-military ready body**, and it conceded, scoring the concede
branch at +8.98. Immediate cost was −11.5, so the rollout was valuing the tail
at about +22 — it believed keeping that one body would break two provinces. It
cannot; a character bows after one conflict, and the live offense is V1's.

**A defender's tail is systematically optimistic: it pays for a certain province
loss with imaginary future offense.** Concede rate tracks the discount exactly —
47% / 28% / 18% / 17% at tail weights 1.0 / 0.5 / 0.25 / 0 — so
`defenseTailWeight` defaults to **0.25**, making defense decide mostly on
immediate value with the tail as a tiebreaker.

### Verdict

| Config | cross-deck delta vs V1 (seed 1, n=180) |
|---|---|
| attacker plan only (shipped baseline) | **+5.0pp** |
| attacker + defense, tail weight 1.0 | −1.7pp |
| attacker + defense, tail weight 0.25 | +1.7pp |

The fix recovered most of the damage, but defense planning still **costs about
3.3pp against the attacker-only baseline**, so `applyDefensePlan` ships **off**.
This reproduces the warning already recorded in `defenderDecision`: an earlier
defense-side lookahead was also net-negative through over-conceding.

The obvious follow-up was tested and also failed. The rollout commits the
*minimum* sufficient defense, which is precisely the defense a single unseen
pump card flips — which is why V1 carries a per-deck `defenseSkillBuffer`. The
planner now honours that number via `ConflictPhasePlannerInput.defenseBuffer`,
and the re-measurement came back **numerically identical, deck for deck**: the
buffer is 0 for eight of the ten decks, and for the two that carry 2 it never
flipped a decision. Fragility to post-commit pumps is not what is costing the
defense layer its points.

**Do not re-enable `applyDefensePlan` on the strength of a fix looking right in
a few traces.** Both attempts here looked correct in isolated fixtures and in
live traces, and both still lost points across the field. The layer is kept,
off, with `defenseTailWeight` and `defenseBuffer` wired, so a future attempt
starts from a diagnosed baseline rather than from scratch.

## Dynasty projection (`applyDynastyProjection`) — repaired, and inert

The idea: while choosing which dynasty card to buy, score each affordable body
by the two-conflict phase it would produce, so the deck develops toward the
board it actually needs.

**It was structurally dead before this was measured.**
`dynastyConflictProjectionScores()` was gated on `usesBoardAwareDynastyEconomy()`,
which is only true for seed 3 — on seed 1 (`FateAwareJigokuBotPolicy`) it
returned `{}`, so setting the flag did precisely nothing. The gate was wrong on
its own terms too: **both** dynasty decision paths already accept
`conflictProjectionScores`, so only the producer was restricted. It is now gated
on `usesFateAwareEconomy()`, which covers seeds 1 and 3 and matches where the
consumers live. That is a real repair — the flag now does what it claims.

It still buys nothing:

| Config (seed 1, n=180) | result | delta |
|---|---|---|
| attacker plan only | 118-62 | +5.0pp |
| + dynasty projection, weight 0.35 | 118-62 | +5.0pp |
| + dynasty projection, weight 2.0 | 118-62 | +5.0pp |

Identical aggregates at nearly 6x the weight; individual games move (weight 0.35
traded one Crab game for one Phoenix game, weight 2.0 traded one Phoenix for one
Unicorn) but nothing survives to the total.

The reason is a structural ceiling, measured over 107 dynasty decisions:

| situation | share |
|---|---|
| no affordable character candidates at all | **60%** |
| all candidates project identically | 21% |
| exactly one non-zero score | 10% |
| two or more non-zero scores | **8%** |

The projection can only discriminate on about **19%** of dynasty decisions, and
only as a tiebreaker inside those. Most of the time the buy is forced by fate,
not chosen between comparable options — **you cannot improve a decision the bot
never gets to make.** Raising the weight cannot fix that; it only makes the
tiebreaker louder in the few near-ties where either choice was fine anyway.

`applyDynastyProjection` therefore stays **off**. The gate repair is kept.

## In-conflict card sequencing (`applyActionPlan`) — built, and it does not pay

The ask was to stop playing conflict cards and card abilities in a hardcoded
order: let each deck declare what it wants and what its cards are for, and have
the generic layer choose the best ORDER and COMBINATION for the live fate and
board. Built as `v2/ConflictActionPlanner.ts`, measured, **not shipped**.

### What it does

V1 answers "what next?" with a fixed pipeline: board abilities first, then the
hand sorted by deck comparators and playbook priority, then the first card that
survives a per-card intent filter. The planner replaces the tail of that with an
outcome model — reach the break threshold, else win the conflict, else spend
nothing — searched over subsets of the affordable hand.

The load-bearing change is that **a deck's preferred-bearer rule becomes a price
instead of a veto**. `DuelTactics.pickAttachmentTarget` and its Unicorn/Dragon
equivalents answer "where is this attachment worth the most", and V1 treats a
`null` as "do not play this card at all". The planner re-admits those cards at
`actionPlanRelaxPenalty` (default 30, about a third of a province break), so the
deck's preference still wins every ordinary window but can lose to an actual
break. Legality is untouched: the engine supplies only legal bearers when the
card is clicked.

### Why it looked promising

Instrumented over 20 Crane games (the `windowProbe` / `intentProbe` hooks on
`JigokuBotPolicy`, both null unless a tool assigns them):

- **52%** of conflict action windows passed with the budget open and *every*
  hand card rejected (`no-card-passed-intent-filter`).
- The largest single rejection reason was `deck-specific-target` (**49%** of
  card rejections): shukujo x95, fine-katana x32, iaijutsu-master x22,
  ornate-fan x14, duelist-training x24 — pure stat attachments dropped because
  no "tower" character was in play.
- Sample window: attacker, fate 3, three skill short of breaking, holding Fine
  Katana (+2, cost 0) and Shukujo (+2, cost 2), both engine-playable. V1 played
  neither and passed.

The planner does fire on exactly those windows and its individual decisions are
right — over 18 games it played 23 times, of which **11 enabled a province break
and 12 prevented one**, and 21 of the 23 used a card the deck had vetoed.

### Why it still loses

Seed 1, cross-deck round-robin, n=180, against an identical V1 control seat
(109-71 in every run):

| Configuration | record | delta vs V1 |
|---|---|---|
| shipped V2 baseline (`applyAttackerPlan`) | **121-59** | **+6.7pp** |
| + action plan | 119-61 | +5.6pp |
| + action plan, planner also overrules the deficit cutoffs | 117-63 | +4.4pp |
| + action plan, correct pricing, cutoffs restored | 117-63 | +4.4pp |

Every variant is at or below the baseline. The mechanism is visible in the card
counts: on Crane the planner raised conflict cards played from 56 to 88 and
conflicts won from 81 to 91, while **provinces broken went 34 to 33**. The extra
cards buy rings and marginal break-prevention, not breaks — and the hand they
spend is the engine those decks need in later rounds.

Two structural reasons, both worth knowing before trying again:

1. **Order was not the binding constraint.** V1 already plays a card when that
   card changes the conflict. Re-ordering and re-admitting cards mostly finds
   plays whose value is below the cost of the card spent.
2. **The planner can only see ~19% of the hand.** It scores a card from printed
   skill or `conflictContribution`, and only **8 cards in the whole playbook**
   define the latter. In the sampled hands **81% of held cards scored NULL** —
   every event. A sequencer that cannot price Assassination, Let Go, Voice of
   Honor or Court Games is choosing among the minority of the hand it happens
   to understand. This is the same ceiling that made `applyDynastyProjection`
   inert, in a different place.

### If this is revisited

Do not tune the weights first — the ceiling is the effect model, not the search.
The prerequisite is `conflictContribution`-style pricing for the event cards
(what does removing a 3-cost defender do to this conflict, what is a card draw
worth), at which point the planner already in the tree can use it. The
infrastructure, the deck-injection surface (`DeckProfile.conflictActionPlan`,
`V2DeckOverride.conflictActionPlan`), the probes and 18 unit specs are all in
place and cost nothing while the flag is off.

`applyActionPlan` therefore defaults to **false** everywhere.

## Related

- `docs/bot-v2.md` — engine overview and measured status
- `docs/bot-v2-rejected-experiments.md` — what has already been tried and failed
- `docs/deck-profiles.md` — the V1 per-deck knob surface this mirrors
- `docs/conflict-phase-lookahead-bot.md` — the shared rollout itself

## Card value model (`useCardValueModel` / `vetoDeadCards`) — built, and it does not pay

`v2/CardValueModel` + `v2/DuelValueModel` price 22 conflict cards from the live
board instead of the flat `DeckAnalysis.swing` constant: what Assassination
actually removes, which attachment Let Go should strip, whether a duel is
winnable, what a dishonor unlocks in hand. The models are correct and covered by
99 specs. Both ways of *using* them to change play measured negative.

### The measurement

Seed 1, n=180 cross-deck paired games, V1 control seat 109-71 in every single
run (identical shuffles, so the control is a constant):

| configuration | V2 | delta | vs baseline |
| --- | --- | --- | --- |
| baseline — `applyAttackerPlan` only | **121-59** | **+6.7pp** | — |
| cancel gate reduced to a no-op (threshold 0) | 120-60 | +6.1pp | −1 |
| reaction gate, recalibrated, threshold 4 | 118-62 | +5.0pp | −3 |
| reaction gate, threshold 1, pre-recalibration | 117-63 | +4.4pp | −4 |
| reaction gate, threshold 4, pre-recalibration | 116-64 | +3.9pp | −5 |
| reaction gate + structural veto | 114-66 | +2.8pp | −7 |

Monotone in how much the model is allowed to refuse. Both flags therefore
default **false**, and `V2_BASE_OVERRIDE` does not set them.

### Why gating a free reaction loses

Voice of Honor and Defend Your Honor both cost **0 fate**. An unplayed one is
worth exactly 0, so holding one for a target above a value threshold only pays if
a bigger target actually arrives — and often none does. V1's "fire at anything"
is close to optimal for a card with no alternative use.

The per-game traces made this concrete rather than theoretical:

- Dragon, threshold 4: `defend-your-honor` **skipped 87, fired 8**. 84 of the 87
  were `incoming-below-threshold`. Dragon scored 12/18 against a baseline 15/18 —
  the gate cost exactly the 3 games.
- Crane, threshold 4: 9 of 12 cancels refused at `incoming=3` and `incoming=1`.
  Crane 11/18 against a baseline 13/18.

Two real modelling bugs were found and fixed on the way, and are worth keeping
even though the feature is off:

1. **`swing == 0` is not evidence of harmlessness.** `swing` measures conflict
   skill only, so every honor, draw and economy event scores zero while still
   being worth a cancel. `incomingEventValue` now returns `null` (unknown, so the
   caller fires) rather than 0 for those.
2. **Losing Defend Your Honor's duel costs nothing but the card** — the cancel
   simply does not happen. Refusing at 50% win probability threw the card away;
   only a duel at 0% is worth declining.

Those two fixes recovered 118→120 of the 121, but never beat the baseline.

### Why the structural veto also loses

`vetoDeadCards` refuses only cards the model says have *no legal application*
(Assassination with no cost-2 target, Rout with no participating Bushi). Even
restricted that way it measured −1.1pp on top of the reaction gate. V1's own
`shouldPlay` gates already cover the genuinely dead cases; the extra refusals
removed plays that were fine.

The first version of the veto was much worse (−22.2pp on PhoenixShugenja alone)
because it enforced *preferences* as vetoes — it refused **363 Oracle of Stone
plays** across 18 games on "your hand is already live", ignoring that the card
still cycles. That is why `CardValue` now separates `blocked` (no legal use, may
veto) from `hold` (legal but below threshold, must never veto).

### What is still worth keeping

The models themselves. They are the only thing in the codebase that can answer
"what is this card worth right now", they are exercised by specs, and both the
action planner and any future learned evaluator need exactly that signal. What
does not work is using a hand-tuned threshold on top of them to *refuse* plays.

### On reading per-deck deltas

At 2 games per pair a deck's row is n=18, where one game is 5.6pp. PhoenixShugenja
read −5.6pp in several runs and looked like a regression; at n=36 per seed across
three seeds it is **58-59 with the attacker plan versus 59-59 without**, 11-12
discordant — dead even. Its per-seed deltas were +5.6pp, +8.3pp and −16.7pp,
which is variance around zero, not a signal. Only the pooled n=180 row means
anything; per-deck rows are for finding games to read, not for decisions.

### Why a value model cannot raise the win rate through the play gate

Worth stating plainly, because it is a property of the architecture rather than
of the values:

`BotConfiguration` defaults `v2Mode: 'pass-through'`, so V2 *is* V1 plus deck
profile overrides. The only place the card value model is consulted on card play
is `conflictCardPlayIntentInner`, which returns a **boolean**. A boolean gate can
only ever *remove* a play. It cannot play a card V1 did not consider, cannot
reorder plays, and cannot retarget one. Against V1's already deck-tuned
selection, removing plays is negative — which is exactly the monotone ladder
above.

The two decision surfaces where V2 has actually gained are both *additive*:
`applyAttackerPlan` changes which bodies are declared (+6.7pp), and the action
planner is the one hook that could reorder and add card plays. When the action
planner was first measured it could price only ~19% of a hand; the value model
now prices 32 cards, which is why it was worth re-measuring rather than assuming
the earlier result still held.

### Public information that the serialized card summary does not carry

`DrawCard.getSummary()` publishes *live* skill (`militarySkillSummary`), which is
empty for any card outside play. Cavalry Reserves recruits out of the dynasty
discard, so it needs printed stats for cards that are not in play.

Adding `printedMilitarySkill` / `printedCost` to that summary **moved the V1
control** — `CardPlaybook`, `LionTactics` and `DragonAttachmentTactics` all read
`card.printedCost` straight off summaries, where it had always been `undefined`.
Crab's V1 control went 8/18 → 7/18 on the spot. Anything V2 needs that the
summary lacks must therefore be routed through `DecideContext` from
`JigokuBotController` (see `dynastyDiscardBodies`), never added to the shared
summary. Discard piles are public, so this is missing plumbing, not hidden
information.

### Re-measuring `applyActionPlan` once the value model was rich

The action planner was originally rejected when it could price only ~19% of a
hand. With 32 cards priced it was re-measured, cross-deck, n=180 per seed against
the same paired V1 control:

| seed | baseline | + `applyActionPlan` | delta |
| --- | --- | --- | --- |
| 1 | 121-59 | 122-58 | +1 |
| 2 | 98-82 | 97-83 | −1 |
| 3 | 104-76 | 111-69 | +7 |
| **pooled** | **323-217 (59.8%)** | **330-210 (61.1%)** | **+7** |

Against a pooled V1 control of 298-242 (55.2%): baseline **+4.6pp**, action plan
**+5.9pp**. NOTE: read the methodology correction at the end of this file first —
those three "seeds" are three different V1 policies on the SAME shuffles, not
independent samples, so this is not n=540 independent games.

This reverses the earlier verdict's *sign* — the planner is no longer negative —
but +7 games in 540 (+1.3pp) is not a decision. Seed 3 carries the entire effect
while seeds 1 and 2 are ±1, which is precisely the pattern that failed to
replicate for PhoenixShugenja earlier in this same session. It stays **off** by
default pending more seeds.

Per-deck, CraneDuels was the obvious candidate for a targeted opt-in (it holds
most of the newly modelled duel cards). At n=36 per seed it does not hold up
either: 16→18, 22→21, 22→23, pooled **60→62 of 108**. Not a per-deck win.

The useful conclusion is about where the value model belongs. Used as a *gate* it
is reliably negative (−1 to −7 games). Used by the planner to *select and order*
plays it is neutral-to-slightly-positive. That is the difference between a signal
that can only subtract and one that can also add.

## Methodology correction: what `rr2.js`'s "seed" argument actually varies

**It does not vary the shuffle.** `tools/selfplay/harness.js` passes it to
`JigokuBotConfig.seed`, and `V1PolicyAdapter.createV1Policy` uses it to choose
the policy CLASS:

| seed | policy |
| --- | --- |
| 1 | `FateAwareJigokuBotPolicy` — the canonical V1 bot |
| 3 | `BoardAwareJigokuBotPolicy` |
| anything else (2, 4, 5, …) | base `JigokuBotPolicy`, the older generic heuristic |

It additionally seeds the policy's internal `SeededRandom`, which only breaks
ties. So runs at "seed 1 / 2 / 3" are three DIFFERENT BOTS, not three samples of
the same bot.

The tell is in the output: the V1 control moved between those runs — 109-71,
88-92, 101-79, 80-100. A frozen control cannot move that far on shuffle noise
alone; it moves because the control itself is a different policy.

The shuffle is the **fourth** argument, `base`:

```js
const pairSeed = base + (indexOf(A) * 100 + indexOf(B)) * 97 + Math.floor(g / 2);
Math.random = rng(pairSeed);
```

Every measurement in this document that says "seed 1 / 2 / 3" used `base =
90001` throughout, i.e. **identical shuffles**. To replicate a result on
independent games, hold the seed at 1 and vary `base`.

That makes "pooled over three seeds" a robustness check across V1 variants —
useful, but not independent replication, and it should not be read as n=540
independent games. This applies to the attacker-plan result recorded earlier in
this file as well as to the card-value work below it.

### RETRACTION: the action planner is negative after all

The "+1 game, first configuration to beat baseline" claim above was measured on a
**single shuffle set** (`base = 90001`). Re-run at seed 1 with the shuffle varied —
the correct replication, per the methodology correction above — it reverses:

| shuffle `base` | baseline | + `applyActionPlan` | delta |
| --- | --- | --- | --- |
| 90001 | 121-59 | 122-58 | +1 |
| 92001 | 100-80 | 90-90 | **−10** |
| 93001 | 103-77 | 96-84 | **−7** |

Pooled over the two independent sets (n=360): baseline 203, planner 186, **−17
games**. The original verdict in this document — that `applyActionPlan` costs
games — stands. The apparent win at 90001 was noise on one shuffle set, and the
enriched value model did not change the outcome.

Note how stable the SHIPPED configuration is across those same shuffles versus
its paired V1 control: +6.7pp / +10.0pp / +8.9pp. That is the result to trust,
and it is why the baseline is what ships.

**Process lesson.** A one-game delta on a single shuffle set is indistinguishable
from noise, and it was reported here as a headline before replication. Vary
`base` and require the effect to survive before writing a result down.

### Why no card-play tuning can help: breaks are insensitive to it

The regression above has a measured mechanism. `actionPlanProbe`, Scorpion @ base
93001, sweeping the planner's `cardWeight`:

| cardWeight | planner calls | plays | breaks | wins | neither |
| --- | --- | --- | --- | --- | --- |
| 2 (default) | 131 | 94 | 45 | 35 | 14 |
| 14 | 136 | 82 | 46 | 24 | 12 |
| 25 | 129 | 72 | 46 | 16 | 10 |

At `cardWeight: 2` the profile prices a conflict card at 1/12th of a ring
(`winValue: 25` vs `cardWeight: 2`), so the planner buys bare conflict wins almost
unconditionally — a play in 72% of windows, 14 of them neither breaking nor
winning. Raising the price strips out exactly those ring-buying overrides and
costs **zero province breaks**.

But the win rate does not follow: +1 at base 93001, −4 at base 91001. Those
removed plays were value-neutral — cards traded for rings at par.

The conclusion is therefore stronger than "the planner is mis-tuned":
**it never converts a non-break into a break.** Breaks are what win games, and
they are flat across every pricing. No reordering or re-pricing of card play can
move the win rate on this engine.

Read `conflictActionPlanCard` as an **override**, not as the card-play path
(`JigokuBotPolicy.ts:3686`: return null and V1's pipeline plays a card as usual).
No configuration here produces a bot that plays fewer cards *than V1* — only one
that overrules V1 less often. At the default pricing it overplays: the earlier
recorded figure of cards played 56 → 88 with provinces broken 34 → 33 is the same
effect seen from the other side.

### CORRECTION: "breaks are insensitive to card play" was wrong

The section above concluded that from the break count staying flat (45/46/46) while
the planner's `cardWeight` was swept. Measuring the break GAP directly
(`scratchpad/gapdist.js`, base 93001, 90 games) reverses it:

- attacking: 29.7% of windows are 1-2 skill short of a break, 23.5% are 3-4 short
  — **53% reachable with one or two cards**
- defending: 38.8% of windows are 0-2 skill from the province falling — **one card**

The reachable windows are abundant. The break count was flat because the planner
never targets them, not because they do not exist. See
`bot-v2-per-deck-plan.md` for the consequence: the leverage is converting near-miss
windows, and defense is the cheaper half.
