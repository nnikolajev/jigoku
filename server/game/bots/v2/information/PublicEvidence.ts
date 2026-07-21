import type { PublicOpponentEvidence } from './OpponentInformationProvider';

function cards(value: any): any[] {
    if(Array.isArray(value)) return value;
    if(typeof value?.toArray === 'function') return value.toArray();
    return [];
}

/** Extracts public zones only. It intentionally never traverses either hand or facedown province identity. */
export function publicEvidenceFromPlayerState(playerState: any, botName: string,
    context: any = {}): PublicOpponentEvidence {
    const opponentEntry = Object.entries(playerState?.players || {}).find(([name]) => name !== botName) as [string, any] | undefined;
    const opponent = opponentEntry?.[1] || {};
    const discard = [
        ...cards(opponent?.cardPiles?.conflictDiscardPile),
        ...cards(opponent?.cardPiles?.dynastyDiscardPile)
    ].map((card) => card?.id).filter(Boolean);
    const played = cards(opponent?.cardPiles?.cardsInPlay).map((card) => card?.id).filter(Boolean);
    const revealedProvinces = [
        ...Object.values(opponent?.provinces || {}).flatMap(cards),
        ...cards(opponent?.strongholdProvince)
    ].filter((province: any) => province && province.facedown !== true && province.id).map((province: any) => ({
        id: String(province.id), name: province.name, strength: Number(province.strengthSummary?.stat ?? province.strength) || 0,
        location: province.location, abilityClass: province.abilityClass
    }));
    return {
        playedCardIds: played,
        discardedCardIds: discard,
        revealedCardIds: context.publiclyRevealedCardIds || [],
        searchedCardIds: context.publicSearchCardIds || [],
        publicDraws: Number(context.opponentPublicDraws) || 0,
        bidHistory: context.opponentBidHistory || [],
        usedLimits: context.opponentUsedLimits || [],
        revealedProvinces
    };
}
