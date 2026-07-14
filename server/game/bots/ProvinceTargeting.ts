const OUTER_PROVINCE_KEYS = ['one', 'two', 'three', 'four'];

export const BROKEN_PROVINCES_TO_ATTACK_STRONGHOLD = 3;

function outerProvinceLists(player: any): any[][] {
    return OUTER_PROVINCE_KEYS.map((key) => player?.provinces?.[key] || []);
}

function isProvinceCard(card: any): boolean {
    return !!card && card.isProvince !== false &&
        (card.isProvince || card.type === 'province' || card.facedown);
}

export function brokenOuterProvinceCount(player: any): number {
    return outerProvinceLists(player).filter((list) =>
        (list || []).some((card: any) => isProvinceCard(card) && card.isBroken)).length;
}

export function mustAttackStronghold(player: any): boolean {
    if(brokenOuterProvinceCount(player) < BROKEN_PROVINCES_TO_ATTACK_STRONGHOLD) {
        return false;
    }

    return (player?.strongholdProvince || []).some((card: any) =>
        isProvinceCard(card) && !card.isBroken && card.type !== 'stronghold');
}

// Legal conquest progression is shared by every bot brain: attack outer
// provinces until three break, then ignore the fourth outer province and attack
// only the stronghold province. Breaking that province wins the game.
// Paired deterministic A/B, Scorpion vs Crane seed 1, N=400 (2026-07-14):
// current rule 78.75% Scorpion; legacy Scorpion behavior only 78.5%; legacy
// Crane targeting only 91.75%; legacy Crane commitment only 79.75%. The drop
// came from Crane no longer wasting a conflict on the fourth province, not from
// Scorpion harming itself. Do not add a Scorpion exception.
export function attackProvinceLists(player: any): any[][] {
    return mustAttackStronghold(player)
        ? [player?.strongholdProvince || []]
        : outerProvinceLists(player);
}

export function strongholdProvinceUnderAttack(player: any): boolean {
    return (player?.strongholdProvince || []).some((card: any) =>
        isProvinceCard(card) && card.inConflict && !card.isBroken && card.type !== 'stronghold');
}
