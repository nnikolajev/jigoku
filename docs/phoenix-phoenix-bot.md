# Phoenix "Phoenix" — the Fushichō rotation deck

EmeraldDB `7b7f54b8-2037-4f98-951f-a651a82f66a5` (v0.6, Phoenix / Lion splash).
Registry label **`PhoenixPhoenix`**. Derives **`rebirth` + `shugenja`**; the
per-deck override is **`phoenix-phoenix-fushicho-rotation`**.

> Measurement discipline for everything below is
> `.claude/skills/roundrobin/SKILL.md`. Single-base and single-seed numbers are
> not evidence and are not quoted here.

## The plan, and why it is not a normal deck

Every other piloted deck answers "how much fate does this body deserve?" with a
number greater than zero. This one answers **zero, always**, and that is not a
concession — it is the engine:

1. A character bought with no fate is discarded in the fate phase.
2. The dynasty **discard** is therefore always full of large Phoenix bodies.
3. Fushichō's leaves-play interrupt puts one of them back **with 1 fate**, so it
   survives the *next* fate phase too.
4. Forebearer's Echoes rents one into a military conflict, and when the rental
   expires the body leaves play — which fires Fushichō's interrupt *again* if
   Fushichō was the rental.
5. My Ancestor's Strength copies a discarded body's printed skills onto a live
   Shugenja, so a 1-cost Ethereal Dreamer fights as Fushichō's 6/6.

So the discard is a resource, not a graveyard, and "losing" a body is a move.
This is why the deck runs no attachments worth protecting and no tower.

**The zero-fate rule is measured, not assumed.** Putting 1 fate on each body
scored **20.6%** and 2 fate scored **21.2%**, against **23.6%** for the
zero-fate default, over 360 games on six independent shuffle bases each.

## Card-by-card evaluation

### The engine

| Card | Reading |
|---|---|
| **Fushichō** (6, 6/6) | The build-around. Printed 6 is a whole turn of income, so it is only bought when the interrupt has somewhere to go — `fushichoMinRecursionTargets`. A second copy in the discard outranks every other resurrection target, because it re-arms the whole engine. |
| **Forebearer's Echoes** (2, Air role) | The largest single number any event in the field produces. Ranked on the *contested axis*, not on long-term value. |
| **My Ancestor's Strength** (1) | Chosen as a PAIR (`ancestorPlan`): the gain is a property of both halves. |
| **Walking the Way** (1, 0 with a Shugenja) | Digs the top three for Fushichō. Played from a window with no conflict running — it adds nothing to a fight in progress. |
| **A Season of War** (1) | Full province reset to find Fushichō. Fires only when no copy is already showing, and is **capped per game**: it grants an extra dynasty phase from which another copy can be revealed and replayed, which is a loop. |
| **Emperor's Summons** (province) | Searches the deck for a character — Fushichō first — into the weakest province. |
| **Retire to the Brotherhood** (province) | **Stronghold province.** It wipes every *fateless* character on both boards. Ours are fateless by design and are replaced free off the top of the deck; the opponent's final all-in usually is not. The only other legal choice is Emperor's Summons — Kakudaira, City of the Rich Frog and Kuroi Mori all forbid the slot. |

### The bodies

| Card | Reading |
|---|---|
| **Isawa Tsuke** (5, 5/4, glory 3) | Biggest military body plus the deck's only fate removal. Wants FIRE **unclaimed**, which is the one payoff that steers the bot *away* from a ring. |
| **Asako Azunami** (5, 4/4, glory 3) | Replaces the water ring effect with bow-one **and** ready-one — strictly better than the printed effect. |
| **Inferno Guard Invoker** (4, 3/2, **glory 4**) | Honoring adds glory to both skills, so this is a +4/+4 on itself. The sacrifice-on-break clause is a cost for other decks and *fuel* here. |
| **Kudaka** (4, 3/4) | Air-claim economy. **Faction `neutral`** — not a legal Fushichō target and not a legal Benten's Touch cost. |
| **Isawa Heiko** (4, 0/5) | A 0/5 is unplayable in military conflicts until its own reaction switches it to 5/0. The switch is symmetric and also works aimed at an enemy participant. |
| **Young Philosopher** (2, –/4) | Four political for two. Printed military **dash** — never a legal ancestor for a military My Ancestor's Strength. |
| **Shiba Pureheart** (2, 2/1, glory 2) | Rally, plus an honor on the opponent's second conflict. |
| **Miya Mystic** (2, 1/1) | Bought for the attachment removal, not the body. **Faction `neutral`**. |
| **Solemn Scholar** (1, 1/1) | Bows an attacker from home while EARTH is claimed. |
| **Ethereal Dreamer** (1, 1/1) | Cheapest legal My Ancestor's Strength target. |
| **Feral Ningyo** (3, conflict) | Free 3/2 into a **water** conflict; counted from HAND when scoring the water ring. |
| **Isawa Tadaka** (5, conflict) | Disguised onto a non-unique Shugenja; the bases here are Young Philosopher, Ethereal Dreamer, Solemn Scholar, Miya Mystic and Inferno Guard Invoker. |

### Support

Kyūden Isawa, Display of Power, Against the Waves, Clarity of Purpose,
Supernatural Storm, Pacifism, Assassination, Banzai and Kuroi Mori all reuse the
existing Phoenix Shugenja logic. Court Games reuses the shared personal-honor
policy. Ancestral Shrine and Way of the Phoenix are new (below).

## Two legality facts the card text hides

Both cost a whole click if you get them wrong, so both are enforced in
`RebirthTactics` rather than left to the engine's rejection:

- **Fushichō's interrupt is `isFaction('phoenix')` over the dynasty discard.**
  Kudaka and Miya Mystic are faction `neutral` and are **not** legal targets,
  even though both are Shugenja in this deck.
- **Benten's Touch bows a *Phoenix* Shugenja as its cost**, so it likewise
  cannot bow Kudaka or Miya Mystic — and cannot bow Fushichō, which is a
  Creature/Spirit, not a Shugenja.

## Ring choice

`RebirthTactics.ringBonus` is layered onto the shared `ringScore`, which already
dominates on fate piles. The Shugenja layer's own ring steering is switched off
for this deck (`shugenja.ringCardBonus: 0`) so the element preference has
exactly one owner.

| Element | Wanted by | Direction |
|---|---|---|
| air | Kudaka in play | claim it (1 fate + 1 card, twice a round) |
| earth | Solemn Scholar in play | claim it, and **keep** it claimed |
| water | Asako Azunami in play, or Feral Ningyo **in hand** | contest it |
| fire | Isawa Tsuke in play | **avoid** — his ability needs fire unclaimed |

Ancestral Shrine returns claimed rings for 1 honor each. It frees a claimed
*fire* ring whenever Tsuke is out (worth more than the honor), never returns
*earth* while Solemn Scholar is in play, and otherwise only fires below
`shrineHonorFloor`.

## Knobs

Everything is data on `RebirthProfile` (`server/game/bots/RebirthTactics.ts`),
so a tuning arm is a JSON string and never an edit:

```sh
SUBJECT=PhoenixPhoenix BASES=91001,92001,93001 GPB=3 \
  SUBJECT_PROFILE='{"deckProfile":{"rebirth":{"zeroFateAdditionalFate":1}}}' \
  node tools/selfplay/deckFieldWinRate.js
```

`JigokuBotController.decisionProfile` deep-merges `rebirth`, `shugenja`,
`fateAwareEconomy`, `strongholdDefense`, `defenseTuning`, `conflictDeclaration`
and `conflictCardEconomy`, so an arm names one knob instead of restating the
whole object. A shallow spread would silently drop the printed-skill table and
the Phoenix faction list, which are load-bearing legality data.

## Measuring this deck

`headToHeadRoundRobin.js` is the wrong rig for a new deck: it compares a changed
bot against an unchanged one and its null is a hard 50%, and there is no
unchanged counterpart here. A *field* round robin that moves every seat is
zero-sum and can never say a deck is good.

`tools/selfplay/deckFieldWinRate.js` holds the other ten decks fixed and varies
exactly one, so the number is that deck's strength against a stationary field.
It is **not** centred on 50%. It keeps every other rule from the skill: all
opponents, mirrors excluded, each pairing played twice on the same shuffle with
the subject on each seat, several independent bases reported separately, and the
TOTAL as the result.

## Results

**Shipped: 24.79% against the fixed field** (718 decided games, 12 independent
bases, seat-balanced 25.6% / 26.5%). The number is not centred on 50% — see the
rig note above.

Two independent instruments agree, which is the check that matters here:

| instrument | games | result |
|---|---:|---:|
| `deckFieldWinRate.js`, 12 bases | 718 | **24.79%** |
| `botRoundRobin.js`, the standard client benchmark, 40/matchup | 400 of 2200 | **23.9%** |
| `winRates.js` vs the Crane baseline | 100 | 30% |

The same round robin also explains the two bad matchups below: **Phoenix glory
is the strongest deck in the field at 69.0% and Lion sits at 52.0%**, and those
are precisely the two this deck cannot beat.

Per opponent, from the 12-base run:

| opponent | | opponent | |
|---|---:|---|---:|
| CraneDuels | 47.2% | Crab | 23.6% |
| Unicorn | 38.9% | Dragon | 22.5% |
| DragonAttachments | 38.0% | Scorpion | 22.2% |
| Crane | 36.1% | PhoenixShugenja | 20.8% |
| | | Lion | 8.3% |
| | | **Phoenix (glory)** | **2.8%** |

The shape is consistent and mechanical, not noise: the deck is competitive
against decks that trade bodies, and near-helpless against the two that build a
**wide persistent honored board** (Phoenix glory, Lion swarm). A deck that
deliberately keeps nothing on the table between rounds cannot race a board that
compounds. That is a property of the archetype, not of a knob.

## Tuning history

Every number below is `deckFieldWinRate.js`, 6 or 12 independent bases,
seat-balanced, 360-720 games per arm. Noise floor is about +/-2.5pp.

**The one change that shipped.** `defenseCommitment: 'win-only'` — **+3.93pp**
(20.86% -> 24.79% over 1437 games), positive on BOTH independent base sets
(+2.50pp on 91001-96001, +5.35pp on the fresh 120001-125001), z=1.78. It is the
opposite of what every other deck in this repo wants, and the reason is the
archetype: `prevent-break` bows bodies to save a province, and this deck would
rather keep them ready. It concedes more unopposed conflicts and therefore
bleeds MORE honor, and still wins.

**Confirmed by measurement, i.e. the deck's design rules are right.**

| lever | result | reading |
|---|---:|---|
| 1 fate per body | 20.61% | the zero-fate rotation is correct: investing fate is **-3.0pp** |
| 2 fate per body | 21.17% | same, **-2.4pp** |
| `fushichoMinRecursionTargets: 0` | 20.83% | buying Fushicho into an EMPTY discard costs **-2.8pp** |
| `attackCommitment: 'all'` | 18.94% | **-4.7pp**; the rotation needs a body at home |
| `conflictDeclaration.opponentBoardWeight: 0` | 20.56% | turning OFF the shipped opponent-aware axis costs **-4.2pp**, far more than the +1.58pp it is worth field-wide. With no persistent board, picking the axis they cannot meet is most of the deck's offence. |
| `drawBidding.openingBid: 1` | 16.25% | **-8.5pp**. The deck needs CARDS to find Fushicho; trading them for honor is the worst change measured, despite dishonor being 18.4% of its losses. |

**Measured null — reachable, tested, not worth shipping** (all within noise):
`strongholdDefense.preStrongholdThreatRatio: 1.5` (+1.25), `mulligan
.openingHoldingLimit: 0` (+0.38), `fushichoMinRecursionTargets: 2` (+0.28),
`shrineHonorFloor: 15` (+0.42), `tsukeHonorFloor: 4` (+0.14),
`liveEventPricingExclude: ['my-ancestor-s-strength']` (+0.59),
`chumpBlock: false` (+0.8 before win-only shipped),
`recursionSkillWeight: 5` (-0.70), `drawBidding.baseBid: 1` (-1.56).

`fateAwareEconomy.bodyBudgetIncludesDurableSpend: false` recorded -2.2pp, but
that arm ran BEFORE the engine hang was fixed and base 93001 is the base that
hung, so its games are not missing at random. **Treat that number as
unreliable** and re-measure before drawing anything from it. Every result that
shipped was measured after the fix.

**Measured bit-identical to the control — the knob is UNREACHABLE for this
deck.** Do not re-test these without first instrumenting the call site:
`chumpBlock`, `attackKeepHome`, `attackCommitment: 'breakable-or-pressure'` and
`preventBreakAfterBrokenProvinces` are all on the prevent-break path, which
`win-only` never enters. `honorRaceAware`, `drawBidding.objective` and
`reserveDynastyFate` also produced identical totals.

`fushichoAdditionalFate` is likewise inert: the override caps
`durableAdditionalFateEarly/Late` at 0, so a request for more fate is clamped
before it reaches the prompt.

## Bugs found and fixed on the way

1. **A synchronous engine hang that would freeze a live server**
   (`server/game/conflict.ts`). Pacifism lands on Unicorn's Iuchi Soulweaver
   during a POLITICAL conflict, where it is inert. Captive Audience — or this
   deck's Kuroi Mori — then switches the conflict to military, and Pacifism
   forbids participation. Soulweaver cannot be sent home
   (`allowGameAction('sendHome')` is false) and after one pass is already
   bowed, so `checkForIllegalParticipants` can never resolve the illegality and
   is called forever. Being synchronous, it blocks the event loop, so the
   harness' wall-clock backstop cannot fire. Fixed by removing the participant
   when it cannot be sent home; proven inert for the ten pre-existing decks.
2. **A click loop between Kyuden Isawa and its replay target.** The Kyuden
   branch of the replay selector substituted the raw prompt `cards` for
   `visibleDiscardCards` and lost the `failedPlayCards` filter with it, so a
   spell whose own targeting cancelled was re-picked immediately — and
   cancelling reopens that selector. Measured at 121 wasted clicks per 8 games.
3. **Honor targets were ranked on data that is not there.** Benten's Touch,
   Shiba Pureheart and Inferno Guard Invoker all choose by glory, and a
   selector's card summary carries no `glorySummary.stat` — so every candidate
   read zero. They now rank the in-play copy and click the offered uuid.

## Files

- `server/game/bots/RebirthTactics.ts` — the profile and every decision.
- `server/game/bots/CardPlaybook.ts` — `REBIRTH_MARKERS`, `rebirth` flag, and
  the entries for Shiba Pureheart, Isawa Heiko, Asako Azunami, Inferno Guard
  Invoker, Isawa Tsuke, Ancestral Shrine, My Ancestor's Strength, Walking the
  Way and Way of the Phoenix.
- `server/game/bots/DeckProfiles.ts` — the `rebirth` overlay and the
  `phoenix-phoenix-fushicho-rotation` override.
- `server/game/bots/JigokuBotPolicy.ts` — the `rebirth`-gated steering.
- `tools/selfplay/deckFieldWinRate.js` + `_fieldWorker.js` — the measurement rig.
- `tools/selfplay/matchPhoenixPhoenix.js` — diagnostic runner (never evidence).
- `test/server/bots/rebirthtactics.spec.js` — the locks.
