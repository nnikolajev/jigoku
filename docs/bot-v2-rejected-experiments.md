# Rejected and disabled Bot V2 experiments

Keep failed or inconclusive work here so it is not silently re-enabled.

## Initial enabled live profile: not eligible as default

- Evidence: `tools/selfplay/out/v2-task17-holdout-fair-rng27101.json`.
- Result: 10-10 across ten same-deck paired rows; 20/20 outcome equivalence; zero planner errors.
- Cost: 100% per-decision fallback, 23.3 searched nodes per decision, 17.43 ms planner time per decision, and 7272.7 ms versus 2886.3 ms mean game runtime.
- Decision: retain `tools/selfplay/profiles/v2-default-experimental.json` for reproducibility, keep V2 opt-in, and do not adjust coefficients from this small sample. A profile that performs search but never clears the live gate is not a default candidate.

## Broad tactical search in enabled mode: disabled

- Shadow evidence: `v2-shadow-matrix-fixed-seed{1,2,3}-{fair,omniscient}` completed 120/120 paired outcomes and semantic traces exactly across all decks, seeds, and information modes.
- Threshold evidence: seed-1 shadow reports recorded 166 fair and 121 omniscient preferences meeting confidence 0.90 and score advantage 3, but none had a proven terminal justification.
- Live evidence before disable: RNG 27101 fair searched 23.3 nodes/decision, exhausted 678 budgets, accepted zero corrections, and ran at 7845.3 versus 3296.9 ms/game. RNG 27102 omniscient produced a Lion timeout at the 30-second harness cap with no V2 override.
- Retained result after disable: RNG 27101 and 27102 fair/omniscient completed 80/80 paired outcomes and traces exactly (40-40 aggregate; four first-seat and four second-seat games per deck), with zero search nodes, budget exhaustion, planner errors, or corrections. Combined runtime remained 5079.6 versus 2991.5 ms/game and planner time was 12.84 ms/decision. One fair interaction sample still exceeded the 30-second self-play cap at 31.177 seconds; the identical 60-second-cap matrix completed 30/30 with zero click, cycle, stall, or decision-budget findings.
- Decision: `liveTacticalSearch` defaults off and is profile opt-in. Shadow/research retains the implementation and evidence. Do not re-enable until repeated training and holdout partitions show accepted tactical corrections, no timeout, bounded latency, and no severe deck outlier.

## Raw UUID trace comparison: rejected

- Initial matrix reports appeared to show deterministic trace differences. First-difference instrumentation showed identical Raise the Alarm prompt, reason, seed state, and province choice; only generated UUIDs for masked cards differed between replays.
- Decision: compare semantic `cardId` or stable `cardLocation`, while retaining first semantic difference diagnostics for genuine mismatches. The corrected six-partition shadow matrix passed 120/120 traces.

## Single-opponent or single-RNG coefficient tuning: rejected

- Evidence: the retained pilot uses only RNG 14150 and mirror-deck comparison rows.
- Decision: no coefficient change was made. Default promotion requires the checked-in full-league training/holdout partitions, distinct RNG streams, repeated holdout confirmation, no safety failures, and no severe deck outlier.

## Approximate card semantics as live high-confidence actions: disabled

- Affected approximations include Cavalry Reserves, Master Whisperer, Rebuild, Isawa Mori Seido, High House of Light, Togashi Mitsu, and Togashi Ichi.
- Decision: their confidence remains below the live override gate. They remain available for shadow analysis and semantic coverage but delegate execution to V1 until exact timing, target, and payoff evidence supports promotion.

## ConflictPhasePlanner switches: not enabled

- Decision: previously rejected abstract planner integrations remain off. V2 integrates through concrete semantic candidates and validated commands; an abstract conflict recommendation is not treated as executable planner integration.
