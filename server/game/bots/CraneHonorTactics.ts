// Crane "Courtier Honor" playstyle for the heuristic bot (EmeraldDB
// db118806, Seven Fold Palace).
//
// THE ARCHETYPE: this deck does not win by conquest. It wins by reaching 25
// honor, and every card in it is a small honor faucet:
//
//   - an HONORED character that leaves play gains its controller 1 honor
//     (`drawcard.ts:1026`), so a wide board of honored 0-1 cost Courtiers is
//     literally an income stream every fate phase,
//   - Seven Fold Palace bows for 2 honor after an honored character wins a
//     conflict AS THE ATTACKER — so the deck must attack, not only turtle,
//   - the AIR ring resolves to honor on both halves (gain 2 / take 1), and
//     three of the deck's five provinces are air (Before the Throne, Driven by
//     Courage, Tsuma), which the Seeker of Air role turns into fate as well,
//   - Doji Hotaru gains 1 honor per opponent card played in her conflicts,
//     Honored Blade 1 per win, Bonsai Garden 1 per air conflict, Kakita Asami
//     takes 1 whenever she is winning the political count,
//   - Way of the Chrysanthemum DOUBLES honor received from a bid difference,
//     which makes being the LOW bidder the plan rather than a concession.
//
// The consequence for the shared knobs is that honor is not a cost here, it is
// the scoreboard: the draw dial bids low on purpose (the higher bidder pays the
// difference), the conflict axis is political (the board is Courtiers), and the
// Imperial Favor is claimed on the political side.
//
// All behavior is DATA-gated: the tactics exist only when the resolved
// DeckProfile carries a CraneHonorProfile (derived from `seven-fold-palace`),
// so every other deck — including the two other Crane lists, which share Tsuma
// and most of the honor events — keeps unchanged generic behavior.
//
// WIRED KNOBS (each is read by a real decision; the rest are descriptive and
// marked individually):
//   airRingBonus/fireRingBonus/airRingCloseBonus -> JigokuBotPolicy.ringScore
//   politicalAxisBonus/asamiAxisBonus            -> preferredConflictType
//   additionalFateByCharacterId                  -> desiredAdditionalFate
//   honorTargetPriority                          -> pickHonorTarget
//   festivalMinimumTargets                       -> playbook festival gate
//   eleganceMinimum/MaxPrintedCost               -> playbook elegance gate
//   chrysanthemum*                               -> adjustDrawBid / fate reserve
//   hostTargetPriority/hostTowerFateFloor        -> pickHostTarget
//   save*                                        -> shouldSaveHonoredCharacter
//   tryAgainMinimumAttackerSkill                 -> pickMoveHomeTarget
//
// NOT WIRED — the live gate is a `PlaybookEntry`, which cannot see the deck
// profile, so these mirror a constant that lives in `CardPlaybook.ts`. Marked
// individually below. Do NOT A/B them without moving the gate first; they will
// read bit-identical every time (the lesson from `CrabSacrificeProfile`'s
// Castle knobs, which measured inert three ways before the wire was found).
//   asamiCardId                        (used by politicalAxisBonus, but the
//                                       Action gate itself is in the playbook)
//   strongholdCardId / strongholdRequiresHonoredAttacker
//   festivalMinimum* / eleganceMinimum* / eleganceMaxPrintedCost
//   airProvinceIds
//   honorVictoryTarget / honorSpendFloor — read only by `honorToVictory` and
//     `canSpendHonor`, which no policy path calls yet. The shared
//     `honorRaceAware` / `honorRace` limits do this job today; these exist for
//     a future crane-honor-specific spend gate and are inert until one lands.

import type { HonorTargetOptions, DynastyPrintedStats } from './SharedCardTactics.js';
import { printedStatOf } from './SharedCardTactics.js';

export interface CraneHonorProfile {
    // ---- the honor race ----------------------------------------------------
    // The printed win condition. Everything below is measured against it.
    honorVictoryTarget: number;
    // Own honor at or above which the race is CLOSE: the deck stops selling
    // honor for board and starts steering every ring/conflict at the finish.
    honorWinCloseThreshold: number;
    // Never pay a voluntary honor cost that would end at or below this. Zero
    // disables the floor (the shared honorRace limits still apply).
    honorSpendFloor: number;

    // ---- ring steering -----------------------------------------------------
    // Air resolves "gain 2 honor" or "take 1 honor from your opponent"; for a
    // deck racing to 25 that is the single most valuable ring on the board and
    // the generic score (15, the `default` branch) puts it dead last.
    airRingBonus: number;
    // Fire honors a character, which is a body pump AND future leave-play
    // honor. Second choice when air is gone.
    fireRingBonus: number;
    // Extra air weight once `honorWinCloseThreshold` is reached.
    airRingCloseBonus: number;

    // ---- conflict axis -----------------------------------------------------
    // The board is Courtiers: 3 political on a 1-cost, 6 on Hotaru. Military
    // exists only on Sotorii and the Legion. A flat nudge toward political,
    // expressed the same way Lion Duelist expresses its card-engine axis.
    politicalAxisBonus: number;
    // Kakita Asami's Action only pays in a POLITICAL conflict she is winning,
    // so a live Asami is worth more than her skill on that axis.
    asamiAxisBonus: number;
    asamiCardId: string;

    // ---- Seven Fold Palace -------------------------------------------------
    strongholdCardId: string;
    // The printed condition is engine-checked; this only stops the bot from
    // wasting the click. `false` fires it on any legal offer.
    strongholdRequiresHonoredAttacker: boolean;

    // ---- fate investment ---------------------------------------------------
    // Fate on a body is fate NOT spent on another body, and this deck wants
    // width (every honored body is 1 honor when it dies). Only the tower earns
    // real fate; the cheap Courtiers are explicitly zero.
    additionalFateByCharacterId: Record<string, number>;

    // ---- dynasty buying ----------------------------------------------------
    // WIDTH, not depth. Every honored body pays 1 honor when it dies, Asahina
    // Storyteller turns each of them into a card, and Festival/Elegance/Voice
    // of Honor all scale on the count — so four 1-cost Courtiers beat one
    // 4-cost body. The shared duel economy (which this deck also derives,
    // through Tsuma) does the opposite and banks fate on a tower, which is why
    // this ranking has to run first.
    dynastyAbilityValueById: Record<string, number>;
    dynastyPoliticalWeight: number;
    dynastyGloryWeight: number;
    // Divisor term: value per (cost + 1). Higher favors cheap width.
    dynastyEfficiencyWeight: number;
    // Total fate that must be available before committing to the tower, so it
    // arrives with fate on it rather than naked.
    towerMinimumTotalFate: number;
    // Stop buying past this many own characters — more bodies than this cannot
    // all participate and the fate is better kept for conflict cards.
    maximumBoardCharacters: number;

    // ---- honoring ----------------------------------------------------------
    // Who receives an honor token first, ahead of the shared glory ordering.
    // The payoff is not only skill: Asami wants to survive to drain, Hotaru
    // wants to stay, Storyteller grants Sincerity to honored Cranes.
    honorTargetPriority: readonly string[];
    // Festival for the Fortunes costs 3 and honors EVERY character (both
    // sides). Only worth it on a wide own board that is ahead on bodies.
    festivalMinimumTargets: number;
    festivalMinimumBoardLead: number;
    // Elegance and Grace readies up to 2 honored characters totalling 6
    // printed cost or less.
    eleganceMinimumTargets: number;
    eleganceMaxPrintedCost: number;

    // ---- Way of the Chrysanthemum ------------------------------------------
    // "After 1 or more honor is given to you from an honor bid – gain that
    // much honor." Being the LOW bidder is therefore worth double, and the
    // card costs 2, so the fate has to still be there when the dial resolves.
    chrysanthemumCardId: string;
    chrysanthemumBid: number;
    chrysanthemumCost: number;
    // Keep this much fate through the dynasty phase while a copy is in hand.
    chrysanthemumReserveFate: number;

    // ---- Benevolent Host ---------------------------------------------------
    // "Choose a Courtier in your provinces - put that character into play."
    // A free body, and a free honored one out of Tsuma.
    hostCardId: string;
    hostTargetPriority: readonly string[];
    // The tower is worth more BOUGHT with fate than dropped in naked, unless
    // the game is nearly over or the province it sits in is already broken.
    hostTowerCardIds: readonly string[];
    hostTowerSkipUnlessDeciding: boolean;

    // ---- honored-token saves -----------------------------------------------
    // Pledge of Loyalty / Stand Your Ground discard the honored TOKEN instead
    // of letting the character leave play. That saves the body but forgoes the
    // 1 honor the leave-play would have paid, so it is only correct on a body
    // worth more than one honor.
    saveCardIds: readonly string[];
    saveMinimumBodyValue: number;
    saveMinimumFate: number;

    // ---- Try Again Tomorrow ------------------------------------------------
    // Moves an ATTACKING character home: a defensive removal. Only worth a
    // card against an attacker actually carrying the conflict.
    tryAgainMinimumAttackerSkill: number;

    // ---- Driven by Courage -------------------------------------------------
    // The Action is legal only at an AIR province; listed so the playbook gate
    // does not have to guess the element off a serialized province.
    airProvinceIds: readonly string[];
}

export const CRANE_HONOR_DEFAULTS: CraneHonorProfile = {
    honorVictoryTarget: 25,
    honorWinCloseThreshold: 18,
    honorSpendFloor: 4,

    // Air is 15 in the generic score (the `default` branch) against earth 40
    // and void 50. This lifts it above both without touching the fate-pile
    // component, which still dominates at 1000+.
    airRingBonus: 30,
    fireRingBonus: 8,
    airRingCloseBonus: 20,

    politicalAxisBonus: 3,
    asamiAxisBonus: 3,
    asamiCardId: 'kakita-asami',

    strongholdCardId: 'seven-fold-palace',
    strongholdRequiresHonoredAttacker: true,

    additionalFateByCharacterId: {
        // The only body worth keeping for the long game: unlimited honor off
        // every opposing card, 6 political, and a Champion the deck can build
        // conflicts around.
        'doji-hotaru-2': 3,
        // Military insurance. One or two fate to survive a fate phase; his
        // value is Pride plus the +3 glory Action, not the body.
        'hantei-sotorii': 2,
        'iron-crane-legion': 2,
        // The Sincerity engine only pays while it is still on the table.
        'asahina-storyteller': 1,
        // Everything below is deliberately naked: its job is to be honored,
        // participate once, and die for 1 honor.
        'doji-diplomat': 0,
        'callow-delegate': 0,
        'chancellor-s-aide': 0,
        'brash-samurai': 0,
        'doji-whisperer': 0,
        'savvy-politician': 0,
        'kakita-asami': 1,
        'benevolent-host': 0
    },

    dynastyAbilityValueById: {
        // Repeatable honor drains: the reason to buy the deck at all.
        'kakita-asami': 4,
        'doji-hotaru-2': 5,
        // Turns the whole honored board into cards.
        'asahina-storyteller': 3,
        // Two bodies for one card.
        'benevolent-host': 4,
        // Honors a second character for free.
        'savvy-politician': 2,
        // Free bodies whose deaths pay.
        'callow-delegate': 2,
        'chancellor-s-aide': 2,
        'doji-diplomat': 2,
        'brash-samurai': 1,
        'hantei-sotorii': 1,
        'iron-crane-legion': 1,
        'doji-whisperer': 0
    },
    dynastyPoliticalWeight: 1,
    dynastyGloryWeight: 0.75,
    dynastyEfficiencyWeight: 2.5,
    towerMinimumTotalFate: 7,
    maximumBoardCharacters: 6,

    honorTargetPriority: [
        // Drains an honor every political conflict she wins.
        'kakita-asami',
        // Unlimited honor, and the honored token is +3 skill on her glory.
        'doji-hotaru-2',
        // Honored Cranes gain Sincerity from him, so honoring him first turns
        // the rest of the board into cards as it dies.
        'asahina-storyteller',
        // Pride: honoring him early skips the win requirement.
        'hantei-sotorii',
        // Chains: honoring it honors a second character.
        'savvy-politician',
        'doji-whisperer',
        'iron-crane-legion',
        'brash-samurai',
        'benevolent-host',
        'chancellor-s-aide',
        'callow-delegate',
        'doji-diplomat'
    ],
    festivalMinimumTargets: 3,
    festivalMinimumBoardLead: 1,
    eleganceMinimumTargets: 2,
    eleganceMaxPrintedCost: 6,

    chrysanthemumCardId: 'way-of-the-chrysanthemum',
    chrysanthemumBid: 1,
    chrysanthemumCost: 2,
    chrysanthemumReserveFate: 2,

    hostCardId: 'benevolent-host',
    hostTargetPriority: [
        'kakita-asami', 'asahina-storyteller', 'savvy-politician', 'doji-whisperer',
        'chancellor-s-aide', 'callow-delegate', 'doji-diplomat', 'benevolent-host'
    ],
    hostTowerCardIds: ['doji-hotaru-2'],
    hostTowerSkipUnlessDeciding: true,

    saveCardIds: ['pledge-of-loyalty', 'stand-your-ground'],
    // One honor is what the leave-play would have paid, so the body has to be
    // worth clearly more than that. Skill 4 is roughly Asami/Storyteller.
    saveMinimumBodyValue: 4,
    saveMinimumFate: 1,

    tryAgainMinimumAttackerSkill: 3,

    airProvinceIds: ['before-the-throne', 'driven-by-courage', 'tsuma']
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

/**
 * Decision helpers the policy delegates to when — and only when — the resolved
 * DeckProfile carries a CraneHonorProfile. Stateless.
 */
export class CraneHonorTactics {
    constructor(public profile: CraneHonorProfile) {}

    // ---- the race ----------------------------------------------------------

    /** Within striking distance of the 25-honor win. */
    honorWinClose(myHonor: number): boolean {
        return numberOr(myHonor, 0) >= this.profile.honorWinCloseThreshold;
    }

    // ---- ring steering -----------------------------------------------------

    /**
     * Air is honor income on BOTH halves of its resolution and the generic
     * `ringScore` files it under `default` at 15, below earth and void. Fire
     * honors a character, which is skill now and 1 honor when it dies.
     */
    ringBonus(element: string, myHonor: number): number {
        const close = this.honorWinClose(myHonor) ? this.profile.airRingCloseBonus : 0;
        switch(String(element || '').toLowerCase()) {
            case 'air':
                return this.profile.airRingBonus + close;
            case 'fire':
                return this.profile.fireRingBonus;
            default:
                return 0;
        }
    }

    // ---- conflict axis -----------------------------------------------------

    /**
     * A Courtier board with an honor drain on it. The bonus is small on
     * purpose: it breaks ties toward political without overriding a genuine
     * military opportunity (an honored Sotorii is a real attacker).
     */
    politicalAxisBonus(myCharacters: any[]): number {
        const asamiReady = (myCharacters || []).some((card) =>
            card?.id === this.profile.asamiCardId && !card.bowed);
        return this.profile.politicalAxisBonus + (asamiReady ? this.profile.asamiAxisBonus : 0);
    }

    // ---- fate investment ---------------------------------------------------

    desiredAdditionalFate(cardId?: string): number | null {
        if(!cardId || !Object.prototype.hasOwnProperty.call(this.profile.additionalFateByCharacterId, cardId)) {
            return null;
        }
        return Math.max(0, numberOr(this.profile.additionalFateByCharacterId[cardId], 0));
    }

    /** Hold fate through the dynasty phase for a Chrysanthemum in hand. */
    desiredDynastyFateReserve(hand: any[]): number {
        const holding = (hand || []).some((card) => card?.id === this.profile.chrysanthemumCardId);
        return holding ? this.profile.chrysanthemumReserveFate : 0;
    }

    // ---- dynasty buying ----------------------------------------------------

    /** Standalone worth of a body to this deck, before its cost. */
    dynastyValue(card: any, stats?: DynastyPrintedStats): number {
        const ability = numberOr(this.profile.dynastyAbilityValueById[String(card?.id || '')], 0);
        return printedStatOf(card, stats, 'political') * this.profile.dynastyPoliticalWeight +
            printedStatOf(card, stats, 'glory') * this.profile.dynastyGloryWeight +
            ability;
    }

    /**
     * Which character to buy next. WIDTH first: the score divides by cost, so a
     * 1-cost Courtier with a leave-play payoff outranks a 4-cost body of the
     * same raw skill. The tower is the one exception and only when there is
     * enough fate to arrive decorated.
     *
     * Returns null to pass the window — the caller keeps the remaining fate.
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
        // Zero is a real budget: Doji Diplomat costs 0 and the deck runs three
        // of them, so a `<= 0` guard here silently refuses the widest bodies in
        // the list exactly when the fate has run out and width is all that is
        // left. Only a NEGATIVE budget (the reserve exceeds the pool) passes.
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
        // The tower is worth the whole window, but only DECORATED. Below the
        // threshold it is a 5-cost 3/6 that dies at the next fate phase, which
        // is strictly worse than three Courtiers — so when the tower branch
        // declines, the tower is removed from the general ranking too. Its raw
        // value would otherwise win that sort and buy it naked anyway.
        const towerIds = this.profile.hostTowerCardIds;
        const isTower = (card: any) => towerIds.includes(String(card?.id || ''));
        const towerOnBoard = (input.board || []).some(isTower);
        const tower = affordable.find(isTower);
        if(tower && !towerOnBoard && numberOr(input.fate, 0) >= this.profile.towerMinimumTotalFate) {
            return tower;
        }
        const score = (card: any) => {
            const value = this.dynastyValue(card, input.printedStats?.[String(card?.uuid || '')]);
            const cost = costOf(card);
            return value + (this.profile.dynastyEfficiencyWeight * value) / (cost + 1);
        };
        return affordable.slice()
            .filter((card) => !isTower(card))
            .sort((a, b) => score(b) - score(a) ||
                costOf(a) - costOf(b) ||
                String(a?.uuid || '').localeCompare(String(b?.uuid || '')))[0] || null;
    }

    // ---- honoring ----------------------------------------------------------

    /** Deck-specific rank; lower is better. Unlisted cards sort last. */
    honorRank(card: any): number {
        const index = this.profile.honorTargetPriority.indexOf(String(card?.id || ''));
        return index >= 0 ? index : this.profile.honorTargetPriority.length;
    }

    /**
     * How much the token is worth RIGHT NOW; lower is better, and it outranks
     * the printed priority list. A bowed character contributes no skill, and a
     * character at home contributes none either, so during a live conflict the
     * glory on an honored token only shows up on a READY PARTICIPANT — the
     * priority list on its own happily hands it to a bowed Asami at home for
     * zero swing. `doubleHonor` marks the sources that honor twice (Soul Beyond
     * Reproach): those want a DISHONORED body, where the second half of the
     * effect is the difference between -glory and +glory instead of a no-op.
     */
    private honorUrgency(card: any, opts: HonorTargetOptions): number {
        const liveNow = !!opts.activeConflict && !!card?.inConflict && !card?.bowed;
        const doublePays = !!opts.doubleHonor && !!card?.isDishonored;
        return (liveNow ? 0 : 2) + (doublePays ? 0 : 1);
    }

    /**
     * Who to put the honored token on. The shared PersonalHonorTactics ranks by
     * GLORY, which is right when the token is only a stat swing; here the token
     * is also an engine trigger (Storyteller's Sincerity, Asami's drain), so the
     * deck's own priority runs after the live-swing tier and glory breaks ties.
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
            skillOf(b, 'political') - skillOf(a, 'political') ||
            String(a?.uuid || '').localeCompare(String(b?.uuid || ''))
        )[0] || null;
    }

    /** Elegance and Grace: up to 2 honored characters, 6 printed cost total. */
    eleganceTargets(myCharacters: any[], printedCosts?: Record<string, number>): any[] {
        const bowed = (myCharacters || []).filter((card) => card && card.bowed && card.isHonored);
        const cost = (card: any) => numberOr(printedCosts?.[String(card?.uuid || '')] ?? card?.cost, 0);
        const ranked = bowed.slice().sort((a, b) =>
            skillOf(b, 'political') + skillOf(b, 'military') -
            (skillOf(a, 'political') + skillOf(a, 'military')) ||
            cost(a) - cost(b));
        const picked: any[] = [];
        let total = 0;
        for(const card of ranked) {
            if(picked.length >= 2) {
                break;
            }
            if(total + cost(card) <= this.profile.eleganceMaxPrintedCost) {
                picked.push(card);
                total += cost(card);
            }
        }
        return picked;
    }

    // ---- Way of the Chrysanthemum ------------------------------------------

    /**
     * The card doubles honor RECEIVED from a bid, and honor flows to the LOWER
     * bidder. With a copy in hand and the fate to cast it, bid the floor.
     * Returns null when the card is not live, which leaves the shared draw-bid
     * policy untouched.
     */
    adjustDrawBid(hand: any[], fate: number): number | null {
        const holding = (hand || []).some((card) => card?.id === this.profile.chrysanthemumCardId);
        if(!holding || numberOr(fate, 0) < this.profile.chrysanthemumCost) {
            return null;
        }
        return this.profile.chrysanthemumBid;
    }

    // ---- Benevolent Host ---------------------------------------------------

    /**
     * A free Courtier out of the provinces. The tower is normally skipped —
     * it is worth far more bought with fate on it — unless the game is being
     * decided now or its province is already broken, in which case a free body
     * beats a discarded one.
     */
    pickHostTarget(candidates: any[], input: {
        myHonor: number;
        brokenProvinceLocations?: readonly string[];
    }): any | null {
        const usable = (candidates || []).filter(Boolean);
        if(usable.length === 0) {
            return null;
        }
        const broken = new Set((input.brokenProvinceLocations || []).map(String));
        const towerAllowed = (card: any) => {
            if(!this.profile.hostTowerCardIds.includes(String(card?.id || ''))) {
                return true;
            }
            if(!this.profile.hostTowerSkipUnlessDeciding) {
                return true;
            }
            return this.honorWinClose(input.myHonor) || broken.has(String(card?.location || ''));
        };
        const rank = (card: any) => {
            const index = this.profile.hostTargetPriority.indexOf(String(card?.id || ''));
            return index >= 0 ? index : this.profile.hostTargetPriority.length;
        };
        const allowed = usable.filter(towerAllowed);
        const pool = allowed.length > 0 ? allowed : usable;
        return pool.slice().sort((a, b) =>
            rank(a) - rank(b) ||
            skillOf(b, 'political') - skillOf(a, 'political') ||
            String(a?.uuid || '').localeCompare(String(b?.uuid || ''))
        )[0] || null;
    }

    // ---- honored-token saves -----------------------------------------------

    /**
     * Pledge of Loyalty and Stand Your Ground trade the honored TOKEN for the
     * body. The token is worth 1 honor on the way out plus the glory swing, so
     * the save only pays on a body that is genuinely carrying the deck.
     */
    isSaveSource(cardId?: string): boolean {
        return !!cardId && this.profile.saveCardIds.includes(cardId);
    }

    shouldSaveHonoredCharacter(card: any): boolean {
        if(!card || !card.isHonored) {
            return false;
        }
        if(numberOr(card.fate, 0) >= this.profile.saveMinimumFate) {
            return true;
        }
        const value = Math.max(skillOf(card, 'political'), skillOf(card, 'military'));
        return value >= this.profile.saveMinimumBodyValue;
    }

    pickSaveTarget(candidates: any[]): any | null {
        const usable = (candidates || []).filter((card) => this.shouldSaveHonoredCharacter(card));
        if(usable.length === 0) {
            return null;
        }
        return usable.slice().sort((a, b) =>
            numberOr(b.fate, 0) - numberOr(a.fate, 0) ||
            Math.max(skillOf(b, 'political'), skillOf(b, 'military')) -
            Math.max(skillOf(a, 'political'), skillOf(a, 'military')) ||
            String(a?.uuid || '').localeCompare(String(b?.uuid || ''))
        )[0] || null;
    }

    // ---- Try Again Tomorrow ------------------------------------------------

    /**
     * Moves an ATTACKING character home, so it is a defensive tool. Take the
     * attacker carrying the most skill on the live axis; refuse when nothing
     * there is worth a card.
     */
    pickMoveHomeTarget(attackers: any[], axis: Axis): any | null {
        const ranked = (attackers || [])
            .filter((card) => card && card.inConflict && !card.bowed)
            .filter((card) => skillOf(card, axis) >= this.profile.tryAgainMinimumAttackerSkill)
            .sort((a, b) => skillOf(b, axis) - skillOf(a, axis) ||
                String(a?.uuid || '').localeCompare(String(b?.uuid || '')));
        return ranked[0] || null;
    }

    // ---- Driven by Courage -------------------------------------------------

}
