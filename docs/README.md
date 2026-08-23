# Jigoku docs index

Bot documentation, grouped by what you are trying to do. Tags: **SHIPPED** (in
live play now), **REJECTED** (measured and turned off — read before
reproposing), **REFERENCE** (how something works), **HISTORY** (kept for the
record; superseded).

Before changing bot behaviour, read the root `CLAUDE.md` and the `/roundrobin`
skill. A green spec is not evidence that a mechanism is reachable, and a
single-base measurement has produced false positives here.

## Start here

| Doc | What it covers |
|---|---|
| [heuristic-bot.md](heuristic-bot.md) | **REFERENCE** — the V1 bot end to end: how a prompt becomes a click, what each module owns |
| [bot-v2.md](bot-v2.md) | **REFERENCE** — why V2 exists (measurement rig, not an opponent) and the V1/shared/V2 boundary |
| [deck-profiles.md](deck-profiles.md) | **REFERENCE** — how per-deck knowledge is injected as data instead of branches |
| [implementing-cards.md](implementing-cards.md) | **REFERENCE** — writing a card in the game engine (not bot-specific) |
| [auto-triggered-role-reactions.md](auto-triggered-role-reactions.md) | **SHIPPED** — Seeker/Keeper fate reactions resolve without a prompt (not bot-specific) |
| [bot-dead-code-removed.md](bot-dead-code-removed.md) | **HISTORY** — what the 2026-08-13 cleanup deleted and why it was unreachable |

## V1 subsystems

| Doc | What it covers |
|---|---|
| [fate-aware-bot.md](fate-aware-bot.md) | **SHIPPED** — seed 1's fate economy, the default policy |
| [board-aware-dynasty-bot.md](board-aware-dynasty-bot.md) | **SHIPPED** — seed 3's board-relative dynasty development |
| [conflict-phase-lookahead-bot.md](conflict-phase-lookahead-bot.md) | **SHIPPED** — planning the whole conflict phase as a sequence |
| [draw-bid-bot.md](draw-bid-bot.md) | **SHIPPED** — draw-phase honor bidding |
| [mulligan-bot.md](mulligan-bot.md) | **SHIPPED** — mulligan and province refresh |
| [conflict-deck-safety-bot.md](conflict-deck-safety-bot.md) | **SHIPPED** — not decking yourself out |
| [omniscient-bot.md](omniscient-bot.md) | **SHIPPED** — the hidden-information capability, independent of seed |
| [discard-replay-bot.md](discard-replay-bot.md) | **REFERENCE** — playing paid cards out of a discard pile |
| [bot-effect-polarity.md](bot-effect-polarity.md) | **SHIPPED** — the ready/honor-ours vs bow/dishonor-theirs invariant, watched in real games |
| [bot-honor-token-targeting.md](bot-honor-token-targeting.md) | **SHIPPED** — who picks the side on a combined honor/dishonor prompt |
| [bot-conflict-rules-from-replays.md](bot-conflict-rules-from-replays.md) | **REFERENCE** — conflict rules derived from human games |

## Measured experiments

| Doc | Result |
|---|---|
| [bot-save-fate-pass.md](bot-save-fate-pass.md) | **SHIPPED** the early-round fate floor (+2.22pp then +4.14pp); the dynasty-phase **skip is REJECTED twice** — do not repropose |
| [bot-unopposed-window.md](bot-unopposed-window.md) | **SHIPPED** +0.53pp — buy a body and declare into an all-bowed board |
| [bot-fate-strip.md](bot-fate-strip.md) | **SHIPPED** +1.13pp — fate removal aims at the lowest-fate enemy, not the fattest |
| [bot-phoenix-replay-2026-08-23.md](bot-phoenix-replay-2026-08-23.md) | **SHIPPED** +3.13pp on the two Kyuden Isawa decks, plus two field-wide correctness fixes, all four read off one lost game |
| [bot-conflict-tempo.md](bot-conflict-tempo.md) | **MIXED** — the water ready-loop SHIPPED (+0.32pp) and `tradeDefenseWinOnly` ships on a measured null at the owner’s call; the rest is why defense *sizing* is settled as a free parameter in both directions |
| [bot-fate-starvation.md](bot-fate-starvation.md) | **REFERENCE** — the conflict-window census behind the fate levers |
| [bot-fate-experiments-recovery.md](bot-fate-experiments-recovery.md) | **HISTORY** — removed fate experiments and how to rebuild them |
| [bot-v2-rejected-experiments.md](bot-v2-rejected-experiments.md) | **REJECTED** — the master list. Check it before proposing any bot idea |

## Per-deck bots

| Doc | Deck |
|---|---|
| [crane-baseline-bot.md](crane-baseline-bot.md) | Crane baseline — the standard opponent |
| [duel-bot.md](duel-bot.md) | Crane Duels |
| [bot-crane-honor.md](bot-crane-honor.md) | Crane Courtier Honor (Seven Fold Palace) |
| [lion-bot.md](lion-bot.md) | Lion Swarm |
| [bot-lion-honor.md](bot-lion-honor.md) | Lion Honor (Kyūden Ikoma, 25-honor race) |
| [bot-lion-duelist.md](bot-lion-duelist.md) | Lion Duelist (Kyūden Ikoma honor switch) |
| [dragon-bot.md](dragon-bot.md) | Dragon Monks |
| [dragon-attachments-bot.md](dragon-attachments-bot.md) | Dragon Attachments |
| [glory-bot.md](glory-bot.md) | Phoenix glory engine |
| [phoenix-shugenja-bot.md](phoenix-shugenja-bot.md) | Phoenix Shugenja |
| [phoenix-phoenix-bot.md](phoenix-phoenix-bot.md) | Phoenix Fushichō rotation |
| [dishonor-bot.md](dishonor-bot.md) | Scorpion Poison Mill |
| [bot-scorpion-bid-war.md](bot-scorpion-bid-war.md) | Scorpion Bid War (Kyuden Bayushi) |
| [bot-crab-sacrifice.md](bot-crab-sacrifice.md) | Crab Berserker Sacrifice (Castle of the Forgotten) |
| [unicorn-bot.md](unicorn-bot.md) | Unicorn |
| [unicorn-reveal-bot.md](unicorn-reveal-bot.md) | Unicorn reveal engine |

## V2 (measurement infrastructure)

| Doc | Status |
|---|---|
| [bot-v2.md](bot-v2.md) | **REFERENCE** — read this one first |
| [bot-v2-architecture.md](bot-v2-architecture.md) | **REFERENCE** — module layout |
| [bot-v2-deck-tuning.md](bot-v2-deck-tuning.md) | **HISTORY** — superseded 2026-08-02 |
| [bot-v2-per-deck-plan.md](bot-v2-per-deck-plan.md) | **HISTORY** — superseded 2026-08-02 |
