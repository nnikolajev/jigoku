# The Roar of the Lioness under the stronghold (both Lion honor decks)

**Status: SHIPPED.** Lion Honor **+8.85pp**, Lion Duelist **+6.55pp**, each over
24 independent shuffle bases and ~1525 paired games, both p<0.0001.

## The card

`the-roar-of-the-lioness` (Honor in Flames, Lion, **water**, deck limit 1):

> **Strength: X.** X is equal to half the amount of honor in your honor pool,
> rounded up.

It was already implemented and specced (`server/game/cards/15.2-HiF/`,
`test/server/cards/15.2-HiF/TheRoarOfTheLioness.spec.js`) as a persistent
`modifyBaseProvinceStrength((card) => Math.round(card.controller.honor / 2))`.
No engine work was needed for the strength to track honor live: the effect is
re-evaluated by the effect engine like any other dynamic value, and
`ProvinceCard.getStrength()` picks it up through `sumEffects`.

## The deck change

Both decks published a revision whose ONLY difference is one province.

| deck | old | new | EmeraldDB |
|---|---|---|---|
| Lion Honor | `the-art-of-war` (water, 3) | `the-roar-of-the-lioness` (water, X) | `3a5d87d2` v0.6 (was `65b10e6f` v0.5) |
| Lion Duelist | `the-art-of-war` (water, 3) | `the-roar-of-the-lioness` (water, X) | `105158ff` v0.3 (was `a2058c37` v0.2) |

Both replacements are element-legal drop-ins: The Art of War is also a water
province, so no other province and neither role had to move. The re-imported
card fixtures were diffed against the old ones — **zero drift** on every shared
card record, so the arms differ by exactly one card.

Then the stronghold province moved:

| deck | stronghold province before | after |
|---|---|---|
| Lion Honor | `kenson-no-gakka` | `the-roar-of-the-lioness` |
| Lion Duelist | `frostbitten-crossing` | `the-roar-of-the-lioness` |

**Why that slot.** `ProvinceCard.canBeAttacked` gates the stronghold province on
`getProvinces(isBroken).length > 2`, so it is the province the opponent reaches
LAST — three outer provinces have to break first. That is exactly where a
province whose strength is half your honor pool is largest, because both of
these decks spend the whole game pushing honor up (Lion Honor races to 25; Lion
Duelist bids into a lead from a stronghold that starts at 13). The rule that
made Illustrious Forge wrong for that slot in the Dragon deck — an ON-REVEAL
payoff parked there usually never fires — is the same rule that makes a WALL
right for it.

It also moves each deck's displaced province somewhere it works better:

- **Kenson no Gakka** triggers on *losing a conflict at this province*. An outer
  province offers that all game; the stronghold province offers it only after
  three others break.
- **Frostbitten Crossing**'s Action is conflict-only, so it too wants to be
  revealed earlier.

## The bot fix this exposed

`Effect.isEffectActive()` returns `false` while `this.source.facedown`, so a
facedown province's own persistent effects are switched OFF. Every province in
the field until now printed a fixed strength, so that never mattered. A facedown
Roar reads **strength 0** from the engine.

That is right for the game (a facedown province's ability is not active, and the
province is revealed before its strength is ever consulted in a conflict) and
wrong for the bot: `JigokuBotController.strongholdProvinceStrength` and
`weakestOuterProvinceStrength` read the LIVE card precisely so a still-facedown
own province reports its exact total, and they feed
`StrongholdDefenseTactics.plan` — the last-province survival planner. Without a
fix, a deck whose stronghold province is a 13-strength wall would plan as if it
were a 1-strength one for the entire game.

`JigokuBotController.facedownOwnBaseStrengthDelta` evaluates the suppressed
base-strength effects off the Effect objects the engine has ALREADY registered
for the card (`entry.ref`), handling both `ModifyBaseProvinceStrength`
(additive) and `SetBaseProvinceStrength` (override, priced as a delta against
the printed value). Nothing is constructed and nothing is applied, so the probe
cannot change the game it measures. It is applied only when the card is
facedown, so a faceup province is untouched.

**It is inert for every other deck**: a scan of all 50 province cards in the
field finds `the-roar-of-the-lioness` as the only one with a base-strength
effect of its own, and the build was verified bit-identical to the previous one
across 191 games per deck before the province swap was turned on.

Watched by `test/server/integration/botfacedownprovincestrength.spec.js`.

## Measurement

A deck-CONTENT change cannot be injected as a `SUBJECT_PROFILE`: that path is
not bit-clean (its null arm diverges — see `jigoku-subject-profile-rig-fault`).
So the arms were BUILDS, selected by a temporary `ROAR=off|deck|slot` switch,
and compared with `tools/selfplay/deckFieldWinRate.js` (one deck against the
fixed 16-deck field, both seats on the same shuffle) paired game-for-game by
`tools/selfplay/pairDeckFieldArms.js`.

Three arms:

- **off** — the shipped v0.5 / v0.2 lists, old stronghold provinces.
- **deck** — the new lists, stronghold province UNCHANGED. Isolates the card.
- **slot** — the new lists AND the Roar under the stronghold. Isolates the slot.

**Inertness first.** The new build with `ROAR=off` reproduced the previous build
exactly: 95/95 and 96/96 games bit-identical over three bases per deck.

**Search set** 61001-66001 (6 bases, 383 games/arm). **Confirmation set**
71001-76001 + 81001-86001 + 101001-106001 (18 fresh bases, ~1145 games/arm).
The search bases are burned by construction; the fresh set is the honest read
and the pooled 24 is the number to quote.

### Lion Honor

| arm | search (6) | fresh (18) | pooled (24) |
|---|---:|---:|---:|
| off | 47.12% | 47.38% | 47.34% |
| deck | 48.56% (+1.57pp, p=0.58) | 54.01% (+6.63pp, p=0.0001) | — |
| **slot** | 53.66% (+6.54pp, p=0.0044) | **56.99% (+9.62pp, p<0.0001)** | **56.20% (+8.85pp)** |

Pooled paired flip test, off -> slot: **220 to / 85 away, 305 decided, z=7.73,
p<0.0001**. Positive on **18 of 18** fresh bases and 5 of 6 search bases (one
tie, none negative). `deck -> slot` is a further **+2.88pp, p=0.081** — so the
card is most of the gain and the slot adds on top of it, directionally.

### Lion Duelist

| arm | search (6) | fresh (18) | pooled (24) |
|---|---:|---:|---:|
| off | 40.21% | 37.84% | 38.44% |
| deck | 44.13% (+3.92pp, p=0.15) | 41.03% (+3.15pp, p=0.056) | — |
| **slot** | 48.83% (+8.62pp, p=0.0021) | **43.63% (+5.86pp, p=0.0003)** | **44.99% (+6.55pp)** |

Pooled paired flip test, off -> slot: **276 to / 176 away, 452 decided, z=4.70,
p<0.0001**. Positive on 13 of 18 fresh bases (one tie) and 6 of 6 search bases.
`deck -> slot` is **+2.71pp, p=0.087**.

Note both decks regress from the search set to the fresh one on the `slot` arm
for the Duelist (+8.62pp -> +5.86pp) and improve for the Honor deck
(+6.54pp -> +9.62pp). Quote the pooled number, not either set.

The decisiveness is very high — only 27-49% of games are bit-identical between
arms, ceiling 10-15pp — so this is not a correctness-class knob whose ceiling
sits under the noise floor. It is a real deck change with a real effect.

The shipped build was re-run on three of the fresh bases and matched the
measured `slot` arm **191/191 games identical** for both decks.

### Rebuilding an arm

The `ROAR` build switch was removed on ship. To rebuild the old arm, re-import
the previous decklists (`node tools/selfplay/importEmeraldDeckFixture.js
65b10e6f-afd3-4938-933a-4350ae9ce405 lion-honor "Lion Honor"` and
`a2058c37-5909-4119-bf16-bdddd3a80262 lion-duelist "Lion Duelist"`) and set
`strongholdProvinceId` back to `kenson-no-gakka` / `frostbitten-crossing`. The
stronghold-province half alone is a `DeckProfile` field, so THAT arm is a JSON
string and needs no fixture change.

## Left deliberately unmeasured

`LionHonorTactics.battlefieldProvincePreference` still lists `the-art-of-war` as
its third entry, which no longer names a card in the deck, so Under Amaterasu's
Gaze resolves to Kenson / Before the Throne and then the generic fallback. That
is exactly the configuration that was measured; putting the Roar in that list
would be an unmeasured change stacked on a measured one.

## Related

- `docs/bot-lion-honor.md`, `docs/bot-lion-duelist.md` — the two decks.
- `docs/dragon-attachments-bot.md` — the other stronghold-province swap, and the
  reveal-timing rule that both decisions turn on.
- `.claude/skills/roundrobin/SKILL.md` — the measurement method.
