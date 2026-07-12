# Lion "Bushi swarm" bot deck (EmeraldDB e3feb31b)

Precon15 Lion Bushi: an extremely aggressive military deck that floods the
board with cheap Bushi characters and attacks every window. The swarm buffs
itself in numbers, profits from every won conflict, and re-readies its bodies
to attack again.

## How the deck plays

- **Numbers first.** Cheap efficient Bushi (Matsu Berserker 1-cost 3-military)
  hit the board with real fate, then attack together: Honored General gives
  every other Lion participant +1 military, Ikoma Tsanuri pumps the whole
  board with 3+ Bushi participating, Matsu Gohei does not bow when attacking
  with 2+ other Bushi.
- **Win-conflict payoffs.** Gifted Tactician draws on military wins, Akodo
  Makoto strips participating Courtiers, For Greater Glory puts a fate on
  every Bushi after a break, Unified Company reinforces from the discard.
- **Ready and attack again.** Hayaken no Shiro (stronghold) readies a
  cost-2-or-lower Bushi; In Service to My Lord bows a cheap non-unique to
  ready a unique; Right Hand of the Emperor readies 6 cost worth of Bushi —
  both events recycle from the discard. Shori on the Champion grants an
  extra military conflict each phase; Ikoma Ujiaki switches a political
  conflict into a military one.
- **Duels bow the loser.** True Strike Kenjutsu duels on BASE military (Way
  of the Lion doubles base); Honorable Challenger's winner does not bow from
  resolution.
- **Card engine.** Tactical Ingenuity (on a Commander) digs the conflict deck
  for events every conflict; Tactician's Apprentice draws when our honor bid
  is lower than the opponent's.

## Bot implementation

Same layering as the other decks (see `deck-profiles.md`):

1. **Strategy flags**: the Lion swarm markers (Way of the Lion, For Greater
   Glory, In Service to My Lord, Shori, Hayaken no Shiro, ...) were added to
   `AGGRESSIVE_MARKERS`, so the deck derives `aggressive` — the same rush
   base profile as Unicorn.
2. **`lion-bushi-swarm` override** (`DeckProfiles.ts`), matched on
   `aggressive` + the `hayaken-no-shiro` stronghold so no other deck picks it
   up. It applies the Unicorn-proven anti-Crane fixes (`prevent-break`
   defense, `spendCardsOnDefense`, real fate on characters) but keeps
   `attackCommitment: 'all'` — the swarm's buffs want every body in the
   conflict (measured: 'all' 27-13 vs 'all-but-one' 26-14).
3. **`LionTactics` sub-profile** (`LionTactics.ts`, hung off
   `DeckProfile.lion`) for the quirks the generic knobs cannot express:
   - draw dials bid **2** after round 1 (Tactician's Apprentice triggers when
     outbid, and the dial's honor difference flows IN; bidding 4 bled 7/40
     games into dishonor losses),
   - duel dials bid **3** (enough to win most duels without the honor drain
     of bid 5; duel prompts are recognized by their "Choose your bid for the
     duel" menu title),
   - both collapse to 1 at the honor floor (4),
   - Hayaken no Shiro is clicked in conflict windows whenever one of the
     deck's cheap Bushi (by printed id) sits bowed.
4. **~30 playbook entries** (`CardPlaybook.ts`): every ability card in the
   deck. Notable machinery added for this deck:
   - `abilityValue` flag: True Strike Kenjutsu and Sashimono are +0-stat
     attachments whose granted ability is the point — without the flag the
     zero-contribution filter never played them.
   - `attachSide: 'self'`: True Strike's ABILITY targets the enemy (the
     duel), but the attachment itself must land on our own character.
   - In Service to My Lord target steering: stage 1 bows the WEAKEST ready
     non-unique (preferring one outside the conflict), stage 2 falls through
     to the generic strongest-bowed-unique pick.
   - Battlefield attachments (Prepared Ambush, Makeshift War Camp) are
     played while defending and steered onto the attacked own province.
   - Akodo Toshiro's +5 (provinces cannot break) fires only to STEAL a
     losing conflict — never when the break is already on — and only with a
     Commander in play (or he discards himself).

## Results (self-play vs Crane precon, alternating seats)

| Config (all seed 1, N=40 unless noted) | Result |
|--------|--------|
| First cut (bid 4 / duel 5 / all-but-one) | 24-16 (60%), 7 dishonor losses |
| drawBid 2 | 26-14 (65%), 4 dishonor losses |
| drawBid 3 | 26-14 (65%), 6 dishonor losses |
| drawBid 2 + duelBid 3 | 26-14 (65%), 1 dishonor loss |
| + attackCommitment 'all' | 27-13; pooled with 60 more: 66-34 N=100 (66%) |
| + abilityValue filter fix (final) | **seed 1: 34-14 pooled N=48 (~71%), seed 4: 28-12 (70%)** |

The last row is the shipped build: the `abilityValue` fix put True Strike
Kenjutsu (13 plays / 8 games) and Sashimono into the game. Wins are almost
all by conquest around round 6. The remaining losses are Crane conquest
races; the dishonor leak (Ujiaki's 2-honor switches, duel and dial payments,
Assassination) was closed by the low-bid tuning (2 dishonor losses / 40).

Regression checks on the final build: Unicorn, Crab, and Scorpion vs Crane
all within their established bands (see `deck-profiles.md`).

Trace verification (6 traced games): Tactical Ingenuity 49×, For Greater
Glory 29×, Shori 25×, Time for War 23×, Hayaken no Shiro 15×, Right Hand of
the Emperor 13×, Way of the Lion 8×, In Service to My Lord bow-steering 6×,
battlefield-own-province 5×, lion-honor-bid 68×.

## Deck update (2026-07-11, EmeraldDB c99f60e2)

All five provinces swapped: Pilgrimage / Elemental Fury / Fertile Fields /
Ancestral Lands / Meditations out; in:

- **Manicured Garden** — stronghold province (`lion-manicured-garden`
  override): +1 fate in every conflict fought there.
- **Illustrious Forge** — reveal digs the top 5 conflict cards for an
  attachment. The "Choose an attachment" menu picks by the
  `forgeAttachmentRanking` in the Lion profile (Shori > Kamayari >
  Fine Katana > ...); the attach target goes through the fate-weighted
  generic targeting so it lands on a persistent character. 38 digs/40 games.
- **The Art of War** — draws 3 when broken. The bot concedes it (no
  defenders, no cards) while at most one own province is broken; later every
  break walks the attacker toward the stronghold, so it defends normally.
  Measured: concede ~44-47% vs never-concede 37.5% — the concede is right.
- **City of the Rich Frog** — Eminent, holds 3 dynasty cards; the generic
  dynasty window plays from it (no bot change needed).
- **Shameful Display** — generic steering from the Crab update applies.

Utilization audit: every card fires, zero-clicks empty. **Band moved DOWN:
~45% vs Crane (seed 1 pooled 53-107 across configs N=160, seed 4 18-22),
was ~65-72% with the old provinces.** Root cause is not a bot gap: Crane
still runs Fertile Fields / Meditations / Ancestral Lands while this list
gave them up — the draw/fate-strip provinces are simply strong in the
mirror. Against humans the new toolbox (Forge weapons, Rich Frog tempo,
Art of War refills) plays differently than the raw mirror number suggests.
