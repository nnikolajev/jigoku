# Upgraded Crane Duels bot deck (EmeraldDB e2e443b5)

The duel deck now follows the human tower plan: establish up to two durable
characters from **Tengu Sensei, Doji Kuwanan, Kakita Kaezin, and Kakita
Toshimoko**, invest 3-5 additional fate, honor them, and put duel tools on
them. One or two cheap supporting bodies defend or take unopposed conflicts.

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
- **Tower deployment**: buy one of the four preferred characters only when it
  can receive at least 3 fate; place 3-5 fate on it; retain an unfunded tower
  faceup through regroup; keep at most two cheap support characters.
- **Attachment stacking**: Duelist Training and the deck's other duel/stat
  attachments land on the four towers. Restricted attachments are spread to
  characters with fewer occupied slots and never exceed two. **Shukujo only
  attaches to Doji Kuwanan**. Invalid tower attachments are skipped before
  their target prompt, preventing the old cancel/retry loop.
- **Honor plan**: while a tower is unhonored, Fire gains enough ring priority
  to beat the ordinary Earth/Void ordering (rings carrying 2+ fate still win
  the global economic priority).
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
| duelBid 2 (old policy) | seed 1: 18-22 + 16-24 (pooled 42.5%), seed 4: 18-22 (45%); honor leak closed (6→2) |
| tower policy (final, four independent N=20 batches) | 11-9, 9-11, 10-10, 9-11; pooled **39-41 (48.75%)** |
| forced Shukujo switching experiment (rejected) | pooled 29-51 (36.25%); switching without full conflict forecasting helped the opponent too often |

The matchup is nearly a true mirror (the same dynasty characters, roughly 41
shared cards, and the same global card playbook). The tower change moved the
observed result from 42.5-45% to 48.75%, but 80 games is not enough evidence
that the true rate is above 50%. The six swapped provinces/conflict cards, seat
order, and self-play variance still matter. Utilization audit: every card
fires; zero-clicks list was empty on the first audit pass.
