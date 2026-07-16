const SelectDefendersPrompt = require('../../../build/server/game/gamesteps/conflict/selectdefendersprompt.js').default;

describe('SelectDefendersPrompt', function() {
    beforeEach(function() {
        this.player = { cardsInPlay: [] };
        this.selected = jasmine.createSpyObj('selected', ['getEffects', 'getType', 'canDeclareAsDefender']);
        this.selected.getEffects.and.returnValue([]);
        this.selected.getType.and.returnValue('character');
        this.selected.canDeclareAsDefender.and.returnValue(true);
        this.selected.controller = this.player;
        this.extra = jasmine.createSpyObj('extra', ['getEffects', 'getType', 'canDeclareAsDefender']);
        this.extra.getEffects.and.returnValue([]);
        this.extra.getType.and.returnValue('character');
        this.extra.canDeclareAsDefender.and.returnValue(true);
        this.extra.controller = this.player;
        this.conflict = {
            conflictType: 'military',
            defenders: [this.selected],
            maxAllowedDefenders: 1
        };
        this.prompt = new SelectDefendersPrompt({}, this.player, this.conflict);
    });

    it('does not expose another defender after the conflict limit is reached', function() {
        expect(this.prompt.checkCardCondition(this.extra)).toBe(false);
    });

    it('still allows a selected defender to be unselected', function() {
        expect(this.prompt.checkCardCondition(this.selected)).toBe(true);
    });
});
