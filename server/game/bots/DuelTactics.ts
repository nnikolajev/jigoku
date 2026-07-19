// Duel-centric playstyle for the heuristic bot (upgraded Crane Duels,
// EmeraldDB e2e443b5). The deck keeps a FEW durable, honored duelists on the
// board and grinds value out of every duel:
//
// - duels are initiated with our best character on the duel's axis against
//   the strongest opposing character it can safely beat. The shared duel-bid matrix
//   balances winning against both players' honor risk. Kyuden Kakita honors our
//   duelist after every resolved duel,
//   Proving Ground draws, Kakita Blade gains honor, Policy Debate strips
//   their hand, Storied Defeat bows the loser,
// - attachments land on key duelists; singleton utility copies spread before
//   another bearer receives the same card,
// - Vassal Fields sits under the stronghold (its action drains the
//   attacker's fate on the final push); Tsuma plays characters pre-honored;
//   Magistrate Station re-readies honored characters.
//
// All behavior here is DATA-gated: the tactics exist only when the deck's
// profile carries a DuelProfile. Both the upgraded Crane Duels list and the
// current Crane Baseline intentionally opt into this reusable package.

// Tuning knobs for the duel playstyle.
export interface DuelProfile {
    // duel-initiating card id -> the skill axis the duel compares
    duelAxes: Record<string, 'military' | 'political'>;
    // Duel source metadata is kept separate from policy flow so decks can
    // override individual matchup requirements without duplicating selectors.
    duelStartRules: Record<string, {
        challenger: 'source' | 'choose-own';
        targetChooser: 'self' | 'opponent';
        forced?: boolean;
    }>;
    // Player summaries are generated before a prospective duel. Conditional
    // "while in a duel" bonuses are therefore absent and must be projected.
    duelSkillBonuses: {
        characters: Record<string, Partial<Record<'military' | 'political', number>>>;
        attachments: Record<string, Partial<Record<'military' | 'political', number>>>;
    };
    // ranked bearers for the duel attachments and fate investment
    keyCharacters: string[];
    // Other dynasty characters worth preserving with fate, but which must not
    // receive the duel attachment stack (Iron Crane Legion only allows Weapon).
    durableCharacters: string[];
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
    duelAxes: {
        'kakita-dojo': 'military',
        'duelist-training': 'military',
        'daimyo-s-gunbai': 'military',
        'issue-a-challenge': 'military',
        'duel-to-the-death': 'military',
        'aspiring-challenger': 'military',
        'kakita-kaezin': 'military',
        'kakita-toshimoko': 'military',
        'arrogant-kakita': 'military',
        'policy-debate': 'political',
        'make-your-case': 'political',
        'game-of-sadane': 'political',
        'arbiter-of-authority': 'political',
        'kakita-yuri': 'political',
        'disparaging-challenge': 'political',
        'courtly-challenger': 'political',
        'cunning-negotiator': 'political'
    },
    duelStartRules: {
        'kakita-dojo': { challenger: 'choose-own', targetChooser: 'self' },
        'make-your-case': { challenger: 'choose-own', targetChooser: 'opponent' },
        'duelist-training': { challenger: 'source', targetChooser: 'self' },
        'daimyo-s-gunbai': { challenger: 'choose-own', targetChooser: 'opponent' },
        'aspiring-challenger': { challenger: 'source', targetChooser: 'self' },
        'kakita-kaezin': { challenger: 'source', targetChooser: 'self' },
        'kakita-yuri': { challenger: 'source', targetChooser: 'opponent' },
        'kakita-toshimoko': { challenger: 'source', targetChooser: 'opponent' },
        'policy-debate': { challenger: 'choose-own', targetChooser: 'self' },
        'duel-to-the-death': { challenger: 'choose-own', targetChooser: 'self' },
        'game-of-sadane': { challenger: 'choose-own', targetChooser: 'self' },
        'arbiter-of-authority': { challenger: 'source', targetChooser: 'self' },
        'cunning-negotiator': { challenger: 'source', targetChooser: 'self' },
        'courtly-challenger': { challenger: 'source', targetChooser: 'self' },
        // This reaction is mandatory. Matchup scoring may steer its target,
        // but must never suppress the engine's forced trigger.
        'arrogant-kakita': { challenger: 'source', targetChooser: 'self', forced: true }
    },
    duelSkillBonuses: {
        characters: {
            'kakita-favorite': { political: 2 }
        },
        attachments: {
            'kakita-blade': { political: 2 }
        }
    },
    keyCharacters: [
        'tengu-sensei', 'doji-kuwanan', 'kakita-kaezin', 'kakita-toshimoko',
        'kakita-yoshi-2'
    ],
    durableCharacters: [
        'tengu-sensei', 'doji-kuwanan', 'kakita-kaezin', 'kakita-toshimoko',
        'iron-crane-legion', 'kakita-yoshi-2'
    ],
    towerTargetCount: 2,
    supportTargetCount: 2,
    towerFateMin: 3,
    towerFateMax: 5,
    towerAttachments: [
        'shukujo', 'duelist-training', 'daimyo-s-gunbai', 'kakita-blade',
        'iaijutsu-master', 'fine-katana', 'ornate-fan', 'seal-of-the-crane',
        'above-question', 'tattooed-wanderer'
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

    // The axis a duel source compares — used to send our strongest on that
    // axis and find the strongest opposing target it can beat.
    duelAxis(cardId: string | undefined): 'military' | 'political' | null {
        return (cardId && this.profile.duelAxes[cardId]) || null;
    }

    duelSourceId(card: any): string | null {
        // Duelist Training is an attachment when played, but its duel Action's
        // source is the attached character. Do not mistake playing the setup
        // attachment itself for starting a duel.
        if(card?.id && this.profile.duelStartRules[card.id] &&
            !(card.id === 'duelist-training' && card.type !== 'character')) {
            return card.id;
        }
        if((card?.attachments || []).some((attachment: any) => attachment.id === 'duelist-training')) {
            return 'duelist-training';
        }
        return null;
    }

    // Prospective score includes conditional effects absent from the ordinary
    // pre-duel skill summary (Kakita Favorite and each Kakita Blade).
    duelSkill(
        card: any,
        axis: 'military' | 'political',
        baseSkill: (card: any, axis: 'military' | 'political') => number
    ): number {
        let total = baseSkill(card, axis);
        total += this.profile.duelSkillBonuses.characters[card?.id]?.[axis] || 0;
        for(const attachment of card?.attachments || []) {
            total += this.profile.duelSkillBonuses.attachments[attachment?.id]?.[axis] || 0;
        }
        return total;
    }

    hasReadyIaijutsuMaster(card: any, readyByCharacterUuid?: Record<string, boolean>): boolean {
        const attached = (card?.attachments || []).some((attachment: any) =>
            attachment.id === 'iaijutsu-master');
        if(!attached) {
            return false;
        }
        const liveReady = card?.uuid ? readyByCharacterUuid?.[card.uuid] : undefined;
        return liveReady !== false;
    }

    canBeat(
        challenger: any,
        target: any,
        axis: 'military' | 'political',
        baseSkill: (card: any, axis: 'military' | 'political') => number,
        readyByCharacterUuid?: Record<string, boolean>
    ): boolean {
        const margin = this.duelSkill(challenger, axis, baseSkill) -
            this.duelSkill(target, axis, baseSkill);
        return margin > 0 || (margin === 0 &&
            this.hasReadyIaijutsuMaster(challenger, readyByCharacterUuid));
    }

    // Start optional duels only with a favorable printed/live matchup. When
    // the opponent chooses its participant, it will expose our challenger to
    // its strongest legal body. When we choose, at least one legal opposing
    // body must be beatable. Iaijutsu Master makes an equal-skill matchup safe.
    shouldStartDuel(
        source: any,
        myCharacters: any[],
        opponentCharacters: any[],
        baseSkill: (card: any, axis: 'military' | 'political') => number,
        readyByCharacterUuid?: Record<string, boolean>
    ): boolean {
        const sourceId = this.duelSourceId(source);
        const rule = sourceId ? this.profile.duelStartRules[sourceId] : undefined;
        const axis = sourceId ? this.duelAxis(sourceId) : null;
        if(!rule || !axis || rule.forced) {
            return true;
        }

        const mine = myCharacters.filter((card) => card.inConflict);
        const theirs = opponentCharacters.filter((card) => card.inConflict);
        if(theirs.length === 0) {
            return false;
        }
        const challenger = rule.challenger === 'source'
            ? mine.find((card) => card.uuid === source?.uuid) ||
                mine.find((card) => card.id === source?.id)
            : this.pickOwnDuelParticipant(mine, axis, true, undefined, baseSkill);
        if(!challenger) {
            return false;
        }

        if(rule.targetChooser === 'opponent') {
            const strongest = this.strongestDuelCharacter(theirs, axis, baseSkill);
            return !!strongest && this.canBeat(
                challenger, strongest, axis, baseSkill, readyByCharacterUuid);
        }
        return theirs.some((target) => this.canBeat(
            challenger, target, axis, baseSkill, readyByCharacterUuid));
    }

    // Own-started duel: strongest legal character. Opponent-started duel:
    // contest with strongest only when the gap/bid plan is viable; otherwise
    // expose the weakest, least-invested body and protect the tower.
    pickOwnDuelParticipant(
        cards: any[],
        axis: 'military' | 'political',
        initiatedByMe: boolean,
        opponent: any | undefined,
        baseSkill: (card: any, axis: 'military' | 'political') => number,
        contestWhenBehind?: (challenger: any, opponent: any) => boolean
    ): any {
        if(cards.length === 0) {
            return null;
        }
        const strongestFirst = cards.slice().sort((a, b) =>
            this.duelSkill(b, axis, baseSkill) - this.duelSkill(a, axis, baseSkill) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            (b.attachments || []).length - (a.attachments || []).length ||
            String(a.uuid).localeCompare(String(b.uuid)));
        if(initiatedByMe || !opponent) {
            return strongestFirst[0];
        }

        const gap = this.duelSkill(strongestFirst[0], axis, baseSkill) -
            this.duelSkill(opponent, axis, baseSkill);
        if(gap >= 0 || contestWhenBehind?.(strongestFirst[0], opponent)) {
            return strongestFirst[0];
        }

        return cards.slice().sort((a, b) =>
            this.duelSkill(a, axis, baseSkill) - this.duelSkill(b, axis, baseSkill) ||
            (Number(a.fate) || 0) - (Number(b.fate) || 0) ||
            (a.attachments || []).length - (b.attachments || []).length ||
            String(a.uuid).localeCompare(String(b.uuid)))[0];
    }

    // Choose the highest-value opposing character the challenger can beat.
    // If a forced/already-started duel has no favorable target, sacrifice the
    // least threatening target instead of feeding a tower into their best one.
    pickOpponentDuelTarget(
        cards: any[],
        axis: 'military' | 'political',
        challenger: any | undefined,
        baseSkill: (card: any, axis: 'military' | 'political') => number,
        readyByCharacterUuid?: Record<string, boolean>
    ): any {
        const strongestFirst = cards.slice().sort((a, b) =>
            this.duelSkill(b, axis, baseSkill) - this.duelSkill(a, axis, baseSkill) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            (b.attachments || []).length - (a.attachments || []).length ||
            String(a.uuid).localeCompare(String(b.uuid)));
        if(challenger) {
            const beatable = strongestFirst.find((target) =>
                this.canBeat(challenger, target, axis, baseSkill, readyByCharacterUuid));
            if(beatable) {
                return beatable;
            }
        }
        return strongestFirst[strongestFirst.length - 1] || null;
    }

    private strongestDuelCharacter(
        cards: any[],
        axis: 'military' | 'political',
        baseSkill: (card: any, axis: 'military' | 'political') => number
    ): any {
        return cards.slice().sort((a, b) =>
            this.duelSkill(b, axis, baseSkill) - this.duelSkill(a, axis, baseSkill) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    isTowerCharacter(cardId: string | undefined): boolean {
        return !!cardId && this.profile.keyCharacters.includes(cardId);
    }

    isDurableCharacter(cardId: string | undefined): boolean {
        return !!cardId && this.profile.durableCharacters.includes(cardId);
    }

    needsTower(board: any[]): boolean {
        return board.filter((card) => this.isTowerCharacter(card.id)).length < this.profile.towerTargetCount;
    }

    // Buy a preferred duelist only when it can receive at least 3 fate. If a
    // tower is showing but cannot be funded yet, the policy saves fate and
    // keeps that province card through regroup instead of replacing it.
    pickDynastyTower(playable: any[], costs: Record<string, number>, fate: number, board: any[], hand: any[] = []): any {
        const hasShukujo = hand.some((card) => card.id === 'shukujo');
        const ranking = this.profile.keyCharacters;
        const funded = (card: any) => {
            const cost = costs[card.uuid] ?? 0;
            // Normal seven-fate openings can establish a five-cost champion
            // with two fate. Three-cost duelists remain the efficient deep-
            // fate targets and still ask for three.
            const minimumFate = cost >= 4 ? 2 : this.profile.towerFateMin;
            return fate >= cost + minimumFate;
        };
        const keyCandidates = this.needsTower(board) ? playable
            .filter((card) => this.isTowerCharacter(card.id))
            .filter(funded)
            .sort((a, b) => {
                // Shukujo only has its printed Action on Doji Kuwanan, so a
                // copy in hand makes Kuwanan the first tower to establish.
                const shukujoDiff = (hasShukujo && b.id === 'doji-kuwanan' ? 1 : 0) -
                    (hasShukujo && a.id === 'doji-kuwanan' ? 1 : 0);
                if(shukujoDiff !== 0) {
                    return shukujoDiff;
                }
                return ranking.indexOf(a.id) - ranking.indexOf(b.id);
            }) : [];
        if(keyCandidates.length > 0) {
            return keyCandidates[0];
        }

        // Legion's live military equals the opponent's hand during conflicts.
        // Establish one persistent copy when no funded key tower is available,
        // without making it an attachment carrier.
        if(!board.some((card) => card.id === 'iron-crane-legion')) {
            return playable.filter((card) => card.id === 'iron-crane-legion')
                .filter(funded)
                .sort((a, b) => String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
        }
        return null;
    }

    hasVisibleTower(playable: any[]): boolean {
        return playable.some((card) => this.isDurableCharacter(card.id));
    }

    // At most two cheap helpers. When a tower is already visible but cannot
    // yet receive its three-fate minimum, the policy caps this at a one-cost
    // helper so it can still contest an unopposed conflict without draining
    // the next round's tower fund.
    pickSupportCharacter(playable: any[], costs: Record<string, number>, fate: number, board: any[], maxCost = Number.POSITIVE_INFINITY): any {
        const supportCount = board.filter((card) => card.type === 'character' && !this.isDurableCharacter(card.id)).length;
        if(supportCount >= this.profile.supportTargetCount) {
            return null;
        }
        return playable
            .filter((card) => card.type === 'character' && !this.isDurableCharacter(card.id))
            .filter((card) => (costs[card.uuid] ?? 0) <= maxCost)
            .filter((card) => fate - (costs[card.uuid] ?? 0) >= 1)
            .sort((a, b) => (costs[a.uuid] ?? 0) - (costs[b.uuid] ?? 0) ||
                String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    shouldKeepDynasty(cardId: string | undefined, board: any[]): boolean {
        return (this.needsTower(board) && this.isTowerCharacter(cardId)) ||
            (cardId === 'iron-crane-legion' && !board.some((card) => card.id === 'iron-crane-legion'));
    }

    desiredAdditionalFate(cardId: string | undefined, fate: number, playCost?: number): number | null {
        if(!this.isDurableCharacter(cardId)) {
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

    // Way of the Crane is setup, not a disposable conflict pump: honor creates
    // skill equal to glory, so glory leads; tower persistence breaks ties.
    pickHonorTarget(cards: any[], valueOf: (card: any) => number, gloryOf: (card: any) => number = () => 0): any {
        return cards.filter((card) => !card.isHonored).sort((a, b) =>
            gloryOf(b) - gloryOf(a) ||
            (this.isTowerCharacter(b.id) ? 1 : 0) - (this.isTowerCharacter(a.id) ? 1 : 0) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            valueOf(b) - valueOf(a) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    // Noble Sacrifice's cost and effect are two separate target prompts.
    // Spend the least persistent honored body; remove the most persistent,
    // strongest dishonored enemy.
    pickNobleSacrifice(cards: any[], valueOf: (card: any) => number): any {
        return cards.slice().sort((a, b) =>
            (Number(a.fate) || 0) - (Number(b.fate) || 0) ||
            (a.attachments || []).length - (b.attachments || []).length ||
            valueOf(a) - valueOf(b) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    pickNobleVictim(cards: any[], valueOf: (card: any) => number): any {
        return cards.slice().sort((a, b) =>
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            (b.attachments || []).length - (a.attachments || []).length ||
            valueOf(b) - valueOf(a) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
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
    pickAttachmentTarget(
        mine: any[],
        attachmentId: string | undefined,
        maxCopiesPerTarget?: number
    ): any {
        if(!this.isTowerAttachment(attachmentId)) {
            return null;
        }
        let candidates = mine.filter((card) => this.isTowerCharacter(card.id));
        // Protection and covert are useful on every persistent high-value body,
        // including Iron Crane Legion. Duel actions remain on true duel towers.
        if(attachmentId === 'above-question' || attachmentId === 'tattooed-wanderer') {
            candidates = mine.filter((card) => this.isDurableCharacter(card.id));
        }
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
        if(attachmentId === 'tattooed-wanderer') {
            // Tengu Sensei already has Covert; a second source adds no value.
            candidates = candidates.filter((card) => card.id !== 'tengu-sensei');
        }
        if(attachmentId && maxCopiesPerTarget) {
            // Copy limits come from shared card metadata. Duel-specific
            // targeting only ranks legal strategic bearers.
            candidates = candidates.filter((card) => (card.attachments || [])
                .filter((attachment: any) => attachment.id === attachmentId).length < maxCopiesPerTarget);
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

}
