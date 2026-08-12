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

**Status: partly modelled.** The rollout bows defenders and keeps playing the
phase, so the tempo half is priced. The other half — a free body arriving from
hand at the NEXT conflict — is not; `handThreat` prices hand cards as one skill
lump added to the CURRENT conflict.

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

**Status: not modelled.** Same missing input as rule 2.

### 7. At three provinces each, the first-player token decides the race

> "If 2nd player in 3-3 always defend and try to play characters with 1 fate."

As second player the opponent attacks the stronghold first and `mustAttackStronghold`
means every attack goes there, so surviving the round IS the plan. Buying
characters with one fate on them makes them persist; next round the token has
passed (`RegroupPhase.passFirstPlayer` alternates it unconditionally), the
first conflict is yours, and that is the all-in.

**Status: not modelled.** The planner treats a stronghold break as terminal
(`strongholdBreakValue: 500`, and the rollout's tail is cut off at that node),
but the rollout is ONE phase — there is no next round in the model. The existing
reserve is gated the other way: `preStrongholdRequireFirstPlayer: true`.

### 8. Never pass a conflict opportunity voluntarily

> "Not unopposed honor. Ring effect, fate on ring. Potential break if i have
> some buffs. I always try to attack."

**Status: V1 mostly agrees.** Across the five games V1 passed voluntarily twice,
and both were `StrongholdDefenseTactics.holdAllAgainstCovert` reserving the whole
board against the human's Adept-granted Covert — i.e. V1 was applying rule 7,
not failing rule 8. Low ceiling; not pursued.

## Measurements

See `bot-v2-rejected-experiments.md` for anything that measured null or negative.
