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
    holdAllAgainstCovert: boolean;
    attackAllWhenOpponentHasNoConflict: boolean;
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
    holdAllAgainstCovert: true,
    attackAllWhenOpponentHasNoConflict: true,
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
    // or send home in the next conflict. Fair bots pass zero; seed 3 supplies
    // its affordable exact-hand result.
    defenderDisables?: number;
    omniscient?: boolean;
    myBrokenOuterProvinces?: number;
    isFirstPlayer?: boolean;
    weakestOuterProvinceStrength?: number;
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
        // Both players are one province from defeat. The bot has the current
        // conflict opportunity, so race for the enemy stronghold before the
        // opponent gets a counterattack.
        if(input.opponentStrongholdExposed) {
            return this.result('last-conflict-all-in', [], true, 'stronghold-race-all-in', threats);
        }
        const opponentConflictCount = Number(input.opponentConflictsRemaining);
        if(this.profile.attackAllWhenOpponentHasNoConflict && Number.isFinite(opponentConflictCount) && opponentConflictCount <= 0) {
            return this.result('last-conflict-all-in', [], true, 'stronghold-last-conflict', threats);
        }

        // Explicit exception: no ready enemy body means no counterattack can be
        // declared, even when the engine still reports a conflict opportunity.
        if(input.opponentReady.length === 0) {
            return this.result('open-attack', [], false, 'stronghold-opponent-bowed', threats);
        }

        if(this.profile.holdAllAgainstCovert && input.opponentReady.some((card) => card.covert)) {
            return this.result('hold-all', input.myReady.map((card) => card.uuid), false,
                preStronghold ? 'two-broken-covert-risk' : 'stronghold-covert-risk', threats);
        }

        const axes = this.remainingAxes(input);
        const disables = input.omniscient ? Math.max(0, Math.floor(Number(input.defenderDisables) || 0)) : 0;
        const maxConfigured = input.omniscient ? this.profile.maxOmniscientDefenders : this.profile.maxFairDefenders;
        const maxDefenders = Math.min(input.myReady.length,
            Number.isFinite(maxConfigured) ? Math.max(0, Math.floor(maxConfigured)) : input.myReady.length);

        // Stronghold can already absorb every possible counterattack. No body
        // needs reserving, so ordinary attack commitment may use all of them.
        const minimumDefenders = preStronghold
            ? Math.min(input.myReady.length, Math.max(1, Math.floor(this.profile.preStrongholdMinDefenders)))
            : 0;
        if(minimumDefenders === 0 && this.survives([], axes, threats, input.strongholdProvinceStrength, disables)) {
            return this.result('open-attack', [], false, 'stronghold-strength-safe', threats);
        }

        for(let size = Math.max(1, minimumDefenders); size <= maxDefenders; size++) {
            const safe = this.combinations(input.myReady, size)
                .filter((cards) => this.survives(cards, axes, threats, input.strongholdProvinceStrength, disables))
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
        // wins: skip the attack and make every body available to defend.
        return this.result('hold-all', input.myReady.map((card) => card.uuid), false,
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
