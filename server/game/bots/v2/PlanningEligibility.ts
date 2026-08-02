import type { BotDecisionInput } from '../BotEngine';

export interface PlanningEligibilityResult {
    readonly eligible: boolean;
    readonly reason: string;
    readonly promptClass: 'macro' | 'conflict' | 'dynasty' | 'mechanical' | 'unsupported';
    readonly terminalRisk: boolean;
}

function numeric(value: any, fallback: number): number {
    const parsed = Number(value?.stat ?? value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** Cheap raw-state guard. False means V1 can answer without building V2 projections. */
export default class PlanningEligibility {
    evaluate(input: BotDecisionInput, mode: string, hasActiveMacro: boolean): PlanningEligibilityResult {
        if(mode === 'shadow') return { eligible: true, reason: 'shadow-observation', promptClass: 'conflict', terminalRisk: false };
        if(hasActiveMacro) return { eligible: true, reason: 'macro-continuation', promptClass: 'macro', terminalRisk: false };

        const state = input.playerState || {};
        const players = state.players || {};
        const botName = input.botName || Object.keys(players).find((name) => players[name]?.promptTitle) || Object.keys(players)[0];
        const me = players[botName] || {};
        const title = String(me.promptTitle || '');
        const menu = String(me.menuTitle || '');
        const prompt = `${title} ${menu}`.toLowerCase();
        const phase = String(me.phase || state.phase || input.context?.phase || '').toLowerCase();
        const conflict = state.conflict || state.currentConflict || input.context?.conflict;
        const conflictDeck = me.cardPiles?.conflictDeck;
        const conflictDeckSize = Array.isArray(conflictDeck) ? conflictDeck.length : numeric(conflictDeck?.size ?? conflictDeck?.count, 99);
        const honor = numeric(me.stats?.honor ?? me.honor, 10);
        const terminalRisk = conflict?.provinceLocation === 'stronghold province' ||
            conflict?.province?.location === 'stronghold province' || honor <= 2 || conflictDeckSize <= 1;

        if(/honor bid|mulligan|discard|setup|choose additional fate|choose fate|select stronghold province/.test(prompt)) {
            return { eligible: false, reason: 'mechanical-prompt', promptClass: 'mechanical', terminalRisk };
        }
        if(/choose (?:a |an )?(?:target|character|card|attachment|player)|select (?:a |an )?(?:target|character|card|attachment)/.test(prompt)) {
            return { eligible: false, reason: 'unowned-prompt-continuation', promptClass: 'mechanical', terminalRisk };
        }
        if(/triggered abilities|(?:any|choose|select).*?(?:reactions?|interrupts?|abilities?)|(?:reaction|interrupt|action) window|initiate an action|choose an action/.test(prompt)) {
            return {
                eligible: true,
                reason: 'source-action-window',
                promptClass: phase === 'dynasty' ? 'dynasty' : 'conflict',
                terminalRisk
            };
        }
        if(/conflict action|choose attackers?|choose defenders?|choose ring|declare.*conflict|choose.*province.*attack|conflict opportunity/.test(prompt)) {
            return { eligible: true, reason: terminalRisk ? 'terminal-conflict' : 'conflict-decision', promptClass: 'conflict', terminalRisk };
        }
        if(phase === 'dynasty' && /play cards from provinces|dynasty action/.test(prompt)) {
            return { eligible: true, reason: 'dynasty-resource-decision', promptClass: 'dynasty', terminalRisk };
        }
        return { eligible: false, reason: 'non-tactical-prompt', promptClass: 'unsupported', terminalRisk };
    }
}
