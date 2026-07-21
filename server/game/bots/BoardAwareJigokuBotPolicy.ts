import FateAwareJigokuBotPolicy from './FateAwareJigokuBotPolicy.js';

// Seed 3 is seed 1 plus board/game-state-aware dynasty development. Hidden
// information remains unavailable unless optional omniscient capability is
// enabled independently for this seed.
class BoardAwareJigokuBotPolicy extends FateAwareJigokuBotPolicy {
    protected usesBoardAwareDynastyEconomy(): boolean {
        return true;
    }
}

export = BoardAwareJigokuBotPolicy;
