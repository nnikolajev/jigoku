/**
 * How hard to defend once the stronghold province itself is under attack.
 *
 * This is the one place where over-defending is right. Everywhere else in this
 * bot, defense sizing has measured as a free parameter or worse — six separate
 * levers that defend MORE all lost win rate (see `docs/bot-conflict-tempo.md`).
 * The stronghold is different because a break ends the game, so the usual
 * trade ("a ready body next conflict beats a marginal win now") has no next
 * conflict to trade for. `last-conflict-all-in` is exactly that case.
 *
 * `skillBuffer` is extra skill beyond strict prevention; note that zero still
 * keeps the attack strictly below strength + defense, because a TIE at the
 * break threshold breaks a province in Jigoku.
 */
export type StrongholdDefenseAxis = 'military' | 'political';

export interface StrongholdDefenseProfile {
    enabled: boolean;
    // Fair bots follow the user's "keep the strongest defender" rule. Seed 3
    // may reserve a larger minimum set because it knows exact hand threats.
    maxFairDefenders: number;
    maxOmniscientDefenders: number;
    // Extra skill beyond strict break prevention. Zero still keeps the attack
    // strictly below province strength + defense because ties at the break
    // threshold break a province in Jigoku.
    skillBuffer: number;
    // Hidden event/body estimates are contextual. Decks opt in only after
    // mirror validation; zero/false keeps proven visible-board reservation.
    omniscientHandThreatWeight: number;
    omniscientDefenderDisables: boolean;
    holdAllAgainstCovert: boolean;
    attackAllWhenOpponentHasNoConflict: boolean;
    // When both strongholds are exposed the plan is to race. That is correct
    // only if the opponent cannot answer: with a conflict opportunity left and
    // enough ready skill to break OUR stronghold, spending every body on the
    // race loses it by one tempo. The first-player token alternates
    // unconditionally (`RegroupPhase.passFirstPlayer`), so the SECOND player at
    // three-and-three wins by surviving the round and striking first in the
    // next one — a round boundary the one-phase planner cannot see.
    // False keeps the unconditional race.
    raceRequiresSafety: boolean;
    // One turn before the stronghold is exposed, first player must not bow its
    // whole board while the opponent still has two conflict opportunities.
    preStrongholdDefenseEnabled: boolean;
    preStrongholdBrokenProvinceThreshold: number;
    preStrongholdRequireFirstPlayer: boolean;
    preStrongholdMinOpponentConflicts: number;
    preStrongholdMinOpponentReady: number;
    // Threat must meet (weakest outer + stronghold province) * ratio + buffer.
    // Rush profiles can raise ratio/buffer or disable this stage entirely.
    preStrongholdThreatRatio: number;
    preStrongholdThreatBuffer: number;
    preStrongholdMinDefenders: number;
}

export const STRONGHOLD_DEFENSE_DEFAULTS: StrongholdDefenseProfile = {
    enabled: true,
    maxFairDefenders: 1,
    maxOmniscientDefenders: Number.POSITIVE_INFINITY,
    skillBuffer: 0,
    omniscientHandThreatWeight: 0,
    omniscientDefenderDisables: false,
    holdAllAgainstCovert: true,
    attackAllWhenOpponentHasNoConflict: true,
    raceRequiresSafety: false,
    preStrongholdDefenseEnabled: true,
    preStrongholdBrokenProvinceThreshold: 2,
    preStrongholdRequireFirstPlayer: true,
    preStrongholdMinOpponentConflicts: 2,
    preStrongholdMinOpponentReady: 2,
    preStrongholdThreatRatio: 1,
    preStrongholdThreatBuffer: 0,
    preStrongholdMinDefenders: 1
};

export interface StrongholdDefenseCharacter {
    uuid: string;
    military: number;
    political: number;
    covert?: boolean;
}

export interface StrongholdDefenseInput {
    active: boolean;
    opponentStrongholdExposed?: boolean;
    strongholdProvinceStrength: number;
    myReady: StrongholdDefenseCharacter[];
    opponentReady: StrongholdDefenseCharacter[];
    opponentConflictsRemaining?: number;
    opponentMilitaryRemaining?: number;
    opponentPoliticalRemaining?: number;
    handThreat?: Partial<Record<StrongholdDefenseAxis, number>>;
    // Number of reserved characters the known opposing hand can remove, bow,
    // or send home in the next conflict. Fair bots pass zero; omniscience supplies
    // its affordable exact-hand result.
    defenderDisables?: number;
    omniscient?: boolean;
    myBrokenOuterProvinces?: number;
    isFirstPlayer?: boolean;
    weakestOuterProvinceStrength?: number;
    // Bodies the OPPONENT'S OWN DECLARATION will ready again — a Waterfall
    // Tattoo bearer while the province being defended is still facedown, since
    // the attack reveals it and the reaction stands the bearer back up before
    // defenders are declared. They defend whether or not they attacked, so
    // reserving them is pure waste: they are counted as defenders
    // unconditionally and never appear in `reserveUuids`. Owned by
    // `RevealReadyPolicy`; the caller passes its verdict.
    freeDefenderUuids?: string[];
}

export type StrongholdDefenseMode = 'inactive' | 'open-attack' | 'last-conflict-all-in' |
    'reserve' | 'hold-all';

export interface StrongholdDefensePlan {
    active: boolean;
    mode: StrongholdDefenseMode;
    reserveUuids: string[];
    forceAllAttackers: boolean;
    reason: string;
    threats: Record<StrongholdDefenseAxis, number>;
}

const AXES: StrongholdDefenseAxis[] = ['military', 'political'];

/**
 * Shared, injectable last-province planner. It answers one question only:
 * which ready characters must stay home so the opponent's next legal conflict
 * cannot break the stronghold province?
 */
export class StrongholdDefenseTactics {
    constructor(private profile: StrongholdDefenseProfile = STRONGHOLD_DEFENSE_DEFAULTS) {}

    plan(input: StrongholdDefenseInput): StrongholdDefensePlan {
        const emptyThreats = { military: 0, political: 0 };
        const preStronghold = this.isPreStrongholdRisk(input);
        if(!this.profile.enabled || (!input.active && !preStronghold)) {
            return this.result('inactive', [], false, 'stronghold-safe', emptyThreats);
        }

        const threats = this.threats(input);
        const axes = this.remainingAxes(input);
        const disables = input.omniscient ? Math.max(0, Math.floor(Number(input.defenderDisables) || 0)) : 0;
        const opponentConflictCount = Number(input.opponentConflictsRemaining);
        // A body the opponent's own attack readies is a defender we get for
        // free: it is added to every survival test and removed from the pool
        // the reserve is chosen out of. Empty for every deck without a
        // reveal-ready attachment, which is V1 exactly.
        const freeUuids = new Set((input.freeDefenderUuids || []).map((uuid) => String(uuid)));
        const free = input.myReady.filter((card) => freeUuids.has(String(card.uuid)));
        const reservable = input.myReady.filter((card) => !freeUuids.has(String(card.uuid)));
        const survivesWith = (defenders: StrongholdDefenseCharacter[]) =>
            this.survives(defenders.concat(free), axes, threats, input.strongholdProvinceStrength, disables);
        // Both players are one province from defeat. The bot has the current
        // conflict opportunity, so race for the enemy stronghold before the
        // opponent gets a counterattack.
        if(input.opponentStrongholdExposed) {
            const opponentCanAnswer = this.profile.raceRequiresSafety &&
                (!Number.isFinite(opponentConflictCount) || opponentConflictCount > 0) &&
                !survivesWith([]);
            if(!opponentCanAnswer) {
                return this.result('last-conflict-all-in', [], true, 'stronghold-race-all-in', threats);
            }
        }
        if(this.profile.attackAllWhenOpponentHasNoConflict && Number.isFinite(opponentConflictCount) && opponentConflictCount <= 0) {
            return this.result('last-conflict-all-in', [], true, 'stronghold-last-conflict', threats);
        }

        // Explicit exception: no ready enemy body means no counterattack can be
        // declared, even when the engine still reports a conflict opportunity.
        if(input.opponentReady.length === 0) {
            return this.result('open-attack', [], false, 'stronghold-opponent-bowed', threats);
        }

        if(this.profile.holdAllAgainstCovert && input.opponentReady.some((card) => card.covert)) {
            // Covert stops a body DECLARING as a defender, which it does
            // whether or not that body attacked first — so a free defender is
            // no safer at home and is still released.
            return this.result('hold-all', reservable.map((card) => card.uuid), false,
                preStronghold ? 'two-broken-covert-risk' : 'stronghold-covert-risk', threats);
        }

        const maxConfigured = input.omniscient ? this.profile.maxOmniscientDefenders : this.profile.maxFairDefenders;
        const maxDefenders = Math.min(reservable.length,
            Number.isFinite(maxConfigured) ? Math.max(0, Math.floor(maxConfigured)) : reservable.length);

        // Stronghold can already absorb every possible counterattack. No body
        // needs reserving, so ordinary attack commitment may use all of them.
        // A free defender counts here too, which is the whole point: with the
        // tattooed body standing back up by itself, no other body is needed.
        const minimumDefenders = preStronghold
            ? Math.min(reservable.length, Math.max(1, Math.floor(this.profile.preStrongholdMinDefenders)))
            : 0;
        if(minimumDefenders === 0 && survivesWith([])) {
            return this.result('open-attack', [], false,
                free.length > 0 ? 'stronghold-reveal-ready-safe' : 'stronghold-strength-safe', threats);
        }

        for(let size = Math.max(1, minimumDefenders); size <= maxDefenders; size++) {
            const safe = this.combinations(reservable, size)
                .filter((cards) => survivesWith(cards))
                .sort((left, right) => this.coverage(right, axes, disables) - this.coverage(left, axes, disables));
            if(safe.length > 0) {
                const reserve = safe[0].map((card) => card.uuid);
                if(reserve.length >= input.myReady.length) {
                    return this.result('hold-all', reserve, false,
                        preStronghold ? 'two-broken-all-needed' : 'stronghold-all-needed', threats);
                }
                return this.result('reserve', reserve, false,
                    preStronghold ? 'two-broken-reserve-defense' : 'stronghold-reserve-defense', threats);
            }
        }

        // No allowed reserve can prove the stronghold safe. Primary directive
        // wins: skip the attack and make every body available to defend — but
        // never hold back a body that defends anyway, so free defenders are
        // still released.
        return this.result('hold-all', reservable.map((card) => card.uuid), false,
            preStronghold ? 'two-broken-defense-uncertain' : 'stronghold-defense-uncertain', threats);
    }

    private isPreStrongholdRisk(input: StrongholdDefenseInput): boolean {
        if(!this.profile.preStrongholdDefenseEnabled || input.active ||
            (this.profile.preStrongholdRequireFirstPlayer && !input.isFirstPlayer)) {
            return false;
        }
        if((Number(input.myBrokenOuterProvinces) || 0) < this.profile.preStrongholdBrokenProvinceThreshold ||
            (Number(input.opponentConflictsRemaining) || 0) < this.profile.preStrongholdMinOpponentConflicts ||
            input.opponentReady.length < this.profile.preStrongholdMinOpponentReady) {
            return false;
        }
        const outer = Math.max(0, Number(input.weakestOuterProvinceStrength) || 0);
        const stronghold = Math.max(0, Number(input.strongholdProvinceStrength) || 0);
        const required = (outer + stronghold) * Math.max(0, Number(this.profile.preStrongholdThreatRatio) || 0) +
            (Number(this.profile.preStrongholdThreatBuffer) || 0);
        return AXES.some((axis) => this.boardSkill(input.opponentReady, axis) >= required);
    }

    private result(mode: StrongholdDefenseMode, reserveUuids: string[], forceAllAttackers: boolean,
        reason: string, threats: Record<StrongholdDefenseAxis, number>): StrongholdDefensePlan {
        return { active: mode !== 'inactive', mode, reserveUuids, forceAllAttackers, reason, threats };
    }

    private remainingAxes(input: StrongholdDefenseInput): StrongholdDefenseAxis[] {
        const military = Number(input.opponentMilitaryRemaining);
        const political = Number(input.opponentPoliticalRemaining);
        const haveTypedCounts = Number.isFinite(military) || Number.isFinite(political);
        if(!haveTypedCounts) {
            return AXES;
        }
        const axes = AXES.filter((axis) => axis === 'military' ? military > 0 : political > 0);
        // Forced/extra conflicts can leave typed counters at zero while the
        // aggregate counter remains positive. Treat either axis as possible.
        return axes.length > 0 ? axes : AXES;
    }

    private threats(input: StrongholdDefenseInput): Record<StrongholdDefenseAxis, number> {
        return {
            military: this.boardSkill(input.opponentReady, 'military') +
                Math.max(0, Number(input.handThreat?.military) || 0),
            political: this.boardSkill(input.opponentReady, 'political') +
                Math.max(0, Number(input.handThreat?.political) || 0)
        };
    }

    private survives(defenders: StrongholdDefenseCharacter[], axes: StrongholdDefenseAxis[],
        threats: Record<StrongholdDefenseAxis, number>, strongholdStrength: number, disables: number): boolean {
        const province = Math.max(0, Number(strongholdStrength) || 0);
        return axes.every((axis) =>
            province + this.skillAfterDisables(defenders, axis, disables) > threats[axis] + this.profile.skillBuffer);
    }

    private skillAfterDisables(cards: StrongholdDefenseCharacter[], axis: StrongholdDefenseAxis, disables: number): number {
        // Opponent removes the best defender(s), not arbitrary ones.
        return cards.map((card) => Math.max(0, Number(card[axis]) || 0))
            .sort((a, b) => b - a)
            .slice(disables)
            .reduce((total, skill) => total + skill, 0);
    }

    private boardSkill(cards: StrongholdDefenseCharacter[], axis: StrongholdDefenseAxis): number {
        return cards.reduce((total, card) => total + Math.max(0, Number(card[axis]) || 0), 0);
    }

    private coverage(cards: StrongholdDefenseCharacter[], axes: StrongholdDefenseAxis[], disables: number): number {
        return Math.min(...axes.map((axis) => this.skillAfterDisables(cards, axis, disables)));
    }

    private combinations(cards: StrongholdDefenseCharacter[], size: number): StrongholdDefenseCharacter[][] {
        const out: StrongholdDefenseCharacter[][] = [];
        const pick = (start: number, chosen: StrongholdDefenseCharacter[]) => {
            if(chosen.length === size) {
                out.push(chosen.slice());
                return;
            }
            for(let index = start; index <= cards.length - (size - chosen.length); index++) {
                chosen.push(cards[index]);
                pick(index + 1, chosen);
                chosen.pop();
            }
        };
        pick(0, []);
        return out;
    }
}
