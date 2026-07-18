// Shared, injectable personal-honor targeting policy.
//
// Honoring and dishonoring move character skill by current glory. Helpful
// status effects therefore belong on our highest-glory character; a forced
// harmful status belongs on our lowest-glory character. Enemy dishonor adds
// one tactical exception: a lower-glory participant outranks a larger home
// target when that skill loss changes the conflict winner or creates a break.

export interface PersonalHonorProfile {
    prioritizeConflictOutcome: boolean;
    preferHomeWhenConflictUnaffected: boolean;
    persistentCharacterFate: number;
}

export interface PersonalHonorConflict {
    axis: 'military' | 'political';
    mySkill: number;
    opponentSkill: number;
    amAttacker: boolean;
    attackedProvinceStrength?: number;
}

export const PERSONAL_HONOR_DEFAULTS: PersonalHonorProfile = {
    prioritizeConflictOutcome: true,
    preferHomeWhenConflictUnaffected: true,
    persistentCharacterFate: 2
};

export class PersonalHonorTactics {
    constructor(private profile: PersonalHonorProfile) {}

    gloryValue(card: any): number {
        const summary = Number(card?.glorySummary?.stat);
        if(Number.isFinite(summary)) {
            return Math.max(summary, 0);
        }
        const printed = Number(card?.glory);
        return Number.isFinite(printed) ? Math.max(printed, 0) : 0;
    }

    pickOwnHonor(cards: any[]): any | null {
        return cards.slice().sort((a, b) =>
            this.gloryValue(b) - this.gloryValue(a) ||
            this.booleanDiff(!b.bowed, !a.bowed) ||
            this.booleanDiff(b.inConflict, a.inConflict) ||
            this.booleanDiff(this.isPersistent(b), this.isPersistent(a)) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            this.combinedSkill(b) - this.combinedSkill(a) ||
            this.uuid(a).localeCompare(this.uuid(b))
        )[0] || null;
    }

    pickForcedOwnDishonor(cards: any[]): any | null {
        return cards.slice().sort((a, b) =>
            this.gloryValue(a) - this.gloryValue(b) ||
            this.booleanDiff(!!a.inConflict, !!b.inConflict) ||
            this.booleanDiff(!a.bowed, !b.bowed) ||
            this.combinedSkill(a) - this.combinedSkill(b) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            this.uuid(a).localeCompare(this.uuid(b))
        )[0] || null;
    }

    pickEnemyDishonor(cards: any[], conflict?: PersonalHonorConflict | null): any | null {
        if(cards.length === 0) {
            return null;
        }
        if(this.profile.prioritizeConflictOutcome && conflict) {
            const tactical = cards.filter((card) => this.changesConflictOutcome(card, conflict));
            if(tactical.length > 0) {
                return this.rankEnemyDishonor(tactical, conflict.axis)[0];
            }
        }
        if(this.profile.preferHomeWhenConflictUnaffected && conflict) {
            const home = cards.filter((card) => !card.inConflict);
            if(home.length > 0) {
                return this.rankEnemyDishonor(home, conflict.axis)[0];
            }
        }
        return this.rankEnemyDishonor(cards, conflict?.axis)[0];
    }

    pickForcedEnemyHonor(cards: any[]): any | null {
        return cards.slice().sort((a, b) =>
            this.gloryValue(a) - this.gloryValue(b) ||
            this.booleanDiff(!!a.inConflict, !!b.inConflict) ||
            this.booleanDiff(!a.bowed, !b.bowed) ||
            this.combinedSkill(a) - this.combinedSkill(b) ||
            this.uuid(a).localeCompare(this.uuid(b))
        )[0] || null;
    }

    shouldHonorOwn(ownCards: any[], enemyCards: any[], ownValueBonus = 0): boolean {
        const own = this.pickOwnHonor(ownCards);
        if(!own) {
            return false;
        }
        const enemy = this.rankEnemyDishonor(enemyCards)[0];
        return !enemy || this.gloryValue(own) + ownValueBonus >= this.gloryValue(enemy);
    }

    private changesConflictOutcome(card: any, conflict: PersonalHonorConflict): boolean {
        const impact = this.conflictSkillImpact(card, conflict.axis);
        if(impact <= 0) {
            return false;
        }
        const opponentAfter = Math.max(conflict.opponentSkill - impact, 0);
        const wins = (opponentSkill: number) => conflict.amAttacker
            ? conflict.mySkill > opponentSkill
            : conflict.mySkill >= opponentSkill;
        if(!wins(conflict.opponentSkill) && wins(opponentAfter)) {
            return true;
        }
        if(conflict.amAttacker && conflict.attackedProvinceStrength !== undefined) {
            const breaks = (opponentSkill: number) =>
                wins(opponentSkill) && conflict.mySkill - opponentSkill >= conflict.attackedProvinceStrength!;
            return !breaks(conflict.opponentSkill) && breaks(opponentAfter);
        }
        return false;
    }

    private conflictSkillImpact(card: any, axis: 'military' | 'political'): number {
        if(!card.inConflict || card.bowed) {
            return 0;
        }
        return Math.min(this.gloryValue(card), this.skillValue(card, axis));
    }

    private rankEnemyDishonor(cards: any[], axis?: 'military' | 'political'): any[] {
        return cards.slice().sort((a, b) =>
            this.gloryValue(b) - this.gloryValue(a) ||
            (axis ? this.conflictSkillImpact(b, axis) - this.conflictSkillImpact(a, axis) : 0) ||
            this.booleanDiff(!b.bowed, !a.bowed) ||
            (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
            this.combinedSkill(b) - this.combinedSkill(a) ||
            this.uuid(a).localeCompare(this.uuid(b))
        );
    }

    private isPersistent(card: any): boolean {
        return (Number(card?.fate) || 0) >= this.profile.persistentCharacterFate;
    }

    private combinedSkill(card: any): number {
        return this.skillValue(card, 'military') + this.skillValue(card, 'political');
    }

    private skillValue(card: any, axis: 'military' | 'political'): number {
        const summary = axis === 'political' ? card?.politicalSkillSummary : card?.militarySkillSummary;
        const raw = summary?.total ?? summary?.stat ?? card?.[axis];
        const value = Number(raw);
        return Number.isFinite(value) ? Math.max(value, 0) : 0;
    }

    private booleanDiff(left: boolean, right: boolean): number {
        return (left ? 1 : 0) - (right ? 1 : 0);
    }

    private uuid(card: any): string {
        return String(card?.uuid || card?.id || '');
    }
}
