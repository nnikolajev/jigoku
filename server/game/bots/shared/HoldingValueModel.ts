// SHARED (V1 + V2). Lived under `v2/` until 2026-08-13; moved to `shared/`
// once measurement showed V1 imports it at RUNTIME, so it was never
// experimental. Changing it changes the shipping bot — prove any edit
// bit-identical with `tools/selfplay/refactorIdentity.js`.
//
// What a HOLDING is worth, for the cards that spend one.
//
// Several effects pay for themselves with a holding we control — Kaiu Siege
// Force bottoms one to ready itself, Favorable Ground and Imperial Storehouse
// sacrifice themselves outright. None of them can be priced without knowing what
// the holding being given up was actually doing, and until now the bot only had
// a bare list of strength bonuses with no card identity attached.
//
// A holding is worth two separable things:
//
//   1. Province strength, which is pure break arithmetic — +1 strength is worth
//      the same as +1 skill to the defender, and it lasts the whole game. Worth
//      NOTHING once that province is broken: a province cannot be broken twice,
//      so a holding sitting behind a broken one is already spent and is the
//      cheapest thing on the board to give away.
//   2. Its ongoing ability, which strength_bonus does not capture at all —
//      River of the Last Stand is +0 strength and still a real card.
//

import { PROVINCE_STRENGTH_SCORE, stayReadyValue } from './CardValueTypes.js';
import { blocked, hold } from './CardValueTypes.js';
import type { CardValue, CardValueContext, HoldingInPlay } from './CardValueTypes';

/**
 * Curated worth of a holding's ONGOING ability, on the same scale as skill.
 *
 * These numbers are deliberately SMALL relative to the strength term, and that
 * is a measured decision rather than a shrug. `tools/selfplay/cardLab.js` with
 * `scenarios/crabWallHoldings.js` replays one province defence while swapping
 * only the holding, at five attack sizes, with the real bot on both seats:
 *
 *   holding                       strength  outcome under a 15-skill attack
 *   no holding / river (+0)             4    defender does not defend at all
 *   watchtower-of-valor (+1)            5    breaks
 *   watchtower-suns-shadow (+1)         5    breaks
 *   third-whisker-warrens (+1)          5    breaks
 *   seventh-tower (+2)                  6    breaks
 *   kaiu-forges (+3)                    7    breaks by exactly 0
 *   northern-curtain-wall (+4)          8    HELD
 *
 * Two findings drove this table. First, outcomes tracked STRENGTH and nothing
 * else — every +1 holding behaved identically to every other +1, including the
 * ones with abilities, so a wide ability spread has no support. Second, the
 * effect is a THRESHOLD, not a slope: +3 lost by one point and +4 won, which is
 * why strength is multiplied rather than added to.
 *
 * A third finding is why the ability term is not simply zero: with no holding
 * (or a +0 one) the defender declined to defend at all, so a holding also buys
 * the decision to contest. And the lab measures DEFENCE only — Kaiu Forges digs
 * and Imperial Palace wins the favour, neither of which a defence fixture can
 * see. The band is 1-3 to reflect real but unmeasured worth.
 *
 * Unlisted holdings fall back to `DEFAULT_HOLDING_ABILITY_VALUE`.
 */
export const HOLDING_ABILITY_VALUE: Readonly<Record<string, number>> = Object.freeze({
    // Crab wall. Note the Kaiu Wall holdings buff each other — the lab confirms
    // Northern Curtain Wall lifting an adjacent +1 to +3 — but that shows up as
    // STRENGTH on the other card, so it must not be double-counted here.
    'northern-curtain-wall': 3,
    'kaiu-forges': 3, // dig 10 deep; economy the defence lab cannot see
    'seventh-tower': 2,
    'watchtower-of-sun-s-shadow': 2,
    'third-whisker-warrens': 1,
    'watchtower-of-valor': 1,
    'river-of-the-last-stand': 2, // +0 strength, so its text is all it has

    // Elsewhere in the field. Same band; none of these are lab-measured yet.
    'the-imperial-palace': 3, // +3 to every glory count is a favour lock
    'shintao-monastery': 3, // an extra card played in every conflict
    'kakita-dojo': 3, // a duel on demand
    'moto-stables': 2,
    'licensed-quarter': 2,
    'revered-bonsho': 2,
    'staging-ground': 2,
    'proving-ground': 2,
    'mountaintop-statuary': 2,
    'forgotten-library': 2,
    'shiotome-encampment': 1,
    // These two exist to be sacrificed; keeping them is worth almost nothing.
    'favorable-ground': 1,
    'imperial-storehouse': 1
});

/** Ability worth assumed for a holding with no curated entry. */
export const DEFAULT_HOLDING_ABILITY_VALUE = 2;

/**
 * What we lose by giving up this holding.
 *
 * Strength counts only while the province it sits behind is still unbroken.
 */
export function holdingValue(holding: HoldingInPlay | undefined): number {
    if(!holding) {
        return 0;
    }
    const strength = holding.provinceBroken
        ? 0
        : Math.max(0, Number(holding.strengthBonus) || 0) * PROVINCE_STRENGTH_SCORE;
    const ability = Object.prototype.hasOwnProperty.call(HOLDING_ABILITY_VALUE, holding.id)
        ? HOLDING_ABILITY_VALUE[holding.id]
        : DEFAULT_HOLDING_ABILITY_VALUE;
    return Math.round((strength + ability) * 10) / 10;
}

/**
 * The holding we would most willingly give up, and what it costs us.
 *
 * Every card that spends a holding lets us choose which one, so the price of the
 * effect is the CHEAPEST holding on the board — typically a low-strength one, or
 * anything sitting behind a province that has already been broken.
 */
export function cheapestHolding(ctx: CardValueContext): { holding: HoldingInPlay; cost: number } | null {
    const holdings = ctx.playHoldings || [];
    if(holdings.length === 0) {
        return null;
    }
    let best: { holding: HoldingInPlay; cost: number } | null = null;
    for(const holding of holdings) {
        const cost = holdingValue(holding);
        if(!best || cost < best.cost ||
            (cost === best.cost && String(holding.id) < String(best.holding.id))) {
            best = { holding, cost };
        }
    }
    return best;
}

/**
 * Kaiu Siege Force — "Action: Put a friendly holding on the bottom of your
 * dynasty deck – ready this character."
 *
 * A 7-military body that unbows is the whole point. Note what readying does NOT
 * do: `ready()` only unbows, it does not move the character into a conflict that
 * has already been declared. So this never rescues the conflict in front of it —
 * it buys the NEXT one, which is exactly what `stayReadyValue` measures, and why
 * the value is zero with no conflicts left in the phase.
 *
 * Priced as that stay-ready value less the cheapest holding we control, so it
 * fires off a spent wall and holds when the only holding left is load-bearing.
 *
 * This model is currently UNREACHED in live play, and the reason is worth
 * recording: an in-play character's ACTION has no generic path in the bot. The
 * triggered window only handles reactions and interrupts, and the board-Action
 * path at JigokuBotPolicy.ts:4689 is gated on `(shugenja || attachmentTower)` —
 * tactics modules Crab does not have. Both of Crab's permanently dead abilities
 * (this and Hiruma Signaller) are Actions; its Reactions do fire. Reviving them
 * needs that path opened to more decks, not a value model.
 */
export function kaiuSiegeForceValue(ctx: CardValueContext): CardValue {
    const self = ctx.myCharacters.find((card) => card.id === 'kaiu-siege-force');
    if(!self) {
        return blocked('not-in-play');
    }
    if(!self.bowed) {
        return blocked('already-ready');
    }
    const sacrifice = cheapestHolding(ctx);
    if(!sacrifice) {
        return blocked('no-friendly-holding');
    }
    const gain = stayReadyValue(self, ctx);
    if(gain <= 0) {
        return hold('nothing-left-to-ready-for');
    }
    if(gain <= sacrifice.cost) {
        return hold('ready-' + gain + '-below-holding-' + sacrifice.holding.id + '-' + sacrifice.cost);
    }
    return {
        selfSkill: 0,
        opponentSkill: 0,
        abilityValue: Math.round((gain - sacrifice.cost) * 10) / 10,
        reason: 'ready-for-' + sacrifice.holding.id +
            (sacrifice.holding.provinceBroken ? '(broken-province)' : '')
    };
}
