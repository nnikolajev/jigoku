// Spell/ring-control playstyle for Phoenix "Shugenja Spells"
// (EmeraldDB b260d778-0016-4d70-b1f9-5180daf340fc).
//
// The deck is identified by Kyuden Isawa. It deliberately trades undefended
// provinces through Display of Power, recasts high-impact spells from the
// conflict discard, steers Water/Air/Void rings to its character payoffs, and
// uses ready/boost effects on its practical towers (large printed bodies rather
// than attachment stacks).

export interface ShugenjaProfile {
    ringCardBonus: number;
    preConflictMinFate: number;
    towerIds: string[];
    shugenjaIds: string[];
    waterIds: string[];
    airIds: string[];
    voidIds: string[];
    disguiseTargets: Record<string, number>;
    spellPriority: string[];
    protectedDiscardIds: string[];
}

const KYUDEN_SPELL_IDS = new Set([
    'against-the-waves', 'clarity-of-purpose', 'consumed-by-five-fires',
    'display-of-power', 'earth-becomes-sky', 'oracle-of-stone', 'supernatural-storm'
]);

const KYUDEN_ACTION_COSTS: Record<string, number> = {
    'against-the-waves': 1,
    'clarity-of-purpose': 1,
    'consumed-by-five-fires': 5,
    'oracle-of-stone': 0,
    'supernatural-storm': 0
};

// Card summaries intentionally omit printed cost. These values keep Oracle,
// Kyuden's discard cost, Tadaka, and forced Ujina fallbacks deterministic and
// genuinely weakest-first instead of UUID-first.
const PRINTED_COSTS: Record<string, number> = {
    'adept-of-the-waves': 2,
    'against-the-waves': 1,
    'assassination': 0,
    'asako-togama': 4,
    'asako-tsuki': 2,
    'banzai': 0,
    'clarity-of-purpose': 1,
    'consumed-by-five-fires': 5,
    'display-of-power': 2,
    'earth-becomes-sky': 1,
    'ethereal-dreamer': 1,
    'feral-ningyo': 3,
    'fushicho': 6,
    'isawa-tadaka-2': 5,
    'isawa-ujina': 4,
    'kirei-ko': 1,
    'kudaka': 4,
    'meddling-mediator': 2,
    'oracle-of-stone': 0,
    'pacifism': 2,
    'prodigy-of-the-waves': 4,
    'shiba-tetsu': 2,
    'shiba-tsukune': 5,
    'shiba-yojimbo': 3,
    'shrine-maiden': 1,
    'stolen-breath': 2,
    'supernatural-storm': 0,
    'the-path-of-man': 0,
    'young-philosopher': 2
};

export const SHUGENJA_DEFAULTS: ShugenjaProfile = {
    ringCardBonus: 18,
    preConflictMinFate: 2,
    towerIds: ['isawa-tadaka-2', 'fushicho', 'shiba-tsukune', 'kudaka'],
    shugenjaIds: [
        'adept-of-the-waves', 'asako-tsuki', 'ethereal-dreamer', 'isawa-tadaka-2',
        'isawa-ujina', 'kudaka', 'prodigy-of-the-waves', 'young-philosopher'
    ],
    waterIds: ['adept-of-the-waves', 'asako-tsuki', 'ethereal-dreamer', 'feral-ningyo', 'prodigy-of-the-waves'],
    airIds: ['kudaka'],
    voidIds: ['isawa-ujina'],
    // Printed cost of legal non-unique Shugenja disguise bases. The engine
    // performs the real trait/unique legality check; this ranking chooses the
    // best reduction and preserves fate/attachments on a bowed participant.
    disguiseTargets: {
        'prodigy-of-the-waves': 4,
        'adept-of-the-waves': 2,
        'young-philosopher': 2,
        'ethereal-dreamer': 1
    },
    spellPriority: [
        'display-of-power', 'consumed-by-five-fires', 'earth-becomes-sky',
        'clarity-of-purpose', 'against-the-waves', 'the-path-of-man',
        'supernatural-storm', 'oracle-of-stone', 'assassination', 'banzai'
    ],
    // Kyuden Isawa must discard a spell from hand as its cost. Keep the two
    // build-arounds and the fate payoff when a lower-value spell is available.
    protectedDiscardIds: ['display-of-power', 'consumed-by-five-fires', 'the-path-of-man', 'isawa-tadaka-2']
};

export class ShugenjaTactics {
    private profile: ShugenjaProfile;

    constructor(profile: ShugenjaProfile) {
        this.profile = profile;
    }

    ringBonus(element: string, myCharacters: any[], hand: any[]): number {
        const wanted = element === 'water' ? this.profile.waterIds
            : element === 'air' ? this.profile.airIds
                : element === 'void' ? this.profile.voidIds
                    : [];
        const inPlay = (myCharacters || []).filter((card) => card.id && wanted.includes(card.id)).length;
        // Feral Ningyo is specifically a hand payoff for Water; counting all
        // wanted ids in hand also lets a soon-to-be-played payoff steer the ring.
        const inHand = (hand || []).filter((card) => card.id && wanted.includes(card.id)).length;
        return (inPlay + inHand) * this.profile.ringCardBonus;
    }

    offeringsRingScore(element: string, myCharacters: any[], opponentCharacters: any[]): number {
        const wanted = element === 'water' ? this.profile.waterIds
            : element === 'air' ? this.profile.airIds
                : element === 'void' ? this.profile.voidIds
                    : [];
        // Offerings resolves immediately, so only live characters matter. One
        // matching payoff outweighs the generic ring order. Water also needs a
        // legal useful board target: a bowed own character to ready or a ready
        // zero-fate enemy to bow. Thus lone ready Kudaka chooses Air, while a
        // live Water payoff or usable second character can move Water ahead.
        const livePayoffs = (myCharacters || []).filter((card) => card.id && wanted.includes(card.id)).length;
        const enemyHasFate = (opponentCharacters || []).some((card) => (Number(card.fate) || 0) > 0);
        const usableWaterTarget = (myCharacters || []).some((card) => card.bowed) ||
            (opponentCharacters || []).some((card) => !card.bowed && (Number(card.fate) || 0) === 0);
        const waterRelevant = element === 'water' && (livePayoffs > 0 || usableWaterTarget);
        const fallback = enemyHasFate
            ? { water: waterRelevant ? 50 : 0, void: 40, earth: 30, air: 20, fire: 10 }
            : { water: waterRelevant ? 50 : 0, earth: 40, air: 30, fire: 20, void: 10 };
        const waterEffectValue = element === 'water' && usableWaterTarget ? 100 : 0;
        return livePayoffs * 100 + waterEffectValue + (fallback[element] ?? 0);
    }

    isShugenja(card: any): boolean {
        return !!card?.id && this.profile.shugenjaIds.includes(card.id);
    }

    isPracticalTower(card: any): boolean {
        return !!card?.id && this.profile.towerIds.includes(card.id);
    }

    pickTower(cards: any[], skillOf: (card: any) => number): any {
        if(!cards || cards.length === 0) {
            return null;
        }
        return cards.slice().sort((a, b) => {
            const towerDiff = (this.isPracticalTower(b) ? 1 : 0) - (this.isPracticalTower(a) ? 1 : 0);
            if(towerDiff !== 0) {
                return towerDiff;
            }
            const participantDiff = (b.inConflict ? 1 : 0) - (a.inConflict ? 1 : 0);
            if(participantDiff !== 0) {
                return participantDiff;
            }
            const fateDiff = (Number(b.fate) || 0) - (Number(a.fate) || 0);
            if(fateDiff !== 0) {
                return fateDiff;
            }
            const skillDiff = skillOf(b) - skillOf(a);
            return skillDiff !== 0 ? skillDiff : String(a.uuid || '').localeCompare(String(b.uuid || ''));
        })[0];
    }

    pickDisguiseTarget(cards: any[], availableFate = Number.POSITIVE_INFINITY): any {
        const candidates = (cards || []).filter((card) =>
            card.id && this.profile.disguiseTargets[card.id] !== undefined &&
            availableFate >= Math.max(5 - this.profile.disguiseTargets[card.id], 0));
        if(candidates.length === 0) {
            return null;
        }
        return candidates.slice().sort((a, b) => {
            // Fate, attachments, and tokens all move to Tadaka. Preserve the
            // biggest long-term investment first; immediate ready value from a
            // bowed/participating base is only a tie-breaker. Prefer the cheaper
            // body when two bases carry the same investment.
            const fateDiff = (Number(b.fate) || 0) - (Number(a.fate) || 0);
            if(fateDiff !== 0) {
                return fateDiff;
            }
            const attachmentDiff = (b.attachments?.length || 0) - (a.attachments?.length || 0);
            if(attachmentDiff !== 0) {
                return attachmentDiff;
            }
            const tokenCount = (card: any) => Array.isArray(card.statusTokens)
                ? card.statusTokens.length
                : Object.values(card.tokens || {}).reduce((sum: number, amount: any) => sum + (Number(amount) || 0), 0);
            const tokenDiff = tokenCount(b) - tokenCount(a);
            if(tokenDiff !== 0) {
                return tokenDiff;
            }
            const costDiff = this.profile.disguiseTargets[a.id] - this.profile.disguiseTargets[b.id];
            if(costDiff !== 0) {
                return costDiff;
            }
            const bowedDiff = (b.bowed ? 1 : 0) - (a.bowed ? 1 : 0);
            if(bowedDiff !== 0) {
                return bowedDiff;
            }
            const participantDiff = (b.inConflict ? 1 : 0) - (a.inConflict ? 1 : 0);
            if(participantDiff !== 0) {
                return participantDiff;
            }
            return String(a.uuid || '').localeCompare(String(b.uuid || ''));
        })[0];
    }

    pickTadakaPlay(hand: any[], myCharacters: any[], availableFate: number): any {
        const tadaka = (hand || []).find((card) =>
            card.id === 'isawa-tadaka-2' && card.uuid && card.isPlayableByMe);
        if(!tadaka || (myCharacters || []).some((card) => card.id === 'isawa-tadaka-2')) {
            return null;
        }
        const affordableBases = (myCharacters || []).filter((card) =>
            card.id && this.profile.disguiseTargets[card.id] !== undefined &&
            availableFate >= Math.max(5 - this.profile.disguiseTargets[card.id], 0));
        const base = this.pickDisguiseTarget(affordableBases, availableFate);
        // Proactively turn a prepared two-fate body into the durable Tadaka
        // tower. Ordinary conflict evaluation may still play him without this
        // setup when his printed skill is needed immediately.
        return base && (Number(base.fate) || 0) >= 2 ? tadaka : null;
    }

    pickTadakaSetupCharacter(cards: any[], hand: any[], dynastyCosts: Record<string, number>, availableFate: number): any {
        if(!(hand || []).some((card) => card.id === 'isawa-tadaka-2')) {
            return null;
        }
        const candidates = (cards || []).filter((card) => {
            if(!card.id || this.profile.disguiseTargets[card.id] === undefined) {
                return false;
            }
            const cost = dynastyCosts?.[card.uuid] ?? this.profile.disguiseTargets[card.id];
            const tadakaCost = Math.max(5 - this.profile.disguiseTargets[card.id], 0);
            return availableFate >= cost + 2 + tadakaCost;
        });
        return candidates.slice().sort((a, b) =>
            (dynastyCosts?.[a.uuid] ?? this.profile.disguiseTargets[a.id]) -
            (dynastyCosts?.[b.uuid] ?? this.profile.disguiseTargets[b.id]) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    pickFushichoTarget(cards: any[]): any {
        const fiveCostCharacters = (cards || []).filter((card) =>
            card.type === 'character' && this.printedCostOf(card) === 5);
        if(fiveCostCharacters.length === 0) {
            return null;
        }
        return fiveCostCharacters.slice().sort((a, b) =>
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0];
    }

    shouldPlayFushicho(dynastyDiscard: any[]): boolean {
        return !!this.pickFushichoTarget(dynastyDiscard);
    }

    isFiveFiresNeutralized(card: any): boolean {
        return (card?.attachments || []).some((attachment: any) =>
            attachment.id === 'pacifism' || attachment.id === 'stolen-breath');
    }

    fiveFiresTargets(cards: any[]): any[] {
        return (cards || []).filter((card) =>
            card.type === 'character' && (Number(card.fate) || 0) > 0 && !this.isFiveFiresNeutralized(card));
    }

    fiveFiresTargetFate(cards: any[]): number {
        return this.fiveFiresTargets(cards)
            .reduce((total, card) => total + (Number(card.fate) || 0), 0);
    }

    pickFiveFiresTarget(cards: any[], skillOf: (card: any) => number = () => 0): any {
        return this.fiveFiresTargets(cards).slice().sort((a, b) =>
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            skillOf(b) - skillOf(a) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    pickFiveFiresPlay(hand: any[], myCharacters: any[], opponentCharacters: any[], availableFate: number): any {
        if(availableFate < 5 ||
            !(myCharacters || []).some((card) => this.profile.shugenjaIds.includes(card.id)) ||
            this.fiveFiresTargetFate(opponentCharacters) < 5) {
            return null;
        }
        return (hand || []).find((card) =>
            card.id === 'consumed-by-five-fires' && card.uuid && card.isPlayableByMe) || null;
    }

    pickWeakest(cards: any[]): any {
        if(!cards || cards.length === 0) {
            return null;
        }
        return cards.slice().sort((a, b) => {
            const costDiff = this.printedCostOf(a) - this.printedCostOf(b);
            if(costDiff !== 0) {
                return costDiff;
            }
            const fateDiff = (Number(a.fate) || 0) - (Number(b.fate) || 0);
            return fateDiff !== 0 ? fateDiff : String(a.uuid || '').localeCompare(String(b.uuid || ''));
        })[0];
    }

    private printedCostOf(card: any): number {
        return card?.cost === undefined || card?.cost === null
            ? (PRINTED_COSTS[card?.id] ?? 0)
            : (Number(card.cost) || 0);
    }

    pickSpell(cards: any[]): any {
        if(!cards || cards.length === 0) {
            return null;
        }
        const rank = (card: any) => {
            const index = this.profile.spellPriority.indexOf(card.id);
            return index < 0 ? this.profile.spellPriority.length : index;
        };
        return cards.slice().sort((a, b) => rank(a) - rank(b) ||
            (Number(b.cost) || 0) - (Number(a.cost) || 0) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0];
    }

    pickKyudenSpell(cards: any[], playCtx: any): any {
        return this.pickSpell((cards || []).filter((card) => this.canRecastWithKyuden(card, playCtx)));
    }

    pickKyudenDiscard(cards: any[]): any {
        const unprotected = (cards || []).filter((card) => !this.profile.protectedDiscardIds.includes(card.id));
        return this.pickWeakest(unprotected.length > 0 ? unprotected : cards);
    }

    hasDisplayPlan(me: any): boolean {
        const fate = Number(me?.stats?.fate) || 0;
        if(fate < 2) {
            return false;
        }
        const hand = me?.cardPiles?.hand || [];
        // Display is a Reaction. Kyuden is an Action, so the rules engine
        // cannot use Kyuden to recast Display during the after-conflict window.
        return hand.some((card: any) => card.id === 'display-of-power');
    }

    hasStrategicAction(me: any, opponent: any): boolean {
        const fate = Number(me?.stats?.fate) || 0;
        const hand = me?.cardPiles?.hand || [];
        const conflictDiscard = me?.cardPiles?.conflictDiscardPile || [];
        const mine = me?.cardPiles?.cardsInPlay || [];
        const theirs = opponent?.cardPiles?.cardsInPlay || [];
        if(this.pickFiveFiresPlay(hand, mine, theirs, fate)) {
            return true;
        }
        const readyKyuden = (me?.strongholdProvince || []).some((card: any) => card.id === 'kyuden-isawa' && !card.bowed);
        if(readyKyuden && this.shouldUseKyuden({
            hand,
            conflictDiscard,
            fate,
            myCharacters: mine,
            opponentCharacters: theirs
        })) {
            return true;
        }
        return (me?.cardPiles?.cardsInPlay || []).some((card: any) =>
            card.id === 'meddling-mediator' || card.id === 'asako-togama');
    }

    shouldUseKyuden(playCtx: any): boolean {
        const hand = playCtx?.hand || [];
        const discard = playCtx?.conflictDiscard || [];
        // Public bot state deliberately omits printed traits/costs, so identify
        // this deck's Spell events by stable card id.
        if(!hand.some((card: any) => card.type === 'event' && KYUDEN_SPELL_IDS.has(card.id))) {
            return false;
        }
        return !!this.pickKyudenSpell(discard, playCtx);
    }

    private canRecastWithKyuden(card: any, playCtx: any): boolean {
        if(!card || card.type !== 'event' || KYUDEN_ACTION_COSTS[card.id] === undefined) {
            return false;
        }
        const fate = Number(playCtx?.fate) || 0;
        if(fate < KYUDEN_ACTION_COSTS[card.id]) {
            return false;
        }
        const mine = playCtx?.myCharacters || [];
        const theirs = playCtx?.opponentCharacters || [];
        switch(card.id) {
            case 'consumed-by-five-fires':
                return mine.some((character: any) => this.profile.shugenjaIds.includes(character.id)) &&
                    this.fiveFiresTargetFate(theirs) >= 5;
            case 'against-the-waves':
                return mine.some((character: any) => character.bowed && this.profile.shugenjaIds.includes(character.id));
            case 'supernatural-storm':
                return mine.some((character: any) => this.profile.shugenjaIds.includes(character.id)) &&
                    mine.some((character: any) => character.inConflict);
            case 'clarity-of-purpose':
                return mine.length > 0;
            case 'oracle-of-stone':
                return true;
            default:
                return false;
        }
    }

    canPlayPreConflict(myFate: number): boolean {
        return myFate >= this.profile.preConflictMinFate;
    }

    desiredFateReserve(me: any, opponent: any): number {
        const mine = me?.cardPiles?.cardsInPlay || [];
        const hasTarget = this.fiveFiresTargetFate(opponent?.cardPiles?.cardsInPlay || []) >= 5;
        if(!hasTarget || !mine.some((card: any) => this.profile.shugenjaIds.includes(card.id))) {
            return 1;
        }
        const hand = me?.cardPiles?.hand || [];
        if(hand.some((card: any) => card.id === 'consumed-by-five-fires')) {
            return 5;
        }
        const discardHasFires = (me?.cardPiles?.conflictDiscardPile || [])
            .some((card: any) => card.id === 'consumed-by-five-fires');
        const readyKyuden = (me?.strongholdProvince || [])
            .some((card: any) => card.id === 'kyuden-isawa' && !card.bowed);
        const hasSpellCost = hand.some((card: any) => card.type === 'event' && KYUDEN_SPELL_IDS.has(card.id));
        return discardHasFires && readyKyuden && hasSpellCost ? 5 : 1;
    }

    desiredAdditionalFate(cardId: string | undefined, hand: any[], availableFate: number, playCost?: number): number | null {
        if(!cardId || this.profile.disguiseTargets[cardId] === undefined ||
            !(hand || []).some((card) => card.id === 'isawa-tadaka-2')) {
            return null;
        }
        // Keep the five-minus-base-cost needed to disguise Tadaka later. When
        // rich, bank three fate on the base; otherwise two, never below zero.
        const tadakaCost = Math.max(5 - this.profile.disguiseTargets[cardId], 1);
        const remainingAfterBase = availableFate - (playCost || 0) - tadakaCost;
        return remainingAfterBase >= 3 ? 3 : remainingAfterBase >= 2 ? 2 : Math.max(remainingAfterBase, 0);
    }
}
