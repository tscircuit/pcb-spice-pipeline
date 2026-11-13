"""Run one research transient under the shared ngspice lock, recording saved-point progress against wall time."""
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
    raise SystemExit(subprocess.call([lock, sys.executable, '-I', __file__, '--locked', *sys.argv[1:]]))

folder = Path(sys.argv[2]).resolve()
timeout = float(sys.argv[3])
if not 0 < timeout <= 600 or os.environ.get('OMP_NUM_THREADS') != '1':
    raise SystemExit('A <=600 second deadline and the shared OMP_NUM_THREADS=1 lock are required')
raw = folder / 'waveform.raw'
raw.unlink(missing_ok=True)
point = re.compile(r'^(\d+)\s+([-+\d.eE]+)\s*$')
progress = []
samples = 0
last = None
offset = 0
pending = ''


def poll():
    """Count complete ASCII rawfile points appended since the previous poll."""
    global samples, last, offset, pending
    if not raw.exists():
        return
    with raw.open('rb') as stream:
        stream.seek(offset)
        chunk = stream.read()
    offset += len(chunk)
    lines = (pending + chunk.decode(errors='replace')).split('\n')
    pending = lines.pop()
    changed = False
    for line in lines:
        match = point.match(line)
        if match:
            samples += 1
            last = float(match[2])
            changed = True
    if changed:
        progress.append([time.monotonic() - started, samples, last])


started = time.monotonic()
env = dict(os.environ, SPICE_ASCIIRAWFILE='1')
with (folder / 'stdout.log').open('w') as stdout, (folder / 'stderr.log').open('w') as stderr:
    child = subprocess.Popen([os.environ.get('SI_NGSPICE', 'ngspice'), '-n', '-b', '-r', 'waveform.raw', 'simulation.cir'], cwd=folder, env=env, stdout=stdout, stderr=stderr)
    timed_out = False
    while child.poll() is None:
        if time.monotonic() - started > timeout:
            timed_out = True
            child.kill()
            break
        poll()
        time.sleep(.25)
    code = child.wait()
    wall = time.monotonic() - started
poll()
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
result = dict(wallSeconds=wall, timedOut=timed_out, exitCode=code, cpuSeconds=usage.ru_utime + usage.ru_stime, maxRssBytes=usage.ru_maxrss, timeoutSeconds=timeout, samples=samples, lastTimeSeconds=last, progress=progress)
(folder / 'native.json').write_text(json.dumps(result))
print(json.dumps({key: value for key, value in result.items() if key != 'progress'}), flush=True)
