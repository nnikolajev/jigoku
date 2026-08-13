# The free-conflict window

`DeckProfile.unopposedWindow` (`server/game/bots/UnopposedWindowPolicy.ts`).
Built 2026-08-12 from the project owner's own rule, given as a deliberate
simplification of replay rules 2 and 6:

> If conflict still available, all enemy characters are bowed and there is a
> character in hand the bot can play, then play it and declare a new conflict.
> Be aware the character needs to be played in the action window BEFORE that
> conflict, not during it. I don't expect this to occur very often but some
> decks will trigger it.

## What V1 was missing

Two of the eleven replay rules were blocked on one absent input: the value of a
body that is **not on the board yet** at the moment the conflict is declared.

- Rule 2 (Unicorn R2c1): declare weak into a facedown province; if they defend,
  two Feral Ningyo arrive from hand and take the break.
- Rule 6 (Crane R4): attack the stronghold with everything, lose 17-18, then
  play a fresh Feral Ningyo at home and break the province with 4, unopposed.

`estimateHandThreat` prices a hand as one skill lump added to the conflict
already running. A body that only matters at the NEXT declaration is worth zero
to it, so a phase with no ready attacker simply passes.

This policy takes only the cheap, unambiguous half of that: not "what might my
hand be worth later", but "there is a conflict I am about to throw away, nothing
of theirs is standing, and I am holding a body".

## The window is BEFORE the conflict

`ConflictPhase.queueSteps` runs `ActionWindow(..., 'preConflict')` and only then
`startConflictChoice()`, looping back to a fresh action window after every
conflict (`ConflictPhase.ts:43,67`). A character played inside a running conflict
joins THAT conflict. The play has to happen in the preConflict window so the body
is standing at home, ready, when the declaration prompt arrives.

That window is the bot's `actionWindowDecision` (`Initiate an action`), and the
policy is consulted as the **first** thing in it — ahead of every deck's own
setup play, including the Dragon plan of spending these same cards as
attachments. An attachment cannot be declared as an attacker, so inside this
window the attachment plan is the wrong plan. The follow-up
"as a character / as an attachment" menu is answered `as a character` through a
pending id/uuid pair, in front of the Dragon preference
(`JigokuBotPolicy.ts`, `unopposed-window-play-as-character`).

Tadaka is the one exception, and it is deliberate: his Disguised play is also a
character and it is the CHEAPER one, so the existing `tadaka-play-disguised`
branch keeps it. `ShugenjaTactics.disguisedCost` (new) prices him from the base
he replaces — 5 minus the base's printed cost, so 1 on a Prodigy of the Waves,
not his printed 5 — because the window's affordability test would otherwise
refuse him at 3 fate. He enters READY either way, which is what makes him a
legal attacker in the conflict about to be declared.

## Every knob

All default to V1. `enabled: false` returns `play: null` unconditionally, so the
field's presence is bit-identical (verified: `refactorIdentity.js` held at
`513e4428d96131fc` across the whole build-out).

| knob | default | what it does |
|---|---|---|
| `enabled` | false | master switch |
| `maxOpponentReady` | 0 | enemy READY bodies tolerated. 0 is the owner's rule; an empty enemy board satisfies it too. Above 0 this stops being a free conflict and becomes an ordinary attack the declaration logic already sizes |
| `maxOwnReadyAttackers` | 0 | our ready bodies at which the window still opens. 0 = "only when we would otherwise pass for lack of an attacker", and it is self-limiting: after the play we have one. Raising it buys extra skill for the BREAK — an unopposed conflict is won by any skill at all, but the province strength still has to be covered |
| `minBodySkill` | 1 | the body must carry this much skill on an axis we can still declare on. A 0-skill attacker does not win an unopposed conflict: the attacker needs MORE skill than the defender and both sit at 0 |
| `maxBodyCost` | 99 | ignore bodies dearer than this |
| `fateReserve` | 0 | fate to keep after paying |
| `maxPlaysPerRound` | 1 | plays this rule may make per round; only binds once `maxOwnReadyAttackers` is raised |
| `overrideAttachmentPlans` | true | play the card as a CHARACTER even for a deck whose profile prefers the attachment mode |

An arm is a JSON string, never an edit:

```sh
CHANGE='{"deckProfile":{"unopposedWindow":{"enabled":true}}}' \
  KINDS=unopposed-window BASES=... SEAT=0 WORKERS=14 OUT=probe_seat0.json \
  node tools/selfplay/probePaired.js
node tools/selfplay/analyzeUnopposed.js probe_seat0.json 0   # population
node tools/selfplay/perDeckFlips.js probe_seat0.json probe_seat1.json
```

`unopposedWindow` is in `JigokuBotController.decisionProfile`'s merge-key list,
so an arm naming one knob keeps the rest.

## Population: the owner was right about the frequency

Seat 0, 816 games, bases 600001-602001. Every conflict-phase window is counted,
which is why the denominator is large — the bot looks at this question
constantly and the answer is almost always no.

| why the window closed | windows | share |
|---|---:|---:|
| `defenders-ready` | 13201 | 58.9% |
| `no-conflict-opportunity` | 5023 | 22.4% |
| `no-candidate` (no body in hand) | 2029 | 9.1% |
| `attacker-available` | 1885 | 8.4% |
| `play-cap-reached` | 174 | 0.8% |
| **`unopposed-play`** | **96** | **0.4%** |
| `no-affordable-body` | 1 | 0.0% |

**It fires in 0.4% of windows but 11.4% of GAMES** (93 of 816 on seat 0, 80 of
816 on seat 1) — roughly one free conflict every nine games. That is the number
that matters: a lever is measured in games, not in windows.

Board when it fired: 2.33 enemy bodies in play and all of them bowed, 0 of our
own ready, 3.42 fate in hand, 1.19 playable bodies to choose from. Concentrated
early — 33% round 1, 27% round 2, 18% round 3 — because that is when a board is
small enough to be entirely bowed by one exchange.

19 different cards were played this way. The three most common after Feral
Ningyo are Dragon's dual-mode monks (Ancient Master, Tattooed Wanderer, Togashi
Acolyte: 29 of 96 plays), i.e. the attachment override is doing real work rather
than being a theoretical concern. Tadaka came in Disguised twice at a cost of 1.

## Measured

Ceiling 2.27pp on seat 0 (4.5% of games flip), 1.65pp on seat 1 (3.3%). Small
enough that a head-to-head could never resolve it — this was settled by pooling
DECIDED games and sign-testing them, the same way the water ready loop was.

| cell | bases | to | away | effect |
|---|---|---|---|---|
| search seat 0 | 600001-602001 | 26 | 11 | +0.92pp |
| search seat 1 | 600001-602001 | 16 | 11 | +0.31pp |
| **search pooled** | **3 bases, 1632 games** | **42** | **22** | **+0.61pp, p=0.017** |

Both seats positive, and the seat-0 over-read is the usual size (the paired rig
reads one seat about 2.7x bigger than the other; see
`jigoku-paired-rig-seat-bias`).

Confirmed on six FRESH bases, both seats:

| cell | bases | to | away | effect |
|---|---|---|---|---|
| search seat 0 | 600001-602001 | 26 | 11 | +0.92pp |
| search seat 1 | 600001-602001 | 16 | 11 | +0.31pp |
| confirm seat 0 | 610001-615001 | 33 | 15 | +0.55pp |
| confirm seat 1 | 610001-615001 | 31 | 17 | +0.43pp |
| **pooled** | **9 bases, 4896 games** | **106** | **54** | **+0.53pp, p<0.0001** |

Confirmation alone is +0.49pp (p=0.0014), so it held its size on bases it was
never searched on — the shape a real lever has here, and the opposite of the
dynasty price list that went to exactly 0.00pp on fresh bases.

**SHIPPED field-wide on 2026-08-12** (`DEFAULT_PROFILE.unopposedWindow.enabled`).
This is the largest single V1 win measured since the Assassination cost fix
(+1.49pp) and larger than the water ready loop (+0.32pp) from the same replay
set.

Causally per deck, over all 4896 games and both seats:

| deck | decided | to | away | effect | p |
|---|---|---|---|---|---|
| LionDuelist | 16 | 14 | 2 | **+2.08pp** | 0.004 |
| Unicorn | 14 | 11 | 3 | +1.39pp | 0.057 |
| CrabSacrifice | 9 | 8 | 1 | +1.22pp | 0.039 |
| Dragon | 35 | 21 | 14 | +1.22pp | 0.311 |
| Lion / Phoenix | 11 each | 8 | 3 | +0.87pp | 0.227 |
| CraneDuels / Crab | 11 / 17 | 5 / 8 | 6 / 9 | −0.17pp | 1.000 |
| LionHonor | 4 | 1 | 3 | −0.35pp | 0.625 |

No deck is negative beyond noise, so nothing was scoped out. Dragon has by far
the widest population (35 decided games) because its dual-mode monks are exactly
the cards this window plays, and it is positive.

Three decks record **zero** decided games — CraneHonor, Scorpion, UnicornReveal.
Their economies do not leave a spare body in hand at a moment when the board is
bare, so the rule simply never reaches them. That is a population fact, not a
verdict.

## One seat this does NOT change: the board-aware seed

Seed 3 (`BoardAwareJigokuBotPolicy`) already owns this decision through
`boardAwareDynasty.playConflictCharactersAtHome`, with a stricter test: the new
body must beat every visible ready defender by itself, and optionally break. The
window **defers** to it rather than shadowing it, because that mechanism is a
superset in this situation and the measurement above was taken on V1, which does
not have it. Seed 3 is therefore bit-identical to before this change.

The consequence shows up in `specializedpolicycoverage.spec.js`:
`ShugenjaTactics.disguisedCost` is unreachable from seed 3 by design, so it
carries an explicit `delegated` entry there. That guard exists to catch dead
code, and a method two of three policies reach is not dead — but the opt-out is
written down rather than assumed.


## A tooling defect this run found

`perDeckFlips.js` derived the treated seat from the **filename** (`/seat1/`).
Dumps named `unop_s0.json` / `unop_s1.json` therefore both scored as seat 0,
which does not fail — it silently swaps `to` and `away` on every game of the
mislabelled dump. It read 37/27 (+0.31pp, p=0.26) instead of 42/22 (+0.61pp,
p=0.017): the same lever, one naming convention away from a different verdict.

The tell was in the header the whole time: `seats=0` for two files that were
supposed to be seat 0 and seat 1.

Fixed at the source. `probePaired.js` now writes `seat` (and `bases`) into the
dump, because the seat **cannot** be recovered from the contents — telemetry
records both players, so every dump contains Seat0 and Seat1 events either way.
`perDeckFlips.js` prefers that field, still accepts the filename for older
dumps, and now **refuses to run** rather than guess when neither says.

## Related

- `bot-conflict-rules-from-replays.md` — rules 2 and 6, and the nine others from
  the same replay set.
- `bot-conflict-tempo.md` — the other six levers built from the same replays.
- `.claude/skills/roundrobin/SKILL.md` — the measurement method this follows.
