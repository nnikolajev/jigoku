// Lion "Honor" playstyle for the heuristic bot (EmeraldDB 65b10e6f, Kyuden
// Ikoma + Seeker of Air).
//
// THE ARCHETYPE — and the reason this is a different deck from the Lion Duelist
// list that shares its stronghold: honor here is the SCOREBOARD, not a switch.
// The plan is 25 honor, and the deck is a stack of small faucets:
//
//   - an HONORED character that leaves play gains its controller 1 honor
//     (`drawcard.ts:1026`), and this list can honor almost anything: Court
//     Games, Soul Beyond Reproach (twice), Bushido Adherent, Honored Veterans,
//     Righteous Samurai, Prepare for War, Shameful Display, Honored General
//     (on entry) and Kenson no Gakka (every defender at once),
//   - the AIR ring is 2 honor (or 1 taken), and Akodo Toturi resolves the
//     claimed ring's effect a SECOND time in a military conflict he is in — so
//     an air claim with Toturi attacking is four honor,
//   - Seeker of Air pays a fate for every air province revealed, and two of the
//     five provinces are air (Before the Throne, Kenson no Gakka),
//   - Before the Throne TAKES 2 honor when it breaks, which is a 4-point swing
//     and the only province in the deck that is worth losing,
//   - Way of the Chrysanthemum DOUBLES honor received from an honor bid, which
//     makes bidding the floor the plan rather than a concession,
//   - and a per-conflict trickle: Chronicler of Conquests (a Battlefield is in
//     play — the deck runs six), Hero of Three Trees (fewer cards in hand),
//     Honored Blade (its bearer wins), Ikoma Prodigy (fate placed on it),
//     Ardent Omoidasu (2 taken whenever they dishonor us), Revered Ikoma
//     (2 honor gained this phase turns into a fate).
//
// The other half of the deck is a BRAKE, not a race: Privileged Position caps
// the opponent at one conflict a round whenever they out-bid us, Command
// Respect taxes their events, Under Amaterasu's Gaze taxes every card played at
// a province while we hold a 5-honor lead, and Steward of Law switches their
// dishonor package off entirely. Slowing the game down is how the faucets win.
//
// All behaviour is DATA-gated: the tactics exist only when the resolved
// DeckProfile carries a LionHonorProfile (derived from `kenson-no-gakka`), so
// the Lion Duelist list — same stronghold, opposite plan — is untouched.
//
// WIRED KNOBS (each is read by a real decision):
//   airRingBonus/fireRingBonus/airRingCloseBonus/toturi* -> JigokuBotPolicy.ringScore
//   politicalAxisBonus                                   -> preferredConflictType
//   additionalFateByCharacterId                          -> desiredAdditionalFate
//   dynasty*/tower*/maximumBoardCharacters               -> pickDynastyCharacter
//   honorTargetPriority                                  -> pickHonorTarget
//   chrysanthemum*                                       -> adjustDrawBid / fate reserve
//   privilegedPosition*                                  -> fate reserve
//   honorProvinceId                                      -> profile.strongholdProvinceId
//   magistrate*                                          -> attacker ordering (INERT, below)
//   battlefieldProvincePreference                        -> Under Amaterasu's Gaze target
//   proceduralInterference*                              -> province target ranking
//   heroOfThreeTrees*                                    -> menu choice (honor vs -1 strength)
//
// The DEFENDER's side of Called to War is deliberately NOT a knob here: it is
// field-wide policy that every deck answers, and it already exists as
// `PersonalHonorProfile.honorGiftResponse`. This deck sets it to `enabled:
// false` in its profile rather than re-implementing the question.
//
// NOT WIRED — the live gate is a `PlaybookEntry`, which cannot see the deck
// profile, so these mirror a constant in `CardPlaybook.ts`. Do NOT A/B them
// without moving the gate first; they read bit-identical every time.
//   battlefieldCardIds (used by the Chronicler gate, which is in the playbook)
//
// MEASURED INERT — wired to a real decision this deck never actually reaches.
//   magistrateCardIds / magistrateMinimumHonoredShare. `orderAttackers` is
//   called ~160 times per 16 games and the Magistrate was in the candidate or
//   committed set ZERO of those times: the deck buys it rarely (its ability
//   blanks our own unhonored attackers too, so its dynasty value is honestly
//   low) and it is absent or bowed at declaration when it does arrive. Both a
//   `magistrateMinimumHonoredShare: 0` arm and a `magistrateCardIds: []` arm
//   measured BIT-IDENTICAL over 384 games. The rule is kept because it is the
//   correct reading of the card and costs nothing, but do NOT spend a
//   measurement cycle on it without first making the body get bought.
//
//   WHY it is barely bought, established 2026-08-10: `dynastyValue` multiplies
//   `military`/`political`/`glory`, and a card in a PROVINCE carries none of
//   them (the engine fills skill summaries only for cards in play), so the
//   ranking runs on `dynastyAbilityValueById` alone. The Magistrate lands in a
//   five-way tie at 6.00 broken by uuid — i.e. by decklist position, the same
//   way every game — and Righteous Samurai (ability 3, cost 3) sorts LAST of
//   twelve despite a printed 4/2/2. Feeding the real printed stats in is
//   `DeckProfile.dynastyPrintedStats`; it works, and it measured NEGATIVE on
//   both honor decks because the ability table was fitted around the defect.
//   See `docs/bot-honor-token-targeting.md`.

import type { HonorTargetOptions, DynastyPrintedStats } from './SharedCardTactics.js';
import { printedStatOf } from './SharedCardTactics.js';

export interface LionHonorProfile {
    // ---- the honor race ----------------------------------------------------
    honorVictoryTarget: number;
    // Own honor at or above which the race is CLOSE: air steering gets heavier
    // and honor stops being spendable.
    honorWinCloseThreshold: number;
    // Never pay a voluntary honor cost that would end at or below this.
    honorSpendFloor: number;

    // ---- ring steering -----------------------------------------------------
    // The generic `ringScore` files air under its `default` branch at 15, below
    // earth (40) and void (50), because for every other deck air is the weakest
    // ring. For a deck whose win condition is the honor track it is the best.
    airRingBonus: number;
    // Extra air weight once `honorWinCloseThreshold` is reached.
    airRingCloseBonus: number;
    // Fire honors a character: skill now, and 1 honor when it dies.
    fireRingBonus: number;
    // Akodo Toturi resolves the claimed ring's effect AGAIN in a military
    // conflict he participates in. On air that is 4 honor from one claim, which
    // is a sixth of the win condition.
    toturiCardIds: readonly string[];
    toturiRingElements: readonly string[];
    toturiRingBonus: number;

    // ---- conflict axis -----------------------------------------------------
    // Most faucets are axis-neutral (Chronicler, Hero, Bushido Adherent, the
    // rings), and the board's skill is military, so the default nudge is ZERO.
    // The knob exists because Court Games and the Courtier half of the board
    // argue the other way and it is worth measuring, not assuming.
    politicalAxisBonus: number;

    // ---- fate investment ---------------------------------------------------
    // Fate on a body is fate NOT spent on another body. Two entries here are
    // load-bearing rules rather than preferences: Ikoma Prodigy PAYS 1 honor
    // for its first fate, and Lion's Pride Paragon is only Dire (does not bow
    // from conflict resolution) while it has NO fate at all.
    additionalFateByCharacterId: Record<string, number>;

    // ---- dynasty buying ----------------------------------------------------
    dynastyAbilityValueById: Record<string, number>;
    dynastyMilitaryWeight: number;
    dynastyPoliticalWeight: number;
    dynastyGloryWeight: number;
    // Divisor term: value per (cost + 1). Higher favours cheap width.
    dynastyEfficiencyWeight: number;
    // The one body worth the whole window, and only when it can arrive with
    // fate on it. Akodo Toturi is a 6/3 Champion whose reaction doubles a ring.
    towerCardIds: readonly string[];
    towerMinimumTotalFate: number;
    // Stop buying past this many own characters.
    maximumBoardCharacters: number;

    // ---- honoring ----------------------------------------------------------
    // Who receives an honored token first, ahead of the shared glory ordering.
    // The payoff is not only the glory swing: Implacable Magistrate blanks
    // every UNHONORED attacker including our own, so honoring the bodies that
    // fight beside it is what makes it playable at all.
    honorTargetPriority: readonly string[];

    // ---- Way of the Chrysanthemum ------------------------------------------
    // "After 1 or more honor is given to you from an honor bid – gain that much
    // honor." Honor flows to the LOWER bidder, so a copy in hand makes bidding
    // the floor worth double. It costs 2, so the fate has to still be there.
    chrysanthemumCardId: string;
    chrysanthemumBid: number;
    chrysanthemumCost: number;
    chrysanthemumReserveFate: number;

    // ---- Privileged Position -----------------------------------------------
    // "each opponent who bid higher than you cannot declare more than one
    // conflict against you this round" — the deck's main brake, and the reason
    // the opening round bids UNDER the field's 5 rather than at it.
    privilegedPositionCardId: string;
    privilegedPositionCost: number;
    privilegedPositionReserveFate: number;

    // ---- Kenson no Gakka ---------------------------------------------------
    // "After you LOSE a conflict at this province – honor each defending
    // character." Losing is the trigger, so the deck WANTS to be attacked here
    // and wants the widest possible defense that still stops the break. It gets
    // that for free: this is also the stronghold province, and the generic
    // `strongholdUnderAttack` rule in `JigokuBotPolicy.declareDefenders` commits
    // EVERY ready body there before any sizing runs.
    //
    // A per-province `defenseSkillBuffer` was built for this and MEASURED
    // BIT-IDENTICAL at 0, 2 and 4 over 384 games — the generic rule preempts it
    // — so it was removed rather than shipped as a dead knob. Do not re-add one.
    honorProvinceId: string;

    // ---- Implacable Magistrate ---------------------------------------------
    // "While this character is attacking, only this character and honored
    // characters count their skill toward the resolution of this conflict."
    // Sending it alongside unhonored bodies deletes their skill, so the
    // declaration orders honored attackers first and drops the Magistrate to
    // last while any unhonored body is still going.
    magistrateCardIds: readonly string[];
    // Attack with it when at least this fraction of the other attackers are
    // honored. 1 = only with a fully honored attack; 0 = never held back.
    magistrateMinimumHonoredShare: number;

    // ---- Under Amaterasu's Gaze --------------------------------------------
    // A Battlefield attached to an unbroken province. It taxes both players by
    // 1 fate per card unless they lead by 5 honor — so it is OUR card while we
    // hold that lead, and it is also the cheapest way to guarantee a
    // Battlefield is in play for Chronicler of Conquests.
    battlefieldAttachmentCardIds: readonly string[];
    // Own provinces to attach it to, best first. Kenson no Gakka is the
    // stronghold province, where the deck expects to be attacked most.
    battlefieldProvincePreference: readonly string[];
    // Card ids that already satisfy "a Battlefield is in play".
    battlefieldCardIds: readonly string[];

    // ---- Procedural Interference -------------------------------------------
    // "Choose an opponent's province. That opponent selects one - either
    // discard each card in that province, or you gain 2 honor." Both branches
    // pay, so the target is whichever province makes the choice hurt: one
    // holding several cards (City of the Rich Frog refills to three) or one
    // whose visible card is expensive.
    proceduralInterferenceCardId: string;
    proceduralInterferenceProvincePriority: readonly string[];

    // ---- Hero of Three Trees -----------------------------------------------
    // "select one - either gain 1 honor, or the attacked province gets -1
    // strength". Take the honor unless the single point of strength is exactly
    // what turns a failed attack into a break.
    heroOfThreeTreesCardId: string;
    heroPrefersHonor: boolean;
}

export const LION_HONOR_DEFAULTS: LionHonorProfile = {
    honorVictoryTarget: 25,
    honorWinCloseThreshold: 18,
    honorSpendFloor: 6,

    airRingBonus: 30,
    airRingCloseBonus: 20,
    fireRingBonus: 8,
    toturiCardIds: ['akodo-toturi'],
    toturiRingElements: ['air', 'fire'],
    toturiRingBonus: 12,

    politicalAxisBonus: 0,

    additionalFateByCharacterId: {
        // Its reaction pays 1 honor for the first fate placed on it, and the
        // fate buys the 1-cost body another round of life. Never bought bare.
        'ikoma-prodigy': 1,
        // Dire ONLY at zero fate. A fate on this body turns off the ability
        // that makes it worth playing.
        'lion-s-pride-paragon': 0,
        // The tower: a 6/3 Champion whose reaction resolves the claimed ring a
        // second time. Worth surviving several fate phases.
        'akodo-toturi': 2,
        // Enters play honored by itself and gives every other Lion +1 military
        // in its conflicts, so the aura is worth more than the body.
        'honored-general': 1,
        // A fate faucet (1 fate whenever we gained 2 honor this phase) that
        // cannot be dishonored. Keep it alive.
        'revered-ikoma': 1,
        // Two honor every time they dishonor one of ours; the opponent decides
        // how often, so the body only has to be there.
        'ardent-omoidasu': 1,
        // Everything below is deliberately naked: its job is to participate,
        // be honored, and pay 1 honor on the way out.
        'chronicler-of-conquests': 0,
        'steward-of-law': 0,
        // Sacrificed by its own Action.
        'kami-unleashed': 0,
        'implacable-magistrate': 0,
        'bushido-adherent': 0,
        'righteous-samurai': 0,
        'hero-of-three-trees': 0,
        'kitsu-spiritcaller': 0
    },

    dynastyAbilityValueById: {
        // Doubles a claimed ring — four honor off one air claim.
        'akodo-toturi': 6,
        // Free honored body plus a board-wide military aura.
        'honored-general': 5,
        // Repeatable faucets, in descending reliability.
        'bushido-adherent': 4,
        'hero-of-three-trees': 4,
        'chronicler-of-conquests': 4,
        'revered-ikoma': 4,
        'ardent-omoidasu': 4,
        'ikoma-prodigy': 3,
        'righteous-samurai': 3,
        // Dire: it does not bow as a result of conflict resolution, so it
        // defends EVERY conflict of the round off one body. For a deck whose
        // plan is to stall until the faucets add up that is worth more than
        // any single-conflict payoff, and it is glory 3 on top.
        'lion-s-pride-paragon': 5,
        // The recursion engine: bows to put the best body in either discard
        // pile straight into the conflict, ready.
        'kitsu-spiritcaller': 4,
        // Switches off the whole dishonor half of the field.
        'steward-of-law': 2,
        // Real but narrow: it blanks THEIR unhonored attackers only while it
        // attacks, and ours too, so it is priced below the plain faucets — but
        // above the 1-cost bodies, because against a deck that never honors
        // anything it wins the conflict on its own.
        'implacable-magistrate': 4,
        'kami-unleashed': 2
    },
    dynastyMilitaryWeight: 0.75,
    dynastyPoliticalWeight: 0.5,
    dynastyGloryWeight: 1,
    dynastyEfficiencyWeight: 2,
    towerCardIds: ['akodo-toturi'],
    towerMinimumTotalFate: 7,
    maximumBoardCharacters: 7,

    honorTargetPriority: [
        // Glory 3 and the biggest body: the honored token is +3 to both skills.
        'akodo-toturi',
        'lion-s-pride-paragon',
        // Honoring it is what stops it blanking our own attack.
        'implacable-magistrate',
        'bushido-adherent',
        'righteous-samurai',
        'hero-of-three-trees',
        'ardent-omoidasu',
        'revered-ikoma',
        'kitsu-spiritcaller',
        'honored-general',
        'ikoma-prodigy',
        'chronicler-of-conquests',
        'kami-unleashed',
        'steward-of-law'
    ],

    chrysanthemumCardId: 'way-of-the-chrysanthemum',
    chrysanthemumBid: 1,
    chrysanthemumCost: 2,
    chrysanthemumReserveFate: 2,

    privilegedPositionCardId: 'privileged-position',
    privilegedPositionCost: 2,
    privilegedPositionReserveFate: 2,

    honorProvinceId: 'kenson-no-gakka',

    magistrateCardIds: ['implacable-magistrate'],
    magistrateMinimumHonoredShare: 1,

    battlefieldAttachmentCardIds: ['under-amaterasu-s-gaze'],
    // Deck revision 0.6 dropped The Art of War for The Roar of the Lioness, so
    // the third entry no longer names a card in the list and the preference
    // resolves to Kenson / Before the Throne and then the generic fallback.
    // That is EXACTLY what was measured with the province swap; adding the Roar
    // here would be an unmeasured change on top of it. Left as-is deliberately.
    battlefieldProvincePreference: ['kenson-no-gakka', 'before-the-throne', 'the-art-of-war'],
    battlefieldCardIds: ['under-amaterasu-s-gaze', 'exposed-courtyard'],

    proceduralInterferenceCardId: 'procedural-interference',
    proceduralInterferenceProvincePriority: [
        // Refills to THREE cards, so it is the only province where the discard
        // branch is a real loss.
        'city-of-the-rich-frog',
        'fertile-fields',
        'meditations-on-the-tao',
        'rally-to-the-cause',
        'ancestral-lands'
    ],

    heroOfThreeTreesCardId: 'hero-of-three-trees',
    heroPrefersHonor: true
};

type Axis = 'military' | 'political';

const numberOr = (value: any, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

// Live skill where the engine filled a summary, printed skill otherwise.
const skillOf = (card: any, axis: Axis): number => {
    const summary = axis === 'military' ? card?.militarySkillSummary : card?.politicalSkillSummary;
    const live = Number(summary?.stat);
    return Math.max(0, Number.isFinite(live) ? live : numberOr(card?.[axis], 0));
};

const gloryOf = (card: any): number =>
    Math.max(0, numberOr(card?.glorySummary?.stat ?? card?.glory, 0));

const byUuid = (left: any, right: any): number =>
    String(left?.uuid || '').localeCompare(String(right?.uuid || ''));

/**
 * Decision helpers the policy delegates to when — and only when — the resolved
 * DeckProfile carries a LionHonorProfile. Stateless.
 */
export class LionHonorTactics {
    constructor(public profile: LionHonorProfile) {}

    // ---- the race ----------------------------------------------------------

    // Are we near the 25-honor win? Once true the deck stops trading honor
    // for board and just races.
    honorWinClose(myHonor: number): boolean {
        return numberOr(myHonor, 0) >= this.profile.honorWinCloseThreshold;
    }

    // ---- ring steering -----------------------------------------------------

    /**
     * Added to the generic ring score. The Toturi term is conditional on him
     * actually being on the board, so a game where he never arrives leaves the
     * ring choice exactly where the air/fire weights put it.
     */
    ringBonus(element: string, myHonor: number, myCharacters: any[] = []): number {
        const lower = String(element || '').toLowerCase();
        let bonus = 0;
        if(lower === 'air') {
            bonus += this.profile.airRingBonus + (this.honorWinClose(myHonor) ? this.profile.airRingCloseBonus : 0);
        } else if(lower === 'fire') {
            bonus += this.profile.fireRingBonus;
        }
        if(this.profile.toturiRingElements.includes(lower) &&
            (myCharacters || []).some((card) => card && !card.bowed &&
                this.profile.toturiCardIds.includes(String(card?.id || '')))) {
            bonus += this.profile.toturiRingBonus;
        }
        return bonus;
    }

    // ---- conflict axis -----------------------------------------------------

    // Standing preference for the political axis, where this deck's honor
    // gain lives.
    politicalAxisBonus(): number {
        return this.profile.politicalAxisBonus;
    }

    // ---- fate investment ---------------------------------------------------

    // Per-character extra-fate table; null defers to the generic economy.
    desiredAdditionalFate(cardId?: string): number | null {
        if(!cardId || !Object.prototype.hasOwnProperty.call(this.profile.additionalFateByCharacterId, cardId)) {
            return null;
        }
        return Math.max(0, numberOr(this.profile.additionalFateByCharacterId[cardId], 0));
    }

    /**
     * Fate held back through the dynasty phase for a conflict card that has to
     * be castable the moment its window opens. Both of these are reactions to
     * something the OPPONENT does (an honor bid, a higher dial), so there is no
     * later turn to save up on.
     */
    desiredDynastyFateReserve(hand: any[]): number {
        let reserve = 0;
        for(const card of hand || []) {
            if(card?.id === this.profile.chrysanthemumCardId) {
                reserve = Math.max(reserve, this.profile.chrysanthemumReserveFate);
            }
            if(card?.id === this.profile.privilegedPositionCardId) {
                reserve = Math.max(reserve, this.profile.privilegedPositionReserveFate);
            }
        }
        return reserve;
    }

    // ---- dynasty buying ----------------------------------------------------

    /** Standalone worth of a body to this deck, before its cost. */
    dynastyValue(card: any, stats?: DynastyPrintedStats): number {
        const ability = numberOr(this.profile.dynastyAbilityValueById[String(card?.id || '')], 0);
        return printedStatOf(card, stats, 'military') * this.profile.dynastyMilitaryWeight +
            printedStatOf(card, stats, 'political') * this.profile.dynastyPoliticalWeight +
            // Glory is honor income twice over here: it is skill while honored,
            // and honoring is what the deck does all game.
            printedStatOf(card, stats, 'glory') * this.profile.dynastyGloryWeight +
            ability;
    }

    /**
     * Which character to buy next. Width with ONE tower: every body is a faucet
     * whose value barely scales with cost, so the score divides by cost — but
     * Akodo Toturi doubles a ring and is worth the whole window once there is
     * enough fate for him to arrive decorated.
     *
     * Returns null to pass the window, keeping the remaining fate.
     */
    pickDynastyCharacter(input: {
        playable: any[];
        costs: Record<string, number>;
        fate: number;
        board: any[];
        reserve?: number;
        // Exact PRINTED skills/glory per province-card uuid. Absent = the old
        // reading, where a province card's stats are all `undefined` and the
        // ranking collapses onto `dynastyAbilityValueById` alone.
        printedStats?: Record<string, DynastyPrintedStats>;
    }): any | null {
        // Zero is a real budget — this list has 1-cost bodies and width is the
        // plan — so only a NEGATIVE budget (reserve exceeds the pool) passes.
        const budget = numberOr(input.fate, 0) - Math.max(0, numberOr(input.reserve, 0));
        if(budget < 0) {
            return null;
        }
        if((input.board || []).length >= this.profile.maximumBoardCharacters) {
            return null;
        }
        const costOf = (card: any) => numberOr(input.costs?.[String(card?.uuid || '')] ?? card?.cost, 0);
        const affordable = (input.playable || [])
            .filter((card) => card && card.type === 'character')
            .filter((card) => costOf(card) <= budget);
        if(affordable.length === 0) {
            return null;
        }
        const isTower = (card: any) => this.profile.towerCardIds.includes(String(card?.id || ''));
        const towerOnBoard = (input.board || []).some(isTower);
        const tower = affordable.find(isTower);
        if(tower && !towerOnBoard && numberOr(input.fate, 0) >= this.profile.towerMinimumTotalFate) {
            return tower;
        }
        // When the tower branch DECLINES, the tower must also drop out of the
        // general sort: its raw 6 military would win that ranking and buy it
        // naked, which is the bug that made the same knob measure bit-identical
        // on the Crane Honor list (see `docs/bot-crane-honor.md`).
        const score = (card: any) => {
            const value = this.dynastyValue(card, input.printedStats?.[String(card?.uuid || '')]);
            const cost = costOf(card);
            return value + (this.profile.dynastyEfficiencyWeight * value) / (cost + 1);
        };
        return affordable.slice()
            .filter((card) => !isTower(card))
            .sort((a, b) => score(b) - score(a) ||
                costOf(a) - costOf(b) ||
                byUuid(a, b))[0] || null;
    }

    // ---- honoring ----------------------------------------------------------

    /** Deck-specific rank; lower is better. Unlisted cards sort last. */
    honorRank(card: any): number {
        const index = this.profile.honorTargetPriority.indexOf(String(card?.id || ''));
        return index >= 0 ? index : this.profile.honorTargetPriority.length;
    }

    /**
     * How much the token is worth RIGHT NOW; lower is better, and it outranks
     * the printed priority list. A bowed body, and a body at home, contribute
     * no skill, so during a live conflict the glory an honored token adds only
     * shows up on a READY PARTICIPANT. `doubleHonor` marks the sources that
     * honor the same character twice (Soul Beyond Reproach), whose second half
     * only pays on a DISHONORED body and no-ops on anything else.
     */
    private honorUrgency(card: any, opts: HonorTargetOptions): number {
        const liveNow = !!opts.activeConflict && !!card?.inConflict && !card?.bowed;
        const doublePays = !!opts.doubleHonor && !!card?.isDishonored;
        return (liveNow ? 0 : 2) + (doublePays ? 0 : 1);
    }

    /**
     * Who gets the honored token. The shared `PersonalHonorTactics` ranks by
     * GLORY, which is right when the token is only a stat swing; here it is
     * also 1 honor when the body dies and the enabler for Implacable
     * Magistrate, so the deck's own ordering runs after the live-swing tier and
     * glory breaks its ties.
     */
    pickHonorTarget(cards: any[], opts: HonorTargetOptions = {}): any | null {
        const pool = (cards || []).filter((card) => card && !card.isHonored);
        const list = pool.length > 0 ? pool : (cards || []).filter(Boolean);
        if(list.length === 0) {
            return null;
        }
        return list.slice().sort((a, b) =>
            this.honorUrgency(a, opts) - this.honorUrgency(b, opts) ||
            this.honorRank(a) - this.honorRank(b) ||
            gloryOf(b) - gloryOf(a) ||
            (b.inConflict ? 1 : 0) - (a.inConflict ? 1 : 0) ||
            (a.bowed ? 1 : 0) - (b.bowed ? 1 : 0) ||
            skillOf(b, 'military') - skillOf(a, 'military') ||
            byUuid(a, b)
        )[0] || null;
    }

    // ---- Way of the Chrysanthemum ------------------------------------------

    /**
     * The card doubles honor RECEIVED from a bid, and honor flows to the LOWER
     * bidder. With a copy in hand and the fate to cast it, bid the floor.
     * Returns null when it is not live, leaving the shared draw-bid policy
     * exactly where it was.
     */
    adjustDrawBid(hand: any[], fate: number): number | null {
        const holding = (hand || []).some((card) => card?.id === this.profile.chrysanthemumCardId);
        if(!holding || numberOr(fate, 0) < this.profile.chrysanthemumCost) {
            return null;
        }
        return this.profile.chrysanthemumBid;
    }

    // ---- Kenson no Gakka ---------------------------------------------------

    // ---- Implacable Magistrate ---------------------------------------------

    // Magistrate by card id — several of the deck's effects key off the trait.
    isMagistrate(card: any): boolean {
        return !!card?.id && this.profile.magistrateCardIds.includes(card.id);
    }

    /**
     * Order the attacker candidates so honored bodies go in first and the
     * Magistrate goes in last. The Magistrate blanks every UNHONORED attacker
     * including our own, so committing it beside plain bodies is a skill LOSS —
     * but it is still a legal 2/2 attacker when the rest of the attack is
     * honored, or when it is the only body available.
     */
    orderAttackers(candidates: any[], axis: Axis, committed: any[] = []): any[] {
        const list = (candidates || []).slice();
        const magistrateCommitted = (committed || []).some((card) => this.isMagistrate(card));
        // Once it is already IN the conflict the ordering still matters — every
        // unhonored body we add behind it contributes nothing — so the early-out
        // has to look at both sides, not just the candidates.
        if(!magistrateCommitted && !list.some((card) => this.isMagistrate(card))) {
            return list;
        }
        const unhonoredCommitted = (committed || []).filter((card) =>
            !card?.isHonored && !this.isMagistrate(card)).length;
        const honoredCommitted = (committed || []).filter((card) => card?.isHonored).length;
        return list.sort((left, right) => {
            const rank = (card: any) => {
                if(this.isMagistrate(card)) {
                    // Only reach for it once the attack it would join is
                    // honored enough for its restriction to cost nothing.
                    const others = unhonoredCommitted + honoredCommitted;
                    const share = others === 0 ? 1 : honoredCommitted / others;
                    return share >= this.profile.magistrateMinimumHonoredShare ? 0 : 2;
                }
                // With the Magistrate already in, an unhonored body adds zero.
                if(magistrateCommitted && !card?.isHonored) {
                    return 3;
                }
                return card?.isHonored ? 0 : 1;
            };
            return rank(left) - rank(right) || skillOf(right, axis) - skillOf(left, axis) ||
                byUuid(left, right);
        });
    }

    // ---- Under Amaterasu's Gaze --------------------------------------------

    // Is this a Battlefield attachment, for Chronicler of Conquests?
    isBattlefieldAttachment(cardId?: string): boolean {
        return !!cardId && this.profile.battlefieldAttachmentCardIds.includes(cardId);
    }

    /**
     * Which of our unbroken provinces to hang the Battlefield on. Preference
     * order first (the stronghold province is where the deck expects to be
     * attacked, and it is also where Chronicler of Conquests will be
     * defending), then whatever is left, so the card is never stranded.
     */
    pickBattlefieldProvince(provinces: any[]): any | null {
        const usable = (provinces || []).filter((card) => card &&
            !card.isBroken && !card.broken &&
            !(card.attachments || []).some((attachment: any) =>
                this.profile.battlefieldCardIds.includes(String(attachment?.id || ''))));
        const pool = usable.length > 0 ? usable : (provinces || []).filter(Boolean);
        if(pool.length === 0) {
            return null;
        }
        const rank = (card: any) => {
            const index = this.profile.battlefieldProvincePreference.indexOf(String(card?.id || ''));
            return index >= 0 ? index : this.profile.battlefieldProvincePreference.length;
        };
        return pool.slice().sort((a, b) => rank(a) - rank(b) ||
            (b.inConflict ? 1 : 0) - (a.inConflict ? 1 : 0) || byUuid(a, b))[0] || null;
    }

    // ---- Procedural Interference -------------------------------------------

    /**
     * Whichever of their provinces makes the choice hurt most. A province that
     * refills to three cards loses three; otherwise take the one holding the
     * most (or, all else equal, the most expensive) visible card. Either
     * branch of the card pays us, so there is no "bad" target — only a better
     * one.
     */
    pickInterferenceProvince(provinces: any[], cardCountByLocation: Record<string, number> = {}): any | null {
        const usable = (provinces || []).filter((card) => card && !card.isBroken && !card.broken);
        if(usable.length === 0) {
            return null;
        }
        const rank = (card: any) => {
            const index = this.profile.proceduralInterferenceProvincePriority
                .indexOf(String(card?.id || ''));
            return index >= 0 ? index : this.profile.proceduralInterferenceProvincePriority.length;
        };
        const count = (card: any) => numberOr(cardCountByLocation?.[String(card?.location || '')], 0);
        return usable.slice().sort((a, b) => rank(a) - rank(b) || count(b) - count(a) ||
            byUuid(a, b))[0] || null;
    }

    // ---- Hero of Three Trees -----------------------------------------------

    /**
     * "either gain 1 honor, or the attacked province gets -1 strength". The
     * honor is the win condition, so it is the default — but a single point of
     * strength that turns a failed attack into a BREAK is worth more than one
     * honor, and only that exact case flips the choice.
     */
    heroPrefersHonorOverStrength(input: {
        amAttacker?: boolean;
        strengthNeeded?: number;
    }): boolean {
        if(!this.profile.heroPrefersHonor) {
            return false;
        }
        if(!input.amAttacker) {
            return true;
        }
        const needed = numberOr(input.strengthNeeded, 0);
        // Exactly one point short: the -1 completes the break.
        return !(needed === 1);
    }

}
