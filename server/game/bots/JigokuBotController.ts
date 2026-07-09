import JigokuBotPolicy from './JigokuBotPolicy.js';
import LmStudioClient from './llm/LmStudioClient.js';
import DeckHintService from './llm/DeckHintService.js';
import LiveConsultant from './llm/LiveConsultant.js';
import LlmActionPlanner from './llm/LlmActionPlanner.js';
import type { ActionOption } from './llm/LlmActionPlanner';
import { getPlaybookEntry, deriveDeckStrategy } from './CardPlaybook.js';
import type { DeckStrategy } from './CardPlaybook';
import { resolveDeckProfile } from './DeckProfiles.js';
import type { DeckProfile } from './DeckProfiles';
import { getCardModel } from './DeckAnalysis.js';
import type { KnownCard, OmniProvince, Omniscient } from './DeckAnalysis';
import { stateFeatures, optionFeatures } from './ml/features.js';
import type { MoveEvaluator } from './ml/evaluator';
import { logger } from '../../logger.js';
import type Game from '../game';
import type Player from '../player';
import type Ring from '../ring';
import type BaseCard from '../basecard';
import type { JigokuBotConfig } from './JigokuBotConfig';

interface BotDecision {
    command: 'menuButton' | 'cardClicked' | 'ringClicked' | 'menuItemClick' | 'ringMenuItemClick' | 'facedownCardClicked';
    args: any[];
    target?: string;
    reason: string;
}

interface BotTraceEntry {
    player: string;
    promptTitle?: string;
    menuTitle?: string;
    command?: string;
    args?: any[];
    target?: string;
    seedState: number;
    result: 'success' | 'rejected' | 'unsupported';
    reason: string;
}

type CommandRunner = (command: string, playerName: string, args: any[]) => boolean;

// Per-decision training record for the seed-3 learned evaluator. Captures the
// position + every legal option (as feature vectors) + which one was taken, so
// an offline trainer can assign a return to each and learn to score options.
interface DecisionRecord {
    player: string;
    round: number;
    promptTitle?: string;
    menuTitle?: string;
    stateSchema: string[];
    state: number[];
    optionSchema: string[];
    options: number[][];
    optionLabels: string[];
    chosenIndex: number;
    chosenReason: string;
}

type DecisionRecorder = (record: DecisionRecord) => void;

class JigokuBotController {
    readonly trace: BotTraceEntry[] = [];
    private policy: JigokuBotPolicy;
    private ticking = false;
    private hintService?: DeckHintService;
    private consultant?: LiveConsultant;
    private planner?: LlmActionPlanner;
    private onStateChange?: () => void;
    private recorder?: DecisionRecorder;
    private evaluator?: MoveEvaluator;
    private evalAttempted = new Set<string>();
    private evalAttemptedSignature = '';
    private consultPending: string | null = null;
    private warmupStarted = false;
    private recentExhaustSignatures: string[] = [];
    private consecutiveExhaustions = 0;
    private deckStrategy?: DeckStrategy;

    constructor(private game: Game, readonly config: JigokuBotConfig, private runCommand: CommandRunner,
        services: { hintService?: DeckHintService; consultant?: LiveConsultant; planner?: LlmActionPlanner; onStateChange?: () => void; recorder?: DecisionRecorder; evaluator?: MoveEvaluator } = {}) {
        this.policy = new JigokuBotPolicy(config.seed || 1);
        this.onStateChange = services.onStateChange;
        this.recorder = services.recorder;
        this.evaluator = services.evaluator;

        if(config.llm?.enabled) {
            const client = new LmStudioClient({ baseUrl: config.llm.baseUrl, model: config.llm.model });
            this.hintService = services.hintService || new DeckHintService(client, {
                cacheDir: config.llm.cacheDir,
                onWarn: (message) => this.game.addMessage(`${config.playerName}: ${message}`)
            });
            if(config.llm.liveConsult) {
                this.consultant = services.consultant || new LiveConsultant(client);
            }
            this.planner = services.planner || new LlmActionPlanner(client);
        } else {
            this.hintService = services.hintService;
            this.consultant = services.consultant;
            this.planner = services.planner;
        }
    }

    // Seed 2 is the LLM-driven brain: at every step the model chooses among the
    // legal moves, with the heuristic policy demoted to a guide/fall-back. Any
    // other seed keeps the heuristic policy in charge (seed 1). Needs an LLM
    // planner; without one the bot silently stays on the heuristic policy.
    private isLlmDriven(): boolean {
        return (this.config.seed === 2 || this.config.seed === '2') && !!this.planner;
    }

    // Seed 3 is the learned-evaluator brain: the self-play-trained model scores
    // every legal move and the bot takes the argmax. Unlike seed 2 this is a
    // synchronous in-process dot/tree walk — no round trip, no break/resume.
    // Needs a loaded evaluator; without one the seat stays on the heuristic.
    private isEvaluatorDriven(): boolean {
        return (this.config.seed === 3 || this.config.seed === '3') && !!this.evaluator;
    }

    // Seed 4 is the omniscient (cheating) brain: it keeps the whole seed-1
    // heuristic but is fed the human's true hand, fate and face-down province
    // strengths so the policy can target the weakest province, size an attack to
    // beat exactly what the human can afford to defend with, press when they
    // cannot fight back, and hold a conflict it cannot win. No LLM, no model —
    // just perfect information layered onto the heuristic.
    private isOmniscient(): boolean {
        return this.config.seed === 4 || this.config.seed === '4';
    }

    // Translate one live card the human holds into the model the policy reasons
    // over. Skill/cost come from the live object (exact for ANY deck); the
    // curated registry overlays what the object cannot express — an event's
    // conflict swing, an attachment's granted skill, the effect tag.
    private knownCard(card: any): KnownCard {
        const model = getCardModel(card.id);
        const type: string = card.type || (typeof card.getType === 'function' ? card.getType() : '') || '';
        const side = card.isConflict ? 'conflict' : card.isDynasty ? 'dynasty' : (model?.side || '');
        const cost = Number(typeof card.getCost === 'function' ? card.getCost() : card.printedCost);
        const mil = type === 'character' && typeof card.getMilitarySkill === 'function' ? card.getMilitarySkill() : 0;
        const pol = type === 'character' && typeof card.getPoliticalSkill === 'function' ? card.getPoliticalSkill() : 0;
        return {
            id: card.id,
            type,
            side,
            fate: isNaN(cost) ? (model?.fate ?? 0) : Math.max(cost, 0),
            mil: Math.max(Number(mil) || 0, 0),
            pol: Math.max(Number(pol) || 0, 0),
            milBonus: model?.milBonus ?? 0,
            polBonus: model?.polBonus ?? 0,
            swing: model?.swing ?? 0,
            tag: model?.tag ?? 'utility'
        };
    }

    // The true strength of every one of the human's provinces, including the
    // face-down ones a fair bot cannot see.
    private opponentProvinces(opp: Player): OmniProvince[] {
        const out: OmniProvince[] = [];
        const provinces: any[] = typeof (opp as any).getProvinces === 'function' ? (opp as any).getProvinces() : [];
        for(const card of provinces) {
            if(!card || card.isProvince === false) {
                continue;
            }
            out.push({
                location: card.location || '',
                name: card.name || card.id || '',
                strength: typeof card.getStrength === 'function' ? Number(card.getStrength()) || 0 : 0,
                broken: !!card.isBroken,
                facedown: !!card.facedown
            });
        }
        return out;
    }

    // Assemble the seed-4 cheat view from the live opponent Player. Recomputed
    // each tick (cheap) so it always reflects the current hand/fate/board.
    private buildOmniscient(me: Player): Omniscient | undefined {
        if(!this.isOmniscient()) {
            return undefined;
        }
        const opp = (me as any).opponent as Player | undefined;
        if(!opp) {
            return undefined;
        }
        const handCards: any[] = typeof (opp as any).hand?.toArray === 'function' ? (opp as any).hand.toArray() : [];
        const oppHand = handCards.map((card) => this.knownCard(card));
        const unmodeledEvents = Array.from(new Set(
            oppHand.filter((card) => card.type === 'event' && !getCardModel(card.id)).map((card) => card.id)
        ));
        return {
            oppName: (opp as any).name,
            oppFate: Number((opp as any).fate) || 0,
            oppHand,
            oppProvinces: this.opponentProvinces(opp),
            unmodeledEvents
        };
    }

    // One-time deck-analysis gate for seed 4 (satisfies "analyze the deck before
    // the omniscient bot works"). Scans the human's whole deck for conflict
    // events with no curated model and reports coverage. The bot still plays if
    // some events are unmodeled — it is simply blind to those specific tricks.
    private omniscientGateChecked = false;
    private ensureDeckAnalyzed(me: Player): void {
        if(this.omniscientGateChecked || !this.isOmniscient()) {
            return;
        }
        const opp = (me as any).opponent as Player | undefined;
        if(!opp) {
            return;
        }
        this.omniscientGateChecked = true;
        const allCards: any[] = (this.game as any).allCards || [];
        const oppEventIds = Array.from(new Set(allCards
            .filter((card: any) => card.owner === opp && card.type === 'event' && card.cardData?.id)
            .map((card: any) => card.cardData.id)));
        const missing = oppEventIds.filter((id) => !getCardModel(id));
        if(oppEventIds.length === 0) {
            return;
        }
        if(missing.length === 0) {
            this.game.addMessage(`${this.config.playerName} (omniscient) has analyzed the opponent deck: all ${oppEventIds.length} conflict events modeled.`);
        } else {
            logger.info(`Bot ${this.config.playerName} omniscient: ${missing.length}/${oppEventIds.length} opponent events unmodeled: ${missing.join(', ')}`);
            this.game.addMessage(`${this.config.playerName} (omniscient) is blind to ${missing.length} unanalyzed opponent card(s); add them to DeckAnalysis for full strength.`);
        }
    }

    // Prompts where a move choice is genuinely strategic and safe for the
    // evaluator to steer: conflict declaration (ring/type/province/attackers),
    // defender assignment, the conflict action window, and dynasty character
    // plays. Everything else — confirms ("are you sure"), fate-cost sub-prompts,
    // imperial favor, ability targets, setup, mulligan, bids — is left to the
    // heuristic. Narrowing the surface this way keeps the evaluator from
    // fighting the heuristic's control flow (which caused confirm-prompt
    // oscillation loops) and keeps games short.
    private isStrategicPrompt(prompt: any): boolean {
        const phase = (this.game as any).currentPhase;
        if(phase !== 'conflict' && phase !== 'dynasty') {
            return false;
        }
        const title = `${prompt?.promptTitle || ''} ${prompt?.menuTitle || ''}`.toLowerCase();
        if(title.includes('are you sure') || title.includes('additional fate') || title.includes('imperial favor')) {
            return false;
        }
        // Deliberately NARROW: only the high-level "which conflict / where to
        // attack / how to defend" choices. Attacker commitment ("choose
        // attackers") and the conflict action window are left to the heuristic —
        // the evaluator under-commits there and neuters the deck's all-in
        // aggression (it broke ~0 provinces when it drove those). The heuristic
        // all-ins correctly; the evaluator refines ring/type, target province,
        // and defense.
        return title.includes('elemental ring') ||
            title.includes('choose province') ||
            title.includes('choose attackers') ||
            title.includes('choose defenders');
    }

    // Ticks resumed from an async context — LLM consult callbacks and the
    // self-scheduled budget-exhaustion follow-ups — run outside the human
    // command path (GameServer.onGameMessage) that normally broadcasts state
    // after the bot acts. Without pushing state here the human's board freezes
    // at the last human command while the bot silently plays on (seed 2 makes
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
            .replace(/(?:military|political)\s+\w+\s+conflict/gi, 'CONFLICT');
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
        if(this.consultPending) {
            logger.info(`Bot ${this.config.playerName} tick skipped, consult pending for '${this.consultPending}'`);
            return false;
        }

        this.ensureWarmup();
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
                this.ensureDeckAnalyzed(player);
                let decision = this.policy.decide(this.game.getState(player.name), player.name, {
                    roundNumber: (this.game as any).roundNumber,
                    targetHint: targetHint,
                    playCost: this.currentPlayCost(player),
                    handStats: this.handStatsHint(player),
                    // Hand-written playbook knowledge outranks the cached LLM
                    // analysis for the same card.
                    cardHint: (cardId: string) => getPlaybookEntry(cardId) || this.hintService?.getHint(cardId),
                    strategy: this.currentDeckStrategy(player),
                    profile: this.currentDeckProfile(player),
                    // Seed 4 only: the cheat view (human hand/fate/true province
                    // strengths). Undefined for every other seed, so the policy's
                    // omniscient branches stay dormant and seed 1 is unchanged.
                    omniscient: this.buildOmniscient(player)
                });

                // Seed 2: let the LLM choose the move. Whenever the step is a
                // real choice (more than one legal option), hand the whole
                // option set to the model and break to resolve it asynchronously
                // — the heuristic decision rides along as the labelled fall-back.
                // Forced/single-option steps skip the model and run the
                // heuristic pick directly so trivial clicks stay fast.
                if(this.isLlmDriven()) {
                    const options = this.enumerateOptions(player, beforePrompt, decision);
                    if(options.length >= 2) {
                        this.startActionConsult(player, beforePrompt, options, decision);
                        break;
                    }
                    // Exactly one legal move: take it, even if the raw heuristic
                    // decision was something the game would reject here (a stray
                    // ring click at the province-setup prompt loops otherwise).
                    if(options.length === 1) {
                        decision = options[0].decision;
                    }
                }

                // Seed 3: the learned evaluator scores every legal move and the
                // bot takes the argmax. Synchronous, so it just replaces the
                // decision and falls through to the normal execute path. The
                // heuristic pick rides along as the enumerator fall-back, so a
                // degenerate model can never produce an illegal move.
                // Seed 3 only steers the phases where choices carry strategic
                // weight (conflict and dynasty). Setup, mulligan, bidding and
                // the end-of-round phases are left to the heuristic — the
                // evaluator adds no value there and the setup province prompts
                // are shaped in ways it cannot satisfy (it would stall).
                if(this.isEvaluatorDriven() && this.isStrategicPrompt(beforePrompt)) {
                    const options = this.enumerateOptions(player, beforePrompt, decision);
                    if(options.length >= 1) {
                        decision = this.evaluatorPick(player, beforePrompt, options) || decision;
                    }
                }

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

                // An ability-target pick that came from an assumption instead
                // of knowledge — the generic 'choose-card' fall-through or a
                // 'guessed-' polarity — goes to the LLM (async) with the
                // heuristic pick as the timeout fallback. Prompts without a
                // target hint (setup, province order, ...) and picks backed by
                // classified actions or card hints skip the model round trip.
                const consultable = decision.reason === 'choose-card' || decision.reason.startsWith('guessed-');
                if(!this.isLlmDriven() && this.consultant && targetHint && decision.command === 'cardClicked' && consultable) {
                    this.startConsult(player, beforePrompt, decision);
                    break;
                }

                // Training-data capture (only when a recorder is attached, i.e.
                // self-play): log the position + all legal options + the choice
                // BEFORE executing, so features reflect the pre-move state.
                if(this.recorder) {
                    this.recordDecision(player, beforePrompt, decision);
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

    // Kick off deck analysis on the first tick after the game initialises.
    // Fire-and-forget: hints fill in progressively while the game runs.
    private ensureWarmup(): void {
        if(this.warmupStarted || !this.hintService) {
            return;
        }
        const player = this.player;
        const allCards: any[] = (this.game as any).allCards || [];
        if(!player || allCards.length === 0) {
            return;
        }
        this.warmupStarted = true;

        // Cards with a hand-written playbook entry never need model analysis.
        const cards = allCards
            .filter((card: any) => card.owner === player && card.cardData?.id && !getPlaybookEntry(card.cardData.id))
            .map((card: any) => ({
                id: card.cardData.id,
                name: card.cardData.name,
                type: card.getType(),
                text: card.cardData.text,
                cost: card.cardData.cost,
                military: card.cardData.military,
                political: card.cardData.political,
                militaryBonus: card.cardData.military_bonus,
                politicalBonus: card.cardData.political_bonus,
                strength: card.cardData.strength,
                element: card.cardData.element
            }));
        if(cards.length === 0) {
            return;
        }

        const model = this.config.llm?.model || 'local model';
        const deckKey = this.config.deckId;

        // Fully analyzed deck (manifest keyed by import URL / deck id): load
        // everything from cache with zero model traffic.
        if(deckKey && this.hintService.hasCompleteDeck(deckKey, cards)) {
            this.game.addMessage(`${this.config.playerName} card hints loaded from cache (${cards.length} cards, no analysis needed)`);
            logger.info(`Bot ${this.config.playerName} deck '${deckKey}' fully cached, skipping analysis`);
            return;
        }

        const prep = this.hintService.prepare(cards);
        if(prep.pending.length === 0) {
            this.game.addMessage(`${this.config.playerName} card hints loaded from cache (${prep.cached} cards, no analysis needed)`);
            logger.info(`Bot ${this.config.playerName} all ${prep.cached} cards cached, skipping analysis`);
            // Backfill the deck manifest so the next game takes the fast path.
            this.hintService.analyzeCards(cards, deckKey).catch(() => {});
            return;
        }

        this.game.addMessage(`${this.config.playerName} is analyzing ${prep.pending.length} new deck cards with ${model} (${prep.cached} already cached; runs in background)`);
        logger.info(`Bot ${this.config.playerName} deck analysis started: ${prep.pending.length} pending, ${prep.cached} cached, model ${model}`);
        this.hintService.analyzeCards(cards, deckKey).then((stats) => {
            logger.info(`Bot ${this.config.playerName} deck analysis finished: ${JSON.stringify(stats)}`);
            if(!stats.stopped) {
                const skipped = stats.skipped > 0 ? `, ${stats.skipped} skipped` : '';
                this.game.addMessage(`${this.config.playerName} card analysis ready: ${stats.analyzed} analyzed, ${stats.fromCache} from cache${skipped}`);
            }
        }).catch((err) => {
            logger.error(`Bot ${this.config.playerName} deck analysis crashed: ${err?.stack || err}`);
        });
    }

    // Score every enumerated option with the learned evaluator and return the
    // argmax option's decision. Two safeguards make it usable:
    //  - anti-loop: options already tried at the current prompt are excluded, so
    //    a move the model loves but that does not advance the turn is not picked
    //    forever; when everything has been tried, an advance button (initiate /
    //    done / pass) is forced so the game always progresses.
    //  - exploration: with probability config.explore a random legal move is
    //    taken instead of the argmax, so self-play data covers moves the greedy
    //    model would never choose (needed for the model to learn their value).
    // Falls back to null (caller keeps the heuristic decision) on any error.
    private evaluatorPick(player: Player, prompt: any, options: Array<{ id: string; label: string; decision: BotDecision }>): BotDecision | null {
        const evaluator = this.evaluator;
        if(!evaluator || options.length === 0) {
            return null;
        }

        const key = (d: BotDecision) => `${d.command}:${JSON.stringify(d.args)}`;
        const signature = this.stableSignature(prompt);
        if(signature !== this.evalAttemptedSignature) {
            this.evalAttemptedSignature = signature;
            this.evalAttempted.clear();
        }

        // The evaluator gets a bounded number of tries to steer a single prompt;
        // after that the heuristic takes over so the turn always advances (the
        // model scores static win-probability and does not understand game
        // flow, so left unchecked it re-picks non-advancing moves and stalls).
        // The heuristic is always present as the appended fall-back option.
        const fresh = options.filter((option) => !this.evalAttempted.has(key(option.decision)));
        if(this.evalAttempted.size >= 3 || fresh.length === 0) {
            const heuristic = options.find((option) => /heuristic suggestion/i.test(option.label));
            const advance = heuristic || options.find((option) => /^button:.*(initiate|done|pass)/i.test(option.label)) || options[options.length - 1];
            this.evalAttempted.add(key(advance.decision));
            return { ...advance.decision, reason: 'eval-defer-heuristic' };
        }

        try {
            let chosen: { id: string; label: string; decision: BotDecision };
            const explore = this.config.explore || 0;
            if(explore > 0 && Math.random() < explore) {
                chosen = fresh[Math.floor(Math.random() * fresh.length)];
            } else {
                const state = this.game.getState(player.name);
                const round = (this.game as any).roundNumber || 0;
                const inputs = fresh.map((option) => ({ ...option.decision, label: option.label }));
                const index = evaluator.pick(state, player.name, inputs, round);
                chosen = index >= 0 && index < fresh.length ? fresh[index] : fresh[0];
            }
            this.evalAttempted.add(key(chosen.decision));
            return { ...chosen.decision, reason: `eval:${chosen.decision.reason}` };
        } catch(err: any) {
            logger.error(`Bot ${this.config.playerName} evaluator pick failed: ${err?.stack || err}`);
        }
        return null;
    }

    // Emit one training record for a chosen decision: the position features,
    // every legal option as features, and the index of the option taken. Only
    // real choices (>=2 legal options) are logged — a forced single click
    // teaches nothing about ranking moves. The chosen decision is passed as the
    // enumerator fallback so it always appears as an option.
    private recordDecision(player: Player, prompt: any, decision: BotDecision): void {
        const recorder = this.recorder;
        if(!recorder) {
            return;
        }
        const options = this.enumerateOptions(player, prompt, decision);
        if(options.length < 2) {
            return;
        }
        const state = this.game.getState(player.name);
        const key = (d: BotDecision) => `${d.command}:${JSON.stringify(d.args)}`;
        const chosenKey = key(decision);
        let chosenIndex = options.findIndex((option) => key(option.decision) === chosenKey);
        if(chosenIndex < 0) {
            chosenIndex = options.length - 1; // fallback option is the heuristic pick
        }
        const sf = stateFeatures(state, player.name, (this.game as any).roundNumber);
        const optionVectors = options.map((option) => optionFeatures(state, player.name, { ...option.decision, label: option.label }));
        try {
            recorder({
                player: player.name,
                round: (this.game as any).roundNumber || 0,
                promptTitle: prompt?.promptTitle,
                menuTitle: prompt?.menuTitle,
                stateSchema: sf.schema,
                state: sf.values,
                optionSchema: optionVectors[0] ? optionVectors[0].schema : [],
                options: optionVectors.map((vector) => vector.values),
                optionLabels: options.map((option) => option.label),
                chosenIndex,
                chosenReason: decision.reason
            });
        } catch(err: any) {
            logger.error(`Bot ${this.config.playerName} decision recorder failed: ${err?.stack || err}`);
        }
    }

    private startConsult(player: Player, prompt: any, fallback: BotDecision): void {
        const signature = `${prompt?.promptTitle || ''}|${prompt?.menuTitle || ''}`;
        this.consultPending = signature;

        const state = this.game.getState(player.name);
        const me = state?.players?.[player.name];
        const candidates = this.consultCandidates(state, me);
        const question = `${prompt?.promptTitle || ''} — ${prompt?.menuTitle || ''}`.trim();
        const timeoutMs = this.config.llm?.consultTimeoutMs || 120000;

        logger.info(`Bot ${this.config.playerName} consulting LLM for '${question}' (${candidates.length} candidates)`);
        const timeout = new Promise<string | null>((resolve) => setTimeout(() => resolve(null), timeoutMs + 500));
        const consult = this.consultant.chooseTarget(question, this.consultSummary(state, me), candidates, timeoutMs)
            .catch((err) => {
                logger.info(`Bot ${this.config.playerName} consult failed (${err?.message || err}), using heuristic fallback`);
                return null;
            });

        Promise.race([consult, timeout]).then((uuid) => {
            this.consultPending = null;
            try {
                logger.info(`Bot ${this.config.playerName} consult result: ${uuid || 'fallback'}`);
                const current = this.player?.currentPrompt();
                const currentSignature = `${current?.promptTitle || ''}|${current?.menuTitle || ''}`;
                if(currentSignature !== signature) {
                    // The prompt changed while we were thinking; just resume.
                    this.resumeTick();
                    return;
                }

                const decision: BotDecision = uuid
                    ? { command: 'cardClicked', args: [uuid], target: uuid, reason: 'llm-consult' }
                    : fallback;
                const accepted = this.executeDecision(decision);
                if(!accepted) {
                    logger.info(`Bot ${this.config.playerName} consult decision not accepted: ${decision.command} ${JSON.stringify(decision.args)}`);
                }
                if(accepted) {
                    this.game.continue();
                }
                this.resumeTick();
            } catch(err: any) {
                // An engine error here must never silently freeze the seat.
                logger.error(`Bot ${this.config.playerName} consult resolution failed: ${err?.stack || err}`);
                setTimeout(() => this.resumeTick(), 10);
            }
        }).catch((err: any) => {
            this.consultPending = null;
            logger.error(`Bot ${this.config.playerName} consult chain failed: ${err?.stack || err}`);
            setTimeout(() => this.resumeTick(), 10);
        });
    }

    private consultCandidates(state: any, me: any): any[] {
        const myUuids = new Set(this.findVisibleCards(me).map((card) => card.uuid));
        return this.findVisibleCards(state)
            .filter((card) => card.selectable && card.uuid)
            .map((card) => ({
                uuid: card.uuid,
                name: card.name,
                type: card.type,
                side: myUuids.has(card.uuid) ? 'mine' : 'theirs',
                military: card.militarySkillSummary?.stat,
                political: card.politicalSkillSummary?.stat,
                fate: card.fate,
                bowed: card.bowed,
                inConflict: card.inConflict
            }));
    }

    private consultSummary(state: any, me: any): any {
        const players = state?.players || {};
        const opponentName = Object.keys(players).find((name) => players[name] !== me);
        const opponent = opponentName ? players[opponentName] : null;
        const conflict = state?.conflict;
        return {
            phase: me?.phase,
            round: (this.game as any).roundNumber,
            conflict: conflict && conflict.type ? {
                type: conflict.type,
                attackerSkill: conflict.attackerSkill,
                defenderSkill: conflict.defenderSkill,
                botIsAttacker: conflict.attackingPlayerId === me?.id
            } : null,
            bot: { honor: me?.stats?.honor, fate: me?.stats?.fate, prompt: me?.promptTitle, menu: me?.menuTitle },
            opponent: opponent ? { honor: opponent.stats?.honor, fate: opponent.stats?.fate } : null
        };
    }

    // ==================================================================
    // Seed 2 — LLM-driven move selection.
    // ==================================================================

    // Every legal move for the current prompt as {id,label,decision} triples.
    // Buttons, selectable rings, selectable/clickable cards and opponent
    // provinces all become options; each is validated through the same legality
    // gate the executor uses, and the heuristic pick is appended as a labelled
    // fall-back so at least one option is always executable.
    private enumerateOptions(player: Player, prompt: any, fallback: BotDecision | null): Array<{ id: string; label: string; decision: BotDecision }> {
        const state = this.game.getState(player.name);
        const me = state?.players?.[player.name];
        const options: Array<{ id: string; label: string; decision: BotDecision }> = [];
        const seen = new Set<string>();
        const add = (decision: BotDecision | null, label: string) => {
            if(!decision || options.length >= 40) {
                return;
            }
            const key = `${decision.command}:${JSON.stringify(decision.args)}`;
            if(seen.has(key) || !this.isLegalDecision(player, decision)) {
                return;
            }
            seen.add(key);
            options.push({ id: String(options.length), label: label, decision: decision });
        };

        for(const button of (me?.buttons || []).filter((b: any) => !b.disabled)) {
            add({ command: 'menuButton', args: [button.arg, button.uuid, button.method], target: button.text, reason: 'llm-button' }, `Button: ${button.text}`);
        }
        for(const ring of (player.promptState.selectableRings || [])) {
            add({ command: 'ringClicked', args: [ring.element], target: ring.element, reason: 'llm-ring' }, `Ring: ${ring.element}`);
        }
        this.collectCardOptions(player, state, me, prompt, add);

        if(fallback) {
            add(fallback, `Heuristic suggestion (${fallback.target || fallback.reason})`);
        }
        return options;
    }

    private collectCardOptions(player: Player, state: any, me: any, prompt: any, add: (decision: BotDecision | null, label: string) => void): void {
        const players = state?.players || {};
        const meName = me?.name;
        const myUuids = new Set(this.findVisibleCards(me).map((card) => card.uuid));
        const directClick = this.isDirectClickPrompt(prompt);
        const sideOf = (card: any) => myUuids.has(card.uuid) ? 'mine' : 'opponent';

        // Cards the prompt already flags selectable (select prompts populate
        // this on both sides of the board from the bot's perspective).
        for(const card of this.findVisibleCards(state)) {
            if(card.selectable && card.uuid) {
                add({ command: 'cardClicked', args: [card.uuid], target: card.name || card.uuid, reason: 'llm-card' }, this.describeCardLabel(card, sideOf(card)));
            }
        }

        // Provinces (own + opponent): selectable ones from any prompt, plus the
        // opponent's unbroken provinces in a direct-click attack window.
        for(const name of Object.keys(players)) {
            const owner = players[name];
            const side = name === meName ? 'mine' : 'opponent';
            const lists = ['one', 'two', 'three', 'four']
                .map((key) => owner?.provinces?.[key] || [])
                .concat([owner?.strongholdProvince || []]);
            for(const list of lists) {
                for(const province of (list || [])) {
                    if(!province || province.isBroken || province.type === 'stronghold') {
                        continue;
                    }
                    const allow = province.selectable || (directClick && side === 'opponent' && (province.isProvince || province.facedown));
                    if(!allow) {
                        continue;
                    }
                    if(province.uuid) {
                        add({ command: 'cardClicked', args: [province.uuid], target: province.name || province.uuid, reason: 'llm-card' }, `${side} province ${province.name || province.uuid}`);
                    } else if(province.location) {
                        add({ command: 'facedownCardClicked', args: [province.location, name, true], target: province.location, reason: 'llm-facedown' }, `${side} facedown province ${province.location}`);
                    }
                }
            }
        }

        if(!directClick) {
            return;
        }
        // Direct-click windows (conflict declaration / action windows) validate
        // clicks through their own path, so the bot's own board characters and
        // its playable hand are clickable even without a selectable flag.
        for(const card of this.findVisibleCards(me)) {
            if(!card.uuid) {
                continue;
            }
            const location = String(card.location || '');
            const playableHand = location === 'hand' && card.isPlayableByMe;
            if(location === 'play area' || /^(province [1-4]|stronghold province)$/.test(location) || playableHand) {
                add({ command: 'cardClicked', args: [card.uuid], target: card.name || card.uuid, reason: 'llm-card' }, this.describeCardLabel(card, 'mine'));
            }
        }
    }

    private describeCardLabel(card: any, side: string): string {
        const bits = [`${card.name || card.uuid} [${side} ${card.type || 'card'}`];
        const military = card.militarySkillSummary?.stat;
        const political = card.politicalSkillSummary?.stat;
        if(military !== undefined && military !== null) {
            bits.push(`mil${military}`);
        }
        if(political !== undefined && political !== null) {
            bits.push(`pol${political}`);
        }
        if(card.fate) {
            bits.push(`fate${card.fate}`);
        }
        if(card.bowed) {
            bits.push('bowed');
        }
        if(card.inConflict) {
            bits.push('inConflict');
        }
        return `${bits.join(' ')}]`;
    }

    // The bot's hand with printed text so the model can reason about plays.
    private handPayload(player: Player): any[] {
        const hand: any = (player as any).hand;
        if(!hand || typeof hand.map !== 'function') {
            return [];
        }
        return hand
            .map((card: any) => card)
            .filter((card: any) => card?.cardData)
            .map((card: any) => ({
                name: card.cardData.name,
                type: card.getType(),
                cost: card.cardData.cost,
                military: card.cardData.military,
                political: card.cardData.political,
                text: this.trimText(card.cardData.text)
            }));
    }

    // Visible board for the model: both players' characters and the rings. Only
    // information the bot can legitimately see is included (no opponent hand).
    private boardPayload(state: any, me: any): any {
        const players = state?.players || {};
        const opponentName = Object.keys(players).find((name) => players[name] !== me);
        const opponent = opponentName ? players[opponentName] : null;
        const characters = (owner: any) => (owner?.cardPiles?.cardsInPlay || [])
            .filter((card: any) => card.type === 'character')
            .map((card: any) => ({
                name: card.name,
                military: card.militarySkillSummary?.stat,
                political: card.politicalSkillSummary?.stat,
                fate: card.fate,
                bowed: card.bowed,
                inConflict: card.inConflict,
                honored: card.isHonored,
                dishonored: card.isDishonored
            }));
        const rings = Object.values(state?.rings || {}).map((ring: any) => ({
            element: ring.element,
            fate: ring.fate,
            claimed: ring.claimed,
            contested: ring.contested
        }));
        return { mine: characters(me), opponent: characters(opponent), rings: rings };
    }

    private trimText(text: any): string {
        return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    }

    // The heuristic pick, but only if it appears as a legal enumerated option
    // (it is appended as one when legal). Otherwise the first legal option —
    // never the raw heuristic decision, which at some prompts is illegal on its
    // own (e.g. a ring click at the province-setup prompt) and would loop.
    private legalFallbackDecision(options: Array<{ id: string; label: string; decision: BotDecision }>, fallback: BotDecision | null): BotDecision | null {
        if(fallback) {
            const key = `${fallback.command}:${JSON.stringify(fallback.args)}`;
            const match = options.find((option) => `${option.decision.command}:${JSON.stringify(option.decision.args)}` === key);
            if(match) {
                return match.decision;
            }
        }
        return options[0]?.decision || null;
    }

    // Async LLM move selection for one step: hands the option set + full state
    // to the planner and executes its pick, falling back to the heuristic pick
    // on any miss/timeout. Mirrors startConsult's break-and-resume contract.
    private startActionConsult(player: Player, prompt: any, options: Array<{ id: string; label: string; decision: BotDecision }>, fallback: BotDecision | null): void {
        const planner = this.planner;
        if(!planner) {
            return;
        }
        const signature = `${prompt?.promptTitle || ''}|${prompt?.menuTitle || ''}`;
        this.consultPending = signature;

        const state = this.game.getState(player.name);
        const me = state?.players?.[player.name];
        const timeoutMs = this.config.llm?.consultTimeoutMs || 120000;
        const question = `${prompt?.promptTitle || ''} — ${prompt?.menuTitle || ''}`.trim();
        const request = {
            question: question,
            state: this.consultSummary(state, me),
            hand: this.handPayload(player),
            board: this.boardPayload(state, me),
            options: options.map((option): ActionOption => ({ id: option.id, label: option.label }))
        };

        logger.info(`Bot ${this.config.playerName} action-consult '${question}' (${options.length} options)`);
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs + 500));
        const consult = planner.chooseAction(request, timeoutMs).catch((err) => {
            logger.info(`Bot ${this.config.playerName} action-consult failed (${err?.message || err}), using heuristic fallback`);
            return null;
        });

        Promise.race([consult, timeout]).then((result) => {
            this.consultPending = null;
            try {
                const current = this.player?.currentPrompt();
                const currentSignature = `${current?.promptTitle || ''}|${current?.menuTitle || ''}`;
                if(currentSignature !== signature) {
                    // The prompt changed while we were thinking; just resume.
                    this.resumeTick();
                    return;
                }

                const chosen = result ? options.find((option) => option.id === result.optionId) : undefined;
                logger.info(`Bot ${this.config.playerName} action-consult result: ${chosen ? `${chosen.id} (${chosen.label})` : 'fallback'}`);

                // Try the model's pick first, then a guaranteed-legal fall-back,
                // then every remaining enumerated option, stopping at the first
                // one the game accepts. Every enumerated option was legality-
                // checked at build time, so this can never dead-end the way a
                // single illegal raw heuristic decision (e.g. a stray ring click
                // at the province-setup prompt) would loop forever.
                const candidates: BotDecision[] = [];
                if(chosen) {
                    candidates.push({ ...chosen.decision, reason: `llm-action:${result?.reason || chosen.label}` });
                }
                const heuristicOption = this.legalFallbackDecision(options, fallback);
                if(heuristicOption) {
                    candidates.push(heuristicOption);
                }
                for(const option of options) {
                    candidates.push(option.decision);
                }
                if(candidates.length === 0) {
                    this.record(prompt, null, 'unsupported', 'llm-no-decision');
                    this.resumeTick();
                    return;
                }

                const tried = new Set<string>();
                let accepted = false;
                for(const candidate of candidates) {
                    const candidateKey = `${candidate.command}:${JSON.stringify(candidate.args)}`;
                    if(tried.has(candidateKey)) {
                        continue;
                    }
                    tried.add(candidateKey);
                    accepted = this.executeDecision(candidate);
                    if(accepted) {
                        break;
                    }
                }
                if(accepted) {
                    this.game.continue();
                }
                this.resumeTick();
            } catch(err: any) {
                logger.error(`Bot ${this.config.playerName} action-consult resolution failed: ${err?.stack || err}`);
                setTimeout(() => this.resumeTick(), 10);
            }
        }).catch((err: any) => {
            this.consultPending = null;
            logger.error(`Bot ${this.config.playerName} action-consult chain failed: ${err?.stack || err}`);
            setTimeout(() => this.resumeTick(), 10);
        });
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
        return !!prompt && (prompt.buttons?.length > 0 || prompt.selectCard || prompt.selectRing);
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
    private currentTargetHint(player: Player): { gameActions: string[]; sourceIsMine: boolean; sourceType?: string; sourceCardId?: string } | undefined {
        const step = this.currentPromptStep(player);
        const gameActions = step?.properties?.gameAction;
        if(!Array.isArray(gameActions) || gameActions.length === 0) {
            return undefined;
        }

        return {
            gameActions: gameActions.map((action: any) => action?.name).filter(Boolean),
            sourceIsMine: step.context?.player?.name === player.name,
            sourceType: step.context?.source?.type,
            sourceCardId: step.context?.source?.cardData?.id
        };
    }

    // The 'Choose additional fate' cost prompt does not expose the printed
    // cost of the character being played in the player state, so read it off
    // the prompt step's source card for the policy's fate curve.
    private currentPlayCost(player: Player): number | undefined {
        const step = this.currentPromptStep(player);
        if(step?.properties?.activePromptTitle !== 'Choose additional fate') {
            return undefined;
        }

        const cost = step.properties?.source?.printedCost;
        return typeof cost === 'number' && !isNaN(cost) ? cost : undefined;
    }

    // Hand card skill values are hidden from player-state summaries (showStats
    // is false outside the play area), so read the printed values off the game
    // objects. The policy uses them to skip cards that contribute nothing to
    // the current conflict type (e.g. a military attachment in a political
    // conflict).
    private handStatsHint(player: Player): Record<string, { military: number | null; political: number | null }> | undefined {
        const hand: any = (player as any).hand;
        if(!hand || typeof hand.map !== 'function') {
            return undefined;
        }

        const stats: Record<string, { military: number | null; political: number | null }> = {};
        for(const card of hand.map((card: any) => card)) {
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

        return stats;
    }

    private parseStat(value: any): number | null {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
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
        return (prompt.buttons || []).some((button: any) => {
            const command = button.command || 'menuButton';
            return !button.disabled &&
                command === 'menuButton' &&
                button.arg === arg &&
                button.uuid === uuid &&
                (button.method || undefined) === (method || undefined);
        });
    }

    private isLegalCard(player: Player, cardUuid: string): boolean {
        if(player.promptState.selectableCards.some((card: BaseCard) => card.uuid === cardUuid)) {
            return true;
        }

        // Conflict declaration, defender selection, and action windows validate
        // clicks through the prompt's own checkCardCondition/onCardClicked path
        // instead of promptState.selectableCards. Allow any card visible in the
        // bot's own perspective there; the game pipeline still rejects illegal
        // clicks without mutating state.
        if(!this.isDirectClickPrompt(player.currentPrompt())) {
            return false;
        }

        return this.findVisibleCards(this.game.getState(player.name)).some((card) => card.uuid === cardUuid);
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
            seedState: this.policy.seedState,
            result,
            reason
        });
    }
}

export = JigokuBotController;
