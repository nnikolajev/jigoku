// READY -> MOVE: the two-action sequence.
//
// `ReadyValuePolicy` refuses to spend a card readying a body no conflict can
// use. One of the three uses it recognises is "we can MOVE it into the conflict
// that is running" — and that use was held OFF, because the bot decided the
// ready and the move at separate prompts with nothing tying them together. It
// readied a body because a mover existed and then never used the mover.
//
// This module is that missing link. It plans BOTH actions at once, from the
// board alone, and it is re-derived at every prompt rather than stored:
//
//   * the chosen body is BOWED and at home  -> stage `ready`. Do the ready now;
//     the plan reserves the move source and its cost.
//   * the chosen body is READY and at home  -> stage `move`. Do the move now.
//
// Because the plan is a pure function of the board, the second prompt
// re-derives the same body (it is now the cheapest candidate — no ready leg
// left to pay for) with no cross-prompt state to go stale. What the plan MUST
// do at stage `ready` is budget for the move as well: readying with only enough
// fate for the ready is how the sequence breaks in half.
//
// WHEN IT IS WORTH DOING
// Not "whenever we can". A body arriving in a conflict has to change the
// result:
//
//   * it wins a conflict we are losing        (`winSkillNeeded`)
//   * it breaks the province, or stops ours breaking (`strengthNeeded` —
//     `conflictStrengthNeeded` already folds both roles into one number)
//   * it triggers a participation payoff that does not need skill at all
//
// The last one is deck-specific and OFF unless a deck supplies it. For a
// generic deck holding Favorable Ground, only ready -> move brings value:
// moving a body that will still be bowed adds 0 skill and does nothing. For
// Unicorn it is different — `isParticipating()` is bow-agnostic, so a BOWED
// participant still counts for Minami Kaze Regulars' after-win reaction,
// Higashi Kaze Company's, Shinjo Shono's `hasMoreParticipants` condition and
// Outskirts Sentry's on-move honor. That payoff arrives through
// `participationPayoff`, which `UnicornTactics` supplies.

/**
 * Every card in the engine that moves a character WE ALREADY CONTROL, and that
 * is sitting at HOME, into the conflict being fought. Derived by grepping the
 * card implementations for `moveToConflict` and then discarding the ones that
 * do something else with it:
 *
 *   * `doji-challenger`, `kitsu-motso` move an ENEMY character in;
 *   * `cavalry-reserves`, `kitsu-spiritcaller`, `forebearer-s-echoes` put a
 *     card from a DECK or DISCARD into the conflict — no home body involved;
 *   * `diversionary-maneuver` moves participants HOME.
 *
 * `hawk-tattoo` is deliberately absent: it moves its bearer through a
 * REACTION fired when the attachment enters play, so the bearer is not chosen
 * until the attachment is already paid for. That is a different code path from
 * "click a source, choose who moves", and planning it would need the
 * attachment-target machinery rather than an action's own legal targets.
 *
 * `test/server/bots/readymoveplanner.spec.js` checks every id here resolves to
 * a real card class, so a typo cannot silently darken a branch.
 *
 * `cost` is FATE. A sacrifice, a self-bow or an honor loss is 0 — none of them
 * competes for the fate pool that the second leg of the sequence also needs.
 */
export interface MoveSourceSpec {
    id: string;
    cost: number;
    /** 'play' is already on the board (click it); 'hand' must be played. */
    zone: 'play' | 'hand';
    /** Restricts the conflict type this source works in. */
    conflictType?: 'military' | 'political';
    /** Only moves a Cavalry character. */
    requiresCavalry?: boolean;
    /** Only moves the character it is attached to, or itself. */
    selfOrBearerOnly?: boolean;
    /** Usable only while we are the DEFENDING player. */
    defendingOnly?: boolean;
    /** Only while we control FEWER participants than the opponent. */
    requiresFewerParticipants?: boolean;
    /** Only while we are more honorable than the opponent. */
    requiresHonorLead?: boolean;
    /** Readies the character as part of the same action. */
    readiesAndMoves?: boolean;
    /** One use per round (a stronghold bow, a once-per-round action). */
    oncePerRound?: boolean;
}

export const MOVE_SOURCES: readonly MoveSourceSpec[] = Object.freeze([
    // Sacrifice this holding, move any character we control. The generic
    // workhorse, and the one the owner named: for a deck with no participation
    // payoff this is the whole reason ready -> move exists.
    { id: 'favorable-ground', cost: 0, zone: 'play' },
    // Bow the stronghold, military only, Cavalry only.
    { id: 'golden-plains-outpost', cost: 0, zone: 'play', conflictType: 'military',
        requiresCavalry: true, oncePerRound: true },
    // Free event, Cavalry only.
    { id: 'ride-on', cost: 0, zone: 'hand', requiresCavalry: true },
    // Attachment action: the bearer moves in and an enemy participant bows.
    { id: 'adorned-barcha', cost: 0, zone: 'play', conflictType: 'military',
        selfOrBearerOnly: true },
    // Attachment action, political only, bearer needs glory 2+ to wear it.
    { id: 'formal-invitation', cost: 0, zone: 'play', conflictType: 'political',
        selfOrBearerOnly: true },
    // Character action, military, needs the honor lead. Moves anyone.
    { id: 'matsu-mitsuko', cost: 0, zone: 'play', conflictType: 'military',
        requiresHonorLead: true },
    // Character action: lose 1 honor, move ITSELF in.
    { id: 'moto-eviscerator', cost: 0, zone: 'play', selfOrBearerOnly: true },
    // Only while outnumbered.
    { id: 'even-the-odds', cost: 0, zone: 'hand', requiresFewerParticipants: true },
    // Sacrifice itself while DEFENDING: readies AND moves in one action, so a
    // bowed body needs no separate ready leg.
    { id: 'hiruma-signaller', cost: 0, zone: 'play', defendingOnly: true,
        readiesAndMoves: true }
]);

const MOVE_SOURCE_BY_ID: ReadonlyMap<string, MoveSourceSpec> =
    new Map(MOVE_SOURCES.map((spec) => [spec.id, spec]));

export function moveSourceSpec(cardId: string): MoveSourceSpec | undefined {
    return MOVE_SOURCE_BY_ID.get(String(cardId || ''));
}

export const MOVE_INTO_CONFLICT_SOURCE_IDS: readonly string[] =
    Object.freeze(MOVE_SOURCES.map((spec) => spec.id));

/**
 * Cards that READY one of our characters as an ACTION we can take on demand.
 * Reaction-only readies (Sacred Sanctuary, Twilight Rider) are excluded: the
 * sequencer has to be able to fire the first leg when it wants to, not when a
 * trigger happens to arrive.
 *
 * Same `cost` convention as `MOVE_SOURCES`: fate only.
 */
export interface ReadySourceSpec {
    id: string;
    cost: number;
    zone: 'play' | 'hand';
    /** Target must carry this trait. */
    trait?: string;
    /** Target must belong to this faction (`i-am-ready` is Unicorn only). */
    faction?: string;
    /** Target must be honored. */
    requiresHonored?: boolean;
    /** Target must be unique. */
    requiresUnique?: boolean;
    /** Target printed cost ceiling. */
    maxPrintedCost?: number;
    /** Target must carry MORE than this much fate (the cost removes one). */
    minTargetFate?: number;
    /** We must hold a claimed military ring. */
    requiresClaimedMilitaryRing?: boolean;
    /** We must control another ready non-unique body to pay the bow cost. */
    requiresReadyNonUniqueCost?: boolean;
    /** We must control a spare body to sacrifice. */
    requiresSacrificeFodder?: boolean;
    oncePerRound?: boolean;
    /**
     * The target must ALREADY be participating, so this source can only ever be
     * the SECOND leg: move the body in, then ready it. `fan-of-command` and
     * `the-pursuit-of-justice` are the two the field decks run.
     *
     * These fail `meetsRequirements` with `'target'` while no legal participant
     * exists, which is exactly the state the plan is trying to create — so the
     * controller checks them with `ignoredRequirements: ['target']` and projects
     * the eligible HOME bodies itself.
     */
    participantOnly?: boolean;
    /** Only readies itself (Moto Outrider, Twilight Rider). */
    selfOnly?: boolean;
}


export const READY_SOURCES: readonly ReadySourceSpec[] = Object.freeze([
    { id: 'against-the-waves', cost: 1, zone: 'hand', trait: 'shugenja' },
    // The cost REMOVES a fate from the target, so a body on its last fate
    // would be readied straight into the fate phase discard.
    { id: 'i-am-ready', cost: 0, zone: 'hand', faction: 'unicorn', minTargetFate: 1 },
    { id: 'in-service-to-my-lord', cost: 0, zone: 'hand', requiresUnique: true,
        requiresReadyNonUniqueCost: true },
    { id: 'elegance-and-grace', cost: 2, zone: 'hand', requiresHonored: true, maxPrintedCost: 6 },
    { id: 'right-hand-of-the-emperor', cost: 3, zone: 'hand', trait: 'bushi', maxPrintedCost: 6 },
    { id: 'shiotome-encampment', cost: 0, zone: 'play', trait: 'cavalry',
        requiresClaimedMilitaryRing: true },
    { id: 'hayaken-no-shiro', cost: 0, zone: 'play', trait: 'bushi', maxPrintedCost: 2,
        oncePerRound: true },
    { id: 'magistrate-station', cost: 0, zone: 'play', requiresHonored: true },
    { id: 'steadfast-witch-hunter', cost: 0, zone: 'play', requiresSacrificeFodder: true },
    // ---- second leg only: the body must already be participating ----
    // Attachment Action while its bearer participates: ready a participating
    // Bushi. LionDuelist runs it alongside four move sources, which makes that
    // deck the clearest move -> ready case in the field.
    { id: 'fan-of-command', cost: 0, zone: 'play', trait: 'bushi', participantOnly: true },
    // Province Action at a water conflict province: ready a participant.
    // Dragon runs it alongside Favorable Ground.
    { id: 'the-pursuit-of-justice', cost: 0, zone: 'play', participantOnly: true,
        oncePerRound: true },
    // Self-readies once participating in a military conflict.
    { id: 'moto-outrider', cost: 0, zone: 'play', participantOnly: true, selfOnly: true }
]);

const READY_SOURCE_BY_ID: ReadonlyMap<string, ReadySourceSpec> =
    new Map(READY_SOURCES.map((spec) => [spec.id, spec]));

export function readySourceSpec(cardId: string): ReadySourceSpec | undefined {
    return READY_SOURCE_BY_ID.get(String(cardId || ''));
}

/**
 * Exact legal targets per source card id, published by
 * `JigokuBotController.sequenceSourceTargets` from the live engine. A source id
 * absent from a map is not usable right now — its `meetsRequirements` failed,
 * or it has no legal target.
 */
export interface SequenceSourceTargets {
    ready: Record<string, string[]>;
    move: Record<string, string[]>;
    /** Ready sources that can only reach the body ONCE IT PARTICIPATES, mapped
     *  to the home bodies they would be able to ready after a move. */
    readyAfterMove: Record<string, string[]>;
}

/**
 * Turn the controller's exact target map into the option lists the planner
 * consumes, attaching each source's fate cost from the spec tables.
 */
export interface SequenceOptions {
    readyOptions: SequenceOption[];
    moveOptions: SequenceOption[];
    readyAfterMoveOptions: SequenceOption[];
}

export function sequenceOptionsFrom(targets: SequenceSourceTargets | undefined): SequenceOptions {
    const build = (
        map: Record<string, string[]> | undefined,
        specOf: (id: string) => { cost: number; readiesAndMoves?: boolean } | undefined
    ): SequenceOption[] => {
        const options: SequenceOption[] = [];
        for(const [sourceId, uuids] of Object.entries(map || {})) {
            const spec = specOf(sourceId);
            if(!spec) {
                continue;
            }
            for(const uuid of uuids || []) {
                options.push({
                    sourceId,
                    cost: spec.cost,
                    uuid: String(uuid),
                    readiesAndMoves: spec.readiesAndMoves
                });
            }
        }
        return options;
    };
    return {
        readyOptions: build(targets?.ready, readySourceSpec),
        moveOptions: build(targets?.move, moveSourceSpec),
        readyAfterMoveOptions: build(targets?.readyAfterMove, readySourceSpec)
    };
}

export interface ReadyMoveConfig {
    // False disables planning entirely; `ReadyValuePolicy` then never sees a
    // committed plan and the ready -> move branch stays dark.
    enabled: boolean;
    // Minimum combined value (projected skill + payoff) before a sequence is
    // worth two actions. Raising it makes the bot pickier.
    minimumValue: number;
    // Allow a plan whose only justification is a participation payoff, i.e.
    // moving a body that will still be BOWED. Needs `participationPayoff` to
    // return something, so it is inert for a deck that supplies none.
    allowPayoffOnlyMoves: boolean;
    // Spend at most this share of our fate on the whole sequence. 1 means the
    // sequence may take the last fate.
    maxFateShare: number;
    // Allow the MOVE-first order: move a bowed body in, then stand it up with a
    // source that can only reach a participant (Fan of Command readies a
    // participating Bushi, The Pursuit of Justice a participating character).
    // `false` keeps only the ready-first order, which is what shipped before.
    allowMoveThenReady: boolean;
    // When a deck ships its OWN movement planner, let it own the move-target
    // pick and stand aside. True today for Unicorn, whose `UnicornTactics`
    // scorer is a measured deck-specific model (Spyglass draw value, Moto
    // Stables, Outskirts Sentry glory, the Barcha bow+move swing, and the
    // Minami/Higashi after-win reactions that pay even for a BOWED body).
    //
    // This is a knob rather than a hard-coded deferral precisely so the two can
    // be compared: `false` hands the same picks to the generic planner.
    deferToDeckMovePlanner: boolean;
}

export const DEFAULT_READY_MOVE: ReadyMoveConfig = {
    enabled: true,
    minimumValue: 1,
    allowPayoffOnlyMoves: true,
    maxFateShare: 1,
    allowMoveThenReady: true,
    deferToDeckMovePlanner: true
};

/** One legal (source, character) pairing the caller has already checked for
 *  legality. `cost` is FATE that must be paid — a sacrifice, a bow or an honor
 *  loss is 0 here, because none of them competes for the fate pool. */
export interface SequenceOption {
    sourceId: string;
    cost: number;
    uuid: string;
    /** The source both readies AND moves in one action (Hiruma Signaller). */
    readiesAndMoves?: boolean;
}

export interface ReadyMovePlanInput {
    /** Our characters, live board summaries. */
    characters: readonly any[];
    /** A conflict is running. Nothing here applies otherwise. */
    conflictActive: boolean;
    fate: number;
    /** Skill still needed to WIN this conflict; 0 when already winning. */
    winSkillNeeded: number;
    /** Skill still needed to break the attacked province, or to stop ours
     *  breaking. `JigokuBotPolicy.conflictStrengthNeeded` folds both roles
     *  into this one number. */
    strengthNeeded: number;
    /** Legal ready pairings available right now, on a body at HOME. */
    readyOptions: readonly SequenceOption[];
    /** Ready pairings that only become legal once the body PARTICIPATES, i.e.
     *  the second leg of a move -> ready sequence. */
    readyAfterMoveOptions?: readonly SequenceOption[];
    /** Legal move-into-conflict pairings available right now. */
    moveOptions: readonly SequenceOption[];
    /** Skill this character would contribute on the contested axis. */
    skillOf: (card: any) => number;
    /** Deck-specific value of merely PARTICIPATING, bowed or not. Returns 0
     *  for every deck that does not supply one. */
    participationPayoff?: (card: any) => number;
    /**
     * A body this conflict already spent a ready leg on. The plan is stateless
     * by design, so without this a BETTER plan appearing between the two legs
     * silently orphans the card that was already paid — measured live as three
     * sequences that readied a body and never moved it. Finishing what was
     * started outranks starting something better.
     */
    preferUuid?: string;
}

export interface ReadyMovePlan {
    card: any;
    uuid: string;
    /**
     * Which leg to take NOW. Derived from the board, not stored: a bowed body
     * at home under a `ready-first` plan is at stage `ready`; the same body
     * under a `move-first` plan is at stage `move`, and becomes stage `ready`
     * again once it is a bowed PARTICIPANT.
     */
    stage: 'ready' | 'move';
    /**
     * The order the two legs run in. `move-first` exists because some ready
     * sources can only reach a body that is already participating — Fan of
     * Command readies a participating Bushi, The Pursuit of Justice a
     * participating character — so for those the move HAS to come first.
     */
    order: 'ready-first' | 'move-first';
    readySourceId: string | null;
    moveSourceId: string;
    totalCost: number;
    projectedSkill: number;
    payoff: number;
    value: number;
    reason: string;
}

const cheapest = (options: readonly SequenceOption[], uuid: string): SequenceOption | null =>
    options.filter((option) => option.uuid === uuid)
        .sort((a, b) => a.cost - b.cost || a.sourceId.localeCompare(b.sourceId))[0] || null;

export class ReadyMovePlanner {
    readonly config: ReadyMoveConfig;

    constructor(config: Partial<ReadyMoveConfig> = {}) {
        this.config = { ...DEFAULT_READY_MOVE, ...config };
    }

    /** True when this configuration can never produce a plan, so the call site
     *  can stay entirely out of the way. */
    get inert(): boolean {
        return !this.config.enabled;
    }

    plan(input: ReadyMovePlanInput): ReadyMovePlan | null {
        if(!this.config.enabled || !input.conflictActive) {
            return null;
        }
        const budget = Math.max(0, Number(input.fate) || 0) * this.config.maxFateShare;
        const payoffOf = input.participationPayoff || (() => 0);
        const winNeeded = Math.max(0, Number(input.winSkillNeeded) || 0);
        const breakNeeded = Math.max(0, Number(input.strengthNeeded) || 0);

        const plans: ReadyMovePlan[] = [];
        const readyAfterMove = this.config.allowMoveThenReady
            ? (input.readyAfterMoveOptions || [])
            : [];
        for(const card of input.characters || []) {
            const uuid = String(card?.uuid || '');
            if(!uuid) {
                continue;
            }
            // SECOND leg of a move -> ready sequence: the body is already in the
            // conflict and bowed, and a participant-only source can stand it up.
            // This is the one case where a participant is a plan candidate; every
            // other in-conflict body is somebody else's decision.
            if(card.inConflict) {
                const standUp = cheapest(readyAfterMove, uuid);
                if(!card.bowed || !standUp || standUp.cost > budget) {
                    continue;
                }
                const arrived = Math.max(0, Number(input.skillOf(card)) || 0);
                plans.push({
                    card,
                    uuid,
                    stage: 'ready',
                    order: 'move-first',
                    readySourceId: standUp.sourceId,
                    moveSourceId: '',
                    totalCost: standUp.cost,
                    projectedSkill: arrived,
                    payoff: payoffOf(card),
                    value: arrived + payoffOf(card),
                    reason: 'ready-after-move'
                });
                continue;
            }
            const move = cheapest(input.moveOptions, uuid);
            if(!move) {
                continue;
            }
            // A source that readies AND moves in one action (Hiruma Signaller)
            // needs no ready leg even for a bowed body.
            const needsReady = !!card.bowed && !move.readiesAndMoves;
            const readyFirst = needsReady ? cheapest(input.readyOptions, uuid) : null;
            const readyLater = needsReady ? cheapest(readyAfterMove, uuid) : null;
            if(needsReady && !readyFirst && !readyLater) {
                // Bowed with no way to stand it up in either order. It can still
                // be worth moving for a participation payoff, and for nothing
                // else: it will contribute 0 skill.
                const bowedPayoff = payoffOf(card);
                if(!this.config.allowPayoffOnlyMoves || bowedPayoff <= 0 || move.cost > budget) {
                    continue;
                }
                plans.push({
                    card,
                    uuid,
                    stage: 'move',
                    order: 'move-first',
                    readySourceId: null,
                    moveSourceId: move.sourceId,
                    totalCost: move.cost,
                    projectedSkill: 0,
                    payoff: bowedPayoff,
                    value: bowedPayoff,
                    reason: 'move-bowed-for-participation-payoff'
                });
                continue;
            }
            // Both orders reach the same board; take the cheaper. On a tie
            // prefer READY first, because the body then never spends a window
            // in the conflict contributing 0 — an opponent acting in between
            // sees a real defender rather than a bowed one.
            const firstCost = readyFirst ? readyFirst.cost : Infinity;
            const laterCost = readyLater ? readyLater.cost : Infinity;
            const useMoveFirst = needsReady && laterCost < firstCost;
            const ready = needsReady ? (useMoveFirst ? readyLater : readyFirst) : null;
            const totalCost = move.cost + (ready ? ready.cost : 0);
            if(totalCost > budget) {
                continue;
            }
            // It arrives READY under `ready-first`, and stands up immediately
            // after arriving under `move-first`, so its full skill lands either
            // way; the difference is only the window in between.
            const projectedSkill = Math.max(0, Number(input.skillOf(card)) || 0);
            const payoff = payoffOf(card);
            const order: 'ready-first' | 'move-first' =
                !needsReady || !useMoveFirst ? 'ready-first' : 'move-first';
            plans.push({
                card,
                uuid,
                stage: needsReady && order === 'ready-first' ? 'ready' : 'move',
                order,
                readySourceId: ready ? ready.sourceId : null,
                moveSourceId: move.sourceId,
                totalCost,
                projectedSkill,
                payoff,
                value: projectedSkill + payoff,
                reason: !needsReady
                    ? 'move-into-conflict'
                    : (order === 'ready-first'
                        ? 'ready-then-move-into-conflict'
                        : 'move-then-ready-into-conflict')
            });
        }

        const decisive = plans.filter((candidate) =>
            this.makesADifference(candidate, winNeeded, breakNeeded));
        if(decisive.length === 0) {
            return null;
        }
        // A body whose ready leg is already paid for comes first, whatever
        // else the board now offers: that card is spent either way, and the
        // only way to get anything back for it is the move. Then best value,
        // then the cheapest sequence, then a stable uuid tie-break so the plan
        // is identical at both prompts.
        const committed = String(input.preferUuid || '');
        const startedRank = (candidate: ReadyMovePlan) =>
            committed && candidate.uuid === committed ? 0 : 1;
        return decisive.sort((a, b) =>
            startedRank(a) - startedRank(b) ||
            b.value - a.value ||
            a.totalCost - b.totalCost ||
            a.uuid.localeCompare(b.uuid))[0];
    }

    /**
     * Does this body arriving actually change the result? Adding skill to a
     * conflict that is already won and already breaking changes nothing, and
     * that is the case the gate exists to refuse.
     */
    private makesADifference(candidate: ReadyMovePlan, winNeeded: number, breakNeeded: number): boolean {
        if(candidate.value < this.config.minimumValue) {
            return false;
        }
        // A payoff is its own justification: it does not come from skill and
        // is not capped by the conflict already being won.
        if(candidate.payoff > 0) {
            return true;
        }
        if(winNeeded > 0 && candidate.projectedSkill >= winNeeded) {
            return true;
        }
        return breakNeeded > 0 && candidate.projectedSkill >= breakNeeded;
    }
}
