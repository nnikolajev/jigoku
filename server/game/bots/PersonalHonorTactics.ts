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
    // Characters that REVERSE the honor-status modifier: Shosuro Sadako adds
    // her glory to both skills while dishonored instead of subtracting it. A
    // dishonor that has to land somewhere on our side belongs on one of these
    // — it is not a cost there, it is a pump. Empty for every other deck, so
    // the ordering is bit-identical without it.
    reverseHonorCardIds: readonly string[];
    // Sources whose dishonor prompt is a COST paid on our OWN side (Calling in
    // Favors, Acclaimed Geisha House). The shared rule reads `dishonor` as a
    // harmful action and aims it at the opponent, so with only our own
    // characters legal it cancelled the whole ability — measured at 21 cancels
    // in 6 games. Empty for every other deck, which keeps the old ordering.
    ownDishonorCostSourceIds: readonly string[];
    // Called to War asks the DEFENDING player "give an honor to your opponent?"
    // in exchange for a fate on one of our own Bushi. Whoever is holding this
    // profile is the one being asked, so this is field-wide policy, not a Lion
    // knob: a bot that always says yes hands a Lion Duelist deck a free honor
    // every copy, and honor is that deck's whole switch (five of its cards read
    // "if you are more honorable"). These price the trade instead.
    honorGiftResponse: HonorGiftResponseProfile;
}

export interface HonorGiftResponseProfile {
    // Master switch. Off = always decline, which is the behaviour every deck
    // had before Called to War existed in the field.
    enabled: boolean;
    // Never pay from at or below this own honor. Reaching 0 loses the game
    // outright, and the honor also feeds the asker's "more honorable" gates.
    minimumOwnHonorAfterGift: number;
    // Never pay once the ASKER's honor would reach this. 25 wins the game, and
    // the deck asking is the one that wants to get there.
    maximumOpponentHonorAfterGift: number;
    // Never pay while we are not (still) more honorable afterwards — losing the
    // honor LEAD is worth more than one fate to any deck that has gates on it.
    requireHonorLeadAfterGift: boolean;
    // Only pay when a body we control actually banks the fate: a character with
    // at most this much fate already, so the extra fate buys it a round.
    maximumRecipientFate: number;
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
    persistentCharacterFate: 2,
    reverseHonorCardIds: [],
    ownDishonorCostSourceIds: [],
    honorGiftResponse: {
        enabled: true,
        minimumOwnHonorAfterGift: 8,
        maximumOpponentHonorAfterGift: 15,
        requireHonorLeadAfterGift: false,
        maximumRecipientFate: 1
    }
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

    // A character that reverses the modifier GAINS skill from a dishonor, so
    // it outranks every "cheapest" consideration below.
    prefersDishonor(card: any): boolean {
        return !!card?.id && this.profile.reverseHonorCardIds.includes(card.id);
    }

    // Is this source's dishonor prompt a cost we pay on our own board?
    isOwnDishonorCost(sourceCardId?: string): boolean {
        return !!sourceCardId && this.profile.ownDishonorCostSourceIds.includes(sourceCardId);
    }

    // "Give an honor to your opponent?" — pay 1 honor to put 1 fate on one of
    // OUR Bushi. Answered by whichever bot is being asked, so the gates below
    // protect the honor race first and only then look at the payoff.
    shouldGiveHonorForFate(input: {
        ownHonor: number;
        opponentHonor: number;
        ownCharacters: any[];
        isBushi: (card: any) => boolean;
    }): boolean {
        const rules = this.profile.honorGiftResponse;
        if(!rules.enabled) {
            return false;
        }
        const ownAfter = Number(input.ownHonor) - 1;
        const opponentAfter = Number(input.opponentHonor) + 1;
        if(!Number.isFinite(ownAfter) || !Number.isFinite(opponentAfter)) {
            return false;
        }
        if(ownAfter < rules.minimumOwnHonorAfterGift ||
            opponentAfter >= rules.maximumOpponentHonorAfterGift) {
            return false;
        }
        if(rules.requireHonorLeadAfterGift && ownAfter <= opponentAfter) {
            return false;
        }
        return (input.ownCharacters || []).some((card) => input.isBushi(card) &&
            (Number(card?.fate) || 0) <= rules.maximumRecipientFate);
    }

    pickForcedOwnDishonor(cards: any[]): any | null {
        const reversed = cards.filter((card) => this.prefersDishonor(card) && !card?.isDishonored);
        if(reversed.length > 0) {
            // Among the reversers, the highest glory gains the most.
            return reversed.slice().sort((a, b) =>
                this.gloryValue(b) - this.gloryValue(a) ||
                this.booleanDiff(!!b.inConflict, !!a.inConflict) ||
                this.uuid(a).localeCompare(this.uuid(b)))[0];
        }
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
