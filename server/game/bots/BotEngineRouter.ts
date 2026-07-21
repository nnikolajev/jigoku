import type { JigokuBotConfig } from './JigokuBotConfig';
import type { BotDecision, BotDecisionInput, BotEngine, BotEngineDecisionTrace } from './BotEngine';
import V1PolicyAdapter from './V1PolicyAdapter.js';
import V2BotEngine from './v2/V2BotEngine.js';

export default class BotEngineRouter implements BotEngine {
    readonly version;
    readonly v1: V1PolicyAdapter;
    readonly selected: BotEngine;

    constructor(config: JigokuBotConfig, v1?: V1PolicyAdapter, v2?: BotEngine) {
        this.v1 = v1 || new V1PolicyAdapter(config);
        this.selected = config.engineVersion === 'v2'
            ? (v2 || new V2BotEngine(this.v1, config))
            : this.v1;
        this.version = this.selected.version;
    }

    get seedState(): number {
        return this.selected.seedState;
    }

    get lastDecisionTrace(): BotEngineDecisionTrace | undefined {
        return this.selected.lastDecisionTrace;
    }

    decide(input: BotDecisionInput): BotDecision | null {
        return this.selected.decide(input);
    }

    observeDecision(result: 'success' | 'rejected' | 'unsupported', reason: string): void {
        this.selected.observeDecision?.(result, reason);
    }
}
