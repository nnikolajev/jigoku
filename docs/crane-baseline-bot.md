# Crane Baseline bot deck (EmeraldDB 4736f7c0)

The standard Crane opponent and playable client deck is
[Crane Baseline](https://www.emeralddb.org/decks/4736f7c0-b4a6-4f17-9dde-b71614115c69).
The cached fixture is the exact submitted 40-card dynasty / 40-card conflict
list. `winRates.js` now measures every challenger against this list, and the
Jigoku client labels it **Crane Baseline**.

## Architecture

The deck reuses the shared `DuelTactics` package, while its unique decisions
live in the injectable `CraneBaselineProfile` / `CraneBaselineTactics` pair.
The profile is selected by card contents (Tsuma plus Gossip, Kakita Yoshi, and
Noble Sacrifice), not by a hard-coded deck UUID. Shared attachment removal is
handled by `AttachmentControlTactics`, so Let Go has one policy across decks.

The main profile knobs are:

- `gossipImportance`, `gossipTagWeights`, and `gossipMinimumScore`;
- `boardFloorRound`, `boardCharacterFloor`, and `dynastyFateReserve`;
- the solo Cautious Scout and Brash Samurai character ids.

## Dynasty and board plan

Rounds 1-2 establish a durable duelist and fund an expensive opening character
with up to two fate (a normal seven-fate opening can buy a five-cost champion
with two fate). From round 3 onward the Crane-specific buyer repairs the board
to at least three characters before the shared duel buyer may call the board
complete. It can buy a second durable character in the same late dynasty phase
when that is necessary to reach the floor, but preserves one fate for conflict
cards after the opening rounds.

This fixes an important interaction between the shared duel caps and the new
list: two durable characters formerly satisfied `towerTargetCount`, and if all
visible province characters were also durable, every one was rejected even
with 10+ fate available.

## Gossip

Both players know the submitted deck lists in L5R. The controller therefore
builds `opponentConflictDeck` from every physical conflict-deck card owned by
the opponent, including its printed name and fate cost, regardless of its
current zone.

- Seeds 1 and 2 rank only cards that actually occur in that public conflict
  deck. Copies, modeled swing, tactical tags, and matchup build-around weights
  decide which name is most important to the opposing game plan.
- Seed 3 starts from the same public deck list, then adds its omniscient
  advantage: exact copies in hand, current opponent fate, affordability, and
  current conflict relevance.
- A high-weight card absent from the submitted deck can never be named. If no
  real deck card clears the minimum score, Gossip is not played.
- The typed card-name prompt is submitted through the same legal controller
  path as ordinary menu buttons. Tests cover seeds 1, 2, and 3.

## Card sequencing

- Cautious Scout attacks a face-down province alone when available. Brash
  Samurai is sent alone when it can honor itself.
- Doji Challenger pulls a future defender only after the current attack is
  already secure, setting up the next conflict.
- Court Games compares glory and the Savvy Politician / Noble Sacrifice setup
  value before choosing honor or dishonor. Savvy then honors the highest-glory
  remaining character, using persistence only as a tie-break.
- Noble Sacrifice spends the least persistent honored body and removes the
  strongest, most persistent dishonored opposing character. Storied Defeat is
  enemy-only and never bows or dishonors the bot's own duel loser.
- Shukujo is saved for Doji Kuwanan and switches conflict type only when the
  other skill axis improves the live margin.
- Above Question and Tattooed Wanderer go to persistent characters, spread as
  singletons; Wanderer is not attached to Tengu Sensei, which already has
  Covert.
- Let Go compares clearing Pacifism, Stolen Breath, Softskin, Pit Trap, Cloud
  the Mind, or Fiery Madness from a valuable friendly character against
  removing an opposing tower attachment. It selects the higher-value removal.

## Validation

- `CraneBaselineTactics`: 13 focused specs, including exact 40/40 fixture,
  public-deck-only Gossip choices, seed-3 fate awareness, typed card-name
  controls for seeds 1/2/5, board-floor replenishment, solo sequencing,
  Shukujo, and shared Let Go targeting.
- The 25 dedicated engine-card spec files present for this exact list run 133
  rules specs with no failures. Gossip's engine specs verify that the chosen
  name blocks events, attachments, conflict characters, and dynasty plays;
  bot specs separately verify that the chosen name comes from the submitted
  opponent deck.
- Deterministic Phoenix Shugenja trace (`rng 20260718`): the untuned board logic
  lost by conquest in round 6 and missed the 3-character late board in 2/4
  conflict starts. The final profile won by conquest in round 7, missed the
  floor in 0/5 conflict starts, averaged 3.2 late characters, and finished with
  four characters and seven fate.
- Interaction audit: 30 games, seeds 1/2/5, every registered opponent; 13,353
  successful bot decisions, zero rejected decisions, zero loops, zero budget
  exhaustion, maximum 15 decisions in one controller tick.
- Real-game utilization audit: 20 seed-1 games against Phoenix Shugenja clicked
  every active card in the deck. Tsuma was the sole zero-click entry because
  its enter-play-honored text is passive; its engine behavior has a dedicated
  card spec. A second 20-game seed-3 audit against Scorpion exercised the
  omniscient Gossip path and the same control/duel package.

The final standardized seed-1 win-rate board (100 games/deck, alternating
seats, seed 1 on both sides) is:

| Challenger | Record vs Crane Baseline | Win rate |
|---|---:|---:|
| Scorpion | 87-13 | 87% |
| Phoenix Shugenja | 64-36 | 64% |
| Dragon | 53-46 (+1) | 53% |
| Dragon Attachments | 51-49 | 51% |
| Lion | 42-58 | 42% |
| Unicorn | 38-62 | 38% |
| Phoenix | 36-64 | 36% |
| Crane Duels | 34-66 | 34% |
| Crab | 22-78 | 22% |

The first new-baseline pass had Phoenix Shugenja at 74-26. Prioritizing
Consumed by Five Fires for fair-seed Gossip naming improved Crane by 10 points,
to the retained 64-36 result. Across all 900 games, challengers fell from
53.8% against the retired Crane precon to 47.4% against this baseline. This is
a measure of the replacement opponent's overall difficulty, not an isolated
same-deck policy comparison.

Re-run the checks with:

```powershell
node tools/selfplay/auditCards.js Crane 20 1 PhoenixShugenja
node tools/selfplay/validateBotInteractions.js --games 1 --seeds 1,2,3 --decks Crane --opponents all
node tools/selfplay/analyzePolicyGame.js --deck Crane --opponent PhoenixShugenja --control fate-aware --candidate fate-aware --opponent-policy fate-aware
```

Changing the standard opponent invalidates old client win-rate and round-robin
sections. The suite id now keeps those retired numbers hidden. Regenerate the
standard seed 1/2/5 records with:

```powershell
node tools/selfplay/winRates.js 100 1 1
node tools/selfplay/winRates.js 100 2 2
node tools/selfplay/winRates.js 100 5 5
node tools/selfplay/botRoundRobin.js --seed 1
node tools/selfplay/botRoundRobin.js --seed 2
node tools/selfplay/botRoundRobin.js --seed 3
```
