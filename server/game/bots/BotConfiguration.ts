import { createHash } from 'crypto';
import type { BotEngineVersion, BotInformationMode, BotTraceLevel } from './BotEngine';
import type { JigokuBotConfig } from './JigokuBotConfig';

export interface ResolvedBotIdentity {
    readonly engineVersion: BotEngineVersion;
    readonly strategySeed: string | number;
    readonly informationMode: BotInformationMode;
    readonly deckProfile: string;
    readonly traceLevel: BotTraceLevel;
    readonly configurationHash: string;
}

function stableValue(value: any): any {
    if(Array.isArray(value)) {
        return value.map(stableValue);
    }
    if(value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
}

export function stableConfigurationHash(value: any): string {
    return createHash('sha256')
        .update(JSON.stringify(stableValue(value)))
        .digest('hex')
        .slice(0, 16);
}

export function resolveBotIdentity(config: JigokuBotConfig): ResolvedBotIdentity {
    const engineVersion = config.engineVersion === 'v2' ? 'v2' : 'v1';
    const strategySeed = config.seed ?? 1;
    const informationMode = config.omniscient === true ? 'omniscient' : 'fair';
    const deckProfile = config.deckProfileId || config.deckId || 'auto';
    const traceLevel = config.traceLevel || 'production';
    const hashInput = {
        engineVersion,
        strategySeed,
        informationMode,
        deckProfile,
        traceLevel,
        policy: config.policy || 'seed-default',
        drawBidPolicy: config.drawBidPolicy || 'adaptive',
        mulliganPolicy: config.mulliganPolicy || 'adaptive',
        conflictPlanningPolicy: config.conflictPlanningPolicy || 'lookahead',
        v2Mode: config.v2Mode || 'pass-through',
        experiments: config.experiments || {}
    };
    return {
        engineVersion,
        strategySeed,
        informationMode,
        deckProfile,
        traceLevel,
        configurationHash: stableConfigurationHash(hashInput)
    };
}
