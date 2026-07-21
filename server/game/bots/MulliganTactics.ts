// Opening mulligan and end-of-fate dynasty refresh policy.
//
// Policy receives exact printed costs from JigokuBotController because normal
// player summaries intentionally omit costs. DeckProfile owns every tuning
// knob, keeping deck-specific search goals out of shared decision flow.

export type MulliganPolicyVariant = 'adaptive' | 'legacy';
export type MulliganBoardBand = 'weak' | 'developing' | 'strong';

export interface MulliganProfile {
    cheapCharacterMaxCost: number;
    strongCharacterMinCost: number;
    strongCharacterMaxCost: number;
    openingCharacterTarget: number;
    openingCheapTarget: number;
    openingStrongTarget: number;
    openingHoldingLimit: number;
    openingKeepHoldingIds: string[];
    openingKeepConflictIds: string[];
    openingPaidConflictKeepLimit: number;
    openingDiscardCharacterIds: string[];
    preferredCharacterIds: string[];
    rush: boolean;
    weakBoardMaxCharacters: number;
    strongBoardMinCharacters: number;
    strongBoardMinPersistentCharacters: number;
    endHoldingLimit: Record<MulliganBoardBand, number>;
    holdingCopyLimit: number;
    holdingCopyLimitById: Record<string, number>;
    keepHoldingIds: string[];
    keepDynastyCardIds: string[];
    discardCheapOnDevelopingBoard: boolean;
    discardCheapOnStrongBoard: boolean;
    tsumaProvinceId: string;
    honorProvinceCharacters: boolean;
    nextTurnFateReserve: number;
}

export const DEFAULT_MULLIGAN_PROFILE: MulliganProfile = {
    cheapCharacterMaxCost: 2,
    strongCharacterMinCost: 3,
    strongCharacterMaxCost: 5,
    openingCharacterTarget: 3,
    openingCheapTarget: 2,
    openingStrongTarget: 1,
    openingHoldingLimit: 1,
    openingKeepHoldingIds: ['the-imperial-palace'],
    openingKeepConflictIds: [],
    openingPaidConflictKeepLimit: 0,
    openingDiscardCharacterIds: [],
    preferredCharacterIds: [],
    rush: false,
    weakBoardMaxCharacters: 1,
    strongBoardMinCharacters: 3,
    strongBoardMinPersistentCharacters: 2,
    endHoldingLimit: { weak: 0, developing: 1, strong: 3 },
    holdingCopyLimit: 1,
    holdingCopyLimitById: {},
    keepHoldingIds: ['the-imperial-palace'],
    keepDynastyCardIds: [],
    discardCheapOnDevelopingBoard: true,
    discardCheapOnStrongBoard: true,
    tsumaProvinceId: 'tsuma',
    honorProvinceCharacters: false,
    nextTurnFateReserve: 0
};

export const RUSH_MULLIGAN_PROFILE: MulliganProfile = {
    ...DEFAULT_MULLIGAN_PROFILE,
    openingCharacterTarget: 4,
    openingCheapTarget: 4,
    openingStrongTarget: 1,
    openingHoldingLimit: 0,
    rush: true,
    endHoldingLimit: { weak: 0, developing: 1, strong: 1 },
    discardCheapOnDevelopingBoard: false,
    discardCheapOnStrongBoard: false
};

export interface MulliganInput {
    cards: any[];
    board: any[];
    currentFate: number;
    income: number;
    roundNumber: number;
    costsByUuid?: Record<string, number>;
    boardCostsByUuid?: Record<string, number>;
    provinceIdsByLocation?: Record<string, string>;
}

export interface MulliganPick {
    card?: any;
    reason: string;
    band?: MulliganBoardBand;
    projectedFate?: number;
}

class MulliganTactics {
    constructor(readonly profile: MulliganProfile = DEFAULT_MULLIGAN_PROFILE) {}

    pickOpeningDynasty(input: MulliganInput): MulliganPick {
        const cards = this.selectable(input.cards);
        const keep = this.openingDynastyKeepSet(cards, input);
        const card = cards.find((candidate) => !candidate.selected && !keep.has(String(candidate.uuid)));
        return {
            card,
            reason: card ? this.openingDiscardReason(card, input) : 'adaptive-finish-dynasty-mulligan',
            projectedFate: this.projectedFate(input)
        };
    }

    pickOpeningConflict(input: MulliganInput): MulliganPick {
        const cards = this.selectable(input.cards);
        const keep = new Set(cards
            .filter((candidate) => this.profile.openingKeepConflictIds.includes(candidate.id))
            .sort((left, right) =>
                this.profile.openingKeepConflictIds.indexOf(left.id) -
                    this.profile.openingKeepConflictIds.indexOf(right.id) ||
                this.costOf(left, input.costsByUuid) - this.costOf(right, input.costsByUuid) ||
                String(left.uuid).localeCompare(String(right.uuid)))
            .slice(0, this.profile.openingPaidConflictKeepLimit)
            .map((candidate) => String(candidate.uuid)));
        const card = cards.find((candidate) =>
            !candidate.selected && this.costOf(candidate, input.costsByUuid) > 0 &&
            !keep.has(String(candidate.uuid)));
        return {
            card,
            reason: card ? 'adaptive-mulligan-paid-conflict-card' : 'adaptive-finish-conflict-mulligan',
            projectedFate: this.projectedFate(input)
        };
    }

    pickDynastyDiscard(input: MulliganInput): MulliganPick {
        const cards = this.selectable(input.cards);
        const band = this.boardBand(input.board);
        const keep = this.endPhaseKeepSet(cards, input, band);
        const card = cards.find((candidate) => !candidate.selected && !keep.has(String(candidate.uuid)));
        return {
            card,
            reason: card ? `adaptive-discard-${band}-${String(card.type || 'dynasty')}` : 'adaptive-finish-dynasty-discard',
            band,
            projectedFate: this.projectedFate(input)
        };
    }

    // Tsuma characters enter play honored. This helper is shared by mulligan
    // and dynasty buying so seed 3 does not keep a Tsuma body then buy a weaker
    // copy from another province first.
    pickHonoredProvinceCharacter(
        cards: any[],
        fate: number,
        costsByUuid: Record<string, number>,
        provinceIdsByLocation?: Record<string, string>
    ): any | null {
        if(!this.profile.honorProvinceCharacters) {
            return null;
        }
        return cards
            .filter((card) => card?.type === 'character' && card.uuid &&
                this.isHonorProvinceCard(card, provinceIdsByLocation) &&
                this.costOf(card, costsByUuid) <= fate)
            .sort((left, right) =>
                this.characterScore(right, costsByUuid, provinceIdsByLocation, true) -
                    this.characterScore(left, costsByUuid, provinceIdsByLocation, true) ||
                String(left.uuid).localeCompare(String(right.uuid)))[0] || null;
    }

    boardBand(board: any[]): MulliganBoardBand {
        const characters = (board || []).filter((card) => card?.type === 'character');
        const persistent = characters.filter((card) => (Number(card?.fate) || 0) > 0).length;
        if(characters.length <= this.profile.weakBoardMaxCharacters) {
            return 'weak';
        }
        if(characters.length >= this.profile.strongBoardMinCharacters &&
            (persistent >= this.profile.strongBoardMinPersistentCharacters ||
                characters.length >= this.profile.strongBoardMinCharacters + 1)) {
            return 'strong';
        }
        return 'developing';
    }

    private openingDynastyKeepSet(cards: any[], input: MulliganInput): Set<string> {
        const keep = new Set<string>();
        const projectedFate = this.projectedFate(input);
        const characters = cards.filter((card) => card.type === 'character' &&
            !this.profile.openingDiscardCharacterIds.includes(card.id) &&
            this.costOf(card, input.costsByUuid) <= projectedFate);
        const ranked = characters.slice().sort((left, right) =>
            this.characterScore(right, input.costsByUuid, input.provinceIdsByLocation, true) -
                this.characterScore(left, input.costsByUuid, input.provinceIdsByLocation, true) ||
            String(left.uuid).localeCompare(String(right.uuid)));
        const cheap = ranked.filter((card) => this.costOf(card, input.costsByUuid) <= this.profile.cheapCharacterMaxCost);
        const strong = ranked.filter((card) => {
            const cost = this.costOf(card, input.costsByUuid);
            return cost >= this.profile.strongCharacterMinCost && cost <= this.profile.strongCharacterMaxCost;
        });

        const add = (list: any[], limit: number) => {
            for(const card of list) {
                if(keep.size >= this.profile.openingCharacterTarget || limit <= 0) {
                    break;
                }
                const key = String(card.uuid);
                if(!keep.has(key)) {
                    keep.add(key);
                    limit--;
                }
            }
        };

        if(this.profile.rush) {
            add(cheap, this.profile.openingCheapTarget);
            add(ranked, this.profile.openingCharacterTarget - keep.size);
        } else if(strong.length > 0) {
            add(strong, this.profile.openingStrongTarget);
            add(cheap, this.profile.openingCheapTarget);
            add(ranked.filter((card) => this.profile.preferredCharacterIds.includes(card.id)),
                this.profile.openingCharacterTarget - keep.size);
        } else {
            add(cheap, Math.max(this.profile.openingCheapTarget, this.profile.openingCharacterTarget));
            add(ranked, this.profile.openingCharacterTarget - keep.size);
        }

        const holdings = this.keepableHoldings(
            cards.filter((card) => card.type === 'holding'),
            this.profile.openingHoldingLimit
        );
        for(const holding of holdings) {
            keep.add(String(holding.uuid));
        }
        return keep;
    }

    private endPhaseKeepSet(cards: any[], input: MulliganInput, band: MulliganBoardBand): Set<string> {
        const keep = new Set<string>();
        const projectedFate = Math.max(0, this.projectedFate(input) - this.profile.nextTurnFateReserve);
        const holdingLimit = this.profile.endHoldingLimit[band];
        for(const holding of this.keepableHoldings(
            cards.filter((card) => card.type === 'holding'),
            holdingLimit
        )) {
            keep.add(String(holding.uuid));
        }

        for(const card of cards) {
            if(this.profile.keepDynastyCardIds.includes(card.id) && band !== 'weak') {
                keep.add(String(card.uuid));
            }
        }

        const characters = cards
            .filter((card) => card.type === 'character' && this.costOf(card, input.costsByUuid) <= projectedFate)
            .sort((left, right) =>
                this.characterScore(right, input.costsByUuid, input.provinceIdsByLocation, false) -
                    this.characterScore(left, input.costsByUuid, input.provinceIdsByLocation, false) ||
                String(left.uuid).localeCompare(String(right.uuid)));
        if(this.profile.rush || band === 'weak') {
            for(const card of characters) {
                keep.add(String(card.uuid));
            }
            return keep;
        }

        const desirable = characters.filter((card) => {
            if(this.isHonorProvinceCard(card, input.provinceIdsByLocation) ||
                this.profile.preferredCharacterIds.includes(card.id)) {
                return true;
            }
            const cost = this.costOf(card, input.costsByUuid);
            const discardCheap = band === 'strong'
                ? this.profile.discardCheapOnStrongBoard
                : this.profile.discardCheapOnDevelopingBoard;
            return !discardCheap || cost > this.profile.cheapCharacterMaxCost;
        });
        const target = band === 'strong' ? 1 : 2;
        for(const card of desirable.slice(0, target)) {
            keep.add(String(card.uuid));
        }
        // Never enter next dynasty phase with holdings only. Keep best
        // affordable fallback body even when it is cheap and normally churned.
        if(!characters.some((card) => keep.has(String(card.uuid))) && characters[0]) {
            keep.add(String(characters[0].uuid));
        }
        return keep;
    }

    private rankHoldings(cards: any[]): any[] {
        const priorityIds = [...new Set([
            ...this.profile.openingKeepHoldingIds,
            ...this.profile.keepHoldingIds
        ])];
        const priority = (id: string): number => {
            const index = priorityIds.indexOf(id);
            return index >= 0 ? priorityIds.length - index : 0;
        };
        return cards.slice().sort((left, right) =>
            priority(String(right.id || '')) - priority(String(left.id || '')) ||
            String(left.id || '').localeCompare(String(right.id || '')) ||
            String(left.uuid).localeCompare(String(right.uuid)));
    }

    private keepableHoldings(cards: any[], limit: number): any[] {
        const keep: any[] = [];
        const copies = new Map<string, number>();
        for(const holding of this.rankHoldings(cards)) {
            if(keep.length >= limit) {
                break;
            }
            const id = String(holding.id || '');
            const copyLimit = this.profile.holdingCopyLimitById[id] ?? this.profile.holdingCopyLimit;
            const count = copies.get(id) || 0;
            if(count < copyLimit) {
                keep.push(holding);
                copies.set(id, count + 1);
            }
        }
        return keep;
    }

    private characterScore(
        card: any,
        costsByUuid?: Record<string, number>,
        provinceIdsByLocation?: Record<string, string>,
        opening = false
    ): number {
        const preferredIndex = this.profile.preferredCharacterIds.indexOf(card.id);
        const preferred = preferredIndex >= 0 ? 200 - preferredIndex * 5 : 0;
        const honorProvince = this.isHonorProvinceCard(card, provinceIdsByLocation) ? 500 : 0;
        const cost = this.costOf(card, costsByUuid);
        const strong = cost >= this.profile.strongCharacterMinCost && cost <= this.profile.strongCharacterMaxCost ? 80 : 0;
        const cheap = cost <= this.profile.cheapCharacterMaxCost ? (this.profile.rush ? 100 - cost * 10 : 25 - cost) : 0;
        const openingPenalty = opening && this.profile.openingDiscardCharacterIds.includes(card.id) ? 1000 : 0;
        return honorProvince + preferred + strong + cheap + Math.min(cost, 6) - openingPenalty;
    }

    private isHonorProvinceCard(card: any, provinceIdsByLocation?: Record<string, string>): boolean {
        return this.profile.honorProvinceCharacters &&
            provinceIdsByLocation?.[String(card?.location || '')] === this.profile.tsumaProvinceId;
    }

    private openingDiscardReason(card: any, input: MulliganInput): string {
        if(this.profile.openingDiscardCharacterIds.includes(card.id)) {
            return 'adaptive-mulligan-opening-late-character';
        }
        if(card.type === 'holding') {
            return 'adaptive-mulligan-opening-holding';
        }
        if(card.type !== 'character') {
            return 'adaptive-mulligan-opening-noncharacter';
        }
        if(this.costOf(card, input.costsByUuid) > this.projectedFate(input)) {
            return 'adaptive-mulligan-unaffordable-character';
        }
        return 'adaptive-mulligan-character-plan';
    }

    private projectedFate(input: MulliganInput): number {
        return Math.max(0, Number(input.currentFate) || 0) + Math.max(0, Number(input.income) || 0);
    }

    private selectable(cards: any[]): any[] {
        // Prompt summaries may contain every visible card. Only cards explicitly
        // exposed as legal choices belong to this prompt; this also excludes
        // broken-province cards that Jigoku will discard automatically.
        return (cards || []).filter((card) => card?.uuid && card.selectable === true);
    }

    private costOf(card: any, costsByUuid?: Record<string, number>): number {
        const raw = card?.uuid ? costsByUuid?.[card.uuid] : undefined;
        const value = Number(raw ?? card?.printedCost ?? card?.cost);
        return Number.isFinite(value) ? Math.max(0, value) : Number.POSITIVE_INFINITY;
    }
}

export default MulliganTactics;
