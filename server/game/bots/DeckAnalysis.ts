// Deck analysis for the seed-4 "omniscient" bot.
//
// The omniscient bot sees the human's hand and face-down provinces (it cheats).
// To turn that knowledge into good decisions it needs to know, for every card
// the human might hold, how much it can swing a conflict and what it costs in
// fate. Card BODIES (skill, cost) are read from the live card objects at run
// time, so any deck's characters/attachments are covered exactly. What the live
// object cannot tell us is what an EVENT does ("initiate a duel", "discard a
// character") — that needs curation. This registry supplies that per-card
// conflict model for a specific deck; a deck is "analyzed" when its conflict
// events all have entries here.
//
// swing = a card's approximate skill-equivalent effect on a conflict when it
// resolves (removal, duels, tempo). buff = flat skill it adds to a participant.
// tag classifies the effect for readable logging.

export type CardTag = 'body' | 'buff' | 'duel' | 'removal' | 'debuff' | 'honor' | 'draw' | 'utility';

export interface CardModel {
    id: string;
    type: string; // character | attachment | event | holding | province | stronghold | role
    side: string; // dynasty | conflict | province | role
    fate: number; // fate to play from hand (0 for most events)
    mil: number; // printed military skill (characters)
    pol: number; // printed political skill (characters)
    milBonus: number; // military skill granted to a participant (attachments/buffs)
    polBonus: number; // political skill granted to a participant
    swing: number; // skill-equivalent conflict swing (events: removal/duel/debuff)
    tag: CardTag;
}

// One entry per card. Bodies carry printed skill for reference; the controller
// prefers the live card object's numbers when it can, and overlays the curated
// swing/buff/tag from here. Events are the reason this table exists.
//
// Analyzed decks:
//   - Crane Duels (EmeraldDB b59bc6b3): duel/honor archetype. Its threat is
//     duels (game-of-sadane, duel-to-the-death, disparaging/issue-a-challenge)
//     and character removal (assassination), not raw skill stacking.
const ANALYSIS: CardModel[] = [
    { id: 'shukujo', type: 'attachment', side: 'conflict', fate: 2, mil: 0, pol: 0, milBonus: 2, polBonus: 3, swing: 0, tag: 'buff' },
    { id: 'ornate-fan', type: 'attachment', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 2, swing: 0, tag: 'buff' },
    { id: 'pilgrimage', type: 'province', side: 'province', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'utility' },
    { id: 'fine-katana', type: 'attachment', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 2, polBonus: 0, swing: 0, tag: 'buff' },
    { id: 'kakita-dojo', type: 'holding', side: 'dynasty', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 3, tag: 'duel' },
    { id: 'kakita-yuri', type: 'character', side: 'dynasty', fate: 3, mil: 0, pol: 3, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'doji-kuwanan', type: 'character', side: 'dynasty', fate: 5, mil: 5, pol: 4, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'kakita-blade', type: 'attachment', side: 'conflict', fate: 1, mil: 0, pol: 0, milBonus: 2, polBonus: 0, swing: 0, tag: 'buff' },
    { id: 'tengu-sensei', type: 'character', side: 'dynasty', fate: 5, mil: 4, pol: 2, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'assassination', type: 'event', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 4, tag: 'removal' },
    { id: 'daidoji-uji-2', type: 'character', side: 'dynasty', fate: 5, mil: 6, pol: 2, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'kakita-kaezin', type: 'character', side: 'dynasty', fate: 3, mil: 3, pol: 2, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'kyuden-kakita', type: 'stronghold', side: 'province', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'utility' },
    { id: 'seeker-of-air', type: 'role', side: 'role', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'utility' },
    { id: 'cautious-scout', type: 'character', side: 'dynasty', fate: 2, mil: 2, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'elemental-fury', type: 'province', side: 'province', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'utility' },
    { id: 'fertile-fields', type: 'province', side: 'province', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'utility' },
    { id: 'game-of-sadane', type: 'event', side: 'conflict', fate: 1, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 3, tag: 'duel' },
    { id: 'make-your-case', type: 'event', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 3, tag: 'duel' },
    { id: 'proving-ground', type: 'holding', side: 'dynasty', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'draw' },
    { id: 'storied-defeat', type: 'event', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 2, tag: 'debuff' },
    { id: 'ancestral-lands', type: 'province', side: 'province', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'utility' },
    { id: 'arrogant-kakita', type: 'character', side: 'dynasty', fate: 2, mil: 3, pol: 2, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'daidoji-harrier', type: 'character', side: 'dynasty', fate: 2, mil: 2, pol: 1, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'daimyo-s-gunbai', type: 'attachment', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 2, polBonus: 2, swing: 3, tag: 'duel' },
    { id: 'doji-challenger', type: 'character', side: 'dynasty', fate: 3, mil: 3, pol: 3, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'iaijutsu-master', type: 'attachment', side: 'conflict', fate: 1, mil: 0, pol: 0, milBonus: 1, polBonus: 1, swing: 0, tag: 'buff' },
    { id: 'kakita-favorite', type: 'character', side: 'dynasty', fate: 2, mil: 3, pol: 1, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'daidoji-nerishma', type: 'character', side: 'dynasty', fate: 2, mil: 3, pol: 1, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'duelist-training', type: 'attachment', side: 'conflict', fate: 1, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 3, tag: 'duel' },
    { id: 'insult-to-injury', type: 'event', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 1, tag: 'debuff' },
    { id: 'kakita-toshimoko', type: 'character', side: 'dynasty', fate: 4, mil: 4, pol: 3, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'way-of-the-crane', type: 'event', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 2, tag: 'honor' },
    { id: 'duel-to-the-death', type: 'event', side: 'conflict', fate: 1, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 5, tag: 'duel' },
    { id: 'graceful-guardian', type: 'character', side: 'dynasty', fate: 1, mil: 2, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'iron-crane-legion', type: 'character', side: 'dynasty', fate: 4, mil: 0, pol: 3, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'issue-a-challenge', type: 'event', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 3, tag: 'debuff' },
    { id: 'seal-of-the-crane', type: 'attachment', side: 'conflict', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 1, swing: 0, tag: 'buff' },
    { id: 'courtly-challenger', type: 'character', side: 'dynasty', fate: 2, mil: 0, pol: 2, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'cunning-negotiator', type: 'character', side: 'dynasty', fate: 4, mil: 1, pol: 5, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'aspiring-challenger', type: 'character', side: 'dynasty', fate: 2, mil: 2, pol: 2, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'arbiter-of-authority', type: 'character', side: 'conflict', fate: 2, mil: 0, pol: 2, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'daidoji-iron-warrior', type: 'character', side: 'dynasty', fate: 3, mil: 3, pol: 3, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' },
    { id: 'disparaging-challenge', type: 'event', side: 'conflict', fate: 1, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 3, tag: 'duel' },
    { id: 'kakita-s-final-stance', type: 'event', side: 'conflict', fate: 1, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 2, tag: 'utility' },
    { id: 'meditations-on-the-tao', type: 'province', side: 'province', fate: 0, mil: 0, pol: 0, milBonus: 0, polBonus: 0, swing: 0, tag: 'utility' },
    { id: 'local-daimyo-s-retainer', type: 'character', side: 'conflict', fate: 1, mil: 2, pol: 2, milBonus: 0, polBonus: 0, swing: 0, tag: 'body' }
];

const BY_ID = new Map<string, CardModel>(ANALYSIS.map((card) => [card.id, card]));

export function getCardModel(id?: string): CardModel | undefined {
    return id ? BY_ID.get(id) : undefined;
}

// A deck is "analyzed" for the omniscient bot when every conflict-side event it
// runs has a curated entry (bodies/attachments are read live, so they never
// gate). `missing` lists the uncurated event ids so the bot can log what it is
// blind to; it still plays, it just cannot value those tricks.
export function analyzeDeck(cardIds: string[]): { analyzed: boolean; missing: string[]; known: number } {
    const missing: string[] = [];
    let known = 0;
    for(const id of new Set(cardIds)) {
        const model = BY_ID.get(id);
        if(model) {
            known++;
        }
    }
    // We only *require* events to be curated; unknown ids that are not events
    // cannot be detected here (we have no live type), so callers pass the known
    // conflict-event ids they see. Kept simple: report coverage.
    return { analyzed: missing.length === 0, missing, known };
}

// One card the human holds, as the omniscient bot sees it. The controller fills
// mil/pol/fate from the live card object (exact for any deck) and overlays
// swing/buff/tag from the registry (deck-specific curation).
export interface KnownCard {
    id: string;
    type: string;
    side: string;
    fate: number;
    mil: number;
    pol: number;
    milBonus: number;
    polBonus: number;
    swing: number;
    tag: CardTag;
}

// A single opponent province as the omniscient bot sees it — including the real
// strength of a still-face-down province (the cheat: a fair bot cannot see this).
export interface OmniProvince {
    location: string;
    name: string;
    strength: number;
    broken: boolean;
    facedown: boolean;
}

// The complete cheat view handed to the policy for seed 4: the human's fate, the
// real contents of their hand, and the true strength of every province.
export interface Omniscient {
    oppName: string;
    oppFate: number;
    oppHand: KnownCard[];
    oppProvinces: OmniProvince[];
    // Conflict-event ids in the human's deck with no curated model — the tricks
    // the bot is blind to. Empty when the deck is fully analyzed.
    unmodeledEvents: string[];
}

// Realistic skill the human can add to ONE conflict of `type` from `hand`,
// paying no more than `fate`. NOT the sum of the whole hand — a player commits a
// couple of cards to a single conflict, not their entire hand at once (and most
// events/duels are situational). So this returns the best affordable BODY (a
// conflict character moved in) plus the best affordable TRICK (an attachment
// buff or event swing), sharing the fate budget. That keeps the estimate a
// believable single-conflict threat instead of an impossible total.
//
// This is the number the omniscient bot beats when it commits an attack and the
// number it respects when it holds: if the human cannot afford to close the gap,
// the bot presses; if they can swing it out of reach, the bot holds.
export function estimateHandThreat(
    hand: KnownCard[],
    fate: number,
    type: 'military' | 'political'
): { skill: number; detail: string } {
    const budget = Math.max(fate, 0);

    const bodies = hand
        .filter((card) => card.type === 'character' && card.side === 'conflict')
        .map((card) => ({ card, v: Math.max(type === 'military' ? card.mil : card.pol, 0), cost: Math.max(card.fate, 0) }))
        .filter((entry) => entry.v > 0);

    const tricks = hand
        .map((card) => {
            const buff = card.type === 'attachment' ? Math.max(type === 'military' ? card.milBonus : card.polBonus, 0) : 0;
            return { card, v: buff + card.swing, cost: Math.max(card.fate, 0) };
        })
        .filter((entry) => entry.v > 0 && entry.card.type !== 'character');

    const bestUnder = (list: { card: KnownCard; v: number; cost: number }[], b: number) =>
        list.filter((entry) => entry.cost <= b).sort((a, c) => c.v - a.v)[0];

    const bestBody = bestUnder(bodies, budget);
    const bestTrick = bestUnder(tricks, budget);

    // The human plays whatever gives the biggest single-conflict swing they can
    // afford: the best body alone, the best trick alone, or — when the fate
    // covers both — the pair. Take the strongest of the three (never more than
    // one body + one trick, so the estimate stays a believable single turn).
    const pairFeasible = bestBody && bestTrick && bestBody.card !== bestTrick.card
        && bestBody.cost + bestTrick.cost <= budget;
    const bodyOnly = bestBody ? bestBody.v : 0;
    const trickOnly = bestTrick ? bestTrick.v : 0;
    const pair = pairFeasible ? bestBody.v + bestTrick.v : 0;

    const skill = Math.max(bodyOnly, trickOnly, pair);
    let detail = 'nothing playable';
    if(skill > 0) {
        if(skill === pair) {
            detail = `${bestBody.card.id}(+${bestBody.v}/${bestBody.cost}f) ${bestTrick.card.id}(+${bestTrick.v}/${bestTrick.cost}f)`;
        } else if(skill === bodyOnly && bestBody) {
            detail = `${bestBody.card.id}(+${bestBody.v}/${bestBody.cost}f)`;
        } else if(bestTrick) {
            detail = `${bestTrick.card.id}(+${bestTrick.v}/${bestTrick.cost}f)`;
        }
    }

    return { skill, detail };
}
