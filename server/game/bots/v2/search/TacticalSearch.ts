import type { BotActionCandidate } from '../model/Candidate';
import type { PlanningState } from '../model/PlanningState';
import type { PlayerId } from '../model/References';
import type { ScoredUtility } from '../model/Utility';
import UtilityEvaluator, {
    compareScored,
    semanticCandidateOrderKey,
    type UtilityProfile
} from '../UtilityEvaluator.js';
import { immutable, stableSerialize } from '../model/Stable';
import EffectSimulator from './EffectSimulator.js';

export interface TacticalSearchLimits {
    readonly depth: number;
    readonly beamWidth: number;
    readonly maxCandidates: number;
    readonly nodeBudget: number;
    readonly elapsedMs?: number;
    readonly distanceDiscount: number;
    readonly uncertaintyPenalty: number;
}

export interface SearchLineStep {
    readonly ply: number;
    readonly actorId: PlayerId;
    readonly candidateId: string;
    readonly candidateKind: string;
    readonly score: number;
    readonly stateSignature: string;
}

export interface SearchTraceNode extends SearchLineStep {
    readonly parentCandidateId?: string;
    readonly lineValue: number;
    readonly terminal: boolean;
}

export interface RootSearchEvaluation {
    readonly candidateId: string;
    readonly utility: number;
    readonly line: readonly SearchLineStep[];
    readonly responseScenarioId?: string;
}

export interface TacticalResponseScenario {
    readonly id: string;
    readonly candidates: readonly BotActionCandidate[];
}

export interface TacticalSearchResult {
    readonly complete: boolean;
    readonly firstCandidate?: BotActionCandidate;
    readonly utility: number;
    readonly principalLine: readonly SearchLineStep[];
    readonly searchNodes: readonly SearchTraceNode[];
    readonly rootEvaluations: readonly RootSearchEvaluation[];
    readonly searchedNodes: number;
    readonly prunedCandidates: number;
    readonly exhausted: boolean;
    readonly elapsedMs: number;
    readonly reason: string;
}

export type ResponseProvider = (state: PlanningState, actorId: PlayerId, ply: number) => readonly BotActionCandidate[];

interface RankedCandidate {
    readonly candidate: BotActionCandidate;
    readonly score: ScoredUtility;
}

interface SearchNode {
    readonly state: PlanningState;
    readonly actorId: PlayerId;
    readonly ply: number;
    readonly value: number;
    readonly line: readonly SearchLineStep[];
    readonly used: ReadonlySet<string>;
    readonly consecutivePasses: number;
}

const DEFAULT_LIMITS: TacticalSearchLimits = {
    depth: 3,
    beamWidth: 5,
    maxCandidates: 12,
    nodeBudget: 64,
    distanceDiscount: 0.9,
    uncertaintyPenalty: 2
};

function costs(candidate: BotActionCandidate): number {
    return (candidate.costs.fate || 0) + (candidate.costs.honor || 0) + (candidate.costs.cards || 0);
}

function effectIdentity(candidate: BotActionCandidate): string {
    return stableSerialize({
        effects: candidate.effects,
        targets: candidate.targets,
        tags: candidate.tags.filter((tag) => tag !== 'uncertain').sort()
    });
}

function semanticLineOrderKey(line: readonly SearchLineStep[],
    candidateKeys: ReadonlyMap<string, string>): string {
    return line.map((step) => [
        step.ply,
        step.actorId,
        step.candidateKind,
        candidateKeys.get(step.candidateId) || step.candidateId,
        step.score
    ].join(':')).join('|');
}

function opponentId(state: PlanningState, actorId: PlayerId): PlayerId {
    return Object.keys(state.players).find((id) => id !== actorId) || actorId;
}

function terminal(state: PlanningState): boolean {
    if(Object.values(state.players).some((player) => player.honor <= 0)) return true;
    return state.provinces.some((province) => province.stronghold && province.broken);
}

function phaseBoundary(state: PlanningState): boolean {
    return !!state.conflict?.winnerId;
}

function usageKeys(candidate: BotActionCandidate): readonly string[] {
    const keys = [`candidate:${candidate.id}`];
    // Different mode/target candidates can share one physical card. Once a
    // hand card is projected as played, every semantic variant of that source
    // must disappear from the rest of the line.
    if(candidate.source?.location === 'hand' && (candidate.costs.cards || 0) > 0) {
        keys.push(`source:${candidate.source.instanceId}`);
    }
    return keys;
}

function alreadyUsed(candidate: BotActionCandidate, used: ReadonlySet<string>): boolean {
    return candidate.kind !== 'pass' && usageKeys(candidate).some((key) => used.has(key));
}

function limitScopeId(state: PlanningState, scope: BotActionCandidate['limits'][number]['scope']): string | undefined {
    return scope === 'conflict' ? state.scopes.conflictId
        : scope === 'phase' ? state.scopes.phaseId
            : scope === 'round' ? state.scopes.roundId : state.scopes.gameId;
}

function respectsProjectedUsage(state: PlanningState, candidate: BotActionCandidate): boolean {
    return candidate.limits.every((limit) => {
        const scopeId = limitScopeId(state, limit.scope);
        if(!scopeId) return true;
        const used = state.ledgers.usage.find((entry) =>
            entry.key === limit.key && entry.scope === limit.scope && entry.scopeId === scopeId)?.count || 0;
        return used < limit.maximum;
    });
}

function hasProjectedPayoff(state: PlanningState, candidate: BotActionCandidate): boolean {
    const stateful = candidate.effects.filter((effect) =>
        ['bow', 'ready', 'move', 'status', 'remove'].includes(effect.kind) && effect.target?.kind === 'character');
    if(stateful.length === 0) return true;
    return stateful.some((effect) => {
        const effectTarget = effect.target?.kind === 'character' ? effect.target : undefined;
        const target = effectTarget
            ? state.characters.find((character) => character.instanceId === effectTarget.instanceId)
            : undefined;
        if(!target) return false;
        if(effect.kind === 'bow') return !target.bowed && target.ready;
        if(effect.kind === 'ready') return target.bowed || !target.ready;
        if(effect.kind === 'move') return effect.destination === 'conflict' ? !target.participating : target.participating;
        if(effect.kind === 'status') {
            return effect.status === 'honored' ? !target.honored
                : effect.status === 'dishonored' ? !target.dishonored
                    : target.honored || target.dishonored;
        }
        return effect.kind === 'remove';
    });
}

function compare(value: number, operator: string, expected: number): boolean {
    if(operator === 'gt') return value > expected;
    if(operator === 'gte') return value >= expected;
    if(operator === 'lt') return value < expected;
    if(operator === 'lte') return value <= expected;
    if(operator === 'neq') return value !== expected;
    return value === expected;
}

function respectsHardConstraints(state: PlanningState, candidate: BotActionCandidate, actorId: PlayerId,
    profile: UtilityProfile): boolean {
    const player = state.players[actorId];
    const fateReduction = state.ledgers.delayedEffects.filter((effect) => {
        if(!effect.id.startsWith('reduction:fate:')) return false;
        const appliesTo = effect.id.split(':').slice(3).join(':');
        return !appliesTo || candidate.tags.includes(appliesTo as any) || candidate.source?.cardId === appliesTo;
    }).reduce((sum, effect) => sum + (Number(effect.id.split(':')[2]) || 0), 0);
    const fateCost = Math.max(0, (candidate.costs.fate || 0) - fateReduction);
    if(!player || player.fate < fateCost ||
        player.honor < Math.max(0, candidate.costs.honor || 0)) return false;
    const hand = state.hands.find((entry) => entry.playerId === actorId);
    if((hand?.size || 0) < Math.max(0, candidate.costs.cards || 0)) return false;
    if(!respectsProjectedUsage(state, candidate) || !hasProjectedPayoff(state, candidate)) return false;
    return (profile.constraints || []).filter((constraint) => constraint.kind === 'hard').every((constraint) => {
        const expected = Number(constraint.predicate.value) || 0;
        const fateAfter = player.fate - fateCost;
        const honorAfter = player.honor - Math.max(0, candidate.costs.honor || 0);
        const readyAfter = state.characters.filter((character) => character.controllerId === actorId && character.ready &&
            !candidate.targets.some((target: any) => target.instanceId === character.instanceId && candidate.effects.some((effect) => effect.kind === 'bow'))).length;
        const actual = constraint.predicate.kind.includes('fate') ? fateAfter
            : constraint.predicate.kind.includes('honor') ? honorAfter
                : constraint.predicate.kind.includes('defender') ? readyAfter
                    : constraint.predicate.kind.includes('conflict-opportunity')
                        ? state.opportunities.remainingTotalByPlayer?.[actorId] ??
                            state.opportunities.remainingByPlayer[actorId]?.military +
                            state.opportunities.remainingByPlayer[actorId]?.political
                        : undefined;
        return actual === undefined || compare(actual, constraint.predicate.operator, expected);
    });
}

export default class TacticalSearch {
    private readonly simulator = new EffectSimulator();
    private readonly utility = new UtilityEvaluator();

    prescore(state: PlanningState, candidates: readonly BotActionCandidate[], profile: UtilityProfile = {},
        limits: Partial<TacticalSearchLimits> = {}): readonly RankedCandidate[] {
        const resolved = { ...DEFAULT_LIMITS, ...profile.searchLimits, ...limits };
        const ranked = candidates.filter((candidate) => respectsHardConstraints(state, candidate, state.perspectivePlayerId, profile))
            .map((candidate) => ({ candidate, score: this.utility.evaluate(state, candidate, profile) }))
            .sort(compareScored);
        const nondominated: RankedCandidate[] = [];
        const bestByEffects = new Map<string, RankedCandidate>();
        for(const entry of ranked) {
            const key = effectIdentity(entry.candidate);
            const best = bestByEffects.get(key);
            if(!best || costs(entry.candidate) < costs(best.candidate) ||
                (costs(entry.candidate) === costs(best.candidate) && entry.score.scalar > best.score.scalar)) {
                if(best) nondominated.splice(nondominated.indexOf(best), 1);
                bestByEffects.set(key, entry);
                nondominated.push(entry);
            }
        }
        nondominated.sort(compareScored);
        const kept: RankedCandidate[] = nondominated.slice(0, resolved.beamWidth);
        for(const entry of nondominated) {
            if(kept.length >= resolved.maxCandidates) break;
            const distinct = !kept.some((current) => current.candidate.kind === entry.candidate.kind) ||
                entry.candidate.effects.some((effect) => !kept.some((current) => current.candidate.effects.some((existing) => existing.kind === effect.kind))) ||
                entry.candidate.tags.some((tag) => !kept.some((current) => current.candidate.tags.includes(tag)));
            if(distinct && !kept.includes(entry)) kept.push(entry);
        }
        return immutable(kept.sort(compareScored).slice(0, resolved.maxCandidates)) as readonly RankedCandidate[];
    }

    search(state: PlanningState, candidates: readonly BotActionCandidate[], profile: UtilityProfile = {}, options: {
        readonly limits?: Partial<TacticalSearchLimits>;
        readonly responseProvider?: ResponseProvider;
    } = {}): TacticalSearchResult {
        const limits = { ...DEFAULT_LIMITS, ...profile.searchLimits, ...options.limits };
        const startedAt = Date.now();
        const rootActor = state.perspectivePlayerId;
        const roots = this.prescore(state, candidates, profile, limits);
        const prunedCandidates = Math.max(0, candidates.length - roots.length);
        if(roots.length === 0) return immutable({
            complete: true, utility: -Infinity, principalLine: [], searchNodes: [], rootEvaluations: [], searchedNodes: 0,
            prunedCandidates, exhausted: false, elapsedMs: Date.now() - startedAt, reason: 'no-candidates'
        });

        let searchedNodes = 0;
        let exhausted = false;
        const searchNodes: SearchTraceNode[] = [];
        const candidateKeys = new Map(candidates.map((candidate) =>
            [candidate.id, semanticCandidateOrderKey(candidate)]));
        const budgetReached = () => searchedNodes >= limits.nodeBudget ||
            (limits.elapsedMs !== undefined && Date.now() - startedAt >= limits.elapsedMs);
        const explore = (node: SearchNode): SearchNode => {
            if(node.ply >= limits.depth || node.consecutivePasses >= 2 || terminal(node.state) || phaseBoundary(node.state)) {
                return { ...node, value: node.value + this.leafUtility(node.state, rootActor) * Math.pow(limits.distanceDiscount, node.ply) };
            }
            const available = node.actorId === rootActor
                ? this.prescore(node.state, candidates.filter((candidate) =>
                    !alreadyUsed(candidate, node.used)), profile, limits)
                : this.prescore({ ...node.state, perspectivePlayerId: node.actorId },
                    (options.responseProvider?.(node.state, node.actorId, node.ply) || [])
                        .filter((candidate) => !alreadyUsed(candidate, node.used))
                        .filter((candidate) => respectsHardConstraints(node.state, candidate, node.actorId, profile)), profile, {
                    ...limits, beamWidth: Math.max(1, Math.floor(limits.beamWidth / 2)),
                    maxCandidates: Math.max(1, Math.floor(limits.maxCandidates / 2))
                });
            if(available.length === 0) {
                return { ...node, value: node.value + this.leafUtility(node.state, rootActor) * Math.pow(limits.distanceDiscount, node.ply) };
            }
            for(const entry of available) {
                candidateKeys.set(entry.candidate.id, semanticCandidateOrderKey(entry.candidate));
            }
            const children: SearchNode[] = [];
            for(const entry of available) {
                if(budgetReached()) {
                    exhausted = true;
                    break;
                }
                searchedNodes++;
                const projection = this.simulator.apply(node.state, entry.candidate, node.actorId);
                const sign = node.actorId === rootActor ? 1 : -1;
                const discounted = entry.score.scalar * Math.pow(limits.distanceDiscount, node.ply) * sign -
                    entry.candidate.uncertainty * limits.uncertaintyPenalty;
                const used = new Set(node.used);
                usageKeys(entry.candidate).forEach((key) => used.add(key));
                const child = explore({
                    state: projection.state,
                    actorId: opponentId(node.state, node.actorId),
                    ply: node.ply + 1,
                    value: node.value + discounted,
                    line: [...node.line, {
                        ply: node.ply,
                        actorId: node.actorId,
                        candidateId: entry.candidate.id,
                        candidateKind: entry.candidate.kind,
                        score: discounted,
                        stateSignature: projection.state.materialStateSignature
                    }],
                    used,
                    consecutivePasses: entry.candidate.kind === 'pass' ? node.consecutivePasses + 1 : 0
                });
                children.push(child);
                searchNodes.push({
                    ply: node.ply,
                    actorId: node.actorId,
                    candidateId: entry.candidate.id,
                    candidateKind: entry.candidate.kind,
                    score: discounted,
                    stateSignature: projection.state.materialStateSignature,
                    parentCandidateId: node.line[node.line.length - 1]?.candidateId,
                    lineValue: child.value,
                    terminal: child.ply >= limits.depth || child.consecutivePasses >= 2 ||
                        terminal(child.state) || phaseBoundary(child.state)
                });
                if(exhausted) break;
            }
            if(children.length === 0) return node;
            children.sort((left, right) => left.value - right.value ||
                semanticLineOrderKey(left.line, candidateKeys).localeCompare(semanticLineOrderKey(right.line, candidateKeys)));
            return node.actorId === rootActor ? children[children.length - 1] : children[0];
        };
        const rootResults: SearchNode[] = [];
        for(const entry of roots) {
            if(budgetReached()) {
                exhausted = true;
                break;
            }
            searchedNodes++;
            const projection = this.simulator.apply(state, entry.candidate, rootActor);
            const discounted = entry.score.scalar - entry.candidate.uncertainty * limits.uncertaintyPenalty;
            const rootResult = explore({
                state: projection.state,
                actorId: opponentId(state, rootActor),
                ply: 1,
                value: discounted,
                line: [{
                    ply: 0, actorId: rootActor, candidateId: entry.candidate.id,
                    candidateKind: entry.candidate.kind, score: discounted,
                    stateSignature: projection.state.materialStateSignature
                }],
                used: new Set(usageKeys(entry.candidate)),
                consecutivePasses: entry.candidate.kind === 'pass' ? 1 : 0
            });
            rootResults.push(rootResult);
            searchNodes.push({
                ply: 0,
                actorId: rootActor,
                candidateId: entry.candidate.id,
                candidateKind: entry.candidate.kind,
                score: discounted,
                stateSignature: projection.state.materialStateSignature,
                lineValue: rootResult.value,
                terminal: rootResult.ply >= limits.depth || rootResult.consecutivePasses >= 2 ||
                    terminal(rootResult.state) || phaseBoundary(rootResult.state)
            });
            if(exhausted) break;
        }
        rootResults.sort((left, right) => right.value - left.value ||
            semanticLineOrderKey(left.line, candidateKeys).localeCompare(semanticLineOrderKey(right.line, candidateKeys)));
        const best = rootResults[0];
        const firstId = best?.line[0]?.candidateId;
        const rootEvaluations = rootResults.map((result) => ({
            candidateId: result.line[0]?.candidateId,
            utility: result.value,
            line: result.line
        })).filter((entry) => !!entry.candidateId);
        return immutable({
            complete: !exhausted,
            firstCandidate: roots.find((entry) => entry.candidate.id === firstId)?.candidate,
            utility: best?.value ?? -Infinity,
            principalLine: best?.line || [],
            searchNodes,
            rootEvaluations,
            searchedNodes,
            prunedCandidates,
            exhausted,
            elapsedMs: Date.now() - startedAt,
            reason: exhausted ? 'budget-exhausted' : 'complete'
        }) as TacticalSearchResult;
    }

    /**
     * Searches each coherent opponent hand/response package independently,
     * then maximizes the worst result for every root action. This avoids
     * combining mutually exclusive fair-information hypotheses into an
     * impossible super-hand while remaining pessimistic across hypotheses.
     */
    searchScenarios(state: PlanningState, candidates: readonly BotActionCandidate[],
        responseScenarios: readonly TacticalResponseScenario[], profile: UtilityProfile = {},
        options: { readonly limits?: Partial<TacticalSearchLimits> } = {}): TacticalSearchResult {
        const startedAt = Date.now();
        const limits = { ...DEFAULT_LIMITS, ...profile.searchLimits, ...options.limits };
        const scenarios = responseScenarios.length > 0
            ? [...responseScenarios].sort((left, right) => left.id.localeCompare(right.id))
            : [{ id: 'response:none', candidates: [] }];
        const perScenarioLimits = {
            ...limits,
            nodeBudget: Math.max(64, Math.floor(limits.nodeBudget / scenarios.length)),
            elapsedMs: limits.elapsedMs === undefined ? undefined
                : Math.max(100, Math.floor(limits.elapsedMs / scenarios.length))
        };
        const results = scenarios.map((scenario) => ({
            scenario,
            result: this.search(state, candidates, profile, {
                limits: perScenarioLimits,
                responseProvider: () => scenario.candidates
            })
        }));
        const candidateKey = (candidateId: string): string => {
            const candidate = candidates.find((entry) => entry.id === candidateId);
            return candidate ? semanticCandidateOrderKey(candidate) : candidateId;
        };
        const compareCandidateIds = (left: string, right: string): number =>
            candidateKey(left).localeCompare(candidateKey(right)) || left.localeCompare(right);
        const candidateIds = [...new Set(results.flatMap(({ result }) =>
            result.rootEvaluations.map((entry) => entry.candidateId)))].sort(compareCandidateIds);
        const pessimistic = candidateIds.map((candidateId) => {
            const evaluations = results.map(({ scenario, result }) => {
                const evaluation = result.rootEvaluations.find((entry) => entry.candidateId === candidateId);
                return {
                    candidateId,
                    utility: evaluation?.utility ?? -Infinity,
                    line: evaluation?.line || [],
                    responseScenarioId: scenario.id
                };
            }).sort((left, right) => left.utility - right.utility ||
                left.responseScenarioId.localeCompare(right.responseScenarioId));
            return evaluations[0];
        }).sort((left, right) => right.utility - left.utility ||
            compareCandidateIds(left.candidateId, right.candidateId));
        const best = pessimistic[0];
        const exhausted = results.some(({ result }) => result.exhausted);
        return immutable({
            complete: !exhausted && results.every(({ result }) => result.complete),
            firstCandidate: candidates.find((candidate) => candidate.id === best?.candidateId),
            utility: best?.utility ?? -Infinity,
            principalLine: best?.line || [],
            searchNodes: results.flatMap(({ result }) => result.searchNodes),
            rootEvaluations: pessimistic,
            searchedNodes: results.reduce((sum, { result }) => sum + result.searchedNodes, 0),
            prunedCandidates: Math.max(0, ...results.map(({ result }) => result.prunedCandidates)),
            exhausted,
            elapsedMs: Date.now() - startedAt,
            reason: exhausted ? 'scenario-budget-exhausted' : 'complete'
        }) as TacticalSearchResult;
    }

    private leafUtility(state: PlanningState, rootActor: PlayerId): number {
        const opponent = opponentId(state, rootActor);
        const me = state.players[rootActor];
        const them = state.players[opponent];
        if(!me || !them) return 0;
        if(me.honor <= 0 || state.provinces.some((province) => province.controllerId === rootActor && province.stronghold && province.broken)) return -10000;
        if(them.honor <= 0 || state.provinces.some((province) => province.controllerId === opponent && province.stronghold && province.broken)) return 10000;
        const readyMine = state.board.readySkillByPlayer[rootActor];
        const readyTheirs = state.board.readySkillByPlayer[opponent];
        const conflictMargin = state.conflict
            ? (state.conflict.attackerId === rootActor ? 1 : -1) * (state.conflict.attackerSkill - state.conflict.defenderSkill)
            : 0;
        return Math.max(-1, Math.min(1, conflictMargin)) * 2 +
            ((readyMine?.military || 0) + (readyMine?.political || 0) - (readyTheirs?.military || 0) - (readyTheirs?.political || 0)) * 0.25 +
            (me.fate - them.fate) + (me.honor - them.honor) * 0.2 +
            (me.conflictDeckSize - them.conflictDeckSize) * 0.1 +
            (them.brokenProvinceCount - me.brokenProvinceCount) * 5;
    }
}
