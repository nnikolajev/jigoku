// Attachment-tower playstyle for Dragon "Arsenal" / "Dragon Attachments"
// (EmeraldDB ce8df8ae, revision 0.5). Iron Mountain Castle raises the
// Restricted cap on Dragon characters to three; the deck invests deeply in two
// durable bodies, searches for attachments, and repeatedly readies Niten Master
// with Weapons.
//
// Revision 0.5 changes the shape of the plan in four ways, and each has its own
// section below:
//   * the two towers are now SPECIALISED — one military, one political —
//     because three Pathfinder's Blades on one body is +3 military and on three
//     bodies is +1 three times (`towerAxis`);
//   * Agasha Shunsen converts claimed rings into a tutored attachment, but only
//     in the LAST conflict of the round, because the rings are worth something
//     until then (`shunsen`);
//   * The Stone of Sorrows locks the opponent out of ring fate while its bearer
//     is READY, which is the payoff half of Revered Bonsho (`stoneOfSorrows`);
//   * Waterfall Tattoo readies its bearer when one of our provinces is
//     revealed, which makes the bearer free to attack — see `RevealReadyPolicy`
//     for the defense-preservation half of that.

export type AttachmentAxis = 'military' | 'political' | 'either';

export interface AttachmentSkillBonus {
    military: number;
    political: number;
}

/** Agasha Shunsen: claimed rings -> a tutored attachment. */
export interface ShunsenProfile {
    enabled: boolean;
    cardId: string;
    // Only buy the body while a tower is already standing: his whole ability
    // is "put an attachment on a character you control", which is worth the
    // three fate only when there is a body worth decorating.
    requireTowerOnBoard: boolean;
    // Hold the Action until no conflict opportunity remains on either side.
    // A claimed ring is worth something for as long as another conflict can be
    // fought over the rest of the pool; in the last conflict it is not.
    lastConflictOnly: boolean;
    // Never return more rings than the most expensive attachment in the deck
    // costs. Every ring past that buys nothing.
    maxRingsReturned: number;
    // Search order, best first. Deliberately NOT sorted by cost: the order is
    // what makes the ring budget worth spending in full, because the top entry
    // is the only cost-3 card in the list.
    searchOrder: string[];
    // Self-Understanding's gained reaction resolves EVERY ring in our claimed
    // pool after its bearer wins a conflict. Shunsen's cost empties that pool.
    // With this on, hold Shunsen while a live Self-Understanding payoff is on
    // the table.
    respectSelfUnderstanding: boolean;
    selfUnderstandingId: string;
}

/** The Stone of Sorrows: opponents cannot take fate from rings. */
export interface StoneOfSorrowsProfile {
    enabled: boolean;
    cardId: string;
    // Attach in the pre-conflict window once this much fate is sitting on the
    // rings — that is the fate the lock is denying.
    minRingFate: number;
    // With no fate on the rings the card is a +1/+1 Restricted slot. Hold it
    // unless that +1 actually changes the result of the running conflict.
    holdUnlessFlipsConflict: boolean;
    // Revered Bonsho pushes the fate-phase fate onto the unclaimed rings every
    // round, so the lock compounds. While a Bonsho is in play the bearer is
    // worth keeping READY at home rather than spending it in a conflict.
    bonshoHoldingId: string;
    keepBearerReadyWithBonsho: boolean;
}

/** Waterfall Tattoo: ready the bearer after one of our provinces is revealed. */
export interface WaterfallTattooProfile {
    enabled: boolean;
    cardId: string;
    // Attach to a BOWED body — a ready one gains nothing from the reaction.
    requireBowedBearer: boolean;
    // The reaction needs the opponent to declare, so they must still have a
    // conflict opportunity...
    requireOpponentConflictOpportunity: boolean;
    // ...and a ready body legally able to declare one of the types they have
    // left. A character with a dash in that skill cannot declare it.
    requireOpponentEligibleAttacker: boolean;
    // Require a facedown province of ours for the reveal to happen at all.
    requireFacedownProvince: boolean;
}

/** Agasha Taiko: a province that cannot be attacked this round. */
export interface AgashaTaikoProfile {
    enabled: boolean;
    cardId: string;
    // Protect in this order, stepping to the next entry only once the one
    // before it is broken. Ids absent from the deck are skipped.
    provincePriority: string[];
}

/** Illustrious Forge: a top-five attachment put straight into play. */
export interface IllustriousForgeProfile {
    enabled: boolean;
    cardId: string;
    // Ties on skill are broken by this order.
    tiePriority: string[];
}

export interface DragonAttachmentProfile {
    towerTargetCount: number;
    supportTargetCount: number;
    towerFateMin: number;
    towerFateMax: number;
    towerCharacters: string[];
    dragonCharacters: string[];
    supportCharacters: string[];
    attachments: string[];
    stackableAttachments: string[];
    restrictedAttachments: string[];
    weaponAttachments: string[];
    holdWeaponsForReadyNiten: boolean;
    attachmentPriority: string[];
    yokuniCopyPriority: string[];
    // ---- revision 0.5 ----
    // Build ONE military tower and ONE political tower instead of spreading
    // every attachment evenly. Three Pathfinder's Blades on one body is +3
    // military; on three bodies it is +1, three times, and neither number wins
    // a conflict the deck was not already winning.
    axisTowerSplit: boolean;
    // Printed skill bonuses, keyed by attachment id. The serialized board
    // carries no card text and a card still in the conflict DECK has no
    // summary at all, so the search prompts (Illustrious Forge, Agasha
    // Shunsen, Agasha Swordsmith) cannot price a candidate without this.
    attachmentSkillBonuses: Record<string, AttachmentSkillBonus>;
    // Characters whose printed cost is 2 or less — Elegant Tessen's enter-play
    // ready is worth more on one of these than tower stats are.
    cheapCharacters: string[];
    // Attachments that GRANT a triggered ability to their bearer. The engine
    // offers such an ability on the CHARACTER (`whileAttached` + `gainAbility`),
    // so the reaction window shows a body whose own playbook hint may be
    // missing or sub-6 — which made Self-Understanding's "resolve every claimed
    // ring" reaction unreachable on two of this deck's own characters. The
    // policy credits the bearer with the granting card's hint instead.
    grantedAbilityAttachmentIds: string[];
    shunsen: ShunsenProfile;
    stoneOfSorrows: StoneOfSorrowsProfile;
    waterfallTattoo: WaterfallTattooProfile;
    agashaTaiko: AgashaTaikoProfile;
    illustriousForge: IllustriousForgeProfile;
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
        'niten-adept', 'stoic-rival', 'doomed-shugenja',
        'agasha-swordsmith', 'kitsuki-counselor', 'agasha-shunsen',
        'agasha-taiko'
    ],
    supportCharacters: [
        'agasha-swordsmith', 'agasha-shunsen', 'niten-adept', 'agasha-taiko',
        'stoic-rival', 'kitsuki-counselor', 'doomed-shugenja'
    ],
    attachments: [
        'tetsubo-of-blood', 'jade-tetsubo', 'adopted-kin', 'daimyo-s-favor',
        'ancestral-daisho', 'elegant-tessen', 'finger-of-jade', 'fine-katana',
        'inscribed-tanto', 'ornate-fan', 'pathfinder-s-blade',
        'kitsuki-s-method', 'self-understanding', 'the-stone-of-sorrows',
        'waterfall-tattoo'
    ],
    // Pure stat attachments can usefully stack. Every other attachment has a
    // redundant named ability, so distribute it before playing another copy.
    stackableAttachments: [
        'fine-katana', 'ornate-fan', 'ancestral-daisho', 'kitsuki-s-method',
        'pathfinder-s-blade'
    ],
    restrictedAttachments: [
        'tetsubo-of-blood', 'jade-tetsubo', 'ancestral-daisho',
        'elegant-tessen', 'fine-katana', 'ornate-fan', 'kitsuki-s-method',
        'self-understanding'
    ],
    weaponAttachments: [
        'tetsubo-of-blood', 'jade-tetsubo', 'ancestral-daisho',
        'elegant-tessen', 'fine-katana', 'inscribed-tanto', 'pathfinder-s-blade'
    ],
    holdWeaponsForReadyNiten: true,
    attachmentPriority: [
        // Establish the reusable reducer before paying for either Tetsubo.
        'daimyo-s-favor', 'tetsubo-of-blood', 'jade-tetsubo', 'adopted-kin',
        'self-understanding', 'the-stone-of-sorrows', 'ancestral-daisho',
        'elegant-tessen', 'finger-of-jade', 'waterfall-tattoo',
        'pathfinder-s-blade', 'fine-katana', 'kitsuki-s-method', 'ornate-fan',
        'inscribed-tanto'
    ],
    yokuniCopyPriority: [
        'niten-master', 'mirumoto-raitsugu', 'agasha-shunsen', 'solitary-hero'
    ],
    axisTowerSplit: true,
    attachmentSkillBonuses: {
        'tetsubo-of-blood': { military: 4, political: 0 },
        'jade-tetsubo': { military: 3, political: 0 },
        'self-understanding': { military: 0, political: 3 },
        'fine-katana': { military: 2, political: 0 },
        'ancestral-daisho': { military: 2, political: 0 },
        'ornate-fan': { military: 0, political: 2 },
        'kitsuki-s-method': { military: 0, political: 2 },
        'elegant-tessen': { military: 1, political: 1 },
        'waterfall-tattoo': { military: 1, political: 1 },
        'the-stone-of-sorrows': { military: 1, political: 1 },
        'inscribed-tanto': { military: 1, political: 0 },
        'pathfinder-s-blade': { military: 1, political: 0 },
        'adopted-kin': { military: 0, political: 0 },
        'daimyo-s-favor': { military: 0, political: 0 },
        'finger-of-jade': { military: 0, political: 0 }
    },
    cheapCharacters: [
        'niten-adept', 'stoic-rival', 'doomed-shugenja', 'agasha-swordsmith',
        'kitsuki-counselor', 'agasha-taiko'
    ],
    grantedAbilityAttachmentIds: ['self-understanding'],
    shunsen: {
        enabled: true,
        cardId: 'agasha-shunsen',
        requireTowerOnBoard: true,
        lastConflictOnly: true,
        maxRingsReturned: 3,
        searchOrder: [
            'self-understanding', 'waterfall-tattoo', 'jade-tetsubo',
            'the-stone-of-sorrows', 'tetsubo-of-blood'
        ],
        respectSelfUnderstanding: true,
        selfUnderstandingId: 'self-understanding'
    },
    stoneOfSorrows: {
        enabled: true,
        cardId: 'the-stone-of-sorrows',
        minRingFate: 1,
        holdUnlessFlipsConflict: true,
        bonshoHoldingId: 'revered-bonsho',
        keepBearerReadyWithBonsho: true
    },
    waterfallTattoo: {
        enabled: true,
        cardId: 'waterfall-tattoo',
        requireBowedBearer: true,
        requireOpponentConflictOpportunity: true,
        requireOpponentEligibleAttacker: true,
        requireFacedownProvince: true
    },
    agashaTaiko: {
        enabled: true,
        cardId: 'agasha-taiko',
        // `public-forum` is not in revision 0.5 and is skipped; it is kept
        // first so the owner's stated order survives a future deck revision
        // that adds it back.
        provincePriority: ['public-forum', 'pilgrimage', 'manicured-garden']
    },
    illustriousForge: {
        enabled: true,
        cardId: 'illustrious-forge',
        tiePriority: [
            'waterfall-tattoo', 'the-stone-of-sorrows', 'elegant-tessen',
            'finger-of-jade', 'daimyo-s-favor', 'adopted-kin'
        ]
    }
};

export interface ShunsenContext {
    // Conflict opportunities left AFTER the running conflict, both sides.
    myConflictsRemaining: number;
    opponentConflictsRemaining: number;
    // Rings we currently hold claimed.
    claimedRingCount: number;
    // Is a Self-Understanding of ours attached to a body PARTICIPATING in the
    // running conflict? Returning the rings empties the pool its reaction
    // reads.
    selfUnderstandingParticipating: boolean;
}

export interface WaterfallTattooContext {
    myCharacters: any[];
    // Their conflict opportunities, and the per-axis split.
    opponentConflictsRemaining: number;
    opponentMilitaryRemaining: number;
    opponentPoliticalRemaining: number;
    // Their ready bodies, with LIVE skills; `null` on an axis means a dash,
    // which cannot declare that conflict type.
    opponentReady: Array<{ military: number | null; political: number | null }>;
    // Unbroken facedown provinces of ours. Without one there is nothing to
    // reveal and the reaction never fires.
    facedownProvinceCount: number;
}

export interface StoneOfSorrowsContext {
    // Total fate sitting on the rings right now.
    ringFate: number;
    // A conflict is running.
    activeConflict: boolean;
    // Extra skill our side still needs for the running conflict to change its
    // result; null when no conflict is running.
    skillNeeded: number | null;
    // Do we control a Revered Bonsho? Its fate-phase push is what makes the
    // lock compound.
    bonshoInPlay: boolean;
}

export class DragonAttachmentTactics {
    // Public so the policy can read card ids off the profile instead of
    // hard-coding them at the prompt, the same way `CrabSacrificeTactics`
    // exposes its own.
    readonly profile: DragonAttachmentProfile;

    constructor(profile: DragonAttachmentProfile) {
        this.profile = profile;
    }

    // Is this a body the deck wants to stack attachments onto?
    isTowerCharacter(cardId: string | undefined): boolean {
        return !!cardId && this.profile.towerCharacters.includes(cardId);
    }

    // Do we still lack the target number of tower bodies? This deck's whole
    // plan needs a bearer before its attachments are worth anything.
    needsTower(board: any[]): boolean {
        return (board || []).filter((card) => this.isTowerCharacter(card.id)).length < this.profile.towerTargetCount;
    }

    // Is a tower already present in the given card list?
    hasVisibleTower(cards: any[]): boolean {
        return (cards || []).some((card) => this.isTowerCharacter(card.id));
    }

    // Keep a revealed dynasty card during a province refresh only while we
    // still need a tower and this card is one.
    shouldKeepDynasty(cardId: string | undefined, board: any[]): boolean {
        return this.needsTower(board) && this.isTowerCharacter(cardId);
    }

    shouldMulliganDynasty(card: any): boolean {
        // Opening provinces must expose at least one body worth three fate.
        // Support characters and holdings are replaceable; keep every ranked
        // tower so the first affordable one can become the attachment bearer.
        return !!card && !this.isTowerCharacter(card.id);
    }

    // Buy the best affordable tower. Returns null once we have enough.
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

    // Buy a non-tower body, up to the profile's support quota — the tower
    // needs a board around it or it just gets outnumbered.
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
            .filter((card) => this.canBuyBody(card.id, board))
            .filter((card) => fate - (costs[card.uuid] ?? 0) >= 1)
            .sort((a, b) => (costs[a.uuid] ?? 0) - (costs[b.uuid] ?? 0) ||
                rank(a.id) - rank(b.id) || String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    /**
     * Deck-specific gate on buying a BODY at all.
     *
     * Agasha Shunsen costs three fate and every point of his value is an
     * attachment landing on a character worth decorating. With no tower
     * standing there is nothing to decorate, and the three fate is better spent
     * becoming the tower. Everything else is unconditional.
     */
    canBuyBody(cardId: string | undefined, board: any[]): boolean {
        const shunsen = this.profile.shunsen;
        if(!shunsen.enabled || !shunsen.requireTowerOnBoard || cardId !== shunsen.cardId) {
            return true;
        }
        return this.hasVisibleTower(board || []);
    }

    // Extra fate on a tower so it survives long enough to be worth its
    // attachments. Null for anything that is not a tower.
    desiredAdditionalFate(cardId: string | undefined, fate: number, playCost?: number): number | null {
        if(!this.isTowerCharacter(cardId)) {
            return null;
        }
        const available = Math.max(fate - (playCost ?? 0), 0);
        return Math.min(available, this.profile.towerFateMax);
    }

    // Is this one of the deck's tracked attachments?
    isAttachment(cardId: string | undefined): boolean {
        return !!cardId && this.profile.attachments.includes(cardId);
    }

    // Restricted attachments are capped per character by the game rules.
    isRestricted(cardId: string | undefined): boolean {
        return !!cardId && this.profile.restrictedAttachments.includes(cardId);
    }

    // May more than one copy sit on the same bearer?
    canStackAttachment(cardId: string | undefined): boolean {
        return !!cardId && this.profile.stackableAttachments.includes(cardId);
    }

    // Weapon attachments — the ones Niten cares about.
    isWeapon(cardId: string | undefined): boolean {
        return !!cardId && this.profile.weaponAttachments.includes(cardId);
    }

    /** Printed skill bonus for an attachment, on one axis. */
    attachmentBonus(cardId: string | undefined, axis: 'military' | 'political'): number {
        const bonus = cardId ? this.profile.attachmentSkillBonuses[cardId] : undefined;
        return Math.max(0, Number(bonus?.[axis]) || 0);
    }

    /**
     * Which tower does this attachment belong on?
     *
     * A card that buffs only one axis belongs on the body being built for that
     * axis. A card that buffs both equally, or neither, is `either` and goes
     * wherever the ordinary tower ranking sends it.
     */
    attachmentAxis(cardId: string | undefined): AttachmentAxis {
        const military = this.attachmentBonus(cardId, 'military');
        const political = this.attachmentBonus(cardId, 'political');
        if(military > political) {
            return 'military';
        }
        if(political > military) {
            return 'political';
        }
        return 'either';
    }

    // How many restricted attachments this bearer already carries.
    restrictedCount(card: any): number {
        return (card?.attachments || []).filter((attachment: any) =>
            this.isRestricted(attachment.id)).length;
    }

    // The legal restricted limit for this bearer: 3 for a Dragon character,
    // 2 otherwise.
    restrictedCap(card: any): number {
        return card?.id && this.profile.dragonCharacters.includes(card.id) ? 3 : 2;
    }

    // Does this bearer already have that specific attachment?
    hasAttachment(card: any, attachmentId: string): boolean {
        return (card?.attachments || []).some((attachment: any) => attachment.id === attachmentId);
    }

    // Rank within the deck's attachment preference order; higher is better.
    attachmentPriority(cardId: string | undefined): number {
        if(!cardId) {
            return 0;
        }
        const index = this.profile.attachmentPriority.indexOf(cardId);
        return index < 0 ? 0 : this.profile.attachmentPriority.length - index;
    }

    // Best attachment to play, by priority then cost then uuid.
    pickAttachment(cards: any[]): any {
        return (cards || []).slice().sort((a, b) =>
            this.attachmentPriority(b.id) - this.attachmentPriority(a.id) ||
            (Number(b.cost) || 0) - (Number(a.cost) || 0) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    // ==================================================================
    // Illustrious Forge
    // ==================================================================

    /**
     * The Forge fires when the province it sits under is REVEALED, i.e. at the
     * declaration of a conflict against it — so the conflict type is already
     * known and the right card is the one that adds the most skill on THAT
     * axis. Ties (three +1/+1 cards and three +0/+0 ones) fall to the owner's
     * stated order.
     */
    pickForgeAttachment(cards: any[], conflictType?: string): any {
        const axis: 'military' | 'political' = conflictType === 'political' ? 'political' : 'military';
        const tie = (id: string) => {
            const index = this.profile.illustriousForge.tiePriority.indexOf(id);
            return index < 0 ? this.profile.illustriousForge.tiePriority.length : index;
        };
        return (cards || []).slice().sort((a, b) =>
            this.attachmentBonus(b.id, axis) - this.attachmentBonus(a.id, axis) ||
            tie(a.id) - tie(b.id) ||
            this.attachmentPriority(b.id) - this.attachmentPriority(a.id) ||
            String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    // ==================================================================
    // Agasha Taiko
    // ==================================================================

    /**
     * "That province cannot be attacked this round." Protect the deck's most
     * valuable province, stepping down the list only once the entry before it
     * is already broken — a broken province cannot be attacked anyway, so
     * protecting it is the one strictly wasted choice.
     */
    pickTaikoProvince(provinces: any[]): any {
        const taiko = this.profile.agashaTaiko;
        if(!taiko.enabled) {
            return null;
        }
        const mine = (provinces || []).filter((card) => card && card.uuid);
        for(const id of taiko.provincePriority) {
            const match = mine.find((card) => card.id === id && !card.isBroken);
            if(match) {
                return match;
            }
            // A province still in the deck (or already broken) is skipped and
            // the next entry is considered, which is exactly the owner's rule.
        }
        // Nothing on the list is available: protect the strongest unbroken
        // province we still hold rather than declining a free effect.
        return mine.filter((card) => !card.isBroken)
            .sort((a, b) => (Number(b?.strengthSummary?.stat) || 0) - (Number(a?.strengthSummary?.stat) || 0) ||
                String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    // ==================================================================
    // Agasha Shunsen
    // ==================================================================

    /**
     * Fire the Action now?
     *
     * Returning a claimed ring costs everything that ring would still have
     * done this round — it goes back to the unclaimed pool where the opponent
     * can contest it again — so the ability is held until neither player has a
     * conflict opportunity left. In that window the rings are worth nothing and
     * the attachment is worth its printed line.
     */
    shouldUseShunsen(ctx: ShunsenContext): boolean {
        const shunsen = this.profile.shunsen;
        if(!shunsen.enabled || Math.max(0, Number(ctx?.claimedRingCount) || 0) === 0) {
            return false;
        }
        if(shunsen.lastConflictOnly &&
            (Math.max(0, Number(ctx?.myConflictsRemaining) || 0) > 0 ||
                Math.max(0, Number(ctx?.opponentConflictsRemaining) || 0) > 0)) {
            return false;
        }
        // Self-Understanding resolves EVERY claimed ring after its bearer wins.
        // Emptying the pool to fetch one attachment throws that away.
        if(shunsen.respectSelfUnderstanding && ctx?.selfUnderstandingParticipating) {
            return false;
        }
        return true;
    }

    /** How many claimed rings to hand back: as many as possible, up to the cap. */
    shunsenRingsToReturn(claimedRingCount: number): number {
        return Math.max(0, Math.min(
            Math.max(0, Math.floor(Number(claimedRingCount) || 0)),
            Math.max(0, Math.floor(this.profile.shunsen.maxRingsReturned))
        ));
    }

    /**
     * The attachment to tutor, given how many rings were actually returned.
     *
     * The engine has already filtered the menu to attachments costing no more
     * than the returned count, but the bot still ranks: the owner's order puts
     * the only cost-3 card first, which is what makes returning the third ring
     * worth doing.
     */
    pickShunsenAttachment(cards: any[], ringsReturned?: number): any {
        const budget = Number.isFinite(Number(ringsReturned))
            ? Math.max(0, Number(ringsReturned))
            : Number.POSITIVE_INFINITY;
        const order = this.profile.shunsen.searchOrder;
        const rank = (id: string) => {
            const index = order.indexOf(id);
            return index < 0 ? order.length : index;
        };
        const affordable = (card: any) => {
            const cost = Number(card?.cost ?? card?.printedCost);
            return !Number.isFinite(cost) || cost <= budget;
        };
        return (cards || []).filter((card) => card && card.uuid && affordable(card))
            .sort((a, b) => rank(a.id) - rank(b.id) ||
                this.attachmentPriority(b.id) - this.attachmentPriority(a.id) ||
                (Number(b.cost ?? b.printedCost) || 0) - (Number(a.cost ?? a.printedCost) || 0) ||
                String(a.uuid || '').localeCompare(String(b.uuid || '')))[0] || null;
    }

    /**
     * Which body wears the tutored attachment.
     *
     * A body with no fate on it is discarded at the end of the round, taking
     * the attachment with it, so the tower is only the right answer while it
     * still has fate. Otherwise the strongest body that DOES have fate.
     */
    pickShunsenTarget(mine: any[], conflictType?: string): any {
        const axis: 'military' | 'political' = conflictType === 'political' ? 'political' : 'military';
        const characters = (mine || []).filter((card) => card && card.uuid &&
            (card.type === 'character' || card.id));
        const withFate = characters.filter((card) => (Number(card.fate) || 0) > 0);
        const towers = withFate.filter((card) => this.isTowerCharacter(card.id));
        const rank = (id: string) => {
            const index = this.profile.towerCharacters.indexOf(id);
            return index < 0 ? this.profile.towerCharacters.length : index;
        };
        if(towers.length > 0) {
            return towers.slice().sort((a, b) => rank(a.id) - rank(b.id) ||
                (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
                String(a.uuid).localeCompare(String(b.uuid)))[0];
        }
        const pool = withFate.length > 0 ? withFate : characters;
        return pool.slice().sort((a, b) =>
            this.liveSkill(b, axis) - this.liveSkill(a, axis) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    // ==================================================================
    // The Stone of Sorrows
    // ==================================================================

    /**
     * "While attached character is ready, opponents cannot remove or gain fate
     * from rings."
     *
     * With fate sitting on the rings that is a real denial, and it compounds
     * every round a Revered Bonsho pushes the fate-phase fate onto them. With
     * the rings empty the card is a +1/+1 Restricted slot, which is only worth
     * a card when it changes the result of the conflict on the table.
     */
    shouldPlayStoneOfSorrows(ctx: StoneOfSorrowsContext): boolean {
        const stone = this.profile.stoneOfSorrows;
        if(!stone.enabled) {
            return true;
        }
        const ringFate = Math.max(0, Number(ctx?.ringFate) || 0);
        if(ringFate >= Math.max(0, stone.minRingFate) || ctx?.bonshoInPlay) {
            return true;
        }
        if(!stone.holdUnlessFlipsConflict) {
            return true;
        }
        // No fate to lock: only worth it as a +1 that flips the conflict.
        // `skillNeeded` is null outside a conflict, and null compares false
        // against both bounds, so no separate emptiness test is needed.
        const needed = ctx?.skillNeeded;
        return !!ctx?.activeConflict && needed !== null && needed !== undefined &&
            needed > 0 && needed <= 1;
    }

    /**
     * With a Revered Bonsho in play the Stone's bearer is worth more READY at
     * home than committed: the lock only holds while the bearer is unbowed, and
     * a bowed bearer hands the opponent every fate the Bonsho has stacked up.
     */
    stoneBearerStaysHome(card: any, bonshoInPlay: boolean): boolean {
        const stone = this.profile.stoneOfSorrows;
        return !!stone.enabled && !!stone.keepBearerReadyWithBonsho && !!bonshoInPlay &&
            this.hasAttachment(card, stone.cardId);
    }

    // ==================================================================
    // Waterfall Tattoo
    // ==================================================================

    /**
     * Attach it BEFORE the opponent declares, onto a bowed body.
     *
     * The reaction reads "After a province you control is revealed", and the
     * opponent's declaration is what reveals one. So the card converts a bowed
     * body into a defender for the conflict that is about to be declared — but
     * only when all three legs hold: we have a bowed body, they still have a
     * conflict opportunity, and they have a ready body legally able to declare
     * one of the types they have left.
     */
    waterfallTattooBearer(ctx: WaterfallTattooContext): any {
        const tattoo = this.profile.waterfallTattoo;
        if(!tattoo.enabled) {
            return null;
        }
        if(tattoo.requireFacedownProvince &&
            Math.max(0, Number(ctx?.facedownProvinceCount) || 0) === 0) {
            return null;
        }
        if(tattoo.requireOpponentConflictOpportunity &&
            Math.max(0, Number(ctx?.opponentConflictsRemaining) || 0) === 0) {
            return null;
        }
        if(tattoo.requireOpponentEligibleAttacker && !this.opponentCanDeclare(ctx)) {
            return null;
        }
        // Waterfall Tattoo is NOT Restricted, so the per-character cap only
        // applies if the profile has classified it as one.
        const needsRestrictedSlot = this.isRestricted(tattoo.cardId);
        const candidates = (ctx?.myCharacters || []).filter((card) => card && card.uuid &&
            (!tattoo.requireBowedBearer || card.bowed) &&
            !this.hasAttachment(card, tattoo.cardId) &&
            (!needsRestrictedSlot || this.restrictedCount(card) < this.restrictedCap(card)));
        if(candidates.length === 0) {
            return null;
        }
        // The bearer that gives the most back when it stands up again.
        return candidates.slice().sort((a, b) =>
            Math.max(this.liveSkill(b, 'military'), this.liveSkill(b, 'political')) -
                Math.max(this.liveSkill(a, 'military'), this.liveSkill(a, 'political')) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0];
    }

    /**
     * Can the opponent legally declare any conflict they have left? A character
     * with a dash in a skill cannot declare that conflict type, so a board of
     * pure courtiers with only a military opportunity left declares nothing.
     */
    opponentCanDeclare(ctx: WaterfallTattooContext): boolean {
        const ready = (ctx?.opponentReady || []);
        if(ready.length === 0) {
            return false;
        }
        const military = Number(ctx?.opponentMilitaryRemaining);
        const political = Number(ctx?.opponentPoliticalRemaining);
        const both: Array<'military' | 'political'> = ['military', 'political'];
        const typed = Number.isFinite(military) || Number.isFinite(political);
        const remaining = both.filter((axis) => axis === 'military' ? military > 0 : political > 0);
        // Forced/extra conflicts can leave both typed counters at zero while
        // the aggregate stays positive, so an empty split means "either axis".
        const usable = typed && remaining.length > 0 ? remaining : both;
        return usable.some((axis) => ready.some((card) => card && card[axis] !== null &&
            card[axis] !== undefined));
    }

    // ==================================================================
    // Attachment targeting
    // ==================================================================

    // Which of our characters this attachment goes on, respecting the
    // restricted cap, stacking rules and any preferred bearer.
    pickAttachmentTarget(mine: any[], attachmentId: string | undefined, preferredBearerUuid?: string, yokuniCopiedNiten = false, preferParticipants = false): any {
        if(!this.isAttachment(attachmentId)) {
            return null;
        }
        let candidates = (mine || []).filter((card) => card.type === 'character' || card.id);
        if(this.isRestricted(attachmentId)) {
            candidates = candidates.filter((card) => this.restrictedCount(card) < this.restrictedCap(card));
        }
        if(!this.canStackAttachment(attachmentId)) {
            candidates = candidates.filter((card) => !this.hasAttachment(card, attachmentId!));
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

        // While the running conflict still needs skill from us, the tower list
        // is the wrong ranking: a body at home and a bowed body both add 0, so
        // the weapon has to go on somebody who is actually fighting. Owned by
        // `AttachmentTargetPolicy`; the caller passes its verdict.
        if(preferParticipants) {
            const fighting = candidates.filter((card) => card.inConflict && !card.bowed);
            if(fighting.length > 0) {
                candidates = fighting;
            }
        }

        // Elegant Tessen's enter-play ready is worth more than tower stats on
        // a bowed printed-cost-2-or-less helper.
        if(attachmentId === 'elegant-tessen') {
            const cheapBowed = candidates.filter((card) => card.bowed &&
                this.profile.cheapCharacters.includes(card.id));
            if(cheapBowed.length > 0) {
                return cheapBowed.sort((a, b) => (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
                    String(a.uuid).localeCompare(String(b.uuid)))[0];
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

        // AXIS SPECIALISATION. One body is being built for military and one for
        // political; a single-axis attachment belongs on the matching one, so
        // three Pathfinder's Blades read +3 on one body rather than +1 on
        // three. Only narrows when a matching tower is actually available.
        const axis = this.attachmentAxis(attachmentId);
        if(this.profile.axisTowerSplit && axis !== 'either' && towers.length > 1) {
            const assigned = this.towerAxes(towers);
            const matching = towers.filter((card) => assigned.get(String(card.uuid)) === axis);
            if(matching.length > 0) {
                towers = matching;
            }
        }

        const rank = (id: string) => {
            const index = this.profile.towerCharacters.indexOf(id);
            return index < 0 ? this.profile.towerCharacters.length : index;
        };
        return towers.slice().sort((a, b) => {
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

    /**
     * Assign each candidate body an axis: one military tower, one political
     * tower, and everything after that follows its own lean.
     *
     * The lean is read from the LIVE skill summaries when the board supplies
     * them (they already include every attachment) and falls back to summing
     * the printed bonuses of what is attached, so the rule still works on a
     * synthetic board.
     */
    towerAxes(cards: any[]): Map<string, 'military' | 'political'> {
        const assigned = new Map<string, 'military' | 'political'>();
        const pool = (cards || []).filter((card) => card && card.uuid);
        if(pool.length === 0) {
            return assigned;
        }
        const lean = (card: any) => this.liveSkill(card, 'military') - this.liveSkill(card, 'political');
        const byMilitary = pool.slice().sort((a, b) => lean(b) - lean(a) ||
            this.liveSkill(b, 'military') - this.liveSkill(a, 'military') ||
            String(a.uuid).localeCompare(String(b.uuid)));
        const militaryTower = byMilitary[0];
        assigned.set(String(militaryTower.uuid), 'military');
        const rest = pool.filter((card) => card.uuid !== militaryTower.uuid);
        if(rest.length > 0) {
            const politicalTower = rest.slice().sort((a, b) => lean(a) - lean(b) ||
                this.liveSkill(b, 'political') - this.liveSkill(a, 'political') ||
                String(a.uuid).localeCompare(String(b.uuid)))[0];
            assigned.set(String(politicalTower.uuid), 'political');
            for(const card of rest) {
                if(!assigned.has(String(card.uuid))) {
                    assigned.set(String(card.uuid), lean(card) >= 0 ? 'military' : 'political');
                }
            }
        }
        return assigned;
    }

    /**
     * Live skill on one axis, with the attached-bonus fallback. A dash reads
     * as zero here on purpose: this is a ranking, not a legality check.
     */
    private liveSkill(card: any, axis: 'military' | 'political'): number {
        const summary = axis === 'political' ? card?.politicalSkillSummary : card?.militarySkillSummary;
        const stat = Number(summary?.stat);
        if(Number.isFinite(stat)) {
            return stat;
        }
        const printed = Number(axis === 'political' ? card?.political : card?.military);
        const base = Number.isFinite(printed) ? printed : 0;
        return base + (card?.attachments || []).reduce((total: number, attachment: any) =>
            total + this.attachmentBonus(attachment?.id, axis), 0);
    }

    // Which character's abilities Yokuni should copy, ranked by the profile's
    // copy-priority list and falling back to the supplied scorer.
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

    // Hold a weapon in hand rather than attaching it now, so a ready Niten
    // can use it later. Gated on the profile flag.
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

    // Extra ring value specific to this deck.
    ringBonus(element: string, board: any[], conflictDiscard: any[] = []): number {
        if(element === 'void' && (board || []).some((card) =>
            (card.attachments || []).some((attachment: any) => attachment.id === 'inscribed-tanto'))) {
            return 18;
        }
        // Fire honors a built tower.
        if(element === 'fire' && (board || []).some((card) =>
            this.isTowerCharacter(card.id) && (card.attachments || []).length > 0 && !card.isHonored)) {
            return 22;
        }
        return 0;
    }

    // Which of our characters is wearing the Daimyo's Favor, since its action
    // is paid from the bearer.
    daimyoFavorBearerUuid(source: any, myCharacters: any[]): string | undefined {
        return (myCharacters || []).find((character) =>
            (character.attachments || []).some((attachment: any) => attachment.uuid === source?.uuid))?.uuid;
    }

    // The attachment worth playing at the Favor's reduced cost.
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

    // Fire the Favor only while its bearer is ready and there is an
    // attachment worth the discount.
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

        // Before conflicts, hold a Weapon while Niten is ready so it can ready
        // him later. During a live conflict the Weapon is being played for its
        // current skill swing, so use the available reducer first.
        if(!ctx?.activeConflict &&
            this.shouldHoldWeapon(attachment.id, ctx?.myCharacters || [], !!ctx?.yokuniCopiedNiten)) {
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
