# Seed 3 board-aware dynasty bot

Seed 3 is seed 1 plus `BoardAwareDynastyTactics`. It remains fair unless the
independent `omniscient` capability is enabled. Adaptive mulligan is shared by
all seeds and is not a seed-3 feature.

## Design

The mature seed-1 buyer remains the ordinary purchase path. Seed 3 decorates
that decision with persistence and switches to its full planner when the
stronghold race is urgent or, where enabled, the second player has a severe
board-power deficit.

`BoardAwareDynastyTactics` receives exact face-up dynasty costs and stats, both
visible boards, persistent fate, current spend, round, first/second player,
broken provinces, honor, conflict-hand costs, and deck priorities. It compares
board power rather than character count.

Early and midgame favor persistent towers and one fate on valuable two-cost or
honored-on-entry characters. Exposed strongholds lower future investment and
buy immediate power. The second player may develop wider; the first player
retains seed 1's tower-and-pass value. When safe and useful, seed 3 may also
play a conflict character at home to use another conflict opportunity.

## Injectable profile

All coefficients live in `DeckProfile.boardAwareDynasty`: power weights,
board-match ratios, body targets, spend caps, player-order adjustments,
province and honor urgency, conflict-card reserve, additional fate, home-play
safety, and per-card value overrides. Lion and Unicorn retain wider rush
targets. Profiles can disable planner replacement or persistence decoration
without clan branches in the shared policy.

## Comparison

```powershell
# Same deck, seed 3 versus seed 1, paired shuffles and alternating seats
node tools/selfplay/compareDynastySeeds.js
node tools/selfplay/compareDynastySeeds.js --games 40 --decks Lion,Unicorn
```

The original seed-4 implementation was renumbered to seed 3 when omniscience
became an optional capability. Historical tuning reports may retain `seed4` in
their filenames, but current commands and configuration use seed 3.

## Regression gates

- `boardawaredynastytactics.spec.js`: power, persistence, player order, reserve,
  urgency, and rush behavior.
- `fateawarejigokubot.spec.js`: seed routing, province stacks, home conflict
  characters, and adaptive mulligan.
- `specializedpolicycoverage.spec.js`: deck hooks execute on seeds 1-3.
- `comparedynastyseeds.spec.js`: paired comparison scheduling.
- `validateBotInteractions.js --seeds 3`: click cycles, budget, and stalls.

Standard `winRates.js` and `botRoundRobin.js` runs store current seed-3 results
in `jigoku-client/client/botBenchmarkResults.json`.
