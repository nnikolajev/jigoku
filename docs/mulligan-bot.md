# Adaptive mulligan and province refresh

`MulliganTactics` is the injectable policy used by bot seed 3 for opening
dynasty/conflict mulligans and end-of-fate dynasty discard. Seeds 1 and 2 keep
their frozen legacy behavior by default, but self-play can inject adaptive or
legacy behavior into any seed for paired comparisons.

## Inputs

Every decision receives:

- all cards explicitly selectable in the current prompt;
- the bot's characters in play, including fate;
- current fate and exact stronghold income;
- round number;
- exact printed cost by physical card UUID;
- the printed province id under each dynasty-card location.

Projected next-turn fate is `current fate + income`. Costs are keyed by UUID,
not province location, so every character in a Rally or multi-card province
stack is evaluated separately. Cards on broken provinces are not prompt-
selectable and are ignored because the engine discards them automatically.

## Opening dynasty mulligan

The generic profile seeks one of two playable openings:

- one 3–5 cost durable character, optionally supported by cheap bodies; or
- several 1–2 cost bodies when no strong affordable character is present.

Rush profiles raise the cheap-body target to four. Non-rush profiles normally
keep at most one strong body so it can receive fate and the bot can pass early.
Holdings have a configurable limit, ordered priority, and per-card copy cap.
Unaffordable characters and surplus holdings are replaced.

Crane profiles treat a character on Tsuma as the highest-priority keep and
dynasty purchase because it enters play honored. Iron Crane Legion is always
replaced in the opening hand because its variable skill improves later. Kakita
Dōjō and Proving Ground can coexist, but duplicate copies cannot consume more
than one kept slot each.

## Opening conflict mulligan

The generic rule keeps zero-cost cards and replaces cards with a printed fate
cost. This improves the first conflict phase after dynasty investment. The
decision uses exact hand costs from the live card objects; missing summary cost
fields cannot silently turn a paid card into a free card.

## End-of-fate province refresh

Board state is classified as:

- `weak`: at most one character;
- `developing`: between weak and strong;
- `strong`: at least three characters with persistent fate, or a wider board.

Weak boards discard holdings aggressively and retain affordable characters so
the next dynasty phase cannot open with holdings only. Developing boards search
for better 3–5 cost bodies while keeping a fallback character. Strong boards
may retain more holdings and search for one preferred replacement body. Every
limit, threshold, preference, and cheap-character rule lives in the deck's
`mulligan` profile.

## Deck profiles

- Crab keeps up to two opening holdings and up to three later. Its ordered
  holding list prioritizes Seventh Tower, Kaiu Forges, and the wall/watchtower
  engine while still preserving characters. Cheap developing-board bodies are
  valid support.
- Lion and Unicorn use rush settings: more opening bodies, minimal holdings,
  and no automatic cheap-body churn.
- Dragon Monks searches for Mitsu and other Monk engine characters.
- Dragon Attachments searches for Niten Master, Togashi Yokuni, and its tower
  characters, with no opening holding slot.
- Scorpion searches for Bayushi Shoju and key dishonor characters; Licensed
  Quarter remains a later-board keep.
- Phoenix Glory prioritizes the live deck's Kaede/Ujina/Atsuko/Tsukune,
  Prodigy, and Chikai bodies plus Forgotten Library/Imperial Palace/Favorable
  Ground. It may keep two holdings on a developed board.
- Phoenix Shugenja prioritizes its ring/spell engine characters and may keep two
  holdings after development.
- Crane Baseline and Crane Duels share Tsuma, Iron Crane Legion, duelist, and
  singleton holding rules.

Profiles are merged in `DeckProfiles.resolveDeckProfile`. A new deck can change
the nested `mulligan` object without branching `JigokuBotPolicy`.

## Configuration and A/B

`JigokuBotConfig.mulliganPolicy` accepts `adaptive` or `legacy`. If omitted,
seed 3 uses adaptive and seeds 1/2 use legacy.

```powershell
# all decks and all supported seeds, 20 paired games each by default
node tools/selfplay/compareMulliganPolicies.js

# deployed seed only
node tools/selfplay/compareMulliganPolicies.js --games 40 --seeds 3

# focused fresh-stream confirmation
node tools/selfplay/compareMulliganPolicies.js --games 20 --seeds 3 --decks Crab,Phoenix --rng-seed 20260721
```

The initial all-seed smoke was 130–110 for adaptive (54.2%). A larger seed-3
gate exposed Crab and Phoenix regressions. After ordered Crab holding priorities
and correcting Phoenix's stale preferred-character list, fresh 20-game focused
runs finished Crab 10–10 and Phoenix 13–7. The final independent all-deck
seed-3 stream finished 51–49 for adaptive. Its small Crab 2–8 outlier was then
checked over 40 new games, where adaptive finished 23–17; the recent combined
Crab confirmation is therefore exactly 25–25. Reports are under
`tools/selfplay/out/mulligan-ab-*.{md,json}`.

## Regression coverage

`mulligantactics.spec.js` covers paid conflict cards, projected fate, stacked
province costs, broken-province exclusion, board bands, holding/copy limits,
Tsuma, Iron Crane Legion, and every supported deck-family override. Controller
tests lock seed defaults and explicit adaptive/legacy injection. The reusable
interaction audit remains the cycle/stall gate. The final all-deck audit ran
every deck on seeds 1, 2, and 3 against Crane: all 30 cases passed with no
cycles, stalls, budget exhaustion, unsupported prompts, or forced progress.
