# Covert — published by the engine, shown to the player

**SHIPPED.** A character that currently has the COVERT keyword shows a badge on
its left edge, just below the printed military and political scrolls.

Client-only. No bot behaviour reads it.

## The problem

Covert decides whether an attack can strip a defender before defenders are
declared, so "which of these bodies has covert" is a question the player asks
every declaration. The answer is printed in small type on the card art, and —
worse — it can be **granted** by another card, in which case it is not on the
art at all.

## The engine already knew

`BaseCard.hasKeyword('covert')` is the exact test the engine applies. It counts
`AddKeyword` effects against `LoseKeyword` effects, so a granted covert counts
and a removed one does not. It was simply never published.

`DrawCard.hasCovertKeyword()` answers it and `getSummary` carries it to the
client as `hasCovert`.

```ts
hasCovertKeyword(): boolean {
    return this.isInPlay() ? this.isCovert() : this.hasPrintedKeyword('covert');
}
```

The out-of-play branch is load bearing. `parseKeywords` registers every printed
keyword as a **persistent effect whose location is the play area**, so
`hasKeyword('covert')` answers `false` for a covert character sitting in hand or
in a province — where the player still wants to see it. In play the effects are
the truth; out of play the printed keyword is the only truth there is.

### `hasCovert` is not `covert`

The summary already carried a field called `covert`, and it is the **opposite
reading**: that card has BEEN chosen by an opposing covert character and may
therefore not be declared as a defender (`DrawCard.covert`, reset by
`resetForConflict`, checked in `canDeclareAsDefender`). The client greys such a
card with a `covert` CSS class.

So on the covert attacker `hasCovert` is true and `covert` is false; on the
character it strips, both are the other way round. Pinned in
`test/server/integration/covertkeyword.spec.js`.

### A conditional grant comes and goes

Adept of the Waves grants covert with `condition: () => isDuringConflict(el)`,
and `Effect.checkCondition` **cancels** a conditional effect's targets while the
condition is false. So `hasKeyword` — and the badge — is false outside the
matching conflict and true inside it.

That is the right answer rather than a quirk: the badge should show when covert
can actually be used. Pinned in the same spec.

## The client

`CovertBadge` renders `/img/covert.png` on the left edge of the card's
on-screen footprint, under where the printed skill scrolls sit, at roughly their
width — about half the size of the "card used" badge.

Same rotation rule as that badge: it is a **sibling of the card image**, so a
bowed card (whose `.card-image` is rotated 90 degrees inside an unchanged
`.card.horizontal` box) never rotates the badge with it. On a bowed card the
printed scrolls are no longer on the left edge, so the badge moves to the
top-left corner via `--covert-badge-top`, clear of the bottom-left "card used"
badge. Both badges can show at once.

`--covert-size` is set per card size (10/13/17/22/26px) rather than as a
percentage, for the same reason `--card-used-size` is. It carries
`ignore-mouse-events` so it cannot swallow a click, and is suppressed on a
facedown card.

The source art is 1254x1254 with an alpha channel already; it is stored trimmed
and resized to 64x64 (186 KB -> 1.5 KB), since it never renders above 26px.
`public/*` is gitignored with a `!public/img` exception, so the asset is tracked.

## The bot

Nothing. No policy, playbook or tactics module reads `hasCovert` — the bot
already asks the engine directly through `canDeclareAsDefender` and
`legalDirectCardUuids`.

**Measured bit-identical**: `tools/selfplay/refactorIdentity.js` produces the
same slate with and without the published field, including identical winners,
round counts, step counts and win reasons. The bot's own loop-stall signature is
built from prompt titles, not from a serialized board, so an extra summary key
cannot perturb it.

## Tests

- `test/server/integration/covertkeyword.spec.js` — printed covert in play and
  in hand, a character without it, covert granted by an attachment
  (Infiltrator's Tools), covert granted CONDITIONALLY (Adept of the Waves)
  before and during the matching conflict, `hasCovert` against the `covert`
  field on both sides of a real covert declaration, the wire format from
  `game.getState` for both seats, and a facedown card publishing nothing.
- `test/client/Card.spec.tsx` — the badge renders only when asked, on bowed and
  unbowed cards, never facedown, is not raised by the `covert` field, does not
  swallow clicks, and coexists with the "card used" badge.
