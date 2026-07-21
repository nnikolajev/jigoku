import { logger } from '../../logger.js';
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

    cardCanDisableDefender(card: any): boolean {
        return this.cardCanTargetOpponentWith(
            card,
            new Set(['bow', 'sendHome', 'discardFromPlay', 'returnToHand', 'returnToDeck', 'removeFromGame']),
            /\bbow\b|send[^.]*\bhome\b|discard[^.]*character[^.]*from play|remove[^.]*character[^.]*from the conflict/
        );
    }

    cardCanBowOpponent(card: any): boolean {
        return this.cardCanTargetOpponentWith(card, new Set(['bow']), /\bbow\b/);
    }

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

    opponentParticipantCanBow(me: Player): boolean {
        const opp = (me as any).opponent as Player | undefined;
        const cards: any[] = typeof (opp as any)?.cardsInPlay?.toArray === 'function'
            ? (opp as any).cardsInPlay.toArray()
            : [];
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

    build(me: Player): Omniscient | undefined {
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
        return {
            oppName: (opp as any).name,
            oppFate,
            oppHand,
            oppProvinces: this.opponentProvinces(opp),
            handThreatMatrix: {
                military: buildHandThreatMatrix(oppHand, oppFate, 'military'),
                political: buildHandThreatMatrix(oppHand, oppFate, 'political')
            },
            affordableDefenderDisables: this.affordableDefenderDisableCount(oppHand, oppFate),
            unmodeledEvents
        };
    }

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
