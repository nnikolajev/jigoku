import AbilityDsl from '../../abilitydsl';
import { DuelTypes } from '../../Constants';
import DrawCard from '../../drawcard';
import Player from '../../player';

function participatingCharacters(player: Player): number {
    const conflict = player.game.currentConflict;
    return conflict ? Number(conflict.getNumberOfParticipantsFor(player)) : 0;
}

export default class ChallengeOnTheFields extends DrawCard {
    static id = 'challenge-on-the-fields';

    setupCardAbilities() {
        this.action({
            title: 'Initiate a military duel',
            initiateDuel: (context) => ({
                type: DuelTypes.Military,
                statistic: (card, duelRules) =>
                    duelRules === 'printedSkill'
                        ? card.printedMilitarySkill + participatingCharacters(card.controller) - 1
                        : card.getMilitarySkill(),
                challengerEffect: AbilityDsl.effects.modifyMilitarySkill(participatingCharacters(context.player) - 1),
                targetEffect: AbilityDsl.effects.modifyMilitarySkill(
                    context.player.opponent ? participatingCharacters(context.player.opponent) - 1 : 0
                ),
                gameAction: (duel) => AbilityDsl.actions.sendHome({ target: duel.loser })
            })
        });
    }
}
