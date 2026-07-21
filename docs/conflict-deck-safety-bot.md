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

