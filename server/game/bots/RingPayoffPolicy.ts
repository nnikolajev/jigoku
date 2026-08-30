// A RING IS WORTH WHAT CLAIMING IT PAYS.
//
// The generic V1 ring score (`JigokuBotPolicy.ringElementBase`) ranks elements
// by their PRINTED effect: void 50 against a fated board, earth 40, fire 30,
// water 8-75 depending on bow/ready targets, and everything else — air — 15.
// That ordering is right for a board with no element payoff on it and wrong for
// a board carrying one.
//
// `Kudaka` is the case that forced this out: "after you claim a ring, if the
// conflict or the ring has the air element, gain 1 fate and draw 1 card", twice
// a round. Live 2026-08-30 (Unicorn vs Phoenix, round 1 conflict 1) the bot
// declared with Kudaka as its ONLY character in play and contested the VOID
// ring — void scored 50 because the opponent had a fated body, air scored 15,
// and nothing in the generic score knew Kudaka was standing there.
//
// Two decks already steer air correctly, and each does it inside its own model:
// Phoenix Shugenja through `ShugenjaTactics.ringPlanScore`
// (`ringPlanKudakaAirValue`) and Phoenix "Phoenix" through
// `RebirthTactics.ringBonus` (`ringPayoffsByElement.air`). Neither is reachable
// from any other deck, so a third deck running the same card got nothing. This
// is the generic half: a card -> element map applied field-wide, keyed on the
// CARD in play rather than on the archetype, so any deck that runs the card
// inherits the steering and a deck that does not is bit-identical.
//
// SUBORDINATE TO FATE, deliberately. The bonus is added AFTER `ringScore`'s
// fate tier, exactly like `DishonorTactics.airRingBonus`: a ring carrying fate
// still outranks the payoff, because the attacker banks that fate at
// DECLARATION whether or not the conflict is won, while the payoff only pays if
// the ring is actually CLAIMED.
//
// Scored off the `me` argument `ringScore` is called with, not off the deck
// profile, so the inverted defender-ring reading
// (`DefenderRingChoicePolicy.scoreForAttacker`) prices the OPPONENT's Kudaka
// too — handing an air ring to a player who runs it is exactly the ring not to
// give away.

export interface RingPayoffConfig {
    // False reproduces the pre-2026-08-30 generic score exactly.
    enabled: boolean;
    // Element -> card ids in play that make CLAIMING that element pay something
    // the printed ring effect does not cover.
    payoffsByElement: Record<string, string[]>;
    // Points per matching card in play. The sub-fate band tops out at 75
    // (water with a full ready bonus, earth with the omniscient threat bonus),
    // so a single payoff has to clear that to reorder anything, and the fate
    // tier starts at 1000 so it can never outrank a fate pile.
    bonusPerCard: number;
    // The fate tier only engages at `ringScore`'s own threshold, which is 2 for
    // a policy that is not fate-aware — so between them a bonus this size would
    // take a bare air ring over a ring carrying ONE fate. While a payoff is
    // live on the board the threshold drops to this, which is what makes
    // "steer to air, unless there is fate on another ring" true for every seed
    // rather than only for the fate-aware ones.
    fateDominanceThreshold: number;
}

export const DEFAULT_RING_PAYOFF: RingPayoffConfig = {
    enabled: true,
    payoffsByElement: {
        // Kudaka: after claiming a ring with the air element, gain 1 fate and
        // draw 1 card. Limit twice per round, but a claimed ring is out of the
        // unclaimed pool until the fate phase returns it, so the steering can
        // only apply once a round anyway and needs no counter.
        air: ['kudaka']
    },
    bonusPerCard: 80,
    fateDominanceThreshold: 1
};

export class RingPayoffPolicy {
    readonly config: RingPayoffConfig;

    constructor(config: Partial<RingPayoffConfig> = {}) {
        this.config = { ...DEFAULT_RING_PAYOFF, ...config };
    }

    /** Cards in play that pay when this element is claimed. */
    matches(element: string, charactersInPlay: readonly any[]): string[] {
        if(!this.config.enabled) {
            return [];
        }
        const wanted = this.config.payoffsByElement[String(element || '')] || [];
        if(wanted.length === 0) {
            return [];
        }
        return (charactersInPlay || [])
            .filter((card: any) => card?.id && wanted.includes(String(card.id)))
            .map((card: any) => String(card.id));
    }

    /** Extra ring score for claiming this element with this board standing. */
    elementBonus(element: string, charactersInPlay: readonly any[]): number {
        return this.matches(element, charactersInPlay).length * this.config.bonusPerCard;
    }

    /** Is any configured payoff standing on this board at all? Only then does
     *  the steering — and the fate threshold it brings with it — apply. */
    active(charactersInPlay: readonly any[]): boolean {
        return Object.keys(this.config.payoffsByElement)
            .some((element) => this.matches(element, charactersInPlay).length > 0);
    }

    /** The ring fate that outranks this steering, or null when nothing on the
     *  board is being steered and `ringScore` keeps its own threshold. */
    fateThreshold(charactersInPlay: readonly any[]): number | null {
        return this.active(charactersInPlay) ? this.config.fateDominanceThreshold : null;
    }
}
