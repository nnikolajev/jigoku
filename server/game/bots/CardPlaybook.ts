import type { CardHint } from './llm/CardHints';

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
}

export interface PlaybookEntry extends CardHint {
    inPlayAction?: boolean;
    dynastyAction?: boolean;
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
    'assassination': entry('assassination', {
        targetSide: 'enemy',
        targetPreference: 'strongest',
        priority: 9,
        summary: 'discard an enemy cost-2-or-less character for 3 honor',
        shouldPlay: (ctx) => ctx.honor >= 6
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

    // Remove 1 fate from a friendly Unicorn character to ready it: worth it
    // for a bowed conflict participant whose skill comes back online.
    'i-am-ready': entry('i-am-ready', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'ready a friendly character by removing 1 of its fate',
        shouldPlay: (ctx) => ctx.myCharacters.some((card) =>
            card.bowed && card.inConflict && (Number(card.fate) || 0) > 0)
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

    // Role reaction: gain 1 fate after an air province is revealed. Free.
    'seeker-of-air': entry('seeker-of-air', {
        priority: 8,
        summary: 'gain 1 fate when an air province is revealed'
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
    // into conflicts refills the hand (twice per round). Card advantage is how
    // the rush keeps finding fresh bodies and pumps.
    'spyglass': entry('spyglass', {
        targetSide: 'self',
        targetPreference: 'strongest',
        priority: 6,
        summary: 'attach to an attacker; draws a card when it commits/moves in'
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
        priority: 7,
        summary: 'protect a targeted Crab character with a fate'
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
    'kaiu-siege-force': entry('kaiu-siege-force', {
        priority: 5,
        summary: 'ready itself by discarding a friendly holding',
        inPlayAction: true,
        shouldUseAction: (ctx) => {
            const card = ctx.myCharacters.find((c) => c.id === 'kaiu-siege-force');
            return !!card && card.bowed && card.inConflict && ctx.losing;
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
    })
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
    'curved-blade', 'flank-the-enemy', 'born-in-war'
];

// Derive the deck's strategy flags from the printed card ids it contains.
// A deck with none of a group's markers gets that flag false and thus the
// unchanged generic behavior; the flags are mutually independent.
export function deriveDeckStrategy(cardIds: Iterable<string>): DeckStrategy {
    const ids = new Set(cardIds);
    const wallCount = HOLDING_ENGINE_MARKERS.filter((id) => ids.has(id)).length;
    const defenderCount = DEFENSIVE_MARKERS.filter((id) => ids.has(id)).length;
    const aggroCount = AGGRESSIVE_MARKERS.filter((id) => ids.has(id)).length;
    return {
        holdingEngine: ids.has('kyuden-hida') || wallCount >= 2,
        defensive: defenderCount >= 3,
        aggressive: aggroCount >= 3
    };
}

export function getPlaybookEntry(cardId: string | undefined): PlaybookEntry | undefined {
    return cardId ? PLAYBOOK[cardId] : undefined;
}
