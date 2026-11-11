#!/usr/bin/env bash
# Serial, resumable experiments. Every native solve keeps routed-native's existing budgets.
set -euo pipefail
: "${SI_DDR3_BOARD:?Set SI_DDR3_BOARD to the unchanged local board}"
export OMP_NUM_THREADS=1 TSX_TSCONFIG_PATH=examples/tsconfig.json
export IBIS_MODEL_DIR="${IBIS_MODEL_DIR:-models}"
export SI_ROUTE_CELLS_PER_RISE=2 SI_ROUTE_DISTANCE_MM=1 SI_ROUTE_DURATION_NS=8
unset SI_ROUTE_BATCH SI_ROUTE_NETS SI_ROUTE_SCOPE_NETS SI_ROUTE_SCOPE_QUIET SI_ROUTE_REUSE_DIR SI_ROUTE_PATTERN SI_ROUTE_DRIVER_MODEL SI_ROUTE_PACKAGE_OFF SI_ROUTE_VTT_OHMS SI_ROUTE_EXTRACT_ONLY
root="${SI_ADDR_CMD_RUN_DIR:-runs/addr-cmd/qualification}"
before="${SI_ADDR_CMD_BEFORE:-runs/addr-cmd/capture-c2-r1}"
mkdir -p "$root"

capture() {
  local name="$1"
  shift
  env SI_ROUTE_RUN_DIR="$root/$name" "$@" node --import tsx scripts/run-routed-ddr3.tsx addr-cmd
}

case "${1:?Choose refine, refine-reduced, radius, isolate, package-off, width, vtt, weak, slowest or spacing}" in
  refine)
    capture spatial-c3 SI_ROUTE_CELLS_PER_RISE=3 SI_ROUTE_DURATION_NS=4.999
    ;;
  refine-reduced)
    export SI_ROUTE_NETS=A4,A5,A7,A9,A11,CASn SI_ROUTE_DURATION_NS=4.999 SI_ROUTE_BATCH=1
    capture reduced-c2
    capture reduced-c4 SI_ROUTE_CELLS_PER_RISE=4
    ;;
  scope-refine)
    export SI_ROUTE_SCOPE_NETS=A4,A5,A7,A9,A11,CASn SI_ROUTE_DURATION_NS=4.999 SI_ROUTE_BATCH=1
    capture scope-bus-c2
    capture scope-bus-c4 SI_ROUTE_CELLS_PER_RISE=4
    ;;
  scope-radius)
    export SI_ROUTE_SCOPE_NETS=A4,A5,A7,A9,A11,CASn SI_ROUTE_DURATION_NS=4.999 SI_ROUTE_BATCH=1
    capture scope-bus-r2 SI_ROUTE_DISTANCE_MM=2
    ;;
  scope-quiet)
    capture scope-c2 SI_ROUTE_SCOPE_NETS=A4,A5,A7,A9,A11,CASn SI_ROUTE_SCOPE_QUIET=1 SI_ROUTE_DURATION_NS=4.999 SI_ROUTE_BATCH=1
    ;;
  radius)
    capture radius-r2 SI_ROUTE_DISTANCE_MM=2 SI_ROUTE_DURATION_NS=4.999 SI_ROUTE_BATCH=1
    ;;
  radius-reduced)
    export SI_ROUTE_NETS=A4,A5,A7,A9,A11,CASn SI_ROUTE_DURATION_NS=4.999 SI_ROUTE_BATCH=1
    capture reduced-r2 SI_ROUTE_DISTANCE_MM=2
    ;;
  isolate)
    capture isolate-on SI_ROUTE_PATTERN=isolated-a4
    capture isolate-off SI_ROUTE_PATTERN=isolated-a4 SI_ROUTE_PACKAGE_OFF=1 SI_ROUTE_REUSE_DIR="$root/isolate-on"
    ;;
  package-off|vtt)
    for pattern in prbs7 victim-even victim-odd; do
      folder="$pattern"
      if [[ "$pattern" == prbs7 ]]; then folder=before; fi
      if [[ "$1" == vtt ]]; then
        capture "vtt/$folder" SI_ROUTE_PATTERN="$pattern" SI_ROUTE_REUSE_DIR="$before/$folder" SI_ROUTE_VTT_OHMS=50
      else
        capture "package-off/$folder" SI_ROUTE_PATTERN="$pattern" SI_ROUTE_REUSE_DIR="$before/$folder" SI_ROUTE_PACKAGE_OFF=1
      fi
    done
    ;;
  width|spacing)
    capture "$1" SI_ROUTE_BATCH=1 SI_DDR3_BOARD="$root/$1-board/circuit.json"
    ;;
  weak)
    capture weak SI_ROUTE_BATCH=1 SI_ROUTE_DRIVER_MODEL=Model_345
    ;;
  slowest)
    capture slowest SI_ROUTE_BATCH=1 SI_ROUTE_DRIVER_MODEL=Model_273
    ;;
  *) exit 2 ;;
esac
