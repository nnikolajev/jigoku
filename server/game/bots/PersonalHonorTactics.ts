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
    // An honor token is only worth its glory if the honored body can still USE
    // that glory. Two ways it can:
    //
    //   1. it survives the fate phase (`fate > 0`), so the token pays in every
    //      later round;
    //   2. it is still STANDING when this conflict resolves and a conflict
    //      opportunity remains on either side, so the token pays again this
    //      round -- either because a `DoesNotBow` effect is on it (Sacred
    //      Sanctuary, Iron Foundations Stance, Swell of Seafoam, Centipede
    //      Tattoo) or because it is a ready body that is not in this conflict
    //      at all.
    //
    // A 0-fate PARTICIPANT is neither: it bows out of the conflict and is
    // discarded in the fate phase, so its glory is spent on nothing. Seen live
    // (2026-08-25, Dragon vs Phoenix, round 2 conflict 1): the fire ring
    // honored a 0-fate participating Togashi Mitsu (glory 3) over a 2-fate
    // participating Togashi Ichi (glory 2), and Mitsu was discarded that fate
    // phase.
    //
    // `false` reproduces the pure highest-glory ordering exactly.
    honorTargetPersistence: boolean;
    // How much GLORY the persistence rule may give up. The token is worth the
    // body's glory, so demoting a glory-4 body for a glory-1 one that survives
    // trades a large present swing for a small future one. A candidate more
    // than this far below the best glory on the board keeps tier 0 and is only
    // reached by the ordinary glory ordering. 99 = no cap, which is the rule as
    // first written.
    honorTargetPersistenceMaxGloryGap: number;
}

/** Board facts the persistence tier needs; nothing in a card summary says
 * whether a body will still be standing after the conflict resolves. */
export interface HonorPersistenceBoard {
    // Engine-read: characters under a `DoesNotBow` effect, published as a
    // number map because the controller builds it with the shared
    // `characterNumberHint` walker.
    noBowUuids?: Record<string, number>;
    // Conflict opportunities left AFTER the one running, both sides. With none
    // left, "still standing this round" buys nothing and only fate counts.
    conflictsRemaining?: number;
    opponentConflictsRemaining?: number;
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
    honorTargetPersistence: true,
    honorTargetPersistenceMaxGloryGap: 99,
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

    // Glory a card carries, preferring the live summary. Glory is what an
    // honor token is actually worth, so it drives every pick here.
    gloryValue(card: any): number {
        const summary = Number(card?.glorySummary?.stat);
        if(Number.isFinite(summary)) {
            return Math.max(summary, 0);
        }
        const printed = Number(card?.glory);
        return Number.isFinite(printed) ? Math.max(printed, 0) : 0;
    }

    /**
     * How much LATER use an honor token on this body can still have.
     *
     *   2 - it has fate, so it survives the fate phase and pays every round;
     *   1 - it is still standing when this conflict resolves and a conflict
     *       opportunity remains, so it pays again this round;
     *   0 - it bows out of this conflict and is discarded in the fate phase.
     *
     * Always 0 when the knob is off, which reproduces the pure glory ordering.
     */
    persistenceTier(card: any, board?: HonorPersistenceBoard | null): number {
        if(!this.profile.honorTargetPersistence) {
            return 0;
        }
        if((Number(card?.fate) || 0) > 0) {
            return 2;
        }
        const conflictsLeft = (Number(board?.conflictsRemaining) || 0) +
            (Number(board?.opponentConflictsRemaining) || 0);
        if(conflictsLeft <= 0) {
            return 0;
        }
        const staysReady = !!board?.noBowUuids?.[String(card?.uuid || '')] ||
            (!card?.inConflict && !card?.bowed);
        return staysReady ? 1 : 0;
    }

    // Which of OUR characters to honor: highest glory gains the most, among
    // the bodies that can still use it (see `persistenceTier`).
    pickOwnHonor(cards: any[], board?: HonorPersistenceBoard | null): any | null {
        const bestGlory = cards.reduce(
            (top: number, card: any) => Math.max(top, this.gloryValue(card)), 0);
        const gap = Number(this.profile.honorTargetPersistenceMaxGloryGap);
        const tier = (card: any) =>
            bestGlory - this.gloryValue(card) <= (Number.isFinite(gap) ? gap : 99)
                ? this.persistenceTier(card, board)
                : 0;
        return cards.slice().sort((a, b) =>
            tier(b) - tier(a) ||
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

    // When an effect forces us to dishonor our own, take the character that
    // wants it (Scorpion) first, otherwise the one that loses least.
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

    // Which enemy character to dishonor — the one whose glory loss hurts them
    // most, weighted by whether it is in the live conflict.
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

    // When forced to honor THEIRS, give it to the lowest-glory body.
    pickForcedEnemyHonor(cards: any[]): any | null {
        return cards.slice().sort((a, b) =>
            this.gloryValue(a) - this.gloryValue(b) ||
            this.booleanDiff(!!a.inConflict, !!b.inConflict) ||
            this.booleanDiff(!a.bowed, !b.bowed) ||
            this.combinedSkill(a) - this.combinedSkill(b) ||
            this.uuid(a).localeCompare(this.uuid(b))
        )[0] || null;
    }

    // For a combined honor/dishonor prompt: is honoring ours worth more than
    // dishonoring theirs? Getting this backwards is the defect class the
    // polarity gate watches for — see docs/bot-honor-token-targeting.md.
    shouldHonorOwn(
        ownCards: any[],
        enemyCards: any[],
        ownValueBonus = 0,
        board?: HonorPersistenceBoard | null,
        opponentChoosesTarget = false
    ): boolean {
        const own = this.pickOwnHonor(ownCards, board);
        if(!own) {
            return false;
        }
        // WHO PICKS THE TARGET decides which enemy body to price.
        //
        // Court Games' dishonor half resolves with `player: Players.Opponent`,
        // so the opponent chooses which of THEIR participants takes the token
        // -- and they will hand over the one that loses them the least. The
        // realised value of that half is therefore their LOWEST-glory eligible
        // participant, not their highest. Pricing it at the highest overvalues
        // the dishonor and refuses honors that are worth more (2026-08-25,
        // Dragon vs Phoenix round 3: own Mitsu glory 3 lost to enemy Tsukune
        // glory 4, and the dishonor then landed on a glory-2 Shiba Yojimbo).
        const ranked = this.rankEnemyDishonor(enemyCards);
        const enemy = opponentChoosesTarget ? ranked[ranked.length - 1] : ranked[0];
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
