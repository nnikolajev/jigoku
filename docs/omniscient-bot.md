# Seed 4 — Omniscient (cheating) bot

> **Status: shipped, gated, opt-in.** Seed 4 is the seed-1 heuristic plus a
> perfect-information cheat layer. It is selected in the lobby's **Bot
> difficulty** dropdown ("Omniscient (cheating — hardest)"). It never affects
> seed 1 — every cheat branch is gated on a context object that is only built
> for seed 4.

## What it is

Seed 4 keeps the entire seed-1 heuristic policy and feeds it the human's hidden
information: the true contents of the human's hand, their fate, and the real
strength of every province including the face-down ones. A fair bot cannot see
any of this. The idea (user's): a bot that knows what the human is holding can
target the weakest province, press when the human cannot fight back, and avoid
walking into what it cannot win — a genuinely hard opponent whom a good human can
still beat on decision-making.

The seeds:

| Seed | Bot | Notes |
|------|-----|-------|
| blank / 1 | Heuristic | fair, no hidden info |
| 2 | LLM-driven | per-click LM Studio, slow, experimental |
| 3 | Self-play ML | learned evaluator, not competitive (see `seed3-selfplay.md`) |
| **4** | **Omniscient (cheat)** | **seed-1 heuristic + sees hand/fate/face-down provinces** |

## How it works

```
JigokuBotController (seed 4)                     JigokuBotPolicy
  buildOmniscient(me)  ── context.omniscient ──▶   omniscient branches
   reads me.opponent (live Player):                (gated on `omni`)
     · hand  → KnownCard[]  (real cards)             · attackProvinceDecision
     · fate                                          · omniAttackedStrength
     · provinces → true strength (even face-down)
```

- **`DeckAnalysis.ts`** — the "deck analysis". A curated per-card conflict model
  (fate cost, mil/pol skill, buff, event swing, tag) for the cards of the Crane
  Duels deck (EmeraldDB `b59bc6b3`, the deck the user plays). Card BODIES are
  read live from the game objects, so any deck's characters/attachments are
  covered exactly; the registry adds what a live object cannot express — what an
  EVENT does (a duel, a removal). `estimateHandThreat(hand, fate, type)` returns
  a realistic single-conflict threat (best affordable body + best affordable
  trick, **not** the sum of the whole hand). `getCardModel(id)` looks a card up.
- **`JigokuBotController.ts`** — `isOmniscient()` (seed 4), `buildOmniscient(me)`
  assembles the cheat view from the live opponent `Player` each tick,
  `knownCard()` overlays live stats with the registry, `opponentProvinces()`
  reads true strengths, and `ensureDeckAnalyzed()` is the one-time gate that
  reports which of the human's conflict events (if any) are unmodeled.
- **`JigokuBotPolicy.ts`** — `context.omniscient` drives two live behaviors:
  1. **Weakest-province targeting** (`attackProvinceDecision`) — strikes the
     weakest unbroken province first by TRUE strength, instead of board order.
  2. **True-strength sizing** (`omniAttackedStrength`) — the break math uses the
     real strength of the (even face-down) attacked province instead of the
     heuristic's guess-4 fallback.

## Deck-analysis gate

The user's requirement: "if seed 4 is chosen and the deck is not yet analyzed it
needs to be analyzed first." The analysis is the static `DeckAnalysis` registry;
Crane Duels ships fully analyzed. At game start the omniscient bot scans the
human's whole deck for conflict events with no curated model and reports coverage
in the game log:
- fully modeled → "has analyzed the opponent deck: all N conflict events
  modeled."
- gaps → "is blind to K unanalyzed opponent card(s); add them to DeckAnalysis
  for full strength." The bot still plays (bodies are read live); it is only
  blind to those specific event tricks.

To analyze a new opponent deck, add its conflict events to `ANALYSIS` in
`DeckAnalysis.ts` (fetch card text from `https://www.emeralddb.org/api/cards`).

## What was tried and MEASURED NET-NEGATIVE (kept off)

The user asked for the bot to size attacks against the human's hand, hold
conflicts it cannot win, and concede lost defenses. All were implemented and
tested in self-play (seed 4 vs seed 1, alternating seats, deck held constant so
strength cancels). All three **hurt** and are gated off; the plumbing (`_omni`
params, `estimateHandThreat`) is kept and unit-tested for a more careful future
attempt:

- **Hand-threat attack sizing** (fold the human's affordable hand defense into
  the break target) — made the bot over-commit against defense that never
  materialized and lose bodies it needed for later conflicts. Crane mirror
  dropped below 50%; higher threat scale was strictly worse.
- **Defender pump** (defend against the human's post-commit hand pump) — made the
  bot over-concede and stall. **Crane mirror 0-12.**
- **Window hold** (as attacker HOLD when the human can swing out of reach; as
  defender concede a provably lost conflict) — over-held and passed winnable
  conflicts. **Crane mirror regressed to 1-11.**

Lesson (same as seed 3): the seed-1 commit/defend heuristic is well tuned;
speculative overrides of *how much to commit* degrade it, because the bot
opponent defends optimally while the estimate assumes worst case. The safe,
positive cheat is *what to target*, not *how much to spend*.

## Result

Self-play mirror (seed 4 vs seed 1, same deck, alternating seats):

| Deck | N | seed 4 | seed 1 |
|------|---|--------|--------|
| Unicorn (military) | 40 | **28 (70%)** | 12 |
| Crane (duel/honor) | 30 | 15 | 15 |

Weakest-province + true-strength targeting is a clear win on a military
province-breaking deck (Unicorn 70%) and neutral on Crane, whose game is decided
by duels/honor rather than raw break math. Against a real (imperfect) human the
cheat is meaningfully harder than seed 1: it never wastes an attack on a strong
face-down province when a weak one is open. Bot spec suite stays green (93/0,
incl. 4 new `DeckAnalysis` tests).

## How to run / test

```bash
# from jigoku/, after npx tsc
npx jasmine test/server/bots/deckanalysis.spec.js           # analysis unit tests
npx jasmine test/server/bots/jigokuheuristicbot.spec.js     # seed-1 unchanged (89/0)

# self-play mirror to measure seed 4 vs seed 1 (deck constant, seats alternate):
#   runGame({ names, seeds:[4,1], deckA, deckB })  via tools/selfplay/harness.js
#   deckLoader exports loadUnicornDeck() and loadCraneDeck()
```

Live: pick **Omniscient (cheating — hardest)** in the lobby Bot difficulty
dropdown (passes bot `seed: "4"`). Fixtures for the Crane deck live in
`tools/selfplay/fixtures/crane-decklist.json` + `crane-cards.json`.
