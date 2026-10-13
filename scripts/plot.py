#!/usr/bin/env python3
"""Plot measured ngspice samples, with no synthetic/replayed waveform input."""
from pathlib import Path
import json
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

root = Path(sys.argv[1])
data = np.loadtxt(root / 'waveform.csv', delimiter=',', skiprows=1)
m = json.loads((root / 'metrics.json').read_text())
t, vp, vn, diff = data[:, 0], data[:, 3], data[:, 4], data[:, 5]
plt.rcParams.update({'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False})
fig, axes = plt.subplots(2, 1, figsize=(10, 6), sharex=True, layout='constrained')
mask = (t >= m['steadyStateStartSeconds']) & (t <= m['steadyStateStartSeconds'] + 4*m['uiSeconds'])
axes[0].plot(t[mask]*1e9, vp[mask], label='Receiver DQS')
axes[0].plot(t[mask]*1e9, vn[mask], label='Receiver DQSn')
axes[0].set_ylabel('Pad voltage (V)')
axes[0].legend(loc='upper right')
axes[1].plot(t[mask]*1e9, diff[mask], color='#1d6682', label='DQS − DQSn')
axes[1].set_ylabel('Differential voltage (V)')
axes[1].set_xlabel('Time (ns)')
for ax in axes:
    ax.grid(alpha=.22)
fig.suptitle('Actual ngspice transient · extracted reduced channel')
fig.savefig(root / 'waveform.png', dpi=160)
fig.savefig(root / 'waveform.svg')
plt.close(fig)

fig, ax = plt.subplots(figsize=(9, 5), layout='constrained')
ui, phase = m['uiSeconds'], m['eyePhaseSeconds']
start = phase-ui/2
count = 0
while start+2*ui <= t[-1]:
    if start >= m['steadyStateStartSeconds']:
        grid = np.linspace(start, start+2*ui, 1200)
        ax.plot((grid-start)*1e9, np.interp(grid, t, diff), color='#13788b', alpha=.28, linewidth=1)
        count += 1
    start += ui
ax.axvline(ui*1e9, color='#6e7480', linewidth=.8, linestyle='--')
ax.set(xlabel='Folded time (ns)', ylabel='Receiver DQS − DQSn (V)', xlim=(0, 2*ui*1e9))
ax.grid(alpha=.22)
ax.set_title(f'Deterministic DQS clock eye · {count} measured windows\n'
             f'Center opening {m["eyeHeightAtCenterV"]:.3f} V · UI {ui*1e9:.2f} ns')
fig.savefig(root / 'eye.png', dpi=160)
fig.savefig(root / 'eye.svg')
plt.close(fig)
(root / 'plot-receipt.json').write_text(json.dumps({
    'matplotlib': matplotlib.__version__, 'numpy': np.__version__,
    'python': sys.version, 'input': 'waveform.csv', 'windows': count,
    'interpolation': 'linear interpolation of actual adaptive time samples onto plotting grid',
    'scope': 'Alternating deterministic clock eye; no BER/random data/jitter claim'
}, indent=2)+'\n')
