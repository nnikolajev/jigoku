# Draw-phase honor bidding

All bot decks and deployed offline seeds use the shared `DrawBidTactics`
module for the draw-phase honor dial. Duel bids are separate and continue to
use `DuelBidTactics`.

The draw dial buys cards: each player draws the number they bid, and the higher
bidder gives the lower bidder honor equal to the difference. The policy normally
values card volume, but it can bid low to protect its own honor, pressure the
opponent's honor, or pursue an honor victory.

## Live inputs

`JigokuBotController` builds an exact `DrawBidContext` at the draw prompt:

- round number;
- both players' honor, fate, and hand size;
- fate on every unclaimed ring;
- each player's number of broken outer provinces;
- printed fate costs of cards currently in the bot's hand;
- average printed cost of all conflict cards in the bot's deck;
- board character count, ready count, persistent character count, attached
  cards, fate on characters, and live military/political skill;
- the legal dial values.

Conflict-card costs come from the bot's real card objects. They do not depend
on the public player-state summary, which omits those costs. The opponent's
hand contents remain hidden to fair seeds; only its public size, fate, honor,
and province state are used to predict its bid.

## Decision order

The adaptive policy applies these decisions in order:

1. Bid 5 on round 1 for every deck.
2. Bid low at immediate honor rails: own low honor, opponent near dishonor,
   own near honor victory, or opponent near honor victory.
3. Apply a deck's forced low-bid plan, currently Scorpion after round 1.
4. If either stronghold is exposed, bid 5 for defense or lethal pressure,
   unless an honor rail already produced a safer/immediate win plan.
5. Start from bid 5 and reduce it only when newly drawn cards are unlikely to
   be useful because of fate pressure, an already large hand, an established
   board, or a live honor/dishonor opportunity.
6. Clamp the result to the deck profile's routine floor and the prompt's legal
   dial values.

### Fate and card-cost estimate

The policy discounts uncertain ring fate and reserves part of current-hand
cost before valuing additional draws:

```text
effective fate = current fate
               + min(unclaimed ring fate, ring-fate cap) * ring conversion

new-card fate = max(0,
    effective fate - sum(current hand costs) * hand reservation)

useful draws = new-card fate / max(deck average cost, cost floor)
             + cheap-deck allowance
```

The cheap-deck allowance is progressive: it is largest when the deck average
is near zero and disappears at the configured cheap-deck threshold. A deck
with little fate can therefore still bid high when it has a realistic chance
to draw free cards. Accessible fate on rings also raises the useful-card
estimate without treating that future income as guaranteed.

### Board and hand deductions

The board score combines bodies, persistent bodies, attachments, fate invested
on characters, and the stronger of total military/political skill. Strong and
dominant thresholds have separate deductions. Hand size similarly has
comfortable and crowded thresholds. These are soft deductions, not vetoes;
deck-specific floors keep card-engine decks drawing enough cards.

### Opponent model and honor opportunity

The bot predicts the opponent's likely bid from public honor, hand size, fate,
and exposed-stronghold state. Honor-focused decks may underbid a predicted high
opponent when they are close enough to an honor win. Dishonor-focused decks use
the same mechanism when the opponent is near dishonor, although Scorpion's
normal post-opening plan already forces bid 1.

## Injectable deck profiles

Every `DeckProfile` owns cloned `drawBidding` values. Exact deck overrides can
deep-merge any value without adding deck checks to the shared policy.

| Profile | Decks | Main behavior |
|---|---|---|
| balanced | generic decks, Crab | bid for cards, reduce progressively when fate/hand/board make draws less useful |
| card engine | Phoenix, Phoenix Shugenja, Dragon Monks, Unicorn | routine floor 4; weaker fate and board deductions |
| honor | Lion and Crane duel strategies | normal card volume, but stronger low-bid opportunity near an honor win |
| tower | Dragon Attachments | routine floor 4; a single-card deduction only after its persistent tower is saturated |
| dishonor | Scorpion | bid 5 on round 1, then bid 1 to pressure the opponent |

Phoenix Shugenja increases the ring-fate conversion because its ring-control
cards can claim ring fate more reliably. All thresholds, weights, caps, floors,
and objectives are named `DrawBidProfile` fields and are safe to override.

## Legacy A/B policy

`LegacyDrawBidTactics` is a frozen copy of the pre-refactor behavior. It is not
the live default and exists only for regression tests and controlled gameplay
comparisons. It preserves:

- generic honor-tier bidding and opponent-honor caps;
- Lion's round-1 bid 5 / later bid 2 behavior;
- Dragon Monks' round-1 bid 5 / later bid 2 behavior;
- Scorpion's round-1 bid 5 / later bid 1 behavior.

Use `drawBidPolicy: 'legacy'` in a controller config or the self-play switches
documented in `commands.md`. Nonstandard legacy runs never overwrite the client
benchmark JSON.

## Verification

`drawBidMatrix.js` is a deterministic laboratory over opening, normal, costly
and cheap decks, ring fate, crowded hands, established towers, honor cliffs,
exposed strongholds, and honor-bait states. It prints adaptive and legacy bids
for every reusable profile and supports `--json` for automation.

`compareDrawBidPolicies.js` is the gameplay isolation test. Adaptive and
legacy seats use the same deck and bot seed, seats alternate, and each game has
a deterministic shuffle seed. It reports each deck separately and never
updates standardized client results.

Focused tests cover the formulas, decision precedence, legal-bid clamping,
profile isolation/overrides, policy routing for seeds 1, 2, and 3, exact live
controller context, and self-play command parsing. Gameplay validation compares
the adaptive policy with the stored pre-change client benchmark and can run
adaptive challengers directly against a legacy Crane opponent.

The retained seed-1 direct A/B won 218-182 (54.5%) before tower fine-tuning;
the tuned Dragon Attachments profile then won its focused A/B 45-35 (56.3%).
Seed 2 won 141-99 (58.8%) across six fate-sensitive same-deck A/Bs. Full
results and the exact stored baseline are in
`tools/selfplay/out/draw-bid-analysis.md`.
