# Fate-Aware Heuristic Bot (Default)

`FateAwareJigokuBotPolicy` is the default seed-1 policy and remains a separate
copy of the generic heuristic bot. Seed 5 uses this same policy plus its
omniscient hidden-information context.
It inherits all conflict, targeting, card-playbook, and deck-profile behavior,
but opts into a different dynasty economy and ring-fate rule. The previous
`JigokuBotPolicy` remains available as seed 2.

## Selection

Select **Fate-aware heuristic (default)** in the Jigoku client's bot
difficulty dropdown. It sends seed `1`. Direct callers can
use seed 1:

```json
{
  "bot": {
    "enabled": true,
    "seed": 1
  }
}
```

or the explicit policy selector used by controlled comparisons:

```json
{
  "bot": {
    "enabled": true,
    "policy": "fate-aware"
  }
}
```

Use seed `2` for the old generic heuristic and seed `5` for fate-aware plus
omniscient logic. Explicit `policy` is intended for paired analysis overrides.

## Economy Rules

- Rounds 1-2:
  - Prefer one affordable 4+ cost character over cheap characters.
  - Put as much fate as possible on it, up to 3 additional fate and 9 total
    dynasty fate spent that round, then pass.
  - When only 0-3 cost characters are available, spend at most 6 fate total.
    Cost-3 characters receive up to 1 additional fate; cheaper characters
    receive 0.
- Round 3 onward:
  - A 4+ cost character receives up to 2 additional fate, then the bot passes.
  - Cheap-character spending is capped at 4 fate per round.
  - If two characters already have fate, the cheap-character cap drops to 3.
- Passing after the planned purchase preserves fate and seeks the first-pass
  dynasty bonus.
- Any unclaimed ring holding at least 1 fate gets the same overriding priority
  that the generic policy gives only to rings holding 2+ fate.

These are the default values of the injectable `fateAwareEconomy` deck-profile
object. They apply only to the fate-aware copy. A deck profile can override the
purchase order, durable-character definition, spend caps, additional fate,
post-durable passing, and conflict-card reserve without adding clan branches to
the shared policy.

### Lion swarm override

The Hayaken no Shiro profile needs more bodies than the generic durable-unit
plan, but the first cheap-first experiment produced disposable boards. Its
current hybrid profile therefore:

- treats only Akodo Toturi, Commander of the Legions, and Honored General as
  durable characters and gives them up to 2 additional fate;
- buys a visible durable character first, but may continue buying bodies
  afterward instead of automatically passing;
- spends up to 6 fate on ordinary bodies in rounds 1-2 and 5 later, with the
  durable purchase excluded from that body budget;
- orders ordinary bodies cheapest-first, puts no extra fate on them, and keeps
  1 fate in reserve when buying them.

Measured against fate-aware Crane at N=100: the local pre-change baseline was
42%, a cheap-first/body-only first tuning fell to 33%, and the durable-plus-body
fine-tuning recovered to 42%. A deterministic paired trace of the final profile
met the round-3+ target in 4/4 conflict starts and averaged 4.25 characters, but
the 100-game result shows no win-rate improvement yet.

## Dynasty Cost Hints

The controller supplies printed costs because public card summaries omit them.
It now enumerates every real province slot with `getDynastyCardsInProvince`,
flattens all cards in each slot, and records every face-up card by UUID. This is
important for Rally and other effects that put multiple characters or holdings
in one province: every face-up character in the stack remains independently
selectable and receives its own correct cost.

The first implementation incorrectly called `getProvinces`, which returns the
province cards rather than dynasty cards inside them. As a result, all dynasty
characters appeared to cost zero: expensive characters were selected as cheap,
received zero additional fate, and were recognized as strong only after the
engine reported their true play cost. The original 39.4% fate-aware result was
therefore an implementation-bug result, not a valid test of the economy rules.

## Win-Rate Comparison

Run from `jigoku/` after `npx tsc`:

```bash
node tools/selfplay/winRates.js 100 1 1
node tools/selfplay/winRates.js 100 2 2
```

Arguments are `games_per_deck challenger_seed crane_seed`. The first command
runs fate-aware challengers against fate-aware Crane. The second runs the old
heuristic on both sides; `node tools/selfplay/winRates.js 100 1 2` directly
compares fate-aware challengers against old-heuristic Crane. Seats alternate. The
table below records the pre-renumbering controlled result from 2026-07-15,
where both challenger policies were measured against generic Crane (100 games
per deck):

| Deck | Generic | Fate-aware | Change |
|---|---:|---:|---:|
| Scorpion | 94% | 90% | -4 pp |
| Unicorn | 80% | 90% | +10 pp |
| Phoenix Shugenja | 75% | 85% | +10 pp |
| Phoenix | 69% | 86% | +17 pp |
| Dragon Attachments | 80% | 81% | +1 pp |
| Lion | 68% | 77% | +9 pp |
| Dragon | 67% | 71% | +4 pp |
| Crab | 64% | 84% | +20 pp |
| Crane Duels | 53% | 67% | +14 pp |
| **All games** | **72.2%** | **81.2%** | **+9.0 pp** |

Undecided games count as non-wins in the displayed percentages, matching the
win-rate script. Generic had 4 undecided games; fate-aware had 2.

## Current Status

Seed 1 is the deployed default. `FateAwareJigokuBotPolicy` remains a separate
class so seed 2 can preserve the old heuristic for controlled comparisons, but
it is no longer treated as an experimental client option. Later deck profiles
added swarm, tower, conflict-card economy, and stronghold-defense overrides.
Draw-phase bidding is now a separate shared `DrawBidTactics` module used by
both policies, so seed 2 keeps its old dynasty policy while gaining the same
adaptive draw economy. `LegacyDrawBidTactics` isolates the pre-refactor dial
when a controlled comparison needs it. See `draw-bid-bot.md`.
Therefore the historical table above is evidence for the initial switch, not a
current win-rate baseline. Standardized current results come from
`winRates.js` and `botRoundRobin.js` as described in `heuristic-bot.md`.
