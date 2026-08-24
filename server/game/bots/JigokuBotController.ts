/**
 * Drives a bot seat: turns engine prompts into commands, and stops the bot
 * getting stuck.
 *
 * The policy is pure — state in, one click out. Everything awkward about
 * living inside a real game lives here instead:
 *
 * - **The tick loop.** One `tick` answers up to `maxDecisionsPerTick` prompts,
 *   because a dynasty phase or a conflict resolution is a long solo chain. If
 *   the budget runs out mid-chain nothing else would re-tick the seat, so the
 *   controller schedules its own follow-up.
 * - **Extra state the serialised player state does not carry.** Printed costs,
 *   target hints (which game actions the current prompt will resolve, so the
 *   policy can aim them), holding strengths, base skills. These are read off
 *   live card objects and passed down in the decide context.
 * - **Rejected commands.** An illegal click is recorded and the loop continues
 *   for card clicks (the policy remembers what it attempted and proposes
 *   something else) but breaks for buttons, which would repeat verbatim.
 * - **Loop-stall protection.** Repeated identical exhaustion signatures trip a
 *   forced-progress valve rather than hanging the game.
 *
 * The engine itself is chosen by `BotEngineRouter`; this class only knows the
 * `BotEngine` interface.
 */
import JigokuBotPolicy from './JigokuBotPolicy.js';
import BotEngineRouter from './BotEngineRouter.js';
import { resolveBotIdentity } from './BotConfiguration.js';
import type { ResolvedBotIdentity } from './BotConfiguration';
import type { BotDecision, BotEngine, MenuCardInfo } from './BotEngine';
import { getPlaybookEntry, deriveDeckStrategy } from './CardPlaybook.js';
import type { DeckStrategy } from './CardPlaybook';
import { resolveDeckProfile } from './DeckProfiles.js';
import { MOVE_SOURCES, READY_SOURCES, moveSourceSpec, readySourceSpec } from './ReadyMovePlanner.js';
import type { SequenceSourceTargets } from './ReadyMovePlanner';
import type { DeckProfile } from './DeckProfiles';
import { applyV2DeckProfile } from './shared/V2DeckProfiles.js';
import type { DuelBidContext } from './DuelBidTactics';
import type { DrawBidContext } from './DrawBidTactics';
import type { DynastyCharacterInfo } from './BoardAwareDynastyTactics';
import type { KnownCard } from './DeckAnalysis';
import type { ConflictAxis, ConflictPlannerCharacter } from './ConflictPhasePlanner';
import type {
    ProvinceKnowledge,
    ProvinceKnowledgeSnapshot
} from './UnicornRevealTactics';
import OmniscientBotCapability from './OmniscientBotCapability.js';
import { logger } from '../../logger.js';
import type Game from '../game';
import type Player from '../player';
import type Ring from '../ring';
import type BaseCard from '../basecard';
import type { JigokuBotConfig } from './JigokuBotConfig';
import { CharacterStatus, EffectNames, EventNames } from '../Constants';
import { PlayAttachmentAction } from '../PlayAttachmentAction.js';

interface BotTraceEntry {
    player: string;
    promptTitle?: string;
    menuTitle?: string;
    command?: string;
    args?: any[];
    target?: string;
    cardId?: string;
    cardType?: string;
    cardSide?: string;
    cardLocation?: string;
    cardController?: string;
    cardOwner?: string;
    engineVersion: 'v1' | 'v2';
    strategySeed: string | number;
    informationMode: 'fair' | 'omniscient';
    deckProfile: string;
    configurationHash: string;
    selectedBy?: 'v1' | 'v2' | 'fallback';
    fallbackReason?: string;
    v2Mode?: string;
    durationMs?: number;
    planner?: unknown;
    seedState: number;
    result: 'success' | 'rejected' | 'unsupported';
    reason: string;
}

type CommandRunner = (command: string, playerName: string, args: any[]) => boolean;

/** A GameObject pile (`_(...)` wrapper) as a plain array; anything else empty. */
function pileArray(pile: { toArray?: () => any[] } | null | undefined): any[] {
    return pile?.toArray ? (pile.toArray() || []) : [];
}

class JigokuBotController {
    readonly trace: BotTraceEntry[] = [];
    // Kept visible for existing diagnostic/test introspection. Router owns
    // command selection; this is always frozen V1 instance used directly or
    // as deterministic V2 fallback.
    readonly policy: JigokuBotPolicy;
    private engine: BotEngine;
    private readonly identity: ResolvedBotIdentity;
    private ticking = false;
    private onStateChange?: () => void;
    private recentExhaustSignatures: string[] = [];
    private consecutiveExhaustions = 0;
    private deckStrategy?: DeckStrategy;
    // Log a misdirected arm once per controller, not once per decision.
    private reportedInapplicableOverrides = false;
    private omniscientCapability: OmniscientBotCapability;
    // Display of Power installs its delayed ring replacement only after its
    // ability-effects event survives interrupts. Remember that success for
    // this conflict so another copy is not spent on the same ring. A canceled
    // event is not emitted, leaving retry available.
    private displayOfPowerActive = false;
    private displayOfPowerConflictUuid: string | null = null;

    constructor(private game: Game, readonly config: JigokuBotConfig, private runCommand: CommandRunner,
        services: {
            onStateChange?: () => void;
            omniscientCapability?: OmniscientBotCapability;
        } = {}) {
        const router = new BotEngineRouter(config);
        this.engine = router;
        this.policy = router.v1.policy;
        this.identity = resolveBotIdentity(config);
        this.omniscientCapability = services.omniscientCapability ||
            new OmniscientBotCapability(game, config.playerName, config.omniscient === true);
        this.onStateChange = services.onStateChange;
        (this.game as any).on?.(EventNames.OnInitiateAbilityEffects, (event: any) =>
            this.recordDisplayOfPowerInitiated(event));
    }

    // Information access is independent from seed-selected strategy.
    private isOmniscient(): boolean {
        return this.omniscientCapability.enabled;
    }

    // Translate one live card the human holds into the model the policy reasons
    // over. Printed skill/cost/flat attachment bonuses come from live card data
    // (exact for any deck); the curated registry supplies what printed data
    // cannot express — chiefly an event's conflict swing and effect tag.
    private knownCard(card: any): KnownCard {
        return this.omniscientCapability.knownCard(card);
    }

    private cardCanDisableDefender(card: any): boolean {
        return this.omniscientCapability.cardCanDisableDefender(card);
    }

    private cardCanBowOpponent(card: any): boolean {
        return this.omniscientCapability.cardCanBowOpponent(card);
    }

    // Visible board information is fair for every seed. Include abilities on
    // the participating defender and its attachments, because either can bow
    // the protected attacker before conflict resolution.
    private opponentParticipantCanBow(me: Player): boolean {
        return this.omniscientCapability.opponentParticipantCanBow(me);
    }

    private liveProvinceStrength(card: any): number {
        const rawStrength = typeof card.getStrength === 'function'
            ? card.getStrength()
            : (card.strength ?? card.printedStrength ?? card.cardData?.strength);
        const strength = Number(rawStrength);
        return Number.isFinite(strength) ? Math.max(strength, 0) : 0;
    }

    private buildOmniscient(me: Player) {
        // `omniscientThreatRealism` decides whether the opponent's hand is
        // priced against their real honor and the bodies actually on the table.
        // Reading the profile here keeps the capability free of deck knowledge.
        return this.omniscientCapability.build(
            me,
            this.decisionProfile(me)?.omniscientThreatRealism === true
        );
    }

    // L5R deck lists are known information. Expose the opponent's complete
    // conflict-deck composition to every seed, independent of the seed-3 hand
    // cheat. `game.allCards` retains every physical copy across every zone.
    private opponentConflictDeck(me: Player): KnownCard[] {
        const opp = (me as any).opponent as Player | undefined;
        if(!opp) {
            return [];
        }
        const allCards: any[] = (this.game as any).allCards || [];
        return allCards
            .filter((card: any) => card.owner === opp &&
                (card.isConflict || card.cardData?.side === 'conflict'))
            .map((card: any) => this.knownCard(card));
    }

    private ownConflictHand(me: Player): KnownCard[] {
        const hand: any[] = typeof (me as any).hand?.toArray === 'function'
            ? (me as any).hand.toArray()
            : [];
        return hand.filter((card: any) => card?.isConflict || card?.cardData?.side === 'conflict')
            .map((card: any) => this.knownCard(card));
    }

    private conflictPlanningCharacters(me: Player): { self: ConflictPlannerCharacter[]; opponent: ConflictPlannerCharacter[] } {
        const describe = (player: any): ConflictPlannerCharacter[] => {
            const cards: any[] = typeof player?.cardsInPlay?.toArray === 'function'
                ? player.cardsInPlay.toArray()
                : [];
            const rings: any[] = Object.values((this.game as any).rings || {}).filter((ring: any) =>
                typeof ring?.isUnclaimed === 'function' ? ring.isUnclaimed() : !ring?.claimedBy);
            const provinces: any[] = typeof player?.opponent?.getProvinces === 'function'
                ? player.opponent.getProvinces().filter((province: any) => !province.isBroken)
                : [];
            const legal = (card: any, axis: ConflictAxis) => {
                if(card?.bowed) {
                    return false;
                }
                // Current participants are already committed. Preserve them in
                // the first rollout action even if declaration legality now
                // reports false after the ring/province became contested.
                if(card?.inConflict && card?.controller === player) {
                    return true;
                }
                return rings.some((ring: any) => provinces.some((province: any) => {
                    try {
                        return card.canDeclareAsAttacker(axis, ring, province);
                    } catch{
                        return false;
                    }
                }));
            };
            return cards.filter((card: any) => (card?.type || card?.getType?.()) === 'character')
                .map((card: any) => {
                    const attachments: any[] = Array.isArray(card.attachments) ? card.attachments
                        : typeof card.attachments?.toArray === 'function' ? card.attachments.toArray() : [];
                    return {
                        uuid: String(card.uuid),
                        military: Math.max(0, Number(card.getMilitarySkill?.()) || 0),
                        political: Math.max(0, Number(card.getPoliticalSkill?.()) || 0),
                        ready: !card.bowed,
                        inConflict: !!card.inConflict,
                        legalMilitary: legal(card, 'military'),
                        legalPolitical: legal(card, 'political'),
                        covert: !!card.isCovert?.(),
                        bowsAfterConflict: typeof card.bowsOnReturnHome === 'function'
                            ? !!card.bowsOnReturnHome()
                            : true,
                        attachments: attachments.map((attachment: any) => {
                            const military = Number(attachment?.cardData?.military_bonus) || 0;
                            const political = Number(attachment?.cardData?.political_bonus) || 0;
                            const switched = attachment?.isAttachmentBonusModifierSwitchActive?.() === true;
                            const printedCost = Number(attachment?.cardData?.cost);
                            return {
                                uuid: String(attachment.uuid),
                                militaryBonus: switched ? political : military,
                                politicalBonus: switched ? military : political,
                                printedCost: Number.isFinite(printedCost) ? printedCost : undefined
                            };
                        })
                    };
                });
        };
        const opponent = (me as any).opponent;
        return { self: describe(me), opponent: describe(opponent) };
    }

    /**
     * Exact, public attachment targets from Jigoku's own target resolver.
     * This is a read-only legality query: V2 still submits the ordinary source
     * and target clicks, and the live prompt remains authoritative.
     */
    private legalAttachmentTargetUuidsBySource(me: Player): Record<string, readonly string[]> {
        const hand: any[] = typeof (me as any).hand?.toArray === 'function' ? (me as any).hand.toArray() : [];
        const result: Record<string, readonly string[]> = {};
        for(const source of hand) {
            if(!source?.uuid || typeof source.getPlayActions !== 'function') {
                continue;
            }
            const action = source.getPlayActions().find((entry: any) => entry instanceof PlayAttachmentAction);
            if(!action) {
                continue;
            }
            try {
                const context = action.createContext(me);
                const target = action.targets?.[0];
                const legal = typeof target?.getAllLegalTargets === 'function'
                    ? target.getAllLegalTargets(context) : [];
                result[String(source.uuid)] = legal
                    .filter((card: any) => card?.uuid && (card?.type || card?.getType?.()) === 'character')
                    .map((card: any) => String(card.uuid))
                    .sort((left: string, right: string) => left.localeCompare(right));
            } catch{
                // A custom target resolver may need state not available during
                // a controller hint. An empty exact set keeps V2 on V1.
                result[String(source.uuid)] = [];
            }
        }
        return result;
    }

    /**
     * Exact legal targets for the ready and move sources the ready -> move
     * sequencer plans with, read from the ENGINE instead of from a hand-written
     * eligibility table.
     *
     * `action.meetsRequirements(context) === ''` is what makes this exact: it
     * already enforces the conflict type, the phase, the card's own condition
     * (Matsu Mitsuko's honor lead, Shiotome Encampment's claimed military ring,
     * Even the Odds' participant count) and the once-per-round limits, so none
     * of that has to be restated in `MOVE_SOURCES` / `READY_SOURCES`. Those
     * tables carry only the FATE cost and the shape of the move, which the
     * action cannot report.
     *
     * Keyed by card ID, unioned across copies. The moved uuid is not always the
     * action's target: `selfOrBearerOnly` sources (Adorned Barcha, Formal
     * Invitation, Moto Eviscerator) move the character they are attached to or
     * are, while the action targets somebody else entirely.
     */
    private sequenceSourceTargets(player: Player): SequenceSourceTargets {
        const ready: Record<string, string[]> = {};
        const move: Record<string, string[]> = {};
        const readyAfterMove: Record<string, string[]> = {};
        if(!this.game?.currentConflict) {
            return { ready, move, readyAfterMove };
        }
        const readyIds = new Set(READY_SOURCES.map((spec) => spec.id));
        const moveIds = new Set(MOVE_SOURCES.map((spec) => spec.id));
        const record = (bucket: Record<string, string[]>, id: string, uuids: string[]) => {
            if(uuids.length > 0) {
                bucket[id] = Array.from(new Set((bucket[id] || []).concat(uuids))).sort();
            }
        };

        for(const source of this.sequenceSourceCandidates(player)) {
            const id = String(source?.cardData?.id || source?.id || '');
            const wantsReady = readyIds.has(id);
            const wantsMove = moveIds.has(id);
            if(!id || (!wantsReady && !wantsMove)) {
                continue;
            }
            for(const action of this.usableActions(source, player)) {
                let context;
                try {
                    context = action.createContext(player);
                    if(action.meetsRequirements(context) !== '') {
                        continue;
                    }
                } catch{
                    continue;
                }
                if(wantsMove) {
                    record(move, id, this.movedUuidsFor(id, source, action, context, player));
                }
                // A participant-only source can NEVER be the first leg, and
                // `getAllLegalTargets` cannot be trusted to say so: it returned
                // every friendly character for Fan of Command, participating or
                // not. Treat it as a SUPERSET (right type, right controller,
                // source usable) and keep the participation split here.
                if(wantsReady && !readySourceSpec(id)?.participantOnly) {
                    record(ready, id, this.legalOwnCharacterUuids(action, context, player));
                }
            }
            if(wantsReady) {
                record(readyAfterMove, id, this.readyAfterMoveUuidsFor(id, source, player));
            }
        }
        return { ready, move, readyAfterMove };
    }

    /**
     * Home bodies a PARTICIPANT-ONLY ready source would be able to stand up once
     * they have been moved into the conflict — the second leg of a move -> ready
     * sequence.
     *
     * The engine cannot answer this directly: with no legal participant yet,
     * `meetsRequirements` returns `'target'`, which is exactly the state the
     * plan exists to create. So the target check is ignored and everything else
     * — the source's own condition (Fan of Command's bearer participating, The
     * Pursuit of Justice's water conflict province), the phase, the costs, the
     * once-per-round limit — is still enforced, and the eligible bodies are
     * projected from the printed trait.
     */
    private readyAfterMoveUuidsFor(id: string, source: any, player: Player): string[] {
        const spec = readySourceSpec(id);
        if(!spec?.participantOnly) {
            return [];
        }
        const usable = this.usableActions(source, player).some((action: any) => {
            try {
                return action.meetsRequirements(action.createContext(player), ['target']) === '';
            } catch{
                return false;
            }
        });
        if(!usable) {
            return [];
        }
        // Both ends of the sequence: the body while still at HOME (so the
        // planner can commit to moving it) and the same body once it is a bowed
        // PARTICIPANT (the second leg, when this source can finally take it).
        // The planner splits them by `inConflict`.
        if(spec.selfOnly) {
            return source?.uuid ? [String(source.uuid)] : [];
        }
        return pileArray(player.cardsInPlay)
            .filter((card: any) => card?.uuid &&
                (card.type || card.getType?.()) === 'character' &&
                (!spec.trait || card.hasTrait?.(spec.trait)))
            .map((card: any) => String(card.uuid));
    }

    /** Every zone a ready/move source can be sitting in. */
    private sequenceSourceCandidates(player: Player): any[] {
        const inPlay = pileArray(player.cardsInPlay);
        const provinces: any[] = player.getProvinces ? player.getProvinces() : [];
        return [
            ...pileArray(player.hand),
            ...inPlay,
            ...inPlay.flatMap((card: any) => card?.attachments || []),
            ...provinces,
            ...provinces.flatMap((province: any) =>
                (province?.attachments || []).concat(province?.childCards || [])),
            ...(player.getDynastyCardsInProvince ? player.getDynastyCardsInProvince('any') : []),
            ...(player.stronghold ? [player.stronghold] : [])
        ];
    }

    /** Every action this card could take right now: a hand card offers its
     *  play actions, a board card its own. */
    private usableActions(source: any, player: Player): any[] {
        try {
            const actions: any[] = (String(source?.location || '') === 'hand'
                ? source?.getPlayActions?.()
                : source?.getActions?.()) || [];
            return actions.filter((action: any) =>
                action && action.createContext && action.meetsRequirements &&
                (!action.card || action.card.controller === player));
        } catch{
            return [];
        }
    }

    /**
     * Legal targets of an action, narrowed to characters this player controls
     * that are NOT already in the conflict.
     *
     * A SUPERSET, deliberately. `BaseCardSelector.getAllLegalTargets` did not
     * apply the target's `cardCondition` for the abilities measured here — Fan
     * of Command returned every friendly character rather than the
     * participating Bushi it can actually ready — so this narrows by type,
     * controller and participation only. The final target pick is still made by
     * the prompt handlers, which re-filter against the live selectable list.
     */
    private legalOwnCharacterUuids(action: any, context: any, player: Player): string[] {
        const target = (action.targets || [])[0];
        try {
            const legal: any[] = target?.getAllLegalTargets?.(context) || [];
            return legal
                .filter((card: any) => card?.uuid &&
                    (card.type || card.getType?.()) === 'character' &&
                    card.controller === player && !card.isParticipating?.() && !card.inConflict)
                .map((card: any) => String(card.uuid));
        } catch{
            return [];
        }
    }

    /** Which character this move source would actually put into the conflict. */
    private movedUuidsFor(id: string, source: any, action: any, context: any,
        player: Player): string[] {
        const spec = moveSourceSpec(id);
        if(!spec?.selfOrBearerOnly) {
            return this.legalOwnCharacterUuids(action, context, player);
        }
        // Attached to somebody (Adorned Barcha, Formal Invitation) or moving
        // itself (Moto Eviscerator).
        const moved = source?.parent && (source.parent.type || source.parent.getType?.()) === 'character'
            ? source.parent
            : source;
        return moved?.uuid && moved.controller === player && !moved.inConflict
            ? [String(moved.uuid)]
            : [];
    }

    // Own province is known information. Read the live game object so a still
    // facedown province gets its exact total: printed province + stronghold +
    // holdings + current effects. `strengthSummary` intentionally hides this
    // number while facedown.
    private strongholdProvinceStrength(player: Player): number | undefined {
        const provinces: any[] = typeof (player as any).getProvinces === 'function'
            ? (player as any).getProvinces() : [];
        const province = provinces.find((card) =>
            card?.location === 'stronghold province' && card.isProvince !== false);
        return province ? this.liveProvinceStrength(province) : undefined;
    }

    private weakestOuterProvinceStrength(player: Player): number | undefined {
        const provinces: any[] = typeof (player as any).getProvinces === 'function'
            ? (player as any).getProvinces() : [];
        const strengths = provinces
            .filter((card) => /^province [1-4]$/.test(String(card?.location || '')) &&
                card.isProvince !== false && !card.isBroken)
            .map((card) => this.liveProvinceStrength(card))
            .filter((strength) => Number.isFinite(strength));
        return strengths.length > 0 ? Math.min(...strengths) : undefined;
    }

    // One-time deck-analysis gate for the optional capability (satisfies
    // "analyze the deck before the omniscient bot works"). Scans the human's whole deck for conflict
    // events with no curated model and reports coverage. The bot still plays if
    // some events are unmodeled — it is simply blind to those specific tricks.
    private ensureDeckAnalyzed(me: Player): void {
        this.omniscientCapability.ensureDeckAnalyzed(me);
    }


    // Ticks resumed from an async context — LLM consult callbacks and the
    // self-scheduled budget-exhaustion follow-ups — run outside the human
    // command path (GameServer.onGameMessage) that normally broadcasts state
    // after the bot acts. Without pushing state here the human's board freezes
    // at the last human command while the bot silently plays on (omniscience makes
    // every step async, so this is the difference between a live and a frozen
    // opponent).
    private resumeTick(): void {
        this.tick();
        if(this.onStateChange) {
            try {
                this.onStateChange();
            } catch(err: any) {
                logger.error(`Bot ${this.config.playerName} state broadcast failed: ${err?.stack || err}`);
            }
        }
    }

    get player(): Player | undefined {
        return this.game.getPlayerByName(this.config.playerName);
    }

    // A prompt signature for loop detection that ignores the live conflict skill
    // totals ("Attacker: N Defender: M"), which change whenever the bot fires a
    // reversible ability. Without normalizing them out, a bot cycling in the
    // conflict action window would show a different signature each budget and
    // never trip the stuck detector.
    private stableSignature(prompt: any): string {
        const raw = `${prompt?.promptTitle || ''}|${prompt?.menuTitle || ''}`;
        return raw
            // Live conflict skill totals change on every reversible ability.
            .replace(/Attacker:\s*-?\d+\s*Defender:\s*-?\d+/gi, 'Attacker: N Defender: N')
            // At declaration the ring/type in the title ("Political Fire
            // Conflict") flips as the bot re-selects rings — legal clicks that
            // make no real progress. Collapse element+type so the loop is seen.
            .replace(/(?:military|political)\s+\w+\s+conflict/gi, 'CONFLICT')
            // Reaction/interrupt windows re-title by the trigger ("...Fate being
            // moved from Air Ring?", "...Water Ring?"), so a chained reaction
            // loop shows a fresh signature every fire and evades this detector.
            // Collapse the trigger text — MUST match the policy's dedup rule.
            .replace(/\bany (reactions?|interrupts?)\b.*/gi, 'any $1');
    }

    // Last-resort escape when the bot is looping on one prompt without progress.
    // Prefers Pass, then Done (both always safe in action/selection windows),
    // then any enabled button. Returns whether a click was accepted.
    private forceProgress(): boolean {
        const player = this.player;
        const prompt = player?.currentPrompt();
        const buttons: any[] = (prompt?.buttons || []).filter((button: any) => !button.disabled && (button.command || 'menuButton') === 'menuButton');
        if(!player || buttons.length === 0) {
            return false;
        }
        const byText = (needle: string) => buttons.find((button: any) => String(button.text || '').trim().toLowerCase() === needle);
        const chosen = byText('pass') || byText('done') || byText('pass conflict') || byText('yes') || buttons[0];
        const decision: BotDecision = { command: 'menuButton', args: [chosen.arg, chosen.uuid, chosen.method], target: chosen.text, reason: 'forced-progress' };
        const accepted = this.runCommand(decision.command, player.name, decision.args);
        this.record(prompt, decision, accepted ? 'success' : 'rejected', accepted ? 'forced-progress' : 'forced-progress-rejected');
        if(accepted) {
            this.game.continue();
        }
        return accepted;
    }

    tick(): boolean {
        if(this.ticking) {
            return false;
        }

        this.ticking = true;
        let acted = false;
        let exhaustedBudget = false;
        const maxDecisions = this.config.maxDecisionsPerTick || 20;

        try {
            for(let i = 0; i < maxDecisions; i++) {
                exhaustedBudget = i === maxDecisions - 1;
                const player = this.player;
                if(!player || player.left || player.disconnected) {
                    break;
                }

                const beforePrompt = player.currentPrompt();
                if(!this.isActivePrompt(beforePrompt)) {
                    break;
                }

                const targetHint = this.currentTargetHint(player);
                const promptStep = this.currentPromptStep(player);
                this.ensureDeckAnalyzed(player);
                const playerState = this.game.getState(player.name);
                let decision = this.engine.decide({ playerState, botName: player.name, context: {
                    roundNumber: (this.game as any).roundNumber,
                    income: typeof (player as any).getTotalIncome === 'function'
                        ? (player as any).getTotalIncome()
                        : 7,
                    provinceIdsByLocation: this.provinceIdsByLocation(player),
                    provinceKnowledge: this.provinceKnowledgeSnapshot(player),
                    completedConflictsThisRound: ((this.game as any).conflictRecord || [])
                        .filter((record: any) => record?.completed).length,
                    opponentCompletedConflictsThisRound: ((this.game as any).conflictRecord || [])
                        .filter((record: any) => record?.completed && record?.attackingPlayer === player.opponent).length,
                    promptIdentity: promptStep?.uuid,
                    promptControls: beforePrompt?.controls || [],
                    // Printed stats for card-shaped menu buttons, and whether
                    // the dynasty +1-fate pass bonus is still on the table.
                    menuCardInfo: this.menuCardInfo(beforePrompt),
                    opponentPassedDynasty: !!(player.opponent as any)?.passedDynasty,
                    selectionReachedLimit: typeof promptStep?.selector?.hasReachedLimit === 'function'
                        ? promptStep.selector.hasReachedLimit(promptStep.selectedCards || [], promptStep.context)
                        : false,
                    targetHint: targetHint,
                    playCost: this.currentPlayCost(player),
                    playCardId: this.currentPlayCardId(player),
                    handStats: this.handStatsHint(player),
                    // The hand-written playbook is the only source of per-card
                    // advice. An entry scoped to a deck this one is not returns
                    // undefined, and the policy falls back to its generic
                    // handling for that card.
                    cardHint: (cardId: string) =>
                        getPlaybookEntry(cardId, this.currentDeckStrategy(player)),
                    strategy: this.currentDeckStrategy(player),
                    profile: this.decisionProfile(player),
                    opponentConflictDeck: this.opponentConflictDeck(player),
                    ownConflictHand: this.ownConflictHand(player),
                    opponentDuelBidding: this.opponentDuelBidProfile(player),
                    duelParticipantIaijutsuReady: this.iaijutsuMasterReadyByCharacter(player),
                    // Exact public character data omitted by serialized player
                    // summaries. Lion uses these for Elegant Tessen legality
                    // and True Strike Kenjutsu's base-skill matchup.
                    characterPrintedCosts: this.characterPrintedCosts(player),
                    dynastyDiscardBodies: this.dynastyDiscardBodies(player),
                    holdingStrengths: this.holdingStrengths(player),
                    conflictProvinceElements: this.conflictProvinceElements(),
                    characterBaseMilitary: this.characterBaseMilitary(player),
                    participatingCharacterCounts: this.participatingCharacterCounts(player),
                    cavalryCharacterUuids: this.cavalryCharacterUuids(player),
                    unicornFactionCharacterUuids: this.unicornFactionCharacterUuids(player),
                    readyAfterMoveCharacterUuids: this.readyAfterMoveCharacterUuids(player),
                    // Exact engine legality for the ready -> move sequencer.
                    sequenceSourceTargets: this.sequenceSourceTargets(player),
                    // Exact live duel skills/honor/Iaijutsu state for shared
                    // 5x5 bid analysis. Gap remains for old synthetic callers.
                    duelBidContext: this.currentDuelBidContext(player),
                    duelGap: this.currentDuelGap(player),
                    // Effective post-reveal margin, including bid modifiers.
                    duelMargin: this.currentDuelMargin(player),
                    interruptedEventIsMine: this.currentInterruptedEventIsMine(player),
                    interruptedAbilityIsMine: this.currentInterruptedAbilityIsMine(player),
                    leavingPlayCardIsMine: this.currentLeavingPlayCardIsMine(player),
                    displayOfPowerActive: this.displayOfPowerActiveThisConflict(),
                    legalDirectCardUuids: this.currentLegalDirectCardUuids(player),
                    legalAttachmentTargetUuidsBySource: this.legalAttachmentTargetUuidsBySource(player),
                    legalRingElements: this.currentLegalRingElements(player),
                    // Printed fate cost of dynasty province cards (reserve 1 fate).
                    dynastyCosts: this.dynastyCostsHint(player),
                    // Exact public printed skills, ability density, and live
                    // honor-on-entry effects for board-aware dynasty valuation.
                    dynastyCharacterInfo: this.dynastyCharacterInfo(player),
                    // Public denial value of each opponent province, for target
                    // ordering: breaking one discards the faceup dynasty cards
                    // waiting in it.
                    opponentProvinceDenial: this.opponentFaceupDynastyDenial(player),
                    // Player-state hand summaries omit printed conflict-card
                    // costs. Deck profiles need these to sequence reducers.
                    conflictCosts: this.conflictCostsHint(player),
                    drawBidContext: beforePrompt?.promptTitle === 'Honor Bid' &&
                        !String(beforePrompt?.menuTitle || '').startsWith('Choose your bid for the duel')
                        ? this.drawBidContext(player)
                        : undefined,
                    strongholdProvinceStrength: this.strongholdProvinceStrength(player),
                    weakestOuterProvinceStrength: this.weakestOuterProvinceStrength(player),
                    // Public visible defender ability; every seed may protect
                    // its participant immediately when that defender can bow.
                    opponentParticipantCanBow: this.opponentParticipantCanBow(player),
                    conflictPlanningCharacters: this.conflictPlanningCharacters(player),
                    // Seed 3 only: the cheat view (human hand/fate/true province
                    // strengths). Undefined when the capability is disabled, so the
                    // policy's omniscient branches stay dormant for fair bots.
                    omniscient: this.buildOmniscient(player)
                } });


                if(!decision) {
                    this.record(beforePrompt, null, 'unsupported', 'unsupported-prompt');
                    logger.info(`Bot ${this.config.playerName} has no decision for prompt '${beforePrompt?.promptTitle}' / '${beforePrompt?.menuTitle}'`);
                    break;
                }

                const legal = this.isLegalDecision(player, decision);
                if(!legal) {
                    this.record(beforePrompt, decision, 'rejected', 'illegal-command');
                    logger.info(`Bot ${this.config.playerName} decision rejected as illegal: ${decision.command} ${JSON.stringify(decision.args)} at '${beforePrompt?.promptTitle}'`);
                    // Click decisions are remembered by the policy's attempted
                    // set, so the next iteration proposes a different target.
                    // Button decisions would repeat verbatim — stop instead.
                    if(['cardClicked', 'ringClicked', 'facedownCardClicked'].includes(decision.command)) {
                        continue;
                    }
                    break;
                }

                const accepted = this.runCommand(decision.command, player.name, decision.args);
                this.record(beforePrompt, decision, accepted ? 'success' : 'rejected', accepted ? decision.reason : 'command-rejected');
                if(!accepted) {
                    logger.info(`Bot ${this.config.playerName} command rejected by game: ${decision.command} ${JSON.stringify(decision.args)} at '${beforePrompt?.promptTitle}' / '${beforePrompt?.menuTitle}'`);
                    break;
                }

                this.game.continue();
                acted = true;
            }
        } catch(err: any) {
            // A policy/controller bug must never silently freeze the bot's
            // seat — log it loudly; the next human command re-ticks us.
            logger.error(`Bot ${this.config.playerName} tick failed: ${err?.stack || err}`);
        } finally {
            this.ticking = false;
        }

        // Long solo chains (dynasty buys, conflict resolution) can outrun the
        // per-tick budget; without a human command nothing would re-tick the
        // bot, so schedule a follow-up ourselves. A budget can also exhaust
        // with acted=false when every proposed move is rejected as illegal
        // (e.g. cycling through rings the game will not accept at conflict
        // declaration) — that is exactly the loop the stuck detector must
        // catch, so track exhaustion regardless of whether anything landed.
        if(exhaustedBudget) {
            const prompt = this.player?.currentPrompt();
            const signature = this.stableSignature(prompt);
            // A single stuck prompt repeats the same signature, but the bot can
            // also OSCILLATE between two prompts (elemental ring <-> choose
            // province while toggling conflict type) — an A-B-A-B loop that
            // never repeats consecutively. So count a budget as no-progress
            // whenever its signature was seen in the recent window, and only
            // reset when a genuinely new one appears (real progress emits fresh
            // signatures — new cards, new phase).
            const revisited = this.recentExhaustSignatures.includes(signature);
            this.consecutiveExhaustions = revisited ? this.consecutiveExhaustions + 1 : 0;
            this.recentExhaustSignatures.push(signature);
            if(this.recentExhaustSignatures.length > 4) {
                this.recentExhaustSignatures.shift();
            }

            // The same prompt surviving several full budgets means the bot is
            // toggling state without progress — e.g. re-firing reversible
            // conflict abilities, or re-selecting a card that always cancels
            // for want of a legal target. Passing (or finishing a selection) is
            // always legal in these windows, so force it to break the loop
            // instead of freezing the seat forever.
            if(this.consecutiveExhaustions >= 5) {
                logger.error(`Bot ${this.config.playerName} appears stuck in a decision loop at '${signature}'; forcing pass. Recent decisions: ${JSON.stringify(this.trace.slice(-6))}`);
                this.consecutiveExhaustions = 0;
                this.recentExhaustSignatures = [];
                if(this.forceProgress()) {
                    setTimeout(() => this.resumeTick(), 10);
                }
                return acted;
            }

            logger.info(`Bot ${this.config.playerName} decision budget exhausted with prompts remaining, scheduling follow-up tick; recent decisions: ${JSON.stringify(this.trace.slice(-3))}`);
            setTimeout(() => this.resumeTick(), 10);
        } else {
            this.consecutiveExhaustions = 0;
            this.recentExhaustSignatures = [];
        }

        return acted;
    }

    // Deck-level strategy flags (holding engine / defensive) derived once from
    // the printed cards the bot actually owns. Cards populate at game setup;
    // memoize as soon as any are available so mulligan/dynasty prompts see it.
    private deckProfile?: DeckProfile;
    private currentDeckStrategy(player: Player): DeckStrategy | undefined {
        if(this.deckStrategy) {
            return this.deckStrategy;
        }
        const ids = this.deckCardIds(player);
        if(ids.length === 0) {
            return undefined;
        }
        this.deckStrategy = deriveDeckStrategy(ids);
        logger.info(`Bot ${this.config.playerName} deck strategy: ${JSON.stringify(this.deckStrategy)}`);
        return this.deckStrategy;
    }

    private deckCardIds(player: Player): string[] {
        const allCards: any[] = (this.game as any).allCards || [];
        return allCards
            .filter((card: any) => card.owner === player && card.cardData?.id)
            .map((card: any) => card.cardData.id);
    }

    // The tuning profile for this deck: the strategy-derived knobs plus any
    // per-deck override (see DeckProfiles). Cached once the deck is known.
    private currentDeckProfile(player: Player): DeckProfile | undefined {
        if(this.deckProfile) {
            return this.deckProfile;
        }
        const strategy = this.currentDeckStrategy(player);
        if(!strategy) {
            return undefined;
        }
        this.deckProfile = resolveDeckProfile(this.deckCardIds(player), strategy);
        logger.info(`Bot ${this.config.playerName} deck profile: ${JSON.stringify(this.deckProfile)}`);
        return this.deckProfile;
    }

    // Deck profile merged with any injected experimental V2 profile override
    // (config.v2Profile). Convention:
    //   - `v2Profile.deckProfile`          -> deep-merged into the DeckProfile
    //     top level for every deck (shared `conflictPlanning` declaration
    //     layers for the V2 seat while the V1 control keeps its defaults).
    //   - `v2Profile.deckProfileByArchetype` -> per-archetype overrides keyed
    //     by the resolved profile's win-condition flag (`lion`, `unicorn`,
    //     `dishonor`, `glory`, `shugenja`, `dragon`, else `standard`); merged
    //     OVER the shared `deckProfile`. This is how the V2 seat carries
    //     deck-specific declaration tuning on top of the generic V2 logic
    //     without touching the frozen V1 deck profiles. Production-safe: the
    //     archetype is derived from the resolved profile, not a self-play label.
    //   - every other key in v2Profile     -> merged into `profile.v2` (V2
    //     engine gate/weights/search config; V1 ignores it).
    // Kept additive so frozen behavior is unchanged when no override is supplied.
    private static profileArchetype(profile: any): string {
        if(!profile) {
            return 'standard';
        }
        return profile.lion ? 'lion'
            : profile.unicorn ? 'unicorn'
                : profile.bidWar ? 'bid-war'
                    : profile.dishonor ? 'dishonor'
                        : profile.glory ? 'glory'
                            : profile.shugenja ? 'shugenja'
                                : profile.dragon ? 'dragon'
                                    : 'standard';
    }

    // Merge base -> shared -> per-deck for one tactics sub-profile. Scalars and
    // arrays are replaced by the last layer that names them (an arm naming a
    // list means that list). Plain-object fields are merged one level deeper so
    // an arm can retune ONE entry of a lookup table — `additionalFateByCharacterId`,
    // `provinceTextPriorityById`, `onRevealValueById` — without silently zeroing
    // every entry it did not restate.
    private static isTacticsSubProfileKey(key: string): boolean {
        return (JigokuBotController.TACTICS_SUBPROFILE_KEYS as readonly string[]).includes(key);
    }

    private static mergeTacticsProfile(...layers: any[]): any {
        const merged: any = {};
        for(const layer of layers) {
            if(!layer) {
                continue;
            }
            for(const [field, value] of Object.entries(layer)) {
                const isRecord = value && typeof value === 'object' && !Array.isArray(value);
                const existing = merged[field];
                const existingIsRecord = existing && typeof existing === 'object' && !Array.isArray(existing);
                merged[field] = isRecord && existingIsRecord
                    ? { ...existing, ...value }
                    : isRecord ? { ...value } : value;
            }
        }
        return merged;
    }

    // Every tactics sub-profile a tuning arm may name. Some of these exist on
    // EVERY deck (`drawBidding`, `conflictDeclaration`, ...); the rest are the
    // per-playstyle modules, and for those the KEY'S PRESENCE is the deck gate
    // — `JigokuBotPolicy` builds them as
    // `profile.shugenja ? new ShugenjaTactics(profile.shugenja) : null`.
    private static readonly TACTICS_SUBPROFILE_KEYS = [
        'rebirth', 'shugenja', 'fateAwareEconomy', 'strongholdDefense',
        'defenseTuning', 'conflictDeclaration', 'conflictCardEconomy',
        'drawBidding', 'duelBidding', 'personalHonor', 'boardAwareDynasty',
        'mulligan', 'honorRace', 'unicornReveal', 'provinceRevealResponse',
        'bidWar', 'lionDuelist', 'crabSacrifice', 'craneHonor', 'lionHonor',
        'strongholdBow', 'conflictRecursion', 'dynastyEvents', 'saveFatePass',
        'aggressiveSpend', 'provinceTargeting', 'conflictDeckSafety',
        'conflictTempo', 'unopposedWindow', 'readyValue', 'defenderRingChoice',
        'readyMove', 'attachmentTarget', 'moveIntoConflict', 'dragon'
    ] as const;

    private decisionProfile(player: Player): DeckProfile | undefined {
        // Bot V2 carries its own per-deck tuning, the same way V1 does. It is
        // applied only for the V2 engine so V1's measured behavior stays frozen
        // and every V2-vs-V1 comparison remains a clean A/B.
        const base = this.config.engineVersion === 'v2'
            ? applyV2DeckProfile(this.currentDeckProfile(player))
            : this.currentDeckProfile(player);
        const override = this.config.v2Profile as any;
        if(!override) {
            return base;
        }
        const { deckProfile: sharedTop, deckProfileByArchetype, ...v2Fields } = override;
        const baseAny = (base as any) || {};
        const archetype = JigokuBotController.profileArchetype(baseAny);
        const perDeck = (deckProfileByArchetype && deckProfileByArchetype[archetype]) || {};
        // A deck-scoped module named by an arm must never be CREATED on a deck
        // whose base profile has none. Naming `shugenja` at the top level of an
        // arm used to hand every deck in the field a partial ShugenjaProfile,
        // which switches Phoenix spell logic on with its id lists undefined:
        // measured on Crab at 16 of 16 games lost, 100% of games flipped AWAY.
        // A dropped override is a visible non-result; a created one silently
        // destroys every deck that does not own the module.
        const inapplicable = Object.keys({ ...(sharedTop || {}), ...perDeck })
            .filter((key) => JigokuBotController.isTacticsSubProfileKey(key) && !baseAny[key]);
        if(inapplicable.length > 0 && !this.reportedInapplicableOverrides) {
            this.reportedInapplicableOverrides = true;
            logger.info(`Bot ${this.config.playerName} ignored deck-profile override(s) ` +
                `${inapplicable.join(', ')}: the '${archetype}' profile has no such module. ` +
                'Scope the arm with deckProfileByArchetype instead of naming it at the top level.');
        }
        const dropped = new Set(inapplicable);
        const topLevel: any = Object.fromEntries(
            Object.entries({ ...(sharedTop || {}), ...perDeck })
                .filter(([key]) => !dropped.has(key))
        );
        const baseV2 = baseAny.v2 || {};
        const merged: any = {
            ...baseAny,
            ...topLevel,
            v2: {
                ...baseV2,
                ...v2Fields,
                highConfidenceGate: { ...(baseV2.highConfidenceGate || {}), ...(v2Fields.highConfidenceGate || {}) }
            }
        };
        // Deep-merge conflictPlanning across base -> shared -> per-deck so a
        // per-deck override only changes the flags/coefficients it names.
        if(baseAny.conflictPlanning || sharedTop?.conflictPlanning || perDeck.conflictPlanning) {
            merged.conflictPlanning = {
                ...(baseAny.conflictPlanning || {}),
                ...(sharedTop?.conflictPlanning || {}),
                ...(perDeck.conflictPlanning || {})
            };
        }
        // Same treatment for the deck tactics sub-profiles, so a tuning arm can
        // name ONE knob instead of restating the whole object. A shallow spread
        // would silently drop every field the arm did not mention — for
        // `rebirth` that includes the printed-skill table and the Phoenix
        // faction list, which are load-bearing legality data, not preferences.
        // Inert until an arm sets one: no shipped override does.
        // One level deep, which is all a tuning arm needs: arms set scalars.
        for(const key of JigokuBotController.TACTICS_SUBPROFILE_KEYS) {
            if((sharedTop?.[key] || perDeck[key]) && !dropped.has(key)) {
                merged[key] = JigokuBotController.mergeTacticsProfile(
                    baseAny[key], sharedTop?.[key], perDeck[key]
                );
            }
        }
        // SAFETY: `merged` is `baseAny` (a resolved DeckProfile) plus overrides
        // restricted above to keys that profile already carries.
        return merged as DeckProfile;
    }

    executeDecision(decision: BotDecision): boolean {
        const player = this.player;
        const prompt = player?.currentPrompt();
        if(!player || !prompt || !this.isLegalDecision(player, decision)) {
            this.record(prompt || {}, decision, 'rejected', 'illegal-command');
            logger.info(`Bot ${this.config.playerName} executeDecision illegal: ${decision.command} ${JSON.stringify(decision.args)} at '${prompt?.promptTitle}' / '${prompt?.menuTitle}'`);
            return false;
        }

        const accepted = this.runCommand(decision.command, player.name, decision.args);
        this.record(prompt, decision, accepted ? 'success' : 'rejected', accepted ? decision.reason : 'command-rejected');
        return accepted;
    }

    private isActivePrompt(prompt: any): boolean {
        return !!prompt && (prompt.buttons?.length > 0 || prompt.controls?.length > 0 || prompt.selectCard || prompt.selectRing);
    }

    // The active prompt step lives at the bottom of the nested pipeline stack.
    private currentPromptStep(player: Player): any {
        let pipeline: any = (this.game as any).pipeline;
        let step: any;
        while(pipeline && pipeline.length > 0) {
            step = pipeline.getCurrentStep();
            pipeline = step?.pipeline?.length > 0 ? step.pipeline : null;
        }

        if(step && typeof step.activeCondition === 'function' && !step.activeCondition(player)) {
            return undefined;
        }

        return step;
    }

    // When the current prompt is an ability target selection, expose the game
    // actions it will resolve (bow, honor, removeFate, ...) so the policy can
    // aim harmful effects at the opponent and helpful ones at its own cards.
    private currentTargetHint(player: Player): {
        gameActions: string[];
        sourceIsMine: boolean;
        sourceType?: string;
        sourceCardId?: string;
        sourceUuid?: string;
        playCardFateCostIgnored?: boolean;
        duelAxis?: 'military' | 'political';
        duelOpponentUuid?: string;
        duelSourceCardId?: string;
    } | undefined {
        const step = this.currentPromptStep(player);
        const configuredActions = step?.properties?.gameAction;
        const gameActions = Array.isArray(configuredActions)
            ? configuredActions
            : configuredActions
                ? [configuredActions]
                : [];
        // Event/holding-started duels have two selectors. The first
        // `challenger` selector has no gameAction; only dependent duelTarget
        // owns DuelAction. Recover axis from original card ability so bot does
        // not mistake a political challenger prompt for generic military.
        let duelProperties = step?.context?.ability?.properties?.initiateDuel;
        if(typeof duelProperties === 'function') {
            try {
                duelProperties = duelProperties(step.context);
            } catch{
                duelProperties = undefined;
            }
        }
        let duelAxis = duelProperties?.type === 'military' || duelProperties?.type === 'political'
            ? duelProperties.type
            : undefined;
        // Character and gained-attachment abilities may define DuelAction
        // directly instead of using CardAbility.initiateDuel (Kaezin and
        // Duelist Training). Read its resolved type as the second generic path.
        if(!duelAxis) {
            // Policy Debate and Game of Sadane define their two selectors
            // manually. Their first `challenger` step has no action, while the
            // dependent `duelTarget` selector owns DuelAction. Inspect all
            // original target definitions so their first prompt still carries
            // the correct political axis.
            const targetDefinitions = step?.context?.ability?.properties?.targets;
            const dependentActions = targetDefinitions && typeof targetDefinitions === 'object'
                ? Object.values(targetDefinitions).flatMap((target: any) => {
                    const action = target?.gameAction;
                    return Array.isArray(action) ? action : action ? [action] : [];
                })
                : [];
            const duelAction = gameActions.concat(dependentActions)
                .find((action: any) => action?.name === 'duel');
            try {
                const properties = duelAction?.getProperties?.(step.context);
                if(properties?.type === 'military' || properties?.type === 'political') {
                    duelAxis = properties.type;
                }
            } catch{
                // Dynamic action may require a later resolution context. Deck
                // source-axis metadata remains the safe policy fallback.
            }
        }
        if(gameActions.length === 0 && !duelAxis) {
            return undefined;
        }

        // Composite actions (for example `multiple([ready(), moveCard()])`)
        // have no useful name on their wrapper. Expose their leaf actions so
        // specialized target logic sees the real effect instead of an empty
        // action list.
        let playCardFateCostIgnored = false;
        const actionNames = (action: any, seen = new Set<any>()): string[] => {
            if(!action || seen.has(action)) {
                return [];
            }
            seen.add(action);
            let properties = action.properties;
            if(!properties && typeof action.getProperties === 'function') {
                try {
                    properties = action.getProperties(step?.context);
                } catch{
                    // A dynamic action may need resolution-only context. Its
                    // own name remains a safe fallback for the bot hint.
                }
            }
            if(action.name === 'playCard' &&
                (properties?.ignoreFateCost || action.defaultProperties?.ignoreFateCost)) {
                playCardFateCostIgnored = true;
            }
            const nested = properties?.gameActions || action.defaultProperties?.gameActions;
            if(Array.isArray(nested) && nested.length > 0) {
                return nested.flatMap((child: any) => actionNames(child, seen));
            }
            return action.name ? [action.name] : [];
        };

        const source = step.context?.source;
        const sourceType = source?.type || source?.getType?.();
        // Gained duel Actions have the character as `source`, but CardAbility
        // retains the attachment that granted them as `origin`. Preserve that
        // printed id so deck tactics can identify True Strike Kenjutsu instead
        // of seeing only Matsu Beiona (or another bearer).
        const abilityOrigin = step.context?.ability?.origin;
        const duelSourceCardId = duelAxis
            ? abilityOrigin?.cardData?.id || abilityOrigin?.id
            : undefined;
        const challenger = step.context?.targets?.challenger ||
            (sourceType === 'character' ? source : undefined);

        return {
            gameActions: [...new Set([
                ...gameActions.flatMap((action: any) => actionNames(action)),
                ...(duelAxis ? ['duel'] : [])
            ])],
            sourceIsMine: step.context?.player?.name === player.name,
            sourceType,
            sourceCardId: source?.cardData?.id,
            // Replay effects such as Inventive Mirumoto force the replayed
            // attachment onto the exact character that started the action.
            // Card id alone is ambiguous when two copies are in play.
            ...(source?.uuid ? { sourceUuid: source.uuid } : {}),
            ...(playCardFateCostIgnored ? { playCardFateCostIgnored: true } : {}),
            ...(duelAxis ? { duelAxis } : {}),
            ...(duelSourceCardId ? { duelSourceCardId } : {}),
            ...(challenger?.uuid ? { duelOpponentUuid: challenger.uuid } : {})
        };
    }

    // The base skill gap of the live duel from `player`'s point of view:
    // (our side's skill) - (their side's skill) on the duel's axis, BEFORE
    // honor bids are added. The bot uses it for the post-reveal Iaijutsu
    // decision. The full bid matrix reads exact military, political, glory,
    // custom, and multi-target skill through currentDuelBidContext().
    private currentDuelGap(player: Player): number | undefined {
        const context = this.currentDuelBidContext(player);
        return context ? context.mySkill - context.opponentSkill : undefined;
    }

    private currentDuelBidContext(player: Player): DuelBidContext | undefined {
        const duel: any = (this.game as any).currentDuel;
        if(!duel || !duel.challenger || !player.opponent || typeof duel.getSkillStatistic !== 'function') {
            return undefined;
        }
        const skillOf = (card: any): number => {
            if(!card) {
                return 0;
            }
            const value = duel.getSkillStatistic(card);
            return typeof value === 'number' && Number.isFinite(value) ? value : 0;
        };
        const targets: any[] = duel.targets || [];
        const challengerIsMine = duel.challengingPlayer?.name === player.name ||
            duel.challenger.controller?.name === player.name;
        const challengerSide = [duel.challenger];
        const myCards = challengerIsMine ? challengerSide : targets;
        const opponentCards = challengerIsMine ? targets : challengerSide;
        const hasReadyIaijutsuMaster = (cards: any[]): boolean => cards.some((card) =>
            this.characterHasReadyIaijutsuMaster(card));
        const winsTies = (cards: any[]): boolean => cards.some((card) =>
            typeof card.anyEffect === 'function' && card.anyEffect(EffectNames.WinDuelTies));
        return {
            mySkill: myCards.reduce((total, card) => total + skillOf(card), 0),
            opponentSkill: opponentCards.reduce((total, card) => total + skillOf(card), 0),
            myHonor: player.honor,
            opponentHonor: player.opponent.honor,
            roundNumber: (this.game as any).roundNumber,
            myIaijutsuMasterReady: hasReadyIaijutsuMaster(myCards),
            opponentIaijutsuMasterReady: hasReadyIaijutsuMaster(opponentCards),
            myWinsTies: winsTies(myCards),
            opponentWinsTies: winsTies(opponentCards),
            opponentProfile: this.opponentDuelBidProfile(player)
        };
    }

    // CardAbility defaults every printed ability to once per round. Preserve
    // that live limit state: merely having Iaijutsu Master attached does not
    // mean its post-reveal +/-1 is still available for another duel.
    private characterHasReadyIaijutsuMaster(card: any): boolean {
        return (card?.attachments || []).some((attachment: any) => {
            if((attachment.cardData?.id || attachment.id) !== 'iaijutsu-master' ||
                attachment.isBlank?.()) {
                return false;
            }
            const reactions = typeof attachment.getReactions === 'function'
                ? attachment.getReactions()
                : attachment.reactions || attachment.abilities?.reactions || [];
            const reaction = reactions.find((ability: any) =>
                String(ability.title || '').toLowerCase().includes('change your bid')) || reactions[0];
            return !reaction?.limit?.isAtMax?.(attachment.controller);
        });
    }

    private iaijutsuMasterReadyByCharacter(player: Player): Record<string, boolean> {
        const ready: Record<string, boolean> = {};
        for(const side of [player, player.opponent]) {
            const cards: any[] = typeof (side as any)?.cardsInPlay?.toArray === 'function'
                ? (side as any).cardsInPlay.toArray()
                : [];
            for(const card of cards) {
                if(card?.uuid) {
                    ready[card.uuid] = this.characterHasReadyIaijutsuMaster(card);
                }
            }
        }
        return ready;
    }

    private characterPrintedCosts(player: Player): Record<string, number> {
        return this.characterNumberHint(player, (card) => {
            const value = Number(card?.cardData?.cost ?? card?.printedCost);
            return Number.isFinite(value) ? value : undefined;
        });
    }

    /**
     * Printed stats of the CHARACTERS sitting in this player's dynasty discard.
     *
     * The serialized card summary carries live skill only, which is empty
     * outside play, and it deliberately stays that way: V1 code paths read
     * `printedCost` straight off summaries, so adding fields there would move
     * the frozen control. Routing it through the bot context instead keeps the
     * data V2-only. Discard piles are public, so this is not hidden information.
     */
    private dynastyDiscardBodies(player: Player): Array<Record<string, unknown>> {
        const pile: any[] = typeof (player as any)?.dynastyDiscardPile?.toArray === 'function'
            ? (player as any).dynastyDiscardPile.toArray()
            : [];
        return pile
            .filter((card: any) => card?.type === 'character' || card?.getType?.() === 'character')
            .map((card: any) => ({
                uuid: card.uuid,
                id: card.id,
                traits: Array.from(card.getTraits ? card.getTraits() : []).map((trait: any) =>
                    String(trait).toLowerCase()),
                printedCost: this.parseStat(card.printedCost ?? card.cardData?.cost) ?? undefined,
                military: Math.max(0, Number(card.printedMilitarySkill) || 0),
                political: Math.max(0, Number(card.printedPoliticalSkill) || 0),
                glory: Math.max(0, Number(card.glory) || 0),
                isUnique: !!card.isUnique?.()
            }));
    }

    /**
     * Province-strength bonuses of the HOLDINGS in this player's dynasty discard,
     * and of the holding already installed in each province.
     *
     * Rebuild swaps a discard holding into an unbroken province, and for a wall
     * deck the strength bonus is the entire point — it raises the threshold an
     * attacker has to clear. Routed through the bot context for the same reason
     * as `dynastyDiscardBodies`: the serialized card summary has no printed
     * strength, and adding it there would move the frozen V1 control.
     */
    /**
     * Province elements of the CURRENT conflict, both sides.
     *
     * Abilities like The Pursuit of Justice key off the conflict province's
     * element rather than owning that province ("during a conflict at a water
     * province"), and `CardAction.checkProvinceCondition` tests every province
     * returned by `Conflict.getConflictProvinces()`. The serialized player
     * summary carries no province element, so the gate is impossible to write
     * without this.
     */
    private conflictProvinceElements(): string[] {
        const conflict: any = (this.game as any)?.currentConflict;
        if(typeof conflict?.getConflictProvinces !== 'function') {
            return [];
        }
        const elements = new Set<string>();
        for(const province of conflict.getConflictProvinces() || []) {
            for(const element of province?.getElement?.() || []) {
                elements.add(String(element));
            }
        }
        return [...elements];
    }

    private holdingStrengths(player: Player): {
        discard: number[];
        provinces: number[];
        inPlay: Array<{ id: string; strengthBonus: number; provinceBroken: boolean }>;
    } {
        const bonusOf = (card: any) =>
            Math.max(0, this.parseStat(card?.cardData?.strength_bonus) ?? 0);
        const pile: any[] = typeof (player as any)?.dynastyDiscardPile?.toArray === 'function'
            ? (player as any).dynastyDiscardPile.toArray()
            : [];
        const isHolding = (card: any) => card?.type === 'holding' || card?.getType?.() === 'holding';
        const inPlay: any[] = ((this.game as any).allCards || [])
            .filter((card: any) => card?.controller === player && isHolding(card) &&
                String(card.location || '').startsWith('province'));
        // Which province each holding sits in decides what giving it up costs.
        // A holding in a BROKEN province is defending nothing — the province
        // cannot be broken twice — so its strength bonus is already spent, and
        // it is the cheapest thing on the board to sacrifice.
        const brokenProvinces = new Set<string>();
        for(const key of ['province 1', 'province 2', 'province 3', 'province 4', 'stronghold province']) {
            const cards: any[] = (player as any).getProvinceCardInProvince?.(key)
                ? [(player as any).getProvinceCardInProvince(key)]
                : [];
            if(cards.some((card: any) => card?.isBroken)) {
                brokenProvinces.add(key);
            }
        }
        return {
            discard: pile.filter(isHolding).map(bonusOf),
            provinces: inPlay.map(bonusOf),
            inPlay: inPlay.map((card: any) => ({
                id: String(card.id || ''),
                strengthBonus: bonusOf(card),
                provinceBroken: brokenProvinces.has(String(card.location || ''))
            }))
        };
    }

    private characterBaseMilitary(player: Player): Record<string, number> {
        return this.characterNumberHint(player, (card) => {
            const value = typeof card?.getBaseMilitarySkill === 'function'
                ? card.getBaseMilitarySkill()
                : card?.printedMilitarySkill;
            return typeof value === 'number' && Number.isFinite(value)
                ? Math.max(value, 0)
                : undefined;
        });
    }

    private participatingCharacterCounts(player: Player): { self: number; opponent: number } {
        const conflict: any = (this.game as any).currentConflict;
        if(!conflict || typeof conflict.getNumberOfParticipantsFor !== 'function') {
            return { self: 0, opponent: 0 };
        }
        return {
            self: conflict.getNumberOfParticipantsFor(player),
            opponent: conflict.getNumberOfParticipantsFor(player.opponent)
        };
    }

    /**
     * Both sides' characters in play, as the live engine cards. One traversal
     * shared by every "which uuids have property X" publisher below.
     */
    private charactersInPlayBothSides(player: Player): any[] {
        const characters: any[] = [];
        for(const side of [player, player.opponent]) {
            // SAFETY: `Player.cardsInPlay` is an underscore collection whose
            // `toArray` is not on the typed surface; the guard below is the
            // check, and a side with no collection contributes nothing.
            const collection = (side as any)?.cardsInPlay;
            const cards: any[] = collection?.toArray?.() || [];
            for(const card of cards) {
                const type = card?.type || card?.getType?.();
                if(card?.uuid && type === 'character') {
                    characters.push(card);
                }
            }
        }
        return characters;
    }

    private characterUuidsWhere(player: Player, matches: (card: any) => boolean): Record<string, true> {
        const result: Record<string, true> = {};
        for(const card of this.charactersInPlayBothSides(player)) {
            if(matches(card)) {
                result[card.uuid] = true;
            }
        }
        return result;
    }

    /**
     * Characters the ENGINE reports as Unicorn faction. Utaku Infantry counts
     * participating Unicorn characters, and the serialized card summary a
     * policy reads carries no faction at all — the same gap that made
     * `legalAttachmentTargetUuidsBySource` necessary for attachment bearers.
     */
    private unicornFactionCharacterUuids(player: Player): Record<string, true> {
        return this.characterUuidsWhere(player, (card) => !!card.isFaction?.('unicorn'));
    }

    private cavalryCharacterUuids(player: Player): Record<string, true> {
        return this.characterUuidsWhere(player, (card) => !!card.hasTrait?.('cavalry'));
    }

    /** Live legality support omitted by serialized summaries. A bowed cavalry
     * mover is useful when it can ready itself, pay I Am Ready from hand, or
     * use an available Shiotome Encampment under its claimed-military-ring
     * condition. The policy then compares that sequence against moving a
     * character which is already ready. */
    private readyAfterMoveCharacterUuids(player: Player): Record<string, true> {
        const result: Record<string, true> = {};
        const characters: any[] = typeof (player as any)?.cardsInPlay?.toArray === 'function'
            ? (player as any).cardsInPlay.toArray().filter((card: any) =>
                (card?.type || card?.getType?.()) === 'character')
            : [];
        const hand: any[] = typeof (player as any)?.hand?.toArray === 'function'
            ? (player as any).hand.toArray()
            : [];
        const hasIAmReady = hand.some((card) => (card?.cardData?.id || card?.id) === 'i-am-ready');
        const hasEncampment = typeof (player as any)?.cardsInPlay?.toArray === 'function' &&
            (player as any).cardsInPlay.toArray().some((card: any) =>
                (card?.cardData?.id || card?.id) === 'shiotome-encampment');
        const hasClaimedMilitaryRing = Object.values((this.game as any)?.rings || {}).some((ring: any) =>
            ring?.isConsideredClaimed?.(player) && ring?.isConflictType?.('military'));

        for(const card of characters) {
            if(!card?.uuid) {
                continue;
            }
            const id = card?.cardData?.id || card?.id;
            if(['moto-outrider', 'twilight-rider'].includes(id) ||
                (hasIAmReady && card?.isFaction?.('unicorn') && (Number(card?.fate) || 0) > 0) ||
                (hasEncampment && hasClaimedMilitaryRing && card?.hasTrait?.('cavalry'))) {
                result[card.uuid] = true;
            }
        }
        return result;
    }

    private characterNumberHint(
        player: Player,
        valueOf: (card: any) => number | undefined
    ): Record<string, number> {
        const values: Record<string, number> = {};
        for(const side of [player, player.opponent]) {
            const cards: any[] = typeof (side as any)?.cardsInPlay?.toArray === 'function'
                ? (side as any).cardsInPlay.toArray()
                : [];
            for(const card of cards) {
                const type = card?.type || card?.getType?.();
                if(type !== 'character' || !card?.uuid) {
                    continue;
                }
                const value = valueOf(card);
                if(value !== undefined) {
                    values[card.uuid] = value;
                }
            }
        }
        return values;
    }

    private opponentDuelBidProfile(player: Player) {
        const opponent = player.opponent;
        if(!opponent) {
            return undefined;
        }
        const ids = this.deckCardIds(opponent);
        if(ids.length === 0) {
            return undefined;
        }
        return resolveDeckProfile(ids, deriveDeckStrategy(ids)).duelBidding;
    }

    private currentDuelMargin(player: Player): number | undefined {
        const skillGap = this.currentDuelGap(player);
        if(skillGap === undefined || !player.opponent) {
            return undefined;
        }
        return skillGap + player.honorBid - player.opponent.honorBid;
    }

    private currentInterruptedEventIsMine(player: Player): boolean | undefined {
        const step = this.currentPromptStep(player);
        const events: any[] = step?.events || step?.window?.events || [];
        const event = events.find((candidate: any) => {
            if(candidate?.name !== 'onInitiateAbilityEffects') {
                return false;
            }
            const source = candidate?.card || candidate?.context?.source;
            const type = source?.type || (typeof source?.getType === 'function' ? source.getType() : undefined);
            return type === 'event';
        });
        const eventPlayer = event?.context?.player || event?.player;
        return eventPlayer?.name ? eventPlayer.name === player.name : undefined;
    }

    // Whether the ability whose effects are about to initiate belongs to US,
    // for any source type. `currentInterruptedEventIsMine` deliberately only
    // looks at event CARDS (Voice of Honor cancels events); a cancel that fires
    // on province abilities — Cursecatcher, Effective Deception — needs to know
    // whose province is talking, or it cancels our own reactions.
    private currentInterruptedAbilityIsMine(player: Player): boolean | undefined {
        const step = this.currentPromptStep(player);
        const events: any[] = step?.events || step?.window?.events || [];
        const event = events.find((candidate: any) => candidate?.name === 'onInitiateAbilityEffects');
        if(!event) {
            return undefined;
        }
        const abilityPlayer = event?.context?.player ||
            (event?.card || event?.context?.source)?.controller;
        return abilityPlayer?.name ? abilityPlayer.name === player.name : undefined;
    }

    // Whose body the leave-play interrupt window is about. Ceaseless Duty's
    // printed text has NO controller clause — Iron Mine and Reprieve both read
    // "a character you control" — so the engine legally offers it when the
    // OPPONENT's character leaves play, and a save spent there keeps THEIR
    // board alive at the cost of our card. Observed live: the bot answered the
    // opponent's fate-phase discard of Meddling Mediator with Ceaseless Duty.
    //
    // Undefined when the window carries no leave-play event, which every gate
    // treats as "not blocked". One window can carry several events, so this is
    // true when ANY of the departing bodies is ours: the ability still has a
    // friendly target to choose.
    private currentLeavingPlayCardIsMine(player: Player): boolean | undefined {
        const step = this.currentPromptStep(player);
        // The window queues its own select prompt, which becomes the current
        // step, so the events live on `game.currentAbilityWindow` by the time
        // the bot is asked. See `currentPlaySource` for the same fallback.
        const events: any[] = step?.events || step?.window?.events ||
            (this.game as any).currentAbilityWindow?.events || [];
        const leaving = events.filter((candidate: any) =>
            candidate?.name === EventNames.OnCardLeavesPlay && !candidate.cancelled && candidate.card);
        if(leaving.length === 0) {
            return undefined;
        }
        return leaving.some((candidate: any) => candidate.card.controller?.name === player.name);
    }

    private recordDisplayOfPowerInitiated(event: any): void {
        const source = event?.card || event?.context?.source;
        const eventPlayer = event?.context?.player || event?.player || source?.controller;
        const conflictUuid = (this.game as any).currentConflict?.uuid;
        if(event?.cancelled || source?.id !== 'display-of-power' ||
            eventPlayer?.name !== this.config.playerName || !conflictUuid) {
            return;
        }
        this.displayOfPowerActive = true;
        this.displayOfPowerConflictUuid = String(conflictUuid);
    }

    private displayOfPowerActiveThisConflict(): boolean {
        const conflictUuid = (this.game as any).currentConflict?.uuid;
        if(!conflictUuid || String(conflictUuid) !== this.displayOfPowerConflictUuid) {
            this.displayOfPowerActive = false;
            this.displayOfPowerConflictUuid = null;
        }
        return this.displayOfPowerActive;
    }

    // The 'Choose additional fate' cost prompt does not expose the printed
    // cost of the character being played in the player state, so read it off
    // the prompt step's source card for the policy's fate curve.
    private currentPlaySource(player: Player): any {
        const step = this.currentPromptStep(player);
        if(step?.properties?.activePromptTitle === 'Choose additional fate') {
            return step.properties?.source;
        }
        const abilityWindow = (this.game as any).currentAbilityWindow;
        return abilityWindow?.playEvent?.context?.source ||
            abilityWindow?.events?.find((event: any) => event.name === 'onAbilityResolverInitiated')?.context?.source ||
            step?.playEvent?.context?.source;
    }

    private currentPlayCost(player: Player): number | undefined {
        const source = this.currentPlaySource(player);
        const rawCost = source?.printedCost ?? source?.cardData?.cost ?? source?.cost;
        const cost = Number(rawCost);
        return Number.isFinite(cost) ? cost : undefined;
    }

    private currentPlayCardId(player: Player): string | undefined {
        const source = this.currentPlaySource(player);
        return source?.cardData?.id || source?.id;
    }

    private conflictPlayPiles(player: Player): any[] {
        // Bayushi Kachiko can make public cards in the opponent's conflict
        // discard directly playable. Include that pile in the same live hint
        // source; the policy still filters candidates through isPlayableByMe.
        return [
            (player as any).hand,
            (player as any).conflictDiscardPile,
            (player as any).opponent?.conflictDiscardPile
        ].filter((pile) => pile && typeof pile.map === 'function');
    }

    // Conflict-card skill values are hidden from player-state summaries
    // (showStats is false outside the play area), so read printed values from
    // all zones that can supply a normal card play.
    private handStatsHint(player: Player): Record<string, { military: number | null; political: number | null }> | undefined {
        const piles = this.conflictPlayPiles(player);
        if(piles.length === 0) {
            return undefined;
        }

        const stats: Record<string, { military: number | null; political: number | null }> = {};
        // A card played from conflict discard has the same printed skill as
        // the same card in hand. Expose both piles so replay selection can use
        // the normal value/contribution path instead of a zone-specific guess.
        for(const pile of piles) {
            for(const card of pile.map((entry: any) => entry)) {
                if(!card?.uuid || !card.cardData) {
                    continue;
                }

                const type = card.getType();
                if(type === 'attachment') {
                    stats[card.uuid] = {
                        military: this.parseStat(card.cardData.military_bonus),
                        political: this.parseStat(card.cardData.political_bonus)
                    };
                } else if(type === 'character') {
                    stats[card.uuid] = {
                        military: this.parseStat(card.cardData.military),
                        political: this.parseStat(card.cardData.political)
                    };
                }
            }
        }

        return stats;
    }

    private parseStat(value: any): number | null {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
    }

    private faceupDynastyCards(player: Player): any[] {
        const getDynastyCards = (player as any).getDynastyCardsInProvince;
        const getProvinceArray = (this.game as any).getProvinceArray;
        if(typeof getDynastyCards !== 'function' || typeof getProvinceArray !== 'function') {
            return [];
        }
        const locations: string[] = getProvinceArray.call(this.game);
        return locations.flatMap((location) => getDynastyCards.call(player, location) || [])
            .filter((card: any) => card?.uuid && card.cardData &&
                typeof card.isFaceup === 'function' && card.isFaceup());
    }

    // What breaking each of the OPPONENT's provinces would deny them, keyed by
    // province location. Faceup dynasty cards in a province are public
    // information, so this is legal for a fair bot — unlike
    // `OmniscientBotCapability.opponentProvinces`, which values the hidden
    // stack too. Same per-card shape as that method so the two rigs agree.
    // `holdingStrength` is separate from `denial` because the two pull opposite
    // ways. A faceup holding is worth discarding, but its province-strength
    // bonus also makes that province harder to break — and for a province still
    // facedown, that bonus is the ONLY strength information either player has.
    private opponentFaceupDynastyDenial(me: Player):
        Record<string, { denial: number; holdingStrength: number }> | undefined {
        const opp = (me as any).opponent as Player | undefined;
        if(!opp) {
            return undefined;
        }
        const result: Record<string, { denial: number; holdingStrength: number }> = {};
        for(const card of this.faceupDynastyCards(opp)) {
            const location = String(card.location || '');
            if(!location) {
                continue;
            }
            const entry = result[location] || (result[location] = { denial: 0, holdingStrength: 0 });
            const type = typeof card.getType === 'function' ? card.getType() : card.type;
            const military = Math.max(0, this.parseStat(card.cardData?.military) ?? 0);
            const political = Math.max(0, this.parseStat(card.cardData?.political) ?? 0);
            entry.denial += type === 'character' ? (military + political) * 0.25
                : type === 'holding' ? 1
                    : 1;
            if(type === 'holding') {
                entry.holdingStrength += Math.max(0,
                    this.parseStat(card.cardData?.strength_bonus) ?? 0);
            }
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }

    // Printed fate cost of each face-up dynasty card in a province, keyed by
    // uuid — the player-state summaries omit it, so the policy cannot otherwise
    // tell whether playing a character would spend the bot's last fate. Used to
    // keep a 1-fate reserve for conflict-phase hand plays.
    private dynastyCostsHint(player: Player): Record<string, number> | undefined {
        const costs: Record<string, number> = {};
        // Rally and other stacking effects can leave several dynasty cards in
        // one province. Flatten every real province slot so each playable card
        // gets its own UUID-keyed cost hint.
        for(const card of this.faceupDynastyCards(player)) {
            const cost = this.parseStat(card.printedCost ?? card.cardData.cost);
            if(cost !== null) {
                costs[card.uuid] = cost;
            }
        }
        return Object.keys(costs).length > 0 ? costs : undefined;
    }

    private dynastyCharacterInfo(player: Player): Record<string, DynastyCharacterInfo> | undefined {
        const result: Record<string, DynastyCharacterInfo> = {};
        for(const card of this.faceupDynastyCards(player)) {
            const type = typeof card.getType === 'function' ? card.getType() : card.type;
            if(type !== 'character') {
                continue;
            }
            const collections = card.abilities || {};
            const abilityCount = ['actions', 'reactions', 'interrupts', 'forcedReactions', 'forcedInterrupts']
                .reduce((sum, key) => sum + (Array.isArray(collections[key]) ? collections[key].length : 0), 0);
            const text = String(card.cardData?.text || '').toLowerCase();
            const strategicTerms = [
                'ready ', 'draw ', 'covert', 'cannot be', 'additional conflict',
                'move ', 'dishonor', 'honor ', 'gain 1 fate', 'place 1 fate'
            ].filter((term) => text.includes(term)).length;
            const statusEffects = typeof card.getEffects === 'function'
                ? card.getEffects(EffectNames.EntersPlayWithStatus)
                : [];
            result[card.uuid] = {
                cost: Math.max(0, this.parseStat(card.printedCost ?? card.cardData?.cost) ?? 0),
                military: Math.max(0, this.parseStat(card.cardData?.military) ?? 0),
                political: Math.max(0, this.parseStat(card.cardData?.political) ?? 0),
                glory: Math.max(0, this.parseStat(card.cardData?.glory) ?? 0),
                abilityValue: Math.min(4, abilityCount * 0.7 + strategicTerms * 0.45),
                honoredOnEntry: Array.isArray(statusEffects) && statusEffects.includes(CharacterStatus.Honored)
            };
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }

    // Printed stats for the cards a handler menu offers as buttons — deck
    // searches, look-at-top-N plays (Kyūden Hida), attachment searches
    // (Illustrious Forge). `PlayerPromptState.setPrompt` serialises the button's
    // card down to its short summary (id, name, type, uuid), so the printed
    // cost and skills are not visible to the policy and it had no basis to rank
    // them. Keyed by uuid, which is the only stable handle the button keeps.
    private menuCardInfo(prompt: any): Record<string, MenuCardInfo> | undefined {
        const buttons: any[] = prompt?.buttons || [];
        const uuids = new Set(buttons
            .map((button) => String(button?.card?.uuid || ''))
            .filter((uuid) => uuid.length > 0));
        if(uuids.size === 0) {
            return undefined;
        }
        const result: Record<string, MenuCardInfo> = {};
        for(const card of ((this.game as any).allCards || []) as any[]) {
            const uuid = String(card?.uuid || '');
            if(!uuids.has(uuid)) {
                continue;
            }
            result[uuid] = {
                cost: Math.max(0, this.parseStat(card.printedCost ?? card.cardData?.cost) ?? 0),
                military: Math.max(0, this.parseStat(card.cardData?.military) ?? 0),
                political: Math.max(0, this.parseStat(card.cardData?.political) ?? 0),
                glory: Math.max(0, this.parseStat(card.cardData?.glory) ?? 0),
                type: String(typeof card.getType === 'function' ? card.getType() : card.type || '')
            };
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }

    private provinceIdsByLocation(player: Player): Record<string, string> | undefined {
        const provinces: any[] = typeof (player as any).getProvinces === 'function'
            ? (player as any).getProvinces()
            : [];
        const ids: Record<string, string> = {};
        for(const province of provinces) {
            const location = String(province?.location || '');
            const id = String(province?.id || province?.cardData?.id || '');
            if(location && id) {
                ids[location] = id;
            }
        }
        return Object.keys(ids).length > 0 ? ids : undefined;
    }

    // Public province state used by reveal/economy tactics. Own facedown ids
    // are known to their controller; opponent facedown ids stay hidden. This
    // exposes counts, live strength, stronghold attackability, and the special
    // Massing-at-Twilight skill rule without granting fair bots secret data.
    private provinceKnowledgeSnapshot(player: Player): ProvinceKnowledgeSnapshot {
        const describe = (owner: Player | undefined, revealHiddenIds: boolean): ProvinceKnowledge[] => {
            const provinces: any[] = typeof (owner as any)?.getProvinces === 'function'
                ? (owner as any).getProvinces()
                : [];
            return provinces.map((province: any) => {
                const faceup = province?.facedown !== true;
                const text = String(province?.cardData?.text || province?.text || '').toLowerCase();
                const abilityClass = !faceup && !revealHiddenIds
                    ? 'unknown'
                    : /after .*revealed|when .*revealed/.test(text)
                        ? 'reveal'
                        : /<b>reaction:|\breaction:/.test(text)
                            ? 'reaction'
                            : /<b>action:|\baction:/.test(text)
                                ? 'action'
                                : 'none';
                const id = faceup || revealHiddenIds
                    ? String(province?.id || province?.cardData?.id || '') || undefined
                    : undefined;
                return {
                    id,
                    location: String(province?.location || ''),
                    owner: String((owner as any)?.name || ''),
                    faceup,
                    broken: !!province?.isBroken,
                    stronghold: province?.location === 'stronghold province',
                    strength: faceup || revealHiddenIds ? this.liveProvinceStrength(province) : undefined,
                    abilityClass
                } as ProvinceKnowledge;
            });
        };
        const opponent = player.opponent;
        const opponentProvinces: any[] = typeof (opponent as any)?.getProvinces === 'function'
            ? (opponent as any).getProvinces()
            : [];
        const opponentStronghold = opponentProvinces.find((province: any) =>
            province?.location === 'stronghold province');
        const conflict: any = (this.game as any).currentConflict;
        const conflictProvinces: any[] = typeof conflict?.getConflictProvinces === 'function'
            ? conflict.getConflictProvinces() || []
            : [];
        return {
            self: describe(player, true),
            opponent: describe(opponent, false),
            opponentStrongholdAttackable: !!opponentStronghold &&
                (typeof opponentStronghold.canBeAttacked === 'function'
                    ? opponentStronghold.canBeAttacked()
                    : false),
            combinedConflictSkills: conflictProvinces.some((province: any) =>
                (province?.id || province?.cardData?.id) === 'massing-at-twilight')
        };
    }

    private conflictCostsHint(player: Player): Record<string, number> | undefined {
        const piles = this.conflictPlayPiles(player);
        if(piles.length === 0) {
            return undefined;
        }
        const costs: Record<string, number> = {};
        for(const pile of piles) {
            for(const card of pile.map((entry: any) => entry)) {
                if(!card?.uuid) {
                    continue;
                }
                const cost = this.parseStat(card.printedCost ?? card.cardData?.cost);
                if(cost !== null) {
                    costs[card.uuid] = cost;
                }
            }
        }
        return Object.keys(costs).length > 0 ? costs : undefined;
    }

    // Does the opponent's deck actually win on the honor track? L5R decklists
    // are public, so this reuses the same strategy detection the bot applies to
    // its own deck rather than guessing from the honor total. Used to bid more
    // conservatively: every point handed to an honor or dishonor deck is
    // ammunition, while against a conquest deck it is just a resource.
    private opponentHasHonorPlan(me: Player): boolean {
        const opp = (me as any).opponent as Player | undefined;
        if(!opp) {
            return false;
        }
        const allCards: any[] = (this.game as any).allCards || [];
        const ids = allCards
            .filter((card: any) => card?.owner === opp && card?.cardData?.id)
            .map((card: any) => String(card.cardData.id));
        if(ids.length === 0) {
            return false;
        }
        const strategy = deriveDeckStrategy(ids) as any;
        return !!(strategy.dishonor || strategy.craneHonor || strategy.lionHonor ||
            strategy.bidWar);
    }

    private drawBidContext(player: Player): DrawBidContext {
        const opponent = (player as any).opponent as Player | undefined;
        const allCards: any[] = (this.game as any).allCards || [];
        const conflictCosts = allCards
            .filter((card: any) => card?.owner === player &&
                (card.isConflict || card.cardData?.side === 'conflict'))
            .map((card: any) => this.parseStat(card.printedCost ?? card.cardData?.cost))
            .filter((cost: number | null): cost is number => cost !== null && cost >= 0);
        const averageConflictCardCost = conflictCosts.length > 0
            ? conflictCosts.reduce((sum, cost) => sum + cost, 0) / conflictCosts.length
            : 1.5;
        const hand: any[] = typeof (player as any).hand?.toArray === 'function'
            ? (player as any).hand.toArray()
            : [];
        const opponentHandCount = typeof (opponent as any)?.hand?.size === 'function'
            ? (opponent as any).hand.size()
            : 0;
        const handCardCosts = hand
            .map((card: any) => this.parseStat(card.printedCost ?? card.cardData?.cost))
            .filter((cost: number | null): cost is number => cost !== null && cost >= 0);
        const inPlay: any[] = typeof (player as any).cardsInPlay?.toArray === 'function'
            ? (player as any).cardsInPlay.toArray()
            : [];
        const characters = inPlay.filter((card: any) =>
            (card?.type || card?.getType?.()) === 'character');
        const numberFrom = (card: any, method: string): number => {
            const value = typeof card?.[method] === 'function' ? card[method]() : 0;
            return typeof value === 'number' && Number.isFinite(value) ? Math.max(value, 0) : 0;
        };
        const provinces: any[] = typeof (player as any).getProvinces === 'function'
            ? (player as any).getProvinces()
            : [];
        const opponentProvinces: any[] = typeof (opponent as any)?.getProvinces === 'function'
            ? (opponent as any).getProvinces()
            : [];
        const brokenOuter = (cards: any[]): number => cards.filter((card) =>
            card?.isBroken && /^province [1-4]$/.test(String(card.location || ''))).length;
        const fateOnUnclaimedRings = Object.values((this.game as any).rings || {})
            .filter((ring: any) => typeof ring?.isUnclaimed === 'function'
                ? ring.isUnclaimed()
                : !ring?.claimedBy)
            .reduce((sum: number, ring: any) => sum + (Number(ring?.fate) || 0), 0);

        return {
            roundNumber: (this.game as any).roundNumber,
            opponentHonorPlan: this.opponentHasHonorPlan(player),
            myHonor: Number((player as any).honor) || 0,
            opponentHonor: Number((opponent as any)?.honor) || 0,
            myHandCount: hand.length,
            opponentHandCount,
            myFate: Number((player as any).fate) || 0,
            opponentFate: Number((opponent as any)?.fate) || 0,
            fateOnUnclaimedRings,
            myBrokenProvinces: brokenOuter(provinces),
            opponentBrokenProvinces: brokenOuter(opponentProvinces),
            averageConflictCardCost,
            handCardCosts,
            // Bidding more than this reshuffles the discard for a flat honor
            // penalty, which the honor rails have to see.
            conflictDeckSize: player.conflictDeck?.size(),
            board: {
                characterCount: characters.length,
                readyCharacterCount: characters.filter((card) => !card.bowed).length,
                persistentCharacterCount: characters.filter((card) => (Number(card.fate) || 0) > 0).length,
                attachmentCount: characters.reduce((sum, card) => sum + (card.attachments?.size?.() ??
                    card.attachments?.length ?? 0), 0),
                totalCharacterFate: characters.reduce((sum, card) => sum + (Number(card.fate) || 0), 0),
                militarySkill: characters.reduce((sum, card) => sum + numberFrom(card, 'getMilitarySkill'), 0),
                politicalSkill: characters.reduce((sum, card) => sum + numberFrom(card, 'getPoliticalSkill'), 0)
            },
            legalBids: [1, 2, 3, 4, 5]
        };
    }

    private isLegalDecision(player: Player, decision: BotDecision): boolean {
        switch(decision.command) {
            case 'menuButton':
                return this.isLegalButton(player.currentPrompt(), decision.args);
            case 'cardClicked':
                return this.isLegalCard(player, decision.args[0]);
            case 'ringClicked':
                return this.isLegalRing(player, decision.args[0]);
            case 'facedownCardClicked':
                return this.isLegalFacedownClick(player, decision.args);
            case 'menuItemClick':
                return this.isLegalCardMenuItem(player, decision.args[0], decision.args[1]);
            case 'ringMenuItemClick':
                return this.isLegalRingMenuItem(player, decision.args[0], decision.args[1]);
            default:
                return false;
        }
    }

    private isLegalButton(prompt: any, args: any[]): boolean {
        const [arg, uuid, method] = args;
        const legalButton = (prompt.buttons || []).some((button: any) => {
            const command = button.command || 'menuButton';
            return !button.disabled &&
                command === 'menuButton' &&
                button.arg === arg &&
                button.uuid === uuid &&
                (button.method || undefined) === (method || undefined);
        });
        if(legalButton) {
            return true;
        }
        // Typed prompt controls (Gossip, Bayushi's Whisperers, Emissary of
        // Lies) submit a free-form value through menuButton and have no button
        // list. Validate the control identity/method and a non-empty value.
        return typeof arg === 'string' && arg.trim().length > 0 &&
            (prompt.controls || []).some((control: any) =>
                control.type === 'card-name' &&
                (control.command || 'menuButton') === 'menuButton' &&
                control.uuid === uuid &&
                (control.method || undefined) === (method || undefined));
    }

    private isLegalCard(player: Player, cardUuid: string): boolean {
        // Conflict declaration, defender selection, and action windows validate
        // clicks through the prompt's own checkCardCondition/onCardClicked path
        // instead of promptState.selectableCards. Prefer that live check before
        // stale prompt-state flags inherited from an earlier selector.
        if(this.isDirectClickPrompt(player.currentPrompt())) {
            const liveLegal = this.currentLegalDirectCardUuids(player);
            if(liveLegal) {
                return !!liveLegal[cardUuid];
            }
            return this.findVisibleCards(this.game.getState(player.name)).some((card) => card.uuid === cardUuid);
        }

        if(player.currentPrompt()?.selectCard !== true) {
            return false;
        }

        return player.promptState.selectableCards.some((card: BaseCard) => card.uuid === cardUuid);
    }

    private currentLegalDirectCardUuids(player: Player): Record<string, true> | undefined {
        if(!this.isDirectClickPrompt(player.currentPrompt())) {
            return undefined;
        }
        const step = this.currentPromptStep(player);
        const checker = typeof step?.canClickCard === 'function'
            ? (card: any) => step.canClickCard(player, card)
            : typeof step?.checkCardCondition === 'function'
                ? (card: any) => step.checkCardCondition(card)
                : null;
        if(!checker) {
            return undefined;
        }

        const legal: Record<string, true> = {};
        const visible = this.findVisibleCards(this.game.getState(player.name));
        for(const summary of visible) {
            if(!summary?.uuid) {
                continue;
            }
            const card = (this.game as any).findAnyCardInAnyList(summary.uuid);
            if(!card) {
                continue;
            }
            try {
                if(!checker(card)) {
                    continue;
                }
                const hint: any = getPlaybookEntry(card.cardData?.id, this.currentDeckStrategy(player));
                const preferredSide = hint?.attachSide || hint?.targetSide;
                if(hint?.requiresPreferredTarget &&
                    (preferredSide === 'self' || preferredSide === 'enemy') &&
                    typeof step?.canClickCardForTargetSide === 'function' &&
                    !step.canClickCardForTargetSide(player, card, preferredSide)) {
                    continue;
                }
                legal[summary.uuid] = true;
            } catch{
                // A custom prompt checker may require state not exposed here;
                // omit that card and let the normal pass/fallback advance.
            }
        }
        return legal;
    }

    private isDirectClickPrompt(prompt: any): boolean {
        const text = `${prompt?.promptTitle || ''} ${prompt?.menuTitle || ''}`.toLowerCase();
        return text.includes('initiate conflict') ||
            text.includes('conflict') && (text.includes('choose attackers') || text.includes('choose defenders') || text.includes('choose province') || text.includes('covert') || text.includes('skill:')) ||
            text.includes('declaring defenders') ||
            text.includes('initiate an action') ||
            text.includes('play cards from provinces') ||
            text.includes('conflict action window');
    }


    private isLegalFacedownClick(player: Player, args: any[]): boolean {
        const [location, controllerName, isProvince] = args;
        if(typeof location !== 'string' || isProvince !== true) {
            return false;
        }

        if(!/^(province [1-4]|stronghold province)$/.test(location)) {
            return false;
        }

        if(!this.game.getPlayerByName(controllerName)) {
            return false;
        }

        // Select prompts list the real game objects: a facedown province in
        // the selectable set is a legal click even though the bot's state
        // view hides its uuid.
        if(player.promptState.selectableCards.some((card: any) =>
            card.location === location && (card as any).controller?.name === controllerName)) {
            return true;
        }

        return this.isDirectClickPrompt(player.currentPrompt());
    }

    private isLegalRing(player: Player, ringElement: string): boolean {
        return player.promptState.selectableRings.some((ring: Ring) => ring.element === ringElement);
    }

    private currentLegalRingElements(player: Player): Record<string, true> | undefined {
        if(player.currentPrompt()?.selectRing !== true) {
            return undefined;
        }

        const legal: Record<string, true> = {};
        for(const ring of player.promptState.selectableRings || []) {
            if(ring?.element) {
                legal[ring.element] = true;
            }
        }
        return legal;
    }

    private isLegalCardMenuItem(player: Player, cardUuid: string, menuItem: any): boolean {
        const card = this.findVisibleCards(this.game.getState(player.name)).find((candidate) => candidate.uuid === cardUuid);
        return !!card && (card.menu || []).some((item: any) => this.sameMenuItem(item, menuItem));
    }

    private isLegalRingMenuItem(player: Player, sourceRing: any, menuItem: any): boolean {
        const ring = this.game.getState(player.name)?.rings?.[sourceRing?.element];
        return !!ring && (ring.menu || []).some((item: any) => this.sameMenuItem(item, menuItem));
    }

    private sameMenuItem(expected: any, actual: any): boolean {
        return !!expected &&
            !!actual &&
            expected.command === actual.command &&
            expected.text === actual.text;
    }

    private findVisibleCards(root: any): any[] {
        const cards: any[] = [];
        const visit = (value: any) => {
            if(!value || typeof value !== 'object') {
                return;
            }

            if(value.uuid && (value.type || value.facedown || value.location)) {
                cards.push(value);
            }

            if(Array.isArray(value)) {
                value.forEach(visit);
            } else {
                Object.values(value).forEach(visit);
            }
        };

        visit(root);
        return cards;
    }

    private record(prompt: any, decision: BotDecision | null, result: BotTraceEntry['result'], reason: string): void {
        if(this.engine.lastDecisionTrace?.decision === decision) {
            this.engine.observeDecision?.(result, reason);
        }
        if(this.config.trace === false) {
            return;
        }

        this.trace.push({
            player: this.config.playerName,
            promptTitle: prompt?.promptTitle,
            menuTitle: prompt?.menuTitle,
            command: decision?.command,
            args: decision?.args,
            target: decision?.target,
            cardId: decision?.cardId,
            cardType: decision?.cardType,
            cardSide: decision?.cardSide,
            cardLocation: decision?.cardLocation,
            cardController: decision?.cardController,
            cardOwner: decision?.cardOwner,
            engineVersion: this.identity.engineVersion,
            strategySeed: this.identity.strategySeed,
            informationMode: this.identity.informationMode,
            deckProfile: this.identity.deckProfile,
            configurationHash: this.identity.configurationHash,
            selectedBy: this.engine.lastDecisionTrace?.selectedBy,
            fallbackReason: this.engine.lastDecisionTrace?.fallbackReason,
            v2Mode: this.engine.lastDecisionTrace?.v2Mode,
            durationMs: this.engine.lastDecisionTrace?.durationMs,
            planner: this.engine.lastDecisionTrace?.planner,
            seedState: this.engine.seedState,
            result,
            reason
        });
    }
}

export = JigokuBotController;
