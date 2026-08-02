# Jigoku Bot V1 and Bot V2

The Imperial bot now has two independently selectable decision engines.

- **Bot V1** is the stable default. It is the previously deployed heuristic bot, preserved behind a direct execution path.
- **Bot V2** is an opt-in experimental tactical planner. It proposes and scores semantic actions, runs the terminal solver, and uses the equivalent Bot V1 policy as its deterministic per-decision fallback. Broad tactical search currently runs in shadow/research mode only because its live runtime gate failed.

Bot version is independent from the strategy seed, deck, and information mode. Seeds still choose the same strategy profiles: seed 1 is the mixed/fate-aware default, seed 2 is dynasty-focused, and seed 3 adds board-aware dynasty development. Omniscient mode remains a separate checkbox; fair mode never receives hidden identities.

V2 sends only normal Jigoku commands through the existing controller. It cannot mutate rules state directly. If its semantics are incomplete, a plan becomes stale, confidence is too low, or a retained slice reaches its budget, V2 records the reason and delegates that decision to V1. Live overrides require at least 0.90 semantic confidence, at least 3 score advantage, and a terminal or shared-safety justification; profiles may tighten but cannot relax these floors.

V2 is currently experimental. The final retained live slice had exact paired outcome/trace equivalence and no planner errors or search-budget exhaustion, but fallback remained 100% and mean game runtime remained above V1. A 30-second self-play cap also exposed one pre-disable timeout; the broad search slice was disabled and the same paired partition then completed exactly. Therefore V1 remains default and rollback is simply selecting Bot V1. Benchmark text in the lobby is filtered by engine version, seed, deck, and fair/omniscient mode; missing V2 data is shown as missing rather than substituted with V1 data.

Benchmark percentages are noisy at small sample sizes. Use paired results, confidence intervals, deck-specific rows, victory types, fallback rate, nodes per decision, and runtime together. A short tactical win or one favorable matchup is not a release signal.

## Measured status (2026-07-25 pickup)

With the current default proof-gated overrides live, V2 diverges from V1 on about 12% of decisions. On a seed 1 / fair / all-deck / paired alternating-seat run of 120 games (`tools/selfplay/out/v2-baseline-big-seed1-fair-rng71002.json`), V2 went 62-57-1 (51.7%) while the V1 control seat on the identical shuffles went 61-57-2 (50.8%): 19 discordant pairs split 9-8 for V2, McNemar exact two-sided p = 1.000. In other words, V2 is currently **statistically indistinguishable from V1**, not ahead of it, and well short of the 70% default-promotion gate.

The reason is structural. V2 plays V1's move roughly 88% of the time and only overrides where a deterministic proof (terminal, minimum-sufficient response, break-prevention set, semantic agreement) clears fixed safety floors. Those overrides are individually safe but collectively produce no measurable win-rate uplift. When V2 is instead allowed to trust its own utility policy on execution-safe single-command decisions (the research-only `highConfidenceGate.allowAutonomousPolicy`), its win rate against V1 collapses to roughly 6-8% (see `bot-v2-rejected-experiments.md`): the hand-coded linear evaluator is much weaker than V1's tuned heuristics, so widening divergence loses. Reaching a genuinely stronger V2 needs a stronger evaluator (a self-play-learned value function, or holdout-confirmed offline coefficient tuning), not more overrides. Until then V1 remains default and V2 stays opt-in and experimental.

## Direction change (2026-07-26): V2 is tuned per-deck, like V1

The two failures above share one cause: **generic machinery without deck
knowledge plays worse than V1's deck knowledge.** V2 is therefore treated as
what it actually is — the same heuristic bot with more inputs and more tunable
parameters — and it gets per-deck logic exactly the way V1 does.

Conflict declaration is the first area converted to this model: a deck proposes
declaration **options** (conflict type, ring, must-participate bodies, bodies
held in reserve, confidence), and the shared `ConflictPhasePlanner` scores them
inside the same-phase rollout and executes the best whole-phase sequence.

**See `docs/bot-v2-deck-tuning.md` for the decision, the rule surface, and how
to add or measure a deck.**

Result of the first iteration under this model: across three independent seeds
of cross-deck round-robin (180 paired games each, every deck against the other
nine, paired against a V1 control seat on identical shuffles), V2 went
**57.0% vs V1's 50.2% — +6.9pp over n=540**, with 117 discordant pairs split
77-40 for V2 (McNemar two-sided p = 0.00087). Every seed was positive
(+5.0 / +9.4 / +6.1pp).

The gain came almost entirely from `applyAttackerPlan`, the declaration layer
that had never been measured: V1 sizes each attack in isolation and over-commits
bodies into conflicts it cannot break, while the phase rollout commits the
smallest set that wins the whole phase. It is now the V2 baseline, with Unicorn
opting out because its cavalry movement engine owns declaration order. This does
**not** change the 19.14 default-promotion gate, which remains unmet; V1 is
still default and V2 still opt-in.
