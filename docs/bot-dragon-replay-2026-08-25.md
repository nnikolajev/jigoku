# Dragon monk bot — replay 2026-08-25 (Jigoku Bot Dragon vs kingitus Phoenix)

Five defects were raised off one live game. Two are generic and shipped, one is
a Dragon ring fix and shipped, and two Dragon plans were **measured and
rejected**. This is the record of what each one measured, so none of them is
re-proposed.

Replay: `game replays/debug/2026-08-25_kingitus_s_game_Jigoku_Bot-Dragon_Clan_vs_kingitus-Phoenix_Clan.json.gz`.
The bot lost to conquest in round 4.

## Shipped

### 1. An honor token goes on a body that can still use it

Round 2 conflict 1: the fire ring honored a **0-fate** participating Togashi
Mitsu over a 2-fate participating Togashi Ichi. Mitsu bowed out of the conflict
and was discarded that fate phase. Field-wide, see
`docs/bot-honor-target-persistence.md`.

### 2. Court Games: the OPPONENT picks the dishonor target

Round 3 conflict 1: the bot chose the dishonor half of Court Games, and the
opponent handed over Shiba Yōjimbō (glory 2) while our own Togashi Mitsu (glory
3) went unhonored. The card reads

```ts
'Dishonor an opposing character': AbilityDsl.actions.selectCard(context => ({
    player: Players.Opponent,          // <- THEY choose
    controller: Players.Opponent,
    cardCondition: card => card.isParticipating(),
```

so the realised value of the dishonor half is the opponent's **lowest**-glory
eligible participant, not their highest. V1 compared our best honor target
against their best dishonor target and therefore over-priced the dishonor.
`DeckProfile.courtGamesOpponentPicksDishonor`. See
`docs/bot-court-games-target.md`.

### 3. Removing Pacifism the moment it lands

Round 4: Pacifism went onto Togashi Mitsu twice. Let Go answered the first copy
a whole conflict late; the second copy sat there through a military defence with
Miya Mystic ready on the board. Two causes, both fixed:

- `miya-mystic`'s playbook gate fired only on an ENEMY attachment, so the one
  thing the card is printed to answer never reached it;
- nothing in the conflict-phase **action window** looked for an own debuff at
  all, and that window is where the attachment lands. The remover was only ever
  considered once a conflict was already running, i.e. after the declaration it
  was supposed to enable.

`DeckProfile.debuffRemovalUrgency`, ordered by what the removal costs: Let Go (a
free hand card) before Miya Mystic (which sacrifices the body). See
`docs/bot-debuff-removal-urgency.md`.

### 4. Tranquil Philosopher aims its fate move

`DragonProfile.ringPriority.philosopherFateMove` plus
`countKeepersInProvinces`. Two halves:

- **Keeper Initiate is legal from a PROVINCE, not only the dynasty discard**
  (`KeeperInitiate.location`), and the void-ring bonus counted only the discard
  — so the copies sitting faceup where they start were worth nothing to the ring
  choice.
- The Philosopher's two ring prompts want **opposite** answers, and V1 answered
  both with its ordinary "best ring" sort. That names the ring we want as the
  fate **donor**, and the second select then either moves the fate off the ring
  we wanted or finds no legal target at all. It now takes the fattest OTHER
  unclaimed ring as the donor when the move is worth making, and the **emptiest**
  other ring when it is not — the ability resolves `then, gain 1 honor` either
  way, so it is never worth declining, only worth aiming.

  Worth making means: a fate is sitting somewhere other than the ring the plan
  wants, at most one ring is rich, and no ring holds a pile too big to break up.
  A single **2**-fate ring is a donor, not a destination — one fate on the right
  element beats two on the wrong one, and the donor keeps the other fate.

  The wanted ring is scored with **fate ignored**. The fate is the thing being
  moved, so scoring the rings as they stand would let a single 2-fate ring name
  itself as the destination and turn the whole plan into a no-op.

## Measured and rejected

### 5. "One tower, then cheap bodies" (`DragonProfile.towerFocus`)

The plan, from the owner's own pilot notes: with Togashi Mitsu already standing,
buy a cheap non-unique body — which is also what In Service to My Lord bows to
ready Mitsu again — and keep three or four fate for the conflict hand, instead
of paying four for Togashi Ichi.

It is a very decisive lever (25-42% of the Dragon seat's games flip) and it
loses in **every** scoping tried. Paired probe, `ONLY=Dragon`, both seats, 8-12
shuffle bases each:

| arm | to | away | rate |
|---|---:|---:|---:|
| default (`conflictFateReserve: 3`) | 36 | 48 | 42.9% |
| `conflictFateReserve: 2` | 35 | 48 | 42.2% |
| `conflictFateReserve: 1` | 29 | 51 | 36.3% |
| `conflictFateReserve: 0` | 31 | 49 | 38.8% |
| `holdConflictFate: false`, reserve 0 | 31 | 45 | 40.8% |
| `holdConflictFate: false`, reserve 2 | 27 | 45 | 37.5% |
| `primaryOnly` + `upgradeToPrimary` (Mitsu is THE tower) | 32 | 70 | 31.4% |
| `requireReadySourceFodder` (12 bases, the narrowest scope) | 18 | 37 | 32.7% |

Eight arms, every one negative, spanning a hold-the-fate variant, a
never-decline-a-purchase variant, a Mitsu-only variant and the narrowest scope
the replay actually describes. This is the wrong SIGN, not the wrong scope.

### It is the buy ordering, not the reserve

The obvious explanation -- "the reserve holds fate the hand cannot spend" -- is
**wrong, and the arms already rule it out**. The `conflictFateReserve: 0` +
`holdConflictFate: false` arm withholds no fate from the conflict hand and never
declines a purchase; the only thing left in it is the ordering (a cheap non-tower
body ahead of a second tower) plus `supportAdditionalFate`. It read **40.8%**.
Reserve 0 and reserve 3 land within 4pp of each other. The reserve is not the
lever.

An earlier write-up of this justified the rejection with "15 of the deck's 17
conflict cards cost 0 fate". That was wrong twice over -- it counted distinct
card ids rather than deck slots, and it collapsed the 0-and-1 buckets into 0.
The real distribution, from `dragon-decklist.json` x `dragon-cards.json`:

| conflict slots | cost 0 | cost 1 | cost 2 | paid | mean cost |
|---:|---:|---:|---:|---:|---:|
| 40 | 26 | 10 | 4 | **14 (35%)** | **0.45** |

That is joint-cheapest in the field alongside Crane (35% paid / 0.45 vs 0.40
mean), against Phoenix Shugenja at 65% / 1.38 -- so a three-to-four fate reserve
is oversized for this deck. But 14 of 40 cards do cost fate and the hand can
spend it, so "nothing to buy" was never a valid reason.

### What actually loses: the support bodies are 1-2 skill and the towers are 4

Every non-tower dynasty character in the list is Keeper Initiate 1/1, Miya Mystic
1/1, Togashi Initiate 1/1, Tranquil Philosopher 2/2, Kitsuki Investigator 1/3 or
Teacher of Empty Thought 3/2. The towers are Togashi Ichi 4/2, Togashi Tadakatsu
4/3 and Togashi Mitsu 4/5. Declining a second tower for a cheap body gives up
roughly three skill a round, and the card-count payoffs still have to WIN the
conflict they fire in -- a five-card push on a board that loses the conflict
cashes nothing. That is consistent with the whole arm table: the deeper the
substitution (Mitsu-only, which refuses to count Ichi or Tadakatsu as a tower at
all), the worse it gets -- 31.4%, the single worst arm.

The code was **removed** rather than kept at `enabled: false`: the seed-coverage
guard (`test/server/bots/specializedpolicycoverage.spec.js`) exists to catch
exactly this shape of dead code, and a plan this thoroughly measured belongs in
a doc rather than in a branch nothing reaches. To rebuild an arm, add a
`towerFocus` block to `DragonProfile` with `enabled`, `primaryOnly`,
`upgradeToPrimary`, `conflictFateReserve`, `maxSupportCost`, `holdConflictFate`,
`requireReadySourceFodder` and `supportAdditionalFate`, call it from
`JigokuBotPolicy.fateAwareDeckDynastyPreference` (which needs
`fateAwareEconomy.preferDeckCharacters: true` on the monk profile -- verified
bit-clean on its own) and from the `dragonFate` branch of
`fateAwareAdditionalFateOverride`. Do not do this without a new mechanism; the
sign is settled.

### 6. Raising the ring fate bar, and a fire bonus for an unhonored tower

`ringPriority.fateDominanceThreshold` (make a ring's fate pile outrank the
element plan only from 2 up, instead of from 1) and
`ringPriority.unhonoredTowerFireBonus` (want the fire ring while the tower is
unhonored). Both ship at their inert values.

Component ablation, paired probe, `ONLY=Dragon`, both seats, 24 bases / 768
games per arm:

| component | to | away | rate |
|---|---:|---:|---:|
| fate bar at 2 | 66 | 55 | 54.5% |
| Keeper Initiates in provinces (alone) | 3 | 1 | inert — 4 flips in 768 games |
| unhonored-tower fire bonus | 57 | 65 | 46.7% |
| Philosopher fate move | 16 | 16 | **50.0% exactly** |
| all four together (24 bases) | 93 | 89 | 51.1% |

The fate bar looked like the winner at 54.5%. Re-run on **24 fresh bases** it
measured **45.0%** (63 to / 77 away), pooling to 49.4% over 48 bases — the
textbook false positive the `/roundrobin` skill warns about, found by slicing
and killed by fresh shuffles. The fire bonus is negative and was dropping the
combined arm; with both removed the remaining two halves are the ones above.

Keeper-in-provinces is inert **on its own** because a ring holding a single fate
already outranks every element bonus at the shipped threshold. It ships anyway:
it removes a blind spot rather than expressing a preference, and it cannot make
the ring choice worse.

## The whole batch, measured together

Every fix above is a correctness class with a ceiling under the noise floor, so
the only honest headline is the one taken with all of them on at once, inverted:
an arm that turns the whole batch OFF plays the shipped build.

| rig | games / bases | result |
|---|---:|---|
| null arm, shipped build (every knob injected at its shipped value) | 1622 / 3 | **811-811, exactly 50.00%**, every base at n/2 |
| **head-to-head, whole batch inverted** | **3232 / 6 fresh bases** | OFF arm **49.85%**, z=-0.18, **p=0.860**, 5 of 6 bases negative for OFF |
| Dragon ring bundle inverted, paired probe both seats | 768 / 24 fresh bases | **14 to / 14 away — exactly 50.0%** |

The shipped build therefore reads **+0.15pp** field-wide, which is
indistinguishable from zero and exactly what a batch of four correctness fixes
with a combined ~1.5pp ceiling should read. The value is in the decisions, not
in the number: an honor token that survives the fate phase, a Court Games menu
priced at what the opponent will actually give up, a Pacifism answered in the
window it lands in, and a Philosopher that carries fate toward the ring the deck
wants instead of away from it.

`npm test` passes: 11583 specs, 0 failures, including every live self-play guard
(`botpolarity*`, `botreadyvalue`, `botattachmentvalue`, the move-value
counterfactual monitor).
