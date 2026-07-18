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

- **Duel bids**: 2 (`duel-honor-bid`), floor 4. Bid 3 was measured to feed
  the OPPONENT's honor victory (honor flows to the lower bidder): Crane won
  6/40 games by honor at bid 3, 2/40 at bid 2 — and the deck's duelists win
  on skill difference anyway because of the target steering.
- **Duel target steering** (`duelAxes`): every duel-initiating card is
  mapped to the axis it compares. A prompt offering OUR characters sends our
  strongest on that axis; a prompt offering THEIRS duels their weakest
  (`duel-own-strongest` / `duel-enemy-weakest`).
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
  the global economic priority).
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

## Current Crane Baseline

The standardized opponent is no longer the old sparring precon. It is the
dedicated 4736f7c0 Crane Baseline list, which reuses these duel rules and adds
public-deck-aware Gossip, Let Go control, Noble Sacrifice, solo-character
sequencing, and a late board floor. See `crane-baseline-bot.md`. Historical
results below were measured against the older opponent and are retained only
as the tuning record for the upgraded Crane Duels list.

## Results (alternating seats, N=40 each, vs the now-smarter baseline Crane)

| Config | Result |
|--------|--------|
| duelBid 3 | seed 1: 15-23 (+2 stalls), Crane honor wins 6; historical omniscient (then seed 4, now seed 5): 13-27, honor wins 6 |
| duelBid 2 (old policy) | seed 1: 18-22 + 16-24 (pooled 42.5%), historical omniscient: 18-22 (45%); honor leak closed (6→2) |
| tower policy (final, four independent N=20 batches) | 11-9, 9-11, 10-10, 9-11; pooled **39-41 (48.75%)** |
| forced Shukujo switching experiment (rejected) | pooled 29-51 (36.25%); switching without full conflict forecasting helped the opponent too often |

The matchup is nearly a true mirror (the same dynasty characters, roughly 41
shared cards, and the same global card playbook). The tower change moved the
observed result from 42.5-45% to 48.75%, but 80 games is not enough evidence
that the true rate is above 50%. The six swapped provinces/conflict cards, seat
order, and self-play variance still matter. Utilization audit: every card
fires; zero-clicks list was empty on the first audit pass.
