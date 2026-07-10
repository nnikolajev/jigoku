# Per-deck bot tuning profiles (`DeckProfiles.ts`)

The heuristic bot used to branch directly on three `DeckStrategy` booleans
(`aggressive` / `defensive` / `holdingEngine`) with hard-coded constants
scattered through `JigokuBotPolicy`. That made per-deck tuning mean editing the
shared decision code and risking the fine-tuned Unicorn default.

`DeckProfiles.ts` lifts those constants into a single **`DeckProfile`** — a set
of named knobs — so a deck's playstyle is DATA, not `if` statements. The policy
reads the knobs; the profile is chosen per deck.

## The knobs

| Knob | Meaning |
|------|---------|
| `mulliganForHoldings` | dig opening provinces toward holdings (Kaiu Wall) |
| `digWithActions` | fire dynasty Action diggers (Kyuden Hida, engineers) |
| `digMinBoardCharacters` | only dig once this many own characters are in play (0 = always) |
| `aggressiveFate` | flood cheap bodies, deploy 0-1 fate |
| `forceMilitaryConflict` | always declare military while any military skill exists |
| `attackCommitment` | `all` / `all-but-one` / `breakable-or-hold` / `breakable-or-pressure` |
| `attackKeepHome` | bodies kept home under the pressure / all-but modes |
| `defenseCommitment` | `win-only` (rush) / `prevent-break` |
| `spendCardsOnDefense` | play conflict cards / fire abilities to defend |

## How a deck gets its profile

```
DeckStrategy flags ──profileFromStrategy()──▶ base profile ──resolveDeckProfile()──▶ final profile
   (marker cards)     (exact old behavior)        (+ per-deck OVERRIDES)              context.profile
```

- **`profileFromStrategy(strategy)`** reproduces the previous flag-driven
  behavior EXACTLY — a pure refactor. Generic deck = `DEFAULT_PROFILE`;
  aggressive layers the rush knobs; defensive/holding layer the turtle knobs.
  Unicorn and Crane are unchanged (bot spec suite stays green, 98/0).
- **`resolveDeckProfile(cardIds, strategy)`** then merges any matching entry from
  the `OVERRIDES` list. An override is matched by **card contents + derived
  strategy** (not a deck id), so it applies in both live play and self-play.
- The controller (`currentDeckProfile`) builds this once from the bot's cards and
  passes it as `context.profile`; `JigokuBotPolicy.decideForPrompt` resolves it
  (falling back to `profileFromStrategy(context.strategy)` when a caller passes
  only strategy, e.g. unit tests).

## Adding / tuning a deck

1. Confirm the deck's `DeckStrategy` flags are derived correctly
   (`CardPlaybook.deriveDeckStrategy` marker lists).
2. If the strategy-derived profile underperforms, add an entry to `OVERRIDES`
   with a `match` predicate (gate it so no other deck is affected — the Unicorn
   default must stay intact) and an `apply` partial of the knobs to change.
3. Measure with self-play before/after (see below). Keep the change only if it
   is a clear, repeatable improvement.

Anything a deck needs that is NOT expressible as a knob stays hard-coded for the
Unicorn default — do not generalize the shared code for one deck's quirk; add a
knob or an override instead.

A deck with a genuinely different PLAYSTYLE (not just different values for the
generic knobs) gets its own tactics module hung off the profile: see
`dishonor?: DishonorProfile` (`DishonorTactics.ts`, doc `dishonor-bot.md`) for
the Scorpion Poison Mill deck. Same gating rule: the sub-profile exists only
for decks whose strategy derives it, and every policy hook checks its presence.

## Case study: Crab Defense (EmeraldDB 3a8006b7)

The Crab precon "let the opponent roll over it" — it lost to the Crane precon
**2-18** (seed 1). Trace of the losing Crab seat showed the cause:

- `dynasty-dig-action` **49×** but `play-dynasty-character` only **8×** — it
  churned its holding engine instead of playing bodies, so it had almost no
  defenders on the board.
- `initiate-conflict` **1×**, `defensive-hold` **10×** — the derived defensive
  profile HELD every attack it could not guarantee to break, so it had zero
  offense and no win condition.

Both are now knobs. The `crab-defense` override:

```
attackCommitment: 'breakable-or-pressure'   // attack for pressure when a clean break is out of reach
attackKeepHome: 2                           // keep two wall bodies home to defend
digMinBoardCharacters: 3                     // dig only once 3+ of its own characters are in play
```

Result vs the Crane precon (self-play, seeds alternate seats, N=40):

| | before | after |
|---|--------|-------|
| Crab seed 1 win rate | ~10% (2-18) | **~45%** |
| Crab seed 4 win rate | ~5% (1-19) | **~45%** |

After the fix the Crab seat plays bodies (8 → 22), digs sparingly (49 → 8), and
actually attacks (1 → 8 initiations) while keeping its defense. It no longer
rolls over; it trades roughly evenly. Unicorn and Crane profiles are unchanged.

## Case study: Unicorn Cavalry Rush (EmeraldDB ef93bae2)

The aggressive rush profile was tuned in the Unicorn seed-4 mirror, but the
Crane precon rolled it (~23% win rate, pooled N=160): Crane defends
`prevent-break`, so the all-in attacks bounced off committed defenders, while
every Crane counterattack was conceded (`win-only` + no cards on defense) —
Crane broke provinces for free and won the conquest race by round ~5.

Two fixes shipped together:

1. **Cancel-loop veto (generic policy fix, every deck benefits).**
   Assassination was clicked 200+ times per match: play → only own characters
   were legal targets → cancel → the prompt-signature flip cleared the
   attempted-set → play again, burning every conflict window. Now a source
   card whose targeting cancels twice for lack of a valid-side target is
   vetoed until the next round (`cancelledSources` in the policy), and
   Assassination's playbook gate additionally requires a KNOWN
   cost-2-or-less enemy participant (via the DeckAnalysis card models).
2. **The `unicorn-cavalry-rush` override** (matched on `aggressive` +
   `cavalry-reserves`): keep the military pressure (`forceMilitaryConflict`,
   cheap-body flood in the dynasty phase) but flip
   `defenseCommitment: 'prevent-break'`, `spendCardsOnDefense: true`,
   `attackCommitment: 'all-but-one'`, `aggressiveFate: false` — the board
   persists across fate phases and provinces get defended.

Swept vs the Crane precon (every knob combination measured, N=20-40 per run):
defense alone ~50%, fate alone ~40%, defense+fate ~57%, all three
**~68% seed 1 (41-19, pooled N=60) / ~63% seed 4 (25-15, N=40)** — locked.
Regression checks on the final build: Crab vs Crane 19-21 (~47%), Scorpion vs
Crane 12-8 (both in their bands).

## Measuring in self-play

`tools/selfplay/harness.js` `runGame({ names, seeds, deckA, deckB })` runs a
headless game; `deckLoader` exports `loadUnicornDeck() / loadCraneDeck() /
loadCrabDeck()`. Alternate the seats to cancel first-player advantage. To inspect
a seat's decisions, pass `onControllers: (controllers) => …` and read
`controller.trace` (reason histogram) after the game.
