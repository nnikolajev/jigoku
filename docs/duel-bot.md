# Upgraded Crane Duels bot deck (EmeraldDB e2e443b5)

The shared duel package follows the human tower plan: establish durable
characters from **Tengu Sensei, Doji Kuwanan, Kakita Kaezin, Kakita
Toshimoko, and Kakita Yoshi**, honor them, and put duel tools on them. The
upgraded Crane Duels list and current Crane Baseline both use this package;
the baseline's mixed honor/control behavior is in `crane-baseline-bot.md`.

## Why the old policy underperformed

`_deckWorker.js` is only the self-play loader/runner; it contains no deck
decisions. The decisions live in `JigokuBotPolicy`, `CardPlaybook`, and
`DuelTactics`. Before this pass, the duel module steered duel prompts but did
not actually implement the deck's economic plan:

- dynasty deployment still bought the cheapest affordable faceup character;
- generic fate placement normally gave a character only 0-2 extra fate;
- regroup could discard one of the four desired towers;
- attachment selection did not count the two Restricted slots;
- Shukujo could be attached to a non-Champion, losing its granted Action.

This produced a wide, short-lived board instead of the persistent duel engine
the deck is built around. The comparison deck also shares the same dynasty
character roster and most of the conflict deck, so CraneDuels has no automatic
large matchup advantage merely from using the linked list.

## How the bot plays it

`duelist` strategy flag → `DuelProfile` → `DuelTactics`, same pattern as the
other tactics modules. **The flag keys on Tsuma alone**. The retired sparring
Crane precon lacks Tsuma and stays generic; the current Crane Baseline contains
Tsuma and deliberately receives the shared duel package.

- **Shared duel bid matrix**: every deck and bot seed uses `DuelBidTactics`.
  It evaluates every legal bot bid against every opponent bid (normally the
  full 5x5 set), using exact live duel skills, both honor pools, round number,
  tie-winning effects, and currently unspent Iaijutsu Master reactions. It
  records uniform win percentage for diagnostics, then models the opponent's
  likely response and scores duel result, honor transfer, and immediate
  0/25-honor game endings. Near-zero win positions force bid 1; comfortable
  skill leads use the cheapest useful bid; close positions mix bids instead
  of exposing a fixed answer.
- **Deck-injectable risk**: `DeckProfile.duelBidding` carries every weight.
  Duel-centric Crane raises duel-win value and uses the `honor` objective;
  Scorpion uses `dishonor`; Lion and Phoenix honor builds also use `honor`.
  The class and decision flow remain shared.
- **Opponent model**: deck lists are public, so the controller resolves the
  opponent's duel-bid profile without inspecting its current hand. The model
  therefore understands that honor and dishonor decks value transfers
  differently.
- **Duel type metadata** (`duelAxes`): every supported duel source is explicitly
  mapped to military or political. The prompt controller also reads the engine's
  `DuelAction` type for actionless and dependent selectors, so an unknown prompt
  does not silently turn a political duel into a military duel.
- **Injectable duel starts** (`duelStartRules`): each source records who chooses
  the bot's challenger, who chooses the opponent's character, and whether the
  duel is forced. Optional duels start only when the relevant bot skill is
  strictly higher than the strongest legal opponent; equality is acceptable
  when the bot has an **unspent** Iaijutsu Master. The engine's default
  once-per-round printed-ability limit is read directly, so a Master used
  earlier in the round is no longer projected as a +1 option. Arrogant Kakita
  remains forced and is never suppressed by this check.
- **Duel target steering**: when the bot chooses its own challenger it sends its
  strongest character on the correct axis. When it chooses the opposing target,
  it selects the strongest character that challenger can beat, maximizing the
  value of duel debuffs. If an already-started or forced duel cannot be won, it
  falls back to the weakest opposing target. Opponent-initiated duels are
  contested when winnable; otherwise the bot protects its strong characters by
  choosing its weakest, least-invested legal character and bidding low.
- **Prospective duel skill** (`duelSkillBonuses`): conditional bonuses that are
  not present in the pre-duel player summary are projected while selecting a
  challenger. Kakita Blade and Kakita Favorite each contribute +2 political for
  these decisions.
- **Tower deployment**: buy a preferred character only when it can be funded;
  ordinary three-cost duelists seek at least 3 fate, while a normal seven-fate
  opening may establish a five-cost champion with 2. Retain an unfunded tower
  through regroup and keep at most two cheap support characters. Crane
  Baseline adds a round-3 board floor so these caps cannot strand it on two
  bodies.
- **Attachment stacking**: Duelist Training and the deck's other duel/stat
  attachments land on the four towers. Restricted attachments are spread to
  characters with fewer occupied slots and never exceed two. **Shukujo only
  attaches to Doji Kuwanan**. Invalid tower attachments are skipped before
  their target prompt, preventing the old cancel/retry loop.
- **Honor plan**: while a tower is unhonored, Fire gains enough ring priority
  to beat the ordinary Earth/Void ordering (rings carrying 2+ fate still win
  the global economic priority). Way of the Crane honors the eligible
  highest-glory character; tower persistence breaks equal-glory ties.
- **Vassal Fields under the stronghold** (`crane-duel-vassal-fields`
  override): drains 1 attacker fate every conflict fought there.
- Tsuma (characters enter honored), Magistrate Station (ready an honored
  character — target falls through to the strongest bowed), Kyuden Kakita's
  honor-the-duelist reaction, Daidoji Nerishma's un-facedown action, Tengu
  Sensei's covert+lockout double, Toshimoko's conflict-nullifying interrupt,
  Cunning Negotiator's steal-the-province-action duel: all playbook entries,
  all verified firing.
- **Storied Defeat safety**: it requires an enemy character that lost a duel in
  the current conflict. The live preflight rejects an own-only target set before
  costs or follow-up prompts are paid, so the bot never bows or dishonors its
  own duel loser and does not enter a cancel/retry loop.

## Duel matrix model and tuning

`JigokuBotController.currentDuelBidContext()` reads both sides through the
engine's `Duel.getSkillStatistic()`. This matters for military, political,
glory, custom, and multi-target duels: policy code does not reconstruct duel
skill from printed card data. The same context includes live honor, round,
tie-win effects, and Iaijutsu readiness. The controller reads each Master's
reaction limit; attachment presence alone is insufficient.

For each legal `(bot bid, opponent bid)` pair, `DuelBidTactics` calculates:

1. effective 0-6 bids after any available Iaijutsu adjustment;
2. duel win, draw, or loss from skill plus effective bid;
3. honor transferred from the higher bidder to the lower bidder;
4. resulting honor totals and immediate dishonor/honor game result;
5. round-scaled duel value, honor-resource value, and honor-cliff penalties.

The report retains the simple uniform 5x5 win rate. Live play additionally
builds an opponent bid distribution from the opponent's public deck profile.
The bot has three decision modes:

1. `near-zero-win` forces the minimum legal bid when no bid has a meaningful
   modeled chance to win;
2. `modeled-utility` uses the narrow `mixedUtilityWindow` for decided duels and
   honor-cliff positions;
3. `mind-game` uses a wider, softer mix only when the best modeled duel-win
   chance lies between `mindGameMinimumWinProbability` and
   `mindGameMaximumWinProbability`.

This makes close duels difficult to exploit without making guaranteed winners
waste honor or low-honor players gamble. A seeded roll plus stable position
hash makes the choice reproducible without making same-seed mirror players
always choose the same bid.

All knobs are on `DuelBidProfile`:

| Group | Knobs |
|---|---|
| Legal/result rules | `minimumBid`, `maximumBid`, `honorVictoryThreshold`, `dishonorDefeatThreshold`, `iaijutsuAdjustment` |
| Duel value | `duelWinUtility`, `duelLossUtility`, `duelDrawUtility`, `earlyRoundWinBonus`, `roundWinDecay`, `minimumRoundWinMultiplier` |
| Honor risk | `lowHonorReserve`, `honorDangerWindow`, `honorSwingUtility`, `roundHonorRiskGrowth`, `lowHonorRiskUtility`, `honorRaceUtility`, `opponentLowHonorUtility`, `terminalUtility`, `objective` |
| Prediction/mixing | `opponentModelSharpness`, `strategySharpness`, `mixedUtilityWindow`, `mindGameMinimumWinProbability`, `mindGameMaximumWinProbability`, `mindGameStrategySharpness`, `mindGameUtilityWindow`, `nearZeroWinProbability` |
| Participant choice | `participantContestWinProbability` |

`DeckProfiles.ts` deep-merges partial `duelBidding` overrides, so a deck can
change risk weights or objective without replacing prompt flow. Generic,
generic, fate-aware, and board-aware seeds all route through the same class.
Optional omniscience gets no hidden-hand advantage here; duel participants,
honor, deck identity, and
spent public abilities are already public information.

True Strike Kenjutsu is a special source but not a second bid system. Before
activation, Lion's tactics module receives exact per-character
`getBaseMilitarySkill()` values and requires its bearer to beat every ready
opposing participant by the configured base-skill margin. Gained-ability hints
retain both the printed bearer id and the attachment-origin id, so the policy
can identify the Action. After initiation, True Strike supplies
`getBaseMilitarySkill()` as the live duel statistic; the controller passes that
value through `Duel.getSkillStatistic()` into this same matrix. Buffs,
attachments, and honor/dishonor therefore cannot leak into this duel's skill.

Use `tools/selfplay/analyzeDuelBids.js` before changing weights. Its curated
set covers equal skill, skill deficits, safe and endangered honor pools,
early/late rounds, honor victory, dishonor pressure, and both Master sides.
`--grid` runs 1,200 combinations and reports how many positions enter each
decision mode. `--matrix` prints every cell and per-bid uniform/modeled
probability, expected honor, utility, and mixed-strategy share. The recommended
bid is the highest-utility pure action; `mix E` describes what live seeded play
actually averages, so both columns must be checked.

Default-grid acceptance results after tuning:

- 1,200 positions: 903 modeled-utility, 222 mind-game, 75 forced-low;
- recommended bid 1 in 73.1% of positions, mainly decided or honor-saving
  states rather than indiscriminate passivity;
- equal skill, honor 11-11, round 1: pure recommendation 5, mixed expected bid
  4.09 instead of the exploitable fixed 5.00;
- skill 10-4: recommendation 1 and only bids 1-2 remain in the narrow mix;
- own honor 3: deterministic bid 1; hopeless 1-7 skill: deterministic bid 1.

## Shared duel-bid benchmark (2026-07-19)

All runs used seed 1, alternating seats. `winRates` used 100 games per
challenger against Crane Baseline. Round robin used 25 games per matchup (225
scheduled games per deck). These samples measure regression risk, not a claim
that a one- or two-point change is statistically real.

| Deck | Before matrix vs Crane | Strict matrix | Tuned mind-game |
|---|---:|---:|---:|
| Crab | 23% | 26% | 26% |
| Crane Duels | 39% | 32% | 38% |
| Dragon | 37% | 50% | 44% |
| Dragon Attachments | 67% | 62% | 61% |
| Lion | 45% | 58% | 49% |
| Phoenix | 41% | 42% | 39% |
| Phoenix Shugenja | 79% | 76% | 83% |
| Scorpion | 85% | 78% | 81% |
| Unicorn | 52% | 41% | 43% |

The scheduled-game challenger totals were 468, 465, and 464 respectively, so
the shared redesign is performance-neutral overall against Crane while fixing
the exploitable fixed bids. The tuned layer recovered Crane Duels from 32% to
38% and Phoenix Shugenja from 76% to 83% compared with the strict matrix.

| Deck | Before matrix RR | Strict matrix RR | Tuned mind-game RR |
|---|---:|---:|---:|
| Crab | 32.0% | 27.1% | 30.7% |
| Crane | 50.9% | 51.8% | 46.7% |
| Crane Duels | 33.9% | 37.3% | 42.2% |
| Dragon | 50.0% | 43.9% | 36.2% |
| Dragon Attachments | 44.0% | 48.4% | 44.9% |
| Lion | 54.2% | 56.0% | 63.6% |
| Phoenix | 52.4% | 56.0% | 58.2% |
| Phoenix Shugenja | 51.3% | 51.8% | 57.6% |
| Scorpion | 81.8% | 76.0% | 79.1% |
| Unicorn | 49.3% | 51.6% | 40.9% |

The final round robin strengthens the duel deck and honor/dishonor profiles.
Dragon and Unicorn declines were spread across non-Crane matchups rather than
isolated to duel interactions; at N=25 those rows moved by 5-8 games between
runs. No generic or deck-specific duel override was added for that noise.

## Current Crane Baseline

The standardized opponent is no longer the old sparring precon. It is the
dedicated 4736f7c0 Crane Baseline list, which reuses these duel rules and adds
public-deck-aware Gossip, Let Go control, Noble Sacrifice, solo-character
sequencing, and a late board floor. See `crane-baseline-bot.md`. Historical
results below were measured against the older opponent and are retained only
as the tuning record for the upgraded Crane Duels list.

## Results (alternating seats, N=40 each, vs the now-smarter baseline Crane)

These fixed-bid measurements predate `DuelBidTactics`. They are historical
evidence for removing the fixed bid, not the current policy's benchmark.

| Config | Result |
|--------|--------|
| duelBid 3 | seed 1: 15-23 (+2 stalls), Crane honor wins 6; legacy omniscient: 13-27, honor wins 6 |
| duelBid 2 (old policy) | seed 1: 18-22 + 16-24 (pooled 42.5%), legacy omniscient: 18-22 (45%); honor leak closed (6→2) |
| tower policy (final, four independent N=20 batches) | 11-9, 9-11, 10-10, 9-11; pooled **39-41 (48.75%)** |
| forced Shukujo switching experiment (rejected) | pooled 29-51 (36.25%); switching without full conflict forecasting helped the opponent too often |

The matchup is nearly a true mirror (the same dynasty characters, roughly 41
shared cards, and the same global card playbook). The tower change moved the
observed result from 42.5-45% to 48.75%, but 80 games is not enough evidence
that the true rate is above 50%. The six swapped provinces/conflict cards, seat
order, and self-play variance still matter. Utilization audit: every card
fires; zero-clicks list was empty on the first audit pass.
