"""Run one research transient under the required shared lock and a <=600 s timeout."""
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import sys
import time

if sys.argv[1] != '--locked':
    lock = os.environ['SI_NGSPICE_LOCK']
    raise SystemExit(subprocess.call([lock, sys.executable, __file__, '--locked', *sys.argv[1:]]))

folder = Path(sys.argv[2]).resolve()
timeout = float(sys.argv[3])
if not 0 < timeout <= 600 or os.environ.get('OMP_NUM_THREADS') != '1':
    raise SystemExit('A <=600 second deadline and the shared OMP_NUM_THREADS=1 lock are required')
started = time.monotonic()
env = dict(os.environ, SPICE_ASCIIRAWFILE='1')
with (folder / 'stdout.log').open('w') as stdout, (folder / 'stderr.log').open('w') as stderr:
    child = subprocess.Popen([os.environ.get('SI_NGSPICE', 'ngspice'), '-n', '-b', '-r', 'waveform.raw', 'simulation.cir'], cwd=folder, env=env, stdout=stdout, stderr=stderr)
    timed_out = False
    try:
        code = child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        child.kill()
        code = child.wait()
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
result = dict(wallSeconds=time.monotonic() - started, timedOut=timed_out, exitCode=code, cpuSeconds=usage.ru_utime + usage.ru_stime, maxRss=usage.ru_maxrss, timeoutSeconds=timeout, samples=0, lastTimeSeconds=None)
raw = folder / 'waveform.raw'
if raw.exists():
    with raw.open(errors='replace') as stream:
        for line in stream:
            match = re.match(r'^(\d+)\s+([-+\d.eE]+)\s*$', line)
            if match:
                result['samples'] += 1
                result['lastTimeSeconds'] = float(match[2])
result['secondsPerSavedPoint'] = result['wallSeconds'] / result['samples'] if result['samples'] else None
(folder / 'native.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result), flush=True)
