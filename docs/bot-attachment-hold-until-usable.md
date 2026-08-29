# An attachment is only worth its fate while some bearer can USE it

`DeckProfile.attachmentTarget.holdUntilBearerCanUseIt`.

## The live defect

`test/server/integration/botattachmentvalue.spec.js` at base 99987, LionDuelist
vs ScorpionBidWar, round 2 — an **unopposed 2-0 attack that was not breaking**:

```
Blade of 10,000 Battles -> Akodo Toturi (bowed, at home)   AVOIDABLE
Fan of Command          -> Akodo Toturi (bowed, at home)   AVOIDABLE
Formal Invitation       -> Akodo Toturi (bowed, at home)   AVOIDABLE
   participating alternatives: Matsu Tsuko
```

Three cards and **3 fate** (Blade 2, Fan 1, Invitation 0) spent on a body that
readies in the FATE phase, so all three bonuses were dead for the rest of the
round. Matsu Tsuko was standing in the conflict the whole time.

Owner's question, 2026-08-28:

> why did it attach all these cards to bowed body? it can keep them and attach
> when character is readied ... it's better to keep fate and cards until a ready
> character is available, even for next turn

## Why it happened

Nothing was broken. `attachmentTargetDecision` has a **tower branch** whose
comment says exactly what it did:

> Not fighting for a conflict we could lose right now: an attachment is (almost
> always) permanent, so invest it in a multi-fate "tower" character that will
> keep fighting for several rounds. **Bowed towers still qualify.**

That branch is reached when `preferParticipantBearer` is false — i.e. when
`conflictStrengthNeeded` is 0. An unopposed attack that is not breaking needs
nothing, so the participant narrowing above it is skipped and the tower branch
takes the 2-fate Akodo Toturi. The pre-existing `requireUsableBearer` gate is
itself gated on `currentPreferParticipantBearer === true`, so it is switched off
on precisely the board where nothing can use the card.

## The rule

A bearer is worth the fate only if it can still get value out of the attachment
before the round ends. `AttachmentTargetPolicy.bearerCanUseAttachment` answers
that from a board reading plus one declared fact about the card, and the same
call is used at all three decision points.

| bearer | verdict |
|---|---|
| PARTICIPATING, card pays on participation | **usable** — see below |
| PARTICIPATING, skill payoff, unbowed | usable while the conflict still needs skill, or the body has `DoesNotBow` and comes home standing |
| PARTICIPATING, skill payoff, bowed | usable only if a ready source can stand it up |
| BOWED at home | usable only if a ready source can stand it up |
| UNBOWED at home | usable while a conflict opportunity remains — this is what keeps the ordinary tower investment |

### Participation is bow-agnostic, and a whole class of card is written for it

`isParticipating()` does not care about the bow, and neither do these abilities.
Owner, 2026-08-28: *"both are okay if toturi is participating in conflict while
he is bowed"*. `CardPlaybook.bowedParticipantPays` marks them — 15 in the field,
in two families:

* **"Reaction: After attached character WINS a conflict…"** — Blade of 10,000
  Battles, Honored Blade, Setting the Standard, Scarlet Sabre, Self-Understanding,
  Utaku Battle Steed, and Magnificent Kimono's granted pride.
* **"Action: …while attached character IS PARTICIPATING…"** — Fan of Command,
  Jade Tetsubo, Duelist Training, Watch Commander, Iaijutsu Master, True Strike
  Kenjutsu, and the Champion Actions granted by Ofushikai and Shukujo.

It is a fact about the printed text, not about the board, so it is declared per
card and pinned against that text by a spec in both directions.

### Three cards pay in their own way, and each is already named by an existing list

None of them needed a new flag — reusing the lists the codebase already
maintains is what stops the classification drifting from the gates that share
them.

| card | classified by | rule |
|---|---|---|
| **Adorned Barcha** | `MoveIntoConflictPolicy.riderSourceIds` | always usable. Owner: *"Adorned Barcha can be triggered to bow the chosen participating character, even if the attached character cannot move to the conflict (eg. Pacifism, or the attached character has a dash Mil skill). The bowing is not dependent on the movement."* |
| **Spyglass** | `HOME_BEARER_ATTACHMENT_IDS`, minus the other two | draws on "commits **or moves**", so an unbowed bearer can commit and a BOWED one still pays whenever a move source can reach it |
| **Formal Invitation** | `HOME_BEARER_NEEDS_READY_IDS` | moves its own bearer, which must arrive with skill — so a bowed bearer works if it can be readied before the move (`ready`) or after it (`readyAfterMove`), which is the move -> ready sequence `ReadyMovePlanner` already plans |

Every "can this body be readied / moved right now" answer comes from the
ENGINE, through `JigokuBotController.sequenceSourceTargets`.

## Three tiers, one predicate

The defect needed all three, and each was found by fixing the one before it.

1. **The PLAY gate** (`conflictCardHasPlayIntent`) holds the card when NO legal
   bearer can use it. This caught Formal Invitation. It did not catch Blade or
   Fan, because Matsu Tsuko could use them — the play was right.
2. **The TARGET narrowing** (`polarityTargetDecision`) drops spent bearers from
   the list every deck picker chooses from. *"Some bearer can use this card"* is
   not *"the bearer the deck picker chose can use it"*.
3. **The pays-NOW preference**, among the survivors. Tier 2 alone still left one
   placement: a bowed Akodo Toturi survived it only because In Service to My
   Lord *could* have readied him, while Tsuko was standing in the conflict whose
   result triggers Blade's Reaction. "Could be made usable" is not "pays now".

Tier 3 is the same `bearerCanUseAttachment` call with the two answers that mean
LATER denied — `conflictOpportunityRemains` and `readySourceAvailable` — so the
tiers cannot disagree with each other.

Tiers 2 and 3 are deliberately **soft**: with nothing left they hand the list
back unchanged, because a selector with no legal alternative and no cancel
button falls back to the unfiltered list anyway (measured previously as
`favorable-ground-reinforce` landing on a ready Kitsu Motso). The hard refusal
lives at the play gate, where holding costs nothing.

### Scope, and the three bugs that defined it

Both halves run **only while a conflict is actually running**. Turning the rule
on field-wide is what found this, and it is the most important line in the
change: outside a conflict `conflictsRemaining` reads 0, so "no opportunity
remains" was true at every prompt in the dynasty phase, and the rule refused
every unbowed body at home — i.e. the ordinary tower investment, which is
correct play and is what the tower branch is FOR. The defect this rule exists
for only ever happens during a conflict, so that is where it applies.

Two more, found the same way:

* **It ignored the V1 revert switch.** `attachmentTarget.enabled: false` is
  documented as "V1 exactly", but the two new gates hung off their own flags
  alone. Both now `&& this.config.enabled`, like `gatesPlayOnBearer` always did.
* **Waterfall Tattoo.** Its Reaction READIES its bearer after a province we
  control is revealed, so a BOWED bearer is the body the card exists for, and
  `DragonAttachmentTactics` picks exactly that one on purpose. Marked
  `payoffReadiesBearer`, and the Dragon attachment deck is now exempt from the
  target narrowing as well as from the play gate.

Also exempt from the play gate: enemy-aimed debuffs — they land on THEIR board,
so our bow state says nothing about them.

## What it changed

Census on the reproducing base, LionDuelist against all 16 opponents, both
seats:

| | OFF | ON |
|---|---:|---:|
| avoidable placements | **3** | **0** |
| counted in the conflict they were played into | 118 | **123** |
| placed OUTSIDE a conflict | 69 | 69 |
| spec result | 2 failures | **0 failures** |

The out-of-conflict row being identical is the check on the scoping above: the
rule provably does not touch a placement made outside a conflict.

## Measurement

SHIPPED field-wide. With the rule ON by default, the measurable arm is the one
that turns it OFF:
`{"deckProfile":{"attachmentTarget":{"holdUntilBearerCanUseIt":false}}}`.

| arm | games / bases | result |
|---|---|---|
| null (arm matching the shipped default) | 3230 / 6 | **exactly 50.00%**, every base at `n/2` |
| rule OFF | 3229 / 6 | **49.98%, -0.02pp, z=-0.02, p=0.986** |

Per base for the OFF arm: -0.37, +0.37, 0.00, +0.19, -0.46, +0.19pp. So the
shipped rule reads **+0.02pp** — indistinguishable from zero, three bases each
way.

It is a **null with a correctness payoff**, the same standing as
`attachmentTarget` (-0.03pp) and `moveIntoConflict` (-0.14pp). It does change
games — no base sits at `n/2` in the OFF arm — it just does not change who wins
them.

**Do not re-measure it hoping for a number.** The value is the census
(avoidable 3 -> 0) and the watchdog, not a win rate.

### A measurement that had to be thrown away

An earlier version of this rule, before it was scoped to a running conflict,
measured **-0.31pp, p=0.723 over 3176 games / 6 bases**. That number describes a
rule that also refused every dynasty-phase tower investment, and it must not be
quoted for the shipped one. Turning a knob on field-wide and running the suite
is what exposed the difference; the win rate alone never would have.

## Known open, NOT this defect

A separate pre-existing defect lives at the same base: attachments going onto a
bowed Akodo Toturi are fixed by this rule, but the LionDuelist pickers
(`lion-duelist-*-carrier`) still choose from the deck ranking rather than from
what pays. This rule narrows the list they see; it does not reorder inside them.
