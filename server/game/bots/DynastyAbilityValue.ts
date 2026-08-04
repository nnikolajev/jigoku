// Signed skill-equivalent prices for the STATIC printed text on dynasty
// characters.
//
// Why this file exists
// -------------------
// `JigokuBotController.dynastyCharacterInfo` prices a dynasty character's
// ability like this:
//
//     abilityValue = min(4, abilityCount * 0.7 + strategicTerms * 0.45)
//
// where `abilityCount` counts the entries in `card.abilities.{actions,
// reactions, interrupts, forcedReactions, forcedInterrupts}` and
// `strategicTerms` counts substring hits from a fixed phrase list. Measured
// over the ten-deck field (90 games, every character actually offered):
//
//     abilityValue = 3.50  ->  24 characters
//     abilityValue = 3.95  ->   3 characters
//     abilityValue = 4.00  ->  90 characters
//
// The whole field spans 0.50, or 0.375 after `abilityValueWeight` 0.75 — less
// than half a point of skill, against a `primarySkillWeight` of 1. The term is
// a saturated constant and orders nothing. It saturates because the engine
// registers 5-6 framework reactions on EVERY character, so `abilityCount * 0.7`
// alone is already 3.5-4.2 before a single word of card text is read.
//
// It is also UNSIGNED. `Math.min` clamps the top but nothing clamps the bottom,
// and the phrase list contains 'cannot be', 'honor ' and 'dishonor'. So Hiruma
// Yojimbo ("cannot be declared as an attacker") scores the same +0.45 for its
// drawback that a benefit would earn, and Shiba Peacemaker — 4 military that may
// never attack — is indistinguishable from a vanilla body.
//
// Scope: STATIC text only
// -----------------------
// A constant is the right model for text that is always on: keywords,
// restrictions, and permanent modifiers. It is the wrong model for an Action or
// Reaction, whose worth depends on a board state this table cannot see. So only
// always-on text is priced here; triggered abilities keep the existing term.
// That also keeps the two models from double-counting the same card.
//
// Units are points of PRIMARY skill, matching `primarySkillWeight: 1`. The
// value is added at weight 1.0 alongside `characterValueById`, which is the
// same mechanism a deck profile already uses to override a single card.
//
// A card absent from this table is priced 0 — "this table has no opinion" —
// which is also what every card scored before it existed.
export const DYNASTY_ABILITY_VALUE: Record<string, number> = {
    // ---- restrictions on attacking ----
    // The body is only half a body: its skill can never be pointed at a
    // province, and conquest is how ~80% of field games end.
    'shiba-peacemaker': -2, // 1-cost 4/1 that cannot participate as an attacker
    'hiruma-yojimbo': -2, // 2-cost 4/3 that cannot be declared as an attacker
    'palace-guard': -0.5, // only blocked against a LESS honorable player
    // Forced into the first conflict each round, so it cannot be held back for
    // the conflict it is actually needed in.
    'young-warrior': -1,

    // ---- ongoing costs ----
    // Bleeds 1 honor on every declaration, attacking or defending, unlimited.
    'marauding-oni': -1.25,
    // "You are considered to be less honorable than each opponent" is a
    // permanent global handicap: it switches off our own honor-comparison
    // effects and switches on theirs. A dishonor deck wants exactly this, and
    // overrides it through `characterValueById`.
    'loyal-oathbreaker': -1.5,
    // Limited (one per round, competing with every other Limited play) and
    // cannot take fate from the province, so it is a one-round body.
    'doomed-shugenja': -1.25,

    // ---- attachment restrictions ----
    // Priced against the attachment towers these decks build; "except Weapon"
    // keeps the military half open, so it costs less.
    'kaiu-siege-force': -0.5,
    'fushicho': -0.5,
    'minami-kaze-regulars': -0.25,
    'higashi-kaze-company': -0.25,

    // ---- army-wide auras ----
    // Every other Lion character gets +1 military, board-wide and unconditional.
    'commander-of-the-legions': 2,
    // Same effect narrowed to participating characters in its own conflict.
    'honored-general': 1.5,

    // ---- permanent modifiers that carry the card ----
    // Dire: participates in EVERY conflict for free while any other character
    // does, and does not bow for it. A 1-cost body with an extra body's reach.
    'iuchi-soulweaver': 2.5,
    // Printed 0/0 — the ability is the entire card, and the skill model prices
    // the body at zero without it.
    'utaku-infantry': 2,
    // 0-cost body that is +2 military for most of the game.
    'battle-maiden-recruit': 1.5,
    // Cancels the first action ability the opponent triggers in each conflict,
    // for as long as we have not lost one this phase.
    'hida-kisada': 1.5,
    // X equals the opponent's hand size in any conflict we are part of.
    'iron-crane-legion': 1.25,
    // Immune to opposing ring effects, forces Void onto the contested ring, and
    // resolves every effect of the ring it wins.
    'isawa-kaede': 1,
    'shadow-stalker': 0.75, // Rally, plus +2/+2 while at 6 or fewer honor
    'kitsuki-counselor': 0.75, // Composure +1/+1
    'yogo-outcast': 0.75, // +1/+1 while less honorable than an opponent
    'moto-youth': 0.5, // +1 military in the first military conflict each round
    'kakita-favorite': 0.5, // +2 political while in a duel
    'frontline-engineer': 0.5, // +1 glory per holding in play
    'aspiring-challenger': 0.4, // Composure +2 glory

    // ---- staying ready ----
    // Not bowing on conflict resolution is a second conflict from one body,
    // which is the trade every measured defense experiment has come down on.
    'matsu-gohei': 1, // while attacking with 2+ other Bushi
    'chikai-order-protector': 0.75, // while defending beside a Courtier/Shugenja

    // ---- denial ----
    'ikoma-tsanuri-2': 1, // Rally, and blanks the attacked province's abilities
    'bayushi-shoju-2': 1, // opponents cannot hold the Imperial Favor
    'togashi-tadakatsu': 0.5, // we choose the element of every conflict against us
    'cautious-scout': 0.5, // blanks the defending province while attacking alone
    'midnight-builder': 0.5, // Dire holdings, and +2 strength to each holding

    // ---- static keywords ----
    // Covert removes a defender before defenders are declared.
    'tengu-sensei': 0.75,
    'kaiu-shuichi': 0.75,
    'shinjo-yasamura': 0.75,
    'yasuki-oguri': 0.75,
    // Disguised enters play on an existing body, dodging the fate curve.
    'togashi-ichi': 0.5,
    // Rally adds a card to the province on reveal — dynasty card advantage.
    'stoic-rival': 0.5,
    'beautiful-entertainer': 0.5,
    'twilight-rider': 0.5,
    'cunning-negotiator': 0.5,
    // Immune to the opponent's own Covert.
    'solitary-hero': 0.25,
    'togashi-mitsu-2': 0.25,
    'master-whisperer': 0.25, // Support
    'keen-warrior': 0.25, // Sincerity
    // Pride honors on a win and dishonors on a loss. Small and double-edged,
    // but a bot that wins most conflicts it enters lands on the good half.
    'akodo-gunso': 0.25,
    'thunder-guard-elite': 0.25,
    'shinjo-shono': 0.25,
    // Pride narrowed to duels rather than the keyword itself, on a body whose
    // own Action is a duel — so it lands on the same side of the trade.
    'courtly-challenger': 0.25
    // Deliberately NOT priced, having been checked:
    //   arrogant-kakita — Pride is cancelled out by a Forced Reaction that
    //     duels away from our choosing, so the net is ~0.
    //   samurai-of-integrity, moto-conqueror, young-philosopher,
    //     matsu-berserker — genuinely vanilla; the skill model already has
    //     everything there is to know about them.
};

export function dynastyAbilityValueOf(cardId: string | undefined): number {
    if(!cardId) {
        return 0;
    }
    const value = DYNASTY_ABILITY_VALUE[cardId];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
