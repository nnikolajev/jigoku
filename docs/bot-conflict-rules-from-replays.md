# Conflict rules taken from human replays

Source: five games the project owner played with the Phoenix Shugenja deck
against Bot V1 (Crane, Crab, Lion x2, Unicorn), 2026-08-11, all five won.
Cleaned single-game replays live in `game replays/phoenix shugenja/clean/`.
The owner then explained the reasoning behind every declaration, defense and
pass the analysis could not derive. This file records those rules, whether V1
already implements them, and what each one measured.

The point of the exercise is GENERIC logic. A rule that only makes sense for
one deck belongs in that deck's profile; everything here is meant to apply to
every deck and is measured that way (see `.claude/skills/roundrobin/SKILL.md`).

## The rules

### 1. Attack sizing is against READY bodies, and Covert subtracts from them

> "It doesn't matter how many bodies enemy has, it matters how many ready
> bodies enemy has."

Crab R2c2: the opponent had six bodies and two ready. Two Covert grants covered
both, so the defense was zero and the third attacker was surplus — kept back
for a second attack rather than added to the first.

**Status: already modelled.** `ConflictPhasePlanner.availableCharacters` filters
on the ready set and `evaluateAttack` removes `covert` attackers from the
defender list before sizing, and `applyAttackerPlan` is live in V1.

**Gap: the input, not the logic.** `ConflictPlannerCharacter.covert` is only set
once a qualifying conflict is already running, so a "Covert during water
conflicts" grant is invisible at declaration. `selfRingCovert` publishes it and
is gated behind `shugenja.ringPlanPlannerResources`, measured 87.5% inert while
the ring plan was off — a premise that changed when the ring plan shipped.

### 2. A declaration is a fork, and both branches pay

Unicorn R2c1: declared with 3 skill into a facedown province. If they defend,
their stronger body is bowed and cannot attack; if they do not, two Feral
Ningyo arrive from hand for the break. Value is `max(branch)`, not the expected
break — and bowing a STRONGER enemy body is itself the payoff when you are the
weaker board.

**Status: partly modelled, and the missing half is now half-solved.** The
rollout bows defenders and keeps playing the phase, so the tempo half is priced.
The other half — a free body arriving from hand at the NEXT conflict — is still
absent from the PLANNER; `handThreat` prices hand cards as one skill lump added
to the CURRENT conflict.

What shipped instead is the cheap, unambiguous corner of it: rather than "what
might my hand be worth at the next declaration", **"there is a conflict I am
about to throw away, nothing of theirs is standing, and I am holding a body"**.
See rule 16 and [`bot-unopposed-window.md`](bot-unopposed-window.md). The
general version — valuing a hand body inside the declaration fork — remains
open.

### 3. Last conflict of the phase: declare on the fattest ring even when hopeless

The attacker takes ring fate at DECLARATION, and on the last conflict the bodies
being bowed have no further use, so a lost conflict is free. Exception: a deck
that lives on the Imperial Favor (Scorpion censure) should not hand it over.

**Status: already modelled.** `immediateValue` prices ring fate at
`ringFateValue: 2.5` and the rollout has no later use for the bowed bodies.

### 4. Defense is the first half of a two-conflict plan, or it is not worth it

Crane R2c3: defended 4 into 6 and lost, but spent Clarity of Purpose so Tsukune
never bowed and could attack next conflict. The plan died to Elegance and Grace
readying Iron Crane Legion. The cost of defending is the body's next attack; a
card that removes that cost makes defending free.

**Status: the cost model exists** (`bowsAfterConflict` is respected in the
rollout) but `ConflictPhasePlanner.planDefense` is inert for V1
(`applyDefensePlan` defaults false), so V1's defense is decided by the static
`defenseCommitment` instead.

Across five games the human was asked to defend twelve times and defended six.
Every declined one was a 7-, 12- or 13-skill attack he could not have won.

### 5. Target the province you can read

In priority order:

1. A face-up province, because its reveal effect cannot spring.
2. Otherwise read the dynasty card sitting in it — a strong character is worth
   attacking to discard, since breaking the province discards it.
3. A face-up HOLDING's strength bonus is the only strength information either
   player has about a province that is still facedown. A +0/+1 holding leaves it
   cheap; a bigger bonus makes that province the wrong target.
4. Otherwise attack an unknown one.
5. Stronghold as soon as it is legal (three broken, or a card that exposes it
   early — Unicorn's Scouted Terrain).

**Status: was NOT modelled; implemented this pass.** `ProvinceTargetingTactics`
ranked on tier -> facedown -> eminent -> strength -> ability class, with
`preferFacedown: false` making face-up and facedown score IDENTICALLY, and the
dynasty stack reaching the sorter only through `dynastyValue`, which
`OmniscientBotCapability` alone supplies. Faceup dynasty cards are public
information, so a fair bot may read them.

Three knobs, all default 0 (V1 ordering unchanged, verified by
`refactorIdentity.js`):

| knob | effect |
|---|---|
| `faceupProvinceDiscount` | strength discount on a revealed province; small = tie-break, large = absolute preference |
| `faceupDynastyDenialWeight` | discount per point of faceup dynasty value in that province |
| `faceupHoldingStrengthWeight` | faceup holding bonus ADDED to a facedown province's estimated strength |

Fed by `JigokuBotController.opponentFaceupDynastyDenial`, which is faceup-only
and therefore fair. Denial and holding strength are separate fields because they
pull opposite ways: a holding is worth discarding AND makes its province harder.

Reachability, two live games: the map is populated on 1036 of 1050 decisions and
discriminates between locations on 865 of them.

### 6. An all-in attack is a probe

Crane R4: attacked the stronghold with everything, lost 17-18 to Shameful
Display, then played a fresh Feral Ningyo at home and broke it with 4 unopposed.
The branch was chosen from their response — everyone defended, so the break came
from a body that was not on the board when the first conflict was declared. Had
they left one home, the line was Kyuden Isawa replaying Supernatural Storm plus
Oracle of Stone to push the first attack through.

**Status: the second half now IS modelled.** The branch selection is not — that
needs the same hand-value model rule 2 wants. But the thing that actually won
this game, *play a body after the failed all-in and break with it unopposed*, is
what `UnopposedWindowPolicy` does, and it measured **+0.53pp**. See rule 16.

### 7. At three provinces each, the first-player token decides the race

> "If 2nd player in 3-3 always defend and try to play characters with 1 fate."

As second player the opponent attacks the stronghold first and `mustAttackStronghold`
means every attack goes there, so surviving the round IS the plan. Buying
characters with one fate on them makes them persist; next round the token has
passed (`RegroupPhase.passFirstPlayer` alternates it unconditionally), the
first conflict is yours, and that is the all-in.

**Status: V1 races, but unconditionally.** `StrongholdDefenseTactics.plan`
already has the branch — `opponentStrongholdExposed` returns
`last-conflict-all-in` with `forceAllAttackers` — and it fires without checking
whether the opponent still has a conflict opportunity. The planner does treat a
stronghold break as terminal (`strongholdBreakValue: 500`, rollout tail cut at
that node), but the rollout is ONE phase and has no next round in it.

`strongholdDefense.raceRequiresSafety` (default false, V1 unchanged) gates the
race on the opponent being unable to answer: either no conflict opportunity
left, or their whole ready board cannot break our stronghold undefended. It
reuses the existing `survives([])` test, so "can they answer" is the same
calculation the reserve search already runs.

Reachability, 17 games: the race branch fired 24 times and in 24 of 24 the
opponent still had a conflict to come. The gate changes the answer in 14 of
those — roughly 0.8 game-deciding decisions per game.

**REJECTED, and this one contradicts the human rule.** Paired probe, bases
310001/311001/312001, 816 games per seat:

| seat | decided | to gate | away |
|---|---|---|---|
| 0 | 37 | 9 | 28 |
| 1 | 36 | 6 | 30 |
| pooled | 73 | 15 | 58 |

Net about -2.6pp, p ~ 1e-7, and BOTH seats agree in sign and size — the check
that has caught every false positive here. Racing unconditionally at three
provinces each is right for this engine, even into an opponent who can answer.

Worth stating plainly: the human's reasoning is sound for HIS games and loses in
self-play, which is the fifth defensive lever to do so (see `defenseBreakTie`,
the defense buffer, `chumpBlock`, the dynasty-phase skip). The common thread is
that bodies kept ready are worth less than the tempo spent to keep them, because
only the attacker resolves a ring and only the attacker breaks a province. The
gate stays in the code at `raceRequiresSafety: false` as a documented negative.

### 8. Never pass a conflict opportunity voluntarily

> "Not unopposed honor. Ring effect, fate on ring. Potential break if i have
> some buffs. I always try to attack."

**Status: V1 mostly agrees.** Across the five games V1 passed voluntarily twice,
and both were `StrongholdDefenseTactics.holdAllAgainstCovert` reserving the whole
board against the human's Adept-granted Covert — i.e. V1 was applying rule 7,
not failing rule 8. Low ceiling; not pursued.

### 9. Honor is a resource; cards are power (draw bid)

> "Bot always bids 1 to get honor. Majority of decks don't win by honor so
> conflict cards are much more valuable for them. Even if I have 1 or 2 honor
> and enemy has 22 or 23 it's okay if strongholds can be attacked."

Amount rule, added after the first pass: bid from the honor DIFFERENCE, not the
maximum — "I usually bid 3, not 5, so I give opponent just 2 honor" — and bid
more conservatively against a deck that can win on the honor track.

The replays back the description exactly. Post-round-1, across five games, the
human bid above 1 in **8 of 13** rounds (3, 5, 5, 3, 3, 4...) and the bot in
**0 of 13**, while the human sat at 3-4 honor and won all five.

Instrumented over 17 games, 140 post-round-1 bids: the bot bids 1 in **55%** of
them, and the deciding rails are `protect-low-honor` (28.6%) and
`pressure-opponent-dishonor` (20.0%). With a stronghold already open — 58 of
those bids — the honor rails still took **35**, because they are ordered above
the conquest rails. So the rule could never fire.

`drawBidding.cardsOverHonor` (default false) keeps every honor rail but only at
the number where honor can END the game (own win >= 22, their win >= 22, their
dishonor <= 2), with a safety floor of 5 so a maximum bid can never be lethal,
and computes the amount as `predictOpponentBid + budget` (2 normally, 1 against
an opponent whose known decklist has an honor/dishonor plan, via
`JigokuBotController.opponentHasHonorPlan` reusing `deriveDeckStrategy`).
Decklists are public, so that is fair information. It behaves as described:
bid 1 falls 55% -> 42.3% and bid 3 rises 5.0% -> 16.2%, i.e. 3 becomes the
common value rather than 5.

**REJECTED, both arms, both seats agreeing** (bases 400001-402001):

| arm | decided | to change | away | effect | p |
|---|---|---|---|---|---|
| stronghold-gated | 89 | 31 | 58 | -1.65pp | 0.0055 |
| every round | 362 | 111 | 251 | **-8.58pp** | 1.4e-13 |

The unrestricted version is catastrophic and the gated version is merely bad,
which is itself the shape of the answer: the more often the bot pays honor for
cards, the worse it does.

**Why the human rule is right and the bot's is too:** the human CONVERTS extra
cards, and the bot largely does not. Its own event pricing found 81% of conflict
cards unpriced, and `estimateHandThreat` scored zero for a hand holding Shrine
Maiden and two Display of Power because it could not afford them. Cards it
cannot use are not worth honor. The same fact from the other side is
`FATE_ECONOMY_DRAW_BID_PROFILE`, where bidding LOW measured **+4.58pp**
(p=1.6e-9). The lever to chase is card CONVERSION, not the bid.

### 10. Card play: the bot could not see what it was allowed to target

Chasing "make the bot actually play its conflict cards" produced a measurement
chain worth recording, because the headline number did not survive it.

**Conflict regret.** For every conflict the bot participated in, compare the gap
it needed against what its OWN hand model says the hand could add, at the fate
it held. 325 conflicts over 17 games: 159 losing, of which 80 were losing by a
coverable margin, plus 46 more winning-but-short-of-the-break. That looked like
39% of conflicts decidable by a card in hand.

**It does not survive attribution.** Scoping the per-card denials to the exact
conflicts that produced regret:

| bucket | count |
|---|---|
| deliberate defensive non-spend (`defense-province-safe`, `defense-already-winning`, `rush-never-spends-on-defense`) | ~68 |
| refused at a named per-card gate, mostly the card's own precondition | 52 |
| passed while ahead and lost anyway | 21, of which only 7 within one card |
| no conflict window opened at all | 1 |

The defensive non-spends are correct — same economics as
`defenseBreakTie`. `strength-already-sufficient` looked like a defect at 32
occurrences unscoped and turned out to be **1** when scoped to regret
conflicts; the unscoped count was an artifact.

**Window timing is real but small.** The bot closed a window while ahead 194
times and lost the conflict in 21 (10.8%). Median flip was 5 skill, more than a
single event's swing, and only 7 were inside one card. In all 21 the opponent
held cards, so its instinct is not random — it simply never prices the
opponent's ability to answer. Too small to measure against a 2.5pp noise floor.

**The defect that WAS real.** `assassination` gated on
`getCardModel(card.id)?.fate <= 2`, requiring a curated model entry. That
registry covers **22.4% of dynasty characters**, and of the 99 legal targets in
the deck pool (printed cost <= 2) only 25 have one — so **74 legal targets were
invisible** and the card was refused with a kill standing on the board. It found
a legal target in 42 of 1072 evaluations (3.9%).

**SHIPPED at +1.49pp (p=1.8e-05).** Arm is `liveCharacterCosts: false`, so the
positive number is the FIX winning:

| cell | bases | old | new | fix | p |
|---|---|---|---|---|---|
| run 1 seat 0 | 420001-422001 | 24 | 38 | +1.72pp | 0.098 |
| run 1 seat 1 | 420001-422001 | 21 | 30 | +1.10pp | 0.262 |
| confirm seat 0 | 430001-435001 | 35 | 57 | +1.35pp | 0.028 |
| confirm seat 1 | 430001-435001 | 26 | 54 | +1.72pp | 0.0023 |
| pooled | 9 bases | 106 | 179 | **+1.49pp** | 1.8e-05 |

Confirmation alone (six FRESH bases, both seats) is +1.53pp, p=0.00017. Same
sign in all four cells and it strengthened on fresh bases instead of
collapsing — the opposite of the ring plan, where the seats inverted.

`characterPrintedCosts` already held exact live costs for BOTH sides
(`characterNumberHint` walks player and opponent) and was already consulted by
three other playbook entries — it simply was never added to the `playCtx` that
card-play intent checks use. Adding it, plus relaxing the honor floor from 6 to
4 on a `strongholdConflict` (a flag that already existed), moved legal-target
detection to **10.9%** and honor refusals from 38 to 3. Reverts with
`liveCharacterCosts: false`.

**The pattern to remember:** three separate defects this session were correct
logic fed an empty input — `cardPiles.hand` in the ring break test,
`estimateHandThreat` for the hand baseline, and `characterPrintedCosts` here.
Before tuning a decision, check what its inputs actually contain.

### 11. Dynasty width over a tower (REJECTED)

> "Unless there are tower characters it's better to have wide board early turns
> while enemy has 1 character. More bodies is better if we can't ready
> characters."

Round 1 vs Scorpion the bot bought Isawa Ujina (cost 4) with 2 extra fate — six
fate on ONE body — while the owner would buy Ethereal Dreamer + Young
Philosopher at 1 fate each: five fate, two bodies, near-identical political
skill. Ujina is not in this deck's `towerIds`
(`isawa-tadaka-2, fushicho, shiba-tsukune, kudaka`); it was bought as a generic
"durable" because `durableCostThreshold: 4` classifies any cost-4+ character
that way, and `durableAdditionalFateEarly: 3` then funded it.

`fateAwareEconomy.prioritizeBodies` already expresses the rule
(`playBody() || playDurable()`, `JigokuBotPolicy.ts:7511`). Reachability was
strong — the winner changed in 7 of 17 games and average round count fell
4.8 -> 4.5. **Measured field-wide and rejected:**

| seat | decided | to change | away | effect |
|---|---|---|---|---|
| 0 | 132 | 53 | 79 | -3.19pp |
| 1 | 141 | 49 | 92 | -5.27pp |
| pooled | 273 | 102 | 171 | **-4.23pp**, p=3.5e-05 |

Both seats agree and both are individually significant. Note the arm is the
GENERAL rule (every deck, every round); it cannot distinguish "wide is wrong"
from "wide is right early and wrong later". The narrow version — treat a cost-4+
NON-tower as a body rather than an investment, using `durableCharacterIds`
scoped to the tower list — was not measured, by the owner's decision.

### 12. Hand-threat preconditions in the planner (INERT)

`handThreatPreconditions` (default true) caps a hand-threat estimate by whether
its cards have a legal target, derived from the model's `tag`: a buff needs one
of our bodies in the conflict, removal/debuff/duel needs one of theirs, a body
needs neither because it CREATES a participant.

At the planner it is **inert: 6 flips in 1632 games**, split 2/4. At declaration
time both sides essentially always have a ready body, so the guard is true
almost every time it is evaluated. The precondition only binds where
participants can genuinely be zero, which is MID-conflict — and every
mid-conflict hand-threat call in the policy (lines 2244, 3418, 3674, 3919, 4133)
is `omniHandThreat`, gated on `omni`. Lobby games run `informationMode: 'fair'`
by default (`server/lobby.js` sets `omniscient: botDetails.omniscient === true`),
so wiring it there would not touch a normal game.

Kept on because it is correct and free; not claimed as a win.

**Reachability lesson:** check how often a guard's condition is actually FALSE
before building on it. The Assassination fix bit constantly because its input was
missing 90% of the time; this one never bites. Same class of correctness fix,
opposite reachability, and the difference was knowable in advance.

### 13. The declaration is a board read, not a constant

> "I need my ready characters, enemy ready characters, conflicts remaining, who
> is first player, my character individual values, enemy character individual
> values. I value attack more for ring resolution and gaining fate. If my
> characters are weak I want to exchange provinces. If my characters are strong
> I want to try and defend with one, then attack water ring to ready my
> character again for another conflict... If I know defense is pointless I would
> rather lose 1 honor but make an attack myself."

Six inputs, and V1 reads four of them. What it does NOT do is combine them into
a posture: whether to trade provinces or hold the board is `defenseCommitment`,
a per-deck CONSTANT chosen when the deck profile was written, and it never looks
at the board in front of it. The same conflict phase gets the same posture at
3-skill-against-9 and at 9-against-3.

`ConflictTempoPolicy` (new, injectable, `enabled: false` = V1 exactly, verified
bit-identical by `refactorIdentity.js` at `9dde5aec8cc80a74`) turns those six
inputs into one read and three derived decisions:

| knob | decision |
|---|---|
| `weakBoardRatio` / `strongBoardRatio` | the stance: `trade`, `even`, `control` |
| `bestBodyWeight` | how much of the best INDIVIDUAL body on each side enters the ratio |
| `tradeDefenseWinOnly` | on a losing board, size defenses `win-only` — concede what cannot be won |
| `tradeAttackSendAll` | on a losing board, send every eligible body instead of V1's all-but-one |
| `readyRingBonusPerSkill` | price the water ring from the bowed body it would ready |
| `readyLoopCountsDefense` | count an opponent conflict still to come as a reason to ready |
| `controlAttackKeepHome` | on a winning board running the loop, keep a body back to defend and be readied |

Two things in there are new information rather than new weights.

**The ready loop.** V1's water score already notices a bowed body but prices it
at a flat 25 against earth's 40, so a 5-skill body lying bowed loses to earth
exactly as a 1-skill one does; and it fires only while WE have two conflicts
left, never when the readied body's use is DEFENDING a conflict the opponent
still has coming. `readyRingBonusPerSkill` prices the ring from the body it
brings back, and `readyLoopCountsDefense` covers the half of the rule V1 could
not see.

**Defending less.** `tradeDefenseWinOnly` is the first defensive lever in this
project that points at defending LESS. The five that measured negative
(`defenseBreakTie`, the defense buffer, `chumpBlock`, the 3-3 safety gate, the
dynasty skip) all pointed the other way, and the cause each time was that a
ready body is worth less than the tempo spent keeping it. That reasoning
predicts this one is positive, which is the only reason it is worth a run.

#### Measured: one of four levers survives

Paired probe, `KINDS=conflict-tempo`, bases 500001/501001/502001, 816 games per
seat. Search phase, seat 0:

| lever | flips | to / away | effect | p | ceiling |
|---|---|---|---|---|---|
| ready loop | 25 | 18 / 7 | **+0.67pp** | 0.043 | 1.53pp |
| `tradeDefenseWinOnly` | 95 | 46 / 49 | −0.18pp | 0.84 | **5.82pp** |
| `tradeAttackSendAll` | 16 | 4 / 12 | −0.49pp | 0.077 | 0.98pp |
| `controlAttackKeepHome: 1` | — | — | broken arm | — | — |

**SHIPPED: the ready loop, +0.32pp, p=0.009.** Both seats, 9 independent bases,
4896 games, 82 flips toward the change against 51 away:

| cell | bases | to | away | effect |
|---|---|---|---|---|
| search seat 0 | 500001-502001 | 18 | 7 | +0.67pp |
| search seat 1 | 500001-502001 | 15 | 10 | +0.31pp |
| confirm seat 0 | 510001-515001 | 27 | 19 | +0.25pp |
| confirm seat 1 | 510001-515001 | 22 | 15 | +0.21pp |
| pooled | 9 bases | 82 | 51 | **+0.32pp**, p=0.009 |

All four cells positive; it WEAKENED on fresh bases (0.49 -> 0.23) rather than
inverting, so the search bases were optimistic by the usual ~0.2pp. Causally
per deck, over all 4896 games: Unicorn **+1.56pp** (p=0.049), Lion **+1.39pp**
(p=0.039), Crab +1.22pp, ScorpionBidWar −0.69pp (7/11, p=0.48 — inside noise;
not scoped out, on the same reasoning that found no deck qualifying to disable
`saveFatePass`).

**NULL, SHIPPED ANYWAY (2026-08-12) at the owner's request** so the stance can
be watched in live play — `tradeDefenseWinOnly: true`, field-wide on
`DEFAULT_PROFILE.conflictTempo`. Null, not negative. Revert with
`tradeDefenseWinOnly: false`. The measurement below stands unchanged and is the
reason it is not claimed as a win.

**Why it measured null, and this one contradicts the human rule.**
It is not unreachable — it diverges in 11656 windows across **94% of games**,
the widest reach of anything measured here — and lands at −0.18pp, p=0.84 on a
5.82pp ceiling. That is the familiar shape of a decisive mechanism with no
direction. Six defensive levers have now measured null or negative, and this is
the first pointing at defending LESS, so the standing explanation ("a ready body
is worth less than the tempo spent keeping it") does not survive either: defense
SIZING appears to be close to a free parameter in this engine in both
directions. The owner's rule is sound for his games and does not transfer.

**REJECTED: `tradeAttackSendAll`**, −0.49pp (4/12, p=0.077) on a 0.98pp ceiling.
Small population and the wrong sign; the body V1 keeps home earns its keep even
on a losing board.

**BROKEN ARM, reported as such rather than as a null: `controlAttackKeepHome: 1`.**
Its 816 games were **bit-identical** to the ready-loop arm even though the knob
computed a keep-home of 1 in 822 attack windows. V1's default `all-but-one`
sizing already IS `Math.max(1, totalEligible - 1)`, so the branch is degenerate
with the code it was meant to replace, and the knob can only differ at 2+. The
"defend with one, attack with another" half of the owner's rule turns out to be
V1's existing behaviour for every deck on the default commitment mode. This is
the failure mode the project has paid for before; the check that caught it was
diffing the arm against its neighbour, not the null arm.

### 14. First player next round decides what the dynasty phase buys

> "I evaluate who will be first player next turn. This is important for dynasty
> phase: if I am 2nd player I want to play characters with 1 fate. If stronghold
> is exposed I try to play characters with 0 fate for immediate attack or
> defense."

`RegroupPhase.passFirstPlayer` alternates the token unconditionally, so "am I
second player this round" IS "do I open the next conflict phase" — a fact
already on the board and free to read.

V1 puts fate on a body from its printed cost alone (`bodyAdditionalFateForCostThree`,
so cost-3 bodies persist and nothing else does). Every other cheap body is
discarded in the fate phase of the round it was bought in, which means the
second player's purchases are gone before the round it is buying for. Two knobs
on `FateAwareEconomyProfile`, both defaulting to V1:

- `bodyAdditionalFateSecondPlayer` — floor on a body's fate while we do not hold
  the token, so the board survives into the round we open.
- `bodyAdditionalFateEndgame` + `endgameBrokenProvinces` — the other half: with a
  stronghold already exposed the game rarely reaches another round, so
  persistence is a tax on the bodies that would fight for this one.

**MEASURED NULL, SHIPPED ANYWAY (2026-08-12) at the owner's request** for live
play: `bodyAdditionalFateSecondPlayer: 1`, field-wide, set on
`DEFAULT_FATE_AWARE_ECONOMY` so it reaches all seventeen decks (each per-deck
override spreads that object or `SWARM_FATE_AWARE_ECONOMY`, which spreads it in
turn). **+0.01pp, p=1.00** over 4896 games and 9 bases (79 to / 78 away) — not
negative, simply worth nothing to the self-play field. Revert by setting it to
0. It is a textbook example of why fresh bases are mandatory here:

| cell | bases | to | away | effect |
|---|---|---|---|---|
| search seat 0 | 500001-502001 | 16 | 9 | +0.43pp |
| search seat 1 | 500001-502001 | 14 | 12 | +0.12pp |
| confirm seat 0 | 510001-515001 | 30 | 25 | +0.15pp |
| confirm seat 1 | 510001-515001 | 19 | **32** | **−0.40pp** |
| pooled | 9 bases | 79 | 78 | **+0.01pp**, p=1.00 |

Three positive cells and the fourth cancelled all of them exactly. The rule
reaches only SIX of seventeen decks — eleven show zero decided games, because
their economies do not buy a bare cheap body at that moment — so what looked
like a field-wide rule is a six-deck one, and it is worth nothing on those six.

**`bodyAdditionalFateEndgame: 0` is unmeasurable**: −0.12pp on a **0.49pp**
ceiling, flipping 1.0% of games. Correct logic with no population. Both knobs
stay in the code at their V1 defaults, documented.

### 15. Measuring per deck

The owner asked for per-deck win rates, not just a total. The head-to-head
cannot give them: its per-deck rows are that deck's strength against the field,
and a validated null arm still swings ±28pp on them. The paired probe can,
because it treats one seat and never swaps it — a flip in a pairing where the
TREATED seat pilots deck D was caused by the lever acting on deck D.
`tools/selfplay/perDeckFlips.js` reports exactly that, pooling a `SEAT=0` and a
`SEAT=1` dump so the probe's seat bias cancels the way it does in the
head-to-head. Each deck row is still a small n and remains a hypothesis for a
scoped arm, never a result on its own.

### 16. A passed conflict with a body in hand is a free break (SHIPPED)

> "If conflict still available, all enemy characters are bowed and there is a
> character in hand the bot can play, then play it and declare a new conflict.
> Be aware the character needs to be played in the action window BEFORE that
> conflict, not during it... I don't expect this to occur very often but some
> decks will trigger it."

The deliberately simplified form of rules 2 and 6, and the one that could be
built without an effect model for hand cards. `UnopposedWindowPolicy` is
consulted FIRST in the preConflict action window (`ConflictPhase.ts:43,67`),
ahead of every deck's own setup play — including the Dragon plan of spending
those same dual-mode monks as attachments, because an attachment cannot be
declared as an attacker.

**Reach was the surprise.** It fires in 0.4% of windows, which sounds
unmeasurable, but in **11.4% of games** — one free conflict roughly every nine
games. The gate that closes it is almost always `defenders-ready` (58.9%), then
`no-conflict-opportunity` (22.4%).

**SHIPPED at +0.53pp (p<0.0001)**, 4896 games, 9 bases, both seats, 106 flips to
the change against 54 away, all four cells positive and confirmation alone
+0.49pp on six fresh bases. Per deck: LionDuelist +2.08pp (p=0.004), Unicorn
+1.39pp, CrabSacrifice +1.22pp, Dragon +1.22pp; none negative beyond noise.
Full knob table and population in
[`bot-unopposed-window.md`](bot-unopposed-window.md).

Worth stating next to rule 7 and rule 13, where the owner's reasoning measured
NEGATIVE: this one transfers. The difference is that it is not a sizing
judgement — it converts a conflict opportunity that was being discarded into a
break, which is the one currency this engine actually pays out in.

### 17. Four fixes from the 2026-08-23 Phoenix Shugenja loss

A single lost game (`game replays/debug/`), read decision by decision, produced
two field-wide correctness fixes and one deck-scoped win-rate result:

| rule | knob | measured |
|---|---|---|
| a bid larger than the conflict deck costs 5 honor on TOP of the transfer | `drawBidding.deckExhaustionAware` | ceiling 0.00pp (0 flips / 112) — correctness |
| a tied opponent-aware differential must not flip a dominant own axis | `conflictDeclaration.ownAxisDominanceMargin` = 2 | 1 flip / 112 — correctness |
| Disguised discards the base, so only replace a BOWED one, and only while a conflict can use the ready | `shugenja.disguiseRequires*` | **+3.13pp**, 576 games, 9 bases, p=0.0020 |
| Clarity of Purpose is only fully paid in political conflicts | `shugenja.clarityPoliticalOnly` | (same arm) |

The shape repeats rule 16's lesson. The two levers that touch SIZING or a
threshold are unresolvable; the one that stops a resource being spent for
nothing — V1 disguised onto a ready body **92-94% of the time** — is worth
three points on the decks that run it. Full write-up in
[`bot-phoenix-replay-2026-08-23.md`](bot-phoenix-replay-2026-08-23.md).

## Open threads

1. **Zero fate is the largest untouched cause.** 92 of 228
   `no-card-passed-intent-filter` windows had the bot holding NO fate. That is
   an economy problem, not a card-valuation one, and it is where the evidence
   still points.
2. **Hold-priority** — do not close a conflict window while ahead by less than
   one card's swing when the opponent holds cards and fate. Correct in
   principle; ceiling measured at ~7 conflicts per 17 games, so it can never
   show in a win rate. Ship-on-logic only.
3. **Ring plan scale** — `ringPlanScore` multiplies fate-equivalents by 1000
   against a ring-EFFECT base of 8-50, so a conversion at 4000 drowns every
   effect consideration. This is the likeliest reason the plan measures null
   rather than positive.
4. **`faceupHoldingStrengthWeight`** — 17 to / 7 away on 24 decided games,
   ceiling 1.47pp. Needs pooled decided games on fresh bases, both seats, the
   way the ring plan was finally resolved.
5. **The narrow dynasty rule** (rule 11) if the general one is ever revisited.

## Measurements

Paired probe, seat 0, bases 300001/301001/302001, 816 games per arm. The probe
gives a ceiling and a direction hypothesis, NOT a win rate — see
`.claude/skills/roundrobin/SKILL.md`.

| arm | flips | ceiling | direction |
|---|---|---|---|
| all three targeting knobs, `faceupProvinceDiscount: 99` | 163 (20.0%) | 9.99pp | 83 to / 80 away, p=0.88 |
| `faceupProvinceDiscount: 1` | 23 (2.8%) | 1.41pp | 14 / 9, unresolvable |
| `faceupDynastyDenialWeight: 1` | 173 (21.2%) | 10.60pp | 84 to / 89 away, p=0.75 |
| `faceupHoldingStrengthWeight: 1` | 24 (2.9%) | 1.47pp | 17 to / 7 away, p=0.064 |

The combined arm is the familiar shape: a genuinely decisive mechanism with no
direction. Reading `faceupProvinceDiscount` as ABSOLUTE (99) makes the bot
attack a revealed strength-6 province ahead of a facedown 4, which is not the
human rule — his works because the revealed province is usually one he already
softened. At 1 it is only a tie-break and its ceiling falls under the noise
floor, so no run can resolve it.

**Why target ORDER is structurally null, and strength is not.** Conquest needs
three of the four outer provinces plus the stronghold, so WHICH three is close
to irrelevant — a different order reaches the same total. What can matter is the
STRENGTH estimate, because that decides whether a declaration converts to a
break at all, and V1 already sorts on strength. Against a human the safety and
denial rules pay because of information asymmetry; in self-play both sides read
the same board.

The three arms split exactly along that line. The two knobs expressing a
PREFERENCE between provinces (face-up, denial) each flip ~20% of games and land
dead even. The one correcting a strength ESTIMATE touches 2.9% of games and
takes 17 of 24 decided — an implied +1.2pp, the same size as the shipped
opponent-aware axis. A 1.47pp ceiling cannot be resolved by a head-to-head
(~7800 games); it has to be settled by pooling DECIDED games across fresh bases
and sign-testing them, which is roughly an order of magnitude cheaper. Not yet
evidence: one seat, three bases, p=0.064.

See `bot-v2-rejected-experiments.md` for anything that measured null or negative.
