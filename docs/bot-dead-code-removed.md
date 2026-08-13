# Bot code removed in the 2026-08-13 cleanup

Everything listed here was **unreachable** — not knob-disabled, not
deck-scoped, not rarely-fired: no runtime path reached it at all. Each removal
was verified before deletion and the whole set was proved behavior-neutral by
`tools/selfplay/refactorIdentity.js` on three independent shuffle bases, plus
the full 11,325-spec suite.

This file exists so that a mechanism deleted here can be **reintroduced
deliberately and measured**, rather than rediscovered by accident. Nothing
below was ever wired in, so nothing below has a measured win-rate effect.
Reintroducing any of it is a behavior change and needs the `/roundrobin`
treatment: a decisiveness ceiling first, then a multi-base head-to-head on
both seats against a validated null arm.

## Method

Candidates came from `npx fallow dead-code --unused-class-members`
(fallow 3.15.0) over a `.fallowrc.json` that seeds the real entry points.
Because fallow's type-aware companion does not run on Windows
(`failed to spawn ... os error 193`), each candidate was then re-checked with
the TypeScript LanguageService (`getReferencesAtPosition`), which is
receiver-aware and so distinguishes `LionDuelistTactics.pickHoldingTarget`
from an identically-named method on another tactics class. Specs and the
self-play tools require the **compiled** `build/*.js`, so they never appear in
the TS program; those were matched separately, scoped to files that import the
module in question.

Verdicts: 29 unreferenced, 16 referenced only by a spec, 2 referenced only by
the measurement tools (**kept** — that is the probe API), 44 live.

---

## 1. LM Studio LLM subsystem

The bot could send card text to a local LM Studio server, cache the returned
per-card hints, and consult the model live on ambiguous target prompts. It was
`enabled` by default in `server/env.ts`, but **no seed selected it** — the
client's three strategy seeds (mixed / dynasty focused / board-aware dynasty)
are all heuristic, and hidden information is a separate checkbox. In practice
it was a default-on network call to a server that is usually not running.

| Removed | LOC | What it did |
|---|---|---|
| `bots/llm/LmStudioClient.ts` | 100 | HTTP client for the OpenAI-compatible endpoint; `extractJson` stripped `<think>` blocks and prose from model output |
| `bots/llm/DeckHintService.ts` | 206 | Analysis queue + on-disk hint cache, with a per-deck manifest so a fully analyzed deck skipped the model entirely |
| `bots/llm/LiveConsultant.ts` | 46 | Asked the model to choose among selectable targets on `choose-card` / `guessed-*` decisions, with the heuristic pick as timeout fallback |
| `bots/llm/rulesPrimer.ts` | 33 | Distilled Imperial-format rules text prepended to every prompt |
| `bots/llm/CardHints.ts` → `validateCardHint` | 20 | Lenient parser that defaulted every field of a malformed model answer |

Also removed: `JigokuBotLlmConfig` and the `llm?` field
(`JigokuBotConfig.ts`); `botLlm` and the five `BOT_LLM_*` environment
variables (`server/env.ts`); the `llm:` wiring in `server/lobby.js`; and in
`JigokuBotController.ts` the `hintService` / `consultant` / `consultPending` /
`warmupStarted` fields, `ensureWarmup`, `startConsult`, `consultCandidates`,
`consultSummary`, and the tick-time consult branch (158 lines).

**Kept**: the `CardHint`, `UseWhen`, `TargetSide`, `TargetPreference` types,
moved to `bots/CardHintTypes.ts`. They are not LLM-specific any more —
`PlaybookEntry extends CardHint`, so the 5,500-line hand-written playbook and
the ~86 hint call sites in `JigokuBotPolicy.ts` are all built on this shape.

The behavioral surface was one line:

```ts
cardHint: (cardId) => getPlaybookEntry(cardId, strategy) || this.hintService?.getHint(cardId)
```

Only the right-hand fallback is gone. Self-play and the specs never
constructed the LLM (`config.llm` was undefined in `harness.js`), so the
identity gate was bit-identical by construction; the change is visible only to
a live game run against a reachable LM Studio server, on a card with no
playbook entry.

---

## 2. Unreachable tactics methods (45 members, 359 lines)

These are per-deck tactics helpers that were written, in several cases
carefully documented and spec'd, and then never called from
`JigokuBotPolicy` or anywhere else. This is the same defect class CLAUDE.md
already records twice — `BoardAwareDynastyTactics.choose` and
`ConflictPhasePlanner.planDefense` are inert for V1 and a passing spec hid it.
A green spec proves a function computes what it claims; it says nothing about
whether the bot ever asks.

**The card knowledge is not lost** — the printed-card reasoning is preserved in
each method's comment, quoted below where it is worth keeping.

### `BidWarTactics` (Scorpion Kyūden Bayushi bid-war deck) — 10

| Member | What it did |
|---|---|
| `honorCeiling` (get) | exposed `profile.honorCeiling`; call sites read the profile directly |
| `canPayHonor` | honor-payment floor. `DishonorTactics.canPayHonor` is the one the policy actually calls |
| `inBand` | `myHonor <= honorCeiling` |
| `makeAnOpeningValue` | priced Make an Opening at the absolute dial difference (it is −X/−X on THEIR participant, dead at X=0) |
| `canSwim` | I Can Swim legality: our dial strictly higher **and** a dishonored enemy participant |
| `regalBearingDraw` | priced Regal Bearing's draw as `abs(1 - theirBid)` |
| `pickStrongholdReadyTarget` | Kyūden Bayushi: ready the highest-skill bowed **dishonored** body, else a ready participant for the band bonus |
| `kachikoDesiredAdditionalFate` | extra fate for Kachiko-critical characters |
| `reverseHonorCardIds` (get) | exposed `profile.reverseHonorCardIds` |
| `shouldDig` | dig gate: inside the honor band **and** a small hand |

### `CrabSacrificeTactics` (Castle of the Forgotten) — 9

| Member | What it did |
|---|---|
| `isBerserker` / `isButcher` / `isDire` | card-class predicates off trait or profile id list |
| `desiredAdditionalFate` | per-character extra-fate table lookup |
| `sacrificeWorthIt` | `sacrificeCost(card) <= payoff` |
| `shouldSaveLeavingCard` | **the Iron Mine inversion.** Never save a body we are ourselves spending as a sacrifice cost: the save cancels the cost, the cost is then unpaid, and the ability we were paying for does not happen — the holding is spent for nothing. Saves exist to answer the *opponent's* removal. (This rule is documented in `bot-crab-sacrifice.md` and is enforced elsewhere; only this helper was unused.) |
| `wayOfTheCrabValue` | priced Way of the Crab off their **worst** body, since they choose — which is what makes it a tower answer: against one big character they have no cheap out |
| `shouldTakeMercenaryControl` | whether to pay 1 fate to take control of a mercenary |
| `shouldBlankTaintedHero` | Tainted Hero cannot be declared until its own Action blanks its text, and that Action costs a friendly body — so it must happen *before* declaration |

### `CraneHonorTactics` (Seven Fold Palace) — 5

`honorToVictory`, `canSpendHonor` (voluntary-payment guard above the shared
`honorRace` limits), `pickHonorTarget`-adjacent `shouldPlayElegance`,
`isAirProvince`, and `shouldPlayFestival` — the last of which encoded that
Festival for the Fortunes honors **every** character, theirs included, so it
only pays while we field more bodies than they do.

### `LionHonorTactics` (Kyūden Ikoma honor race) — 4

`honorToVictory`, `canSpendHonor`, `isHonorProvince`, and `battlefieldInPlay`
(Chronicler of Conquests' condition, checked through province attachments as
well as provinces).

### `LionDuelistTactics` — 3

`shouldUseStronghold`, `shouldRecur`, and `pickDynastyEvent` — the last held
the Honored Veterans condition (a Bushi **bought this phase**, unhonored, with
glory) and the A Season of War reroll condition (provinces spent, fate to
spare).

### `RebirthTactics` (Phoenix Fushichō) — 4

`pickDreamerRing`, `shouldUseAncestralShrine`, `bentenNetGain`, and
`shouldFloodForRetire` — the last encoded that Retire to the Brotherhood wipes
every fateless character on **both** boards and refills from the top of each
deck, which costs this deck nothing it was not already spending (its bodies are
fateless by design) while their paid-for bodies die.

### Others — 10

- `CraneBaselineTactics.isBaselineDeck`, `DuelBidTactics.chooseBid` (a
  one-line wrapper over the live `analyze`), `UnicornRevealTactics.opponentFacedownNonStronghold`,
  `SharedCardTactics.ConflictRecursionTactics.shouldRecur`.
- V2 introspection accessors: `CardSemantics.effectsFor` / `coverage` /
  `hash`, `DeckSynergies.profileIds`, `IntentManager.activeIntent`,
  `ProjectionCache.size`.
- **`v2/allocation/ActionTimingEvaluator.ts`** (42 lines, whole file) — ranked
  candidates by opponent commitment, prevention value, pass initiative and
  minimum-sufficient action. Never constructed outside
  `v2characterallocation.spec.js`; not reachable from V1 or V2.

### Kept despite reading as unused

- `BotTelemetry.attach` / `detach` — the probe API. Its only caller is
  `tools/selfplay/_probeWorker.js`, which loads the **compiled** module, so
  neither fallow nor the TS program sees the edge. Deleting these would have
  silently broken every `probePaired.js` measurement.
- 44 further members that resolve to a live call site, including every
  knob-gated mechanism (`saveFatePass`, `unopposedWindow`, the
  `polarityGuards` fixes). Gated-off is not dead.

---

## 3. Other changes in the same pass

Not deletions, but recorded here because they moved code readers may be
looking for.

- **`v2/` → `shared/` for 8 modules.** `CardValueModel`, `CardValueTypes`,
  `ConflictActionPlanner`, `V2DeckProfiles` and the Duel / Economy / Holding /
  Support value models were imported by V1 at runtime, so they were never
  experimental. `v2/` is now a leaf that no V1 file imports except
  `BotEngineRouter`, and the rule is enforced by `boundaries` in
  `.fallowrc.json` rather than by review. Several of those files carried a
  stale `// V2 ONLY. V1 stays frozen as the measurement control.` header, which
  had stopped being true; those were corrected. See `bot-v2.md`.
- **Documentation.** All 103 bot modules now carry a file header (48 had none).
  About 190 public functions in V1 and `shared/` gained docblocks. The three
  mechanisms known to be inert or delegated — `ConflictPhasePlanner.planDefense`,
  `BoardAwareDynastyTactics.choose`, `ShugenjaTactics.disguisedCost` — are now
  marked as such at the declaration, so the trap is visible where the code is
  rather than only in CLAUDE.md.
- **~9 GB of self-play output deleted** from `tools/selfplay/out/` (727 raw
  `.json` game dumps, 3 `.jsonl`, and `out/tempo/`). None of it was tracked in
  git. The 650 `.md` run reports and the small `.txt`/`.log` summaries were
  kept, so the measurement record survives; only the raw per-game dumps went.
- **Docs.** `heuristic-bot-llm.md` (documented the removed subsystem),
  `heuristic-bot-roadmap.md` (superseded) and
  `seed3-cross-seed-audit-2026-07-21.md` (a dated one-off) were deleted and
  their inbound links repaired. `docs/README.md` is a new index of the
  remaining 41 docs.

## Verification

Run after every phase, not only at the end.

| Gate | Result |
|---|---|
| `npx tsc` | clean |
| Full jasmine suite | 11306 specs, 0 failures (baseline 11325 / 0; the 19 removed specs covered deleted code) |
| `refactorIdentity.js`, bases default / 88001 / 99001 | **byte-identical to baseline**, SHA `e89ed4381553c548` |
| `parallelHeadToHead.js`, 3 bases | 50.00% — the bot is unchanged |
| `fallow dead-code --unused-class-members` | 0 bot findings (was 91) |
| fallow boundary rules | 0 violations, 0 circular dependencies |

The identity gate is the meaningful one. It replays a fixed slate of
cross-deck games and prints winner, rounds, **step count** and win reason for
each; step count diverges on the first changed decision, so an identical dump
across three independent shuffle bases is stronger evidence of behaviour
preservation than any win-rate run could be.
