/* global describe, it, expect */
'use strict';

const {
    DefenderRingChoicePolicy,
    DEFAULT_DEFENDER_RING_CHOICE
} = require('../../../build/server/game/bots/DefenderRingChoicePolicy.js');
const { DEFAULT_PROFILE } = require('../../../build/server/game/bots/DeckProfiles.js');

const RING_ORDER = ['air', 'earth', 'fire', 'water', 'void'];

const ring = (element, fate = 0) => ({ element, fate });

describe('DefenderRingChoicePolicy', function() {
    // Togashi Tadakatsu hands the element choice to the DEFENDER. The ranking
    // to use is the ATTACKER's, reversed: we are giving a ring away.
    const attackerValue = { void: 50, earth: 40, fire: 30, water: 8, air: 15 };
    const input = (rings, overrides) => Object.assign({
        rings,
        scoreForAttacker: (candidate) => attackerValue[candidate.element],
        scoreForSelf: (candidate) => attackerValue[candidate.element],
        elementOrder: RING_ORDER
    }, overrides || {});

    it('ships enabled', function() {
        expect(DEFAULT_DEFENDER_RING_CHOICE.enabled).toBe(true);
        expect(DEFAULT_PROFILE.defenderRingChoice.enabled).toBe(true);
    });

    it('hands over the ring the attacker wants LEAST', function() {
        const policy = new DefenderRingChoicePolicy();
        const result = policy.choose(input([ring('void'), ring('earth'), ring('water')]));
        expect(result.ring.element).toBe('water');
        expect(result.reason).toBe('defender-ring-worst-for-attacker');
    });

    it('exposes the whole ranking, worst-for-the-attacker first', function() {
        const policy = new DefenderRingChoicePolicy();
        const result = policy.choose(input([ring('void'), ring('earth'), ring('water'), ring('air')]));
        expect(result.ordered.map((candidate) => candidate.element))
            .toEqual(['water', 'air', 'earth', 'void']);
    });

    it('does not hand over a fate pile when the value is otherwise tied', function() {
        // The attacker banks the ring's fate at DECLARATION, so between two
        // rings they value the same, give away the empty one.
        const policy = new DefenderRingChoicePolicy();
        const flat = { scoreForAttacker: () => 0, scoreForSelf: () => 0 };
        const result = policy.choose(input([ring('air', 2), ring('earth', 0)], flat));
        expect(result.ring.element).toBe('earth');
        expect(result.ring.fate).toBe(0);
    });

    it('breaks a full tie deterministically by element order', function() {
        const policy = new DefenderRingChoicePolicy();
        const flat = { scoreForAttacker: () => 0, scoreForSelf: () => 0 };
        const result = policy.choose(input([ring('void'), ring('fire'), ring('air')], flat));
        expect(result.ring.element).toBe('air');
    });

    it('lets a fat ring go when the attacker values another one even more', function() {
        // Fate is a TIE-break, not the primary key: the attacker-perspective
        // score already prices a fate pile as its dominant term, so a policy
        // that led on fate would override that model rather than defer to it.
        const policy = new DefenderRingChoicePolicy();
        const result = policy.choose(input([ring('void', 0), ring('water', 3)]));
        expect(result.ring.element).toBe('water');
    });

    it('can turn the fate tie-break off', function() {
        const policy = new DefenderRingChoicePolicy({ preferLowFate: false });
        const flat = { scoreForAttacker: () => 0, scoreForSelf: () => 0 };
        const result = policy.choose(input([ring('air', 2), ring('earth', 0)], flat));
        expect(result.ring.element).toBe('air');
    });

    describe('the disabled arm', function() {
        it('reproduces V1: our OWN attacking preference, handed to the enemy', function() {
            const policy = new DefenderRingChoicePolicy({ enabled: false });
            const result = policy.choose(input([ring('void'), ring('earth'), ring('water')]));
            expect(result.ring.element).toBe('void');
            expect(result.reason).toBe('defender-ring-legacy-own-preference');
        });
    });

    it('returns null with nothing to choose from', function() {
        const policy = new DefenderRingChoicePolicy();
        expect(policy.choose(input([]))).toBeNull();
        expect(policy.choose(input([null, undefined]))).toBeNull();
    });
});
