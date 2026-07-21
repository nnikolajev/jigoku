import JigokuBotPolicy from './JigokuBotPolicy.js';
import FateAwareJigokuBotPolicy from './FateAwareJigokuBotPolicy.js';
import BoardAwareJigokuBotPolicy from './BoardAwareJigokuBotPolicy.js';
import LmStudioClient from './llm/LmStudioClient.js';
import DeckHintService from './llm/DeckHintService.js';
import LiveConsultant from './llm/LiveConsultant.js';
import { getPlaybookEntry, deriveDeckStrategy } from './CardPlaybook.js';
import type { DeckStrategy } from './CardPlaybook';
import { resolveDeckProfile } from './DeckProfiles.js';
import type { DeckProfile } from './DeckProfiles';
import type { DuelBidContext } from './DuelBidTactics';
import type { DrawBidContext } from './DrawBidTactics';
import type { DynastyCharacterInfo } from './BoardAwareDynastyTactics';
import type { KnownCard } from './DeckAnalysis';
import OmniscientBotCapability from './OmniscientBotCapability.js';
import { logger } from '../../logger.js';
import type Game from '../game';
import type Player from '../player';
import type Ring from '../ring';
import type BaseCard from '../basecard';
import type { JigokuBotConfig } from './JigokuBotConfig';
import { CharacterStatus, EffectNames, EventNames } from '../Constants';

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

class JigokuBotController {
    readonly trace: BotTraceEntry[] = [];
    private policy: JigokuBotPolicy;
    private ticking = false;
    private hintService?: DeckHintService;
    private consultant?: LiveConsultant;
    private onStateChange?: () => void;
    private consultPending: string | null = null;
    private warmupStarted = false;
    private recentExhaustSignatures: string[] = [];
    private consecutiveExhaustions = 0;
    private deckStrategy?: DeckStrategy;
    private omniscientCapability: OmniscientBotCapability;
    // Display of Power installs its delayed ring replacement only after its
    // ability-effects event survives interrupts. Remember that success for
    // this conflict so another copy is not spent on the same ring. A canceled
    // event is not emitted, leaving retry available.
    private displayOfPowerActive = false;
    private displayOfPowerConflictUuid: string | null = null;

    constructor(private game: Game, readonly config: JigokuBotConfig, private runCommand: CommandRunner,
        services: {
            hintService?: DeckHintService;
            consultant?: LiveConsultant;
            onStateChange?: () => void;
            omniscientCapability?: OmniscientBotCapability;
        } = {}) {
        const seed = config.seed || 1;
        const isBoardAware = config.policy === 'board-aware' ||
            (config.policy === undefined && (seed === 3 || seed === '3'));
        const isFateAware = config.policy === 'fate-aware' ||
            isBoardAware ||
            (config.policy === undefined && (seed === 1 || seed === '1'));
        // Adaptive opening and province refresh is shared bot behavior. Keep
        // legacy available only as an explicit A/B override; seed selects the
        // decision policy, not whether the bot understands mulligans.
        const mulliganPolicy = config.mulliganPolicy || 'adaptive';
        this.policy = isBoardAware
            ? new BoardAwareJigokuBotPolicy(seed, config.drawBidPolicy, mulliganPolicy)
            : isFateAware
            ? new FateAwareJigokuBotPolicy(seed, config.drawBidPolicy, mulliganPolicy)
            : new JigokuBotPolicy(seed, config.drawBidPolicy, mulliganPolicy);
        this.omniscientCapability = services.omniscientCapability ||
            new OmniscientBotCapability(game, config.playerName, config.omniscient === true);
        this.onStateChange = services.onStateChange;
        (this.game as any).on?.(EventNames.OnInitiateAbilityEffects, (event: any) =>
            this.recordDisplayOfPowerInitiated(event));

        if(config.llm?.enabled) {
            const client = new LmStudioClient({ baseUrl: config.llm.baseUrl, model: config.llm.model });
            this.hintService = services.hintService || new DeckHintService(client, {
                cacheDir: config.llm.cacheDir,
                onWarn: (message) => this.game.addMessage(`${config.playerName}: ${message}`)
            });
            if(config.llm.liveConsult) {
                this.consultant = services.consultant || new LiveConsultant(client);
            }
        } else {
            this.hintService = services.hintService;
            this.consultant = services.consultant;
        }
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
        return this.omniscientCapability.build(me);
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
                const promptStep = this.currentPromptStep(player);
                this.ensureDeckAnalyzed(player);
                const playerState = this.game.getState(player.name);
                let decision = this.policy.decide(playerState, player.name, {
                    roundNumber: (this.game as any).roundNumber,
                    income: typeof (player as any).getTotalIncome === 'function'
                        ? (player as any).getTotalIncome()
                        : 7,
                    provinceIdsByLocation: this.provinceIdsByLocation(player),
                    promptIdentity: promptStep?.uuid,
                    promptControls: beforePrompt?.controls || [],
                    selectionReachedLimit: typeof promptStep?.selector?.hasReachedLimit === 'function'
                        ? promptStep.selector.hasReachedLimit(promptStep.selectedCards || [], promptStep.context)
                        : false,
                    targetHint: targetHint,
                    playCost: this.currentPlayCost(player),
                    playCardId: this.currentPlayCardId(player),
                    handStats: this.handStatsHint(player),
                    // Hand-written playbook knowledge outranks the cached LLM
                    // analysis for the same card.
                    cardHint: (cardId: string) => getPlaybookEntry(cardId) || this.hintService?.getHint(cardId),
                    strategy: this.currentDeckStrategy(player),
                    profile: this.currentDeckProfile(player),
                    opponentConflictDeck: this.opponentConflictDeck(player),
                    opponentDuelBidding: this.opponentDuelBidProfile(player),
                    duelParticipantIaijutsuReady: this.iaijutsuMasterReadyByCharacter(player),
                    // Exact public character data omitted by serialized player
                    // summaries. Lion uses these for Elegant Tessen legality
                    // and True Strike Kenjutsu's base-skill matchup.
                    characterPrintedCosts: this.characterPrintedCosts(player),
                    characterBaseMilitary: this.characterBaseMilitary(player),
                    participatingCharacterCounts: this.participatingCharacterCounts(player),
                    cavalryCharacterUuids: this.cavalryCharacterUuids(player),
                    readyAfterMoveCharacterUuids: this.readyAfterMoveCharacterUuids(player),
                    // Exact live duel skills/honor/Iaijutsu state for shared
                    // 5x5 bid analysis. Gap remains for old synthetic callers.
                    duelBidContext: this.currentDuelBidContext(player),
                    duelGap: this.currentDuelGap(player),
                    // Effective post-reveal margin, including bid modifiers.
                    duelMargin: this.currentDuelMargin(player),
                    interruptedEventIsMine: this.currentInterruptedEventIsMine(player),
                    displayOfPowerActive: this.displayOfPowerActiveThisConflict(),
                    legalDirectCardUuids: this.currentLegalDirectCardUuids(player),
                    legalRingElements: this.currentLegalRingElements(player),
                    // Printed fate cost of dynasty province cards (reserve 1 fate).
                    dynastyCosts: this.dynastyCostsHint(player),
                    // Exact public printed skills, ability density, and live
                    // honor-on-entry effects for board-aware dynasty valuation.
                    dynastyCharacterInfo: this.dynastyCharacterInfo(player),
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
                    // Seed 3 only: the cheat view (human hand/fate/true province
                    // strengths). Undefined when the capability is disabled, so the
                    // policy's omniscient branches stay dormant for fair bots.
                    omniscient: this.buildOmniscient(player)
                });


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
                if(this.consultant && targetHint && decision.command === 'cardClicked' && consultable) {
                    this.startConsult(player, beforePrompt, decision);
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

    private cavalryCharacterUuids(player: Player): Record<string, true> {
        const result: Record<string, true> = {};
        for(const side of [player, player.opponent]) {
            const cards: any[] = typeof (side as any)?.cardsInPlay?.toArray === 'function'
                ? (side as any).cardsInPlay.toArray()
                : [];
            for(const card of cards) {
                const type = card?.type || card?.getType?.();
                if(card?.uuid && type === 'character' && card.hasTrait?.('cavalry')) {
                    result[card.uuid] = true;
                }
            }
        }
        return result;
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
                const hint: any = getPlaybookEntry(card.cardData?.id);
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
