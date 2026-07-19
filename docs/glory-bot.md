# Phoenix "For Honor and Glory" bot deck (EmeraldDB 7c5b9776)

A glory/honor engine: build a persistent board of high-glory characters,
honor them (an honored character adds its glory to BOTH skills), hold the
Imperial Favor through glory counts, and pick the contested ring from the
cards in play. Mid/late-game deck — no rush, generic balanced attack/defense.

## How the bot plays it

Same layering as the other decks (`deck-profiles.md`): `glory` strategy flag
(GLORY_MARKERS / the Isawa Mori Seido stronghold), `GloryProfile` sub-profile
hung off the deck profile, `GloryTactics` decision helpers, all policy hooks
gated on its presence.

- **Ring choice follows the board** (`GloryTactics.ringBonus`, wired into
  `ringScore`): earth while Solemn Scholar is out (bow an attacker every
  conflict with earth claimed), water for Prodigy of the Waves / Asako Tsuki
  / Feral Ningyo (counted from hand — it is free to play into water
  conflicts), void for Isawa Atsuko / Ujina / Kaede. Kuroi Mori's menu picks
  "Switch the contested ring", and the ring select then lands on the
  board-preferred ring through the same scoring.
- **Stronghold** (+2 glory for the phase): auto-clicked in conflict windows;
  target steered to an honored participant (straight stats now) or the
  biggest ready body (banks glory for the favor count). Rally to the Cause
  goes under the stronghold (`phoenix-rally-stronghold` override).
- **Honor engine**: Asako Diplomat's win reaction honors our highest-glory
  un-honored character (falling back to dishonoring their highest-glory target — the
  target pick and the follow-up honor/dishonor menu are linked through
  `diplomatChoice`); Court Games honors a friendly participant while one can
  receive the status, then switches to enemy dishonor when all are honored; Kiku
  Matsuri honors our strongest and their weakest through the generic
  helpful-polarity; Benten's Touch bows a home Shugenja to honor a
  participant; Magnificent Kimono (pride, `abilityValue`) stacks more.
- **Duels**: Game of Sadane sends our best political participant against
  their strongest beatable target. Shared `DuelBidTactics` uses the exact
  political duel skills and the glory deck's `honor` risk profile; there is no
  fixed bid 4.
- **Cancels**: Censure (with the Favor) and Voice of Honor (more honored
  characters) fire through the priority>=6 interrupt path.
- **Void punishes**: Isawa Ujina's forced reaction removes their strongest
  no-fate character; when only friendly targets are legal it removes the
  weakest instead of repeatedly cancelling the forced prompt. Shiba Tsukune
  resolves 2 unclaimed rings at phase end;
  Isawa Kaede's double-resolve is engine-automatic.
- **Water package**: Against the Waves READIES an own bowed Shugenja (the
  bow/ready menu is steered to Ready); Prodigy readies itself while water is
  claimed; Feral Ningyo is a free body in water conflicts.
- **Ofushikai** attaches to Shiba Tsukune (ranked `ofushikaiTargets`); its
  granted Action moves their strongest participant home.
- **Favorable Ground** reinforces a losing defense with the strongest home
  body.

## Results vs the Crane precon (alternating seats, N=40 each)

| | result |
|---|---|
| seed 1 | 24-16 and 27-13 (pooled 51-29, **~64%**) |
| historical omniscient run (then seed 4; now seed 5) | **30-10 (75%)** |

Utilization audit: every card fires except The Imperial Palace — a pure
passive (+3 during glory counts, nothing to click), correctly zero.

Notable audit counts (N=40): stronghold glory pump 234, Censure 38 interrupt
triggers, Voice of Honor 30, Game of Sadane 50, Kuroi Mori 201 clicks,
Solemn Scholar bow-action 104, Forgotten Library 159 draws, Rally to the
Cause stronghold pick 40/40.
