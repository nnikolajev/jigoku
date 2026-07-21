# Bot V1 frozen baseline

Captured before Bot V2 implementation from Jigoku commit
`0ad932b9bbe65029014563aff14ddbca163b6d8c`.

## Immutable evidence

- `standardized-benchmark.json` is an exact copy of the version-5 client
  benchmark (`crane-baseline-4736f7c0`) at capture time. Its SHA-256 is
  `50366E81F1A1CF7314DF88CB12241D25CE229185F3F7EE21FEC6521E8D310AF0`.
- `interaction-fair.json` covers every registered deck and seed against Crane:
  30/30 PASS, 12,260 decisions, zero rejected/unsupported/forced-progress
  decisions, cycles, stalls, or budget exhaustion. SHA-256:
  `F6E6C5B1B6E681DF24F183809310A4FB5F8A63E8642F78BD6E5907945962AF5C`.
- `interaction-omniscient.json` covers the same matrix: 30/30 PASS, 12,200
  decisions, zero rejected/unsupported/forced-progress decisions, cycles,
  stalls, or budget exhaustion. SHA-256:
  `FF6DD3CC5C073B5E50C923528E6041DC65E43AD53F2DBBFAE7F777925775A4FC`.
- `card-use.json` covers ten decks, seeds 1/2/3, fair/omniscient modes, and one
  paired game per row: 60 games and zero failed jobs. Sparse sampling retains
  40 deck-wide reachable zero-use findings and 35 in-play abilities without an
  observed activation; these are investigation baselines, not proof of dead
  behavior. SHA-256:
  `9122AE3DE86D77682CE4C99287A5AFEE5429E07FC710EE8C289525A4342695AC`.
- Full Jasmine baseline: 10,342 specs, zero failures, eight existing pending
  specs, 78.709 seconds. `npm test` includes TypeScript compilation.

## Frozen source hashes

- `JigokuBotPolicy.ts`: `BE7922002D55A8A5864407151C9B122E8EA330C89E27D2D73D948AA580D33EDB`
- `JigokuBotController.ts`: `32295250CCEDE0599E414CE26C3EEF85FDBDF4CB4C91CECF5868E75E4669439A`
- `JigokuBotConfig.ts`: `B71401550BA928A43B728AE2DBE0AD2A24152EB7D6F1D612B6FC1A64B92A8268`

## V1 change policy during V2 work

V1 remains directly selectable and bypasses every V2 planning component.
Only authoritative engine-rule corrections or controller safety fixes may
change V1 behavior. Each permitted change requires refreshed golden traces,
focused rule/safety tests, paired deterministic evidence, and a recorded
rationale. Tactical tuning, card heuristics, planner integration, or benchmark
improvement attempts belong in opt-in V2 slices and must not alter V1.

Do not replace these files with V2 or mixed-version results. New benchmark
captures use version-specific directories and configuration hashes.
