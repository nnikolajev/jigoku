describe('Mountaintop Statuary - stronghold province placement', function() {
    integration(function() {
        describe('reveal reaction', function() {
            ['province 1', 'province 2', 'province 3', 'province 4'].forEach(function(location) {
                it('is offered when the holding is turned faceup in ' + location, function() {
                    this.setupTest({
                        phase: 'setup',
                        player1: { dynastyDeck: ['mountaintop-statuary'] },
                        player2: {}
                    });
                    this.statuary = this.player1.placeCardInProvince('mountaintop-statuary', location);
                    this.keepDynasty();
                    this.keepConflict();

                    expect(this.player1).toHavePrompt('Triggered Abilities');
                    expect(this.player1).toBeAbleToSelect(this.statuary);
                    this.player1.clickCard(this.statuary);
                    expect(this.statuary.location).toBe('stronghold province');
                });
            });

            it('is offered when the holding is turned faceup by a card effect', function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        inPlay: ['daidoji-nerishma'],
                        dynastyDiscard: ['mountaintop-statuary']
                    },
                    player2: {}
                });
                this.nerishma = this.player1.findCardByName('daidoji-nerishma');
                this.statuary = this.player1.findCardByName('mountaintop-statuary');
                this.player1.placeCardInProvince(this.statuary, 'province 1');
                this.statuary.facedown = true;

                this.player1.clickCard(this.nerishma);
                this.player1.clickCard(this.statuary);

                expect(this.statuary.facedown).toBe(false);
                expect(this.player1).toBeAbleToSelect(this.statuary);
                this.player1.clickCard(this.statuary);
                expect(this.statuary.location).toBe('stronghold province');
            });
        });

        describe('when moved onto the stronghold province', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'setup',
                    player1: {
                        dynastyDiscard: ['mountaintop-statuary', 'mountaintop-statuary', 'mountaintop-statuary']
                    },
                    player2: {}
                });
                this.statuaries = this.player1.filterCardsByName('mountaintop-statuary');
                this.player1.placeCardInProvince(this.statuaries[0], 'province 1');
                this.player1.placeCardInProvince(this.statuaries[1], 'province 2');
                this.player1.placeCardInProvince(this.statuaries[2], 'province 3');
                this.statuaries.forEach((card) => {
                    card.facedown = true;
                });
                this.strongholdProvince = this.player1.player.getProvinceCardInProvince('stronghold province');
                this.baseStrength = this.strongholdProvince.getStrength();
                this.keepDynasty();
                this.keepConflict();
            });

            it('is placed in the province rather than attached to anything', function() {
                this.player1.clickCard(this.statuaries[0]);

                expect(this.statuaries[0].location).toBe('stronghold province');
                expect(this.statuaries[0].parent).toBeFalsy();
                expect(this.player1.player.stronghold.childCards).toEqual([]);
                expect(this.strongholdProvince.childCards).toEqual([]);
                expect(this.player1.player.getSourceList('stronghold province').includes(this.statuaries[0])).toBe(true);
            });

            it('coexists with the stronghold and the stronghold province card', function() {
                this.player1.clickCard(this.statuaries[0]);

                const cards = this.player1.player.getSourceList('stronghold province');
                expect(cards.includes(this.player1.player.stronghold)).toBe(true);
                expect(cards.includes(this.strongholdProvince)).toBe(true);
                expect(cards.includes(this.statuaries[0])).toBe(true);
            });

            it('stacks - three copies each give the stronghold province +1 strength', function() {
                this.player1.clickCard(this.statuaries[0]);
                expect(this.strongholdProvince.getStrength()).toBe(this.baseStrength + 1);
                this.player1.clickCard(this.statuaries[1]);
                expect(this.strongholdProvince.getStrength()).toBe(this.baseStrength + 2);
                this.player1.clickCard(this.statuaries[2]);
                expect(this.strongholdProvince.getStrength()).toBe(this.baseStrength + 3);

                expect(this.player1.player.getDynastyCardsInProvince('stronghold province').length).toBe(3);
                this.statuaries.forEach((card) => expect(card.location).toBe('stronghold province'));
            });

            it('refills the province it left, facedown', function() {
                this.player1.clickCard(this.statuaries[0]);

                const replacement = this.player1.player.getDynastyCardInProvince('province 1');
                expect(replacement).toBeDefined();
                expect(replacement).not.toBe(this.statuaries[0]);
                expect(replacement.facedown).toBe(true);
            });
        });

        describe('while it sits in the stronghold province', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'setup',
                    player1: { inPlay: ['brash-samurai'] },
                    player2: { dynastyDeck: ['mountaintop-statuary'] }
                });
                this.statuary = this.player2.placeCardInProvince('mountaintop-statuary', 'province 1');
                this.strongholdProvince = this.player2.player.getProvinceCardInProvince('stronghold province');
                this.keepDynasty();
                this.keepConflict();
                this.player2.clickCard(this.statuary);
                expect(this.statuary.location).toBe('stronghold province');
                this.baseStrength = this.strongholdProvince.getStrength() - 1;
            });

            it('its action can send an attacker home from a conflict at the stronghold province', function() {
                this.advancePhases('conflict');
                for(const location of ['province 1', 'province 2', 'province 3', 'province 4']) {
                    const province = this.player2.player.getProvinceCardInProvince(location);
                    province.isBroken = true;
                    province.facedown = false;
                }
                this.game.checkGameState(true);
                this.noMoreActions();
                this.initiateConflict({
                    type: 'military',
                    ring: 'air',
                    province: this.strongholdProvince,
                    attackers: ['brash-samurai'],
                    defenders: []
                });
                const brashSamurai = this.player1.findCardByName('brash-samurai');

                expect(this.statuary.isInConflictProvince()).toBe(true);
                this.player2.clickCard(this.statuary);
                expect(this.player2).toBeAbleToSelect(brashSamurai);
                this.player2.clickCard(brashSamurai);

                expect(brashSamurai.isParticipating()).toBe(false);
                expect(this.statuary.location).toBe('dynasty discard pile');
                expect(this.strongholdProvince.getStrength()).toBe(this.baseStrength);
            });
        });

        describe('discarding from provinces', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'setup',
                    player1: { dynastyDeck: ['mountaintop-statuary'] },
                    player2: {}
                });
                this.statuary = this.player1.placeCardInProvince('mountaintop-statuary', 'province 1');
                this.strongholdProvince = this.player1.player.getProvinceCardInProvince('stronghold province');
                this.keepDynasty();
                this.keepConflict();
                this.player1.clickCard(this.statuary);
                this.baseStrength = this.strongholdProvince.getStrength();
                this.advancePhases('fate');
            });

            it('offers it for discard from the stronghold province', function() {
                expect(this.player1).toHavePrompt('Select dynasty cards to discard');
                expect(this.player1).toBeAbleToSelect(this.statuary);
            });

            it('discards it and does not refill the stronghold province', function() {
                this.player1.clickCard(this.statuary);
                this.player1.clickPrompt('Done');

                expect(this.statuary.location).toBe('dynasty discard pile');
                expect(this.player1.player.getDynastyCardsInProvince('stronghold province')).toEqual([]);
                expect(this.strongholdProvince.getStrength()).toBe(this.baseStrength - 1);

                const cards = this.player1.player.getSourceList('stronghold province');
                expect(cards.size()).toBe(2);
                expect(cards.includes(this.player1.player.stronghold)).toBe(true);
                expect(cards.includes(this.strongholdProvince)).toBe(true);
            });
        });

        describe('when added to a province faceup by Rally', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'setup',
                    player1: {
                        dynastyDeck: [],
                        dynastyDiscard: ['a-season-of-war', 'mountaintop-statuary']
                    },
                    player2: {}
                });
                this.season = this.player1.findCardByName('a-season-of-war');
                this.statuary = this.player1.findCardByName('mountaintop-statuary');
                this.player1.placeCardInProvince(this.season, 'province 1');
                this.season.facedown = true;
                this.keepDynasty();
                this.player1.reduceDeckToNumber('dynasty deck', 0);
                this.player1.moveCard(this.statuary, 'dynasty deck');
                this.keepConflict();
            });

            it('is added faceup without being revealed, so the reaction does not trigger', function() {
                expect(this.statuary.location).toBe('province 1');
                expect(this.statuary.facedown).toBe(false);
                expect(this.getChatLogs(10)).toContain(
                    'player1 places Mountaintop Statuary faceup in province 1 due to A Season of War\'s Rally'
                );
                expect(this.player1).not.toHavePrompt('Triggered Abilities');
            });

            it('still triggers once it is genuinely turned faceup later', function() {
                this.statuary.facedown = true;
                this.game.checkGameState(true);

                this.game.applyGameAction(null, { flipDynasty: this.statuary });
                this.game.continue();

                expect(this.statuary.facedown).toBe(false);
                expect(this.player1).toBeAbleToSelect(this.statuary);
                this.player1.clickCard(this.statuary);
                expect(this.statuary.location).toBe('stronghold province');
            });
        });
    });
});
