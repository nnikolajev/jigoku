/**
 * The per-card advice contract the policy reads.
 *
 * Every entry in `CardPlaybook.ts` is one of these (`PlaybookEntry extends
 * CardHint`), and the policy asks for one through the `cardHint(cardId)`
 * callback the controller supplies. The fields answer the four questions the
 * decision path has about a card it is holding: is now the moment
 * (`useWhen`, `conflictTypes`), who should it land on (`targetSide`,
 * `targetPreference`), and how badly do we want it (`priority`).
 *
 * These types were originally the response schema for an LLM card-analysis
 * service. That service is gone; the shape stayed because the hand-written
 * playbook had already been built on it and the policy reads both through one
 * interface.
 */

/** When a card is worth playing at all. `never` blanks it for the bot. */
export type UseWhen = 'always' | 'losing' | 'winning' | 'attacked' | 'never';

/**
 * Which side a card's effect belongs on. The generic polarity gate in
 * `test/helpers/effectpolarity.js` enforces this at runtime: `ready`/`honor`
 * must land on our characters, `bow`/`dishonor` on theirs.
 */
export type TargetSide = 'self' | 'enemy' | 'either' | 'none';

/** How to rank legal targets once the side is settled. */
export type TargetPreference = 'strongest' | 'weakest' | 'most-fate' | 'strongest-bowed' | 'any';

export interface CardHint {
    cardId: string;
    useWhen: UseWhen;
    conflictTypes: Array<'military' | 'political'>;
    targetSide: TargetSide;
    targetPreference: TargetPreference;
    /** 0-10. The policy plays higher-priority cards first within a window. */
    priority: number;
    summary: string;
}
