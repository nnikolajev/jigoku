# Omniscient bot capability

> **Status: shipped, opt-in, and strategy-independent.** Omniscience is an
> information-access capability, not a bot seed. The lobby checkbox and bot
> configuration can enable it for seed 1, 2, or 3.

## Configuration

```json
{
  "bot": {
    "enabled": true,
    "seed": 1,
    "omniscient": true
  }
}
```

The supported strategy seeds are:

| Seed | Strategy |
|---:|---|
| 1 | fate-aware heuristic |
| 2 | original dynasty-focused heuristic |
| 3 | seed 1 plus board-aware dynasty development |

`OmniscientBotCapability` is constructed independently of the selected policy.
When disabled, it returns no hidden context and the strategy remains fair.
When enabled, it supplies the same hidden-state model to any of the three
strategies.

## Information exposed

The capability reads the opponent's live player object and supplies:

- exact conflict hand, card costs, printed/live skills, attachment bonuses, and
  curated event effects;
- opponent fate and an affordability matrix for military and political boosts;
- exact identities, current strengths, ability classes, and dynasty stacks of
  face-down provinces;
- affordable bow, send-home, discard, and removal effects;
- exact hand copies for Gossip and exact bow-effect knowledge for Clarity of
  Purpose.

Province strength uses the live card's `getStrength()`, so holdings, the
stronghold bonus, and active modifiers are included. Public Forum has effective
priority strength 6 only while ranking targets because it must be broken twice;
its actual break strength is unchanged.

Every event in the ten standardized deck fixtures has a model in
`DeckAnalysis.ts`. A one-time game message reports any missing event models when
an unknown deck is used. Live character and attachment values do not require a
registry entry.

## Injectable use of hidden knowledge

`DeckProfile` controls where exact information modifies decisions:

- `useOmniscientProvinceKnowledge`
- `useOmniscientConflictAxis`
- `omniscientAttackResponseBuffer`
- `useOmniscientTokenDefense`
- `omniscientEarthRingThreatBonus`
- stronghold-defense hidden-threat weights and control detection

Exact province targeting is broadly safe. Treating every known hand card as a
guaranteed maximum conflict swing was not safe: it caused over-commitment,
unnecessary defense, and skipped windows. Those broad worst-case overrides
remain disabled. Duel, Shugenja, Crab, and Unicorn profiles enable narrower
uses whose effects were measured separately.

## Benchmark and 60% gate

`botOmniscientRoundRobin.js` compares an omniscient strategy against its normal
version. Its mirror gate holds seed and deck constant, alternates seats, and
uses paired deterministic shuffles:

```powershell
# Focused quality gate: 40 same-deck games per deck
node tools/selfplay/botOmniscientRoundRobin.js --seed 1 --games 40 --mirrors-only

# Standard client benchmark: 20 games for every ordered deck matchup
node tools/selfplay/botOmniscientRoundRobin.js --seed 1
```

The standard run writes the seed's `omniscient` section to
`jigoku-client/client/botBenchmarkResults.json`. Custom counts, mirror-only
runs, deck subsets, and alternate RNG seeds never replace client data.

The 2026-07-21 N=40 mirror evaluation did **not** meet the requested 60% floor:

| Seed | Decks at 60% | Aggregate omniscient record |
|---:|---:|---:|
| 1 | 1/10 (Crane Duels) | 211-189, 52.8% |
| 2 | 0/10 | 202-198, 50.5% |
| 3 | 1/10 (Crab) | 214-186, 53.5% |

This is a failed quality gate, not evidence that exact information is useless.
The current deterministic action policy does not yet convert that information
into a consistent advantage. Full reports are under
`tools/selfplay/out/omniscient-mirror-gate-seed*-final-evaluation.*`.

The standardized all-opponent pool (20 games against each of ten decks) was
also close to neutral: seed 1 50.6%, seed 2 49.5%, and seed 3 51.5%. These
standard reports are `tools/selfplay/out/omniscient-round-robin-seed*.*` and
are the results displayed by the client.

## Tests

```powershell
npm run typecheck
npx jasmine test/server/bots/deckanalysis.spec.js
npx jasmine test/server/bots/deckprofiles.spec.js
npx jasmine test/server/bots/fateawarejigokubot.spec.js
npx jasmine test/server/bots/specializedpolicycoverage.spec.js
npx jasmine test/tools/selfplay/botomniscientroundrobin.spec.js
```

The regressions cover capability/seed independence, hidden hand cost and event
models, face-down province stacks, profile gates, and benchmark publication.

The final live interaction audit ran every deck on seeds 1-3 once in fair mode
and once with omniscience (60 games). Both sets passed with zero rejected
clicks, cycles, budget failures, or stalls; maximum work was 14 decisions in a
controller tick. Reports:
`tools/selfplay/out/omniscient-refactor-final-{fair,omniscient}-interactions.*`.
