# Jigoku Bot — LM Studio Integration

The heuristic bot can use a local LLM (LM Studio's OpenAI-compatible server) to
understand card text. Two layers, both optional:

1. **Pre-game deck analysis** — every card in the bot's deck is analyzed once
   and turned into a `CardHint`; results are cached on disk so repeat games
   never hit the model again.
2. **Live consult** — when a target pick came from an assumption instead of
   knowledge (the generic `choose-card` fallback, or a `guessed-` polarity for
   an unclassifiable effect with no card hint), the model picks the target,
   with the heuristic pick as the timeout fallback. Picks backed by classified
   game actions or card hints skip the consult on purpose — the heuristic
   already knows the answer and a model round trip would only slow the turn.

The game never blocks on the LLM: analysis is fire-and-forget (hints fill in
progressively while the game runs), a live consult falls back to the heuristic
pick after the timeout, and if LM Studio is unreachable a single warning is
posted to the game chat and the bot plays exactly as before.

## Configuration

**Default-on**: when the game creation request carries no `bot.llm`, the lobby
injects a server-side default (see `server/env.ts`): enabled, LM Studio at
`http://localhost:1234`, model `qwen/qwen3.5-9b`, live consult on. Override via
environment variables `BOT_LLM_ENABLED=false`, `BOT_LLM_BASE_URL`,
`BOT_LLM_MODEL`, `BOT_LLM_LIVE_CONSULT=false`, `BOT_LLM_CONSULT_TIMEOUT_MS`.

**Reasoning models**: qwen3.x-style models spend thousands of tokens thinking
before answering (~1 minute per card on a 9B). Analysis runs in the background
with a 12k token budget and 5-minute per-card timeout, and the answer is also
salvaged from the reasoning channel when the final message is truncated. First
game with a new deck takes roughly `cards × 1 min` to reach full hint coverage;
afterwards everything loads from the disk cache instantly. For much faster
analysis, disable thinking for the model in LM Studio or point `BOT_LLM_MODEL`
at a non-reasoning instruct model. Live consults are governed by
`consultTimeoutMs` (default 2 minutes) — a slow thinking model will often hit the
timeout and fall back to the heuristic pick, which is safe but means the
consult adds little; prefer a fast model when `liveConsult` matters.

The bot posts progress to the game chat: "analyzing N deck cards with
<model>..." at start and "card analysis ready: X analyzed, Y from cache" on
completion.

Lobby game creation (explicit override):

```json
{
  "bot": {
    "enabled": true,
    "deckId": "deck id",
    "llm": {
      "enabled": true,
      "baseUrl": "http://localhost:1234",
      "model": "qwen/qwen3.5-9b",
      "liveConsult": true,
      "consultTimeoutMs": 120000
    }
  }
}
```

- `enabled` — turns on deck analysis and hint consumption.
- `liveConsult` — additionally enables the per-prompt consult (slower turns on
  ambiguous prompts, up to `consultTimeoutMs`).
- `cacheDir` — optional override; defaults to `.bot-hints/<model>/` under the
  server working directory.

**Caching** is two-level: per-card (`.bot-hints/<model>/<cardId>.json`, shared
across decks) and per-deck manifests (`.bot-hints/<model>/decks/<key>.json`,
keyed by the deck's import URL / deck id — the lobby fills in the default
decklist URL when no deck is given). A deck whose manifest exists and whose
cards are all cached loads instantly with zero model traffic ("card hints
loaded from cache"). An interrupted analysis resumes where it left off: only
genuinely uncached cards are sent to the model, and the start message reports
"analyzing Y new deck cards (X already cached)".

## Data out: CardHint (deck analysis)

One JSON object per printed card id, produced by the model, validated and
defaulted field-by-field (`llm/CardHints.ts`):

```json
{
  "cardId": "meditations-on-the-tao",
  "useWhen": "attacked",
  "conflictTypes": ["military", "political"],
  "targetSide": "enemy",
  "targetPreference": "most-fate",
  "priority": 7,
  "summary": "strips a fate from an attacker whenever this province is hit"
}
```

- `useWhen`: `always | losing | winning | attacked | never`
- `targetSide`: `self | enemy | either | none`
- `targetPreference`: `strongest | weakest | most-fate | any`
- `priority`: 0–10 eagerness (≥6 unlocks character/event reactions the
  heuristics otherwise pass).

How the policy consumes hints:

- **Conflict windows**: `useWhen: never/winning` cards stay in hand while
  losing; `conflictTypes` mismatches are skipped; higher `priority` plays
  first.
- **Reaction/interrupt windows**: provinces/strongholds always fire; other
  sources fire only with a hint of priority ≥ 6.
- **Target prompts**: a hint on the source card overrides the generic
  action-polarity guess — `targetSide` picks the side, `targetPreference`
  picks within it (`most-fate` targets what stays in play longest).

## Data in/out: live consult

Request content (compact, JSON): the question (prompt titles), a game-state
summary (`phase`, `round`, conflict skills and attacker, both players' honor
and fate) and the candidate list:

```json
{ "uuid": "...", "name": "...", "side": "mine|theirs", "military": "3", "political": "1", "fate": 2, "bowed": false, "inConflict": true }
```

Expected answer: `{"uuid": "<one of the candidates>"}`. Anything else (or a
hallucinated uuid) counts as no answer and the heuristic fallback is used, so
the model can never produce an illegal command. Qwen `<think>` blocks are
stripped before JSON extraction.

## Module map

- `server/game/bots/llm/LmStudioClient.ts` — HTTP client, JSON extraction.
- `server/game/bots/llm/rulesPrimer.ts` — distilled Imperial rules/keywords
  system prompt (source: EmeraldDB Imperial rules reference).
- `server/game/bots/llm/CardHints.ts` — hint schema + lenient validation.
- `server/game/bots/llm/DeckHintService.ts` — analysis queue + disk cache.
- `server/game/bots/llm/LiveConsultant.ts` — target consult (seed 1).
- `server/game/bots/llm/LlmActionPlanner.ts` — seed-3 move planner: given the
  full state + hand + the enumerated legal options, returns the id of the move
  to play. The controller builds the option set (`enumerateOptions`), validates
  every option, and appends the heuristic pick as the labelled fall-back.
- Wiring: `JigokuBotController` starts deck analysis on its first tick (cards
  from `game.allCards` owned by the bot) and passes a hint lookup into every
  policy decision; the lobby forwards `bot.llm` config unchanged.

The hint lookup consults the hand-written `CardPlaybook.ts` first: a playbook
entry outranks the cached LLM hint for the same card id, and playbook cards
are excluded from deck analysis (no model traffic for cards we already
understand). See `heuristic-bot.md` for the playbook behavior itself.

`CardPlaybook.ts` also exports `deriveDeckStrategy(cardIds)`, which the
controller runs once over the bot's owned cards to gate deck-specific behavior
(holding-engine mulligan/digging, defensive attacking, aggressive military
rush — all-in commitment, 0-1 fate deploys, forced-military conflicts,
conceded defenses). Decks whose analyzed cards trip none of the marker sets
keep the generic behavior, so the LLM path is unchanged for them.
