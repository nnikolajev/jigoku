# Phoenix "Shugenja" bot deck (EmeraldDB b260d778)

This profile implements the explicitly requested Emerald/Standard Phoenix deck
[b260d778-0016-4d70-b1f9-5180daf340fc](https://www.emeralddb.org/decks/b260d778-0016-4d70-b1f9-5180daf340fc).
It is an intentional exception to the project's Imperial-first migration scope;
the card/rules engine remains authoritative when a heuristic conflicts with a
forced rule or legal timing.

## Game plan

- **Manipulate rings.** Conflict declaration still takes the largest fate pile
  first, with live Water/Air/Void bonuses for Prodigy of the Waves, Asako
  Tsuki, Ethereal Dreamer, Feral Ningyo, Adept of the Waves, Kudaka, and Isawa
  Ujina. Other claim effects now combine fate and immediate payoff instead of
  using one global order. Offerings to the Kami values each ring's fate plus
  live character and ring-effect value. Asako Togama takes the largest fate
  pile first, then uses those same live payoffs to break ties; a home Togama is
  no longer treated as an available action until he participates. Ujina's Void
  bonus requires a legal zero-fate enemy target.
- **Recycle Spell Actions.** Kyūden Isawa discards the weakest Spell while
  protecting Display of Power, Consumed by Five Fires, and The Path of Man.
  It recasts only Spell Actions legal in the current action window; reaction
  events such as Display of Power and Earth Becomes Sky cannot legally be
  played by the stronghold Action and remain available for their reaction
  windows.
- **Trade provinces selectively.** With Display of Power in hand and two fate
  available, a normal province is left undefended when the contested ring turns
  on a live Phoenix payoff, or when the available defenders cannot win anyway.
  A winnable conflict on an irrelevant ring is defended normally. The reaction
  cancels the enemy ring effect, resolves it for Phoenix, and claims the ring.
  Stronghold defense is never intentionally conceded.
- **Build practical towers.** Ready, Water, Clarity of Purpose, Supernatural
  Storm, and Adept of the Waves effects prefer Isawa Tadaka, Fushichō, Shiba
  Tsukune, and Kudaka. This list has few attachments, so these printed-stat
  bodies are its tower equivalents. Fushichō is bought only when a printed
  five-cost character (normally Shiba Tsukune) is already in the dynasty
  discard pile for his leaving-play interrupt.
- **Use Clarity on live participants.** Clarity of Purpose never falls back to
  a character at home. A hand copy can still protect a military participant
  from opposing bow effects, while an already-won political conflict remains
  an active plan because Clarity also prevents resolution bowing. Kyūden Isawa
  recasts Clarity only for that full political payoff: a ready participant must
  exist, since the recast also spends another Spell from hand.
- **Bank for Five Fires.** When a Shugenja is in play and enemy characters have
  at least five actionable fate, Consumed by Five Fires in hand (or recyclable
  through ready Kyūden) makes the dynasty phase preserve five fate. The bot
  plays it proactively in any conflict-phase action window, targets the largest
  useful fate stack, and removes the maximum legal fate. Characters already
  neutralized by Pacifism or Stolen Breath are skipped and their fate does not
  count toward the five-fate threshold.
- **Disguise Tadaka.** With Tadaka in hand, the dynasty plan prefers a cheap
  non-unique Shugenja and puts two fate on it when seven fate can fund the whole
  setup. At the next legal conflict-phase action window, Tadaka replaces that
  prepared body, enters ready, and inherits its fate, attachments, and tokens.
  Disguise targeting values inherited fate first, then attachments/tokens, and
  prefers the cheaper body on ties. Tadaka remains a top-priority tower after
  entering play. His Action removes exactly one weakest dynasty-discard
  character to cost the opponent one random hand card.
- **Control the opponent.** Pacifism and Stolen Breath are played before
  conflicts; Kirei-ko, Earth Becomes Sky, and other harmful effects target
  enemy characters. Extra copies spread across characters instead of repeating
  the same printed attachment on one bearer. Pacifism and Stolen Breath remain
  independent locks: each printed attachment avoids duplicating itself, while
  the other lock may legally use the same character. Pacifism prefers military
  specialists and Stolen Breath political specialists. A capped 30% balance
  band (4/3 allows 1; 10/7 reaches the cap of 3) lets both different locks land
  on one strong, balanced character. Meddling Mediator takes enemy fate first,
  then honor. A lock stays in hand when every enemy has the opposite focus.
  Shiba Yōjimbō always protects an own Shugenja when its interrupt is offered.

Helpful target steering always chooses Phoenix characters; harmful target
steering chooses opponents. Isawa Ujina is a forced reaction: it removes the
strongest legal enemy whenever possible. If the engine offers only Phoenix
characters, it must remove the weakest own legal character instead of looping
on Cancel.

## Implementation

- `ShugenjaTactics.ts` owns ring bonuses, practical towers, Kyūden legality,
  Tadaka setup/Disguised target ranking, Fushichō gating, spell/discard
  ordering, Display defense, and the conditional five-fate reserve. Its
  `offeringsFateValue`, `togamaFateValue`, `immediateRingPayoffValue`, and
  `displayRingMinimum` profile fields are injectable tuning knobs.
- `CardPlaybook.ts` contains the active/reaction metadata for the deck cards.
- `DeckProfiles.ts` derives the sub-profile from Kyūden Isawa and parks Vassal
  Fields under the stronghold.
- `phoenix-shugenja-decklist.json` and `phoenix-shugenja-cards.json` are the
  exact 1 stronghold / 1 role / 5 province / 40 dynasty / 40 conflict fixture.
- `matchPhoenixShugenja.js` alternates seats against the Crane baseline;
  `auditCards.js phoenix-shugenja` reports every successful card click.

## Verification (2026-07-15)

- TypeScript typecheck: pass.
- Focused Phoenix Shugenja tactics: 22 specs, 0 failures.
- Full bot unit folder: 273 specs, 0 failures. This includes unchanged
  Pacifism/Stolen Breath spreading and saturation regressions, plus exhaustive
  seed-1 execution coverage for every specialized tactic method.
- Deterministic replay (`rng-seed 20260716`) kept the Phoenix conquest win and
  removed seven invalid ring clicks: five during Kyuden Isawa discard prompts
  and two during Assassination target prompts. In the same replay, Offerings
  chose zero-fate Water over one-fate Air because Water immediately bowed an
  18-skill attacker.
- Independent alternating-seat N=100 samples against seed-1 Crane moved from
  the retained pre-change baseline of **64 wins** (2 undecided), to **69 wins**
  after ring orchestration (1 undecided), then **72 wins** after the
  participating-only Togama correction (1 undecided). These are unpaired
  shuffle samples, so treat the +8 points as positive evidence rather than an
  exact effect size.
- Live utilization audit: every active card fires. The Imperial Palace is the
  only zero-click card because its Imperial Favor modifier is passive.
- Ten-game deterministic card audit: 10 prepared-Tadaka play starts and 12
  legal non-unique Disguised base selections; 5 Fushichō purchases and 5 Shiba
  Tsukune resurrection selections. Asako Tsuki is unique and is excluded from
  the Disguised base map.
- Earlier instrumented Crane baseline (2026-07-13), seed 1 heuristic, seats
  alternating, pooled N=60:
  **Phoenix Shugenja 38–22 Crane (63.3%)**, average 6.6 rounds, all games
  decided. Phoenix wins: 25 conquest / 13 dishonor; Crane wins: 9 conquest /
  13 dishonor.

Commands:

```powershell
node tools/selfplay/matchPhoenixShugenja.js 20 1
node tools/selfplay/auditCards.js phoenix-shugenja 10
npx jasmine --config=jasmine-bots.json
```
