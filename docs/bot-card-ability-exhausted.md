# "Ability already used" — published by the engine, shown to the player

**SHIPPED.** A card in play whose every limited ability is spent shows a badge
in the bottom-left corner, and the bot reads the same flag.

## The problem

A card whose ability is spent looks exactly like one that is ready. Clicking it
does nothing — `CardAbility.meetsRequirements` returns `'limit'` and the click
is silently dropped — so the player has no way to tell the two apart, and has to
remember what they used this round.

The bot had the same blind spot from the other side. `JigokuBotPolicy` kept its
own `boardAbilityUsed` ledger: a count of what the BOT believed it had spent,
with the ceiling priced from a `CardPlaybook` convention (`oncePerRound`) rather
than from the card.

## The engine already knew

`AbilityLimit.isAtMax(player)` is the exact test the engine applies before
allowing an activation. It was simply never published.

`BaseCard.abilitiesExhausted()` answers it, and `getSummary` carries it to the
client and to the bot as `abilitiesExhausted`.

Three deliberate choices:

- **ALL limited abilities, not any.** A card whose Action is spent but whose
  reaction is still live can still be used; reporting it as used would be wrong.
- **An unlimited limit is never at max**, so a card holding one never reports
  exhausted — which falls out of the rule above rather than needing a special
  case.
- **Keyword abilities are excluded** (Covert, Pride, ...). They are not
  activated by clicking the card and have no per-period budget.

Limits are counted PER PLAYER (`AbilityLimit` keys its use count by player
name), so the question is asked for the card's **controller** — the seat whose
click the badge is about.

`isInPlay()` gates it, so a card in hand, in a discard pile, or facedown never
reports exhausted. Imperial Storehouse is the instructive case: its cost is
`sacrificeSelf`, so after use it is in the discard and correctly reports
nothing.

### Limit shapes this has to get right

| Card | Limit | Badge |
|---|---|---|
| most board abilities | `perRound(1)` — the `CardAbility` **default** | after 1 use, until the round ends |
| Spyglass | `perRound(2)`, explicit | only after the **second** use |
| Togashi tower under Way of the Dragon | `perRound(1)` **+1** via `IncreaseLimitOnAbilities` | only after the second use — `getModifiedLimitMax` feeds the modifier into `isAtMax` |
| a `perConflict` ability | resets on `OnConflictFinished` | clears when the conflict ends, not the round |
| `unlimitedPerConflict` / `unlimited` | `Infinity` | never |

Pinned in `test/server/integration/cardabilitylimits.spec.js`.

### An engine divergence this surfaced, NOT fixed here

**Honored Blade** prints no limit clause — "Reaction: After you win a conflict
in which attached character is participating - gain 1 honor" — so by the rules
it should pay out on every conflict won. `TriggeredAbility extends CardAbility`,
which defaults `limit` to `perRound(1)`, so **this engine fires it once per
round**.

The badge therefore appears after one won conflict, which is exactly what the
engine will enforce on the next trigger. That is the badge being honest about
the engine, not the badge being wrong.

Whether Honored Blade (and any other printed-unlimited reaction that inherits
the default) should take `unlimitedPerConflict()` instead is a **rules change**
with bot and win-rate consequences, and is deliberately out of scope here.

## The client

`CardUsedBadge` renders `/img/card-used.png` in the bottom-left of the card's
on-screen footprint.

The bowed case is the one worth stating. A bowed card keeps the same outer box
(`.card.horizontal`) and rotates only its IMAGE (`.card-image.bowed`,
`transform: rotate(90deg)`). The badge is a **sibling of the image**, so it
never inherits that rotation: it stays in the same corner and the same way up
whether the card is bowed or not. Bowing and exhaustion are independent axes —
a bowed card can have an unspent ability and a ready card can be spent — so the
badge must not be confused with the bowed state.

`--card-used-size` is set per card size rather than as a percentage, so the
badge stays legible on a small card and does not swallow a large one. It carries
`ignore-mouse-events` so it cannot swallow a click aimed at the card, and is
suppressed on a facedown card.

The source art is 1240x1240; it is stored resized to 96x96 (2.2 MB -> 6.4 KB),
since it never renders above 52px. `public/*` is gitignored with a `!public/img`
exception, so the asset is tracked.

## The bot

`boardAbilityIsUsed` consults `abilitiesExhausted` **first**, then falls back to
its own ledger. The engine flag is strictly better than the ledger:

- it knows the real **period**, so a `perConflict` ability is available again
  next conflict without the bot modelling that;
- it knows limit **modifiers**, so Way of the Dragon's second use is already
  counted — the case where a naive "one use and done" flag would have COST the
  deck an ability;
- it sees abilities **gained** from another card.

**Direction matters: it is only ever used to say "cannot", never "can."** A card
the engine reports exhausted would refuse the click anyway, so this can only
remove wasted decisions and can never unlock or take away a use. The ledger
stays for the bot's own conventions and for synthetic contexts with no summary,
and the gate accepts only a literal `true` — anything else means the field was
not understood, and guessing "used" would silently disable a card.

## Measured

**Bit-identical.** `tools/selfplay/refactorIdentity.js` over six shuffle bases
(77001, 81001, 85001, 89001, 93001, 97001) plus the omniscient slate — 7 hashes,
~112 full games — produces the same hash with and without the change, including
identical winners, round counts, step counts and win reasons.

So V1 never proposed a click on an exhausted card in that corpus: its own ledger
already covered those cases, and the engine flag is a correctness backstop
rather than a behaviour change. **A head-to-head would be a null arm by
construction**, which is why one was not run for the bot half — `refactorIdentity`
is the stronger check, and the one the `/roundrobin` skill prescribes for a
code-level change with no knob.

No measurable cost: the identity slate ran 44.6s with the change and 46.0s
without, despite `abilitiesExhausted()` being computed on every card summary.

## Tests

- `test/server/integration/cardabilityexhausted.spec.js` — the flag on a
  persisting holding, a character (with bowing as an independent axis), a
  stronghold, an attachment and a province; plus cards that must never show it
  (no limited ability, in hand, facedown).
- `test/server/integration/cardabilitylimits.spec.js` — the limit shapes above.
- `test/server/bots/boardabilityexhausted.spec.js` — the bot gate, including
  that it never takes away a use the ledger still allows, and that a missing or
  non-boolean field leaves the old path untouched.
- `test/client/Card.spec.tsx` — the badge renders only when asked, on bowed and
  unbowed cards, never facedown, and does not swallow clicks.
