import JigokuBotPolicy from './JigokuBotPolicy.js';

// Experimental copy of the generic heuristic policy. All non-economy choices
// stay inherited, while the opt-in hook enables conservative dynasty spending
// and makes any fate-bearing ring a priority target.
class FateAwareJigokuBotPolicy extends JigokuBotPolicy {
    protected usesFateAwareEconomy(): boolean {
        return true;
    }
}

export = FateAwareJigokuBotPolicy;
