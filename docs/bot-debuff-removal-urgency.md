# Removing a debuff the moment it lands

`DeckProfile.debuffRemovalUrgency`, with the ordered source list in
`DeckProfile.attachmentControl.debuffRemovalSourceIds`.

## The defect

Pacifism and Stolen Breath do not cost a conflict. They cost **every** conflict
of that type for as long as they sit there:

```ts
// Pacifism
whileAttached({ effect: [cannotParticipateAsAttacker('military'),
                         cannotParticipateAsDefender('military')] })
```

and they are attached in the action window **before** a conflict is declared. A
remover held until the conflict window has already conceded the declaration the
removal was supposed to enable.

Two things were wrong, and both had to be fixed before the rule could fire at
all:

1. **`miya-mystic`'s playbook gate.** It read
   `ctx.opponentCharacters.some(card => card.attachments.length > 0)` — an ENEMY
   attachment. The one thing the card is printed to answer, a debuff on our own
   board, never opened the gate. Measured over 384 games: the gate stayed shut
   in **41 windows** where an own debuff was in play.
2. **Nothing looked for an own debuff in the conflict-phase action window.** The
   in-play ability list there is gated on `shugenja || attachmentTower` and on a
   `conflictPhaseAction` hint, neither of which the Dragon monk profile has, so
   for that deck the window had no board-ability path whatsoever. Opening the
   gate alone changed **nothing**: 0 winners flipped and 0 paths changed over
   816 games, because the card was never offered at the prompt that mattered.

Seen live, 2026-08-25, Dragon vs Phoenix round 4: Pacifism landed on Togashi
Mitsu twice; Let Go answered the first copy a full conflict late, and Miya
Mystic sat ready on the board through the second while Mitsu could not defend a
military conflict against the bot's last unbroken province.

## The rule

In the conflict phase, with a negative attachment on one of our characters,
click the first legal removal source in `debuffRemovalSourceIds` order:

1. `let-go` — a free hand card,
2. `miya-mystic` — sacrifices the body carrying the ability.

Ordered by what the removal COSTS, which is also the owner's stated preference.
The Miya Mystic playbook gate additionally stands down while a Let Go is in
hand, so the two never race for the same debuff.

## Polarity: a debuff on THEIR character is working for us

`AttachmentControlTactics.removeOwnDebuffsOnly` (default `true`).

`polarityTargetDecision` routes both card ids through
`AttachmentControlTactics.pickTarget`, which compares "a debuff we shed" against
"an enemy buff we take" on one scale. That scale had a hole: `attachmentWorth`
prices an **unknown** enemy attachment at `6 + the skill it grants`, a debuff
grants none, and the carrier weighting (`fate * 2 + skill * 0.5`) then lifts a
Pacifism sitting on a fat enemy body (6 fate, 9 skill -> 22.5) above the same
Pacifism on one of ours (18 + our carrier). Removing it would hand them the body
back — the exact opposite of what the card is for.

An id in `ownDebuffScores` is now never a removal target while an OPPONENT
controls the carrier, and the mirror already held by construction: only a debuff
on our own side is ever a candidate, never one of our own buffs. The play gates
were tightened the same way — `let-go`'s `shouldPlay` and `miya-mystic`'s
`shouldUseAction` no longer count an enemy-carried DEBUFF as a reason to spend
the remover. `test/server/bots/attachmentremovalpolarity.spec.js` locks all four
quadrants.

Both directions in one sentence: **debuffs come off ours, buffs come off
theirs.**

## Measurement

`false` reproduces V1 exactly (`refactorIdentity` unchanged at
`409b3d34aaa6bfad` with the knob injected at `false`).

| rig | games | result |
|---|---:|---|
| null arm, head-to-head | 1614 / 3 bases | 807-807, exactly 50.00% |
| paired probe, gate only (before the action-window branch) | 816 / 3 bases | **0 flips, 0 path changes** — the gate opened and the card was never offered |
| paired probe, shipped | 816 / 3 bases | 4 winners flipped (0.5%), 11 more paths changed, **98.2% bit-identical** |
| whole-batch head-to-head, inverted | 3232 / 6 bases | OFF arm 49.85%, p=0.860 |

**Ceiling 0.25pp.** Three decks in the field run Miya Mystic and four run one of
the debuffs, so the configuration is rare by construction. Correctness class,
same standing as `polarityGuards` and `moveIntoConflict`; the value is in live
play against a Phoenix or Scorpion list, not in the self-play win rate. Do not
re-measure it hoping for a number.

## Diagnostic left behind

`BotTelemetry` kinds `debuff-removal-window` (one row per prompt at which a
remover BODY was on the board, carrying `ownDebuff` / `enemyAttachment` /
`letGoInHand` / `gatePassed`), `debuff-removal-candidate` (whether the engine
reported it clickable, and what outranked it) and `debuff-removal-fire`. These
are what separated "the gate refused" from "the window never opened", which a
win-rate rig cannot do.
