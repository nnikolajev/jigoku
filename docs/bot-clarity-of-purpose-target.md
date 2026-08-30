# A lasting effect is not bought twice for the same body

**SHIPPED field-wide. Correctness class — no win-rate measurement was run and
none is wanted.** The ceiling is a handful of wasted cards per thousand games;
see "Why there is no number" below.

## The defect

Live replay 2026-08-30, `game replays/debug/2026-08-30_kingitus_s_game_Jigoku_Bot-Phoenix_Clan_vs_kingitus-Crane_Clan.json.gz`,
round 3 conflict 1:

```
Jigoku Bot plays Clarity of Purpose to prevent opponents' actions from bowing Feral Ningyo ...
kingitus plays Disparaging Challenge to initiate a [political] duel : Doji Kuwanan vs. Ethereal Dreamer
Jigoku Bot has chosen a bid.
...
Duel Effect: move Ethereal Dreamer into the conflict
Jigoku Bot uses Kyūden Isawa, bowing Kyūden Isawa and discarding Against the Waves to play a spell event from discard
Jigoku Bot plays Clarity of Purpose from their conflict discard pile
Jigoku Bot plays Clarity of Purpose to prevent opponents' actions from bowing Feral Ningyo ...
```

Both clauses of Clarity of Purpose last until the conflict ends, so the second
copy bought nothing. Ethereal Dreamer — moved into the same conflict by the duel
two lines earlier — was standing unprotected the whole time. The recursion cost
Kyūden Isawa's bow and a discarded Against the Waves on top of the card itself.

## Two independent holes, both closed

### 1. The board does not say who already has it

`JigokuBotPolicy` already kept a `clarityProtectedUuids` set, but it was pure
bot-side memory of targets it had clicked. Nothing in the serialized player
state names the **source** of a lasting effect: a character summary publishes
`bowed`, its skills and its attachment ids, and a conflict-duration effect is
not an attachment.

So read it from the ENGINE. `JigokuBotController.lastingEffectSourceIdsByUuid()`
walks `game.effectEngine.effects`, skips `Durations.Persistent` (a persistent
effect is a card's own printed text, which a second copy of a *different* card
does not duplicate) and reports, per character uuid, the printed ids of the
cards applying a lasting effect to it.

Two engine properties make this exact rather than approximate:

- **Conditional halves report themselves correctly.** Clarity registers two
  effects. `doesNotBow()` is conditional on `game.isDuringConflict('political')`;
  `cardCannot({ cannot: 'bow', restricts: 'opponentsCardEffects' })` is not.
  `Effect.checkCondition` **cancels** a conditional effect's targets while its
  condition is false, so in a military conflict the political half correctly
  drops out — and the unconditional half is what keeps the protection visible on
  both axes. This is also why `noBowCharacterUuids` (which reads
  `DrawCard.bowsOnReturnHome()`, i.e. `anyEffect(DoesNotBow)`) could **not** have
  answered this: it goes blind in exactly the military conflict where the card
  still has a live clause.
- **The engine owns the lifetime.** A `untilEndOfConflict` effect is removed on
  `OnConflictFinished`, so the report needs no conflict-scoping of its own and
  cannot go stale.

### 2. A duel wipes the bot's own memory mid-conflict

`HonorBidPrompt` uses **one `promptTitle`** — `'Honor Bid'` — for the draw-phase
bid *and* for a duel bid. Only `menuTitle` differs (`'Choose how much honor to
bid in the draw phase'` vs `'Choose your bid for the duel...'`).

`JigokuBotPolicy` treats `promptTitle === 'Honor Bid'` as the round boundary and
resets its per-round latches there. A duel therefore ran that reset **in the
middle of a conflict** and cleared `clarityProtectedUuids` — which is precisely
what the replay shows, because Disparaging Challenge sat between the two Clarity
plays.

The clarity reset is removed from that block. `syncClarityConflict` already owns
the lifetime: it clears on any conflict-key change and whenever no conflict is
running, which covers the draw phase the block fires in.

> The same block still resets `wayOfPhoenixUsedThisPhase`,
> `kachikoReplaysThisRound`, `boardAbilityUsed`, `shunsenRingsReturned` and the
> other per-round latches on a duel bid. That is the same defect on other
> switches and is **not** fixed here — it changes once-per-round behaviour
> field-wide and deserves its own change.

## Where the rule is applied

`JigokuBotPolicy.clarityProtectedUuidSet()` is the union of the engine read
(copies that have **resolved**) and the in-flight bot memory (the copy whose
target has been clicked but whose effect has not been applied yet — a cost
prompt sits in that gap). Either source alone leaves a hole.

Three consumers, because Clarity can be reached three ways:

| Site | What it does |
| --- | --- |
| `polarityTargetDecision`, `clarity-of-purpose` branch | drops protected bodies from the target list; falls back to `clarity-of-purpose-no-participant` (cancel) when none is left |
| `CardPlaybook` `clarity-of-purpose.shouldPlay` (via `playbookContext`) | holds the card when no unprotected ready participant exists |
| `clarity-urgent-bow-protection` | the same test, because this branch runs **before** the playbook gate |

`clarityOfPurposeValue` in `SupportValueModel` drops protected bodies from its
candidate list too, so the value model prices a second copy off the *next-best*
body instead of re-buying protection that is already there.

## Why there is no number

The card is one deck's, the window is one conflict, and the waste needs a
recursion effect (Kyūden Isawa) or a second copy drawn into the same conflict.
This is the same class as `polarityGuards`, `attachmentTarget` and
`moveIntoConflict`: a correctness fix with a ceiling far under the ±2.5pp noise
floor. **Do not re-measure it hoping for a number.**

## Tests

- `test/server/integration/botlastingeffectsource.spec.js` — real game, real
  registered Effects, real controller. Covers: nothing reported before an effect
  lands; the source named on the resolved body and only that body; two copies on
  two bodies reported separately; the report dropped when the conflict ends; and
  the military case where the `DoesNotBow` half is switched off but the card is
  still reported.
- `test/server/bots/clarityofpurposetarget.spec.js` — policy behaviour. Covers
  the target prompt, the play gate, the urgent-bow path, the value model, the
  duel-`Honor Bid` regression, and two negative controls (a lasting effect from
  a *different* source is ignored; the memory still clears between conflicts).

7 of the 9 policy specs fail against the pre-fix build; the 2 that pass are the
negative controls, which assert unchanged behaviour.
