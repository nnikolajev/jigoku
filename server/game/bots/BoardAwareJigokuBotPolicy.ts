import FateAwareJigokuBotPolicy from './FateAwareJigokuBotPolicy.js';

// Seed 4 is seed 1 plus board/game-state-aware dynasty development. Hidden
// information remains unavailable; only seed 3 is omniscient.
class BoardAwareJigokuBotPolicy extends FateAwareJigokuBotPolicy {
    protected usesBoardAwareDynastyEconomy(): boolean {
        return true;
    }
}

export = BoardAwareJigokuBotPolicy;
