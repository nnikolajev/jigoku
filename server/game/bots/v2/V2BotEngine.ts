import type { BotDecision, BotDecisionInput, BotEngine, BotEngineDecisionTrace } from '../BotEngine';
import type { JigokuBotConfig } from '../JigokuBotConfig';
import CandidateRegistry from './CandidateRegistry.js';
import IntentManager from './IntentManager.js';
import PerspectiveSnapshotBuilder from './PerspectiveSnapshotBuilder.js';
import SafetyVetoPipeline from './SafetyVetoPipeline.js';
import UtilityEvaluator, { compareScored } from './UtilityEvaluator.js';
import CardSemanticRegistry from './cards/CardSemantics.js';
import { REPRESENTATIVE_SEMANTICS } from './cards/GenericSemantics.js';
import { DECK_SEMANTICS } from './cards/DeckSemantics.js';
import DeckSynergyContributor, { type DeckSynergyContribution } from './cards/DeckSynergies.js';
import TacticalSearch, { type TacticalSearchResult } from './search/TacticalSearch.js';
import ResourcePackagePlanner from './resources/ResourcePackagePlanner.js';
import FairInformationProvider from './information/FairInformationProvider.js';
import ExactInformationProvider from './information/ExactInformationProvider.js';
import { publicEvidenceFromPlayerState } from './information/PublicEvidence.js';
import type { OpponentInformationSnapshot } from './information/OpponentInformationProvider';
import TerminalSolver, { type TerminalSolverResult } from './terminal/TerminalSolver.js';
import type { BotActionCandidate, CandidateVeto } from './model/Candidate';
import type { PlanningLedgers } from './model/Ledgers';
import type { PlanningState } from './model/PlanningState';
import type { ScoredUtility } from './model/Utility';
import type { V2CandidateTrace, V2DisagreementType, V2PlannerTrace } from './tracing/V2Trace';

interface ScoredCandidate {
    readonly candidate: BotActionCandidate;
    readonly score: ScoredUtility;
}

function sameCommand(candidate: BotActionCandidate, decision: BotDecision | null): boolean {
    return !!decision && candidate.commandPreview.command === decision.command &&
        JSON.stringify(candidate.commandPreview.args) === JSON.stringify(decision.args);
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
    private readonly intentManager = new IntentManager();
    private readonly candidateRegistry = new CandidateRegistry();
    private readonly cardSemantics = new CardSemanticRegistry([...REPRESENTATIVE_SEMANTICS, ...DECK_SEMANTICS]);
    private readonly deckSynergies = new DeckSynergyContributor(this.cardSemantics);
    private readonly safety = new SafetyVetoPipeline();
    private readonly utility = new UtilityEvaluator();
    private readonly tacticalSearch = new TacticalSearch();
    private readonly resourcePlanner = new ResourcePackagePlanner();
    private readonly fairInformation = new FairInformationProvider();
    private readonly exactInformation = new ExactInformationProvider();
    private readonly terminalSolver = new TerminalSolver();
    private previousLedgers?: PlanningLedgers;
    private currentExpectedEffectKinds: readonly string[] = [];
    private pendingOutcome?: {
        readonly planner: V2PlannerTrace;
        readonly previousStateSignature?: string;
        readonly expectedEffectKinds: readonly string[];
    };

    constructor(private readonly fallback: BotEngine, private readonly config: JigokuBotConfig = { playerName: 'Jigoku Bot' }) {
        this.mode = config.v2Mode || 'pass-through';
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
        if(result === 'rejected') this.intentManager.invalidate('command-rejected');
    }

    decide(input: BotDecisionInput): BotDecision | null {
        const startedAt = Date.now();
        this.currentExpectedEffectKinds = [];
        // V1 is evaluated exactly once and remains deterministic per decision.
        const v1Decision = this.fallback.decide(input);
        if(this.mode === 'pass-through') {
            this.lastDecisionTrace = {
                engineVersion: 'v2', selectedBy: 'fallback', fallbackReason: 'v2-pass-through',
                decision: v1Decision, durationMs: Date.now() - startedAt, v2Mode: this.mode
            };
            return v1Decision;
        }

        try {
            const state = this.snapshotBuilder.build(input, {
                informationMode: this.config.omniscient === true ? 'omniscient' : 'fair',
                previousLedgers: this.previousLedgers,
                roundId: String(input.context?.roundNumber ?? 'round:0'),
                conflictId: input.context?.conflictId || input.playerState?.conflict?.id || input.playerState?.conflict?.uuid
            });
            this.finalizePendingOutcome(state.materialStateSignature);
            this.previousLedgers = state.ledgers;
            const collection = this.candidateRegistry.collect({ input, state, v1Decision });
            const semanticCandidates = collection.candidates.map((candidate) => this.cardSemantics.enrich(state, candidate));
            const synergy = this.deckSynergies.contribute(state, semanticCandidates, {
                deckProfileId: this.config.deckProfileId || this.config.deckId,
                profile: input.context?.profile
            });
            const intentTransition = this.intentManager.update(state, {
                fateReserve: Math.max(synergy.fateReserve, Number(input.context?.profile?.v2?.fateReserve) || 0),
                conflictCardReserve: Math.max(synergy.conflictCardReserve,
                    Number(input.context?.profile?.v2?.conflictCardReserve) || 0),
                reducerIds: input.context?.profile?.v2?.reducerIds,
                conflictOpportunityReserve: Number(input.context?.profile?.v2?.conflictOpportunityReserve) || 0,
                allocation: input.context?.profile?.v2?.allocation
            });
            const macroStep = intentTransition.macro?.status === 'continue' ? intentTransition.macro.step : undefined;
            if(this.mode === 'enabled' && macroStep?.command) {
                const decision: BotDecision = {
                    command: macroStep.command,
                    args: [...(macroStep.args || [])],
                    target: macroStep.semanticValue,
                    reason: `v2-macro-${macroStep.kind}`
                };
                this.intentManager.completeMacroStep(macroStep.id);
                this.lastDecisionTrace = {
                    engineVersion: 'v2', selectedBy: 'v2', decision,
                    durationMs: Date.now() - startedAt, v2Mode: this.mode,
                    planner: this.lightweightTrace(
                        state, intentTransition, synergy.candidates, v1Decision,
                        undefined, synergy, decision, intentTransition.macro.progress
                    )
                };
                return decision;
            }
            if(this.mode === 'enabled' && !this.intentManager.hasActiveMacro &&
                this.isMechanicalOnly(synergy.candidates)) {
                const fallbackReason = 'mechanical-prompt-v1';
                this.lastDecisionTrace = {
                    engineVersion: 'v2', selectedBy: 'fallback', fallbackReason,
                    decision: v1Decision, durationMs: Date.now() - startedAt, v2Mode: this.mode,
                    planner: this.lightweightTrace(
                        state, intentTransition, synergy.candidates, v1Decision,
                        fallbackReason, synergy
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
            const resourcePlan = this.resourcePlanner.plan(state, synergy.candidates, resourceProfile);
            const plannedCandidates = this.resourcePlanner.annotate(synergy.candidates, resourcePlan);
            const hardFateReserve = resourcePlan.reservations.filter((reservation) => reservation.hard && reservation.resource === 'fate')
                .reduce((sum, reservation) => sum + reservation.amount, 0);
            const hardCardReserve = resourcePlan.reservations.filter((reservation) => reservation.hard && reservation.resource === 'card')
                .reduce((sum, reservation) => sum + reservation.amount, 0);
            const safety = this.safety.evaluate(state, plannedCandidates, {
                attemptedActionKeys: input.context?.attemptedActionKeys,
                noProgressActionKeys: input.context?.noProgressActionKeys,
                staleTargetIds: input.context?.staleTargetIds,
                honorFloor: input.context?.profile?.v2?.honorFloor,
                hardFateReserve,
                hardCardReserve,
                reservedCandidateIds: resourcePlan.preferredCandidateIds
            });
            const scored: ScoredCandidate[] = safety.allowed
                .map((candidate) => ({ candidate, score: this.utility.evaluate(state, candidate, input.context?.profile?.v2) }))
                .sort(compareScored);
            const v1MatchingVetoes = safety.vetoed.filter((entry) => {
                const candidate = plannedCandidates.find((item) => item.id === entry.candidateId);
                return !!candidate && candidate.kind !== 'v1-fallback' && sameCommand(candidate, v1Decision);
            });
            const searchable = scored.filter((entry) => entry.candidate.kind !== 'v1-fallback').map((entry) => entry.candidate);
            const information = this.informationSnapshot(state, input);
            const responseCandidates = [...new Map(information.responsePackages
                .flatMap((pkg) => pkg.candidates)
                .map((candidate) => [candidate.id, candidate])).values()];
            const terminal = this.terminalSolver.solve(
                state, searchable, information, input.context?.profile?.v2?.terminal
            );
            const searchProfile = terminal.active ? {
                ...(input.context?.profile?.v2 || {}),
                searchLimits: {
                    ...(input.context?.profile?.v2?.searchLimits || {}),
                    depth: Math.max(4, Number(input.context?.profile?.v2?.searchLimits?.depth) || 0),
                    nodeBudget: Math.max(96, Number(input.context?.profile?.v2?.searchLimits?.nodeBudget) || 0)
                }
            } : input.context?.profile?.v2;
            // Broad search remains a shadow/research slice until its latency and
            // budget-exhaustion holdout gates pass. Enabled mode still runs the
            // exact terminal solver and safety-veto corrections.
            const liveTacticalSearch = input.context?.profile?.v2?.liveTacticalSearch === true;
            const runTacticalSearch = this.mode === 'shadow' || liveTacticalSearch;
            const search = runTacticalSearch
                ? this.tacticalSearch.search(state, searchable, searchProfile, {
                    responseProvider: () => responseCandidates
                })
                : this.skippedSearch('live-tactical-search-disabled');
            const v1Native = scored.find((entry) => entry.candidate.kind !== 'v1-fallback' && sameCommand(entry.candidate, v1Decision));
            const referenceTerminal = terminal.evaluations.find((entry) => entry.candidateId === v1Native?.candidate.id) ||
                terminal.evaluations.find((entry) => searchable.find((candidate) =>
                    candidate.id === entry.candidateId)?.kind === 'pass');
            const terminalCandidate = terminal.firstCandidate;
            const causalTerminalImprovement = !!terminal.selected && !!referenceTerminal &&
                (terminal.selected.terminalRank > referenceTerminal.terminalRank ||
                    terminal.selected.terminalRank === referenceTerminal.terminalRank &&
                    terminal.selected.aggregate > referenceTerminal.aggregate + 1);
            const coherentTerminalAction = !!terminalCandidate && (terminalCandidate.effects.length > 0 || [
                'pass', 'conflict-declaration', 'attacker-set', 'defender-set', 'conflict-card',
                'in-play-ability', 'reaction', 'interrupt', 'macro-continuation'
            ].includes(terminalCandidate.kind));
            const terminalOverride = terminal.complete && coherentTerminalAction && causalTerminalImprovement &&
                (terminal.selected?.status === 'forced-win' || terminal.selected?.status === 'avoids-forced-loss');
            const preference = terminalOverride
                ? scored.find((entry) => entry.candidate.id === terminal.firstCandidate?.id)
                : search.complete && search.firstCandidate
                ? scored.find((entry) => entry.candidate.id === search.firstCandidate?.id)
                : !runTacticalSearch
                    ? scored.find((entry) => entry.candidate.kind !== 'v1-fallback')
                : undefined;
            const v1Score = v1Native?.score.scalar ?? 0;
            const scoreGap = preference ? terminalOverride ? 1_000_000 + terminal.selected!.aggregate
                : preference.score.scalar - v1Score : undefined;
            const disagreement = this.disagreement(preference, v1Decision, v1Native, scoreGap,
                collection.hasNativeV2Candidate, terminalOverride ? terminal : undefined);
            const enabled = this.mode === 'enabled' && this.highConfidenceGate(
                preference, scoreGap, v1MatchingVetoes, terminalOverride ? terminal : undefined,
                input.context?.profile?.v2?.highConfidenceGate
            );
            const chosen = enabled && preference ? candidateDecision(preference.candidate) : v1Decision;
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
                chosenCandidateId
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
                    budget: { generated: 0, vetoed: 0, scored: 0, searchedNodes: 0, exhausted: false }
                } satisfies V2PlannerTrace
            };
            return v1Decision;
        }
    }

    private highConfidenceGate(preference: ScoredCandidate | undefined, scoreGap: number | undefined,
        v1Vetoes: readonly CandidateVeto[], terminal?: TerminalSolverResult,
        profile?: { readonly confidence?: number; readonly scoreAdvantage?: number }): boolean {
        // Profiles may tighten the evidence gate, never relax the safety floor.
        const confidenceThreshold = Math.max(0.9, Number(profile?.confidence) || 0.9);
        const scoreAdvantageThreshold = Math.max(3, Number(profile?.scoreAdvantage) || 3);
        if(!preference || preference.candidate.confidence < confidenceThreshold ||
            (scoreGap ?? -Infinity) < scoreAdvantageThreshold) return false;
        if(terminal?.selected?.status === 'forced-win' || terminal?.selected?.status === 'avoids-forced-loss') return true;
        if(preference.score.terminalRank >= 4) return true;
        return v1Vetoes.some((entry) => [
            'duplicate-non-stacking-effect', 'duplicate-effect-target', 'impossible-payoff',
            'terminal-loss', 'mandatory-defense', 'honor-floor', 'conflict-deck-exhaustion'
        ].includes(entry.code));
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
        synergy: DeckSynergyContribution, v2Preference?: BotDecision,
        macroProgress?: unknown): V2PlannerTrace {
        const includeCandidates = this.config.traceLevel === 'benchmark' || this.config.traceLevel === 'research';
        return {
            traceVersion: 1,
            mode: this.mode,
            traceLevel: this.config.traceLevel || 'production',
            stateSignature: state.materialStateSignature,
            promptFingerprint: state.prompt.identity,
            intentId: intent.intent.id,
            intentObjective: intent.intent.objective,
            intentRetained: intent.retained,
            intentInvalidation: intent.invalidationReason,
            candidateCount: candidates.length,
            candidates: includeCandidates ? candidates.map((candidate) => ({
                id: candidate.id,
                kind: candidate.kind,
                proposer: candidate.proposer,
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
        synergy: DeckSynergyContribution, chosenCandidateId?: string): V2PlannerTrace {
        const traceCandidates: V2CandidateTrace[] = candidates.map((candidate) => {
            const score = scored.find((entry) => entry.candidate.id === candidate.id)?.score;
            return {
                id: candidate.id, kind: candidate.kind, proposer: candidate.proposer,
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
            principalLine: search.principalLine,
            searchUtility: search.utility,
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

    private informationSnapshot(state: any, input: BotDecisionInput): OpponentInformationSnapshot {
        const evidence = publicEvidenceFromPlayerState(input.playerState, state.perspectivePlayerId, input.context);
        if(state.informationMode === 'omniscient' && input.context?.omniscient) {
            return this.exactInformation.build(state, {
                hand: input.context.omniscient.oppHand || [],
                provinces: input.context.omniscient.oppProvinces || [],
                fate: input.context.omniscient.oppFate,
                evidence
            });
        }
        return this.fairInformation.build(state, {
            conflictDeck: input.context?.opponentConflictDeck || [],
            provinceDeck: input.context?.opponentProvinceDeck || [],
            evidence
        });
    }
}
