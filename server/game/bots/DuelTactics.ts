// Duel-centric playstyle for the heuristic bot (upgraded Crane Duels,
// EmeraldDB e2e443b5). The deck keeps a FEW durable, honored duelists on the
// board and grinds value out of every duel:
//
// - duels are initiated with our best character on the duel's axis against
//   their weakest (when we choose the enemy), and the honor dial is bid to
//   WIN — Kyuden Kakita honors our duelist after every resolved duel,
//   Proving Ground draws, Kakita Blade gains honor, Policy Debate strips
//   their hand, Storied Defeat bows the loser,
// - attachments (Duelist Training, Daimyo's Gunbai, Shukujo, Kakita Blade,
//   Iaijutsu Master) stack on the key duelists so one body carries several
//   duel actions,
// - Vassal Fields sits under the stronghold (its action drains the
//   attacker's fate on the final push); Tsuma plays characters pre-honored;
//   Magistrate Station re-readies honored characters.
//
// All behavior here is DATA-gated: the tactics exist only when the deck's
// profile carries a DuelProfile. The SPARRING Crane precon shares almost
// every card with this list, so the strategy flag keys on Tsuma (new-list
// only) — the baseline opponent must keep its generic behavior or every
// deck's measured band shifts.

// Tuning knobs for the duel playstyle.
export interface DuelProfile {
    duelBid: number; // bid to WIN duels — the deck's payoffs all key on winning
    honorFloor: number; // below this, stop paying the dial
    // duel-initiating card id -> the skill axis the duel compares
    duelAxes: Record<string, 'military' | 'political'>;
    // ranked bearers for the duel attachments and fate investment
    keyCharacters: string[];
}

export const DUEL_DEFAULTS: DuelProfile = {
    duelBid: 2,
    honorFloor: 4,
    duelAxes: {
        'kakita-dojo': 'military',
        'duelist-training': 'military',
        'daimyo-s-gunbai': 'military',
        'issue-a-challenge': 'military',
        'duel-to-the-death': 'military',
        'aspiring-challenger': 'military',
        'kakita-kaezin': 'military',
        'arrogant-kakita': 'military',
        'policy-debate': 'political',
        'make-your-case': 'political',
        'disparaging-challenge': 'political',
        'courtly-challenger': 'political',
        'cunning-negotiator': 'political'
    },
    keyCharacters: [
        'kakita-toshimoko', 'kakita-kaezin', 'doji-kuwanan',
        'iron-crane-legion', 'tengu-sensei', 'doji-challenger'
    ]
};

// Decision helpers the policy delegates to when (and only when) the deck's
// profile carries a DuelProfile. Stateless.
export class DuelTactics {
    private profile: DuelProfile;

    constructor(profile: DuelProfile) {
        this.profile = profile;
    }

    // Every duel payoff (stronghold honor, Proving Ground draw, Kakita Blade
    // honor, the duel effects themselves) keys on WINNING — pay for it while
    // honor allows.
    desiredDuelBid(myHonor: number): number {
        return myHonor > this.profile.honorFloor ? this.profile.duelBid : 1;
    }

    // The axis a duel source compares — used to send our strongest on that
    // axis and target their weakest.
    duelAxis(cardId: string | undefined): 'military' | 'political' | null {
        return (cardId && this.profile.duelAxes[cardId]) || null;
    }

    // Duel attachments stack on the durable duelists.
    pickKeyCharacter(mine: any[]): any {
        const ranking = this.profile.keyCharacters;
        const ranked = mine
            .filter((card) => card.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || null;
    }
}
