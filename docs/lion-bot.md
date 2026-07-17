# Lion Swarm bot deck (EmeraldDB 27a913d1)

`Lion Swarm (v0.3)` replaces the older Lion Bushi list after an alternating-seat
self-play comparison. It is a true rush deck: buy many 0-2 cost characters,
trade ordinary provinces, preserve the wide board with fate events, ready the
best bodies, and attack again.

## Exact deck fixture

- Stronghold/role: Hayaken no Shiro, Seeker of Air.
- Provinces: City of the Rich Frog, Dishonorable Assault, Emperor's Summons,
  The Art of War, Weight of Duty.
- Dynasty: 40 cards. Three copies of every character, three Honored Veterans,
  two A Season of War, two Staging Ground.
- Conflict: 40 cards. Three copies of every listed card except Banzai (2),
  Daidoji Yari (2), and Political Rival (3).
- Crane splash supplies Daidoji Yari and Political Rival.

The offline fixture is the source used by self-play; it contains 5 provinces,
40 dynasty cards, 40 conflict cards, one stronghold, and one role.

## Bot plan

### Dynasty and fate

- Play cheap bodies first. Akodo Gunso refills its province; Ashigaru Levy's
  enter-play reaction always pulls another available copy.
- Matsu Beiona waits for **three other Bushi**, then takes its two-fate
  reaction. This intentionally differs from the requested two-Bushi threshold:
  Jigoku's authoritative card implementation requires three other Bushi.
- Only Akodo Toturi, Commander of the Legions, and Honored General are towers.
  They receive exactly two additional fate. Every other character receives 0.
- Honored Veterans is used only when a newly played, positive-glory Bushi can
  be honored. Tower first, then highest glory.
- A Season of War requires at least two fate before play, leaving resources to
  buy a body in the extra no-income dynasty phase.
- Staging Ground reveals facedown province cards after visible purchases are
  exhausted and fate remains.

### Province trading and board persistence

- The Art of War retains the existing concede-for-three-cards logic.
- Dishonorable Assault requires a discard and an undishonored positive-glory
  attacker; targets favor towers/highest glory.
- Weight of Duty is used only with a cheap participating sacrifice and a ready
  enemy participant. The sacrifice target is the lowest-fate cheap body.
- Feeding an Army is triggered at five or more printed-cost-3-or-lower bodies.
- For Greater Glory always fires after a military province break.
- The rush uses `win-only` ordinary defense and does not spend conflict cards
  defending. After three own provinces break, the shared stronghold-survival
  planner reserves enough ready skill to protect the final province. It may
  still race when the opponent has no ready characters, Lion has the last
  declaration, or both players' strongholds are exposed; an actual stronghold
  attack remains all-in defense.

### Conflict tools

- Forebearer's Echoes retrieves the strongest discarded character, preferring
  one of the three towers.
- In Service to My Lord bows a cheap/home body and readies Toturi, Commander,
  Honored General, or Matsu Beiona first.
- Ujiaki's Offer is held for a losing political conflict and targets a ready
  enemy participant so bow + dishonor + send-home can reverse the result.
- Political Rival is usable on attack or defense when its live +3 political
  contribution reaches a province break or prevents one. Once that result is
  already secured, the shared conflict-economy gate preserves it instead of
  overcommitting.
- True Strike Kenjutsu attaches to a listed tower; its action starts the duel
  while a ready enemy participates.
- Elegant Tessen is played to ready a bowed printed-cost-2-or-lower Lion body.
- Fine Katana and Daidoji Yari use normal military-attachment scoring.
- Hayaken no Shiro readies a bowed cheap Bushi so the swarm can fight again.

## Shared bot improvements

Two requested rules apply to every deck:

1. Honor targets: a multi-fate tower first, then the character with the highest
   glory. Dishonor targets: the enemy character with highest glory. Ready and
   current-conflict state break ties.
2. Restricted attachments: count existing Restricted attachments by printed
   id, reject characters already at the two-card cap when alternatives exist,
   and prefer the character with the fewest Restricted attachments. Immediate
   conflict-saving targets still take precedence while losing.

## Performance decision

Seed 1, 24 games per opponent, seats alternating (192 games per deck):

| Opponent | old Lion | Lion Swarm |
|---|---:|---:|
| Crane | 11-13 | 11-13 |
| Crane Duels | 18-6 | 18-6 |
| Crab | 14-10 | 21-3 |
| Dragon | 9-15 | 14-10 |
| Phoenix | 7-17 | 7-17 |
| Phoenix Shugenja | 7-17 | 13-11 |
| Scorpion | 3-21 | 3-21 |
| Unicorn | 6-18 | 15-9 |
| **Overall** | **75-117 (39.1%)** | **102-90 (53.1%)** |

The new list gains 27 wins and 14.1 percentage points, so it replaces the old
Lion fixture.

## Non-Lion regression check

The pre-change 100-game-per-matchup round robin was reduced to the seven
non-Lion opponents for each deck (about 700 results per deck). The current
build ran every non-Lion pairing for 40 games (about 280 results per deck,
1120 games total). Seats alternated; all jobs completed.

| Deck | before | after | delta |
|---|---:|---:|---:|
| Crane | 37.8% | 37.7% | -0.0 |
| Crane Duels | 32.1% | 30.7% | -1.4 |
| Crab | 31.4% | 30.1% | -1.3 |
| Dragon | 44.8% | 46.9% | +2.1 |
| Phoenix | 60.6% | 65.2% | +4.6 |
| Phoenix Shugenja | 53.3% | 54.7% | +1.4 |
| Scorpion | 93.0% | 91.8% | -1.2 |
| Unicorn | 47.3% | 42.4% | -4.8 |

Changes are mixed and every deck remains within 4.8 points of its much larger
baseline. This check found no systematic shared-logic degradation.
