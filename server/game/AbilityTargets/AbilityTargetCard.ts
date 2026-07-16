import CardSelector from '../CardSelector.js';
import { Stages, Players, EffectNames, TargetModes } from '../Constants.js';

class AbilityTargetCard {
    name: string;
    properties: any;
    selector: any;
    dependentTarget: AbilityTargetCard | null;
    dependentCost: any;

    constructor(name: string, properties: any, ability: any) {
        this.name = name;
        this.properties = properties;
        for(let gameAction of this.properties.gameAction) {
            gameAction.setDefaultTarget((context: any) => context.targets[name]);
        }
        this.selector = this.getSelector(properties);
        this.dependentTarget = null;
        this.dependentCost = null;
        if(this.properties.dependsOn) {
            let dependsOnTarget = ability.targets.find((target: any) => target.name === this.properties.dependsOn);
            dependsOnTarget.dependentTarget = this;
        }
    }

    getSelector(properties: any): any {
        let cardCondition = (card: any, context: any) => {
            let contextCopy = this.getContextCopy(card, context);
            if(context.stage === Stages.PreTarget && this.dependentCost && !this.dependentCost.canPay(contextCopy)) {
                return false;
            }
            return (!properties.cardCondition || properties.cardCondition(card, contextCopy)) &&
                   (!this.dependentTarget || this.dependentTarget.hasLegalTarget(contextCopy)) &&
                   (properties.gameAction.length === 0 || properties.gameAction.some((gameAction: any) => gameAction.hasLegalTarget(contextCopy)));
        };
        return CardSelector.for(Object.assign({}, properties, { cardCondition: cardCondition, targets: true }));
    }

    getContextCopy(card: any, context: any): any {
        let contextCopy = context.copy();
        contextCopy.targets[this.name] = card;
        if(this.name === 'target') {
            contextCopy.target = card;
        }
        return contextCopy;
    }

    canResolve(context: any): boolean {
        // if this depends on another target, that will check hasLegalTarget already
        return !!this.properties.dependsOn || this.hasLegalTarget(context);
    }

    hasLegalTarget(context: any): boolean {
        return this.selector.optional || this.selector.hasEnoughTargets(context, this.getChoosingPlayer(context));
    }

    getGameAction(context: any): any[] {
        return this.properties.gameAction.filter((gameAction: any) => gameAction.hasLegalTarget(context));
    }

    getAllLegalTargets(context: any): any[] {
        return this.selector.getAllLegalTargets(context, this.getChoosingPlayer(context));
    }

    resolve(context: any, targetResults: any): void {
        if(targetResults.cancelled || targetResults.payCostsFirst || targetResults.delayTargeting) {
            return;
        }
        let player = context.choosingPlayerOverride || this.getChoosingPlayer(context);
        if(player === context.player.opponent && context.stage === Stages.PreTarget) {
            targetResults.delayTargeting = this;
            return;
        }
        if(this.properties.mode === TargetModes.AutoSingle) {
            let legalTargets = this.selector.getAllLegalTargets(context, player);
            if(legalTargets.length === 1) {
                context.targets[this.name] = legalTargets[0];
                return;
            }
        }
        let { cardCondition: _cardCondition, player: _playerProp, ...otherProperties } = this.properties;

        let buttons: any[] = [];
        let waitingPromptTitle = '';
        if(context.stage === Stages.PreTarget) {
            // A target-dependent cost cannot be calculated or reduced until
            // this target exists. Paying first loses target-specific reducers
            // (for example Daimyo's Favor on Tetsubo of Blood's bearer).
            if(!targetResults.noCostsFirstButton && !this.dependentCost) {
                buttons.push({ text: 'Pay costs first', arg: 'costsFirst' });
            }
            buttons.push({ text: 'Cancel', arg: 'cancel' });
            if(context.ability.abilityType === 'action') {
                waitingPromptTitle = 'Waiting for opponent to take an action or pass';
            } else {
                waitingPromptTitle = 'Waiting for opponent';
            }
        }
        let mustSelect = this.selector.getAllLegalTargets(context, player).filter((card: any) =>
            card.getEffects(EffectNames.MustBeChosen).some((restriction: any) => restriction.isMatch('target', context))
        );
        let promptProperties = {
            waitingPromptTitle: waitingPromptTitle,
            context: context,
            selector: this.selector,
            buttons: buttons,
            mustSelect: mustSelect,
            onSelect: (player: any, card: any) => {
                context.targets[this.name] = card;
                if(this.name === 'target') {
                    context.target = card;
                }
                return true;
            },
            onCancel: () => {
                targetResults.cancelled = true;
                return true;
            },
            onMenuCommand: (player: any, arg: string) => {
                if(arg === 'costsFirst') {
                    targetResults.payCostsFirst = true;
                    return true;
                }
                return true;
            }
        };
        context.game.promptForSelect(player, Object.assign(promptProperties, otherProperties));
    }

    checkTarget(context: any): boolean {
        if(!context.targets[this.name]) {
            return false;
        } else if(context.choosingPlayerOverride && this.getChoosingPlayer(context) === context.player) {
            return false;
        }
        let cards = context.targets[this.name];
        if(!Array.isArray(cards)) {
            cards = [cards];
        }
        return (cards.every((card: any) => this.selector.canTarget(card, context, context.choosingPlayerOverride || this.getChoosingPlayer(context))) &&
                this.selector.hasEnoughSelected(cards, context) && !this.selector.hasExceededLimit(cards, context));
    }

    getChoosingPlayer(context: any): any {
        let playerProp = this.properties.player;
        if(typeof playerProp === 'function') {
            playerProp = playerProp(context);
        }
        return playerProp === Players.Opponent ? context.player.opponent : context.player;
    }

    hasTargetsChosenByInitiatingPlayer(context: any): boolean {
        if(this.getChoosingPlayer(context) === context.player && (this.selector.optional || this.selector.hasEnoughTargets(context, context.player.opponent))) {
            return true;
        }
        return !this.properties.dependsOn && this.checkGameActionsForTargetsChosenByInitiatingPlayer(context);
    }

    checkGameActionsForTargetsChosenByInitiatingPlayer(context: any): boolean {
        return this.getAllLegalTargets(context).some((card: any) => {
            let contextCopy = this.getContextCopy(card, context);
            if(this.properties.gameAction.some((action: any) => action.hasTargetsChosenByInitiatingPlayer(contextCopy))) {
                return true;
            } else if(this.dependentTarget) {
                return this.dependentTarget.checkGameActionsForTargetsChosenByInitiatingPlayer(contextCopy);
            }
            return false;
        });
    }
}

export default AbilityTargetCard;
