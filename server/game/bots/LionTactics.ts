// Lion swarm tactics for Hayaken no Shiro decks. The current EmeraldDB
// "Lion Swarm" list races with cheap bodies, trades provinces, and preserves
// the board through Feeding an Army / For Greater Glory rather than putting
// fate on every dynasty character.

export interface LionProfile {
    firstRoundBid: number;
    drawBid: number;
    duelBid: number;
    honorFloor: number;
    strongholdReadyTargets: string[];
    towerCharacters: string[];
    strongReadyTargets: string[];
    cheapCharacters: string[];
    bushiCharacters: string[];
    forgeAttachmentRanking: string[];
    feedingArmyMinimum: number;
}

export const LION_DEFAULTS: LionProfile = {
    firstRoundBid: 5,
    drawBid: 2,
    duelBid: 3,
    honorFloor: 4,
    strongholdReadyTargets: [
        'matsu-berserker', 'miwaku-kabe-guard', 'tactician-s-apprentice',
        'ikoma-reservist', 'akodo-gunso', 'akodo-toshiro', 'gifted-tactician',
        'honorable-challenger', 'ikoma-tsanuri', 'ikoma-tsanuri-2', 'matsu-gohei',
        'samurai-of-integrity'
    ],
    // User-selected durable Lion towers. No other Lion character gets extra
    // dynasty fate or tower-first attachment treatment.
    towerCharacters: ['akodo-toturi', 'commander-of-the-legions', 'honored-general'],
    // In Service to My Lord may also ready the deck's strong three-cost body.
    strongReadyTargets: [
        'akodo-toturi', 'commander-of-the-legions', 'honored-general', 'matsu-beiona'
    ],
    cheapCharacters: [
        'ashigaru-levy', 'matsu-berserker', 'akodo-gunso', 'ikoma-tsanuri',
        'ikoma-tsanuri-2', 'matsu-gohei', 'samurai-of-integrity'
    ],
    bushiCharacters: [
        'matsu-berserker', 'akodo-gunso', 'ikoma-tsanuri', 'ikoma-tsanuri-2',
        'matsu-gohei', 'samurai-of-integrity', 'matsu-beiona',
        'commander-of-the-legions', 'honored-general', 'akodo-toturi',
        // Older Hayaken list support.
        'miwaku-kabe-guard', 'tactician-s-apprentice', 'ikoma-reservist',
        'akodo-toshiro', 'gifted-tactician', 'honorable-challenger',
        'unified-company', 'master-tactician', 'matsu-koso', 'akodo-makoto',
        'lion-s-pride-brawler'
    ],
    forgeAttachmentRanking: [
        'shori', 'kamayari', 'fine-katana', 'daidoji-yari', 'elegant-tessen',
        'tactical-ingenuity', 'seal-of-the-lion', 'true-strike-kenjutsu',
        'sashimono', 'ornate-fan'
    ],
    feedingArmyMinimum: 5
};

export class LionTactics {
    private profile: LionProfile;

    constructor(profile: LionProfile) {
        this.profile = profile;
    }

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

    desiredAdditionalFate(cardId: string | undefined): number {
        return !!cardId && this.profile.towerCharacters.includes(cardId) ? 2 : 0;
    }

    isTower(card: any): boolean {
        return !!card?.id && this.profile.towerCharacters.includes(card.id);
    }

    isCheap(card: any): boolean {
        return !!card?.id && this.profile.cheapCharacters.includes(card.id);
    }

    isBushi(card: any): boolean {
        return !!card?.id && this.profile.bushiCharacters.includes(card.id);
    }

    shouldReadyWithStronghold(myCharacters: any[]): boolean {
        return myCharacters.some((card) =>
            card.bowed && card.id && this.profile.strongholdReadyTargets.includes(card.id));
    }

    shouldUseFeedingArmy(myCharacters: any[]): boolean {
        return myCharacters.filter((card) => this.isCheap(card) || card.id === 'matsu-beiona').length >=
            this.profile.feedingArmyMinimum;
    }

    shouldUseProvince(cardId: string, myCharacters: any[], opponentCharacters: any[], hand: any[]): boolean {
        if(cardId === 'dishonorable-assault') {
            return hand.length > 0 && opponentCharacters.some((card) =>
                card.inConflict && !card.isDishonored && this.glory(card) > 0);
        }
        if(cardId === 'weight-of-duty') {
            return myCharacters.some((card) => card.inConflict && this.isCheap(card)) &&
                opponentCharacters.some((card) => card.inConflict && !card.bowed);
        }
        return true;
    }

    pickDynastyCard(cards: any[], costs: Record<string, number>, fate: number, board: any[]): any | null {
        const costOf = (card: any) => costs[card.uuid] ?? 0;
        const affordable = (card: any, extra = 0) => fate >= costOf(card) + extra;

        // Honor a Bushi played this phase before buying another one. `new` is
        // part of Jigoku's player-perspective summary.
        const veterans = cards.find((card) => card.id === 'honored-veterans');
        if(veterans && board.some((card) => card.new && this.isBushi(card) && !card.isHonored && this.glory(card) > 0)) {
            return veterans;
        }

        // Main plan: flood all affordable 0-2 cost bodies first.
        const cheap = cards.filter((card) => card.type === 'character' && this.isCheap(card) && affordable(card))
            .sort((a, b) => costOf(a) - costOf(b) || String(a.uuid).localeCompare(String(b.uuid)));
        if(cheap.length > 0) {
            return cheap[0];
        }

        // Rules authority requires three OTHER Bushi for Beiona's two-fate
        // reaction, so wait for three even though the deck note said two.
        const bushiCount = board.filter((card) => this.isBushi(card)).length;
        const beiona = cards.find((card) => card.id === 'matsu-beiona' && affordable(card));
        if(beiona && bushiCount >= 3) {
            return beiona;
        }

        // Only selected towers are bought as durable units, and only when the
        // pool can pay their printed cost plus exactly two extra fate.
        const tower = cards.filter((card) => card.type === 'character' && this.isTower(card) && affordable(card, 2))
            .sort((a, b) => this.towerRank(a) - this.towerRank(b) || String(a.uuid).localeCompare(String(b.uuid)))[0];
        if(tower) {
            return tower;
        }

        const otherCharacter = cards.filter((card) => card.type === 'character' && affordable(card) &&
            (card.id !== 'matsu-beiona' || bushiCount >= 3))
            .sort((a, b) => costOf(a) - costOf(b) || String(a.uuid).localeCompare(String(b.uuid)))[0];
        if(otherCharacter) {
            return otherCharacter;
        }

        // Spend one fate on the reset only when at least one fate remains to
        // buy a body in the extra no-income dynasty phase.
        return fate >= 2 ? cards.find((card) => card.id === 'a-season-of-war') || null : null;
    }

    pickTower(cards: any[], skill: (card: any) => number): any | null {
        return cards.slice().sort((a, b) =>
            (this.isTower(b) ? 1 : 0) - (this.isTower(a) ? 1 : 0) ||
            this.glory(b) - this.glory(a) || skill(b) - skill(a) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    pickReadyTarget(cards: any[], skill: (card: any) => number): any | null {
        const preferred = cards.filter((card) => card.id && this.profile.strongReadyTargets.includes(card.id));
        return this.pickTower(preferred.length > 0 ? preferred : cards, skill);
    }

    pickCheapSacrifice(cards: any[], skill: (card: any) => number): any | null {
        const cheap = cards.filter((card) => this.isCheap(card));
        const pool = cheap.length > 0 ? cheap : cards;
        return pool.slice().sort((a, b) =>
            (Number(a.fate) || 0) - (Number(b.fate) || 0) || skill(a) - skill(b) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    pickTessenTarget(cards: any[], skill: (card: any) => number): any | null {
        const cheapBowed = cards.filter((card) => card.bowed && this.isCheap(card));
        return this.pickTower(cheapBowed, skill);
    }

    pickForgeAttachment(cards: any[]): any {
        const ranking = this.profile.forgeAttachmentRanking;
        const ranked = cards
            .filter((card) => card.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || cards[0] || null;
    }

    private towerRank(card: any): number {
        return this.profile.towerCharacters.indexOf(card.id);
    }

    private glory(card: any): number {
        const value = Number(card?.glorySummary?.stat);
        return Number.isFinite(value) ? value : 0;
    }
}
