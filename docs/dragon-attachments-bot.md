# Dragon Attachments bot deck

EmeraldDB deck: [Arsenal / Dragon Attachments](https://www.emeralddb.org/decks/46aaa220-2cf9-463b-bdf3-3019572432ff) (Dragon with Crab splash).

This is an Iron Mountain Castle attachment-tower deck. The bot builds two
durable characters, puts 3-4 fate on them, searches for attachments, and uses
Weapons to ready Niten Master for additional conflicts. The deck is registered
as `DragonAttachments` in the self-play tools.

## Profile and economy

- `iron-mountain-castle` derives the separate `attachmentTower` strategy. It
  does not activate the High House monk/card-count profile.
- Dynasty mulligan replaces non-tower cards. Ranked towers are Togashi Yokuni,
  Niten Master, Mirumoto Raitsugu, Agasha Sumiko, Kitsuki Yuikimi, and Solitary
  Hero, in that order.
- The board target is two towers and at most three support characters. A tower
  is bought only when at least 3 additional fate is affordable; it receives up
  to 4.
- Draw bids use the shared honor-safe heuristic instead of a deck-specific
  Composure bid. At normal honor (7+) the bot bids 5 to refill its hand, so a
  one-card turn-two hand is not stranded by a forced bid of 1. It steps down to
  3 at 4-6 honor and 1 at 3 or less, with the generic opponent-honor safety
  caps still applied.
- Ancestral Lands is placed under the stronghold. Its +5 political strength is
  more useful on the final province than Pilgrimage: if the stronghold province
  breaks, the game has already ended.
- The deck uses balanced attacks, keeps one character home, chump-blocks
  hopeless attacks to avoid unopposed honor loss, and overshoots prevent-break
  defenses by 2 skill.

## Attachment plan

Iron Mountain Castle gives every Dragon character one additional Restricted
slot. The policy therefore permits three Restricted attachments on Dragon
characters, while Hiruma Skirmisher and other non-Dragon characters retain the
normal limit of two.

Attachment priority is:

1. Daimyo's Favor, establishing the reusable attachment reducer first.
2. Tetsubo of Blood and Jade Tetsubo.
3. Adopted Kin.
4. Ancestral Daisho, Elegant Tessen, and Finger of Jade.
5. Two-Heavens Technique and Pathfinder's Blade.
6. Fine Katana, Kitsuki's Method, Ornate Fan, Inscribed Tanto, and Tattooed
   Wanderer.

The bot plays these before conflicts when legal. It never opens an attachment
play if no strategic bearer has a free slot. Specific steering:

- Tetsubo of Blood is spread one per tower. Its Limited keyword is correctly
  treated as a per-player play limit, not a per-character rule.
- Daimyo's Favor is bowed only when a positive-cost attachment can legally be
  played on its bearer. That paid attachment becomes the next attachment play
  and is forced onto the same bearer; cost-0 attachments cannot consume the
  prepared reduction.
- A ready Iron Mountain Castle makes a cost-1 attachment free, including
  Tetsubo of Blood's alternate fate cost. The policy therefore saves Daimyo's
  Favor for a later attachment. If Castle is bowed or unavailable, Favor pays
  for Tetsubo. Jade Tetsubo costs 2, so Favor and Castle combine to make it
  free. Castle never bows for a printed cost-0 attachment.
- The game engine now selects a bearer before paying target-dependent costs.
  This lets both reducers see Tetsubo's bearer and prevents Tetsubo from
  removing fate before Favor or Castle can reduce its cost.
- A Weapon is held while every Niten Master reaction carrier is ready, then
  targets a bowed Niten Master to ready it for another conflict. Togashi Yokuni
  follows the same targeting and hold rules after copying Niten Master's
  ability. Other attachments prefer the ranked tower with the most fate.
- Fine Katana, Ornate Fan, Ancestral Daisho, and Kitsuki's Method may stack on
  one bearer, subject to the Restricted-slot limit. Every other attachment is
  limited by policy to one copy per bearer and is distributed when another
  legal strategic character is available. This includes Watch Commander and
  the deck's ability attachments. Other attachments prefer a bearer that
  already has Adopted Kin when the singleton rule still permits it.
- Elegant Tessen first readies a bowed printed-cost-2-or-less support
  character; otherwise it is another Niten Master Weapon.
- Two-Heavens Technique prefers a Bushi with exactly two Weapon attachments.
- Tattooed Wanderer is played as an attachment, granting the tower covert.
- Let Go removes the strongest enemy attachment and never selects a friendly
  attachment; without a legal enemy target, the play is cancelled or skipped.
  Finger of Jade and Pathfinder's Blade fire through the interrupt playbook.

## Search, recursion, and character abilities

- Illustrious Forge and Agasha Swordsmith choose the highest-priority
  attachment from their top-five search. Inventive Mirumoto does the same from
  the conflict discard when Water is claimed.
- Water receives a large ring bonus when Inventive Mirumoto and an attachment
  in the discard make recursion live. Void is preferred while Inscribed Tanto
  is attached. Fire is preferred to honor an unhonored built tower.
- Togashi Yokuni first prefers Niten Master, Mirumoto Raitsugu, Niten Adept, or
  Solitary Hero, in that order. When none is available, he dynamically chooses
  a legal enemy character ability using playbook priority and board value as
  tie-breakers. This includes reactions such as Tengu Sensei: Yokuni copies it
  before conflicts, then the normal action/reaction policy triggers the gained
  ability at its legal window.
- Mirumoto Raitsugu challenges the weakest enemy on the military axis. Niten
  Adept bows an unattached ready enemy. Stoic Rival dishonors an enemy with
  fewer attachments. Solitary Hero removes fate while it is the only friendly
  participant. Jade Tetsubo targets the enemy participant with the most fate.
- Agasha Sumiko, Kitsuki Yuikimi, Keen Warrior, Hiruma Skirmisher, Niten
  Master, Finger of Jade, Pathfinder's Blade, Seeker of Fire, and province
  reactions have explicit trigger priorities.
- Mountaintop Statuary is reserved for the stronghold defense and sends home a
  legal cheap attacker. Manicured Garden and Riot in the Streets use the
  generic attacked-province action path. Pilgrimage and Ancestral Lands are
  passive engine effects.

## Alchemical Laboratory rules note

The rules-authority implementation differs from the proposed description.
Alchemical Laboratory says that, while Fire is claimed, attachments you
control **on another player's character** gain ancestral. It does not make
attachments on your own tower ancestral. Own attachment recursion comes from
Adopted Kin and cards with printed Ancestral (Ancestral Daisho and Kitsuki's
Method). The bot keeps the Jigoku card behavior unchanged.

## Verification and tuning

Focused unit coverage: `dragonattachmenttactics.spec.js`, including
strategy/profile gating, deep fate, dynasty mulligan, three Restricted slots,
Niten and Niten-copying Yokuni ready timing, Adopted Kin/Tetsubo spreading,
paid-only Daimyo's Favor sequencing, Castle-first Tetsubo reduction, generic
draw bidding, friendly and enemy Yokuni copy/use paths, ring steering, and
policy integration. Card integration regressions cover Favor reducing Tetsubo
to zero, Castle reducing Tetsubo to zero, and Favor plus Castle reducing Jade
Tetsubo from 2 to zero. The full bot-only suite covers the shared policy
regressions.

Historical Crane self-play before the generic-bid, paid-only Favor, and enemy
Yokuni changes used seed 1 with alternating seats:

| Configuration | Result |
|---|---:|
| Generic bot baseline | 8-32 (20.0%, N=40) |
| Dedicated tower profile, clean Yokuni gate | 14-26 (35.0%, N=40) |
| + tower mulligan, old bid-1 profile, defense buffer 2 | 17-23 (42.5%, N=40) |
| Final validation | 40-59, 1 stalled (40.4%, N=100 decided rate) |

That snapshot produced 23 dishonor and 17 conquest wins. Rejected experiments
were more defensive pressure (28.2%, N=40) and allowing a two-fate tower setup
(27.5%, N=40).

The current controlled matrix uses 100 alternating-seat games against each of
Crane, Phoenix, and Scorpion. After the target-dependent engine repair, the
deck scored **113-187 (37.7%)**. Saving Favor when ready Castle can pay for
Tetsubo improved the same-sized matrix to **123-177 (41.0%)**: 66% against
Crane, 30% against Phoenix, and 27% against Scorpion. These individual N=100
matchups remain noisy; the aggregate is the tuning signal. Raising maximum
tower fate to 5 (34.8%) and buying support immediately after a tower (36.7%)
were tested and rejected.

Final all-deck validation at N=40 per matchup finished **178-182 (49.4%)**,
up from the pre-fix **103-257 (28.6%)** snapshot. A separate N=100 run against
the Crane precon finished **68-32 (68%)**, up from 42% in the reported
pre-fix run. Seats alternate and both players use seed 1 fate-aware logic.

The reducer-validation snapshot passed **278 bot specs with 0 failures**, and
TypeScript typechecking passed. The suite has since expanded, so that count is
historical rather than a current total. The card integration specs require the repository's
external `test/json/Card` fixture data; deterministic self-play confirms the
runtime reducer sequence when those fixtures are unavailable locally.
