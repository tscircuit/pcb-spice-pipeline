#!/usr/bin/env bash
# One simulator run at a time, bounded. Usage:
#   xyce-bench.sh <label> <ngspice|xyce|xyce-mpi:N> <deck.cir> <workdir> [timeout_s]
set -uo pipefail
label=$1; engine=$2; deck=$3; work=$4; limit=${5:-1800}
mkdir -p "$work"; cd "$work" || exit 2
cp "$deck" simulation.cir
export OMP_NUM_THREADS=1 SPICE_ASCIIRAWFILE=1
start=$(date +%s.%N)
case $engine in
  ngspice) /usr/bin/time -v -o time.txt timeout "$limit" ngspice -n -b -r waveform.raw simulation.cir >stdout.log 2>stderr.log ;;
  xyce) /usr/bin/time -v -o time.txt timeout "$limit" Xyce simulation.cir >stdout.log 2>stderr.log ;;
  xyce-mpi:*) n=${engine#xyce-mpi:}; /usr/bin/time -v -o time.txt timeout "$limit" mpirun -np "$n" Xyce simulation.cir >stdout.log 2>stderr.log ;;
esac
code=$?
end=$(date +%s.%N)
wall=$(echo "$end - $start" | bc)
rss=$(awk -F: '/Maximum resident/{gsub(/ /,"",$2); print $2}' time.txt)
if [ -f waveform.raw ]; then points=$(awk '/^No. Points:/{print $3; exit}' waveform.raw); last=$(awk '/^Values:/{v=1; next} v && NF==2 {t=$2} END{print t}' waveform.raw); fi
if [ -f waveform.csv ]; then points=$(($(wc -l <waveform.csv) - 1)); last=$(tail -1 waveform.csv | cut -d, -f1); fi
steps=$(grep -m1 -i -E "Number of Successful Time Steps|successful time steps" stdout.log | awk '{print $NF}')
newton=$(grep -m1 -i -E "Number of Newton Iterations" stdout.log | tail -1 | awk '{print $NF}')
printf '%s\t%s\texit=%s\twall_s=%s\tpoints=%s\tlast_t=%s\tsteps=%s\tnewton=%s\tmaxrss_kb=%s\n' "$label" "$engine" "$code" "$wall" "${points:-}" "${last:-}" "${steps:-}" "${newton:-}" "${rss:-}" | tee -a "$(dirname "$work")/results.tsv"
