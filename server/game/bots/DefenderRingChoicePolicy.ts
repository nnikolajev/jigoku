// THE DEFENDER CHOOSES THE ELEMENT.
//
// `Togashi Tadakatsu` (and any future `chooseConflictRing` restriction) moves
// the element choice from the attacker to the DEFENDER, before the conflict
// type, the attackers and the attacked province are chosen
// (`conflictflow.ts:defenderChoosesRing`).
//
// That is a hand-the-opponent-a-ring prompt, and V1 answered it with the ring
// ranking it uses when IT is attacking — i.e. it handed the attacker the ring
// it would most like to have. Seen live (2026-08-23, Phoenix vs Dragon, round 5
// conflict 1): the bot gave away the void ring carrying 2 fate, which the
// attacker banks at declaration.
//
// The right answer is the ranking the ATTACKER would use, reversed: score every
// legal ring from their side of the table and hand over the one at the bottom.
// That is also why the fate pile is handled for free — the attacker takes the
// ring's fate when the conflict is declared, and an attacker-perspective score
// already prices a fate pile as the dominant term.
//
// Only the ATTACKER resolves a ring effect (the defender winning claims the
// ring but resolves nothing), so scoring the effect from their side is exactly
// the right side to score it from.
//
// This is generic: nothing here is Dragon-specific, and the prompt only ever
// appears because the OPPONENT has Tadakatsu in play, so every deck needs it.

export interface DefenderRingChoiceConfig {
    // False reproduces the pre-2026-08-23 behaviour: the defender answers with
    // its own attacking preference (highest own score first).
    enabled: boolean;
    // Break ties between equally-valued rings by handing over the one carrying
    // the least fate. The attacker banks that fate at declaration.
    preferLowFate: boolean;
}

export const DEFAULT_DEFENDER_RING_CHOICE: DefenderRingChoiceConfig = {
    enabled: true,
    preferLowFate: true
};

export interface DefenderRingChoiceInput {
    // Rings the prompt will actually accept.
    rings: readonly any[];
    // Ring value from the ATTACKER's side of the table.
    scoreForAttacker: (ring: any) => number;
    // Ring value from OUR side, used only by the disabled/legacy arm.
    scoreForSelf: (ring: any) => number;
    // Deterministic element order, used as the final tie-break so the choice is
    // reproducible across runs.
    elementOrder: readonly string[];
}

export interface DefenderRingChoiceResult {
    ring: any;
    reason: string;
    /** Every candidate in the order the policy ranked them, worst-for-the-
     *  attacker first. Exposed for telemetry and tests. */
    ordered: any[];
}

export class DefenderRingChoicePolicy {
    readonly config: DefenderRingChoiceConfig;

    constructor(config: Partial<DefenderRingChoiceConfig> = {}) {
        this.config = { ...DEFAULT_DEFENDER_RING_CHOICE, ...config };
    }

    choose(input: DefenderRingChoiceInput): DefenderRingChoiceResult | null {
        const rings = (input.rings || []).filter(Boolean);
        if(rings.length === 0) {
            return null;
        }
        const orderIndex = (ring: any) => {
            const index = (input.elementOrder || []).indexOf(String(ring?.element || ''));
            return index < 0 ? (input.elementOrder || []).length : index;
        };
        if(!this.config.enabled) {
            const ordered = rings.slice().sort((a: any, b: any) => {
                const diff = input.scoreForSelf(b) - input.scoreForSelf(a);
                return diff !== 0 ? diff : orderIndex(a) - orderIndex(b);
            });
            return { ring: ordered[0], reason: 'defender-ring-legacy-own-preference', ordered };
        }
        const ordered = rings.slice().sort((a: any, b: any) => {
            const diff = input.scoreForAttacker(a) - input.scoreForAttacker(b);
            if(diff !== 0) {
                return diff;
            }
            if(this.config.preferLowFate) {
                const fateDiff = (Number(a?.fate) || 0) - (Number(b?.fate) || 0);
                if(fateDiff !== 0) {
                    return fateDiff;
                }
            }
            return orderIndex(a) - orderIndex(b);
        });
        return { ring: ordered[0], reason: 'defender-ring-worst-for-attacker', ordered };
    }
}
