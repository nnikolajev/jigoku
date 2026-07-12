# Upgraded Crane Duels bot deck (EmeraldDB e2e443b5)

The duel deck: a FEW durable, honored duelists (Toshimoko, Kaezin, Kuwanan,
Iron Crane Legion, Tengu Sensei) carry stacked duel attachments and grind
value out of every duel — the stronghold honors the winner, Proving Ground
draws, Kakita Blade gains honor, Policy Debate strips the hand.

## How the bot plays it

`duelist` strategy flag → `DuelProfile` → `DuelTactics`, same pattern as the
other five tactics modules. **The flag keys on Tsuma alone**: the sparring
Crane precon shares the entire duel package with this list, and the baseline
opponent must stay on its generic profile or every measured band shifts.

- **Duel bids**: 2 (`duel-honor-bid`), floor 4. Bid 3 was measured to feed
  the OPPONENT's honor victory (honor flows to the lower bidder): Crane won
  6/40 games by honor at bid 3, 2/40 at bid 2 — and the deck's duelists win
  on skill difference anyway because of the target steering.
- **Duel target steering** (`duelAxes`): every duel-initiating card is
  mapped to the axis it compares. A prompt offering OUR characters sends our
  strongest on that axis; a prompt offering THEIRS duels their weakest
  (`duel-own-strongest` / `duel-enemy-weakest`).
- **Attachment stacking**: Duelist Training, Daimyo's Gunbai, Kakita Blade,
  Iaijutsu Master, Shukujo land on the ranked `keyCharacters`
  (`duel-attach-key-character`), so one durable body carries several duel
  actions.
- **Vassal Fields under the stronghold** (`crane-duel-vassal-fields`
  override): drains 1 attacker fate every conflict fought there.
- Tsuma (characters enter honored), Magistrate Station (ready an honored
  character — target falls through to the strongest bowed), Kyuden Kakita's
  honor-the-duelist reaction, Daidoji Nerishma's un-facedown action, Tengu
  Sensei's covert+lockout double, Toshimoko's conflict-nullifying interrupt,
  Cunning Negotiator's steal-the-province-action duel: all playbook entries,
  all verified firing.

## Side effect: the sparring Crane got smarter

The playbook is global by card id, and the baseline Crane precon shares ~41
cards with this list. Its previously idle cards (Kaezin's duel, Kuwanan's
bow, Toshimoko's interrupt, Harrier's discard, Duelist Training, the Dojo)
now fire for the BASELINE opponent too. That is deliberate — the baseline is
the user's own physical deck, played properly at last — but it re-baselines
every deck's vs-Crane band downward. See deck-profiles.md.

## Results (alternating seats, N=40 each, vs the now-smarter baseline Crane)

| Config | Result |
|--------|--------|
| duelBid 3 | seed 1: 15-23 (+2 stalls), Crane honor wins 6; seed 4: 13-27, honor wins 6 |
| duelBid 2 (final) | seed 1: 18-22 + 16-24 (pooled 42.5%), seed 4: 18-22 (45%); honor leak closed (6→2) |

The mirror is nearly a true mirror (41 shared cards + the same playbook), so
~45-50% is the expected ceiling; the edge comes from DuelTactics (bids,
steering, stacking) and the 6 swapped provinces. Utilization audit: every
card fires, zero-clicks list EMPTY on the first audit pass.
