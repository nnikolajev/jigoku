# Where an attachment goes while a conflict is running

## The report

Live game, 2026-08-24, Jigoku Bot (Unicorn) vs a human Dragon deck, round 3
conflict 3. Military/Void, the bot attacking, **4 vs 2**:

```
Military Void conflict - Attacker: 4 Defender: 2
Jigoku Bot plays Seal of the Unicorn, attaching it to Young Warrior
Military Void conflict - Attacker: 4 Defender: 2      <- unchanged
Jigoku Bot plays Curved Blade, attaching it to Minami Kaze Regulars
Military Void conflict - Attacker: 7 Defender: 2      <- Sacred Sanctuary breaks
```

Young Warrior was **bowed, at home, 0 fate**. Minami Kaze Regulars was the whole
attacking force. The owner's question: why did the +1 military go to a body that
could not use it?

## Two separate answers

**That specific placement was forced.** Minami Kaze Regulars reads *"No
attachments except Weapon"*; Seal of the Unicorn's traits are `item`/`seal`, so
the engine never offered it as a target. Young Warrior was the only legal bearer.
Reproducing the exact replay frame through `JigokuBotPolicy.decide` with both
bodies selectable returns Minami Kaze Regulars, which is the right answer — the
policy was never asked. (Curved Blade is a Weapon, which is why it could go
there.)

**The general defect is real, and it is not Unicorn's.** Feeding the same
question to every deck in the field found the same shape in nine of them, from
five different code paths. The rule V1 used was:

```ts
if(standing && standing.losing) {        // pull it onto a participant
} else if(!restricted) {                 // otherwise build the home tower
}
```

`losing` is the wrong test. A conflict at 4 vs 2 into a strength-5 province is
not lost — it is **three skill short of the break**, and the attachment is the
three skill. V1 sent it home in every such window.

## The other half: the bot could not SEE the restriction

Choosing the right bearer is only half the question. The one the owner asked
next is the better one:

> I want to boost Kaze Regulars -> look at hand -> attachments that are not
> Weapon should be unavailable.

V1 could not do that, and not because of a missing rule. **The serialized player
state a policy sees carries no card text**: skill summaries, fate, bowed,
inConflict, traits — and nothing at all about what a body may carry. So the play
gate priced Seal of the Unicorn as "+1 military on the best body I have",
played it, and only discovered at the target prompt that its one legal home was
a bowed body at home. With a Weapon sitting in the same hand.

`JigokuBotController.legalAttachmentTargetUuidsBySource` already existed and
already asked the engine's own target resolver this question — but it was
published for **V2 only** and V1 never read it. It does now, behind the same
profile flag (`requireUsableBearer`):

* the play gate narrows `myCharacters` to the bodies the ENGINE would accept for
  that exact card, so every gate below it prices the card on real bearers;
* no legal bearer at all -> `no-legal-attachment-bearer`;
* a conflict that still needs skill and no legal bearer fighting in it ->
  `no-usable-attachment-bearer`, i.e. hold the card. That is what makes the bot
  reach for the Weapon instead.

**No card list, and none wanted.** `BaseCard.parseKeywords` turns the printed
text into `allowedAttachmentTraits` — `"No attachments except Weapon"` ->
`['weapon']`, `"No attachments except Monk or Tattoo"` -> `['monk','tattoo']`,
`"No attachments."` -> `['none']`, which matches nothing — and
`AttachAction.canAffect` enforces it alongside the attachment's own side of the
restriction (`canAttach`: Unicorn-only, Cavalry-only, unique-only, my-control-
only). Reading the engine covers all of it, including cards no deck in the field
plays yet.

The pool today holds **42 characters** with a printed restriction across ten
wordings, and `test/server/bots/attachmentbearerlegality.spec.js` walks every
one of them through the engine's own parser, so a future wording that escapes it
fails there rather than silently letting the bot hang a weapon on a body that
cannot hold it. The single exception is `kuro` ("no attachments, unless their
printed cost is 1 or higher"), which is a condition rather than a trait list and
implements `allowAttachment` itself — the same method the bot's read calls.

The same file pins the read against a LIVE game for all three shapes:
bearer-side keyword (Minami Kaze Regulars takes only Weapons), bearer-side
blanket ban (Fushichō, Aranat), and attachment-side conditions (Curved Blade is
Unicorn-only, Shinjo Saddle is Cavalry-only).

## The invariant, and the suite that watches it

`test/server/integration/botattachmentvalue.spec.js` plays the whole field
headless and runs `AttachmentValueMonitor` (`test/helpers/attachmentvalue.js`)
against the engine's own `onCardAttached` events. It judges only OWN-side
attachments the bot lands on its OWN characters; enemy debuffs belong to
`effectpolarity.js`, which already watches those.

Each placement settles into one class:

| class | meaning |
|---|---|
| `contributed` | bearer was an unbowed participant, so the printed line counted |
| `readied-in` | landed on a bowed participant that was standing by resolution |
| `ability-carrier` | no stat line to judge; the card's value is its ability |
| `prep` / `used-later` | placed with no conflict running; later fought carrying it |
| `idle` | landed into a live conflict on a body that added nothing |
| `wasted` | `idle`, the conflict still needed skill, **and the same prompt offered an unbowed participant** |

`wasted` is the only failing class. It mirrors the `avoidable` gate in
`effectpolarity.js`: the alternatives come from the prompt's own selectable
list, so every attachment restriction the engine knows ("no attachments except
Weapon", faction/trait restrictions, the restricted cap) is already applied and
a placement the engine never offered a choice on is reported as `forced`, never
failed. Two attribution rules matter:

- **Judge at the instant of the attach, not at resolution** — the same rule
  `movevalue.js` uses for a move. A bearer that was an unbowed participant when
  the attachment landed made the bonus count whatever the opponent did to it
  afterwards. Only a bearer that could not use it *then* is settled by the
  resolution, which is what rescues a `readied-in`.
- **Alternatives come from an EXACT ability-context match.** A same-source click
  from a different prompt in the same play — a Scorpion dishonor COST paid on
  the body that then received the attachment — carries a candidate list
  belonging to a different question and reads as a phantom `avoidable`. The
  decision REASON may use the looser match; the gate may not.

## The fix

`AttachmentTargetPolicy` (`server/game/bots/AttachmentTargetPolicy.ts`),
configured from `DeckProfile.attachmentTarget`, replaces `losing` with
`conflictStrengthNeeded > 0` — as attacker, the skill still missing from the
province strength; as defender, the skill that stops the break or retakes the
conflict. `maxSkillNeeded` (6) keeps the tower branch for a conflict no
attachment is rescuing.

It is applied **once**, where `polarityTargetDecision` splits the prompt's
selectable cards into `mine`/`theirs`, so every downstream picker chooses from
the narrowed list. That is what makes it generic — before the fix these five
paths each had their own answer and all five could send a weapon home
mid-conflict:

- `attach-to-own` — the shared tower-biased targeter
- `attachment-tower-target` — `DragonAttachmentTactics`, ranking by tower list
- `duel-attach-tower` — `DuelTactics`
- `lion-tessen-ready-cheap` / `bid-war-tessen-ready-cheap` — Elegant Tessen's
  enter-play ready, aimed at a cheap **bowed** body at home
- `lion-duelist-*-carrier`, `crab-buff-*`, `unicorn-*-target` — deck carriers

Two exemptions, both because the card's value *is* a bearer outside the fight:

- `HOME_BEARER_ATTACHMENT_IDS` = `adorned-barcha`, `formal-invitation`,
  `spyglass`. The first two are `MOVE_SOURCES` entries with `selfOrBearerOnly`
  — their Action moves the bearer INTO the conflict, so a bearer already there
  throws the card away. Spyglass draws off a commit/move from home.
- `HOME_BEARER_NEEDS_READY_IDS` = `formal-invitation`. A move-in card still
  needs a bearer that arrives with skill, so the bowed half of the home board is
  no better than a participant. Adorned Barcha is deliberately absent: its
  Action bows an enemy participant whatever its own bearer's skill, which is the
  value `movevalue.js` already credits it with.

## Measured census (17 decks, 3 bases, both seats, ~950 placements)

| | V1 | bearer choice only | + the play gate |
|---|---:|---:|---:|
| counted in the conflict they were played into | 225 | 250 | **264** |
| idle | 62 | 35 | **12** |
| of those, avoidable | 27 | 2 | **2** |

The 2 remaining are one card: **Calling in Favors**, whose single prompt chooses
the body that is dishonored *and* the body that receives the stolen attachment.
The two halves want opposite answers — a dishonor costs a participant its glory
off both skills — so it is listed in `test/helpers/attachmentallowances.js`
rather than forced.

Note that a single self-play run is not bit-reproducible across processes: many
bot sorts break ties on `uuid`, which is time-based. Read this census as a
sample, the way the polarity suite is read.

## Win rate: a clean null, and that is the expected answer

Ceiling first, as always. The paired probe over 9 bases and both seats flips
**6.5% of games**, so the rig can resolve about 3pp — comfortably enough for a
real lever to show.

| | games | decided | to | away | effect | p |
|---|---:|---:|---:|---:|---:|---:|
| seat 0 | 2448 | 151 | 75 | 76 | -0.02pp | |
| seat 1 | 2448 | 166 | 82 | 84 | -0.04pp | |
| **pooled** | **4896** | **317** | **157** | **160** | **-0.03pp** | **0.91** |

No deck is outside noise. The largest per-deck reads are CrabSacrifice +1.56pp
(p=0.31) and UnicornReveal -1.04pp (p=0.21), on 61 and 16 decided games; two
decks (PhoenixPhoenix, PhoenixShugenja) never flipped a game at all. Per-deck
rows from a paired probe ARE causal, but at that n they are hypotheses.

Rig validation: injecting the knob at its own default runs **bit-identical** to
the un-injected build (`refactorIdentity` SHA `1bba63cfbff9f1bc` both ways), so
the injection path adds nothing of its own.

**SHIPPED ON field-wide anyway, as a correctness class.** Same standing as
`polarityGuards` (+0.43pp, p=0.73), `readyValue` (p=0.85) and `readyMove`
(p=1.0): the payoff is that the bot stops making a play that is visibly wrong to
a human watching a replay, and the measurement says it costs nothing to stop.
Do not re-measure it hoping for a number.

Revert with `{"attachmentTarget":{"enabled":false}}`, which reproduces V1
exactly (same SHA as above). `requireUsableBearer: false` reverts only the play
gate and keeps the bearer choice.

## Where the remaining idle placements are

`forced` is now most of what is left, and the census names them: Sharpened
Tsuruhashi on Crab bodies that are the only legal Bushi, Ancestral Daishō on a
Daimyo's Favor bearer chosen a prompt earlier, Ofushikai on its champion. Those
are cards with one legal home, not decisions.

The two `avoidable` are one card, **Calling in Favors**, whose single prompt
picks the body that is dishonored AND the body that receives the stolen
attachment. The halves want opposite answers — a dishonor costs a participant
its glory off both skills — so pricing it needs the stolen attachment's bonus,
which is chosen in a different prompt. Listed in
`test/helpers/attachmentallowances.js` rather than forced.

## Next, if this is picked up again

The play gate holds a card when no legal bearer can use it. It does not yet
prefer the attachment whose legal bearers are BEST — given a Weapon and a
non-Weapon both playable, it takes whichever the existing ranking prefers. The
data to do that is already on the context
(`legalAttachmentTargetUuidsBySource`); what is missing is a ranking that
prices each hand attachment on its own best legal bearer.
