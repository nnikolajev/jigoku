# Dragon "Monks In Da High House" bot deck

EmeraldDB deck: `4fb91e58-9c3b-47e1-983e-133e0a4d9254` (Lion splash).

This is a Togashi Mitsu card-count engine. It builds durable monk towers, then
plays an exact number of cards in selected conflicts to unlock High House of
Light, Togashi Mitsu, Togashi Ichi, and Teacher of Empty Thought.

## Exact card-count plan

The bot reads `cardsPlayedThisConflict` before every play. That engine value
already includes Shintao Monastery's passive `+1 card played`, once for every
Monastery in play.

Live thresholds are:

- Teacher of Empty Thought: 3 own cards.
- High House of Light: 5 own cards while an own Monk participates.
- Togashi Mitsu: 5 own cards while Mitsu participates.
- Togashi Ichi: 10 cards total between both players, only while Ichi attacks a
  non-stronghold province.

Before starting, the policy counts cards that are currently playable and pass
their playbook gates. It chooses the highest reachable live threshold. If the
Ichi threshold is not reachable but a 5- or 3-card payoff is, it falls back to
that exact lower threshold. If no live threshold is reachable, it preserves
the hand for the next conflict.

At the threshold, board abilities are activated first. When all live payoff
abilities are exhausted, the bot passes instead of playing a sixth, seventh,
or later unnecessary card. High House is never bowed early for its small
skill-only effect.

Centipede Tattoo is the save-plan exception: in a losing non-stronghold
conflict, it may be attached to a ready participant even when the threshold is
unreachable, preserving that character for another conflict.

## Conflict card ordering

For a 5+ card plan the preferred order is:

1. Togashi Acolyte as an attachment, so every later card grants its bonus.
2. Hurricane Punch, gaining skill and drawing a replacement.
3. Void Fist after the count reaches 2, targeting the strongest legal enemy
   participant.
4. Swell of Seafoam after another Kiho, gaining its honor rider.
5. Iron Foundations Stance after another Kiho, gaining its draw rider.

If no enabling Kiho is available yet, ordinary playable cards are used before
Swell and Iron so Void Fist can become legal. Once the exact threshold is met,
remaining cards stay in hand.

## Card-specific steering

- Way of the Dragon targets, in order: Togashi Mitsu, Tranquil Philosopher,
  Teacher of Empty Thought, Kitsuki Investigator. The bot uses the granted
  second activation; Teacher's targetless second use has an explicit guard.
- Mitsu receives 4 additional fate when the prompt allows it. Other printed
  cost 3-4 characters receive 2.
- Cycle of Rebirth targets an own weak province card and preserves Mitsu,
  Ichi, Tadakatsu, Teacher, Tranquil Philosopher, and Kitsuki Investigator.
- Ancient Master prefers Togashi Acolyte, then Hurricane Punch, Void Fist,
  Swell, Iron Foundations Stance, and the remaining Tattoos.
- Let Go and Miya Mystic remove an attachment from the strongest enemy tower.
- Buff attachments and helpful effects target own characters. Harmful effects
  target enemy characters. Void Fist never deliberately targets an own Monk.
- Court Games compares eligible glory: honor the own high-glory participant,
  or dishonor the enemy when its glory is higher.
- Favorable Ground reinforces a losing defense normally. For this Dragon
  profile only, it instead rescues the strongest ready participant from a
  losing non-stronghold conflict when another conflict remains. Other decks
  retain the old reinforcement behavior.
- Dual-mode Ancient Master, Tattooed Wanderer, and Togashi Acolyte are played
  as attachments when that mode is offered.
- In Service to My Lord can be played from hand or the conflict discard and
  readies a key Dragon tower.

## Other deck behavior

- Keeper Initiate in the dynasty discard adds a large Void-ring priority.
- Togashi Tadakatsu gives the attacking opponent the lowest-valued legal ring.
- Sacred Sanctuary is placed under the stronghold and readies a bowed Monk.
- Round 1 honor bid is 5, later draw bids are 2, and duel bids are 2 unless
  own honor is near the loss floor.
- Defend Your Honor is interrupt-only and is never clicked proactively.

## Verification, 2026-07-14

Self-play alternated seats against the Crane precon, 100 games, seed 1.

| Run | Result | Decided win rate | Avg rounds |
| --- | ---: | ---: | ---: |
| Dragon baseline | 55-45 | 55.0% | 7.7 |
| Dragon exact-threshold logic | 65-34, 1 undecided | 65.7% | 7.8 |
| Phoenix control baseline | 69-30, 1 undecided | 69.7% | 6.2 |
| Phoenix after Dragon-scoped Favorable Ground | 69-30, 1 undecided | 69.7% | 6.6 |

An initial generic Favorable Ground retreat rule reduced the Phoenix control to
57-43. That version was rejected. Retreat is now Dragon-only; the final Phoenix
control exactly matches its baseline result.

Focused bot suite: 140 specs passed. TypeScript compilation also passed.
