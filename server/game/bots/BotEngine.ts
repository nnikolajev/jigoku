/**
 * The wire contract between a bot engine and the controller that drives it.
 *
 * A `BotDecision` is one CLICK, not a plan: the six `BotCommandName` values are
 * exactly the commands `GameServer` accepts from a bot seat, so anything an
 * engine wants to do it must express as a sequence of clicks a human could
 * have made. That constraint is the whole reason the bot cannot cheat the
 * engine — it goes through the same prompt pipeline as a player.
 *
 * `BotDecisionInput` carries the serialised player state plus a context bag the
 * controller fills from live game objects the serialised state omits (printed
 * costs, target hints, the card playbook lookup). Both V1 (`V1PolicyAdapter`)
 * and V2 (`v2/V2BotEngine`) implement `BotEngine`; `BotEngineRouter` picks one.
 */
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

/**
 * Printed stats of a card offered as a handler-menu button (deck searches,
 * look-at-top-N plays, attachment searches). `PlayerPromptState.setPrompt`
 * serialises the button's card down to id/name/type/uuid, so the controller
 * supplies these from the live card object and the policy ranks on them.
 */
export interface MenuCardInfo {
    // Printed card id. A handler menu's buttons carry only a uuid and a label,
    // so without this no deck rule can recognise WHICH card a choice is.
    id: string;
    cost: number;
    military: number;
    political: number;
    glory: number;
    type: string;
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
