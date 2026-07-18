# Per-deck bot tuning profiles (`DeckProfiles.ts`)

The heuristic bot used to branch directly on three `DeckStrategy` booleans
(`aggressive` / `defensive` / `holdingEngine`) with hard-coded constants
scattered through `JigokuBotPolicy`. That made per-deck tuning mean editing the
shared decision code and risking the fine-tuned Unicorn default.

`DeckProfiles.ts` lifts those constants into a single **`DeckProfile`** — a set
of named knobs — so a deck's playstyle is DATA, not `if` statements. The policy
reads the knobs; the profile is chosen per deck.

> **Current benchmark baseline (2026-07-18):** standardized vs-Crane runs use
> the 4736f7c0 **Crane Baseline** list, not the retired sparring precon. Older
> case-study percentages below are historical tuning records against their
> stated opponent. Current client numbers come only from a fresh standard
> `winRates.js` / `botRoundRobin.js` run. See `crane-baseline-bot.md`.

## The knobs

| Knob | Meaning |
|------|---------|
| `fateAwareEconomy` | injectable dynasty purchase/fate policy used by seeds 1 and 5 |
| `conflictCardEconomy` | value-per-fate candidate planner shared by seeds 1, 2, and 5 |
| `provinceTargeting` | shared injectable province ordering: Eminent, effective strength, ability timing, and per-card overrides |
| `strongholdDefense` | three-broken survival planner plus injectable two-broken risk gate and fair/omniscient defender limits |
| `attachmentControl` | shared Let Go policy comparing own debuff removal with enemy attachment removal |
| `personalHonor` | shared glory-aware honor/dishonor targeting; conflict swing and home-target preferences are overridable |
| `mulliganForHoldings` | dig opening provinces toward holdings (Kaiu Wall) |
| `digWithActions` | fire dynasty Action diggers (Kyuden Hida, engineers) |
| `digMinBoardCharacters` | only dig once this many own characters are in play (0 = always) |
| `aggressiveFate` | flood cheap bodies, deploy 0-1 fate |
| `drawBidCap` | optional maximum draw bid for honor-sensitive grind decks |
| `forceMilitaryConflict` | always declare military while any military skill exists |
| `attackCommitment` | `all` / `all-but-one` / `breakable-or-hold` / `breakable-or-pressure` |
| `attackKeepHome` | bodies kept home under the pressure / all-but modes |
| `reserveDynastyFate` | retain fate for conflict cards after dynasty purchases |
| `defenseCommitment` | `win-only` (rush) / `prevent-break` |
| `spendCardsOnDefense` | play conflict cards / fire abilities to defend |
| `preventBreakAfterBrokenProvinces` | delay prevent-break defense while intentionally trading early provinces |
| `chumpBlock` | declare one cheap defender in a hopeless conflict to avoid unopposed honor loss |
| `defenseSkillBuffer` | extra committed defense above exact prevent-break math |
| `strongholdProvinceId` | province deliberately placed under the stronghold |
| tactics sub-profiles | `dishonor`, `lion`, `glory`, `dragon`, `duelist`, `craneBaseline`, `shugenja`, and `attachmentTower` |

## How a deck gets its profile

```
DeckStrategy flags ──profileFromStrategy()──▶ base profile ──resolveDeckProfile()──▶ final profile
   (marker cards)     (exact old behavior)        (+ per-deck OVERRIDES)              context.profile
```

- **`profileFromStrategy(strategy)`** starts from `DEFAULT_PROFILE`, then layers
  generic holding/defensive/aggressive behavior and creates specialized tactics
  sub-profiles for marker strategies. Generic decks still receive no tactics
  module. Historical claims that this was only a three-flag pure refactor refer
  to the first version; the current profile is the shared injection boundary.
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
the Scorpion Poison Mill deck, `lion?: LionProfile` (`LionTactics.ts`, doc
`lion-bot.md`) for the Lion Bushi swarm's bid dials and stronghold ready, and
`glory?: GloryProfile` (`GloryTactics.ts`, doc `glory-bot.md`) for the Phoenix
honor engine's board-driven ring choice and glory pumps, and
`dragon?: DragonProfile` (`DragonTactics.ts`, doc `dragon-bot.md`) for the
Dragon monk card engine around Togashi Mitsu, and
`duelist?: DuelProfile` (`DuelTactics.ts`, doc `duel-bot.md`) for the Crane
Duels tower/duel plan, and
`shugenja?: ShugenjaProfile` (`ShugenjaTactics.ts`, doc
`phoenix-shugenja-bot.md`) for the Phoenix ring/Spell/Disguised engine, and
`attachmentTower?: DragonAttachmentProfile` (`DragonAttachmentTactics.ts`, doc
`dragon-attachments-bot.md`) for the Iron Mountain Castle Restricted-attachment
tower deck, and `craneBaseline?: CraneBaselineProfile`
(`CraneBaselineTactics.ts`, doc `crane-baseline-bot.md`) for the mixed
duel/honor/control baseline. Same gating rule:
the sub-profile exists only for decks whose strategy/override derives it, and
every policy hook checks its presence.

`personalHonor: PersonalHonorProfile` is different: every deck receives this
generic injectable profile. `PersonalHonorTactics.ts` centralizes high-glory
friendly honor, low-glory forced self-dishonor, low-glory forced enemy honor,
and conflict-aware enemy dishonor. A deck override may change its conflict/home
preferences without duplicating target code.

`provinceTargeting: ProvinceTargetingProfile` is also universal. Its cloned
maps let a deck change one province's effective priority without leaking the
change to other profiles. The default ranks Eminent provinces first, then
effective strength, then `none` / reveal-only / reaction / Action abilities;
Public Forum has priority strength 6 while retaining its real game strength.

`strongholdDefense: StrongholdDefenseProfile` exposes the preliminary
two-broken-province safety gate separately from final stronghold survival.
Rush profiles can disable `preStrongholdDefenseEnabled`, raise
`preStrongholdThreatRatio`, add `preStrongholdThreatBuffer`, or tune the ready
character/conflict thresholds while continuing to use the shared planner.
Nested stronghold-defense and province-targeting overrides are deep-merged into
the strategy profile, including their maps. A deck can therefore override one
ratio or one province id without copying the other defaults.

Phoenix Shugenja uses this injection to set
`preStrongholdThreatRatio: 1.5`. It still defends an exposed stronghold exactly
like other decks, but it preserves an attacker at two broken provinces only
against a 50% larger projected two-conflict threat. Paired seed-5 A/B measured
+6.7 points against Unicorn, +2.5 against Crane and Lion, and no change against
Scorpion or Dragon Attachments.

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
| Crab historical omniscient (then seed 4; now seed 5) | ~5% (1-19) | **~45%** |

After the fix the Crab seat plays bodies (8 → 22), digs sparingly (49 → 8), and
actually attacks (1 → 8 initiations) while keeping its defense. It no longer
rolls over; it trades roughly evenly. Unicorn and Crane profiles are unchanged.

**Deck update (2026-07-10, EmeraldDB c9381e02):** three provinces swapped in
for Pilgrimage / Elemental Fury / Ancestral Lands:

- **Flooded Waste** — on-reveal bows EVERY attacker; the `crab-flooded-waste`
  override parks it under the stronghold (blunts the final all-in push).
- **Defend the Wall** — win a conflict there: resolve the ring as the
  attacker. Fires automatically (provinces trigger first in reaction windows).
- **Shameful Display** — honor one participant, dishonor another. The policy
  steers the exactly-2 selection (own strongest + enemy strongest), then the
  Honor/Dishonor menu picks "Honor" so the helpful-polarity select lands the
  honor on our side. With no own participant it cancels rather than honor an
  enemy. The cancel-veto now also covers PROVINCE clicks — without it,
  saturated honor states made the bot re-click the province ~49×/game
  (1940 clicks in 40 games → 197 after the veto).

Utilization audit of the new list: every card fires, zero-clicks list empty.
Band unchanged: 17-23 (42.5%, N=40) vs Crane.

**Knob sweep (2026-07-11)** — attempt to lift the ~37% band vs Crane. Every
config measured N=40-60, seed 1, alternating seats:

| Config | Result |
|--------|--------|
| baseline (keepHome 2, dig 3) | ~37.5% (59/160 recent pooled) |
| + chumpBlock | 14-26 (35%) — dishonor losses 15→9, conquest losses up |
| + chumpBlock, keepHome 1 | 18-22 + 20-40 = 38/100 (38%) |
| + chumpBlock, keepHome 1, attack all-but-one | 14-26 (35%) — defense collapses |
| + chumpBlock, keepHome 1, dig 2 | 11-29 (27.5%) — over-digs again |
| + chumpBlock, defenseSkillBuffer 2 (final) | 37/100 (37%) |

Verdict: the matchup is knob-INSENSITIVE — every configuration lands 35-45%,
within run-to-run noise. The ceiling is structural: the slow wall engine
trades badly against Crane's draw/honor engine in a symmetric-AI mirror.
Two changes are KEPT anyway, chosen for their mechanism against humans, both
free in the mirror:

- `chumpBlock: true` — one cheap body blocks a hopeless defense instead of
  conceding unopposed. Halved the dishonor-loss rate across runs (~42% →
  ~23% of games) even though total win rate is flat.
- `defenseSkillBuffer: 2` — defenses overshoot the minimal prevent-break
  block by 2 skill; an exact-size block is a free flip for any human holding
  one pump card.

Post-sweep utilization audit: every card, action, and reaction still fires
(zero-clicks empty; `chump-block` visible in traces).

## Case study: Unicorn Cavalry Rush (EmeraldDB ef93bae2)

The aggressive rush profile was tuned in the historical omniscient mirror
(then seed 4; now seed 5), but the
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
**~68% seed 1 (41-19, pooled N=60) / ~63% historical omniscient
(then seed 4; now seed 5; 25-15, N=40)** — locked.
Regression checks on the final build: Crab vs Crane 19-21 (~47%), Scorpion vs
Crane 12-8 (both in their bands).

**Deck update (2026-07-10, EmeraldDB 52b78858):** four provinces swapped in
for Pilgrimage / Elemental Fury / Ancestral Lands / Meditations:

- **Temple of the Dragons** — on-reveal resolves the contested ring as if we
  were the attacker; parked under the stronghold
  (`unicorn-temple-of-the-dragons` override) to punish the final push.
- **Endless Plains** — BREAKS ITSELF to make the opponent discard an
  attacking character (their choice). Gated in
  `provinceReactionWorthIt`: fire only against an attacker with 2+ fate or
  5+ military, or when the defense could not stop the break anyway. Spec-locked.
- **Public Forum** — must be broken twice (interrupt places an honor token);
  fires automatically through the provinces-first interrupt path (35 saves
  in 40 games). Cannot be a stronghold province by its own text.
- **Manicured Garden** — Conflict Action: gain 1 fate; covered by the generic
  attacked-province click (175 gains in 40 games).

Utilization audit of the new list: every card fires, zero-clicks empty.
Band unchanged: 26-14 (65%, N=40) vs Crane.

## Case study: Lion Swarm v0.3 (EmeraldDB 27a913d1)

This list replaces the older c99f60e2/e3feb31b Lion fixture. The
`lion-ashigaru-rush` override is matched by Hayaken no Shiro + Ashigaru Levy,
so older Lion and every other aggressive deck remain isolated. It trades
ordinary provinces (`win-only`, no conflict cards on ordinary defense), buys
cheap bodies before towers, and preserves them with Feeding an Army / For
Greater Glory. Only Toturi, Commander of the Legions, and Honored General get
two additional fate.

Alternating-seat comparison across eight opponents, N=192 per deck: old Lion
75-117 (39.1%); Lion Swarm 102-90 (53.1%). The +27 wins / +14.1-point result
cleared the replacement bar. Full card logic, matchup table, rules divergence,
and 1120-game non-Lion regression check: `lion-bot.md`.

## Generic stronghold and province logic (all decks, 2026-07-10)

Current deck-independent behaviors:

1. **Stronghold province defaults to Ancestral Lands** (+5 strength during
   political conflicts) when the deck has it and no override names another
   province (Scorpion keeps Night Raid).
2. **Attacked own province's Conflict Action fires before any pass/concede
   gate** — Fertile Fields draws a card, Meditations on the Tao strips an
   attacker's fate. Free value even in conflicts the bot was going to concede.
3. **All-in defense while the stronghold is attacked**: every defense cap is
   overridden, every ready body may defend, and conflict cards remain enabled.
4. **Last-province planning between conflicts**: after three own provinces are
   broken, `StrongholdDefenseTactics` calculates military and political threats
   against the combined stronghold-province strength. It may skip attacking,
   reserve the minimum safe defender set, or attack freely. A fair seed keeps at
   most one calculated defender; seed 5 also adds affordable hidden-hand skill
   and known bow/send-home/remove effects and may reserve more.
5. **Safety exceptions**: attack freely when every opposing character is bowed;
   attack all-in when the opponent has no conflict remaining; race all-in when
   both strongholds are exposed. Any ready opposing Covert character causes the
   fair planner to hold every defender because the reserved body can be bypassed.
6. **All-in stronghold assault** (mirror): when attacking the ENEMY
   stronghold, the "deficit too big, save the hand" cap is lifted — breaking
   it wins the game.

Effect on the vs-Crane benchmarks: Crane benefits from the same logic (it
defends its stronghold all-in and draws off Fertile Fields), so the
bot-vs-Crane bands shifted down slightly — Lion ~65%, Unicorn ~65%, Scorpion
~62%, and **Crab dropped to ~35% (42-78 pooled N=120, was ~45-57%)**: Crane's
stronghold no longer folds to Crab's slow final push, the games run longer,
and Crane's honor engine wins them (Crane dishonor wins 12.5% → ~40% of Crab
games). This is the sparring partner getting stronger, not a Crab bug; a
possible future fix is chump-blocking one cheap body instead of conceding
unopposed conflicts (each unopposed loss bleeds 1 honor).

## Card-utilization audits (`tools/selfplay/auditCards.js`)

`node tools/selfplay/auditCards.js <deck> [games=20] [seed=1] [opponent=Crane]`
runs any registered deck (including `Crane`) against the chosen opponent and
prints, for EVERY card in the decklist, how many times
the bot successfully clicked it and through which decision reasons — plus a
ZERO-clicks list. Run it after onboarding or tuning a deck: zero-click cards
are either passives (fine) or silently gated (the Softskin/Spyglass class of
bug, where a policy filter kept a playable card in hand forever).

Audit of 2026-07-10 (N=40 per deck): every card in all four decks fires.
Findings and decisions:

| Card | Finding | Band effect | Decision |
|------|---------|-------------|----------|
| Softskin, Compromised Secrets (Scorpion) | never played (0/0 stats, zero-contribution filter) | 62% → 77.5% on the fix run | ENABLED (`abilityValue`) |
| Spyglass (Unicorn) | never played in military conflicts (+0 mil) | pre-generic build measured 59% N=80; current build 69% pooled N=80 | ENABLED (`abilityValue`, user decision — draw engine matters vs humans) |
| Kaiu Siege Force action (Crab) | 0 ability uses in 40 games (gate needed bowed+inConflict+losing) | 42.5% run, no harm (band ~35-42%) | gate loosened to bowed+inConflict |

## Deterministic analysis and interaction-cycle audits

`analyzePolicyGame.js` replays a control policy and candidate policy with the
same shuffle, seat, deck, and RNG stream, then writes a Markdown comparison and
full JSON decision trace. It is the reusable one-game deep-analysis tool:

```powershell
node tools/selfplay/analyzePolicyGame.js --deck PhoenixShugenja --rng-seed 20260715
```

`validateBotInteractions.js` checks all registered decks for repeated clicks,
unchanged-state runs, short prompt/action cycles, decision-budget exhaustion,
unsupported prompts, stalls, timeouts, and engine errors. It defaults to the
offline deployable seeds 1, 2, and 5 and Crane opponents; use `--opponents all`
for the full matrix:

```powershell
node tools/selfplay/validateBotInteractions.js
node tools/selfplay/validateBotInteractions.js --opponents all --games 2
```

Seed 3 needs its live LLM and seed 4 needs evaluator weights; without them an
offline audit exercises only their heuristic fallback.

## Re-baseline (2026-07-11, after the Crane Duels onboarding)

The upgraded Crane Duels list shares ~41 cards with the SPARRING Crane
precon, and playbook entries are global by card id — so onboarding it also
taught the baseline opponent to use its own duel package (Kaezin, Kuwanan,
Toshimoko, Harrier, Duelist Training, Kakita Dojo were idle before). The
DuelTactics module itself stays exclusive to the new list (flag keys on
Tsuma). Every deck's vs-Crane band shifted down as a result (N=20 spot
checks, ±15pts): Scorpion 12-8, Unicorn 9-11, Phoenix 9-11, Lion 5-15,
CraneDuels ~42-45%, Dragon/Crab unmeasured-but-expected-lower. Treat all
pre-2026-07-11 band numbers as measured against the WEAKER Crane.

## Measuring in self-play

`tools/selfplay/harness.js` `runGame({ names, seeds, deckA, deckB })` runs a
headless game. `deckLoader.js` and `deckRegistry.js` expose standardized deck
fixtures. Alternate seats to cancel first-player advantage. To inspect a seat's
decisions, pass `onControllers: (controllers) => …` and read `controller.trace`.

Standard win rates use 100 games per deck; round robin uses 40 per matchup:

```powershell
node tools/selfplay/winRates.js 100 <bot-seed> [crane-seed]
node tools/selfplay/botRoundRobin.js --seed <bot-seed>
```

`winRates.js` defaults Crane to the challenger seed. A complete 100-game run
with identical challenger/Crane seeds and no policy override writes the
`winRates` section of `jigoku-client/client/botBenchmarkResults.json`.
`botRoundRobin.js` writes `roundRobin` only when all decks and every 40-game
matchup complete. Nonstandard, partial, custom-policy, or cross-seed runs still
produce reports but never replace client baselines. `NewGame.tsx` reads this
JSON and displays both values beside the selected deck and seed.
