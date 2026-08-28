import { BotTelemetry } from './BotTelemetry';

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
    // Printed ids to ALWAYS discard in the fate phase, whatever the keep rules
    // decide. Some cards are worth more in the dynasty discard pile than in a
    // province: Keeper Initiate's reaction puts it into play from the discard
    // WITH a free fate every time we claim a matching ring, and a copy sitting
    // face-up in a province just blocks that province instead. Empty for every
    // other deck, so this is inert unless a profile opts in.
    endPhaseDiscardCardIds: string[];
    // Printed province ids that refill to MORE than one card.
    //
    // `Player.replaceDynastyCard` refuses to refill a province that still holds
    // ANY dynasty card (`getSourceList(location).size() > 1`, and the list
    // carries the province card itself). Every other province holds one card,
    // so buying or discarding it always empties the province and the refill
    // follows. City of the Rich Frog holds THREE, which makes it
    // all-or-nothing: leaving one card behind caps the province at that one
    // card for the rest of the game instead of the three it prints.
    //
    // So the end-phase decision there is not per card, it is per PROVINCE:
    // either the contents are worth more than a fresh three, and nothing is
    // discarded, or the whole province is emptied -- holdings included -- so
    // the fate phase refills it. Keyed on the CARD, so it is inert for a deck
    // that does not play one; set it to `[]` to restore pre-2026-08-28
    // behaviour as an A/B arm.
    refillProvinceIds: string[];
    // How many of the deck's priority characters have to be sitting on such a
    // province for its contents to beat a fresh refill.
    refillProvinceMinPriorityCharacters: number;
    // Priority list for that test, and the ONLY source for it -- deliberately
    // NOT `preferredCharacterIds`. That list is the opening-mulligan and
    // end-phase character RANKING and runs 4-9 ids deep, which is most of a
    // deck's curve; a province is worth holding only for the two or three cards
    // the deck actually wants to hit. Empty means nothing qualifies, so the
    // province is emptied every fate phase -- the right default for a deck that
    // just wants three fresh cards, and the `off` arm for one that does not.
    refillProvincePriorityCharacterIds: string[];
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
    endPhaseDiscardCardIds: [],
    refillProvinceIds: ['city-of-the-rich-frog'],
    refillProvinceMinPriorityCharacters: 2,
    refillProvincePriorityCharacterIds: [],
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

interface MulliganInput {
    cards: any[];
    // The ENGINE's view of the bot's own provinces, keyed by location. Supplied
    // by `JigokuBotController`; `refillProvincePlan` reads nothing else.
    provinceRefill?: Record<string, RefillProvinceState>;
    // Seat name, for telemetry only. `BotTelemetry` is a global static sink
    // shared by both controllers, and six decks in the field hold City of the
    // Rich Frog -- without this an analysis script counts both bots' decisions
    // in every pairing where the opponent also plays one.
    playerName?: string;
    board: any[];
    currentFate: number;
    income: number;
    roundNumber: number;
    costsByUuid?: Record<string, number>;
    boardCostsByUuid?: Record<string, number>;
    provinceIdsByLocation?: Record<string, string>;
}

interface MulliganPick {
    card?: any;
    reason: string;
    band?: MulliganBoardBand;
    projectedFate?: number;
}

/**
 * One of the bot's own provinces, as the ENGINE sees it.
 *
 * Three of these four fields are invisible to a policy reading the serialized
 * board, which is why the controller has to supply them:
 *   * `refillTo`   -- `Player.replaceDynastyCard` reads it from a persistent
 *                     EFFECT (`EffectNames.RefillProvinceTo`) on the province.
 *                     A BROKEN province is blank (`ProvinceCard.isBlank`), so
 *                     it loses its own effect and silently drops back to 1 --
 *                     a broken City of the Rich Frog is a one-card province for
 *                     the rest of the game, and no card id can say that.
 *   * `facedownCards` -- a facedown dynasty card publishes no id and no type.
 *                     It also cannot be discarded in the fate phase, so its
 *                     presence makes the refill UNREACHABLE this round.
 *   * `broken`     -- reported for the same reason, and kept separate from
 *                     `refillTo` so a rule can say which fact it used.
 */
export interface RefillProvinceState {
    provinceId: string;
    broken: boolean;
    /** How many cards `replaceDynastyCard` would put back. 1 for a plain province. */
    refillTo: number;
    /** Faceup dynasty cards -- the ones the fate phase offers for discard. */
    faceupCards: Array<{ uuid: string; id: string; type: string }>;
    /** Count of facedown dynasty cards; these cannot be discarded here. */
    facedownCards: number;
}

/** One all-or-nothing refill province, settled for this fate phase. */
export interface RefillProvinceDecision {
    location: string;
    provinceId: string;
    /** true = discard nothing here; false = empty it so the fate phase refills. */
    keep: boolean;
    priorityCount: number;
    cardIds: string[];
    uuids: string[];
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
        const refillProvinces = this.refillProvincePlan(input);
        const keep = this.endPhaseKeepSet(cards, input, band, refillProvinces);
        const card = cards.find((candidate) => !candidate.selected && !keep.has(String(candidate.uuid)));
        // Recorded on the Done tick only. The policy re-enters this method once
        // per click, and the plan is a pure function of the province, so the
        // terminal tick is the one place it fires exactly once per prompt.
        if(!card && BotTelemetry.enabled) {
            for(const decision of refillProvinces) {
                BotTelemetry.record('refill-province-plan', () => ({
                    player: String(input.playerName || ''),
                    location: decision.location,
                    provinceId: decision.provinceId,
                    keep: decision.keep,
                    priorityCount: decision.priorityCount,
                    cards: decision.cardIds,
                    band: band,
                    round: Number(input.roundNumber) || 0
                }));
            }
        }
        return {
            card,
            reason: card ? `adaptive-discard-${band}-${String(card.type || 'dynasty')}` : 'adaptive-finish-dynasty-discard',
            band,
            projectedFate: this.projectedFate(input)
        };
    }

    /**
     * Settle every all-or-nothing refill province for this fate phase.
     *
     * `Player.replaceDynastyCard` only refills a province with NO dynasty card
     * left on it, so a partial discard here is strictly worse than either
     * extreme: it throws cards away AND gets nothing back. The answer is per
     * province, and it is binary.
     *
     * Read from the ENGINE's view of the province (`RefillProvinceState`), never
     * from the prompt. Three reasons, each of which produced a wrong answer
     * when this was written against the serialized board: the prompt's card
     * list shrinks as the bot clicks, so a plan recomputed on it can flip from
     * wipe to keep mid-prompt and strand cards; a facedown dynasty card
     * publishes no id, so it is invisible there; and the refill AMOUNT is a
     * persistent effect a broken province no longer has.
     */
    refillProvincePlan(input: MulliganInput): RefillProvinceDecision[] {
        if(this.profile.refillProvinceIds.length === 0 || !input.provinceRefill) {
            return [];
        }
        const decisions: RefillProvinceDecision[] = [];
        for(const [location, state] of Object.entries(input.provinceRefill)) {
            if(!this.profile.refillProvinceIds.includes(String(state.provinceId || ''))) {
                continue;
            }
            // A province that refills to one card is not all-or-nothing: the
            // normal per-card rules already empty it. This is also how a BROKEN
            // Rich Frog falls out -- it is blank, so it has no refill effect
            // left and reads 1 here.
            if(state.refillTo <= 1) {
                continue;
            }
            // A facedown dynasty card cannot be discarded in the fate phase, so
            // the province can never reach empty this round and no refill is
            // coming. Emptying the faceup half would then throw cards away for
            // nothing, which is strictly the worst of the two options.
            if(state.facedownCards > 0 || state.faceupCards.length === 0) {
                continue;
            }
            const priorityCount = state.faceupCards.filter((card) => card.type === 'character' &&
                this.profile.refillProvincePriorityCharacterIds.includes(String(card.id || ''))).length;
            decisions.push({
                location: location,
                provinceId: String(state.provinceId || ''),
                keep: priorityCount >= this.profile.refillProvinceMinPriorityCharacters,
                priorityCount: priorityCount,
                cardIds: state.faceupCards.map((card) => String(card.id || '')),
                uuids: state.faceupCards.map((card) => String(card.uuid))
            });
        }
        return decisions;
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

    private endPhaseKeepSet(cards: any[], input: MulliganInput, band: MulliganBoardBand,
        refillProvinces: RefillProvinceDecision[] = []): Set<string> {
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
            return this.finaliseEndPhaseKeep(cards, keep, refillProvinces);
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
        return this.finaliseEndPhaseKeep(cards, keep, refillProvinces);
    }

    // An all-or-nothing refill province answers for its own contents, so it is
    // applied LAST -- after the forced discards, which are themselves the last
    // word everywhere else. A forced id sitting on such a province would
    // otherwise discard one card and block the refill for the other two, which
    // is the worst of both rules rather than either of them.
    private finaliseEndPhaseKeep(cards: any[], keep: Set<string>,
        refillProvinces: RefillProvinceDecision[]): Set<string> {
        const settled = this.applyForcedDiscards(cards, keep);
        for(const decision of refillProvinces) {
            for(const uuid of decision.uuids) {
                if(decision.keep) {
                    settled.add(uuid);
                } else {
                    settled.delete(uuid);
                }
            }
        }
        return settled;
    }

    // Applied last so an opted-in id beats every keep rule above it, including
    // the holdings-only fallback. No-op while the list is empty.
    private applyForcedDiscards(cards: any[], keep: Set<string>): Set<string> {
        if(this.profile.endPhaseDiscardCardIds.length === 0) {
            return keep;
        }
        for(const card of cards) {
            if(this.profile.endPhaseDiscardCardIds.includes(String(card.id || ''))) {
                keep.delete(String(card.uuid));
            }
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
