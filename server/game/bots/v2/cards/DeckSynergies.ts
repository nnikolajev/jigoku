import { DRAGON_ATTACHMENT_DEFAULTS } from '../../DragonAttachmentTactics.js';
import { DRAGON_DEFAULTS } from '../../DragonTactics.js';
import { DUEL_DEFAULTS } from '../../DuelTactics.js';
import { LION_DEFAULTS } from '../../LionTactics.js';
import { SHUGENJA_DEFAULTS } from '../../ShugenjaTactics.js';
import { UNICORN_DEFAULTS } from '../../UnicornTactics.js';
import type { ResourcePlanningProfile } from '../resources/ResourcePackagePlanner';
import type { BotActionCandidate, CandidateAnnotation } from '../model/Candidate';
import type { PlanningState } from '../model/PlanningState';
import type { UtilityVector } from '../model/Utility';
import { immutable } from '../model/Stable';
import type CardSemanticRegistry from './CardSemantics';
import type { SynergyRole } from './CardSemantics';

export type DeckSynergyArchetype =
    | 'dragon-attachments' | 'phoenix-shugenja' | 'unicorn-movement'
    | 'crane-duel' | 'lion-swarm' | 'scorpion-dishonor' | 'crab-holding'
    | 'phoenix-glory' | 'dragon-monk';

export interface SynergySelector {
    readonly cardIds?: readonly string[];
    readonly tags?: readonly string[];
    readonly effectKinds?: readonly string[];
    readonly candidateKinds?: readonly string[];
}

export type SynergyCondition =
    | 'partner-available' | 'own-tower-present' | 'own-honored-present'
    | 'enemy-dishonored-present' | 'during-military-conflict'
    | 'own-participant-present' | 'winning-current-conflict'
    | 'duplicate-on-target' | 'holding-present' | 'enemy-honor-pressured'
    | 'enemy-conflict-deck-pressured';

/** Declarative graph edge only. It cannot execute a command or mutate live rules state. */
export interface DeckSynergyEdge {
    readonly id: string;
    readonly role: SynergyRole;
    readonly source: SynergySelector;
    readonly partner?: SynergySelector;
    readonly conditions?: readonly SynergyCondition[];
    readonly scoreDelta: Partial<UtilityVector>;
    readonly mutuallyExclusiveWith?: readonly string[];
    readonly rationale: string;
}

export interface DeckSynergyProfile {
    readonly id: DeckSynergyArchetype;
    readonly edges: readonly DeckSynergyEdge[];
    readonly resourceProfile: ResourcePlanningProfile;
    readonly fateReserve?: number;
    readonly conflictCardReserve?: number;
}

export interface DeckSynergyContext {
    readonly deckProfileId?: string;
    readonly profile?: any;
}

export interface SynergyActivation {
    readonly profileId: DeckSynergyArchetype;
    readonly edgeId: string;
    readonly candidateId: string;
    readonly role: SynergyRole;
    readonly rationale: string;
}

export interface DeckSynergyContribution {
    readonly candidates: readonly BotActionCandidate[];
    readonly profileIds: readonly DeckSynergyArchetype[];
    readonly activations: readonly SynergyActivation[];
    readonly resourceProfile: ResourcePlanningProfile;
    readonly fateReserve: number;
    readonly conflictCardReserve: number;
}

const edge = (input: DeckSynergyEdge): DeckSynergyEdge => input;

const attachmentCards = [...DRAGON_ATTACHMENT_DEFAULTS.attachments];
const dragonTowers = [...DRAGON_ATTACHMENT_DEFAULTS.towerCharacters];
const dragonWeapons = [...DRAGON_ATTACHMENT_DEFAULTS.weaponAttachments];
const singletonDragonAttachments = attachmentCards.filter((id) =>
    !DRAGON_ATTACHMENT_DEFAULTS.stackableAttachments.includes(id));

export const DECK_SYNERGY_PROFILES: Readonly<Record<DeckSynergyArchetype, DeckSynergyProfile>> = immutable({
    'dragon-attachments': {
        id: 'dragon-attachments', fateReserve: 1,
        resourceProfile: {
            archetype: 'tower',
            cards: Object.fromEntries([
                ...dragonTowers.map((id) => [id, { type: 'character', value: 5, readyValue: id === 'niten-master' ? 2 : 0 }]),
                ...attachmentCards.map((id) => [id, { type: 'attachment', value: 3,
                    tags: DRAGON_ATTACHMENT_DEFAULTS.weaponAttachments.includes(id) ? ['weapon'] : ['attachment'] }])
            ])
        },
        edges: [
            edge({ id: 'dragon:reducer-before-attachment', role: 'reducer',
                source: { cardIds: ['daimyo-s-favor', 'iron-mountain-castle'] },
                partner: { cardIds: attachmentCards }, conditions: ['partner-available'],
                scoreDelta: { fate: 2, comboProgress: 2 },
                rationale: 'establish or consume an attachment reducer only with a legal attachment package' }),
            edge({ id: 'dragon:tower-attachment', role: 'setup', source: { cardIds: attachmentCards },
                partner: { cardIds: dragonTowers }, conditions: ['own-tower-present'],
                scoreDelta: { boardFuture: 2, comboProgress: 2 },
                rationale: 'invest attachments in a durable tower' }),
            edge({ id: 'dragon:weapon-readies-niten', role: 'enabler', source: { cardIds: dragonWeapons },
                partner: { cardIds: ['niten-master'] }, conditions: ['partner-available'],
                scoreDelta: { boardNow: 2, flexibility: 2, comboProgress: 2 },
                rationale: 'weapon play enables Niten Master ready value' }),
            edge({ id: 'dragon:protect-tower', role: 'protection', source: { cardIds: ['finger-of-jade', 'adopted-kin'] },
                partner: { cardIds: dragonTowers }, conditions: ['own-tower-present'],
                scoreDelta: { boardFuture: 3, risk: 2 }, rationale: 'protect the fate-loaded tower' }),
            edge({ id: 'dragon:distribute-singleton', role: 'mutually-exclusive',
                source: { cardIds: singletonDragonAttachments }, conditions: ['duplicate-on-target'],
                mutuallyExclusiveWith: singletonDragonAttachments,
                scoreDelta: { waste: -8, comboProgress: -3 },
                rationale: 'distribute redundant named attachment abilities before duplicating them' })
        ]
    },
    'phoenix-shugenja': {
        id: 'phoenix-shugenja', fateReserve: SHUGENJA_DEFAULTS.preConflictMinFate, conflictCardReserve: 1,
        resourceProfile: {
            archetype: 'shugenja', expectedRingFateWeight: 0.75,
            cards: {
                'display-of-power': { type: 'event', printedCost: 2, value: 7, tags: ['ring'] },
                'consumed-by-five-fires': { type: 'event', printedCost: 5, value: 10, tags: ['removal'] },
                'supernatural-storm': { type: 'event', printedCost: 0, value: 5, tags: ['shugenja'] },
                'against-the-waves': { type: 'event', printedCost: 1, value: 5, readyValue: 2 },
                'clarity-of-purpose': { type: 'event', printedCost: 1, value: 5, noBow: true }
            }
        },
        edges: [
            edge({ id: 'shugenja:body-enables-spell', role: 'setup',
                source: { cardIds: SHUGENJA_DEFAULTS.shugenjaIds },
                partner: { cardIds: SHUGENJA_DEFAULTS.spellPriority }, conditions: ['partner-available'],
                scoreDelta: { comboProgress: 2, boardFuture: 1 }, rationale: 'retain a Shugenja to keep spell conditions live' }),
            edge({ id: 'shugenja:reserve-expensive-spell', role: 'payoff',
                source: { cardIds: ['consumed-by-five-fires', 'display-of-power'] },
                partner: { cardIds: SHUGENJA_DEFAULTS.shugenjaIds }, conditions: ['partner-available'],
                scoreDelta: { comboProgress: 4, risk: 1 }, rationale: 'preserve fate and a legal Shugenja for high-impact spells' }),
            edge({ id: 'shugenja:ring-resolution', role: 'payoff',
                source: { cardIds: ['display-of-power', 'the-path-of-man', 'asako-togama', 'offerings-to-the-kami'] },
                partner: { tags: ['ring'] }, scoreDelta: { ringValue: 4, comboProgress: 2 },
                rationale: 'value current ring resolution and live ring-character payoffs together' }),
            edge({ id: 'shugenja:spell-recursion', role: 'enabler',
                source: { cardIds: ['kyuden-isawa', 'isawa-tadaka-2', 'fushicho'] },
                partner: { cardIds: SHUGENJA_DEFAULTS.spellPriority }, conditions: ['partner-available'],
                scoreDelta: { cards: 2, flexibility: 2, comboProgress: 2 },
                rationale: 'recursion source and protected high-impact spell form one package' }),
            edge({ id: 'shugenja:clarity-protection', role: 'protection',
                source: { cardIds: ['clarity-of-purpose', 'shiba-yojimbo'] },
                partner: { cardIds: SHUGENJA_DEFAULTS.towerIds }, conditions: ['own-tower-present'],
                scoreDelta: { boardFuture: 3, flexibility: 2 }, rationale: 'protect or preserve a practical Shugenja tower' })
        ]
    },
    'unicorn-movement': {
        id: 'unicorn-movement', fateReserve: 1,
        resourceProfile: { archetype: 'movement', cards: {
            'ride-on': { type: 'event', value: 4, tags: ['movement'] },
            'i-am-ready': { type: 'event', value: 5, readyValue: 2 },
            'cavalry-reserves': { type: 'event', printedCost: 3, value: 9, tags: ['movement'] }
        } },
        edges: [
            edge({ id: 'unicorn:movement-source', role: 'enabler',
                source: { cardIds: UNICORN_DEFAULTS.movementCardIds },
                partner: { tags: ['movement-trigger'] }, conditions: ['partner-available'],
                scoreDelta: { boardNow: 2, flexibility: 3, comboProgress: 2 },
                rationale: 'movement creates legal trigger-chain and participation value' }),
            edge({ id: 'unicorn:move-ready', role: 'payoff', source: { tags: ['movement'] },
                partner: { cardIds: ['i-am-ready', 'shiotome-encampment', 'moto-outrider', 'twilight-rider'] },
                conditions: ['partner-available'], scoreDelta: { conflictOutcome: 2, flexibility: 2 },
                rationale: 'bowed mover has a known ready follow-up' }),
            edge({ id: 'unicorn:virtual-participant', role: 'setup',
                source: { cardIds: ['cavalry-reserves', 'ride-on', 'golden-plains-outpost', 'adorned-barcha'] },
                conditions: ['during-military-conflict'], scoreDelta: { conflictOutcome: 3, boardNow: 2 },
                rationale: 'count legal move-in bodies as virtual military participants' }),
            edge({ id: 'unicorn:conflict-win-payoff', role: 'payoff',
                source: { cardIds: ['minami-kaze-regulars', 'higashi-kaze-company', 'spoils-of-war'] },
                conditions: ['own-participant-present', 'winning-current-conflict'],
                scoreDelta: { cards: 2, boardNow: 2, comboProgress: 2 },
                rationale: 'movement reaches a conflict-win payoff threshold' }),
            edge({ id: 'unicorn:singleton-mount', role: 'mutually-exclusive',
                source: { cardIds: UNICORN_DEFAULTS.singletonAttachments }, conditions: ['duplicate-on-target'],
                mutuallyExclusiveWith: UNICORN_DEFAULTS.singletonAttachments,
                scoreDelta: { waste: -7 }, rationale: 'do not duplicate singleton mount abilities on one bearer' })
        ]
    },
    'crane-duel': {
        id: 'crane-duel', fateReserve: 1,
        resourceProfile: { archetype: 'duel', cards: Object.fromEntries([
            ...DUEL_DEFAULTS.keyCharacters.map((id) => [id, { type: 'character', value: 5 }]),
            ...DUEL_DEFAULTS.towerAttachments.map((id) => [id, { type: 'attachment', value: 3, tags: ['duel'] }])
        ]) },
        edges: [
            edge({ id: 'crane:duel-engine', role: 'payoff',
                source: { cardIds: Object.keys(DUEL_DEFAULTS.duelAxes) },
                partner: { cardIds: ['kyuden-kakita', 'proving-ground', 'kakita-blade', 'storied-defeat'] },
                conditions: ['partner-available'], scoreDelta: { comboProgress: 4, cards: 1, honor: 1 },
                rationale: 'duel source activates honor, draw, and loser-control payoffs' }),
            edge({ id: 'crane:honor-setup', role: 'setup',
                source: { cardIds: ['way-of-the-crane', 'court-games', 'tsuma'] },
                partner: { cardIds: ['voice-of-honor', 'noble-sacrifice'] }, conditions: ['partner-available'],
                scoreDelta: { honor: 2, comboProgress: 3 }, rationale: 'honored setup enables Voice and Noble Sacrifice' }),
            edge({ id: 'crane:noble-sacrifice', role: 'payoff', source: { cardIds: ['noble-sacrifice'] },
                conditions: ['own-honored-present', 'enemy-dishonored-present'],
                scoreDelta: { boardNow: 5, comboProgress: 5 }, rationale: 'trade the cheapest honored source for a valuable dishonored enemy' }),
            edge({ id: 'crane:voice-protection', role: 'protection', source: { cardIds: ['voice-of-honor'] },
                conditions: ['own-honored-present'], scoreDelta: { risk: 3, flexibility: 2 },
                rationale: 'honor lead makes Voice of Honor live' }),
            edge({ id: 'crane:gossip-control', role: 'protection', source: { cardIds: ['gossip'] },
                partner: { tags: ['payoff'] }, scoreDelta: { information: 2, risk: 2 },
                rationale: 'name a public-deck high-impact opposing card' }),
            edge({ id: 'crane:let-go-target', role: 'payoff', source: { cardIds: ['let-go'] },
                partner: { tags: ['attachment'] }, conditions: ['partner-available'],
                scoreDelta: { boardNow: 3, waste: 1 }, rationale: 'remove a valuable legal attachment target' })
        ]
    },
    'lion-swarm': {
        id: 'lion-swarm', resourceProfile: { archetype: 'rush', cards: Object.fromEntries([
            ...LION_DEFAULTS.cheapCharacters.map((id) => [id, { type: 'character', value: 3 }]),
            ...LION_DEFAULTS.towerCharacters.map((id) => [id, { type: 'character', value: 5 }])
        ]) },
        edges: [
            edge({ id: 'lion:wide-board', role: 'setup', source: { cardIds: LION_DEFAULTS.cheapCharacters },
                partner: { cardIds: ['feeding-an-army', 'for-greater-glory', 'ujik-tactics'] },
                conditions: ['partner-available'], scoreDelta: { boardNow: 2, comboProgress: 2 },
                rationale: 'cheap Bushi widen swarm payoffs' }),
            edge({ id: 'lion:province-break-payoff', role: 'payoff',
                source: { cardIds: ['for-greater-glory', 'feeding-an-army'] },
                conditions: ['during-military-conflict', 'own-participant-present'],
                scoreDelta: { boardFuture: 4, comboProgress: 3 }, rationale: 'convert a wide military conflict into persistent fate' }),
            edge({ id: 'lion:ready', role: 'enabler',
                source: { cardIds: ['hayaken-no-shiro', 'in-service-to-my-lord', 'elegant-tessen'] },
                partner: { cardIds: LION_DEFAULTS.strongReadyTargets }, conditions: ['partner-available'],
                scoreDelta: { boardNow: 3, flexibility: 2 }, rationale: 'ready the strongest eligible Lion body' }),
            edge({ id: 'lion:duel-safe-lead', role: 'payoff',
                source: { cardIds: ['true-strike-kenjutsu', 'challenge-on-the-fields'] },
                conditions: ['during-military-conflict'], scoreDelta: { conflictOutcome: 2, risk: 1 },
                rationale: 'start a military duel only from the safe base-skill line' }),
            edge({ id: 'lion:additional-conflict', role: 'payoff',
                source: { cardIds: ['ujiaki-s-offer', 'right-hand-of-the-emperor'] },
                partner: { cardIds: LION_DEFAULTS.bushiCharacters }, conditions: ['partner-available'],
                scoreDelta: { provinceTempo: 4, flexibility: 3 },
                rationale: 'retain ready Bushi for the additional conflict opportunity' })
        ]
    },
    'scorpion-dishonor': {
        id: 'scorpion-dishonor', resourceProfile: { archetype: 'dishonor', honorFloor: 3 },
        edges: [
            edge({ id: 'scorpion:dishonor-payoff', role: 'payoff',
                source: { cardIds: ['court-games', 'fiery-madness', 'make-an-opening', 'compelling-testimony',
                    'bayushi-shoju-2', 'city-of-the-open-hand'], tags: ['dishonored'] },
                conditions: ['enemy-honor-pressured'],
                scoreDelta: { honor: 4, comboProgress: 2 }, rationale: 'dishonor advances the alternate honor-loss victory path' }),
            edge({ id: 'scorpion:mill-pressure', role: 'payoff',
                source: { cardIds: ['deserted-shrine', 'licensed-quarter', 'master-whisperer', 'midnight-prowler'] },
                conditions: ['enemy-conflict-deck-pressured'],
                scoreDelta: { conflictDeckSafety: 5, honor: 2 }, rationale: 'mill threatens reshuffle honor loss' }),
            edge({ id: 'scorpion:low-honor-protection', role: 'protection',
                source: { cardIds: ['city-of-the-open-hand', 'duty'] },
                scoreDelta: { honor: 4, risk: 3 }, rationale: 'protect own dishonor floor before paying more honor' })
        ]
    },
    'crab-holding': {
        id: 'crab-holding', resourceProfile: { archetype: 'holding', cards: {
            'kaiu-forges': { type: 'holding', value: 5 }, 'seventh-tower': { type: 'holding', value: 5 },
            'northern-curtain-wall': { type: 'holding', value: 4 }, 'third-whisker-warrens': { type: 'holding', value: 4 }
        } },
        edges: [
            edge({ id: 'crab:holding-setup', role: 'setup',
                source: { tags: ['holding'] }, partner: { cardIds: ['kyuden-hida', 'rebuild', 'kaiu-shuichi'] },
                scoreDelta: { boardFuture: 3, comboProgress: 2 }, rationale: 'holding develops the dynasty engine' }),
            edge({ id: 'crab:holding-recursion', role: 'payoff', source: { cardIds: ['rebuild'] },
                conditions: ['holding-present'], scoreDelta: { boardFuture: 4, cards: 1 },
                rationale: 'recur a useful holding instead of a dead generic target' }),
            edge({ id: 'crab:defense-package', role: 'protection',
                source: { cardIds: ['raise-the-alarm', 'give-no-ground', 'the-mountain-does-not-fall', 'withstand-the-darkness'] },
                partner: { tags: ['defense'] }, scoreDelta: { strongholdSafety: 4, risk: 2 },
                rationale: 'preserve a legal defense response package' })
        ]
    },
    'phoenix-glory': {
        id: 'phoenix-glory', fateReserve: 1, resourceProfile: { archetype: 'generic' },
        edges: [
            edge({ id: 'phoenix:glory-honor', role: 'enabler',
                source: { cardIds: ['isawa-mori-seido', 'benten-s-touch', 'magnificent-kimono'] },
                partner: { tags: ['honored'] }, conditions: ['partner-available'],
                scoreDelta: { boardNow: 2, honor: 2 }, rationale: 'glory boost has value with a legal honor line' }),
            edge({ id: 'phoenix:storm-shugenja', role: 'payoff', source: { cardIds: ['supernatural-storm'] },
                partner: { cardIds: SHUGENJA_DEFAULTS.shugenjaIds }, conditions: ['partner-available'],
                scoreDelta: { conflictOutcome: 3, comboProgress: 2 }, rationale: 'Storm scales with live Shugenja count' }),
            edge({ id: 'phoenix:ready-shugenja', role: 'payoff', source: { cardIds: ['against-the-waves'] },
                partner: { cardIds: SHUGENJA_DEFAULTS.shugenjaIds }, conditions: ['partner-available'],
                scoreDelta: { boardNow: 3, flexibility: 2 }, rationale: 'ready a Shugenja with a useful second participation' })
        ]
    },
    'dragon-monk': {
        id: 'dragon-monk', fateReserve: 1, resourceProfile: { archetype: 'monk' },
        edges: [
            edge({ id: 'monk:cheap-card-setup', role: 'setup',
                source: { cardIds: DRAGON_DEFAULTS.kihoCards },
                partner: { cardIds: DRAGON_DEFAULTS.keyCharacters }, conditions: ['partner-available'],
                scoreDelta: { comboProgress: 3, flexibility: 1 }, rationale: 'cheap Kiho progresses the live card-count engine' }),
            edge({ id: 'monk:card-count-payoff', role: 'payoff',
                source: { cardIds: ['togashi-mitsu-2', 'teacher-of-empty-thought', 'togashi-ichi', 'high-house-of-light'] },
                partner: { cardIds: DRAGON_DEFAULTS.kihoCards }, conditions: ['partner-available'],
                scoreDelta: { comboProgress: 5, provinceTempo: 2 }, rationale: 'retain card-count payoff through the conflict chain' }),
            edge({ id: 'monk:void-recursion', role: 'payoff',
                source: { cardIds: ['keeper-initiate'] }, partner: { tags: ['ring'] },
                scoreDelta: { ringValue: 3, boardFuture: 2 }, rationale: 'void claim recurs Keeper Initiate' }),
            edge({ id: 'monk:way-protection', role: 'enabler', source: { cardIds: ['way-of-the-dragon'] },
                partner: { cardIds: DRAGON_DEFAULTS.wayTargets }, conditions: ['partner-available'],
                scoreDelta: { flexibility: 3, comboProgress: 2 }, rationale: 'extra activation belongs only on repeatable high-value abilities' }),
            edge({ id: 'monk:high-house-protection', role: 'protection', source: { cardIds: ['high-house-of-light', 'finger-of-jade'] },
                partner: { cardIds: DRAGON_DEFAULTS.towerCharacters }, conditions: ['own-tower-present'],
                scoreDelta: { risk: 3, boardFuture: 2 }, rationale: 'protect the participating Monk engine' })
        ]
    }
}) as Readonly<Record<DeckSynergyArchetype, DeckSynergyProfile>>;

function mergeResourceProfiles(profiles: readonly DeckSynergyProfile[]): ResourcePlanningProfile {
    const primary = profiles[0]?.resourceProfile || { archetype: 'generic' as const };
    return {
        ...primary,
        cards: Object.assign({}, ...profiles.map((profile) => profile.resourceProfile.cards || {})),
        candidateValues: Object.assign({}, ...profiles.map((profile) => profile.resourceProfile.candidateValues || {}))
    };
}

function inferredProfileIds(context: DeckSynergyContext): DeckSynergyArchetype[] {
    const profile = context.profile || {};
    const id = String(context.deckProfileId || '').toLowerCase();
    const result: DeckSynergyArchetype[] = [];
    const add = (value: DeckSynergyArchetype, active: boolean) => { if(active && !result.includes(value)) result.push(value); };
    add('dragon-attachments', !!profile.attachmentTower || id.includes('dragon-attachment'));
    add('phoenix-shugenja', !!profile.shugenja || id.includes('phoenix-shugenja'));
    add('unicorn-movement', !!profile.unicorn || id.includes('unicorn'));
    add('crane-duel', !!profile.duelist || !!profile.craneBaseline || id.includes('crane'));
    add('lion-swarm', !!profile.lion || id.includes('lion'));
    add('scorpion-dishonor', !!profile.dishonor || id.includes('scorpion'));
    add('crab-holding', !!profile.mulliganForHoldings || !!profile.digWithActions || id.includes('crab'));
    add('phoenix-glory', !!profile.glory || id.includes('phoenix-glory'));
    add('dragon-monk', !!profile.dragon || id.includes('dragon-monk'));
    return result.sort();
}

function selectorMatches(selector: SynergySelector, candidate: BotActionCandidate,
    tags: ReadonlySet<string>): boolean {
    const tests: boolean[] = [];
    if(selector.cardIds) tests.push(!!candidate.source?.cardId && selector.cardIds.includes(candidate.source.cardId));
    if(selector.tags) tests.push(selector.tags.some((tag) => tags.has(tag)));
    if(selector.effectKinds) tests.push(selector.effectKinds.some((kind) => candidate.effects.some((effect) => effect.kind === kind)));
    if(selector.candidateKinds) tests.push(selector.candidateKinds.includes(candidate.kind));
    return tests.length > 0 && tests.some(Boolean);
}

export default class DeckSynergyContributor {
    constructor(private readonly semantics: CardSemanticRegistry,
        private readonly profiles = DECK_SYNERGY_PROFILES) {}

    contribute(state: PlanningState, candidates: readonly BotActionCandidate[],
        context: DeckSynergyContext = {}): DeckSynergyContribution {
        const profileIds = inferredProfileIds(context);
        const active = profileIds.map((id) => this.profiles[id]);
        const availableCardIds = this.availableCardIds(state, candidates);
        const availableTags = new Set(candidates.flatMap((candidate) => [...this.tags(candidate)]));
        const activations: SynergyActivation[] = [];
        const annotated = candidates.map((candidate) => {
            const tags = this.tags(candidate);
            const annotations: CandidateAnnotation[] = [];
            for(const profile of active) {
                for(const synergy of profile.edges) {
                    if(!selectorMatches(synergy.source, candidate, tags) ||
                        !this.conditionsMet(synergy, state, candidate, availableCardIds, availableTags)) continue;
                    const dynamic = this.dynamicDelta(profile.id, candidate, state);
                    annotations.push({
                        proposer: `deck-synergy:${profile.id}`,
                        note: `${synergy.role}:${synergy.id}`,
                        scoreDelta: this.mergeDelta(synergy.scoreDelta, dynamic)
                    });
                    activations.push({
                        profileId: profile.id, edgeId: synergy.id, candidateId: candidate.id,
                        role: synergy.role, rationale: synergy.rationale
                    });
                }
            }
            return annotations.length === 0 ? candidate : {
                ...candidate,
                annotations: [...(candidate.annotations || []), ...annotations]
            };
        });
        return immutable({
            candidates: annotated,
            profileIds,
            activations,
            resourceProfile: mergeResourceProfiles(active),
            fateReserve: active.reduce((maximum, profile) => Math.max(maximum, profile.fateReserve || 0), 0),
            conflictCardReserve: active.reduce((maximum, profile) => Math.max(maximum, profile.conflictCardReserve || 0), 0)
        }) as DeckSynergyContribution;
    }

    profileIds(context: DeckSynergyContext): readonly DeckSynergyArchetype[] {
        return inferredProfileIds(context);
    }

    private tags(candidate: BotActionCandidate): ReadonlySet<string> {
        const model = this.semantics.get(candidate.source?.cardId);
        return new Set([
            ...candidate.tags,
            ...(model?.planningTags || []),
            ...candidate.effects.map((effect) => effect.kind)
        ]);
    }

    private availableCardIds(state: PlanningState, candidates: readonly BotActionCandidate[]): ReadonlySet<string> {
        return new Set([
            ...candidates.map((candidate) => candidate.source?.cardId),
            ...state.characters.filter((character) => character.controllerId === state.perspectivePlayerId)
                .flatMap((character) => [character.cardId, ...character.attachments.map((attachment) => attachment.cardId)]),
            ...state.provinces.filter((province) => province.controllerId === state.perspectivePlayerId)
                .flatMap((province) => [province.cardId, ...province.holdingIds]),
            ...state.hands.filter((hand) => hand.playerId === state.perspectivePlayerId)
                .flatMap((hand) => hand.cards.map((card) => card.cardId))
        ].filter(Boolean) as string[]);
    }

    private partnerAvailable(selector: SynergySelector | undefined, cardIds: ReadonlySet<string>,
        tags: ReadonlySet<string>): boolean {
        if(!selector) return true;
        return !!selector.cardIds?.some((id) => cardIds.has(id)) || !!selector.tags?.some((tag) => tags.has(tag));
    }

    private conditionsMet(edge: DeckSynergyEdge, state: PlanningState, candidate: BotActionCandidate,
        cardIds: ReadonlySet<string>, tags: ReadonlySet<string>): boolean {
        if(edge.partner && !this.partnerAvailable(edge.partner, cardIds, tags)) return false;
        return (edge.conditions || []).every((condition) => {
            const mine = state.characters.filter((character) => character.controllerId === state.perspectivePlayerId);
            const enemy = state.characters.filter((character) => character.controllerId !== state.perspectivePlayerId);
            if(condition === 'partner-available') return this.partnerAvailable(edge.partner, cardIds, tags);
            if(condition === 'own-tower-present') return edge.partner?.cardIds?.some((id) => mine.some((character) => character.cardId === id)) || false;
            if(condition === 'own-honored-present') return mine.some((character) => character.honored);
            if(condition === 'enemy-dishonored-present') return enemy.some((character) => character.dishonored);
            if(condition === 'during-military-conflict') return state.conflict?.type === 'military';
            if(condition === 'own-participant-present') return mine.some((character) => character.participating);
            if(condition === 'winning-current-conflict') {
                if(!state.conflict) return false;
                const attacking = state.conflict.attackerId === state.perspectivePlayerId;
                return attacking ? state.conflict.attackerSkill > state.conflict.defenderSkill
                    : state.conflict.defenderSkill >= state.conflict.attackerSkill;
            }
            if(condition === 'duplicate-on-target') {
                const targetId = candidate.targets[0]?.kind === 'character' ? candidate.targets[0].instanceId : undefined;
                const target = mine.find((character) => character.instanceId === targetId);
                return !!candidate.source?.cardId && !!target?.attachments.some((attachment) =>
                    attachment.cardId === candidate.source!.cardId);
            }
            if(condition === 'holding-present') return state.provinces.some((province) =>
                province.controllerId === state.perspectivePlayerId && province.holdingIds.length > 0);
            if(condition === 'enemy-honor-pressured') return Object.values(state.players)
                .some((player) => player.id !== state.perspectivePlayerId && player.honor <= 6);
            if(condition === 'enemy-conflict-deck-pressured') return Object.values(state.players)
                .some((player) => player.id !== state.perspectivePlayerId && player.conflictDeckSize <= 10);
            return false;
        });
    }

    private dynamicDelta(profileId: DeckSynergyArchetype, candidate: BotActionCandidate,
        state: PlanningState): Partial<UtilityVector> {
        const cardId = candidate.source?.cardId;
        const mine = state.characters.filter((character) => character.controllerId === state.perspectivePlayerId);
        if(cardId === 'supernatural-storm') {
            const count = mine.filter((character) => character.traits.some((trait) => trait.toLowerCase() === 'shugenja')).length;
            return { conflictOutcome: Math.min(5, count), comboProgress: count };
        }
        if(cardId === 'iron-crane-legion') {
            const opponent = state.hands.find((hand) => hand.playerId !== state.perspectivePlayerId)?.size || 0;
            return { boardNow: Math.min(5, opponent) };
        }
        if(cardId === 'ujik-tactics') {
            const nonUnique = mine.filter((character) => !character.unique).length;
            return { conflictOutcome: Math.min(6, nonUnique), comboProgress: Math.min(3, nonUnique) };
        }
        if(cardId === 'for-greater-glory') {
            const bushi = mine.filter((character) => character.participating &&
                character.traits.some((trait) => trait.toLowerCase() === 'bushi')).length;
            return { boardFuture: Math.min(6, bushi * 1.5) };
        }
        if(profileId === 'unicorn-movement' && candidate.effects.some((effect) => effect.kind === 'move')) {
            const triggers = mine.filter((character) => ['moto-outrider', 'twilight-rider',
                'minami-kaze-regulars', 'higashi-kaze-company'].includes(character.cardId || '') ||
                character.attachments.some((attachment) => ['spyglass', 'adorned-barcha'].includes(attachment.cardId || ''))).length;
            return { comboProgress: Math.min(5, triggers), flexibility: Math.min(3, triggers) };
        }
        return {};
    }

    private mergeDelta(left: Partial<UtilityVector>, right: Partial<UtilityVector>): Partial<UtilityVector> {
        return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => [
            key,
            (left[key as keyof UtilityVector] || 0) + (right[key as keyof UtilityVector] || 0)
        ])) as Partial<UtilityVector>;
    }
}
