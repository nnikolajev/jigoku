# Bot interaction-cycle validation

Generated: 2026-07-21T13:20:40.809Z

Games: 1 per deck/opponent/seed; seeds 1, 2, 3; opponents Crane; omniscient off.

| deck | seed | status | games | clicks | rejected | unsupported | forced | cycles | no-progress | same-action | budgets | stalls | max/tick |
|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Crane | 1 | PASS | 1 | 372 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| CraneDuels | 1 | PASS | 1 | 344 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Crab | 1 | PASS | 1 | 610 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Dragon | 1 | PASS | 1 | 416 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| DragonAttachments | 1 | PASS | 1 | 306 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Lion | 1 | PASS | 1 | 482 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Phoenix | 1 | PASS | 1 | 281 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| PhoenixShugenja | 1 | PASS | 1 | 327 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Scorpion | 1 | PASS | 1 | 460 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Unicorn | 1 | PASS | 1 | 398 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Crane | 2 | PASS | 1 | 272 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| CraneDuels | 2 | PASS | 1 | 573 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| Crab | 2 | PASS | 1 | 436 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Dragon | 2 | PASS | 1 | 703 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 13 |
| DragonAttachments | 2 | PASS | 1 | 485 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| Lion | 2 | PASS | 1 | 560 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| Phoenix | 2 | PASS | 1 | 321 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 19 |
| PhoenixShugenja | 2 | PASS | 1 | 409 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| Scorpion | 2 | PASS | 1 | 384 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Unicorn | 2 | PASS | 1 | 346 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Crane | 3 | PASS | 1 | 403 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| CraneDuels | 3 | PASS | 1 | 477 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Crab | 3 | PASS | 1 | 357 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Dragon | 3 | PASS | 1 | 363 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| DragonAttachments | 3 | PASS | 1 | 263 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Lion | 3 | PASS | 1 | 527 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Phoenix | 3 | PASS | 1 | 406 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| PhoenixShugenja | 3 | PASS | 1 | 455 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Scorpion | 3 | PASS | 1 | 314 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| Unicorn | 3 | PASS | 1 | 210 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |

Overall: **PASS** — 0 failed run(s), 0 warning run(s), 30 total.

## Gates

- Periodic cycles: 3+ repeats, period up to 8.
- No-progress clicks: 4+ accepted clicks with unchanged structural game state.
- Identical prompt/action: 5+ consecutive clicks.
- Per-tick click cap: 35; controller hard budget is 40.
- Rejections: warning through 3, failure above it.
- Unsupported prompts, forced-progress recovery, controller budget exhaustion, stalls, timeouts, step caps, and engine errors always fail.

Full per-run diagnostics and samples are in sibling JSON file.