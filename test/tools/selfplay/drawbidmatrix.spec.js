'use strict';

const { PROFILES, SCENARIOS, rows } = require('../../../tools/selfplay/drawBidMatrix.js');

describe('drawBidMatrix self-play tool', function() {
    it('covers every reusable profile across every standard scenario', function() {
        const result = rows();
        expect(result.length).toBe(Object.keys(PROFILES).length * SCENARIOS.length);
        expect(new Set(result.map((row) => row.profile)).size).toBe(Object.keys(PROFILES).length);
        expect(result.every((row) => row.adaptive >= 1 && row.adaptive <= 5)).toBe(true);
        expect(result.every((row) => row.legacy >= 1 && row.legacy <= 5)).toBe(true);
    });
});
