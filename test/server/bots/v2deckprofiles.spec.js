/* eslint-env jasmine */
const {
    applyV2DeckProfile,
    V2_BASE_OVERRIDE,
    V2_DECK_OVERRIDES
} = require('../../../build/server/game/bots/v2/V2DeckProfiles.js');
const { DEFAULT_PROFILE, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

describe('Bot V2 per-deck profiles', function() {
    it('leaves an undefined profile alone', function() {
        expect(applyV2DeckProfile(undefined)).toBeUndefined();
    });

    it('applies the V2 baseline to a deck with no V2 entry of its own', function() {
        const base = clone(DEFAULT_PROFILE);
        base.overrideNames = ['some-deck-with-no-v2-tuning'];
        const v2 = applyV2DeckProfile(base);
        expect(v2.conflictPlanning.applyAttackerPlan).toBe(true);
        expect(v2.conflictIntents.enabled).toBe(false);
    });

    it('never mutates the profile it is given', function() {
        const base = clone(DEFAULT_PROFILE);
        base.overrideNames = ['phoenix-rally-stronghold'];
        const before = clone(base);
        applyV2DeckProfile(base);
        expect(base).toEqual(before);
    });

    it('layers a deck entry over the baseline', function() {
        const base = clone(DEFAULT_PROFILE);
        base.overrideNames = ['phoenix-rally-stronghold'];
        const v2 = applyV2DeckProfile(base);
        expect(v2.conflictPlanning.applyAttackerPlan).toBe(true);
        expect(v2.conflictPlanning.applyIntentPlan).toBe(true);
        expect(v2.conflictIntents.enabled).toBe(true);
        expect(v2.conflictIntents.rules.map((rule) => rule.id)).toEqual(['phoenix-political']);
        expect(v2.conflictIntents.rules[0].axis).toBe('political');
    });

    it('lets a deck opt out of a baseline flag', function() {
        const base = clone(DEFAULT_PROFILE);
        base.overrideNames = ['unicorn-cavalry-rush'];
        expect(applyV2DeckProfile(base).conflictPlanning.applyAttackerPlan).toBe(false);
    });

    it('keeps every other knob of the deck profile intact', function() {
        const base = clone(DEFAULT_PROFILE);
        base.overrideNames = ['phoenix-rally-stronghold'];
        base.attackCommitment = 'breakable-or-hold';
        base.attackKeepHome = 2;
        const v2 = applyV2DeckProfile(base);
        expect(v2.attackCommitment).toBe('breakable-or-hold');
        expect(v2.attackKeepHome).toBe(2);
        expect(v2.provinceTargeting).toEqual(base.provinceTargeting);
    });

    it('copies rule objects so a resolved profile cannot corrupt the shared table', function() {
        const base = clone(DEFAULT_PROFILE);
        base.overrideNames = ['phoenix-rally-stronghold'];
        applyV2DeckProfile(base).conflictIntents.rules[0].axis = 'military';
        expect(V2_DECK_OVERRIDES['phoenix-rally-stronghold'].conflictIntents.rules[0].axis)
            .toBe('political');
    });

    // The whole V2-vs-V1 comparison depends on this: V2 tuning must never
    // reach the V1 engine, which only ever sees the resolved deck profile.
    describe('V1 stays frozen', function() {
        it('ships every V2-only declaration layer off in the shared defaults', function() {
            // applyAttackerPlan graduated into V1 on 2026-07-31 and is no
            // longer a V2-only layer; the rest stay V2-only.
            expect(DEFAULT_PROFILE.conflictPlanning.applyAttackerPlan).toBe(true);
            expect(DEFAULT_PROFILE.conflictPlanning.applyIntentPlan).toBe(false);
            expect(DEFAULT_PROFILE.conflictPlanning.applyTypePlan).toBe(false);
            expect(DEFAULT_PROFILE.conflictPlanning.applyRingPlan).toBe(false);
            expect(DEFAULT_PROFILE.conflictIntents.enabled).toBe(false);
            expect(DEFAULT_PROFILE.conflictIntents.rules).toEqual([]);
        });

        it('carries no conflict intents through any V1 per-deck override', function() {
            // resolveDeckProfile is the only profile the V1 engine ever sees.
            const profile = resolveDeckProfile(new Set(), undefined);
            expect(profile.conflictIntents.enabled).toBe(false);
            expect(profile.conflictPlanning.applyAttackerPlan).toBe(true);
        });

        it('only turns layers on through the V2 tables', function() {
            expect(V2_BASE_OVERRIDE.conflictPlanning.applyAttackerPlan).toBe(true);
        });
    });

    describe('every registered V2 deck entry is well formed', function() {
        it('names rules uniquely and gives each an id', function() {
            for(const [deck, override] of Object.entries(V2_DECK_OVERRIDES)) {
                const rules = (override.conflictIntents && override.conflictIntents.rules) || [];
                const ids = rules.map((rule) => rule.id);
                expect(ids.length).withContext(`${deck} rule ids`).toBe(new Set(ids).size);
                for(const rule of rules) {
                    expect(rule.id).withContext(`${deck} rule id present`).toBeTruthy();
                }
            }
        });

        it('turns the intent layer on whenever it supplies rules', function() {
            for(const [deck, override] of Object.entries(V2_DECK_OVERRIDES)) {
                const rules = (override.conflictIntents && override.conflictIntents.rules) || [];
                if(rules.length > 0) {
                    expect(override.conflictIntents.enabled).withContext(`${deck} enabled`).toBe(true);
                    expect(override.conflictPlanning && override.conflictPlanning.applyIntentPlan)
                        .withContext(`${deck} applyIntentPlan`).toBe(true);
                }
            }
        });
    });
});
