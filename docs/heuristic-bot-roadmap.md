# Jigoku Heuristic Bot Roadmap

Improvement phases for the server-side heuristic bot, ordered by payoff vs. risk.
See `heuristic-bot.md` for the current implemented behavior.

## Phase A — Play conflict cards from hand (implemented)

During conflict action windows where the bot participates, click a playable hand
card so the normal `'Play X:'` handler menu, cost prompts, and target prompts
resolve through the existing generic prompt handlers.

- Hand card summaries already expose `isPlayableByMe` (`drawcard.ts`), so no new
  state is needed. Cost is not in the summary; unaffordable clicks are rejected
  by the game without mutation and the policy's attempted-memory moves on.
- Guards: only act in conflicts the bot is in, keep a fate reserve (do not spend
  below 1 fate), and only play while the conflict is losing but recoverable —
  once ahead, pass instead of overcommitting.
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

## Phase C — In-play card abilities (partially implemented)

Implemented carve-outs:

- **Target polarity**: the controller reads the current target prompt's
  `gameAction` list from the pipeline step and passes a hint to the policy.
  Harmful actions (bow, dishonor, removeFate, discardFromPlay, ...) target the
  opponent's strongest legal card — or the bot's own weakest when only its side
  is legal (forced sacrifice). Helpful actions (honor, ready, placeFate,
  attach, ...) go to the bot's own side, preferring in-conflict characters.
  Unclassified effects from the bot's own card default to buff-own /
  debuff-opponent based on which sides are legal targets.
- **Province and stronghold reactions**: triggered ability windows
  (`Any reactions?` / `Any interrupts...`) fire the bot's own province and
  stronghold abilities, which are free and near-always beneficial
  (e.g. Meditations on the Tao).

Implemented via the LLM harness (`heuristic-bot-llm.md`): per-card hint tables
from LM Studio deck analysis unlock character/event reactions (priority-gated),
override target polarity from actual card text, and gate/order conflict-window
hand plays. Live consult covers ambiguous target prompts.

Still deferred:

- Without `bot.llm`, character and event reactions/interrupts stay passed —
  blind triggers waste fate and honor.
- Proactively clicking in-play cards in action windows (`'Choose an ability:'`)
  beyond stronghold/attacked province.
- The `difficulty` field in `JigokuBotConfig` is the natural switch for this.

## Phase D — Scored-candidate policy (deferred, structural)

`JigokuBotPolicy` is deliberately a swap point behind `JigokuBotController` (the
command-path and trace boundary). For real strength, replace the if-chain with a
scored-candidate policy:

1. Enumerate legal moves for the current prompt.
2. Score each (skill swing, fate efficiency, honor race position, province
   state, ring value).
3. Pick the max deterministically (seeded tie-break).

This replaces the policy internals without touching the controller, trace
format, lobby flow, or tests. Bid prediction upgrades belong here too: track the
opponent's actual bid history across rounds instead of pure hand-size inference,
and weigh deck archetype (a dishonor deck bids differently).
