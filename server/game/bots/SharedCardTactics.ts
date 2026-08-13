// Card logic shared by more than one shipped deck.
//
// A `PlaybookEntry` is a static registry keyed by printed card id, so it cannot
// see the resolved `DeckProfile`. Anything that needs a per-deck THRESHOLD or a
// per-deck TARGET RANKING therefore has to live in a policy dispatch site, and
// historically each of those sites was gated on one deck's tactics object —
// which made the logic unreachable for the second deck that ran the same card.
//
// The three profiles below lift exactly that shape out of `LionDuelistTactics`
// so both Kyuden Ikoma lists (Lion Duelist and Lion Honor) drive it from data.
// Every field is optional on `DeckProfile`: a deck that does not set one keeps
// the previous behaviour, and Lion Duelist sets them to its own measured values
// so it stays bit-identical.

type Axis = 'military' | 'political';

const numberOr = (value: any, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const skillOf = (card: any, axis: Axis): number => {
    const summary = axis === 'military' ? card?.militarySkillSummary : card?.politicalSkillSummary;
    const live = Number(summary?.stat);
    return Math.max(0, Number.isFinite(live) ? live : numberOr(card?.[axis], 0));
};

const gloryOf = (card: any): number =>
    Math.max(0, numberOr(card?.glorySummary?.stat ?? card?.glory, 0));

const byUuid = (left: any, right: any): number =>
    String(left?.uuid || '').localeCompare(String(right?.uuid || ''));

// Context for "who gets the honored token", shared by every deck that ranks
// honor targets from its own priority list. Both honor decks used to sort by
// that list alone, which hands the token to whichever printed id sits highest
// even when it is a bowed character at home and the token therefore swings
// nothing in the conflict being fought.
export interface HonorTargetOptions {
    // A conflict is live, so a token on a ready participant converts to skill
    // immediately. Outside a conflict every body is equally live.
    activeConflict?: boolean;
    // The source honors the same character TWICE (Soul Beyond Reproach). The
    // second half only pays on a DISHONORED body; on anything else it no-ops.
    doubleHonor?: boolean;
}

// PRINTED stats for a dynasty card sitting face-up in a province.
//
// The engine only fills `militarySkillSummary` / `politicalSkillSummary` /
// `glorySummary` for cards IN PLAY, so a province card reaches a dynasty ranker
// with `military`, `political` and `glory` all `undefined`. Any ranker that
// multiplies those by a weight silently scores every candidate on its ability
// term alone, and its skill/glory weights are dead knobs.
// `JigokuBotController.dynastyCharacterInfo` already publishes the exact
// printed values keyed by uuid; this is the shape the honor decks read them in.
export interface DynastyPrintedStats {
    military?: number;
    political?: number;
    glory?: number;
}

// Printed value first, live summary second, 0 last. Kept here so both honor
// decks resolve a province card's stats identically.
export const printedStatOf = (
    card: any,
    stats: DynastyPrintedStats | undefined,
    field: 'military' | 'political' | 'glory'
): number => {
    const exact = Number(stats?.[field]);
    if(Number.isFinite(exact)) {
        return Math.max(0, exact);
    }
    return field === 'glory' ? gloryOf(card) : skillOf(card, field);
};

export const hasTrait = (card: any, trait: string): boolean => {
    if(Array.isArray(card?.traits)) {
        return card.traits.some((value: any) => String(value).toLowerCase() === trait);
    }
    return typeof card?.traits === 'string' && new RegExp(`\\b${trait}\\b`, 'i').test(card.traits);
};

// ---- stronghold "bow a character" reaction (Kyuden Ikoma) -----------------
//
// "After a character you control loses a conflict as an attacker, bow this
// stronghold. Choose a non-Champion character - bow that character."
//
// Bowing an already-bowed body buys nothing, and a body that participated bows
// on its own when it goes home, so the only real targets are ready
// non-participants. The engine filters Champions out of the legal set; the
// id list is belt-and-braces for a Champion the summary does not mark.
export interface StrongholdBowProfile {
    strongholdCardId: string;
    championCharacterIds: readonly string[];
    // Bodies whose removal is worth more than their printed skill (a tower we
    // face). Only used to break ties in `bodyValue`.
    towerCharacterIds: readonly string[];
    requiresReadyTarget: boolean;
    skipsParticipants: boolean;
    minimumSkill: number;
}

export const STRONGHOLD_BOW_DEFAULTS: StrongholdBowProfile = {
    strongholdCardId: 'kyuden-ikoma',
    championCharacterIds: [],
    towerCharacterIds: [],
    requiresReadyTarget: true,
    skipsParticipants: true,
    minimumSkill: 1
};

export class StrongholdBowTactics {
    constructor(public readonly profile: StrongholdBowProfile) {}

    // Champion by trait or profile id. Champions are excluded from several
    // targeting effects by their printed text.
    isChampion(card: any): boolean {
        return hasTrait(card, 'champion') ||
            (!!card?.id && this.profile.championCharacterIds.includes(card.id));
    }

    // What a body is worth to its owner: skill on the axis, plus the fate and
    // attachments already sunk into it.
    bodyValue(card: any, axis: Axis): number {
        return skillOf(card, axis) + numberOr(card?.fate, 0) * 2 +
            (card?.attachments || []).length * 2 +
            (this.profile.towerCharacterIds.includes(String(card?.id || '')) ? 2 : 0);
    }

    // Legal targets, Champions removed.
    candidates(opponentCharacters: any[], axis: Axis): any[] {
        return (opponentCharacters || [])
            .filter((card) => card && !this.isChampion(card))
            .filter((card) => !this.profile.requiresReadyTarget || !card.bowed)
            .filter((card) => !this.profile.skipsParticipants || !card.inConflict)
            .filter((card) => this.bodyValue(card, axis) >= this.profile.minimumSkill);
    }

    // Highest-value legal target, with a uuid tie-break for determinism.
    pickTarget(opponentCharacters: any[], axis: Axis): any | null {
        return this.candidates(opponentCharacters, axis).slice()
            .sort((left, right) => this.bodyValue(right, axis) - this.bodyValue(left, axis) ||
                byUuid(left, right))[0] || null;
    }
}

// ---- conflict recursion (Kitsu Spiritcaller, Forebearer's Echoes) ---------
//
// Both put a character from a discard pile straight into the conflict, READY,
// so the whole of its skill on the contested axis lands immediately. Glory is a
// tiebreaker because an honored body carries it into the total.
export interface ConflictRecursionProfile {
    sourceCardIds: readonly string[];
    minimumSkill: number;
    gloryWeight: number;
    fateWeight: number;
}

export const CONFLICT_RECURSION_DEFAULTS: ConflictRecursionProfile = {
    sourceCardIds: ['kitsu-spiritcaller', 'forebearer-s-echoes'],
    minimumSkill: 2,
    gloryWeight: 0.5,
    fateWeight: 0
};

export class ConflictRecursionTactics {
    constructor(public readonly profile: ConflictRecursionProfile) {}

    // Is this card one of the recursion sources this profile knows about?
    isSource(cardId: string | undefined): boolean {
        return !!cardId && this.profile.sourceCardIds.includes(cardId);
    }

    // Recursion value of a body: axis skill plus weighted glory.
    score(card: any, axis: Axis): number {
        return skillOf(card, axis) +
            gloryOf(card) * this.profile.gloryWeight +
            numberOr(card?.fate, 0) * this.profile.fateWeight;
    }

    pickTarget(bodies: any[], axis: Axis): any | null {
        return (bodies || [])
            .filter((card) => card?.type === 'character' || card?.type === undefined)
            .sort((left, right) => this.score(right, axis) - this.score(left, axis) ||
                byUuid(left, right))[0] || null;
    }

    // Skill this recursion adds, net of a bow-self cost when the source is
    // itself a ready participant (Kitsu Spiritcaller bows to pay).
    gain(bodies: any[], axis: Axis, source?: any): number {
        const best = this.pickTarget(bodies, axis);
        if(!best) {
            return 0;
        }
        const paid = source?.inConflict && !source?.bowed ? skillOf(source, axis) : 0;
        return skillOf(best, axis) - paid;
    }

}

// ---- dynasty EVENTS ------------------------------------------------------
//
// A dynasty event is legal from a province exactly like a character, but every
// dynasty economy path in the bot ranks CHARACTERS only, so an event sits
// face-up in its province until the round ends and is discarded. Three copies
// of Honored Veterans measured ZERO uses per game before this hook existed.
export interface DynastyEventProfile {
    // "Each player chooses up to one Bushi character they played this phase —
    // honor each of those characters." Wants a body bought THIS phase that is
    // not yet honored and has glory to convert.
    honorBushiCardIds: readonly string[];
    honorBushiMinimumGlory: number;
    // A Season of War rerolls the visible provinces: only worth a card once
    // there is nothing left in them we want.
    rerollCardIds: readonly string[];
    rerollMaxUsefulProvinceCards: number;
    rerollMinimumFate: number;
    // Events whose value does not depend on our own board at all (Procedural
    // Interference: the OPPONENT picks between losing a province's contents and
    // handing us 2 honor, so both branches pay). Played whenever affordable.
    alwaysPlayCardIds: readonly string[];
    // ...unless our honor is already at or above this, in which case the
    // opponent will simply pay the 2 honor and walk us to the win — which is
    // what we want — so the cap only exists to be tuned, not to block.
    alwaysPlayMaximumHonor: number;
}

export const DYNASTY_EVENT_DEFAULTS: DynastyEventProfile = {
    honorBushiCardIds: [],
    honorBushiMinimumGlory: 1,
    rerollCardIds: [],
    rerollMaxUsefulProvinceCards: 1,
    rerollMinimumFate: 2,
    alwaysPlayCardIds: [],
    alwaysPlayMaximumHonor: Number.POSITIVE_INFINITY
};

export class DynastyEventTactics {
    constructor(public readonly profile: DynastyEventProfile) {}

    // Bushi by trait, plus any deck-specific ids the caller adds.
    isBushi(card: any, extraBushiIds: readonly string[] = []): boolean {
        return hasTrait(card, 'bushi') || (!!card?.id && extraBushiIds.includes(card.id));
    }

    // The shared dynasty pick used by decks that have no special rule of
    // their own: affordability first, then the caller's ranking.
    pick(input: {
        playable: any[];
        costs: Record<string, number>;
        fate: number;
        board: any[];
        ownProvinceCardCount: number;
        myHonor?: number;
        bushiCharacterIds?: readonly string[];
    }): { card: any; reason: string } | null {
        const affordable = (card: any) => numberOr(input.costs?.[card?.uuid], 0) <= numberOr(input.fate, 0);

        const honorBushi = (input.playable || []).find((card) =>
            this.profile.honorBushiCardIds.includes(String(card?.id || '')) && affordable(card));
        if(honorBushi && (input.board || []).some((card) => card?.new &&
            this.isBushi(card, input.bushiCharacterIds || []) && !card.isHonored &&
            gloryOf(card) >= this.profile.honorBushiMinimumGlory)) {
            return { card: honorBushi, reason: `play-dynasty-event-${honorBushi.id}` };
        }

        const reroll = (input.playable || []).find((card) =>
            this.profile.rerollCardIds.includes(String(card?.id || '')) && affordable(card));
        if(reroll && input.ownProvinceCardCount <= this.profile.rerollMaxUsefulProvinceCards &&
            numberOr(input.fate, 0) >= this.profile.rerollMinimumFate) {
            return { card: reroll, reason: `play-dynasty-event-${reroll.id}` };
        }

        const always = (input.playable || []).find((card) =>
            this.profile.alwaysPlayCardIds.includes(String(card?.id || '')) && affordable(card));
        if(always && numberOr(input.myHonor, 0) <= this.profile.alwaysPlayMaximumHonor) {
            return { card: always, reason: `play-dynasty-event-${always.id}` };
        }
        return null;
    }
}
