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
    towerReuse: TowerReuseProfile;
}

// Keeping the tower on the table for the NEXT conflict.
//
// Measured over 48 games: the card-count payoff character is in play but does
// not participate in 30-56% of conflict-sides, and the dominant reason is that
// it is BOWED from the previous conflict (Mitsu 29% attacking / 39% defending)
// rather than left at home by the declaration (9-16%). Every card-count
// threshold this deck plays for is keyed on that body PARTICIPATING, so a
// bowed tower turns the whole engine off for the rest of the round.
//
// A free ready source spent between conflicts converts one bowed tower into
// another conflict's worth of abilities.
export interface TowerReuseProfile {
    // SHIPPED at `true`. Setting it false reproduces pre-2026-08-24 V1, so
    // every knob here stays an A/B arm rather than an edit.
    readyBetweenConflicts: boolean;
    // Togashi Mitsu is THE tower: he is the only body that turns five cards
    // into a ring resolution, so the deck looks for him before spending on
    // anyone else.
    primaryTowerIds: string[];
    // A game that has not found Mitsu still needs one body carrying the
    // attachments and the buffs. Togashi Ichi and Togashi Tadakatsu are the
    // best remaining printed bodies (4/2 and 4/3) and both are unique, so a
    // ready source can stand either back up.
    fallbackTowerIds: string[];
    // Before this round a missing Mitsu is still findable, so `pickTower`
    // names nobody and the reuse/protection knobs below hold their resources
    // rather than spending them on a body Mitsu will replace. It does NOT gate
    // the five-card push any more -- see `requireTowerForFiveCount`.
    fallbackTowerFromRound: number;
    // MEASURED AND REJECTED -- ships at `false`, do not turn it on again.
    //
    // The idea (from a human pilot's own description of the deck) was to chase
    // the five-card count only with a tower participating to cash it, on the
    // reasoning that High House alone moves ONE fate and does not pay for the
    // four or five cards spent reaching the threshold. It measured **-2.89pp,
    // p=0.041** over 761 paired games on 12 bases -- the only result in that
    // series to clear the noise floor, and it cleared it in the wrong
    // direction. The premise is simply false: High House converts 74-76% of
    // its bows into the ring-fate move, so a five-push with no tower still
    // pays, and refusing it throws that away. See `docs/dragon-bot.md`.
    requireTowerForFiveCount: boolean;
    // Ready sources this deck may spend between conflicts. In Service to My
    // Lord costs no fate, recurs from the bottom of the conflict deck, and
    // pays with a non-unique body that contributes nothing to the count.
    readySourceIds: string[];
    // Aim the bow-prevention cards at the TOWER rather than at whichever monk
    // tops the skill sort. Both of these are `targetPreference: 'strongest'`,
    // and in a MILITARY conflict Togashi Mitsu, Togashi Ichi and Togashi
    // Tadakatsu all show printed 4, so the tie is broken arbitrarily and the
    // protection lands on a body the deck does not need next conflict.
    preferTowerForProtection: boolean;
    towerProtectionCardIds: string[];
}

export const TOWER_REUSE_DEFAULTS: TowerReuseProfile = {
    readyBetweenConflicts: true,
    primaryTowerIds: ['togashi-mitsu-2'],
    fallbackTowerIds: ['togashi-ichi', 'togashi-tadakatsu'],
    fallbackTowerFromRound: 3,
    requireTowerForFiveCount: false,
    readySourceIds: ['in-service-to-my-lord'],
    preferTowerForProtection: true,
    towerProtectionCardIds: ['swell-of-seafoam', 'iron-foundations-stance']
};

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
    kihoCards: ['hurricane-punch', 'void-fist', 'swell-of-seafoam', 'iron-foundations-stance'],
    towerReuse: { ...TOWER_REUSE_DEFAULTS }
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

    // Several Dragon cards require a participating Monk, so this gates them.
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

    // Can we still hit a cards-played threshold this conflict? The deck's
    // payoffs count cards, so a threshold we cannot reach is worth nothing
    // and the cards are better held.
    canReachTarget(cardsPlayed: number, playableCards: number, target: number): boolean {
        return target > cardsPlayed && cardsPlayed + playableCards >= target;
    }

    // Would playing this card put fate on a ring?
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

    // Same question across a whole hand.
    canCreateRingFate(playableCards: any[], myCharacters: any[]): boolean {
        return playableCards.some((card) => this.cardCanCreateRingFate(card, myCharacters));
    }

    // May we spend past the normal card budget to reach a count threshold?
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

    // Best bearer for Way of the Dragon, by the profile ranking.
    pickWayCharacter(mine: any[]): any {
        const ranking = this.profile.wayTargets;
        const ranked = mine
            .filter((card) => card.id && ranking.includes(card.id) &&
                !!this.profile.wayAbilityPeriods[card.id] && !this.hasWayOfTheDragon(card))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
        return ranked[0] || null;
    }

    // How often the bearer's Way ability may fire — the usage ledger needs the
    // period, not just a boolean.
    wayAbilityPeriod(card: any): 'round' | 'conflict' | null {
        if(!card?.id || !this.hasWayOfTheDragon(card)) {
            return null;
        }
        return this.profile.wayAbilityPeriods[card.id] || null;
    }

    // Is Way of the Dragon attached to this character?
    hasWayOfTheDragon(card: any): boolean {
        return (card?.attachments || []).some((attachment: any) => attachment.id === 'way-of-the-dragon');
    }

    // Keep this character on a province refresh rather than discarding it.
    shouldPreserveProvinceCharacter(card: any): boolean {
        return !!card?.id && this.profile.towerCharacters.includes(card.id);
    }

    // Extra fate per character; Togashi Mitsu 2 gets a large reserve because
    // the deck's card engine runs through him.
    desiredAdditionalFate(cardId: string | undefined, printedCost: number | undefined): number | null {
        if(cardId === 'togashi-mitsu-2') {
            return 4;
        }
        if(printedCost !== undefined && printedCost >= 3 && printedCost <= 4) {
            return 2;
        }
        return null;
    }

    // The deck's current tower. Mitsu whenever he is on the table; otherwise
    // nobody until `fallbackTowerFromRound`, because a fallback tower named
    // too early spends the hand that the real tower needs.
    pickTower(mine: any[], roundNumber = 1): any {
        const reuse = this.profile.towerReuse;
        const pick = (ranking: string[]) => mine
            .filter((card) => card?.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id))[0] || null;
        return pick(reuse.primaryTowerIds) ||
            (roundNumber >= reuse.fallbackTowerFromRound ? pick(reuse.fallbackTowerIds) : null);
    }

    // May we spend the hand chasing the five-card count right now? Only with a
    // tower PARTICIPATING to cash it. High House on its own moves one fate;
    // that is not worth the cards, and before the fallback round it is also
    // the hand Mitsu will want.
    fiveCountHasTower(mine: any[], roundNumber = 1): boolean {
        if(!this.profile.towerReuse.requireTowerForFiveCount) {
            return true;
        }
        const tower = this.pickTower(mine.filter((card) => card.inConflict), roundNumber);
        return !!tower;
    }

    // Between conflicts: is a ready source worth spending to stand the tower
    // back up? Only while a conflict can still USE it -- the same rule
    // `ReadyValuePolicy` applies to every other ready in the field.
    //
    // In Service pays by bowing a non-unique, so one must be standing; the
    // engine enforces that too, but checking here keeps the bot from clicking
    // a card whose cost it cannot pay and cancelling out of the prompt.
    pickTowerReadySource(input: {
        myCharacters: any[];
        playableCards: any[];
        conflictsRemaining: number;
        roundNumber?: number;
    }): any {
        if(!this.profile.towerReuse.readyBetweenConflicts || input.conflictsRemaining <= 0) {
            return null;
        }
        const tower = this.pickTower(input.myCharacters, input.roundNumber ?? 1);
        if(!tower || !tower.bowed) {
            return null;
        }
        const hasFodder = input.myCharacters.some((card) => !card.bowed && !card.isUnique);
        if(!hasFodder) {
            return null;
        }
        const ranking = this.profile.towerReuse.readySourceIds;
        return input.playableCards
            .filter((card) => card?.id && ranking.includes(card.id))
            .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id))[0] || null;
    }

    // Bow-prevention aimed at the tower. `candidates` is the prompt's own
    // selectable list, so anything returned here is legal by construction --
    // Swell's participating-monk restriction is already applied upstream.
    // Null means "no opinion"; the generic skill sort then runs unchanged.
    pickTowerProtectionTarget(sourceCardId: string | undefined, candidates: any[], roundNumber = 1): any {
        const reuse = this.profile.towerReuse;
        if(!reuse.preferTowerForProtection || !sourceCardId ||
            !reuse.towerProtectionCardIds.includes(sourceCardId)) {
            return null;
        }
        return this.pickTower(candidates, roundNumber);
    }

    // Which card Ancient Master should fetch, by a fixed preference order.
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
