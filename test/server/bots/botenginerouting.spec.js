const BotEngineRouter = require('../../../build/server/game/bots/BotEngineRouter.js').default;
const V1PolicyAdapter = require('../../../build/server/game/bots/V1PolicyAdapter.js').default;
const JigokuBotController = require('../../../build/server/game/bots/JigokuBotController.js');
const { resolveBotIdentity, stableConfigurationHash } = require('../../../build/server/game/bots/BotConfiguration.js');
const { deriveDeckStrategy } = require('../../../build/server/game/bots/CardPlaybook.js');
const { resolveDeckProfile } = require('../../../build/server/game/bots/DeckProfiles.js');
const golden = require('../../fixtures/bots/v1-golden-decisions.json');

describe('Jigoku bot engine routing', function() {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const inputFor = (prompt, configuration) => ({
        playerState: clone(prompt.playerState),
        botName: golden.botName,
        context: { ...(prompt.context || {}), ...(configuration.context || {}) }
    });

    it('replays the exact ordered V1 golden trace for every seed and information mode', function() {
        expect(new Set(golden.prompts.map((prompt) => prompt.class))).toEqual(
            new Set(['setup', 'dynasty', 'conflict', 'target', 'bid', 'pass'])
        );
        for(const configuration of golden.configurations) {
            const engine = new V1PolicyAdapter(configuration.config);
            const actual = golden.prompts.map((prompt) => ({
                promptId: prompt.id,
                decision: engine.decide(inputFor(prompt, configuration)),
                seedState: engine.seedState
            }));
            expect(clone(actual)).withContext(configuration.id).toEqual(
                golden.expectedBySeed[String(configuration.config.seed)]
            );
        }
    });

    it('keeps V1 as the default and selects engine independently from seed and information mode', function() {
        for(const seed of [1, 2, 3]) {
            for(const omniscient of [false, true]) {
                expect(new BotEngineRouter({ playerName: golden.botName, seed, omniscient }).version).toBe('v1');
                expect(new BotEngineRouter({ playerName: golden.botName, seed, omniscient, engineVersion: 'v1' }).version).toBe('v1');
                expect(new BotEngineRouter({ playerName: golden.botName, seed, omniscient, engineVersion: 'v2' }).version).toBe('v2');
            }
        }
    });

    it('makes V2 pass-through identical to direct V1 for every golden prompt', function() {
        for(const configuration of golden.configurations) {
            const direct = new V1PolicyAdapter(configuration.config);
            const routed = new BotEngineRouter({ ...configuration.config, engineVersion: 'v2' });
            for(const prompt of golden.prompts) {
                expect(routed.decide(inputFor(prompt, configuration)))
                    .withContext(`${configuration.id}/${prompt.id}`)
                    .toEqual(direct.decide(inputFor(prompt, configuration)));
                expect(routed.lastDecisionTrace.selectedBy).toBe('fallback');
                expect(routed.lastDecisionTrace.fallbackReason).toBe('v2-pass-through');
            }
            expect(routed.seedState).toBe(direct.seedState);
        }
    });

    it('creates a deterministic configuration identity from independent dimensions', function() {
        const first = resolveBotIdentity({
            playerName: golden.botName,
            engineVersion: 'v2', seed: 3, omniscient: true,
            deckProfileId: 'dragon-attachments', traceLevel: 'research'
        });
        const second = resolveBotIdentity({
            traceLevel: 'research', deckProfileId: 'dragon-attachments', omniscient: true,
            seed: 3, playerName: golden.botName, engineVersion: 'v2'
        });
        expect(first).toEqual(second);
        expect(first).toEqual(jasmine.objectContaining({
            engineVersion: 'v2', strategySeed: 3, informationMode: 'omniscient',
            deckProfile: 'dragon-attachments', traceLevel: 'research'
        }));
        expect(stableConfigurationHash({ b: 2, a: 1 })).toBe(stableConfigurationHash({ a: 1, b: 2 }));
        expect(resolveBotIdentity({ playerName: golden.botName }).engineVersion).toBe('v1');
    });

    it('records version, seed, information mode, profile, and configuration hash in controller traces', function() {
        let prompt = clone(golden.prompts.find((entry) => entry.class === 'bid').playerState.players[golden.botName]);
        const player = {
            name: golden.botName,
            left: false,
            disconnected: false,
            promptState: { selectableCards: [], selectableRings: [] },
            currentPrompt: () => prompt
        };
        const game = {
            getPlayerByName: () => player,
            getState: () => ({ players: { [golden.botName]: prompt } }),
            stopNonChessClocks: jasmine.createSpy('stopNonChessClocks'),
            continue: jasmine.createSpy('continue')
        };
        const runner = jasmine.createSpy('runner').and.callFake(() => {
            prompt = { buttons: [] };
            return true;
        });
        const controller = new JigokuBotController(game, {
            playerName: golden.botName, engineVersion: 'v2', seed: 2,
            omniscient: true, deckProfileId: 'golden-profile'
        }, runner);

        controller.tick();

        expect(controller.trace[0]).toEqual(jasmine.objectContaining({
            engineVersion: 'v2', strategySeed: 2, informationMode: 'omniscient',
            deckProfile: 'golden-profile', configurationHash: controller.identity.configurationHash,
            selectedBy: 'fallback', fallbackReason: 'v2-pass-through'
        }));
    });

    // A deck-scoped tactics module is gated by the PRESENCE of its profile key
    // (`profile.shugenja ? new ShugenjaTactics(profile.shugenja) : null`), so an
    // arm that names one at the top level used to hand every deck in the field a
    // partial profile with its id lists undefined. Measured on Crab before the
    // guard: 16 of 16 games lost, 100% of games flipped AWAY from the change.
    describe('deck-profile override scoping', function() {
        const controllerFor = (v2Profile, baseProfile) => {
            const player = { name: golden.botName, left: false, disconnected: false };
            const game = { getPlayerByName: () => player, getState: () => ({ players: {} }) };
            const controller = new JigokuBotController(game, {
                playerName: golden.botName, engineVersion: 'v1', seed: 1, v2Profile
            }, () => true);
            controller.deckProfile = baseProfile;
            return { controller, player };
        };
        const withoutShugenja = () => resolveDeckProfile([], deriveDeckStrategy([]));
        const withShugenja = () => resolveDeckProfile(
            ['kyuden-isawa', 'vassal-fields'], deriveDeckStrategy(['kyuden-isawa'])
        );
        const arm = { shugenja: { clarityPoliticalOnly: false }, drawBidding: { deckExhaustionAware: false } };

        it('never creates a module the deck does not own', function() {
            const base = withoutShugenja();
            expect(base.shugenja).toBeUndefined();

            const { controller, player } = controllerFor({ deckProfile: arm }, base);
            const merged = controller.decisionProfile(player);

            expect(merged.shugenja).toBeUndefined();
            // The applicable half of the SAME arm still applies, so the guard
            // drops a key rather than the whole override.
            expect(merged.drawBidding.deckExhaustionAware).toBe(false);
            expect(merged.drawBidding.lowHonorThreshold)
                .toBe(base.drawBidding.lowHonorThreshold);
        });

        it('still applies it to the deck that does own it', function() {
            const { controller, player } = controllerFor({ deckProfile: arm }, withShugenja());
            const merged = controller.decisionProfile(player);

            expect(merged.shugenja.clarityPoliticalOnly).toBe(false);
            // One level deep: everything the arm did not name survives.
            expect(merged.shugenja.disguiseRequiresBowedBase).toBe(true);
            expect(merged.shugenja.towerIds.length).toBeGreaterThan(0);
        });

        it('routes an archetype-scoped arm to exactly the same result', function() {
            const scoped = { deckProfileByArchetype: { shugenja: arm } };
            const owning = controllerFor(scoped, withShugenja());
            const other = controllerFor(scoped, withoutShugenja());

            expect(owning.controller.decisionProfile(owning.player).shugenja.clarityPoliticalOnly)
                .toBe(false);
            expect(other.controller.decisionProfile(other.player).shugenja).toBeUndefined();
        });

        it('leaves the profile untouched when no override is configured', function() {
            const base = withShugenja();
            const { controller, player } = controllerFor(undefined, base);
            expect(controller.decisionProfile(player)).toBe(base);
        });
    });
});
