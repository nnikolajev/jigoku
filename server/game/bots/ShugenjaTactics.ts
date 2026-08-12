// Spell/ring-control playstyle for Phoenix "Shugenja Spells"
// (EmeraldDB b260d778-0016-4d70-b1f9-5180daf340fc).
//
// The deck is identified by Kyuden Isawa. It deliberately trades undefended
// provinces through Display of Power, recasts high-impact spells from the
// conflict discard, steers Water/Air/Void rings to its character payoffs, and
// uses ready/boost effects on its practical towers (large printed bodies rather
// than attachment stacks).

export interface ShugenjaProfile {
    ringCardBonus: number;
    togamaFateValue: number;
    immediateRingPayoffValue: number;
    displayRingMinimum: number;
    preConflictMinFate: number;
    towerIds: string[];
    shugenjaIds: string[];
    waterIds: string[];
    airIds: string[];
    voidIds: string[];
    disguiseTargets: Record<string, number>;
    spellPriority: string[];
    protectedDiscardIds: string[];
    // Spell events this deck can pay Kyuden Isawa's hand-discard cost with.
    // Card summaries carry no printed traits, so the Spell keyword has to be
    // named by id. A deck that runs different spells extends this list.
    kyudenSpellIds: string[];
    // Printed fate cost of each spell that is worth REPLAYING out of the
    // conflict discard. Membership is the gate: a spell absent from this map is
    // never chosen as Kyuden's replay target.
    kyudenActionCosts: Record<string, number>;

    // ---- ring plan (declaration ring choice) ----
    // The generic V1 ring score saturates on ring fate: `fate >= 1` is worth
    // +1000 and every per-card bonus is added AFTER it, so no value of
    // `ringCardBonus` can outrank a one-fate pile. This deck's rings are not
    // interchangeable. A WATER conflict is where free Feral Ningyo bodies, a
    // Covert lockout and Prodigy's re-ready turn into a BREAK; an AIR claim
    // pays Kudaka a fate AND a card. Against that, a ring's fate is only worth
    // what it buys — and it is taken at DECLARATION, so it is spendable now.
    //
    // With `ringPlanEnabled` the deck scores every ring in ONE currency,
    // fate-equivalents, instead of letting the fate tier decide. Disabled by
    // default: every field below is inert until an arm turns it on.
    ringPlanEnabled: boolean;
    /** Points per fate-equivalent, matching the generic fate tier's magnitude. */
    ringPlanFateScale: number;
    /** Generic-score points per fate-equivalent of ELEMENT value, for the
     *  planner's 0-50 ring-effect scale (the fate half is excluded there). */
    ringPlanEffectScale: number;
    /** Each Feral Ningyo in hand is a free +3/+2 body — in a WATER conflict only. */
    ringPlanNingyoValue: number;
    /** An Adept in play can lock their best body out of the water conflict.
     *  Worth a body only while their board is narrow enough for one lockout
     *  to decide it; on a wide board the fate is worth more. */
    ringPlanCovertValue: number;
    ringPlanCovertMaxOpponentBodies: number;
    /** Prodigy readies ITSELF while water is claimed: a second conflict body. */
    ringPlanProdigyValue: number;
    /** Kudaka: after claiming air, gain 1 fate AND draw 1 card (twice a round). */
    ringPlanKudakaAirValue: number;
    /** Asako Tsuki: after claiming water, honor a scholar. */
    ringPlanTsukiWaterValue: number;
    /** Isawa Ujina wants void, and only with a legal zero-fate enemy target. */
    ringPlanUjinaVoidValue: number;
    /** Hand cards whose cost this ring's fate may cross. Credited only when
     *  THIS ring's fate is what crosses it, so it ranks rings instead of
     *  handing every ring the same bonus. */
    ringPlanUnlockValues: Record<string, number>;

    // ---- ring-conditional planner resources ----
    // Scoring a ring higher only reorders a preference. It cannot tell the
    // conflict-phase rollout that a WATER declaration is the one that reaches a
    // BREAK — and that, not a standing preference, is the actual rule this deck
    // plays by. The rollout decides `broke` from
    // `attackers + handThreat - defense >= province strength`, and both of the
    // terms water changes are invisible to it: Feral Ningyo sits in hand (and
    // its printed cost is charged, though it enters FREE), and the Covert grant
    // is not on the card until a water conflict is already running.
    //
    // `ringPlanPlannerResources` publishes both as ring-keyed inputs so the
    // rollout computes the break itself. Off by default and independent of
    // `ringPlanEnabled`, so the score and the search can be measured apart.
    ringPlanPlannerResources: boolean;
    // Handing ring choice to the phase rollout (`applyRingPlan`) was measured
    // and leans negative: the rollout weighs a ring by its own effect scale, so
    // it stops chasing fate piles and drifts to void rather than to the ring
    // this deck can convert. Publishing the resources alone is ~87% inert for
    // the opposite reason — a fate-first ring choice almost never contests
    // water, so the better break math has nothing to apply to.
    //
    // `ringPlanBreakAware` is the rule the deck is actually played by: keep the
    // generic fate-first ordering, and let an element jump it only when ITS
    // resources turn this declaration into a BREAK that the same attack without
    // them does not reach.
    ringPlanBreakAware: boolean;
    /** Fate-equivalents for an element that converts a miss into a break. */
    ringPlanBreakValue: number;
    /** Conflict characters that enter play free while their ring is contested. */
    ringPlanFreeBodies: Record<string, { element: string; military: number; political: number }>;
    /** In-play sources of a Covert lockout, by the ring they need contested. */
    ringPlanCovertSources: Record<string, string>;
}

/** The live board a ring plan is scored against. */
export interface ShugenjaRingPlanContext {
    myCharacters: any[];
    opponentCharacters: any[];
    hand: any[];
    fate: number;
    /** Strength of the easiest province we may legally attack, for the break
     *  test. Omitted (or 0) turns the break test off. */
    targetStrength?: number;
    /** Live skill of a card on an axis, so the tactics never parse summaries. */
    skillOf?: (card: any, axis: 'military' | 'political') => number;
}

/** Fate-equivalents a ring is worth, split so the planner can drop the fate half. */
export interface ShugenjaRingPlanValue {
    /** The ring's own fate, plus what that fate unlocks from hand. */
    fate: number;
    /** What contesting this ELEMENT contributes, fate the ring carries aside. */
    element: number;
}

// Card summaries intentionally omit printed cost. These values keep Oracle,
// Kyuden's discard cost, Tadaka, and forced Ujina fallbacks deterministic and
// genuinely weakest-first instead of UUID-first.
const PRINTED_COSTS: Record<string, number> = {
    'adept-of-the-waves': 2,
    'against-the-waves': 1,
    'assassination': 0,
    'asako-togama': 4,
    'asako-tsuki': 2,
    'banzai': 0,
    'clarity-of-purpose': 1,
    'consumed-by-five-fires': 5,
    'display-of-power': 2,
    'earth-becomes-sky': 1,
    'ethereal-dreamer': 1,
    'feral-ningyo': 3,
    'fushicho': 6,
    'isawa-tadaka-2': 5,
    'isawa-ujina': 4,
    'kirei-ko': 1,
    'kudaka': 4,
    'meddling-mediator': 2,
    'oracle-of-stone': 0,
    'pacifism': 2,
    'prodigy-of-the-waves': 4,
    'shiba-tetsu': 2,
    'shiba-tsukune': 5,
    'shiba-yojimbo': 3,
    'shrine-maiden': 1,
    'stolen-breath': 2,
    'supernatural-storm': 0,
    'the-path-of-man': 0,
    'young-philosopher': 2
};

export const SHUGENJA_DEFAULTS: ShugenjaProfile = {
    ringCardBonus: 18,
    // Ring-claim abilities need different economics from ordinary conflict
    // declaration. Offerings handles fate as a strict primary key, so a live
    // card payoff never beats one additional fate. Togama uses a large fate
    // weight and live payoffs to break close ties.
    togamaFateValue: 1000,
    immediateRingPayoffValue: 100,
    // Display costs two fate and an undefended province. Spend it proactively
    // only for a live character/ring-effect payoff; hopeless defenses may still
    // use it as a fallback, decided by JigokuBotPolicy.
    displayRingMinimum: 100,
    preConflictMinFate: 2,
    towerIds: ['isawa-tadaka-2', 'fushicho', 'shiba-tsukune', 'kudaka'],
    shugenjaIds: [
        'adept-of-the-waves', 'asako-tsuki', 'ethereal-dreamer', 'isawa-tadaka-2',
        'isawa-ujina', 'kudaka', 'prodigy-of-the-waves', 'young-philosopher'
    ],
    waterIds: ['adept-of-the-waves', 'asako-tsuki', 'ethereal-dreamer', 'feral-ningyo', 'prodigy-of-the-waves'],
    airIds: ['kudaka'],
    voidIds: ['isawa-ujina'],
    // Printed cost of legal non-unique Shugenja disguise bases. The engine
    // performs the real trait/unique legality check; this ranking chooses the
    // best reduction and preserves fate/attachments on a bowed participant.
    disguiseTargets: {
        'prodigy-of-the-waves': 4,
        'adept-of-the-waves': 2,
        'young-philosopher': 2,
        'ethereal-dreamer': 1
    },
    spellPriority: [
        'display-of-power', 'consumed-by-five-fires', 'earth-becomes-sky',
        'clarity-of-purpose', 'against-the-waves', 'the-path-of-man',
        'supernatural-storm', 'oracle-of-stone', 'assassination', 'banzai'
    ],
    // Kyuden Isawa must discard a spell from hand as its cost. Keep the two
    // build-arounds and the fate payoff when a lower-value spell is available.
    protectedDiscardIds: ['display-of-power', 'consumed-by-five-fires', 'the-path-of-man', 'isawa-tadaka-2'],
    kyudenSpellIds: [
        'against-the-waves', 'clarity-of-purpose', 'consumed-by-five-fires',
        'display-of-power', 'earth-becomes-sky', 'oracle-of-stone', 'supernatural-storm'
    ],
    kyudenActionCosts: {
        'against-the-waves': 1,
        'clarity-of-purpose': 1,
        'consumed-by-five-fires': 5,
        'oracle-of-stone': 0,
        'supernatural-storm': 0
    },
    // Off by default: `ringPlanValue` returns null and the generic V1 ring
    // score is used unchanged. An arm turns this on with one flag.
    ringPlanEnabled: false,
    ringPlanFateScale: 1000,
    ringPlanEffectScale: 10,
    // A free 3/2 body is worth a little under the two fate a bought body costs.
    ringPlanNingyoValue: 1.5,
    ringPlanCovertValue: 2,
    ringPlanCovertMaxOpponentBodies: 3,
    ringPlanProdigyValue: 1,
    // Literally one fate plus one card.
    ringPlanKudakaAirValue: 1.5,
    ringPlanTsukiWaterValue: 0.5,
    ringPlanUjinaVoidValue: 1,
    // Both locks cost 2 and are played in a pre-conflict window, so ring fate
    // taken now pays for them later this phase. Tadaka's cost is his disguise
    // discount, resolved against the prepared base actually on the board, and
    // Five Fires is only worth reaching while a fat enemy board is there to
    // strip — both are priced against the live board in `unlockCost`.
    ringPlanUnlockValues: {
        'pacifism': 1,
        'stolen-breath': 1,
        'isawa-tadaka-2': 2,
        'consumed-by-five-fires': 2.5
    },
    ringPlanPlannerResources: false,
    ringPlanBreakAware: false,
    ringPlanBreakValue: 4,
    ringPlanFreeBodies: {
        'feral-ningyo': { element: 'water', military: 3, political: 2 }
    },
    ringPlanCovertSources: {
        'adept-of-the-waves': 'water'
    }
};

export class ShugenjaTactics {
    private profile: ShugenjaProfile;

    constructor(profile: ShugenjaProfile) {
        this.profile = profile;
    }

    ringBonus(element: string, myCharacters: any[], hand: any[]): number {
        const wanted = element === 'water' ? this.profile.waterIds
            : element === 'air' ? this.profile.airIds
                : element === 'void' ? this.profile.voidIds
                    : [];
        const inPlay = (myCharacters || []).filter((card) => card.id && wanted.includes(card.id)).length;
        // Feral Ningyo is specifically a hand payoff for Water; counting all
        // wanted ids in hand also lets a soon-to-be-played payoff steer the ring.
        const inHand = (hand || []).filter((card) => card.id && wanted.includes(card.id)).length;
        return (inPlay + inHand) * this.profile.ringCardBonus;
    }

    /**
     * Fate-equivalent worth of contesting `ring`, or null while the plan is off.
     *
     * Two currencies, one scale. The ELEMENT half is what this deck can put on
     * the table in a conflict on that ring; the FATE half is the pile the
     * attacker takes at declaration plus whatever crossing that fate total
     * unlocks from hand. Callers add the generic element base as a sub-fate
     * tie-break, so equal plans still resolve deterministically.
     */
    ringPlanValue(ring: any, context: ShugenjaRingPlanContext): ShugenjaRingPlanValue | null {
        if(!this.profile.ringPlanEnabled) {
            return null;
        }
        const element = String(ring?.element || '');
        const ringFate = Math.max(0, Number(ring?.fate) || 0);
        return {
            fate: ringFate + this.unlockValue(ringFate, context),
            element: this.elementValue(element, context)
        };
    }

    /**
     * Extra own skill that exists ONLY while each element is contested, keyed
     * by element. These bodies cost no fate, so unlike the generic hand threat
     * every copy in hand counts.
     */
    ringConditionalHandSkill(hand: any[]): Record<string, { military: number; political: number }> {
        const byElement: Record<string, { military: number; political: number }> = {};
        if(!this.profile.ringPlanPlannerResources) {
            return byElement;
        }
        for(const card of hand || []) {
            const body = card?.id ? this.profile.ringPlanFreeBodies[card.id] : undefined;
            if(!body) {
                continue;
            }
            const bucket = byElement[body.element] || { military: 0, political: 0 };
            bucket.military += body.military;
            bucket.political += body.political;
            byElement[body.element] = bucket;
        }
        return byElement;
    }

    /** Ids whose hand skill is ring-conditional, so the ring-blind generic hand
     *  threat must not also count them. */
    ringConditionalHandIds(): string[] {
        return this.profile.ringPlanPlannerResources
            ? Object.keys(this.profile.ringPlanFreeBodies)
            : [];
    }

    /** Enemy bodies we can lock out of a conflict, keyed by required element.
     *  Gated, because this is the PUBLICATION to the planner; the break test
     *  reads `covertSources` directly so the two flags stay independent. */
    ringConditionalCovert(myCharacters: any[]): Record<string, number> {
        return this.profile.ringPlanPlannerResources ? this.covertSources(myCharacters) : {};
    }

    private covertSources(myCharacters: any[]): Record<string, number> {
        const byElement: Record<string, number> = {};
        for(const card of myCharacters || []) {
            const element = card?.id ? this.profile.ringPlanCovertSources[card.id] : undefined;
            if(element) {
                byElement[element] = (byElement[element] || 0) + 1;
            }
        }
        return byElement;
    }

    /** Ring plan on the generic ring-score scale, or null while the plan is off. */
    ringPlanScore(ring: any, context: ShugenjaRingPlanContext): number | null {
        const value = this.ringPlanValue(ring, context);
        return value === null
            ? null
            : Math.round((value.fate + value.element) * this.profile.ringPlanFateScale);
    }

    /**
     * The ELEMENT half only, on the planner's 0-50 ring-effect scale. That
     * consumer prices a ring's fate separately, so handing it the fate half
     * would count the same pile twice.
     */
    ringPlanEffectScore(ring: any, context: ShugenjaRingPlanContext): number | null {
        const value = this.ringPlanValue(ring, context);
        return value === null
            ? null
            : Math.round(value.element * this.profile.ringPlanEffectScale);
    }

    /**
     * Does contesting `element` turn this declaration into a break that the
     * same attack without its resources would miss?
     *
     * This is the deck's real rule, and it is a THRESHOLD, not a preference:
     * count the free bodies the element switches on, subtract the defenders a
     * Covert grant locks out, and check the margin against the province. An
     * element that reaches a break the generic attack already reaches is worth
     * nothing extra — the fate is worth more.
     */
    private convertsToBreak(element: string, context: ShugenjaRingPlanContext): boolean {
        const strength = Number(context.targetStrength) || 0;
        const skillOf = context.skillOf;
        if(!this.profile.ringPlanBreakAware || strength <= 0 || typeof skillOf !== 'function') {
            return false;
        }
        const freeSkill = this.ringConditionalHandSkillForElement(element, context.hand || []);
        const covert = this.covertSources(context.myCharacters || [])[element] || 0;
        if(freeSkill.military === 0 && freeSkill.political === 0 && covert === 0) {
            return false;
        }
        const ready = (cards: any[]) => (cards || []).filter((card) =>
            card?.type === 'character' && !card.bowed);
        const mine = ready(context.myCharacters || []);
        const theirs = ready(context.opponentCharacters || []);

        for(const axis of ['military', 'political'] as const) {
            const attack = mine.reduce((sum, card) => sum + Math.max(0, skillOf(card, axis)), 0);
            const defenceSkills = theirs
                .map((card) => Math.max(0, skillOf(card, axis)))
                .sort((left, right) => right - left);
            const defence = defenceSkills.reduce((sum, value) => sum + value, 0);
            // A grant rides on an attacking body, so it can lock out at most as
            // many defenders as we have attackers.
            const locked = defenceSkills
                .slice(0, Math.min(covert, mine.length))
                .reduce((sum, value) => sum + value, 0);
            const withElement = (attack + freeSkill[axis]) - (defence - locked);
            const without = attack - defence;
            if(withElement >= strength && without < strength) {
                return true;
            }
        }
        return false;
    }

    private ringConditionalHandSkillForElement(element: string, hand: any[]): { military: number; political: number } {
        const total = { military: 0, political: 0 };
        for(const card of hand || []) {
            const body = card?.id ? this.profile.ringPlanFreeBodies[card.id] : undefined;
            if(body && body.element === element) {
                total.military += body.military;
                total.political += body.political;
            }
        }
        return total;
    }

    private elementValue(element: string, context: ShugenjaRingPlanContext): number {
        // Two independent halves. The CONVERSION half is the skill an element
        // adds to this conflict, which is what the break test replaces when it
        // is on. The ECONOMY half is what claiming the ring pays regardless of
        // whether the province falls — Kudaka's fate and card do not care. An
        // earlier revision returned the break bonus alone and silently scored
        // air at zero with Kudaka on the board.
        return this.conversionValue(element, context) + this.economyValue(element, context);
    }

    /** Skill this element contributes to the conflict being declared. */
    private conversionValue(element: string, context: ShugenjaRingPlanContext): number {
        if(this.profile.ringPlanBreakAware) {
            return this.convertsToBreak(element, context) ? this.profile.ringPlanBreakValue : 0;
        }
        if(element !== 'water') {
            return 0;
        }
        // Feral Ningyo puts itself into play into the conflict from hand at no
        // fate cost, but only while water is the contested element.
        const ningyo = (context.hand || []).filter((card) => card?.id === 'feral-ningyo').length;
        const readyOpponents = (context.opponentCharacters || []).filter((card) =>
            card?.type === 'character' && !card.bowed).length;
        const covert = (context.myCharacters || []).some((card) => card?.id === 'adept-of-the-waves') &&
            readyOpponents > 0 &&
            readyOpponents <= this.profile.ringPlanCovertMaxOpponentBodies;
        return ningyo * this.profile.ringPlanNingyoValue +
            (covert ? this.profile.ringPlanCovertValue : 0);
    }

    /** What CLAIMING this ring pays, win or lose the province. */
    private economyValue(element: string, context: ShugenjaRingPlanContext): number {
        const mine = context.myCharacters || [];
        const theirs = context.opponentCharacters || [];
        const inPlay = (id: string) => mine.some((card) => card?.id === id);

        if(element === 'water') {
            // Prodigy readies ITSELF once water is claimed, which is a body for
            // the next conflict rather than skill in this one.
            return (inPlay('prodigy-of-the-waves') ? this.profile.ringPlanProdigyValue : 0) +
                (inPlay('asako-tsuki') ? this.profile.ringPlanTsukiWaterValue : 0);
        }
        if(element === 'air') {
            // Kudaka: gain 1 fate AND draw 1 card per air claim, twice a round.
            return inPlay('kudaka') ? this.profile.ringPlanKudakaAirValue : 0;
        }
        if(element === 'void') {
            // Ujina removes a character with no fate on it, so his payoff needs
            // a legal enemy target to exist at all.
            const target = theirs.some((card) =>
                card?.type === 'character' && (Number(card.fate) || 0) === 0);
            return inPlay('isawa-ujina') && target ? this.profile.ringPlanUjinaVoidValue : 0;
        }
        return 0;
    }

    /**
     * What this ring's fate unlocks that we cannot already afford. Credited
     * only across the threshold: a ring whose fate changes nothing scores the
     * fate alone, so piles are still compared by size.
     */
    private unlockValue(ringFate: number, context: ShugenjaRingPlanContext): number {
        if(ringFate <= 0) {
            return 0;
        }
        const before = Math.max(0, Number(context.fate) || 0);
        const after = before + ringFate;
        const hand = context.hand || [];
        let total = 0;
        for(const [cardId, value] of Object.entries(this.profile.ringPlanUnlockValues)) {
            if(!hand.some((card) => card?.id === cardId)) {
                continue;
            }
            const cost = this.unlockCost(cardId, context);
            if(cost === null || cost <= before || cost > after) {
                continue;
            }
            total += Number(value) || 0;
        }
        return total;
    }

    /** Live cost to PLAY a hand card, or null when it has no legal play yet. */
    private unlockCost(cardId: string, context: ShugenjaRingPlanContext): number | null {
        if(cardId === 'consumed-by-five-fires') {
            // Reaching five fate is only worth steering a ring for while the
            // same gate the deck plays Fires under is already satisfied: our
            // own Shugenja on the board, and five actionable fate to strip.
            const live = (context.myCharacters || []).some((card) => this.isShugenja(card)) &&
                this.fiveFiresTargetFate(context.opponentCharacters || []) >= 5;
            return live ? this.printedCostOf({ id: cardId }) : null;
        }
        if(cardId !== 'isawa-tadaka-2') {
            return this.printedCostOf({ id: cardId });
        }
        // Disguised pays five minus the base's printed cost, so Tadaka is only
        // unlockable while a legal prepared base is actually on the board.
        const bases = (context.myCharacters || []).filter((card) =>
            card?.id && this.profile.disguiseTargets[card.id] !== undefined &&
            (Number(card.fate) || 0) >= 2);
        if(bases.length === 0) {
            return null;
        }
        return Math.min(...bases.map((card) =>
            Math.max(5 - this.profile.disguiseTargets[card.id], 0)));
    }

    offeringsRingPriority(rings: any[], myCharacters: any[], opponentCharacters: any[]): any[] {
        // Generate this list from the live board every time Offerings reveals.
        // Fate is deliberately absent: caller first compares fate, then uses
        // this board-aware order only among rings tied for the largest pile.
        return (rings || []).slice().sort((a, b) =>
            this.immediateRingScore(String(b?.element || ''), myCharacters, opponentCharacters) -
            this.immediateRingScore(String(a?.element || ''), myCharacters, opponentCharacters));
    }

    togamaRingScore(ring: any, myCharacters: any[], opponentCharacters: any[]): number {
        return (Number(ring?.fate) || 0) * this.profile.togamaFateValue +
            this.immediateRingScore(String(ring?.element || ''), myCharacters, opponentCharacters);
    }

    shouldUseDisplayForRing(element: string, myCharacters: any[], opponentCharacters: any[]): boolean {
        return this.immediateRingScore(element, myCharacters, opponentCharacters) >=
            this.profile.displayRingMinimum;
    }

    private immediateRingScore(element: string, myCharacters: any[], opponentCharacters: any[]): number {
        const wanted = element === 'water' ? this.profile.waterIds
            : element === 'air' ? this.profile.airIds
                : element === 'void' ? this.profile.voidIds
                    : [];
        // Offerings resolves immediately, so only live characters matter. One
        // matching payoff outweighs the generic ring order. Water also needs a
        // legal useful board target: a bowed own character to ready or a ready
        // zero-fate enemy to bow. Thus lone ready Kudaka chooses Air, while a
        // live Water payoff or usable second character can move Water ahead.
        const ujinaHasEnemyTarget = (opponentCharacters || []).some((card) =>
            card.type === 'character' && (Number(card.fate) || 0) === 0);
        const livePayoffs = (myCharacters || []).filter((card) =>
            card.id && wanted.includes(card.id) &&
            (card.id !== 'isawa-ujina' || ujinaHasEnemyTarget)).length;
        const enemyHasFate = (opponentCharacters || []).some((card) => (Number(card.fate) || 0) > 0);
        const usableWaterTarget = (myCharacters || []).some((card) => card.bowed) ||
            (opponentCharacters || []).some((card) => !card.bowed && (Number(card.fate) || 0) === 0);
        const waterRelevant = element === 'water' && (livePayoffs > 0 || usableWaterTarget);
        const fallback = enemyHasFate
            ? { water: waterRelevant ? 50 : 0, void: 40, earth: 30, air: 20, fire: 10 }
            : { water: waterRelevant ? 50 : 0, earth: 40, air: 30, fire: 20, void: 10 };
        const waterEffectValue = element === 'water' && usableWaterTarget
            ? this.profile.immediateRingPayoffValue
            : 0;
        return livePayoffs * this.profile.immediateRingPayoffValue +
            waterEffectValue + (fallback[element] ?? 0);
    }

    isShugenja(card: any): boolean {
        return !!card?.id && this.profile.shugenjaIds.includes(card.id);
    }

    isPracticalTower(card: any): boolean {
        return !!card?.id && this.profile.towerIds.includes(card.id);
    }

    pickTower(cards: any[], skillOf: (card: any) => number): any {
        if(!cards || cards.length === 0) {
            return null;
        }
        return cards.slice().sort((a, b) => {
            const towerDiff = (this.isPracticalTower(b) ? 1 : 0) - (this.isPracticalTower(a) ? 1 : 0);
            if(towerDiff !== 0) {
                return towerDiff;
            }
            const participantDiff = (b.inConflict ? 1 : 0) - (a.inConflict ? 1 : 0);
            if(participantDiff !== 0) {
                return participantDiff;
            }
            const fateDiff = (Number(b.fate) || 0) - (Number(a.fate) || 0);
            if(fateDiff !== 0) {
                return fateDiff;
            }
            const skillDiff = skillOf(b) - skillOf(a);
            return skillDiff !== 0 ? skillDiff : String(a.uuid || '').localeCompare(String(b.uuid || ''));
        })[0];
    }

    pickDisguiseTarget(cards: any[], availableFate = Number.POSITIVE_INFINITY): any {
        const candidates = (cards || []).filter((card) =>
            card.id && this.profile.disguiseTargets[card.id] !== undefined &&
            availableFate >= Math.max(5 - this.profile.disguiseTargets[card.id], 0));
        if(candidates.length === 0) {
            return null;
        }
        return candidates.slice().sort((a, b) => {
            // Fate, attachments, and tokens all move to Tadaka. Preserve the
            // biggest long-term investment first; immediate ready value from a
            // bowed/participating base is only a tie-breaker. Prefer the cheaper
            // body when two bases carry the same investment.
            const fateDiff = (Number(b.fate) || 0) - (Number(a.fate) || 0);
            if(fateDiff !== 0) {
                return fateDiff;
            }
            const attachmentDiff = (b.attachments?.length || 0) - (a.attachments?.length || 0);
            if(attachmentDiff !== 0) {
                return attachmentDiff;
            }
            const tokenCount = (card: any) => Array.isArray(card.statusTokens)
                ? card.statusTokens.length
                : Object.values(card.tokens || {}).reduce((sum: number, amount: any) => sum + (Number(amount) || 0), 0);
            const tokenDiff = tokenCount(b) - tokenCount(a);
            if(tokenDiff !== 0) {
                return tokenDiff;
            }
            const costDiff = this.profile.disguiseTargets[a.id] - this.profile.disguiseTargets[b.id];
            if(costDiff !== 0) {
                return costDiff;
            }
            const bowedDiff = (b.bowed ? 1 : 0) - (a.bowed ? 1 : 0);
            if(bowedDiff !== 0) {
                return bowedDiff;
            }
            const participantDiff = (b.inConflict ? 1 : 0) - (a.inConflict ? 1 : 0);
            if(participantDiff !== 0) {
                return participantDiff;
            }
            return String(a.uuid || '').localeCompare(String(b.uuid || ''));
        })[0];
    }

    pickTadakaPlay(hand: any[], myCharacters: any[], availableFate: number): any {
        const tadaka = (hand || []).find((card) =>
            card.id === 'isawa-tadaka-2' && card.uuid && card.isPlayableByMe);
        if(!tadaka || (myCharacters || []).some((card) => card.id === 'isawa-tadaka-2')) {
            return null;
        }
        const affordableBases = (myCharacters || []).filter((card) =>
            card.id && this.profile.disguiseTargets[card.id] !== undefined &&
            availableFate >= Math.max(5 - this.profile.disguiseTargets[card.id], 0));
        const base = this.pickDisguiseTarget(affordableBases, availableFate);
        // Proactively turn a prepared two-fate body into the durable Tadaka
        // tower. Ordinary conflict evaluation may still play him without this
        // setup when his printed skill is needed immediately.
        return base && (Number(base.fate) || 0) >= 2 ? tadaka : null;
    }

    pickTadakaSetupCharacter(cards: any[], hand: any[], dynastyCosts: Record<string, number>, availableFate: number): any {
        if(!(hand || []).some((card) => card.id === 'isawa-tadaka-2')) {
            return null;
        }
        const candidates = (cards || []).filter((card) => {
            if(!card.id || this.profile.disguiseTargets[card.id] === undefined) {
                return false;
            }
            const cost = dynastyCosts?.[card.uuid] ?? this.profile.disguiseTargets[card.id];
            const tadakaCost = Math.max(5 - this.profile.disguiseTargets[card.id], 0);
            return availableFate >= cost + 2 + tadakaCost;
        });
        return candidates.slice().sort((a, b) =>
            (dynastyCosts?.[a.uuid] ?? this.profile.disguiseTargets[a.id]) -
            (dynastyCosts?.[b.uuid] ?? this.profile.disguiseTargets[b.id]) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    pickFushichoTarget(cards: any[]): any {
        const fiveCostCharacters = (cards || []).filter((card) =>
            card.type === 'character' && this.printedCostOf(card) === 5);
        if(fiveCostCharacters.length === 0) {
            return null;
        }
        return fiveCostCharacters.slice().sort((a, b) =>
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0];
    }

    shouldPlayFushicho(dynastyDiscard: any[]): boolean {
        return !!this.pickFushichoTarget(dynastyDiscard);
    }

    isFiveFiresNeutralized(card: any): boolean {
        return (card?.attachments || []).some((attachment: any) =>
            attachment.id === 'pacifism' || attachment.id === 'stolen-breath');
    }

    fiveFiresTargets(cards: any[]): any[] {
        return (cards || []).filter((card) =>
            card.type === 'character' && (Number(card.fate) || 0) > 0 && !this.isFiveFiresNeutralized(card));
    }

    fiveFiresTargetFate(cards: any[]): number {
        return this.fiveFiresTargets(cards)
            .reduce((total, card) => total + (Number(card.fate) || 0), 0);
    }

    pickFiveFiresTarget(cards: any[], skillOf: (card: any) => number = () => 0): any {
        return this.fiveFiresTargets(cards).slice().sort((a, b) =>
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            skillOf(b) - skillOf(a) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    pickFiveFiresPlay(hand: any[], myCharacters: any[], opponentCharacters: any[], availableFate: number): any {
        if(availableFate < 5 ||
            !(myCharacters || []).some((card) => this.isShugenja(card)) ||
            this.fiveFiresTargetFate(opponentCharacters) < 5) {
            return null;
        }
        return (hand || []).find((card) =>
            card.id === 'consumed-by-five-fires' && card.uuid && card.isPlayableByMe) || null;
    }

    pickWeakest(cards: any[]): any {
        if(!cards || cards.length === 0) {
            return null;
        }
        return cards.slice().sort((a, b) => {
            const costDiff = this.printedCostOf(a) - this.printedCostOf(b);
            if(costDiff !== 0) {
                return costDiff;
            }
            const fateDiff = (Number(a.fate) || 0) - (Number(b.fate) || 0);
            return fateDiff !== 0 ? fateDiff : String(a.uuid || '').localeCompare(String(b.uuid || ''));
        })[0];
    }

    private printedCostOf(card: any): number {
        return card?.cost === undefined || card?.cost === null
            ? (PRINTED_COSTS[card?.id] ?? 0)
            : (Number(card.cost) || 0);
    }

    pickSpell(cards: any[]): any {
        if(!cards || cards.length === 0) {
            return null;
        }
        const rank = (card: any) => {
            const index = this.profile.spellPriority.indexOf(card.id);
            return index < 0 ? this.profile.spellPriority.length : index;
        };
        return cards.slice().sort((a, b) => rank(a) - rank(b) ||
            (Number(b.cost) || 0) - (Number(a.cost) || 0) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0];
    }

    pickKyudenSpell(cards: any[], playCtx: any): any {
        const fate = Number(playCtx?.fate) || 0;
        const sharedPlayIntent = playCtx?.canPlayConflictCard;
        return this.pickSpell((cards || []).filter((card) => {
            if(!card || card.type !== 'event' || this.profile.kyudenActionCosts[card.id] === undefined) {
                return false;
            }
            const hintedCost = card.uuid && playCtx?.conflictCosts &&
                Object.prototype.hasOwnProperty.call(playCtx.conflictCosts, card.uuid)
                ? Number(playCtx.conflictCosts[card.uuid])
                : this.profile.kyudenActionCosts[card.id];
            return fate >= hintedCost &&
                (typeof sharedPlayIntent !== 'function' || sharedPlayIntent(card));
        }));
    }

    pickKyudenDiscard(cards: any[]): any {
        const unprotected = (cards || []).filter((card) => !this.profile.protectedDiscardIds.includes(card.id));
        return this.pickWeakest(unprotected.length > 0 ? unprotected : cards);
    }

    hasDisplayPlan(me: any): boolean {
        const fate = Number(me?.stats?.fate) || 0;
        if(fate < 2) {
            return false;
        }
        const hand = me?.cardPiles?.hand || [];
        // Display is a Reaction. Kyuden is an Action, so the rules engine
        // cannot use Kyuden to recast Display during the after-conflict window.
        return hand.some((card: any) => card.id === 'display-of-power');
    }

    hasStrategicAction(me: any, opponent: any, conflictType?: string, canPlayConflictCard?: (card: any) => boolean, conflictCosts?: Record<string, number>): boolean {
        const fate = Number(me?.stats?.fate) || 0;
        const hand = me?.cardPiles?.hand || [];
        const conflictDiscard = me?.cardPiles?.conflictDiscardPile || [];
        const mine = me?.cardPiles?.cardsInPlay || [];
        const theirs = opponent?.cardPiles?.cardsInPlay || [];
        const readyParticipant = mine.some((card: any) => card.inConflict && !card.bowed);
        // Keep an already-won window open when the shared hand/replay intent
        // says Clarity has value. That gate owns political resolution, visible
        // bow sources, seed-3 hand knowledge, and per-target deduplication.
        const clarity = hand.find((card: any) =>
            card.id === 'clarity-of-purpose' && card.isPlayableByMe !== false);
        if(readyParticipant && clarity && (
            typeof canPlayConflictCard === 'function'
                ? canPlayConflictCard(clarity)
                : conflictType === 'political')) {
            return true;
        }
        if(this.pickFiveFiresPlay(hand, mine, theirs, fate)) {
            return true;
        }
        const readyKyuden = (me?.strongholdProvince || []).some((card: any) => card.id === 'kyuden-isawa' && !card.bowed);
        if(readyKyuden && this.shouldUseKyuden({
            hand,
            conflictDiscard,
            fate,
            conflictType,
            myCharacters: mine,
            opponentCharacters: theirs,
            conflictCosts,
            canPlayConflictCard
        })) {
            return true;
        }
        return (me?.cardPiles?.cardsInPlay || []).some((card: any) =>
            card.id === 'meddling-mediator' ||
            (card.id === 'asako-togama' && card.inConflict));
    }

    shouldUseKyuden(playCtx: any): boolean {
        const hand = playCtx?.hand || [];
        const discard = playCtx?.conflictDiscard || [];
        // Public bot state deliberately omits printed traits/costs, so identify
        // this deck's Spell events by stable card id.
        if(!hand.some((card: any) => card.type === 'event' && this.profile.kyudenSpellIds.includes(card.id))) {
            return false;
        }
        return !!this.pickKyudenSpell(discard, playCtx);
    }

    canPlayPreConflict(myFate: number): boolean {
        return myFate >= this.profile.preConflictMinFate;
    }

    desiredFateReserve(me: any, opponent: any): number {
        const mine = me?.cardPiles?.cardsInPlay || [];
        const hand = me?.cardPiles?.hand || [];

        // Once a two-fate disguise base is prepared, preserve Tadaka's
        // five-minus-base-cost payment instead of spending it on another
        // dynasty character before the conflict phase.
        const preparedBase = !mine.some((card: any) => card.id === 'isawa-tadaka-2') &&
            hand.some((card: any) => card.id === 'isawa-tadaka-2')
            ? this.pickDisguiseTarget(
                mine.filter((card: any) => (Number(card.fate) || 0) >= 2)
            )
            : null;
        const tadakaReserve = preparedBase
            ? Math.max(5 - this.profile.disguiseTargets[preparedBase.id], 1)
            : 1;

        const hasTarget = this.fiveFiresTargetFate(opponent?.cardPiles?.cardsInPlay || []) >= 5;
        if(!hasTarget || !mine.some((card: any) => this.isShugenja(card))) {
            return tadakaReserve;
        }
        if(hand.some((card: any) => card.id === 'consumed-by-five-fires')) {
            return Math.max(tadakaReserve, 5);
        }
        const discardHasFires = (me?.cardPiles?.conflictDiscardPile || [])
            .some((card: any) => card.id === 'consumed-by-five-fires');
        const readyKyuden = (me?.strongholdProvince || [])
            .some((card: any) => card.id === 'kyuden-isawa' && !card.bowed);
        const hasSpellCost = hand.some((card: any) => card.type === 'event' && this.profile.kyudenSpellIds.includes(card.id));
        const fiveFiresReserve = discardHasFires && readyKyuden && hasSpellCost ? 5 : 1;
        return Math.max(tadakaReserve, fiveFiresReserve);
    }

    desiredAdditionalFate(cardId: string | undefined, hand: any[], availableFate: number, playCost?: number): number | null {
        if(!cardId || this.profile.disguiseTargets[cardId] === undefined ||
            !(hand || []).some((card) => card.id === 'isawa-tadaka-2')) {
            return null;
        }
        // Keep the five-minus-base-cost needed to disguise Tadaka later. When
        // rich, bank three fate on the base; otherwise two, never below zero.
        const tadakaCost = Math.max(5 - this.profile.disguiseTargets[cardId], 1);
        const remainingAfterBase = availableFate - (playCost || 0) - tadakaCost;
        return remainingAfterBase >= 3 ? 3 : remainingAfterBase >= 2 ? 2 : Math.max(remainingAfterBase, 0);
    }
}
