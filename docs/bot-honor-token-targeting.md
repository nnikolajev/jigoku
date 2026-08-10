# Honor-token targeting: where the token goes, and who picks the sides

Three live-play bugs reported from one session against the Crane Courtier Honor
bot, all in the same area — **who receives an honored token, and which side of
the table gets which half of a split effect**. They are written up together
because two of them share a root cause and the third shares a shape.

Shipped 2026-08-10. Scope: the two honor decks (`craneHonor`, `lionHonor`) and
one field-wide playbook gate. Fifteen of the seventeen registry decks are
bit-identical, verified — see *Measurement*.

## Bug 1 — Shameful Display honored AND dishonored the bot's own characters

Live log:

```
Political Air conflict - Attacker: 15 Defender: 14
Jigoku Bot uses Shameful Display to change the personal honor of Brash Samurai and Brash Samurai
Political Air conflict - Attacker: 15 Defender: 15
```

Both Brash Samurai belong to the bot. One ended honored, the other dishonored,
for a net swing of zero — while `Cunning Negotiator` and `Doji Challenger` sat
in the conflict as legal enemy dishonor targets.

### Root cause: a prompt that carries TWO game actions

`ShamefulDisplay.ts` selects **exactly two participating characters in one
prompt**, and declares both effects on that single target:

```ts
target: {
    mode: TargetModes.Exactly,
    numCards: 2,
    cardCondition: (card) => card.isParticipating(),
    gameAction: [AbilityDsl.actions.honor(), AbilityDsl.actions.dishonor()]
}
```

`JigokuBotController.currentTargetHint` flattens that into
`gameActions: ['honor', 'dishonor']`. The prompt is therefore **not** an
honor-target prompt — it chooses the two SIDES, and a later menu decides which
one is honored.

`JigokuBotPolicy.polarityTargetDecision` already had a dedicated
Shameful Display handler that got this right: own participant first, enemy
participant second. But when the Crane Courtier Honor deck shipped it added an
honor-token ranker roughly a thousand lines EARLIER in the same function:

```ts
const honorSources = ['way-of-the-crane', 'court-games', ..., 'shameful-display', 'tsuma'];
if(honorSources.includes(String(targetHint.sourceCardId)) &&
    actionNames.includes('honor') && mine.length > 0) {
    const target = craneHonor.pickHonorTarget(mine);      // always one of OURS
```

`actionNames.includes('honor')` is true for the two-card select, so this block
answered it — twice — and returned an own character each time. The follow-up
menu then honored one of the two and dishonored the other, both ours. The Lion
Honor block below it had the identical list and the identical bug.

**The earlier fix for this was never removed. It was jumped over.** That is the
general hazard: a deck overlay inserted ahead of a card's own handler silently
takes ownership of every prompt whose action list merely *contains* the action
the overlay cares about.

### Fix

A prompt that resolves an honor **and** a dishonor is not an honor-target
prompt. `isPureHonorPrompt` requires `honor` without `dishonor`, so the deck
rankers now only see single-action prompts — including Shameful Display's own
`'Choose a character to honor'` follow-up, where the deck ordering is still
exactly what should decide. The two-card select falls through to the card's
handler, which splits the sides and now routes its OWN pick through the deck
ranker as well, so nothing about the deck's preferences is lost.

Checked against every other card in both `honorSources` lists: Shameful Display
is the only one declaring a combined `[honor(), dishonor()]` array. Court Games
looks similar but uses `TargetModes.Select` with `choices`, so its target step
carries no `gameAction` at all and each branch's `selectCard` prompt carries a
single action.

## Bug 2 — Soul Beyond Reproach honored a bowed character sitting at home

Live log:

```
kingitus passes
Jigoku Bot plays Soul Beyond Reproach to Kakita Asami, then it again
Political Air conflict - Attacker: 7 Defender: 1
```

The defender skill did not move. Kakita Asami was **bowed** and **not in the
conflict**; the only participant was a Brash Samurai.

### Root cause: a printed priority list with no sense of "now"

`CraneHonorTactics.pickHonorTarget` sorted by `honorTargetPriority` FIRST, and
`kakita-asami` is index 0 of that list. `inConflict` and `bowed` existed only as
tie-breakers below glory, so they were never reached. Both a bowed character and
one at home contribute no skill, so the token's glory converted to exactly
nothing.

A second, independent miss on the same card: **Soul Beyond Reproach honors the
same character twice.** On a plain body the second honor is a no-op; on a
**dishonored** body it is dishonored → plain → honored, a double glory swing.
Nothing in the ranker knew that, so it never steered toward a dishonored target.

(The priority list's comment justified Asami's top slot with "drains an honor
every political conflict she wins" — but her Action reads neither honored nor
participating, so the token does not enable it. The list is unchanged; it simply
no longer outranks whether the token does anything.)

### Fix

A live-swing tier ahead of the printed list, in **both** honor decks:

```ts
private honorUrgency(card, opts) {
    const liveNow = !!opts.activeConflict && !!card?.inConflict && !card?.bowed;
    const doublePays = !!opts.doubleHonor && !!card?.isDishonored;
    return (liveNow ? 0 : 2) + (doublePays ? 0 : 1);
}
```

Ready participant + dishonored `0` < ready participant `1` < home dishonored `2`
< home plain `3`; the deck's priority list breaks ties inside each tier. Outside
a conflict no body is "live", so every candidate scores the same and the printed
ordering decides on its own, exactly as before.

`doubleHonor` is driven by `DOUBLE_HONOR_SOURCE_IDS` (`soul-beyond-reproach`).

## Bug 3 — Elegance and Grace readied two characters with nothing left to do

Reported without a saved state: the card was spent to ready two characters after
every conflict of the round had resolved, with Doji Hotaru already ready for the
Imperial Favor.

The playbook gate was `some(bowed && isHonored)`, and the entry carries
`abilityValue: true`, which is the escape hatch that lets a **zero**-contribution
card be played at all. Nothing checked that the ready could still be used.

Readying pays in exactly three places, and the gate now requires one of them:

1. a bowed **participant** — a bowed character contributes no skill, so readying
   it swings the conflict being fought;
2. a conflict of **ours** still to declare;
3. a conflict of **theirs** still to declare — the readied body is a defender.

Case 3 needed `PlaybookContext.opponentConflictsRemaining`, which did not exist;
our own count cannot answer "is a ready body worth anything". Without it the gate
would refuse a legitimately good defensive ready.

The Imperial Favor is claimed on **glory**, not on ready characters, so it is not
a fourth case.

## Measurement

Per `.claude/skills/roundrobin/SKILL.md`. All three fixes are `DeckProfile`
switches — `shamefulDisplaySplitSides`, `honorTargetLiveSwing`,
`eleganceRequiresUse`, all defaulting to the fixed behaviour — so the **pre-fix
bot is an injectable arm** and no arm is an edit.

### Null arm, and the reachability census

`probePaired.js`, knobs injected at their own defaults, 3 bases, 816 games:

```
winner flipped              0 (0.0%)
same winner, different path 0 (0.0%)
game completely unchanged   816 (100.0%)
```

**Bit-identical**, which is stronger than the required 50.00%.

The `off` arm on the same 816 games diverged in **23 games, every one of them on
CraneHonor or LionHonor**. Fifteen decks untouched. That is the wiring proof and
the scope proof in one census — and it is why the FIELD-WIDE number is small:

```
CEILING: flipping 1.5% of games caps the win-rate effect at 0.74pp.
```

Under the ±2.5pp noise floor, so a 17-deck head-to-head round robin **cannot
resolve this** and was not run. The resolvable question is the per-deck one.

### Per-deck win rate — the result

`deckFieldWinRate.js`, six bases (91001-96001), GPB=2, 384 games per arm,
`WORKERS=14`. The injected null is the control, not the no-profile run
(the documented `_fieldWorker.js` pass-through delta; here exactly **1 game** on
each deck, 64.32 vs 64.58 and 58.85 vs 58.59).

| Deck | pre-fix (`off`) | fixed (null) | Δ |
|---|---:|---:|---:|
| **CraneHonor** | 59.64% | **64.58%** | **+4.94pp** |
| **LionHonor** | 55.47% | **58.59%** | **+3.12pp** |

Both seats improve on both decks (CraneHonor 61.46→64.58 and 57.81→64.58;
LionHonor 57.81→63.02 and 53.13→54.17), so this is not a first-player artefact.

The paired probe agrees on magnitude from a different rig: pooled over both
seats and 3 bases, 23 decided flips split **15 to the fixed bot, 8 to the
pre-fix bot**, worth roughly +5.2pp on CraneHonor and +2.1pp on LionHonor. Two
rigs on the same bases are not independent evidence, but the numbers are
coherent.

### Card usage

`auditCards.js` after the change — the Elegance gate is the one that could have
made a card dead, and did not:

| Deck | Plays | Zero-use | Abilities | Stalls |
|---|---|---:|---|---:|
| CraneHonor (24 games) | 27/27 | 0 | 17/17 | 0 |

## Follow-up: the dynasty ranker reads stats that do not exist — MEASURED AND REJECTED

The LionHonor card audit reads **28/30 plays**, with `righteous-samurai` and
`implacable-magistrate` as reachable zero-use — both marked *seen* (they reached
a province) and never bought. The cause is a real bug, and fixing it made the
bot WORSE. Both halves are worth keeping.

### The bug

`LionHonorTactics.dynastyValue` scores a candidate as
`military*0.75 + political*0.5 + glory*1 + ability`, and
`CraneHonorTactics.dynastyValue` as `political*w + glory*w + ability`. A card
sitting face-up in a PROVINCE has **no skill or glory summary** — the engine
fills those only for cards in play — and no printed `military` / `political` /
`glory` field either. Wrapping the live picker over 16 games / 156 dynasty
windows:

```
id                          seen  affordable  BOUGHT   value  mil/pol/glory | summaries
righteous-samurai             24          24       2        3  undefined/undefined/undefined | undefined/undefined/undefined
implacable-magistrate         41          38       1        4  undefined/undefined/undefined | undefined/undefined/undefined
bushido-adherent              64          57      13        4  undefined/undefined/undefined | undefined/undefined/undefined
```

The `value` column is exactly `dynastyAbilityValueById` and nothing else, so
**`dynastyMilitaryWeight` / `dynastyPoliticalWeight` / `dynastyGloryWeight` are
dead knobs in this path** and the buy order is the ability table divided by cost.
That produces the two victims precisely:

- **Righteous Samurai** — ability 3, cost 3 → `3 + 2·3/4 = 4.50`, **last of 12**.
  Its printed 4/2/2, the best military line at its cost, is invisible.
- **Implacable Magistrate** — ability 4, cost 3 → `6.00`, a five-way tie with
  Bushido Adherent, Hero of Three Trees, Ardent Omoidasu and Kitsu Spiritcaller.
  Ties break on cost (equal) then `byUuid`, and uuids are creation-ordered, so
  **decklist position wins that tie the same way every game**.

The exact printed values already exist on
`JigokuBotController.dynastyCharacterInfo` and the board-aware path consumes
them (`JigokuBotPolicy.ts:7042`); the honor decks sit on
`fateAwareDeckDynastyPreference`, which is handed only a cost map.

### The fix, and why it lost

Threading the map in (`DeckProfile.dynastyPrintedStats`) works and is reachable
— 150 of 152 windows receive it, and buying moves: Righteous Samurai 2 → 5,
Implacable Magistrate 1 → 2, Bushido Adherent 13 → 22, Chronicler of Conquests
(0/2/1) 23 → 16. It also measures **negative on both decks**.

`deckFieldWinRate.js`, 384 games per arm per base set:

| Deck | arm | search 91001-96001 | fresh 120001-125001 | pooled (768) |
|---|---|---:|---:|---:|
| CraneHonor | ability-only | 63.28% | 65.89% | **64.58%** |
| CraneHonor | printed stats | 62.24% | 62.24% | **62.24%** |
| CraneHonor | Δ | −1.04pp | −3.65pp | **−2.34pp** |
| LionHonor | ability-only | 58.59% | 56.25% | **57.42%** |
| LionHonor | printed stats | 53.13% | 57.55% | **55.34%** |
| LionHonor | Δ | −5.46pp | +1.30pp | **−2.08pp** |

**The reason is calibration, not correctness.** `dynastyAbilityValueById` was
hand-tuned in a world where `ability` was the only term that survived, so those
3-6 numbers had absorbed the entire body-quality judgement. Switching the skill
terms on does not add information to a calibrated model — it re-weights a table
fitted to the broken input. Akodo Toturi goes 6 → 15 and starts taking windows
from the cheap wide bodies both honor plans are built on.

Shipped `false`. The plumbing is kept because the code reading is right and a
re-fit needs it; **do not flip it without re-fitting `dynastyAbilityValueById`
for both decks in the same change.**

Two method notes from this run:

- **LionHonor flipped sign between base sets** (−5.46pp then +1.30pp) on an
  unchanged lever. Six bases, and the pooled answer is the only honest one.
- **An unexplained 5 games.** CraneHonor's ability-only arm reads 63.28% on the
  search bases, where the identical behaviour measured 64.58% earlier the same
  day on the pre-plumbing build. LionHonor reproduced its earlier arm
  **exactly** (225-159 both times), the local `skillOf`/`gloryOf` helpers are
  byte-identical to the shared ones the new code calls, `dynastyValue` has one
  caller, and `configurationHash` does not feed any seed. Not explained. It does
  not change the verdict (Crane is negative on both base sets either way), but
  it is a live reminder to re-run a baseline in the same build rather than
  comparing across builds.

## Traps this produced, worth carrying forward

- **A deck overlay placed ahead of a card's own handler owns every prompt whose
  action list merely CONTAINS its action.** Gate an overlay on the prompt shape
  (`honor` and not `dishonor`), not on membership alone, or a card whose effect
  splits across both sides of the table will be answered as if it were one-sided.
- **A printed priority list is not a decision.** It says which card is the best
  home for a token in the abstract; it cannot say whether the token does anything
  this instant. Rank by what converts NOW, and let the list break ties.
- **`abilityValue: true` disables the zero-contribution veto.** Any entry
  carrying it needs a `shouldPlay` that can answer "would this accomplish
  anything", because nothing downstream will.
- **A change scoped to 2 of 17 decks has a field-wide ceiling ~8x smaller than
  its per-deck effect.** Measure the ceiling first and pick the rig from it: a
  +4.94pp deck effect is a 0.29pp field effect, which no round robin can see.
- **A hand-tuned weight table silently absorbs whatever its inputs were doing.**
  `dynastyAbilityValueById` was fitted while the skill terms read `undefined`,
  so it had become the whole model. Repairing the input without re-fitting the
  table is a regression, not an improvement — when a correctness fix measures
  negative, check whether something downstream was calibrated around the defect
  before concluding the fix is wrong.
- **Confirm a baseline inside the build you are testing.** Comparing an arm to a
  number measured on an earlier build cost a full round of confusion here over
  5 games that are still unexplained.

## Related

- `docs/bot-crane-honor.md`, `docs/bot-lion-honor.md` — the two affected decks.
- `.claude/skills/roundrobin/SKILL.md` — the measurement method.
