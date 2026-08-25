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
    ringPriority: DragonRingPriorityProfile;
}

// Which ring this deck wants, before any fate pile is considered.
export interface DragonRingPriorityProfile {
    // `false` reproduces V1's ring ordering exactly.
    enabled: boolean;
    // Keeper Initiate returns from the dynasty discard OR from a PROVINCE when
    // a matching ring is claimed (`KeeperInitiate.location`). V1's void bonus
    // counted only the discard, so the copies sitting faceup in provinces —
    // which is where they start — were invisible.
    countKeepersInProvinces: boolean;
    // Fate on a ring only outranks the element plan from this much up. V1 uses
    // 1 for every fate-aware deck, which makes a single fate beat a free 2-cost
    // body out of the dynasty discard.
    fateDominanceThreshold: number;
    // Fire honors a character, and the tower is the body whose glory the deck
    // actually cashes. Bonus added while a tower is in play and NOT honored.
    unhonoredTowerFireBonus: number;
    // Tranquil Philosopher moves 1 fate between unclaimed rings. Worth an
    // activation whenever a fate is sitting on a ring the plan does not want
    // and it can be carried onto the ring the plan does want.
    philosopherFateMove: boolean;
    // How many unclaimed rings may sit at or above `fateDominanceThreshold` and
    // still leave the move worth making. One 2-fate ring is a DONOR: taking one
    // fate off it and attacking the wanted element beats attacking the wrong
    // element for two. Two such rings mean a real pile exists on both sides of
    // the choice, so take one instead of shuffling fate around.
    philosopherMaxRichRings: number;
    // Fate at which a ring counts as RICH for the philosopher's own decision.
    // Deliberately independent of `fateDominanceThreshold`: the two components
    // measured separately, and the fate bar for "which ring do I attack" was
    // rejected while this one was not.
    philosopherRichThreshold: number;
    // Never break up a pile bigger than this. A three-fate ring is worth taking
    // for the fate alone.
    philosopherMaxDonorFate: number;
}

// SHIPPED with only the two halves that measured clean.
//
// `fateDominanceThreshold: 2` and `unhonoredTowerFireBonus: 45` were MEASURED
// AND REJECTED (24 bases / 768 games / both seats: the fate bar read 54.5% on
// the search bases and 45.0% on 24 fresh ones, pooled 49.4%; the fire bonus read
// 46.7%). They ship at their inert values and stay here as A/B arms.
const DRAGON_RING_PRIORITY_DEFAULTS: DragonRingPriorityProfile = {
    enabled: true,
    countKeepersInProvinces: true,
    // 0 = keep the policy's generic reading (1 for a fate-aware deck).
    fateDominanceThreshold: 0,
    unhonoredTowerFireBonus: 0,
    philosopherFateMove: true,
    philosopherMaxRichRings: 1,
    philosopherRichThreshold: 2,
    philosopherMaxDonorFate: 2
};

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

const TOWER_REUSE_DEFAULTS: TowerReuseProfile = {
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
    towerReuse: { ...TOWER_REUSE_DEFAULTS },
    ringPriority: { ...DRAGON_RING_PRIORITY_DEFAULTS }
};

// Decision helpers the policy delegates to when (and only when) the deck's
// profile carries a DragonProfile. Stateless.
export class DragonTactics {
    private profile: DragonProfile;

    constructor(profile: DragonProfile) {
        this.profile = profile;
    }

    // Void ring recursion: each Keeper Initiate is a free body the moment void
    // is claimed. `provinceCards` is the faceup dynasty side of our provinces,
    // which `KeeperInitiate` reads as a second legal source — V1 counted only
    // the discard, so the copies sitting where they START were worth nothing.
    ringBonus(element: string, dynastyDiscard: any[], provinceCards: any[] = []): number {
        if(element !== 'void') {
            return 0;
        }
        const countIn = (pile: any[]) => (pile || []).filter((card) => card?.id === 'keeper-initiate').length;
        const keepers = countIn(dynastyDiscard) +
            (this.profile.ringPriority.enabled && this.profile.ringPriority.countKeepersInProvinces
                ? countIn(provinceCards)
                : 0);
        return keepers * this.profile.voidRecursionBonus;
    }

    /** Is the Tranquil Philosopher fate-move plan live? Both the activation
     * gate and the two ring picks hang off this, so the component ablates
     * cleanly out of the ring-priority arm. */
    philosopherPlanActive(): boolean {
        return this.profile.ringPriority.enabled && this.profile.ringPriority.philosopherFateMove;
    }

    /** Fate on a ring only outranks the element plan from here up. Null keeps
     * whatever generic threshold the policy would use, which is what ships:
     * raising it to 2 was measured and rejected (see the profile comment). */
    ringFateDominanceThreshold(): number | null {
        const value = Math.max(0, Number(this.profile.ringPriority.fateDominanceThreshold) || 0);
        return this.profile.ringPriority.enabled && value >= 1 ? value : null;
    }

    /**
     * Fire honors a character. The tower is the body whose glory this deck
     * cashes — Mitsu is glory 3 and every card-count payoff runs through him —
     * so with a tower standing unhonored the fire ring is a live upgrade, and
     * the generic score files fire at 30, below earth and void.
     */
    ringElementPlanBonus(element: string, myCharacters: any[], roundNumber = 1): number {
        if(!this.profile.ringPriority.enabled || element !== 'fire') {
            return 0;
        }
        const tower = this.pickTower(myCharacters || [], roundNumber);
        return tower && !tower.isHonored ? this.profile.ringPriority.unhonoredTowerFireBonus : 0;
    }

    /**
     * Is Tranquil Philosopher's "move 1 fate between unclaimed rings" worth an
     * activation right now?
     *
     * Pick the ring the plan wants with the fate piles IGNORED, then ask
     * whether a fate can be carried onto it. A single 2-fate ring is a DONOR,
     * not a destination: one fate on the right element beats two on the wrong
     * one, and the donor keeps the other fate for whoever takes it. The move is
     * off in both extremes — every ring empty (nothing to carry) and two rings
     * already rich (a real pile exists whichever way the choice goes) — and off
     * for a pile too big to break up (`philosopherMaxDonorFate`).
     */
    philosopherShouldMoveFate(rings: any[], wantedElement: string): boolean {
        if(!this.profile.ringPriority.enabled || !this.profile.ringPriority.philosopherFateMove) {
            return false;
        }
        const unclaimed = (rings || []).filter((ring) => ring && !ring.claimed && !ring.claimedBy);
        const threshold = Math.max(1, Number(this.profile.ringPriority.philosopherRichThreshold) || 1);
        const fateOf = (ring: any) => Number(ring?.fate) || 0;
        const rich = unclaimed.filter((ring) => fateOf(ring) >= threshold);
        if(rich.length > this.profile.ringPriority.philosopherMaxRichRings ||
            rich.some((ring) => fateOf(ring) > this.profile.ringPriority.philosopherMaxDonorFate)) {
            return false;
        }
        const donors = unclaimed.filter((ring) => fateOf(ring) > 0 &&
            String(ring.element) !== String(wantedElement));
        return donors.length > 0 &&
            unclaimed.some((ring) => String(ring.element) === String(wantedElement));
    }

    /**
     * The unclaimed ring to take the fate FROM.
     *
     * The ability ALWAYS resolves its "then, gain 1 honor" rider, whether or
     * not a fate moves, so it is never worth declining — only worth aiming.
     * Two answers, and the second is the one V1 got wrong:
     *
     *   - the move is worth making: the fattest unclaimed ring that is not the
     *     one the plan wants;
     *   - it is not: the EMPTIEST ring that is not the one we want, so the
     *     second select has no legal target, nothing moves, and we collect the
     *     honor. V1 sorted this prompt by "best ring" like every other ring
     *     prompt, which named the ring we wanted as the DONOR and moved the
     *     fate off it.
     */
    philosopherDonorRing(rings: any[], wantedElement: string): any {
        const fateOf = (ring: any) => Number(ring?.fate) || 0;
        const unclaimed = (rings || []).filter((ring) => ring && !ring.claimed && !ring.claimedBy &&
            String(ring.element) !== String(wantedElement));
        if(this.philosopherShouldMoveFate(rings, wantedElement)) {
            const donor = unclaimed.filter((ring) => fateOf(ring) > 0)
                .sort((left, right) => fateOf(right) - fateOf(left) ||
                    String(left.element).localeCompare(String(right.element)))[0];
            if(donor) {
                return donor;
            }
        }
        return unclaimed.slice().sort((left, right) => fateOf(left) - fateOf(right) ||
            String(left.element).localeCompare(String(right.element)))[0] || null;
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
