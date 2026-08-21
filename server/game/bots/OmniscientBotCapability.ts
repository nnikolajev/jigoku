import { logger } from '../../logger.js';
import { Locations } from '../Constants.js';
import type Game from '../game';
import type Player from '../player';
import { buildHandThreatMatrix, getCardModel } from './DeckAnalysis.js';
import type { KnownCard, OmniProvince, Omniscient } from './DeckAnalysis';

/**
 * Optional hidden-information provider for any bot policy.
 *
 * Seed chooses strategy. This capability chooses information access. Keeping
 * those axes separate lets generic, fate-aware, and board-aware policies use
 * the same exact opponent-hand/province model without inheriting one another.
 */
export default class OmniscientBotCapability {
    private deckAnalysisChecked = false;
    // `cardCanTargetOpponentWith` walks an ability tree and regexes the card
    // text, and `build` runs it over every hidden card on EVERY decide tick.
    // The answer is a property of the printed card, so cache it by id — but
    // only for cards OUTSIDE play, whose abilities cannot have been rewritten
    // by a live effect. An in-play card falls through and is recomputed.
    private readonly targetingByCardId = new Map<string, boolean>();

    constructor(
        private game: Game,
        private playerName: string,
        readonly enabled = false
    ) {}

    private parseStat(value: any): number | null {
        if(value === undefined || value === null || value === '' || value === '-') {
            return null;
        }
        const parsed = Number.parseInt(String(value).replace(/^\+/, ''), 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private cachedTargeting(card: any, key: string, compute: () => boolean): boolean {
        const id = String(card?.id || '');
        if(id === '' || card?.location === Locations.PlayArea) {
            return compute();
        }
        const cacheKey = `${id}|${key}`;
        const cached = this.targetingByCardId.get(cacheKey);
        if(cached !== undefined) {
            return cached;
        }
        const computed = compute();
        this.targetingByCardId.set(cacheKey, computed);
        return computed;
    }

    private cardCanTargetOpponentWith(card: any, actions: Set<string>, textPattern: RegExp): boolean {
        const abilities = ([] as any[]).concat(
            card?.abilities?.actions || [],
            card?.abilities?.reactions || [],
            card?.abilities?.playActions || []
        );
        const seen = new Set<any>();
        const visit = (value: any, opponentTarget: boolean, depth: number): boolean => {
            if(!value || depth > 10 || seen.has(value)) {
                return false;
            }
            if(Array.isArray(value)) {
                return value.some((entry) => visit(entry, opponentTarget, depth + 1));
            }
            if(typeof value !== 'object') {
                return false;
            }
            seen.add(value);
            const side = String(value.controller || value.player || '').toLowerCase();
            const targetsOpponent = opponentTarget || side === 'opponent' || side === 'any';
            if(targetsOpponent && actions.has(String(value.name || ''))) {
                return true;
            }
            const keys = [
                'gameAction', 'gameActions', 'action', 'actions', 'choices', 'options',
                'then', 'target', 'targets', 'ifTrueAction', 'ifFalseAction',
                'replacementGameAction', 'defaultProperties', 'properties'
            ];
            return keys.some((key) => visit(value[key], targetsOpponent, depth + 1));
        };

        for(const ability of abilities) {
            const targetsOpponent = (ability?.targets || []).some((target: any) => {
                const side = String(target?.properties?.controller || target?.properties?.player || '').toLowerCase();
                return side === 'opponent' || side === 'any';
            });
            seen.clear();
            if(visit(ability?.properties, targetsOpponent, 0)) {
                return true;
            }
        }

        const text = String(card?.cardData?.text || '').replace(/<[^>]*>/g, ' ').toLowerCase();
        const controlEffect = textPattern.test(text);
        const opposingTarget = /opponent|character in the conflict|participating character|a character|chosen character/.test(text);
        const ownOnly = /character you control/.test(text) && !/opponent/.test(text);
        return controlEffect && opposingTarget && !ownOnly;
    }

    // Could this card remove a defender from the conflict? Used to price the
    // threat sitting in a hand we are allowed to see.
    cardCanDisableDefender(card: any): boolean {
        return this.cachedTargeting(card, 'disable', () => this.cardCanTargetOpponentWith(
            card,
            new Set(['bow', 'sendHome', 'discardFromPlay', 'returnToHand', 'returnToDeck', 'removeFromGame']),
            /\bbow\b|send[^.]*\bhome\b|discard[^.]*character[^.]*from play|remove[^.]*character[^.]*from the conflict/
        ));
    }

    // Could this card bow one of our characters?
    cardCanBowOpponent(card: any): boolean {
        return this.cachedTargeting(card, 'bow', () =>
            this.cardCanTargetOpponentWith(card, new Set(['bow']), /\bbow\b/));
    }

    // Collapse a live card into the model the policy reasons over.
    knownCard(card: any): KnownCard {
        const model = getCardModel(card.id);
        const data = card.cardData || {};
        const type: string = card.type || (typeof card.getType === 'function' ? card.getType() : '') || data.type || model?.type || '';
        const side = card.isConflict ? 'conflict' : card.isDynasty ? 'dynasty' : (data.side || model?.side || '');
        const rawCost = typeof card.getCost === 'function' ? card.getCost() : (card.printedCost ?? data.cost);
        const cost = Number(rawCost);
        const mil = type === 'character'
            ? (typeof card.getMilitarySkill === 'function' ? card.getMilitarySkill() : this.parseStat(data.military))
            : 0;
        const pol = type === 'character'
            ? (typeof card.getPoliticalSkill === 'function' ? card.getPoliticalSkill() : this.parseStat(data.political))
            : 0;
        const milBonus = this.parseStat(data.military_bonus);
        const polBonus = this.parseStat(data.political_bonus);
        return {
            id: card.id,
            name: card.name || data.name || card.id,
            type,
            side,
            fate: isNaN(cost) ? (model?.fate ?? 0) : Math.max(cost, 0),
            mil: Math.max(Number(mil) || 0, 0),
            pol: Math.max(Number(pol) || 0, 0),
            milBonus: milBonus ?? model?.milBonus ?? 0,
            polBonus: polBonus ?? model?.polBonus ?? 0,
            swing: model?.swing ?? 0,
            tag: model?.tag ?? 'utility',
            canDisableDefender: this.cardCanDisableDefender(card),
            canBowOpponent: this.cardCanBowOpponent(card),
            conflictTypes: model?.conflictTypes || []
        };
    }

    // Every card a side has on the table. One place does the live-pile unwrap so
    // callers below reason over a plain array.
    private cardsInPlay(player: Player | undefined): any[] {
        const pile = (player as any)?.cardsInPlay;
        return pile && typeof pile.toArray === 'function' ? pile.toArray() : [];
    }

    // Does the opponent have a bow available against a participant right now?
    opponentParticipantCanBow(me: Player): boolean {
        const opp = (me as any).opponent as Player | undefined;
        const cards = this.cardsInPlay(opp);
        return cards.some((card) => card?.type === 'character' && card.inConflict && !card.bowed && (
            this.cardCanBowOpponent(card) ||
            (card.attachments || []).some((attachment: any) => this.cardCanBowOpponent(attachment))
        ));
    }

    private liveProvinceStrength(card: any): number {
        const rawStrength = typeof card.getStrength === 'function'
            ? card.getStrength()
            : (card.strength ?? card.printedStrength ?? card.cardData?.strength);
        const strength = Number(rawStrength);
        return Number.isFinite(strength) ? Math.max(strength, 0) : 0;
    }

    private opponentProvinces(opp: Player): OmniProvince[] {
        const provinces: any[] = typeof (opp as any).getProvinces === 'function' ? (opp as any).getProvinces() : [];
        return provinces.filter((card) => card && card.isProvince !== false).map((card) => {
            const dynastyCards: any[] = card.location && typeof (opp as any).getDynastyCardsInProvince === 'function'
                ? (opp as any).getDynastyCardsInProvince(card.location) || []
                : [];
            const dynastyValue = dynastyCards.reduce((total, dynastyCard) => {
                const known = this.knownCard(dynastyCard);
                if(known.type === 'character') {
                    return total + known.fate + (known.mil + known.pol) * 0.25;
                }
                if(known.type === 'holding') {
                    return total + 2;
                }
                return total + Math.max(known.fate, 1);
            }, 0);
            return {
                location: card.location || '',
                id: card.id || card.cardData?.id || '',
                name: card.name || card.id || '',
                strength: this.liveProvinceStrength(card),
                broken: !!card.isBroken,
                facedown: !!card.facedown,
                eminent: typeof card.hasEminent === 'function' ? !!card.hasEminent() : false,
                abilityClass: typeof card.getProvinceAbilityClass === 'function'
                    ? card.getProvinceAbilityClass()
                    : 'unknown',
                dynastyCardIds: dynastyCards.map((dynastyCard) => String(dynastyCard.id || dynastyCard.cardData?.id || '')),
                dynastyValue
            };
        });
    }

    private affordableDefenderDisableCount(cards: KnownCard[], fate: number): number {
        let remaining = Math.max(0, Number(fate) || 0);
        let count = 0;
        const costs = cards.filter((card) => card.canDisableDefender)
            .map((card) => Math.max(0, Number(card.fate) || 0))
            .sort((left, right) => left - right);
        for(const cost of costs) {
            if(cost <= remaining) {
                remaining -= cost;
                count++;
            }
        }
        return count;
    }

    // Ready bodies a side can still send into a conflict. A hand's threat is
    // capped by whether its cards have anything to point at: with no ready body
    // of their own a pump has no bearer, and with none of ours removal has no
    // target. This mirrors `handThreatPreconditions` on the fair estimate.
    private readyCount(player: Player | undefined): number {
        return this.cardsInPlay(player)
            .filter((card) => card?.type === 'character' && !card.bowed).length;
    }

    // The whole hidden-information view: exact hand, exact province strengths
    // and the derived threat matrix. Returns undefined when the capability is
    // off, which is how every fair seat gets nothing.
    //
    // `realism` prices the opponent's hand the way the bot already prices its
    // own — against their real honor and against the bodies actually on the
    // table. Off (the default) keeps the honor-blind, board-blind matrix the
    // shipped omniscient profiles were measured with.
    build(me: Player, realism = false): Omniscient | undefined {
        if(!this.enabled) {
            return undefined;
        }
        const opp = (me as any).opponent as Player | undefined;
        if(!opp) {
            return undefined;
        }
        const handCards: any[] = typeof (opp as any).hand?.toArray === 'function' ? (opp as any).hand.toArray() : [];
        const oppHand = handCards.map((card) => this.knownCard(card));
        const oppFate = Math.max(Number((opp as any).fate) || 0, 0);
        const unmodeledEvents = Array.from(new Set(
            oppHand.filter((card) => card.type === 'event' && !getCardModel(card.id)).map((card) => card.id)
        ));
        // Honor is a real budget and it is exactly visible from this seat, so
        // there is no reason to price an honor-costed trick as free.
        const oppHonor = realism ? Math.max(0, Number((opp as any).honor) || 0) : undefined;
        // Sides flip relative to the fair estimate: this matrix models THEIR
        // hand, so their bodies are the friendly ones.
        const board = realism
            ? { friendlyParticipants: this.readyCount(opp), enemyParticipants: this.readyCount(me) }
            : undefined;
        return {
            oppName: (opp as any).name,
            oppFate,
            oppHand,
            oppProvinces: this.opponentProvinces(opp),
            handThreatMatrix: {
                military: buildHandThreatMatrix(oppHand, oppFate, 'military', oppHonor, board),
                political: buildHandThreatMatrix(oppHand, oppFate, 'political', oppHonor, board)
            },
            affordableDefenderDisables: this.affordableDefenderDisableCount(oppHand, oppFate),
            unmodeledEvents
        };
    }

    // Analyse the opponent deck once per game, lazily on first use.
    ensureDeckAnalyzed(me: Player): void {
        if(this.deckAnalysisChecked || !this.enabled) {
            return;
        }
        const opp = (me as any).opponent as Player | undefined;
        if(!opp) {
            return;
        }
        this.deckAnalysisChecked = true;
        const allCards: any[] = (this.game as any).allCards || [];
        const eventIds = Array.from(new Set<string>(allCards
            .filter((card: any) => card.owner === opp && card.type === 'event' && card.cardData?.id)
            .map((card: any) => String(card.cardData.id))));
        const missing = eventIds.filter((id) => !getCardModel(id));
        if(eventIds.length === 0) {
            return;
        }
        if(missing.length === 0) {
            (this.game as any).addMessage?.(`${this.playerName} (omniscient) has analyzed the opponent deck: all ${eventIds.length} conflict events modeled.`);
        } else {
            logger.info(`Bot ${this.playerName} omniscient: ${missing.length}/${eventIds.length} opponent events unmodeled: ${missing.join(', ')}`);
            (this.game as any).addMessage?.(`${this.playerName} (omniscient) is blind to ${missing.length} unanalyzed opponent card(s); add them to DeckAnalysis for full strength.`);
        }
    }
}
