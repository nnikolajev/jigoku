const AttackersMatrix = require('../../../build/server/game/gamesteps/conflict/attackersMatrix.js').default;

describe('AttackersMatrix', function() {
    function makeMatrix(canAttack) {
        const province = { canDeclare: () => true };
        const rings = Object.fromEntries(['air', 'earth', 'fire', 'void', 'water'].map((name) => [
            name,
            { name }
        ]));
        const character = {
            canDeclareAsAttacker: () => canAttack,
            getEffects: () => []
        };
        const player = {
            opponent: { getProvinces: () => [province] },
            hasLegalConflictDeclaration: () => true,
            getEffects: () => []
        };
        return { matrix: new AttackersMatrix(player, [character], { rings }), ring: rings.air };
    }

    it('rejects a ring/type combination with no legal attacker', function() {
        const { matrix, ring } = makeMatrix(false);

        expect(matrix.isCombinationValid(ring, 'political')).toBeFalse();
        expect(matrix.isCombinationValid(ring, 'military')).toBeFalse();
    });

    it('accepts a ring/type combination with a legal attacker', function() {
        const { matrix, ring } = makeMatrix(true);

        expect(matrix.isCombinationValid(ring, 'political')).toBeTrue();
        expect(matrix.isCombinationValid(ring, 'military')).toBeTrue();
    });

    it('checks legal attackers against the province already chosen for the conflict', function() {
        const openProvince = { canDeclare: () => true, toString: () => 'open' };
        const blockedProvince = { canDeclare: () => true, toString: () => 'blocked' };
        const rings = Object.fromEntries(['air', 'earth', 'fire', 'void', 'water'].map((name) => [
            name,
            { name }
        ]));
        const character = {
            canDeclareAsAttacker: (_type, _ring, province) => province === openProvince,
            getEffects: () => []
        };
        const player = {
            opponent: { getProvinces: () => [openProvince, blockedProvince] },
            hasLegalConflictDeclaration: () => true,
            getEffects: () => []
        };
        const matrix = new AttackersMatrix(player, [character], { rings });

        expect(matrix.isCombinationValid(rings.air, 'political')).toBeTrue();
        expect(matrix.isCombinationValid(rings.air, 'political', blockedProvince)).toBeFalse();
    });

    it('builds a forced conflict from its declared type before it becomes the current conflict', function() {
        const province = { canDeclare: () => true };
        const rings = Object.fromEntries(['air', 'earth', 'fire', 'void', 'water'].map((name) => [
            name,
            { name }
        ]));
        const character = {
            canDeclareAsAttacker: () => true,
            getEffects: () => []
        };
        const player = {
            opponent: { getProvinces: () => [province] },
            hasLegalConflictDeclaration: ({ type, forcedDeclaredType }) =>
                !forcedDeclaredType || type === forcedDeclaredType,
            getEffects: () => []
        };
        const matrix = new AttackersMatrix(player, [character], { rings }, 'military');

        expect(matrix.isCombinationValid(rings.fire, 'military')).toBeTrue();
        expect(matrix.isCombinationValid(rings.fire, 'political')).toBeFalse();
    });
});
