import { z } from 'zod';

const parsedEnv = z
    .object({
        CAPTCHA_KEY: z.string().optional(),
        COOKIE_LIFETIME: z.string().optional(),
        DB_PATH: z.string(),
        DOMAIN: z.string(),
        EMAIL_PATH: z.string().optional(),
        ENVIRONMENT: z.string(),
        GAME_NODE_CERT_PATH: z.string().optional(),
        GAME_NODE_KEY_PATH: z.string().optional(),
        GAME_NODE_NAME: z.string(),
        GAME_NODE_PROXY_PORT: z.coerce.number().int().optional(),
        GAME_NODE_SOCKET_IO_PORT: z.coerce.number().int(),
        HMAC_SECRET: z.string().optional(),
        HTTPS: z.string(),
        LOBBY_PORT: z.coerce.number().int(),
        MAX_GAMES: z.coerce.number().int().optional(),
        LOBBY_WS_URL: z.string(),
        SECRET: z.string(),
        SENTRY_DSN: z.string().optional(),
        BUILD_VERSION: z.string().optional(),
        BOT_LLM_ENABLED: z.string().optional(),
        BOT_LLM_BASE_URL: z.string().optional(),
        BOT_LLM_MODEL: z.string().optional(),
        BOT_LLM_LIVE_CONSULT: z.string().optional(),
        BOT_LLM_CONSULT_TIMEOUT_MS: z.coerce.number().int().optional()
    })
    .safeParse(process.env);

if(!parsedEnv.success) {
    throw Error(`Failed to initialize environment variables: ${(parsedEnv as any).error.message}`);
}

export const captchaKey = parsedEnv.data.CAPTCHA_KEY;
export const cookieLifetime = parsedEnv.data.COOKIE_LIFETIME;
export const dbPath = parsedEnv.data.DB_PATH;
export const domain = parsedEnv.data.DOMAIN;
export const emailPath = parsedEnv.data.EMAIL_PATH;
export const environment = parsedEnv.data.ENVIRONMENT;
export const gameNodeCertPath = parsedEnv.data.GAME_NODE_CERT_PATH;
export const gameNodeKeyPath = parsedEnv.data.GAME_NODE_KEY_PATH;
export const gameNodeName = parsedEnv.data.GAME_NODE_NAME;
export const gameNodeProxyPort = parsedEnv.data.GAME_NODE_PROXY_PORT;
export const gameNodeSocketIoPort = parsedEnv.data.GAME_NODE_SOCKET_IO_PORT;
export const hmacSecret = parsedEnv.data.HMAC_SECRET;
export const https = parsedEnv.data.HTTPS;
export const lobbyPort = parsedEnv.data.LOBBY_PORT;
export const maxGames = parsedEnv.data.MAX_GAMES;
export const lobbyWsUrl = parsedEnv.data.LOBBY_WS_URL;
export const secret = parsedEnv.data.SECRET;
export const sentryDsn = parsedEnv.data.SENTRY_DSN;
export const buildVersion = parsedEnv.data.BUILD_VERSION ?? 'LOCAL';

// Default bot LLM config (LM Studio). Enabled by default — an unreachable
// server just posts one warning and the bot falls back to pure heuristics.
// Override with BOT_LLM_ENABLED=false / BOT_LLM_BASE_URL / BOT_LLM_MODEL /
// BOT_LLM_LIVE_CONSULT=false / BOT_LLM_CONSULT_TIMEOUT_MS.
export const botLlm = {
    enabled: parsedEnv.data.BOT_LLM_ENABLED !== 'false',
    baseUrl: parsedEnv.data.BOT_LLM_BASE_URL || 'http://localhost:1234',
    model: parsedEnv.data.BOT_LLM_MODEL || 'qwen/qwen3.5-9b',
    liveConsult: parsedEnv.data.BOT_LLM_LIVE_CONSULT !== 'false',
    consultTimeoutMs: parsedEnv.data.BOT_LLM_CONSULT_TIMEOUT_MS || 120000
};
