// Attachment-tower playstyle for Dragon "Arsenal" / "Dragon Attachments"
// (EmeraldDB 46aaa220). Iron Mountain Castle raises the Restricted cap on
// Dragon characters to three; the deck invests deeply in two durable bodies,
// searches for attachments, and repeatedly readies Niten Master with Weapons.

export interface DragonAttachmentProfile {
    towerTargetCount: number;
    supportTargetCount: number;
    towerFateMin: number;
    towerFateMax: number;
    towerCharacters: string[];
    dragonCharacters: string[];
    supportCharacters: string[];
    attachments: string[];
    restrictedAttachments: string[];
    weaponAttachments: string[];
    holdWeaponsForReadyNiten: boolean;
    attachmentPriority: string[];
    yokuniCopyPriority: string[];
}

export const DRAGON_ATTACHMENT_DEFAULTS: DragonAttachmentProfile = {
    towerTargetCount: 2,
    supportTargetCount: 3,
    towerFateMin: 3,
    towerFateMax: 4,
    towerCharacters: [
        'togashi-yokuni', 'niten-master', 'mirumoto-raitsugu',
        'agasha-sumiko-2', 'kitsuki-yuikimi', 'solitary-hero'
    ],
    dragonCharacters: [
        'togashi-yokuni', 'niten-master', 'mirumoto-raitsugu',
        'agasha-sumiko-2', 'kitsuki-yuikimi', 'solitary-hero',
        'niten-adept', 'stoic-rival', 'keen-warrior', 'doomed-shugenja',
        'agasha-swordsmith', 'kitsuki-counselor', 'inventive-mirumoto'
    ],
    supportCharacters: [
        'agasha-swordsmith', 'niten-adept', 'inventive-mirumoto',
        'stoic-rival', 'keen-warrior', 'kitsuki-counselor', 'doomed-shugenja',
        'hiruma-skirmisher'
    ],
    attachments: [
        'tetsubo-of-blood', 'jade-tetsubo', 'adopted-kin', 'daimyo-s-favor',
        'ancestral-daisho', 'elegant-tessen', 'finger-of-jade', 'fine-katana',
        'inscribed-tanto', 'ornate-fan', 'pathfinder-s-blade',
        'kitsuki-s-method', 'two-heavens-technique', 'tattooed-wanderer'
    ],
    restrictedAttachments: [
        'tetsubo-of-blood', 'jade-tetsubo', 'ancestral-daisho',
        'elegant-tessen', 'fine-katana', 'ornate-fan', 'kitsuki-s-method'
    ],
    weaponAttachments: [
        'tetsubo-of-blood', 'jade-tetsubo', 'ancestral-daisho',
        'elegant-tessen', 'fine-katana', 'inscribed-tanto', 'pathfinder-s-blade'
    ],
    holdWeaponsForReadyNiten: true,
    attachmentPriority: [
        // Establish the reusable reducer before paying for either Tetsubo.
        'daimyo-s-favor', 'tetsubo-of-blood', 'jade-tetsubo', 'adopted-kin',
        'ancestral-daisho', 'elegant-tessen', 'finger-of-jade',
        'two-heavens-technique', 'pathfinder-s-blade', 'fine-katana',
        'kitsuki-s-method', 'ornate-fan', 'inscribed-tanto', 'tattooed-wanderer'
    ],
    yokuniCopyPriority: [
        'niten-master', 'mirumoto-raitsugu', 'niten-adept', 'solitary-hero'
    ]
};

const COST_TWO_OR_LESS = new Set([
    'niten-adept', 'stoic-rival', 'keen-warrior', 'doomed-shugenja',
    'agasha-swordsmith', 'kitsuki-counselor', 'inventive-mirumoto',
    'hiruma-skirmisher'
]);

export class DragonAttachmentTactics {
    private profile: DragonAttachmentProfile;

    constructor(profile: DragonAttachmentProfile) {
        this.profile = profile;
    }

    isTowerCharacter(cardId: string | undefined): boolean {
        return !!cardId && this.profile.towerCharacters.includes(cardId);
    }

    needsTower(board: any[]): boolean {
        return (board || []).filter((card) => this.isTowerCharacter(card.id)).length < this.profile.towerTargetCount;
    }

    hasVisibleTower(cards: any[]): boolean {
        return (cards || []).some((card) => this.isTowerCharacter(card.id));
    }

    shouldKeepDynasty(cardId: string | undefined, board: any[]): boolean {
        return this.needsTower(board) && this.isTowerCharacter(cardId);
    }

    shouldMulliganDynasty(card: any): boolean {
        // Opening provinces must expose at least one body worth three fate.
        // Support characters and holdings are replaceable; keep every ranked
        // tower so the first affordable one can become the attachment bearer.
        return !!card && !this.isTowerCharacter(card.id);
    }

    pickDynastyTower(playable: any[], costs: Record<string, number>, fate: number, board: any[]): any {
        if(!this.needsTower(board)) {
            return null;
        }
        const rank = (id: string) => this.profile.towerCharacters.indexOf(id);
        return (playable || [])
            .filter((card) => this.isTowerCharacter(card.id))
            .filter((card) => fate >= (costs[card.uuid] ?? 0) + this.profile.towerFateMin)
            .sort((a, b) => rank(a.id) - rank(b.id) ||
                (costs[a.uuid] ?? 0) - (costs[b.uuid] ?? 0) ||
                String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    pickSupportCharacter(playable: any[], costs: Record<string, number>, fate: number, board: any[], maxCost = Number.POSITIVE_INFINITY): any {
        const supportCount = (board || []).filter((card) =>
            card.type === 'character' && !this.isTowerCharacter(card.id)).length;
        if(supportCount >= this.profile.supportTargetCount) {
            return null;
        }
        const rank = (id: string) => {
            const index = this.profile.supportCharacters.indexOf(id);
            return index < 0 ? this.profile.supportCharacters.length : index;
        };
        return (playable || [])
            .filter((card) => card.type === 'character' && !this.isTowerCharacter(card.id))
            .filter((card) => (costs[card.uuid] ?? 0) <= maxCost)
            .filter((card) => fate - (costs[card.uuid] ?? 0) >= 1)
            .sort((a, b) => (costs[a.uuid] ?? 0) - (costs[b.uuid] ?? 0) ||
                rank(a.id) - rank(b.id) || String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    desiredAdditionalFate(cardId: string | undefined, fate: number, playCost?: number): number | null {
        if(!this.isTowerCharacter(cardId)) {
            return null;
        }
        const available = Math.max(fate - (playCost ?? 0), 0);
        return Math.min(available, this.profile.towerFateMax);
    }

    isAttachment(cardId: string | undefined): boolean {
        return !!cardId && this.profile.attachments.includes(cardId);
    }

    isRestricted(cardId: string | undefined): boolean {
        return !!cardId && this.profile.restrictedAttachments.includes(cardId);
    }

    isWeapon(cardId: string | undefined): boolean {
        return !!cardId && this.profile.weaponAttachments.includes(cardId);
    }

    shouldHoldWeapon(cardId: string | undefined, myCharacters: any[], yokuniCopiedNiten = false): boolean {
        if(!this.profile.holdWeaponsForReadyNiten || !this.isWeapon(cardId)) {
            return false;
        }
        const carriers = (myCharacters || []).filter((card) =>
            card.id === 'niten-master' || (yokuniCopiedNiten && card.id === 'togashi-yokuni'));
        // No reaction carrier: play for its printed skill. Any bowed carrier:
        // play one Weapon now to ready it. Hold only while every carrier is
        // already ready, preserving later Weapons for later conflicts.
        return carriers.length > 0 && carriers.every((card) => !card.bowed);
    }

    restrictedCount(card: any): number {
        return (card?.attachments || []).filter((attachment: any) =>
            this.isRestricted(attachment.id)).length;
    }

    restrictedCap(card: any): number {
        return card?.id && this.profile.dragonCharacters.includes(card.id) ? 3 : 2;
    }

    weaponCount(card: any): number {
        return (card?.attachments || []).filter((attachment: any) =>
            this.isWeapon(attachment.id)).length;
    }

    hasAttachment(card: any, attachmentId: string): boolean {
        return (card?.attachments || []).some((attachment: any) => attachment.id === attachmentId);
    }

    attachmentPriority(cardId: string | undefined): number {
        if(!cardId) {
            return 0;
        }
        const index = this.profile.attachmentPriority.indexOf(cardId);
        return index < 0 ? 0 : this.profile.attachmentPriority.length - index;
    }

    pickAttachment(cards: any[]): any {
        return (cards || []).slice().sort((a, b) =>
            this.attachmentPriority(b.id) - this.attachmentPriority(a.id) ||
            (Number(b.cost) || 0) - (Number(a.cost) || 0) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    pickLeastValuable(cards: any[]): any {
        return (cards || []).slice().sort((a, b) =>
            this.attachmentPriority(a.id) - this.attachmentPriority(b.id) ||
            (Number(a.cost) || 0) - (Number(b.cost) || 0) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    pickYokuniCopy(friendlyCards: any[], enemyCards: any[] = [], priorityOf: (card: any) => number = () => 0): any {
        const rank = (id: string) => {
            const index = this.profile.yokuniCopyPriority.indexOf(id);
            return index < 0 ? this.profile.yokuniCopyPriority.length : index;
        };
        const friendly = (friendlyCards || []).filter((card) =>
            card.id && this.profile.yokuniCopyPriority.includes(card.id))
            .sort((a, b) => rank(a.id) - rank(b.id) || String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
        if(friendly) {
            return friendly;
        }

        // Yokuni may copy any other character's printed triggered ability, not
        // just the four Dragon bodies this deck prefers. The target prompt has
        // already removed characters without a legal printed ability, so rank
        // every remaining enemy dynamically and use board value as a stable
        // fallback when no playbook knowledge exists (for example Tengu Sensei).
        return (enemyCards || []).filter((card) => card.id && card.id !== 'togashi-yokuni')
            .sort((a, b) => priorityOf(b) - priorityOf(a) ||
                (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
                (b.attachments || []).length - (a.attachments || []).length ||
                String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    pickAttachmentTarget(mine: any[], attachmentId: string | undefined, preferredBearerUuid?: string, yokuniCopiedNiten = false): any {
        if(!this.isAttachment(attachmentId)) {
            return null;
        }
        let candidates = (mine || []).filter((card) => card.type === 'character' || card.id);
        if(this.isRestricted(attachmentId)) {
            candidates = candidates.filter((card) => this.restrictedCount(card) < this.restrictedCap(card));
        }
        if(attachmentId === 'adopted-kin') {
            candidates = candidates.filter((card) => !this.hasAttachment(card, 'adopted-kin'));
        }
        if(attachmentId === 'daimyo-s-favor') {
            candidates = candidates.filter((card) => !this.hasAttachment(card, 'daimyo-s-favor'));
        }
        if(attachmentId === 'tetsubo-of-blood') {
            // Limited is a per-player play restriction, not a per-character
            // rule; spreading copies is still the better tower line.
            candidates = candidates.filter((card) => !this.hasAttachment(card, 'tetsubo-of-blood'));
        }
        if(attachmentId === 'two-heavens-technique') {
            candidates = candidates.filter((card) => this.profile.dragonCharacters.includes(card.id) || card.id === 'hiruma-skirmisher');
        }
        if(candidates.length === 0) {
            return null;
        }

        // A pending Daimyo's Favor reduction only applies on its own bearer.
        // Force that bearer when legal; never spend the prepared reduction on
        // a different character.
        if(preferredBearerUuid) {
            return candidates.find((card) => card.uuid === preferredBearerUuid) || null;
        }

        // Elegant Tessen's enter-play ready is worth more than tower stats on
        // a bowed printed-cost-2-or-less helper.
        if(attachmentId === 'elegant-tessen') {
            const cheapBowed = candidates.filter((card) => card.bowed && COST_TWO_OR_LESS.has(card.id));
            if(cheapBowed.length > 0) {
                return cheapBowed.sort((a, b) => (Number(b.fate) || 0) - (Number(a.fate) || 0))[0];
            }
        }

        // A Weapon on bowed Niten Master immediately readies the main tower.
        // Yokuni becomes an equivalent carrier after copying Niten this round.
        if(this.isWeapon(attachmentId)) {
            const bowedCarrier = candidates.filter((card) => card.bowed &&
                (card.id === 'niten-master' || (yokuniCopiedNiten && card.id === 'togashi-yokuni')))
                .sort((a, b) => (a.id === 'niten-master' ? -1 : 1) - (b.id === 'niten-master' ? -1 : 1) ||
                    (Number(b.fate) || 0) - (Number(a.fate) || 0))[0];
            if(bowedCarrier) {
                return bowedCarrier;
            }
        }

        let towers = candidates.filter((card) => this.isTowerCharacter(card.id));
        if(towers.length === 0) {
            towers = candidates;
        }
        const rank = (id: string) => {
            const index = this.profile.towerCharacters.indexOf(id);
            return index < 0 ? this.profile.towerCharacters.length : index;
        };
        return towers.slice().sort((a, b) => {
            if(attachmentId === 'two-heavens-technique') {
                const exactDiff = (this.weaponCount(b) === 2 ? 1 : 0) - (this.weaponCount(a) === 2 ? 1 : 0);
                if(exactDiff !== 0) {
                    return exactDiff;
                }
            }
            const adoptedDiff = (this.hasAttachment(b, 'adopted-kin') ? 1 : 0) -
                (this.hasAttachment(a, 'adopted-kin') ? 1 : 0);
            if(attachmentId !== 'adopted-kin' && adoptedDiff !== 0) {
                return adoptedDiff;
            }
            const fateDiff = (Number(b.fate) || 0) - (Number(a.fate) || 0);
            if(fateDiff !== 0) {
                return fateDiff;
            }
            const attachmentDiff = (a.attachments || []).length - (b.attachments || []).length;
            return attachmentDiff !== 0 ? attachmentDiff : rank(a.id) - rank(b.id);
        })[0] || null;
    }

    ringBonus(element: string, board: any[], conflictDiscard: any[] = []): number {
        if(element === 'water' && (board || []).some((card) => card.id === 'inventive-mirumoto') &&
            (conflictDiscard || []).some((card) => this.isAttachment(card.id))) {
            return 28;
        }
        if(element === 'void' && (board || []).some((card) =>
            (card.attachments || []).some((attachment: any) => attachment.id === 'inscribed-tanto'))) {
            return 18;
        }
        // Fire honors a built tower. Alchemical Laboratory does not preserve
        // attachments on our characters: its printed effect applies only to
        // attachments we control on another player's character.
        if(element === 'fire' && (board || []).some((card) =>
            this.isTowerCharacter(card.id) && (card.attachments || []).length > 0 && !card.isHonored)) {
            return 22;
        }
        return 0;
    }

    daimyoFavorBearerUuid(source: any, myCharacters: any[]): string | undefined {
        return (myCharacters || []).find((character) =>
            (character.attachments || []).some((attachment: any) => attachment.uuid === source?.uuid))?.uuid;
    }

    pickDaimyoReducedAttachment(hand: any[], myCharacters: any[], bearerUuid: string | undefined, conflictCosts?: Record<string, number>, yokuniCopiedNiten = false): any {
        if(!bearerUuid) {
            return null;
        }
        const costOf = (card: any) => Number(conflictCosts?.[card.uuid] ?? card.cost ?? card.printedCost);
        return (hand || []).filter((card) =>
            card?.id && card.isPlayableByMe !== false && card.id !== 'daimyo-s-favor' &&
            this.isAttachment(card.id) && this.attachmentPriority(card.id) > 0 &&
            costOf(card) > 0 &&
            this.pickAttachmentTarget(myCharacters, card.id, bearerUuid, yokuniCopiedNiten)?.uuid === bearerUuid)
            .sort((a, b) => this.attachmentPriority(b.id) - this.attachmentPriority(a.id) ||
                costOf(b) - costOf(a) ||
                String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    shouldUseDaimyoFavor(source: any, ctx: any): boolean {
        if(source?.bowed) {
            return false;
        }
        const bearerUuid = this.daimyoFavorBearerUuid(source, ctx?.myCharacters || []);
        const attachment = this.pickDaimyoReducedAttachment(
            ctx?.hand || [],
            ctx?.myCharacters || [],
            bearerUuid,
            ctx?.conflictCosts,
            !!ctx?.yokuniCopiedNiten
        );
        if(!attachment) {
            return false;
        }

        if(this.shouldHoldWeapon(attachment.id, ctx?.myCharacters || [], !!ctx?.yokuniCopiedNiten)) {
            return false;
        }

        // A ready Iron Mountain Castle now sees the selected attachment
        // bearer before costs are paid.  Save Favor when Castle can make a
        // cost-1 attachment (including Tetsubo of Blood) free; combine both
        // reducers for cost-2 attachments such as Jade Tetsubo.
        const castle = ctx?.stronghold;
        const castleReady = castle?.id === 'iron-mountain-castle' && !castle.bowed;
        const cost = Number(ctx?.conflictCosts?.[attachment.uuid] ?? attachment.cost ?? attachment.printedCost);
        return !castleReady || cost > 1;
    }
}
