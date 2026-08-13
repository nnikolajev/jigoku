import { BotTelemetry } from './BotTelemetry.js';

/**
 * The free-conflict window: play a body from hand so a conflict opportunity
 * that would otherwise be PASSED becomes an unopposed attack.
 *
 * ## What this exists to model
 *
 * From the project owner's replays (`docs/bot-conflict-rules-from-replays.md`,
 * rules 2 and 6), simplified to the one shape that is cheap to detect:
 *
 * > If a conflict is still available, all enemy characters are bowed, and there
 * > is a character in hand I can play, play it and declare a new conflict.
 *
 * His Crane R4 line is the canonical case: he attacked the stronghold with
 * everything and lost 17-18, then played a fresh Feral Ningyo at home and broke
 * the province with 4 skill, unopposed. The body that won the game was not on
 * the board when the first conflict was declared.
 *
 * V1 cannot see this. `estimateHandThreat` prices a hand as one skill lump
 * added to the CURRENT conflict, so a body that would only matter at the NEXT
 * declaration is worth zero, and a phase with no ready attacker simply passes.
 *
 * ## The window is BEFORE the conflict, not during it
 *
 * `ConflictPhase.queueSteps` runs `ActionWindow(..., 'preConflict')` and only
 * then `startConflictChoice()`, looping back to a fresh action window after
 * every conflict (`ConflictPhase.ts:43,67`). A character played inside a running
 * conflict joins THAT conflict; the play has to happen in the preConflict window
 * so the body is standing at home, ready, when the declaration prompt arrives.
 * That window is the bot's `actionWindowDecision` (`Initiate an action`), which
 * is where this policy is consulted.
 *
 * ## Reproducing V1
 *
 * `enabled: false` (the default) returns `play: null` unconditionally. Every
 * knob is additive and off at its default, so an arm is a JSON string.
 */
export interface UnopposedWindowConfig {
    /** Master switch. False = V1 exactly, whatever the other knobs say. */
    enabled: boolean;
    /**
     * Enemy READY characters we tolerate and still call the attack unopposed.
     * 0 is the owner's rule ("all enemy characters are bowed"); an empty enemy
     * board satisfies it too. Above 0 this stops being a free conflict and
     * becomes an ordinary attack the declaration logic already sizes.
     */
    maxOpponentReady: number;
    /**
     * Our own ready bodies at which the window still opens. 0 means "fire only
     * when we would otherwise pass for lack of an attacker", which is the
     * conservative reading and self-limiting: after the play we have one.
     * Raising it buys extra skill for the BREAK — an unopposed conflict is won
     * by any skill at all, but the province still needs its strength covered.
     */
    maxOwnReadyAttackers: number;
    /**
     * The body must carry at least this much skill on an axis we can still
     * declare on. A 0-skill attacker does not win an unopposed conflict: the
     * attacker needs MORE skill than the defender, and both would be at 0.
     */
    minBodySkill: number;
    /** Ignore bodies costing more than this. */
    maxBodyCost: number;
    /** Fate to keep after paying for the body. */
    fateReserve: number;
    /**
     * Plays this rule may make per round. At `maxOwnReadyAttackers: 0` the gate
     * already stops itself after one; this only binds once that is raised.
     */
    maxPlaysPerRound: number;
    /**
     * Play the chosen card as a CHARACTER even for decks whose profile prefers
     * dual-mode cards as attachments (Dragon's monks: Ancient Master, Tattooed
     * Wanderer, Togashi Acolyte). An attachment cannot declare a conflict, so
     * inside this window the attachment plan is the wrong plan.
     */
    overrideAttachmentPlans: boolean;
}

export const DEFAULT_UNOPPOSED_WINDOW: UnopposedWindowConfig = {
    enabled: false,
    maxOpponentReady: 0,
    maxOwnReadyAttackers: 0,
    minBodySkill: 1,
    maxBodyCost: 99,
    fateReserve: 0,
    maxPlaysPerRound: 1,
    overrideAttachmentPlans: true
};

export interface UnopposedWindowCandidate {
    uuid: string;
    id: string;
    military: number;
    political: number;
    cost: number;
}

export interface UnopposedWindowInput {
    /** Conflict opportunities we may still declare this round. */
    myConflictsRemaining: number;
    /** Military conflicts left to us, or undefined when the engine omits it. */
    militaryRemaining?: number;
    politicalRemaining?: number;
    /** Their ready characters. Public information. */
    opponentReady: number;
    /** Their whole board, ready or not — reported for telemetry only. */
    opponentInPlay: number;
    /** Our ready characters, i.e. the attackers we already have. */
    myReady: number;
    availableFate: number;
    /** Plays this rule has already made this round. */
    playsThisRound: number;
    /** Playable character cards in hand, already filtered for engine legality. */
    candidates: UnopposedWindowCandidate[];
}

export interface UnopposedWindowResult {
    play: UnopposedWindowCandidate | null;
    /** Skill the chosen body brings on the best axis still available to us. */
    skill: number;
    reason: string;
}

export class UnopposedWindowPolicy {
    private readonly config: UnopposedWindowConfig;

    public constructor(config?: Partial<UnopposedWindowConfig>) {
        this.config = Object.assign({}, DEFAULT_UNOPPOSED_WINDOW, config || {});
    }

    public get settings(): UnopposedWindowConfig {
        return this.config;
    }

    public read(input: UnopposedWindowInput): UnopposedWindowResult {
        const miss = (reason: string): UnopposedWindowResult =>
            ({ play: null, skill: 0, reason });

        if(!this.config.enabled) {
            return miss('unopposed-off');
        }
        if((Number(input.myConflictsRemaining) || 0) < 1) {
            return miss('no-conflict-opportunity');
        }
        if(input.playsThisRound >= this.config.maxPlaysPerRound) {
            return miss('play-cap-reached');
        }
        if((Number(input.opponentReady) || 0) > this.config.maxOpponentReady) {
            return miss('defenders-ready');
        }
        if((Number(input.myReady) || 0) > this.config.maxOwnReadyAttackers) {
            return miss('attacker-available');
        }

        // Skill on an axis we cannot declare on buys nothing. `undefined` means
        // the engine did not publish the split, so both axes stay open.
        const militaryOpen = input.militaryRemaining === undefined || input.militaryRemaining > 0;
        const politicalOpen = input.politicalRemaining === undefined || input.politicalRemaining > 0;

        const budget = Math.max(0, Number(input.availableFate) || 0) - this.config.fateReserve;
        const scored = (input.candidates || [])
            .map((card) => ({ card, skill: this.usefulSkill(card, militaryOpen, politicalOpen) }))
            .filter((entry) => entry.skill >= this.config.minBodySkill &&
                entry.card.cost <= this.config.maxBodyCost &&
                entry.card.cost <= budget)
            // Most skill first: the province still has to be covered for the
            // break. Cheapest, then uuid, so the choice is deterministic.
            .sort((a, b) => b.skill - a.skill ||
                a.card.cost - b.card.cost ||
                String(a.card.uuid).localeCompare(String(b.card.uuid)));

        if(scored.length === 0) {
            return miss((input.candidates || []).length === 0 ? 'no-candidate' : 'no-affordable-body');
        }
        return { play: scored[0].card, skill: scored[0].skill, reason: 'unopposed-play' };
    }

    private usefulSkill(card: UnopposedWindowCandidate, militaryOpen: boolean, politicalOpen: boolean): number {
        return Math.max(
            militaryOpen ? Math.max(0, Number(card.military) || 0) : 0,
            politicalOpen ? Math.max(0, Number(card.political) || 0) : 0
        );
    }
}

/**
 * Record one look at the window. Kept out of the class so `read` stays a pure
 * function a spec can call without a telemetry sink. Emitted on every OPEN
 * window, not only on a play, so the probe can measure how often the situation
 * arises at all — the owner's own expectation was "not very often".
 */
export function recordUnopposedWindow(
    input: UnopposedWindowInput,
    result: UnopposedWindowResult,
    context: { seat?: string; round?: number }
): void {
    if(!BotTelemetry.enabled) {
        return;
    }
    BotTelemetry.record('unopposed-window', () => ({
        seat: context.seat,
        round: context.round,
        myConflictsRemaining: input.myConflictsRemaining,
        opponentReady: input.opponentReady,
        opponentInPlay: input.opponentInPlay,
        myReady: input.myReady,
        availableFate: input.availableFate,
        candidates: (input.candidates || []).length,
        playsThisRound: input.playsThisRound,
        playedId: result.play ? result.play.id : null,
        playedCost: result.play ? result.play.cost : -1,
        skill: result.skill,
        reason: result.reason,
        // The whole point of the lever: a window where the bot had no attacker,
        // a conflict to spend and a body in hand it never considered playing.
        divergent: !!result.play
    }));
}
