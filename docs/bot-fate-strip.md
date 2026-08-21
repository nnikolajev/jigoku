# Fate-strip targeting (`fateRemovalKillFirst`)

**Status: SHIPPED field-wide 2026-08-21, default `true`.**
Head-to-head **+1.13pp (p=0.195)**, pooled flip sign test **+0.92pp (p=0.037)**.

## The defect

A source that removes a FIXED small amount of fate was aiming at the
opponent's **fattest** character. Removing one fate from a four-fate body
changes nothing this game — the character still sits there for four more fate
phases. Removing the last fate from a one-fate body **discards it** in the fate
phase, along with its attachments and any fate the opponent sank into it.

Three separate paths carried the defect:

| path | old ranking | source |
|---|---|---|
| `ringResolutionDecision`, void ring | fattest enemy (`byFateDesc`) | Void Ring Effect |
| hinted enemy target | printed `targetPreference: 'most-fate'` | Meditations on the Tao, Kuni Ritsuko |
| generic harmful target | `sortBySkillDesc` — biggest enemy | any unhinted `removeFate` |
| Isawa Tsuke selector | `stripValue` = skill + 3/fate + 2/attachment | Isawa Tsuke |

The Tsuke ranker is the same mistake in explicit form: it PRICED fate at +3 per
point ("what the opponent sank into it"), which sorts the bodies that survive a
strip above the bodies a strip kills.

## The rule

`JigokuBotPolicy.sortByFateStripValue` — **lowest fate first**, ties to the
bigger body (of two characters that die, kill the one worth more), then uuid.

It is applied only where `prefersFateStrip(actionNames)` holds: `removeFate` is
present and is the **only** harmful action on the prompt. A source that also
bows, dishonors or discards still wants the biggest body, and its ordering is
untouched.

Two things it deliberately does NOT do:

- **It never aims at our own board.** The void ring still declines the
  resolution outright rather than strip our own fate. The forced-own branch (no
  decline button AND no legal enemy target) was fixed in the same pass: it used
  to pick our LOWEST-fate character, i.e. it killed one of our own bodies. It
  now picks our fattest, which survives the fate phase regardless.
- **It does not need a `fate > 0` filter.** `RemoveFateAction.canAffect`
  already rejects a 0-fate target, so a 0-fate candidate can only reach such a
  prompt when the source kills instead of stripping (Akodo Makoto's conditional
  `discardFromPlay`) — and there, sorting it first is exactly right.

Injectable as `DeckProfile.fateRemovalKillFirst`; `false` restores the
pre-fix ordering EXACTLY, on all four paths, so the `off` arm is the
measurement.

## Measurement

Rig validated: `LABEL=null CHANGE='{"deckProfile":{"fateRemovalKillFirst":true}}'`
(the knob at its own default) scored **exactly 50.00%** — 816-816 over 1632
games, 272-272 on each of bases 91001/92001/93001, 0 draws.

**Ceiling** (`measureDecisiveness.js`, base 91001, 272 games): the winner flips
in **4.8%** of games, another 8.5% take a different path to the same winner,
86.8% are bit-identical. So the mechanism is reachable, and no head-to-head can
read the lever above ±2.39pp. At that ceiling a 3264-game head-to-head has a
noise floor of about ±1.7pp — which is why the flip sign test, not the win
rate, is the instrument that resolves this one.

**Head-to-head** (`parallelHeadToHead.js`, treated seat = `off` arm, 6 fresh
bases 94001-99001, 3264 games, 0 draws):

| base | off arm | delta |
|---|---:|---:|
| 94001 | 50.00% | 0.00pp |
| 95001 | 49.63% | −0.37pp |
| 96001 | 49.82% | −0.18pp |
| 97001 | 48.71% | −1.29pp |
| 98001 | 47.79% | −2.21pp |
| 99001 | 47.24% | −2.76pp |
| **total** | **48.87%** | **−1.13pp** (z=−1.30, p=0.195) |

The old behaviour is negative on five of six bases and positive on none, so
kill-first reads **+1.13pp** — the right sign, not resolved at this n.

**Pooled flip sign test** (12 fresh bases 100001-111001, 3264 games, seat 0
treated with the `off` arm). Only decided games carry information, so this is
roughly an order of magnitude cheaper than a bigger round robin:

- 194 games decided by the change; **112 to kill-first, 82 to the old
  ordering — 57.7%, p=0.037** (exact two-sided binomial).
- Implied win rate: 5.94% flip rate x 15.5% edge = **+0.92pp**, single-seat.

Including base 91001 (the earlier ceiling run, which alone went 9-4 the other
way) the pool is 116/207 = 56.0%, p=0.095. Both readings agree in sign with the
head-to-head and agree in magnitude with each other, around +1pp.

Note the single-seat caveat: `measureDecisiveness.js` treats seat 0 and never
swaps it, so a first-player interaction survives in that number. The
head-to-head is the unbiased one; here the two land within 0.2pp of each other.

## Why it ships despite p=0.195 on the win rate

The lever is a correctness fix with a positive point estimate on both rigs and
no base reading against it in the head-to-head. It is also cheap: it fires in a
few percent of games and changes nothing else. The honest summary is "worth
about +1pp, resolved to p=0.037 only by the flip test" — not "a measured
+1.13pp win".

## Coverage

`test/server/bots/jigokuheuristicbot.spec.js` — void ring kill-first, the
fate tie-break on the bigger body, the forced-own fattest pick, the hinted
`most-fate` override (Meditations on the Tao) and the unhinted generic path
(Kuni Ritsuko), plus the negative case: `removeFate` + `bow` keeps the
strongest-first ordering.
