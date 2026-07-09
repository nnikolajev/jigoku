#!/usr/bin/env python3
"""Train the seed-3 move evaluator from self-play trajectories.

Reads the per-decision JSONL produced by runTrajectories.js. Each decision has
the position (`state`), every legal option (`options[i]`), the chosen index, and
the game's terminal outcome (`won`). We train a model that scores one
(state + option) pair by how likely it leads to a win; at inference the bot
scores every option and takes the argmax.

Two models are trained:
  * gradient-boosted trees (GradientBoostingClassifier) -> EXPORTED. Its trees
    serialize to plain JSON the TS bot walks in-process (no Python at runtime,
    no native deps). Trees are scale-invariant so no standardizer is needed.
  * logistic regression -> exported as a linear fallback and to report the
    simple-model baseline.

Usage:
    python tools/selfplay/train.py --data tools/selfplay/out/trajectories.jsonl \
        --out tools/selfplay/out/weights.json
"""
import argparse
import json
import os

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score, r2_score


def load_examples(path, target, state_schema):
    """(X, y) from chosen-option rows of decided games.

    Feature row = state features + the CHOSEN option's features.

    target='win'      -> label = whether that player won (classification).
    target='military' -> label = a DENSE reward-to-go: at each decision the
        immediate reward is the military lead (myMil - oppMil, read straight off
        the state features) plus a terminal win/loss bonus on the last decision;
        the label is the discounted sum of those future rewards. This teaches
        the model to prefer moves that grow its own military and shrink the
        enemy's — the aggression the sparse win-only signal failed to instil.
    """
    mil_idx = state_schema.index("milDiff")
    gamma, win_bonus, mil_scale = 0.95, 10.0, 6.0

    # Collect rows grouped by (game, player) in file order so reward-to-go can
    # be accumulated backwards over each player's own decision sequence.
    seqs = {}
    skipped = 0
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            ci = rec["chosenIndex"]
            opts = rec["options"]
            if not rec.get("decided") or ci < 0 or ci >= len(opts):
                skipped += 1
                continue
            key = (rec.get("gameId"), rec.get("player"))
            seqs.setdefault(key, []).append({
                "x": rec["state"] + opts[ci],
                "milDiff": rec["state"][mil_idx],
                "won": 1 if rec.get("won") else 0,
            })

    X, y = [], []
    for rows in seqs.values():
        if target == "win":
            for r in rows:
                X.append(r["x"])
                y.append(r["won"])
            continue
        # military reward-to-go, accumulated backwards
        g = 0.0
        n = len(rows)
        for t in range(n - 1, -1, -1):
            r_imm = rows[t]["milDiff"] / mil_scale
            if t == n - 1:
                r_imm += win_bonus if rows[t]["won"] else -win_bonus
            g = r_imm + gamma * g
            X.append(rows[t]["x"])
            y.append(g)

    if not X:
        raise SystemExit(f"No usable rows in {path} (skipped {skipped}).")
    y = np.array(y, dtype=float)
    if target == "win":
        print(f"loaded {len(X)} rows ({skipped} skipped), win-rate {y.mean():.3f}")
    else:
        print(f"loaded {len(X)} rows ({skipped} skipped), reward-to-go "
              f"mean={y.mean():.2f} std={y.std():.2f} range=[{y.min():.1f},{y.max():.1f}]")
    return np.array(X, dtype=float), y


def export_trees(clf, X0, raw_fn):
    """Serialize a gradient-boosted ensemble (classifier or regressor) to a
    portable tree list. Prediction reproduced in TS as:
        raw = base + learning_rate * sum_over_trees(leaf_value(x))
    (classifier: raw is the log-odds -> sigmoid for prob; regressor: raw is the
    predicted value). `base` is recovered empirically from `raw_fn` (the model's
    decision_function or predict) so TS matches sklearn exactly. The bot argmaxes
    raw over options, and sigmoid is monotonic, so the pick is identical either
    way.
    """
    lr = float(clf.learning_rate)
    trees = []
    for stage in clf.estimators_:          # shape (n_stages, 1)
        t = stage[0].tree_
        trees.append({
            "feature": t.feature.astype(int).tolist(),
            "threshold": t.threshold.tolist(),
            "left": t.children_left.astype(int).tolist(),
            "right": t.children_right.astype(int).tolist(),
            "value": t.value.reshape(-1).tolist(),
        })

    def sum_trees(x):
        total = 0.0
        for tr in trees:
            node = 0
            while tr["left"][node] != -1:
                node = tr["left"][node] if x[tr["feature"][node]] <= tr["threshold"][node] else tr["right"][node]
            total += tr["value"][node]
        return total

    base = float(raw_fn(X0[:1])[0] - lr * sum_trees(X0[0]))
    return {"learningRate": lr, "base": base, "trees": trees}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="tools/selfplay/out/trajectories.jsonl")
    ap.add_argument("--schema", default=None)
    ap.add_argument("--out", default="tools/selfplay/out/weights.json")
    ap.add_argument("--target", choices=["military", "win"], default="military",
                    help="military = dense military-shaped reward-to-go (regression); "
                         "win = terminal win/loss (classification)")
    ap.add_argument("--estimators", type=int, default=300)
    ap.add_argument("--depth", type=int, default=3)
    ap.add_argument("--lr", type=float, default=0.08)
    args = ap.parse_args()

    schema_path = args.schema or args.data.replace(".jsonl", "") + ".schema.json"
    with open(schema_path, "r", encoding="utf-8") as fh:
        schema = json.load(fh)

    X, y = load_examples(args.data, args.target, schema["stateSchema"])
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=0)

    if args.target == "win":
        gbdt = GradientBoostingClassifier(n_estimators=args.estimators, max_depth=args.depth,
                                          learning_rate=args.lr, subsample=0.8, random_state=0)
        gbdt.fit(Xtr, ytr)
        pg = gbdt.predict_proba(Xte)[:, 1]
        auc, acc = roc_auc_score(yte, pg), accuracy_score(yte, pg > 0.5)
        print(f"  GBDT win  AUC={auc:.4f} acc={acc:.4f}  ({args.estimators} trees, depth {args.depth})")
        raw_fn, metrics = gbdt.decision_function, {"gbdt_auc": auc, "gbdt_acc": acc}
        parity_raw = pg
    else:
        gbdt = GradientBoostingRegressor(n_estimators=args.estimators, max_depth=args.depth,
                                         learning_rate=args.lr, subsample=0.8, random_state=0)
        gbdt.fit(Xtr, ytr)
        pv = gbdt.predict(Xte)
        r2 = r2_score(yte, pv)
        print(f"  GBDT military reward-to-go  R2={r2:.4f}  ({args.estimators} trees, depth {args.depth})")
        raw_fn, metrics = gbdt.predict, {"gbdt_r2": r2}
        parity_raw = pv

    tree_export = export_trees(gbdt, Xtr, raw_fn)
    weights = {
        "model": "gbdt",
        "target": args.target,
        "note": "raw = base + learningRate*sum(tree leaves over state+option features); argmax raw over options",
        "stateSchema": schema["stateSchema"],
        "optionSchema": schema["optionSchema"],
        "stateLen": len(schema["stateSchema"]),
        "base": tree_export["base"],
        "learningRate": tree_export["learningRate"],
        "trees": tree_export["trees"],
        "metrics": {**metrics, "rows": int(len(y))},
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(weights, fh)

    # Parity artifact: raw feature rows + sklearn's raw output, so the TS
    # evaluator can be checked to reproduce sklearn exactly.
    parity = [{"x": Xte[i].tolist(), "raw": float(parity_raw[i])} for i in range(min(20, len(Xte)))]
    with open(args.out.replace(".json", "") + ".parity.json", "w", encoding="utf-8") as fh:
        json.dump(parity, fh)

    print(f"weights -> {args.out}  ({len(tree_export['trees'])} trees, "
          f"{len(schema['stateSchema']) + len(schema['optionSchema'])} features)")


if __name__ == "__main__":
    main()
