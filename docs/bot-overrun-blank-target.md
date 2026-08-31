# Overrun: the blank goes where the text still matters

## The defect

Live 2026-08-31, `game replays/debug/2026-08-31_kingitus_s_game_Jigoku_Bot-Unicorn_Clan_vs_kingitus-Dragon_Clan.json.gz`,
round 4:

```
Jigoku Bot has broken City of the Rich Frog!
Jigoku Bot plays Overrun to place a dishonored status token on City of the Rich Frog, blanking it
```

Overrun is `Reaction: After you break a province, choose a province controlled
by the same opponent - place a dishonored status token on that province and
reveal it, if able.` The bot spent it on the province it had just broken. Both
halves are dead there:

- `ProvinceCard.isBlank()` returns `true` while `isBroken`, so the dishonored
  token adds nothing.
- A broken province is already faceup, so `reveal` adds nothing.

`breakProvince()` even calls `removeAllTokens()` first, so the token is placed
on a card whose text was already off.

## Why it picked that one

`UnicornRevealTactics.pickRevealTarget` ranked hidden provinces above faceup
ones and then fell through to `provinceTextPriorityById`, which is keyed on this
deck's OWN provinces and scored every Dragon province 0. The last tie-break is
`String(location).localeCompare(...)`, and `'province 1'` sorts first — which is
where the break had happened. Every opposing province was already faceup by
round 4, so the hidden-first term never fired and the alphabet decided.

Two smaller faults surfaced in the same function:

- The candidate filter accepted `card?.facedown`, which sweeps in the facedown
  **dynasty cards** sitting inside those provinces. A facedown PROVINCE needs no
  such term: `ProvinceCard.hideWhenFacedown()` is `false`, so it publishes
  `type: 'province'` like any other.
- Nothing excluded a broken province, for any source in `revealSourceIds`.

## The rule

`UnicornRevealProfile.blankAndRevealSourceIds` (`['overrun']`) marks the sources
whose payoff is the **blank**, with the reveal as a rider. For those the
ordering inverts:

1. A province already carrying the token has nothing left to blank — last.
2. The **stronghold province** first. `ProvinceCard.canBeAttacked` gates it on
   `getProvinces(isBroken).length > 2`, so the opponent reaches it last and its
   printed text has the longest left to run; it is also the one province an
   attack plan cannot route around.
3. Then a still-hidden province. The token lands **before** the flip
   (`sequential([dishonorProvince, reveal])`), so blanking it also kills an
   on-reveal reaction before it can fire.
4. Then printed-text priority, then the location string.

Broken provinces are dropped for **every** source, not only these.

The stronghold preference is applied only when the prompt actually offers a
usable stronghold province: `JigokuBotPolicy` asks `pickRevealTarget` first, and
falls back to the existing hidden-first shortcut
(`facedownSelectableDecision`) when the answer is not the stronghold. That keeps
the older behaviour intact on a board with no reachable stronghold province,
which is what `jigokuheuristicbot.spec.js` asserts.

`facedownSelectableDecision` orders the stronghold province first for these
sources too, for the same reason `preferOpponentStrongholdReveal` does it for
the reveal engine — opposite motive, same list order.

## Status

Correctness class. No win rate was measured: the card is one copy in one deck
and the change only moves which province the token lands on.

Watched by `test/server/bots/unicornrevealtactics.spec.js`.
