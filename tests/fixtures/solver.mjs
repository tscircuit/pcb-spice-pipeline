// Canned solver responses exercise orchestration, not a substitute solver.
export async function fixtureSolver(request) {
  if(request.solver==='fasthenry') return {stdout:'',stderr:'',files:{'Zc.mat':
    'Row 1: N0a to N0b\nRow 2: N1a to N1b\nRow 3: N2a to N2b\nImpedance matrix for frequency = 1e+08 3 x 3\n0.0492610837 1j 0 0j 0 0j\n0 0j 0.0492610837 1j 0 0j\n0 0j 0 0j .002463054187 1j\n'}}
  if(request.solver==='fastercap') return {stdout:'Capacitance matrix is:\nDimension 3 x 3\ng_sig0 4e-12 -1e-12 -1e-12\ng_sig1 -1e-12 4e-12 -1e-12\ng_return -1e-12 -1e-12 4e-12\nWeighted Frobenius norm of the difference between capacitance (auto option): 0.001\n',stderr:'',files:{}}
  return {stdout:'',stderr:'',files:{'waveform.dat':'time a b\n'+Array.from({length:101},(_,i)=>[i*1e-7,i%2,3.3*(i%2)].join(' ')).join('\n')+'\n'}}
}
