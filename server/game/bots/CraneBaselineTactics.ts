import type { KnownCard } from './DeckAnalysis';

// Injectable policy for the mixed Crane baseline.  The deck is duel-centric,
// but these choices are not generic duel rules: Gossip needs public deck-list
// knowledge, Court Games builds the honor/Noble-Sacrifice engine, and several
// characters reward deliberately solo or sequenced conflicts.
export interface CraneBaselineProfile {
    markerCards: string[];
    gossipImportance: Record<string, number>;
    gossipTagWeights: Record<string, number>;
    gossipMinimumScore: number;
    soloScoutId: string;
    soloHonorId: string;
    // From round three onward, never let the duel tower/support caps call a
    // two-body board "complete". The mixed Crane list needs one replacement
    // entering as older zero-fate duelists leave play.
    boardFloorRound: number;
    boardCharacterFloor: number;
    dynastyFateReserve: number;
}

export const CRANE_BASELINE_DEFAULTS: CraneBaselineProfile = {
    markerCards: ['gossip', 'kakita-yoshi-2', 'noble-sacrifice'],
    // Build-around cards for every currently supported opponent archetype.
    // These are only WEIGHTS: pickGossipCard first filters to cards actually
    // present in the opponent's conflict deck, so an absent name is impossible.
    gossipImportance: {
        'a-fate-worse-than-death': 18,
        'cavalry-reserves': 18,
        // Especially punishing to this deck's fate-loaded duelists.
        'consumed-by-five-fires': 22,
        'display-of-power': 17,
        'for-greater-glory': 17,
        'void-fist': 17,
        'tetsubo-of-blood': 17,
        'the-mountain-does-not-fall': 17,
        'two-heavens-technique': 17,
        'noble-sacrifice': 16,
        'voice-of-honor': 16,
        'defend-your-honor': 15,
        'clarity-of-purpose': 15,
        'against-the-waves': 15,
        'raise-the-alarm': 15,
        'flank-the-enemy': 15,
        'compelling-testimony': 15,
        'supernatural-storm': 14,
        'ujiaki-s-offer': 14,
        'feeding-an-army': 14,
        'duel-to-the-death': 14,
        'storied-defeat': 14,
        'banzai': 13,
        'pacifism': 13,
        'stolen-breath': 13,
        'softskin': 13,
        'pit-trap': 13,
        'captive-audience': 13,
        'i-am-ready': 13,
        'let-go': 12,
        'way-of-the-dragon': 12,
        'right-hand-of-the-emperor': 12,
        'watch-commander': 12,
        'jade-tetsubo': 12,
        'rebuild': 12,
        'policy-debate': 12,
        'spyglass': 11,
        'ride-on': 11,
        'censure': 11,
        'forgery': 11
    },
    gossipTagWeights: {
        control: 10,
        ready: 9,
        pump: 7,
        debuff: 8,
        body: 6,
        utility: 3
    },
    gossipMinimumScore: 8,
    soloScoutId: 'cautious-scout',
    soloHonorId: 'brash-samurai',
    boardFloorRound: 3,
    boardCharacterFloor: 3,
    dynastyFateReserve: 1
};

export interface GossipChoiceContext {
    opponentDeck: KnownCard[];
    opponentHand?: KnownCard[];
    opponentFate?: number;
    omniscient: boolean;
    conflictType?: 'military' | 'political';
}

export class CraneBaselineTactics {
    constructor(private profile: CraneBaselineProfile) {}

    isBaselineDeck(cardIds: Set<string>): boolean {
        return this.profile.markerCards.every((id) => cardIds.has(id));
    }

    // Both players know the submitted deck list in L5R. Group printed copies
    // from that public list and score only those actual conflict cards. Seed 5
    // then adds its legal information advantage: exact hand, affordability,
    // and current conflict relevance. Fair seeds never inspect the hand.
    pickGossipCard(context: GossipChoiceContext): KnownCard | null {
        const groups = new Map<string, { card: KnownCard; copies: number; handCopies: number }>();
        for(const card of context.opponentDeck.filter((candidate) => candidate.side === 'conflict')) {
            const current = groups.get(card.id) || { card, copies: 0, handCopies: 0 };
            current.copies++;
            groups.set(card.id, current);
        }
        if(context.omniscient) {
            for(const card of context.opponentHand || []) {
                const current = groups.get(card.id);
                if(current) {
                    current.handCopies++;
                }
            }
        }

        const score = (group: { card: KnownCard; copies: number; handCopies: number }): number => {
            const card = group.card;
            let value = this.profile.gossipImportance[card.id] || 0;
            value += this.profile.gossipTagWeights[card.tag] || 0;
            value += Math.max(0, Number(card.swing) || 0);
            value += Math.min(group.copies, 3) * 2;
            if(card.canDisableDefender) {
                value += 5;
            }
            if(context.conflictType && card.conflictTypes?.length && !card.conflictTypes.includes(context.conflictType)) {
                value -= 4;
            }
            if(context.omniscient) {
                value += group.handCopies * 24;
                if(group.handCopies > 0) {
                    value += (Number(card.fate) || 0) <= (context.opponentFate || 0) ? 12 : -8;
                }
            }
            return value;
        };

        const ranked = Array.from(groups.values()).sort((left, right) =>
            score(right) - score(left) ||
            right.copies - left.copies ||
            left.card.id.localeCompare(right.card.id));
        const best = ranked[0];
        return best && score(best) >= this.profile.gossipMinimumScore ? best.card : null;
    }

    pickSoloAttacker(candidates: any[], facedownProvince: boolean): any | null {
        const ready = candidates.filter((card) => !card.bowed);
        if(facedownProvince) {
            const scout = ready.find((card) => card.id === this.profile.soloScoutId);
            if(scout) {
                return scout;
            }
        }
        return ready.find((card) => card.id === this.profile.soloHonorId && !card.isHonored) || null;
    }

    // This runs before the shared DuelTactics buyer. It is intentionally
    // narrow: only repair an undersized late board, then hand control back to
    // the normal tower/support caps. Prefer the best persistent Crane body,
    // but require enough printed-cost fate to retain a conflict-card reserve.
    pickBoardFloorCharacter(
        playable: any[],
        costs: Record<string, number>,
        fate: number,
        board: any[],
        round: number,
        isDurable: (cardId: string | undefined) => boolean
    ): any | null {
        if(round < this.profile.boardFloorRound || board.length >= this.profile.boardCharacterFloor) {
            return null;
        }
        const affordable = playable.filter((card) => card.type === 'character' &&
            (costs[card.uuid] ?? 0) <= fate - this.profile.dynastyFateReserve);
        return affordable.sort((a, b) =>
            (isDurable(b.id) ? 1 : 0) - (isDurable(a.id) ? 1 : 0) ||
            (costs[b.uuid] ?? 0) - (costs[a.uuid] ?? 0) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    desiredDynastyFateReserve(round: number): number {
        // Do not underfund the opening five-cost champion: seven starting fate
        // should become cost 5 + 2 fate, matching the deck's persistence plan.
        return round >= this.profile.boardFloorRound ? this.profile.dynastyFateReserve : 0;
    }

    shouldUseBrashSamurai(ctx: any): boolean {
        const mine = (ctx.myCharacters || []).filter((card: any) => card.inConflict);
        return mine.length === 1 && mine[0].id === this.profile.soloHonorId && !mine[0].isHonored;
    }

    shouldUseDojiChallenger(ctx: any): boolean {
        if(!ctx.amAttacker || (ctx.conflictsRemaining || 0) < 1) {
            return false;
        }
        const challenger = (ctx.myCharacters || []).some((card: any) =>
            card.id === 'doji-challenger' && card.inConflict && !card.bowed);
        const futureThreat = (ctx.opponentCharacters || []).some((card: any) => !card.bowed && !card.inConflict);
        // Do not worsen a close attack. Use the pull while already breaking or
        // comfortably ahead, so that target cannot defend the next conflict.
        return challenger && futureThreat && !ctx.losing && (ctx.strengthNeeded ?? 0) <= 0;
    }

    shouldSwitchConflictType(ctx: any): boolean {
        const own = (ctx.myCharacters || []).filter((card: any) => card.inConflict);
        const enemy = (ctx.opponentCharacters || []).filter((card: any) => card.inConflict);
        if(!own.some((card: any) => card.id === 'doji-kuwanan') ||
            (ctx.conflictType !== 'military' && ctx.conflictType !== 'political')) {
            return false;
        }
        const skill = (card: any, axis: 'military' | 'political') => {
            const summary = axis === 'military' ? card.militarySkillSummary : card.politicalSkillSummary;
            const raw = summary?.total ?? summary?.stat ?? card[axis];
            return Math.max(0, Number(raw) || 0);
        };
        const margin = (axis: 'military' | 'political') =>
            own.reduce((sum: number, card: any) => sum + skill(card, axis), 0) -
            enemy.reduce((sum: number, card: any) => sum + skill(card, axis), 0);
        const other = ctx.conflictType === 'military' ? 'political' : 'military';
        return margin(other) > margin(ctx.conflictType);
    }

    shouldHonorWithCourtGames(ctx: any, gloryOf: (card: any) => number = (card) =>
        Math.max(0, Number(card?.glorySummary?.stat ?? card?.glory) || 0)): boolean {
        const own = (ctx.myCharacters || []).filter((card: any) => card.inConflict && !card.isHonored);
        const enemy = (ctx.opponentCharacters || []).filter((card: any) => card.inConflict && !card.isDishonored);
        const ownBest = own.sort((a: any, b: any) => gloryOf(b) - gloryOf(a))[0];
        const enemyBest = enemy.sort((a: any, b: any) => gloryOf(b) - gloryOf(a))[0];
        const savvyBonus = ownBest?.id === 'savvy-politician' ? 2 : 0;
        const nobleSetup = (ctx.hand || []).some((card: any) => card.id === 'noble-sacrifice') ? 2 : 0;
        return !!ownBest && (!enemyBest || gloryOf(ownBest) + savvyBonus + nobleSetup >= gloryOf(enemyBest));
    }

    pickHonorChainTarget(cards: any[], gloryOf: (card: any) => number = (card) =>
        Math.max(0, Number(card?.glorySummary?.stat ?? card?.glory) || 0)): any | null {
        return cards.filter((card) => !card.isHonored).sort((a, b) =>
            gloryOf(b) - gloryOf(a) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }
}
