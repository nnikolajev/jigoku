# Bot V2 architecture

Bot V2 lives under `server/game/bots/v2/`. `BotEngineRouter` owns version selection: V1 goes directly to `V1PolicyAdapter`; V2 wraps that same adapter as its deterministic fallback. `JigokuBotController` remains the sole command executor and preserves legality checks, rejection handling, progress detection, click-loop protection, and decision budgets.

## Decision pipeline

1. `PlanningStateBuilder` creates an immutable player-perspective snapshot and stable prompt/material-state fingerprints.
2. `IntentManager` selects or retains game, round, phase, conflict, and macro intent plus reservations.
3. `CandidateRegistry` asks contributors for semantic candidates. Contributors may add candidates, constraints, effects, or score annotations; they never submit commands.
4. `SafetyValidator` applies legality and shared safety vetoes before scoring.
5. `UtilityEvaluator` produces a common utility vector. Deck differences are injected through profiles and `DeckSynergies`, not hard-coded into the orchestrator.
6. `TacticalSearch` projects immutable effect descriptors with deterministic ordering and bounded depth, beam, candidate, and node limits.
7. `TerminalSolver` takes priority for forced wins and forced-loss prevention.
8. The high-confidence gate either selects one V2 command or records an explicit V1 fallback. The floor is confidence 0.90 plus score advantage 3 and a terminal/shared-safety justification; profiles may only tighten it. Only the first live action is executed; material changes trigger replanning.

Typed semantics are in `v2/cards`; immutable candidates/effects/state/utility/intent models are in `v2/model`; generic scope ledgers are in `v2/ledger`; allocation, information, resource, terminal, and search layers have separate folders. Stable candidate IDs include semantic source/mode/target/cost identity. Prompt chains use `ActionMacro` continuation and are revalidated at every step.

`TacticalSearch` remains fully implemented and exercised in shadow/research mode. `liveTacticalSearch` is false unless an injected profile explicitly opts in. This is a retained experiment switch, not a safety bypass: terminal solving and shared safety vetoes still run in enabled mode. The default was disabled after repeated holdouts showed zero accepted corrections, hundreds of exhausted search budgets, material runtime regression, and one 30-second self-play timeout.

## Information and traces

`FairInformationProvider` derives weighted hypotheses only from deck contents and public observations. `ExactInformationProvider` receives hidden identities only when omniscience is explicitly enabled; exact knowledge does not bypass fate, timing, target, or usage constraints.

Production traces retain summaries, benchmark traces add candidates, and research traces add score vectors, the searched graph, and deterministic replay fixtures. Trace level must not affect the selected command. `auditBotRegret.js` groups recurring regret signals and labels model/hidden-information limitations.

## Adding a card or contributor

Add typed action/static/trigger semantics and parity fixtures first. Express costs, targets, effects, limits, stacking keys, planning tags, and macro steps explicitly. A contributor should remain small and deterministic, propose through `CandidateRegistry`, and rely on shared safety/scoring/search/execution layers. Add source-eligibility, candidate-generation, command-execution, and realized-payoff coverage; then run the paired, interaction, and card-use gates. Never call rules methods or mutate the live game from planning code.

Coefficient changes belong in bounded offline profiles under `tools/selfplay/profiles/`. Retained profiles must include their parent, exact coefficients/hash, training and holdout suites/results, and rationale. Runtime defaults are not changed by the tuning tool.
