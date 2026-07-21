# Conflict-phase lookahead planner

All three bot seeds can use the shared `ConflictPhasePlanner`. It performs a
bounded deterministic rollout over the rest of the current conflict phase; it
does not search across fate phases or future rounds. The prior declaration
heuristic remains available as the `legacy` policy for direct A/B tests.

## Model

The planner receives public live state from `JigokuBotController`:

- each player's total, military, and political conflict opportunities;
- ready/bowed status, live military/political skill, attack legality, Covert,
  current participation, and whether a character bows after the conflict;
- unclaimed rings, ring fate, and the existing deck-specific ring evaluation;
- legal outer/stronghold targets, effective province strength and broken count;
- the bot's affordable hand threat; opponent hand threat only when the
  independent omniscient capability is enabled.

Each rollout alternates players. An attack consumes its typed opportunity and
ring, commits attackers, lets the defending side choose a response, bows the
characters that should bow, and records conflict wins, ring value, province
breaks, and terminal stronghold breaks. Extra typed opportunities are naturally
represented by counts greater than one. Covert removes the strongest eligible
defender from the simulated defense pool for each Covert attacker.

The search is deliberately bounded by profile values: depth, candidate attack
sets, candidate rings, candidate attacks, discount, aggression, break values,
ring values, and future-ready-skill value. Dominated declaration branches are
ranked and pruned before recursive search.

## Safe integration boundary

`DeckProfile.conflictPlanning` exposes every search coefficient plus separate
application switches:

| Switch | Default | Reason |
|---|---:|---|
| `applyTypePlan` | off | applying an abstract axis without its simulated attacker set regressed the direct A/B |
| `applyTargetPlan` | on | supplies sequential break/stronghold target intent; normally agrees with `ProvinceTargetingTactics` |
| `applyDynastyProjection` | off | seed-3 experiment was neutral alone and regressed when combined with target planning |
| `applyRingPlan` | off | mature Phoenix/deck ring tactics were stronger in the direct A/B |
| `applyPassPlan` | off | the raw minimax result became too passive |
| `applyAttackerPlan` | off | exact simulated sets displaced richer live solo-attack, movement, Lion-payoff, and stronghold-reserve rules |

The disabled integrations are retained for experiments and deck overrides; the
rollout class and tests still cover them. Rush profiles raise aggression and
break value while keeping planner-driven passing disabled.

When explicitly enabled, seed 3 evaluates up to three affordable dynasty bodies
on a fresh projected conflict phase. The marginal rollout score enters its
existing board-aware `abilityValue`; seed 1's mature deck buyer and seed 2's
original buyer remain unchanged. The projection uses a smaller four-ply search
so a dynasty prompt does not multiply full conflict-search cost.

## A/B command

```powershell
# Every deck and deployed seed, 20 same-deck games per row
node tools/selfplay/compareConflictPlanning.js

# Fast smoke and focused confirmation
node tools/selfplay/compareConflictPlanning.js --games 4 --seeds 1,2,3
node tools/selfplay/compareConflictPlanning.js --games 20 --seeds 1 --decks Dragon,Scorpion --rng-seed 20260731
```

Both seats use the same deck and bot seed, seats alternate, and each two-game
seat pair shares its deterministic starting RNG seed. Only
`conflictPlanningPolicy` differs:
`lookahead` versus frozen `legacy`. Reports are written as JSON and Markdown
under `tools/selfplay/out/`; they never update client benchmark results.

The rollout is an abstraction, not a card engine. Existing live tactics still
own conflict actions, movement, characters played from hand, ready effects,
ring replacement cards, and exact engine legality. This boundary prevents a
static search from suppressing card-specific behavior while still making
same-phase declaration order state-aware.

## July 2026 retention results

The first post-rule-fix configuration applied conflict type and target intent.
It scored **113-126 (+1), 47.3%** over 240 games, so it was rejected. Trace
isolation showed all recorded replacements were type switches. Ring, pass, and
exact attacker-set replacement had already failed smaller isolation runs.

The retained target-only layer scored **60-60** in a paired 120-game smoke.
A larger check of the three seed-1 smoke outliers scored **19-17 (52.8%)**:
Dragon 5-7, Lion 6-6, Scorpion 8-4. The seed-3 dynasty projection was neutral
at **20-20** alone; target plus dynasty scored **58-61 (+1), 48.7%**, so dynasty
projection is disabled by default. These results do not establish the requested 60% advantage; they
support a conservative no-regression integration and identify Dragon as the
main unresolved target-planning outlier. The full model remains injectable for
future work that can execute a coherent multi-action plan instead of applying
one abstract choice at a time.

## Regression gates

- `conflictphaseplanner.spec.js`: typed/extra opportunities, two-axis
  preservation, ring fate, Covert, no-bow reuse, exposed stronghold wins,
  injectable rush values, and legacy disable.
- `compareconflictplanning.spec.js`: CLI parsing, deterministic RNG, trace
  counting, and report rendering.
- `validateBotInteractions.js`: repeated clicks, cycles, budget exhaustion,
  stalls, timeouts, and engine errors after integration.
