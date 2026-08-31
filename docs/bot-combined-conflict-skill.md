# Combined military+political skill reopens the off-axis gate

## The defect

Live 2026-08-31, `game replays/debug/2026-08-31_kingitus_s_game_Jigoku_Bot-Unicorn_Clan_vs_kingitus-Dragon_Clan.json.gz`,
the last conflict of the game:

```
kingitus is initiating a [political] conflict at stronghold province, contesting the fire ring
kingitus has initiated a [political] conflict with skill 37
Jigoku Bot has defended with skill 32
...
kingitus won a [political] conflict 41 vs 32
kingitus has broken Massing at Twilight!
```

The bot's own stronghold province is **Massing at Twilight**: *"While resolving
conflicts at this province, each character counts its combined
[conflict-military] and [conflict-political] skill."* The bot held **Banzai!**
(+2 military, +4 for 1 honor) and **Scarlet Sabre** (+2 military) through the
whole conflict and played neither. It played the political buff it had (Speak to
the Heart, +4) and passed.

Under that province a military pump raises the total of a political conflict.
The bot could not see it.

## Why

`Conflict.calculateSkillFor` replaces the per-character contribution with
`mostRecentEffect(EffectNames.ChangeConflictSkillFunction)` when one is
registered, and Massing's is `card.getMilitarySkill() + card.getPoliticalSkill()`.
`JigokuBotPolicy.skillValue` already knew this — a participant's skill is
reported combined while `combinedConflictSkills` is on.

The **play gate** did not. `CardPlaybook.conflictTypes` carries two unrelated
rules under one field:

- an ENGINE gate — *"During a [conflict-military] conflict..."* (A Perfect Cut,
  Way of the Lion, Captive Audience);
- a VALUE heuristic — *"the bonus is military, so it is worth nothing in a
  political conflict"* (Banzai!, Hurricane Punch, Ujik Tactics, Scarlet Sabre).

Combined skill deletes the second and leaves the first. Nothing in the
serialized state can tell them apart, and neither can the playbook entry: both
are spelled `conflictTypes: ['military']`.

## The rule

`JigokuBotController.combinedSkillLegalCardIds` publishes the printed ids of the
hand cards whose ability the ENGINE says is legal **right now**
(`action.meetsRequirements(action.createContext(player)) === ''`, without
ignoring `target`, so a pump with no participant to land on stays refused).
`JigokuBotPolicy.offAxisCardStillPays` reopens the `wrong-conflict-type` gate
for exactly those cards, and only while `combinedConflictSkills` is on. Banzai's
condition is a bare `isDuringConflict()` and passes; A Perfect Cut's names the
type and does not.

The field is published **only** while combined skill is live, so every other
prompt — and every synthetic caller — leaves the gate exactly as it was.

## Detecting the province, and the character

`combinedConflictSkills` used to be `conflictProvinces.some(id === 'massing-at-twilight')`.
It is now `combinedConflictSkillsActive`, which also scans
`game.effectEngine.effects` for a `ChangeConflictSkillFunction` whose **source**
is in `COMBINED_SKILL_SOURCE_IDS` and whose `targets` include
`game.currentConflict`. Two reasons:

- **Shiba Ryuu** prints the same sentence on a *character*, on either side of
  the board, and the province scan could never see it.
- `targets.includes(conflict)` is the engine's own liveness answer: a
  `ConflictEffect` targets `game.currentConflict`, and `Effect.checkCondition`
  adds and removes that target as the condition turns on and off. Nothing is
  re-evaluated here.

The SOURCE is still keyed by id and cannot be read off the engine: the effect's
value is an opaque closure, and not every source of it means *combined*.
**Sanpuku Seido** counts glory and **River Crossing** counts 1 — under either of
those a skill buff is worth nothing at all, which is the opposite conclusion.
Pricing those two correctly is a separate, unwritten rule; today they simply
leave the gate shut, as before.

## Status

Correctness class. Ceiling is small: the effect exists on one province in one
deck in the field (Unicorn Reveal's own stronghold province) plus Shiba Ryuu,
and it only matters when the axis-restricted half of the hand would have been
playable. No win rate was measured.

Watched by `test/server/integration/botcombinedconflictskill.spec.js`, which
runs a real game, a real registered Effect and a real controller, and asserts
the engine's own split between Banzai! and A Perfect Cut.
