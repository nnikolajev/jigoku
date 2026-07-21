const CardSemanticRegistry = require('../../../build/server/game/bots/v2/cards/CardSemantics.js').default;
const { REPRESENTATIVE_SEMANTICS } = require('../../../build/server/game/bots/v2/cards/GenericSemantics.js');

describe('V2 semantic projection parity with live Jigoku rules', function() {
    integration(function() {
        const registry = new CardSemanticRegistry(REPRESENTATIVE_SEMANTICS);
        const semanticState = Object.freeze({ perspectivePlayerId: 'player1' });
        const candidate = (cardId, target, mode) => ({
            id: `semantic:${cardId}:${mode || 'primary'}`, kind: 'conflict-card',
            source: { kind: 'card', instanceId: cardId, cardId, controllerId: 'player1', location: 'hand' },
            mode, targets: target ? [target] : [], commandPreview: { command: 'cardClicked', args: [cardId] },
            costs: { cards: 1 }, effects: [], prerequisites: [], tags: [], limits: [],
            uncertainty: 0, confidence: 1, proposer: 'semantic-parity'
        });

        it('matches Banzai base military delta and participant target rule', function() {
            this.setupTest({
                phase: 'conflict',
                player1: { inPlay: ['miya-mystic', 'seppun-guardsman'], hand: ['banzai'] },
                player2: {}
            });
            const mystic = this.player1.findCardByName('miya-mystic');
            this.noMoreActions();
            this.initiateConflict({ type: 'military', attackers: [mystic], defenders: [] });
            this.player2.pass();
            const before = mystic.getMilitarySkill();
            this.player1.clickCard('banzai', 'hand');
            this.player1.clickCard(mystic);
            const projection = registry.project('banzai', semanticState, candidate('banzai', {
                kind: 'character', instanceId: mystic.uuid, cardId: mystic.id, controllerId: 'player1'
            }));
            expect(mystic.getMilitarySkill() - before).toBe(projection.effects[0].military);
            expect(registry.get('banzai').actions[0].targets[0].participating).toBeTrue();
            this.player1.clickPrompt('Done');
        });

        it('matches Court Games dishonor mode and target side', function() {
            this.setupTest({
                phase: 'conflict',
                player1: { inPlay: ['moto-juro'] },
                player2: { inPlay: ['asako-tsuki'], hand: ['court-games'] }
            });
            const rider = this.player1.findCardByName('moto-juro');
            this.noMoreActions();
            this.initiateConflict({ type: 'political', attackers: [rider], defenders: ['asako-tsuki'] });
            this.player2.clickCard('court-games', 'hand');
            this.player2.clickPrompt('Dishonor an opposing character');
            this.player1.clickCard(rider);
            const projection = registry.project('court-games', semanticState, candidate('court-games', {
                kind: 'character', instanceId: rider.uuid, cardId: rider.id, controllerId: 'player1'
            }, 'Dishonor an opposing character'));
            expect(rider.isDishonored).toBeTrue();
            expect(projection.effects[0]).toEqual(jasmine.objectContaining({ kind: 'status', status: 'dishonored' }));
            expect(registry.get('court-games').actions[1].targets[0].side).toBe('opponent');
        });

        it('matches Assassination honor cost and discard outcome', function() {
            this.setupTest({
                phase: 'conflict',
                player1: { inPlay: ['togashi-initiate'], hand: ['assassination'] },
                player2: { inPlay: ['miya-mystic'] }
            });
            const initiate = this.player1.findCardByName('togashi-initiate');
            const victim = this.player2.findCardByName('miya-mystic');
            const honor = this.player1.player.honor;
            this.noMoreActions();
            this.initiateConflict({ attackers: [initiate], defenders: [] });
            this.player2.pass();
            this.player1.clickCard('assassination', 'hand');
            this.player1.clickCard(victim);
            const model = registry.get('assassination');
            expect(honor - this.player1.player.honor).toBe(model.actions[0].cost.honor);
            expect(victim.location).toBe('dynasty discard pile');
            expect(model.actions[0].effects[0]).toEqual(jasmine.objectContaining({ kind: 'remove', method: 'discard' }));
        });

        it('matches Fine Katana persistent military skill delta', function() {
            this.setupTest({
                phase: 'conflict',
                player1: { inPlay: ['miya-mystic'], hand: ['fine-katana'] },
                player2: {}
            });
            const mystic = this.player1.findCardByName('miya-mystic');
            const before = mystic.getMilitarySkill();
            this.player1.playAttachment('fine-katana', mystic);
            const skillEffect = registry.get('fine-katana').actions[0].effects.find((effect) => effect.kind === 'skill');
            expect(mystic.getMilitarySkill() - before).toBe(skillEffect.military);
            expect(skillEffect.duration).toBe('while-attached');
        });
    });
});
