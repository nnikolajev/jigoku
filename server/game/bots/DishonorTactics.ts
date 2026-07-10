// Dishonor/mill playstyle for the heuristic bot (Scorpion "Poison Mill",
// EmeraldDB 5eb874cc). The deck wins by driving the OPPONENT to 0 honor while
// deliberately keeping its OWN honor low-but-alive:
//
// - bid LOW on every honor dial (draw phase and duels) so a value-bidding
//   opponent pays the difference in honor every round,
// - take honor with the air ring instead of gaining it,
// - dishonor enemy characters (a dishonored character that leaves play costs
//   its controller another honor),
// - mill the opponent's conflict deck (Deserted Shrine, Licensed Quarter,
//   Master Whisperer, Midnight Prowler) — an empty conflict deck costs 5 honor
//   on the reshuffle,
// - sit in the 3..6 own-honor band: many deck cards turn on at 6 or less
//   (Shadow Stalker) or while less honorable (Yogo Outcast, Compromised
//   Secrets), while 0 honor is the shared loss condition. City of the Open
//   Hand climbs back toward the band; honor-cost abilities stop at the floor.
//
// All behavior here is DATA-gated: the tactics only exist when the deck's
// profile carries a DishonorProfile (derived from the dishonor marker cards),
// so every other deck — including the fine-tuned Unicorn default — keeps the
// unchanged generic behavior.

// Tuning knobs for the dishonor playstyle. Every value a future dishonor deck
// might want to tune differently lives here, not in the policy code.
export interface DishonorProfile {
    firstRoundBid: number; // draw-phase bid while honor is full (cards > honor early)
    lowBid: number; // every later dial: draw phase AND duels — farm the difference
    honorFloor: number; // never pay honor costs at or below this own-honor value
    honorCeiling: number; // the "6 or fewer" band many deck cards want; the
                          // stronghold stops climbing once the next gain would
                          // leave the band
    airRingBonus: number; // added to the air ring's declaration score (the deck's
                          // honor-drain engine; kept below the fate-pile override)
    takeHonorWithAirRing: boolean; // resolve air as "take 1" instead of "gain 2"
    preferDishonorWithFireRing: boolean; // resolve fire on an enemy (dishonor) first
    preConflictAttachments: boolean; // play Peaceful/pre-conflict control
                                     // attachments (Pacifism, Stolen Breath)
                                     // in conflict-phase action windows
    preConflictMinFate: number; // only spend on those while at/above this fate
}

export const DISHONOR_DEFAULTS: DishonorProfile = {
    firstRoundBid: 5,
    lowBid: 1,
    honorFloor: 3,
    honorCeiling: 6,
    airRingBonus: 60,
    takeHonorWithAirRing: true,
    preferDishonorWithFireRing: true,
    preConflictAttachments: true,
    preConflictMinFate: 3
};

// Decision helpers the policy delegates to when (and only when) the deck's
// profile carries a DishonorProfile. Stateless: every method takes the live
// prompt data and returns a pick or null (null = fall through to the generic
// heuristic).
export class DishonorTactics {
    private profile: DishonorProfile;

    constructor(profile: DishonorProfile) {
        this.profile = profile;
    }

    // Every honor dial (draw phase and duels): first round buys the full hand,
    // afterwards bid low so the opponent's higher bid pays us the difference.
    // Duels reach here too — losing a duel is fine, the honor flows in.
    desiredBid(roundNumber: number | undefined, myHonor: number): number {
        if(roundNumber !== undefined && roundNumber <= 1 && myHonor > this.profile.honorFloor) {
            return this.profile.firstRoundBid;
        }
        return this.profile.lowBid;
    }

    // Air ring resolution: taking 1 honor drains the opponent toward the
    // dishonor defeat (the win condition); gain 2 only when our own honor
    // needs the rescue more.
    preferTakeHonor(myHonor: number): boolean {
        if(!this.profile.takeHonorWithAirRing) {
            return false;
        }
        return myHonor > this.profile.honorFloor;
    }

    // Fire ring resolution: a dishonored enemy character fights worse and
    // bleeds its controller 1 more honor when it dies — better for this deck
    // than honoring its own (which also risks climbing out of the low-honor
    // band on glory).
    preferDishonorEnemy(): boolean {
        return this.profile.preferDishonorWithFireRing;
    }

    // City of the Open Hand: bow to gain 1 honor while less honorable. Climb
    // only while the gain keeps us inside the low-honor band — the band is
    // where Shadow Stalker and friends are strongest.
    shouldGainStrongholdHonor(myHonor: number): boolean {
        return myHonor < this.profile.honorCeiling;
    }

    // Gate for abilities that PAY honor (Thunder Guard Elite, Shosuro Hametsu,
    // Moto Eviscerator, Banzai's second resolution): honor is a resource until
    // the floor, then it is the loss condition.
    canPayHonor(myHonor: number): boolean {
        return myHonor > this.profile.honorFloor;
    }

    // "Choose a deck" select prompts (Deserted Shrine): mill the opponent's
    // CONFLICT deck — running it out costs them 5 honor on the reshuffle and
    // strips their tricks. Falls back to any opponent deck.
    pickDeckButton(buttons: any[], myName: string): any {
        const notMine = buttons.filter((button) => !String(button.text || '').startsWith(`${myName}'s`));
        return notMine.find((button) => String(button.text || '').includes('Conflict')) || notMine[0] || null;
    }

    // "Choose a player" select prompts from the deck's own disruption (Master
    // Whisperer's discard-3-draw-3): always the opponent — it burns 3 of their
    // conflict deck and scrambles their hand.
    pickOpponentButton(buttons: any[], opponentName?: string): any {
        if(!opponentName) {
            return null;
        }
        return buttons.find((button) => String(button.text || '') === opponentName) || null;
    }

    // Pre-conflict control attachments (Pacifism, Stolen Breath cannot be
    // played during a conflict): spend on them in the conflict-phase action
    // window while fate allows.
    canPlayPreConflict(myFate: number): boolean {
        return this.profile.preConflictAttachments && myFate >= this.profile.preConflictMinFate;
    }

    get airRingBonus(): number {
        return this.profile.airRingBonus;
    }
}
