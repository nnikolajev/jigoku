# Kachiko replays use the replayed card's own deck logic

**SHIPPED field-wide. Correctness class — no win-rate measurement was run and
none is wanted.**

## The problem

Bayushi Kachiko (Atonement) makes the OPPONENT's discarded EVENTS playable from
our side while she participates in a political conflict, three per round. Those
cards come from a decklist we are **not** running.

Almost every card-specific target rule in `JigokuBotPolicy.polarityTargetDecision`
is gated on the tactics package that owns it:

```js
if(shugenja && targetHint.sourceCardId === 'clarity-of-purpose') { ... }
if(lion     && targetHint.sourceCardId === 'feeding-an-army')    { ... }
if(duelist  && targetHint.sourceCardId === 'way-of-the-crane')   { ... }
```

The Scorpion bid-war seat — Kachiko's own deck — resolves `bidWar` and nothing
else. So a replayed event reached its target prompt with every rule written for
it switched off, and fell through to the generic skill-ordered picker.

Found while fixing the Clarity of Purpose double-spend
(`bot-clarity-of-purpose-target.md`): with the protection rule reachable only
behind `shugenja`, the Scorpion seat re-targeted the body that already had
Clarity. Measured on the live build before the fix:

```
Scorpion bid-war seat: shugenja=false lion=false duelist=false unicorn=false
replayed clarity-of-purpose, Kachiko already protected
    -> cardClicked ["kachiko"] | reason: hinted-target-self
```

This is the same shape as `DefenderRingChoicePolicy`: a rule gated on the deck
that OWNS the card, reached from the seat that does not.

## The fix

`JigokuBotPolicy.replayTacticsFor(sourceCardId)` returns every deck package at
its own **module defaults**, and the target decision uses it to fill only the
packages our profile LACKS:

```js
const replay = this.replayTacticsFor(sourceId);
if(replay) {
    shugenja = shugenja || replay.shugenja;
    lion     = lion     || replay.lion;
    ...
}
```

Four properties make this safe and drift-proof:

- **No card → deck map.** Nothing has to be maintained as branches are added.
  The branches are already keyed on the card id, so lending every package means
  only the branch belonging to the replayed card can fire. Verified: every
  package-gated branch in `polarityTargetDecision` is card-keyed — the one that
  reads `dragon` without an id sits inside the `favorable-ground` block.
- **Scoped to the replayed card.** `kachikoReplayCardIds` holds the printed ids
  we actually played out of the opponent's conflict discard this round,
  populated at the same place the three-per-round budget is counted. Any other
  prompt gets `null` and is bit-identical.
- **A deck that runs the card keeps its own tuning.** The fallback only fills a
  package that is absent.
- **Defaults, not the opponent's tuning.** Tuned values are a property of the
  deck that shipped them and we are not that deck. Default logic for the card
  beats no logic for the card.

The same bundle is lent to the PLAY gate (`conflictCardHasPlayIntent`) for cards
sitting in the opponent's discard, via `replayTacticsForCard` — the play
decision happens *before* the card is recorded as a replay, so it is keyed on
the pile instead. Those package checks are all refusals ("do not play this if
the deck's own picker finds no target"), and a replay is one of only three a
round, so not starting a doomed one is the point.

Result on the same board:

```
replayed clarity-of-purpose, Kachiko already protected
    -> cardClicked ["puppeteer"] | reason: clarity-of-purpose-tower
replayed way-of-the-crane
    -> reason: crane-honor-token-target   (was honor-own-highest-glory)
```

## What this does not do

- **The playbook was never the problem.** `CardPlaybook` is a deck-agnostic
  registry, so a replayed card's `shouldPlay` gate always ran. Only the
  package-gated *target* rules were unreachable.
- **Multiple copies of one card are not deduplicated** in
  `BidWarTactics.rankOpponentDiscardEvents`, and deliberately so: two copies of
  the same event are sometimes both worth playing. The per-card playbook gate is
  re-consulted before each play and is where "this one adds nothing" belongs —
  which is exactly how the second Clarity of Purpose is now refused.
- The fallback cannot help a card with no rule anywhere; that still uses the
  generic picker, which is the intended floor.

## Tests

`test/server/bots/kachikoreplaylogic.spec.js` drives the two real prompts in
order (the action window that chooses the replay, then the target prompt it
opens) and covers: a replayed Clarity routed through the Phoenix rule with the
protection applied; a replayed Way of the Crane routed through the Crane honor
rule; the same card NOT replayed staying on the generic path; a package the deck
actually runs surviving; and the round boundary clearing the replay set.

4 of the 6 fail against the pre-fix build. The 2 that pass are negative
controls.

## Related: the duel `Honor Bid` prompt

`HonorBidPrompt` returns one `promptTitle` for the draw-phase bid AND for a duel
bid, so `JigokuBotPolicy`'s per-round latch reset runs mid-conflict whenever a
duel is initiated. That wiped the Clarity accepted-target memory (fixed in
`bot-clarity-of-purpose-target.md`).

The other latches in that block were reviewed and **deliberately left alone**:

| Latch | Why a duel-time reset is harmless |
| --- | --- |
| `boardAbilityUsed` (Agasha Shunsen et al.) | A card Action is once per round in the ENGINE. Measured in `test/server/integration/botduelbidlatch.spec.js`: after a duel bid the bot issues **zero** extra Shunsen clicks and **zero** extra rejected commands — the deck gate's own precondition (claimed rings) is consumed by the ability, so it stops asking. |
| `wayOfPhoenixUsedThisPhase` | Max one per phase and only useful in the conflict phase, so it is already once per turn. |
| `kachikoReplaysThisRound` | The engine counts Kachiko's three uses itself (`cardsPlayedThisRound` on the card). The bot's counter only stops it *proposing* a fourth. |

Watched by `test/server/integration/botduelbidlatch.spec.js`, which asserts both
that the ability cannot resolve twice and that the seat wastes no clicks
rediscovering it.
