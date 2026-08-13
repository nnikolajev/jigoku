/**
 * Resolves the four INDEPENDENT axes of a bot seat into one identity, and
 * hashes it.
 *
 * Engine version, strategy seed, information mode and deck profile vary
 * separately — an omniscient seed-3 V1 bot on the Crab profile is a different
 * opponent from a fair seed-3 V1 bot on the same profile. Benchmarks are keyed
 * by all four, so `configurationHash` (a stable, key-order-independent SHA-256
 * prefix) is what lets a recorded win rate be matched to the bot that produced
 * it. Change any axis and the hash changes, which is the point: a stale
 * benchmark stops matching instead of silently mislabelling the new bot.
 */
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
