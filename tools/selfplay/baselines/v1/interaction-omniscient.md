# Bot interaction-cycle validation

Generated: 2026-07-21T13:20:36.854Z

Games: 1 per deck/opponent/seed; seeds 1, 2, 3; opponents Crane; omniscient on.

| deck | seed | status | games | clicks | rejected | unsupported | forced | cycles | no-progress | same-action | budgets | stalls | max/tick |
|---|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Crane | 1 | PASS | 1 | 533 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| CraneDuels | 1 | PASS | 1 | 353 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| Crab | 1 | PASS | 1 | 529 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Dragon | 1 | PASS | 1 | 352 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| DragonAttachments | 1 | PASS | 1 | 925 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Lion | 1 | PASS | 1 | 725 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| Phoenix | 1 | PASS | 1 | 382 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| PhoenixShugenja | 1 | PASS | 1 | 787 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Scorpion | 1 | PASS | 1 | 401 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Unicorn | 1 | PASS | 1 | 292 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Crane | 2 | PASS | 1 | 216 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| CraneDuels | 2 | PASS | 1 | 256 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Crab | 2 | PASS | 1 | 397 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Dragon | 2 | PASS | 1 | 657 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| DragonAttachments | 2 | PASS | 1 | 313 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Lion | 2 | PASS | 1 | 344 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Phoenix | 2 | PASS | 1 | 500 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 12 |
| PhoenixShugenja | 2 | PASS | 1 | 328 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Scorpion | 2 | PASS | 1 | 243 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Unicorn | 2 | PASS | 1 | 222 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Crane | 3 | PASS | 1 | 360 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| CraneDuels | 3 | PASS | 1 | 414 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Crab | 3 | PASS | 1 | 379 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| Dragon | 3 | PASS | 1 | 270 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| DragonAttachments | 3 | PASS | 1 | 325 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Lion | 3 | PASS | 1 | 297 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Phoenix | 3 | PASS | 1 | 410 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| PhoenixShugenja | 3 | PASS | 1 | 491 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Scorpion | 3 | PASS | 1 | 293 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| Unicorn | 3 | PASS | 1 | 206 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |

Overall: **PASS** — 0 failed run(s), 0 warning run(s), 30 total.

## Gates

- Periodic cycles: 3+ repeats, period up to 8.
- No-progress clicks: 4+ accepted clicks with unchanged structural game state.
- Identical prompt/action: 5+ consecutive clicks.
- Per-tick click cap: 35; controller hard budget is 40.
- Rejections: warning through 3, failure above it.
- Unsupported prompts, forced-progress recovery, controller budget exhaustion, stalls, timeouts, step caps, and engine errors always fail.

Full per-run diagnostics and samples are in sibling JSON file.