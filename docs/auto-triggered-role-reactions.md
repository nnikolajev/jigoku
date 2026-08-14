# Auto-triggered role reactions

**SHIPPED** (2026-08-13). Engine/UX, not a bot lever.

## What it does

The ten Seeker and Keeper role cards (`server/game/cards/01-Core/_createRoles.ts`)
each carry one optional reaction: *gain 1 fate*. It is free, has no target and
no cost, and there is no board state in which declining it is correct — so
every player clicked "yes" every time. That click is now gone: the triggered
ability window resolves the role reaction itself.

Nothing else about the ability changes. It is still an optional reaction, it
still occupies its window, it still passes priority to the opponent afterwards,
and it still writes the usual chat line (`player1 uses Seeker of Air to gain 1
fate`). The only difference is that no prompt is shown to its controller.

## How it is wired

Three pieces, all opt-in:

1. **`autoResolve: true`** on the ability's properties
   (`TriggeredAbilityProps.autoResolve`, stored on `TriggeredAbility`). Only
   the Seeker and Keeper roles set it today.
2. **`TriggeredAbility.canAutoResolve()`** — the ability must have opted in,
   *and* have no targets, no costs, and be a plain `Reaction`. The extra
   conditions are a guard: if `autoResolve` is ever put on an ability that
   asks the player something, the flag is ignored rather than answering for
   them.
3. **`TriggeredAbilityWindow.getAutoResolveChoice()`** — after the window has
   narrowed `this.choices` to the current player's legal triggers, the first
   auto-resolvable one is resolved instead of prompting. Already auto-resolved
   abilities are tracked in `autoResolvedAbilities` so a resolution that never
   records itself falls back to the prompt instead of looping.

## The setting

`optionSettings.autoTriggerRoleAbilities`, **default `true`**, in both
`jigoku/server/settings.ts` and `jigoku-client/server/settings.ts`. Exposed as
"Automatically trigger my Seeker/Keeper role's fate reaction" in the profile
page and the in-game settings panel (`Profile.tsx`,
`GameComponents/GameConfiguration.tsx`), so it can be flipped mid-game through
`game.toggleOptionSetting`.

Only the value `false` disables it — a missing key counts as on, which keeps
legacy user documents and any hand-built user object on the new default.

## Bots

`JigokuBotConfig.buildBotUser` sets the option explicitly, so bot seats never
see the window either. The Seeker/Keeper entries in `CardPlaybook` are
therefore **fallback-only** now; they are kept so the ranking is still right if
the option is ever turned off, but they are unreachable in normal play.

## What was verified

- `npm test` (11313 specs). Exactly three existing specs asserted the old
  prompt (Aranat, EmeraldCovert, conflictphase) and were updated to assert the
  fate instead. `test/server/cards/01-Core/RoleReactionAutoTrigger.spec.js`
  covers both roles, the option off, the wrong-element control, the
  attacker-side control, and the case where a second reaction to the same event
  must still be prompted.
- `tools/selfplay/refactorIdentity.js`: 14 of 17 games bit-identical, two lost
  exactly one step (the removed click), one diverged. **This is expected** —
  the bot's tie-break stream is a `SeededRandom` advanced per decision, so
  removing a decision reshuffles every later tie-break in that game.
- Role reactions actually resolved over that slate: 28 with the option off vs
  29 with it on, and the per-game counts are identical except in the diverged
  game (which ran two extra rounds). The bot was already triggering these
  reliably, so this is not a strength change in either direction — it removes a
  click, not a decision.
