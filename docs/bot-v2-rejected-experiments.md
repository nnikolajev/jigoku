# Rejected and disabled Bot V2 experiments

> **Knob names in this file may no longer exist.** A rejected experiment is
> often deleted along with its knobs — the whole skip half of `saveFatePass`
> (`earlyRounds`, `lateFromRound`, `lateSkillRatio`, `maxSkipsPerGame`, ...) and
> `defenseTuning.breakTieMinReadyCount` are gone from the code. Naming one in an
> arm today is INERT, not a fresh test. Check the profile interface before
> reproducing anything here.

Keep failed or inconclusive work here so it is not silently re-enabled.

## Initial enabled live profile: not eligible as default

- Evidence: `tools/selfplay/out/v2-task17-holdout-fair-rng27101.json`.
- Result: 10-10 across ten same-deck paired rows; 20/20 outcome equivalence; zero planner errors.
- Cost: 100% per-decision fallback, 23.3 searched nodes per decision, 17.43 ms planner time per decision, and 7272.7 ms versus 2886.3 ms mean game runtime.
- Decision: retain `tools/selfplay/profiles/v2-default-experimental.json` for reproducibility, keep V2 opt-in, and do not adjust coefficients from this small sample. A profile that performs search but never clears the live gate is not a default candidate.

## Broad tactical search in enabled mode: disabled

- Shadow evidence: `v2-shadow-matrix-fixed-seed{1,2,3}-{fair,omniscient}` completed 120/120 paired outcomes and semantic traces exactly across all decks, seeds, and information modes.
- Threshold evidence: seed-1 shadow reports recorded 166 fair and 121 omniscient preferences meeting confidence 0.90 and score advantage 3, but none had a proven terminal justification.
- Live evidence before disable: RNG 27101 fair searched 23.3 nodes/decision, exhausted 678 budgets, accepted zero corrections, and ran at 7845.3 versus 3296.9 ms/game. RNG 27102 omniscient produced a Lion timeout at the 30-second harness cap with no V2 override.
- Retained result after disable: RNG 27101 and 27102 fair/omniscient completed 80/80 paired outcomes and traces exactly (40-40 aggregate; four first-seat and four second-seat games per deck), with zero search nodes, budget exhaustion, planner errors, or corrections. Combined runtime remained 5079.6 versus 2991.5 ms/game and planner time was 12.84 ms/decision. One fair interaction sample still exceeded the 30-second self-play cap at 31.177 seconds; the identical 60-second-cap matrix completed 30/30 with zero click, cycle, stall, or decision-budget findings.
- Decision: `liveTacticalSearch` defaults off and is profile opt-in. Shadow/research retains the implementation and evidence. Do not re-enable until repeated training and holdout partitions show accepted tactical corrections, no timeout, bounded latency, and no severe deck outlier.

## Raw UUID trace comparison: rejected

- Initial matrix reports appeared to show deterministic trace differences. First-difference instrumentation showed identical Raise the Alarm prompt, reason, seed state, and province choice; only generated UUIDs for masked cards differed between replays.
- Decision: compare semantic `cardId` or stable `cardLocation`, while retaining first semantic difference diagnostics for genuine mismatches. The corrected six-partition shadow matrix passed 120/120 traces.

## Single-opponent or single-RNG coefficient tuning: rejected

- Evidence: the retained pilot uses only RNG 14150 and mirror-deck comparison rows.
- Decision: no coefficient change was made. Default promotion requires the checked-in full-league training/holdout partitions, distinct RNG streams, repeated holdout confirmation, no safety failures, and no severe deck outlier.

## Approximate card semantics as live high-confidence actions: disabled

- Affected approximations include Cavalry Reserves, Master Whisperer, Rebuild, Isawa Mori Seido, High House of Light, Togashi Mitsu, and Togashi Ichi.
- Decision: their confidence remains below the live override gate. They remain available for shadow analysis and semantic coverage but delegate execution to V1 until exact timing, target, and payoff evidence supports promotion.

## ConflictPhasePlanner switches: not enabled

- Decision: previously rejected abstract planner integrations remain off. V2 integrates through concrete semantic candidates and validated commands; an abstract conflict recommendation is not treated as executable planner integration.

## Repeated live dynasty package override: disabled

- Evidence: `tools/selfplay/out/v2-quality-live-smoke-rng28301.json` (Crane/Lion, four paired alternating-seat games per deck, fair seed 1).
- Result: 103 accepted V2 commands reduced fallback from 100% to 95.3%, but every accepted command was a dynasty purchase. Seven of eight paired outcomes remained equal; the one changed Lion game flipped from a Candidate win under V1 to a Candidate loss under V2. Aggregate candidate record was 3-5 with no net paired uplift.
- Root cause: the package planner proved one purchase against the current board, then material-state replanning treated the next remaining province card as a fresh package. This allowed sequential over-buying beyond the originally evaluated joint package.
- Decision: the live dynasty-package proof is disabled by default behind `highConfidenceGate.allowDynastyPackageOverride`. Keep its exact fixture and trace evidence, but do not re-enable until a retained package ledger caps the complete purchase sequence and repeated disjoint holdouts show uplift. Runtime was not the rejection reason.

### Retained package ledger rerun: still disabled

- Evidence: `tools/selfplay/out/v2-quality-retained-dynasty-crane-lion-rng28301-fixed.json` (Crane/Lion, seed 1 fair, four paired alternating-seat games per deck).
- Result: the ledger correctly limited each decision to its retained package, but V2 still made 47 dynasty purchase corrections across eight games. Outcome equivalence was only 1/8 and the candidate record fell to 2-6 (25%), including 1-3 for both decks.
- Decision: retaining package membership fixes the mechanical over-buy defect but does not prove that the package valuation is strategically better than V1. Live package execution requires explicit profile opt-in and remains disabled in the default V2 profile. The ledger and fixtures remain for later isolated training; quality, not runtime, rejected the slice.

## Single-click attacker/defender terminal override: disabled

- Discovery run: partial all-deck paired fair run, seed 1 / RNG 28401, stopped before report generation after the failure repeated across multiple early deck rows.
- Result: on `Choose defenders`, V2 scored each currently selectable character as a complete terminal defense action. After one click the prompt remained open, and replanning selected the same character again until the controller decision-loop guard forced a pass. Representative failures included Crane at `Military Earth Conflict: 21 vs 14` and Crane Duels at `Military Water Conflict: 24 vs 10`.
- Root cause: participant declaration is a set-building protocol: zero or more toggle clicks followed by `Done`. A single `defender-set`/`attacker-set` candidate is not a coherent semantic action, and terminal rank alone did not prove that clicking it avoided the forced loss.
- Decision: live overrides for `attacker-set` and `defender-set` are rejected until `CharacterAllocator` emits a complete stateful set macro with exact selected membership, remaining legal additions, and a final `Done` step. Terminal overrides now require a solver result of `forced-win` or `avoids-forced-loss`; utility rank alone cannot bypass this rule. A regression fixture verifies fallback before any incomplete set click. Runtime was not the rejection reason.

### Complete exact defender-set macro: implemented, live default still disabled

- Implementation: `ParticipantSetPlanner` converts the selectable defender atoms and live `Done` button into an immutable macro. It generates deterministic minimum break-prevention and narrowly bounded minimum conflict-win sets, and leaves impossible raw defenses on V1 so later pumps or reactions remain possible. The override policy independently verifies every UUID, move effect, threshold, inclusion-minimal set, and final `Done` command.
- Safety evidence: `tools/selfplay/out/v2-defender-set-smoke-interactions-rng49221.json` completed Crane, Dragon Attachments, and Phoenix with zero rejected clicks, cycles, no-progress runs, forced progress, stalls, or decision-budget exhaustion. Focused fixtures cover Done-only, minimum subset, conflict-win alternative, impossible defense fallback, broad-overcommit rejection, deterministic ordering, full macro continuation, and atomic-click rejection.
- Training evidence: `tools/selfplay/out/v2-defender-set-training-rerun-rng49231.json` improved the three-deck sample from 7-5 to 8-4 after rejecting a five-character ordinary-conflict win overcommit, but `tools/selfplay/out/v2-defender-set-all-decks-training-rng59321.json` finished only 8-12 aggregate. Its eight changed paired winners split evenly between four improvements and four regressions, with severe 0-2 rows for Crab, Dragon Attachments, and Unicorn. The macro was mechanically safe but did not produce broad causal uplift.
- Decision: generation and scoring remain available in shadow/research, but live execution defaults off behind `highConfidenceGate.allowExactDefenderSetOverride`. Do not re-enable from isolated favorable deck rows. Runtime was not the rejection reason.

## Same-terminal-class Golden Plains Outpost spend: rejected

- Evidence: `tools/selfplay/out/v2-quality-gpo-unicorn-rng28421.json` (Unicorn, seed 1 fair, four paired alternating-seat games).
- Result: V2 used Golden Plains Outpost and completed its target macro while already winning a stronghold conflict 17-9 against strength 4. V1 passed and won the same game; all 4/4 paired outcomes remained equal.
- Root cause: terminal selection allowed a higher aggregate heuristic value within the same `forced-win` class to count as a causal terminal improvement.
- Decision: terminal overrides now require a strictly better terminal rank than the V1 reference. V2 must not spend a resource merely to increase margin in a line V1 already forces. Runtime was not the rejection reason.

## Approximate multi-prompt semantics as terminal plays: disabled

- Evidence: `tools/selfplay/out/v2-quality-retained-dynasty-crane-lion-rng28301.json` (Crane/Lion, seed 1 fair, four paired alternating-seat games per deck).
- Result: aggregate play stayed 4-4, but outcome equivalence fell to 4/8 and V2 issued 275 corrections. In a Lion stronghold conflict it repeatedly clicked `In Service to My Lord`, then failed its cost/target prompt chain until the controller decision-loop guard forced pass. Fallback fell to 86.8%, but the extra activity was not safe evidence of better play.
- Root cause: the semantic described a simple ready target. The actual card first bows a friendly non-unique character as a cost, then selects a unique ready target, then returns itself to the bottom of the conflict deck. The terminal solver also treated an indirect ready/move/pump projection as a direct terminal action even though it does not model root priority returning after an opponent answers a pass.
- Decision: `In Service to My Lord`, `Hayaken no Shiro`, and `Against the Waves` remain below the live override floor until their complete cost/mode/target protocols are represented. Direct terminal overrides now require an effect that itself crosses a stronghold, honor, or deck threshold; ordinary conflict effects must pass tactical-search or minimum-sufficient-response proof. Lower fallback is not accepted when it comes from incomplete semantic execution.

## Treating every stronghold action window as terminal loss: rejected

- Evidence: `tools/selfplay/out/v2-quality-stronghold-emergency-all-rng28421.json` (all decks, seed 1 fair, two paired alternating-seat games per deck).
- Result: all 20/20 paired outcomes stayed equal, but only 12/20 traces matched and V2 made 32 extra commands. Several `terminal-loss` safety corrections had zero relevant conflict contribution, including Ornate Fan in military conflicts, Fine Katana in political conflicts, and Banzai in a political conflict.
- Root cause: the safety veto labeled pass as terminal loss whenever the bot defended its stronghold, even when the attacker was not currently breaking it. The generic safety-correction path could then choose any legal high-scoring action rather than an effect that changed the lethal threshold.
- Decision: stronghold terminal loss now requires the attack margin to meet the actual break threshold. Generic terminal-loss and mandatory-defense vetoes no longer authorize arbitrary live corrections; exact source/target actions must prove that they cross the immediate stronghold threshold. The one observed exact correction (Banzai for the required military swing) retained outcome parity in this pilot but still needs broader holdout evidence.

## Generic safety-veto substitution: disabled

- Evidence: `tools/selfplay/out/v2-quality-exact-stronghold-gate-all-rng28421.json` (all decks, seed 1 fair, two paired alternating-seat games per deck).
- Result: the narrowed run made six V2 commands. Exact stronghold corrections preserved the winner in Dragon and Unicorn, but a Scorpion `conflict-deck-exhaustion` substitution chose Ornate Fan and flipped a V1 dishonor win into a V2 dishonor loss. Aggregate candidate record fell to 9-11 and outcome equivalence to 18/20.
- Root cause: proving that V1's projected action trips a safety veto does not prove that the highest-scoring alternative is strategically superior. The generic branch lacked an exact causal payoff contract for the replacement.
- Decision: generic honor, deck, duplicate, and impossible-payoff safety vetoes no longer authorize live V2 substitutions. They remain trace/regret signals. A live correction must independently satisfy a fixture-backed terminal, immediate-stronghold, minimum-response, retained-package opt-in, or complete search-line proof.

## Generic durable free-attachment timing: disabled

- Earlier evidence: a free Fine Katana/Ornate Fan on a character with at least two fate produced one favorable Dragon Attachments winner flip in `tools/selfplay/out/v2-quality-exact-actions-all-rng28461.json`, but the disjoint eight-game Dragon Attachments rerun `tools/selfplay/out/v2-quality-dragonattachments-holdout-rng38521.json` reproduced no winner uplift.
- Isolation evidence: with exact defender-set execution disabled, `tools/selfplay/out/v2-without-defender-set-all-decks-training-rng59321.json` changed three of twenty paired winners. Every changed game used the generic durable-attachment proof: one Crab improvement, one Crab regression, and one Dragon Attachments regression. V2 finished 7-13 versus the equivalent V1 candidate seat's 8-12 on the same paired games.
- Narrowing experiment: requiring the target to have no attachments removed two changed outcomes in the repeated `rng59321` matrix, but `tools/selfplay/out/v2-empty-target-attachment-all-decks-training-rng59321.json` still finished 7-13. Its sole changed winner was a Crab regression: V2 played Ornate Fan where V1 passed and lost a game the equivalent V1 candidate seat won.
- Decision: both generic and empty-target durable attachment timing default off behind the explicit research opt-in `highConfidenceGate.allowDurableAttachmentOverride`. Exact stronghold-threshold attachments remain governed by the separate minimum-response proof. Re-enable only for a narrower card/deck/board contract with repeated disjoint uplift. Runtime was not the rejection reason.

## Exact unopposed last-conflict attacker set: research-only

- Contract: complete attacker selection plus `Done`, restricted to the bot's last conflict opportunity, zero public opposing hand/fate/ready characters, no Covert or restricted attackers, and an inclusion-minimal set that breaks the live province.
- Evidence: 32 focused architecture/override specs and the three-game interaction audit `tools/selfplay/out/v2-attacker-set-smoke-interactions-rng69421.json` passed with zero rejection, loop, stall, or budget failures.
- Training result: `tools/selfplay/out/v2-attacker-set-all-decks-training-rng59321.json` preserved all 20 paired winners and finished 8-12, exactly matching the equivalent V1 candidate seats. The attacker proof did not activate in any game, so it reduced no fallback and supplied no measured uplift.
- Decision: retain the semantic planner and proof behind `highConfidenceGate.allowExactAttackerSetOverride`, disabled by default. Broaden only through a separately measured adversarial-search contract; do not infer quality from mechanical safety alone.

## Early multi-conflict attacker packages: disabled

- Contract tested: an inclusion-minimal current break package budgeted every public ready defender plus a bounded hand/fate response, retained enough ready typed skill to break the weakest legal later province, retained a relevant defender while the opponent had an opportunity, and credited reuse only for explicit no-bow characters.
- Focused evidence: `tools/selfplay/out/v2-multi-conflict-focused-rng27101.json` activated complete macros for Crane Duels and Unicorn. Every attacker click and `Done` command succeeded and the focused five-deck record stayed 6-4, but it showed no paired record uplift over equivalent V1.
- All-deck evidence: `tools/selfplay/out/v2-multi-conflict-all-rng27101.json` finished only 10-9 with one timeout and 18/20 outcome equivalence. The Phoenix game containing an early three-attacker override reached the 420-decision harness limit where paired V1 produced a decided conquest result. There were no rejected clicks, planner errors, or decision-budget exhaustions, but a valid macro without repeatable winner uplift does not clear the quality gate.
- Decision: remove live early-conflict generation and retain the last-conflict-only attacker contract. Do not broaden it again until an allocation/search model evaluates the causal value of both complete conflicts and repeated disjoint holdouts beat V1 without timeouts. Runtime was not the rejection reason.

## Every-target Let Go search branching: rejected

- Evidence: `tools/selfplay/out/v2-exact-let-go-crane-rng27101.json` (Crane and Crane Duels, seed 1 fair, four paired alternating-seat games per deck).
- Result: exact typed attachment targets were mechanically correct, but expanding every physical Let Go copy across every opposing attachment produced fourteen equivalent roots in one tower position and exhausted two scenario budgets. No Let Go override activated and aggregate play stayed 4-4.
- Decision: retain exact attachment projection and source-to-target execution, but bind each physical copy only to the deterministic highest-impact public target. Tactical root breadth must represent meaningfully different actions, not combinatorial copies of inferior targets.

## Autonomous single-command utility policy: rejected (the evaluator is weaker than V1)

- Motivation: every earlier slice tested only narrow proof-gated overrides. None measured whether V2's utility policy is itself better than V1 when it is simply allowed to diverge. This is the decisive missing datapoint for the 70% default-promotion gate.
- Mechanism: added an execution-safe autonomous gate `highConfidenceGate.allowAutonomousPolicy` (default off, research only). When enabled it accepts the top-scored candidate for single-command kinds only — `pass`, `bid`, `confirmation`, `card-selection`, `target-selection`, `mode-selection`, `ring-choice`, `conflict-type-choice`, `province-choice`, `conflict-declaration` — after the existing confidence (>= 0.90) and score-advantage (>= 3) floors, and only when it strictly diverges from V1 (an identical command already returns `semantic-agreement`). Participant sets, card plays, and dynasty purchases are excluded because they stall the click controller or sequentially over-buy. Injected through new `compareBotVersions --v2-profile` plumbing (`config.v2Profile` -> controller -> `context.profile.v2`), additive and default-off so golden V1/V2 behavior is unchanged (186 focused V2 specs and the router spec still pass).
- Evidence (seed 1, fair, 6 decks Crane/Lion/Dragon/Unicorn/Scorpion/Phoenix, 6 games/deck, paired alternating seats, RNG 73001):
  - All-ones weights: `tools/selfplay/out/v2-autonomous-allones-seed1-fair-rng73001.json` — 2-30 (5.6%), fallback 83.2%, 0 planner errors, 0 budget exhaustions.
  - Anti-passive weights (`initiative` 0.1, `flexibility` 0.2, `conflictOutcome` 1.6, `provinceTempo` 1.4, `boardNow` 1.3, `boardFuture` 1.1, `ringValue` 1.3, `waste` 1.4): `tools/selfplay/out/v2-autonomous-antipassive-seed1-fair-rng73001.json` — 3-24 (8.3%), fallback 54.5%, 0 planner errors.
  - Smoke (Crane/Lion, 2 games, RNG 72001): 0-4; divergent overrides were dominated by extra passes and different ring choices.
- Diagnosis: the all-ones evaluator over-values `pass` (`{initiative:1, flexibility:0.5}` at zero cost), so V2 over-passes and loses tempo. Down-weighting the pass bonus fixed over-passing but then V2 over-acted (fallback fell 83% -> 55%, corrections exploded) and lost harder. Both variants executed cleanly (no stalls, loops, or budget exhaustion), so the failure is decision quality, not the click controller. Splicing V2 single-command choices into sequences that V1 still completes also introduces incoherence.
- Decision: `allowAutonomousPolicy` stays default off and research-only. Broad divergence driven by the current linear utility evaluator is strictly, severely worse than V1 (~6-8% vs V1). The narrow proof-gated overrides are positive only because they are constrained to provably minimal-sufficient actions, not because the evaluator ranks well. Do not re-enable without a materially stronger evaluator: an offline, holdout-confirmed coefficient set that makes `scoreGap` trustworthy, or a self-play-learned value function replacing the hand-coded linear scorer. Runtime was not the rejection reason.

## Conflict-phase declaration planning layers (pass/ring/type): rejected; fair-defense buffer is only break-even

- Goal: make the V2 seat smarter at conflict declaration (which type/ring/province, or pass) by turning on the `ConflictPhasePlanner` apply-layers that ship disabled (`applyPassPlan`, `applyRingPlan`, `applyTypePlan`; only `applyTargetPlan` is on by default). The planner is a phase-scoped alternating minimax that already models defense sets, the nonzero-tie rule, breaks, ring fate/effect, and remaining opportunities. Injected per-seat via `compareBotVersions --v2-profile` (`v2Profile.deckProfile.conflictPlanning` / `deckProfileByArchetype`, additive and default-off so V1 control keeps its defaults).
- Mirror evidence (seed 1-3, fair, all 10 decks, 12 games/deck, paired alternating seats; `tools/selfplay/out/v2-cp-*-seed{1,2,3}-fair.json`): `applyPassPlan` catastrophic (Lion 0-5, aggression collapse); `applyRingPlan` net harmful (44.2%, p=0.10); `applyTypePlan` exactly neutral (50.0%, 120-120, p=1.0); `ring+type` 47.5%. A per-archetype config (`applyTypePlan` for the `standard` archetype only, chosen from the training winners) gave +3 net on training rng7600 but exactly 0 on disjoint holdout rng7700 (124-124, p=1.0) — the per-deck "wins" flip between runs (Crab 71%->58%, DragonAttachments 54%->33%), i.e. noise.
- Cross-deck round-robin evidence (the metric that matters — V2 pilots each deck vs a V1 field, paired against V1 piloting the same deck on the same shuffle; `scratchpad roundrobin.js`, seed 1, all 10x9 pairs): `applyTypePlan` delta -3.9pp, `ring+type` -2.9pp. Both make V2 a worse pilot than V1.
- Analytical diagnosis (flip trace DragonAttachments vs Scorpion + `agg.js` conflict-quality tally over 36 games/deck vs field): the type-plan pushes decks off their strong axis into weaker conflicts. Lion political share 33%->44%, average declared skill 7.8->6.2, losses 52->59; Phoenix zero-skill declarations 7->14, average skill 7.0->6.1, losses 34->54. In a representative flip, V1 stayed military (11/9/12 skill, won every conflict, won the game) while V2 was steered into political conflicts it lost 4v7 and 7v9 at Scorpion's dishonor stronghold and even declared a 0-skill military conflict, then lost by dishonor. Root cause: in fair mode the planner cannot see the opponent hand, so it treats every under-defended board as a free win and over-declares marginal / off-axis conflicts, whereas V1's simple "attack the axis where I am strong, with my best characters" is robust to hidden defense.
- Fix implemented: `conflictPlanning.fairDefenseBuffer` (default 0 = unchanged V1) makes the fair-mode rollout assume the opponent can answer with `buffer x min(publicHandSize, oppFate+1)` skill per axis, so it stops over-declaring. It works as intended — `buffer=3` lifts `applyTypePlan` from -3.9pp to -0.6pp, and buffer-only (no type-plan, just the existing target-plan) is the best config — but across seeds 1-3 buffer-only nets only ~+0.5pp (+1.1/+1.1/-0.6), i.e. break-even within noise. Higher buffers (3,4) fall back to ~0.
- Decision: keep every declaration apply-layer off by default and do not ship a declaration override. The buffer is retained as a gated correctness knob (it removes the type-plan regressions) but is not enabled because it does not beat V1. The robust, holdout- and cross-deck-validated conclusion is that conflict-declaration planning has a ~±1pp win-rate ceiling versus V1: V1's declaration heuristics are already strong, and games are decided by in-conflict card play, the honor/dishonor race, and dynasty development, not by which conflict is declared (both bots win games despite losing ~25% of their declared conflicts). Reaching 60% needs improvement in those decision classes (better in-conflict tactics or a learned value function), not more declaration coefficients.

## In-conflict card sequencing / action ordering (`applyActionPlan`)

**Rejected at seed 1, n=180.** Replacing V1's fixed card pipeline with an
outcome-scoring planner over affordable subsets — including re-admitting cards
that a deck's preferred-bearer rule had vetoed — measured **117-63 (+4.4pp)**
against the shipped V2 baseline's **121-59 (+6.7pp)**, with an identical V1
control seat (109-71) in every run. Three variants were tried; all landed at or
below the baseline.

The plays themselves are correct (11 enabled a break, 12 prevented one, over 18
games), but they buy rings rather than breaks: Crane's conflict cards played
rose 56 -> 88 and conflicts won 81 -> 91 while **provinces broken went 34 -> 33**.

Do not retry by tuning weights. The blocker is that the planner can price only
about 19% of a typical hand — `conflictContribution` is defined for 8 cards in
the whole playbook, and 81% of held cards in sampled hands scored NULL. Price
the events first. Full analysis: `docs/bot-v2-deck-tuning.md`.

Also rejected within this experiment: letting the planner overrule the
"deficit above 6, give up" cutoffs. At that deficit no affordable combination
reaches the threshold, so it only bought skill in decided conflicts
(Dragon 15->13, Phoenix 15->12).


## Crab declaration sizing (all four variants): rejected

Cross-deck round-robin, Crab as the V2 seat against the whole V1 field, n=54 per
base, paired against a V1 control on identical shuffles. Two bases each.

Shipped V2 baseline: **29-25 (+7.4pp)** at base 91001 and **19-35 (+3.7pp)** at
93001. The V1 control was identical in every arm, which confirms the pairing.

| variant | 91001 | 93001 |
| --- | --- | --- |
| `secureReachableBreak` | 24-30, −1.9pp | 13-40, −7.0pp |
| `hopelessAttackKeepHome: 3` | bit-identical | 19-34, +4.4pp |
| `triggeredAbilityAllowIds` | bit-identical | bit-identical |
| `applyPassPlan` | 22-32, −5.6pp | **10-44, −13.0pp** |

Four separate lessons, none of which should be retried:

1. **Do not make V2 top an attack up to a reachable break.** A `declarationProbe`
   showed 7 of Crab's 37 reachable breaks were given up, and that ALL 7 were
   given up by the attacker plan rather than the break heuristic. Forcing the
   top-up cost ~10pp on both bases. The rollout benches those bodies on purpose
   and is right to.
2. **`attackCommitment` is dead code under V2.** With `applyAttackerPlan` on,
   `plannedNext`/`plannedComplete` return before `unbreakableCommit` is
   evaluated, so `hopelessAttackKeepHome` produced a bit-identical run — same
   wins, losses and discordant split. Anything that changes how much V2 commits
   must change the rollout.
3. **Do not turn on `applyPassPlan` for a defensive deck.** The worst result in
   the program: −16.7pp and −13.0pp against the paired baseline. Crab's hopeless
   attacks are the price of having a win condition, not a leak. This reproduces
   V1's original finding that turtling was worse.
4. **`triggeredAbilityAllowIds` cannot revive an in-play character ACTION.** That
   window is entered only for "any reaction"/"any interrupt" prompts. Bit-identical
   on both bases, and a value probe showed the card was never evaluated. The real
   gap is that in-play character Actions have no generic path at all — the board-
   Action path is gated on `(shugenja || attachmentTower)`. See
   `docs/bot-v2-per-deck-plan.md`.

## Pricing holdings from card text: rejected in favour of measurement

The first `HOLDING_ABILITY_VALUE` table was written by reading card text and
spread ability worth over 1-6. `tools/selfplay/cardLab.js` with
`scenarios/crabWallHoldings.js` replayed one province defence at five attack
sizes, swapping only the holding, with the real bot on both seats: **outcomes
tracked printed strength and nothing else.** Every +1 holding behaved identically
to every other +1, abilities included, and the effect was a threshold (+3 lost by
exactly one point, +4 held) rather than a slope.

The table was flattened to a 1-3 band and strength was made the multiplied term.
Do not re-widen the ability spread without lab evidence for the specific card.


## Crab declaration sizing: re-tested on RANDOM shuffles, two verdicts changed

The table above was measured with `rr2.js` on two FIXED shuffle bases. Re-run
with `botRoundRobin.js --games 100 --subject Crab --v2-decks Crab` (900 games per
arm, random shuffles, V2 on Crab's seat only):

| arm | rate | vs V1 | vs shipped V2 |
| --- | --- | --- | --- |
| V1 control | 39.1% | - | - |
| shipped V2 | 44.1% | +5.0pp | - |
| B' hopeless trim (adjusted) | 46.8% | +7.7pp | +2.7pp |
| C `triggeredAbilityAllowIds` | 41.6% | +2.5pp | -2.5pp |
| A `secureReachableBreak` | 38.6% | -0.5pp | -5.5pp |
| D `applyPassPlan` | 28.7% | -10.4pp | -15.4pp |

**Still rejected, now under both methodologies:** A (-5.5pp) and D (-15.4pp).

**Lever B: rejected on merit, not on a technicality.** B was originally dismissed
as inert, and it WAS inert as written - `hopelessAttackKeepHome` gated on a code
path the rollout returns before reaching. Fixed to also cap the rollout's planned
attacker set (B'), it reached 46.8% at n=900 and looked like the best arm. The
decisive re-run at n=2600 per arm settled it:

| arm | record | rate |
| --- | --- | --- |
| shipped V2 | 1137-1462 | 43.7% |
| B' hopeless trim | 1152-1459 | 44.1% |

**+0.4pp, ~0.3 SE. Null.** Shipped V2 replicated (44.1% at n=900, 43.7% at
n=2600) while B' regressed 46.8% -> 44.1%: the lucky arm came back to the mean.
B' is implemented, documented, and enabled for NO deck.

Two lessons worth more than the lever:

- "A flag produced a bit-identical run" means the flag was UNREACHABLE, not that
  the idea was wrong. Check reachability before recording a rejection - otherwise
  the idea is never actually tested.
- A promising result at n~900 must be re-run before it is believed. The noise
  floor below is +/-2.5pp, and B' sat inside it.

**The noise floor, measured rather than assumed.** Arm C changes zero decisions -
bit-identical on two fixed bases, and a value probe shows its target card is
never evaluated - yet it moved -2.5pp. At n~870 unpaired this methodology is
worth about +/-2.5pp, matching the analytic SE (~2.4pp). B''s +2.7pp over shipped V2 therefore was NOT established by that run - and the
n=2600 re-run confirmed it was nothing.

**Do not compare against `baselines/v1/` without a same-code control when the
delta looks large.** The stored file records Crab at 31.9%; a V1 control run
under identical conditions measures 39.1%. Using the stored number would have
reported +14.9pp for a +7.7pp effect.

## Near-miss DEFENSE conversion: the premise does not hold

This section retires the recommendation recorded in `bot-v2-per-deck-plan.md`
that "the leverage on breaks is converting near-miss windows, and defense is the
cheaper half". Measured on the current tree, it is not.

### What the bot actually does in a defense window

`scratchpad/defgap.js` — every defending conflict-card window over 180 games,
all ten decks, both seats on stock V1, bucketed by break deficit
(`attackerSkill - provinceStrength + 1 - defenderSkill`):

| bucket | windows | played a card | play rate |
| --- | --- | --- | --- |
| province safe | 3834 | 1478 | 38.5% |
| **1-2 from falling** | **1210** | **676** | **55.9%** |
| 3-4 from falling | 514 | 260 | 50.6% |
| 5-6 from falling | 282 | 132 | 46.8% |
| 7+ from falling | 462 | 122 | 26.4% |

V1 already converts 56% of near-miss defenses. The earlier claim that two
archetypes "never even look" is a rounding error: `spendCardsOnDefense: false`
closes only 50 of the 534 near-miss passes (9%). 87% of them close on
`no-card-passed-intent-filter`, with a playable card in hand 512 times.

### Why the filter refuses them (and is mostly right)

`scratchpad/defwhy.js` attributes every rejection in the 1-2 bucket:

| deny reason | count |
| --- | --- |
| `no-ready-participant` | 428 |
| `playbook-should-play` | 104 |
| `duel-tower-target` | 90 |
| `dragon-attachment-target` | 86 |
| `deck-specific-target` | 50 |
| `wrong-conflict-type` | 40 |
| `zero-contribution` | 38 |

`no-ready-participant` is 51% of the total and its premise is correct:
`conflict.ts:474` makes a bowed participant contribute **0** skill, so buffing
one is genuinely wasted. `duel-tower-target` and `dragon-attachment-target` are
decks correctly refusing to misplace a tower attachment (Shukujo is
Kuwanan-only). The filter is not leaking; it is working.

The one slice that IS wrong is small: cards whose effect never touches a
friendly body. Assassination is the most-rejected card in the game state (106,
of which 60 are this gate) and it does not care whether our bodies are standing.

### `defenseCheapWinMaxGap` — V1's hardcoded 3 is measured-optimal

While defending an ALREADY-SAFE province, V1 spends conflict cards to steal the
conflict win whenever it is within 3 skill. That is 1478 of the card plays
above, none of which prevents a break — the obvious candidate for waste. It is
not waste. Base 93001, n=180 paired, V1 control 87-93 in every arm:

| `defenseCheapWinMaxGap` | record | vs V1's 3 | discordant |
| --- | --- | --- | --- |
| 0 — never chase | 78-102 | **-11 games** | 6 / 15 |
| 1 | 88-92 | -1 | 11 / 10 |
| **3 (shipped)** | **89-91** | — | — |
| 6 — chase twice as far | 86-94 | -3 | 4 / 5 |

Single-peaked, negative in both directions, and 0 is near-significant on its own
(McNemar p ~ 0.08). Those ring-steals are load-bearing. The knob ships and
defaults to 3; do not sweep it again without a new mechanism.

**The general lesson.** A large population of "questionable" plays is not
evidence of a leak. This bucket was 13x larger than the enemy-target one, which
made it look like the bigger opportunity; it was 13x larger because V1 was
already capturing the value there.

### `enemyTargetIgnoresReadyParticipant` — consistent, sub-threshold, not shipped

The one genuinely wrong slice of the `no-ready-participant` veto: it also
refuses cards whose effect never touches a friendly body. Removing an enemy
participant moves the same skill differential and asks nothing of our bowed
bodies. `attachSide: 'self'` entries stay vetoed (True Strike Kenjutsu duels the
enemy but must attach to our duelist).

Decision rule fixed BEFORE the runs: ship only if all three shuffle bases are
positive AND the pooled delta is >= +2pp.

| base | `off` | `always` | delta |
| --- | --- | --- | --- |
| 91001 | 91-89 | 92-88 | +1 |
| 92001 | 91-89 | 94-86 | +3 |
| 93001 | 89-91 | 92-88 | +3 |
| **pooled (n=540)** | **271-269 (50.2%)** | **278-262 (51.5%)** | **+7 games, +1.30pp** |

3/3 bases positive (sign test p = 0.125), no base negative, and `always`
dominated `defense` on every changed deck. But +1.30pp is below the +2pp bar and
below the +/-2.5pp noise floor measured above. **Not shipped.** The knob is
implemented, spec-covered, and defaults to `'off'` for every deck and both
engines.

The ceiling is mechanical, not tuning. `scratchpad/defcheck.js` measured the
flag producing only **+10 extra card plays per 180 games**: `targetSide: 'enemy'`
covers ~116 of the 428 gate rejections, and most of those still fail
`playbook-should-play` downstream. Ten changed decisions cannot move a win rate
past the noise floor no matter how the weights are set.

**If this is revisited, enlarge the population, do not tune the flag.** The
mechanically correct answer to "every one of my participants is bowed" is a
READY effect on a friendly participant (Against the Waves, I Am Ready, The
Pursuit of Justice), which the veto also refuses today and which `PlaybookEntry`
has no marker for. Adding that marker is the prerequisite; re-running this arm
without it will keep landing at +1pp.

> **Follow-up (2026-08-03): the marker was added and the hypothesis above is
> WRONG.** Enlarging the population did not rescue the lever; scoping it to
> defence did. See the next section.

## Imperial Favor side selection: rejected, the accidental constant is optimal

`scratchpad/coverage.js` (180 games, 75,878 decisions) found that 614 of 614
Imperial Favor claims were answered by `fallback-button`. `player.ts:1335`
builds the choices as `['Military', 'Political']`, so the first button is always
Military and **no deck ever held the political favor**. The favor grants +1
skill in every conflict of its own side where the holder has a participant
(`conflict.ts:437`/`:455`), and 34% of the conflicts it could have helped were
getting +0. It looked like a free correctness fix.

It is not. Three estimators were implemented and each made the alignment worse.
All four rows below are the same 180-game round robin with both seats on V2
pass-through, so they are directly comparable (the first attempt compared a
`v1/v1` control against `v2/v2` treatments and was confounded — the conflict
mix drifts between engines):

| rule | favor-holding conflicts that got +0 |
| --- | --- |
| **always Military (shipped)** | **36.0%** |
| total board skill (`'board'`) | 40.8% |
| the axis actually contested that round (`'contested'`) | 41.6% |
| always Political | 60.7% |

Paired cross-deck round robin agrees. `'board'` on the V2 seat, three
independent shuffle bases, n=540, measured against the `off` arm rather than
the V1 control (the `off` arm is not zero — Phoenix's retained `applyIntentPlan`
entry gives it +1.1pp at base 93001):

| base | off | `'board'` |
| --- | --- | --- |
| 91001 | 91-89 | 91-89 |
| 92001 | 91-89 | 92-88 |
| 93001 | 89-91 | 86-94 |
| **pooled** | **271-269** | **269-271 (−0.37pp)** |

Two reasons, both worth remembering:

1. **The field is roughly 65/35 military.** A constant that sits on the majority
   axis beats any estimator that sometimes selects the minority one.
2. **A round holds two conflicts per player.** A per-round estimator is fitting
   a side from two observations and then spending it on the *next* round. Board
   totals are no better: they count courtiers whose political skill never enters
   a conflict, which is why Phoenix — 58% political conflicts — still wasted
   more favor under every alternative.

The claim handler is retained so the decision is named rather than anonymous in
the next coverage audit, but it returns Military unconditionally. Do not re-open
this without a *cross-round* estimator and a deck whose political share is
demonstrably above 60%.

## Dynasty first-to-pass fate: one half inert, the other half a bad trade

`GameMode.ts:69` sets `dynastyPhasePassingFate: true` for Imperial, and
`DynastyActionWindow.#handlePassingFate` gives 1 fate to the first player to
pass. Nothing in `server/game/bots` referenced the rule. Measured baseline
(`scratchpad/dynpass.js`, 180 games): 1904 dynasty passes, split 956 first /
948 second, 1098 of them leaving an affordable character in a province.

**`dynastyShopAfterOpponentPassed` — no population.** Once the opponent has
passed there is no bonus left to win, so stopping early should be pure loss. Of
259 `fate-aware-pass-after-strong-character` exits only 43 occurred with the
opponent already passed, and in **0** of those was another character still
affordable — the fate had gone on the strong body. The 516 second-passes that
do leave a body behind are `fate-aware-preserve-fate` and `duel-save-for-tower`
reserves, which exist to fund conflict cards and have nothing to do with the
pass bonus. Relaxing those is a different (and untested) lever; it is not what
this rule implies.

**`dynastyPassFirstForFate` — rejected on both measurement and arithmetic.**
Skipping a *second* cheap body while the bonus is still available measured
−1.7pp against the `off` arm at base 93001 (86-94 vs 89-91), with Scorpion at
−33.3pp and Crab at −11.1pp. The mechanism is not noise — dynasty clicks per 90
games with the flag on versus off:

| deck | off | on | passes taken for the fate |
| --- | --- | --- | --- |
| Unicorn | 168 | 128 | 39 |
| Crab | 201 | 181 | 8 |
| Scorpion | 121 | 106 | 14 |

Banking the fate costs a whole purchase. And +1 fate *is* exactly a 1-cost body,
so there is no cost band where the trade wins: skipping a 1-cost body is a wash
minus tempo, and skipping anything dearer is strictly worse. No threshold tuning
can rescue it.

## Give No Ground: pricing a correct number cost the deck that runs it

Give No Ground grants +2 military to a *defending* character. As a model that is
trivial and not in dispute: 2 while defending with a ready participant, 0 while
attacking. Measured over three shuffle bases (n=1620 paired, `scratchpad/rr2.js`
against the `off` arm), it is the **entire** loss in the live-event-pricing set.

| arm | wins / 1620 | vs `off` | Crab |
| --- | ---: | ---: | ---: |
| `off` | 811 (50.06%) | — | 67 |
| all 15 models | 815 (50.31%) | +0.25pp | 60 (−4.3pp) |
| minus `give-no-ground` | 822 (50.74%) | +0.68pp | 67 (+0.0pp) |
| minus `consumed-by-five-fires` | 811 (50.06%) | +0.00pp | 60 (−4.3pp) |

Excluding it restores Crab to *exactly* its `off` win count and leaves every
other deck untouched, so the attribution is mechanical rather than statistical.

The lesson generalises, and it is the reason `liveEventPricingExclude` exists:
**giving an event a number is not the same as improving it.** A card that
previously read as "unknown contribution" was always playable and sorted on
priority alone. A known positive number additionally makes it eligible for the
`strength-already-sufficient` veto, and moves it in `ConflictCardEconomy`, whose
filter at line 135 keeps options where `contribution === null ||
contribution <= 0 || abilityValue` — so a null and a 2 land in different
buckets. For a defensive wall deck whose whole plan is to be at the province
with a big body, that reordering was worth −4.3pp even though the number itself
was right.

Not retried without a matching change to how the economy planner treats
defensive pumps.

## Cards deliberately left unpriced

Skipped because their payoff is not skill in the current conflict, and inventing
a number for them would activate the zero-contribution veto against cards that
are doing real work:

- `iron-foundations-stance`, `swell-of-seafoam`, `the-strength-of-the-mountain` —
  protection (cannot be bowed/moved, does not bow at resolution). The value is
  insurance against an opponent effect that may not exist, plus a body kept ready
  for a later conflict. Pricing these needs a survival model, not a skill model.
- `withstand-the-darkness` — a reaction to the opponent targeting a Crab
  character; the hand-play pipeline never sees the trigger.
- `display-of-power` — reaction only, `shouldPlay: () => false`, fired from the
  reaction path.
- The third and later Banzai triggers (`lose 1 honor for no effect`) are already
  declined by `decline-no-effect-honor-loss`. They are only useful to a Scorpion
  deliberately dropping below the opponent's honor to switch on dishonor payoffs,
  which is a deck-specific mechanism and is not modelled.


## The READY marker: enlarging the population did not rescue the veto, scoping it did

`PlaybookEntry.worksWithoutReadyParticipant` marks the entries the
`no-ready-participant` veto is backwards about — cards that READY one of our
participants, or put a new ready body into the conflict. Those are the answer to
a bowed board rather than a waste on it. Eight entries carry it: Against the
Waves, I Am Ready, Ride On, In Service to My Lord, Forebearer's Echoes, Cavalry
Reserves, Raise the Alarm, Right Hand of the Emperor. It is gated by
`ConflictPhasePlannerProfile.readyEffectIgnoresReadyParticipant`, the sibling of
the enemy-target knob.

Population first (90 games, `scratchpad/readygate.js` and `readyreach.js`). The
veto fires **1343** times; Against the Waves alone eats 105 of them, 102 while
defending. The earlier arm died because the enemy-target slice bought only ~10
extra card plays, so the reachability check was the gate on running anything:

| mode | card plays | marked-card plays | `no-ready` denials |
| --- | ---: | ---: | ---: |
| off | 3004 | 68 | 1343 |
| ready marker | 3044 (+40) | 101 (+33) | 1268 |
| enemy target | 3040 (+36) | 68 | 999 |
| both | 3120 (**+116**) | 107 (+39) | 901 |

Three times the population, and superadditive. Then the arms (n=1620 paired,
three bases, against an `off` control on identical shuffles). Decision rule fixed
before the run, matching the bar the enemy-only arm was held to: ship only if
pooled >= +2.0pp with no base negative.

| arm | wins / 1620 | vs `off` | 91001 | 92001 | 93001 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `off` | 828 (51.11%) | — | — | — | — |
| ready marker, `always` | 833 (51.45%) | +0.34pp | -4 | +8 | +1 |
| enemy target, `always` | 840 (51.85%) | +0.74pp | +0 | +11 | +1 |
| both, `always` | 849 (52.44%) | +1.33pp | -3 | +20 | +4 |
| ready `defense` + enemy `always` | 852 (52.66%) | +1.55pp | -1 | +21 | +4 |
| **both, `defense` (shipped)** | **854 (52.78%)** | **+1.67pp** | **+0** | **+20** | **+6** |

**The recorded hypothesis is falsified.** Tripling the population moved the
pooled delta from +1.30pp to +1.33pp. What actually moved it was scoping: the
ready population is 90% defensive, and letting these cards through while
ATTACKING with a fully bowed board is where the bad plays are.

Shipped at `'defense'` for both halves: +1.67pp, no base negative, 8 of 10 decks
non-negative (Scorpion +6.2, Phoenix +4.9, DragonAttachments +2.5, Lion +2.5,
Crab +1.9, CraneDuels +1.2, Dragon and PhoenixShugenja flat, Crane -1.2,
Unicorn -1.9). This is still **inside the +/-2.5pp noise floor** and below the
+2.0pp bar that was fixed before the run, so it is a weak result shipped on a
mechanically sound argument, not a demonstrated win. Both knobs revert it
independently.

Unicorn is the marker's own loser and the one to look at first if this is
revisited: it runs three of the eight marked cards (I Am Ready, Ride On, Cavalry
Reserves) and the ready-only arm already cost it 3 games.

## Draw-bid honor rails: already implemented, and the reordering case is empty

Proposed after an audit found `PlaybookContext` had no `opponentHonor`: teach
the draw bid that an opponent at either honor extreme will bid low, that some
decks want cards rather than honor, and that a conquest win one break away
should outrank an honor rail.

`DrawBidTactics` already does the first two. `predictOpponentBid` returns the
low bid whenever `opponentHonor <= lowHonorThreshold (6)` or
`>= honorWinSetupThreshold (19)`, and `objective: 'honor' | 'dishonor' |
'balanced'` already splits the decks that race honor from the decks that buy
cards. `attackCommitment`-side urgency is handled by `attack-open-stronghold`.

The third — invert the ordering so a live conquest win beats an honor rail — is
**unreachable**. Bid-reason census over 90 games, 966 bids (`scratchpad
bidrails.js`):

| rail | fired | of those, their stronghold 1 break away |
| --- | ---: | ---: |
| `protect-low-honor` | 148 | 61 |
| `pressure-opponent-dishonor` | 124 | 37 |
| `attack-open-stronghold` | 34 | 34 |
| `honor-race-opportunity` | 10 | 0 |
| `pursue-honor-victory` | **2** | **0** |
| `deny-opponent-honor-victory` | **0** | — |

The two rails the inversion was aimed at fire twice and never in 966 bids. The
two that do overlap the conquest signal are `protect-low-honor` and
`pressure-opponent-dishonor`, and both are themselves win/loss conditions that
must outrank a conquest plan: bidding high at 5 honor can simply lose the game
on the transfer. No bid change was made.

The honor work went into card play instead, where nothing was budgeted at all —
see "The honor race" in `heuristic-bot.md`.

## Defending past the exact threshold: three variants, all rejected

V1 defends to exactly `attackerSkill - provinceStrength + 1 + defenseSkillBuffer`,
and `defenseSkillBuffer` is 0 for eight of the ten deck profiles. The attacker
acts *after* defenders are declared, so that block is a free flip for any card
still in hand. Three knobs were built and measured; none shipped enabled.

**The benefit population is real and large.** Census over 90 games: of 508
province breaks that happened after a defense was committed, **220 (43.3%) broke
by an excess of exactly 0** — one more point of defensive skill saves each — and
322 (63.4%) by an excess of 2 or less. Attackers played 1.94 cards per such
break. The field punishes a minimal block about as hard as a human would, so no
synthetic punisher was needed.

**The knobs reach that population.** Unscoped, the buffer moves defender clicks
938 -> 1091 and defenses held 944 -> 1073 per 90 games.

**And it still loses.** Paired arms, `scratchpad/rr2.js`, seed 1, n≈539 per base.
Every arm compared to the `off` arm on the same base, never to the V1 control.

| arm | 91001 | 92001 | 93001 | pooled |
| --- | ---: | ---: | ---: | ---: |
| `off` | 265 | 278 | 282 | — |
| `defenseBreakTie` | −5 | **−17** | +3 | **−1.18pp** |
| buffer (rate 0.5, cap 2) | . | . | +1 | +0.19pp (1 base) |
| tie + buffer | . | . | **−7** | −1.30pp (1 base) |
| tie + idle-scoped buffer | −5 | −17 | +3 | −1.18pp (inert scope) |

Pre-registered before the run: ship at pooled >= +1.5pp with no base negative.
Nothing came close.

Three lessons worth keeping:

1. **The single-base triage was a false positive.** `defenseBreakTie` measured
   **+0.56pp** at base 93001 and **−1.18pp** over three, negative on two of
   them. This is exactly what the three-base rule exists to catch; a lever that
   looks good on one base has not been measured.
2. **Scoping cannot rescue a lever that is not reachable under the scope.**
   `defenseThreatBufferIdleOnly` (buffer only when no conflict opportunity of
   ours remains) was written from the READY-marker lesson that scoping beats
   population. It produced a **bit-identical run** — 4678 card plays, 938
   defender clicks, 1829 defended, 944 held, all exactly the `off` numbers —
   because a defender essentially always still has a conflict of its own coming.
   Check reachability of the SCOPE, not just of the knob.
3. **The trade itself is the finding.** Committing one extra body to turn a tie
   into a win loses, even though a tie hands the attacker the conflict and the
   ring. Combined with Crab declaration sizing, the omniscient full-threat
   defense, and `applyPassPlan`, that is four independent experiments saying the
   same thing: in this engine ready bodies are worth more than marginal conflict
   wins. Do not propose another "commit more to defense" variant without a
   mechanism that spends no extra body.

## Honor-race card budget: correct, live, and worth exactly zero

`PlaybookContext` exposed the bot's own `honor` but not the opponent's, so no
card gate could read the honor race even though `DrawBidTactics`,
`DuelBidTactics`, `BoardAwareDynastyTactics` and `DeckConflictIntents` all do.
Added `opponentHonor` / `myBrokenProvinces` / `opponentBrokenProvinces`, plus a
budget for printed honor costs behind `DeckProfile.honorRaceAware`.

The gate is live — 380 denials over a 90-game census — but the win rate does not
move: **282 wins against the `off` arm's 282** at base 93001 (n=539), 283 after
the two correctness fixes below. Per deck it is noise summing to zero.

The reason is population. Honor-cost cards are 196 of 4678 card plays (4%), and
the ad-hoc per-card constants already covered the expensive one — Assassination
plays 15 times with or without the budget, because its own `honor >= 6` gate
fires first. `honorRaceAware` ships **off**.

Two real defects were found while building it, and both are fixed:

- **Banzai must not be priced as a card honor cost.** Its honor buys an
  *optional* second resolution, so budgeting it at the play vetoed a free +2 and
  cost 6 Banzai plays per 90 games. The budget belongs on the
  `banzai-recur-for-honor` prompt and on the contribution (`banzaiRecurAllowed`).
- **A generic honor floor fights the dishonor deck.** Scorpion spends honor on
  purpose — dropping below the opponent is what turns its cards on — and
  `DishonorTactics.canPayHonor` already owns that floor. Stacking the generic
  budget on top measured Scorpion at −3.7pp; the policy now defers whenever
  `canPayHonor` is defined.

What survives is the plumbing, which is free and correct: every gate can now see
both honor pools, and the printed-legality clauses on Compromised Secrets and
Forgery ("play only if you are less honorable than an opponent") are gated on
the real comparison instead of being clicked for the engine to refuse.

## Dynasty ability pricing — right diagnosis, wrong insertion point

**Rejected 2026-08-04.** Ships off (`dynastyAbilityScale`,
`dynastyAbilityCostWeight`, both 0).

The diagnosis was correct and worse than expected. `dynastyCharacterInfo` prices
a character's ability as `min(4, abilityCount * 0.7 + strategicTerms * 0.45)`,
and the engine registers 5-6 *framework* reactions on every character, so
`abilityCount * 0.7` alone reaches 3.5-4.2 before any card text is read. Across
all 117 field characters the term takes three values — 3.50 (24 cards), 3.95 (3)
and 4.00 (90) — a spread of 0.375 after its weight, against a
`primarySkillWeight` of 1. It is also unsigned, and its phrase list contains
`cannot be`, so Hiruma Yojimbo scores its "cannot be declared as an attacker" as
a bonus and Shiba Peacemaker (4 military that may never attack) is
indistinguishable from a vanilla body.

`DynastyAbilityValue.ts` fixes that with 50 signed prices over static text only.
It reaches a large population — 47.3% of all dynasty buys (494 of 1045) — and it
measured **+1.11pp, positive on all three bases**, which is the first lever in
this program not to come back negative.

Then three **fresh** bases returned **270-270, exactly 0.00pp**, with the null
arm scoring 90-90 on each of them — so the rig was sound and the lever was not:

| bases | record | vs 50% |
| --- | --- | ---: |
| 91001 / 92001 / 93001 | 276-264 | +1.11pp |
| 94001 / 95001 / 96001 | 270-270 | 0.00pp |
| **pooled, 1080 games** | **546-534** | **+0.56pp** (z=0.37, p=0.72) |

**Three bases agreeing is a one-in-four coincidence, not a result.** This lever
also agreed with an entirely separate measurement method on its magnitude —
3.3% of games flipped x 78% of those won ~= +1.1pp, against the head-to-head's
+1.11pp — and was still worth nothing. Internal consistency between two methods
is not evidence of an effect; two methods can consistently measure noise.

The ceiling had already said so, which is why it is measured first now:
`measureDecisiveness.js` shows the change leaves **91.5% of games
bit-identical** and flips only **9 winners in 270 games (3.3%)**, capping any
effect at 1.67pp — inside the ±2.5pp noise floor. Resolving even +1.1pp in the
head-to-head would take ~7800 games.

The cause is structural: both fate-aware orderings are cost-first, so a price
can only separate cards of **equal cost**, which are usually interchangeable in
effect. `dynastyAbilityCostWeight` was the obvious fix — let the price move a
card between cost tiers — and it did not help (90.0% of games still unchanged,
+0.93pp). That closes the approach rather than leaving it open. **Do not re-tune
these prices.** A different decision — whether to buy at all, or how much fate to
place — would have to be the target.

Kept regardless, because they are correctness and infrastructure: the price list
and its specs, and the two measurement tools built for this
(`headToHeadRoundRobin.js`, `measureDecisiveness.js`).

### Two mechanisms that turned out to be unreachable

A full measurement cycle was spent before noticing the first of these. Both have
passing specs.

- **`BoardAwareDynastyTactics.choose` is never called** by any of the ten field
  deck profiles. The price list was wired into its `candidatePower` first and a
  90-game census came back bit-identical to the control. Its per-deck
  `characterValueById` override map is also empty everywhere, so that tuning
  hook has never done anything either. The live path is
  `fateAwareDynastyDecision`.
- **`ConflictPhasePlanner.planDefense` never runs**, because `applyDefensePlan`
  defaults to `false` and no deck enables it. Its honor-aware chump block
  (`honorPressure = clamp((8 - honor) / 6, 0, 1)`) is therefore dead, and
  `profile.chumpBlock` in `JigokuBotPolicy` is not a fallback beneath a smarter
  planner — it is the only chump-block V1 executes.

A passing spec proves a mechanism is correct, not that it is reachable.

## Chump-blocking a hopeless defense — no measurable gain

**Rejected 2026-08-04.** `chumpBlock` stays as it was: on for the two deck
profiles that already set it, off elsewhere. `chumpBlockHonorCeiling` and
`chumpBlockSurplusBodies` ship at 0, their unconditional reading.

An unopposed loss costs the loser 1 honor (`conflictflow.ts:838`), and a chump
defender prevents it for the price of one body's readiness — defenders bow on
return home (`conflictflow.ts:950`). The population is real: 110 reachable
windows per 90 games, and turning the flag on field-wide moves chumps from 24 to
93.

Head-to-head, changed bots against unchanged: **+0.74pp, but −1.67pp on one of
three bases** — inconsistent where the dynasty lever was not. The scoped variant
(chump only at low honor and only with a spare ready body) measured +0.19pp and
brackets the question from below, since the scope also restricts the two decks
that already chump, taking them from 24 chumps to 12.

The decisiveness probe explains it: chump changes the *path* of 13.3% of games —
by far the most of any lever tested — but flips only 6.7% of winners, and wins
4 of those 6. It buys honor without buying wins, which is the same verdict the
defensive-commitment experiments keep returning.

## Measurement method changed as a result

The single-base false positive that started this (`defenseBreakTie` reading
+0.56pp at base 93001 and −1.18pp over three) is now structurally impossible to
repeat, because the default rig has a null arm that must score exactly 50.00%.
See `bot-v2.md` and the `/roundrobin` skill. One finding from that null arm is
worth repeating here: **its per-deck rows swing ±28pp at exactly 0.00pp total**,
so per-deck breakdowns in the head-to-head are deck strength, not effect.

## Retest on the head-to-head rig: two confirmed, one reversed

**2026-08-04.** The defense and honor levers above were originally measured on
the paired rig with fixed bases. Re-run as a direct challenge (changed bots
against unchanged bots, 90 ordered cross-deck pairings, three bases, 540 games,
null arm exactly 50.00%):

| lever | paired rig | head-to-head | 91001 | 92001 | 93001 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `defenseThreatBuffer` | −1.39pp | **−1.11pp** | −1.67 | −1.11 | −0.56 |
| `honorRaceAware` | 0.00pp | **−0.37pp** | −0.56 | 0.00 | −0.56 |
| `defenseBreakTie` | −1.18pp | **+1.02pp** | +0.56 | +1.67 | +0.84 |

**Confirmed:** the threat buffer is negative on both rigs and on all three
bases. The honor budget is zero on both rigs. Those rejections were not seed
artifacts and can be treated as settled.

**`defenseBreakTie` is worth zero, and BOTH earlier verdicts were noise.** It
was rejected at −1.18pp on the paired rig, then measured +1.02pp on the
head-to-head — positive on all three of its first bases, which looked like a
clean reversal. Three fresh bases returned −0.56pp. Pooled:

| bases | record | vs 50% |
| --- | --- | ---: |
| 91001 / 92001 / 93001 | 275-264 | +1.02pp |
| 94001 / 95001 / 96001 | 267-273 | −0.56pp |
| **pooled, 1079 games** | **542-537** | **+0.23pp** (z=0.15, p=0.88) |

Per base: +0.56 / +1.67 / +0.84 / **−2.22** / +0.56 / 0.00.

The decisiveness probe explains the swings. This lever flips **8.3% of games**,
the most of anything measured — 2.5x the dynasty price list — and leaves only
81-83% of games unchanged, so its ceiling is 3.3-5.0pp and it genuinely matters.
But it wins just **9 of 15 decided games** (sign test p=0.61). **High
decisiveness with no direction** is the worst case for a small-sample rig: it
produces large per-base swings that read as confident results in whichever
direction the bases happened to fall.

This is the pattern to watch for. A lever with a real mechanism and a real flip
rate can still be worth nothing, and it will look alternately great and terrible
until enough independent bases are pooled.

**The general lesson is about the older rig, not this lever.** Any verdict in
this file that came from the paired rig with a small per-deck n, and that was
not replicated across bases, is weaker than it reads. The ones with large,
consistent, multi-base effects are unaffected.

## `defenseBreakTie`, settled: 4319 games, 24 bases, and the reason it is null

**2026-08-04, second pass.** The six-base pooled +0.23pp above was re-run at
scale on the parallel rig (`tools/selfplay/parallelHeadToHead.js`, 540 games in
3.3 minutes instead of ~50), on **18 bases never used for it before**.

| run | games | bases | result |
| --- | ---: | ---: | --- |
| first six bases | 1079 | 6 | +0.23pp, p=0.88 |
| high-sample re-run | 3240 | 18 | **−0.43pp, z=−0.49, p=0.62** |
| **pooled** | **4319** | **24** | **2148-2171, −0.27pp** |

Every game decided — 0 draws, 0 timeouts, `stopReasons {"decided":3240}`. Per
base: 4 positive, 9 negative, 5 exactly 90-90, extreme −2.22pp. **Resampling 3
bases at random out of this settled null reads ≤ −1pp 17.8% of the time**, which
is the size of the trap in a three-base rig, measured rather than asserted.

Paired probes over a further 1350 games flipped **74 decided games exactly
37-37**.

### Why: the prize is not what the lever's name suggests

Three engine facts, none of them in the bot code, and all three found by reading
`conflictflow.ts` rather than by measuring:

1. **The attacker takes the ring's fate at DECLARATION**, before defenders are
   declared (`conflictflow.ts:381-400`, `takeFateFromRing` with
   `recipient: attackingPlayer`). The fate is gone before the defense is sized.
2. **Only the attacker resolves the ring effect** — `resolveRingEffects` is
   wrapped in `if(this.conflict.isAttackerTheWinner())` (`conflictflow.ts:903`).
   A defender who wins CLAIMS the ring but does not resolve it. Cards exist
   specifically to grant that (Defend the Wall, Staunch Hida, Guardian Kami,
   Akodo Toturi), which is the confirmation.
3. Every defender bows on return home.

So the extra point buys **one denied ring effect and a claimed ring** — not a
ring. Telemetry over 1080 paired games priced the other side: the marginal body
is worth **2.55 skill** on average (43% cost 3 or more, one cost 10), 93% of
firings still have a conflict of our own to open, and **49% spend the LAST ready
body**.

**The bot's own value model prices this trade at 8:1 in favour and is wrong.**
`ConflictPhasePlanner.scoreDefense:664` credits a defensive conflict win with
the full symmetric `conflictWinValue` (2.5) plus `claimedRingValue` (0.6)
against `readySkillValue` 0.12/point. The comment one line above even says *"the
defender claims the contested ring without resolving it"* — the rule was known
and the value was left symmetric anyway. Split that term before ever enabling
`applyDefensePlan`.

### The scoped arm: mechanically right, still not shippable

Cross-tabbing the decided games by the state at each firing found the loss in
exactly one bucket, and not the one the cost hypothesis predicted:

| ready bodies at the firing | flips to / away |
| --- | --- |
| **1 (the last body)** | **13 / 22** |
| 2 or more | 11 / 7 |

Marginal *skill* does not separate them and neither does conflicts-remaining.
The cost is the last BODY, not its size — which is
`DefenseCommitmentPolicy.breakTieMinReadyCount`.

Re-measured on **12 bases never used to find the cut** (the search bases are
burned), decision rule fixed in advance at "≥30 decided games and ≥2:1":

| arm | flip rate | decided | net | implied |
| --- | ---: | --- | ---: | ---: |
| unscoped | 5.2% | 26 to / 30 away | −4 | −0.37pp |
| **`breakTieMinReadyCount: 2`** | **2.8%** | **17 to / 13 away** | **+4** | **+0.37pp** |

The scope does what the telemetry said: it declines 1692 windows, keeps 124 of
265, and flips the sign. It is still **rejected** — 17/30 is p=0.29, the
surviving effect is +0.37pp against a ceiling of 1.39pp, and resolving it would
take roughly 70,000 head-to-head games for a quarter of a point. Ships **off**,
documented, so the next person does not re-derive it.

Per-deck rows from that run (Crab +4, Lion +4, Scorpion −3) are 3-8 decided
games each and are **not** a basis for per-deck enablement.

## Opponent-aware conflict axis: NOT rejected — this one shipped

**2026-08-04.** Listed here because the road to it runs through two measurement
traps that belong in this file even though the lever survived them.

V1's fair `preferredConflictType` compared only its OWN ready board. The
omniscient variant beside it subtracts the opponent's board and their affordable
hand tricks, and **only the hand term is genuinely hidden** — the opponent's
ready board is public, and the fair `ringScore` a few lines away already reads
it. `ConflictDeclarationPolicy.opponentBoardWeight: 1` closes that and is now ON
in `DEFAULT_PROFILE`: **+1.58pp over 6468 head-to-head games on 36 independent
bases, z=2.54, p=0.011**, positive on all three base sets and 26 of 36 bases.

### Trap 1: a paired probe reads the same lever 2.7x larger on one seat

| measurement | bases | result |
| --- | --- | ---: |
| probe, change on **seat 0** | 91001-96001 | 45 flips to / 23 away, **+4.07pp** (p=0.0055) |
| probe, change on **seat 1** | 91001-96001 | 34 to / 26 away, **+1.48pp** |
| probe, seat-averaged | 91001-96001 | **+2.78pp** |
| head-to-head, SAME bases | 91001-96001 | **+2.78pp** |

`probePaired.js` treats ONE seat and never swaps it, so a first-player
interaction survives in it and cancels in the head-to-head by construction.
Seat-averaged the two rigs agree **to the decimal**. Always run `SEAT=0` and
`SEAT=1`.

### Trap 2: base SETS differ by more than the noise floor within a set

With seats averaged, everything left was which bases were used: 91001-96001 are
worth **+2.78pp** to this lever and 120001-131001 **+0.46pp**. A three-base or
even twelve-base run on the wrong set reads this as nothing. The answer is to
POOL base sets, not to pick one — 36 bases gave +1.58pp at p=0.011.

**Both traps pointed in opposite directions on the same lever**, and either one
alone could have shipped a false positive or buried a real gain.

### Why it works, mechanically

Over 3798 axis decisions the policy moves 715 (18.3%). **602 of them are
military -> political (84%)**: V1 over-declares military because its tie-break is
`military >= political` and most boards carry more military skill. Each switch
gives up **1.90** own skill to dodge **5.40** opposing skill, a net **+3.51**
differential, and **71% of switches leave an axis we were already losing on raw
skill**. It flips 12.6% of games — the highest decisiveness measured here.

Per deck, causal, both seats pooled: **eight of eight non-rush decks positive,
none negative**. Lion and Unicorn record *exactly zero flips* because
`forceMilitaryConflict` returns before the policy is consulted.

The response is **flat in the weight** (0.5 -> +0.51pp, 1.0 -> +0.46pp,
1.5 -> +0.56pp on a shared six bases), so do not try to optimise the constant.

### Verified after enabling, in both directions

"The flag is set" has failed to mean "the mechanism runs" twice in this project,
so the ship was checked end to end:

| check | result |
| --- | --- |
| `refactorIdentity.js` SHA | `04bb672a3543db31` -> `fdac489933f41c64` (V1 really changed) |
| inject the NEW default (weight 1) — must be a no-op | **exactly 50.00%** (269-269) |
| inject weight 0 — OLD V1 against shipped V1 | **−2.09pp** (1032-1122 of 2154, p=0.052), 12 unused bases |

The reverse arm replicates the forward effect at the expected size on bases
never used for it. **~10,200 games total on this lever**, two null arms at
exactly 50.00%.

## Dynasty-phase SKIP to save fate (`saveFatePass.earlyRounds` / `lateFromRound`): rejected

The "pass turn two to save fate" half of the Kyuden Bayushi primer. Full
write-up and the engine reasoning in `bot-save-fate-pass.md`.

- Rig: `probePaired.js`, `SEAT=0` and `SEAT=1` pooled, four bases, 2176 paired
  games per arm. Null arm (profile named but inert) 272/272 bit-identical.
- Skip rounds 2+3 when two bodies stand: **-4.64pp**, 54 flips to / 155 away,
  sign-p < 0.0001. **No deck positive.** Fire rate correlates with damage at
  **r = -0.652** across the 17 decks, and the one deck that never fires
  (PhoenixPhoenix) measures exactly 0.00pp.
- Setup + skip round 2: **-1.06pp**, against +2.02pp for the same setup half
  with no skip on the same bases. The skip costs ~3.1pp wherever it is added.
- Late rounds only (skip a round-4+ phase while the board is ahead):
  **CEILING 0.23pp** — under the noise floor, so no run can resolve it and
  tuning `lateSkillRatio` cannot help. Of the round-4+ windows only 129 reach
  "board ahead"; 1056 are refused because our own provinces are already
  falling and 1505 because the board is too thin.
- Reason, and why it will not come back in a new shape: V1 buys nearly every
  body with zero extra fate, so it is discarded in that same round's fate
  phase. At the round-two dynasty window V1 has **no characters 33% of the
  time and exactly one 57% of the time**. There is no standing board to
  protect, so the skip forfeits development rather than banking tempo.
- This reproduces the earlier `dynastyPassFirstForFate` rejection (-1.7pp) at
  four times the sample size and explains it. The SETUP half of the same
  profile — a fate floor on round-one buys — is the part that works and
  shipped (+2.22pp, p=0.011).

## Extending the save-fate floor past round three: rejected

`saveFatePass.setupRounds` beyond `[1,2,3]`. Full write-up in
`bot-save-fate-pass.md`.

- Paired probe, both seats, 2176 games each, bases 91001-94001: rounds `[1..5]`
  read **+1.65pp (sign-p 0.0078)** and every-round read **+1.79pp (p=0.0039)**.
- Head-to-head on six bases never used to find it: **+0.80pp, z=0.91, p=0.363**,
  and negative on one base.
- The lesson: those two probe arms were run on the SAME base set, so their
  agreement was not a replication. Two arms agreeing on one base set is one
  measurement, not two.
- The ceiling had already halved (18.9% of games flip for the `[1,2,3]` step
  versus 8.0% here), which was the early warning. `setupRounds` stays `[1,2,3]`.

## Dynasty-phase SKIP, RETESTED on the persistent-board baseline: still rejected

The skip's original -4.64pp had a specific cause — no board to protect — and the
shipped fate floor removed that cause, so it was re-measured rather than left on
an inherited verdict. Baseline: shipped V1 (floor rounds 1-3, skip off), both
seats, four bases, 2176 games per arm.

| arm | fires | result |
|---|---:|---:|
| rounds 2+3, two bodies | 1805 | **-8.64pp** (p<0.0001) |
| rounds 2+3, three bodies | 656 | **-3.31pp** (p<0.0001) |
| board strength ONLY, from round 2, 1.25x | 679 | **-2.99pp** (p<0.0001) |
| board strength ONLY, from round 2, 1.75x | 181 | -0.23pp, CEILING **0.46pp** |

- It got **worse**, not better: -4.64pp before the floor, -8.64pp after. The
  floor made rounds two and three worth MORE, so declining to buy in them costs
  more. The floor and the skip are the same question answered opposite ways.
- The board-strength rule, **isolated for the first time** (no round list at
  all), fired 679 times on a board that was genuinely ahead and won 27 of 119
  decided games. The skip loses even while winning.
- Every bar sits on one line: damage is proportional to firing rate, down to a
  firing rate of zero. Wrong SIGN, not wrong scope. No scoping can rescue it.
- No deck was positive in any arm, at any bar.

### ...including "one turn off", which is what the advice actually says

The arms above skip rounds two AND three. The human advice is "skip turn two OR
turn three depending on board state". `maxSkipsPerGame` was added to express
that (default 0 = uncapped, inert unless an arm names it), and it does not help:

| arm | skips taken | result |
|---|---:|---:|
| round 2 only | 674 | **-3.26pp** (p<0.0001) |
| round 3 only | 1342 | **-6.11pp** (p<0.0001) |
| round 2 OR 3, cap 1 per game | 1571 | **-7.26pp** (p<0.0001) |

Round two is not special — it looks milder only because fewer boards qualify
that early. Per skip taken, rounds two and three cost the same.

**Net flips regress on skips TAKEN at r = -0.996, slope -0.107 games per skip**,
across all seven scopings measured (round choice, body bar, per-game cap,
strength ratio, from 181 to 1805 skips). A skipped dynasty phase costs about a
tenth of a game regardless of when or why. Every scoping buys the same thing —
fewer skips — and the only one that stops losing is the one that stops firing.

## Banking fate for a strong hand: rejected (both halves)

Full census and reasoning in `bot-fate-starvation.md`.

Fate starvation is REAL and was measured: 48.4% of conflict-window closes hold
a card the bot cannot pay for, ~47% of closes happen on 0-1 fate, and the
starved cards cost 1-2 (display-of-power 836, feral-ningyo 719,
forebearer-s-echoes 673, regal-bearing 341, consumed-by-five-fires 449). The
diagnosis was right; neither fix worked.

- **`saveFatePass.handReserve`** — hold back the cheapest wanted card's cost
  from the dynasty budget. Field-wide **-1.98pp (p=0.0095)** at a 1-fate
  reserve and **-4.14pp** at 2, the usual dose-response.
- **`aggressiveSpend`** — force the best legal affordable card at the
  `no-card-passed-intent-filter` gate instead of passing. Field-wide -0.92pp
  (p=0.23) at priority>=5 and +0.14pp (p=0.88) at priority>=9. Null.
- **Both per-deck candidates INVERTED on fresh bases.** ScorpionBidWar's
  reserve went +8.59pp (p=0.007) -> **-5.21pp**; Lion's aggressive spend went
  7-0 in decided games (p=0.016) -> **0.00pp, 9-9**. About 100 per-deck rows
  were screened across the two experiments, so five false positives at p<0.05
  are expected; these were two of them.

**Measurement trap worth remembering:** `isPlayableByMe` folds COST into
playability, so any "what could the bot have played" census that filters on it
cannot see fate starvation at all and will report that fate is not the
constraint no matter how starved the bot is. Count `cost > fate` separately.

## Phoenix Shugenja fate-equivalent ring plan: null (reachable, decisive, directionless)

`shugenja.ringPlanEnabled` replaces V1's saturated ring score for this deck with
one currency. V1 prices any ring holding fate at `1000 + 100 x fate` and adds
every per-card bonus AFTER it, so `ringCardBonus: 18` can never outrank a
one-fate pile — the ring choice is decided by fate alone. The plan scores a ring
in fate-equivalents instead: the pile, plus what that pile UNLOCKS from hand
that we could not already afford (Pacifism / Stolen Breath at 2, Disguised
Tadaka at five minus the prepared base's printed cost, Consumed by Five Fires at
5 and only against five actionable enemy fate), plus what contesting that
ELEMENT contributes (free Feral Ningyo bodies and a Covert lockout on a narrow
board for water, Kudaka's fate-and-card for air, Ujina for void).

The mechanism is neither inert nor mistuned-into-silence, which is why this is
worth recording rather than retrying:

| | void | water | earth | air | fire | fate taken | fate left | took smaller pile |
|---|---|---|---|---|---|---|---|---|
| V1 control | 292 | 197 | 249 | 175 | 197 | 854 | 862 | **0** |
| ring plan | 259 | **280** | 196 | 173 | 158 | 763 | 1114 | **159** |

Water rises 42%, the bot refuses a larger fate pile 159 times, and it collects
11% less ring fate. **25% of the deck's games flip winner** and only ~27% stay
bit-identical, so the ceiling is 12-13pp — far above the noise floor.

It still wins exactly half of them. Pooled over 39 fresh bases and both seats,
`probePaired` decided games split **167 to / 168 away (n=335, p=0.96)**;
seat-averaged effect **-0.08pp**.

Two things this cost, both already in the skill and both re-confirmed here:

- **13 bases were not enough.** The lever read **+5.29pp on seat 0 / +2.88pp on
  seat 1** over bases 100001-112001, then **+0.24pp / -4.57pp** over
  120001-145001. The seats split in OPPOSITE directions on the larger sample.
- **High decisiveness makes the swings larger, not the answer clearer** — the
  same shape as `defenseBreakTie`.

What the result actually says: for this deck the ring choice matters enormously
(a quarter of its games hang on it), and a LINEAR value for each payoff is not
the rule that exploits it. The human play this was modelled on does not give
water a standing bonus; it takes water when Ningyo plus a Covert lockout
converts that specific conflict into a BROKEN PROVINCE, and takes the fate
otherwise. That is a threshold on the phase outcome, which is what
`ConflictPhasePlanner`'s rollout already computes and what
`ConflictDeclarationOption.ringElement` exists to express — behind
`applyIntentPlan`, which is `false` in both planner profiles and overridden by
no deck, so that whole surface is currently dead code.

The knobs stay in the profile, default off and `refactorIdentity`-clean
(`cfa9c47963546588`), as the rig for that next attempt.

### Route B: handing the ring to the rollout, and the break test — also null

The follow-up to the entry above. If a LINEAR value per payoff is the wrong
shape, the right shape is the deck's actual rule: contest water when the free
Feral Ningyo bodies and a Covert lockout convert THIS declaration into a break,
and take the fate otherwise. Three structures were built and measured.

**1. `conflictPlanning.applyRingPlan` — give the ring to the phase rollout.**
The rollout already scores whole phases by whether they reach a break, so in
principle it can answer the question directly. It does not help: the rollout
weights a ring by its own `selfValue`/`ringFateValue` scale rather than V1's
fate tier, so it stops chasing fate piles and drifts to VOID. Census over three
bases: water flat at 100 both arms, void 144 -> 184, a smaller fate pile taken
122 times. Triage read 2 to / 5 away.

**2. `shugenja.ringPlanPlannerResources` — publish what the rollout cannot see.**
`ConflictPlannerCharacter.covert` is only set once the qualifying conflict is
already running, and Feral Ningyo sits in hand at its printed cost though it
enters FREE. Both are now publishable per element
(`selfRingHandThreat`, `selfRingCovert`) so the rollout computes the break
itself. Alone it is **87.5% inert** — with a fate-first ring choice the bot
almost never contests water, so the better break math has nothing to apply to.
Combined with (1): 2 to / 8 away. Each half needs the other, and together they
still lose.

**3. `shugenja.ringPlanBreakAware` — keep fate-first, let an element jump the
tier only when it converts a miss into a break.** This is the faithful version
and it behaves correctly: water 100 -> 116 and a larger fate pile declined only
**20 times** (against 159 for the flat values and 122 for the rollout), i.e. a
threshold rather than a preference. It is still null.

| arm | pooled decided | verdict |
|---|---|---|
| break test, water only | 94 to / 76 away, n=170 | p=0.17 |
| break test + air/void economy | 105 to / 106 away, n=211 | p=0.95 |

Both seats disagreed in sign in both runs (-0.48 / +4.81, then +1.92 / -2.16).

**RETRACTION (2026-08-12): the two break-test rows above are void.** They
measured a break test whose "could I break this WITHOUT the element" baseline
counted only bodies already in play. It read the hand from
`player.cardPiles.hand`, which in the policy's view is the CLIENT SUMMARY — id,
name, facedown, and no skills, cost or swing — so `estimateHandThreat` returned
zero for every card and the test believed the hand was empty. Any element adding
any skill therefore read as converting a miss into a break, worth 4
fate-equivalents = 4000 points against a ring-EFFECT base of 8-50.

Found by the deck's owner reviewing an exported self-play game (Scorpion, base
91001): the deck scored water 4000 for a Feral Ningyo it never played, took that
ring over a void that would have stripped fate off Bayushi Shoju, broke the
province with Shrine Maiden instead, and then declined to resolve the water ring.
Fixed with `ShugenjaRingPlanContext.baselineHandSkill`, fed from
`DecideContext.ownConflictHand` through `buildHandThreatMatrix` — which prices
affordable bodies AND buffs for every deck, so the hand model is generic and only
Feral Ningyo's free-on-water entry stays deck-specific. On the same shuffle the
declaration flips to void and no phantom conversion survives in that game.

Lesson for any future hand-aware rule: **`cardPiles.hand` is not a hand model.**
It is a display summary. Use `ownConflictHand`.

**Bug worth remembering:** the first break-aware revision short-circuited
`elementValue` and returned the break bonus ALONE, which silently scored air at
zero with Kudaka in play — the only element the break test can fire on in this
deck is water, so every non-water payoff was deleted. Conversion (skill this
element adds to this conflict) and economy (what CLAIMING the ring pays, win or
lose) are independent and must add. Fixed, specced, and re-measured above.

**Conclusion after six arms and ~1000 decided games:** the declaration ring
flips 20-27% of this deck's games and no valuation of it — flat, rollout-owned,
or break-conditional — points those flips anywhere. `auditCards` confirms the
downstream cards all fire, so this is not an unconverted plan. The ring choice
appears to trade one win path for another rather than add wins, and whatever
binds this deck's win rate is somewhere else.

## Declaration-time board read (`ConflictTempoPolicy`), 2026-08-12

Four levers derived from the owner's own account of how he reads a conflict
phase (`bot-conflict-rules-from-replays.md` rule 13). One shipped; three did
not. Paired probe, both seats, bases 500001-502001 then 510001-515001.

- **`tradeDefenseWinOnly`** — on a losing board, concede defenses that cannot be
  won instead of bowing bodies into them. **−0.18pp, p=0.84** on a 5.82pp
  ceiling, and NOT for want of reach: it diverges in 11656 windows across **94%
  of games**, the widest of anything measured on this bot. This is the sixth
  defensive lever to land flat or negative and the FIRST that defends LESS, so
  the explanation that carried the other five ("a ready body is worth less than
  the tempo spent keeping it") does not survive it either. Defense SIZING looks
  like a free parameter in this engine in both directions. Do not propose
  another one without a mechanism that is not sizing.
- **`tradeAttackSendAll`** — send every eligible body on a losing board instead
  of V1's all-but-one. **−0.49pp** (4 to / 12 away, p=0.077), ceiling 0.98pp.
- **`bodyAdditionalFateSecondPlayer: 1`** — the second player buys bodies that
  persist, because the first-player token alternates and it opens the next
  conflict phase. **+0.01pp, p=1.00** over 4896 games. Three of four cells
  positive and the fourth (seat 1, fresh bases, 19 to / 32 away) cancelled them
  exactly. Reaches only 6 of 17 decks; eleven show zero decided games.
  **SHIPPED ANYWAY at the owner's request** — a null, not a negative, and he
  judges the games by hand in live play. Do not treat it as a measured win.
- **`bodyAdditionalFateEndgame: 0`** — unmeasurable, not rejected: −0.12pp on a
  **0.49pp** ceiling, 1.0% of games flipped.

**`controlAttackKeepHome: 1` was a BROKEN ARM, not a null.** It produced games
bit-identical to the adjacent arm while computing a keep-home in 822 windows,
because V1's default `all-but-one` sizing already is `Math.max(1, totalEligible
- 1)` — the branch was degenerate with the code it replaced. A null arm cannot
catch this (it moves both seats together). Diff a new arm against the ADJACENT
arm as well as the control.

Shipped from the same policy: the water **ready loop**, +0.32pp / p=0.009 over
4896 games. See `bot-conflict-rules-from-replays.md`.
