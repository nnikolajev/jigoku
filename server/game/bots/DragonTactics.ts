// Monk/card-engine playstyle for the heuristic bot (Dragon "Monks In Da High
// House", EmeraldDB 4fb91e58, Lion splash). The deck is built around Togashi
// Mitsu: cheap cards are PLAYED IN VOLUME during his conflicts to turn on the
// cards-played payoffs:
//
// - Togashi Mitsu (5+ cards played): resolve any ring as if he won,
// - High House of Light stronghold (5+): protect a monk and move a ring's
//   fate onto him,
// - Teacher of Empty Thought (3+): draw; Togashi Ichi (10+): auto-break;
//   Void Fist (2+): bow-and-send-home; Togashi Acolyte: +1/+1 per card,
// - Keeper Initiate recurs from the dynasty discard whenever the VOID ring
//   is claimed — the deck steers conflicts to void while he waits there,
// - Togashi Tadakatsu makes the DEFENDER choose the element of conflicts
//   declared against him: give the attacker the worst ring, not the best,
// - monk characters double as attachments (Ancient Master, Tattooed
//   Wanderer, Togashi Acolyte) — played as attachments by preference,
// - In Service to My Lord (Lion splash) recycles from the discard to ready
//   Mitsu again and again.
//
// All behavior here is DATA-gated: the tactics only exist when the deck's
// profile carries a DragonProfile, so every other deck keeps the unchanged
// generic behavior.

// Tuning knobs for the monk playstyle.
export interface DragonProfile {
    firstRoundBid: number; // full hand for the card engine
    drawBid: number; // later dials: LOW — the deck self-draws (Storehouse,
                     // Hurricane Punch, Teacher, library digs) and the honor
                     // dial was bleeding it into dishonor losses
    duelBid: number; // Defend Your Honor duels — enough to win, no more
    voidRecursionBonus: number; // ring-score bonus per Keeper Initiate
                                // waiting in the dynasty discard
    // cards-played payoff characters: while one PARTICIPATES, the conflict
    // window keeps playing cards instead of stopping at "already winning"
    cardEngineIds: string[];
    // ranked targets for the build-around attachments (Way of the Dragon,
    // Finger of Jade) and ready effects
    keyCharacters: string[];
}

export const DRAGON_DEFAULTS: DragonProfile = {
    firstRoundBid: 5,
    drawBid: 2,
    duelBid: 2,
    voidRecursionBonus: 20,
    cardEngineIds: ['togashi-mitsu-2', 'togashi-ichi', 'teacher-of-empty-thought'],
    keyCharacters: ['togashi-mitsu-2', 'togashi-ichi', 'togashi-tadakatsu', 'teacher-of-empty-thought']
};

// Decision helpers the policy delegates to when (and only when) the deck's
// profile carries a DragonProfile. Stateless.
export class DragonTactics {
    private profile: DragonProfile;

    constructor(profile: DragonProfile) {
        this.profile = profile;
    }

    // Void ring recursion: each Keeper Initiate in the dynasty discard is a
    // free body the moment void is claimed.
    ringBonus(element: string, dynastyDiscard: any[]): number {
        if(element !== 'void') {
            return 0;
        }
        const keepers = (dynastyDiscard || []).filter((card) => card.id === 'keeper-initiate').length;
        return keepers * this.profile.voidRecursionBonus;
    }

    // A cards-played payoff character is in the conflict: keep feeding it
    // cards even when the conflict is already won/lost on skill.
    cardEngineParticipating(myCharacters: any[]): boolean {
        return myCharacters.some((card) =>
            card.inConflict && card.id && this.profile.cardEngineIds.includes(card.id));
    }

    // How many cards the bot should aim to play this conflict: 10 only when
    // Togashi Ichi participates AND we are ATTACKING (his 10-card auto-break
    // only works on the attack — chasing 10 on defense just burns cards),
    // otherwise 5 (Togashi Mitsu's ring resolve works in any conflict; Teacher
    // at 3 and Void Fist at 2 are covered on the way). The engine count already
    // folds in Shintao Monastery's +1, so this is the raw target.
    cardTarget(myCharacters: any[], amAttacker: boolean): number {
        const ichiAttacking = amAttacker && myCharacters.some((card) =>
            card.inConflict && card.id === 'togashi-ichi');
        return ichiAttacking ? 10 : 5;
    }

    // High House of Light gives skill any time; its 5-cards-played half moves a
    // RING's fate onto the bearer, which only matters when a ring actually
    // holds fate. With no ring fate to steal, fire it immediately for the
    // skill. Otherwise wait for the 5th card while we can still reach it, and
    // fall back to using it now once no further card can raise the count.
    strongholdReady(cardsPlayed: number, moreCardsPlayable: boolean, ringsHaveFate: boolean): boolean {
        if(!ringsHaveFate) {
            return true;
        }
        return cardsPlayed >= 5 || !moreCardsPlayable;
    }

    desiredDuelBid(myHonor: number): number {
        return myHonor > 3 ? this.profile.duelBid : 1;
    }

    // Draw dials: full hand on round 1, then bid low — the deck draws
    // through its own engine and the dial difference pays us honor.
    desiredBid(roundNumber: number | undefined, myHonor: number): number {
        if(myHonor <= 3) {
            return 1;
        }
        if(roundNumber !== undefined && roundNumber <= 1) {
            return this.profile.firstRoundBid;
        }
        return this.profile.drawBid;
    }

    // Build-around attachments go to Mitsu first.
    pickKeyCharacter(mine: any[]): any {
        const ranking = this.profile.keyCharacters;
        const ranked = mine
            .filter((card) => card.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || null;
    }
}
