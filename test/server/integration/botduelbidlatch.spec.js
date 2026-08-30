'use strict';

// `HonorBidPrompt` returns ONE `promptTitle` — 'Honor Bid' — for the draw-phase
// bid and for a duel bid; only `menuTitle` differs. `JigokuBotPolicy` treats
// that title as the ROUND BOUNDARY and clears its per-round latches there, so a
// duel runs that reset in the MIDDLE of a conflict.
//
// For Agasha Shunsen the latch is `boardAbilityUsed`, which stops the bot
// re-proposing an Action it has already spent. The ENGINE is the real authority
// — a card Action is once per round regardless of what the bot believes — so a
// cleared latch cannot make the ability fire twice. The question this spec
// exists to answer is the one that remains: does the bot WASTE CLICKS on it,
// and can that stall the seat?
//
// Real engine, real duel prompt, real controller. Every command the bot issues
// is recorded with whether the engine accepted it.

const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const HonorBidPrompt = require('../../../build/server/game/gamesteps/honorbidprompt.js').default;

describe('bot per-round latches across a duel honor bid', function() {
    integration(function() {
        beforeEach(function() {
            this.setupTest({
                phase: 'conflict',
                player1: {
                    faction: 'dragon',
                    stronghold: 'iron-mountain-castle',
                    fate: 10,
                    inPlay: ['agasha-shunsen', 'niten-master'],
                    conflictDeck: ['self-understanding', 'jade-tetsubo', 'ornate-fan',
                        'fine-katana', 'adopted-kin']
                },
                player2: {
                    inPlay: ['doji-whisperer']
                }
            });
            this.shunsen = this.player1.findCardByName('agasha-shunsen');
            this.niten = this.player1.findCardByName('niten-master');

            // Record every command the bot issues and whether the engine took it.
            this.commands = [];
            this.bot = new JigokuBotController(
                this.game,
                { playerName: this.player1.player.name, seed: 1, maxDecisionsPerTick: 1 },
                (command, playerName, args) => {
                    const accepted = this.game[command](playerName, ...args) !== false;
                    this.commands.push({ command, args, accepted });
                    return accepted;
                }
            );
            this.runBot = (ticks = 40) => {
                for(let i = 0; i < ticks; i++) {
                    if(this.bot.tick() === false) {
                        return;
                    }
                    this.game.continue();
                }
            };
            // Clicks aimed at Shunsen's own card, which is how the Action is
            // activated.
            this.shunsenClicks = () => this.commands.filter((entry) =>
                entry.command === 'cardClicked' && entry.args.includes(this.shunsen.uuid));

            // The board the Action needs: a tower standing, two rings claimed,
            // and one conflict opportunity left.
            this.player1.claimRing('air');
            this.player1.claimRing('fire');
            this.niten.fate = 2;
            this.shunsen.fate = 1;
            this.noMoreActions();
            this.initiateConflict({
                attackers: [this.niten],
                defenders: [],
                type: 'military',
                ring: 'water'
            });
            this.game.continue();
            this.player2.pass();
            this.game.continue();
        });

        it('spends the Action once, and a duel bid does not let it be spent again', function() {
            const action = this.shunsen.abilities.actions[0];
            expect(action.meetsRequirements(action.createContext(this.player1Object))).toBe('');

            this.runBot(40);
            const tutorable = ['self-understanding', 'jade-tetsubo', 'ornate-fan',
                'fine-katana', 'adopted-kin'];
            const attachedAfterFirst = this.player1Object.cardsInPlay.toArray()
                .flatMap((bearer) => (bearer.attachments || []).toArray
                    ? bearer.attachments.toArray()
                    : (bearer.attachments || []))
                .filter((attachment) => tutorable.includes(attachment.id));
            expect(attachedAfterFirst.length).toBeGreaterThan(0);

            // The engine now refuses the Action for the rest of the round.
            expect(action.meetsRequirements(action.createContext(this.player1Object)))
                .not.toBe('');

            const clicksBeforeDuel = this.shunsenClicks().length;
            const rejectedBeforeDuel = this.commands.filter((entry) => !entry.accepted).length;

            // A duel, mid-conflict: the exact prompt `DuelFlow` opens, and the
            // one that shares its title with the draw-phase bid.
            this.game.queueStep(new HonorBidPrompt(this.game, 'Choose your bid for the duel'));
            this.game.continue();
            this.runBot(40);

            // The ability itself cannot come back: the engine owns that.
            const attachedAfterDuel = this.player1Object.cardsInPlay.toArray()
                .flatMap((bearer) => (bearer.attachments || []).toArray
                    ? bearer.attachments.toArray()
                    : (bearer.attachments || []))
                .filter((attachment) => tutorable.includes(attachment.id));
            expect(attachedAfterDuel.length).toBe(attachedAfterFirst.length);

            // And the bot does not burn clicks rediscovering that. This is the
            // assertion that would catch the cleared latch turning into wasted
            // decisions or a stalled seat.
            expect(this.shunsenClicks().length).toBe(clicksBeforeDuel);
            expect(this.commands.filter((entry) => !entry.accepted).length)
                .toBe(rejectedBeforeDuel);
        });

        it('never lets the engine accept the Action twice in one round', function() {
            this.runBot(40);
            this.game.queueStep(new HonorBidPrompt(this.game, 'Choose your bid for the duel'));
            this.game.continue();
            this.runBot(40);

            // Whatever the bot believes, the engine is the authority on a
            // once-per-round card Action.
            const action = this.shunsen.abilities.actions[0];
            expect(action.meetsRequirements(action.createContext(this.player1Object)))
                .not.toBe('');
        });
    });
});
