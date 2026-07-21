import type { BotActionCandidate } from '../model/Candidate';
import type { CharacterProjection, PlanningState, ProvinceProjection } from '../model/PlanningState';
import type { ConflictType, PlayerId } from '../model/References';
import { immutable, stableHash } from '../model/Stable';
import type { OpponentInformationSnapshot, OpponentResponsePackage } from '../information/OpponentInformationProvider';
import EffectSimulator from '../search/EffectSimulator.js';

export interface TerminalSolverProfile {
    readonly honorDanger?: number;
    readonly honorVictoryDistance?: number;
    readonly deckDanger?: number;
    readonly maximumRemainingOpportunities?: number;
    readonly conflictDeckReshuffleHonorLoss?: number;
    readonly fairAggregation?: 'expected' | 'pessimistic' | 'optimistic';
    readonly maximumResponseBranches?: number;
}

export type TerminalReason = 'stronghold-exposed' | 'honor-terminal' | 'deck-exhaustion' |
    'short-conflict-sequence' | 'forced-honor-transfer';
export type TerminalStatus = 'forced-win' | 'avoids-forced-loss' | 'forced-loss' | 'nonterminal';

export interface TerminalConflictResult {
    readonly attackerId?: PlayerId;
    readonly defenderId?: PlayerId;
    readonly attackerSkill: number;
    readonly defenderSkill: number;
    readonly winnerId?: PlayerId;
    readonly ringAwarded: boolean;
    readonly provinceBroken: boolean;
    readonly strongholdBroken: boolean;
    readonly provinceStrength: number;
}

export interface TerminalBranchResult {
    readonly id: string;
    readonly weight: number;
    readonly winnerId?: PlayerId;
    readonly loserId?: PlayerId;
    readonly terminalReason?: string;
    readonly value: number;
    readonly currentConflict?: TerminalConflictResult;
    readonly projectedConflicts: readonly TerminalConflictResult[];
    readonly responseCandidateIds: readonly string[];
}

export interface TerminalCandidateEvaluation {
    readonly candidateId: string;
    readonly status: TerminalStatus;
    readonly terminalRank: number;
    readonly expected: number;
    readonly pessimistic: number;
    readonly optimistic: number;
    readonly aggregate: number;
    readonly branches: readonly TerminalBranchResult[];
}

export interface TerminalSolverResult {
    readonly active: boolean;
    readonly reasons: readonly TerminalReason[];
    readonly exact: boolean;
    readonly aggregation: 'expected' | 'pessimistic' | 'optimistic';
    readonly complete: boolean;
    readonly firstCandidate?: BotActionCandidate;
    readonly selected?: TerminalCandidateEvaluation;
    readonly evaluations: readonly TerminalCandidateEvaluation[];
    readonly searchedBranches: number;
    readonly principalLine: readonly string[];
}

const DEFAULTS: Required<TerminalSolverProfile> = {
    honorDanger: 5,
    honorVictoryDistance: 5,
    deckDanger: 5,
    maximumRemainingOpportunities: 2,
    conflictDeckReshuffleHonorLoss: 5,
    fairAggregation: 'pessimistic',
    maximumResponseBranches: 24
};

interface MutableRace {
    readonly players: Record<PlayerId, { honor: number; broken: number }>;
    readonly provinces: (ProvinceProjection & { broken: boolean })[];
    readonly characters: (CharacterProjection & { ready: boolean; bowed: boolean })[];
    readonly opportunities: Record<PlayerId, Record<ConflictType, number>>;
}

function otherPlayer(state: PlanningState, playerId: PlayerId): PlayerId {
    return Object.keys(state.players).find((id) => id !== playerId) || playerId;
}

function liveProvinceStrength(state: PlanningState, defenderId: PlayerId, location?: string): number {
    const province = state.provinces.find((entry) => entry.controllerId === defenderId && entry.location === location);
    return Math.max(0, province?.effectiveStrength ?? state.conflict?.provinceStrength ?? state.conflict?.breakThreshold ?? 0);
}

/** Jigoku awards a positive tie to the attacker; a 0-0 conflict has no winner. */
export function resolveTerminalConflict(state: PlanningState): TerminalConflictResult | undefined {
    const conflict = state.conflict;
    if(!conflict?.attackerId || !conflict.defenderId) return undefined;
    const attackerSkill = Math.max(0, conflict.attackerSkill);
    const defenderSkill = Math.max(0, conflict.defenderSkill);
    const zeroTie = attackerSkill === 0 && defenderSkill === 0;
    const attackerWins = !zeroTie && attackerSkill >= defenderSkill;
    const winnerId = zeroTie ? undefined : attackerWins ? conflict.attackerId : conflict.defenderId;
    const provinceStrength = liveProvinceStrength(state, conflict.defenderId, conflict.provinceLocation);
    const provinceBroken = attackerWins && attackerSkill - defenderSkill >= provinceStrength;
    return {
        attackerId: conflict.attackerId,
        defenderId: conflict.defenderId,
        attackerSkill,
        defenderSkill,
        winnerId,
        ringAwarded: !!winnerId,
        provinceBroken,
        strongholdBroken: provinceBroken && conflict.provinceLocation === 'stronghold province',
        provinceStrength
    };
}

function deckDrawPenalty(before: PlanningState, candidate: BotActionCandidate, actorId: PlayerId,
    reshuffleHonorLoss: number): number {
    let penalty = 0;
    for(const effect of candidate.effects) {
        if(effect.kind !== 'deck' || !effect.draw) continue;
        const target: any = effect.target;
        const playerId = String(target?.id || target?.controllerId || actorId);
        if(playerId !== actorId) continue;
        if(effect.draw > (before.players[playerId]?.conflictDeckSize || 0)) penalty += reshuffleHonorLoss;
    }
    return penalty;
}

function adjustHonor(state: PlanningState, playerId: PlayerId, delta: number): PlanningState {
    if(delta === 0 || !state.players[playerId]) return state;
    const players = {
        ...state.players,
        [playerId]: { ...state.players[playerId], honor: state.players[playerId].honor + delta }
    };
    return immutable({
        ...state,
        players,
        resources: {
            ...state.resources,
            honorByPlayer: { ...state.resources.honorByPlayer, [playerId]: players[playerId].honor }
        },
        materialStateSignature: stableHash({ prior: state.materialStateSignature, honor: players[playerId].honor, playerId })
    }) as PlanningState;
}

function eligible(character: CharacterProjection, actorId: PlayerId, type: ConflictType): boolean {
    return character.controllerId === actorId && character.ready && !character.bowed &&
        (type === 'military' ? character.canAttackMilitary : character.canAttackPolitical) &&
        !character.attackRestrictions.includes(type);
}

function skill(character: CharacterProjection, type: ConflictType): number {
    return Math.max(0, type === 'military' ? character.military : character.political);
}

function terminalOwner(race: MutableRace): { winnerId?: PlayerId; loserId?: PlayerId; reason?: string } {
    for(const [id, player] of Object.entries(race.players)) {
        if(player.honor <= 0) return { loserId: id, winnerId: Object.keys(race.players).find((other) => other !== id), reason: 'dishonor' };
        if(player.honor >= 25) return { winnerId: id, loserId: Object.keys(race.players).find((other) => other !== id), reason: 'honor' };
    }
    const brokenStronghold = race.provinces.find((province) => province.stronghold && province.broken);
    if(brokenStronghold) {
        return {
            loserId: brokenStronghold.controllerId,
            winnerId: Object.keys(race.players).find((id) => id !== brokenStronghold.controllerId),
            reason: 'stronghold'
        };
    }
    return {};
}

function asRace(state: PlanningState): MutableRace {
    return {
        players: Object.fromEntries(Object.entries(state.players).map(([id, player]) => [id, {
            honor: player.honor,
            broken: player.brokenProvinceCount
        }])),
        provinces: state.provinces.map((province) => ({ ...province, holdingIds: [...province.holdingIds] })),
        characters: state.characters.map((character) => ({
            ...character,
            traits: [...character.traits], attachments: [...character.attachments]
        })),
        opportunities: Object.fromEntries(Object.entries(state.opportunities.remainingByPlayer).map(([id, opportunities]) => [id, {
            military: opportunities.military,
            political: opportunities.political
        }]))
    };
}

function applyCurrentConflict(race: MutableRace, state: PlanningState, result: TerminalConflictResult | undefined): void {
    if(!result || !result.attackerId || !result.defenderId) return;
    if(result.provinceBroken) {
        const province = race.provinces.find((entry) =>
            entry.controllerId === result.defenderId && entry.location === state.conflict?.provinceLocation);
        if(province) province.broken = true;
        race.players[result.defenderId].broken++;
    }
    for(const character of race.characters) {
        if(!character.participating) continue;
        character.ready = character.noBowAfterConflict;
        character.bowed = !character.noBowAfterConflict;
    }
}

function bestTarget(race: MutableRace, defenderId: PlayerId): (ProvinceProjection & { broken: boolean }) | undefined {
    const stronghold = race.provinces.find((province) => province.controllerId === defenderId && province.stronghold);
    if(race.players[defenderId].broken >= 3 && stronghold && !stronghold.broken) return stronghold;
    return race.provinces.filter((province) => province.controllerId === defenderId && !province.stronghold && !province.broken)
        .sort((left, right) => left.effectiveStrength - right.effectiveStrength || left.location.localeCompare(right.location))[0];
}

function projectOneConflict(race: MutableRace, attackerId: PlayerId, defenderId: PlayerId,
    type: ConflictType): TerminalConflictResult {
    const attackers = race.characters.filter((character) => eligible(character, attackerId, type));
    const defenders = race.characters.filter((character) => eligible(character, defenderId, type));
    const covert = attackers.some((character) => character.covert);
    const excluded = covert ? [...defenders].sort((left, right) => skill(right, type) - skill(left, type) ||
        left.instanceId.localeCompare(right.instanceId))[0] : undefined;
    const committedDefenders = defenders.filter((character) => character !== excluded);
    const attackerSkill = attackers.reduce((sum, character) => sum + skill(character, type), 0);
    const defenderSkill = committedDefenders.reduce((sum, character) => sum + skill(character, type), 0);
    const target = bestTarget(race, defenderId);
    const provinceStrength = Math.max(0, target?.effectiveStrength || 0);
    const zeroTie = attackerSkill === 0 && defenderSkill === 0;
    const attackerWins = !zeroTie && attackerSkill >= defenderSkill;
    const winnerId = zeroTie ? undefined : attackerWins ? attackerId : defenderId;
    const provinceBroken = !!target && attackerWins && attackerSkill - defenderSkill >= provinceStrength;
    if(provinceBroken && target) {
        target.broken = true;
        race.players[defenderId].broken++;
    }
    for(const character of [...attackers, ...committedDefenders]) {
        character.ready = character.noBowAfterConflict;
        character.bowed = !character.noBowAfterConflict;
    }
    return {
        attackerId, defenderId, attackerSkill, defenderSkill, winnerId,
        ringAwarded: !!winnerId,
        provinceBroken,
        strongholdBroken: provinceBroken && !!target?.stronghold,
        provinceStrength
    };
}

function projectRace(state: PlanningState, current: TerminalConflictResult | undefined): {
    race: MutableRace;
    projected: TerminalConflictResult[];
} {
    const race = asRace(state);
    applyCurrentConflict(race, state, current);
    const projected: TerminalConflictResult[] = [];
    let actor = state.conflict?.attackerId ? otherPlayer(state, state.conflict.attackerId) :
        Object.values(state.players).find((player) => player.firstPlayer)?.id || state.perspectivePlayerId;
    const maximum = Object.values(race.opportunities).reduce((sum, entry) => sum + entry.military + entry.political, 0);
    let idle = 0;
    let spent = 0;
    let guard = 0;
    while(spent < maximum && idle < 2 && guard++ < maximum * 3 + 2) {
        if(terminalOwner(race).winnerId) break;
        const opportunities = race.opportunities[actor] || { military: 0, political: 0 };
        const defender = otherPlayer(state, actor);
        const choices = (['military', 'political'] as ConflictType[]).filter((type) => opportunities[type] > 0)
            .map((type) => ({
                type,
                skill: race.characters.filter((character) => eligible(character, actor, type))
                    .reduce((sum, character) => sum + skill(character, type), 0)
            }))
            .sort((left, right) => right.skill - left.skill || left.type.localeCompare(right.type));
        if(choices.length === 0) {
            idle++;
            actor = defender;
            continue;
        }
        idle = 0;
        opportunities[choices[0].type]--;
        spent++;
        projected.push(projectOneConflict(race, actor, defender, choices[0].type));
        actor = defender;
    }
    return { race, projected };
}

function branchValue(rootId: PlayerId, race: MutableRace, terminal: ReturnType<typeof terminalOwner>): number {
    if(terminal.winnerId === rootId) return 1_000_000;
    if(terminal.loserId === rootId) return -1_000_000;
    const opponent = Object.keys(race.players).find((id) => id !== rootId) || rootId;
    return (race.players[opponent].broken - race.players[rootId].broken) * 100 +
        (race.players[rootId].honor - race.players[opponent].honor) * 2;
}

export default class TerminalSolver {
    private readonly simulator = new EffectSimulator();

    activationReasons(state: PlanningState, candidates: readonly BotActionCandidate[] = [],
        profile: TerminalSolverProfile = {}): readonly TerminalReason[] {
        const options = { ...DEFAULTS, ...profile };
        const reasons = new Set<TerminalReason>();
        if(Object.values(state.players).some((player) => player.brokenProvinceCount >= 3) ||
            state.provinces.some((province) => province.stronghold && (province.attackEligible || province.inConflict)) ||
            state.conflict?.provinceLocation === 'stronghold province') reasons.add('stronghold-exposed');
        if(Object.values(state.players).some((player) => player.honor <= options.honorDanger ||
            25 - player.honor <= options.honorVictoryDistance)) reasons.add('honor-terminal');
        if(Object.values(state.players).some((player) => player.conflictDeckSize <= options.deckDanger)) reasons.add('deck-exhaustion');
        if(state.opportunities.totalRemaining <= options.maximumRemainingOpportunities) reasons.add('short-conflict-sequence');
        if(candidates.some((candidate) => candidate.effects.some((effect) =>
            (effect.kind === 'duel' && !!effect.honorDelta) || (effect.kind === 'resource' && !!effect.honor)))) {
            reasons.add('forced-honor-transfer');
        }
        return [...reasons].sort();
    }

    solve(state: PlanningState, candidates: readonly BotActionCandidate[], information: OpponentInformationSnapshot,
        profile: TerminalSolverProfile = {}): TerminalSolverResult {
        const options = { ...DEFAULTS, ...profile };
        const reasons = this.activationReasons(state, candidates, options);
        const aggregation = information.mode === 'omniscient' ? 'pessimistic' : options.fairAggregation;
        if(reasons.length === 0 || candidates.length === 0) {
            return immutable({
                active: reasons.length > 0, reasons, exact: information.mode === 'omniscient', aggregation,
                complete: true, evaluations: [], searchedBranches: 0, principalLine: []
            }) as TerminalSolverResult;
        }
        const packages = this.responseBranches(information, options.maximumResponseBranches);
        let searchedBranches = 0;
        const raw = candidates.map((candidate) => {
            const branches = packages.map((pkg) => {
                searchedBranches++;
                return this.evaluateBranch(state, candidate, pkg, options.conflictDeckReshuffleHonorLoss);
            });
            const weightTotal = branches.reduce((sum, branch) => sum + branch.weight, 0) || 1;
            const expected = branches.reduce((sum, branch) => sum + branch.value * branch.weight, 0) / weightTotal;
            const pessimistic = Math.min(...branches.map((branch) => branch.value));
            const optimistic = Math.max(...branches.map((branch) => branch.value));
            const aggregate = aggregation === 'expected' ? expected : aggregation === 'optimistic' ? optimistic : pessimistic;
            return { candidate, branches, expected, pessimistic, optimistic, aggregate };
        });
        const pass = raw.find((entry) => entry.candidate.kind === 'pass');
        const baselineForcedLoss = !!pass && pass.branches.every((branch) => branch.loserId === state.perspectivePlayerId);
        const evaluations: TerminalCandidateEvaluation[] = raw.map((entry) => {
            const allWin = entry.branches.every((branch) => branch.winnerId === state.perspectivePlayerId);
            const allLoss = entry.branches.every((branch) => branch.loserId === state.perspectivePlayerId);
            const avoidsLoss = baselineForcedLoss && entry.branches.every((branch) => branch.loserId !== state.perspectivePlayerId);
            const status: TerminalStatus = allWin ? 'forced-win' : avoidsLoss ? 'avoids-forced-loss' : allLoss ? 'forced-loss' : 'nonterminal';
            return {
                candidateId: entry.candidate.id,
                status,
                terminalRank: status === 'forced-win' ? 5 : status === 'avoids-forced-loss' ? 4 : status === 'forced-loss' ? 0 : 1,
                expected: entry.expected, pessimistic: entry.pessimistic, optimistic: entry.optimistic,
                aggregate: entry.aggregate, branches: entry.branches
            };
        }).sort((left, right) => right.terminalRank - left.terminalRank || right.aggregate - left.aggregate ||
            Number(candidates.find((candidate) => candidate.id === right.candidateId)?.kind === 'pass') -
                Number(candidates.find((candidate) => candidate.id === left.candidateId)?.kind === 'pass') ||
            left.candidateId.localeCompare(right.candidateId));
        const selected = evaluations[0];
        const firstCandidate = candidates.find((candidate) => candidate.id === selected?.candidateId);
        const worst = selected?.branches.slice().sort((left, right) => left.value - right.value || left.id.localeCompare(right.id))[0];
        return immutable({
            active: true, reasons, exact: information.mode === 'omniscient', aggregation, complete: true,
            firstCandidate, selected, evaluations, searchedBranches,
            principalLine: [selected?.candidateId, ...(worst?.responseCandidateIds || [])].filter(Boolean) as string[]
        }) as TerminalSolverResult;
    }

    private responseBranches(information: OpponentInformationSnapshot, maximum: number): readonly (OpponentResponsePackage | undefined)[] {
        return [undefined, ...information.responsePackages.slice(0, Math.max(0, maximum - 1))];
    }

    private evaluateBranch(state: PlanningState, candidate: BotActionCandidate, response: OpponentResponsePackage | undefined,
        reshuffleHonorLoss: number): TerminalBranchResult {
        const root = state.perspectivePlayerId;
        const opponent = otherPlayer(state, root);
        let projected = this.simulator.apply(state, candidate, root).state;
        projected = adjustHonor(projected, root, -deckDrawPenalty(state, candidate, root, reshuffleHonorLoss));
        for(const responseCandidate of response?.candidates || []) {
            const before = projected;
            projected = this.simulator.apply(projected, responseCandidate, opponent).state;
            projected = adjustHonor(projected, opponent,
                -deckDrawPenalty(before, responseCandidate, opponent, reshuffleHonorLoss));
        }
        const currentConflict = resolveTerminalConflict(projected);
        const sequence = projectRace(projected, currentConflict);
        const terminal = terminalOwner(sequence.race);
        return immutable({
            id: response?.id || 'response:pass',
            weight: response?.weight || 1,
            winnerId: terminal.winnerId,
            loserId: terminal.loserId,
            terminalReason: terminal.reason,
            value: branchValue(root, sequence.race, terminal),
            currentConflict,
            projectedConflicts: sequence.projected,
            responseCandidateIds: response?.candidates.map((entry) => entry.id) || []
        }) as TerminalBranchResult;
    }
}
