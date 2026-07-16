export interface JigokuBotLlmConfig {
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
    liveConsult?: boolean;
    consultTimeoutMs?: number;
    cacheDir?: string;
}

export type JigokuBotPolicyVariant = 'generic' | 'fate-aware';

export interface JigokuBotConfig {
    playerName: string;
    deckId?: string;
    seed?: string | number;
    difficulty?: string;
    trace?: boolean;
    maxDecisionsPerTick?: number;
    // Seed 1 defaults to fate-aware; seed 2 selects the old generic heuristic.
    // Explicit variants remain available for controlled policy comparisons.
    policy?: JigokuBotPolicyVariant;
    llm?: JigokuBotLlmConfig;
    // Seed-3 exploration rate (0..1): probability of taking a random legal move
    // instead of the evaluator's argmax. Used during self-play data generation
    // so the model sees the consequences of moves it would not itself pick;
    // 0 (default) for evaluation and live play.
    explore?: number;
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
