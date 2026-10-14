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
eye = json.loads((root / 'eyediagram.json').read_text())
eye_data = np.loadtxt(root / 'eye-data.csv', delimiter=',', skiprows=1)
t, vp, vn = data[:, 0], data[:, eye['positiveColumn']], data[:, eye['negativeColumn']]
diff = data[:, eye['differentialColumn']] * eye['polarity']
endpoint = eye['endpoint'].capitalize()
plt.rcParams.update({'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False,
                     'svg.hashsalt': 'tscircuit-executed-eye-v1'})
fig, axes = plt.subplots(2, 1, figsize=(10, 6), sharex=True, layout='constrained')
mask = (t >= m['steadyStateStartSeconds']) & (t <= m['steadyStateStartSeconds'] + 4*m['uiSeconds'])
axes[0].plot(t[mask]*1e9, vp[mask], label=eye.get('positiveSelector', f'{endpoint} positive'))
axes[0].plot(t[mask]*1e9, vn[mask], label=eye.get('negativeSelector', f'{endpoint} negative'))
axes[0].set_ylabel('Pad voltage (V)')
axes[0].legend(loc='upper right')
axes[1].plot(t[mask]*1e9, diff[mask], color='#1d6682', label='Positive − negative')
axes[1].set_ylabel('Differential voltage (V)')
axes[1].set_xlabel('Time (ns)')
for ax in axes:
    ax.grid(alpha=.22)
fig.suptitle('Actual ngspice transient · extracted reduced channel')
fig.savefig(root / 'waveform.png', dpi=160)
fig.savefig(root / 'waveform.svg', metadata={'Date': None})
plt.close(fig)

fig, ax = plt.subplots(figsize=(9, 5), layout='constrained')
ui = m['uiSeconds']
windows = np.unique(eye_data[:, 0])
for window in windows:
    measured = eye_data[eye_data[:, 0] == window]
    ax.plot(measured[:, 1]*1e9, measured[:, 2], color='#13788b', alpha=.28, linewidth=1)
count = len(windows)
ax.axvline(ui*1e9, color='#6e7480', linewidth=.8, linestyle='--')
ax.set(xlabel='Folded time (ns)', ylabel=f'{endpoint} positive − negative (V)', xlim=(0, 2*ui*1e9))
ax.grid(alpha=.22)
ax.set_title(f'{eye["name"]} · deterministic DQS clock eye · {count} measured windows\n'
             f'Center opening {m["eyeHeightAtCenterV"]:.3f} V · UI {ui*1e9:.2f} ns')
fig.savefig(root / 'eye.png', dpi=160)
fig.savefig(root / 'eye.svg', metadata={'Date': None})
plt.close(fig)
(root / 'plot-receipt.json').write_text(json.dumps({
    'matplotlib': matplotlib.__version__, 'numpy': np.__version__,
    'python': sys.version, 'input': 'eye-data.csv', 'waveform': 'waveform.csv', 'windows': count,
    'declaration': 'eyediagram.json',
    'interpolation': 'plots pipeline-generated linear interpolation of actual adaptive time samples',
    'scope': 'Alternating deterministic clock eye; no BER/random data/jitter claim'
}, indent=2)+'\n')
