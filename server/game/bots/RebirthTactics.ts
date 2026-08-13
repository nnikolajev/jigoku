// Fushicho recursion playstyle for Phoenix "Phoenix"
// (EmeraldDB 7b7f54b8-2037-4f98-951f-a651a82f66a5).
//
// The deck buys big Phoenix bodies at ZERO additional fate on purpose. A
// zero-fate character is discarded in the fate phase, which is not a loss here
// but the engine's fuel: Fushicho's leaves-play interrupt puts a Phoenix
// character back from the dynasty discard with 1 fate, Forebearer's Echoes
// rents one into a military conflict, and My Ancestor's Strength copies a
// discarded body's printed skills onto a live Shugenja. So the discard pile is
// a resource, and the plan is to cycle through it rather than to build a tower.
//
// Everything the policy needs to decide is a knob on `RebirthProfile` so an A/B
// arm is a JSON string and never an edit (see docs/deck-profiles.md).
//
// Two legality facts the card text hides, both enforced here because getting
// them wrong wastes a whole click:
//   * Fushicho's interrupt is `card.isFaction('phoenix')` over the DYNASTY
//     DISCARD. Kudaka and Miya Mystic are faction `neutral` and are NOT legal
//     targets even though they are Phoenix-deck Shugenja.
//   * Benten's Touch bows a PHOENIX Shugenja as its cost, so it likewise
//     cannot bow Kudaka or Miya Mystic, and cannot bow Fushicho (not Shugenja).

export interface PrintedSkills {
    // `null` is a printed DASH, which is not the same as zero: a dash character
    // cannot participate on that axis at all, and an effect that COPIES a dash
    // onto a participant removes it from the conflict.
    military: number | null;
    political: number | null;
}

export interface RebirthProfile {
    // ---- Fushicho engine ----
    fushichoId: string;
    // Additional fate to put on Fushicho when buying it. Zero is the plan: it
    // dies in the fate phase and its interrupt pays for the whole turn.
    fushichoAdditionalFate: number;
    // Do not buy Fushicho before this round under any circumstances.
    fushichoMinRound: number;
    // Legal resurrection targets that must already sit in the dynasty discard
    // before Fushicho is worth its printed 6. Round one normally fails this;
    // A Season of War fills the discard and legitimately passes it early.
    fushichoMinRecursionTargets: number;

    // ---- recursion ranking ----
    // Bonus by printed id, layered on top of the skill/glory/cost terms below.
    // Fushicho ranks itself highest: chaining a second copy repeats the engine.
    recursionValueById: Record<string, number>;
    recursionSkillWeight: number;
    recursionGloryWeight: number;
    recursionCostWeight: number;
    // Faction filter for Fushicho's interrupt. Empty disables the check and
    // lets the engine's own legality filter decide.
    phoenixCharacterIds: string[];
    // Unique ids that cannot re-enter play while a copy is already out.
    uniqueCharacterIds: string[];

    // ---- zero-fate rotation ----
    // Additional fate for every dynasty character not named below.
    zeroFateAdditionalFate: number;
    // The few bodies worth surviving a fate phase, and what to pay for them.
    persistentCharacterIds: string[];
    persistentAdditionalFate: number;

    // ---- ring steering ----
    // Per matching payoff in play (or in hand for `ringHandPayoffsByElement`).
    ringCardBonus: number;
    // element -> ids whose ability pays off when we CLAIM that ring.
    ringPayoffsByElement: Record<string, string[]>;
    // element -> ids in HAND that pay off while that element is CONTESTED
    // (Feral Ningyo enters play free during a water conflict).
    ringHandPayoffsByElement: Record<string, string[]>;
    // Ids whose ability requires a ring to stay UNCLAIMED (Isawa Tsuke needs
    // fire in the unclaimed pool), and how hard to steer away from claiming it.
    unclaimedGuardsByElement: Record<string, string[]>;
    unclaimedGuardPenalty: number;

    // ---- Ancestral Shrine (return claimed rings for honor) ----
    // Return rings once own honor drops to this, or whenever a guarded ring
    // (fire, for Tsuke) sits in the claimed pool and can be freed.
    shrineHonorFloor: number;
    // Never return a ring a live payoff wants to stay claimed (earth while
    // Solemn Scholar is in play).
    shrineProtectClaimedPayoffs: boolean;

    // ---- Isawa Tsuke fate strip ----
    tsukeHonorFloor: number; // never spend own honor below this
    tsukeMaxHonorSpend: number; // hard cap per activation
    tsukeMinTargetValue: number; // only strip bodies worth this much

    // ---- Isawa Heiko base-skill switch ----
    heikoMinSwapGain: number;

    // ---- My Ancestor's Strength ----
    ancestorMinGain: number;
    // Printed skills by id, for the deck's own bodies. Discard-pile summaries
    // carry no printed skill, and a DASH cannot be read off a zero.
    printedSkillsById: Record<string, PrintedSkills>;

    // ---- Way of the Phoenix ----
    // Only spend the card when the blocked ring is worth at least this much to
    // the opponent (their fate pile plus their board payoffs).
    wayOfPhoenixMinValue: number;
    wayOfPhoenixRingFateWeight: number;

    // ---- Retire to the Brotherhood (stronghold province) ----
    // Flood zero-fate bodies once the stronghold province is the next target
    // and at least this many of them are already out — the reveal wipes both
    // boards and refills ours from the deck, and every discarded body is
    // Fushicho fuel.
    retireFloodMinZeroFateBodies: number;

    // ---- Inferno Guard Invoker ----
    // While ATTACKING the honored character is sacrificed if a province breaks,
    // so only spend a body at or below this fate. (Everything is 0 here, which
    // is the point: the sacrifice feeds the discard.)
    infernoAttackMaxFate: number;

    // ---- Benten's Touch ----
    // Ids legal as the bow cost (Phoenix Shugenja), cheapest-first.
    bentenBowPriority: string[];
    bentenMinGloryGain: number;

    // ---- A Season of War ----
    // The event ends the dynasty phase and starts another one. Replaying it
    // from the refilled provinces can loop, so cap activations per game.
    seasonOfWarMaxPerGame: number;

    // ---- dynasty searches (Walking the Way, Emperor's Summons) ----
    searchValueById: Record<string, number>;
}

const PHOENIX_DYNASTY_CHARACTERS = [
    'asako-azunami', 'ethereal-dreamer', 'fushicho', 'inferno-guard-invoker',
    'isawa-heiko', 'isawa-tsuke-2', 'shiba-pureheart', 'solemn-scholar',
    'young-philosopher'
];

const PRINTED_SKILLS: Record<string, PrintedSkills> = {
    'asako-azunami': { military: 4, political: 4 },
    'ethereal-dreamer': { military: 1, political: 1 },
    'feral-ningyo': { military: 3, political: 2 },
    'fushicho': { military: 6, political: 6 },
    'inferno-guard-invoker': { military: 3, political: 2 },
    'isawa-heiko': { military: 0, political: 5 },
    'isawa-tadaka-2': { military: 5, political: 3 },
    'isawa-tsuke-2': { military: 5, political: 4 },
    'kudaka': { military: 3, political: 4 },
    'miya-mystic': { military: 1, political: 1 },
    'shiba-pureheart': { military: 2, political: 1 },
    'solemn-scholar': { military: 1, political: 1 },
    // Young Philosopher has a printed military DASH. Copying it onto a
    // military participant would remove that participant from the conflict.
    'young-philosopher': { military: null, political: 4 }
};

const PRINTED_COSTS: Record<string, number> = {
    'asako-azunami': 5,
    'ethereal-dreamer': 1,
    'feral-ningyo': 3,
    'fushicho': 6,
    'inferno-guard-invoker': 4,
    'isawa-heiko': 4,
    'isawa-tadaka-2': 5,
    'isawa-tsuke-2': 5,
    'kudaka': 4,
    'miya-mystic': 2,
    'shiba-pureheart': 2,
    'solemn-scholar': 1,
    'young-philosopher': 2
};

export const REBIRTH_DEFAULTS: RebirthProfile = {
    fushichoId: 'fushicho',
    fushichoAdditionalFate: 0,
    fushichoMinRound: 1,
    fushichoMinRecursionTargets: 1,

    // Ranked by what the body is worth for a FULL round after it arrives, not
    // by raw skill: a second Fushicho re-arms the whole engine, the two
    // Elemental Masters carry real abilities on top of big stat lines, and the
    // one-cost bodies are only ever chaff to be re-discarded.
    recursionValueById: {
        'fushicho': 60,
        'isawa-tsuke-2': 26,
        'asako-azunami': 24,
        'inferno-guard-invoker': 16,
        'kudaka': 14,
        'isawa-heiko': 12,
        'young-philosopher': 8,
        'shiba-pureheart': 5,
        'miya-mystic': 3,
        'solemn-scholar': 2,
        'ethereal-dreamer': 1
    },
    recursionSkillWeight: 2,
    recursionGloryWeight: 1,
    recursionCostWeight: 0.5,
    phoenixCharacterIds: [...PHOENIX_DYNASTY_CHARACTERS],
    uniqueCharacterIds: [
        'asako-azunami', 'fushicho', 'isawa-heiko', 'isawa-tadaka-2',
        'isawa-tsuke-2', 'kudaka'
    ],

    zeroFateAdditionalFate: 0,
    persistentCharacterIds: [],
    persistentAdditionalFate: 1,

    ringCardBonus: 18,
    ringPayoffsByElement: {
        // Claiming air pays Kudaka 1 fate and 1 card, twice per round.
        air: ['kudaka'],
        // Earth must sit in our CLAIMED pool for Solemn Scholar's from-home bow.
        earth: ['solemn-scholar'],
        // Asako Azunami replaces the water ring effect with bow-one/ready-one,
        // which is strictly better than the printed effect.
        water: ['asako-azunami']
    },
    ringHandPayoffsByElement: {
        // Feral Ningyo enters play into a WATER conflict for free.
        water: ['feral-ningyo']
    },
    unclaimedGuardsByElement: {
        // Isawa Tsuke's fate strip only works while fire is UNCLAIMED.
        fire: ['isawa-tsuke-2']
    },
    unclaimedGuardPenalty: 25,

    shrineHonorFloor: 8,
    shrineProtectClaimedPayoffs: true,

    tsukeHonorFloor: 6,
    tsukeMaxHonorSpend: 3,
    // Skill + 3 per fate + 2 per attachment. About "a body with real skill and
    // fate sunk into it" — never a 1-cost chump.
    tsukeMinTargetValue: 7,

    heikoMinSwapGain: 2,

    ancestorMinGain: 2,
    printedSkillsById: { ...PRINTED_SKILLS },

    wayOfPhoenixMinValue: 20,
    wayOfPhoenixRingFateWeight: 12,

    retireFloodMinZeroFateBodies: 2,

    infernoAttackMaxFate: 1,

    bentenBowPriority: [
        'solemn-scholar', 'ethereal-dreamer', 'young-philosopher',
        'inferno-guard-invoker', 'isawa-heiko', 'asako-azunami', 'isawa-tsuke-2'
    ],
    bentenMinGloryGain: 2,

    seasonOfWarMaxPerGame: 2,

    searchValueById: {
        'fushicho': 100,
        'isawa-tsuke-2': 40,
        'asako-azunami': 38,
        'inferno-guard-invoker': 26,
        'kudaka': 24,
        'isawa-heiko': 22,
        'young-philosopher': 14,
        'shiba-pureheart': 10,
        'forgotten-library': 9,
        'ancestral-shrine': 8,
        'miya-mystic': 6,
        'solemn-scholar': 4,
        'ethereal-dreamer': 3,
        'a-season-of-war': 2
    }
};

type Axis = 'military' | 'political';

const uuidOf = (card: any): string => String(card?.uuid || '');
const fateOf = (card: any): number => Math.max(0, Number(card?.fate) || 0);
const gloryOf = (card: any): number =>
    Math.max(0, Number(card?.glorySummary?.stat ?? card?.glory) || 0);

// A discard-pile summary has EMPTY skill summaries — the engine only fills
// those for cards in play — so printed stats come from the controller's
// `dynastyDiscardBodies` copy or, failing that, from the profile table.
const bodySkill = (card: any, axis: Axis, table: Record<string, PrintedSkills>): number | null => {
    const printed = card?.id ? table[card.id] : undefined;
    if(printed) {
        return printed[axis];
    }
    const direct = Number(card?.[axis]);
    if(Number.isFinite(direct)) {
        return direct;
    }
    const summary = Number(axis === 'military'
        ? card?.militarySkillSummary?.stat
        : card?.politicalSkillSummary?.stat);
    return Number.isFinite(summary) ? summary : null;
};

export class RebirthTactics {
    readonly profile: RebirthProfile;

    constructor(profile: RebirthProfile) {
        this.profile = profile;
    }

    // ---- Fushicho engine -------------------------------------------------

    // Phoenix character by clan/id, for effects restricted to them.
    isPhoenixCharacter(card: any): boolean {
        if(card?.type && card.type !== 'character') {
            return false;
        }
        if(this.profile.phoenixCharacterIds.length === 0) {
            return true;
        }
        return !!card?.id && this.profile.phoenixCharacterIds.includes(card.id);
    }

    /** Legal Fushicho interrupt targets: Phoenix, in the dynasty discard, and
     *  not a unique whose copy is already on the board. */
    recursionTargets(discardBodies: any[], myCharacters: any[] = []): any[] {
        const inPlayIds = new Set((myCharacters || [])
            .filter((card) => card?.id).map((card) => String(card.id)));
        return (discardBodies || []).filter((card) => {
            if(!this.isPhoenixCharacter(card)) {
                return false;
            }
            return !(this.profile.uniqueCharacterIds.includes(card.id) && inPlayIds.has(card.id));
        });
    }

    /** Long-term value of a body arriving with 1 fate off Fushicho's interrupt. */
    recursionValue(card: any): number {
        const idBonus = card?.id ? (this.profile.recursionValueById[card.id] ?? 0) : 0;
        const military = bodySkill(card, 'military', this.profile.printedSkillsById) ?? 0;
        const political = bodySkill(card, 'political', this.profile.printedSkillsById) ?? 0;
        const cost = Number(card?.printedCost ?? PRINTED_COSTS[card?.id] ?? card?.cost) || 0;
        return idBonus +
            Math.max(military, political) * this.profile.recursionSkillWeight +
            gloryOf(card) * this.profile.recursionGloryWeight +
            cost * this.profile.recursionCostWeight;
    }

    // Best body to return from the dynasty discard, excluding anything a
    // unique copy already in play would make illegal.
    pickRecursionTarget(discardBodies: any[], myCharacters: any[] = []): any {
        const legal = this.recursionTargets(discardBodies, myCharacters);
        if(legal.length === 0) {
            return null;
        }
        return legal.slice().sort((a, b) =>
            this.recursionValue(b) - this.recursionValue(a) ||
            uuidOf(a).localeCompare(uuidOf(b)))[0];
    }

    /** Forebearer's Echoes rents a body into the CURRENT military conflict, so
     *  it is ranked on that axis instead of on long-term value. Fushicho still
     *  wins on 6 military AND re-fires its interrupt when the rental expires. */
    pickConflictBody(discardBodies: any[], axis: Axis, myCharacters: any[] = []): any {
        const inPlayIds = new Set((myCharacters || [])
            .filter((card) => card?.id).map((card) => String(card.id)));
        const legal = (discardBodies || []).filter((card) =>
            !(this.profile.uniqueCharacterIds.includes(card?.id) && inPlayIds.has(card.id)) &&
            (bodySkill(card, axis, this.profile.printedSkillsById) ?? -1) >= 0);
        if(legal.length === 0) {
            return null;
        }
        return legal.slice().sort((a, b) =>
            (bodySkill(b, axis, this.profile.printedSkillsById) ?? 0) -
                (bodySkill(a, axis, this.profile.printedSkillsById) ?? 0) ||
            this.recursionValue(b) - this.recursionValue(a) ||
            uuidOf(a).localeCompare(uuidOf(b)))[0];
    }

    /** Fushicho's printed 6 buys a body that dies at the end of the round. It
     *  is only worth that when the interrupt has somewhere to go. */
    shouldPlayFushicho(input: {
        roundNumber?: number;
        dynastyDiscardBodies?: any[];
        myCharacters?: any[];
    }): boolean {
        if((input.roundNumber ?? 1) < this.profile.fushichoMinRound) {
            return false;
        }
        return this.recursionTargets(input.dynastyDiscardBodies || [], input.myCharacters || [])
            .length >= this.profile.fushichoMinRecursionTargets;
    }

    /** Which dynasty character to buy this window.
     *
     *  Fushicho is the best body in the deck by a distance, but its printed 6 is
     *  a whole turn's income and it dies in the fate phase, so it is only worth
     *  that when the interrupt has a target waiting. When the gate fails it is
     *  passed over rather than bought as a plain 6/6 — the next best Phoenix
     *  body costs 5 and lasts exactly as long. */
    pickDynastyCard(
        playable: any[],
        costs: Record<string, number>,
        fate: number,
        myCharacters: any[],
        discardBodies: any[],
        roundNumber?: number
    ): any {
        const costOf = (card: any) => Math.max(0, Number(costs?.[card?.uuid]) || 0);
        const inPlayIds = new Set((myCharacters || [])
            .filter((card) => card?.id).map((card) => String(card.id)));
        const affordable = (playable || []).filter((card) =>
            card?.type === 'character' && costOf(card) <= fate &&
            // A unique already on the board cannot be played again; buying it
            // would burn the window on a click the engine rejects.
            !(this.profile.uniqueCharacterIds.includes(card.id) && inPlayIds.has(card.id)));
        if(affordable.length === 0) {
            return null;
        }
        const fushicho = affordable.find((card) => card.id === this.profile.fushichoId);
        if(fushicho && this.shouldPlayFushicho({
            roundNumber,
            dynastyDiscardBodies: discardBodies,
            myCharacters
        })) {
            return fushicho;
        }
        const rest = affordable.filter((card) => card.id !== this.profile.fushichoId);
        if(rest.length === 0) {
            return null;
        }
        return rest.slice().sort((a, b) =>
            this.recursionValue(b) - this.recursionValue(a) ||
            costOf(b) - costOf(a) ||
            uuidOf(a).localeCompare(uuidOf(b)))[0];
    }

    /** Additional fate at the "how much fate" prompt. Zero for the rotation. */
    desiredAdditionalFate(cardId?: string): number | null {
        if(!cardId) {
            return null;
        }
        if(cardId === this.profile.fushichoId) {
            return this.profile.fushichoAdditionalFate;
        }
        if(this.profile.persistentCharacterIds.includes(cardId)) {
            return this.profile.persistentAdditionalFate;
        }
        return this.profile.zeroFateAdditionalFate;
    }

    // ---- ring steering ---------------------------------------------------

    /** Board-driven ring preference, layered on the policy's generic ring
     *  score (which already dominates on fate piles). */
    ringBonus(element: string, myCharacters: any[], hand: any[]): number {
        const wantedInPlay = this.profile.ringPayoffsByElement[element] || [];
        const wantedInHand = this.profile.ringHandPayoffsByElement[element] || [];
        const guards = this.profile.unclaimedGuardsByElement[element] || [];
        const inPlay = (myCharacters || [])
            .filter((card) => card?.id && wantedInPlay.includes(card.id)).length;
        const inHand = (hand || [])
            .filter((card) => card?.id && wantedInHand.includes(card.id)).length;
        // Contesting a guarded ring risks CLAIMING it, which switches the guard
        // off for the rest of the round.
        const guarded = (myCharacters || [])
            .filter((card) => card?.id && guards.includes(card.id)).length;
        return (inPlay + inHand) * this.profile.ringCardBonus -
            guarded * this.profile.unclaimedGuardPenalty;
    }

    // ---- Ancestral Shrine ------------------------------------------------

    /** Rings worth returning to the unclaimed pool for 1 honor each. Freeing a
     *  guarded element (fire) re-arms Isawa Tsuke, which is worth more than the
     *  honor; otherwise this is a pure honor top-up while we sit low. */
    shrineReturnRings(rings: any[], myCharacters: any[], myHonor: number): any[] {
        const claimedByMe = (rings || []).filter((ring) => ring?.claimed);
        if(claimedByMe.length === 0) {
            return [];
        }
        const guardWants = (element: string) =>
            (this.profile.unclaimedGuardsByElement[element] || [])
                .some((id) => (myCharacters || []).some((card) => card?.id === id));
        const payoffWants = (element: string) =>
            (this.profile.ringPayoffsByElement[element] || [])
                .some((id) => (myCharacters || []).some((card) => card?.id === id));
        const freeing = claimedByMe.filter((ring) => guardWants(String(ring.element || '')));
        if(freeing.length > 0) {
            return freeing;
        }
        if(myHonor > this.profile.shrineHonorFloor) {
            return [];
        }
        return claimedByMe.filter((ring) =>
            !(this.profile.shrineProtectClaimedPayoffs && payoffWants(String(ring.element || ''))));
    }

    // ---- Isawa Tsuke -----------------------------------------------------

    /** Value of removing one fate from a body: its skill plus what the
     *  opponent sank into it, since a body that drops to zero fate is
     *  discarded in the fate phase along with its attachments. */
    private stripValue(card: any, skillOf: (card: any) => number): number {
        return skillOf(card) + fateOf(card) * 3 + (card?.attachments?.length || 0) * 2;
    }

    /** Enemy participants worth spending honor on, best first. */
    tsukeTargets(opponentParticipants: any[], skillOf: (card: any) => number): any[] {
        return (opponentParticipants || [])
            .filter((card) => card?.type !== 'attachment' && fateOf(card) > 0 &&
                this.stripValue(card, skillOf) >= this.profile.tsukeMinTargetValue)
            .sort((a, b) =>
                this.stripValue(b, skillOf) - this.stripValue(a, skillOf) ||
                uuidOf(a).localeCompare(uuidOf(b)));
    }

    /** How much honor to bid. Each point strips one fate from one participant,
     *  and the follow-up selector then demands EXACTLY that many targets — so
     *  never bid past the number of enemy bodies worth hitting, or the prompt
     *  forces us to strip our own. */
    tsukeHonorSpend(opponentParticipants: any[], myHonor: number, skillOf: (card: any) => number): number {
        const budget = Math.min(
            this.profile.tsukeMaxHonorSpend,
            Math.max(0, myHonor - this.profile.tsukeHonorFloor)
        );
        return Math.min(budget, this.tsukeTargets(opponentParticipants, skillOf).length);
    }

    // ---- Isawa Heiko -----------------------------------------------------

    /** Heiko's reaction switches ONE character's base skills for the phase. It
     *  is symmetric: swapping our own lopsided body onto the contested axis
     *  gains us skill, and swapping an enemy participant's costs them the same.
     *  Live skills stand in for base skills — every other modifier survives the
     *  switch, so the delta is what matters and it cancels. */
    heikoSwapTarget(
        myParticipants: any[],
        opponentParticipants: any[],
        axis: Axis,
        skillOf: (card: any, axis: Axis) => number
    ): { card: any; gain: number; own: boolean } | null {
        const other: Axis = axis === 'military' ? 'political' : 'military';
        const options: Array<{ card: any; gain: number; own: boolean }> = [];
        for(const card of myParticipants || []) {
            if(card?.bowed) {
                continue;
            }
            options.push({ card, own: true, gain: skillOf(card, other) - skillOf(card, axis) });
        }
        for(const card of opponentParticipants || []) {
            if(card?.bowed) {
                continue;
            }
            options.push({ card, own: false, gain: skillOf(card, axis) - skillOf(card, other) });
        }
        const best = options
            .filter((option) => option.gain >= this.profile.heikoMinSwapGain)
            .sort((a, b) => b.gain - a.gain ||
                uuidOf(a.card).localeCompare(uuidOf(b.card)))[0];
        return best || null;
    }

    // ---- My Ancestor's Strength -----------------------------------------

    /** Set a participating Shugenja's base skills to a discarded character's
     *  printed skills. Both halves are chosen together because the gain is a
     *  property of the PAIR.
     *
     *  Copying a printed DASH onto a participant removes it from the conflict,
     *  so an ancestor with a dash on the contested axis is never legal here. */
    ancestorPlan(
        myParticipants: any[],
        discardBodies: any[],
        axis: Axis
    ): { shugenja: any; ancestor: any; gain: number } | null {
        const table = this.profile.printedSkillsById;
        const shugenja = (myParticipants || []).filter((card) =>
            !card?.bowed && this.isShugenja(card) &&
            (bodySkill(card, axis, table) ?? -1) >= 0);
        const ancestors = (discardBodies || []).filter((card) =>
            (bodySkill(card, axis, table) ?? null) !== null);
        if(shugenja.length === 0 || ancestors.length === 0) {
            return null;
        }
        let best: { shugenja: any; ancestor: any; gain: number } | null = null;
        for(const target of shugenja) {
            const base = bodySkill(target, axis, table) ?? 0;
            for(const ancestor of ancestors) {
                const gain = (bodySkill(ancestor, axis, table) ?? 0) - base;
                if(gain < this.profile.ancestorMinGain) {
                    continue;
                }
                if(!best || gain > best.gain ||
                    (gain === best.gain &&
                        uuidOf(ancestor).localeCompare(uuidOf(best.ancestor)) < 0)) {
                    best = { shugenja: target, ancestor, gain };
                }
            }
        }
        return best;
    }

    // Shugenja by trait, falling back to the id list when traits are absent.
    isShugenja(card: any): boolean {
        const traits = card?.traits;
        if(Array.isArray(traits)) {
            return traits.some((trait: any) => String(trait).toLowerCase() === 'shugenja');
        }
        return typeof traits === 'string' && /\bshugenja\b/i.test(traits);
    }

    // ---- Way of the Phoenix ---------------------------------------------

    /** Deny the opponent the ring they most want this phase. Blocking one ring
     *  blocks its element, so this is a single choice: their biggest fate pile,
     *  adjusted for what their board actually exploits. */
    pickBlockedRing(rings: any[], opponentCharacters: any[], opponentValue: (ring: any) => number): any {
        const candidates = (rings || []).filter((ring) => !ring?.claimed);
        if(candidates.length === 0) {
            return null;
        }
        const score = (ring: any) =>
            (Number(ring?.fate) || 0) * this.profile.wayOfPhoenixRingFateWeight + opponentValue(ring);
        const best = candidates.slice().sort((a, b) => score(b) - score(a) ||
            String(a?.element || '').localeCompare(String(b?.element || '')))[0];
        return score(best) >= this.profile.wayOfPhoenixMinValue ? best : null;
    }

    // Way of the Phoenix needs the right ring state and enemy board to be
    // worth its cost.
    shouldPlayWayOfThePhoenix(
        rings: any[],
        opponentCharacters: any[],
        opponentValue: (ring: any) => number,
        opponentConflictsRemaining: number
    ): boolean {
        return opponentConflictsRemaining > 0 &&
            !!this.pickBlockedRing(rings, opponentCharacters, opponentValue);
    }

    // ---- Retire to the Brotherhood --------------------------------------

    // ---- Inferno Guard Invoker ------------------------------------------

    /** Honoring adds the character's glory to BOTH skills. On defense we want
     *  the biggest glory on the board; while attacking the honored body is
     *  sacrificed if the province breaks, so it must be one we are content to
     *  feed to the discard. */
    pickInfernoTarget(myParticipants: any[], amAttacker: boolean): any {
        const eligible = (myParticipants || []).filter((card) =>
            !card?.isHonored && gloryOf(card) > 0 &&
            (!amAttacker || fateOf(card) <= this.profile.infernoAttackMaxFate));
        if(eligible.length === 0) {
            return null;
        }
        return eligible.slice().sort((a, b) =>
            gloryOf(b) - gloryOf(a) ||
            fateOf(a) - fateOf(b) ||
            uuidOf(a).localeCompare(uuidOf(b)))[0];
    }

    // ---- Benten's Touch --------------------------------------------------

    /** The bow cost must be a PHOENIX Shugenja, which rules out Kudaka and
     *  Miya Mystic (both faction `neutral`). Bow the cheapest one that is not
     *  currently carrying the conflict. */
    pickBentenBow(myCharacters: any[]): any {
        const rank = (card: any) => {
            const index = this.profile.bentenBowPriority.indexOf(card?.id);
            return index < 0 ? this.profile.bentenBowPriority.length : index;
        };
        const legal = (myCharacters || []).filter((card) =>
            !card?.bowed && card?.id && this.profile.bentenBowPriority.includes(card.id));
        if(legal.length === 0) {
            return null;
        }
        return legal.slice().sort((a, b) =>
            // A body sitting at home contributes nothing to the current total,
            // so bowing it is free.
            (a.inConflict ? 1 : 0) - (b.inConflict ? 1 : 0) ||
            rank(a) - rank(b) ||
            uuidOf(a).localeCompare(uuidOf(b)))[0];
    }

    // Honor the participant that gains the most, subject to a minimum glory
    // so the trigger is not wasted.
    pickBentenHonorTarget(myParticipants: any[]): any {
        const eligible = (myParticipants || []).filter((card) =>
            !card?.isHonored && gloryOf(card) >= this.profile.bentenMinGloryGain);
        if(eligible.length === 0) {
            return null;
        }
        return eligible.slice().sort((a, b) =>
            gloryOf(b) - gloryOf(a) ||
            uuidOf(a).localeCompare(uuidOf(b)))[0];
    }

    // ---- dynasty searches ------------------------------------------------

    // How much this deck wants a given card out of a search effect.
    searchValue(card: any): number {
        return card?.id ? (this.profile.searchValueById[card.id] ?? 0) : 0;
    }

    /** Emperor's Summons and Walking the Way both dig for Fushicho first. */
    pickSearchTarget(cards: any[]): any {
        if(!cards || cards.length === 0) {
            return null;
        }
        return cards.slice().sort((a, b) =>
            this.searchValue(b) - this.searchValue(a) ||
            uuidOf(a).localeCompare(uuidOf(b)))[0];
    }

    /** Walking the Way replaces a card in one of our provinces. Throw away the
     *  least valuable one — and never a holding, which is permanent value. */
    pickProvinceDiscard(cards: any[]): any {
        const candidates = (cards || []).filter((card) => card?.type !== 'holding');
        const pool = candidates.length > 0 ? candidates : (cards || []);
        if(pool.length === 0) {
            return null;
        }
        return pool.slice().sort((a, b) =>
            this.searchValue(a) - this.searchValue(b) ||
            uuidOf(a).localeCompare(uuidOf(b)))[0];
    }
}
