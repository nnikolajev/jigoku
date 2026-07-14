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
    // Keep this many durable duelists in play, each with a deep fate stack.
    towerTargetCount: number;
    supportTargetCount: number;
    towerFateMin: number;
    towerFateMax: number;
    // Attachments in this deck that should land on a tower whenever legal.
    towerAttachments: string[];
    // Player-state summaries do not expose keywords, so track the deck's
    // Restricted attachments by printed id to enforce the two-slot cap.
    restrictedAttachments: string[];
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
        'tengu-sensei', 'doji-kuwanan', 'kakita-kaezin', 'kakita-toshimoko'
    ],
    towerTargetCount: 2,
    supportTargetCount: 2,
    towerFateMin: 3,
    towerFateMax: 5,
    towerAttachments: [
        'shukujo', 'duelist-training', 'daimyo-s-gunbai', 'kakita-blade',
        'iaijutsu-master', 'fine-katana', 'ornate-fan', 'seal-of-the-crane'
    ],
    restrictedAttachments: [
        'shukujo', 'daimyo-s-gunbai', 'kakita-blade', 'fine-katana', 'ornate-fan'
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

    isTowerCharacter(cardId: string | undefined): boolean {
        return !!cardId && this.profile.keyCharacters.includes(cardId);
    }

    needsTower(board: any[]): boolean {
        return board.filter((card) => this.isTowerCharacter(card.id)).length < this.profile.towerTargetCount;
    }

    // Buy a preferred duelist only when it can receive at least 3 fate. If a
    // tower is showing but cannot be funded yet, the policy saves fate and
    // keeps that province card through regroup instead of replacing it.
    pickDynastyTower(playable: any[], costs: Record<string, number>, fate: number, board: any[], hand: any[] = []): any {
        if(!this.needsTower(board)) {
            return null;
        }
        const hasShukujo = hand.some((card) => card.id === 'shukujo');
        const ranking = this.profile.keyCharacters;
        const candidates = playable
            .filter((card) => this.isTowerCharacter(card.id))
            .filter((card) => fate >= (costs[card.uuid] ?? 0) + this.profile.towerFateMin)
            .sort((a, b) => {
                // Shukujo only has its printed Action on Doji Kuwanan, so a
                // copy in hand makes Kuwanan the first tower to establish.
                const shukujoDiff = (hasShukujo && b.id === 'doji-kuwanan' ? 1 : 0) -
                    (hasShukujo && a.id === 'doji-kuwanan' ? 1 : 0);
                if(shukujoDiff !== 0) {
                    return shukujoDiff;
                }
                return ranking.indexOf(a.id) - ranking.indexOf(b.id);
            });
        return candidates[0] || null;
    }

    hasVisibleTower(playable: any[]): boolean {
        return playable.some((card) => this.isTowerCharacter(card.id));
    }

    // At most two cheap helpers. When a tower is already visible but cannot
    // yet receive its three-fate minimum, the policy caps this at a one-cost
    // helper so it can still contest an unopposed conflict without draining
    // the next round's tower fund.
    pickSupportCharacter(playable: any[], costs: Record<string, number>, fate: number, board: any[], maxCost = Number.POSITIVE_INFINITY): any {
        const supportCount = board.filter((card) => card.type === 'character' && !this.isTowerCharacter(card.id)).length;
        if(supportCount >= this.profile.supportTargetCount) {
            return null;
        }
        return playable
            .filter((card) => card.type === 'character' && !this.isTowerCharacter(card.id))
            .filter((card) => (costs[card.uuid] ?? 0) <= maxCost)
            .filter((card) => fate - (costs[card.uuid] ?? 0) >= 1)
            .sort((a, b) => (costs[a.uuid] ?? 0) - (costs[b.uuid] ?? 0) ||
                String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    shouldKeepDynasty(cardId: string | undefined, board: any[]): boolean {
        return this.needsTower(board) && this.isTowerCharacter(cardId);
    }

    desiredAdditionalFate(cardId: string | undefined, fate: number, playCost?: number): number | null {
        if(!this.isTowerCharacter(cardId)) {
            return null;
        }
        const available = Math.max(fate - (playCost ?? 0), 0);
        return Math.min(available, this.profile.towerFateMax);
    }

    // The human line uses the fire ring to honor a built-up tower. Raise fire
    // above generic earth/void while at least one preferred tower is still
    // unhonored; accumulated fate on a ring remains the global first priority.
    ringBonus(element: string, board: any[]): number {
        return element === 'fire' && board.some((card) =>
            this.isTowerCharacter(card.id) && !card.isHonored) ? 30 : 0;
    }

    isTowerAttachment(cardId: string | undefined): boolean {
        return !!cardId && this.profile.towerAttachments.includes(cardId);
    }

    restrictedCount(card: any): number {
        return (card.attachments || []).filter((attachment: any) =>
            this.profile.restrictedAttachments.includes(attachment.id)).length;
    }

    // Restricted cards spread across towers with open slots. Non-restricted
    // duel tools prefer the tower with most fate. Shukujo is Kuwanan-only:
    // attaching it elsewhere gives stats but loses the Champion Action.
    pickAttachmentTarget(mine: any[], attachmentId: string | undefined): any {
        if(!this.isTowerAttachment(attachmentId)) {
            return null;
        }
        let candidates = mine.filter((card) => this.isTowerCharacter(card.id));
        if(attachmentId === 'shukujo') {
            candidates = candidates.filter((card) => card.id === 'doji-kuwanan');
        }
        if(attachmentId === 'iaijutsu-master') {
            // Kuwanan is the one preferred tower without printed Duelist. Seal
            // of the Crane grants that trait; without it Iaijutsu Master cannot
            // legally attach to him.
            candidates = candidates.filter((card) => card.id !== 'doji-kuwanan' ||
                (card.attachments || []).some((attachment: any) => attachment.id === 'seal-of-the-crane'));
        }
        const restricted = !!attachmentId && this.profile.restrictedAttachments.includes(attachmentId);
        if(restricted) {
            candidates = candidates.filter((card) => this.restrictedCount(card) < 2);
        }
        const ranking = this.profile.keyCharacters;
        return candidates.sort((a, b) => {
            if(restricted) {
                const slotsDiff = this.restrictedCount(a) - this.restrictedCount(b);
                if(slotsDiff !== 0) {
                    return slotsDiff;
                }
            }
            const fateDiff = (Number(b.fate) || 0) - (Number(a.fate) || 0);
            if(fateDiff !== 0) {
                return fateDiff;
            }
            return ranking.indexOf(a.id) - ranking.indexOf(b.id);
        })[0] || null;
    }

    // Duel prompts still use the strongest ranked durable duelist.
    pickKeyCharacter(mine: any[]): any {
        const ranking = this.profile.keyCharacters;
        const ranked = mine
            .filter((card) => card.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || null;
    }
}
