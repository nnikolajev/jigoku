import type LmStudioClient from './LmStudioClient';
import { RULES_PRIMER } from './rulesPrimer';

export interface ConsultCandidate {
    uuid: string;
    name?: string;
    type?: string;
    side: 'mine' | 'theirs';
    military?: string;
    political?: string;
    fate?: number;
    bowed?: boolean;
    inConflict?: boolean;
}

/**
 * Live consult for ambiguous target prompts: sends a compact game-state
 * summary plus the candidate list and expects `{"uuid": "..."}` back. Any
 * answer that is not one of the offered candidates counts as no answer, so a
 * hallucinated pick can never produce an illegal command.
 */
class LiveConsultant {
    constructor(private client: LmStudioClient) {}

    async chooseTarget(question: string, state: any, candidates: ConsultCandidate[], timeoutMs: number): Promise<string | null> {
        if(candidates.length === 0) {
            return null;
        }

        const raw = await this.client.chatJson([
            {
                role: 'system',
                content: `${RULES_PRIMER}\n\nYou pick one target for the bot ("mine" = the bot's own cards). Respond with ONLY {"uuid": "<uuid of the chosen candidate>"}.`
            },
            {
                role: 'user',
                content: JSON.stringify({ question: question, state: state, candidates: candidates })
            }
        ], { timeoutMs: timeoutMs });

        const uuid = raw?.uuid;
        return candidates.some((candidate) => candidate.uuid === uuid) ? uuid : null;
    }
}

export default LiveConsultant;
