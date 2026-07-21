# Seed 3 cross-seed audit — 2026-07-21

## Scope

Only decks with observed seed-3 board-aware dynasty decisions were evaluated:
Dragon, Lion, and Phoenix Shugenja. Each played every registered opponent deck
on seeds 1 and 2. Each ordered matchup used 20 games, alternating seats and
paired shuffle streams: 1,200 games per sweep.

## Baseline

| Seed-3 deck | Overall | vs seed 1 | vs seed 2 |
|---|---:|---:|---:|
| Lion | 65.0% | 61.5% | 68.5% |
| Dragon | 63.0% | 63.0% | 63.0% |
| Phoenix Shugenja | 59.5% | 56.5% | 62.5% |

Raw report: [seed3-enabled-vs-seeds1-2-baseline.md](../tools/selfplay/out/seed3-enabled-vs-seeds1-2-baseline.md).

## Finding and retained fix

Lion and Dragon already cleared the 60% target. Phoenix Shugenja missed by one
win. Exact replay of RNG 23060721 against Scorpion exposed a generic state bug:
the bot spent its last conflict-deck margin on Oracle of Stone, Forgotten
Library, and Shrine Maiden while a visible Bayushi Shoju guaranteed more draws
and honor loss. A later reshuffle cost five honor and caused a dishonor loss.

`ConflictDeckSafetyTactics` now gates optional deck consumption for seeds 1 and
3. The same replay changes from Scorpion dishonor in round 4 to Phoenix conquest
in round 4. Seed 2 remains the legacy control. The policy is public-state only
and is injectable through `DeckProfile.conflictDeckSafety`.

A proposed Phoenix-specific two-card reserve was rejected. Its identical-stream
Phoenix/Scorpion result stayed 40-120, while wins merely shifted between seed-1
and seed-2 opponent pools. The final profile therefore keeps the generic zero
extra buffer.

## Final validation

| Seed-3 deck | Overall | vs seed 1 | vs seed 2 | 60% target |
|---|---:|---:|---:|:---:|
| Lion | 65.0% | 61.5% | 68.5% | pass |
| Dragon | 63.0% | 63.0% | 63.0% | pass |
| Phoenix Shugenja | 59.3% | 56.5% | 62.0% | boundary miss |

Total: 749-451, 62.4%. The full identical-stream result is statistically flat
from baseline. A separate same-configuration Phoenix-only sweep produced
241-159 (60.3%), showing the requested threshold is inside ordinary 20-game
per-matchup variance; no matchup-specific overfit was retained.

Raw reports:

- [final full sweep](../tools/selfplay/out/seed3-enabled-vs-seeds1-2-conflict-deck-safety-final.md)
- [Phoenix-only confirmation](../tools/selfplay/out/seed3-shugenja-vs-seeds1-2-conflict-deck-safety.md)
- [exact replay](../tools/selfplay/out/seed3-shugenja-scorpion-conflict-deck-safety-generic.md)
- [rejected reserve A/B](../tools/selfplay/out/seed3-shugenja-focus-buffer2.md)

Validation: TypeScript passed; 106 related specs passed; the full suite passed
10,330 specs with zero failures and eight pending; the 60-game seed-1/seed-3
interaction audit passed with zero rejected clicks, loops, or decision-budget
exhaustion. Its report is
[seed3-cross-seed-conflict-deck-safety-interactions.md](../tools/selfplay/out/seed3-cross-seed-conflict-deck-safety-interactions.md).
