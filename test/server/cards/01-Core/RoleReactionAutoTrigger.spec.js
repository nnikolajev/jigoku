describe('Seeker/Keeper role reaction auto-trigger', function() {
    integration(function() {
        describe('Seeker role', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        role: ['seeker-of-air'],
                        inPlay: ['doji-whisperer'],
                        provinces: ['manicured-garden', 'public-forum', 'entrenched-position', 'pilgrimage']
                    },
                    player2: {
                        inPlay: ['adept-of-the-waves']
                    }
                });

                this.garden = this.player1.findCardByName('manicured-garden');
                this.forum = this.player1.findCardByName('public-forum');
                this.adept = this.player2.findCardByName('adept-of-the-waves');
            });

            it('gains the fate without a prompt when a matching province is revealed', function() {
                let fate = this.player1.fate;
                this.noMoreActions();
                this.player1.passConflict();
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept],
                    province: this.garden,
                    ring: 'air'
                });

                expect(this.garden.facedown).toBe(false);
                expect(this.player1.fate).toBe(fate + 1);
                expect(this.player1).not.toHavePrompt('Triggered Abilities');
                expect(this.getChatLogs(5)).toContain('player1 uses Seeker of Air to gain 1 fate');
            });

            it('still prompts when the player turned the option off', function() {
                this.player1.player.optionSettings.autoTriggerRoleAbilities = false;
                let fate = this.player1.fate;
                this.noMoreActions();
                this.player1.passConflict();
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept],
                    province: this.garden,
                    ring: 'air'
                });

                expect(this.player1).toHavePrompt('Triggered Abilities');
                expect(this.player1).toBeAbleToSelect('seeker-of-air');
                expect(this.player1.fate).toBe(fate);
                this.player1.clickCard('seeker-of-air');
                expect(this.player1.fate).toBe(fate + 1);
            });

            it('does not fire for a province of another element', function() {
                let fate = this.player1.fate;
                this.noMoreActions();
                this.player1.passConflict();
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept],
                    province: this.forum,
                    ring: 'air'
                });

                expect(this.forum.facedown).toBe(false);
                expect(this.player1.fate).toBe(fate);
            });
        });

        describe('Seeker role alongside another reaction to the same event', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        role: ['seeker-of-water'],
                        inPlay: ['doji-whisperer'],
                        provinces: ['rally-to-the-cause', 'public-forum', 'entrenched-position', 'pilgrimage']
                    },
                    player2: {
                        inPlay: ['adept-of-the-waves']
                    }
                });

                this.rally = this.player1.findCardByName('rally-to-the-cause');
                this.adept = this.player2.findCardByName('adept-of-the-waves');
            });

            it('auto-resolves the role but leaves the other reaction to the player', function() {
                let fate = this.player1.fate;
                this.noMoreActions();
                this.player1.passConflict();
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept],
                    province: this.rally,
                    ring: 'air'
                });

                expect(this.player1.fate).toBe(fate + 1);
                expect(this.player1).toHavePrompt('Triggered Abilities');
                expect(this.player1).toBeAbleToSelect(this.rally);
                expect(this.player1).not.toBeAbleToSelect('seeker-of-water');
            });
        });

        describe('Keeper role', function() {
            beforeEach(function() {
                this.setupTest({
                    phase: 'conflict',
                    player1: {
                        role: ['keeper-of-air'],
                        inPlay: ['doji-kuwanan'],
                        provinces: ['public-forum', 'entrenched-position', 'pilgrimage', 'ancestral-lands']
                    },
                    player2: {
                        inPlay: ['adept-of-the-waves']
                    }
                });

                this.kuwanan = this.player1.findCardByName('doji-kuwanan');
                this.adept = this.player2.findCardByName('adept-of-the-waves');
                this.forum = this.player1.findCardByName('public-forum');
            });

            it('gains the fate without a prompt after winning a matching conflict on defence', function() {
                let fate = this.player1.fate;
                this.noMoreActions();
                this.player1.passConflict();
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept],
                    defenders: [this.kuwanan],
                    province: this.forum,
                    ring: 'air'
                });
                this.noMoreActions();

                expect(this.player1.fate).toBe(fate + 1);
                expect(this.getChatLogs(10)).toContain('player1 uses Keeper of Air to gain 1 fate');
            });

            it('still prompts when the player turned the option off', function() {
                this.player1.player.optionSettings.autoTriggerRoleAbilities = false;
                let fate = this.player1.fate;
                this.noMoreActions();
                this.player1.passConflict();
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.adept],
                    defenders: [this.kuwanan],
                    province: this.forum,
                    ring: 'air'
                });
                this.noMoreActions();

                expect(this.player1).toHavePrompt('Triggered Abilities');
                expect(this.player1).toBeAbleToSelect('keeper-of-air');
                expect(this.player1.fate).toBe(fate);
                this.player1.clickCard('keeper-of-air');
                expect(this.player1.fate).toBe(fate + 1);
            });

            it('does not fire when the role holder is the attacker', function() {
                let fate = this.player1.fate;
                this.noMoreActions();
                this.initiateConflict({
                    attackers: [this.kuwanan],
                    defenders: [],
                    ring: 'air'
                });
                this.noMoreActions();

                expect(this.player1.fate).toBe(fate);
            });
        });
    });
});
