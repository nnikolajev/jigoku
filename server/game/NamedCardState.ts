import { EffectNames } from './Constants';
import type Effect from './Effects/Effect';
import type Game from './game';
import type Player from './player';

/**
 * A card that has been NAMED, and the effect that naming is still driving.
 *
 * Naming a card names a string, not an object -- there is no card in play to point a
 * uuid at, and the named card may not exist in either deck. So the engine publishes the
 * name and the client turns it back into a picture from the card database it already
 * holds.
 */
export interface NamedCardBadge {
    /** The named card's printed name. */
    name: string;
    /**
     * The printing to draw, when a copy of the named card exists somewhere in this
     * game. Naming is by name, so a card nobody brought resolves to nothing here and
     * the client falls back to the card database it already holds.
     */
    id?: string;
    packId?: string;
    /** The card doing the naming, so the client can anchor the badge beside it. */
    sourceUuid?: string;
    sourceId?: string;
    sourceName: string;
}

interface NamedCardProperties {
    namedCard?: string;
}

/**
 * Carry the nameCard() cost's answer onto the lasting effect it pays for.
 *
 * `Effect.refreshContext()` replaces the effect's context with a fresh framework one,
 * so `context.costs` -- where the named card lives -- is gone by the time the effect is
 * in the engine. Copying the name onto the effect properties at the moment the effect
 * is created is what lets the badge live exactly as long as the effect does.
 */
export function captureNamedCard(properties: NamedCardProperties, context: any): void {
    if(properties.namedCard === undefined && context && context.costs && context.costs.nameCardCost) {
        properties.namedCard = context.costs.nameCardCost;
    }
}

function findPrinting(game: Game, name: string): any {
    return game.allCards.find((card: any) => card.printedName === name || card.name === name);
}

function badgeFor(game: Game, effect: Effect, name: string): NamedCardBadge {
    const source: any = effect.source;
    const printing = findPrinting(game, name);
    return {
        name,
        id: printing ? printing.id : undefined,
        packId: printing ? printing.packId : undefined,
        sourceUuid: source ? source.uuid : undefined,
        sourceId: source ? source.id : undefined,
        sourceName: source ? source.name : ''
    };
}

function dedupe(badges: NamedCardBadge[]): NamedCardBadge[] {
    const seen = new Set<string>();
    return badges.filter((badge) => {
        const key = `${badge.sourceUuid || ''}|${badge.name}`;
        if(seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * Cards this player has named that are still doing something -- Shiro Kitsuki's ring
 * claim, Ashalan Lantern's cost reduction. Keyed on the naming card so the client can
 * draw the named card beside it.
 */
export function namedCardsForPlayer(game: Game, player: Player): NamedCardBadge[] {
    const badges: NamedCardBadge[] = [];
    for(const effect of game.effectEngine.effects) {
        const named = effect.namedCard;
        if(!named || effect.targets.length === 0 || !effect.isEffectActive()) {
            continue;
        }
        if(effect.source && effect.source.controller === player) {
            badges.push(badgeFor(game, effect, named));
        }
    }
    return dedupe(badges);
}

function restrictedCardName(effect: Effect): string | undefined {
    if(effect.effect.type !== EffectNames.AbilityRestrictions) {
        return undefined;
    }
    const restriction: any = effect.effect.getValue();
    if(!restriction || !restriction.params) {
        return undefined;
    }
    const restricts = restriction.restriction;
    const matches = Array.isArray(restricts) ? restricts.includes('copiesOfX') : restricts === 'copiesOfX';
    return matches ? restriction.params : undefined;
}

/**
 * Cards this player currently cannot play copies of -- Gossip, Bayushi's Whisperers,
 * Esteemed Tea House, Dai Tsuchi. Read off the live restriction rather than off the
 * card that applied it, so the badge appears and disappears exactly when the rule does.
 */
export function unplayableNamedCards(game: Game, player: Player): NamedCardBadge[] {
    const badges: NamedCardBadge[] = [];
    for(const effect of game.effectEngine.effects) {
        const name = restrictedCardName(effect);
        if(name && effect.targets.includes(player)) {
            badges.push(badgeFor(game, effect, name));
        }
    }
    return dedupe(badges);
}
