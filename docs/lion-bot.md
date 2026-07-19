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

Draw-phase bidding uses the shared honor profile. It always bids 5 in round 1,
normally keeps enough card volume for the swarm, and shifts low when its own
honor victory or the opponent's dishonor is close. The old fixed later bid of 2
exists only in `LegacyDrawBidTactics` for A/B comparisons.

### Dynasty and fate

- Play cheap bodies first. Akodo Gunso refills its province; Ashigaru Levy's
  enter-play reaction always pulls another available copy.
- Matsu Beiona waits for **three other Bushi**, then takes its two-fate
  reaction. This intentionally differs from the requested two-Bushi threshold:
  Jigoku's authoritative card implementation requires three other Bushi.
- Only Akodo Toturi, Commander of the Legions, and Honored General are towers.
  They receive exactly two additional fate. Every other character receives 0.
- Honored Veterans is used only when a newly played, positive-glory Bushi can
  be honored. Highest glory first; tower persistence breaks ties.
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
- True Strike Kenjutsu is limited to one copy per character and is spread onto
  durable characters with high **base** military. During a conflict, the bot
  recognizes the gained Action as coming from True Strike rather than from the
  printed character. It starts the duel only when the bearer has at least one
  more base military than every ready opposing participant, then targets the
  strongest legal opposing participant exposed by Jigoku's selector.
- Elegant Tessen is played during the between-conflict Action Window when it
  can ready a bowed character whose exact printed cost is 2 or less. The
  controller supplies live printed costs by UUID, so this is no longer a
  hard-coded list of known Lion character ids.
- Fine Katana and Daidoji Yari use normal military-attachment scoring.
- Hayaken no Shiro readies a bowed cheap Bushi so the swarm can fight again.

### True Strike's base-skill duel

True Strike deliberately has two skill paths:

1. Before the duel, `LionTactics` compares the exact live
   `getBaseMilitarySkill()` values supplied by the controller. Total skill,
   honor/dishonor, attachments, and temporary pumps do not enter the activation
   or target decision.
2. Once the duel exists, the shared `DuelBidTactics` receives each side's skill
   from the live engine duel through `Duel.getSkillStatistic()`. True Strike's
   engine statistic is `card.getBaseMilitarySkill()`, so the same bid matrix
   automatically evaluates the exact base-skill duel without duplicating the
   duel or honor-risk model.

The physical card says the opponent chooses its character. Jigoku's current
card implementation exposes that selector to True Strike's controller. The bot
therefore uses the conservative tabletop-safe precondition (it must beat every
possible ready opposing participant), then chooses the strongest target only
because that is the legal prompt Jigoku presents.

All tuning is injectable through `LionProfile`:

| Knob | Default | Purpose |
|---|---:|---|
| `elegantTessenMaxPrintedCost` | `2` | Maximum printed cost Tessen may ready. |
| `trueStrikeMaxCopiesPerCharacter` | `1` | Per-character attachment limit. |
| `trueStrikeMinimumBaseLead` | `1` | Required lead over the strongest opposing participant. |
| `trueStrikeTargetBaseSkillWeight` | `4` | Prefer strong base-military bearers. |
| `trueStrikeTargetFateWeight` | `2` | Prefer persistent bearers. |
| `trueStrikeTargetTowerBonus` | `2` | Small durable-tower tie breaker. |
| `setupAttachmentPriority` | Tessen, True Strike | Between-conflict setup order. |

The resolved deck profile clones the priority array, so a deck override or test
can tune these values without mutating another bot instance.

## Shared bot improvements

Two requested rules apply to every deck:

1. Honor targets: the friendly character with highest glory. Forced
   self-dishonor: the lowest-glory legal character (zero glory loses no skill).
   Enemy dishonor normally targets highest glory at home; a participant takes
   priority only when its glory loss changes the conflict winner or creates a
   province break. Ready state and persistence break equal-glory ties.
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

## Tessen / True Strike validation (2026-07-19)

The starting point was the final shared-duel benchmark: Lion was 49-51 versus
Crane Baseline and 143-82 (63.6%) in the N=25 round robin. After adding exact
Tessen targeting, singleton True Strike placement, gained-action routing, and
base-skill preflight:

| Run | Before | After | Delta |
|---|---:|---:|---:|
| vs Crane Baseline, N=100 | 49% | 50% | +1 point |
| Round robin, N=25/matchup | 63.6% | 61.8% | -1.8 points / 4 games |

The round-robin movement was mixed: Lion gained one game each against Crane,
Crane Duels, and Dragon Attachments, was unchanged against Crab and Unicorn,
and lost games across Dragon, Phoenix, and Scorpion. That pattern and sample
size do not justify weakening the exact base-skill safety rule, so no
matchup-specific tuning was added.

Regression coverage executes both card paths for seeds 1, 2, and 5, verifies
that total skill cannot override a losing base-skill matchup, verifies the
injectable equal-skill threshold, and verifies singleton distribution. The
all-opponent interaction audit ran 30 Lion games (10 opponents x 3 seeds) with
zero rejected clicks, cycles, forced progress, budget exhaustion, or stalls;
its reports are `tools/selfplay/out/lion-attachments-all-opponents-click-audit.*`.

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
