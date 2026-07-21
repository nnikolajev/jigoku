export interface JigokuBotLlmConfig {
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
    liveConsult?: boolean;
    consultTimeoutMs?: number;
    cacheDir?: string;
}

export type JigokuBotPolicyVariant = 'generic' | 'fate-aware' | 'board-aware';
export type JigokuBotDrawBidPolicyVariant = 'adaptive' | 'legacy';
export type JigokuBotMulliganPolicyVariant = 'adaptive' | 'legacy';
export type JigokuBotConflictPlanningPolicyVariant = 'lookahead' | 'legacy';

export interface JigokuBotConfig {
    playerName: string;
    deckId?: string;
    seed?: string | number;
    difficulty?: string;
    trace?: boolean;
    maxDecisionsPerTick?: number;
    // Seed 1 defaults to fate-aware; seed 2 selects the old generic heuristic;
    // seed 3 adds fair board-aware dynasty development to seed 1.
    // Explicit variants remain available for controlled policy comparisons.
    policy?: JigokuBotPolicyVariant;
    // Independent information-access capability. Any policy seed can receive
    // exact opposing hand and face-down province data when explicitly enabled.
    omniscient?: boolean;
    // Adaptive is live default. Legacy preserves pre-refactor draw bids for
    // controlled self-play comparisons without reverting other bot logic.
    drawBidPolicy?: JigokuBotDrawBidPolicyVariant;
    // Every seed defaults to the adaptive mulligan/province-refresh planner.
    // Legacy preserves the previous per-deck selectors for paired A/B tests.
    mulliganPolicy?: JigokuBotMulliganPolicyVariant;
    // Lookahead is shared by every seed. Legacy preserves the former greedy
    // conflict declaration path for paired A/B evaluation.
    conflictPlanningPolicy?: JigokuBotConflictPlanningPolicyVariant;
    llm?: JigokuBotLlmConfig;
}

export function buildBotUser(config: JigokuBotConfig): any {
    return {
        username: config.playerName,
        emailHash: '',
        isBot: true,
        settings: {
            disableGravatar: true,
            timerSettings: {},
            windowTimer: false,
            optionSettings: {}
        },
        promptedActionWindows: {
            dynasty: true,
            draw: true,
            preConflict: true,
            conflict: true,
            fate: true,
            regroup: true
        }
    };
}
