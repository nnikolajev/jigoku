const {
    DRAGON_ATTACHMENT_DEFAULTS,
    DragonAttachmentTactics
} = require('../../../build/server/game/bots/DragonAttachmentTactics.js');
const { deriveDeckStrategy, getPlaybookEntry } = require('../../../build/server/game/bots/CardPlaybook.js');
const { profileFromStrategy, resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const JigokuBotPolicy = require('../../../build/server/game/bots/JigokuBotPolicy.js');
const FateAwareJigokuBotPolicy = require('../../../build/server/game/bots/FateAwareJigokuBotPolicy.js');
const dragonAttachmentDecklist = require('../../../tools/selfplay/fixtures/dragon-attachments-decklist.json');

describe('DragonAttachmentTactics', function() {
    const tactics = new DragonAttachmentTactics(DRAGON_ATTACHMENT_DEFAULTS);
    const ATTACHMENTS = {
        holdingEngine: false,
        defensive: false,
        aggressive: false,
        dishonor: false,
        glory: false,
        monk: false,
        duelist: false,
        shugenja: false,
        attachmentTower: true
    };

    describe('strategy and profile gating', function() {
        it('uses the v0.6 EmeraldDB deck with the new attachment package', function() {
            expect(dragonAttachmentDecklist.deck_id).toBe('ce8df8ae-ee05-4ab7-bc13-087a8fc092cb');
            expect(dragonAttachmentDecklist.version_number).toBe('0.6');
            expect(dragonAttachmentDecklist.cards['mountaintop-statuary']).toBe(3);
            for(const added of ['agasha-shunsen', 'agasha-taiko', 'waterfall-tattoo',
                'self-understanding', 'the-stone-of-sorrows', 'revered-bonsho',
                'restoration-of-balance', 'city-of-the-rich-frog',
                'entrenched-position']) {
                expect(dragonAttachmentDecklist.cards[added]).withContext(added).toBeGreaterThan(0);
            }
            for(const removed of ['alchemical-laboratory', 'keen-warrior', 'ancestral-lands',
                'hiruma-skirmisher', 'tattooed-wanderer', 'inventive-mirumoto',
                'riot-in-the-streets', 'two-heavens-technique', 'pilgrimage']) {
                expect(dragonAttachmentDecklist.cards[removed]).withContext(removed).toBeUndefined();
            }
        });

        it('drops every removed card from the profile lists', function() {
            const lists = [
                DRAGON_ATTACHMENT_DEFAULTS.towerCharacters,
                DRAGON_ATTACHMENT_DEFAULTS.dragonCharacters,
                DRAGON_ATTACHMENT_DEFAULTS.supportCharacters,
                DRAGON_ATTACHMENT_DEFAULTS.attachments,
                DRAGON_ATTACHMENT_DEFAULTS.stackableAttachments,
                DRAGON_ATTACHMENT_DEFAULTS.restrictedAttachments,
                DRAGON_ATTACHMENT_DEFAULTS.weaponAttachments,
                DRAGON_ATTACHMENT_DEFAULTS.attachmentPriority,
                DRAGON_ATTACHMENT_DEFAULTS.yokuniCopyPriority,
                DRAGON_ATTACHMENT_DEFAULTS.cheapCharacters
            ];
            for(const removed of ['keen-warrior', 'hiruma-skirmisher', 'inventive-mirumoto',
                'tattooed-wanderer', 'two-heavens-technique']) {
                for(const list of lists) {
                    expect(list).withContext(removed).not.toContain(removed);
                }
            }
            expect(getPlaybookEntry('keen-warrior')).toBeUndefined();
            expect(getPlaybookEntry('hiruma-skirmisher')).toBeUndefined();
            expect(getPlaybookEntry('inventive-mirumoto')).toBeUndefined();
            expect(getPlaybookEntry('two-heavens-technique')).toBeUndefined();
        });

        it('carries every deck attachment in the profile', function() {
            const deckAttachments = ['tetsubo-of-blood', 'jade-tetsubo', 'adopted-kin',
                'daimyo-s-favor', 'ancestral-daisho', 'elegant-tessen', 'finger-of-jade',
                'fine-katana', 'inscribed-tanto', 'ornate-fan', 'pathfinder-s-blade',
                'kitsuki-s-method', 'self-understanding', 'the-stone-of-sorrows',
                'waterfall-tattoo'];
            for(const id of deckAttachments) {
                expect(DRAGON_ATTACHMENT_DEFAULTS.attachments).withContext(id).toContain(id);
                expect(DRAGON_ATTACHMENT_DEFAULTS.attachmentPriority).withContext(id).toContain(id);
                expect(DRAGON_ATTACHMENT_DEFAULTS.attachmentSkillBonuses[id]).withContext(id).toBeDefined();
            }
        });

        it('keys only on Iron Mountain Castle', function() {
            expect(deriveDeckStrategy(['iron-mountain-castle']).attachmentTower).toBe(true);
            expect(deriveDeckStrategy(['high-house-of-light']).attachmentTower).toBe(false);
        });

        it('adds the attachment profile without changing the monk profile', function() {
            const profile = profileFromStrategy(ATTACHMENTS);
            expect(profile.attachmentTower).toEqual(DRAGON_ATTACHMENT_DEFAULTS);
            expect(profile.dragon).toBeUndefined();
            expect(profile.attackCommitment).toBe('all-but-one');
        });

        it('parks Pilgrimage under the stronghold', function() {
            const profile = resolveDeckProfile(
                ['iron-mountain-castle', 'illustrious-forge'],
                ATTACHMENTS
            );
            // Illustrious Forge earns more in an OUTER province, where it is
            // revealed early enough for its top-five search to fire. Measured
            // +1.17pp over 12 bases / 7627 games; see the doc.
            expect(profile.strongholdProvinceId).toBe('pilgrimage');
            expect(profile.attackCommitment).toBe('all-but-one');
            expect(profile.attackKeepHome).toBe(1);
        });

        it('keys the Agasha Taiko order to the stronghold choice', function() {
            const profile = resolveDeckProfile(
                ['iron-mountain-castle', 'illustrious-forge'],
                ATTACHMENTS
            );
            // Pilgrimage sits under the stronghold and cannot be targeted, so
            // it leaves the list. Illustrious Forge only enters it once it has
            // been REVEALED; while facedown its own on-reveal search is a card
            // we still want, so Restoration of Balance is protected instead.
            expect(profile.attachmentTower.agashaTaiko.provincePriority).toEqual([
                'city-of-the-rich-frog', 'manicured-garden',
                'illustrious-forge', 'restoration-of-balance'
            ]);
            expect(profile.attachmentTower.agashaTaiko.requireRevealedIds)
                .toEqual(['illustrious-forge']);
            // A partial `attachmentTower` override must not drop everything
            // else the strategy pass filled in.
            expect(profile.attachmentTower.towerCharacters.length).toBeGreaterThan(0);
            expect(profile.attachmentTower.shunsen.searchOrder[0]).toBe('self-understanding');
        });

        it('stops paying for cards out of the honor track, against everyone', function() {
            const profile = resolveDeckProfile(
                ['iron-mountain-castle', 'illustrious-forge'],
                ATTACHMENTS
            );
            // `cardsOverHonor` keeps bidding high until our honor reaches 2,
            // and the field punishes that twice: the honor paid is the honor a
            // dishonor deck strips, and the honor an honor deck needs to reach
            // 25. Measured +4.03pp over 12 bases / 3818 games (p=0.012).
            //
            // Narrowing it to only the decks that can END the game on the honor
            // track was measured and REJECTED at -1.83pp (p=0.0001): honor bled
            // at a bid is honor gone whoever is sitting opposite.
            expect(profile.drawBidding.cardsOverHonor).toBe(false);
            expect(profile.drawBidding.cardsOverHonorDisableVsHonorPlan).toBe(false);
            // The rest of the tower bid profile is untouched: this deck still
            // needs to draw its Weapons and reducers.
            expect(profile.drawBidding.objective).toBe('cards');
            expect(profile.drawBidding.minimumRoutineBid).toBe(4);
        });

        it('turns the reveal-ready policy on for Waterfall Tattoo only', function() {
            const profile = resolveDeckProfile(
                ['iron-mountain-castle', 'illustrious-forge'],
                ATTACHMENTS
            );
            expect(profile.revealReady.enabled).toBe(true);
            expect(profile.revealReady.attachmentIds).toEqual(['waterfall-tattoo']);
            // Every other deck keeps V1: the policy is inert without an entry.
            expect(profileFromStrategy({ ...ATTACHMENTS, attachmentTower: false })
                .revealReady.enabled).toBe(false);
        });
    });

    describe('tower construction', function() {
        it('buys a preferred tower only with three fate available', function() {
            const cards = [
                { uuid: 'yokuni', id: 'togashi-yokuni', type: 'character' },
                { uuid: 'raitsugu', id: 'mirumoto-raitsugu', type: 'character' }
            ];
            expect(tactics.pickDynastyTower(cards, { yokuni: 5, raitsugu: 3 }, 6, []).id)
                .toBe('mirumoto-raitsugu');
            expect(tactics.pickDynastyTower([cards[0]], { yokuni: 5 }, 7, [])).toBeNull();
            expect(tactics.desiredAdditionalFate('togashi-yokuni', 9, 5)).toBe(4);
            expect(tactics.desiredAdditionalFate('doomed-shugenja', 9, 1)).toBeNull();
        });

        it('mulligans support cards but keeps tower candidates', function() {
            expect(tactics.shouldMulliganDynasty({ id: 'agasha-swordsmith' })).toBe(true);
            expect(tactics.shouldMulliganDynasty({ id: 'togashi-yokuni' })).toBe(false);
        });

        it('permits a third Restricted attachment only on Dragon characters', function() {
            const yokuni = {
                id: 'togashi-yokuni', fate: 4,
                attachments: [{ id: 'fine-katana' }, { id: 'ornate-fan' }]
            };
            const hiruma = {
                id: 'hiruma-skirmisher', fate: 2,
                attachments: [{ id: 'fine-katana' }, { id: 'ornate-fan' }]
            };
            expect(tactics.pickAttachmentTarget([yokuni], 'ancestral-daisho')).toBe(yokuni);
            expect(tactics.pickAttachmentTarget([hiruma], 'ancestral-daisho')).toBeNull();
            yokuni.attachments.push({ id: 'kitsuki-s-method' });
            expect(tactics.pickAttachmentTarget([yokuni], 'jade-tetsubo')).toBeNull();
        });

        it('uses a Weapon to ready bowed Niten Master first', function() {
            const yokuni = { id: 'togashi-yokuni', fate: 5, bowed: false, attachments: [] };
            const niten = { id: 'niten-master', fate: 3, bowed: true, attachments: [] };
            expect(tactics.pickAttachmentTarget([yokuni, niten], 'fine-katana')).toBe(niten);
            expect(tactics.shouldHoldWeapon('fine-katana', [yokuni, niten])).toBe(false);
            niten.bowed = false;
            expect(tactics.shouldHoldWeapon('fine-katana', [yokuni, niten])).toBe(true);
            expect(tactics.shouldHoldWeapon('adopted-kin', [yokuni, niten])).toBe(false);
            yokuni.bowed = true;
            expect(tactics.shouldHoldWeapon('fine-katana', [yokuni, niten], true)).toBe(false);
            expect(tactics.pickAttachmentTarget([yokuni, niten], 'fine-katana', undefined, true)).toBe(yokuni);
            yokuni.bowed = false;
            expect(tactics.shouldHoldWeapon('fine-katana', [yokuni, niten], true)).toBe(true);
        });

        it('keeps Adopted Kin and Tetsubo of Blood to one copy per tower', function() {
            const occupied = {
                id: 'togashi-yokuni', fate: 5,
                attachments: [{ id: 'adopted-kin' }, { id: 'tetsubo-of-blood' }]
            };
            const open = { id: 'niten-master', fate: 3, attachments: [] };
            expect(tactics.pickAttachmentTarget([occupied, open], 'adopted-kin')).toBe(open);
            expect(tactics.pickAttachmentTarget([occupied, open], 'tetsubo-of-blood')).toBe(open);
        });

        it('distributes every non-stacking attachment before adding a duplicate', function() {
            const stackable = new Set(DRAGON_ATTACHMENT_DEFAULTS.stackableAttachments);
            const singletonAttachments = DRAGON_ATTACHMENT_DEFAULTS.attachments
                .filter((id) => !stackable.has(id));

            for(const id of singletonAttachments) {
                const occupied = {
                    id: 'togashi-yokuni', fate: 5, bowed: false,
                    attachments: [{ id }]
                };
                const open = {
                    id: 'niten-master', fate: 3, bowed: false,
                    attachments: []
                };
                expect(tactics.pickAttachmentTarget([occupied, open], id))
                    .withContext(id)
                    .toBe(open);
                open.attachments.push({ id });
                expect(tactics.pickAttachmentTarget([occupied, open], id))
                    .withContext(`${id} saturated`)
                    .toBeNull();
            }
        });

        it('allows stat attachments to stack through the third Restricted slot', function() {
            for(const id of ['fine-katana', 'ornate-fan', 'ancestral-daisho', 'kitsuki-s-method']) {
                const tower = {
                    id: 'togashi-yokuni', fate: 5, bowed: false,
                    attachments: [{ id }, { id: 'elegant-tessen' }]
                };
                const fallback = {
                    id: 'niten-master', fate: 3, bowed: false,
                    attachments: []
                };
                expect(tactics.pickAttachmentTarget([tower, fallback], id))
                    .withContext(id)
                    .toBe(tower);
                tower.attachments.push({ id: 'jade-tetsubo' });
                expect(tactics.pickAttachmentTarget([tower, fallback], id))
                    .withContext(`${id} at Restricted cap`)
                    .toBe(fallback);
            }
        });

        it('stacks all three Pathfinder Blades on one bearer', function() {
            // Not Restricted, so the cap never applies: the whole point of the
            // axis split is that +1 three times on one body is +3 military.
            const tower = {
                id: 'togashi-yokuni', uuid: 'yokuni', fate: 5, bowed: false,
                attachments: [{ id: 'pathfinder-s-blade' }, { id: 'pathfinder-s-blade' }]
            };
            const fallback = {
                id: 'niten-master', uuid: 'niten', fate: 3, bowed: false, attachments: []
            };
            expect(tactics.pickAttachmentTarget([tower, fallback], 'pathfinder-s-blade'))
                .toBe(tower);
        });

        it('copies the requested Yokuni ability order', function() {
            const cards = [
                { id: 'solitary-hero', uuid: 'solitary' },
                { id: 'mirumoto-raitsugu', uuid: 'raitsugu' },
                { id: 'niten-master', uuid: 'niten' }
            ];
            expect(tactics.pickYokuniCopy(cards).id).toBe('niten-master');
        });

        it('falls back to the best legal enemy ability for Yokuni', function() {
            const enemies = [
                { id: 'doji-whisperer', uuid: 'whisperer', fate: 2 },
                { id: 'tengu-sensei', uuid: 'tengu', fate: 1 }
            ];
            const pick = tactics.pickYokuniCopy([], enemies, (card) =>
                card.id === 'tengu-sensei' ? 9 : 4);
            expect(pick.id).toBe('tengu-sensei');
        });

        it('only prepares Daimyo\'s Favor for a paid attachment on its bearer', function() {
            const favor = { id: 'daimyo-s-favor', uuid: 'favor', type: 'attachment', bowed: false };
            const yokuni = {
                id: 'togashi-yokuni', uuid: 'yokuni', type: 'character',
                attachments: [favor]
            };
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                hand: [{ id: 'adopted-kin', uuid: 'free', cost: '0', isPlayableByMe: true }]
            })).toBe(false);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                hand: [
                    { id: 'adopted-kin', uuid: 'free', cost: '0', isPlayableByMe: true },
                    { id: 'ancestral-daisho', uuid: 'paid', cost: '1', isPlayableByMe: true }
                ]
            })).toBe(true);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                stronghold: { id: 'iron-mountain-castle', bowed: false },
                hand: [{ id: 'ancestral-daisho', uuid: 'paid', cost: '1', isPlayableByMe: true }]
            })).toBe(false);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                stronghold: { id: 'iron-mountain-castle', bowed: false },
                hand: [{ id: 'tetsubo-of-blood', uuid: 'blood', cost: '1', isPlayableByMe: true }]
            })).toBe(false);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                stronghold: { id: 'iron-mountain-castle', bowed: true },
                hand: [{ id: 'tetsubo-of-blood', uuid: 'blood', cost: '1', isPlayableByMe: true }]
            })).toBe(true);
            const readyNiten = {
                id: 'niten-master', uuid: 'niten', type: 'character', bowed: false,
                attachments: [favor]
            };
            const activeTetsubo = { id: 'tetsubo-of-blood', uuid: 'active-blood', isPlayableByMe: true };
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [readyNiten],
                stronghold: { id: 'iron-mountain-castle', bowed: true },
                hand: [activeTetsubo], conflictCosts: { 'active-blood': 1 }
            })).toBe(false);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [readyNiten],
                stronghold: { id: 'iron-mountain-castle', bowed: true },
                hand: [activeTetsubo], conflictCosts: { 'active-blood': 1 },
                activeConflict: true
            })).toBe(true);
            expect(tactics.shouldUseDaimyoFavor(favor, {
                myCharacters: [yokuni],
                stronghold: { id: 'iron-mountain-castle', bowed: false },
                hand: [{ id: 'jade-tetsubo', uuid: 'paid-two', isPlayableByMe: true }],
                conflictCosts: { 'paid-two': 2 }
            })).toBe(true);
            expect(tactics.pickDaimyoReducedAttachment([
                { id: 'adopted-kin', uuid: 'free', cost: '0', isPlayableByMe: true },
                { id: 'ancestral-daisho', uuid: 'paid', cost: '1', isPlayableByMe: true }
            ], [yokuni], 'yokuni').id).toBe('ancestral-daisho');
        });

        it('no longer steers Water, whose recursion card left the deck', function() {
            const board = [{ id: 'mirumoto-raitsugu' }];
            const discard = [{ id: 'fine-katana' }];
            expect(tactics.ringBonus('water', board, discard)).toBe(0);
        });

        it('still steers Void for Inscribed Tanto and Fire for an unhonored tower', function() {
            const tanto = [{ id: 'niten-master', attachments: [{ id: 'inscribed-tanto' }] }];
            expect(tactics.ringBonus('void', tanto, [])).toBeGreaterThan(0);
            const built = [{ id: 'niten-master', attachments: [{ id: 'fine-katana' }], isHonored: false }];
            expect(tactics.ringBonus('fire', built, [])).toBeGreaterThan(0);
        });

    });


    // ==================================================================
    // Deck revision 0.5
    // ==================================================================

    describe('axis tower split', function() {
        const military = { uuid: 'mil', id: 'niten-master', fate: 3, attachments: [],
            militarySkillSummary: { stat: '6' }, politicalSkillSummary: { stat: '2' } };
        const political = { uuid: 'pol', id: 'togashi-yokuni', fate: 3, attachments: [],
            militarySkillSummary: { stat: '2' }, politicalSkillSummary: { stat: '6' } };

        it('classifies each attachment by the axis it actually buffs', function() {
            expect(tactics.attachmentAxis('tetsubo-of-blood')).toBe('military');
            expect(tactics.attachmentAxis('pathfinder-s-blade')).toBe('military');
            expect(tactics.attachmentAxis('self-understanding')).toBe('political');
            expect(tactics.attachmentAxis('ornate-fan')).toBe('political');
            // Symmetric and ability-only cards go on either tower.
            expect(tactics.attachmentAxis('elegant-tessen')).toBe('either');
            expect(tactics.attachmentAxis('waterfall-tattoo')).toBe('either');
            expect(tactics.attachmentAxis('the-stone-of-sorrows')).toBe('either');
            expect(tactics.attachmentAxis('adopted-kin')).toBe('either');
            expect(tactics.attachmentAxis('daimyo-s-favor')).toBe('either');
            expect(tactics.attachmentAxis('finger-of-jade')).toBe('either');
        });

        it('names one military tower and one political tower', function() {
            const axes = tactics.towerAxes([military, political]);
            expect(axes.get('mil')).toBe('military');
            expect(axes.get('pol')).toBe('political');
        });

        it('sends military attachments to the military tower', function() {
            expect(tactics.pickAttachmentTarget([political, military], 'pathfinder-s-blade').uuid)
                .toBe('mil');
            expect(tactics.pickAttachmentTarget([political, military], 'fine-katana').uuid)
                .toBe('mil');
        });

        it('sends political attachments to the political tower', function() {
            expect(tactics.pickAttachmentTarget([political, military], 'ornate-fan').uuid)
                .toBe('pol');
            expect(tactics.pickAttachmentTarget([political, military], 'kitsuki-s-method').uuid)
                .toBe('pol');
        });

        it('lets a symmetric attachment follow the ordinary tower ranking', function() {
            // Fate is the ordinary tie-break, so the richer body wins whichever
            // axis it is being built for.
            const rich = { ...political, fate: 5 };
            expect(tactics.pickAttachmentTarget([military, rich], 'finger-of-jade').uuid)
                .toBe('pol');
        });

        it('leaves the split off when the profile disables it', function() {
            const flat = new DragonAttachmentTactics({
                ...DRAGON_ATTACHMENT_DEFAULTS, axisTowerSplit: false
            });
            // With the split off, ornate-fan follows raw tower ranking (equal
            // fate, equal attachment counts) and lands on the ranked-first body.
            const chosen = flat.pickAttachmentTarget([political, military], 'ornate-fan');
            expect(chosen.uuid).toBe('pol');
            // ...and the military card no longer avoids the political tower.
            const withRichPolitical = flat.pickAttachmentTarget(
                [military, { ...political, fate: 9 }], 'fine-katana');
            expect(withRichPolitical.uuid).toBe('pol');
        });

        it('never breaks the Restricted cap to satisfy the axis', function() {
            const cappedMilitary = {
                ...military,
                attachments: [{ id: 'fine-katana' }, { id: 'jade-tetsubo' }, { id: 'ancestral-daisho' }]
            };
            // Three Restricted already on a Dragon body: the military card has
            // to go somewhere legal instead.
            expect(tactics.pickAttachmentTarget([cappedMilitary, political], 'elegant-tessen').uuid)
                .toBe('pol');
        });
    });

    describe('Agasha Shunsen', function() {
        const lastConflict = {
            myConflictsRemaining: 0,
            opponentConflictsRemaining: 0,
            claimedRingCount: 3,
            selfUnderstandingParticipating: false
        };

        it('holds the ability until our last conflict opportunities are close', function() {
            // `maxConflictsRemaining` ships at 1: the second-to-last conflict
            // counts as late enough. Relaxing it further was measured inert on
            // the firing rate (the extra windows are ones the ENGINE refuses),
            // and tightening it to 0 refused the owner's own scenario — a tower
            // on the board, rings claimed, one opportunity left.
            expect(tactics.shouldUseShunsen(lastConflict)).toBe(true);
            expect(tactics.shouldUseShunsen({ ...lastConflict, myConflictsRemaining: 1 })).toBe(true);
            expect(tactics.shouldUseShunsen({ ...lastConflict, myConflictsRemaining: 2 })).toBe(false);
        });

        it('keeps the threshold as an injectable knob', function() {
            const strict = new DragonAttachmentTactics({
                shunsen: { ...DRAGON_ATTACHMENT_DEFAULTS.shunsen, maxConflictsRemaining: 0 }
            });
            expect(strict.shouldUseShunsen({ ...lastConflict, myConflictsRemaining: 1 })).toBe(false);
            expect(strict.shouldUseShunsen(lastConflict)).toBe(true);
        });

        it('fires during the opponent’s conflict once we have none left', function() {
            // The Action's condition is `game.isDuringConflict()`, so whose
            // conflict it is does not matter. Waiting for the opponent to run
            // out too is waiting for a window that may never open.
            expect(tactics.shouldUseShunsen({ ...lastConflict, opponentConflictsRemaining: 2 }))
                .toBe(true);
        });

        it('keeps the stricter both-players-out reading available as an arm', function() {
            const strict = new DragonAttachmentTactics({
                shunsen: { ...DRAGON_ATTACHMENT_DEFAULTS.shunsen, requireOpponentOutOfConflicts: true }
            });
            expect(strict.shouldUseShunsen(lastConflict)).toBe(true);
            expect(strict.shouldUseShunsen({ ...lastConflict, opponentConflictsRemaining: 1 }))
                .toBe(false);
        });

        it('does nothing without a claimed ring to spend', function() {
            expect(tactics.shouldUseShunsen({ ...lastConflict, claimedRingCount: 0 })).toBe(false);
        });

        describe('declaring to open the last window', function() {
            const stranded = {
                myConflictOpportunities: 1,
                opponentConflictsRemaining: 0,
                claimedRingCount: 2,
                shunsenActionAvailable: true,
                hasBearer: true
            };

            it('declares the conflict rather than strand the Action', function() {
                expect(tactics.shouldDeclareForShunsen(stranded)).toBe(true);
            });

            it('waits while we still hold another conflict opportunity', function() {
                expect(tactics.shouldDeclareForShunsen({
                    ...stranded, myConflictOpportunities: 2
                })).toBe(false);
            });

            it('passes when the opponent can still open a window for us', function() {
                // The Action does not care whose conflict it is, so a conflict
                // the OPPONENT is going to declare is a free window and our
                // bodies stay home.
                expect(tactics.shouldDeclareForShunsen({
                    ...stranded, opponentConflictsRemaining: 1
                })).toBe(false);
            });

            it('needs the whole payoff already on the table', function() {
                expect(tactics.shouldDeclareForShunsen({ ...stranded, claimedRingCount: 0 }))
                    .toBe(false);
                expect(tactics.shouldDeclareForShunsen({ ...stranded, shunsenActionAvailable: false }))
                    .toBe(false);
                expect(tactics.shouldDeclareForShunsen({ ...stranded, hasBearer: false }))
                    .toBe(false);
            });

            it('is a knob, so the whole override is an A/B arm', function() {
                const off = new DragonAttachmentTactics({
                    shunsen: { ...DRAGON_ATTACHMENT_DEFAULTS.shunsen, declareToTrigger: false }
                });
                expect(off.shouldDeclareForShunsen(stranded)).toBe(false);
            });
        });

        it('refuses to empty the pool a participating Self-Understanding reads', function() {
            expect(tactics.shouldUseShunsen({ ...lastConflict, selfUnderstandingParticipating: true }))
                .toBe(false);
        });

        it('returns as many rings as possible, capped at the deck maximum cost', function() {
            expect(tactics.shunsenRingsToReturn(0)).toBe(0);
            expect(tactics.shunsenRingsToReturn(2)).toBe(2);
            expect(tactics.shunsenRingsToReturn(3)).toBe(3);
            // A fourth ring buys nothing: the deck's dearest attachment is 3.
            expect(tactics.shunsenRingsToReturn(5)).toBe(3);
        });

        it('follows the owner search order inside the ring budget', function() {
            const pool = [
                { uuid: 'a', id: 'tetsubo-of-blood', cost: 1 },
                { uuid: 'b', id: 'the-stone-of-sorrows', cost: 2 },
                { uuid: 'c', id: 'jade-tetsubo', cost: 2 },
                { uuid: 'd', id: 'waterfall-tattoo', cost: 2 },
                { uuid: 'e', id: 'self-understanding', cost: 3 },
                { uuid: 'f', id: 'ornate-fan', cost: 0 }
            ];
            expect(tactics.pickShunsenAttachment(pool, 3).id).toBe('self-understanding');
            expect(tactics.pickShunsenAttachment(pool, 2).id).toBe('waterfall-tattoo');
            expect(tactics.pickShunsenAttachment(pool, 1).id).toBe('tetsubo-of-blood');
            // Nothing from the ranked list is affordable at zero, so the last
            // entry ("any other attachment") answers.
            expect(tactics.pickShunsenAttachment(pool, 0).id).toBe('ornate-fan');
        });

        it('puts the attachment on a tower that still has fate', function() {
            const towerWithFate = { uuid: 'tower', id: 'niten-master', fate: 2, attachments: [] };
            const towerNoFate = { uuid: 'broke', id: 'togashi-yokuni', fate: 0, attachments: [] };
            expect(tactics.pickShunsenTarget([towerNoFate, towerWithFate]).uuid).toBe('tower');
        });

        it('falls back to the strongest body with fate when no tower has any', function() {
            const towerNoFate = { uuid: 'broke', id: 'niten-master', fate: 0, attachments: [] };
            const helper = {
                uuid: 'helper', id: 'agasha-swordsmith', fate: 1, attachments: [],
                militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '2' }
            };
            const stronger = {
                uuid: 'stronger', id: 'doomed-shugenja', fate: 1, attachments: [],
                militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '3' }
            };
            expect(tactics.pickShunsenTarget([towerNoFate, helper, stronger], 'military').uuid)
                .toBe('stronger');
        });

        it('still answers when nothing on the board has fate', function() {
            const only = { uuid: 'only', id: 'niten-master', fate: 0, attachments: [] };
            expect(tactics.pickShunsenTarget([only]).uuid).toBe('only');
        });

        it('is not bought as a body until a tower is standing', function() {
            const playable = [{ uuid: 'shunsen', id: 'agasha-shunsen', type: 'character' }];
            const costs = { shunsen: 3 };
            expect(tactics.pickSupportCharacter(playable, costs, 8, [])).toBeNull();
            const withTower = [{ id: 'niten-master', type: 'character' }];
            expect(tactics.pickSupportCharacter(playable, costs, 8, withTower).id)
                .toBe('agasha-shunsen');
        });
    });

    describe('The Stone of Sorrows', function() {
        const empty = { ringFate: 0, activeConflict: false, skillNeeded: null, bonshoInPlay: false };

        it('plays it as soon as there is ring fate to lock away', function() {
            expect(tactics.shouldPlayStoneOfSorrows({ ...empty, ringFate: 1 })).toBe(true);
        });

        it('plays it on sight while a Revered Bonsho is stacking the rings', function() {
            expect(tactics.shouldPlayStoneOfSorrows({ ...empty, bonshoInPlay: true })).toBe(true);
        });

        it('holds it with the rings empty', function() {
            expect(tactics.shouldPlayStoneOfSorrows(empty)).toBe(false);
        });

        it('spends it as a plain +1 only when that flips the conflict', function() {
            expect(tactics.shouldPlayStoneOfSorrows({
                ...empty, activeConflict: true, skillNeeded: 1
            })).toBe(true);
            expect(tactics.shouldPlayStoneOfSorrows({
                ...empty, activeConflict: true, skillNeeded: 2
            })).toBe(false);
            expect(tactics.shouldPlayStoneOfSorrows({
                ...empty, activeConflict: true, skillNeeded: 0
            })).toBe(false);
        });

        it('keeps the bearer home while a Bonsho is in play', function() {
            const bearer = { uuid: 'b', id: 'niten-master', attachments: [{ id: 'the-stone-of-sorrows' }] };
            const plain = { uuid: 'p', id: 'mirumoto-raitsugu', attachments: [] };
            expect(tactics.stoneBearerStaysHome(bearer, true)).toBe(true);
            // No Bonsho: the lock is worth nothing, so the body attacks.
            expect(tactics.stoneBearerStaysHome(bearer, false)).toBe(false);
            expect(tactics.stoneBearerStaysHome(plain, true)).toBe(false);
        });
    });

    describe('Waterfall Tattoo', function() {
        const bowed = { uuid: 'bowed', id: 'mirumoto-raitsugu', bowed: true, attachments: [],
            militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' } };
        const ready = { uuid: 'ready', id: 'niten-master', bowed: false, attachments: [],
            militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '4' } };
        const base = {
            myCharacters: [bowed, ready],
            opponentConflictsRemaining: 1,
            opponentMilitaryRemaining: 1,
            opponentPoliticalRemaining: 1,
            opponentReady: [{ military: 3, political: 2 }],
            facedownProvinceCount: 2
        };

        it('attaches to a bowed body when all three legs hold', function() {
            expect(tactics.waterfallTattooBearer(base).uuid).toBe('bowed');
        });

        it('needs a bowed body', function() {
            expect(tactics.waterfallTattooBearer({ ...base, myCharacters: [ready] })).toBeNull();
        });

        it('needs the opponent to still have a conflict opportunity', function() {
            expect(tactics.waterfallTattooBearer({
                ...base, opponentConflictsRemaining: 0
            })).toBeNull();
        });

        it('needs a ready enemy legally able to declare a remaining type', function() {
            // Only a military opportunity left, and their board is all dashes
            // on military: nothing can be declared, so nothing reveals.
            expect(tactics.waterfallTattooBearer({
                ...base,
                opponentMilitaryRemaining: 1,
                opponentPoliticalRemaining: 0,
                opponentReady: [{ military: null, political: 4 }]
            })).toBeNull();
            // The same board with a political opportunity CAN declare.
            expect(tactics.waterfallTattooBearer({
                ...base,
                opponentMilitaryRemaining: 0,
                opponentPoliticalRemaining: 1,
                opponentReady: [{ military: null, political: 4 }]
            }).uuid).toBe('bowed');
        });

        it('needs a facedown province for the reveal to happen at all', function() {
            expect(tactics.waterfallTattooBearer({ ...base, facedownProvinceCount: 0 })).toBeNull();
        });

        it('needs the reveal to be LIKELY, not merely possible', function() {
            // One outer province left facedown out of four: the opponent's
            // next declaration almost certainly lands on one already faceup,
            // which reveals nothing and the card is a wasted +1/+1.
            expect(tactics.waterfallTattooBearer({
                ...base, facedownOuterProvinceCount: 1
            })).toBeNull();
            expect(tactics.waterfallTattooBearer({
                ...base, facedownOuterProvinceCount: 2
            }).uuid).toBe('bowed');
        });

        it('stops once the stronghold province is attackable', function() {
            // Three broken outer provinces open the stronghold province
            // (`ProvinceCard.canBeAttacked`). From there the opponent attacks
            // that, not the one outer province we have left, and the stronghold
            // province is usually already faceup from an earlier attack.
            expect(tactics.waterfallTattooBearer({
                ...base, facedownOuterProvinceCount: 2, brokenOuterProvinceCount: 3
            })).toBeNull();
            expect(tactics.waterfallTattooBearer({
                ...base, facedownOuterProvinceCount: 2, brokenOuterProvinceCount: 2
            }).uuid).toBe('bowed');
        });

        it('falls back to the aggregate count for callers without the split', function() {
            // Synthetic callers that omit `facedownOuterProvinceCount` keep the
            // pre-0.6 behaviour instead of silently refusing every play.
            expect(tactics.waterfallTattooBearer({
                ...base, facedownProvinceCount: 2, facedownOuterProvinceCount: undefined
            }).uuid).toBe('bowed');
        });

        it('does not need a Restricted slot, because it is not Restricted', function() {
            // Three Restricted attachments on a Dragon body is the legal cap,
            // and the tattoo does not consume one.
            const full = {
                ...bowed,
                attachments: [{ id: 'fine-katana' }, { id: 'jade-tetsubo' }, { id: 'ancestral-daisho' }]
            };
            expect(DRAGON_ATTACHMENT_DEFAULTS.restrictedAttachments).not.toContain('waterfall-tattoo');
            expect(tactics.waterfallTattooBearer({ ...base, myCharacters: [full] }).uuid).toBe('bowed');
        });

        it('never doubles up on a bearer that already carries one', function() {
            const carried = { ...bowed, attachments: [{ id: 'waterfall-tattoo' }] };
            expect(tactics.waterfallTattooBearer({ ...base, myCharacters: [carried] })).toBeNull();
        });

        it('prefers the bowed body that gives the most back when it stands up', function() {
            const small = { uuid: 'small', id: 'kitsuki-counselor', bowed: true, attachments: [],
                militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '1' } };
            expect(tactics.waterfallTattooBearer({
                ...base, myCharacters: [small, bowed]
            }).uuid).toBe('bowed');
        });

        it('reads the opponent declaration rules directly', function() {
            expect(tactics.opponentCanDeclare({
                opponentReady: [], opponentMilitaryRemaining: 1, opponentPoliticalRemaining: 1
            })).toBe(false);
            expect(tactics.opponentCanDeclare({
                opponentReady: [{ military: null, political: null }],
                opponentMilitaryRemaining: 1, opponentPoliticalRemaining: 1
            })).toBe(false);
            // Both typed counters at zero can still mean a forced extra
            // conflict, so treat either axis as possible.
            expect(tactics.opponentCanDeclare({
                opponentReady: [{ military: 2, political: 2 }],
                opponentMilitaryRemaining: 0, opponentPoliticalRemaining: 0
            })).toBe(true);
        });
    });

    describe('Agasha Taiko', function() {
        const province = (id, extras = {}) => ({
            uuid: id, id, type: 'province', isProvince: true,
            strengthSummary: { stat: '4' }, ...extras
        });

        it('protects the owner order, top first', function() {
            const provinces = [
                province('manicured-garden'), province('pilgrimage'),
                province('restoration-of-balance'), province('city-of-the-rich-frog')
            ];
            expect(tactics.pickTaikoProvince(provinces).id).toBe('city-of-the-rich-frog');
        });

        it('has no Public Forum in revision 0.5', function() {
            // The province was cut from the deck; City of the Rich Frog took
            // its place at the head of the list.
            expect(DRAGON_ATTACHMENT_DEFAULTS.agashaTaiko.provincePriority)
                .toEqual(['city-of-the-rich-frog', 'pilgrimage', 'manicured-garden']);
        });

        it('steps past City of the Rich Frog once it is broken', function() {
            const provinces = [
                province('manicured-garden'), province('pilgrimage'),
                province('city-of-the-rich-frog', { isBroken: true })
            ];
            expect(tactics.pickTaikoProvince(provinces).id).toBe('pilgrimage');
        });

        it('steps to the next entry only once the one before it is broken', function() {
            const provinces = [
                province('manicured-garden'), province('pilgrimage', { isBroken: true })
            ];
            expect(tactics.pickTaikoProvince(provinces).id).toBe('manicured-garden');
        });

        it('protects the strongest unbroken province when the list is exhausted', function() {
            const provinces = [
                province('restoration-of-balance', { strengthSummary: { stat: '3' } }),
                province('illustrious-forge', { strengthSummary: { stat: '5' } })
            ];
            expect(tactics.pickTaikoProvince(provinces).id).toBe('illustrious-forge');
        });

        it('skips a facedown province whose own on-reveal reaction is still owed', function() {
            const shipped = new DragonAttachmentTactics({
                agashaTaiko: {
                    ...DRAGON_ATTACHMENT_DEFAULTS.agashaTaiko,
                    provincePriority: [
                        'city-of-the-rich-frog', 'manicured-garden',
                        'illustrious-forge', 'restoration-of-balance'
                    ],
                    requireRevealedIds: ['illustrious-forge']
                }
            });
            const facedownForge = province('illustrious-forge', { facedown: true });
            const revealedForge = province('illustrious-forge', { facedown: false });
            const restoration = province('restoration-of-balance');

            // Facedown: protecting it would give up its own top-five search,
            // which only fires when the province is revealed.
            expect(shipped.pickTaikoProvince([facedownForge, restoration]).id)
                .toBe('restoration-of-balance');
            // Revealed: the reaction is spent, so the province is worth saving
            // and it outranks Restoration of Balance again.
            expect(shipped.pickTaikoProvince([revealedForge, restoration]).id)
                .toBe('illustrious-forge');
        });

        it('answers nothing when every province is already broken', function() {
            expect(tactics.pickTaikoProvince([
                province('pilgrimage', { isBroken: true })
            ])).toBeNull();
        });
    });

    describe('Illustrious Forge', function() {
        const card = (id) => ({ uuid: id, id, type: 'attachment' });

        it('takes the biggest military bonus in a military conflict', function() {
            const pool = [card('ornate-fan'), card('tetsubo-of-blood'), card('elegant-tessen')];
            expect(tactics.pickForgeAttachment(pool, 'military').id).toBe('tetsubo-of-blood');
        });

        it('takes the biggest political bonus in a political conflict', function() {
            const pool = [card('tetsubo-of-blood'), card('self-understanding'), card('ornate-fan')];
            expect(tactics.pickForgeAttachment(pool, 'political').id).toBe('self-understanding');
        });

        it('breaks equal-skill ties in the owner order', function() {
            // Every one of these is +1/+1 or +0/+0.
            const tied = [card('adopted-kin'), card('finger-of-jade'), card('elegant-tessen'),
                card('the-stone-of-sorrows'), card('waterfall-tattoo'), card('daimyo-s-favor')];
            expect(tactics.pickForgeAttachment(tied, 'military').id).toBe('waterfall-tattoo');
            const withoutTattoo = tied.filter((entry) => entry.id !== 'waterfall-tattoo');
            expect(tactics.pickForgeAttachment(withoutTattoo, 'military').id)
                .toBe('the-stone-of-sorrows');
            const zeroesOnly = [card('adopted-kin'), card('finger-of-jade'), card('daimyo-s-favor')];
            expect(tactics.pickForgeAttachment(zeroesOnly, 'political').id).toBe('finger-of-jade');
        });

        it('defaults to the military reading with no conflict type published', function() {
            const pool = [card('ornate-fan'), card('fine-katana')];
            expect(tactics.pickForgeAttachment(pool).id).toBe('fine-katana');
        });
    });

    describe('policy integration', function() {
        const fateButtons = ['0', '1', '2', '3', '4'].map((value) =>
            ({ text: value, arg: value, uuid: `fate-${value}` }));
        const bidButtons = ['1', '2', '3', '4', '5'].map((value) =>
            ({ text: value, arg: value, uuid: `bid-${value}` }));

        it('uses the generic draw bid instead of forcing one after round one', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Honor Bid', menuTitle: '',
                        buttons: bidButtons, stats: { honor: 10, fate: 6 },
                        cardPiles: { hand: [{}] }
                    },
                    Opponent: {
                        name: 'Opponent', stats: { honor: 10 },
                        cardPiles: { hand: [{}, {}, {}] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('attachment-bid').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                roundNumber: 2
            });
            expect(decision.reason).toBe('draw-bid-adaptive-fate-cost-pressure');
            expect(decision.target).toBe('4');
        });

        it('does not bow Daimyo\'s Favor for a free attachment', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character',
                location: 'play area', fate: 4, attachments: [favor]
            };
            const free = {
                uuid: 'free', id: 'adopted-kin', type: 'attachment', cost: '0',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [yokuni], hand: [free] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('favor-free').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('attachment-tower-preconflict');
            expect(decision.target).toBe('free');
        });

        it('builds Daimyo\'s Favor before either paid Tetsubo', function() {
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 4, attachments: []
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: {
                            cardsInPlay: [tower],
                            hand: [
                                { uuid: 'blood', id: 'tetsubo-of-blood', type: 'attachment', cost: '1', isPlayableByMe: true },
                                { uuid: 'jade', id: 'jade-tetsubo', type: 'attachment', cost: '2', isPlayableByMe: true },
                                { uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment', cost: '0', isPlayableByMe: true }
                            ]
                        }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('favor-first').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('attachment-tower-preconflict');
            expect(decision.target).toBe('favor');
            expect(tactics.attachmentPriority('daimyo-s-favor'))
                .toBeGreaterThan(tactics.attachmentPriority('tetsubo-of-blood'));
            expect(tactics.attachmentPriority('daimyo-s-favor'))
                .toBeGreaterThan(tactics.attachmentPriority('jade-tetsubo'));
        });

        it('spends Daimyo\'s Favor on a paid attachment on the same bearer', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character',
                location: 'play area', fate: 4, attachments: [favor]
            };
            const free = {
                uuid: 'free', id: 'adopted-kin', type: 'attachment', cost: '0',
                location: 'hand', isPlayableByMe: true
            };
            const paid = {
                uuid: 'paid', id: 'ancestral-daisho', type: 'attachment', cost: '1',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [yokuni], hand: [free, paid] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('favor-paid');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };
            const prepare = policy.decide(state, 'Jigoku Bot', context);
            expect(prepare.reason).toBe('use-conflict-phase-ability');
            expect(prepare.target).toBe('favor');

            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('paid');

            yokuni.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Ancestral Daisho';
            state.players['Jigoku Bot'].menuTitle = 'Choose a character';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const target = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'ancestral-daisho',
                    sourceIsMine: true,
                    gameActions: ['attach']
                }
            });
            expect(target.reason).toBe('daimyo-favor-reduced-attachment-target');
            expect(target.target).toBe('yokuni');
        });

        it('uses Daimyo\'s Favor for Tetsubo during an active conflict when Castle is bowed', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: false, inConflict: true,
                attachments: [favor, { uuid: 'fan', id: 'ornate-fan', type: 'attachment', location: 'play area' }]
            };
            // Live hand summaries omit conflict-card costs. Controller supplies
            // the real printed cost separately through conflictCosts.
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                conflict: {
                    attackingPlayerId: 'OPP', defendingPlayerId: 'BOT',
                    attackerSkill: 4, defenderSkill: 3, type: 'military'
                },
                players: {
                    'Jigoku Bot': {
                        id: 'BOT', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Conflict Action Window', menuTitle: '',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 1, conflictsRemaining: 2 },
                        stronghold: {
                            uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                            location: 'stronghold province', bowed: true
                        },
                        cardPiles: { cardsInPlay: [tower], hand: [tetsubo] }
                    },
                    Opponent: {
                        id: 'OPP', name: 'Opponent', stats: { conflictsRemaining: 1 },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const policy = new FateAwareJigokuBotPolicy(1);
            const context = {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                conflictCosts: { tetsubo: 1 },
                legalDirectCardUuids: { favor: true, tetsubo: true }
            };
            const decision = policy.decide(state, 'Jigoku Bot', context);

            expect(decision.reason).toBe('use-board-ability');
            expect(decision.target).toBe('favor');

            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('play-conflict-card');
            expect(play.target).toBe('tetsubo');

            tower.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Tetsubo of Blood';
            state.players['Jigoku Bot'].menuTitle = 'Choose a character';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const target = policy.decide(state, 'Jigoku Bot', {
                ...context,
                legalDirectCardUuids: undefined,
                targetHint: {
                    sourceCardId: 'tetsubo-of-blood', sourceIsMine: true, gameActions: ['attach']
                }
            });
            expect(target.reason).toBe('daimyo-favor-reduced-attachment-target');
            expect(target.target).toBe('tower');
        });

        it('uses ready Iron Mountain Castle instead of Daimyo\'s Favor for active-conflict Tetsubo', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: false, inConflict: true,
                // Iron Mountain Castle gives Dragon characters a third
                // Restricted slot; Tetsubo must remain playable in that slot.
                attachments: [
                    favor,
                    { uuid: 'daisho', id: 'ancestral-daisho', type: 'attachment', location: 'play area' },
                    { uuid: 'method', id: 'kitsuki-s-method', type: 'attachment', location: 'play area' }
                ]
            };
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const castle = {
                uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                location: 'stronghold province', bowed: false
            };
            const state = {
                conflict: {
                    attackingPlayerId: 'OPP', defendingPlayerId: 'BOT',
                    attackerSkill: 4, defenderSkill: 3, type: 'military'
                },
                players: {
                    'Jigoku Bot': {
                        id: 'BOT', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Conflict Action Window', menuTitle: '',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 1, conflictsRemaining: 2 },
                        stronghold: castle,
                        cardPiles: { cardsInPlay: [tower], hand: [tetsubo] }
                    },
                    Opponent: {
                        id: 'OPP', name: 'Opponent', stats: { conflictsRemaining: 1 },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const policy = new FateAwareJigokuBotPolicy(1);
            const context = {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                conflictCosts: { tetsubo: 1 }
            };

            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(tactics.restrictedCount(tower)).toBe(2);
            expect(tactics.restrictedCap(tower)).toBe(3);
            expect(play.reason).toBe('play-conflict-card');
            expect(play.target).toBe('tetsubo');

            castle.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any interrupts to Tetsubo of Blood being played?';
            const reduce = policy.decide(state, 'Jigoku Bot', {
                ...context,
                playCardId: 'tetsubo-of-blood',
                playCost: 1
            });
            expect(reduce.reason).toBe('iron-mountain-castle-reduce-attachment');
            expect(reduce.target).toBe('castle');
        });

        it('falls back to normal conflict play when Daimyo\'s Favor has no paid attachment to reduce', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: false, inConflict: true,
                attachments: [favor]
            };
            const katana = {
                uuid: 'katana', id: 'fine-katana', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                conflict: {
                    attackingPlayerId: 'OPP', defendingPlayerId: 'BOT',
                    attackerSkill: 4, defenderSkill: 3, type: 'military'
                },
                players: {
                    'Jigoku Bot': {
                        id: 'BOT', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Conflict Action Window', menuTitle: '',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 1, conflictsRemaining: 2 },
                        stronghold: {
                            uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                            location: 'stronghold province', bowed: true
                        },
                        cardPiles: { cardsInPlay: [tower], hand: [katana] }
                    },
                    Opponent: {
                        id: 'OPP', name: 'Opponent', stats: { conflictsRemaining: 1 },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const decision = new FateAwareJigokuBotPolicy(1).decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                conflictCosts: { katana: 0 },
                handStats: { katana: { military: 2, political: 0 } }
            });

            expect(decision.reason).toBe('play-conflict-card');
            expect(decision.target).toBe('katana');
        });

        it('saves Daimyo\'s Favor and uses ready Iron Mountain Castle for Tetsubo of Blood', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, attachments: [favor]
            };
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        stronghold: {
                            uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                            location: 'stronghold province', bowed: false
                        },
                        cardPiles: { cardsInPlay: [tower], hand: [tetsubo] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('castle-tetsubo');
            const context = {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                conflictCosts: { tetsubo: 1 }
            };
            const decision = policy.decide(state, 'Jigoku Bot', context);
            expect(decision.reason).toBe('pass-window');

            tower.bowed = true;
            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('tetsubo');

            state.players['Jigoku Bot'].stronghold.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any interrupts to Tetsubo of Blood being played?';
            const reduce = policy.decide(state, 'Jigoku Bot', {
                ...context,
                playCardId: 'tetsubo-of-blood',
                playCost: 1
            });
            expect(reduce.reason).toBe('iron-mountain-castle-reduce-attachment');
            expect(reduce.target).toBe('castle');
        });

        it('uses ready Iron Mountain Castle on a cost-one fallback when Tetsubo is absent', function() {
            const favor = {
                uuid: 'favor', id: 'daimyo-s-favor', type: 'attachment',
                location: 'play area', bowed: false
            };
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: true, attachments: [favor]
            };
            const fallback = {
                uuid: 'fallback', id: 'ancestral-daisho', type: 'attachment', cost: '1',
                location: 'hand', isPlayableByMe: true
            };
            const castle = {
                uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                location: 'stronghold province', bowed: false
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 }, stronghold: castle,
                        cardPiles: { cardsInPlay: [tower], hand: [fallback] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('castle-fallback');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };
            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('fallback');

            castle.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any interrupts to Ancestral Daisho being played?';
            const interrupt = policy.decide(state, 'Jigoku Bot', context);
            expect(interrupt.reason).toBe('iron-mountain-castle-reduce-attachment');
            expect(interrupt.target).toBe('castle');
        });

        it('saves Iron Mountain Castle when a printed cost-zero attachment is being played', function() {
            const castle = {
                uuid: 'castle', id: 'iron-mountain-castle', type: 'stronghold',
                location: 'stronghold province', bowed: false, selectable: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Triggered Abilities',
                        menuTitle: 'Any interrupts to Fine Katana being played?',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stronghold: castle,
                        cardPiles: { cardsInPlay: [], hand: [] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('castle-free').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                playCardId: 'fine-katana',
                playCost: 0,
                cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('save-iron-mountain-castle-free-attachment');
            expect(decision.target).toBe('Pass');
        });

        it('distinguishes playing Jade Tetsubo from using its fate-removal action', function() {
            const ownTower = {
                uuid: 'own-tower', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, attachments: [], selectable: true
            };
            const enemyTower = {
                uuid: 'enemy-tower', id: 'enemy-tower', type: 'character',
                location: 'play area', fate: 4, military: 6, selectable: false
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Jade Tetsubo', menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [ownTower], hand: [] }
                    },
                    Opponent: {
                        name: 'Opponent',
                        cardPiles: { cardsInPlay: [enemyTower], hand: [] }
                    }
                }
            };
            const policy = new JigokuBotPolicy('jade-tetsubo-routing');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };

            const attach = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'jade-tetsubo', sourceIsMine: true, gameActions: ['attach']
                }
            });
            expect(attach.reason).toBe('attachment-tower-target');
            expect(attach.target).toBe('own-tower');

            ownTower.selectable = false;
            enemyTower.selectable = true;
            const stripFate = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'jade-tetsubo', sourceIsMine: true, gameActions: ['removeFate']
                }
            });
            expect(stripFate.reason).toBe('jade-tetsubo-strip-fate');
            expect(stripFate.target).toBe('enemy-tower');
        });

        it('never lets a Let Go prompt fall through to an own attachment', function() {
            const ownTetsubo = {
                uuid: 'own-tetsubo', id: 'tetsubo-of-blood', name: 'Tetsubo of Blood',
                type: 'attachment', location: 'play area', selectable: true
            };
            const ownTower = {
                uuid: 'own-tower', id: 'niten-master', type: 'character',
                location: 'play area', attachments: [ownTetsubo]
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Let Go', menuTitle: 'Choose a card',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [ownTower], hand: [] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('let-go-own-guard').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('cancel-wrong-side-target');
            expect(decision.target).toBe('Cancel');
        });

        it('does not play Let Go unless the opponent has an attachment', function() {
            const shouldPlay = getPlaybookEntry('let-go').shouldPlay;
            expect(shouldPlay({ opponentCharacters: [] })).toBe(false);
            expect(shouldPlay({
                opponentCharacters: [{ id: 'enemy', attachments: [{ id: 'fine-katana' }] }]
            })).toBe(true);
            expect(shouldPlay({
                opponentCharacters: [],
                myCharacters: [{ id: 'mine', attachments: [{ id: 'pacifism' }] }]
            })).toBe(true);
        });

        it('copies and triggers an enemy Tengu Sensei ability with Yokuni', function() {
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character',
                location: 'play area', fate: 4, attachments: []
            };
            const tengu = {
                uuid: 'tengu', id: 'tengu-sensei', type: 'character',
                location: 'play area', fate: 2
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [yokuni], hand: [] }
                    },
                    Opponent: {
                        name: 'Opponent', stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [tengu], hand: [] }
                    }
                }
            };
            const policy = new JigokuBotPolicy('yokuni-enemy-copy');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };
            const activate = policy.decide(state, 'Jigoku Bot', context);
            expect(activate.reason).toBe('use-conflict-phase-ability');
            expect(activate.target).toBe('yokuni');

            tengu.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Togashi Yokuni';
            state.players['Jigoku Bot'].menuTitle = 'Select a character to copy from';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const copy = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'togashi-yokuni',
                    sourceIsMine: true,
                    gameActions: ['cardLastingEffect']
                }
            });
            expect(copy.reason).toBe('yokuni-copy-enemy-ability');
            expect(copy.target).toBe('tengu');

            tengu.selectable = false;
            yokuni.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Triggered Abilities';
            state.players['Jigoku Bot'].menuTitle = 'Any reactions to Covert being resolved?';
            state.players['Jigoku Bot'].buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            const use = policy.decide(state, 'Jigoku Bot', context);
            expect(use.reason).toBe('trigger-hinted-ability');
            expect(use.target).toBe('yokuni');
        });

        it('holds Weapons until Niten or a Niten-copying Yokuni bows', function() {
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character',
                location: 'play area', fate: 4, bowed: false, attachments: []
            };
            const niten = {
                uuid: 'niten', id: 'niten-master', type: 'character',
                location: 'play area', fate: 3, bowed: false, attachments: []
            };
            const weapon = {
                uuid: 'weapon', id: 'fine-katana', type: 'attachment',
                location: 'hand', isPlayableByMe: true
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action', buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 3 },
                        cardPiles: { cardsInPlay: [yokuni, niten], hand: [weapon] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('niten-weapon-timing');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };

            const activate = policy.decide(state, 'Jigoku Bot', context);
            expect(activate.reason).toBe('use-conflict-phase-ability');
            expect(activate.target).toBe('yokuni');

            niten.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Togashi Yokuni';
            state.players['Jigoku Bot'].menuTitle = 'Select a character to copy from';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const copy = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'togashi-yokuni', sourceIsMine: true, gameActions: ['cardLastingEffect']
                }
            });
            expect(copy.reason).toBe('yokuni-copy-best-ability');
            expect(copy.target).toBe('niten');

            niten.selectable = false;
            state.players['Jigoku Bot'].promptTitle = 'Action Window';
            state.players['Jigoku Bot'].menuTitle = 'Initiate an action';
            state.players['Jigoku Bot'].buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            const held = policy.decide(state, 'Jigoku Bot', context);
            expect(held.reason).toBe('pass-window');

            yokuni.bowed = true;
            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('weapon');

            yokuni.selectable = true;
            state.players['Jigoku Bot'].promptTitle = 'Fine Katana';
            state.players['Jigoku Bot'].menuTitle = 'Choose a character';
            state.players['Jigoku Bot'].buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const target = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: { sourceCardId: 'fine-katana', sourceIsMine: true, gameActions: ['attach'] }
            });
            expect(target.reason).toBe('attachment-tower-target');
            expect(target.target).toBe('yokuni');
        });

        it('places four fate on a funded tower', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Deploy', menuTitle: 'Choose additional fate',
                        buttons: fateButtons, stats: { fate: 9 }
                    }
                }
            };
            const decision = new JigokuBotPolicy('attachment-fate').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                playCardId: 'togashi-yokuni',
                playCost: 5
            });
            expect(decision.reason).toBe('attachment-tower-fate');
            expect(decision.target).toBe('4');
        });

        it('selects a funded tower in the dynasty window', function() {
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'dynasty', promptTitle: 'Action Window', menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }], stats: { fate: 8 },
                        provinces: {
                            one: [{ uuid: 'yokuni', id: 'togashi-yokuni', type: 'character', isDynasty: true, facedown: false }],
                            two: [{ uuid: 'doomed', id: 'doomed-shugenja', type: 'character', isDynasty: true, facedown: false }],
                            three: [], four: []
                        },
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('attachment-dynasty').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                dynastyCosts: { yokuni: 5, doomed: 1 }
            });
            expect(decision.reason).toBe('attachment-tower-play-tower');
            expect(decision.args[0]).toBe('yokuni');
        });

        it('targets the third Restricted slot on a Dragon tower', function() {
            const yokuni = {
                uuid: 'yokuni', id: 'togashi-yokuni', type: 'character', location: 'play area',
                selectable: true, fate: 4,
                attachments: [{ id: 'fine-katana' }, { id: 'ornate-fan' }]
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Ancestral Daisho', menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [yokuni] }
                    }
                }
            };
            const decision = new JigokuBotPolicy('attachment-target').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                targetHint: {
                    sourceCardId: 'ancestral-daisho',
                    sourceIsMine: true,
                    gameActions: ['attach']
                }
            });
            expect(decision.reason).toBe('attachment-tower-target');
            expect(decision.args[0]).toBe('yokuni');
        });

        it('uses the shared singleton rule in attachment target prompts', function() {
            const occupied = {
                uuid: 'occupied', id: 'togashi-yokuni', type: 'character',
                location: 'play area', selectable: true, fate: 5,
                attachments: [{ id: 'jade-tetsubo' }]
            };
            const open = {
                uuid: 'open', id: 'niten-master', type: 'character',
                location: 'play area', selectable: true, fate: 3, attachments: []
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', promptTitle: 'Jade Tetsubo',
                        menuTitle: 'Choose a character',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        cardPiles: { cardsInPlay: [occupied, open] }
                    }
                }
            };
            const decision = new FateAwareJigokuBotPolicy(1).decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                targetHint: {
                    sourceCardId: 'jade-tetsubo', sourceIsMine: true, gameActions: ['attach']
                }
            });

            expect(decision.reason).toBe('attachment-tower-target');
            expect(decision.target).toBe('open');
        });

        it('vetoes a targeted attachment that returns to hand instead of retrying it', function() {
            const tower = {
                uuid: 'tower', id: 'kitsuki-yuikimi', type: 'character',
                location: 'play area', selectable: false, fate: 3, attachments: []
            };
            const tetsubo = {
                uuid: 'tetsubo', id: 'tetsubo-of-blood', type: 'attachment', cost: '1',
                location: 'hand', isPlayableByMe: true
            };
            const bot = {
                name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                menuTitle: 'Initiate an action',
                buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                stats: { honor: 10, fate: 3 },
                cardPiles: { cardsInPlay: [tower], hand: [tetsubo] }
            };
            const state = {
                players: {
                    'Jigoku Bot': bot,
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const policy = new JigokuBotPolicy('returned-attachment');
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };

            const play = policy.decide(state, 'Jigoku Bot', context);
            expect(play.reason).toBe('attachment-tower-preconflict');
            expect(play.target).toBe('tetsubo');

            tower.selectable = true;
            bot.promptTitle = 'Tetsubo of Blood';
            bot.menuTitle = 'Choose a character';
            bot.buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            const target = policy.decide(state, 'Jigoku Bot', {
                ...context,
                targetHint: {
                    sourceCardId: 'tetsubo-of-blood', sourceIsMine: true, gameActions: ['attach']
                }
            });
            expect(target.reason).toBe('attachment-tower-target');
            expect(target.target).toBe('tower');

            // Simulate a later play restriction rejecting the attachment: the
            // prompt returns to the action window while the same UUID is still
            // playable in hand. It must be ignored for the rest of the round.
            tower.selectable = false;
            bot.promptTitle = 'Action Window';
            bot.menuTitle = 'Initiate an action';
            bot.buttons = [{ text: 'Pass', arg: 'pass', uuid: 'pass' }];
            const afterRejection = policy.decide(state, 'Jigoku Bot', context);
            expect(afterRejection.reason).toBe('pass-window');
        });

        // ==============================================================
        // Deck revision 0.5 — live prompt integration
        // ==============================================================

        const facedownProvince = (location) => ({
            uuid: `hidden-${location}`, type: 'province', isProvince: true,
            facedown: true, location
        });
        const faceupProvince = (location, id) => ({
            uuid: `open-${location}`, id, type: 'province', isProvince: true,
            facedown: false, location, strengthSummary: { stat: '4' }
        });

        it('plays Waterfall Tattoo onto a bowed body before the opponent declares', function() {
            const bowedTower = {
                uuid: 'bowed-tower', id: 'mirumoto-raitsugu', type: 'character',
                location: 'play area', bowed: true, fate: 2, attachments: [],
                militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' }
            };
            const readyTower = {
                uuid: 'ready-tower', id: 'niten-master', type: 'character',
                location: 'play area', bowed: false, fate: 3, attachments: [],
                militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '4' }
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 4, conflictsRemaining: 1 },
                        provinces: {
                            one: [facedownProvince('province 1')],
                            two: [facedownProvince('province 2')],
                            three: [faceupProvince('province 3', 'pilgrimage')],
                            four: []
                        },
                        strongholdProvince: [],
                        cardPiles: {
                            cardsInPlay: [bowedTower, readyTower],
                            hand: [{
                                uuid: 'tattoo', id: 'waterfall-tattoo', type: 'attachment',
                                cost: '2', isPlayableByMe: true
                            }]
                        }
                    },
                    Opponent: {
                        name: 'Opponent',
                        stats: { conflictsRemaining: 1, militaryRemaining: 1, politicalRemaining: 1 },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [],
                        cardPiles: {
                            cardsInPlay: [{
                                uuid: 'enemy', id: 'enemy-bushi', type: 'character',
                                location: 'play area', bowed: false,
                                militarySkillSummary: { stat: '3' },
                                politicalSkillSummary: { stat: '3' }
                            }],
                            hand: []
                        }
                    }
                }
            };
            const policy = new JigokuBotPolicy('waterfall-window');
            const play = policy.decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            });
            expect(play.reason).toBe('attachment-tower-waterfall-tattoo');
            expect(play.target).toBe('tattoo');

            // The follow-up attach prompt must land on the BOWED body, not on
            // the better tower the ordinary ranking would pick.
            const me = state.players['Jigoku Bot'];
            me.promptTitle = 'Choose a character';
            me.menuTitle = 'Choose a character';
            me.buttons = [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }];
            bowedTower.selectable = true;
            readyTower.selectable = true;
            const target = policy.decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                targetHint: {
                    sourceCardId: 'waterfall-tattoo', sourceIsMine: true, gameActions: ['attach']
                }
            });
            expect(target.reason).toBe('attachment-tower-waterfall-bearer');
            expect(target.target).toBe('bowed-tower');
        });

        it('holds Waterfall Tattoo when the opponent has no conflict left', function() {
            const bowedTower = {
                uuid: 'bowed-tower', id: 'mirumoto-raitsugu', type: 'character',
                location: 'play area', bowed: true, fate: 2, attachments: [],
                militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' }
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 4, conflictsRemaining: 1 },
                        provinces: {
                            one: [facedownProvince('province 1')],
                            two: [facedownProvince('province 2')],
                            three: [faceupProvince('province 3', 'pilgrimage')],
                            four: []
                        },
                        strongholdProvince: [],
                        cardPiles: {
                            cardsInPlay: [bowedTower],
                            hand: [{
                                uuid: 'tattoo', id: 'waterfall-tattoo', type: 'attachment',
                                cost: '2', isPlayableByMe: true
                            }]
                        }
                    },
                    Opponent: {
                        name: 'Opponent',
                        stats: { conflictsRemaining: 0, militaryRemaining: 0, politicalRemaining: 0 },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [],
                        cardPiles: {
                            cardsInPlay: [{
                                uuid: 'enemy', id: 'enemy-bushi', type: 'character',
                                location: 'play area', bowed: false,
                                militarySkillSummary: { stat: '3' },
                                politicalSkillSummary: { stat: '3' }
                            }],
                            hand: []
                        }
                    }
                }
            };
            const decision = new JigokuBotPolicy('waterfall-hold').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('pass-window');
        });

        it('holds The Stone of Sorrows while the rings are empty', function() {
            const tower = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', bowed: false, fate: 3, attachments: []
            };
            const build = (ringFate) => ({
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict', promptTitle: 'Action Window',
                        menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 4, conflictsRemaining: 1 },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [],
                        cardPiles: {
                            cardsInPlay: [tower],
                            hand: [{
                                uuid: 'stone', id: 'the-stone-of-sorrows', type: 'attachment',
                                cost: '2', isPlayableByMe: true
                            }]
                        }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                },
                rings: {
                    air: { element: 'air', fate: ringFate },
                    earth: { element: 'earth', fate: 0 },
                    fire: { element: 'fire', fate: 0 },
                    water: { element: 'water', fate: 0 },
                    void: { element: 'void', fate: 0 }
                }
            });
            expect(new JigokuBotPolicy('stone-empty').decide(build(0), 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            }).reason).toBe('pass-window');

            const played = new JigokuBotPolicy('stone-fate').decide(build(2), 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            });
            expect(played.reason).toBe('attachment-tower-preconflict');
            expect(played.target).toBe('stone');
        });

        it('answers the Agasha Shunsen ring-return cost up to three rings, then Done', function() {
            const shunsen = {
                uuid: 'shunsen', id: 'agasha-shunsen', type: 'character',
                location: 'play area', selectable: true, fate: 1
            };
            const rings = {
                air: { element: 'air', fate: 0, claimed: true, claimedBy: 'Jigoku Bot' },
                earth: { element: 'earth', fate: 0, claimed: true, claimedBy: 'Jigoku Bot' },
                fire: { element: 'fire', fate: 0, claimed: true, claimedBy: 'Jigoku Bot' },
                water: { element: 'water', fate: 0, claimed: true, claimedBy: 'Jigoku Bot' },
                void: { element: 'void', fate: 0 }
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Choose a ring to return', menuTitle: 'Choose a ring to return',
                        selectRing: true,
                        buttons: [{ text: 'Done', arg: 'done', uuid: 'done' }],
                        stats: { honor: 10, fate: 2 },
                        cardPiles: { cardsInPlay: [shunsen], hand: [] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                },
                rings
            };
            const policy = new JigokuBotPolicy('shunsen-rings');
            const context = {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry,
                targetHint: { sourceCardId: 'agasha-shunsen', sourceIsMine: true, gameActions: [] }
            };
            const returned = [];
            for(let step = 0; step < 4; step++) {
                const decision = policy.decide(state, 'Jigoku Bot', context);
                if(decision.command === 'ringClicked') {
                    returned.push(decision.target);
                    continue;
                }
                expect(decision.reason).toBe('attachment-tower-shunsen-rings-returned');
                break;
            }
            expect(returned.length).toBe(3);
            // Only rings we actually hold claimed may be returned.
            expect(returned).not.toContain('void');
            expect(new Set(returned).size).toBe(3);
        });

        it('holds Agasha Shunsen until the last conflict of the round', function() {
            const shunsen = {
                uuid: 'shunsen', id: 'agasha-shunsen', type: 'character',
                location: 'play area', selectable: true, fate: 1,
                inConflict: true, bowed: false,
                militarySkillSummary: { stat: '1' }, politicalSkillSummary: { stat: '2' }
            };
            const build = (mine, theirs) => ({
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Conflict Action Window', menuTitle: 'Conflict',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 2, conflictsRemaining: mine },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [],
                        cardPiles: { cardsInPlay: [shunsen], hand: [] }
                    },
                    Opponent: {
                        name: 'Opponent',
                        stats: { conflictsRemaining: theirs },
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [],
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                },
                rings: {
                    air: { element: 'air', fate: 0, claimed: true, claimedBy: 'Jigoku Bot' },
                    earth: { element: 'earth', fate: 0, claimed: true, claimedBy: 'Jigoku Bot' },
                    fire: { element: 'fire', fate: 0, claimed: true, claimedBy: 'Jigoku Bot' },
                    water: { element: 'water', fate: 0 },
                    void: { element: 'void', fate: 0 }
                },
                conflict: {
                    type: 'military', conflictType: 'military',
                    attackingPlayerId: 'opponent-id', defendingPlayerId: 'bot-id',
                    attackerSkill: 5, defenderSkill: 4
                }
            });
            // Two of our own opportunities still to come is too early.
            const held = new JigokuBotPolicy('shunsen-early').decide(build(2, 1), 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            });
            expect(held.target).not.toBe('shunsen');

            const fired = new JigokuBotPolicy('shunsen-last').decide(build(0, 0), 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            });
            expect(fired.reason).toBe('use-board-ability');
            expect(fired.args[0]).toBe('shunsen');
        });

        it('lets a Waterfall Tattoo bearer attack while a province is still facedown', function() {
            // `attackKeepHome: 1` with two ready bodies: V1 sends one and keeps
            // one back to defend. The tattooed body is readied by the
            // opponent's own declaration, so keeping it home buys nothing and
            // both may attack.
            const build = (tattooed) => {
                const one = {
                    uuid: 'one', id: 'niten-master', type: 'character', location: 'play area',
                    bowed: false, selectable: true, fate: 2, inConflict: true,
                    militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '4' },
                    attachments: tattooed ? [{ uuid: 'tat', id: 'waterfall-tattoo' }] : []
                };
                const two = {
                    uuid: 'two', id: 'mirumoto-raitsugu', type: 'character', location: 'play area',
                    bowed: false, selectable: true, fate: 2,
                    militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' },
                    attachments: []
                };
                return {
                    players: {
                        'Jigoku Bot': {
                            id: 'bot-id', name: 'Jigoku Bot', phase: 'conflict',
                            promptTitle: 'Military Void Conflict', menuTitle: 'Choose attackers',
                            buttons: [{ text: 'Initiate Conflict', arg: 'done', uuid: 'initiate' }],
                            stats: { honor: 10, fate: 2, conflictsRemaining: 1 },
                            provinces: {
                                one: [facedownProvince('province 1')],
                                two: [facedownProvince('province 2')],
                                three: [facedownProvince('province 3')],
                                four: [facedownProvince('province 4')]
                            },
                            strongholdProvince: [facedownProvince('stronghold province')],
                            cardPiles: { cardsInPlay: [one, two], hand: [] }
                        },
                        Opponent: {
                            id: 'opponent-id', name: 'Opponent',
                            stats: { conflictsRemaining: 1, militaryRemaining: 1, politicalRemaining: 1 },
                            provinces: {
                                one: [{
                                    ...faceupProvince('province 1', 'manicured-garden'),
                                    inConflict: true, strengthSummary: { stat: '12' }
                                }],
                                two: [faceupProvince('province 2', 'pilgrimage')],
                                three: [faceupProvince('province 3', 'ancestral-lands')],
                                four: [faceupProvince('province 4', 'meditations-on-the-tao')]
                            },
                            strongholdProvince: [faceupProvince('stronghold province', 'shameful-display')],
                            cardPiles: {
                                cardsInPlay: [{
                                    uuid: 'enemy', id: 'enemy-bushi', type: 'character',
                                    location: 'play area', bowed: false,
                                    militarySkillSummary: { stat: '2' },
                                    politicalSkillSummary: { stat: '2' }
                                }],
                                hand: []
                            }
                        }
                    },
                    conflict: {
                        type: 'military', conflictType: 'military',
                        attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                        attackerSkill: 4, defenderSkill: 0
                    }
                };
            };
            const profile = resolveDeckProfile(
                ['iron-mountain-castle', 'illustrious-forge'], ATTACHMENTS);
            const context = { profile, strategy: ATTACHMENTS, cardHint: getPlaybookEntry };

            const plain = new JigokuBotPolicy('keep-home-plain')
                .decide(build(false), 'Jigoku Bot', context);
            expect(plain.reason).toBe('initiate-conflict');

            const freed = new JigokuBotPolicy('keep-home-free')
                .decide(build(true), 'Jigoku Bot', context);
            expect(freed.reason).toBe('declare-attacker');
            expect(freed.args[0]).toBe('two');
        });

        it('keeps the tattooed body home once every province is faceup', function() {
            // No facedown province left means nothing can be revealed, so the
            // reaction cannot fire and the body is an ordinary defender again.
            const one = {
                uuid: 'one', id: 'niten-master', type: 'character', location: 'play area',
                bowed: false, selectable: true, fate: 2, inConflict: true,
                militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '4' },
                attachments: [{ uuid: 'tat', id: 'waterfall-tattoo' }]
            };
            const two = {
                uuid: 'two', id: 'mirumoto-raitsugu', type: 'character', location: 'play area',
                bowed: false, selectable: true, fate: 2,
                militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' },
                attachments: []
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        id: 'bot-id', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Military Void Conflict', menuTitle: 'Choose attackers',
                        buttons: [{ text: 'Initiate Conflict', arg: 'done', uuid: 'initiate' }],
                        stats: { honor: 10, fate: 2, conflictsRemaining: 1 },
                        provinces: {
                            one: [faceupProvince('province 1', 'manicured-garden')],
                            two: [faceupProvince('province 2', 'pilgrimage')],
                            three: [faceupProvince('province 3', 'restoration-of-balance')],
                            four: [faceupProvince('province 4', 'city-of-the-rich-frog')]
                        },
                        strongholdProvince: [faceupProvince('stronghold province', 'illustrious-forge')],
                        cardPiles: { cardsInPlay: [one, two], hand: [] }
                    },
                    Opponent: {
                        id: 'opponent-id', name: 'Opponent',
                        stats: { conflictsRemaining: 1, militaryRemaining: 1, politicalRemaining: 1 },
                        provinces: {
                            one: [{
                                ...faceupProvince('province 1', 'manicured-garden'),
                                inConflict: true, strengthSummary: { stat: '12' }
                            }],
                            two: [faceupProvince('province 2', 'pilgrimage')],
                            three: [faceupProvince('province 3', 'ancestral-lands')],
                            four: [faceupProvince('province 4', 'meditations-on-the-tao')]
                        },
                        strongholdProvince: [faceupProvince('stronghold province', 'shameful-display')],
                        cardPiles: {
                            cardsInPlay: [{
                                uuid: 'enemy', id: 'enemy-bushi', type: 'character',
                                location: 'play area', bowed: false,
                                militarySkillSummary: { stat: '2' },
                                politicalSkillSummary: { stat: '2' }
                            }],
                            hand: []
                        }
                    }
                },
                conflict: {
                    type: 'military', conflictType: 'military',
                    attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                    attackerSkill: 4, defenderSkill: 0
                }
            };
            const profile = resolveDeckProfile(
                ['iron-mountain-castle', 'illustrious-forge'], ATTACHMENTS);
            const decision = new JigokuBotPolicy('keep-home-faceup')
                .decide(state, 'Jigoku Bot', { profile, strategy: ATTACHMENTS, cardHint: getPlaybookEntry });
            expect(decision.reason).toBe('initiate-conflict');
        });

        it('keeps The Stone of Sorrows bearer home while a Revered Bonsho is in play', function() {
            const bearer = {
                uuid: 'bearer', id: 'niten-master', type: 'character', location: 'play area',
                bowed: false, selectable: true, fate: 2,
                militarySkillSummary: { stat: '5' }, politicalSkillSummary: { stat: '5' },
                attachments: [{ uuid: 'stone', id: 'the-stone-of-sorrows' }]
            };
            const other = {
                uuid: 'other', id: 'mirumoto-raitsugu', type: 'character', location: 'play area',
                bowed: false, selectable: true, fate: 2,
                militarySkillSummary: { stat: '3' }, politicalSkillSummary: { stat: '2' },
                attachments: []
            };
            const build = (withBonsho) => ({
                players: {
                    'Jigoku Bot': {
                        id: 'bot-id', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Military Void Conflict', menuTitle: 'Choose attackers',
                        buttons: [{ text: 'Initiate Conflict', arg: 'done', uuid: 'initiate' }],
                        stats: { honor: 10, fate: 2, conflictsRemaining: 1 },
                        provinces: {
                            one: withBonsho ? [{
                                uuid: 'bonsho', id: 'revered-bonsho', type: 'holding',
                                facedown: false, location: 'province 1'
                            }] : [],
                            two: [], three: [], four: []
                        },
                        strongholdProvince: [],
                        cardPiles: { cardsInPlay: [bearer, other], hand: [] }
                    },
                    Opponent: {
                        id: 'opponent-id', name: 'Opponent',
                        stats: { conflictsRemaining: 1, militaryRemaining: 1, politicalRemaining: 1 },
                        provinces: {
                            one: [faceupProvince('province 1', 'manicured-garden')],
                            two: [], three: [], four: []
                        },
                        strongholdProvince: [],
                        cardPiles: { cardsInPlay: [], hand: [] }
                    }
                },
                conflict: {
                    type: 'military', conflictType: 'military',
                    attackingPlayerId: 'bot-id', defendingPlayerId: 'opponent-id',
                    attackerSkill: 0, defenderSkill: 0
                }
            });
            const context = { strategy: ATTACHMENTS, cardHint: getPlaybookEntry };
            // With no Bonsho the lock is worth nothing, so the best body attacks.
            expect(new JigokuBotPolicy('stone-no-bonsho')
                .decide(build(false), 'Jigoku Bot', context).target).toBe('bearer');
            // With one, the bearer stays ready and the other body goes instead.
            expect(new JigokuBotPolicy('stone-bonsho')
                .decide(build(true), 'Jigoku Bot', context).target).toBe('other');
        });

        it('fires the Self-Understanding granted reaction on a bearer with no playbook hint', function() {
            // The ability is granted to the CHARACTER, so the reaction window
            // offers the bearer. Doomed Shugenja has no printed triggered
            // ability and therefore no playbook entry, which used to make the
            // whole card unreachable on that body.
            const bearer = {
                uuid: 'bearer', id: 'doomed-shugenja', type: 'character',
                location: 'play area', selectable: true, inConflict: true, bowed: false,
                attachments: [{ uuid: 'su', id: 'self-understanding', type: 'attachment' }]
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Any reactions to the conflict finishing?',
                        menuTitle: 'Choose a reaction',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 2 },
                        cardPiles: { cardsInPlay: [bearer], hand: [] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            expect(getPlaybookEntry('doomed-shugenja')).toBeUndefined();
            const decision = new JigokuBotPolicy('granted-reaction').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            });
            expect(decision.reason).toBe('trigger-hinted-ability');
            expect(decision.args[0]).toBe('bearer');
        });

        it('leaves a hintless bearer alone without the granting attachment', function() {
            const bare = {
                uuid: 'bare', id: 'doomed-shugenja', type: 'character',
                location: 'play area', selectable: true, inConflict: true, bowed: false,
                attachments: [{ uuid: 'katana', id: 'fine-katana', type: 'attachment' }]
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Any reactions to the conflict finishing?',
                        menuTitle: 'Choose a reaction',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 2 },
                        cardPiles: { cardsInPlay: [bare], hand: [] }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                }
            };
            const decision = new JigokuBotPolicy('no-granted-reaction').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            });
            expect(decision.reason).not.toBe('trigger-hinted-ability');
        });

        it('reads the conflict axis from the serialized `type` field for the Forge', function() {
            // `Conflict.getSummary()` publishes the axis as `type`. Reading the
            // engine-internal `conflictType` instead silently defaulted the
            // Forge to its military ranking on every political attack.
            const state = {
                players: {
                    'Jigoku Bot': {
                        name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Illustrious Forge', menuTitle: 'Choose an attachment',
                        buttons: [{ text: 'Cancel', arg: 'cancel', uuid: 'cancel' }],
                        stats: { honor: 10, fate: 2 },
                        cardPiles: {
                            cardsInPlay: [],
                            hand: [
                                { uuid: 'mil', id: 'tetsubo-of-blood', type: 'attachment', selectable: true },
                                { uuid: 'pol', id: 'self-understanding', type: 'attachment', selectable: true }
                            ]
                        }
                    },
                    Opponent: { name: 'Opponent', cardPiles: { cardsInPlay: [], hand: [] } }
                },
                conflict: {
                    type: 'political',
                    attackingPlayerId: 'opponent-id', defendingPlayerId: 'bot-id'
                }
            };
            const decision = new JigokuBotPolicy('forge-axis').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS,
                cardHint: getPlaybookEntry,
                targetHint: { sourceCardId: 'illustrious-forge', sourceIsMine: true, gameActions: [] }
            });
            expect(decision.reason).toBe('attachment-tower-pick-attachment');
            expect(decision.args[0]).toBe('pol');
        });

        it('holds The Stone of Sorrows using the serialized conflict `type`', function() {
            // Same field-name trap on the other reader: with `activeConflict`
            // stuck false, the "+1 that flips the conflict" branch could never
            // fire and the card sat in hand forever on an empty ring pool.
            const participant = {
                uuid: 'tower', id: 'niten-master', type: 'character',
                location: 'play area', bowed: false, fate: 3, inConflict: true,
                attachments: [],
                militarySkillSummary: { stat: '4' }, politicalSkillSummary: { stat: '4' }
            };
            const state = {
                players: {
                    'Jigoku Bot': {
                        id: 'bot-id', name: 'Jigoku Bot', phase: 'conflict',
                        promptTitle: 'Action Window', menuTitle: 'Initiate an action',
                        buttons: [{ text: 'Pass', arg: 'pass', uuid: 'pass' }],
                        stats: { honor: 10, fate: 4, conflictsRemaining: 1 },
                        provinces: {
                            one: [{
                                uuid: 'attacked', id: 'manicured-garden', type: 'province',
                                isProvince: true, facedown: false, location: 'province 1',
                                inConflict: true, strengthSummary: { stat: '1' }
                            }],
                            two: [], three: [], four: []
                        },
                        strongholdProvince: [],
                        cardPiles: {
                            cardsInPlay: [participant],
                            hand: [{
                                uuid: 'stone', id: 'the-stone-of-sorrows', type: 'attachment',
                                cost: '2', isPlayableByMe: true
                            }]
                        }
                    },
                    Opponent: {
                        id: 'opponent-id', name: 'Opponent',
                        provinces: { one: [], two: [], three: [], four: [] },
                        strongholdProvince: [],
                        cardPiles: {
                            cardsInPlay: [{
                                uuid: 'enemy', id: 'enemy-bushi', type: 'character',
                                location: 'play area', bowed: false, inConflict: true,
                                militarySkillSummary: { stat: '4' },
                                politicalSkillSummary: { stat: '4' }
                            }],
                            hand: []
                        }
                    }
                },
                rings: {
                    air: { element: 'air', fate: 0 }, earth: { element: 'earth', fate: 0 },
                    fire: { element: 'fire', fate: 0 }, water: { element: 'water', fate: 0 },
                    void: { element: 'void', fate: 0 }
                },
                conflict: {
                    type: 'military',
                    attackingPlayerId: 'opponent-id', defendingPlayerId: 'bot-id',
                    attackerSkill: 5, defenderSkill: 4
                }
            };
            const decision = new JigokuBotPolicy('stone-flip').decide(state, 'Jigoku Bot', {
                strategy: ATTACHMENTS, cardHint: getPlaybookEntry
            });
            // One point short with an empty ring pool: the +1 is the whole
            // reason to spend it, so it goes down.
            expect(decision.args[0]).toBe('stone');
        });
    });
});
