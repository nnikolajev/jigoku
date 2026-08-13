// Decides whether a prompt is worth searching at all.
//
// Search is the most expensive thing V2 does and is worthless on the many
// prompts with one sensible answer, so this gate runs first.
import type { PlanningEligibilityResult } from '../PlanningEligibility';
import type { BotActionCandidate } from '../model/Candidate';
import type { PlanningState } from '../model/PlanningState';
import type { TacticalSearchLimits } from './TacticalSearch';
import { immutable } from '../model/Stable';

export interface TacticalSearchEligibilityResult {
    readonly eligible: boolean;
    readonly reason: string;
    readonly candidates: readonly BotActionCandidate[];
    readonly limits: Partial<TacticalSearchLimits>;
}

const LIVE_KINDS = new Set([
    'pass', 'conflict-card', 'in-play-ability', 'reaction', 'interrupt'
]);

const TARGETED_EFFECTS = new Set(['skill', 'bow', 'ready', 'move', 'status', 'remove', 'attachment']);

function projectable(candidate: BotActionCandidate): boolean {
    // Pass has no effect descriptor by definition, but it is an exact action
    // and is required for alternating-priority / consecutive-pass search.
    if(candidate.kind === 'pass') return candidate.commandPreview.command === 'menuButton';
    return candidate.effects.length > 0 && candidate.effects.every((effect) =>
        !effect.conditional && (effect.confidence ?? 1) >= 0.8 &&
        (!TARGETED_EFFECTS.has(effect.kind) || !!effect.target || candidate.targets.length > 0));
}

/** Restricts live search to small, semantic, actual-action conflict positions. */
export default class TacticalSearchEligibility {
    evaluate(state: PlanningState, planning: PlanningEligibilityResult,
        candidates: readonly BotActionCandidate[], responseCandidates: readonly BotActionCandidate[],
        mode: string): TacticalSearchEligibilityResult {
        // Response packages are searched as separate coherent scenarios. A
        // wider root beam and generous aggregate budget favor decision quality;
        // the time ceiling exists only to protect the click controller.
        const limits = { depth: 4, beamWidth: 8, maxCandidates: 8, nodeBudget: 12288, elapsedMs: 10000 };
        if(mode === 'shadow') return immutable({ eligible: true, reason: 'shadow-research', candidates, limits });
        if(!planning.eligible || planning.promptClass !== 'conflict' || !state.conflict ||
            planning.reason !== 'source-action-window') {
            return immutable({ eligible: false, reason: 'not-conflict-action-position', candidates: [], limits });
        }
        const live = candidates.filter((candidate) => LIVE_KINDS.has(candidate.kind) &&
            (candidate.kind === 'pass' || candidate.confidence >= 0.9 && projectable(candidate)));
        const semantic = live.filter((candidate) => candidate.kind !== 'pass');
        if(semantic.length === 0) {
            return immutable({ eligible: false, reason: 'no-high-confidence-semantic-action', candidates: [], limits });
        }
        // Root breadth is safely narrowed by TacticalSearch.prescore using the
        // deterministic beam/max-candidate limits below. Rejecting the whole
        // position hid exact semantic actions whenever the UI exposed several
        // irrelevant legal sources.
        // Fair-information candidate confidence is the hypothesis weight, not
        // the reliability of the effect descriptor. Search treats every
        // retained response adversarially, so a low-probability but exactly
        // projected pump is safe to include. Effect-level uncertainty still
        // rejects approximate removal/status models below projectable().
        if(responseCandidates.some((candidate) => !projectable(candidate))) {
            return immutable({ eligible: false, reason: 'unprojectable-response', candidates: [], limits });
        }
        return immutable({
            eligible: true,
            reason: live.length > limits.maxCandidates!
                ? 'bounded-root-preselection'
                : responseCandidates.length > 0 ? 'bounded-semantic-response-search' : 'bounded-semantic-search',
            candidates: live,
            limits
        });
    }
}
