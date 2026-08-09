# Removed fate experiments: what they were and how to rebuild them

Everything in this file was implemented, measured, and then **deleted from the
source** because it did not ship. It is recorded in enough detail to rebuild
without rediscovering the dead ends. Results and reasoning live in
`bot-fate-starvation.md` and `bot-save-fate-pass.md`; this file is the
mechanical recipe.

The removed source text is archived alongside the session scratchpad as
`removed_skip_gate.ts.txt` and `removed_reserves.ts.txt`; if those are gone,
the descriptions below are sufficient to reimplement.

## What still exists (do not confuse with the removed work)

| feature | where | status |
|---|---|---|
| Early-round fate floor | `SaveFatePassPolicy.setupFateFloor`, applied by `JigokuBotPolicy.raiseSetupFate` | **SHIPPED field-wide**, rounds 1-3, floor 1 |
| Aggressive last-resort spending | `AggressiveSpendPolicy` | **SHIPPED** for Crab (`minPriority 5`) and CraneDuels (`minPriority 9`) |
| Cheap-body ring raid | `conflictPlanning.hopelessAttackWeakestFirst` + `hopelessAttackKeepHome`/`hopelessAttackReach` | **SHIPPED** for Crab |
| Conflict-window census | `conflict-window-pass` telemetry in `conflictWindowDecision`'s `pass()` | kept — general diagnostic |
| Ring census | `ring-choice` telemetry at the declaration ring pick | kept — general diagnostic |

## 1. The dynasty-phase SKIP (removed)

**Idea.** Pass the whole dynasty phase to bank the round's income plus the
first-passer fate (`DynastyActionWindow.#handlePassingFate`, live in
`stronghold` mode), then spend it later.

**Where it lived.** A gate at the top of the `me?.phase === 'dynasty'` block in
`JigokuBotPolicy.actionWindowDecision`, immediately after `playable` was
computed and BEFORE the cost-reducer, the deck preference, the economies and
the dynasty dig actions. It ran only when `!this.fateAwareBoughtCharacter`, and
on a positive verdict clicked the `pass` button.

**Profile fields** (all on `SaveFatePassProfile`):

```
earlyRounds: readonly number[]     // rounds skipped on round number alone
minBoardCharacters: number         // own characters in play required
minPersistentCharacters: number    // stricter: characters still carrying fate
lateFromRound: number              // from here, gate on board strength not round
lateSkillRatio: number             // own board skill / opponent's, e.g. 1.25
lateMinCharacters: number          // bodies required for any late skip
minFate: number                    // never skip holding less than this
maxBrokenProvinces: number         // stop once this many own provinces broken
maxSkipsPerGame: number            // 0 = uncapped; 1 expresses "turn 2 OR 3"
```

`decide(context)` returned `{ pass, reason }` and the call site fed it
`roundNumber`, `persistentCharacters`, `boardCharacters`, `myBoardSkill`,
`opponentBoardSkill`, `fate`, `brokenOwnProvinces`, `skipsUsed`. Board skill
came from a `totalBoardSkill(side)` helper (sum of max(0, military) +
max(0, political) over characters in play) that was removed with it.
`maxSkipsPerGame` was backed by a per-game `saveFatePassSkips` counter on the
policy, incremented when a skip was taken and reset in
`resetFateAwareEconomy` — note that reset is per ROUND, so the counter was
effectively per round-sequence, not per game; a true per-game counter should
follow `seasonOfWarUses` instead.

**Verdict: settled negative, do not retry.** Every scoping was measured:

| scoping | skips fired | result |
|---|---:|---:|
| rounds 2+3, two bodies standing | 1805 | -8.64pp |
| round 2 or 3, capped at one | 1571 | -7.26pp |
| round 3 only | 1342 | -6.11pp |
| round 2 only | 674 | -3.26pp |
| rounds 2+3, three-body bar | 656 | -3.31pp |
| board strength only, 1.25x, from round 2 | 679 | -2.99pp |
| board strength only, 1.75x | 181 | -0.23pp (ceiling 0.46pp) |

Net flips regress on skips TAKEN at **r = -0.996, slope -0.107 games per
skip** — a skipped dynasty phase costs about a tenth of a game regardless of
when or why. That is a lever with the wrong SIGN; no scope rescues it, and the
only scoping that stops losing is the one that stops firing.

Retested AFTER the fate floor shipped (the objection being "now boards
persist"): it got **worse**, -24.08pp for a round-1 skip, -16.77pp round 2,
-10.94pp round 3. The floor made rounds 2-3 worth MORE, so declining to buy in
them costs more.

## 2. The hand-aware fate RESERVE (removed)

**Idea.** Hold fate back from the dynasty budget so the conflict phase can cast
what the hand is holding.

**Where it lived.** `SaveFatePassPolicy.handFateReserve(round, wantedCosts)`,
fed into the existing `dynamicFateReserve` `Math.max(...)` in the dynasty
block. It returned `min(handReserveMax, min(wantedCosts))` — the CHEAPEST
wanted card's cost, so the bot could afford one good card rather than hoarding
for an expensive tail. The call site filtered hand cards to
`cardHint(card.id)?.priority >= handReserveMinPriority` and mapped them to
`conflictCosts[card.uuid]`.

```
handReserveEnabled: boolean
handReserveMinPriority: number   // default 7
handReserveMax: number           // default 2
handReserveFromRound: number     // default 1
```

**Verdict: negative on three independent rigs.** -1.98pp (paired probe),
-2.60pp (head-to-head, z=-2.98, p=0.003, six fresh bases), -1.53pp (per-deck
round robin). Damage scales with the reserve: -4.14pp at max 2.

Because it combined via `Math.max`, decks with a larger reserve of their own
(PhoenixPhoenix, PhoenixShugenja via `shugenja.desiredFateReserve`) were
untouched — they showed exactly 0 flips, which is a useful sanity signal if
this is ever rebuilt.

## 3. The unconditional flat RESERVE (removed)

**Idea.** The hand-aware reserve cannot fire on a weak draw, so a bot that
banked a big pool and drew badly still spends all of it on bodies. This kept X
fate back in named rounds regardless of the hand.

```
flatReserveRounds: readonly number[]
flatReserve: number
```

`flatFateReserve(round)` returned `flatReserve` when the round was named, and
joined the same `Math.max(...)`.

**Verdict: negative.** -3.40pp alone (4 fate, rounds 3-4), and costs are
ADDITIVE with the skip: round-2 skip alone -3.26pp, floor alone -3.40pp,
both together -7.26pp. Nothing in this family rescues anything else.

**Trap that nearly produced a false null:** the first run of this arm reported
0 flips and 1088/1088 bit-identical games, which reads exactly like "the lever
is null". The feature had been written but never compiled — the harness runs
compiled JS. `npx tsc` before every arm, and treat a 0.00pp result as a build
question before a behaviour one.

## 4. Rebuilding any of these

1. Add the fields back to `SaveFatePassProfile` and its `DEFAULT_*`.
2. Reinstate the call site (dynasty gate for the skip; the
   `dynamicFateReserve` `Math.max` for either reserve).
3. `npx tsc` — the harness runs compiled JS.
4. Confirm the identity hash still matches with the feature OFF:
   `node tools/selfplay/refactorIdentity.js` should print
   **`143af3d736039650`**.
5. Prove the arm is REACHABLE before spending games:
   `CHANGE='...' KINDS=... BASES=91001 node tools/selfplay/probePaired.js`.
   A 0.00pp ceiling means unmeasurable, not neutral.
6. Screen per deck with `tools/selfplay/deckFieldWinRate.js` (subject armed vs
   the 16 other decks unarmed, control and arm on identical shuffles), then
   retest anything promising at 40 games/opponent on bases never used for the
   screen.

**Base sets already consumed by this work** — do not reuse them for
confirmation: 91001-94001, 120001-125001, 130001-135001, 140001-143001,
150001-155001, 160001-165001, 170001-175001, 180001-185001, 190001-195001,
200001-205001, 211001-230001, 240001-245001, 250001-269001, 270001-275001,
280001-299001.

**The single most important lesson:** across this work ~120 deck/arm rows were
screened and six reached a fresh-base confirmation. **One survived.** A screen
p-value, however small, is not evidence — only the fresh-base retest is.
