// Shared, injectable attachment-control policy. Let Go should remove whichever
// card matters more: a debilitating attachment on our persistent character or
// a high-value attachment on the opponent's tower.
export interface AttachmentControlProfile {
    ownDebuffScores: Record<string, number>;
    enemyAttachmentScores: Record<string, number>;
    carrierFateWeight: number;
    carrierSkillWeight: number;
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
    carrierSkillWeight: 0.5
};

export function isNegativeAttachmentId(id: string | undefined): boolean {
    return !!id && Object.prototype.hasOwnProperty.call(ATTACHMENT_CONTROL_DEFAULTS.ownDebuffScores, id);
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
                const liveStats = Math.max(0,
                    Number(attachment.militarySkillSummary?.stat) || 0,
                    Number(attachment.politicalSkillSummary?.stat) || 0);
                const base = this.profile.enemyAttachmentScores[attachment.id] ?? (6 + liveStats);
                candidates.push({ attachment, score: base + carrierScore(carrier) });
            }
        }
        return candidates.sort((a, b) => b.score - a.score ||
            String(a.attachment.uuid).localeCompare(String(b.attachment.uuid)))[0]?.attachment || null;
    }
}
