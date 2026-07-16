import { Stages, Players } from '../Constants.js';

class AbilityTargetRing {
    name: string;
    properties: any;
    ringCondition: (ring: any, context: any) => boolean;
    dependentTarget: AbilityTargetRing | null;
    dependentCost: any;

    constructor(name: string, properties: any, ability: any) {
        this.name = name;
        this.properties = properties;
        this.ringCondition = (ring: any, context: any) => {
            let contextCopy = context.copy();
            contextCopy.rings[this.name] = ring;
            if(this.name === 'target') {
                contextCopy.ring = ring;
            }
            if(context.stage === Stages.PreTarget && this.dependentCost && !this.dependentCost.canPay(contextCopy)) {
                return false;
            }
            return (properties.gameAction.length === 0 || properties.gameAction.some((gameAction: any) => gameAction.hasLegalTarget(contextCopy))) &&
                   properties.ringCondition(ring, contextCopy) && (!this.dependentTarget || this.dependentTarget.hasLegalTarget(contextCopy));
        };
        for(let gameAction of this.properties.gameAction) {
            gameAction.getDefaultTargets = (context: any) => context.rings[name];
        }
        this.dependentTarget = null;
        this.dependentCost = null;
        if(this.properties.dependsOn) {
            let dependsOnTarget = ability.targets.find((target: any) => target.name === this.properties.dependsOn);
            dependsOnTarget.dependentTarget = this;
        }
    }

    canResolve(context: any): boolean {
        return !!this.properties.dependsOn || this.hasLegalTarget(context);
    }

    hasLegalTarget(context: any): boolean {
        return Object.values(context.game.rings).some((ring: any) => this.properties.optional || this.ringCondition(ring, context));
    }

    getGameAction(context: any): any[] {
        return this.properties.gameAction.filter((gameAction: any) => gameAction.hasLegalTarget(context));
    }

    getAllLegalTargets(context: any): any[] {
        return Object.values(context.game.rings).filter((ring: any) => this.ringCondition(ring, context));
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
        let buttons: any[] = [];
        let waitingPromptTitle = '';
        if(context.stage === Stages.PreTarget) {
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
        let promptProperties = {
            waitingPromptTitle: waitingPromptTitle,
            context: context,
            buttons: buttons,
            onSelect: (player: any, ring: any) => {
                context.rings[this.name] = ring;
                if(this.name === 'target') {
                    context.ring = ring;
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
        context.game.promptForRingSelect(player, Object.assign({}, promptProperties, this.properties));
    }

    checkTarget(context: any): boolean {
        if(!context.rings[this.name] || context.choosingPlayerOverride && this.getChoosingPlayer(context) === context.player) {
            return false;
        }
        return this.properties.optional && context.rings[this.name].length === 0 ||
            this.properties.ringCondition(context.rings[this.name], context);
    }

    getChoosingPlayer(context: any): any {
        let playerProp = this.properties.player;
        if(typeof playerProp === 'function') {
            playerProp = playerProp(context);
        }
        return playerProp === Players.Opponent ? context.player.opponent : context.player;
    }

    hasTargetsChosenByInitiatingPlayer(context: any): boolean {
        if(this.properties.gameAction.some((action: any) => action.hasTargetsChosenByInitiatingPlayer(context))) {
            return true;
        }
        return this.getChoosingPlayer(context) === context.player;
    }
}

export default AbilityTargetRing;
