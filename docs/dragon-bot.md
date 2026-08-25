# Dragon "Monks In Da High House" bot deck

EmeraldDB deck: `4fb91e58-9c3b-47e1-983e-133e0a4d9254` (Lion splash).

This is a Togashi Mitsu card-count engine. It builds durable monk towers, then
plays an exact number of cards in selected conflicts to unlock High House of
Light, Togashi Mitsu, Togashi Ichi, and Teacher of Empty Thought.

## Exact card-count plan

The bot reads `cardsPlayedThisConflict` before every play. That engine value
already includes Shintao Monastery's passive `+1 card played`, once for every
Monastery in play.

Live thresholds are:

- Teacher of Empty Thought: 3 own cards.
- High House of Light: 5 own cards while an own Monk participates.
- Togashi Mitsu: 5 own cards while Mitsu participates.
- Togashi Ichi: 10 cards total between both players, only while Ichi attacks a
  non-stronghold province.

Before starting, the policy counts cards that are currently playable and pass
their playbook gates. It chooses the highest reachable live threshold. If the
Ichi threshold is not reachable but a 5- or 3-card payoff is, it falls back to
that exact lower threshold. If no live threshold is reachable, it preserves
the hand for the next conflict.

High House's five-card plan is only valuable when at least one ring already has
fate, or when the planned sequence contains a card that can put fate on a ring
before the stronghold resolves. With neither source, the bot may still use High
House for event protection, but it does not burn cards merely to reach five.

At the threshold, board abilities are activated first. When all live payoff
abilities are exhausted, the bot passes instead of playing a sixth, seventh,
or later unnecessary card. High House is never bowed early for its small
skill-only effect.

Centipede Tattoo is the save-plan exception: in a losing non-stronghold
conflict, it may be attached to a ready participant even when the threshold is
unreachable, preserving that character for another conflict.

## Conflict card ordering

For a 5+ card plan the preferred order is:

1. Togashi Acolyte as an attachment, so every later card grants its bonus.
2. Hurricane Punch, gaining skill and drawing a replacement.
3. Void Fist after the count reaches 2, targeting the strongest legal enemy
   participant.
4. Swell of Seafoam after another Kiho, gaining its honor rider.
5. Iron Foundations Stance after another Kiho, gaining its draw rider.

If no enabling Kiho is available yet, ordinary playable cards are used before
Swell and Iron so Void Fist can become legal. Once the exact threshold is met,
remaining cards stay in hand.

## Card-specific steering

- Way of the Dragon targets, in order: Togashi Mitsu, Tranquil Philosopher,
  Teacher of Empty Thought, Kitsuki Investigator. The bot uses the granted
  second activation; Teacher's targetless second use has an explicit guard.
- Mitsu receives 4 additional fate when the prompt allows it. Other printed
  cost 3-4 characters receive 2.
- Cycle of Rebirth targets an own weak province card and preserves Mitsu,
  Ichi, Tadakatsu, Teacher, Tranquil Philosopher, and Kitsuki Investigator.
- Ancient Master prefers Togashi Acolyte, then Hurricane Punch, Void Fist,
  Swell, Iron Foundations Stance, and the remaining Tattoos.
- Let Go and Miya Mystic remove an attachment from the strongest enemy tower.
- Buff attachments and helpful effects target own characters. Harmful effects
  target enemy characters. Void Fist never deliberately targets an own Monk.
- When an ordinary province cannot be saved efficiently, the profile can trade
  provinces instead of spending its card-count package on a hopeless defense.
  Target validation still applies during a threshold plan: reaching five never
  permits Ancient Master or another beneficial attachment to target an enemy.
- Court Games compares eligible glory: honor the own high-glory participant,
  or dishonor the enemy when its glory is higher.
- Favorable Ground reinforces a losing defense normally. For this Dragon
  profile only, it instead rescues the strongest ready participant from a
  losing non-stronghold conflict when another conflict remains. Other decks
  retain the old reinforcement behavior.
- Dual-mode Ancient Master, Tattooed Wanderer, and Togashi Acolyte are played
  as attachments when that mode is offered.
- In Service to My Lord can be played from hand or the conflict discard and
  readies a key Dragon tower.

## Other deck behavior

- Keeper Initiate in the dynasty discard adds a large Void-ring priority.
- Togashi Tadakatsu gives the attacking opponent the lowest-valued legal ring.
- Sacred Sanctuary is placed under the stronghold and readies a bowed Monk.
- Draw-phase bids use the shared card-engine `DrawBidTactics` profile: round 1
  is 5, later bids normally remain high for the five/ten-card engine, with
  honor safety and conquest-emergency rails. The old fixed later bid of 2 is
  available only through the legacy A/B policy. Duel bids still use the shared
  skill/honor/round matrix.
- Defend Your Honor is interrupt-only and is never clicked proactively.

## Verification, 2026-07-14

Self-play alternated seats against the Crane precon, 100 games, seed 1.

| Run | Result | Decided win rate | Avg rounds |
| --- | ---: | ---: | ---: |
| Dragon baseline | 55-45 | 55.0% | 7.7 |
| Dragon exact-threshold logic | 65-34, 1 undecided | 65.7% | 7.8 |
| Phoenix control baseline | 69-30, 1 undecided | 69.7% | 6.2 |
| Phoenix after Dragon-scoped Favorable Ground | 69-30, 1 undecided | 69.7% | 6.6 |

An initial generic Favorable Ground retreat rule reduced the Phoenix control to
57-43. That version was rejected. Retreat is now Dragon-only; the final Phoenix
control exactly matches its baseline result.

Focused bot suite: 140 specs passed. TypeScript compilation also passed.

## Tower reuse, 2026-08-24 (`DragonProfile.towerReuse`)

Driven by six human replays of this deck (`game replays/dragon monk`). The
pilot's own description of his plan: commit ONE tower (Togashi Mitsu, else
Togashi Ichi / Togashi Tadakatsu), buff it with many cards rather than
committing more bodies, and keep it usable across several conflicts with Swell
of Seafoam and In Service to My Lord.

### What the replays actually showed

The bot was already AHEAD of the human pilot on most of this deck's engine,
which is the opposite of the starting hypothesis:

| | bot | human |
| --- | ---: | ---: |
| cards played per conflict | 3.27 | 2.15 |
| own count reaches 5 | 41% of sides | 25% |
| Acolyte triggers | 22.5/game (avg +7.03 skill when firing) | 12.5/game (+4.41) |
| High House 5-card fate move | 2.29/game, 74% of bows | 1.17/game, 78% |
| Togashi Ichi auto-break | 4 in 24 games | 0 in 6 |
| Mitsu ability, of LEGAL windows | 93% | -- |
| In Service to My Lord | **0.00/game** | 0.83/game |

Two things were genuinely wrong, and both were defects rather than strategy.

### Defect: In Service to My Lord never resolved (fixed)

`JigokuBotPolicy.polarityTargetDecision` gated the READY-target branch on
`lion`. In Service is a Lion card, but the decks that SPLASH it carry no
`LionTactics`, so Dragon fell through to the wrong-side cancel below it: the
bot paid the bow cost, reached the ready prompt, and abandoned the play.
Measured at **46 clicks and 0 completed plays over 48 games**. The branch is
now generic, with Lion's own scorer kept where `LionTactics` exists.

Effect: 0 -> 0.33 plays/game. Measured **+0.92pp, p=0.45** over 763 paired
games / 12 bases -- a null. Ships as CORRECTNESS, like `polarityGuards` and
`attachmentTarget`; do not re-measure it hoping for a number.

### Why the tower is missing: it is BOWED, not left at home

Over 48 games, the payoff character is in play but absent from 30-56% of
conflict-sides. The split settles which lever is the right one:

| tower | participated | missed: BOWED | missed: ready, left home |
| --- | ---: | ---: | ---: |
| Mitsu attacking | 62% | 29% | 9% |
| Mitsu defending | 44% | 39% | 16% |
| Ichi attacking | 70% | 18% | 12% |
| Ichi defending | 33% | 33% | 34% |

Bowed dominates, so declaration priority is the WRONG fix and the reuse engine
is the right one.

### Shipped (`readyBetweenConflicts`, `preferTowerForProtection`)

- Between conflicts (`me.phase === 'conflict'` and no attacking player, the
  same window test the `unopposedWindow` lever uses), a BOWED tower plus a
  remaining conflict opportunity buys In Service to My Lord: bow a spare
  non-unique, stand the tower back up for the next conflict.
- Swell of Seafoam and Iron Foundations Stance aim at the TOWER. Both carry
  `targetPreference: 'strongest'`, which in a MILITARY conflict cannot separate
  Mitsu, Ichi and Tadakatsu (all printed 4), so the body the deck needs next
  conflict was protected only by luck.

Census: In Service 0.33 -> 0.75/game (human 0.83); Swell on the tower 42% ->
47%; Iron Foundations 80% -> 83%. Swell moves least because it can only target
a PARTICIPATING monk -- when the tower is not in the conflict the knob has
nothing to aim at, which is the same root cause again.

Measured **+0.92pp, p=0.494** (77 decided of 762 paired games, 12 bases, 5/12
bases positive). That is a null. It ships on the owner's call because it makes
the bot play the line a human pilot actually plays, the same standing as
`conflictTempo.tradeDefenseWinOnly` and `drawBidding.cardsOverHonor`. Do not
cite it as a measured win.

### REJECTED: `requireTowerForFiveCount` (ships `false`, do not repropose)

The pilot's stated rule -- before round 3, or without Mitsu, play the fallback
bodies but do NOT invest five cards or High House in them, so the hand is
stocked when the real tower lands -- was implemented exactly
(`primaryTowerIds` / `fallbackTowerIds` / `fallbackTowerFromRound: 3`).

| arm (12 bases, ~761 paired games each) | delta | p | decided |
| --- | ---: | ---: | ---: |
| all three knobs | **-1.97pp** | 0.245 | 145 (+65/-80) |
| reuse + protection only | +0.92pp | 0.494 | 77 (+42/-35) |
| DROPPING the five-count gate | **+2.89pp** | **0.041** | 106 (+64/-42), 7/12 bases |

The gate alone costs about 2.9pp and is the only result in the series to clear
the noise floor. Its premise is false: High House converts **74-76% of its
bows** into the ring-fate move, so a five-card push with NO tower participating
still pays, and refusing it throws that away. Note the direction -- this is a
case where the human pilot's own model of his deck was measurably worse than
what the bot already did.

### Rig fault found here: `SUBJECT_PROFILE` is not bit-clean

The mandatory null arm (the knobs injected at their own defaults through
`deckFieldWinRate`'s `SUBJECT_PROFILE`) scored **437-326 against a 432-331
control, 19 of 763 games differing**. Injecting ANY override adds
`v2: { highConfidenceGate: {} }` to the DeckProfile and rebuilds every named
tactics sub-profile as a fresh object per decide(); nothing on the V1 path
reads `profile.v2`, but the games still diverge. This is pre-existing and
unrelated to the knobs.

Consequence: measure Dragon-scoped arms **build vs build**, not through
`SUBJECT_PROFILE`. The build-vs-build control was verified bit-clean -- the new
code with every knob off reproduced the previous build on **763 of 763 rows**.
Every number in this section was taken that way.

### Guard repaired here: the stage-READY counter was a single-game signal

`test/server/integration/botreadyvalue.spec.js` asserts the ready -> move
sequencer commits at least one plan at stage READY. On the default base the
WHOLE FIELD produced that in exactly one game -- a Lion plan (In Service to My
Lord -> Matsu Mitsuko on Akodo Toturi) -- and that game happened to be a
Lion-vs-Dragon pairing. Fixing Dragon's In Service play re-rolled the
trajectory of that one game and the assertion went red with 0 commitments,
while the sequencer itself was fine: 64 commitments at stage MOVE on the same
run, and stage READY still fires on bases 93001 and 94001.

A guard that any change to either deck in one pairing can delete is not a
guard. The stage counter now samples `READY_PLAN_BASE` (93001) when the primary
base comes up empty. Only `plansCommitted` reads those games -- the ready/move
defect censuses carry allowance lists tuned to the primary base and must not
see them. Every other base carries its own unrelated open defects
(`unicorn-ride-on-move-target` on 93001/94001, `waves-ready-bowed` on 93001),
which is why the primary base could not simply be widened.

## Replay 2026-08-25: ring aiming, and two rejected plans

Full record in `docs/bot-dragon-replay-2026-08-25.md`. Summary of what changed
in this profile:

- `ringPriority.countKeepersInProvinces` (**shipped**, default `true`). Keeper
  Initiate returns to play from a **province** as readily as from the dynasty
  discard (`KeeperInitiate.location`), and the void-ring bonus counted only the
  discard, so the copies sitting faceup where they start were invisible to the
  ring choice. Inert on its own -- 4 flips in 768 games -- because a ring
  holding one fate already outranks every element bonus; it ships because it
  removes a blind spot rather than expressing a preference.
- `ringPriority.philosopherFateMove` (**shipped**, default `true`). Tranquil
  Philosopher's two ring prompts want OPPOSITE answers and V1 answered both with
  its ordinary "best ring" sort, naming the ring we wanted as the fate DONOR.
  The donor is now the fattest OTHER unclaimed ring when the move is worth
  making, and the EMPTIEST other ring when it is not -- the ability gains an
  honor either way, so it is never declined, only aimed. The destination ring is
  chosen with fate IGNORED, because the fate is the thing being moved.
- `ringPriority.fateDominanceThreshold` (**rejected**, ships at `0` = the
  generic reading) and `ringPriority.unhonoredTowerFireBonus` (**rejected**,
  ships at `0`). 54.5% on the search bases, 45.0% on 24 fresh ones, 49.4%
  pooled over 48; and 46.7% respectively.
- `towerFocus` (**rejected and REMOVED**). "One tower, then cheap bodies, hold
  fate for the conflict hand" is decisive -- 25-42% of the Dragon seat's games
  flip -- and loses in all eight scopings measured, 31-43%. The mechanism is the
  buy ORDERING, not the reserve: the reserve-0 / never-hold arm withholds no fate
  and still read 40.8%. What loses is trading a tower for a cheap body -- every
  non-tower body in the list is 1-2 skill against the towers' 4. (The deck's
  conflict hand is cheap but not free: **40 slots, 26 at cost 0, 10 at 1, 4 at
  2** -- 35% paid, mean 0.45, joint-cheapest in the field with Crane.) Wrong
  sign, not wrong scope. The code is gone rather than parked at
  `enabled: false`, because the seed-coverage guard is there to catch dead
  branches; `docs/bot-dragon-replay-2026-08-25.md` records how to rebuild an arm
  if a NEW mechanism ever justifies one. Do not re-propose it.
