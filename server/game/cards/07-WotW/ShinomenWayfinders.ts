import DrawCard from '../../drawcard';
import { Locations, Players } from '../../Constants';
import AbilityDsl from '../../abilitydsl';

class ShinomenWayfinders extends DrawCard {
    static id = 'shinomen-wayfinders';

    setupCardAbilities() {
        this.persistentEffect({
            location: Locations.Any,
            targetController: Players.Any,
            effect: AbilityDsl.effects.reduceCost({
                amount: (card, player) => {
                    const conflict = player.game.currentConflict;
                    if(!conflict) {
                        return 0;
                    }
                    // Exact participant count includes ParticipatesFromHome
                    // (Iuchi Soulweaver) and virtual extra bodies (Shiksha
                    // Scout). Remove only physical non-Unicorn participants.
                    const nonUnicorn = conflict.getCharacters(player)
                        .filter(participant => !participant.isFaction('unicorn')).length;
                    return Math.max(Number(conflict.getNumberOfParticipantsFor(player)) - nonUnicorn, 0);
                },
                match: (card, source) => card === source
            })
        });
    }
}


export default ShinomenWayfinders;
