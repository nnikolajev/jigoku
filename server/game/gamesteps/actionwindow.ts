import { UiPrompt } from './UiPrompt';
import { EventNames, Locations, Players, EffectNames } from '../Constants';
import type Game from '../game';
import type Player from '../player';

class ActionWindow extends UiPrompt {
    title: string;
    windowName: string;
    currentPlayer: Player;
    currentPlayerConsecutiveActions: number;
    opportunityCounter: number;
    prevPlayerPassed: boolean;
    bonusActions: Record<string, { actionCount: number; actionsTaken: boolean; takingActions: boolean }> | undefined;

    constructor(game: Game, title: string, windowName: string) {
        super(game);

        this.title = title;
        this.windowName = windowName;
        if(this.game.currentConflict && !this.game.currentConflict.isSinglePlayer) {
            this.currentPlayer = this.game.currentConflict.defendingPlayer;
        } else {
            this.currentPlayer = game.getFirstPlayer();
        }
        this.currentPlayerConsecutiveActions = 0;
        this.opportunityCounter = 0;
        this.prevPlayerPassed = false;
    }

    activeCondition(player: Player): boolean {
        return player === this.currentPlayer;
    }

    onCardClicked(player: Player, card: any): boolean {
        const legalActions = this.getLegalActions(player, card);

        if(legalActions.length === 0) {
            return false;
        } else if(legalActions.length === 1) {
            let action = legalActions[0];
            let targetPrompts = action.targets.some((target: any) => target.properties.player !== Players.Opponent);
            if(!this.currentPlayer.optionSettings.confirmOneClick || action.cost.some((cost: any) => cost.promptsPlayer) || targetPrompts) {
                this.resolveAbility(action.createContext(player));
                return true;
            }
        }
        this.game.promptWithHandlerMenu(player, {
            activePromptTitle: (card.location === Locations.PlayArea ? 'Choose an ability:' : 'Play ' + card.name + ':'),
            source: card,
            choices: legalActions.map((action: any) => action.title).concat('Cancel'),
            handlers: legalActions.map((action: any) => (() => this.resolveAbility(action.createContext(player)))).concat(() => true)
        });
        return true;
    }

    // Shared by the bot controller when it builds the public legal-click set.
    // Keeping this check beside onCardClicked prevents policy scoring/counting
    // cards that the live action window would reject (wrong timing, no legal
    // target, or unaffordable after current reducers/cost increases).
    canClickCard(player: Player, card: any): boolean {
        return this.getLegalActions(player, card).length > 0;
    }

    // Strategy may care which controller owns a legal target, while engine
    // legality only cares that some target exists. Inspect the same live
    // selectors used by the actual click without leaking card-specific state
    // into public summaries.
    canClickCardForTargetSide(player: Player, card: any, side: 'self' | 'enemy'): boolean {
        return this.getLegalActions(player, card).some((action: any) => {
            const context = action.createContext(player);
            let inspectedCardTarget = false;
            for(const target of action.targets || []) {
                if(typeof target?.getAllLegalTargets !== 'function') {
                    continue;
                }
                let legalTargets: any[];
                try {
                    legalTargets = target.getAllLegalTargets(context) || [];
                } catch{
                    // Dynamic/dependent selectors may need earlier choices;
                    // they cannot safely veto an otherwise legal action here.
                    continue;
                }
                const cards = legalTargets.filter((candidate: any) => candidate?.controller);
                if(cards.length === 0) {
                    continue;
                }
                inspectedCardTarget = true;
                if(cards.some((candidate: any) => side === 'self'
                    ? candidate.controller === player
                    : candidate.controller === player.opponent)) {
                    return true;
                }
            }
            // Ring/menu/ability targets cannot be classified by controller.
            return !inspectedCardTarget;
        });
    }

    private getLegalActions(player: Player, card: any): any[] {
        if(player !== this.currentPlayer || !card || typeof card.getActions !== 'function') {
            return [];
        }
        return card.getActions()
            .filter((action: any) => action.meetsRequirements(action.createContext(player)) === '');
    }

    resolveAbility(context: any) {
        const resolver = this.game.resolveAbility(context);
        this.game.queueSimpleStep(() => {
            if(resolver.passPriority) {
                this.postResolutionUpdate(resolver);
            }
        });
    }

    postResolutionUpdate(_resolver: any) {
        this.currentPlayerConsecutiveActions += 1;
        this.prevPlayerPassed = false;
        let allowableConsecutiveActions = this.getCurrentPlayerConsecutiveActions();

        if(this.currentPlayerConsecutiveActions > allowableConsecutiveActions) {
            this.markBonusActionsTaken();
            this.nextPlayer();
        }
    }

    continue() {
        if(this.currentPlayer.opponent) {
            if(this.currentPlayer.opponent.actionPhasePriority && this.currentPlayer.actionPhasePriority) {
                // Both players have action phase priority, don't do anything, it'll clear on its own
            } else if(this.currentPlayer.opponent.actionPhasePriority && !this.currentPlayer.actionPhasePriority) {
                this.currentPlayer = this.currentPlayer.opponent;
            } else if(this.currentPlayer.isDefendingPlayer()) {
                this.currentPlayer.actionPhasePriority = false;
            }
        } else {
            this.currentPlayer.actionPhasePriority = false;
        }

        if(!this.currentPlayer.promptedActionWindows[this.windowName]) {
            this.pass();
        }

        let completed = super.continue();

        if(!completed) {
            this.game.currentActionWindow = this;
        } else {
            this.game.currentActionWindow = null;
        }
        return completed;
    }

    activePrompt() {
        let buttons: Array<{ text: string; arg: string }> = [
            { text: 'Pass', arg: 'pass' }
        ];
        if(this.game.manualMode) {
            buttons.unshift({ text: 'Manual Action', arg: 'manual'});
        }
        return {
            menuTitle: 'Initiate an action',
            buttons: buttons,
            promptTitle: this.title
        };
    }

    waitingPrompt() {
        return { menuTitle: 'Waiting for opponent to take an action or pass' };
    }

    menuCommand(player: Player, choice: string) {
        if(choice === 'manual') {
            this.game.promptForSelect(this.currentPlayer, {
                source: 'Manual Action',
                activePrompt: 'Which ability are you using?',
                location: Locations.Any,
                controller: Players.Self,
                cardCondition: (card: any) => card.isFaceup(),
                onSelect: (player: Player, card: any) => {
                    this.game.addMessage('{0} uses {1}\'s ability', player, card);
                    this.prevPlayerPassed = false;
                    this.nextPlayer();
                    return true;
                }
            });
            return true;
        }

        if(choice === 'pass') {
            this.pass();
            return true;
        }
    }

    getCurrentPlayerConsecutiveActions(): number {
        let allowableConsecutiveActions = this.currentPlayer.sumEffects(EffectNames.AdditionalAction);
        if(this.bonusActions) {
            const bonusActions = this.bonusActions[this.currentPlayer.uuid];
            if(!bonusActions.actionsTaken && bonusActions.takingActions && bonusActions.actionCount > 0) {
                allowableConsecutiveActions = allowableConsecutiveActions + (bonusActions?.actionCount - 1);
            }
        }
        if(this.currentPlayer.actionPhasePriority) {
            if(allowableConsecutiveActions > 0) {
                allowableConsecutiveActions--;
            }
        }
        return allowableConsecutiveActions;
    }

    markBonusActionsTaken() {
        if(this.bonusActions) {
            this.bonusActions[this.currentPlayer.uuid].actionsTaken = true;
            this.bonusActions[this.currentPlayer.uuid].takingActions = false;
        }
    }

    pass() {
        this.game.addMessage('{0} passes', this.currentPlayer);

        if(this.prevPlayerPassed || !this.currentPlayer.opponent) {
            this.attemptComplete();
            return;
        }

        this.currentPlayerConsecutiveActions += 1;
        let allowableConsecutiveActions = this.getCurrentPlayerConsecutiveActions();

        if(this.currentPlayerConsecutiveActions > allowableConsecutiveActions) {
            this.markBonusActionsTaken();
            this.prevPlayerPassed = true;
            this.nextPlayer();
        }
    }

    attemptComplete() {
        if(!this.currentPlayer.opponent) {
            this.complete();
        }

        if(!this.checkBonusActions()) {
            this.complete();
        }
    }

    checkBonusActions(): boolean {
        if(!this.bonusActions) {
            if(!this.setupBonusActions()) {
                return false;
            }
        }

        const player1 = this.game.getFirstPlayer();
        const player2 = player1.opponent;

        const bonusActions = this.bonusActions;
        if(!bonusActions) {
            return false;
        }
        const p1 = bonusActions[player1.uuid];
        const p2 = bonusActions[player2.uuid];

        if(p1.actionCount > 0) {
            if(!p1.actionsTaken) {
                this.game.addMessage('{0} has a bonus action during resolution!', player1);
                this.prevPlayerPassed = false;
                // Set the current player to player1
                if(this.currentPlayer !== player1) {
                    this.currentPlayer = player1;
                }
                p1.takingActions = true;
                return true;
            }
        }
        if(p2.actionCount > 0) {
            if(!p2.actionsTaken) {
                this.game.addMessage('{0} has a bonus action during resolution!', player2);
                this.prevPlayerPassed = false;
                // Set the current player to player1
                if(this.currentPlayer !== player2) {
                    this.currentPlayer = player2;
                }
                p2.takingActions = true;
                return true;
            }
        }

        return false;
    }

    setupBonusActions(): boolean {
        const player1 = this.game.getFirstPlayer();
        const player2 = player1.opponent;
        let p1ActionsPostWindow = player1.sumEffects(EffectNames.AdditionalActionAfterWindowCompleted);
        let p2ActionsPostWindow = player2.sumEffects(EffectNames.AdditionalActionAfterWindowCompleted);

        this.bonusActions = {
            [player1.uuid]: {
                actionCount: p1ActionsPostWindow,
                actionsTaken: false,
                takingActions: false
            },
            [player2.uuid]: {
                actionCount: p2ActionsPostWindow,
                actionsTaken: false,
                takingActions: false
            }
        };

        return p1ActionsPostWindow + p2ActionsPostWindow > 0;
    }

    teardownBonusActions() {
        this.bonusActions = undefined;
    }

    complete() {
        this.teardownBonusActions();
        super.complete();
    }

    nextPlayer() {
        let otherPlayer = this.game.getOtherPlayer(this.currentPlayer);

        this.currentPlayer.actionPhasePriority = false;

        if(this.currentPlayer.anyEffect(EffectNames.ResolveConflictEarly) || this.bonusActions) {
            this.attemptComplete();
            return;
        }

        if(otherPlayer) {
            this.game.raiseEvent(
                EventNames.OnPassActionPhasePriority,
                { player: this.currentPlayer, consecutiveActions: this.currentPlayerConsecutiveActions, actionWindow: this },
                () => {
                    this.currentPlayer = otherPlayer;
                    this.opportunityCounter += 1;
                    this.currentPlayerConsecutiveActions = 0;
                }
            );
        }
    }
}

export = ActionWindow;
