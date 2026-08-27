# Dragon Attachments bot deck

EmeraldDB deck: [Dragon Attachments](https://www.emeralddb.org/decks/bb472c4c-e26a-4896-9693-fd87363cf0ea)
(Dragon with Crab splash), deck id `ce8df8ae-ee05-4ab7-bc13-087a8fc092cb`,
**revision 0.5**.

This is an Iron Mountain Castle attachment-tower deck. The bot builds two
durable characters, puts 3-4 fate on them, searches for attachments, and uses
Weapons to ready Niten Master for additional conflicts. The deck is registered
as `DragonAttachments` in the self-play tools.

## Revision 0.5 — what changed in the list

| Removed | Added |
|---|---|
| Keen Warrior x3 | Agasha Shunsen x3 |
| Ancestral Lands x1 | Agasha Taiko x3 |
| Hiruma Skirmisher x1 | Self-Understanding x3 |
| Tattooed Wanderer x3 | The Stone of Sorrows x3 |
| Inventive Mirumoto x3 | Waterfall Tattoo x2 |
| Riot in the Streets x1 | Revered Bonshō x2 |
| Two-Heavens Technique x3 | Restoration of Balance x1 |
| | City of the Rich Frog x1 |

Counts also moved: Finger of Jade 3 -> 2, Kitsuki Counselor 3 -> 1.

Every removed card's bot code is gone with it. `keen-warrior`,
`hiruma-skirmisher`, `inventive-mirumoto` and `two-heavens-technique` appear in
no other deck in the field, so their `CardPlaybook` entries and the two policy
branches keyed on them (Keen Warrior's bottom-card pick and Inventive
Mirumoto's forced self-bearer) were deleted outright. `tattooed-wanderer` and
`ancestral-lands` are still run by other decks, so those entries stay; only the
Dragon-attachment profile references were dropped.

## Profile and economy

- `iron-mountain-castle` derives the separate `attachmentTower` strategy. It
  does not activate the High House monk/card-count profile.
- **Illustrious Forge is the stronghold province** (`dragon-attachments-illustrious-forge`
  override). It is the only province in the list whose reveal reaction pays,
  and the stronghold province is the one province guaranteed to be revealed in
  a game the deck is losing — so the free attachment arrives exactly at the
  game-deciding defense. Ancestral Lands left the deck in 0.5, and City of the
  Rich Frog is Eminent, so it cannot be a stronghold province at all.
- Dynasty mulligan replaces non-tower cards. Ranked towers are Togashi Yokuni,
  Niten Master, Mirumoto Raitsugu, Agasha Sumiko, Kitsuki Yuikimi, and Solitary
  Hero, in that order.
- The board target is two towers and at most three support characters. A tower
  is bought only when at least 3 additional fate is affordable; it receives up
  to 4.
- Draw bids use the shared injectable tower profile in `DrawBidTactics`.
- The deck uses balanced attacks, keeps one character home, chump-blocks
  hopeless attacks to avoid unopposed honor loss, and overshoots prevent-break
  defenses by 2 skill.

## The attachment plan

Iron Mountain Castle gives every Dragon character one additional Restricted
slot, so the policy permits three Restricted attachments on Dragon characters
and the normal two elsewhere.

### One military tower and one political tower

Revision 0.5's main behavioural change. V1 spread attachments evenly across
its towers, which is the wrong shape: three Pathfinder's Blades on one body is
+3 military, and on three bodies it is +1, three times — and neither number
wins a conflict the deck was not already winning.

`DragonAttachmentProfile.axisTowerSplit` (default on) classifies every
attachment by the axis it actually buffs, reading the printed bonuses in
`attachmentSkillBonuses`:

| axis | attachments |
|---|---|
| military | Tetsubō of Blood, Jade Tetsubō, Fine Katana, Ancestral Daishō, Inscribed Tantō, Pathfinder's Blade |
| political | Self-Understanding, Ornate Fan, Kitsuki's Method |
| either | Elegant Tessen, Waterfall Tattoo, The Stone of Sorrows, Adopted Kin, Daimyō's Favor, Finger of Jade |

`towerAxes` then names one military tower and one political tower from the
bodies actually in play, reading the LIVE skill summaries (which already
include everything attached) and falling back to summing printed bonuses when
the board carries no summary. A single-axis attachment is narrowed to the
matching tower; a symmetric or ability-only one follows the ordinary ranking.
The narrowing never overrides the Restricted cap, the singleton rule or a
pending Daimyō's Favor bearer — it only reorders bodies that were already
legal.

Pathfinder's Blade joined the stackable list for exactly this reason: it is not
Restricted, so three copies can sit on the military tower.

### Priority order

Daimyō's Favor, Tetsubō of Blood, Jade Tetsubō, Adopted Kin, Self-Understanding,
The Stone of Sorrows, Ancestral Daishō, Elegant Tessen, Finger of Jade,
Waterfall Tattoo, Pathfinder's Blade, Fine Katana, Kitsuki's Method, Ornate Fan,
Inscribed Tantō.

Unchanged steering from earlier revisions: Tetsubō of Blood is spread one per
tower; Daimyō's Favor is bowed only for a positive-cost attachment on its own
bearer; a ready Iron Mountain Castle makes a cost-1 attachment free so the
Favor is saved for a dearer one; a Weapon is held while every Niten Master
carrier is ready and then targets a bowed one; Elegant Tessen first readies a
bowed printed-cost-2-or-less helper; Let Go never selects a friendly
attachment.

## The new cards

### Agasha Shunsen — claimed rings into a tutored attachment

*Action: During a conflict, return 1 or more rings you have claimed to the
unclaimed ring pool. Choose a character you control – search your conflict deck
for an attachment with printed cost equal to or lower than the number of rings
returned and attach it to that character. Shuffle.*

Four separate decisions, all in `DragonAttachmentTactics`:

- **Whether to buy the body at all** (`canBuyBody`). Every point of his value is
  an attachment landing on a character worth decorating, so with no tower
  standing the three fate is better spent becoming the tower. Gated on
  `shunsen.requireTowerOnBoard`.
- **When to fire** (`shouldUseShunsen`). Held until neither player has a
  conflict opportunity left — a claimed ring is worth something for as long as
  another conflict can be fought over the rest of the pool, and in the last
  conflict it is not. It also refuses while a Self-Understanding is attached to
  a body PARTICIPATING in the running conflict, because that card's gained
  reaction resolves every ring in the pool Shunsen's cost would empty
  (`shunsen.respectSelfUnderstanding`).
- **How many rings** (`shunsenRingsToReturn`). As many as possible, capped at
  3 — the deck's dearest attachment costs 3, so a fourth ring buys nothing. The
  cost re-prompts after every pick, so the policy counts what it has already
  clicked and then takes Done. Only rings we actually hold claimed are offered.
- **What to fetch** (`pickShunsenAttachment`), in the owner's order:
  Self-Understanding, Waterfall Tattoo, Jade Tetsubō, The Stone of Sorrows,
  Tetsubō of Blood, then any other attachment. The order is deliberately not
  sorted by cost: the top entry is the only cost-3 card, which is what makes
  returning the third ring worth doing.
- **Who wears it** (`pickShunsenTarget`). A body with no fate on it is discarded
  in the fate phase and takes the attachment with it, so the tower is only the
  right answer while it still has fate; otherwise the strongest body that does.

### Self-Understanding — and a reachability bug it exposed

*Restricted. This attachment cannot be chosen as the target of an opponent's
event. Attached character gains: "Reaction: After this character wins a
conflict - resolve the effect of each ring in your claimed ring pool."*

The reaction is **granted to the bearer** (`whileAttached` + `gainAbility`), so
the engine offers it on the CHARACTER, not on the attachment. The bot's
reaction window fires a character ability only when that character's own
playbook entry rates at priority 6 or better — and two of this deck's own
characters, Doomed Shugenja and Kitsuki Counselor, have no printed triggered
ability and therefore no entry at all. On those bodies the card was completely
unreachable.

Fixed generically: `DragonAttachmentProfile.grantedAbilityAttachmentIds` names
attachments that GRANT a triggered ability, and a bearer wearing one inherits
that attachment's hint. The list is per deck and empty by default, so no other
deck moves. `test/server/integration/botdragonattachments.spec.js` drives the
real engine to the real reaction window on a Doomed Shugenja and asserts the
claimed Air ring actually resolves.

### The Stone of Sorrows — and Revered Bonshō

*While attached character is ready, opponents cannot remove or gain fate from
rings.* (The Seeker role restriction is satisfied by Seeker of Fire.)

Two decisions:

- **When to play it** (`shouldPlayStoneOfSorrows`). As soon as there is fate on
  the rings to deny, or on sight while a Revered Bonshō is in play. With the
  rings empty it is a +1/+1 Restricted slot, and the bot then holds it unless
  that +1 flips the conflict on the table.
- **Whether its bearer may attack** (`stoneBearerStaysHome`). The lock only
  holds while the bearer is READY. With a Bonshō pushing the fate phase's fate
  onto the unclaimed rings every round, bowing that bearer for one attack hands
  the opponent everything the lock has accumulated, so the bearer stays home and
  another body attacks instead. A game-ending stronghold or Air-ring push still
  overrides.

### Waterfall Tattoo — a defender bought before the opponent declares

*Reaction: After a province you control is revealed - ready attached character.*

The opponent's declaration is what reveals a facedown province of ours, and the
reveal happens before defenders are declared. So the card converts a bowed body
into a defender for the conflict that is about to be declared. The bot attaches
it in the pre-conflict window, to a BOWED body, when all four legs hold
(`waterfallTattooBearer`):

1. we have a bowed body that can still take a Restricted slot;
2. the opponent still has a conflict opportunity;
3. the opponent has a ready body legally able to declare one of the types they
   have left — a printed dash in a skill cannot declare that conflict type;
4. we still hold a facedown province, or nothing can be revealed at all.

The bearer is remembered across the play and its follow-up attach prompt, since
the ordinary tower ranking would put the tattoo on the best tower — the one body
whose reaction has nothing to ready.

#### The other half: a tattooed body is FREE TO ATTACK

Every defense-preservation rule in this bot asks the same question — if I send
this body, will it still be standing when the opponent declares? Normally no,
and that is why one body stays home. A Waterfall Tattoo bearer inverts it: it is
readied by the very attack it was being kept home for.

`RevealReadyPolicy` (`server/game/bots/RevealReadyPolicy.ts`,
`DeckProfile.revealReady`) is the generic answer. It takes a board reading and a
list of attachment ids whose reaction readies their bearer on an own-province
reveal, and names the bodies that come back by themselves. Two consumers:

- `StrongholdDefenseTactics` takes them as `freeDefenderUuids`: they are counted
  as defenders in every survival test and never appear in `reserveUuids`. Here
  the question is narrower — only the STRONGHOLD province's own facedown state
  counts, because that reserve exists to survive an attack on that province and
  that attack is the reveal.
- The generic `attackKeepHome` sizing at the attacker declaration raises its cap
  by one per free body, using ANY facedown province of ours.

`requireAllProvincesFacedown` is the prepared conservative lever: on, it only
trusts the reveal when the opponent has no faceup province to attack instead.
It ships **off** on the owner's call — one facedown province is enough.

The policy is `enabled: false` field-wide, so it is inert for every deck without
such an attachment, and `StrongholdDefenseTactics` is pinned bit-identical to
its old self when no free defender is named.

### Agasha Taiko

*Reaction: After you play this character, choose a non-stronghold province -
that province cannot be attacked this round.*

`pickTaikoProvince` protects in the owner's order — Public Forum, Pilgrimage,
Manicured Garden — stepping to the next entry only once the one before it is
broken, since a broken province cannot be attacked anyway and protecting it is
the one strictly wasted choice. **Public Forum is not in revision 0.5**, so the
effective order today is Pilgrimage then Manicured Garden; it is kept first in
the list so the owner's stated order survives a future revision that adds it.
With nothing on the list available, the strongest unbroken province is
protected rather than declining a free effect.

The engine's own `cardCondition` only excludes the stronghold SLOT, so it offers
both players' provinces. Picking from our own side is load bearing — protecting
an enemy province is the exact inverse of the effect.

### Illustrious Forge

*Reaction: After this province is revealed - search the top 5 cards of your
conflict deck for an attachment and put it into play.*

It fires on the province being revealed, i.e. at the declaration of a conflict
against it — so the conflict type is already known and the right card is
whichever adds the most skill on THAT axis. The menu lists conflict-DECK cards,
which carry no live skill summaries at all, so the ranking comes from the
printed `attachmentSkillBonuses` table. Equal-skill ties fall to the owner's
order: Waterfall Tattoo, The Stone of Sorrows, Elegant Tessen, Finger of Jade,
Daimyō's Favor, Adopted Kin. Elegant Tessen keeps its own bearer rule (a bowed
printed-cost-2-or-less body first, then the strongest ready one).

### Restoration of Balance, City of the Rich Frog, Revered Bonshō

All three are engine-passive and need no new bot code — the same reason they
need none in the Dragon monk deck that already runs them. Restoration of Balance
is an interrupt on its own break; City of the Rich Frog is Eminent and refills
to 3; Revered Bonshō redirects the fate phase's fate onto the unclaimed rings
and its "choose a ring to receive fate" prompt is answered by the shared
ring-value ordering. Bonshō's payoff is realised by The Stone of Sorrows, above.

## Search, recursion, and character abilities

- Illustrious Forge ranks its top-five search by the declared conflict's axis;
  Agasha Swordsmith uses the deck's ordinary attachment priority.
- Void is preferred while Inscribed Tantō is attached. Fire is preferred to
  honor an unhonored built tower. The Water recursion bonus was removed with
  Inventive Mirumoto.
- Togashi Yokuni first prefers Niten Master, Mirumoto Raitsugu, Agasha Shunsen,
  or Solitary Hero, in that order, then dynamically chooses a legal enemy
  ability using playbook priority and board value as tie-breakers.
- Mirumoto Raitsugu challenges the weakest enemy on the military axis. Niten
  Adept bows an unattached ready enemy. Stoic Rival dishonors an enemy with
  fewer attachments. Solitary Hero removes fate while it is the only friendly
  participant. Jade Tetsubō targets the enemy participant with the most fate.
- All three Mountaintop Statuary copies are reserved for stronghold defense.
  Manicured Garden uses the generic attacked-province action path. Pilgrimage is
  a passive engine effect.

## Honor is not a resource this deck can spend

The single largest measured improvement in this revision is not a card — it is a
draw bid.

The revision-0.5 baseline lost **159 of its 475 losses on the honor track**: 111
by dishonor and 48 by the opponent reaching 25 honor. The honor losses were
fast, 29 of 48 landing by round 3, and 38 of Scorpion's 40 wins were dishonor.
The cause is `drawBidding.cardsOverHonor`, which the shared tower profile
inherits: it keeps bidding high to buy draw until our honor reaches **2**. In a
field containing two dedicated dishonor decks and two honor decks, that pays for
cards twice over — the honor it spends is the honor a dishonor deck is trying to
strip, and it is also the honor an honor deck needs to reach 25.

`drawBidding: { cardsOverHonor: false }` in the deck override. Everything else in
`TOWER_DRAW_BID_PROFILE` stays: the deck still bids 4+ for its Weapons, reducers
and ready effects. It just stops paying for them out of the honor track.

| arm | bases 91001-96001 | bases 120001-125001 | pooled |
|---|---:|---:|---:|
| control | 485-469 (50.84%) | 493-462 (51.62%) | 978-931 (**51.23%**) |
| `cardsOverHonor: false` | 524-430 (54.93%) | 531-424 (55.60%) | 1055-854 (**55.26%**) |

**+4.03pp, z=2.50, p=0.012 over 3818 games** — and positive on **12 of 12
independent bases** (sign test p=0.0002). The second base set was chosen after
the first result and never used to search, so it is a genuine replication.

The win-reason census confirms the mechanism rather than just the number, and
does so identically on both base sets: dishonor losses **118 -> 74**, honor
losses **47 -> 38**, and dishonor WINS **16 -> 45**. The honor track flips from a
liability into an asset.

This mirrors `FATE_ECONOMY_DRAW_BID_PROFILE`, which measured +4.58pp for the same
reason on a different deck family. Note that `cardsOverHonor` ships field-wide at
the owner's request despite measuring negative; this is a per-deck exclusion, the
same treatment the honor, dishonor and fate-economy profiles already carry.

## Measured and rejected: keeping Revered Bonshō through the fate phase

The obvious companion to the Stone of Sorrows lock is to stop the fate-phase
province refresh from discarding the Bonshō — `openingHoldingLimit: 1`,
`keepHoldingIds: ['revered-bonsho']` and `endHoldingLimit.weak: 1` so one
holding survives even on a losing board.

Measured **50.47%** against a 50.84% control on the same six bases: **-0.37pp**,
inside the noise floor and the wrong sign. Reverted. The per-deck rows swung
wildly (PhoenixShugenja 15.0% -> 28.3%, LionDuelist 70.0% -> 53.3%) which is
exactly the deck-strength noise a field row measures rather than the change.

The Stone of Sorrows behaviours that READ a Bonshō — playing the Stone on sight
while one is in play, and keeping its bearer home and ready — are unaffected and
still ship.

## Verification

Focused unit coverage lives in `test/server/bots/dragonattachmenttactics.spec.js`
(85+ cases) and `test/server/bots/revealreadypolicy.spec.js`. The
`StrongholdDefenseTactics` free-defender cases include a bit-identity assertion
against the old planner. `test/server/bots/specializedpolicycoverage.spec.js`
executes every method on `DragonAttachmentTactics` through all six seed and
information-mode combinations, so a method that stops being reachable fails the
build.

`test/server/integration/botdragonattachments.spec.js` drives the REAL engine
to the real prompt for the four cards whose decision is invisible to a unit
test — Self-Understanding's granted reaction, Waterfall Tattoo's reveal ready,
Agasha Taiko's province pick, and Agasha Shunsen's bearer — and answers each one
with a real `JigokuBotController`.

### Live card coverage

`node tools/selfplay/auditCards.js --decks DragonAttachments --seeds 1
--opponents all --modes fair --games 4` over 68 games against all 16 opponents:

| metric | result |
|---|---|
| Plays covered | 29/29 |
| Reachable zero-use cards | 0 |
| Never seen | 0 |
| Abilities exercised | 14/15 |

The single unreached ability is `seeker-of-fire`, the role card, whose reaction
needs a claimed fire ring. One game in 102 stalls; the same rate reproduces on
the untouched Dragon monk deck, so it is pre-existing background noise and not
a revision-0.5 regression.

### Win rate

`deckFieldWinRate.js` holds the other sixteen decks fixed and plays every
pairing twice on the same shuffle, subject on each seat, over six independent
bases.

| build | record | win rate |
|---|---:|---:|
| revision 0.5 as delivered by the deck list | 478-475 | 50.16% |
| + Illustrious Forge axis fix, Waterfall Tattoo slot fix | 485-469 | 50.84% |
| + Revered Bonshō retention (rejected) | 482-473 | 50.47% |
| **+ honor-safe draw bid (shipped)** | **524-430** | **54.93%** |

On the same rig `botRoundRobin.js` used for the revision-0.2 figure — subject
against the field, N=40 per matchup, seats alternating, v1/seed 1/adaptive bids:

| revision | record | win rate |
|---|---:|---:|
| 0.2 | 279-357 (4 undecided) | 43.9% |
| **0.5** | **347-287 (6 undecided)** | **54.9%** |

**+11.0pp like for like.** Roughly 4pp of that is the draw bid; the rest is the
new cards and the axis split.

Remaining weak matchups, from the six-base field run: PhoenixShugenja 15.0%,
UnicornReveal 31.7%, Scorpion 38.3%, CrabSacrifice 45.0%, Phoenix 46.7%. All
five lose on conquest rather than the honor track, so the next lever is board
tempo, not honor.
