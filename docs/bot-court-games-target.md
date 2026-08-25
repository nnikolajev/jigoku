# Court Games: the opponent picks the dishonor target

`DeckProfile.courtGamesOpponentPicksDishonor` — the fifth argument of
`PersonalHonorTactics.shouldHonorOwn`.

## The defect

Court Games offers two halves and the bot chooses between them:

```ts
'Honor a friendly character':   selectCard({ controller: Players.Self,     ... }),
'Dishonor an opposing character': selectCard({
    player: Players.Opponent,        // <- the OPPONENT chooses which one
    controller: Players.Opponent,
    cardCondition: card => card.isParticipating(),
```

V1 priced the dishonor half at the opponent's **highest**-glory participant,
because `rankEnemyDishonor` sorts glory descending and it took `[0]`. But the
target is not ours to pick — the opponent hands over whichever of their
participants loses them the least, i.e. the **lowest**-glory one that is not
already dishonored. Pricing the branch at their best body makes the dishonor
look better than it can ever be and refuses honors that are worth more.

Seen live, 2026-08-25, Dragon vs Phoenix, round 3 conflict 1. Own participants
included Togashi Mitsu (glory 3, unhonored); their participants were Shiba
Tsukune (glory 4), Isawa Tadaka (2) and Shiba Yōjimbō (2). V1 compared 3 against
Tsukune's 4 and chose to dishonor; the opponent then dishonored Shiba Yōjimbō
for 2. Comparing 3 against the achievable 2 honors Mitsu instead.

## The rule

`shouldHonorOwn(own, enemy, bonus, board, opponentChoosesTarget)` reads the LAST
entry of the enemy ranking instead of the first when the opponent picks. The own
side is unchanged and still routes through `pickOwnHonor`, which now also
carries the persistence tier (see `bot-honor-target-persistence.md`).

## Scope

Off for the decks that RACE the honor track or run a dishonor engine — the
Crane and Lion honor lists and both Scorpion lists. There the token is an engine
trigger rather than a stat swing, and those decks either answer this menu from
their own branch (`CraneBaselineTactics.shouldHonorWithCourtGames`,
`GloryTactics`) or want the dishonor regardless of what glory it lands on.

## Measurement

`false` reproduces V1 exactly (`refactorIdentity` unchanged at
`409b3d34aaa6bfad` with the knob injected at `false`).

| rig | games | result |
|---|---:|---|
| null arm, head-to-head | 1614 / 3 bases | 807-807, exactly 50.00% |
| null arm, shipped build | 1622 / 3 bases | 811-811, exactly 50.00% |
| paired probe, seat 0 | 272 / 1 base | 1 winner flipped, 2 more paths changed — **98.9% of games bit-identical** |
| whole-batch head-to-head, inverted | 3232 / 6 bases | OFF arm 49.85%, p=0.860 |

**Ceiling 0.18pp.** The card is one copy in a handful of lists and only fires in
a political conflict where both sides have an eligible participant, so no
head-to-head can resolve it. Correctness class, same standing as
`polarityGuards`: the rule is provably the right reading of the card text. Do
not re-measure it hoping for a number.
