# Adaptive mulligan and province refresh

`MulliganTactics` is the shared, injectable policy for opening dynasty and
conflict mulligans plus end-of-fate dynasty discard. Adaptive mulligan is the
deployed default for every supported bot seed (1, 2, 3, and 4). `legacy` is
retained only as an explicit A/B configuration override.

## Inputs

Every decision receives selectable cards, the bot board, current fate, exact
stronghold income, round number, exact printed costs keyed by physical card
UUID, and the printed province under each dynasty-card location. Projected
next-turn fate is `current fate + income`.

UUID cost keys matter for Rally and other multi-card province stacks: every
character is evaluated independently. Cards on broken provinces are omitted
because the engine discards them automatically.

## Opening dynasty mulligan

The generic profile seeks either one durable 3-5 cost character with optional
support, or several 1-2 cost bodies when no strong affordable body exists.
Rush profiles raise the body target. Non-rush profiles preserve early-pass
value by limiting surplus bodies and holdings.

Crane prioritizes characters on Tsuma because they enter honored. It replaces
Iron Crane Legion in the opening because the card is stronger later. Kakita
Dojo and Proving Ground may coexist, but duplicate holdings do not consume
extra keep slots.

## Opening conflict mulligan

The generic rule keeps zero-cost cards and replaces cards with printed fate
cost. It uses exact live card costs, so a missing summary field cannot make a
paid conflict card look free.

## End-of-fate province refresh

The policy classifies the board as weak, developing, or strong. Weak boards
discard holdings aggressively and retain a playable character. Developing
boards search for a better durable body while retaining a fallback. Strong
boards may keep more holdings and search for a preferred replacement body.

All thresholds, holding limits, copy caps, and character priorities are in
the deck's `mulligan` profile and merge through
`DeckProfiles.resolveDeckProfile`.

Notable overrides:

- Crab may keep two opening holdings and three later, while preserving a body.
- Lion and Unicorn use wider rush settings and minimal holdings.
- Dragon Monks searches for Mitsu and Monk engines.
- Dragon Attachments searches for Niten Master, Togashi Yokuni, and towers.
- Scorpion searches for Bayushi Shoju and dishonor engines.
- Phoenix profiles preserve their relevant ring, spell, and holding engines.
- Crane Baseline and Crane Duels share Tsuma, Iron Crane Legion, duelist, and
  singleton-holding rules.

## Configuration and A/B

`JigokuBotConfig.mulliganPolicy` accepts `adaptive` or `legacy`. Omission now
means `adaptive` for every seed.

```powershell
# all decks and all supported seeds; adaptive versus explicit legacy
node tools/selfplay/compareMulliganPolicies.js

# focused comparison
node tools/selfplay/compareMulliganPolicies.js --games 40 --seeds 1,2,3 --decks Crab,Phoenix
```

The comparison alternates seats, writes Markdown and JSON under
`tools/selfplay/out/`, and never updates standardized client benchmarks.
Historical tuning reports remain in `tools/selfplay/out/mulligan-ab-*`.

The current direct A/B used 20 games per deck for seeds 1 and 2 and two seed-3
streams. Adaptive mulligan finished 208-192 (52.0%) on seeds 1/2 and 150-150
across the combined seed-3 streams. It is deployed as the shared default; the
legacy policy remains only for controlled comparisons.

## Regression coverage

`mulligantactics.spec.js` covers paid conflict cards, projected fate, stacked
province costs, broken-province exclusion, board bands, holding/copy limits,
Tsuma, Iron Crane Legion, and deck-family overrides. Controller tests lock the
adaptive default for seeds 1-3 plus explicit legacy injection. Use
`validateBotInteractions.js --seeds 1,2,3` as the no-cycle/stall gate.

The final deployed-default audit ran all ten decks on all three seeds against
Crane (30 games total). Every case passed with zero rejected clicks, detected
cycles, decision-budget failures, forced progress, stalls, or engine errors.
Report:
`tools/selfplay/out/omniscient-refactor-final-fair-interactions.{md,json}`.
