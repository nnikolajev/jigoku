import SeededRandom from './SeededRandom.js';
import type { CardHint } from './llm/CardHints';
import type { DeckStrategy } from './CardPlaybook';
import type { KnownCard, Omniscient } from './DeckAnalysis';
import { estimateHandThreat } from './DeckAnalysis.js';
import { profileFromStrategy, DEFAULT_PROFILE } from './DeckProfiles.js';
import type { DeckProfile } from './DeckProfiles';
import type { FateAwareEconomyProfile } from './FateAwareEconomy';
import { planConflictCards } from './ConflictCardEconomy.js';
import type { ConflictCardOption } from './ConflictCardEconomy';
import { DishonorTactics } from './DishonorTactics.js';
import { LionTactics } from './LionTactics.js';
import { GloryTactics } from './GloryTactics.js';
import { DragonTactics } from './DragonTactics.js';
import { DuelTactics } from './DuelTactics.js';
import { ShugenjaTactics } from './ShugenjaTactics.js';
import { DragonAttachmentTactics } from './DragonAttachmentTactics.js';
import { StrongholdDefenseTactics } from './StrongholdDefenseTactics.js';
import type { StrongholdDefenseCharacter, StrongholdDefensePlan } from './StrongholdDefenseTactics';
import { CraneBaselineTactics } from './CraneBaselineTactics.js';
import { AttachmentControlTactics } from './AttachmentControlTactics.js';
import { attackProvinceLists, mustAttackStronghold, strongholdProvinceUnderAttack } from './ProvinceTargeting.js';

type BotCommandName = 'menuButton' | 'cardClicked' | 'ringClicked' | 'menuItemClick' | 'ringMenuItemClick' | 'facedownCardClicked';

interface BotDecision {
    command: BotCommandName;
    args: any[];
    target?: string;
    reason: string;
}

const RING_ORDER = ['air', 'earth', 'fire', 'water', 'void'];
const CONFLICT_TITLE_REGEX = /^(Military|Political)\s+(Air|Earth|Fire|Water|Void)\s+Conflict/i;
const SKILL_VS_REGEX = /:\s*(\d+)\s+vs\s+(\d+)/;
const PROVINCE_KEYS = ['one', 'two', 'three', 'four'];

// Player-state summaries do not expose the printed Restricted keyword, so
// keep the Imperial card ids here. The engine still owns legality; this list
// only lets the bot spread Restricted attachments before a character reaches
// the two-attachment cap.
const RESTRICTED_ATTACHMENT_IDS = new Set([
    'adorned-barcha', 'ancestral-daisho', 'ancestral-daisho-2', 'ancestral-kabuto',
    'ancestral-netsuke', 'armor-of-the-fallen', 'ashigaru-company', 'ayubune-pilot',
    'blade-of-10-000-battles', 'callous-ashigaru', 'chikara', 'composite-yumi',
    'contemplative-wisdom', 'curse-of-misfortune', 'curved-blade', 'dai-tsuchi',
    'daidoji-yari', 'daikyu', 'daimyo-s-gunbai', 'dragon-s-claw', 'dragon-s-fang',
    'dragon-tattoo', 'elegant-tessen', 'empty-city-archivist', 'fine-katana',
    'four-temples-advisor', 'honed-nodachi', 'honest-assessment', 'honored-blade',
    'jade-infused-arrows', 'jade-inlaid-katana', 'jade-tetsubo', 'kakita-blade',
    'kakita-blade-2', 'kamayari', 'katana-of-fire', 'kikyo', 'kinki',
    'kitsuki-s-method', 'kobo-ichi-kai-jujutsu', 'kunshu', 'letter-from-the-daimyo',
    'magari-yari', 'mirumoto-daisho', 'naginata', 'ofushikai', 'ornate-fan',
    'peacemaker-s-blade', 'phoenix-tattoo', 'restored-heirloom', 'scarlet-sabre',
    'self-understanding', 'sensei-s-heirloom', 'setting-the-standard', 'shori',
    'shukujo', 'sturdy-tetsubo', 'tessen-of-the-tsunami-legion', 'tetsubo-of-blood',
    'the-skin-of-fu-leng', 'twin-sister-blades', 'wicked-tetsubo', 'writ-of-authority'
]);

// Their constant effects do not improve when the same printed attachment is
// stacked on one character. Spread extra copies before considering a repeat.
const NON_STACKING_DEBUFF_ATTACHMENT_IDS = new Set([
    'pacifism', 'stolen-breath', 'softskin'
]);
const CONFLICT_LOCK_ATTACHMENT_IDS = new Set([
    'pacifism', 'stolen-breath'
]);

// GameAction names classified by whether the resolved effect hurts or helps
// the card it targets. Drives which side of the board ability targets aim at.
const HARMFUL_ACTIONS = new Set([
    'bow', 'dishonor', 'removeFate', 'sendHome', 'discardFromPlay', 'discardCard',
    'discardStatus', 'discard', 'returnToHand', 'returnToDeck', 'removeFromGame',
    'break', 'duel', 'loseHonor', 'sacrifice', 'detach', 'taint'
]);
const HELPFUL_ACTIONS = new Set([
    'honor', 'ready', 'placeFate', 'moveToConflict', 'putIntoPlay', 'attach',
    'gainFate', 'addToken', 'gainStatus', 'restoreProvince', 'createToken'
]);

interface TargetHint {
    gameActions?: string[];
    sourceIsMine?: boolean;
    sourceType?: string;
    sourceCardId?: string;
    sourceUuid?: string;
    playCardFateCostIgnored?: boolean;
    duelAxis?: 'military' | 'political';
    duelOpponentUuid?: string;
}

type HandStats = Record<string, { military: number | null; political: number | null }>;
type CardHintLookup = (cardId: string) => CardHint | undefined;

interface FateAwareDynastyPreference {
    card?: any;
    playReason?: string;
    passReason?: string;
    terminal: boolean;
    // Profiles repairing a board floor may buy another durable body after
    // the generic economy has already marked one as purchased.
    allowAdditionalDurable?: boolean;
}

interface FateAwareAdditionalFateOverride {
    desired: number;
    reason: string;
}

interface DecideContext {
    roundNumber?: number;
    // Identity of the live prompt step. Two consecutive prompts can have the
    // same title/menu and the same only legal target (for example both players
    // resolving Court Games). Keep their attempted-target sets separate.
    promptIdentity?: string;
    promptControls?: any[];
    // True when a live multi-card selector has already reached its maximum.
    // Its state summary may still mark unselected cards selectable until the
    // prompt closes; choose Done instead of issuing rejected extra clicks.
    selectionReachedLimit?: boolean;
    targetHint?: TargetHint;
    playCost?: number;
    playCardId?: string;
    handStats?: HandStats;
    cardHint?: CardHintLookup;
    strategy?: DeckStrategy;
    // Per-deck tuning knobs (DeckProfiles). When absent, derived from `strategy`
    // so callers that pass only strategy (e.g. tests) behave identically.
    profile?: DeckProfile;
    // Public submitted deck-list information. Unlike `omniscient.oppHand`, this
    // is available to every seed and never reveals which cards are currently
    // held. Used by card-name effects such as Gossip.
    opponentConflictDeck?: KnownCard[];
    // Seed-5 cheat view: the human's true hand/fate/province strengths. Present
    // only for the omniscient bot; every omniscient branch is gated on it, so
    // Non-omniscient seeds (undefined here) keep identical behavior.
    omniscient?: Omniscient;
    // Live duel skill gap (our side - their side) on the duel axis, before
    // honor bids. Present only during a duel bid; drives the bid heuristic.
    duelGap?: number;
    // Live post-reveal duel margin (skill gap + both effective honor bids).
    // Used by Iaijutsu Master to change a result or retain a win cheaply.
    duelMargin?: number;
    // Ownership of the event whose effects are currently being interrupted.
    // Voice of Honor must never cancel its controller's own event.
    interruptedEventIsMine?: boolean;
    // UUIDs already visible to the bot that the live prompt accepts as direct
    // clicks. Undefined preserves legacy behavior for synthetic/custom calls.
    legalDirectCardUuids?: Record<string, true>;
    // Ring elements accepted by the live prompt. This matters while declaring
    // a conflict: the selected ring can only toggle to the other conflict type
    // when the engine says that declaration remains legal.
    legalRingElements?: Record<string, true>;
    // Printed fate cost of each face-up dynasty province card by uuid, so the
    // dynasty play can keep a 1-fate reserve for conflict-phase hand cards.
    dynastyCosts?: Record<string, number>;
    // Printed fate cost of conflict cards in our hand by uuid. Player-state
    // summaries omit it; profiles use this to sequence cost reducers.
    conflictCosts?: Record<string, number>;
    // Exact live total for our stronghold province, including stronghold and
    // holding modifiers even while the province remains facedown.
    strongholdProvinceStrength?: number;
}

class JigokuBotPolicy {
    private random: SeededRandom;
    private lastSignature = '';
    private attempted = new Set<string>();
    // The prompt signature we last answered with a "Pay costs first" click, so
    // we advance a cost-gated ability once but do not re-click the same button
    // forever if paying the cost does not clear the prompt.
    private payCostsSignature: string | null = null;
    // Board-ability card ids fired this round that must not be re-fired. Some
    // in-play actions have NO per-use limit and REVERSE their own effect
    // (Tranquil Philosopher moves 1 fate between two rings) — firing repeatedly
    // ping-pongs fate forever, because the intervening "fate moved" reaction
    // window flips the prompt signature and clears the attempted-set. Cleared
    // each round at the Honor Bid so it stays usable once per round.
    private boardAbilityUsed = new Map<string, number>();
    // Identifies the live Dragon conflict so per-conflict card-engine state
    // (currently Kiho/ring-fate projection) resets at the right boundary.
    private dragonAbilityConflictKey = '';
    private dragonConflictAbilityUsed = new Map<string, number>();
    private dragonKihoPlayed = false;
    // Disguised can return to the action window after a target was accepted
    // but the remaining cost/play check failed. Do not replay the same Tadaka
    // indefinitely; a fresh round gets one new legal attempt.
    private tadakaDisguiseAttempted = false;
    // Yokuni's printed copy Action is max once per round, but the copied
    // ability must remain available later. Track only the copy setup so the
    // bot does not repeatedly open/cancel the prompt when no desired source
    // character is present.
    private yokuniCopyUsed = false;
    // Yokuni keeps a copied Niten Master reaction through the conflict phase.
    // Weapon timing/targeting treats him as a second ready carrier only then.
    private yokuniCopiedNiten = false;
    // Daimyo's Favor reduces only the next attachment played on its own
    // bearer. Keep that bearer between action opportunities so the bot plays
    // a positive-cost attachment there instead of consuming the effect on a
    // free attachment or sending the paid attachment elsewhere.
    private pendingDaimyoBearerUuid: string | null = null;
    // Source cards whose ability targeting was CANCELED for lack of a
    // valid-side target this round, by printed id. The attempted-set cannot
    // stop these loops because the prompt signature flips between the ability
    // window and the target prompt (clearing it) — so a card whose targeting
    // cancels twice is vetoed until the next round starts. Without this the
    // bot burns its whole decision budget re-clicking the same dead reaction
    // (Assassination/Higashi Kaze: 200+ clicks per match before the gate).
    private cancelledSources = new Map<string, number>();
    // A play can pass the engine's initial legality check and target prompt,
    // then be reset to its original zone when a later play requirement fails.
    // Prompt changes clear `attempted`, so remember that returned UUID for the
    // round instead of replaying the same card/target forever.
    private failedPlayCards = new Set<string>();
    private pendingPlay: {
        uuid: string;
        id?: string;
        location?: string;
        targetSelected: boolean;
    } | null = null;
    // Asako Diplomat picks a target, THEN a separate honor/dishonor menu
    // opens (a new prompt signature) — remember which way the target went.
    private diplomatChoice: 'honor' | 'dishonor' = 'honor';
    private favorableGroundRetreatPending = false;
    // Experimental fate-aware copy state. Generic policy never enters these
    // branches: FateAwareJigokuBotPolicy opts in through the protected hook.
    private fateAwareRoundNumber = 0;
    private fateAwareDynastyStartFate: number | null = null;
    private fateAwareBoughtCharacter = false;
    private fateAwareStrongCharacter = false;
    private fateAwarePendingAdditionalFate: number | null = null;
    private fateAwarePendingAdditionalFateCap: number | null = null;
    private fateAwarePendingCost: number | undefined;
    private fateAwarePendingDurable = false;
    private fateAwareDurableSpent = 0;

    constructor(seed: string | number = 1) {
        this.random = new SeededRandom(seed);
    }

    get seedState(): number {
        return this.random.getState();
    }

    protected usesFateAwareEconomy(): boolean {
        return false;
    }

    private resetFateAwareEconomy(roundNumber: number): void {
        this.fateAwareRoundNumber = roundNumber;
        this.fateAwareDynastyStartFate = null;
        this.fateAwareBoughtCharacter = false;
        this.fateAwareStrongCharacter = false;
        this.fateAwarePendingAdditionalFate = null;
        this.fateAwarePendingAdditionalFateCap = null;
        this.fateAwarePendingCost = undefined;
        this.fateAwarePendingDurable = false;
        this.fateAwareDurableSpent = 0;
    }

    decide(playerState: any, botName?: string, context: DecideContext = {}): BotDecision | null {
        const me = this.myPlayer(playerState, botName);
        if(!me) {
            return null;
        }

        this.recordReturnedFailedPlay(playerState, me);

        if(this.usesFateAwareEconomy()) {
            const roundNumber = context.roundNumber ?? (this.fateAwareRoundNumber || 1);
            if(roundNumber !== this.fateAwareRoundNumber || me.promptTitle === 'Honor Bid') {
                this.resetFateAwareEconomy(roundNumber);
            }
        }

        // The dedup signature must ignore parts of the prompt that flip while
        // the bot re-selects within the SAME decision: the live conflict skill
        // totals ("Attacker: 4 Defender: 5") and the ring element/type in a
        // conflict title ("Political Fire Conflict"). Left in, they wipe the
        // attempted-set on every legal-but-idle ring toggle, so the bot never
        // exhausts its options and reaches its own pass fall-back — it loops.
        const signature = `${context.promptIdentity || ''}|${me.promptTitle || ''}|${me.menuTitle || ''}`
            .replace(/Attacker:\s*-?\d+\s*Defender:\s*-?\d+/gi, 'Attacker: N Defender: N')
            .replace(/(?:military|political)\s+\w+\s+conflict/gi, 'CONFLICT')
            // Reaction/interrupt windows re-title by the specific trigger (which
            // ring lost fate, which card fired): "Any reactions to Fate being
            // moved from Water Ring?", "...Air Ring?", "...to Tengu Sensei or...".
            // A chained reaction that moves more fate re-opens a differently
            // titled window; without collapsing the trigger text the signature
            // flips every time, wipes the attempted-set, and the bot re-fires
            // the same ability forever. The reaction decision keys on which of
            // OUR cards are selectable, not on the trigger, so drop the "to X".
            .replace(/\bany (reactions?|interrupts?)\b.*/gi, 'any $1');
        if(signature !== this.lastSignature) {
            this.lastSignature = signature;
            this.attempted.clear();
        }

        // Round boundary (every draw-phase bid): dead abilities may have
        // targets again after the board changes, so lift the cancel vetoes and
        // let the once-per-round board abilities fire again.
        if(me.promptTitle === 'Honor Bid') {
            this.cancelledSources.clear();
            this.failedPlayCards.clear();
            this.pendingPlay = null;
            this.boardAbilityUsed.clear();
            this.dragonConflictAbilityUsed.clear();
            this.dragonAbilityConflictKey = '';
            this.dragonKihoPlayed = false;
            this.tadakaDisguiseAttempted = false;
            this.yokuniCopyUsed = false;
            this.yokuniCopiedNiten = false;
            this.pendingDaimyoBearerUuid = null;
        }

        const decision = this.decideForPrompt(playerState, me, context);
        if(decision && ['cardClicked', 'ringClicked', 'facedownCardClicked'].includes(decision.command)) {
            this.attempted.add(this.decisionKey(decision));
        }
        if(decision && ['cancel-wrong-side-target', 'cancel-redundant-debuff-attachment'].includes(decision.reason) && context.targetHint?.sourceCardId) {
            const id = context.targetHint.sourceCardId;
            this.cancelledSources.set(id, (this.cancelledSources.get(id) || 0) + 1);
        }
        if(decision?.reason === 'tadaka-disguise-base') {
            this.tadakaDisguiseAttempted = true;
        }
        if(this.pendingPlay && context.targetHint?.sourceCardId === this.pendingPlay.id) {
            if(decision?.command === 'cardClicked') {
                this.pendingPlay.targetSelected = true;
            } else if(decision?.command === 'menuButton' &&
                String(decision.args?.[0] || decision.target || '').toLowerCase().includes('cancel')) {
                // The engine returned the pending card to its original zone.
                // Prompt signatures change across this target/cancel cycle, so
                // the ordinary attempted set cannot prevent an endless replay.
                this.failedPlayCards.add(this.pendingPlay.uuid);
                this.pendingPlay = null;
            }
        }
        if(decision?.command === 'cardClicked' && [
            'play-conflict-card',
            'play-preconflict-attachment',
            'duel-preconflict-attachment',
            'attachment-tower-preconflict',
            'replay-card-shared-play-intent',
            'replay-card-forced-fallback'
        ].includes(decision.reason)) {
            const card = this.findVisibleCards(playerState).find((candidate) =>
                candidate.uuid === decision.args[0]);
            this.pendingPlay = {
                uuid: decision.args[0],
                id: card?.id,
                location: card?.location,
                targetSelected: false
            };
        }

        return decision;
    }

    private recordReturnedFailedPlay(playerState: any, me: any): void {
        if(!this.pendingPlay) {
            return;
        }
        const backInActionWindow = me?.promptTitle === 'Conflict Action Window' ||
            me?.menuTitle === 'Initiate an action';
        if(!backInActionWindow) {
            return;
        }
        const pending = this.pendingPlay;
        const card = this.findVisibleCards(playerState).find((candidate) => candidate.uuid === pending.uuid);
        const sameZone = !!card && String(card.location || '') === String(pending.location || '');
        if(pending.targetSelected && sameZone && card.isPlayableByMe !== false) {
            this.failedPlayCards.add(pending.uuid);
        }
        this.pendingPlay = null;
    }

    // A source ability whose targeting canceled twice this round is dead —
    // stop re-clicking it until the next round.
    private isCancelVetoed(cardId?: string): boolean {
        return !!cardId && (this.cancelledSources.get(cardId) || 0) >= 2;
    }

    private boardAbilityKey(card: any, dragon: DragonTactics | null = null): string {
        // Way belongs to one specific bearer and copies are deliberately
        // spread. Track each Way-enabled character independently; preserve the
        // historical printed-id behavior for all other board actions.
        return String(dragon && dragon.hasWayOfTheDragon(card) ?
            (card?.uuid || card?.id) : (card?.id || card?.uuid || ''));
    }

    private boardAbilityLimit(card: any, dragon: DragonTactics | null = null): number {
        return dragon && dragon.hasWayOfTheDragon(card) ? 2 : 1;
    }

    private boardAbilityIsUsed(card: any, dragon: DragonTactics | null = null): boolean {
        return (this.boardAbilityUsed.get(this.boardAbilityKey(card, dragon)) || 0) >= this.boardAbilityLimit(card, dragon);
    }

    private recordBoardAbility(card: any, dragon: DragonTactics | null = null): void {
        const key = this.boardAbilityKey(card, dragon);
        this.boardAbilityUsed.set(key, (this.boardAbilityUsed.get(key) || 0) + 1);
    }

    private wayAbilityIsUsed(card: any, dragon: DragonTactics): boolean {
        const period = dragon.wayAbilityPeriod(card);
        if(period === 'conflict') {
            const key = String(card?.uuid || card?.id || '');
            return (this.dragonConflictAbilityUsed.get(key) || 0) >= this.boardAbilityLimit(card, dragon);
        }
        return period === 'round' && this.boardAbilityIsUsed(card, dragon);
    }

    private recordWayAbility(card: any, dragon: DragonTactics): void {
        if(dragon.wayAbilityPeriod(card) === 'conflict') {
            const key = String(card?.uuid || card?.id || '');
            this.dragonConflictAbilityUsed.set(key, (this.dragonConflictAbilityUsed.get(key) || 0) + 1);
            return;
        }
        this.recordBoardAbility(card, dragon);
    }

    private decideForPrompt(playerState: any, me: any, context: DecideContext = {}): BotDecision | null {
        const promptTitle = me.promptTitle || '';
        const menuTitle = me.menuTitle || '';
        const title = `${promptTitle} ${menuTitle}`.toLowerCase();
        const buttons = this.enabledButtons(me);
        // A multi-card selector may keep the same title and visible choices
        // after its maximum is reached. Close it before any title-specific
        // handler can attempt another card (Daidoji Harrier is one example).
        if(context.selectionReachedLimit) {
            const done = this.findButton(buttons, ['done']);
            if(done) {
                return this.buttonDecision(done, 'finish-card-selection-limit');
            }
        }
        const opponent = this.opponentPlayer(playerState, me);
        // Resolve the per-deck tuning profile once. Falls back to deriving it from
        // the strategy flags so a caller that passes only `strategy` (tests, older
        // paths) gets identical behavior to before the profile refactor.
        const profile = context.profile || profileFromStrategy(context.strategy);
        // Dishonor/mill decks get a tactics object; null for every other deck,
        // and every dishonor branch below is gated on it.
        const dishonor = profile.dishonor ? new DishonorTactics(profile.dishonor) : null;
        // Bushi-swarm decks likewise; null for every other deck.
        const lion = profile.lion ? new LionTactics(profile.lion) : null;
        // Glory/honor decks likewise; null for every other deck.
        const glory = profile.glory ? new GloryTactics(profile.glory) : null;
        // Monk/card-engine decks likewise; null for every other deck.
        const dragon = profile.dragon ? new DragonTactics(profile.dragon) : null;
        // Duel-centric decks likewise; null for every other deck.
        const duelist = profile.duelist ? new DuelTactics(profile.duelist) : null;
        // Phoenix spell/ring-control deck; null for every other profile.
        const shugenja = profile.shugenja ? new ShugenjaTactics(profile.shugenja) : null;
        // Iron Mountain Castle attachment tower; separate from the High House
        // monk/card-count Dragon profile.
        const attachmentTower = profile.attachmentTower
            ? new DragonAttachmentTactics(profile.attachmentTower)
            : null;
        const crane = profile.craneBaseline
            ? new CraneBaselineTactics(profile.craneBaseline)
            : null;
        const attachmentControl = new AttachmentControlTactics(profile.attachmentControl);

        // Card-name controls have no prompt buttons and cannot use the normal
        // button fallback. Gossip must name a card from the opponent's actual,
        // publicly known conflict deck. Seed 5 may additionally prioritize an
        // affordable copy it can see in hand; fair seeds use only deck makeup.
        const cardNameControl = (context.promptControls || []).find((control: any) =>
            control.type === 'card-name' && (control.command || 'menuButton') === 'menuButton');
        if(cardNameControl) {
            const deck = context.opponentConflictDeck || [];
            const pick = crane?.pickGossipCard({
                opponentDeck: deck,
                opponentHand: context.omniscient?.oppHand,
                opponentFate: context.omniscient?.oppFate,
                omniscient: !!context.omniscient,
                conflictType: playerState?.conflict?.type
            }) || deck.slice().sort((a, b) =>
                (Number(b.swing) || 0) - (Number(a.swing) || 0) || a.id.localeCompare(b.id))[0];
            if(pick?.name) {
                return {
                    command: 'menuButton',
                    args: [pick.name, cardNameControl.uuid, cardNameControl.method],
                    target: pick.name,
                    reason: crane ? 'crane-gossip-known-deck-card' : 'name-known-deck-card'
                };
            }
        }

        if(promptTitle === 'Honor Bid') {
            const isDuelBid = menuTitle.startsWith('Choose your bid for the duel');
            const myHonor = me?.stats?.honor ?? 10;
            // Dishonor decks bid low on EVERY dial (draw phase and duels) so
            // the opponent's higher bid pays them the difference in honor.
            if(dishonor) {
                const desired = dishonor.desiredBid(context.roundNumber, myHonor);
                return this.buttonDecision(this.closestBidButton(buttons, desired), 'dishonor-honor-bid');
            }
            if(isDuelBid) {
                // Duel bids: bid on the SKILL GAP when we know it. Ahead or even
                // -> bid max to win/equalize; unwinnable (behind 4+) -> bid 1 to
                // bank the honor their higher bid pays us; the uncertain 1-3
                // deficit is honor-gated (spend when rich, bank when poor).
                if(context.duelGap !== undefined) {
                    const desired = duelist
                        ? duelist.desiredDuelBidForGap(context.duelGap, myHonor)
                        : this.duelBidForGap(context.duelGap, myHonor);
                    return this.buttonDecision(this.closestBidButton(buttons, desired), 'duel-bid-skill-gap');
                }
                // No mil/pol gap available (Glory-type duels): per-deck honor-
                // only fallbacks, else bid to win.
                if(glory) {
                    return this.buttonDecision(this.closestBidButton(buttons, glory.desiredDuelBid(myHonor)), 'glory-duel-bid');
                }
                if(dragon) {
                    return this.buttonDecision(this.closestBidButton(buttons, dragon.desiredDuelBid(myHonor)), 'dragon-duel-bid');
                }
                if(lion) {
                    return this.buttonDecision(this.closestBidButton(buttons, lion.desiredBid(context.roundNumber, myHonor, true)), 'lion-duel-bid');
                }
                if(duelist) {
                    return this.buttonDecision(this.closestBidButton(buttons, duelist.desiredDuelBid(myHonor)), 'duel-honor-bid');
                }
                return this.buttonDecision(this.closestBidButton(buttons, this.duelBidForGap(0, myHonor)), 'duel-bid-default');
            }
            if(lion) {
                return this.buttonDecision(
                    this.closestBidButton(buttons, lion.desiredBid(context.roundNumber, myHonor, false)),
                    'lion-draw-bid'
                );
            }
            if(dragon) {
                return this.buttonDecision(
                    this.closestBidButton(buttons, dragon.desiredBid(context.roundNumber, myHonor)),
                    'dragon-draw-bid'
                );
            }
            // DRAW dial (every non-Scorpion deck): bid to DRAW cards. Cards win
            // games and these decks know how to spend them, so bid to the honor
            // the pool can spare — the full draw when honor-rich, a safe middle
            // bid otherwise, and the minimum only at the dishonor cliff.
            let drawBid = this.drawBidForHonor(myHonor, opponent?.stats?.honor ?? 10);
            // A grind deck (Crab) caps the bid: the higher bidder pays the honor
            // difference, so bidding high both bleeds Crab toward its own
            // dishonor loss and feeds the honor-climbing opponent. Protect honor.
            if(profile.drawBidCap !== undefined) {
                drawBid = Math.min(drawBid, profile.drawBidCap);
            }
            return this.buttonDecision(this.closestBidButton(buttons, drawBid), 'draw-bid-honor');
        }

        // Iaijutsu Master's post-reveal modifier menu. The reaction itself is
        // gated below using the same live margin, so this menu only opens when
        // one of the two choices improves the duel or preserves a win cheaply.
        if(duelist && buttons.some((button) => String(button.text || '') === 'Increase honor bid') &&
            buttons.some((button) => String(button.text || '') === 'Decrease honor bid')) {
            const choice = duelist.iaijutsuBidChoice(context.duelMargin);
            if(choice) {
                return this.buttonDecision(
                    buttons.find((button) => String(button.text || '') === choice),
                    choice.startsWith('Increase') ? 'iaijutsu-increase-bid' : 'iaijutsu-decrease-bid'
                );
            }
        }

        // Select prompts whose choices are decks ("<player>'s Conflict") or
        // players — Deserted Shrine's mill and Master Whisperer's discard-3.
        // Only a dishonor deck runs these cards; aim both at the opponent.
        if(dishonor && buttons.length > 0) {
            if(buttons.some((button) => /('s Dynasty|'s Conflict)$/.test(String(button.text || '')))) {
                const deckButton = dishonor.pickDeckButton(buttons, me.name);
                if(deckButton) {
                    return this.buttonDecision(deckButton, 'dishonor-mill-deck');
                }
            }
            if(opponent?.name && me?.name &&
                buttons.some((button) => String(button.text || '') === opponent.name) &&
                buttons.some((button) => String(button.text || '') === me.name)) {
                const playerButton = dishonor.pickOpponentButton(buttons, opponent.name);
                if(playerButton) {
                    return this.buttonDecision(playerButton, 'dishonor-target-opponent');
                }
            }
        }

        if(title.includes('are you sure') || title.includes('pass conflict')) {
            return this.buttonDecision(this.findButton(buttons, ['yes']) || this.findButton(buttons, ['no']), 'confirm-pass');
        }

        // Togashi Tadakatsu (and any future chooseConflictRing restriction)
        // inserts a button-only declaration prompt before the defender chooses
        // the ring. Generic fallback prefers buttons containing "pass", which
        // made the bot decline every conflict while Tadakatsu was in play.
        // Apply the same exposed-stronghold plan used by the normal ring prompt:
        // only turtle when it explicitly says hold all. Also verify that a
        // non-reserved ready character can attack: this menu may still be
        // offered when the defender can choose a ring but the attacker has no
        // body for the following Choose attackers prompt.
        if(/do you wish to declare a conflict/i.test(menuTitle)) {
            const declare = this.findButton(buttons, ['declare a conflict']);
            const pass = this.findButton(buttons, ['pass conflict']);
            const strongholdPlan = this.strongholdDefensePlan(
                me,
                opponent,
                profile,
                context.omniscient,
                context.strongholdProvinceStrength
            );
            if(strongholdPlan.active && strongholdPlan.mode === 'hold-all' && pass) {
                return this.buttonDecision(pass, strongholdPlan.reason);
            }
            const reserved = new Set(strongholdPlan.reserveUuids);
            const canAttack = this.readyCharacters(me).some((card) =>
                !reserved.has(String(card.uuid)) &&
                ((this.skillValue(card, 'military') || 0) > 0 ||
                    (this.skillValue(card, 'political') || 0) > 0));
            if(!canAttack && pass) {
                return this.buttonDecision(
                    pass,
                    strongholdPlan.active ? 'stronghold-no-free-attacker' : 'pass-no-attackers'
                );
            }
            return this.buttonDecision(declare || pass, declare ? 'declare-conflict-opportunity' : 'pass-no-legal-conflict');
        }

        if(title.includes('mulligan')) {
            // Holding-engine decks dig their opening provinces toward Kaiu Wall
            // holdings (mulligan every non-holding province card); other decks
            // keep their provinces.
            if(profile.mulliganForHoldings && promptTitle === 'Dynasty Mulligan') {
                return this.holdingMulliganDecision(me, buttons);
            }
            if(attachmentTower && promptTitle === 'Dynasty Mulligan') {
                return this.attachmentTowerMulliganDecision(me, buttons, attachmentTower);
            }
            return this.buttonDecision(this.findButton(buttons, ['done']), 'finish-mulligan');
        }

        if(title.includes('discard all characters with no fate')) {
            return this.buttonDecision(this.findButton(buttons, ['done']), 'discard-no-fate-characters');
        }

        if(title.includes('select dynasty cards to discard')) {
            return this.dynastyDiscardDecision(playerState, me, buttons, duelist, attachmentTower);
        }

        if(promptTitle === 'Initiate Conflict' || CONFLICT_TITLE_REGEX.test(promptTitle)) {
            const declaration = this.conflictDeclarationDecision(playerState, me, opponent, promptTitle, menuTitle, buttons, profile, context.omniscient, context.strongholdProvinceStrength, dishonor, context.cardHint, glory, dragon, duelist, shugenja, attachmentTower, lion, crane, context.legalDirectCardUuids, context.legalRingElements);
            if(declaration) {
                return declaration;
            }
        }

        if(menuTitle.toLowerCase().includes('choose defenders') && !menuTitle.toLowerCase().includes('covert')) {
            return this.defenderDecision(me, promptTitle, buttons, profile, context.omniscient, dishonor, context.cardHint, shugenja, opponent, context.legalDirectCardUuids);
        }

        if(title.includes('choose first player')) {
            return this.buttonDecision(this.findButton(buttons, ['first player']) || buttons[0], 'choose-first-player');
        }

        // Setup: which province goes under the stronghold. It is only
        // attackable after 3 other provinces break, so a deck can park an
        // on-reveal punisher there (Night Raid) to blunt the final push.
        // Generic default: Ancestral Lands (+5 strength during political
        // conflicts) makes the game-deciding province the hardest to break.
        if(menuTitle === 'Select stronghold province') {
            const preferredId = profile.strongholdProvinceId || 'ancestral-lands';
            const pick = this.findVisibleCards(me).find((card) =>
                card.id === preferredId && card.selectable && card.uuid &&
                !this.isAttempted('cardClicked', [card.uuid]));
            if(pick) {
                return this.cardClickDecision(pick, 'stronghold-province-pick');
            }
        }

        if(title.includes('province order')) {
            const done = this.findButton(buttons, ['done']);
            if(done) {
                return this.buttonDecision(done, 'finish-province-order');
            }
        }

        // The dynasty window overrides the generic action-window prompt text.
        if(menuTitle === 'Initiate an action' || promptTitle === 'Play cards from provinces') {
            return this.actionWindowDecision(playerState, me, buttons, profile, context.cardHint, dishonor, context.dynastyCosts, context.conflictCosts, lion, duelist, shugenja, attachmentTower, crane, context.opponentConflictDeck, context.omniscient, context.legalDirectCardUuids);
        }

        if(promptTitle === 'Conflict Action Window') {
            return this.conflictWindowDecision(playerState, me, buttons, context.handStats, context.cardHint, profile, context.conflictCosts, context.omniscient, dishonor, lion, dragon, glory, duelist, shugenja, attachmentTower, crane, context.legalDirectCardUuids);
        }

        if(title.includes('where do you wish to play this character')) {
            const inConflict = !!playerState?.conflict?.type;
            const conflictButton = inConflict ? this.findButton(buttons, ['conflict']) : null;
            return this.buttonDecision(conflictButton || this.findButton(buttons, ['home']) || buttons[0], 'character-placement');
        }

        // Move-mode choice (Ride On and similar "move to the conflict / move
        // home" menus): pull the character INTO the conflict. The bot only
        // reaches this menu after choosing to play the card to add a body, so
        // moving in is the intended effect (and triggers move-in reactions).
        const moveIntoConflict = buttons.find((button) => /move .*to the conflict|move .*to conflict/i.test(String(button.text || '')));
        const moveHome = buttons.find((button) => /move .*home/i.test(String(button.text || '')));
        if(moveIntoConflict && moveHome) {
            const retreat = this.favorableGroundRetreatPending;
            this.favorableGroundRetreatPending = false;
            return this.buttonDecision(retreat ? moveHome : moveIntoConflict,
                retreat ? 'favorable-ground-move-home' : 'ride-move-in');
        }
        // Meddling Mediator: its unrestricted Action can keep taking value
        // after the opponent declares two conflicts. Fate first; when the
        // opponent has none, take honor.
        const takeFate = buttons.find((button) => String(button.text || '') === 'Take 1 fate');
        const takeHonor = buttons.find((button) => String(button.text || '') === 'Take 1 honor');
        if(shugenja && takeFate && takeHonor) {
            return this.buttonDecision((opponent?.stats?.fate ?? 0) > 0 ? takeFate : takeHonor,
                (opponent?.stats?.fate ?? 0) > 0 ? 'mediator-take-fate' : 'mediator-take-honor');
        }

        if(promptTitle.startsWith('Play ') || promptTitle === 'Choose an ability:') {
            // Dragon plays its dual-mode monks (Ancient Master, Tattooed
            // Wanderer, Togashi Acolyte) as ATTACHMENTS by preference. With
            // no own bearer, use character mode: attaching the Monk to an
            // opponent advances the card count but helps the wrong player.
            if(dragon || attachmentTower || (duelist && context.playCardId === 'tattooed-wanderer')) {
                const asAttachment = buttons.find((button) =>
                    String(button.text || '').toLowerCase().includes('as an attachment'));
                if(asAttachment && this.myCharactersInPlay(me).length > 0) {
                    const reason = attachmentTower
                        ? 'attachment-tower-play-as-attachment'
                        : duelist && context.playCardId === 'tattooed-wanderer'
                            ? 'duel-play-tattooed-wanderer-as-attachment'
                            : 'dragon-play-as-attachment';
                    return this.buttonDecision(asAttachment, reason);
                }
                if(dragon && asAttachment) {
                    const asCharacter = buttons.find((button) =>
                        String(button.text || '').toLowerCase().includes('as a character'));
                    if(asCharacter) {
                        return this.buttonDecision(asCharacter, 'dragon-play-as-character-no-bearer');
                    }
                }
            }
            // Isawa Tadaka enters ready and preserves the replaced non-unique
            // Shugenja's fate/attachments. Prefer the Disguised play whenever
            // the engine presents it as legal.
            if(shugenja && (context.playCardId === 'isawa-tadaka-2' || promptTitle.toLowerCase().includes('isawa tadaka'))) {
                const disguised = buttons.find((button) =>
                    String(button.text || '').toLowerCase().includes('with disguise'));
                if(disguised) {
                    return this.buttonDecision(disguised, 'tadaka-play-disguised');
                }
            }
            const play = buttons.find((button) => String(button.text || '').toLowerCase() !== 'cancel');
            return this.buttonDecision(play || this.findButton(buttons, ['cancel']), 'resolve-play-menu');
        }

        if(title.includes('additional fate')) {
            const fateAwareOverride = this.fateAwarePendingAdditionalFate !== null
                ? this.fateAwareAdditionalFateOverride(
                    profile.fateAwareEconomy,
                    context,
                    me,
                    dishonor,
                    lion,
                    dragon,
                    duelist,
                    shugenja,
                    attachmentTower
                )
                : null;
            const fateAwareButton = this.fateAwareAdditionalFateButton(
                buttons,
                context.playCost,
                fateAwareOverride?.desired
            );
            if(fateAwareButton) {
                return this.buttonDecision(fateAwareButton, fateAwareOverride?.reason || 'fate-aware-additional-fate');
            }
            const dishonorFate = dishonor?.desiredAdditionalFate(context.playCardId) ?? null;
            if(dishonorFate !== null) {
                return this.buttonDecision(
                    this.closestBidButton(buttons, dishonorFate),
                    'scorpion-important-character-fate'
                );
            }
            if(lion) {
                return this.buttonDecision(this.closestBidButton(buttons, lion.desiredAdditionalFate(context.playCardId)), 'lion-character-fate');
            }
            const attachmentFate = attachmentTower
                ? attachmentTower.desiredAdditionalFate(context.playCardId, me?.stats?.fate ?? 0, context.playCost)
                : null;
            if(attachmentFate !== null) {
                return this.buttonDecision(this.closestBidButton(buttons, attachmentFate), 'attachment-tower-fate');
            }
            const dragonFate = dragon ? dragon.desiredAdditionalFate(context.playCardId, context.playCost) : null;
            if(dragonFate !== null) {
                return this.buttonDecision(this.closestBidButton(buttons, dragonFate), 'dragon-tower-fate');
            }
            const towerFate = duelist
                ? duelist.desiredAdditionalFate(context.playCardId, me?.stats?.fate ?? 0, context.playCost)
                : null;
            if(towerFate !== null) {
                return this.buttonDecision(this.closestBidButton(buttons, towerFate), 'duel-tower-fate');
            }
            const desired = shugenja
                ? shugenja.desiredAdditionalFate(context.playCardId, me?.cardPiles?.hand || [], me?.stats?.fate ?? 0, context.playCost)
                : null;
            if(desired !== null) {
                return this.buttonDecision(this.closestBidButton(buttons, desired), 'tadaka-setup-fate');
            }
            const fateReserve = shugenja ? shugenja.desiredFateReserve(me, opponent) : undefined;
            return this.buttonDecision(this.pickFateButton(buttons, me, context.playCost, profile.aggressiveFate, fateReserve), 'additional-fate');
        }

        if(title.includes('how much fate') || title.includes('how much honor')) {
            // Consumed by Five Fires should remove the full affordable amount,
            // not the generic minimum of one. Its nested HandlerMenuPrompt has
            // no gameAction metadata, so identify the live prompt by its source
            // title as well as by a target hint when one is available.
            const isFiveFiresAmount = promptTitle.trim().toLowerCase() === 'consumed by five fires' ||
                context.targetHint?.sourceCardId === 'consumed-by-five-fires';
            if(isFiveFiresAmount) {
                const numeric = buttons
                    .map((button) => ({ button, value: parseInt(String(button.text), 10) }))
                    .filter((entry) => !isNaN(entry.value))
                    .sort((a, b) => b.value - a.value);
                if(numeric.length > 0) {
                    return this.buttonDecision(numeric[0].button, 'five-fires-max-fate');
                }
            }
            return this.buttonDecision(buttons[0], 'minimal-cost');
        }

        // Triggered ability windows ('Any reactions?' / 'Any interrupts to X?'):
        // fire own province and stronghold abilities, pass everything else.
        if(title.includes('any reaction') || title.includes('any interrupt')) {
            return this.triggeredWindowDecision(playerState, me, buttons, title, context.playCost, context.cardHint, profile, context.conflictCosts, lion, attachmentTower, duelist, context.duelMargin, context.interruptedEventIsMine);
        }

        // Opponent-forced "reveal N cards from your hand" selects (Daidoji
        // Harrier: the enemy then discards one of the revealed pair). The bot is
        // choosing from its OWN hand — reveal the least valuable cards so the
        // discard hurts least. Without a handler the bot has no decision here
        // and the prompt sits open, stalling the game (noProgress backstop).
        if(title.includes('reveal') && me.selectCard !== false) {
            const revealable = this.findVisibleCards(playerState)
                .filter((card) => card.selectable && card.uuid && !card.selected &&
                    !this.isAttempted('cardClicked', [card.uuid]))
                .sort((a, b) => (Number(a.cost) || 0) - (Number(b.cost) || 0));
            if(revealable.length > 0) {
                return this.cardClickDecision(revealable[0], 'reveal-cheapest-card');
            }
            const done = this.findButton(buttons, ['done']);
            if(done) {
                return this.buttonDecision(done, 'finish-reveal');
            }
        }

        // Illustrious Forge's reveal reaction digs the top 5 of the conflict
        // deck for an attachment: take the strongest weapon (ranked in the
        // Lion profile — the card summaries at this menu carry no stats).
        // The follow-up "attach to a character" select goes through the
        // generic attach targeting (fate-weighted, so it lands on a
        // character that persists).
        if((lion || attachmentTower) && menuTitle === 'Choose an attachment' &&
            (title.includes('illustrious forge') || context.targetHint?.sourceCardId === 'illustrious-forge')) {
            const selectable = this.findVisibleCards(playerState).filter((card) =>
                card.selectable && card.uuid && !this.isAttempted('cardClicked', [card.uuid]));
            const pick = attachmentTower
                ? attachmentTower.pickAttachment(selectable)
                : lion?.pickForgeAttachment(selectable);
            if(pick) {
                return this.cardClickDecision(pick, attachmentTower
                    ? 'attachment-tower-pick-attachment'
                    : 'forge-pick-attachment');
            }
        }

        // Phoenix glory-deck menus (all gated on the glory profile).
        if(glory) {
            // Kuroi Mori: switching the contested RING (steered by the
            // board's ring preference) beats switching the type.
            const ringSwitch = buttons.find((button) => String(button.text || '') === 'Switch the contested ring');
            if(ringSwitch) {
                return this.buttonDecision(ringSwitch, 'glory-kuroi-mori-ring');
            }
            // Court Games: honor our own participant over making the
            // opponent dishonor theirs.
            const courtHonor = buttons.find((button) => String(button.text || '').startsWith('Honor a friendly'));
            if(courtHonor) {
                return this.buttonDecision(courtHonor, 'glory-court-games-honor');
            }
            // Against the Waves (bow-or-ready menu on an own Shugenja):
            // always READY.
            const readyButton = buttons.find((button) => String(button.text || '') === 'Ready');
            if(readyButton && buttons.some((button) => String(button.text || '') === 'Bow')) {
                return this.buttonDecision(readyButton, 'glory-ready-shugenja');
            }
            // Asako Diplomat's follow-up: honor/dishonor per the side the
            // target pick went (tracked in diplomatChoice).
            const diplomatHonor = buttons.find((button) => String(button.text || '') === 'Honor this character');
            const diplomatDishonor = buttons.find((button) => String(button.text || '') === 'Dishonor this character');
            if(diplomatHonor && diplomatDishonor) {
                const pick = this.diplomatChoice === 'dishonor' ? diplomatDishonor : diplomatHonor;
                return this.buttonDecision(pick, `glory-diplomat-${this.diplomatChoice}`);
            }
        }

        if(shugenja) {
            // Against the Waves: always take Ready, never bow our Shugenja.
            const readyButton = buttons.find((button) => String(button.text || '') === 'Ready');
            if(readyButton && buttons.some((button) => String(button.text || '') === 'Bow')) {
                return this.buttonDecision(readyButton, 'shugenja-ready');
            }
        }

        // Shameful Display's follow-up menu: honor one of the two selected
        // characters, dishonor the other. When our selected participant can
        // still be honored, route the honor through it (the follow-up select
        // clicks our own card). When every own participant is already honored
        // the Honor prompt would only offer the ENEMY card — pick Dishonor
        // instead and aim it at their card; the leftover honor then no-ops on
        // our already-honored character. Exact text match — findButton's
        // substring match would hit 'Dishonor' when asked for 'honor'.
        if(menuTitle === 'Choose a character to:') {
            const ownHonorable = this.myCharactersInPlay(me).some((card) =>
                card.inConflict && !card.isHonored);
            const wanted = ownHonorable ? 'Honor' : 'Dishonor';
            const pick = buttons.find((button) => String(button.text || '') === wanted) ||
                buttons.find((button) => String(button.text || '') === 'Honor');
            if(pick) {
                return this.buttonDecision(pick, `shameful-${String(pick.text).toLowerCase()}-first`);
            }
        }

        // Court Games (any deck — the glory branch above already returns for
        // Phoenix): honor a friendly participant when one can still be
        // honored, otherwise dishonor an opposing participant. Both outcomes
        // are strictly positive; the untuned generic path would classify the
        // combined honor/dishonor actions as harmful and could pick the wrong
        // menu side. The follow-up select is side-restricted by the card, so
        // only the menu choice needs steering.
        const courtHonorBtn = buttons.find((button) => String(button.text || '').startsWith('Honor a friendly'));
        const courtDishonorBtn = buttons.find((button) => String(button.text || '').startsWith('Dishonor an opposing'));
        if(courtHonorBtn && courtDishonorBtn) {
            if(crane) {
                const honorOwn = crane.shouldHonorWithCourtGames(this.playbookContext(playerState, me, dishonor));
                return this.buttonDecision(honorOwn ? courtHonorBtn : courtDishonorBtn,
                    honorOwn ? 'crane-court-games-honor-engine' : 'crane-court-games-dishonor-threat');
            }
            const own = this.myCharactersInPlay(me)
                .filter((card) => card.inConflict && !card.isHonored)
                .sort((a, b) => this.gloryValue(b) - this.gloryValue(a));
            const enemy = (opponent?.cardPiles?.cardsInPlay || [])
                .filter((card: any) => card.type === 'character' && card.inConflict && !card.isDishonored)
                .sort((a: any, b: any) => this.gloryValue(b) - this.gloryValue(a));
            const honorOwn = own.length > 0 && (enemy.length === 0 || this.gloryValue(own[0]) >= this.gloryValue(enemy[0]));
            return this.buttonDecision(honorOwn ? courtHonorBtn : courtDishonorBtn,
                honorOwn ? 'court-games-honor-own-high-glory' : 'court-games-dishonor-enemy-high-glory');
        }

        // A Legion of One's "resolve this ability again" prompt: pay 1 fate off
        // the solitary attacker to DOUBLE the buff to +6/+0 — the swarm's biggest
        // single military swing, worth the fate to break a province. TAKE it.
        // (The character is already the lone participant we chose to fight with;
        // +6 wins/breaks far more than the 1 fate of survivability it costs.)
        const doneChoice = buttons.find((button) => String(button.text || '') === 'Done');
        const recurByFate = buttons.find((button) => /remove .*fate.*to resolve this ability again/i.test(String(button.text || '')));
        if(recurByFate) {
            return this.buttonDecision(recurByFate, 'a-legion-recur-double');
        }

        // The follow-up (and every other) "remove a fate from our own character
        // for no effect" menu is a pure trap — stripping fate off our own body
        // can kill it at the fate phase for nothing. Decline: take Done.
        const noEffectRemove = buttons.find((button) => /remove .*fate.*for no effect/i.test(String(button.text || '')));
        if(noEffectRemove && doneChoice) {
            return this.buttonDecision(doneChoice, 'decline-self-fate-removal');
        }

        // Banzai! (and any "lose 1 honor to resolve this ability again" recur):
        // the extra +2 military is strong and worth an honor, so take it as long
        // as we are not near the dishonor cliff (honor > 3). Always decline the
        // follow-up "lose 1 honor for NO effect" trap. Applies to every deck.
        if(doneChoice) {
            const noEffectHonor = buttons.find((button) => /lose .*honor.* for no effect/i.test(String(button.text || '')));
            if(noEffectHonor) {
                return this.buttonDecision(doneChoice, 'decline-no-effect-honor-loss');
            }
            const recurForHonor = buttons.find((button) => /lose .*honor.* to resolve this ability again/i.test(String(button.text || '')));
            if(recurForHonor) {
                const honorNow = me?.stats?.honor ?? 10;
                return this.buttonDecision(honorNow > 3 ? recurForHonor : doneChoice,
                    honorNow > 3 ? 'banzai-recur-for-honor' : 'banzai-decline-low-honor');
            }
        }

        if(menuTitle === 'Which ability would you like to use?' || menuTitle === 'Choose an event to respond to') {
            if(crane) {
                const switchType = buttons.find((button) => /switch the conflict type/i.test(String(button.text || '')));
                if(switchType && crane.shouldSwitchConflictType(this.playbookContext(playerState, me, dishonor))) {
                    return this.buttonDecision(switchType, 'crane-shukujo-improve-conflict-margin');
                }
            }
            const choice = buttons.find((button) => !['back', 'cancel'].includes(String(button.text || '').toLowerCase()));
            return this.buttonDecision(choice || buttons[0], 'choose-triggered-ability');
        }

        const ringResolution = this.ringResolutionDecision(playerState, me, promptTitle, menuTitle, buttons, dishonor);
        if(ringResolution) {
            return ringResolution;
        }

        if(title.includes('action window') || title.includes('action') || title.includes('reaction') || title.includes('interrupt')) {
            const pass = this.findButton(buttons, ['pass', 'done', 'no more actions', 'cancel']);
            if(pass) {
                return this.buttonDecision(pass, 'pass-window');
            }
        }

        // Only click rings when the prompt is actually asking for a ring;
        // outside conflicts every ring reports unselectable !== true, and a
        // stray ringClicked is rejected by the controller and stalls the bot.
        if(me.selectRing === true && /\bring\b/.test(title)) {
            // Togashi Tadakatsu: conflicts declared against him let US (the
            // defender) choose the element — hand the attacker the WORST
            // ring (lowest score: no fate pile, no board synergy).
            if(dragon && playerState?.conflict?.attackingPlayerId &&
                playerState.conflict.attackingPlayerId !== me.id) {
                const rings = Object.values(playerState?.rings || {}).filter((ring: any) =>
                    ring && ring.unselectable !== true && !this.isAttempted('ringClicked', [ring.element]));
                if(rings.length > 0) {
                    const worst: any = rings.sort((a: any, b: any) =>
                        this.ringScore(a, me, this.opponentPlayer(playerState, me), dishonor, glory, undefined, shugenja) -
                        this.ringScore(b, me, this.opponentPlayer(playerState, me), dishonor, glory, undefined, shugenja))[0];
                    return { command: 'ringClicked', args: [worst.element], target: worst.element, reason: 'dragon-worst-ring-for-attacker' };
                }
            }
            const ringDecision = this.ringDecision(playerState, me, title, dishonor, glory, dragon, shugenja, attachmentTower);
            if(ringDecision) {
                return ringDecision;
            }
        }

        // An ability that must pay its cost before targets can be chosen
        // surfaces a "Pay costs first" button next to the target prompt. Clicking
        // the target instead is rejected and loops (Isawa Ujina's forced remove-
        // from-game). Click the cost button to advance — but only once per prompt
        // signature, so a cost we cannot actually pay falls through to the target
        // pick / Cancel below instead of re-clicking forever.
        const payCosts = this.findButton(buttons, ['pay costs first']);
        const maySelectCard = me.selectCard !== false;
        // Check visible target polarity before making payment irreversible.
        // Storied Defeat can be rules-legal after our character loses a duel;
        // paying first removes Cancel and otherwise forces self-harm.
        if(payCosts && maySelectCard && context.targetHint) {
            const preCostDecision = this.cardDecision(
                playerState,
                me,
                title,
                buttons,
                context.targetHint,
                context.cardHint,
                profile,
                context.handStats,
                context.conflictCosts,
                dishonor,
                glory,
                lion,
                dragon,
                duelist,
                shugenja,
                attachmentTower,
                crane,
                attachmentControl
            );
            if(preCostDecision && [
                'cancel-wrong-side-target',
                'cancel-redundant-debuff-attachment'
            ].includes(preCostDecision.reason)) {
                return preCostDecision;
            }
        }
        if(payCosts && this.payCostsSignature !== this.lastSignature) {
            this.payCostsSignature = this.lastSignature;
            return this.buttonDecision(payCosts, 'pay-costs-first');
        }

        // Some menu-only prompts inherit stale selectable-card flags from the
        // preceding card prompt. A real select prompt says selectCard=true; a
        // synthetic prompt with no buttons keeps the legacy card fallback.
        const cardDecision = maySelectCard
            ? this.cardDecision(
                playerState,
                me,
                title,
                buttons,
                context.targetHint,
                context.cardHint,
                profile,
                context.handStats,
                context.conflictCosts,
                dishonor,
                glory,
                lion,
                dragon,
                duelist,
                shugenja,
                attachmentTower,
                crane,
                attachmentControl
            )
            : null;
        if(cardDecision) {
            return cardDecision;
        }

        // Never spam 'Pay costs first' or 'Back' as a generic fallback — both
        // can bounce the same prompt back forever. Prefer a real resolution
        // button, then anything else (Cancel aborts cleanly), and only take
        // the loop-prone buttons when nothing else exists.
        const loopProne = (button: any) => ['pay costs first', 'back'].includes(String(button.text || '').toLowerCase());
        const preferredButton = this.findButton(buttons, ['done', 'pass', 'yes', 'ok']) ||
            buttons.find((button) => !loopProne(button)) ||
            buttons[0];
        return this.buttonDecision(preferredButton, 'fallback-button');
    }

    private myPlayer(playerState: any, botName?: string): any {
        const players = playerState?.players || {};
        if(botName && players[botName]) {
            return players[botName];
        }

        // Fallback for callers that do not pass a name; prefer a player with an
        // actionable prompt over one showing only a waiting menu title.
        const names = Object.keys(players);
        const withPrompt = names.find((name) => players[name]?.promptTitle);
        const withMenu = names.find((name) => players[name]?.menuTitle);
        const activeName = withPrompt || withMenu;
        return activeName ? players[activeName] : null;
    }

    private opponentPlayer(playerState: any, me: any): any {
        const players = playerState?.players || {};
        const opponentName = Object.keys(players).find((name) => players[name] !== me);
        return opponentName ? players[opponentName] : null;
    }

    private enabledButtons(prompt: any): any[] {
        return (prompt.buttons || []).filter((button: any) => !button.disabled);
    }

    private findButton(buttons: any[], texts: string[]): any {
        return buttons.find((button) => {
            const buttonText = String(button.text || '').toLowerCase();
            return texts.some((text) => buttonText === text || buttonText.includes(text));
        });
    }

    private decisionKey(decision: BotDecision): string {
        return `${decision.command}:${decision.args.map((arg) => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(',')}`;
    }

    private isAttempted(command: BotCommandName, args: any[]): boolean {
        return this.attempted.has(this.decisionKey({ command, args, reason: '' }));
    }

    private buttonDecision(button: any, reason: string): BotDecision | null {
        if(!button) {
            return null;
        }

        return {
            command: 'menuButton',
            args: [button.arg, button.uuid, button.method],
            target: button.text || String(button.arg),
            reason
        };
    }

    private cardClickDecision(card: any, reason: string): BotDecision {
        return {
            command: 'cardClicked',
            args: [card.uuid],
            target: card.name || card.uuid,
            reason
        };
    }

    private isDirectCardLegal(card: any, legalDirectCardUuids?: Record<string, true>): boolean {
        return !legalDirectCardUuids || !!(card?.uuid && legalDirectCardUuids[card.uuid]);
    }

    private cardBelongsToPlayer(card: any, player: any, knownUuids: Set<string>): boolean {
        const controllerName = typeof card?.controller === 'string'
            ? card.controller
            : card?.controller?.name;
        return knownUuids.has(card?.uuid) || (!!controllerName && controllerName === player?.name);
    }

    private skillValue(card: any, type: string): number | null {
        const summary = type === 'political' ? card.politicalSkillSummary : card.militarySkillSummary;
        const stat = summary?.stat;
        if(stat === undefined || stat === null || stat === '-') {
            return null;
        }

        const value = Number(stat);
        return isNaN(value) ? null : value;
    }

    private combinedSkillValue(card: any): number {
        return Math.max(this.skillValue(card, 'military') || 0, 0) +
            Math.max(this.skillValue(card, 'political') || 0, 0);
    }

    // Dishonor decks at their honor floor stop declaring characters whose
    // declaration bleeds honor (Marauding Oni's forced reaction) — unless no
    // one else can fight. Inert for every other deck (dishonor is null).
    private withoutHonorCostDeclares(cards: any[], dishonor: DishonorTactics | null, honor: number, cardHint?: CardHintLookup): any[] {
        if(!dishonor || !cardHint || dishonor.canPayHonor(honor)) {
            return cards;
        }
        const filtered = cards.filter((card) => !(card.id && (cardHint(card.id) as any)?.declareCostsHonor));
        return filtered.length > 0 ? filtered : cards;
    }

    // The stronghold province is under attack: breaking it loses the GAME, so
    // every defense cap (win-only concedes, prevent-break sizing, hopeless
    // folds, card-spend gates) is overridden — throw everything at it.
    private strongholdUnderAttack(me: any): boolean {
        return strongholdProvinceUnderAttack(me);
    }

    private strongholdDefenseCharacter(card: any): StrongholdDefenseCharacter {
        return {
            uuid: String(card.uuid),
            military: Math.max(this.skillValue(card, 'military') || 0, 0),
            political: Math.max(this.skillValue(card, 'political') || 0, 0),
            covert: !!card.covert
        };
    }

    private strongholdDefensePlan(me: any, opponent: any, profile: DeckProfile,
        omni?: Omniscient, exactStrength?: number): StrongholdDefensePlan {
        const visibleProvince = (me?.strongholdProvince || []).find((card: any) =>
            card.isProvince !== false && (card.isProvince || card.type === 'province' || card.facedown));
        const visibleStrength = Number(visibleProvince?.strengthSummary?.stat);
        const strength = Number.isFinite(exactStrength) ? Number(exactStrength) :
            (Number.isFinite(visibleStrength) ? visibleStrength : 3);
        const theirReady = this.myCharactersInPlay(opponent).filter((card) => !card.bowed);
        const handThreat = omni ? {
            military: this.omniHandThreat(omni, 'military').skill,
            political: this.omniHandThreat(omni, 'political').skill
        } : undefined;
        const tactics = new StrongholdDefenseTactics(profile.strongholdDefense);
        return tactics.plan({
            active: mustAttackStronghold(me),
            opponentStrongholdExposed: mustAttackStronghold(opponent),
            strongholdProvinceStrength: strength,
            myReady: this.readyCharacters(me).map((card) => this.strongholdDefenseCharacter(card)),
            opponentReady: theirReady.map((card) => this.strongholdDefenseCharacter(card)),
            opponentConflictsRemaining: opponent?.stats?.conflictsRemaining,
            opponentMilitaryRemaining: opponent?.stats?.militaryRemaining,
            opponentPoliticalRemaining: opponent?.stats?.politicalRemaining,
            handThreat,
            defenderDisables: omni?.affordableDefenderDisables,
            omniscient: !!omni
        });
    }

    // The own province currently under attack (regular slots or stronghold).
    private attackedOwnProvince(me: any): any {
        return PROVINCE_KEYS
            .map((key) => me?.provinces?.[key] || [])
            .concat([me?.strongholdProvince || []])
            .map((list) => (list || []).find((card: any) => card.isProvince && card.inConflict))
            .find(Boolean);
    }

    // The Art of War draws 3 when it BREAKS — the break is the payoff, so
    // defending it is anti-value: concede, take the cards, keep attacking.
    // But only EARLY: an unconditional concede fed the opponent's conquest
    // race a free province every game (Lion vs Crane 44% pooled N=80, was
    // ~65%+). Once two own provinces are broken, every further break walks
    // the attacker toward the stronghold — defend it like any province.
    private shouldConcedeProvince(me: any): boolean {
        if(this.attackedOwnProvince(me)?.id !== 'the-art-of-war') {
            return false;
        }
        const broken = PROVINCE_KEYS
            .map((key) => (me?.provinces?.[key] || []).find((card: any) => card.isProvince))
            .filter((card: any) => card && card.isBroken).length;
        return broken <= 1;
    }

    private myCharactersInPlay(me: any): any[] {
        return (me?.cardPiles?.cardsInPlay || []).filter((card: any) => card.type === 'character' && card.uuid);
    }

    private readyCharacters(me: any): any[] {
        return this.myCharactersInPlay(me).filter((card: any) => !card.bowed);
    }

    private sortBySkillDesc(cards: any[], type: string): any[] {
        return cards.slice().sort((a, b) => {
            const skillDiff = (this.skillValue(b, type) || 0) - (this.skillValue(a, type) || 0);
            return skillDiff !== 0 ? skillDiff : String(a.uuid).localeCompare(String(b.uuid));
        });
    }

    // The legal bid button nearest the desired value (lower on ties).
    private closestBidButton(buttons: any[], desired: number): any {
        const numeric = buttons
            .map((button) => ({ button, value: parseInt(String(button.text), 10) }))
            .filter((entry) => !isNaN(entry.value));

        if(numeric.length === 0) {
            return buttons[0];
        }

        numeric.sort((a, b) => {
            const distance = Math.abs(a.value - desired) - Math.abs(b.value - desired);
            return distance !== 0 ? distance : a.value - b.value;
        });
        return numeric[0].button;
    }

    // Duel honor bid keyed on the base skill gap (our side - their side), with
    // the dial spanning 1..5. A duel is decided by (skill + bid), so:
    //  - gap >= 0 : we already win or tie on skill, bid the max to win/equalize
    //    (worth the honor we pay the loser for the duel payoff);
    //  - gap <= -4 : even a max bid cannot close the gap against any bid they
    //    make, so bid 1 and bank the honor their higher bid pays us;
    //  - gap of -1..-3 : winnable only if they bid low — a gamble. Commit the
    //    max when we are honor-rich (can afford to bleed a few honor), bid 1 to
    //    bank honor when we are poor.
    private duelBidForGap(gap: number, honor: number): number {
        // A duel is decided by (skill + bid), bids 1..5, and the LOWER bidder
        // takes the difference in honor — so even winning with a high bid pays
        // the loser. Safety rails:
        //  - near the dishonor cliff (honor <= 3) never bleed honor for a duel;
        //  - when comfortably ahead, bid only the MINIMUM that still wins
        //    against their max bid of 5 (gap>=5 wins on any bid -> 1; gap 4->2,
        //    3->3, 2->4), banking the honor a flat 5 would have paid away;
        //  - gap 0-1 needs the full 5 to secure the win/tie;
        //  - behind 4+ is unwinnable -> 1; behind 1-3 is an honor-gated gamble.
        if(honor <= 3) {
            return 1;
        }
        if(gap >= 5) {
            return 1;
        }
        if(gap >= 2) {
            return 6 - gap;
        }
        if(gap >= 0) {
            return 5;
        }
        if(gap <= -4) {
            return 1;
        }
        return honor >= 8 ? 5 : 1;
    }

    // Draw-phase honor bid: bid to DRAW cards (you draw cards equal to your
    // bid; the LOWER bidder takes the difference in honor). Cards win games, so
    // spend the honor the pool can spare. honor >= 7: bid the max 5. honor 4-6:
    // bid 3 — three cards without risking the 0-honor cliff if outbid. honor
    // <= 3: bid 1, never gamble into a dishonor defeat. Scorpion is excluded by
    // its dishonor branch (it wants to feed the opponent honor, not draw).
    private drawBidForHonor(honor: number, opponentHonor: number): number {
        let bid = honor <= 3 ? 1 : honor >= 7 ? 5 : 3;
        // The LOWER bidder takes the honor difference, so a high bid feeds the
        // opponent AND drains us. Against a climbing honor opponent (Crane), do
        // not fuel a 25-honor win: near it, bid the MINIMUM so WE are the low
        // bidder and drain THEM; while it is building, cap the feed.
        if(opponentHonor >= 18) {
            bid = 1;
        } else if(opponentHonor >= 14) {
            bid = Math.min(bid, 2);
        }
        // Self safety: if outbid to 1 we lose (bid - 1) honor — keep a small
        // buffer so a single bad dial cannot drop us to the dishonor cliff. Kept
        // light (2) so the honor 4-6 / 7+ tiers still draw aggressively.
        while(bid > 1 && honor - (bid - 1) < 2) {
            bid--;
        }
        return bid;
    }

    // Fate placed on a character keeps it alive across fate phases, so scale
    // the investment with the character's printed cost: cheap bodies are
    // disposable, mid-cost characters get 1, expensive powerhouses get 2+.
    private pickFateButton(buttons: any[], me: any, playCost?: number, aggressive = false, reserveOverride?: number): any {
        const fate = me?.stats?.fate ?? 0;
        const numeric = buttons
            .map((button) => ({ button, value: parseInt(String(button.text), 10) }))
            .filter((entry) => !isNaN(entry.value));
        if(numeric.length === 0) {
            return buttons[0];
        }

        // A military-rush deck floods the board with cheap bodies and races to
        // break provinces before they die, so it never over-invests fate: 0 on
        // cheap characters, at most 1 on anything pricier. Nothing gets a
        // powerhouse's 2-fate treatment.
        if(aggressive) {
            const desired = playCost !== undefined && playCost <= 2 ? 0 : 1;
            numeric.sort((a, b) => {
                const distance = Math.abs(a.value - desired) - Math.abs(b.value - desired);
                return distance !== 0 ? distance : a.value - b.value;
            });
            return numeric[0].button;
        }

        let desired;
        if(playCost === undefined) {
            // Cost unknown (state-only callers): keep the old frugal behavior.
            desired = fate >= 5 ? 1 : 0;
        } else if(playCost <= 2) {
            desired = 0;
        } else if(playCost <= 4) {
            desired = 1;
        } else {
            desired = 2;
        }

        if(playCost !== undefined && desired > 0) {
            // Spend more freely when rich.
            if(fate - playCost - desired >= 4) {
                desired += 1;
            }
            // Keep 1 fate in reserve for conflict cards — but an expensive
            // character IS the investment: for cost 5+ spend the reserve
            // rather than drop a powerhouse onto the board with no fate.
            const reserve = reserveOverride ?? (playCost >= 5 ? 0 : 1);
            while(desired > 0 && fate - playCost - desired < reserve) {
                desired -= 1;
            }
        }

        numeric.sort((a, b) => {
            const distance = Math.abs(a.value - desired) - Math.abs(b.value - desired);
            return distance !== 0 ? distance : a.value - b.value;
        });
        return numeric[0].button;
    }

    private fateAwareAdditionalFateButton(buttons: any[], playCost?: number, desiredOverride?: number): any | null {
        if(!this.usesFateAwareEconomy() || this.fateAwarePendingAdditionalFate === null) {
            return null;
        }

        const cap = this.fateAwarePendingAdditionalFateCap ?? this.fateAwarePendingAdditionalFate;
        const desired = Math.min(cap, Math.max(0, desiredOverride ?? this.fateAwarePendingAdditionalFate));
        const cost = playCost ?? this.fateAwarePendingCost ?? 0;
        this.fateAwareBoughtCharacter = true;
        if(this.fateAwarePendingDurable) {
            this.fateAwareDurableSpent += cost + desired;
        }
        this.fateAwareStrongCharacter ||= this.fateAwarePendingDurable;
        this.fateAwarePendingAdditionalFate = null;
        this.fateAwarePendingAdditionalFateCap = null;
        this.fateAwarePendingCost = undefined;
        this.fateAwarePendingDurable = false;
        return this.closestBidButton(buttons, desired);
    }

    private fateAwareAdditionalFateOverride(
        economy: FateAwareEconomyProfile,
        context: DecideContext,
        me: any,
        dishonor: DishonorTactics | null,
        lion: LionTactics | null,
        dragon: DragonTactics | null,
        duelist: DuelTactics | null,
        shugenja: ShugenjaTactics | null,
        attachmentTower: DragonAttachmentTactics | null
    ): FateAwareAdditionalFateOverride | null {
        if(!economy.preferDeckAdditionalFate) {
            return null;
        }
        const dishonorFate = dishonor?.desiredAdditionalFate(context.playCardId) ?? null;
        if(dishonorFate !== null) {
            return { desired: dishonorFate, reason: 'scorpion-important-character-fate' };
        }
        if(lion) {
            return { desired: lion.desiredAdditionalFate(context.playCardId), reason: 'lion-character-fate' };
        }
        const attachmentFate = attachmentTower
            ? attachmentTower.desiredAdditionalFate(context.playCardId, me?.stats?.fate ?? 0, context.playCost)
            : null;
        if(attachmentFate !== null) {
            return { desired: attachmentFate, reason: 'attachment-tower-fate' };
        }
        const dragonFate = dragon ? dragon.desiredAdditionalFate(context.playCardId, context.playCost) : null;
        if(dragonFate !== null) {
            return { desired: dragonFate, reason: 'dragon-tower-fate' };
        }
        const duelFate = duelist
            ? duelist.desiredAdditionalFate(context.playCardId, me?.stats?.fate ?? 0, context.playCost)
            : null;
        if(duelFate !== null) {
            return { desired: duelFate, reason: 'duel-tower-fate' };
        }
        const shugenjaFate = shugenja
            ? shugenja.desiredAdditionalFate(
                context.playCardId,
                me?.cardPiles?.hand || [],
                me?.stats?.fate ?? 0,
                context.playCost
            )
            : null;
        return shugenjaFate === null
            ? null
            : { desired: shugenjaFate, reason: 'tadaka-setup-fate' };
    }

    private conflictDeclarationDecision(playerState: any, me: any, opponent: any, promptTitle: string, menuTitle: string, buttons: any[], profile: DeckProfile = DEFAULT_PROFILE, omni?: Omniscient, strongholdProvinceStrength?: number, dishonor: DishonorTactics | null = null, cardHint?: CardHintLookup, glory: GloryTactics | null = null, dragon: DragonTactics | null = null, duelist: DuelTactics | null = null, shugenja: ShugenjaTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null, lion: LionTactics | null = null, crane: CraneBaselineTactics | null = null, legalDirectCardUuids?: Record<string, true>, legalRingElements?: Record<string, true>): BotDecision | null {
        const lowerMenu = menuTitle.toLowerCase();
        const ready = this.readyCharacters(me).filter((card) => this.isDirectCardLegal(card, legalDirectCardUuids));
        const conflictMatch = promptTitle.match(CONFLICT_TITLE_REGEX);
        const conflictType = conflictMatch ? conflictMatch[1].toLowerCase() : null;
        const strongholdPlan = this.strongholdDefensePlan(me, opponent, profile, omni, strongholdProvinceStrength);
        const reserved = new Set(strongholdPlan.reserveUuids);

        if(lowerMenu.includes('elemental ring')) {
            const passButton = this.findButton(buttons, ['pass conflict']);
            if(strongholdPlan.active && strongholdPlan.mode === 'hold-all' && passButton) {
                return this.buttonDecision(passButton, strongholdPlan.reason);
            }
            const canAttack = ready.some((card) => !reserved.has(String(card.uuid)) &&
                ((this.skillValue(card, 'military') || 0) > 0 || (this.skillValue(card, 'political') || 0) > 0));
            if(!canAttack && passButton) {
                return this.buttonDecision(passButton, strongholdPlan.active ? 'stronghold-no-free-attacker' : 'pass-no-attackers');
            }

            const rings = Object.values(playerState?.rings || {})
                .filter((ring: any) => ring && ring.unselectable !== true && !ring.claimed)
                .sort((a: any, b: any) => {
                    const scoreDiff = this.ringScore(b, me, opponent, dishonor, glory, dragon, shugenja, duelist, attachmentTower) - this.ringScore(a, me, opponent, dishonor, glory, dragon, shugenja, duelist, attachmentTower);
                    if(scoreDiff !== 0) {
                        return scoreDiff;
                    }
                    return RING_ORDER.indexOf(a.element) - RING_ORDER.indexOf(b.element);
                });

            const ring: any = rings.find((candidate: any) => !this.isAttempted('ringClicked', [candidate.element]));
            if(ring) {
                return {
                    command: 'ringClicked',
                    args: [ring.element],
                    target: ring.element,
                    reason: 'declare-conflict-ring'
                };
            }

            return passButton ? this.buttonDecision(passButton, 'pass-no-legal-ring') : null;
        }

        if(lowerMenu.includes('choose province')) {
            // The chosen ring carried a default conflict type that may not
            // match the side our characters are strong in (e.g. a political
            // earth ring with a 6-military/3-political board). Clicking the
            // ring again toggles military/political before committing.
            if(conflictType && conflictMatch) {
                // Seed 5 picks the axis by REAL advantage (my board minus
                // their board minus their affordable hand tricks). Measured:
                // in a SAME-DECK mirror it loses a few points (symmetric
                // boards - their weak axis is ours too), but in the real
                // cross-deck setting (bot deck vs the human's Crane) it is
                // neutral-to-positive at N=100: Phoenix 40%->44%,
                // CraneDuels 52%->52%. Kept - it exploits hand knowledge
                // exactly where a human opponent differs from the bot.
                const preferredType = omni
                    ? this.omniPreferredConflictType(me, opponent, omni, profile.forceMilitaryConflict)
                    : this.preferredConflictType(me, profile.forceMilitaryConflict);
                const preferredRemaining = preferredType === 'military'
                    ? Number(me?.stats?.militaryRemaining)
                    : Number(me?.stats?.politicalRemaining);
                const element = conflictMatch[2].toLowerCase();
                if(conflictType !== preferredType && (!Number.isFinite(preferredRemaining) || preferredRemaining > 0) &&
                    (!legalRingElements || !!legalRingElements[element]) &&
                    !this.isAttempted('ringClicked', [element])) {
                    return {
                        command: 'ringClicked',
                        args: [element],
                        target: element,
                        reason: 'switch-conflict-type'
                    };
                }
            }
            return this.attackProvinceDecision(opponent, omni, legalDirectCardUuids);
        }

        if(lowerMenu.includes('covert')) {
            const targets = this.sortBySkillDesc(
                (opponent?.cardPiles?.cardsInPlay || []).filter((card: any) =>
                    card.type === 'character' && card.uuid && !card.bowed && !card.covert &&
                    this.isDirectCardLegal(card, legalDirectCardUuids) &&
                    !this.isAttempted('cardClicked', [card.uuid])),
                conflictType || 'military'
            );
            if(targets.length > 0) {
                return this.cardClickDecision(targets[0], 'covert-defender');
            }
        }

        if(lowerMenu.includes('choose attackers') || lowerMenu.includes('skill:') || lowerMenu.includes('covert')) {
            const type = conflictType || 'military';
            const committed = this.myCharactersInPlay(me).filter((card) => card.inConflict);
            const finalStrongholdPush = this.strongholdUnderAttack(opponent);
            const legalUncommitted = ready.filter((card) =>
                !card.inConflict && !reserved.has(String(card.uuid)));
            const eligible = legalUncommitted.filter((card) => (this.skillValue(card, type) || 0) > 0);
            const candidates = this.sortBySkillDesc(
                finalStrongholdPush
                    ? eligible
                    : this.withoutHonorCostDeclares(eligible, dishonor, me?.stats?.honor ?? 10, cardHint),
                type
            );

            // Cautious Scout blanks a facedown province only while attacking
            // alone; Brash Samurai honors itself only while it is the sole
            // participant. Commit exactly one and immediately initiate rather
            // than letting the generic break calculator add another attacker on
            // the following prompt pass.
            if(crane) {
                const attackedFacedown = PROVINCE_KEYS
                    .map((key) => opponent?.provinces?.[key] || [])
                    .concat([opponent?.strongholdProvince || []])
                    .some((list) => (list || []).some((card: any) =>
                        card.inConflict && card.facedown && !card.isBroken));
                if(committed.length === 0) {
                    const solo = crane.pickSoloAttacker(candidates, attackedFacedown);
                    if(solo && !this.isAttempted('cardClicked', [solo.uuid])) {
                        return this.cardClickDecision(solo, solo.id === 'cautious-scout'
                            ? 'crane-scout-hidden-province-alone'
                            : 'crane-brash-attack-alone');
                    }
                } else if(committed.length === 1 &&
                    ['cautious-scout', 'brash-samurai'].includes(committed[0].id)) {
                    const initiateSolo = this.findButton(buttons, ['initiate conflict']);
                    if(initiateSolo) {
                        return this.buttonDecision(initiateSolo, 'crane-initiate-solo-conflict');
                    }
                }
            }

            // The attack exists to break the province: a province breaks when
            // the attacker wins by at least its strength, so commit skill
            // until the total clears the province plus the opponent's full
            // possible defense. When even everyone together cannot reach
            // that, normal profiles keep their configured home defense; a
            // final stronghold push sends everyone because breaking it wins.
            const skillOf = (card: any) => Math.max(this.skillValue(card, type) || 0, 0);
            const committedSkill = committed.reduce((total, card) => total + skillOf(card), 0);
            const potentialSkill = committedSkill + candidates.reduce((total, card) => total + skillOf(card), 0);
            const defenseEstimate = (opponent?.cardPiles?.cardsInPlay || [])
                .filter((card: any) => card.type === 'character' && !card.bowed)
                .reduce((total: number, card: any) => total + skillOf(card), 0);
            // Seed 5 uses the TRUE strength of the (even face-down) province being
            // attacked instead of the heuristic's guess-4 fallback, so it sizes
            // the break correctly. NOTE: folding the human's affordable HAND
            // defense into this estimate was tried and MEASURED NET-NEGATIVE — it
            // made the bot over-commit against defense that never materialized
            // and lose bodies it needed for later conflicts (self-play mirror
            // dropped below 50%). The hand analysis (estimateHandThreat) is kept
            // and unit-tested for a future, more careful use; the live edge is
            // weakest-province targeting + true province strength.
            const provinceStrength = omni ? this.omniAttackedStrength(opponent, omni) : this.attackedProvinceStrength(opponent, 4);
            const breakTarget = provinceStrength + defenseEstimate;
            const totalEligible = committed.length + candidates.length;

            // Lion's For Greater Glory puts fate on every Bushi in the
            // breaking military conflict. Once the minimum break is secured,
            // bring additional zero-fate Bushi so the reaction turns expiring
            // swarm bodies into next-round attackers (and enables Gohei's
            // three-Bushi no-bow line). This is Lion-profile-only.
            const greaterGloryReady = !!lion && type === 'military' &&
                (me?.stats?.fate ?? 0) >= 1 &&
                (me?.cardPiles?.hand || []).some((card: any) =>
                    card.id === 'for-greater-glory' && card.isPlayableByMe) &&
                potentialSkill >= breakTarget;
            const payoffCandidate = greaterGloryReady ? candidates.find((card) =>
                (Number(card.fate) || 0) === 0 && (card.traits || []).includes('bushi') &&
                !this.isAttempted('cardClicked', [card.uuid])) : null;

            // A pure turtle ('breakable-or-hold') only commits an attack it can
            // actually break; when the break is out of reach it keeps every body
            // home and passes the conflict rather than throwing skill away.
            if(!finalStrongholdPush && profile.attackCommitment === 'breakable-or-hold' && potentialSkill < breakTarget) {
                const passButton = this.findButton(buttons, ['pass conflict']);
                if(committed.length === 0 && passButton) {
                    return this.buttonDecision(passButton, 'defensive-hold');
                }
            }

            // Once the break is reachable, commit exactly enough skill to secure
            // it. When it is not, how many bodies to send is the deck's profile:
            //   'all'                  — every body (rush swarm payoffs).
            //   'all-but-one'          — all but a stay-home defender (generic).
            //   'breakable-or-hold'    — none (handled above; turtle).
            //   'breakable-or-pressure'— all but `attackKeepHome`, so a defensive
            //                            deck still pressures instead of conceding
            //                            the whole conflict (keeps wall bodies home).
            // Final stronghold pushes override these caps and commit all eligible
            // attackers when a guaranteed break is not yet reachable.
            const keepHome = Math.max(1, profile.attackKeepHome);
            const unbreakableCommit =
                strongholdPlan.forceAllAttackers ? committed.length < totalEligible
                    : finalStrongholdPush ? committed.length < totalEligible
                    : profile.attackCommitment === 'all' ? committed.length < totalEligible
                        : profile.attackCommitment === 'breakable-or-hold' ? false
                            : profile.attackCommitment === 'breakable-or-pressure' ? committed.length < Math.max(1, totalEligible - keepHome)
                                : committed.length < Math.max(1, totalEligible - 1);
            const needMore = strongholdPlan.forceAllAttackers
                ? committed.length < totalEligible
                : potentialSkill >= breakTarget
                    ? committedSkill < breakTarget || !!payoffCandidate
                : unbreakableCommit;

            if(needMore) {
                const next = payoffCandidate || candidates.find((card) => !this.isAttempted('cardClicked', [card.uuid]));
                if(next) {
                    return this.cardClickDecision(next, 'declare-attacker');
                }
            }

            const initiate = this.findButton(buttons, ['initiate conflict']);
            if(committed.length > 0 && initiate) {
                return this.buttonDecision(initiate, 'initiate-conflict');
            }

            const forcedPick = candidates.find((card) => !this.isAttempted('cardClicked', [card.uuid]));
            if(forcedPick) {
                return this.cardClickDecision(forcedPick, 'declare-attacker');
            }

            // A zero-skill character can still be a legal attacker (printed 0,
            // unlike a dash). This matters when Tadakatsu lets the defender
            // choose a ring and only that conflict type remains: filtering on
            // positive skill left the engine at an unfinishable Choose
            // attackers prompt. Prefer useful positive skill above, but use an
            // engine-legal zero-skill body when it is the only way forward.
            const zeroSkillPick = legalUncommitted.find((card) =>
                !this.isAttempted('cardClicked', [card.uuid]));
            if(zeroSkillPick) {
                return this.cardClickDecision(zeroSkillPick, 'declare-zero-skill-attacker');
            }

            const passButton = this.findButton(buttons, ['pass conflict']);
            if(passButton) {
                return this.buttonDecision(passButton, 'pass-no-attackers');
            }
        }

        return null;
    }

    // Ring value for conflict declaration. Fate accumulated on a ring (2+)
    // dominates — taking it is a straight fate boost, highest pile first.
    // Otherwise: void is the strongest effect but only when the opponent has
    // a character with fate to strip; earth (draw + opponent discard) is
    // always good; fire (honor/dishonor) is decent. Water is situational:
    // strong when the opponent has multiple ready no-fate characters to bow,
    // mildly useful for readying an own bowed character while more conflicts
    // remain, dead otherwise. Air trails. The ring's displayed conflict type
    // is irrelevant — any ring can be flipped military/political by clicking
    // it again, which happens separately based on character strength.
    private ringScore(ring: any, me: any, opponent: any, dishonor: DishonorTactics | null = null, glory: GloryTactics | null = null, dragon: DragonTactics | null = null, shugenja: ShugenjaTactics | null = null, duelist: DuelTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null): number {
        const fate = Number(ring.fate) || 0;
        const fateThreshold = this.usesFateAwareEconomy() ? 1 : 2;
        const fateComponent = fate >= fateThreshold ? 1000 + fate * 100 : 0;

        // The dishonor deck's honor-drain engine is the air ring: boost it
        // past the generic ordering (fate piles still dominate).
        if(dishonor && ring.element === 'air') {
            return fateComponent + 15 + dishonor.airRingBonus;
        }

        let base;
        switch(ring.element) {
            case 'void': {
                const voidUseful = (opponent?.cardPiles?.cardsInPlay || []).some((card: any) =>
                    card.type === 'character' && (Number(card.fate) || 0) > 0);
                base = voidUseful ? 50 : 10;
                break;
            }
            case 'earth':
                base = 40;
                break;
            case 'fire':
                base = 30;
                break;
            case 'water': {
                // Bowing only targets characters without fate, and only
                // matters when the opponent has several ready bodies.
                const bowTargets = (opponent?.cardPiles?.cardsInPlay || []).filter((card: any) =>
                    card.type === 'character' && !card.bowed && (Number(card.fate) || 0) === 0).length;
                const myBowed = this.myCharactersInPlay(me).some((card) => card.bowed);
                const moreConflictsComing = (me?.stats?.conflictsRemaining ?? 0) >= 2;
                if(bowTargets >= 2) {
                    base = 35;
                } else if(myBowed && moreConflictsComing) {
                    base = 25;
                } else {
                    base = 8;
                }
                break;
            }
            default:
                base = 15;
        }

        // Glory decks steer toward the ring their BOARD exploits (Solemn
        // Scholar wants earth claimed, the void masters want void, the water
        // package wants water) — scaled per matching card in play/hand.
        const gloryBonus = glory
            ? glory.ringBonus(String(ring.element || ''), this.myCharactersInPlay(me), me?.cardPiles?.hand || [])
            : 0;
        // Dragon: void recursion (Keeper Initiate returns from the dynasty
        // discard when void is claimed).
        const dragonBonus = dragon
            ? dragon.ringBonus(String(ring.element || ''), me?.cardPiles?.dynastyDiscardPile || [])
            : 0;
        const shugenjaBonus = shugenja
            ? shugenja.ringBonus(String(ring.element || ''), this.myCharactersInPlay(me), me?.cardPiles?.hand || [])
            : 0;
        const duelBonus = duelist
            ? duelist.ringBonus(String(ring.element || ''), this.myCharactersInPlay(me))
            : 0;
        const attachmentBonus = attachmentTower
            ? attachmentTower.ringBonus(
                String(ring.element || ''),
                this.myCharactersInPlay(me),
                me?.cardPiles?.conflictDiscardPile || []
            )
            : 0;

        return fateComponent + base + gloryBonus + dragonBonus + shugenjaBonus + duelBonus + attachmentBonus;
    }

    // The side (military/political) where the bot's ready characters carry
    // the most total skill — some are martial, some courtly, some balanced.
    private preferredConflictType(me: any, aggressive = false): 'military' | 'political' {
        const ready = this.readyCharacters(me);
        const military = ready.reduce((total, card) => total + Math.max(this.skillValue(card, 'military') || 0, 0), 0);
        const political = ready.reduce((total, card) => total + Math.max(this.skillValue(card, 'political') || 0, 0), 0);
        // A military-rush deck forces every conflict military as long as it has
        // any military skill on the board — its payoffs and pumps are all
        // military, and staying on one axis lets Captive Audience turn the
        // political conflict into a second military one.
        if(aggressive && military > 0) {
            return 'military';
        }
        return military >= political ? 'military' : 'political';
    }

    // Seed 5: attack on the axis where the REAL advantage is largest — my
    // ready skill minus their ready board skill minus the best body+trick
    // they can afford from the hand we can see. A fair bot compares only its
    // own board; the cheat knows the human is (say) holding military pumps
    // and attacks political instead.
    private omniPreferredConflictType(me: any, opponent: any, omni: Omniscient, forceMilitary = false): 'military' | 'political' {
        const myReady = this.readyCharacters(me);
        const mine = (type: string) => myReady.reduce((total, card) => total + Math.max(this.skillValue(card, type) || 0, 0), 0);
        if(forceMilitary && mine('military') > 0) {
            return 'military';
        }
        const theirReady = (opponent?.cardPiles?.cardsInPlay || []).filter((card: any) => card.type === 'character' && !card.bowed);
        const theirs = (type: string) => theirReady.reduce((total: number, card: any) => total + Math.max(this.skillValue(card, type) || 0, 0), 0);
        const advantage = (type: 'military' | 'political') =>
            mine(type) - theirs(type) - this.omniHandThreat(omni, type).skill;
        return advantage('military') >= advantage('political') ? 'military' : 'political';
    }

    private omniHandThreat(omni: Omniscient, type: 'military' | 'political'): { skill: number; detail: string } {
        const matrix = omni.handThreatMatrix?.[type];
        const plan = matrix?.[matrix.length - 1];
        return plan ? { skill: plan.skill, detail: plan.detail }
            : estimateHandThreat(omni.oppHand, omni.oppFate, type);
    }

    // The real strength of the province currently under attack. Omniscient only:
    // matches the in-conflict province (even face-down) to its true strength.
    private omniAttackedStrength(opponent: any, omni: Omniscient): number {
        const lists = PROVINCE_KEYS
            .map((key) => opponent?.provinces?.[key] || [])
            .concat([opponent?.strongholdProvince || []]);
        for(const list of lists) {
            const prov = (list || []).find((card: any) => (card.isProvince || card.facedown) && card.inConflict);
            if(prov) {
                const match = omni.oppProvinces.find((p) => p.location && p.location === prov.location);
                if(match) {
                    return match.strength;
                }
            }
        }
        return this.attackedProvinceStrength(opponent, 4);
    }

    private attackProvinceDecision(opponent: any, omni?: Omniscient, legalDirectCardUuids?: Record<string, true>): BotDecision | null {
        if(!opponent) {
            return null;
        }

        let candidateLists = attackProvinceLists(opponent);

        // Seed 5 sees every province's true strength, so it strikes the weakest
        // unbroken province first (fastest break, least skill spent) instead of
        // taking them in board order. Ties keep board order.
        if(omni) {
            const strengthOf = (list: any): number => {
                const province = (list || []).find((card: any) => (card.isProvince || card.facedown) && card.isProvince !== false);
                const match = province && omni.oppProvinces.find((p) => p.location && p.location === province.location);
                return match ? match.strength : Number.POSITIVE_INFINITY;
            };
            candidateLists = candidateLists
                .map((list, index) => ({ list, index, strength: strengthOf(list) }))
                .sort((a, b) => (a.strength - b.strength) || (a.index - b.index))
                .map((entry) => entry.list);
        }

        for(const list of candidateLists) {
            const province = (list || []).find((card: any) => card.isProvince !== false && (card.isProvince || card.facedown));
            if(!province || province.isBroken) {
                continue;
            }

            if(province.uuid) {
                if(this.isDirectCardLegal(province, legalDirectCardUuids) &&
                    !this.isAttempted('cardClicked', [province.uuid])) {
                    const stronghold = province.location === 'stronghold province';
                    return this.cardClickDecision(province, stronghold ? 'attack-stronghold' : 'attack-province');
                }
            } else if(province.location && opponent.name) {
                const args = [province.location, opponent.name, true];
                if(!this.isAttempted('facedownCardClicked', args)) {
                    return {
                        command: 'facedownCardClicked',
                        args,
                        target: province.location,
                        reason: province.location === 'stronghold province'
                            ? 'attack-facedown-stronghold'
                            : 'attack-facedown-province'
                    };
                }
            }
        }

        return null;
    }

    private defenderDecision(me: any, promptTitle: string, buttons: any[], profile: DeckProfile = DEFAULT_PROFILE, _omni?: Omniscient, dishonor: DishonorTactics | null = null, cardHint?: CardHintLookup, shugenja: ShugenjaTactics | null = null, opponent?: any, legalDirectCardUuids?: Record<string, true>): BotDecision | null {
        // NOTE: seed-5 defense-side omniscience (defending against the human's
        // post-commit hand pump, conceding provably-lost conflicts to save
        // bodies) was implemented and MEASURED NET-NEGATIVE — it made the bot
        // over-concede and stall (Crane mirror 0-12). The plumbing (`_omni`) is
        // kept for a more careful future attempt; seed 5's live edge comes from
        // weakest-province targeting, true province strength and hand-aware
        // conflict-type choice. Only the resource-saving token-defense case
        // below remains; other defense sizing uses the base heuristic.
        const done = this.findButton(buttons, ['done']);
        const conflictMatch = promptTitle.match(CONFLICT_TITLE_REGEX);
        const type = conflictMatch ? conflictMatch[1].toLowerCase() : 'military';

        const skillMatch = promptTitle.match(SKILL_VS_REGEX);
        const attackerSkill = skillMatch ? parseInt(skillMatch[1], 10) : null;
        const defenderSkill = skillMatch ? parseInt(skillMatch[2], 10) : 0;

        const candidates = this.sortBySkillDesc(
            this.withoutHonorCostDeclares(
                this.readyCharacters(me).filter((card) =>
                    this.isDirectCardLegal(card, legalDirectCardUuids) &&
                    !card.inConflict &&
                    (this.skillValue(card, type) || 0) > 0 &&
                    !this.isAttempted('cardClicked', [card.uuid])),
                dishonor, me?.stats?.honor ?? 10, cardHint),
            type
        );

        // Forced defender declaration without skills shown: commit one body.
        if(attackerSkill === null) {
            const committed = this.myCharactersInPlay(me).filter((card) => card.inConflict).length;
            if(committed === 0 && candidates.length > 0) {
                return this.cardClickDecision(candidates[0], 'declare-defender');
            }
            return this.buttonDecision(done, 'finish-defenders');
        }

        // The stronghold province: breaking it loses the game, so no
        // commitment cap applies — every ready body defends, even for decks
        // that otherwise concede (win-only) or fold hopeless conflicts.
        if(this.strongholdUnderAttack(me)) {
            if(candidates.length > 0) {
                return this.cardClickDecision(candidates[0], 'stronghold-defense-all');
            }
            return this.buttonDecision(done, 'finish-defenders');
        }

        // Display of Power is the deck's province-trade engine. Proactively
        // trade for a ring that turns on a live Phoenix payoff; otherwise use
        // Display only when the available board cannot win the defense anyway.
        // Never concede the stronghold.
        const ringElement = conflictMatch ? conflictMatch[2].toLowerCase() : '';
        const availableDefense = defenderSkill + candidates.reduce((total, card) =>
            total + Math.max(this.skillValue(card, type) || 0, 0), 0);
        const displayRingUseful = !!shugenja && shugenja.shouldUseDisplayForRing(
            ringElement,
            this.myCharactersInPlay(me),
            this.myCharactersInPlay(opponent)
        );
        if(shugenja?.hasDisplayPlan(me) && (displayRingUseful || availableDefense <= (attackerSkill ?? 0))) {
            return this.buttonDecision(done, 'display-of-power-unopposed');
        }

        // The Art of War WANTS to break (draw 3): declare no defenders.
        if(this.shouldConcedeProvince(me)) {
            return this.buttonDecision(done, 'concede-art-of-war');
        }

        // Seed 5: size the defense against the human's TRUE maximum — their
        // committed skill plus the best body+trick they can actually afford
        // from the hand we can see (estimateHandThreat shares the fate
        // budget). Two payoffs a fair bot cannot have:
        //   - the attack cannot break the province even unopposed and with
        //     every affordable trick: defend with exactly ONE weakest body
        //     (no unopposed honor loss, everyone else stays ready), and
        //   - otherwise defend to beat the REAL threat, not the visible
        //     skill — a minimal block sized on visible numbers is a free
        //     flip for a held pump card.
        if(_omni && attackerSkill !== null) {
            const threat = this.omniHandThreat(_omni, type === 'political' ? 'political' : 'military');
            const effectiveAttack = attackerSkill + threat.skill;
            const provinceStrength = this.attackedProvinceStrength(me);
            const committed = this.myCharactersInPlay(me).filter((card) => card.inConflict).length;
            if(effectiveAttack < provinceStrength) {
                if(committed === 0 && candidates.length > 0) {
                    return this.cardClickDecision(candidates[candidates.length - 1], 'omni-token-defense');
                }
                return this.buttonDecision(done, 'finish-defenders');
            }
            // NOTE: sizing the whole defense against effectiveAttack (win-
            // through-tricks AND prevent-break variants) was measured NET-
            // NEGATIVE here too (18-22 baseline -> 12-28 / 13-27): the extra
            // margin bows bodies against tricks that the attacker often
            // holds, and the lost tempo costs more than the saved province.
            // Only the token-defense case above survives — it strictly SAVES
            // resources. The generic path sizes the real defenses.
        }

        // A province breaks when attacker skill beats defender skill by at
        // least the province strength. Defend to win when reachable, otherwise
        // defend just enough to prevent the break, otherwise keep the board.
        const provinceStrength = this.attackedProvinceStrength(me);
        const potential = defenderSkill + candidates.reduce((total, card) => total + Math.max(this.skillValue(card, type) || 0, 0), 0);

        const defenseCommitment = profile.preventBreakAfterBrokenProvinces > 0 &&
            this.brokenOuterProvinceCount(me) < profile.preventBreakAfterBrokenProvinces
            ? 'win-only'
            : profile.defenseCommitment;
        let target;
        if(defenseCommitment === 'win-only') {
            // The rush would rather lose a province than bow bodies it needs to
            // attack again, so it only defends when it can win the conflict
            // outright. Attackers win ties, so the defense must reach one more
            // skill; a tie or chump-block that merely delays a break is conceded.
            if(potential > attackerSkill) {
                target = attackerSkill + 1;
            } else {
                return this.buttonDecision(done, 'aggressive-concede-defense');
            }
        } else if(potential >= attackerSkill) {
            target = attackerSkill;
        } else if(potential > attackerSkill - provinceStrength) {
            target = Math.min(attackerSkill - provinceStrength + 1 + profile.defenseSkillBuffer, potential);
        } else {
            // Hopeless — but an UNOPPOSED loss also bleeds 1 honor. Decks
            // with chumpBlock throw their weakest body in the way: the
            // province falls either way, the honor stays.
            if(profile.chumpBlock) {
                const committed = this.myCharactersInPlay(me).filter((card) => card.inConflict).length;
                if(committed === 0 && candidates.length > 0) {
                    return this.cardClickDecision(candidates[candidates.length - 1], 'chump-block');
                }
            }
            return this.buttonDecision(done, 'defense-hopeless');
        }

        if(defenderSkill >= target) {
            return this.buttonDecision(done, 'defense-sufficient');
        }

        if(candidates.length > 0) {
            return this.cardClickDecision(candidates[0], 'declare-defender');
        }

        return this.buttonDecision(done, 'finish-defenders');
    }

    private brokenOuterProvinceCount(player: any): number {
        return PROVINCE_KEYS.filter((key) =>
            (player?.provinces?.[key] || []).some((card: any) => card.isProvince && card.isBroken)
        ).length;
    }

    // Strength of the given player's attacked province; falls back when the
    // province is hidden (an opponent's still-facedown province shows no
    // stats — assume 4 so the bot overshoots rather than undershoots).
    private attackedProvinceStrength(player: any, fallback = 3): number {
        const provinceLists = PROVINCE_KEYS
            .map((key) => player?.provinces?.[key] || [])
            .concat([player?.strongholdProvince || []]);
        for(const list of provinceLists) {
            const province = (list || []).find((card: any) => (card.isProvince || card.facedown) && card.inConflict);
            const strength = Number(province?.strengthSummary?.stat);
            if(!isNaN(strength)) {
                return strength;
            }
        }
        return fallback;
    }

    // Attacker wins ties, so the defender is losing when skills are equal.
    private conflictStanding(playerState: any, me: any): { losing: boolean; gap: number; amAttacker: boolean; attackerSkill: number; defenderSkill: number } | null {
        const conflict = playerState?.conflict;
        if(!conflict || !conflict.type) {
            return null;
        }

        const amAttacker = conflict.attackingPlayerId === me.id;
        const attackerSkill = Number(conflict.attackerSkill) || 0;
        const defenderSkill = Number(conflict.defenderSkill) || 0;
        return {
            losing: amAttacker ? attackerSkill < defenderSkill : defenderSkill <= attackerSkill,
            gap: amAttacker ? defenderSkill - attackerSkill : attackerSkill - defenderSkill + 1,
            amAttacker,
            attackerSkill,
            defenderSkill
        };
    }

    private conflictWindowDecision(playerState: any, me: any, buttons: any[], handStats?: HandStats, cardHint?: CardHintLookup, profile: DeckProfile = DEFAULT_PROFILE, conflictCosts?: Record<string, number>, _omni?: Omniscient, dishonor: DishonorTactics | null = null, lion: LionTactics | null = null, dragon: DragonTactics | null = null, glory: GloryTactics | null = null, duelist: DuelTactics | null = null, shugenja: ShugenjaTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null, crane: CraneBaselineTactics | null = null, legalDirectCardUuids?: Record<string, true>): BotDecision | null {
        // NOTE: seed-5 window-hold omniscience (as attacker, HOLD when the human
        // can swing the conflict out of break range; as defender, concede a
        // provably lost conflict to keep bodies) was implemented and MEASURED
        // NET-NEGATIVE — over-holding cost the bot conflicts it could have won
        // (Crane mirror regressed to 1-11). The `_omni` plumbing is kept for a
        // more careful future attempt; the base window heuristic is unchanged.
        const pass = this.buttonDecision(this.findButton(buttons, ['pass']) || buttons[0], 'pass-window');
        const standing = this.conflictStanding(playerState, me);
        if(!standing) {
            return pass;
        }

        // While defending, the attacked own province's Conflict Action is free
        // value regardless of standing — Fertile Fields draws a card,
        // Meditations on the Tao strips an attacker's fate. Fire it before any
        // concede/pass gate (a province with no action is rejected without
        // mutation and the attempted-set moves on).
        if(!standing.amAttacker) {
            const provinceOpponent = this.opponentPlayer(playerState, me);
            const attackedProvince = PROVINCE_KEYS
                .map((key) => me?.provinces?.[key] || [])
                .concat([me?.strongholdProvince || []])
                .map((list) => (list || []).find((card: any) =>
                    card.isProvince && card.inConflict && card.uuid && !card.isBroken &&
                    this.isDirectCardLegal(card, legalDirectCardUuids) &&
                    !this.isAttempted('cardClicked', [card.uuid]) &&
                    // A province whose targeting cancelled twice this round
                    // (Shameful Display with saturated honor states) is dead
                    // until the next round — stop re-clicking it.
                    !this.isCancelVetoed(card.id) &&
                    (!lion || lion.shouldUseProvince(
                        card.id,
                        this.myCharactersInPlay(me),
                        this.myCharactersInPlay(provinceOpponent),
                        me?.cardPiles?.hand || []
                    ))))
                .find(Boolean);
            if(attackedProvince) {
                return this.cardClickDecision(attackedProvince, 'province-conflict-action');
            }
        }

        // The Art of War draws 3 on breaking — never spend cards saving it.
        if(!standing.amAttacker && this.shouldConcedeProvince(me)) {
            return pass;
        }

        // The stronghold province under attack loses the game if it breaks:
        // override the rush's no-cards-on-defense gate and (below) the
        // "cannot fix it" fold — spend whatever might save it.
        const strongholdDefense = !standing.amAttacker && this.strongholdUnderAttack(me);

        // A deck that does not spend cards on defense (the military rush) saves
        // every card and fate for its own attacks — it passes every defensive
        // window and lets the province fall if it must.
        if(!profile.spendCardsOnDefense && !standing.amAttacker && !strongholdDefense) {
            return pass;
        }

        // Breaking provinces wins the game, so the win/lose gap alone is not
        // the goal: as the attacker, keep pushing until the skill lead reaches
        // the province strength (a 3 vs 0 win against a 5-strength province
        // breaks nothing); as the defender, spend cards only to keep the
        // province alive or to steal a cheap win — a lost conflict that does
        // not break anything is better answered with our own attack.
        const opponent = this.opponentPlayer(playerState, me);
        // Dragon: while a cards-played payoff character participates (Togashi
        // Mitsu / High House of Light want 5 cards, Togashi Ichi 10, Teacher 3)
        // keep feeding cards past the already-winning/lost gates until the count
        // target is reached — the volume IS the plan. `cardsPlayedThisConflict`
        // already includes Shintao Monastery's +1, so no separate Shintao case.
        const cardsPlayed = me?.cardsPlayedThisConflict ?? 0;
        const opponentCardsPlayed = opponent?.cardsPlayedThisConflict ?? 0;
        const conflictType: 'military' | 'political' = playerState?.conflict?.type === 'political' ? 'political' : 'military';
        const myCharacters = this.myCharactersInPlay(me);
        const opponentCharacters = (opponent?.cardPiles?.cardsInPlay || []).filter((card: any) => card.type === 'character');
        const strongholdAssault = standing.amAttacker && this.strongholdUnderAttack(opponent);
        const ringsHaveFate = Object.values(playerState?.rings || {})
            .some((ring: any) => (Number(ring?.fate) || 0) >= 1);
        const dragonPool = this.normalConflictPlayCandidates(me, opponent);
        const projectedRingFateCards = dragonPool.filter((card: any) =>
            card.isPlayableByMe && card.uuid &&
            !this.isAttempted('cardClicked', [card.uuid]) &&
            !this.isCancelVetoed(card.id));
        const canCreateRingFate = !!dragon &&
            dragon.canCreateRingFate(projectedRingFateCards, myCharacters);
        const highHouse = (me?.strongholdProvince || []).find((card: any) => card.id === 'high-house-of-light');
        const highHouseRelevant = !!dragon && !!highHouse && dragon.hasParticipatingMonk(myCharacters) &&
            !highHouse.bowed && (ringsHaveFate || canCreateRingFate);
        const dragonTargets = dragon ? dragon.cardTargets(
            myCharacters,
            standing.amAttacker,
            cardsPlayed,
            opponentCardsPlayed,
            highHouseRelevant,
            strongholdAssault
        ) : [];
        const dragonPlayableCount = (target: number) => dragonPool.filter((card: any) => {
            if(!card.isPlayableByMe || !card.uuid || this.isAttempted('cardClicked', [card.uuid]) || this.isCancelVetoed(card.id)) {
                return false;
            }
            if(card.id === 'way-of-the-dragon' && dragon && !dragon.pickWayCharacter(myCharacters)) {
                return false;
            }
            const hint: any = card.id && cardHint ? cardHint(card.id) : undefined;
            if(!hint) {
                return true;
            }
            if(hint.useWhen === 'never' || hint.useWhen === 'winning' ||
                (hint.conflictTypes.length > 0 && !hint.conflictTypes.includes(conflictType))) {
                return false;
            }
            const projected = {
                conflictType,
                losing: standing.losing,
                amAttacker: standing.amAttacker,
                honor: me?.stats?.honor ?? 10,
                fate: me?.stats?.fate ?? 0,
                myCharacters,
                opponentCharacters,
                dynastyDiscard: me?.cardPiles?.dynastyDiscardPile || [],
                hand: me?.cardPiles?.hand || [],
                conflictDiscard: me?.cardPiles?.conflictDiscardPile || [],
                rings: Object.values(playerState?.rings || {}),
                cardsPlayed: target,
                opponentCardsPlayed
            };
            return typeof hint.shouldPlay !== 'function' || hint.shouldPlay(projected);
        }).length;
        const dragonCardTarget = dragonTargets.find((target) =>
            cardsPlayed >= target || dragon?.canReachTarget(cardsPlayed, dragonPlayableCount(target), target)) ?? dragonTargets[0] ?? 0;
        const highHouseWaitForFate = highHouseRelevant && cardsPlayed < 5 &&
            !!dragon?.canReachTarget(cardsPlayed, dragonPlayableCount(5), 5);
        const dragonPlanActive = dragonTargets.length > 0;
        const feedCards = !!dragon && dragon.allowsCardCountOvercommit() && dragonPlanActive &&
            dragon.canReachTarget(cardsPlayed, dragonPlayableCount(dragonCardTarget), dragonCardTarget);
        const dragonPayoffReady = dragonPlanActive && cardsPlayed >= dragonCardTarget;
        const saveDragonCards = dragonPlanActive && cardsPlayed < dragonCardTarget && !feedCards;
        const opponentParticipants = (opponent?.cardPiles?.cardsInPlay || []).filter((card: any) =>
            card.type === 'character' && card.inConflict);
        const pathMargin = !!shugenja && standing.amAttacker && opponentParticipants.length === 0 &&
            (me?.cardPiles?.hand || []).some((card: any) => card.id === 'the-path-of-man');
        const preparedTadaka = shugenja?.pickTadakaPlay(
            me?.cardPiles?.hand || [],
            myCharacters,
            me?.stats?.fate ?? 0
        );
        const preparedFiveFires = shugenja?.pickFiveFiresPlay(
            me?.cardPiles?.hand || [],
            myCharacters,
            opponentCharacters,
            me?.stats?.fate ?? 0
        );
        const sharedPlayCtx = this.playbookContext(playerState, me, dishonor);
        const strengthNeeded = this.conflictStrengthNeeded(playerState, me, pathMargin ? 5 : 0);
        sharedPlayCtx.strengthNeeded = strengthNeeded;
        sharedPlayCtx.allowStrengthOvercommit = feedCards;
        sharedPlayCtx.conflictCosts = conflictCosts || {};
        const canPlayConflictCard = (card: any) => this.conflictCardHasPlayIntent(
            card,
            sharedPlayCtx,
            cardHint,
            handStats,
            false,
            duelist,
            attachmentTower
        );
        sharedPlayCtx.canPlayConflictCard = canPlayConflictCard;
        const shugenjaPlan = !!shugenja &&
            (pathMargin || !!preparedFiveFires || !!preparedTadaka ||
                shugenja.hasStrategicAction(me, opponent, conflictType, canPlayConflictCard, conflictCosts));
        const cranePlan = !!crane && (
            crane.shouldUseBrashSamurai(sharedPlayCtx) ||
            crane.shouldUseDojiChallenger(sharedPlayCtx)
        );
        if(standing.amAttacker) {
            const provinceStrength = this.attackedProvinceStrength(opponent, 4);
            const requiredLead = pathMargin ? Math.max(provinceStrength, 5) : provinceStrength;
            const breakDeficit = requiredLead - (standing.attackerSkill - standing.defenderSkill);
            // Assaulting the enemy STRONGHOLD: breaking it wins the game, so
            // the "too far gone" cap does not apply — spend everything on the
            // final push (mirrors the all-in stronghold defense).
            if(!feedCards && !dragonPayoffReady && !shugenjaPlan && !cranePlan && (breakDeficit <= 0 || (!strongholdAssault && breakDeficit > 6))) {
                return pass;
            }
        } else {
            if(!standing.losing && !feedCards && !dragonPayoffReady && !shugenjaPlan && !cranePlan) {
                return pass;
            }
            const provinceStrength = this.attackedProvinceStrength(me, 3);
            const breakDeficit = standing.attackerSkill - provinceStrength + 1 - standing.defenderSkill;
            const cheapWin = standing.gap <= 3;
            // At the stronghold there is no "too far gone": every buff and
            // ability is thrown at the deficit because losing it is losing.
            if(!strongholdDefense && !feedCards && !dragonPayoffReady && !shugenjaPlan && !cranePlan && ((breakDeficit <= 0 && !cheapWin) || breakDeficit > 6)) {
                return pass;
            }
        }

        const myHonor = me?.stats?.honor ?? 10;
        const playCtx: any = {
            conflictType,
            losing: standing.losing,
            amAttacker: standing.amAttacker,
            honor: myHonor,
            fate: me?.stats?.fate ?? 0,
            // Dishonor decks stop paying honor costs at their floor; undefined
            // for every other deck (playbook gates treat undefined as payable).
            canPayHonor: dishonor ? dishonor.canPayHonor(myHonor) : undefined,
            myCharacters,
            opponentCharacters,
            opponentHandSize: (opponent?.cardPiles?.hand || []).length,
            dynastyDiscard: me?.cardPiles?.dynastyDiscardPile || [],
            hand: me?.cardPiles?.hand || [],
            conflictDiscard: me?.cardPiles?.conflictDiscardPile || [],
            rings: Object.values(playerState?.rings || {}),
            // Cards this player has played this conflict (Shintao's +1 already
            // folded in). Dragon's payoff abilities gate on it.
            cardsPlayed,
            opponentCardsPlayed,
            // Whether the bot still has a playable hand card to keep raising the
            // count — the "can't reach the target, use it now" escape hatch for
            // High House of Light.
            moreCardsPlayable: dragonPlayableCount(dragonCardTarget) > 0,
            ringsHaveFate,
            highHouseWaitForFate,
            conflictsRemaining: me?.stats?.conflictsRemaining ?? 0,
            strongholdConflict: strongholdDefense || strongholdAssault,
            preferFavorableRetreat: !!dragon,
            strengthNeeded,
            allowStrengthOvercommit: feedCards,
            stronghold: me?.stronghold,
            yokuniCopiedNiten: this.yokuniCopiedNiten,
            activeConflict: true
        };
        playCtx.canPlayConflictCard = canPlayConflictCard;
        playCtx.conflictCosts = conflictCosts || {};

        // Prepared five-fate plays must happen before Kyuden Isawa and other
        // board abilities. Kyuden can spend conflict fate on a recast and
        // otherwise strand an already-actionable Five Fires (or Tadaka
        // disguise) by dropping below its required payment.
        if(preparedFiveFires && this.isDirectCardLegal(preparedFiveFires, legalDirectCardUuids) && !this.isAttempted('cardClicked', [preparedFiveFires.uuid])) {
            return this.cardClickDecision(preparedFiveFires, 'five-fires-tower-removal');
        }
        if(preparedTadaka && this.isDirectCardLegal(preparedTadaka, legalDirectCardUuids) && !this.isAttempted('cardClicked', [preparedTadaka.uuid])) {
            return this.cardClickDecision(preparedTadaka, 'tadaka-prepared-disguise');
        }

        // Board powers before hand cards: stronghold, attacked-province and
        // playbook-known in-play Action abilities cost no fate (bowing is the
        // cost). Clicking a card with no legal ability is rejected by the
        // game without mutation and the attempted-set moves to the next
        // candidate.
        const dragonConflictKey = [
            playerState?.roundNumber ?? playerState?.round ?? '',
            playerState?.conflict?.attackingPlayerId ?? '',
            playerState?.conflict?.defendingPlayerId ?? '',
            playerState?.conflict?.type ?? '',
            me?.stats?.conflictsRemaining ?? '',
            opponent?.stats?.conflictsRemaining ?? ''
        ].join('|');
        if(dragonConflictKey !== this.dragonAbilityConflictKey) {
            this.dragonAbilityConflictKey = dragonConflictKey;
            this.dragonConflictAbilityUsed.clear();
            this.dragonKihoPlayed = false;
        }
        const canSelectAbility = (card: any) => {
            // A useful Way bearer gets two activations in its printed period.
            // Count the planned clicks ourselves so a same-signature action
            // window permits click two but cannot become an endless click loop.
            if(dragon && dragon.wayAbilityPeriod(card)) {
                return !this.wayAbilityIsUsed(card, dragon);
            }
            if(!this.isAttempted('cardClicked', [card.uuid])) {
                return true;
            }
            return false;
        };
        const abilitySource = this.conflictAbilitySources(me, playCtx, cardHint, dishonor, lion, dragon, glory, shugenja, attachmentTower, crane, duelist)
            .filter((card) => this.isDirectCardLegal(card, legalDirectCardUuids))
            .find(canSelectAbility);
        if(abilitySource) {
            // Record once-per-round board abilities so they are not re-fired for
            // the rest of the round (stops the Tranquil Philosopher fate loop).
            const srcHint: any = cardHint ? cardHint(abilitySource.id) : undefined;
            if(dragon && dragon.wayAbilityPeriod(abilitySource)) {
                this.recordWayAbility(abilitySource, dragon);
            } else if(srcHint && srcHint.oncePerRound) {
                this.recordBoardAbility(abilitySource, dragon);
            }
            if(shugenja && abilitySource.id === 'kyuden-isawa') {
                this.recordBoardAbility(abilitySource);
            }
            if(attachmentTower && abilitySource.id === 'daimyo-s-favor') {
                this.pendingDaimyoBearerUuid =
                    attachmentTower.daimyoFavorBearerUuid(abilitySource, myCharacters) || null;
            }
            return this.cardClickDecision(abilitySource, 'use-board-ability');
        }

        // Once the selected payoff is live and its board actions are exhausted,
        // stop exactly at the threshold. If no payoff is reachable, preserve the
        // hand; Centipede Tattoo is the one escape hatch for a losing participant
        // that can fight again next conflict.
        // Exact card-count stopping is correct in ordinary conflicts. It is not
        // a game-loss gate: while either stronghold is being decided, continue
        // through useful playbook-approved cards (Swell can honor a Monk; Iron
        // Foundations cycles after a prior Kiho) until the conflict is saved or
        // no useful play remains.
        if(dragonPayoffReady && !strongholdDefense && !strongholdAssault) {
            return pass;
        }
        const dragonSaveException = saveDragonCards && standing.losing && dragonCardTarget >= 5 &&
            myCharacters.some((card) => card.inConflict && !card.bowed) &&
            dragonPool.some((card: any) => card.id === 'centipede-tattoo' && card.isPlayableByMe);
        if(saveDragonCards && !dragonSaveException) {
            return pass;
        }

        // NOTE: an old `if(fate < 1) return pass` reserve gate lived here. It
        // only ever fired at exactly 0 fate — where the engine's isPlayableByMe
        // already restricts the hand to 0-cost / bow-cost cards — so it never
        // protected a reserve and instead threw away free, game-saving buffs
        // (Supernatural Storm, Banzai!, Benten's Touch cost 0). Affordability is
        // the engine's job (isPlayableByMe, checked below); the window decision
        // only judges whether a playable card helps.
        //
        // With no ready character of ours in the conflict, events and
        // attachments cannot change its outcome — only a fresh character
        // (which can enter the conflict when played) is worth playing.
        let playable = this.normalConflictPlayCandidates(me, opponent)
            .filter((card: any) => {
                if(!card.isPlayableByMe || !card.uuid || !this.isDirectCardLegal(card, legalDirectCardUuids) || this.isAttempted('cardClicked', [card.uuid]) || this.isCancelVetoed(card.id)) {
                    return false;
                }
                if(saveDragonCards && card.id !== 'centipede-tattoo') {
                    return false;
                }
                // Way is only valuable on the repeatable characters ranked by
                // DragonTactics. Starting it without such a bearer leads to an
                // attachment prompt the target selector must cancel, wasting
                // bot decisions and retrying the same non-play later.
                if(dragon && card.id === 'way-of-the-dragon' && !dragon.pickWayCharacter(myCharacters)) {
                    return false;
                }
                // GloryTactics owns this deck-specific count so its injected
                // specialization remains observable through every seed. The
                // shared playbook gate below applies the same threshold to
                // replayed copies.
                if(glory && card.id === 'supernatural-storm' && glory.shugenjaCount(myCharacters) < 2) {
                    return false;
                }
                if(card.id === 'isawa-tadaka-2' && this.tadakaDisguiseAttempted) {
                    return false;
                }
                // Do not start a duel-deck attachment that cannot land on its
                // intended tower. Canceling the target prompt returns the card
                // to hand and otherwise causes an action-window retry loop.
                return this.conflictCardHasPlayIntent(
                    card,
                    playCtx,
                    cardHint,
                    handStats,
                    feedCards,
                    duelist,
                    attachmentTower
                );
            })
            .sort((a: any, b: any) => {
                if(attachmentTower) {
                    const attachmentDiff = attachmentTower.attachmentPriority(b.id) -
                        attachmentTower.attachmentPriority(a.id);
                    if(attachmentDiff !== 0) {
                        return attachmentDiff;
                    }
                }
                if(feedCards && dragonCardTarget >= 5) {
                    const order = (card: any) => {
                        // Empty rings: play projected fate source before
                        // consuming remaining slots on the road to five.
                        if(highHouseWaitForFate && !ringsHaveFate &&
                            dragon?.cardCanCreateRingFate(card, myCharacters)) {
                            return -1;
                        }
                        if(card.id === 'togashi-acolyte') {
                            return 0;
                        }
                        if(card.id === 'hurricane-punch') {
                            return 1;
                        }
                        if(card.id === 'void-fist') {
                            return 2;
                        }
                        if(card.id === 'swell-of-seafoam') {
                            return this.dragonKihoPlayed ? 3 : 5;
                        }
                        if(card.id === 'iron-foundations-stance') {
                            return this.dragonKihoPlayed ? 4 : 6;
                        }
                        return this.dragonKihoPlayed ? 5 : 3;
                    };
                    const orderDiff = order(a) - order(b);
                    if(orderDiff !== 0) {
                        return orderDiff;
                    }
                }
                const priorityOf = (card: any) => (card.id && cardHint ? cardHint(card.id)?.priority : undefined) ?? 5;
                const priorityDiff = priorityOf(b) - priorityOf(a);
                if(priorityDiff !== 0) {
                    return priorityDiff;
                }
                const statDiff = (this.handContribution(b, conflictType, handStats, cardHint, playCtx) ?? -1) -
                    (this.handContribution(a, conflictType, handStats, cardHint, playCtx) ?? -1);
                return statDiff !== 0 ? statDiff : String(a.uuid).localeCompare(String(b.uuid));
            });
        // Specialized Dragon sequences are themselves the deck's value model:
        // attachment reducers/tower weapons and card-count kiho ordering must
        // remain exact. Every other deck uses the shared fate-budget planner.
        if(!attachmentTower && !feedCards) {
            playable = this.conflictCardEconomyOrder(
                playable,
                me?.stats?.fate ?? 0,
                profile,
                cardHint,
                conflictCosts,
                (card) => this.handContribution(card, conflictType, handStats, cardHint, playCtx),
                strengthNeeded
            );
        }
        if(playable.length > 0) {
            if(dragon && ['hurricane-punch', 'void-fist', 'swell-of-seafoam', 'iron-foundations-stance'].includes(playable[0].id)) {
                this.dragonKihoPlayed = true;
            }
            return this.cardClickDecision(playable[0], 'play-conflict-card');
        }

        return pass;
    }

    // Own in-play cards worth clicking for their Action abilities during a
    // conflict: the stronghold, the attacked province, and any board card
    // (holding, attachment, character) with a playbook-known Action.
    private conflictAbilitySources(me: any, playCtx?: any, cardHint?: CardHintLookup, dishonor: DishonorTactics | null = null, lion: LionTactics | null = null, dragon: DragonTactics | null = null, glory: GloryTactics | null = null, shugenja: ShugenjaTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null, crane: CraneBaselineTactics | null = null, duelist: DuelTactics | null = null): any[] {
        const stronghold = (me?.strongholdProvince || []).filter((card: any) => {
            if(card.type !== 'stronghold' || !card.uuid || card.bowed) {
                return false;
            }
            // City of the Open Hand gains 1 honor — for the dishonor deck
            // that is only wanted while it keeps us inside the low-honor
            // band (many deck cards turn on at 6 or fewer honor).
            if(dishonor && card.id === 'city-of-the-open-hand') {
                return dishonor.shouldGainStrongholdHonor(playCtx?.honor ?? 10);
            }
            // Hayaken no Shiro readies a cheap Bushi — only worth the bow
            // when one of the deck's cheap bodies actually sits bowed.
            if(lion && card.id === 'hayaken-no-shiro') {
                return lion.shouldReadyWithStronghold(playCtx?.myCharacters || []);
            }
            // Wait for five only when ring fate exists (or this sequence can
            // create it). Otherwise take the base event protection now.
            if(dragon && card.id === 'high-house-of-light') {
                return dragon.strongholdReady(
                    playCtx?.cardsPlayed ?? 0,
                    playCtx?.highHouseWaitForFate === true
                );
            }
            if(glory && card.id === 'isawa-mori-seido') {
                return glory.shouldUseStronghold(playCtx?.myCharacters || []);
            }
            if(shugenja && card.id === 'kyuden-isawa') {
                return !this.boardAbilityIsUsed(card) && shugenja.shouldUseKyuden(playCtx);
            }
            // Golden Plains Outpost (Unicorn) bows itself to MOVE a cavalry
            // character into the conflict — worth it only to add a BOWED body
            // that cannot otherwise fight (a ready home body just gets declared
            // normally). Hold the bow unless a bowed home character exists.
            // The move target is engine-restricted to cavalry and the target
            // handler cancels when none of those bodies is bowed, so this
            // trait-free approximation only avoids a wasted activate/cancel.
            if(card.id === 'golden-plains-outpost') {
                return (playCtx?.myCharacters || []).some((c: any) => c.bowed && !c.inConflict);
            }
            return true;
        });
        const attacked = PROVINCE_KEYS
            .map((key) => me?.provinces?.[key] || [])
            .concat([me?.strongholdProvince || []])
            .map((list) => (list || []).find((card: any) =>
                card.isProvince && card.inConflict && card.uuid && !card.isBroken &&
                !this.isCancelVetoed(card.id) &&
                (!lion || lion.shouldUseProvince(
                    card.id,
                    playCtx?.myCharacters || [],
                    playCtx?.opponentCharacters || [],
                    playCtx?.hand || []
                ))))
            .filter(Boolean);

        let playbookSources: any[] = [];
        if(cardHint) {
            const onBoard = (location: string) =>
                location === 'play area' || /^(province [1-4]|stronghold province)$/.test(location);
            playbookSources = this.findVisibleCards(me)
                .filter((card) => {
                    if(!card.uuid || !card.id || card.facedown || !onBoard(String(card.location || '')) || this.isCancelVetoed(card.id)) {
                        return false;
                    }
                    // Duelist Training grants the Action to its bearer. The
                    // public source is therefore the character, not the
                    // attachment; resolve its playbook metadata through the
                    // injectable duel source map.
                    const duelSourceId = duelist?.duelSourceId(card);
                    const hint: any = cardHint(duelSourceId || card.id);
                    if(!hint || !hint.inPlayAction) {
                        return false;
                    }
                    // Once-per-round actions (Tranquil Philosopher's self-
                    // reversing fate move) are dropped after their first use so
                    // they cannot loop.
                    if(hint.oncePerRound && this.boardAbilityIsUsed(card, dragon)) {
                        return false;
                    }
                    if(attachmentTower && card.id === 'daimyo-s-favor') {
                        return attachmentTower.shouldUseDaimyoFavor(card, playCtx);
                    }
                    if(crane && card.id === 'brash-samurai') {
                        return crane.shouldUseBrashSamurai(playCtx);
                    }
                    if(crane && card.id === 'doji-challenger') {
                        return crane.shouldUseDojiChallenger(playCtx);
                    }
                    if(duelist && duelSourceId && !duelist.shouldStartDuel(
                        card,
                        playCtx?.myCharacters || [],
                        playCtx?.opponentCharacters || [],
                        (candidate, axis) => this.skillValue(candidate, axis) || 0
                    )) {
                        return false;
                    }
                    return typeof hint.shouldUseAction !== 'function' || !playCtx || hint.shouldUseAction(playCtx);
                })
                .sort((a, b) => {
                    const priorityOf = (card: any) =>
                        (cardHint(duelist?.duelSourceId(card) || card.id) as any)?.priority ?? 5;
                    const priorityDiff = priorityOf(b) - priorityOf(a);
                    return priorityDiff !== 0 ? priorityDiff : String(a.uuid).localeCompare(String(b.uuid));
                });
        }

        return stronghold.concat(attacked, playbookSources);
    }

    // One zone-neutral context for normal hand plays and paid replay effects.
    // Effect-specific costs/destinations stay with the source card; whether the
    // chosen card is useful and has a useful target is decided here once.
    private playbookContext(playerState: any, me: any, dishonor: DishonorTactics | null = null): any {
        const opponent = this.opponentPlayer(playerState, me);
        const standing = this.conflictStanding(playerState, me);
        return {
            conflictType: playerState?.conflict?.type === 'political' ? 'political' : 'military',
            losing: standing?.losing ?? false,
            amAttacker: standing?.amAttacker ?? false,
            honor: me?.stats?.honor ?? 10,
            fate: me?.stats?.fate ?? 0,
            canPayHonor: dishonor ? dishonor.canPayHonor(me?.stats?.honor ?? 10) : undefined,
            myCharacters: this.myCharactersInPlay(me),
            opponentCharacters: this.myCharactersInPlay(opponent),
            opponentHandSize: (opponent?.cardPiles?.hand || []).length,
            dynastyDiscard: me?.cardPiles?.dynastyDiscardPile || [],
            hand: me?.cardPiles?.hand || [],
            conflictDiscard: me?.cardPiles?.conflictDiscardPile || [],
            rings: Object.values(playerState?.rings || {}),
            cardsPlayed: me?.cardsPlayedThisConflict ?? 0,
            opponentCardsPlayed: opponent?.cardsPlayedThisConflict ?? 0,
            conflictsRemaining: me?.stats?.conflictsRemaining ?? 0,
            strengthNeeded: this.conflictStrengthNeeded(playerState, me)
        };
    }

    // Exact skill still needed for the next useful conflict threshold. Attack:
    // break the province. Defense: first stop a threatened break; otherwise
    // steal only a cheap (<=3 skill) win. Zero means pure pumps should stay in
    // hand even if a deck-specific strategic plan keeps the window open.
    private conflictStrengthNeeded(playerState: any, me: any, minimumAttackLead = 0): number | null {
        const standing = this.conflictStanding(playerState, me);
        if(!standing) {
            return null;
        }
        const opponent = this.opponentPlayer(playerState, me);
        if(standing.amAttacker) {
            const provinceStrength = this.attackedProvinceStrength(opponent, 4);
            const requiredLead = Math.max(provinceStrength, minimumAttackLead);
            return Math.max(requiredLead - (standing.attackerSkill - standing.defenderSkill), 0);
        }

        const provinceStrength = this.attackedProvinceStrength(me, 3);
        const preventBreak = standing.attackerSkill - provinceStrength + 1 - standing.defenderSkill;
        if(preventBreak > 0) {
            return preventBreak;
        }
        return standing.losing && standing.gap <= 3 ? standing.gap : 0;
    }

    private normalConflictPlayCandidates(me: any, opponent: any): any[] {
        const playableDiscard = (pile: any[]) => (pile || []).filter((card: any) => card.isPlayableByMe);
        return (me?.cardPiles?.hand || [])
            .concat(playableDiscard(me?.cardPiles?.conflictDiscardPile))
            .concat(playableDiscard(opponent?.cardPiles?.conflictDiscardPile))
            .filter((card: any) => !this.failedPlayCards.has(card.uuid));
    }

    private conflictCardHasPlayIntent(
        card: any,
        playCtx: any,
        cardHint?: CardHintLookup,
        handStats?: HandStats,
        feedCards = false,
        duelist: DuelTactics | null = null,
        attachmentTower: DragonAttachmentTactics | null = null,
        forcedAttachmentBearerUuid?: string,
        allowWithoutReadyParticipant = false
    ): boolean {
        const myCharacters = playCtx?.myCharacters || [];
        const hint: any = card.id && cardHint ? cardHint(card.id) : undefined;
        if(duelist?.isTowerAttachment(card.id) &&
            !duelist.pickAttachmentTarget(myCharacters, card.id, hint?.maxCopiesPerTarget)) {
            return false;
        }
        if(duelist?.duelSourceId(card) && !duelist.shouldStartDuel(
            card,
            myCharacters,
            playCtx?.opponentCharacters || [],
            (candidate, axis) => this.skillValue(candidate, axis) || 0
        )) {
            return false;
        }
        if(attachmentTower?.isAttachment(card.id)) {
            const target = attachmentTower.pickAttachmentTarget(
                myCharacters,
                card.id,
                forcedAttachmentBearerUuid,
                this.yokuniCopiedNiten
            );
            if(!target || (forcedAttachmentBearerUuid && target.uuid !== forcedAttachmentBearerUuid)) {
                return false;
            }
        }

        const hasReadyParticipant = myCharacters.some((candidate: any) =>
            candidate.inConflict && !candidate.bowed);
        if(!allowWithoutReadyParticipant && !hasReadyParticipant && card.type !== 'character' &&
            card.id !== 'consumed-by-five-fires' &&
            !(attachmentTower && attachmentTower.isAttachment(card.id))) {
            return false;
        }

        if(hint) {
            if(hint.useWhen === 'never' || hint.useWhen === 'winning') {
                return false;
            }
            if(hint.conflictTypes.length > 0 && !hint.conflictTypes.includes(playCtx.conflictType)) {
                return false;
            }
            if(typeof hint.shouldPlay === 'function' && !hint.shouldPlay(playCtx)) {
                return false;
            }
            const maxCopiesPerTarget = hint.maxCopiesPerTarget;
            if(maxCopiesPerTarget && hint.targetSide === 'self' &&
                !myCharacters.some((target: any) =>
                    this.attachmentCopyCount(target, card.id) < maxCopiesPerTarget)) {
                return false;
            }
        }

        const contribution = this.handContribution(card, playCtx.conflictType, handStats, cardHint, playCtx);
        const strengthNeeded = Number(playCtx?.strengthNeeded);
        if(Number.isFinite(strengthNeeded) && strengthNeeded <= 0 && contribution !== null && contribution > 0 &&
            !hint?.abilityValue && !playCtx?.allowStrengthOvercommit) {
            return false;
        }
        if(contribution !== null && contribution < 0) {
            return !!hint && hint.targetSide === 'enemy';
        }
        if(contribution === 0) {
            return feedCards || (!!hint && !!hint.abilityValue);
        }
        return contribution === null || contribution > 0;
    }

    // null = unknown contribution (events and cards the controller sent no
    // stats for); a known 0 means the card adds nothing to this conflict type.
    private handContribution(card: any, conflictType: string, handStats?: HandStats, cardHint?: CardHintLookup, playCtx?: any): number | null {
        const stats = handStats?.[card.uuid];
        if(stats) {
            const value = conflictType === 'political' ? stats.political : stats.military;
            return value === null || value === undefined ? null : value;
        }

        const hint: any = card?.id && cardHint ? cardHint(card.id) : undefined;
        const estimate = hint?.conflictContribution;
        if(typeof estimate === 'number') {
            return Number.isFinite(estimate) ? estimate : null;
        }
        if(typeof estimate === 'function') {
            try {
                const value = estimate(playCtx || {});
                return typeof value === 'number' && Number.isFinite(value) ? value : null;
            } catch{
                return null;
            }
        }
        return null;
    }

    // `cards` must already be in the path's legacy order. Missing costs fall
    // back to that exact order inside the planner, so older/custom callers and
    // dynamically-reduced cards keep their prior behavior.
    private conflictCardEconomyOrder(
        cards: any[],
        availableFate: number,
        profile: DeckProfile,
        cardHint?: CardHintLookup,
        conflictCosts?: Record<string, number>,
        contributionOf: (card: any) => number | null = () => null,
        requiredContribution?: number | null
    ): any[] {
        const options: ConflictCardOption<any>[] = cards.map((card, legacyIndex) => {
            const hint: any = card?.id && cardHint ? cardHint(card.id) : undefined;
            const hasCost = !!card?.uuid && !!conflictCosts &&
                Object.prototype.hasOwnProperty.call(conflictCosts, card.uuid);
            const rawContribution = contributionOf(card);
            // Negative printed skill on an enemy attachment is beneficial to
            // us. Score its magnitude like an equally large friendly pump.
            const contribution = rawContribution !== null && rawContribution < 0 && hint?.targetSide === 'enemy'
                ? Math.abs(rawContribution)
                : rawContribution;
            return {
                card,
                key: String(card?.uuid || `${card?.id || 'card'}-${legacyIndex}`),
                priority: hint?.priority ?? 5,
                contribution,
                abilityValue: !!hint?.abilityValue,
                cost: hasCost ? conflictCosts![card.uuid] : undefined,
                legacyIndex
            };
        });
        return planConflictCards(
            options,
            availableFate,
            profile.conflictCardEconomy || DEFAULT_PROFILE.conflictCardEconomy,
            requiredContribution
        ).map((option) => option.card);
    }

    private actionWindowDecision(playerState: any, me: any, buttons: any[], profile: DeckProfile = DEFAULT_PROFILE, cardHint?: CardHintLookup, dishonor: DishonorTactics | null = null, dynastyCosts?: Record<string, number>, conflictCosts?: Record<string, number>, lion: LionTactics | null = null, duelist: DuelTactics | null = null, shugenja: ShugenjaTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null, crane: CraneBaselineTactics | null = null, opponentConflictDeck: KnownCard[] = [], omni?: Omniscient, legalDirectCardUuids?: Record<string, true>): BotDecision | null {
        const pass = this.findButton(buttons, ['pass']);

        // Gossip is most valuable before either side commits to a conflict. It
        // is played only when its follow-up can name a strategically meaningful
        // card that is actually in the known opponent conflict deck.
        if(crane && me?.phase === 'conflict') {
            const gossipTarget = crane.pickGossipCard({
                opponentDeck: opponentConflictDeck,
                opponentHand: omni?.oppHand,
                opponentFate: omni?.oppFate,
                omniscient: !!omni
            });
            const gossip = (me?.cardPiles?.hand || []).find((card: any) =>
                card.id === 'gossip' && card.uuid && card.isPlayableByMe &&
                this.isDirectCardLegal(card, legalDirectCardUuids) &&
                !this.isAttempted('cardClicked', [card.uuid]) &&
                !this.failedPlayCards.has(card.uuid));
            if(gossip && gossipTarget) {
                return this.cardClickDecision(gossip, 'crane-play-gossip-known-deck-threat');
            }
        }

        // Board Actions that belong in the conflict-phase action window even
        // without an active conflict (Adept's phase-long Water Covert and
        // Mediator's post-two-conflicts economy theft).
        if((shugenja || attachmentTower) && cardHint && me?.phase === 'conflict') {
            const opponent = this.opponentPlayer(playerState, me);
            const phaseCtx = {
                conflictType: 'military' as const,
                losing: false,
                amAttacker: false,
                honor: me?.stats?.honor ?? 10,
                fate: me?.stats?.fate ?? 0,
                myCharacters: this.myCharactersInPlay(me),
                opponentCharacters: this.myCharactersInPlay(opponent),
                dynastyDiscard: me?.cardPiles?.dynastyDiscardPile || [],
                conflictDiscard: me?.cardPiles?.conflictDiscardPile || [],
                hand: me?.cardPiles?.hand || [],
                conflictCosts: conflictCosts || {},
                yokuniCopiedNiten: this.yokuniCopiedNiten,
                stronghold: me?.stronghold,
                rings: Object.values(playerState?.rings || {})
            };
            const onBoard = (location: string) =>
                location === 'play area' || /^(province [1-4]|stronghold province)$/.test(location);
            const phaseSource = this.findVisibleCards(me)
                .filter((card) => {
                    if(!card.uuid || !card.id || card.facedown || !this.isDirectCardLegal(card, legalDirectCardUuids) || !onBoard(String(card.location || '')) ||
                        this.isAttempted('cardClicked', [card.uuid])) {
                        return false;
                    }
                    const hint: any = cardHint(card.id);
                    if(attachmentTower) {
                        if(card.id === 'togashi-yokuni') {
                            if(this.yokuniCopyUsed || !attachmentTower.pickYokuniCopy(
                                phaseCtx.myCharacters,
                                phaseCtx.opponentCharacters,
                                (candidate) => (cardHint(candidate.id) as any)?.priority ?? 0
                            )) {
                                return false;
                            }
                        }
                        if(card.id === 'daimyo-s-favor' &&
                            !attachmentTower.shouldUseDaimyoFavor(card, phaseCtx)) {
                            return false;
                        }
                    }
                    return !!hint && hint.conflictPhaseAction &&
                        !(hint.oncePerRound && this.boardAbilityIsUsed(card)) &&
                        (typeof hint.shouldUseAction !== 'function' ||
                            (attachmentTower && card.id === 'daimyo-s-favor') ||
                            hint.shouldUseAction(phaseCtx));
                })
                .sort((a, b) => ((cardHint(b.id) as any)?.priority ?? 5) - ((cardHint(a.id) as any)?.priority ?? 5))[0];
            if(phaseSource) {
                const hint: any = cardHint(phaseSource.id);
                if(attachmentTower && phaseSource.id === 'togashi-yokuni') {
                    this.yokuniCopyUsed = true;
                }
                if(attachmentTower && phaseSource.id === 'daimyo-s-favor') {
                    this.pendingDaimyoBearerUuid =
                        attachmentTower.daimyoFavorBearerUuid(phaseSource, phaseCtx.myCharacters) || null;
                }
                if(hint?.oncePerRound) {
                    this.recordBoardAbility(phaseSource);
                }
                return this.cardClickDecision(phaseSource, 'use-conflict-phase-ability');
            }
        }

        // Five Fires and a prepared Tadaka are phase Actions, not just combat
        // tricks. Fire Five Fires as soon as an actionable enemy tower exists;
        // otherwise both cards could be stranded while the bot passed between
        // conflicts because it was already ahead.
        if(shugenja && me?.phase === 'conflict') {
            const opponent = this.opponentPlayer(playerState, me);
            const fiveFires = shugenja.pickFiveFiresPlay(
                me?.cardPiles?.hand || [],
                this.myCharactersInPlay(me),
                this.myCharactersInPlay(opponent),
                me?.stats?.fate ?? 0
            );
            if(fiveFires && this.isDirectCardLegal(fiveFires, legalDirectCardUuids) && !this.isAttempted('cardClicked', [fiveFires.uuid])) {
                return this.cardClickDecision(fiveFires, 'five-fires-tower-removal');
            }
            const tadaka = shugenja.pickTadakaPlay(
                me?.cardPiles?.hand || [],
                this.myCharactersInPlay(me),
                me?.stats?.fate ?? 0
            );
            if(tadaka && this.isDirectCardLegal(tadaka, legalDirectCardUuids) && !this.isAttempted('cardClicked', [tadaka.uuid])) {
                return this.cardClickDecision(tadaka, 'tadaka-prepared-disguise');
            }
        }

        // The attachment deck builds its towers before declaring conflicts.
        // Prioritize high-impact attachments and never start one that has no
        // legal strategic bearer (especially a fourth Restricted card).
        if(attachmentTower && me?.phase === 'conflict') {
            const mine = this.myCharactersInPlay(me);
            const hand = me?.cardPiles?.hand || [];
            const reducedAttachment = this.pendingDaimyoBearerUuid
                ? attachmentTower.pickDaimyoReducedAttachment(
                    hand,
                    mine,
                    this.pendingDaimyoBearerUuid,
                    conflictCosts,
                    this.yokuniCopiedNiten
                )
                : null;
            const preConflict = hand
                .filter((card: any) => {
                    if(!card.uuid || !card.id || !card.isPlayableByMe || !this.isDirectCardLegal(card, legalDirectCardUuids) ||
                        this.isAttempted('cardClicked', [card.uuid]) || this.isCancelVetoed(card.id) ||
                        this.failedPlayCards.has(card.uuid)) {
                        return false;
                    }
                    if(attachmentTower.shouldHoldWeapon(card.id, mine, this.yokuniCopiedNiten)) {
                        return false;
                    }
                    if(this.pendingDaimyoBearerUuid) {
                        return card.uuid === reducedAttachment?.uuid;
                    }
                    return attachmentTower.isAttachment(card.id) &&
                        !!attachmentTower.pickAttachmentTarget(mine, card.id, undefined, this.yokuniCopiedNiten);
                })
                .sort((a: any, b: any) => attachmentTower.attachmentPriority(b.id) -
                    attachmentTower.attachmentPriority(a.id) || String(a.uuid).localeCompare(String(b.uuid)));
            if(preConflict.length > 0) {
                return this.cardClickDecision(preConflict[0], 'attachment-tower-preconflict');
            }
        }

        // Duel attachments are setup pieces. Establish Above Question,
        // Shukujo, Duelist Training, and covert before declaring so their
        // protection/actions apply to the first conflict. Target selection is
        // centralized in DuelTactics and respects Restricted/singleton rules.
        if(duelist && me?.phase === 'conflict') {
            const mine = this.myCharactersInPlay(me);
            const availableFate = Math.max(0, Number(me?.stats?.fate) || 0);
            const preConflict = (me?.cardPiles?.hand || [])
                .filter((card: any) => card.uuid && card.id && card.isPlayableByMe &&
                    this.isDirectCardLegal(card, legalDirectCardUuids) &&
                    !this.isAttempted('cardClicked', [card.uuid]) &&
                    !this.failedPlayCards.has(card.uuid) &&
                    (!conflictCosts || !Object.prototype.hasOwnProperty.call(conflictCosts, card.uuid) ||
                        Math.max(0, Number(conflictCosts[card.uuid]) || 0) <= availableFate) &&
                    duelist.isTowerAttachment(card.id) &&
                    !!duelist.pickAttachmentTarget(
                        mine,
                        card.id,
                        (cardHint?.(card.id) as any)?.maxCopiesPerTarget
                    ))
                .sort((a: any, b: any) => {
                    const priorityOf = (card: any) => (cardHint?.(card.id) as any)?.priority ?? 5;
                    return priorityOf(b) - priorityOf(a) || String(a.uuid).localeCompare(String(b.uuid));
                });
            if(preConflict.length > 0) {
                return this.cardClickDecision(preConflict[0], 'duel-preconflict-attachment');
            }
        }

        // Peaceful/pre-conflict control attachments (Pacifism, Stolen Breath)
        // cannot be played once a conflict is running — the dishonor deck
        // plays them from hand in the conflict-phase action windows instead.
        const canPlayPreConflict = dishonor
            ? dishonor.canPlayPreConflict(me?.stats?.fate ?? 0)
            : !!shugenja && shugenja.canPlayPreConflict(me?.stats?.fate ?? 0);
        if(canPlayPreConflict && cardHint && me?.phase === 'conflict') {
            // A pre-conflict debuff (Pacifism/Stolen Breath) needs an enemy
            // character to land on — with the opponent's board empty it would
            // attach to our own side, so require a legal enemy target first.
            const opponent = this.opponentPlayer(playerState, me);
            const enemyCharacters = this.myCharactersInPlay(opponent);
            let preConflict = enemyCharacters.length === 0 ? [] : (me?.cardPiles?.hand || [])
                .filter((card: any) => {
                    if(!card.uuid || !card.id || !card.isPlayableByMe || !this.isDirectCardLegal(card, legalDirectCardUuids) ||
                        this.isAttempted('cardClicked', [card.uuid]) || this.isCancelVetoed(card.id) ||
                        this.failedPlayCards.has(card.uuid)) {
                        return false;
                    }
                    const hint: any = cardHint(card.id);
                    if(!hint || !hint.preConflict) {
                        return false;
                    }
                    const usefulTargets = this.attachmentTargetsWithoutDuplicate(enemyCharacters, card.id);
                    if(usefulTargets.length === 0) {
                        return false;
                    }
                    if(CONFLICT_LOCK_ATTACHMENT_IDS.has(card.id)) {
                        const axis = hint.conflictTypes.length > 0 ? hint.conflictTypes[0] : 'military';
                        return !!this.conflictLockTarget(usefulTargets, axis);
                    }
                    return true;
                })
                .sort((a: any, b: any) => {
                    const priorityOf = (card: any) => (cardHint(card.id) as any)?.priority ?? 5;
                    const priorityDiff = priorityOf(b) - priorityOf(a);
                    return priorityDiff !== 0 ? priorityDiff : String(a.uuid).localeCompare(String(b.uuid));
                });
            preConflict = this.conflictCardEconomyOrder(
                preConflict,
                me?.stats?.fate ?? 0,
                profile,
                cardHint,
                conflictCosts
            );
            if(preConflict.length > 0) {
                return this.cardClickDecision(preConflict[0], 'play-preconflict-attachment');
            }
        }

        if(me?.phase === 'dynasty') {
            const playable = PROVINCE_KEYS
                .flatMap((key) => me?.provinces?.[key] || [])
                .filter((card: any) =>
                    card.isDynasty &&
                    // Dynasty EVENTS (A Season of War, Cycle of Rebirth) are
                    // played from provinces like characters; only the Dragon
                    // deck runs any, so other decks see no change.
                    (card.type === 'character' || card.type === 'event') &&
                    !card.facedown &&
                    this.isDirectCardLegal(card, legalDirectCardUuids) &&
                    card.uuid &&
                    !this.isAttempted('cardClicked', [card.uuid]))
                .filter((card: any) => !shugenja || card.id !== 'fushicho' ||
                    shugenja.shouldPlayFushicho(me?.cardPiles?.dynastyDiscardPile || []));

            const dynamicFateReserve = shugenja
                ? shugenja.desiredFateReserve(me, this.opponentPlayer(playerState, me))
                : crane
                    ? crane.desiredDynastyFateReserve(this.fateAwareRoundNumber)
                    : 0;
            const deckPreference = profile.fateAwareEconomy.preferDeckCharacters
                ? this.fateAwareDeckDynastyPreference(
                    playable,
                    dynastyCosts || {},
                    me,
                    dishonor,
                    lion,
                    duelist,
                    shugenja,
                    attachmentTower,
                    crane,
                    dynamicFateReserve
                )
                : null;
            // Lion's A Season of War is a dynasty event, so it has no
            // additional-fate prompt and must bypass character bookkeeping.
            if(deckPreference?.card && deckPreference.card.type !== 'character') {
                return this.cardClickDecision(deckPreference.card, deckPreference.playReason || 'play-dynasty-card');
            }
            const fateAwareDecision = this.fateAwareDynastyDecision(
                playable,
                dynastyCosts || {},
                me,
                buttons,
                profile.fateAwareEconomy,
                deckPreference,
                dynamicFateReserve
            );
            if(fateAwareDecision) {
                return fateAwareDecision;
            }

            const fateAwareOwnsCharacterDecision = this.usesFateAwareEconomy() &&
                playable.some((card: any) => card.type === 'character');
            if(playable.length > 0 && !fateAwareOwnsCharacterDecision) {
                if(dishonor) {
                    const important = dishonor.pickImportantDynastyCharacter(
                        playable,
                        dynastyCosts || {},
                        me?.stats?.fate ?? 0,
                        this.myCharactersInPlay(me)
                    );
                    if(important) {
                        return this.cardClickDecision(important, 'scorpion-play-important-character');
                    }
                }
                if(shugenja && shugenja.desiredFateReserve(me, this.opponentPlayer(playerState, me)) <= 1) {
                    const setup = shugenja.pickTadakaSetupCharacter(
                        playable,
                        me?.cardPiles?.hand || [],
                        dynastyCosts || {},
                        me?.stats?.fate ?? 0
                    );
                    if(setup) {
                        return this.cardClickDecision(setup, 'tadaka-setup-character');
                    }
                }
                if(lion) {
                    const pick = lion.pickDynastyCard(
                        playable,
                        dynastyCosts || {},
                        me?.stats?.fate ?? 0,
                        this.myCharactersInPlay(me)
                    );
                    if(pick) {
                        return this.cardClickDecision(pick, 'lion-play-dynasty-card');
                    }
                    const lionPass = this.findButton(buttons, ['pass']);
                    if(lionPass) {
                        return this.buttonDecision(lionPass, 'lion-save-dynasty-fate');
                    }
                }
                if(duelist) {
                    const fate = me?.stats?.fate ?? 0;
                    const costs = dynastyCosts || {};
                    const board = this.myCharactersInPlay(me);
                    const tower = duelist.pickDynastyTower(playable, costs, fate, board, me?.cardPiles?.hand || []);
                    if(tower) {
                        return this.cardClickDecision(tower, 'duel-play-tower');
                    }
                    const visibleTower = duelist.needsTower(board) && duelist.hasVisibleTower(playable);
                    // One cheap helper is still useful for defending or taking
                    // an unopposed conflict. With an unfunded tower waiting,
                    // never spend more than one fate on that helper.
                    const support = duelist.pickSupportCharacter(playable, costs, fate, board, visibleTower ? 1 : undefined);
                    if(support) {
                        return this.cardClickDecision(support, 'duel-play-support');
                    }
                    if(visibleTower) {
                        return this.buttonDecision(this.findButton(buttons, ['pass']), 'duel-save-for-tower');
                    }
                    const towerPass = this.findButton(buttons, ['pass']);
                    if(towerPass) {
                        return this.buttonDecision(towerPass, 'duel-board-complete');
                    }
                }
                if(attachmentTower) {
                    const fate = me?.stats?.fate ?? 0;
                    const costs = dynastyCosts || {};
                    const board = this.myCharactersInPlay(me);
                    const tower = attachmentTower.pickDynastyTower(playable, costs, fate, board);
                    if(tower) {
                        return this.cardClickDecision(tower, 'attachment-tower-play-tower');
                    }
                    const visibleTower = attachmentTower.needsTower(board) &&
                        attachmentTower.hasVisibleTower(playable);
                    const support = attachmentTower.pickSupportCharacter(
                        playable,
                        costs,
                        fate,
                        board,
                        visibleTower ? 1 : undefined
                    );
                    if(support) {
                        return this.cardClickDecision(support, 'attachment-tower-play-support');
                    }
                    const attachmentPass = this.findButton(buttons, ['pass']);
                    if(attachmentPass) {
                        return this.buttonDecision(attachmentPass, visibleTower
                            ? 'attachment-tower-save-fate'
                            : 'attachment-tower-board-complete');
                    }
                }
                // Keep a 1-fate reserve so the conflict phase still has fate to
                // play cards from hand. Play the cheapest character that leaves
                // a fate behind; only spend the last fate when this is our sole
                // remaining play (commit on it and pass first for the first-
                // passer fate bonus). Unknown cost (no hint) counts as free.
                // Aggro body-flood decks (Unicorn/Lion, reserveDynastyFate=false)
                // skip the reserve — every fate belongs on the board.
                if(profile.reserveDynastyFate) {
                    const fate = me?.stats?.fate ?? 0;
                    const opponent = this.opponentPlayer(playerState, me);
                    const desiredReserve = shugenja ? shugenja.desiredFateReserve(me, opponent) : 1;
                    const costOf = (card: any) => dynastyCosts?.[card.uuid] ?? 0;
                    const affordable = playable
                        .filter((card: any) => fate - costOf(card) >= desiredReserve)
                        .sort((a: any, b: any) => costOf(a) - costOf(b) || String(a.uuid).localeCompare(String(b.uuid)));
                    if(affordable.length > 0) {
                        return this.cardClickDecision(affordable[0], 'play-dynasty-character');
                    }
                    if(playable.length > 1 || desiredReserve > 1) {
                        const reservePass = this.findButton(buttons, ['pass']);
                        if(reservePass) {
                            return this.buttonDecision(reservePass, 'dynasty-reserve-fate');
                        }
                    }
                    // Sole remaining play (or no pass button): commit it and pass
                    // first for the first-passer fate bonus.
                    return this.cardClickDecision(playable[0], playable.length === 1 ? 'play-dynasty-character-allin' : 'play-dynasty-character');
                }
                return this.cardClickDecision(playable[0], 'play-dynasty-character');
            }

            // Holding-engine decks deploy most of their characters through
            // dynasty Actions (Kyuden Hida digs the top 3, engineers pull
            // characters/holdings into provinces). Fire those once fate remains
            // to actually pay for what they surface; the engine rejects a click
            // whose ability is not currently legal without mutating state.
            // Gate the dig on a minimum board presence: a holding deck that digs
            // every window starves itself of defenders (it churns the engine
            // instead of playing bodies) and its provinces fall. Once enough of
            // its own characters are already in play, resume digging.
            const boardCharacters = this.myCharactersInPlay(me).filter((card) => card.type === 'character').length;
            if(profile.digWithActions && boardCharacters >= profile.digMinBoardCharacters
                && (me?.stats?.fate ?? 0) >= 1 && cardHint) {
                const digger = this.dynastyActionSources(me, cardHint)
                    .find((card) => this.isDirectCardLegal(card, legalDirectCardUuids) &&
                        !this.isAttempted('cardClicked', [card.uuid]) &&
                        !((cardHint(card.id) as any)?.oncePerRound && this.boardAbilityIsUsed(card)));
                if(digger) {
                    if((cardHint(digger.id) as any)?.oncePerRound) {
                        this.recordBoardAbility(digger);
                    }
                    return this.cardClickDecision(digger, 'dynasty-dig-action');
                }
            }
        }

        if(pass) {
            return this.buttonDecision(pass, 'pass-window');
        }

        return this.buttonDecision(this.findButton(buttons, ['done', 'no more actions', 'cancel']) || buttons[0], 'pass-window');
    }

    private fateAwareDeckDynastyPreference(
        playable: any[],
        costs: Record<string, number>,
        me: any,
        dishonor: DishonorTactics | null,
        lion: LionTactics | null,
        duelist: DuelTactics | null,
        shugenja: ShugenjaTactics | null,
        attachmentTower: DragonAttachmentTactics | null,
        crane: CraneBaselineTactics | null,
        dynamicFateReserve: number
    ): FateAwareDynastyPreference | null {
        const fate = me?.stats?.fate ?? 0;
        const board = this.myCharactersInPlay(me);
        if(dishonor) {
            const important = dishonor.pickImportantDynastyCharacter(playable, costs, fate, board);
            if(important) {
                return {
                    card: important,
                    playReason: 'scorpion-play-important-character',
                    terminal: false
                };
            }
        }
        if(shugenja && dynamicFateReserve <= 1) {
            const setup = shugenja.pickTadakaSetupCharacter(
                playable,
                me?.cardPiles?.hand || [],
                costs,
                fate
            );
            if(setup) {
                return { card: setup, playReason: 'tadaka-setup-character', terminal: false };
            }
        }
        if(crane && duelist) {
            const refill = crane.pickBoardFloorCharacter(
                playable,
                costs,
                fate,
                board,
                this.fateAwareRoundNumber,
                (cardId) => duelist.isDurableCharacter(cardId)
            );
            if(refill) {
                return {
                    card: refill,
                    playReason: 'crane-refill-board-floor',
                    passReason: 'crane-board-floor-complete',
                    terminal: false,
                    allowAdditionalDurable: true
                };
            }
        }
        if(lion) {
            return {
                card: lion.pickDynastyCard(playable, costs, fate, board) || undefined,
                playReason: 'lion-play-dynasty-card',
                passReason: 'lion-save-dynasty-fate',
                terminal: true
            };
        }
        if(duelist) {
            const tower = duelist.pickDynastyTower(playable, costs, fate, board, me?.cardPiles?.hand || []);
            if(tower) {
                return { card: tower, playReason: 'duel-play-tower', passReason: 'duel-save-for-tower', terminal: true };
            }
            const visibleTower = duelist.needsTower(board) && duelist.hasVisibleTower(playable);
            const support = duelist.pickSupportCharacter(playable, costs, fate, board, visibleTower ? 1 : undefined);
            return support
                ? { card: support, playReason: 'duel-play-support', passReason: 'duel-save-for-tower', terminal: true }
                : {
                    passReason: visibleTower ? 'duel-save-for-tower' : 'duel-board-complete',
                    terminal: true
                };
        }
        if(attachmentTower) {
            const tower = attachmentTower.pickDynastyTower(playable, costs, fate, board);
            if(tower) {
                return {
                    card: tower,
                    playReason: 'attachment-tower-play-tower',
                    passReason: 'attachment-tower-save-fate',
                    terminal: true
                };
            }
            const visibleTower = attachmentTower.needsTower(board) && attachmentTower.hasVisibleTower(playable);
            const support = attachmentTower.pickSupportCharacter(
                playable,
                costs,
                fate,
                board,
                visibleTower ? 1 : undefined
            );
            return support
                ? {
                    card: support,
                    playReason: 'attachment-tower-play-support',
                    passReason: 'attachment-tower-save-fate',
                    terminal: true
                }
                : {
                    passReason: visibleTower ? 'attachment-tower-save-fate' : 'attachment-tower-board-complete',
                    terminal: true
                };
        }
        return null;
    }

    // Economy used only by FateAwareJigokuBotPolicy. The default makes one
    // durable 4+ cost purchase and passes, or buys bodies only up to a round
    // budget. Deck profiles can inject different durable/body ordering,
    // budgets, reserves, and post-durable passing (Lion uses that extension).
    private fateAwareDynastyDecision(
        playable: any[],
        dynastyCosts: Record<string, number>,
        me: any,
        buttons: any[],
        economy: FateAwareEconomyProfile,
        preference: FateAwareDynastyPreference | null = null,
        dynamicFateReserve = 0
    ): BotDecision | null {
        if(!this.usesFateAwareEconomy()) {
            return null;
        }

        const characters = playable.filter((card: any) => card.type === 'character');
        if(characters.length === 0 && !this.fateAwareBoughtCharacter) {
            return null;
        }

        const pass = this.findButton(buttons, ['pass']);
        const fate = me?.stats?.fate ?? 0;
        if(this.fateAwareDynastyStartFate === null) {
            this.fateAwareDynastyStartFate = fate;
        }
        const spent = Math.max(0, this.fateAwareDynastyStartFate - fate);
        const earlyRound = this.fateAwareRoundNumber <= 2;
        const costOf = (card: any): number => Math.max(0, Number(dynastyCosts[card.uuid]) || 0);

        if(this.fateAwareStrongCharacter && economy.passAfterDurable && !economy.deferPassForDynastyActions) {
            return pass ? this.buttonDecision(pass, 'fate-aware-pass-after-strong-character') : null;
        }

        const persistentCharacters = this.myCharactersInPlay(me)
            .filter((card) => (Number(card.fate) || 0) > 0).length;
        const bodySpendCap = earlyRound
            ? economy.bodySpendCapEarly
            : persistentCharacters >= economy.persistentCharacterThreshold
                ? economy.bodySpendCapWithPersistent
                : economy.bodySpendCapLate;

        if(characters.length === 0) {
            if(economy.deferPassForDynastyActions) {
                return null;
            }
            return this.fateAwareBoughtCharacter && pass
                ? this.buttonDecision(pass, 'fate-aware-pass-after-buying')
                : null;
        }

        const durableSpendCap = earlyRound ? economy.durableSpendCapEarly : economy.durableSpendCapLate;
        const durableIds = economy.durableCharacterIds;
        const repairingProfileBoard = !!preference?.allowAdditionalDurable;
        const durableCandidates = (this.fateAwareStrongCharacter && !repairingProfileBoard ? [] : characters)
            .filter((card: any) => {
                const cost = costOf(card);
                return cost >= economy.durableCostThreshold &&
                    (!durableIds || (!!card.id && durableIds.includes(card.id))) &&
                    cost <= fate - dynamicFateReserve && spent + cost <= durableSpendCap;
            })
            .sort((a: any, b: any) => costOf(b) - costOf(a) || String(a.uuid).localeCompare(String(b.uuid)));
        const durable = durableCandidates[0];
        const bodySpent = economy.bodyBudgetIncludesDurableSpend
            ? spent
            : Math.max(0, spent - this.fateAwareDurableSpent);
        const remainingBodyBudget = bodySpendCap - bodySpent;
        const bodies = characters
            .filter((card: any) => {
                const cost = costOf(card);
                const isDurable = cost >= economy.durableCostThreshold &&
                    (!durableIds || (!!card.id && durableIds.includes(card.id)));
                return !isDurable && cost <= economy.bodyMaxCost &&
                    cost <= fate - Math.max(economy.bodyFateReserve, dynamicFateReserve) &&
                    cost <= remainingBodyBudget;
            })
            .sort((a: any, b: any) => {
                const costDifference = economy.bodyOrder === 'lowest-cost'
                    ? costOf(a) - costOf(b)
                    : costOf(b) - costOf(a);
                return costDifference || String(a.uuid).localeCompare(String(b.uuid));
            });

        const playDurable = (chosen = durable, reason = 'fate-aware-play-strong-character'): BotDecision | null => {
            if(!chosen) {
                return null;
            }
            const cost = costOf(chosen);
            const maxAdditional = earlyRound
                ? economy.durableAdditionalFateEarly
                : economy.durableAdditionalFateLate;
            const additionalCap = Math.max(0, Math.min(
                maxAdditional,
                fate - cost - dynamicFateReserve,
                durableSpendCap - spent - cost
            ));
            this.fateAwarePendingAdditionalFate = additionalCap;
            this.fateAwarePendingAdditionalFateCap = additionalCap;
            this.fateAwarePendingCost = cost;
            this.fateAwarePendingDurable = true;
            return this.cardClickDecision(chosen, reason);
        };
        const playBody = (chosen = bodies[0], reason = 'fate-aware-play-cheap-character'): BotDecision | null => {
            const body = chosen;
            if(!body) {
                return null;
            }
            const cost = costOf(body);
            const desiredAdditional = cost === 3 ? economy.bodyAdditionalFateForCostThree : 0;
            const additionalCap = Math.max(0, Math.min(
                fate - cost - dynamicFateReserve,
                remainingBodyBudget - cost
            ));
            this.fateAwarePendingAdditionalFate = Math.min(desiredAdditional, additionalCap);
            this.fateAwarePendingAdditionalFateCap = additionalCap;
            this.fateAwarePendingCost = cost;
            this.fateAwarePendingDurable = false;
            return this.cardClickDecision(body, reason);
        };

        if(preference?.card) {
            const preferredDurable = durableCandidates.find((card: any) => card.uuid === preference.card.uuid);
            const preferredBody = bodies.find((card: any) => card.uuid === preference.card.uuid);
            const preferredDecision = preferredDurable
                ? playDurable(preferredDurable, preference.playReason)
                : preferredBody
                    ? playBody(preferredBody, preference.playReason)
                    : null;
            if(preferredDecision) {
                return preferredDecision;
            }
        }
        if(preference?.terminal) {
            return !economy.deferPassForDynastyActions && pass
                ? this.buttonDecision(pass, preference.passReason || 'fate-aware-preserve-fate')
                : null;
        }

        const decision = economy.prioritizeBodies
            ? playBody() || playDurable()
            : playDurable() || playBody();
        if(decision) {
            return decision;
        }
        return !economy.deferPassForDynastyActions && pass
            ? this.buttonDecision(pass, 'fate-aware-preserve-fate')
            : null;
    }

    // Own board cards whose Action is worth firing in the dynasty window
    // (stronghold dig, wall tutors, engineer fetches), highest priority first.
    private dynastyActionSources(me: any, cardHint: CardHintLookup): any[] {
        const onBoard = (location: string) =>
            location === 'play area' || /^(province [1-4]|stronghold province)$/.test(location);
        return this.findVisibleCards(me)
            .filter((card) => {
                if(!card.uuid || !card.id || card.facedown || !onBoard(String(card.location || ''))) {
                    return false;
                }
                const hint: any = cardHint(card.id);
                return !!hint && hint.dynastyAction;
            })
            .sort((a, b) => {
                const priorityOf = (card: any) => (cardHint(card.id) as any)?.priority ?? 5;
                const priorityDiff = priorityOf(b) - priorityOf(a);
                return priorityDiff !== 0 ? priorityDiff : String(a.uuid).localeCompare(String(b.uuid));
            });
    }

    // Dynasty mulligan for a holding engine: send back every non-holding
    // dynasty card in the opening provinces to dig toward Kaiu Wall holdings,
    // keeping any holding already there.
    private holdingMulliganDecision(me: any, buttons: any[]): BotDecision | null {
        const nonHolding = this.findVisibleCards(me).find((card) =>
            card.selectable && card.uuid && card.type && card.type !== 'holding' &&
            !card.selected && !this.isAttempted('cardClicked', [card.uuid]));
        if(nonHolding) {
            return this.cardClickDecision(nonHolding, 'mulligan-for-holdings');
        }
        return this.buttonDecision(this.findButton(buttons, ['done']), 'finish-mulligan');
    }

    private attachmentTowerMulliganDecision(me: any, buttons: any[], attachmentTower: DragonAttachmentTactics): BotDecision | null {
        const replace = this.findVisibleCards(me).find((card) =>
            card.selectable && card.uuid && !card.selected &&
            attachmentTower.shouldMulliganDynasty(card) &&
            !this.isAttempted('cardClicked', [card.uuid]));
        if(replace) {
            return this.cardClickDecision(replace, 'attachment-tower-mulligan');
        }
        return this.buttonDecision(this.findButton(buttons, ['done']), 'finish-mulligan');
    }

    private dynastyDiscardDecision(playerState: any, me: any, buttons: any[], duelist: DuelTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null): BotDecision | null {
        // End-of-round province cleanup: discard leftover faceup dynasty cards
        // so provinces refill with fresh cards, then confirm with Done. Never
        // discard a holding — holdings (Kaiu Wall especially) are permanent
        // board value and throwing them away is always a loss.
        const board = this.myCharactersInPlay(me);
        const leftover = this.findVisibleCards(playerState).find((card) =>
            card.selectable && !card.selected && card.uuid && card.type !== 'holding' &&
            !(duelist && duelist.shouldKeepDynasty(card.id, board)) &&
            !(attachmentTower && attachmentTower.shouldKeepDynasty(card.id, board)) &&
            !this.isAttempted('cardClicked', [card.uuid]));
        if(leftover) {
            return this.cardClickDecision(leftover, 'discard-leftover-dynasty');
        }

        return this.buttonDecision(this.findButton(buttons, ['done']), 'finish-dynasty-discard');
    }

    private ringDecision(playerState: any, me: any, title: string, dishonor: DishonorTactics | null = null, glory: GloryTactics | null = null, dragon: DragonTactics | null = null, shugenja: ShugenjaTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null): BotDecision | null {
        const rings = Object.values(playerState?.rings || {}).filter((ring: any) =>
            ring && ring.unselectable !== true && !this.isAttempted('ringClicked', [ring.element]));
        if(rings.length === 0) {
            return null;
        }

        // Same value ordering as conflict declaration — a random pick here
        // hands weak rings (air) to card abilities that ask for a ring.
        const opponent = this.opponentPlayer(playerState, me);
        if(shugenja && title.includes('claim and resolve')) {
            const mine = this.myCharactersInPlay(me);
            const theirs = this.myCharactersInPlay(opponent);
            rings.sort((a: any, b: any) => {
                const scoreDiff = shugenja.offeringsRingScore(b, mine, theirs) -
                    shugenja.offeringsRingScore(a, mine, theirs);
                return scoreDiff !== 0 ? scoreDiff : RING_ORDER.indexOf(a.element) - RING_ORDER.indexOf(b.element);
            });
        } else if(shugenja && title.includes('ring to return')) {
            rings.sort((a: any, b: any) =>
                this.ringScore(a, me, opponent, dishonor, glory, dragon, shugenja, undefined, attachmentTower) -
                this.ringScore(b, me, opponent, dishonor, glory, dragon, shugenja, undefined, attachmentTower));
        } else if(shugenja && title.includes('ring to take')) {
            rings.sort((a: any, b: any) => {
                const scoreDiff = shugenja.togamaRingScore(b, this.myCharactersInPlay(me), this.myCharactersInPlay(opponent)) -
                    shugenja.togamaRingScore(a, this.myCharactersInPlay(me), this.myCharactersInPlay(opponent));
                return scoreDiff !== 0 ? scoreDiff : RING_ORDER.indexOf(a.element) - RING_ORDER.indexOf(b.element);
            });
        } else {
            rings.sort((a: any, b: any) => {
                const scoreDiff = this.ringScore(b, me, opponent, dishonor, glory, dragon, shugenja, undefined, attachmentTower) - this.ringScore(a, me, opponent, dishonor, glory, dragon, shugenja, undefined, attachmentTower);
                return scoreDiff !== 0 ? scoreDiff : RING_ORDER.indexOf(a.element) - RING_ORDER.indexOf(b.element);
            });
        }
        const ring: any = rings[0];

        return {
            command: 'ringClicked',
            args: [ring.element],
            target: ring.element,
            reason: title.includes('conflict') ? 'choose-conflict-ring' : 'choose-ring'
        };
    }

    // Reaction/interrupt windows list the cards whose abilities may trigger as
    // selectable. Province and stronghold abilities are free and near-always
    // worth firing (e.g. Meditations on the Tao stripping attacker fate);
    // character and event reactions stay passed until per-card knowledge
    // exists, because firing them blindly wastes fate and honor.
    private triggeredWindowDecision(playerState: any, me: any, buttons: any[], windowTitle: string, playCost?: number, cardHint?: CardHintLookup, profile: DeckProfile = DEFAULT_PROFILE, conflictCosts?: Record<string, number>, lion: LionTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null, duelist: DuelTactics | null = null, duelMargin?: number, interruptedEventIsMine?: boolean): BotDecision | null {
        // A cost increase can make the engine expose Castle while a printed
        // cost-zero attachment is being played. Preserve the once-per-round
        // bow for a printed paid attachment instead of discounting that card.
        const castle = attachmentTower && me?.stronghold?.id === 'iron-mountain-castle'
            ? me.stronghold
            : null;
        if(castle?.selectable && castle.uuid && !castle.bowed &&
            !this.isAttempted('cardClicked', [castle.uuid])) {
            const playedAttachment = this.findVisibleCards(me).find((card) =>
                card.type === 'attachment' && card.name &&
                windowTitle.includes(String(card.name).toLowerCase()));
            const visibleCost = Number(playedAttachment?.printedCost ?? playedAttachment?.cost);
            const printedCost = typeof playCost === 'number' ? playCost : visibleCost;
            if(Number.isFinite(printedCost) && printedCost === 0) {
                const pass = this.findButton(buttons, ['pass', 'done']);
                if(pass) {
                    return this.buttonDecision(pass, 'save-iron-mountain-castle-free-attachment');
                }
            }
            return this.cardClickDecision(castle, 'iron-mountain-castle-reduce-attachment');
        }

        // Facedown province summaries carry no type/isProvince flags, so also
        // match by province location.
        const source = this.findVisibleCards(me).find((card) =>
            card.selectable && card.uuid &&
            (card.isProvince || card.type === 'province' || card.type === 'stronghold' ||
                /^(province [1-4]|stronghold province)$/.test(String(card.location || ''))) &&
            !this.isAttempted('cardClicked', [card.uuid]) &&
            // A province whose targeting canceled twice this round is dead until
            // the board changes — same guard the character/event branch uses.
            // Without it a trigger→cancel→retrigger cycle loops the window,
            // because the intervening target sub-prompt wipes the attempted-set.
            !this.isCancelVetoed(card.id) &&
            this.provinceReactionWorthIt(card, playerState, me));
        if(source) {
            return this.cardClickDecision(source, 'trigger-province-ability');
        }

        // Character/event reactions fire only with an LLM hint that rates the
        // ability worth using — blind triggers waste fate and honor.
        if(cardHint) {
            let hinted = this.findVisibleCards(me)
                .filter((card) => {
                    if(!card.selectable || !card.uuid || !card.id || this.isAttempted('cardClicked', [card.uuid]) || this.isCancelVetoed(card.id)) {
                        return false;
                    }
                    const hint = cardHint(card.id);
                    if(!hint || hint.useWhen === 'never' || hint.priority < 6) {
                        return false;
                    }
                    if(card.id === 'iaijutsu-master' &&
                        (!duelist || !duelist.shouldUseIaijutsuMaster(duelMargin))) {
                        return false;
                    }
                    if(card.id === 'voice-of-honor' && interruptedEventIsMine === true) {
                        return false;
                    }
                    if(duelist?.duelSourceId(card)) {
                        const opponent = this.opponentPlayer(playerState, me);
                        if(!duelist.shouldStartDuel(
                            card,
                            this.myCharactersInPlay(me),
                            this.myCharactersInPlay(opponent),
                            (candidate, axis) => this.skillValue(candidate, axis) || 0
                        )) {
                            return false;
                        }
                    }
                    return card.id !== 'feeding-an-army' || !lion ||
                        lion.shouldUseFeedingArmy(this.myCharactersInPlay(me));
                })
                .sort((a, b) => {
                    const priorityDiff = (cardHint(b.id)?.priority ?? 5) - (cardHint(a.id)?.priority ?? 5);
                    return priorityDiff !== 0 ? priorityDiff : String(a.uuid).localeCompare(String(b.uuid));
                });
            // Only hand/discard cards have trustworthy purchase-cost hints.
            // If an in-play reaction is mixed into this window its cost stays
            // unknown, which deliberately makes the planner retain the
            // priority order instead of pretending every board ability is free.
            hinted = this.conflictCardEconomyOrder(
                hinted,
                me?.stats?.fate ?? 0,
                profile,
                cardHint,
                conflictCosts
            );
            if(hinted.length > 0) {
                return this.cardClickDecision(hinted[0], 'trigger-hinted-ability');
            }
        }

        return this.buttonDecision(this.findButton(buttons, ['pass']) || buttons[0], 'pass-window');
    }

    // Province reactions fire unconditionally except the ones with a real
    // cost. Endless Plains BREAKS ITSELF as its cost (the opponent then
    // discards an attacking character of their choice): only trade the
    // province when the attack carries a real threat — an attacker with 2+
    // fate or 5+ military — or when the defense could not stop the break
    // anyway (the province was lost either way; take a body with it).
    private provinceReactionWorthIt(card: any, playerState: any, me: any): boolean {
        // Sacred Sanctuary readies a BOWED friendly character. With none on the
        // board its targeting step has only wrong-side options and immediately
        // cancels — and because the intervening "Choose a character" sub-prompt
        // wipes the attempted-set, the bot re-triggers it and loops (a stalled
        // game that balloons the heap under the self-play memory cap). Only fire
        // it when there is actually a bowed character to ready.
        if(card.id === 'sacred-sanctuary') {
            return this.myCharactersInPlay(me).some((c: any) => c.bowed);
        }
        if(card.id !== 'endless-plains') {
            return true;
        }
        const opponent = this.opponentPlayer(playerState, me);
        const attackers = (opponent?.cardPiles?.cardsInPlay || []).filter((c: any) =>
            c.type === 'character' && c.inConflict);
        if(attackers.length === 0) {
            return false;
        }
        if(attackers.some((c: any) => (Number(c.fate) || 0) >= 2 || (this.skillValue(c, 'military') || 0) >= 5)) {
            return true;
        }
        const attackerSkill = attackers.reduce((total: number, c: any) =>
            total + Math.max(this.skillValue(c, 'military') || 0, 0), 0);
        const myPotential = this.myCharactersInPlay(me)
            .filter((c: any) => !c.bowed)
            .reduce((total: number, c: any) => total + Math.max(this.skillValue(c, 'military') || 0, 0), 0);
        return myPotential < attackerSkill;
    }

    private replayCardDecision(
        playerState: any,
        me: any,
        cards: any[],
        buttons: any[],
        targetHint?: TargetHint,
        cardHint?: CardHintLookup,
        profile: DeckProfile = DEFAULT_PROFILE,
        handStats?: HandStats,
        conflictCosts?: Record<string, number>,
        dishonor: DishonorTactics | null = null,
        duelist: DuelTactics | null = null,
        shugenja: ShugenjaTactics | null = null,
        attachmentTower: DragonAttachmentTactics | null = null
    ): BotDecision | null {
        const visibleDiscardCards = (cards || []).filter((card) =>
            String(card?.location || '').toLowerCase().includes('discard') &&
            !this.failedPlayCards.has(card.uuid));
        const sourceId = targetHint?.sourceCardId;
        const prompt = `${me?.promptTitle || ''} ${me?.menuTitle || ''}`.toLowerCase();
        const kyudenSpellPrompt = sourceId === 'kyuden-isawa' && prompt.includes('spell event');
        // Older state adapters can omit `location` on cards in a Kyuden
        // selector. The source identifies that selector unambiguously.
        const discardCards = kyudenSpellPrompt ? cards : visibleDiscardCards;
        if(discardCards.length === 0) {
            return null;
        }
        const playsImmediately = (targetHint?.gameActions || []).includes('playCard') ||
            // Compatibility for older/custom prompt adapters that expose the
            // source but not the nested PlayCardAction leaf.
            kyudenSpellPrompt;
        // Exposed Courtyard grants direct play from discard for this conflict;
        // candidate value must be judged now even though the actual playCard
        // action happens in the following normal action window.
        const grantsDirectPlay = sourceId === 'exposed-courtyard';
        if(!playsImmediately && !grantsDirectPlay) {
            return null;
        }

        const playCtx = this.playbookContext(playerState, me, dishonor);
        const fateCostIgnored = !!targetHint?.playCardFateCostIgnored || sourceId === 'kunshu';
        const effectiveCosts = fateCostIgnored
            ? Object.fromEntries(discardCards.filter((card) => card.uuid).map((card) => [card.uuid, 0]))
            : conflictCosts || {};
        if(fateCostIgnored) {
            // Preserve every normal strategic/targeting gate, but make gates
            // whose fate check is solely affordability see the source's free
            // play. Honor and source costs remain unchanged.
            playCtx.fate = Number.MAX_SAFE_INTEGER;
        }
        playCtx.conflictCosts = effectiveCosts;
        const forcedBearerUuid = sourceId === 'inventive-mirumoto'
            ? targetHint?.sourceUuid || playCtx.myCharacters.find((card: any) =>
                card.id === 'inventive-mirumoto')?.uuid
            : undefined;
        const allowWithoutReadyParticipant = sourceId === 'kuro';
        let candidates = discardCards.filter((card) => this.conflictCardHasPlayIntent(
            card,
            playCtx,
            cardHint,
            handStats,
            false,
            duelist,
            attachmentTower,
            forcedBearerUuid,
            allowWithoutReadyParticipant
        ));

        let pick: any = null;
        if(sourceId === 'kyuden-isawa' && shugenja) {
            playCtx.canPlayConflictCard = (card: any) => candidates.some((candidate) =>
                candidate.uuid === card.uuid);
            pick = shugenja.pickKyudenSpell(candidates, playCtx);
        } else {
            candidates = candidates.sort((a, b) => {
                if(attachmentTower) {
                    const attachmentDiff = attachmentTower.attachmentPriority(b.id) -
                        attachmentTower.attachmentPriority(a.id);
                    if(attachmentDiff !== 0) {
                        return attachmentDiff;
                    }
                }
                const priorityOf = (card: any) =>
                    (card.id && cardHint ? cardHint(card.id)?.priority : undefined) ?? 5;
                const priorityDiff = priorityOf(b) - priorityOf(a);
                if(priorityDiff !== 0) {
                    return priorityDiff;
                }
                const contributionDiff =
                    (this.handContribution(b, playCtx.conflictType, handStats, cardHint, playCtx) ?? -1) -
                    (this.handContribution(a, playCtx.conflictType, handStats, cardHint, playCtx) ?? -1);
                return contributionDiff !== 0
                    ? contributionDiff
                    : String(a.uuid || '').localeCompare(String(b.uuid || ''));
            });
            if(!attachmentTower) {
                candidates = this.conflictCardEconomyOrder(
                    candidates,
                    fateCostIgnored ? 0 : playCtx.fate,
                    profile,
                    cardHint,
                    effectiveCosts,
                    (card) => this.handContribution(card, playCtx.conflictType, handStats, cardHint, playCtx),
                    playCtx.strengthNeeded
                );
            }
            pick = candidates[0] || null;
        }

        if(pick) {
            return this.cardClickDecision(pick, 'replay-card-shared-play-intent');
        }
        const cancel = this.findButton(buttons, ['cancel']);
        if(cancel) {
            return this.buttonDecision(cancel, 'replay-no-useful-card');
        }
        // Forced replay selectors cannot be cancelled. Resolve one legal card
        // to advance the game rather than exhausting the bot click cap.
        return discardCards.length > 0
            ? this.cardClickDecision(discardCards[0], 'replay-card-forced-fallback')
            : null;
    }

    private cardDecision(
        playerState: any,
        me: any,
        title: string,
        buttons: any[],
        targetHint?: TargetHint,
        cardHint?: CardHintLookup,
        profile: DeckProfile = DEFAULT_PROFILE,
        handStats?: HandStats,
        conflictCosts?: Record<string, number>,
        dishonor: DishonorTactics | null = null,
        glory: GloryTactics | null = null,
        lion: LionTactics | null = null,
        dragon: DragonTactics | null = null,
        duelist: DuelTactics | null = null,
        shugenja: ShugenjaTactics | null = null,
        attachmentTower: DragonAttachmentTactics | null = null,
        crane: CraneBaselineTactics | null = null,
        attachmentControl: AttachmentControlTactics | null = null
    ): BotDecision | null {
        const cards = this.findVisibleCards(playerState).filter((card) =>
            card.selectable && card.uuid && !this.isAttempted('cardClicked', [card.uuid]));
        if(cards.length === 0) {
            // Prompts can offer the opponent's facedown provinces, which have
            // no uuid in the bot's view — click them by location like the
            // conflict declaration does.
            return this.facedownSelectableDecision(playerState, me);
        }

        const skillType = title.includes('political') ? 'political' : 'military';

        const replay = this.replayCardDecision(
            playerState,
            me,
            cards,
            buttons,
            targetHint,
            cardHint,
            profile,
            handStats,
            conflictCosts,
            dishonor,
            duelist,
            shugenja,
            attachmentTower
        );
        if(replay) {
            return replay;
        }

        // Older/custom prompt adapters may omit the target hint for a single
        // gameAction. Let Go is never allowed to fall through to generic card
        // selection: infer its harmful enemy-only target from the prompt title.
        if(!targetHint && title.includes('let go')) {
            targetHint = {
                gameActions: ['discardFromPlay'],
                sourceIsMine: true,
                sourceType: 'event',
                sourceCardId: 'let-go'
            };
        }

        if(dragon && targetHint?.sourceCardId === 'ancient-master' &&
            !(targetHint.gameActions || []).includes('attach')) {
            const pick = dragon.pickAncientMasterCard(cards);
            if(pick) {
                return this.cardClickDecision(pick, 'ancient-master-card-order');
            }
        }

        if(attachmentTower && targetHint?.sourceCardId === 'keen-warrior' && title.includes('bottom')) {
            const bottom = attachmentTower.pickLeastValuable(cards);
            if(bottom) {
                return this.cardClickDecision(bottom, 'keen-warrior-bottom-weakest');
            }
        }

        if(attachmentTower && ['illustrious-forge', 'agasha-swordsmith']
            .includes(targetHint?.sourceCardId || '')) {
            const attachment = attachmentTower.pickAttachment(cards);
            if(attachment) {
                return this.cardClickDecision(attachment, 'attachment-tower-search-pick');
            }
        }

        if(shugenja && title.includes('character to replace')) {
            const base = shugenja.pickDisguiseTarget(cards, me?.stats?.fate ?? 0);
            if(base) {
                return this.cardClickDecision(base, 'tadaka-disguise-base');
            }
        }

        // TargetModes.Ability exposes only characters with a legal printed
        // ability. Keep the deck's preferred friendly copy order, then fall
        // back to the best legal enemy character. The title check covers this
        // special target mode even when it does not expose a normal gameAction
        // target hint.
        if(attachmentTower && (targetHint?.sourceCardId === 'togashi-yokuni' ||
            title.includes('character to copy from'))) {
            const myUuids = new Set(this.findVisibleCards(me).map((card) => card.uuid));
            const mine = cards.filter((card) => this.cardBelongsToPlayer(card, me, myUuids));
            const theirs = cards.filter((card) => !this.cardBelongsToPlayer(card, me, myUuids));
            const copy = attachmentTower.pickYokuniCopy(
                mine,
                theirs,
                (card) => (card.id && cardHint ? cardHint(card.id)?.priority : undefined) ?? 0
            );
            if(copy) {
                this.yokuniCopiedNiten = copy.id === 'niten-master';
                const enemy = theirs.some((card) => card.uuid === copy.uuid);
                return this.cardClickDecision(copy, enemy
                    ? 'yokuni-copy-enemy-ability'
                    : 'yokuni-copy-best-ability');
            }
            const cancel = this.findButton(buttons, ['cancel']);
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        // Oracle of Stone's discard prompt carries no target hint. Cycle the
        // two least valuable cards while protecting Tadaka and the build-around
        // spells; never fall through to the raw skill sort.
        if(shugenja && title.includes('oracle of stone') && title.includes('choose 2 cards to discard')) {
            const done = this.findButton(buttons, ['done']);
            const selected = this.findVisibleCards(me).filter((card) => card.selected).length;
            if(selected >= 2 && done) {
                return this.buttonDecision(done, 'oracle-discard-two');
            }
            const discard = shugenja.pickKyudenDiscard(cards);
            if(discard) {
                return this.cardClickDecision(discard, 'oracle-discard-weakest');
            }
        }

        if(targetHint) {
            const aimed = this.polarityTargetDecision(cards, playerState, me, skillType, targetHint, buttons, cardHint, glory, lion, dragon, duelist, shugenja, attachmentTower, crane, attachmentControl);
            if(aimed) {
                return aimed;
            }
            if(targetHint.sourceCardId === 'let-go') {
                // No enemy attachment and no Cancel button: return no card
                // decision rather than ever discard one of our attachments.
                return null;
            }
        }

        if(shugenja && title.includes('spell or kiho')) {
            const spell = shugenja.pickSpell(cards);
            if(spell) {
                return this.cardClickDecision(spell, 'shrine-maiden-pick-spell');
            }
        }

        const bySkill = this.sortBySkillDesc(cards, skillType);
        const preferred = cards.find((card) => title.includes('province') && card.type === 'province') ||
            cards.find((card) => title.includes('attacker') && card.type === 'character') ||
            (title.includes('target') ? bySkill[0] : undefined) ||
            bySkill[0];

        return this.cardClickDecision(preferred, 'choose-card');
    }

    // Aim an ability target at the right side of the board: harmful effects
    // hit the opponent's strongest card (or our weakest when only own cards
    // are legal, e.g. a forced sacrifice), helpful effects go to our own side
    // (preferring characters already in the conflict).
    private polarityTargetDecision(cards: any[], playerState: any, me: any, skillType: string, targetHint: TargetHint, buttons: any[], cardHint?: CardHintLookup, glory: GloryTactics | null = null, lion: LionTactics | null = null, dragon: DragonTactics | null = null, duelist: DuelTactics | null = null, shugenja: ShugenjaTactics | null = null, attachmentTower: DragonAttachmentTactics | null = null, crane: CraneBaselineTactics | null = null, attachmentControl: AttachmentControlTactics | null = null): BotDecision | null {
        const myUuids = new Set(this.findVisibleCards(me).map((card) => card.uuid));
        const mine = cards.filter((card) => this.cardBelongsToPlayer(card, me, myUuids));
        const theirs = cards.filter((card) => !this.cardBelongsToPlayer(card, me, myUuids));
        const actionNames = targetHint.gameActions || [];
        // The bot's own optional abilities offer Cancel at the targeting
        // stage (before costs are paid); aborting always beats aiming an
        // effect at the wrong side of the board.
        const cancel = this.findButton(buttons, ['cancel']);

        // Feeding an Army pays a deliberately harmful OWN-province cost. The
        // generic `break` polarity correctly aims ordinary break effects at
        // the opponent, but would cancel this cost every time. Spend the least
        // valuable selectable outer province and never the stronghold province.
        if(lion && targetHint.sourceCardId === 'feeding-an-army' && actionNames.includes('break')) {
            const provinces = mine.filter((card) =>
                (card.isProvince || card.type === 'province' || /^province [1-4]$/.test(String(card.location || ''))) &&
                String(card.location || '') !== 'stronghold province');
            const pick = provinces.sort((a, b) => {
                // The Art of War already pays back cards when it breaks; trade
                // it first, then the weakest expendable revealed province.
                const artDiff = (b.id === 'the-art-of-war' ? 1 : 0) - (a.id === 'the-art-of-war' ? 1 : 0);
                if(artDiff !== 0) {
                    return artDiff;
                }
                const strengthA = Number(a?.strengthSummary?.stat) || 0;
                const strengthB = Number(b?.strengthSummary?.stat) || 0;
                return strengthA - strengthB || String(a.uuid).localeCompare(String(b.uuid));
            })[0];
            if(pick) {
                return this.cardClickDecision(pick, 'lion-feeding-break-own-province');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        // Noble Sacrifice resolves in two prompts: first sacrifice our own
        // honored body as the cost, then discard the opponent's dishonored
        // character. Generic harmful polarity cannot distinguish those stages.
        if(duelist && targetHint.sourceCardId === 'noble-sacrifice') {
            if(actionNames.includes('sacrifice') && mine.length > 0) {
                const sacrifice = duelist.pickNobleSacrifice(mine,
                    (card) => Math.max(this.skillValue(card, 'military') || 0, this.skillValue(card, 'political') || 0));
                if(sacrifice) {
                    return this.cardClickDecision(sacrifice, 'duel-noble-sacrifice-cheapest');
                }
            }
            if(actionNames.includes('discardFromPlay') && theirs.length > 0) {
                const victim = duelist.pickNobleVictim(theirs,
                    (card) => Math.max(this.skillValue(card, 'military') || 0, this.skillValue(card, 'political') || 0));
                if(victim) {
                    return this.cardClickDecision(victim, 'duel-noble-discard-strongest');
                }
            }
        }

        if(duelist && targetHint.sourceCardId === 'way-of-the-crane' && actionNames.includes('honor')) {
            const target = duelist.pickHonorTarget(mine,
                (card) => Math.max(this.skillValue(card, 'military') || 0, this.skillValue(card, 'political') || 0));
            if(target) {
                return this.cardClickDecision(target, 'duel-honor-tower');
            }
        }

        if(crane && targetHint.sourceCardId === 'savvy-politician' && actionNames.includes('honor')) {
            const target = crane.pickHonorChainTarget(mine);
            if(target) {
                return this.cardClickDecision(target, 'crane-savvy-honor-chain');
            }
        }

        if(crane && targetHint.sourceCardId === 'doji-challenger') {
            const homeReady = theirs.filter((card) => !card.bowed && !card.inConflict);
            if(homeReady.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(homeReady, skillType)[0],
                    'crane-challenger-pull-strongest-future-defender');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        // Playing Jade Tetsubo and using its in-play action share the same
        // source card id.  The former must attach to one of our characters;
        // only the latter should look for an opposing character whose fate
        // can be returned.  Handle attachment targeting in the generic
        // attachment branch below.
        if(attachmentTower && targetHint.sourceCardId === 'jade-tetsubo' &&
            !(targetHint.gameActions || []).includes('attach')) {
            const fateTargets = theirs.filter((card) => (Number(card.fate) || 0) > 0);
            if(fateTargets.length > 0) {
                const pick = fateTargets.slice().sort((a, b) =>
                    (Number(b.fate) || 0) - (Number(a.fate) || 0) ||
                    (this.skillValue(b, skillType) || 0) - (this.skillValue(a, skillType) || 0))[0];
                return this.cardClickDecision(pick, 'jade-tetsubo-strip-fate');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        if(['let-go', 'miya-mystic'].includes(targetHint.sourceCardId || '')) {
            const selectable = new Map(cards.map((card) => [card.uuid, card]));
            const opponent = this.opponentPlayer(playerState, me);
            const ownCarriers = this.myCharactersInPlay(me).map((carrier: any) => ({
                ...carrier,
                attachments: (carrier.attachments || []).map((attachment: any) =>
                    selectable.get(attachment.uuid) || attachment)
            }));
            const enemyCarriers = this.myCharactersInPlay(opponent).map((carrier: any) => ({
                ...carrier,
                attachments: (carrier.attachments || []).map((attachment: any) =>
                    selectable.get(attachment.uuid) || attachment)
            }));
            const picked = attachmentControl?.pickTarget(
                ownCarriers,
                enemyCarriers,
                (carrier) => Math.max(
                    this.skillValue(carrier, 'military') || 0,
                    this.skillValue(carrier, 'political') || 0
                )
            );
            const legalPick = picked && selectable.get(picked.uuid);
            if(legalPick) {
                const mineAttachment = ownCarriers.some((carrier: any) =>
                    (carrier.attachments || []).some((attachment: any) => attachment.uuid === legalPick.uuid));
                return this.cardClickDecision(legalPick, mineAttachment
                    ? 'discard-own-debuff-attachment'
                    : 'discard-enemy-value-attachment');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        if(lion && targetHint.sourceCardId === 'emperor-s-summons') {
            const tower = lion.pickTower(mine, (card) => this.skillValue(card, skillType) || 0);
            if(tower) {
                return this.cardClickDecision(tower, 'lion-summons-strongest-tower');
            }
        }

        if(lion && targetHint.sourceCardId === 'forebearer-s-echoes') {
            const tower = lion.pickTower(mine, (card) => this.skillValue(card, skillType) || 0);
            if(tower) {
                return this.cardClickDecision(tower, 'lion-echoes-strongest-character');
            }
        }

        if(lion && targetHint.sourceCardId === 'weight-of-duty') {
            const actions = targetHint.gameActions || [];
            if(actions.includes('sacrifice') && mine.length > 0) {
                const cheap = lion.pickCheapSacrifice(mine, (card) => this.skillValue(card, skillType) || 0);
                if(cheap) {
                    return this.cardClickDecision(cheap, 'lion-weight-sacrifice-cheap');
                }
            }
            if(actions.includes('bow') && theirs.length > 0) {
                const ready = this.sortBySkillDesc(theirs.filter((card) => !card.bowed), skillType);
                return this.cardClickDecision(ready[0] || this.sortBySkillDesc(theirs, skillType)[0], 'lion-weight-bow-enemy');
            }
        }

        if(lion && targetHint.sourceCardId === 'elegant-tessen' &&
            (targetHint.gameActions || []).includes('attach')) {
            const cheap = lion.pickTessenTarget(mine, (card) => this.skillValue(card, skillType) || 0);
            if(cheap) {
                return this.cardClickDecision(cheap, 'lion-tessen-ready-cheap');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'lion-tessen-no-bowed-cheap');
            }
        }

        if(lion && targetHint.sourceCardId === 'true-strike-kenjutsu' &&
            (targetHint.gameActions || []).includes('attach')) {
            const tower = lion.pickTower(mine.filter((card) => lion.isTower(card)),
                (card) => this.skillValue(card, 'military') || 0);
            if(tower) {
                return this.cardClickDecision(tower, 'lion-kenjutsu-tower');
            }
        }

        if(shugenja && targetHint.sourceCardId === 'isawa-tadaka-2') {
            const prompt = `${me?.promptTitle || ''} ${me?.menuTitle || ''}`.toLowerCase();
            if(prompt.includes('character to replace')) {
                const base = shugenja.pickDisguiseTarget(mine, me?.stats?.fate ?? 0);
                if(base) {
                    return this.cardClickDecision(base, 'tadaka-disguise-base');
                }
            }
            if((targetHint.gameActions || []).includes('removeFromGame') && mine.length > 0) {
                const done = this.findButton(buttons, ['done']);
                const alreadyPicked = this.findVisibleCards(playerState).some((card) => card.selected) ||
                    this.findVisibleCards(me).some((card) => card.uuid && this.isAttempted('cardClicked', [card.uuid]));
                if(alreadyPicked && done) {
                    return this.buttonDecision(done, 'tadaka-cost-one-card');
                }
                const weakest = shugenja.pickWeakest(mine);
                if(weakest) {
                    return this.cardClickDecision(weakest, 'tadaka-remove-weakest');
                }
            }
        }

        if(shugenja && targetHint.sourceCardId === 'fushicho' &&
            (targetHint.gameActions || []).includes('putIntoPlay')) {
            const resurrect = shugenja.pickFushichoTarget(mine);
            if(resurrect) {
                return this.cardClickDecision(resurrect, 'fushicho-five-cost-character');
            }
        }

        // Ujina is a forced reaction. Prefer an enemy with no fate; if the
        // engine offers only our characters, cancelling simply reopens the
        // forced prompt forever, so sacrifice our weakest legal body.
        if(shugenja && targetHint.sourceCardId === 'isawa-ujina' &&
            (targetHint.gameActions || []).includes('removeFromGame')) {
            if(theirs.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(theirs, skillType)[0], 'ujina-remove-enemy');
            }
            if(mine.length > 0) {
                return this.cardClickDecision(shugenja.pickWeakest(mine), 'ujina-forced-own-weakest');
            }
        }

        if(shugenja && targetHint.sourceCardId === 'kyuden-isawa') {
            const pick = shugenja.pickKyudenDiscard(mine);
            if(pick) {
                return this.cardClickDecision(pick, 'kyuden-discard-spell');
            }
        }

        if(shugenja && targetHint.sourceCardId === 'shrine-maiden') {
            const spell = shugenja.pickSpell(mine);
            if(spell) {
                return this.cardClickDecision(spell, 'shrine-maiden-pick-spell');
            }
        }

        if(shugenja && targetHint.sourceCardId === 'oracle-of-stone' &&
            (targetHint.gameActions || []).includes('discardCard')) {
            const done = this.findButton(buttons, ['done']);
            const selected = this.findVisibleCards(me).filter((card) => card.selected).length;
            if(selected >= 2 && done) {
                return this.buttonDecision(done, 'oracle-discard-two');
            }
            const discard = shugenja.pickKyudenDiscard(mine);
            if(discard) {
                return this.cardClickDecision(discard, 'oracle-discard-weakest');
            }
        }

        if(shugenja && targetHint.sourceCardId === 'consumed-by-five-fires') {
            const target = shugenja.pickFiveFiresTarget(theirs, (card) =>
                Math.max(this.skillValue(card, 'military') || 0, this.skillValue(card, 'political') || 0));
            if(target) {
                return this.cardClickDecision(target, 'five-fires-enemy-tower');
            }
            const cancel = this.findButton(buttons, ['cancel']);
            if(cancel) {
                return this.buttonDecision(cancel, 'five-fires-skip-neutralized');
            }
        }

        if(shugenja && targetHint.sourceCardId === 'clarity-of-purpose') {
            const legal = mine.filter((card) => card.inConflict && !card.bowed);
            const tower = shugenja.pickTower(legal,
                (card) => this.skillValue(card, skillType) || 0);
            if(tower) {
                return this.cardClickDecision(tower, 'clarity-of-purpose-tower');
            }
            const cancel = this.findButton(buttons, ['cancel']);
            if(cancel) {
                return this.buttonDecision(cancel, 'clarity-of-purpose-no-participant');
            }
            return null;
        }

        if(shugenja && ['adept-of-the-waves', 'supernatural-storm'].includes(targetHint.sourceCardId || '')) {
            const legal = targetHint.sourceCardId === 'supernatural-storm'
                ? mine.filter((card) => card.inConflict && !card.bowed)
                : mine;
            const tower = shugenja.pickTower(legal.length > 0 ? legal : mine,
                (card) => this.skillValue(card, skillType) || 0);
            if(tower) {
                return this.cardClickDecision(tower, `${targetHint.sourceCardId}-tower`);
            }
        }

        // Ride On / Favorable Ground move a character in or home; the bot plays
        // them to add a body, so aim at a ready character sitting at home —
        // moving that one INTO the conflict is the useful direction. The card
        // offers both sendHome and moveToConflict on the target, so picking a
        // participant would move our own body OUT (self-harm) — never do that.
        if(targetHint.sourceCardId === 'favorable-ground') {
            const standing = this.conflictStanding(playerState, me);
            const opponent = this.opponentPlayer(playerState, me);
            const strongholdConflict = !!standing && (standing.amAttacker
                ? this.strongholdUnderAttack(opponent)
                : this.strongholdUnderAttack(me));
            const participants = mine.filter((card) => !card.bowed && card.inConflict);
            if(dragon && standing?.losing && !strongholdConflict && (me?.stats?.conflictsRemaining ?? 0) >= 1 && participants.length > 0) {
                this.favorableGroundRetreatPending = true;
                return this.cardClickDecision(this.sortBySkillDesc(participants, skillType)[0], 'favorable-ground-rescue-tower');
            }
            const home = mine.filter((card) => !card.bowed && !card.inConflict);
            if(home.length > 0) {
                this.favorableGroundRetreatPending = false;
                return this.cardClickDecision(this.sortBySkillDesc(home, skillType)[0], 'favorable-ground-reinforce');
            }
            if(cancel) {
                this.favorableGroundRetreatPending = false;
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }
        if(targetHint.sourceCardId === 'ride-on') {
            const home = mine.filter((card) => !card.bowed && !card.inConflict);
            if(home.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(home, skillType)[0], `${targetHint.sourceCardId}-target-home`);
            }
            // No home body to add: sending an own participant home is never
            // the plan — abort rather than self-harm.
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        // Duel deck: duels compare a specific axis. When the prompt offers
        // OUR characters (send the duelist) pick our strongest on that axis;
        // when it offers THEIRS, duel their strongest beatable body. Attachments stack on
        // the ranked key duelists.
        if(duelist) {
            const axis = targetHint.duelAxis || duelist.duelAxis(targetHint.sourceCardId);
            if(duelist.isTowerAttachment(targetHint.sourceCardId) &&
                (targetHint.gameActions || []).includes('attach')) {
                const maxCopiesPerTarget = targetHint.sourceCardId && cardHint
                    ? (cardHint(targetHint.sourceCardId) as any)?.maxCopiesPerTarget
                    : undefined;
                const pick = duelist.pickAttachmentTarget(
                    mine,
                    targetHint.sourceCardId,
                    maxCopiesPerTarget
                );
                if(pick) {
                    return this.cardClickDecision(pick, targetHint.sourceCardId === 'shukujo'
                        ? 'duel-attach-shukujo-kuwanan'
                        : 'duel-attach-tower');
                }
                if(cancel) {
                    return this.buttonDecision(cancel, targetHint.sourceCardId === 'shukujo'
                        ? 'duel-cancel-shukujo-without-kuwanan'
                        : 'duel-cancel-no-tower-slot');
                }
            }
            if(axis) {
                if(mine.length > 0 && theirs.length === 0) {
                    const opposing = targetHint.duelOpponentUuid
                        ? this.findVisibleCards(playerState).find((card) => card.uuid === targetHint.duelOpponentUuid)
                        : undefined;
                    const baseSkill = (card: any, type: 'military' | 'political') =>
                        this.skillValue(card, type) || 0;
                    const initiatedByMe = targetHint.sourceIsMine !== false;
                    const pick = duelist.pickOwnDuelParticipant(
                        mine,
                        axis,
                        initiatedByMe,
                        opposing,
                        Number(me?.stats?.honor) || 0,
                        baseSkill
                    );
                    const strongest = duelist.pickOwnDuelParticipant(
                        mine,
                        axis,
                        true,
                        opposing,
                        Number(me?.stats?.honor) || 0,
                        baseSkill
                    );
                    const reason = initiatedByMe || !opposing
                        ? 'duel-own-strongest'
                        : pick === strongest
                            ? 'duel-opponent-started-contest'
                            : 'duel-opponent-started-protect-tower';
                    return this.cardClickDecision(pick, reason);
                }
                if(theirs.length > 0) {
                    const challenger = targetHint.duelOpponentUuid
                        ? this.findVisibleCards(playerState).find((card) => card.uuid === targetHint.duelOpponentUuid)
                        : undefined;
                    const pick = duelist.pickOpponentDuelTarget(
                        theirs,
                        axis,
                        challenger,
                        (card, type) => this.skillValue(card, type) || 0
                    );
                    const reason = challenger && duelist.canBeat(
                        challenger,
                        pick,
                        axis,
                        (card, type) => this.skillValue(card, type) || 0
                    ) ? 'duel-enemy-strongest-beatable' : 'duel-enemy-safest-fallback';
                    return this.cardClickDecision(pick, reason);
                }
            }
        }

        // GENERAL duel participant selection (any deck, including when the
        // OPPONENT initiates the duel — then the source is their card and the
        // duelist axis map above does not fire). A duel compares one axis, so
        // when we pick OUR OWN character to enter the duel send the STRONGEST
        // on that axis (the default `duel` action is HARMFUL and would otherwise
        // pick our WEAKEST); when we pick the character to CHALLENGE, aim at the
        // opponent's weakest. Axis = the conflict/prompt skill type.
        if((targetHint.gameActions || []).includes('duel')) {
            // Duelist Training grants its duel to the attached character, so
            // the prompt source is the bearer rather than the attachment. On
            // Doji Kuwanan the duel payoff is bowing its loser: do not keep
            // challenging an already-bowed body after the first duel.
            if(duelist && targetHint.sourceCardId === 'doji-kuwanan' && theirs.length > 0) {
                const readyEnemies = this.sortBySkillDesc(
                    theirs.filter((card) => !card.bowed),
                    'military'
                );
                if(readyEnemies.length > 0) {
                    return this.cardClickDecision(readyEnemies[readyEnemies.length - 1], 'duelist-training-ready-enemy');
                }
                if(cancel) {
                    return this.buttonDecision(cancel, 'cancel-duelist-training-no-ready-enemy');
                }
            }
            if(mine.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(mine, skillType)[0], 'duel-participant-own-strongest');
            }
            if(theirs.length > 0) {
                const sorted = this.sortBySkillDesc(theirs, skillType);
                return this.cardClickDecision(sorted[sorted.length - 1], 'duel-target-enemy-weakest');
            }
        }

        // Dragon build-around attachments (Way of the Dragon doubles the
        // bearer's ability, Finger of Jade shields it): Togashi Mitsu first.
        if(dragon && targetHint.sourceCardId === 'way-of-the-dragon' &&
            (targetHint.gameActions || []).includes('attach')) {
            const pick = dragon.pickWayCharacter(mine);
            if(pick) {
                return this.cardClickDecision(pick, 'dragon-way-repeatable-character');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }
        if(dragon && targetHint.sourceCardId === 'finger-of-jade' &&
            (targetHint.gameActions || []).includes('attach')) {
            const pick = dragon.pickKeyCharacter(mine);
            if(pick) {
                return this.cardClickDecision(pick, 'dragon-attach-key-character');
            }
        }
        // Golden Plains Outpost (Unicorn stronghold): bows itself to MOVE a
        // cavalry character into the conflict. The whole point is to add a
        // BOWED body that could not otherwise defend/attack — a ready home
        // character can just be declared normally, so moving one in is
        // wasted. Aim at the strongest BOWED cavalry; if none is bowed the
        // move has no value, so abort rather than spend the stronghold's bow.
        if(targetHint.sourceCardId === 'golden-plains-outpost') {
            const bowed = mine.filter((card) => card.bowed && !card.inConflict);
            if(bowed.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(bowed, skillType)[0], 'golden-plains-move-bowed');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        // I Am Ready removes 1 fate from a bowed Unicorn to READY it. The
        // target must actually carry fate (0-fate picks are an illegal cost).
        // Prefer a bowed CONFLICT participant (its skill comes straight back
        // into the fight); otherwise stand up the strongest bowed HOME body
        // that has SPARE fate (>1) — the tower character we want available to
        // commit next — so we never strip its last fate.
        if(targetHint.sourceCardId === 'i-am-ready') {
            const withFate = mine.filter((card) => card.bowed && (Number(card.fate) || 0) > 0);
            const inFight = withFate.filter((card) => card.inConflict);
            if(inFight.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(inFight, skillType)[0], 'i-am-ready-participant');
            }
            const homeTower = withFate.filter((card) => !card.inConflict && (Number(card.fate) || 0) > 1);
            if(homeTower.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(homeTower, skillType)[0], 'i-am-ready-home-tower');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        // Sacred Sanctuary readies a Monk: aim at a BOWED one (the generic
        // helpful pick prefers ready characters — the wrong direction).
        if(targetHint.sourceCardId === 'sacred-sanctuary') {
            const bowed = mine.filter((card) => card.bowed);
            if(bowed.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(bowed, skillType)[0], 'sanctuary-ready-bowed');
            }
        }

        // Cycle of Rebirth (and any province card-reshuffle it shares steering
        // with): the Dragon deck plays it to RE-DIG its OWN provinces for
        // Togashi Mitsu, so shuffle away our own WEAKEST province dynasty card —
        // never the opponent's (that just refills THEIR board). Keep Mitsu if he
        // is already showing; cancel rather than target an enemy province.
        if(targetHint.sourceCardId === 'cycle-of-rebirth') {
            const ownDiggable = mine.filter((card) => !dragon?.shouldPreserveProvinceCharacter(card));
            if(ownDiggable.length > 0) {
                const sorted = this.sortBySkillDesc(ownDiggable, skillType);
                return this.cardClickDecision(sorted[sorted.length - 1], 'cycle-own-weakest-province');
            }
            // Only Mitsu (or nothing) of ours is showing — never shuffle Mitsu
            // away, and never target the opponent's province. Abort.
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }

        // Phoenix glory-deck target steering (ids unique to that deck).
        if(targetHint.sourceCardId === 'against-the-waves') {
            // Ready an own BOWED Shugenja (the generic self-side pick would
            // prefer ready ones — the wrong direction here). The rules target
            // is controller:self + Shugenja, so every selectable card is safe
            // even when a public-state adapter omitted owner metadata.
            const bowed = cards.filter((card) => card.bowed);
            const legalOwnShugenja = bowed.length > 0 ? bowed : cards;
            if(legalOwnShugenja.length > 0) {
                const pick = shugenja
                    ? shugenja.pickTower(legalOwnShugenja, (card) => this.skillValue(card, skillType) || 0)
                    : this.sortBySkillDesc(legalOwnShugenja, skillType)[0];
                return this.cardClickDecision(pick, 'waves-ready-bowed');
            }
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
        }
        if(targetHint.sourceCardId === 'game-of-sadane') {
            // Non-duelist fallback. Duel-profile decks are handled above with
            // projected skill and strongest-beatable targeting.
            if(mine.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(mine, 'political')[0], 'sadane-own-duelist');
            }
            if(theirs.length > 0) {
                const sorted = this.sortBySkillDesc(theirs, 'political');
                return this.cardClickDecision(sorted[sorted.length - 1], 'sadane-enemy-weakest');
            }
        }
        if(targetHint.sourceCardId === 'asako-diplomat') {
            // Honor our strongest un-honored character; with everyone
            // honored, dishonor their strongest instead. The follow-up menu
            // reads diplomatChoice.
            const unhonored = mine.filter((card) => !card.isHonored);
            if(unhonored.length > 0) {
                this.diplomatChoice = 'honor';
                return this.cardClickDecision(this.sortByStatusImpact(unhonored, skillType)[0], 'diplomat-honor-own');
            }
            if(theirs.length > 0) {
                this.diplomatChoice = 'dishonor';
                return this.cardClickDecision(this.sortByStatusImpact(theirs, skillType)[0], 'diplomat-dishonor-enemy');
            }
        }
        if(targetHint.sourceCardId === 'isawa-mori-seido' && glory) {
            // +2 glory: an honored participant converts it to skill now,
            // otherwise bank it on the biggest ready body for the favor.
            const pick = glory.pickGloryTarget(mine, (card) => this.skillValue(card, skillType) || 0);
            if(pick) {
                return this.cardClickDecision(pick, 'glory-stronghold-target');
            }
        }
        if(targetHint.sourceCardId === 'ofushikai' && glory &&
            (targetHint.gameActions || []).includes('attach')) {
            // The champion weapon belongs on Shiba Tsukune (its move-home
            // Action only exists there).
            const pick = glory.pickOfushikaiTarget(mine);
            if(pick) {
                return this.cardClickDecision(pick, 'ofushikai-champion');
            }
        }

        // Shameful Display selects EXACTLY two participating characters, then
        // a menu asks which to honor. Pick our best honorable participant
        // first, the opponent's best not-yet-dishonored second (honor ours,
        // dishonor theirs). With no own participant the honor would land on
        // an enemy — cancel instead.
        if(targetHint.sourceCardId === 'shameful-display') {
            const promptTitle = String(me.promptTitle || '');
            // Follow-up prompts after both targets are picked: the honored
            // character must be OURS and the dishonored one THEIRS. When the
            // right side is not legal (own pick already honored / enemy pick
            // already dishonored), give the leftover to the weakest legal
            // card so the misdirected token costs the least.
            if(promptTitle === 'Choose a character to honor') {
                const pick = this.sortByStatusImpact(mine, skillType)[0] ||
                    this.sortBySkillDesc(theirs, skillType).pop();
                return pick ? this.cardClickDecision(pick, 'shameful-honor-own') : null;
            }
            if(promptTitle === 'Choose a character to dishonor') {
                const pick = this.sortByStatusImpact(theirs, skillType)[0] ||
                    this.sortBySkillDesc(mine, skillType).pop();
                return pick ? this.cardClickDecision(pick, 'shameful-dishonor-enemy') : null;
            }
            const anySelected = this.findVisibleCards(playerState).some((card) =>
                card.uuid && this.isAttempted('cardClicked', [card.uuid]));
            if(!anySelected) {
                if(mine.length === 0) {
                    return cancel ? this.buttonDecision(cancel, 'cancel-wrong-side-target') : null;
                }
                const ownSorted = this.sortByStatusImpact(mine, skillType);
                const ownPick = ownSorted.find((card) => !card.isHonored) || ownSorted[0];
                return this.cardClickDecision(ownPick, 'shameful-pick-own');
            }
            const enemySorted = this.sortByStatusImpact(theirs, skillType);
            const second = enemySorted.find((card) => !card.isDishonored) || enemySorted[0] ||
                this.sortBySkillDesc(mine, skillType).pop();
            if(second) {
                return this.cardClickDecision(second, 'shameful-pick-enemy');
            }
        }

        // In Service to My Lord bows a friendly non-unique to ready a unique.
        // Stage 1 offers READY non-uniques (bow the weakest, preferring one
        // outside the conflict); stage 2 offers only BOWED uniques and falls
        // through to the generic self-side pick (strongest).
        if(targetHint.sourceCardId === 'in-service-to-my-lord' && actionNames.includes('bow')) {
            const ready = mine.filter((card) => !card.bowed && !card.isUnique);
            if(ready.length === 0) {
                return cancel ? this.buttonDecision(cancel, 'cancel-in-service-no-nonunique-cost') : null;
            }
            const home = ready.filter((card) => !card.inConflict);
            const pool = home.length > 0 ? home : ready;
            if(lion) {
                const cheap = lion.pickCheapSacrifice(pool, (card) => this.skillValue(card, skillType) || 0);
                if(cheap) {
                    return this.cardClickDecision(cheap, 'lion-in-service-bow-cheap');
                }
            }
            const sorted = this.sortBySkillDesc(pool, skillType);
            return this.cardClickDecision(sorted[sorted.length - 1], 'in-service-bow-weakest');
        }
        const inServiceReadyStage = actionNames.includes('ready') ||
            (actionNames.length === 0 && mine.length > 0 && mine.every((card) => card.isUnique));
        if(lion && targetHint.sourceCardId === 'in-service-to-my-lord' && inServiceReadyStage && mine.some((card) => card.bowed && card.isUnique)) {
            const pick = lion.pickReadyTarget(mine.filter((card) => card.bowed && card.isUnique),
                (card) => this.skillValue(card, skillType) || 0);
            if(pick) {
                return this.cardClickDecision(pick, 'lion-in-service-ready-strong');
            }
        }
        if(targetHint.sourceCardId === 'in-service-to-my-lord') {
            // Never pay the bow cost and then ready an enemy. A legal own
            // unique is required by the play gate; this is the defensive
            // fallback for stale/custom state summaries.
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
            return null;
        }

        // Time for War (lost-political reaction) attaches a permanent weapon to
        // one of our Bushi. Its character pick runs through a selectCard, not the
        // generic 'attach' gameAction, so route it to the tower-biased attachment
        // targeter on the military axis: build the durable tower, not whichever
        // body happens to top the (political) skill sort.
        if(targetHint.sourceCardId === 'time-for-war') {
            return this.attachmentTargetDecision(mine, theirs, playerState, me, 'military', targetHint.sourceCardId);
        }

        // Battlefield attachments (Prepared Ambush, Makeshift War Camp) go on
        // an OWN province — the attacked one while defending, so the effect
        // applies to the conflict being fought.
        if(['prepared-ambush', 'makeshift-war-camp'].includes(targetHint.sourceCardId || '')) {
            const provinces = mine.filter((card) => card.type === 'province' || card.isProvince);
            const pick = provinces.find((card) => card.inConflict) || provinces[0];
            if(pick) {
                return this.cardClickDecision(pick, 'battlefield-own-province');
            }
        }

        // A per-card LLM hint on the source beats the generic action polarity:
        // the hint was derived from the actual card text.
        const sourceHint = targetHint.sourceCardId && cardHint ? cardHint(targetHint.sourceCardId) : undefined;

        if((targetHint.gameActions || []).includes('attach')) {
            if(attachmentTower?.isAttachment(targetHint.sourceCardId)) {
                const pendingBearer = this.pendingDaimyoBearerUuid;
                const target = attachmentTower.pickAttachmentTarget(
                    mine,
                    targetHint.sourceCardId,
                    pendingBearer || undefined,
                    this.yokuniCopiedNiten
                );
                if(target) {
                    if(pendingBearer) {
                        this.pendingDaimyoBearerUuid = null;
                    }
                    return this.cardClickDecision(target, pendingBearer
                        ? 'daimyo-favor-reduced-attachment-target'
                        : 'attachment-tower-target');
                }
                if(cancel) {
                    return this.buttonDecision(cancel, 'cancel-wrong-side-target');
                }
                return null;
            }
            // Some attachments carry an enemy-aimed ABILITY but belong on our
            // own character (True Strike Kenjutsu) — attach own-side first.
            if(sourceHint && ((sourceHint as any).attachSide === 'self' || sourceHint.targetSide === 'self')) {
                const target = this.attachmentTargetDecision(mine, [], playerState, me, skillType,
                    targetHint.sourceCardId, (sourceHint as any).maxCopiesPerTarget);
                if(target) {
                    return target;
                }
                if(cancel) {
                    return this.buttonDecision(cancel, 'cancel-wrong-side-target');
                }
                return null;
            }
            // Control attachments (Pacifism, Fiery Madness, Pit Trap...) are
            // hinted enemy-side: land them on the opponent's best character on
            // the axis the attachment shuts down, never on our own side.
            if(sourceHint && sourceHint.targetSide === 'enemy') {
                const usefulTargets = this.attachmentTargetsWithoutDuplicate(theirs, targetHint.sourceCardId);
                if(usefulTargets.length > 0) {
                    const axis = sourceHint.conflictTypes.length > 0 ? sourceHint.conflictTypes[0] : skillType;
                    // Softskin and Pit Trap both carry a "does not ready" lock:
                    // their value lands on an already-BOWED enemy — pinned there
                    // it stays bowed through the regroup phase (out of the
                    // opponent's next conflicts), which a ready target could
                    // simply decline to trigger. Pin on the strongest bowed
                    // enemy; fall back to the strongest enemy when none are bowed
                    // (Pit Trap's -1/-1 still shrinks the current attacker).
                    if(targetHint.sourceCardId === 'softskin' || targetHint.sourceCardId === 'pit-trap') {
                        const bowedEnemy = this.sortBySkillDesc(usefulTargets.filter((card) => card.bowed), axis);
                        if(bowedEnemy.length > 0) {
                            return this.cardClickDecision(bowedEnemy[0], `${targetHint.sourceCardId}-bowed-enemy`);
                        }
                    }
                    if(CONFLICT_LOCK_ATTACHMENT_IDS.has(targetHint.sourceCardId || '')) {
                        const conflictLockTarget = this.conflictLockTarget(usefulTargets, axis);
                        if(conflictLockTarget) {
                            return this.cardClickDecision(conflictLockTarget, 'attach-debuff-enemy');
                        }
                        if(cancel) {
                            return this.buttonDecision(cancel, 'cancel-wrong-side-target');
                        }
                        return null;
                    }
                    return this.cardClickDecision(this.sortBySkillDesc(usefulTargets, axis)[0], 'attach-debuff-enemy');
                }
                if(theirs.length > 0) {
                    if(cancel) {
                        return this.buttonDecision(cancel, 'cancel-redundant-debuff-attachment');
                    }
                    return null;
                }
                // A debuff attachment with no enemy character to hit must NOT
                // land on our own side — that would shut down our own body.
                // Cancel the play instead.
                if(cancel) {
                    return this.buttonDecision(cancel, 'cancel-wrong-side-target');
                }
                return null;
            }
            return this.attachmentTargetDecision(mine, theirs, playerState, me, skillType, targetHint.sourceCardId, (sourceHint as any)?.maxCopiesPerTarget);
        }

        // Bow and ready are state-sensitive, and several cards leave the target
        // side unrestricted (Hayaken no Shiro, Magistrate Station, Shiotome
        // Encampment, The Pursuit of Justice, Twilight Rider). Readying an
        // already-ready character is a wasted no-op and readying an ENEMY helps
        // them, so every ready aims at our own BOWED character (a participant
        // first). Bowing an already-bowed enemy does nothing, so every bow
        // aims at an enemy that is still READY. This runs before the generic
        // hint/classify paths, which would preferReady() a ready body.
        if(actionNames.includes('honor') && !actionNames.includes('dishonor')) {
            const honorable = mine.filter((card) => !card.isHonored);
            if(honorable.length > 0) {
                return this.cardClickDecision(this.sortByStatusImpact(honorable, skillType)[0], 'honor-own-highest-glory');
            }
        }
        if(actionNames.includes('dishonor') && !actionNames.includes('honor')) {
            const dishonorable = theirs.filter((card) => !card.isDishonored);
            if(dishonorable.length > 0) {
                return this.cardClickDecision(this.sortByStatusImpact(dishonorable, skillType)[0], 'dishonor-enemy-highest-glory');
            }
        }
        if(actionNames.includes('ready') && !actionNames.includes('bow')) {
            const bowedOwn = mine.filter((card) => card.bowed);
            if(bowedOwn.length > 0) {
                // Rank bowed own bodies: CONFLICT participants first (their
                // skill returns to the fight in progress), then multi-fate
                // "tower" characters (stand them up early so they fight in more
                // conflicts — Water Ring, ready events/actions), then raw skill.
                const ranked = bowedOwn.slice().sort((a, b) => {
                    const partDiff = (b.inConflict ? 1 : 0) - (a.inConflict ? 1 : 0);
                    if(partDiff !== 0) {
                        return partDiff;
                    }
                    const towerDiff = (this.isTower(b) ? 1 : 0) - (this.isTower(a) ? 1 : 0);
                    if(towerDiff !== 0) {
                        return towerDiff;
                    }
                    const skillDiff = (this.skillValue(b, skillType) || 0) - (this.skillValue(a, skillType) || 0);
                    return skillDiff !== 0 ? skillDiff : String(a.uuid).localeCompare(String(b.uuid));
                });
                return this.cardClickDecision(ranked[0], 'ready-own-bowed');
            }
            if(cancel && targetHint.sourceIsMine) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
            // Forced with nothing of ours bowed: readying an own ready body is a
            // harmless no-op; never hand the ready to the opponent.
            if(mine.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(mine, skillType)[0], 'ready-own-noop');
            }
            const enemyReady = this.sortBySkillDesc(theirs, skillType);
            return enemyReady.length > 0 ? this.cardClickDecision(enemyReady[enemyReady.length - 1], 'forced-ready-enemy-weakest') : null;
        }
        if(actionNames.includes('bow') && !actionNames.includes('ready')) {
            const readyEnemy = this.sortBySkillDesc(theirs.filter((card) => !card.bowed), skillType);
            if(readyEnemy.length > 0) {
                return this.cardClickDecision(readyEnemy[0], 'bow-enemy-ready');
            }
            // No un-bowed enemy: fall through to the generic harmful path, which
            // cancels our own optional ability rather than bow our own body.
        }

        if(sourceHint && (sourceHint.targetSide === 'self' || sourceHint.targetSide === 'enemy')) {
            // Buffs on own bowed characters do nothing in the current
            // conflict — aim at ready ones whenever any exist.
            const preferred = sourceHint.targetSide === 'self' ? this.preferReady(mine) : theirs;
            if(preferred.length > 0) {
                const sorted = this.sortByPreference(preferred, skillType, sourceHint.targetPreference);
                return this.cardClickDecision(sorted[0], `hinted-target-${sourceHint.targetSide}`);
            }
            // No legal target on the intended side (e.g. Assassination with
            // only own cheap characters in the conflict): cancel the ability
            // rather than hit the wrong side; when forced, lose the least.
            if(cancel) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
            const other = sourceHint.targetSide === 'self' ? theirs : mine;
            if(other.length > 0) {
                const sorted = this.sortBySkillDesc(other, skillType);
                return this.cardClickDecision(sorted[sorted.length - 1], `forced-target-${sourceHint.targetSide === 'self' ? 'enemy' : 'own'}-weakest`);
            }
            return null;
        }

        let polarity = this.classifyActions(targetHint.gameActions || []);
        // A 'guessed-' reason prefix marks picks derived from assumptions
        // rather than a classified action or card hint — the controller may
        // hand those to the live LLM consult.
        let guessed = false;
        if(!polarity) {
            if(!targetHint.sourceIsMine) {
                return null;
            }
            // Unclassified effect from the bot's own card (lasting-effect
            // skill modifiers carry no classifiable action name). Side
            // restrictions decide first: opponent-only targets mean a debuff,
            // own-only targets mean a buff. When either side is legal, the
            // source decides: province and stronghold text punishes the
            // attacker far more often than it buffs, hand/character effects
            // are usually pumps.
            guessed = true;
            if(mine.length === 0 && theirs.length > 0) {
                polarity = 'harmful';
            } else if(theirs.length === 0) {
                polarity = 'helpful';
            } else {
                polarity = targetHint.sourceType === 'province' || targetHint.sourceType === 'stronghold' ? 'harmful' : 'helpful';
            }
        }

        const prefix = guessed ? 'guessed-' : '';
        if(polarity === 'harmful') {
            if(theirs.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(theirs, skillType)[0], `${prefix}harm-opponent-card`);
            }
            if(cancel && targetHint.sourceIsMine) {
                return this.buttonDecision(cancel, 'cancel-wrong-side-target');
            }
            const ownSorted = this.sortBySkillDesc(mine, skillType);
            return this.cardClickDecision(ownSorted[ownSorted.length - 1], `${prefix}harm-own-weakest`);
        }

        if(mine.length > 0) {
            // Ready characters first (a buff on a bowed character adds no
            // skill), conflict participants first within that.
            const ready = this.preferReady(mine);
            const inConflict = ready.filter((card) => card.inConflict);
            const pool = inConflict.length > 0 ? inConflict : ready;
            return this.cardClickDecision(this.sortBySkillDesc(pool, skillType)[0], `${prefix}help-own-card`);
        }
        if(cancel && targetHint.sourceIsMine) {
            return this.buttonDecision(cancel, 'cancel-wrong-side-target');
        }
        const theirsSorted = this.sortBySkillDesc(theirs, skillType);
        return this.cardClickDecision(theirsSorted[theirsSorted.length - 1], `${prefix}help-opponent-weakest`);
    }

    // Ring effect resolutions target through cardCondition only (no game
    // action reaches the target hint), so aim them by prompt text: void
    // strips fate from the opponent's fattest character (never its own —
    // skipping is better), fire honors own / dishonors enemy, water bows the
    // opponent's strongest ready character or readies an own bowed one when
    // more conflicts remain, air weighs gaining 2 honor against taking 1.
    private ringResolutionDecision(playerState: any, me: any, promptTitle: string, menuTitle: string, buttons: any[], dishonor: DishonorTactics | null = null): BotDecision | null {
        const dontResolve = this.findButton(buttons, ['don\'t resolve']);
        const isWaterTargetPrompt = menuTitle === 'Choose character to bow or unbow' ||
            (/water ring/i.test(promptTitle) && /choose (a )?character/i.test(menuTitle));
        const isRingTargetPrompt = ['Choose character to remove fate from', 'Choose character to honor or dishonor'].includes(menuTitle) ||
            isWaterTargetPrompt;

        if(isRingTargetPrompt) {
            const myUuids = new Set(this.findVisibleCards(me).map((card) => card.uuid));
            const selectable = this.findVisibleCards(playerState).filter((card) =>
                card.selectable && card.uuid && !this.isAttempted('cardClicked', [card.uuid]));
            const mine = selectable.filter((card) => this.cardBelongsToPlayer(card, me, myUuids));
            const theirs = selectable.filter((card) => !this.cardBelongsToPlayer(card, me, myUuids));
            const byFateDesc = (cards: any[]) => cards.slice().sort((a, b) =>
                (Number(b.fate) || 0) - (Number(a.fate) || 0) || String(a.uuid).localeCompare(String(b.uuid)));

            if(menuTitle === 'Choose character to remove fate from') {
                if(theirs.length > 0) {
                    return this.cardClickDecision(byFateDesc(theirs)[0], 'void-ring-enemy-fate');
                }
                if(dontResolve) {
                    // Stripping fate from our own character is worse than
                    // not resolving the ring at all.
                    return this.buttonDecision(dontResolve, 'void-ring-skip');
                }
                if(mine.length > 0) {
                    return this.cardClickDecision(byFateDesc(mine).reverse()[0], 'void-ring-forced-own');
                }
                return null;
            }

            if(menuTitle === 'Choose character to honor or dishonor') {
                const ownTargets = this.sortByStatusImpact(mine.filter((card) => !card.isHonored), 'military');
                const ownPool = ownTargets.filter((card) => card.inConflict).concat(ownTargets.filter((card) => !card.inConflict));
                const enemyTargets = this.sortByStatusImpact(theirs.filter((card) => !card.isDishonored), 'military');
                // Dishonor decks flip the order: a dishonored enemy fights
                // worse and bleeds its controller 1 honor when it dies.
                if(dishonor?.preferDishonorEnemy() && enemyTargets.length > 0) {
                    return this.cardClickDecision(enemyTargets[0], 'fire-ring-dishonor-enemy');
                }
                if(ownPool.length > 0) {
                    return this.cardClickDecision(ownPool[0], 'fire-ring-honor-own');
                }
                if(enemyTargets.length > 0) {
                    return this.cardClickDecision(enemyTargets[0], 'fire-ring-dishonor-enemy');
                }
                return dontResolve ? this.buttonDecision(dontResolve, 'fire-ring-skip') : null;
            }

            // Water is binary tempo: ready a bowed friendly or bow a ready
            // enemy. Pick largest combined military + political skill swing.
            const useful = mine.filter((card) => card.bowed)
                .map((card) => ({ card, reason: 'water-ring-ready-own' }))
                .concat(theirs.filter((card) => !card.bowed)
                    .map((card) => ({ card, reason: 'water-ring-bow-enemy' })))
                .sort((a, b) => this.combinedSkillValue(b.card) - this.combinedSkillValue(a.card) ||
                    String(a.card.uuid).localeCompare(String(b.card.uuid)));
            if(useful.length > 0) {
                return this.cardClickDecision(useful[0].card, useful[0].reason);
            }
            if(dontResolve) {
                return this.buttonDecision(dontResolve, 'water-ring-skip');
            }
            return null;
        }

        // Fire ring second step: 'Honor <name>' / 'Dishonor <name>' menu for
        // the chosen character.
        const honorButtons = buttons.filter((button) => String(button.text || '').startsWith('Honor '));
        const dishonorButtons = buttons.filter((button) => String(button.text || '').startsWith('Dishonor '));
        if(honorButtons.length > 0 || dishonorButtons.length > 0) {
            const myNames = new Set(this.myCharactersInPlay(me).map((card) => card.name));
            const honorOwn = honorButtons.find((button) => myNames.has(String(button.text).slice('Honor '.length)));
            const dishonorEnemy = dishonorButtons.find((button) => !myNames.has(String(button.text).slice('Dishonor '.length)));
            if(dishonor?.preferDishonorEnemy() && dishonorEnemy) {
                return this.buttonDecision(dishonorEnemy, 'fire-ring-dishonor');
            }
            if(honorOwn) {
                return this.buttonDecision(honorOwn, 'fire-ring-honor');
            }
            if(dishonorEnemy) {
                return this.buttonDecision(dishonorEnemy, 'fire-ring-dishonor');
            }
            return this.buttonDecision(honorButtons[0] || dishonorButtons[0], 'fire-ring-choice');
        }

        // Air ring menu: taking 1 pushes the opponent toward the dishonor
        // defeat or away from the honor victory; otherwise 2 for us is more.
        const gainTwo = buttons.find((button) => String(button.text) === 'Gain 2 Honor');
        const takeOne = buttons.find((button) => String(button.text) === 'Take 1 Honor from opponent');
        if(gainTwo || takeOne) {
            const opponent = this.opponentPlayer(playerState, me);
            const opponentHonor = opponent?.stats?.honor ?? 10;
            // Dishonor decks: taking 1 IS the win condition (and gaining 2
            // climbs out of the low-honor band) — take unless our own honor
            // needs the rescue.
            const preferTake = dishonor
                ? dishonor.preferTakeHonor(me?.stats?.honor ?? 10)
                : opponentHonor <= 4 || opponentHonor >= 16;
            return this.buttonDecision((preferTake ? takeOne : gainTwo) || takeOne || gainTwo, 'air-ring-honor');
        }

        return null;
    }

    // Attachments are long-term investments: prefer own characters that stick
    // around (fate on them survives fate phases) and that fight in the current
    // conflict type. When losing a conflict, attach to a participant so the
    // skill swings the resolution.
    private attachmentTargetDecision(mine: any[], theirs: any[], playerState: any, me: any, skillType: string, sourceCardId?: string, maxCopiesPerTarget?: number): BotDecision | null {
        if(sourceCardId && maxCopiesPerTarget) {
            const hadOwnTarget = mine.length > 0;
            mine = mine.filter((card) => this.attachmentCopyCount(card, sourceCardId) < maxCopiesPerTarget);
            if(hadOwnTarget && mine.length === 0) {
                return null;
            }
        }
        if(mine.length === 0) {
            if(theirs.length === 0) {
                return null;
            }
            // Only opponent cards are legal: a control attachment, so degrade
            // their strongest character.
            return this.cardClickDecision(this.sortBySkillDesc(theirs, skillType)[0], 'attach-to-opponent');
        }

        // Some big bodies are the wrong home for an attachment even though their
        // fate/skill top the score: Kaiu Siege Force (cost 6, 2 fate → same
        // tower score as Hida Kisada) returns holdings to ready and is not a
        // durable attachment carrier — steer weapons/covert onto the real tower
        // instead. Only filter it out while a better own body remains.
        const ATTACH_AVOID = new Set(['kaiu-siege-force']);
        if(mine.some((card) => !ATTACH_AVOID.has(card.id))) {
            mine = mine.filter((card) => !ATTACH_AVOID.has(card.id));
        }

        const restricted = !!sourceCardId && RESTRICTED_ATTACHMENT_IDS.has(sourceCardId);
        if(restricted) {
            const underCap = mine.filter((card) => this.restrictedAttachmentCount(card) < 2);
            if(underCap.length > 0) {
                mine = underCap;
            }
        }

        const conflictType = playerState?.conflict?.type || skillType;
        let pool = mine;
        const standing = this.conflictStanding(playerState, me);
        if(standing && standing.losing) {
            // Bowed participants contribute no skill, so a pump on them is
            // wasted — only ready participants swing the conflict.
            const participants = mine.filter((card) => card.inConflict && !card.bowed);
            if(participants.length > 0) {
                pool = participants;
            }
        } else if(!restricted) {
            // Not fighting for a conflict we could lose right now: an
            // attachment is (almost always) permanent, so invest it in a
            // multi-fate "tower" character that will keep fighting for several
            // rounds — power it up BEFORE it commits. Bowed towers still
            // qualify (the attachment persists to the next conflict); the
            // losing branch above already forces ready participants when the
            // current fight actually needs the skill.
            const towers = mine.filter((card) => this.isTower(card));
            if(towers.length > 0) {
                pool = towers;
            }
        }

        const scored = pool.slice().sort((a, b) => {
            if(restricted) {
                const countDiff = this.restrictedAttachmentCount(a) - this.restrictedAttachmentCount(b);
                if(countDiff !== 0) {
                    return countDiff;
                }
            }
            const scoreDiff = this.attachmentScore(b, conflictType) - this.attachmentScore(a, conflictType);
            return scoreDiff !== 0 ? scoreDiff : String(a.uuid).localeCompare(String(b.uuid));
        });
        return this.cardClickDecision(scored[0], 'attach-to-own');
    }

    private attachmentScore(card: any, conflictType: string): number {
        // A bowed character adds no skill to the current conflict; anything
        // unbowed is a better home for an attachment.
        const bowedPenalty = card.bowed ? 100 : 0;
        return (Number(card.fate) || 0) * 3 + (this.skillValue(card, conflictType) || 0) + (card.inConflict ? 2 : 0) - bowedPenalty;
    }

    private restrictedAttachmentCount(card: any): number {
        return (card?.attachments || []).filter((attachment: any) =>
            attachment?.id && RESTRICTED_ATTACHMENT_IDS.has(attachment.id)).length;
    }

    private attachmentCopyCount(card: any, cardId: string): number {
        return (card?.attachments || []).filter((attachment: any) => attachment?.id === cardId).length;
    }

    private attachmentTargetsWithoutDuplicate(cards: any[], sourceCardId?: string): any[] {
        if(!sourceCardId || !NON_STACKING_DEBUFF_ATTACHMENT_IDS.has(sourceCardId)) {
            return cards;
        }
        return cards.filter((card) => !(card?.attachments || [])
            .some((attachment: any) => attachment?.id === sourceCardId));
    }

    // Pacifism shuts off military conflicts; Stolen Breath shuts off political.
    // Prefer a specialist on that axis or a character strong on both axes.
    // "Balanced" scales with printed/current strength but stops widening at 3:
    // 4/3 tolerates 1, 10/7 tolerates 3, and 20/16 is still specialized.
    private conflictLockTarget(cards: any[], axis: string): any | null {
        if(cards.length === 0) {
            return null;
        }
        const focused = cards.filter((card) => {
            const military = Math.max(this.skillValue(card, 'military') || 0, 0);
            const political = Math.max(this.skillValue(card, 'political') || 0, 0);
            const stronger = Math.max(military, political);
            const balancedTolerance = Math.min(3, Math.round(stronger * 0.3));
            return Math.abs(military - political) <= balancedTolerance ||
                (axis === 'political' ? political > military : military > political);
        });
        if(focused.length === 0) {
            return null;
        }
        return focused.slice().sort((a, b) => {
            const axisDiff = (this.skillValue(b, axis) || 0) - (this.skillValue(a, axis) || 0);
            if(axisDiff !== 0) {
                return axisDiff;
            }
            const combinedDiff = this.combinedSkillValue(b) - this.combinedSkillValue(a);
            if(combinedDiff !== 0) {
                return combinedDiff;
            }
            const fateDiff = (Number(b.fate) || 0) - (Number(a.fate) || 0);
            return fateDiff !== 0 ? fateDiff : String(a.uuid).localeCompare(String(b.uuid));
        })[0];
    }

    private sortByStatusImpact(cards: any[], skillType: string): any[] {
        return cards.slice().sort((a, b) => {
            const towerDiff = (this.isTower(b) ? 1 : 0) - (this.isTower(a) ? 1 : 0);
            if(towerDiff !== 0) {
                return towerDiff;
            }
            const gloryDiff = this.gloryValue(b) - this.gloryValue(a);
            if(gloryDiff !== 0) {
                return gloryDiff;
            }
            const readyDiff = (b.bowed ? 0 : 1) - (a.bowed ? 0 : 1);
            if(readyDiff !== 0) {
                return readyDiff;
            }
            const conflictDiff = (b.inConflict ? 1 : 0) - (a.inConflict ? 1 : 0);
            if(conflictDiff !== 0) {
                return conflictDiff;
            }
            const skillDiff = (this.skillValue(b, skillType) || 0) - (this.skillValue(a, skillType) || 0);
            return skillDiff !== 0 ? skillDiff : String(a.uuid).localeCompare(String(b.uuid));
        });
    }

    private gloryValue(card: any): number {
        const value = Number(card?.glorySummary?.stat);
        return Number.isFinite(value) ? value : 0;
    }

    private preferReady(cards: any[]): any[] {
        const ready = cards.filter((card) => !card.bowed);
        return ready.length > 0 ? ready : cards;
    }

    // A "tower" character: strong, expensive, deliberately loaded with MORE
    // than one fate at deploy so it survives several rounds. Player-state card
    // summaries carry no cost/traits, but the fate tokens on the card are a
    // faithful proxy — you only stack multiple fate on a body you mean to keep.
    // Permanent attachments and ready effects should build these units up
    // BEFORE they commit, so they enter more conflicts already strong.
    private isTower(card: any): boolean {
        return (Number(card?.fate) || 0) >= 2;
    }

    private sortByPreference(cards: any[], skillType: string, preference: string): any[] {
        if(preference === 'most-fate') {
            return cards.slice().sort((a, b) => {
                const fateDiff = (Number(b.fate) || 0) - (Number(a.fate) || 0);
                return fateDiff !== 0 ? fateDiff : String(a.uuid).localeCompare(String(b.uuid));
            });
        }
        const sorted = this.sortBySkillDesc(cards, skillType);
        return preference === 'weakest' ? sorted.reverse() : sorted;
    }

    private classifyActions(names: string[]): 'harmful' | 'helpful' | null {
        if(names.some((name) => HARMFUL_ACTIONS.has(name))) {
            return 'harmful';
        }
        if(names.some((name) => HELPFUL_ACTIONS.has(name))) {
            return 'helpful';
        }
        return null;
    }

    private facedownSelectableDecision(playerState: any, me: any): BotDecision | null {
        const players = playerState?.players || {};
        for(const name of Object.keys(players)) {
            const player = players[name];
            if(player === me) {
                continue;
            }
            const lists = PROVINCE_KEYS
                .map((key) => player?.provinces?.[key] || [])
                .concat([player?.strongholdProvince || []]);
            for(const list of lists) {
                const province = (list || []).find((card: any) => card.selectable && !card.uuid && card.location);
                if(province) {
                    const args = [province.location, name, true];
                    if(!this.isAttempted('facedownCardClicked', args)) {
                        return {
                            command: 'facedownCardClicked',
                            args,
                            target: province.location,
                            reason: 'choose-facedown-province'
                        };
                    }
                }
            }
        }
        return null;
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
}

export = JigokuBotPolicy;
