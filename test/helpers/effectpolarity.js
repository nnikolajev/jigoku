'use strict';

// EFFECT POLARITY MONITOR
//
// A generic, card-agnostic invariant checker for bot targeting. It attaches to
// a LIVE game (self-play or scripted) and watches the four status-changing
// card game actions as they actually resolve:
//
//   ready    -> must land on a character the acting bot controls
//   bow      -> must land on a character the opponent controls
//   honor    -> must land on a character the acting bot controls
//   dishonor -> must land on a character the opponent controls
//
// The point is that it needs no per-card knowledge: any misconfigured card, any
// deck overlay that hijacks another card's prompt, and any "bot clicked the
// first selectable card" bug shows up as a wrong-side landing regardless of
// which card caused it.
//
// Every landing is attributed to `event.context.player` — the player whose
// ability is resolving — so an opponent bowing our characters with their own
// card is never counted against us.
//
// Three things are deliberately NOT violations:
//   * COSTS. Bowing/dishonoring your own character to pay for an ability is the
//     card working as printed. Detected from `context.costs[action]`, which the
//     cost resolver fills with the paid targets before the events resolve.
//   * SELF-SOURCED effects. A card that bows itself has no target choice.
//   * Declared allowances (see `allowances`), e.g. Scorpion decks that dishonor
//     their own characters on purpose.
//
// Each surviving violation is classified:
//   avoidable — at the click that chose this target, a correct-side card was
//               also selectable. This is a bot bug, always.
//   forced    — the bot had no correct-side option, or the target was fixed by
//               the card with no prompt at all. Either the card should not have
//               been played, or the card is genuinely two-sided.

const { CardTypes, EventNames } = require('../../build/server/game/Constants.js');

const POLARITY_RULES = Object.freeze({
    [EventNames.OnCardReadied]: { action: 'ready', expect: 'own' },
    [EventNames.OnCardBowed]: { action: 'bow', expect: 'enemy' },
    [EventNames.OnCardHonored]: { action: 'honor', expect: 'own' },
    [EventNames.OnCardDishonored]: { action: 'dishonor', expect: 'enemy' }
});

const CLICK_HISTORY = 12;

function cardId(card) {
    return (card && (card.id || (card.cardData && card.cardData.id))) || null;
}

function cardName(card) {
    return (card && card.name) || '<unknown>';
}

// Could this action have landed on this card at all? Same state guards the
// engine's own `canAffect` applies, so a candidate the action could never have
// touched is not evidence that the bot had a choice.
function affectable(action, card) {
    switch(action) {
        case 'ready': return !!card.bowed;
        case 'bow': return !card.bowed;
        case 'honor': return !card.isHonored;
        case 'dishonor': return !card.isDishonored;
        default: return true;
    }
}

// `game.pipeline.getCurrentStep()` is the OUTERMOST step (the phase), and every
// composite step owns a nested pipeline. The prompt the player is answering is
// the deepest current step, and that is the one carrying the AbilityContext.
function activePromptStep(game) {
    let step = game.pipeline && game.pipeline.length > 0 ? game.pipeline.getCurrentStep() : null;
    let guard = 0;
    while(step && step.pipeline && step.pipeline.length > 0 && guard++ < 64) {
        step = step.pipeline.getCurrentStep();
    }
    return step || null;
}

class EffectPolarityMonitor {
    // seats: { [playerName]: { deck?, allow?: Set|Array of 'action:side' } }
    // allowances: { [sourceCardId]: Array of 'action:side' } — global exception list
    constructor(game, options = {}) {
        this.game = game;
        this.seats = options.seats || {};
        this.allowances = options.allowances || {};
        this.label = options.label || '';
        this.violations = [];
        this.landings = { ready: 0, bow: 0, honor: 0, dishonor: 0 };
        this.exempt = [];
        this.clicks = new Map();
        this.reasons = new Map();
        this.unwrapEngines = [];
        this.attached = false;
        this.attach();
        this.watchControllers(options.controllers || []);
    }

    // Tag each click with the policy reason that produced it. A wrong-side
    // landing is far easier to fix when the failure names the branch that
    // chose the target ("fire-ring-honor-own") instead of only the card.
    watchControllers(controllers) {
        for(const controller of controllers) {
            const engine = controller && controller.engine;
            const playerName = controller && controller.config && controller.config.playerName;
            if(!engine || typeof engine.decide !== 'function' || !playerName) {
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

        // Record what the seat could have picked at the moment it picked. The
        // bot reads exactly these two lists, so they are the ground truth for
        // "was a correct-side target available".
        this.originalCardClicked = this.game.cardClicked.bind(this.game);
        this.game.cardClicked = (playerName, id) => {
            this.recordClick(playerName, this.game.findAnyCardInAnyList(id));
            return this.originalCardClicked(playerName, id);
        };
        this.originalMenuButton = this.game.menuButton.bind(this.game);
        this.game.menuButton = (playerName, arg, uuid, method) => {
            this.recordClick(playerName, this.game.findAnyCardInAnyList(arg), 'button');
            return this.originalMenuButton(playerName, arg, uuid, method);
        };

        this.handlers = {};
        for(const eventName of Object.keys(POLARITY_RULES)) {
            const handler = (event) => this.onPolarityEvent(eventName, event);
            this.handlers[eventName] = handler;
            this.game.on(eventName, handler);
        }
    }

    detach() {
        if(!this.attached) {
            return;
        }
        this.attached = false;
        this.game.cardClicked = this.originalCardClicked;
        this.game.menuButton = this.originalMenuButton;
        for(const unwrap of this.unwrapEngines) {
            unwrap();
        }
        this.unwrapEngines = [];
        for(const [eventName, handler] of Object.entries(this.handlers)) {
            this.game.removeListener(eventName, handler);
        }
    }

    recordClick(playerName, clicked, kind = 'card') {
        const player = this.game.getPlayerByName(playerName);
        if(!player || !this.seats[playerName]) {
            return;
        }
        const promptState = player.promptState || {};
        const selectable = (promptState.selectableCards || []).slice();
        // Card-shaped menu buttons (HandlerMenuPrompt) carry the candidate
        // uuids in `arg`; a disabled button was never a real option.
        const fromButtons = (promptState.buttons || [])
            .filter((button) => button && !button.disabled && button.arg)
            .map((button) => this.game.findAnyCardInAnyList(button.arg))
            .filter(Boolean);
        // The prompt step owns the AbilityContext being resolved. Recording it
        // is what lets a landing be tied to the click that CHOSE it rather
        // than to some earlier click on the same card (declaring it as an
        // attacker, say), which would invent phantom "avoidable" violations.
        const step = activePromptStep(this.game);
        const history = this.clicks.get(playerName) || [];
        history.unshift({
            kind: kind,
            card: clicked,
            context: (step && step.context) || null,
            candidates: selectable.concat(fromButtons),
            reason: this.reasons.get(playerName) || null,
            promptTitle: String(promptState.promptTitle || ''),
            menuTitle: String(promptState.menuTitle || '')
        });
        this.clicks.set(playerName, history.slice(0, CLICK_HISTORY));
    }

    // A click only counts as the choice behind a landing when it happened
    // inside the same ability resolution. Exact context identity first; a
    // same-source recent click second, for the prompts that copy the context.
    findClickFor(playerName, card, context) {
        const history = this.clicks.get(playerName) || [];
        const exact = history.find((entry) => entry.card === card && entry.context === context);
        if(exact) {
            return exact;
        }
        return history.slice(0, 6).find((entry) =>
            entry.card === card &&
            entry.context &&
            context &&
            entry.context.source === context.source) || null;
    }

    onPolarityEvent(eventName, event) {
        const rule = POLARITY_RULES[eventName];
        const context = event && event.context;
        const target = event && event.card;
        if(!rule || !context || !target) {
            return;
        }
        const actor = context.player;
        const seat = actor && this.seats[actor.name];
        if(!seat) {
            return;
        }
        // Attachments and strongholds bow/ready under rules of their own (a
        // stronghold bows itself to pay for its ability); the invariant the bot
        // is judged on is about characters.
        if(target.type !== CardTypes.Character) {
            return;
        }
        this.landings[rule.action]++;

        const side = target.controller === actor ? 'own' : 'enemy';
        if(side === rule.expect) {
            return;
        }

        const record = this.describe(rule, side, event, context, actor, target, seat);
        const exemption = this.exemptionFor(record, seat);
        if(exemption) {
            record.exemption = exemption;
            this.exempt.push(record);
            return;
        }
        this.violations.push(record);
    }

    describe(rule, side, event, context, actor, target, seat) {
        const source = context.source;
        // The cost resolver stores the paid targets on the context under the
        // action name before the cost events resolve, so this is a direct read
        // of "this bow/dishonor was the price, not the effect".
        const paid = context.costs && context.costs[rule.action];
        const costPaid = Array.isArray(paid) ? paid.includes(target) : paid === target;
        const click = this.findClickFor(actor.name, target, context);
        // An alternative only counts if the ACTION could have landed on it:
        // an enemy character that is already bowed is selectable for the ready
        // half of the Water Ring but not for the bow half, and counting it
        // would report a forced choice as an avoidable one. Mirrors the
        // `canAffect` guards on each action.
        const alternatives = click
            ? click.candidates.filter((card) =>
                card !== target &&
                card.type === CardTypes.Character &&
                (rule.expect === 'own' ? card.controller === actor : card.controller !== actor) &&
                affectable(rule.action, card))
            : [];
        return {
            label: this.label,
            deck: seat.deck || null,
            action: rule.action,
            expected: rule.expect,
            landedOn: side,
            sourceId: cardId(source),
            sourceName: cardName(source),
            targetId: cardId(target),
            targetName: cardName(target),
            actor: actor.name,
            phase: this.game.currentPhase || null,
            round: this.game.roundNumber || 0,
            stage: context.stage || null,
            costPaid: costPaid,
            selfSource: source === target,
            promptTitle: click ? click.promptTitle : null,
            menuTitle: click ? click.menuTitle : null,
            botReason: click ? click.reason : null,
            chosen: !!click,
            alternatives: alternatives.map(cardName),
            avoidable: alternatives.length > 0
        };
    }

    exemptionFor(record, seat) {
        const key = `${record.action}:${record.landedOn}`;
        if(this.isCost(record)) {
            return 'cost';
        }
        // A card acting on ITSELF chose nothing: Pride ("after this character
        // loses a conflict, dishonor it"), self-bow costs written as effects,
        // and self-ready actions all land here. Compared by object identity, so
        // a second copy of the same card is still a real target choice.
        if(record.selfSource) {
            return 'self-source';
        }
        const seatAllow = seat.allow || [];
        if(seatAllow.includes(key)) {
            return `deck:${seat.deck || 'seat'}`;
        }
        const allowed = this.allowances[record.sourceId];
        if(allowed && (allowed === true || allowed.includes(key))) {
            return `allowlist:${record.sourceId}`;
        }
        return null;
    }

    isCost(record) {
        return record.costPaid === true || record.stage === 'cost';
    }

    summary() {
        return {
            label: this.label,
            landings: Object.assign({}, this.landings),
            violations: this.violations.length,
            avoidable: this.violations.filter((violation) => violation.avoidable).length,
            exempt: this.exempt.length
        };
    }
}

// One line per violation, dense enough to paste into a bug report.
function formatViolations(violations, limit = 40) {
    return violations.slice(0, limit).map((violation) =>
        `${violation.deck || violation.actor}: ${violation.sourceName} [${violation.sourceId}] ` +
        `${violation.action} landed on ${violation.landedOn} character ${violation.targetName} ` +
        `(expected ${violation.expected}${violation.avoidable ? ', AVOIDABLE — alternatives: ' +
            violation.alternatives.join(', ') : ', forced'})` +
        `${violation.promptTitle ? ` prompt="${violation.promptTitle}"` : ' (no prompt)'}`
    ).join('\n');
}

// Group violations by the card that caused them, which is the unit an
// exception is granted in.
function groupBySource(violations) {
    const bySource = new Map();
    for(const violation of violations) {
        const key = `${violation.sourceId}|${violation.action}:${violation.landedOn}`;
        const entry = bySource.get(key) || {
            sourceId: violation.sourceId,
            sourceName: violation.sourceName,
            key: `${violation.action}:${violation.landedOn}`,
            count: 0,
            avoidable: 0,
            decks: new Set(),
            samples: []
        };
        entry.count++;
        if(violation.avoidable) {
            entry.avoidable++;
        }
        entry.decks.add(violation.deck || violation.actor);
        if(entry.samples.length < 3) {
            entry.samples.push(violation);
        }
        bySource.set(key, entry);
    }
    return [...bySource.values()].sort((a, b) => b.count - a.count);
}

module.exports = { EffectPolarityMonitor, POLARITY_RULES, formatViolations, groupBySource };
