# Jigoku Heuristic Bot MVP

The server-side Jigoku bot occupies one normal player seat and submits choices through the same game commands as a human client: `menuButton`, `cardClicked`, `ringClicked`, and `facedownCardClicked`.

## Configuration

Lobby game creation may include:

```json
{
  "bot": {
    "enabled": true,
    "deckId": "deck id",
    "seed": 1,
    "omniscient": false,
    "difficulty": "mvp",
    "trace": true
  }
}
```

When `policy` is omitted, the seed selects the policy. Seed 1 uses the
fate-aware policy, seed 2 preserves the old generic heuristic, and seed 3 adds
fair board-aware dynasty planning to seed 1. Adaptive mulligan is shared by
every seed. Omniscience is an independent capability (`omniscient: true`) that
can be injected into any seed. Explicit policy and `adaptive` / `legacy`
mulligan values remain available for paired analysis.

The lobby creates a second player named `Jigoku Bot`, hydrates the configured deck, and starts the normal game-server handoff for the human player.

## Policy

The policy is deterministic for a fixed seed. It reads only the bot player's own player-perspective state (never the opponent's prompt or hidden information) and records every successful, rejected, or unsupported decision.

Current heuristics:

- **Draw honor bid**: all seeds and decks use the shared injectable `DrawBidTactics`. Round 1 is always 5. Later bids start from maximum card volume and progressively account for both honor pools, both public hand/fate counts, accessible ring fate, the bot's current hand costs, its full conflict-deck average cost, board strength/persistence/attachments, round, and exposed strongholds. Immediate honor/dishonor rails outrank conquest urgency. Card-engine, honor, dishonor, and tower profiles adjust named floors and weights without duplicating policy code. A frozen `LegacyDrawBidTactics` remains selectable only for A/B tests; see [`draw-bid-bot.md`](draw-bid-bot.md).
- **Duel honor bid**: all seeds and decks use `DuelBidTactics`, not the draw-bid heuristic. It evaluates the full legal bid matrix using exact duel skills, both honor pools, round, tie effects, public opponent deck profile, and only unspent Iaijutsu Master reactions. It protects terminal honor cliffs, bids minimally in hopeless or already-secure positions, and mixes close bids so a fixed response cannot exploit it. Risk weights are injectable through `profile.duelBidding`; see [`duel-bot.md`](duel-bot.md).
- **Dynasty phase**: plays faceup dynasty characters from its provinces during the dynasty action window (game-side cost validation rejects unaffordable plays without mutation), then passes.
- **Fate on characters**: the controller reads the printed cost off the 'Choose additional fate' prompt step and the policy scales the investment with it — cost 0–2 characters get no fate (disposable bodies), cost 3–4 get 1, cost 5+ get 2, plus 1 more when fate is plentiful. It keeps 1 fate in reserve for conflict cards, except for cost-5+ characters: the powerhouse itself is the investment, so the reserve is spent rather than dropping it onto the board with no fate.
- **Conflict declaration**: ring choice and conflict type are independent decisions, because any ring can be flipped military/political by clicking it again. Rings are scored purely by value — a ring holding 2+ fate is taken as a straight fate boost (biggest pile first); otherwise void leads but only when the opponent has a character with fate to strip, earth (card advantage) is always good, fire (honor/dishonor) is next, water is situational (strong when the opponent has 2+ ready no-fate characters to bow; for READYING one of our own bowed characters it is scored from that body's skill via `conflictTempo.readyRingBonusPerSkill`, and counts a conflict the OPPONENT still has coming as a use for the readied body, not only one of ours — worth +0.32pp, see [`bot-conflict-tempo.md`](bot-conflict-tempo.md); dead otherwise) and air trails. The conflict type comes from character strength: if the declared type does not match the side where the bot's ready characters carry more total skill, it clicks the ring again to flip it before committing. `ProvinceTargetingTactics` ranks unbroken targets for every seed: Eminent/start-faceup first, then effective strength, then provinces with no triggered ability, reveal-only reactions, other reactions, and Actions. Public Forum counts as effective strength 6 only for this priority because it needs two breaks; its real strength and break math are unchanged. Fair bots use visible metadata and stable board order for unknown facedown cards; an omniscient bot applies the same ranking to their true hidden metadata regardless of strategy seed. The entire ordering, per-card effective strength, and manual priority tier are injectable through `profile.provinceTargeting`. Attacker count is driven by break math: it commits skill until the total clears the attacked province's strength (4 assumed when facedown) plus the opponent's full possible ready defense; only when that target is unreachable does it fall back to sending everyone but the weakest, who stays home as a defender. It passes the conflict when no ready character has positive skill. The same scoring also drives generic 'choose a ring' prompts from card abilities.
- **Same-phase lookahead**: before spending a conflict opportunity, the shared bounded `ConflictPhasePlanner` rolls through the remaining alternating military/political opportunities, ready/bowed bodies, Covert, rings, province progression, and stronghold wins. Its retained default applies only the sequential province target. Existing conflict-axis, ring, card-specific attacker commitment, pass, and stronghold-defense rules remain authoritative; all planner layers are injectable, but type/ring/pass/exact-attacker replacement are disabled after direct A/B isolation found them weaker. Seed 3's capped dynasty-board projection is also available but disabled after a combined A/B regression. See [`conflict-phase-lookahead-bot.md`](conflict-phase-lookahead-bot.md).
- **Defenders**: parses the `attacker vs defender` skill line from the prompt and applies break math (a province breaks when attacker skill wins by at least the province strength): defends to win when its ready skill can reach the attacker's total, otherwise defends just enough to prevent the break, and commits nothing to hopeless defenses. When the stronghold province is attacked, ordinary caps are disabled and all ready defenders plus useful conflict cards remain available.
- **Stronghold defense**: `StrongholdDefenseTactics` runs before every declaration. Its normal survival mode activates once three own provinces are broken. A preliminary risk stage also activates at two broken provinces when the bot is first player, the opponent has at least two ready characters and two conflict declarations left, and the opponent's combined ready military or political skill reaches the exact live strength of the weakest unbroken outer province plus the stronghold province. Live `getStrength()` includes holdings, the stronghold bonus, and active modifiers. The preliminary stage reserves the minimum safe defender or skips an unsafe first attack, then releases automatically once the opponent has fewer than two conflict opportunities. The normal mode accounts for both conflict axes, remaining conflict opportunities, Covert, and the minimum ready defender set needed for the counterattack. It attacks freely when the opponent is bowed, attacks all-in on the last conflict opportunity, and races all-in when both strongholds are exposed. Seed 3 adds exact affordable hand boosts and defender-disabling effects; fair seeds use visible board skill. Thresholds, threat ratio/buffer, minimum defenders, and the entire preliminary stage are injectable through `profile.strongholdDefense`, allowing rush decks to relax or disable it without branching shared policy code.
- **Conflict action windows**: driven by break math, not just the win/lose gap. As the attacker it keeps playing until its skill lead reaches the attacked province's strength (winning 3 vs 0 against a 5-strength province breaks nothing — it plays 2 more skill), and stops once the break is secured or when the remaining deficit exceeds 6. As the defender it spends cards only to keep the attacked province from breaking or to steal a win within 3 skill; a lost conflict that breaks nothing is answered by saving the hand for its own attack. When acting, it first clicks its stronghold, the attacked province, and any board card with a playbook-known Action ability (see below; bowing is the cost, not fate; clicks with no legal ability are rejected without mutation), then — with at least 1 fate in reserve — plays cards from hand through the normal play menus. Hand candidates are filtered by the controller's `handStats` hint (printed skills/bonuses, hidden from summaries outside the play area): cards that add nothing to the current conflict type are skipped (no military attachments in political conflicts), and known contributions are played strongest first. Passes when already winning or when the conflict is hopeless.
- **Ability targets**: the controller inspects the current target prompt's game actions (bow, dishonor, remove fate, discard, honor, place fate, ...) and passes a hint to the policy. Harmful effects target the opponent's strongest legal card; helpful effects go to the bot's own side, preferring characters already in the conflict. Pure honor/dishonor prompts use the shared injectable `PersonalHonorTactics` first: honor the highest-glory friendly, accept forced dishonor on the lowest-glory friendly, and minimize any forced enemy honor. Enemy dishonor normally hits the highest-glory home character, but a participating target takes priority when its glory loss flips the conflict winner or creates a province break. This status path runs before source-card hints, whose `targetSide` is written from the event controller's viewpoint (the distinction that matters when an opponent plays Court Games). Unclassified effects resolve by side restriction first. When the intended side has no legal target, an optional bot-owned ability cancels before costs are paid. Engine-forced effects may select the bot's weakest legal character because Cancel is not a rules option. Cards marked `requiresPreferredTarget` are removed from the playable-source set unless the live selector exposes the intended side; Storied Defeat therefore cannot be opened when only a friendly duel loser is legal.
- **Attachments**: treated as long-term investments on the bot's own side — targets are scored by fate on the character (weighted heaviest, since fate keeps the character and the attachment alive across fate phases) plus skill in the current conflict type; while losing a conflict the attachment goes to a *ready* conflict participant so the skill swings the resolution. Bowed characters contribute no skill, so they are heavily penalized as attachment targets. Control attachments that can only legally attach to opponent cards degrade the opponent's strongest character.
- **Exact character metadata and gained Actions**: compact player summaries are not trusted for printed cost or base skill. The controller supplies exact `cardData.cost` and live `getBaseMilitarySkill()` maps keyed by character UUID. Target hints preserve the printed bearer as `sourceCardId` and, for a gained duel Action, its attachment origin as `duelSourceCardId`. This lets deck tactics apply the attachment's rules without pretending the character's printed card owns that ability; Lion's Elegant Tessen and True Strike Kenjutsu are the first consumers.
- **Reaction/interrupt windows**: triggers its own province and stronghold abilities (they are free and near-always worth firing, e.g. Meditations on the Tao); character and event reactions are still passed until per-card knowledge exists.
- **Ring effect resolution**: void strips fate from the opponent's highest-fate character and skips the ring rather than hit its own; fire honors its own highest-glory unhonored character, else dishonors the opponent's highest-glory character through the same personal-honor policy; water bows the opponent's strongest ready character, readies an own bowed one only while conflicts remain, else skips; air takes 1 honor when the opponent is near the dishonor loss or the honor win, else gains 2.
- **Covert**: assigns covert to the opponent's strongest ready defender.
- **Fate phase**: confirms the mandatory no-fate character discard. Every seed
  uses `MulliganTactics` to keep or replace each selectable dynasty card based on
  projected next-turn fate, board strength, holdings, and deck profile.
- **Opening mulligan**: every seed seeks a playable dynasty curve, replaces paid
  conflict cards, honors Tsuma and per-deck search goals, and evaluates every
  physical card in a stacked province independently. See
  [`mulligan-bot.md`](mulligan-bot.md).
- **Conflict-deck safety**: seeds 1 and 3 use the shared injectable
  `ConflictDeckSafetyTactics`. Optional Oracle of Stone and Forgotten Library
  draws, plus Shrine Maiden's optional three-card reveal, are declined when
  they would consume the margin required for the next mandatory draw or a
  visible forced effect such as Bayushi Shoju. Seed 2 keeps legacy behavior for
  A/B comparisons. See [`conflict-deck-safety-bot.md`](conflict-deck-safety-bot.md).
- **Everything else**: passes optional reaction/interrupt windows, prefers higher-skill cards on generic target prompts, and falls back to Done/Pass buttons.

- **Card playbook** (`CardPlaybook.ts`): hand-written per-card knowledge keyed by printed card id, sharing the LLM `CardHint` shape and consumed through the same lookup — a playbook entry always outranks the cached LLM analysis for the same card, and playbook cards are skipped by deck analysis entirely. Beyond the hint fields, entries can carry a `shouldPlay(ctx)` gate for hand plays (Assassination only with 6+ honor, Cavalry Reserves only with 2+ characters in the dynasty discard, Ujik Tactics only with 2+ physical ready participants, I Am Ready only for a bowed participant with fate; on the Crab side Siege Warfare only while attacking, Give No Ground / Raise the Alarm / The Strength of the Mountain only while defending), an `inPlayAction` flag with a `shouldUseAction(ctx)` gate for Action abilities on board cards fired during conflicts (Shiotome Encampment readies a Cavalry character, Shinjo Saddle moves off a bowed bearer, Shinjo Shono pumps when outnumbering, Shinjo Altansarnai fetches; Yasuki Hikaru moves a stronger attacker home, Frontline Engineer fetches a holding into the attacked province, Hida Sukune loots, Kaiu Shuichi gains fate, River of the Last Stand strips the opponent's hand), and a `dynastyAction` flag for Action abilities fired during the dynasty window (Kyuden Hida digs the top 3 for a character, Kaiu Forges tutors a holding, Unyielding Sensei digs a character into a holding province). Win-as-defender reactions and Unicorn win/attack payoffs carry priority ≥6 so their windows fire. Unicorn's injected `UnicornTactics` module reserves and scores movement targets for Golden Plains Outpost, Ride On, and Adorned Barcha; it can move a bowed character with exact ready support or a useful Minami/Higashi after-win reaction. It also supplies exact Shiksha/Soulweaver participant counts to Flank, Wayfinders, and Challenge while keeping Ujik physical-only. See `unicorn-bot.md`.

- **Deck strategy** (`deriveDeckStrategy`): the controller derives nine independent marker flags from the printed cards it owns: `holdingEngine`, `defensive`, `aggressive`, `dishonor`, `glory`, `monk`, `duelist`, `shugenja`, and `attachmentTower`. The first three configure generic deployment/commitment behavior. The remaining six inject specialized tactics modules through `DeckProfiles.ts`. A deck with no markers keeps `DEFAULT_PROFILE`. Preserving holdings during fate-phase province discard is universal.

## Conflict-card economy

Seeds 1, 2, and 3 share an injectable `conflictCardEconomy` profile. The
controller supplies printed fate costs by UUID for cards in the bot's
hand and conflict discard. A 0/1 budget planner values legal candidates from
playbook priority, relevant conflict skill, and ability value, chooses the
highest-total-value group that fits the live fate pool, then sequences the most
value-efficient member first.

Priority 9-10 cards receive a protection premium, so Pacifism, Display of
Power, Cavalry Reserves, and similar strategic cards remain live instead of
being suppressed by free filler. Missing costs, or a playable card whose
printed cost exceeds the current pool, preserve the old ordering. Consumed by
Five Fires and prepared Tadaka execute before Kyuden can consume their fate;
Dragon attachment/reducer ordering and Dragon card-count sequences remain
explicit higher-priority paths.

The engine rechecks legality and payment after every card. Printed costs are
therefore planning estimates, not a replacement for live cost modifiers;
unknown costs and mixed hand/in-play reaction windows keep priority order.

### Seed-1 validation

Controlled round robins used 40 games per matchup (1,800 games per run). The
first planner pass exposed a consistent swarm regression: Lion and Unicorn
each declined against 8 of 9 opponents. Their injectable profiles now retain
legacy conflict-card sequencing while all other decks use the planner.

| Deck | Before | Planner for all | Swarm-tuned |
| --- | ---: | ---: | ---: |
| Crab | 36.7% | 41.1% | 36.2% |
| Crane | 43.9% | 48.6% | 45.6% |
| CraneDuels | 13.1% | 17.2% | 15.3% |
| Dragon | 46.9% | 47.2% | 51.3% |
| DragonAttachments | 49.4% | 44.8% | 44.8% |
| Lion | 55.4% | 49.2% | 54.9% |
| Phoenix | 70.1% | 66.6% | 73.1% |
| PhoenixShugenja | 55.7% | 61.3% | 56.3% |
| Scorpion | 69.9% | 74.4% | 70.0% |
| Unicorn | 58.9% | 49.7% | 52.5% |

At this sample size, aggregate deck swings of roughly 5-7 points are within
run variance. The repeatable result is Lion's recovery after the swarm
exception; DragonAttachments already bypasses the main planner, so its mixed
result does not justify another exception. Raw reports: [before](../tools/selfplay/out/conflict-economy-baseline-seed1.md),
[planner for all](../tools/selfplay/out/conflict-economy-post1-seed1.md), and
[swarm-tuned](../tools/selfplay/out/conflict-economy-post2-swarm-legacy-seed1.md).

## Bot seeds

The bot `seed` selects the brain:

- **Seed 1 (default)** — the fate-aware heuristic. It preserves fate, invests in longer-lived expensive characters, and prioritizes rings holding fate.
- **Seed 2** — the old generic hand-written heuristic, retained for comparisons.
- **Seed 3** — seed 1 plus fair board/game-state-aware dynasty development.
  See [`board-aware-dynasty-bot.md`](board-aware-dynasty-bot.md).

Any seed may enable the optional hidden-hand and face-down-province capability.
See [`omniscient-bot.md`](omniscient-bot.md).

Seeds 1–3 are available in the normal client dropdown. Omniscience is a
separate capability available to every seed. All three use adaptive mulligan
by default.

## Standardized benchmark results

Standard win rates use 100 games per deck. Round robin defaults to 40 games per
matchup because its full matrix is much larger. Both use same-seed opponents:

```powershell
node tools/selfplay/winRates.js 100 <seed> [crane-seed]
node tools/selfplay/botRoundRobin.js --seed <seed>
```

The standardized opponent is the current 4736f7c0 **Crane Baseline** deck;
its public-deck-aware Gossip, duel/honor package, and validation are documented
in `crane-baseline-bot.md`.

Complete standard runs update
`jigoku-client/client/botBenchmarkResults.json`; custom game counts, policy
overrides, cross-seed Crane tests, selected-deck round robins, or incomplete
workers do not. Jigoku client reads that file dynamically and shows each
selected deck's vs-Crane and round-robin result for seeds 1, 2, and 3.

The 2026-07-18 province/stronghold validation used the saved pre-change N=100
round robins as baseline, then full N=40 matrices for seeds 1, 2, and 3. No deck
showed paired evidence for reverting the generic province order. The historical
seed-5 omniscient Phoenix
Shugenja was the one supported fine-tune: raising its preliminary threat ratio
to 1.5 moved its final round-robin result from 55.5% to 58.0%. Scorpion and
Dragon aggregate drops were rechecked with paired profile variants; current
province targeting won or tied most tested matchups, so no sample-driven deck
exception was added. Named reports live under `tools/selfplay/out/` with the
`province-defense-final-` and `profile-ab-` prefixes.

Per-card advice comes from one source: the hand-written playbook in
`CardPlaybook.ts`, read through the `cardHint(cardId)` callback. An LM Studio
integration used to supply hints for cards with no playbook entry; it was
removed on 2026-08-13 (no seed selected it, and the playbook had long since
outgrown it). See `bot-dead-code-removed.md`.

The policy remembers which cards/rings it already clicked for the current prompt (keyed by prompt title) so rejected or toggling clicks cannot loop; when every candidate has been attempted it falls back to a button or reports the prompt as unsupported. The dedup key is *normalized* — the live conflict skill totals (`Attacker: 4 Defender: 5`) and the ring element/type in a conflict title (`Political Fire Conflict`) are stripped — because those flip on every legal-but-idle ring toggle or reversible ability, and left in they would wipe the attempted-set before the bot exhausts its options and reaches its own pass fall-back. As a last-resort backstop the controller watches for the same normalized prompt surviving several full decision budgets (whether the budget landed moves or only produced rejected ones) and then force-clicks Pass/Done (`forceProgress`), so a seat can never freeze the game in a decision loop — this replaced the old behavior of logging and giving up.

## Card-shaped handler menus

Deck searches, look-at-top-N plays (Kyūden Hida) and attachment searches
(Illustrious Forge) present their choices as menu *buttons*, and
`PlayerPromptState.setPrompt` serialises the button's card down to id, name,
type and uuid. With no printed stats the policy had no basis to choose, so these
fell through to `fallback-button` — which takes the first button, i.e. deck
order. A coverage audit caught Kyūden Hida offering Kuni Ritsuko / Frontline
Engineer / Hida Kisada and taking Kuni Ritsuko.

The controller now supplies `menuCardInfo` (printed cost/military/political/
glory, keyed by uuid) from the live card objects, and the policy ranks on it:
printed skill first, glory as the tie-break, cheaper next, uuid last for
determinism. It prefers cards it can pay for — some of these menus play the card
— but falls back to the whole set rather than declining, so it never introduces
a failure the old fallback did not already have. It runs immediately before the
generic fallback, so it cannot pre-empt any title-specific handler, and it
returns nothing when the controller could not price the menu.

Enabled for every deck (`rankCardMenus`). The win-rate effect is +0.19pp over
three shuffle bases (n=540 paired), inside the noise floor; it ships because
picking the third-listed card is wrong play that a human opponent can see, not
because it moves the number.

Future strategy profiles can replace `JigokuBotPolicy` while keeping `JigokuBotController` as the command-path and trace boundary.

## Live pricing for conflict events

Characters and attachments reach the policy carrying printed skill, so
`handContribution` knows what they add to a conflict. Events carry nothing: they
report a contribution only if their playbook entry supplies a
`conflictContribution`, and six of the sixty-one events in the bot field did.
The other fifty-five read as "unknown", which made them invisible to
province-break budgeting and to the `strength-already-sufficient` veto.

`DeckProfile.liveEventPricing` turns on per-card models that compute what an
event is worth against the live board. The models are written to one rule that
is easy to get wrong: **`conflict.ts:474` drops a bowed participant's skill from
the conflict total**, so a pump aimed at a bowed body adds nothing, and readying
a bowed participant hands back its whole skill.

Representative models:

| Card | Was | Now |
| --- | --- | --- |
| Banzai! | flat 2 | 4 — the honor buys a second resolution and `banzai-recur-for-honor` already pays it; 2 at the honor floor |
| Compelling Testimony | flat 4 | `min(4, target's live political)` — −4 is a ceiling, not a payout |
| Forebearer's Echoes | unknown | printed military of the best body in the dynasty discard |
| Captive Audience | unknown | the actual swing from flipping the axis, both sides; 0 when the flip favours the opponent |
| Way of the Crane, Benten's Touch | unknown | the target's glory, which is what honored status adds to both skills |
| Against the Waves, I Am Ready | unknown | the skill of the bowed *participant* they ready; unpriced when the target is at home |

A model returning `null` means "does something I am not pricing" and leaves the
card playable — the right answer for a branch whose payoff is not skill in the
current conflict. Returning 0 instead would veto the play outright via
`zero-contribution`. `abilityValue` cannot be used to rescue those cases,
because it also reorders cards in `ConflictCardEconomy` and so would move the
A/B control arm.

Two data-shape bugs are worth remembering, because both priced their cards at a
flat zero and neither was visible without a probe. Glory lives in
`glorySummary.stat`; an in-play character has no `glory` field. And a card in
the dynasty discard has **empty** skill summaries — the engine only fills those
for cards in play — so recursion targets have to be priced from the controller's
`dynastyDiscardBodies`.

`Consumed by Five Fires` was not a pricing change but a dead gate: it required
five removable fate spread across the board, which passed 4 times in 491 windows
and never once alongside the five fate the card costs, so it was played zero
times in 90 games. The card says "up to 5", and the point is emptying one tower
— the character is discarded in the fate phase along with every attachment and
the honored token on it. Re-gated on the best single body it can empty, it plays
and is worth +2.5pp to PhoenixShugenja on its own.

`liveEventPricingExclude` holds named cards at their legacy reading. Pricing a
card is not automatically an improvement: a number activates the zero and
strength vetoes and changes where the card sorts, so a model that is correct in
isolation can still cost a deck games. `give-no-ground` did exactly that and is
left unpriced — see `bot-v2-rejected-experiments.md`.

### Measurement

Paired arms against the `off` control on identical shuffles, three independent
bases, n=1620 (`scratchpad/rr2.js`). A field round robin cannot measure this: it
is zero-sum, so a change applied to both seats averages to 50% by construction.

| arm | wins / 1620 | vs `off` |
| --- | ---: | ---: |
| `off` | 811 (50.06%) | — |
| all 15 models | 815 (50.31%) | +0.25pp |
| minus `give-no-ground` | 822 (50.74%) | +0.68pp |
| minus `consumed-by-five-fires` | 811 (50.06%) | +0.00pp |
| **shipped** (no `give-no-ground`, Banzai at 4) | **821 (50.68%)** | **+0.62pp** |

Positive on all three bases (+1.11 / +0.56 / +0.19pp) but inside the ±2.5pp
noise floor, so the win rate is not the argument for it. Per deck, the shipped
arm moves Unicorn +2.5, Dragon +1.9, Scorpion +1.9, PhoenixShugenja +1.2,
Lion +0.6, Phoenix −1.9, and **exactly 0.0 for every deck that runs none of
these cards** (Crane, CraneDuels, Crab, DragonAttachments) — which is what makes
the attribution mechanical rather than statistical.

Behaviourally, event plays over a 90-game census rise 1188 → 1233, Consumed by
Five Fires goes 0 → 6, and the `strength-already-sufficient` veto starts firing
on events at all, which was the point of pricing them.

## The honor race

Honor is a win condition on both ends: reaching 0 loses the game immediately and
reaching 25 wins it. 18.9% of field games end at 0 honor. `PlaybookContext`
exposed only the bot's own `honor`, so no card gate could see the race at all,
even though `DrawBidTactics`, `DuelBidTactics`, `BoardAwareDynastyTactics` and
`DeckConflictIntents` all read the opponent's pool.

The context now also carries `opponentHonor`, `myBrokenProvinces` and
`opponentBrokenProvinces`, and two things consume them behind
`DeckProfile.honorRaceAware` (off holds every gate at its legacy reading, so a
control arm stays bit-identical).

**A budget for printed honor costs.** Fate costs arrive from the engine as
`conflictCosts`; honor costs exist only in card text, so nothing priced them —
Assassination sells 3 honor on a hardcoded `honor >= 6` and the in-play Actions
(Shosuro Hametsu, Thunder Guard Elite, Moto Eviscerator) had no check outside
the dishonor decks. `honorSpendingAllowed` refuses a payment that lands on or
below a floor, refuses to sell honor while the honor win is in reach, relaxes
the floor once the opponent's stronghold is one break away (honor stops being a
resource we need at the end of the game), and raises it while trailing the
opponent by 5 or more — the public signature of an opponent actively draining
us. All six limits are injectable through `DeckProfile.honorRace`.

**Printed honor comparisons.** "Play only if you are less honorable than an
opponent" is a legality clause, not advice. Compromised Secrets and Forgery are
now gated on the real comparison instead of being clicked for the engine to
refuse.

The **draw bid needs no change**: `DrawBidTactics` already predicts a low
opponent bid at both honor extremes, already raises its own bid when either
stronghold is exposed, and the ordering case where a live conquest win sits
under an honor rail was measured unreachable — `pursue-honor-victory` fires
twice in 966 bids and `deny-opponent-honor-victory` never.

`honorRaceAware` **ships off: the win-rate result is exactly null.** A paired arm
at base 93001 (n=539) returned 282 wins against the `off` arm's 282 — the same
count, from a different set of games (discordant 9/6 against 7/4). The gate is
live (539 denials over a 90-game census) but the behavioural change is small:
honor-cost card plays move 196 → 184, because most denials land on cards the bot
re-evaluates each window and would not have played anyway. Per deck it is
Dragon +3.7, PhoenixShugenja +1.9, Scorpion −3.7, Unicorn −1.9 — a zero sum of
noise. What survives is the plumbing (`opponentHonor` is now available to every
gate that wants it) and the printed-legality fixes, which are correct
regardless.

One defect found and fixed while building this: pricing **Banzai** as a
1-honor card cost was wrong. Its honor buys an *optional* second resolution, so
budgeting it at the play vetoed a free +2. The budget belongs on the
`banzai-recur-for-honor` prompt and on the contribution (`banzaiRecurAllowed`),
not on the card.

## Defending past the exact threshold: measured, all variants rejected

Three knobs exist, **all default off, none shipped enabled**. They are retained
because the mechanisms are correct and cheaply re-testable, not because they
work. Full evidence in `bot-v2-rejected-experiments.md`.

- **`defenseBreakTie`** — attackers win ties (`conflict.ts:517`), so a defense
  that lands exactly on the attacker's skill saves the province but loses the
  conflict and the ring. The win-only path always added this 1; the shared
  prevent-break path never did. Rules-correct, and **worth zero**. Settled on
  **4319 head-to-head games across 24 independent bases**:

  | run | games | bases | result |
  |---|---:|---:|---|
  | first six bases | 1079 | 6 | +0.23pp, p=0.88 |
  | high-sample re-run | 3240 | 18 | **−0.43pp, z=−0.49, p=0.62** |
  | **pooled** | **4319** | **24** | **2148-2171, −0.27pp** |

  In the 18-base run: 4 bases positive, 9 negative, 5 exactly 90-90, extreme
  −2.22pp, every game decided (0 draws, 0 timeouts). Resampling three bases at
  random from that same settled-null result reads **≤ −1pp 17.8% of the time**.

  Its history is the best cautionary tale in this file. The paired rig rejected
  it at −1.18pp. The head-to-head then measured +1.02pp, **positive on all
  three** of its first bases, which looked like a clean reversal. Neither was
  real.

  The decisiveness probe explains why it swings so hard: the lever flips
  **5-8% of games** — the most of anything measured here — and wins about half
  of them. Pooled over 1350 paired games it flipped **74 decided games exactly
  37-37**. High decisiveness with no direction produces exactly this.

  **Why it is null is now known, and it is not a tuning problem** — see *What a
  defensive conflict win is actually worth* below. The extra point buys a denied
  ring effect and a claimed ring, not a ring; it costs a body worth **2.55
  skill** on average that is bowed for the round, and **49% of the time that
  body is the last ready one**.
- **`defenseTuning.breakTieMinReadyCount`** (**removed from the code**; the
  finding below stands, the knob does not — `defenseTuning` now carries only
  `strongholdMaxSurplusMargin` and `strongholdCapRequiresEnemyReserve`) — the
  one scope the telemetry actually pointed at: never spend the LAST ready body
  on the extra point. The
  whole of the unscoped lever's loss sits in that bucket (13 to / 22 away with
  one body left, against 11 to / 7 away with two or more). Marginal *skill* does
  not separate the buckets and neither does conflicts-remaining.

  It works mechanically — 12 fresh bases, flip rate 5.2% → **2.8%**, sign flips
  from −4 to **+4 (17 to / 13 away)** — and is still **rejected**: p=0.29, a
  +0.37pp point estimate against a 1.39pp ceiling, and ~70,000 head-to-head
  games needed to resolve a quarter of a point. Ships off.
- **`defenseThreatBufferRate` / `defenseThreatBufferCap`** — hold back skill for
  one opposing trick, sized from public hand count and fate. **−1.39pp** on the
  paired rig and **−1.11pp head-to-head, negative on all three bases** (−1.67 /
  −1.11 / −0.56). Both rigs agree; this one is settled.
- **`defenseThreatBufferIdleOnly`** — restricts the buffer to conflicts after
  which no conflict opportunity of ours remains. **Completely inert**: a
  90-game census returns the `off` numbers exactly (4678 card plays, 938
  defender clicks, 1829 defended, 944 held), because a defender essentially
  always still has a conflict of its own coming.

The premise was right and the conclusion still went the other way. Of 508
province breaks that happened *after* a defense was committed, **220 (43.3%)
broke by an excess of exactly 0** — one more point of defensive skill would have
saved each of them — and 322 (63.4%) by an excess of 2 or less. Attackers played
1.94 cards per such break, so the bot field already punishes a minimal block
about as hard as a human would, and no synthetic punisher was needed to measure
it. The buffer duly converts them: defender clicks rise 938 → 1091 and defenses
held rise 944 → 1073 over 90 games.

Those saved provinces are simply worth less than the bodies they cost. That is
now the fourth independent experiment to land there — Crab declaration sizing,
the omniscient full-threat defense, `applyPassPlan`, and this one — and the
sharpest statement of it available: **committing one extra body to convert a
tie into a win is a losing trade in this engine, even though the tie is a
guaranteed loss of the conflict and the ring.**

## Conflict declaration and attacker allocation: what V1 already has

Asked "port V2's attacker allocation into V1" the honest answer is that **it is
already there**. `applyAttackerPlan` — the phase rollout that commits the
smallest set of bodies that wins the whole PHASE instead of sizing each attack
against the conflict in front of it — was V2's one measured win (+6.9pp pooled,
McNemar p=0.00087) and **shipped into V1 on 2026-07-31**. It is `true` in both
`DEFAULT_CONFLICT_PHASE_PLANNER` and `RUSH_CONFLICT_PHASE_PLANNER`
(`ConflictPhasePlanner.ts:177,228`), and every V1 deck profile resolves to one of
those two. Live path: `JigokuBotPolicy.ts:2456` (`useAttackerPlan`) →
`plannedNext` → `conflict-lookahead-attacker`.

`docs/bot-v2-deck-tuning.md` still said these flags "stay off globally"; that
line is now marked stale. Verify with `tools/selfplay/analyzeAttackSize.js`
rather than by reading a profile — a flag being true has twice failed to mean a
mechanism is reached.

The declaration layers that are genuinely still V1-off, and their status:

| layer | state | evidence |
|---|---|---|
| `applyAttackerPlan` | **ON for V1** | +6.9pp, shipped 2026-07-31 |
| `applyTargetPlan` (province) | **ON for V1** | planner default |
| `applyPassPlan` | off, **rejected** | −10.4pp vs V1 at n=900; worst result in the V2 program |
| `secureReachableBreak` | off, **rejected** | −5.5pp vs shipped V2 at n=900 |
| `hopelessAttackKeepHome` | off, **rejected on merit** | looked best at n=900 (+2.7pp), null at n=2600 (+0.4pp) |
| `applyTypePlan` (axis) | off | rollout-chosen axis; +11.1pp Phoenix / −5.6pp Scorpion on 4 decks, never measured cross-deck |
| `applyRingPlan` | off | never measured |
| `applyIntentPlan` (deck-authored) | off, **and unused** | `DEFAULT_CONFLICT_INTENTS.enabled=false`, `rules: []` for all ten decks |

That last row is worth stating plainly: the mechanism for a deck to author its
own declarations exists, is wired, and **no V1 deck uses it**. A deck-authored
plan bypasses the generic apply flags by design (`JigokuBotPolicy.ts:2450`), so
if a deck ever does own its declaration it will win over anything generic
without needing a flag.

### The gap that is NOT a rollout question: the axis is chosen blind

`preferredConflictType` picks the axis on **its own ready board alone**. The
omniscient variant immediately below it picks the axis with the largest real
differential — mine minus theirs minus their affordable hand tricks — and only
that last term is hidden information. The opponent's ready board is public, and
the fair `ringScore` a few lines away already reads it (it counts their fateless
bodies for water and their fated ones for void).

So the fair bot declares into the axis it is strongest on even when that is the
axis the opponent is strongest on. `ConflictDeclarationPolicy.opponentBoardWeight`
closes that, with the zero-skill guards the omniscient path needed (subtracting
an empty board makes an axis we cannot legally attack on look best; that made
the bot toggle the conflict type, fail to commit, and lose the conflict).

**Measured population** (540 paired games, 44536 telemetry events, weight 1):
V1 makes **3798 axis decisions**; 21.9% are already claimed by `forceMilitary`
and 3.1% by the zero-skill guards, leaving 75% on the own-board comparison. At
weight 1 the policy moves **715 of them (18.3%)**, and the shape of those moves
is the whole story:

| | |
|---|---|
| military → political | **602 (84%)** |
| political → military | 113 |
| own skill given up per switch | 1.90 |
| **opposing skill dodged per switch** | **5.40** |
| net differential gained | **+3.51** |
| switches off an axis we were **already losing on raw skill** | **507 (71%)** |

V1 over-declares military — its tie-break is `military >= political` and most
boards carry more military skill — and 71% of the time it was declaring into a
wall it could see. The lever flips **12.6% of games**, the highest decisiveness
of anything measured in this project.

**Two decks are provably unaffected, by design.** Lion (473 of 473 decisions)
and Unicorn (359 of 361) resolve through `forceMilitary` before the policy is
consulted, so their declaration stays owned by the rush profile and the cavalry
movement engine. That is the intended answer to "not every deck wants this":
the guard is in the policy, not in a per-deck opt-out list.

**SHIPPED ON, `opponentBoardWeight: 1`.** Head-to-head, changed bots against
unchanged bots, pooled over **36 independent bases and 6468 games**:

| base set | record | result |
|---|---|---:|
| 91001-96001 | 570-510 | +2.78pp |
| 120001-131001 | 1087-1067 | +0.46pp |
| 140001-157001 | 1679-1555 | +1.92pp, p=0.029 |
| **pooled** | **3336-3132 of 6468** | **+1.58pp, z=2.54, p=0.011** |

Positive on all three base sets and on **26 of 36 individual bases** (sign test
p=0.0035). Null arm exactly 50.00%. This is the first V1 win-rate improvement
since `applyAttackerPlan`, and it clears every bar in `.claude/skills/roundrobin`
— reachability, ceiling, null arm, three-to-reject/six-to-accept, and
replication on base sets never used to form the hypothesis.

Verified after enabling, because "the flag is set" has failed to mean "the
mechanism runs" twice in this project:

- `refactorIdentity.js` moved from `04bb672a3543db31` to `fdac489933f41c64`,
  so V1's behaviour genuinely changed.
- Injecting the NEW default (`opponentBoardWeight: 1`) is now a no-op and scores
  **exactly 50.00%** (269-269).
- Injecting `opponentBoardWeight: 0` measures OLD V1 against shipped V1 and
  scores **−2.09pp (1032-1122 of 2154, p=0.052)** on twelve bases never used
  before. The effect replicates in the opposite direction at the expected size.

Total evidence on this lever: **~10,200 games**, two null arms at exactly
50.00%, three forward base sets and one reverse.

#### The tie the weight introduced (`ownAxisDominanceMargin`, 2026-08-23)

Subtracting the opponent board makes the two axes TIE whenever they out-defend
us equally on both, and `preferred = military >= political` then resolves the
tie toward military — the wrong half of a political board. Measured live on
Asako Togama alone at 2 military / 5 political against a dashed-military 0/4
and a 3/2: `military = 2-3 = -1`, `political = 5-6 = -1`, and the bot declared
MILITARY with 2 skill into a 3-skill defense. `switchMargin: 0` cannot catch
it either, because the guard is `gain < switchMargin` and the gain is 0.

`ownAxisDominanceMargin: 2` / `dominantAxisSwitchMargin: 2` (both shipped in
`DEFAULT_PROFILE`, both 0 in the class default so it stays V1-inert) make a
differential earn 2 points before it may overrule an own board that leans 2+
the other way. The branch is reached only when `preferred !== baseline`, so it
can only BLOCK a switch, never cause one, and it is symmetric — a 9-military
board no longer abandons its axis to attack with 2 political either.

Correctness rather than a lever: **1 winner flip in 112 replayed shuffles**,
and the field arm carrying it read +0.43pp / p=0.729 over 1632 games against a
null arm at exactly 50.00%. New telemetry reason `below-dominant-margin`.
See [bot-phoenix-replay-2026-08-23.md](bot-phoenix-replay-2026-08-23.md).

### The two rigs appeared to disagree, and taking that apart is the finding

The first two numbers for this lever were **+4.07pp (p=0.0055)** from the paired
probe and **+0.46pp (p=0.667)** from the head-to-head over four times the games.
Two diagnostics, each targeting one candidate explanation, closed the gap
exactly:

| measurement | bases | result |
|---|---|---:|
| probe, change on **seat 0** | 91001-96001 | 45 flips to / 23 away, **+4.07pp** |
| probe, change on **seat 1** | 91001-96001 | 34 to / 26 away, **+1.48pp** |
| **probe, seat-averaged** | 91001-96001 | **+2.78pp** |
| **head-to-head, same bases** | 91001-96001 | **+2.78pp**, 6 of 6 bases positive |
| head-to-head | 120001-131001 | +0.46pp |

1. **Seat interaction.** The paired rig treats ONE seat and never swaps it, so a
   first-player interaction survives in it and cancels in the head-to-head by
   construction. The same lever measures **2.7x larger** on seat 0 than seat 1.
2. **Base selection.** With seats averaged the two rigs agree *to the decimal*.
   Everything left is the bases: 91001-96001 are worth +2.78pp to this lever and
   120001-131001 are worth +0.46pp.

So the rigs never disagreed. **Always run `SEAT=0` and `SEAT=1` before believing
a paired estimate**, and never compare two rigs across different base sets.

Weight is not the lever's problem either — the response is flat, not peaked at a
value the sweep missed:

| weight | bases | games | result |
|---|---|---:|---:|
| 0.5 | 120001-125001 | 1079 | +0.51pp, p=0.738 |
| 1.0 | 120001-131001 | 2154 | +0.46pp, p=0.667 |
| 1.5 | 120001-125001 | 1078 | +0.56pp, p=0.715 |
| null arm | 120001-122001 | 540 | exactly 50.00% |

Those three share bases and are **not** independent replications; read their
agreement as "the lever is small here", not as "three studies agree".

### Per deck: it helps exactly the decks that do not own their declaration

Only one seat carries the change in a paired probe, so a flip IS that deck's
causal effect. Pooled over BOTH seats (1080 games, 6 bases) — never read a
single-seat per-deck row, Phoenix reads −1 on seat 0 alone and +1 pooled:

| deck | flips to / away | net |
|---|---|---:|
| PhoenixShugenja | 15 / 6 | +9 |
| CraneDuels | 12 / 6 | +6 |
| DragonAttachments | 9 / 4 | +5 |
| Crane | 7 / 4 | +3 |
| Scorpion | 10 / 7 | +3 |
| Dragon | 12 / 10 | +2 |
| Phoenix | 4 / 3 | +1 |
| Crab | 10 / 9 | +1 |
| **Lion** | **0 / 0** | **0** |
| **Unicorn** | **0 / 0** | **0** |
| **total** | **79 / 49** | **+30 (+2.78pp)** |

**Eight of eight non-rush decks positive, none negative**, and the two rush
decks record *exactly zero flips* because `forceMilitary` returns before the
policy is consulted. That is the shape a correct-but-small mechanism has, and it
is why the guard belongs in the policy rather than in a per-deck opt-out list.

## Injectable decision policies

Three decisions have been lifted out of `JigokuBotPolicy`'s inline arithmetic
into policy objects. Each is a **pure function of a described input**, each
ships with every knob at the value that reproduces V1 exactly, and each is
configured from a `DeckProfile` field that the V2 profile-injection path
carries, so an arm is a JSON string and never an edit:

| class | owns | profile field |
|---|---|---|
| `DefenseCommitmentPolicy` | how much skill a defense commits | `defenseTuning` |
| `ConflictDeclarationPolicy` | which conflict axis to declare | `conflictDeclaration` |
| `BotTelemetry` | opt-in decision event sink | — (static) |

```sh
CHANGE='{"deckProfile":{"defenseBreakTie":true,
        "conflictDeclaration":{"opponentBoardWeight":0}}}' \
  node tools/selfplay/parallelHeadToHead.js
```

**Name only a sub-profile the deck already has.** `decisionProfile` refuses
to CREATE a deck-scoped module (`shugenja`, `rebirth`, `craneHonor`, ...) on
a deck whose base profile has none, because presence of the key is what
switches that module on. Before that guard a top-level `shugenja` arm handed
every deck in the field a partial profile and lost 16 of 16 measured games on
Crab. Scope a deck-specific knob with `deckProfileByArchetype` instead; see
[deck-profiles.md](deck-profiles.md).

Two rules learned from the levers that came before them:

- **A null arm cannot catch a bad refactor.** Injecting a knob at its default
  moves both seats together, so it still scores exactly 50.00% whether or not
  the extraction preserved V1. Use `tools/selfplay/refactorIdentity.js`, which
  hashes a fixed slate of game outcomes, before and after. Both extractions here
  were verified bit-identical that way (`SHA 04bb672a3543db31`, which V1 and V2
  pass-through also share — an independent check that pass-through is V1).
- **`Number(x) || 0` at every profile read.** A partial injected profile leaves
  sibling fields `undefined`; `undefined` in arithmetic yields `NaN`, and `NaN`
  in a comparison chain silently falls through to whatever tie-break is next.
  That failure mode has already cost a full measurement cycle here.

## What a defensive conflict win is actually worth (engine facts)

The tie-break above was measured five times before anyone read what the extra
point BUYS. Three engine facts settle it, and none of them is in the bot code:

1. **The attacker takes the ring's fate at declaration**, before defenders are
   even declared (`conflictflow.ts:381-400`, `takeFateFromRing` with
   `recipient: attackingPlayer`). By the time the defense is being sized the
   fate is already gone. A defensive conflict win cannot recover it.
2. **Only the attacker resolves the ring effect.** `resolveRingEffects` is
   wrapped in `if(this.conflict.isAttackerTheWinner())` (`conflictflow.ts:903`).
   A defender who wins claims the ring but does **not** resolve it — which is
   precisely why cards exist to grant that (Defend the Wall, Staunch Hida,
   Guardian Kami, Akodo Toturi all carry `resolveConflictRing`).
3. **Every defender bows on return home** (`conflictflow.ts:938-953`), so the
   marginal body is spent for the round either way.

So the trade is: **one extra body, bowed, in exchange for denying the attacker
one ring effect and holding a claimed ring.** Not "winning a ring".

### The bot's own value model disagrees with the engine, and the engine is right

`ConflictPhasePlanner.evaluateDefense` credits a defensive conflict win
with the full symmetric `conflictWinValue` (**2.5**) plus
`claimedRingValue * ringValue` (**0.6**), against `readySkillValue` of **0.12**
per ready skill point. The measured marginal body costs **2.55 skill**, i.e.
about **0.31**. That model prices the tie-break as an 8:1 bargain.

Measurement says it is a coin flip. The comment one line above the credit even
says *"the defender claims the contested ring without resolving it"* — the rule
was known and the value was still set symmetric. **`conflictWinValue` is roughly
8x too high for a DEFENSIVE conflict win.** It is fine on the attack side, where
the winner really does take the fate and resolve the effect. Anyone enabling
`applyDefensePlan` must split this term first.

## How a dynasty character is actually bought

Four facts about this decision were established by measurement while building
`DynastyAbilityValue`, and they are worth knowing before touching it again.

**The live path is `fateAwareDynastyDecision`, not `BoardAwareDynastyTactics`.**
`BoardAwareDynastyTactics.choose` is never called by any of the ten field deck
profiles — instrumenting it across field games returns a call count of zero, and
a 90-game census with a price list wired into `candidatePower` alone came back
bit-identical to the control (buy-histogram sha `78c96e35aa4e1358`, 483 rounds,
1138 buys). The class is still exercised by its own specs and by profiles that
enable it, but changing it does not change how the field plays.

**Check that a mechanism is live before improving it.** This is the second one
found inert. `ConflictPhasePlanner.planDefense` contains an honor-aware chump
block — `honorPressure = clamp((8 - honor) / 6, 0, 1)` scaling `unopposedValue`,
covered by `conflictdefenseplan.spec.js` — and it never runs in a field game
either, because `applyDefensePlan` defaults to `false` and no deck profile turns
it on (defense planning measured negative, see `bot-v2-rejected-experiments.md`).
So `profile.chumpBlock` in `JigokuBotPolicy` is not a fallback beneath a smarter
planner; it is the only chump-block mechanism V1 actually executes. A passing
spec proves a mechanism is correct, not that it is reachable.

**The live ordering never looks at the printed line.** Both sorts in
`fateAwareDynastyDecision` are cost-first, then `conflictProjectionScores`, then
a uuid string compare. The projection is only computed for three candidates, so
equal-cost cards are usually separated by nothing but a string comparison.

**The controller's ability term is a saturated constant.** Across all 117
dynasty characters in the field it takes exactly three values:

| `abilityValue` | characters | buys |
| --- | ---: | ---: |
| 3.50 | 24 | 313 |
| 3.95 | 3 | 3 |
| 4.00 | 90 | 729 |

`JigokuBotController.dynastyCharacterInfo` computes
`min(4, abilityCount * 0.7 + strategicTerms * 0.45)`, and the engine registers
5-6 *framework* reactions on every character, so `abilityCount * 0.7` alone is
already 3.5-4.2 before a word of card text is read. The whole field spans 0.375
once `abilityValueWeight` is applied, against a `primarySkillWeight` of 1. The
term is also unsigned, and its phrase list contains `cannot be`, `honor ` and
`dishonor` — so Hiruma Yojimbo scores its "cannot be declared as an attacker"
as a *bonus*, and Shiba Peacemaker (4 military that may never attack) is
indistinguishable from a vanilla body.

**A tie-break is decided by sign, not magnitude.** `dynastyAbilityScale` at
0.5, 1.0 and 1.5 produces a bit-identical 90-game run (sha `0eec453e9345b60d`),
because any positive multiplier preserves every comparison. It is an on/off
switch. `dynastyAbilityCostWeight` is the knob that genuinely sweeps: it shifts
the cost the *ordering* sees, so a price can move a card between cost tiers,
while affordability and every budget cap keep using the real printed cost.

## Pricing dynasty abilities: measured, not shipped

`DynastyAbilityValue.ts` prices the **static** printed text on 50 dynasty
characters as a signed skill-equivalent — restrictions negative, auras and
permanent modifiers positive — filling the gap the saturated ability term leaves.
Static text is the only kind a constant models correctly; an Action or Reaction
depends on a board the table cannot see, so those keep the existing term and the
two models cannot double-count.

Two knobs, **both default off**, and the disabled path is bit-identical (an `off`
census reproduces buy-histogram sha `78c96e35aa4e1358`, 483 rounds, 1138 buys):

- `dynastyAbilityScale` — folds the price into the tie-break after cost.
- `dynastyAbilityCostWeight` — shifts the cost the *ordering* sees, so a price
  can move a card between cost tiers. Affordability and every budget cap keep
  using the real printed cost.

Measured with the direct challenge (`tools/selfplay/headToHeadRoundRobin.js`,
changed bots against unchanged bots, 90 ordered cross-deck pairings, both
orientations per shuffle, 540 games per arm, null arm exactly 50.00%):

| arm | record | vs 50% | 91001 | 92001 | 93001 |
| --- | --- | ---: | ---: | ---: | ---: |
| null (no-op) | 90-90 | 0.00pp | — | — | 0.00 |
| `dynastyAbilityScale` | 276-264 | +1.11pp | +1.11 | +0.56 | +1.67 |
| + `dynastyAbilityCostWeight` | 275-265 | +0.93pp | +0.56 | +0.56 | +1.67 |
| `chumpBlock` field-wide | 273-265 | +0.74pp | +0.56 | −1.67 | +3.33 |
| `chumpBlock` scoped | 271-269 | +0.19pp | 0.00 | −0.56 | +1.11 |

**Positive on all three bases — and it was still noise.** Three further bases,
run on the same rig with its own null arm returning 90-90 on each of them:

| bases | record | vs 50% |
| --- | --- | ---: |
| 91001 / 92001 / 93001 | 276-264 | +1.11pp |
| 94001 / 95001 / 96001 | 270-270 | **0.00pp** |
| **pooled, 1080 games** | **546-534** | **+0.56pp** (z=0.37, p=0.72) |

Per base across all six: +1.11, +0.56, +1.67, +1.11, −0.56, −0.56. Three bases
landing the same way is a one-in-four coincidence, not a result. This is the
clearest example in the program of why the bar is several independent bases:
the lever was positive on 3 of 3, agreed with a completely separate measurement
method on its magnitude, and was worth nothing.

The ceiling had already said so. `measureDecisiveness.js` replays each shuffle
with and without the change: the price list leaves **91.5% of games
bit-identical** and flips the winner in **9 of 270 (3.3%)**, capping any
possible effect at 1.67pp — inside the noise floor. Separating even +1.1pp from
zero in the head-to-head would need roughly **7800** games. **Measure the
ceiling before the win rate; when it lands under the noise floor, the win rate
cannot be believed in either direction.**

The binding constraint is the **insertion point, not the prices**. The list
touches 47.3% of all dynasty buys (494 of 1045) yet changes almost no games,
because the ordering is cost-first and a price can therefore only choose between
equal-cost cards — which are usually interchangeable in effect. Letting the
price move cards *across* cost tiers was the obvious fix and did not help
(90.0% of games still unchanged), which rules the approach out rather than
leaving it open. **Do not re-tune these values; a different decision would have
to be the target.**

## Limits

- Specialized behavior exists only for registered marker/profile combinations;
  an unknown deck falls back to the generic profile.
- Seeds 1, 2, and 3 are hand-written policies.
- Unsupported prompt shapes leave a trace entry and use the controller's
  bounded progress fallback.
- Bot games are labeled in save state and skipped for the external analytics
  game-report post.
