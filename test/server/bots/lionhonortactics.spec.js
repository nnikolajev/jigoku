const { LionHonorTactics, LION_HONOR_DEFAULTS } = require('../../../build/server/game/bots/LionHonorTactics.js');
const {
    ConflictRecursionTactics,
    DynastyEventTactics,
    StrongholdBowTactics
} = require('../../../build/server/game/bots/SharedCardTactics.js');
const {
    deriveDeckStrategy,
    getPlaybookEntry,
    DECK_SCOPED_PLAYBOOK_ENTRIES
} = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');

// Locks the Lion "Honor" layer (Kyuden Ikoma + Kenson no Gakka): strategy
// derivation and the mutual exclusion with the Lion Duelist list that shares
// the stronghold, the shared card packages lifted out of LionDuelistTactics,
// and each tactic decision.
describe('LionHonorTactics', function() {
    const tactics = new LionHonorTactics(LION_HONOR_DEFAULTS);
    const character = (id, extra = {}) => Object.assign({
        id, uuid: id, type: 'character', military: 0, political: 0, glory: 0, fate: 0
    }, extra);

    describe('strategy derivation', function() {
        it('flips lionHonor on for Kenson no Gakka', function() {
            expect(deriveDeckStrategy(['kenson-no-gakka']).lionHonor).toBe(true);
        });

        it('is MUTUALLY EXCLUSIVE with lionDuelist, which shares the stronghold', function() {
            const honor = deriveDeckStrategy(['kyuden-ikoma', 'kenson-no-gakka']);
            expect(honor.lionHonor).toBe(true);
            expect(honor.lionDuelist).toBe(false);

            const duel = deriveDeckStrategy(['kyuden-ikoma', 'frostbitten-crossing']);
            expect(duel.lionDuelist).toBe(true);
            expect(duel.lionHonor).toBe(false);
        });

        it('leaves the Lion swarm precon and every other list alone', function() {
            expect(deriveDeckStrategy(['hayaken-no-shiro', 'manicured-garden']).lionHonor).toBe(false);
            expect(deriveDeckStrategy(['seven-fold-palace']).lionHonor).toBe(false);
            expect(deriveDeckStrategy([]).lionHonor).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('only a lionHonor strategy carries the knobs', function() {
            expect(profileFromStrategy({ lionHonor: true }).lionHonor).toBeDefined();
            expect(profileFromStrategy({ lionDuelist: true }).lionHonor).toBeUndefined();
            expect(profileFromStrategy({}).lionHonor).toBeUndefined();
            for(const flag of ['aggressive', 'dishonor', 'glory', 'monk', 'craneHonor', 'crabSacrifice']) {
                expect(profileFromStrategy({ [flag]: true }).lionHonor).toBeUndefined();
            }
        });

        it('sets the race posture: stronghold province, go first, never concede', function() {
            const profile = profileFromStrategy({ lionHonor: true });
            // Kenson no Gakka honors every defender after a LOST conflict there,
            // so the deck puts its game-ending province behind that effect.
            expect(profile.strongholdProvinceId).toBe('kenson-no-gakka');
            expect(profile.defenseCommitment).toBe('prevent-break');
            expect(profile.firstPlayerChoice).toBe('first');
            expect(profile.honorRaceAware).toBe(true);
            expect(profile.provinceConcede.cardIds).toEqual([]);
            // Bid 4 in the opening round (the deck needs to see its brakes),
            // then live at the floor where the transfer runs our way.
            expect(profile.drawBidding.openingBid).toBe(4);
            expect(profile.drawBidding.forceLowAfterOpening).toBe(true);
            expect(profile.drawBidding.lowBid).toBe(1);
            // Honor is the scoreboard, so it is never sold for a fate.
            expect(profile.personalHonor.honorGiftResponse.enabled).toBe(false);
        });

        it('opts in to all three shared card packages', function() {
            const profile = profileFromStrategy({ lionHonor: true });
            expect(profile.strongholdBow.strongholdCardId).toBe('kyuden-ikoma');
            expect(profile.conflictRecursion.sourceCardIds)
                .toEqual(['kitsu-spiritcaller', 'forebearer-s-echoes']);
            expect(profile.dynastyEvents.honorBushiCardIds).toEqual(['honored-veterans']);
            expect(profile.dynastyEvents.alwaysPlayCardIds).toEqual(['procedural-interference']);
        });

        it('resolves the real decklist to lionHonor and NOT the duel override', function() {
            const ids = Object.keys(require('../../../tools/selfplay/fixtures/lion-honor-decklist.json').cards);
            const strategy = deriveDeckStrategy(ids);
            const profile = resolveDeckProfile(new Set(ids), strategy);
            expect(profile.lionHonor).toBeDefined();
            expect(profile.lionDuelist).toBeUndefined();
            // The duel override would set a province this deck does not own.
            expect(profile.overrideNames || []).not.toContain('lion-duelist-kyuden-ikoma');
            expect(profile.strongholdProvinceId).toBe('kenson-no-gakka');
        });
    });

    describe('shared packages keep the Lion Duelist list identical', function() {
        const duel = resolveDeckProfile(
            new Set(Object.keys(require('../../../tools/selfplay/fixtures/lion-duelist-decklist.json').cards)),
            deriveDeckStrategy(Object.keys(require('../../../tools/selfplay/fixtures/lion-duelist-decklist.json').cards))
        );

        it('carries the duel list its OWN previously hard-coded values', function() {
            expect(duel.strongholdBow.championCharacterIds).toEqual(['akodo-toturi', 'matsu-tsuko-2']);
            expect(duel.strongholdBow.requiresReadyTarget).toBe(true);
            expect(duel.strongholdBow.skipsParticipants).toBe(true);
            expect(duel.conflictRecursion.minimumSkill).toBe(2);
            expect(duel.conflictRecursion.gloryWeight).toBe(0.5);
            expect(duel.dynastyEvents.rerollCardIds).toEqual(['a-season-of-war']);
            expect(duel.commanderCharacterIds).toContain('matsu-agetoki');
        });

        it('the extracted stronghold bow reproduces LionDuelistTactics exactly', function() {
            const bow = new StrongholdBowTactics(duel.strongholdBow);
            const champion = character('matsu-tsuko-2', { military: 7 });
            const bowed = character('bowed', { military: 6, bowed: true });
            const participant = character('participant', { military: 5, inConflict: true });
            const idle = character('idle', { military: 3 });
            const pick = bow.pickTarget([champion, bowed, participant, idle], 'military');
            // Champions are illegal, bowed bodies are already spent, and a
            // participant bows on its own coming home.
            expect(pick.id).toBe('idle');
        });
    });

    describe('playbook entry scoping', function() {
        it('shares Before the Throne with the Crane honor list but not with Scorpion', function() {
            expect(DECK_SCOPED_PLAYBOOK_ENTRIES['before-the-throne'])
                .toEqual(['craneHonor', 'lionHonor']);
            expect(getPlaybookEntry('before-the-throne', deriveDeckStrategy(['kenson-no-gakka']))).toBeDefined();
            expect(getPlaybookEntry('before-the-throne', deriveDeckStrategy(['seven-fold-palace']))).toBeDefined();
            expect(getPlaybookEntry('before-the-throne', deriveDeckStrategy(['city-of-the-open-hand']))).toBeUndefined();
        });

        it('keeps For Shame scoped to the Crane list only', function() {
            expect(getPlaybookEntry('for-shame', deriveDeckStrategy(['kenson-no-gakka']))).toBeUndefined();
        });
    });

    describe('ring steering', function() {
        it('lifts AIR above the generic default, and again near the finish', function() {
            expect(tactics.ringBonus('air', 10)).toBe(LION_HONOR_DEFAULTS.airRingBonus);
            expect(tactics.ringBonus('air', 20))
                .toBe(LION_HONOR_DEFAULTS.airRingBonus + LION_HONOR_DEFAULTS.airRingCloseBonus);
            expect(tactics.ringBonus('fire', 10)).toBe(LION_HONOR_DEFAULTS.fireRingBonus);
            expect(tactics.ringBonus('earth', 10)).toBe(0);
        });

        it('adds the Toturi term only while a READY Toturi is on the board', function() {
            const toturi = character('akodo-toturi', { military: 6 });
            const bowed = character('akodo-toturi', { military: 6, bowed: true });
            const base = tactics.ringBonus('air', 10);
            expect(tactics.ringBonus('air', 10, [toturi]))
                .toBe(base + LION_HONOR_DEFAULTS.toturiRingBonus);
            expect(tactics.ringBonus('air', 10, [bowed])).toBe(base);
            // Earth is not one of his elements, so he adds nothing there.
            expect(tactics.ringBonus('earth', 10, [toturi])).toBe(0);
        });
    });

    describe('fate investment', function() {
        it('buys Ikoma Prodigy WITH a fate (its reaction pays an honor for it)', function() {
            expect(tactics.desiredAdditionalFate('ikoma-prodigy')).toBe(1);
        });

        it('buys Lion\'s Pride Paragon at ZERO fate, because Dire needs no fate', function() {
            expect(tactics.desiredAdditionalFate('lion-s-pride-paragon')).toBe(0);
        });

        it('leaves unlisted cards to the shared economy', function() {
            expect(tactics.desiredAdditionalFate('some-other-card')).toBeNull();
            expect(tactics.desiredAdditionalFate(undefined)).toBeNull();
        });

        it('reserves dynasty fate for either reaction it must be able to cast', function() {
            expect(tactics.desiredDynastyFateReserve([])).toBe(0);
            expect(tactics.desiredDynastyFateReserve([{ id: 'way-of-the-chrysanthemum' }]))
                .toBe(LION_HONOR_DEFAULTS.chrysanthemumReserveFate);
            expect(tactics.desiredDynastyFateReserve([{ id: 'privileged-position' }]))
                .toBe(LION_HONOR_DEFAULTS.privilegedPositionReserveFate);
        });
    });

    describe('dynasty buying', function() {
        const costs = {};
        const playable = [
            character('akodo-toturi', { military: 6, political: 3, glory: 3, cost: 5 }),
            character('bushido-adherent', { military: 4, political: 2, glory: 2, cost: 3 }),
            character('ikoma-prodigy', { military: 0, political: 2, glory: 1, cost: 1 })
        ];

        it('takes the tower only when there is fate for it to arrive decorated', function() {
            expect(tactics.pickDynastyCharacter({ playable, costs, fate: 8, board: [] }).id)
                .toBe('akodo-toturi');
        });

        it('DROPS the tower from the general sort when its own branch declined', function() {
            // The Crane Honor bug: the tower branch says no, then the raw-skill
            // ranking buys it naked anyway and the knob reads bit-identical.
            const pick = tactics.pickDynastyCharacter({ playable, costs, fate: 5, board: [] });
            expect(pick.id).not.toBe('akodo-toturi');
        });

        it('treats ZERO fate as a real budget (this list has 1-cost faucets)', function() {
            const free = [character('free-body', { political: 1, cost: 0 })];
            expect(tactics.pickDynastyCharacter({ playable: free, costs, fate: 0, board: [] }))
                .not.toBeNull();
        });

        it('passes the window once the board is wide enough', function() {
            const board = new Array(LION_HONOR_DEFAULTS.maximumBoardCharacters).fill(character('x'));
            expect(tactics.pickDynastyCharacter({ playable, costs, fate: 9, board })).toBeNull();
        });

        it('passes when the reserve exceeds the pool', function() {
            expect(tactics.pickDynastyCharacter({ playable, costs, fate: 1, board: [], reserve: 2 }))
                .toBeNull();
        });
    });

    describe('honor-token targeting', function() {
        it('follows the deck ordering ahead of glory', function() {
            const magistrate = character('implacable-magistrate', { glory: 1 });
            const chronicler = character('chronicler-of-conquests', { glory: 1 });
            expect(tactics.pickHonorTarget([chronicler, magistrate]).id).toBe('implacable-magistrate');
        });

        it('never re-honors an already honored body while another is available', function() {
            const paragon = character('lion-s-pride-paragon', { glory: 3, isHonored: true });
            const prodigy = character('ikoma-prodigy', { glory: 1 });
            expect(tactics.pickHonorTarget([paragon, prodigy]).id).toBe('ikoma-prodigy');
        });

        it('returns null with nothing to honor', function() {
            expect(tactics.pickHonorTarget([])).toBeNull();
        });

        it('prefers a ready participant while a conflict is live', function() {
            // A bowed body, and a body at home, contribute no skill, so the
            // token's glory only converts on a ready participant. Off a
            // conflict the printed ordering is unchanged.
            const magistrate = character('implacable-magistrate', { glory: 1, bowed: true });
            const chronicler = character('chronicler-of-conquests', { glory: 1, inConflict: true });
            expect(tactics.pickHonorTarget([chronicler, magistrate], { activeConflict: true }).id)
                .toBe('chronicler-of-conquests');
            expect(tactics.pickHonorTarget([chronicler, magistrate]).id).toBe('implacable-magistrate');
        });

        it('sends a DOUBLE honor at a dishonored body', function() {
            const magistrate = character('implacable-magistrate', { glory: 1 });
            const chronicler = character('chronicler-of-conquests', { glory: 1, isDishonored: true });
            expect(tactics.pickHonorTarget([chronicler, magistrate], { doubleHonor: true }).id)
                .toBe('chronicler-of-conquests');
            expect(tactics.pickHonorTarget([chronicler, magistrate]).id).toBe('implacable-magistrate');
        });
    });

    describe('Way of the Chrysanthemum', function() {
        it('bids the floor with a castable copy in hand', function() {
            expect(tactics.adjustDrawBid([{ id: 'way-of-the-chrysanthemum' }], 2))
                .toBe(LION_HONOR_DEFAULTS.chrysanthemumBid);
        });

        it('leaves the shared draw-bid policy alone without the fate to cast it', function() {
            expect(tactics.adjustDrawBid([{ id: 'way-of-the-chrysanthemum' }], 1)).toBeNull();
            expect(tactics.adjustDrawBid([], 5)).toBeNull();
        });
    });

    describe('Kenson no Gakka', function() {
        it('names the honor province, which becomes the stronghold province', function() {
            // The wide defense its "honor each defending character" reaction
            // wants comes free from the generic stronghold-defense rule; a
            // per-province defense buffer measured bit-identical at 0, 2 and 4
            // over 384 games and was removed rather than shipped dead.
            expect(LION_HONOR_DEFAULTS.honorProvinceDefenseBuffer).toBeUndefined();
            expect(profileFromStrategy({ lionHonor: true }).strongholdProvinceId)
                .toBe(LION_HONOR_DEFAULTS.honorProvinceId);
        });
    });

    describe('Implacable Magistrate attacker ordering', function() {
        const magistrate = character('implacable-magistrate', { military: 2 });
        const honored = character('honored-body', { military: 3, isHonored: true });
        const plain = character('plain-body', { military: 4 });

        it('is a no-op when the Magistrate is not in the candidate set', function() {
            const ordered = tactics.orderAttackers([plain, honored], 'military', []);
            expect(ordered.map((card) => card.id)).toEqual(['plain-body', 'honored-body']);
        });

        it('sends honored bodies first and holds the Magistrate back', function() {
            const ordered = tactics.orderAttackers([magistrate, plain, honored], 'military', []);
            expect(ordered[0].id).toBe('honored-body');
            expect(ordered[ordered.length - 1].id).toBe('plain-body');
        });

        it('once the Magistrate is committed, an unhonored body adds nothing', function() {
            const ordered = tactics.orderAttackers([plain, honored], 'military', [magistrate]);
            expect(ordered[0].id).toBe('honored-body');
        });
    });

    describe('Under Amaterasu\'s Gaze', function() {
        it('prefers the stronghold province and skips one already carrying a Battlefield', function() {
            const kenson = { id: 'kenson-no-gakka', uuid: 'a', attachments: [] };
            const art = { id: 'the-art-of-war', uuid: 'b', attachments: [] };
            expect(tactics.pickBattlefieldProvince([art, kenson]).id).toBe('kenson-no-gakka');

            const taken = { id: 'kenson-no-gakka', uuid: 'a', attachments: [{ id: 'under-amaterasu-s-gaze' }] };
            expect(tactics.pickBattlefieldProvince([art, taken]).id).toBe('the-art-of-war');
        });

        it('never returns a broken province while an unbroken one is offered', function() {
            const broken = { id: 'kenson-no-gakka', uuid: 'a', isBroken: true, attachments: [] };
            const art = { id: 'the-art-of-war', uuid: 'b', attachments: [] };
            expect(tactics.pickBattlefieldProvince([broken, art]).id).toBe('the-art-of-war');
        });

    });

    describe('Procedural Interference', function() {
        it('takes the province that refills to three cards first', function() {
            const frog = { id: 'city-of-the-rich-frog', uuid: 'a', location: 'province 1' };
            const other = { id: 'ancestral-lands', uuid: 'b', location: 'province 2' };
            expect(tactics.pickInterferenceProvince([other, frog], {}).id).toBe('city-of-the-rich-frog');
        });

        it('otherwise takes whichever is holding the most cards', function() {
            const one = { id: 'unknown-a', uuid: 'a', location: 'province 1' };
            const two = { id: 'unknown-b', uuid: 'b', location: 'province 2' };
            expect(tactics.pickInterferenceProvince([one, two],
                { 'province 1': 1, 'province 2': 3 }).id).toBe('unknown-b');
        });

        it('skips broken provinces', function() {
            const broken = { id: 'city-of-the-rich-frog', uuid: 'a', location: 'province 1', isBroken: true };
            const live = { id: 'ancestral-lands', uuid: 'b', location: 'province 2' };
            expect(tactics.pickInterferenceProvince([broken, live], {}).id).toBe('ancestral-lands');
        });
    });

    describe('Hero of Three Trees', function() {
        it('takes the honor by default — it is the win condition', function() {
            expect(tactics.heroPrefersHonorOverStrength({ amAttacker: true, strengthNeeded: 4 })).toBe(true);
            expect(tactics.heroPrefersHonorOverStrength({ amAttacker: false, strengthNeeded: 1 })).toBe(true);
        });

        it('takes the strength ONLY when one point completes the break', function() {
            expect(tactics.heroPrefersHonorOverStrength({ amAttacker: true, strengthNeeded: 1 })).toBe(false);
        });
    });

    describe('shared dynasty events', function() {
        const events = new DynastyEventTactics(profileFromStrategy({ lionHonor: true }).dynastyEvents);

        it('plays Honored Veterans only with a new unhonored Bushi to honor', function() {
            const veterans = { id: 'honored-veterans', uuid: 'v', type: 'event' };
            const fresh = character('bushido-adherent', { glory: 2, new: true, traits: ['bushi'] });
            const stale = character('bushido-adherent', { glory: 2, traits: ['bushi'] });
            expect(events.pick({
                playable: [veterans], costs: {}, fate: 3, board: [fresh], ownProvinceCardCount: 2
            }).card.id).toBe('honored-veterans');
            expect(events.pick({
                playable: [veterans], costs: {}, fate: 3, board: [stale], ownProvinceCardCount: 2
            })).toBeNull();
        });

        it('always plays Procedural Interference — both branches pay us', function() {
            const interference = { id: 'procedural-interference', uuid: 'p', type: 'event' };
            expect(events.pick({
                playable: [interference], costs: {}, fate: 0, board: [], ownProvinceCardCount: 2
            }).card.id).toBe('procedural-interference');
        });

        it('reports a reason the card-usage audit counts as a PLAY', function() {
            const interference = { id: 'procedural-interference', uuid: 'p', type: 'event' };
            const pick = events.pick({
                playable: [interference], costs: {}, fate: 0, board: [], ownProvinceCardCount: 2
            });
            // `auditCards.js` SOURCE_REASON requires play|ability|trigger|...
            // A reason without one of those reads as ZERO USE for a card that
            // is in fact being played every game.
            expect(pick.reason).toMatch(/play|ability|trigger/);
        });
    });

    describe('shared conflict recursion', function() {
        const recursion = new ConflictRecursionTactics(
            profileFromStrategy({ lionHonor: true }).conflictRecursion);

        it('recognises both sources and nothing else', function() {
            expect(recursion.isSource('kitsu-spiritcaller')).toBe(true);
            expect(recursion.isSource('forebearer-s-echoes')).toBe(true);
            expect(recursion.isSource('akodo-toturi')).toBe(false);
        });

        it('takes the most skill on the contested axis, glory breaking ties', function() {
            const big = character('big', { military: 5, glory: 0 });
            const glorious = character('glorious', { military: 5, glory: 3 });
            const small = character('small', { military: 1, glory: 5 });
            expect(recursion.pickTarget([small, big, glorious], 'military').id).toBe('glorious');
        });

        it('nets off the bow-self cost when the source is a ready participant', function() {
            const source = character('kitsu-spiritcaller', { military: 1, inConflict: true });
            const body = character('body', { military: 4 });
            expect(recursion.gain([body], 'military', source)).toBe(3);
        });
    });
});
