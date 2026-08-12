import type AbilityDslType from './abilitydsl.js';
import { GameObject } from './GameObject';
import { Locations, Durations } from './Constants';
import type Game from './game';
import type Effect from './Effects/Effect';

// Same require cycle as the one documented in `GameObject.ts`: the DSL reaches
// the action and card modules, and those extend this class. Importing it as a
// value makes `EffectSource` unloadable as an entry point. Every use below is
// inside a method, so resolve it on first call instead.
let abilityDslModule: typeof AbilityDslType | undefined;
function abilityDsl(): typeof AbilityDslType {
    if(!abilityDslModule) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        abilityDslModule = require('./abilitydsl.js').default || require('./abilitydsl.js');
    }
    return abilityDslModule as typeof AbilityDslType;
}

type EffectFactory = (game: Game, source: any, properties: EffectProperties) => Effect;

interface EffectProperties {
    duration?: Durations;
    location?: Locations;
    effect?: EffectFactory | EffectFactory[];
    match?: any;
    condition?: () => boolean;
    [key: string]: any;
}

type PropertyFactory = (dsl: typeof AbilityDslType) => EffectProperties;

// This class is inherited by Ring and BaseCard and also represents Framework effects

class EffectSource extends GameObject {
    constructor(game: Game, name = 'Framework effect') {
        super(game, name);
    }

    /**
     * Applies an immediate effect which lasts until the end of the current
     * duel.
     */
    untilEndOfDuel(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.UntilEndOfDuel, location: Locations.Any }, properties));
    }

    /**
     * Applies an immediate effect which lasts until the end of the current
     * conflict.
     */
    untilEndOfConflict(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.UntilEndOfConflict, location: Locations.Any }, properties));
    }

    /**
     * Applies an immediate effect which lasts until the end of the phase.
     */
    untilEndOfPhase(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.UntilEndOfPhase, location: Locations.Any }, properties));
    }

    /**
     * Applies an immediate effect which lasts until the end of the round.
     */
    untilEndOfRound(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.UntilEndOfRound, location: Locations.Any }, properties));
    }

    untilPassPriority(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.UntilPassPriority, location: Locations.Any }, properties));
    }

    untilOpponentPassPriority(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.UntilOpponentPassPriority, location: Locations.Any }, properties));
    }

    untilNextPassPriority(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.UntilNextPassPriority, location: Locations.Any }, properties));
    }

    untilSelfPassPriority(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.UntilSelfPassPriority, location: Locations.Any }, properties));
    }

    /**
     * Applies a lasting effect which lasts until an event contained in the
     * `until` property for the effect has occurred.
     */
    lastingEffect(propertyFactory: PropertyFactory): void {
        const properties = propertyFactory(abilityDsl());
        this.addEffectToEngine(Object.assign({ duration: Durations.Custom, location: Locations.Any }, properties));
    }

    /*
     * Adds a persistent/lasting/delayed effect to the effect engine
     * @param {Object} properties - properties for the effect - see Effects/Effect.js
     */
    addEffectToEngine(properties: EffectProperties): Effect[] {
        const { effect, ...rest } = properties;
        if(Array.isArray(effect)) {
            return effect.map((factory) => this.game.effectEngine.add(factory(this.game, this, rest)));
        }
        if(effect) {
            return [this.game.effectEngine.add(effect(this.game, this, rest))];
        }
        return [];
    }

    removeEffectFromEngine(effectArray: Effect[]): void {
        this.game.effectEngine.unapplyAndRemove((effect: Effect) => effectArray.includes(effect));
    }

    removeLastingEffects(): void {
        this.game.effectEngine.removeLastingEffects(this);
    }
}

export = EffectSource;
