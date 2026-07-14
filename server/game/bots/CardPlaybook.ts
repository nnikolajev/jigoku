import type { CardHint } from './llm/CardHints';
import { getCardModel } from './DeckAnalysis.js';

/**
 * Hand-written per-card knowledge for the bot, keyed by printed card id.
 *
 * Entries share the CardHint shape (the policy consumes both through the same
 * lookup), so a playbook entry simply outranks whatever the LLM analysis
 * cached for the same card. On top of the hint fields it can carry:
 *
 * - `shouldPlay(ctx)`  — extra gate for playing the card from hand during a
 *   conflict action window (e.g. Assassination only with honor to spare).
 * - `inPlayAction`     — the card has an Action ability worth clicking while
 *   it is on the board (holdings, attachments, characters). The policy
 *   clicks these during conflict windows after stronghold/province powers.
 * - `shouldUseAction(ctx)` — gate for that in-play click; illegal clicks are
 *   rejected by the engine without mutation, so gates only exist to avoid
 *   wasted clicks, not for legality.
 * - `dynastyAction`     — the card has an Action worth clicking during the
 *   dynasty action window (stronghold/holding/engineer digging). Only fired
 *   for decks whose derived strategy has `holdingEngine`.
 *
 * Curated for the decks the bot pilots (Unicorn cavalry precon, Crab Kaiu
 * Wall defense precon); grows per-deck as new decks get adopted.
 */

export interface PlaybookContext {
    conflictType: 'military' | 'political';
    losing: boolean;
    amAttacker: boolean;
    honor: number;
    myCharacters: any[];
    opponentCharacters: any[];
    dynastyDiscard: any[];
    // Optional extras (older callers omit them; gates must tolerate undefined).
    fate?: number;
    canPayHonor?: boolean; // dishonor decks: own honor is above the profile floor
    conflictDiscard?: any[]; // own conflict discard pile (weapon recursion gates)
    hand?: any[]; // own conflict hand (spell-recursion and setup gates)
    rings?: any[]; // live rings (ring-manipulation action gates)
    opponentHandSize?: number; // public hidden-card count for Tadaka's discard gate
    cardsPlayed?: number; // cards played this conflict (Dragon count-payoff gates)
    opponentCardsPlayed?: number; // Ichi counts cards played by both players
    moreCardsPlayable?: boolean; // a playable hand card remains (diagnostics/compatibility)
    conflictsRemaining?: number; // own future conflicts after the current one
    strongholdConflict?: boolean; // do not retreat from the game-ending defense
    preferFavorableRetreat?: boolean; // Dragon preserves its tower for another conflict
}

export interface PlaybookEntry extends CardHint {
    inPlayAction?: boolean;
    // Fire this board Action in a conflict-PHASE action window even when no
    // conflict is active (Adept grants Water-conflict Covert for the phase;
    // Meddling Mediator collects after the opponent declares two conflicts).
    conflictPhaseAction?: boolean;
    dynastyAction?: boolean;
    // Fire this in-play/dynasty action at most once per round — for unlimited
    // actions that reverse their own effect and would otherwise loop.
    oncePerRound?: boolean;
    // The card cannot (or should not) be played during a conflict — play it
    // from hand in a conflict-phase action window instead (Pacifism's
    // "Peaceful", Stolen Breath). Only fired for dishonor-profile decks.
    preConflict?: boolean;
    // Declaring this character as attacker/defender costs the controller
    // honor (Marauding Oni's forced reaction). Dishonor decks skip declaring
    // it while their honor sits at the floor.
    declareCostsHonor?: boolean;
    // The card's printed skill contribution is 0 but its granted ability is
    // the point (True Strike Kenjutsu's duel, Sashimono's no-bow) — play it
    // despite a zero stat contribution.
    abilityValue?: boolean;
    // For attachments whose ABILITY targets the enemy (targetSide 'enemy')
    // but which must be attached to an OWN character (True Strike Kenjutsu:
    // attach to our duelist, duel the enemy).
    attachSide?: 'self';
    shouldPlay?: (ctx: PlaybookContext) => boolean;
    shouldUseAction?: (ctx: PlaybookContext) => boolean;
}

// Deck-level strategy flags derived from the printed cards actually in the
// bot's deck. They gate deck-specific behaviors in the policy (mulligan,
// dynasty digging, cautious attacking) so that decks WITHOUT these cards —
// e.g. the aggressive Unicorn precon — keep the exact generic behavior.
export interface DeckStrategy {
    // Wall/holding engine: mulligan provinces toward holdings, dig with the
    // stronghold and holding actions, never discard holdings from provinces.
    holdingEngine: boolean;
    // Defensive: keep bodies home to defend and only commit an attack that can
    // actually break the province.
    defensive: boolean;
    // Aggressive military rush: deploy characters with 0-1 fate, commit every
    // body to the attack, force conflicts to military, and concede defenses to
    // keep bodies ready for the next attack. The whole plan is to break
    // provinces faster than the opponent, racing the game to 2-3 turns.
    aggressive: boolean;
    // Dishonor/mill: win by driving the opponent to 0 honor — bid low on every
    // dial, take honor with the air ring, dishonor enemy characters, mill the
    // opponent's conflict deck, and keep own honor in the low-but-alive band.
    dishonor: boolean;
    // Glory/honor engine: build a persistent honored board (honored adds
    // glory to both skills), hold the Imperial Favor through glory counts,
    // and choose the contested ring from the cards in play.
    glory: boolean;
    // Monk/card-engine (Dragon): play many cheap cards per conflict to turn
    // on the cards-played payoffs around Togashi Mitsu.
    monk: boolean;
    // Duel-centric (upgraded Crane Duels): few durable honored duelists,
    // every duel bid to win, payoffs on every resolved duel.
    duelist: boolean;
    // Phoenix spell/ring control: Kyuden Isawa recursion, Display of Power
    // province trades, ring manipulation, and Disguised Isawa Tadaka.
    shugenja: boolean;
    // Dragon attachment tower: Iron Mountain Castle, three Restricted slots,
    // deep-fate towers, attachment search, and Niten/Yokuni ready loops.
    attachmentTower: boolean;
}

const entry = (cardId: string, overrides: Partial<PlaybookEntry>): PlaybookEntry => Object.assign({
    cardId,
    useWhen: 'always' as const,
    conflictTypes: [],
    targetSide: 'none' as const,
    targetPreference: 'any' as const,
    priority: 5,
    summary: ''
}, overrides);

const participating = (cards: any[]) => cards.filter((card) => card.inConflict);
const readyParticipants = (cards: any[]) => cards.filter((card) => card.inConflict && !card.bowed);
const fiveFiresTarget = (card: any) => (Number(card.fate) || 0) > 0 &&
    !(card.attachments || []).some((attachment: any) =>
        attachment.id === 'pacifism' || attachment.id === 'stolen-breath');

const PLAYBOOK: Record<string, PlaybookEntry> = {
    // +2 military to a participating character, optionally twice for 1 honor.
    'banzai': entry('banzai', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: '+2 military pump on a participating character'
    }),

    // +2 military to a participating Bushi; honors it if the conflict is won.
    'a-perfect-cut': entry('a-perfect-cut', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: '+2 military on a Bushi, honors it on a win'
    }),

    // Lose 3 honor, discard an enemy character of printed cost 2 or lower.
    // The engine offers only legal targets; if just our own cheap characters
    // qualify, the targeting stage cancels (targetSide enemy).
    // Only legal against a cost-2-or-less participant. Playing it blind put
    // the bot in a cancel loop (click -> only own characters legal -> cancel
    // -> click again, 200+ times per match, eating every conflict window), so
    // gate on a KNOWN cheap enemy participant via the DeckAnalysis card
    // models. An unmodeled opponent card keeps Assassination in hand — better
    // than the loop.
    'assassination': entry('assassination', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'discard an enemy cost-2-or-less character for 3 honor',
        shouldPlay: (ctx) => ctx.honor >= 6 && ctx.opponentCharacters.some((card) => {
            const model = card.inConflict && card.id ? getCardModel(card.id) : undefined;
            return !!model && model.fate <= 2;
        })
    }),

    // Put up to 6 printed cost of Cavalry characters from the dynasty discard
    // into the conflict — a huge military swing when the discard is stocked.
    'cavalry-reserves': entry('cavalry-reserves', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'puts discarded Cavalry characters into the conflict',
        shouldPlay: (ctx) => ctx.dynastyDiscard.filter((card) => card.type === 'character').length >= 2
    }),

    // Remove 1 fate from a friendly Unicorn character to ready it. Worth it
    // for a bowed conflict participant whose skill comes back online, AND to
    // stand a bowed "tower" character back up at home so it can be committed
    // or declared into the next conflict — but only one carrying SPARE fate
    // (>1) at home, so readying it does not strip its last fate and doom it.
    // In-conflict readies keep the original fate>0 threshold.
    'i-am-ready': entry('i-am-ready', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'ready a friendly character by removing 1 of its fate',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) =>
            card.bowed && (Number(card.fate) || 0) > (card.inConflict ? 0 : 1))
    }),

    // +1 military to every non-unique character we control: needs bodies.
    'ujik-tactics': entry('ujik-tactics', {
        conflictTypes: ['military'],
        priority: 6,
        summary: '+1 military to each non-unique character',
        shouldPlay: (ctx) => readyParticipants(ctx.myCharacters).length >= 2
    }),

    // Attachment: +X military where X = unclaimed rings (early conflicts big).
    'born-in-war': entry('born-in-war', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 6,
        summary: '+X military attachment, X = unclaimed rings'
    }),

    // Attachment with an in-play Action: re-attach to another Cavalry
    // character — rescue it from a bowed or stay-at-home bearer.
    'shinjo-saddle': entry('shinjo-saddle', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 5,
        summary: 'attachment that can move itself to another Cavalry character',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const bearer = ctx.myCharacters.find((card) =>
                (card.attachments || []).some((attachment: any) => attachment.id === 'shinjo-saddle'));
            if(!bearer || (!bearer.bowed && bearer.inConflict)) {
                return false;
            }
            return ctx.myCharacters.some((card) => card !== bearer && card.inConflict && !card.bowed);
        }
    }),

    // Holding: ready a Cavalry character while we have a claimed military
    // ring. Legality (the claimed ring) is checked by the engine.
    'shiotome-encampment': entry('shiotome-encampment', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'holding: ready a Cavalry character',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) => card.bowed)
    }),

    // Holding reaction: +2 military after a character moves to a conflict.
    'moto-stables': entry('moto-stables', {
        priority: 8,
        summary: 'holding reaction: +2 military after a move to the conflict'
    }),

    // Character Action while participating: +1/+1 to every participating
    // Cavalry when we outnumber the opponent in the conflict.
    'shinjo-shono': entry('shinjo-shono', {
        priority: 7,
        summary: 'pumps all participating Cavalry when outnumbering',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const shono = ctx.myCharacters.find((card) => card.id === 'shinjo-shono');
            return !!shono && shono.inConflict &&
                participating(ctx.myCharacters).length > participating(ctx.opponentCharacters).length;
        }
    }),

    // Character Action during a military conflict she fights in: fetch a
    // cost-3-or-lower character from the dynasty deck into the conflict.
    'shinjo-altansarnai-2': entry('shinjo-altansarnai-2', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'fetches a cheap character into her military conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            if(ctx.conflictType !== 'military') {
                return false;
            }
            const altansarnai = ctx.myCharacters.find((card) => card.id === 'shinjo-altansarnai-2');
            return !!altansarnai && altansarnai.inConflict;
        }
    }),

    // Reaction after being played from a province: dig the top 5 dynasty
    // cards for a cheap character to put into play. Always worth it.
    'shinjo-gunso': entry('shinjo-gunso', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'on-play: put a cheap character from the dynasty deck into play'
    }),

    // Reaction: honor the attached character after it wins a military
    // conflict. Free honor.
    'utaku-battle-steed': entry('utaku-battle-steed', {
        targetSide: 'self',
        priority: 7,
        summary: 'honors its bearer after a military win'
    }),

    // Reaction: honored after we play a Gaijin card. Free honor.
    'worldly-shiotome': entry('worldly-shiotome', {
        priority: 7,
        summary: 'honors herself after a Gaijin card is played'
    }),

    // Covert-evade reaction: the evaded character cannot defend this phase.
    'shinjo-yasamura': entry('shinjo-yasamura', {
        priority: 7,
        summary: 'locks the coverted character out of defending this phase'
    }),

    // Character Action: ready itself — free skill recovery for a bowed
    // participant.
    'border-rider': entry('border-rider', {
        priority: 7,
        summary: 'readies itself',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) => card.id === 'border-rider' && card.bowed && card.inConflict)
    }),

    // Character Action: ready itself while participating in a military
    // conflict.
    'moto-outrider': entry('moto-outrider', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'readies itself during its military conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.conflictType === 'military' &&
            ctx.myCharacters.some((card) => card.id === 'moto-outrider' && card.bowed && card.inConflict)
    }),

    // Character Action while participating: -1/-1 to every opposing
    // participant — scales with their body count.
    'warrior-poet': entry('warrior-poet', {
        priority: 7,
        summary: 'debuffs every opposing participant by 1/1',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const poet = ctx.myCharacters.find((card) => card.id === 'warrior-poet');
            if(!poet || !poet.inConflict) {
                return false;
            }
            const enemies = participating(ctx.opponentCharacters).length;
            return enemies >= 2 || (enemies >= 1 && ctx.losing);
        }
    }),

    // Attachment Action during a military conflict the bearer sits out of:
    // bow a participating character (aim at the enemy) and move the bearer
    // into the conflict — a two-way swing.
    'adorned-barcha': entry('adorned-barcha', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'bows an enemy participant and rides the bearer in',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            if(ctx.conflictType !== 'military') {
                return false;
            }
            const bearer = ctx.myCharacters.find((card) =>
                (card.attachments || []).some((attachment: any) => attachment.id === 'adorned-barcha'));
            return !!bearer && !bearer.inConflict && !bearer.bowed &&
                participating(ctx.opponentCharacters).some((card) => !card.bowed);
        }
    }),

    // Reaction after moving to a conflict: ready a character.
    'twilight-rider': entry('twilight-rider', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'on-move reaction: ready a character'
    }),

    // Reaction after winning: a no-fate participant does not bow out.
    'higashi-kaze-company': entry('higashi-kaze-company', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'win reaction: keeps a no-fate participant unbowed'
    }),

    // Reaction after winning while outnumbering: gain 1 fate, draw 1. Free.
    'minami-kaze-regulars': entry('minami-kaze-regulars', {
        priority: 8,
        summary: 'win reaction: gain 1 fate and draw 1 card'
    }),

    // Reaction after a move into its conflict: honor a participant.
    'outskirts-sentry': entry('outskirts-sentry', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'honors a participant after a move-in'
    }),

    // Granted reaction while first player: opponent loses 1 fate on a win.
    'scarlet-sabre': entry('scarlet-sabre', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'win reaction: opponent loses 1 fate'
    }),

    // Seeker role reactions: gain 1 fate after an own province of the role's
    // element is revealed. Free fate, always fire. All five elements get an
    // entry so any deck's role works (Unicorn/Crab/Crane run air, Scorpion
    // runs earth).
    'seeker-of-air': entry('seeker-of-air', {
        priority: 8,
        summary: 'gain 1 fate when an own air province is revealed'
    }),
    'seeker-of-earth': entry('seeker-of-earth', {
        priority: 8,
        summary: 'gain 1 fate when an own earth province is revealed'
    }),
    'seeker-of-fire': entry('seeker-of-fire', {
        priority: 8,
        summary: 'gain 1 fate when an own fire province is revealed'
    }),
    'seeker-of-water': entry('seeker-of-water', {
        priority: 8,
        summary: 'gain 1 fate when an own water province is revealed'
    }),
    'seeker-of-void': entry('seeker-of-void', {
        priority: 8,
        summary: 'gain 1 fate when an own void province is revealed'
    }),

    // Province Conflict Action: strip 1 fate from an attacker — take it from
    // the attacker that would live longest.
    'meditations-on-the-tao': entry('meditations-on-the-tao', {
        targetSide: 'enemy',
        targetPreference: 'most-fate',
        priority: 8,
        summary: 'province: removes 1 fate from an attacker'
    }),

    // Stronghold: bow to move a Cavalry character into a military conflict.
    'golden-plains-outpost': entry('golden-plains-outpost', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'stronghold: moves a Cavalry character into the conflict'
    }),

    // ---- aggressive military-rush conflict cards ----

    // Draw-engine attachment: attach to a durable attacker so its commit/move
    // into conflicts refills the hand (twice per round). +0 military, so it
    // needs abilityValue to pass the zero-contribution filter. Measured
    // slightly NEGATIVE in the Crane mirror (47-33, 59%, pooled N=80 vs the
    // ~65% band) but kept ON by user decision: the draw engine is worth more
    // against a human than against the predictable Crane bot.
    'spyglass': entry('spyglass', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'attach to an attacker; draws a card when it commits/moves in',
        abilityValue: true
    }),

    // Restricted +2 military weapon while attacking — a cheap, permanent pump
    // on the deck's main threat.
    'curved-blade': entry('curved-blade', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: '+2 military attachment while the bearer is attacking'
    }),

    // Win reaction: draw 3 and discard 1 after winning a military attack — the
    // deck's biggest card-advantage swing. Fires through the priority>=6
    // reaction path.
    'spoils-of-war': entry('spoils-of-war', {
        conflictTypes: ['military'],
        priority: 9,
        summary: 'win reaction: draw 3 and discard 1 after a military attack'
    }),

    // Action while outnumbering: the opponent bows one of their participants —
    // strips a defender once we already have the bodies on the table.
    'flank-the-enemy': entry('flank-the-enemy', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'while outnumbering, the opponent bows a participant',
        shouldPlay: (ctx) => participating(ctx.myCharacters).length > participating(ctx.opponentCharacters).length
    }),

    // Convert a political conflict to military (lose 1 honor) so the deck's
    // military board applies — the trick that turns a political conflict into
    // a second military attack.
    'captive-audience': entry('captive-audience', {
        conflictTypes: ['political'],
        priority: 8,
        summary: 'change a political conflict to military for 1 honor',
        shouldPlay: (ctx) => ctx.amAttacker && ctx.conflictType === 'political' && ctx.honor >= 3
    }),

    // Military duel that gives each duelist +1 per other participant its
    // controller has, then moves the loser home — a swarm removes a defender.
    'challenge-on-the-fields': entry('challenge-on-the-fields', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'military duel (+1 per participant), move the loser home',
        shouldPlay: (ctx) => ctx.amAttacker && participating(ctx.myCharacters).length >= 3 &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Tactic: move a Cavalry character to/home during a conflict. The bot uses
    // it to pull a ready home body INTO its attack (adding skill and triggering
    // Moto Stables / Twilight Rider move-in reactions); the mode menu resolves
    // to "move to the conflict" and the target is steered to a home character.
    'ride-on': entry('ride-on', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 5,
        summary: 'move a home Cavalry character into the conflict',
        shouldPlay: (ctx) => ctx.amAttacker &&
            ctx.myCharacters.some((card) => !card.bowed && !card.inConflict)
    }),

    // ==================================================================
    // Crab "Kaiu Wall" defensive holding engine.
    // ==================================================================

    // Economy event: an opponent gives you 1 fate or 1 honor. Cheap value.
    'levy': entry('levy', {
        priority: 3,
        summary: 'gain 1 fate or 1 honor from an opponent'
    }),

    // Rebuild the wall: swap a province card for a holding from the discard.
    'rebuild': entry('rebuild', {
        priority: 6,
        summary: 'put a discarded holding into one of your provinces',
        shouldPlay: (ctx) => ctx.dynastyDiscard.some((card) => card.type === 'holding')
    }),

    // Control attachment onto an attacking character: -1/-1 and it will not
    // ready. Only enemy attackers are legal targets.
    'pit-trap': entry('pit-trap', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: '-1/-1 debuff attachment on the strongest attacker',
        shouldPlay: (ctx) => !ctx.amAttacker && ctx.opponentCharacters.some((card) => card.inConflict)
    }),

    // Attacking with a holding: knock 2 strength off the attacked province —
    // how the wall deck finally breaks through once it turns the corner.
    'siege-warfare': entry('siege-warfare', {
        priority: 7,
        summary: 'weaken the attacked province by 2 while attacking',
        shouldPlay: (ctx) => ctx.amAttacker
    }),

    // Defensive military pump that cannot be reduced.
    'give-no-ground': entry('give-no-ground', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: '+2 military on a defender, unreducible',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // Free extra defender straight out of the attacked province.
    'raise-the-alarm': entry('raise-the-alarm', {
        conflictTypes: ['military'],
        priority: 8,
        summary: 'reveal/put a defender into play from the attacked province',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // Keeps a defender ready for the opponent's later conflicts this phase.
    'the-mountain-does-not-fall': entry('the-mountain-does-not-fall', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'a defender does not bow from conflict resolution',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // Team-wide defensive lock.
    'the-strength-of-the-mountain': entry('the-strength-of-the-mountain', {
        priority: 7,
        summary: 'defenders cannot be bowed/moved and do not bow on resolution',
        shouldPlay: (ctx) => !ctx.amAttacker && readyParticipants(ctx.myCharacters).length >= 1
    }),

    // Follower that bleeds opponent honor whenever they play a card while the
    // bearer participates — huge on a durable defender. The unlimited reaction
    // fires through the priority>=6 hinted-trigger path.
    'watch-commander': entry('watch-commander', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'attach to a defender; opponent loses honor for each card they play'
    }),

    // Covert enabler for the occasional attack.
    'subterranean-guile': entry('subterranean-guile', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 4,
        summary: 'grants covert while you control a wall holding'
    }),

    // Province fortification: +3 military strength on one of your provinces.
    'inventive-buttressing': entry('inventive-buttressing', {
        conflictTypes: ['military'],
        targetSide: 'self',
        priority: 5,
        summary: '+3 military strength on one of your provinces'
    }),

    // ---- win-as-defender reactions (fire via the hinted-trigger path) ----

    'hida-kotoe': entry('hida-kotoe', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'defense win: discard an attachment'
    }),
    'hida-o-ushi': entry('hida-o-ushi', {
        priority: 8,
        summary: 'defense win: declare an extra military conflict this phase'
    }),
    'kuni-ritsuko': entry('kuni-ritsuko', {
        targetSide: 'enemy',
        targetPreference: 'most-fate',
        priority: 7,
        summary: 'defense win: remove 1 fate from an attacker'
    }),
    'staunch-hida': entry('staunch-hida', {
        priority: 8,
        summary: 'defense win: resolve the ring effect as the attacker'
    }),
    'yasuki-oguri': entry('yasuki-oguri', {
        priority: 6,
        summary: 'defending: +1/+1 when the opponent plays an event'
    }),
    'hida-tomonatsu': entry('hida-tomonatsu', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'defense win: sacrifice to bounce a non-unique attacker'
    }),
    'purifier-apprentice': entry('purifier-apprentice', {
        priority: 7,
        summary: 'defense win: opponent loses 1 honor'
    }),

    // On-defend reaction: lock a chosen character out of abilities this
    // conflict — aim at the biggest enemy threat.
    'hiruma-ambusher': entry('hiruma-ambusher', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'on-defend: lock a character out of abilities this conflict'
    }),

    // On-play reaction: recur a holding from the discard into a province.
    'apprentice-engineer': entry('apprentice-engineer', {
        priority: 8,
        summary: 'on-play: put a holding from the discard into a province'
    }),

    // On-play reaction banks holdings under the stronghold; the manual
    // wall-build Action is also a dynasty-phase dig.
    'kaiu-shihobu': entry('kaiu-shihobu', {
        priority: 8,
        summary: 'on-play: bank holdings; Action builds the wall',
        dynastyAction: true
    }),

    'seventh-tower': entry('seventh-tower', {
        priority: 8,
        summary: 'defense win at a wall province: resolve the ring as the attacker'
    }),
    'watchtower-of-valor': entry('watchtower-of-valor', {
        priority: 7,
        summary: 'defense win at a wall province: draw 1'
    }),

    // Event reactions.
    'guardians-of-rokugan': entry('guardians-of-rokugan', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'defense win: put a character from the deck into play'
    }),
    'withstand-the-darkness': entry('withstand-the-darkness', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 7,
        summary: 'protect a targeted Crab character with a fate — bank it on the tower'
    }),
    'fruitful-respite': entry('fruitful-respite', {
        priority: 7,
        summary: 'gain 2 fate when the opponent passes on a conflict'
    }),

    // ---- in-play Actions during conflicts (defending) ----

    // Gain 1 fate while participating with a holding in play — free value.
    'kaiu-shuichi': entry('kaiu-shuichi', {
        priority: 6,
        summary: 'gain 1 fate while participating with a holding in play',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'kaiu-shuichi');
            return !!card && card.inConflict;
        }
    }),

    // Loot (draw 1, discard 1) while defending.
    'hida-sukune': entry('hida-sukune', {
        priority: 6,
        summary: 'defending: draw 1 and discard 1',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'hida-sukune');
            return !ctx.amAttacker && !!card && card.inConflict;
        }
    }),

    // Defending: move a stronger attacker home — sheds attacker skill and can
    // save the province from breaking.
    'yasuki-hikaru': entry('yasuki-hikaru', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'defending: move a stronger attacker home',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'yasuki-hikaru');
            return !ctx.amAttacker && !!card && card.inConflict &&
                participating(ctx.opponentCharacters).length > 0;
        }
    }),

    // Defending and losing: sacrifice to ready and pull another character in.
    'hiruma-signaller': entry('hiruma-signaller', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'defending: sacrifice to ready and move a character into the conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'hiruma-signaller');
            return !ctx.amAttacker && ctx.losing && !!card && card.inConflict;
        }
    }),

    // Defending: fetch a holding into the attacked province — raises its
    // strength mid-conflict to deny the break.
    'frontline-engineer': entry('frontline-engineer', {
        priority: 8,
        summary: 'defending: fetch a holding into the attacked province',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'frontline-engineer');
            return !ctx.amAttacker && !!card && card.inConflict;
        }
    }),

    // Ready itself by ditching a friendly holding — only when bowed out of a
    // defense it still needs to win.
    // Utilization audit 2026-07-10: the old gate (bowed && inConflict &&
    // losing) never fired in 40 traced games — a participant rarely sits
    // bowed mid-conflict while losing. Any bowed-in-conflict state is worth
    // the ready (a bowed participant contributes no skill).
    'kaiu-siege-force': entry('kaiu-siege-force', {
        priority: 5,
        summary: 'ready itself by discarding a friendly holding',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'kaiu-siege-force');
            return !!card && card.bowed && card.inConflict;
        }
    }),

    // Wall holding: strip 2 random cards from the opponent's hand while
    // defending a wall province.
    'river-of-the-last-stand': entry('river-of-the-last-stand', {
        priority: 7,
        summary: 'wall holding: opponent discards 2 random cards',
        inPlayAction: true,
        shouldUseAction: (ctx) => !ctx.amAttacker
    }),

    // ---- dynasty board actions (holding-engine digging) ----

    // Stronghold: bow to look at the top 3 and play a character — the deck's
    // main way to deploy characters past a wall of holdings.
    'kyuden-hida': entry('kyuden-hida', {
        priority: 7,
        summary: 'stronghold: dig the top 3 for a character to play',
        dynastyAction: true
    }),

    // Dig a character into a province that already holds a holding.
    'unyielding-sensei': entry('unyielding-sensei', {
        priority: 6,
        summary: 'dig a character into a province that has a holding',
        dynastyAction: true
    }),

    // Wall tutor: swap in a holding from the top 10 of the dynasty deck.
    'kaiu-forges': entry('kaiu-forges', {
        priority: 6,
        summary: 'wall tutor: swap in a holding from the top 10',
        dynastyAction: true
    }),

    // ==================================================================
    // Scorpion "Poison Mill" dishonor deck (EmeraldDB 5eb874cc).
    // Win condition: opponent at 0 honor. Disrupt, debuff, mill their
    // conflict deck, farm honor off every dial and the air ring.
    // ==================================================================

    // ---- control attachments onto ENEMY characters ----

    // Peaceful: cannot be played during a conflict — the pre-conflict path
    // plays it. Locks the bearer out of military conflicts entirely; aim at
    // their best military body.
    'pacifism': entry('pacifism', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'enemy character cannot join military conflicts',
        preConflict: true,
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) =>
            !(card.attachments || []).some((attachment: any) => attachment.id === 'pacifism'))
    }),

    // Pre-conflict only: the bearer cannot join political conflicts.
    'stolen-breath': entry('stolen-breath', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'enemy character cannot join political conflicts',
        preConflict: true,
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) =>
            !(card.attachments || []).some((attachment: any) => attachment.id === 'stolen-breath'))
    }),

    // Poison: -2/-2 on the strongest enemy — the deck's tutorable answer.
    'fiery-madness': entry('fiery-madness', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: '-2/-2 poison attachment on the strongest enemy',
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => card.inConflict && !card.bowed)
    }),

    // The bearer cannot ready unless its controller mills their own conflict
    // deck 3 — either outcome (a stuck body or self-mill) feeds the plan.
    // 0/0 stats: abilityValue lets it past the zero-contribution filter.
    // Only bites a BOWED body (it blocks readying), so hold it until the
    // opponent has a bowed character to lock down; the target steering in
    // JigokuBotPolicy then pins the strongest bowed enemy.
    'softskin': entry('softskin', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'enemy character cannot ready without milling 3',
        abilityValue: true,
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => card.bowed &&
            !(card.attachments || []).some((attachment: any) => attachment.id === 'softskin'))
    }),

    // Sticky -1/-1 that re-homes itself when the bearer leaves play.
    'tainted-koku': entry('tainted-koku', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'sticky debuff that moves to another enemy when the bearer dies'
    }),

    // Taxes the bearer's abilities: 1 honor to us per trigger. Best on an
    // ability-heavy character, but any strong body is fine. 0/0 stats:
    // abilityValue lets it past the zero-contribution filter.
    'compromised-secrets': entry('compromised-secrets', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'enemy pays us 1 honor to use the bearer\'s abilities',
        abilityValue: true
    }),

    // ---- conflict events ----

    // -X/-X where X = |our dial - their dial|; our low bids vs a value bidder
    // make X large most rounds. Needs both sides participating and dials shown.
    'make-an-opening': entry('make-an-opening', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: '-X/-X on an enemy participant, X = honor dial difference',
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => card.inConflict && !card.bowed)
    }),

    // -4 political on a participant during a political conflict.
    'compelling-testimony': entry('compelling-testimony', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: '-4 political on an enemy participant',
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) => card.inConflict && !card.bowed)
    }),

    // Opponent's choice: +2/+2 on our participant or they give us 1 honor.
    // Both outcomes serve the plan; costs 0.
    'deceptive-offer': entry('deceptive-offer', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'opponent picks: +2/+2 for us or gives us 1 honor',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => card.inConflict && !card.bowed)
    }),

    // Each player draws 2 then discards 2: cycles our hand and burns 2 of the
    // opponent's conflict deck — cheap mill.
    'oracle-of-stone': entry('oracle-of-stone', {
        priority: 4,
        summary: 'both players draw 2 discard 2 (mills their conflict deck)'
    }),

    // Bow an enemy character after it triggers an ability — fires through the
    // hinted reaction path whenever the window is offered.
    'kirei-ko': entry('kirei-ko', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'bow an enemy character after it uses an ability'
    }),

    // Cancel an enemy event while less honorable — the deck is nearly always
    // less honorable, and canceling their trick mid-conflict is a swing.
    'forgery': entry('forgery', {
        priority: 7,
        summary: 'cancel an enemy event while less honorable'
    }),

    // Cancel the effect that would take our LAST honor, then gain 1. The
    // safety net that lets the deck live at low honor. Always fire.
    'duty': entry('duty', {
        priority: 10,
        summary: 'cancel losing our last honor, gain 1 back'
    }),

    // ---- characters with honor-drain / mill triggers ----

    // 4-military body whose forced reaction bleeds 1 of OUR honor every time
    // it is declared. Fine while honor is a resource, banned at the floor.
    'marauding-oni': entry('marauding-oni', {
        conflictTypes: ['military'],
        priority: 5,
        summary: 'big body; declaring it costs us 1 honor',
        declareCostsHonor: true
    }),


    // Political win: take 1 honor from the opponent.
    'blackmail-artist': entry('blackmail-artist', {
        conflictTypes: ['political'],
        priority: 8,
        summary: 'political win: take 1 honor from the opponent'
    }),

    // Military win: peek at the top 2 of their conflict deck, discard 1.
    'midnight-prowler': entry('midnight-prowler', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'military win: mill 1 from the top 2 of their conflict deck'
    }),

    // Interrupt on leaving play while less honorable: gain 2 honor.
    'beautiful-entertainer': entry('beautiful-entertainer', {
        priority: 7,
        summary: 'gain 2 honor when she leaves play while less honorable'
    }),

    // Action (no cost, once per round): a player discards 3 and draws 3 —
    // aimed at the opponent it burns 3 conflict cards and scrambles their hand.
    'master-whisperer': entry('master-whisperer', {
        priority: 7,
        summary: 'opponent discards 3 and draws 3 (burns their conflict deck)',
        inPlayAction: true
    }),

    // Action while participating, pay 1 honor: opponent discards a random card.
    'thunder-guard-elite': entry('thunder-guard-elite', {
        priority: 7,
        summary: 'pay 1 honor: opponent discards a random card',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.canPayHonor !== false &&
            ctx.myCharacters.some((card) => card.id === 'thunder-guard-elite' && card.inConflict)
    }),

    // Action, pay 1 honor: tutor a Poison card (Fiery Madness) from the
    // conflict deck. Also nudges our honor down toward the band.
    'shosuro-hametsu': entry('shosuro-hametsu', {
        priority: 5,
        summary: 'pay 1 honor: fetch a Poison card from the conflict deck',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.canPayHonor !== false && (ctx.fate ?? 0) >= 1 &&
            ctx.myCharacters.some((card) => card.id === 'shosuro-hametsu')
    }),

    // Action during a conflict, lose 1 honor: move into the conflict — extra
    // skill when it matters, and honor down toward the band.
    'moto-eviscerator': entry('moto-eviscerator', {
        conflictTypes: ['military'],
        priority: 6,
        summary: 'lose 1 honor: move into the conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.canPayHonor !== false && ctx.losing &&
            ctx.myCharacters.some((card) => card.id === 'moto-eviscerator' && !card.inConflict && !card.bowed)
    }),

    // Military duel that dishonors the loser. Our low duel bid usually loses
    // the duel — but a dishonored own character bleeds only when it dies,
    // while a WON duel dishonors theirs. Fire while clearly participating
    // with a strong duelist and honor to trade.
    'insolent-rival': entry('insolent-rival', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 5,
        summary: 'military duel: dishonor the loser',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.canPayHonor !== false &&
            ctx.myCharacters.some((card) => card.id === 'insolent-rival' && card.inConflict && !card.bowed) &&
            ctx.opponentCharacters.some((card) => card.inConflict)
    }),

    // ---- holdings ----

    // Unlimited reaction: every conflict WE win mills the top of their
    // conflict deck.
    'licensed-quarter': entry('licensed-quarter', {
        priority: 8,
        summary: 'every conflict we win mills their conflict deck'
    }),

    // ==================================================================
    // Lion "Bushi swarm" precon (EmeraldDB e3feb31b).
    // Flood cheap Bushi, attack every window, profit from every won
    // conflict (draws, fate, readies), force conflicts to military.
    // ==================================================================

    // ---- conflict events ----

    // Double a Lion character's base military — the deck's biggest single
    // swing; aim it at the strongest participant.
    'way-of-the-lion': entry('way-of-the-lion', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'double a Lion character\'s base military'
    }),

    // +3 military to a character ALONE on our side; can resolve twice for a
    // fate off the target. Only correct when exactly one body fights.
    'a-legion-of-one': entry('a-legion-of-one', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: '+3 (or +6) military on a character fighting alone',
        shouldPlay: (ctx) => participating(ctx.myCharacters).length === 1
    }),

    // Move a defender home while attacking — sheds defense skill; X (max
    // glory) scales with our swarm, so the engine legality rarely blocks it.
    'strength-in-numbers': entry('strength-in-numbers', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'attacking: move a defending character home',
        shouldPlay: (ctx) => ctx.amAttacker &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Bow a weak non-unique to ready a unique (Toturi, Ujiaki). Playable from
    // the discard, so it recycles all game. The targeting stages are steered
    // in the policy (bow the weakest ready non-unique, ready the strongest
    // bowed unique). Card summaries carry no uniqueness flag, so the gate
    // checks the deck's own key uniques by printed id.
    'in-service-to-my-lord': entry('in-service-to-my-lord', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'bow a cheap non-unique to ready a unique character',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => card.bowed &&
            ['akodo-toturi', 'commander-of-the-legions', 'unified-company', 'ikoma-ujiaki-2', 'master-tactician', 'honored-general',
                'akodo-toshiro', 'ikoma-tsanuri', 'akodo-makoto', 'matsu-beiona',
                // Dragon (Lion splash): ready the card-engine monks.
                'togashi-mitsu-2', 'togashi-ichi', 'togashi-tadakatsu',
                'teacher-of-empty-thought', 'kitsuki-investigator'].includes(card.id)) &&
            ctx.myCharacters.filter((card) => !card.bowed).length >= 2
    }),

    // Ready up to 6 printed cost of Bushi — the follow-up attack enabler.
    // Playable from the discard while more honorable.
    'right-hand-of-the-emperor': entry('right-hand-of-the-emperor', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'ready up to 6 cost worth of Bushi characters',
        shouldPlay: (ctx) => ctx.myCharacters.filter((card) => card.bowed).length >= 2
    }),

    // Reaction after we break a province in a military conflict: 1 fate on
    // every Bushi on our side — the swarm's whole board persists.
    'for-greater-glory': entry('for-greater-glory', {
        conflictTypes: ['military'],
        priority: 9,
        summary: 'break reaction: 1 fate on each of our Bushi'
    }),

    // Conflict-phase opener: trade one faceup province for a fate on every
    // printed-cost-3-or-lower body. LionTactics gates the reaction at 5 bodies.
    'feeding-an-army': entry('feeding-an-army', {
        priority: 9,
        summary: 'break a friendly province; fate on each cheap character'
    }),

    // Two fate buys the strongest character in the dynasty discard for this
    // military conflict. Targeting is tower-first in LionTactics.
    'forebearer-s-echoes': entry('forebearer-s-echoes', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'put the strongest dynasty-discard character into this conflict',
        shouldPlay: (ctx) => ctx.dynastyDiscard.some((card) => card.type === 'character')
    }),

    // Political tempo: only spend it while behind and an opposing participant
    // can be bowed, dishonored, and sent home to reverse the conflict.
    'ujiaki-s-offer': entry('ujiaki-s-offer', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'bow, dishonor, and send home an enemy political participant',
        shouldPlay: (ctx) => ctx.losing &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Reaction after losing a political conflict: free Weapon from hand or
    // discard onto a Bushi. Turns every conceded political into tempo.
    'time-for-war': entry('time-for-war', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'lost political: put a Weapon into play on a Bushi'
    }),

    // ---- weapons and banners ----

    // +4/+1 weapon; on the Champion (Toturi) grants an extra military
    // conflict every conflict phase.
    'shori': entry('shori', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: '+4 military; on the Champion, an extra military conflict'
    }),

    // Weapon reaction: bow an enemy character whenever anyone triggers an
    // ability during the bearer's conflict — fires via the hinted path.
    'kamayari': entry('kamayari', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'weapon: bow an enemy after an ability triggers in our conflict'
    }),

    // Bearer does not bow out of military conflicts — keeps a big attacker
    // ready to defend.
    'sashimono': entry('sashimono', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'bearer does not bow from military conflict resolution',
        abilityValue: true
    }),

    // Grants the Lion symbol and Commander trait — turns on Tactical
    // Ingenuity and keeps Akodo Toshiro in play.
    'seal-of-the-lion': entry('seal-of-the-lion', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 5,
        summary: 'grants the Commander trait (+1 military)'
    }),

    // Commander attachment Action: dig the top 4 of the conflict deck for an
    // event — use it every conflict the bearer fights in ("every time
    // possible" — the card engine of the deck).
    'tactical-ingenuity': entry('tactical-ingenuity', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'commander attachment: dig the conflict deck for an event',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.inConflict &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'tactical-ingenuity'))
    }),

    // Technique Action: initiate a military duel on BASE skill, bow the
    // loser. On a high-base bearer (Way of the Lion doubles base) it removes
    // a defender nearly every time. Use whenever the bearer participates.
    'true-strike-kenjutsu': entry('true-strike-kenjutsu', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'duel on base military: bow the loser',
        abilityValue: true,
        attachSide: 'self',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.inConflict && !card.bowed &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'true-strike-kenjutsu')) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // ---- battlefield attachments (play onto OWN provinces while defending) ----

    // During a conflict at the attached province, play characters from the
    // provinces straight into the conflict — surprise defenders.
    'prepared-ambush': entry('prepared-ambush', {
        targetSide: 'self',
        priority: 7,
        summary: 'battlefield: play province characters into conflicts here',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // +2 military to every defender at the attached province.
    'makeshift-war-camp': entry('makeshift-war-camp', {
        conflictTypes: ['military'],
        targetSide: 'self',
        priority: 7,
        summary: 'battlefield: +2 military to each defender here',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // ---- characters: in-play Actions during conflicts ----

    // +5 military while attacking but provinces cannot break this conflict —
    // fire it to STEAL a losing conflict (ring + win reactions), never when
    // the break is already on. Needs a Commander (or it discards itself).
    'akodo-toshiro': entry('akodo-toshiro', {
        conflictTypes: ['military'],
        priority: 7,
        summary: '+5 military, no breaks: steal a losing conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.losing &&
            ctx.myCharacters.some((card) => card.id === 'akodo-toshiro' && card.inConflict && !card.bowed) &&
            ctx.myCharacters.some((card) =>
                ['gifted-tactician', 'honored-general', 'ikoma-tsanuri', 'master-tactician'].includes(card.id) ||
                (card.attachments || []).some((attachment: any) => attachment.id === 'seal-of-the-lion'))
    }),

    // +1/+1 to every participant we control while 3+ of our Bushi fight.
    'ikoma-tsanuri': entry('ikoma-tsanuri', {
        priority: 7,
        summary: '+1/+1 to all our participants with 3+ Bushi in',
        inPlayAction: true,
        shouldUseAction: (ctx) =>
            ctx.myCharacters.some((card) => card.id === 'ikoma-tsanuri' && card.inConflict) &&
            participating(ctx.myCharacters).length >= 3
    }),

    // While attacking: bow an enemy character with military skill at or
    // under the brawler's — buffed, it bows almost anything.
    'lion-s-pride-brawler': entry('lion-s-pride-brawler', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'attacking: bow an enemy with equal or lower military',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.amAttacker &&
            ctx.myCharacters.some((card) => card.id === 'lion-s-pride-brawler' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Every participant loses military equal to its printed POLITICAL — our
    // Bushi print low political, courtier defenders print high: a one-sided
    // sweep against Crane-style boards.
    'matsu-koso': entry('matsu-koso', {
        conflictTypes: ['military'],
        priority: 7,
        summary: 'all participants lose military equal to printed political',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.losing &&
            ctx.myCharacters.some((card) => card.id === 'matsu-koso' && card.inConflict) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Duelist Action: military duel, the winner does not bow from this
    // conflict's resolution. High duel bids make him win it.
    'honorable-challenger': entry('honorable-challenger', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'military duel: winner does not bow from resolution',
        inPlayAction: true,
        shouldUseAction: (ctx) =>
            ctx.myCharacters.some((card) => card.id === 'honorable-challenger' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Lose 2 honor: switch the conflict type — turns a political conflict
    // (theirs or ours) into a military one where the swarm's skill applies.
    'ikoma-ujiaki-2': entry('ikoma-ujiaki-2', {
        priority: 8,
        summary: 'lose 2 honor: switch the conflict to military',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.conflictType === 'political' && ctx.honor >= 6 &&
            ctx.myCharacters.some((card) => card.id === 'ikoma-ujiaki-2' && card.inConflict)
    }),

    // ---- characters: reactions (fire via the hinted priority>=6 path) ----

    // Win reaction vs a participating Courtier: strip a fate or kill it.
    'akodo-makoto': entry('akodo-makoto', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'win reaction: strip fate from (or kill) a Courtier'
    }),

    // On-play from a province: refill that province faceup. Free tempo.
    'akodo-gunso': entry('akodo-gunso', {
        priority: 7,
        summary: 'on-play: refill the province faceup'
    }),

    // Free body multiplication: always pull another copy from a province or
    // dynasty discard when its enter-play reaction is legal.
    'ashigaru-levy': entry('ashigaru-levy', {
        targetSide: 'self',
        priority: 9,
        summary: 'on-enter: put another Ashigaru Levy into play'
    }),

    // Reaction after claiming a ring in his military conflict: resolve the
    // ring effect AGAIN.
    'akodo-toturi': entry('akodo-toturi', {
        priority: 8,
        summary: 'ring claim reaction: resolve the ring effect twice'
    }),

    // Win reaction (military): draw 1.
    'gifted-tactician': entry('gifted-tactician', {
        priority: 8,
        summary: 'military win reaction: draw 1 card'
    }),

    // On-enter reaction: honor him (3 military + honored status).
    'honored-general': entry('honored-general', {
        priority: 7,
        summary: 'on-enter reaction: honor him'
    }),

    // On-enter with 3+ other Bushi: 2 free fate on her.
    'matsu-beiona': entry('matsu-beiona', {
        priority: 7,
        summary: 'on-enter reaction: 2 fate with 3+ other Bushi'
    }),

    // Conflict character whose printed defense jumps from 3 to 6 political.
    'political-rival': entry('political-rival', {
        conflictTypes: ['political'],
        targetSide: 'self',
        priority: 8,
        summary: 'covert political defender with +3 political while defending',
        shouldPlay: (ctx) => !ctx.amAttacker
    }),

    // After dials reveal with our (lower) bid: draw 1 — pairs with the
    // deck's bid-4 dial policy.
    'tactician-s-apprentice': entry('tactician-s-apprentice', {
        priority: 7,
        summary: 'lower honor bid: draw 1 card'
    }),

    // Win reaction while behind on cards: put a cheap Bushi from the dynasty
    // discard into play.
    'unified-company': entry('unified-company', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'win reaction: put a cheap Bushi from the discard into play'
    }),

    // ---- holdings ----

    // Sacrifice: return a Weapon from the conflict discard to hand.
    'ancestral-armory': entry('ancestral-armory', {
        priority: 5,
        summary: 'sacrifice: return a discarded Weapon to hand',
        inPlayAction: true,
        shouldUseAction: (ctx) => (ctx.conflictDiscard || []).some((card: any) =>
            ['shori', 'kamayari', 'fine-katana'].includes(card.id))
    }),

    // ==================================================================
    // Phoenix "For Honor and Glory" (EmeraldDB 7c5b9776).
    // Build a persistent honored high-glory board, hold the Imperial
    // Favor, and contest the ring the board exploits (see GloryTactics).
    // ==================================================================

    // ---- interrupts / cancels (fire via the hinted priority>=6 path) ----

    // Cancel an enemy event while holding the Imperial Favor.
    'censure': entry('censure', {
        priority: 8,
        summary: 'with the Favor: cancel an enemy event'
    }),

    // Cancel an enemy event while we have more honored characters.
    'voice-of-honor': entry('voice-of-honor', {
        priority: 8,
        summary: 'more honored characters: cancel an enemy event'
    }),

    // ---- reactions ----

    // Draw-phase reaction holding: draw 1 every round. Free.
    'forgotten-library': entry('forgotten-library', {
        priority: 8,
        summary: 'draw phase reaction: draw 1 card'
    }),

    // Win reaction: honor a character (ours) or dishonor one (theirs). The
    // policy steers the target and the follow-up menu together.
    'asako-diplomat': entry('asako-diplomat', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'win reaction: honor own character (or dishonor theirs)'
    }),

    // After the water ring is claimed (by anyone): honor a Scholar.
    'asako-tsuki': entry('asako-tsuki', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'water claimed: honor a Scholar character'
    }),

    // Forced reaction after the void ring is claimed: remove a no-fate
    // character from the game — aim at their strongest.
    'isawa-ujina': entry('isawa-ujina', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'void claimed: remove a no-fate character from the game'
    }),

    // End of conflict phase: resolve up to 2 unclaimed rings as attacker.
    'shiba-tsukune': entry('shiba-tsukune', {
        priority: 10,
        summary: 'phase end: resolve 2 unclaimed rings as the attacker'
    }),

    // Conflict phase begins: pick a ring; +2/+2 while it is contested.
    'ethereal-dreamer': entry('ethereal-dreamer', {
        priority: 7,
        summary: 'phase start: +2/+2 while the chosen ring is contested'
    }),

    // Restricted +1/+1. Its on-enter ready is the point: attach only when a
    // bowed printed-cost-2-or-lower Lion body is available.
    'elegant-tessen': entry('elegant-tessen', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: '+1/+1 and ready a cheap attached character',
        abilityValue: true,
        preConflict: true,
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => card.bowed &&
            ['ashigaru-levy', 'matsu-berserker', 'akodo-gunso', 'ikoma-tsanuri',
                'ikoma-tsanuri-2', 'matsu-gohei', 'samurai-of-integrity',
                'niten-adept', 'stoic-rival', 'keen-warrior', 'doomed-shugenja',
                'agasha-swordsmith', 'kitsuki-counselor', 'inventive-mirumoto',
                'hiruma-skirmisher'].includes(card.id)) ||
            ctx.myCharacters.some((card) => card.id === 'niten-master')
    }),

    // Kyuden Isawa recasts a high-impact Spell event from the conflict
    // discard by discarding a lower-value Spell from hand.
    'kyuden-isawa': entry('kyuden-isawa', {
        priority: 10,
        summary: 'discard a Spell to play a Spell event from conflict discard'
    }),

    // Reveal reaction: resolve and claim a free ring as the attacker.
    'offerings-to-the-kami': entry('offerings-to-the-kami', {
        priority: 10,
        summary: 'reveal: resolve and claim an unclaimed ring for free'
    }),

    // Spell-play reaction: Shiba Tetsu grows for every Spell played while he
    // participates. No target and no cost, so always take it.
    'shiba-tetsu': entry('shiba-tetsu', {
        priority: 9,
        summary: 'after a Spell is played while participating: gain +1/+1'
    }),

    // Protect an own Shugenja from an opponent-triggered ability.
    'shiba-yojimbo': entry('shiba-yojimbo', {
        priority: 10,
        summary: 'cancel an opponent ability that targets an own Shugenja'
    }),

    // Air-claim economy reaction, up to twice each round.
    'kudaka': entry('kudaka', {
        priority: 9,
        summary: 'claim air: gain 1 fate and draw 1 card'
    }),

    // Enters-play tutor: keep the best Spell/Kiho from the top three.
    'shrine-maiden': entry('shrine-maiden', {
        priority: 9,
        summary: 'enter play: take a Spell or Kiho from the top three'
    }),

    // Leaving-play recursion: put the strongest Phoenix dynasty character in
    // the discard into play with 1 fate.
    'fushicho': entry('fushicho', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'leaves play: return strongest Phoenix dynasty character with 1 fate'
    }),

    // ---- in-play Actions ----

    // Bow an attacking character while earth is in our claimed pool. Works
    // even from home; the engine rejects the click without earth claimed.
    'solemn-scholar': entry('solemn-scholar', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'earth claimed: bow an attacking character',
        inPlayAction: true,
        shouldUseAction: (ctx) => !ctx.amAttacker &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Ready itself while the water ring is claimed.
    'prodigy-of-the-waves': entry('prodigy-of-the-waves', {
        priority: 7,
        summary: 'water claimed: readies itself',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'prodigy-of-the-waves' && card.bowed)
    }),

    // Grant Covert during Water conflicts. It is useful before a conflict is
    // declared and targets the deck's practical large-body towers.
    'adept-of-the-waves': entry('adept-of-the-waves', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'grant an own tower Covert during Water conflicts this phase',
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true
    }),

    // Once the opponent has declared two conflicts, repeatedly take fate; if
    // none remains, take honor. The card implementation has no printed limit.
    'meddling-mediator': entry('meddling-mediator', {
        priority: 10,
        summary: 'after opponent declares two conflicts: take fate, else honor',
        inPlayAction: true,
        conflictPhaseAction: true
    }),

    // Participating ring swap: take fate from an unclaimed ring and move Water
    // into the claimed pool for the deck's Water payoffs.
    'asako-togama': entry('asako-togama', {
        priority: 9,
        summary: 'participating: swap a claimed ring for an unclaimed ring and take its fate',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) => card.id === 'asako-togama' && card.inConflict)
    }),

    // Conflict character with Disguised Shugenja. Its board action removes one
    // weak dynasty-discard character to discard one random opponent hand card.
    'isawa-tadaka-2': entry('isawa-tadaka-2', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'Disguised Shugenja; trade one weak dynasty-discard character for one enemy hand card',
        inPlayAction: true,
        shouldUseAction: (ctx) => (ctx.opponentHandSize ?? 1) > 0 &&
            ctx.dynastyDiscard.some((card) => card.type === 'character'),
        shouldPlay: (ctx) => {
            if(ctx.myCharacters.some((card) => card.id === 'isawa-tadaka-2')) {
                return false;
            }
            const fate = ctx.fate ?? 0;
            if(fate >= 5) {
                return true;
            }
            return ctx.myCharacters.some((card) => card.id && TADAKA_DISGUISE_COSTS[card.id] !== undefined &&
                fate >= Math.max(5 - TADAKA_DISGUISE_COSTS[card.id], 1));
        }
    }),

    // Void conflict: +1/+1 to all our participants, -1/-1 to all theirs.
    'isawa-atsuko': entry('isawa-atsuko', {
        priority: 8,
        summary: 'void conflict: +1/+1 ours, -1/-1 theirs',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'isawa-atsuko' && card.inConflict) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Holding: sacrifice to move an own character to (or from) the conflict.
    // Reinforce a losing defense with the strongest home body.
    'favorable-ground': entry('favorable-ground', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'sacrifice: reinforce a defense or rescue a tower for the next conflict',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.losing && (
            (!ctx.amAttacker && ctx.myCharacters.some((card) => !card.bowed && !card.inConflict)) ||
            (ctx.preferFavorableRetreat && !ctx.strongholdConflict && (ctx.conflictsRemaining ?? 0) >= 1 &&
                ctx.myCharacters.some((card) => !card.bowed && card.inConflict))
        )
    }),

    // ---- conflict events ----

    // Free body during a water conflict (recurs into the deck afterwards).
    'feral-ningyo': entry('feral-ningyo', {
        priority: 8,
        summary: 'water conflict: free 3/2 body from hand'
    }),

    // Ready (or bow) an own Shugenja — the policy steers it to READY an own
    // bowed Shugenja.
    'against-the-waves': entry('against-the-waves', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'ready an own bowed Shugenja',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => card.bowed &&
            PHOENIX_SHUGENJA.includes(card.id))
    }),

    // Win an unopposed conflict by 5+ to gain 2 fate. The policy extends the
    // attack margin while this is in hand, then always fires the reaction.
    'the-path-of-man': entry('the-path-of-man', {
        priority: 10,
        summary: 'win an unopposed conflict by 5 or more: gain 2 fate',
        shouldPlay: () => false
    }),

    // Tower protection: the target cannot be bowed by the opponent and does
    // not bow after a political conflict.
    'clarity-of-purpose': entry('clarity-of-purpose', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'protect an own tower from bowing and political resolution',
        shouldPlay: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed)
    }),

    // Reaction after an enemy character readies: bow that same enemy again.
    'earth-becomes-sky': entry('earth-becomes-sky', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'after an enemy character readies: bow it again',
        shouldPlay: () => false
    }),

    // Main province-trade card: cancel an unopposed ring effect, resolve it as
    // attacker, then claim the ring.
    'display-of-power': entry('display-of-power', {
        priority: 10,
        summary: 'lose unopposed: cancel, resolve, and claim the contested ring',
        shouldPlay: () => false
    }),

    // Five-fate tower answer: remove up to five fate from enemy characters.
    'consumed-by-five-fires': entry('consumed-by-five-fires', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        abilityValue: true,
        summary: 'remove up to 5 fate from the opponent\'s tower',
        shouldPlay: (ctx) => (ctx.fate ?? 0) >= 5 &&
            ctx.opponentCharacters.filter(fiveFiresTarget)
                .reduce((total, card) => total + (Number(card.fate) || 0), 0) >= 5
    }),

    // Bow an own home Shugenja to honor a participant.
    'benten-s-touch': entry('benten-s-touch', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'bow a home Shugenja: honor a participant',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) => !card.bowed && !card.inConflict &&
            PHOENIX_SHUGENJA.includes(card.id)) &&
            participating(ctx.myCharacters).some((card) => !card.isHonored)
    }),

    // Political conflict: honor an own participant (or the opponent
    // dishonors one of theirs — both outcomes fine, we pick honor).
    'court-games': entry('court-games', {
        conflictTypes: ['political'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'political: honor an own participant',
        shouldPlay: (ctx) => participating(ctx.myCharacters).length > 0
    }),

    // Political duel: honor the winner, dishonor the loser. Steered by the
    // policy (our best political vs their weakest) and bid via GloryTactics.
    'game-of-sadane': entry('game-of-sadane', {
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 7,
        summary: 'political duel: honor the winner, dishonor the loser',
        shouldPlay: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Move an enemy participant home (must be weaker than an own Bushi).
    'rout': entry('rout', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'move an enemy participant home',
        shouldPlay: (ctx) => participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // +X/+X where X = own Shugenja in play — the swarm pump.
    'supernatural-storm': entry('supernatural-storm', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: '+X/+X on a participant, X = own Shugenja count',
        shouldPlay: (ctx) => ctx.myCharacters.filter((card) =>
            PHOENIX_SHUGENJA.includes(card.id)).length >= 2
    }),

    // ---- attachments ----

    // Pride: the bearer honors itself every time it wins a conflict.
    'magnificent-kimono': entry('magnificent-kimono', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'pride: bearer honors itself on wins',
        abilityValue: true
    }),

    // Ancestral champion weapon: on Shiba Tsukune it grants "move a
    // participating character home". Attach steered by GloryTactics; the
    // Action aims at their strongest participant.
    'ofushikai': entry('ofushikai', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        attachSide: 'self',
        priority: 7,
        summary: 'champion weapon: move an enemy participant home',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'shiba-tsukune' && card.inConflict &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'ofushikai')) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // ---- stronghold ----

    // Bow: +2 glory on a character for the phase. Target steered by
    // GloryTactics (honored participant for stats, else the biggest ready
    // body for the favor's glory count).
    'isawa-mori-seido': entry('isawa-mori-seido', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'stronghold: +2 glory on a character this phase'
    }),

    // ==================================================================
    // Dragon "Attachments" / Arsenal (EmeraldDB 46aaa220).
    // Build two deep-fate towers, search and recycle attachments, and use
    // Weapon plays to ready Niten Master repeatedly. Target selection and
    // three-slot Restricted handling live in DragonAttachmentTactics.
    // ==================================================================

    'iron-mountain-castle': entry('iron-mountain-castle', {
        priority: 10,
        summary: 'three Restricted slots; reduce an attachment cost by 1'
    }),

    // ---- tower actions and reactions ----

    'togashi-yokuni': entry('togashi-yokuni', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'copy the best printed triggered ability on another character',
        inPlayAction: true,
        conflictPhaseAction: true
    }),

    'niten-master': entry('niten-master', {
        priority: 10,
        summary: 'after a Weapon attaches: ready this tower, twice per round'
    }),

    'mirumoto-raitsugu': entry('mirumoto-raitsugu', {
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 9,
        summary: 'military duel: discard the loser or remove one fate',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) => card.id === 'mirumoto-raitsugu') &&
            participating(ctx.opponentCharacters).length > 0
    }),

    'niten-adept': entry('niten-adept', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'bow an attachment to bow an unattached enemy participant',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) =>
            card.id === 'niten-adept' && (card.attachments || []).length > 0) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed && (card.attachments || []).length === 0)
    }),

    'stoic-rival': entry('stoic-rival', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'dishonor an enemy participant with fewer attachments',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) => card.id === 'stoic-rival') &&
            participating(ctx.opponentCharacters).some((card) => !card.isDishonored)
    }),

    'solitary-hero': entry('solitary-hero', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'while alone, remove fate from other weaker participants',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).filter((card) => card.id === 'solitary-hero').length === 1 &&
            participating(ctx.myCharacters).length === 1 && participating(ctx.opponentCharacters).length > 0
    }),

    'agasha-sumiko-2': entry('agasha-sumiko-2', {
        priority: 10,
        summary: 'leaves play: strip enemy honor, fate, and cards where ahead'
    }),

    'kitsuki-yuikimi': entry('kitsuki-yuikimi', {
        priority: 8,
        summary: 'ring fate gained: become immune to enemy triggered targeting'
    }),

    'keen-warrior': entry('keen-warrior', {
        priority: 9,
        summary: 'after seeing enemy hand: draw two, bottom one card'
    }),

    'hiruma-skirmisher': entry('hiruma-skirmisher', {
        priority: 9,
        summary: 'after play: gain covert for the phase'
    }),

    // ---- attachment search / recursion ----

    'agasha-swordsmith': entry('agasha-swordsmith', {
        priority: 9,
        summary: 'search the top five conflict cards for an attachment',
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true
    }),

    'inventive-mirumoto': entry('inventive-mirumoto', {
        priority: 9,
        summary: 'with Water claimed: play an attachment from discard on itself',
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => (ctx.conflictDiscard || []).some((card) => card.type === 'attachment')
    }),

    'illustrious-forge': entry('illustrious-forge', {
        priority: 10,
        summary: 'reveal: put the best top-five attachment into play'
    }),

    // ---- attachments ----

    'tetsubo-of-blood': entry('tetsubo-of-blood', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 10,
        summary: '+4 military tower Weapon; use cost reduction',
        abilityValue: true,
        preConflict: true
    }),

    'jade-tetsubo': entry('jade-tetsubo', {
        targetSide: 'enemy',
        attachSide: 'self',
        targetPreference: 'strongest',
        priority: 10,
        summary: '+3 military; bow it to return all fate from a weaker participant',
        abilityValue: true,
        preConflict: true,
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) =>
            (card.attachments || []).some((attachment: any) => attachment.id === 'jade-tetsubo')) &&
            participating(ctx.opponentCharacters).some((card) => (Number(card.fate) || 0) > 0)
    }),

    'adopted-kin': entry('adopted-kin', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 10,
        summary: 'other attachments on the tower gain ancestral',
        abilityValue: true,
        preConflict: true
    }),

    'daimyo-s-favor': entry('daimyo-s-favor', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 10,
        summary: 'bow: next attachment on this character costs 1 less',
        abilityValue: true,
        preConflict: true,
        inPlayAction: true,
        conflictPhaseAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => (ctx.hand || []).some((card: any) =>
            card.type === 'attachment' && card.id !== 'daimyo-s-favor' &&
            Number(card.cost ?? card.printedCost) > 0)
    }),

    'ancestral-daisho': entry('ancestral-daisho', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 8,
        summary: 'ancestral Restricted +2 military Weapon',
        preConflict: true
    }),

    'kitsuki-s-method': entry('kitsuki-s-method', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 7,
        summary: 'ancestral Restricted +2 political attachment',
        preConflict: true
    }),

    'inscribed-tanto': entry('inscribed-tanto', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 7,
        summary: '+1 military Weapon; Void ring grants ring-effect immunity',
        abilityValue: true,
        preConflict: true
    }),

    'two-heavens-technique': entry('two-heavens-technique', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 8,
        summary: '+1 military; exactly two Weapons grant covert',
        abilityValue: true,
        preConflict: true
    }),

    'pathfinder-s-blade': entry('pathfinder-s-blade', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 9,
        summary: 'cancel the attacked province ability',
        abilityValue: true,
        preConflict: true
    }),

    // Holding moved onto the stronghold province: sacrifice to send home a
    // cheap attacker on the final defense.
    'mountaintop-statuary': entry('mountaintop-statuary', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'at the stronghold: send a cost-2-or-less attacker home',
        inPlayAction: true,
        oncePerRound: true,
        shouldUseAction: (ctx) => !ctx.amAttacker && ctx.strongholdConflict &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // ==================================================================
    // Dragon "Monks In Da High House" (EmeraldDB 4fb91e58, Lion splash).
    // Play many cheap cards per conflict; Togashi Mitsu converts the card
    // volume into extra ring resolutions. See DragonTactics.
    // ==================================================================

    // ---- the build-around ----

    // 5+ cards played in his conflict: resolve any ring as the attacker.
    // Clicked every window — the engine rejects it until the count is
    // reached, and the prompt signature changes as cards are played.
    'togashi-mitsu-2': entry('togashi-mitsu-2', {
        priority: 9,
        summary: '5+ cards played: resolve a ring as the attacker',
        inPlayAction: true,
        // Only offer the action once 5 cards are played — clicking it earlier
        // is rejected by the engine AND blocks the retry for the rest of the
        // window (the attempted-set keeps the stale click), so gate it.
        shouldUseAction: (ctx) => (ctx.cardsPlayed ?? 0) >= 5 &&
            ctx.myCharacters.some((card) => card.id === 'togashi-mitsu-2' && card.inConflict)
    }),

    // 10+ cards played while attacking: break the province outright.
    'togashi-ichi': entry('togashi-ichi', {
        priority: 7,
        summary: '10+ cards played attacking: break the province',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.amAttacker &&
            (ctx.cardsPlayed ?? 0) + (ctx.opponentCardsPlayed ?? 0) >= 10 &&
            ctx.myCharacters.some((card) => card.id === 'togashi-ichi' && card.inConflict)
    }),

    // 3+ cards played in his conflict: draw 1.
    'teacher-of-empty-thought': entry('teacher-of-empty-thought', {
        priority: 7,
        summary: '3+ cards played: draw 1',
        inPlayAction: true,
        shouldUseAction: (ctx) => (ctx.cardsPlayed ?? 0) >= 3 &&
            ctx.myCharacters.some((card) => card.id === 'teacher-of-empty-thought' && card.inConflict)
    }),

    // Honor itself for 1 fate — a 1-cost body that fights above its cost.
    'togashi-initiate': entry('togashi-initiate', {
        priority: 6,
        summary: 'pay 1 fate: honor itself',
        inPlayAction: true,
        shouldUseAction: (ctx) => (ctx.fate ?? 0) >= 2 && ctx.myCharacters.some((card) =>
            card.id === 'togashi-initiate' && card.inConflict && !card.isHonored)
    }),

    // Reaction: returns from the dynasty discard when VOID is claimed.
    'keeper-initiate': entry('keeper-initiate', {
        priority: 8,
        summary: 'void claimed: return from the dynasty discard to play'
    }),

    // Action: discard an attachment (their buff or a debuff on ours).
    'miya-mystic': entry('miya-mystic', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'discard an attachment',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.opponentCharacters.some((card) =>
            (card.attachments || []).length > 0)
    }),

    // Action: opponent discards a random card.
    'kitsuki-investigator': entry('kitsuki-investigator', {
        priority: 7,
        summary: 'opponent discards a card',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'kitsuki-investigator' && card.inConflict)
    }),

    // Action before attacking: stack fate onto a ring, then attack it.
    'tranquil-philosopher': entry('tranquil-philosopher', {
        priority: 6,
        summary: 'move fate onto a ring before attacking it',
        inPlayAction: true,
        dynastyAction: true,
        // Its "move 1 fate between two rings" action has no per-use limit and
        // reverses itself, so cap it at once per round to stop a fate ping-pong.
        oncePerRound: true
    }),

    // ---- Kiho / conflict events ----

    // +2 military on a Monk and draw 1 — pure value.
    'hurricane-punch': entry('hurricane-punch', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: '+2 military on a Monk, draw 1'
    }),

    // 2+ cards played: bow an enemy (military <= our monk) and send it home.
    'void-fist': entry('void-fist', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: '2+ cards played: bow and send home an enemy',
        shouldPlay: (ctx) => (ctx.cardsPlayed ?? 0) >= 2 &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Own monk will not bow out of the conflict; honors him after a Kiho.
    'swell-of-seafoam': entry('swell-of-seafoam', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'monk does not bow from resolution (+honor after a Kiho)',
        abilityValue: true
    }),

    // Cannot be bowed by enemy effects; draws if a Kiho was played first.
    'iron-foundations-stance': entry('iron-foundations-stance', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'monk cannot be bowed by effects; draw after a Kiho',
        abilityValue: true
    }),

    // Remove an attachment.
    'let-go': entry('let-go', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'discard an attachment',
        abilityValue: true,
        shouldPlay: (ctx) => ctx.opponentCharacters.some((card) =>
            (card.attachments || []).length > 0)
    }),

    // Interrupt: cancel an enemy event by winning a military duel. It is an
    // INTERRUPT — never a proactive play. Without the shouldPlay block the
    // bot clicked it 722 times in 40 games from the conflict window, and the
    // resulting bid-3 duels bled the deck into dishonor losses. The hinted
    // interrupt path ignores shouldPlay, so it still fires when an enemy
    // event actually triggers.
    'defend-your-honor': entry('defend-your-honor', {
        priority: 8,
        summary: 'duel interrupt: cancel an enemy event',
        shouldPlay: () => false
    }),

    // ---- dynasty events (played from provinces in the dynasty phase) ----

    // Shuffle a low-value province card away, refill faceup — digs for Mitsu.
    'cycle-of-rebirth': entry('cycle-of-rebirth', {
        priority: 6,
        summary: 'shuffle a province card away, refill faceup'
    }),

    // Reset every province faceup and take an extra (fateless) dynasty
    // phase — a full re-dig for Mitsu.
    'a-season-of-war': entry('a-season-of-war', {
        priority: 7,
        summary: 'refill all provinces faceup; extra dynasty phase'
    }),

    // Dynasty-phase card flow. Reveal up to two facedown province cards once
    // each round so the rush can keep buying bodies.
    'staging-ground': entry('staging-ground', {
        priority: 8,
        summary: 'turn up to two facedown province cards faceup',
        dynastyAction: true,
        oncePerRound: true
    }),

    // Rally event played directly from a province. LionTactics waits until a
    // newly played positive-glory Bushi exists; generic honor targeting then
    // chooses tower first and highest glory next.
    'honored-veterans': entry('honored-veterans', {
        priority: 8,
        targetSide: 'self',
        targetPreference: 'strongest',
        summary: 'honor a Bushi played during this dynasty phase'
    }),

    // ---- attachments ----

    // Free +1/+1-per-card engine (played as an attachment by preference).
    'togashi-acolyte': entry('togashi-acolyte', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'attachment mode: +1/+1 per card played in its conflict'
    }),

    // Kiho/Tattoo tutor on declare (attachment mode).
    'ancient-master': entry('ancient-master', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'attachment mode: tutor a Kiho/Tattoo on declare'
    }),

    // Covert (attachment mode) — locks a defender out.
    'tattooed-wanderer': entry('tattooed-wanderer', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'attachment mode: bearer gains covert',
        abilityValue: true,
        preConflict: true
    }),

    // Move the bearer to the conflict (or home) + stats.
    'hawk-tattoo': entry('hawk-tattoo', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: '+1/+1; move the bearer into conflicts',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            !card.inConflict && !card.bowed &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'hawk-tattoo'))
    }),

    // Bearer does not bow when losing a conflict.
    'centipede-tattoo': entry('centipede-tattoo', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'bearer does not bow when losing',
        abilityValue: true
    }),

    // Sacrifice-interrupt: cancels a debuff landing on the bearer. Attach to
    // the key character (steered to Mitsu).
    'finger-of-jade': entry('finger-of-jade', {
        targetSide: 'self',
        targetPreference: 'most-fate',
        priority: 6,
        summary: 'cancels a debuff on the bearer (sacrifice)',
        abilityValue: true,
        preConflict: true
    }),

    // Trigger the bearer's ability a second time — Mitsu resolves two rings.
    'way-of-the-dragon': entry('way-of-the-dragon', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'bearer triggers its ability twice (Mitsu!)',
        abilityValue: true
    }),

    // ---- holdings ----

    // Sacrifice: draw 1. The card engine always wants cards.
    'imperial-storehouse': entry('imperial-storehouse', {
        priority: 6,
        summary: 'sacrifice: draw 1',
        inPlayAction: true
    }),

    // ---- keeper roles (mirror the seeker entries: free fate reactions) ----
    'keeper-of-air': entry('keeper-of-air', {
        priority: 8,
        summary: 'gain 1 fate after winning an air conflict on defense'
    }),
    'keeper-of-earth': entry('keeper-of-earth', {
        priority: 8,
        summary: 'gain 1 fate after winning an earth conflict on defense'
    }),
    'keeper-of-fire': entry('keeper-of-fire', {
        priority: 8,
        summary: 'gain 1 fate after winning a fire conflict on defense'
    }),
    'keeper-of-water': entry('keeper-of-water', {
        priority: 8,
        summary: 'gain 1 fate after winning a water conflict on defense'
    }),
    'keeper-of-void': entry('keeper-of-void', {
        priority: 8,
        summary: 'gain 1 fate after winning a void conflict on defense'
    }),

    // ==================================================================
    // Upgraded Crane Duels (EmeraldDB e2e443b5). Few durable honored
    // duelists; every duel is value. See DuelTactics.
    // ==================================================================

    // ---- duel initiators: characters ----

    // Military duel vs a weaker attacker; good 2-cost stats.
    'arrogant-kakita': entry('arrogant-kakita', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'military duel action',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'arrogant-kakita' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Military duel action.
    'aspiring-challenger': entry('aspiring-challenger', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'military duel action',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'aspiring-challenger' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Political duel action.
    'courtly-challenger': entry('courtly-challenger', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'political duel action',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'courtly-challenger' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Political duel; the WINNER's controller triggers the attacked
    // province's action (even the enemy's) — pure value, use every time.
    'cunning-negotiator': entry('cunning-negotiator', {
        conflictTypes: ['political'],
        priority: 7,
        summary: 'political duel: winner triggers the attacked province',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'cunning-negotiator' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Military duelist who can move enemy characters home.
    'kakita-kaezin': entry('kakita-kaezin', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 9,
        summary: 'military duel: move the loser home',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'kakita-kaezin' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Political duelist: winner locks the enemy out of declaring military.
    'kakita-yuri': entry('kakita-yuri', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'political duel: enemy cannot declare military',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'kakita-yuri' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // ---- other character actions/reactions ----

    // While attacking: drag an enemy character INTO the conflict — feeds the
    // duelists a target.
    // Doji Challenger's action moves an ENEMY character INTO the conflict
    // while we attack — standalone that only adds defender skill against our
    // own attack (a strictly negative tempo play). Real use needs a follow-up
    // that punishes a fresh participant (a duel or a participants-only ring
    // effect), which the heuristic cannot guarantee to line up, so the action
    // stays off. The 3/2 body still enters play and attacks normally.
    'doji-challenger': entry('doji-challenger', {
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'attacking: move an enemy character into the conflict',
        inPlayAction: true,
        shouldUseAction: () => false
    }),

    // Bow an enemy with lower military — aim at their strongest legal.
    'doji-kuwanan': entry('doji-kuwanan', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'bow an enemy with lower military',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.id === 'doji-kuwanan' && card.inConflict && !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Turn a facedown own province faceup (dig out Magistrate Station).
    'daidoji-nerishma': entry('daidoji-nerishma', {
        priority: 5,
        summary: 'turn an own facedown province faceup',
        inPlayAction: true,
        dynastyAction: true
    }),

    // Military win reaction: discard an enemy card. Always.
    'daidoji-harrier': entry('daidoji-harrier', {
        conflictTypes: ['military'],
        priority: 8,
        summary: 'military win: discard an enemy card'
    }),

    // Win reaction: both players discard down — we keep fewer, they lose more.
    'daidoji-iron-warrior': entry('daidoji-iron-warrior', {
        priority: 6,
        summary: 'win reaction: both players discard down'
    }),

    // Interrupt on losing a conflict: duel — a win nullifies the conflict.
    'kakita-toshimoko': entry('kakita-toshimoko', {
        priority: 10,
        summary: 'losing interrupt: duel to nullify the conflict'
    }),

    // Covert (steered to their strongest) + reaction: the coverted character
    // cannot attack this phase. Both halves matter.
    'tengu-sensei': entry('tengu-sensei', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 10,
        summary: 'covert their strongest; reaction locks it out of attacking'
    }),

    // ---- events ----

    // Dishonor a character involved in a duel.
    'insult-to-injury': entry('insult-to-injury', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'dishonor a duel participant'
    }),

    // Military duel through Issue a Challenge.
    'issue-a-challenge': entry('issue-a-challenge', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 7,
        summary: 'military duel event'
    }),

    // Political duel; our duelist gains 1 fate — durability.
    'make-your-case': entry('make-your-case', {
        conflictTypes: ['political'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'political duel: our character gains 1 fate',
        shouldPlay: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed)
    }),

    // Political duel; the loser's controller discards a card.
    'policy-debate': entry('policy-debate', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 8,
        summary: 'political duel: loser discards',
        shouldPlay: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed) &&
            participating(ctx.opponentCharacters).length > 0
    }),

    // Bow (and for 1 fate dishonor) a character that lost a duel.
    'storied-defeat': entry('storied-defeat', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'bow (+dishonor) a duel loser'
    }),

    // Political duel; the loser moves INTO the conflict (drag a weak body in).
    'disparaging-challenge': entry('disparaging-challenge', {
        conflictTypes: ['political'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 6,
        summary: 'political duel: loser moves into the conflict'
    }),

    // Military duel: discards the loser outright if it is dishonored.
    'duel-to-the-death': entry('duel-to-the-death', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'duel: a dishonored loser is discarded from play',
        shouldPlay: (ctx) => participating(ctx.opponentCharacters).some((card) => card.isDishonored)
    }),

    // Duelist in a military conflict does not bow at resolution.
    'kakita-s-final-stance': entry('kakita-s-final-stance', {
        conflictTypes: ['military'],
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'dueling character does not bow from resolution',
        abilityValue: true
    }),

    // ---- attachments (all stack on the key duelists) ----

    'daimyo-s-gunbai': entry('daimyo-s-gunbai', {
        targetSide: 'enemy',
        targetPreference: 'weakest',
        attachSide: 'self',
        priority: 7,
        summary: 'duel action attachment; +2 to duel winners',
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.inConflict && !card.bowed &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'daimyo-s-gunbai')) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    'duelist-training': entry('duelist-training', {
        targetSide: 'enemy',
        targetPreference: 'weakest',
        attachSide: 'self',
        priority: 9,
        summary: 'grants a military duel action',
        abilityValue: true,
        inPlayAction: true,
        shouldUseAction: (ctx) => ctx.myCharacters.some((card) =>
            card.inConflict && !card.bowed &&
            (card.attachments || []).some((attachment: any) => attachment.id === 'duelist-training')) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Champion weapon: switch the conflict type.
    'shukujo': entry('shukujo', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'champion weapon: switch the conflict type'
    }),

    // +2 political in duels; reaction: +1 honor on duel wins. Always fire.
    'kakita-blade': entry('kakita-blade', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'duel weapon; +1 honor on duel wins'
    }),

    // Post-reveal bid nudge: fires via the hinted reaction path; the menu
    // fallback picks the first (increase) option, which converts a tied duel
    // into a win.
    'iaijutsu-master': entry('iaijutsu-master', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'after dials: nudge our duel bid by 1',
        abilityValue: true
    }),

    // ---- holdings / provinces ----

    // Duel action for characters without one.
    'kakita-dojo': entry('kakita-dojo', {
        conflictTypes: ['military'],
        targetSide: 'enemy',
        targetPreference: 'weakest',
        priority: 7,
        summary: 'holding: military duel; a Duelist winner bows the loser',
        inPlayAction: true,
        shouldUseAction: (ctx) => participating(ctx.myCharacters).some((card) => !card.bowed) &&
            participating(ctx.opponentCharacters).some((card) => !card.bowed)
    }),

    // Draw after duels resolve.
    'proving-ground': entry('proving-ground', {
        priority: 8,
        summary: 'draw after a duel resolves'
    }),

    // Ready an honored character.
    'magistrate-station': entry('magistrate-station', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 7,
        summary: 'province: ready an honored character'
    }),

    // Stronghold reaction: honor our character after every resolved duel.
    'kyuden-kakita': entry('kyuden-kakita', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 8,
        summary: 'stronghold: honor our duelist after a duel'
    })
};

// Own Shugenja printed ids for the Phoenix glory deck — card summaries carry
// no traits, so gates count by id (kept in sync with GLORY_DEFAULTS).
const PHOENIX_SHUGENJA = [
    'adept-of-the-waves', 'asako-tsuki', 'ethereal-dreamer', 'isawa-atsuko',
    'isawa-kaede', 'isawa-tadaka-2', 'isawa-ujina', 'kudaka',
    'prodigy-of-the-waves', 'solemn-scholar', 'young-philosopher'
];

const TADAKA_DISGUISE_COSTS: Record<string, number> = {
    'prodigy-of-the-waves': 4,
    'adept-of-the-waves': 2,
    'young-philosopher': 2,
    'ethereal-dreamer': 1
};

// Cards that mark a wall/holding engine: the Kaiu Wall holdings plus the
// stronghold that digs for characters. Two or more (or the stronghold) flips
// the holdingEngine strategy on.
const HOLDING_ENGINE_MARKERS = [
    'kaiu-forges', 'seventh-tower', 'watchtower-of-valor', 'northern-curtain-wall',
    'third-whisker-warrens', 'river-of-the-last-stand', 'watchtower-of-sun-s-shadow',
    'kyuden-hida'
];

// Win-as-defender payoffs and dedicated blockers that mark a defensive deck.
const DEFENSIVE_MARKERS = [
    'hida-kotoe', 'hida-o-ushi', 'kuni-ritsuko', 'staunch-hida', 'hida-tomonatsu',
    'purifier-apprentice', 'seventh-tower', 'watchtower-of-valor', 'guardians-of-rokugan',
    'hiruma-yojimbo', 'borderlands-defender'
];

// Cards that mark an all-out military-rush deck: extra-conflict / swarm /
// ready / draw payoffs that only make sense when the plan is to attack with
// everything, every window. Three or more flips the aggressive strategy on.
// A generic or defensive deck trips none of these and keeps generic behavior.
const AGGRESSIVE_MARKERS = [
    'cavalry-reserves', 'shiotome-encampment', 'ujik-tactics', 'captive-audience',
    'challenge-on-the-fields', 'golden-plains-outpost', 'ride-on', 'spoils-of-war',
    'curved-blade', 'flank-the-enemy', 'born-in-war',
    // Lion bushi-swarm: won-conflict payoffs and all-in military tools that
    // only pay when the plan is to attack every window.
    'way-of-the-lion', 'for-greater-glory', 'in-service-to-my-lord',
    'right-hand-of-the-emperor', 'a-legion-of-one', 'strength-in-numbers',
    'shori', 'unified-company', 'hayaken-no-shiro'
];

// Cards that mark a dishonor/mill deck: honor-drain payoffs, conflict-deck
// mill, and low-honor enablers. Four or more (or the City of the Open Hand
// stronghold, whose whole point is balancing a low honor total) flips the
// dishonor strategy on. No other piloted deck runs any of these.
const DISHONOR_MARKERS = [
    'city-of-the-open-hand', 'blackmail-artist', 'loyal-oathbreaker', 'shadow-stalker',
    'yogo-outcast', 'compromised-secrets', 'kirei-ko', 'licensed-quarter',
    'master-whisperer', 'midnight-prowler', 'shosuro-hametsu', 'thunder-guard-elite',
    'deserted-shrine', 'silent-ones-monastery'
];

// Cards that mark a glory/honor-engine deck: honoring effects, Imperial
// Favor payoffs, and the glory stronghold. The stronghold (whose whole point
// is pumping glory) or four markers flip the glory strategy on. No other
// piloted deck runs any of these.
const GLORY_MARKERS = [
    'isawa-mori-seido', 'kiku-matsuri', 'magnificent-kimono', 'court-games',
    'benten-s-touch', 'game-of-sadane', 'censure', 'voice-of-honor',
    'asako-diplomat', 'asako-tsuki', 'the-imperial-palace'
];

// Cards that mark the monk/card-engine deck: Kiho volume payoffs, tattoo
// attachments, and the High House of Light stronghold (whose whole point is
// the 5-cards-played bonus).
const MONK_MARKERS = [
    'high-house-of-light', 'togashi-mitsu-2', 'hurricane-punch', 'void-fist',
    'iron-foundations-stance', 'swell-of-seafoam', 'hawk-tattoo',
    'centipede-tattoo', 'way-of-the-dragon', 'shintao-monastery',
    'teacher-of-empty-thought'
];

// Derive the deck's strategy flags from the printed card ids it contains.
// A deck with none of a group's markers gets that flag false and thus the
// unchanged generic behavior; the flags are mutually independent.
export function deriveDeckStrategy(cardIds: Iterable<string>): DeckStrategy {
    const ids = new Set(cardIds);
    const wallCount = HOLDING_ENGINE_MARKERS.filter((id) => ids.has(id)).length;
    const defenderCount = DEFENSIVE_MARKERS.filter((id) => ids.has(id)).length;
    const aggroCount = AGGRESSIVE_MARKERS.filter((id) => ids.has(id)).length;
    const dishonorCount = DISHONOR_MARKERS.filter((id) => ids.has(id)).length;
    const gloryCount = GLORY_MARKERS.filter((id) => ids.has(id)).length;
    const monkCount = MONK_MARKERS.filter((id) => ids.has(id)).length;
    return {
        holdingEngine: ids.has('kyuden-hida') || wallCount >= 2,
        defensive: defenderCount >= 3,
        aggressive: aggroCount >= 3,
        dishonor: ids.has('city-of-the-open-hand') || dishonorCount >= 4,
        glory: ids.has('isawa-mori-seido') || gloryCount >= 4,
        monk: ids.has('high-house-of-light') || monkCount >= 4,
        // Keyed on Tsuma alone: the SPARRING Crane precon shares the whole
        // duel package with the upgraded list, and the baseline opponent
        // must keep its generic behavior (bands stay comparable).
        duelist: ids.has('tsuma'),
        // Kyuden Isawa uniquely identifies the Spell recursion/ring-control
        // deck without changing the older Phoenix glory strategy.
        shugenja: ids.has('kyuden-isawa'),
        // Iron Mountain Castle uniquely identifies the attachment-tower list
        // without changing the separate High House monk deck.
        attachmentTower: ids.has('iron-mountain-castle')
    };
}

export function getPlaybookEntry(cardId: string | undefined): PlaybookEntry | undefined {
    return cardId ? PLAYBOOK[cardId] : undefined;
}
