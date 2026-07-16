import type LmStudioClient from './LmStudioClient';
import { RULES_PRIMER } from './rulesPrimer';

export interface ActionOption {
    id: string;
    label: string;
}

export interface ActionRequest {
    // Prompt titles the bot is currently answering.
    question: string;
    // Compact game-state summary (phase, round, conflict, honor/fate, provinces).
    state: any;
    // The bot's hand with printed text so the model can reason about plays.
    hand: any[];
    // Visible board: the bot's and the opponent's characters and the rings.
    board: any;
    // Every legal move at this step, already validated by the controller. The
    // model must pick exactly one of these by its id.
    options: ActionOption[];
}

/**
 * The "seed 3" brain: instead of the hand-written heuristics choosing the move,
 * the whole legal move set for the current step is handed to the local LLM with
 * the full visible game state, and the model picks which one to execute. The
 * controller validates every option before offering it and keeps the heuristic
 * pick in the list as a labelled fall-back, so a hallucinated or missing answer
 * can never produce an illegal command — it just resolves to the heuristic.
 *
 * One call = one click. Multi-step plays (choose card, then its target, then a
 * mode button) are separate steps, so the model is consulted at every single
 * decision the bot makes, exactly like a human clicking through the prompts.
 */
class LlmActionPlanner {
    constructor(private client: LmStudioClient) {}

    async chooseAction(request: ActionRequest, timeoutMs: number): Promise<{ optionId: string; reason?: string } | null> {
        if(!request.options || request.options.length === 0) {
            return null;
        }

        const system = `${RULES_PRIMER}

You are piloting one seat in a game of Legend of the Five Rings (the bot). In "state" and "board", "mine" / "bot" is you and "opponent" is your enemy. You win by breaking the opponent's stronghold province after 3 outer provinces are broken, by honor (reach 25) or by making the opponent's honor hit 0; you lose the same ways. After 3 outer provinces are broken, always attack and try to break the stronghold; breaking the fourth outer province is pointless. Deploy characters cheaply, attack to break provinces, defend only what matters, and spend cards and fate to swing the current conflict.

You are given the exact list of legal moves this step in "options", each with a numeric "id" and a human "label". Every legal move is already in that list — you MUST pick one of them and never invent a card, target, or id. Think about what the chosen card/target actually does using its text in "hand" and the board state, then choose the single best move to win the game. Respond with ONLY a JSON object in this exact schema:
{"option": <the id number of the chosen option>, "reason": "<short justification>"}
Example: {"option": 3, "reason": "attack the weakest province to break it"}. The "option" value must be one of the id numbers shown in "options".`;

        const raw = await this.client.chatJson([
            { role: 'system', content: system },
            {
                role: 'user',
                content: JSON.stringify({
                    question: request.question,
                    state: request.state,
                    hand: request.hand,
                    board: request.board,
                    options: request.options
                })
            }
        ], { timeoutMs: timeoutMs });

        const optionId = this.resolveOptionId(raw, request.options);
        if(!optionId) {
            return null;
        }
        return { optionId: optionId, reason: typeof raw?.reason === 'string' ? raw.reason : undefined };
    }

    // Map whatever the model returned back to a real option id. Accepts the id
    // directly ("opt3" or 3), a bare index, or an exact label match, so a
    // slightly-off answer from a thinking model still lands on a legal move
    // instead of silently failing to the heuristic.
    private resolveOptionId(raw: any, options: ActionOption[]): string | null {
        if(!raw || typeof raw !== 'object') {
            return null;
        }
        const ids = new Set(options.map((option) => option.id));
        const candidates = [raw.option, raw.optionId, raw.id, raw.index, raw.choice, raw.move, raw.answer];
        for(const value of candidates) {
            if(value === undefined || value === null) {
                continue;
            }
            const text = String(value).trim();
            if(ids.has(text)) {
                return text;
            }
            // Bare number or "3" for id "opt3".
            const digits = text.match(/\d+/);
            if(digits) {
                const byOpt = `opt${digits[0]}`;
                if(ids.has(byOpt)) {
                    return byOpt;
                }
            }
            // Exact label match.
            const byLabel = options.find((option) => option.label === text);
            if(byLabel) {
                return byLabel.id;
            }
        }
        return null;
    }
}

export default LlmActionPlanner;
