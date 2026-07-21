export type PlayerId = string;
export type CardInstanceId = string;
export type ProvinceLocation = 'province 1' | 'province 2' | 'province 3' | 'province 4' | 'stronghold province';
export type RingElement = 'air' | 'earth' | 'fire' | 'void' | 'water';
export type ConflictType = 'military' | 'political';

export interface PlayerRef {
    readonly kind: 'player';
    readonly id: PlayerId;
}

export interface CardRef {
    readonly kind: 'card';
    readonly instanceId: CardInstanceId;
    readonly cardId?: string;
    readonly controllerId?: PlayerId;
    readonly location?: string;
}

export interface CharacterRef {
    readonly kind: 'character';
    readonly instanceId: CardInstanceId;
    readonly cardId?: string;
    readonly controllerId: PlayerId;
}

export interface ProvinceRef {
    readonly kind: 'province';
    readonly controllerId: PlayerId;
    readonly location: ProvinceLocation;
    readonly instanceId?: CardInstanceId;
    readonly cardId?: string;
}

export interface RingRef {
    readonly kind: 'ring';
    readonly element: RingElement;
}

export interface PromptRef {
    readonly kind: 'prompt';
    readonly identity: string;
    readonly title: string;
    readonly menu: string;
}

export type TargetRef = PlayerRef | CardRef | CharacterRef | ProvinceRef | RingRef;

export interface GameScopeRef {
    readonly gameId: string;
    readonly roundId: string;
    readonly phaseId: string;
    readonly conflictId?: string;
}
