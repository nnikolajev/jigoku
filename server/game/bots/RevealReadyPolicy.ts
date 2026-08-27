// A BODY THE OPPONENT'S OWN ATTACK WILL READY IS NOT A BODY YOU MUST KEEP HOME.
//
// Every defense-preservation rule in this bot — `StrongholdDefenseTactics`'s
// reserve, the generic `attackKeepHome` sizing — asks the same question: if I
// send this body, will it still be standing when the opponent declares? The
// answer is normally no, and that is why one body stays back.
//
// Waterfall Tattoo inverts it. Its printed reaction is "After a province you
// control is revealed - ready attached character", and a facedown province of
// ours is revealed by the opponent DECLARING A CONFLICT AT IT
// (`conflictflow.ts` reveals the province before defenders are declared). So
// while we still hold a facedown province, a tattooed body that attacks is
// readied by the very attack it was being kept home for, and it defends that
// same conflict. Attacking with it is free.
//
// The policy is generic: it takes a board reading and a list of attachment ids
// whose reaction readies their bearer on an own-province reveal. It says
// nothing about Dragon, and a deck without such an attachment gets an empty
// answer, which is V1 exactly.

export interface RevealReadyConfig {
    // False reproduces V1 exactly — no body is ever treated as free.
    enabled: boolean;
    // Attachment ids whose reaction readies the attached character after a
    // province its controller owns is revealed.
    attachmentIds: string[];
    // Require EVERY unbroken province we could be attacked at to be facedown
    // before treating a bearer as free. True is the guaranteed reading (the
    // opponent has no faceup province to attack instead, so the reveal — and
    // the ready — is certain). False is the owner's reading: one facedown
    // province is enough, because the opponent usually attacks the cheapest
    // target and the tattoo is being bought for exactly this tempo.
    requireAllProvincesFacedown: boolean;
}

export const DEFAULT_REVEAL_READY: RevealReadyConfig = {
    enabled: false,
    attachmentIds: [],
    requireAllProvincesFacedown: false
};

export interface RevealReadyProvinces {
    // Unbroken provinces we control that are still FACEDOWN. Attacking one
    // reveals it.
    facedown: number;
    // Unbroken provinces we control that are already FACEUP. Attacking one
    // reveals nothing, so the tattoo does not fire.
    faceup: number;
}

export interface RevealReadyInput {
    // Our characters in play, each with `uuid` and an `attachments` list.
    myCharacters: any[];
    // Every unbroken province we control, split by whether it is still hidden.
    // For the STRONGHOLD planner, pass only the stronghold province: that is
    // the province the reserve exists to defend, so its own facedown state is
    // the exact question.
    provinces: RevealReadyProvinces;
}

/**
 * Which of our bodies come back ready when the opponent declares?
 */
export class RevealReadyPolicy {
    private config: RevealReadyConfig;

    constructor(config: Partial<RevealReadyConfig> = {}) {
        this.config = { ...DEFAULT_REVEAL_READY, ...config };
    }

    /** True when this policy can never answer anything (V1). */
    get inert(): boolean {
        return !this.config.enabled || (this.config.attachmentIds || []).length === 0;
    }

    /** Does this attachment ready its bearer after one of our provinces is revealed? */
    isRevealReadyAttachment(cardId: string | undefined): boolean {
        return !!cardId && (this.config.attachmentIds || []).includes(cardId);
    }

    /** Does this body carry one? */
    carriesRevealReady(card: any): boolean {
        return (card?.attachments || []).some((attachment: any) =>
            this.isRevealReadyAttachment(attachment?.id));
    }

    /**
     * Is a reveal still available at all? No facedown province means nothing
     * can be revealed, so no bearer is free.
     */
    revealAvailable(provinces: RevealReadyProvinces | undefined): boolean {
        const facedown = Math.max(0, Number(provinces?.facedown) || 0);
        if(facedown <= 0) {
            return false;
        }
        return !this.config.requireAllProvincesFacedown ||
            Math.max(0, Number(provinces?.faceup) || 0) === 0;
    }

    /**
     * The uuids of bodies that may attack without giving up their defense.
     * Empty whenever the policy is inert or no reveal is available.
     */
    freeAttackerUuids(input: RevealReadyInput): string[] {
        if(this.inert || !this.revealAvailable(input?.provinces)) {
            return [];
        }
        return (input?.myCharacters || [])
            .filter((card: any) => card?.uuid && this.carriesRevealReady(card))
            .map((card: any) => String(card.uuid));
    }

    /**
     * How many extra bodies the attack may commit beyond its normal cap,
     * because that many defenders return by themselves. Callers cap this at
     * the number of bodies actually eligible to attack.
     */
    freeAttackerCount(input: RevealReadyInput): number {
        return this.freeAttackerUuids(input).length;
    }
}
