import type { BotDecision, BotDecisionInput } from '../BotEngine';
import type {
    BotActionCandidate,
    BotActionKind,
    CandidateAnnotation,
    CommandDescriptor
} from './model/Candidate';
import { candidateId } from './model/Candidate';
import type { PlanningState } from './model/PlanningState';
import type { ActionMacro, SemanticMacroStep } from './model/Macro';
import type { CardRef, TargetRef } from './model/References';
import { immutable, stableHash } from './model/Stable';

export interface CandidateCollectionContext {
    readonly input: BotDecisionInput;
    readonly state: PlanningState;
    readonly v1Decision?: BotDecision | null;
    readonly attemptedActionKeys?: readonly string[];
}

/** Contributors describe choices only. No controller or command runner exists here. */
export interface CandidateContributor {
    readonly id: string;
    contribute(context: Readonly<CandidateCollectionContext>): readonly BotActionCandidate[];
}

export interface CandidateCollection {
    readonly candidates: readonly BotActionCandidate[];
    readonly contributors: readonly string[];
    readonly promptClass: string;
    readonly hasNativeV2Candidate: boolean;
    readonly fallbackReason?: string;
}

function cards(root: any): any[] {
    const found: any[] = [];
    const seen = new Set<any>();
    const visit = (value: any) => {
        if(!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if(value.uuid && (value.type || value.location || value.facedown)) found.push(value);
        if(Array.isArray(value)) value.forEach(visit);
        else Object.values(value).forEach(visit);
    };
    visit(root);
    return found;
}

function buttonDescriptor(button: any): CommandDescriptor {
    return {
        command: button.command || 'menuButton',
        args: [button.arg ?? button.text, button.uuid, button.method],
        target: String(button.text ?? button.arg ?? '')
    };
}

function buttonKind(title: string, text: string): BotActionKind {
    if(/mulligan/.test(title)) return 'mulligan';
    if(/discard/.test(title)) return 'discard';
    if(/\bpass\b|\bdone\b/i.test(text)) return 'pass';
    if(/are you sure|confirm|pass conflict/.test(title) || /^(yes|no|ok)$/i.test(text)) return 'confirmation';
    if(/honor bid/.test(title) && /^\d+$/.test(text)) return 'bid';
    if(/reaction/.test(title)) return 'reaction';
    if(/interrupt/.test(title)) return 'interrupt';
    return 'mode-selection';
}

function targetRef(card: any, fallbackController: string): TargetRef {
    const kind = card.type === 'character' ? 'character' : 'card';
    if(kind === 'character') {
        return {
            kind,
            instanceId: String(card.uuid),
            cardId: card.id,
            controllerId: String(card.controller?.name || card.controller || fallbackController)
        };
    }
    return {
        kind,
        instanceId: String(card.uuid),
        cardId: card.id,
        controllerId: String(card.controller?.name || card.controller || fallbackController),
        location: card.location
    };
}

function makeCandidate(options: Omit<BotActionCandidate, 'id'>): BotActionCandidate {
    return immutable({
        ...options,
        id: candidateId({
            kind: options.kind,
            source: options.source,
            mode: options.mode,
            targets: options.targets,
            commandPreview: options.commandPreview
        })
    }) as BotActionCandidate;
}

function macroForDynasty(card: any, additionalFate: number, state: PlanningState): ActionMacro {
    const steps: SemanticMacroStep[] = [{
        id: 'source', kind: 'source', semanticValue: String(card.id || card.uuid),
        expected: { promptIdentity: state.prompt.identity }, command: 'cardClicked', args: [card.uuid]
    }];
    if(card.type === 'character') {
        steps.push({
            id: 'additional-fate', kind: 'cost', semanticValue: String(additionalFate),
            expected: { promptTitle: 'Choose additional fate' }, command: 'menuButton', args: [String(additionalFate)]
        });
    }
    return {
        id: `macro:dynasty:${card.uuid}:${additionalFate}`,
        steps,
        currentStep: 0,
        abortPolicy: 'fallback-v1',
        startedAtSignature: state.materialStateSignature
    };
}

export class GenericPromptContributor implements CandidateContributor {
    readonly id = 'generic-prompts';

    contribute(context: CandidateCollectionContext): readonly BotActionCandidate[] {
        const input = context.input;
        const rawState = input.playerState || {};
        const me = rawState.players?.[context.state.perspectivePlayerId] || {};
        const title = `${me.promptTitle || ''} ${me.menuTitle || ''}`.toLowerCase();
        const result: BotActionCandidate[] = [];
        for(const button of (me.buttons || []).filter((entry: any) => !entry.disabled)) {
            const commandPreview = buttonDescriptor(button);
            const kind = buttonKind(title, String(button.text || button.arg || ''));
            result.push(makeCandidate({
                kind, targets: [], commandPreview, costs: {}, effects: [], prerequisites: [],
                tags: kind === 'pass' ? [] : kind === 'confirmation' ? [] : ['uncertain'],
                limits: [], uncertainty: kind === 'pass' || kind === 'confirmation' ? 0 : 0.25,
                confidence: 0.9, proposer: this.id, mode: commandPreview.target
            }));
        }
        const visible = cards(rawState);
        const selectable = visible.filter((card) => card.selectable && card.uuid);
        for(const card of selectable) {
            const target = targetRef(card, context.state.perspectivePlayerId);
            const kind: BotActionKind = /mulligan/.test(title) ? 'mulligan'
                : /discard/.test(title) ? 'discard'
                    : /target|choose a character|choose a card|select/.test(title) ? 'target-selection'
                        : 'card-selection';
            result.push(makeCandidate({
                kind, targets: [target], commandPreview: { command: 'cardClicked', args: [card.uuid], target: card.name },
                costs: {}, effects: [], prerequisites: [], tags: ['uncertain'], limits: [], uncertainty: 0.35,
                confidence: 0.75, proposer: this.id
            }));
        }
        // The serialized game state keeps the rings visible on every prompt.
        // Only expose ring commands when the live prompt explicitly enables
        // them; otherwise V2 wastes search budget on invalid clicks.
        if(me.selectRing === true) {
            for(const ring of Object.values(rawState.rings || {}) as any[]) {
                if(!ring || ring.unselectable === true || !ring.element) continue;
                result.push(makeCandidate({
                    kind: 'ring-choice', targets: [{ kind: 'ring', element: ring.element }],
                    commandPreview: { command: 'ringClicked', args: [ring.element], target: ring.element },
                    costs: {}, effects: [{ kind: 'ring', element: ring.element, fate: Number(ring.fate) || 0 }],
                    prerequisites: [], tags: ['ring'], limits: [], uncertainty: 0.1, confidence: 0.9,
                    proposer: this.id
                }));
            }
        }
        return result;
    }
}

export class DynastyContributor implements CandidateContributor {
    readonly id = 'dynasty-purchases';

    contribute(context: CandidateCollectionContext): readonly BotActionCandidate[] {
        const rawState = context.input.playerState || {};
        const me = rawState.players?.[context.state.perspectivePlayerId] || {};
        if(me.promptTitle !== 'Play cards from provinces' && me.menuTitle !== 'Initiate an action') return [];
        const costs = context.input.context?.dynastyCosts || {};
        const fate = context.state.players[context.state.perspectivePlayerId]?.fate || 0;
        const legalDirect = context.input.context?.legalDirectCardUuids;
        const legalSet = legalDirect ? new Set(Object.keys(legalDirect).filter((uuid) => legalDirect[uuid])) : undefined;
        const result: BotActionCandidate[] = [];
        for(const card of cards(me).filter((entry) =>
            entry.uuid && !entry.facedown && /^(province [1-4])$/.test(String(entry.location || '')) &&
            (!legalSet || legalSet.has(entry.uuid)))) {
            const cost = Math.max(0, Number(costs[card.uuid] ?? card.cost) || 0);
            if(cost > fate) continue;
            const maximumAdditional = card.type === 'character' ? Math.max(0, fate - cost) : 0;
            for(let additionalFate = 0; additionalFate <= maximumAdditional; additionalFate++) {
                const source: CardRef = {
                    kind: 'card', instanceId: card.uuid, cardId: card.id,
                    controllerId: context.state.perspectivePlayerId, location: card.location
                };
                result.push(makeCandidate({
                    kind: 'dynasty-purchase', source, mode: `additional-fate:${additionalFate}`, targets: [],
                    commandPreview: { command: 'cardClicked', args: [card.uuid], target: card.name },
                    macro: macroForDynasty(card, additionalFate, context.state),
                    costs: { fate: cost + additionalFate, additionalFate }, effects: [],
                    prerequisites: [{ id: 'affordable', description: 'purchase package is affordable', satisfied: true }],
                    tags: ['economy'], limits: [], uncertainty: 0.25, confidence: 0.8, proposer: this.id
                }));
            }
        }
        for(const card of cards(me)) {
            for(const item of card.menu || []) {
                if(item.disabled || !item.command) continue;
                result.push(makeCandidate({
                    kind: 'dynasty-ability',
                    source: { kind: 'card', instanceId: card.uuid, cardId: card.id, controllerId: context.state.perspectivePlayerId, location: card.location },
                    mode: item.text || item.command,
                    targets: [],
                    commandPreview: { command: 'menuItemClick', args: [card.uuid, item], target: item.text },
                    costs: {}, effects: [], prerequisites: [], tags: ['economy', 'uncertain'], limits: [],
                    uncertainty: 0.5, confidence: 0.6, proposer: this.id
                }));
            }
        }
        return result;
    }
}

export class ConflictContributor implements CandidateContributor {
    readonly id = 'conflict-actions';

    contribute(context: CandidateCollectionContext): readonly BotActionCandidate[] {
        const rawState = context.input.playerState || {};
        const me = rawState.players?.[context.state.perspectivePlayerId] || {};
        const title = `${me.promptTitle || ''} ${me.menuTitle || ''}`.toLowerCase();
        if(!/conflict|attacker|defender|reaction|interrupt/.test(title)) return [];
        const result: BotActionCandidate[] = [];
        for(const card of cards(rawState).filter((entry) => entry.selectable && entry.uuid)) {
            const target = targetRef(card, context.state.perspectivePlayerId);
            const selectingParticipant = /attacker|defender/.test(title);
            const selectingTarget = /choose|select|target/.test(title) && !/reaction|interrupt/.test(title);
            const selectingProvince = /choose[^|]*province|select[^|]*province|attack[^|]*province/.test(title);
            const kind: BotActionKind = /attacker/.test(title) ? 'attacker-set'
                : /defender/.test(title) ? 'defender-set'
                    : /reaction/.test(title) ? 'reaction'
                        : /interrupt/.test(title) ? 'interrupt'
                            : (card.type === 'province' || card.isProvince) && selectingProvince ? 'province-choice'
                            : card.location === 'hand' ? 'conflict-card'
                                : selectingTarget ? 'target-selection' : 'in-play-ability';
            const terminalDefense = kind === 'defender-set' && context.state.conflict?.provinceLocation === 'stronghold province';
            const actionSource: CardRef | undefined = !selectingParticipant && kind !== 'target-selection' && kind !== 'province-choice' ? {
                kind: 'card', instanceId: String(card.uuid), cardId: card.id,
                controllerId: context.state.perspectivePlayerId, location: card.location
            } : undefined;
            result.push(makeCandidate({
                kind, source: actionSource, targets: actionSource ? [] : [target],
                commandPreview: { command: 'cardClicked', args: [card.uuid], target: card.name },
                costs: card.location === 'hand' ? { cards: 1 } : {}, effects: [], prerequisites: [],
                tags: kind === 'defender-set' ? (terminalDefense ? ['terminal', 'defense'] : ['defense']) : ['offense'], limits: [],
                uncertainty: terminalDefense ? 0 : 0.35, confidence: terminalDefense ? 0.98 : 0.7, proposer: this.id
            }));
        }
        for(const [index, list] of Object.values(me.provinces || {}).entries()) {
            for(const province of (list as any[] || []).filter((entry) => entry?.selectable && entry?.location && !entry?.uuid)) {
                const args = [province.location, me.name || context.state.perspectivePlayerId, true];
                result.push(makeCandidate({
                    kind: 'province-choice',
                    targets: [{ kind: 'province', controllerId: String(province.controller || 'Opponent'), location: province.location }],
                    commandPreview: { command: 'facedownCardClicked', args, target: province.location },
                    costs: {}, effects: [{ kind: 'province', location: province.location, reveal: true }],
                    prerequisites: [], tags: ['province', 'offense'], limits: [], uncertainty: 0.3,
                    confidence: 0.75, proposer: this.id, mode: `province:${index}`
                }));
            }
        }
        for(const button of (me.buttons || []).filter((entry: any) => !entry.disabled)) {
            const text = String(button.text || button.arg || '').toLowerCase();
            if(text === 'military' || text === 'political' || text.includes('military conflict') || text.includes('political conflict')) {
                result.push(makeCandidate({
                    kind: 'conflict-type-choice', mode: text.includes('political') ? 'political' : 'military', targets: [],
                    commandPreview: buttonDescriptor(button), costs: {}, effects: [{ kind: 'conflict', conflictType: text.includes('political') ? 'political' : 'military' }],
                    prerequisites: [], tags: ['offense'], limits: [], uncertainty: 0.1, confidence: 0.9, proposer: this.id
                }));
            }
        }
        for(const [element, ring] of Object.entries(rawState.rings || {}) as [string, any][]) {
            if(ring?.unselectable === true) continue;
            result.push(makeCandidate({
                kind: 'conflict-declaration', mode: `${element}:${ring?.conflictType || 'any'}`,
                targets: [{ kind: 'ring', element: element as any }],
                commandPreview: { command: 'ringClicked', args: [element], target: element },
                costs: { conflictOpportunities: 1 }, effects: [{ kind: 'ring', element: element as any, fate: Number(ring?.fate) || 0 }],
                prerequisites: [], tags: ['offense', 'ring'], limits: [], uncertainty: 0.2,
                confidence: 0.8, proposer: this.id
            }));
        }
        return result;
    }
}

export class V1FallbackContributor implements CandidateContributor {
    readonly id = 'v1-fallback';

    contribute(context: CandidateCollectionContext): readonly BotActionCandidate[] {
        const decision = context.v1Decision;
        if(!decision) return [];
        return [makeCandidate({
            kind: 'v1-fallback', mode: decision.reason, targets: [],
            commandPreview: { command: decision.command, args: decision.args, target: decision.target },
            costs: {}, effects: [], prerequisites: [], tags: ['fallback'], limits: [],
            uncertainty: 0.5, confidence: 0.5, proposer: this.id, fallbackDecision: decision
        })];
    }
}

function semanticKey(candidate: BotActionCandidate): string {
    return stableHash({
        kind: candidate.kind,
        source: candidate.source,
        mode: candidate.mode,
        targets: candidate.targets,
        command: candidate.commandPreview
    });
}

export function deduplicateCandidates(candidates: readonly BotActionCandidate[]): readonly BotActionCandidate[] {
    const byKey = new Map<string, BotActionCandidate>();
    for(const candidate of candidates) {
        const key = semanticKey(candidate);
        const existing = byKey.get(key);
        if(!existing) {
            byKey.set(key, candidate);
            continue;
        }
        const annotations: CandidateAnnotation[] = [
            ...(existing.annotations || []),
            { proposer: candidate.proposer },
            ...(candidate.annotations || [])
        ];
        byKey.set(key, immutable({
            ...existing,
            annotations,
            confidence: Math.max(existing.confidence, candidate.confidence),
            uncertainty: Math.min(existing.uncertainty, candidate.uncertainty),
            tags: [...new Set([...existing.tags, ...candidate.tags])]
        }) as BotActionCandidate);
    }
    return [...byKey.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export default class CandidateRegistry {
    constructor(private readonly contributors: readonly CandidateContributor[] = [
        new GenericPromptContributor(),
        new DynastyContributor(),
        new ConflictContributor(),
        new V1FallbackContributor()
    ]) {}

    collect(context: CandidateCollectionContext): CandidateCollection {
        const candidates = deduplicateCandidates(this.contributors.flatMap((contributor) => contributor.contribute(context)));
        const native = candidates.filter((candidate) => candidate.kind !== 'v1-fallback');
        return immutable({
            candidates,
            contributors: this.contributors.map((contributor) => contributor.id),
            promptClass: this.promptClass(context),
            hasNativeV2Candidate: native.length > 0,
            fallbackReason: native.length > 0 ? undefined : context.v1Decision ? 'no-native-v2-candidates' : 'unsupported-prompt'
        }) as CandidateCollection;
    }

    private promptClass(context: CandidateCollectionContext): string {
        const prompt = context.state.prompt;
        const title = `${prompt.title} ${prompt.menu}`.toLowerCase();
        if(title.includes('honor bid')) return 'bid';
        if(title.includes('mulligan')) return 'mulligan';
        if(title.includes('discard')) return 'discard';
        if(title.includes('attacker')) return 'attacker';
        if(title.includes('defender')) return 'defender';
        if(title.includes('reaction')) return 'reaction';
        if(title.includes('interrupt')) return 'interrupt';
        if(title.includes('conflict')) return 'conflict';
        if(title.includes('province') || context.state.phase === 'dynasty') return 'dynasty';
        if(title.includes('target') || title.includes('choose')) return 'selection';
        return 'generic';
    }
}
