import type { BotDecision } from '../../BotEngine';
import type { BotActionCandidate, CandidateVeto } from '../model/Candidate';
import type { UtilityVector } from '../model/Utility';
import type { PlanningState } from '../model/PlanningState';
import type { RootSearchEvaluation, SearchTraceNode } from '../search/TacticalSearch';

export type V2DisagreementType =
    | 'agreement'
    | 'proven-v2-improvement'
    | 'likely-improvement'
    | 'uncertain'
    | 'v1-preferred'
    | 'semantic-gap'
    | 'scoring-gap';

export interface V2CandidateTrace {
    readonly id: string;
    readonly kind: string;
    readonly proposer: string;
    readonly command: string;
    readonly target?: string;
    readonly cardId?: string;
    readonly effectKinds?: readonly string[];
    readonly tags?: readonly string[];
    readonly costs?: BotActionCandidate['costs'];
    readonly targets?: BotActionCandidate['targets'];
    readonly confidence: number;
    readonly uncertainty: number;
    readonly vetoes: readonly CandidateVeto[];
    readonly score?: number;
    readonly terminalRank?: number;
    readonly scoreVector?: UtilityVector;
    readonly explanation?: readonly string[];
}

export interface V2PlannerTrace {
    readonly traceVersion: 1;
    readonly mode: string;
    readonly traceLevel?: 'production' | 'benchmark' | 'research';
    readonly stateSignature?: string;
    readonly promptFingerprint?: string;
    readonly intentId?: string;
    readonly intentObjective?: string;
    readonly intentRetained?: boolean;
    readonly intentInvalidation?: string;
    readonly candidateCount: number;
    readonly candidates?: readonly V2CandidateTrace[];
    readonly v2PreferenceId?: string;
    readonly chosenCandidateId?: string;
    readonly runnerUpCandidateId?: string;
    readonly runnerUpGap?: number;
    readonly v2Preference?: BotDecision | null;
    readonly v1Action: BotDecision | null;
    readonly disagreementType: V2DisagreementType;
    readonly scoreGap?: number;
    readonly confidence?: number;
    readonly principalLine?: readonly {
        readonly ply: number;
        readonly actorId: string;
        readonly candidateId: string;
        readonly candidateKind: string;
        readonly score: number;
        readonly stateSignature: string;
    }[];
    readonly searchUtility?: number;
    readonly prunedCandidates?: number;
    readonly searchNodes?: readonly SearchTraceNode[];
    readonly rootEvaluations?: readonly RootSearchEvaluation[];
    readonly information?: {
        readonly mode: 'fair' | 'omniscient';
        readonly certainty: number;
        readonly handHypotheses: number;
        readonly provinceHypotheses: number;
        readonly responsePackages: number;
        readonly details: Readonly<Record<string, unknown>>;
    };
    readonly terminal?: {
        readonly active: boolean;
        readonly reasons: readonly string[];
        readonly exact: boolean;
        readonly aggregation: string;
        readonly selectedCandidateId?: string;
        readonly status?: string;
        readonly terminalRank?: number;
        readonly expected?: number;
        readonly pessimistic?: number;
        readonly optimistic?: number;
        readonly searchedBranches: number;
        readonly principalLine: readonly string[];
    };
    readonly synergy?: {
        readonly profileIds: readonly string[];
        readonly fateReserve: number;
        readonly conflictCardReserve: number;
        readonly activations: readonly {
            readonly profileId: string;
            readonly edgeId: string;
            readonly candidateId: string;
            readonly role: string;
            readonly rationale: string;
        }[];
    };
    readonly fallbackReason?: string;
    readonly budget: {
        readonly generated: number;
        readonly vetoed: number;
        readonly scored: number;
        readonly searchedNodes: number;
        readonly exhausted: boolean;
    };
    readonly macroProgress?: unknown;
    readonly replay?: {
        readonly planningState: PlanningState;
        readonly candidateIds: readonly string[];
        readonly configuration: Readonly<Record<string, unknown>>;
    };
    readonly acceptance?: 'success' | 'rejected' | 'unsupported';
    readonly acceptanceReason?: string;
    readonly outcome?: {
        readonly status: 'realized' | 'not-realized' | 'pending' | 'unknown';
        readonly realizedEffectKinds: readonly string[];
        readonly expectedEffectKinds: readonly string[];
        readonly reason: string;
        readonly previousStateSignature?: string;
        readonly observedStateSignature?: string;
        readonly materialStateChanged?: boolean;
    };
}
