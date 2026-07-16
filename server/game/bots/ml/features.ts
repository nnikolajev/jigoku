// Feature extraction for the seed-4 learned evaluator.
//
// Shipped (not tooling) so the exact same code produces the features the
// harness logs for training AND the features seed-4 scores at inference — no
// drift between the two. Everything is a fixed-order named numeric vector.
//
// Input is the serialized player-perspective state (`game.getState(meName)`),
// the same view the heuristic policy and the LLM planner already consume, so
// features never leak hidden opponent information.

export interface FeatureVector {
    schema: string[];
    values: number[];
}

export interface OptionInput {
    command: string;
    args: any[];
    target?: string;
    label?: string;
}

const PROVINCE_KEYS = ['one', 'two', 'three', 'four'];

function num(value: any, fallback = 0): number {
    const n = typeof value === 'number' ? value : parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

function characters(player: any): any[] {
    return (player?.cardPiles?.cardsInPlay || []).filter((card: any) => card && card.type === 'character');
}

function skill(card: any, type: 'military' | 'political'): number {
    const summary = type === 'military' ? card?.militarySkillSummary : card?.politicalSkillSummary;
    return Math.max(num(summary?.stat, 0), 0);
}

function provinceList(player: any): any[] {
    const lists = PROVINCE_KEYS.map((key) => player?.provinces?.[key] || []).concat([player?.strongholdProvince || []]);
    const out: any[] = [];
    for(const list of lists) {
        for(const province of (list || [])) {
            if(province) {
                out.push(province);
            }
        }
    }
    return out;
}

function opponentOf(state: any, meName: string): any {
    const players = state?.players || {};
    const oppName = Object.keys(players).find((name) => name !== meName);
    return oppName ? players[oppName] : null;
}

function boardSummary(player: any) {
    const chars = characters(player);
    let mil = 0, pol = 0, ready = 0, fateOnBoard = 0, inConflict = 0;
    for(const card of chars) {
        mil += skill(card, 'military');
        pol += skill(card, 'political');
        fateOnBoard += num(card.fate, 0);
        if(!card.bowed) {
            ready++;
        }
        if(card.inConflict) {
            inConflict++;
        }
    }
    const provinces = provinceList(player);
    const unbroken = provinces.filter((p) => p.isProvince && !p.isBroken && p.type !== 'stronghold').length;
    const strongholdBroken = provinces.some((p) => p.type === 'stronghold' && p.isBroken) ? 1 : 0;
    return {
        count: chars.length, mil, pol, ready, fateOnBoard, inConflict,
        hand: num(player?.cardPiles?.hand?.length, 0),
        honor: num(player?.stats?.honor, 0),
        fate: num(player?.stats?.fate, 0),
        provincesUnbroken: unbroken,
        strongholdBroken
    };
}

// ---- State features (position, acting-player perspective) ----

const STATE_SCHEMA = [
    'round', 'isConflictPhase', 'isDynastyPhase',
    'myHonor', 'oppHonor', 'honorDiff',
    'myFate', 'oppFate', 'fateDiff',
    'myHand', 'oppHand', 'handDiff',
    'myChars', 'oppChars', 'charDiff',
    'myReady', 'oppReady',
    'myMil', 'oppMil', 'milDiff',
    'myPol', 'oppPol', 'polDiff',
    'myFateOnBoard', 'oppFateOnBoard',
    'myProvUnbroken', 'oppProvUnbroken', 'provDiff',
    'myStrongholdBroken', 'oppStrongholdBroken',
    'conflictActive', 'conflictIsMilitary', 'amAttacker',
    'attackerSkill', 'defenderSkill', 'conflictSkillGap',
    'ringFateAvailable', 'myCharsInConflict', 'oppCharsInConflict'
];

export function stateFeatures(state: any, meName: string, roundNumber = 0): FeatureVector {
    const me = state?.players?.[meName];
    const opp = opponentOf(state, meName);
    const mine = boardSummary(me);
    const theirs = boardSummary(opp);

    const conflict = state?.conflict;
    const conflictActive = conflict && conflict.type ? 1 : 0;
    const amAttacker = conflictActive && conflict.attackingPlayerId === me?.id ? 1 : 0;
    const attackerSkill = num(conflict?.attackerSkill, 0);
    const defenderSkill = num(conflict?.defenderSkill, 0);
    const phase = String(me?.phase || '');

    const ringFate = Object.values(state?.rings || {}).reduce((total: number, ring: any) => total + num(ring?.fate, 0), 0);

    const values = [
        Math.min(num(roundNumber, 0), 20),
        phase === 'conflict' ? 1 : 0,
        phase === 'dynasty' ? 1 : 0,
        mine.honor, theirs.honor, mine.honor - theirs.honor,
        mine.fate, theirs.fate, mine.fate - theirs.fate,
        mine.hand, theirs.hand, mine.hand - theirs.hand,
        mine.count, theirs.count, mine.count - theirs.count,
        mine.ready, theirs.ready,
        mine.mil, theirs.mil, mine.mil - theirs.mil,
        mine.pol, theirs.pol, mine.pol - theirs.pol,
        mine.fateOnBoard, theirs.fateOnBoard,
        mine.provincesUnbroken, theirs.provincesUnbroken, mine.provincesUnbroken - theirs.provincesUnbroken,
        mine.strongholdBroken, theirs.strongholdBroken,
        conflictActive, conflictActive && conflict.type === 'military' ? 1 : 0, amAttacker,
        attackerSkill, defenderSkill, attackerSkill - defenderSkill,
        ringFate, mine.inConflict, theirs.inConflict
    ];
    return { schema: STATE_SCHEMA, values };
}

// ---- Option features (what a candidate move is/does) ----

const OPTION_SCHEMA = [
    'isButton', 'isCardClick', 'isRingClick', 'isFacedownClick',
    'isPass', 'isDone', 'isInitiate',
    'targetMine', 'targetOpponent',
    'targetMilitary', 'targetPolitical', 'targetCost', 'targetFate',
    'targetBowed', 'targetInConflict', 'targetIsCharacter', 'targetIsProvince',
    'targetIsOppProvince', 'ringFate'
];

function findCardByUuid(state: any, uuid: string): { card: any; mine: boolean } | null {
    const players = state?.players || {};
    const meName = state.__meName || '';
    for(const name of Object.keys(players)) {
        const player = players[name];
        const mine = name === meName;
        const piles = player?.cardPiles || {};
        for(const key of Object.keys(piles)) {
            for(const card of (piles[key] || [])) {
                if(card?.uuid === uuid) {
                    return { card, mine };
                }
            }
        }
        for(const province of provinceList(player)) {
            if(province?.uuid === uuid) {
                return { card: province, mine };
            }
        }
    }
    return null;
}

export function optionFeatures(state: any, meName: string, option: OptionInput): FeatureVector {
    const label = String(option.label || '').toLowerCase();
    const command = option.command;
    const tagged = Object.assign({ __meName: meName }, state);

    let targetMine = 0, targetOpp = 0, targetMil = 0, targetPol = 0, targetCost = 0, targetFate = 0;
    let targetBowed = 0, targetInConflict = 0, targetIsChar = 0, targetIsProvince = 0, targetIsOppProvince = 0, ringFate = 0;

    if((command === 'cardClicked' || command === 'facedownCardClicked') && option.args?.[0]) {
        const found = findCardByUuid(tagged, option.args[0]);
        if(found) {
            const c = found.card;
            targetMine = found.mine ? 1 : 0;
            targetOpp = found.mine ? 0 : 1;
            targetMil = skill(c, 'military');
            targetPol = skill(c, 'political');
            targetCost = num(c.cost, 0);
            targetFate = num(c.fate, 0);
            targetBowed = c.bowed ? 1 : 0;
            targetInConflict = c.inConflict ? 1 : 0;
            targetIsChar = c.type === 'character' ? 1 : 0;
            targetIsProvince = c.isProvince || c.type === 'province' || c.type === 'stronghold' ? 1 : 0;
            targetIsOppProvince = targetIsProvince && !found.mine ? 1 : 0;
        } else {
            // Facedown/opponent province with no visible card object: infer side
            // from the label the enumerator attached.
            targetIsProvince = label.includes('province') ? 1 : 0;
            targetIsOppProvince = label.includes('opponent province') || label.includes('facedown province') ? 1 : 0;
            targetOpp = targetIsOppProvince;
        }
    } else if(command === 'ringClicked') {
        const ring = state?.rings?.[option.args?.[0]];
        ringFate = num(ring?.fate, 0);
    }

    const values = [
        command === 'menuButton' ? 1 : 0,
        command === 'cardClicked' ? 1 : 0,
        command === 'ringClicked' ? 1 : 0,
        command === 'facedownCardClicked' ? 1 : 0,
        label.includes('pass') ? 1 : 0,
        label.includes('done') ? 1 : 0,
        label.includes('initiate') ? 1 : 0,
        targetMine, targetOpp,
        targetMil, targetPol, targetCost, targetFate,
        targetBowed, targetInConflict, targetIsChar, targetIsProvince,
        targetIsOppProvince, ringFate
    ];
    return { schema: OPTION_SCHEMA, values };
}

export const STATE_FEATURE_SCHEMA = STATE_SCHEMA;
export const OPTION_FEATURE_SCHEMA = OPTION_SCHEMA;
