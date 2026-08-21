# Unicorn Reveal V1 bot

## Scope

This report covers the V1 bot implementation for the EmeraldDB deck **Unicorn Reveal** (`6057d28e-e023-4c9f-b027-475f13eaf394`). The exact list is cached as self-play fixtures: 1 stronghold, 1 role, 5 provinces, 40 dynasty cards, and 40 conflict cards, across 35 unique card IDs. Card IDs and counts are preserved.

The deck is registered as `UnicornReveal` in the common self-play catalogue, which makes it available to the win-rate, round-robin, seed, omniscient, head-to-head, interaction, and card-audit tools. The Jigoku client exposes the same EmeraldDB list as **Unicorn Reveal** in its pretrained bot-deck selector, and `standardBenchmarkSuite` in the client matches `STANDARD_SUITE_ID` in `tools/selfplay/standardBenchmark.js` (`crane-baseline-4736f7c0-unicorn-reveal-6057d28e`).

## Strategy implemented

The bot treats public province knowledge as an economy resource:

1. Prefer attacking a facedown province, even when an exposed province is easier.
2. Prefer White Horde Vanguard in the first conflict and Shinjo Trailblazer when the attacked province is still hidden.
3. Reveal the opposing stronghold province first when Border Fortress, Iuchi Farseer, Overrun, or another legal reveal effect can select it.
4. Use Shiro Shinjo only when at least one opposing non-stronghold province is faceup.
5. Reserve 4 fate for Scouted Terrain once all four outer provinces are faceup.
6. If the opponent attacks while the Scouted plan is ready, preserve defenders unless the stronghold itself is threatened. After that attack completes, play Scouted Terrain and attack the now-eligible stronghold.
7. Without the Scouted line, retain the fate advantage and buy one durable threat with fate.

All deck-specific thresholds, IDs, fate amounts, target priorities, bid reduction, Scouted timing, and opponent Aranat response values live in `UnicornRevealProfile` or `ProvinceRevealResponseProfile`. The policy consumes those profiles through `UnicornRevealTactics` and `ProvinceRevealResponseTactics`; resolved profiles deep-clone every array/map so runtime tuning cannot leak between bots.

The controller exposes only fair/public data needed by this plan: province location, faceup/broken/stronghold state, visible ID/strength/ability class, live stronghold attackability, Massing-at-Twilight combined-skill state, and completed-conflict counts. Hidden opponent IDs remain hidden from fair seeds.

## Tuning plumbing fixed (2026-08-06)

Two defects blocked per-knob tuning of this deck. Both are fixed.

**1. Injected tuning arms silently dropped load-bearing data.** `JigokuBotController.decisionProfile` deep-merges a named set of tactics sub-profiles so an arm can set one knob instead of restating the whole object. `unicornReveal` and `provinceRevealResponse` were missing from that list, so any arm naming one knob fell through to a shallow spread and discarded every field it did not restate — including `revealSourceIds`, `redirectSourceIds`, `scoutedTerrainCardId`, and the fate/priority tables. An arm would then measure a broken deck rather than the knob.

Both keys were added, and the per-key merge was replaced with `JigokuBotController.mergeTacticsProfile`, which merges plain-object fields one level deeper. That matters because the tunable surface here is mostly lookup tables: an arm can now set `additionalFateByCharacterId: {"yoritomo": 0}` and change only Yoritomo, instead of zeroing every other character's fate. Arrays are still replaced wholesale, which is what an arm naming a list means.

**2. Reveal-attacker priority was unreachable after the first conflict.** The attacker-ordering block in `JigokuBotPolicy` was gated on `currentCompletedConflictsThisRound === 0`. That gate is correct for `firstConflictCharacterIds` — White Horde Vanguard's bow/move protection is genuinely first-conflict-only — but it also confined `unrevealedProvinceAttackerIds` to conflict 1, while the reveal reactions on Shinjo Trailblazer, Way Station Trader, and Ganzu Warrior fire in *any* conflict at a facedown province. Most reveals happen in conflicts 2-3, so the list was inert exactly where it mattered.

The gate is now split, behind the injectable flag `revealAttackerPriorityAllConflicts`. The Vanguard list stays first-conflict-only; the reveal list keeps applying for later conflicts. Way Station Trader and Ganzu Warrior joined `unrevealedProvinceAttackerIds`, since their reactions have the same participation requirement.

With the flag off, the refactor is **bit-identical** to the pre-change build: the no-profile field run reproduced `1807-1073 / 62.74%` exactly, game for game. The flag now ships `true` — see the tuning results below.

## The honor leak (2026-08-06)

The single largest defect in this deck was not in its own tactics module. `UnicornReveal` used `CARD_ENGINE_DRAW_BID_PROFILE`, whose `minimumRoutineBid: 4` makes the bot bid at least 4 every draw phase. The field routinely bids 2-3, and in this game the higher bidder gives honor equal to the difference to the lower bidder — so the deck was paying 1-2 honor per round, every round, for cards.

A probe of end-of-game honor made it obvious: Unicorn Reveal finished at 0-6 honor while opponents sat at 5-18, **including in games it won**. It was permanently one bad round from a dishonor loss, which is why 22% of its losses were dishonor and why the Scorpion matchup was 100% dishonor at the fastest average game length in the field.

The deck's economy is *fate*, not cards — Shiro Shinjo pays per revealed province. It does not need to buy draw with honor. `FATE_ECONOMY_DRAW_BID_PROFILE` bids low instead, which reverses the honor transfer: honor becomes income, and the deck still affords its hand out of stronghold fate.

## Card-by-card evaluation

Ratings describe value to this bot: **S** is a primary win/economy engine, **A** is a strong enabler or threat, **B** is solid support, and **C** is conditional.

### Stronghold, role, and provinces

| Card | Copies | Rating | Bot treatment |
|---|---:|:---:|---|
| Shiro Shinjo | 1 | S | Always triggers after fate collection when it produces at least 1 fate. Faceup outer provinces are counted from public state. Its ceiling is +4 fate because the printed ability excludes the stronghold province. |
| Seeker of Void | 1 | A | Always takes the free fate reaction when an own Void province is revealed. It also makes Appealing to the Fortunes strength 5. |
| Massing at Twilight | 1 | S | Placed under the stronghold. During its conflicts, military plus political is used for participant evaluation, defender commitment, and conflict-card budgeting. |
| Appealing to the Fortunes | 1 | A | Evaluated at strength 5 with the Void role. On break, selects the strongest legal character across hand/provinces and puts it into play. |
| Border Fortress | 1 | A | During its conflict, reveals a legal hidden opposing province; hidden stronghold is the first target when selectable. |
| Khan's Ordu | 1 | A | Always takes the reveal reaction. Its military conversion matches the deck's stronger axis and forced-military declaration profile. |
| Ancestral Lands | 1 | B | Live engine strength remains 10 in political conflicts and 5 in military. Because this deck forces military attacks, attack targeting correctly evaluates it at 5. |

### Dynasty deck

| Card | Copies | Cost | Rating | Bot treatment |
|---|---:|---:|:---:|---|
| Aranat | 3 | 6 | S | High-value durable threat with 2 additional fate. Note the built-in tension: Aranat self-fates `5 − opponent faceup provinces`, so it pays *least* when this deck's reveal plan has worked best. Cutting its additional fate was measured and rejected. Opponents use a shared response model: reveal only a province whose immediate on-reveal payoff is worth more than denying Aranat one fate. |
| Yoritomo | 3 | 5 | S | Durable fate-bank payoff with 2 additional fate. `modifyBothSkills(controller.fate)` reads the live fate pool, so additional fate lowers his own X — but it also keeps him in play, and removing it was measured strongly negative. |
| Moto Chagatai | 2 | 5 | A | Durable 2-fate threat. Province-break resolution supplies its ready value automatically. |
| Higashi Kaze Company | 3 | 5 | A | Durable 2-fate threat. Always takes its win reaction and selects the strongest legal no-fate participant so that character does not bow. |
| Kudaka | 2 | 4 | A | Reuses the existing Shugenja-deck logic and always takes its Air-claim fate/card reaction when legal. |
| Khanbulak Benefactor | 3 | 4 | S | Explicitly receives 0 additional fate to turn on Dire. Its enter-play draw-two reaction is always taken; live engine cost reduction handles the hand discount. |
| White Horde Vanguard | 3 | 4 | A | Receives 2 fate and is prioritized for the first conflict, where its bow/move protection is active. |
| Iuchi Daiyu | 3 | 4 | A | Receives 2 fate. Its Action uses the public count of opposing faceup outer provinces and buffs the strongest ready own participant. |
| Moto Horde | 3 | 4 | A | Receives 2 fate and is valued as efficient raw military pressure. |
| Iuchi Farseer | 3 | 3 | S | Receives 1 fate and always reveals an opposing hidden province on entry, with stronghold first when legal. |
| Ganzu Warrior | 3 | 2 | A | Receives 1 fate and always takes its once-per-conflict reveal reaction. The resulting ring prompt uses the bot's normal ring-effect target logic. |
| Shinjo Trailblazer | 3 | 2 | A | Receives 1 fate and is prioritized into attacks on hidden provinces to obtain the +2/+2 reveal reaction. |
| Way Station Trader | 3 | 2 | A | Receives 1 fate and triggers only while the opponent has at least 1 fate, preventing a zero-value reaction. |
| Audience Chamber | 3 | — | A | Keeps at most one copy and preserves it as a long-game engine. Its cost-4+ character reaction is always taken. |

### Conflict deck

| Card | Copies | Cost | Rating | Bot treatment |
|---|---:|---:|:---:|---|
| Scouted Terrain | 3 | 4 | S | Keeps one opening paid card, reserves 4 fate once enabled, waits for an opposing completed conflict, then opens the stronghold attack. |
| Chasing the Sun | 3 | 1 | S | Played while attacking when another hidden outer province remains; redirects and reveals without applying an irrelevant Seeker restriction. |
| Diversionary Maneuver | 3 | 2 | A | Used in a military attack with another hidden legal province. The engine performs the participant reset/move sequence; the bot then chooses the reveal target. |
| Overrun | 3 | 1 | S | Always takes the break reaction. It reveals a hidden province first; when everything is exposed, it targets the highest-priority province text, led by Massing at Twilight. |
| Outflank | 3 | 0 | A | Always takes the reveal reaction and prevents the strongest ready legal non-unique opponent from defending. |
| Speak to the Heart | 3 | 0 | B | Contribution equals the opposing faceup outer-province count and is spent only when conflict budgeting values the political swing. |
| Captive Audience | 3 | 0 | A | Uses the existing axis-swing model: play only as the attacker in political when the military-vs-political swing helps and honor is safe enough. |
| Good Omen | 3 | 0 | A | In later rounds, holding it reduces the normal draw bid by 1. With composure, it targets the strongest legal printed-cost-3+ character. |
| I Am Ready | 3 | 0 | A | Reuses Unicorn ready logic. Cheap reveal characters receive 1 fate, supporting two-conflict first-round lines. |
| Banzai! | 3 | 0 | A | Reuses the mature generic military contribution and safe honor-repeat logic. |
| Let Go | 3 | 0 | A | Reuses Dragon attachment-control scoring and removes the highest-value opposing attachment. |
| Scarlet Sabre | 3 | 0 | A | Free attachment pressure; existing attachment targeting selects a durable carrier, and its first-player fate-loss reaction resolves normally. |
| Ancestral Daishō | 2 | 1 | A | Reuses Dragon logic, targeting a high-fate carrier and valuing Ancestral return-to-hand reuse. |
| Fine Katana | 2 | 0 | B | Generic free +2 military model, explicit in the playbook and V2 fallback semantics. |

## Opponent response to Aranat

The response is shared across all deck profiles rather than hardcoded into Unicorn Reveal. Exact immediate reveal values are injectable. High-value reveal reactions such as Khan's Ordu, Offerings to the Kami, Retire to the Brotherhood, Sacred Sanctuary, Endless Plains, Elemental Fury, and Night Raid may be taken. Blank or action-only provinces are normally left facedown because revealing one both denies only one Aranat fate and increases Shiro Shinjo's future income.

The stronghold province is never selected by the opponent's Aranat prompt because Aranat permits only non-stronghold provinces; it still counts when Aranat determines remaining facedown provinces.

## Measurement method

A new deck is not a bot change, so the head-to-head rig in `.claude/skills/roundrobin/SKILL.md` is the wrong tool — there is no unchanged counterpart to play against, and a field round robin that moves every seat is zero-sum. The correct rig is `tools/selfplay/deckFieldWinRate.js`: one deck varies, the rest of the field is held fixed, every pairing is played twice on the same shuffle with the subject on each seat, across multiple independent shuffle bases.

An earlier version of this report quoted **60.9%** from `botRoundRobin.js --subject UnicornReveal --seed 1`. That number came from a single seed and was not base-replicated, so it has been retired and re-measured.

All numbers below: 8 bases (`91001`-`98001`), `GPB=15`, 12 opponents, **2880 games per arm**, `WORKERS=14`, `HARNESS_MAX_GAME_MS=180000`.

## Field win rate

**Shipped: 66.84%** (1925-955) on bases 91001-98001 and **66.11%** (1904-976) on bases 99001-106001 — 5760 games, 0 draws, 0 undecided. That is **+4.10pp** over the pre-tuning V1 build on the same bases.

The pre-tuning baseline, retained below because every tuning delta is measured against it:

**62.74%** (1807-1073 of 2880), 95% CI **[61.0, 64.5]**, 0 draws, 0 undecided.

| Base | Record | Win rate |
|---|---:|---:|
| 91001 | 230-130 | 63.89% |
| 92001 | 230-130 | 63.89% |
| 93001 | 232-128 | 64.44% |
| 94001 | 213-147 | 59.17% |
| 95001 | 227-133 | 63.06% |
| 96001 | 217-143 | 60.28% |
| 97001 | 225-135 | 62.50% |
| 98001 | 233-127 | 64.72% |

Every base lands between 59.2% and 64.7% with no sign flips, so the pooled figure is not carried by one lucky shuffle set. Seat split is 63.5% / 61.9%, so the deck is not meaningfully order-dependent.

| Opponent | Record | Win rate |
|---|---:|---:|
| PhoenixPhoenix | 210/240 | 87.5% |
| DragonAttachments | 182/240 | 75.8% |
| ScorpionBidWar | 176/240 | 73.3% |
| Crane | 169/240 | 70.4% |
| CraneDuels | 167/240 | 69.6% |
| Crab | 149/240 | 62.1% |
| Unicorn | 139/240 | 57.9% |
| Scorpion | 138/240 | 57.5% |
| Lion | 129/240 | 53.8% |
| PhoenixShugenja | 122/240 | 50.8% |
| Dragon | 113/240 | 47.1% |
| Phoenix | 113/240 | 47.1% |

Win reasons: 1776 conquest wins, 31 dishonor wins, 839 conquest losses, 232 dishonor losses, 2 honor losses. Average 4.8 rounds.

Per-opponent rows measure that matchup, not the change, and are reported for shape only. The deck is a conquest deck that wins by conquest: its losses are 78% conquest and 22% dishonor. The dishonor exposure is concentrated — **every Scorpion loss is a dishonor loss (102/102)** at 3.77 average rounds, and Crab takes 61 of its 91 wins by dishonor over the longest games in the field (5.87 rounds). Phoenix and Dragon beat it on conflict scaling instead.

## Tuning arms measured

Control is the **null arm**: a knob injected at its own default, which routes both seats through the same V2 pass-through path as a real arm. It scored 62.57% (1802-1078); nine of eleven opponent rows came back bit-identical to the no-profile baseline, so the injection path is behaviour-preserving and is the correct comparison for every arm below.

| Arm | Record | Win rate | vs null |
|---|---:|---:|---:|
| No profile (V1 baseline) | 1807-1073 | 62.74% | — |
| **null** (default injected) | 1802-1078 | 62.57% | control |
| Yoritomo 0 additional fate | 1658-1222 | 57.57% | **−5.00pp** |
| Aranat 0 additional fate | 1773-1107 | 61.56% | −1.01pp |
| Reveal list += Trader, Ganzu | 1803-1077 | 62.60% | +0.03pp |
| Reveal list += Trader | 1804-1076 | 62.64% | +0.07pp |
| `revealAttackerPriorityAllConflicts` | 1802-1078 | 62.57% | 0.00pp |
| Flag + expanded reveal list | 1810-1070 | 62.85% | +0.28pp |

**Yoritomo's additional fate is load-bearing and must stay at 2.** The card is `modifyBothSkills(card => card.controller.fate)`, so every fate placed on him is spent from the pool *and* subtracted from his own X — the reasoning that suggested cutting it. Measured, cutting it costs 5.00pp, the largest effect found in this deck. Fate on a character buys rounds in play, and that dominates the skill penalty by a wide margin. This is the clearest result in the run and it contradicts the card-text argument.

**Aranat's additional fate stays at 2.** Cutting it read −1.01pp: negative, but inside the noise floor, so it is "not an improvement" rather than a measured loss.

**Adding reveal characters to `unrevealedProvinceAttackerIds` is inert on its own** (+0.03pp, +0.07pp). This is the reachability failure described above, not a verdict on the idea: while the gate confined the list to conflict 1, changing the list could not change games.

**The gate fix is reachable but null.** With the flag alone the run was record-identical to the null arm (1802-1078) — with only Shinjo Trailblazer in the list, extending to later conflicts changes no games. Flag plus the expanded list did move games (1810-1070, a different record), proving the mechanism is live, but the effect is +0.28pp against a noise floor of roughly ±2.5pp and a CI half-width of ±1.75pp. Resolving an effect that size would take on the order of 8x more games than the whole tuning programme above. The decision rule was fixed before the run: ship only on a margin above the noise floor, replicated on fresh bases. It does not qualify, so `revealAttackerPriorityAllConflicts` ships `false` and the fix remains available as a knob.

Net result of that first round: four hypotheses tested, none beat the default, two measured negative. The deck's own tactics module was at a local optimum — the real defect was outside it, in the shared draw-bid profile.

## Tuning round 2: the honor axis

All arms below are paired at cell level (same shuffles), pooled over **16 bases and 5760 games per arm**, against matched null arms on each base set. Base sets matter: the same null scored 62.57% on 91001-98001 and 60.66% on 99001-106001, a 1.91pp spread, so every arm is differenced against the null from its own set.

`lowHonorThreshold` is the honor at or below which the bot drops to `lowBid`. Sweeping it is a clean monotone gradient:

| lowHonorThreshold | vs null | t | p |
|---:|---:|---:|---:|
| 6 (profile default) + balanced bid | +0.99pp | 2.71 | 6.8e-3 |
| 9 | +1.84pp | 3.04 | 2.4e-3 |
| 12 | +3.65pp | 4.96 | 7.1e-7 |
| 15 | +4.31pp | 5.70 | 1.2e-8 |
| **20 (shipped)** | **+4.58pp** | **6.04** | **1.6e-9** |

20 is above the honor track's practical ceiling, so the low bid is effectively unconditional; the gradient is already flattening (20 over 15 is +0.28pp, p=0.015).

Adding the reveal-attacker fix on top gives the shipped configuration: **+4.79pp, t=6.24, p=4.4e-10**.

The reveal flag's isolated contribution was measured four times, on two base sets and over two different honor baselines: **+0.26pp** (p=0.021), **+0.24pp** (p=0.043), **+0.19pp** (p=0.12), **+0.21pp** (p=0.083). Positive every time, significant twice, and shrinking as the honor fix grows — the two levers overlap. It ships because it is never negative and is a mechanically correct reading of the three cards' reaction windows, not because any single run resolved it.

### Where the honor fix landed

Per-opponent, shipped config against the pooled null:

| Opponent | null | shipped | delta | dishonor losses |
|---|---:|---:|---:|---|
| Scorpion | 54.6% | 75.4% | **+20.8pp** | 217 → 113 |
| Crab | 59.4% | 73.5% | **+14.2pp** | 125 → 8 |
| Dragon | 47.3% | 60.0% | **+12.7pp** | 5 → 0 |
| ScorpionBidWar | 71.0% | 77.9% | +6.9pp | 26 → 6 |
| CraneDuels | 68.5% | 73.5% | +5.0pp | 23 → 1 |
| Crane | 71.7% | 74.6% | +2.9pp | 18 → 2 |
| DragonAttachments | 74.8% | 76.7% | +1.9pp | 0 → 0 |
| PhoenixPhoenix | 86.9% | 87.7% | +0.8pp | 0 → 0 |
| Phoenix | 44.2% | 42.5% | −1.7pp | 9 → 1 |
| Unicorn | 57.9% | 55.8% | −2.1pp | 0 → 0 |
| Lion | 53.3% | 50.4% | −2.9pp | 47 → 3 |
| PhoenixShugenja | 49.8% | 46.3% | −3.5pp | 7 → 0 |

The trade is explicit and worth taking: the deck gives up a little where card volume decided games (Phoenix, Lion, Shugenja, the Unicorn mirror) and gains enormously where honor did. Dragon crosses from a losing matchup to a winning one. Across the shipped runs, dishonor losses fell 232 → 70/62 while dishonor *wins* rose 31 → 205/188 — low bidding does not merely stop the bleed, it turns the honor track into a second win condition.

Scorpion remains the one deck that still takes 113 dishonor wins, which is expected: it is a dedicated dishonor deck and no longer wins the matchup regardless.

## Validation

### Automated tests and builds

- Jigoku TypeScript compile (`npx tsc`, emitting): pass.
- Jigoku full Jasmine suite: **11,027 specs, 0 failures, 8 pre-existing pending**.
- Targeted Unicorn Reveal / deck-profile / province-targeting specs: 30 specs, 0 failures.
- Refactor identity: with the new flag off, the no-profile field run reproduces `1807-1073 / 62.74%` exactly, confirming the gate split changed nothing.

### Full-game safety

Across the four primary measurement arms, **11,520 of 11,520 games were decided** — `stopReasons {"decided": 2880}` on every arm, zero draws, zero timeouts, zero undecided games, at a 180s per-game wall cap.

The interaction validator ran 78 games across seeds 1, 2, and 3 against all 12 registered opponents plus the mirror:

| Seed | Games | Decisions | Rejected | Loops | Budget exhaustion | Max/tick | Status |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 26 | 11,061 | 0 | 0 | 0 | 19 | PASS |
| 2 | 26 | 11,196 | 0 | 0 | 0 | 14 | FAIL (1 stall) |
| 3 | 26 | 9,986 | 0 | 0 | 0 | 16 | PASS |

The single seed-2 failure is a **UnicornReveal mirror** that hit the validator's default 30s wall clock at round 7 with 0 cycles, 0 rejections, and 0 budget exhaustion — a slow game, not a decision loop. Re-running the mirror in isolation at a 180s cap passes 4/4. The 180s-cap field runs decided all 11,520 games, which is the stronger evidence.

### Card coverage

`auditCards.js`, 114 games across seeds 1-3 and all opponents, fair information:

**27/27 plays covered, 0 zero-use, 0 never-seen, 15/15 abilities exercised, 0 semantic candidate gaps, 0 payoff gaps.**

The audit's one finding was that Way Station Trader appeared in play without activating on seeds 1 and 3 (it does activate on seed 2, hence full deck-wide coverage). That finding is what exposed the first-conflict gate defect above; the resulting fix is measured null, so the residual behaviour is understood rather than merely observed.

## Reproduction

```powershell
node tools/selfplay/importEmeraldDeckFixture.js 6057d28e-e023-4c9f-b027-475f13eaf394 unicorn-reveal "Unicorn Reveal"
npx tsc
npm test

# field win rate (the correct rig for a new deck)
$env:SUBJECT="UnicornReveal"; $env:BASES="91001,92001,93001,94001,95001,96001,97001,98001"
$env:GPB="15"; $env:WORKERS="14"; $env:HARNESS_MAX_GAME_MS="180000"
node tools/selfplay/deckFieldWinRate.js

# null arm (required before believing any tuning arm)
$env:SUBJECT_PROFILE='{"deckProfile":{"unicornReveal":{"scoutedTerrainCost":4}}}'
node tools/selfplay/deckFieldWinRate.js

# safety
node tools/selfplay/validateBotInteractions.js --decks UnicornReveal --opponents all --seeds 1,2,3 --games 2 --out tools/selfplay/out/ur-interactions
node tools/selfplay/auditCards.js --decks UnicornReveal --seeds 1,2,3 --opponents all --modes fair --games 3 --workers 12 --out tools/selfplay/out/ur-cardaudit
```

## Two defects found in a live replay (2026-08-21)

Both came out of one human game (Unicorn Reveal bot vs a Phoenix human) and
both were verified against the running self-play harness before and after the
fix, on twelve games per opponent across Phoenix, CraneHonor, Lion and Crab.

### Border Fortress never fired its Action

**Symptom.** The bot defended a conflict at Border Fortress, the province
message said it was breaking, and the bot passed the window without using
"reveal a facedown province" — free value, on the deck whose entire engine is
province reveals.

**Cause, and it is a general one.** A province the bot does not control is
serialized *without a uuid* while it is facedown (`basecard.getSummary` hides
the uuid of any card the active player may not look at). `cardDecision` builds
its "their cards" list from `findVisibleCards`, which requires a uuid, so an
opponent's facedown province can never appear in `theirs`. Border Fortress
carries `targetSide: 'enemy'`, so the hinted-target branch saw an empty enemy
list next to two selectable *own* facedown provinces, cancelled — and after the
second cancel `cancelledSources` cancel-vetoed `border-fortress` for the rest
of the round, so the Action was dead from its first attempt onward.

`facedownSelectableDecision` already existed for exactly this case (conflict
declaration clicks a hidden province by `[location, controller, true]`), but it
was only reachable when the selectable set was *completely* empty — which for
this deck only happened once all of our own provinces were already faceup or
broken. That is why it fired at all in the baseline instead of never.

**Fix.** Try the facedown-by-location click before cancelling, in the
`targetSide === 'enemy'` branch and in the generic harmful-polarity branch.
Both are guarded by "an opposing facedown province is selectable in this very
prompt", so they cannot fire on any other shape of prompt.

| Border Fortress reveals per 12 games | before | after |
|---|---:|---:|
| vs Phoenix | 11 | 31 |
| vs CraneHonor | 11 | 31 |
| vs Lion | 11 | 29 |
| vs Crab | 11 | 26 |

### Yoritomo bought out of an empty opening pool

**Symptom.** Round 1, Shiro Shinjo collects 6, and the bot spent all of it on
Yoritomo (cost 5 plus 1 additional fate). Yoritomo's printed X is *the fate left
in our pool*, so he arrived as a vanilla 3/3, alone on the board, with nothing
left for a second body — on a deck that wants width early, because every extra
declaration is another province flipped.

**Fix.** `UnicornRevealTactics.shouldPlayFateScalingCharacter` filters him out
of the dynasty `playable` list while the pool cannot survive the purchase. The
gate is three knobs on `UnicornRevealProfile`, so it is an A/B arm rather than
an edit:

- `fateScalingCharacterIds` (`['yoritomo']`) — characters whose skill IS the
  pool.
- `fateScalingMinimumPoolAfterPlay` (`2`) — fate that must remain after the cost
  AND the deck's own additional fate (`additionalFateByCharacterId.yoritomo`,
  measured at 2 and left alone: cutting it to 0 lost 5.00pp).
- `fateScalingWideBoardRevealedProvinces` (`3`) — the gate lifts once this many
  of their outer provinces are faceup, because at that point the extra
  declarations no longer buy flips and one big body is the better use.

He is **deferred, not abandoned**: an unplayed dynasty card stays faceup in its
province, so the next dynasty phase buys him with the pool banked. Over 36 games
(six opponents x six games) he was offered in 24 games and bought in 18 of them
(75%), never below 9 fate, earliest round 2. The baseline bought him in 24 of 28
offered games (86%) — including three round-1 buys at 6 fate, which is the
replay case.

Win rate was not measured for either: the owner's call was that both are
behaviour fixes whose win-rate effect sits in the noise floor, and the
acceptance test was behavioural (Border Fortress must fire; Yoritomo must still
be bought).

## Open leads

Ranked by the size of the hole they would close, not by confidence:

1. **Phoenix (42.5%) and PhoenixShugenja (46.3%)** are now the only sub-50% matchups, and both got slightly *worse* from the honor fix — they are the decks that punish the reduced card flow. A conditional bid (low by default, high against a board that is out-scaling us) is the obvious next arm and would recover the −1.7/−3.5pp without giving back the +4.58pp.
2. **Way Station Trader still shows zero activations on seeds 1 and 3** in the card audit even after the reveal-attacker fix. Its reaction window is reachable but rare; the remaining constraint is probably attack *sizing* (the planner may not add a 2-cost body), not ordering.
3. **The honor gradient is not fully exhausted.** 20 over 15 was +0.28pp and still positive. `forceLowAfterOpening` (as the dishonor profile uses) was never tested.
4. **The Scouted Terrain bait line concedes conflicts with no honor gate**, which was the original suspect for the honor leak. It turned out not to be the main cause, but it is still unconditioned and now interacts with a deck that actively wants honor.
