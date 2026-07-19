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
    // Card-count payoffs are this deck's win condition. When reachable, their
    // exact target overrides normal province-break strength budgeting.
    allowCardCountOvercommit: boolean;
    voidRecursionBonus: number; // ring-score bonus per Keeper Initiate
                                // waiting in the dynasty discard
    // ranked targets for the build-around attachments (Way of the Dragon,
    // Finger of Jade) and ready effects
    keyCharacters: string[];
    wayTargets: string[];
    // Way increases the normal ability limit, but does not override a card's
    // separate `max` restriction. Only characters whose useful Action really
    // gains a second activation belong here, together with that limit period.
    wayAbilityPeriods: Record<string, 'round' | 'conflict'>;
    towerCharacters: string[];
    // Cards whose play can create ring fate during the same conflict, making
    // High House's five-card bonus live even when every ring starts empty.
    ringFateProducerCards: string[];
    // Togashi Dreamer moves fate to a ring after a Kiho is played. Keep both
    // sides as profile data so alternate Monk lists can inject their engine.
    ringFateOnKihoCharacters: string[];
    kihoCards: string[];
}

export const DRAGON_DEFAULTS: DragonProfile = {
    allowCardCountOvercommit: true,
    voidRecursionBonus: 20,
    keyCharacters: ['togashi-mitsu-2', 'togashi-ichi', 'togashi-tadakatsu', 'teacher-of-empty-thought'],
    wayTargets: ['togashi-mitsu-2', 'tranquil-philosopher', 'teacher-of-empty-thought'],
    wayAbilityPeriods: {
        'togashi-mitsu-2': 'round',
        'tranquil-philosopher': 'round',
        'teacher-of-empty-thought': 'round'
    },
    towerCharacters: [
        'togashi-mitsu-2', 'togashi-ichi', 'togashi-tadakatsu',
        'teacher-of-empty-thought', 'tranquil-philosopher', 'kitsuki-investigator'
    ],
    ringFateProducerCards: ['written-in-the-stars', 'army-of-the-rising-wave'],
    ringFateOnKihoCharacters: ['togashi-dreamer'],
    kihoCards: ['hurricane-punch', 'void-fist', 'swell-of-seafoam', 'iron-foundations-stance']
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

    hasParticipatingMonk(myCharacters: any[]): boolean {
        const monkIds = new Set([
            'ancient-master', 'teacher-of-empty-thought', 'togashi-acolyte',
            'togashi-ichi', 'togashi-initiate', 'togashi-mitsu-2',
            'togashi-tadakatsu', 'tranquil-philosopher', 'tattooed-wanderer'
        ]);
        return myCharacters.some((card) => card.inConflict && (
            monkIds.has(card.id) ||
            (Array.isArray(card.traits) && card.traits.some((trait: string) => trait.toLowerCase() === 'monk')) ||
            (typeof card.traits === 'string' && /\bmonk\b/i.test(card.traits))
        ));
    }

    // Highest live exact threshold. Ichi counts both players' cards; defense
    // and stronghold attacks do not chase his illegal auto-break. The engine
    // count already folds in every Shintao Monastery's virtual card.
    cardTargets(
        myCharacters: any[],
        amAttacker: boolean,
        myCardsPlayed = 0,
        opponentCardsPlayed = 0,
        highHouseAvailable = false,
        attackingStronghold = false
    ): number[] {
        const participating = (id: string) => myCharacters.some((card) => card.inConflict && card.id === id);
        const targets: number[] = [];
        if(participating('teacher-of-empty-thought')) {
            targets.push(3);
        }
        if(participating('togashi-mitsu-2') || highHouseAvailable) {
            targets.push(5);
        }
        if(amAttacker && !attackingStronghold && participating('togashi-ichi')) {
            targets.push(Math.max(myCardsPlayed, 10 - opponentCardsPlayed));
        }
        return [...new Set(targets)].sort((a, b) => b - a);
    }

    // Preserve High House only while its ring-fate bonus is worth and able to
    // reach. Otherwise use its base event-targeting protection immediately.
    strongholdReady(cardsPlayed: number, waitForFateBonus = true): boolean {
        return cardsPlayed >= 5 || !waitForFateBonus;
    }

    canReachTarget(cardsPlayed: number, playableCards: number, target: number): boolean {
        return target > cardsPlayed && cardsPlayed + playableCards >= target;
    }

    cardCanCreateRingFate(card: any, myCharacters: any[]): boolean {
        if(this.profile.ringFateProducerCards.includes(card?.id)) {
            return true;
        }

        const hasDreamer = myCharacters.some((candidate) =>
            candidate.inConflict && this.profile.ringFateOnKihoCharacters.includes(candidate.id));
        const hasFateDonor = myCharacters.some((candidate) =>
            candidate.inConflict && (Number(candidate.fate) || 0) > 0);
        if(!hasDreamer || !hasFateDonor) {
            return false;
        }

        const traits = Array.isArray(card?.traits)
            ? card.traits
            : String(card?.traits || '').split(/[.,\s]+/);
        return this.profile.kihoCards.includes(card?.id) ||
            traits.some((trait: string) => trait.toLowerCase() === 'kiho' || trait.toLowerCase() === 'kihō');
    }

    canCreateRingFate(playableCards: any[], myCharacters: any[]): boolean {
        return playableCards.some((card) => this.cardCanCreateRingFate(card, myCharacters));
    }

    allowsCardCountOvercommit(): boolean {
        return this.profile.allowCardCountOvercommit;
    }

    // Build-around attachments go to Mitsu first.
    pickKeyCharacter(mine: any[]): any {
        const ranking = this.profile.keyCharacters;
        const ranked = mine
            .filter((card) => card.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || null;
    }

    pickWayCharacter(mine: any[]): any {
        const ranking = this.profile.wayTargets;
        const ranked = mine
            .filter((card) => card.id && ranking.includes(card.id) &&
                !!this.profile.wayAbilityPeriods[card.id] && !this.hasWayOfTheDragon(card))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || null;
    }

    wayAbilityPeriod(card: any): 'round' | 'conflict' | null {
        if(!card?.id || !this.hasWayOfTheDragon(card)) {
            return null;
        }
        return this.profile.wayAbilityPeriods[card.id] || null;
    }

    hasWayOfTheDragon(card: any): boolean {
        return (card?.attachments || []).some((attachment: any) => attachment.id === 'way-of-the-dragon');
    }

    shouldPreserveProvinceCharacter(card: any): boolean {
        return !!card?.id && this.profile.towerCharacters.includes(card.id);
    }

    desiredAdditionalFate(cardId: string | undefined, printedCost: number | undefined): number | null {
        if(cardId === 'togashi-mitsu-2') {
            return 4;
        }
        if(printedCost !== undefined && printedCost >= 3 && printedCost <= 4) {
            return 2;
        }
        return null;
    }

    pickAncientMasterCard(cards: any[]): any {
        const ranking = [
            'togashi-acolyte', 'hurricane-punch', 'void-fist',
            'swell-of-seafoam', 'iron-foundations-stance',
            'centipede-tattoo', 'hawk-tattoo'
        ];
        return cards
            .filter((card) => card?.id)
            .sort((a, b) => {
                const ai = ranking.indexOf(a.id);
                const bi = ranking.indexOf(b.id);
                return (ai < 0 ? ranking.length : ai) - (bi < 0 ? ranking.length : bi);
            })[0] || null;
    }
}
