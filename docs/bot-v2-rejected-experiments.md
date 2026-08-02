# Rejected and disabled Bot V2 experiments

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
