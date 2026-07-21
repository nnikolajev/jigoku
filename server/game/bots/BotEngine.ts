export type BotEngineVersion = 'v1' | 'v2';
export type BotInformationMode = 'fair' | 'omniscient';
export type BotTraceLevel = 'production' | 'benchmark' | 'research';

export type BotCommandName =
    'menuButton' |
    'cardClicked' |
    'ringClicked' |
    'menuItemClick' |
    'ringMenuItemClick' |
    'facedownCardClicked';

export interface BotDecision {
    command: BotCommandName;
    args: any[];
    target?: string;
    cardId?: string;
    cardType?: string;
    cardSide?: string;
    cardLocation?: string;
    cardController?: string;
    cardOwner?: string;
    reason: string;
}

export interface BotDecisionInput {
    readonly playerState: any;
    readonly botName?: string;
    readonly context?: any;
}

export interface BotEngineDecisionTrace {
    readonly engineVersion: BotEngineVersion;
    readonly selectedBy: 'v1' | 'v2' | 'fallback';
    readonly fallbackReason?: string;
    readonly decision: BotDecision | null;
    readonly durationMs: number;
    readonly v2Mode?: string;
    readonly planner?: unknown;
    readonly acceptance?: 'success' | 'rejected' | 'unsupported';
}

/** Decision engines only choose a command. Controller retains legality and execution. */
export interface BotEngine {
    readonly version: BotEngineVersion;
    readonly seedState: number;
    readonly lastDecisionTrace?: BotEngineDecisionTrace;
    decide(input: BotDecisionInput): BotDecision | null;
    observeDecision?(result: 'success' | 'rejected' | 'unsupported', reason: string): void;
}
