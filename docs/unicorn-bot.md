# Unicorn movement bot

The Unicorn Cavalry Rush profile uses `UnicornTactics.ts` as its injectable
movement planner. Prompt handling stays in `JigokuBotPolicy`; deck-specific
target scoring and tunable constants stay in `UnicornProfile`. Seeds 1, 2, and
5 all use these hooks when the deck contains the aggressive Cavalry markers.

## Conflict plan

The bot does not declare every useful character immediately. During a military
conflict it may leave a movement target at home, declare Outskirts Sentry first,
then move the reserved character with Golden Plains Outpost, Ride On, or
Adorned Barcha. Candidate scores include:

- current conflict skill and fate;
- Spyglass draw value and Moto Stables' twice-per-round military bonus;
- Outskirts Sentry honoring the highest-glory useful participant;
- Moto Outrider and Twilight Rider ready value;
- Adorned Barcha's bow plus move swing;
- a known post-move ready source: the character's own ability, I Am Ready, or
  Shiotome Encampment;
- bowed Minami Kaze Regulars and Higashi Kaze Company reactions when moving the
  character into an already winning conflict can still produce their payoff.

A bowed body is therefore not rejected merely for being bowed. It must either
have an exact ready follow-up or a useful after-win reaction. Barcha may be used
from a bowed bearer because its Action bows an enemy and moves the bearer; the
attachment Action remains limited to once per round. A Cavalry move source
normally preserves an unused Barcha bearer for Barcha's stronger own Action.

The planner runs for both attack and defense. It still preserves the deck's
aggressive province-breaking and additional-conflict plan.

## Exact participation rules

The controller supplies the live participating-character count rather than
reconstructing it from only physical conflict cards:

- Shiksha Scout counts as two participating characters.
- Iuchi Soulweaver counts while at home.
- Challenge on the Fields adds one military for every other effective
  participant controlled by that duelist, and injects that projected skill into
  the shared duel planner.
- Flank the Enemy uses effective participant counts.
- Shinomen Wayfinders' discount uses the same effective Unicorn count, capped
  by its printed cost.
- Ujik Tactics intentionally uses only physical participating characters,
  because only those characters receive its bonus.

Shiksha Scout and Shinomen Wayfinders enter or move directly into the current
conflict through their engine abilities. Their exact participation and discount
math is applied after entry without artificially forcing them ahead of other
conflict cards; a priority experiment reduced the RR25 result and was removed.

## Attachments and Gaijin

Spyglass, Adorned Barcha, and Utaku Battle Steed are distributed before making
duplicates. Spyglass and Barcha prefer a useful home movement target. Battle
Steed prefers a non-Cavalry character so Golden Plains Outpost and Ride On can
move it; a duplicate is allowed only when the extra +1 skill is immediately
needed.

When Worldly Shiotome is not honored, playable Gaijin cards receive setup
priority so their play can honor it. This ordering does not bypass the normal
legality, economy, or conflict-value checks.

## Safety and tuning

`UnicornProfile` exposes movement thresholds and the score weights for
Spyglass, Outrider, Twilight Rider, Moto Stables, Outskirts Sentry, supported
readying, Barcha, Minami, and Higashi. A future Unicorn list can override these
values through `DeckProfiles.ts` without duplicating prompt code.

Failed Golden Plains Outpost targeting vetoes that source for the current
decision window. The veto also applies when the source is the stronghold card;
this prevents source -> invalid target -> cancel loops.

## Validation

The retained 2026-07-19 seed-1 build completed two Unicorn RR25 samples:
109-116 and 119-105 (+1), pooled 228-221 (+1), or 50.8% of decided games. The
stored pre-change baseline was 97-128 (43.1%). The unseeded shuffle makes each
small matrix noisy, but the retained build improved in six of nine pooled
matchups; Lion and Dragon Attachments remain weaker matchups. These custom
25-game runs do not overwrite the standardized 40-game client benchmark.

The final alternating-seat direct Crane run finished 59-41 (59%) over 100
games, up from the stored 47% Unicorn baseline. It was run through
`matchUnicorn.js`, so it also does not replace the client benchmark file.

Focused specs cover scoring, declaration reservation, bowed supported targets,
bowed Minami/Higashi reactions, attachment distribution, effective participant
counts, Challenge skill injection, and all seed hooks. The all-opponent click
audit covers seeds 1, 2, and 5 and completed with zero loops, forced progress,
budget exhaustion, stalls, or unsupported prompts.

```powershell
npm run jasmine -- --filter="Unicorn"
node tools/selfplay/matchUnicorn.js 50 1 --trace
node tools/selfplay/validateBotInteractions.js --decks Unicorn --opponents all --games 1 --seeds 1,2,5 --out tools/selfplay/out/unicorn-all-opponents-click-audit
node tools/selfplay/botRoundRobin.js --games 25 --workers 32 --seed 1 --out tools/selfplay/out/unicorn-round-robin
```
