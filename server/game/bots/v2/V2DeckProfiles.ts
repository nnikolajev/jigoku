import type { DeckProfile } from '../DeckProfiles';
import type { ConflictPhasePlannerProfile } from '../ConflictPhasePlanner';
import type { ConflictIntentProfile } from '../DeckConflictIntents';
import type { ConflictActionProfile } from './ConflictActionPlanner';

/**
 * Bot V2's per-deck tuning.
 *
 * V2 is the same heuristic bot as V1 with more inputs and more knobs, so it is
 * tuned per deck the same way V1 is (`docs/bot-v2-deck-tuning.md`). These
 * overrides layer on top of the deck's resolved V1 profile and apply **only**
 * when the V2 engine is selected, so V1's measured behavior stays frozen and
 * every V2-vs-V1 comparison remains a clean A/B.
 *
 * Keyed by the V1 override names recorded in `DeckProfile.overrideNames`, so a
 * V2 entry is literally "the V1 deck override, same name, V2 version".
 */
export interface V2DeckOverride {
    conflictPlanning?: Partial<ConflictPhasePlannerProfile>;
    conflictIntents?: ConflictIntentProfile;
    conflictActionPlan?: Partial<ConflictActionProfile>;
}

/**
 * Every entry here is measured, cross-deck, against a paired V1 control seat.
 * Nothing is added on plausibility alone — see the results table in
 * `docs/bot-v2-deck-tuning.md`.
 *
 * On `axis` rules: a player has one military AND one political opportunity per
 * round, so an axis rule cannot change WHICH conflicts happen, only their
 * order. It is therefore worth nothing unless it flips V1's default. Measured
 * at 36 paired games each: Lion 0.0pp and Crab 0.0pp (V1 already declared
 * military first — literally zero discordant games), Scorpion -5.6pp, and
 * Phoenix +11.1pp. Only Phoenix is kept: it is the one deck whose measured
 * break rate per declaration is far higher on political (.67) than military
 * (.42) while V1 declared military first.
 */
/**
 * V2's baseline, applied to every deck before its own entry below — the V2
 * analogue of `DEFAULT_PROFILE`, and still V2-only so V1 stays frozen.
 *
 * `applyAttackerPlan` is the declaration layer that had never been measured.
 * V1 sizes each attack in isolation ("commit skill until it clears the province
 * plus the opponent's whole possible defense"), which throws bodies into
 * conflicts it cannot break and leaves nothing for the second conflict or for
 * defense. The rollout instead commits the smallest set that wins the PHASE.
 *
 * Measured cross-deck on three seeds, 180 paired games each, versus a V1
 * control seat on identical shuffles: +5.0pp / +9.4pp / +6.1pp, pooling to
 * **V2 57.0% vs V1 50.2% (+6.9pp) over n=540**, 117 discordant pairs split
 * 77-40 for V2 (McNemar two-sided p = 0.00087).
 *
 * It is a base default because it helps broadly: pooled per deck, only Unicorn
 * regresses, and it opts out below. Full table in docs/bot-v2-deck-tuning.md.
 */
/**
 * `useCardValueModel` and `vetoDeadCards` are deliberately NOT enabled here.
 *
 * Both were built and measured on this exact baseline (seed 1, n=180 paired,
 * V1 control 109-71 in every run) and both cost games, monotonically:
 *
 *   baseline (this profile)            121-59  +6.7pp
 *   cancel gate reduced to a no-op     120-60  +6.1pp
 *   reaction gate, threshold 4         118-62  +5.0pp
 *   reaction gate + structural veto    114-66  +2.8pp
 *
 * The mechanism is specific and worth remembering: Voice of Honor and Defend
 * Your Honor both cost 0 fate, so an unplayed one is worth exactly 0. Holding
 * either for a target above a value threshold loses more than it saves, because
 * the better target frequently never arrives - V1's "fire at anything" is close
 * to optimal for a card with no alternative use. Full write-up in
 * docs/bot-v2-deck-tuning.md.
 */
export const V2_BASE_OVERRIDE: V2DeckOverride = {
    conflictPlanning: { applyAttackerPlan: true }
};

export const V2_DECK_OVERRIDES: Readonly<Record<string, V2DeckOverride>> = Object.freeze({
    'phoenix-rally-stronghold': {
        conflictPlanning: { applyIntentPlan: true },
        conflictIntents: {
            enabled: true,
            rules: [
                {
                    // `bonus` is confidence, not an order: at 2.5 (about one
                    // conflict win) the political conflict wins every close
                    // call, but the rollout still declines it when the board
                    // says it loses. Aggression is preserved, not overridden.
                    id: 'phoenix-political',
                    axis: 'political',
                    bonus: 2.5,
                    reason: 'phoenix-political-axis'
                }
            ]
        }
    }
    // REMOVED 2026-08-02: `unicorn-cavalry-rush` used to opt out of
    // `applyAttackerPlan` on a -11.1pp seed-1 measurement. That result did not
    // reproduce when the flag was re-measured per deck on the current tree
    // (Unicorn +0.8pp), and the opt-out was dropped from V1 at the same time.
    // Leaving it here made V2's Unicorn strictly V1-minus-a-feature, which
    // silently biased every V2-vs-V1 Unicorn row.
});

/**
 * Layer this deck's V2 overrides onto its resolved V1 profile. Returns the same
 * object when the deck has no V2 entry, so non-tuned decks are untouched.
 */
export function applyV2DeckProfile(profile: DeckProfile | undefined): DeckProfile | undefined {
    if(!profile) {
        return profile;
    }
    const names = profile.overrideNames || [];
    const matched = [
        V2_BASE_OVERRIDE,
        ...names.map((name) => V2_DECK_OVERRIDES[name]).filter(Boolean) as V2DeckOverride[]
    ];
    const merged: DeckProfile = { ...profile };
    for(const override of matched) {
        if(override.conflictPlanning) {
            merged.conflictPlanning = { ...merged.conflictPlanning, ...override.conflictPlanning };
        }
        if(override.conflictActionPlan) {
            merged.conflictActionPlan = { ...merged.conflictActionPlan, ...override.conflictActionPlan };
        }
        if(override.conflictIntents) {
            merged.conflictIntents = {
                ...merged.conflictIntents,
                ...override.conflictIntents,
                rules: (override.conflictIntents.rules || merged.conflictIntents.rules || [])
                    .map((rule) => ({ ...rule })),
                defenseRules: (override.conflictIntents.defenseRules ||
                    merged.conflictIntents.defenseRules || []).map((rule) => ({ ...rule }))
            };
        }
    }
    return merged;
}

export default V2_DECK_OVERRIDES;
