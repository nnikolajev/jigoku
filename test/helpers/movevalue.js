'use strict';

// MOVE-VALUE MONITOR
//
// The other half of `readyvalue.js`. That one asks whether a READY was ever
// used; this one asks the question the owner put on the second leg:
//
//   did the body we moved into the conflict actually contribute something —
//   defence, the conflict win, or the break?
//
// It attaches to a LIVE game, watches the engine's own `onMoveToConflict`
// events, and settles each one when the conflict resolves, by COUNTERFACTUAL:
// recompute the outcome with that body's skill removed and see whether anything
// changes.
//
//   decisive-win      we won, and without it the skill comparison flips
//                     (`attackerSkill >= defenderSkill` gives the attacker
//                     ties, so the counterfactual uses the same rule)
//   decisive-break    we attacked, the province broke, and without it the
//                     margin no longer reaches the province strength
//   decisive-defence  we defended, the province held, and without it the
//                     margin WOULD have reached it
//   payoff            it contributed no skill but a participation payoff was on
//                     the table — Minami Kaze Regulars / Higashi Kaze Company
//                     moving in, or Shinjo Shono / Outskirts Sentry already
//                     participating. `isParticipating()` is bow-agnostic, so
//                     these pay for a body that arrives bowed. This is the
//                     Unicorn rush's whole reason to move bodies around.
//   redundant         it contributed skill but the result was the same without
//                     it. Not a bug on its own: the opponent acts after we do,
//                     and a margin can stop mattering.
//   wasted            it contributed NOTHING and could not have — no skill on
//                     arrival, no skill at resolution (so it was not the
//                     move-then-ready sequence either) and no payoff card in
//                     sight. That is the hard gate.
//
// Costs and enemy-controlled moves are skipped: `doji-challenger` and
// `kitsu-motso` drag one of OUR bodies in to bow it, which is their move, not
// ours to justify.

const { CardTypes, EventNames } = require('../../build/server/game/Constants.js');

// Cards whose value is PARTICIPATION rather than skill. A bowed body still
// satisfies `isParticipating()` and still counts for `hasMoreParticipants`.
const PAYOFF_ON_ARRIVAL = new Set(['minami-kaze-regulars', 'higashi-kaze-company']);
const PAYOFF_WHILE_PARTICIPATING = new Set(['shinjo-shono', 'outskirts-sentry']);
// Sources whose OWN effect is the value and the move is the rider: Adorned
// Barcha bows an enemy participant and brings its bearer along, so judging that
// move by the bearer's skill alone misses the entire point of the card.
const PAYOFF_BY_SOURCE = new Set(['adorned-barcha']);

function cardId(card) {
    return (card && (card.id || (card.cardData && card.cardData.id))) || null;
}

function cardName(card) {
    return (card && card.name) || '<unknown>';
}

function skillOf(card, type) {
    if(!card || card.bowed) {
        return 0;
    }
    const value = type === 'political' ? card.getPoliticalSkill?.() : card.getMilitarySkill?.();
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

class MoveValueMonitor {
    // seats: { [playerName]: { deck? } }
    constructor(game, options = {}) {
        this.game = game;
        this.seats = options.seats || {};
        this.label = options.label || '';
        this.moves = [];
        this.pending = [];
        this.wasted = [];
        this.redundant = [];
        this.counts = {
            total: 0, decisiveWin: 0, decisiveBreak: 0, decisiveDefence: 0,
            payoff: 0, redundant: 0, wasted: 0
        };
        this.reasons = new Map();
        this.unwrapEngines = [];
        this.attached = false;
        this.attach();
        this.watchControllers(options.controllers || []);
    }

    watchControllers(controllers) {
        for(const controller of controllers) {
            const engine = controller && controller.engine;
            const playerName = controller && controller.config && controller.config.playerName;
            if(!engine || !engine.decide || !playerName) {
                continue;
            }
            const original = engine.decide.bind(engine);
            engine.decide = (input) => {
                const decision = original(input);
                if(decision && decision.reason) {
                    this.reasons.set(playerName, decision.reason);
                }
                return decision;
            };
            this.unwrapEngines.push(() => {
                engine.decide = original;
            });
        }
    }

    attach() {
        if(this.attached) {
            return;
        }
        this.attached = true;
        this.handlers = {
            [EventNames.OnMoveToConflict]: (event) => this.onMove(event),
            // `determineWinner` has run by the time AfterConflict is raised, so
            // the skills, the winner and the province strengths are all final.
            [EventNames.AfterConflict]: () => this.settle(),
            [EventNames.OnConflictFinished]: () => this.settle(),
            [EventNames.OnConflictPass]: () => this.discard()
        };
        for(const [name, handler] of Object.entries(this.handlers)) {
            this.game.on(name, handler);
        }
    }

    detach() {
        if(!this.attached) {
            return;
        }
        this.attached = false;
        for(const unwrap of this.unwrapEngines) {
            unwrap();
        }
        this.unwrapEngines = [];
        for(const [name, handler] of Object.entries(this.handlers)) {
            this.game.removeListener(name, handler);
        }
        this.settle();
    }

    onMove(event) {
        const card = event && event.card;
        const context = event && event.context;
        const actor = context && context.player;
        const conflict = this.game.currentConflict;
        if(!card || !actor || !conflict || card.type !== CardTypes.Character) {
            return;
        }
        // Only bodies moved by their OWN controller. An opponent dragging one
        // of ours in (Doji Challenger) is their decision, not ours.
        if(card.controller !== actor || !this.seats[actor.name]) {
            return;
        }
        // Moving HOME is the same event on some cards; only arrivals count.
        if(!card.isParticipating?.()) {
            return;
        }
        this.counts.total++;
        const entry = {
            label: this.label,
            deck: (this.seats[actor.name] || {}).deck || null,
            seat: actor.name,
            round: this.game.roundNumber,
            card: cardName(card),
            cardId: cardId(card),
            source: cardName(context.source),
            sourceId: cardId(context.source),
            reason: this.reasons.get(actor.name) || null,
            arrivedBowed: !!card.bowed,
            // Skill AT ARRIVAL, which is what the decision could know. A body
            // that walked in ready and was bowed by the opponent afterwards
            // made a sound decision and a bad outcome; only the counterfactual
            // classes below are allowed to read the resolution state.
            arrivalSkill: skillOf(card, conflict.conflictType),
            liveCard: card,
            actor,
            conflict,
            outcome: null
        };
        this.moves.push(entry);
        this.pending.push(entry);
    }

    // A payoff is on the table when the arriving body is one of the after-win
    // reactions, or when a payoff character of ours is already participating.
    payoffFor(entry) {
        if(PAYOFF_ON_ARRIVAL.has(entry.cardId)) {
            return entry.cardId;
        }
        if(PAYOFF_BY_SOURCE.has(entry.sourceId)) {
            return entry.sourceId;
        }
        const mine = entry.conflict.getCharacters?.(entry.actor) || [];
        const helper = mine.find((card) => PAYOFF_WHILE_PARTICIPATING.has(cardId(card)));
        return helper ? cardId(helper) : null;
    }

    settle() {
        const conflict = this.game.currentConflict;
        for(const entry of this.pending) {
            if(entry.conflict !== conflict || !conflict.winnerDetermined) {
                continue;
            }
            this.classify(entry, conflict);
        }
        this.pending = this.pending.filter((entry) => entry.outcome === null);
    }

    // A conflict that was passed can never settle its moves.
    discard() {
        this.pending = [];
    }

    classify(entry, conflict) {
        const amAttacker = conflict.attackingPlayer === entry.actor;
        const contributed = skillOf(entry.liveCard, conflict.conflictType);
        const attacker = Number(conflict.attackerSkill) || 0;
        const defender = Number(conflict.defenderSkill) || 0;
        // The same comparison the engine makes, with our body removed.
        const attackerWithout = amAttacker ? attacker - contributed : attacker;
        const defenderWithout = amAttacker ? defender : defender - contributed;
        const weWon = conflict.winner === entry.actor;
        const weWouldWin = amAttacker
            ? attackerWithout >= defenderWithout
            : attackerWithout < defenderWithout;
        const strengths = (conflict.provinceStrengthsAtResolution || [])
            .map((row) => Number(row.strength) || 0);
        const lowestStrength = strengths.length > 0 ? Math.min(...strengths) : Infinity;
        const broke = lowestStrength <= attacker - defender;
        const wouldBreak = lowestStrength <= attackerWithout - defenderWithout;
        const payoff = this.payoffFor(entry);

        entry.contributedSkill = contributed;
        entry.payoffCardId = payoff;

        if(weWon && !weWouldWin) {
            entry.outcome = 'decisive-win';
            this.counts.decisiveWin++;
            return;
        }
        if(amAttacker && broke && !wouldBreak) {
            entry.outcome = 'decisive-break';
            this.counts.decisiveBreak++;
            return;
        }
        if(!amAttacker && !broke && wouldBreak) {
            entry.outcome = 'decisive-defence';
            this.counts.decisiveDefence++;
            return;
        }
        if(payoff) {
            entry.outcome = 'payoff';
            this.counts.payoff++;
            return;
        }
        // Judged on what the decision could know, not on what the opponent did
        // afterwards: arriving with skill on the contested axis is a real
        // contribution even when a later bow erases it. The reverse is also a
        // real contribution — a body moved in BOWED and readied afterwards is
        // the move-then-ready sequence, and it contributes at resolution.
        if(entry.arrivalSkill > 0 || contributed > 0) {
            entry.outcome = 'redundant';
            this.counts.redundant++;
            this.redundant.push(entry);
            return;
        }
        entry.outcome = 'wasted';
        this.counts.wasted++;
        this.wasted.push(entry);
    }
}

function formatMoves(entries) {
    if(!entries || entries.length === 0) {
        return '  (none)';
    }
    return entries.map((entry) =>
        `  [${entry.label}] ${entry.seat}${entry.deck ? ` (${entry.deck})` : ''} r${entry.round}: ` +
        `${entry.source} moved ${entry.card} in ` +
        `(${entry.arrivedBowed ? 'bowed' : 'ready'}, ${entry.arrivalSkill ?? '?'} skill on arrival, ` +
        `${entry.contributedSkill ?? '?'} at resolution` +
        `${entry.payoffCardId ? `, payoff ${entry.payoffCardId}` : ''})` +
        `${entry.reason ? ` [${entry.reason}]` : ''}`
    ).join('\n');
}

module.exports = { MoveValueMonitor, formatMoves };
