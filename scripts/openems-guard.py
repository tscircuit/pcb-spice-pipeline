"""Run one solver/install process tree with sampled memory, time and disk guards."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time


def free_bytes():
    """Read actual APFS container free bytes, rather than purgeable space."""
    output = subprocess.check_output(["diskutil", "info", "/"], text=True)
    line = next(line for line in output.splitlines() if "Container Free" in line)
    return int(re.search(r"\((\d+) Bytes\)", line)[1])


def processes():
    """Read resident memory and ancestry without launching another solver."""
    rows = subprocess.check_output(
        ["ps", "-axo", "pid=,ppid=,rss=,comm="], text=True
    ).splitlines()
    return [row.split(None, 3) for row in rows if len(row.split(None, 3)) == 4]


def main():
    """Hold an exclusive lock and preserve usage for completed or stopped runs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--usage", type=Path, required=True)
    parser.add_argument("--reserve-gb", type=float, default=0)
    parser.add_argument("--seconds", type=float, default=2700)
    parser.add_argument("--log", type=Path)
    parser.add_argument("--project-ns", type=float)
    parser.add_argument("--threads", type=int, choices=[1, 2], default=1)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    args.usage.parent.mkdir(parents=True, exist_ok=True)
    with open("/private/tmp/pipeline-si-openems.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for pid, _, _, name in processes():
            if re.search(r"^(openEMS|ngspice|fasthenry|fastercap)$", Path(name).name, re.I):
                raise RuntimeError(f"Another solver is running: {pid} {name}")
        available = free_bytes()
        if available - args.reserve_gb * 1e9 < 5.3e9:
            raise RuntimeError(f"Insufficient disk admission: {available} bytes")
        env = dict(os.environ, OMP_NUM_THREADS=str(args.threads), OPENBLAS_NUM_THREADS="1",
                   VECLIB_MAXIMUM_THREADS="1", MKL_NUM_THREADS="1",
                   CMAKE_BUILD_PARALLEL_LEVEL="1", MAKEFLAGS="-j1")
        start = time.monotonic()
        wall_start = time.time()
        awake = subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
        output = args.log.open("w") if args.log else None
        process = subprocess.Popen(command, env=env, start_new_session=True,
                                   stdout=output, stderr=subprocess.STDOUT if output else None)
        peak = 0
        minimum_free = available
        reason = None
        next_disk = 0
        try:
            while process.poll() is None:
                rows = processes()
                children = {process.pid}
                for _ in rows:
                    expanded = children | {int(pid) for pid, parent, _, _ in rows
                                           if int(parent) in children}
                    if expanded == children:
                        break
                    children = expanded
                rss = sum(int(rss) for pid, _, rss, _ in rows if int(pid) in children)
                interference = [f"{pid} {name}" for pid, _, _, name in rows
                                if int(pid) not in children and re.search(
                                    r"^(openEMS|ngspice|fasthenry|fastercap)$", Path(name).name, re.I)]
                if interference:
                    reason = f"Another solver appeared: {interference}"
                peak = max(peak, rss)
                elapsed = max(time.monotonic() - start, time.time() - wall_start)
                if elapsed >= next_disk:
                    minimum_free = min(minimum_free, free_bytes())
                    next_disk = elapsed + 5
                    if args.project_ns and args.log and elapsed > 30:
                        log = args.log.read_text()
                        dt = re.findall(r"FDTD timestep is:\s*([\d.eE+-]+)", log)
                        steps = re.findall(r"Timestep:\s*(\d+)", log)
                        if dt and steps and int(steps[-1]) > 0:
                            progress = float(dt[-1]) * int(steps[-1])
                            projected = elapsed * args.project_ns * 1e-9 / progress
                            if projected > 2700:
                                reason = f"observed projection {projected:.1f} s exceeds 45 minutes"
                if peak > 1792 * 1024:
                    reason = "sampled process-tree RSS exceeded 1.75 GiB"
                elif elapsed > min(args.seconds, 2700):
                    reason = "runtime budget exceeded"
                elif minimum_free < 5.3e9:
                    reason = "container free space below 5.3 GB guard"
                if reason:
                    break
                time.sleep(.5)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            awake.terminate()
            awake.wait()
            if output:
                output.close()
            final_free = free_bytes()
            minimum_free = min(minimum_free, final_free)
            if minimum_free < 5.3e9:
                reason = reason or "container free space below 5.3 GB guard"
            if max(time.monotonic() - start, time.time() - wall_start) > min(args.seconds, 2700):
                reason = reason or "runtime budget exceeded"
            usage = {"command": command,
                     "seconds": max(time.monotonic() - start, time.time() - wall_start),
                     "monotonic_seconds": time.monotonic() - start,
                     "wall_seconds": time.time() - wall_start,
                     "start_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(wall_start)),
                     "peak_tree_rss_kib": peak, "initial_free_bytes": available,
                     "minimum_free_bytes": minimum_free, "final_free_bytes": final_free,
                     "exit_code": process.returncode, "stopped_reason": reason,
                     "omp_threads": args.threads, "rss_guard": "sampled, not an OS hard limit"}
            args.usage.write_text(json.dumps(usage, indent=2) + "\n")
            print(json.dumps(usage), flush=True)
        if reason or process.returncode:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
