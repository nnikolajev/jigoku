import SeededRandom from './SeededRandom.js';
import type { CardHint } from './llm/CardHints';
import type { DeckStrategy } from './CardPlaybook';

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
}

type HandStats = Record<string, { military: number | null; political: number | null }>;
type CardHintLookup = (cardId: string) => CardHint | undefined;

interface DecideContext {
    roundNumber?: number;
    targetHint?: TargetHint;
    playCost?: number;
    handStats?: HandStats;
    cardHint?: CardHintLookup;
    strategy?: DeckStrategy;
}

class JigokuBotPolicy {
    private random: SeededRandom;
    private lastSignature = '';
    private attempted = new Set<string>();

    constructor(seed: string | number = 1) {
        this.random = new SeededRandom(seed);
    }

    get seedState(): number {
        return this.random.getState();
    }

    decide(playerState: any, botName?: string, context: DecideContext = {}): BotDecision | null {
        const me = this.myPlayer(playerState, botName);
        if(!me) {
            return null;
        }

        // The dedup signature must ignore parts of the prompt that flip while
        // the bot re-selects within the SAME decision: the live conflict skill
        // totals ("Attacker: 4 Defender: 5") and the ring element/type in a
        // conflict title ("Political Fire Conflict"). Left in, they wipe the
        // attempted-set on every legal-but-idle ring toggle, so the bot never
        // exhausts its options and reaches its own pass fall-back — it loops.
        const signature = `${me.promptTitle || ''}|${me.menuTitle || ''}`
            .replace(/Attacker:\s*-?\d+\s*Defender:\s*-?\d+/gi, 'Attacker: N Defender: N')
            .replace(/(?:military|political)\s+\w+\s+conflict/gi, 'CONFLICT');
        if(signature !== this.lastSignature) {
            this.lastSignature = signature;
            this.attempted.clear();
        }

        const decision = this.decideForPrompt(playerState, me, context);
        if(decision && ['cardClicked', 'ringClicked', 'facedownCardClicked'].includes(decision.command)) {
            this.attempted.add(this.decisionKey(decision));
        }

        return decision;
    }

    private decideForPrompt(playerState: any, me: any, context: DecideContext = {}): BotDecision | null {
        const promptTitle = me.promptTitle || '';
        const menuTitle = me.menuTitle || '';
        const title = `${promptTitle} ${menuTitle}`.toLowerCase();
        const buttons = this.enabledButtons(me);
        const opponent = this.opponentPlayer(playerState, me);

        if(promptTitle === 'Honor Bid') {
            return this.buttonDecision(this.pickBidButton(buttons, me, opponent, context.roundNumber), 'honor-bid');
        }

        if(title.includes('are you sure') || title.includes('pass conflict')) {
            return this.buttonDecision(this.findButton(buttons, ['yes']) || this.findButton(buttons, ['no']), 'confirm-pass');
        }

        if(title.includes('mulligan')) {
            // Holding-engine decks dig their opening provinces toward Kaiu Wall
            // holdings (mulligan every non-holding province card); other decks
            // keep their provinces.
            if(context.strategy?.holdingEngine && promptTitle === 'Dynasty Mulligan') {
                return this.holdingMulliganDecision(me, buttons);
            }
            return this.buttonDecision(this.findButton(buttons, ['done']), 'finish-mulligan');
        }

        if(title.includes('discard all characters with no fate')) {
            return this.buttonDecision(this.findButton(buttons, ['done']), 'discard-no-fate-characters');
        }

        if(title.includes('select dynasty cards to discard')) {
            return this.dynastyDiscardDecision(playerState, buttons);
        }

        if(promptTitle === 'Initiate Conflict' || CONFLICT_TITLE_REGEX.test(promptTitle)) {
            const declaration = this.conflictDeclarationDecision(playerState, me, opponent, promptTitle, menuTitle, buttons, context.strategy);
            if(declaration) {
                return declaration;
            }
        }

        if(menuTitle.toLowerCase().includes('choose defenders') && !menuTitle.toLowerCase().includes('covert')) {
            return this.defenderDecision(me, promptTitle, buttons, context.strategy);
        }

        if(title.includes('choose first player')) {
            return this.buttonDecision(this.findButton(buttons, ['first player']) || buttons[0], 'choose-first-player');
        }

        if(title.includes('province order')) {
            const done = this.findButton(buttons, ['done']);
            if(done) {
                return this.buttonDecision(done, 'finish-province-order');
            }
        }

        // The dynasty window overrides the generic action-window prompt text.
        if(menuTitle === 'Initiate an action' || promptTitle === 'Play cards from provinces') {
            return this.actionWindowDecision(me, buttons, context.strategy, context.cardHint);
        }

        if(promptTitle === 'Conflict Action Window') {
            return this.conflictWindowDecision(playerState, me, buttons, context.handStats, context.cardHint, context.strategy);
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
            return this.buttonDecision(moveIntoConflict, 'ride-move-in');
        }

        if(promptTitle.startsWith('Play ') || promptTitle === 'Choose an ability:') {
            const play = buttons.find((button) => String(button.text || '').toLowerCase() !== 'cancel');
            return this.buttonDecision(play || this.findButton(buttons, ['cancel']), 'resolve-play-menu');
        }

        if(title.includes('additional fate')) {
            return this.buttonDecision(this.pickFateButton(buttons, me, context.playCost, context.strategy?.aggressive), 'additional-fate');
        }

        if(title.includes('how much fate') || title.includes('how much honor')) {
            return this.buttonDecision(buttons[0], 'minimal-cost');
        }

        // Triggered ability windows ('Any reactions?' / 'Any interrupts to X?'):
        // fire own province and stronghold abilities, pass everything else.
        if(title.includes('any reaction') || title.includes('any interrupt')) {
            return this.triggeredWindowDecision(me, buttons, context.cardHint);
        }

        if(menuTitle === 'Which ability would you like to use?' || menuTitle === 'Choose an event to respond to') {
            const choice = buttons.find((button) => !['back', 'cancel'].includes(String(button.text || '').toLowerCase()));
            return this.buttonDecision(choice || buttons[0], 'choose-triggered-ability');
        }

        const ringResolution = this.ringResolutionDecision(playerState, me, menuTitle, buttons);
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
        if(me.selectRing === true) {
            const ringDecision = this.ringDecision(playerState, me, title);
            if(ringDecision) {
                return ringDecision;
            }
        }

        const cardDecision = this.cardDecision(playerState, me, title, buttons, context.targetHint, context.cardHint);
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

    private skillValue(card: any, type: string): number | null {
        const summary = type === 'political' ? card.politicalSkillSummary : card.militarySkillSummary;
        const stat = summary?.stat;
        if(stat === undefined || stat === null || stat === '-') {
            return null;
        }

        const value = Number(stat);
        return isNaN(value) ? null : value;
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

    // Baseline bid a rational player wants from hand size alone, before honor
    // safety caps. Used both for our own bid and to predict the opponent's.
    private baselineBid(handSize: number, honor: number): number {
        let desired;
        if(handSize <= 1) {
            desired = 5;
        } else if(handSize <= 2) {
            desired = 4;
        } else if(handSize <= 4) {
            desired = 3;
        } else if(handSize <= 6) {
            desired = 2;
        } else {
            desired = 1;
        }
        if(honor <= 4) {
            desired = Math.min(desired, 2);
        }
        if(honor <= 2) {
            desired = 1;
        }
        return desired;
    }

    private pickBidButton(buttons: any[], me: any, opponent?: any, roundNumber?: number): any {
        const handSize = me?.cardPiles?.hand?.length ?? 0;
        const honor = me?.stats?.honor ?? 10;

        let desired;
        if(roundNumber !== undefined && roundNumber <= 1) {
            // First round: honor is at its highest and the tempo from a full
            // hand outweighs the honor given away — always bid 5.
            desired = 5;
        } else if(!opponent) {
            desired = this.baselineBid(handSize, honor);
        } else {
            const opponentHand = opponent.cardPiles?.hand?.length ?? 0;
            const opponentHonor = opponent.stats?.honor ?? 10;
            const predicted = this.baselineBid(opponentHand, opponentHonor);

            if(honor <= 5) {
                // No honor to spare: draw cheap and never outbid the
                // opponent — a net honor loss risks the dishonor defeat.
                desired = Math.min(2, predicted);
            } else {
                // Cards win games. Bid to close the hand-size gap first;
                // honor is the currency we spend to do it.
                const deficit = opponentHand - handSize;
                if(deficit >= 3) {
                    desired = 5;
                } else if(deficit >= 1) {
                    desired = 4;
                } else if(deficit === 0 || handSize <= 4) {
                    desired = 3;
                } else if(handSize <= 6) {
                    desired = 2;
                } else {
                    desired = 1;
                }

                // Honor floor: shrink the bid until the predicted worst-case
                // transfer cannot drop us below 6 honor.
                while(desired > 1 && desired - predicted > honor - 6) {
                    desired--;
                }

                // Opponent close to the 25-honor victory: never gift them
                // the difference.
                if(opponentHonor >= 16) {
                    desired = Math.min(desired, predicted);
                }

                // We are close to the honor victory ourselves: farm the
                // difference instead of buying cards.
                if(honor >= 20) {
                    desired = Math.min(desired, Math.max(predicted - 1, 1));
                }
            }
        }

        if(honor <= 2) {
            desired = 1;
        }

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

    // Fate placed on a character keeps it alive across fate phases, so scale
    // the investment with the character's printed cost: cheap bodies are
    // disposable, mid-cost characters get 1, expensive powerhouses get 2+.
    private pickFateButton(buttons: any[], me: any, playCost?: number, aggressive = false): any {
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
            const reserve = playCost >= 5 ? 0 : 1;
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

    private conflictDeclarationDecision(playerState: any, me: any, opponent: any, promptTitle: string, menuTitle: string, buttons: any[], strategy?: DeckStrategy): BotDecision | null {
        const lowerMenu = menuTitle.toLowerCase();
        const ready = this.readyCharacters(me);
        const conflictMatch = promptTitle.match(CONFLICT_TITLE_REGEX);
        const conflictType = conflictMatch ? conflictMatch[1].toLowerCase() : null;

        if(lowerMenu.includes('elemental ring')) {
            const canAttack = ready.some((card) => (this.skillValue(card, 'military') || 0) > 0 || (this.skillValue(card, 'political') || 0) > 0);
            const passButton = this.findButton(buttons, ['pass conflict']);
            if(!canAttack && passButton) {
                return this.buttonDecision(passButton, 'pass-no-attackers');
            }

            const rings = Object.values(playerState?.rings || {})
                .filter((ring: any) => ring && ring.unselectable !== true && !ring.claimed)
                .sort((a: any, b: any) => {
                    const scoreDiff = this.ringScore(b, me, opponent) - this.ringScore(a, me, opponent);
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
                const preferredType = this.preferredConflictType(me, strategy?.aggressive);
                const element = conflictMatch[2].toLowerCase();
                if(conflictType !== preferredType && !this.isAttempted('ringClicked', [element])) {
                    return {
                        command: 'ringClicked',
                        args: [element],
                        target: element,
                        reason: 'switch-conflict-type'
                    };
                }
            }
            return this.attackProvinceDecision(opponent);
        }

        if(lowerMenu.includes('covert')) {
            const targets = this.sortBySkillDesc(
                (opponent?.cardPiles?.cardsInPlay || []).filter((card: any) =>
                    card.type === 'character' && card.uuid && !card.bowed && !card.covert &&
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
            const candidates = this.sortBySkillDesc(
                ready.filter((card) => !card.inConflict && (this.skillValue(card, type) || 0) > 0),
                type
            );

            // The attack exists to break the province: a province breaks when
            // the attacker wins by at least its strength, so commit skill
            // until the total clears the province plus the opponent's full
            // possible defense. When even everyone together cannot reach
            // that, the opponent likely will not defend with everything —
            // send all but the weakest, who stays home as a defender.
            const skillOf = (card: any) => Math.max(this.skillValue(card, type) || 0, 0);
            const committedSkill = committed.reduce((total, card) => total + skillOf(card), 0);
            const potentialSkill = committedSkill + candidates.reduce((total, card) => total + skillOf(card), 0);
            const defenseEstimate = (opponent?.cardPiles?.cardsInPlay || [])
                .filter((card: any) => card.type === 'character' && !card.bowed)
                .reduce((total: number, card: any) => total + skillOf(card), 0);
            const breakTarget = this.attackedProvinceStrength(opponent, 4) + defenseEstimate;
            const totalEligible = committed.length + candidates.length;

            // Defensive decks only commit an attack that can actually break the
            // province; when the break is out of reach they keep their bodies
            // home to defend rather than throwing skill at an unwinnable break.
            if(strategy?.defensive && potentialSkill < breakTarget) {
                const passButton = this.findButton(buttons, ['pass conflict']);
                if(committed.length === 0 && passButton) {
                    return this.buttonDecision(passButton, 'defensive-hold');
                }
            }

            // Once the break is reachable, commit exactly enough skill to
            // secure it. When it is not: a defensive deck holds everyone back,
            // an aggressive rush sends every body (all-in pressure feeds its
            // swarm payoffs — Ujik Tactics, Challenge on the Fields, Cavalry
            // Reserves), and a generic deck sends all but a stay-home defender.
            const needMore = potentialSkill >= breakTarget
                ? committedSkill < breakTarget
                : (strategy?.defensive ? false
                    : strategy?.aggressive ? committed.length < totalEligible
                        : committed.length < Math.max(1, totalEligible - 1));

            if(needMore) {
                const next = candidates.find((card) => !this.isAttempted('cardClicked', [card.uuid]));
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
    private ringScore(ring: any, me: any, opponent: any): number {
        const fate = Number(ring.fate) || 0;
        const fateComponent = fate >= 2 ? 1000 + fate * 100 : 0;

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

        return fateComponent + base;
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

    private attackProvinceDecision(opponent: any): BotDecision | null {
        if(!opponent) {
            return null;
        }

        const candidateLists = PROVINCE_KEYS
            .map((key) => opponent.provinces?.[key] || [])
            .concat([opponent.strongholdProvince || []]);

        for(const list of candidateLists) {
            const province = (list || []).find((card: any) => card.isProvince !== false && (card.isProvince || card.facedown));
            if(!province || province.isBroken) {
                continue;
            }

            if(province.uuid) {
                if(!this.isAttempted('cardClicked', [province.uuid])) {
                    return this.cardClickDecision(province, 'attack-province');
                }
            } else if(province.location && opponent.name) {
                const args = [province.location, opponent.name, true];
                if(!this.isAttempted('facedownCardClicked', args)) {
                    return {
                        command: 'facedownCardClicked',
                        args,
                        target: province.location,
                        reason: 'attack-facedown-province'
                    };
                }
            }
        }

        return null;
    }

    private defenderDecision(me: any, promptTitle: string, buttons: any[], strategy?: DeckStrategy): BotDecision | null {
        const done = this.findButton(buttons, ['done']);
        const conflictMatch = promptTitle.match(CONFLICT_TITLE_REGEX);
        const type = conflictMatch ? conflictMatch[1].toLowerCase() : 'military';

        const skillMatch = promptTitle.match(SKILL_VS_REGEX);
        const attackerSkill = skillMatch ? parseInt(skillMatch[1], 10) : null;
        const defenderSkill = skillMatch ? parseInt(skillMatch[2], 10) : 0;

        const candidates = this.sortBySkillDesc(
            this.readyCharacters(me).filter((card) =>
                !card.inConflict &&
                (this.skillValue(card, type) || 0) > 0 &&
                !this.isAttempted('cardClicked', [card.uuid])),
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

        // A province breaks when attacker skill beats defender skill by at
        // least the province strength. Defend to win when reachable, otherwise
        // defend just enough to prevent the break, otherwise keep the board.
        const provinceStrength = this.attackedProvinceStrength(me);
        const potential = defenderSkill + candidates.reduce((total, card) => total + Math.max(this.skillValue(card, type) || 0, 0), 0);

        let target;
        if(strategy?.aggressive) {
            // The rush would rather lose a province than bow bodies it needs to
            // attack again, so it only defends when it can win the conflict
            // outright; a chump-block that merely delays a break is conceded.
            if(potential >= attackerSkill) {
                target = attackerSkill;
            } else {
                return this.buttonDecision(done, 'aggressive-concede-defense');
            }
        } else if(potential >= attackerSkill) {
            target = attackerSkill;
        } else if(potential > attackerSkill - provinceStrength) {
            target = attackerSkill - provinceStrength + 1;
        } else {
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

    private conflictWindowDecision(playerState: any, me: any, buttons: any[], handStats?: HandStats, cardHint?: CardHintLookup, strategy?: DeckStrategy): BotDecision | null {
        const pass = this.buttonDecision(this.findButton(buttons, ['pass']) || buttons[0], 'pass-window');
        const standing = this.conflictStanding(playerState, me);
        if(!standing) {
            return pass;
        }

        // A military-rush deck does not sink cards into defense — every card and
        // fate is saved for its own attacks, so it passes every defensive
        // window and lets the province fall if it must.
        if(strategy?.aggressive && !standing.amAttacker) {
            return pass;
        }

        // Breaking provinces wins the game, so the win/lose gap alone is not
        // the goal: as the attacker, keep pushing until the skill lead reaches
        // the province strength (a 3 vs 0 win against a 5-strength province
        // breaks nothing); as the defender, spend cards only to keep the
        // province alive or to steal a cheap win — a lost conflict that does
        // not break anything is better answered with our own attack.
        const opponent = this.opponentPlayer(playerState, me);
        if(standing.amAttacker) {
            const provinceStrength = this.attackedProvinceStrength(opponent, 4);
            const breakDeficit = provinceStrength - (standing.attackerSkill - standing.defenderSkill);
            if(breakDeficit <= 0 || breakDeficit > 6) {
                return pass;
            }
        } else {
            if(!standing.losing) {
                return pass;
            }
            const provinceStrength = this.attackedProvinceStrength(me, 3);
            const breakDeficit = standing.attackerSkill - provinceStrength + 1 - standing.defenderSkill;
            const cheapWin = standing.gap <= 3;
            if((breakDeficit <= 0 && !cheapWin) || breakDeficit > 6) {
                return pass;
            }
        }

        const conflictType: 'military' | 'political' = playerState?.conflict?.type === 'political' ? 'political' : 'military';
        const playCtx = {
            conflictType,
            losing: standing.losing,
            amAttacker: standing.amAttacker,
            honor: me?.stats?.honor ?? 10,
            myCharacters: this.myCharactersInPlay(me),
            opponentCharacters: (opponent?.cardPiles?.cardsInPlay || []).filter((card: any) => card.type === 'character'),
            dynastyDiscard: me?.cardPiles?.dynastyDiscardPile || []
        };

        // Board powers before hand cards: stronghold, attacked-province and
        // playbook-known in-play Action abilities cost no fate (bowing is the
        // cost). Clicking a card with no legal ability is rejected by the
        // game without mutation and the attempted-set moves to the next
        // candidate.
        const abilitySource = this.conflictAbilitySources(me, playCtx, cardHint).find((card) => !this.isAttempted('cardClicked', [card.uuid]));
        if(abilitySource) {
            return this.cardClickDecision(abilitySource, 'use-board-ability');
        }

        // Keep a fate reserve so the bot is not broke next dynasty phase.
        const fate = me?.stats?.fate ?? 0;
        if(fate < 1) {
            return pass;
        }
        // With no ready character of ours in the conflict, events and
        // attachments cannot change its outcome — only a fresh character
        // (which can enter the conflict when played) is worth fate.
        const hasReadyParticipant = this.myCharactersInPlay(me).some((card) => card.inConflict && !card.bowed);
        const playable = (me?.cardPiles?.hand || [])
            .filter((card: any) => {
                if(!card.isPlayableByMe || !card.uuid || this.isAttempted('cardClicked', [card.uuid])) {
                    return false;
                }
                if(!hasReadyParticipant && card.type !== 'character') {
                    return false;
                }
                // LLM hint gates first: 'never'/'winning' cards stay in hand
                // while losing, and cards hinted for the other conflict type
                // are skipped.
                const hint = card.id && cardHint ? cardHint(card.id) : undefined;
                if(hint) {
                    if(hint.useWhen === 'never' || hint.useWhen === 'winning') {
                        return false;
                    }
                    if(hint.conflictTypes.length > 0 && !hint.conflictTypes.includes(conflictType)) {
                        return false;
                    }
                    // Playbook entries can carry a hand-written situational
                    // gate (e.g. Assassination only with honor to spare).
                    const shouldPlay = (hint as any).shouldPlay;
                    if(typeof shouldPlay === 'function' && !shouldPlay(playCtx)) {
                        return false;
                    }
                }
                // Skip cards that are dead weight in this conflict type (e.g.
                // a military attachment during a political conflict).
                const contribution = this.handContribution(card, conflictType, handStats);
                return contribution === null || contribution > 0;
            })
            .sort((a: any, b: any) => {
                const priorityOf = (card: any) => (card.id && cardHint ? cardHint(card.id)?.priority : undefined) ?? 5;
                const priorityDiff = priorityOf(b) - priorityOf(a);
                if(priorityDiff !== 0) {
                    return priorityDiff;
                }
                const statDiff = (this.handContribution(b, conflictType, handStats) ?? -1) - (this.handContribution(a, conflictType, handStats) ?? -1);
                return statDiff !== 0 ? statDiff : String(a.uuid).localeCompare(String(b.uuid));
            });
        if(playable.length > 0) {
            return this.cardClickDecision(playable[0], 'play-conflict-card');
        }

        return pass;
    }

    // Own in-play cards worth clicking for their Action abilities during a
    // conflict: the stronghold, the attacked province, and any board card
    // (holding, attachment, character) with a playbook-known Action.
    private conflictAbilitySources(me: any, playCtx?: any, cardHint?: CardHintLookup): any[] {
        const stronghold = (me?.strongholdProvince || []).filter((card: any) =>
            card.type === 'stronghold' && card.uuid && !card.bowed);
        const attacked = PROVINCE_KEYS
            .map((key) => me?.provinces?.[key] || [])
            .concat([me?.strongholdProvince || []])
            .map((list) => (list || []).find((card: any) => card.isProvince && card.inConflict && card.uuid && !card.isBroken))
            .filter(Boolean);

        let playbookSources: any[] = [];
        if(cardHint) {
            const onBoard = (location: string) =>
                location === 'play area' || /^(province [1-4]|stronghold province)$/.test(location);
            playbookSources = this.findVisibleCards(me)
                .filter((card) => {
                    if(!card.uuid || !card.id || card.facedown || !onBoard(String(card.location || ''))) {
                        return false;
                    }
                    const hint: any = cardHint(card.id);
                    if(!hint || !hint.inPlayAction) {
                        return false;
                    }
                    return typeof hint.shouldUseAction !== 'function' || !playCtx || hint.shouldUseAction(playCtx);
                })
                .sort((a, b) => {
                    const priorityOf = (card: any) => (cardHint(card.id) as any)?.priority ?? 5;
                    const priorityDiff = priorityOf(b) - priorityOf(a);
                    return priorityDiff !== 0 ? priorityDiff : String(a.uuid).localeCompare(String(b.uuid));
                });
        }

        return stronghold.concat(attacked, playbookSources);
    }

    // null = unknown contribution (events and cards the controller sent no
    // stats for); a known 0 means the card adds nothing to this conflict type.
    private handContribution(card: any, conflictType: string, handStats?: HandStats): number | null {
        const stats = handStats?.[card.uuid];
        if(!stats) {
            return null;
        }
        const value = conflictType === 'political' ? stats.political : stats.military;
        return value === null || value === undefined ? null : value;
    }

    private actionWindowDecision(me: any, buttons: any[], strategy?: DeckStrategy, cardHint?: CardHintLookup): BotDecision | null {
        const pass = this.findButton(buttons, ['pass']);

        if(me?.phase === 'dynasty') {
            const playable = PROVINCE_KEYS
                .flatMap((key) => me?.provinces?.[key] || [])
                .filter((card: any) =>
                    card.isDynasty &&
                    card.type === 'character' &&
                    !card.facedown &&
                    card.uuid &&
                    !this.isAttempted('cardClicked', [card.uuid]));

            if(playable.length > 0) {
                return this.cardClickDecision(playable[0], 'play-dynasty-character');
            }

            // Holding-engine decks deploy most of their characters through
            // dynasty Actions (Kyuden Hida digs the top 3, engineers pull
            // characters/holdings into provinces). Fire those once fate remains
            // to actually pay for what they surface; the engine rejects a click
            // whose ability is not currently legal without mutating state.
            if(strategy?.holdingEngine && (me?.stats?.fate ?? 0) >= 1 && cardHint) {
                const digger = this.dynastyActionSources(me, cardHint)
                    .find((card) => !this.isAttempted('cardClicked', [card.uuid]));
                if(digger) {
                    return this.cardClickDecision(digger, 'dynasty-dig-action');
                }
            }
        }

        if(pass) {
            return this.buttonDecision(pass, 'pass-window');
        }

        return this.buttonDecision(this.findButton(buttons, ['done', 'no more actions', 'cancel']) || buttons[0], 'pass-window');
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

    private dynastyDiscardDecision(playerState: any, buttons: any[]): BotDecision | null {
        // End-of-round province cleanup: discard leftover faceup dynasty cards
        // so provinces refill with fresh cards, then confirm with Done. Never
        // discard a holding — holdings (Kaiu Wall especially) are permanent
        // board value and throwing them away is always a loss.
        const leftover = this.findVisibleCards(playerState).find((card) =>
            card.selectable && !card.selected && card.uuid && card.type !== 'holding' &&
            !this.isAttempted('cardClicked', [card.uuid]));
        if(leftover) {
            return this.cardClickDecision(leftover, 'discard-leftover-dynasty');
        }

        return this.buttonDecision(this.findButton(buttons, ['done']), 'finish-dynasty-discard');
    }

    private ringDecision(playerState: any, me: any, title: string): BotDecision | null {
        const rings = Object.values(playerState?.rings || {}).filter((ring: any) =>
            ring && ring.unselectable !== true && !this.isAttempted('ringClicked', [ring.element]));
        if(rings.length === 0) {
            return null;
        }

        // Same value ordering as conflict declaration — a random pick here
        // hands weak rings (air) to card abilities that ask for a ring.
        const opponent = this.opponentPlayer(playerState, me);
        rings.sort((a: any, b: any) => {
            const scoreDiff = this.ringScore(b, me, opponent) - this.ringScore(a, me, opponent);
            return scoreDiff !== 0 ? scoreDiff : RING_ORDER.indexOf(a.element) - RING_ORDER.indexOf(b.element);
        });
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
    private triggeredWindowDecision(me: any, buttons: any[], cardHint?: CardHintLookup): BotDecision | null {
        // Facedown province summaries carry no type/isProvince flags, so also
        // match by province location.
        const source = this.findVisibleCards(me).find((card) =>
            card.selectable && card.uuid &&
            (card.isProvince || card.type === 'province' || card.type === 'stronghold' ||
                /^(province [1-4]|stronghold province)$/.test(String(card.location || ''))) &&
            !this.isAttempted('cardClicked', [card.uuid]));
        if(source) {
            return this.cardClickDecision(source, 'trigger-province-ability');
        }

        // Character/event reactions fire only with an LLM hint that rates the
        // ability worth using — blind triggers waste fate and honor.
        if(cardHint) {
            const hinted = this.findVisibleCards(me).find((card) => {
                if(!card.selectable || !card.uuid || !card.id || this.isAttempted('cardClicked', [card.uuid])) {
                    return false;
                }
                const hint = cardHint(card.id);
                return !!hint && hint.useWhen !== 'never' && hint.priority >= 6;
            });
            if(hinted) {
                return this.cardClickDecision(hinted, 'trigger-hinted-ability');
            }
        }

        return this.buttonDecision(this.findButton(buttons, ['pass']) || buttons[0], 'pass-window');
    }

    private cardDecision(playerState: any, me: any, title: string, buttons: any[], targetHint?: TargetHint, cardHint?: CardHintLookup): BotDecision | null {
        const cards = this.findVisibleCards(playerState).filter((card) =>
            card.selectable && card.uuid && !this.isAttempted('cardClicked', [card.uuid]));
        if(cards.length === 0) {
            // Prompts can offer the opponent's facedown provinces, which have
            // no uuid in the bot's view — click them by location like the
            // conflict declaration does.
            return this.facedownSelectableDecision(playerState, me);
        }

        const skillType = title.includes('political') ? 'political' : 'military';

        if(targetHint) {
            const aimed = this.polarityTargetDecision(cards, playerState, me, skillType, targetHint, buttons, cardHint);
            if(aimed) {
                return aimed;
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
    private polarityTargetDecision(cards: any[], playerState: any, me: any, skillType: string, targetHint: TargetHint, buttons: any[], cardHint?: CardHintLookup): BotDecision | null {
        const myUuids = new Set(this.findVisibleCards(me).map((card) => card.uuid));
        const mine = cards.filter((card) => myUuids.has(card.uuid));
        const theirs = cards.filter((card) => !myUuids.has(card.uuid));
        // The bot's own optional abilities offer Cancel at the targeting
        // stage (before costs are paid); aborting always beats aiming an
        // effect at the wrong side of the board.
        const cancel = this.findButton(buttons, ['cancel']);

        // Ride On moves a character in or home; the bot plays it to add a body,
        // so aim it at a ready character sitting at home — moving that one into
        // the conflict is the useful direction (a participant would be a no-op).
        if(targetHint.sourceCardId === 'ride-on') {
            const home = mine.filter((card) => !card.bowed && !card.inConflict);
            const pool = home.length > 0 ? home : this.preferReady(mine);
            if(pool.length > 0) {
                return this.cardClickDecision(this.sortBySkillDesc(pool, skillType)[0], 'ride-on-target-home');
            }
        }

        if((targetHint.gameActions || []).includes('attach')) {
            return this.attachmentTargetDecision(mine, theirs, playerState, me, skillType);
        }

        // A per-card LLM hint on the source beats the generic action polarity:
        // the hint was derived from the actual card text.
        const sourceHint = targetHint.sourceCardId && cardHint ? cardHint(targetHint.sourceCardId) : undefined;
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
    private ringResolutionDecision(playerState: any, me: any, menuTitle: string, buttons: any[]): BotDecision | null {
        const dontResolve = this.findButton(buttons, ['don\'t resolve']);
        const isRingTargetPrompt = ['Choose character to remove fate from', 'Choose character to honor or dishonor', 'Choose character to bow or unbow'].includes(menuTitle);

        if(isRingTargetPrompt) {
            const myUuids = new Set(this.findVisibleCards(me).map((card) => card.uuid));
            const selectable = this.findVisibleCards(playerState).filter((card) =>
                card.selectable && card.uuid && !this.isAttempted('cardClicked', [card.uuid]));
            const mine = selectable.filter((card) => myUuids.has(card.uuid));
            const theirs = selectable.filter((card) => !myUuids.has(card.uuid));
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
                const ownTargets = this.sortBySkillDesc(mine.filter((card) => !card.isHonored), 'military');
                const ownPool = ownTargets.filter((card) => card.inConflict).concat(ownTargets.filter((card) => !card.inConflict));
                if(ownPool.length > 0) {
                    return this.cardClickDecision(ownPool[0], 'fire-ring-honor-own');
                }
                const enemyTargets = this.sortBySkillDesc(theirs.filter((card) => !card.isDishonored), 'military');
                if(enemyTargets.length > 0) {
                    return this.cardClickDecision(enemyTargets[0], 'fire-ring-dishonor-enemy');
                }
                return dontResolve ? this.buttonDecision(dontResolve, 'fire-ring-skip') : null;
            }

            // Water: clicking a ready character bows it, a bowed one readies.
            const bowable = this.sortBySkillDesc(theirs.filter((card) => !card.bowed), 'military');
            if(bowable.length > 0) {
                return this.cardClickDecision(bowable[0], 'water-ring-bow-enemy');
            }
            const readyable = this.sortBySkillDesc(mine.filter((card) => card.bowed), 'military');
            const moreConflictsComing = (me?.stats?.conflictsRemaining ?? 0) >= 1;
            if(readyable.length > 0 && moreConflictsComing) {
                return this.cardClickDecision(readyable[0], 'water-ring-ready-own');
            }
            if(dontResolve) {
                return this.buttonDecision(dontResolve, 'water-ring-skip');
            }
            return readyable.length > 0 ? this.cardClickDecision(readyable[0], 'water-ring-ready-own') : null;
        }

        // Fire ring second step: 'Honor <name>' / 'Dishonor <name>' menu for
        // the chosen character.
        const honorButtons = buttons.filter((button) => String(button.text || '').startsWith('Honor '));
        const dishonorButtons = buttons.filter((button) => String(button.text || '').startsWith('Dishonor '));
        if(honorButtons.length > 0 || dishonorButtons.length > 0) {
            const myNames = new Set(this.myCharactersInPlay(me).map((card) => card.name));
            const honorOwn = honorButtons.find((button) => myNames.has(String(button.text).slice('Honor '.length)));
            if(honorOwn) {
                return this.buttonDecision(honorOwn, 'fire-ring-honor');
            }
            const dishonorEnemy = dishonorButtons.find((button) => !myNames.has(String(button.text).slice('Dishonor '.length)));
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
            const preferTake = opponentHonor <= 4 || opponentHonor >= 16;
            return this.buttonDecision((preferTake ? takeOne : gainTwo) || takeOne || gainTwo, 'air-ring-honor');
        }

        return null;
    }

    // Attachments are long-term investments: prefer own characters that stick
    // around (fate on them survives fate phases) and that fight in the current
    // conflict type. When losing a conflict, attach to a participant so the
    // skill swings the resolution.
    private attachmentTargetDecision(mine: any[], theirs: any[], playerState: any, me: any, skillType: string): BotDecision | null {
        if(mine.length === 0) {
            if(theirs.length === 0) {
                return null;
            }
            // Only opponent cards are legal: a control attachment, so degrade
            // their strongest character.
            return this.cardClickDecision(this.sortBySkillDesc(theirs, skillType)[0], 'attach-to-opponent');
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
        }

        const scored = pool.slice().sort((a, b) => {
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

    private preferReady(cards: any[]): any[] {
        const ready = cards.filter((card) => !card.bowed);
        return ready.length > 0 ? ready : cards;
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
