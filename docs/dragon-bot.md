# Dragon "Monks In Da High House" bot deck (EmeraldDB 4fb91e58, Lion splash)

A Togashi Mitsu card engine: cheap monks flood conflicts, cheap cards are
played in VOLUME during his conflicts, and the cards-played payoffs convert
the volume into extra ring resolutions, draws, and free breaks.

## How the bot plays it

`monk` strategy flag (MONK_MARKERS / the High House of Light stronghold) →
`DragonProfile` sub-profile → `DragonTactics` helpers, all policy hooks gated
on its presence (pattern shared with Scorpion/Lion/Phoenix).

- **Card volume**: while a cards-played payoff character participates
  (Togashi Mitsu 5+ → ring resolve, Teacher of Empty Thought 3+ → draw,
  Togashi Ichi 10+ attacking → auto-break), the conflict window keeps
  playing cards past the "already winning/lost" pass gates
  (`cardEngineParticipating`). Mitsu / the stronghold / Teacher are clicked
  every window — the engine rejects them until the card count is reached,
  and each played card changes the prompt signature so the clicks retry.
- **Void recursion**: Keeper Initiate returns from the dynasty discard when
  void is claimed; each copy waiting there adds +20 to the void ring's score.
  Revered Bonshō stacks fate on rings, and the generic fate-pile priority
  (1000+) chases the stacked ring automatically.
- **Togashi Tadakatsu**: conflicts declared against him let US pick the
  element — the policy hands the attacker the WORST-scored ring
  (`dragon-worst-ring-for-attacker`).
- **Dual-mode monks** (Ancient Master, Tattooed Wanderer, Togashi Acolyte):
  the Play menu picks "as an attachment" whenever offered.
- **In Service to My Lord** (Lion splash): plays from hand AND the conflict
  discard (the playable pool now includes `conflictDiscardPile` cards with
  `isPlayableByMe` — engine-verified, so it is safe for every deck), readying
  Mitsu; the target steering bows the weakest ready non-unique.
- **Dynasty events** (A Season of War, Cycle of Rebirth): the dynasty window
  now plays faceup dynasty EVENTS from provinces, not just characters.
- **Sacred Sanctuary** under the stronghold (`dragon-sacred-sanctuary`
  override); its ready-a-monk reaction is steered to a BOWED monk.
- **Way of the Dragon / Finger of Jade** attach to Mitsu first
  (`keyCharacters` ranking).
- **Bids**: round 1 bids 5, then 2 — the deck draws through its own engine
  (Imperial Storehouse, Hurricane Punch, Teacher, Ancient Master) and the
  dial difference pays honor in; duels bid 2.
- `attackCommitment: 'all'` — the payoffs count the cards played by
  PARTICIPANTS, so every cheap body goes in.

## Bugs found by the utilization audit

- **Defend Your Honor was clicked 722×/40 games as a proactive play** — it
  is an interrupt; each activation ran a duel whose bids bled the deck into
  dishonor losses (Crane dishonor won 40% of games). `shouldPlay: () =>
  false` blocks the hand-play; the interrupt path (which ignores shouldPlay)
  still fires it.
- **In Service to My Lord never played** — its gate checked the LION unique
  ids; the Dragon key monks were added to the list.

## Results vs the Crane precon (alternating seats, N=40 each)

| Config | Result |
|--------|--------|
| First cut | 10-30 / 12-28 (~28%), 10-round games, dishonor bleed |
| + DYH interrupt-only, In Service fix, duel bid 2 | 16-24 / 16-24 (40%) |
| + attackCommitment 'all' | 17-23 (42.5%), dishonor losses 16→10 |
| + low draw bids (final) | seed 1 17-23 + 10-30 (pooled 34%), seed 4 16-24 (40%) |

Final band: **~35-40% both seeds**, with brutal run-to-run variance (17-23
and 10-30 on the same config). Dragon's engine stalls games to 9-11 rounds
and the mirror's long honor war favors Crane — same structural story as the
Crab wall. Against a human the card-volume payoffs (Mitsu double ring
resolutions, Void Fist removals, In Service recursion) play far better than
the mirror number suggests.

The deck stalls games to ~9-10 rounds by nature (cheap bodies, engine turns);
the remaining losses split between Crane's conquest race and the long honor
war. All cards, actions, and reactions verified firing — the only zero-click
cards are Shintao Monastery (a pure passive "+1 card played" aura) and the
role/passives with nothing to click.
