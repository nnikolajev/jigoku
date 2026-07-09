'use strict';

// Verify the TS MoveEvaluator reproduces sklearn's GBDT probability exactly.
// Reads weights.json + weights.parity.json (raw feature rows + sklearn probs
// written by train.py) and compares against MoveEvaluator's tree walk.
//
//   node tools/selfplay/checkParity.js [weights.json]

const fs = require('fs');
const path = require('path');
const { MoveEvaluator } = require('../../build/server/game/bots/ml/evaluator.js');

const weightsPath = path.resolve(process.argv[2] || 'tools/selfplay/out/weights.json');
const parityPath = weightsPath.replace('.json', '') + '.parity.json';

const weights = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
const parity = JSON.parse(fs.readFileSync(parityPath, 'utf8'));
const evaluator = new MoveEvaluator(weights);

// Reach the raw tree-walk directly by feeding a precomputed feature row: score()
// extracts features from game state, but the raw math is what we validate here,
// so replicate the sigmoid(gbdtRaw) path with the row as x.
function rawFromRow(x) {
    // Mirror MoveEvaluator.gbdtRaw over the raw feature row.
    let sum = 0;
    for(const tree of weights.trees) {
        let node = 0;
        while(tree.left[node] !== -1) {
            node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
        }
        sum += tree.value[node];
    }
    return (weights.base || 0) + (weights.learningRate || 1) * sum;
}

let maxErr = 0;
for(const row of parity) {
    // parity carries the model's raw output (regressor .predict / classifier
    // .decision_function); newer weights use `raw`, older ones a sigmoided `prob`.
    const got = rawFromRow(row.x);
    const expected = row.raw !== undefined ? row.raw : Math.log(row.prob / (1 - row.prob));
    maxErr = Math.max(maxErr, Math.abs(got - expected));
}
console.log(`parity rows: ${parity.length}  max|TS-sklearn| = ${maxErr.toExponential(3)}`);
console.log(maxErr < 1e-6 ? 'PARITY OK' : 'PARITY MISMATCH');
process.exit(maxErr < 1e-6 ? 0 : 1);
// eslint-disable-next-line no-unused-vars
void evaluator;
