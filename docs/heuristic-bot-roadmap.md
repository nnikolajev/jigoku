# Jigoku Heuristic Bot Roadmap

Improvement phases for the server-side heuristic bot, ordered by payoff vs. risk.
See `heuristic-bot.md` for the current implemented behavior.

## Phase A — Play conflict cards from hand/discard (implemented)

During conflict action windows where the bot participates, click a playable hand
card so the normal `'Play X:'` handler menu, cost prompts, and target prompts
resolve through the existing generic prompt handlers.

- Public summaries still omit printed conflict-card costs, so the controller
  supplies `conflictCosts` from live cards and `currentLegalDirectCardUuids`
  from the active engine step. Unaffordable, wrong-timing, and targetless plays
  are removed before policy scoring.
- Seeds 1, 2, and 3 share an injectable value-per-fate planner. Priority
  premiums protect expensive strategic cards; deck tactics may override order.
- Paid plays from conflict discard share the same usefulness, target, cost,
  attachment, and contribution gates. Free `putIntoPlay` effects remain separate.
- Characters played from hand prefer entering the conflict over staying home.

## Phase B — Conflict evaluation layer (implemented)

Teach the bot *when* to spend instead of just *how*:

- Skill margin math from the conflict summary (`conflict.getSummary()` exposes
  `attackerSkill`, `defenderSkill`, `attackingPlayerId`, `type`).
- Hopeless-conflict detection: if the gap is larger than a recoverable margin,
  pass instead of dumping the hand.
- Defender selection understands province break math: a province breaks when
  attacker skill beats defender skill by at least the province strength, so the
  bot defends to win when reachable, otherwise defends just enough to prevent
  the break, and commits nothing when even that is impossible.

## Phase C — In-play card abilities (implemented framework; coverage grows per card)

Implemented carve-outs:

- **Target polarity**: the controller reads the current target prompt's
  `gameAction` list from the pipeline step and passes a hint to the policy.
  Harmful actions (bow, dishonor, removeFate, discardFromPlay, ...) target the
  opponent's strongest legal card. Helpful actions (honor, ready, placeFate,
  attach, ...) go to the bot's own side, preferring in-conflict characters.
  Unclassified effects from the bot's own card default to buff-own /
  debuff-opponent based on which sides are legal targets.
- **Province and stronghold reactions**: triggered ability windows
  (`Any reactions?` / `Any interrupts...`) fire the bot's own province and
  stronghold abilities, which are free and near-always beneficial
  (e.g. Meditations on the Tao).

`CardPlaybook.ts` now provides deterministic metadata for hand plays, dynasty
actions, in-play actions, reactions, interrupts, target polarity, target-copy
limits, and live `shouldPlay` / `shouldUseAction` gates. The controller clicks
playbook-known characters, attachments, holdings, provinces, and strongholds.
LM Studio hints remain optional fallback coverage for unmodeled cards.

Still open: add or correct per-card playbook entries when utilization audits or
live games expose a legal interaction the generic action classifier cannot value.

## Phase D — Scored-candidate policy (partially implemented)

`JigokuBotPolicy` remains a deterministic rule policy behind
`JigokuBotController`. Candidate scoring now covers conflict-card economy,
exact conflict contribution, injectable deck tactics, and optional hidden-hand
and hidden-province threat evaluation. The former full-move LLM and learned
evaluator seeds were removed after they failed to improve the deployed policy.

1. Enumerate legal moves for the current prompt.
2. Score each (skill swing, fate efficiency, honor race position, province
   state, ring value).
3. Pick the max deterministically (seeded tie-break).

Remaining research: multi-action planning across a whole conflict, opponent bid
history, uncertainty-aware hidden-hand estimates for fair bots, and a trained
policy that can beat seed 1 without breaking prompt progression. Any experiment
must retain the controller legality gate, trace format, interaction-loop audit,
and deterministic fallback.

## Phase E — Stronghold survival (implemented)

`StrongholdDefenseTactics` has two stages. At two broken provinces it guards the
specific first-player double-attack window: two opponent conflicts remain, at
least two opponent characters are ready, and their military or political board
skill can reach the exact live weakest-outer-plus-stronghold strength. It keeps
the minimum safe defender or passes the unsafe conflict, then releases the
reserve when the second attack is no longer possible. After three own provinces
break, full survival mode reserves the minimum provably safe defenders or skips
offense, with explicit exceptions for bowed opponents, last-conflict attacks,
and exposed-stronghold races. Covert forces fair bots to hold all. Seed 3
additionally budgets exact affordable hand skill and known defender-disabling
effects. Both stages and their thresholds are injectable per deck.
