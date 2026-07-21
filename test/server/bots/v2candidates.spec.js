const CandidateRegistry = require('../../../build/server/game/bots/v2/CandidateRegistry.js').default;
const { deduplicateCandidates } = require('../../../build/server/game/bots/v2/CandidateRegistry.js');
const PerspectiveSnapshotBuilder = require('../../../build/server/game/bots/v2/PerspectiveSnapshotBuilder.js').default;

describe('V2 candidate collection', function() {
    const builder = new PerspectiveSnapshotBuilder();
    const basePlayer = (prompt = {}) => ({
        name: 'Bot', phase: prompt.phase || 'conflict', stats: { fate: prompt.fate ?? 3, honor: 9 },
        promptTitle: prompt.promptTitle || '', menuTitle: prompt.menuTitle || '',
        buttons: prompt.buttons || [], selectCard: prompt.selectCard, selectRing: prompt.selectRing,
        cardPiles: { hand: prompt.hand || [], cardsInPlay: prompt.cardsInPlay || [], conflictDeck: [{}, {}] },
        provinces: prompt.provinces || { one: [], two: [], three: [], four: [] }, strongholdProvince: []
    });
    function context(prompt, extraContext = {}, v1Decision = { command: 'menuButton', args: ['pass', 'p'], target: 'Pass', reason: 'v1-pass' }) {
        const input = {
            botName: 'Bot', context: extraContext,
            playerState: {
                phase: prompt.phase || 'conflict',
                players: {
                    Bot: basePlayer(prompt),
                    Opponent: basePlayer({ promptTitle: '', menuTitle: '', fate: 2 })
                },
                rings: prompt.rings || {}
            }
        };
        return {
            input,
            state: builder.build(input, { informationMode: 'fair' }),
            v1Decision
        };
    }

    it('creates generic pass, confirmation, bid, mulligan, discard, target, and mode candidates', function() {
        const registry = new CandidateRegistry();
        const fixtures = [
            [{ promptTitle: 'Conflict Action Window', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'p' }] }, 'pass'],
            [{ promptTitle: 'Are you sure?', buttons: [{ text: 'Yes', arg: 'yes', uuid: 'y' }] }, 'confirmation'],
            [{ promptTitle: 'Honor Bid', buttons: [{ text: '3', arg: '3', uuid: 'b' }] }, 'bid'],
            [{ promptTitle: 'Dynasty Mulligan', buttons: [{ text: 'Done', arg: 'done', uuid: 'd' }] }, 'mulligan'],
            [{ promptTitle: 'Discard Dynasty Cards', buttons: [{ text: 'Done', arg: 'done', uuid: 'd' }] }, 'discard'],
            [{ promptTitle: 'Choose a target', selectCard: true, cardsInPlay: [{ uuid: 'target', id: 'target', type: 'character', location: 'play area', selectable: true }] }, 'target-selection'],
            [{ promptTitle: 'Choose an ability:', buttons: [{ text: 'Ready', arg: 'ready', uuid: 'r' }] }, 'mode-selection']
        ];
        for(const [prompt, expected] of fixtures) {
            const collection = registry.collect(context(prompt));
            expect(collection.candidates.some((candidate) => candidate.kind === expected))
                .withContext(`${prompt.promptTitle}/${expected}`).toBeTrue();
            expect(collection.candidates.some((candidate) => candidate.kind === 'v1-fallback')).toBeTrue();
        }
    });

    it('does not generate ring clicks from globally visible rings on an unrelated prompt', function() {
        const registry = new CandidateRegistry();
        const stale = registry.collect(context({
            promptTitle: 'Choose a target',
            rings: { fire: { element: 'fire', unselectable: false } }
        }));
        expect(stale.candidates.some((candidate) => candidate.kind === 'ring-choice')).toBeFalse();

        const live = registry.collect(context({
            promptTitle: 'Choose a ring', selectRing: true,
            rings: { fire: { element: 'fire', unselectable: false } }
        }));
        expect(live.candidates.some((candidate) => candidate.kind === 'ring-choice')).toBeTrue();
    });

    it('enumerates every affordable dynasty fate amount and legal in-play ability without submitting commands', function() {
        const prompt = {
            phase: 'dynasty', fate: 4, promptTitle: 'Play cards from provinces', menuTitle: 'Click pass when done',
            provinces: {
                one: [{ uuid: 'recruit', id: 'recruit', name: 'Recruit', type: 'character', location: 'province 1', facedown: false, cost: 2 }],
                two: [], three: [], four: []
            },
            cardsInPlay: [{
                uuid: 'holding', id: 'holding', type: 'holding', location: 'play area',
                menu: [{ command: 'ability-1', text: 'Use holding' }]
            }],
            buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }]
        };
        const collection = new CandidateRegistry().collect(context(prompt, {
            dynastyCosts: { recruit: 2 }, legalDirectCardUuids: { recruit: true }
        }));
        const purchases = collection.candidates.filter((candidate) => candidate.kind === 'dynasty-purchase');
        expect(purchases.map((candidate) => candidate.mode)).toEqual([
            'additional-fate:2', 'additional-fate:0', 'additional-fate:1'
        ].sort((a, b) => purchases.find((candidate) => candidate.mode === a).id.localeCompare(purchases.find((candidate) => candidate.mode === b).id)));
        expect(new Set(purchases.map((candidate) => candidate.costs.fate))).toEqual(new Set([2, 3, 4]));
        expect(purchases.every((candidate) => candidate.macro.steps.map((step) => step.kind).join(',') === 'source,cost')).toBeTrue();
        expect(collection.candidates.some((candidate) => candidate.kind === 'dynasty-ability')).toBeTrue();
    });

    it('covers conflict declarations, attackers, defenders, conflict cards, reactions, and interrupts', function() {
        const registry = new CandidateRegistry();
        const fixtures = [
            [{ promptTitle: 'Initiate Conflict', rings: { fire: { element: 'fire', unselectable: false } } }, 'conflict-declaration'],
            [{ promptTitle: 'Military Fire Conflict', menuTitle: 'Choose attackers', cardsInPlay: [{ uuid: 'a', id: 'a', name: 'A', type: 'character', location: 'play area', selectable: true }] }, 'attacker-set'],
            [{ promptTitle: 'Military Fire Conflict', menuTitle: 'Choose defenders', cardsInPlay: [{ uuid: 'd', id: 'd', name: 'D', type: 'character', location: 'play area', selectable: true }] }, 'defender-set'],
            [{ promptTitle: 'Conflict Action Window', hand: [{ uuid: 'event', id: 'banzai', name: 'Banzai!', type: 'event', location: 'hand', selectable: true }] }, 'conflict-card'],
            [{ promptTitle: 'Any reactions?', cardsInPlay: [{ uuid: 'r', id: 'r', name: 'R', type: 'character', location: 'play area', selectable: true }] }, 'reaction'],
            [{ promptTitle: 'Any interrupts?', cardsInPlay: [{ uuid: 'i', id: 'i', name: 'I', type: 'character', location: 'play area', selectable: true }] }, 'interrupt']
        ];
        for(const [prompt, kind] of fixtures) {
            const collection = registry.collect(context(prompt));
            expect(collection.candidates.some((candidate) => candidate.kind === kind))
                .withContext(`${prompt.promptTitle}/${prompt.menuTitle || ''}/${kind}`).toBeTrue();
        }
    });

    it('deduplicates semantic candidates while preserving proposer annotations and score deltas', function() {
        const base = {
            id: 'candidate:a', kind: 'pass', targets: [], commandPreview: { command: 'menuButton', args: ['pass', 'p'], target: 'Pass' },
            costs: {}, effects: [], prerequisites: [], tags: [], limits: [], uncertainty: 0.2, confidence: 0.8, proposer: 'first',
            annotations: [{ proposer: 'first', scoreDelta: { initiative: 1 } }]
        };
        const duplicate = {
            ...base, id: 'candidate:b', uncertainty: 0.1, confidence: 0.9, proposer: 'second',
            annotations: [{ proposer: 'second', scoreDelta: { flexibility: 2 } }]
        };
        const deduped = deduplicateCandidates([base, duplicate]);
        expect(deduped.length).toBe(1);
        expect(deduped[0].confidence).toBe(0.9);
        expect(deduped[0].uncertainty).toBe(0.1);
        expect(deduped[0].annotations.map((annotation) => annotation.proposer)).toEqual(['first', 'second', 'second']);
    });

    it('gives every unsupported live prompt an explicit V1 fallback or unsupported reason', function() {
        const withFallback = new CandidateRegistry().collect(context({ promptTitle: 'Completely Unknown', menuTitle: 'Mystery' }));
        expect(withFallback.hasNativeV2Candidate).toBeFalse();
        expect(withFallback.fallbackReason).toBe('no-native-v2-candidates');
        expect(withFallback.candidates[0].kind).toBe('v1-fallback');

        const withoutDecision = new CandidateRegistry().collect(context(
            { promptTitle: 'Completely Unknown', menuTitle: 'Mystery' }, {}, null
        ));
        expect(withoutDecision.candidates).toEqual([]);
        expect(withoutDecision.fallbackReason).toBe('unsupported-prompt');
    });
});
