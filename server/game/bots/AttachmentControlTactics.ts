// Shared, injectable attachment-control policy. Let Go should remove whichever
// card matters more: a debilitating attachment on our persistent character or
// a high-value attachment on the opponent's tower.
export interface AttachmentControlProfile {
    ownDebuffScores: Record<string, number>;
    enemyAttachmentScores: Record<string, number>;
    carrierFateWeight: number;
    carrierSkillWeight: number;
    // Ordered removal sources for the urgency rule, cheapest first. A debuff on
    // our own board (Pacifism, Stolen Breath) shuts a body out of a whole
    // conflict type for as long as it sits there, and the answer belongs in the
    // action window it lands in -- not two conflicts later. Let Go is a free
    // hand card; Miya Mystic pays with the body, so it goes second.
    debuffRemovalSourceIds: readonly string[];
    // A debilitating attachment on THEIR character is working for us. Removing
    // it hands them the body back, which is the exact opposite of what Let Go
    // and Miya Mystic are for. On, an attachment listed in `ownDebuffScores` is
    // never a removal target while an OPPONENT controls the carrier.
    //
    // It was reachable: `attachmentWorth` prices an unknown enemy attachment at
    // `6 + granted skill`, a debuff grants none, and the carrier weighting then
    // lifts a Pacifism on a fat enemy body (5 fate, 8 skill -> 20) above the
    // same Pacifism on one of ours (18 + our carrier). `false` restores that.
    removeOwnDebuffsOnly: boolean;
}

export const ATTACHMENT_CONTROL_DEFAULTS: AttachmentControlProfile = {
    ownDebuffScores: {
        'pacifism': 18,
        'stolen-breath': 18,
        'softskin': 14,
        'pit-trap': 16,
        'cloud-the-mind': 13,
        'fiery-madness': 11
    },
    enemyAttachmentScores: {
        'tetsubo-of-blood': 20,
        'jade-tetsubo': 16,
        'way-of-the-dragon': 18,
        'watch-commander': 15,
        'shukujo': 16,
        'duelist-training': 14,
        'above-question': 13,
        'finger-of-jade': 13
    },
    carrierFateWeight: 2,
    carrierSkillWeight: 0.5,
    debuffRemovalSourceIds: ['let-go', 'miya-mystic'],
    removeOwnDebuffsOnly: true
};

export function isNegativeAttachmentId(id: string | undefined): boolean {
    return !!id && Object.prototype.hasOwnProperty.call(ATTACHMENT_CONTROL_DEFAULTS.ownDebuffScores, id);
}

// What one attachment is WORTH to whoever controls it: a known id's score, else
// a floor plus whatever skill it is currently granting. This is the scale Let Go
// ranks enemy attachments on, and Frostbitten Crossing prices OUR OWN
// attachments with the same function — a province that discards every
// attachment on the chosen body has to compare "a debuff we shed" against "the
// buffs we throw away with it" on one scale, or the comparison is meaningless.
export function attachmentWorth(attachment: any, enemyAttachmentScores: Record<string, number>): number {
    const known = enemyAttachmentScores[attachment?.id];
    if(typeof known === 'number' && Number.isFinite(known)) {
        return known;
    }
    const liveStats = Math.max(0,
        Number(attachment?.militarySkillSummary?.stat) || 0,
        Number(attachment?.politicalSkillSummary?.stat) || 0);
    return 6 + liveStats;
}

export class AttachmentControlTactics {
    constructor(private profile: AttachmentControlProfile) {}

    pickTarget(mine: any[], theirs: any[], skillOf: (card: any) => number): any | null {
        const carrierScore = (card: any) =>
            (Number(card.fate) || 0) * this.profile.carrierFateWeight +
            Math.max(0, skillOf(card)) * this.profile.carrierSkillWeight;
        const candidates: Array<{ attachment: any; score: number }> = [];
        for(const carrier of mine) {
            for(const attachment of carrier.attachments || []) {
                const base = this.profile.ownDebuffScores[attachment.id];
                if(base !== undefined) {
                    candidates.push({ attachment, score: base + carrierScore(carrier) });
                }
            }
        }
        for(const carrier of theirs) {
            for(const attachment of carrier.attachments || []) {
                // Never take a debuff off one of THEIR characters.
                if(this.profile.removeOwnDebuffsOnly && isNegativeAttachmentId(attachment?.id)) {
                    continue;
                }
                const base = attachmentWorth(attachment, this.profile.enemyAttachmentScores);
                candidates.push({ attachment, score: base + carrierScore(carrier) });
            }
        }
        return candidates.sort((a, b) => b.score - a.score ||
            String(a.attachment.uuid).localeCompare(String(b.attachment.uuid)))[0]?.attachment || null;
    }
}
