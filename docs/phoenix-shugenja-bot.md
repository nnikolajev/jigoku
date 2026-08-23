# Phoenix "Shugenja" bot deck (EmeraldDB b260d778)

This profile implements the explicitly requested Emerald/Standard Phoenix deck
[b260d778-0016-4d70-b1f9-5180daf340fc](https://www.emeralddb.org/decks/b260d778-0016-4d70-b1f9-5180daf340fc).
It is an intentional exception to the project's Imperial-first migration scope;
the card/rules engine remains authoritative when a heuristic conflicts with a
forced rule or legal timing.

## Game plan

The shared card-engine draw profile keeps a routine bid floor of 4. Phoenix
Shugenja raises the value assigned to unclaimed-ring fate because Offerings,
Display of Power, Togama, and normal conflict declarations can collect it more
reliably. Universal honor and exposed-stronghold rails still take precedence.

- **Manipulate rings.** Conflict declaration still takes the largest fate pile
  first, with live Water/Air/Void bonuses for Prodigy of the Waves, Asako
  Tsuki, Ethereal Dreamer, Feral Ningyo, Adept of the Waves, Kudaka, and Isawa
  Ujina. Other claim effects use live board priorities instead of one global
  order. Offerings to the Kami always takes the largest fate pile, generating
  a fresh live character/ring-effect priority to break equal-fate ties. Asako
  Togama takes the largest fate pile first, then uses those same live payoffs
  to break ties; a home Togama is no longer treated as an available action
  until he participates. Ujina's Void bonus requires a legal zero-fate enemy
  target.
- **Recycle Spell Actions.** Kyūden Isawa discards the weakest Spell while
  protecting Display of Power, Consumed by Five Fires, and The Path of Man.
  It recasts only Spell Actions legal in the current action window; reaction
  events such as Display of Power and Earth Becomes Sky cannot legally be
  played by the stronghold Action and remain available for their reaction
  windows.
- **Trade provinces selectively.** With Display of Power in hand and two fate
  available, a normal province is left undefended when the contested ring turns
  on a live Phoenix payoff, or when the available defenders cannot win anyway.
  A winnable conflict on an irrelevant ring is defended normally. The reaction
  cancels the enemy ring effect, resolves it for Phoenix, and claims the ring.
  Once its effects survive interrupts, later Display copies are preserved for
  another conflict; an interrupted copy may be retried immediately.
  Stronghold defense is never intentionally conceded.
- **Build practical towers.** Ready, Water, Clarity of Purpose, Supernatural
  Storm, and Adept of the Waves effects prefer Isawa Tadaka, Fushichō, Shiba
  Tsukune, and Kudaka. This list has few attachments, so these printed-stat
  bodies are its tower equivalents. Fushichō is bought only when a printed
  five-cost character (normally Shiba Tsukune) is already in the dynasty
  discard pile for his leaving-play interrupt.
- **Use Clarity on live participants.** Clarity of Purpose never falls back to
  a character at home or one already bowed. Political conflicts are preferred
  because Clarity also prevents resolution bowing. In military conflicts,
  seed 3 requires an affordable opposing bow effect in the exact enemy hand;
  every seed may act immediately when a visible participating enemy can bow.
  Later copies spread to other ready participants and never protect the same
  character twice in one conflict. Kyūden Isawa uses these same gates when it
  considers recasting Clarity from discard.
- **Bank for Five Fires.** When a Shugenja is in play and enemy characters have
  at least five actionable fate, Consumed by Five Fires in hand (or recyclable
  through ready Kyūden) makes the dynasty phase preserve five fate. The bot
  plays it proactively in any conflict-phase action window, targets the largest
  useful fate stack, and removes the maximum legal fate. Characters already
  neutralized by Pacifism or Stolen Breath are skipped and their fate does not
  count toward the five-fate threshold.
- **Protect the conflict deck.** Seeds 1 and 3 share the generic
  `ConflictDeckSafetyTactics`: Oracle of Stone, Forgotten Library, and Shrine
  Maiden stop consuming cards when the next mandatory/public draw would force
  a five-honor reshuffle. A visible Bayushi Shoju contributes both his forced
  draw and honor loss. Seed 2 remains the legacy comparison.
- **Disguise Tadaka.** With Tadaka in hand, the dynasty plan prefers a cheap
  non-unique Shugenja and puts two fate on it when seven fate can fund the whole
  setup. At the next legal conflict-phase action window, Tadaka replaces that
  prepared body, enters ready, and inherits its fate, attachments, and tokens.
  Disguise targeting values inherited fate first, then attachments/tokens, and
  prefers the cheaper body on ties. Tadaka remains a top-priority tower after
  entering play. His Action removes exactly one weakest dynasty-discard
  character to cost the opponent one random hand card.
- **Control the opponent.** Pacifism and Stolen Breath are played before
  conflicts; Kirei-ko, Earth Becomes Sky, and other harmful effects target
  enemy characters. Extra copies spread across characters instead of repeating
  the same printed attachment on one bearer. Pacifism and Stolen Breath remain
  independent locks: each printed attachment avoids duplicating itself, while
  the other lock may legally use the same character. Pacifism prefers military
  specialists and Stolen Breath political specialists. A capped 30% balance
  band (4/3 allows 1; 10/7 reaches the cap of 3) lets both different locks land
  on one strong, balanced character. Meddling Mediator takes enemy fate first,
  then honor. A lock stays in hand when every enemy has the opposite focus.
  Shiba Yōjimbō always protects an own Shugenja when its interrupt is offered.

Helpful target steering always chooses Phoenix characters; harmful target
steering chooses opponents. Isawa Ujina is a forced reaction: it removes the
strongest legal enemy whenever possible. If the engine offers only Phoenix
characters, it must remove the weakest own legal character instead of looping
on Cancel.

## Disguised timing and Clarity of Purpose (SHIPPED 2026-08-23)

Three knobs on `ShugenjaProfile`, all `true` in `SHUGENJA_DEFAULTS` so both
Kyuden Isawa decks inherit them through their own overlays. Read off one lost
human game; full write-up in
[bot-phoenix-replay-2026-08-23.md](bot-phoenix-replay-2026-08-23.md).

| knob | rule |
|---|---|
| `disguiseRequiresBowedBase` | only replace a BOWED base |
| `disguiseRequiresConflictValue` | and only while a conflict can still use the ready |
| `clarityPoliticalOnly` | hold Clarity of Purpose for political conflicts |

**Disguised discards the base.** `PlayDisguisedCharacterAction.executeHandler`
moves the base’s fate, attachments and status tokens onto Tadaka and then
discards it, so replacing a READY body is a stat swap that throws that body
away; replacing a bowed one is also a ready, which is what the discount is
buying. V1 did the former **92-94% of the time** — 201 Disguised plays over 384
games with 16 onto a bowed base. Gated, all 74 remaining plays are onto a bowed
base, the rest being Tadaka played at his printed 5 with the base kept
(`prefersDisguisedPlay`).

The conflict-value half is `ShugenjaTactics.disguiseReadyIsUseful`: a conflict
of ours left to declare, or one of theirs with ready bodies behind it. Both
counts are public.

**Clarity of Purpose** reads "opponents’ card effects cannot bow that character
and it does not bow as a result of conflict resolution during political
conflicts" — only the second clause is unconditional, and only on one axis.
V1’s gate ended in a blind hedge against the hidden hand and spent the card
twice in one game, the second time recurred through Kyuden Isawa’s
once-per-round action while already winning 11-7. The knob closes the hand
path, the `urgentClarityThreat` pre-emption and the Kyuden recursion together —
`pickKyudenSpell` filters on the same `shouldPlay` gate and `shouldUseKyuden`
needs a legal target, so the stronghold no longer bows for a card that will be
refused.

Measured on the paired rig (`ONLY=PhoenixShugenja,PhoenixPhoenix`, both seats
pooled): **+3.13pp over 576 games and 9 bases, p=0.0020**, null arm 100%
bit-identical. PhoenixPhoenix +4.51pp, PhoenixShugenja +1.74pp.

## Ring plan (injectable, off by default)

V1 picks the declaration ring with `JigokuBotPolicy.ringScore`, where a ring
holding any fate is worth `1000 + 100 x fate` and every per-card bonus is added
*after* that tier. For this deck that ordering is structurally wrong, not merely
mistuned: `ringCardBonus` is 18, so no value of it can ever outrank a one-fate
pile, and the same deck's Offerings path already prices a live payoff at 100.

Five recorded human games with this list (`game replays/phoenix shugenja`)
disagreed with V1's ring on **14 of 25** attack declarations. The human's rings
are not interchangeable, because both halves of a ring are worth something
concrete here:

- **Element.** `FeralNingyo` puts itself into play into the conflict from hand
  at **no fate cost**, but only while water is contested — every copy in hand is
  a free 3/2 body. `AdeptOfTheWaves` grants Covert for water conflicts until end
  of phase, which removes their best defender and decides a conflict while
  their board is narrow. `ProdigyOfTheWaves` readies itself once water is
  claimed, which is a second conflict body. `Kudaka` pays 1 fate **and** 1 card
  per air claim, twice a round. `AsakoTsuki` honors a scholar on a water claim.
  Every one of the eight Adept Covert grants in those games was followed
  immediately by a water declaration.
- **Fate.** The attacker takes the pile at declaration, so it is spendable now —
  but only for what it actually buys. Ring fate that crosses the cost of a lock
  (Pacifism / Stolen Breath, 2 each), of Disguised Tadaka (five minus the
  prepared base's printed cost) or of Consumed by Five Fires (5, and only worth
  reaching while a Shugenja is out and five actionable enemy fate is there to
  strip) is worth more than the same pile with nothing to spend it on.

`ringPlanEnabled` replaces the generic fate tier for this deck with one scored
in **fate-equivalents**: the ring's own fate, plus what that fate unlocks that
we could not already afford, plus what contesting that element contributes. The
generic element base is kept as a sub-fate tie-break so equal plans still order
deterministically. Every weight is a profile field, so an arm is a JSON string:

```powershell
$env:CHANGE='{"deckProfileByArchetype":{"shugenja":{"shugenja":{"ringPlanEnabled":true}}}}'
```

The plan is skipped when `RebirthTactics` is active. The Fushicho rotation runs
Kyuden Isawa too and so resolves to the same archetype, but its rings are
steered by its own `ringBonus`, which this path would discard.

**SHIPPED 2026-08-12** for this deck only, as `ringPlanEnabled` +
`ringPlanBreakAware` on the `phoenix-shugenja-vassal-fields` override. The
Fushicho rotation and every other deck keep their own ring logic.

Measurement history matters here, because two of the three results below were
taken against a BROKEN implementation:

1. **Flat fate-equivalents: null.** 39 fresh bases, both seats, 167 to / 168
   away (n=335, p=0.96). It flipped 25% of the deck's games, took water 42%
   more often, and declined a larger fate pile 159 times per ~1000
   declarations. A linear value per payoff is not the rule that beats
   fate-first.
2. **Rollout-owned ring and published resources: null.**
   `conflictPlanning.applyRingPlan` drifts to void on the rollout's own scale;
   `ringPlanPlannerResources` is 87.5% inert alone because a fate-first choice
   never contests water. Both stay off.
3. **`ringPlanBreakAware` — the faithful threshold rule.** Measured 105 to /
   106 away and shipped as a fidelity choice. **That measurement is void.** The
   break test's "could I break this WITHOUT the element" baseline counted only
   bodies already in play, because it read the hand from `cardPiles.hand`, the
   client summary, which carries no skills or costs. Every card in hand priced
   at zero, so any element adding any skill read as decisive.

The live consequence, caught by the deck's owner reviewing an exported game
against Scorpion: the deck scored water at 4000 (four fate-equivalents) for a
Feral Ningyo it then did not play, took the ring over a void that would have
stripped fate off Bayushi Shoju, broke the province with Shrine Maiden instead,
and **declined to resolve the water ring** — a ring bought for nothing.

Fixed by giving the break test the same hand model the rest of the bot uses:
`ShugenjaRingPlanContext.baselineHandSkill`, fed from
`DecideContext.ownConflictHand` through `buildHandThreatMatrix`, which prices
affordable BODIES and buffs for any deck. Only Feral Ningyo's free-on-water
entry stays deck-specific. On the same shuffle the deck now takes void, and the
phantom conversions are gone from every declaration in that game.

### Re-measured after the fix

Paired probe, `ONLY=PhoenixShugenja`, arm = the plan turned OFF, so a positive
number here is the plan COSTING games. The null arm (plan injected at its
shipped value) scored 0 flips on 192 games, 100% bit-identical, which is what
validates the double-nested `deckProfileByArchetype.shugenja.shugenja`
injection path — a single-nested arm sets a top-level field nothing reads and
measures a flat zero.

| bases | seat | decided | OFF | ON | plan | p |
|---|---|---|---|---|---|---|
| 320001-331001 | 0 | 48 | 29 | 19 | -5.21pp | 0.193 |
| 320001-331001 | 1 | 49 | 25 | 24 | -0.52pp | 1.000 |
| 340001-375001 | 0 | 144 | 80 | 64 | -2.78pp | 0.211 |
| 340001-375001 | 1 | 139 | 57 | 82 | **+4.34pp** | **0.041** |
| **pooled** | both | **380** | 191 | 189 | **-0.13pp** | **0.959** |

**Null: -0.13pp over 380 decided games, 48 bases, both seats.** The plan costs
nothing and gains nothing.

Read the seat-1 row on the fresh bases before trusting any single-seat probe
again: **+4.34pp at p=0.041**, which in isolation looks like a shippable result
and is entirely an artifact. The two seat-0 cells agreeing with each other is
NOT both seats agreeing — that mistake produced an interim "-2.9pp, sign
consistent" reading here that the fourth cell erased.

**Kept shipped**, on the same fidelity grounds it was shipped on, now resting on
a valid measurement: neutral win rate, and on the declarations its owner
reviewed it picks void to strip Bayushi Shoju's fate rather than water for
nothing. A neutral change that reasons correctly is worth keeping; a neutral
change that reasons wrongly is not, which is why the pre-fix version was not
defensible and this one is.

**Known remaining defect — the scale.** `ringPlanScore` is
`(fate + element) * ringPlanFateScale` with the scale at 1000, added to V1's
element base, where the entire ring-EFFECT range is 8-50. A legitimate
conversion is therefore worth 4000 and no ring effect can outbid it. Since the
baseline fix, conversions fire rarely, which is the likeliest reason this
measures null rather than negative. Making the element term commensurate with
the effect base is the next thing to try if the plan is ever meant to GAIN.

## Implementation

- `ShugenjaTactics.ts` owns ring bonuses, live Offerings tie priority,
  practical towers, Kyūden legality, Tadaka setup/Disguised target ranking,
  Fushichō gating, spell/discard ordering, Display defense, and the conditional
  five-fate reserve. Its
  `togamaFateValue`, `immediateRingPayoffValue`, and
  `displayRingMinimum` profile fields are injectable tuning knobs, as is the
  whole `ringPlan*` group above (`ringPlanNingyoValue`, `ringPlanCovertValue`
  and its `ringPlanCovertMaxOpponentBodies` board-width gate,
  `ringPlanProdigyValue`, `ringPlanKudakaAirValue`, `ringPlanTsukiWaterValue`,
  `ringPlanUjinaVoidValue`, and the `ringPlanUnlockValues` table).
- `CardPlaybook.ts` contains the active/reaction metadata for the deck cards.
- `DeckProfiles.ts` derives the sub-profile from Kyūden Isawa and parks Vassal
  Fields under the stronghold.
- `phoenix-shugenja-decklist.json` and `phoenix-shugenja-cards.json` are the
  exact 1 stronghold / 1 role / 5 province / 40 dynasty / 40 conflict fixture.
- `matchPhoenixShugenja.js` alternates seats against the Crane baseline;
  `auditCards.js PhoenixShugenja` reports source-card plays/abilities and
  availability separately from mulligan, participant, and target clicks.

## Verification (2026-07-19)

- Strict fate-first Offerings regression: pass. A larger fate pile beats a live
  Water payoff; equal-fate Water and Air ties follow Prodigy and Kudaka board
  payoffs respectively.
- Full Jigoku suite: 10,235 specs, 0 failures, 8 pending.
- Phoenix Shugenja interaction audit against Crane: seeds 1, 2, and 3 all pass
  with 0 rejected clicks, loops, or decision-budget exhaustion.
- Standard seed-1 win rates (100 games/deck) moved from 455–442 (+3), 50.6%, to
  466–434, 51.8%. Phoenix Shugenja moved from 74–26 to 75–25.
- Standard seed-1 round robin (40 games/matchup) left Phoenix Shugenja exactly
  195–165, 54.2%. Its individual matchup changes stayed between −3 and +3
  wins, consistent with sample noise.

## Historical verification (2026-07-15)

- TypeScript typecheck: pass.
- Focused Phoenix Shugenja tactics: 22 specs, 0 failures.
- Full bot unit folder: 273 specs, 0 failures. This includes unchanged
  Pacifism/Stolen Breath spreading and saturation regressions, plus exhaustive
  seed-1 execution coverage for every specialized tactic method.
- Deterministic replay (`rng-seed 20260716`) kept the Phoenix conquest win and
  removed seven invalid ring clicks: five during Kyuden Isawa discard prompts
  and two during Assassination target prompts. Its old Offerings selector chose
  zero-fate Water over one-fate Air; the 2026-07-19 strict fate-first rule
  intentionally supersedes that behavior.
- Independent alternating-seat N=100 samples against seed-1 Crane moved from
  the retained pre-change baseline of **64 wins** (2 undecided), to **69 wins**
  after ring orchestration (1 undecided), then **72 wins** after the
  participating-only Togama correction (1 undecided). These are unpaired
  shuffle samples, so treat the +8 points as positive evidence rather than an
  exact effect size.
- Live utilization audit: every active card fires. The Imperial Palace is the
  only zero-click card because its Imperial Favor modifier is passive.
- Ten-game deterministic card audit: 10 prepared-Tadaka play starts and 12
  legal non-unique Disguised base selections; 5 Fushichō purchases and 5 Shiba
  Tsukune resurrection selections. Asako Tsuki is unique and is excluded from
  the Disguised base map.
- Earlier instrumented Crane baseline (2026-07-13), seed 1 heuristic, seats
  alternating, pooled N=60:
  **Phoenix Shugenja 38–22 Crane (63.3%)**, average 6.6 rounds, all games
  decided. Phoenix wins: 25 conquest / 13 dishonor; Crane wins: 9 conquest /
  13 dishonor.

Commands:

```powershell
node tools/selfplay/matchPhoenixShugenja.js 20 1
node tools/selfplay/auditCards.js phoenix-shugenja 10
npx jasmine --config=jasmine-bots.json
```

## Two-broken-province reserve tuning (2026-07-18)

The shared preliminary stronghold planner originally reserved Phoenix
Shugenja's attacker as soon as the opponent's ready skill reached the weakest
outer province plus stronghold-province strength. That is too cautious for this
ring/spell deck: losing conflict opportunities also loses ring fate and its
character/card ring triggers. Its injected `preStrongholdThreatRatio` is now
`1.5`; final exposed-stronghold defense is unchanged.

Paired seed-3 tests with identical games improved the Unicorn matchup by 6.7
points, Crane and Lion by 2.5 each, and were neutral against Scorpion and Dragon
Attachments. The final focused Unicorn validation was 56-44 at N=100. The full
standard seed-3 round robin reached 58.0% (208-151, one other) at 40 games per
matchup, up from 55.5% before this fine-tune. Use
`compareProfileVariants.js` to repeat this profile-level A/B.
