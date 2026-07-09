'use strict';

// Reward signal for self-play, per the design metric:
//  - every won conflict scores points
//  - every destroyed (opponent) province scores points
//  - destroying the stronghold is the goal (terminal military win)
//  - driving enemy honor down (toward the dishonor loss at 0) scores points,
//    weighted from 5 and below
//  - raising own honor scores points, with 20 the honor-victory goal
//
// Events are read straight off the engine's EventEmitter (onConflictFinished /
// onBreakProvince); honor and the terminal outcome are read off final state.
// Weights live here so training/tuning has one knob board.

const DEFAULT_WEIGHTS = {
    conflictWon: 1,
    provinceBroken: 3,
    strongholdBroken: 10,
    win: 25,
    loss: -25,
    // Honor shaping (applied at terminal from final honor totals).
    ownHonorAbove: 0.5, // per honor over the starting baseline
    oppHonorBelow5: 1.5, // per honor the opponent sits below 5
    honorBaseline: 10 // standard Stronghold starting honor
};

class RewardTracker {
    constructor(game, playerNames, weights = {}) {
        this.game = game;
        this.players = playerNames; // [nameA, nameB]
        this.w = Object.assign({}, DEFAULT_WEIGHTS, weights);
        this.events = {};
        for(const name of playerNames) {
            this.events[name] = { conflictsWon: 0, provincesBroken: 0, strongholdBroken: 0 };
        }
        this._onConflict = (event) => this._conflictFinished(event);
        this._onBreak = (event) => this._breakProvince(event);
        game.on('onConflictFinished', this._onConflict);
        game.on('onBreakProvince', this._onBreak);
    }

    detach() {
        this.game.removeListener('onConflictFinished', this._onConflict);
        this.game.removeListener('onBreakProvince', this._onBreak);
    }

    _conflictFinished(event) {
        const winner = event?.conflict?.winner;
        if(winner && this.events[winner.name]) {
            this.events[winner.name].conflictsWon++;
        }
    }

    _breakProvince(event) {
        const province = event?.card;
        const owner = province?.controller;
        if(!owner) {
            return;
        }
        // The attacker (the non-owner) is credited with the break.
        const attacker = this.players.find((name) => name !== owner.name);
        if(!attacker || !this.events[attacker]) {
            return;
        }
        this.events[attacker].provincesBroken++;
        const isStronghold = province.type === 'stronghold' ||
            String(province.location || '').includes('stronghold');
        if(isStronghold) {
            this.events[attacker].strongholdBroken++;
        }
    }

    // Per-player reward breakdown + total, from accumulated events + final state.
    summary() {
        const winnerName = this.game.winner ? this.game.winner.name : null;
        const out = {};
        for(const name of this.players) {
            const ev = this.events[name];
            const player = this.game.getPlayerByName(name);
            const opp = this.game.getPlayerByName(this.players.find((n) => n !== name));
            const ownHonor = player ? player.honor : this.w.honorBaseline;
            const oppHonor = opp ? opp.honor : this.w.honorBaseline;

            const parts = {
                conflictsWon: ev.conflictsWon * this.w.conflictWon,
                provincesBroken: ev.provincesBroken * this.w.provinceBroken,
                strongholdBroken: ev.strongholdBroken * this.w.strongholdBroken,
                ownHonor: Math.max(0, ownHonor - this.w.honorBaseline) * this.w.ownHonorAbove,
                oppHonor: Math.max(0, 5 - oppHonor) * this.w.oppHonorBelow5,
                terminal: winnerName === null ? 0 : (winnerName === name ? this.w.win : this.w.loss)
            };
            const total = Object.values(parts).reduce((a, b) => a + b, 0);
            out[name] = {
                counts: Object.assign({}, ev),
                ownHonor,
                oppHonor,
                parts,
                total,
                won: winnerName === name
            };
        }
        return out;
    }
}

module.exports = { RewardTracker, DEFAULT_WEIGHTS };
