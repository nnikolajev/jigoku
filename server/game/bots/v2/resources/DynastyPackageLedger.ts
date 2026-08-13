// Tracks a chosen dynasty package across the prompts that execute it, so the
// second half of a two-card buy is not re-decided (and re-priced) after the
// first card is already paid for.
import type { BotActionCandidate } from '../model/Candidate';
import type { PlanningState } from '../model/PlanningState';
import type { JointResourcePlan, ResourcePackage } from './ResourcePackagePlanner';

export type DynastyPackageProofKind = 'initial-joint-package' | 'retained-joint-package';

export interface DynastyPackageProof {
    readonly kind: DynastyPackageProofKind;
    readonly packageId: string;
}

export interface DynastyPackageWindow {
    readonly candidateIds: ReadonlySet<string>;
    readonly package?: ResourcePackage;
    readonly proofKind?: DynastyPackageProofKind;
    readonly annotationPlan: JointResourcePlan;
}

interface RetainedPackage {
    readonly phaseId: string;
    readonly package: ResourcePackage;
    readonly remainingCandidateIds: Set<string>;
    complete: boolean;
}

/**
 * Retains one evaluated dynasty package for the whole dynasty phase. Once the
 * package is complete or abandoned, V2 cannot start a second package in that
 * phase; ordinary V1 fallback remains available.
 */
export default class DynastyPackageLedger {
    private retained?: RetainedPackage;

    prepare(state: PlanningState, plan: JointResourcePlan,
        candidates: readonly BotActionCandidate[]): DynastyPackageWindow {
        const phaseId = state.scopes.phaseId || state.phase;
        if(this.retained && this.retained.phaseId !== phaseId) this.retained = undefined;
        if(state.phase !== 'dynasty') {
            return { candidateIds: new Set(), annotationPlan: plan };
        }
        if(this.retained) {
            if(this.retained.complete) return { candidateIds: new Set(), annotationPlan: plan };
            const available = new Set(candidates.map((candidate) => candidate.id));
            for(const id of [...this.retained.remainingCandidateIds]) {
                if(!available.has(id)) this.retained.remainingCandidateIds.delete(id);
            }
            if(this.retained.remainingCandidateIds.size === 0) {
                this.retained.complete = true;
                return { candidateIds: new Set(), annotationPlan: plan };
            }
            const candidateIds = new Set(this.retained.remainingCandidateIds);
            return {
                candidateIds,
                package: this.retained.package,
                proofKind: 'retained-joint-package',
                annotationPlan: {
                    ...plan,
                    selectedDynasty: this.retained.package,
                    preferredCandidateIds: [...candidateIds].sort()
                }
            };
        }
        const selected = plan.selectedDynasty;
        const preferred = new Set(plan.preferredCandidateIds);
        const candidateIds = new Set((selected?.candidateIds || []).filter((id) => preferred.has(id)));
        return {
            candidateIds,
            package: candidateIds.size > 0 ? selected : undefined,
            proofKind: candidateIds.size > 0 ? 'initial-joint-package' : undefined,
            annotationPlan: plan
        };
    }

    proof(window: DynastyPackageWindow, candidateId?: string): DynastyPackageProof | undefined {
        if(!candidateId || !window.package || !window.proofKind || !window.candidateIds.has(candidateId)) return undefined;
        return { kind: window.proofKind, packageId: window.package.id };
    }

    commit(state: PlanningState, pkg: ResourcePackage, candidateId: string): void {
        const phaseId = state.scopes.phaseId || state.phase;
        if(!this.retained || this.retained.phaseId !== phaseId) {
            this.retained = {
                phaseId,
                package: pkg,
                remainingCandidateIds: new Set(pkg.candidateIds),
                complete: false
            };
        }
        this.retained.remainingCandidateIds.delete(candidateId);
        if(this.retained.remainingCandidateIds.size === 0) this.retained.complete = true;
    }

    abandon(): void {
        if(this.retained) this.retained.complete = true;
    }
}
