import JigokuBotPolicy from './JigokuBotPolicy.js';
import FateAwareJigokuBotPolicy from './FateAwareJigokuBotPolicy.js';
import BoardAwareJigokuBotPolicy from './BoardAwareJigokuBotPolicy.js';
import type { JigokuBotConfig } from './JigokuBotConfig';
import type { BotDecision, BotDecisionInput, BotEngine, BotEngineDecisionTrace } from './BotEngine';

export function createV1Policy(config: JigokuBotConfig): JigokuBotPolicy {
    const seed = config.seed || 1;
    const isBoardAware = config.policy === 'board-aware' ||
        (config.policy === undefined && (seed === 3 || seed === '3'));
    const isFateAware = config.policy === 'fate-aware' ||
        isBoardAware ||
        (config.policy === undefined && (seed === 1 || seed === '1'));
    const mulliganPolicy = config.mulliganPolicy || 'adaptive';
    const conflictPlanningPolicy = config.conflictPlanningPolicy || 'lookahead';
    return isBoardAware
        ? new BoardAwareJigokuBotPolicy(seed, config.drawBidPolicy, mulliganPolicy, conflictPlanningPolicy)
        : isFateAware
        ? new FateAwareJigokuBotPolicy(seed, config.drawBidPolicy, mulliganPolicy, conflictPlanningPolicy)
        : new JigokuBotPolicy(seed, config.drawBidPolicy, mulliganPolicy, conflictPlanningPolicy);
}

/** Frozen direct wrapper. It has no dependency on V2 modules. */
export default class V1PolicyAdapter implements BotEngine {
    readonly version = 'v1' as const;
    readonly policy: JigokuBotPolicy;
    lastDecisionTrace?: BotEngineDecisionTrace;

    constructor(config: JigokuBotConfig, policy?: JigokuBotPolicy) {
        this.policy = policy || createV1Policy(config);
    }

    get seedState(): number {
        return this.policy.seedState;
    }

    decide(input: BotDecisionInput): BotDecision | null {
        const startedAt = Date.now();
        const decision = this.policy.decide(input.playerState, input.botName, input.context || {});
        this.lastDecisionTrace = {
            engineVersion: 'v1',
            selectedBy: 'v1',
            decision,
            durationMs: Date.now() - startedAt
        };
        return decision;
    }
}
