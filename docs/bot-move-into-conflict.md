# Movement into a conflict: the alternative the bot could not see

`MoveIntoConflictPolicy` (`server/game/bots/MoveIntoConflictPolicy.ts`),
`DeckProfile.moveIntoConflict`, SHIPPED field-wide.

## The defect

From the owner's 2026-08-24 game against the Unicorn Cavalry Rush
(`game replays/dragon monk/2026-08-24_..._kingitus-Dragon_Clan_vs_Jigoku_Bot-Unicorn_Clan.json.gz`),
round 1, first conflict:

```
kingitus has initiated a [political] conflict with skill 5
Jigoku Bot does not defend the conflict
...
Jigoku Bot plays Ride On to move Border Rider into the conflict
Political Void conflict - Attacker: 5 Defender: 2
```

Border Rider was READY, at home, and legal to declare as a defender. The bot
declined to defend, then spent a card from hand to put that same body in the
same conflict. The card bought a placement that was free one prompt earlier.

Reconstructed from the replay state at the defender prompt:

| | |
|---|---|
| bot board (political) | Border Rider 2 (Utaku Battle Steed), Shinjo Gunsō 1, Moto Youth 0 |
| attacker skill | 5 (Togashi Mitsu with 3 fate) |
| province | Manicured Garden, strength 4 |

`ConflictTempoPolicy` read the board as `trade` (3 vs 5 political, ratio 0.6
against a `weakBoardRatio` of 0.8) and `tradeDefenseWinOnly` — shipped `true` on
the owner's call — sized the defence `win-only`, which concedes anything the
board cannot win outright. That is the shipped stance and it is not what this
change touches. What it does touch is the *contradiction*: having decided the
province was not worth a body, the bot then spent a CARD on the same body.

## The rule

Every value model in the bot prices the ARRIVAL — `conflictStrengthNeeded`,
`winSkillNeeded`, the participation payoffs. None of them prices the
ALTERNATIVE, because the serialized board a policy reads says where a body is
now, never where it could have been put for free a moment ago.

A movement effect exists to put a body where DECLARATION cannot:

* the body is **BOWED** — a bowed character cannot be declared, and
  `isParticipating()` is bow-agnostic, so it still pays every participation
  reaction;
* the body was **BLOCKED** from declaring — covert, Shinjo Yasamura's "cannot be
  declared as a defender", Butcher of the Fallen;
* the body **was not there yet** — it entered play, or was readied, after the
  declaration step closed.

Anything else is a body the bot could have declared and chose not to.

### Where "declarable" comes from

Not from card text. `JigokuBotPolicy.noteDeclarableBodies` records, at both
declaration prompts, the uuids the ENGINE reports as clickable and unbowed
(`legalDirectCardUuids`, which the controller derives from the prompt step's own
`canClickCard`). Covert and every "cannot be declared" effect are therefore
handled without this module knowing they exist — a blocked body is simply
absent from the set, and the gate keeps allowing a movement card to bring it in.

The set is unioned across the repeated passes one prompt makes, and scoped to
one conflict. **Scope it by the conflict SERIAL, not by the published conflict
summary.** The attacker picks the type, the ring, the province and the attackers
at the same prompt, so `playerState.conflict.type` is still empty while that
declaration is happening; keying on it wiped the set the moment the conflict
initiated, exactly between recording it and reading it. The serial
(`round | completedConflicts | opponentCompletedConflicts`) is constant across
that whole window.

## The exceptions, and why only these

| exception | why |
|---|---|
| `adorned-barcha` | its Action bows an ENEMY participant and brings the bearer along. The bow is the card; the move is a rider. |
| `twilight-rider` | its reaction fires on MOVING to a conflict, never on committing, so declaring it forfeits the ready outright. Needs a live bowed body to stand up. |
| `even-the-odds` | also HONORS the body when it is an unhonored Commander. |
| `formal-invitation`, `matsu-mitsuko` | free, repeatable board abilities. Nothing is spent, so nothing is wasted, and the move arrives after the opponent has acted. |
| `golden-plains-outpost` | its cost is bowing the STRONGHOLD, which contributes no skill and has no other ability, so the bow gives up only this same move for the rest of the round. Owner's call, 2026-08-24. |
| `diversionary-maneuver` (watchdog only) | bows and sends home EVERY participant first, so the declaration that preceded it no longer describes the board. |

Two that are deliberately **not** exceptions:

* **Spyglass** draws "after attached character commits to a conflict **or**
  moves to a conflict". Declaring the bearer collects the same card for free.
* **Outskirts Sentry** honors a participant after any move in. That pays for the
  arrival of a body which could not be declared — the bowed branch already
  allows it — and buying an honor token with a card on a body that *was*
  declarable is the same waste in a smaller wrapper.

**Moto Stables** (+2 military to anything that MOVES in, twice per round) is a
genuine move-only bonus and has its own knob, `allowMoveBonusOnDeclarableBody`,
default OFF: +2 military is not obviously worth a conflict card, and the owner's
rule is to declare whenever declaring is legal.

### The cost test, not the effect test

`freeSourceIds` is the general form of the Golden Plains Outpost decision: the
waste this gate exists to stop is the RESOURCE, so a source that costs nothing
to use cannot waste anything, however redundant the placement. The Outpost's
residual cost is that it is `oncePerRound` — an early use on a ready body
forfeits a later one on a bowed body — and that limit is enforced by
`MOVE_SOURCES`, not here. Ride On sits on the other side of the same test: it is
a card out of hand, so a redundant placement is a card gone.

## Where it is applied

Once per decision surface, never per deck picker:

1. **The play gate** — `ride-on`'s `shouldPlay` branch in `JigokuBotPolicy`
   refuses the card when no allowed target exists. Golden Plains Outpost's own
   `shouldUseMove` branch is on the same path and, being free, keeps taking a
   ready Cavalry body.
2. **The activation gate** — `conflictAbilitySources` refuses to click any
   `MOVE_SOURCES` board card when the gate allows no body. This one is load
   bearing: refusing at the TARGET prompt is one prompt too late, because a
   selector with no legal alternative and no cancel button falls back to the
   unfiltered candidate list and takes the very body declaration could have had.
   Measured live as `favorable-ground-reinforce` on a ready Kitsu Motso.
   Favorable Ground's retreat mode is the field's one non-move use of a move
   source, so a Dragon rescue still opens it.
3. **The shared move-target filter** — the block in `cardDecision` that already
   drops zero-skill arrivals, so Favorable Ground, Formal Invitation, Matsu
   Mitsuko, Even the Odds, Ride On and Golden Plains Outpost all inherit it
   before any deck picker sees the list. Same insertion pattern as
   `AttachmentTargetPolicy`.
4. **`ReadyMovePlanner`'s options** — `gatedMoveOptions` filters the engine's
   legal move pairings before the planner scores them, so the planner stays a
   pure function of its inputs. The ready-first leg is untouched: a bowed body
   is undeclarable by definition.
5. **`UnicornTactics.pickMoveTarget` / `orderDeclarationCandidates`** — the deck
   model asks the same gate, so the attack-side reservation stops holding a
   READY cavalry body out of the declaration to move it in later.

Two mover substitutions in the declaration sizing were fixed at the same time:
`defenderDecision` and the attacker branch both let a projected move swing stand
in for a declared body, without checking whether that mover was sitting in
`candidates` at that very moment. Both now require `!moverIsDirectCandidate`.

## The Unicorn card list

The rush deck's characters, and what each is worth on ARRIVAL. All of them read
`isParticipating()`, which is bow-agnostic, so all of them pay for a body that
could not have been declared — and none of them is a reason to move a body that
could.

| card | arrival payoff | rule |
|---|---|---|
| Outskirts Sentry | honors a participating character whenever anything moves in | move a BOWED body: it contributes 0 skill and still leaves with an honor token |
| Utaku Infantry | +1/+1 per participating Unicorn character, itself included | move a BOWED body for +1; declare a ready one |
| Moto Outrider | readies ITSELF once participating | **military only** (`isDuringConflict('military')`) — on a political conflict he arrives bowed and stays bowed |
| Twilight Rider | on MOVE, readies any character (its own bow does not stop it) | move only while a bowed body is there to ready; otherwise declare |
| Shinjo Shono | +1/+1 to participating Cavalry while we hold the participant majority | only worth the arrival that CREATES the majority |
| Higashi Kaze Company | after-win: a 0-fate participant does not bow | move bowed while the conflict is already won |
| Minami Kaze Regulars | after-win: gain 1 fate, draw 1, needs the majority | move bowed while already winning and outnumbering |
| Adorned Barcha | bows an enemy participant, bearer rides along | any body; the bow is the value |
| Spyglass | draws on commit **or** move | only worth moving a bowed bearer |
| Flank the Enemy | its Action needs the participant majority | move a bowed body to turn the condition on |
| Challenge on the Fields | +1 military per other participant, both duelists | move a bowed body for the extra point |

`moto-outrider`'s military-only self-ready was a live defect: `hasReadyFollowUp`
listed the card unconditionally, so a bowed Outrider was scored at full skill in
a political conflict where nothing could stand him up.

## What it measured

The whole class is CORRECTNESS, like `polarityGuards` and
`attachmentTarget` — do not re-measure it hoping for a number.

Measured twice, because Golden Plains Outpost moved from the paid side of the
cost test to `freeSourceIds` after the first pass. Both variants are
indistinguishable from zero and the sign flip between them is noise, not
evidence about the Outpost.

* **Ceiling 0.92pp, both variants.** `measureDecisiveness.js` with the arm
  inverted (`moveIntoConflict.enabled: false` on the released build), base
  91001, 272 games: the winner flips in **1.8%** of games either way, and 95.2%
  (Outpost gated) / 95.6% (Outpost free) of games are bit-identical. A flip rate
  that low caps any win-rate effect at 0.92pp, well under the +/-2.5pp noise
  floor, so no affordable head-to-head can resolve it. Freeing the Outpost moved
  the 5 flips from 1 toward / 4 away to 2 toward / 3 away — n=5, i.e. nothing.
* **Null arm validated, twice.** The knob injected at its shipped default scored
  **808-808, exactly 50.00%**, every base at exactly n/2 (1616 games, 3 bases),
  before and after the Outpost change.
* **Head-to-head: a clean null, both variants.** Gate-off arm over
  **~3228 games / 6 bases** (91001-96001):

  | variant | gate-off arm | the gate itself |
  |---|---:|---:|
  | Outpost gated | 49.81% (z=-0.21, p=0.833) | +0.19pp |
  | Outpost free (SHIPPED) | 50.14% (z=0.16, p=0.874) | -0.14pp |

  Per-base spread on the shipped variant -0.37 to +0.56pp; no base outside
  noise.

* **Card coverage unchanged.** `auditCards.js --decks Unicorn --opponents all
  --games 3` (270 games): 38/38 plays covered, 0 never seen, with and without
  the gate. Every movement card still gets played — Ride On 98 plays, Golden
  Plains Outpost 389 activations, Adorned Barcha 148, Challenge on the Fields
  77, Flank the Enemy 48. Stalls were 13/270 with the gate and 17/258 without,
  so it costs no reachability.
* **Live field census.** `test/server/integration/botreadyvalue.spec.js` counted
  9 declarable-waste moves across one full-field pass before the gate and 0
  after, without moving the `wasted` count.

## The tests

* `test/server/bots/moveintoconflictpolicy.spec.js` — the gate itself, one case
  per exception.
* `test/server/bots/unicorntactics.spec.js`, `describe('spends a movement source
  only where declaring cannot')` — one case per card in the table above,
  including the Border Rider regression and the covert/blocked case.
* `test/server/integration/botreadyvalue.spec.js` + `test/helpers/movevalue.js`
  — the live watchdog. `MoveValueMonitor` snapshots both declaration steps the
  moment they CLOSE (the defender side at `OnDefendersDeclared`, because
  `announceDefenderSkill` clears every covert flag straight after it; the
  attacker side at `OnConflictStarted`, so the "defenders chosen first" ordering
  cannot catch it mid-declaration) and uses the engine's own
  `canDeclareAsAttacker` / `canDeclareAsDefender`. The suite fails on any
  movement source spent on a body that could have been declared.

The watchdog's exception list and the policy's config must agree, or the gate
and its test are checking different rules.
