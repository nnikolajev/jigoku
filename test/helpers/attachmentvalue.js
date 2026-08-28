'use strict';

// ATTACHMENT-VALUE MONITOR
//
// The third member of the family that already holds `readyvalue.js` (was the
// ready ever used?) and `movevalue.js` (did the body we moved in contribute?).
// This one asks the question the owner raised from a live game:
//
//   the attachment we just played — could the character we hung it on ever
//   turn it into anything?
//
// It attaches to a LIVE game, watches the engine's own `onCardAttached` events,
// and judges each OWN-SIDE attachment the bot lands on one of its OWN
// characters. Enemy-side debuffs (Pacifism, Pit Trap) are a different
// invariant and belong to `effectpolarity.js`.
//
// A placement is settled when the conflict it was made in resolves (or at
// detach, for one made outside a conflict), and classified:
//
//   contributed     the bearer was participating and unbowed at resolution, so
//                   the printed bonus was actually counted in the skill totals.
//   ability-carrier the attachment's value is an ability/trait/keyword, not a
//                   stat line (Adorned Barcha moves and readies its bearer,
//                   Cloud the Mind blanks) — judging it on skill is wrong.
//   prep            landed with NO conflict running (dynasty phase, or between
//                   conflicts). An attachment is permanent, so this is an
//                   investment, not a play into the current fight.
//   used-later      a `prep` placement whose bearer later fought a conflict
//                   with the attachment still on it. The investment paid.
//   readied-in      the bearer was a BOWED participant when the attachment
//                   landed but was standing by resolution — the ready→skill
//                   sequence working, not a waste.
//   move-in-bearer  an attachment whose own Action MOVES its bearer into the
//                   conflict, placed on a body at home. A participating bearer
//                   makes that card dead, so demanding one here would ask for
//                   the opposite of the rule this monitor audits. The id list
//                   is READ FROM THE POLICY (`HOME_BEARER_ATTACHMENT_IDS`), and
//                   `HOME_BEARER_NEEDS_READY_IDS` says which of them also need
//                   the bearer standing. Whether the bot then FOLLOWED THROUGH
//                   with the move is `movevalue.js`'s question, not this one.
//   idle            landed during a live conflict on a body that contributed
//                   nothing to it. Not automatically a bug: the bearer may be
//                   the only legal home, and next round it still carries the
//                   bonus.
//   out-of-reach    `idle`, with an alternative offered, but the conflict was
//                   short by more skill than ANY attachment was going to find
//                   (`AttachmentTargetConfig.maxSkillNeeded`). The shipped
//                   policy deliberately banks the card on the durable body
//                   there — "a conflict 14 short is not being rescued by a +1
//                   weapon" — so this is the policy working, not a defect.
//   wasted          `idle` AND the click that chose it had a legal alternative
//                   that WAS an unbowed participant of a conflict the
//                   attachment could still have swung. That is the hard gate:
//                   the bot demonstrably had a better home for the same card in
//                   the same prompt and passed it over.
//
// `wasted` is the only failing class, and it mirrors the `avoidable` gate in
// `effectpolarity.js`: the alternatives come from the prompt's own selectable
// list, so a placement the engine never offered a choice on can never fail.
// The reach cap is READ FROM THE POLICY, never restated here, so the monitor
// cannot drift from the rule it is auditing.

const { CardTypes, EventNames } = require('../../build/server/game/Constants.js');
const {
    DEFAULT_ATTACHMENT_TARGET, HOME_BEARER_ATTACHMENT_IDS, HOME_BEARER_NEEDS_READY_IDS
} = require('../../build/server/game/bots/AttachmentTargetPolicy.js');

// 0 disables the cap in the policy, and disables it here too.
const MAX_SKILL_NEEDED = DEFAULT_ATTACHMENT_TARGET.maxSkillNeeded;

function withinReach(needed) {
    return needed > 0 && (MAX_SKILL_NEEDED <= 0 || needed <= MAX_SKILL_NEEDED);
}

const CLICK_HISTORY = 12;

function cardId(card) {
    return (card && (card.id || (card.cardData && card.cardData.id))) || null;
}

function cardName(card) {
    return (card && card.name) || '<unknown>';
}

function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

// Printed skill line of an attachment, with the Yokuni/"switch" modifier
// applied. Reading `cardData` rather than the live effect engine keeps this
// independent of whichever card granted the bonus.
function printedBonus(attachment, conflictType) {
    if(!attachment || !attachment.cardData) {
        return 0;
    }
    let military = numeric(attachment.cardData.military_bonus);
    let political = numeric(attachment.cardData.political_bonus);
    if(attachment.isAttachmentBonusModifierSwitchActive &&
        attachment.isAttachmentBonusModifierSwitchActive() === true) {
        const swap = military;
        military = political;
        political = swap;
    }
    return conflictType === 'political' ? political : military;
}

// Does this attachment do anything beyond its stat line? Any triggered ability,
// any persistent effect, any granted trait/faction. Such a card cannot be
// judged by whether its bearer swung the current conflict.
function hasAbility(attachment) {
    if(!attachment) {
        return false;
    }
    const buckets = [
        attachment.abilities && attachment.abilities.actions,
        attachment.abilities && attachment.abilities.reactions,
        attachment.abilities && attachment.abilities.persistentEffects
    ];
    return buckets.some((bucket) => Array.isArray(bucket) && bucket.length > 0);
}

function participating(card) {
    return !!(card && card.isParticipating && card.isParticipating());
}

// Skill our side still has to find for THIS conflict to change its result:
// as attacker, to reach the province strength; as defender, to stop the break
// or to take the conflict back. Zero means the outcome is already settled and
// a permanent attachment is better spent on a body that fights later — which
// is exactly the tower branch the bot has. Mirrors
// `JigokuBotPolicy.conflictStrengthNeeded`.
function skillStillNeeded(conflict, actor) {
    const attackerSkill = numeric(conflict.attackerSkill);
    const defenderSkill = numeric(conflict.defenderSkill);
    const provinces = (conflict.getConflictProvinces && conflict.getConflictProvinces()) || [];
    const strengths = provinces
        .map((province) => (province.getStrength ? numeric(province.getStrength()) : 0))
        .filter((value) => value > 0);
    const strength = strengths.length > 0 ? Math.min(...strengths) : 4;
    if(conflict.attackingPlayer === actor) {
        return Math.max(strength - (attackerSkill - defenderSkill), 0);
    }
    const preventBreak = attackerSkill - strength + 1 - defenderSkill;
    return preventBreak > 0 ? preventBreak : Math.max(attackerSkill - defenderSkill + 1, 0);
}

// `game.pipeline.getCurrentStep()` is the OUTERMOST step; the prompt actually
// being answered is the deepest one, and that is the step carrying the
// AbilityContext. Same walk as `effectpolarity.js`.
function activePromptStep(game) {
    let step = game.pipeline && game.pipeline.length > 0 ? game.pipeline.getCurrentStep() : null;
    let guard = 0;
    while(step && step.pipeline && step.pipeline.length > 0 && guard++ < 64) {
        step = step.pipeline.getCurrentStep();
    }
    return step || null;
}

class AttachmentValueMonitor {
    // seats: { [playerName]: { deck? } }
    constructor(game, options = {}) {
        this.game = game;
        this.seats = options.seats || {};
        this.label = options.label || '';
        this.placements = [];
        this.pending = [];
        this.wasted = [];
        this.idle = [];
        this.counts = {
            total: 0, contributed: 0, abilityCarrier: 0, prep: 0, usedLater: 0,
            readiedIn: 0, idle: 0, wasted: 0, forced: 0, outOfReach: 0,
            outsideConflict: 0, moveInBearer: 0
        };
        this.reasons = new Map();
        this.unwrapEngines = [];
        this.clicks = new Map();
        this.attached = false;
        this.attach();
        this.watchControllers(options.controllers || []);
    }

    // Tag each click with the policy reason behind it, so a failure names the
    // branch that chose the bearer and not only the card.
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
        this.originalCardClicked = this.game.cardClicked.bind(this.game);
        this.game.cardClicked = (playerName, id) => {
            this.recordClick(playerName, this.game.findAnyCardInAnyList(id));
            return this.originalCardClicked(playerName, id);
        };
        this.handlers = {
            [EventNames.OnCardAttached]: (event) => this.onAttach(event),
            [EventNames.AfterConflict]: () => this.settle(),
            [EventNames.OnConflictFinished]: () => this.settle(),
            [EventNames.OnConflictPass]: () => this.settle()
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
        this.game.cardClicked = this.originalCardClicked;
        for(const unwrap of this.unwrapEngines) {
            unwrap();
        }
        this.unwrapEngines = [];
        for(const [name, handler] of Object.entries(this.handlers)) {
            this.game.removeListener(name, handler);
        }
        this.settle();
        // Anything still open never met a conflict it could be used in.
        for(const entry of this.pending) {
            this.close(entry, entry.conflict ? 'idle' : 'prep');
        }
        this.pending = [];
    }

    recordClick(playerName, clicked) {
        const player = this.game.getPlayerByName(playerName);
        if(!player || !this.seats[playerName]) {
            return;
        }
        const promptState = player.promptState || {};
        const step = activePromptStep(this.game);
        const history = this.clicks.get(playerName) || [];
        history.unshift({
            card: clicked,
            context: (step && step.context) || null,
            candidates: (promptState.selectableCards || []).slice(),
            reason: this.reasons.get(playerName) || null,
            promptTitle: String(promptState.promptTitle || ''),
            menuTitle: String(promptState.menuTitle || '')
        });
        this.clicks.set(playerName, history.slice(0, CLICK_HISTORY));
    }

    // The click that CHOSE this bearer, by ability-resolution IDENTITY. Only
    // this click's selectable list is evidence about what the bot could have
    // picked instead: a same-source click from a different prompt in the same
    // play (a Scorpion dishonor COST paid on the body that then received the
    // attachment) offers a candidate list belonging to that other question and
    // reads as a phantom "avoidable".
    findClickFor(playerName, card, context) {
        const history = this.clicks.get(playerName) || [];
        return history.find((entry) => entry.card === card && entry.context === context) || null;
    }

    // A looser match, for the decision REASON only. Never for alternatives.
    findReasonFor(playerName, card, context) {
        const history = this.clicks.get(playerName) || [];
        return history.slice(0, 6).find((entry) =>
            entry.card === card && entry.context && context &&
            entry.context.source === context.source) || null;
    }

    onAttach(event) {
        const attachment = event && event.card;
        const bearer = event && event.parent;
        const context = event && event.context;
        const actor = context && context.player;
        if(!attachment || !bearer || !actor || !this.seats[actor.name]) {
            return;
        }
        // Province attachments (Prepared Ambush) and enemy-side debuffs are
        // other invariants; this one is "our buff on our body".
        if(bearer.type !== CardTypes.Character || bearer.controller !== actor) {
            return;
        }
        // A control switch is the point of the card (Forged Edict style); the
        // bearer is not ours to build up.
        if(attachment.controller !== actor) {
            return;
        }
        const conflict = this.game.currentConflict;
        const live = !!(conflict && conflict.conflictType && !conflict.winnerDetermined);
        const conflictType = live ? conflict.conflictType : null;
        const click = this.findClickFor(actor.name, bearer, context);
        const reasonClick = click || this.findReasonFor(actor.name, bearer, context);
        this.counts.total++;
        const entry = {
            label: this.label,
            deck: (this.seats[actor.name] || {}).deck || null,
            seat: actor.name,
            round: this.game.roundNumber || 0,
            phase: this.game.currentPhase || null,
            attachment: cardName(attachment),
            attachmentId: cardId(attachment),
            // The ABILITY that placed it, which is the unit an exception is
            // granted in: a plain weapon is generic, but the effect that
            // steals one and attaches it (Calling in Favors) has its own
            // trade-off and its own allowance.
            sourceId: cardId(context.source),
            sourceName: cardName(context.source),
            bearer: cardName(bearer),
            bearerId: cardId(bearer),
            bearerFate: numeric(bearer.fate),
            bearerBowed: !!bearer.bowed,
            bearerParticipating: participating(bearer),
            bonus: live ? printedBonus(attachment, conflictType) : Math.max(
                printedBonus(attachment, 'military'), printedBonus(attachment, 'political')),
            ability: hasAbility(attachment),
            conflictType,
            needed: live ? skillStillNeeded(conflict, actor) : 0,
            reason: reasonClick ? reasonClick.reason : this.reasons.get(actor.name) || null,
            promptTitle: reasonClick ? reasonClick.promptTitle : null,
            // Alternatives the PROMPT offered: own characters, unbowed, and
            // actually in the conflict this attachment was played into. The
            // engine's selectable list already applies every attachment
            // restriction, so a body listed here really could have carried it.
            alternatives: click && live
                ? click.candidates
                    .filter((card) => card !== bearer && card.type === CardTypes.Character &&
                        card.controller === actor && !card.bowed && participating(card))
                    .map(cardName)
                : [],
            chosen: !!click,
            liveAttachment: attachment,
            liveBearer: bearer,
            actor,
            conflict: live ? conflict : null,
            outcome: null
        };
        if(!live) {
            this.counts.outsideConflict++;
        }
        this.placements.push(entry);
        this.pending.push(entry);
    }

    settle() {
        const conflict = this.game.currentConflict;
        for(const entry of this.pending) {
            if(entry.outcome !== null) {
                continue;
            }
            if(entry.conflict) {
                if(entry.conflict !== conflict) {
                    continue;
                }
                this.classifyInConflict(entry);
                continue;
            }
            // A `prep` placement settles the first time its bearer fights with
            // the attachment still attached.
            if(conflict && participating(entry.liveBearer) &&
                entry.liveAttachment.parent === entry.liveBearer) {
                this.close(entry, 'used-later');
            }
        }
        this.pending = this.pending.filter((entry) => entry.outcome === null);
    }

    // Judged on what the DECISION could know, exactly as `movevalue.js` judges
    // a move by the skill at arrival: a bearer that was an unbowed participant
    // when the attachment landed made the bonus count, whatever the opponent
    // did to it afterwards. Only a bearer that could NOT use it at that instant
    // is settled by the resolution, which is the one thing that can rescue it
    // (a bowed participant that stands up, a home body that moves in).
    classifyInConflict(entry) {
        if(entry.bearerParticipating && !entry.bearerBowed) {
            this.close(entry, entry.bonus > 0 ? 'contributed' : 'ability-carrier');
            return;
        }
        const stillAttached = entry.liveAttachment.parent === entry.liveBearer;
        const rescued = participating(entry.liveBearer) && !entry.liveBearer.bowed && stillAttached;
        if(rescued) {
            this.close(entry, 'readied-in');
            return;
        }
        // An attachment whose Action moves its bearer INTO the conflict wants a
        // bearer at home; `AttachmentTargetPolicy` exempts exactly these ids
        // from the participant preference, so failing them for not being on a
        // participant would audit the reverse of the shipped rule.
        if(HOME_BEARER_ATTACHMENT_IDS.has(entry.attachmentId) && !entry.bearerParticipating &&
            (!HOME_BEARER_NEEDS_READY_IDS.has(entry.attachmentId) || !entry.bearerBowed)) {
            this.close(entry, 'move-in-bearer');
            return;
        }
        // A stat line that never reached the fight is judged; a pure ability
        // card has nothing to judge on skill and its home is the card's call.
        if(entry.bonus <= 0 && entry.ability) {
            this.close(entry, 'ability-carrier');
            return;
        }
        this.close(entry, 'idle');
    }

    close(entry, outcome) {
        entry.outcome = outcome;
        switch(outcome) {
            case 'contributed': this.counts.contributed++; return;
            case 'ability-carrier': this.counts.abilityCarrier++; return;
            case 'readied-in': this.counts.readiedIn++; return;
            case 'move-in-bearer': this.counts.moveInBearer++; return;
            case 'used-later': this.counts.usedLater++; return;
            case 'prep': this.counts.prep++; return;
            default: break;
        }
        // `idle`: landed into a live conflict it did nothing for. Only a
        // placement the prompt offered a participating alternative for, in a
        // conflict that still needed the skill, is a bot defect; a settled
        // conflict is exactly when a permanent attachment belongs on a body
        // that fights later, and a prompt with no participant offered nothing
        // better.
        this.counts.idle++;
        this.idle.push(entry);
        if(entry.alternatives.length === 0) {
            this.counts.forced++;
        } else if(withinReach(entry.needed)) {
            entry.outcome = 'wasted';
            this.counts.wasted++;
            this.wasted.push(entry);
        } else {
            entry.outcome = entry.needed > 0 ? 'out-of-reach' : 'settled';
            this.counts.outOfReach++;
        }
    }
}

function formatPlacements(entries, limit = 40) {
    if(!entries || entries.length === 0) {
        return '  (none)';
    }
    return entries.slice(0, limit).map((entry) =>
        `  [${entry.label}] ${entry.seat}${entry.deck ? ` (${entry.deck})` : ''} r${entry.round}: ` +
        `${entry.attachment} [${entry.attachmentId}]` +
        `${entry.sourceId && entry.sourceId !== entry.attachmentId ? ` via ${entry.sourceName}` : ''}` +
        ` -> ${entry.bearer} ` +
        `(${entry.bearerBowed ? 'bowed' : 'ready'}, ` +
        `${entry.bearerParticipating ? 'in conflict' : 'at home'}, ${entry.bearerFate} fate, ` +
        `+${entry.bonus} ${entry.conflictType || 'no conflict'}` +
        `${entry.conflictType ? `, ${entry.needed} skill still needed` : ''})` +
        `${entry.alternatives.length === 0
            ? ' forced'
            : withinReach(entry.needed)
                ? ` AVOIDABLE — participating alternatives: ${entry.alternatives.join(', ')}`
                : entry.needed > 0
                    ? ` beyond the ${MAX_SKILL_NEEDED}-skill reach cap — alternatives: ${entry.alternatives.join(', ')}`
                    : ` conflict already settled — alternatives: ${entry.alternatives.join(', ')}`}` +
        `${entry.reason ? ` [${entry.reason}]` : ''}`
    ).join('\n');
}

// Group by the attachment that caused it, which is the unit a fix is made in.
function groupByAttachment(entries) {
    const byCard = new Map();
    for(const entry of entries) {
        const key = entry.attachmentId;
        const row = byCard.get(key) || {
            attachmentId: key, attachment: entry.attachment,
            count: 0, avoidable: 0, decks: new Set(), reasons: new Set()
        };
        row.count++;
        if(entry.alternatives.length > 0 && entry.needed > 0) {
            row.avoidable++;
        }
        row.decks.add(entry.deck || entry.seat);
        if(entry.reason) {
            row.reasons.add(entry.reason);
        }
        byCard.set(key, row);
    }
    return [...byCard.values()].sort((a, b) => b.count - a.count);
}

module.exports = { AttachmentValueMonitor, formatPlacements, groupByAttachment };
