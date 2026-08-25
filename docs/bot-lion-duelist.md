# Lion Duelist — Kyūden Ikoma honor-switch deck (V1 bot)

EmeraldDB `a2058c37-5909-4119-bf16-bdddd3a80262`. Registry label **`LionDuelist`**.
Fixtures: `tools/selfplay/fixtures/lion-duelist-{decklist,cards}.json`.
Module: `server/game/bots/LionDuelistTactics.ts`. Profile override:
`lion-duelist-kyuden-ikoma` in `server/game/bots/DeckProfiles.ts`.

The fourteenth deck the V1 heuristic bot pilots, and the second Lion list. It
shares almost nothing with the Lion bushi swarm precon (`Lion`, Hayaken no
Shiro): that deck floods cheap bodies and races; this one plays four or five
durable Commanders, moves and readies them into more conflicts than it declared,
and duels the opponent's board flat.

---

## 1. What makes this deck different: honor is a SWITCH

Five of its best effects carry the same printed condition — **"if you are more
honorable than your opponent"**:

| Card | What the honor lead unlocks |
|---|---|
| **Matsu Tsuko** | Winning a conflict she attacks in **breaks the province outright**, whatever its strength |
| **Matsu Agetoki** | Move the contested ring to a different province and reveal it |
| **Matsu Mitsuko** | Move one of our characters into a military conflict |
| **Blade of 10,000 Battles** | Return any card from our conflict discard to hand after a win |
| (dial, indirectly) **Regal Bearing** | Set our dial to 1 and draw the difference |

Two engine facts shape the whole profile:

* **Kyūden Ikoma starts at 13 honor.** The field's strongholds sit at 10–11, so
  the switch is *already on at game start*. The deck does not need to farm honor
  to 22 to turn its cards on — it needs to not lose the lead. The first build was
  designed around the opposite premise (bid 1 forever and climb toward the honor
  win); measurement showed every draw-bid arm is **null**, which is the same
  thing said in numbers. Getting the deck stronger turned out to be about
  *reaching* the cards, not about the dial — see §5.
* **A participating character bows when it returns home.** That is why Kyūden
  Ikoma's stronghold reaction and Kitsu Motso are valued the way they are: bowing
  a body that is *already in the conflict* buys nothing, because it was going to
  bow anyway.

---

## 2. Card-by-card evaluation and what was implemented

`+` = new logic, `=` = reused existing logic, `·` = passive, no bot code needed.

### Stronghold / role / provinces

| Card | Value | Implementation |
|---|---|---|
| `+` **Kyūden Ikoma** | Moderate–high. After a character we control loses a conflict **as attacker**, bow the stronghold to bow a non-Champion character. Free: the stronghold has no competing use for its ready state. | Playbook entry (priority 9, reaction path) + shared `StrongholdBowTactics.pickTarget`, steered in `polarityTargetDecision` (decision reason `stronghold-bow-enemy`). Skips Champions (engine also filters), **bowed** bodies, and **current participants** — all three are worth zero. Ranks by `bodyValue` (skill + 2/fate + 2/attachment), so it takes the body they have invested in. |
| `+` **Keeper of Air** | Low–moderate on its own; **high as a ring signal**. Gain 1 fate after winning an air conflict on defense — and, far more importantly, the AIR element is what Keeper Initiate's reaction keys on. | Existing generic keeper-role entry, plus new ring steering: `LionDuelistTactics.ringBonus` adds `recursionRingBonus` to AIR whenever a Keeper Initiate is sitting in the dynasty discard. The generic `ringScore` has no notion of a ROLE at all, so nothing steered here before. |
| `+` **Frostbitten Crossing** (4) | Moderate. Conflict Action at this province: discard **every** attachment on one participant. | Playbook `inPlayAction` + `actionBeforePass`; target via `LionDuelistTactics.pickStripTarget`, which reuses the shared `AttachmentControlProfile` score tables. Theirs scores every attachment; **ours is a NET reading** — the debuffs we shed minus everything good that comes off with them (`ownAttachmentLossWeight`), because the effect is not selective the way Let Go is and cannot take the Pacifism while leaving the katana. Cancels cleanly when nothing clears `stripMinimumValue`. The **click** is gated too (`JigokuBotPolicy.provinceActionWorthwhile`): the attacked-province paths otherwise fire an own province's Action on sight, and once this one is on the stack its only legal target may be our own loaded tower. Shipped as the **stronghold province** per the deck guide; measured against the alternatives in §5. |
| `=` **Illustrious Forge** (4) | High. Reveal: dig the top 5 for an attachment and put it into play. | Existing province reaction. The "Choose an attachment" menu carries no stats, so the pick is a ranked list: `LionDuelistTactics.attachmentRanking` puts Blade of 10,000 Battles and Setting the Standard first (both convert every conflict win into cards). |
| `=` **Shameful Display** (3) | Moderate. | Existing shared handler (`shameful-*` reasons) from Crab/Crane. No new code. |
| `+` **The Art of War** (3) | Moderate. Interrupt on break: draw 3. | Playbook entry, priority 9, `optionalDrawCards: 3`. **The concede rule around it was made injectable** — see §3. |
| `·` **City of the Rich Frog** (3) | Moderate. Holds 3 dynasty cards instead of 1. | No bot change (also true for the swarm Lion list). |

### Dynasty characters

| Card | Value | Implementation |
|---|---|---|
| `+` **Ikoma Prodigy** (1, 0/2, Courtier) | Moderate. Reaction: gain 1 honor when fate is placed on it — including entering play with fate. Also the deck's only Courtier, so it is what makes Regal Bearing legal. | Playbook entry (priority 8) + `additionalFateByCharacterId: { 'ikoma-prodigy': 1 }`, consumed through `preferDeckAdditionalFate`. It is never bought bare. |
| `+` **Tactician's Apprentice** (1, 1/0) | Moderate. Reaction: draw 1 when our dial is **lower** than the opponent's, once per phase. | Existing entry; the value comes from the bid profile (§3). |
| `=` **Miya Mystic** (2) | Moderate. Attachment control. | Existing entry, unchanged. |
| `+` **Keeper Initiate** (2) | Moderate–high with the Air role. Reaction on claiming a matching ring: put into play **from the dynasty discard** with a free fate. | Existing playbook entry, two new supports. `MulliganProfile.endPhaseDiscardCardIds` force-discards it in the fate phase (it is worth more in the discard pile than face-up in a province blocking that slot), and the AIR ring bonus above makes the bot actually go and claim the ring that fires it. Both empty/zero for every other deck. |
| `+` **Kitsu Motso** (3, 3/3, Commander) | Moderate, situational. Action while participating and behind on cards: move an **opponent** character into the conflict. It bows on the way home. | Playbook `inPlayAction` + `LionDuelistTactics.shouldDragOpponentIn`. Gated to conflicts whose outcome can no longer change — out of reach (`motsoHopelessWinDeficit`) or a lead beyond what the dragged body can answer (`motsoSafeLeadMargin`). Otherwise it just hands them skill. |
| `+` **Akodo Zentaro** (3, 3/1, Commander) | High against holding decks, dead against the rest. Action while attacking: take control of a non-unique holding in the attacked province. | Playbook `inPlayAction` + `actionBeforePass`. Two prompts: `pickHoldingTarget` (valued by `holdingValueById`, engines over raw strength) and `pickHoldingDestination` — the destination province has **every other card in it discarded**, so it picks the one we would miss least (`provinceContentValueByLocation`). |
| `+` **Matsu Agetoki** (3, 4/2, Commander) | Moderate. Action while attacking and more honorable: move the conflict to another province and reveal it. | Playbook gate + `pickConflictMoveProvince`. **The first gate was wrong**: `strengthNeeded > 0` is true at declaration for nearly every attack, so the deck moved the conflict before playing anything. Now `agetokiMinimumStrengthNeeded` (default 3), and the destination must be at least `agetokiMinimumStrengthSaving` weaker. A facedown province is priced at the field average, not at zero. |
| `+` **Kitsu Spiritcaller** (3, 1/3) | High. Action: bow it to put **any** character from either discard pile into the conflict, ready. | Playbook `inPlayAction` + `worksWithoutReadyParticipant` (it answers a fully bowed board) + shared `ConflictRecursionTactics.pickTarget`, ranked by contested-axis skill with glory and fate tie-breaks. |
| `+` **Matsu Mitsuko** (4, 4/2, Commander) | High. Action in a military conflict while more honorable: move one of ours in. | Playbook gate + shared move-in steering (strongest ready body at home). |
| `=` **Akodo Toturi** (5, 6/3, Champion) | High. Resolve a claimed ring's effect a second time. | Existing entry, priority 8. A named tower: 2 extra dynasty fate, first claim on attachments. |
| `+` **Matsu Tsuko** (5, 5/4, Champion/Commander) | **The deck's best card.** Reaction: winning a conflict she attacks in breaks the attacked non-stronghold province, whatever its strength. | Playbook entry priority 10 **plus a planning change**: `LionDuelistTactics.winIsBreak` collapses `conflictStrengthNeeded`'s attacker target from province strength to zero while she is a ready attacker, we hold the honor lead, and the target is not the stronghold province. Attacks are then sized to *win*, not to out-strength the province. |

### Dynasty events and holdings

Dynasty events are legal from a province exactly like a character, but every
dynasty economy path in the bot ranks *characters* only — so before this deck
both of these sat face-up in their province until the round ended and were
discarded. See §3.

| Card | Value | Implementation |
|---|---|---|
| `+` **Honored Veterans** (0) | Moderate. Honor a Bushi played this phase; the opponent honors one of theirs too, so it is only worth a card when our glory is the bigger half. | Measured **zero uses per game** before the fix. Shared `DynastyEventTactics.pick` now offers it when a Bushi bought *this phase* (`card.new`) is unhonored and carries at least `honoredVeteransMinimumGlory`. |
| `+` **A Season of War** (1) | Moderate. Discard and refill every province faceup, then take another dynasty phase. | Same hook. It is a **reroll**, so it is only offered once the visible provinces hold at most `seasonOfWarMaxUsefulProvinceCards` things we still want, and only with `seasonOfWarMinimumFate` left to spend in the extra phase. |
| `=` **Proving Ground / Favorable Ground / Imperial Storehouse** | Moderate. | All three already had shared entries; no deck-specific code. Kept in the opening/late holding keep lists, and priced for Zentaro's theft in `holdingValueById`. |

### Conflict cards

| Card | Value | Implementation |
|---|---|---|
| `+` **Ikoma Reservist** (1, 1/1) | Low, **tripling to moderate** with fire or water claimed (+2 military on a printed 1). | New `conflictContribution` model reading `myClaimedRingElements`, a new `PlaybookContext` field: the serialized ring carries `claimedBy` as a player *name*, which no playbook gate could resolve, so the policy folds the comparison down once per context. The ring chooser also bids `skillRingBonus` for fire or water while a Reservist would be armed — and stops bidding for the second of the pair, since the payoff is already on. |
| `=` **A Perfect Cut** (0) | Moderate. | Existing shared entry, already priced. |
| `+` **Called to War** (0) | Moderate. Put 1 fate on our Bushi; the opponent **may** pay us 1 honor to also fate one of theirs. | Playbook gate (needs a Bushi at ≤1 fate) + target steering. **The response side is field-wide policy, not a Lion knob** — see §3. |
| `+` **Even the Odds** (0) | Moderate. Move one of ours in while outnumbered; honor it if a Commander. | Playbook gate on `participatingCharacterCounts` + priced by the best ready body at home. Prefers an unhonored Commander (both halves pay). |
| `+` **Way of the Lion** (0) | **High — the largest single pump either Lion list owns.** Doubles a Lion character's BASE military, so on a five-cost Champion it is +5 or +6. | Existing entry, now **priced**: doubling base military adds exactly the base value again, so `conflictContribution` returns the largest base military among our ready participants (from the exact `characterBaseMilitary` map). It read as "unknown contribution" to province-break budgeting before. Shared with the swarm list, which measured **bit-identical** afterwards (§5.2). |
| `=` **Defend Your Honor** (0) | Existing entry, `shouldPlay: false` (interrupt-only). Unchanged. |
| `=` **In Service to My Lord** (0) | High. | Existing entry, plays from discard. |
| `=` **Regal Bearing** (1) | High. Set our dial to 1, draw the dial difference. | Existing entry, already dial-aware via `regalBearingDraw`. Needs a participating **Courtier** — Ikoma Prodigy is the only one, which is why Prodigy is a mulligan keep. |
| `+` **Prepare for War** (1) | Moderate–high; three payoffs. Discard attachments and/or status tokens from one of ours, then honor it if a Commander. | Playbook gate (debuff, dishonored, or unhonored Commander) + target steering + **two new prompt handlers**: the "Choose any amount of attachments" selector takes only known debuffs then closes (the generic multi-select would have discarded our own weapons), and the per-token Yes/No keeps an Honored token and sheds a Dishonored/Tainted one. |
| `=` **Forebearer's Echoes** (2) | High. | Existing entry; recursion target now goes through the same shared `ConflictRecursionTactics.pickTarget` as Spiritcaller. |
| `+` **Formal Invitation** (0, attachment) | Moderate. Glory-2 bearer; move it into a political conflict. | `abilityValue: true` (zero printed stats), `attachSide` handled by the carrier picker with `formalInvitationMinimumGlory`. |
| `+` **Fan of Command** (1, attachment) | Moderate. Ready a participating Bushi. | `abilityValue: true`, gated on an actual bowed participating Bushi. |
| `=` **Duelist Training** (1) | High. | Existing entry; the duel target now routes through `LionDuelistTactics.duelAxes`. |
| `+` **Setting the Standard** (1, attachment) | High. Draw 2, discard 1 on **every** conflict the bearer wins. | `abilityValue: true`, `optionalDrawCards: 2`, ranked second in the Forge dig. |
| `=` **True Strike Kenjutsu** (1) | High. | Existing entry, base-military duel. |
| `+` **Blade of 10,000 Battles** (2, attachment, Restricted) | **The deck's best attachment.** Recur any conflict-discard card after a win while more honorable. | `abilityValue: true`, ranked first in the Forge dig, `maxCopiesPerTarget: 1`. Restricted-slot accounting is already generic. |

---

## 3. Shared machinery this deck added (inert everywhere else)

Seven changes live outside the Lion files. **Every one defaults to the previous
behaviour**, so no other deck in the field moves — verified by re-measuring
`Lion` bit-identical (§5.2) and by the 11086-spec suite passing unchanged.

### 3.1 `PersonalHonorProfile.honorGiftResponse` — a field-wide hole

Called to War prompts the **defending** player: *"Give an honor to your
opponent?"*. The generic button fallback prefers `yes`, so before this every bot
in the field handed a Lion Duelist deck a free honor for every copy it played —
and honor is this deck's entire switch. Whoever is *asked* owns the decision, so
this is field policy, not a Lion knob.

The trade is now priced: refuse below `minimumOwnHonorAfterGift` (8, because
reaching 0 loses outright), refuse once the asker would reach
`maximumOpponentHonorAfterGift` (15, because 25 wins), and require a Bushi at or
under `maximumRecipientFate` that actually banks the fate. `enabled: false`
restores "always decline".

### 3.2 `DeckProfile.provinceConcede` — a per-deck judgement that was hard-coded

The bot used to hard-code *"concede The Art of War while ≤1 own provinces are
broken"*. That is a good trade for a racing deck — three cards for a province it
was losing anyway — and a bad one for a deck that wants long games, because every
conceded province walks the opponent one step closer to conquest. It is now
`{ cardIds, maxOwnBrokenProvinces }`, defaulting to `['the-art-of-war']` / 1,
which is exactly the old behaviour.

It also now refuses to concede the **stronghold province**, which had no guard at
all. That was reachable: nothing stopped a profile from parking The Art of War
under the stronghold and then conceding the game-ending conflict to draw three
cards.

### 3.3 A dynasty-EVENT hook

Dynasty events are legal from a province exactly like a character, but every
dynasty economy path ranks *characters* only, so an event sits face-up until the
round ends and is discarded. Only the Kyuden Bayushi profile had a hook. Honored
Veterans ×3 measured **zero uses per game**. Shared `DynastyEventTactics.pick`
now runs ahead of the body ranking, gated on an opted-in deck profile.

### 3.4 `AxisChoiceInput.axisBonusMilitary` / `.axisBonusPolitical`

The axis chooser (`ConflictDeclarationPolicy`) is a pure board reading: whichever
of military/political carries more of my ready skill, optionally minus theirs. It
has no notion of a **card payoff that only exists on one axis** — so a deck whose
card engine lives on the other side of its board never declares there.

Measured: Regal Bearing, this deck's card engine, needs a political conflict with
a participating Courtier and fired **zero times in six games** behind a
military-leaning board. The new fields add a skill-equivalent value to one axis
before the comparison. The zero-skill legality guards deliberately keep reading
the **raw** board, so a bonus can never manufacture an attack on an axis we have
no skill on. `0` — the default, and every other deck — is bit-identical.

### 3.5 A ring-preference hook for a ROLE

`ringScore` reads the board and the rings' fate. It has no notion of the player's
**role** at all. This deck's Keeper of Air makes an AIR claim put a Keeper
Initiate into play from the dynasty discard *with a free fate* — the reason three
copies are deliberately force-discarded — and fire/water each arm every Ikoma
Reservist. `LionDuelistTactics.ringBonus` adds both terms, each conditional on
the payoff actually being live, and stops bidding for the second of fire/water
because the payoff is already on.

### 3.6 `MulliganProfile.endPhaseDiscardCardIds`

Force-discard a printed id in the fate phase whatever the keep rules decided.
Empty everywhere else.

**Note the bug this exposed.** `endPhaseKeepSet` has an early return for a *weak*
board that keeps every affordable character, and the first version of this knob
was applied only after it — so on exactly the boards where it mattered most it
did nothing. Both exit paths now run `applyForcedDiscards`.

### 3.7 Context and analysis data

`PlaybookContext.myClaimedRingElements` and `.alternateProvincesAvailable`: two
facts no playbook gate could reach — which rings *we* hold (the serialized ring
carries `claimedBy` as a player **name**, which a static playbook entry cannot
resolve against the current seat), and whether Agetoki has anywhere to move the
conflict to.

`DeckAnalysis` gained printed models for `way-of-the-lion`, `even-the-odds`,
`prepare-for-war` and `called-to-war`, which the omniscient coverage spec
requires for every standardized bot deck.

---

## 4. The profile and its knobs

`lion-duelist-kyuden-ikoma`, matched on `strategy.lionDuelist` — derived from
`kyuden-ikoma` **alone**, so the swarm Lion list (Hayaken no Shiro) cannot pick it
up, and this deck trips no other strategy flag (both locked in
`lionduelisttactics.spec.js`).

### 4.1 Deck-profile settings and why

| Setting | Value | Why |
|---|---|---|
| `strongholdProvinceId` | `frostbitten-crossing` | Deck-guide directive. Measured against all three alternatives (§5.4); all inside noise, so the directive stands. |
| `firstPlayerChoice` | `first` | Deck-guide directive — and **confirmed by measurement**: `second` costs about 4pp. |
| `honorRaceAware` | `true` | Honor is a live resource in both directions here. (`bidWarAware` was tried and removed: the only entry reading it is Make an Opening, which this deck does not run, and it measured bit-identical.) |
| `reserveDynastyFate` | `true` | Regal Bearing, Prepare for War and Blade all cost fate in the conflict phase. |
| `attackCommitment` / `attackKeepHome` | `all-but-one` / 1 | Generic. Every variant measured inside noise. |
| `defenseCommitment` | `prevent-break` | Generic. The deck wants long games. |
| `drawBidding` | opening 5, then forced low | Deck-guide directive; also fires Tactician's Apprentice. Measured **null** — §5.4 explains why the dial is not the lever. |
| `duelBidding` | `objective: 'honor'` | Honor flows to the LOWER bidder, which is where this deck wants to be; its duels are a bowing tool, not an honor engine. |
| `mulligan` | Prodigy / Agetoki / Mitsuko / Motso / Toturi / Tsuko preferred; Regal Bearing kept | Matches the deck guide's opening plan. |

### 4.2 `LionDuelistProfile` — everything else is data

All 39 knobs live in `server/game/bots/LionDuelistTactics.ts` and are injectable
per arm through `SUBJECT_PROFILE='{"deckProfile":{"lionDuelist":{...}}}'`
(`lionDuelist` is in the controller's deep-merge list, so an arm names one knob
instead of restating the whole object).

| Group | Knobs |
|---|---|
| Identity | `towerCharacters`, `commanderCharacters`, `championCharacters`, `bushiCharacters`, `additionalFateByCharacterId` |
| Kyūden Ikoma | `strongholdBowRequiresReadyTarget`, `strongholdBowSkipsParticipants`, `strongholdBowMinimumSkill` |
| Frostbitten Crossing | `stripMinimumValue`, `ownAttachmentLossWeight` |
| Kitsu Motso | `motsoAllowOnDefense`, `motsoMinimumTargetSkill`, `motsoHopelessWinDeficit`, `motsoSafeLeadMargin` |
| Recursion | `recursionGloryWeight`, `recursionFateWeight` |
| Matsu Agetoki | `agetokiMinimumStrengthNeeded`, `agetokiMinimumStrengthSaving`, `facedownProvinceAssumedStrength` |
| Matsu Tsuko | `winIsBreakCharacterIds` |
| Akodo Zentaro | `holdingValueById`, `holdingDefaultValue`, `zentaroMinimumHoldingValue` |
| Attachments | `attachmentRanking`, `keyCharacters`, `formalInvitationMinimumGlory` |
| Duels | `duelAxes` |
| Dynasty events | `honoredVeteransMinimumGlory`, `seasonOfWarMaxUsefulProvinceCards`, `seasonOfWarMinimumFate` |
| Axis payoff | `politicalPayoffCardIds`, `politicalPayoffCourtierIds`, `politicalPayoffBonus`, `politicalPayoffMinimumOpponentBid` |
| Ring preference | `recursionRingElements`, `recursionRingCardIds`, `recursionRingBonus`, `skillRingElements`, `skillRingCardIds`, `skillRingBonus` |

**One trap worth knowing.** A `PlaybookEntry` is a static registry with **no view
of the `DeckProfile`**, so a threshold written into a playbook `shouldUseAction`
gate is a constant, not a knob. That is exactly how `agetokiMinimumStrengthNeeded`
was silently dead — see §5.4. Per-deck action thresholds belong in
`conflictAbilitySources`, where the profile is in scope; the playbook gate now
keeps only a mirror of the default, with a comment saying so.

---

## 5. Measurements

Rig: `SUBJECT=LionDuelist node tools/selfplay/deckFieldWinRate.js` — one deck
against the fixed 13-deck field, mirrors excluded, every pairing played twice on
the same shuffle with the subject on each seat so first-player advantage cancels
by construction, multiple independent shuffle bases, per
`.claude/skills/roundrobin/SKILL.md`.

**This number is not centred on 50%.** The field has been tuned for months, and
only the subject varies. `Lion` (the swarm precon) measures **52.14%** on the same
three bases and is the calibration point.

### 5.1 What actually moved the number: reachability, not knobs

Nineteen profile arms were measured across two sweeps of three bases each (234
games per arm). **Not one landed outside its own control's ±6pp confidence
interval.** Stronghold-province choice, draw-bid objective, chump-blocking,
defence buffers, attack commitment, keep-home count, Imperial Favor side and the
honor-race flag are all null for this deck (full table in §5.4).

Every real gain came from a mechanism that was **not reachable at all**:

| Fix | Why it was invisible |
|---|---|
| Fate-phase forced discard reaching the *weak-board* branch | `endPhaseKeepSet` returns early for a weak board, so Keeper Initiate never reached the discard pile its reaction reads |
| Matsu Agetoki's gate | `strengthNeeded > 0` is true at declaration for nearly every attack, so the deck moved the conflict before playing anything |
| Dynasty EVENT hook | Honored Veterans ×3 measured **zero uses per game** — no dynasty economy path ranks events |
| Political axis payoff | Regal Bearing, the deck's card engine, fired **zero times in six games**: it needs a political conflict, and the axis chooser is a pure board reading |
| Ring preference for a role | Keeper of Air never steered the bot toward the AIR ring that fires Keeper Initiate |
| Way of the Lion pricing | The largest pump either Lion list owns read as "unknown contribution" to break budgeting |

### 5.2 Results

Paired: identical bases, identical shuffles, so each row is a clean before/after.

| Build | Field win rate (234 games, bases 91001-93001) |
|---|---:|
| First working build | 25.64% |
| \+ fate-phase forced discard reaches the weak-board branch, \+ Agetoki gate | 30.34% |
| \+ dynasty events, axis payoff, ring preference, Way of the Lion pricing, Agetoki/Motso knobs wired | **34.19%** |

The third row is a **bundle of five changes measured together**, not five
attributed effects. They are code paths rather than knobs, so isolating each one
would need scaffolding that does not exist; the honest claim is that the bundle
is worth +3.85pp on these bases.

**Headline — six *unseen* bases, 936 games:**

```
TOTAL 323-613 of 936   34.51%   95% CI [31.5, 37.6]
per base   39.10 / 35.26 / 33.97 / 30.13 / 29.49 / 39.10 %
per seat   seat 0 34.19%   seat 1 34.83%
draws 0    stopReasons {"decided": 936}
```

The seat split matters: the first build read **32.05% / 19.23%** and was badly
order-dependent. It no longer is.

**Regression check.** `Lion` shares Way of the Lion and In Service to My Lord and
measured **122-112, 52.14%** both before and after the shared pricing change —
bit-identical, not merely close.

**Reachability.** `node tools/selfplay/auditCards.js LionDuelist 16`:

```
LionDuelist  29/29 plays covered   0 zero-use   0 never-seen
             18/20 abilities       0 failed/stalled games
```

The two unexercised *Actions* are correct, not gaps: Kitsu Motso needs to be
behind on cards in an already-decided conflict with a ready enemy still at home,
and Akodo Zentaro needs a faceup non-unique holding in the attacked province —
which the Crane audit opponent barely runs.

### 5.3 Matchups (936 games)

72 games against each opponent, both seats.

| Opponent | Win rate | | Opponent | Win rate |
|---|---:|---|---|---:|
| DragonAttachments | 59.7% | | Lion | 25.0% |
| PhoenixPhoenix | 56.9% | | UnicornReveal | 20.8% |
| Scorpion | 48.6% | | Phoenix | 19.4% |
| Crab | 47.2% | | PhoenixShugenja | 19.4% |
| Unicorn | 47.2% | | Dragon | 18.1% |
| Crane | 41.7% | | ScorpionBidWar | 18.1% |
| CraneDuels | 26.4% | | | |

The pattern is consistent. The deck beats slow towers and holding decks — it has
the time it needs to accumulate the honor lead, and Akodo Zentaro punishes
holdings directly — and it loses to decks that either race it (Lion, Dragon) or
contest the honor axis it lives on (Phoenix glory, ScorpionBidWar).

Per-opponent rows at 72 games each carry roughly ±11pp of noise, so read the
ordering, not the individual numbers.

Win reasons: **205 conquest, 86 dishonor, 32 honor** wins against **604 conquest
and 9 dishonor** losses. So **36% of its wins come off the honor axis**, and
essentially all of its losses are the province race. Average game 5.4 rounds.

The shape of the remaining gap, stated plainly: the deck reliably drives its
opponent to 3-5 honor by round 5, and reliably loses four provinces in the same
five rounds. It is winning the race it is built for and losing the one the field
is built for.

### 5.4 Measured and rejected — do not retry

Two sweeps, three bases each, 234 games per arm. **The two sweeps ran on
different builds and therefore have different controls** — compare each arm only
with the control directly above it.

Sweep 1, control **26.50%** (pre-reachability-fix build):

| Arm | Result |
|---|---:|
| `drawBidding.objective: 'balanced'` | 25.21% |
| `drawBidding.objective: 'cards'` | 25.21% |
| honor objective without `forceLowAfterOpening` | 26.07% |
| `chumpBlock: true` | 26.07% |
| `defenseSkillBuffer: 2` | 26.50% |
| `attackKeepHome: 2` + `breakable-or-pressure` | 27.78% |

Sweep 2, control **30.34%** (after the fate-phase and Agetoki fixes):

| Arm | Result |
|---|---:|
| `provinceConcede` disabled | 30.77% |
| `strongholdProvinceId: 'illustrious-forge'` | 31.20% |
| `strongholdProvinceId: 'shameful-display'` | 30.34% |
| `strongholdProvinceId: 'city-of-the-rich-frog'` + no-concede | 28.21% |
| `imperialFavorChoice: 'political'` | 28.63% |
| `firstPlayerChoice: 'second'` | **26.07%** |
| `honorRaceAware: false` | bit-identical |
| `motsoAllowOnDefense: true` | bit-identical |
| extra tower fate (3 on Toturi/Tsuko) | bit-identical |
| `agetokiMinimumStrengthNeeded: 99` | bit-identical |

`firstPlayerChoice: 'second'` at −4.3pp is the only arm with a consistent
direction, and it confirms the deck guide's "go first in all cases" rather than
changing anything.

Two conclusions worth carrying forward.

**The honor dial is not this deck's lever.** Kyūden Ikoma starts at 13 honor
against a field of 10-11, so the "more honorable" switch is already on at game
start. Farming the dial up to 22 buys nothing the deck was not already getting,
which is why every draw-bid arm measures null. The first build's entire premise —
bid 1 forever to accumulate honor — was wrong, and the measurement said so before
any of the card logic had been tuned.

**A knob that measures bit-identical to its control is a broken wire, not a
null.** `agetoki-off` reading *exactly* 71-163 — the same two integers as the
control, not a near miss — is what exposed that the threshold was hard-coded in
the playbook entry, which cannot see the `DeckProfile`, rather than read from the
knob. Four arms in the second table are in that category, and two of them
(`honorRaceAware`, tower fate) are genuinely inert while two were bugs. Check for
exact-integer agreement before recording a knob as tested.

---

## 6. Running it

```sh
# One diagnostic match vs the Crane precon (NOT a measurement)
node tools/selfplay/matchLionDuelist.js 20 1 --trace

# The real measurement: one deck vs the fixed field
SUBJECT=LionDuelist BASES=91001,92001,93001 GPB=3 WORKERS=14 \
  HARNESS_MAX_GAME_MS=180000 node tools/selfplay/deckFieldWinRate.js

# A tuning arm — one knob, injected into the subject seat only
SUBJECT=LionDuelist BASES=... GPB=3 \
  SUBJECT_PROFILE='{"deckProfile":{"lionDuelist":{"stripMinimumValue":4}}}' \
  node tools/selfplay/deckFieldWinRate.js

# Card reachability
node tools/selfplay/auditCards.js LionDuelist 16

# Specs
npx tsc && npx jasmine test/server/bots/lionduelisttactics.spec.js
```

`WORKERS = cores - 4`. The harness has a wall-clock per-game backstop, so
oversubscribing turns slow games into non-results rather than losses.

**The harness runs compiled JS — run `npx tsc`, not `--noEmit`, or both arms
measure the same stale build.**

---

## 7. Files

| File | Change |
|---|---|
| `server/game/bots/LionDuelistTactics.ts` | **new** — the whole playstyle, 40 injectable knobs |
| `server/game/bots/CardPlaybook.ts` | 18 new entries, `lionDuelist` strategy flag, 2 context fields, Way of the Lion pricing |
| `server/game/bots/DeckProfiles.ts` | `lion-duelist-kyuden-ikoma` override, `lionDuelist` profile field + clone, `provinceConcede` |
| `server/game/bots/JigokuBotPolicy.ts` | tactics instantiation, 11 target-steering blocks, 3 prompt handlers, Tsuko win-is-break, dynasty events, ring bonus, axis bonus, Agetoki/Motso gates |
| `server/game/bots/ConflictDeclarationPolicy.ts` | `axisBonusMilitary` / `axisBonusPolitical` |
| `server/game/bots/PersonalHonorTactics.ts` | `honorGiftResponse` + `shouldGiveHonorForFate` |
| `server/game/bots/MulliganTactics.ts` | `endPhaseDiscardCardIds` + the weak-board early-return fix |
| `server/game/bots/JigokuBotController.ts` | `lionDuelist` added to the deep-merge list so arms can name one knob |
| `server/game/bots/DeckAnalysis.ts` | printed models for 4 events |
| `tools/selfplay/{deckLoader,deckRegistry,auditCards}.js` | registry label `LionDuelist` + aliases |
| `tools/selfplay/matchLionDuelist.js` | **new** diagnostic runner |
| `tools/selfplay/standardBenchmark.js`, `v2BenchmarkPartitions.json` | suite id + version bump, deck added to both partitions |
| `tools/selfplay/fixtures/lion-duelist-*.json` | **new** cached decklist + card data |
| `test/server/bots/lionduelisttactics.spec.js` | **new**, 55 specs |
| `test/server/bots/conflictdeclarationpolicy.spec.js` | 4 specs for the axis bonus |
| `jigoku-client/client/NewGame.tsx` | lobby dropdown entry |

Suite: **11086 specs, 0 failures**. `npx tsc` clean. `eslint` clean on every new
and modified file (one pre-existing non-null assertion in `PersonalHonorTactics`
predates this work).

---

## 8. What is left

* **The province race is the gap.** 604 of its 613 losses are conquest, in ~5.4
  rounds. Every *defensive* knob in the profile measured null, so this is not a
  tuning problem — it wants a mechanism. The deck's own plan (a few durable
  Commanders reused across conflicts through eight move/ready effects) suggests
  the answer is on the offence side: converting more of those moves into breaks,
  not blocking more.
* **Matsu Tsuko is under-exploited.** `winIsBreak` collapses the target number
  once she is *already attacking*, but nothing steers the declaration toward the
  conflict where she can attack, and nothing prioritises keeping her ready. That
  is the same class of gap as the Regal Bearing axis payoff, which was worth
  finding.
* **Kitsu Motso and Akodo Zentaro fire rarely** against the Crane audit opponent.
  Both gates look correct on paper; a `probePaired.js` run bucketed by their
  windows would say whether the scope is right or merely narrow.
* **Six-base confirmation of individual fixes.** The headline 34.51% is on six
  unseen bases, but the +8.9pp is a paired same-shuffle before/after on three.
  The skill asks for six bases to *accept* a lever; these are code paths, not
  knobs, so confirming each one individually needs scaffolding that does not
  exist yet.
