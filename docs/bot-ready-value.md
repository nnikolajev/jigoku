# Is readying this body worth the card? — `ReadyValuePolicy`

Source: `game replays/dragon monk/2026-08-23_kingitus_s_game_Jigoku_Bot-Phoenix_Clan_vs_kingitus-Dragon_Clan.json.gz`
— Bot V1 on Phoenix against the project owner on a Dragon monk list.

Round 2, the LAST conflict of the phase, both players out of conflict
opportunities once it resolved:

```
Jigoku Bot is initiating a [military] conflict at province 1, contesting the fire ring
Jigoku Bot has initiated a [military] conflict with skill 1
kingitus does not defend the conflict
...
Jigoku Bot plays Against the Waves to ready Kudaka
...
Jigoku Bot won a [military] conflict 1 vs 0
kingitus passes
Jigoku Bot passes
Jigoku Bot wins the glory count 6 vs 1
```

Kudaka was **at home**, not in the conflict. Nothing followed. The card bought
nothing at all.

## The rule

A ready is only worth its cost when something can still USE the body:

1. the character is a bowed **PARTICIPANT** of the conflict running right now —
   a bowed body contributes 0 skill (`conflict.ts`), so readying it hands its
   whole skill straight back to the total being compared;
2. the character is at **home** and a conflict opportunity remains for either
   player — ours to attack with it, theirs for it to defend against;
3. the character is at home, a conflict is running, and we hold a way to
   **MOVE** it in (ready → move). Off by default; see below.

With none of the three the ready is cosmetic.

### The one exception: the Imperial Favor

`DrawCard.getContributionToImperialFavor` counts a character's glory **only
while it is not bowed**. The glory count that awards the favor runs at the end
of every conflict phase, so for a deck that races the favor, readying a glory
body with no conflicts left is real value — it is points in that count.

`readyValue.countFavorGlory` turns that on. It is keyed on the **card, not the
archetype**: the generic `favor-payoff-censure` override sets it for any deck
holding **Censure**, which is what turns the favor into board impact worth
paying a card for. Two field decks qualify:

| deck | archetype | note |
|---|---|---|
| `scorpion-bid-war` | bid-war | restates the knob in its own override; Kyuden Bayushi's ready is what it unblocks |
| `phoenix-rally-stronghold` | glory | 3x Censure, 3x Against the Waves, and a board full of glory bodies |

Every other deck stops paying. The generic entry is **first** in `OVERRIDES` so
a deck-specific override can still restate `readyValue` and win —
`resolveDeckProfile` replaces that field wholesale rather than merging it, and
`ReadyValuePolicy`'s constructor restores the rest of the defaults.

**Measured on Phoenix** (`probePaired ONLY=Phoenix`, `SEAT=0` + `SEAT=1` pooled
through `perDeckFlips.js`, 48 bases / 1536 games): **+0.29pp, 55 decided,
32 to / 23 away, p=0.281**, ceiling 1.79pp. Positive on both independent
24-base halves (+0.13pp then +0.46pp) and on three of the four seat-arms. A
null with the sign the mechanic predicts; shipped on the owner's rule that a
positive read enables the knob.

Two things the run pinned down that are worth keeping:

- **The knob converts a lot of verdicts and almost no games.** On the first
  three bases the treated Phoenix seat's `ready-no-conflict-left` withholdings
  fell 180 → 46 (74% of them) while **48 of 48 games stayed bit-identical** —
  lifting a veto only matters in the windows where the bot also holds the card
  and wants to spend it. Do not read a firing census as a ceiling.
- **A three-base ceiling of 0.00pp was wrong.** The same arm over 24 bases
  flips 2.3-4.2% of games. A deck-scoped arm plays 16 pairings per base, so
  three bases is 48 games — far too few to see a 3% flip rate at all.

`elegance-and-grace` used to carry a hand-written version of rules 1 and 2 and
a comment claiming "the Imperial Favor counts glory, not ready characters" —
that was backwards, and the exception above is the correction.

### Why `allowMoveIntoConflict` is OFF by default

The ready → move sequence is a genuine use and the owner asked for it. The
problem is follow-through, not the idea: the bot decides the ready and the move
at separate prompts with no state tying them together.

Measured with the branch ON, the Unicorn deck readied Minami Kaze Regulars at
home in the last conflict of the round purely because Golden Plains Outpost —
its own stronghold — *could* have moved a body in, and then never used it. That
is exactly the waste this policy exists to stop, re-entered through the escape
hatch. `test/server/integration/botreadyvalue.spec.js` is what caught it.

The knob and `MOVE_INTO_CONFLICT_SOURCE_IDS` stay so the sequencing work has a
switch to turn on per deck once the ready is actually chained to the move.

## Where it is wired

One board reading per `decide()` call, memoised on `currentReadyValueVerdict`
and published on both playbook contexts as `homeReadyIsUseful`. Consumers:

| site | card / effect |
|---|---|
| `CardPlaybook.readyIsWorthACard` | `against-the-waves`, `i-am-ready`, `in-service-to-my-lord`, `right-hand-of-the-emperor`, `elegant-tessen`, `elegance-and-grace`, `shiotome-encampment`, `magistrate-station`, `steadfast-witch-hunter` |
| `JigokuBotPolicy` stronghold gate | `hayaken-no-shiro`, `kyuden-bayushi` (`READY_STRONGHOLD_IDS`) |
| `JigokuBotPolicy` water-ring choice | DEMOTES the dead ready half below every live option, so the ring bows an enemy when one is standing |
| `sortByPreference('strongest-bowed')` | bowed **participants** now outrank bowed home bodies |
| target pickers | `against-the-waves`, `sacred-sanctuary` prefer a bowed participant |

Cards that already required a participant (`fan-of-command`,
`the-pursuit-of-justice`) are unaffected by design.

`readyIsWorthACard` falls back to the two public conflict counts when
`homeReadyIsUseful` is absent, so Bot V2, the offline tools and every unit test
that builds a bare context keep a sensible rule.

## The test: `botreadyvalue.spec.js`

Not a card unit test. Every deck plays complete headless self-play games and
`test/helpers/readyvalue.js` watches the engine's own `onCardReadied` events as
they resolve, then asks whether anything ever used each ready. Card-agnostic:
any ready effect, any deck overlay, any future card shows up here.

Classification:

- **wasted** (hard gate, must be 0) — at the instant of the ready the body was
  at home and **neither** player had a conflict opportunity left. No later event
  could possibly have used it.
- **deterred** — the opponent still had an opportunity and then passed it. That
  counts as the ready doing its job: a conflict they were able to declare and
  did not is what a standing defender buys. Raised by the owner, and the reason
  the hard gate is scoped to "nothing could have used it" rather than "nothing
  did".
- **favor-glory** — the seat's deck races the Imperial Favor and the body
  carries glory.
- **unused** — defensible when made, nothing used it. Printed, never failed.

Costs (`context.costs.ready`), non-conflict phases and readies aimed at the
opponent (that is `effectpolarity.js`'s question) are all skipped.

Full field, base 91001, one game per deck per seat: **65 readies — 7 on bowed
participants, 18 used by a later conflict, 17 followed by an opponent pass, 10
banked for the Imperial Favor, 3 dead readies off a free ring resolution, 5
unused, 0 wasted.**

Before the gate the same run reported four wasted readies, in four different
mechanisms — `against-the-waves` (Phoenix), `i-am-ready` (Unicorn),
`hayaken-no-shiro` (Lion) and the **water ring** (Dragon, Lion, Phoenix). Only
the first was the reported bug; the monitor found the other three.

A fifth classification, **free-ring**, came out of that: a claimed ring resolves
whether the bot wants it to or not, so a dead ready there costs no card and no
fate. The bot demotes it below every live ring option but cannot decline the
ring, so those are counted and printed rather than failed. Dropping them from
the ring's option list instead was tried and is WRONG — with no ready enemy to
bow it emptied the list, and the forced fallback then readied an ENEMY
character, which `botpolarityfield.spec.js` caught immediately.

Scaling knobs: `READY_BASES`, `READY_DECKS`, `READY_FULL=1`.

## Measured

Decision rule fixed before the run: this is a correctness class, like
`polarityGuards`, not a win-rate lever. The question was whether it fires, on
what, and whether it costs anything.

**Reachability first.** `refactorIdentity.js` hashes `c649dbac7fc49f6c` both with
the knob at its default and with `enabled: false` — but that slate is only 17
games, so an identical hash there is not evidence of inertness for a lever this
rare. The census is:

```
BASES=91001,92001 node tools/selfplay/auditReadyAndRingChoice.js
  ready-value: 141 decisions would refuse a home ready (4.15 per game, both seats)
    by reason  141 ready-no-conflict-left
    by round   32 / 38 / 45 / 20 / 6  (rounds 1-5)
```

`BotTelemetry` is a global static sink and records BOTH seats, so that is
decisions across both bots.

**Null arm.** `readyValue` and `defenderRingChoice` both injected at their own
defaults, base 91001: **272 of 272 games bit-identical**, 0 flips, seat 0 wins
144 vs 144. The injection path is clean.

**Ceiling.** `measureDecisiveness.js` on the revert arm
(`{"readyValue":{"enabled":false}}`): the change flips **0.4%-1.1% of games**,
capping the win-rate effect at **0.55pp** — below the ±2.5pp noise floor, so a
head-to-head round robin cannot resolve it and was not run. The instrument is
the pooled flip sign test (same call as `fateRemovalKillFirst`).

**Pooled flip sign test**, 10 independent bases, 2720 games:

| | |
|---|---:|
| decided games | 26 (0.96%) |
| toward the change | 12 |
| toward the old behaviour | 14 |
| two-sided sign test | **p = 0.845** |
| implied effect on the treated seat | −0.04pp |
| bases positive / negative | 3 / 6 |

**A clean null, which is the expected and acceptable result.** The change stops
the bot spending cards on nothing; it does not make the bot win more. Caveat:
`measureDecisiveness` treats seat 0 only, so this carries the usual single-seat
caveat — irrelevant at a null, and it would matter if anyone tried to read a
number out of it.
