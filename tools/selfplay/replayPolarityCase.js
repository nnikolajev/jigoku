'use strict';
// Re-plays ONE self-play game from an auditEffectPolarity label and dumps the
// bot's view at every decision whose prompt matches a filter, so a wrong-side
// landing can be traced to the branch and the inputs that produced it.
//
//   CASE='92001|Crane|Unicorn' MATCH='Kakita Yoshi' node tools/selfplay/replayPolarityCase.js
//
//   CASE=<base|DeckA|DeckB>  the label auditEffectPolarity printed
//   MATCH=<substring>        case-insensitive match on promptTitle or menuTitle
//   SEAT=0|1                 only log this seat (default both)
process.env.LOG_LEVEL = 'error';
const { runGame } = require('./harness.js');
const { DECK_LABELS, getDeckLoader } = require('./deckRegistry.js');
const { EffectPolarityMonitor, formatViolations } = require('../../test/helpers/effectpolarity.js');

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const [baseText, A, B] = String(process.env.CASE || '').split('|');
if(!baseText || !A || !B) {
    throw new Error('CASE must look like 92001|Crane|Unicorn');
}
const MATCH = String(process.env.MATCH || '').toLowerCase();
const SEAT = process.env.SEAT === undefined ? null : Number(process.env.SEAT);
const base = Number(baseText);
const i = DECK_LABELS.indexOf(A);
const j = DECK_LABELS.indexOf(B);
if(i < 0 || j < 0) {
    throw new Error(`unknown deck in CASE: ${A} / ${B}`);
}

const brief = (card) => `${card.name}${card.bowed ? ' [bowed]' : ''}` +
    `${card.isHonored ? ' [honored]' : ''}${card.isDishonored ? ' [dishonored]' : ''}` +
    `${card.selectable ? ' *' : ''}`;

(async () => {
    Math.random = rng(base + (i * 100 + j) * 97);
    let monitor = null;
    await runGame({
        names: ['Seat0', 'Seat1'],
        seeds: [1, 1],
        deckA: getDeckLoader(A)(),
        deckB: getDeckLoader(B)(),
        onControllers: (controllers) => {
            controllers.forEach((controller, seat) => {
                if(SEAT !== null && seat !== SEAT) {
                    return;
                }
                const engine = controller.engine;
                const original = engine.decide.bind(engine);
                engine.decide = (input) => {
                    const decision = original(input);
                    const me = Object.values(input.playerState.players || {}).find((p) => p.name === input.botName) ||
                        input.playerState.me || {};
                    const title = `${me.promptTitle || ''} | ${me.menuTitle || ''}`;
                    if(MATCH && title.toLowerCase().includes(MATCH)) {
                        console.log(`\n--- seat${seat} ${controller.config.playerName} :: ${title}`);
                        console.log(`decision: ${decision && decision.reason} -> ` +
                            `${decision && (decision.target || JSON.stringify(decision.args))}`);
                        for(const player of Object.values(input.playerState.players || {})) {
                            const inPlay = (player.cardPiles && player.cardPiles.cardsInPlay) || [];
                            console.log(`  ${player.name === input.botName ? 'MINE ' : 'THEIRS'} ` +
                                inPlay.filter((c) => c.type === 'character').map(brief).join(' | '));
                        }
                        console.log(`  buttons: ${JSON.stringify((me.buttons || []).map((b) => b.text))}`);
                    }
                    return decision;
                };
            });
        },
        onGame: (game) => {
            monitor = new EffectPolarityMonitor(game, {
                label: `${base}|${A}|${B}`,
                seats: { Seat0: { deck: A }, Seat1: { deck: B } }
            });
        }
    });
    monitor.detach();
    console.log(`\n=== violations (${monitor.violations.length})`);
    console.log(formatViolations(monitor.violations));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
