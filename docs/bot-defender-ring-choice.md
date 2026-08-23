# The defender chooses the element — `DefenderRingChoicePolicy`

Source: the same replay as `bot-ready-value.md`
(`game replays/dragon monk/2026-08-23_...Phoenix_Clan_vs_kingitus-Dragon_Clan.json.gz`),
round 5 conflict 1 — the conflict that ended the game.

```
kingitus is initiating a [military] conflict at stronghold province, contesting the void ring
kingitus takes 2 [fate] from the void ring
...
kingitus won a [military] conflict 10 vs 4
kingitus has broken Vassal Fields!
kingitus has won the game
```

The bot picked that ring. **Togashi Tadakatsu** was in play.

## The rule Tadakatsu creates

> The defending player chooses the element *(but not the type)* during each
> conflict declared against him or her. This choice is made before conflict
> type, attacking characters, and the attacked province are chosen.

`TogashiTadakatsu.ts` implements it as `playerCannot('chooseConflictRing')` with
`targetController: Players.Any`, and `conflictflow.ts:promptForNewConflict`
routes to `defenderChoosesRing` whenever the ATTACKER fails that restriction. So
while Tadakatsu is on the table, **every** conflict has its element chosen by
the player being attacked — including the ones where the bot is the defender and
does not own him.

## The bug

V1 answered that prompt with `ringDecision`, the ranking it uses when IT is
taking a ring: highest own score first. It was handing the attacker the ring it
would most like to have.

There WAS a "give away the worst ring" branch, but it was gated on `dragon`
(`DragonTactics` present), i.e. only when the BOT was piloting Dragon — the one
seat that owns Tadakatsu and therefore only ever faces this prompt from the
*other* side. The prompt exists because the OPPONENT has him in play, so the
gate was on exactly the wrong seat. In this replay the bot was Phoenix, `dragon`
was null, and the branch never ran.

That old branch also scored the rings from OUR side and took the minimum, which
is "the ring I least want" — not the same question as "the ring they least
want".

## The fix

Score every legal ring from the **attacker's** side of the table and hand over
the one at the bottom. Generic; no deck gate.

Three things fall out for free:

- **The fate pile.** The attacker banks the ring's fate at declaration, and
  `ringScore`'s fate tier is its dominant term from whichever side it is read.
  A 2-fate void ring is the LAST thing an attacker-perspective ranking gives
  away. The explicit `preferLowFate` tie-break only settles rings they value
  equally.
- **The ring EFFECT.** Only the attacker resolves it — a defender who wins
  claims the ring but resolves nothing (see the `defenseBreakTie` note in
  `CLAUDE.md`) — so their side is exactly the right side to price it from.
- **The board read.** `ringElementBase` prices void at 50 only for a player with
  a fated enemy character to strip, and water by how many ready no-fate bodies
  the other side has. Swapping the arguments swaps those readings correctly.

The scoring call passes **no deck tactics modules**: every one of them models
OUR deck, and reading the attacker's board through `GloryTactics` or
`ShugenjaTactics` would price their rings with our payoffs. Same convention as
`way-of-the-phoenix`, which already scores from the opponent's side.

### Detecting the prompt

From the prompt, not from `playerState.conflict`. `updateCurrentConflict` only
publishes the conflict summary AFTER this ring is selected, so at this prompt
the summary still describes the PREVIOUS conflict — the old branch's
`attackingPlayerId !== me.id` check was reading stale state.

`SelectRingPrompt` publishes `source.name` as the promptTitle, and the engine
sets that to the literal `'Defender chooses conflict ring'`
(`test/server/cards/03-DotV/TogashiTadakatsu.spec.js` asserts the same string).
The activePromptTitle — `Choose a ring for <attacker>'s conflict` — is the
fallback for adapters that publish only that.

## Knob

`DeckProfile.defenderRingChoice`, field-wide:

```
{ enabled: true, preferLowFate: true }
```

`enabled: false` restores V1's answer (our own attacking preference, handed to
the enemy) and is the A/B arm.

## Reach

The prompt only exists while a Tadakatsu is in play, and only the `Dragon`
fixture deck runs him — so across the self-play field this fires in Dragon
pairings only, on the NON-Dragon seat. Expect a very low ceiling; it was
reported as a small optimisation and is treated as one.

`BotTelemetry` kind `defender-ring-choice` records one row per ring handed over
with the whole ranking, the fate given away and the largest fate pile that was
on the table, so "did it fire, and what did it avoid" is answerable directly.

## Measured

Decision rule fixed before the run: the prompt is rare, so the question is
whether it fires and hands over the right ring, not whether it moves a win rate.

**Firing census** (`tools/selfplay/auditReadyAndRingChoice.js`, bases
91001+92001, 34 games): **24 Tadakatsu rings handed over across 3 games** — the
three Dragon pairings. Every one took the `defender-ring-worst-for-attacker`
branch. Fate handed to the attacker across all 24: **9**. Fate DENIED (the
largest pile on the table minus what was actually given): **70**. That is the
replay's bug measured directly — the old branch would have been giving away the
fat ring.

**Null arm.** Both new knobs injected at their own defaults, base 91001:
**272 of 272 games bit-identical**, 0 flips, seat 0 wins 144 vs 144.

**Ceiling.** `measureDecisiveness.js` on the revert arm: the change flips
**1.5%-2.9% of games** and changes the PATH of another 1.8-3.7%, capping the
win-rate effect at **0.74pp-1.29pp** — below the ±2.5pp noise floor, so a
head-to-head round robin cannot resolve it and was not run. The instrument is
the pooled flip sign test.

**Pooled flip sign test**, 10 independent bases, 2720 games:

| | |
|---|---:|
| decided games | 61 (2.24%) |
| toward the change | 40 |
| toward the old behaviour | 21 |
| two-sided sign test | **p = 0.020** |
| implied effect on the treated seat | **+0.35pp** |
| bases positive / negative | 8 / 2 |

Positive, significant on the sign test, and consistent with the ceiling.

**Caveat, stated plainly.** `measureDecisiveness` treats **seat 0 only** and
never swaps it, so a first-player interaction survives in it — the same rig
property that made `probePaired` over-read the opponent-aware axis by 1.3pp.
This is a directional result on a lever whose ceiling is under the noise floor,
not a shipped win-rate number, and it should not be quoted as one.

## Tests

- `test/server/bots/defenderringchoicepolicy.spec.js` — the policy in isolation,
  including the disabled arm and the fate tie-break.
- `test/server/bots/defenderringprompt.spec.js` — the live prompt shape, that an
  ordinary "Choose a ring" prompt is untouched, and that the fate pile is priced
  inside the score rather than bolted on top.
