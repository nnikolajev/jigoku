// Bushi-swarm playstyle for the heuristic bot (Lion "Bushi" precon,
// EmeraldDB e3feb31b). The deck floods the board with cheap Bushi characters
// and attacks with everything, every window:
//
// - the swarm buffs itself in numbers (Honored General, Ikoma Tsanuri, Matsu
//   Gohei) and profits from every won conflict (Gifted Tactician draws, For
//   Greater Glory fates the whole board, In Service to My Lord / Right Hand
//   of the Emperor ready the key bodies for the next attack),
// - bid LOW (2) on later draw dials: Tactician's Apprentice draws an extra
//   card whenever the bid is LOWER than the opponent's, and the honor the
//   higher bidder pays flows in — bidding 4 was measured to bleed the deck
//   into dishonor losses (7/40 games vs Crane) without winning more,
// - bid moderately (3) in duels: its duels (True Strike Kenjutsu, Honorable
//   Challenger) bow the loser, but bid-5 duels drained honor the same way,
// - the stronghold (Hayaken no Shiro) readies a cost-2-or-lower Bushi every
//   conflict window it can,
// - battlefield attachments (Prepared Ambush, Makeshift War Camp) go onto the
//   attacked own province while defending.
//
// All behavior here is DATA-gated: the tactics only exist when the deck's
// profile carries a LionProfile (the lion-bushi-swarm override), so every
// other deck — including the fine-tuned Unicorn default — keeps the unchanged
// generic behavior.

// Tuning knobs for the swarm playstyle. Every value a future swarm deck might
// want to tune differently lives here, not in the policy code.
export interface LionProfile {
    firstRoundBid: number; // full-hand tempo while honor is at its highest
    drawBid: number; // later draw dials: low — triggers Tactician's
                     // Apprentice and farms the dial's honor difference
    duelBid: number; // duels bow the loser — pay some honor to win them
    honorFloor: number; // below this own-honor value stop bidding/paying high
                        // (0 honor is the shared loss condition)
    strongholdReadyTargets: string[]; // printed ids Hayaken no Shiro can ready
                                      // (the deck's Bushi with printed cost <= 2)
    forgeAttachmentRanking: string[]; // Illustrious Forge pick order, strongest
                                      // military bonus first
}

export const LION_DEFAULTS: LionProfile = {
    firstRoundBid: 5,
    drawBid: 2,
    duelBid: 3,
    honorFloor: 4,
    strongholdReadyTargets: [
        'matsu-berserker', 'miwaku-kabe-guard', 'tactician-s-apprentice',
        'ikoma-reservist', 'akodo-gunso', 'akodo-toshiro', 'gifted-tactician',
        'honorable-challenger', 'ikoma-tsanuri', 'matsu-gohei',
        'samurai-of-integrity'
    ],
    forgeAttachmentRanking: [
        'shori', 'kamayari', 'fine-katana', 'tactical-ingenuity',
        'seal-of-the-lion', 'true-strike-kenjutsu', 'sashimono', 'ornate-fan'
    ]
};

// Decision helpers the policy delegates to when (and only when) the deck's
// profile carries a LionProfile. Stateless: every method takes the live
// prompt data and returns a value the policy applies.
export class LionTactics {
    private profile: LionProfile;

    constructor(profile: LionProfile) {
        this.profile = profile;
    }

    // Draw dials bid low (the Apprentice draw when outbid plus the honor the
    // higher bidder pays us); duel dials bid a bit higher because the deck's
    // duels bow the loser. Both collapse to 1 once honor runs out — the deck
    // bleeds honor to Ikoma Ujiaki and Assassination and must not hand the
    // opponent the dishonor victory.
    desiredBid(roundNumber: number | undefined, myHonor: number, isDuel: boolean): number {
        if(myHonor <= this.profile.honorFloor) {
            return 1;
        }
        if(isDuel) {
            return this.profile.duelBid;
        }
        if(roundNumber !== undefined && roundNumber <= 1) {
            return this.profile.firstRoundBid;
        }
        return this.profile.drawBid;
    }

    // Hayaken no Shiro: bow the stronghold to ready a cost-2-or-lower Bushi.
    // Click it whenever a known cheap own character sits bowed — the ready
    // body defends the next conflict or joins the next attack.
    shouldReadyWithStronghold(myCharacters: any[]): boolean {
        return myCharacters.some((card) =>
            card.bowed && card.id && this.profile.strongholdReadyTargets.includes(card.id));
    }

    // Illustrious Forge's "Choose an attachment" menu (top 5 of the conflict
    // deck): take the strongest weapon. Ranked by printed military bonus —
    // deck card summaries carry no stats at that prompt.
    pickForgeAttachment(cards: any[]): any {
        const ranking = this.profile.forgeAttachmentRanking;
        const ranked = cards
            .filter((card) => card.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || cards[0] || null;
    }
}
