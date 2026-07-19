export interface UnicornProfile {
    movementCardIds: string[];
    gaijinCardIds: string[];
    singletonAttachments: string[];
    movementNeededThreshold: number;
    spyglassMoveBonus: number;
    twilightReadyBonus: number;
    outriderReadyBonus: number;
    stablesMoveBonus: number;
    outskirtsGloryWeight: number;
    supportedReadyCost: number;
    barchaBowBonus: number;
    minamiWinBonus: number;
    higashiWinBonus: number;
}

export const UNICORN_DEFAULTS: UnicornProfile = {
    movementCardIds: ['golden-plains-outpost', 'ride-on', 'adorned-barcha'],
    gaijinCardIds: ['spyglass', 'curved-blade', 'ujik-tactics', 'adorned-barcha'],
    singletonAttachments: ['spyglass', 'adorned-barcha', 'utaku-battle-steed'],
    movementNeededThreshold: 1,
    spyglassMoveBonus: 3,
    twilightReadyBonus: 4,
    outriderReadyBonus: 4,
    stablesMoveBonus: 2,
    outskirtsGloryWeight: 2,
    supportedReadyCost: 1.5,
    barchaBowBonus: 4,
    minamiWinBonus: 3,
    higashiWinBonus: 2
};

export interface UnicornMoveContext {
    conflictType: 'military' | 'political';
    characters: any[];
    opponentCharacters?: any[];
    cavalryUuids?: Record<string, true>;
    skillOf: (card: any) => number;
    strengthNeeded?: number | null;
    requireCavalry?: boolean;
    hasMotoStables?: boolean;
    hasOutskirtsSentry?: boolean;
    /** Exact live support: this bowed character can be readied after moving
     * (self action/reaction, I Am Ready, or Shiotome Encampment). */
    readyAfterMoveUuids?: Record<string, true>;
    /** Barcha bearer -> its attachment action has not been spent this round. */
    barchaReadyBearerUuids?: Record<string, true>;
    /** Skill still needed to win, not merely to prevent/break a province. */
    winSkillNeeded?: number | null;
    selfParticipantCount?: number;
    opponentParticipantCount?: number;
}

/** Deck-local movement planner. It contains no prompt plumbing, so profiles can
 * tune scores without copying controller logic. */
export class UnicornTactics {
    constructor(public readonly profile: UnicornProfile = UNICORN_DEFAULTS) {}

    effectiveParticipantCount(exact: number | undefined, characters: any[]): number {
        return Number.isFinite(exact) ? Math.max(Number(exact), 0) :
            characters.filter((card) => card.inConflict).length;
    }

    hasMoveSource(strongholdCards: any[], hand: any[], characters: any[],
        barchaReadyBearerUuids?: Record<string, true>): boolean {
        const enabled = new Set(this.profile.movementCardIds);
        return enabled.has('golden-plains-outpost') &&
                strongholdCards.some((card) => card.id === 'golden-plains-outpost' && !card.bowed) ||
            enabled.has('ride-on') && hand.some((card) => card.id === 'ride-on' && card.isPlayableByMe) ||
            enabled.has('adorned-barcha') &&
            characters.some((card) => !!barchaReadyBearerUuids?.[card.uuid] &&
                (card.attachments || []).some((attachment: any) => attachment.id === 'adorned-barcha'));
    }

    isCavalry(card: any, cavalryUuids?: Record<string, true>): boolean {
        return !!card?.uuid && (!!cavalryUuids?.[card.uuid] || (card.traits || []).includes('cavalry'));
    }

    private attachmentIds(card: any): string[] {
        return (card?.attachments || []).map((attachment: any) => String(attachment.id || ''));
    }

    private glory(card: any): number {
        return Math.max(Number(card?.glorySummary?.stat ?? card?.glory) || 0, 0);
    }

    private hasReadyFollowUp(card: any, ctx: UnicornMoveContext): boolean {
        return !!card?.uuid && (!!ctx.readyAfterMoveUuids?.[card.uuid] ||
            ['moto-outrider', 'twilight-rider'].includes(card.id));
    }

    private hasWinningPayoff(card: any, ctx: UnicornMoveContext): boolean {
        if(!card?.bowed || Number(ctx.winSkillNeeded) > 0) {
            return false;
        }
        if(card.id === 'minami-kaze-regulars') {
            return (Number(ctx.selfParticipantCount) || 0) + 1 >
                (Number(ctx.opponentParticipantCount) || 0);
        }
        if(card.id === 'higashi-kaze-company') {
            return ctx.characters.some((other) => other !== card && other.inConflict &&
                !other.bowed && (Number(other.fate) || 0) === 0);
        }
        return false;
    }

    canContributeAfterMove(card: any, ctx: UnicornMoveContext): boolean {
        return !card?.bowed || this.hasReadyFollowUp(card, ctx);
    }

    projectedMoveSkill(card: any, ctx: UnicornMoveContext): number {
        if(!card || !this.canContributeAfterMove(card, ctx)) {
            return 0;
        }
        return Math.max(ctx.skillOf(card), 0) + (ctx.hasMotoStables ? this.profile.stablesMoveBonus : 0);
    }

    projectedMoveSwing(card: any, ctx: UnicornMoveContext): number {
        const moveSkill = this.projectedMoveSkill(card, ctx);
        if(!card || !ctx.barchaReadyBearerUuids?.[card.uuid]) {
            return moveSkill;
        }
        const bowedEnemySkill = (ctx.opponentCharacters || [])
            .filter((enemy) => enemy.inConflict && !enemy.bowed)
            .reduce((maximum, enemy) => Math.max(maximum, Math.max(ctx.skillOf(enemy), 0)), 0);
        return moveSkill + bowedEnemySkill;
    }

    private moveScore(card: any, ctx: UnicornMoveContext): number {
        const attachments = this.attachmentIds(card);
        let score = (this.canContributeAfterMove(card, ctx) ? Math.max(ctx.skillOf(card), 0) : 0) +
            (Number(card.fate) || 0) * 0.2;
        if(attachments.includes('spyglass')) {
            score += this.profile.spyglassMoveBonus;
        }
        if(card.id === 'twilight-rider') {
            score += this.profile.twilightReadyBonus;
        }
        if(card.id === 'moto-outrider') {
            score += this.profile.outriderReadyBonus;
        }
        if(ctx.hasMotoStables) {
            score += this.profile.stablesMoveBonus;
        }
        if(ctx.hasOutskirtsSentry) {
            score += this.glory(card) * this.profile.outskirtsGloryWeight;
        }
        if(attachments.includes('adorned-barcha') && ctx.barchaReadyBearerUuids?.[card.uuid]) {
            score += this.profile.barchaBowBonus;
        }
        if(card.bowed && this.hasReadyFollowUp(card, ctx) &&
            !['moto-outrider', 'twilight-rider'].includes(card.id)) {
            score -= this.profile.supportedReadyCost;
        }
        if(this.hasWinningPayoff(card, ctx)) {
            score += card.id === 'minami-kaze-regulars'
                ? this.profile.minamiWinBonus
                : this.profile.higashiWinBonus;
        }
        return score;
    }

    pickMoveTarget(ctx: UnicornMoveContext): any | null {
        const legal = ctx.characters.filter((card) => !card.inConflict &&
            (!ctx.requireCavalry || this.isCavalry(card, ctx.cavalryUuids)) &&
            // Preserve an unused Barcha for its own stronger bow+move action.
            (!ctx.requireCavalry || !ctx.barchaReadyBearerUuids?.[card.uuid]) &&
            (!card.bowed || this.hasReadyFollowUp(card, ctx) || this.hasWinningPayoff(card, ctx)));
        return legal.sort((a, b) => this.moveScore(b, ctx) - this.moveScore(a, ctx) ||
            String(a.uuid).localeCompare(String(b.uuid)))[0] || null;
    }

    shouldUseMove(ctx: UnicornMoveContext): boolean {
        const target = this.pickMoveTarget(ctx);
        if(!target) {
            return false;
        }
        const needed = Number(ctx.strengthNeeded);
        return !Number.isFinite(needed) || needed >= this.profile.movementNeededThreshold ||
            target.bowed || this.attachmentIds(target).includes('spyglass') ||
            target.id === 'twilight-rider';
    }

    orderDeclarationCandidates(cards: any[], ctx: UnicornMoveContext): { ordered: any[]; mover: any | null } {
        const barchaBearer = ctx.characters.filter((card) =>
            !!ctx.barchaReadyBearerUuids?.[card.uuid])
            .sort((a, b) => this.moveScore(b, ctx) - this.moveScore(a, ctx))[0] || null;
        const cavalryMover = this.pickMoveTarget({ ...ctx, requireCavalry: true });
        const mover = ctx.conflictType === 'military'
            ? [barchaBearer, cavalryMover].filter(Boolean)
                .sort((a, b) => this.moveScore(b, ctx) - this.moveScore(a, ctx))[0] || null
            : null;
        const ordered = cards.slice().sort((a, b) => {
            // Sentry must already participate when the planned move occurs.
            const sentry = Number(b.id === 'outskirts-sentry') - Number(a.id === 'outskirts-sentry');
            if(sentry !== 0) {
                return sentry;
            }
            if(a === mover) {
                return 1;
            }
            if(b === mover) {
                return -1;
            }
            return ctx.skillOf(b) - ctx.skillOf(a);
        });
        return { ordered, mover };
    }

    pickOutskirtsHonorTarget(characters: any[], skillOf: (card: any) => number): any | null {
        return characters.filter((card) => card.inConflict && !card.honored)
            .sort((a, b) => this.glory(b) - this.glory(a) ||
                skillOf(b) - skillOf(a))[0] || null;
    }

    pickTwilightReadyTarget(characters: any[], skillOf: (card: any) => number): any | null {
        return characters.filter((card) => card.bowed)
            .sort((a, b) => skillOf(b) - skillOf(a))[0] || null;
    }

    pickAttachmentTarget(cardId: string, characters: any[], skillOf: (card: any) => number,
        cavalryUuids?: Record<string, true>, strengthNeeded?: number | null,
        readyAfterMoveUuids?: Record<string, true>): any | null {
        const copyCount = (card: any) => this.attachmentIds(card).filter((id) => id === cardId).length;
        let legal = characters.filter((card) => copyCount(card) === 0);
        if(cardId === 'utaku-battle-steed') {
            const nonCavalry = legal.filter((card) => !this.isCavalry(card, cavalryUuids));
            if(nonCavalry.length > 0) {
                legal = nonCavalry;
            } else if(Number(strengthNeeded) === 1) {
                legal = characters;
            }
        }
        if(cardId === 'spyglass' || cardId === 'adorned-barcha') {
            const home = legal.filter((card) => !card.inConflict &&
                (!card.bowed || cardId === 'adorned-barcha' || !!readyAfterMoveUuids?.[card.uuid]));
            if(home.length > 0) {
                legal = home;
            }
        }
        return legal.sort((a, b) => skillOf(b) - skillOf(a) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0))[0] || null;
    }

    challengeSkill(card: any, participantCount: number, skillOf: (card: any) => number): number {
        return Math.max(skillOf(card), 0) + Math.max(participantCount - 1, 0);
    }
}
