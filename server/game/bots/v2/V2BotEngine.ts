import type { BotDecision, BotDecisionInput, BotEngine, BotEngineDecisionTrace } from '../BotEngine';
import type { JigokuBotConfig } from '../JigokuBotConfig';
import CandidateRegistry from './CandidateRegistry.js';
import IntentManager from './IntentManager.js';
import PerspectiveSnapshotBuilder from './PerspectiveSnapshotBuilder.js';
import PlanningEligibility, { type PlanningEligibilityResult } from './PlanningEligibility.js';
import ProjectionCache from './ProjectionCache.js';
import SafetyVetoPipeline from './SafetyVetoPipeline.js';
import UtilityEvaluator, { compareScored } from './UtilityEvaluator.js';
import CardSemanticRegistry from './cards/CardSemantics.js';
import { REPRESENTATIVE_SEMANTICS } from './cards/GenericSemantics.js';
import { DECK_SEMANTICS } from './cards/DeckSemantics.js';
import SemanticActionPlanner from './cards/SemanticActionPlanner.js';
import DeckSynergyContributor, { type DeckSynergyContribution } from './cards/DeckSynergies.js';
import TacticalSearch, { type TacticalSearchResult } from './search/TacticalSearch.js';
import TacticalSearchEligibility from './search/TacticalSearchEligibility.js';
import ResourcePackagePlanner from './resources/ResourcePackagePlanner.js';
import DynastyPackageLedger from './resources/DynastyPackageLedger.js';
import FairInformationProvider from './information/FairInformationProvider.js';
import ExactInformationProvider from './information/ExactInformationProvider.js';
import { publicEvidenceFromPlayerState } from './information/PublicEvidence.js';
import type { OpponentInformationSnapshot } from './information/OpponentInformationProvider';
import TerminalSolver, { type TerminalSolverResult } from './terminal/TerminalSolver.js';
import type { BotActionCandidate, CandidateVeto } from './model/Candidate';
import type { PlanningLedgers } from './model/Ledgers';
import type { PlanningState } from './model/PlanningState';
import type { SemanticMacroStep } from './model/Macro';
import type { ScoredUtility } from './model/Utility';
import { stableHash } from './model/Stable';
import type { V2CandidateTrace, V2DisagreementType, V2PlannerTrace } from './tracing/V2Trace';
import PlannerProfiler, { type V2PlannerProfilingTrace } from './tracing/PlannerProfiler.js';
import HighConfidenceOverridePolicy, { type OverrideProof } from './HighConfidenceOverridePolicy.js';
import ParticipantSetPlanner from './allocation/ParticipantSetPlanner.js';
import AttackerSetPlanner from './allocation/AttackerSetPlanner.js';

interface ScoredCandidate {
    readonly candidate: BotActionCandidate;
    readonly score: ScoredUtility;
}

export interface V2BotEngineDependencies {
    readonly candidateRegistry?: CandidateRegistry;
}

function sameCommand(candidate: BotActionCandidate, decision: BotDecision | null): boolean {
    return !!decision && candidate.commandPreview.command === decision.command &&
        JSON.stringify(candidate.commandPreview.args) === JSON.stringify(decision.args);
}

export interface V1CandidateReference {
    readonly candidate?: BotActionCandidate;
    readonly ambiguous: boolean;
    readonly nativeMatches: readonly BotActionCandidate[];
}

/**
 * A source click can represent several different macros (notably dynasty
 * additional-fate choices). Do not pretend V1 chose an arbitrary variant
 * before its follow-up prompt has occurred.
 */
export function resolveV1CandidateReference(candidates: readonly BotActionCandidate[],
    decision: BotDecision | null): V1CandidateReference {
    const nativeMatches = candidates.filter((candidate) =>
        candidate.kind !== 'v1-fallback' && sameCommand(candidate, decision));
    if(nativeMatches.length === 1) return { candidate: nativeMatches[0], ambiguous: false, nativeMatches };
    if(nativeMatches.length > 1) {
        return {
            candidate: candidates.find((candidate) => candidate.kind === 'v1-fallback' && sameCommand(candidate, decision)),
            ambiguous: true,
            nativeMatches
        };
    }
    return {
        candidate: candidates.find((candidate) => candidate.kind === 'v1-fallback' && sameCommand(candidate, decision)),
        ambiguous: false,
        nativeMatches
    };
}

function candidateDecision(candidate: BotActionCandidate): BotDecision {
    if(candidate.fallbackDecision) return candidate.fallbackDecision;
    return {
        command: candidate.commandPreview.command,
        args: [...candidate.commandPreview.args],
        target: candidate.commandPreview.target,
        cardId: candidate.source?.cardId,
        cardLocation: candidate.source?.location,
        reason: `v2-${candidate.kind}-${candidate.proposer}`
    };
}

/** V2 orchestration never mutates live rules state; it returns one normal command. */
export default class V2BotEngine implements BotEngine {
    readonly version = 'v2' as const;
    lastDecisionTrace?: BotEngineDecisionTrace;
    private readonly mode;
    private readonly snapshotBuilder = new PerspectiveSnapshotBuilder();
    private readonly planningEligibility = new PlanningEligibility();
    private readonly projectionCache = new ProjectionCache();
    private readonly intentManager = new IntentManager();
    private readonly candidateRegistry: CandidateRegistry;
    private readonly cardSemantics = new CardSemanticRegistry([...REPRESENTATIVE_SEMANTICS, ...DECK_SEMANTICS]);
    private readonly semanticActionPlanner = new SemanticActionPlanner(this.cardSemantics);
    private readonly participantSetPlanner = new ParticipantSetPlanner();
    private readonly attackerSetPlanner = new AttackerSetPlanner();
    private readonly deckSynergies = new DeckSynergyContributor(this.cardSemantics);
    private readonly safety = new SafetyVetoPipeline();
    private readonly utility = new UtilityEvaluator();
    private readonly tacticalSearch = new TacticalSearch();
    private readonly tacticalSearchEligibility = new TacticalSearchEligibility();
    private readonly resourcePlanner = new ResourcePackagePlanner();
    private readonly dynastyPackageLedger = new DynastyPackageLedger();
    private readonly fairInformation = new FairInformationProvider();
    private readonly exactInformation = new ExactInformationProvider();
    private readonly terminalSolver = new TerminalSolver();
    private readonly overridePolicy = new HighConfidenceOverridePolicy();
    private previousLedgers?: PlanningLedgers;
    private currentExpectedEffectKinds: readonly string[] = [];
    private readonly failedMacroStartSignatures = new Map<string, string>();
    private pendingOutcome?: {
        readonly planner: V2PlannerTrace;
        readonly previousStateSignature?: string;
        readonly expectedEffectKinds: readonly string[];
    };

    constructor(private readonly fallback: BotEngine, private readonly config: JigokuBotConfig = { playerName: 'Jigoku Bot' },
        dependencies: V2BotEngineDependencies = {}) {
        this.mode = config.v2Mode || 'pass-through';
        this.candidateRegistry = dependencies.candidateRegistry || new CandidateRegistry();
    }

    get seedState(): number {
        return this.fallback.seedState;
    }

    observeDecision(result: 'success' | 'rejected' | 'unsupported', reason: string): void {
        if(!this.lastDecisionTrace) return;
        const planner = this.lastDecisionTrace.planner as V2PlannerTrace | undefined;
        const updatedPlanner = planner ? { ...planner, acceptance: result, acceptanceReason: reason } : undefined;
        if(updatedPlanner && result === 'success') {
            this.pendingOutcome = {
                planner: updatedPlanner,
                previousStateSignature: updatedPlanner.stateSignature,
                expectedEffectKinds: this.currentExpectedEffectKinds
            };
        } else if(updatedPlanner) {
            (updatedPlanner as any).outcome = {
                status: 'not-realized',
                realizedEffectKinds: [],
                expectedEffectKinds: this.currentExpectedEffectKinds,
                reason,
                previousStateSignature: updatedPlanner.stateSignature,
                observedStateSignature: updatedPlanner.stateSignature,
                materialStateChanged: false
            };
            this.pendingOutcome = undefined;
        }
        this.lastDecisionTrace = {
            ...this.lastDecisionTrace,
            acceptance: result,
            planner: updatedPlanner
        };
        if(result === 'rejected') {
            this.intentManager.invalidate('command-rejected');
            this.dynastyPackageLedger.abandon();
        }
    }

    decide(input: BotDecisionInput): BotDecision | null {
        const startedAt = Date.now();
        const profiler = new PlannerProfiler();
        this.currentExpectedEffectKinds = [];
        // V1 is evaluated exactly once and remains deterministic per decision.
        const v1Decision = profiler.measure('v1-fallback', () => this.fallback.decide(input));
        if(this.mode === 'pass-through') {
            this.lastDecisionTrace = {
                engineVersion: 'v2', selectedBy: 'fallback', fallbackReason: 'v2-pass-through',
                decision: v1Decision, durationMs: Date.now() - startedAt, v2Mode: this.mode
            };
            return v1Decision;
        }

        const eligibility = profiler.measure('eligibility', () =>
            this.planningEligibility.evaluate(input, this.mode, this.intentManager.hasActiveMacro));
        if(this.mode === 'enabled' && !eligibility.eligible) {
            const fallbackReason = `planning-ineligible:${eligibility.reason}`;
            this.lastDecisionTrace = {
                engineVersion: 'v2', selectedBy: 'fallback', fallbackReason,
                decision: v1Decision, durationMs: Date.now() - startedAt, v2Mode: this.mode,
                planner: this.cheapFallbackTrace(v1Decision, fallbackReason, profiler.trace(), eligibility)
            };
            return v1Decision;
        }

        try {
            const state = profiler.measure('snapshot', () => this.snapshotBuilder.build(input, {
                informationMode: this.config.omniscient === true ? 'omniscient' : 'fair',
                previousLedgers: this.previousLedgers,
                roundId: String(input.context?.roundNumber ?? 'round:0'),
                conflictId: input.context?.conflictId
            }));
            this.finalizePendingOutcome(state.materialStateSignature);
            for(const [macroId, signature] of this.failedMacroStartSignatures) {
                if(signature !== state.materialStateSignature) this.failedMacroStartSignatures.delete(macroId);
            }
            this.previousLedgers = state.ledgers;
            const collection = profiler.measure('candidate-collection', () =>
                this.candidateRegistry.collect({ input, state, v1Decision }));
            const semanticCandidates = profiler.measure('card-semantics', () => {
                const cached = this.projectionCache.getOrCreate('card-semantics', stableHash({
                    state: state.materialStateSignature,
                    ledgers: state.ledgers,
                    candidates: collection.candidates.map((candidate) => candidate.id)
                }), () => this.semanticActionPlanner.expand(state, collection.candidates));
                profiler.recordCache('card-semantics', cached.hit);
                return cached.value;
            });
            const defenderGate = input.context?.profile?.v2?.highConfidenceGate;
            const allowAllDefenderSets = defenderGate?.allowExactDefenderSetOverride === true;
            const allowBreakPreventionSet = defenderGate?.allowExactBreakPreventionSetOverride !== false;
            const synergyContext = {
                deckProfileId: this.config.deckProfileId || this.config.deckId,
                profile: input.context?.profile
            };
            const defenderResponseReserve = {
                ordinary: this.deckSynergies.defenderResponseReserve(synergyContext),
                stronghold: 3
            };
            const defenderCandidates = allowAllDefenderSets || allowBreakPreventionSet
                ? this.participantSetPlanner.expand(state, semanticCandidates, {
                    includeConflictWin: allowAllDefenderSets,
                    includeCostNeutralConflictWin: true,
                    includeNoDefense: allowAllDefenderSets,
                    responseReserve: defenderResponseReserve,
                    futureValueBonuses: this.deckSynergies.defenderFutureValueBonuses(synergyContext)
                })
                : semanticCandidates;
            const participantCandidates = this.attackerSetPlanner.expand(state, defenderCandidates);
            const synergy = profiler.measure('deck-synergy', () =>
                this.deckSynergies.contribute(state, participantCandidates, synergyContext));
            const intentTransition = profiler.measure('intent', () => this.intentManager.update(state, {
                fateReserve: Math.max(synergy.fateReserve, Number(input.context?.profile?.v2?.fateReserve) || 0),
                conflictCardReserve: Math.max(synergy.conflictCardReserve,
                    Number(input.context?.profile?.v2?.conflictCardReserve) || 0),
                reducerIds: input.context?.profile?.v2?.reducerIds,
                conflictOpportunityReserve: Number(input.context?.profile?.v2?.conflictOpportunityReserve) || 0,
                allocation: input.context?.profile?.v2?.allocation
            }));
            const macroStep = intentTransition.macro?.status === 'continue' ? intentTransition.macro.step : undefined;
            const macroDecision = macroStep?.command ? this.macroDecision(input, macroStep) : undefined;
            if(this.mode === 'enabled' && macroStep?.command &&
                (!macroDecision || !this.macroStepIsLive(input, macroDecision.command, macroDecision.args))) {
                const failedMacroId = this.intentManager.activeMacroId;
                const failedStartSignature = this.intentManager.activeMacroStartedAtSignature;
                if(failedMacroId && failedStartSignature) {
                    this.failedMacroStartSignatures.set(failedMacroId, failedStartSignature);
                }
                this.intentManager.invalidate('macro-mismatch');
                const fallbackReason = 'macro-continuation-not-live';
                this.lastDecisionTrace = {
                    engineVersion: 'v2', selectedBy: 'fallback', fallbackReason,
                    decision: v1Decision, durationMs: Date.now() - startedAt, v2Mode: this.mode,
                    planner: this.lightweightTrace(
                        state, intentTransition, synergy.candidates, v1Decision,
                        fallbackReason, synergy, profiler.trace(), eligibility, undefined, intentTransition.macro?.progress
                    )
                };
                return v1Decision;
            }
            if(this.mode === 'enabled' && macroStep?.command && macroDecision) {
                const decision = macroDecision;
                this.intentManager.completeMacroStep(macroStep.id);
                this.lastDecisionTrace = {
                    engineVersion: 'v2', selectedBy: 'v2', decision,
                    durationMs: Date.now() - startedAt, v2Mode: this.mode,
                    planner: this.lightweightTrace(
                        state, intentTransition, synergy.candidates, v1Decision,
                        undefined, synergy, profiler.trace(), eligibility, decision, intentTransition.macro.progress
                    )
                };
                return decision;
            }
            if(this.mode === 'enabled' && !this.intentManager.hasActiveMacro &&
                this.isMechanicalOnly(synergy.candidates)) {
                const reference = resolveV1CandidateReference(synergy.candidates, v1Decision);
                const agreement = !reference.ambiguous && reference.candidate?.kind !== 'v1-fallback' &&
                    !reference.candidate?.macro && reference.candidate.confidence >= 0.9 &&
                    reference.candidate.prerequisites.every((entry) => entry.satisfied)
                    ? reference.candidate : undefined;
                if(agreement) {
                    const decision = candidateDecision(agreement);
                    const proof: OverrideProof = {
                        accepted: true,
                        reason: 'semantic-agreement',
                        evidence: ['exact-v1-command-agreement', 'no-macro-continuation', 'no-behavior-change']
                    };
                    const planner = this.lightweightTrace(
                        state, intentTransition, synergy.candidates, v1Decision,
                        undefined, synergy, profiler.trace(), eligibility, decision
                    );
                    this.currentExpectedEffectKinds = agreement.effects.map((effect) => effect.kind);
                    this.lastDecisionTrace = {
                        engineVersion: 'v2', selectedBy: 'v2', decision,
                        durationMs: Date.now() - startedAt, v2Mode: this.mode,
                        planner: {
                            ...planner,
                            v2PreferenceId: agreement.id,
                            chosenCandidateId: agreement.id,
                            disagreementType: 'agreement',
                            overrideProof: { reason: proof.reason!, evidence: proof.evidence }
                        }
                    };
                    return decision;
                }
                const fallbackReason = 'mechanical-prompt-v1';
                this.lastDecisionTrace = {
                    engineVersion: 'v2', selectedBy: 'fallback', fallbackReason,
                    decision: v1Decision, durationMs: Date.now() - startedAt, v2Mode: this.mode,
                    planner: this.lightweightTrace(
                        state, intentTransition, synergy.candidates, v1Decision,
                        fallbackReason, synergy, profiler.trace(), eligibility
                    )
                };
                return v1Decision;
            }
            const configuredResources = input.context?.profile?.v2?.resources || {};
            const resourceProfile = {
                ...synergy.resourceProfile,
                ...configuredResources,
                cards: { ...(synergy.resourceProfile.cards || {}), ...(configuredResources.cards || {}) },
                candidateValues: {
                    ...(synergy.resourceProfile.candidateValues || {}), ...(configuredResources.candidateValues || {})
                }
            };
            const { resourcePlan, packageWindow, plannedCandidates } = profiler.measure('resource-planning', () => {
                const plan = this.resourcePlanner.plan(state, synergy.candidates, resourceProfile);
                const window = this.dynastyPackageLedger.prepare(state, plan, synergy.candidates);
                return {
                    resourcePlan: plan,
                    packageWindow: window,
                    plannedCandidates: this.resourcePlanner.annotate(synergy.candidates, window.annotationPlan)
                };
            });
            const hardFateReserve = resourcePlan.reservations.filter((reservation) => reservation.hard && reservation.resource === 'fate')
                .reduce((sum, reservation) => sum + reservation.amount, 0);
            const hardCardReserve = resourcePlan.reservations.filter((reservation) => reservation.hard && reservation.resource === 'card')
                .reduce((sum, reservation) => sum + reservation.amount, 0);
            const safety = profiler.measure('safety', () => this.safety.evaluate(state, plannedCandidates, {
                attemptedActionKeys: input.context?.attemptedActionKeys,
                noProgressActionKeys: input.context?.noProgressActionKeys,
                staleTargetIds: input.context?.staleTargetIds,
                failedMacroIds: [...this.failedMacroStartSignatures.entries()]
                    .filter(([, signature]) => signature === state.materialStateSignature)
                    .map(([macroId]) => macroId),
                honorFloor: input.context?.profile?.v2?.honorFloor,
                hardFateReserve,
                hardCardReserve,
                reservedCandidateIds: resourcePlan.preferredCandidateIds
            }));
            const scored: ScoredCandidate[] = profiler.measure('utility-scoring', () => safety.allowed
                .map((candidate) => ({ candidate, score: this.utility.evaluate(state, candidate, input.context?.profile?.v2) }))
                .sort(compareScored));
            const v1Reference = resolveV1CandidateReference(plannedCandidates, v1Decision);
            const v1MatchingVetoes = v1Reference.ambiguous ? [] : safety.vetoed.filter((entry) =>
                entry.candidateId === v1Reference.nativeMatches[0]?.id);
            const allowedNative = scored.filter((entry) => entry.candidate.kind !== 'v1-fallback').map((entry) => entry.candidate);
            const transientSearchIds = new Set(safety.vetoed.filter((entry) =>
                entry.code === 'insufficient-fate-now' || entry.code === 'insufficient-cards-now').map((entry) => entry.candidateId));
            const transientSearchable = plannedCandidates.filter((candidate) => candidate.kind !== 'v1-fallback' &&
                transientSearchIds.has(candidate.id) && safety.vetoed.filter((entry) => entry.candidateId === candidate.id)
                    .every((entry) => entry.code === 'insufficient-fate-now' || entry.code === 'insufficient-cards-now'));
            const searchable = [...new Map([...allowedNative, ...transientSearchable]
                .map((candidate) => [candidate.id, candidate])).values()];
            const information = profiler.measure('information', () => this.informationSnapshot(state, input, profiler));
            const responseCandidates = [...new Map(information.responsePackages
                .flatMap((pkg) => pkg.candidates)
                .map((candidate) => [candidate.id, candidate])).values()];
            const opponentPass: BotActionCandidate = {
                id: 'candidate:opponent-response-pass', kind: 'pass', targets: [],
                commandPreview: { command: 'menuButton', args: ['pass'], target: 'Pass' },
                costs: {}, effects: [], prerequisites: [], tags: [], limits: [],
                uncertainty: 0, confidence: 1, proposer: 'opponent-information'
            };
            const responseScenarios = [
                { id: 'response:none', candidates: [opponentPass] },
                ...information.responsePackages.map((pkg) => ({
                    id: pkg.id,
                    candidates: [...pkg.candidates, opponentPass]
                }))
            ];
            const terminal = profiler.measure('terminal-solver', () => this.terminalSolver.solve(
                state, allowedNative, information, input.context?.profile?.v2?.terminal
            ));
            const searchEligibility = this.tacticalSearchEligibility.evaluate(
                state, eligibility, searchable, responseCandidates, this.mode);
            const runTacticalSearch = searchEligibility.eligible;
            const configuredSearch = input.context?.profile?.v2?.searchLimits || {};
            const searchLimits = {
                ...searchEligibility.limits,
                depth: Math.min(searchEligibility.limits.depth!, Math.max(1, Number(configuredSearch.depth) || searchEligibility.limits.depth!)),
                beamWidth: Math.min(searchEligibility.limits.beamWidth!, Math.max(1, Number(configuredSearch.beamWidth) || searchEligibility.limits.beamWidth!)),
                maxCandidates: Math.min(searchEligibility.limits.maxCandidates!, Math.max(1, Number(configuredSearch.maxCandidates) || searchEligibility.limits.maxCandidates!)),
                nodeBudget: Math.min(searchEligibility.limits.nodeBudget!, Math.max(1, Number(configuredSearch.nodeBudget) || searchEligibility.limits.nodeBudget!)),
                elapsedMs: Math.min(searchEligibility.limits.elapsedMs!, Math.max(10, Number((configuredSearch as any).elapsedMs) || searchEligibility.limits.elapsedMs!))
            };
            const search = profiler.measure('tactical-search', () => runTacticalSearch
                ? this.tacticalSearch.searchScenarios(state, searchEligibility.candidates,
                    responseScenarios, input.context?.profile?.v2, { limits: searchLimits })
                : this.skippedSearch(searchEligibility.reason));
            const selection = profiler.measure('selection', () => {
                const v1Candidate = v1Reference.candidate;
                const v1Native = scored.find((entry) => entry.candidate.id === v1Candidate?.id);
                const referenceTerminal = terminal.evaluations.find((entry) => entry.candidateId === v1Native?.candidate.id) ||
                    terminal.evaluations.find((entry) => allowedNative.find((candidate) =>
                        candidate.id === entry.candidateId)?.kind === 'pass');
                const terminalCandidate = terminal.firstCandidate;
                // A larger heuristic value inside the same terminal class is
                // not a causal terminal improvement. In particular, do not
                // spend a card/ability when V1 already has a forced win.
                const causalTerminalImprovement = !!terminal.selected && !!referenceTerminal &&
                    terminal.selected.terminalRank > referenceTerminal.terminalRank;
                // The terminal solver resolves the rest of the conflict race
                // after one root action; it does not yet model the root acting
                // again when an opponent answers a pass. Only let it directly
                // override with an effect that itself crosses a game-ending
                // threshold. Pumps, ready effects, and movement still need a
                // tactical-search/minimum-response proof.
                const directTerminalAction = !!terminalCandidate && terminalCandidate.effects.some((effect) => {
                    if(effect.kind === 'province') {
                        return effect.break === true && effect.location === 'stronghold province';
                    }
                    if(effect.kind === 'resource' && effect.honor) {
                        const targetId = effect.target?.kind === 'player' ? effect.target.id : state.perspectivePlayerId;
                        const player = state.players[targetId];
                        return !!player && (player.honor + effect.honor <= 0 || player.honor + effect.honor >= 25);
                    }
                    if(effect.kind === 'deck' && effect.mill && effect.target?.kind === 'player') {
                        const player = state.players[effect.target.id];
                        return !!player && effect.mill >= player.conflictDeckSize;
                    }
                    return false;
                });
                const terminalOverride = terminal.complete && directTerminalAction && causalTerminalImprovement &&
                    (terminal.selected?.status === 'forced-win' || terminal.selected?.status === 'avoids-forced-loss');
                const packagePreference = state.phase === 'dynasty' && packageWindow.candidateIds.size > 0
                    ? scored.find((entry) => packageWindow.candidateIds.has(entry.candidate.id))
                    : undefined;
                const preference = terminalOverride
                    ? scored.find((entry) => entry.candidate.id === terminal.firstCandidate?.id)
                    : search.complete && search.firstCandidate
                    ? scored.find((entry) => entry.candidate.id === search.firstCandidate?.id)
                    : !runTacticalSearch
                        ? packagePreference || scored.find((entry) => entry.candidate.kind !== 'v1-fallback')
                    : undefined;
                const v1Score = v1Native?.score.scalar ?? 0;
                const scoreGap = preference ? terminalOverride ? 1_000_000 + terminal.selected!.aggregate
                    : preference.score.scalar - v1Score : undefined;
                const disagreement = this.disagreement(preference, v1Decision, v1Native, scoreGap,
                    collection.hasNativeV2Candidate, terminalOverride ? terminal : undefined);
                const overrideProof = this.overridePolicy.evaluate({
                    state,
                    preference,
                    v1Candidate,
                    scoreGap,
                    v1Vetoes: v1MatchingVetoes,
                    terminal: terminalOverride ? terminal : undefined,
                    search,
                    candidates: searchable,
                    dynastyPackageProof: this.dynastyPackageLedger.proof(packageWindow, preference?.candidate.id),
                    defenderResponseReserve,
                    profile: input.context?.profile?.v2?.highConfidenceGate
                });
                const enabled = this.mode === 'enabled' && overrideProof.accepted;
                const chosen = enabled && preference ? candidateDecision(preference.candidate) : v1Decision;
                return { v1Native, terminalOverride, preference, scoreGap, disagreement, overrideProof, enabled, chosen };
            });
            const { v1Native, preference, scoreGap, disagreement, overrideProof, enabled, chosen, terminalOverride } = selection;
            const packageProof = this.dynastyPackageLedger.proof(packageWindow, preference?.candidate.id);
            if(state.phase === 'dynasty' && packageWindow.package) {
                if(enabled && preference?.candidate.kind === 'dynasty-purchase' && packageProof) {
                    this.dynastyPackageLedger.commit(state, packageWindow.package, preference.candidate.id);
                } else if(packageWindow.proofKind === 'retained-joint-package') {
                    // Any fallback or failed proof ends this V2 package. V1 may
                    // continue normally, but V2 cannot replan a fresh package.
                    this.dynastyPackageLedger.abandon();
                }
            }
            if(enabled && preference?.candidate.macro) {
                const macro = preference.candidate.macro;
                this.intentManager.setMacro(macro);
                const firstStep = macro.steps[macro.currentStep];
                if(firstStep?.command === chosen?.command &&
                    JSON.stringify(firstStep.args || []) === JSON.stringify(chosen?.args || [])) {
                    this.intentManager.completeMacroStep(firstStep.id);
                }
            }
            const fallbackReason = enabled ? undefined
                : this.mode === 'shadow' ? 'shadow-mode'
                    : search.exhausted ? 'search-budget-exhausted'
                    : preference ? 'below-v2-confidence-gate' : collection.fallbackReason || 'no-valid-v2-candidates';
            const chosenCandidateId = enabled ? preference?.candidate.id : v1Native?.candidate.id;
            const planner = this.plannerTrace(
                state,
                intentTransition,
                plannedCandidates,
                safety.vetoed,
                scored,
                preference,
                v1Decision,
                disagreement,
                scoreGap,
                fallbackReason,
                search,
                information,
                terminal,
                synergy,
                profiler.trace(),
                eligibility,
                chosenCandidateId,
                overrideProof,
                terminalOverride
            );
            this.currentExpectedEffectKinds = enabled && preference
                ? [...new Set(preference.candidate.effects.map((effect) => effect.kind))]
                : [];
            this.lastDecisionTrace = {
                engineVersion: 'v2', selectedBy: enabled ? 'v2' : 'fallback', fallbackReason,
                decision: chosen, durationMs: Date.now() - startedAt, v2Mode: this.mode, planner
            };
            return chosen;
        } catch(error: any) {
            this.lastDecisionTrace = {
                engineVersion: 'v2', selectedBy: 'fallback', fallbackReason: 'planner-error',
                decision: v1Decision, durationMs: Date.now() - startedAt, v2Mode: this.mode,
                planner: {
                    traceVersion: 1, mode: this.mode, candidateCount: 0, v1Action: v1Decision,
                    disagreementType: 'semantic-gap', fallbackReason: `planner-error:${error?.message || error}`,
                    profiling: profiler.trace(),
                    eligibility,
                    budget: { generated: 0, vetoed: 0, scored: 0, searchedNodes: 0, exhausted: false }
                } satisfies V2PlannerTrace
            };
            return v1Decision;
        }
    }

    private skippedSearch(reason: string): TacticalSearchResult {
        return {
            complete: false,
            utility: -Infinity,
            principalLine: [],
            searchNodes: [],
            rootEvaluations: [],
            searchedNodes: 0,
            prunedCandidates: 0,
            exhausted: false,
            elapsedMs: 0,
            reason
        };
    }

    private macroStepIsLive(input: BotDecisionInput, command: string, args: readonly unknown[]): boolean {
        const state = input.playerState || {};
        const me = state.players?.[input.botName || this.config.playerName] || {};
        if(command === 'cardClicked') {
            const uuid = String(args[0] || '');
            const exact = input.context?.legalDirectCardUuids;
            if(exact) return exact[uuid] === true;
            const seen = new Set<any>();
            const visit = (value: any): boolean => {
                if(!value || typeof value !== 'object' || seen.has(value)) return false;
                seen.add(value);
                if(value.uuid === uuid) return value.selectable === true;
                return Array.isArray(value) ? value.some(visit) : Object.values(value).some(visit);
            };
            return visit(state);
        }
        if(command === 'menuButton') {
            return (me.buttons || []).some((button: any) => !button.disabled &&
                (button.command || 'menuButton') === 'menuButton' &&
                button.arg === args[0] && button.uuid === args[1] &&
                (button.method || undefined) === (args[2] || undefined));
        }
        if(command === 'ringClicked') {
            const ring = state.rings?.[String(args[0] || '')];
            return !!ring && ring.unselectable !== true;
        }
        return false;
    }

    private macroDecision(input: BotDecisionInput, step: SemanticMacroStep): BotDecision | undefined {
        if(!step.command) return undefined;
        if(step.command === 'menuButton' && (step.args || []).length === 0) {
            const state = input.playerState || {};
            const me = state.players?.[input.botName || this.config.playerName] || {};
            const wanted = step.semanticValue.toLowerCase();
            const button = (me.buttons || []).find((entry: any) => !entry.disabled &&
                String(entry.text ?? entry.arg ?? '').toLowerCase() === wanted);
            if(!button) return undefined;
            return {
                command: button.command || 'menuButton',
                args: [button.arg ?? button.text, button.uuid, button.method],
                target: String(button.text ?? button.arg ?? step.semanticValue),
                reason: `v2-macro-${step.kind}`
            };
        }
        return {
            command: step.command,
            args: [...(step.args || [])],
            target: step.semanticValue,
            reason: `v2-macro-${step.kind}`
        };
    }

    private isMechanicalOnly(candidates: readonly BotActionCandidate[]): boolean {
        const mechanical = new Set([
            'pass', 'confirmation', 'bid', 'mulligan', 'discard',
            'card-selection', 'target-selection', 'mode-selection'
        ]);
        const native = candidates.filter((candidate) => candidate.kind !== 'v1-fallback');
        return native.length === 0 || native.every((candidate) => mechanical.has(candidate.kind));
    }

    private finalizePendingOutcome(observedStateSignature: string): void {
        if(!this.pendingOutcome) return;
        const pending = this.pendingOutcome;
        const changed = pending.previousStateSignature !== observedStateSignature;
        (pending.planner as any).outcome = {
            status: changed ? 'realized' : pending.expectedEffectKinds.length > 0 ? 'not-realized' : 'unknown',
            realizedEffectKinds: changed ? pending.expectedEffectKinds : [],
            expectedEffectKinds: pending.expectedEffectKinds,
            reason: changed ? 'accepted-material-state-change' : 'accepted-without-observed-material-change',
            previousStateSignature: pending.previousStateSignature,
            observedStateSignature,
            materialStateChanged: changed
        };
        this.pendingOutcome = undefined;
    }

    private lightweightTrace(state: PlanningState, intent: any, candidates: readonly BotActionCandidate[],
        v1Decision: BotDecision | null, fallbackReason: string | undefined,
        synergy: DeckSynergyContribution, profiling: V2PlannerProfilingTrace,
        eligibility: PlanningEligibilityResult, v2Preference?: BotDecision,
        macroProgress?: unknown): V2PlannerTrace {
        const includeCandidates = this.config.traceLevel === 'benchmark' || this.config.traceLevel === 'research';
        return {
            traceVersion: 1,
            mode: this.mode,
            traceLevel: this.config.traceLevel || 'production',
            stateSignature: state.materialStateSignature,
            promptFingerprint: state.prompt.identity,
            profiling,
            eligibility,
            intentId: intent.intent.id,
            intentObjective: intent.intent.objective,
            intentRetained: intent.retained,
            intentInvalidation: intent.invalidationReason,
            candidateCount: candidates.length,
            candidates: includeCandidates ? candidates.map((candidate) => ({
                id: candidate.id,
                kind: candidate.kind,
                proposer: candidate.proposer,
                mode: candidate.mode,
                command: candidate.commandPreview.command,
                target: candidate.commandPreview.target,
                cardId: candidate.source?.cardId,
                effectKinds: [...new Set(candidate.effects.map((effect) => effect.kind))],
                tags: candidate.tags,
                costs: candidate.costs,
                targets: candidate.targets,
                confidence: candidate.confidence,
                uncertainty: candidate.uncertainty,
                vetoes: []
            })) : undefined,
            v2Preference: v2Preference || null,
            v1Action: v1Decision,
            disagreementType: v2Preference ? 'likely-improvement' : 'v1-preferred',
            synergy: {
                profileIds: synergy.profileIds,
                fateReserve: synergy.fateReserve,
                conflictCardReserve: synergy.conflictCardReserve,
                activations: synergy.activations
            },
            fallbackReason,
            macroProgress,
            replay: this.config.traceLevel === 'research' ? {
                planningState: state,
                candidateIds: candidates.map((candidate) => candidate.id),
                configuration: this.replayConfiguration()
            } : undefined,
            budget: {
                generated: candidates.length,
                vetoed: 0,
                scored: 0,
                searchedNodes: 0,
                exhausted: false
            }
        };
    }

    private replayConfiguration(): Readonly<Record<string, unknown>> {
        return {
            engineVersion: 'v2',
            v2Mode: this.mode,
            strategySeed: this.config.seed,
            informationMode: this.config.omniscient === true ? 'omniscient' : 'fair',
            deckProfileId: this.config.deckProfileId || this.config.deckId || 'auto'
        };
    }

    private cheapFallbackTrace(v1Decision: BotDecision | null, fallbackReason: string,
        profiling: V2PlannerProfilingTrace, eligibility: PlanningEligibilityResult): V2PlannerTrace {
        return {
            traceVersion: 1,
            mode: this.mode,
            traceLevel: this.config.traceLevel || 'production',
            profiling,
            eligibility,
            candidateCount: 0,
            v1Action: v1Decision,
            disagreementType: 'v1-preferred',
            fallbackReason,
            budget: { generated: 0, vetoed: 0, scored: 0, searchedNodes: 0, exhausted: false }
        };
    }

    private disagreement(preference: ScoredCandidate | undefined, v1: BotDecision | null,
        v1Native: ScoredCandidate | undefined, scoreGap: number | undefined, hasNative: boolean,
        terminal?: TerminalSolverResult): V2DisagreementType {
        if(!preference) return hasNative ? 'v1-preferred' : 'semantic-gap';
        if(sameCommand(preference.candidate, v1)) return 'agreement';
        if(terminal?.selected?.status === 'forced-win' || terminal?.selected?.status === 'avoids-forced-loss') return 'proven-v2-improvement';
        if(preference.score.terminalRank >= 4 && preference.score.terminalRank > (v1Native?.score.terminalRank || 1)) return 'proven-v2-improvement';
        if(preference.candidate.confidence >= 0.9 && (scoreGap || 0) >= 3) return 'likely-improvement';
        if(!v1Native) return 'semantic-gap';
        if((scoreGap || 0) <= 0) return 'v1-preferred';
        return preference.candidate.uncertainty > 0.35 ? 'uncertain' : 'scoring-gap';
    }

    private plannerTrace(state: PlanningState, intent: any, candidates: readonly BotActionCandidate[],
        vetoes: readonly CandidateVeto[], scored: readonly ScoredCandidate[], preference: ScoredCandidate | undefined,
        v1Decision: BotDecision | null, disagreementType: V2DisagreementType, scoreGap: number | undefined,
        fallbackReason: string | undefined, search: TacticalSearchResult,
        information: OpponentInformationSnapshot, terminal: TerminalSolverResult,
        synergy: DeckSynergyContribution, profiling: V2PlannerProfilingTrace,
        eligibility: PlanningEligibilityResult, chosenCandidateId?: string,
        overrideProof?: OverrideProof, terminalOverride = false): V2PlannerTrace {
        const traceCandidates: V2CandidateTrace[] = candidates.map((candidate) => {
            const score = scored.find((entry) => entry.candidate.id === candidate.id)?.score;
            return {
                id: candidate.id, kind: candidate.kind, proposer: candidate.proposer, mode: candidate.mode,
                command: candidate.commandPreview.command, target: candidate.commandPreview.target,
                cardId: candidate.source?.cardId,
                effectKinds: [...new Set(candidate.effects.map((effect) => effect.kind))],
                tags: candidate.tags,
                costs: candidate.costs,
                targets: candidate.targets,
                confidence: candidate.confidence, uncertainty: candidate.uncertainty,
                vetoes: vetoes.filter((entry) => entry.candidateId === candidate.id),
                score: score?.scalar, terminalRank: score?.terminalRank,
                scoreVector: this.config.traceLevel === 'research' ? score?.vector : undefined,
                explanation: this.config.traceLevel === 'research' ? score?.explanation : undefined
            };
        });
        const includeCandidates = this.config.traceLevel === 'benchmark' || this.config.traceLevel === 'research';
        const preferenceRoot = search.rootEvaluations.find((entry) => entry.candidateId === preference?.candidate.id);
        const runnerUp = search.rootEvaluations.find((entry) => entry.candidateId !== preference?.candidate.id);
        return {
            traceVersion: 1,
            mode: this.mode,
            traceLevel: this.config.traceLevel || 'production',
            stateSignature: state.materialStateSignature,
            promptFingerprint: state.prompt.identity,
            profiling,
            eligibility,
            intentId: intent.intent.id,
            intentObjective: intent.intent.objective,
            intentRetained: intent.retained,
            intentInvalidation: intent.invalidationReason,
            candidateCount: candidates.length,
            candidates: includeCandidates ? traceCandidates : undefined,
            v2PreferenceId: preference?.candidate.id,
            chosenCandidateId,
            runnerUpCandidateId: runnerUp?.candidateId,
            runnerUpGap: preferenceRoot && runnerUp ? preferenceRoot.utility - runnerUp.utility : undefined,
            v2Preference: preference ? candidateDecision(preference.candidate) : null,
            v1Action: v1Decision,
            disagreementType,
            scoreGap,
            confidence: preference?.candidate.confidence,
            overrideProof: overrideProof?.accepted && overrideProof.reason ? {
                reason: overrideProof.reason,
                evidence: overrideProof.evidence
            } : undefined,
            overrideRejectionEvidence: overrideProof && !overrideProof.accepted
                ? overrideProof.evidence : undefined,
            principalLine: search.principalLine,
            searchUtility: search.utility,
            searchReason: search.reason,
            prunedCandidates: search.prunedCandidates,
            searchNodes: this.config.traceLevel === 'research' ? search.searchNodes : undefined,
            rootEvaluations: this.config.traceLevel === 'research' ? search.rootEvaluations : undefined,
            information: {
                mode: information.mode,
                certainty: information.certainty,
                handHypotheses: information.handHypotheses.length,
                provinceHypotheses: information.provinceHypotheses.length,
                responsePackages: information.responsePackages.length,
                details: information.trace
            },
            terminal: {
                active: terminal.active,
                overrideEligible: terminalOverride,
                reasons: terminal.reasons,
                exact: terminal.exact,
                aggregation: terminal.aggregation,
                selectedCandidateId: terminal.firstCandidate?.id,
                status: terminal.selected?.status,
                terminalRank: terminal.selected?.terminalRank,
                expected: terminal.selected?.expected,
                pessimistic: terminal.selected?.pessimistic,
                optimistic: terminal.selected?.optimistic,
                searchedBranches: terminal.searchedBranches,
                principalLine: terminal.principalLine
            },
            synergy: {
                profileIds: synergy.profileIds,
                fateReserve: synergy.fateReserve,
                conflictCardReserve: synergy.conflictCardReserve,
                activations: synergy.activations
            },
            macroProgress: intent.macro?.progress,
            replay: this.config.traceLevel === 'research' ? {
                planningState: state,
                candidateIds: candidates.map((candidate) => candidate.id),
                configuration: this.replayConfiguration()
            } : undefined,
            fallbackReason,
            budget: {
                generated: candidates.length,
                vetoed: new Set(vetoes.map((entry) => entry.candidateId)).size,
                scored: scored.length,
                searchedNodes: search.searchedNodes,
                exhausted: search.exhausted
            }
        };
    }

    private informationSnapshot(state: any, input: BotDecisionInput,
        profiler: PlannerProfiler): OpponentInformationSnapshot {
        const evidence = publicEvidenceFromPlayerState(input.playerState, state.perspectivePlayerId, input.context);
        const omniscient = state.informationMode === 'omniscient' ? input.context?.omniscient : undefined;
        const key = stableHash({
            state: state.materialStateSignature,
            informationMode: state.informationMode,
            evidence,
            conflictDeck: input.context?.opponentConflictDeck || [],
            provinceDeck: input.context?.opponentProvinceDeck || [],
            omniscient
        });
        const cached = this.projectionCache.getOrCreate('opponent-information', key, () => {
            if(omniscient) {
                return this.exactInformation.build(state, {
                    hand: omniscient.oppHand || [],
                    provinces: omniscient.oppProvinces || [],
                    fate: omniscient.oppFate,
                    evidence
                });
            }
            return this.fairInformation.build(state, {
                conflictDeck: input.context?.opponentConflictDeck || [],
                provinceDeck: input.context?.opponentProvinceDeck || [],
                evidence
            });
        });
        profiler.recordCache('opponent-information', cached.hit);
        return cached.value;
    }
}
