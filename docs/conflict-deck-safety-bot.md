# Conflict-deck safety

Seeds 1 and 3 share `ConflictDeckSafetyTactics`. Seed 2 deliberately keeps the
legacy behavior for controlled comparisons.

The module protects optional conflict-deck consumption. It receives the bot's
remaining conflict deck, current honor, phase, the amount an optional effect
would consume, and visible opposing cards with forced future effects. It keeps
enough cards for the next mandatory draw and known public draws, and declines
an optional effect when the resulting reshuffle would cost five honor at a
lethal honor total.

Current consumers are:

- Oracle of Stone: optional draw 2;
- Forgotten Library: optional draw 1;
- Shrine Maiden: optional reveal/consume 3. Only its reaction is declined; the
  character may still be played.

Bayushi Shoju is the first public future-effect model: his visible conflict
phase draw and honor loss are reserved only when he can reach that conflict
phase. The module does not inspect hidden cards and therefore is not an
omniscient feature.

All thresholds and public card mappings are injectable through
`DeckProfile.conflictDeckSafety`. Add future optional consumption as playbook
metadata rather than duplicating gates in card-specific policy branches.

Regression coverage lives in `conflictdecksafetytactics.spec.js`; the
specialized policy suite also proves normal play/replay intent still executes
when the deck has safe capacity.

## The other half: the DRAW BID (2026-08-23)

This module guards OPTIONAL consumption — an extra draw the bot chooses to
take. It never saw the largest consumer of all, the draw-phase honor bid, which
is mandatory once revealed and is usually the biggest single draw of the round.

A bid larger than the conflict deck reshuffles the discard and costs a flat 5
honor (`player.ts deckRanOutOfCards`, 3 in Skirmish) on TOP of the honor
transferred to the lower bidder. Measured live: 8 honor and ONE card left, the
bot bid 5 into an opponent bid of 1, gave 4 away, then lost 5 for the
reshuffle, and the game ended at 0.

`DrawBidTactics.deckExhaustionAware` (shipped on) projects the exhaustion and
re-runs the whole bid analysis at `myHonor - deckExhaustionHonorLoss`, so the
honor rails choose for the honor the bot will actually hold. Note the engine
rule the two modules share: the penalty fires when the draw is **strictly
larger** than the deck, so bidding it to exactly zero is free.

See [draw-bid-bot.md](draw-bid-bot.md) and
[bot-phoenix-replay-2026-08-23.md](bot-phoenix-replay-2026-08-23.md).
