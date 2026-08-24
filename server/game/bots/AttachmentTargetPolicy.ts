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
}

export const DEFAULT_ATTACHMENT_TARGET: AttachmentTargetConfig = {
    // Default false is V1 exactly, so the lever is an A/B arm
    // (`{"attachmentTarget":{"enabled":true}}`) before it is a default.
    enabled: false,
    preferParticipantWhenNeeded: true,
    maxSkillNeeded: 6,
    requireUsableBearer: true
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
