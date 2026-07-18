describe('Province targeting metadata', function() {
    integration(function() {
        beforeEach(function() {
            this.setupTest({
                phase: 'conflict',
                player1: {
                    provinces: ['tsuma', 'rally-to-the-cause', 'public-forum']
                },
                player2: { provinces: ['shameful-display', 'the-eternal-watch'] }
            });
        });

        it('classifies real province abilities by tactical timing', function() {
            expect(this.player1.findCardByName('tsuma').getProvinceAbilityClass()).toBe('none');
            expect(this.player1.findCardByName('rally-to-the-cause').getProvinceAbilityClass()).toBe('reveal');
            expect(this.player1.findCardByName('public-forum').getProvinceAbilityClass()).toBe('reaction');
            expect(this.player2.findCardByName('shameful-display').getProvinceAbilityClass()).toBe('action');
        });

        it('publishes metadata for faceup provinces without leaking facedown identity', function() {
            const hidden = this.player1.findCardByName('rally-to-the-cause');
            const hiddenSummary = hidden.getSummary(this.player2Object, false);
            expect(hiddenSummary.id).toBeUndefined();
            expect(hiddenSummary.provinceAbilityClass).toBeUndefined();
            expect(hiddenSummary.eminent).toBeUndefined();

            const eminent = this.player1.findCardByName('tsuma');
            const eminentSummary = eminent.getSummary(this.player2Object, false);
            expect(eminentSummary.id).toBe('tsuma');
            expect(eminentSummary.eminent).toBe(true);
            expect(eminentSummary.provinceAbilityClass).toBe('none');
        });
    });
});
