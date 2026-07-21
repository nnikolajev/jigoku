import type { PlanningState } from '../model/PlanningState';
import { immutable, stableHash } from '../model/Stable';
import { normalizeCard, opponentId, responsePackages } from './InformationHelpers.js';
import type {
    OpponentInformationProvider,
    OpponentInformationSnapshot,
    OpponentProvinceModel,
    PublicOpponentEvidence
} from './OpponentInformationProvider';

export interface ExactInformationInput {
    readonly hand: readonly unknown[];
    readonly provinces: readonly (OpponentProvinceModel & { readonly broken?: boolean })[];
    readonly fate?: number;
    readonly evidence?: PublicOpponentEvidence;
}

export default class ExactInformationProvider implements OpponentInformationProvider<ExactInformationInput> {
    readonly mode = 'omniscient' as const;

    build(state: PlanningState, input: ExactInformationInput): OpponentInformationSnapshot {
        const cards = input.hand.map(normalizeCard).sort((left, right) => left.id.localeCompare(right.id));
        const handHypotheses = [{
            id: `exact-hand:${stableHash(cards.map((card) => card.id))}`,
            cards, weight: 1, exact: true,
            rationale: ['exact-authorized-hidden-hand']
        }];
        const opponent = opponentId(state);
        const provinceHypotheses = input.provinces.filter((province) => !province.broken).map((province) => ({
            location: province.location!, possibilities: [{ province, weight: 1 }], exact: true
        }));
        const responses = responsePackages(state, handHypotheses, input.evidence, input.fate);
        return immutable({
            mode: this.mode, handHypotheses, provinceHypotheses, responsePackages: responses, certainty: 1,
            trace: {
                exactHandSize: cards.length,
                exactProvinceCount: provinceHypotheses.length,
                legalAffordableResponses: responses.length,
                opponentFate: input.fate ?? state.players[opponent]?.fate ?? 0
            }
        }) as OpponentInformationSnapshot;
    }
}
