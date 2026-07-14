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

1. Tetsubo of Blood and Jade Tetsubo.
2. Adopted Kin and Daimyo's Favor.
3. Ancestral Daisho, Elegant Tessen, and Finger of Jade.
4. Two-Heavens Technique and Pathfinder's Blade.
5. Fine Katana, Kitsuki's Method, Ornate Fan, Inscribed Tanto, and Tattooed
   Wanderer.

The bot plays these before conflicts when legal. It never opens an attachment
play if no strategic bearer has a free slot. Specific steering:

- Tetsubo of Blood is spread one per tower. Its Limited keyword is correctly
  treated as a per-player play limit, not a per-character rule.
- Daimyo's Favor is bowed only when a positive-cost attachment can legally be
  played on its bearer. That paid attachment becomes the next attachment play
  and is forced onto the same bearer; cost-0 attachments cannot consume the
  prepared reduction. Iron Mountain Castle then fires only when the actual
  remaining cost is above zero, allowing both reducers to contribute to a
  cost-2 attachment without wasting either on a free card.
- A Weapon targets a bowed Niten Master first, immediately triggering his
  ready reaction. Otherwise attachments prefer the ranked tower with the most
  fate.
- Adopted Kin and Daimyo's Favor are limited by policy to one copy on each
  bearer. Other attachments prefer a bearer that already has Adopted Kin.
- Elegant Tessen first readies a bowed printed-cost-2-or-less support
  character; otherwise it is another Niten Master Weapon.
- Two-Heavens Technique prefers a Bushi with exactly two Weapon attachments.
- Tattooed Wanderer is played as an attachment, granting the tower covert.
- Let Go removes the strongest enemy attachment. Finger of Jade and
  Pathfinder's Blade fire through the interrupt playbook.

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
Niten ready targeting, Adopted Kin/Tetsubo spreading, paid-only Daimyo's Favor
sequencing, generic draw bidding, friendly and enemy Yokuni copy/use paths,
ring steering, and policy integration. The full bot-only suite covers the
shared policy regressions.

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

Current validation after the generic-bid, paid-only Favor, and dynamic enemy
Yokuni changes used the same seed and alternating seats: **47-53 (47.0%,
N=100), with no stalled games**. Dragon won 37 games by conquest and 10 by
dishonor. This is 6.6 percentage points above the previous 40.4% decided-game
baseline.
