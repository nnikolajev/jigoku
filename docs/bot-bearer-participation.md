# A card whose payoff is a body joining the conflict needs a body the rules let join

`DeckProfile.attachmentTarget.requireParticipableBearer`, SHIPPED field-wide.

## The live defect

Owner's report, from the Formal Invitation placement flagged by
`test/server/integration/botattachmentvalue.spec.js`:

> the bot attached Formal Invitation and then passed instead of using the move
> Action — the two-step breaking in half.

Reproduced at `SHUFFLE=99987 LionDuelist vs PhoenixShugenja`, seat 1, round 3.
The bot was defending a political conflict at 4-0 down. It:

1. declined to defend (`aggressive-concede-defense`),
2. played a **second** Formal Invitation from hand onto **Matsu Tsuko**, and
3. passed the window.

Matsu Tsuko was at home, unbowed, and wearing the opponent's **Stolen Breath**.

## Why the bot could not see it

Formal Invitation's only ability is

> **Action:** During a political conflict – move attached character to the
> conflict.

so the whole card is the move. `AttachmentTargetPolicy` already knows that and
puts it on a body at HOME (`HOME_BEARER_ATTACHMENT_IDS`) rather than on a
participant, because a bearer already in the conflict cannot be moved into it.

Stolen Breath attaches `cannotParticipateAsAttacker('political')` and
`cannotParticipateAsDefender('political')`. That makes the bearer permanently
unable to enter a political conflict — and **nothing in the serialized board a
policy reads says so**. The board publishes `bowed`, `inConflict`, the skills
and the attachment ids; it does not publish the rules those attachments switch
off. Every bearer test the bot had — at home, unbowed, has skill — passed.

The ENGINE, meanwhile, refuses the Action, and refuses it for exactly the right
reason. Traced at the prompt:

```
ENGINE FI@Matsu Tsuko: defOK=false atkOK=false
  Move attached character into the conflict: meetsRequirements="condition"
  cannotDef=["political"] atts=formal-invitation,fan-of-command,stolen-breath
```

`baseability.meetsRequirements` returns `'condition'` because the ability has no
targets and `checkGameActionsForPotential` finds none: `MoveToConflictAction.
canAffect` calls `canParticipateAsDefender()`, which is false. The card is then
not in `legalDirectCardUuids`, so `conflictAbilitySources` lists it, the
selectable filter drops it, and the window closes on `no-card-passed-intent-
filter`. **Gate open, card unreachable** — the same shape as the Agasha Shunsen
reachability layers.

## The rule

A card is only worth putting on a bearer that can still JOIN a conflict of the
type that card works in.

Three things make it generic:

1. **The ban is read from the ENGINE.** `JigokuBotController.
   participationBlockedUuids` asks `canParticipateAsAttacker(axis)` and
   `canParticipateAsDefender(axis)` for both axes and publishes the uuids that
   answer `false`, by axis and by side. A printed dash, Stolen Breath, Pacifism
   and any future effect are all folded in, and **no card-id list can go
   stale**. There are ten cards in the pool that apply one of these bans and
   they do not agree on shape: Stolen Breath and Pacifism take a whole conflict
   TYPE on both sides, while Shiba Peacemaker, Otomo Courtier, Seppun Guardsman,
   Ofushikai and Diligent Chaperone take only the ATTACKING side.
2. **The axis comes from the SOURCE, never from the conflict on the table.**
   `MOVE_SOURCES` says Formal Invitation is political and Adorned Barcha is
   military. A bearer permanently barred from political conflicts can never use
   Formal Invitation — a statement about the card's whole life, which is what
   justifies refusing a *permanent* attachment. An axis-agnostic card says
   nothing of the kind: Spyglass pays on "commits **or** moves", either type, so
   its bearer being barred from THIS conflict leaves every later one open. Those
   sources are left alone.
3. **Riders are exempt.** Adorned Barcha's Action bows an ENEMY participant and
   brings its bearer along. The engine agrees that this still works: an ability
   stays legal while ANY of its game actions has a target, so the bow alone
   keeps Barcha usable on a bearer that can never arrive. The exemption list is
   `MoveIntoConflictPolicy.riderSourceIds` — the same list that already means
   "the Action's own effect pays, whoever is carried along" — so the two rules
   cannot drift apart.

With the side UNKNOWN — a pre-conflict placement — a one-sided ban does not
refuse, because the placement could still have been legal on the other side.

## Where it is applied

Four sites, all reading the one predicate:

| site | what it does |
|---|---|
| `conflictCardHasPlayIntent` | HOLDS the card when no home bearer can reach the conflict, so the bot reaches for another card instead |
| `polarityTargetDecision` narrowing | drops blocked bodies from the shared bearer list every deck picker chooses from |
| `attachmentTargetDecision` pool | prefers a reachable home body; falls back to the unfiltered home list rather than emptying the selector |
| `conflictAbilitySources` | does not open the ACTIVATION window on a source whose own bearer cannot arrive |

The fourth also fixes a second, separate defect found on the way: the
`canMoveSomebody` scan asked whether **any** of our characters could be moved,
including for `selfOrBearerOnly` sources that can only ever move one specific
body. It answered about a character the card cannot touch.

The narrowing and pool sites are deliberately SOFT — they leave the list alone
when nothing survives — because a selector with no legal alternative and no
cancel button falls back to the unfiltered list, which is how
`favorable-ground-reinforce` once landed on a ready Kitsu Motso. The hard refusal
lives at the PLAY gate, where holding the card costs nothing.

## What it changed

Census, `tools/selfplay/analyzeFormalInvitation.js`, LionDuelist against the
whole field, 64 games, base 91001:

| | before | after |
|---|---:|---:|
| Formal Invitation attached | 57 | 54 |
| ...to a bearer the rules bar from a political conflict | **4** | **0** |
| political window with an idle bearer at home | 46 | 43 |
| Action RESOLVED | 34 | 35 |
| window closed with the Action unused | 12 (26.1%) | 9 (20.9%) |
| attached during a political conflict, Action never fired in it | 11 | 8 |

The reproduced game is the clearest picture of it. Before, the second Formal
Invitation went onto the Stolen-Breath'd Matsu Tsuko and the bot passed a
conflict it was losing 4-0. After, the same card goes onto **Matsu Agetoki**,
the Action fires, and the conflict closes **4-5 in our favour** — a conceded
conflict turned into a won one, out of the same hand.

The remaining nine stranded windows are not this defect. Spot-checked, they are
conflicts the bot is already breaking, where moving a ready body in buys nothing
and costs the bow every participant takes on the way home.

## Tests

- `test/server/bots/participationlegality.spec.js` — the predicate's semantics
  (no map / no axis / both-sided ban / one-sided ban with the side known and
  unknown), plus an engine-exact read in a real game: Stolen Breath on one body,
  Pacifism on another, Shiba Peacemaker's attacker-only ban, and an
  unrestricted body in none of the lists.
- `test/helpers/attachmentvalue.js` gains a **failing** outcome,
  `blocked-bearer`, and `test/server/integration/botattachmentvalue.spec.js`
  asserts it is zero. Verified non-vacuous: on `ATTACH_DECKS=LionDuelist
  ATTACH_FULL=1 ATTACH_BASES=99987,91001` it reports **2** before the fix and
  **0** after.

## Measurement

Correctness class, like `polarityGuards`, `attachmentTarget` and
`moveIntoConflict`. The arm is
`{"deckProfile":{"attachmentTarget":{"requireParticipableBearer":false}}}` —
the gate turned OFF — so a positive number would be a number for the shipped
rule.

| arm | games | result |
|---|---:|---|
| null (`requireParticipableBearer: true`, the shipped default) | 1614-1614 / 3 bases | **exactly 50.00%**, every base at `n/2` (270-270, 268-268, 269-269) |
| gate OFF | 1614-1614 / 3228 / 6 bases | **exactly 50.00%**, every base at `n/2`, z=0.00, p=1.000 |

The OFF arm scoring exactly `n/2` on all six bases means **zero of 3228 games
flipped**. That is the signature CLAUDE.md warns about — an arm that is
DEGENERATE with its control looks identical to a clean null — so it was checked
directly before being believed. Replaying the reproduced game through the same
injection path:

| run | Formal Invitations attached | on a blocked bearer | Action fired | outcome |
|---|---:|---:|---:|---|
| v1, shipped build | 2 | 0 | 2 | Seat1 wins, 8 rounds |
| v2 pass-through, knob **ON** | 2 | 0 | 2 | Seat1 wins, 8 rounds |
| v2 pass-through, knob **OFF** | 2 | **1** | 1 | Seat0 wins, 6 rounds |

The arm reaches the policy, reproduces the defect, and flips that game. The
knob at its default is bit-identical to the shipped v1 build. So the 50.00% is
a real reading of a very narrow trigger, not a broken wire: the defect needs an
opponent to land a conflict-TYPE ban on the exact body a move-in card would
otherwise be hung on, and the head-to-head shuffle space simply does not
produce one often enough to resolve. Only LionDuelist runs an axis-restricted
move-in attachment, and only Stolen Breath (political) matches its axis —
Pacifism is military and Formal Invitation is not.

**Do not re-measure this hoping for a number.** Owner's call, 2026-08-28:

> trigger is very rare. it won't affect winrate in measurable way. just make
> sure it works as intended and doesn't use attachment on character that is
> unable to participate in conflict

The reach is the census (4 blocked placements per 64 LionDuelist games) and the
watchdog (2 -> 0), not a win rate. The invariant is what is maintained, and
`test/server/integration/botattachmentvalue.spec.js` is what maintains it.

## Known open, NOT this defect

The same watchdog reports three avoidable placements at base 99987 that predate
this change and are unaffected by it — Blade of 10,000 Battles, Fan of Command
and Formal Invitation all going onto a **bowed** Akodo Toturi at home while
Matsu Tsuko was participating and the conflict was 1 skill short. The default
suite (base 91001) does not play that pairing, so `npm test` is green. Repro:

```
ATTACH_DECKS=LionDuelist ATTACH_FULL=1 ATTACH_BASES=99987 npm run jasmine -- --filter="bot attachment value"
```

The reasons are `lion-duelist-*-carrier`, so the LionDuelist bearer picker is
the place to look: the shared narrowing in `polarityTargetDecision` should have
removed a bowed home body from the list it chooses from.
