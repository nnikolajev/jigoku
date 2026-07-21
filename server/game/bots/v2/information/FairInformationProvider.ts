import type { PlanningState } from '../model/PlanningState';
import type { ProvinceLocation } from '../model/References';
import { immutable, stableHash } from '../model/Stable';
import { normalizeCard, opponentId, responsePackages } from './InformationHelpers.js';
import type {
    HandHypothesis,
    OpponentCardModel,
    OpponentInformationProvider,
    OpponentInformationSnapshot,
    OpponentProvinceModel,
    PublicOpponentEvidence
} from './OpponentInformationProvider';

export interface FairInformationInput {
    readonly conflictDeck: readonly unknown[];
    readonly provinceDeck?: readonly OpponentProvinceModel[];
    readonly evidence?: PublicOpponentEvidence;
    readonly maximumHandHypotheses?: number;
}

function counts(ids: readonly string[]): Map<string, number> {
    const result = new Map<string, number>();
    for(const id of ids) result.set(id, (result.get(id) || 0) + 1);
    return result;
}

export default class FairInformationProvider implements OpponentInformationProvider<FairInformationInput> {
    readonly mode = 'fair' as const;

    build(state: PlanningState, input: FairInformationInput): OpponentInformationSnapshot {
        const evidence = input.evidence || {};
        const deck = input.conflictDeck.map(normalizeCard).sort((left, right) => left.id.localeCompare(right.id));
        const publicIds = [
            ...(evidence.playedCardIds || []), ...(evidence.discardedCardIds || []),
            ...(evidence.revealedCardIds || []), ...(evidence.searchedCardIds || [])
        ];
        const removed = counts(publicIds);
        const remaining: OpponentCardModel[] = [];
        for(const card of deck) {
            const count = removed.get(card.id) || 0;
            if(count > 0) removed.set(card.id, count - 1);
            else remaining.push(card);
        }
        const opponent = opponentId(state);
        const handSize = state.hands.find((hand) => hand.playerId === opponent)?.size || 0;
        const searched = (evidence.searchedCardIds || []).map((id) => deck.find((card) => card.id === id)).filter(Boolean) as OpponentCardModel[];
        const cardCounts = counts(remaining.map((card) => card.id));
        const unique = [...new Map(remaining.map((card) => [card.id, card])).values()];
        const beam: { cards: OpponentCardModel[]; weight: number }[] = [{ cards: [...searched], weight: 1 }];
        const unknownSlots = Math.max(0, Math.min(handSize, 8) - searched.length);
        for(let slot = 0; slot < unknownSlots; slot++) {
            const next: { cards: OpponentCardModel[]; weight: number }[] = [];
            for(const partial of beam) {
                const used = counts(partial.cards.map((card) => card.id));
                for(const card of unique) {
                    const available = (cardCounts.get(card.id) || 0) - (used.get(card.id) || 0);
                    if(available <= 0) continue;
                    const denominator = Math.max(1, remaining.length - partial.cards.length);
                    next.push({ cards: [...partial.cards, card].sort((left, right) => left.id.localeCompare(right.id)), weight: partial.weight * available / denominator });
                }
            }
            const deduped = new Map<string, { cards: OpponentCardModel[]; weight: number }>();
            for(const hypothesis of next) {
                const key = hypothesis.cards.map((card) => card.id).join('|');
                const existing = deduped.get(key);
                if(!existing || hypothesis.weight > existing.weight) deduped.set(key, hypothesis);
            }
            beam.splice(0, beam.length, ...[...deduped.values()].sort((left, right) => right.weight - left.weight ||
                left.cards.map((card) => card.id).join('|').localeCompare(right.cards.map((card) => card.id).join('|')))
                .slice(0, input.maximumHandHypotheses || 16));
        }
        const total = beam.reduce((sum, hypothesis) => sum + hypothesis.weight, 0) || 1;
        const handHypotheses: HandHypothesis[] = beam.map((hypothesis, index) => ({
            id: `fair-hand:${stableHash(hypothesis.cards.map((card) => card.id))}`,
            cards: hypothesis.cards,
            weight: Number((hypothesis.weight / total).toFixed(6)), exact: false,
            rationale: [`remaining-copies=${remaining.length}`, `hand-size=${handSize}`, `rank=${index + 1}`]
        }));
        const provinceDeck = (input.provinceDeck || []).slice().sort((left, right) => left.id.localeCompare(right.id));
        const revealedProvinceIds = (evidence.revealedProvinces || []).map((province) => province.id);
        const removedProvinceCounts = counts(revealedProvinceIds);
        const remainingProvinces = provinceDeck.filter((province) => {
            const count = removedProvinceCounts.get(province.id) || 0;
            if(count <= 0) return true;
            removedProvinceCounts.set(province.id, count - 1);
            return false;
        });
        const provinceCounts = counts(remainingProvinces.map((province) => province.id));
        const provinceTotal = Math.max(1, remainingProvinces.length);
        const uniqueProvinces = [...new Map(remainingProvinces.map((province) => [province.id, province])).values()];
        const provinceHypotheses = state.provinces
            .filter((province) => province.controllerId === opponent)
            .map((province) => {
                const revealed = (evidence.revealedProvinces || []).find((item) => item.location === province.location) ||
                    (province.visible && province.cardId ? {
                        id: province.cardId, strength: province.effectiveStrength, location: province.location
                    } : undefined);
                if(revealed) {
                    return {
                        location: province.location as ProvinceLocation,
                        possibilities: [{ province: revealed, weight: 1 }],
                        exact: true
                    };
                }
                return {
                    location: province.location as ProvinceLocation,
                    possibilities: uniqueProvinces.map((item) => ({
                        province: item, weight: (provinceCounts.get(item.id) || 0) / provinceTotal
                    })),
                    exact: false
                };
            });
        const responses = responsePackages(state, handHypotheses, evidence);
        const certainty = handHypotheses.length === 1 && unknownSlots === 0 ? 1 : handHypotheses[0]?.weight || 0;
        return immutable({
            mode: this.mode, handHypotheses, provinceHypotheses, responsePackages: responses, certainty,
            trace: {
                deckCopies: deck.length, publicRemoved: publicIds.length, remainingCopies: remaining.length,
                publicDraws: evidence.publicDraws || 0, bidHistory: evidence.bidHistory || [],
                handHypothesisCount: handHypotheses.length, provinceHypothesisCount: provinceHypotheses.length,
                revealedProvinceCopies: revealedProvinceIds.length,
                remainingProvinceCopies: remainingProvinces.length
            }
        }) as OpponentInformationSnapshot;
    }
}
