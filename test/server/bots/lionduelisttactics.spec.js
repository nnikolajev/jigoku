const {
    LionDuelistTactics,
    LION_DUELIST_DEFAULTS
} = require('../../../build/server/game/bots/LionDuelistTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const {
    profileFromStrategy,
    resolveDeckProfile,
    DEFAULT_PROFILE
} = require('../../../build/server/game/bots/DeckProfiles.js');
const {
    PersonalHonorTactics,
    PERSONAL_HONOR_DEFAULTS
} = require('../../../build/server/game/bots/PersonalHonorTactics.js');
const MulliganTactics = require('../../../build/server/game/bots/MulliganTactics.js').default;
const { DEFAULT_MULLIGAN_PROFILE } = require('../../../build/server/game/bots/MulliganTactics.js');
const {
    loadLionDuelistDeck,
    loadLionDeck,
    loadCraneDeck
} = require('../../../tools/selfplay/deckLoader.js');

// Locks the Kyuden Ikoma honor-switch layer: strategy derivation, profile
// gating (no other deck may pick the tactics up), and the per-card valuations
// that decide targets. Everything here is pure — the policy wiring that calls
// it is exercised by the self-play card-usage audit.
describe('LionDuelistTactics', function() {
    const tactics = new LionDuelistTactics(LION_DUELIST_DEFAULTS);
    const deckIds = (deck) => [
        ...(deck.stronghold || []),
        ...(deck.role || []),
        ...(deck.provinceCards || []),
        ...(deck.dynastyCards || []),
        ...(deck.conflictCards || [])
    ].map((entry) => entry.card.id);

    const character = (overrides = {}) => Object.assign({
        uuid: overrides.id || 'uuid-1',
        type: 'character',
        traits: [],
        inConflict: false,
        bowed: false,
        isDishonored: false,
        isHonored: false,
        attachments: [],
        fate: 0,
        military: 0,
        political: 0
    }, overrides);

    describe('strategy derivation', function() {
        it('derives lionDuelist from Kyuden Ikoma', function() {
            const strategy = deriveDeckStrategy(deckIds(loadLionDuelistDeck()));
            expect(strategy.lionDuelist).toBe(true);
        });

        it('leaves every other strategy flag off for this deck', function() {
            const strategy = deriveDeckStrategy(deckIds(loadLionDuelistDeck()));
            expect(strategy.aggressive).toBe(false);
            expect(strategy.duelist).toBe(false);
            expect(strategy.rebirth).toBe(false);
            expect(strategy.bidWar).toBe(false);
            expect(strategy.glory).toBe(false);
        });

        it('does not fire for the Lion bushi swarm precon or Crane', function() {
            expect(deriveDeckStrategy(deckIds(loadLionDeck())).lionDuelist).toBe(false);
            expect(deriveDeckStrategy(deckIds(loadCraneDeck())).lionDuelist).toBe(false);
        });
    });

    describe('profile gating', function() {
        it('attaches the tactics profile only to the Kyuden Ikoma list', function() {
            const ids = deckIds(loadLionDuelistDeck());
            const profile = resolveDeckProfile(ids, deriveDeckStrategy(ids));
            expect(profile.lionDuelist).toBeDefined();
            expect(profile.overrideNames).toContain('lion-duelist-kyuden-ikoma');
            expect(profile.strongholdProvinceId).toBe('frostbitten-crossing');
        });

        it('leaves the generic and Lion swarm profiles without it', function() {
            expect(DEFAULT_PROFILE.lionDuelist).toBeUndefined();
            expect(profileFromStrategy({}).lionDuelist).toBeUndefined();
            const lionIds = deckIds(loadLionDeck());
            const lion = resolveDeckProfile(lionIds, deriveDeckStrategy(lionIds));
            expect(lion.lionDuelist).toBeUndefined();
            expect(lion.lion).toBeDefined();
        });
    });

    describe('Kyuden Ikoma bow target', function() {
        it('skips Champions, bowed bodies and current participants', function() {
            const champion = character({ id: 'akodo-toturi', uuid: 'champ', military: 6 });
            const bowed = character({ id: 'a', uuid: 'bowed', military: 5, bowed: true });
            const participant = character({ id: 'b', uuid: 'inconflict', military: 5, inConflict: true });
            const idle = character({ id: 'c', uuid: 'idle', military: 3 });
            const pick = tactics.pickStrongholdBowTarget([champion, bowed, participant, idle], 'military');
            expect(pick.uuid).toBe('idle');
        });

        it('declines when every legal body is already bowed or fighting', function() {
            const bowed = character({ id: 'a', uuid: 'bowed', military: 5, bowed: true });
            expect(tactics.shouldUseStronghold([bowed], 'military')).toBe(false);
        });

        it('prefers the body with the most investment sunk into it', function() {
            const plain = character({ id: 'a', uuid: 'plain', military: 4 });
            const invested = character({ id: 'b', uuid: 'invested', military: 3, fate: 2 });
            const pick = tactics.pickStrongholdBowTarget([plain, invested], 'military');
            expect(pick.uuid).toBe('invested');
        });
    });

    describe('Frostbitten Crossing strip', function() {
        const debuff = { id: 'pacifism', uuid: 'att-1' };
        const weapon = { id: 'fine-katana', uuid: 'att-2' };
        const scores = LION_DUELIST_DEFAULTS;

        const stripValue = (card, mine) => tactics.stripValue(card, mine,
            DEFAULT_PROFILE.attachmentControl.ownDebuffScores,
            DEFAULT_PROFILE.attachmentControl.enemyAttachmentScores);
        const pickStrip = (mine, theirs) => tactics.pickStripTarget(mine, theirs,
            DEFAULT_PROFILE.attachmentControl.ownDebuffScores,
            DEFAULT_PROFILE.attachmentControl.enemyAttachmentScores);

        it('prices our own kit as a LOSS, not as nothing', function() {
            const own = character({ uuid: 'own', inConflict: true, attachments: [weapon] });
            expect(stripValue(own, true)).toBeLessThan(0);
        });

        it('takes our own body when it carries a heavy debuff', function() {
            const own = character({ uuid: 'own', inConflict: true, attachments: [debuff] });
            const theirs = character({ uuid: 'theirs', inConflict: true, attachments: [] });
            expect(pickStrip([own], [theirs]).uuid).toBe('own');
        });

        it('leaves our own body alone when the debuff costs less than the kit', function() {
            const loaded = character({
                uuid: 'loaded',
                inConflict: true,
                attachments: [debuff, weapon, { id: 'fan-of-command', uuid: 'att-3' },
                    { id: 'setting-the-standard', uuid: 'att-4' }]
            });
            expect(stripValue(loaded, true)).toBeLessThan(scores.stripMinimumValue);
            expect(pickStrip([loaded], [])).toBeNull();
        });

        // The Frostbitten Crossing loss from the Phoenix game: every attachment
        // on the board was ours, all of them buffs, and the province stripped
        // the tower it had spent the whole game building.
        it('never strips a body of ours that carries only buffs', function() {
            const toturi = character({
                uuid: 'akodo-toturi',
                inConflict: true,
                attachments: [
                    { id: 'fan-of-command', uuid: 'att-1' },
                    { id: 'duelist-training', uuid: 'att-2' },
                    { id: 'formal-invitation', uuid: 'att-3' },
                    { id: 'true-strike-kenjutsu', uuid: 'att-4' }
                ]
            });
            const bare = [
                character({ uuid: 'adept', inConflict: true }),
                character({ uuid: 'prodigy', inConflict: true })
            ];
            expect(pickStrip([toturi], bare)).toBeNull();
            expect(tactics.shouldUseStrip([toturi], bare,
                DEFAULT_PROFILE.attachmentControl.ownDebuffScores,
                DEFAULT_PROFILE.attachmentControl.enemyAttachmentScores)).toBe(false);
        });

        it('still prefers a loaded enemy body over ours', function() {
            const own = character({ uuid: 'own', inConflict: true, attachments: [debuff] });
            const theirs = character({
                uuid: 'theirs',
                inConflict: true,
                attachments: [{ id: 'tetsubo-of-blood', uuid: 'att-9' }]
            });
            expect(pickStrip([own], [theirs]).uuid).toBe('theirs');
        });

        it('returns nothing when no participant carries enough weight', function() {
            const own = character({ uuid: 'own', inConflict: true, attachments: [] });
            expect(pickStrip([own], [])).toBeNull();
            expect(scores.stripMinimumValue).toBeGreaterThan(0);
        });

        it('forced with no way out, takes the least damaging body', function() {
            const tower = character({
                uuid: 'tower',
                inConflict: true,
                attachments: [{ id: 'fan-of-command', uuid: 'att-1' },
                    { id: 'true-strike-kenjutsu', uuid: 'att-2' }]
            });
            const cheap = character({
                uuid: 'cheap',
                inConflict: true,
                attachments: [{ id: 'fan-of-command', uuid: 'att-3' }]
            });
            const forced = tactics.pickForcedStripTarget([tower, cheap], [],
                DEFAULT_PROFILE.attachmentControl.ownDebuffScores,
                DEFAULT_PROFILE.attachmentControl.enemyAttachmentScores);
            expect(forced.uuid).toBe('cheap');
        });
    });

    describe('Kitsu Motso', function() {
        const idle = character({ uuid: 'idle', military: 4 });

        it('requires the printed fewer-cards-in-hand condition', function() {
            expect(tactics.shouldDragOpponentIn([idle], 'military', true, 9, 5, 3)).toBe(false);
        });

        it('drags a body in when the conflict is out of reach', function() {
            expect(tactics.shouldDragOpponentIn([idle], 'military', true, 9, 2, 5)).toBe(true);
        });

        it('drags a body in when our lead is beyond what it can answer', function() {
            expect(tactics.shouldDragOpponentIn([idle], 'military', true, -7, 2, 5)).toBe(true);
        });

        it('refuses while the conflict is still in the balance', function() {
            expect(tactics.shouldDragOpponentIn([idle], 'military', true, 1, 2, 5)).toBe(false);
        });

        it('never fires on defense by default', function() {
            expect(tactics.shouldDragOpponentIn([idle], 'military', false, 9, 2, 5)).toBe(false);
        });

        it('ignores bodies already in the conflict or already bowed', function() {
            const bowed = character({ uuid: 'bowed', military: 6, bowed: true });
            const inside = character({ uuid: 'inside', military: 6, inConflict: true });
            expect(tactics.pickDragTarget([bowed, inside], 'military')).toBeNull();
        });
    });

    describe('recursion (Spiritcaller / Forebearer\'s Echoes)', function() {
        const small = character({ uuid: 'small', military: 1 });
        const big = character({ uuid: 'big', military: 5 });

        it('takes the biggest body on the contested axis', function() {
            expect(tactics.pickRecursionTarget([small, big], 'military').uuid).toBe('big');
        });

        it('reads the political axis for a political conflict', function() {
            const politician = character({ uuid: 'pol', military: 0, political: 6 });
            expect(tactics.pickRecursionTarget([big, politician], 'political').uuid).toBe('pol');
        });

        it('nets off the skill lost when the source bows to pay', function() {
            const source = character({ uuid: 'src', military: 4, inConflict: true });
            expect(tactics.recursionGain([big], 'military', source)).toBe(1);
            expect(tactics.shouldRecur([big], 'military', source)).toBe(false);
        });

        it('pays nothing when the source is at home', function() {
            const source = character({ uuid: 'src', military: 4 });
            expect(tactics.recursionGain([big], 'military', source)).toBe(5);
            expect(tactics.shouldRecur([big], 'military', source)).toBe(true);
        });
    });

    describe('Matsu Agetoki conflict move', function() {
        const province = (overrides) => Object.assign({ location: 'province 1', broken: false }, overrides);

        it('moves only when the destination saves real strength', function() {
            const weaker = province({ location: 'province 2', strength: 3 });
            expect(tactics.pickConflictMoveProvince([weaker], 6, {}).location).toBe('province 2');
            expect(tactics.pickConflictMoveProvince([weaker], 4, {})).toBeNull();
        });

        it('prices a facedown province at the field average, not zero', function() {
            const hidden = province({ location: 'province 3', facedown: true });
            expect(tactics.provinceStrength(hidden, {}))
                .toBe(LION_DUELIST_DEFAULTS.facedownProvinceAssumedStrength);
        });

        it('never picks a broken province', function() {
            const broken = province({ location: 'province 4', strength: 1, broken: true });
            expect(tactics.pickConflictMoveProvince([broken], 9, {})).toBeNull();
        });
    });

    describe('Matsu Tsuko win-is-break', function() {
        const tsuko = character({ id: 'matsu-tsuko-2', uuid: 'tsuko', inConflict: true, military: 5 });

        it('collapses the target number while she attacks with the honor lead', function() {
            expect(tactics.winIsBreak([tsuko], true, true, false)).toBe(true);
        });

        it('is off without the honor lead, on defense, or at the stronghold', function() {
            expect(tactics.winIsBreak([tsuko], true, false, false)).toBe(false);
            expect(tactics.winIsBreak([tsuko], false, true, false)).toBe(false);
            expect(tactics.winIsBreak([tsuko], true, true, true)).toBe(false);
        });

        it('is off when she is bowed or not in the conflict', function() {
            expect(tactics.winIsBreak([Object.assign({}, tsuko, { bowed: true })], true, true, false)).toBe(false);
            expect(tactics.winIsBreak([Object.assign({}, tsuko, { inConflict: false })], true, true, false)).toBe(false);
        });
    });

    describe('Akodo Zentaro', function() {
        it('takes the highest-value holding', function() {
            const cheap = { id: 'unknown-holding', uuid: 'cheap', type: 'holding' };
            const engine = { id: 'imperial-storehouse', uuid: 'engine', type: 'holding' };
            expect(tactics.pickHoldingTarget([cheap, engine]).uuid).toBe('engine');
        });

        it('moves the stolen holding into the province we would miss least', function() {
            const provinces = [
                { location: 'province 1', broken: false },
                { location: 'province 2', broken: false }
            ];
            const destination = tactics.pickHoldingDestination(provinces,
                { 'province 1': 7, 'province 2': 1 });
            expect(destination.location).toBe('province 2');
        });

        it('never moves it into the stronghold province or a broken one', function() {
            const provinces = [
                { location: 'stronghold province', broken: false },
                { location: 'province 3', broken: true }
            ];
            expect(tactics.pickHoldingDestination(provinces, {})).toBeNull();
        });
    });

    describe('attachments', function() {
        it('digs Blade of 10,000 Battles ahead of the cheaper grants', function() {
            const cards = [
                { id: 'fan-of-command', uuid: 'a' },
                { id: 'blade-of-10-000-battles', uuid: 'b' },
                { id: 'formal-invitation', uuid: 'c' }
            ];
            expect(tactics.pickForgeAttachment(cards).id).toBe('blade-of-10-000-battles');
        });

        it('puts attachments on the named key characters first', function() {
            const filler = character({ id: 'ikoma-prodigy', uuid: 'filler', political: 9 });
            const tower = character({ id: 'akodo-toturi', uuid: 'tower', military: 6 });
            expect(tactics.pickCarrier([filler, tower], 'military').uuid).toBe('tower');
        });

        it('respects Formal Invitation\'s printed glory-2 attach restriction', function() {
            const lowGlory = character({ id: 'akodo-toturi', uuid: 'low', glory: 1 });
            const eligible = character({ id: 'kitsu-motso', uuid: 'ok', glory: 2 });
            const pick = tactics.pickCarrier([lowGlory, eligible], 'military',
                LION_DUELIST_DEFAULTS.formalInvitationMinimumGlory);
            expect(pick.uuid).toBe('ok');
        });
    });

    describe('playbook entries', function() {
        it('covers every previously unmodelled card in the list', function() {
            const ids = [
                'kyuden-ikoma', 'frostbitten-crossing', 'the-art-of-war', 'ikoma-prodigy',
                'kitsu-motso', 'akodo-zentaro', 'kitsu-spiritcaller', 'matsu-agetoki',
                'matsu-mitsuko', 'matsu-tsuko-2', 'ikoma-reservist', 'called-to-war',
                'even-the-odds', 'prepare-for-war', 'formal-invitation', 'fan-of-command',
                'setting-the-standard', 'blade-of-10-000-battles'
            ];
            for(const id of ids) {
                expect(getPlaybookEntry(id)).withContext(id).toBeDefined();
            }
        });

        it('prices Ikoma Reservist by the rings we actually hold', function() {
            const model = getPlaybookEntry('ikoma-reservist').conflictContribution;
            const base = { conflictType: 'military', liveEventPricing: true };
            expect(model(base)).toBe(1);
            expect(model(Object.assign({}, base, { myClaimedRingElements: ['fire'] }))).toBe(3);
            expect(model(Object.assign({}, base, { myClaimedRingElements: ['air'] }))).toBe(1);
        });

        it('keeps the zero-stat attachments playable through abilityValue', function() {
            for(const id of ['formal-invitation', 'fan-of-command', 'setting-the-standard',
                'blade-of-10-000-battles']) {
                expect(getPlaybookEntry(id).abilityValue).withContext(id).toBe(true);
            }
        });
    });

    describe('dynasty events', function() {
        const veterans = { id: 'honored-veterans', uuid: 'hv', type: 'event' };
        const season = { id: 'a-season-of-war', uuid: 'sw', type: 'event' };
        const freshBushi = character({
            id: 'kitsu-motso', uuid: 'new', traits: ['bushi'], glory: 2, new: true,
            glorySummary: { stat: 2 }
        });

        it('plays Honored Veterans for a Bushi bought this phase', function() {
            const pick = tactics.pickDynastyEvent([veterans], { hv: 0 }, 5, [freshBushi], 0);
            expect(pick && pick.card.id).toBe('honored-veterans');
        });

        it('holds it with no newly played, unhonored, glory-bearing Bushi', function() {
            const stale = Object.assign({}, freshBushi, { new: false });
            expect(tactics.pickDynastyEvent([veterans], { hv: 0 }, 5, [stale], 0)).toBeNull();
            const honored = Object.assign({}, freshBushi, { isHonored: true });
            expect(tactics.pickDynastyEvent([veterans], { hv: 0 }, 5, [honored], 0)).toBeNull();
        });

        it('rerolls with A Season of War only once the provinces are spent', function() {
            expect(tactics.pickDynastyEvent([season], { sw: 1 }, 5, [], 0).card.id).toBe('a-season-of-war');
            expect(tactics.pickDynastyEvent([season], { sw: 1 }, 5, [], 3)).toBeNull();
        });

        it('never offers an event it cannot pay for', function() {
            expect(tactics.pickDynastyEvent([season], { sw: 4 }, 1, [], 0)).toBeNull();
        });
    });

    describe('political axis payoff (Regal Bearing)', function() {
        const courtier = character({ id: 'ikoma-prodigy', uuid: 'c', traits: ['courtier'] });
        const live = {
            hand: [{ id: 'regal-bearing', uuid: 'rb' }],
            board: [courtier],
            opponentBid: 4,
            politicalRemaining: 1
        };

        it('pays only when every printed requirement is live', function() {
            expect(tactics.politicalAxisBonus(live))
                .toBe(LION_DUELIST_DEFAULTS.politicalPayoffBonus);
        });

        it('pays nothing without the card, the Courtier, or the conflict', function() {
            expect(tactics.politicalAxisBonus(Object.assign({}, live, { hand: [] }))).toBe(0);
            expect(tactics.politicalAxisBonus(Object.assign({}, live, { board: [] }))).toBe(0);
            expect(tactics.politicalAxisBonus(Object.assign({}, live, { politicalRemaining: 0 }))).toBe(0);
        });

        it('pays nothing while their dial is too low to draw off', function() {
            expect(tactics.politicalAxisBonus(Object.assign({}, live, { opponentBid: 1 }))).toBe(0);
        });

        it('ignores a bowed Courtier — it cannot participate', function() {
            const bowed = Object.assign({}, courtier, { bowed: true });
            expect(tactics.politicalAxisBonus(Object.assign({}, live, { board: [bowed] }))).toBe(0);
        });
    });

    describe('ring preference', function() {
        const initiate = { id: 'keeper-initiate', uuid: 'ki', type: 'character' };
        const reservist = { id: 'ikoma-reservist', uuid: 'ir', type: 'character' };

        it('bids for air while a Keeper Initiate waits in the dynasty discard', function() {
            expect(tactics.ringBonus('air', [initiate], [], []))
                .toBe(LION_DUELIST_DEFAULTS.recursionRingBonus);
        });

        it('does not bid for air with nothing to recur', function() {
            expect(tactics.ringBonus('air', [], [], [])).toBe(0);
        });

        it('bids for fire or water while a Reservist would be armed', function() {
            expect(tactics.ringBonus('fire', [], [reservist], []))
                .toBe(LION_DUELIST_DEFAULTS.skillRingBonus);
            expect(tactics.ringBonus('water', [], [reservist], []))
                .toBe(LION_DUELIST_DEFAULTS.skillRingBonus);
        });

        it('stops bidding for the second of the pair — the payoff is already on', function() {
            expect(tactics.ringBonus('water', [], [reservist], ['fire'])).toBe(0);
        });

        it('leaves every other element on the generic reading', function() {
            expect(tactics.ringBonus('earth', [initiate], [reservist], [])).toBe(0);
            expect(tactics.ringBonus('void', [initiate], [reservist], [])).toBe(0);
        });
    });

    describe('Called to War honor-gift response (field-wide)', function() {
        const honor = new PersonalHonorTactics(PERSONAL_HONOR_DEFAULTS);
        const bushi = [{ uuid: 'b', fate: 0 }];
        const isBushi = () => true;

        it('buys the fate when both honor rails are clear', function() {
            expect(honor.shouldGiveHonorForFate({
                ownHonor: 12, opponentHonor: 10, ownCharacters: bushi, isBushi
            })).toBe(true);
        });

        it('refuses to feed an opponent that is closing on the honor win', function() {
            expect(honor.shouldGiveHonorForFate({
                ownHonor: 20, opponentHonor: 16, ownCharacters: bushi, isBushi
            })).toBe(false);
        });

        it('refuses while our own honor is near the floor', function() {
            expect(honor.shouldGiveHonorForFate({
                ownHonor: 8, opponentHonor: 10, ownCharacters: bushi, isBushi
            })).toBe(false);
        });

        it('refuses with no Bushi that would bank the fate', function() {
            expect(honor.shouldGiveHonorForFate({
                ownHonor: 12, opponentHonor: 10, ownCharacters: [{ uuid: 'b', fate: 4 }], isBushi
            })).toBe(false);
        });
    });

    describe('fate-phase forced discards', function() {
        const card = (id, uuid) => ({ id, uuid, type: 'character', cost: 2, selectable: true });

        it('discards an opted-in id even when the keep rules wanted it', function() {
            const profile = Object.assign({}, DEFAULT_MULLIGAN_PROFILE, {
                endPhaseDiscardCardIds: ['keeper-initiate']
            });
            const mulligan = new MulliganTactics(profile);
            const pick = mulligan.pickDynastyDiscard({
                cards: [card('keeper-initiate', 'k1')],
                board: [],
                currentFate: 5,
                income: 7,
                roundNumber: 2,
                costsByUuid: { k1: 2 }
            });
            expect(pick.card && pick.card.uuid).toBe('k1');
        });

        it('is inert with the default empty list', function() {
            const mulligan = new MulliganTactics(DEFAULT_MULLIGAN_PROFILE);
            const pick = mulligan.pickDynastyDiscard({
                cards: [card('keeper-initiate', 'k1')],
                board: [],
                currentFate: 5,
                income: 7,
                roundNumber: 2,
                costsByUuid: { k1: 2 }
            });
            expect(pick.card).toBeUndefined();
        });
    });
});
