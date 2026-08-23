'use strict';

// READY-VALUE MONITOR
//
// A generic, card-agnostic waste checker for the bot's ready effects. It
// attaches to a LIVE game and watches the engine's own `onCardReadied` events
// as they resolve, then asks one question of each one:
//
//   did anything ever USE this ready?
//
// Readying a character costs a card (or a fate, or a sacrifice). It buys
// something only when a conflict can still use the body it un-bows:
//
//   * the character was a bowed PARTICIPANT — a bowed body contributes 0 skill,
//     so readying it hands its skill straight back to the conflict being
//     fought;
//   * the character later PARTICIPATED in a conflict this phase — it attacked
//     for us, defended against them, or was moved in;
//   * the opponent still had a conflict opportunity and PASSED it. The ready is
//     what made defending possible, and a pass they were able to declare is a
//     conflict they chose not to take. That counts, even though nothing ever
//     entered a conflict. (Raised by the owner: "you prevented the opponent
//     from declaring an unopposed conflict but the test won't see it.")
//   * the deck races the Imperial Favor and the body carries glory — the glory
//     count at the end of the conflict phase reads only UNBOWED characters
//     (`DrawCard.getContributionToImperialFavor`). Declared per seat.
//
// Each surviving landing is classified:
//   wasted — at the instant of the ready NEITHER player had a conflict
//            opportunity left and the body was at home. No later event could
//            possibly have used it. This is a bot bug, always.
//   unused — the ready was defensible when it was made (an opportunity
//            remained) but nothing in fact used it. Reported, never failed:
//            the opponent's later choices are not the bot's fault.
//
// Costs are exempt (`context.costs.ready`), so is a ready with no acting
// player, and so are the seats/cards named in the allowance list.

const { CardTypes, EventNames, Phases } = require('../../build/server/game/Constants.js');

const CLICK_HISTORY = 8;

function cardId(card) {
    return (card && (card.id || (card.cardData && card.cardData.id))) || null;
}

function cardName(card) {
    return (card && card.name) || '<unknown>';
}

function conflictParticipants(conflict) {
    if(!conflict) {
        return [];
    }
    return [].concat(conflict.getAttackers() || [], conflict.getDefenders() || []).filter(Boolean);
}

class ReadyValueMonitor {
    // seats: { [playerName]: { deck?, allowCardIds?: Array<string>, favorGlory?: boolean } }
    constructor(game, options = {}) {
        this.game = game;
        this.seats = options.seats || {};
        this.label = options.label || '';
        this.allowCardIds = new Set(options.allowCardIds || []);
        // Every ready the monitor considered, productive or not.
        this.readies = [];
        // Readies still waiting for something to use them.
        this.pending = [];
        this.wasted = [];
        this.freeRing = [];
        this.unused = [];
        this.counts = {
            total: 0, participantReady: 0, usedLater: 0,
            deterred: 0, favorGlory: 0, freeRing: 0,
            // The first leg of a `ReadyMovePlanner` sequence, and how many of
            // those legs the second leg actually completed. A sequence that
            // readies and then fails to move is the exact defect the planner
            // exists to prevent, so these two numbers must track each other.
            plannedReady: 0, plannedReadyMoved: 0,
            // Second legs: a bowed PARTICIPANT stood up by a source that could
            // only ever reach it after the move (Fan of Command, The Pursuit of
            // Justice). Complete by definition, counted as evidence the
            // move -> ready order fires.
            readyAfterMove: 0
        };
        // Outcome census for the planner-attributed readies, so a broken second
        // leg says WHERE it broke instead of only that it did.
        this.plannedOutcomes = new Map();
        this.reasons = new Map();
        this.unwrapEngines = [];
        this.attached = false;
        this.attach();
        this.watchControllers(options.controllers || []);
    }

    // Tag each ready with the policy reason that produced the click, so a
    // failure names the branch instead of only the card.
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
                    const history = this.reasons.get(playerName) || [];
                    history.unshift(decision.reason);
                    this.reasons.set(playerName, history.slice(0, CLICK_HISTORY));
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
            [EventNames.OnCardReadied]: (event) => this.onReady(event),
            // Every point at which the participant lists are known to be
            // populated. A body can join late (moved in, played into the
            // conflict), so the union across the whole conflict is what counts.
            [EventNames.OnConflictDeclared]: () => this.sweepParticipants(),
            [EventNames.OnConflictStarted]: () => this.sweepParticipants(),
            [EventNames.OnMoveToConflict]: () => this.sweepParticipants(),
            [EventNames.AfterConflict]: () => this.sweepParticipants(),
            [EventNames.OnConflictFinished]: () => this.sweepParticipants(),
            [EventNames.OnConflictPass]: (event) => this.onConflictPass(event),
            [EventNames.OnPhaseEnded]: (event) => this.onPhaseEnded(event)
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
        // A game that ends mid-phase never raises the phase-ended event, so
        // settle whatever is still open the same way.
        this.settlePending();
    }

    conflictOpportunities(player) {
        if(!player) {
            return 0;
        }
        const remaining = Number(player.getConflictOpportunities());
        return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    }

    onReady(event) {
        const context = event && event.context;
        const card = event && event.card;
        const actor = context && context.player;
        if(!card || !actor || card.type !== CardTypes.Character) {
            return;
        }
        const seat = this.seats[actor.name];
        if(!seat) {
            return;
        }
        // Only the conflict phase can produce a ready that a conflict might
        // use. The fate phase readies everything for free.
        if(this.game.currentPhase !== Phases.Conflict) {
            return;
        }
        // Readying as a COST is the card working as printed, not a choice.
        const costTargets = (context.costs && context.costs.ready) || null;
        if(costTargets && [].concat(costTargets).includes(card)) {
            return;
        }
        const source = context.source;
        const sourceId = cardId(source);
        if(sourceId && this.allowCardIds.has(sourceId)) {
            return;
        }
        // Only OUR own characters. Readying an enemy body is a polarity
        // question, owned by `effectpolarity.js`.
        if(card.controller !== actor) {
            return;
        }

        this.counts.total++;
        const opponent = actor.opponent;
        const entry = {
            label: this.label,
            deck: seat.deck || null,
            seat: actor.name,
            round: this.game.roundNumber,
            card: cardName(card),
            cardId: cardId(card),
            sourceId: sourceId,
            source: cardName(source),
            // A ring resolves because it was claimed, not because the bot chose
            // to spend anything on it.
            fromRing: (source && source.printedType) === 'ring',
            reason: (this.reasons.get(actor.name) || [])[0] || null,
            inConflict: !!card.isParticipating(),
            glory: Number(card.glory) || 0,
            ownConflictsRemaining: this.conflictOpportunities(actor),
            opponentConflictsRemaining: this.conflictOpportunities(opponent),
            outcome: null
        };
        this.readies.push(entry);

        // A ready the planner asked for names itself in the decision reason.
        // Only a ready on a body at HOME is a FIRST leg that still owes a move:
        // the same reason on a bowed PARTICIPANT is the second leg of a
        // move -> ready sequence, which is already complete.
        entry.plannedForMove = /planned-move/.test(String(entry.reason || '')) && !entry.inConflict;
        entry.plannedAfterMove = /planned-move|ready-after-move/.test(String(entry.reason || '')) &&
            entry.inConflict;
        if(entry.plannedForMove) {
            this.counts.plannedReady++;
        }
        if(entry.plannedAfterMove) {
            this.counts.readyAfterMove++;
        }
        if(entry.inConflict) {
            entry.outcome = 'participant-ready';
            this.tallyPlanned(entry);
            this.counts.participantReady++;
            return;
        }
        // The Imperial Favor exception, declared per seat: an unbowed glory
        // body is worth points in the count that runs at the end of this phase.
        if(seat.favorGlory && entry.glory > 0) {
            entry.outcome = 'favor-glory';
            this.tallyPlanned(entry);
            this.counts.favorGlory++;
            return;
        }
        entry.pendingCard = card;
        entry.pendingActor = actor;
        this.pending.push(entry);
    }

    // Any pending body that is now in a conflict got what it was readied for.
    sweepParticipants() {
        if(this.pending.length === 0) {
            return;
        }
        const participants = new Set(conflictParticipants(this.game.currentConflict));
        if(participants.size === 0) {
            return;
        }
        this.pending = this.pending.filter((entry) => {
            if(!participants.has(entry.pendingCard)) {
                return true;
            }
            entry.outcome = 'used-in-later-conflict';
            this.tallyPlanned(entry);
            this.counts.usedLater++;
            if(entry.plannedForMove) {
                this.counts.plannedReadyMoved++;
            }
            return false;
        });
    }

    // A conflict opportunity the opponent DECLINED while our readied body was
    // standing. The ready is what made defending possible, so a pass they could
    // have declared counts as the ready doing its job.
    onConflictPass(event) {
        if(this.pending.length === 0) {
            return;
        }
        const passer = event && event.conflict && event.conflict.attackingPlayer;
        if(!passer) {
            return;
        }
        this.pending = this.pending.filter((entry) => {
            if(entry.pendingActor === passer) {
                return true;
            }
            entry.outcome = 'deterred-opponent-pass';
            this.tallyPlanned(entry);
            this.counts.deterred++;
            return false;
        });
    }

    onPhaseEnded(event) {
        const phase = (event && event.phase) || this.game.currentPhase;
        if(phase !== Phases.Conflict) {
            return;
        }
        this.settlePending();
    }

    tallyPlanned(entry) {
        if(!entry.plannedForMove) {
            return;
        }
        const key = `${entry.outcome} <- ${entry.source}`;
        this.plannedOutcomes.set(key, (this.plannedOutcomes.get(key) || 0) + 1);
    }

    settlePending() {
        for(const entry of this.pending) {
            // The hard verdict: nothing could POSSIBLY have used this ready at
            // the moment it was made, because neither player had a conflict
            // opportunity left and the body was not in one.
            if(entry.ownConflictsRemaining === 0 && entry.opponentConflictsRemaining === 0) {
                // A RING resolution is free: the ring resolves because it was
                // claimed, not because the bot spent a card or a fate on it, so
                // a dead ready there costs nothing. The bot still demotes it
                // below every live option (`JigokuBotPolicy` water-ring
                // branch); it simply cannot decline the ring. Counted and
                // printed, never failed.
                if(entry.fromRing) {
                    entry.outcome = 'free-ring';
            this.tallyPlanned(entry);
                    this.counts.freeRing++;
                    this.freeRing.push(entry);
                } else {
                    entry.outcome = 'wasted';
            this.tallyPlanned(entry);
                    this.wasted.push(entry);
                }
            } else {
                entry.outcome = 'unused';
            this.tallyPlanned(entry);
                this.unused.push(entry);
            }
            delete entry.pendingCard;
            delete entry.pendingActor;
        }
        this.pending = [];
    }
}

function formatReadies(entries) {
    if(!entries || entries.length === 0) {
        return '  (none)';
    }
    return entries.map((entry) =>
        `  [${entry.label}] ${entry.seat}${entry.deck ? ` (${entry.deck})` : ''} r${entry.round}: ` +
        `${entry.source} readied ${entry.card} at home with ` +
        `${entry.ownConflictsRemaining} own / ${entry.opponentConflictsRemaining} enemy conflicts left` +
        `${entry.reason ? ` [${entry.reason}]` : ''}`
    ).join('\n');
}

module.exports = { ReadyValueMonitor, formatReadies };
