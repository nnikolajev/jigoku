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
    "difficulty": "mvp",
    "trace": true
  }
}
```

When `policy` is omitted, the seed selects the policy. Seeds 1 and 5 use the
fate-aware policy documented in [`fate-aware-bot.md`](fate-aware-bot.md); seed 5
also receives omniscient context. Seed 2 preserves the old generic heuristic.
Explicit `generic` / `fate-aware` values remain available for paired analysis.

The lobby creates a second player named `Jigoku Bot`, hydrates the configured deck, and starts the normal game-server handoff for the human player.

## Policy

The policy is deterministic for a fixed seed. It reads only the bot player's own player-perspective state (never the opponent's prompt or hidden information) and records every successful, rejected, or unsupported decision.

Current heuristics:

- **Honor bid**: always bids 5 on round 1 (honor is at its peak and the card tempo is worth it). Afterwards the guiding rule is that cards win games and honor is the currency to buy them: it bids by the hand-size gap (3+ cards behind → 5, behind at all → 4, equal or a small hand → 3, comfortable → 2, ahead with a full hand → 1), then applies safety rails — with 5 or less honor it bids at most 2 and never above the opponent's predicted bid, an honor floor shrinks the bid so the worst-case transfer cannot drop it below 6 honor, it never outbids a predicted opponent bid when they are within reach of the 25-honor victory, and at 20+ honor it underbids to farm the difference toward its own honor win. Honor 2 or lower always bids 1. The opponent's bid is predicted from their hand size and honor.
- **Dynasty phase**: plays faceup dynasty characters from its provinces during the dynasty action window (game-side cost validation rejects unaffordable plays without mutation), then passes.
- **Fate on characters**: the controller reads the printed cost off the 'Choose additional fate' prompt step and the policy scales the investment with it — cost 0–2 characters get no fate (disposable bodies), cost 3–4 get 1, cost 5+ get 2, plus 1 more when fate is plentiful. It keeps 1 fate in reserve for conflict cards, except for cost-5+ characters: the powerhouse itself is the investment, so the reserve is spent rather than dropping it onto the board with no fate.
- **Conflict declaration**: ring choice and conflict type are independent decisions, because any ring can be flipped military/political by clicking it again. Rings are scored purely by value — a ring holding 2+ fate is taken as a straight fate boost (biggest pile first); otherwise void leads but only when the opponent has a character with fate to strip, earth (card advantage) is always good, fire (honor/dishonor) is next, water is situational (strong when the opponent has 2+ ready no-fate characters to bow, mildly useful for readying an own bowed character while more conflicts remain, dead otherwise) and air trails. The conflict type comes from character strength: if the declared type does not match the side where the bot's ready characters carry more total skill, it clicks the ring again to flip it before committing. It attacks the first unbroken opponent province (facedown provinces via `facedownCardClicked`). Attacker count is driven by break math: it commits skill until the total clears the attacked province's strength (4 assumed when facedown) plus the opponent's full possible ready defense; only when that target is unreachable does it fall back to sending everyone but the weakest, who stays home as a defender. It passes the conflict when no ready character has positive skill. The same scoring also drives generic 'choose a ring' prompts from card abilities.
- **Defenders**: parses the `attacker vs defender` skill line from the prompt and applies break math (a province breaks when attacker skill wins by at least the province strength): defends to win when its ready skill can reach the attacker's total, otherwise defends just enough to prevent the break, and commits nothing to hopeless defenses. When the stronghold province is attacked, ordinary caps are disabled and all ready defenders plus useful conflict cards remain available.
- **Last-province defense**: once three own provinces are broken, `StrongholdDefenseTactics` runs before every declaration. It accounts for combined stronghold/province strength, both conflict axes, remaining conflict opportunities, Covert, and the minimum ready defender set needed for the counterattack. It skips offense when safety cannot be proved. It attacks freely when the opponent is bowed, attacks all-in on the last conflict opportunity, and races all-in when both strongholds are exposed. Seed 5 adds exact affordable hand boosts and defender-disabling effects; fair seeds use visible board skill.
- **Conflict action windows**: driven by break math, not just the win/lose gap. As the attacker it keeps playing until its skill lead reaches the attacked province's strength (winning 3 vs 0 against a 5-strength province breaks nothing — it plays 2 more skill), and stops once the break is secured or when the remaining deficit exceeds 6. As the defender it spends cards only to keep the attacked province from breaking or to steal a win within 3 skill; a lost conflict that breaks nothing is answered by saving the hand for its own attack. When acting, it first clicks its stronghold, the attacked province, and any board card with a playbook-known Action ability (see below; bowing is the cost, not fate; clicks with no legal ability are rejected without mutation), then — with at least 1 fate in reserve — plays cards from hand through the normal play menus. Hand candidates are filtered by the controller's `handStats` hint (printed skills/bonuses, hidden from summaries outside the play area): cards that add nothing to the current conflict type are skipped (no military attachments in political conflicts), and known contributions are played strongest first. Passes when already winning or when the conflict is hopeless.
- **Ability targets**: the controller inspects the current target prompt's game actions (bow, dishonor, remove fate, discard, honor, place fate, ...) and passes a hint to the policy. Harmful effects target the opponent's strongest legal card; helpful effects go to the bot's own side, preferring characters already in the conflict. Pure honor/dishonor prompts use the shared injectable `PersonalHonorTactics` first: honor the highest-glory friendly, accept forced dishonor on the lowest-glory friendly, and minimize any forced enemy honor. Enemy dishonor normally hits the highest-glory home character, but a participating target takes priority when its glory loss flips the conflict winner or creates a province break. This status path runs before source-card hints, whose `targetSide` is written from the event controller's viewpoint (the distinction that matters when an opponent plays Court Games). Unclassified effects resolve by side restriction first. When the intended side has no legal target, an optional bot-owned ability cancels before costs are paid. Engine-forced effects may select the bot's weakest legal character because Cancel is not a rules option. Cards marked `requiresPreferredTarget` are removed from the playable-source set unless the live selector exposes the intended side; Storied Defeat therefore cannot be opened when only a friendly duel loser is legal.
- **Attachments**: treated as long-term investments on the bot's own side — targets are scored by fate on the character (weighted heaviest, since fate keeps the character and the attachment alive across fate phases) plus skill in the current conflict type; while losing a conflict the attachment goes to a *ready* conflict participant so the skill swings the resolution. Bowed characters contribute no skill, so they are heavily penalized as attachment targets. Control attachments that can only legally attach to opponent cards degrade the opponent's strongest character.
- **Reaction/interrupt windows**: triggers its own province and stronghold abilities (they are free and near-always worth firing, e.g. Meditations on the Tao); character and event reactions are still passed until per-card knowledge exists.
- **Ring effect resolution**: void strips fate from the opponent's highest-fate character and skips the ring rather than hit its own; fire honors its own highest-glory unhonored character, else dishonors the opponent's highest-glory character through the same personal-honor policy; water bows the opponent's strongest ready character, readies an own bowed one only while conflicts remain, else skips; air takes 1 honor when the opponent is near the dishonor loss or the honor win, else gains 2.
- **Covert**: assigns covert to the opponent's strongest ready defender.
- **Fate phase**: confirms the mandatory no-fate character discard, then discards all leftover faceup dynasty cards from unbroken provinces so they refill with fresh cards.
- **Everything else**: keeps mulligans, passes optional reaction/interrupt windows, prefers higher-skill cards on generic target prompts, and falls back to Done/Pass buttons.

- **Card playbook** (`CardPlaybook.ts`): hand-written per-card knowledge keyed by printed card id, sharing the LLM `CardHint` shape and consumed through the same lookup — a playbook entry always outranks the cached LLM analysis for the same card, and playbook cards are skipped by deck analysis entirely. Beyond the hint fields, entries can carry a `shouldPlay(ctx)` gate for hand plays (Assassination only with 6+ honor, Cavalry Reserves only with 2+ characters in the dynasty discard, Ujik Tactics only with 2+ ready participants, I Am Ready only for a bowed participant with fate; on the Crab side Siege Warfare only while attacking, Give No Ground / Raise the Alarm / The Strength of the Mountain only while defending), an `inPlayAction` flag with a `shouldUseAction(ctx)` gate for Action abilities on board cards fired during conflicts (Shiotome Encampment readies a Cavalry character, Shinjo Saddle moves off a bowed bearer, Shinjo Shono pumps when outnumbering, Shinjo Altansarnai fetches; Yasuki Hikaru moves a stronger attacker home, Frontline Engineer fetches a holding into the attacked province, Hida Sukune loots, Kaiu Shuichi gains fate, River of the Last Stand strips the opponent's hand), and a `dynastyAction` flag for Action abilities fired during the dynasty window (Kyuden Hida digs the top 3 for a character, Kaiu Forges tutors a holding, Unyielding Sensei digs a character into a holding province). Win-as-defender reactions (Hida Kotoe, Hida O-Ushi, Kuni Ritsuko, Staunch Hida, Purifier Apprentice, Guardians of Rokugan, Watch Commander's honor bleed, Seventh Tower, Watchtower of Valor, …) carry priority ≥6 so the reaction/interrupt path fires them, as do the Unicorn rush's win/attack payoffs (Spoils of War draw-3, Utaku Battle Steed, Minami Kaze). The rush deck adds hand-play gates for Flank the Enemy (only while outnumbering), Captive Audience (convert a political conflict to military), Challenge on the Fields (military duel with 3+ participants) and Ride On (pull a home Cavalry into the conflict — the move-mode menu is resolved to "move in" and the target steered to a ready home body), plus draw/pump attachments (Spyglass, Curved Blade, Born in War). Curated for the Unicorn cavalry precon and the Crab "Kaiu Wall" defense precon; other decks fall back to LLM hints and generic heuristics.

- **Deck strategy** (`deriveDeckStrategy`): the controller derives nine independent marker flags from the printed cards it owns: `holdingEngine`, `defensive`, `aggressive`, `dishonor`, `glory`, `monk`, `duelist`, `shugenja`, and `attachmentTower`. The first three configure generic deployment/commitment behavior. The remaining six inject specialized tactics modules through `DeckProfiles.ts`. A deck with no markers keeps `DEFAULT_PROFILE`. Preserving holdings during fate-phase province discard is universal.

## Conflict-card economy

Seeds 1, 2, and 5 share an injectable `conflictCardEconomy` profile. The
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
- **Seed 3** — the local LLM is in charge. At every single step the bot acts, the controller enumerates *every legal move* for the current prompt — enabled buttons, selectable rings, selectable/clickable cards, and the opponent's provinces in attack windows — validates each through the same legality gate the executor uses, and hands the whole option set to the model together with the full visible game state (phase/round/conflict/honor/fate/provinces), the bot's hand with printed card text, and both players' board characters and the rings. Each option carries a numeric `id` and a human `label`; the model replies with the id of the one option to execute (`{"option":3,"reason":"..."}`). The parser is lenient (accepts the id, a bare index, or an exact label) so a slightly-off answer from a thinking model still lands on a legal move. One call = one click, so multi-step plays (pick card → pick target → pick mode button) are separate consults, exactly like a human clicking through. The heuristic policy still runs first as a guide and is appended to the option list as a labelled fall-back. On any miss — hallucinated id, timeout, unreachable model, or even a game-rejected pick — the resolver walks the model pick, then the heuristic option, then every remaining enumerated option and executes the first the game accepts. Forced single-option steps skip the model. Seed 3 requires `bot.llm.enabled`; without a reachable model the seat stays on its base heuristic.

- **Seed 4 (experimental, not competitive)** — the learned evaluator formerly numbered seed 3. Self-play trains a model that scores legal moves in process. The infrastructure remains available, but the trained model performs worse than the heuristic and needs an injected evaluator.
- **Seed 5** — seed 1's fate-aware heuristic plus omniscient logic. It can see the opponent's hand, fate, and face-down province strength.

Seeds 3 and 4 are hidden from the normal client dropdown because they require
external planner/evaluator services and are not competitive defaults. Seed 5
remains selectable as the cheating/hardest option.

## Standardized benchmark results

Both self-play scripts default to 100 games and same-seed opponents:

```powershell
node tools/selfplay/winRates.js 100 <seed> [crane-seed]
node tools/selfplay/botRoundRobin.js --seed <seed> --games 100
```

The standardized opponent is the current 4736f7c0 **Crane Baseline** deck;
its public-deck-aware Gossip, duel/honor package, and validation are documented
in `crane-baseline-bot.md`.

Complete standard runs update
`jigoku-client/client/botBenchmarkResults.json`; custom game counts, policy
overrides, cross-seed Crane tests, selected-deck round robins, or incomplete
workers do not. Jigoku client reads that file dynamically and shows each
selected deck's vs-Crane and round-robin result for seeds 1, 2, and 5.

With a local LM Studio server configured (`bot.llm`), the bot additionally analyzes its deck's card text into per-card hints and can consult the model live on ambiguous target prompts — see `heuristic-bot-llm.md`.

Planned improvements live in `heuristic-bot-roadmap.md` (in-play abilities, scored-candidate policy).

The policy remembers which cards/rings it already clicked for the current prompt (keyed by prompt title) so rejected or toggling clicks cannot loop; when every candidate has been attempted it falls back to a button or reports the prompt as unsupported. The dedup key is *normalized* — the live conflict skill totals (`Attacker: 4 Defender: 5`) and the ring element/type in a conflict title (`Political Fire Conflict`) are stripped — because those flip on every legal-but-idle ring toggle or reversible ability, and left in they would wipe the attempted-set before the bot exhausts its options and reaches its own pass fall-back. As a last-resort backstop the controller watches for the same normalized prompt surviving several full decision budgets (whether the budget landed moves or only produced rejected ones) and then force-clicks Pass/Done (`forceProgress`), so a seat can never freeze the game in a decision loop — this replaced the old behavior of logging and giving up.

Future strategy profiles can replace `JigokuBotPolicy` while keeping `JigokuBotController` as the command-path and trace boundary.

## Limits

- Specialized behavior exists only for registered marker/profile combinations;
  an unknown deck falls back to the generic profile.
- Seeds 1, 2, and 5 are hand-written policies; seed 4's optional learned
  evaluator remains experimental and is not a competitive default.
- Unsupported prompt shapes leave a trace entry and use the controller's
  bounded progress fallback.
- Bot games are labeled in save state and skipped for the external analytics
  game-report post.
