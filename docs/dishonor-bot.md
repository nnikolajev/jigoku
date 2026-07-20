# Dishonor / mill bot deck — Scorpion "Poison Mill" v0.6 ([EmeraldDB 914dc4d4](https://www.emeralddb.org/decks/914dc4d4-a63b-4a86-af15-e46ba55361fc))

A deck with a fundamentally different win condition: drive the **opponent to 0
honor** instead of breaking provinces. The bot logic for it lives in its own
module, `server/game/bots/DishonorTactics.ts`, and is wired in as DATA — a
`DishonorProfile` carried on the deck's `DeckProfile` — so no other deck's
behavior changes (the fine-tuned Unicorn default is untouched).

## How the deck wins

- **Bid low on later draw dials.** The shared `DrawBidTactics` dishonor profile
  forces bid 1 after the round-1 bid of 5; a value-bidding opponent pays the bid
  difference in honor every round. Duels use
  the shared `DuelBidTactics` matrix with a `dishonor` objective: it presses a
  low-honor opponent, protects its own last honor, and does not throw away a
  duel that is cheap to win.
- **Air ring = honor drain.** The ring choice is biased to air and the air
  resolution always takes 1 honor from the opponent instead of gaining 2.
- **Dishonor enemy characters** with the fire ring — a dishonored character
  fights worse and bleeds its controller another honor when it leaves play.
- **Mill the opponent's conflict deck**: Deserted Shrine (10 cards on reveal),
  Licensed Quarter (1 per won conflict, unlimited), Master Whisperer
  (discard 3 / draw 3), Midnight Prowler, Oracle of Stone, Softskin. An
  emptied conflict deck costs 5 honor on the reshuffle.
- **Bayushi Shoju is the priority dynasty engine.** His forced reaction at the
  start of every conflict phase makes both players draw 2 and lose 1 honor.
  That directly advances dishonor and forces the opponent through its conflict
  deck faster. All bot seeds buy Shoju before generic bodies when they can pay
  his 5 cost plus 2 additional fate. With less fate, normal dynasty logic takes
  over instead of forcing a short-lived copy. A second copy is not bought while
  the unique Shoju is already in play. He is important, but not treated as a tower.
- **Live in the low-honor band (3..6 own honor).** Shadow Stalker, Yogo
  Outcast, Compromised Secrets and friends turn on at 6-or-fewer / while less
  honorable. City of the Open Hand climbs back toward the band; honor-cost
  abilities (Thunder Guard Elite, Shosuro Hametsu, Moto Eviscerator) stop at
  the floor. `Duty` cancels losing the last honor.
- **Debuff, don't race.** Control attachments go on the opponent's best body:
  Pacifism / Stolen Breath (locked out of military / political conflicts —
  cannot be played during a conflict, so the bot plays them in the
  conflict-phase action window BEFORE declaring), Fiery Madness (-2/-2,
  tutored by Shosuro Hametsu), Softskin, Tainted Koku, Compromised Secrets.
  Pacifism, Stolen Breath, and Softskin never repeat on the same bearer: extra
  copies spread to the best character missing that printed attachment, or stay
  in hand when every enemy already has one. Pacifism prefers military-focused
  enemies and Stolen Breath prefers political-focused enemies. A capped 30%
  balance band treats close dual stats as equally valid for both locks (4/3 is
  within 1; 10/7 is within the maximum tolerance of 3), so a strong balanced
  character may legally receive both different attachments. If no matching or
  balanced enemy exists, the bot keeps that conflict lock in hand.
  Make an Opening's -X/-X uses the honor-dial difference — our permanent low
  bids make X large against a value bidder.
- Defense stays generic `prevent-break`: losing a conflict is fine as long as
  the province holds; the honor engine wins on its own clock.
- **Night Raid goes under the stronghold** (`strongholdProvinceId` DeckProfile
  knob, applied by the `scorpion-poison-mill` override): the stronghold
  province is only attackable after 3 others break, so the opponent's final
  all-in push reveals it and discards X cards from their hand (X = attackers).
  Measured N=40 with it: seed 1 27-13, legacy omniscient 28-12
  (before renumbering; top of the band).
- **Province reactions fire first** in every trigger window (generic policy
  behavior): Deserted Shrine's 10-card mill (aimed at the opponent's conflict
  deck by the dishonor select-prompt handler), Night Raid, Before the Throne,
  Vassal Fields' fate drain at the attacked province.
- **Key events verified firing** (10-game trace, successful plays): Kirei-ko
  48x (bow the enemy character after it uses an ability, priority 8), Forgery
  23x (cancel an enemy event while less honorable, priority 7), Duty 15x
  (cancel losing the last honor, priority 10 — the low-honor safety net). All
  three ride the hinted reaction/interrupt path (priority >= 6).

## Where the logic lives (design)

| Piece | File | What it does |
|---|---|---|
| `DishonorProfile` + `DISHONOR_DEFAULTS` | `DishonorTactics.ts` | every tuning knob (bids, honor floor/ceiling, air-ring bonus, pre-conflict fate gate, important characters) |
| `DishonorTactics` class | `DishonorTactics.ts` | dishonor decisions plus `pickImportantDynastyCharacter` and `desiredAdditionalFate` for Shoju |
| `dishonor` strategy flag | `CardPlaybook.ts` | derived from `DISHONOR_MARKERS` (keystone: City of the Open Hand) |
| `dishonor?: DishonorProfile` knob | `DeckProfiles.ts` | attached by `profileFromStrategy` only when the flag is set |
| policy hooks | `JigokuBotPolicy.ts` | every branch is gated on the profile carrying the tactics: honor-bid override, deck/player select prompts, air-ring score bonus, fire/air resolution preference, stronghold honor gate, pre-conflict attachment plays, negative-stat debuff attachments allowed enemy-side |
| per-card knowledge | `CardPlaybook.ts` Scorpion section | ~25 entries: control attachments (`preConflict` for Pacifism/Stolen Breath), honor-cost gates (`ctx.canPayHonor`), mill reactions |

Pattern for future decks with a new playstyle: put the knobs + decisions in
their own tactics module, hang its profile off `DeckProfile`, and gate every
policy hook on the profile's presence — no `if(deckX)` in shared code.

## Generic improvements shipped with this deck

- Enemy-aimed attachments (`targetSide: 'enemy'` playbook hint) now attach to
  the opponent's best character on the axis the attachment shuts down, instead
  of falling into the own-side attachment heuristic when both sides are legal.
- Hand cards with NEGATIVE printed bonuses (debuff attachments like Fiery
  Madness) are playable when hinted enemy-side; before, anything with
  contribution <= 0 was skipped as dead weight.

Both are inert unless a card carries an enemy-side playbook hint.

## Results vs the Crane precon (self-play, seats alternate)

Current comparison uses N=100 per seed, same-seed Crane, alternating seats:

| Bot seed | old v0.5 (Insolent Rival) | v0.6 Shoju, untuned | v0.6 + Shoju priority |
|---:|---:|---:|---:|
| 1 fate-aware | 75% | 93% | 94% |
| 2 old heuristic | 94% | 92% | 99% |
| legacy omniscient (before renumbering) | 78% | 91% | 95% |

The deck swap is the large gain: 247/300 to 276/300 (+9.7 points). The final
standardized client sweep was 288/300 (94%, 99%, 95%). Larger N=300 validation
of the final persistence-gated policy produced 278/300 (92.7%) for seed 1 and
272/300 (90.7%) for seed 3. Shoju therefore restores both fate-aware bots to
the old 90% Scorpion band; seed 2 was already there.

Shoju's reaction is a `forcedReaction` in the game engine. It resolves without
bot input and has no `inPlayAction` playbook hint. The 60-game tuning audit plus
a 30-game final-policy audit covered every opponent on seeds 1, 2, and 3 and
recorded 26,303 clicks with zero rejected clicks, cycles, or decision-budget
exhaustions; Shoju clicks were normal purchases and conflict commits.

### Historical tuning results

| | win rate | sample |
|---|---|---|
| Scorpion seed 1 (heuristic) | **~62%** (99-61) | 4×N=40 pooled; individual runs ranged 20-20 to 32-8 |
| Scorpion legacy omniscient (before renumbering) | **~67%** (54-26) | 2×N=40 pooled |
| seed 1 after the `abilityValue` fix | **31-9 (77.5%)** | N=40; Softskin (82 plays) and Compromised Secrets (77) had NEVER fired before |

The `abilityValue` fix (shipped with the Lion deck): Softskin and Compromised
Secrets are 0/0 attachments, and the conflict window's zero-contribution
filter silently kept them in hand for the deck's whole first tuning cycle.
The playbook flag marks their granted ability as the point; both now land on
the opponent's best character every game and the win rate jumped a full
config band. (The same flag was tried on Unicorn's Spyglass and measured
NEGATIVE — see the playbook comment — so it is per-card, not blanket.)

Every Scorpion win is by **dishonor** (opponent at 0 honor), typically round
5-6. Every Crane win is by conquest — racing the provinces before the honor
clock runs out. Variance between N=40 runs is large (±15%); treat single runs
as noise.

Tuning attempts, measured:

- **Marauding Oni floor gate** (skip declaring it while honor is at the
  floor, `declareCostsHonor` playbook flag): kept — it closes the
  self-dishonor loss mode (games lost at 0 own honor) at zero cost elsewhere.
- **Keeping 2 bodies home** (`breakable-or-pressure` + `attackKeepHome: 2`):
  REVERTED — 60% vs the 62-67% band with full pressure. The honor engine
  feeds on won and unopposed conflicts (Licensed Quarter mill, unopposed
  drain), so turtling starves it; the generic all-but-one commit stays.

## How to run

```
cd jigoku && npx tsc
node tools/selfplay/matchScorpion.js <games> <1|2|5> [--trace]
node tools/selfplay/winRates.js 100 <seed> <same-seed>
node tools/selfplay/validateBotInteractions.js --decks Scorpion --opponents all --seeds 1,2,3,4
```

`--trace` prints the Scorpion seat's decision-reason histogram. Unit tests:
`npx jasmine test/server/bots/dishonortactics.spec.js`.
