# Discard replay bot rules

The bot treats a paid card play from a discard pile as the same strategic
decision as a normal play. The source effect still owns legality, additional
costs, destination, and timing; the shared bot gate owns whether the offered
card is useful and has a useful target.

## Shared paths

- Cards made directly playable in conflict discard (Guidance of the Ancestors,
  In Service to My Lord, Right Hand of the Emperor, Chain of Command,
  Developing Masterpiece, and Meditations on Orthodoxy) join the same candidate
  pool as cards in hand.
- Exposed Courtyard first chooses a discarded card, then grants direct play.
  Its selection and the following play use the shared playbook intent.
- Immediate `playCard` selectors use the same playbook `shouldPlay` gate,
  conflict-type gate, target-copy limit, printed skill contribution, attachment
  bearer viability, and value-per-fate ordering as hand plays.

Immediate replay sources currently include Kyūden Isawa, Warm Welcome,
Togashi Mitsu, Inventive Mirumoto, Isawa Hifumi, Kuro, To Sow the Earth,
To Connect the People, Kunshu, Voice of the Ancestors, and Dragon Tattoo.
Bayushi Kachiko grants direct play from the opponent's conflict discard. That
public pile is included in the normal candidate, printed-cost, and printed-skill
pools after the engine marks one of its cards playable.

## Source-specific overlays

- Kyūden Isawa offers only Action Spell events, checks their live fate cost,
  then removes the played card from the game. Its bow and Spell discard costs
  remain source rules.
- Inventive Mirumoto requires the replayed attachment to be legal on the exact
  Mirumoto that activated the ability.
- Kuro offers an opponent's eligible attachment, reduces its cost, forces it
  onto Kuro, then moves Kuro.
- Kunshu ignores the replayed card's fate cost. The controller reads that flag
  from the nested `playCard` action, so the shared gate still evaluates
  usefulness and target suitability without treating printed fate as payable.
- Voice of the Ancestors temporarily converts a Lion dynasty character into a
  Spirit attachment and reduces its cost. The conversion and forced bearer are
  source rules.
- To Sow the Earth and To Connect the People grant character play permissions
  before invoking normal play. Their trait, controller, uniqueness, and glory
  restrictions remain source rules.
- Dragon Tattoo replays the just-resolved event against its recorded target and
  removes the event from the game afterward.

## Deliberate non-play exceptions

`putIntoPlay`, move-to-hand, and shuffle effects are not normal card plays and
must not pay or validate hand-play costs. Rebuild, Apprentice Engineer,
Forebearer's Echoes, Fushichō, Keeper Initiate, Cavalry Reserves, Dark
Resurrection, Unified Company, and similar effects keep their specialized
selectors. The replay router keys on a nested `playCard` action, so these
effects cannot accidentally enter paid-play economy logic.

## Failed-play loop guard

Some engine restrictions are checked only after a card has opened its target
prompt. If the bot selects a target but the play is rejected and the same card
returns to its original hand/discard zone, that physical card UUID is vetoed
for the rest of the round. This applies equally to normal hand plays and
discard replays, and prevents prompt changes from resetting the short-lived
click de-duplication state.

Regression coverage lives in `test/server/bots/specializedpolicycoverage.spec.js`
and focused Shugenja/Dragon attachment specs. It runs the deployed seed 1, 2,
and 5 policies and separately proves that a free Fushichō resurrection stays
on the specialized `putIntoPlay` path.

## Validation (2026-07-16)

Standardized win rates use 100 games per deck, alternating seats, with the
challenger and Crane opponent on the same seed. Values are baseline -> shared
replay refactor:

| Deck | Seed 1 | Seed 2 | Seed 3 |
|---|---:|---:|---:|
| Crab | 42% -> 39% | 55% -> 61% | 30% -> 30% |
| Crane Duels | 55% -> 53% | 80% -> 85% | 53% -> 50% |
| Dragon | 43% -> 52% | 62% -> 52% | 43% -> 55% |
| Dragon Attachments | 57% -> 59% | 87% -> 90% | 56% -> 60% |
| Lion | 52% -> 44% | 68% -> 72% | 43% -> 46% |
| Phoenix | 61% -> 63% | 85% -> 77% | 61% -> 53% |
| Phoenix Shugenja | 68% -> 67% | 78% -> 77% | 71% -> 70% |
| Scorpion | 72% -> 76% | 90% -> 88% | 80% -> 72% |
| Unicorn | 56% -> 57% | 79% -> 82% | 56% -> 67% |

Aggregate wins were 1,683/2,700 before and 1,697/2,700 after (+0.52
percentage points). A 300-game all-deck/all-opponent interaction audit across
seeds 1, 2, and 3 passed with zero rejected clicks, detected loops, or decision
budget exhaustions.
