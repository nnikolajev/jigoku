// WHICH BODY DOES THIS ATTACHMENT GO ON, WHILE A CONFLICT IS RUNNING?
//
// An attachment is permanent, so the bot's default home for one is a multi-fate
// "tower" it means to keep — power the durable body up BEFORE it commits, and
// it enters every later conflict already strong. That is right whenever the
// conflict on the table is already decided.
//
// It is wrong whenever the conflict on the table still needs skill from us. A
// bowed body and a body at home both contribute exactly 0 (`conflict.ts`
// counts only unbowed participants), so a stat line hung there is a skill
// bonus that arrives one conflict too late — and the province the bot was
// attacking breaks, or does not, on the difference.
//
// V1 asked only "am I LOSING this conflict", which misses the whole middle:
// winning 4 vs 2 into a strength-5 province is a conflict that still needs 3
// skill, and V1 sent the weapon home. Seen live 2026-08-24 (Unicorn vs Dragon,
// round 3 conflict 3: Seal of the Unicorn onto a bowed Young Warrior at home
// while the attack sat 3 short of the break) and reproduced across nine decks
// by `test/server/integration/botattachmentvalue.spec.js`.
//
// The policy is generic: it takes a board reading, not a card id, and every
// attachment-target picker — the shared one and the deck overlays — asks it the
// same question.

export interface AttachmentTargetConfig {
    // False reproduces V1 exactly: only a conflict we are LOSING pulls an
    // attachment onto a participant; every other board takes the tower.
    enabled: boolean;
    // Pull the attachment onto an unbowed participant whenever the running
    // conflict still needs skill from our side — as attacker, to reach the
    // province strength; as defender, to stop the break or retake the
    // conflict. This is the lever.
    preferParticipantWhenNeeded: boolean;
    // Ignore the preference when the conflict needs more skill than this. A
    // conflict 14 short is not being rescued by a +1 weapon, and the durable
    // body is the better home for it. 0 disables the cap.
    maxSkillNeeded: number;
    // Read the attachment's LEGAL bearers before playing it, and hold it when
    // none of them can use it in the conflict being fought.
    //
    // The bot's whole view of the board is the serialized player state, which
    // carries no card text: nothing in it says that Minami Kaze Regulars takes
    // "no attachments except Weapon". So the play gate priced Seal of the
    // Unicorn as +1 military on the best body in play, played it, and only
    // then discovered at the target prompt that the only legal home was a
    // bowed body at home. With this on, the gate asks the ENGINE which bodies
    // could carry THIS card (`legalAttachmentTargetUuidsBySource`) and holds it
    // for a window where one of them is fighting — which is what makes the bot
    // reach for the Weapon in the same hand instead.
    requireUsableBearer: boolean;
    // Refuse a bearer the RULES bar from the conflict type the card works in.
    //
    // The other three flags all reason about STATE the board publishes — bowed,
    // at home, fighting. This one is about a ban the board never mentions:
    // Stolen Breath and Pacifism switch off a whole conflict type for as long
    // as they sit there, Shiba Peacemaker and Otomo Courtier switch off the
    // attacking side, and a printed dash does the same with no attachment at
    // all. A body under one of those is at home, unbowed, and permanently
    // unable to use a move-in card — so every other test here waves it through
    // and the ENGINE then refuses the Action the card exists for.
    //
    // Live defect 2026-08-28 (LionDuelist vs PhoenixShugenja, r3): a Matsu
    // Tsuko wearing Stolen Breath sat at home through a political conflict, the
    // bot hung a SECOND Formal Invitation on her, and passed the window.
    //
    // Only sources that name their own axis are judged (`MOVE_SOURCES`), and
    // rider sources are exempt — Adorned Barcha's bow pays whether or not its
    // bearer arrives. `false` restores the pre-2026-08-28 behaviour.
    requireParticipableBearer: boolean;
    // Hold a stat attachment while every legal bearer is SPENT for the round.
    //
    // An attachment is permanent, so the bot's default is to invest it early in
    // a durable "tower" — and the tower branch is reached exactly when the
    // conflict on the table needs nothing (`preferParticipantBearer` is false),
    // which is also when nothing can use the card. Live 2026-08-28 (LionDuelist
    // vs ScorpionBidWar, r2): an unopposed 2-0 attack that was not breaking,
    // and the bot spent Blade of 10,000 Battles (2 fate), Fan of Command (1)
    // and Formal Invitation (0) on a BOWED Akodo Toturi. A bowed body readies
    // in the FATE phase, so all three bonuses were dead for the rest of the
    // round, and the 3 fate was gone.
    //
    // Owner's rule: "it can keep them and attach when character is readied ...
    // it's better to keep fate and cards until a ready character is available,
    // even for next turn". Holding costs nothing — the card stays in hand and
    // the fate stays in the pool — and it keeps the choice of bearer open.
    //
    // `false` restores the pre-2026-08-28 behaviour exactly.
    holdUntilBearerCanUseIt: boolean;
}

/**
 * What one candidate bearer can still do with a stat attachment before the
 * round ends. Every field is a board reading, so this stays a pure function.
 */
export interface UsableBearerInput {
    bowed: boolean;
    participating: boolean;
    /** The running conflict still needs skill from our side. */
    conflictNeedsSkill: boolean;
    /** A participant that does NOT bow on return home (engine: `DoesNotBow`). */
    staysReadyAfterConflict: boolean;
    /** A conflict opportunity is left this round, on either side. */
    conflictOpportunityRemains: boolean;
    /** The engine says a ready source can stand this body up right now. */
    readySourceAvailable: boolean;
    /** The engine says a move source can put this body into the conflict now. */
    moveSourceAvailable: boolean;
    /** A ready source could stand it up AFTER it arrives (the move -> ready
     *  order `ReadyMovePlanner` already plans). */
    readyAfterMoveAvailable: boolean;
    /** This card's payoff fires for a PARTICIPATING bearer whatever its bow
     *  state (`CardPlaybook.bowedParticipantPays`). */
    payoffIgnoresBow: boolean;
    /** The payoff does not depend on the bearer's state AT ALL — Adorned
     *  Barcha's Action bows a chosen enemy participant and the bearer's own
     *  movement is a rider that may simply fail. */
    payoffIgnoresBearerState: boolean;
    /** The payoff fires when the bearer MOVES INTO a conflict, which a bowed
     *  body can be made to do — Spyglass draws on "commits OR moves". */
    payoffOnMoveIn: boolean;
    /** A move-in card whose value is the bearer ARRIVING with skill, so a bowed
     *  bearer works only if it can also be readied (Formal Invitation). */
    needsSkillOnArrival: boolean;
    /** The payoff READIES the bearer (Waterfall Tattoo), so a bowed bearer is
     *  not a waste — it is the point of the card. */
    payoffReadiesBearer: boolean;
}

export const DEFAULT_ATTACHMENT_TARGET: AttachmentTargetConfig = {
    // Default false is V1 exactly, so the lever is an A/B arm
    // (`{"attachmentTarget":{"enabled":true}}`) before it is a default.
    enabled: false,
    preferParticipantWhenNeeded: true,
    maxSkillNeeded: 6,
    requireUsableBearer: true,
    requireParticipableBearer: true,
    // Default false is the pre-2026-08-28 behaviour, so the rule is an A/B arm
    // (`{"attachmentTarget":{"holdUntilBearerCanUseIt":true}}`) before it is a
    // default.
    holdUntilBearerCanUseIt: false
};

export interface AttachmentTargetInput {
    // Are we behind on the conflict right now? V1's whole rule.
    losing: boolean;
    // Skill our side still has to find for this conflict to change its result,
    // from `JigokuBotPolicy.conflictStrengthNeeded`. Null when no conflict is
    // running, which is exactly when the tower is right.
    skillNeeded: number | null;
}

/**
 * Attachments whose whole value is a bearer that is NOT yet in the conflict.
 * Two of them are `MOVE_SOURCES` entries with `selfOrBearerOnly` — their Action
 * moves the bearer INTO the fight, so hanging them on a body already there
 * throws the card away — and Spyglass pays its move bonus from home. Narrowing
 * these onto a participant is the opposite of the fix.
 */
export const HOME_BEARER_ATTACHMENT_IDS: ReadonlySet<string> = new Set([
    'adorned-barcha',
    'formal-invitation',
    'spyglass'
]);

/**
 * The subset of those whose payoff is the bearer ARRIVING with skill, so a
 * bowed home body is no better than a participating one. Adorned Barcha is
 * deliberately absent: its Action bows an enemy participant whatever the
 * bearer's own skill, which is the value `movevalue.js` credits it with.
 */
export const HOME_BEARER_NEEDS_READY_IDS: ReadonlySet<string> = new Set([
    'formal-invitation'
]);

export class AttachmentTargetPolicy {
    private config: AttachmentTargetConfig;

    constructor(config: Partial<AttachmentTargetConfig> = {}) {
        this.config = { ...DEFAULT_ATTACHMENT_TARGET, ...config };
    }

    get inert(): boolean {
        return !this.config.enabled || !this.config.preferParticipantWhenNeeded;
    }

    /** Is the "hold it until a legal bearer can use it" play gate active? */
    get gatesPlayOnBearer(): boolean {
        return this.config.enabled && this.config.requireUsableBearer;
    }

    // `enabled: false` is documented as "V1 exactly", so every gate in this
    // class hangs off it — a spec that reverts the lever must not still be
    // seeing one of its rules. (`gatesPlayOnBearer` already did.)

    /** Is the "the rules must let this bearer join that conflict" gate active? */
    get gatesBearerParticipation(): boolean {
        return this.config.enabled && this.config.requireParticipableBearer;
    }

    /** Is the "hold it until some bearer can use it" play gate active? */
    get holdsUntilBearerCanUseIt(): boolean {
        return this.config.enabled && this.config.holdUntilBearerCanUseIt;
    }

    /**
     * Can this body still get VALUE out of a stat attachment before the round
     * ends?
     *
     * PARTICIPATING is asked FIRST, because a whole class of attachment is
     * written against `isParticipating()` — which is bow-agnostic — rather than
     * against the skill total. Blade of 10,000 Battles pays after the bearer
     * WINS a conflict and Fan of Command works while the bearer IS
     * PARTICIPATING; neither cares that a bowed body contributes 0 skill
     * (owner, 2026-08-28: "both are okay if toturi is participating in conflict
     * while he is bowed"). `CardPlaybook.bowedParticipantPays` marks those, so
     * the rule reads a declared fact about the card and never guesses from the
     * board.
     *
     * Everything else is a body that is spent:
     *
     *   * PARTICIPATING with a SKILL payoff — the bonus is counted only while
     *     the conflict still needs skill from us; otherwise the body bows on
     *     the way home and the attachment does nothing until next round. A
     *     bowed one needs a ready source, and a body with `DoesNotBow` is the
     *     exception because it comes home standing.
     *   * BOWED AT HOME — it readies in the FATE phase, so it is done for the
     *     round unless a ready source can stand it up right now.
     *   * UNBOWED AT HOME — it can still be declared into, or defend, any
     *     conflict left this round. This is the case that keeps the ordinary
     *     "invest in the tower" play intact.
     */
    bearerCanUseAttachment(input: UsableBearerInput): boolean {
        // Adorned Barcha: the Action bows a chosen PARTICIPATING enemy and the
        // bearer's own movement rides along. Owner, 2026-08-28: "the bowing is
        // not dependent on the movement" — it fires even when the bearer cannot
        // move at all (Pacifism, a dash military skill). Nothing about the
        // bearer can make this card dead.
        if(input.payoffIgnoresBearerState) {
            return true;
        }
        // Waterfall Tattoo READIES its bearer when a province we control is
        // revealed. A bowed bearer is not a body that cannot use the card, it
        // is the body the card exists for — and `DragonAttachmentTactics` picks
        // exactly that one on purpose.
        if(input.payoffReadiesBearer) {
            return true;
        }
        if(input.participating) {
            if(input.payoffIgnoresBow) {
                return true;
            }
            return input.bowed
                ? input.readySourceAvailable
                : input.conflictNeedsSkill || input.staysReadyAfterConflict;
        }
        // ---- the bearer is at home -----------------------------------------
        // Spyglass draws after the bearer "commits to a conflict OR moves to a
        // conflict". Committing needs it standing; MOVING does not, so a bowed
        // bearer still pays whenever a move source can reach it.
        if(input.payoffOnMoveIn) {
            return !input.bowed || input.moveSourceAvailable;
        }
        // Formal Invitation moves its OWN bearer in, and a bowed body arrives
        // contributing 0 skill — but it is still a live plan if the body can be
        // readied, either before the move or after it (`readyAfterMove`).
        if(input.needsSkillOnArrival) {
            return !input.bowed ||
                input.readySourceAvailable ||
                input.readyAfterMoveAvailable;
        }
        if(input.bowed) {
            return input.readySourceAvailable;
        }
        return input.conflictOpportunityRemains;
    }

    /** Does this card want a bearer at home, whatever the conflict needs? */
    wantsHomeBearer(cardId: string | undefined): boolean {
        return HOME_BEARER_ATTACHMENT_IDS.has(String(cardId || ''));
    }

    /** Does this home-bearer card still need that bearer to be unbowed? */
    wantsReadyHomeBearer(cardId: string | undefined): boolean {
        return HOME_BEARER_NEEDS_READY_IDS.has(String(cardId || ''));
    }

    /**
     * Should the attachment go on an unbowed PARTICIPANT rather than on the
     * durable tower at home? `losing` alone is V1's answer and is always
     * honoured, so turning the lever off can only ever restore V1.
     */
    preferParticipant(input: AttachmentTargetInput): boolean {
        if(input.losing) {
            return true;
        }
        if(this.inert) {
            return false;
        }
        const needed = input.skillNeeded;
        if(needed === null || !Number.isFinite(needed) || needed <= 0) {
            return false;
        }
        return this.config.maxSkillNeeded <= 0 || needed <= this.config.maxSkillNeeded;
    }
}
