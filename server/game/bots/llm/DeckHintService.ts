import * as fs from 'fs';
import * as path from 'path';
import type LmStudioClient from './LmStudioClient';
import { CardHint, validateCardHint } from './CardHints';
import { RULES_PRIMER } from './rulesPrimer';

export interface AnalyzableCard {
    id: string;
    name: string;
    type: string;
    text?: string;
    cost?: number | string;
    military?: number | string;
    political?: number | string;
    militaryBonus?: string;
    politicalBonus?: string;
    strength?: number | string;
    element?: string | string[];
}

const ANALYSIS_INSTRUCTIONS = `Analyze the following card for the bot. Respond with ONLY a JSON object, no prose:
{"useWhen": "always|losing|winning|attacked|never", "conflictTypes": ["military","political"], "targetSide": "self|enemy|either|none", "targetPreference": "strongest|weakest|most-fate|any", "priority": 0-10, "summary": "one short sentence on how the bot should use this card"}`;

export interface AnalysisStats {
    total: number;
    fromCache: number;
    analyzed: number;
    skipped: number;
    stopped: boolean;
}

/**
 * Pre-game deck analysis: asks the LLM for one CardHint per unique card and
 * caches the answers on disk keyed by card id + model, so repeat games with
 * the same cards never hit the model again. Analysis is fire-and-forget; the
 * hint table fills in progressively and the policy simply plays better as
 * hints arrive.
 */
class DeckHintService {
    private hints = new Map<string, CardHint>();
    private warned = false;
    private cacheDir: string;

    constructor(private client: LmStudioClient, options: { cacheDir?: string; onWarn?: (message: string) => void } = {}) {
        const modelKey = this.client.model.replace(/[^a-zA-Z0-9._-]+/g, '_');
        this.cacheDir = options.cacheDir || path.join(process.cwd(), '.bot-hints', modelKey);
        this.onWarn = options.onWarn;
    }

    private onWarn?: (message: string) => void;

    getHint(cardId: string): CardHint | undefined {
        return this.hints.get(cardId);
    }

    get hintCount(): number {
        return this.hints.size;
    }

    /**
     * Loads everything available from the per-card disk cache and returns
     * what would still need a model round trip. Cheap and synchronous —
     * callers use it to report honest progress before starting analysis.
     */
    prepare(cards: AnalyzableCard[]): { total: number; cached: number; pending: AnalyzableCard[] } {
        const seen = new Set<string>();
        const pending: AnalyzableCard[] = [];
        let total = 0;
        let cached = 0;
        for(const card of cards) {
            if(!card?.id || seen.has(card.id)) {
                continue;
            }
            seen.add(card.id);
            total++;

            if(this.hints.has(card.id)) {
                cached++;
                continue;
            }

            const fromDisk = this.readCache(card.id);
            if(fromDisk) {
                this.hints.set(card.id, fromDisk);
                cached++;
            } else {
                pending.push(card);
            }
        }
        return { total, cached, pending };
    }

    async analyzeCards(cards: AnalyzableCard[], deckKey?: string): Promise<AnalysisStats> {
        const prep = this.prepare(cards);
        const stats: AnalysisStats = { total: prep.total, fromCache: prep.cached, analyzed: 0, skipped: 0, stopped: false };

        // Sequential on purpose: a local model serves one request at a time.
        for(const card of prep.pending) {
            try {
                // Generous budget and timeout: reasoning models can spend
                // minutes thinking per card, and this runs in the background.
                const raw = await this.client.chatJson([
                    { role: 'system', content: `${RULES_PRIMER}\n\n${ANALYSIS_INSTRUCTIONS}` },
                    { role: 'user', content: JSON.stringify(card) }
                ], { timeoutMs: 300000 });
                const hint = validateCardHint(raw, card.id);
                if(hint) {
                    this.hints.set(card.id, hint);
                    this.writeCache(card.id, hint);
                    stats.analyzed++;
                } else {
                    stats.skipped++;
                }
            } catch(err: any) {
                if(err instanceof SyntaxError) {
                    // Malformed answer for one card: skip it, keep analyzing.
                    stats.skipped++;
                    continue;
                }
                // Network/HTTP/timeout: the service is down, stop the run.
                stats.stopped = true;
                this.warnOnce(err?.message || String(err));
                return stats;
            }
        }

        // Record a completed deck so future games skip straight to the cache.
        if(deckKey && !stats.stopped) {
            this.writeDeckManifest(deckKey, cards);
        }
        return stats;
    }

    /**
     * A deck manifest marks an import URL / deck id as fully analyzed. When
     * present and every listed card is in the per-card cache, the whole deck
     * loads without any model traffic.
     */
    hasCompleteDeck(deckKey: string, cards: AnalyzableCard[]): boolean {
        if(!deckKey) {
            return false;
        }
        try {
            const manifest = JSON.parse(fs.readFileSync(this.deckManifestPath(deckKey), 'utf8'));
            const known = new Set(Array.isArray(manifest?.cardIds) ? manifest.cardIds : []);
            const required = cards.filter((card) => card?.id).map((card) => card.id);
            if(!required.every((id) => known.has(id))) {
                return false;
            }
            return this.prepare(cards).pending.length === 0;
        } catch{
            return false;
        }
    }

    private writeDeckManifest(deckKey: string, cards: AnalyzableCard[]): void {
        try {
            fs.mkdirSync(path.dirname(this.deckManifestPath(deckKey)), { recursive: true });
            fs.writeFileSync(this.deckManifestPath(deckKey), JSON.stringify({
                deckKey: deckKey,
                cardIds: [...new Set(cards.filter((card) => card?.id).map((card) => card.id))],
                completedAt: new Date().toISOString()
            }, null, 2));
        } catch{
            // Manifest write failure is non-fatal; per-card cache still works.
        }
    }

    private deckManifestPath(deckKey: string): string {
        return path.join(this.cacheDir, 'decks', `${deckKey.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`);
    }

    private warnOnce(detail: string): void {
        if(this.warned) {
            return;
        }
        this.warned = true;
        if(this.onWarn) {
            this.onWarn(`LM Studio unavailable (${detail}) — the bot falls back to built-in heuristics for unanalyzed cards`);
        }
    }

    private cachePath(cardId: string): string {
        return path.join(this.cacheDir, `${cardId.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`);
    }

    private readCache(cardId: string): CardHint | null {
        try {
            const raw = JSON.parse(fs.readFileSync(this.cachePath(cardId), 'utf8'));
            return validateCardHint(raw, cardId);
        } catch{
            return null;
        }
    }

    private writeCache(cardId: string, hint: CardHint): void {
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.cachePath(cardId), JSON.stringify(hint, null, 2));
        } catch{
            // Cache write failure is non-fatal; the hint still lives in memory.
        }
    }
}

export default DeckHintService;
