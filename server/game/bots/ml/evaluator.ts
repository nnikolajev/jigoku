// Seed-3 inference: score a move with the self-play-trained evaluator.
//
// Loads the `weights.json` exported by train.py and evaluates it in-process —
// a standardized logistic dot product over the same state+option features the
// harness logged, so there is no Python at runtime and no feature drift. The
// bot scores every enumerated option and takes the argmax.

import { stateFeatures, optionFeatures } from './features.js';
import type { OptionInput } from './features';

export interface GbdtTree {
    feature: number[]; // -2 at leaves
    threshold: number[];
    left: number[]; // -1 at leaves
    right: number[];
    value: number[]; // leaf raw steps
}

export interface EvaluatorWeights {
    model: 'gbdt' | 'logistic';
    stateSchema: string[];
    optionSchema: string[];
    stateLen: number;
    // gbdt
    base?: number;
    learningRate?: number;
    trees?: GbdtTree[];
    // logistic (fallback, or model === 'logistic')
    linear?: { mean: number[]; scale: number[]; coef: number[]; intercept: number };
    mean?: number[];
    scale?: number[];
    coef?: number[];
    intercept?: number;
}

export class MoveEvaluator {
    private w: EvaluatorWeights;

    constructor(weights: EvaluatorWeights) {
        this.w = weights;
    }

    // Win-probability-style score in [0,1] for one (state, option) pair. Higher
    // is better; the bot argmaxes it over the legal options.
    score(state: any, meName: string, option: OptionInput, roundNumber = 0): number {
        const sf = stateFeatures(state, meName, roundNumber);
        const of = optionFeatures(state, meName, option);
        const x = sf.values.concat(of.values);
        const raw = this.w.model === 'gbdt' ? this.gbdtRaw(x) : this.linearRaw(x);
        return 1 / (1 + Math.exp(-raw));
    }

    // raw = base + learningRate * sum over trees of the reached leaf value.
    private gbdtRaw(x: number[]): number {
        const trees = this.w.trees || [];
        let sum = 0;
        for(const tree of trees) {
            let node = 0;
            while(tree.left[node] !== -1) {
                node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
            }
            sum += tree.value[node];
        }
        return (this.w.base || 0) + (this.w.learningRate || 1) * sum;
    }

    // Standardized logistic dot product (from `linear` or top-level fields).
    private linearRaw(x: number[]): number {
        const lin = this.w.linear || { mean: this.w.mean || [], scale: this.w.scale || [], coef: this.w.coef || [], intercept: this.w.intercept || 0 };
        let z = lin.intercept;
        for(let i = 0; i < lin.coef.length && i < x.length; i++) {
            z += lin.coef[i] * ((x[i] - (lin.mean[i] || 0)) / (lin.scale[i] || 1));
        }
        return z;
    }

    // Index of the highest-scoring option (ties broken by first). Returns -1 for
    // an empty list.
    pick(state: any, meName: string, options: OptionInput[], roundNumber = 0): number {
        let best = -1;
        let bestScore = -Infinity;
        for(let i = 0; i < options.length; i++) {
            const s = this.score(state, meName, options[i], roundNumber);
            if(s > bestScore) {
                bestScore = s;
                best = i;
            }
        }
        return best;
    }

    get featureCount(): number {
        return this.w.coef.length;
    }
}

// Convenience loader; kept out of the class so tests can inject weights inline.
export function loadEvaluator(weights: EvaluatorWeights): MoveEvaluator {
    const gbdtOk = weights?.model === 'gbdt' && Array.isArray(weights.trees) && weights.trees.length > 0;
    const linOk = Array.isArray(weights?.linear?.coef) || Array.isArray(weights?.coef);
    if(!gbdtOk && !linOk) {
        throw new Error('Invalid evaluator weights');
    }
    return new MoveEvaluator(weights);
}
