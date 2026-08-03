export type ConflictAxis = 'military' | 'political';
export type ConflictPlanningPolicyVariant = 'lookahead' | 'legacy';

export interface ConflictPhasePlannerProfile {
    enabled: boolean;
    maxDepth: number;
    maxAttackSets: number;
    maxAttackChoices: number;
    maxRingChoices: number;
    discount: number;
    aggression: number;
    conflictWinValue: number;
    provinceBreakValue: number;
    strongholdBreakValue: number;
    unopposedValue: number;
    ringFateValue: number;
    ringEffectValue: number;
    claimedRingValue: number;
    readySkillValue: number;
    passPenalty: number;
    dynastyProjectionWeight: number;
    preserveOtherAxisWeight: number;
    applyPassPlan: boolean;
    applyRingPlan: boolean;
    applyTypePlan: boolean;
    applyTargetPlan: boolean;
    applyDynastyProjection: boolean;
    applyAttackerPlan: boolean;
    // Fair-mode only: assume the opponent can answer with this many skill
    // points per public hand card it can afford, so the rollout stops
    // over-declaring marginal off-axis conflicts. 0 (default) = unchanged.
    fairDefenseBuffer?: number;
    // The intent filter refuses every non-character card while none of our
    // participants is ready, because a bowed body contributes 0 skill
    // (`conflict.ts:474`) and a buff on it is wasted. That premise only holds
    // for effects that land on OUR participant. A card that removes or
    // weakens an ENEMY participant moves the same skill differential and asks
    // nothing of our bowed bodies. Measured: `no-ready-participant` is 51% of
    // all intent rejections in defense windows 1-2 skill from losing the
    // province, and Assassination alone is 60 of them.
    //   'off'     — V1's behavior, the veto applies to everything.
    //   'defense' — exempt enemy-target cards only while defending.
    //   'always'  — exempt them on both sides of the conflict.
    enemyTargetIgnoresReadyParticipant?: 'off' | 'defense' | 'always';
    // The other half of the same veto, and the larger one. A card that READIES
    // one of our participants, or puts a new ready body into the conflict, is
    // not wasted on a bowed board — it is the answer to it. Those entries carry
    // `PlaybookEntry.worksWithoutReadyParticipant`. Measured over 90 games,
    // the veto refuses them 173 times (Against the Waves alone 105, of which
    // 102 while defending) against ~58 for the enemy-target slice, which is why
    // the enemy-target arm on its own could only reach +1.30pp.
    //   'off'     — V1's behavior, the veto applies to everything.
    //   'defense' — exempt ready-effect cards only while defending.
    //   'always'  — exempt them on both sides of the conflict.
    readyEffectIgnoresReadyParticipant?: 'off' | 'defense' | 'always';
    // While DEFENDING a province that is already safe, how far behind on skill
    // we will still spend conflict cards to steal the conflict win (and the
    // ring). V1's hardcoded value is 3. These plays never prevent a break, so
    // this knob prices the ring against the cards it costs. 0 = never chase a
    // safe-province conflict win.
    defenseCheapWinMaxGap?: number;
    // ---- deck-authored declaration options (see docs/bot-v2-deck-tuning.md) ----
    // A deck's tactics module proposes concrete declarations (axis / ring /
    // province / must-participate bodies / reserved bodies). The planner scores
    // each one INSIDE the phase rollout, so it picks the best whole-phase
    // SEQUENCE rather than the best isolated first move. Off = generic rollout.
    applyIntentPlan?: boolean;
    // Size the DEFENSE with the same phase rollout, so bodies are only bowed
    // to save a province when they are not worth more in our own conflict.
    // V1 sizes each defense against the conflict in front of it alone.
    applyDefensePlan?: boolean;
    // How much of the rest-of-phase rollout a DEFENSE decision may spend.
    // The tail assumes we go on to play the phase optimally, but our live
    // offense is V1's and does not actually improve when we keep a body back,
    // so an undiscounted tail pays for a certain province loss with imaginary
    // future breaks. 1 = trust the tail fully.
    defenseTailWeight?: number;
    // Per-node cap on deck-authored choices considered before the generic ones.
    maxOptionChoices?: number;
    // Generic (non-deck) declarations are dropped when a deck offered options
    // for this node. Lets a deck fully own its declaration policy.
    optionsExclusive?: boolean;
    // Sequence the CARDS and abilities played inside a conflict with the
    // outcome-scoring action planner instead of V1's fixed pipeline. A deck's
    // preferred-bearer rules become weights the planner may overrule when the
    // conflict math is worth more. See v2/ConflictActionPlanner.ts.
    applyActionPlan?: boolean;
    // Score penalty applied to a card the deck's own bearer picker would have
    // vetoed. Large enough that the deck's preference wins every ordinary
    // window, small enough that breaking a province can still overrule it.
    actionPlanRelaxPenalty?: number;
    // Gate the REACTION cards v2/CardValueModel models - Voice of Honor, Defend
    // Your Honor, Insult to Injury - on whether what they answer is worth the
    // card. V1 fires all three blind. Independent of `applyActionPlan`, which
    // reorders a whole window and measured negative.
    useCardValueModel?: boolean;
    // Refuse to play a modelled card the value model says has NO legal or useful
    // application (Assassination with no cost-2 target, Rout with no
    // participating Bushi). Only structural blocks veto; a card that is merely
    // below a value threshold reports `hold` and is still played, because
    // enforcing preferences as vetoes measured -22pp on PhoenixShugenja.
    vetoDeadCards?: boolean;

    // ---- declaration sizing (V2-only; undefined = V1 behavior) ----
    // The phase rollout benches bodies to keep the NEXT conflict alive, and it
    // will initiate a conflict that falls short of a break this very
    // declaration could still have reached. Measured on Crab: 7 of its 37
    // reachable breaks were given up this way, all of them by the plan and none
    // by the break heuristic. A deck that loses by conquest would rather have
    // the province than the reserved body, so it keeps committing until the
    // break is secured.
    secureReachableBreak?: boolean;
    // Bodies kept home when NO allocation can reach the break. V1 sends all but
    // `attackKeepHome` whether or not the attack is winnable, which is where a
    // wall deck bows the defenders it needs next window. Undefined leaves the
    // profile's `attackCommitment` mode untouched.
    hopelessAttackKeepHome?: number;
    // How far short of the break an attack must be to count as hopeless, as
    // `potentialSkill - breakTarget`. Negative. `breakTarget` assumes the
    // opponent defends with its whole ready board, so this wants slack.
    hopelessAttackReach?: number;

    // ---- triggered abilities (V2-only) ----
    // The triggered-ability window drops any card whose playbook priority is
    // below 6, which makes a low-priority REACTION or INTERRUPT structurally
    // dead: that window is its only path to fire. Listing an id here admits it
    // for V2 only; the playbook is shared with V1 and stays untouched.
    //
    // Scope, learned the hard way: this window is entered only for prompts
    // titled "any reaction" / "any interrupt" (JigokuBotPolicy.ts:1140). It
    // never handles an in-play character's ACTION, so this flag cannot revive
    // one. Measured: admitting Crab's Kaiu Siege Force here was bit-identical
    // to baseline over 54 paired games. See docs/bot-v2-per-deck-plan.md.
    triggeredAbilityAllowIds?: string[];
}

export const DEFAULT_CONFLICT_PHASE_PLANNER: ConflictPhasePlannerProfile = {
    enabled: true,
    maxDepth: 5,
    maxAttackSets: 5,
    maxAttackChoices: 18,
    maxRingChoices: 3,
    discount: 0.9,
    aggression: 1,
    conflictWinValue: 2.5,
    provinceBreakValue: 9,
    strongholdBreakValue: 500,
    unopposedValue: 1.25,
    ringFateValue: 2.5,
    ringEffectValue: 0.2,
    claimedRingValue: 0.6,
    readySkillValue: 0.12,
    passPenalty: 3,
    dynastyProjectionWeight: 0.35,
    preserveOtherAxisWeight: 0.45,
    applyPassPlan: false,
    applyRingPlan: false,
    applyTypePlan: false,
    applyTargetPlan: true,
    applyDynastyProjection: false,
    // Phase-wide attacker allocation. V1 originally sized each attack in
    // isolation ("commit skill until it clears the province plus the whole
    // possible defense"), which threw bodies into conflicts it could not break
    // and left nothing for the second conflict or for defense. The rollout
    // instead commits the smallest set that wins the PHASE.
    //
    // Measured cross-deck on three seeds, 180 paired games each, against a
    // control seat on identical shuffles: +5.0pp / +9.4pp / +6.1pp, pooling to
    // 57.0% vs 50.2% (+6.9pp) over n=540, 117 discordant pairs split 77-40
    // (McNemar two-sided p = 0.00087). On random shuffles, Crab 39.1% -> 44.1%
    // at n=2600.
    //
    // Re-measured 2026-07-31 per deck on the current tree, each deck toggled
    // against an otherwise-identical field: ALL TEN decks positive, mean
    // +4.67pp +-1.44 (z 3.2), range Lion +0.5pp to Dragon +11.2pp. Unicorn's
    // historical -11.1pp opt-out did NOT reproduce (+0.8pp) and was removed.
    applyAttackerPlan: true,
    applyIntentPlan: false,
    applyDefensePlan: false,
    applyActionPlan: false,
    actionPlanRelaxPenalty: 30,
    useCardValueModel: false,
    vetoDeadCards: false,
    // Both halves of the `no-ready-participant` veto, scoped to DEFENCE.
    //
    // The veto refuses every non-character card while none of our participants
    // is ready. That is right for a buff — a bowed body contributes 0
    // (`conflict.ts:474`) — wrong for a card that removes an ENEMY participant,
    // and wrong in the opposite direction for one that READIES one of ours or
    // puts a new ready body in: those answer a bowed board rather than being
    // wasted on it.
    //
    // The enemy half alone measured +1.30pp in an earlier arm and was held below
    // a +2pp bar. The recorded hypothesis was that its population was too small
    // (~10 extra plays) and that adding the missing READY marker would clear it.
    // Re-measured with the marker (n=1620 paired, 3 bases): the marker enlarges
    // the population 3x (+116 extra card plays per 90 games against +36) and the
    // pooled delta still lands at +1.33pp under `always` scoping. Enlarging the
    // population did NOT rescue the lever. Scoping both halves to DEFENCE did,
    // to +1.67pp with no base negative and 8 of 10 decks non-negative — still
    // inside the noise floor. See `docs/bot-v2-rejected-experiments.md`.
    enemyTargetIgnoresReadyParticipant: 'defense',
    readyEffectIgnoresReadyParticipant: 'defense',
    // Deliberately well below 1: measured, an undiscounted defender tail makes
    // the bot concede 81% of its defenses (vs V1's 40%) because it pays for a
    // certain province loss with future offense that never materialises.
    defenseTailWeight: 0.25,
    maxOptionChoices: 6,
    optionsExclusive: false
};

export const RUSH_CONFLICT_PHASE_PLANNER: ConflictPhasePlannerProfile = {
    ...DEFAULT_CONFLICT_PHASE_PLANNER,
    aggression: 1.3,
    conflictWinValue: 3,
    provinceBreakValue: 11,
    passPenalty: 3,
    readySkillValue: 0.08,
    preserveOtherAxisWeight: 0.25,
    applyPassPlan: false,
    applyRingPlan: false,
    applyTypePlan: false,
    applyTargetPlan: true,
    applyDynastyProjection: false,
    // On for the same measured reason as the default profile. Lion and Unicorn
    // both resolve to this profile and both measured positive on the re-run
    // (+0.5pp and +0.8pp), so neither opts out.
    applyAttackerPlan: true,
    applyIntentPlan: false,
    applyDefensePlan: false,
    applyActionPlan: false,
    actionPlanRelaxPenalty: 30,
    useCardValueModel: false,
    vetoDeadCards: false,
    // Deliberately well below 1: measured, an undiscounted defender tail makes
    // the bot concede 81% of its defenses (vs V1's 40%) because it pays for a
    // certain province loss with future offense that never materialises.
    defenseTailWeight: 0.25,
    maxOptionChoices: 6,
    optionsExclusive: false
};

export interface ConflictPlannerCharacter {
    uuid: string;
    military: number;
    political: number;
    ready: boolean;
    inConflict?: boolean;
    legalMilitary?: boolean;
    legalPolitical?: boolean;
    covert?: boolean;
    bowsAfterConflict?: boolean;
    /** Printed card id — lets deck rules name bodies without knowing uuids. */
    cardId?: string;
    /** Lowercased printed traits (bushi / cavalry / shugenja / courtier ...). */
    traits?: string[];
    glory?: number;
    fate?: number;
    cost?: number;
    /** Public live attachment modifiers used by immutable V2 projections. */
    attachments?: Array<{
        uuid: string;
        militaryBonus: number;
        politicalBonus: number;
        printedCost?: number;
    }>;
}

/**
 * One concrete declaration a deck's tactics module proposes for the base
 * planner to consider. A deck may propose several; the planner scores each
 * inside the same-phase rollout and keeps the best whole-phase sequence.
 *
 * Every field is optional except `id`: an option that names only an axis is a
 * soft "prefer military this phase", while one that names axis + ring +
 * required bodies is a fully specified play the deck wants executed.
 */
export interface ConflictDeclarationOption {
    /** Stable trace id, e.g. `lion-swarm-military`. */
    id: string;
    /** Preferred conflict type. Unset = planner picks. */
    axis?: ConflictAxis;
    /** Preferred ring element (Dragon/Phoenix ring plans). Unset = planner picks. */
    ringElement?: string;
    /** Preferred province location. Unset = planner picks. */
    targetLocation?: string;
    /** Bodies that MUST participate for this option to be legal/executed. */
    requiredAttackerUuids?: string[];
    /** Bodies kept out of THIS declaration (Unicorn move-in, home defense). */
    reserveUuids?: string[];
    /** Send exactly the required bodies (solo attackers, Brash Samurai). */
    exactAttackers?: boolean;
    /** Deck confidence added to the rollout score of this branch. */
    bonus?: number;
    /** Reject the option when its rollout branch scores below this. */
    minScore?: number;
    /**
     * Restrict the option to one declaration slot, counted from the decision
     * being made now: 0 = the next declaration, 1 = the one after it. It is
     * NOT an index from the start of the round — the planner is called with
     * the opportunities that REMAIN, so on a player's second conflict the live
     * declaration is index 0 again. Use it for "only on my last conflict of
     * the phase" style rules, gating on remaining opportunities.
     */
    declarationIndex?: number;
    reason?: string;
}

export interface ConflictPlannerOpportunities {
    total: number;
    military: number;
    political: number;
}

export interface ConflictPlannerRing {
    element: string;
    fate: number;
    selfValue: number;
    opponentValue: number;
}

export interface ConflictPlannerTarget {
    location: string;
    strength: number;
    stronghold?: boolean;
    priority?: number;
}

export interface ConflictPlannerHandThreat {
    military: number;
    political: number;
}

/**
 * A deck's opinion about defending the conflict currently declared against it.
 * Same contract as `ConflictDeclarationOption`: the deck proposes, the base
 * planner scores the proposal against the rest of the phase and decides.
 */
export interface ConflictDefenseOption {
    id: string;
    /** Bodies that MUST be in this defense (a wall, an on-defense payoff). */
    requiredDefenderUuids?: string[];
    /** Bodies kept home for our own upcoming conflict. */
    reserveUuids?: string[];
    /** Defend with exactly the required bodies. */
    exactDefenders?: boolean;
    /** The deck wants this conflict conceded to keep the board ready. */
    concede?: boolean;
    /** Deck confidence, added to this branch's score. */
    bonus?: number;
    reason?: string;
}

export interface ConflictPhasePlannerInput {
    selfCharacters: ConflictPlannerCharacter[];
    opponentCharacters: ConflictPlannerCharacter[];
    selfOpportunities: ConflictPlannerOpportunities;
    opponentOpportunities: ConflictPlannerOpportunities;
    rings: ConflictPlannerRing[];
    selfTargets: ConflictPlannerTarget[];
    opponentTargets: ConflictPlannerTarget[];
    selfBrokenProvinces: number;
    opponentBrokenProvinces: number;
    actor?: 'self' | 'opponent';
    selfHandThreat?: Partial<ConflictPlannerHandThreat>;
    opponentHandThreat?: Partial<ConflictPlannerHandThreat>;
    lockedAxis?: ConflictAxis;
    lockedRingElement?: string;
    lockedTargetLocation?: string;
    forcedAttackerUuids?: string[];
    /** Deck-authored declarations for this phase (see ConflictDeclarationOption). */
    options?: ConflictDeclarationOption[];
    /** Bodies held back from every self declaration (stronghold reserve). */
    reservedSelfUuids?: string[];
    /**
     * How much an unopposed loss actually hurts right now, 0..1. An unopposed
     * conflict costs 1 honor, which is close to free in a normal game (a low
     * honor bid recovers it) and only matters near a dishonor loss. The policy
     * derives this from live honor; 0 means "ignore the honor".
     */
    honorPressure?: number;
    /**
     * Extra attacker skill a defense must beat, covering the pump the attacker
     * can still play after we commit. A minimum-sufficient defense is exactly
     * the one a single trick flips, which is why V1 carries a per-deck
     * `defenseSkillBuffer`; the rollout honours the same number.
     */
    defenseBuffer?: number;
}

/** The conflict the opponent has already declared against us, as declared. */
export interface LiveConflictAgainstSelf {
    axis: ConflictAxis;
    ringElement?: string;
    targetLocation?: string;
    /** Province strength plus any live holding/effect bonuses. */
    targetStrength: number;
    /** Whether the attacked province is the stronghold province. */
    targetStronghold?: boolean;
    /** Attacker skill already on the table. */
    attackerSkill: number;
    /** Attacking bodies, so the rollout can bow them for the rest of the phase. */
    attackerUuids?: string[];
    /** Our bodies already committed to this defense; they cannot be withdrawn. */
    committedDefenderUuids?: string[];
    /** Our bodies that may not defend this conflict (Covert). */
    blockedDefenderUuids?: string[];
}

export interface ConflictDefensePlan {
    /** The full defense set we want, including bodies already committed. */
    defenderUuids: string[];
    /** True when the best line is to let it through and keep the board ready. */
    concede: boolean;
    conflictWon: boolean;
    provinceBroken: boolean;
    score: number;
    /** Score of conceding outright, for tracing why a defense was chosen. */
    concedeScore: number;
    reason: string;
}

export interface ConflictPhasePlanStep {
    actor: 'self' | 'opponent';
    action: 'attack' | 'pass';
    axis?: ConflictAxis;
    ringElement?: string;
    targetLocation?: string;
    attackerUuids?: string[];
    defenderUuids?: string[];
    conflictWon?: boolean;
    provinceBroken?: boolean;
    optionId?: string;
    score: number;
}

export interface ConflictPhasePlan {
    action: 'attack' | 'pass';
    conflictType?: ConflictAxis;
    ringElement?: string;
    targetLocation?: string;
    attackerUuids: string[];
    score: number;
    sequence: ConflictPhasePlanStep[];
    reason: string;
    /** Set when a deck-authored option produced the first self declaration. */
    optionId?: string;
    /** The winning option itself. Only the fields it NAMED may be executed. */
    option?: ConflictDeclarationOption;
    /** Bodies the winning option wants kept out of this declaration. */
    reserveUuids?: string[];
}

interface SearchState {
    selfReady: Set<string>;
    opponentReady: Set<string>;
    selfOpportunities: ConflictPlannerOpportunities;
    opponentOpportunities: ConflictPlannerOpportunities;
    rings: ConflictPlannerRing[];
    selfTargets: ConflictPlannerTarget[];
    opponentTargets: ConflictPlannerTarget[];
    selfBroken: number;
    opponentBroken: number;
    actor: 'self' | 'opponent';
    depth: number;
}

interface SearchResult {
    score: number;
    sequence: ConflictPhasePlanStep[];
}

interface AttackChoice {
    axis: ConflictAxis;
    ring: ConflictPlannerRing;
    target: ConflictPlannerTarget;
    attackers: ConflictPlannerCharacter[];
    optionId?: string;
    optionBonus?: number;
    optionReserveUuids?: string[];
}

/**
 * Bounded, deterministic same-conflict-phase rollout. It intentionally models
 * declarations and their lasting costs (claimed rings, bowed attackers and
 * defenders, broken provinces, remaining typed/extra opportunities), not the
 * engine's full action stack. Existing card-specific tactics still own live
 * conflict actions; their affordable skill is supplied as a bounded threat.
 */
export class ConflictPhasePlanner {
    constructor(readonly profile: ConflictPhasePlannerProfile = DEFAULT_CONFLICT_PHASE_PLANNER) {}

    /**
     * A deck option carrying `minScore` is a conditional line: it is only worth
     * playing when the phase it produces actually clears that bar. Retire such
     * an option and re-plan when the winning sequence falls short, so the deck
     * gets its fallback instead of a bad forced play.
     */
    plan(input: ConflictPhasePlannerInput): ConflictPhasePlan {
        let current = input;
        for(let attempt = 0; attempt <= (input.options || []).length; attempt++) {
            const plan = this.planOnce(current);
            const option = plan.optionId
                ? (current.options || []).find((candidate) => candidate.id === plan.optionId)
                : undefined;
            if(!option || !Number.isFinite(option.minScore) || plan.score >= Number(option.minScore)) {
                return plan;
            }
            current = {
                ...current,
                options: (current.options || []).filter((candidate) => candidate.id !== option.id)
            };
        }
        return this.planOnce({ ...current, options: [] });
    }

    private planOnce(input: ConflictPhasePlannerInput): ConflictPhasePlan {
        if(!this.profile.enabled || input.selfOpportunities.total <= 0) {
            return this.passPlan(0, 'conflict-lookahead-disabled-or-empty');
        }

        const state = this.initialState(input);
        const result = this.search(state, input, new Map());
        const first = result.sequence.find((step) => step.actor === 'self');
        if(!first || first.action === 'pass') {
            return this.passPlan(result.score, 'conflict-lookahead-pass');
        }
        const option = first.optionId
            ? (input.options || []).find((candidate) => candidate.id === first.optionId)
            : undefined;
        return {
            action: 'attack',
            conflictType: first.axis,
            ringElement: first.ringElement,
            targetLocation: first.targetLocation,
            attackerUuids: first.attackerUuids || [],
            score: result.score,
            sequence: result.sequence,
            reason: option ? (option.reason || `conflict-intent-${option.id}`) : 'conflict-lookahead-attack',
            optionId: first.optionId,
            option,
            reserveUuids: option?.reserveUuids ? [...option.reserveUuids] : undefined
        };
    }

    /**
     * Choose a defense for the conflict the opponent has already declared.
     *
     * V1 sizes a defense against the conflict in front of it: win outright if
     * reachable, else prevent the break, else concede. What it cannot see is
     * what those bodies are still needed for — every defender bows, so a
     * province saved on the opponent's conflict can cost us our own. This
     * scores each candidate defense by its immediate outcome PLUS the rest of
     * the phase played out with those bodies bowed, which is exactly the
     * "defend or keep the board for my counter-attack" trade.
     */
    planDefense(input: ConflictPhasePlannerInput, live: LiveConflictAgainstSelf,
        options: ConflictDefenseOption[] = []): ConflictDefensePlan {
        const committed = new Set(live.committedDefenderUuids || []);
        const blocked = new Set(live.blockedDefenderUuids || []);
        const base = this.initialState(input);
        const available = input.selfCharacters.filter((card) =>
            base.selfReady.has(card.uuid) && !blocked.has(card.uuid) &&
            (live.axis === 'military' ? card.legalMilitary !== false : card.legalPolitical !== false));
        const forced = available.filter((card) => committed.has(card.uuid));

        const candidates: ConflictDefensePlan[] = [];
        const evaluate = (defense: ConflictPlannerCharacter[], option?: ConflictDefenseOption) => {
            candidates.push(this.evaluateDefense(input, live, base, defense, option));
        };

        const usable = (option?: ConflictDefenseOption) => {
            const reserve = new Set(option?.reserveUuids || []);
            return available.filter((card) => !reserve.has(card.uuid) || committed.has(card.uuid));
        };

        for(const option of options) {
            if(option.concede) {
                // Conceding still keeps whatever is already locked in.
                evaluate(forced, option);
                continue;
            }
            const required = available.filter((card) =>
                (option.requiredDefenderUuids || []).includes(card.uuid));
            if(required.length !== (option.requiredDefenderUuids || []).length) {
                continue;
            }
            const anchor = this.dedupeCharacters([...forced, ...required]);
            if(option.exactDefenders) {
                evaluate(anchor, option);
                continue;
            }
            for(const defense of this.usefulSets(usable(option), live.axis, anchor, true)) {
                evaluate(defense, option);
            }
        }
        if(options.length === 0 || !this.profile.optionsExclusive) {
            for(const defense of this.usefulSets(available, live.axis, forced, true)) {
                evaluate(defense);
            }
        }
        if(candidates.length === 0) {
            evaluate(forced);
        }

        const concedeOnly = candidates.find((plan) => plan.defenderUuids.length === forced.length);
        const best = candidates.sort((left, right) => right.score - left.score ||
            left.defenderUuids.length - right.defenderUuids.length ||
            left.defenderUuids.join(',').localeCompare(right.defenderUuids.join(',')))[0];
        return { ...best, concedeScore: concedeOnly ? concedeOnly.score : best.score };
    }

    private evaluateDefense(input: ConflictPhasePlannerInput, live: LiveConflictAgainstSelf,
        base: SearchState, defense: ConflictPlannerCharacter[],
        option?: ConflictDefenseOption): ConflictDefensePlan {
        const next = this.cloneState(base);
        for(const card of defense) {
            if(card.bowsAfterConflict !== false) {
                next.selfReady.delete(card.uuid);
            }
        }
        for(const uuid of live.attackerUuids || []) {
            next.opponentReady.delete(uuid);
        }
        this.spendOpportunity(next.opponentOpportunities, live.axis);
        if(live.ringElement) {
            next.rings = next.rings.filter((ring) => ring.element !== live.ringElement);
        }

        const defenseSkill = defense.reduce((sum, card) => sum + this.skill(card, live.axis), 0) +
            this.handThreat(input, 'self', live.axis);
        const attackSkill = Math.max(0, Number(live.attackerSkill) || 0) +
            Math.max(0, Number(input.defenseBuffer) || 0);
        // Engine rule: the attacker takes a nonzero tie. 0-0 has no winner and
        // the ring goes back unclaimed.
        const attackerWon = attackSkill >= defenseSkill && attackSkill > 0;
        const broke = attackerWon && attackSkill - defenseSkill >= Math.max(0, live.targetStrength);
        if(broke) {
            next.selfTargets = next.selfTargets.filter((target) =>
                target.location !== live.targetLocation);
            if(!live.targetStronghold) {
                next.selfBroken++;
            }
        }

        const ring = base.rings.find((candidate) => candidate.element === live.ringElement);
        let value = Number(option?.bonus) || 0;
        if(attackerWon) {
            // They resolve the ring and, if they cleared the province, break it.
            value -= this.ringValue(ring, 'opponent') * this.profile.ringEffectValue;
            value -= this.profile.conflictWinValue * this.profile.aggression;
            if(broke) {
                value -= live.targetStronghold
                    ? this.profile.strongholdBreakValue
                    : this.profile.provinceBreakValue;
            }
            if(defense.length === 0) {
                // An unopposed loss costs 1 honor, which is close to free in a
                // normal game and only bites near a dishonor loss.
                value -= this.profile.unopposedValue *
                    Math.max(0, Math.min(1, Number(input.honorPressure) || 0));
            }
        } else {
            // The defender claims the contested ring without resolving it.
            value += this.profile.conflictWinValue * this.profile.aggression;
            value += this.profile.claimedRingValue * this.ringValue(ring, 'self');
        }

        // Whoever acts next continues the phase; the rollout handles ordering.
        next.actor = 'self';
        next.depth = base.depth + 1;
        const tail = live.targetStronghold && broke
            ? { score: 0, sequence: [] as ConflictPhasePlanStep[] }
            : this.search(next, input, new Map());
        const tailWeight = Number.isFinite(this.profile.defenseTailWeight)
            ? Math.max(0, Number(this.profile.defenseTailWeight))
            : 1;
        return {
            defenderUuids: defense.map((card) => card.uuid),
            concede: defense.length === 0,
            conflictWon: !attackerWon,
            provinceBroken: broke,
            score: value + this.profile.discount * tailWeight * tail.score,
            concedeScore: 0,
            reason: option ? (option.reason || `defense-intent-${option.id}`) : 'defense-lookahead'
        };
    }

    /** Score a projected dynasty board using a fresh two-conflict phase. */
    projectBoard(input: ConflictPhasePlannerInput): number {
        const projected: ConflictPhasePlannerInput = {
            ...input,
            actor: 'self',
            lockedAxis: undefined,
            lockedRingElement: undefined,
            lockedTargetLocation: undefined,
            forcedAttackerUuids: undefined
        };
        return this.plan(projected).score * this.profile.dynastyProjectionWeight;
    }

    private initialState(input: ConflictPhasePlannerInput): SearchState {
        return {
            selfReady: new Set(input.selfCharacters.filter((card) => card.ready).map((card) => card.uuid)),
            opponentReady: new Set(input.opponentCharacters.filter((card) => card.ready).map((card) => card.uuid)),
            selfOpportunities: this.copyOpportunities(input.selfOpportunities),
            opponentOpportunities: this.copyOpportunities(input.opponentOpportunities),
            rings: input.rings.map((ring) => ({ ...ring })),
            selfTargets: input.selfTargets.map((target) => ({ ...target })),
            opponentTargets: input.opponentTargets.map((target) => ({ ...target })),
            selfBroken: input.selfBrokenProvinces,
            opponentBroken: input.opponentBrokenProvinces,
            actor: input.actor || 'self',
            depth: 0
        };
    }

    private search(state: SearchState, input: ConflictPhasePlannerInput,
        memo: Map<string, SearchResult>): SearchResult {
        const stateWithActor = this.advanceActor(state);
        if(stateWithActor.depth >= this.profile.maxDepth || stateWithActor.rings.length === 0 ||
            (stateWithActor.selfOpportunities.total <= 0 && stateWithActor.opponentOpportunities.total <= 0)) {
            return { score: this.terminalValue(stateWithActor, input), sequence: [] };
        }
        const key = this.stateKey(stateWithActor);
        const cached = memo.get(key);
        if(cached) {
            return cached;
        }

        const actor = stateWithActor.actor;
        const choices = this.attackChoices(stateWithActor, input);
        const candidates: SearchResult[] = [];
        for(const choice of choices) {
            candidates.push(this.evaluateAttack(stateWithActor, input, choice, memo));
        }
        candidates.push(this.evaluatePass(stateWithActor, input, memo));
        const result = candidates.sort((left, right) => actor === 'self'
            ? right.score - left.score
            : left.score - right.score)[0];
        memo.set(key, result);
        return result;
    }

    private evaluateAttack(state: SearchState, input: ConflictPhasePlannerInput,
        choice: AttackChoice, memo: Map<string, SearchResult>): SearchResult {
        const actor = state.actor;
        const defender = actor === 'self' ? 'opponent' : 'self';
        const defenders = this.availableCharacters(state, input, defender, choice.axis)
            .filter((card) => !choice.attackers.some((attacker) => attacker.uuid === card.uuid));
        const covert = choice.attackers.filter((card) => card.covert).length;
        const uncovertable = defenders.slice().sort((a, b) =>
            this.skill(b, choice.axis) - this.skill(a, choice.axis)).slice(covert);
        const defenseSets = this.usefulSets(uncovertable, choice.axis, [], true);
        const outcomes = defenseSets.map((defense) => {
            const next = this.cloneState(state);
            const actorReady = actor === 'self' ? next.selfReady : next.opponentReady;
            const defenderReady = defender === 'self' ? next.selfReady : next.opponentReady;
            for(const card of choice.attackers) {
                if(card.bowsAfterConflict !== false) {
                    actorReady.delete(card.uuid);
                }
            }
            for(const card of defense) {
                if(card.bowsAfterConflict !== false) {
                    defenderReady.delete(card.uuid);
                }
            }
            this.spendOpportunity(actor === 'self' ? next.selfOpportunities : next.opponentOpportunities,
                choice.axis);
            next.rings = next.rings.filter((ring) => ring.element !== choice.ring.element);
            const attackSkill = choice.attackers.reduce((sum, card) => sum + this.skill(card, choice.axis), 0) +
                this.handThreat(input, actor, choice.axis);
            const defenseSkill = defense.reduce((sum, card) => sum + this.skill(card, choice.axis), 0) +
                this.handThreat(input, defender, choice.axis);
            // Engine rule: attacker wins a nonzero tie. Only 0-0 has no
            // winner (`Conflict.determineWinner`).
            const attackerWon = attackSkill >= defenseSkill && attackSkill > 0;
            const broke = attackerWon && attackSkill - defenseSkill >= choice.target.strength;
            if(broke) {
                if(actor === 'self') {
                    next.opponentTargets = next.opponentTargets.filter((target) => target.location !== choice.target.location);
                    if(!choice.target.stronghold) {
                        next.opponentBroken++;
                    }
                } else {
                    next.selfTargets = next.selfTargets.filter((target) => target.location !== choice.target.location);
                    if(!choice.target.stronghold) {
                        next.selfBroken++;
                    }
                }
            }
            next.actor = defender;
            next.depth++;
            const immediate = this.immediateValue(actor, choice, defense, attackerWon, broke);
            const tail = choice.target.stronghold && broke
                ? { score: 0, sequence: [] as ConflictPhasePlanStep[] }
                : this.search(next, input, memo);
            const signedImmediate = actor === 'self' ? immediate : -immediate;
            const score = signedImmediate + this.profile.discount * tail.score;
            const step: ConflictPhasePlanStep = {
                actor,
                action: 'attack',
                axis: choice.axis,
                ringElement: choice.ring.element,
                targetLocation: choice.target.location,
                attackerUuids: choice.attackers.map((card) => card.uuid),
                defenderUuids: defense.map((card) => card.uuid),
                conflictWon: attackerWon,
                provinceBroken: broke,
                optionId: choice.optionId,
                score: signedImmediate
            };
            return { score, sequence: [step, ...tail.sequence] };
        });
        // Defender chooses its response: opponent minimizes bot score, bot maximizes.
        return outcomes.sort((left, right) => defender === 'self'
            ? right.score - left.score
            : left.score - right.score)[0];
    }

    private evaluatePass(state: SearchState, input: ConflictPhasePlannerInput,
        memo: Map<string, SearchResult>): SearchResult {
        const next = this.cloneState(state);
        const opportunities = state.actor === 'self' ? next.selfOpportunities : next.opponentOpportunities;
        opportunities.total = Math.max(0, opportunities.total - 1);
        next.actor = state.actor === 'self' ? 'opponent' : 'self';
        next.depth++;
        const tail = this.search(next, input, memo);
        const value = this.profile.passPenalty * this.profile.aggression;
        const signed = state.actor === 'self' ? -value : value;
        return {
            score: signed + this.profile.discount * tail.score,
            sequence: [{ actor: state.actor, action: 'pass', score: signed }, ...tail.sequence]
        };
    }

    private attackChoices(state: SearchState, input: ConflictPhasePlannerInput): AttackChoice[] {
        const optionChoices = this.optionAttackChoices(state, input);
        if(optionChoices.length > 0 && this.profile.optionsExclusive) {
            return optionChoices;
        }
        return [...optionChoices, ...this.genericAttackChoices(state, input)];
    }

    /**
     * Turn each still-feasible deck-authored option into concrete declarations
     * for THIS node. Because these are injected at every self node (not only
     * the first), the minimax compares whole-phase sequences of deck plays —
     * "attack political with Kachiko now, keep the cavalry for the military
     * conflict" is scored against every other ordering of the same options.
     */
    private optionAttackChoices(state: SearchState, input: ConflictPhasePlannerInput): AttackChoice[] {
        const options = input.options || [];
        if(options.length === 0 || state.actor !== 'self' || !this.profile.applyIntentPlan) {
            return [];
        }
        const opportunities = state.selfOpportunities;
        if(opportunities.total <= 0) {
            return [];
        }
        const declarationIndex = Math.max(0,
            Math.max(0, Math.floor(Number(input.selfOpportunities.total) || 0)) - opportunities.total);
        const legal = this.legalTargets(state.opponentTargets, state.opponentBroken);
        const atRoot = state.depth === 0;
        const globalReserve = new Set(input.reservedSelfUuids || []);
        const choices: AttackChoice[] = [];
        for(const option of options) {
            if(Number.isFinite(option.declarationIndex) && option.declarationIndex !== declarationIndex) {
                continue;
            }
            if(atRoot && (
                (input.lockedAxis && option.axis && option.axis !== input.lockedAxis) ||
                (input.lockedRingElement && option.ringElement && option.ringElement !== input.lockedRingElement) ||
                (input.lockedTargetLocation && option.targetLocation &&
                    option.targetLocation !== input.lockedTargetLocation))) {
                continue;
            }
            const axes = (option.axis ? [option.axis] : (['military', 'political'] as ConflictAxis[]))
                .filter((axis) => opportunities[axis] > 0 &&
                    !(atRoot && input.lockedAxis && input.lockedAxis !== axis));
            const required = new Set(option.requiredAttackerUuids || []);
            const reserve = new Set([...globalReserve, ...(option.reserveUuids || [])]);
            const rings = state.rings
                .filter((ring) => (!option.ringElement || ring.element === option.ringElement) &&
                    !(atRoot && input.lockedRingElement && ring.element !== input.lockedRingElement))
                .slice(0, Math.max(1, this.profile.maxRingChoices));
            const targets = legal
                .filter((target) => (!option.targetLocation || target.location === option.targetLocation) &&
                    !(atRoot && input.lockedTargetLocation && target.location !== input.lockedTargetLocation))
                .slice(0, 2);
            if(rings.length === 0 || targets.length === 0) {
                continue;
            }
            for(const axis of axes) {
                const available = this.availableCharacters(state, input, 'self', axis);
                const mustPlay = available.filter((card) => required.has(card.uuid));
                // A named body that is bowed, dead or illegal on this axis
                // retires the option rather than silently attacking without it.
                if(mustPlay.length !== required.size) {
                    continue;
                }
                const forced = atRoot
                    ? available.filter((card) => (input.forcedAttackerUuids || []).includes(card.uuid))
                    : [];
                const anchor = this.dedupeCharacters([...mustPlay, ...forced]);
                if(option.exactAttackers && anchor.length === 0) {
                    continue;
                }
                const pool = available.filter((card) =>
                    !reserve.has(card.uuid) || required.has(card.uuid) || card.inConflict);
                const sets = option.exactAttackers ? [anchor] : this.usefulSets(pool, axis, anchor, false);
                for(const target of targets) {
                    for(const ring of rings) {
                        for(const attackers of sets) {
                            if(attackers.length > 0) {
                                choices.push({
                                    axis,
                                    ring,
                                    target,
                                    attackers,
                                    optionId: option.id,
                                    optionBonus: Number(option.bonus) || 0,
                                    optionReserveUuids: option.reserveUuids
                                });
                            }
                        }
                    }
                }
            }
        }
        return choices
            .sort((left, right) => (this.choiceHeuristic(state, input, right) + (right.optionBonus || 0)) -
                (this.choiceHeuristic(state, input, left) + (left.optionBonus || 0)) ||
                String(left.optionId).localeCompare(String(right.optionId)) ||
                left.axis.localeCompare(right.axis) ||
                left.ring.element.localeCompare(right.ring.element) ||
                left.attackers.map((card) => card.uuid).join(',')
                    .localeCompare(right.attackers.map((card) => card.uuid).join(',')))
            .slice(0, Math.max(1, Number(this.profile.maxOptionChoices) || 6));
    }

    private dedupeCharacters(cards: ConflictPlannerCharacter[]): ConflictPlannerCharacter[] {
        const seen = new Map<string, ConflictPlannerCharacter>();
        for(const card of cards) {
            seen.set(card.uuid, card);
        }
        return [...seen.values()];
    }

    private genericAttackChoices(state: SearchState, input: ConflictPhasePlannerInput): AttackChoice[] {
        const actor = state.actor;
        const opportunities = actor === 'self' ? state.selfOpportunities : state.opponentOpportunities;
        const axes = (['military', 'political'] as ConflictAxis[]).filter((axis) =>
            opportunities.total > 0 && opportunities[axis] > 0 &&
            !(state.depth === 0 && actor === 'self' && input.lockedAxis && input.lockedAxis !== axis));
        const targetPool = actor === 'self' ? state.opponentTargets : state.selfTargets;
        const broken = actor === 'self' ? state.opponentBroken : state.selfBroken;
        const targets = this.legalTargets(targetPool, broken).filter((target) =>
            !(state.depth === 0 && actor === 'self' && input.lockedTargetLocation &&
                target.location !== input.lockedTargetLocation));
        if(targets.length === 0) {
            return [];
        }

        const ringChoices = state.rings.filter((ring) =>
            !(state.depth === 0 && actor === 'self' && input.lockedRingElement &&
                ring.element !== input.lockedRingElement))
            .sort((left, right) => actor === 'self'
                ? this.ringValue(right, actor) - this.ringValue(left, actor)
                : this.ringValue(right, actor) - this.ringValue(left, actor))
            .slice(0, Math.max(1, this.profile.maxRingChoices));
        const reserve = new Set(actor === 'self' ? (input.reservedSelfUuids || []) : []);
        const choices: AttackChoice[] = [];
        for(const axis of axes) {
            const all = this.availableCharacters(state, input, actor, axis);
            const forced = state.depth === 0 && actor === 'self'
                ? all.filter((card) => (input.forcedAttackerUuids || []).includes(card.uuid))
                : [];
            const available = reserve.size === 0
                ? all
                : all.filter((card) => !reserve.has(card.uuid) || card.inConflict ||
                    forced.some((pick) => pick.uuid === card.uuid));
            const sets = this.usefulSets(available, axis, forced, false);
            for(const target of targets.slice(0, 2)) {
                for(const ring of ringChoices) {
                    for(const attackers of sets) {
                        if(attackers.length > 0) {
                            choices.push({ axis, ring, target, attackers });
                        }
                    }
                }
            }
        }
        return choices
            .sort((left, right) => this.choiceHeuristic(state, input, right) -
                this.choiceHeuristic(state, input, left) ||
                left.axis.localeCompare(right.axis) ||
                left.ring.element.localeCompare(right.ring.element) ||
                left.attackers.map((card) => card.uuid).join(',')
                    .localeCompare(right.attackers.map((card) => card.uuid).join(',')))
            .slice(0, Math.max(1, this.profile.maxAttackChoices));
    }

    private choiceHeuristic(state: SearchState, input: ConflictPhasePlannerInput,
        choice: AttackChoice): number {
        const actor = state.actor;
        const defender = actor === 'self' ? 'opponent' : 'self';
        const attack = choice.attackers.reduce((sum, card) => sum + this.skill(card, choice.axis), 0) +
            this.handThreat(input, actor, choice.axis);
        const defenders = this.availableCharacters(state, input, defender, choice.axis)
            .slice()
            .sort((left, right) => this.skill(right, choice.axis) - this.skill(left, choice.axis));
        const covert = choice.attackers.filter((card) => card.covert).length;
        const defense = defenders.slice(covert)
            .reduce((sum, card) => sum + this.skill(card, choice.axis), 0) +
            this.handThreat(input, defender, choice.axis);
        const margin = attack - defense;
        const breakable = margin >= choice.target.strength;
        const other: ConflictAxis = choice.axis === 'military' ? 'political' : 'military';
        const futureCost = choice.attackers.reduce((sum, card) =>
            sum + this.skill(card, other) * this.profile.preserveOtherAxisWeight, 0);
        return (choice.target.stronghold && breakable ? this.profile.strongholdBreakValue : 0) +
            (breakable ? this.profile.provinceBreakValue * this.profile.aggression : 0) +
            this.ringValue(choice.ring, actor) + choice.ring.fate * this.profile.ringFateValue +
            margin * 0.2 - futureCost * 0.15 - choice.attackers.length * 0.05;
    }

    private usefulSets(cards: ConflictPlannerCharacter[], axis: ConflictAxis,
        forced: ConflictPlannerCharacter[], defending: boolean): ConflictPlannerCharacter[][] {
        const forcedIds = new Set(forced.map((card) => card.uuid));
        const optional = cards.filter((card) => !forcedIds.has(card.uuid));
        const other: ConflictAxis = axis === 'military' ? 'political' : 'military';
        const score = (card: ConflictPlannerCharacter) => this.skill(card, axis) -
            this.skill(card, other) * this.profile.preserveOtherAxisWeight;
        const orders = [
            optional.slice().sort((a, b) => score(b) - score(a) || a.uuid.localeCompare(b.uuid)),
            optional.slice().sort((a, b) => this.skill(b, axis) - this.skill(a, axis) || a.uuid.localeCompare(b.uuid)),
            optional.slice().sort((a, b) => this.skill(a, axis) - this.skill(b, axis) || a.uuid.localeCompare(b.uuid))
        ];
        // A defender may always commit nothing extra — but bodies already
        // locked into the conflict cannot be withdrawn, so the smallest legal
        // defense is the forced set, not the empty one.
        const sets: ConflictPlannerCharacter[][] = defending ? [forced.slice()] : [];
        for(const order of orders) {
            for(let size = 1; size <= order.length; size++) {
                sets.push([...forced, ...order.slice(0, size)]);
            }
        }
        if(forced.length > 0) {
            sets.push(forced.slice());
        }
        const unique = new Map<string, ConflictPlannerCharacter[]>();
        for(const set of sets) {
            const ordered = set.slice().sort((a, b) => a.uuid.localeCompare(b.uuid));
            unique.set(ordered.map((card) => card.uuid).join(','), ordered);
        }
        return [...unique.values()]
            .sort((left, right) => left.length - right.length ||
                right.reduce((sum, card) => sum + this.skill(card, axis), 0) -
                left.reduce((sum, card) => sum + this.skill(card, axis), 0))
            .slice(0, Math.max(1, this.profile.maxAttackSets));
    }

    private availableCharacters(state: SearchState, input: ConflictPhasePlannerInput,
        side: 'self' | 'opponent', axis: ConflictAxis): ConflictPlannerCharacter[] {
        const cards = side === 'self' ? input.selfCharacters : input.opponentCharacters;
        const ready = side === 'self' ? state.selfReady : state.opponentReady;
        return cards.filter((card) => ready.has(card.uuid) &&
            (axis === 'military' ? card.legalMilitary !== false : card.legalPolitical !== false));
    }

    private legalTargets(targets: ConflictPlannerTarget[], broken: number): ConflictPlannerTarget[] {
        const stronghold = targets.filter((target) => target.stronghold);
        if(broken >= 3 && stronghold.length > 0) {
            return stronghold;
        }
        return targets.filter((target) => !target.stronghold)
            .sort((a, b) => (a.priority || 0) - (b.priority || 0) || a.strength - b.strength);
    }

    private immediateValue(actor: 'self' | 'opponent', choice: AttackChoice,
        defenders: ConflictPlannerCharacter[], won: boolean, broke: boolean): number {
        // A deck's confidence in its own line. It is scored inside the rollout
        // (not bolted on afterwards) so an option only wins when its bonus plus
        // the sequence it enables beats every alternative sequence.
        let value = (Number(choice.optionBonus) || 0) + choice.ring.fate * this.profile.ringFateValue;
        if(won) {
            value += this.profile.conflictWinValue * this.profile.aggression;
            value += this.ringValue(choice.ring, actor) * this.profile.ringEffectValue;
            if(defenders.length === 0) {
                value += this.profile.unopposedValue;
            }
        } else {
            value -= this.profile.claimedRingValue * this.ringValue(choice.ring,
                actor === 'self' ? 'opponent' : 'self');
        }
        if(broke) {
            value += choice.target.stronghold
                ? this.profile.strongholdBreakValue
                : this.profile.provinceBreakValue * this.profile.aggression;
        }
        return value;
    }

    private terminalValue(state: SearchState, input: ConflictPhasePlannerInput): number {
        const readyValue = (side: 'self' | 'opponent') => {
            const opportunities = side === 'self' ? state.selfOpportunities : state.opponentOpportunities;
            const cards = this.availableCharacters(state, input, side, 'military')
                .reduce((sum, card) => sum + this.skill(card, 'military') * Math.min(1, opportunities.military), 0) +
                this.availableCharacters(state, input, side, 'political')
                    .reduce((sum, card) => sum + this.skill(card, 'political') * Math.min(1, opportunities.political), 0);
            return cards;
        };
        return (readyValue('self') - readyValue('opponent')) * this.profile.readySkillValue;
    }

    private ringValue(ring: ConflictPlannerRing | undefined, actor: 'self' | 'opponent'): number {
        if(!ring) {
            return 0;
        }
        return Math.max(0, Number(actor === 'self' ? ring.selfValue : ring.opponentValue) || 0);
    }

    private handThreat(input: ConflictPhasePlannerInput, side: 'self' | 'opponent', axis: ConflictAxis): number {
        const threat = side === 'self' ? input.selfHandThreat : input.opponentHandThreat;
        const opportunities = side === 'self' ? input.selfOpportunities : input.opponentOpportunities;
        // A hand is one shared budget, not a fresh boost in every branch of
        // the rollout. Amortize it across that side's remaining declarations.
        return Math.max(0, Number(threat?.[axis]) || 0) /
            Math.max(1, Number(opportunities.total) || 0);
    }

    private skill(card: ConflictPlannerCharacter, axis: ConflictAxis): number {
        return Math.max(0, Number(card[axis]) || 0);
    }

    private spendOpportunity(opportunities: ConflictPlannerOpportunities, axis: ConflictAxis): void {
        opportunities.total = Math.max(0, opportunities.total - 1);
        opportunities[axis] = Math.max(0, opportunities[axis] - 1);
    }

    private advanceActor(state: SearchState): SearchState {
        const current = state.actor === 'self' ? state.selfOpportunities : state.opponentOpportunities;
        if(current.total > 0) {
            return state;
        }
        const other = state.actor === 'self' ? state.opponentOpportunities : state.selfOpportunities;
        return other.total > 0 ? { ...state, actor: state.actor === 'self' ? 'opponent' : 'self' } : state;
    }

    private copyOpportunities(value: ConflictPlannerOpportunities): ConflictPlannerOpportunities {
        return {
            total: Math.max(0, Math.floor(Number(value.total) || 0)),
            military: Math.max(0, Math.floor(Number(value.military) || 0)),
            political: Math.max(0, Math.floor(Number(value.political) || 0))
        };
    }

    private cloneState(state: SearchState): SearchState {
        return {
            selfReady: new Set(state.selfReady),
            opponentReady: new Set(state.opponentReady),
            selfOpportunities: this.copyOpportunities(state.selfOpportunities),
            opponentOpportunities: this.copyOpportunities(state.opponentOpportunities),
            rings: state.rings.map((ring) => ({ ...ring })),
            selfTargets: state.selfTargets.map((target) => ({ ...target })),
            opponentTargets: state.opponentTargets.map((target) => ({ ...target })),
            selfBroken: state.selfBroken,
            opponentBroken: state.opponentBroken,
            actor: state.actor,
            depth: state.depth
        };
    }

    private stateKey(state: SearchState): string {
        const opportunities = (value: ConflictPlannerOpportunities) =>
            `${value.total}/${value.military}/${value.political}`;
        return [
            state.actor,
            state.depth,
            [...state.selfReady].sort().join(','),
            [...state.opponentReady].sort().join(','),
            opportunities(state.selfOpportunities),
            opportunities(state.opponentOpportunities),
            state.rings.map((ring) => ring.element).sort().join(','),
            state.selfTargets.map((target) => target.location).sort().join(','),
            state.opponentTargets.map((target) => target.location).sort().join(','),
            state.selfBroken,
            state.opponentBroken
        ].join('|');
    }

    private passPlan(score: number, reason: string): ConflictPhasePlan {
        return { action: 'pass', attackerUuids: [], score, sequence: [], reason };
    }
}

export default ConflictPhasePlanner;
