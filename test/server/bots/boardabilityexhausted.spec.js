const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// The bot's `boardAbilityUsed` ledger counts what IT believes it spent and
// prices the limit from a playbook convention. The engine now publishes the
// real answer on the card summary as `abilitiesExhausted`
// (`AbilityLimit.isAtMax` on every limited ability), so the gate consults that
// FIRST.
//
// The direction matters: the engine flag is only ever used to say "cannot",
// never "can". A card the engine reports exhausted would refuse the click
// anyway, so this removes wasted decisions and can never unlock something — and
// crucially it can never take away a use the bot had before, because a card
// with a use left never reports exhausted.
describe('board ability gate reads the engine exhaustion flag', function() {
    const dragonIds = ['iron-mountain-castle', 'agasha-shunsen', 'niten-master'];
    const dragonProfile = resolveDeckProfile(dragonIds, deriveDeckStrategy(dragonIds));

    function holding(uuid, id, extra = {}) {
        return {
            id, uuid, type: 'holding', location: 'province 1',
            facedown: false, selectable: true, isPlayableByMe: false,
            ...extra
        };
    }

    function stateWith(cards, provinceCards = []) {
        return {
            players: {
                Dragon: {
                    name: 'Dragon', id: 'dragon-id', phase: 'conflict',
                    promptTitle: 'Conflict Action Window',
                    menuTitle: 'Military Air conflict\nAttacker: 4 Defender: 6',
                    buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                    stats: { fate: 5, honor: 10, conflictsRemaining: 1 },
                    cardPiles: { hand: [], cardsInPlay: cards },
                    provinces: { 'province 1': provinceCards },
                    strongholdProvince: []
                },
                Crane: {
                    name: 'Crane', id: 'crane-id', stats: { fate: 2, conflictsRemaining: 1 },
                    cardPiles: { cardsInPlay: [] }, strongholdProvince: []
                }
            },
            rings: {},
            conflict: {
                type: 'military', attackingPlayerId: 'dragon-id', defendingPlayerId: 'crane-id',
                attackerSkill: 4, defenderSkill: 6
            }
        };
    }

    // `boardAbilityIsUsed` is private; drive it through a policy instance the
    // same way the decide path does, so the test covers the real gate.
    function gate(cardSummary) {
        const policy = new JigokuBotPolicy(1);
        policy.decide(stateWith([]), 'Dragon', {
            profile: dragonProfile, cardHint: (id) => getPlaybookEntry(id)
        });
        return policy.boardAbilityIsUsed(cardSummary);
    }

    it('treats an engine-exhausted card as used', function() {
        expect(gate(holding('h1', 'bonsai-garden', { abilitiesExhausted: true }))).toBe(true);
    });

    it('leaves a card with abilities remaining available', function() {
        expect(gate(holding('h1', 'bonsai-garden', { abilitiesExhausted: false }))).toBe(false);
    });

    it('leaves a card that publishes nothing on the old ledger path', function() {
        // Synthetic contexts and older callers have no summary field at all.
        // Those must behave exactly as before, or every unit spec built on a
        // hand-written board would change meaning.
        expect(gate(holding('h1', 'bonsai-garden'))).toBe(false);
        expect(gate(holding('h1', 'bonsai-garden', { abilitiesExhausted: undefined }))).toBe(false);
        expect(gate(holding('h1', 'bonsai-garden', { abilitiesExhausted: null }))).toBe(false);
    });

    it('only accepts a literal true, never a truthy value', function() {
        // The flag is a boolean from the server. Anything else means the field
        // was not understood, and guessing "used" would silently disable a card.
        expect(gate(holding('h1', 'bonsai-garden', { abilitiesExhausted: 'yes' }))).toBe(false);
        expect(gate(holding('h1', 'bonsai-garden', { abilitiesExhausted: 1 }))).toBe(false);
    });

    it('never takes a use away that the bot ledger still allows', function() {
        // Way of the Dragon raises the engine limit to 2 via
        // `IncreaseLimitOnAbilities`, which `getModifiedLimitMax` feeds into
        // `isAtMax` — so after ONE use the engine reports NOT exhausted and the
        // bot keeps its second use. This is the case where a naive "one use and
        // done" flag would have cost the deck an ability.
        const bearer = holding('c1', 'togashi-mitsu', {
            type: 'character', location: 'play area', inConflict: true, bowed: false,
            abilitiesExhausted: false,
            attachments: [{ id: 'way-of-the-dragon', uuid: 'way', type: 'attachment' }]
        });
        expect(gate(bearer)).toBe(false);
    });

    it('is consulted before the ledger, so it can close a card the ledger thinks is fresh', function() {
        const fresh = holding('h1', 'bonsai-garden', { abilitiesExhausted: true });
        const policy = new JigokuBotPolicy(1);
        policy.decide(stateWith([]), 'Dragon', {
            profile: dragonProfile, cardHint: (id) => getPlaybookEntry(id)
        });
        // Nothing has been recorded against this card in the ledger.
        expect(policy.boardAbilityIsUsed({ ...fresh, abilitiesExhausted: false })).toBe(false);
        expect(policy.boardAbilityIsUsed(fresh)).toBe(true);
    });
});
