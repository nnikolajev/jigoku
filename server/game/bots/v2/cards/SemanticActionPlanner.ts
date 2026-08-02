import { candidateId, type BotActionCandidate } from '../model/Candidate';
import type { ActionMacro } from '../model/Macro';
import type { AttachmentProjection, CharacterProjection, PlanningState } from '../model/PlanningState';
import type { CardRef, CharacterRef } from '../model/References';
import type { EffectDescriptor } from '../model/Effects';
import { immutable } from '../model/Stable';
import CardSemanticRegistry, { type ActionSemantic, type TargetSemantic } from './CardSemantics.js';
import { characterMaterialValue } from '../BoardValue.js';

const SOURCE_KINDS = new Set(['conflict-card', 'in-play-ability', 'reaction', 'interrupt']);

function targetRef(character: CharacterProjection): CharacterRef {
    return {
        kind: 'character',
        instanceId: character.instanceId,
        cardId: character.cardId,
        controllerId: character.controllerId
    };
}

function attachmentRef(attachment: AttachmentProjection): CardRef {
    return {
        kind: 'card',
        instanceId: attachment.instanceId,
        cardId: attachment.cardId,
        controllerId: attachment.controllerId,
        location: 'play area'
    };
}

function timingMatches(state: PlanningState, action: ActionSemantic): boolean {
    if(action.timings.includes('any')) return true;
    if(state.conflict && action.timings.includes('conflict')) return true;
    if(state.phase === 'conflict' && action.timings.includes('conflict-phase')) return true;
    if(state.phase === 'dynasty' && action.timings.includes('dynasty')) return true;
    return false;
}

function matchesTarget(state: PlanningState, character: CharacterProjection, rule: TargetSemantic): boolean {
    const own = character.controllerId === state.perspectivePlayerId;
    if(rule.side === 'self' && !own || rule.side === 'opponent' && own) return false;
    if(rule.participating === true && !character.participating) return false;
    if(rule.ready !== undefined && character.ready !== rule.ready) return false;
    if(rule.honored !== undefined && character.honored !== rule.honored) return false;
    if(rule.dishonored !== undefined && character.dishonored !== rule.dishonored) return false;
    if(rule.traits?.length) {
        const traits = new Set(character.traits.map((trait) => trait.toLowerCase()));
        if(!rule.traits.every((trait) => traits.has(trait.toLowerCase()))) return false;
    }
    return true;
}

function effectStateMatches(action: ActionSemantic, character: CharacterProjection): boolean {
    const move = action.effects.find((effect) => effect.kind === 'move');
    if(move?.kind === 'move') {
        if(move.destination === 'conflict' && character.participating) return false;
        if(move.destination === 'home' && !character.participating) return false;
    }
    if(action.effects.some((effect) => effect.kind === 'ready') && character.ready) return false;
    if(action.effects.some((effect) => effect.kind === 'bow') && character.bowed) return false;
    return true;
}

function targetScore(state: PlanningState, action: ActionSemantic, character: CharacterProjection): number {
    const conflictSkill = state.conflict?.type === 'political' ? character.political : character.military;
    const kinds = new Set(action.effects.map((effect) => effect.kind));
    let score = 0;
    if(character.participating) score += 100;
    if(kinds.has('ready')) score += character.bowed ? 160 : -160;
    if(kinds.has('move')) score += character.participating ? -80 : 80;
    if(kinds.has('bow') || kinds.has('remove')) score += conflictSkill * 8 + character.fate * 4;
    else score += conflictSkill * 4 + character.fate * 3 + character.glory * 2;
    if(kinds.has('status')) {
        const honored = action.effects.some((effect) => effect.kind === 'status' && effect.status === 'honored');
        const dishonored = action.effects.some((effect) => effect.kind === 'status' && effect.status === 'dishonored');
        if(honored && character.honored || dishonored && character.dishonored) score -= 200;
    }
    return score;
}

function macroFor(candidate: BotActionCandidate, target: CharacterRef | CardRef, state: PlanningState): ActionMacro {
    return {
        id: `macro:semantic:${candidate.source!.instanceId}:${target.instanceId}`,
        currentStep: 0,
        abortPolicy: 'fallback-v1',
        startedAtSignature: state.materialStateSignature,
        steps: [
            {
                id: 'source', kind: 'source', semanticValue: candidate.source!.cardId || candidate.source!.instanceId,
                expected: { promptIdentity: state.prompt.identity }, command: 'cardClicked',
                args: [candidate.source!.instanceId]
            },
            {
                id: 'target', kind: 'target', semanticValue: target.cardId || target.instanceId,
                expected: { phase: state.phase, conflictId: state.scopes.conflictId }, command: 'cardClicked',
                args: [target.instanceId]
            }
        ]
    };
}

function modeMacroFor(candidate: BotActionCandidate, target: CharacterRef, state: PlanningState,
    modeText: string): ActionMacro {
    return {
        id: `macro:semantic:${candidate.source!.instanceId}:${modeText}:${target.instanceId}`,
        currentStep: 0,
        abortPolicy: 'fallback-v1',
        startedAtSignature: state.materialStateSignature,
        steps: [
            {
                id: 'source', kind: 'source', semanticValue: candidate.source!.cardId || candidate.source!.instanceId,
                expected: { promptIdentity: state.prompt.identity }, command: 'cardClicked',
                args: [candidate.source!.instanceId]
            },
            {
                id: 'mode', kind: 'mode', semanticValue: modeText,
                expected: { promptTitle: 'Court Games' }, command: 'menuButton', args: []
            },
            {
                id: 'target', kind: 'target', semanticValue: target.cardId || target.instanceId,
                expected: { promptTitle: 'Court Games', phase: state.phase, conflictId: state.scopes.conflictId },
                command: 'cardClicked', args: [target.instanceId]
            }
        ]
    };
}

function nobleSacrificeMacroFor(candidate: BotActionCandidate, sacrifice: CharacterRef,
    victim: CharacterRef, state: PlanningState): ActionMacro {
    return {
        id: `macro:semantic:${candidate.source!.instanceId}:sacrifice:${sacrifice.instanceId}:discard:${victim.instanceId}`,
        currentStep: 0,
        abortPolicy: 'fallback-v1',
        startedAtSignature: state.materialStateSignature,
        steps: [
            {
                id: 'source', kind: 'source', semanticValue: candidate.source!.cardId || candidate.source!.instanceId,
                expected: { promptIdentity: state.prompt.identity }, command: 'cardClicked',
                args: [candidate.source!.instanceId]
            },
            {
                id: 'sacrifice-cost', kind: 'cost', semanticValue: sacrifice.cardId || sacrifice.instanceId,
                expected: { phase: state.phase, conflictId: state.scopes.conflictId }, command: 'cardClicked',
                args: [sacrifice.instanceId]
            },
            {
                id: 'discard-target', kind: 'target', semanticValue: victim.cardId || victim.instanceId,
                expected: { phase: state.phase, conflictId: state.scopes.conflictId }, command: 'cardClicked',
                args: [victim.instanceId]
            }
        ]
    };
}

function tacticalRoleTags(state: PlanningState, candidate: BotActionCandidate,
    target: CharacterRef | CardRef, effects: readonly EffectDescriptor[]): BotActionCandidate['tags'] {
    const defending = state.conflict?.defenderId === state.perspectivePlayerId;
    if(!defending) return candidate.tags;
    const protectsOwnConflict = target.controllerId === state.perspectivePlayerId && effects.some((effect) =>
        effect.kind === 'skill' || effect.kind === 'ready' ||
        effect.kind === 'move' && effect.destination === 'conflict' ||
        effect.kind === 'status' && effect.status === 'honored' || effect.kind === 'attachment');
    const disruptsAttacker = target.controllerId !== state.perspectivePlayerId && effects.some((effect) =>
        effect.kind === 'bow' || effect.kind === 'remove' ||
        effect.kind === 'status' && effect.status === 'dishonored' || effect.kind === 'skill');
    if(!protectsOwnConflict && !disruptsAttacker) return candidate.tags;
    return [...new Set([...candidate.tags.filter((tag) => tag !== 'offense'), 'defense' as const])];
}

/**
 * Turns exact-legal one-target action sources into coherent source/target
 * candidates. It describes commands only; live controller legality remains
 * authoritative at every macro step.
 */
export default class SemanticActionPlanner {
    constructor(private readonly registry: CardSemanticRegistry) {}

    expand(state: PlanningState, candidates: readonly BotActionCandidate[]): readonly BotActionCandidate[] {
        return immutable(candidates.flatMap((candidate) => this.expandCandidate(state, candidate))) as readonly BotActionCandidate[];
    }

    private expandCandidate(state: PlanningState, candidate: BotActionCandidate): readonly BotActionCandidate[] {
        if(!candidate.source || candidate.targets.length > 0 || candidate.confidence < 0.95 ||
            !SOURCE_KINDS.has(candidate.kind) || candidate.commandPreview.command !== 'cardClicked') {
            return [this.registry.enrich(state, candidate)];
        }
        const model = this.registry.get(candidate.source.cardId);
        if(candidate.source.cardId === 'noble-sacrifice' && model) {
            return this.expandNobleSacrifice(state, candidate, model.actions[0]);
        }
        if(candidate.source.cardId === 'court-games' && state.conflict?.type === 'political' &&
            model && model.confidence >= 0.9 && model.actions.length === 2) {
            return this.expandCourtGames(state, candidate, model.actions);
        }
        if(candidate.source.cardId === 'let-go' && model) {
            return this.expandLetGo(state, candidate, model.actions[0]);
        }
        if(!model || model.confidence < 0.9 || model.actions.length !== 1) {
            return [this.registry.enrich(state, candidate)];
        }
        const action = model.actions[0];
        const rule = action.targets[0];
        if(action.targets.length !== 1 || !rule || rule.kind !== 'character' || (rule.maximum || 1) !== 1 ||
            action.confidence < 0.9 || action.condition || action.delayed || !timingMatches(state, action) ||
            action.effects.length === 0 && !action.dynamicEvaluator || action.effects.some((effect) => !!effect.conditional)) {
            return [this.registry.enrich(state, candidate)];
        }
        const exactAttachmentTargets = action.effects.some((effect) => effect.kind === 'attachment')
            ? state.legalAttachmentTargetIdsBySource?.[candidate.source.instanceId] : undefined;
        const targets = state.characters.filter((character) =>
            matchesTarget(state, character, rule) && effectStateMatches(action, character) &&
            (exactAttachmentTargets === undefined || exactAttachmentTargets.includes(character.instanceId)))
            .sort((left, right) => targetScore(state, action, right) - targetScore(state, action, left) ||
                left.instanceId.localeCompare(right.instanceId));
        const target = targets[0];
        if(!target) return [this.registry.enrich(state, candidate)];
        const ref = targetRef(target);
        const identity = {
            kind: candidate.kind,
            source: candidate.source,
            mode: candidate.mode,
            targets: [ref],
            commandPreview: candidate.commandPreview
        };
        const targeted = immutable({
            ...candidate,
            ...identity,
            tags: tacticalRoleTags(state, candidate, ref, action.effects),
            id: candidateId(identity),
            macro: macroFor(candidate, ref, state),
            annotations: [
                ...(candidate.annotations || []),
                { proposer: 'semantic-target-planner', note: `target:${ref.instanceId}` }
            ]
        }) as BotActionCandidate;
        return [this.registry.enrich(state, targeted)];
    }

    private expandLetGo(state: PlanningState, candidate: BotActionCandidate,
        action: ActionSemantic): readonly BotActionCandidate[] {
        const rule = action?.targets[0];
        if(action?.targets.length !== 1 || !rule || rule.kind !== 'attachment' ||
            action.effects.length !== 1 || action.effects[0].kind !== 'remove' ||
            action.effects[0].method !== 'discard' || !timingMatches(state, action) ||
            action.confidence < 0.9) {
            return [this.registry.enrich(state, candidate)];
        }
        const targets = state.characters.flatMap((character) => character.attachments
            .filter((attachment) => attachment.controllerId !== state.perspectivePlayerId)
            .map((attachment) => ({
                character,
                attachment,
                current: character.participating && !character.bowed
                    ? state.conflict?.type === 'political'
                        ? attachment.politicalBonus : attachment.militaryBonus
                    : 0,
                future: Math.max(0, attachment.militaryBonus) + Math.max(0, attachment.politicalBonus) +
                    Math.max(0, attachment.printedCost || 0)
            })))
            .sort((left, right) => right.current - left.current || right.future - left.future ||
                left.attachment.instanceId.localeCompare(right.attachment.instanceId));
        if(targets.length === 0) return [this.registry.enrich(state, candidate)];
        // Physical copies of Let Go are already separate source candidates.
        // Bind each copy only to its best exact target: expanding every copy
        // across a tower's full attachment stack multiplies equivalent search
        // roots without improving the deterministic target choice.
        return targets.slice(0, 1).map(({ attachment }) => {
            const ref = attachmentRef(attachment);
            const identity = {
                kind: candidate.kind,
                source: candidate.source,
                mode: 'discard-attachment',
                targets: [ref],
                commandPreview: candidate.commandPreview
            };
            return immutable({
                ...candidate,
                ...identity,
                id: candidateId(identity),
                effects: [{ kind: 'remove', method: 'discard', target: ref, confidence: 1 }],
                tags: tacticalRoleTags(state, candidate, ref,
                    [{ kind: 'remove', method: 'discard', target: ref, confidence: 1 }]),
                macro: macroFor(candidate, ref, state),
                confidence: Math.min(candidate.confidence, action.confidence),
                uncertainty: Math.max(candidate.uncertainty, 1 - action.confidence),
                annotations: [
                    ...(candidate.annotations || []),
                    { proposer: 'semantic-attachment-target-planner', note: `discard:${ref.instanceId}` }
                ]
            }) as BotActionCandidate;
        });
    }

    private expandNobleSacrifice(state: PlanningState, candidate: BotActionCandidate,
        action: ActionSemantic): readonly BotActionCandidate[] {
        const rule = action.targets[0];
        if(action.cost.sacrificeCharacter !== 'honored' || action.targets.length !== 1 ||
            !rule || rule.kind !== 'character' || rule.side !== 'opponent' || rule.dishonored !== true ||
            action.effects.length !== 1 || action.effects[0].kind !== 'remove' ||
            action.effects[0].method !== 'discard' || !timingMatches(state, action) || action.confidence < 0.95) {
            return [this.registry.enrich(state, candidate)];
        }
        const sacrifice = state.characters.filter((character) =>
            character.controllerId === state.perspectivePlayerId && character.honored)
            .sort((left, right) => characterMaterialValue(state, left) - characterMaterialValue(state, right) ||
                left.instanceId.localeCompare(right.instanceId))[0];
        const victim = state.characters.filter((character) => matchesTarget(state, character, rule))
            .sort((left, right) => characterMaterialValue(state, right) - characterMaterialValue(state, left) ||
                left.instanceId.localeCompare(right.instanceId))[0];
        if(!sacrifice || !victim) return [this.registry.enrich(state, candidate)];
        const sacrificeRef = targetRef(sacrifice);
        const victimRef = targetRef(victim);
        const identity = {
            kind: candidate.kind,
            source: candidate.source,
            mode: 'sacrifice-honored-discard-dishonored',
            targets: [sacrificeRef, victimRef],
            commandPreview: candidate.commandPreview
        };
        return [immutable({
            ...candidate,
            ...identity,
            id: candidateId(identity),
            macro: nobleSacrificeMacroFor(candidate, sacrificeRef, victimRef, state),
            costs: {
                ...candidate.costs,
                fate: candidate.costs.fate ?? action.cost.fate
            },
            effects: [
                { kind: 'remove', method: 'sacrifice', target: sacrificeRef, confidence: 1, cost: true },
                { ...action.effects[0], target: victimRef, confidence: 1 }
            ],
            tags: [...new Set([...candidate.tags, 'control' as const, 'payoff' as const])],
            confidence: Math.min(candidate.confidence, action.confidence),
            uncertainty: Math.max(candidate.uncertainty, 1 - action.confidence),
            annotations: [
                ...(candidate.annotations || []),
                { proposer: 'semantic-cost-target-planner', note: `sacrifice:${sacrificeRef.instanceId}:discard:${victimRef.instanceId}` }
            ]
        }) as BotActionCandidate];
    }

    private expandCourtGames(state: PlanningState, candidate: BotActionCandidate,
        actions: readonly ActionSemantic[]): readonly BotActionCandidate[] {
        const expanded: BotActionCandidate[] = [];
        for(const action of [...actions].sort((left, right) => left.id.localeCompare(right.id))) {
            const rule = action.targets[0];
            if(action.targets.length !== 1 || !rule || rule.kind !== 'character' ||
                action.effects.length !== 1 || action.effects[0].kind !== 'status' || !timingMatches(state, action)) continue;
            const target = state.characters.filter((character) =>
                character.participating && matchesTarget(state, character, rule) && effectStateMatches(action, character))
                .sort((left, right) => targetScore(state, action, right) - targetScore(state, action, left) ||
                    left.instanceId.localeCompare(right.instanceId))[0];
            if(!target) continue;
            const ref = targetRef(target);
            const mode = action.id.endsWith(':dishonor') ? 'dishonor' : 'honor';
            const modeText = mode === 'dishonor'
                ? 'Dishonor an opposing character' : 'Honor a friendly character';
            const identity = {
                kind: candidate.kind,
                source: candidate.source,
                mode,
                targets: [ref],
                commandPreview: candidate.commandPreview
            };
            const projection = this.registry.project(candidate.source!.cardId, state,
                { ...candidate, mode, targets: [ref] }, [ref]);
            if(!projection || projection.effects.length !== 1) continue;
            expanded.push(immutable({
                ...candidate,
                ...identity,
                id: candidateId(identity),
                effects: projection.effects,
                tags: tacticalRoleTags(state, candidate, ref, projection.effects),
                macro: modeMacroFor(candidate, ref, state, modeText),
                confidence: Math.min(candidate.confidence, projection.confidence),
                uncertainty: Math.max(candidate.uncertainty, 1 - projection.confidence),
                annotations: [
                    ...(candidate.annotations || []),
                    { proposer: 'semantic-mode-target-planner', note: `${mode}:${ref.instanceId}` }
                ]
            }) as BotActionCandidate);
        }
        return expanded.length > 0 ? expanded : [this.registry.enrich(state, candidate)];
    }
}
