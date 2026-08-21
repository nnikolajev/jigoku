#!/usr/bin/env bash
# Sweep the omniscient levers, one arm at a time, and write every report under
# tools/selfplay/out/omni/.
#
# Two modes, and the difference matters:
#
#   ceiling   probeOmniscient with the SAME seat omniscient in both arms and
#             the lever injected into one of them, so the pair isolates the
#             lever on top of omniscience against a fair opponent — the shipped
#             configuration. Each pairing is played twice on one shuffle, so it
#             reports how many games the lever flips AT ALL. If that ceiling is
#             under the +/-2.5pp noise floor, no head-to-head can resolve the
#             lever and tuning its values cannot help.
#
#   h2h       parallelOmniscientHeadToHead with OMNI=1: the treated seat is
#             omniscient AND carries the lever, the other seat is a plain fair
#             bot. This is the shipped configuration and its number is directly
#             comparable to the baseline arm (omniscience with no lever), which
#             measured 49.45% over 3264 games. Baseline is a hard 50%.
#
# USAGE
#   bash tools/selfplay/runOmniscientArms.sh ceiling 91001
#   bash tools/selfplay/runOmniscientArms.sh h2h 91001,92001,93001
set -u
MODE="${1:-ceiling}"
BASES="${2:-91001}"
OUTDIR="tools/selfplay/out/omni"
WORKERS="${WORKERS:-14}"
mkdir -p "$OUTDIR"

# name : injected deckProfile fragment
# Ordered by measured POPULATION, not by how clever the idea is. The seat-0
# census (out/omni/probe-s0.json, 544 games) says where the cheat actually acts:
#
#   province-target  2663 live windows, 32.6% diverged, 71.9% of GAMES touched
#   planner threat   no profile gate at all, so live in every game
#   attack sizing    exact strength moves the break target 26.7% of the time,
#                    by a mean of 0.25 skill — a rounding error
#   axis             641 live windows (3075 gated off), 4.8% of games
#   token-defense    884 live windows, 3.5% of games
#
# So the first two arms are the experiment and the rest are follow-ups.
ARMS=(
  "null:{}"
  "denyOff:{\"deckProfile\":{\"provinceTargeting\":{\"hiddenDynastyDenialWeight\":0}}}"
  "plannerThreatOff:{\"deckProfile\":{\"omniscientPlannerHandThreat\":false}}"
  "provinceOff:{\"deckProfile\":{\"useOmniscientProvinceKnowledge\":false}}"
  "threatRealism:{\"deckProfile\":{\"omniscientThreatRealism\":true}}"
  "axis:{\"deckProfile\":{\"useOmniscientConflictAxis\":true}}"
  "cheapestBreak:{\"deckProfile\":{\"omniscientCheapestBreakAxis\":true}}"
  "buffer1:{\"deckProfile\":{\"omniscientAttackResponseBuffer\":1}}"
  "tokenDefense:{\"deckProfile\":{\"useOmniscientTokenDefense\":true}}"
)

for arm in "${ARMS[@]}"; do
  name="${arm%%:*}"
  change="${arm#*:}"
  echo "=== $MODE $name ==="
  if [ "$MODE" = "ceiling" ]; then
    OMNI=1 CONTROL_OMNI=1 CHANGE="$change" SEAT=0 BASES="$BASES" \
      WORKERS="$WORKERS" ARMS=treated KINDS=omni-use \
      OUT="$OUTDIR/ceiling-$name.json" \
      node tools/selfplay/probeOmniscient.js > "$OUTDIR/ceiling-$name.txt" 2>&1
    grep -E 'CEILING|flipped' "$OUTDIR/ceiling-$name.txt"
  else
    OMNI=1 LABEL="$name" CHANGE="$change" BASES="$BASES" WORKERS="$WORKERS" \
      OUT="$OUTDIR/h2h-$name.json" \
      node tools/selfplay/parallelOmniscientHeadToHead.js \
      > "$OUTDIR/h2h-$name.txt" 2>"$OUTDIR/h2h-$name.err"
    grep -E '^TREATED' "$OUTDIR/h2h-$name.txt"
  fi
done
