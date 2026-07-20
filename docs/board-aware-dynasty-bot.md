# Seed 4 board-aware dynasty bot

Seed 4 is seed 1 plus `BoardAwareDynastyTactics`. It remains a fair bot: only
seed 3 receives hidden hand and facedown-province information. Adaptive
mulligan is shared by every seed and is not a seed-4 feature.

## Design

The mature seed-1 buyer remains the ordinary purchase path. Seed 4 decorates
that decision with persistence and switches to its full planner only when the
stronghold race is urgent or, where enabled, the second player has a severe
board-power deficit. This hybrid kept existing deck playbooks and early-pass
behavior while adding game-state awareness.

`BoardAwareDynastyTactics` receives:

- exact cost, military, political, glory, ability value, and honored-on-entry
  state for every faceup character in every province stack;
- both boards and persistent fate;
- current and starting fate, dynasty spend, and purchased-body count;
- round, first/second player, and both broken-province counts;
- both honor totals;
- exact conflict-hand costs and priorities for fate reserve planning;
- the deck's preferred dynasty character.

It calculates board power rather than matching character count. Early and
midgame favor persistent towers and one fate on valuable two-cost characters.
Late or exposed-stronghold states lower future-turn investment and buy power
for the current turn. The second player can develop wider because passing
first is less likely; the first player retains seed 1's tower-and-pass value.

When no useful ready body remains and another conflict can be declared, seed 4
may play a conflict character at home. The candidate must safely beat visible
ready defense and, by default, break the weakest legal province. Dual-mode
cards are explicitly played as characters. Physical UUID intent tracking
prevents later copies from inheriting that choice.

## Injectable profile

All coefficients live in `DeckProfile.boardAwareDynasty`, including power
weights, board-match ratios, target bodies by round, spend caps, first/second
player adjustments, province and honor urgency, hand reserve, additional fate,
conflict-character safety, and per-card value overrides.

Rush profiles keep wider Lion/Unicorn body targets. Decks whose specialized
buyers proved stronger can disable the full urgent planner or persistence
decorator without branching the shared policy. These exceptions are measured
profile choices, not clan checks in `JigokuBotPolicy`.

## Comparison and tuning

```powershell
# Same deck on both seats, seed 4 versus seed 1, paired shuffle and seat swap
node tools/selfplay/compareDynastySeeds.js

# Focused deterministic run
node tools/selfplay/compareDynastySeeds.js --games 40 --decks Lion,Unicorn --rng-seed 20260720
```

The tool reports wins plus traced generic/board-aware purchase and additional-
fate reasons. It never updates client benchmark data. Small paired samples are
treated as noisy; profiles are not changed merely to fit one shuffle stream.

The initial standalone planner scored 36-64 over 100 games and was rejected.
The hybrid recovered to 96-104 in the first 20-game-per-deck paired gate.
Focused profile corrections then produced a final all-deck gate of 104-96
(52.0%) for seed 4. It won or tied 8 of 10 deck rows. Dragon Attachments'
8-12 row was checked on a fresh stream and finished 21-19, so no sample-driven
exception was added.

Phoenix repeated a real full-planner regression (15-25): the generic catch-up
buyer displaced its durable glory-body plan. Disabling full planner replacement
while retaining persistence decoration changed the same stream to 21-19; a
fresh 20-game stream finished 9-11, for a combined post-fix 30-30. This neutral
confirmation is retained instead of overfitting another coefficient.

## Standard benchmark

The standardized same-seed seed-4 run is stored dynamically in
`jigoku-client/client/botBenchmarkResults.json`:

- versus Crane baseline, 100 games per deck: 507 wins, 391 losses, 2 other
  results (56.3% over 900 games);
- 40-game round robin: Phoenix 64.2%, Dragon 61.9%, Phoenix Shugenja 57.8%,
  Scorpion 56.5%, Lion 56.1%, Crane 47.1%, Unicorn 45.0%, Dragon Attachments
  40.6%, Crab 36.1%, and Crane Duels 34.8%.

Both standard scripts updated the client data automatically, so the deck and
seed dropdown displays these measured results rather than hardcoded labels.

## Regression gates

- `boardawaredynastytactics.spec.js`: board power, cheap persistence,
  honored-on-entry, player order, hand reserve, urgency, and rush behavior.
- `fateawarejigokubot.spec.js`: seed routing, exact multi-card province costs,
  home conflict-character mode, and generic adaptive mulligan defaults.
- `specializedpolicycoverage.spec.js`: every deck hook executes on seeds 1-4.
- `comparedynastyseeds.spec.js`: reusable comparison CLI and paired scheduling.
- `validateBotInteractions.js --seeds 4`: repeated-click, cycle, budget, and
  stall protection.

The final ten-deck seed-4 audit passed every case with zero rejected clicks,
cycles, budget failures, or stalls; maximum work in one controller tick was 11
decisions. Report: `tools/selfplay/out/seed4-board-aware-final-interactions`.
