import type { BotDecisionInput, BotInformationMode } from '../BotEngine';
import { emptyLedgers, resetLedgers, type PlanningLedgers } from './model/Ledgers';
import type {
    AttachmentProjection,
    BoardProjection,
    CharacterProjection,
    ConflictOpportunityProjection,
    ConflictProjection,
    HandProjection,
    LiveResources,
    PlanningState,
    PlayerProjection,
    ProvinceProjection,
    RingProjection
} from './model/PlanningState';
import type { ConflictType, GameScopeRef, PlayerId, ProvinceLocation, RingElement } from './model/References';
import { immutable, stableHash } from './model/Stable';

const PROVINCE_KEYS = ['one', 'two', 'three', 'four'] as const;
const PROVINCE_LOCATIONS = ['province 1', 'province 2', 'province 3', 'province 4'] as const;
const RINGS = ['air', 'earth', 'fire', 'void', 'water'] as const;

export interface SnapshotBuildOptions {
    readonly informationMode: BotInformationMode;
    readonly previousLedgers?: PlanningLedgers;
    readonly gameId?: string;
    readonly roundId?: string;
    readonly phaseId?: string;
    readonly conflictId?: string;
}

function number(value: any, fallback = 0): number {
    const parsed = Number(value?.stat ?? value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function collection(value: any): any[] {
    if(Array.isArray(value)) return value;
    if(typeof value?.toArray === 'function') return value.toArray();
    return [];
}

function controllerId(card: any, fallback: PlayerId): PlayerId {
    return String(card?.controller?.name || card?.controller || card?.controllerId || fallback);
}

function instanceId(card: any, prefix: string, index: number): string {
    return String(card?.uuid || card?.instanceId || `${prefix}:${index}`);
}

function cardId(card: any): string | undefined {
    return card?.id || card?.cardData?.id || undefined;
}

function characterProjection(card: any, fallbackController: PlayerId, index: number): CharacterProjection {
    const participating = !!(card?.inConflict || card?.participating || card?.attacking || card?.defending);
    const conflictType = card?.conflictType === 'military' || card?.conflictType === 'political'
        ? card.conflictType as ConflictType
        : undefined;
    const attachments = collection(card?.attachments).map((attachment, attachmentIndex): AttachmentProjection => ({
        instanceId: instanceId(attachment, `attachment:${instanceId(card, 'character', index)}`, attachmentIndex),
        cardId: cardId(attachment),
        controllerId: controllerId(attachment, fallbackController),
        fate: number(attachment?.fate),
        nonStackingKeys: collection(attachment?.nonStackingKeys).map(String)
    }));
    const traits = Array.isArray(card?.traits)
        ? card.traits.map(String)
        : typeof card?.traits === 'string'
            ? card.traits.split('.').map((trait: string) => trait.trim()).filter(Boolean)
            : [];
    return {
        instanceId: instanceId(card, 'character', index),
        cardId: cardId(card),
        controllerId: controllerId(card, fallbackController),
        ownerId: String(card?.owner?.name || card?.owner || card?.ownerId || fallbackController),
        location: String(card?.location || 'play area'),
        military: number(card?.militarySkillSummary ?? card?.military ?? card?.getMilitarySkill?.()),
        political: number(card?.politicalSkillSummary ?? card?.political ?? card?.getPoliticalSkill?.()),
        glory: number(card?.glory ?? card?.glorySummary),
        fate: number(card?.fate),
        honored: !!(card?.isHonored || card?.honored),
        dishonored: !!(card?.isDishonored || card?.dishonored),
        bowed: !!card?.bowed,
        ready: !card?.bowed,
        participating,
        attacking: !!card?.attacking,
        defending: !!card?.defending,
        conflictType,
        traits,
        unique: !!(card?.isUnique || card?.unique || card?.cardData?.is_unique),
        attachments,
        canMove: card?.canMove !== false,
        canReady: card?.canReady !== false,
        noBowAfterConflict: !!(card?.doesNotBow || card?.noBowAfterConflict),
        canAttackMilitary: card?.canAttackMilitary !== false && number(card?.militarySkillSummary ?? card?.military, 0) >= 0,
        canAttackPolitical: card?.canAttackPolitical !== false && number(card?.politicalSkillSummary ?? card?.political, 0) >= 0,
        covert: !!(card?.covert || card?.isCovert?.()),
        attackRestrictions: collection(card?.attackRestrictions).map(String)
    };
}

function provinceProjection(playerId: PlayerId, cards: any[], location: ProvinceLocation,
    context: any): ProvinceProjection {
    const province = cards.find((card) => card?.isProvince || card?.type === 'province' || card?.facedown) || cards[0] || {};
    const hidden = province?.facedown === true || (!cardId(province) && province?.visible !== true);
    const holdingIds = cards
        .filter((card) => card?.type === 'holding' && !card?.facedown)
        .map(cardId)
        .filter(Boolean) as string[];
    const exactStrength = context?.provinceStrengthByLocation?.[location];
    const visibleStrength = number(province?.strengthSummary ?? province?.strength, NaN);
    const baseStrength = Number.isFinite(number(province?.baseStrength, NaN)) ? number(province?.baseStrength) : undefined;
    const effectiveStrength = Number.isFinite(number(exactStrength, NaN))
        ? number(exactStrength)
        : Number.isFinite(visibleStrength)
            ? visibleStrength
            : number(context?.unknownProvinceStrength, 4);
    return {
        controllerId: playerId,
        location,
        instanceId: province?.uuid ? String(province.uuid) : undefined,
        cardId: hidden ? undefined : cardId(province),
        visible: !hidden,
        broken: !!(province?.isBroken || province?.broken),
        inConflict: !!province?.inConflict,
        baseStrength,
        effectiveStrength,
        holdingIds,
        attackEligible: !province?.isBroken && province?.attackable !== false,
        stronghold: location === 'stronghold province'
    };
}

function pileSize(player: any, pile: string): number {
    const value = player?.cardPiles?.[pile] ?? player?.[pile];
    if(Array.isArray(value)) return value.length;
    if(typeof value?.size === 'function') return value.size();
    if(typeof value?.size === 'number') return value.size;
    return number(value?.count ?? value?.length);
}

function playerCharacters(player: any): any[] {
    return collection(player?.cardPiles?.cardsInPlay ?? player?.cardsInPlay)
        .filter((card) => card?.type === 'character');
}

function handProjection(playerId: PlayerId, player: any, own: boolean): HandProjection {
    const cards = collection(player?.cardPiles?.hand ?? player?.hand);
    return {
        playerId,
        size: cards.length || pileSize(player, 'hand'),
        exact: own,
        cards: own ? cards.map((card) => ({
            instanceId: card?.uuid ? String(card.uuid) : undefined,
            cardId: cardId(card),
            known: true,
            cost: Number.isFinite(number(card?.cost, NaN)) ? number(card.cost) : undefined,
            type: card?.type
        })) : []
    };
}

export default class PerspectiveSnapshotBuilder {
    build(input: BotDecisionInput, options: SnapshotBuildOptions): PlanningState {
        const state = input.playerState || {};
        const players = state.players || {};
        const botName = input.botName || Object.keys(players).find((name) => players[name]?.promptTitle) || Object.keys(players)[0];
        const context = input.context || {};
        const phase = String(players[botName]?.phase || state.phase || context.phase || 'unknown');
        const conflictId = options.conflictId || context.conflictId || state.conflict?.id || state.conflict?.uuid || state.currentConflict?.uuid;
        const scopes: GameScopeRef = {
            gameId: String(options.gameId || context.gameId || state.gameId || 'game'),
            roundId: String(options.roundId || context.roundId || context.roundNumber || state.roundNumber || 'round:0'),
            phaseId: String(options.phaseId || context.phaseId || `${context.roundNumber || state.roundNumber || 0}:${phase}`),
            conflictId: conflictId ? String(conflictId) : undefined
        };
        const ledgers = options.previousLedgers
            ? resetLedgers(options.previousLedgers, scopes)
            : emptyLedgers(scopes);
        const playerEntries = Object.entries(players) as [PlayerId, any][];
        const projectedPlayers: Record<PlayerId, PlayerProjection> = {};
        const hands: HandProjection[] = [];
        const characters: CharacterProjection[] = [];
        const provinces: ProvinceProjection[] = [];
        for(const [playerId, player] of playerEntries) {
            const provinceLists = PROVINCE_KEYS.map((key) => collection(player?.provinces?.[key]));
            const stronghold = collection(player?.strongholdProvince);
            const brokenProvinceCount = [...provinceLists, stronghold]
                .filter((list) => list.some((card) => card?.isBroken || card?.broken)).length;
            projectedPlayers[playerId] = {
                id: playerId,
                fate: number(player?.stats?.fate ?? player?.fate),
                honor: number(player?.stats?.honor ?? player?.honor),
                conflictDeckSize: pileSize(player, 'conflictDeck'),
                dynastyDeckSize: pileSize(player, 'dynastyDeck'),
                brokenProvinceCount,
                firstPlayer: !!(player?.firstPlayer || player?.isFirstPlayer)
            };
            hands.push(handProjection(playerId, player, playerId === botName));
            characters.push(...playerCharacters(player).map((card, index) => characterProjection(card, playerId, index)));
            for(let index = 0; index < PROVINCE_KEYS.length; index++) {
                provinces.push(provinceProjection(playerId, provinceLists[index], PROVINCE_LOCATIONS[index], context));
            }
            provinces.push(provinceProjection(playerId, stronghold, 'stronghold province', context));
        }
        const rings: RingProjection[] = RINGS.map((element) => {
            const ring = state.rings?.[element] || {};
            return {
                element: element as RingElement,
                fate: number(ring.fate),
                claimedBy: ring.claimedBy?.name || ring.claimedBy || ring.claimedById,
                conflictType: ring.conflictType === 'military' || ring.conflictType === 'political' ? ring.conflictType : undefined,
                contested: !!(ring.contested || ring.inConflict),
                selectable: ring.unselectable !== true
            };
        });
        const liveConflict = state.conflict || state.currentConflict || context.conflict;
        const conflict: ConflictProjection | undefined = liveConflict || conflictId ? {
            id: String(conflictId || 'conflict'),
            attackerId: liveConflict?.attackingPlayer?.name || liveConflict?.attackerId,
            defenderId: liveConflict?.defendingPlayer?.name || liveConflict?.defenderId,
            type: liveConflict?.type === 'military' || liveConflict?.type === 'political' ? liveConflict.type : undefined,
            ring: liveConflict?.ring?.element || liveConflict?.ring,
            provinceLocation: liveConflict?.province?.location || liveConflict?.provinceLocation,
            attackerSkill: number(liveConflict?.attackerSkill ?? liveConflict?.attackerSkillTotal),
            defenderSkill: number(liveConflict?.defenderSkill ?? liveConflict?.defenderSkillTotal),
            provinceStrength: number(liveConflict?.provinceStrength),
            breakThreshold: number(liveConflict?.breakThreshold ?? liveConflict?.provinceStrength),
            winnerId: liveConflict?.winner?.name || liveConflict?.winnerId
        } : undefined;
        const remaining: Record<PlayerId, Record<ConflictType, number>> = {};
        for(const [playerId, player] of playerEntries) {
            const explicit = context.remainingConflictOpportunities?.[playerId] || player?.remainingConflictOpportunities || {};
            remaining[playerId] = {
                military: number(explicit.military, player?.militaryConflictOpportunities === 0 ? 0 : 1),
                political: number(explicit.political, player?.politicalConflictOpportunities === 0 ? 0 : 1)
            };
        }
        const opportunities: ConflictOpportunityProjection = {
            remainingByPlayer: remaining,
            totalRemaining: Object.values(remaining).reduce((sum, value) => sum + value.military + value.political, 0)
        };
        const resources: LiveResources = {
            fateByPlayer: Object.fromEntries(Object.values(projectedPlayers).map((player) => [player.id, player.fate])),
            honorByPlayer: Object.fromEntries(Object.values(projectedPlayers).map((player) => [player.id, player.honor])),
            handSizeByPlayer: Object.fromEntries(hands.map((hand) => [hand.playerId, hand.size])),
            conflictDeckByPlayer: Object.fromEntries(Object.values(projectedPlayers).map((player) => [player.id, player.conflictDeckSize]))
        };
        const readySkillByPlayer: Record<PlayerId, Record<ConflictType, number>> = {};
        const participatingSkillByPlayer: Record<PlayerId, number> = {};
        for(const [playerId] of playerEntries) {
            const mine = characters.filter((character) => character.controllerId === playerId);
            readySkillByPlayer[playerId] = {
                military: mine.filter((character) => character.ready).reduce((sum, character) => sum + character.military, 0),
                political: mine.filter((character) => character.ready).reduce((sum, character) => sum + character.political, 0)
            };
            participatingSkillByPlayer[playerId] = mine.filter((character) => character.participating)
                .reduce((sum, character) => sum + (conflict?.type === 'political' ? character.political : character.military), 0);
        }
        const board: BoardProjection = { readySkillByPlayer, participatingSkillByPlayer };
        const me = players[botName] || {};
        const prompt = {
            kind: 'prompt' as const,
            identity: String(context.promptIdentity || `${me.promptTitle || ''}|${me.menuTitle || ''}`),
            title: String(me.promptTitle || ''),
            menu: String(me.menuTitle || '')
        };
        const promptControls = (context.promptControls || me.controls || []).map((control: any) => ({
            type: String(control.type || 'unknown'),
            command: control.command,
            uuid: control.uuid,
            method: control.method
        }));
        const materialStateSignature = stableHash({
            scopes,
            phase,
            players: projectedPlayers,
            characters,
            provinces,
            rings,
            hands,
            conflict,
            opportunities
        });
        return immutable({
            schemaVersion: 1,
            perspectivePlayerId: botName,
            informationMode: options.informationMode,
            scopes,
            phase,
            prompt,
            promptControls,
            conflict,
            players: projectedPlayers,
            characters,
            provinces,
            rings,
            hands,
            opportunities,
            resources,
            board,
            ledgers,
            materialStateSignature
        }) as PlanningState;
    }
}
