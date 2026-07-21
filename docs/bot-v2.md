# Jigoku Bot V1 and Bot V2

The Imperial bot now has two independently selectable decision engines.

- **Bot V1** is the stable default. It is the previously deployed heuristic bot, preserved behind a direct execution path.
- **Bot V2** is an opt-in experimental tactical planner. It proposes and scores semantic actions, runs the terminal solver, and uses the equivalent Bot V1 policy as its deterministic per-decision fallback. Broad tactical search currently runs in shadow/research mode only because its live runtime gate failed.

Bot version is independent from the strategy seed, deck, and information mode. Seeds still choose the same strategy profiles: seed 1 is the mixed/fate-aware default, seed 2 is dynasty-focused, and seed 3 adds board-aware dynasty development. Omniscient mode remains a separate checkbox; fair mode never receives hidden identities.

V2 sends only normal Jigoku commands through the existing controller. It cannot mutate rules state directly. If its semantics are incomplete, a plan becomes stale, confidence is too low, or a retained slice reaches its budget, V2 records the reason and delegates that decision to V1. Live overrides require at least 0.90 semantic confidence, at least 3 score advantage, and a terminal or shared-safety justification; profiles may tighten but cannot relax these floors.

V2 is currently experimental. The final retained live slice had exact paired outcome/trace equivalence and no planner errors or search-budget exhaustion, but fallback remained 100% and mean game runtime remained above V1. A 30-second self-play cap also exposed one pre-disable timeout; the broad search slice was disabled and the same paired partition then completed exactly. Therefore V1 remains default and rollback is simply selecting Bot V1. Benchmark text in the lobby is filtered by engine version, seed, deck, and fair/omniscient mode; missing V2 data is shown as missing rather than substituted with V1 data.

Benchmark percentages are noisy at small sample sizes. Use paired results, confidence intervals, deck-specific rows, victory types, fallback rate, nodes per decision, and runtime together. A short tactical win or one favorable matchup is not a release signal.
