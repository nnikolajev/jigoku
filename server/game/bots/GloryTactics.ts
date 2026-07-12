// Glory/honor playstyle for the heuristic bot (Phoenix "For Honor and Glory",
// EmeraldDB 7c5b9776). The deck builds a persistent board of high-glory
// characters, honors them (an honored character adds its glory to both
// skills), holds the Imperial Favor through glory counts, and picks WHICH
// ring to contest from the cards it has in play:
//
// - the stronghold (Isawa Mori Seido) gives a character +2 glory for the
//   phase — aimed at an honored participant mid-conflict (straight stats) or
//   at the biggest ready body for the favor's glory count,
// - the ring to attack follows the board: earth while Solemn Scholar is out
//   (bow an attacker every conflict), water for Prodigy of the Waves /
//   Asako Tsuki / Feral Ningyo, void for Isawa Atsuko / Ujina / Kaede,
// - duels (Game of Sadane) honor the winner and dishonor the loser — worth a
//   real bid,
// - it does not rush: the generic balanced attack/defense knobs stay, and
//   honor accumulates toward a possible (secondary) honor victory.
//
// All behavior here is DATA-gated: the tactics only exist when the deck's
// profile carries a GloryProfile (derived from the glory marker cards), so
// every other deck keeps the unchanged generic behavior.

// Tuning knobs for the glory playstyle. Every value a future glory deck
// might want to tune differently lives here, not in the policy code.
export interface GloryProfile {
    duelBid: number; // Game of Sadane honors the winner — bid to win it
    ringCardBonus: number; // ring-score bonus per own in-play card that wants
                           // that ring's element
    // element -> printed ids (in play) that make contesting it better
    ringPreferences: Record<string, string[]>;
    // Ofushikai wants the Champion; ranked attach preference
    ofushikaiTargets: string[];
    // own Shugenja ids (Supernatural Storm scales with these; summaries
    // carry no traits, so the gate counts by printed id)
    shugenjaIds: string[];
}

export const GLORY_DEFAULTS: GloryProfile = {
    duelBid: 4,
    ringCardBonus: 12,
    ringPreferences: {
        earth: ['solemn-scholar'],
        water: ['prodigy-of-the-waves', 'asako-tsuki', 'feral-ningyo'],
        void: ['isawa-atsuko', 'isawa-ujina', 'isawa-kaede']
    },
    ofushikaiTargets: ['shiba-tsukune', 'isawa-kaede', 'isawa-ujina'],
    shugenjaIds: [
        'asako-tsuki', 'ethereal-dreamer', 'isawa-atsuko', 'isawa-kaede',
        'isawa-ujina', 'prodigy-of-the-waves', 'solemn-scholar'
    ]
};

// Decision helpers the policy delegates to when (and only when) the deck's
// profile carries a GloryProfile. Stateless.
export class GloryTactics {
    private profile: GloryProfile;

    constructor(profile: GloryProfile) {
        this.profile = profile;
    }

    // Ring declaration/steering: bonus for the elements the current board
    // exploits (Solemn Scholar bows attackers with earth claimed, the void
    // masters punish void, the water package readies and recurs).
    ringBonus(element: string, myCharacters: any[], hand: any[]): number {
        const wanted = this.profile.ringPreferences[element];
        if(!wanted) {
            return 0;
        }
        const inPlay = myCharacters.filter((card) => card.id && wanted.includes(card.id)).length;
        // Feral Ningyo is free to PLAY during a water conflict — count it
        // from hand too.
        const inHand = (hand || []).filter((card) => card.id && wanted.includes(card.id)).length;
        return (inPlay + inHand) * this.profile.ringCardBonus;
    }

    // Duel dials: Game of Sadane honors the winner and dishonors the loser —
    // the whole deck is honored-character stats, so pay to win.
    desiredDuelBid(myHonor: number): number {
        return myHonor > 3 ? this.profile.duelBid : 1;
    }

    // Ofushikai attaches to the Champion (its move-home Action only exists
    // there): ranked preference among own characters.
    pickOfushikaiTarget(mine: any[]): any {
        const ranking = this.profile.ofushikaiTargets;
        const ranked = mine
            .filter((card) => card.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || null;
    }

    // Supernatural Storm scales with own Shugenja in play.
    shugenjaCount(myCharacters: any[]): number {
        return myCharacters.filter((card) => card.id && this.profile.shugenjaIds.includes(card.id)).length;
    }

    // Isawa Mori Seido's +2 glory: an honored PARTICIPANT converts it to
    // skill right now; otherwise the biggest ready body banks it for the
    // favor's glory count. Any target works — only skip when we have no
    // characters at all.
    shouldUseStronghold(myCharacters: any[]): boolean {
        return myCharacters.length > 0;
    }

    pickGloryTarget(mine: any[], skillOf: (card: any) => number): any {
        const honored = mine.filter((card) => card.isHonored && card.inConflict && !card.bowed);
        const pool = honored.length > 0 ? honored : mine.filter((card) => !card.bowed);
        if(pool.length === 0) {
            return null;
        }
        return pool.slice().sort((a, b) => skillOf(b) - skillOf(a))[0];
    }
}
