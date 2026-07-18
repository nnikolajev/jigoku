import DrawCard from '../../drawcard';
import * as GameActions from '../../GameActions/GameActions';
import { Locations, CardTypes } from '../../Constants';

class ConsumedByFiveFires extends DrawCard {
    static id = 'consumed-by-five-fires';

    // TODO: need refactoring
    setupCardAbilities() {
        this.action({
            title: 'Remove up to 5 fate from characters',
            condition: context => context.player.cardsInPlay.any(card => card.hasTrait('shugenja')) && context.player.opponent &&
                                  context.player.opponent.cardsInPlay.any(card => card.allowGameAction('removeFate', context)),
            effect: 'remove fate from {1}\'s characters',
            effectArgs: context => context.player.opponent,
            handler: context => this.chooseCard(context, {}, [])
        });
    }

    chooseCard(context, targets, messages) {
        // @ts-expect-error targets values are dynamic runtime numbers, TS infers unknown[]
        let fateRemaining = 5 - Object.values(targets).reduce((totalFate, fateToRemove) => totalFate + fateToRemove, 0);
        if(fateRemaining === 0 || !context.player.opponent.cardsInPlay.any(card => card.allowGameAction('removeFate', context) && !Object.keys(targets).includes(card.uuid))) {
            this.game.addMessage('{0} chooses to: {1}', context.player, messages);
            let keys = Object.keys(targets);
            let events = keys.map(key => {
                let card = context.player.opponent.cardsInPlay.find(c => c.uuid === key);
                if(card) {
                    return GameActions.removeFate({ amount: targets[key]}).getEvent(card, context);
                }
            }).filter(obj => obj);
            this.game.openThenEventWindow(events);
            return;
        }
        this.game.promptForSelect(context.player, {
            context: context,
            cardType: CardTypes.Character,
            cardCondition: card => card.location === Locations.PlayArea && card.allowGameAction('removeFate', context) && card.controller !== context.player && !Object.keys(targets).includes(card.uuid),
            onSelect: (player, card) => {
                let maxFate = Math.min(fateRemaining, card.getFate());
                // Prompt labels are strings throughout the UI/controller
                // contract. Keep the selected amount numeric in `targets` so
                // the remaining-fate calculation cannot concatenate strings.
                let choices = Array.from({ length: maxFate }, (_, i) => (i + 1).toString());
                let handlers = choices.map(choice => {
                    return () => {
                        targets[card.uuid] = Number(choice);
                        messages.push('take ' + choice + ' fate from ' + card.name);
                        this.chooseCard(context, targets, messages);
                    };
                });
                choices.push('Redo');
                handlers.push(() => {
                    this.chooseCard(context, {}, []);
                });
                this.game.promptWithHandlerMenu(player, {
                    activePromptTitle: 'How much fate do you want to remove?',
                    choices: choices,
                    handlers: handlers,
                    context: context
                });
                return true;
            },
            onCancel: () => {
                this.game.addMessage('{0} chooses to: {1}', context.player, messages);
                let keys = Object.keys(targets);
                let events = this.game.applyGameAction(context, { removeFate: context.player.opponent.cardsInPlay.filter(card => keys.includes(card.uuid)) });
                // @ts-expect-error Event uses dynamic properties (fate, card) set at runtime, not in the TS type
                events.forEach(event => event.fate = targets[event.card.uuid]);
                return true;
            }
        });
    }
}


export default ConsumedByFiveFires;
