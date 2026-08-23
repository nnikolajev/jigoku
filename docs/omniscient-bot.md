# Omniscient bot capability

> **Status: shipped, opt-in, player-facing, and currently worth nothing.**
> Omniscience is an information-access capability, not a bot seed. The lobby
> checkbox (`NewGame.tsx` → `botOmniscient`, `lobby.js` → `omniscient`) can
> enable it for seed 1, 2, or 3, and unlike Bot V2 it *is* something a player
> can choose to face.
>
> Measured properly on 2026-08-21 it was a **null**: 49.45% against a fair bot
> over 3264 games. One configuration change (`omniscientPlannerHandThreat`,
> now default off) took it to **51.32%**, worth +1.55pp paired at p=0.0016.
> See [Measurement](#measurement).
>
> **Read the census before proposing anything here.** The capability is not
> short of information and never was: it already flips 29% of games. Every arm
> that made it use its information *harder* measured below the noise floor, and
> the only lever that moved the number REMOVED an exact input from a decision.

## Configuration

```json
{
  "bot": {
    "enabled": true,
    "seed": 1,
    "omniscient": true
  }
}
```

The supported strategy seeds are:

| Seed | Strategy |
|---:|---|
| 1 | fate-aware heuristic |
| 2 | original dynasty-focused heuristic |
| 3 | seed 1 plus board-aware dynasty development |

`OmniscientBotCapability` is constructed independently of the selected policy.
When disabled, it returns no hidden context and the strategy remains fair.
When enabled, it supplies the same hidden-state model to any of the three
strategies.

## Information exposed

The capability reads the opponent's live player object and supplies:

- exact conflict hand, card costs, printed/live skills, attachment bonuses, and
  curated event effects;
- opponent fate and an affordability matrix for military and political boosts;
- exact identities, current strengths, ability classes, and dynasty stacks of
  face-down provinces;
- affordable bow, send-home, discard, and removal effects;
- exact hand copies for Gossip and exact bow-effect knowledge for Clarity of
  Purpose.

Province strength uses the live card's `getStrength()`, so holdings, the
stronghold bonus, and active modifiers are included. Public Forum has effective
priority strength 6 only while ranking targets because it must be broken twice;
its actual break strength is unchanged.

`tools/selfplay/auditOmniscientCoverage.js` checks the other half — whether the
curated `DeckAnalysis` registry can price what the opponent is holding. **As of
2026-08-21 every conflict event in all seventeen registered decks has a model
and nothing is unpriced.** Card-model coverage is therefore *not* a reason the
capability underperforms; do not go looking there again without re-running that
audit first.

## Injectable use of hidden knowledge

`DeckProfile` controls where exact information modifies decisions:

| knob | default | reaches |
|---|---|---|
| `useOmniscientProvinceKnowledge` | **true** | every deck but Phoenix |
| `omniscientPlannerHandThreat` | **false** (was true; see below) | every deck, no opt-in at all |
| `useOmniscientConflictAxis` | false | duel decks (Crane, CraneDuels, CraneHonor) |
| `omniscientAttackResponseBuffer` | 0 | Crane×3, Crab, Unicorn, both Shugenja decks |
| `useOmniscientTokenDefense` | false | duel decks, Unicorn |
| `omniscientEarthRingThreatBonus` | 0 | Phoenix only |
| `omniscientThreatRealism` | false | nothing until enabled |
| `omniscientCheapestBreakAxis` | false | nothing until enabled |
| `strongholdDefense.omniscientHandThreatWeight` / `omniscientDefenderDisables` | 0 / false | Crab, PhoenixShugenja |

Nine decks — CrabSacrifice, Dragon, DragonAttachments, Lion, LionDuelist,
LionHonor, Scorpion, ScorpionBidWar, UnicornReveal — carry **no** omniscient
tuning beyond the two field-wide defaults.

Treating every known hand card as a guaranteed maximum conflict swing was not
safe: it caused over-commitment, unnecessary defense, and skipped windows.
Those broad worst-case overrides remain disabled.

### Two defects in how the hidden hand was priced

Both were found on 2026-08-21 and both are fixed behind
`omniscientThreatRealism` (default false = the measured behaviour):

1. **`OmniscientBotCapability.build` never passed `honorBudget` or `board` to
   `buildHandThreatMatrix`.** Both parameters exist, and the fair estimate
   beside it passes both (`handThreatPreconditions` defaults `true`). So the
   cheat's threat matrix priced Assassination as four free skill at two honor,
   and priced a pump that has no body to land on as skill. It over-estimated
   systematically — which is exactly the failure mode every rejected broad
   omniscient lever showed.
2. **The rollout's omniscient `opponentHandThreat` was honor-blind too.** Same
   fix, applied at `JigokuBotPolicy.conflictPhaseLookahead`'s `threat()` helper for
   the opponent side only.

`test/server/bots/omniscientcapability.spec.js` locks both halves and, just as
importantly, locks the honor-blind default so the shipped profiles keep the
behaviour they were measured with.

## Measurement

### The rigs

The old `botOmniscientRoundRobin.js` is retained because it publishes the
client benchmark, but it is **not** how an omniscient change is measured. Use:

```sh
# NULL ARM — mandatory. Must score exactly 50.00%.
OMNI=0 node tools/selfplay/parallelOmniscientHeadToHead.js

# Is the cheating seat a harder opponent? (the headline number)
OMNI=1 BASES=91001,92001,93001,94001,95001,96001 \
  node tools/selfplay/parallelOmniscientHeadToHead.js

# What does it DO differently, and what does that cost per deck?
KINDS=omni-use,attack-size SEAT=0 BASES=91001,92001 OUT=probe.json \
  node tools/selfplay/probeOmniscient.js
node tools/selfplay/analyzeOmniscientDecisions.js probe.json
node tools/selfplay/analyzeOmniscientDecisions.js probe.json --game "91001|Crane|Lion"

# A capability refactor is invisible to the fair identity slate. Hash both.
OMNI=1 node tools/selfplay/refactorIdentity.js
```

`parallelOmniscientHeadToHead.js` is `parallelHeadToHead.js` with the treatment
being the capability instead of a profile knob: every ordered cross-deck
pairing, mirrors excluded, each played twice on the same shuffle with the
omniscient seat on opposite sides. Deck strength and first player cancel by
construction, so the baseline is a hard 50%. `OMNI=2` makes both seats
omniscient, which is how a lever is isolated *on top of* omniscience.

### Baseline, 2026-08-21

```
LABEL=baseline OMNI=1  17 decks x 6 bases x both orientations = 3264 games
TREATED 1614-1650   49.45%   (-0.55pp)   z=-0.63  p=0.529
per base: -0.74  +2.21  -2.76  -0.92  +1.47  -2.57 pp
```

The null arm scored **exactly 272-272 (50.00%)** on the full pool, so the rig is
sound. Reports: `tools/selfplay/out/omni/baseline-6bases.{txt,json}` and
`null-b91001.{txt,json}`.

This replaces the 2026-07-21 `--mirrors-only` gate (52.8% / 50.5% / 53.5% at
N=40 per deck), which was too small and used a same-deck mirror.

### It is not inert — it is decisive and directionless

The paired probe (544 games, seat 0, bases 91001+92001):

```
winner flipped              157 (28.9%)  -> to treated 81, away 76
same winner, different path 194 (35.7%)
game completely unchanged   193 (35.5%)
CEILING: 14.43pp
```

**Omniscience changes the outcome of 29% of games and wins half of them.** This
is the "real lever pointed in no useful direction" case, not the inert case —
so the question is not "how do we make the cheat reach further" but "which of
the decisions it already changes are the bad ones".

### Census — where the cheat actually acts

| site | windows | gated off | live | diverged | div/live | games touched |
|---|---:|---:|---:|---:|---:|---:|
| province-target | 2826 | 163 | 2663 | 868 | 32.6% | 391/544 (71.9%) |
| axis | 3716 | 3075 | 641 | 49 | 7.6% | 26/544 (4.8%) |
| token-defense | 3303 | 2419 | 884 | 35 | 4.0% | 19/544 (3.5%) |

Plus, over 6990 omniscient declarations: the exact province strength differed
from the fair guess-4 fallback in 26.7% of them **by a mean of 0.25 skill**, and
the response buffer applied in 33.8%.

Three things follow.

- **Exact province TARGETING is the omniscient bot.** Everything else is a
  rounding error by comparison.
- **Exact break SIZING buys almost nothing.** A revealed province already
  publishes its strength through `strengthSummary.stat`, so the cheat and the
  guess agree on nearly every declaration; where they differ it is by a quarter
  of a point of skill.
- The rollout's `opponentHandThreat` is the second field-wide effect and has no
  telemetry and no opt-in. Phoenix, whose profile gates province knowledge off
  entirely, still has 0 province/axis/token divergences and still flips 9 of its
  32 games — that is the planner threat and the earth-ring bonus alone.

### The modelled hand threat is ~4 skill in three windows out of four

Over the 641 live axis windows in the same probe:

| | |
|---|---:|
| mean modelled threat, military / political | 3.88 / 3.34 |
| windows where the larger threat is **>= 4 skill** | 476 (74.3%) |
| windows where the opponent held **zero fate** | 141 (22.0%) |
| windows where both axes modelled as zero | 19 (3.0%) |

A four-skill threat out of a hand with no fate has to be a zero-cost event. The
registry has plenty of genuine ones, but it also prices honor-costed cards as
free, which is the defect above. Either way the consequence is the same and it
is field-wide: **the omniscient rollout assumes the opponent can answer any
declaration with about four skill, where the fair rollout assumes zero.** That
is not extra information, it is a permanent handicap the fair bot does not
carry, and `omniscientPlannerHandThreat` is the arm that prices it.

### Exact targeting steers onto HARDER provinces

Of the 868 diverged target picks:

| | count |
|---|---:|
| omni chose a **stronger** province than fair would | 279 |
| omni chose a **weaker** province | 151 |
| equal true strength (pure tie-break reorder) | 438 |

Mean true-strength delta **+0.15**. The only omniscient-only term that can
outrank a weaker province is `provinceTargeting.hiddenDynastyDenialWeight`
(default 1, cap 6), which discounts effective strength by the value of the
hidden dynasty stack a break would discard — up to six points, which is more
than most provinces are worth in the first place.

A worked case, `91001|DragonAttachments|CraneHonor`
(`analyzeOmniscientDecisions.js --game`): in round 2 the omniscient seat passed
over province 2 at strength 3 to attack province 4 at strength 4, with four
face-down provinces still standing. Fair arm won by conquest in 4 rounds; the
omniscient arm lost on honor in 4.

Bucketing decided games by how targeting moved is **suggestive, not
conclusive** (n=31..46 per bucket): tie-break-only reorders 18-26 (40.9%),
harder 25-21, easier 17-14, no divergence 21-15. The `denyOff` arm exists to
settle it.

### Ceiling sweep, 2026-08-21

Every lever, measured on top of omniscience against a fair opponent (the shipped
configuration), 272 games each on base 91001:
`bash tools/selfplay/runOmniscientArms.sh ceiling 91001`.

| arm | games flipped | ceiling | verdict |
|---|---:|---:|---|
| null | 0 (0.0%) | 0.00pp | rig validated |
| `useOmniscientProvinceKnowledge: false` | 72 (26.5%) | 13.24pp | resolvable |
| `hiddenDynastyDenialWeight: 0` | 51 (18.8%) | 9.38pp | resolvable |
| `omniscientPlannerHandThreat: false` | 45 (16.5%) | 8.27pp | resolvable |
| `useOmniscientConflictAxis: true` field-wide | 9 (3.3%) | 1.65pp | **sub-floor, rejected** |
| `omniscientAttackResponseBuffer: 1` field-wide | 5 (1.8%) | 0.92pp | **sub-floor, rejected** |
| `useOmniscientTokenDefense: true` field-wide | 4 (1.5%) | 0.74pp | **sub-floor, rejected** |
| `omniscientCheapestBreakAxis: true` | 2 (0.7%) | 0.37pp | **sub-floor, rejected** |
| `omniscientThreatRealism: true` | 0 (0.0%) | 0.00pp | **inert, see below** |

Read the shape, not just the numbers. **Every arm that makes the cheat do MORE
is sub-floor; the only arms with a real population are removals.** Turning the
axis rule, the response buffer and token defense on field-wide are each worth
under 1.7pp at their absolute ceiling, so no head-to-head can resolve them and
tuning their values cannot help.

`omniscientCheapestBreakAxis` was written on the reasoning that the levers which
win in this project spend FEWER bodies (`unopposedWindow`) while the ones that
lose spend more. The reasoning may be right; the population is not there. It
requires both axes to break the target AND to need a different number of bodies,
which happened in 2 games out of 272. Left in, defaulted off, not proposed again
without a population argument.

### `omniscientThreatRealism` is inert, and that was verified rather than assumed

The arm ran 272/272 games bit-identical, which is the same signature as a broken
wire — a trap this project has hit before. A paired both-arms probe
(`ARMS=both ONLY=CraneDuels`, 16 pairings, 98 axis windows) settles it: with
realism on, the modelled military threat drops **4 -> 0** in 2 of those 98
windows and is unchanged in the other 96. The flag reaches `buildOmniscient`,
the matrix changes, the corrected pricing fires — and it fires too rarely to
decide anything.

The reason is that the conditions it corrects for barely occur in self-play:
honor sits near 10-11 while the largest `honorCost` in the registry is 3, and at
a declaration both sides essentially always have a ready body, so the board
preconditions almost never bind either. Keep the fix — pricing an unaffordable
card as free is wrong however rarely it matters — but treat it as **correctness,
not a win-rate lever**, exactly like `polarityGuards`. Do not re-measure it
hoping for a number.

### Head-to-head, the three arms with a real population

Shipped configuration — the treated seat is omniscient AND carries the arm, the
other seat is a plain fair bot — 3 bases, 1632 games each. Directly comparable
to the 49.51% the baseline scored on those same three bases.

| arm | result | p vs 50% | vs baseline |
|---|---|---:|---:|
| `omniscientPlannerHandThreat: false` | 842-790, **51.59%** | 0.198 | **+2.08pp** |
| `useOmniscientProvinceKnowledge: false` | 822-810, 50.37% | 0.766 | +0.86pp |
| `provinceTargeting.hiddenDynastyDenialWeight: 0` | 818-814, 50.12% | 0.921 | +0.61pp |

**Exact province targeting is a null in both directions.** It flips a quarter of
all games, it is three quarters of everything the cheat does, and removing it
entirely moves the win rate by +0.86pp against a +/-2.5pp floor. Removing only
its distorting denial term moves it +0.61pp. Do not spend more time tuning
province targeting for the omniscient seat; the ranking it feeds is already at
its ceiling and better inputs to it are worth nothing.

### SHIPPED: the rollout no longer gets the exact opponent hand threat

`omniscientPlannerHandThreat` now defaults **false**.

Confirmation on three FRESH bases (94001-96001) came back positive on all three:
833-799, 51.04% (+1.10 / +1.47 / +0.55pp). Pooled over all six bases the arm
scores **1675-1589, 51.32%**, positive on five of six.

The decisive test is paired, because the arm and the baseline share every
shuffle:

```
3264 matched rows, 0 unmatched
  same outcome        2255
  arm won, base lost   555
  arm lost, base won   454
  discordant          1009    +1.55pp    sign test p = 0.0016
```

So the configuration change turns omniscience from a **-0.55pp** null into a
**+1.32pp** result against a fair bot. Note the honest asymmetry between the two
numbers: +1.55pp against the unfixed omniscient bot is well powered and
significant; 51.32% against a fair bot is only p=0.13, because resolving a
~1.3pp absolute effect needs roughly 7800 head-to-head games.

Fair play is untouched and provably so — the fair identity slate still hashes
`a2ab0d97e9466980`. The branch requires `context.omniscient`, so a fair seat
cannot reach it whatever the flag says.

**The mechanism.** The rollout's `opponentHandThreat` was the one omniscient
effect that reached every deck with no profile opt-in. It told the search that
the opponent could answer any declaration with about four skill, in 74% of
windows, including windows where they held zero fate — where a fair bot assumes
zero and attacks. That is not an information advantage, it is a self-inflicted
caution penalty that only the cheating seat pays.

### Per-deck: no deck qualifies for its own omniscient tuning

Pooled `SEAT=0` + `SEAT=1` probes under the shipped configuration (1088 games,
bases 91001+92001), so the seat bias cancels:
`node tools/selfplay/perDeckFlips.js out/omni/shipped-s0.json out/omni/shipped-s1.json`

| deck | effect | p | | deck | effect | p |
|---|---:|---:|---|---|---:|---:|
| Crab | +6.25pp | 0.096 | | Crane | -0.78pp | 1.000 |
| ScorpionBidWar | +4.69pp | 0.180 | | DragonAttachments | -0.78pp | 1.000 |
| CrabSacrifice | +3.91pp | 0.332 | | LionDuelist | -0.78pp | 1.000 |
| CraneHonor | +2.34pp | 0.581 | | Scorpion | -1.56pp | 0.815 |
| Lion | +2.34pp | 0.629 | | Unicorn | -2.34pp | 0.607 |
| Phoenix | +2.34pp | 0.549 | | LionHonor | -3.91pp | 0.302 |
| PhoenixPhoenix | +0.78pp | 1.000 | | PhoenixShugenja | -4.69pp | 0.307 |
| CraneDuels / UnicornReveal | 0.00pp | 1.000 | | Dragon | -5.47pp | 0.118 |
| | | | | **TOTAL** | **+0.14pp** | 0.902 |

**Nothing here reaches significance** — the best rows are Crab at p=0.096 and
Dragon at p=0.118, and at n=64 per deck those are hypotheses, not results. The
nine decks that carry no omniscient tuning (CrabSacrifice, Dragon,
DragonAttachments, Lion, LionDuelist, LionHonor, Scorpion, ScorpionBidWar,
UnicornReveal) split five positive / four negative with no pattern.

So **per-deck omniscient configuration is not supported by the evidence** and
none was added. This is not an oversight: the three per-deck knobs that exist
(`useOmniscientConflictAxis`, `omniscientAttackResponseBuffer`,
`useOmniscientTokenDefense`) each have a ceiling under 1.7pp even when enabled
across the whole field, so no per-deck scoping of them could produce a
measurable gain. Enabling one for a deck on the strength of an n=64 row would be
exactly the single-base false positive this project keeps re-learning about.

## Tests

```sh
npx tsc
npx jasmine test/server/bots/omniscientcapability.spec.js
npx jasmine test/server/bots/deckanalysis.spec.js
npx jasmine test/server/bots/deckprofiles.spec.js
npx jasmine test/server/bots/fateawarejigokubot.spec.js
npx jasmine test/server/bots/specializedpolicycoverage.spec.js
npx jasmine test/tools/selfplay/botomniscientroundrobin.spec.js
node tools/selfplay/auditOmniscientCoverage.js
```

The regressions cover capability/seed independence, hidden hand cost and event
models, face-down province stacks, profile gates, hand-threat realism, and
benchmark publication.

## Known open threads

- The unopposed window (`UnopposedWindowPolicy`) fires on `minBodySkill`, which
  wins an unopposed conflict but does not necessarily BREAK. An omniscient seat
  knows the true province strength and could pick a body that breaks. The policy
  input carries no province strength today.
- `omniscientCheapestBreakAxis` exists but had not been measured when this was
  written.
