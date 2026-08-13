# Bot effect polarity

A generic invariant on bot targeting, checked in real games rather than per
card. Four status-changing card game actions have a side the bot should always
aim them at:

| action | must land on |
|---|---|
| `ready` | a character the acting bot controls |
| `bow` | a character the opponent controls |
| `honor` | a character the acting bot controls |
| `dishonor` | a character the opponent controls |

The value of stating it this way is that nothing in the check knows which cards
exist. A misconfigured card, a deck overlay that hijacks another card's prompt
(the failure class in `bot-honor-token-targeting.md`), and a bot that clicks the
first selectable card all produce the same observable: a wrong-side landing.

## How it is measured

`test/helpers/effectpolarity.js` attaches an `EffectPolarityMonitor` to a live
game and listens for `onCardReadied` / `onCardBowed` / `onCardHonored` /
`onCardDishonored` as they resolve. Every landing is attributed to
`event.context.player` — the player whose ability is resolving — so an opponent
bowing our characters with their own card is never counted against us.

The monitor also wraps `game.cardClicked` and `game.menuButton` to record what
was selectable at the moment the bot picked, together with the prompt step's
`AbilityContext` and the policy's own decision `reason`. That is what separates
the two classes of violation:

- **avoidable** — a correct-side character was selectable at the click that
  chose this target. Always a bot bug.
- **forced** — no correct-side option, or no prompt at all. Either the card
  should not have been played, or its printed text is genuinely two-sided.

Correlation is by `AbilityContext` identity (falling back to a recent click on
the same source). Without that, an earlier click on the same character — the
attacker declaration, say — gets mistaken for the choice, which invented 59
phantom "avoidable" violations the first time this ran.

An alternative also has to be one the ACTION could have landed on, mirroring the
`canAffect` guards: a bowed enemy is selectable for the Water Ring's ready half
but not its bow half, and counting it reported a genuinely forced choice as an
avoidable one — 16 phantom failures on the second run.

`avoidable` is the hard gate. `test/server/integration/botpolarityfield.spec.js`
fails on any avoidable landing **including from an allowed card**, because an
allowance excuses a board or a printed text, never a decision.

## What is exempt

Three exemptions are built into the monitor and need no list:

- **costs** — bowing or dishonoring your own character to pay for an ability is
  the card working as printed. Read from `context.costs[action]`, which the cost
  resolver fills before the cost events resolve.
- **self-sourced effects** — a card acting on itself chose nothing. This is what
  Pride is ("after this character loses a conflict, dishonor it"), and it
  accounts for 249 of the 636 exemptions in a 816-game field run. Compared by
  object identity, so a second copy of the same card is still a real choice.
- **Scorpion own-side dishonor** — `DECK_ALLOWANCES` in
  `test/helpers/polarityallowances.js`. Shosuro Sadako inverts the honor-status
  modifier and Calling in Favors / Acclaimed Geisha House pay a friendly
  dishonor, which is why those profiles carry
  `personalHonor.ownDishonorCostSourceIds`.

Everything else is a per-card entry in `polarityallowances.js`.
`POLARITY_ALLOWANCES` holds two kinds: cards whose printed text hits both sides
(Honored Veterans honors a Bushi *each player* chose, Game of Sadane honors the
duel's winner whoever that is, Diversionary Maneuver bows *each* participating
character), and one-sided cards the board left no legal right-side target for
(Water Ring with our board all ready and theirs all bowed).
`KNOWN_POLARITY_DEFECTS` is for open bot bugs, listed separately so the suite
still fails on anything new; deleting an entry is how a fix gets locked in. It
is currently empty.

## Tests

- `test/server/integration/botpolarityfield.spec.js` — every deck plays real
  self-play games on both seats and asserts zero unexplained wrong-side
  landings. One base, one opponent per deck by default (~34 games, 100s).
  `POLARITY_BASES`, `POLARITY_DECKS` and `POLARITY_FULL=1` widen it.
- `test/server/integration/botpolarityscenarios.spec.js` — one hand-built board
  per rule, where both sides are legal targets and a real
  `JigokuBotController` answers the real prompt: Lion's Pride Brawler (bow),
  Hayaken no Shiro (ready), Way of the Scorpion (dishonor), Shameful Display
  (honor).

## Tools

```powershell
# every wrong-side landing, ignoring the curated lists — this is how a fresh
# exception list gets derived
$env:RAW='1'; $env:BASES='91001,92001,93001'; $env:WORKERS='14'
$env:OUT='polarity.json'; node tools/selfplay/auditEffectPolarity.js

# the remainder after the lists are applied; must be zero
Remove-Item Env:RAW; node tools/selfplay/auditEffectPolarity.js

# replay one game from a violation's label and dump the bot's view at the prompt
$env:CASE='92001|Crane|Unicorn'; $env:MATCH='select up to'; $env:SEAT='0'
node tools/selfplay/replayPolarityCase.js
```

## Defects found and fixed (2026-08-13)

The first RAW field run — 816 games, 3 bases, 17 decks, both seats — produced
9641 landings, 292 wrong-side, **62 of them avoidable**. A fourth base (1088
games) added one more source. All eight are fixed; the same run now reports
**0 avoidable** out of 283 forced landings.

| card | rule | before | root cause and fix |
|---|---|---:|---|
| Fire Ring | `dishonor:own`, `honor:enemy` | 46 + 4 | Two prompts: pick a character, then honor or dishonor it. When the pick could not take the honor the follow-up offered only `Dishonor <our card>` and the fallback took it. Now takes `Don't resolve the fire ring`. `Back` was tried first and **loops** — the attempted-click set is cleared when the prompt signature returns, so the target step re-picks the same card forever. Separately, the follow-up matched buttons by card NAME, and both decks can run the same card: a name collision honored the enemy's copy. The chosen side is now carried in `fireRingTargetSide` instead of re-derived. |
| Shameful Display | `honor:enemy`, `dishonor:own` | 12 + 14 | "Choose two characters — honor one and dishonor the other." Picking an already-dishonored enemy as the second card inverts the whole card: the engine can then only offer the dishonor on our pick and the honor on theirs. That fallback is gone; with no enemy able to take a dishonor the second pick is one of OURS that is already honored (it loses a token instead of becoming dishonored), and when neither half can land right the ability is cancelled at the pre-cost check. |
| Water Ring | `ready:enemy`, `bow:own` | 16 | With our board all ready and theirs all bowed the water branch found nothing useful, returned null, and the generic card ranking bowed our best character. Now takes the lowest-skill of the bad options (`water-ring-forced-least-harm`). Still counts as a forced landing — see the allowance list. |
| Kakita Yoshi | `dishonor:own` | 21 | "Choose up to X characters — dishonor each." With every enemy already selected the last pick fell to `forced-dishonor-own-lowest-glory` while a `Done` button was on screen. A select prompt only grows `Done` once the selector is satisfied, so Done is always a legal answer; it is now preferred over any wrong-side fallback in the honor, dishonor, ready and bow branches. |
| Asako Azunami | `ready:enemy`, `bow:own` | 14 + 4 | Both halves are optional ("you may"). Fixed by the same Done rule. |
| Against the Waves | `bow:own` | 6 | "Bow **or** ready that character", own Shugenja only. With no bowed Shugenja the only legal half is bow, and the branch fell back to any own Shugenja. It now cancels, which the pre-cost check acts on before "Pay costs first" removes the escape. |
| Asako Diplomat | `honor:enemy` | 1 | Aimed the dishonor at an already-dishonored enemy, so the follow-up menu offered only "Honor this character". Target now filtered to enemies that can still take a dishonor. The menu rule was also gated behind the glory profile and is now field-wide. |
| Steadfast Witch Hunter | `ready:enemy` | 1 | "Sacrifice a character — ready a character." `ready` is only legal on a bowed character, so eating our only bowed body left the prompt offering nothing but theirs. The sacrifice picker now keeps one bowed body back. |

### What the fixes are worth

Measured with the standard rig (`.claude/skills/roundrobin/SKILL.md`). All eight
sit behind one `DeckProfile` switch, `polarityGuards` (default `true`), so an
arm is a JSON string: `CHANGE='{"deckProfile":{"polarityGuards":false}}'` plays
the pre-fix bot and the fixes are worth minus whatever it scores.

| step | result |
|---|---|
| ceiling, `measureDecisiveness.js`, base 91001 | 1 of 272 games flips (0.4%), 98.9% bit-identical → **caps the effect at 0.18pp** |
| null arm, `polarityGuards: true`, 3 bases | **816-816, exactly 50.00%**, every base 272-272, 0 draws, 1632/1632 decided |
| `polarityGuards: false`, 3 bases, 1632 games | 809-823, **−0.43pp, z=−0.35, p=0.729** |

So the fixes read **+0.43pp with p=0.73** — the sign is right and the size is
noise, exactly as the ceiling predicted. **This is a correctness change, not a
win-rate lever**, and the ceiling says no head-to-head can ever say otherwise:
resolving 0.18pp would need on the order of 10^5 games. Do not re-measure it
hoping for a number; the justification is the invariant, not the win rate.

The knob stays wired because it is the A/B handle for this whole class — a
future polarity guard can be measured against it without editing source.

### Two shapes

Both fixes are generic rather than per card:

1. **A wrong-side fallback taken while a decline was on the table** — `Done`,
   `Cancel`, `Don't resolve`, or an optional "you may". Preferring the decline
   costs nothing and fixed four of the eight.
2. **A mode menu answered independently of the target prompt.** Fire Ring,
   Asako Diplomat and Against the Waves each pick *which character* in one
   prompt and *which half of the effect* in another, and the two branches did
   not agree. Carrying the chosen side forward, and refusing to aim at a
   character that cannot take the token, fixed the rest.
