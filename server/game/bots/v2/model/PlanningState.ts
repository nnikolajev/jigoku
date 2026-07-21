import type { BotInformationMode } from '../../BotEngine';
import type { BotIntent } from './Intent';
import type { PlanningLedgers } from './Ledgers';
import type {
    CardInstanceId,
    ConflictType,
    GameScopeRef,
    PlayerId,
    PromptRef,
    ProvinceLocation,
    RingElement
} from './References';

export interface AttachmentProjection {
    readonly instanceId: CardInstanceId;
    readonly cardId?: string;
    readonly controllerId?: PlayerId;
    readonly fate: number;
    readonly nonStackingKeys: readonly string[];
}

export interface CharacterProjection {
    readonly instanceId: CardInstanceId;
    readonly cardId?: string;
    readonly controllerId: PlayerId;
    readonly ownerId?: PlayerId;
    readonly location: string;
    readonly military: number;
    readonly political: number;
    readonly glory: number;
    readonly fate: number;
    readonly honored: boolean;
    readonly dishonored: boolean;
    readonly bowed: boolean;
    readonly ready: boolean;
    readonly participating: boolean;
    readonly attacking: boolean;
    readonly defending: boolean;
    readonly conflictType?: ConflictType;
    readonly traits: readonly string[];
    readonly unique: boolean;
    readonly attachments: readonly AttachmentProjection[];
    readonly canMove: boolean;
    readonly canReady: boolean;
    readonly noBowAfterConflict: boolean;
    readonly canAttackMilitary: boolean;
    readonly canAttackPolitical: boolean;
    readonly covert: boolean;
    readonly attackRestrictions: readonly string[];
}

export interface ProvinceProjection {
    readonly controllerId: PlayerId;
    readonly location: ProvinceLocation;
    readonly instanceId?: CardInstanceId;
    readonly cardId?: string;
    readonly visible: boolean;
    readonly broken: boolean;
    readonly inConflict: boolean;
    readonly baseStrength?: number;
    readonly effectiveStrength: number;
    readonly holdingIds: readonly string[];
    readonly attackEligible: boolean;
    readonly stronghold: boolean;
}

export interface RingProjection {
    readonly element: RingElement;
    readonly fate: number;
    readonly claimedBy?: PlayerId;
    readonly conflictType?: ConflictType;
    readonly contested: boolean;
    readonly selectable: boolean;
}

export interface HandCardProjection {
    readonly instanceId?: CardInstanceId;
    readonly cardId?: string;
    readonly known: boolean;
    readonly cost?: number;
    readonly type?: string;
}

export interface HandProjection {
    readonly playerId: PlayerId;
    readonly size: number;
    readonly cards: readonly HandCardProjection[];
    readonly exact: boolean;
}

export interface PlayerProjection {
    readonly id: PlayerId;
    readonly fate: number;
    readonly honor: number;
    readonly conflictDeckSize: number;
    readonly dynastyDeckSize: number;
    readonly brokenProvinceCount: number;
    readonly firstPlayer: boolean;
}

export interface ConflictProjection {
    readonly id: string;
    readonly attackerId?: PlayerId;
    readonly defenderId?: PlayerId;
    readonly type?: ConflictType;
    readonly ring?: RingElement;
    readonly provinceLocation?: ProvinceLocation;
    readonly attackerSkill: number;
    readonly defenderSkill: number;
    readonly provinceStrength: number;
    readonly breakThreshold: number;
    readonly winnerId?: PlayerId;
}

export interface ConflictOpportunityProjection {
    readonly remainingByPlayer: Readonly<Record<PlayerId, Readonly<Record<ConflictType, number>>>>;
    readonly totalRemaining: number;
}

export interface LiveResources {
    readonly fateByPlayer: Readonly<Record<PlayerId, number>>;
    readonly honorByPlayer: Readonly<Record<PlayerId, number>>;
    readonly handSizeByPlayer: Readonly<Record<PlayerId, number>>;
    readonly conflictDeckByPlayer: Readonly<Record<PlayerId, number>>;
}

export interface BoardProjection {
    readonly readySkillByPlayer: Readonly<Record<PlayerId, Readonly<Record<ConflictType, number>>>>;
    readonly participatingSkillByPlayer: Readonly<Record<PlayerId, number>>;
}

export interface PlanningState {
    readonly schemaVersion: 1;
    readonly perspectivePlayerId: PlayerId;
    readonly informationMode: BotInformationMode;
    readonly scopes: GameScopeRef;
    readonly phase: string;
    readonly prompt: PromptRef;
    readonly promptControls: readonly {
        readonly type: string;
        readonly command?: string;
        readonly uuid?: string;
        readonly method?: string;
    }[];
    readonly conflict?: ConflictProjection;
    readonly players: Readonly<Record<PlayerId, PlayerProjection>>;
    readonly characters: readonly CharacterProjection[];
    readonly provinces: readonly ProvinceProjection[];
    readonly rings: readonly RingProjection[];
    readonly hands: readonly HandProjection[];
    readonly opportunities: ConflictOpportunityProjection;
    readonly resources: LiveResources;
    readonly board: BoardProjection;
    readonly ledgers: PlanningLedgers;
    readonly activeIntent?: BotIntent;
    readonly materialStateSignature: string;
}
