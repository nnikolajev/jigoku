const { CraneHonorTactics, CRANE_HONOR_DEFAULTS } = require('../../../build/server/game/bots/CraneHonorTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the Crane "Courtier Honor" layer (Seven Fold Palace): strategy
// derivation, the gating that keeps the two other Crane lists untouched, and
// each tactic decision.
describe('CraneHonorTactics', function() {
    const tactics = new CraneHonorTactics(CRANE_HONOR_DEFAULTS);

    describe('strategy derivation', function() {
        it('flips craneHonor on for the Seven Fold Palace stronghold', function() {
            expect(deriveDeckStrategy(['seven-fold-palace']).craneHonor).toBe(true);
        });

        it('stays off for the other Crane lists, which share Tsuma', function() {
            expect(deriveDeckStrategy(['tsuma', 'kyuden-kakita']).craneHonor).toBe(false);
            expect(deriveDeckStrategy(['tsuma', 'vassal-fields']).craneHonor).toBe(false);
            expect(deriveDeckStrategy([]).craneHonor).toBe(false);
        });

        it('still derives duelist through Tsuma, which the profile then layers over', function() {
            const strategy = deriveDeckStrategy(['seven-fold-palace', 'tsuma']);
            expect(strategy.duelist).toBe(true);
            expect(strategy.craneHonor).toBe(true);
        });
    });

    describe('profile gating', function() {
        it('only a craneHonor strategy carries the knobs', function() {
            expect(profileFromStrategy({ craneHonor: true }).craneHonor).toBeDefined();
            expect(profileFromStrategy({ duelist: true }).craneHonor).toBeUndefined();
            expect(profileFromStrategy({}).craneHonor).toBeUndefined();
        });

        it('overrides the duel economy that Tsuma would otherwise impose', function() {
            const duelOnly = profileFromStrategy({ duelist: true });
            const honor = profileFromStrategy({ duelist: true, craneHonor: true });
            // The duel package banks fate on a tower; the honor race buys width.
            expect(duelOnly.fateAwareEconomy.durableCostThreshold).toBe(0);
            expect(honor.fateAwareEconomy.durableCostThreshold).toBe(4);
            expect(honor.imperialFavorChoice).toBe('political');
            expect(honor.strongholdProvinceId).toBe('shameful-display');
            expect(honor.mulligan.honorProvinceCharacters).toBe(true);
            expect(honor.honorRaceAware).toBe(true);
            // Honor is the scoreboard: never pay the opponent the difference.
            expect(honor.drawBidding.minimumRoutineBid).toBe(1);
            // A conceded province walks the opponent toward conquest, and this
            // deck needs the game to run long.
            expect(honor.provinceConcede.cardIds).toEqual([]);
        });

        it('leaves every other deck profile untouched', function() {
            for(const flag of ['aggressive', 'dishonor', 'glory', 'monk', 'lionDuelist', 'crabSacrifice']) {
                expect(profileFromStrategy({ [flag]: true }).craneHonor).toBeUndefined();
            }
        });
    });

    describe('ring steering', function() {
        it('lifts air above the generic earth/void ordering, and fire second', function() {
            expect(tactics.ringBonus('air', 10)).toBe(CRANE_HONOR_DEFAULTS.airRingBonus);
            expect(tactics.ringBonus('fire', 10)).toBe(CRANE_HONOR_DEFAULTS.fireRingBonus);
            expect(tactics.ringBonus('void', 10)).toBe(0);
            expect(tactics.ringBonus('earth', 10)).toBe(0);
        });

        it('adds the close-race bonus to air once the win is in reach', function() {
            const close = CRANE_HONOR_DEFAULTS.honorWinCloseThreshold;
            expect(tactics.ringBonus('air', close - 1)).toBe(CRANE_HONOR_DEFAULTS.airRingBonus);
            expect(tactics.ringBonus('air', close))
                .toBe(CRANE_HONOR_DEFAULTS.airRingBonus + CRANE_HONOR_DEFAULTS.airRingCloseBonus);
            // Fire does not scale with the race — it is a body pump.
            expect(tactics.ringBonus('fire', close)).toBe(CRANE_HONOR_DEFAULTS.fireRingBonus);
        });
    });

    describe('conflict axis', function() {
        it('nudges political, and further with a ready Kakita Asami', function() {
            expect(tactics.politicalAxisBonus([])).toBe(CRANE_HONOR_DEFAULTS.politicalAxisBonus);
            expect(tactics.politicalAxisBonus([{ id: 'kakita-asami', bowed: false }]))
                .toBe(CRANE_HONOR_DEFAULTS.politicalAxisBonus + CRANE_HONOR_DEFAULTS.asamiAxisBonus);
            expect(tactics.politicalAxisBonus([{ id: 'kakita-asami', bowed: true }]))
                .toBe(CRANE_HONOR_DEFAULTS.politicalAxisBonus);
        });
    });

    describe('fate investment', function() {
        it('funds only the tower and the two military bodies', function() {
            expect(tactics.desiredAdditionalFate('doji-hotaru-2')).toBe(3);
            expect(tactics.desiredAdditionalFate('hantei-sotorii')).toBe(2);
            expect(tactics.desiredAdditionalFate('iron-crane-legion')).toBe(2);
        });

        it('leaves every cheap Courtier naked — its job is to be honored and die', function() {
            for(const id of ['doji-diplomat', 'callow-delegate', 'chancellor-s-aide', 'brash-samurai']) {
                expect(tactics.desiredAdditionalFate(id)).toBe(0);
            }
        });

        it('returns null for a card it does not price, so the shared economy answers', function() {
            expect(tactics.desiredAdditionalFate('moto-chagatai')).toBeNull();
            expect(tactics.desiredAdditionalFate(undefined)).toBeNull();
        });
    });

    describe('honor targeting', function() {
        const asami = { id: 'kakita-asami', uuid: 'a', glory: 2, political: 3 };
        const diplomat = { id: 'doji-diplomat', uuid: 'b', glory: 1, political: 1 };
        const storyteller = { id: 'asahina-storyteller', uuid: 'c', glory: 2, political: 4 };

        it('follows the deck priority, not raw glory', function() {
            // Storyteller has the higher political skill; Asami outranks it
            // because her Action drains an honor every political conflict.
            expect(tactics.pickHonorTarget([storyteller, diplomat, asami]).id).toBe('kakita-asami');
        });

        it('skips characters that are already honored', function() {
            expect(tactics.pickHonorTarget([{ ...asami, isHonored: true }, storyteller]).id)
                .toBe('asahina-storyteller');
        });

        it('falls back to the honored pool when everything is honored', function() {
            const all = [{ ...asami, isHonored: true }, { ...diplomat, isHonored: true }];
            expect(tactics.pickHonorTarget(all).id).toBe('kakita-asami');
        });

        it('returns null with no characters', function() {
            expect(tactics.pickHonorTarget([])).toBeNull();
        });

        it('prefers a ready PARTICIPANT over a higher-ranked body that cannot use the token', function() {
            // Seen live: the bot honored a bowed Asami sitting at home while a
            // ready Brash Samurai was defending, and the defender's skill did
            // not move. A bowed character contributes no skill, and neither
            // does one at home, so the glory only converts on a ready
            // participant while a conflict is live.
            const bowedAsami = { ...asami, bowed: true, inConflict: false };
            const readyBrash = { id: 'brash-samurai', uuid: 'd', glory: 1, political: 2, inConflict: true };
            expect(tactics.pickHonorTarget([bowedAsami, readyBrash], { activeConflict: true }).id)
                .toBe('brash-samurai');
            // Outside a conflict no body is live, so the printed priority wins.
            expect(tactics.pickHonorTarget([bowedAsami, readyBrash], { activeConflict: false }).id)
                .toBe('kakita-asami');
            // And the default (no options) keeps the priority ordering too.
            expect(tactics.pickHonorTarget([bowedAsami, readyBrash]).id).toBe('kakita-asami');
        });

        it('sends a DOUBLE honor (Soul Beyond Reproach) at a dishonored body', function() {
            // Honor twice on a plain character wastes the second half; on a
            // dishonored one it is dishonored -> plain -> honored.
            const dishonored = { id: 'doji-diplomat', uuid: 'e', glory: 1, political: 1, isDishonored: true };
            expect(tactics.pickHonorTarget([asami, dishonored], { doubleHonor: true }).id)
                .toBe('doji-diplomat');
            expect(tactics.pickHonorTarget([asami, dishonored]).id).toBe('kakita-asami');
        });
    });

    describe('Elegance and Grace', function() {
        it('only spends the card when a ready body still has something to do', function() {
            // Seen live: two characters readied after the last conflict of the
            // round had already resolved. This gate was generalised into
            // `ReadyValuePolicy` once the same waste turned up on Against the
            // Waves; the counts-only fallback below is what a context with no
            // published policy reading still gets.
            const gate = getPlaybookEntry('elegance-and-grace').shouldPlay;
            const home = [{ bowed: true, isHonored: true, inConflict: false }];
            const participant = [{ bowed: true, isHonored: true, inConflict: true }];
            const spent = { conflictsRemaining: 0, opponentConflictsRemaining: 0 };
            // A bowed PARTICIPANT contributes no skill until it readies.
            expect(gate({ ...spent, myCharacters: participant })).toBe(true);
            // A body at home is worth readying for a conflict either side has left.
            expect(gate({ ...spent, conflictsRemaining: 1, myCharacters: home })).toBe(true);
            expect(gate({ ...spent, opponentConflictsRemaining: 1, myCharacters: home })).toBe(true);
            // Nothing left to fight: the ready is cosmetic.
            expect(gate({ ...spent, myCharacters: home })).toBe(false);
            expect(gate({ ...spent, myCharacters: [] })).toBe(false);
        });

        it('defers to the published ReadyValuePolicy reading when there is one', function() {
            // `homeReadyIsUseful` is the policy's answer and outranks the raw
            // counts: it also knows about move-into-conflict effects and the
            // Imperial Favor exception, neither of which the counts can see.
            const gate = getPlaybookEntry('elegance-and-grace').shouldPlay;
            const home = [{ bowed: true, isHonored: true, inConflict: false }];
            expect(gate({
                conflictsRemaining: 2, opponentConflictsRemaining: 2,
                homeReadyIsUseful: false, myCharacters: home
            })).toBe(false);
            expect(gate({
                conflictsRemaining: 0, opponentConflictsRemaining: 0,
                homeReadyIsUseful: true, myCharacters: home
            })).toBe(true);
        });

        it('keeps the per-deck legacy escape working', function() {
            const gate = getPlaybookEntry('elegance-and-grace').shouldPlay;
            const home = [{ bowed: true, isHonored: true, inConflict: false }];
            expect(gate({
                conflictsRemaining: 0, opponentConflictsRemaining: 0,
                homeReadyIsUseful: false, eleganceRequiresUse: false, myCharacters: home
            })).toBe(true);
        });
    });

    describe('Way of the Chrysanthemum', function() {
        const hand = [{ id: 'way-of-the-chrysanthemum' }];

        it('bids the floor while a castable copy is held', function() {
            expect(tactics.adjustDrawBid(hand, 2)).toBe(CRANE_HONOR_DEFAULTS.chrysanthemumBid);
        });

        it('leaves the shared bid alone without a copy or without the fate', function() {
            expect(tactics.adjustDrawBid([], 5)).toBeNull();
            expect(tactics.adjustDrawBid(hand, 1)).toBeNull();
        });

        it('reserves the fate through the dynasty phase', function() {
            expect(tactics.desiredDynastyFateReserve(hand))
                .toBe(CRANE_HONOR_DEFAULTS.chrysanthemumReserveFate);
            expect(tactics.desiredDynastyFateReserve([])).toBe(0);
        });
    });

    describe('Benevolent Host', function() {
        const asami = { id: 'kakita-asami', uuid: 'a', location: 'province 1', political: 3 };
        const hotaru = { id: 'doji-hotaru-2', uuid: 'b', location: 'province 2', political: 6 };

        it('skips the tower — it is worth more bought with fate on it', function() {
            expect(tactics.pickHostTarget([asami, hotaru], { myHonor: 10 }).id).toBe('kakita-asami');
        });

        it('takes the tower once the race is nearly over', function() {
            expect(tactics.pickHostTarget([hotaru], {
                myHonor: CRANE_HONOR_DEFAULTS.honorWinCloseThreshold
            }).id).toBe('doji-hotaru-2');
        });

        it('takes the tower out of a broken province — it is discarded anyway', function() {
            expect(tactics.pickHostTarget([hotaru], {
                myHonor: 10,
                brokenProvinceLocations: ['province 2']
            }).id).toBe('doji-hotaru-2');
        });

        it('returns null with nothing offered', function() {
            expect(tactics.pickHostTarget([], { myHonor: 10 })).toBeNull();
        });
    });

    describe('honored-token saves', function() {
        it('recognises both save sources', function() {
            expect(tactics.isSaveSource('pledge-of-loyalty')).toBe(true);
            expect(tactics.isSaveSource('stand-your-ground')).toBe(true);
            expect(tactics.isSaveSource('way-of-the-crane')).toBe(false);
        });

        it('refuses a chump: the token is 1 honor on the way out', function() {
            expect(tactics.shouldSaveHonoredCharacter({
                isHonored: true, fate: 0, political: 1, military: 0
            })).toBe(false);
        });

        it('saves a body carrying fate, or one big enough to be worth the token', function() {
            expect(tactics.shouldSaveHonoredCharacter({
                isHonored: true, fate: 1, political: 1
            })).toBe(true);
            expect(tactics.shouldSaveHonoredCharacter({
                isHonored: true, fate: 0, political: 6
            })).toBe(true);
        });

        it('never saves an unhonored character — there is no token to discard', function() {
            expect(tactics.shouldSaveHonoredCharacter({ isHonored: false, fate: 3 })).toBe(false);
            expect(tactics.pickSaveTarget([{ isHonored: false, fate: 3, uuid: 'a' }])).toBeNull();
        });
    });

    describe('Try Again Tomorrow', function() {
        it('takes the biggest attacker on the live axis', function() {
            const attackers = [
                { uuid: 'a', inConflict: true, political: 5 },
                { uuid: 'b', inConflict: true, political: 3 }
            ];
            expect(tactics.pickMoveHomeTarget(attackers, 'political').uuid).toBe('a');
        });

        it('declines below the worth-a-card threshold', function() {
            expect(tactics.pickMoveHomeTarget([
                { uuid: 'a', inConflict: true, political: 1 }
            ], 'political')).toBeNull();
        });

        it('ignores bowed attackers — they already contribute nothing', function() {
            expect(tactics.pickMoveHomeTarget([
                { uuid: 'a', inConflict: true, bowed: true, political: 6 }
            ], 'political')).toBeNull();
        });
    });

    describe('dynasty buying', function() {
        const costs = { asami: 3, diplomat: 0, hotaru: 5 };
        const asami = { id: 'kakita-asami', uuid: 'asami', type: 'character', political: 3, glory: 2 };
        const diplomat = { id: 'doji-diplomat', uuid: 'diplomat', type: 'character', political: 1, glory: 1 };
        const hotaru = { id: 'doji-hotaru-2', uuid: 'hotaru', type: 'character', political: 6, glory: 3 };

        // The window calls this repeatedly, so the ranking is an ORDER, not a
        // choice: buy what the current fate can just afford, then fill with the
        // free bodies that stay affordable on every later call.
        it('spends the affordable fate on the best faucet first', function() {
            expect(tactics.pickDynastyCharacter({
                playable: [asami, diplomat], costs, fate: 5, board: []
            }).id).toBe('kakita-asami');
        });

        it('then takes the free Courtier once the fate is gone', function() {
            expect(tactics.pickDynastyCharacter({
                playable: [asami, diplomat], costs, fate: 0, board: []
            }).id).toBe('doji-diplomat');
        });

        it('weights cheap width: a 0-cost body outranks a costlier one of equal value', function() {
            const costly = { id: 'doji-diplomat', uuid: 'costly', type: 'character', political: 1, glory: 1 };
            const pick = tactics.pickDynastyCharacter({
                playable: [costly, diplomat],
                costs: { costly: 3, diplomat: 0 },
                fate: 5,
                board: []
            });
            expect(pick.uuid).toBe('diplomat');
        });

        it('takes the tower only with enough fate to decorate it', function() {
            expect(tactics.pickDynastyCharacter({
                playable: [hotaru, diplomat], costs, fate: CRANE_HONOR_DEFAULTS.towerMinimumTotalFate, board: []
            }).id).toBe('doji-hotaru-2');
            expect(tactics.pickDynastyCharacter({
                playable: [hotaru, diplomat], costs, fate: 5, board: []
            }).id).toBe('doji-diplomat');
        });

        it('never buys a second tower, and never a naked one', function() {
            // Already on the board: the tower is dropped from the ranking too,
            // or its raw value wins the sort and buys the second copy anyway.
            expect(tactics.pickDynastyCharacter({
                playable: [hotaru, diplomat], costs, fate: 9, board: [{ id: 'doji-hotaru-2' }]
            }).id).toBe('doji-diplomat');
            // Below the fate threshold, with nothing else offered, pass rather
            // than field a 5-cost body that dies at the next fate phase.
            expect(tactics.pickDynastyCharacter({
                playable: [hotaru], costs, fate: 5, board: []
            })).toBeNull();
        });

        it('passes once the board is wide enough, or the budget is gone', function() {
            const board = Array.from(
                { length: CRANE_HONOR_DEFAULTS.maximumBoardCharacters },
                (_, i) => ({ uuid: `b${i}` })
            );
            expect(tactics.pickDynastyCharacter({ playable: [diplomat], costs, fate: 9, board })).toBeNull();
            expect(tactics.pickDynastyCharacter({
                playable: [asami], costs, fate: 2, board: []
            })).toBeNull();
        });

        it('still buys a 0-cost body at 0 fate — zero is a real budget', function() {
            expect(tactics.pickDynastyCharacter({
                playable: [diplomat], costs, fate: 0, board: []
            }).id).toBe('doji-diplomat');
        });

        it('honours the Chrysanthemum fate reserve', function() {
            expect(tactics.pickDynastyCharacter({
                playable: [asami], costs, fate: 4, board: [], reserve: 2
            })).toBeNull();
            // ...but the reserve still leaves the free bodies buyable.
            expect(tactics.pickDynastyCharacter({
                playable: [asami, diplomat], costs, fate: 2, board: [], reserve: 2
            }).id).toBe('doji-diplomat');
        });
    });

    describe('playbook entries', function() {
        it('gates Bonsai Garden on an AIR conflict, not an air province', function() {
            const gate = getPlaybookEntry('bonsai-garden').shouldUseAction;
            expect(gate({ conflictRingElements: ['air'] })).toBe(true);
            expect(gate({ conflictRingElements: ['fire'] })).toBe(false);
            expect(gate({})).toBe(false);
        });

        it('fires Kakita Asami only while ahead on the political count', function() {
            const gate = getPlaybookEntry('kakita-asami').shouldUseAction;
            const asami = { id: 'kakita-asami', inConflict: true, political: 3 };
            expect(gate({
                conflictType: 'political',
                myCharacters: [asami],
                opponentCharacters: [{ inConflict: true, political: 1 }]
            })).toBe(true);
            expect(gate({
                conflictType: 'political',
                myCharacters: [asami],
                opponentCharacters: [{ inConflict: true, political: 5 }]
            })).toBe(false);
            expect(gate({
                conflictType: 'military',
                myCharacters: [asami],
                opponentCharacters: []
            })).toBe(false);
        });

        it('plays For Shame only with an own participating Courtier', function() {
            const gate = getPlaybookEntry('for-shame').shouldPlay;
            const enemy = [{ inConflict: true, military: 3 }];
            expect(gate({
                myCharacters: [{ inConflict: true, traits: ['courtier'] }],
                opponentCharacters: enemy
            })).toBe(true);
            expect(gate({
                myCharacters: [{ inConflict: true, traits: ['bushi'] }],
                opponentCharacters: enemy
            })).toBe(false);
        });

        it('plays Try Again Tomorrow only on DEFENCE with an honored Courtier', function() {
            const gate = getPlaybookEntry('try-again-tomorrow').shouldPlay;
            const mine = [{ inConflict: true, isHonored: true, traits: ['courtier'] }];
            const theirs = [{ inConflict: true, military: 4 }];
            expect(gate({ amAttacker: false, myCharacters: mine, opponentCharacters: theirs })).toBe(true);
            expect(gate({ amAttacker: true, myCharacters: mine, opponentCharacters: theirs })).toBe(false);
            expect(gate({
                amAttacker: false,
                myCharacters: [{ inConflict: true, isHonored: false, traits: ['courtier'] }],
                opponentCharacters: theirs
            })).toBe(false);
        });

        it('keeps the reaction-only cards out of the ordinary play path', function() {
            for(const id of ['way-of-the-chrysanthemum', 'stand-your-ground']) {
                expect(getPlaybookEntry(id).shouldPlay()).toBe(false);
            }
        });

        it('marks the zero-stat honor cards as ability-valued so they are playable at all', function() {
            for(const id of ['honored-blade', 'bonsai-garden', 'doji-hotaru-2', 'seven-fold-palace']) {
                expect(getPlaybookEntry(id).abilityValue).toBe(true);
            }
        });
    });
});
